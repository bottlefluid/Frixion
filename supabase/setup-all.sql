-- Frixion on Supabase: the whole database setup (supabase/sql/001_base.sql to 010_reads.sql, in order), made by
-- supabase/make-setup.mjs. Paste all of it into the SQL Editor and run it once.
--
-- It starts by removing what an earlier run made, so it can be run again when the SQL changes. That also deletes every
-- row in Frixion's tables: run it again ONLY before Frixion's data has been copied in.
drop schema if exists fx cascade;
drop function if exists public.fx_commit(jsonb) cascade;
drop function if exists public.fx_get(text) cascade;
drop function if exists public.fx_query(text,jsonb,jsonb,integer,boolean) cascade;
drop function if exists public.fx_routes() cascade;
drop table if exists public.accounts, public.banned_hw, public.banned_ips, public.categories, public.channel_messages, public.channel_slow, public.channel_typing, public.channels, public.config, public.custom_emojis, public.devices, public.discord_links, public.dm_messages, public.dm_typing, public.dms, public.eggs, public.garden_pets, public.garden_seeds, public.garden_sprinklers, public.group_dms, public.group_messages, public.group_typing, public.ips, public.loans, public.login_codes, public.orb_days, public.push_subs, public.redeem_codes, public.rng_codes, public.rng_saves, public.sac_saves, public.server_cards, public.servers, public.shop_badges, public.shop_banners, public.shop_decorations, public.shop_nameplates, public.shop_prices, public.shop_profile_effects, public.shop_profile_frames, public.shop_themes, public.stickers, public.thread_messages, public.thread_typing, public.threads, public.user_mentions, public.user_meta, public.user_notes, public.users cascade;

-- ======================== 001_base.sql ========================
-- Frixion on Supabase, part 1: the shared helpers and accounts.
-- Draft (2026-11-15), not run yet: it gets tested on PGlite with the ported rules2 tests before it goes anywhere.
--
-- How documents are kept (see supabase/PLAN.md): each table has `id`, its parents' ids, and `data` (jsonb) holding
-- the document as Firestore had it. Timestamps inside `data` are {"$t": <milliseconds>} so the site's adapter can
-- turn them back into objects with toDate() and toMillis(). Every write goes through public.commit() (part 2), which
-- works like Firestore's commit: several writes, transforms (increment, arrayUnion, arrayRemove, serverTimestamp,
-- delete) and preconditions, all in one transaction, as the person asking, so the policies and triggers below apply.

create schema if not exists fx;   -- helpers; not exposed through the Data API
-- The project has "Automatically expose new tables" off, so nothing is reachable unless it's granted below, table by
-- table. Policies call these helpers as the person asking, so they need to be able to run them.
grant usage on schema fx to anon, authenticated, service_role;
alter default privileges in schema fx grant execute on functions to anon, authenticated, service_role;

-- The time of this request in milliseconds, with the microseconds after the point (Firestore's request.time). now()
-- is fixed for the whole transaction, so every check in one commit sees the same time, like Firestore. Keeping the
-- microseconds means a time a person makes up (whole milliseconds, from their clock) can't pass for the server's.
create or replace function fx.now_ms() returns numeric language sql stable as $$
  select extract(epoch from now()) * 1000
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
  id text primary key,                       -- the Firebase sign-in id (fx.sub())
  data jsonb not null,                       -- { username, at }
  created_at timestamptz not null default now()
);

-- ---------- reading fields the way the rules do ----------
-- A missing field is "not set", never "unknown": SQL's null would otherwise make `not (banned and ...)` null instead
-- of true. These two keep every check two-valued.
create or replace function fx.is_true(j jsonb) returns boolean language sql immutable as $$ select coalesce(j = 'true'::jsonb, false) $$;
-- a field's number, or null when it's missing, null or not a number
create or replace function fx.num(j jsonb) returns numeric language sql immutable as $$
  select case when jsonb_typeof(j) = 'number' then (j #>> '{}')::numeric end
$$;
-- Another document, read with the database's own rights (the rules' get(): it doesn't depend on what the person
-- asking may read). Only the profile is needed this way so far.
create or replace function fx.user_data(name text) returns jsonb language sql stable security definer set search_path = '' as $$
  select data from public.users where id = name
$$;

-- ---------- who is asking (rules: signedIn, rankOf, who, isStaff, isOwnerLevel, isTheOwner, canPost, active) ----------
-- Sign-in stays on Firebase: Supabase checks Firebase's token (Authentication > Third-Party Auth, project liquidalt)
-- and passes its claims on. fx.sub() is the Firebase sign-in id, only for a token Firebase issued for Frixion's
-- project: a token from Supabase's own sign-in (which Frixion doesn't use) counts as nobody.
create or replace function fx.sub() returns text language sql stable as $$
  select case when auth.jwt()->>'iss' = 'https://securetoken.google.com/liquidalt' and auth.jwt()->>'aud' = 'liquidalt'
              then nullif(auth.jwt()->>'sub', '') end
$$;

-- Owner 3 > Co-Owner 2 > Admin 1 > everyone 0, the same order as platformRank() in script.js.
create or replace function fx.rank_of(u jsonb) returns int language sql immutable as $$
  select case when (u->>'owner') = 'true' then 3 when (u->>'coowner') = 'true' then 2 when (u->>'op') = 'true' then 1 else 0 end
$$;

-- The person asking: their username, whether the sign-in really is that account (its accounts row names the
-- profile, and the profile names the sign-in back), their rank and their profile. No account: name is null, ok false.
create type fx.person as (name text, ok boolean, rank int, u jsonb);
create or replace function fx.who() returns fx.person language sql stable security definer set search_path = '' as $$
  select a.data->>'username',
         coalesce(fx.sub() is not null and (p.data->>'authUid') = fx.sub(), false),
         coalesce(fx.rank_of(p.data), 0),
         coalesce(p.data, '{}'::jsonb)
  from (select 1) one
  left join public.accounts a on a.id = fx.sub()
  left join public.users p on p.id = a.data->>'username'
$$;

create or replace function fx.signed_in() returns boolean language sql stable as $$ select fx.sub() is not null $$;
create or replace function fx.is_who(m fx.person, name text) returns boolean language sql immutable as $$ select m.ok and m.name = name $$;
create or replace function fx.is_staff(m fx.person) returns boolean language sql immutable as $$ select m.ok and m.rank >= 1 $$;
create or replace function fx.is_owner_level(m fx.person) returns boolean language sql immutable as $$ select m.ok and m.rank >= 2 $$;
create or replace function fx.is_the_owner(m fx.person) returns boolean language sql immutable as $$ select m.ok and m.rank = 3 $$;

-- Banned and muted accounts can still read, but can't post.
-- banned right now: banned, with no end or an end still ahead
create or replace function fx.banned_now(u jsonb) returns boolean language sql stable as $$
  select fx.is_true(u->'banned') and coalesce(fx.num(u->'bannedUntil') > fx.now_ms(), true)
$$;
create or replace function fx.can_post(m fx.person) returns boolean language sql stable as $$
  select not fx.banned_now(m.u) and coalesce(fx.num(m.u->'mutedUntil') <= fx.now_ms(), true)
$$;

-- Purge perms (v4.59/v4.60): the Owner, and whoever the Owner gave /purge.
create or replace function fx.purge_ok(m fx.person) returns boolean language sql immutable as $$ select fx.is_true(m.u->'purgePerm') $$;
create or replace function fx.purger(m fx.person) returns boolean language sql immutable as $$ select m.rank = 3 or fx.purge_ok(m) $$;

-- Not banned from Frixion right now: a banned account sees nothing but its own profile (the ban screen).
create or replace function fx.active(m fx.person) returns boolean language sql stable as $$
  select m.ok and not fx.banned_now(m.u)
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
  select coalesce(array(select k from (select jsonb_object_keys(case when jsonb_typeof(old) = 'object' then old else '{}'::jsonb end) k
                                       union select jsonb_object_keys(case when jsonb_typeof(new) = 'object' then new else '{}'::jsonb end)) ks
                        where (old->k) is distinct from (new->k) order by k), '{}')
$$;

-- ---------- accounts (rules: match /accounts/{uid}) ----------
alter table public.accounts enable row level security;

-- read: your own, or staff
create policy accounts_read on public.accounts for select to authenticated
  using (id = fx.sub() or fx.is_staff((select fx.who())));

-- create: your own sign-in only, just {username, at}, for a profile that names this sign-in back
create policy accounts_create on public.accounts for insert to authenticated
  with check (
    id = fx.sub()
    and (select array_agg(k) from jsonb_object_keys(data) k) <@ array['username', 'at']
    and jsonb_typeof(data->'username') = 'string'
    and (fx.user_data(data->>'username')->>'authUid') = fx.sub()
  );
