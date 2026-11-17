# Moving Frixion's database from Firestore to Supabase

Branch `supabase` (folder D:\Downloads\Frixion-supabase). Nothing here reaches the live site until switch day, when
this branch is merged into main.

## What moves, what stays (decided 2026-11-16)

- **Firestore moves to Supabase (Postgres).** That's all the data (profiles, servers, messages, DMs, the Shop, the
  Casino, codes...) and it's what ran out of its daily free limit.
- **Sign-in stays on Firebase Authentication.** Supabase accepts Firebase's sign-in tokens (Authentication >
  Third-Party Auth, project liquidalt), so accounts, passwords and one-time passwords stay exactly as they are and
  nothing about them has to be moved. Every user's token needs the claim `role: authenticated` (the server's
  ensureClaims adds it next to `n` and `r`). Supabase's own sign-in isn't used, and a token from it counts as nobody.
- **The Realtime Database stays on Firebase** (online status, DM and group typing through typingTo, the Overcontrol
  RNG lobby), with database.rules.json as it is. It isn't what ran out, and the RNG lobby's position updates would use
  up Supabase's free 2 million live messages a month within hours.
- Other sites on the Firebase project (Gavinperri docs) stay on Firebase.

## The approach

Keep the data shaped the way Frixion already uses it, so the 336 database calls in script.js mostly stay as they are:

- **One table per collection**, keyed the same way (users by username, servers by their id). Each row has its id,
  the ids of its parents (a message knows its server and channel), and `data` (jsonb) holding the document as it is
  today. Timestamps inside `data` are {"$t": milliseconds}.
- **Writes** all go through `public.fx_commit(writes)` (002_commit.sql): Firestore-commit-shaped, one transaction, as
  the person asking, with transforms and preconditions. Checks that compare a batch's end with its start (the rules'
  getAfter) are deferred triggers reading `fx.before(path)`. Writes from the server or the database's own functions
  skip the rules (fx.trusted()).
- **Reads:** one document through `public.fx_get(path)` (Firestore's "get" rules, including the few that let more
  people fetch one document than list them); lists and live listeners straight from the tables, whose read policies
  hold Firestore's "list" rules.
- **Security, ported rule by rule:** read rules are row level security policies; write rules are triggers that see
  the old and new row like `resource` and `request.resource`. Each function in firestore.rules (selfEdit, staffEdit,
  economyOk, statsOk, plainColors...) is a SQL function with the same name and checks. Who is asking: fx.sub(), the
  Firebase token's sign-in id, only for tokens issued for liquidalt.
- **A small adapter in the site** (`fdb`) with the calls Frixion uses now: collection/doc, get/set/update/delete/add,
  where/orderBy/limit, onSnapshot, batch, runTransaction, FieldValue increment/arrayUnion/arrayRemove/
  serverTimestamp/delete. Gets go to fx_get, writes to fx_commit, listeners to Postgres Changes. supabase-js gets the
  Firebase token through its accessToken option.
- **Server routes** (functions/api: Shop, Casino, eggs, loans, codes, banners, push, the Discord bridge) keep running
  on Cloudflare but write with fx_commit and the secret key.

