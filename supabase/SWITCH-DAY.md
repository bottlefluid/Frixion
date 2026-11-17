# Switch day: Frixion and Gavinperri move to Supabase

Both sites switch together. They are down for about 5 minutes, from the lock (step 1) until the new versions are live
(step 5). Pick a quiet time (traffic jumps around 3 PM Eastern, after school).

## Before the day

- [x] frixionbeta has SUPABASE_URL and SUPABASE_SECRET_KEY (2026-11-16); its /api/admin/info says supabase "ready".
- [x] The setup ran in Supabase, and a rehearsal copy went through (1,592 documents, 2026-11-17).
- [x] Tested: the real end-to-end test, the whole site in the page (85 checks), the server routes (41), the rules
      (703, Gavinperri's included), the copy under the lock (move.html, t-move 15, t-lock 13).
- [ ] **You:** add the same two settings to **equilibrium-incarnate** (Production), where the Discord bridge runs:
      https://dash.cloudflare.com/4071088401428c07213db04018ac0d2b/pages/view/equilibrium-incarnate, Settings,
      Variables and Secrets. (They take effect with the switch's deploy, so no redeploy is needed before.)
- [ ] Agree on a time.

## On the day, in this order

1. **You: lock Firebase.** Firebase console, Firestore, Rules
   (https://console.firebase.google.com/project/liquidalt/firestore/databases/-default-/rules): replace everything
   with https://raw.githubusercontent.com/bottlefluid/Frixion/main/firestore.lock.rules and Publish. From here on no
   page can use Firestore, so Frixion and Gavinperri stop working until step 5. (The Realtime Database's rules stay.)
2. **You: set Supabase up fresh.** SQL Editor (https://supabase.com/dashboard/project/qhiedomoxvmhamjflysa/sql/new):
   paste all of the newest `setup-all.sql` (I send it; it has Gavinperri's tables), Run, and choose "Run without RLS".
   This empties Supabase, so the copy that follows is the only data in it.
3. **You: copy.** Open https://frixionbeta.pages.dev/move.html, sign in as the Owner, press **Start Over**, then
   **Copy**, and wait for "Done" (about a minute). Tell me the Done line and anything under "Not copied".
4. **Me: the new versions.** Merge Frixion's `supabase` branch into main and push (all 5 sites); merge Gavinperri's
   `supabase` branch into its main and push.
5. **Me: check.** The builds (about 2 minutes), then https://frixionbeta.pages.dev/api/admin/info (supabase "ready"),
   /api/push/info, https://equilibrium-incarnate.pages.dev/api/discord/info, and the site loading.
6. **You: look around.** Reload Frixion (and the apps), log in, open a server, your DMs, the Shop; open Gavinperri.
7. **Me: tidy up.** firestore.rules in the repo becomes the lock (what's published); notes.

## If something goes wrong

- **Before step 4:** republish the normal rules (the GitHub raw link of firestore.rules at main, which I give again).
  Everything is as it was; Supabase's copy is simply thrown away later.
- **After step 4:** I revert the merges and push (the old versions are back in about 2 minutes) and you republish the
  normal rules. Anything written on the new versions in between is only in Supabase and would be lost.

## After

- Firestore stays locked as a backup; only the server can read it (move.html could copy again from it).
- Watch Supabase's Usage page (database size, egress, Realtime connections) for the first days.
- move.html, the Owner panel's Supabase tab and /api/admin/move can go once nothing needs a copy any more.
- The CLAUDE.md section about publishing Firestore rules for other sites becomes out of date (other sites' data now
  goes into Frixion's supabase/sql).