-- no update or delete policies: nobody changes or removes an account row (the server's secret key still can)
grant select, insert on public.accounts to authenticated;
grant all on public.accounts to service_role;
-- (profiles get their policies and triggers in the users part; until then nobody but the server can read them)
grant all on public.users to service_role;


-- ======================== 002_commit.sql ========================
-- Frixion on Supabase, part 2: public.fx_commit(), the one door every write goes through.
-- Draft (2026-11-15), tested on PGlite (scratchpad sbtest/t-commit.mjs).
--
-- It works like Firestore's commit, which is what the site's set/update/add/delete, batches and transactions all
-- came down to: a list of writes done in order, in one transaction, as the person asking. Each table's policies and
-- triggers judge every write, and a refused write undoes the whole batch. The server (secret key) uses it too.
--
-- A write is { "path": "users/Alice", and one of
--     "set": {...}                    the whole document (made if it's missing)
--     "set": {...}, "merge": true     only these fields; maps are merged into what's there
--     "update": {"a.b": 1, ...}       these fields (a dotted path goes inside maps); the document must exist,
--                                     unless "upsert": true (Firestore's REST update: made from {} if missing)
--     "updatePaths": [[["a", "b.c"], value], ...]   like update, for field names with dots in them (FieldPath)
--     "create": {...}                 a new document; refused if it already exists (add())
--     "delete": true
--     "verify": true                  no write, only the preconditions (a transaction's reads that weren't written)
--   and optionally "transforms": [{"field": "a.b" or ["a", "b.c"], then one of "increment": n, "maximum": n, "minimum": n,
--                                  "arrayUnion": [...], "arrayRemove": [...], "serverTime": true, "delete": true}]
--   and the preconditions "exists": true|false and "updatedAt": "<the updatedAt a read gave>" }
-- It returns one {"path", "updatedAt", "data"} per write (data is null after a delete).
-- Errors: 42501 refused, P0002 not found, 23505 already exists, FX409 a precondition failed, FX400 a bad write.

-- ---------- which table a path is ----------
create table if not exists fx.routes (
  pattern text primary key,    -- 'servers/*/channels/*/messages/*'
  tbl text not null unique,    -- 'channel_messages' (one pattern per table)
  cols text[] not null         -- one key column per *, in order: {server_id, channel_id, id}
);
grant select on fx.routes to anon, authenticated, service_role;

create or replace function fx.route(path text, out tbl text, out cols text[], out ids text[]) language plpgsql stable set search_path = '' as $$
declare seg text[] := string_to_array(path, '/'); n int; pat text := ''; i int;
begin
  n := coalesce(array_length(seg, 1), 0);
  if n = 0 or n % 2 <> 0 or n > 20 then raise exception 'not a document path: %', path using errcode = 'FX400'; end if;
  ids := '{}';
  for i in 1 .. n loop
    if seg[i] = '' or length(seg[i]) > 300 then raise exception 'not a document path: %', path using errcode = 'FX400'; end if;
    if i % 2 = 1 then pat := pat || case when i > 1 then '/' else '' end || seg[i];
    else pat := pat || '/*'; ids := ids || seg[i]; end if;
  end loop;
  select r.tbl, r.cols into tbl, cols from fx.routes r where r.pattern = pat;
  if tbl is null then raise exception 'no table for %', pat using errcode = 'FX400'; end if;
end $$;

-- "id = $1[1] and ..." for a table's key columns
create or replace function fx.key_where(cols text[]) returns text language sql immutable as $$
  select string_agg(format('%I = $1[%s]', c, i), ' and ' order by i) from unnest(cols) with ordinality as t(c, i)
$$;

-- A document as it is now, read with the database's own rights (the rules' `resource`), optionally locked until the
-- end of the transaction so two batches can't both work from the same old copy.
create or replace function fx.peek(tbl text, cols text[], ids text[], lock boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  execute format('select jsonb_build_object(''data'', data, ''updatedAt'', updated_at::text) from public.%I where %s%s',
                 tbl, fx.key_where(cols), case when lock then ' for update' else '' end) into r using ids;
  return r;
end $$;
revoke execute on function fx.peek(text, text[], text[], boolean) from public, anon;

-- What a document looked like before this batch started (null if it didn't exist): for checks that compare the end of
-- a batch with its start, the way the rules compare get() with getAfter().
create or replace function fx.before(path text) returns jsonb language sql stable as $$
  select nullif(nullif(current_setting('fx.before', true), '')::jsonb -> path, 'null'::jsonb)
$$;
create or replace function fx.in_batch(path text) returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('fx.before', true), '')::jsonb ? path, false)
$$;
-- the row fx_commit is writing right now (see the write step there)
create or replace function fx.is_writing(tbl text, ids text[]) returns boolean language sql stable as $$
  select coalesce(current_setting('fx.writing', true), '') = tbl || ':' || array_to_string(ids, '/')
$$;
-- A timestamp in `data` ({"$t": milliseconds}) as milliseconds, or null if it isn't one (the rules' "is timestamp").
create or replace function fx.ts(j jsonb) returns numeric language sql immutable as $$
  select case when jsonb_typeof(j) = 'object' and jsonb_typeof(j->'$t') = 'number' then (j->>'$t')::numeric end
$$;
-- Another document the way the rules' get() sees it: as it was before this batch if the batch touches it, else as it
-- is. (getAfter() is just reading the table.) Read with the database's own rights.
create or replace function fx.got(path text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r_tbl text; r_cols text[]; r_ids text[];
begin
  if fx.in_batch(path) then return fx.before(path); end if;
  select * into r_tbl, r_cols, r_ids from fx.route(path);
  return fx.peek(r_tbl, r_cols, r_ids) -> 'data';
end $$;

-- ---------- building the new document ----------
-- set a dotted path, making the maps on the way
create or replace function fx.set_path(doc jsonb, p text[], val jsonb) returns jsonb language plpgsql immutable as $$
begin
  if doc is null or jsonb_typeof(doc) <> 'object' then doc := '{}'::jsonb; end if;
  if array_length(p, 1) = 1 then return doc || jsonb_build_object(p[1], val); end if;
  return doc || jsonb_build_object(p[1], fx.set_path(doc -> p[1], p[2:], val));
end $$;

-- set(..., {merge: true}): maps merged all the way down, everything else replaced
create or replace function fx.deep_merge(a jsonb, b jsonb) returns jsonb language plpgsql immutable as $$
declare k text; v jsonb;
begin
  if a is null or jsonb_typeof(a) <> 'object' then a := '{}'::jsonb; end if;
  for k, v in select * from jsonb_each(coalesce(b, '{}'::jsonb)) loop
    if jsonb_typeof(v) = 'object' and jsonb_typeof(a -> k) = 'object' then a := a || jsonb_build_object(k, fx.deep_merge(a -> k, v));
    else a := a || jsonb_build_object(k, v); end if;
  end loop;
  return a;
end $$;

-- one transform (FieldValue.increment and friends), worked out from the document as it is at that moment
create or replace function fx.transform(doc jsonb, t jsonb) returns jsonb language plpgsql stable as $$
declare p text[]; cur jsonb; v jsonb; out jsonb;
begin
  -- the field: a dotted name ("stats.games"), or a list of names for keys that have dots in them (FieldPath)
  p := case when jsonb_typeof(t->'field') = 'array' then array(select jsonb_array_elements_text(t->'field'))
            else string_to_array(nullif(t->>'field', ''), '.') end;
  if p is null or cardinality(p) = 0 then raise exception 'a transform needs a field' using errcode = 'FX400'; end if;
  cur := doc #> p;
  if t ? 'increment' or t ? 'maximum' or t ? 'minimum' then
    v := coalesce(t->'increment', t->'maximum', t->'minimum');
    if jsonb_typeof(v) <> 'number' then raise exception 'not a number' using errcode = 'FX400'; end if;
    out := case when jsonb_typeof(cur) is distinct from 'number' then v   -- (missing counts as not a number)
                when t ? 'increment' then to_jsonb((cur #>> '{}')::numeric + (v #>> '{}')::numeric)
                when t ? 'maximum' then to_jsonb(greatest((cur #>> '{}')::numeric, (v #>> '{}')::numeric))
                else to_jsonb(least((cur #>> '{}')::numeric, (v #>> '{}')::numeric)) end;
  elsif t ? 'arrayUnion' then
    out := case when jsonb_typeof(cur) = 'array' then cur else '[]'::jsonb end;
    for v in select * from jsonb_array_elements(t->'arrayUnion') loop
      if not exists (select 1 from jsonb_array_elements(out) x where x = v) then out := out || jsonb_build_array(v); end if;
    end loop;
  elsif t ? 'arrayRemove' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into out
    from jsonb_array_elements(case when jsonb_typeof(cur) = 'array' then cur else '[]'::jsonb end) x
    where not exists (select 1 from jsonb_array_elements(t->'arrayRemove') y where y = x);
  elsif fx.is_true(t->'serverTime') then
    out := jsonb_build_object('$t', fx.now_ms());
  elsif fx.is_true(t->'delete') then
    return doc #- p;
  else
    raise exception 'unknown transform' using errcode = 'FX400';
  end if;
  return fx.set_path(doc, p, out);
end $$;

-- ---------- the commit ----------
create or replace function public.fx_commit(writes jsonb) returns jsonb language plpgsql set search_path = '' as $$
declare
  w jsonb; t jsonb; k text; v jsonb; kind text; n int;
  r_tbl text; r_cols text[]; r_ids text[];
  cur jsonb; old jsonb; new jsonb; after jsonb;
  res jsonb := '[]'::jsonb; before jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(writes) is distinct from 'array' or jsonb_array_length(writes) not between 1 and 500 then
    raise exception 'a commit has 1 to 500 writes' using errcode = 'FX400';
  end if;
  -- what each document looked like before the batch
  for w in select * from jsonb_array_elements(writes) loop
    select * into r_tbl, r_cols, r_ids from fx.route(w->>'path');
    if not before ? (w->>'path') then
      before := before || jsonb_build_object(w->>'path', coalesce(fx.peek(r_tbl, r_cols, r_ids) -> 'data', 'null'::jsonb));
    end if;
  end loop;
  perform set_config('fx.before', before::text, true);

  for w in select * from jsonb_array_elements(writes) loop
    select * into r_tbl, r_cols, r_ids from fx.route(w->>'path');
    cur := fx.peek(r_tbl, r_cols, r_ids, true);
    old := cur -> 'data';
    kind := case when w ? 'delete' then 'delete' when w ? 'verify' then 'verify' when w ? 'create' then 'create'
                 when w ? 'update' or w ? 'updatePaths' then 'update' when w ? 'set' then 'set' end;
    if kind is null then raise exception 'a write needs set, update, create, delete or verify' using errcode = 'FX400'; end if;

    if kind in ('delete', 'verify') then new := null;
    elsif kind = 'create' then new := w -> 'create';
    elsif kind = 'update' then
      if (w ? 'update' and jsonb_typeof(w -> 'update') <> 'object') or (w ? 'updatePaths' and jsonb_typeof(w -> 'updatePaths') <> 'array') then
        raise exception 'update needs fields' using errcode = 'FX400';
      end if;
      new := coalesce(old, case when fx.is_true(w -> 'upsert') then '{}'::jsonb end);
      for k, v in select * from jsonb_each(coalesce(w -> 'update', '{}'::jsonb)) loop new := fx.set_path(new, string_to_array(k, '.'), v); end loop;
      for t in select * from jsonb_array_elements(coalesce(w -> 'updatePaths', '[]'::jsonb)) loop
        if jsonb_typeof(t -> 0) <> 'array' or jsonb_array_length(t -> 0) = 0 then raise exception 'a field path is a list of names' using errcode = 'FX400'; end if;
        new := fx.set_path(new, array(select jsonb_array_elements_text(t -> 0)), t -> 1);
      end loop;
    elsif fx.is_true(w -> 'merge') then new := fx.deep_merge(old, w -> 'set');
    else new := w -> 'set';
    end if;
    if kind not in ('delete', 'verify') then
      if jsonb_typeof(new) is distinct from 'object' then raise exception 'a document is a map' using errcode = 'FX400'; end if;
      for t in select * from jsonb_array_elements(coalesce(w -> 'transforms', '[]'::jsonb)) loop new := fx.transform(new, t); end loop;
    end if;

    -- The write itself: the table's policies and triggers decide. Postgres also wants an UPDATE or DELETE to be able
    -- to read its row, which Firestore never asked (anyone may join a server they can't see yet), so the read policies
    -- let this one row through while it's being written (fx.is_writing), and only then.
    perform set_config('fx.writing', r_tbl || ':' || array_to_string(r_ids, '/'), true);
    if kind = 'verify' then
      null;   -- (nothing written: only the preconditions below)
    elsif kind = 'delete' then
      if old is not null then
        execute format('delete from public.%I where %s', r_tbl, fx.key_where(r_cols)) using r_ids;
        get diagnostics n = row_count;
        if n = 0 then raise exception 'permission denied' using errcode = '42501'; end if;
      end if;
    elsif old is null then
      if kind = 'update' and not fx.is_true(w -> 'upsert') then raise exception 'no document at %', w->>'path' using errcode = 'P0002'; end if;
      execute format('insert into public.%I (%s, data) values (%s, $2)', r_tbl,
                     (select string_agg(quote_ident(c), ', ') from unnest(r_cols) c),
                     (select string_agg(format('$1[%s]', i), ', ') from generate_subscripts(r_cols, 1) i)) using r_ids, new;
    else
      if kind = 'create' then raise exception 'already exists: %', w->>'path' using errcode = '23505'; end if;
      execute format('update public.%I set data = $2 where %s', r_tbl, fx.key_where(r_cols)) using r_ids, new;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'permission denied' using errcode = '42501'; end if;
    end if;
    perform set_config('fx.writing', '', true);

    -- preconditions come after the write, so a refused write never tells whether the document was there
    if w ? 'exists' and fx.is_true(w -> 'exists') <> (old is not null) then
      raise exception 'precondition failed: %', w->>'path' using errcode = 'FX409';
    end if;
    if w ? 'updatedAt' and (cur ->> 'updatedAt') is distinct from (w ->> 'updatedAt') then
      raise exception 'precondition failed: %', w->>'path' using errcode = 'FX409';
    end if;

    -- what comes back: the document as the person may read it now (null if they can't, or after a delete)
    after := case when kind = 'delete' then null else fx.peek(r_tbl, r_cols, r_ids) end;
    v := null;
    if kind not in ('delete', 'verify') then
      execute format('select data from public.%I where %s', r_tbl, fx.key_where(r_cols)) into v using r_ids;
    end if;
    res := res || jsonb_build_array(jsonb_build_object('path', w->>'path', 'updatedAt', after ->> 'updatedAt', 'data', v));
  end loop;
  return res;
end $$;
grant execute on function public.fx_commit(jsonb) to authenticated, service_role;
revoke execute on function public.fx_commit(jsonb) from public, anon;

-- ---------- every table's bookkeeping ----------
-- updated_at is the database's (preconditions rely on it), created_at never changes, and a document can't move to
-- another id. Fires for any write, through fx_commit or not.
create or replace function fx.stamp() returns trigger language plpgsql set search_path = '' as $$
declare c text;
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    for c in select unnest(r.cols) from fx.routes r where r.tbl = tg_table_name loop
      if (to_jsonb(new) ->> c) is distinct from (to_jsonb(old) ->> c) then
        raise exception 'a document can''t move' using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end $$;

-- Writes from the server (secret key) or from the database's own trusted functions skip the rules, the way the
-- Firebase Admin SDK skipped Firestore's rules; writes from the site (anon or authenticated) never do.
create or replace function fx.trusted() returns boolean language sql stable as $$
  select current_user not in ('anon', 'authenticated')
$$;

-- the tables from part 1
insert into fx.routes (pattern, tbl, cols) values
  ('users/*', 'users', '{id}'),
  ('accounts/*', 'accounts', '{id}')
on conflict (pattern) do update set tbl = excluded.tbl, cols = excluded.cols;
alter table public.accounts add column if not exists updated_at timestamptz not null default now();
create or replace trigger stamp before insert or update on public.users for each row execute function fx.stamp();
create or replace trigger stamp before insert or update on public.accounts for each row execute function fx.stamp();


-- ======================== 003_users.sql ========================
-- Frixion on Supabase, part 3: profiles (rules: match /users/{username}, its mentions, meta and privateNotes).
-- Ported function by function from firestore.rules; the names match (selfEdit -> fx.self_edit and so on).

-- ---------- the tables under a profile ----------
create table if not exists public.user_meta (       -- users/{u}/meta/{id}: what you've read, your block list
  user_id text not null, id text not null, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id, id));
create table if not exists public.user_notes (      -- users/{u}/privateNotes/{author}: notes only their author sees
  user_id text not null, id text not null, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id, id));
create table if not exists public.user_mentions (   -- users/{u}/mentions/{id}: notes for the person mentioned
  user_id text not null, id text not null, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id, id));
insert into fx.routes (pattern, tbl, cols) values
  ('users/*/meta/*', 'user_meta', '{user_id,id}'),
  ('users/*/privateNotes/*', 'user_notes', '{user_id,id}'),
  ('users/*/mentions/*', 'user_mentions', '{user_id,id}')
on conflict (pattern) do update set tbl = excluded.tbl, cols = excluded.cols;

-- ---------- small checks ----------
create or replace function fx.keys(d jsonb) returns text[] language sql immutable as $$
  select case when jsonb_typeof(d) = 'object' then coalesce(array(select jsonb_object_keys(d)), '{}') else '{}' end
$$;
create or replace function fx.str(j jsonb) returns text language sql immutable as $$
  select case when jsonb_typeof(j) = 'string' then j #>> '{}' end
$$;
create or replace function fx.is_int(j jsonb) returns boolean language sql immutable as $$
  select case when jsonb_typeof(j) = 'number' then (j #>> '{}')::numeric % 1 = 0 else false end
$$;
create or replace function fx.hex_color(j jsonb) returns boolean language sql immutable as $$
  select coalesce(fx.str(j) ~ '^#[0-9a-fA-F]{6}$', false)
$$;
create or replace function fx.premium_now(u jsonb) returns boolean language sql stable as $$
  select coalesce(fx.num(u->'premiumUntil') > fx.now_ms(), false)
$$;

-- Colors everyone else's screen draws from your profile are plain colors (v4.56); gradients need Premium (v4.57).
create or replace function fx.plain_colors(k text[], d jsonb, premium boolean) returns boolean language sql immutable as $$
  select (not ('bannerColor' = any(k)) or not (d ? 'bannerColor') or fx.hex_color(d->'bannerColor')
          or (premium and coalesce(fx.str(d->'bannerColor') ~ '^linear-gradient\([0-9]{1,3}deg,#[0-9a-fA-F]{6},#[0-9a-fA-F]{6}\)$', false)))
     and (not ('avatarColor' = any(k)) or not (d ? 'avatarColor') or fx.hex_color(d->'avatarColor'))
     and (not ('nameGradient' = any(k)) or not (d ? 'nameGradient')
          or (premium and case when jsonb_typeof(d->'nameGradient') = 'array'
                               then jsonb_array_length(d->'nameGradient') = 2 and fx.hex_color(d->'nameGradient'->0) and fx.hex_color(d->'nameGradient'->1)
                               else false end))
$$;

-- (only checked when that slot changes, so something worn from before still shows until it's taken off)
create or replace function fx.wears(k text[], d jsonb, eq text, owned text) returns boolean language sql immutable as $$
  select not (eq = any(k)) or coalesce(d->eq, 'null'::jsonb) = 'null'::jsonb or coalesce((d->>eq) = any(fx.set_of(d, owned)), false)
$$;

-- Orbs, Premium and Shop items (v4.57): your own app may spend Orbs (never below 0; a profile from before Orbs may get
-- the 50 new accounts start with), never touch Premium time, let go of items but not add any, and wear only what it owns.
create or replace function fx.economy_ok(k text[], old jsonb, d jsonb) returns boolean language sql stable as $$
  select (not ('orbs' = any(k)) or (jsonb_typeof(d->'orbs') = 'number' and fx.num(d->'orbs') >= 0
            and case when jsonb_typeof(old->'orbs') = 'number' then fx.num(d->'orbs') < fx.num(old->'orbs') else fx.num(d->'orbs') <= 50 end))
     and not ('premiumUntil' = any(k))
     and (not (k && array['ownedDecorations', 'ownedNameplates', 'ownedProfileEffects', 'ownedProfileFrames', 'ownedThemes', 'ownedBanners', 'ownedMusic', 'ownedBadges'])
          or (fx.only_removed(old, d, 'ownedDecorations') and fx.only_removed(old, d, 'ownedNameplates') and fx.only_removed(old, d, 'ownedProfileEffects')
              and fx.only_removed(old, d, 'ownedProfileFrames') and fx.only_removed(old, d, 'ownedThemes') and fx.only_removed(old, d, 'ownedBanners')
              and fx.only_removed(old, d, 'ownedMusic') and fx.only_removed(old, d, 'ownedBadges')))
     and (not (k && array['equippedDecoration', 'equippedMask', 'equippedNameplate', 'equippedProfileEffect', 'equippedProfileFrame', 'equippedTheme', 'equippedBanner', 'equippedMusic', 'equippedBadge'])
          or (fx.wears(k, d, 'equippedDecoration', 'ownedDecorations') and fx.wears(k, d, 'equippedMask', 'ownedDecorations')
              and fx.wears(k, d, 'equippedNameplate', 'ownedNameplates') and fx.wears(k, d, 'equippedProfileEffect', 'ownedProfileEffects')
              and fx.wears(k, d, 'equippedProfileFrame', 'ownedProfileFrames') and fx.wears(k, d, 'equippedTheme', 'ownedThemes')
              and fx.wears(k, d, 'equippedBanner', 'ownedBanners') and fx.wears(k, d, 'equippedMusic', 'ownedMusic') and fx.wears(k, d, 'equippedBadge', 'ownedBadges')))
$$;

-- (v4.65) The badge counts your own app keeps: game time goes up at most 10 minutes per save and at most every 9
-- minutes (stamped with the server's time); Premium gifts go up one at a time, only in the write that pays 1,400 Orbs.
create or replace function fx.stats_ok(k text[], old jsonb, d jsonb) returns boolean language plpgsql stable as $$
declare b jsonb; a jsonb; gm0 numeric; gm1 numeric; gf0 numeric; gf1 numeric; at0 numeric; at1 numeric;
begin
  if not ('stats' = any(k)) then return true; end if;
  b := coalesce(old->'stats', '{}'::jsonb);
  a := coalesce(d->'stats', '{}'::jsonb);
  if jsonb_typeof(a) <> 'object' or jsonb_typeof(b) <> 'object' then return false; end if;
  if (a ? 'gameMinutes' and fx.num(a->'gameMinutes') is null) or (a ? 'giftsGiven' and fx.num(a->'giftsGiven') is null) then return false; end if;
  gm0 := coalesce(fx.num(b->'gameMinutes'), 0); gm1 := coalesce(fx.num(a->'gameMinutes'), 0);
  gf0 := coalesce(fx.num(b->'giftsGiven'), 0); gf1 := coalesce(fx.num(a->'giftsGiven'), 0);
  at0 := fx.num(b->'gameAt'->'$t'); at1 := fx.num(a->'gameAt'->'$t');
  return (gm1 = gm0 or (gm1 > gm0 and gm1 - gm0 <= 10 and at1 = fx.now_ms()
                        and (coalesce(b->'gameAt', 'null'::jsonb) = 'null'::jsonb or fx.now_ms() > at0 + 540000)))
     and (gf1 = gf0 or (gf1 = gf0 + 1 and coalesce(fx.num(d->'orbs'), 0) <= coalesce(fx.num(old->'orbs'), 0) - 1400))
     and ((a->'gameAt') is not distinct from (b->'gameAt') or gm1 > gm0);
end $$;

-- A ban that has run out may be cleared by its owner.
create or replace function fx.clearing_expired_ban(old jsonb, d jsonb) returns boolean language sql stable as $$
  select fx.is_true(old->'banned') and coalesce(fx.num(old->'bannedUntil') <= fx.now_ms(), false)
     and coalesce(d->'banned', 'true'::jsonb) = 'false'::jsonb
$$;

-- someone has blocked me, and isn't ranked below me
create or replace function fx.blocks_me(m fx.person, name text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select m.name = any(fx.set_of(b.data, 'list')) from public.user_meta b where b.user_id = name and b.id = 'blocks'), false)
     and fx.rank_of(coalesce(fx.user_data(name), '{}'::jsonb)) >= m.rank
$$;

-- ---------- the profile rules ----------
-- A new profile belongs to the sign-in making it (one per sign-in), with no staff powers, bans or extra Orbs, no Shop
-- items, no game time or gifts, and plain colors only.
create or replace function fx.user_create_ok(username text, d jsonb) returns boolean language sql stable set search_path = '' as $$
  select fx.sub() is not null
     and not exists (select 1 from public.accounts a where a.id = fx.sub())
     and fx.str(d->'username') = username
     and fx.str(d->'authUid') = fx.sub()
     and not (fx.keys(d) && array['password', 'owner', 'coowner', 'terminated', 'redirectUrl', 'redirectNonce', 'mutedUntil', 'muteReason', 'purgePerm', 'cracker', 'casino', 'infOrbs', 'bannerImage', 'customRank', 'credit', 'loanWith', 'loanNext', 'staffBadges'])
     and coalesce(d->'op', 'false'::jsonb) = 'false'::jsonb
     and coalesce(d->'banned', 'false'::jsonb) = 'false'::jsonb
     and coalesce(d->'premiumUntil', 'null'::jsonb) = 'null'::jsonb
     and fx.is_int(coalesce(d->'orbs', '0'::jsonb)) and fx.num(coalesce(d->'orbs', '0'::jsonb)) <= 50
     and not (fx.keys(d) && array['ownedDecorations', 'ownedNameplates', 'ownedProfileEffects', 'ownedProfileFrames', 'ownedThemes', 'ownedBanners', 'ownedMusic', 'ownedBadges',
                                  'equippedDecoration', 'equippedMask', 'equippedNameplate', 'equippedProfileEffect', 'equippedProfileFrame', 'equippedTheme', 'equippedBanner', 'equippedMusic', 'equippedBadge'])
     and (not (d ? 'stats') or jsonb_typeof(d->'stats') = 'object')
     and coalesce(d->'stats'->'gameMinutes', '0'::jsonb) = '0'::jsonb and coalesce(d->'stats'->'giftsGiven', '0'::jsonb) = '0'::jsonb
     and fx.plain_colors(fx.keys(d), d, false)
$$;

-- Your own profile: anything except your rank, sign-in, bans and mutes. A few staff-set fields may only be cleared.
create or replace function fx.self_edit(m fx.person, k text[], username text, old jsonb, d jsonb) returns boolean language sql stable as $$
  select m.name = username
     and not (k && array['authUid', 'owner', 'coowner', 'op', 'username', 'createdAt', 'mutedUntil', 'muteReason', 'purgePerm', 'cracker', 'casino', 'infOrbs', 'customRank', 'credit', 'loanWith', 'loanNext', 'staffBadges'])
     and (not ('bannerImage' = any(k)) or not (d ? 'bannerImage'))
     and (not (k && array['banned', 'banReason', 'bannedUntil']) or fx.clearing_expired_ban(old, d))
     and (not (k && array['redirectUrl', 'redirectNonce']) or not (d ?| array['redirectUrl', 'redirectNonce']))
     and (not ('terminated' = any(k)) or not (d ? 'terminated'))
     and not (d ? 'password')
     and fx.plain_colors(k, d, fx.premium_now(old))
     and fx.economy_ok(k, old, d)
     and fx.stats_ok(k, old, d)
$$;

-- Staff on someone else: Admins can change Orbs, Premium, bans and mutes; Co-Owners and the Owner anything except
-- ownership and sign-ins, and only the Owner makes Co-Owners. Nobody touches an equal or higher Co-Owner/Owner.
create or replace function fx.staff_edit(m fx.person, k text[], username text, old jsonb, d jsonb) returns boolean language sql stable as $$
  select m.rank >= 1
     and (m.name = username or case when fx.rank_of(old) >= 2 then m.rank > fx.rank_of(old) else true end)
     and not (k && array['owner', 'username', 'createdAt', 'authUid'])
     and (not ('coowner' = any(k)) or m.rank = 3)
     and (not ('purgePerm' = any(k)) or m.rank = 3)
     and not (d ? 'password')
     and (m.rank >= 2 or k <@ array['premiumUntil', 'orbs', 'banned', 'banReason', 'bannedUntil', 'mutedUntil', 'muteReason'])
$$;

-- Friend requests change both accounts. On the other person's account you may only add or remove yourself, and you
-- may only add yourself to their friends while their request to you is still there.
create or replace function fx.friend_edit(m fx.person, k text[], username text, old jsonb, d jsonb) returns boolean language sql stable as $$
  select k <@ array['incomingRequests', 'outgoingRequests', 'friends']
     and (not ('incomingRequests' = any(k)) or (fx.only_added(old, d, 'incomingRequests', m.name) and not fx.blocks_me(m, username))
          or fx.only_taken_out(old, d, 'incomingRequests', m.name))
     and (not ('outgoingRequests' = any(k)) or fx.only_taken_out(old, d, 'outgoingRequests', m.name))
     and (not ('friends' = any(k)) or fx.only_taken_out(old, d, 'friends', m.name)
          or (fx.only_added(old, d, 'friends', m.name) and m.name = any(fx.set_of(old, 'outgoingRequests'))))
$$;

create or replace function fx.users_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; k text[]; ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  if tg_op = 'INSERT' then
    ok := fx.user_create_ok(new.id, new.data);
  elsif tg_op = 'UPDATE' then
    k := fx.changed(old.data, new.data);
    ok := m.ok and (fx.self_edit(m, k, new.id, old.data, new.data) or fx.staff_edit(m, k, new.id, old.data, new.data)
                    or fx.friend_edit(m, k, new.id, old.data, new.data));
  else   -- Delete Account: the owner flags the account and its own app removes it; Co-Owners and the Owner can too
    ok := m.ok and ((m.name = old.id and coalesce(old.data->'terminated'->>'mode', '') = 'real') or m.rank >= 2);
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;

-- ---------- policies ----------
alter table public.users enable row level security;
create policy users_read on public.users for select to authenticated using (fx.signed_in());   -- anyone signed in
create policy users_insert on public.users for insert to authenticated with check (true);    -- (the trigger decides)
create policy users_update on public.users for update to authenticated using (true) with check (true);
create policy users_delete on public.users for delete to authenticated using (true);
grant select, insert, update, delete on public.users to authenticated;
create or replace trigger rules before insert or update or delete on public.users for each row execute function fx.users_rules();

alter table public.user_meta enable row level security;
alter table public.user_notes enable row level security;
alter table public.user_mentions enable row level security;
create policy meta_own on public.user_meta for all to authenticated
  using (fx.is_who((select fx.who()), user_id)) with check (fx.is_who((select fx.who()), user_id));
create policy notes_author on public.user_notes for all to authenticated
  using (fx.is_who((select fx.who()), id)) with check (fx.is_who((select fx.who()), id));
create policy mentions_read on public.user_mentions for select to authenticated using (fx.is_who((select fx.who()), user_id));
create policy mentions_delete on public.user_mentions for delete to authenticated using (fx.is_who((select fx.who()), user_id));
-- (making a mention needs the servers part: mentionCreate. Until then only the server can.)
grant select, insert, update, delete on public.user_meta, public.user_notes to authenticated;
grant select, delete on public.user_mentions to authenticated;
grant all on public.user_meta, public.user_notes, public.user_mentions to service_role;
create or replace trigger stamp before insert or update on public.user_meta for each row execute function fx.stamp();
create or replace trigger stamp before insert or update on public.user_notes for each row execute function fx.stamp();
create or replace trigger stamp before insert or update on public.user_mentions for each row execute function fx.stamp();


-- ======================== 004_servers.sql ========================
-- Frixion on Supabase, part 4: servers and what's in them (rules: servers, categories, channels, threads, slow,
-- serverCards), with the permission helpers the messages part uses too. Ported function by function.

-- ---------- tables ----------
create table if not exists public.servers (id text primary key, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.channels (server_id text not null, id text not null, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (server_id, id));
create table if not exists public.categories (server_id text not null, id text not null, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (server_id, id));
create table if not exists public.threads (server_id text not null, id text not null, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (server_id, id));
-- servers/{sid}/channels/{cid}/slow/{name}: when each person last posted in a slowmode channel
create table if not exists public.channel_slow (server_id text not null, channel_id text not null, id text not null,
  data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (server_id, channel_id, id));
create table if not exists public.server_cards (id text primary key, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
insert into fx.routes (pattern, tbl, cols) values
  ('servers/*', 'servers', '{id}'),
  ('servers/*/channels/*', 'channels', '{server_id,id}'),
  ('servers/*/categories/*', 'categories', '{server_id,id}'),
  ('servers/*/threads/*', 'threads', '{server_id,id}'),
  ('servers/*/channels/*/slow/*', 'channel_slow', '{server_id,channel_id,id}'),
  ('serverCards/*', 'server_cards', '{id}')
on conflict (pattern) do update set tbl = excluded.tbl, cols = excluded.cols;

-- ---------- small helpers ----------
-- an id that can safely go into a path (one segment)
create or replace function fx.ok_id(x text) returns boolean language sql immutable as $$
  select coalesce(x <> '' and position('/' in x) = 0, false)
$$;
-- a list field in its own order, as text (fx.set_of sorts and drops repeats)
create or replace function fx.list_of(d jsonb, f text) returns text[] language sql immutable as $$
  select coalesce(array(select x from jsonb_array_elements_text(case when jsonb_typeof(d->f) = 'array' then d->f else '[]'::jsonb end)
                        with ordinality t(x, n) order by n), '{}')
$$;
-- the rules' get(f, null) == get(f, null)
create or replace function fx.same(a jsonb, b jsonb) returns boolean language sql immutable as $$
  select coalesce(a, 'null'::jsonb) = coalesce(b, 'null'::jsonb)
$$;
create or replace function fx.srv(sid text) returns jsonb language sql stable as $$
  select case when fx.ok_id(sid) then fx.got('servers/' || sid) end
$$;
create or replace function fx.chan(sid text, cid text) returns jsonb language sql stable as $$
  select case when fx.ok_id(sid) and fx.ok_id(cid) then fx.got('servers/' || sid || '/channels/' || cid) end
$$;
create or replace function fx.thread_of(sid text, tid text) returns jsonb language sql stable as $$
  select case when fx.ok_id(sid) and fx.ok_id(tid) then fx.got('servers/' || sid || '/threads/' || tid) end
$$;

-- ---------- membership and permissions (rules: isMember ... seesChannel) ----------
create or replace function fx.is_member(m fx.person, s jsonb) returns boolean language sql immutable as $$
  select coalesce(m.name = any(fx.set_of(s, 'members')), false)
$$;
-- in the server (or Frixion staff), and not banned from Frixion
create or replace function fx.in_server(m fx.person, s jsonb) returns boolean language sql stable as $$
  select s is not null and fx.active(m) and (fx.is_member(m, s) or m.rank >= 1)
$$;
create or replace function fx.not_timed_out(m fx.person, s jsonb) returns boolean language sql stable as $$
  select coalesce(fx.num(s->'timeouts'->m.name), 0) <= fx.now_ms()
$$;
create or replace function fx.everyone_defaults() returns text[] language sql immutable as $$
  select array['viewChannels', 'createExpressions', 'createInvite', 'changeNickname', 'sendMessages', 'sendMessagesInThreads',
    'createPublicThreads', 'createPrivateThreads', 'embedLinks', 'attachFiles', 'addReactions', 'useExternalEmoji',
    'useExternalStickers', 'readMessageHistory', 'sendTTS', 'sendVoiceMessages', 'createPolls', 'connect', 'speak',
    'video', 'useSoundboard', 'useExternalSounds', 'useVAD', 'useApplicationCommands', 'useActivities',
    'useExternalApps', 'requestToSpeak', 'createEvents']
$$;
-- What @everyone and the person's roles give them. Like the Firestore rules (which couldn't loop), only a server's
-- first 8 roles count, so the two behave the same; Postgres could look at all of them later.
create or replace function fx.role_perms_of(m fx.person, s jsonb) returns text[] language plpgsql stable as $$
declare roles jsonb; mine text[]; p text[] := '{}'; r jsonb;
begin
  roles := case when jsonb_typeof(s->'roles') = 'array' then s->'roles' else '[]'::jsonb end;
  mine := fx.list_of(case when jsonb_typeof(s->'memberRoles') = 'object' then s->'memberRoles' else '{}'::jsonb end, m.name);
  for r in select x from jsonb_array_elements(roles) with ordinality t(x, n) where n <= 8 order by n loop
    if jsonb_typeof(r) = 'object' and ((r->>'id') = 'everyone' or (r->>'id') = any(mine)) then p := p || fx.list_of(r, 'permissions'); end if;
  end loop;
  if jsonb_array_length(roles) > 0 and (roles->0->>'id') is not distinct from 'everyone' and fx.is_true(roles->0->'permsV2') then return p; end if;
  return p || fx.everyone_defaults();
end $$;
create or replace function fx.is_server_boss(m fx.person, s jsonb) returns boolean language sql immutable as $$
  select coalesce(fx.str(s->'ownerId') = m.name, false) or m.rank >= 1
$$;
-- everything m may do in server s: just Administrator (everything) for its owner and Frixion staff
create or replace function fx.perms_in(m fx.person, s jsonb) returns text[] language sql stable as $$
  select case when fx.is_server_boss(m, s) then array['administrator'] else fx.role_perms_of(m, s) end
$$;
create or replace function fx.has_all(p text[], needed text[]) returns boolean language sql immutable as $$
  select 'administrator' = any(p) or needed <@ p
$$;
create or replace function fx.has_one(p text[], perms text[]) returns boolean language sql immutable as $$
  select p && (perms || 'administrator'::text)
$$;
create or replace function fx.can_manage_channels(m fx.person, s jsonb) returns boolean language sql stable as $$
  select m.ok and s is not null and fx.has_one(fx.perms_in(m, s), array['manageChannels'])
$$;
-- a member's role overrides of one kind (deny or allow), for their first 4 roles
create or replace function fx.role_ow(ow jsonb, mine text[], kind text) returns text[] language sql immutable as $$
  select coalesce(array_agg(x), '{}') from unnest(mine[1:4]) r, lateral unnest(fx.list_of(ow->r, kind)) x
$$;
-- Channel permissions, as channelPermissionsFor() in script.js: the server's (p), then the @everyone override, then the
-- member's role overrides (denies, then allows), and nothing at all without View Channels; visibleToRoles too.
create or replace function fx.chan_perms(m fx.person, s jsonb, ch jsonb, p text[]) returns text[] language plpgsql stable as $$
declare ow jsonb; ev jsonb; mine text[]; a text[]; legacy text[];
begin
  ow := case when jsonb_typeof(ch->'overwrites') = 'object' then ch->'overwrites' else '{}'::jsonb end;
  ev := case when jsonb_typeof(ow->'everyone') = 'object' then ow->'everyone' else '{}'::jsonb end;
  mine := fx.list_of(case when jsonb_typeof(s->'memberRoles') = 'object' then s->'memberRoles' else '{}'::jsonb end, m.name);
  a := array(select distinct x from unnest(p) x where not x = any(fx.list_of(ev, 'deny')));
  a := array(select distinct x from unnest(a || fx.list_of(ev, 'allow')) x);
  a := array(select x from unnest(a) x where not x = any(fx.role_ow(ow, mine, 'deny')));
  a := array(select distinct x from unnest(a || fx.role_ow(ow, mine, 'allow')) x);
  legacy := fx.list_of(ch, 'visibleToRoles');
  if 'viewChannels' = any(a) and (cardinality(legacy) = 0 or legacy && mine) then return a; end if;
  return '{}';
end $$;
create or replace function fx.can_in_channel(m fx.person, s jsonb, ch jsonb, p text[], need text[]) returns boolean language sql stable as $$
  select 'administrator' = any(p) or need <@ fx.chan_perms(m, s, ch, p)
$$;
create or replace function fx.sees_channel(m fx.person, s jsonb, ch jsonb) returns boolean language sql stable as $$
  select ch is not null and fx.in_server(m, s) and fx.can_in_channel(m, s, ch, fx.perms_in(m, s), array['viewChannels'])
$$;

-- ---------- servers ----------
-- A new server is its maker's, with only them in it, made now (so the oldest server with an invite code keeps it).
create or replace function fx.server_create_ok(m fx.person, d jsonb) returns boolean language sql stable as $$
  select m.ok and fx.str(d->'ownerId') = m.name
     and coalesce(d->'members', '[]'::jsonb) = jsonb_build_array(m.name)
     and case when d ? 'bannedUsers' then jsonb_typeof(d->'bannedUsers') = 'array' and jsonb_array_length(d->'bannedUsers') = 0 else true end
     and case when d ? 'memberRoles' then d->'memberRoles' = '{}'::jsonb else true end
     and fx.ts(d->'createdAt') = fx.now_ms()
$$;
create or replace function fx.joining(m fx.person, k text[], s jsonb, d jsonb) returns boolean language sql stable as $$
  select fx.active(m) and k <@ array['members'] and fx.only_added(s, d, 'members', m.name) and not (m.name = any(fx.set_of(s, 'bannedUsers')))
$$;
create or replace function fx.leaving(m fx.person, k text[], s jsonb, d jsonb) returns boolean language sql immutable as $$
  select k <@ array['members', 'vanished'] and fx.only_taken_out(s, d, 'members', m.name)
     and (not ('vanished' = any(k)) or fx.only_taken_out(s, d, 'vanished', m.name))
$$;
create or replace function fx.vanishing(m fx.person, k text[], s jsonb, d jsonb) returns boolean language sql immutable as $$
  select k <@ array['vanished'] and fx.is_member(m, s) and (fx.only_added(s, d, 'vanished', m.name) or fx.only_taken_out(s, d, 'vanished', m.name))
$$;
create or replace function fx.own_nickname(m fx.person, k text[], s jsonb, d jsonb) returns boolean language sql immutable as $$
  select k <@ array['nicknames'] and fx.is_member(m, s)
     and fx.changed(coalesce(s->'nicknames', '{}'::jsonb), coalesce(d->'nicknames', '{}'::jsonb)) <@ array[m.name]
$$;
-- Role order (v4.54): with Manage Roles but not Administrator, one role at a time, on someone else, below one of yours.
create or replace function fx.role_edit_ok(m fx.person, s jsonb, d jsonb) returns boolean language plpgsql stable as $$
declare e jsonb; roles jsonb; mr0 jsonb; mr1 jsonb; t text; i bigint; j bigint; r text; was text[]; now_ text[];
begin
  e := case when jsonb_typeof(d->'roleEdit') = 'object' then d->'roleEdit' else '{}'::jsonb end;
  roles := case when jsonb_typeof(s->'roles') = 'array' then s->'roles' else '[]'::jsonb end;
  mr0 := case when jsonb_typeof(s->'memberRoles') = 'object' then s->'memberRoles' else '{}'::jsonb end;
  mr1 := case when jsonb_typeof(d->'memberRoles') = 'object' then d->'memberRoles' else '{}'::jsonb end;
  if jsonb_typeof(e->'m') is distinct from 'string' or not fx.is_int(e->'i') or not fx.is_int(e->'j') then return false; end if;
  t := e->>'m'; i := (e->>'i')::bigint; j := (e->>'j')::bigint;
  if t = m.name or i < 0 or j < 0 or i >= jsonb_array_length(roles) or j >= jsonb_array_length(roles) then return false; end if;
  if not (fx.changed(mr0, mr1) <@ array[t]) then return false; end if;
  r := coalesce(roles->(i::int)->>'id', '');
  was := fx.set_of(mr0, t); now_ := fx.set_of(mr1, t);
  if not (now_ = array(select distinct x from unnest(was || r) x order by x) or now_ = array(select x from unnest(was) x where x <> r order by x)) then
    return false;
  end if;
  return coalesce((roles->(j::int)->>'id') = any(fx.list_of(mr0, m.name)), false)
     and coalesce(fx.num(roles->(j::int)->'position'), 0) > coalesce(fx.num(roles->(i::int)->'position'), 0);
end $$;
-- Moderating: a kick needs Kick Members, a ban Ban Members and so on; the audit log only from someone who can moderate.
create or replace function fx.managing(m fx.person, k text[], s jsonb, d jsonb) returns boolean language plpgsql stable as $$
declare p text[]; needed text[] := '{}';
begin
  p := fx.perms_in(m, s);
  if k && array['name', 'description', 'iconUrl'] then needed := needed || 'manageServer'::text; end if;
  if k && array['roles', 'memberRoles', 'roleEdit'] then needed := needed || 'manageRoles'::text; end if;
  if k && array['bannedUsers', 'banInfo'] then needed := needed || 'banMembers'::text; end if;
  if 'timeouts' = any(k) then needed := needed || 'timeoutMembers'::text; end if;
  if 'nicknames' = any(k) then needed := needed || 'manageNicknames'::text; end if;
  if 'members' = any(k) and not (k && array['bannedUsers', 'banInfo']) then needed := needed || 'kickMembers'::text; end if;
  if exists (select 1 from unnest(k) x where not x = any(array['name', 'description', 'iconUrl', 'roles', 'memberRoles', 'roleEdit',
             'bannedUsers', 'banInfo', 'timeouts', 'nicknames', 'members', 'apps', 'auditLog'])) then needed := needed || 'manageServer'::text; end if;
  return (fx.is_member(m, s) or m.rank >= 1) and fx.active(m)
     and (not ('members' = any(k)) or fx.only_removed(s, d, 'members'))
     and (not ('apps' = any(k)) or coalesce(fx.str(s->'ownerId') = m.name, false) or m.rank >= 2)
     and (cardinality(needed) = 0 or fx.has_all(p, needed))
     and (not ('auditLog' = any(k)) or fx.has_one(p, array['kickMembers', 'banMembers', 'timeoutMembers', 'manageMessages', 'manageServer',
                                                           'manageRoles', 'manageChannels', 'manageNicknames', 'viewAuditLog']))
     and (not ('roles' = any(k)) or 'administrator' = any(p))
     and (not ('memberRoles' = any(k)) or 'administrator' = any(p) or fx.role_edit_ok(m, s, d));
end $$;
-- Nobody takes a server over or changes its invite code. Anyone can join (unless banned), leave, vanish or set their
-- own nickname; everything else needs the matching permission.
create or replace function fx.server_update_ok(m fx.person, k text[], s jsonb, d jsonb) returns boolean language sql stable as $$
  select m.ok and fx.same(s->'ownerId', d->'ownerId') and fx.same(s->'inviteCode', d->'inviteCode') and fx.same(s->'createdAt', d->'createdAt')
     and (fx.joining(m, k, s, d) or fx.leaving(m, k, s, d) or fx.vanishing(m, k, s, d) or fx.own_nickname(m, k, s, d) or fx.managing(m, k, s, d))
$$;
create or replace function fx.sees_server(m fx.person, d jsonb) returns boolean language sql stable as $$
  select fx.active(m) and (m.name = any(fx.set_of(d, 'members')) or m.rank >= 1)
$$;

create or replace function fx.servers_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  if tg_op = 'INSERT' then ok := fx.server_create_ok(m, new.data);
  elsif tg_op = 'UPDATE' then ok := fx.server_update_ok(m, fx.changed(old.data, new.data), old.data, new.data);
  else ok := m.ok and (coalesce(fx.str(old.data->'ownerId') = m.name, false) or m.rank >= 2);
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;

-- ---------- channels, categories, threads, slowmode stamps ----------
-- What anyone in a server may change on a channel: the stamp of their own newest message there (unread dots).
create or replace function fx.channel_update_ok(m fx.person, s jsonb, sid text, cid text, k text[], d jsonb) returns boolean language sql stable as $$
  select fx.in_server(m, s) and (
    (k <@ array['lastMessageAt', 'lastMessage'] and coalesce(fx.str(d->'lastMessage'->'uid') = m.name, false)
       and fx.ok_id(fx.str(d->'lastMessage'->'mid'))
       and coalesce(fx.str(fx.got('servers/' || sid || '/channels/' || cid || '/messages/' || fx.str(d->'lastMessage'->'mid'))->'uid') = m.name, false))
    or fx.has_one(fx.perms_in(m, s), array['manageChannels']))
$$;
create or replace function fx.channels_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; s jsonb; ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who(); s := fx.srv(coalesce(new.server_id, old.server_id));
  if s is null then ok := false;
  elsif tg_op = 'UPDATE' then ok := fx.channel_update_ok(m, s, new.server_id, new.id, fx.changed(old.data, new.data), new.data);
  else ok := fx.can_manage_channels(m, s);
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
create or replace function fx.categories_rules() returns trigger language plpgsql set search_path = '' as $$
begin
  if fx.trusted() then return coalesce(new, old); end if;
  if not coalesce(fx.can_manage_channels(fx.who(), fx.srv(coalesce(new.server_id, old.server_id))), false) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create or replace function fx.threads_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; s jsonb; ch jsonb; ok boolean; k text[];
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who(); s := fx.srv(coalesce(new.server_id, old.server_id));
  if s is null then ok := false;
  elsif tg_op = 'INSERT' then
    ch := fx.chan(new.server_id, coalesce(fx.str(new.data->'channelId'), '-'));
    ok := fx.in_server(m, s) and fx.can_post(m) and fx.str(new.data->'createdBy') = m.name
          and ch is not null and fx.can_in_channel(m, s, ch, fx.perms_in(m, s), array['viewChannels']);
  elsif tg_op = 'UPDATE' then
    k := fx.changed(old.data, new.data);
    ok := fx.in_server(m, s) and ((k <@ array['lastMessageAt', 'messageCount']
                                    and coalesce(fx.num(new.data->'messageCount'), 0) = coalesce(fx.num(old.data->'messageCount'), 0) + 1)
                                   or coalesce(fx.str(old.data->'createdBy') = m.name, false)
                                   or fx.has_one(fx.perms_in(m, s), array['manageThreads']));
  else
    ok := m.ok and (coalesce(fx.str(old.data->'createdBy') = m.name, false) or fx.has_one(fx.perms_in(m, s), array['manageThreads', 'manageChannels']));
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
-- slow/{name}: only ever set to now, by its owner, never removed
create or replace function fx.slow_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  if tg_op = 'DELETE' or not coalesce(fx.is_who(m, new.id) and fx.keys(new.data) <@ array['at'] and fx.ts(new.data->'at') = fx.now_ms()
                                      and fx.in_server(m, fx.srv(new.server_id)), false) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------- server cards: what anyone may see before joining, kept exactly in step with the server ----------
create or replace function fx.card_matches(m fx.person, s jsonb, d jsonb) returns boolean language sql stable as $$
  select s is not null and fx.active(m) and fx.is_member(m, s)
     and fx.keys(d) <@ array['name', 'iconUrl', 'description', 'inviteCode', 'memberCount', 'createdAt']
     and fx.same(d->'name', s->'name') and fx.same(d->'iconUrl', s->'iconUrl') and fx.same(d->'description', s->'description')
     and fx.same(d->'inviteCode', s->'inviteCode') and fx.same(d->'createdAt', s->'createdAt')
     and coalesce(fx.num(coalesce(d->'memberCount', '-1'::jsonb)) =
                  cardinality(array(select x from unnest(fx.set_of(s, 'members')) x where not x = any(fx.set_of(s, 'vanished')))), false)
$$;
create or replace function fx.cards_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  if tg_op = 'DELETE' then ok := fx.got('servers/' || old.id) is null or fx.is_owner_level(m);
  else ok := fx.card_matches(m, fx.srv(new.id), new.data);
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;

-- ---------- policies, grants, triggers ----------
alter table public.servers enable row level security;
alter table public.channels enable row level security;
alter table public.categories enable row level security;
alter table public.threads enable row level security;
alter table public.channel_slow enable row level security;
alter table public.server_cards enable row level security;

create policy servers_read on public.servers for select to authenticated
  using (fx.sees_server((select fx.who()), data) or fx.is_writing('servers', array[id]));   -- others see its card
create policy channels_read on public.channels for select to authenticated
  using (fx.in_server((select fx.who()), fx.srv(server_id)) or fx.is_writing('channels', array[server_id, id]));
create policy categories_read on public.categories for select to authenticated
  using (fx.in_server((select fx.who()), fx.srv(server_id)) or fx.is_writing('categories', array[server_id, id]));
create policy threads_read on public.threads for select to authenticated
  using (fx.in_server((select fx.who()), fx.srv(server_id)) or fx.is_writing('threads', array[server_id, id]));
create policy slow_read on public.channel_slow for select to authenticated
  using (fx.is_who((select fx.who()), id) or fx.is_writing('channel_slow', array[server_id, channel_id, id]));
create policy cards_read on public.server_cards for select to authenticated using (fx.signed_in());

do $$
declare t text;
begin
  foreach t in array array['servers', 'channels', 'categories', 'threads', 'channel_slow', 'server_cards'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (true)', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (true)', t || '_delete', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create or replace trigger stamp before insert or update on public.%I for each row execute function fx.stamp()', t);
  end loop;
end $$;
create or replace trigger rules before insert or update or delete on public.servers for each row execute function fx.servers_rules();
create or replace trigger rules before insert or update or delete on public.channels for each row execute function fx.channels_rules();
create or replace trigger rules before insert or update or delete on public.categories for each row execute function fx.categories_rules();
create or replace trigger rules before insert or update or delete on public.threads for each row execute function fx.threads_rules();
create or replace trigger rules before insert or update or delete on public.channel_slow for each row execute function fx.slow_rules();
create or replace trigger rules before insert or update or delete on public.server_cards for each row execute function fx.cards_rules();


-- ======================== 005_messages.sql ========================
-- Frixion on Supabase, part 5: server messages (in channels and threads) and mentions (rules: the messages helpers,
-- channels/{cid}/messages, threads/{tid}/messages, users/{u}/mentions create). DMs and groups reuse the helpers.

create table if not exists public.channel_messages (server_id text not null, channel_id text not null, id text not null,
  data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (server_id, channel_id, id));
create table if not exists public.thread_messages (server_id text not null, thread_id text not null, id text not null,
  data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (server_id, thread_id, id));
insert into fx.routes (pattern, tbl, cols) values
  ('servers/*/channels/*/messages/*', 'channel_messages', '{server_id,channel_id,id}'),
  ('servers/*/threads/*/messages/*', 'thread_messages', '{server_id,thread_id,id}')
on conflict (pattern) do update set tbl = excluded.tbl, cols = excluded.cols;

-- ---------- message helpers ----------
create or replace function fx.arr_len(j jsonb) returns int language sql immutable as $$
  select case when jsonb_typeof(j) = 'array' then jsonb_array_length(j) else 0 end
$$;
-- Message text within the app's limits: the Owner's up to 900,000 characters, everyone else's 10,000.
create or replace function fx.text_fits(t jsonb, m fx.person) returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(t) = 'string' and length(t #>> '{}') <= case when m.ok and m.rank >= 3 then 900000 else 10000 end, false)
$$;
-- A new message is stamped with the real time, give or take a few minutes, and its text isn't huge.
create or replace function fx.fresh_and_small(d jsonb, m fx.person) returns boolean language sql stable as $$
  select coalesce(fx.ts(d->'createdAt') > fx.now_ms() - 300000 and fx.ts(d->'createdAt') < fx.now_ms() + 60000, false)
     and (not (d ? 'text') or fx.text_fits(d->'text', m))
$$;
create or replace function fx.new_author_is_me(m fx.person, d jsonb) returns boolean language sql stable as $$
  select coalesce(fx.str(d->'uid') = m.name, false) and fx.fresh_and_small(d, m)
$$;
-- Sapphire posts purge results (only for someone who can purge there) and Wordle posts game cards, as themselves.
create or replace function fx.new_bot_message(m fx.person, d jsonb, can_purge boolean) returns boolean language sql stable as $$
  select coalesce(fx.fresh_and_small(d, m) and fx.str(d->'uid') = 'bot-sapphire' and can_purge
                  and fx.keys(d) <@ array['uid', 'username', 'createdAt', 'purgeResult', 'replyTo'], false)
      or coalesce(fx.str(d->'uid') = 'bot-wordle' and fx.keys(d) <@ array['uid', 'username', 'createdAt', 'wordle', 'replyTo']
                  and fx.str(d->'wordle'->'startedBy') = m.name and fx.fresh_and_small(d, m), false)
$$;
create or replace function fx.is_mine(m fx.person, old jsonb) returns boolean language sql immutable as $$
  select coalesce(fx.str(old->'uid') = m.name, false)
$$;
-- A reaction: only the one lastReaction names, and only your own name added or taken off.
create or replace function fx.my_reaction_only(m fx.person, old jsonb, d jsonb) returns boolean language plpgsql immutable as $$
declare lr jsonb; e text; b jsonb; a jsonb;
begin
  lr := case when jsonb_typeof(d->'lastReaction') = 'object' then d->'lastReaction' else '{}'::jsonb end;
  if fx.str(lr->'by') is distinct from m.name or fx.str(lr->'e') is null or lr->>'e' = '' then return false; end if;
  e := lr->>'e';
  b := coalesce(old->'reactions', '{}'::jsonb); a := coalesce(d->'reactions', '{}'::jsonb);
  if jsonb_typeof(b) <> 'object' or jsonb_typeof(a) <> 'object' then return false; end if;
  if not (fx.changed(b, a) <@ array[e]) then return false; end if;
  return fx.set_of(a, e) = array(select distinct x from unnest(fx.set_of(b, e) || m.name) x order by x)
      or fx.set_of(a, e) = array(select x from unnest(fx.set_of(b, e)) x where x <> m.name order by x);
end $$;
-- a vote: only your own entry in poll.votes; a Wordle play: only your own entry in wordle.plays
create or replace function fx.only_my_entry(m fx.person, old jsonb, d jsonb, f text, sub text) returns boolean language plpgsql immutable as $$
declare b jsonb; a jsonb;
begin
  b := coalesce(old->f, '{}'::jsonb); a := coalesce(d->f, '{}'::jsonb);
  if jsonb_typeof(b) <> 'object' or jsonb_typeof(a) <> 'object' then return false; end if;
  if not (fx.changed(b, a) <@ array[sub]) then return false; end if;
  if jsonb_typeof(coalesce(b->sub, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(a->sub, '{}'::jsonb)) <> 'object' then return false; end if;
  return coalesce(fx.changed(coalesce(b->sub, '{}'::jsonb), coalesce(a->sub, '{}'::jsonb)) <@ array[m.name], false);
end $$;
-- Moderation on someone else's message only takes things away: its text (when a file stays) or a file.
create or replace function fx.clearing_only(k text[], old jsonb, d jsonb) returns boolean language sql immutable as $$
  select (not ('text' = any(k)) or coalesce(d->'text', '""'::jsonb) = '""'::jsonb)
     and (not ('edited' = any(k)) or coalesce(d->'edited', 'false'::jsonb) = 'false'::jsonb)
     and (not ('attachments' = any(k)) or fx.arr_len(d->'attachments') < fx.arr_len(old->'attachments') + case when old ? 'attachment' then 1 else 0 end)
     and (not ('attachment' = any(k)) or not (d ? 'attachment'))
$$;
-- Your own message: anything but who sent it, and only your own reaction.
create or replace function fx.own_edit(m fx.person, k text[], old jsonb, d jsonb) returns boolean language sql immutable as $$
  select fx.is_mine(m, old) and not (k && array['uid', 'createdAt'])
     and (not (k && array['reactions', 'lastReaction']) or fx.my_reaction_only(m, old, d))
     and (not ('text' = any(k)) or fx.text_fits(d->'text', m))
$$;
-- Someone else's message in a DM or group: react, vote, play its Wordle.
create or replace function fx.dm_others_edit(m fx.person, k text[], old jsonb, d jsonb) returns boolean language sql immutable as $$
  select k <@ array['reactions', 'lastReaction', 'poll', 'wordle']
     and (not (k && array['reactions', 'lastReaction']) or fx.my_reaction_only(m, old, d))
     and (not ('poll' = any(k)) or fx.only_my_entry(m, old, d, 'poll', 'votes'))
     and (not ('wordle' = any(k)) or fx.only_my_entry(m, old, d, 'wordle', 'plays'))
$$;
-- ... and in a server: also start a thread on it, and with the permission pin it or clear it.
create or replace function fx.server_others_edit(m fx.person, k text[], p text[], old jsonb, d jsonb) returns boolean language sql immutable as $$
  select k <@ array['reactions', 'lastReaction', 'poll', 'wordle', 'thread', 'pinned', 'text', 'edited', 'attachments', 'attachment']
     and (not (k && array['reactions', 'lastReaction']) or fx.my_reaction_only(m, old, d))
     and (not ('poll' = any(k)) or fx.only_my_entry(m, old, d, 'poll', 'votes'))
     and (not ('wordle' = any(k)) or fx.only_my_entry(m, old, d, 'wordle', 'plays'))
     and (not (k && array['text', 'edited', 'attachments', 'attachment']) or (fx.clearing_only(k, old, d) and fx.has_one(p, array['manageMessages'])))
     and (not ('pinned' = any(k)) or fx.has_one(p, array['pinMessages', 'manageMessages']))
$$;
-- Auto-delete: whoever opens a conversation sweeps its messages older than 7 days.
create or replace function fx.is_old(old jsonb) returns boolean language sql stable as $$
  select coalesce(fx.ts(old->'createdAt') < fx.now_ms() - 7 * 86400000, false)
$$;
-- @everyone and @here only from someone with Mention @everyone there, or the message carries everyoneBlocked.
create or replace function fx.everyone_ok(cp text[], d jsonb) returns boolean language sql immutable as $$
  select 'mentionEveryone' = any(cp) or fx.is_true(d->'everyoneBlocked')
      or not coalesce(fx.str(d->'text') ~* '^(.*[[:space:](>])?@(everyone|here)(\y.*)?$', false)
$$;
-- Slowmode (v4.54): the message comes with a stamp of now, and the stamp before it is at least that many seconds old.
create or replace function fx.slow_ok(m fx.person, ch jsonb, cp text[], sid text, cid text) returns boolean language plpgsql stable
security definer set search_path = '' as $$
declare secs numeric; after_at numeric; before jsonb;
begin
  secs := fx.num(ch->'slowmode');
  if secs is null or secs <= 0 or cp && array['bypassSlowmode', 'manageChannels', 'manageMessages'] then return true; end if;
  select fx.ts(s.data->'at') into after_at from public.channel_slow s where s.server_id = sid and s.channel_id = cid and s.id = m.name;
  before := fx.got('servers/' || sid || '/channels/' || cid || '/slow/' || m.name);
  return coalesce(after_at = fx.now_ms(), false)
     and (before is null or coalesce(fx.ts(before->'at') <= fx.now_ms() - trunc(secs) * 1000, false));
end $$;

-- ---------- channel messages ----------
-- Posting needs View Channels and Send Messages there, and keeping to slowmode. It's checked at the end of the batch,
-- because the slowmode stamp that goes with it may come after it in the same batch (the rules' getAfter).
create or replace function fx.ch_msg_create_ok(m fx.person, s jsonb, ch jsonb, sid text, cid text, d jsonb) returns boolean language plpgsql stable as $$
declare p text[]; admin boolean; cp text[];
begin
  if s is null or ch is null then return false; end if;
  p := fx.perms_in(m, s); admin := 'administrator' = any(p);
  cp := case when admin then '{}'::text[] else fx.chan_perms(m, s, ch, p) end;
  return fx.in_server(m, s) and fx.can_post(m) and fx.not_timed_out(m, s) and (admin or cp @> array['viewChannels', 'sendMessages'])
     and ((fx.new_author_is_me(m, d) and (admin or (fx.slow_ok(m, ch, cp, sid, cid) and fx.everyone_ok(cp, d))))
          or fx.new_bot_message(m, d, fx.purger(m)));
end $$;
create or replace function fx.ch_msg_created() returns trigger language plpgsql set search_path = '' as $$
begin
  if fx.trusted() then return null; end if;
  if not coalesce(fx.ch_msg_create_ok(fx.who(), fx.srv(new.server_id), fx.chan(new.server_id, new.channel_id), new.server_id, new.channel_id, new.data), false) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return null;
end $$;
create or replace function fx.ch_msgs_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; s jsonb; ch jsonb; ok boolean; p text[];
begin
  if fx.trusted() or tg_op = 'INSERT' then return coalesce(new, old); end if;   -- (new ones: fx.ch_msg_created)
  m := fx.who(); s := fx.srv(old.server_id); ch := fx.chan(old.server_id, old.channel_id);
  if s is null or ch is null then ok := false;
  elsif tg_op = 'UPDATE' then
    p := fx.perms_in(m, s);
    ok := fx.in_server(m, s) and fx.can_in_channel(m, s, ch, p, array['viewChannels'])
          and (fx.own_edit(m, fx.changed(old.data, new.data), old.data, new.data) or fx.server_others_edit(m, fx.changed(old.data, new.data), p, old.data, new.data));
  else   -- your own; anyone's with Manage Messages; and old ones when the channel auto-deletes
    ok := m.ok and (fx.is_mine(m, old.data) or m.rank >= 1 or (fx.purge_ok(m) and fx.sees_channel(m, s, ch))
                    or (fx.is_member(m, s) and fx.active(m) and ((fx.is_old(old.data) and coalesce(ch->'autoDelete', 'true'::jsonb) <> 'false'::jsonb)
                                                                 or fx.has_one(fx.perms_in(m, s), array['manageMessages', 'manageChannels']))));
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;

-- ---------- thread messages: they go with the thread's channel ----------
create or replace function fx.thread_chan(sid text, tid text) returns jsonb language sql stable as $$
  select fx.chan(sid, coalesce(fx.str(fx.thread_of(sid, tid)->'channelId'), '-'))
$$;
create or replace function fx.th_msgs_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; s jsonb; ch jsonb; ok boolean; p text[]; admin boolean; cp text[]; k text[];
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who(); s := fx.srv(coalesce(new.server_id, old.server_id));
  if s is null then ok := false;
  elsif tg_op = 'DELETE' then
    ok := m.ok and (fx.is_mine(m, old.data) or m.rank >= 1
                    or (fx.is_member(m, s) and fx.active(m) and (fx.purge_ok(m) or fx.has_one(fx.perms_in(m, s), array['manageMessages', 'manageChannels']))));
  else
    ch := fx.thread_chan(new.server_id, new.thread_id);
    p := fx.perms_in(m, s);
    if ch is null then ok := false;
    elsif tg_op = 'INSERT' then
      admin := 'administrator' = any(p);
      cp := case when admin then '{}'::text[] else fx.chan_perms(m, s, ch, p) end;
      ok := fx.in_server(m, s) and fx.can_post(m) and fx.not_timed_out(m, s) and (admin or cp @> array['viewChannels', 'sendMessagesInThreads'])
            and ((fx.new_author_is_me(m, new.data) and (admin or fx.everyone_ok(cp, new.data))) or fx.new_bot_message(m, new.data, fx.purger(m)));
    else
      k := fx.changed(old.data, new.data);
      ok := fx.in_server(m, s) and fx.can_in_channel(m, s, ch, p, array['viewChannels'])
            and (fx.own_edit(m, k, old.data, new.data) or fx.server_others_edit(m, k, p, old.data, new.data));
    end if;
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;

-- ---------- mentions: a note for someone your own message in a server mentions ----------
-- Only about your own real message there, with the real server, channel and thread names on it (v4.54).
create or replace function fx.mention_create_ok(m fx.person, username text, d jsonb) returns boolean language plpgsql stable as $$
declare s jsonb; threaded boolean; msg jsonb; sid text; cid text; tid text; mid text;
begin
  sid := fx.str(d->'sid'); cid := fx.str(d->'cid'); tid := fx.str(d->'tid'); mid := fx.str(d->'mid');
  s := fx.srv(sid);
  if s is null or not fx.ok_id(mid) then return false; end if;
  threaded := coalesce(d->'tid', 'null'::jsonb) <> 'null'::jsonb;
  msg := case when threaded then case when fx.ok_id(tid) then fx.got('servers/' || sid || '/threads/' || tid || '/messages/' || mid) end
              else case when fx.ok_id(cid) then fx.got('servers/' || sid || '/channels/' || cid || '/messages/' || mid) end end;
  return fx.active(m) and username <> m.name and coalesce(fx.str(d->'from') = m.name, false)
     and m.name = any(fx.set_of(s, 'members')) and username = any(fx.set_of(s, 'members')) and coalesce(fx.str(msg->'uid') = m.name, false)
     and fx.keys(d) <@ array['sid', 'cid', 'tid', 'mid', 'from', 'text', 'at', 'server', 'channel', 'thread']
     and coalesce(jsonb_typeof(coalesce(d->'text', '""'::jsonb)) = 'string' and length(coalesce(d->>'text', '')) <= 200, false)
     and coalesce(fx.ts(d->'at') = fx.now_ms(), false)
     and coalesce(d->'server', '""'::jsonb) = coalesce(s->'name', '""'::jsonb)
     and coalesce(d->'channel', '""'::jsonb) = coalesce(fx.chan(sid, cid)->'name', '""'::jsonb)
     and coalesce(d->'thread', '""'::jsonb) = case when threaded then coalesce(fx.thread_of(sid, tid)->'name', '""'::jsonb) else '""'::jsonb end;
end $$;
create or replace function fx.mentions_rules() returns trigger language plpgsql set search_path = '' as $$
begin
  if fx.trusted() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' and not coalesce(fx.mention_create_ok(fx.who(), new.user_id, new.data), false) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

-- ---------- policies, grants, triggers ----------
alter table public.channel_messages enable row level security;
alter table public.thread_messages enable row level security;
create policy channel_messages_read on public.channel_messages for select to authenticated
  using (fx.sees_channel((select fx.who()), fx.srv(server_id), fx.chan(server_id, channel_id))
         or fx.is_writing('channel_messages', array[server_id, channel_id, id]));
create policy thread_messages_read on public.thread_messages for select to authenticated
  using (fx.sees_channel((select fx.who()), fx.srv(server_id), fx.thread_chan(server_id, thread_id))
         or fx.is_writing('thread_messages', array[server_id, thread_id, id]));
do $$
declare t text;
begin
  foreach t in array array['channel_messages', 'thread_messages'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (true)', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (true)', t || '_delete', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create or replace trigger stamp before insert or update on public.%I for each row execute function fx.stamp()', t);
  end loop;
end $$;
create or replace trigger rules before insert or update or delete on public.channel_messages for each row execute function fx.ch_msgs_rules();
create constraint trigger created after insert on public.channel_messages deferrable initially deferred for each row execute function fx.ch_msg_created();
create or replace trigger rules before insert or update or delete on public.thread_messages for each row execute function fx.th_msgs_rules();
-- mentions can be made now
create policy mentions_create on public.user_mentions for insert to authenticated with check (true);   -- (the trigger decides)
grant insert on public.user_mentions to authenticated;
create or replace trigger rules before insert or update or delete on public.user_mentions for each row execute function fx.mentions_rules();


-- ======================== 006_dms.sql ========================
-- Frixion on Supabase, part 6: DMs and group DMs, and their messages (rules: dms, groupDMs). Typing notes move to
-- Realtime, so they have no tables here.

create table if not exists public.dms (id text primary key, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.group_dms (id text primary key, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
-- (both message tables call their conversation conv_id, so one set of rules serves them)
create table if not exists public.dm_messages (conv_id text not null, id text not null, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (conv_id, id));
create table if not exists public.group_messages (conv_id text not null, id text not null, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (conv_id, id));
insert into fx.routes (pattern, tbl, cols) values
  ('dms/*', 'dms', '{id}'),
  ('groupDMs/*', 'group_dms', '{id}'),
  ('dms/*/messages/*', 'dm_messages', '{conv_id,id}'),
  ('groupDMs/*/messages/*', 'group_messages', '{conv_id,id}')
on conflict (pattern) do update set tbl = excluded.tbl, cols = excluded.cols;

-- ---------- helpers ----------
create or replace function fx.in_conv(m fx.person, c jsonb) returns boolean language sql stable as $$
  select c is not null and fx.active(m) and coalesce(m.name = any(fx.set_of(c, 'participants')), false)
$$;
-- the conversation a message belongs to, the way get() sees it
create or replace function fx.conv_of(tbl text, conv_id text) returns jsonb language sql stable as $$
  select case when fx.ok_id(conv_id) then fx.got(case when tbl = 'dm_messages' then 'dms/' else 'groupDMs/' end || conv_id) end
$$;
-- The preview of a conversation's last message carries the sender's own name, or a bot's.
create or replace function fx.preview_ok(k text[], m fx.person, d jsonb) returns boolean language sql immutable as $$
  select not ('lastMessage' = any(k)) or coalesce(fx.str(d->'lastMessage'->'username'), '') = any(array[m.name, 'Sapphire', 'Wordle'])
$$;
-- A DM's blockedBy: only yourself, added or taken out, and only added while the other person isn't ranked above you.
create or replace function fx.blocked_by_ok(m fx.person, k text[], old jsonb, d jsonb) returns boolean language plpgsql stable as $$
declare ps text[]; other text; u jsonb;
begin
  if not ('blockedBy' = any(k)) then return true; end if;
  ps := fx.list_of(old, 'participants');
  if not coalesce(m.name = any(ps), false) then return false; end if;
  if fx.only_taken_out(old, d, 'blockedBy', m.name) then return true; end if;
  other := case when ps[1] = m.name then ps[2] else ps[1] end;
  u := fx.user_data(other);
  return fx.only_added(old, d, 'blockedBy', m.name) and u is not null and fx.rank_of(u) <= m.rank;
end $$;
-- A DM's id is its two usernames, sorted and joined with "_" (dmIdFor() in script.js), and nobody who blocked you.
create or replace function fx.dm_create_ok(m fx.person, did text, d jsonb) returns boolean language plpgsql stable as $$
declare p text[];
begin
  if not m.ok or jsonb_typeof(d->'participants') is distinct from 'array' or jsonb_array_length(d->'participants') <> 2 then return false; end if;
  p := fx.list_of(d, 'participants');
  return m.name = any(p) and (did = p[1] || '_' || p[2] or did = p[2] || '_' || p[1])
     and not (d ? 'blockedBy') and not fx.blocks_me(m, case when p[1] = m.name then p[2] else p[1] end);
end $$;
create or replace function fx.dm_update_ok(m fx.person, k text[], old jsonb, d jsonb) returns boolean language sql stable as $$
  select fx.active(m) and fx.preview_ok(k, m, d) and fx.same(old->'participants', d->'participants')
     and (coalesce(m.name = any(fx.set_of(old, 'participants')), false) or m.rank >= 1) and fx.blocked_by_ok(m, k, old, d)
$$;
-- Only your friends can be put in a group by you.
create or replace function fx.only_friends_added(m fx.person, before text[], d jsonb) returns boolean language sql immutable as $$
  select not exists (select 1 from unnest(fx.set_of(d, 'participants')) x
                     where not x = any(before) and not x = any(fx.set_of(m.u, 'friends') || m.name))
$$;
create or replace function fx.group_create_ok(m fx.person, d jsonb) returns boolean language sql stable as $$
  select m.ok and jsonb_typeof(d->'participants') = 'array' and coalesce(m.name = any(fx.list_of(d, 'participants')), false)
     and coalesce(fx.str(d->'ownerId') = m.name, false) and fx.only_friends_added(m, '{}', d)
$$;
-- People in the group change it (adding their friends, or leaving); only the group's owner takes someone else out,
-- and hands the group on when they leave.
create or replace function fx.group_update_ok(m fx.person, k text[], old jsonb, d jsonb) returns boolean language sql stable as $$
  select fx.active(m) and (coalesce(m.name = any(fx.set_of(old, 'participants')), false) or m.rank >= 1) and fx.preview_ok(k, m, d)
     and (fx.same(old->'ownerId', d->'ownerId') or coalesce(fx.str(old->'ownerId') = m.name, false) or m.rank >= 1)
     and (fx.same(old->'participants', d->'participants') or m.rank >= 1
          or (fx.only_friends_added(m, fx.set_of(old, 'participants'), d)
              and (coalesce(fx.str(old->'ownerId') = m.name, false)
                   or not exists (select 1 from unnest(fx.set_of(old, 'participants')) x
                                  where not x = any(fx.set_of(d, 'participants')) and x <> m.name))))
$$;

create or replace function fx.convs_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; ok boolean; k text[];
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  if tg_op = 'INSERT' then
    ok := case when tg_table_name = 'dms' then fx.dm_create_ok(m, new.id, new.data) else fx.group_create_ok(m, new.data) end;
  elsif tg_op = 'UPDATE' then
    k := fx.changed(old.data, new.data);
    ok := case when tg_table_name = 'dms' then fx.dm_update_ok(m, k, old.data, new.data) else fx.group_update_ok(m, k, old.data, new.data) end;
  else
    ok := fx.is_owner_level(m);
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
create or replace function fx.conv_msgs_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; c jsonb; ok boolean; k text[];
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  c := fx.conv_of(tg_table_name, coalesce(new.conv_id, old.conv_id));
  if tg_op = 'INSERT' then
    -- (Sapphire's purge cards here only for whoever can purge: the Owner and those given purge perms)
    ok := fx.in_conv(m, c) and fx.can_post(m)
          and cardinality(array(select x from unnest(fx.set_of(c, 'blockedBy')) x where x <> m.name)) = 0
          and (fx.new_author_is_me(m, new.data) or fx.new_bot_message(m, new.data, fx.purger(m)));
  elsif tg_op = 'UPDATE' then
    k := fx.changed(old.data, new.data);
    ok := fx.in_conv(m, c) and (fx.own_edit(m, k, old.data, new.data) or fx.dm_others_edit(m, k, old.data, new.data));
  else
    ok := fx.in_conv(m, c) and (fx.is_mine(m, old.data) or m.rank >= 1 or fx.purge_ok(m)
                                or (fx.is_old(old.data) and coalesce(c->'autoDelete', 'true'::jsonb) <> 'false'::jsonb));
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;

-- ---------- policies, grants, triggers ----------
alter table public.dms enable row level security;
alter table public.group_dms enable row level security;
alter table public.dm_messages enable row level security;
alter table public.group_messages enable row level security;
create policy dms_read on public.dms for select to authenticated
  using ((fx.active((select fx.who())) and (coalesce((select fx.who()).name = any(fx.set_of(data, 'participants')), false) or (select fx.who()).rank >= 1))
         or fx.is_writing('dms', array[id]));
create policy group_dms_read on public.group_dms for select to authenticated
  using ((fx.active((select fx.who())) and (coalesce((select fx.who()).name = any(fx.set_of(data, 'participants')), false) or (select fx.who()).rank >= 1))
         or fx.is_writing('group_dms', array[id]));
create policy dm_messages_read on public.dm_messages for select to authenticated
  using (fx.in_conv((select fx.who()), fx.conv_of('dm_messages', conv_id)) or fx.is_writing('dm_messages', array[conv_id, id]));
create policy group_messages_read on public.group_messages for select to authenticated
  using (fx.in_conv((select fx.who()), fx.conv_of('group_messages', conv_id)) or fx.is_writing('group_messages', array[conv_id, id]));
do $$
declare t text;
begin
  foreach t in array array['dms', 'group_dms', 'dm_messages', 'group_messages'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (true)', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (true)', t || '_delete', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create or replace trigger stamp before insert or update on public.%I for each row execute function fx.stamp()', t);
  end loop;
end $$;
create or replace trigger rules before insert or update or delete on public.dms for each row execute function fx.convs_rules();
create or replace trigger rules before insert or update or delete on public.group_dms for each row execute function fx.convs_rules();
create or replace trigger rules before insert or update or delete on public.dm_messages for each row execute function fx.conv_msgs_rules();
create or replace trigger rules before insert or update or delete on public.group_messages for each row execute function fx.conv_msgs_rules();


-- ======================== 007_records.sql ========================
-- Frixion on Supabase, part 7: codes, Orbs records, loans, Shop prices, device and network bans, one-time passwords
-- (rules: redeemCodes, orbDays, eggs, loans, shopPrices, bannedHw, devices, loginCodes, ips, bannedIps), and
-- public.fx_get, reading one document the way Firestore's "get" rules allow.

-- ---------- tables ----------
do $$
declare t text;
begin
  foreach t in array array['redeem_codes', 'orb_days', 'eggs', 'loans', 'shop_prices', 'banned_hw', 'devices', 'login_codes', 'ips', 'banned_ips'] loop
    execute format('create table if not exists public.%I (id text primary key, data jsonb not null default ''{}''::jsonb,
                    created_at timestamptz not null default now(), updated_at timestamptz not null default now())', t);
  end loop;
end $$;
insert into fx.routes (pattern, tbl, cols) values
  ('redeemCodes/*', 'redeem_codes', '{id}'), ('orbDays/*', 'orb_days', '{id}'), ('eggs/*', 'eggs', '{id}'),
  ('loans/*', 'loans', '{id}'), ('shopPrices/*', 'shop_prices', '{id}'), ('bannedHw/*', 'banned_hw', '{id}'),
  ('devices/*', 'devices', '{id}'), ('loginCodes/*', 'login_codes', '{id}'), ('ips/*', 'ips', '{id}'), ('bannedIps/*', 'banned_ips', '{id}')
on conflict (pattern) do update set tbl = excluded.tbl, cols = excluded.cols;

-- ---------- reading one document (Firestore's "get") ----------
-- Lists (and live listeners) use the tables' read policies, which hold Firestore's "list" rules. A few collections let
-- more people fetch one document by its exact name than list them: a computer's ban before anyone signs in, your own
-- Orbs-per-day and egg records, a code you made, an Overcontrol RNG code, and staff looking up a sign-in. fx_get reads
-- through the policies first, then checks those exceptions. A document that doesn't exist comes back as not existing.
create or replace function fx.get_exception(tbl text, ids text[], d jsonb) returns boolean language plpgsql stable
security definer set search_path = '' as $$
declare m fx.person;
begin
  m := fx.who();
  return coalesce(case tbl
    when 'banned_hw' then true                                                   -- checked before anyone signs in
    when 'devices' then true                                                     -- (the same)
    when 'redeem_codes' then m.ok and (m.rank >= 1 or fx.str(d->'createdBy') = m.name)
    when 'accounts' then m.ok and m.rank >= 1
    when 'orb_days' then m.ok and (m.name = ids[1] or m.rank >= 1)
    when 'eggs' then m.ok and (m.name = ids[1] or m.rank >= 1)
    when 'rng_codes' then fx.signed_in()
    else false end, false);
end $$;
create or replace function public.fx_get(path text) returns jsonb language plpgsql set search_path = '' as $$
declare r_tbl text; r_cols text[]; r_ids text[]; d jsonb; u text; p jsonb;
begin
  select * into r_tbl, r_cols, r_ids from fx.route(path);
  begin
    execute format('select data, updated_at::text from public.%I where %s', r_tbl, fx.key_where(r_cols)) into d, u using r_ids;
  exception when insufficient_privilege then d := null;   -- (signed out: most tables aren't readable at all)
  end;
  -- (updatedAt: what a transaction hands back to fx_commit to make sure nothing changed in between)
  if d is not null then return jsonb_build_object('exists', true, 'data', d, 'updatedAt', u); end if;
  p := fx.peek_any(r_tbl, r_cols, r_ids);
  if p is null then
    -- Missing. Firestore answers "not found" only to someone its rules would let read a document there; anyone else
    -- gets "permission denied" (so nobody learns what other people don't have). A few rules let anyone fetch a
    -- missing one (codes, DMs and groups, banned-computer checks); otherwise a blank sample row tells.
    if fx.get_exception(r_tbl, r_ids, null)
       or (r_tbl = 'redeem_codes')
       or (r_tbl in ('dms', 'group_dms') and fx.active(fx.who()))
       or fx.probe_visible(r_tbl, r_cols, r_ids) then
      return jsonb_build_object('exists', false, 'data', null, 'updatedAt', null);
    end if;
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if fx.get_exception(r_tbl, r_ids, p->'data') then return jsonb_build_object('exists', true, 'data', p->'data', 'updatedAt', p->'updatedAt'); end if;
  raise exception 'permission denied' using errcode = '42501';
end $$;
-- Would this person see a document at that place? A blank row is put there (with the database's own rights), looked
-- for through the read policies as the person asking, and taken back out: the whole thing is undone, every time.
create or replace function fx.probe_put(tbl text, cols text[], ids text[]) returns void language plpgsql
security definer set search_path = '' as $$
begin
  if coalesce(current_setting('fx.probing', true), '') <> '1' then raise exception 'not inside a probe' using errcode = '42501'; end if;
  execute format('insert into public.%I (%s, data) values (%s, ''{}''::jsonb)', tbl,
                 (select string_agg(quote_ident(c), ', ') from unnest(cols) c),
                 (select string_agg(format('$1[%s]', i), ', ') from generate_subscripts(cols, 1) i)) using ids;
end $$;
create or replace function fx.probe_visible(tbl text, cols text[], ids text[]) returns boolean language plpgsql set search_path = '' as $$
declare vis boolean := false;
begin
  begin
    perform set_config('fx.probing', '1', true);
    perform fx.probe_put(tbl, cols, ids);
    perform set_config('fx.probing', '', true);
    begin
      execute format('select true from public.%I where %s', tbl, fx.key_where(cols)) into vis using ids;
    exception when insufficient_privilege then vis := false;
    end;
    raise exception 'probe done' using errcode = 'FXPRB';   -- (undoes the blank row)
  exception
    when sqlstate 'FXPRB' then null;
    when unique_violation then vis := false;   -- (someone made it just now)
  end;
  return coalesce(vis, false);
end $$;
-- (fx.peek is only for the database's own functions; fx_get may look, for the exceptions above, through this)
create or replace function fx.peek_any(tbl text, cols text[], ids text[]) returns jsonb language sql stable
security definer set search_path = '' as $$ select fx.peek(tbl, cols, ids) $$;
revoke execute on function fx.peek_any(text, text[], text[]) from public, anon;
grant execute on function fx.peek_any(text, text[], text[]) to anon;   -- (fx_get runs as whoever asks, signed out too)
grant execute on function public.fx_get(text) to anon, authenticated, service_role;

-- accounts: Firestore lets nobody list them; you read your own, staff look one up by name (fx_get)
drop policy if exists accounts_read on public.accounts;
create policy accounts_read on public.accounts for select to authenticated using (id = fx.sub());

-- ---------- codes ----------
-- A Premium code someone buys, in the same batch that takes 1,400 of their Orbs (buyPremiumCode()). Checked at the end
-- of the batch, because the payment may come after the code in it (the rules' getAfter).
create or replace function fx.buying_premium_code(m fx.person, d jsonb) returns boolean language sql stable as $$
  select fx.str(d->'type') = 'premium' and fx.is_int(d->'value') and fx.num(d->'value') > 0 and fx.num(d->'value') <= 31
     and fx.str(d->'createdBy') = m.name
     and coalesce(d->'redeemedBy', 'null'::jsonb) = 'null'::jsonb and coalesce(fx.num(coalesce(d->'uses', '0'::jsonb)) = 0, false)
     and fx.arr_len(d->'usedBy') = 0 and (not (d ? 'usedBy') or jsonb_typeof(d->'usedBy') = 'array')
     and coalesce(fx.num(coalesce(d->'maxUses', '1'::jsonb)) = 1, false)
     and coalesce(fx.num(coalesce(fx.user_data(m.name)->'orbs', '0'::jsonb))
                  <= fx.num(coalesce(fx.got('users/' || m.name)->'orbs', '0'::jsonb)) - 1400, false)
$$;
create or replace function fx.code_created() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person;
begin
  if fx.trusted() then return null; end if;
  m := fx.who();
  if not coalesce(m.ok and (m.rank >= 1 or fx.buying_premium_code(m, new.data)), false) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return null;
end $$;
create or replace function fx.codes_rules() returns trigger language plpgsql set search_path = '' as $$
begin
  if fx.trusted() or tg_op = 'INSERT' then return coalesce(new, old); end if;   -- (new ones: fx.code_created)
  if not coalesce(fx.is_staff(fx.who()), false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;

-- ---------- devices (rules: deviceCreate, deviceUpdate) ----------
create or replace function fx.devices_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; ok boolean; k text[]; bans text[] := array['banned', 'banReason', 'bannedBy', 'bannedAt', 'autoBanned', 'unbannedBy', 'unbannedAt'];
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  if tg_op = 'INSERT' then
    ok := m.ok and coalesce(fx.str(new.data->'id') = new.id, false)
          and coalesce(new.data->'banned', 'false'::jsonb) = 'false'::jsonb and not (new.data ? 'vmAllowed')
          and coalesce(new.data->'accounts', '[]'::jsonb) = jsonb_build_array(m.name);
  elsif tg_op = 'UPDATE' then
    -- Anyone records their own visit or bans their own device; the Owner alone bans, unbans and lets a virtual machine in.
    k := fx.changed(old.data, new.data);
    ok := m.ok and (
      (fx.same(old.data->'id', new.data->'id') and coalesce(m.name = any(fx.set_of(new.data, 'accounts')), false)
       and (fx.same(old.data->'accounts', new.data->'accounts') or fx.only_added(old.data, new.data, 'accounts', m.name))
       and not ('vmAllowed' = any(k))
       and (not (k && bans) or (coalesce(old.data->'banned', 'false'::jsonb) = 'false'::jsonb and coalesce(new.data->'banned', 'false'::jsonb) = 'true'::jsonb
                                and k <@ array['banned', 'banReason', 'bannedBy', 'bannedAt', 'autoBanned'])))
      or (m.rank = 3 and k <@ (bans || 'vmAllowed'::text)));
  else
    ok := fx.is_the_owner(m);
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;

-- ---------- network bans ----------
create or replace function fx.banned_ips_rules() returns trigger language plpgsql set search_path = '' as $$
declare ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  ok := fx.is_the_owner(fx.who());
  if tg_op <> 'DELETE' then
    ok := ok and fx.keys(new.data) <@ array['reason', 'by', 'at', 'label']
          and coalesce(jsonb_typeof(coalesce(new.data->'reason', '""'::jsonb)) = 'string' and length(coalesce(new.data->>'reason', '')) <= 200, false);
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
-- a table only the Owner writes (banned computers), or nobody writes from a page (server records)
create or replace function fx.owner_writes() returns trigger language plpgsql set search_path = '' as $$
begin
  if fx.trusted() then return coalesce(new, old); end if;
  if not (tg_argv[0] = 'owner' and coalesce(fx.is_the_owner(fx.who()), false))
     and not (tg_argv[0] = 'owner-delete' and tg_op = 'DELETE' and coalesce(fx.is_the_owner(fx.who()), false))
     and not (tg_argv[0] = 'owner-level' and coalesce(fx.is_owner_level(fx.who()), false)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

-- ---------- policies (the "list" rules), grants, triggers ----------
do $$
declare t text;
begin
  foreach t in array array['redeem_codes', 'orb_days', 'eggs', 'loans', 'shop_prices', 'banned_hw', 'devices', 'login_codes', 'ips', 'banned_ips'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create or replace trigger stamp before insert or update on public.%I for each row execute function fx.stamp()', t);
  end loop;
end $$;
create policy codes_list on public.redeem_codes for select to authenticated using (fx.is_staff((select fx.who())) or fx.is_writing('redeem_codes', array[id]));
create policy orb_days_list on public.orb_days for select to authenticated using (fx.is_staff((select fx.who())));
create policy eggs_list on public.eggs for select to authenticated using (fx.is_staff((select fx.who())));
create policy loans_read on public.loans for select to authenticated
  using ((select fx.who()).ok and (fx.str(data->'from') = (select fx.who()).name or fx.str(data->'to') = (select fx.who()).name or (select fx.who()).rank >= 1));
create policy prices_read on public.shop_prices for select to authenticated using (fx.signed_in());
create policy banned_hw_list on public.banned_hw for select to authenticated using (fx.is_the_owner((select fx.who())) or fx.is_writing('banned_hw', array[id]));
create policy devices_list on public.devices for select to authenticated
  using (((select fx.who()).ok and ((select fx.who()).rank = 3 or coalesce((select fx.who()).name = any(fx.set_of(data, 'accounts')), false)))
         or fx.is_writing('devices', array[id]));
create policy login_codes_read on public.login_codes for select to authenticated using (fx.is_the_owner((select fx.who())));
create policy ips_read on public.ips for select to authenticated using (fx.is_the_owner((select fx.who())));
create policy banned_ips_read on public.banned_ips for select to authenticated using (fx.is_the_owner((select fx.who())));

-- Who may write what: the triggers judge; these just let writes reach them. (Not "for all": in Postgres that covers
-- reading too, and the read policies above are the whole of who may list.)
create or replace procedure fx.write_policies(t text) language plpgsql as $$
begin
  execute format('create policy %I on public.%I for insert to authenticated with check (true)', t || '_insert', t);
  execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', t || '_update', t);
  execute format('create policy %I on public.%I for delete to authenticated using (true)', t || '_delete', t);
end $$;
call fx.write_policies('redeem_codes');
call fx.write_policies('shop_prices');
call fx.write_policies('banned_hw');
call fx.write_policies('devices');
create policy login_codes_delete on public.login_codes for delete to authenticated using (true);
call fx.write_policies('banned_ips');
grant select, insert, update, delete on public.redeem_codes, public.shop_prices, public.banned_hw, public.devices, public.banned_ips to authenticated;
grant select on public.orb_days, public.eggs, public.loans, public.ips to authenticated;   -- (written only by the server)
grant select, delete on public.login_codes to authenticated;

create or replace trigger rules before insert or update or delete on public.redeem_codes for each row execute function fx.codes_rules();
create constraint trigger created after insert on public.redeem_codes deferrable initially deferred for each row execute function fx.code_created();
create or replace trigger rules before insert or update or delete on public.shop_prices for each row execute function fx.owner_writes('owner-level');
create or replace trigger rules before insert or update or delete on public.banned_hw for each row execute function fx.owner_writes('owner');
create or replace trigger rules before insert or update or delete on public.devices for each row execute function fx.devices_rules();
create or replace trigger rules before insert or update or delete on public.login_codes for each row execute function fx.owner_writes('owner-delete');
create or replace trigger rules before insert or update or delete on public.banned_ips for each row execute function fx.banned_ips_rules();


-- ======================== 008_published.sql ========================
-- Frixion on Supabase, part 8: what staff publish (config, emoji, stickers, the Shop's collections, the garden),
-- push subscriptions, the Discord bridge's link list and game saves (rules: config ... sacSaves).

-- ---------- tables ----------
do $$
declare t text;
begin
  foreach t in array array['config', 'custom_emojis', 'stickers', 'shop_decorations', 'shop_themes', 'shop_nameplates', 'shop_banners',
                           'shop_profile_effects', 'shop_profile_frames', 'shop_badges', 'garden_seeds', 'garden_sprinklers', 'garden_pets',
                           'push_subs', 'discord_links', 'rng_saves', 'rng_codes', 'sac_saves'] loop
    execute format('create table if not exists public.%I (id text primary key, data jsonb not null default ''{}''::jsonb,
                    created_at timestamptz not null default now(), updated_at timestamptz not null default now())', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create or replace trigger stamp before insert or update on public.%I for each row execute function fx.stamp()', t);
  end loop;
end $$;
insert into fx.routes (pattern, tbl, cols) values
  ('config/*', 'config', '{id}'), ('customEmojis/*', 'custom_emojis', '{id}'), ('stickers/*', 'stickers', '{id}'),
  ('shopDecorations/*', 'shop_decorations', '{id}'), ('shopThemes/*', 'shop_themes', '{id}'), ('shopNameplates/*', 'shop_nameplates', '{id}'),
  ('shopBanners/*', 'shop_banners', '{id}'), ('shopProfileEffects/*', 'shop_profile_effects', '{id}'), ('shopProfileFrames/*', 'shop_profile_frames', '{id}'),
  ('shopBadges/*', 'shop_badges', '{id}'), ('gardenSeeds/*', 'garden_seeds', '{id}'), ('gardenSprinklers/*', 'garden_sprinklers', '{id}'),
  ('gardenPets/*', 'garden_pets', '{id}'), ('pushSubs/*', 'push_subs', '{id}'), ('discordLinks/*', 'discord_links', '{id}'),
  ('rngSaves/*', 'rng_saves', '{id}'), ('rngCodes/*', 'rng_codes', '{id}'), ('sacSaves/*', 'sac_saves', '{id}')
on conflict (pattern) do update set tbl = excluded.tbl, cols = excluded.cols;

-- ---------- what staff publish: anyone signed in reads it, staff write it ----------
-- config/ranks: the Owner and Co-Owners (v4.64)
create or replace function fx.published_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  if not coalesce(fx.is_staff(m) and (tg_table_name <> 'config' or coalesce(new.id, old.id) <> 'ranks' or fx.is_owner_level(m)), false) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
do $$
declare t text;
begin
  foreach t in array array['config', 'custom_emojis', 'stickers', 'shop_decorations', 'shop_themes', 'shop_nameplates', 'shop_banners',
                           'shop_profile_effects', 'shop_profile_frames', 'shop_badges', 'garden_seeds', 'garden_sprinklers', 'garden_pets'] loop
    execute format('create policy %I on public.%I for select to authenticated using (fx.signed_in())', t || '_read', t);
    call fx.write_policies(t);
    execute format('create or replace trigger rules before insert or update or delete on public.%I for each row execute function fx.published_rules()', t);
  end loop;
end $$;

-- ---------- push subscriptions: only their owner; the same device signing in as someone else takes one over ----------
create or replace function fx.push_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; ok boolean; mine boolean; fresh boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  mine := tg_op <> 'INSERT' and m.ok and coalesce(fx.str(old.data->'uid') = m.name, false);
  fresh := tg_op <> 'DELETE' and m.ok and coalesce(fx.str(new.data->'uid') = m.name, false);
  ok := case tg_op when 'INSERT' then fresh when 'DELETE' then mine
          else fresh and (mine or coalesce(fx.str(old.data->'endpoint') = fx.str(new.data->'endpoint'), false)) end;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
create policy push_subs_read on public.push_subs for select to authenticated
  using (((select fx.who()).ok and fx.str(data->'uid') = (select fx.who()).name) or fx.is_writing('push_subs', array[id]));
call fx.write_policies('push_subs');
create or replace trigger rules before insert or update or delete on public.push_subs for each row execute function fx.push_rules();

-- ---------- the Discord bridge's list of linked channels: kept up to date by anyone in the server ----------
create or replace function fx.discord_links_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  if tg_op = 'INSERT' then
    ok := fx.keys(new.data) <@ array['sid', 'cid', 'channel', 'at'] and fx.str(new.data->'sid') is not null and fx.str(new.data->'cid') is not null
          and new.id = fx.str(new.data->'sid') || '__' || fx.str(new.data->'cid') and fx.in_server(m, fx.srv(fx.str(new.data->'sid')));
  elsif tg_op = 'UPDATE' then
    ok := fx.changed(old.data, new.data) <@ array['channel', 'at'] and fx.in_server(m, fx.srv(fx.str(old.data->'sid')));
  else
    ok := fx.can_manage_channels(m, fx.srv(fx.str(old.data->'sid')));
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
create policy discord_links_read on public.discord_links for select to authenticated
  using (fx.is_staff((select fx.who())) or fx.is_writing('discord_links', array[id]));
call fx.write_policies('discord_links');
create or replace trigger rules before insert or update or delete on public.discord_links for each row execute function fx.discord_links_rules();

-- ---------- games ----------
-- Overcontrol RNG saves: yours (and your Steal a Character fallback, sac_<name>); the Owner's and Co-Owners' tools too.
create or replace function fx.game_saves_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; id text; ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who(); id := coalesce(new.id, old.id);
  ok := case tg_table_name
          when 'rng_saves' then m.ok and (m.name = id or id = 'sac_' || m.name or m.rank >= 2)
          else fx.is_who(m, id) or fx.is_owner_level(m) end;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
create policy rng_saves_read on public.rng_saves for select to authenticated using (fx.signed_in());
call fx.write_policies('rng_saves');
create or replace trigger rules before insert or update or delete on public.rng_saves for each row execute function fx.game_saves_rules();
create policy sac_saves_read on public.sac_saves for select to authenticated using (fx.signed_in());
call fx.write_policies('sac_saves');
create or replace trigger rules before insert or update or delete on public.sac_saves for each row execute function fx.game_saves_rules();
-- Overcontrol RNG codes: anyone signed in fetches one by name (fx_get) and counts a use; the Owner and Co-Owners list,
-- make and delete them.
create or replace function fx.rng_codes_rules() returns trigger language plpgsql set search_path = '' as $$
declare ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  ok := fx.is_owner_level(fx.who())
        or (tg_op = 'UPDATE' and fx.signed_in() and fx.changed(old.data, new.data) <@ array['uses']
            and coalesce(fx.num(coalesce(new.data->'uses', '0'::jsonb)) = coalesce(fx.num(old.data->'uses'), 0) + 1, false));
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
create policy rng_codes_list on public.rng_codes for select to authenticated
  using (fx.is_owner_level((select fx.who())) or fx.is_writing('rng_codes', array[id]));
call fx.write_policies('rng_codes');
create or replace trigger rules before insert or update or delete on public.rng_codes for each row execute function fx.rng_codes_rules();


-- ======================== 009_typing.sql ========================
-- Frixion on Supabase, part 9: the typing notes Firestore kept (rules: channels/threads/dms/groupDMs .../typing/{name}).
-- DM and group typing also go through the Realtime Database's typingTo, which stays on Firebase with sign-in.
-- A typing note shows the name of whoever it belongs to, nobody else's, and only people who see the place read it.

do $$
declare t text;
begin
  create table if not exists public.channel_typing (server_id text not null, channel_id text not null, id text not null,
    data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (server_id, channel_id, id));
  create table if not exists public.thread_typing (server_id text not null, thread_id text not null, id text not null,
    data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (server_id, thread_id, id));
  create table if not exists public.dm_typing (conv_id text not null, id text not null, data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (conv_id, id));
  create table if not exists public.group_typing (conv_id text not null, id text not null, data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (conv_id, id));
  foreach t in array array['channel_typing', 'thread_typing', 'dm_typing', 'group_typing'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create or replace trigger stamp before insert or update on public.%I for each row execute function fx.stamp()', t);
    call fx.write_policies(t);
  end loop;
end $$;
insert into fx.routes (pattern, tbl, cols) values
  ('servers/*/channels/*/typing/*', 'channel_typing', '{server_id,channel_id,id}'),
  ('servers/*/threads/*/typing/*', 'thread_typing', '{server_id,thread_id,id}'),
  ('dms/*/typing/*', 'dm_typing', '{conv_id,id}'),
  ('groupDMs/*/typing/*', 'group_typing', '{conv_id,id}')
on conflict (pattern) do update set tbl = excluded.tbl, cols = excluded.cols;

-- may this person see the place a typing note is in?
create or replace function fx.typing_place_ok(m fx.person, tbl text, a text, b text) returns boolean language sql stable as $$
  select case tbl
    when 'channel_typing' then fx.sees_channel(m, fx.srv(a), fx.chan(a, b))
    when 'thread_typing' then fx.sees_channel(m, fx.srv(a), fx.thread_chan(a, b))
    when 'dm_typing' then fx.in_conv(m, case when fx.ok_id(a) then fx.got('dms/' || a) end)
    else fx.in_conv(m, case when fx.ok_id(a) then fx.got('groupDMs/' || a) end) end
$$;
create or replace function fx.typing_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; r record; a text; b text; ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  r := coalesce(new, old);
  a := case when tg_table_name in ('channel_typing', 'thread_typing') then to_jsonb(r)->>'server_id' else to_jsonb(r)->>'conv_id' end;
  b := coalesce(to_jsonb(r)->>'channel_id', to_jsonb(r)->>'thread_id');
  ok := coalesce(m.name = r.id, false)
        and (tg_op = 'DELETE' or not (new.data ? 'username') or coalesce(fx.str(new.data->'username') = new.id, false))
        and fx.typing_place_ok(m, tg_table_name, a, b);
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;

create policy channel_typing_read on public.channel_typing for select to authenticated
  using (fx.typing_place_ok((select fx.who()), 'channel_typing', server_id, channel_id) or fx.is_writing('channel_typing', array[server_id, channel_id, id]));
create policy thread_typing_read on public.thread_typing for select to authenticated
  using (fx.typing_place_ok((select fx.who()), 'thread_typing', server_id, thread_id) or fx.is_writing('thread_typing', array[server_id, thread_id, id]));
create policy dm_typing_read on public.dm_typing for select to authenticated
  using (fx.typing_place_ok((select fx.who()), 'dm_typing', conv_id, null) or fx.is_writing('dm_typing', array[conv_id, id]));
create policy group_typing_read on public.group_typing for select to authenticated
  using (fx.typing_place_ok((select fx.who()), 'group_typing', conv_id, null) or fx.is_writing('group_typing', array[conv_id, id]));
create or replace trigger rules before insert or update or delete on public.channel_typing for each row execute function fx.typing_rules();
create or replace trigger rules before insert or update or delete on public.thread_typing for each row execute function fx.typing_rules();
create or replace trigger rules before insert or update or delete on public.dm_typing for each row execute function fx.typing_rules();
create or replace trigger rules before insert or update or delete on public.group_typing for each row execute function fx.typing_rules();


-- ======================== 010_reads.sql ========================
-- Frixion on Supabase, part 10: lists for the site's adapter (public.fx_query), the path table it needs
-- (public.fx_routes), and live updates (Postgres Changes) for every table.

-- A field in a filter or a sort: a list of names (["stats", "games"], ["auras", "equinox:x"]), or ["__name__"] for
-- the document's id (Firestore's FieldPath.documentId()).
create or replace function fx.q_field(path jsonb) returns text language plpgsql immutable as $$
declare names text[];
begin
  if jsonb_typeof(path) is distinct from 'array' or jsonb_array_length(path) = 0 then
    raise exception 'a field is a list of names' using errcode = 'FX400';
  end if;
  names := array(select jsonb_array_elements_text(path));
  if names = array['__name__'] then return 'to_jsonb(id)'; end if;
  return format('(data #> %L::text[])', names::text);
end $$;

-- A Firestore query on one collection: coll is its path ("servers/s1/channels/c1/messages"); filters
-- [[field, op, value]...] with op ==, !=, <, <=, >, >=, array-contains, array-contains-any, in, not-in; orders
-- [[field, "asc"|"desc"]...]; lim; last = limitToLast. Like Firestore: a sort leaves out documents without that field,
-- <, >, ... only match values of the same kind, and the id breaks ties. Read as the person asking, so the tables'
-- read policies decide what comes back. Returns [{id, data, updatedAt}...] in order.
create or replace function public.fx_query(coll text, filters jsonb default '[]'::jsonb, orders jsonb default '[]'::jsonb,
                                           lim int default null, last boolean default false) returns jsonb
language plpgsql set search_path = '' as $$
declare seg text[]; n int; pat text := ''; ids text[] := '{}'; r_tbl text; r_cols text[]; i int; j int := 0;
  conds text[] := '{}'; ords text[] := '{}'; f jsonb; o jsonb; fld text; op text; v text; vals jsonb := '[]'::jsonb;
  dir_last text := 'asc'; res jsonb;
begin
  seg := string_to_array(coll, '/');
  n := coalesce(array_length(seg, 1), 0);
  if n = 0 or n % 2 <> 1 or n > 19 then raise exception 'not a collection path: %', coll using errcode = 'FX400'; end if;
  for i in 1 .. n loop
    if seg[i] = '' then raise exception 'not a collection path: %', coll using errcode = 'FX400'; end if;
    if i % 2 = 1 then pat := pat || case when i > 1 then '/' else '' end || seg[i];
    else pat := pat || '/*'; ids := ids || seg[i]; end if;
  end loop;
  select r.tbl, r.cols into r_tbl, r_cols from fx.routes r where r.pattern = pat || '/*';
  if r_tbl is null then raise exception 'no table for %', pat || '/*' using errcode = 'FX400'; end if;
  for i in 1 .. coalesce(array_length(ids, 1), 0) loop conds := conds || format('%I = $1[%s]', r_cols[i], i); end loop;

  if jsonb_typeof(coalesce(filters, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(orders, '[]'::jsonb)) <> 'array' then
    raise exception 'filters and orders are lists' using errcode = 'FX400';
  end if;
  for f in select * from jsonb_array_elements(coalesce(filters, '[]'::jsonb)) loop
    fld := fx.q_field(f->0); op := f->>1; v := format('($2->%s)', j);
    conds := conds || case op
      when '==' then format('%s = %s', fld, v)
      when '!=' then format('(%s is not null and %s <> %s)', fld, fld, v)
      when '<' then format('(%s < %s and jsonb_typeof(%s) = jsonb_typeof(%s))', fld, v, fld, v)
      when '<=' then format('(%s <= %s and jsonb_typeof(%s) = jsonb_typeof(%s))', fld, v, fld, v)
      when '>' then format('(%s > %s and jsonb_typeof(%s) = jsonb_typeof(%s))', fld, v, fld, v)
      when '>=' then format('(%s >= %s and jsonb_typeof(%s) = jsonb_typeof(%s))', fld, v, fld, v)
      when 'array-contains' then format('(jsonb_typeof(%s) = ''array'' and exists (select 1 from jsonb_array_elements(%s) x where x = %s))', fld, fld, v)
      when 'array-contains-any' then format('(jsonb_typeof(%s) = ''array'' and exists (select 1 from jsonb_array_elements(%s) x, jsonb_array_elements(%s) y where x = y))', fld, fld, v)
      when 'in' then format('(jsonb_typeof(%s) = ''array'' and %s in (select jsonb_array_elements(%s)))', v, fld, v)
      when 'not-in' then format('(%s is not null and jsonb_typeof(%s) = ''array'' and not %s in (select jsonb_array_elements(%s)))', fld, v, fld, v)
      else null end;
    if op is null or op not in ('==', '!=', '<', '<=', '>', '>=', 'array-contains', 'array-contains-any', 'in', 'not-in') then
      raise exception 'unknown filter: %', op using errcode = 'FX400';
    end if;
    vals := vals || jsonb_build_array(f->2);
    j := j + 1;
  end loop;
  for o in select * from jsonb_array_elements(coalesce(orders, '[]'::jsonb)) loop
    fld := fx.q_field(o->0);
    dir_last := case when o->>1 = 'desc' then 'desc' else 'asc' end;
    if fld <> 'to_jsonb(id)' then conds := conds || format('%s is not null', fld); end if;
    ords := ords || format('%s %s', fld, case when (dir_last = 'desc') <> last then 'desc' else 'asc' end);
  end loop;
  ords := ords || format('id %s', case when (dir_last = 'desc') <> last then 'desc' else 'asc' end);
  if lim is not null and (lim < 0 or lim > 10000) then raise exception 'a limit is 0 to 10000' using errcode = 'FX400'; end if;

  execute format('select coalesce(jsonb_agg(jsonb_build_object(''id'', id, ''data'', data, ''updatedAt'', updated_at::text) order by o), ''[]''::jsonb)
                  from (select id, data, updated_at, row_number() over (order by %s) o from public.%I %s order by %s %s) q',
                 array_to_string(ords, ', '), r_tbl,
                 case when cardinality(conds) > 0 then 'where ' || array_to_string(conds, ' and ') else '' end,
                 array_to_string(ords, ', '), case when lim is not null then 'limit ' || lim else '' end)
    into res using ids, vals;
  if last then   -- limitToLast: picked from the end, handed back in the query's own order
    select coalesce(jsonb_agg(x order by k desc), '[]'::jsonb) into res from jsonb_array_elements(res) with ordinality t(x, k);
  end if;
  return res;
end $$;
grant execute on function public.fx_query(text, jsonb, jsonb, int, boolean) to anon, authenticated, service_role;

-- the path table, for the adapter to know which table and key columns a path is (it's not secret)
create or replace function public.fx_routes() returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('pattern', pattern, 'tbl', tbl, 'cols', to_jsonb(cols)) order by pattern), '[]'::jsonb) from fx.routes
$$;
grant execute on function public.fx_routes() to anon, authenticated, service_role;

-- Live updates: every table is in Supabase's Realtime publication. Each person still only hears about rows their read
-- policies let them see. (The test database has no such publication, so this does nothing there.)
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    for t in select tbl from fx.routes loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;
