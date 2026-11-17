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
