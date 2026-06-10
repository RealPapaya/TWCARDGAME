-- Leaderboard: surface the real XP-based progression level.
--
-- `profiles.level` / `profiles.xp` were added in 0012, but get_leaderboard
-- (defined in 0005) was never updated to return them. The client therefore had
-- no real level to show and fell back to deriving one from win count, so every
-- player rendered as Lv.1. Return the actual level/xp here.
--
-- The TABLE return type changes, so the function must be dropped and recreated
-- (CREATE OR REPLACE cannot change a function's return type).

drop function if exists public.get_leaderboard(integer);

create function public.get_leaderboard(p_limit integer default 50)
returns table (
  rank integer,
  user_id uuid,
  display_name text,
  avatar_url text,
  wins_count integer,
  level integer,
  xp integer
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
    p.wins_count,
    p.level,
    p.xp
  from public.profiles p
  order by p.wins_count desc, p.display_name asc
  limit greatest(coalesce(p_limit, 50), 1);
$$;

grant execute on function public.get_leaderboard(integer) to anon, authenticated;
