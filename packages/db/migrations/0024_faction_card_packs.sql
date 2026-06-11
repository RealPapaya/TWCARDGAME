-- Faction-themed card packs: per-pack rarity drop rates and weighted faction pulls.
--
-- The shop now offers four party/faction packs (KMT / DPP / TPP / Worker) plus a
-- general pack. Faction packs roll rarities at 60/30/7/3 and weight cards whose
-- catalog `category` matches the pack's faction (default 3x). The general pack
-- rolls 50/35/10/5 with no weighting. Rarity thresholds are read from each item's
-- `contents.dropRates`, so rates are data-driven per shop item.

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
        -- Roll rarity from the item's own dropRates (cumulative), falling back to
        -- a 60/26/10/4 split if the item omits explicit rates.
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

        -- Weighted pick within the rolled rarity: faction cards get `faction_weight`x
        -- the selection weight via exponential (Gumbel) keys. With no faction this
        -- reduces to a uniform `order by random()`.
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
    end if;
  elsif item.kind = 'COSMETIC_PACK' then
    for i in 1..coalesce((item.contents->>'itemCount')::integer, 1) loop
      chosen_kind := case when random() < 0.5 then 'avatar' else 'title' end;
      duplicate_voucher := case when chosen_kind = 'avatar' then 50 else 30 end;

      select * into cosmetic
      from public.cosmetic_catalog c
      where c.kind = chosen_kind
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
          jsonb_build_object('cosmeticKind', chosen_kind)
        );

        rewards := rewards || jsonb_build_array(jsonb_build_object(
          'type', 'voucher',
          'amount', duplicate_voucher,
          'name', 'Duplicate compensation'
        ));
      else
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

-- Retire the single generic card pack in favour of the faction line-up.
update public.shop_items
set active = false
where id = 'card-pack';

insert into public.shop_items (id, kind, display_name, description, price_gold, contents)
values
  (
    'pack-kmt',
    'CARD_PACK',
    '國民黨牌組',
    '包含 5 張隨機卡牌，有較高機率抽到國民黨政治人物。',
    100,
    '{
      "cardCount": 5,
      "image": "/images/ui/SHOP_KMT.webp",
      "faction": "國民黨政治人物",
      "factionWeight": 3,
      "note": "有較高機率抽到國民黨政治人物",
      "dropRates": [
        {"label":"普通","rarity":"COMMON","rate":60},
        {"label":"精良","rarity":"RARE","rate":30},
        {"label":"史詩","rarity":"EPIC","rate":7},
        {"label":"傳說","rarity":"LEGENDARY","rate":3}
      ]
    }'
  ),
  (
    'pack-dpp',
    'CARD_PACK',
    '民進黨牌組',
    '包含 5 張隨機卡牌，有較高機率抽到民進黨政治人物。',
    100,
    '{
      "cardCount": 5,
      "image": "/images/ui/SHOP_DPP.webp",
      "faction": "民進黨政治人物",
      "factionWeight": 3,
      "note": "有較高機率抽到民進黨政治人物",
      "dropRates": [
        {"label":"普通","rarity":"COMMON","rate":60},
        {"label":"精良","rarity":"RARE","rate":30},
        {"label":"史詩","rarity":"EPIC","rate":7},
        {"label":"傳說","rarity":"LEGENDARY","rate":3}
      ]
    }'
  ),
  (
    'pack-tpp',
    'CARD_PACK',
    '民眾黨牌組',
    '包含 5 張隨機卡牌，有較高機率抽到民眾黨政治人物。',
    100,
    '{
      "cardCount": 5,
      "image": "/images/ui/Carddeck.webp",
      "faction": "民眾黨政治人物",
      "factionWeight": 3,
      "note": "有較高機率抽到民眾黨政治人物",
      "dropRates": [
        {"label":"普通","rarity":"COMMON","rate":60},
        {"label":"精良","rarity":"RARE","rate":30},
        {"label":"史詩","rarity":"EPIC","rate":7},
        {"label":"傳說","rarity":"LEGENDARY","rate":3}
      ]
    }'
  ),
  (
    'pack-worker',
    'CARD_PACK',
    '勞工牌組',
    '包含 5 張隨機卡牌，有較高機率抽到勞工。',
    100,
    '{
      "cardCount": 5,
      "image": "/images/ui/SHOP_WORKER.webp",
      "faction": "勞工",
      "factionWeight": 3,
      "note": "有較高機率抽到勞工",
      "dropRates": [
        {"label":"普通","rarity":"COMMON","rate":60},
        {"label":"精良","rarity":"RARE","rate":30},
        {"label":"史詩","rarity":"EPIC","rate":7},
        {"label":"傳說","rarity":"LEGENDARY","rate":3}
      ]
    }'
  ),
  (
    'pack-general',
    'CARD_PACK',
    '通用牌組',
    '包含 5 張隨機卡牌，所有卡牌機率均等。',
    100,
    '{
      "cardCount": 5,
      "image": "/images/ui/SHOP_CARD.webp",
      "dropRates": [
        {"label":"普通","rarity":"COMMON","rate":50},
        {"label":"精良","rarity":"RARE","rate":35},
        {"label":"史詩","rarity":"EPIC","rate":10},
        {"label":"傳說","rarity":"LEGENDARY","rate":5}
      ]
    }'
  )
on conflict (id) do update
  set kind = excluded.kind,
      display_name = excluded.display_name,
      description = excluded.description,
      price_gold = excluded.price_gold,
      contents = excluded.contents,
      active = true;
