-- Frixion on Supabase, part 1: the shared helpers and accounts.
-- Draft (2026-11-15), not run yet: it gets tested on PGlite with the ported rules2 tests before it goes anywhere.
--
-- How documents are kept (see supabase/PLAN.md): each table has `id`, its parents' ids, and `data` (jsonb) holding
-- the document as Firestore had it. Timestamps inside `data` are {"$t": <milliseconds>} so the site's adapter can
-- turn them back into objects with toDate() and toMillis(). Every write goes through public.commit() (part 2), which
-- works like Firestore's commit: several writes, transforms (increment, arrayUnion, arrayRemove, serverTimestamp,
-- delete) and preconditions, all in one transaction, as the person asking, so the policies and triggers below apply.

create schema if not exists fx;   -- helpers; not exposed through the Data API

-- The time of this request in milliseconds (Firestore's request.time.toMillis()). now() is fixed for the whole
-- transaction, so every check in one commit sees the same time, like Firestore.
create or replace function fx.now_ms() returns bigint language sql stable as $$
  select (extract(epoch from now()) * 1000)::bigint
$$;

-- ---------- tables every rule looks at ----------

-- users/{username}: profiles, keyed by username
create table if not exists public.users (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- accounts/{sign-in id}: which Frixion account a sign-in is. Made once, never changed (rules: accounts).
create table if not exists public.accounts (
  id text primary key,                       -- the Supabase sign-in id (auth.uid()), as text
  data jsonb not null,                       -- { username, at }
  created_at timestamptz not null default now()
);

-- ---------- who is asking (rules: signedIn, rankOf, who, isStaff, isOwnerLevel, isTheOwner, canPost, active) ----------

-- Owner 3 > Co-Owner 2 > Admin 1 > everyone 0, the same order as platformRank() in script.js.
create or replace function fx.rank_of(u jsonb) returns int language sql immutable as $$
  select case when (u->>'owner') = 'true' then 3 when (u->>'coowner') = 'true' then 2 when (u->>'op') = 'true' then 1 else 0 end
$$;

-- The person asking: their username, whether the sign-in really is that account (its accounts row names the
-- profile, and the profile names the sign-in back), their rank and their profile. No account: name is null, ok false.
create type fx.person as (name text, ok boolean, rank int, u jsonb);
create or replace function fx.who() returns fx.person language sql stable security definer set search_path = '' as $$
  select a.data->>'username',
         coalesce(auth.uid() is not null and (p.data->>'authUid') = auth.uid()::text, false),
         coalesce(fx.rank_of(p.data), 0),
         coalesce(p.data, '{}'::jsonb)
  from (select 1) one
  left join public.accounts a on a.id = auth.uid()::text
  left join public.users p on p.id = a.data->>'username'
$$;

create or replace function fx.signed_in() returns boolean language sql stable as $$ select auth.uid() is not null $$;
create or replace function fx.is_who(m fx.person, name text) returns boolean language sql immutable as $$ select m.ok and m.name = name $$;
create or replace function fx.is_staff(m fx.person) returns boolean language sql immutable as $$ select m.ok and m.rank >= 1 $$;
create or replace function fx.is_owner_level(m fx.person) returns boolean language sql immutable as $$ select m.ok and m.rank >= 2 $$;
create or replace function fx.is_the_owner(m fx.person) returns boolean language sql immutable as $$ select m.ok and m.rank = 3 $$;

-- Banned and muted accounts can still read, but can't post.
create or replace function fx.can_post(m fx.person) returns boolean language sql stable as $$
  select not ((m.u->>'banned') = 'true' and (m.u->'bannedUntil' is null or jsonb_typeof(m.u->'bannedUntil') = 'null'
                or (m.u->>'bannedUntil')::bigint > fx.now_ms()))
     and (m.u->'mutedUntil' is null or jsonb_typeof(m.u->'mutedUntil') = 'null' or (m.u->>'mutedUntil')::numeric <= fx.now_ms())
$$;

-- Purge perms (v4.59/v4.60): the Owner, and whoever the Owner gave /purge.
create or replace function fx.purge_ok(m fx.person) returns boolean language sql immutable as $$ select (m.u->>'purgePerm') = 'true' $$;
create or replace function fx.purger(m fx.person) returns boolean language sql immutable as $$ select m.rank = 3 or fx.purge_ok(m) $$;

-- Not banned from Frixion right now: a banned account sees nothing but its own profile (the ban screen).
create or replace function fx.active(m fx.person) returns boolean language sql stable as $$
  select m.ok and not ((m.u->>'banned') = 'true' and (m.u->'bannedUntil' is null or jsonb_typeof(m.u->'bannedUntil') = 'null'
                         or (m.u->>'bannedUntil')::bigint > fx.now_ms()))
$$;

-- ---------- list helpers for triggers (rules: onlyAdded, onlyTakenOut, onlyRemoved) ----------

-- the jsonb array `f` of a document as a set of text values
create or replace function fx.set_of(d jsonb, f text) returns text[] language sql immutable as $$
  select coalesce(array(select distinct x from jsonb_array_elements_text(case when jsonb_typeof(d->f) = 'array' then d->f else '[]'::jsonb end) x order by x), '{}')
$$;
-- The list `f` gained `name` and nothing else changed in it.
create or replace function fx.only_added(old jsonb, new jsonb, f text, name text) returns boolean language sql immutable as $$
  select fx.set_of(new, f) = array(select distinct x from unnest(fx.set_of(old, f) || name) x order by x)
$$;
create or replace function fx.only_taken_out(old jsonb, new jsonb, f text, name text) returns boolean language sql immutable as $$
  select fx.set_of(new, f) = array(select x from unnest(fx.set_of(old, f)) x where x <> name order by x)
$$;
-- The list `f` only lost entries.
create or replace function fx.only_removed(old jsonb, new jsonb, f text) returns boolean language sql immutable as $$
  select fx.set_of(new, f) <@ fx.set_of(old, f)
$$;
-- Which top-level fields differ (rules: request.resource.data.diff(resource.data).affectedKeys())
create or replace function fx.changed(old jsonb, new jsonb) returns text[] language sql immutable as $$
  select coalesce(array(select k from (select jsonb_object_keys(coalesce(old, '{}')) k union select jsonb_object_keys(coalesce(new, '{}'))) ks
                        where (old->k) is distinct from (new->k) order by k), '{}')
$$;

-- ---------- accounts (rules: match /accounts/{uid}) ----------
alter table public.accounts enable row level security;

-- read: your own, or staff
create policy accounts_read on public.accounts for select to authenticated
  using (id = auth.uid()::text or fx.is_staff((select fx.who())));

-- create: your own sign-in only, just {username, at}, for a profile that names this sign-in back
create policy accounts_create on public.accounts for insert to authenticated
  with check (
    id = auth.uid()::text
    and (select array_agg(k) from jsonb_object_keys(data) k) <@ array['username', 'at']
    and jsonb_typeof(data->'username') = 'string'
    and exists (select 1 from public.users p where p.id = data->>'username' and (p.data->>'authUid') = auth.uid()::text)
  );
-- no update or delete policies: nobody changes or removes an account row (the server's secret key still can)
