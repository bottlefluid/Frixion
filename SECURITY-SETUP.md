# Frixion security update: one-time setup

Until now every password was saved in plain text on each user's profile. Anyone could read the profiles, so anyone
could read every password. Anyone could also sign in as anyone by typing a username into the browser's storage, and
the database let anyone change anything.

This update moves sign-in to **Firebase Authentication** and adds real **database rules**. Do these steps in order.
Steps 1 to 3 change nothing for your users except one extra log in. Step 4 is what actually locks the database.

## 1. Turn on Email/Password sign-in (1 minute)
Firebase Console → your project (`liquidalt`) → **Authentication** → **Get started** (first time only) → **Sign-in method**
→ **Email/Password** → switch on **Enable** (leave "Email link" off) → **Save**.

Do this **before** uploading the new site. If it's off, logging in shows "Sign-in isn't switched on yet".

Frixion gives each account a made-up email (`username@frixion.example.com`). Nothing is ever sent to it, and people still
only type their username.

## 2. Upload the new website
Upload `index.html`, `script.js` and `style.css` as usual. Everyone gets logged out once. When they log back in with
their normal username and password, their account is moved over automatically and the saved copy of the password is deleted.

## 3. Move every other account now
Log in as the Owner, then open **Settings → Owner Panel → System Hub → Secure all accounts**. It moves every account
that still has a saved password (same password, nothing changes for them) and deletes all the saved copies.

- **"Not done yet"**: Firebase only allows about 100 new sign-in accounts per hour from one place. Run it again in an hour.
- **"Name clashes"**: two accounts whose names differ only in capitals (like `Bob` and `bob`). Sign-in names are no
  longer case-sensitive, so only the first of the two could be moved. The other one can't log in until it gets a new
  name (its `users/...` document, and its name in friends lists and servers). This should be rare.

Run it until it says every account is secured. Then do step 4 straight away. (Someone it missed can still log in
afterwards; their account moves over at that moment. But until an account is moved, anyone who knows its old password,
which was public, could claim it first, so don't leave this step for later.)

## 4. Publish the database rules
- **Firestore Database → Rules**: replace everything with the contents of `firestore.rules`, then **Publish**.
- **Realtime Database → Rules**: replace everything with the contents of `database.rules.json`, then **Publish**.

If something stops working after this, the browser console (F12) shows "Missing or insufficient permissions". To undo,
open the Rules tab, pick the previous version from the history on the left, and publish it again.

## 5. Afterwards
- **Ask everyone to change their password** (Settings → My Account → Password). The old ones were readable by anyone, so
  treat them as leaked, especially if someone uses the same password on other sites.
- **The admin password is gone.** Admin Panel access now comes only from the `op` field on an account
  (System Hub → Make Admin). Anyone who used the old password without `op` needs to be made an admin.
- Delete the `config/admin` document in Firestore. It only held the old admin password's hash.
- **Desktop app**: in the `FrxDesktop` folder, publish a GitHub release tagged `v2.1.0` (see its README). That version keeps
  people Online while the app sits in the tray. `config.json` points at `https://frixionbeta.pages.dev/`; change it if
  the app should open a different address.

## What the rules still can't stop
- **Orbs and Premium.** Games run in the browser and award Orbs from there, so a determined player can still give
  themselves Orbs. Making this cheat-proof needs a server (Firebase Cloud Functions, on the paid Blaze plan).
- **Server roles.** Who may kick, delete messages or manage channels inside a server is checked by the app. The rules
  only make sure that nobody outside a server can change it and that nobody can take a server over.
- **Uploads and GIFs.** The Cloudinary upload preset and the KLIPY key are public by design. Set upload limits in the
  Cloudinary dashboard so nobody can fill your storage.

## Testing changes without touching the real database
Install the Firebase CLI, put a `firebase.json` that points at `firestore.rules` and `database.rules.json` next to it,
run `firebase emulators:start --only auth,firestore,database --project liquidalt`, serve the site locally, and open it as
`http://localhost:<port>/?emulators`. Accounts and messages you make there only exist on your computer.

## If you add features later
`firestore.rules` lists every collection and field the app writes. A new collection, or a new field that other people
write to your profile, needs a matching line there, or the database will refuse it.
