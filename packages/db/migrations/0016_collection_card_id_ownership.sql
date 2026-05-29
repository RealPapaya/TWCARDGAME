-- Treat card ownership as user_id + card_id. catalog versions remain available
-- for historical snapshots, but they are no longer ownership namespaces.

create or replace function public.save_user_deck(
  p_deck_id uuid,
  p_name text,
  p_card_catalog_version text,
  p_card_ids text[],
  p_cover_card_id text default null
)
returns public.decks
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  clean_name text := nullif(trim(p_name), '');
  clean_cover text := nullif(trim(p_cover_card_id), '');
  target_version text;
  deck_row public.decks;
  legendary_total integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if clean_name is null then
    raise exception 'Deck name is required.';
  end if;

  select version into target_version
  from public.card_catalog_snapshots
  order by created_at desc
  limit 1;

  if target_version is null then
    raise exception 'No card catalog snapshot has been published.';
  end if;

  if clean_cover is not null and not (clean_cover = any(p_card_ids)) then
    raise exception 'Cover card must be part of the deck.';
  end if;

  if coalesce(array_length(p_card_ids, 1), 0) > 0 then
    if exists (
      with deck_counts as (
        select card_id, count(*)::integer as qty
        from unnest(p_card_ids) as card_id
        group by card_id
      ),
      catalog_cards as (
        select
          card->>'id' as card_id,
          card->>'rarity' as rarity,
          coalesce((card->>'collectible')::boolean, true) as collectible
        from public.card_catalog_snapshots snapshot
        cross join lateral jsonb_array_elements(snapshot.cards) as card
        where snapshot.version = target_version
      ),
      collection_totals as (
        select card_id, sum(quantity)::integer as quantity
        from public.card_collections
        where user_id = current_user_id
        group by card_id
      )
      select 1
      from deck_counts deck
      left join catalog_cards catalog on catalog.card_id = deck.card_id
      left join collection_totals collection on collection.card_id = deck.card_id
      where catalog.card_id is null
        or catalog.collectible is false
        or deck.qty > 2
        or deck.qty > coalesce(collection.quantity, 0)
    ) then
      raise exception 'Deck contains unknown, uncollectible, over-limit, or unowned cards.';
    end if;

    select coalesce(sum(deck.qty), 0) into legendary_total
    from (
      select card_id, count(*)::integer as qty
      from unnest(p_card_ids) as card_id
      group by card_id
    ) deck
    join (
      select card->>'id' as card_id, card->>'rarity' as rarity
      from public.card_catalog_snapshots snapshot
      cross join lateral jsonb_array_elements(snapshot.cards) as card
      where snapshot.version = target_version
    ) catalog on catalog.card_id = deck.card_id
    where catalog.rarity = 'LEGENDARY';

    if legendary_total > 2 then
      raise exception 'Deck may contain at most 2 legendary cards in total.';
    end if;
  end if;

  if p_deck_id is null then
    insert into public.decks (user_id, name, card_catalog_version, card_ids, cover_card_id)
    values (current_user_id, clean_name, target_version, p_card_ids, clean_cover)
    returning * into deck_row;
  else
    update public.decks
    set name = clean_name,
        card_catalog_version = target_version,
        card_ids = p_card_ids,
        cover_card_id = clean_cover
    where id = p_deck_id
      and user_id = current_user_id
    returning * into deck_row;

    if deck_row.id is null then
      raise exception 'Deck not found.';
    end if;
  end if;

  perform public.emit_user_event(
    current_user_id,
    'deck_saved',
    'deck',
    deck_row.id::text,
    jsonb_build_object('name', deck_row.name, 'cardCatalogVersion', deck_row.card_catalog_version, 'cardCount', array_length(deck_row.card_ids, 1))
  );

  return deck_row;
end;
$$;

grant execute on function public.save_user_deck(uuid, text, text, text[], text) to authenticated;

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

  new_balance := public.adjust_user_currency(
    current_user_id,
    'voucher',
    total,
    'card_disenchant',
    'card',
    p_card_id,
    jsonb_build_object('rarity', card_rarity, 'count', p_count)
  );

  return jsonb_build_object(
    'cardId', p_card_id,
    'voucherGain', total,
    'remainingQuantity', owned - p_count,
    'vouchers', new_balance
  );
end;
$$;

grant execute on function public.disenchant_card(text, integer) to authenticated;

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

  return granted;
end;
$$;

grant execute on function public.ensure_starter_collection() to authenticated;
