-- 0032_more_achievements.sql
--
-- Adds 13 new one-time achievements on top of the 0023 scaffolding, plus the
-- detection hook for 歐洲人 (≥2 EPIC cards from a single pack).
--
-- Detection vocabulary is emitted server-side:
--   * pve_win:hard / daily_login          → already emitted (no code change)
--   * pve_lost:<diff>, damage_taken, minion_heal_match_50, pvp_played,
--     own_minions_died, political_minions_killed, perfect_game,
--     hero_damage_vs_taunt, labor_deck_win, vote_won
--       → emitted at match finalize by apps/realtime/src/matchServices.ts
--   * pack_epic_multi                      → emitted by purchase_shop_item below
--
-- All progress writes still go through the SECURITY DEFINER emit_* RPCs, so the
-- anti-cheat boundary from 0007/0023 is preserved.

-- ---------------------------------------------------------------------------
-- (a) Seed the achievements (idempotent — same on-conflict shape as 0023)
-- ---------------------------------------------------------------------------

insert into public.quest_definitions
  (id, display_name, description, event_type, target_count, recurrence, reward, active)
values
  ('ach_pve_win_hard_10',      '放馬過來 拎北蛋立',          '在困難電腦對戰中獲勝 10 次',                      'pve_win:hard',            10,  'once', '{"gold":300}'::jsonb,  true),
  ('ach_login_100',            '謝謝你喜歡台灣',              '在寶島遊戲王登入 100 天',                         'daily_login',             100, 'once', '{"gold":1000}'::jsonb, true),
  ('ach_pve_lost_easy_5',      '可憐哪',                      '在簡單電腦對戰中戰敗 5 次（投降不算）',           'pve_lost:easy',           5,   'once', '{"gold":100}'::jsonb,  true),
  ('ach_damage_taken_500',     '我被踢了五十幾腳',            '在玩家模式中我方英雄合計受到 500 傷害',           'damage_taken',            500, 'once', '{"gold":100}'::jsonb,  true),
  ('ach_minion_heal_50',       '妙手回春',                    '在一場玩家對戰中回復隨從合計 50 生命',            'minion_heal_match_50',    1,   'once', '{"gold":200}'::jsonb,  true),
  ('ach_pvp_played_100',       '遊戲王',                      '遊玩玩家對戰 100 場',                             'pvp_played',              100, 'once', '{"gold":500}'::jsonb,  true),
  ('ach_own_minions_died_300', 'OVERMYDEADBODY',              '我方合計死亡 300 隨從',                           'own_minions_died',        300, 'once', '{"gold":100}'::jsonb,  true),
  ('ach_political_kills_100',  '垃圾不分藍綠',                '擊殺 100 名隨從（民進黨、國民黨政治人物）',        'political_minions_killed', 100, 'once', '{"gold":200}'::jsonb,  true),
  ('ach_perfect_game',         '完全比賽',                    '在英雄沒有被攻擊過的情況下於玩家模式中獲勝（20 回合後、對方必須出過牌）', 'perfect_game', 1, 'once', '{"gold":300}'::jsonb, true),
  ('ach_hero_dmg_vs_taunt_100','他的手可以穿過我的巴巴阿',    '在對方場上有沙包隨從的情況下合計對敵方英雄造成 100 點傷害', 'hero_damage_vs_taunt', 100, 'once', '{"gold":100}'::jsonb, true),
  ('ach_labor_deck_win',       '了不起的奴才',                '用 30 張勞工牌組打贏一場玩家對戰',                'labor_deck_win',          1,   'once', '{"gold":100}'::jsonb,  true),
  ('ach_vote_won_30',          '我話說完，誰贊成？誰反對？',  '在中選會公投中中選 30 次',                        'vote_won',                30,  'once', '{"gold":100}'::jsonb,  true),
  ('ach_pack_epic_multi',      '歐洲人',                      '在一個卡包內抽中超過 2 張（含）史詩卡',           'pack_epic_multi',         1,   'once', '{"gold":200}'::jsonb,  true)
