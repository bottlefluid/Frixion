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
- [ ] The user: Third-Party Auth > Firebase (liquidalt) in Supabase, and Supabase's own sign-ups off
- [ ] Phase 2: the adapter
