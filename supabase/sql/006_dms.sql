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
