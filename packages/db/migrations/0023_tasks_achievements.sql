-- 0023_tasks_achievements.sql
--
-- Activates the dormant quest scaffolding from 0007 into a server-authoritative
-- task (daily) / achievement (once) system.
--
-- Anti-cheat invariants preserved from 0007:
--   * Quest progress is written ONLY by emit_user_event / emit_user_progress_event,
--     which are SECURITY DEFINER and granted to service_role only — clients cannot
--     advance their own progress.
--   * Reward currency is granted ONLY through adjust_user_currency (service_role).
--   * claim_quest_reward is the single client-callable entrypoint (auth.uid()),
--     reads the reward amount from quest_definitions (never from client input), and
--     guards against double-claiming with an atomic claimed_at check.
--
-- New here:
--   * recurrence on quest_definitions ('once' | 'daily' | 'weekly')
--   * period_key on user_quest_progress (PK gains the period dimension) so daily
--     tasks reset on the Asia/Taipei server clock without losing claimed history.
--   * quest_period_key() + emit_user_progress_event() (increment-by-N).
--   * claim_quest_reward() and a starter set of seeded quests.

-- ---------------------------------------------------------------------------
-- (a) Schema: recurrence + period_key
-- ---------------------------------------------------------------------------

alter table public.quest_definitions
  add column if not exists recurrence text not null default 'once';

alter table public.quest_definitions
  drop constraint if exists quest_definitions_recurrence_check;
alter table public.quest_definitions
  add constraint quest_definitions_recurrence_check
  check (recurrence in ('once', 'daily', 'weekly'));

alter table public.user_quest_progress
  add column if not exists period_key text not null default '';

-- The progress PK gains the period dimension. 'once' quests keep period_key = ''
-- (one forever-row, identical to pre-0023 behavior); 'daily'/'weekly' get a fresh
-- row per Taipei period, so yesterday's claimed row is never reset.
alter table public.user_quest_progress
  drop constraint if exists user_quest_progress_pkey;
alter table public.user_quest_progress
  add constraint user_quest_progress_pkey primary key (user_id, quest_id, period_key);

create index if not exists user_quest_progress_user_period_idx
  on public.user_quest_progress (user_id, period_key);

-- ---------------------------------------------------------------------------
-- (b) Period-key helper + increment-by-N progress engine
-- ---------------------------------------------------------------------------

-- Computes the period bucket for a quest. Derived from the DB server clock in
-- Asia/Taipei so a client cannot shift its day boundary.
create or replace function public.quest_period_key(p_recurrence text)
returns text
language sql
stable
set search_path = public
as $$
  select case p_recurrence
    when 'daily' then to_char((now() at time zone 'Asia/Taipei')::date, 'YYYY-MM-DD')
    when 'weekly' then to_char((now() at time zone 'Asia/Taipei')::date, 'IYYY-"W"IW')
    else ''
  end;
$$;

