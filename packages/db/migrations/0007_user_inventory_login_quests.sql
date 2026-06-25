-- User inventory, daily login tracking, and quest event scaffolding.

alter table public.profiles
  add column if not exists login_days integer not null default 0,
  add column if not exists current_login_streak integer not null default 0,
  add column if not exists longest_login_streak integer not null default 0,
  add column if not exists last_login_date date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_login_days_nonnegative') then
    alter table public.profiles
      add constraint profiles_login_days_nonnegative check (login_days >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_current_login_streak_nonnegative') then
    alter table public.profiles
      add constraint profiles_current_login_streak_nonnegative check (current_login_streak >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_longest_login_streak_nonnegative') then
    alter table public.profiles
      add constraint profiles_longest_login_streak_nonnegative check (longest_login_streak >= 0);
  end if;
end$$;

create table if not exists public.cosmetic_catalog (
  kind text not null check (kind in ('avatar', 'title')),
  id text not null,
  display_name text not null,
  asset_path text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);

create table if not exists public.user_cosmetics (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  cosmetic_id text not null,
  acquired_at timestamptz not null default now(),
  source text,
  metadata jsonb not null default '{}'::jsonb,
  primary key (user_id, kind, cosmetic_id),
  foreign key (kind, cosmetic_id) references public.cosmetic_catalog(kind, id),
  check (kind in ('avatar', 'title'))
);

create table if not exists public.user_currency_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null check (currency in ('gold', 'voucher')),
  delta integer not null check (delta <> 0),
  balance_after integer not null check (balance_after >= 0),
  reason text not null,
  source_type text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_login_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  login_date date not null,
  streak_day integer not null check (streak_day >= 1),
  reward_gold integer not null default 0 check (reward_gold >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, login_date)
);

create table if not exists public.user_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  event_date_taipei date not null default ((now() at time zone 'Asia/Taipei')::date),
  source_type text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.quest_definitions (
  id text primary key,
  display_name text not null,
  description text,
  event_type text not null,
  target_count integer not null default 1 check (target_count > 0),
  reward jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_quest_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  quest_id text not null references public.quest_definitions(id) on delete cascade,
  current_count integer not null default 0 check (current_count >= 0),
  completed_at timestamptz,
  claimed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, quest_id)
);

create index if not exists user_currency_ledger_user_created_idx
  on public.user_currency_ledger (user_id, created_at desc);

create index if not exists user_events_user_created_idx
  on public.user_events (user_id, created_at desc);

create index if not exists user_events_type_date_idx
  on public.user_events (event_type, event_date_taipei);

create index if not exists user_quest_progress_user_idx
  on public.user_quest_progress (user_id, updated_at desc);

drop trigger if exists set_cosmetic_catalog_updated_at on public.cosmetic_catalog;
create trigger set_cosmetic_catalog_updated_at
before update on public.cosmetic_catalog
for each row execute function public.set_updated_at();

drop trigger if exists set_quest_definitions_updated_at on public.quest_definitions;
create trigger set_quest_definitions_updated_at
before update on public.quest_definitions
for each row execute function public.set_updated_at();

drop trigger if exists set_user_quest_progress_updated_at on public.user_quest_progress;
create trigger set_user_quest_progress_updated_at
before update on public.user_quest_progress
for each row execute function public.set_updated_at();

insert into public.cosmetic_catalog (kind, id, display_name, asset_path)
values
  ('avatar', 'avatar1', 'Avatar 1', '/images/avatars/avatar1.webp'),
  ('avatar', 'avatar2', 'Avatar 2', '/images/avatars/avatar2.webp'),
  ('avatar', 'avatar3', 'Avatar 3', '/images/avatars/avatar3.webp'),
  ('avatar', 'avatar4', 'Avatar 4', '/images/avatars/avatar4.webp'),
  ('title', 'beginner', 'Beginner', null),
  ('title', 'salary_thief', 'Salary Thief', null),
  ('title', 'monument_smoker', '古蹟抽菸', null),
  ('title', 'busy_worker', '社畜小狗', null),
  ('title', 'wehavemusic', '至少我們還有音樂', null),
  ('title', 'heartbroken_dog', '心碎小狗', null),
  ('title', 'sixty_seven', 'Sixty Seven', null),
  ('title', 'salmon_dream', 'Salmon Dream', null),
  ('title', 'how_pitiful', 'How Pitiful', null),
  ('title', 'kaohsiung_fortune', 'Kaohsiung Fortune', null),
  ('title', 'duck_blood_tofu', 'Duck Blood Tofu', null),
  ('title', 'taoyuan_hsinchu', 'Taoyuan Hsinchu', null)
