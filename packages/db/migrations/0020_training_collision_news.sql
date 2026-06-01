-- Add the second scripted training level to first-clear rewards.

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

  case p_level_id
    when 'social_rookie' then v_reward_gold := 100;
    when 'collision_news' then v_reward_gold := 100;
    else raise exception 'Unknown training level: %', p_level_id;
  end case;

  select gold into v_gold_before
  from public.profiles
  where user_id = v_user_id
  for update;

  if not found then
    raise exception 'Profile not found';
  end if;

  insert into public.user_training_completions (user_id, level_id, reward_gold)
  values (v_user_id, p_level_id, v_reward_gold)
  on conflict (user_id, level_id) do nothing;

  get diagnostics v_rows = row_count;
  v_inserted := v_rows > 0;

  if v_inserted then
    update public.profiles
    set gold = gold + v_reward_gold
    where user_id = v_user_id
    returning gold into v_gold_after;
  else
    v_reward_gold := 0;
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
