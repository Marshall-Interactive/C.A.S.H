-- C.A.S.H family sync — run this once in Supabase: SQL Editor → New query → paste → Run.
--
-- How it's protected:
--   * Everyone signs in with their own email + password.
--   * A "household" is a private group; you join one only with its join code.
--   * Row-level security: a signed-in person can only ever read their own
--     household's rows. Writes go through the functions below, which check
--     membership first.
--   * Only amounts, descriptions and balances are stored — never card numbers
--     or bank logins.

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our Family',
  join_code text unique not null default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Every payment, bill, wage, pot, account, category (plus settings and
-- learned rules) is one row. updated_at is the app's own change time, used
-- so the newest edit wins; server_ts is when the server received it.
create table if not exists public.records (
  household_id uuid not null references public.households(id) on delete cascade,
  coll text not null,
  id text not null,
  data jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_ts timestamptz not null default clock_timestamp(),
  primary key (household_id, coll, id)
);
create index if not exists records_pull_idx on public.records (household_id, server_ts);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.records enable row level security;

create or replace function public.is_member(hh uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from household_members where household_id = hh and user_id = auth.uid());
$$;

drop policy if exists "members read household" on public.households;
create policy "members read household" on public.households for select to authenticated using (public.is_member(id));
drop policy if exists "members see members" on public.household_members;
create policy "members see members" on public.household_members for select to authenticated using (public.is_member(household_id));
drop policy if exists "members read records" on public.records;
create policy "members read records" on public.records for select to authenticated using (public.is_member(household_id));
-- No insert/update/delete policies: all writes go through the functions below.

create or replace function public.create_household(hh_name text) returns public.households
language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  insert into households (name) values (coalesce(nullif(trim(hh_name), ''), 'Our Family')) returning * into h;
  insert into household_members (household_id, user_id) values (h.id, auth.uid());
  return h;
end $$;

create or replace function public.join_household(code text) returns public.households
language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  select * into h from households where join_code = upper(trim(code));
  if h.id is null then raise exception 'No household found with that code'; end if;
  insert into household_members (household_id, user_id) values (h.id, auth.uid()) on conflict do nothing;
  return h;
end $$;

-- Save a batch of changes. A row only replaces what's on the server if it is
-- newer, so two phones editing at once can't overwrite each other's newer work.
create or replace function public.push_records(hh uuid, rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not is_member(hh) then raise exception 'Not a member of this household'; end if;
  insert into records (household_id, coll, id, data, updated_at, deleted, server_ts)
  select hh, r->>'coll', r->>'id', r->'data', (r->>'updated_at')::bigint,
         coalesce((r->>'deleted')::boolean, false), clock_timestamp()
  from jsonb_array_elements(rows) r
  on conflict (household_id, coll, id) do update
    set data = excluded.data, updated_at = excluded.updated_at,
        deleted = excluded.deleted, server_ts = clock_timestamp()
    where records.updated_at < excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.create_household(text) from public, anon;
revoke all on function public.join_household(text) from public, anon;
revoke all on function public.push_records(uuid, jsonb) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.push_records(uuid, jsonb) to authenticated;

-- Signed-in people may read the tables (row-level security above still limits
-- them to their own household). Logged-out visitors get nothing.
grant usage on schema public to authenticated;
grant select on public.households, public.household_members, public.records to authenticated;
revoke all on public.households, public.household_members, public.records from anon;

-- Live updates: the other phone hears about changes straight away.
do $$ begin
  alter publication supabase_realtime add table public.records;
exception when duplicate_object then null; end $$;

-- Make the new tables visible to the app straight away.
notify pgrst, 'reload schema';
