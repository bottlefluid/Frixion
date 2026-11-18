-- Frixion on Supabase, part 14: v4.67 (requests 47, 56 to 60). Run once in Supabase's SQL Editor, after 013. It changes
-- no data: one rule for the garden's stock, a table for referral codes, and three profile fields only the server writes.
-- Running it twice does no harm.

-- ---------- 59: the garden's stock chances (config/gardenStock): the Owner and Co-Owners, like config/ranks ----------
create or replace function fx.published_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  if not coalesce(fx.is_staff(m) and (tg_table_name <> 'config' or coalesce(new.id, old.id) not in ('ranks', 'gardenStock') or fx.is_owner_level(m)), false) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

-- ---------- 56: referrals ----------
-- referralCodes/<CODE> = { u: whose code }. Only the server (functions/api/admin/referral) reads or writes it: row level
-- security is on and no page has a policy.
create table if not exists public.referral_codes (id text primary key, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
insert into fx.routes (pattern, tbl, cols) values ('referralCodes/*', 'referral_codes', '{id}')
on conflict (pattern) do update set tbl = excluded.tbl, cols = excluded.cols;
alter table public.referral_codes enable row level security;
grant all on public.referral_codes to service_role;
create or replace trigger stamp before insert or update on public.referral_codes for each row execute function fx.stamp();

-- On profiles, refCode (your code), referredBy (who brought you in) and referral ({ friends, earned }) are the
-- server's alone, like securityLog: not at sign-up, not by yourself, not by staff.
create or replace function fx.user_create_ok(username text, d jsonb) returns boolean language sql stable set search_path = '' as $$
  select fx.sub() is not null
     and not exists (select 1 from public.accounts a where a.id = fx.sub())
     and fx.str(d->'username') = username
     and fx.str(d->'authUid') = fx.sub()
     and not (fx.keys(d) && array['password', 'owner', 'coowner', 'terminated', 'redirectUrl', 'redirectNonce', 'mutedUntil', 'muteReason', 'purgePerm', 'cracker', 'casino', 'infOrbs', 'bannerImage', 'customRank', 'credit', 'loanWith', 'loanNext', 'staffBadges', 'securityLog',
                                  'refCode', 'referredBy', 'referral'])
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
     and not (k && array['authUid', 'owner', 'coowner', 'op', 'username', 'createdAt', 'mutedUntil', 'muteReason', 'purgePerm', 'cracker', 'casino', 'infOrbs', 'customRank', 'credit', 'loanWith', 'loanNext', 'staffBadges', 'securityLog',
                         'refCode', 'referredBy', 'referral'])
     and (not ('bannerImage' = any(k)) or not (d ? 'bannerImage'))
     and (not (k && array['banned', 'banReason', 'bannedUntil']) or fx.clearing_expired_ban(old, d))
     and (not (k && array['redirectUrl', 'redirectNonce']) or not (d ?| array['redirectUrl', 'redirectNonce']))
     and (not ('terminated' = any(k)) or not (d ? 'terminated'))
     and not (d ? 'password')
     and fx.plain_colors(k, d, fx.premium_now(old))
     and fx.economy_ok(k, old, d)
     and fx.stats_ok(k, old, d)
$$;

create or replace function fx.staff_edit(m fx.person, k text[], username text, old jsonb, d jsonb) returns boolean language sql stable as $$
  select m.rank >= 1
     and (m.name = username
          or m.rank > fx.rank_of(old)
          or (m.rank = fx.rank_of(old)
              and not (k && array['coowner', 'op', 'customRank', 'banned', 'banReason', 'bannedUntil', 'mutedUntil', 'muteReason',
                                  'terminated', 'redirectUrl', 'redirectNonce', 'purgePerm'])))
     and not (k && array['owner', 'username', 'createdAt', 'authUid', 'securityLog', 'refCode', 'referredBy', 'referral'])
     and (not ('coowner' = any(k)) or m.rank = 3)
     and (not ('purgePerm' = any(k)) or m.rank = 3)
     and not (d ? 'password')
     and (m.rank >= 2 or k <@ array['premiumUntil', 'orbs', 'banned', 'banReason', 'bannedUntil', 'mutedUntil', 'muteReason'])
$$;
