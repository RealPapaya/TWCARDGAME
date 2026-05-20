-- Legacy shop parity: paid card packs and cosmetic packs.

alter table public.profiles
  add column if not exists gold integer not null default 100,
  add column if not exists vouchers integer not null default 0,
  add column if not exists owned_avatars text[] not null default array['avatar1']::text[],
  add column if not exists owned_titles text[] not null default array['beginner']::text[],
  add column if not exists selected_title text not null default 'beginner';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_gold_nonnegative') then
    alter table public.profiles
      add constraint profiles_gold_nonnegative check (gold >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_vouchers_nonnegative') then
    alter table public.profiles
      add constraint profiles_vouchers_nonnegative check (vouchers >= 0);
  end if;
end$$;

alter table public.shop_items
  add column if not exists price_gold integer not null default 0;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'shop_items_kind_check') then
    alter table public.shop_items drop constraint shop_items_kind_check;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'shop_items_kind_legacy_check') then
    alter table public.shop_items
      add constraint shop_items_kind_legacy_check
      check (kind in ('CARD_PACK', 'SINGLE_CARD', 'COSMETIC_PACK'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'shop_items_price_gold_nonnegative') then
    alter table public.shop_items
      add constraint shop_items_price_gold_nonnegative check (price_gold >= 0);
  end if;
end$$;

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
  item_count integer;
  roll numeric;
  chosen_rarity text;
  reward_card_id text;
  avatar_pool jsonb := '[
    {"id":"avatar1","path":"/images/avatars/avatar1.webp","name":"柯文哲"},
    {"id":"avatar2","path":"/images/avatars/avatar2.webp","name":"蔡英文"},
    {"id":"avatar3","path":"/images/avatars/avatar3.webp","name":"韓國瑜"},
    {"id":"avatar4","path":"/images/avatars/avatar4.webp","name":"傅崐萁"}
  ]'::jsonb;
  title_pool jsonb := '[
    {"id":"beginner","name":"菜鳥"},
    {"id":"salary_thief","name":"薪水小偷"},
    {"id":"monument_smoker","name":"古蹟菸客"},
    {"id":"busy_worker","name":"忙碌社畜"},
    {"id":"wehavemusic","name":"我們有音樂"},
    {"id":"heartbroken_dog","name":"傷心狗狗"}
  ]'::jsonb;
  reward jsonb;
  reward_id text;
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
    raise exception '金幣不足。';
  end if;

  select version, cards into target_version, snapshot_cards
  from public.card_catalog_snapshots
  order by created_at desc
  limit 1;

  if target_version is null then
    raise exception 'No card catalog snapshot has been published.';
  end if;

  if item.kind = 'CARD_PACK' then
    card_count := coalesce((item.contents->>'cardCount')::integer, 5);

    for i in 1..card_count loop
      roll := random() * 100;
      chosen_rarity := case
        when roll < 60 then 'COMMON'
        when roll < 86 then 'RARE'
        when roll < 96 then 'EPIC'
        else 'LEGENDARY'
      end;

      select card->>'id' into reward_card_id
      from jsonb_array_elements(snapshot_cards) as card
      where card->>'rarity' = chosen_rarity
        and coalesce((card->>'collectible')::boolean, true)
      order by random()
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

        rewards := rewards || jsonb_build_array(jsonb_build_object('type', 'card', 'cardId', reward_card_id));
      end if;
    end loop;
  elsif item.kind = 'COSMETIC_PACK' then
    item_count := coalesce((item.contents->>'itemCount')::integer, 1);

    for i in 1..item_count loop
      if random() < 0.5 then
        select candidate into reward
        from jsonb_array_elements(avatar_pool) as candidate
        where not ((candidate->>'id') = any(profile.owned_avatars))
        order by random()
        limit 1;

        if reward is null then
          profile.vouchers := profile.vouchers + 50;
          rewards := rewards || jsonb_build_array(jsonb_build_object(
            'type', 'voucher',
            'amount', 50,
            'name', '頭像重複補償'
          ));
        else
          reward_id := reward->>'id';
          profile.owned_avatars := array_append(profile.owned_avatars, reward_id);
          rewards := rewards || jsonb_build_array(jsonb_build_object(
            'type', 'avatar',
            'id', reward_id,
            'name', reward->>'name',
            'path', reward->>'path'
          ));
        end if;
      else
        select candidate into reward
        from jsonb_array_elements(title_pool) as candidate
        where not ((candidate->>'id') = any(profile.owned_titles))
        order by random()
        limit 1;

        if reward is null then
          profile.vouchers := profile.vouchers + 30;
          rewards := rewards || jsonb_build_array(jsonb_build_object(
            'type', 'voucher',
            'amount', 30,
            'name', '稱號重複補償'
          ));
        else
          reward_id := reward->>'id';
          profile.owned_titles := array_append(profile.owned_titles, reward_id);
          rewards := rewards || jsonb_build_array(jsonb_build_object(
            'type', 'title',
            'id', reward_id,
            'name', reward->>'name'
          ));
        end if;
      end if;
    end loop;
  end if;

  update public.profiles
  set gold = profile.gold - item.price_gold,
      vouchers = profile.vouchers,
      owned_avatars = profile.owned_avatars,
      owned_titles = profile.owned_titles
  where user_id = current_user_id;

  return jsonb_build_object(
    'itemId', item.id,
    'kind', item.kind,
    'priceGold', item.price_gold,
    'remainingGold', profile.gold - item.price_gold,
    'rewards', rewards
  );
end;
$$;

grant execute on function public.purchase_shop_item(text) to authenticated;
grant select, update on public.profiles to authenticated;

update public.shop_items
set active = false
where id in ('starter_pack_common', 'starter_pack_rare');

insert into public.shop_items (id, kind, display_name, description, price_gold, contents)
values
  (
    'card-pack',
    'CARD_PACK',
    '卡牌包',
    '包含 5 張隨機卡牌',
    100,
    '{
      "cardCount": 5,
      "dropRates": [
        {"label":"普通","rarity":"COMMON","rate":60},
        {"label":"精良","rarity":"RARE","rate":26},
        {"label":"史詩","rarity":"EPIC","rate":10},
        {"label":"傳說","rarity":"LEGENDARY","rate":4}
      ]
    }'
  ),
  (
    'cosmetic-pack',
    'COSMETIC_PACK',
    '酷炫包',
    '獲得稀有頭像或稱號',
    75,
    '{
      "itemCount": 1,
      "dropRates": [
        {"label":"個人頭像","type":"avatar","rate":50},
        {"label":"專屬稱號","type":"title","rate":50}
      ],
      "note":"內容均為隨機抽取"
    }'
  )
on conflict (id) do update
  set kind = excluded.kind,
      display_name = excluded.display_name,
      description = excluded.description,
      price_gold = excluded.price_gold,
      contents = excluded.contents,
      active = true;
