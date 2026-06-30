-- Battle emote cosmetics in 炫彩包.
-- Fixed cosmetic-pack odds: 頭像 35% / 稱號 35% / 表情 20% / 特殊卡 10%.

-- 1) Widen cosmetic kind checks to include battle emotes.
do $$
declare
  c record;
begin
  for c in
    select rel.relname, con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname in ('cosmetic_catalog', 'user_cosmetics')
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
  end loop;
end$$;

alter table public.cosmetic_catalog
  add constraint cosmetic_catalog_kind_check check (kind in ('avatar', 'title', 'card_art', 'emote'));
alter table public.user_cosmetics
  add constraint user_cosmetics_kind_check check (kind in ('avatar', 'title', 'card_art', 'emote'));

-- 2) Denormalised ownership + selected four-slot battle emote loadout.
alter table public.profiles
  add column if not exists owned_emotes text[] not null default '{}'::text[],
  add column if not exists selected_emotes text[] not null default '{}'::text[];

-- 3) Seed placeholder emotes. The frame is the outer shell; actual emote art can
--    be attached later via metadata/asset_path without changing the battle flow.
insert into public.cosmetic_catalog (kind, id, display_name, asset_path, metadata)
values
  ('emote', 'emote_cheer', '漂亮', '/images/ui/battle_emote_frame.webp', jsonb_build_object('label', '漂亮')),
  ('emote', 'emote_think', '思考中', '/images/ui/battle_emote_frame.webp', jsonb_build_object('label', '思考')),
  ('emote', 'emote_shock', '震驚', '/images/ui/battle_emote_frame.webp', jsonb_build_object('label', '震驚')),
  ('emote', 'emote_taunt', '來戰', '/images/ui/battle_emote_frame.webp', jsonb_build_object('label', '來戰'))
on conflict (kind, id) do update
  set display_name = excluded.display_name,
      asset_path = excluded.asset_path,
      metadata = excluded.metadata,
      active = true;

-- 4) Grant path keeps owned_emotes and the selected four-slot loadout in sync.
create or replace function public.grant_user_cosmetic(
  p_user_id uuid,
  p_kind text,
  p_cosmetic_id text,
  p_source_type text default null,
  p_source_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  if not exists (
    select 1
    from public.cosmetic_catalog
    where kind = p_kind
      and id = p_cosmetic_id
      and active
  ) then
    raise exception 'Cosmetic %.% is not available.', p_kind, p_cosmetic_id;
  end if;

  insert into public.user_cosmetics (user_id, kind, cosmetic_id, source, metadata)
  values (p_user_id, p_kind, p_cosmetic_id, p_source_type, coalesce(p_metadata, '{}'::jsonb))
  on conflict do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count > 0 then
    if p_kind = 'avatar' then
      update public.profiles
      set owned_avatars = case
            when p_cosmetic_id = any(owned_avatars) then owned_avatars
            else array_append(owned_avatars, p_cosmetic_id)
          end
      where user_id = p_user_id;
    elsif p_kind = 'title' then
      update public.profiles
      set owned_titles = case
            when p_cosmetic_id = any(owned_titles) then owned_titles
            else array_append(owned_titles, p_cosmetic_id)
          end
      where user_id = p_user_id;
    elsif p_kind = 'card_art' then
      update public.profiles
      set owned_card_arts = case
            when p_cosmetic_id = any(owned_card_arts) then owned_card_arts
            else array_append(owned_card_arts, p_cosmetic_id)
          end
      where user_id = p_user_id;
    elsif p_kind = 'emote' then
      update public.profiles
      set owned_emotes = case
            when p_cosmetic_id = any(owned_emotes) then owned_emotes
            else array_append(owned_emotes, p_cosmetic_id)
          end,
          selected_emotes = case
            when p_cosmetic_id = any(selected_emotes) then selected_emotes
            when cardinality(selected_emotes) >= 4 then selected_emotes
            else array_append(selected_emotes, p_cosmetic_id)
          end
      where user_id = p_user_id;
    end if;

    perform public.emit_user_event(
      p_user_id,
      'cosmetic_acquired',
      p_source_type,
      p_source_id,
      jsonb_build_object('kind', p_kind, 'cosmeticId', p_cosmetic_id) || coalesce(p_metadata, '{}'::jsonb)
    );

    if p_kind = 'title' then
      perform public.emit_user_progress_event(
        p_user_id, 'title_acquired', 1, p_source_type, p_source_id, jsonb_build_object('cosmeticId', p_cosmetic_id)
      );
    elsif p_kind = 'avatar' then
      perform public.emit_user_progress_event(
        p_user_id, 'avatar_acquired', 1, p_source_type, p_source_id, jsonb_build_object('cosmeticId', p_cosmetic_id)
      );
    end if;
  end if;

  return inserted_count > 0;
end;
$$;

revoke all on function public.grant_user_cosmetic(uuid, text, text, text, text, jsonb) from public;
grant execute on function public.grant_user_cosmetic(uuid, text, text, text, text, jsonb) to service_role;

-- 5) Optional profile loadout setter for future emote management UI.
create or replace function public.set_user_battle_emotes(p_emote_ids text[])
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  next_emotes text[];
  profile_row public.profiles;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select coalesce(array_agg(id order by first_ord), '{}'::text[])
  into next_emotes
  from (
    select btrim(value) as id, min(ord) as first_ord
    from unnest(coalesce(p_emote_ids, '{}'::text[])) with ordinality as input(value, ord)
    where btrim(value) <> ''
    group by btrim(value)
  ) deduped;

  if cardinality(next_emotes) > 4 then
    raise exception 'At most 4 battle emotes can be selected.';
  end if;

  if exists (
    select 1
    from unnest(next_emotes) as requested(id)
    where not exists (
      select 1
      from public.user_cosmetics owned
      where owned.user_id = current_user_id
        and owned.kind = 'emote'
        and owned.cosmetic_id = requested.id
    )
  ) then
    raise exception 'One or more battle emotes are not owned.';
  end if;

  update public.profiles
  set selected_emotes = next_emotes
  where user_id = current_user_id
  returning * into profile_row;

  if profile_row.user_id is null then
    raise exception 'Profile not found.';
  end if;

  perform public.emit_user_event(
    current_user_id,
    'battle_emotes_selected',
    'profile',
    current_user_id::text,
    jsonb_build_object('emoteIds', next_emotes)
  );

  return profile_row;
