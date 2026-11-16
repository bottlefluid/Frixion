-- Frixion on Supabase, part 8: what staff publish (config, emoji, stickers, the Shop's collections, the garden),
-- push subscriptions, the Discord bridge's link list and game saves (rules: config ... sacSaves).

-- ---------- tables ----------
do $$
declare t text;
begin
  foreach t in array array['config', 'custom_emojis', 'stickers', 'shop_decorations', 'shop_themes', 'shop_nameplates', 'shop_banners',
                           'shop_profile_effects', 'shop_profile_frames', 'shop_badges', 'garden_seeds', 'garden_sprinklers', 'garden_pets',
                           'push_subs', 'discord_links', 'rng_saves', 'rng_codes', 'sac_saves'] loop
    execute format('create table if not exists public.%I (id text primary key, data jsonb not null default ''{}''::jsonb,
                    created_at timestamptz not null default now(), updated_at timestamptz not null default now())', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create or replace trigger stamp before insert or update on public.%I for each row execute function fx.stamp()', t);
  end loop;
end $$;
insert into fx.routes (pattern, tbl, cols) values
  ('config/*', 'config', '{id}'), ('customEmojis/*', 'custom_emojis', '{id}'), ('stickers/*', 'stickers', '{id}'),
  ('shopDecorations/*', 'shop_decorations', '{id}'), ('shopThemes/*', 'shop_themes', '{id}'), ('shopNameplates/*', 'shop_nameplates', '{id}'),
  ('shopBanners/*', 'shop_banners', '{id}'), ('shopProfileEffects/*', 'shop_profile_effects', '{id}'), ('shopProfileFrames/*', 'shop_profile_frames', '{id}'),
  ('shopBadges/*', 'shop_badges', '{id}'), ('gardenSeeds/*', 'garden_seeds', '{id}'), ('gardenSprinklers/*', 'garden_sprinklers', '{id}'),
  ('gardenPets/*', 'garden_pets', '{id}'), ('pushSubs/*', 'push_subs', '{id}'), ('discordLinks/*', 'discord_links', '{id}'),
  ('rngSaves/*', 'rng_saves', '{id}'), ('rngCodes/*', 'rng_codes', '{id}'), ('sacSaves/*', 'sac_saves', '{id}')
on conflict (pattern) do update set tbl = excluded.tbl, cols = excluded.cols;

-- ---------- what staff publish: anyone signed in reads it, staff write it ----------
-- config/ranks: the Owner and Co-Owners (v4.64)
create or replace function fx.published_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  if not coalesce(fx.is_staff(m) and (tg_table_name <> 'config' or coalesce(new.id, old.id) <> 'ranks' or fx.is_owner_level(m)), false) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
do $$
declare t text;
begin
  foreach t in array array['config', 'custom_emojis', 'stickers', 'shop_decorations', 'shop_themes', 'shop_nameplates', 'shop_banners',
                           'shop_profile_effects', 'shop_profile_frames', 'shop_badges', 'garden_seeds', 'garden_sprinklers', 'garden_pets'] loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    call fx.write_policies(t);
    execute format('create or replace trigger rules before insert or update or delete on public.%I for each row execute function fx.published_rules()', t);
  end loop;
end $$;

-- ---------- push subscriptions: only their owner; the same device signing in as someone else takes one over ----------
create or replace function fx.push_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; ok boolean; mine boolean; fresh boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  mine := tg_op <> 'INSERT' and m.ok and coalesce(fx.str(old.data->'uid') = m.name, false);
  fresh := tg_op <> 'DELETE' and m.ok and coalesce(fx.str(new.data->'uid') = m.name, false);
  ok := case tg_op when 'INSERT' then fresh when 'DELETE' then mine
          else fresh and (mine or coalesce(fx.str(old.data->'endpoint') = fx.str(new.data->'endpoint'), false)) end;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
create policy push_subs_read on public.push_subs for select to authenticated
  using (((select fx.who()).ok and fx.str(data->'uid') = (select fx.who()).name) or fx.is_writing('push_subs', array[id]));
call fx.write_policies('push_subs');
create or replace trigger rules before insert or update or delete on public.push_subs for each row execute function fx.push_rules();

-- ---------- the Discord bridge's list of linked channels: kept up to date by anyone in the server ----------
create or replace function fx.discord_links_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who();
  if tg_op = 'INSERT' then
    ok := fx.keys(new.data) <@ array['sid', 'cid', 'channel', 'at'] and fx.str(new.data->'sid') is not null and fx.str(new.data->'cid') is not null
          and new.id = fx.str(new.data->'sid') || '__' || fx.str(new.data->'cid') and fx.in_server(m, fx.srv(fx.str(new.data->'sid')));
  elsif tg_op = 'UPDATE' then
    ok := fx.changed(old.data, new.data) <@ array['channel', 'at'] and fx.in_server(m, fx.srv(fx.str(old.data->'sid')));
  else
    ok := fx.can_manage_channels(m, fx.srv(fx.str(old.data->'sid')));
  end if;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
create policy discord_links_read on public.discord_links for select to authenticated
  using (fx.is_staff((select fx.who())) or fx.is_writing('discord_links', array[id]));
call fx.write_policies('discord_links');
create or replace trigger rules before insert or update or delete on public.discord_links for each row execute function fx.discord_links_rules();

-- ---------- games ----------
-- Overcontrol RNG saves: yours (and your Steal a Character fallback, sac_<name>); the Owner's and Co-Owners' tools too.
create or replace function fx.game_saves_rules() returns trigger language plpgsql set search_path = '' as $$
declare m fx.person; id text; ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  m := fx.who(); id := coalesce(new.id, old.id);
  ok := case tg_table_name
          when 'rng_saves' then m.ok and (m.name = id or id = 'sac_' || m.name or m.rank >= 2)
          else fx.is_who(m, id) or fx.is_owner_level(m) end;
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
create policy rng_saves_read on public.rng_saves for select to authenticated using (true);
call fx.write_policies('rng_saves');
create or replace trigger rules before insert or update or delete on public.rng_saves for each row execute function fx.game_saves_rules();
create policy sac_saves_read on public.sac_saves for select to authenticated using (true);
call fx.write_policies('sac_saves');
create or replace trigger rules before insert or update or delete on public.sac_saves for each row execute function fx.game_saves_rules();
-- Overcontrol RNG codes: anyone signed in fetches one by name (fx_get) and counts a use; the Owner and Co-Owners list,
-- make and delete them.
create or replace function fx.rng_codes_rules() returns trigger language plpgsql set search_path = '' as $$
declare ok boolean;
begin
  if fx.trusted() then return coalesce(new, old); end if;
  ok := fx.is_owner_level(fx.who())
        or (tg_op = 'UPDATE' and auth.uid() is not null and fx.changed(old.data, new.data) <@ array['uses']
            and coalesce(fx.num(coalesce(new.data->'uses', '0'::jsonb)) = coalesce(fx.num(old.data->'uses'), 0) + 1, false));
  if not coalesce(ok, false) then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
create policy rng_codes_list on public.rng_codes for select to authenticated
  using (fx.is_owner_level((select fx.who())) or fx.is_writing('rng_codes', array[id]));
call fx.write_policies('rng_codes');
create or replace trigger rules before insert or update or delete on public.rng_codes for each row execute function fx.rng_codes_rules();
