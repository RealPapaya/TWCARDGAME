create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Player',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.card_catalog_snapshots (
  version text primary key,
  cards jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  card_catalog_version text not null references public.card_catalog_snapshots(version),
  card_ids text[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.card_collections (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_catalog_version text not null references public.card_catalog_snapshots(version),
  card_id text not null,
  quantity integer not null default 0 check (quantity >= 0),
  acquired_at timestamptz not null default now(),
  primary key (user_id, card_catalog_version, card_id)
);

create table if not exists public.match_history (
  id text primary key,
  card_catalog_version text not null,
  player1_user_id uuid,
  player2_user_id uuid,
  winner_seat text check (winner_seat in ('player1', 'player2')),
  result_reason text not null,
  final_state jsonb not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz not null default now()
);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_decks_updated_at on public.decks;
create trigger set_decks_updated_at
before update on public.decks
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Player'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user_profile();

alter table public.profiles enable row level security;
alter table public.card_catalog_snapshots enable row level security;
alter table public.decks enable row level security;
alter table public.card_collections enable row level security;
alter table public.match_history enable row level security;

drop policy if exists "Users read their profile" on public.profiles;
create policy "Users read their profile"
on public.profiles for select
using (auth.uid() = user_id);

drop policy if exists "Users insert their profile" on public.profiles;
create policy "Users insert their profile"
on public.profiles for insert
with check (auth.uid() = user_id);

drop policy if exists "Users update their profile" on public.profiles;
create policy "Users update their profile"
on public.profiles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Card catalog snapshots are public" on public.card_catalog_snapshots;
create policy "Card catalog snapshots are public"
on public.card_catalog_snapshots for select
using (true);

drop policy if exists "Users read their decks" on public.decks;
create policy "Users read their decks"
on public.decks for select
using (auth.uid() = user_id);

drop policy if exists "Users write their decks" on public.decks;
create policy "Users write their decks"
on public.decks for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users read their collection" on public.card_collections;
create policy "Users read their collection"
on public.card_collections for select
using (auth.uid() = user_id);

drop policy if exists "Players read their match history" on public.match_history;
create policy "Players read their match history"
on public.match_history for select
using (auth.uid() = player1_user_id or auth.uid() = player2_user_id);
