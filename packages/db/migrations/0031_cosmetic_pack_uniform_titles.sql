-- Rename cosmetic-pack titles and make cosmetic pack contents uniformly distributed.

insert into public.cosmetic_catalog (kind, id, display_name, asset_path)
values
  ('title', 'monument_smoker', '古蹟抽菸', null),
  ('title', 'busy_worker', '社畜小狗', null),
  ('title', 'wehavemusic', '至少我們還有音樂', null),
  ('title', 'heartbroken_dog', '心碎小狗', null)
on conflict (kind, id) do update
  set display_name = excluded.display_name,
      asset_path = excluded.asset_path,
      active = true;

update public.shop_items
set contents = coalesce(contents, '{}'::jsonb) || '{
  "dropRates": [
    {"label":"未擁有內容等機率","type":"cosmetic","rate":100}
  ],
  "note":"每次從所有尚未擁有的頭像與稱號中等機率抽取 1 項；已全數擁有時改給補償。"
}'::jsonb
where id = 'cosmetic-pack';

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
