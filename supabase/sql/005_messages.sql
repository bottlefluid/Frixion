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
