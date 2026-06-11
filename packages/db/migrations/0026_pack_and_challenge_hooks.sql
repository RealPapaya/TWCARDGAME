-- 0026_pack_and_challenge_hooks.sql
--
-- READY detection hooks for two systems whose gameplay does NOT exist yet:
--   * 打開X個卡包 (card packs / gacha)
--   * 擊敗挑戰模式特定關卡特定等級 (challenge mode stages)
--
-- The full gameplay (pull tables, pack costs, stage maps, rewards, UI) is a
-- product decision and out of scope here. What IS ready: a single named,
-- server-authoritative entrypoint per system that emits the correct quest
-- event_type(s). When the pack-opening / challenge-clear flow is built, it calls
-- these and the matching achievements/quests start tracking with no further
-- code. Both are service_role-only, like the other progress writers.

-- record_pack_opened: call once per pack opened (p_count packs in one action).
-- Card grants themselves should go through the normal collection writers +
-- refresh_collection_quests (see 0025); this only records the "opened a pack"
-- progress for `pack_opened` quests.
create or replace function public.record_pack_opened(
  p_user_id uuid,
  p_count integer default 1,
  p_pack_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.emit_user_progress_event(
    p_user_id, 'pack_opened', greatest(coalesce(p_count, 1), 1),
    'pack', p_pack_id, jsonb_build_object('packId', p_pack_id, 'count', coalesce(p_count, 1))
  );
end;
$$;

revoke all on function public.record_pack_opened(uuid, integer, text) from public;
grant execute on function public.record_pack_opened(uuid, integer, text) to service_role;

-- record_challenge_win: call when a challenge stage/level is cleared. Emits the
-- plain `challenge_win` (for "通關挑戰X次" quests) AND the qualified
-- `challenge_win:<stage>:<level>` (for "通關特定關卡特定等級X次" quests), so an
-- achievement can target either granularity.
create or replace function public.record_challenge_win(
  p_user_id uuid,
  p_stage text,
  p_level text,
  p_source_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta jsonb := jsonb_build_object('stage', p_stage, 'level', p_level);
begin
  perform public.emit_user_progress_event(
    p_user_id, 'challenge_win', 1, 'challenge', p_source_id, v_meta
  );
  perform public.emit_user_progress_event(
    p_user_id, 'challenge_win:' || coalesce(p_stage, '') || ':' || coalesce(p_level, ''), 1,
    'challenge', p_source_id, v_meta
  );
end;
$$;

revoke all on function public.record_challenge_win(uuid, text, text, text) from public;
grant execute on function public.record_challenge_win(uuid, text, text, text) to service_role;