**Can't be the same:** App Check (Supabase has none; the policies are the whole wall); Firestore's offline copy
(rebuilt by hand with the browser's storage). Watch: Supabase's free plan counts live updates (2 million a month)
and data sent out (5 GB + 5 GB cached a month); over either means restrictions until the next month.

## Tables

| Firestore path | Table |
| --- | --- |
| users/{username} | users |
| users/{u}/mentions, /meta, /privateNotes | user_mentions, user_meta, user_notes |
| accounts/{authUid} | accounts (keyed by the Firebase sign-in id, as now) |
| servers/{sid} | servers |
| servers/{sid}/channels, /categories, /threads | channels, categories, threads |
| servers/{sid}/channels/{cid}/messages, /slow, /typing | channel_messages, channel_slow, channel_typing |
| servers/{sid}/threads/{tid}/messages, /typing | thread_messages, thread_typing |
| dms/{id}, its messages, its typing | dms, dm_messages, dm_typing |
| groupDMs/{id}, its messages, its typing | group_dms, group_messages, group_typing |
| serverCards, discordLinks, config | server_cards, discord_links, config |
| customEmojis, stickers, shopDecorations, shopThemes, shopNameplates, shopBanners, shopProfileEffects, shopProfileFrames, shopBadges, gardenSeeds, gardenSprinklers, gardenPets | one table each (custom_emojis, stickers, shop_decorations...): anyone signed in reads, staff write |
| shopPrices | shop_prices |
| redeemCodes, loginCodes, rngCodes | redeem_codes, login_codes, rng_codes |
| rngSaves, sacSaves, orbDays, eggs, loans | rng_saves, sac_saves, orb_days, eggs, loans |
| devices, ips, bannedIps, bannedHw, pushSubs | devices, ips, banned_ips, banned_hw, push_subs |

## Phases

1. Tables, policies, triggers and the ported tests, run locally (PGlite) until all pass. **Done.**
2. The adapter and the site code, tested against a Supabase project before anyone uses it.
3. Server routes, the role claim, and the Discord timer.
4. Copying the data (reads count against Firebase's 50,000 a day, so spread over days).
5. Switch day: a short read-only window, a last copy, merge into main, push. Firestore stays as a backup.

## Status

- [x] Branch and plan (2026-11-15); Supabase project https://qhiedomoxvmhamjflysa.supabase.co (East US)
- [x] Tests on this PC: PGlite 0.5.12 with Supabase's roles and JWT claims (supabase/tests/harness.mjs)
- [x] 001-009: every Firestore collection, with fx_commit and fx_get. On 2026-11-16, with Firebase tokens:
      tests/t-base.mjs 36/36, t-commit.mjs 49/49, and rules2.test.js ported (tests/r2-ported.mjs, made by
      make-r2-ported.js, through r2compat.mjs): 557 pass, 0 fail; its 61 Realtime Database checks stay on Firebase.
- Notes: only a server's first 8 roles count, like Firestore (could be lifted later); fx_commit lets the row it writes
  through the read policies (Firestore never needed read access to write); empty lists are checked with a sample row.
- [x] The user: Third-Party Auth > Firebase (liquidalt) in Supabase, and Supabase's own sign-ups off (2026-11-16)
- [x] Phase 2a, the adapter: fdb.js, Firestore-shaped over supabase-js (tests/t-fdb.mjs 44/44 through
      tests/fake-supabase.mjs)
- [x] Phase 2b, the site on it (2026-11-16): index.html loads supabase-js 2.118.0 and fdb.js instead of Firestore;
      script.js makes `db` with createFdb(); supabaseToken() asks /api/admin/claims once for role: 'authenticated'
      (which now gives it to every sign-in, and only that to one with no account yet); live updates get each new
      token at once (and fdb fetches it before each subscription: supabase-js gives a changed token only to
      subscriptions that finished joining, so early ones stayed signed out). Smoke test on this PC (below): log in,
      register, server messages (send, edit, delete, react, poll vote), DMs, friend requests and profile changes, all
      live between two accounts; nothing refused that should pass, and editing someone else's message is refused.
- [x] The user ran setup-all.sql (sql/001 to 010) in the SQL Editor (2026-11-16). Checked with the publishable key
      alone: 49 routes, signed-out reads and writes refused.
- [x] End-to-end test against the real project with a real Firebase sign-in (2026-11-17, after a first try on 11-16
      stopped at the role claim because Firestore's daily reads were used up): the live claims route gave a temporary
      sign-in its role, Supabase took the Firebase token (account read, a registration like the site's, a query),
      a live update arrived 815 ms after the write (Realtime with Third-Party Auth works), signed-out reads and raising
      one's own Orbs were refused, and the sign-in was deleted. Its profile and account entry stay (an account can't
      delete those) until setup-all.sql runs again.
- [x] The rest of the site on the local setup (2026-11-17): tests/page (run in the page, see helpers.js), 85/85 with no
      error messages or uncaught errors: servers (form, #general, invite card, count), channels, categories, roles,
      joining by invite, threads, pins, mentions, typing notes, /purge; group chats, blocking (DMs refused, groups
      fine), server bans (rejoining refused), leaving a group; the Owner panel (user list, ban, unban, mute, Orbs, Make
      Admin, purge perms, codes, the word filter, and the Devices, IP, Conversations, Codes, Ranks and Supabase tabs);
      game Orbs (earned through the server, spent), saved game state, a cheat refused, the RNG game's save, leaderboards
      and aura queries, Wordle, the Shop (buy, equip, unequip, wearing what you don't own refused), the privacy setting.
- [x] Role claims: live on main since 76dae03 (2026-11-16): every sign-in gets role: 'authenticated' and accounts collect
      it as they sign in.
- [x] Phase 3, the server (2026-11-16): functions/_lib/firestore-on-supabase.js answers the functions' Firestore REST
      requests (get, list, patch, delete, :commit with masks, transforms and preconditions, :batchGet, :runQuery) from
      Supabase once SUPABASE_URL and SUPABASE_SECRET_KEY are set, one request each, so admin, push and discord keep their
      logic. sql/011_server.sql adds fx_get_many (batchGet; the secret key only). tests/t-server.mjs 41/41 on the local
      setup: claims, IP notes, Orbs from games, codes, eggs, the Shop, the casino, one-time passwords, loans, push (DMs,
      mentions, blocks and ranks) and the Discord bridge (verify, send, sync, pull, tick) with a fake Discord. The
      Discord timer Worker only calls the bridge's address: no change.
- [ ] The user, before switch day: SUPABASE_URL and SUPABASE_SECRET_KEY as Cloudflare secrets on frixionbeta (admin,
      push) and equilibrium-incarnate (the Discord bridge); run the new setup-all.sql (it adds fx_get_many)
- [x] Phase 4, the copy tool (main 4c72ed1, live 2026-11-16; merged here as a93a281): the Owner panel's Supabase tab
      (Count, Copy / Carry On, Stop, Start Over; progress kept on that device) calls POST /api/admin/move: 'plan' (the
      collection names in fx_routes, minus typing, plus any top-level Firestore collection Supabase keeps nothing of),
      'count' (Firestore's count, 1 read per 1,000), 'copy' (a collection-group page in name order after the last
      one, written whole with the secret key; a refused page is retried smaller down to the one document, which is
      listed and passed over). It reads Firestore with globalThis.fetch, so the shim here doesn't touch it.
      tests/t-move.mjs 15/15 (Firestore emulator into the stand-in, every document compared) and the tab tried in the
      browser (count, copy, stop, carry on, start over).
- [ ] The copy: the user adds the two secrets on frixionbeta first (the tool needs them), then Count after Firebase's
      daily reset, then chooses: spread over days (free) or billing on for a day.
- Switch day, in order: Frixion read-only (a rules change), run setup-all.sql again (it empties the tables, so
  nothing deleted in Firestore since the first copy survives), copy everything, merge this branch into main, push.
- [x] The first real copy (2026-11-17, the user from the Owner panel): 1,592 documents, Count says 1,592 too; the
      only thing left out was Gavinperri's two collections (no table for them yet then).
- [x] Gavinperri (the other site on this Firebase project) moves too (2026-11-17, the user asked): sql/012_gavinperri.sql
      ports its section of firestore.rules (tables site_gavinperri_doc, site_gavinperri_history, site_gavinperri_images;
      nothing listable; one document at a time through fx_get's exceptions; saves filed in history in the same write,
      checked at the end of the write; pictures made once). Its 146 rule checks are in r2-ported now: 703/703. Its site
      (D:\Downloads\Gavinperri-supabase, branch supabase of bottlefluid/gavinperri, local only) reads and publishes
      through a copy of fdb.js; sign-in stays Firebase's (role claim from frixionbeta's claims route); App Check and
      reCAPTCHA are gone there. Tried locally with the stand-in: 15/15 (reads, admin check, publish with a picture,
      history, naming, a stale publish refused, signed-out reads of only what the library lists) and its list screen.
      Its data is copied by the same Owner tab once this setup runs (the plan picks up its kinds from fx_routes).
      Switch day: both sites together (one lock, one copy), Gavinperri's branch merged and pushed alongside.
- Known: a Realtime filter is one column, so a channel id two servers share ("general") sends both servers' messages
  to a listener, which drops the other's (Realtime messages used for nothing). Supabase's free plan allows 200
  Realtime connections at once (one per open tab) and 100 channels each; Frixion opens about 25 to 35 per tab.

## Testing on this PC (supabase/local)

1. The Firebase emulators for sign-in and the Realtime Database only: `firebase emulators:start --only auth,database`
   with this branch's database.rules.json (ports 9099 and 9000).
2. `node supabase/local/serve.mjs` (Node 24): the site on http://localhost:8124, the Supabase stand-in on 54321
   (PGlite with sql/, answering supabase-js's database calls and live updates the way Supabase does, read rules
   included) and functions/api/admin on 8788.
3. `node supabase/local/seed.mjs`: Tester (the Owner), Sumi, Air and Nova, password pass1, a server, two DMs.
4. Open http://localhost:8124/?emulators. A second account goes in a second tab at http://127.0.0.1:8124/?emulators
   (a different address keeps a separate sign-in). The stand-in's counts: GET :54321/local/stats with the secret key.
5. Tests against it: tests/t-server.mjs (the server's routes; reseeds), tests/t-move.mjs (the copy tool; also needs the
   Firestore emulator on 8080, and wipes it). `serve.mjs --admin-from=<main checkout>` runs main's admin routes
   instead, to try main's Supabase tab from main's site (on the Firestore emulator) against this stand-in.
