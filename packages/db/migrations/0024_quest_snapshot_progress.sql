-- 0024_quest_snapshot_progress.sql
--
-- Adds a SNAPSHOT progress mode alongside the cumulative
-- emit_user_progress_event from 0023.
--
-- Cumulative (existing): current_count += amount. For counting occurrences
--   over time (damage dealt, packs opened, matches lost…).
-- Snapshot (new here):   current_count = max(existing, least(target, value)).
--   For "own X" thresholds (friends owned, distinct card types, copies of a
--   card) where the caller reports the CURRENT total, not a delta. Uses a
--   high-watermark so a later drop (e.g. disenchanting a card) never reduces a
--   quest's progress or un-completes it.
--
-- Anti-cheat invariants from 0023 are preserved: this writer is SECURITY
-- DEFINER + service_role-only, so clients cannot advance their own progress.

create or replace function public.emit_user_progress_snapshot(
  p_user_id uuid,
  p_event_type text,
  p_value integer default 0,
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
  v_value integer := greatest(coalesce(p_value, 0), 0);
begin
  -- Always record the event (a snapshot of 0 is still meaningful history).
  insert into public.user_events (user_id, event_type, source_type, source_id, metadata)
  values (p_user_id, p_event_type, p_source_type, p_source_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into event_id;

  insert into public.user_quest_progress (user_id, quest_id, period_key, current_count, completed_at)
  select
    p_user_id,
    q.id,
    public.quest_period_key(q.recurrence),
    least(q.target_count, v_value),
    case when v_value >= q.target_count then now() else null end
  from public.quest_definitions q
  where q.active
    and q.event_type = p_event_type
    and (q.starts_at is null or q.starts_at <= now())
    and (q.ends_at is null or q.ends_at > now())
  on conflict (user_id, quest_id, period_key) do update
    set current_count = greatest(
          public.user_quest_progress.current_count,
          least(
            (select target_count from public.quest_definitions where id = excluded.quest_id),
            excluded.current_count
          )
        ),
        completed_at = case
          when public.user_quest_progress.completed_at is not null then public.user_quest_progress.completed_at
          when greatest(public.user_quest_progress.current_count, excluded.current_count) >=
            (select target_count from public.quest_definitions where id = excluded.quest_id)
          then now()
          else null
        end,
        updated_at = now();

  return event_id;
end;
$$;

-- Grants — snapshot writer stays service_role-only, mirroring 0023's cumulative
-- writer. Clients still only reach progress through claim_quest_reward.
revoke all on function public.emit_user_progress_snapshot(uuid, text, integer, text, text, jsonb) from public;
grant execute on function public.emit_user_progress_snapshot(uuid, text, integer, text, text, jsonb) to service_role;
