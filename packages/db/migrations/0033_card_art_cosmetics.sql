-- 炫彩 (special card art) cosmetics — server/DB-authoritative, mirroring the
-- card-ownership model:
--   * ownership  → user_cosmetics rows with the new 'card_art' kind
--                  (denormalised onto profiles.owned_card_arts, like owned_titles)
--   * display    → profiles.selected_card_arts (a per-card on/off set, the
--                  card-art analogue of selected_title)
--   * grant      → grant_user_cosmetic (service_role; used by the 炫彩包 flow)
--   * toggle     → set_user_card_art (authenticated; the collection toggle)
--
-- A 炫彩 skin's id is the cardId it re-skins (one skin per card for now); its
-- image lives in cosmetic_catalog.asset_path.

-- 1) Allow the new 'card_art' kind on the cosmetic tables. The original kind
--    checks were created inline with auto-generated names, so drop any check
--    constraint that references `kind` before re-adding the widened one.
do $$
declare
  c record;
begin
  for c in
    select rel.relname, con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname in ('cosmetic_catalog', 'user_cosmetics')
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
  end loop;
end$$;

alter table public.cosmetic_catalog
  add constraint cosmetic_catalog_kind_check check (kind in ('avatar', 'title', 'card_art'));
alter table public.user_cosmetics
  add constraint user_cosmetics_kind_check check (kind in ('avatar', 'title', 'card_art'));

-- 2) Denormalised ownership + display columns on profiles (mirror owned_titles /
--    selected_title). owned_card_arts is kept in sync by grant_user_cosmetic;
--    selected_card_arts is the set the player has switched on.
alter table public.profiles
  add column if not exists owned_card_arts text[] not null default '{}'::text[],
  add column if not exists selected_card_arts text[] not null default '{}'::text[];

-- 3) Catalog the first 炫彩 art (韓國瑜 / TW032).
insert into public.cosmetic_catalog (kind, id, display_name, asset_path, metadata)
values ('card_art', 'TW032', '炫彩・韓國瑜', '/images/cards_skin/1.webp', jsonb_build_object('cardId', 'TW032'))
on conflict (kind, id) do update
  set display_name = excluded.display_name,
      asset_path = excluded.asset_path,
      metadata = excluded.metadata,
      active = true;

-- 4) Teach grant_user_cosmetic to maintain owned_card_arts for the new kind.
--    (Otherwise unchanged from migration 0025.)
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
    elsif p_kind = 'card_art' then
      update public.profiles
      set owned_card_arts = case
            when p_cosmetic_id = any(owned_card_arts) then owned_card_arts
            else array_append(owned_card_arts, p_cosmetic_id)
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

-- 5) Toggle whether the player displays a 炫彩 they own. Validates ownership,
--    then adds/removes the cardId from profiles.selected_card_arts.
create or replace function public.set_user_card_art(p_card_id text, p_enabled boolean)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  profile_row public.profiles;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_enabled then
    if not exists (
      select 1
      from public.user_cosmetics
      where user_id = current_user_id
        and kind = 'card_art'
        and cosmetic_id = p_card_id
    ) then
      raise exception 'Card art % is not owned.', p_card_id;
    end if;

    update public.profiles
    set selected_card_arts = case
          when p_card_id = any(selected_card_arts) then selected_card_arts
          else array_append(selected_card_arts, p_card_id)
        end
    where user_id = current_user_id
    returning * into profile_row;
  else
    update public.profiles
    set selected_card_arts = array_remove(selected_card_arts, p_card_id)
    where user_id = current_user_id
    returning * into profile_row;
  end if;

  if profile_row.user_id is null then
    raise exception 'Profile not found.';
  end if;

  perform public.emit_user_event(
    current_user_id,
    'card_art_selected',
    'profile',
    p_card_id,
    jsonb_build_object('cardId', p_card_id, 'enabled', p_enabled)
  );

  return profile_row;
end;
$$;

grant execute on function public.set_user_card_art(text, boolean) to authenticated;

-- 6) Beta convenience: grant the first 炫彩 to every existing player so the
--    collection toggle is testable before the 炫彩包 purchase flow ships. Drop
--    this block once the pack grants ownership for real.
insert into public.user_cosmetics (user_id, kind, cosmetic_id, source)
select user_id, 'card_art', 'TW032', 'beta_seed'
from public.profiles
on conflict do nothing;

update public.profiles
set owned_card_arts = case
      when 'TW032' = any(owned_card_arts) then owned_card_arts
      else array_append(owned_card_arts, 'TW032')
    end;
