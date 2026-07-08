create table if not exists public.user_login_windows (
  user_id uuid primary key references auth.users(id) on delete cascade,
  client_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_login_windows_client_id_len check (length(btrim(client_id)) between 8 and 128)
);

alter table public.user_login_windows enable row level security;

drop policy if exists user_login_windows_select_own on public.user_login_windows;
create policy user_login_windows_select_own
on public.user_login_windows
for select
using (auth.uid() = user_id);

revoke all on public.user_login_windows from public;

create or replace function public.claim_login_window(p_client_id text, p_takeover boolean default false)
returns table(status text, active_client_id text, active_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_client_id text := btrim(coalesce(p_client_id, ''));
  seen_at timestamptz := now();
  existing public.user_login_windows%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if length(normalized_client_id) < 8 or length(normalized_client_id) > 128 then
    raise exception 'Invalid login client id.';
  end if;

  insert into public.user_login_windows (user_id, client_id, created_at, updated_at)
  values (current_user_id, normalized_client_id, seen_at, seen_at)
  on conflict (user_id) do nothing;

  select *
  into existing
  from public.user_login_windows
  where user_id = current_user_id
  for update;

  if existing.client_id = normalized_client_id
    or existing.updated_at < seen_at - interval '90 seconds'
    or p_takeover then
    update public.user_login_windows
    set
      client_id = normalized_client_id,
      created_at = case
        when public.user_login_windows.client_id = normalized_client_id then public.user_login_windows.created_at
        else seen_at
      end,
      updated_at = seen_at
    where user_id = current_user_id
    returning * into existing;

    return query select 'claimed'::text, existing.client_id, existing.updated_at;
    return;
  end if;

  return query select 'conflict'::text, existing.client_id, existing.updated_at;
end;
$$;

create or replace function public.keep_login_window(p_client_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_client_id text := btrim(coalesce(p_client_id, ''));
  kept boolean := false;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if length(normalized_client_id) < 8 or length(normalized_client_id) > 128 then
    raise exception 'Invalid login client id.';
  end if;

  update public.user_login_windows
  set updated_at = now()
  where user_id = current_user_id
    and client_id = normalized_client_id
  returning true into kept;

  return coalesce(kept, false);
end;
$$;

create or replace function public.release_login_window(p_client_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_client_id text := btrim(coalesce(p_client_id, ''));
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if length(normalized_client_id) < 8 or length(normalized_client_id) > 128 then
    raise exception 'Invalid login client id.';
  end if;

  delete from public.user_login_windows
  where user_id = current_user_id
    and client_id = normalized_client_id;
end;
$$;

revoke all on function public.claim_login_window(text, boolean) from public;
revoke all on function public.keep_login_window(text) from public;
revoke all on function public.release_login_window(text) from public;

grant execute on function public.claim_login_window(text, boolean) to authenticated;
grant execute on function public.keep_login_window(text) to authenticated;
grant execute on function public.release_login_window(text) to authenticated;
