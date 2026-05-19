-- Phase 5: friends, leaderboard, shop, AI matches.

alter table public.profiles
  add column if not exists wins_count integer not null default 0;

alter table public.match_history
  add column if not exists is_vs_ai boolean not null default false,
  add column if not exists ai_difficulty text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'match_history_ai_difficulty_check'
  ) then
    alter table public.match_history
      add constraint match_history_ai_difficulty_check
      check (ai_difficulty is null or ai_difficulty in ('easy', 'normal', 'hard'));
  end if;
end$$;

create table if not exists public.friends (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_user_id),
  check (user_id <> friend_user_id)
);

create index if not exists friends_friend_user_id_idx
  on public.friends (friend_user_id);

create table if not exists public.shop_items (
  id text primary key,
  kind text not null check (kind in ('CARD_PACK', 'SINGLE_CARD')),
  display_name text not null,
  description text,
  contents jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.friends enable row level security;
alter table public.shop_items enable row level security;

drop policy if exists "Users read their friends" on public.friends;
create policy "Users read their friends"
on public.friends for select
using (auth.uid() = user_id);

drop policy if exists "Users insert their friends" on public.friends;
create policy "Users insert their friends"
on public.friends for insert
with check (auth.uid() = user_id);

drop policy if exists "Users delete their friends" on public.friends;
create policy "Users delete their friends"
on public.friends for delete
using (auth.uid() = user_id);

drop policy if exists "Shop items are public" on public.shop_items;
create policy "Shop items are public"
on public.shop_items for select
using (active);

create or replace function public.send_friend_request(p_target_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_user_id uuid;
  clean_name text := nullif(trim(p_target_display_name), '');
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if clean_name is null then
    raise exception 'Display name is required.';
  end if;

  select user_id into target_user_id
  from public.profiles
  where display_name = clean_name
  limit 1;

  if target_user_id is null then
    raise exception 'No player found with display name %.', clean_name;
  end if;

  if target_user_id = current_user_id then
    raise exception 'You cannot add yourself as a friend.';
  end if;

  insert into public.friends (user_id, friend_user_id)
  values (current_user_id, target_user_id)
  on conflict do nothing;

  insert into public.friends (user_id, friend_user_id)
  values (target_user_id, current_user_id)
  on conflict do nothing;

  return target_user_id;
end;
$$;

create or replace function public.remove_friend(p_friend_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  delete from public.friends
  where (user_id = current_user_id and friend_user_id = p_friend_user_id)
     or (user_id = p_friend_user_id and friend_user_id = current_user_id);
end;
$$;

create or replace function public.list_friends()
returns table (
  friend_user_id uuid,
  display_name text,
  avatar_url text,
  wins_count integer,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    f.friend_user_id,
    p.display_name,
    p.avatar_url,
    p.wins_count,
    f.created_at
  from public.friends f
  join public.profiles p on p.user_id = f.friend_user_id
  where f.user_id = auth.uid()
  order by p.display_name;
$$;

-- PHASE 5 STUB — no claim limit, no price check, no currency, no idempotency.
-- A user may claim any active shop_item an unlimited number of times. This is
-- deliberate so the inventory-grant pipeline is exercised end-to-end without
-- waiting on an economy design. Before going to production: add a per-user
-- claim ledger (e.g. shop_claims with UNIQUE(user_id, item_id, day)), a price
-- column on shop_items, and a currency deduction inside this function.
create or replace function public.purchase_shop_item(p_item_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  item public.shop_items%rowtype;
  target_version text;
  granted_count integer := 0;
  card_id_text text;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into item
  from public.shop_items
  where id = p_item_id and active;

  if item.id is null then
    raise exception 'Shop item % is not available.', p_item_id;
  end if;

  select version into target_version
  from public.card_catalog_snapshots
  order by created_at desc
  limit 1;

  if target_version is null then
    raise exception 'No card catalog snapshot has been published.';
  end if;

  for card_id_text in
    select jsonb_array_elements_text(item.contents->'cards')
  loop
    insert into public.card_collections (user_id, card_catalog_version, card_id, quantity)
    values (current_user_id, target_version, card_id_text, 1)
    on conflict (user_id, card_catalog_version, card_id) do update
      set quantity = public.card_collections.quantity + 1;
    granted_count := granted_count + 1;
  end loop;

  return granted_count;
end;
$$;

create or replace function public.get_leaderboard(p_limit integer default 50)
returns table (
  rank integer,
  user_id uuid,
  display_name text,
  avatar_url text,
  wins_count integer
)
language sql
security definer
set search_path = public
as $$
  select
    (row_number() over (order by p.wins_count desc, p.display_name asc))::integer as rank,
    p.user_id,
    p.display_name,
    p.avatar_url,
    p.wins_count
  from public.profiles p
  order by p.wins_count desc, p.display_name asc
  limit greatest(coalesce(p_limit, 50), 1);
$$;

create or replace function public.record_pvp_win(p_match_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.match_history%rowtype;
  winner_user_id uuid;
begin
  select * into match_row
  from public.match_history
  where id = p_match_id
  for update;

  if match_row.id is null then
    raise exception 'Match % not found.', p_match_id;
  end if;

  if match_row.is_vs_ai then
    return;
  end if;

  if match_row.winner_seat is null then
    return;
  end if;

  winner_user_id := case match_row.winner_seat
    when 'player1' then match_row.player1_user_id
    when 'player2' then match_row.player2_user_id
  end;

  if winner_user_id is null then
    return;
  end if;

  update public.profiles
  set wins_count = wins_count + 1
  where user_id = winner_user_id;
end;
$$;

grant select, insert, delete on public.friends to authenticated;
grant select on public.shop_items to anon, authenticated;

grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.list_friends() to authenticated;
grant execute on function public.purchase_shop_item(text) to authenticated;
grant execute on function public.get_leaderboard(integer) to anon, authenticated;
grant execute on function public.record_pvp_win(text) to service_role;

grant select, insert, update, delete on public.friends to service_role;
grant select, insert, update, delete on public.shop_items to service_role;

-- Seed a couple of free-stub shop items so the UI has content out of the box.
-- These reference card ids that exist in the current catalog seed.
insert into public.shop_items (id, kind, display_name, description, contents)
values
  ('starter_pack_common', 'CARD_PACK', '新手卡包', 'Five sample cards from the starter catalog.', '{"cards":["TW010","TW044","TW045","TW046","TW050"]}'),
  ('starter_pack_rare',   'CARD_PACK', '進階卡包', 'Five mid-tier cards (free stub — no currency cost).', '{"cards":["TW020","TW016","TW023","TW024","TW030"]}')
on conflict (id) do update
  set kind = excluded.kind,
      display_name = excluded.display_name,
      description = excluded.description,
      contents = excluded.contents,
      active = true;
