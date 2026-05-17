create extension if not exists "pgcrypto";

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

alter table public.card_catalog_snapshots enable row level security;
alter table public.decks enable row level security;
alter table public.match_history enable row level security;

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

drop policy if exists "Players read their match history" on public.match_history;
create policy "Players read their match history"
on public.match_history for select
using (auth.uid() = player1_user_id or auth.uid() = player2_user_id);
