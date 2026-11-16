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
    when 'rng_codes' then auth.uid() is not null
    else false end, false);
end $$;
create or replace function public.fx_get(path text) returns jsonb language plpgsql set search_path = '' as $$
declare r_tbl text; r_cols text[]; r_ids text[]; d jsonb; p jsonb;
begin
  select * into r_tbl, r_cols, r_ids from fx.route(path);
  begin
    execute format('select data from public.%I where %s', r_tbl, fx.key_where(r_cols)) into d using r_ids;
  exception when insufficient_privilege then d := null;   -- (signed out: most tables aren't readable at all)
  end;
  if d is not null then return jsonb_build_object('exists', true, 'data', d); end if;
  p := fx.peek_any(r_tbl, r_cols, r_ids);
  if p is null then return jsonb_build_object('exists', false, 'data', null); end if;
  if fx.get_exception(r_tbl, r_ids, p->'data') then return jsonb_build_object('exists', true, 'data', p->'data'); end if;
  raise exception 'permission denied' using errcode = '42501';
end $$;
-- (fx.peek is only for the database's own functions; fx_get may look, for the exceptions above, through this)
create or replace function fx.peek_any(tbl text, cols text[], ids text[]) returns jsonb language sql stable
security definer set search_path = '' as $$ select fx.peek(tbl, cols, ids) $$;
revoke execute on function fx.peek_any(text, text[], text[]) from public, anon;
grant execute on function fx.peek_any(text, text[], text[]) to anon;   -- (fx_get runs as whoever asks, signed out too)
grant execute on function public.fx_get(text) to anon, authenticated, service_role;

-- accounts: Firestore lets nobody list them; you read your own, staff look one up by name (fx_get)
drop policy if exists accounts_read on public.accounts;
create policy accounts_read on public.accounts for select to authenticated using (id = auth.uid()::text);

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
create policy prices_read on public.shop_prices for select to authenticated using (true);
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
