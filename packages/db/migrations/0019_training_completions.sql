-- Training first-clear rewards. Kept separate from match_history because these
-- levels are local scripted lessons, not normal server-authored matches.

create table if not exists public.user_training_completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  level_id text not null,
  completed_at timestamptz not null default now(),
  reward_gold integer not null default 0,
  primary key (user_id, level_id)
);

alter table public.user_training_completions enable row level security;

drop policy if exists "Users read their training completions" on public.user_training_completions;
create policy "Users read their training completions"
  on public.user_training_completions
  for select
  using (auth.uid() = user_id);

create or replace function public.complete_training_level(p_level_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_reward_gold integer := 0;
  v_gold_before integer := 0;
  v_gold_after integer := 0;
  v_inserted boolean := false;
  v_rows integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_level_id <> 'social_rookie' then
    raise exception 'Unknown training level: %', p_level_id;
  end if;

  select gold into v_gold_before
  from public.profiles
  where user_id = v_user_id
  for update;

  if not found then
    raise exception 'Profile not found';
  end if;

  insert into public.user_training_completions (user_id, level_id, reward_gold)
  values (v_user_id, p_level_id, 100)
  on conflict (user_id, level_id) do nothing;

  get diagnostics v_rows = row_count;
  v_inserted := v_rows > 0;

  if v_inserted then
    v_reward_gold := 100;
    update public.profiles
    set gold = gold + v_reward_gold
    where user_id = v_user_id
    returning gold into v_gold_after;
  else
    v_gold_after := v_gold_before;
  end if;

  return jsonb_build_object(
    'levelId', p_level_id,
    'firstCompletion', v_inserted,
    'rewardGold', v_reward_gold,
    'goldBefore', v_gold_before,
    'goldAfter', v_gold_after
  );
end;
$$;

revoke all on function public.complete_training_level(text) from public;
grant execute on function public.complete_training_level(text) to authenticated;
grant select on public.user_training_completions to authenticated;
