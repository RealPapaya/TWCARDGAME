create or replace function public.ensure_full_seed_collection(target_version text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  inserted_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (select 1 from public.card_catalog_snapshots where version = target_version) then
    raise exception 'Card catalog snapshot % has not been published.', target_version;
  end if;

  insert into public.card_collections (user_id, card_catalog_version, card_id, quantity)
  select
    current_user_id,
    target_version,
    card->>'id',
    case when card->>'rarity' = 'LEGENDARY' then 1 else 2 end
  from public.card_catalog_snapshots snapshot
  cross join lateral jsonb_array_elements(snapshot.cards) as card
  where snapshot.version = target_version
    and coalesce((card->>'collectible')::boolean, true)
  on conflict (user_id, card_catalog_version, card_id) do update
    set quantity = greatest(public.card_collections.quantity, excluded.quantity);

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

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

  if coalesce(array_length(p_card_ids, 1), 0) <> 30 then
    raise exception 'Deck must contain exactly 30 cards.';
  end if;

  if not exists (select 1 from public.card_catalog_snapshots where version = p_card_catalog_version) then
    raise exception 'Card catalog snapshot % has not been published.', p_card_catalog_version;
  end if;

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

  return deck_row;
end;
$$;

create or replace function public.delete_user_deck(p_deck_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  delete from public.decks
  where id = p_deck_id
    and user_id = current_user_id;
end;
$$;

grant execute on function public.ensure_full_seed_collection(text) to authenticated;
grant execute on function public.save_user_deck(uuid, text, text, text[]) to authenticated;
grant execute on function public.delete_user_deck(uuid) to authenticated;
