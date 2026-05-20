-- Deck cover art, LEGACY deck-rule parity (max 2 legendary cards total),
-- and card disenchant / craft RPCs backed by the voucher currency.

alter table public.decks
  add column if not exists cover_card_id text;

-- The previous save_user_deck took 4 args; the cover param changes the
-- signature, so drop the old overload before recreating it.
drop function if exists public.save_user_deck(uuid, text, text, text[]);

-- save_user_deck: persists cover_card_id and enforces the LEGACY deck rules:
--   * each card id capped at 2 copies
--   * the deck holds at most 2 LEGENDARY cards in total
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
  deck_row public.decks;
  clean_name text := nullif(trim(p_name), '');
  clean_cover text := nullif(trim(p_cover_card_id), '');
  legendary_total integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if clean_name is null then
    raise exception 'Deck name is required.';
  end if;

  if not exists (select 1 from public.card_catalog_snapshots where version = p_card_catalog_version) then
    raise exception 'Card catalog snapshot % has not been published.', p_card_catalog_version;
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
        where snapshot.version = p_card_catalog_version
      )
      select 1
      from deck_counts deck
      left join catalog_cards catalog on catalog.card_id = deck.card_id
      left join public.card_collections collection
        on collection.user_id = current_user_id
        and collection.card_catalog_version = p_card_catalog_version
        and collection.card_id = deck.card_id
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
      where snapshot.version = p_card_catalog_version
    ) catalog on catalog.card_id = deck.card_id
    where catalog.rarity = 'LEGENDARY';

    if legendary_total > 2 then
      raise exception 'Deck may contain at most 2 legendary cards in total.';
    end if;
  end if;

  if p_deck_id is null then
    insert into public.decks (user_id, name, card_catalog_version, card_ids, cover_card_id)
    values (current_user_id, clean_name, p_card_catalog_version, p_card_ids, clean_cover)
    returning * into deck_row;
  else
    update public.decks
    set name = clean_name,
        card_catalog_version = p_card_catalog_version,
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

-- Voucher rates per rarity, matching LEGACY collection_manager.js.
create or replace function public.card_voucher_rate(p_rarity text, p_op text)
returns integer
language sql
immutable
as $$
  select case p_op
    when 'disenchant' then case p_rarity
      when 'LEGENDARY' then 300
      when 'EPIC' then 160
      when 'RARE' then 60
      else 20
    end
    when 'craft' then case p_rarity
      when 'LEGENDARY' then 800
      when 'EPIC' then 400
      when 'RARE' then 200
      else 50
    end
    else 0
  end;
$$;

-- disenchant_card: destroys p_count copies of a card for voucher credit.
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

  select quantity into owned
  from public.card_collections
  where user_id = current_user_id
    and card_catalog_version = target_version
    and card_id = p_card_id
  for update;

  if coalesce(owned, 0) < p_count then
    raise exception 'Not enough copies to disenchant.';
  end if;

  update public.card_collections
  set quantity = quantity - p_count
  where user_id = current_user_id
    and card_catalog_version = target_version
    and card_id = p_card_id;

  rate := public.card_voucher_rate(card_rarity, 'disenchant');
  total := rate * p_count;

  new_balance := public.adjust_user_currency(
    current_user_id,
    'voucher',
    total,
    'card_disenchant',
    'card',
    p_card_id,
    jsonb_build_object('count', p_count, 'rarity', card_rarity)
  );

  return jsonb_build_object(
    'cardId', p_card_id,
    'count', p_count,
    'voucherGain', total,
    'remainingQuantity', owned - p_count,
    'vouchers', new_balance
  );
end;
$$;

-- craft_card: spends vouchers to mint one copy of a card.
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

  return jsonb_build_object(
    'cardId', p_card_id,
    'voucherCost', cost,
    'quantity', new_quantity,
    'vouchers', new_balance
  );
end;
$$;

grant execute on function public.card_voucher_rate(text, text) to anon, authenticated;
grant execute on function public.disenchant_card(text, integer) to authenticated;
grant execute on function public.craft_card(text) to authenticated;