-- Records a user_event AND advances every matching active quest by p_amount,
-- bucketed by the quest's current period_key. This is the canonical writer;
-- emit_user_event delegates to it with amount = 1 (signature unchanged so all
-- existing callers keep working).
create or replace function public.emit_user_progress_event(
  p_user_id uuid,
  p_event_type text,
  p_amount integer default 1,
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
  v_amount integer := greatest(coalesce(p_amount, 1), 0);
begin
  insert into public.user_events (user_id, event_type, source_type, source_id, metadata)
  values (p_user_id, p_event_type, p_source_type, p_source_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into event_id;

  if v_amount > 0 then
    insert into public.user_quest_progress (user_id, quest_id, period_key, current_count, completed_at)
    select
      p_user_id,
      q.id,
      public.quest_period_key(q.recurrence),
      least(q.target_count, v_amount),
      case when v_amount >= q.target_count then now() else null end
    from public.quest_definitions q
    where q.active
      and q.event_type = p_event_type
      and (q.starts_at is null or q.starts_at <= now())
      and (q.ends_at is null or q.ends_at > now())
    on conflict (user_id, quest_id, period_key) do update
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
  end if;

  return event_id;
end;
$$;

-- Backward-compatible: same (uuid, text, text, text, jsonb) signature, now a thin
-- wrapper. CREATE OR REPLACE preserves the existing service_role grant from 0007.
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
begin
  return public.emit_user_progress_event(p_user_id, p_event_type, 1, p_source_type, p_source_id, p_metadata);
end;
$$;

-- ---------------------------------------------------------------------------
-- (c) Claim RPC — the only client-callable reward path
-- ---------------------------------------------------------------------------

create or replace function public.claim_quest_reward(p_quest_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  q public.quest_definitions%rowtype;
  v_period text;
  prog public.user_quest_progress%rowtype;
  v_reward_gold integer;
  v_gold_before integer;
  v_gold_after integer;
begin
  if v_user is null then
    raise exception 'Authentication required.';
  end if;

  select * into q from public.quest_definitions where id = p_quest_id and active;
  if q.id is null then
    raise exception 'Quest % is not available.', p_quest_id;
  end if;

  v_period := public.quest_period_key(q.recurrence);

  select * into prog from public.user_quest_progress
  where user_id = v_user and quest_id = p_quest_id and period_key = v_period
  for update;

  if prog.user_id is null or prog.completed_at is null then
    raise exception 'Quest % is not completed.', p_quest_id;
  end if;
  if prog.claimed_at is not null then
    raise exception 'Quest % already claimed.', p_quest_id;
  end if;

  v_reward_gold := coalesce((q.reward->>'gold')::integer, 0);

  select gold into v_gold_before from public.profiles where user_id = v_user for update;
  v_gold_after := v_gold_before;

  if v_reward_gold > 0 then
    v_gold_after := public.adjust_user_currency(
      v_user, 'gold', v_reward_gold, 'quest_reward', 'quest', p_quest_id,
      jsonb_build_object('questId', p_quest_id, 'periodKey', v_period)
    );
  end if;

  update public.user_quest_progress
  set claimed_at = now(), updated_at = now()
  where user_id = v_user and quest_id = p_quest_id and period_key = v_period;

  perform public.emit_user_event(
    v_user, 'quest_claimed', 'quest', p_quest_id,
    jsonb_build_object('questId', p_quest_id, 'periodKey', v_period, 'gold', v_reward_gold)
  );

  return jsonb_build_object(
    'questId', p_quest_id,
    'periodKey', v_period,
    'reward', q.reward,
    'goldGranted', v_reward_gold,
    'goldBefore', v_gold_before,
    'goldAfter', v_gold_after
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- (d) Seed starter quests (idempotent)
-- ---------------------------------------------------------------------------

insert into public.quest_definitions
  (id, display_name, description, event_type, target_count, recurrence, reward, active)
values
  ('ach_first_pve_win',   '已知用火', '首次擊敗電腦對手',     'pve_win',          1,  'once',  '{"gold":100}'::jsonb, true),
  ('ach_first_pvp_win',   '第一滴血', '首次在玩家對戰中獲勝', 'pvp_win',          1,  'once',  '{"gold":100}'::jsonb, true),
  ('ach_reach_level_5',   '初生之犢', '達到等級 5',           'level_up',         4,  'once',  '{"gold":100}'::jsonb, true),
  ('ach_reach_level_10',  '進入狀況', '達到等級 10',          'level_up',         9,  'once',  '{"gold":200}'::jsonb, true),
  ('ach_win_10_total',    '十全大補湯', '累積獲勝 10 場',       'match_won',        10, 'once',  '{"gold":250}'::jsonb, true),
  ('ach_collect_5_cards', '收藏家',   '獲得 50 張卡牌',        'card_acquired',    50,  'once',  '{"gold":100}'::jsonb, true),
  ('daily_login',         '每日簽到', '今日登入遊戲',         'daily_login',      1,  'daily', '{"gold":15}'::jsonb,  true),
  ('daily_play_1',        '沒贏也沒關係', '今日進行 1 場對戰',    'match_played',     1,  'daily', '{"gold":30}'::jsonb,  true),
  ('daily_play_3',        '我們必須更深入一點', '今日進行 3 場對戰',    'match_played',     3,  'daily', '{"gold":50}'::jsonb,  true),
  ('daily_win_1',         '每日首勝', '今日獲勝 1 場',        'match_won',        1,  'daily', '{"gold":50}'::jsonb,  true),
  ('daily_play_10_cards', '劉謙', '今日出 20 張牌',       'cards_played',     20, 'daily', '{"gold":40}'::jsonb,  true),
  ('daily_summon_5',      '放置Play', '今日召喚 15 個單位',    'minions_summoned', 15,  'daily', '{"gold":40}'::jsonb,  true),
  ('daily_deal_30_dmg',   '說好的別打臉', '今日對敵方英雄造成 30 傷害', 'damage_dealt', 30, 'daily', '{"gold":40}'::jsonb, true)
on conflict (id) do update
  set display_name = excluded.display_name,
      description  = excluded.description,
      event_type   = excluded.event_type,
      target_count = excluded.target_count,
      recurrence   = excluded.recurrence,
      reward       = excluded.reward,
      active       = excluded.active,
      updated_at   = now();

-- ---------------------------------------------------------------------------
-- Grants — clients may only call claim_quest_reward; progress writers stay
-- service_role-only (emit_user_event grant carried over from 0007).
-- ---------------------------------------------------------------------------

revoke all on function public.emit_user_progress_event(uuid, text, integer, text, text, jsonb) from public;
grant execute on function public.emit_user_progress_event(uuid, text, integer, text, text, jsonb) to service_role;

revoke all on function public.claim_quest_reward(text) from public;
grant execute on function public.claim_quest_reward(text) to authenticated;
