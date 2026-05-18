grant usage on schema public to anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select on public.card_catalog_snapshots to anon, authenticated;
grant select on public.decks to authenticated;
grant select on public.card_collections to authenticated;
grant select on public.match_history to authenticated;

grant execute on function public.ensure_full_seed_collection(text) to authenticated;
grant execute on function public.save_user_deck(uuid, text, text, text[]) to authenticated;
grant execute on function public.delete_user_deck(uuid) to authenticated;
