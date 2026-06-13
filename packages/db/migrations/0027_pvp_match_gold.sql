-- PvP match gold: winner gets 2× computed gold; loser gets floor(winner/3).
-- The server pre-computes both values via calculatePvPGold in progression.ts
-- and passes them as p_pvp_gold. This migration extends apply_match_rewards
-- to accept and grant that pre-computed gold for PvP matches.
--
-- For PvE matches p_pvp_gold is ignored (always 0). PvE gold comes from
-- first-victory grants (unchanged).
--
-- The breakdown field 'matchWin' is mirrored in RewardSummary.gold.breakdown.

create or replace function public.apply_match_rewards(
  p_user_id uuid,
  p_match_id text,
  p_mode text,
  p_ai_theme text default null,
  p_ai_difficulty text default null,
  p_pvp_xp integer default 0,
  p_pvp_gold integer default 0
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
  match_win_gold integer := 0;
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

  if p_mode = 'pve' then
    insert into public.user_pve_defeats (user_id, ai_theme, ai_difficulty)
    values (p_user_id, p_ai_theme, p_ai_difficulty)
    on conflict do nothing;

    get diagnostics insert_count = row_count;
    is_first_pve_victory := insert_count > 0;

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
    xp_award := greatest(0, coalesce(p_pvp_xp, 0));
    match_win_gold := greatest(0, coalesce(p_pvp_gold, 0));
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

  -- Grant match-win gold (PvP, winner or loser share).
  if match_win_gold > 0 then
    perform public.adjust_user_currency(
      p_user_id,
      'gold',
      match_win_gold,
      'pvp_match',
      'match',
      p_match_id,
      jsonb_build_object('pvpGold', match_win_gold)
    );
  end if;

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

  gold_after := gold_before + match_win_gold + first_victory_gold + gold_from_level_ups;

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
      'gained', match_win_gold + first_victory_gold + gold_from_level_ups,
      'breakdown', jsonb_strip_nulls(jsonb_build_object(
        'matchWin', nullif(match_win_gold, 0),
        'firstVictory', nullif(first_victory_gold, 0),
        'levelUps', nullif(gold_from_level_ups, 0)
      ))
    ),
    'idempotent', false
  );
end;
$$;

grant execute on function public.apply_match_rewards(uuid, text, text, text, text, integer, integer) to service_role;
