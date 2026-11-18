-- Frixion on Supabase, part 13: v4.66 (requests 38 to 56, first part). Run once in Supabase's SQL Editor; 001 to 012 are
-- already there since switch day. It replaces a few profile rules, adds triggers for the Shop, and changes no data
-- except taking Shop items that were deleted off everyone's lists. Running it twice does no harm. The last statement
-- reports accounts whose Orbs were infinite in Firestore and came over empty (Supabase has no place for infinity).

-- ---------- 40: name gradients take 2 to 8 colors (nameplates and banners already could) ----------
create or replace function fx.plain_colors(k text[], d jsonb, premium boolean) returns boolean language sql immutable as $$
  select (not ('bannerColor' = any(k)) or not (d ? 'bannerColor') or fx.hex_color(d->'bannerColor')
          or (premium and coalesce(fx.str(d->'bannerColor') ~ '^linear-gradient\([0-9]{1,3}deg,#[0-9a-fA-F]{6},#[0-9a-fA-F]{6}\)$', false)))
     and (not ('avatarColor' = any(k)) or not (d ? 'avatarColor') or fx.hex_color(d->'avatarColor'))
     and (not ('nameGradient' = any(k)) or not (d ? 'nameGradient')
          or (premium and case when jsonb_typeof(d->'nameGradient') = 'array'
                               then jsonb_array_length(d->'nameGradient') between 2 and 8
                                    and not exists (select 1 from jsonb_array_elements(d->'nameGradient') c where not coalesce(fx.hex_color(c), false))
                               else false end))
$$;

-- ---------- 52: securityLog ----------
-- Kept only by the server (functions/api/admin, each time someone signs in to an account with a one-time password: who
-- made the password and when, the last 10): the account's owner sees it. Nobody can change or clear it from the site,
-- not even whoever used the password while signed in as that account.
create or replace function fx.user_create_ok(username text, d jsonb) returns boolean language sql stable set search_path = '' as $$
  select fx.sub() is not null
     and not exists (select 1 from public.accounts a where a.id = fx.sub())
     and fx.str(d->'username') = username
     and fx.str(d->'authUid') = fx.sub()
     and not (fx.keys(d) && array['password', 'owner', 'coowner', 'terminated', 'redirectUrl', 'redirectNonce', 'mutedUntil', 'muteReason', 'purgePerm', 'cracker', 'casino', 'infOrbs', 'bannerImage', 'customRank', 'credit', 'loanWith', 'loanNext', 'staffBadges', 'securityLog'])
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

create or replace function fx.self_edit(m fx.person, k text[], username text, old jsonb, d jsonb) returns boolean language sql stable as $$
  select m.name = username
     and not (k && array['authUid', 'owner', 'coowner', 'op', 'username', 'createdAt', 'mutedUntil', 'muteReason', 'purgePerm', 'cracker', 'casino', 'infOrbs', 'customRank', 'credit', 'loanWith', 'loanNext', 'staffBadges', 'securityLog'])
     and (not ('bannerImage' = any(k)) or not (d ? 'bannerImage'))
     and (not (k && array['banned', 'banReason', 'bannedUntil']) or fx.clearing_expired_ban(old, d))
     and (not (k && array['redirectUrl', 'redirectNonce']) or not (d ?| array['redirectUrl', 'redirectNonce']))
     and (not ('terminated' = any(k)) or not (d ? 'terminated'))
     and not (d ? 'password')
     and fx.plain_colors(k, d, fx.premium_now(old))
     and fx.economy_ok(k, old, d)
     and fx.stats_ok(k, old, d)
$$;

-- ---------- 48: the same rank ----------
-- Staff may now work on someone of the SAME rank (an Admin on an Admin, a Co-Owner on a Co-Owner): their Orbs,
-- Premium, Shop items and badges. Changing a rank, banning, timing out, redirecting or deleting someone still takes a
-- HIGHER rank, so two people of one rank can't throw each other out. (Before: nobody touched an equal Co-Owner at all,
-- while an Admin could do everything to another Admin, bans included.)
create or replace function fx.staff_edit(m fx.person, k text[], username text, old jsonb, d jsonb) returns boolean language sql stable as $$
  select m.rank >= 1
     and (m.name = username
          or m.rank > fx.rank_of(old)
          or (m.rank = fx.rank_of(old)
              and not (k && array['coowner', 'op', 'customRank', 'banned', 'banReason', 'bannedUntil', 'mutedUntil', 'muteReason',
                                  'terminated', 'redirectUrl', 'redirectNonce', 'purgePerm'])))
     and not (k && array['owner', 'username', 'createdAt', 'authUid', 'securityLog'])
     and (not ('coowner' = any(k)) or m.rank = 3)
     and (not ('purgePerm' = any(k)) or m.rank = 3)
     and not (d ? 'password')
     and (m.rank >= 2 or k <@ array['premiumUntil', 'orbs', 'banned', 'banReason', 'bannedUntil', 'mutedUntil', 'muteReason'])
$$;

