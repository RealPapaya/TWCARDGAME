-- Allow saving decks with fewer than 30 cards; the 30-card requirement is
-- enforced at battle-start time on the client/server instead.

create or replace function public.save_user_deck(
  p_deck_id uuid,
  p_name text,
  p_card_catalog_version text,
  p_card_ids text[]
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

  if coalesce(array_length(p_card_ids, 1), 0) > 0 and exists (
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
      or deck.qty > case when catalog.rarity = 'LEGENDARY' then 1 else 2 end
      or deck.qty > coalesce(collection.quantity, 0)
  ) then
    raise exception 'Deck contains unknown, uncollectible, over-limit, or unowned cards.';
  end if;

  if p_deck_id is null then
    insert into public.decks (user_id, name, card_catalog_version, card_ids)
    values (current_user_id, clean_name, p_card_catalog_version, p_card_ids)
    returning * into deck_row;
  else
    update public.decks
    set name = clean_name,
        card_catalog_version = p_card_catalog_version,
        card_ids = p_card_ids
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
