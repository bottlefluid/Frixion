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
create policy cards_read on public.server_cards for select to authenticated using (true);

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
