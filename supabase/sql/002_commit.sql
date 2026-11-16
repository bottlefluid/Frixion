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
--     "create": {...}                 a new document; refused if it already exists (add())
--     "delete": true
--   and optionally "transforms": [{"field": "a.b", then one of "increment": n, "maximum": n, "minimum": n,
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
  if coalesce(t->>'field', '') = '' then raise exception 'a transform needs a field' using errcode = 'FX400'; end if;
  p := string_to_array(t->>'field', '.');
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
    kind := case when w ? 'delete' then 'delete' when w ? 'create' then 'create' when w ? 'update' then 'update'
                 when w ? 'set' then 'set' end;
    if kind is null then raise exception 'a write needs set, update, create or delete' using errcode = 'FX400'; end if;

    if kind = 'delete' then new := null;
    elsif kind = 'create' then new := w -> 'create';
    elsif kind = 'update' then
      if jsonb_typeof(w -> 'update') <> 'object' then raise exception 'update needs fields' using errcode = 'FX400'; end if;
      new := coalesce(old, case when fx.is_true(w -> 'upsert') then '{}'::jsonb end);
      for k, v in select * from jsonb_each(w -> 'update') loop new := fx.set_path(new, string_to_array(k, '.'), v); end loop;
    elsif fx.is_true(w -> 'merge') then new := fx.deep_merge(old, w -> 'set');
    else new := w -> 'set';
    end if;
    if kind <> 'delete' then
      if jsonb_typeof(new) is distinct from 'object' then raise exception 'a document is a map' using errcode = 'FX400'; end if;
      for t in select * from jsonb_array_elements(coalesce(w -> 'transforms', '[]'::jsonb)) loop new := fx.transform(new, t); end loop;
    end if;

    -- the write itself: the table's policies and triggers decide
    if kind = 'delete' then
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

    -- preconditions come after the write, so a refused write never tells whether the document was there
    if w ? 'exists' and fx.is_true(w -> 'exists') <> (old is not null) then
      raise exception 'precondition failed: %', w->>'path' using errcode = 'FX409';
    end if;
    if w ? 'updatedAt' and (cur ->> 'updatedAt') is distinct from (w ->> 'updatedAt') then
      raise exception 'precondition failed: %', w->>'path' using errcode = 'FX409';
    end if;

    after := case when kind = 'delete' then null else fx.peek(r_tbl, r_cols, r_ids) end;
    res := res || jsonb_build_array(jsonb_build_object('path', w->>'path', 'updatedAt', after ->> 'updatedAt',
                                                        'data', case when kind = 'delete' then null else new end));
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