on conflict (kind, id) do update
  set display_name = excluded.display_name,
      asset_path = excluded.asset_path,
      active = true;

insert into public.user_cosmetics (user_id, kind, cosmetic_id, source)
select p.user_id, 'avatar', avatar_id, 'legacy_profile'
from public.profiles p
cross join lateral unnest(coalesce(p.owned_avatars, array['avatar1']::text[])) as avatar_id
join public.cosmetic_catalog c on c.kind = 'avatar' and c.id = avatar_id
on conflict do nothing;

insert into public.user_cosmetics (user_id, kind, cosmetic_id, source)
select p.user_id, 'title', title_id, 'legacy_profile'
from public.profiles p
cross join lateral unnest(coalesce(p.owned_titles, array['beginner']::text[])) as title_id
join public.cosmetic_catalog c on c.kind = 'title' and c.id = title_id
on conflict do nothing;

insert into public.user_cosmetics (user_id, kind, cosmetic_id, source)
select p.user_id, 'title', p.selected_title, 'legacy_selected_title'
from public.profiles p
join public.cosmetic_catalog c on c.kind = 'title' and c.id = p.selected_title
on conflict do nothing;

insert into public.user_cosmetics (user_id, kind, cosmetic_id, source)
select p.user_id, 'avatar', 'avatar1', 'default_avatar'
from public.profiles p
on conflict do nothing;

insert into public.user_cosmetics (user_id, kind, cosmetic_id, source)
select p.user_id, 'title', 'beginner', 'default_title'
from public.profiles p
on conflict do nothing;

alter table public.cosmetic_catalog enable row level security;
alter table public.user_cosmetics enable row level security;
alter table public.user_currency_ledger enable row level security;
alter table public.user_login_days enable row level security;
alter table public.user_events enable row level security;
alter table public.quest_definitions enable row level security;
alter table public.user_quest_progress enable row level security;

drop policy if exists "Cosmetic catalog is public" on public.cosmetic_catalog;
create policy "Cosmetic catalog is public"
on public.cosmetic_catalog for select
using (active);

drop policy if exists "Users read their cosmetics" on public.user_cosmetics;
create policy "Users read their cosmetics"
on public.user_cosmetics for select
using (auth.uid() = user_id);

drop policy if exists "Users read their currency ledger" on public.user_currency_ledger;
create policy "Users read their currency ledger"
on public.user_currency_ledger for select
using (auth.uid() = user_id);

drop policy if exists "Users read their login days" on public.user_login_days;
create policy "Users read their login days"
on public.user_login_days for select
using (auth.uid() = user_id);

drop policy if exists "Users read their events" on public.user_events;
create policy "Users read their events"
on public.user_events for select
using (auth.uid() = user_id);

drop policy if exists "Active quests are public" on public.quest_definitions;
create policy "Active quests are public"
on public.quest_definitions for select
using (active);

drop policy if exists "Users read their quest progress" on public.user_quest_progress;
create policy "Users read their quest progress"
on public.user_quest_progress for select
using (auth.uid() = user_id);

