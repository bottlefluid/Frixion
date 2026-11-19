-- Frixion on Supabase, part 15: v4.69 (requests 50 and 65). Run once in Supabase's SQL Editor, after 014. It changes
-- no data. Running it twice does no harm.
--   50: private threads (only the people in them, and whoever can manage threads there, see them or post), locked
--       threads (only who can manage threads posts), Create Public/Private Threads and Manage Threads checked here too,
--       webhooks (servers/{sid}/webhooks/{id}), and events (servers/{sid}/events/{id}).
--   65: Grow a Garden trades (gardenTrades/{id}), which only the server writes.

-- ---------- 50: private and locked threads ----------
-- May m see thread t (its data) in server s? A public thread: whoever sees its channel. A private one: only the people
-- in it, and whoever can manage threads in its channel.
create or replace function fx.thread_sees(m fx.person, s jsonb, sid text, t jsonb) returns boolean language sql stable as $$
  select t is not null and (
    not fx.is_true(t->'private')
    or coalesce(m.name = any(fx.set_of(t, 'members')), false)
    or fx.can_in_channel(m, s, fx.chan(sid, coalesce(fx.str(t->'channelId'), '-')), fx.perms_in(m, s), array['manageThreads']))
$$;
create or replace function fx.thread_open(m fx.person, sid text, tid text) returns boolean language sql stable as $$
  select fx.thread_sees(m, fx.srv(sid), sid, fx.thread_of(sid, tid))
$$;
-- the people in a private thread: at most 100, all of them in the server
create or replace function fx.thread_members_ok(s jsonb, t jsonb) returns boolean language sql immutable as $$
  select cardinality(fx.set_of(t, 'members')) <= 100
     and not exists (select 1 from unnest(fx.set_of(t, 'members')) x where not x = any(fx.set_of(s, 'members')))
$$;

create or replace function fx.threads_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; s jsonb; ch jsonb; ok boolean; k text[]; p text[]; mods boolean; mine boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who(); s := fx.srv(coalesce(new.server_id, old.server_id));
  if s is null then ok := false;
  else
    p := fx.perms_in(m, s);
    ch := fx.chan(coalesce(new.server_id, old.server_id), coalesce(fx.str(coalesce(new.data, old.data)->'channelId'), '-'));
    mods := ch is not null and fx.can_in_channel(m, s, ch, p, array['manageThreads']);
    if tg_op = 'INSERT' then
      ok := fx.in_server(m, s) and fx.can_post(m) and fx.str(new.data->'createdBy') = m.name and ch is not null
            and not fx.is_true(new.data->'locked')
            and case when fx.is_true(new.data->'private')
                  then fx.can_in_channel(m, s, ch, p, array['viewChannels', 'createPrivateThreads'])
                       and m.name = any(fx.set_of(new.data, 'members')) and fx.thread_members_ok(s, new.data)
                  else fx.can_in_channel(m, s, ch, p, array['viewChannels', 'createPublicThreads']) end;
    elsif tg_op = 'UPDATE' then
      k := fx.changed(old.data, new.data);
      mine := coalesce(fx.str(old.data->'createdBy') = m.name, false);
      ok := fx.in_server(m, s) and fx.thread_sees(m, s, old.server_id, old.data)
            and not (k && array['createdBy', 'channelId', 'starterId', 'createdAt'])
            and (not (k && array['private', 'locked']) or mods)            -- locking, or making it private or public
            and (not ('members' = any(k)) or fx.thread_members_ok(s, new.data))
            and ((k <@ array['lastMessageAt', 'messageCount']
                  and coalesce(fx.num(new.data->'messageCount'), 0) = coalesce(fx.num(old.data->'messageCount'), 0) + 1)
                 or mine or mods
                 or (k <@ array['members'] and fx.is_true(old.data->'private')
                     and ((m.name = any(fx.set_of(old.data, 'members')) and fx.set_of(old.data, 'members') <@ fx.set_of(new.data, 'members'))
                          or fx.only_taken_out(old.data, new.data, 'members', m.name))));   -- adding people, or leaving
    else
      ok := m.ok and (coalesce(fx.str(old.data->'createdBy') = m.name, false) or mods or fx.has_one(p, array['manageChannels']));
    end if;
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;

create or replace function fx.th_msgs_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; s jsonb; ch jsonb; t jsonb; ok boolean; p text[]; admin boolean; cp text[]; k text[];
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who(); s := fx.srv(coalesce(new.server_id, old.server_id));
  if s is null then ok := false;
  elsif tg_op = 'DELETE' then
    ok := m.ok and (fx.is_mine(m, old.data) or m.rank >= 1
                    or (fx.is_member(m, s) and fx.active(m) and (fx.purge_ok(m) or fx.has_one(fx.perms_in(m, s), array['manageMessages', 'manageChannels']))));
  else
    t := fx.thread_of(new.server_id, new.thread_id);
    ch := fx.thread_chan(new.server_id, new.thread_id);
    p := fx.perms_in(m, s);
    if ch is null or not fx.thread_sees(m, s, new.server_id, t) then ok := false;
    elsif tg_op = 'INSERT' then
      admin := 'administrator' = any(p);
      cp := case when admin then '{}'::text[] else fx.chan_perms(m, s, ch, p) end;
      ok := fx.in_server(m, s) and fx.can_post(m) and fx.not_timed_out(m, s) and (admin or cp @> array['viewChannels', 'sendMessagesInThreads'])
            and (not fx.is_true(t->'locked') or admin or 'manageThreads' = any(cp))
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

