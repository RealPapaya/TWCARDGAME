-- Phase 5 follow-up: make friends opt-in instead of immediately mutual.

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  addressee_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_user_id <> addressee_user_id)
);

create unique index if not exists friend_requests_pending_unique_idx
  on public.friend_requests (requester_user_id, addressee_user_id)
  where status = 'pending';

create index if not exists friend_requests_addressee_status_idx
  on public.friend_requests (addressee_user_id, status);

alter table public.friend_requests enable row level security;

drop policy if exists "Users read their friend requests" on public.friend_requests;
create policy "Users read their friend requests"
on public.friend_requests for select
using (auth.uid() = requester_user_id or auth.uid() = addressee_user_id);

drop policy if exists "Users create their friend requests" on public.friend_requests;
create policy "Users create their friend requests"
on public.friend_requests for insert
with check (auth.uid() = requester_user_id);

create or replace function public.find_profile_by_display_name(p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := nullif(trim(p_display_name), '');
  target_user_id uuid;
  match_count integer;
begin
  if clean_name is null then
    raise exception 'Display name is required.';
  end if;

  select count(*), (array_agg(user_id order by user_id))[1]
    into match_count, target_user_id
  from public.profiles
  where lower(display_name) = lower(clean_name);

  if match_count = 0 then
    raise exception 'No player found with display name %.', clean_name;
  end if;

  if match_count > 1 then
    raise exception 'Multiple players use display name %. Ask them to change to a unique name first.', clean_name;
  end if;

  return target_user_id;
end;
$$;

create or replace function public.send_friend_request(p_target_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_user_id uuid;
  reverse_request_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  target_user_id := public.find_profile_by_display_name(p_target_display_name);

  if target_user_id = current_user_id then
    raise exception 'You cannot add yourself as a friend.';
  end if;

  if exists (
    select 1 from public.friends
    where user_id = current_user_id and friend_user_id = target_user_id
  ) then
    raise exception 'You are already friends.';
  end if;

  select id into reverse_request_id
  from public.friend_requests
  where requester_user_id = target_user_id
    and addressee_user_id = current_user_id
    and status = 'pending'
  limit 1;

  if reverse_request_id is not null then
    perform public.accept_friend_request(reverse_request_id);
    return target_user_id;
  end if;

  if exists (
    select 1 from public.friend_requests
    where requester_user_id = current_user_id
      and addressee_user_id = target_user_id
      and status = 'pending'
  ) then
    raise exception 'Friend request already sent.';
  end if;

  insert into public.friend_requests (requester_user_id, addressee_user_id)
  values (current_user_id, target_user_id);

  return target_user_id;
end;
$$;

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
end;
$$;

create or replace function public.decline_friend_request(p_request_id uuid)
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

  update public.friend_requests
  set status = 'declined', responded_at = now()
  where id = p_request_id
    and addressee_user_id = current_user_id
    and status = 'pending';

  if not found then
    raise exception 'Friend request not found.';
  end if;
end;
$$;

create or replace function public.cancel_friend_request(p_request_id uuid)
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

  update public.friend_requests
  set status = 'cancelled', responded_at = now()
  where id = p_request_id
    and requester_user_id = current_user_id
    and status = 'pending';

  if not found then
    raise exception 'Friend request not found.';
  end if;
end;
$$;

create or replace function public.list_friend_requests()
returns table (
  request_id uuid,
  other_user_id uuid,
  display_name text,
  avatar_url text,
  wins_count integer,
  direction text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    fr.id as request_id,
    case
      when fr.requester_user_id = auth.uid() then fr.addressee_user_id
      else fr.requester_user_id
    end as other_user_id,
    p.display_name,
    p.avatar_url,
    p.wins_count,
    case
      when fr.requester_user_id = auth.uid() then 'outgoing'
      else 'incoming'
    end as direction,
    fr.created_at
  from public.friend_requests fr
  join public.profiles p on p.user_id = case
    when fr.requester_user_id = auth.uid() then fr.addressee_user_id
    else fr.requester_user_id
  end
  where fr.status = 'pending'
    and (fr.requester_user_id = auth.uid() or fr.addressee_user_id = auth.uid())
  order by fr.created_at desc;
$$;

grant select on public.friend_requests to authenticated;
grant execute on function public.find_profile_by_display_name(text) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.decline_friend_request(uuid) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.list_friend_requests() to authenticated;

grant select, insert, update, delete on public.friend_requests to service_role;