on conflict (id) do update
  set display_name = excluded.display_name,
      description  = excluded.description,
      event_type   = excluded.event_type,
      target_count = excluded.target_count,
      recurrence   = excluded.recurrence,
      reward       = excluded.reward,
      active       = excluded.active,
      updated_at   = now();

-- ---------------------------------------------------------------------------
-- (b) purchase_shop_item: emit pack_epic_multi when a single pack yields ≥2 EPIC
--     (rebased on 0031; only the epic_count counter + post-loop emit are new)
-- ---------------------------------------------------------------------------

create or replace function public.purchase_shop_item(p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  item public.shop_items%rowtype;
  profile public.profiles%rowtype;
  target_version text;
  snapshot_cards jsonb;
  rewards jsonb := '[]'::jsonb;
  card_count integer;
  roll numeric;
  chosen_rarity text;
  reward_card_id text;
  cosmetic public.cosmetic_catalog%rowtype;
  chosen_kind text;
  duplicate_voucher integer;
  remaining_gold integer;
  pack_faction text;
  faction_weight numeric;
  rate_cum numeric;
  rate_rec record;
  epic_count integer := 0;  -- 歐洲人: EPIC pulls within THIS pack open
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into item
  from public.shop_items
  where id = p_item_id and active
  for update;

  if item.id is null then
    raise exception 'Shop item % is not available.', p_item_id;
  end if;

  select * into profile
  from public.profiles
  where user_id = current_user_id
  for update;

  if profile.user_id is null then
    raise exception 'Profile not found.';
  end if;

  if profile.gold < item.price_gold then
    raise exception 'Not enough gold.';
  end if;

  if item.price_gold > 0 then
    remaining_gold := public.adjust_user_currency(
      current_user_id,
      'gold',
      -item.price_gold,
      'shop_purchase',
      'shop_item',
      item.id,
      jsonb_build_object('itemKind', item.kind)
    );
  else
    remaining_gold := profile.gold;
  end if;

  select version, cards into target_version, snapshot_cards
  from public.card_catalog_snapshots
  order by created_at desc
  limit 1;

  if target_version is null then
    raise exception 'No card catalog snapshot has been published.';
  end if;

  if item.kind in ('CARD_PACK', 'SINGLE_CARD') then
    if item.contents ? 'cards' then
      for reward_card_id in
        select jsonb_array_elements_text(item.contents->'cards')
      loop
        insert into public.card_collections (user_id, card_catalog_version, card_id, quantity)
        values (current_user_id, target_version, reward_card_id, 1)
        on conflict (user_id, card_catalog_version, card_id) do update
          set quantity = public.card_collections.quantity + 1;

        perform public.emit_user_event(
          current_user_id,
          'card_acquired',
          'shop_item',
          item.id,
          jsonb_build_object('cardId', reward_card_id, 'catalogVersion', target_version)
        );

        rewards := rewards || jsonb_build_array(jsonb_build_object('type', 'card', 'cardId', reward_card_id));
      end loop;
    else
      card_count := coalesce((item.contents->>'cardCount')::integer, 5);
      pack_faction := item.contents->>'faction';
      faction_weight := coalesce((item.contents->>'factionWeight')::numeric, 3);

      for i in 1..card_count loop
        roll := random() * 100;
        chosen_rarity := null;
        rate_cum := 0;
        for rate_rec in
          select elem->>'rarity' as rarity, (elem->>'rate')::numeric as rate
          from jsonb_array_elements(coalesce(item.contents->'dropRates', '[]'::jsonb))
            with ordinality as t(elem, ord)
          where elem ? 'rarity'
          order by t.ord
        loop
          rate_cum := rate_cum + rate_rec.rate;
          if roll < rate_cum then
            chosen_rarity := rate_rec.rarity;
            exit;
          end if;
        end loop;

        if chosen_rarity is null then
          chosen_rarity := case
            when roll < 60 then 'COMMON'
            when roll < 86 then 'RARE'
            when roll < 96 then 'EPIC'
            else 'LEGENDARY'
          end;
        end if;

        if chosen_rarity = 'EPIC' then
          epic_count := epic_count + 1;
        end if;

        select card->>'id' into reward_card_id
        from jsonb_array_elements(snapshot_cards) as card
        where card->>'rarity' = chosen_rarity
          and coalesce((card->>'collectible')::boolean, true)
        order by (-ln(1 - random()))
          / (case
               when pack_faction is not null and card->>'category' = pack_faction
               then faction_weight
               else 1
             end)
        limit 1;

        if reward_card_id is null then
          select card->>'id' into reward_card_id
          from jsonb_array_elements(snapshot_cards) as card
          where coalesce((card->>'collectible')::boolean, true)
          order by random()
          limit 1;
        end if;

        if reward_card_id is not null then
          insert into public.card_collections (user_id, card_catalog_version, card_id, quantity)
          values (current_user_id, target_version, reward_card_id, 1)
          on conflict (user_id, card_catalog_version, card_id) do update
            set quantity = public.card_collections.quantity + 1;

          perform public.emit_user_event(
            current_user_id,
            'card_acquired',
            'shop_item',
            item.id,
            jsonb_build_object('cardId', reward_card_id, 'catalogVersion', target_version, 'rarity', chosen_rarity)
          );

          rewards := rewards || jsonb_build_array(jsonb_build_object('type', 'card', 'cardId', reward_card_id));
        end if;
      end loop;

      -- 歐洲人: a single pack that rolled 2+ EPIC advances the achievement once.
      if epic_count >= 2 then
        perform public.emit_user_progress_event(
          current_user_id,
          'pack_epic_multi',
          1,
          'shop_item',
          item.id,
          jsonb_build_object('epicCount', epic_count)
        );
      end if;
    end if;
  elsif item.kind = 'COSMETIC_PACK' then
    for i in 1..coalesce((item.contents->>'itemCount')::integer, 1) loop
      duplicate_voucher := 50;

      select * into cosmetic
      from public.cosmetic_catalog c
      where c.kind in ('avatar', 'title')
        and c.active
        and not exists (
          select 1
          from public.user_cosmetics owned
          where owned.user_id = current_user_id
            and owned.kind = c.kind
            and owned.cosmetic_id = c.id
        )
      order by random()
      limit 1;

      if cosmetic.id is null then
        perform public.adjust_user_currency(
          current_user_id,
          'voucher',
          duplicate_voucher,
          'duplicate_cosmetic_compensation',
          'shop_item',
          item.id,
          jsonb_build_object('cosmeticKind', 'any')
        );

        rewards := rewards || jsonb_build_array(jsonb_build_object(
          'type', 'voucher',
          'amount', duplicate_voucher,
          'name', 'Duplicate compensation'
        ));
      else
        chosen_kind := cosmetic.kind;

        perform public.grant_user_cosmetic(
          current_user_id,
          chosen_kind,
          cosmetic.id,
          'shop_item',
          item.id,
          jsonb_build_object('itemKind', item.kind)
        );

        if chosen_kind = 'avatar' then
          rewards := rewards || jsonb_build_array(jsonb_build_object(
            'type', 'avatar',
            'id', cosmetic.id,
            'name', cosmetic.display_name,
            'path', cosmetic.asset_path
          ));
        else
          rewards := rewards || jsonb_build_array(jsonb_build_object(
            'type', 'title',
            'id', cosmetic.id,
            'name', cosmetic.display_name
          ));
        end if;
      end if;
    end loop;
  end if;

  perform public.emit_user_event(
    current_user_id,
    'shop_purchase',
    'shop_item',
    item.id,
    jsonb_build_object('itemKind', item.kind, 'priceGold', item.price_gold)
  );

  return jsonb_build_object(
    'itemId', item.id,
    'kind', item.kind,
    'priceGold', item.price_gold,
    'remainingGold', remaining_gold,
    'rewards', rewards
  );
end;
$$;

grant execute on function public.purchase_shop_item(text) to authenticated;