create or replace function fx.typing_place_ok(m fx.person, tbl text, a text, b text) returns boolean language sql stable as $$
  select case tbl
    when 'channel_typing' then fx.sees_channel(m, fx.srv(a), fx.chan(a, b))
    when 'thread_typing' then fx.sees_channel(m, fx.srv(a), fx.thread_chan(a, b)) and fx.thread_open(m, a, b)
    when 'dm_typing' then fx.in_conv(m, case when fx.ok_id(a) then fx.got('dms/' || a) end)
    else fx.in_conv(m, case when fx.ok_id(a) then fx.got('groupDMs/' || a) end) end
$$;

drop policy if exists threads_read on public.threads;
create policy threads_read on public.threads for select to authenticated
  using ((fx.in_server((select fx.who()), fx.srv(server_id)) and fx.thread_sees((select fx.who()), fx.srv(server_id), server_id, data))
         or fx.is_writing('threads', array[server_id, id]));
drop policy if exists thread_messages_read on public.thread_messages;
create policy thread_messages_read on public.thread_messages for select to authenticated
  using ((fx.sees_channel((select fx.who()), fx.srv(server_id), fx.thread_chan(server_id, thread_id)) and fx.thread_open((select fx.who()), server_id, thread_id))
         or fx.is_writing('thread_messages', array[server_id, thread_id, id]));

-- ---------- 50: webhooks ----------
-- servers/{sid}/webhooks/{id} = { name, channelId, avatarUrl, tokenHash (the SHA-256 of its secret, in hex), createdBy,
-- createdAt }. Whoever has Manage Webhooks in the server sees and changes them; functions/api/webhooks posts with them.
create table if not exists public.server_webhooks (server_id text not null, id text not null, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (server_id, id));
insert into fx.routes (pattern, tbl, cols) values ('servers/*/webhooks/*', 'server_webhooks', '{server_id,id}')
on conflict (pattern) do update set tbl = excluded.tbl, cols = excluded.cols;
create or replace function fx.can_webhooks(m fx.person, s jsonb) returns boolean language sql stable as $$
  select s is not null and fx.in_server(m, s) and fx.has_one(fx.perms_in(m, s), array['manageWebhooks'])
$$;
create or replace function fx.webhook_ok(sid text, d jsonb) returns boolean language sql stable as $$
  select fx.keys(d) <@ array['name', 'channelId', 'avatarUrl', 'tokenHash', 'createdBy', 'createdAt']
     and coalesce(jsonb_typeof(d->'name') = 'string' and length(d->>'name') between 1 and 80, false)
     and fx.chan(sid, coalesce(fx.str(d->'channelId'), '-')) is not null
     and coalesce(fx.str(d->'tokenHash') ~ '^[0-9a-f]{64}$', false)
     and (not (d ? 'avatarUrl') or coalesce(jsonb_typeof(d->'avatarUrl') = 'string' and length(d->>'avatarUrl') <= 500
                                            and (d->>'avatarUrl' = '' or d->>'avatarUrl' ~ '^https://'), false))
$$;
create or replace function fx.webhooks_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; s jsonb; ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who(); s := fx.srv(coalesce(new.server_id, old.server_id));
  ok := fx.can_post(m) and fx.can_webhooks(m, s);
  if tg_op = 'INSERT' then ok := ok and fx.webhook_ok(new.server_id, new.data) and fx.str(new.data->'createdBy') = m.name;
  elsif tg_op = 'UPDATE' then ok := ok and fx.webhook_ok(new.server_id, new.data) and fx.same(old.data->'createdBy', new.data->'createdBy');
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
alter table public.server_webhooks enable row level security;
grant all on public.server_webhooks to service_role;
grant select, insert, update, delete on public.server_webhooks to authenticated;
drop policy if exists server_webhooks_read on public.server_webhooks;
create policy server_webhooks_read on public.server_webhooks for select to authenticated
  using (fx.can_webhooks((select fx.who()), fx.srv(server_id)) or fx.is_writing('server_webhooks', array[server_id, id]));
drop policy if exists server_webhooks_insert on public.server_webhooks;
drop policy if exists server_webhooks_update on public.server_webhooks;
drop policy if exists server_webhooks_delete on public.server_webhooks;
call fx.write_policies('server_webhooks');
create or replace trigger stamp before insert or update on public.server_webhooks for each row execute function fx.stamp();
create or replace trigger rules before insert or update or delete on public.server_webhooks for each row execute function fx.webhooks_rules();

