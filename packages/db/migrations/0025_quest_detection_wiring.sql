-- 0025_quest_detection_wiring.sql
--
-- Wires server-authoritative quest detection into the EXISTING economy / social
-- systems so the new event types from 0024's registry actually fire. No new
-- gameplay is introduced here — each change adds an emit_user_progress_event /
-- emit_user_progress_snapshot call to a function that already mutates state.
--
-- Detection added:
--   gold_spent              — any gold debit (central, in adjust_user_currency)
--   voucher_gained          — any voucher credit (central, in adjust_user_currency)
--   card_disenchanted       — disenchant_card
--   collection_types_owned  — snapshot of distinct owned types (collection writers)
--   card_copies_owned:<id>  — snapshot of a card's quantity (collection writers)
--   title_acquired/avatar_acquired — grant_user_cosmetic
--   friends_owned           — snapshot of friend count (accept_friend_request)
--
-- All callers below are SECURITY DEFINER (run as the function owner), so they may
-- invoke the service_role-only emit_user_progress_* writers, exactly as
-- select_user_cosmetic already calls emit_user_event.

-- ---------------------------------------------------------------------------
-- (a) Collection snapshot helper
-- ---------------------------------------------------------------------------

-- Re-emits "own X" snapshots for a user's collection. Pass the card ids that
-- changed so only their per-card copy-count quests are refreshed; the distinct
-- type count is always refreshed.
create or replace function public.refresh_collection_quests(
  p_user_id uuid,
  p_card_ids text[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_types integer;
  cid text;
  v_qty integer;
begin
  select count(distinct card_id)::integer into v_types
  from public.card_collections
  where user_id = p_user_id and quantity > 0;

  perform public.emit_user_progress_snapshot(
    p_user_id, 'collection_types_owned', coalesce(v_types, 0), 'collection', null, '{}'::jsonb
  );

  if p_card_ids is not null then
    foreach cid in array p_card_ids loop
      select coalesce(sum(quantity), 0)::integer into v_qty
      from public.card_collections
      where user_id = p_user_id and card_id = cid;

      perform public.emit_user_progress_snapshot(
        p_user_id, 'card_copies_owned:' || cid, coalesce(v_qty, 0),
        'collection', cid, jsonb_build_object('cardId', cid)
      );
    end loop;
  end if;
end;
$$;

revoke all on function public.refresh_collection_quests(uuid, text[]) from public;
grant execute on function public.refresh_collection_quests(uuid, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- (b) Central gold_spent / voucher_gained — adjust_user_currency
--     (body identical to 0007, plus the two emits before RETURN)
-- ---------------------------------------------------------------------------

create or replace function public.adjust_user_currency(
  p_user_id uuid,
  p_currency text,
  p_delta integer,
  p_reason text,
  p_source_type text default null,
  p_source_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.profiles%rowtype;
  new_balance integer;
begin
  if p_currency not in ('gold', 'voucher') then
    raise exception 'Unsupported currency %.', p_currency;
  end if;

  if p_delta = 0 then
    raise exception 'Currency delta must not be zero.';
  end if;

  select * into profile
  from public.profiles
  where user_id = p_user_id
  for update;

  if profile.user_id is null then
    raise exception 'Profile not found.';
  end if;

  if p_currency = 'gold' then
    new_balance := profile.gold + p_delta;
    if new_balance < 0 then
      raise exception 'Not enough gold.';
    end if;

    update public.profiles
    set gold = new_balance
    where user_id = p_user_id;
  else
    new_balance := profile.vouchers + p_delta;
    if new_balance < 0 then
      raise exception 'Not enough vouchers.';
    end if;

    update public.profiles
    set vouchers = new_balance
    where user_id = p_user_id;
  end if;

  insert into public.user_currency_ledger (
    user_id,
    currency,
    delta,
    balance_after,
    reason,
    source_type,
    source_id,
    metadata
  )
  values (
    p_user_id,
    p_currency,
    p_delta,
    new_balance,
    p_reason,
    p_source_type,
    p_source_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  perform public.emit_user_event(
    p_user_id,
    'currency_changed',
    p_source_type,
    p_source_id,
    jsonb_build_object('currency', p_currency, 'delta', p_delta, 'balanceAfter', new_balance, 'reason', p_reason)
      || coalesce(p_metadata, '{}'::jsonb)
  );

  -- Quest detection: 累積消費金幣 (gold debits) and 獲得消費券 (voucher credits).
  if p_currency = 'gold' and p_delta < 0 then
    perform public.emit_user_progress_event(
      p_user_id, 'gold_spent', -p_delta, p_source_type, p_source_id, jsonb_build_object('reason', p_reason)
    );
  elsif p_currency = 'voucher' and p_delta > 0 then
    perform public.emit_user_progress_event(
      p_user_id, 'voucher_gained', p_delta, p_source_type, p_source_id, jsonb_build_object('reason', p_reason)
    );
  end if;

  return new_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- (c) craft_card — refresh collection snapshots after acquiring a copy
--     (body identical to 0010, plus the refresh call)
-- ---------------------------------------------------------------------------

create or replace function public.craft_card(p_card_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_version text;
  card_rarity text;
  collectible boolean;
  cost integer;
  new_balance integer;
  new_quantity integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select version into target_version
  from public.card_catalog_snapshots
  order by created_at desc
  limit 1;

  if target_version is null then
    raise exception 'No card catalog snapshot has been published.';
  end if;

  select card->>'rarity', coalesce((card->>'collectible')::boolean, true)
  into card_rarity, collectible
  from public.card_catalog_snapshots snapshot
  cross join lateral jsonb_array_elements(snapshot.cards) as card
  where snapshot.version = target_version
    and card->>'id' = p_card_id;

  if card_rarity is null then
    raise exception 'Unknown card id %.', p_card_id;
  end if;

  if not collectible then
    raise exception 'Card % cannot be crafted.', p_card_id;
  end if;

  cost := public.card_voucher_rate(card_rarity, 'craft');

  new_balance := public.adjust_user_currency(
    current_user_id,
    'voucher',
    -cost,
    'card_craft',
    'card',
    p_card_id,
    jsonb_build_object('rarity', card_rarity)
  );

  insert into public.card_collections (user_id, card_catalog_version, card_id, quantity)
  values (current_user_id, target_version, p_card_id, 1)
  on conflict (user_id, card_catalog_version, card_id) do update
    set quantity = public.card_collections.quantity + 1
  returning quantity into new_quantity;

  perform public.emit_user_event(
    current_user_id,
    'card_acquired',
    'card_craft',
    p_card_id,
    jsonb_build_object('cardId', p_card_id, 'catalogVersion', target_version, 'rarity', card_rarity)
  );

  -- Quest detection: 擁有卡牌種類 / 擁有特定卡牌張數 snapshots.
  perform public.refresh_collection_quests(current_user_id, array[p_card_id]);

  return jsonb_build_object(
    'cardId', p_card_id,
    'voucherCost', cost,
    'quantity', new_quantity,
    'vouchers', new_balance
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- (d) disenchant_card — emit card_disenchanted + refresh snapshots
--     (body identical to 0016, plus the two calls)
-- ---------------------------------------------------------------------------

create or replace function public.disenchant_card(p_card_id text, p_count integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_version text;
  card_rarity text;
  owned integer;
  rate integer;
  total integer;
  new_balance integer;
  remaining integer;
  consume integer;
  collection_row record;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_count is null or p_count < 1 then
    raise exception 'Disenchant count must be at least 1.';
  end if;

  select version into target_version
  from public.card_catalog_snapshots
  order by created_at desc
  limit 1;

  if target_version is null then
    raise exception 'No card catalog snapshot has been published.';
  end if;

  select card->>'rarity' into card_rarity
  from public.card_catalog_snapshots snapshot
  cross join lateral jsonb_array_elements(snapshot.cards) as card
  where snapshot.version = target_version
    and card->>'id' = p_card_id;

  if card_rarity is null then
    raise exception 'Unknown card id %.', p_card_id;
  end if;

  select coalesce(sum(quantity), 0)::integer into owned
  from (
    select quantity
    from public.card_collections
    where user_id = current_user_id
      and card_id = p_card_id
    for update
  ) locked_collection;

  if owned < p_count then
    raise exception 'Not enough copies to disenchant.';
  end if;

  remaining := p_count;
  for collection_row in
    select card_catalog_version, quantity
    from public.card_collections
    where user_id = current_user_id
      and card_id = p_card_id
      and quantity > 0
    order by acquired_at desc, card_catalog_version desc
    for update
  loop
    consume := least(remaining, collection_row.quantity);
    update public.card_collections
    set quantity = quantity - consume
    where user_id = current_user_id
      and card_catalog_version = collection_row.card_catalog_version
      and card_id = p_card_id;

    remaining := remaining - consume;
    exit when remaining = 0;
  end loop;

  rate := public.card_voucher_rate(card_rarity, 'disenchant');
  total := rate * p_count;

  -- adjust_user_currency now emits voucher_gained for this credit (see (b)).
  new_balance := public.adjust_user_currency(
    current_user_id,
    'voucher',
    total,
    'card_disenchant',
    'card',
    p_card_id,
    jsonb_build_object('rarity', card_rarity, 'count', p_count)
  );

  -- Quest detection: 分解卡片 + refresh collection snapshots (count went down).
  perform public.emit_user_progress_event(
    current_user_id, 'card_disenchanted', p_count, 'card', p_card_id,
    jsonb_build_object('rarity', card_rarity, 'count', p_count)
  );
  perform public.refresh_collection_quests(current_user_id, array[p_card_id]);

  return jsonb_build_object(
    'cardId', p_card_id,
    'voucherGain', total,
    'remainingQuantity', owned - p_count,
    'vouchers', new_balance
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- (e) ensure_starter_collection — refresh snapshots after the grant
--     (body identical to 0016, plus the refresh call)
-- ---------------------------------------------------------------------------

create or replace function public.ensure_starter_collection()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  latest_catalog_version text;
  starter_pack_card_ids text[] := array[
    'TW001','TW003','TW004','TW005','TW006','TW007','TW008','TW012',
    'TW013','TW017','TW027','TW028','TW030','TW053','TW068',
    'S006','S009','S016','S022','S026'
  ];
  cid text;
  owned integer;
  missing integer;
  granted integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select version into latest_catalog_version
  from public.card_catalog_snapshots
  order by created_at desc
  limit 1;

  if latest_catalog_version is null then
    return 0;
  end if;

  foreach cid in array starter_pack_card_ids loop
    select coalesce(sum(quantity), 0)::integer into owned
    from public.card_collections
    where user_id = current_user_id
      and card_id = cid;

    missing := greatest(0, 2 - owned);

    if missing > 0 then
      insert into public.card_collections (user_id, card_catalog_version, card_id, quantity)
      select current_user_id, latest_catalog_version, cid, missing
      where exists (
        select 1
        from public.card_catalog_snapshots s
        cross join lateral jsonb_array_elements(s.cards) as card
        where s.version = latest_catalog_version
          and card->>'id' = cid
          and coalesce((card->>'collectible')::boolean, true)
      )
      on conflict (user_id, card_catalog_version, card_id)
        do update set quantity = public.card_collections.quantity + excluded.quantity;

      if found then
        granted := granted + 1;
      end if;
    end if;
  end loop;

  -- Quest detection: keep collection snapshots in sync with the granted cards.
  perform public.refresh_collection_quests(current_user_id, starter_pack_card_ids);

  return granted;
end;
$$;

-- ---------------------------------------------------------------------------
-- (f) grant_user_cosmetic — emit title_acquired / avatar_acquired
--     (body identical to 0007, plus the kind-specific emit)
-- ---------------------------------------------------------------------------

create or replace function public.grant_user_cosmetic(
  p_user_id uuid,
  p_kind text,
  p_cosmetic_id text,
  p_source_type text default null,
  p_source_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  if not exists (
    select 1
    from public.cosmetic_catalog
    where kind = p_kind
      and id = p_cosmetic_id
      and active
  ) then
    raise exception 'Cosmetic %.% is not available.', p_kind, p_cosmetic_id;
  end if;

  insert into public.user_cosmetics (user_id, kind, cosmetic_id, source, metadata)
  values (p_user_id, p_kind, p_cosmetic_id, p_source_type, coalesce(p_metadata, '{}'::jsonb))
  on conflict do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count > 0 then
    if p_kind = 'avatar' then
      update public.profiles
      set owned_avatars = case
            when p_cosmetic_id = any(owned_avatars) then owned_avatars
            else array_append(owned_avatars, p_cosmetic_id)
          end
      where user_id = p_user_id;
    elsif p_kind = 'title' then
      update public.profiles
      set owned_titles = case
            when p_cosmetic_id = any(owned_titles) then owned_titles
            else array_append(owned_titles, p_cosmetic_id)
          end
      where user_id = p_user_id;
    end if;

    perform public.emit_user_event(
      p_user_id,
      'cosmetic_acquired',
      p_source_type,
      p_source_id,
      jsonb_build_object('kind', p_kind, 'cosmeticId', p_cosmetic_id) || coalesce(p_metadata, '{}'::jsonb)
    );

    -- Quest detection: 獲得稱號 / 獲得頭像 (only on a newly-owned cosmetic).
    if p_kind = 'title' then
      perform public.emit_user_progress_event(
        p_user_id, 'title_acquired', 1, p_source_type, p_source_id, jsonb_build_object('cosmeticId', p_cosmetic_id)
      );
    elsif p_kind = 'avatar' then
      perform public.emit_user_progress_event(
        p_user_id, 'avatar_acquired', 1, p_source_type, p_source_id, jsonb_build_object('cosmeticId', p_cosmetic_id)
      );
    end if;
  end if;

  return inserted_count > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- (g) accept_friend_request — snapshot each side's friend count
--     (body identical to 0008, plus the two snapshots)
-- ---------------------------------------------------------------------------

create or replace function public.accept_friend_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  request_row public.friend_requests%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into request_row
  from public.friend_requests
  where id = p_request_id
    and addressee_user_id = current_user_id
    and status = 'pending'
  for update;

  if request_row.id is null then
    raise exception 'Friend request not found.';
  end if;

  update public.friend_requests
  set status = 'accepted', responded_at = now()
  where id = p_request_id;

  insert into public.friends (user_id, friend_user_id)
  values (request_row.requester_user_id, request_row.addressee_user_id)
  on conflict do nothing;

  insert into public.friends (user_id, friend_user_id)
  values (request_row.addressee_user_id, request_row.requester_user_id)
  on conflict do nothing;

  -- Quest detection: 擁有好友 snapshot for both new friends.
  perform public.emit_user_progress_snapshot(
    request_row.requester_user_id, 'friends_owned',
    (select count(*)::integer from public.friends where user_id = request_row.requester_user_id),
    'friend', request_row.addressee_user_id::text, '{}'::jsonb
  );
  perform public.emit_user_progress_snapshot(
    request_row.addressee_user_id, 'friends_owned',
    (select count(*)::integer from public.friends where user_id = request_row.addressee_user_id),
    'friend', request_row.requester_user_id::text, '{}'::jsonb
  );
end;
$$;