create or replace function public.emit_user_event(
  p_user_id uuid,
  p_event_type text,
  p_source_type text default null,
  p_source_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
begin
  insert into public.user_events (user_id, event_type, source_type, source_id, metadata)
  values (p_user_id, p_event_type, p_source_type, p_source_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into event_id;

  insert into public.user_quest_progress (user_id, quest_id, current_count, completed_at)
  select
    p_user_id,
    q.id,
    1,
    case when q.target_count <= 1 then now() else null end
  from public.quest_definitions q
  where q.active
    and q.event_type = p_event_type
    and (q.starts_at is null or q.starts_at <= now())
    and (q.ends_at is null or q.ends_at > now())
  on conflict (user_id, quest_id) do update
    set current_count = case
          when public.user_quest_progress.completed_at is not null then public.user_quest_progress.current_count
          else least(
            (select target_count from public.quest_definitions where id = excluded.quest_id),
            public.user_quest_progress.current_count + excluded.current_count
          )
        end,
        completed_at = case
          when public.user_quest_progress.completed_at is not null then public.user_quest_progress.completed_at
          when public.user_quest_progress.current_count + excluded.current_count >=
            (select target_count from public.quest_definitions where id = excluded.quest_id)
          then now()
          else null
        end,
        updated_at = now();

  return event_id;
end;
$$;

create or replace function public.adjust_user_currency(
  p_user_id uuid,
  p_currency text,
  p_delta integer,
  p_reason text,
  p_source_type text default null,
  p_source_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.profiles%rowtype;
  new_balance integer;
begin
  if p_currency not in ('gold', 'voucher') then
    raise exception 'Unsupported currency %.', p_currency;
  end if;

  if p_delta = 0 then
    raise exception 'Currency delta must not be zero.';
  end if;

  select * into profile
  from public.profiles
  where user_id = p_user_id
  for update;

  if profile.user_id is null then
    raise exception 'Profile not found.';
  end if;

  if p_currency = 'gold' then
    new_balance := profile.gold + p_delta;
    if new_balance < 0 then
      raise exception 'Not enough gold.';
    end if;

    update public.profiles
    set gold = new_balance
    where user_id = p_user_id;
  else
    new_balance := profile.vouchers + p_delta;
    if new_balance < 0 then
      raise exception 'Not enough vouchers.';
    end if;

    update public.profiles
    set vouchers = new_balance
    where user_id = p_user_id;
  end if;

  insert into public.user_currency_ledger (
    user_id,
    currency,
    delta,
    balance_after,
    reason,
    source_type,
    source_id,
    metadata
  )
  values (
    p_user_id,
    p_currency,
    p_delta,
    new_balance,
    p_reason,
    p_source_type,
    p_source_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  perform public.emit_user_event(
    p_user_id,
    'currency_changed',
    p_source_type,
    p_source_id,
    jsonb_build_object('currency', p_currency, 'delta', p_delta, 'balanceAfter', new_balance, 'reason', p_reason)
      || coalesce(p_metadata, '{}'::jsonb)
  );

  return new_balance;
end;
$$;

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

create or replace function public.record_daily_login()
returns table (
  login_date date,
  login_days integer,
  current_login_streak integer,
  longest_login_streak integer,
  recorded boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  today date := (now() at time zone 'Asia/Taipei')::date;
  profile public.profiles%rowtype;
  inserted_count integer := 0;
  next_streak integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into profile
  from public.profiles
  where user_id = current_user_id
  for update;

  if profile.user_id is null then
    raise exception 'Profile not found.';
  end if;

  insert into public.user_login_days (user_id, login_date, streak_day)
  values (
    current_user_id,
    today,
    case
      when profile.last_login_date = today - 1 then profile.current_login_streak + 1
      when profile.last_login_date = today then greatest(profile.current_login_streak, 1)
      else 1
    end
  )
  on conflict do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count > 0 then
    next_streak := case
      when profile.last_login_date = today - 1 then profile.current_login_streak + 1
      else 1
    end;

    update public.profiles
    set login_days = profile.login_days + 1,
        current_login_streak = next_streak,
        longest_login_streak = greatest(profile.longest_login_streak, next_streak),
        last_login_date = today
    where user_id = current_user_id;

    record_daily_login.login_days := profile.login_days + 1;
    record_daily_login.current_login_streak := next_streak;
    record_daily_login.longest_login_streak := greatest(profile.longest_login_streak, next_streak);

    perform public.emit_user_event(
      current_user_id,
      'daily_login',
      'auth',
      today::text,
      jsonb_build_object('loginDate', today, 'streak', next_streak)
    );
  else
    record_daily_login.login_days := profile.login_days;
    record_daily_login.current_login_streak := profile.current_login_streak;
    record_daily_login.longest_login_streak := profile.longest_login_streak;
  end if;

  record_daily_login.login_date := today;
  record_daily_login.recorded := inserted_count > 0;
  return next;
end;
$$;

create or replace function public.select_user_cosmetic(p_kind text, p_cosmetic_id text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  cosmetic public.cosmetic_catalog%rowtype;
  profile_row public.profiles;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into cosmetic
  from public.cosmetic_catalog
  where kind = p_kind
    and id = p_cosmetic_id
    and active;

  if cosmetic.id is null then
    raise exception 'Cosmetic %.% is not available.', p_kind, p_cosmetic_id;
  end if;

  if not exists (
    select 1
    from public.user_cosmetics
    where user_id = current_user_id
      and kind = p_kind
      and cosmetic_id = p_cosmetic_id
  ) then
    raise exception 'Cosmetic %.% is not owned.', p_kind, p_cosmetic_id;
  end if;

  if p_kind = 'avatar' then
    update public.profiles
    set avatar_url = cosmetic.asset_path
    where user_id = current_user_id
    returning * into profile_row;
  elsif p_kind = 'title' then
    update public.profiles
    set selected_title = p_cosmetic_id
    where user_id = current_user_id
    returning * into profile_row;
  else
    raise exception 'Unsupported cosmetic kind %.', p_kind;
  end if;

  perform public.emit_user_event(
    current_user_id,
    'cosmetic_selected',
    'profile',
    p_cosmetic_id,
    jsonb_build_object('kind', p_kind, 'cosmeticId', p_cosmetic_id)
  );

  return profile_row;
end;
$$;

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
    coalesce(new.raw_user_meta_data->>'avatar_url', '/images/avatars/avatar1.webp')
  )
  on conflict (user_id) do nothing;

  insert into public.user_cosmetics (user_id, kind, cosmetic_id, source)
  values
    (new.id, 'avatar', 'avatar1', 'new_user_default'),
    (new.id, 'title', 'beginner', 'new_user_default')
  on conflict do nothing;

  return new;
end;
$$;

drop function if exists public.purchase_shop_item(text);

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

create or replace function public.save_user_deck(
  p_deck_id uuid,
  p_name text,
  p_card_catalog_version text,
  p_card_ids text[]
)
returns public.decks
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  deck_row public.decks;
  clean_name text := nullif(trim(p_name), '');
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if clean_name is null then
    raise exception 'Deck name is required.';
  end if;

  if coalesce(array_length(p_card_ids, 1), 0) <> 30 then
    raise exception 'Deck must contain exactly 30 cards.';
  end if;

  if not exists (select 1 from public.card_catalog_snapshots where version = p_card_catalog_version) then
    raise exception 'Card catalog snapshot % has not been published.', p_card_catalog_version;
  end if;

  if exists (
    with deck_counts as (
      select card_id, count(*)::integer as qty
      from unnest(p_card_ids) as card_id
      group by card_id
    ),
    catalog_cards as (
      select
        card->>'id' as card_id,
        card->>'rarity' as rarity,
        coalesce((card->>'collectible')::boolean, true) as collectible
      from public.card_catalog_snapshots snapshot
      cross join lateral jsonb_array_elements(snapshot.cards) as card
      where snapshot.version = p_card_catalog_version
    )
    select 1
    from deck_counts deck
    left join catalog_cards catalog on catalog.card_id = deck.card_id
    left join public.card_collections collection
      on collection.user_id = current_user_id
      and collection.card_catalog_version = p_card_catalog_version
      and collection.card_id = deck.card_id
    where catalog.card_id is null
      or catalog.collectible is false
      or deck.qty > case when catalog.rarity = 'LEGENDARY' then 1 else 2 end
      or deck.qty > coalesce(collection.quantity, 0)
  ) then
    raise exception 'Deck contains unknown, uncollectible, over-limit, or unowned cards.';
  end if;

  if p_deck_id is null then
    insert into public.decks (user_id, name, card_catalog_version, card_ids)
    values (current_user_id, clean_name, p_card_catalog_version, p_card_ids)
    returning * into deck_row;
  else
    update public.decks
    set name = clean_name,
        card_catalog_version = p_card_catalog_version,
        card_ids = p_card_ids
    where id = p_deck_id
      and user_id = current_user_id
    returning * into deck_row;

    if deck_row.id is null then
      raise exception 'Deck not found.';
    end if;
  end if;

  perform public.emit_user_event(
    current_user_id,
    'deck_saved',
    'deck',
    deck_row.id::text,
    jsonb_build_object('name', deck_row.name, 'cardCatalogVersion', deck_row.card_catalog_version, 'cardCount', array_length(deck_row.card_ids, 1))
  );

  return deck_row;
end;
$$;

create or replace function public.delete_user_deck(p_deck_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  deleted_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  delete from public.decks
  where id = p_deck_id
    and user_id = current_user_id;

  get diagnostics deleted_count = row_count;

  if deleted_count > 0 then
    perform public.emit_user_event(
      current_user_id,
      'deck_deleted',
      'deck',
      p_deck_id::text,
      '{}'::jsonb
    );
  end if;
end;
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

  if match_row.player1_user_id is not null then
    perform public.emit_user_event(
      match_row.player1_user_id,
      'match_finished',
      'match',
      match_row.id,
      jsonb_build_object('winnerSeat', match_row.winner_seat, 'resultReason', match_row.result_reason)
    );
  end if;

  if match_row.player2_user_id is not null then
    perform public.emit_user_event(
      match_row.player2_user_id,
      'match_finished',
      'match',
      match_row.id,
      jsonb_build_object('winnerSeat', match_row.winner_seat, 'resultReason', match_row.result_reason)
    );
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

  perform public.emit_user_event(
    winner_user_id,
    'pvp_win',
    'match',
    match_row.id,
    jsonb_build_object('winnerSeat', match_row.winner_seat)
  );
end;
$$;

grant select on public.cosmetic_catalog to anon, authenticated;
grant select on public.user_cosmetics to authenticated;
grant select on public.user_currency_ledger to authenticated;
grant select on public.user_login_days to authenticated;
grant select on public.user_events to authenticated;
grant select on public.quest_definitions to anon, authenticated;
grant select on public.user_quest_progress to authenticated;

grant select, insert, update, delete on public.cosmetic_catalog to service_role;
grant select, insert, update, delete on public.user_cosmetics to service_role;
grant select, insert, update, delete on public.user_currency_ledger to service_role;
grant select, insert, update, delete on public.user_login_days to service_role;
grant select, insert, update, delete on public.user_events to service_role;
grant select, insert, update, delete on public.quest_definitions to service_role;
grant select, insert, update, delete on public.user_quest_progress to service_role;

revoke all on function public.emit_user_event(uuid, text, text, text, jsonb) from public;
revoke all on function public.adjust_user_currency(uuid, text, integer, text, text, text, jsonb) from public;
revoke all on function public.grant_user_cosmetic(uuid, text, text, text, text, jsonb) from public;

grant execute on function public.emit_user_event(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.adjust_user_currency(uuid, text, integer, text, text, text, jsonb) to service_role;
grant execute on function public.grant_user_cosmetic(uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.record_daily_login() to authenticated;
grant execute on function public.select_user_cosmetic(text, text) to authenticated;
grant execute on function public.purchase_shop_item(text) to authenticated;
grant execute on function public.save_user_deck(uuid, text, text, text[]) to authenticated;
grant execute on function public.delete_user_deck(uuid) to authenticated;
grant execute on function public.record_pvp_win(text) to service_role;
