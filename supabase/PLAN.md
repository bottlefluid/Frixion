# Moving Frixion from Firebase to Supabase

Branch `supabase` (folder D:\Downloads\Frixion-supabase). Nothing here reaches the live site until switch day, when
this branch is merged into main.

## The approach

Keep the data shaped the way Frixion already uses it, so the 336 database calls in script.js mostly stay as they are:

- **One table per collection**, keyed the same way (users by username, servers by their id). Each row has its id,
  the ids of its parents (a message knows its server and channel), a few real columns for things Frixion searches or
  sorts by (createdAt, uid, members), and `data` (jsonb) holding the document as it is today.
- **A small adapter in the site** (`fdb`) with the calls Frixion uses now: collection/doc, get/set/update/delete/add,
  where/orderBy/limit, onSnapshot, batch, runTransaction, and FieldValue increment, arrayUnion, arrayRemove,
  serverTimestamp and delete. It turns them into Supabase calls. Transforms (increment and so on) run inside the
  database in one statement, so two people can't overwrite each other.
- **Security, ported rule by rule:** who may read a collection becomes a row level security (RLS) policy; what a
  write may change becomes a BEFORE trigger, which sees the old and the new row just like Firestore's `resource` and
  `request.resource`. Each function in firestore.rules (selfEdit, staffEdit, economyOk, statsOk, plainColors...)
  becomes a SQL function with the same name and the same checks. All 764 tests in rules2.test.js are ported case for
  case and run against it, first locally, then on the real project.
- **Server routes** (functions/api: Shop, Casino, eggs, loans, codes, banners, push, the Discord bridge) keep running
  on Cloudflare but call Postgres functions with the secret key. Money things become one database transaction each
  (no more read, check, retry loops).
- **Sign-in:** Supabase Auth with the same made-up emails (username in hex at u.frixionbeta.pages.dev). Old passwords
  keep working: the first login checks them against Firebase's saved hash once, then Supabase stores them. The
  username claim (`n`) comes from a token hook. One-time passwords become server-made login links. Google sign-in is
  set up again in Supabase.
- **Realtime:** listeners become Postgres Changes subscriptions; online status becomes Realtime Presence; typing dots
  (Firestore typing docs and RTDB typingTo) become Broadcast, which writes nothing to the database; the Overcontrol
  RNG lobby (RTDB ocrng/*) becomes Broadcast channels, plus small tables for what has to survive a reload.

**Can't be the same:** App Check (Supabase has none; the policies are the whole wall, plus a captcha on sign-up and
login and rate limits); Firestore's offline copy (rebuilt by hand with the browser's storage).

## Tables

| Firestore path | Table |
| --- | --- |
| users/{username} | users |
| users/{u}/mentions, /meta, /privateNotes | user_mentions, user_meta, user_notes |
| accounts/{authUid} | accounts |
| servers/{sid} | servers |
| servers/{sid}/channels, /categories, /threads | channels, categories, threads |
| servers/{sid}/channels/{cid}/messages | channel_messages |
| servers/{sid}/threads/{tid}/messages | thread_messages |
| servers/{sid}/channels/{cid}/slow | channel_slow |
| dms/{id}, dms/{id}/messages | dms, dm_messages |
| groupDMs/{id}, groupDMs/{id}/messages | group_dms, group_messages |
| */typing (all four) | none: Realtime Broadcast |
| serverCards, discordLinks, config, site | server_cards, discord_links, config, site |
| customEmojis, stickers, shopDecorations, shopThemes, shopNameplates, shopBanners, shopProfileEffects, shopProfileFrames, shopBadges, gardenSeeds, gardenSprinklers, gardenPets | staff_items (one table, `kind` = the collection; same rule for all: anyone signed in reads, staff write) |
| shopPrices | shop_prices |
| redeemCodes, loginCodes, rngCodes | redeem_codes, login_codes, rng_codes |
| rngSaves, sacSaves, orbDays, eggs, loans | rng_saves, sac_saves, orb_days, eggs, loans |
| devices, ips, bannedIps, bannedHw, pushSubs | devices, ips, banned_ips, banned_hw, push_subs |

Realtime Database: presence -> Presence; typingTo -> Broadcast; ocrng/* (roster, session, cmd fights, sweeps) ->
Broadcast channels and small tables.

Other sites on the Firebase project (Gavinperri docs) stay on Firebase.

## Phases

1. Tables, policies, triggers and the ported tests, run locally (PGlite) until all pass.
2. The adapter and the site code, tested against a Supabase project before anyone uses it.
3. Server routes and the Discord timer.
4. Copying data and accounts (reads count against Firebase's 50,000 a day, so spread over days).
5. Switch day: a short read-only window, a last copy, merge into main, push. Firebase stays as a backup.

## Status

- [x] Branch and plan (2026-11-15)
- [ ] Supabase project made (the user)
- [ ] Test tool (PGlite, waiting for the user's OK to download)
- [ ] Phase 1