-- Deleting an account: its owner (after Delete Account flags it), or a Co-Owner or the Owner on someone of a LOWER
-- rank (before, any Co-Owner could delete any account, the Owner's included).
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
  else
    ok := m.ok and ((m.name = old.id and coalesce(old.data->'terminated'->>'mode', '') = 'real')
                    or (m.rank >= 2 and m.rank > fx.rank_of(old.data)));
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;

-- ---------- 53: something deleted from the Shop leaves everyone's lists ----------
-- Before, it stayed in what people owned (System Hub showed it as "Removed item" with its id). Runs as the database's
-- own owner (security definer), since the person deleting may not edit everyone; it only ever takes that one id out of
-- one list and off the slots that wear it.
create or replace function fx.shop_item_gone() returns trigger language plpgsql security definer set search_path = '' as $$
declare owned text := tg_argv[0]; e text; gone text[];
begin
  if tg_table_name <> 'config' then gone := array[old.id];
  -- (config/customMusic: one song per key, so a key that's gone is a song that's gone)
  elsif tg_op = 'DELETE' then select coalesce(array_agg(key), '{}') into gone from jsonb_object_keys(old.data) key;
  else select coalesce(array_agg(key), '{}') into gone from jsonb_object_keys(old.data) key where not (new.data ? key);
  end if;
  if coalesce(array_length(gone, 1), 0) = 0 then return null; end if;
  update public.users u set data = jsonb_set(u.data, array[owned],
      (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(u.data->owned) x where not ((x #>> '{}') = any(gone))))
    where jsonb_typeof(u.data->owned) = 'array' and u.data->owned ?| gone;
  foreach e in array string_to_array(tg_argv[1], ',') loop
    update public.users u set data = u.data - e where (u.data->>e) = any(gone);
  end loop;
  return null;
end $$;
revoke execute on function fx.shop_item_gone() from public;
create or replace trigger forget_owned after delete on public.shop_decorations for each row execute function fx.shop_item_gone('ownedDecorations', 'equippedDecoration,equippedMask');
create or replace trigger forget_owned after delete on public.shop_themes for each row execute function fx.shop_item_gone('ownedThemes', 'equippedTheme');
create or replace trigger forget_owned after delete on public.shop_nameplates for each row execute function fx.shop_item_gone('ownedNameplates', 'equippedNameplate');
create or replace trigger forget_owned after delete on public.shop_banners for each row execute function fx.shop_item_gone('ownedBanners', 'equippedBanner');
create or replace trigger forget_owned after delete on public.shop_profile_effects for each row execute function fx.shop_item_gone('ownedProfileEffects', 'equippedProfileEffect');
create or replace trigger forget_owned after delete on public.shop_profile_frames for each row execute function fx.shop_item_gone('ownedProfileFrames', 'equippedProfileFrame');
create or replace trigger forget_owned_music after update or delete on public.config for each row when (old.id = 'customMusic')
  execute function fx.shop_item_gone('ownedMusic', 'equippedMusic');

-- What was already left behind: ids of staff-made items (Firestore-style, 20 letters and digits) that no longer exist.
-- Built-in items have readable ids (like "crown"), so they're never touched; banners are all staff-made.
do $$
declare r record; e text;
begin
  for r in select * from (values
      ('ownedDecorations', 'shop_decorations', 'equippedDecoration,equippedMask', '^[A-Za-z0-9]{20}$'),
      ('ownedThemes', 'shop_themes', 'equippedTheme', '^[A-Za-z0-9]{20}$'),
      ('ownedNameplates', 'shop_nameplates', 'equippedNameplate', '^[A-Za-z0-9]{20}$'),
      ('ownedBanners', 'shop_banners', 'equippedBanner', '.'),
      ('ownedProfileEffects', 'shop_profile_effects', 'equippedProfileEffect', '^[A-Za-z0-9]{20}$'),
      ('ownedProfileFrames', 'shop_profile_frames', 'equippedProfileFrame', '^[A-Za-z0-9]{20}$')) v(owned, tbl, equips, pat) loop
    execute format($q$
      update public.users u set data = jsonb_set(u.data, array[%1$L],
          (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(u.data->%1$L) x
           where not (jsonb_typeof(x) = 'string' and (x #>> '{}') ~ %3$L and not exists (select 1 from public.%2$I s where s.id = x #>> '{}'))))
      where jsonb_typeof(u.data->%1$L) = 'array'
        and exists (select 1 from jsonb_array_elements(u.data->%1$L) y
                    where jsonb_typeof(y) = 'string' and (y #>> '{}') ~ %3$L and not exists (select 1 from public.%2$I s where s.id = y #>> '{}'))$q$,
      r.owned, r.tbl, r.pat);
    foreach e in array string_to_array(r.equips, ',') loop
      execute format('update public.users u set data = u.data - %1$L where (u.data->>%1$L) ~ %3$L and not exists (select 1 from public.%2$I s where s.id = u.data->>%1$L)',
        e, r.tbl, r.pat);
    end loop;
  end loop;
end $$;

-- ---------- 51: accounts whose Orbs were infinite in Firestore ----------
-- The copy on switch day could only write them as empty (null), which the site reads as 0. Nothing is changed here:
-- this lists them, so the Owner can say who should have infinite Orbs back.
select count(*) as accounts_with_empty_orbs, coalesce(string_agg(id, ', ' order by id), 'none') as usernames
from public.users where data->'orbs' = 'null'::jsonb;
