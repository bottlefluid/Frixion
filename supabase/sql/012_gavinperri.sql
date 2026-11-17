-- Frixion on Supabase, part 12: Gavinperri (D:\Downloads\Gavinperri, bottlefluid/gavinperri), the other site on this
-- project: a library of documents that Frixion's Admins (and Co-Owners and the Owner) write and anyone reads. Ported
-- from the "Gavinperri" section of firestore.rules. Everything of its own starts with site_gavinperri_, and nothing here
-- gives that site, or anyone, anything of Frixion's. Who may write comes from the same records as everything else
-- (accounts and the profile's rank): nothing a page sends can make someone an Admin.
--   site_gavinperri_doc/{id}                 site_gavinperri_doc (id)
--   site_gavinperri_doc/{id}/history/{rev}   site_gavinperri_history (doc_id, id)
--   site_gavinperri_images/{sha256}          site_gavinperri_images (id)
-- - site_gavinperri_doc/library is the list of documents (body) and says which documents (ids) and pictures (imgs) are
--   public; anyone may fetch it, and site_gavinperri_doc/covers (the cover pictures the list shows). shelf is the
--   same list with the hidden ones, for editors. Every other name is one document, which readers get only while the
--   library lists it. Nobody can list anything (no read policy: one document at a time, through fx_get).
-- - A save (of a document or the library) is the next revision number, from an editor (staff, not banned), and files
--   the very same thing in history/{revision} in the same write (checked at the end of the write, like the rules'
--   getAfter). Nothing is ever deleted or rewritten; a history entry's name, who gave it and when are all that change.
-- - Pictures are image data kept under the SHA-256 of that data, made once. Readers get one only while the library
--   lists it; editors get any.

create table if not exists public.site_gavinperri_doc (id text primary key, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.site_gavinperri_history (doc_id text not null, id text not null, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (doc_id, id));
create table if not exists public.site_gavinperri_images (id text primary key, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
insert into fx.routes (pattern, tbl, cols) values
  ('site_gavinperri_doc/*', 'site_gavinperri_doc', '{id}'),
  ('site_gavinperri_doc/*/history/*', 'site_gavinperri_history', '{doc_id,id}'),
  ('site_gavinperri_images/*', 'site_gavinperri_images', '{id}')
on conflict (pattern) do update set tbl = excluded.tbl, cols = excluded.cols;

-- ---------- who, and what a save looks like ----------
create or replace function fx.gp_editor(m fx.person) returns boolean language sql stable as $$
  select coalesce(fx.is_staff(m) and fx.active(m), false)
$$;
create or replace function fx.gp_name(id text) returns boolean language sql immutable as $$
  select id ~ '^[a-z0-9]{4,24}$' and id <> 'covers'
$$;
-- (the rules' gpShape: the revision, the text, the pictures, the library's list, and the server's time)
create or replace function fx.gp_shape(d jsonb, id text) returns boolean language sql stable as $$
  select coalesce(fx.is_int(d->'rev') and fx.num(d->'rev') >= 1
    and jsonb_typeof(d->'body') = 'string' and length(d->>'body') <= 200000
    and jsonb_typeof(d->'imgs') = 'array' and jsonb_array_length(d->'imgs') <= case when id = 'library' then 1000 else 24 end
    and case when id = 'library' then jsonb_typeof(d->'ids') = 'array' and jsonb_array_length(d->'ids') <= 100
                                      and not (d->'ids' ?| array['library', 'covers', 'shelf'])
             else not (d ? 'ids') end
    and fx.ts(d->'at') = fx.now_ms(), false)
$$;
-- the same thing on both sides of a save: the live document and its history entry
create or replace function fx.gp_same(a jsonb, b jsonb) returns boolean language sql immutable as $$
  select coalesce((a->'rev') = (b->'rev') and (a->'body') = (b->'body') and (a->'imgs') = (b->'imgs')
    and coalesce(a->'ids', '[]'::jsonb) = coalesce(b->'ids', '[]'::jsonb), false)
$$;
-- the library as it is (the rules' gpShown(): get() outside a write; read with the database's own rights)
create or replace function fx.gp_shown() returns jsonb language sql stable security definer set search_path = '' as $$
  select data from public.site_gavinperri_doc where id = 'library'
$$;

-- ---------- fetching one (fx.get_exception asks these; nobody lists anything) ----------
create or replace function fx.gp_doc_readable(id text, m fx.person) returns boolean language sql stable as $$
  select id in ('library', 'covers') or coalesce(fx.gp_shown()->'ids' ? id, false) or fx.gp_editor(m)
$$;
create or replace function fx.gp_image_readable(id text, m fx.person) returns boolean language sql stable as $$
  select coalesce(fx.gp_shown()->'imgs' ? id, false) or fx.gp_editor(m)
$$;

-- ---------- writes ----------
create or replace function fx.gp_doc_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; d jsonb; ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'permission denied' using errcode = '42501'; end if;
  m := fx.who(); d := new.data;
  if new.id = 'covers' then   -- (the rules' gpCovers: copies of pictures already kept, so no history)
    ok := fx.gp_editor(m) and fx.keys(d) <@ array['covers', 'at'] and jsonb_typeof(d->'covers') = 'object'
          and (select count(*) from jsonb_object_keys(d->'covers')) <= 100 and fx.ts(d->'at') = fx.now_ms();
  else                        -- (gpSave, but for its history entry, which is checked when the write ends)
    ok := fx.gp_editor(m) and fx.gp_name(new.id) and fx.keys(d) <@ array['rev', 'body', 'imgs', 'ids', 'at'] and fx.gp_shape(d, new.id)
          and fx.num(d->'rev') = case when tg_op = 'INSERT' then 1 else fx.num(old.data->'rev') + 1 end;
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return new;
end $$;
-- at the end of the write: the save is filed, the same, in history/{its revision} (run as whoever wrote, so fx.trusted()
-- tells the server apart; the other row is read through fx.peek, with the database's own rights)
create or replace function fx.gp_doc_filed() returns trigger language plpgsql set search_path = '' as $$
declare h jsonb;
begin
  if fx.trusted() or new.id = 'covers' then return null; end if;
  h := fx.peek('site_gavinperri_history', array['doc_id', 'id'], array[new.id, fx.num(new.data->'rev')::bigint::text]) -> 'data';
  if h is null or not fx.gp_same(new.data, h) or (h->'at') is distinct from (new.data->'at') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return null;
end $$;
create or replace function fx.gp_history_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; d jsonb; ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'permission denied' using errcode = '42501'; end if;
  m := fx.who(); d := new.data;
  if tg_op = 'INSERT' then   -- (gpFile, but for the live document, which is checked when the write ends)
    ok := fx.gp_editor(m) and fx.gp_name(new.doc_id) and fx.keys(d) <@ array['rev', 'body', 'imgs', 'ids', 'by', 'at']
          and fx.gp_shape(d, new.doc_id) and fx.is_int(d->'rev') and new.id = fx.num(d->'rev')::bigint::text and fx.str(d->'by') = m.name;
  else                       -- (gpLabel: a name, who gave it and when)
    ok := fx.gp_editor(m) and fx.changed(old.data, d) <@ array['name', 'namedBy', 'namedAt']
          and jsonb_typeof(d->'name') = 'string' and length(d->>'name') <= 60
          and fx.str(d->'namedBy') = m.name and fx.ts(d->'namedAt') = fx.now_ms();
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return new;
end $$;
-- at the end of the write: the live document is what was filed
create or replace function fx.gp_history_filed() returns trigger language plpgsql set search_path = '' as $$
declare live jsonb;
begin
  if fx.trusted() then return null; end if;
  live := fx.peek('site_gavinperri_doc', array['id'], array[new.doc_id]) -> 'data';
  if live is null or not fx.gp_same(new.data, live) then raise exception 'permission denied' using errcode = '42501'; end if;
  return null;
end $$;
create or replace function fx.gp_images_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; d jsonb; ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  if tg_op <> 'INSERT' then raise exception 'permission denied' using errcode = '42501'; end if;   -- (made once, kept)
  m := fx.who(); d := new.data;
  ok := fx.gp_editor(m) and new.id ~ '^[0-9a-f]{64}$' and fx.keys(d) <@ array['data', 'w', 'h', 'at']
        and jsonb_typeof(d->'data') = 'string' and length(d->>'data') <= 950000
        and (d->>'data') ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'
        and fx.is_int(d->'w') and fx.num(d->'w') between 1 and 4096 and fx.is_int(d->'h') and fx.num(d->'h') between 1 and 4096
        and fx.ts(d->'at') = fx.now_ms();
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return new;
end $$;

-- ---------- the tables' rights ----------
do $$
declare t text;
begin
  foreach t in array array['site_gavinperri_doc', 'site_gavinperri_history', 'site_gavinperri_images'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create or replace trigger stamp before insert or update on public.%I for each row execute function fx.stamp()', t);
    call fx.write_policies(t);
  end loop;
end $$;
-- Reading: documents and pictures only one at a time (fx_get), so the read policy lets through nothing but the row a
-- write is writing (Postgres needs that to update it); histories to editors.
create policy site_gavinperri_doc_read on public.site_gavinperri_doc for select to authenticated using (fx.is_writing('site_gavinperri_doc', array[id]));
create policy site_gavinperri_images_read on public.site_gavinperri_images for select to authenticated using (fx.is_writing('site_gavinperri_images', array[id]));
create policy site_gavinperri_history_read on public.site_gavinperri_history for select to authenticated
  using (fx.gp_editor((select fx.who())) or fx.is_writing('site_gavinperri_history', array[doc_id, id]));
create or replace trigger rules before insert or update or delete on public.site_gavinperri_doc for each row execute function fx.gp_doc_rules();
create or replace trigger rules before insert or update or delete on public.site_gavinperri_history for each row execute function fx.gp_history_rules();
create or replace trigger rules before insert or update or delete on public.site_gavinperri_images for each row execute function fx.gp_images_rules();
create constraint trigger filed after insert or update on public.site_gavinperri_doc deferrable initially deferred for each row execute function fx.gp_doc_filed();
create constraint trigger filed after insert on public.site_gavinperri_history deferrable initially deferred for each row execute function fx.gp_history_filed();
