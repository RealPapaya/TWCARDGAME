-- Drop the stale 6-arg apply_match_rewards overload left behind by 0012.
--
-- Migration 0027 intended to extend apply_match_rewards with PvP gold, but it
-- declared a DIFFERENT signature — adding p_pvp_gold made it a 7-arg function:
--
--   0012: apply_match_rewards(uuid, text, text, text, text, integer)            -- no PvP gold
--   0027: apply_match_rewards(uuid, text, text, text, text, integer, integer)   -- with PvP gold
--
-- `create or replace` only replaces a function of the SAME signature, so 0027
-- created a second overload instead of replacing the first. Both now coexist.
-- The db client (packages/db/src/index.ts) always sends all 7 named params, so
-- PostgREST resolves to the 7-arg version — but the dead 6-arg version is a
-- footgun: any caller that omits p_pvp_gold silently grants ZERO PvP gold, and
-- overload ambiguity is a class of bug that's painful to diagnose in production.
--
-- This migration removes the stale overload so only the PvP-aware 7-arg function
-- remains. Idempotent: guarded by a pg_proc lookup on the exact arg types.

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'apply_match_rewards'
      and pg_get_function_identity_arguments(p.oid)
          = 'p_user_id uuid, p_match_id text, p_mode text, p_ai_theme text, p_ai_difficulty text, p_pvp_xp integer'
  ) then
    drop function public.apply_match_rewards(uuid, text, text, text, text, integer);
  end if;
end;
$$;
