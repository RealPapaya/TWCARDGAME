-- Player progression: XP/level on profiles, per-AI defeat tracking, and the
-- post-match reward RPC. Values mirror packages/shared/src/progression.ts
-- (the TS file is the spec; the SQL helper here must stay in lockstep — there
-- is a vitest case in packages/db that asserts that).

-- ---------------------------------------------------------------------------
-- 1. Profile XP/level columns
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists xp integer not null default 0,
  add column if not exists level integer not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_xp_nonnegative') then
    alter table public.profiles
      add constraint profiles_xp_nonnegative check (xp >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_level_range') then
    alter table public.profiles
      add constraint profiles_level_range check (level between 1 and 50);
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 2. match_history.ai_theme (only set when is_vs_ai)
-- ---------------------------------------------------------------------------

alter table public.match_history
  add column if not exists ai_theme text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'match_history_ai_theme_check') then
    alter table public.match_history
      add constraint match_history_ai_theme_check
      check (ai_theme is null or ai_theme in ('dpp', 'dpp2', 'kmt', 'kmt2', 'tpp'));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 3. Per-AI defeat tracking (which (theme, difficulty) combos the user has
--    beaten at least once). Used to gate the PvE first-victory gold reward.
-- ---------------------------------------------------------------------------

create table if not exists public.user_pve_defeats (
  user_id uuid not null references auth.users(id) on delete cascade,
  ai_theme text not null check (ai_theme in ('dpp', 'dpp2', 'kmt', 'kmt2', 'tpp')),
  ai_difficulty text not null check (ai_difficulty in ('easy', 'normal', 'hard')),
  first_defeated_at timestamptz not null default now(),
  primary key (user_id, ai_theme, ai_difficulty)
);

alter table public.user_pve_defeats enable row level security;

drop policy if exists "Users read their pve defeats" on public.user_pve_defeats;
create policy "Users read their pve defeats"
on public.user_pve_defeats for select
using (auth.uid() = user_id);

-- No client-side INSERT/UPDATE/DELETE policies — only the service-role RPC
-- (apply_match_rewards) writes here.

-- ---------------------------------------------------------------------------
-- 4. XP curve helper (mirrors getXPRequiredForLevel in progression.ts)
-- ---------------------------------------------------------------------------

create or replace function public.get_xp_required_for_level(p_level integer)
returns integer
language sql
immutable
as $$
  select case
    when p_level < 1 then 0
    when p_level = 1 then 20
    when p_level <= 9  then (p_level + 1) * 10
    when p_level <= 19 then 100 + (p_level - 9) * 20
    when p_level <= 29 then 300 + (p_level - 19) * 30
    when p_level <= 39 then 600 + (p_level - 29) * 40
    when p_level <= 49 then 1000 + (p_level - 39) * 50
    else 1500
  end;
$$;

-- ---------------------------------------------------------------------------
-- 5. apply_match_rewards: atomic post-match reward grant.
--
--    Server calls this once per (user, match) at match end. Idempotency is
--    keyed on user_events('match_rewards_applied', source_id = matchId): a
--    second invocation returns the recorded summary from the audit trail
--    without granting again.
--
--    PvE XP is looked up by difficulty here (table mirrors progression.ts);
--    PvP XP is passed in by the server (calculatePvPExp depends on match
--    state).
-- ---------------------------------------------------------------------------