-- ---------- 50: events ----------
-- servers/{sid}/events/{id} = { name, description, startAt, endAt (ms), place, channelId, createdBy, createdAt,
-- interested: [names] }. Everyone in the server sees them; Create Events makes them (and edits or cancels your own);
-- Manage Events edits or cancels any; anyone in the server marks themselves interested, or not.
create table if not exists public.server_events (server_id text not null, id text not null, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (server_id, id));
insert into fx.routes (pattern, tbl, cols) values ('servers/*/events/*', 'server_events', '{server_id,id}')
on conflict (pattern) do update set tbl = excluded.tbl, cols = excluded.cols;
create or replace function fx.event_ok(sid text, d jsonb) returns boolean language sql stable as $$
  select fx.keys(d) <@ array['name', 'description', 'startAt', 'endAt', 'place', 'channelId', 'createdBy', 'createdAt', 'interested']
     and coalesce(jsonb_typeof(d->'name') = 'string' and length(d->>'name') between 1 and 100, false)
     and (not (d ? 'description') or coalesce(jsonb_typeof(d->'description') = 'string' and length(d->>'description') <= 1000, false))
     and coalesce(fx.is_int(d->'startAt') and fx.num(d->'startAt') > 0, false)
     and (coalesce(d->'endAt', 'null'::jsonb) = 'null'::jsonb or coalesce(fx.is_int(d->'endAt') and fx.num(d->'endAt') > fx.num(d->'startAt'), false))
     and (not (d ? 'place') or coalesce(jsonb_typeof(d->'place') = 'string' and length(d->>'place') <= 100, false))
     and (coalesce(d->'channelId', 'null'::jsonb) = 'null'::jsonb or fx.chan(sid, coalesce(fx.str(d->'channelId'), '-')) is not null)
     and (not (d ? 'interested') or (jsonb_typeof(d->'interested') = 'array' and jsonb_array_length(d->'interested') <= 1000))
$$;
create or replace function fx.events_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; s jsonb; ok boolean; p text[]; k text[]; mine boolean; boss boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who(); s := fx.srv(coalesce(new.server_id, old.server_id));
  if s is null then ok := false;
  else
    p := fx.perms_in(m, s);
    boss := fx.has_one(p, array['manageEvents']);
    if tg_op = 'INSERT' then
      ok := fx.in_server(m, s) and fx.can_post(m) and fx.has_one(p, array['createEvents', 'manageEvents'])
            and fx.str(new.data->'createdBy') = m.name and fx.event_ok(new.server_id, new.data)
            and fx.set_of(new.data, 'interested') <@ array[m.name];
    elsif tg_op = 'UPDATE' then
      k := fx.changed(old.data, new.data);
      mine := coalesce(fx.str(old.data->'createdBy') = m.name, false) and fx.has_one(p, array['createEvents']);
      ok := fx.in_server(m, s) and fx.event_ok(new.server_id, new.data) and not (k && array['createdBy', 'createdAt'])
            and ((k <@ array['interested'] and (fx.only_added(old.data, new.data, 'interested', m.name)
                                                or fx.only_taken_out(old.data, new.data, 'interested', m.name)))
                 or ((mine or boss) and fx.can_post(m)));
    else
      ok := m.ok and (fx.in_server(m, s) or m.rank >= 1)
            and ((coalesce(fx.str(old.data->'createdBy') = m.name, false) and fx.has_one(p, array['createEvents'])) or boss);
    end if;
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
alter table public.server_events enable row level security;
grant all on public.server_events to service_role;
grant select, insert, update, delete on public.server_events to authenticated;
drop policy if exists server_events_read on public.server_events;
create policy server_events_read on public.server_events for select to authenticated
  using (fx.in_server((select fx.who()), fx.srv(server_id)) or fx.is_writing('server_events', array[server_id, id]));
drop policy if exists server_events_insert on public.server_events;
drop policy if exists server_events_update on public.server_events;
drop policy if exists server_events_delete on public.server_events;
call fx.write_policies('server_events');
create or replace trigger stamp before insert or update on public.server_events for each row execute function fx.stamp();
create or replace trigger rules before insert or update or delete on public.server_events for each row execute function fx.events_rules();

-- ---------- 65: Grow a Garden trades ----------
-- gardenTrades/{id} = { from, to, give, want, note, status, at, fromDone }: only functions/api/admin (gagtrade) writes
-- them; the two people in a trade can read it.
create table if not exists public.garden_trades (id text primary key, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
insert into fx.routes (pattern, tbl, cols) values ('gardenTrades/*', 'garden_trades', '{id}')
on conflict (pattern) do update set tbl = excluded.tbl, cols = excluded.cols;
alter table public.garden_trades enable row level security;
grant all on public.garden_trades to service_role;
grant select on public.garden_trades to authenticated;
drop policy if exists garden_trades_read on public.garden_trades;
create policy garden_trades_read on public.garden_trades for select to authenticated
  using ((select fx.who()).ok and (fx.str(data->'from') = (select fx.who()).name or fx.str(data->'to') = (select fx.who()).name));
create or replace trigger stamp before insert or update on public.garden_trades for each row execute function fx.stamp();
