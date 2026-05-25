-- Grant starter card collection (20 types × 2 copies) and a pre-built
-- 30-card starter deck to every new user at sign-up.
-- Card list matches LEGACY/js/auth/auth_manager.js generateStarterCollection().

-- Starter card ids (20 types, 2 copies each in collection)
-- Deck subset: 15 types × 2 = 30 cards, ready to queue immediately.

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest_catalog_version text;
  starter_ids text[] := array[
    'TW001','TW003','TW004','TW005','TW006','TW007','TW008','TW012',
    'TW013','TW017','TW027','TW028','TW030','TW053','TW068',
    'S006','S009','S016','S022','S026'
  ];
  starter_deck_ids text[] := array[
    'TW001','TW001','TW003','TW003','TW005','TW005',
    'TW006','TW006','TW007','TW007','TW008','TW008',
    'TW012','TW012','TW013','TW013','TW030','TW030',
    'TW053','TW053','S006','S006','S009','S009',
    'S016','S016','S022','S022','TW027','TW027'
  ];
  cid text;
begin
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Player'),
    coalesce(new.raw_user_meta_data->>'avatar_url', '/images/avatars/avatar1.webp')
  )
  on conflict (user_id) do nothing;

  insert into public.user_cosmetics (user_id, kind, cosmetic_id, source)
  values
    (new.id, 'avatar', 'avatar1', 'new_user_default'),
    (new.id, 'title', 'beginner', 'new_user_default')
  on conflict do nothing;

  -- Grant starter collection and deck only when a catalog snapshot exists.
  -- If none has been published yet (dev cold-start), the trigger skips silently;
  -- the client can call ensure_starter_collection() once the catalog is ready.
  select version into latest_catalog_version
  from public.card_catalog_snapshots
  order by created_at desc
  limit 1;

  if latest_catalog_version is not null then
    foreach cid in array starter_ids loop
      insert into public.card_collections (user_id, card_catalog_version, card_id, quantity)
      select new.id, latest_catalog_version, cid, 2
      where exists (
        select 1
        from public.card_catalog_snapshots s
        cross join lateral jsonb_array_elements(s.cards) as card
        where s.version = latest_catalog_version
          and card->>'id' = cid
          and coalesce((card->>'collectible')::boolean, true)
      )
      on conflict (user_id, card_catalog_version, card_id)
        do update set quantity = greatest(public.card_collections.quantity, excluded.quantity);
    end loop;

    -- Only create the starter deck if the user has no decks yet.
    insert into public.decks (user_id, name, card_catalog_version, card_ids)
    select new.id, '新手套牌', latest_catalog_version, starter_deck_ids
    where not exists (select 1 from public.decks where user_id = new.id);
  end if;

  return new;
end;
$$;

-- RPC for granting the starter collection to users who signed up before this
-- migration (or in a dev environment where the catalog wasn't published yet).
create or replace function public.ensure_starter_collection()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  latest_catalog_version text;
  starter_ids text[] := array[
    'TW001','TW003','TW004','TW005','TW006','TW007','TW008','TW012',
    'TW013','TW017','TW027','TW028','TW030','TW053','TW068',
    'S006','S009','S016','S022','S026'
  ];
  starter_deck_ids text[] := array[
    'TW001','TW001','TW003','TW003','TW005','TW005',
    'TW006','TW006','TW007','TW007','TW008','TW008',
    'TW012','TW012','TW013','TW013','TW030','TW030',
    'TW053','TW053','S006','S006','S009','S009',
    'S016','S016','S022','S022','TW027','TW027'
  ];
  cid text;
  granted integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select version into latest_catalog_version
  from public.card_catalog_snapshots
  order by created_at desc
  limit 1;

  if latest_catalog_version is null then
    return 0;
  end if;

  foreach cid in array starter_ids loop
    insert into public.card_collections (user_id, card_catalog_version, card_id, quantity)
    select current_user_id, latest_catalog_version, cid, 2
    where exists (
      select 1
      from public.card_catalog_snapshots s
      cross join lateral jsonb_array_elements(s.cards) as card
      where s.version = latest_catalog_version
        and card->>'id' = cid
        and coalesce((card->>'collectible')::boolean, true)
    )
    on conflict (user_id, card_catalog_version, card_id)
      do update set quantity = greatest(public.card_collections.quantity, excluded.quantity);
    if found then
      granted := granted + 1;
    end if;
  end loop;

  insert into public.decks (user_id, name, card_catalog_version, card_ids)
  select current_user_id, '新手套牌', latest_catalog_version, starter_deck_ids
  where not exists (select 1 from public.decks where user_id = current_user_id);

  return granted;
end;
$$;

grant execute on function public.ensure_starter_collection() to authenticated;
