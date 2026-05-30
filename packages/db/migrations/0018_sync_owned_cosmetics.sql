-- Sync profiles.owned_avatars and profiles.owned_titles to match user_cosmetics.
-- Fixes accounts where owned_avatars contained avatars not actually in user_cosmetics.

update public.profiles p
set owned_avatars = coalesce((
  select array_agg(uc.cosmetic_id order by uc.cosmetic_id)
  from public.user_cosmetics uc
  where uc.user_id = p.user_id
    and uc.kind = 'avatar'
), array['avatar1']::text[]);

update public.profiles p
set owned_titles = coalesce((
  select array_agg(uc.cosmetic_id order by uc.cosmetic_id)
  from public.user_cosmetics uc
  where uc.user_id = p.user_id
    and uc.kind = 'title'
), array['beginner']::text[]);

-- Ensure selected_title is one the user actually owns; fall back to 'beginner'.
update public.profiles p
set selected_title = 'beginner'
where not (p.selected_title = any(p.owned_titles));