create or replace function public.apply_match_rewards(
  p_user_id uuid,
  p_match_id text,
  p_mode text,                       -- 'pvp' | 'pve'
  p_ai_theme text default null,      -- required when p_mode = 'pve'
  p_ai_difficulty text default null, -- required when p_mode = 'pve'
  p_pvp_xp integer default 0         -- used when p_mode = 'pvp'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.profiles%rowtype;
  already_applied boolean;
  is_first_pve_victory boolean := false;
  xp_award integer := 0;
  xp_first integer;
  xp_repeat integer;
  first_victory_gold integer := 0;
  reward_source text;
  level_current integer;
  xp_current integer;
  xp_required integer;
  level_ups jsonb := '[]'::jsonb;
  level_up_count integer := 0;
  gold_from_level_ups integer := 0;
  gold_before integer;
  gold_after integer;
  xp_before integer;
  xp_after integer;
  level_before integer;
  level_after integer;
  insert_count integer;
  metadata jsonb;
begin
  if p_user_id is null then
    raise exception 'apply_match_rewards: user_id is required';
  end if;
  if p_match_id is null then
    raise exception 'apply_match_rewards: match_id is required';
  end if;
  if p_mode not in ('pvp', 'pve') then
    raise exception 'apply_match_rewards: invalid mode %', p_mode;
  end if;
  if p_mode = 'pve' then
    if p_ai_theme is null or p_ai_difficulty is null then
      raise exception 'apply_match_rewards: pve requires ai_theme and ai_difficulty';
    end if;
    if p_ai_theme not in ('dpp', 'dpp2', 'kmt', 'kmt2', 'tpp') then
      raise exception 'apply_match_rewards: invalid ai_theme %', p_ai_theme;
    end if;
    if p_ai_difficulty not in ('easy', 'normal', 'hard') then
      raise exception 'apply_match_rewards: invalid ai_difficulty %', p_ai_difficulty;
    end if;
  end if;

  select * into profile
  from public.profiles
  where user_id = p_user_id
  for update;
  if profile.user_id is null then
    raise exception 'apply_match_rewards: profile not found for %', p_user_id;
  end if;

  -- Idempotency check after the profile lock so concurrent calls serialize.
  select exists (
    select 1 from public.user_events
    where user_id = p_user_id
      and event_type = 'match_rewards_applied'
      and source_id = p_match_id
  ) into already_applied;

  if already_applied then
    -- Reassemble a zero-delta summary from current state so the caller can
    -- still drive the animation (it animates from current → current).
    return jsonb_build_object(
      'mode', p_mode,
      'source', 'none',
      'aiTheme', p_ai_theme,
      'aiDifficulty', p_ai_difficulty,
      'xp', jsonb_build_object('before', profile.xp, 'after', profile.xp, 'gained', 0),
      'level', jsonb_build_object('before', profile.level, 'after', profile.level),
      'levelUps', '[]'::jsonb,
      'gold', jsonb_build_object(
        'before', profile.gold,
        'after', profile.gold,
        'gained', 0,
        'breakdown', '{}'::jsonb
      ),
      'idempotent', true
    );
  end if;

  -- Determine PvE first-time status atomically by attempting to insert.
  if p_mode = 'pve' then
    insert into public.user_pve_defeats (user_id, ai_theme, ai_difficulty)
    values (p_user_id, p_ai_theme, p_ai_difficulty)
    on conflict do nothing;

    get diagnostics insert_count = row_count;
    is_first_pve_victory := insert_count > 0;

    -- PvE XP table (mirrors PVE_XP in packages/shared/src/progression.ts).
    case p_ai_difficulty
      when 'easy'   then xp_first := 50;  xp_repeat := 8;
      when 'normal' then xp_first := 100; xp_repeat := 14;
      when 'hard'   then xp_first := 150; xp_repeat := 25;
    end case;

    if is_first_pve_victory then
      xp_award := xp_first;
      reward_source := 'pve_first';
      first_victory_gold := case p_ai_difficulty
        when 'easy'   then 100
        when 'normal' then 200
        when 'hard'   then 300
      end;
    else
      xp_award := xp_repeat;
      reward_source := 'pve_repeat';
      first_victory_gold := 0;
    end if;
  else
    -- PvP: server precomputed the XP value via calculatePvPExp.
    xp_award := greatest(0, coalesce(p_pvp_xp, 0));
    reward_source := 'pvp';
  end if;

  -- Apply XP and walk the level curve.
  xp_before := profile.xp;
  level_before := profile.level;
  gold_before := profile.gold;
  xp_current := profile.xp + xp_award;
  level_current := profile.level;

  while level_current < 50 loop
    xp_required := public.get_xp_required_for_level(level_current);
    exit when xp_current < xp_required;
    xp_current := xp_current - xp_required;
    level_current := level_current + 1;
    level_ups := level_ups || jsonb_build_object('level', level_current, 'goldAwarded', 100);
    level_up_count := level_up_count + 1;
  end loop;

  if level_current >= 50 then
    xp_current := 0;
  end if;

  xp_after := xp_current;
  level_after := level_current;

  update public.profiles
  set xp = xp_after,
      level = level_after
  where user_id = p_user_id;

  -- Grant gold via the existing audit-tracked function. The first-victory
  -- gold and each level-up are separate ledger rows per user preference.
  if first_victory_gold > 0 then
    perform public.adjust_user_currency(
      p_user_id,
      'gold',
      first_victory_gold,
      'pve_first_victory',
      'match',
      p_match_id,
      jsonb_build_object('aiTheme', p_ai_theme, 'aiDifficulty', p_ai_difficulty)
    );
  end if;

  if level_up_count > 0 then
    -- Issue one ledger row per level gained, one event per level-up.
    for i in 1..level_up_count loop
      perform public.adjust_user_currency(
        p_user_id,
        'gold',
        100,
        'level_up',
        'match',
        p_match_id,
        jsonb_build_object('level', level_before + i)
      );
      perform public.emit_user_event(
        p_user_id,
        'level_up',
        'match',
        p_match_id,
        jsonb_build_object('level', level_before + i)
      );
    end loop;
    gold_from_level_ups := level_up_count * 100;
  end if;

  gold_after := gold_before + first_victory_gold + gold_from_level_ups;

  -- One umbrella event records the XP grant and serves as the idempotency
  -- guard for re-invocation.
  metadata := jsonb_build_object(
    'mode', p_mode,
    'aiTheme', p_ai_theme,
    'aiDifficulty', p_ai_difficulty,
    'xpAward', xp_award,
    'levelBefore', level_before,
    'levelAfter', level_after,
    'levelUps', level_up_count
  );

  perform public.emit_user_event(
    p_user_id,
    'match_xp_gained',
    'match',
    p_match_id,
    metadata
  );

  perform public.emit_user_event(
    p_user_id,
    'match_rewards_applied',
    'match',
    p_match_id,
    metadata
  );

  return jsonb_build_object(
    'mode', p_mode,
    'source', reward_source,
    'aiTheme', p_ai_theme,
    'aiDifficulty', p_ai_difficulty,
    'xp', jsonb_build_object('before', xp_before, 'after', xp_after, 'gained', xp_award),
    'level', jsonb_build_object('before', level_before, 'after', level_after),
    'levelUps', level_ups,
    'gold', jsonb_build_object(
      'before', gold_before,
      'after', gold_after,
      'gained', first_victory_gold + gold_from_level_ups,
      'breakdown', jsonb_strip_nulls(jsonb_build_object(
        'firstVictory', nullif(first_victory_gold, 0),
        'levelUps', nullif(gold_from_level_ups, 0)
      ))
    ),
    'idempotent', false
  );
end;
$$;

grant execute on function public.apply_match_rewards(uuid, text, text, text, text, integer) to service_role;
