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
