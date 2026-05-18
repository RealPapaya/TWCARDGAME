grant usage on schema public to service_role;

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.card_catalog_snapshots to service_role;
grant select, insert, update, delete on public.decks to service_role;
grant select, insert, update, delete on public.card_collections to service_role;
grant select, insert, update, delete on public.match_history to service_role;

grant execute on function public.ensure_full_seed_collection(text) to service_role;
grant execute on function public.save_user_deck(uuid, text, text, text[]) to service_role;
grant execute on function public.delete_user_deck(uuid) to service_role;