end;
$$;

grant execute on function public.set_user_battle_emotes(text[]) to authenticated;
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

      -- Fixed per-kind odds: 頭像 35% / 稱號 35% / 表情 20% / 特殊卡 10%.
      roll := random() * 100;
      chosen_kind := case
        when roll < 35 then 'avatar'
        when roll < 70 then 'title'
        when roll < 90 then 'emote'
        else 'card_art'
      end;

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
          cosmetic.kind,
          cosmetic.id,
          'shop_item',
          item.id,
          jsonb_build_object('itemKind', item.kind)
        );

        if cosmetic.kind = 'avatar' then
          rewards := rewards || jsonb_build_array(jsonb_build_object(
            'type', 'avatar',
            'id', cosmetic.id,
            'name', cosmetic.display_name,
            'path', cosmetic.asset_path
          ));
        elsif cosmetic.kind = 'title' then
          rewards := rewards || jsonb_build_array(jsonb_build_object(
            'type', 'title',
            'id', cosmetic.id,
            'name', cosmetic.display_name
          ));
        elsif cosmetic.kind = 'emote' then
          rewards := rewards || jsonb_build_array(jsonb_build_object(
            'type', 'emote',
            'id', cosmetic.id,
            'name', cosmetic.display_name,
            'path', cosmetic.asset_path,
            'label', coalesce(cosmetic.metadata->>'label', cosmetic.display_name)
          ));
        else
          rewards := rewards || jsonb_build_array(jsonb_build_object(
            'type', 'card_art',
            'id', cosmetic.id,
            'cardId', coalesce(cosmetic.metadata->>'cardId', cosmetic.id),
            'name', cosmetic.display_name,
            'path', cosmetic.asset_path
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

update public.shop_items
set contents = jsonb_set(
  coalesce(contents, '{}'::jsonb),
  '{dropRates}',
  '[{"label":"個人頭像","type":"avatar","rate":35},{"label":"專屬稱號","type":"title","rate":35},{"label":"戰鬥表情","type":"emote","rate":20},{"label":"特殊卡","type":"card_art","rate":10}]'::jsonb,
  true
)
where id = 'cosmetic-pack';