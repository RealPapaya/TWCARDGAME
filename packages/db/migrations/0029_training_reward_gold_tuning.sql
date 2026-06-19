-- Tune scripted training first-clear gold rewards.

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
  v_target_version text;
  v_reward_card_id text;
  v_reward_card_rarity text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  case p_level_id
    when 'social_rookie' then v_reward_gold := 100;
    when 'collision_news' then v_reward_gold := 150;
    when 'card_types' then v_reward_gold := 150;
    when 'advanced_keywords' then v_reward_gold := 200;
    when 'amp_field' then v_reward_gold := 200;
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

    if p_level_id = 'amp_field' then
      select version into v_target_version
      from public.card_catalog_snapshots
      order by created_at desc
      limit 1;

      if v_target_version is not null then
        select card->>'id', card->>'rarity'
        into v_reward_card_id, v_reward_card_rarity
        from unnest(array['TW020','TW046','TW011','TW038','TW032']::text[]) as pool(card_id)
        join public.card_catalog_snapshots snapshot on snapshot.version = v_target_version
        cross join lateral jsonb_array_elements(snapshot.cards) as card
        where card->>'id' = pool.card_id
          and card->>'rarity' = 'LEGENDARY'
          and coalesce((card->>'collectible')::boolean, true)
        order by random()
        limit 1;

        if v_reward_card_id is not null then
          insert into public.card_collections (user_id, card_catalog_version, card_id, quantity)
          values (v_user_id, v_target_version, v_reward_card_id, 1)
          on conflict (user_id, card_catalog_version, card_id) do update
            set quantity = public.card_collections.quantity + 1;

          perform public.emit_user_event(
            v_user_id,
            'card_acquired',
            'training',
            p_level_id,
            jsonb_build_object('cardId', v_reward_card_id, 'catalogVersion', v_target_version, 'rarity', v_reward_card_rarity)
          );

          perform public.refresh_collection_quests(v_user_id, array[v_reward_card_id]);
        end if;
      end if;
    end if;
  else
    v_reward_gold := 0;
    v_gold_after := v_gold_before;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'levelId', p_level_id,
    'firstCompletion', v_inserted,
    'rewardGold', v_reward_gold,
    'goldBefore', v_gold_before,
    'goldAfter', v_gold_after,
    'cardReward', case
      when v_reward_card_id is null then null
      else jsonb_build_object('type', 'card', 'cardId', v_reward_card_id)
    end
  ));
end;
$$;

revoke all on function public.complete_training_level(text) from public;
grant execute on function public.complete_training_level(text) to authenticated;
