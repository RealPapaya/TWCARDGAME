-- Beta reset controls and starter profile cosmetics.

alter table public.profiles
  alter column owned_avatars set default array['avatar1']::text[],
  alter column owned_titles set default array['beginner']::text[],
  alter column selected_title set default 'beginner',
  alter column avatar_url set default '/images/avatars/avatar1.webp';

update public.profiles
set avatar_url = coalesce(avatar_url, '/images/avatars/avatar1.webp'),
    selected_title = coalesce(selected_title, 'beginner'),
    owned_avatars = case
      when 'avatar1' = any(coalesce(owned_avatars, array[]::text[])) then coalesce(owned_avatars, array[]::text[])
      else array_prepend('avatar1', coalesce(owned_avatars, array[]::text[]))
    end,
    owned_titles = case
      when 'beginner' = any(coalesce(owned_titles, array[]::text[])) then coalesce(owned_titles, array[]::text[])
      else array_prepend('beginner', coalesce(owned_titles, array[]::text[]))
    end;

alter table public.profiles
  alter column selected_title set not null;

insert into public.user_cosmetics (user_id, kind, cosmetic_id, source)
select p.user_id, 'avatar', 'avatar1', 'starter_default'
from public.profiles p
on conflict do nothing;

insert into public.user_cosmetics (user_id, kind, cosmetic_id, source)
select p.user_id, 'title', 'beginner', 'starter_default'
from public.profiles p
on conflict do nothing;

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
            when p_cosmetic_id = any(coalesce(owned_avatars, array[]::text[])) then coalesce(owned_avatars, array[]::text[])
            else array_append(coalesce(owned_avatars, array[]::text[]), p_cosmetic_id)
          end
      where user_id = p_user_id;
    elsif p_kind = 'title' then
      update public.profiles
      set owned_titles = case
            when p_cosmetic_id = any(coalesce(owned_titles, array[]::text[])) then coalesce(owned_titles, array[]::text[])
            else array_append(coalesce(owned_titles, array[]::text[]), p_cosmetic_id)
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
  end if;

  return inserted_count > 0;
end;
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest_catalog_version text;
  starter_pack_card_ids text[] := array[
    'TW001','TW003','TW004','TW005','TW006','TW007','TW008','TW012',
    'TW013','TW017','TW027','TW028','TW030','TW053','TW068',
    'S006','S009','S016','S022','S026'
  ];
  cid text;
begin
  insert into public.profiles (user_id, display_name, display_name_set, avatar_url, owned_avatars, owned_titles, selected_title)
  values (
    new.id,
    'Player',
    false,
    coalesce(new.raw_user_meta_data->>'avatar_url', '/images/avatars/avatar1.webp'),
    array['avatar1']::text[],
    array['beginner']::text[],
    'beginner'
  )
  on conflict (user_id) do nothing;

  insert into public.user_cosmetics (user_id, kind, cosmetic_id, source)
  values
    (new.id, 'avatar', 'avatar1', 'starter_default'),
    (new.id, 'title', 'beginner', 'starter_default')
  on conflict do nothing;

  select version into latest_catalog_version
  from public.card_catalog_snapshots
  order by created_at desc
  limit 1;

  if latest_catalog_version is not null then
    foreach cid in array starter_pack_card_ids loop
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
  end if;

  return new;
end;
$$;

create or replace function public.beta_reset_database()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  deleted_auth_users integer := 0;
begin
  delete from auth.users where true;
  get diagnostics deleted_auth_users = row_count;

  truncate table
    public.match_history,
    public.friend_requests,
    public.friends,
    public.user_pve_defeats,
    public.user_quest_progress,
    public.user_login_days,
    public.user_currency_ledger,
    public.user_events,
    public.user_cosmetics,
    public.card_collections,
    public.decks,
    public.profiles
  restart identity cascade;

  return jsonb_build_object(
    'deletedAuthUsers', deleted_auth_users,
    'truncatedTables', array[
      'match_history',
      'friend_requests',
      'friends',
      'user_pve_defeats',
      'user_quest_progress',
      'user_login_days',
      'user_currency_ledger',
      'user_events',
      'user_cosmetics',
      'card_collections',
      'decks',
      'profiles'
    ],
    'preservedTables', array[
      'card_catalog_snapshots',
      'cosmetic_catalog',
      'quest_definitions',
      'shop_items'
    ]
  );
end;
$$;

revoke all on function public.beta_reset_database() from public;
grant execute on function public.beta_reset_database() to service_role;
