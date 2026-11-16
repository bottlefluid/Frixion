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
  select auth.uid() is not null
     and not exists (select 1 from public.accounts a where a.id = auth.uid()::text)
     and fx.str(d->'username') = username
     and fx.str(d->'authUid') = auth.uid()::text
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
create policy users_read on public.users for select to authenticated using (true);           -- anyone signed in
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
