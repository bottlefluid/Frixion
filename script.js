/* ============================================
   FRIXION — script.js
   A Discord-style client backed by Firebase Firestore, with
   Realtime Database for presence and Storage for uploads.

   AUTH: username + password only, no email — accounts are
   documents at users/{username}, same pattern as Toblox.
   NOTE: passwords are stored as plain fields on that doc,
   matching how the Toblox account system works. Fine for a
   personal project; don't reuse a real password here.

   ADMIN: password below is hashed (SHA-256) and checked
   against a hash stored in Firestore at config/admin, same
   as Toblox's admin panel. Operators (op:true on their user
   doc) skip the password entirely, same as Toblox.

   PRESENCE: real online/offline detection needs the Realtime
   Database product enabled on this Firebase project (separate
   from Firestore — Console > Build > Realtime Database >
   Create Database). Once enabled, its rules need to allow the
   presence path:

   {
     "rules": {
       "presence": { ".read": true, "$uid": { ".write": true } }
     }
   }

   If Realtime Database isn't enabled, Frixion falls back to the
   old manual-only status (this is caught automatically — see
   initPresence below).

   AUTO-DELETE: messages older than 7 days are swept client-side
   whenever a conversation with auto-delete turned on is opened —
   there's no server/cron here, so a conversation only actually
   gets cleaned up the next time someone opens it, not on a fixed
   schedule.

   UPLOADS: images are uploaded to ImgBB (free, no backend needed —
   see IMGBB_API_KEY below). Not Imgur — Imgur quietly stopped
   issuing new API applications in late 2025, so that path no longer
   works for new keys. Not Firebase Storage either, because as of
   Feb 2026 Google requires every Firebase project to be on the paid
   Blaze plan just to use Cloud Storage at all, even within the free
   quota — a real paywall for a hobby project on the Spark plan,
   which is almost certainly why uploads were failing originally.
   Non-image files still go through Firebase Storage as a fallback,
   so they'll only work once this project is on Blaze; images and
   GIFs work either way. One honest tradeoff: unlike Imgur's
   Client-ID, an ImgBB key is tied to your personal account and
   isn't really meant to be public — it's embedded in script.js
   here anyway, consistent with how the rest of this app already
   exposes its Firebase config client-side, but worth knowing if you
   ever want to lock this down harder. If you do want general file
   uploads, the Storage rules they'd need are:

   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /{allPaths=**} { allow read, write: if true; }
     }
   }

   GIFS: search is via the KLIPY API (Tenor shut its public API
   down for good in mid-2026). Get a free key at
   https://klipy.com/developers and set GIF_API_KEY below —
   without one, the GIF button explains that it isn't configured
   yet rather than failing silently. KLIPY's exact response shape
   for image URLs isn't fully nailed down here (their docs site is
   a JS app that wouldn't render for me to read directly), so the
   URL-extraction code tries a few plausible shapes and logs the
   raw response to the browser console if none of them match —
   check there and tell me what the real field names are if GIFs
   still don't show up, and I'll fix it precisely.

   REQUIRED Firestore security rules (Firebase Console >
   Firestore > Rules):

   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{username} {
         allow read: if true;
         allow write: if true;
         match /privateNotes/{noteAuthor} { allow read, write: if true; }
       }
       match /config/{doc} { allow read, write: if true; }
       match /customEmojis/{id} { allow read, write: if true; }
       match /stickers/{id} { allow read, write: if true; }
       match /redeemCodes/{code} { allow read, write: if true; }
       match /servers/{sid} {
         allow read, write: if true;
         match /categories/{cid} { allow read, write: if true; }
         match /channels/{cid} {
           allow read, write: if true;
           match /messages/{mid} { allow read, write: if true; }
         }
       }
       match /dms/{did} {
       
         allow read, write: if true;
         match /messages/{mid} { allow read, write: if true; }
       }
       match /groupDMs/{gid} {
         allow read, write: if true;
         match /messages/{mid} { allow read, write: if true; }
       }
     }
   }

   (Wide-open rules because there's no Firebase Auth session
   to key permissions off of — access control here is purely
   app-side, same trust model as Toblox.)
   ============================================ */

// ---------- Firebase init ----------
const firebaseConfig = {
  apiKey: "AIzaSyCaDVRWLOSgC_Nl0YOeoG86G_hd_LKdW2U",
  authDomain: "liquidalt.firebaseapp.com",
  projectId: "liquidalt",
  storageBucket: "liquidalt.firebasestorage.app",
  messagingSenderId: "151067316267",
  appId: "1:151067316267:web:522330446b0fae7cdbda6e",
  measurementId: "G-3BFEPRKV3X"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const FieldValue = firebase.firestore.FieldValue;
// Persist Firestore's cache to IndexedDB instead of memory-only. Without
// this, every full page load (and, on some mobile browsers, every tab
// switch) starts from zero and has to re-fetch everything over the
// network before anything can render — this is most of why Frixion feels
// slow to open, especially on mobile connections. With it, a reload shows
// whatever was last synced instantly, then quietly updates once fresh data
// arrives. Doesn't affect anything else about how data is fetched.
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  if (err.code === 'failed-precondition') {
    // Another tab already has an older SDK's exclusive lock — harmless,
    // just means this tab runs without the offline cache.
    console.warn('Firestore offline cache unavailable in this tab (another tab has it).');
  } else if (err.code === 'unimplemented') {
    console.warn('Firestore offline cache unavailable — this browser doesn\'t support it.');
  }
});
let rtdb = null;
try { rtdb = firebase.database(); } catch (e) { console.warn('Realtime Database not available — presence will stay manual-only.', e); }
let storage = null;
try { storage = firebase.storage(); } catch (e) { console.warn('Storage not available — uploads will be disabled.', e); }

// Get a free key at https://klipy.com/developers (their API is free, no billing needed) and paste it here to enable GIF search.
const GIF_API_KEY = 'TAGiarX1tDFDJvipS3zo71rD97RUMgnAm0iKBjLVVfJdds2DaeGxJEkcCu6GQU2Z';
// Get a free key at https://api.imgbb.com/ (click "Get API key", sign in free, no billing needed) — this is what makes image uploads/paste work.
const IMGBB_API_KEY = '5e07186440c75758ee7f6bd003b1fcd6';

// Shown in place of the color-and-initial avatar for anyone who hasn't uploaded a custom profile picture.
const DEFAULT_AVATAR_URL = 'data:image/png;base64,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';

// ---------- constants ----------
const SESSION_KEY = 'frixion_user';
const ADMIN_HASH = 'f7c323a01e4a88630c1301300a5212a6d21c874c5dee36d26de35cb9b75ca8d4'; // sha256("theflyisflying")

// ============================================================
// SAPPHIRE — Frixion's own bot account. Not a real Firestore user (no
// users/sapphire doc), just a reserved uid that getProfile() short-circuits
// to this fixed profile, so every place that already renders a message
// author (avatar, name, badges) handles it for free. It's added to every
// group DM's participants on creation so it's genuinely part of the
// conversation, but filtered out of member lists / pickers / display
// names wherever those are built — see humanParticipants().
// ============================================================
const SAPPHIRE_UID = 'sapphire';
const SAPPHIRE_AVATAR_URL = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0" stop-color="#6bb3ff"/><stop offset="1" stop-color="#3f7ce0"/>' +
  '</linearGradient></defs>' +
  '<rect x="6" y="6" width="88" height="88" rx="24" fill="url(#g)"/>' +
  '<ellipse cx="36" cy="46" rx="7" ry="9" fill="#fff"/>' +
  '<ellipse cx="64" cy="46" rx="7" ry="9" fill="#fff"/>' +
  '<ellipse cx="36" cy="49" rx="3.2" ry="4" fill="#1b2b4d"/>' +
  '<ellipse cx="64" cy="49" rx="3.2" ry="4" fill="#1b2b4d"/>' +
  '<path d="M32 63 Q50 76 68 63" stroke="#1b2b4d" stroke-width="5" fill="none" stroke-linecap="round"/>' +
  '</svg>'
);
const SAPPHIRE_PROFILE = {
  username: 'Sapphire', avatarColor: '#3f7ce0', avatarUrl: SAPPHIRE_AVATAR_URL,
  status: 'online', premiumUntil: null, bot: true,
};
// Strips Sapphire out of a participants list for anything user-facing
// (member panels, add-friend pickers, auto-generated group names, mention
// suggestions) — it stays in the real array for Firestore/query purposes.
function humanParticipants(list) { return (list || []).filter(p => p !== SAPPHIRE_UID); }
// Usernames nobody can register — checked case-insensitively at signup.
// Extend this if more bot accounts get added later.
const RESERVED_USERNAMES = [SAPPHIRE_UID];

const AVATAR_COLORS = ['#5865f2','#eb459e','#ed4245','#f0b232','#23a55a','#00a8fc','#9b59b6','#e67e22','#1abc9c'];
const BANNER_GRADIENTS = [
  'linear-gradient(135deg,#f5576c,#f093fb)',
  'linear-gradient(135deg,#4facfe,#00f2fe)',
  'linear-gradient(135deg,#43e97b,#38f9d7)',
  'linear-gradient(135deg,#fa709a,#fee140)',
  'linear-gradient(135deg,#30cfd0,#330867)',
  'linear-gradient(135deg,#a18cd1,#fbc2eb)',
  'linear-gradient(135deg,#ff9a9e,#fecfef)',
  'linear-gradient(135deg,#5865f2,#eb459e)',
];

// Exact Discord appearance theme names. Dark/Light/Sync are free; Ash/Onyx are Premium-exclusive.
const THEMES = [
  { key: 'dark',   name: 'Dark',              premium: false },
  { key: 'light',  name: 'Light',             premium: false },
  { key: 'sync',   name: 'Sync with Computer', premium: false },
  { key: 'ash',    name: 'Ash',               premium: true },
  { key: 'onyx',   name: 'Onyx',              premium: true },
];
// Status is fully automatic now (see computeDisplayStatus) — this is just
// a label/color lookup, not a user-editable list anymore.
const STATUSES = [
  { key: 'online', label: 'Online' },
  { key: 'idle', label: 'Idle' },
  { key: 'offline', label: 'Offline' },
];

// ---------- Frixion Premium economy ----------
const STARTING_ORBS = 50;
const PREMIUM_COST_ORBS = 1400;
const PREMIUM_DURATION_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
function isPremium(p) { return !!(p && p.premiumUntil && p.premiumUntil > Date.now()); }
// Chat message length cap. Frixion Premium doubles it — mirrors how the
// rest of the premium perks (extra themes, gradient banners) are gated
// through isPremium(myProfile) elsewhere.
function composerCharLimit() { return isPremium(myProfile) ? 1000 : 500; }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

// ---------- Quests (reset daily) ----------
const QUESTS = [
  { id: 'daily_msgs20', title: 'Chatterbox', desc: 'Send 20 messages', stat: 'messagesSent', goal: 20, reward: 40 },
  { id: 'daily_react10', title: 'Reactionary', desc: 'React to 10 messages', stat: 'reactionsGiven', goal: 10, reward: 25 },
  { id: 'daily_dm', title: 'Say Hi', desc: 'Send a direct message', stat: 'dmsMessaged', goal: 1, reward: 15 },
  { id: 'daily_server', title: 'Show Up', desc: 'Send a message in a server channel', stat: 'channelsMessaged', goal: 1, reward: 15 },
];
async function ensureQuestsFresh(profile) {
  if (profile.questsDate === todayStr()) return profile;
  const reset = {
    questsDate: todayStr(),
    dailyStats: { messagesSent: 0, reactionsGiven: 0, dmsMessaged: 0, channelsMessaged: 0 },
    claimedQuestsToday: [],
  };
  try { await db.collection('users').doc(myUid).update(reset); } catch (e) {}
  return { ...profile, ...reset };
}

// ============================================================
// UPDATE LOG — newest first. Add a new entry after every update.
// ============================================================
const UPDATES = [
  { v: '2.8', date: '2026-09-05', title: 'Polls, server discovery, and a cleaner status dot',
    notes: [
      'Polls: hit the "+" button next to the message box (or type /poll and hit Enter) to build one — question, up to 10 answers, optional per-answer emoji, a duration, and an optional "allow multiple answers" toggle. Posted polls show live vote bars right in the chat and lock to "Final results" once they expire. They auto-delete after 7 days along with the rest of a conversation\'s messages, same as everything else, unless that conversation has auto-delete turned off.',
      'Explore Servers actually works now — it lists every server that exists, with member counts, and lets you join one straight from there instead of needing an invite.',
      'The online/idle/dnd status dot on avatars is a real cutout now instead of a colored border guessing at the background behind it, so it no longer looks slightly off depending on where an avatar shows up.',
      'Removed the Nitro-style ad button from the server rail.',
    ] },
  { v: '2.7', date: '2026-09-02', title: 'Keyboard docking on more browsers',
    notes: [
      'Told Android browsers (Chrome, Edge, Samsung Internet) to resize the page for the keyboard themselves, which is the more reliable way to handle it there.',
      'Added a fallback re-check right when a text field is focused or unfocused, for any browser that\'s slow to report the keyboard opening.',
      'iOS Safari, Chrome, Firefox, and Edge on iPhone/iPad were already covered, since Apple requires them all to use the same engine under the hood.',
    ] },
  { v: '2.6', date: '2026-09-02', title: 'Toolbar overlap and keyboard docking, actually fixed',
    notes: [
      'The message toolbar redesign in 2.5 fixed images but still overlapped the username or the message above it for short text — that\'s fixed now too, it only ever sits on top of its own message.',
      'Fixed the on-screen keyboard leaving a gap above itself instead of the composer actually docking against it.',
      'iPads now get that same keyboard docking — they still get the roomier desktop-style layout otherwise, this was just about the keyboard.',
    ] },
  { v: '2.5', date: '2026-09-02', title: 'Hover toolbar now hugs the message, gone on mobile',
    notes: [
      'The react/reply/edit/pin/delete toolbar now sits right next to the message or image it belongs to, instead of floating off on the far right of the screen for short messages.',
      'That toolbar no longer shows up on phones at all — it was quietly overriding the long-press action sheet added in 2.3. Long-press is the only way to get message actions on mobile now, like it\'s supposed to be.',
    ] },
  { v: '2.4', date: '2026-09-02', title: 'Picker panels, gift modal, and pin highlights',
    notes: [
      'Emoji, GIF, and sticker pickers now open on the right, right above the buttons that open them, instead of popping up over on the left.',
      'Gift Frixion Premium now opens on the right instead of dead-center.',
      'Pinned messages got a cleaner look — pinned text turns gold, and pinned images/GIFs/stickers get a gold border that hugs the image itself instead of a box that could crowd the username above it.',
    ] },
  { v: '2.3', date: '2026-09-02', title: 'Message editing, replies, full-emoji reactions, and a mobile action sheet',
    notes: [
      'You can now edit your own messages — an edit button appears on hover, and the message is marked "(edited)" afterward. You still can\'t edit or delete anyone else\'s message.',
      'Added replies. Hit reply on any message and your next message carries a quoted reference to it; tapping that reference jumps to and briefly highlights the original.',
      'Emoji reactions are no longer limited to a small fixed set — the reaction picker is now the full searchable emoji picker, including your server\'s custom emoji.',
      'Fixed the sticker and emoji pickers being able to stay open at the same time.',
      'On phones, holding down a message now brings up a Discord-mobile-style action sheet (quick reactions plus Edit, Reply, Copy Text, Pin, Delete) instead of relying on hover icons that don\'t really work with touch.',
    ] },
  { v: '2.2', date: '2026-09-01', title: 'Mobile polish, conversation previews, and cleaner themes',
    notes: [
      'Phone conversations now use the full screen. The compact server rail stays with the list, instead of squeezing the chat and composer into the remaining space.',
      'The composer now follows the visible browser viewport when the on-screen keyboard opens or closes, so it stays docked above the keyboard instead of being covered or jumping around.',
      'Direct messages now show a short recent-message preview on phones. Existing conversations pick up their latest message too, and images, files, GIFs, and stickers get a useful label instead of a blank line.',
      'Dark, Light, Ash, and Onyx now carry through the settings navigation, account controls, hover surfaces, and popovers as well as the main chat.',
    ] },
  { v: '2.1', date: '2026-09-01', title: 'Switched to ImgBB, fixed GIF search',
    notes: [
      'Image uploads and pasting now go through ImgBB instead of Imgur — should be faster and more reliable.',
      'GIF search got fixed under the hood, so results actually show up now.',
      'Online/offline status now reflects your real connection, not just whatever you last set it to.',
    ] },
  { v: '2.0', date: '2026-08-31', title: 'Custom avatars, mobile swipe, and a bunch of bug fixes',
    notes: [
      'You can now upload a custom profile picture instead of the color-and-initial avatar — open your profile and tap the pencil icon (uploads through Imgur, same as image uploads in chat).',
      'Mobile now animates between the list and chat like Discord\'s app instead of just cutting between them.',
      'Added swipe gestures for Direct Messages on mobile only: swipe right to close a DM back to the list, swipe left to reopen it. Servers still use taps, not swipes.',
      'Fixed a real bug: channel rows only responded to clicks on the text itself, not the row around it — this was very likely why switching channels sometimes felt "frozen," you just had to click the exact word. The whole row is clickable now.',
      'Fixed the flash when opening a server or switching conversations — loading only shows a spinner if it genuinely takes a moment, so fast loads (the common case) show the real content directly instead of flashing through a blank or loading screen first.',
      'Direct messages now have noticeably more breathing room between them, on both mobile and desktop.',
      'Turned off text selection across the UI (buttons, names, labels) so dragging around the app doesn\'t highlight text — message content, bios, notes, and anything you type into are still fully selectable.',
    ] },
  { v: '1.9', date: '2026-08-30', title: 'Fixed uploads, switched off Tenor',
    notes: [
      'GIF search is back — switched providers after the old one stopped working.',
      'Fixed image uploads and pasting — sorry about the outage, that should be smooth again now.',
      'Regular (non-image) file uploads might still be a little flaky here and there — still working on that one.',
    ] },
  { v: '1.8', date: '2026-08-26', title: 'Real presence, uploads, GIFs, stickers, and message expiry',
    notes: [
      'Added real online/offline presence — it now knows when your connection actually drops (closed tab, crash, lost network), not just what status you last picked.',
      'Messages older than 7 days are now cleaned up automatically per-conversation. This runs the next time someone opens that conversation, not on a fixed schedule, since there\'s no backend cron here.',
      'Admins can turn auto-delete on or off for any DM, group, or channel from a new Conversations tab in the Admin Panel.',
      'You can now paste an image straight into the message box, or upload any file with the new attach button.',
      'Added GIF search powered by Tenor.',
      'Added stickers — admins publish them from the Admin Panel, everyone can send them from the new sticker picker.',
      'Admins can now set a custom code instead of a random one when generating an Orb/Premium code.',
      'The emoji shortcode list grew a lot — every common emoji you\'d expect, including :fire:, now has a :shortcode:.',
    ] },
  { v: '1.7', date: '2026-08-25', title: 'Mobile support, gradient banners, and load-time fixes',
    notes: [
      'Added a phone-friendly layout: the server rail stays put and the channel/DM list slides over for the chat area, with a back button. (Tablets like iPad keep the regular desktop-style layout.)',
      'Fixed the flash on refresh — Frixion now shows a loading splash instead of briefly flashing the login screen before signing you in.',
      'Fixed a flash when opening a server — shows a loading spinner instead of an empty "no conversation" flicker while channels load.',
      'Fixed a bug where switching from a channel in one server to another server could fail to select a channel at all.',
      'Fixed a server with zero channels getting stuck instead of showing an empty state.',
      'Frixion Premium members can now set a gradient banner on their profile, not just a solid color.',
      'Fixed the bio field on profiles rendering as an unstyled white box.',
      'Status (Online/Idle/Do Not Disturb/Invisible) is a setting you control yourself, not automatic presence — closing the tab without logging out can leave you shown as online until you sign back in.',
    ] },
  { v: '1.6', date: '2026-08-24', title: 'Friends, profiles, group DMs, gifting, and a lot more',
    notes: [
      'Frixion Premium now costs 1400 Orbs and lasts 3 days, and Quests reset every day instead of being one-time.',
      'Added a real Friends system: send/accept/decline requests, and a Friends tab above your DMs.',
      'Added Group DMs — pick friends to start a group, add more people later, and it lives right in your DM list.',
      'Added user profiles: banner color, pronouns, bio, and a private note on other people\'s profiles that only you can see. Click any name or avatar to open one.',
      'Added a Codes tab: buying or gifting Premium now gives you a redeemable code instead of applying instantly.',
      'You can gift Frixion Premium to someone you\'re DMing if you have enough Orbs.',
      'Admins can now grant or remove Frixion Premium directly, and generate Orb/Premium codes from the Admin Panel.',
      'Servers can now have channel categories, just like Discord — collapsible groups that channels live under.',
      'Rebuilt the message box to match Discord\'s exact layout: attach, emoji, gift, GIF and sticker icons, no more explicit Send button.',
      'The emoji picker now has a full categorized set (Smileys, People, Animals, Food, Activities, Travel, Objects, Symbols) with jump-to-category icons.',
      'Fixed empty channels and DMs showing a generic "no conversation selected" message — they now show a proper "Welcome to #channel" start-of-conversation state.',
    ] },
  { v: '1.5', date: '2026-08-23', title: 'Orbs, Quests, a real subscription, and a message filter',
    notes: [
      'Frixion Premium is no longer free — it now costs 150 Orbs and runs as a 30-day subscription that you can renew.',
      'Added Orbs, a currency you earn by completing Quests (send messages, react, make friends, join servers) — see the new Quests tab in Settings.',
      'Admins can grant or remove Orbs from any player in the Admin Panel.',
      'Renamed the appearance themes to match Discord\'s actual theme names: Dark, Light, Sync with Computer, Ash and Onyx. Ash and Onyx are the two Premium-exclusive ones.',
      'Added a Message Filter: admins can add words in the Admin Panel, and Frixion will catch leetspeak, repeated letters, and spaced-out bypasses — but only as whole words, so normal words that happen to contain a filtered word are left alone. Caught words are replaced with [CENSORED].',
    ] },
  { v: '1.4', date: '2026-08-22', title: 'A proper title bar, pins, and search',
    notes: [
      'Added a desktop-app-style title bar up top, with Inbox and Help buttons and window controls.',
      'You can now pin important messages — hover a message and pin it, then browse pins from the new pin icon in the channel header.',
      'Added in-conversation message search.',
      'Added a mute toggle per channel and DM.',
      'The reaction and pin toolbar on messages now floats above the message like the real thing, instead of sitting inline.',
      'Added an "Explore Servers" button to the server rail (discovery itself is coming soon).',
    ] },
  { v: '1.3', date: '2026-08-22', title: 'Visual overhaul and an Update Log',
    notes: [
      'Added this Update Log so you can see what changed and when.',
      'Fixed a rendering glitch where the logo on the login screen could appear clipped on first paint.',
      'Switched the app to the Inter typeface and tightened up spacing, colors and hover states across the whole interface to feel closer to the real Discord client.',
      'Server icons in the left rail now show a growing indicator pill on hover, not just when active.',
      'The message box now shows "Message #channel-name" or "Message @username" depending on where you are, instead of a generic placeholder.',
    ] },
  { v: '1.2', date: '2026-08-22', title: 'Reactions and custom emoji',
    notes: [
      'You can now react to any message with an emoji — hover a message and tap the smiley.',
      'Added an emoji picker to the message box with searchable shortcodes like :fire: and :heart:.',
      'Admins can publish custom emoji from the Admin Panel for everyone to use with a :shortcode:.',
    ] },
  { v: '1.1', date: '2026-08-22', title: 'Simpler sign-ups and an Admin Panel',
    notes: [
      'Accounts now just need a username and password — no email required.',
      'Added a password-protected Admin Panel. Operators can promote or demote other admins, issue temporary bans, and delete accounts, all without re-entering the password.',
      'Replaced every emoji used as an interface icon with clean line icons.',
    ] },
  { v: '1.0', date: '2026-08-22', title: 'Frixion launches',
    notes: [
      'Servers, text channels, real-time chat, direct messages and a member list.',
      'Frixion Premium: unlock 5 exclusive color themes and a badge next to your name.',
    ] },
];
function renderUpdates() {
  $('updates-list').innerHTML = UPDATES.map((u, i) => `
    <div class="update-entry">
      <div class="ue-head">
        <span class="ue-ver">v${esc(u.v)}</span>
        <span class="ue-title">${esc(u.title)}</span>
        ${i === 0 ? '<span class="ue-latest">Latest</span>' : ''}
        <span class="ue-date">${esc(u.date)}</span>
      </div>
      <ul class="ue-notes">${u.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    </div>`).join('');
}

// ---------- inline icon set (no emoji, currentColor SVGs) ----------
const ICONS = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="7" cy="18" r="2" fill="currentColor" stroke="none"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9" r="2.3"/><path d="M15 14.2c2.6.3 4.5 2.4 4.5 5.3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 14.5l5-5"/><path d="M11 5.5l.8-.8a3.6 3.6 0 0 1 5.1 5.1l-.9.9"/><path d="M13 18.5l-.8.8a3.6 3.6 0 0 1-5.1-5.1l.9-.9"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6h17"/><path d="M8 6V4.2c0-.66.54-1.2 1.2-1.2h5.6c.66 0 1.2.54 1.2 1.2V6"/><path d="M18.5 6l-.9 13.1a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.95 6.4 7 .63-5.3 4.66 1.6 6.86-6.25-3.78-6.25 3.78 1.6-6.86-5.3-4.66 7-.63z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l7 3v5.5c0 4.6-3 8.3-7 9.5-4-1.2-7-4.9-7-9.5V6z"/></svg>',
  smiley: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8.5 14c.8 1.2 2 2 3.5 2s2.7-.8 3.5-2" stroke-linecap="round"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2 2-5 5-4 1 7 7 1-4 5-5 2 2"/><path d="M9 15l-5 5"/></svg>',
  orb: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="9" cy="9" r="2.6" fill="#fff" opacity=".55"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  crown: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 8.5l4 3 5-6 5 6 4-3-1.6 9.5a1 1 0 0 1-1 .8H5.6a1 1 0 0 1-1-.8z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-8-8 18-2.5-7.5L3 11z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  poll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10"/><path d="M12 20V4"/><path d="M20 20v-7"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>',
};
function icon(name, cls) { return `<span class="i ${cls||''}">${ICONS[name] || ''}</span>`; }

// ---------- emoji: reactions + shortcodes + custom (uploaded via Admin Panel) ----------
const REACT_EMOJIS = ['👍','❤️','😂','🔥','😮','😢','🎉'];
const EMOJI_CATEGORIES = [
  { key: 'smileys', label: 'Smileys', icon: '😀', items: {
    grinning:'😀', smiley:'😃', smile:'😄', grin:'😁', laughing:'😆', sweat_smile:'😅', joy:'😂', rofl:'🤣',
    slight_smile:'🙂', upside_down:'🙃', melting:'🫠', wink:'😉', blush:'😊', innocent:'😇', heart_eyes:'😍',
    star_struck:'🤩', heart_face:'🥰', kissing:'😗', kissing_closed_eyes:'😚', kissing_smiling_eyes:'😙',
    kissing_heart:'😘', yum:'😋', stuck_out_tongue:'😛', stuck_out_tongue_winking:'😜',
    zany:'🤪', sunglasses:'😎', nerd:'🤓', monocle:'🧐', smirk:'😏', unamused:'😒', neutral:'😐',
    expressionless:'😑', no_mouth:'😶', relieved:'😌', pensive:'😔', sleepy:'😪', drooling:'🤤',
    sleeping:'😴', thinking:'🤔', zipper_mouth:'🤐', raised_eyebrow:'🤨', money_mouth:'🤑', shush:'🤫',
    hand_over_mouth:'🤭', yawn:'🥱', confused:'😕', slight_frown:'🙁', frowning:'☹️', open_mouth:'😮',
    hushed:'😯', astonished:'😲', flushed:'😳', pleading:'🥺', worried:'😟', anguished:'😧',
    fearful:'😨', cold_sweat:'😰', cry:'😢', sob:'😭', scream:'😱', confounded:'😖', persevere:'😣',
    disappointed:'😞', sweat:'😓', weary:'😩', tired:'😫', angry:'😠', rage:'😡', triumph:'😤',
    dizzy_face:'😵', exploding_head:'🤯', cowboy:'🤠', partying:'🥳', woozy:'🥴', sick:'🤢', vomit:'🤮',
    sneeze:'🤧', hot:'🥵', cold:'🥶', mask:'😷', bandage_face:'🤕', clown:'🤡', poop:'💩',
    ghost:'👻', skull:'💀', skull_crossbones:'☠️', alien:'👽', robot:'🤖', jack_o_lantern:'🎃',
  } },
  { key: 'people', label: 'People', icon: '👋', items: {
    wave:'👋', raised_hand:'✋', raised_back_hand:'🤚', hand_splayed:'🖐️', vulcan:'🖖', ok_hand:'👌',
    pinch:'🤏', v:'✌️', crossed_fingers:'🤞', love_you:'🤟', metal:'🤘', point_up:'☝️', point_up_2:'👆',
    point_down:'👇', point_left:'👈', point_right:'👉', middle_finger:'🖕', thumbsup:'👍', thumbsdown:'👎',
    fist:'✊', fist_left:'🤛', fist_right:'🤜', punch:'👊', clap:'👏', raised_hands:'🙌', open_hands:'👐',
    palms_up:'🤲', pray:'🙏', handshake:'🤝', writing_hand:'✍️', nail_care:'💅', muscle:'💪',
    leg:'🦵', foot:'🦶', ear:'👂', nose:'👃', brain:'🧠', tooth:'🦷', eyes:'👀', eye:'👁️', tongue:'👅',
    lips:'👄', baby:'👶', child:'🧒', boy:'👦', girl:'👧', adult:'🧑', man:'👨', woman:'👩',
    older_adult:'🧓', older_man:'👴', older_woman:'👵', cop:'👮', guard:'💂', detective:'🕵️',
    health_worker:'🧑‍⚕️', student:'🧑‍🎓', teacher:'🧑‍🏫', judge:'🧑‍⚖️', farmer:'🧑‍🌾', cook:'🧑‍🍳',
    mechanic:'🧑‍🔧', scientist:'🧑‍🔬', artist:'🧑‍🎨', pilot:'🧑‍✈️', astronaut:'🧑‍🚀', firefighter:'🧑‍🚒',
    mage:'🧙', fairy:'🧚', vampire:'🧛', mermaid:'🧜', elf:'🧝', genie:'🧞', zombie:'🧟',
    superhero:'🦸', supervillain:'🦹', ninja:'🥷',
  } },
  { key: 'animals', label: 'Animals', icon: '🐶', items: {
    dog:'🐶', cat:'🐱', mouse:'🐭', hamster:'🐹', rabbit:'🐰', fox:'🦊', bear:'🐻', panda:'🐼',
    koala:'🐨', tiger:'🐯', lion:'🦁', cow:'🐮', pig:'🐷', frog:'🐸', monkey:'🐵', chicken:'🐔',
    penguin:'🐧', bird:'🐦', baby_chick:'🐤', eagle:'🦅', owl:'🦉', bat:'🦇', wolf:'🐺', boar:'🐗',
    horse:'🐴', unicorn:'🦄', bee:'🐝', bug:'🐛', butterfly:'🦋', snail:'🐌', ladybug:'🐞', ant:'🐜',
    spider:'🕷️', scorpion:'🦂', turtle:'🐢', snake:'🐍', lizard:'🦎', t_rex:'🦖', sauropod:'🦕',
    octopus:'🐙', squid:'🦑', shrimp:'🦐', crab:'🦀', lobster:'🦞', blowfish:'🐡', fish:'🐟',
    dolphin:'🐬', whale:'🐳', shark:'🦈', crocodile:'🐊', elephant:'🐘', hippo:'🦛', rhino:'🦏',
    camel:'🐫', giraffe:'🦒', kangaroo:'🦘', zebra:'🦓', gorilla:'🦍', sloth:'🦥', otter:'🦦',
    skunk:'🦨', raccoon:'🦝', peacock:'🦚', parrot:'🦜', flamingo:'🦩', swan:'🦢', dove:'🕊️',
    dragon:'🐉', dragon_face:'🐲', paw_prints:'🐾',
  } },
  { key: 'food', label: 'Food', icon: '🍕', items: {
    apple:'🍎', green_apple:'🍏', pear:'🍐', tangerine:'🍊', lemon:'🍋', banana:'🍌', watermelon:'🍉',
    grapes:'🍇', strawberry:'🍓', melon:'🍈', cherries:'🍒', peach:'🍑', mango:'🥭', pineapple:'🍍',
    coconut:'🥥', kiwi:'🥝', tomato:'🍅', eggplant:'🍆', avocado:'🥑', broccoli:'🥦', carrot:'🥕',
    corn:'🌽', hot_pepper:'🌶️', potato:'🥔', garlic:'🧄', onion:'🧅', bread:'🍞', croissant:'🥐',
    baguette:'🥖', pretzel:'🥨', cheese:'🧀', egg:'🥚', bacon:'🥓', pancakes:'🥞', waffle:'🧇',
    pizza:'🍕', hamburger:'🍔', fries:'🍟', hotdog:'🌭', sandwich:'🥪', taco:'🌮', burrito:'🌯',
    salad:'🥗', popcorn:'🍿', sushi:'🍣', bento:'🍱', ramen:'🍜', spaghetti:'🍝', curry:'🍛',
    dumpling:'🥟', shaved_ice:'🍧', icecream:'🍦', doughnut:'🍩', cookie:'🍪', birthday_cake:'🎂',
    cake:'🍰', cupcake:'🧁', pie:'🥧', chocolate:'🍫', candy:'🍬', lollipop:'🍭', honey:'🍯',
    coffee:'☕', tea:'🍵', boba:'🧋', beer:'🍺', beers:'🍻', wine:'🍷', champagne:'🍾', cocktail:'🍸',
    tropical_drink:'🍹', soda:'🥤', milk:'🥛', chopsticks:'🥢',
  } },
  { key: 'activities', label: 'Activities', icon: '⚽', items: {
    soccer:'⚽', basketball:'🏀', football:'🏈', baseball:'⚾', softball:'🥎', tennis:'🎾',
    volleyball:'🏐', rugby:'🏉', frisbee:'🥏', pool_8ball:'🎱', bowling:'🎳', golf:'⛳', dart:'🎯',
    fishing:'🎣', boxing:'🥊', martial_arts:'🥋', running:'🏃', swimmer:'🏊', surfing:'🏄',
    weightlifting:'🏋️', biking:'🚴', mountain_biking:'🚵', skateboard:'🛹', skiing:'⛷️',
    snowboarding:'🏂', ice_skate:'⛸️', trophy:'🏆', medal:'🏅', first_place:'🥇', second_place:'🥈',
    third_place:'🥉', video_game:'🎮', dice:'🎲', chess:'♟️', puzzle:'🧩', slot_machine:'🎰',
    guitar:'🎸', piano:'🎹', drum:'🥁', violin:'🎻', trumpet:'🎺', microphone:'🎤', headphones:'🎧',
    musical_note:'🎵', notes:'🎶', tada:'🎉', confetti:'🎊', gift:'🎁', balloon:'🎈', ticket:'🎫',
    art:'🎨', clapper:'🎬', circus:'🎪', yoyo:'🪀', kite:'🪁',
  } },
  { key: 'travel', label: 'Travel', icon: '🚗', items: {
    car:'🚗', taxi:'🚕', bus:'🚌', police_car:'🚓', ambulance:'🚑', fire_truck:'🚒', truck:'🚚',
    tractor:'🚜', bike:'🚲', scooter:'🛴', motorcycle:'🏍️', train:'🚆', bullettrain:'🚄', tram:'🚊',
    monorail:'🚝', airplane:'✈️', small_airplane:'🛩️', rocket:'🚀', helicopter:'🚁', canoe:'🛶',
    sailboat:'⛵', speedboat:'🚤', ship:'🚢', anchor:'⚓', fuelpump:'⛽', traffic_light:'🚦',
    construction:'🚧', compass:'🧭', map:'🗺️', mountain:'⛰️', volcano:'🌋', camping:'🏕️',
    beach:'🏖️', desert:'🏜️', island:'🏝️', stadium:'🏟️', house:'🏠', house_garden:'🏡',
    school:'🏫', hospital:'🏥', bank:'🏦', hotel:'🏨', church:'⛪', mosque:'🕌', castle:'🏰',
    tent:'⛺', city:'🏙️', bridge:'🌉', tokyo_tower:'🗼', statue_of_liberty:'🗽',
    sunrise:'🌅', sunset:'🌇', night:'🌃', stars:'🌌', rainbow:'🌈', star:'⭐', star2:'🌟',
    full_moon:'🌕', new_moon:'🌑', crescent_moon:'🌙', sun:'☀️', cloud:'☁️', partly_sunny:'⛅',
    rain:'🌧️', thunder_cloud:'⛈️', snow_cloud:'🌨️', snowflake:'❄️', snowman:'⛄', comet:'☄️',
    fire:'🔥', droplet:'💧', ocean_wave:'🌊', tornado:'🌪️', fog:'🌫️', wind:'🌬️',
  } },
  { key: 'objects', label: 'Objects', icon: '💡', items: {
    bulb:'💡', flashlight:'🔦', candle:'🕯️', lantern:'🏮', book:'📖', books:'📚', notebook:'📓',
    bookmark:'🔖', newspaper:'📰', pencil:'✏️', pen:'🖊️', paperclip:'📎', pushpin:'📌', scissors:'✂️',
    lock:'🔒', unlock:'🔓', key:'🔑', old_key:'🗝️', hammer:'🔨', axe:'🪓', pick:'⛏️', wrench:'🔧',
    gear:'⚙️', chains:'⛓️', magnet:'🧲', gun:'🔫', bomb:'💣', knife:'🔪', dagger:'🗡️', shield:'🛡️',
    smoking:'🚬', coffin:'⚰️', urn:'⚱️', gem:'💎', ring:'💍', crown:'👑', lipstick:'💄', hat:'🎩',
    glasses:'👓', umbrella:'☂️', briefcase:'💼', luggage:'🧳', backpack:'🎒', money:'💵',
    dollar:'💲', credit_card:'💳', receipt:'🧾', chart:'📈', envelope:'✉️', package:'📦',
    mailbox:'📫', phone:'📱', telephone:'☎️', computer:'💻', keyboard:'⌨️', printer:'🖨️',
    camera:'📷', video_camera:'📹', tv:'📺', radio:'📻', battery:'🔋', plug:'🔌', clock:'🕐',
    alarm_clock:'⏰', hourglass:'⌛', thermometer:'🌡️', toilet:'🚽', shower:'🚿', bathtub:'🛁',
    soap:'🧼', broom:'🧹', bed:'🛏️', couch:'🛋️', door:'🚪', mirror:'🪞', balloon2:'🎈',
  } },
  { key: 'symbols', label: 'Symbols', icon: '❤️', items: {
    heart:'❤️', orange_heart:'🧡', yellow_heart:'💛', green_heart:'💚', blue_heart:'💙',
    purple_heart:'💜', black_heart:'🖤', white_heart:'🤍', brown_heart:'🤎', broken_heart:'💔',
    heart_exclamation:'❣️', sparkling_heart:'💖', two_hearts:'💕', revolving_hearts:'💞',
    heartbeat:'💓', heartpulse:'💗', gift_heart:'💝', cupid:'💘', sparkles:'✨', boom:'💥',
    dizzy:'💫', zzz:'💤', hundred:'💯', hundred_points:'💯', check:'✅', heavy_check_mark:'✔️',
    x:'❌', negative_squared_cross_mark:'❎', warning:'⚠️', question:'❓', grey_question:'❔',
    exclamation:'❗', grey_exclamation:'❕', no_entry:'🚫', prohibited:'🈲', recycle:'♻️',
    infinity:'♾️', peace:'☮️', yinyang:'☯️', om:'🕉️', atom:'⚛️', radioactive:'☢️', biohazard:'☣️',
    flag_checkered:'🏁', triangular_flag:'🚩', arrow_up:'⬆️', arrow_down:'⬇️', arrow_left:'⬅️',
    arrow_right:'➡️', arrows_counterclockwise:'🔄', up_down_arrow:'↕️', musical_notes2:'🎶',
    speech_balloon:'💬', thought_balloon:'💭', eye_speech_bubble:'👁️‍🗨️', red_circle:'🔴',
    orange_circle:'🟠', yellow_circle:'🟡', green_circle:'🟢', blue_circle:'🔵', purple_circle:'🟣',
    black_circle:'⚫', white_circle:'⚪', red_square:'🟥', blue_square:'🟦',
  } },
];
const SHORTCODE_MAP = Object.assign({}, ...EMOJI_CATEGORIES.map(c => c.items));
let customEmojis = {}; // name -> { name, dataUrl }
function subscribeCustomEmojis() {
  db.collection('customEmojis').onSnapshot(snap => {
    const map = {};
    snap.forEach(d => { map[d.id] = d.data(); });
    customEmojis = map;
    renderEmojiPickerGrids();
    if (!$('admin-panel-modal').classList.contains('hidden')) renderAdminEmojiList();
  });
}
function renderMessageText(rawText) {
  const safe = esc(rawText);
  const withEmoji = safe.replace(/:([a-z0-9_]+):/gi, (whole, name) => {
    const key = name.toLowerCase();
    if (customEmojis[key]) return `<img class="custom-emoji" src="${customEmojis[key].dataUrl}" alt=":${esc(key)}:" title=":${esc(key)}:">`;
    if (SHORTCODE_MAP[key]) return `<span class="native-emoji">${SHORTCODE_MAP[key]}</span>`;
    return whole;
  });
  // @mentions only "glow" when that user is actually in the current
  // server/DM/group — otherwise it renders as a plain, dim mention.
  const contextMembers = currentContextUsernames();
  return withEmoji.replace(/(^|[\s(>])@([A-Za-z0-9_]{3,24})\b/g, (whole, lead, name) => {
    const inContext = contextMembers.includes(name);
    const cls = 'mention-pill' + (inContext ? ' mention-glow' : '') + (inContext && name === myUid ? ' mention-self' : '');
    return `${lead}<span class="${cls}">@${esc(name)}</span>`;
  });
}

// ---------- message filter ----------
// Bypass-resistant: matches leetspeak substitutions, repeated letters, and
// letters split up with punctuation/spaces — but only as a WHOLE word, so it
// won't flag normal words that merely contain a filtered word as a substring
// (e.g. filtering "ass" will not touch "class" or "assist").
const LEET_CLASSES = { a: 'a4@', b: 'b8', e: 'e3', g: 'g9', i: 'i1!|', l: 'l1', o: 'o0', s: 's5$', t: 't7', z: 'z2' };
let filteredWords = [];
function subscribeMessageFilter() {
  db.collection('config').doc('filter').onSnapshot(snap => {
    filteredWords = (snap.exists && Array.isArray(snap.data().words)) ? snap.data().words : [];
    if (!$('admin-panel-modal').classList.contains('hidden')) renderAdminFilterList();
  });
}
function buildFilterRegex(word) {
  const chars = word.toLowerCase().split('').filter(c => /[a-z0-9]/.test(c));
  if (!chars.length) return null;
  const parts = chars.map(c => (LEET_CLASSES[c] ? `[${LEET_CLASSES[c]}]` : c) + '+');
  const body = parts.join('[^a-z0-9]*');
  try { return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'gi'); } catch (e) { return null; }
}
function applyMessageFilter(text) {
  let out = text;
  for (const w of filteredWords) {
    const re = buildFilterRegex(w);
    if (re) out = out.replace(re, '[CENSORED]');
  }
  return out;
}

// ---------- state ----------
let myUid = null;          // holds the current username
let myProfile = null;
let isAdmin = false;
let profileCache = {};
let currentServerId = null;
let currentServerData = null;
let currentChannelId = null;
let currentDMId = null;
let currentDMOtherUid = null;
let currentGroupDMId = null;
let currentView = 'none';    // 'none' | 'channel' | 'dm' | 'groupdm' | 'friends' | 'quests' | 'codes'
let lastRawMessages = [];
let lastChannelsList = [];
// Member list panel: open by default in channels/group DMs (except on mobile,
// where it's a full-screen overlay instead of a 4th column) until the user
// manually toggles it — then their choice sticks for the rest of the session.
let memberListManualOverride = null;

let unsub = { servers: null, channels: null, categories: null, messages: null, dms: null, groupDms: null, self: null };

// ============================================================
// CONVERSATION MESSAGE CACHE
// Closing a DM/channel used to tear down its message listener entirely,
// so reopening it — even seconds later — meant a brand new subscription
// and a "reload" flash. Instead, every conversation's listener keeps
// running in the background for as long as the app stays open: switching
// back to one just shows whatever's already been received, with nothing
// to wait on. Uncapped by request — nothing here evicts, so a long
// session that opens a lot of conversations holds all of their message
// history in memory at once for the rest of that session (cleared on
// logout, or when the tab/app closes).
// ============================================================
let msgConvCache = new Map(); // convKey -> { unsub, msgs }
let currentConvKey = null;
function convCacheTouch(key) {
  const entry = msgConvCache.get(key);
  if (entry) { msgConvCache.delete(key); msgConvCache.set(key, entry); } // keep most-recently-used ordering, even though nothing currently evicts on it
  return entry;
}
// Makes `key` (backed by Firestore collection ref `ref`) the active
// conversation. If we were here recently, its listener never actually
// stopped — this just renders what it already has, instantly. Otherwise
// it subscribes fresh, same as before.
function openConversationMessages(key, ref) {
  currentConvKey = key;
  const existing = convCacheTouch(key);
  if (existing) {
    cancelMsgLoading();
    onMessagesUpdate(existing.msgs);
    return;
  }
  const entry = { unsub: null, msgs: [] };
  msgConvCache.set(key, entry);
  entry.unsub = ref.orderBy('createdAt', 'asc').onSnapshot({ includeMetadataChanges: true }, snap => {
    const msgs = [];
    snap.forEach(d => msgs.push({ id: d.id, ...d.data(), pendingWrite: d.metadata.hasPendingWrites }));
    entry.msgs = msgs;
    if (currentConvKey === key) onMessagesUpdate(msgs);
  }, err => console.error(err));
}
function closeAllConversationListeners() {
  msgConvCache.forEach(entry => { if (entry.unsub) entry.unsub(); });
  msgConvCache.clear();
  currentConvKey = null;
}

// ---------- helpers ----------
function $(id) { return document.getElementById(id); }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function initials(name) { return name ? name.trim().charAt(0).toUpperCase() : '?'; }
function serverInitials(name) {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
function genCode(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function sanitizeChannelName(s) {
  return s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '').slice(0, 30) || 'new-channel';
}
function dmIdFor(a, b) { return [a, b].sort().join('_'); }
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  $('toast-stack').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
function avatarHTML(size, color, letter, status, avatarUrl) {
  let maskStyle = '';
  let dotHTML = '';
  if (status) {
    // Discord-style status indicator: a real cutout via CSS mask instead of a
    // border colored to guess whatever's behind the avatar. That guess was
    // wrong on half the screens in the app (avatars sit on several different
    // background colors), so the ring never quite matched. A mask always
    // looks right because it just reveals whatever is truly there.
    // The mask goes on the <img> itself (not the wrapping div) so the dot,
    // a sibling of the img, doesn't get cut away by its own parent's mask.
    const dotD = Math.max(9, Math.round(size * 0.315));
    const holeR = Math.round(dotD / 2 + Math.max(2, Math.round(size * 0.07)));
    const center = Math.round(dotD / 2 + Math.max(1, Math.round(size * 0.02)));
    const dotOffset = center - dotD / 2;
    const grad = `radial-gradient(circle ${holeR}px at calc(100% - ${center}px) calc(100% - ${center}px), transparent ${holeR - 1}px, #000 ${holeR}px)`;
    maskStyle = `-webkit-mask-image:${grad};mask-image:${grad};`;
    dotHTML = `<span class="status-dot ${status}" style="width:${dotD}px;height:${dotD}px;right:${dotOffset}px;bottom:${dotOffset}px;"></span>`;
  }
  const inner = `<img src="${esc(avatarUrl || DEFAULT_AVATAR_URL)}" alt="" loading="lazy" style="${maskStyle}">`;
  return `<div class="avatar has-image" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.42)}px;background:transparent">${inner}${dotHTML}</div>`;
}
function premiumStar(profile) { return isPremium(profile) ? icon('star', 'premium-star') : ''; }
function opTag(profile) { return profile && profile.op ? '<span class="op-tag">Admin</span>' : ''; }
function appTag(profile) { return profile && profile.bot ? `<span class="app-tag">${icon('check')}APP</span>` : ''; }
function ownerCrown(uid, ownerId) { return uid === ownerId ? `<span class="i owner-crown" title="Owner">${ICONS.crown}</span>` : ''; }
function timeStr(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function dayStr(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getProfile(uid) {
  if (uid === SAPPHIRE_UID) { profileCache[uid] = SAPPHIRE_PROFILE; return SAPPHIRE_PROFILE; }
  if (profileCache[uid]) return profileCache[uid];
  try {
    const snap = await db.collection('users').doc(uid).get();
    const data = snap.exists ? snap.data() : { username: uid, avatarColor: '#5865f2', status: 'offline', premiumUntil: null };
    profileCache[uid] = data;
    return data;
  } catch (e) {
    return { username: uid, avatarColor: '#5865f2', status: 'offline', premiumUntil: null };
  }
}

// ============================================================
// PRESENCE (Realtime Database) — fully automatic now: online means
// actually connected, idle means connected but the tab isn't visible
// (see the visibilitychange listener below), offline means
// disconnected. There's no manual status anymore. Falls back to
// showing everyone as online if Realtime Database isn't enabled on
// this Firebase project (rtdb stays null — see top of file).
// ============================================================
let presenceCache = {};       // uid -> true (connected) | false (disconnected)
let idleCache = {};           // uid -> true (tab hidden) | false (tab visible)
let presenceListeners = {};   // uid -> RTDB ref+callback, so we only subscribe once per uid
function initPresence() {
  if (!rtdb || !myUid) return;
  try {
    const myRef = rtdb.ref('presence/' + myUid);
    rtdb.ref('.info/connected').on('value', (snap) => {
      if (snap.val() === true) {
        myRef.onDisconnect().set({ online: false, idle: false, lastChanged: firebase.database.ServerValue.TIMESTAMP })
          .then(() => myRef.set({ online: true, idle: document.hidden, lastChanged: firebase.database.ServerValue.TIMESTAMP }));
      }
    });
  } catch (e) { console.warn('Presence init failed', e); }
}
// Whenever the tab is backgrounded or restored, tell everyone else —
// this is what makes idle show up for other people, not just you.
document.addEventListener('visibilitychange', () => {
  if (!rtdb || !myUid) return;
  try { rtdb.ref('presence/' + myUid).update({ idle: document.hidden, lastChanged: firebase.database.ServerValue.TIMESTAMP }); } catch (e) {}
});
function teardownPresence() {
  if (!rtdb || !myUid) return;
  try { rtdb.ref('presence/' + myUid).set({ online: false, idle: false, lastChanged: firebase.database.ServerValue.TIMESTAMP }); } catch (e) {}
  Object.values(presenceListeners).forEach(l => { try { l.ref.off('value', l.cb); } catch (e) {} });
  presenceListeners = {};
  presenceCache = {};
  idleCache = {};
}
function subscribePresence(uid) {
  if (!rtdb || presenceListeners[uid]) return;
  try {
    const ref = rtdb.ref('presence/' + uid);
    const cb = (snap) => {
      const val = snap.val();
      presenceCache[uid] = !!(val && val.online);
      idleCache[uid] = !!(val && val.idle);
      renderCurrentView();
      renderDMRows();
      renderSelfPanel();
      if (currentView === 'friends') renderFriendsView();
    };
    ref.on('value', cb);
    presenceListeners[uid] = { ref, cb };
  } catch (e) {}
}
// online/idle/offline, purely from real connection + tab-visibility state.
function computeDisplayStatus(uid) {
  if (!rtdb) return 'online';
  if (presenceCache[uid] === undefined) { subscribePresence(uid); return 'offline'; }
  if (presenceCache[uid] === false) return 'offline';
  return idleCache[uid] ? 'idle' : 'online';
}

// ---------- modal wiring ----------
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => closeModal(el.dataset.close)));
document.querySelectorAll('[data-back]').forEach(el => {
  el.addEventListener('click', () => {
    const overlay = el.closest('.modal-overlay');
    if (overlay) overlay.classList.add('hidden');
    openModal(el.dataset.back);
  });
});
document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.add('hidden'); });
});

// ============================================================
// TITLE BAR (desktop-app style window chrome)
// ============================================================
function togglePopover(id) {
  const other = id === 'inbox-popover' ? 'help-popover' : 'inbox-popover';
  $(other).classList.add('hidden');
  $(id).classList.toggle('hidden');
}
$('tb-inbox-btn').onclick = (e) => { e.stopPropagation(); togglePopover('inbox-popover'); };
$('tb-help-btn').onclick = (e) => { e.stopPropagation(); togglePopover('help-popover'); };
document.addEventListener('click', (e) => {
  if (!$('inbox-popover').contains(e.target) && !e.target.closest('#tb-inbox-btn')) $('inbox-popover').classList.add('hidden');
  if (!$('help-popover').contains(e.target) && !e.target.closest('#tb-help-btn')) $('help-popover').classList.add('hidden');
});
$('tb-min-btn').onclick = () => toast('Minimize Frixion using your browser or OS window controls.');
$('tb-max-btn').onclick = () => {
  if (!document.fullscreenElement) {
    (document.documentElement.requestFullscreen ? document.documentElement.requestFullscreen() : Promise.reject())
      .catch(() => toast('Fullscreen is not available here.'));
  } else {
    document.exitFullscreen();
  }
};
document.addEventListener('fullscreenchange', () => {
  const restoreIcon = '<svg viewBox="0 0 10 10" width="10" height="10"><rect x="1.5" y="2.5" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M3 2.5V1.5h5.5V7H7.5" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
  const maxIcon = '<svg viewBox="0 0 10 10" width="10" height="10"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
  $('tb-max-btn').innerHTML = document.fullscreenElement ? restoreIcon : maxIcon;
  $('tb-max-btn').title = document.fullscreenElement ? 'Restore Down' : 'Maximize';
});
$('tb-close-btn').onclick = () => {
  try { window.close(); } catch (e) {}
  setTimeout(() => toast("Browsers don't let a page close its own tab — close it manually."), 50);
};
$('rail-explore').onclick = () => { openModal('explore-servers-modal'); loadExploreServers(); };

async function loadExploreServers() {
  const wrap = $('explore-server-list');
  wrap.innerHTML = `<div class="explore-loading">Loading servers…</div>`;
  try {
    const snap = await db.collection('servers').get();
    const servers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderExploreServers(servers);
  } catch (e) {
    wrap.innerHTML = `<div class="explore-loading">Couldn't load servers right now.</div>`;
  }
}

function renderExploreServers(servers) {
  const wrap = $('explore-server-list');
  wrap.innerHTML = '';
  if (!servers.length) {
    wrap.innerHTML = `<div class="explore-empty">No servers exist yet — create one to get things started.</div>`;
    return;
  }
  servers
    .slice()
    .sort((a, b) => (b.members || []).length - (a.members || []).length || (a.name || '').localeCompare(b.name || ''))
    .forEach(s => {
      const memberCount = (s.members || []).length;
      const joined = (s.members || []).includes(myUid);
      const row = document.createElement('div');
      row.className = 'explore-server-row';
      row.innerHTML = `
        <div class="rail-item explore-server-icon">${esc(serverInitials(s.name))}</div>
        <div class="explore-server-info">
          <div class="explore-server-name">${esc(s.name || 'Unnamed server')}</div>
          <div class="explore-server-meta">${memberCount} member${memberCount === 1 ? '' : 's'}</div>
        </div>
        <button type="button" class="btn-secondary slim explore-server-join${joined ? ' joined' : ''}">${joined ? 'Open' : 'Join'}</button>
      `;
      row.querySelector('.explore-server-join').onclick = () => joinExploreServer(s, joined);
      wrap.appendChild(row);
    });
}

async function joinExploreServer(server, alreadyJoined) {
  try {
    let s = server;
    if (!alreadyJoined) {
      await db.collection('servers').doc(server.id).update({ members: FieldValue.arrayUnion(myUid) });
      db.collection('users').doc(myUid).update({ 'stats.serversCount': FieldValue.increment(1) }).catch(() => {});
      s = { ...server, members: [...(server.members || []), myUid] };
      toast(`Joined ${s.name}.`);
    }
    closeModal('explore-servers-modal');
    selectServer(s);
  } catch (e) { toast(e.message || 'Could not join that server.', 'error'); }
}

// ============================================================
// SESSION
// ============================================================
function getSession() { return localStorage.getItem(SESSION_KEY); }
function setSession(u) { u ? localStorage.setItem(SESSION_KEY, u) : localStorage.removeItem(SESSION_KEY); }

function banStatus(profile) {
  if (!profile || !profile.banned) return { banned: false };
  if (profile.bannedUntil && profile.bannedUntil <= Date.now()) return { banned: false, expired: true };
  return { banned: true, reason: profile.banReason || 'No reason given', until: profile.bannedUntil };
}

// Backfills fields added in later updates onto accounts created earlier, so old accounts never crash on missing data.
function defaultProfileFields(existing) {
  return {
    orbs: STARTING_ORBS,
    stats: { messagesSent: 0, reactionsGiven: 0, dmsStarted: 0, serversCount: 0 },
    questsDate: todayStr(),
    dailyStats: { messagesSent: 0, reactionsGiven: 0, dmsMessaged: 0, channelsMessaged: 0 },
    claimedQuestsToday: [],
    bio: '', pronouns: '', bannerColor: (existing && existing.avatarColor) || '#5865f2',
    friends: [], incomingRequests: [], outgoingRequests: [],
    theme: 'dark',
  };
}
async function normalizeProfile(username, data) {
  const defaults = defaultProfileFields(data);
  const patch = {};
  for (const k of Object.keys(defaults)) {
    if (data[k] === undefined) patch[k] = defaults[k];
  }
  if (Object.keys(patch).length) {
    try { await db.collection('users').doc(username).set(patch, { merge: true }); } catch (e) {}
    Object.assign(data, patch);
  }
  return data;
}

async function boot() {
  const saved = getSession();
  if (!saved) { showAuthScreen(); return; }
  const snap = await db.collection('users').doc(saved).get();
  if (!snap.exists) { setSession(null); showAuthScreen(); return; }
  const data = snap.data();
  const ban = banStatus(data);
  if (ban.banned) { setSession(null); showAuthScreen(); $('login-error').textContent = `You're banned: ${ban.reason}`; return; }
  await normalizeProfile(saved, data);
  myUid = saved;
  myProfile = data;
  profileCache[myUid] = data;
  enterApp();
}

function showAuthScreen() {
  $('boot-screen').classList.add('hidden');
  $('auth-screen').classList.remove('hidden');
  $('app').classList.add('hidden');
  $('login-view').classList.remove('hidden');
  $('register-view').classList.add('hidden');
}

function enterApp() {
  $('boot-screen').classList.add('hidden');
  $('auth-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  isAdmin = !!(myProfile && myProfile.op);
  initAppForUser();
}

// ============================================================
// AUTH
// ============================================================
$('show-register').onclick = () => { $('login-view').classList.add('hidden'); $('register-view').classList.remove('hidden'); };
$('show-login').onclick = () => { $('register-view').classList.add('hidden'); $('login-view').classList.remove('hidden'); };

$('login-btn').onclick = async () => {
  const username = $('login-username').value.trim();
  const pass = $('login-password').value;
  $('login-error').textContent = '';
  if (!username || !pass) { $('login-error').textContent = 'Please fill in both fields.'; return; }
  $('login-btn').disabled = true; $('login-btn').textContent = 'Checking...';
  try {
    const snap = await db.collection('users').doc(username).get();
    if (!snap.exists || snap.data().password !== pass) {
      $('login-error').textContent = 'Incorrect username or password.';
      $('login-btn').disabled = false; $('login-btn').textContent = 'Log In'; return;
    }
    const data = snap.data();
    const ban = banStatus(data);
    if (ban.banned) {
      const until = ban.until ? new Date(ban.until).toLocaleString() : 'further notice';
      $('login-error').textContent = `You're banned until ${until}. Reason: ${ban.reason}`;
      $('login-btn').disabled = false; $('login-btn').textContent = 'Log In'; return;
    }
    if (ban.expired) { await db.collection('users').doc(username).update({ banned: false, banReason: '', bannedUntil: null }); data.banned = false; }
    await normalizeProfile(username, data);
    myUid = username; myProfile = data; profileCache[myUid] = data;
    setSession(username);
    enterApp();
  } catch (e) {
    $('login-error').textContent = e.message || 'Something went wrong.';
  }
  $('login-btn').disabled = false; $('login-btn').textContent = 'Log In';
};

$('register-btn').onclick = async () => {
  const username = $('reg-username').value.trim();
  const pass = $('reg-password').value;
  $('register-error').textContent = '';
  if (!username || !pass) { $('register-error').textContent = 'Please fill in both fields.'; return; }
  if (username.length < 3) { $('register-error').textContent = 'Username must be at least 3 characters.'; return; }
  if (!/^[A-Za-z0-9_]+$/.test(username)) { $('register-error').textContent = 'Letters, numbers, and underscores only.'; return; }
  if (pass.length < 4) { $('register-error').textContent = 'Password must be at least 4 characters.'; return; }
  // A real account's uid is its exact username (see below — myUid =
  // username), and Sapphire's messages/profile are hardcoded to the uid
  // 'sapphire' (see SAPPHIRE_UID / getProfile). Nothing stops "sapphire"
  // from otherwise passing every check above and colliding with that,
  // silently taking over the bot's identity everywhere in the app — so
  // it's blocked here the same way a reserved system name would be on
  // any platform. Checked case-insensitively since "Sapphire" or
  // "SAPPHIRE" wouldn't collide technically (Firestore doc ids are
  // case-sensitive) but would still be a confusing impersonation of the
  // bot's actual display name.
  if (RESERVED_USERNAMES.includes(username.toLowerCase())) {
    $('register-error').textContent = 'That name is reserved.';
    return;
  }
  $('register-btn').disabled = true; $('register-btn').textContent = 'Creating...';
  try {
    const existing = await db.collection('users').doc(username).get();
    if (existing.exists) {
      $('register-error').textContent = 'That username is already taken.';
      $('register-btn').disabled = false; $('register-btn').textContent = 'Continue'; return;
    }
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const data = {
      username, password: pass, avatarColor: color, status: 'online',
      premiumUntil: null, theme: 'dark', op: false,
      orbs: STARTING_ORBS,
      stats: { messagesSent: 0, reactionsGiven: 0, dmsStarted: 0, serversCount: 0 },
      questsDate: todayStr(),
      dailyStats: { messagesSent: 0, reactionsGiven: 0, dmsMessaged: 0, channelsMessaged: 0 },
      claimedQuestsToday: [],
      bio: '', pronouns: '', bannerColor: color,
      friends: [], incomingRequests: [], outgoingRequests: [],
      banned: false, banReason: '', bannedUntil: null,
      createdAt: FieldValue.serverTimestamp(),
    };
    await db.collection('users').doc(username).set(data);
    myUid = username; myProfile = data; profileCache[myUid] = data;
    setSession(username);
    enterApp();
  } catch (e) {
    $('register-error').textContent = e.message || 'Something went wrong.';
  }
  $('register-btn').disabled = false; $('register-btn').textContent = 'Continue';
};

$('logout-btn').onclick = async () => {
  teardownPresence();
  try { if (myUid) await db.collection('users').doc(myUid).update({ status: 'offline' }); } catch (e) {}
  cleanupAllListeners();
  setSession(null);
  myUid = null; myProfile = null; profileCache = {}; isAdmin = false;
  currentServerId = null; currentServerData = null; currentChannelId = null;
  currentDMId = null; currentDMOtherUid = null; currentView = 'none';
  document.body.className = '';
  closeModal('settings-modal');
  showAuthScreen();
};

function cleanupAllListeners() {
  if (unsub.servers) unsub.servers();
  if (unsub.channels) unsub.channels();
  if (unsub.categories) unsub.categories();
  if (unsub.messages) unsub.messages();
  if (unsub.dms) unsub.dms();
  if (unsub.groupDms) unsub.groupDms();
  if (unsub.self) unsub.self();
  unsub = { servers: null, channels: null, categories: null, messages: null, dms: null, groupDms: null, self: null };
  closeAllConversationListeners();
}

// ============================================================
// APP INIT
// ============================================================
function initAppForUser() {
  initPresence();
  unsub.self = db.collection('users').doc(myUid).onSnapshot(snap => {
    if (!snap.exists) return;
    myProfile = snap.data();
    profileCache[myUid] = myProfile;
    isAdmin = !!myProfile.op;
    applyTheme(myProfile.theme || 'default');
    applyCustomKeyboardSetting();
    applyComposerCharLimit();
    renderSelfPanel();
    updateFriendReqBadge();
    if (!$('settings-modal').classList.contains('hidden')) populateSettings();
    if (currentView === 'friends') renderFriendsView();
    if (currentView === 'quests') renderQuests();
    renderCurrentView();
  });

  unsub.servers = db.collection('servers').where('members', 'array-contains', myUid).onSnapshot(snap => {
    const servers = [];
    snap.forEach(d => servers.push({ id: d.id, ...d.data() }));
    renderServerRail(servers);
    if (currentServerId) {
      const cur = servers.find(s => s.id === currentServerId);
      if (cur) currentServerData = cur;
    }
  }, err => console.error(err));

  subscribeDMList();
  subscribeCustomEmojis();
  subscribeMessageFilter();
  subscribeStickers();
  showHomeView();
}

let systemThemeListenerAdded = false;
function applyTheme(themeKey) {
  const key = THEMES.some(theme => theme.key === themeKey) ? themeKey : 'dark';
  document.body.classList.remove('theme-light', 'theme-ash', 'theme-onyx');
  document.body.dataset.theme = key;
  if (key === 'sync') {
    const wantsLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    if (wantsLight) document.body.classList.add('theme-light');
    document.documentElement.style.colorScheme = wantsLight ? 'light' : 'dark';
    if (!systemThemeListenerAdded && window.matchMedia) {
      systemThemeListenerAdded = true;
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (myProfile && myProfile.theme === 'sync') applyTheme('sync');
      });
    }
    return;
  }
  document.documentElement.style.colorScheme = key === 'light' ? 'light' : 'dark';
  if (key !== 'dark') document.body.classList.add('theme-' + key);
}

function renderSelfPanel() {
  if (!myProfile) return;
  const inner = avatarHTML(32, myProfile.avatarColor, initials(myProfile.username), computeDisplayStatus(myUid), myProfile.avatarUrl);
  $('self-avatar').outerHTML = inner.replace('class="avatar', 'id="self-avatar" class="avatar');
  $('self-username').innerHTML = esc(myProfile.username) + premiumStar(myProfile) + opTag(myProfile);
  const st = STATUSES.find(s => s.key === computeDisplayStatus(myUid));
  $('self-status-label').textContent = st ? st.label : 'Online';
}

// ============================================================
// SERVER RAIL
// ============================================================
function renderServerRail(servers) {
  const list = $('server-rail-list');
  list.innerHTML = '';
  servers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  servers.forEach(s => {
    const el = document.createElement('div');
    el.className = 'rail-item' + (currentServerId === s.id ? ' active' : '');
    el.title = s.name;
    el.dataset.id = s.id;
    el.textContent = serverInitials(s.name);
    el.onclick = () => selectServer(s);
    list.appendChild(el);
  });
}

$('rail-home').onclick = () => showHomeView();
$('rail-add-server').onclick = () => openModal('server-choice-modal');

$('choice-create').onclick = () => { closeModal('server-choice-modal'); openModal('create-server-modal'); };
$('choice-join').onclick = () => { closeModal('server-choice-modal'); openModal('join-server-modal'); };

$('confirm-create-server').onclick = async () => {
  const name = $('new-server-name').value.trim();
  $('create-server-error').textContent = '';
  if (!name) { $('create-server-error').textContent = 'Please enter a server name.'; return; }
  try {
    const ref = await db.collection('servers').add({
      name, ownerId: myUid, members: [myUid], inviteCode: genCode(), createdAt: FieldValue.serverTimestamp(),
    });
    await ref.collection('channels').add({ name: 'general', categoryId: null, autoDelete: true, createdAt: FieldValue.serverTimestamp() });
    $('new-server-name').value = '';
    closeModal('create-server-modal');
    toast('Server created.');
    db.collection('users').doc(myUid).update({ 'stats.serversCount': FieldValue.increment(1) }).catch(() => {});
  } catch (e) { $('create-server-error').textContent = e.message; }
};

$('confirm-join-server').onclick = async () => {
  const code = $('join-server-code').value.trim().toLowerCase();
  $('join-server-error').textContent = '';
  if (!code) { $('join-server-error').textContent = 'Please enter an invite code.'; return; }
  try {
    const q = await db.collection('servers').where('inviteCode', '==', code).limit(1).get();
    if (q.empty) { $('join-server-error').textContent = 'Invalid invite code.'; return; }
    const doc = q.docs[0];
    if (!(doc.data().members || []).includes(myUid)) {
      await doc.ref.update({ members: FieldValue.arrayUnion(myUid) });
      db.collection('users').doc(myUid).update({ 'stats.serversCount': FieldValue.increment(1) }).catch(() => {});
    }
    $('join-server-code').value = '';
    closeModal('join-server-modal');
    selectServer({ id: doc.id, ...doc.data() });
    toast('Joined server.');
  } catch (e) { $('join-server-error').textContent = e.message; }
};

// ============================================================
// MOBILE (phone-width) LAYOUT
// A phone screen shows one pane at a time: the server rail is always
// visible; the channel/DM list and the chat area slide in and out via
// a class on #app, driven by whichever navigation function is active.
// ============================================================
// Keep this in sync with the phone-layout breakpoint in style.css: short
// side of the screen (whichever axis rotation makes narrow) under 600px,
// scoped to touch devices so it doesn't also catch a small desktop window.
function isMobile() {
  return window.matchMedia(
    '(hover: none) and (pointer: coarse) and (max-width: 600px), ' +
    '(hover: none) and (pointer: coarse) and (max-height: 600px)'
  ).matches;
}
// Touch device of ANY size — phone or tablet (iPad included). Used only
// for the on-screen-keyboard docking fix below, which a tablet needs just
// as much as a phone does. isMobile() above stays phone-only on purpose:
// an iPad should still get the roomy desktop-style layout (grid columns,
// title bar, etc.), just with the keyboard handled correctly.
function isTouchDevice() {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}
function setMobilePane(pane) {
  $('app').classList.toggle('mobile-show-chat', pane === 'chat');
}
// Applied whenever a channel or group DM is opened. Respects a manual
// toggle made earlier this session; otherwise defaults to open, but never
// auto-opens on mobile (there it's a full-screen overlay, not a column).
function applyDefaultMemberListState() {
  const open = memberListManualOverride !== null ? memberListManualOverride : !isMobile();
  $('app').classList.toggle('member-list-open', open);
}
$('back-to-list-btn').onclick = () => setMobilePane('list');

// On iOS and some Android webviews, the layout viewport keeps its original
// height while the software keyboard overlays the page. Use the visual
// viewport when it is available so the flex layout ends at the keyboard.
//
// That alone isn't quite enough on iOS: focusing a field pans the visual
// viewport up rather than resizing the layout viewport in place, so even
// with the height corrected, the page can still be scrolled such that the
// bottom of our now-shorter layout sits above the keyboard instead of
// right on top of it — a gap the size of that pan. Shifting #app up by
// visualViewport.offsetTop cancels that out so the composer actually
// docks against the keyboard instead of floating above it. This runs for
// any touch device (phone or tablet), not just phones, so an iPad's
// keyboard docks the same way — it just keeps its own desktop-style
// layout otherwise, since isMobile() (unlike isTouchDevice()) is unchanged.
//
// Cross-browser notes, since this API is handled a bit differently
// everywhere:
// - iOS: every browser (Safari, Chrome, Firefox, Edge, in-app browsers)
//   is required by Apple to use Safari's WebKit engine under the hood, so
//   whatever works in Safari here works identically in all of them.
// - Android Chrome/Edge/Samsung Internet (Chromium): the
//   interactive-widget=resizes-content viewport meta tag in index.html
//   asks the browser to resize the actual layout viewport for the
//   keyboard, which — where it's honored — makes visualViewport.height
//   equal window.innerHeight and offsetTop naturally 0, so the code below
//   just becomes a no-op confirming what the browser already did right.
// - Android Firefox and anything else without visualViewport support:
//   falls back to window.innerHeight, which has reflected the on-screen
//   keyboard via the resize event since long before visualViewport
//   existed, so height-tracking still works even if the offsetTop
//   compensation (an iOS-specific quirk) never applies.
function syncMobileViewport() {
  const root = document.documentElement;
  const appEl = $('app');
  if (!isTouchDevice()) {
    root.style.removeProperty('--mobile-viewport-height');
    if (appEl) appEl.style.transform = '';
    return;
  }
  const vv = window.visualViewport;
  const visibleHeight = vv ? vv.height : window.innerHeight;
  root.style.setProperty('--mobile-viewport-height', `${Math.round(visibleHeight)}px`);
  if (appEl) appEl.style.transform = (vv && vv.offsetTop) ? `translateY(${vv.offsetTop}px)` : '';
}
window.addEventListener('resize', syncMobileViewport);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncMobileViewport);
  window.visualViewport.addEventListener('scroll', syncMobileViewport);
}
// Belt-and-suspenders for browsers/webviews that fire the events above
// late, or not at all, relative to the keyboard's own show/hide animation:
// re-check shortly after any text field gains or loses focus too. Two
// delays cover both a fast keyboard and a slower ~250-300ms animation.
document.addEventListener('focusin', (e) => {
  if (e.target.matches && e.target.matches('input, textarea')) {
    setTimeout(syncMobileViewport, 60);
    setTimeout(syncMobileViewport, 350);
  }
});
document.addEventListener('focusout', (e) => {
  if (e.target.matches && e.target.matches('input, textarea')) {
    setTimeout(syncMobileViewport, 60);
    setTimeout(syncMobileViewport, 350);
  }
});
syncMobileViewport();

// ---- block browser/OS zoom (pinch, ctrl+scroll, ctrl+plus/minus) ----
// The viewport meta tag + touch-action:pan-x pan-y in CSS handle most of
// this already; the listeners below catch the cases those two can't:
// trackpad/ctrl+wheel zoom and Safari's gesture events on desktop.
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });
['gesturestart', 'gesturechange', 'gestureend'].forEach((evt) => {
  document.addEventListener(evt, (e) => e.preventDefault());
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && ['=', '+', '-', '_', '0'].includes(e.key)) {
    e.preventDefault();
  }
});

// ---- swipe to open/close, DMs only (not servers) ----
// Right = close the open DM (back to the list). Left = reopen whatever
// DM/group/tab you last had open. Dragging follows your finger in real
// time; the CSS transition only takes back over once you lift your
// finger, same trick used for the tap-driven pane switches above.
(function setupDMSwipe() {
  const zone = $('page-body');
  let tracking = false, dragging = false, startX = 0, startY = 0, dx = 0;

  function eligible() {
    return isMobile() && !currentServerId && currentView !== 'none';
  }

  zone.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || !eligible()) { tracking = false; return; }
    if (e.target.closest('.modal-overlay:not(.hidden)') || e.target.closest('textarea, input')) { tracking = false; return; }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
    dragging = false;
    dx = 0;
  }, { passive: true });

  zone.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const x = e.touches[0].clientX, y = e.touches[0].clientY;
    dx = x - startX;
    const dy = y - startY;
    if (!dragging) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      if (Math.abs(dy) > Math.abs(dx)) { tracking = false; return; }
      dragging = true;
      $('app').classList.add('mobile-dragging');
    }
    const list = $('side-panel'), chat = $('main-col');
    const width = window.innerWidth;
    const showingChat = $('app').classList.contains('mobile-show-chat');
    if (showingChat) {
      const t = Math.max(0, Math.min(dx, width));
      chat.style.transform = `translateX(${t}px)`;
      list.style.transform = `translateX(${t - width}px)`;
    } else {
      const t = Math.min(0, Math.max(dx, -width));
      list.style.transform = `translateX(${t}px)`;
      chat.style.transform = `translateX(${t + width}px)`;
    }
    e.preventDefault();
  }, { passive: false });

  zone.addEventListener('touchend', () => {
    if (!dragging) { tracking = false; return; }
    tracking = false; dragging = false;
    const width = window.innerWidth;
    const showingChat = $('app').classList.contains('mobile-show-chat');
    const toChat = showingChat ? !(dx > width * 0.28) : (dx < -width * 0.28);
    $('app').classList.remove('mobile-dragging');
    requestAnimationFrame(() => {
      $('side-panel').style.transform = '';
      $('main-col').style.transform = '';
      setMobilePane(toChat ? 'chat' : 'list');
    });
  });
  zone.addEventListener('touchcancel', () => {
    if (!dragging) { tracking = false; return; }
    tracking = false; dragging = false;
    $('app').classList.remove('mobile-dragging');
    requestAnimationFrame(() => {
      $('side-panel').style.transform = '';
      $('main-col').style.transform = '';
    });
  });
})();

// ============================================================
// HOME VIEW (DMs)
// ============================================================
function hideMainPageViews() {
  $('friends-view').classList.add('hidden');
  $('quests-view').classList.add('hidden');
  $('codes-view').classList.add('hidden');
}

function showHomeView() {
  currentServerId = null; currentServerData = null; currentChannelId = null;
  currentView = 'none'; currentDMId = null; currentDMOtherUid = null; currentGroupDMId = null;
  if (unsub.channels) { unsub.channels(); unsub.channels = null; }
  if (unsub.categories) { unsub.categories(); unsub.categories = null; }
  // Deliberately NOT tearing down the message listener here — that's what
  // used to make reopening a DM feel like a fresh load every time you'd
  // stepped away from it. It keeps running in the cache (see
  // openConversationMessages); this just stops it from rendering into a
  // view that isn't showing a conversation anymore.
  currentConvKey = null;
  $('rail-home').classList.add('active');
  document.querySelectorAll('#server-rail-list .rail-item').forEach(e => e.classList.remove('active'));
  $('side-header-title').textContent = 'Direct Messages';
  $('dm-list').classList.remove('hidden');
  $('channel-list').classList.add('hidden');
  $('members-toggle').classList.add('hidden');
  $('app').classList.remove('member-list-open');
  hideHeaderActions();
  document.querySelectorAll('.home-nav-item').forEach(i => i.classList.remove('active'));
  document.querySelector('.home-nav-item[data-home-view="friends"]').classList.add('active');
  openHomeMainView('friends');
  setMobilePane('list');
  renderDMRows();
}

document.querySelectorAll('.home-nav-item').forEach(item => {
  item.onclick = () => {
    document.querySelectorAll('.home-nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    openHomeMainView(item.dataset.homeView);
  };
});

function openHomeMainView(which) {
  currentServerId = null; currentServerData = null; currentChannelId = null;
  currentDMId = null; currentDMOtherUid = null; currentGroupDMId = null;
  currentConvKey = null; // see the comment in showHomeView — listener stays alive, just stops rendering here
  $('welcome-view').classList.add('hidden');
  $('chat-view').classList.add('hidden');
  hideHeaderActions();
  hideMainPageViews();
  $('chat-header-hash').textContent = '';
  if (which === 'friends') { currentView = 'friends'; $('chat-header-title').textContent = 'Friends'; $('friends-view').classList.remove('hidden'); renderFriendsView(); }
  else if (which === 'quests') { currentView = 'quests'; $('chat-header-title').textContent = 'Quests'; $('quests-view').classList.remove('hidden'); renderQuests(); }
  else if (which === 'codes') { currentView = 'codes'; $('chat-header-title').textContent = 'Codes'; $('codes-view').classList.remove('hidden'); }
  setMobilePane('chat');
  renderDMRows();
}

function subscribeDMList() {
  if (unsub.dms) unsub.dms();
  unsub.dms = db.collection('dms').where('participants', 'array-contains', myUid).onSnapshot(async snap => {
    const dms = [];
    snap.forEach(d => dms.push({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
    window.__myDMs = dms;
    await Promise.all(dms.map(dm => getProfile(dm.participants.find(p => p !== myUid))));
    hydrateConversationPreviews('dms', dms);
    if (currentView !== 'channel') renderDMRows();
  });
  if (unsub.groupDms) unsub.groupDms();
  unsub.groupDms = db.collection('groupDMs').where('participants', 'array-contains', myUid).onSnapshot(async snap => {
    const gs = [];
    snap.forEach(d => gs.push({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
    window.__myGroupDMs = gs;
    await Promise.all(gs.flatMap(g => g.participants.filter(p => p !== myUid).map(p => getProfile(p))));
    hydrateConversationPreviews('groupDMs', gs);
    if (currentView !== 'channel') renderDMRows();
  });
}

function groupDMDisplayName(g) {
  if (g.name) return g.name;
  const others = humanParticipants(g.participants).filter(p => p !== myUid);
  return others.map(u => (profileCache[u] || { username: u }).username).join(', ') || 'Group';
}

function previewForMessage(message, includeAuthor = false) {
  if (!message) return 'No messages yet';
  if (typeof message === 'string') return message;
  let text = (message.text || '').trim();
  if (!text && message.attachments && message.attachments.length) {
    text = message.attachments.length > 1
      ? `Sent ${message.attachments.length} photos`
      : (message.attachments[0].type === 'image' ? 'Sent a photo' : `Sent ${message.attachments[0].name || 'a file'}`);
  }
  if (!text && message.attachment) text = message.attachment.type === 'image' ? 'Sent a photo' : `Sent ${message.attachment.name || 'a file'}`;
  if (!text && message.gifUrl) text = 'Sent a GIF';
  if (!text && message.sticker) text = `Sent a sticker${message.sticker.name ? `: ${message.sticker.name}` : ''}`;
  if (!text && message.poll) text = `📊 Poll: ${message.poll.question}`;
  if (!text && message.type === 'purge-confirm') text = `Deleted ${message.purgeCount} message${message.purgeCount === 1 ? '' : 's'}`;
  if (!text) text = 'New message';
  return includeAuthor && message.username ? `${message.username}: ${text}` : text;
}

function timeValue(timestamp) {
  if (!timestamp) return 0;
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
  if (timestamp instanceof Date) return timestamp.getTime();
  return typeof timestamp === 'number' ? timestamp : 0;
}

const conversationPreviewCache = new Map();
async function hydrateConversationPreviews(collection, conversations) {
  const missing = conversations.filter(conversation => !conversation.lastMessage && !conversationPreviewCache.has(`${collection}:${conversation.id}`));
  if (!missing.length) return;
  await Promise.all(missing.map(async conversation => {
    const key = `${collection}:${conversation.id}`;
    try {
      const snap = await db.collection(collection).doc(conversation.id).collection('messages')
        .orderBy('createdAt', 'desc').limit(1).get();
      conversationPreviewCache.set(key, snap.empty ? null : snap.docs[0].data());
    } catch (e) {
      conversationPreviewCache.set(key, null);
    }
  }));
  renderDMRows();
}

function renderDMRows() {
  const wrap = $('dm-rows');
  wrap.innerHTML = '';
  const dms = [...(window.__myDMs || [])].sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt));
  dms.forEach(dm => {
    const otherUid = dm.participants.find(p => p !== myUid);
    const p = profileCache[otherUid] || { username: '...', avatarColor: '#5865f2', status: 'offline' };
    const row = document.createElement('div');
    row.className = 'dm-row' + (currentDMId === dm.id ? ' active' : '');
    row.innerHTML = avatarHTML(32, p.avatarColor, initials(p.username), computeDisplayStatus(otherUid), p.avatarUrl) +
      `<div class="dm-copy"><span class="dm-name">${esc(p.username)}${premiumStar(p)}${opTag(p)}</span><span class="dm-preview">${esc(previewForMessage(dm.lastMessage || conversationPreviewCache.get(`dms:${dm.id}`)))}</span></div>`;
    row.onclick = () => selectDM(dm.id, otherUid);
    wrap.appendChild(row);
  });
  const groups = [...(window.__myGroupDMs || [])].sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt));
  groups.forEach(g => {
    const name = groupDMDisplayName(g);
    const row = document.createElement('div');
    row.className = 'dm-row' + (currentGroupDMId === g.id ? ' active' : '');
    row.innerHTML = `<div class="avatar group-avatar" style="width:32px;height:32px;">${icon('people')}</div><div class="dm-copy"><span class="dm-name">${esc(name)}</span><span class="dm-preview">${esc(previewForMessage(g.lastMessage || conversationPreviewCache.get(`groupDMs:${g.id}`), true))}</span></div>`;
    row.onclick = () => selectGroupDM(g.id);
    wrap.appendChild(row);
  });
}

$('dm-add-btn').onclick = () => { $('new-dm-username').value = ''; $('new-dm-error').textContent = ''; openModal('new-dm-modal'); };

async function startDMWith(uname) {
  if (uname === myUid) return;
  const snap = await db.collection('users').doc(uname).get();
  if (!snap.exists) { toast('No user found with that username.', 'error'); return; }
  profileCache[uname] = snap.data();
  const id = dmIdFor(myUid, uname);
  const ref = db.collection('dms').doc(id);
  const dsnap = await ref.get();
  if (!dsnap.exists) {
    await ref.set({ participants: [myUid, uname], autoDelete: true, createdAt: FieldValue.serverTimestamp() });
    db.collection('users').doc(myUid).update({ 'stats.dmsStarted': FieldValue.increment(1) }).catch(() => {});
  }
  selectDM(id, uname);
}

$('confirm-new-dm').onclick = async () => {
  const uname = $('new-dm-username').value.trim();
  $('new-dm-error').textContent = '';
  if (!uname) { $('new-dm-error').textContent = 'Enter a username.'; return; }
  if (uname === myProfile.username) { $('new-dm-error').textContent = "That's you!"; return; }
  try {
    await startDMWith(uname);
    closeModal('new-dm-modal');
  } catch (e) { $('new-dm-error').textContent = e.message; }
};

async function selectDM(id, otherUid) {
  clearReplyTarget();
  currentServerId = null; currentServerData = null; currentChannelId = null; currentGroupDMId = null;
  currentView = 'dm'; currentDMId = id; currentDMOtherUid = otherUid;
  document.querySelectorAll('#server-rail-list .rail-item').forEach(e => e.classList.remove('active'));
  $('rail-home').classList.add('active');
  $('members-toggle').classList.add('hidden');
  $('app').classList.remove('member-list-open');
  hideMainPageViews();
  const p = await getProfile(otherUid);
  $('chat-header-hash').textContent = '@';
  $('chat-header-title').textContent = p.username;
  $('composer-input').placeholder = `Message @${p.username}`;
  $('gift-btn').classList.remove('hidden');
  showHeaderActions();
  renderDMRows();
  showChat();
  setMobilePane('chat');
  scheduleMsgLoading();
  const dmDoc = (window.__myDMs || []).find(d => d.id === id);
  if (!dmDoc || dmDoc.autoDelete !== false) sweepOldMessages(db.collection('dms').doc(id).collection('messages'));
  openConversationMessages(`dm:${id}`, db.collection('dms').doc(id).collection('messages'));
}

async function selectGroupDM(id) {
  clearReplyTarget();
  currentServerId = null; currentServerData = null; currentChannelId = null;
  currentDMId = null; currentDMOtherUid = null;
  currentView = 'groupdm'; currentGroupDMId = id;
  document.querySelectorAll('#server-rail-list .rail-item').forEach(e => e.classList.remove('active'));
  $('rail-home').classList.add('active');
  hideMainPageViews();
  const g = (window.__myGroupDMs || []).find(x => x.id === id);
  const name = g ? groupDMDisplayName(g) : 'Group';
  $('chat-header-hash').textContent = '';
  $('chat-header-title').textContent = name;
  $('composer-input').placeholder = `Message ${name}`;
  $('gift-btn').classList.add('hidden');
  $('members-toggle').classList.remove('hidden');
  applyDefaultMemberListState();
  showHeaderActions();
  $('pins-toggle').classList.remove('hidden');
  renderMemberPanel(g ? humanParticipants(g.participants) : [], g ? g.ownerId : null);
  renderDMRows();
  showChat();
  setMobilePane('chat');
  scheduleMsgLoading();
  if (!g || g.autoDelete !== false) sweepOldMessages(db.collection('groupDMs').doc(id).collection('messages'));
  openConversationMessages(`groupdm:${id}`, db.collection('groupDMs').doc(id).collection('messages'));
}

let groupDmPickerSelection = [];
function renderFriendPicker(containerId, excludeUids) {
  const wrap = $(containerId);
  const friends = (myProfile.friends || []).filter(u => !excludeUids.includes(u));
  groupDmPickerSelection = [];
  if (!friends.length) { wrap.innerHTML = '<div class="empty">Add some friends first.</div>'; return; }
  wrap.innerHTML = friends.map(u => `<label class="friend-pick-row"><input type="checkbox" value="${esc(u)}"><span>${esc(u)}</span></label>`).join('');
}

$('dm-add-btn').addEventListener('contextmenu', (e) => e.preventDefault());

document.querySelectorAll('.home-nav-item').forEach(() => {}); // (nav wiring above)

$('new-group-dm-btn').onclick = () => {
  renderFriendPicker('group-dm-friend-picker', []);
  $('new-group-dm-name').value = '';
  openModal('new-group-dm-modal');
};
$('add-member-toggle').onclick = () => {
  if (!currentGroupDMId) return;
  const g = (window.__myGroupDMs || []).find(x => x.id === currentGroupDMId);
  renderFriendPicker('add-to-group-friend-picker', g ? humanParticipants(g.participants) : [myUid]);
  openModal('add-to-group-modal');
};

$('confirm-new-group-dm').onclick = async () => {
  const checks = [...$('group-dm-friend-picker').querySelectorAll('input:checked')].map(i => i.value);
  if (checks.length < 2) { toast('Pick at least 2 friends for a group.'); return; }
  const name = $('new-group-dm-name').value.trim();
  try {
    const participants = [myUid, ...checks, SAPPHIRE_UID];
    const ref = await db.collection('groupDMs').add({
      name: name || null, participants, ownerId: myUid, autoDelete: true, createdAt: FieldValue.serverTimestamp(),
    });
    closeModal('new-group-dm-modal');
    toast('Group created.');
    selectGroupDM(ref.id);
  } catch (e) { toast('Could not create group.', 'error'); }
};

$('confirm-add-to-group').onclick = async () => {
  const checks = [...$('add-to-group-friend-picker').querySelectorAll('input:checked')].map(i => i.value);
  if (!checks.length || !currentGroupDMId) { toast('Pick at least one friend.'); return; }
  try {
    await db.collection('groupDMs').doc(currentGroupDMId).update({ participants: FieldValue.arrayUnion(...checks) });
    closeModal('add-to-group-modal');
    toast('Added to group.');
  } catch (e) { toast('Could not add to group.', 'error'); }
};

// ============================================================
// PROFILES
// ============================================================
$('messages').addEventListener('click', (e) => {
  const hit = e.target.closest('.msg-meta .author') || e.target.closest('.msg-group > .avatar');
  const group = e.target.closest('.msg-group');
  if (hit && group && group.dataset.uid) openProfileModal(group.dataset.uid);
});
$('user-panel').addEventListener('click', (e) => {
  if (e.target.closest('#self-avatar')) { e.stopPropagation(); openProfileModal(myUid); }
});

function renderBannerSwatches(current) {
  const wrap = $('banner-color-swatches');
  const gradWrap = $('banner-gradient-swatches');
  wrap.innerHTML = '';
  wrap.dataset.chosen = current;
  const clearSelected = () => document.querySelectorAll('#banner-color-swatches .swatch, #banner-gradient-swatches .swatch').forEach(s => s.classList.remove('selected'));
  const makeSwatch = (bg, locked) => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (current === bg ? ' selected' : '') + (locked ? ' locked-swatch' : '');
    sw.style.background = bg;
    if (locked) {
      sw.innerHTML = `<span class="swatch-lock">${icon('shield')}</span>`;
      sw.onclick = () => openPremiumModal();
    } else {
      sw.onclick = () => {
        clearSelected();
        sw.classList.add('selected');
        wrap.dataset.chosen = bg;
        $('profile-banner').style.background = bg;
      };
    }
    return sw;
  };
  AVATAR_COLORS.forEach(c => wrap.appendChild(makeSwatch(c, false)));

  gradWrap.innerHTML = '';
  const premium = isPremium(myProfile);
  BANNER_GRADIENTS.forEach(g => gradWrap.appendChild(makeSwatch(g, !premium)));
  $('banner-gradient-label').textContent = premium ? 'Gradient Banners' : 'Gradient Banners (Frixion Premium)';
}

function openGiftModal(username) {
  $('gift-modal-desc').textContent = `Send Frixion Premium to ${username}.`;
  $('gift-modal-orb-amt').textContent = myProfile.orbs || 0;
  $('confirm-gift-premium').onclick = () => giftPremiumTo(username);
  openModal('gift-modal');
}

async function openProfileModal(username) {
  const isSelf = username === myUid;
  let p;
  try {
    const snap = await db.collection('users').doc(username).get();
    if (!snap.exists) { toast('User not found.', 'error'); return; }
    p = snap.data();
    profileCache[username] = p;
  } catch (e) { toast('Could not load profile.', 'error'); return; }

  $('profile-banner').style.background = p.bannerColor || p.avatarColor || '#5865f2';
  $('profile-avatar').style.background = 'transparent';
  $('profile-avatar').classList.add('has-image');
  $('profile-avatar').innerHTML = `<img src="${esc(p.avatarUrl || DEFAULT_AVATAR_URL)}" alt="">`;
  $('profile-username').innerHTML = esc(p.username) + premiumStar(p) + opTag(p);
  $('profile-pronouns').textContent = p.pronouns || '';
  $('profile-pronouns').classList.toggle('hidden', !p.pronouns);
  $('profile-bio-view').textContent = p.bio || (isSelf ? 'Add a bio below with Edit Profile.' : 'No bio yet.');
  $('profile-member-since').textContent = (p.createdAt && p.createdAt.toDate) ? p.createdAt.toDate().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—';

  $('profile-edit-fields').classList.toggle('hidden', !isSelf);
  $('profile-note-wrap').classList.toggle('hidden', isSelf);
  $('profile-mutual').textContent = '';

  if (isSelf) {
    $('edit-pronouns').value = p.pronouns || '';
    $('edit-bio').value = p.bio || '';
    renderBannerSwatches(p.bannerColor || p.avatarColor);
    $('profile-actions').innerHTML = '';
    $('change-avatar-btn').classList.remove('hidden');
    $('remove-avatar-link').classList.toggle('hidden', !p.avatarUrl);
  } else {
    $('change-avatar-btn').classList.add('hidden');
    const isFriend = (myProfile.friends || []).includes(username);
    const outgoing = (myProfile.outgoingRequests || []).includes(username);
    const incoming = (myProfile.incomingRequests || []).includes(username);
    let friendBtn;
    if (isFriend) friendBtn = `<span class="quest-claimed">Friends</span>`;
    else if (outgoing) friendBtn = `<button class="btn-secondary slim" id="profile-cancel-req">Cancel Request</button>`;
    else if (incoming) friendBtn = `<button class="btn-accent-inline slim" id="profile-accept-req">Accept Request</button>`;
    else friendBtn = `<button class="btn-accent-inline slim" id="profile-add-friend">Add Friend</button>`;
    $('profile-actions').innerHTML = `<div class="profile-action-row">
      <button class="btn-accent-inline slim" id="profile-message-btn">Message</button>
      ${friendBtn}
      <button class="btn-secondary slim" id="profile-gift-btn">Gift Premium</button>
    </div>`;
    $('profile-message-btn').onclick = () => { closeModal('profile-modal'); startDMWith(username); };
    if ($('profile-add-friend')) $('profile-add-friend').onclick = async () => {
      await db.collection('users').doc(myUid).update({ outgoingRequests: FieldValue.arrayUnion(username) });
      await db.collection('users').doc(username).update({ incomingRequests: FieldValue.arrayUnion(myUid) });
      openProfileModal(username);
    };
    if ($('profile-cancel-req')) $('profile-cancel-req').onclick = async () => { await cancelFriendRequest(username); openProfileModal(username); };
    if ($('profile-accept-req')) $('profile-accept-req').onclick = async () => { await respondFriendRequest(username, true); openProfileModal(username); };
    $('profile-gift-btn').onclick = () => openGiftModal(username);

    $('profile-note-input').value = '';
    $('profile-note-input').dataset.target = username;
    try {
      const noteSnap = await db.collection('users').doc(username).collection('privateNotes').doc(myUid).get();
      $('profile-note-input').value = noteSnap.exists ? (noteSnap.data().text || '') : '';
    } catch (e) {}
  }
  openModal('profile-modal');
}
$('profile-note-input').addEventListener('blur', async (e) => {
  const target = e.target.dataset.target;
  if (!target) return;
  try { await db.collection('users').doc(target).collection('privateNotes').doc(myUid).set({ text: e.target.value, updatedAt: FieldValue.serverTimestamp() }); } catch (err) {}
});
$('save-profile-btn').onclick = async () => {
  const pronouns = $('edit-pronouns').value.trim();
  const bio = $('edit-bio').value.trim();
  const bannerColor = $('banner-color-swatches').dataset.chosen || myProfile.bannerColor;
  try {
    await db.collection('users').doc(myUid).update({ pronouns, bio, bannerColor });
    toast('Profile updated.');
  } catch (e) { toast('Could not save profile.', 'error'); }
};

$('change-avatar-btn').onclick = () => $('avatar-file-input').click();
$('avatar-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please choose an image.', 'error'); return; }
  if (file.size > 8 * 1024 * 1024) { toast('That image is too big (8MB max).', 'error'); return; }
  toast('Uploading avatar…');
  try {
    const url = await uploadImageToImgbb(file);
    await db.collection('users').doc(myUid).update({ avatarUrl: url });
    toast('Avatar updated.');
    openProfileModal(myUid);
  } catch (err) { toast(err.message || 'Avatar upload failed.', 'error'); }
});
$('remove-avatar-link').onclick = async () => {
  try {
    await db.collection('users').doc(myUid).update({ avatarUrl: FieldValue.delete() });
    toast('Custom avatar removed.');
    openProfileModal(myUid);
  } catch (e) { toast('Could not remove avatar.', 'error'); }
};

$('gift-btn').onclick = () => { if (currentDMOtherUid) openGiftModal(currentDMOtherUid); };

// ============================================================
// UPLOADS (images via ImgBB, other files via Firebase Storage
// as a fallback — see the note at the top of this file about
// why Storage alone isn't enough anymore)
// ============================================================
function humanFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB'];
  let i = -1;
  do { bytes /= 1024; i++; } while (bytes >= 1024 && i < units.length - 1);
  return bytes.toFixed(1) + ' ' + units[i];
}
async function uploadImageToImgbb(file) {
  if (!IMGBB_API_KEY) throw new Error('Image uploads need a free ImgBB API key added in script.js (IMGBB_API_KEY).');
  const formData = new FormData();
  formData.append('image', file);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!data.success) throw new Error((data.error && data.error.message) || 'ImgBB upload failed.');
  return data.data.url;
}
async function uploadFileGeneric(file, isImage) {
  if (isImage) return uploadImageToImgbb(file);
  if (!storage) throw new Error("General file uploads need Firebase Storage on the project's Blaze plan. Images and GIFs work without it.");
  const path = `uploads/${myUid}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const ref = storage.ref().child(path);
  await ref.put(file);
  return ref.getDownloadURL();
}

// ---- staged attachments ----
// Files picked or pasted sit in a draft strip above the composer instead
// of sending instantly — lets you drop the wrong one and send several
// together as one message, matching how the real Discord client stages
// images before you hit send.
let draftAttachments = []; // { id, file, type: 'image'|'file', previewUrl }
function stageFile(file) {
  if (currentView !== 'channel' && currentView !== 'dm' && currentView !== 'groupdm') { toast('Pick a conversation first.'); return; }
  if (file.size > 10 * 1024 * 1024) { toast(`${file.name} is over 10MB — not supported here.`, 'error'); return; }
  const isImage = file.type.startsWith('image/');
  if (!isImage && !storage) { toast("General file uploads need Firebase Storage on the project's Blaze plan. Images and GIFs work without it.", 'error'); return; }
  draftAttachments.push({
    id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    file, type: isImage ? 'image' : 'file',
    previewUrl: isImage ? URL.createObjectURL(file) : null,
  });
  renderAttachmentDraft();
}
function removeDraftAttachment(id) {
  const idx = draftAttachments.findIndex(d => d.id === id);
  if (idx === -1) return;
  if (draftAttachments[idx].previewUrl) URL.revokeObjectURL(draftAttachments[idx].previewUrl);
  draftAttachments.splice(idx, 1);
  renderAttachmentDraft();
}
function clearDraftAttachments() {
  draftAttachments.forEach(d => { if (d.previewUrl) URL.revokeObjectURL(d.previewUrl); });
  draftAttachments = [];
  renderAttachmentDraft();
}
function previewDraftAttachment(id) {
  const d = draftAttachments.find(x => x.id === id);
  if (!d) return;
  if (d.type === 'image') {
    $('image-preview-img').src = d.previewUrl;
    openModal('image-preview-modal');
  } else {
    window.open(URL.createObjectURL(d.file), '_blank');
  }
}
function renderAttachmentDraft() {
  const wrap = $('attachment-draft');
  if (!draftAttachments.length) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  wrap.innerHTML = draftAttachments.map(d => `
    <div class="draft-card" data-did="${d.id}">
      <div class="draft-card-thumb">
        ${d.type === 'image' ? `<img src="${d.previewUrl}" alt="${esc(d.file.name)}">` : `<div class="draft-file-icon">${icon('file')}</div>`}
        <div class="draft-card-actions">
          <button type="button" class="draft-action-btn" data-act="view" title="Preview">${icon('eye')}</button>
          <button type="button" class="draft-action-btn danger" data-act="remove" title="Remove">${icon('trash')}</button>
        </div>
      </div>
      <div class="draft-card-name">${esc(d.file.name)}</div>
    </div>`).join('');
  wrap.querySelectorAll('.draft-card').forEach(card => {
    const id = card.dataset.did;
    card.querySelector('[data-act="view"]').onclick = () => previewDraftAttachment(id);
    card.querySelector('[data-act="remove"]').onclick = () => removeDraftAttachment(id);
  });
}

$('attach-btn').onclick = (e) => {
  e.stopPropagation();
  $('emoji-picker-panel').classList.add('hidden');
  $('sticker-picker-panel').classList.add('hidden');
  $('gif-picker-panel').classList.add('hidden');
  $('custom-keyboard').classList.add('hidden');
  $('composer-action-menu').classList.toggle('hidden');
};
$('attach-file-menu').onclick = () => { $('composer-action-menu').classList.add('hidden'); $('file-input').click(); };
$('create-poll-menu').onclick = () => { $('composer-action-menu').classList.add('hidden'); openPollModal(); };
document.addEventListener('click', (e) => {
  const menu = $('composer-action-menu');
  if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !e.target.closest('#attach-btn')) {
    menu.classList.add('hidden');
  }
});
$('file-input').addEventListener('change', (e) => {
  Array.from(e.target.files || []).forEach(stageFile);
  e.target.value = '';
});
$('composer-input').addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  let handled = false;
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) { stageFile(file); handled = true; }
    }
  }
  if (handled) e.preventDefault();
});

// ============================================================
// STICKERS
// ============================================================
let stickerCache = {};
function subscribeStickers() {
  db.collection('stickers').onSnapshot(snap => {
    const map = {};
    snap.forEach(d => { map[d.id] = d.data(); });
    stickerCache = map;
    renderStickerGrid();
  });
}
function renderStickerGrid() {
  const wrap = $('sticker-grid');
  if (!wrap) return;
  const names = Object.keys(stickerCache).sort();
  wrap.innerHTML = names.length
    ? names.map(n => `<button type="button" title="${esc(n)}"><img src="${stickerCache[n].dataUrl}" alt="${esc(n)}"></button>`).join('')
    : '<div class="ep-empty">No stickers published yet</div>';
  wrap.querySelectorAll('button').forEach((btn, i) => {
    btn.onclick = async () => {
      $('sticker-picker-panel').classList.add('hidden');
      try {
        await sendToCurrentConversation({
          uid: myUid, username: myProfile.username, createdAt: FieldValue.serverTimestamp(),
          sticker: { name: names[i], dataUrl: stickerCache[names[i]].dataUrl },
        });
      } catch (e) { toast('Could not send sticker.', 'error'); }
    };
  });
}
$('sticker-btn').onclick = (e) => {
  e.stopPropagation();
  $('emoji-picker-panel').classList.add('hidden');
  $('gif-picker-panel').classList.add('hidden');
  $('custom-keyboard').classList.add('hidden');
  $('composer-action-menu').classList.add('hidden');
  $('sticker-picker-panel').classList.toggle('hidden');
  renderStickerGrid();
};

// ============================================================
// GIFS (Tenor)
// ============================================================
// KLIPY's real API puts the key in the URL path and needs a customer_id
// (their term for "your app's own user id" — Frixion's username works fine).
// Their exact field names for the actual GIF URL inside each result aren't
// fully confirmed here, so this tries a few likely shapes and logs the raw
// item to the console if none of them match — check there if GIFs still
// don't show up, and the real field name can be wired in precisely.
function extractKlipyUrl(item) {
  const f = item.file || item.files || {};
  return (
    (f.md && f.md.gif && f.md.gif.url) ||
    (f.sm && f.sm.gif && f.sm.gif.url) ||
    (f.hd && f.hd.gif && f.hd.gif.url) ||
    (f.tiny && f.tiny.gif && f.tiny.gif.url) ||
    (f.gif && f.gif.url) ||
    (typeof f.gif === 'string' ? f.gif : null) ||
    item.url ||
    null
  );
}
async function klipySearch(query) {
  const grid = $('gif-grid');
  if (!GIF_API_KEY) {
    grid.innerHTML = '<div class="ep-empty">GIF search needs a free KLIPY API key added in script.js (GIF_API_KEY).</div>';
    return;
  }
  grid.innerHTML = '<div class="ep-empty">Searching…</div>';
  try {
    const customerId = encodeURIComponent(myUid || 'frixion-guest');
    const endpoint = query
      ? `https://api.klipy.com/api/v1/${GIF_API_KEY}/gifs/search?q=${encodeURIComponent(query)}&customer_id=${customerId}&per_page=24`
      : `https://api.klipy.com/api/v1/${GIF_API_KEY}/gifs/trending?customer_id=${customerId}&per_page=24`;
    const res = await fetch(endpoint);
    const data = await res.json();
    if (data.result === false) {
      console.warn('KLIPY error response:', data);
      grid.innerHTML = '<div class="ep-empty">GIF search failed — see the browser console for details.</div>';
      return;
    }
    const results = (data.data && data.data.data) || data.results || [];
    if (results.length) console.log('KLIPY sample result (for wiring up the exact URL field if needed):', results[0]);
    const urls = results.map(extractKlipyUrl);
    grid.innerHTML = results.length
      ? results.map((r, i) => urls[i] ? `<button type="button" class="gif-thumb" data-i="${i}"><img src="${esc(urls[i])}" alt=""></button>` : '').join('')
      : '<div class="ep-empty">No GIFs found.</div>';
    if (results.length && !urls.some(Boolean)) {
      grid.innerHTML = '<div class="ep-empty">Found results but couldn\'t read their URLs — check the browser console, the sample result logged there shows the real field names.</div>';
    }
    grid.querySelectorAll('.gif-thumb').forEach((btn) => {
      const url = urls[parseInt(btn.dataset.i, 10)];
      btn.onclick = async () => {
        $('gif-picker-panel').classList.add('hidden');
        try {
          await sendToCurrentConversation({
            text: '', uid: myUid, username: myProfile.username, createdAt: FieldValue.serverTimestamp(),
            gifUrl: url,
          });
        } catch (e) { toast('Could not send GIF.', 'error'); }
      };
    });
  } catch (e) {
    console.warn('KLIPY search error:', e);
    grid.innerHTML = '<div class="ep-empty">GIF search failed — see the browser console for details.</div>';
  }
}
let gifSearchDebounce = null;
$('gif-search').addEventListener('input', () => {
  clearTimeout(gifSearchDebounce);
  gifSearchDebounce = setTimeout(() => klipySearch($('gif-search').value.trim()), 350);
});
$('gif-btn').onclick = (e) => {
  e.stopPropagation();
  $('emoji-picker-panel').classList.add('hidden');
  $('sticker-picker-panel').classList.add('hidden');
  $('custom-keyboard').classList.add('hidden');
  $('composer-action-menu').classList.add('hidden');
  const willOpen = $('gif-picker-panel').classList.contains('hidden');
  $('gif-picker-panel').classList.toggle('hidden');
  if (willOpen) { $('gif-search').value = ''; klipySearch(''); }
};
document.addEventListener('click', (e) => {
  if (!$('sticker-picker-panel').contains(e.target) && !e.target.closest('#sticker-btn')) $('sticker-picker-panel').classList.add('hidden');
  if (!$('gif-picker-panel').contains(e.target) && !e.target.closest('#gif-btn')) $('gif-picker-panel').classList.add('hidden');
});

$('redeem-code-btn') && ($('redeem-code-btn').onclick = redeemCode);
function renderCodesView() { /* form is static; nothing to refresh */ }

// ============================================================
// FRIENDS
// ============================================================
function updateFriendReqBadge() {
  const n = (myProfile.incomingRequests || []).length;
  $('friend-req-badge').classList.toggle('hidden', n === 0);
  $('friend-req-badge').textContent = n;
}

document.querySelectorAll('.friends-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.friends-tab').forEach(t => t.classList.remove('on'));
    tab.classList.add('on');
    $('friends-add-pane').classList.toggle('hidden', tab.dataset.friendsTab !== 'add');
    $('friends-list-pane').classList.toggle('hidden', tab.dataset.friendsTab === 'add');
    renderFriendsView(tab.dataset.friendsTab);
  };
});

function friendRowHTML(username, kind) {
  const p = profileCache[username] || { username, avatarColor: '#5865f2', status: 'offline' };
  let actions = '';
  if (kind === 'friend') {
    actions = `<button class="btn-secondary slim" data-msg="${esc(username)}">Message</button><span class="hover-icon-btn" data-remove="${esc(username)}" title="Remove Friend">${icon('trash')}</span>`;
  } else if (kind === 'incoming') {
    actions = `<button class="btn-accent-inline slim" data-accept="${esc(username)}">Accept</button><button class="btn-secondary slim" data-decline="${esc(username)}">Decline</button>`;
  } else {
    actions = `<span class="quest-locked">Pending</span><button class="btn-secondary slim" data-cancel="${esc(username)}">Cancel</button>`;
  }
  return `<div class="friend-row">
    ${avatarHTML(36, p.avatarColor, initials(p.username), computeDisplayStatus(username), p.avatarUrl)}
    <span class="friend-row-name" data-openprofile="${esc(username)}">${esc(p.username)}${premiumStar(p)}${opTag(p)}</span>
    <span class="friend-row-actions">${actions}</span>
  </div>`;
}
function wireFriendRowButtons() {
  document.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => startDMWith(b.dataset.msg));
  document.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => removeFriend(b.dataset.remove));
  document.querySelectorAll('[data-accept]').forEach(b => b.onclick = () => respondFriendRequest(b.dataset.accept, true));
  document.querySelectorAll('[data-decline]').forEach(b => b.onclick = () => respondFriendRequest(b.dataset.decline, false));
  document.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => cancelFriendRequest(b.dataset.cancel));
  document.querySelectorAll('[data-openprofile]').forEach(b => b.onclick = () => openProfileModal(b.dataset.openprofile));
}

async function renderFriendsView(mode) {
  const activeTab = document.querySelector('.friends-tab.on');
  mode = mode || (activeTab && activeTab.dataset.friendsTab) || 'all';
  updateFriendReqBadge();
  const incoming = myProfile.incomingRequests || [];
  const outgoing = myProfile.outgoingRequests || [];
  $('pending-tab-badge').classList.toggle('hidden', incoming.length === 0);
  $('pending-tab-badge').textContent = incoming.length;
  if (mode === 'add') return;
  const wrap = $('friends-list-pane');
  if (mode === 'pending') {
    await Promise.all([...incoming, ...outgoing].map(u => getProfile(u)));
    let html = '';
    if (incoming.length) html += `<div class="side-section-label">Incoming — ${incoming.length}</div>` + incoming.map(u => friendRowHTML(u, 'incoming')).join('');
    if (outgoing.length) html += `<div class="side-section-label">Outgoing — ${outgoing.length}</div>` + outgoing.map(u => friendRowHTML(u, 'outgoing')).join('');
    wrap.innerHTML = html || '<div class="empty">No pending requests.</div>';
  } else {
    const friends = myProfile.friends || [];
    await Promise.all(friends.map(u => getProfile(u)));
    wrap.innerHTML = friends.length
      ? `<div class="side-section-label">All Friends — ${friends.length}</div>` + friends.map(u => friendRowHTML(u, 'friend')).join('')
      : '<div class="empty">No friends yet — add some from the Add Friend tab.</div>';
  }
  wireFriendRowButtons();
}

$('send-friend-req-btn').onclick = async () => {
  const uname = ($('add-friend-username').value || '').trim();
  $('add-friend-error').textContent = '';
  if (!uname) { $('add-friend-error').textContent = 'Enter a username.'; return; }
  if (uname === myUid) { $('add-friend-error').textContent = "That's you!"; return; }
  try {
    const snap = await db.collection('users').doc(uname).get();
    if (!snap.exists) { $('add-friend-error').textContent = 'No user found with that username.'; return; }
    if ((myProfile.friends || []).includes(uname)) { $('add-friend-error').textContent = 'Already friends.'; return; }
    if ((myProfile.outgoingRequests || []).includes(uname)) { $('add-friend-error').textContent = 'Request already sent.'; return; }
    if ((myProfile.incomingRequests || []).includes(uname)) { await respondFriendRequest(uname, true); $('add-friend-username').value = ''; return; }
    await db.collection('users').doc(myUid).update({ outgoingRequests: FieldValue.arrayUnion(uname) });
    await db.collection('users').doc(uname).update({ incomingRequests: FieldValue.arrayUnion(myUid) });
    $('add-friend-username').value = '';
    toast('Friend request sent.');
  } catch (e) { $('add-friend-error').textContent = 'Something went wrong.'; }
};
async function respondFriendRequest(username, accept) {
  try {
    await db.collection('users').doc(myUid).update({ incomingRequests: FieldValue.arrayRemove(username) });
    await db.collection('users').doc(username).update({ outgoingRequests: FieldValue.arrayRemove(myUid) });
    if (accept) {
      await db.collection('users').doc(myUid).update({ friends: FieldValue.arrayUnion(username) });
      await db.collection('users').doc(username).update({ friends: FieldValue.arrayUnion(myUid) });
      toast(`You're now friends with ${username}.`);
    }
  } catch (e) { toast('Something went wrong.', 'error'); }
}
async function cancelFriendRequest(username) {
  try {
    await db.collection('users').doc(myUid).update({ outgoingRequests: FieldValue.arrayRemove(username) });
    await db.collection('users').doc(username).update({ incomingRequests: FieldValue.arrayRemove(myUid) });
  } catch (e) {}
}
async function removeFriend(username) {
  if (!confirm(`Remove ${username} as a friend?`)) return;
  try {
    await db.collection('users').doc(myUid).update({ friends: FieldValue.arrayRemove(username) });
    await db.collection('users').doc(username).update({ friends: FieldValue.arrayRemove(myUid) });
  } catch (e) {}
}

// ============================================================
// SERVER VIEW
// ============================================================
async function selectServer(server) {
  currentServerId = server.id;
  currentServerData = server;
  currentDMId = null; currentDMOtherUid = null; currentGroupDMId = null; currentChannelId = null;
  currentView = 'none';
  document.querySelectorAll('#server-rail-list .rail-item').forEach(e => e.classList.remove('active'));
  $('rail-home').classList.remove('active');
  [...$('server-rail-list').children].forEach(el => { if (el.dataset.id === server.id) el.classList.add('active'); });
  $('side-header-title').textContent = server.name;
  $('dm-list').classList.add('hidden');
  $('channel-list').classList.remove('hidden');
  scheduleLoadingView();
  setMobilePane('list');
  subscribeChannels(server.id);
  renderMemberPanel(server.members || [], server.ownerId);
}

$('side-header').onclick = () => {
  if (!currentServerId || !currentServerData) return;
  if (currentServerData.ownerId !== myUid && !isAdmin) { toast('Only the server owner can edit this server.'); return; }
  $('server-settings-title').textContent = currentServerData.name + ' Settings';
  $('edit-server-name').value = currentServerData.name;
  $('server-invite-display').value = currentServerData.inviteCode;
  openModal('server-settings-modal');
};

$('save-server-btn').onclick = async () => {
  const name = $('edit-server-name').value.trim();
  if (!name || !currentServerId) return;
  await db.collection('servers').doc(currentServerId).update({ name });
  closeModal('server-settings-modal');
  toast('Server updated.');
};

$('delete-server-btn').onclick = async () => {
  if (!currentServerId) return;
  if (!confirm('Delete this server permanently? This cannot be undone.')) return;
  const sid = currentServerId;
  try {
    const chSnap = await db.collection('servers').doc(sid).collection('channels').get();
    for (const ch of chSnap.docs) {
      const msgSnap = await ch.ref.collection('messages').get();
      await Promise.all(msgSnap.docs.map(m => m.ref.delete()));
      await ch.ref.delete();
    }
    await db.collection('servers').doc(sid).delete();
    closeModal('server-settings-modal');
    showHomeView();
    toast('Server deleted.');
  } catch (e) { toast('Failed to delete server: ' + e.message, 'error'); }
};

let lastCategoriesList = [];
let collapsedCategories = {};

function subscribeChannels(serverId) {
  if (unsub.channels) unsub.channels();
  if (unsub.categories) unsub.categories();
  unsub.channels = db.collection('servers').doc(serverId).collection('channels').orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      const channels = [];
      snap.forEach(d => channels.push({ id: d.id, ...d.data() }));
      lastChannelsList = channels;
      renderChannelRows(channels);
      if (!currentChannelId && channels.length) selectChannel(channels[0]);
      else if (!channels.length) showWelcome();
    });
  unsub.categories = db.collection('servers').doc(serverId).collection('categories').orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      const cats = [];
      snap.forEach(d => cats.push({ id: d.id, ...d.data() }));
      lastCategoriesList = cats;
      renderChannelRows(lastChannelsList);
      populateCategorySelect();
    });
}
function populateCategorySelect() {
  const sel = $('new-channel-category');
  sel.innerHTML = '<option value="">No Category</option>' + lastCategoriesList.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
}

function renderChannelRows(channels) {
  const wrap = $('channel-rows');
  wrap.innerHTML = '';
  const canManage = currentServerData && (currentServerData.ownerId === myUid || isAdmin);

  const buildChannelRow = (c) => {
    const row = document.createElement('div');
    row.className = 'channel-row' + (currentChannelId === c.id ? ' active' : '');
    row.innerHTML = `<span class="hash">#</span><span class="cname">${esc(c.name)}</span>` + (canManage ? `<span class="del-channel" title="Delete channel">${icon('trash')}</span>` : '');
    row.onclick = () => selectChannel(c);
    if (canManage) row.querySelector('.del-channel').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete #${c.name}?`)) return;
      const msgSnap = await db.collection('servers').doc(currentServerId).collection('channels').doc(c.id).collection('messages').get();
      await Promise.all(msgSnap.docs.map(m => m.ref.delete()));
      await db.collection('servers').doc(currentServerId).collection('channels').doc(c.id).delete();
      if (currentChannelId === c.id) { currentChannelId = null; showWelcome(); }
    };
    return row;
  };

  const uncategorized = channels.filter(c => !c.categoryId);
  uncategorized.forEach(c => wrap.appendChild(buildChannelRow(c)));

  lastCategoriesList.forEach(cat => {
    const inCat = channels.filter(c => c.categoryId === cat.id);
    const header = document.createElement('div');
    const collapsed = !!collapsedCategories[cat.id];
    header.className = 'category-header';
    header.innerHTML = `<svg class="cat-chevron${collapsed ? ' collapsed' : ''}" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg><span>${esc(cat.name)}</span>`;
    header.onclick = () => { collapsedCategories[cat.id] = !collapsedCategories[cat.id]; renderChannelRows(lastChannelsList); };
    wrap.appendChild(header);
    if (!collapsed) inCat.forEach(c => wrap.appendChild(buildChannelRow(c)));
  });
}

$('channel-add-btn').onclick = () => {
  if (!currentServerId) return;
  if (currentServerData.ownerId !== myUid && !isAdmin) { toast('Only the server owner can create channels.'); return; }
  $('new-channel-name').value = '';
  populateCategorySelect();
  openModal('create-channel-modal');
};

$('confirm-create-channel').onclick = async () => {
  const name = sanitizeChannelName($('new-channel-name').value || '');
  const categoryId = $('new-channel-category').value || null;
  if (!currentServerId) return;
  await db.collection('servers').doc(currentServerId).collection('channels').add({ name, categoryId, autoDelete: true, createdAt: FieldValue.serverTimestamp() });
  closeModal('create-channel-modal');
};

$('category-add-btn').onclick = () => {
  if (!currentServerId) return;
  if (currentServerData.ownerId !== myUid && !isAdmin) { toast('Only the server owner can create categories.'); return; }
  $('new-category-name').value = '';
  openModal('create-category-modal');
};
$('confirm-create-category').onclick = async () => {
  const name = ($('new-category-name').value || '').trim().toUpperCase();
  if (!name || !currentServerId) { toast('Enter a category name.'); return; }
  await db.collection('servers').doc(currentServerId).collection('categories').add({ name, createdAt: FieldValue.serverTimestamp() });
  closeModal('create-category-modal');
};

function selectChannel(channel) {
  clearReplyTarget();
  currentChannelId = channel.id;
  currentView = 'channel';
  $('chat-header-hash').textContent = '#';
  $('chat-header-title').textContent = channel.name;
  $('composer-input').placeholder = `Message #${channel.name}`;
  $('members-toggle').classList.remove('hidden');
  applyDefaultMemberListState();
  $('gift-btn').classList.add('hidden');
  showHeaderActions();
  renderChannelRows(lastChannelsList);
  showChat();
  setMobilePane('chat');
  scheduleMsgLoading();
  if (channel.autoDelete !== false) sweepOldMessages(db.collection('servers').doc(currentServerId).collection('channels').doc(channel.id).collection('messages'));
  openConversationMessages(`channel:${currentServerId}:${channel.id}`,
    db.collection('servers').doc(currentServerId).collection('channels').doc(channel.id).collection('messages'));
}

// ============================================================
// CHAT HEADER ACTIONS (mute / pins / search)
// ============================================================
function muteKey() { return currentView === 'channel' ? `frixion_mute:ch:${currentChannelId}` : `frixion_mute:dm:${currentDMId}`; }
function isMuted() { return localStorage.getItem(muteKey()) === '1'; }
function updateMuteIcon() {
  const muted = isMuted();
  $('mute-toggle').querySelector('.i-unmuted').classList.toggle('hidden', muted);
  $('mute-toggle').querySelector('.i-muted').classList.toggle('hidden', !muted);
  $('mute-toggle').classList.toggle('on', muted);
}
$('mute-toggle').onclick = () => {
  const key = muteKey();
  const wasMuted = localStorage.getItem(key) === '1';
  if (wasMuted) localStorage.removeItem(key); else localStorage.setItem(key, '1');
  updateMuteIcon();
  toast(wasMuted ? 'Unmuted.' : 'Muted. You can still open it manually.');
};

function canPin() {
  if (currentView === 'dm') return true;
  return isAdmin || (currentServerData && currentServerData.ownerId === myUid);
}
$('pins-toggle').onclick = () => {
  renderPinnedList(lastRawMessages.filter(m => m.pinned));
  openModal('pinned-modal');
};
function renderPinnedList(pinned) {
  const wrap = $('pinned-list');
  if (!pinned.length) { wrap.innerHTML = '<div class="empty">No pinned messages yet — hover a message and pin it.</div>'; return; }
  wrap.innerHTML = pinned.map(m => {
    const p = profileCache[m.uid] || { username: m.username || 'Unknown User', avatarColor: '#5865f2' };
    return `<div class="pinned-row" data-mid="${esc(m.id)}">
      ${avatarHTML(34, p.avatarColor, initials(p.username), null, p.avatarUrl)}
      <div class="pr-body">
        <div class="pr-head"><span class="pr-author">${esc(p.username)}</span><span class="pr-time">${timeStr(m.createdAt)}</span></div>
        <div class="pr-text">${m.poll ? `📊 ${esc(m.poll.question)}` : renderMessageText(m.text)}</div>
      </div>
      ${canPin() ? `<span class="pr-unpin" title="Unpin">${icon('trash')}</span>` : ''}
    </div>`;
  }).join('');
  wrap.querySelectorAll('.pr-unpin').forEach(btn => {
    btn.onclick = () => togglePin(btn.closest('.pinned-row').dataset.mid, true);
  });
}
function msgRef(msgId) {
  if (currentView === 'channel') return db.collection('servers').doc(currentServerId).collection('channels').doc(currentChannelId).collection('messages').doc(msgId);
  if (currentView === 'dm') return db.collection('dms').doc(currentDMId).collection('messages').doc(msgId);
  if (currentView === 'groupdm') return db.collection('groupDMs').doc(currentGroupDMId).collection('messages').doc(msgId);
  return null;
}
function msgCollectionRef() {
  if (currentView === 'channel') return db.collection('servers').doc(currentServerId).collection('channels').doc(currentChannelId).collection('messages');
  if (currentView === 'dm') return db.collection('dms').doc(currentDMId).collection('messages');
  if (currentView === 'groupdm') return db.collection('groupDMs').doc(currentGroupDMId).collection('messages');
  return null;
}
// Best-effort, client-triggered cleanup — there's no server/cron here, so a
// conversation's old messages only actually get swept the next time someone
// with auto-delete turned on for it opens the conversation.
const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
async function sweepOldMessages(ref) {
  if (!ref) return;
  try {
    const cutoff = firebase.firestore.Timestamp.fromMillis(Date.now() - MESSAGE_TTL_MS);
    const snap = await ref.where('createdAt', '<', cutoff).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.forEach(d => batch.delete(d.ref));
    await batch.commit();
  } catch (e) { console.warn('Auto-delete sweep failed', e); }
}
async function togglePin(msgId, forceUnpin) {
  const msg = lastRawMessages.find(m => m.id === msgId);
  const newVal = forceUnpin ? false : !(msg && msg.pinned);
  const ref = msgRef(msgId);
  if (!ref) return;
  try { await ref.update({ pinned: newVal }); } catch (e) { toast('Could not update pin.', 'error'); }
}

let searchActive = false;
$('search-toggle').onclick = () => {
  searchActive = !searchActive;
  $('search-toggle').classList.toggle('on', searchActive);
  $('search-bar').classList.toggle('hidden', !searchActive);
  if (searchActive) { $('search-input').value = ''; $('search-input').focus(); }
  renderCurrentMessages();
};
$('search-close').onclick = () => {
  searchActive = false;
  $('search-toggle').classList.remove('on');
  $('search-bar').classList.add('hidden');
  renderCurrentMessages();
};
$('search-input').addEventListener('input', renderCurrentMessages);
$('search-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('search-close').click(); });

function showHeaderActions() {
  $('mute-toggle').classList.remove('hidden');
  $('pins-toggle').classList.remove('hidden');
  $('search-toggle').classList.remove('hidden');
  $('add-member-toggle').classList.toggle('hidden', currentView !== 'groupdm');
  updateMuteIcon();
  searchActive = false;
  $('search-toggle').classList.remove('on');
  $('search-bar').classList.add('hidden');
}
function hideHeaderActions() {
  $('mute-toggle').classList.add('hidden');
  $('pins-toggle').classList.add('hidden');
  $('search-toggle').classList.add('hidden');
  $('add-member-toggle').classList.add('hidden');
  $('gift-btn').classList.add('hidden');
  $('search-bar').classList.add('hidden');
}

// Local-only echoes for messages whose attachments are still uploading —
// see addPendingMessage/sendMessage. Firestore already echoes plain
// writes (text, polls) to your own client instantly; this exists only
// for the one case Firestore can't help with: the file isn't uploaded
// yet, so there's no document to write until that finishes.
let pendingMessages = [];
// localIds of pending echoes whose real doc has already arrived but is
// being held back from rendering — see onMessagesUpdate. Without this,
// the moment the real doc appears we'd swap from an already-loaded local
// blob preview to a brand-new CDN url the browser hasn't fetched yet,
// which is the "blue outline vanishes, then it takes a while" flicker.
let holdingLocalIds = new Set();
// Every re-render of the current conversation should go through here, not
// renderMessages(lastRawMessages) directly — otherwise an in-flight
// upload's pending bubble would vanish for a frame on any unrelated
// re-render (search, edit-cancel, view switches...) until the next real
// snapshot update put it back.
function renderCurrentMessages() {
  const shown = lastRawMessages.filter(m => !(m.localId && holdingLocalIds.has(m.localId)));
  renderMessages(shown.concat(pendingMessages));
}
function revokePendingPreviews(p) {
  (p.attachments || []).forEach(a => { if (a.url && a.url.startsWith('blob:')) URL.revokeObjectURL(a.url); });
}
function addPendingMessage(localId, payload, previewAttachments) {
  pendingMessages.push({
    id: localId, localId, localOnly: true,
    uid: payload.uid, username: payload.username,
    text: payload.text || '', replyTo: payload.replyTo || null,
    attachments: previewAttachments,
    createdAt: { toDate: () => new Date() },
    pendingWrite: true,
  });
  renderCurrentMessages();
}
function removePendingMessage(localId) {
  const p = pendingMessages.find(x => x.localId === localId);
  if (p) revokePendingPreviews(p);
  pendingMessages = pendingMessages.filter(x => x.localId !== localId);
  holdingLocalIds.delete(localId);
  renderCurrentMessages();
}
function finalizePendingSwap(localId) {
  holdingLocalIds.delete(localId);
  const p = pendingMessages.find(x => x.localId === localId);
  if (p) revokePendingPreviews(p);
  pendingMessages = pendingMessages.filter(x => x.localId !== localId);
  renderCurrentMessages();
}
function onMessagesUpdate(msgs) {
  cancelMsgLoading();
  lastRawMessages = msgs;
  pendingMessages.forEach(p => {
    if (holdingLocalIds.has(p.localId)) return; // already preloading its replacement
    const real = msgs.find(m => m.localId && m.localId === p.localId);
    if (!real) return;
    const imgs = (real.attachments || []).filter(a => a.type === 'image');
    if (!imgs.length) { finalizePendingSwap(p.localId); return; }
    // Preload the real image(s) in the background; keep showing the local
    // blob preview (still has its blue outline) until they're actually
    // ready, then swap in one frame instead of flashing empty first.
    holdingLocalIds.add(p.localId);
    let remaining = imgs.length, settled = false;
    const finish = () => { if (settled) return; settled = true; finalizePendingSwap(p.localId); };
    imgs.forEach(a => {
      const img = new Image();
      img.onload = img.onerror = () => { if (--remaining <= 0) finish(); };
      img.src = a.url;
    });
    setTimeout(finish, 8000); // safety net if a load/error event never fires
  });
  renderCurrentMessages();
  if (!$('pinned-modal').classList.contains('hidden')) renderPinnedList(msgs.filter(m => m.pinned));
}

// ============================================================
// MOBILE MESSAGE ACTION SHEET — hold down a message (like Discord
// mobile) to bring up a quick-react row plus a list of actions,
// instead of relying on hover icons that don't really work on touch.
// ============================================================
const QUICK_REACT_EMOJIS = REACT_EMOJIS.slice(0, 6);
let openActionSheet = null;
function closeActionSheet() {
  if (!openActionSheet) return;
  openActionSheet.remove();
  openActionSheet = null;
  document.body.classList.remove('action-sheet-open');
}
function openMessageActionSheet(msgId) {
  const m = lastRawMessages.find(x => x.id === msgId);
  if (!m) return;
  closeActionSheet();
  closeReactPopover();

  const canDel = m.uid === myUid;
  const canEditThis = m.uid === myUid && !m.sticker;
  const pinnable = canPin();

  const backdrop = document.createElement('div');
  backdrop.className = 'action-sheet-backdrop';
  backdrop.innerHTML = `
    <div class="action-sheet">
      <div class="as-quick-react">
        ${QUICK_REACT_EMOJIS.map(e => `<button type="button" class="as-quick-emoji" data-e="${e}">${e}</button>`).join('')}
        <button type="button" class="as-quick-emoji as-more-react" title="More reactions">${icon('plus')}</button>
      </div>
      <div class="as-actions">
        ${canEditThis ? `<button type="button" class="as-item" data-act="edit">${icon('edit')}<span>Edit Message</span></button>` : ''}
        <button type="button" class="as-item" data-act="reply">${icon('reply')}<span>Reply</span></button>
        ${m.text ? `<button type="button" class="as-item" data-act="copy">${icon('copy')}<span>Copy Text</span></button>` : ''}
        ${pinnable ? `<button type="button" class="as-item" data-act="pin">${icon('pin')}<span>${m.pinned ? 'Unpin Message' : 'Pin Message'}</span></button>` : ''}
        ${canDel ? `<button type="button" class="as-item as-danger" data-act="delete">${icon('trash')}<span>Delete Message</span></button>` : ''}
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  document.body.classList.add('action-sheet-open');

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeActionSheet(); });
  backdrop.querySelectorAll('.as-quick-emoji[data-e]').forEach(btn => {
    btn.onclick = () => { toggleReaction(msgId, btn.dataset.e); closeActionSheet(); };
  });
  backdrop.querySelector('.as-more-react').onclick = () => {
    closeActionSheet();
    const anchor = document.querySelector(`.msg-line[data-mid="${CSS.escape(msgId)}"] .react-btn`) || backdrop;
    toggleReactPopover(anchor, msgId);
  };
  backdrop.querySelectorAll('.as-item').forEach(btn => {
    btn.onclick = () => {
      const act = btn.dataset.act;
      closeActionSheet();
      if (act === 'edit') startEditMessage(msgId);
      else if (act === 'reply') setReplyTarget(msgId);
      else if (act === 'copy') copyMessageText(m);
      else if (act === 'pin') togglePin(msgId);
      else if (act === 'delete') deleteMessage(msgId);
    };
  });

  openActionSheet = backdrop;
}
// Long-press detection (touch only) — a firm ~450ms hold on a message
// opens the sheet; moving your finger more than a few px cancels it,
// so it doesn't fire while scrolling.
(function setupMessageLongPress() {
  const wrap = $('messages');
  let timer = null, startX = 0, startY = 0, targetId = null;
  const HOLD_MS = 450, MOVE_TOLERANCE = 10;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } targetId = null; };
  wrap.addEventListener('touchstart', (e) => {
    if (!isMobile() || e.touches.length !== 1) return;
    const line = e.target.closest('.msg-line');
    if (!line || !line.dataset.mid) return;
    targetId = line.dataset.mid;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    timer = setTimeout(() => {
      timer = null;
      if (navigator.vibrate) navigator.vibrate(10);
      openMessageActionSheet(targetId);
    }, HOLD_MS);
  }, { passive: true });
  wrap.addEventListener('touchmove', (e) => {
    if (!timer) return;
    const dx = Math.abs(e.touches[0].clientX - startX), dy = Math.abs(e.touches[0].clientY - startY);
    if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) cancel();
  }, { passive: true });
  wrap.addEventListener('touchend', cancel);
  wrap.addEventListener('touchcancel', cancel);
})();

// ============================================================
// MEMBER PANEL
// ============================================================
$('members-toggle').onclick = () => {
  memberListManualOverride = !$('app').classList.contains('member-list-open');
  $('app').classList.toggle('member-list-open', memberListManualOverride);
};

async function renderMemberPanel(members, ownerId) {
  members = members || [];
  await Promise.all(members.map(uid => getProfile(uid)));
  const online = [], offline = [];
  members.forEach(uid => {
    const p = profileCache[uid] || { username: uid, avatarColor: '#5865f2' };
    const disp = computeDisplayStatus(uid);
    (disp !== 'offline' ? online : offline).push({ uid, p, disp });
  });
  $('online-count').textContent = online.length;
  $('offline-count').textContent = offline.length;
  const renderRows = (arr) => arr.map(({ uid, p, disp }) => `
    <div class="member-row" data-u="${esc(uid)}">
      ${avatarHTML(32, p.avatarColor, initials(p.username), disp, p.avatarUrl)}
      <span class="mname${disp !== 'offline' ? ' online-name' : ''}">${esc(p.username)}${premiumStar(p)}${opTag(p)}${ownerCrown(uid, ownerId)}</span>
    </div>`).join('');
  $('member-rows-online').innerHTML = renderRows(online);
  $('member-rows-offline').innerHTML = renderRows(offline);
  $('member-panel').querySelectorAll('.member-row[data-u]').forEach(row => {
    row.onclick = () => openProfileModal(row.dataset.u);
  });
}

// ============================================================
// CHAT VIEW SWITCH
// ============================================================
// Both of these use a short delay before actually showing a spinner —
// if the data arrives before the delay is up (typical, especially from
// Firestore's local cache), nothing ever flashes on screen at all.
let loadingViewTimer = null;
function scheduleLoadingView() {
  clearTimeout(loadingViewTimer);
  loadingViewTimer = setTimeout(showLoadingView, 150);
}
function cancelLoadingView() { clearTimeout(loadingViewTimer); }

let msgLoadTimer = null;
function scheduleMsgLoading() {
  clearTimeout(msgLoadTimer);
  msgLoadTimer = setTimeout(() => {
    $('messages').innerHTML = `<div class="msg-loading"><div class="spinner small"></div></div>`;
  }, 150);
}
function cancelMsgLoading() { clearTimeout(msgLoadTimer); }

function showWelcome() {
  cancelLoadingView();
  hideMainPageViews();
  $('loading-view').classList.add('hidden');
  $('welcome-view').classList.remove('hidden');
  $('chat-view').classList.add('hidden');
  $('chat-header-hash').textContent = '';
  $('chat-header-title').textContent = 'Select a conversation';
  $('members-toggle').classList.add('hidden');
  hideHeaderActions();
}
function showChat() {
  cancelLoadingView();
  hideMainPageViews();
  $('loading-view').classList.add('hidden');
  $('welcome-view').classList.add('hidden');
  $('chat-view').classList.remove('hidden');
}
function showLoadingView() {
  cancelLoadingView();
  hideMainPageViews();
  $('welcome-view').classList.add('hidden');
  $('chat-view').classList.add('hidden');
  $('loading-view').classList.remove('hidden');
  $('members-toggle').classList.add('hidden');
  hideHeaderActions();
  $('chat-header-hash').textContent = '';
  $('chat-header-title').textContent = '';
}

function renderCurrentView() {
  if (currentView === 'channel' || currentView === 'dm' || currentView === 'groupdm') renderCurrentMessages();
  if (currentView === 'channel' && currentServerData) {
    renderMemberPanel(currentServerData.members || [], currentServerData.ownerId);
  } else if (currentView === 'groupdm') {
    const g = (window.__myGroupDMs || []).find(x => x.id === currentGroupDMId);
    if (g) renderMemberPanel(humanParticipants(g.participants), g.ownerId);
  }
  renderDMRows();
}

// ============================================================
// MESSAGES
// ============================================================
function reactionEmojiMarkup(e) {
  const custom = /^:(.+):$/.exec(e);
  if (custom && customEmojis[custom[1]]) {
    return `<img class="reaction-emoji-img" src="${customEmojis[custom[1]].dataUrl}" alt=":${esc(custom[1])}:">`;
  }
  return esc(e);
}
function reactionsHTML(reactions) {
  if (!reactions) return '';
  const entries = Object.entries(reactions).filter(([, arr]) => arr && arr.length);
  if (!entries.length) return '';
  return `<div class="reaction-row">` + entries.map(([e, arr]) =>
    `<button type="button" class="reaction-pill${arr.includes(myUid) ? ' mine' : ''}" data-e="${esc(e)}">${reactionEmojiMarkup(e)}<span>${arr.length}</span></button>`
  ).join('') + `</div>`;
}

function attachmentHTML(m, canDelete) {
  // m.attachments (array) covers new multi-image messages; m.attachment
  // (singular) is kept for backward compatibility with older messages.
  const atts = m.attachments || (m.attachment ? [m.attachment] : []);
  if (atts.length) {
    const gridCls = atts.length > 1 ? ' msg-attachment-grid' : '';
    return `<div class="msg-attachment${gridCls}">` + atts.map((a, i) => {
      const delBtn = canDelete ? `<button type="button" class="msg-att-del" data-attidx="${i}" title="Delete this image">${icon('trash')}</button>` : '';
      return a.type === 'image'
        ? `<div class="msg-att-item"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy">${delBtn}</div>`
        : `<div class="msg-att-item"><a class="msg-file-card" href="${esc(a.url)}" target="_blank" rel="noopener">
            <span class="mfc-icon">${icon('file')}</span>
            <span class="mfc-body"><span class="mfc-name">${esc(a.name)}</span><span class="mfc-size">${esc(humanFileSize(a.size || 0))}</span></span>
          </a>${delBtn}</div>`;
    }).join('') + `</div>`;
  }
  if (m.gifUrl) {
    return `<div class="msg-attachment"><img src="${esc(m.gifUrl)}" alt="GIF" loading="lazy"></div>`;
  }
  return '';
}

// ---------- polls (the message-card side — creation is up near the composer) ----------
function pollExpiresAtMs(poll) {
  return poll.expiresAt && typeof poll.expiresAt.toMillis === 'function' ? poll.expiresAt.toMillis() : (poll.expiresAt || 0);
}
function pollTimeLeft(expiresAtMs) {
  const ms = expiresAtMs - Date.now();
  if (ms <= 0) return 'Final results';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} left`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} left`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} left`;
}
// A poll answer's emoji is either a plain unicode character or a custom
// emoji shortcode (":name:") picked from the real emoji picker — render
// either the same way messages do.
function emojiTokenHTML(token) {
  if (!token) return '';
  const m = /^:([a-z0-9_]+):$/i.exec(token);
  if (m && customEmojis[m[1].toLowerCase()]) {
    const ce = customEmojis[m[1].toLowerCase()];
    return `<img class="custom-emoji" src="${esc(ce.dataUrl)}" alt=":${esc(ce.name)}:" title=":${esc(ce.name)}:">`;
  }
  return esc(token);
}
function pollHTML(m) {
  const poll = m.poll;
  if (!poll) return '';
  // A vote you just cast is applied here immediately, before the transaction
  // that actually records it comes back — see togglePollVote.
  const votes = optimisticPollVotes[m.id] || poll.votes || {};
  const counts = poll.answers.map((_, i) => Object.values(votes).filter(arr => Array.isArray(arr) && arr.includes(i)).length);
  const totalVoters = Object.keys(votes).length;
  const totalVotes = counts.reduce((a, b) => a + b, 0);
  const myVotes = votes[myUid] || [];
  const expiresAtMs = pollExpiresAtMs(poll);
  const expired = Date.now() >= expiresAtMs;
  const topCount = expired && totalVotes > 0 ? Math.max(...counts) : -1;

  const rows = poll.answers.map((ans, i) => {
    const c = counts[i];
    const pct = totalVotes ? Math.round((c / totalVotes) * 100) : 0;
    const mine = myVotes.includes(i);
    const isWinner = expired && totalVotes > 0 && c === topCount;
    return `<button type="button" class="poll-option${mine ? ' voted' : ''}${expired ? ' locked' : ''}${isWinner ? ' winning' : ''}" data-idx="${i}"${expired ? ' disabled' : ''}>
      <span class="poll-option-fill" style="width:${pct}%"></span>
      <span class="poll-option-main">
        <span class="poll-option-check"></span>
        <span class="poll-option-text">${ans.emoji ? `<span class="poll-option-emoji">${emojiTokenHTML(ans.emoji)}</span>` : ''}${esc(ans.text)}</span>
      </span>
      <span class="poll-option-pct">${totalVotes ? pct + '%' : ''}</span>
    </button>`;
  }).join('');

  const footerLeft = `${totalVoters} vote${totalVoters === 1 ? '' : 's'} • ${pollTimeLeft(expiresAtMs)}`;
  return `<div class="poll-card" data-mid="${esc(m.id)}">
    <div class="poll-card-question">${icon('poll')}<span>${esc(poll.question)}</span></div>
    <div class="poll-options">${rows}</div>
    <div class="poll-card-footer"><span>${footerLeft}</span>${poll.allowMultiple ? '<span class="poll-multi-tag">Pick one or more</span>' : ''}</div>
  </div>`;
}
// Votes go through a transaction (see below) so two people voting at once
// can't stomp on each other — but transactions get zero help from
// Firestore's local-write echo, so without this a vote would sit there
// doing nothing until the round trip finishes. optimisticPollVotes
// applies your own vote to the render immediately; pollHTML reads it
// ahead of the real poll.votes, and it's cleared once the transaction
// settles (the real data will have caught up by then either way).
let optimisticPollVotes = {};
function computeToggledVotes(baseVotes, allowMultiple, uid, idx) {
  const votes = { ...baseVotes };
  let mine = Array.isArray(votes[uid]) ? [...votes[uid]] : [];
  if (allowMultiple) {
    mine = mine.includes(idx) ? mine.filter(i => i !== idx) : [...mine, idx];
  } else {
    mine = (mine.length === 1 && mine[0] === idx) ? [] : [idx];
  }
  if (mine.length) votes[uid] = mine; else delete votes[uid];
  return votes;
}
function togglePollVote(msgId, idx) {
  if (currentView !== 'channel' && currentView !== 'dm' && currentView !== 'groupdm') return;
  const ref = msgRef(msgId);
  if (!ref) return;
  const m = lastRawMessages.find(x => x.id === msgId);
  if (!m || !m.poll) return;
  if (Date.now() >= pollExpiresAtMs(m.poll)) return; // voting closed, no-op
  const baseVotes = optimisticPollVotes[msgId] || m.poll.votes || {};
  optimisticPollVotes[msgId] = computeToggledVotes(baseVotes, m.poll.allowMultiple, myUid, idx);
  renderCurrentMessages();
  db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data();
    const poll = data.poll;
    if (!poll) return;
    if (Date.now() >= pollExpiresAtMs(poll)) return; // voting closed, no-op
    tx.update(ref, { 'poll.votes': computeToggledVotes(poll.votes || {}, poll.allowMultiple, myUid, idx) });
  }).catch(() => toast('Could not update your vote.', 'error'))
    .finally(() => {
      delete optimisticPollVotes[msgId];
      renderCurrentMessages();
    });
}

// Reply preview row: a small avatar of who's being replied to, plus a
// short "hook" line above it suggesting it's connected to something
// above — decorative rather than literally tracing to wherever that
// message happens to be, same as Discord's own reply connector.
function replyRefHTML(replyTo) {
  const rp = profileCache[replyTo.uid] || { username: replyTo.username, avatarColor: '#5865f2', avatarUrl: null };
  return `<div class="msg-reply-ref" data-jump="${esc(replyTo.id)}">
    <span class="msg-reply-line"></span>
    ${avatarHTML(16, rp.avatarColor, initials(rp.username), null, rp.avatarUrl)}
    <span class="mrr-user">${esc(replyTo.username)}</span>
    <span class="mrr-text">${esc(replyTo.text || '')}</span>
  </div>`;
}
function purgeConfirmHTML(m) {
  const n = m.purgeCount || 0;
  return `<div class="purge-confirm-embed">
    <span class="pce-check">${icon('check')}</span>
    <span class="pce-text">Deleted <b>${n}</b> message${n === 1 ? '' : 's'}</span>
  </div>`;
}
function buildMessageLineEl(m, canDelete) {
  if (m.localOnly) canDelete = false; // no real doc yet — nothing to act on
  if (m.type === 'purge-confirm') canDelete = false; // system-style bot message — nothing to act on
  const pinnable = canPin() && !m.localOnly && m.type !== 'purge-confirm';
  const canEditThis = m.uid === myUid && !m.sticker && !m.poll && !m.localOnly;
  const line = document.createElement('div');
  // Blue = sent from here but not yet confirmed by the server for
  // everyone else to see — either a genuine Firestore local echo
  // (hasPendingWrites) or one of ours still uploading (localOnly).
  line.className = 'msg-line' + (m.pinned ? ' is-pinned' : '') + ((m.pendingWrite || m.localOnly) ? ' is-pending' : '');
  line.dataset.mid = m.id;
  const rowWrap = document.createElement('div');
  rowWrap.className = 'msg-row-wrap' + (m.sticker ? ' is-sticker' : '');

  const replyHTML = m.replyTo ? replyRefHTML(m.replyTo) : '';

  const bodyHTML = replyHTML + (m.sticker
    ? `<img class="msg-sticker" src="${esc(m.sticker.dataUrl)}" alt="${esc(m.sticker.name)}" title="${esc(m.sticker.name)}">`
    : m.poll
    ? pollHTML(m)
    : m.type === 'purge-confirm'
    ? purgeConfirmHTML(m)
    : (m.text ? `<span class="msg-text">${renderMessageText(m.text)}</span>${m.edited ? `<span class="edited-tag">(edited)</span>` : ''}` : '') +
      attachmentHTML(m, canDelete));

  rowWrap.innerHTML = bodyHTML + ((m.localOnly || m.type === 'purge-confirm') ? '' :
    `<span class="msg-hover-actions">` +
    `<span class="hover-icon-btn react-btn" title="Add Reaction">${icon('smiley')}</span>` +
    `<span class="hover-icon-btn reply-msg" title="Reply">${icon('reply')}</span>` +
    (canEditThis ? `<span class="hover-icon-btn edit-msg" title="Edit">${icon('edit')}</span>` : '') +
    (pinnable ? `<span class="hover-icon-btn pin-msg${m.pinned ? ' on' : ''}" title="${m.pinned ? 'Unpin' : 'Pin Message'}">${icon('pin')}</span>` : '') +
    (canDelete ? `<span class="hover-icon-btn del-msg" title="Delete">${icon('trash')}</span>` : '') +
    `</span>`);
  if (!m.localOnly && m.type !== 'purge-confirm') {
    rowWrap.querySelector('.react-btn').onclick = (e) => { e.stopPropagation(); toggleReactPopover(e.currentTarget, m.id); };
    rowWrap.querySelector('.reply-msg').onclick = () => setReplyTarget(m.id);
    if (canEditThis) rowWrap.querySelector('.edit-msg').onclick = () => startEditMessage(m.id);
    if (pinnable) rowWrap.querySelector('.pin-msg').onclick = () => togglePin(m.id);
    if (canDelete) rowWrap.querySelector('.del-msg').onclick = () => deleteMessage(m.id);
  }
  rowWrap.querySelectorAll('.msg-att-del').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); deleteMessageAttachment(m.id, parseInt(btn.dataset.attidx, 10)); };
  });
  const replyRefEl = rowWrap.querySelector('.msg-reply-ref');
  if (replyRefEl) replyRefEl.onclick = () => jumpToMessage(replyRefEl.dataset.jump);
  if (m.poll) {
    rowWrap.querySelectorAll('.poll-option').forEach(btn => {
      btn.onclick = () => togglePollVote(m.id, parseInt(btn.dataset.idx, 10));
    });
  }
  if (m.id === editingMessageId) buildEditBoxInto(rowWrap, m);
  line.appendChild(rowWrap);

  const rx = reactionsHTML(m.reactions);
  if (rx) {
    const tmp = document.createElement('div');
    tmp.innerHTML = rx;
    const rxEl = tmp.firstElementChild;
    rxEl.querySelectorAll('.reaction-pill').forEach(btn => { btn.onclick = () => toggleReaction(m.id, btn.dataset.e); });
    line.appendChild(rxEl);
  }
  return line;
}
function jumpToMessage(id) {
  const el = document.querySelector(`.msg-line[data-mid="${CSS.escape(id)}"]`);
  if (!el) { toast('Original message isn\'t loaded here.'); return; }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash-highlight');
  setTimeout(() => el.classList.remove('flash-highlight'), 1200);
}

async function renderMessages(rawMsgs) {
  const searching = searchActive;
  const q = searching ? ($('search-input').value || '').trim().toLowerCase() : '';
  const msgs = q ? rawMsgs.filter(m => `${m.text || ''} ${m.poll ? m.poll.question : ''}`.toLowerCase().includes(q)) : rawMsgs;
  if (searching) $('search-count').textContent = q ? `${msgs.length} result${msgs.length === 1 ? '' : 's'}` : '';

  const uids = [...new Set(msgs.flatMap(m => m.replyTo ? [m.uid, m.replyTo.uid] : [m.uid]))];
  await Promise.all(uids.map(u => getProfile(u)));
  const wrap = $('messages');
  const wasAtBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;
  wrap.innerHTML = '';

  if (searching && q && !msgs.length) {
    wrap.innerHTML = '<div class="empty" style="padding:20px 16px;">No messages match your search.</div>';
    return;
  }

  if (!searching && !msgs.length) {
    const name = currentView === 'channel' ? `#${$('chat-header-title').textContent}` : $('chat-header-title').textContent;
    wrap.innerHTML = `
      <div class="convo-start">
        <span class="convo-start-icon">${currentView === 'channel' ? '#' : icon('people')}</span>
        <h2>Welcome to ${esc(name)}!</h2>
        <p>${currentView === 'channel' ? 'This is the start of the channel.' : 'This is the beginning of your conversation.'}</p>
      </div>`;
    return;
  }

  let lastUid = null, lastMillis = 0, lastDay = null, groupEl = null;

  msgs.forEach(m => {
    const millis = m.createdAt && m.createdAt.toMillis ? m.createdAt.toMillis() : Date.now();
    // dayStr() always formats a real date (e.g. "September 2, 2026") — it never
    // returns the word "Today". A message you just sent has no createdAt yet
    // (pending server timestamp), so falling back to the literal word "Today"
    // created a mismatched, brand-new divider that merged once the real
    // timestamp arrived. Fall back to today's *formatted* date instead so it
    // matches the divider your other messages from today are already under.
    const day = dayStr(m.createdAt) || dayStr(new Date(millis));
    if (day !== lastDay) {
      const div = document.createElement('div');
      div.className = 'day-divider';
      div.textContent = day;
      wrap.appendChild(div);
      lastDay = day; lastUid = null;
    }
    const p = profileCache[m.uid] || { username: m.username || 'Unknown User', avatarColor: '#5865f2' };
    // A reply always starts its own group (with its own avatar/username
    // row) even if the same author just posted — same as the screenshot:
    // grouping it invisibly into the message above would hide who's
    // actually doing the replying.
    const sameGroup = !searching && !m.replyTo && m.uid === lastUid && (millis - lastMillis) < 5 * 60 * 1000;
    const canDelete = m.uid === myUid;

    if (sameGroup && groupEl) {
      groupEl.querySelector('.msg-body').appendChild(buildMessageLineEl(m, canDelete));
    } else {
      groupEl = document.createElement('div');
      groupEl.className = 'msg-group';
      groupEl.dataset.uid = m.uid;
      const body = document.createElement('div');
      body.className = 'msg-body';
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      meta.innerHTML = `<span class="author${m.uid === myUid ? ' own' : ''}">${esc(p.username)}${premiumStar(p)}${opTag(p)}${appTag(p)}</span><span class="time">${timeStr(m.createdAt)}</span>`;
      body.appendChild(meta);
      body.appendChild(buildMessageLineEl(m, canDelete));
      groupEl.innerHTML = avatarHTML(40, p.avatarColor, initials(p.username), null, p.avatarUrl);
      groupEl.appendChild(body);
      wrap.appendChild(groupEl);
    }
    lastUid = m.uid; lastMillis = millis;
  });

  if (!searching && (wasAtBottom || msgs.length <= 20)) wrap.scrollTop = wrap.scrollHeight;
}

// ---------- reaction popover (full emoji picker: standard + custom) ----------
let openReactPopover = null;
function toggleReactPopover(anchorEl, msgId) {
  closeReactPopover();
  const pop = document.createElement('div');
  pop.className = 'react-popover full-react-popover';
  pop.innerHTML = `
    <div class="ep-search"><input type="text" class="rp-search" placeholder="Search emoji"></div>
    <div class="ep-cats rp-cats"></div>
    <div class="ep-scroll">
      <div class="ep-section-label">Custom</div>
      <div class="ep-grid rp-custom-grid"></div>
      <div class="rp-standard-sections"></div>
    </div>`;
  document.body.appendChild(pop);

  const r = anchorEl.getBoundingClientRect();
  const pw = 320, ph = Math.min(360, window.innerHeight - 16);
  pop.style.width = pw + 'px';
  pop.style.maxHeight = ph + 'px';
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8)) + 'px';
  pop.style.top = Math.max(8, Math.min(r.top - ph - 8, window.innerHeight - ph - 8)) + 'px';

  const doReact = (emojiKey) => { toggleReaction(msgId, emojiKey); closeReactPopover(); };

  function renderGrids(q) {
    q = (q || '').toLowerCase();
    const customNames = Object.keys(customEmojis).filter(n => !q || n.includes(q)).sort();
    const customWrap = pop.querySelector('.rp-custom-grid');
    customWrap.innerHTML = customNames.length
      ? customNames.map(n => `<button type="button" title=":${esc(n)}:"><img src="${customEmojis[n].dataUrl}" alt=":${esc(n)}:"></button>`).join('')
      : '<div class="ep-empty">No custom emoji yet</div>';
    customWrap.querySelectorAll('button').forEach((btn, i) => { btn.onclick = () => doReact(`:${customNames[i]}:`); });

    const sectionsWrap = pop.querySelector('.rp-standard-sections');
    sectionsWrap.innerHTML = EMOJI_CATEGORIES.map(cat => {
      const names = Object.keys(cat.items).filter(n => !q || n.includes(q));
      if (!names.length) return '';
      return `<div class="ep-section-label" id="rp-sec-${cat.key}">${esc(cat.label)}</div>
        <div class="ep-grid">${names.map(n => `<button type="button" title=":${esc(n)}:">${cat.items[n]}</button>`).join('')}</div>`;
    }).join('') || '<div class="ep-empty">No emoji match "' + esc(q) + '"</div>';
    sectionsWrap.querySelectorAll('button').forEach(btn => { btn.onclick = () => doReact(btn.textContent); });
  }

  pop.querySelector('.rp-cats').innerHTML = EMOJI_CATEGORIES.map(cat => `<button type="button" class="ep-cat-btn" data-cat="${cat.key}" title="${esc(cat.label)}">${cat.icon}</button>`).join('');
  pop.querySelectorAll('.rp-cats .ep-cat-btn').forEach(btn => {
    btn.onclick = () => { const t = pop.querySelector('#rp-sec-' + btn.dataset.cat); if (t) t.scrollIntoView({ block: 'start' }); };
  });
  const searchInput = pop.querySelector('.rp-search');
  searchInput.addEventListener('input', () => renderGrids(searchInput.value));
  renderGrids('');
  setTimeout(() => searchInput.focus(), 0);

  openReactPopover = pop;
  setTimeout(() => document.addEventListener('click', outsideReactClose), 0);
}
function outsideReactClose(e) { if (openReactPopover && !openReactPopover.contains(e.target)) closeReactPopover(); }
function closeReactPopover() {
  if (openReactPopover) { openReactPopover.remove(); openReactPopover = null; document.removeEventListener('click', outsideReactClose); }
}

async function toggleReaction(msgId, emoji) {
  if (currentView !== 'channel' && currentView !== 'dm' && currentView !== 'groupdm') return;
  const ref = msgRef(msgId);
  const msg = lastRawMessages.find(m => m.id === msgId);
  const already = !!(msg && msg.reactions && (msg.reactions[emoji] || []).includes(myUid));
  try {
    await ref.update({ [`reactions.${emoji}`]: already ? FieldValue.arrayRemove(myUid) : FieldValue.arrayUnion(myUid) });
    if (!already) db.collection('users').doc(myUid).update({
      'stats.reactionsGiven': FieldValue.increment(1),
      'dailyStats.reactionsGiven': FieldValue.increment(1),
    }).catch(() => {});
  } catch (e) { toast('Could not react.', 'error'); }
}

// Text and images now delete independently: the message-level trash icon
// only clears the text if the message also carries an image/file (the
// attachment stays); the per-image trash icon (see attachmentHTML) only
// drops that one attachment and leaves the text alone. A message with
// only one or the other still deletes outright — nothing would be left.
async function deleteMessage(id) {
  try {
    const ref = msgRef(id);
    if (!ref) return;
    const snap = await ref.get();
    const data = snap.data();
    const hasAttachment = !!(data && ((data.attachments && data.attachments.length) || data.attachment));
    if (hasAttachment && data.text && data.text.trim()) {
      await ref.update({ text: '', edited: false });
    } else {
      await ref.delete();
    }
  } catch (e) { toast('Could not delete message.', 'error'); }
}
async function deleteMessageAttachment(id, idx) {
  try {
    const ref = msgRef(id);
    if (!ref) return;
    const snap = await ref.get();
    const data = snap.data();
    if (!data) return;
    const atts = (data.attachments || (data.attachment ? [data.attachment] : [])).slice();
    if (idx < 0 || idx >= atts.length) return;
    atts.splice(idx, 1);
    if (!atts.length && !(data.text && data.text.trim())) {
      await ref.delete();
    } else {
      await ref.update({ attachments: atts, attachment: FieldValue.delete() });
    }
  } catch (e) { toast('Could not delete image.', 'error'); }
}

// ---------- editing (own messages only) ----------
let editingMessageId = null; // message currently being edited, if any
let editingDraft = '';       // its in-progress text — survives a re-render triggered by unrelated activity (a new message, a reaction, a poll vote) arriving while the user is mid-edit
function buildEditBoxInto(rowWrap, m) {
  const textSpan = rowWrap.querySelector('.msg-text');
  const editedTag = rowWrap.querySelector('.edited-tag');
  const box = document.createElement('div');
  box.className = 'msg-edit-box';
  box.innerHTML = `<textarea class="msg-edit-input" rows="1"></textarea>
    <div class="msg-edit-hint">escape to <a class="med-cancel">cancel</a> &bull; enter to <a class="med-save">save</a></div>`;
  if (textSpan) textSpan.replaceWith(box); else rowWrap.insertBefore(box, rowWrap.firstChild);
  if (editedTag) editedTag.remove();

  const ta = box.querySelector('.msg-edit-input');
  ta.value = editingDraft;
  autoResize(ta);
  ta.addEventListener('input', () => { editingDraft = ta.value; autoResize(ta); });

  const finish = async (save) => {
    if (save) {
      const newText = applyMessageFilter(ta.value.trim());
      if (!newText) { toast('Message can\'t be empty — delete it instead if you want it gone.'); return; }
      if (newText !== (m.text || '')) {
        try { await msgRef(m.id).update({ text: newText, edited: true }); }
        catch (e) { toast('Could not save edit.', 'error'); return; }
      }
    }
    editingMessageId = null;
    editingDraft = '';
    if (isMobile() && useCustomKeyboard()) hideCustomKeyboard();
    renderCurrentMessages();
  };

  if (isMobile() && useCustomKeyboard()) {
    ta.selectionStart = ta.selectionEnd = ta.value.length;
    ta.readOnly = true;
    // A silent rebuild mid-edit (renderMessages fired for some unrelated
    // reason while this same message was still being edited) replaces this
    // textarea with a fresh one. If the keyboard's already open and driving
    // this exact edit, just repoint it at the new element instead of
    // reopening — reopening would reset shift/caps-lock and the current page.
    if (ckField && editingMessageId === m.id && !$('custom-keyboard').classList.contains('hidden')) {
      ckField.el = ta;
      ckField.onEnter = () => finish(true);
      positionCkCursor();
    } else {
      showCustomKeyboardFor(ta, { onEnter: () => finish(true), multiline: true });
    }
    // Unlike the composer/search boxes, this element doesn't live for the
    // life of the page — it's rebuilt per edit — so it needs its own
    // click-to-reopen wiring rather than the one-time setup those get.
    // Covers tapping back into the field after the keyboard was dismissed
    // by a tap elsewhere (e.g. on the message row outside the edit box).
    ta.addEventListener('click', () => {
      if (useCustomKeyboard() && (!ckField || ckField.el !== ta)) showCustomKeyboardFor(ta, { onEnter: () => finish(true), multiline: true });
    });
  } else {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  }
  box.querySelector('.med-save').onclick = () => finish(true);
  box.querySelector('.med-cancel').onclick = () => finish(false);
}
function startEditMessage(msgId) {
  const m = lastRawMessages.find(x => x.id === msgId);
  if (!m || m.uid !== myUid) return; // only your own messages, ever
  const line = document.querySelector(`.msg-line[data-mid="${CSS.escape(msgId)}"]`);
  const rowWrap = line && line.querySelector('.msg-row-wrap');
  if (!rowWrap || rowWrap.querySelector('.msg-edit-box')) return;
  closeActionSheet();
  editingMessageId = msgId;
  editingDraft = m.text || '';
  buildEditBoxInto(rowWrap, m);
}

async function copyMessageText(m) {
  try {
    await navigator.clipboard.writeText(m.text || '');
    toast('Copied.');
  } catch (e) { toast('Could not copy — your browser blocked clipboard access.', 'error'); }
}

// ---------- replying ----------
let replyTarget = null;
function setReplyTarget(msgId) {
  const m = lastRawMessages.find(x => x.id === msgId);
  if (!m) return;
  closeActionSheet();
  const uname = (profileCache[m.uid] && profileCache[m.uid].username) || m.username || 'Unknown User';
  const atts = m.attachments || (m.attachment ? [m.attachment] : []);
  const preview = m.sticker ? `Sent a sticker: ${m.sticker.name}` : m.gifUrl ? 'Sent a GIF' :
    m.poll ? `📊 Poll: ${m.poll.question}` :
    atts.length > 1 ? `Sent ${atts.length} files` : atts.length ? `Sent a file: ${atts[0].name || ''}` : (m.text || '');
  replyTarget = { id: m.id, uid: m.uid, username: uname, text: preview.slice(0, 150) };
  $('reply-bar-username').textContent = uname;
  $('reply-bar').classList.remove('hidden');
  if (isMobile() && useCustomKeyboard()) showCustomKeyboard(); else $('composer-input').focus();
}
function clearReplyTarget() {
  replyTarget = null;
  $('reply-bar').classList.add('hidden');
  clearDraftAttachments();
  closeMentionPopup();
}
$('reply-bar-close').onclick = clearReplyTarget;

// ============================================================
// POLLS — create modal, dynamic answer rows, and the emoji picker
// used per answer. Poll *messages* (the interactive card that shows
// up in chat, and voting) live further down near message rendering.
// ============================================================
const ALL_EMOJI_FLAT = EMOJI_CATEGORIES.flatMap(cat => Object.values(cat.items));

function pollAnswerRowHTML() {
  return `<div class="poll-answer-row">
    <button type="button" class="poll-answer-emoji-btn" title="Add an emoji">${icon('smiley')}</button>
    <input type="text" class="poll-answer-input" maxlength="55" placeholder="Type your answer">
    <button type="button" class="poll-answer-remove" title="Remove this answer">${icon('trash')}</button>
  </div>`;
}

function wirePollAnswerRows() {
  const wrap = $('poll-answer-list');
  const rows = [...wrap.querySelectorAll('.poll-answer-row')];
  rows.forEach((row, i) => {
    const removeBtn = row.querySelector('.poll-answer-remove');
    removeBtn.classList.toggle('hidden', rows.length <= 2);
    removeBtn.onclick = () => { row.remove(); wirePollAnswerRows(); updatePollAddButtonState(); };
    const emojiBtn = row.querySelector('.poll-answer-emoji-btn');
    emojiBtn.onclick = (e) => { e.stopPropagation(); openPollEmojiPicker(row, emojiBtn); };
    const input = row.querySelector('.poll-answer-input');
    if (!input.dataset.wired) {
      input.dataset.wired = '1';
      // Discord's own poll composer auto-adds a new empty answer field the
      // moment you start typing in the last one, so you never have to reach
      // for "+ Add another answer" mid-flow — mirror that here.
      input.addEventListener('input', () => {
        const allRows = [...wrap.querySelectorAll('.poll-answer-row')];
        const isLast = row === allRows[allRows.length - 1];
        if (isLast && input.value.trim() && allRows.length < 10) addPollAnswerRow();
      });
    }
  });
}

function addPollAnswerRow() {
  const wrap = $('poll-answer-list');
  if (wrap.querySelectorAll('.poll-answer-row').length >= 10) return;
  wrap.insertAdjacentHTML('beforeend', pollAnswerRowHTML());
  wirePollAnswerRows();
  updatePollAddButtonState();
}

function updatePollAddButtonState() {
  const count = $('poll-answer-list').querySelectorAll('.poll-answer-row').length;
  $('poll-add-answer').classList.toggle('hidden', count >= 10);
}

function openPollEmojiPicker(row, btn) {
  emojiPickerTarget = { type: 'poll', row, btn };
  const panel = $('emoji-picker-panel');
  $('sticker-picker-panel').classList.add('hidden');
  $('gif-picker-panel').classList.add('hidden');
  $('composer-action-menu').classList.add('hidden');
  panel.classList.add('ep-anchored');
  const r = btn.getBoundingClientRect();
  const popW = 340, popH = 320;
  let left = Math.min(r.left, window.innerWidth - popW - 8);
  left = Math.max(8, left);
  let top = r.bottom + 6;
  if (top + popH > window.innerHeight - 8) top = Math.max(8, r.top - popH - 6);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.classList.remove('hidden');
  $('emoji-search').value = '';
  renderEmojiPickerGrids();
}
function closePollEmojiPicker() { closeEmojiPickerPanel(); }

function resetPollModal() {
  $('poll-question').value = '';
  $('poll-question-count').textContent = '0/300';
  $('poll-answer-list').innerHTML = '';
  addPollAnswerRow();
  addPollAnswerRow();
  $('poll-duration').value = '86400000';
  $('poll-multiple').checked = false;
  closePollEmojiPicker();
}

function openPollModal(prefillText) {
  if (currentView !== 'channel' && currentView !== 'dm' && currentView !== 'groupdm') { toast('Pick a conversation first.'); return; }
  resetPollModal();
  // Remembered so submitPoll() can send this alongside the poll and link
  // the two together — cleared on cancel (see the data-close handler
  // below) so it can't leak into some unrelated poll made later via the
  // "+" menu.
  pollLinkedText = prefillText || null;
  if (prefillText) {
    $('poll-question').value = prefillText.slice(0, 300);
    $('poll-question-count').textContent = `${$('poll-question').value.length}/300`;
  }
  openModal('poll-modal');
  setTimeout(() => $('poll-question').focus(), 50);
}

$('poll-add-answer').onclick = addPollAnswerRow;
$('poll-question').addEventListener('input', () => {
  $('poll-question-count').textContent = `${$('poll-question').value.length}/300`;
});

let pollLinkedText = null;
async function submitPoll() {
  const question = $('poll-question').value.trim();
  if (!question) { toast('Please enter a poll question.', 'error'); return; }
  const answers = [...$('poll-answer-list').querySelectorAll('.poll-answer-row')]
    .map(row => ({ text: row.querySelector('.poll-answer-input').value.trim(), emoji: row.dataset.emoji || null }))
    .filter(a => a.text);
  if (answers.length < 2) { toast('Add at least 2 answers.', 'error'); return; }
  if (currentView !== 'channel' && currentView !== 'dm' && currentView !== 'groupdm') { toast('Pick a conversation first.'); return; }
  const durationMs = parseInt($('poll-duration').value, 10) || 86400000;
  const allowMultiple = $('poll-multiple').checked;
  const pollPayload = {
    uid: myUid, username: myProfile.username, createdAt: FieldValue.serverTimestamp(),
    type: 'poll',
    poll: {
      question, answers, allowMultiple,
      expiresAt: firebase.firestore.Timestamp.fromMillis(Date.now() + durationMs),
      votes: {},
    },
  };
  const linkedText = pollLinkedText;
  pollLinkedText = null;
  // Close right away — the write itself (and Firestore's local echo of
  // it) happens in the background; no reason to hold the modal open
  // waiting on the round trip.
  closeModal('poll-modal');
  if ($('composer-input').value.trim().toLowerCase().startsWith('/poll')) {
    $('composer-input').value = '';
    autoResize($('composer-input'));
    updateComposerCharCount();
  }
  toast('Poll posted.');
  (async () => {
    try {
      // Whatever text came after "/poll" gets sent as its own real
      // message first — instead of being silently discarded — and the
      // poll links back to it exactly the way a reply links to what it's
      // answering, so the two show up visually connected.
      if (linkedText) {
        const textRef = await sendToCurrentConversation({
          text: applyMessageFilter(linkedText), uid: myUid, username: myProfile.username, createdAt: FieldValue.serverTimestamp(),
        });
        pollPayload.replyTo = { id: textRef.id, uid: myUid, username: myProfile.username, text: linkedText };
      }
      await sendToCurrentConversation(pollPayload);
    } catch (e) {
      toast(e.message || 'Could not post the poll.', 'error');
    }
  })();
}
$('poll-submit').onclick = submitPoll;
// Closing the poll modal (X or Cancel) while its emoji picker is open
// shouldn't leave that panel floating over the chat behind it. Also drops
// any linked "/poll <text>" so it can't attach itself to a later poll.
document.querySelectorAll('#poll-modal [data-close="poll-modal"]').forEach(el => {
  el.addEventListener('click', () => { closeEmojiPickerPanel(); pollLinkedText = null; });
});

async function sendToCurrentConversation(payload) {
  // Returns the new message's doc ref (needed to link a poll or a purge
  // confirmation back to the message they belong to). Stats/preview text
  // are attributed to payload.uid/username rather than hardcoded to
  // myUid — this used to always credit the logged-in user even when
  // Sapphire was the one actually posting, which would have inflated the
  // admin's own message stats every time the bot spoke.
  let ref;
  if (currentView === 'channel') {
    ref = await db.collection('servers').doc(currentServerId).collection('channels').doc(currentChannelId).collection('messages').add(payload);
    if (payload.uid === myUid) db.collection('users').doc(myUid).update({ 'dailyStats.channelsMessaged': FieldValue.increment(1) }).catch(() => {});
  } else if (currentView === 'dm') {
    ref = await db.collection('dms').doc(currentDMId).collection('messages').add(payload);
    await db.collection('dms').doc(currentDMId).update({
      updatedAt: FieldValue.serverTimestamp(),
      lastMessage: { text: previewForMessage(payload), username: payload.username },
    });
    if (payload.uid === myUid) db.collection('users').doc(myUid).update({ 'dailyStats.dmsMessaged': FieldValue.increment(1) }).catch(() => {});
  } else if (currentView === 'groupdm') {
    ref = await db.collection('groupDMs').doc(currentGroupDMId).collection('messages').add(payload);
    await db.collection('groupDMs').doc(currentGroupDMId).update({
      updatedAt: FieldValue.serverTimestamp(),
      lastMessage: { text: previewForMessage(payload), username: payload.username },
    });
    if (payload.uid === myUid) db.collection('users').doc(myUid).update({ 'dailyStats.dmsMessaged': FieldValue.increment(1) }).catch(() => {});
  } else {
    throw new Error('No conversation selected.');
  }
  if (payload.uid === myUid) {
    db.collection('users').doc(myUid).update({
      'stats.messagesSent': FieldValue.increment(1),
      'dailyStats.messagesSent': FieldValue.increment(1),
    }).catch(() => {});
  }
  return ref;
}

async function sendMessage() {
  const input = $('composer-input');
  const raw = input.value.trim().slice(0, composerCharLimit()); // defense-in-depth; typing is already capped as you go
  const pendingAttachments = draftAttachments.slice();
  // "/poll" alone opens the poll composer empty, same as always. "/poll
  // <question>" opens it pre-filled with that question (autofill) — the
  // text isn't discarded either way; if a poll actually gets posted,
  // submitPoll() sends it as its own message linked to the poll.
  const pollMatch = !pendingAttachments.length ? /^\/poll(?:\s+([\s\S]+))?$/i.exec(raw) : null;
  if (pollMatch) {
    if (currentView !== 'channel' && currentView !== 'dm' && currentView !== 'groupdm') { toast('Pick a conversation first.'); return; }
    closeSlashPopup();
    openPollModal((pollMatch[1] || '').trim());
    return;
  }
  if (!pendingAttachments.length && /^\/purge$/i.test(raw)) {
    if (!isAdmin) { toast('Only admins can use /purge.', 'error'); return; }
    if (currentView !== 'channel' && currentView !== 'dm' && currentView !== 'groupdm') { toast('Pick a conversation first.'); return; }
    input.value = '';
    autoResize(input);
    updateComposerCharCount();
    closeMentionPopup();
    closeSlashPopup();
    runPurgeCommand();
    return;
  }
  if (!raw && !pendingAttachments.length) return;
  if (currentView !== 'channel' && currentView !== 'dm' && currentView !== 'groupdm') { toast('Pick a conversation first.'); return; }
  input.value = '';
  autoResize(input);
  updateComposerCharCount();
  closeMentionPopup();
  closeSlashPopup();
  draftAttachments = [];
  renderAttachmentDraft();
  const text = raw ? applyMessageFilter(raw) : '';
  const payload = { text, uid: myUid, username: myProfile.username, createdAt: FieldValue.serverTimestamp() };
  if (replyTarget) payload.replyTo = { id: replyTarget.id, uid: replyTarget.uid, username: replyTarget.username, text: replyTarget.text };
  clearReplyTarget();

  if (!pendingAttachments.length) {
    // Nothing to upload — Firestore already echoes a write to your own
    // client instantly (see the is-pending styling driven by
    // hasPendingWrites), so there's nothing to wait on here.
    sendToCurrentConversation(payload).catch(e => toast(e.message || 'Failed to send message.', 'error'));
    return;
  }

  // Has attachments: the real bottleneck was always the upload, not
  // Firestore — so show the image(s) right away from the local file
  // (blue outline = not confirmed on other clients yet) and swap in the
  // real message once the upload and write finish in the background.
  const localId = 'local_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const previewAttachments = pendingAttachments.map(d => ({ url: d.previewUrl, type: d.type, name: d.file.name, size: d.file.size }));
  addPendingMessage(localId, payload, previewAttachments);
  try {
    const uploaded = [];
    for (const d of pendingAttachments) {
      const url = await uploadFileGeneric(d.file, d.type === 'image');
      uploaded.push({ url, type: d.type, name: d.file.name, size: d.file.size });
    }
    payload.attachments = uploaded;
    payload.localId = localId;
    await sendToCurrentConversation(payload);
  } catch (e) {
    removePendingMessage(localId);
    toast(e.message || 'Failed to send message.', 'error');
  }
}

// ---- /purge (admin-only) ----
function currentMessagesRef() {
  if (currentView === 'channel') return db.collection('servers').doc(currentServerId).collection('channels').doc(currentChannelId).collection('messages');
  if (currentView === 'dm') return db.collection('dms').doc(currentDMId).collection('messages');
  if (currentView === 'groupdm') return db.collection('groupDMs').doc(currentGroupDMId).collection('messages');
  return null;
}
async function runPurgeCommand() {
  const ref = currentMessagesRef();
  if (!ref) return;
  // "Everything before the /purge message" is exactly what's already on
  // screen right now, before that message exists — snapshotting these ids
  // first sidesteps any question of comparing against a createdAt that's
  // still an unresolved server timestamp.
  const idsToDelete = lastRawMessages.filter(m => !m.localOnly).map(m => m.id);
  let purgeRef;
  try {
    purgeRef = await sendToCurrentConversation({
      text: '/purge', uid: myUid, username: myProfile.username, createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) { toast(e.message || 'Could not run /purge.', 'error'); return; }
  try {
    // Firestore caps a single batch at 500 writes — chunk generously
    // under that so a very long, un-autodeleted history doesn't fail
    // partway through.
    for (let i = 0; i < idsToDelete.length; i += 450) {
      const batch = db.batch();
      idsToDelete.slice(i, i + 450).forEach(id => batch.delete(ref.doc(id)));
      await batch.commit();
    }
  } catch (e) {
    toast(e.message || 'Some messages could not be deleted.', 'error');
  }
  sendToCurrentConversation({
    uid: SAPPHIRE_UID, username: SAPPHIRE_PROFILE.username, createdAt: FieldValue.serverTimestamp(),
    type: 'purge-confirm', purgeCount: idsToDelete.length,
    replyTo: { id: purgeRef.id, uid: myUid, username: myProfile.username, text: '/purge' },
  }).catch(e => toast(e.message || 'Sapphire could not confirm the purge.', 'error'));
}

// No explicit Send button — matches Discord's real composer (Enter to send).
$('composer-input').addEventListener('keydown', (e) => {
  if (slashState) {
    if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); completeSlash(slashCandidates[slashSelectedIndex]); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); slashSelectedIndex = (slashSelectedIndex + 1) % slashCandidates.length; renderSlashPopup(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); slashSelectedIndex = (slashSelectedIndex - 1 + slashCandidates.length) % slashCandidates.length; renderSlashPopup(); return; }
    if (e.key === 'Escape') { closeSlashPopup(); return; }
  }
  if (mentionState) {
    if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); completeMention(mentionCandidates[mentionSelectedIndex]); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); mentionSelectedIndex = (mentionSelectedIndex + 1) % mentionCandidates.length; renderMentionPopup(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); mentionSelectedIndex = (mentionSelectedIndex - 1 + mentionCandidates.length) % mentionCandidates.length; renderMentionPopup(); return; }
    if (e.key === 'Escape') { closeMentionPopup(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ckWordBoundaryCheck(e.target); sendMessage(); }
});
// Autocorrect on desktop: the word-boundary check only ran through the
// mobile custom keyboard's own key handlers before, so a real keyboard
// typing space never triggered it. This covers that path; Enter is
// handled above right before sendMessage() clears the field.
$('composer-input').addEventListener('keyup', (e) => {
  if (e.key === ' ' && !(ckField && ckField.el === e.target)) ckWordBoundaryCheck(e.target);
});
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px'; }
// ---- chat message character limit (500, or 1000 with Frixion Premium) ----
// The native maxlength attribute (set below) already stops normal typing
// and pasting at the limit, but the custom mobile keyboard writes into
// this field with plain .value assignments, which maxlength has no say
// over — so this is the real backstop, and it runs through the same
// 'input' event both paths already fire.
function applyComposerCharLimit() {
  $('composer-input').maxLength = composerCharLimit();
  updateComposerCharCount();
}
function enforceComposerCharLimit(el) {
  const limit = composerCharLimit();
  if (el.value.length <= limit) return;
  const pos = el.selectionEnd;
  el.value = el.value.slice(0, limit);
  if (pos != null) el.selectionStart = el.selectionEnd = Math.min(pos, limit);
}
function updateComposerCharCount() {
  const el = $('composer-input');
  const counter = $('composer-charcount');
  const limit = composerCharLimit();
  const len = el.value.length;
  if (!len) { counter.classList.add('hidden'); return; }
  counter.classList.remove('hidden');
  counter.textContent = `${len}/${limit}`;
  counter.classList.toggle('warn', len >= limit * 0.9);
  counter.classList.toggle('over', len >= limit);
}
$('composer-input').addEventListener('input', (e) => {
  enforceComposerCharLimit(e.target);
  autoResize(e.target);
  updateMentionState(e.target);
  updateSlashState(e.target);
  updateComposerCharCount();
});

// ============================================================
// MENTIONS (@ autocomplete + rendering)
// Typing "@" plus a few letters pops up matching members from whichever
// server/DM/group is currently open, top match highlighted; Tab, Enter,
// or tapping a row completes it (see positionMentionPopup — reuses the
// same caret-measuring trick as the mobile keyboard's cursor overlay).
// Rendered mentions only get the "glow" style when that user is actually
// in the current conversation.
// ============================================================
function currentContextUsernames() {
  if (currentView === 'channel' && currentServerData) return currentServerData.members || [];
  if (currentView === 'dm') return [myUid, currentDMOtherUid].filter(Boolean);
  if (currentView === 'groupdm') {
    const g = (window.__myGroupDMs || []).find(x => x.id === currentGroupDMId);
    return g ? humanParticipants(g.participants) : [];
  }
  return [];
}

let mentionState = null;      // { el, start, query } — start is the index of "@" in el.value
let mentionCandidates = [];
let mentionSelectedIndex = 0;

function updateMentionState(el) {
  const pos = el.selectionStart;
  if (pos == null) { closeMentionPopup(); return; }
  const before = el.value.slice(0, pos);
  const m = /(?:^|\s)@([A-Za-z0-9_]{0,24})$/.exec(before);
  if (!m) { closeMentionPopup(); return; }
  const query = m[1];
  const start = pos - query.length - 1;
  const lowerQ = query.toLowerCase();
  const candidates = currentContextUsernames()
    .filter(u => u && u.toLowerCase().startsWith(lowerQ))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .slice(0, 6);
  if (!candidates.length) { closeMentionPopup(); return; }
  mentionState = { el, start, query };
  mentionCandidates = candidates;
  mentionSelectedIndex = 0;
  renderMentionPopup();
}
function closeMentionPopup() {
  mentionState = null; mentionCandidates = []; mentionSelectedIndex = 0;
  $('mention-popup').classList.add('hidden');
}
function positionMentionPopup(el) {
  const popup = $('mention-popup');
  const fRect = el.getBoundingClientRect();
  const off = measureCaretOffset(el);
  popup.style.left = Math.max(8, Math.min(fRect.left + off.x - (el.scrollLeft || 0), window.innerWidth - popup.offsetWidth - 8)) + 'px';
  popup.style.bottom = (window.innerHeight - fRect.top + 8) + 'px';
}
function renderMentionPopup() {
  const popup = $('mention-popup');
  popup.innerHTML = mentionCandidates.map((u, i) => {
    const p = profileCache[u] || { username: u, avatarColor: '#5865f2' };
    return `<div class="mention-row${i === mentionSelectedIndex ? ' selected' : ''}" data-idx="${i}">
      ${avatarHTML(22, p.avatarColor, initials(p.username), null, p.avatarUrl)}
      <span class="mention-row-name">${esc(p.username)}</span>
      ${u === myUid ? '<span class="mention-row-you">you</span>' : ''}
    </div>`;
  }).join('') + `<div class="mention-hint">Tab to autofill</div>`;
  popup.classList.remove('hidden');
  popup.querySelectorAll('.mention-row').forEach(row => {
    row.onclick = () => completeMention(mentionCandidates[+row.dataset.idx]);
  });
  positionMentionPopup(mentionState.el);
}
function completeMention(username) {
  if (!mentionState || username == null) return;
  const { el, start, query } = mentionState;
  const before = el.value.slice(0, start);
  const after = el.value.slice(start + 1 + query.length);
  const insertion = '@' + username + ' ';
  el.value = before + insertion + after;
  el.selectionStart = el.selectionEnd = before.length + insertion.length;
  closeMentionPopup();
  autoResize(el);
  ckFireInput(el);
  if (ckField && ckField.el === el) positionCkCursor();
}
document.addEventListener('click', (e) => {
  if (!mentionState) return;
  if (e.target.closest('#mention-popup') || e.target.closest('#composer-input')) return;
  closeMentionPopup();
});

// ============================================================
// SLASH COMMANDS (autocomplete + descriptions)
// Typing "/" at the very start of the composer, with nothing after it but
// letters, pops up matching commands with a description each — same
// interaction as the @ mention popup above, just triggered by "/" and
// only while the command word itself is still being typed (a space after
// it means you've moved on to typing the command's own text).
// ============================================================
const SLASH_COMMANDS = [
  { cmd: 'poll', desc: 'Create a poll for people to vote on', adminOnly: false },
  { cmd: 'purge', desc: 'Admin — delete every message before this one here', adminOnly: true },
];
let slashState = null; // { el }
let slashCandidates = [];
let slashSelectedIndex = 0;
function updateSlashState(el) {
  const pos = el.selectionStart;
  if (pos == null || pos !== el.value.length) { closeSlashPopup(); return; }
  const m = /^\/([a-z]*)$/i.exec(el.value);
  if (!m) { closeSlashPopup(); return; }
  const query = m[1].toLowerCase();
  const candidates = SLASH_COMMANDS.filter(c => (!c.adminOnly || isAdmin) && c.cmd.startsWith(query));
  if (!candidates.length) { closeSlashPopup(); return; }
  slashState = { el };
  slashCandidates = candidates;
  slashSelectedIndex = 0;
  renderSlashPopup();
}
function closeSlashPopup() {
  slashState = null; slashCandidates = []; slashSelectedIndex = 0;
  $('slash-popup').classList.add('hidden');
}
function positionSlashPopup(el) {
  const popup = $('slash-popup');
  const fRect = el.getBoundingClientRect();
  popup.style.left = Math.max(8, fRect.left) + 'px';
  popup.style.bottom = (window.innerHeight - fRect.top + 8) + 'px';
}
function renderSlashPopup() {
  const popup = $('slash-popup');
  popup.innerHTML = slashCandidates.map((c, i) => `
    <div class="slash-row${i === slashSelectedIndex ? ' selected' : ''}" data-idx="${i}">
      <span class="slash-row-cmd">/${esc(c.cmd)}</span>
      <span class="slash-row-desc">${esc(c.desc)}</span>
    </div>`).join('');
  popup.classList.remove('hidden');
  popup.querySelectorAll('.slash-row').forEach(row => {
    row.onclick = () => completeSlash(slashCandidates[+row.dataset.idx]);
  });
  positionSlashPopup(slashState.el);
}
function completeSlash(command) {
  if (!slashState || !command) return;
  const el = slashState.el;
  const insertion = '/' + command.cmd + ' ';
  el.value = insertion;
  el.selectionStart = el.selectionEnd = insertion.length;
  closeSlashPopup();
  autoResize(el);
  ckFireInput(el);
  if (ckField && ckField.el === el) positionCkCursor();
}
document.addEventListener('click', (e) => {
  if (!slashState) return;
  if (e.target.closest('#slash-popup') || e.target.closest('#composer-input')) return;
  closeSlashPopup();
});

// ---------- emoji picker (composer) ----------

// ============================================================
// CUSTOM ON-SCREEN KEYBOARD (mobile only)
// The OS's own accessory bar (Prev/Next/Done) above the keyboard
// can't be removed from a webpage — confirmed against current iOS
// documentation, not assumed — because it belongs to the native
// WKWebView, not our DOM. The only way around it is to never let a
// real native keyboard attach to a field at all: every field this
// drives is set readOnly on mobile (readOnly fields can still be
// read/written via JS, they just don't summon the OS keyboard) and
// never receives real focus either — instead this renders its own
// blinking cursor overlay, since readOnly fields don't reliably show
// a native caret (that's the exact bug that got reported). Every key
// writes through insertAtCursor()/autoResize() and fires a synthetic
// 'input' event, so existing listeners (search-as-you-type, etc.)
// keep working without knowing a keystroke came from here. Desktop
// is untouched — isMobile() gates all of this.
// ============================================================
const CK_LETTERS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  [{ act: 'shift', label: '⇧' }, 'z', 'x', 'c', 'v', 'b', 'n', 'm', { act: 'backspace', label: '⌫' }],
];
// Mirrors the real iOS two-page 123 / #+= symbol layout.
const CK_SYMBOLS_1 = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
  [{ act: 'page2', label: '#+=' }, '.', ',', '?', '!', "'", { act: 'backspace', label: '⌫' }],
];
const CK_SYMBOLS_2 = [
  ['[', ']', '{', '}', '#', '%', '^', '*', '+', '='],
  ['_', '\\', '|', '~', '<', '>', '€', '£', '¥', '•'],
  [{ act: 'page1', label: '123' }, '.', ',', '?', '!', "'", { act: 'backspace', label: '⌫' }],
];

// ---- optional autocorrect (off by default) ----
// Top ~1000 words from Google's public-domain word-frequency corpus
// (github.com/first20hours/google-10000-english). Deliberately a
// common-words list, not a full dictionary — good for catching
// everyday typos without being large enough to slow down a tap.
const CK_DICTIONARY = new Set([
  'the','of','and','to','a','in','for','is','on','that','by','this','with','i','you','it','not','or','be',
  'are','from','at','as','your','all','have','new','more','an','was','we','will','home','can','us','about',
  'if','page','my','has','search','free','but','our','one','other','do','no','information','time','they',
  'site','he','up','may','what','which','their','news','out','use','any','there','see','only','so','his',
  'when','contact','here','business','who','web','also','now','help','get','view','online','first','am',
  'been','would','how','were','me','services','some','these','click','its','like','service','than','find',
  'price','date','back','top','people','had','list','name','just','over','state','year','day','into','email',
  'two','health','world','next','used','go','work','last','most','products','music','buy','data','make',
  'them','should','product','system','post','her','city','add','policy','number','such','please','available',
  'copyright','support','message','after','best','software','then','good','video','well','where','info',
  'rights','public','books','high','school','through','each','links','she','review','years','order','very',
  'privacy','book','items','company','read','group','need','many','user','said','does','set','under','general',
  'research','university','mail','full','map','reviews','program','life','know','games','way','days',
  'management','part','could','great','united','hotel','real','item','international','center','must','store',
  'travel','comments','made','development','report','off','member','details','line','terms','before','hotels',
  'did','send','right','type','because','local','those','using','results','office','education','national',
  'car','design','take','posted','internet','address','community','within','states','area','want','phone',
  'shipping','reserved','subject','between','forum','family','long','based','code','show','even','black',
  'check','special','prices','website','index','being','women','much','sign','file','link','open','today',
  'technology','south','case','project','same','pages','version','section','own','found','sports','house',
  'related','security','both','county','american','photo','game','members','power','while','care','network',
  'down','computer','systems','three','total','place','end','following','download','him','without','per',
  'access','think','north','resources','current','posts','big','media','law','control','water','history',
  'pictures','size','art','personal','since','including','guide','shop','directory','board','location',
  'change','white','text','small','rating','rate','government','children','during','return','students',
  'shopping','account','times','sites','level','digital','profile','previous','form','events','love','old',
  'john','main','call','hours','image','department','title','description','another','why','shall','property',
  'class','still','money','quality','every','listing','content','country','private','little','visit','save',
  'tools','low','reply','customer','december','compare','movies','include','college','value','article','york',
  'man','card','jobs','provide','food','source','author','different','press','learn','sale','around','print',
  'course','job','canada','process','room','stock','training','too','credit','point','join','science','men',
  'categories','advanced','west','sales','look','english','left','team','estate','box','conditions','select',
  'windows','photos','thread','week','category','note','live','large','gallery','table','register','however',
  'june','october','november','market','library','really','action','start','series','model','features','air',
  'industry','plan','human','provided','tv','yes','required','second','hot','accessories','cost','movie',
  'forums','march','better','say','questions','july','going','medical','test','friend','come','server','pc',
  'study','application','cart','staff','articles','feedback','again','play','looking','issues','april','never',
  'users','complete','street','topic','comment','financial','things','working','against','standard','tax',
  'person','below','mobile','less','got','blog','party','payment','equipment','login','student','let',
  'programs','offers','legal','above','recent','park','stores','side','act','problem','red','give','memory',
  'performance','social','august','quote','language','story','sell','options','experience','rates','create',
  'key','body','young','america','important','field','few','east','paper','single','age','activities','club',
  'example','girls','additional','password','latest','something','road','gift','question','changes','night',
  'hard','texas','pay','four','status','browse','issue','range','building','seller','court','february',
  'always','result','audio','light','write','war','offer','blue','groups','easy','given','files','event',
  'release','analysis','request','china','making','picture','needs','possible','might','professional','yet',
  'month','major','star','areas','future','space','committee','hand','sun','cards','problems','london',
  'washington','meeting','become','interest','child','keep','enter','california','share','similar','garden',
  'schools','million','added','reference','companies','listed','baby','learning','energy','run','delivery',
  'net','popular','term','film','stories','put','computers','journal','reports','try','welcome','central',
  'images','president','notice','original','head','radio','until','cell','color','self','council','away',
  'includes','track','australia','discussion','archive','once','others','entertainment','agreement','format',
  'least','society','months','log','safety','friends','sure','trade','edition','cars','messages','marketing',
  'tell','further','updated','association','able','having','provides','david','fun','already','green',
  'studies','close','common','drive','specific','several','gold','living','collection','called','short','arts',
  'lot','ask','display','limited','powered','solutions','means','director','daily','beach','past','natural',
  'whether','due','electronics','five','upon','period','planning','database','says','official','weather',
  'land','average','done','technical','window','france','region','island','record','direct','microsoft',
  'conference','environment','records','district','calendar','costs','style','front','statement','update',
  'parts','ever','downloads','early','miles','sound','resource','present','applications','either','ago',
  'document','word','works','material','bill','written','talk','federal','hosting','rules','final','adult',
  'tickets','thing','centre','requirements','via','cheap','kids','finance','true','minutes','else','mark',
  'third','rock','gifts','europe','reading','topics','bad','individual','tips','plus','auto','cover','usually',
  'edit','together','videos','percent','fast','function','fact','unit','getting','global','tech','meet','far',
  'economic','player','projects','lyrics','often','subscribe','submit','germany','amount','watch','included',
  'feel','though','bank','risk','thanks','everything','deals','various','words','production','commercial',
  'james','weight','town','heart','advertising','received','choose','treatment','newsletter','archives',
  'points','knowledge','magazine','error','camera','girl','currently','construction','toys','registered',
  'clear','golf','receive','domain','methods','chapter','makes','protection','policies','loan','wide','beauty',
  'manager','india','position','taken','sort','listings','models','michael','known','half','cases','step',
  'engineering','florida','simple','quick','none','wireless','license','paul','friday','lake','whole','annual',
  'published','later','basic','shows','corporate','google','church','method','purchase','customers','active',
  'response','practice','hardware','figure','materials','fire','holiday','chat','enough','designed','along',
  'among','death','writing','speed','html','countries','loss','face','brand','discount','higher','effects',
  'created','remember','standards','oil','bit','yellow','political','increase','advertise','kingdom','base',
  'near','environmental','thought','stuff','french','storage','japan','doing','loans','shoes','entry','stay',
  'nature','orders','availability','ground','overview','owners','disease','italy','perfect','classic','basis',
  'command','cities','william','express','award','distance','peter','ensure','involved','extra','partners',
  'budget','rated','guides','success','maximum','existing','quite','selected','amazon','patients','warning',
  'horse','forward','flowers','stars','lists','owner','retail','animals','useful','directly','housing','takes',
  'bring','catalog','searches','trying','mother','traffic','joined','input','strategy','agent','valid',
  'modern','senior','ireland','teaching','grand','testing','trial','charge','units','instead','canadian',
  'normal','wrote','ships','entire','leading','metal','positive','fitness','chinese','opinion','football',
  'abstract','output','funds','greater','likely','develop','artists','guest','seems','trust','contains',
  'session','multi','republic','vacation','century','academic','graphics','indian','expected','grade',
  'dating','pacific','mountain','filter','mailing','vehicle','longer','consider','northern','behind','panel',
  'floor','german','buying','match','proposed','default','require','outdoor','morning','allows','protein',
  'plant','reported','politics','partner','authors','boards','faculty','parties','mission','string','sense',
  'modified','released','stage','internal','goods','recommended','forecast','db','signal','buttons','na',
  'israel','bought','indicate','row','wall','includ','nutrition','anti','anniversary','pricing','yourself',
  'shall','seniors','entered','discovery','lodge','hopefully','iron','disabled','vitamin','ranked','summer',
  'dollars','appliances','planet','democratic','identified','operation','desk','worldwide','recognition',
  'presented','citizens','carbon','tourism','described','stainless','holdings','beat','breast','sea','flat',
  'transactions','entries','margin','vietnam','offset','directors','shot','coupon','operating','hosted',
  'valuable','pool','digest','beauty','operators','stainless','simply','audience','clean','rehabilitation',
  'agriculture','forestry','equity','francisco','sports','circuit','anchor','runner','absolutely','underground',
  'physicians','adjustable','massage','deputy','danger','pittsburgh','knight','vice','rap','flowers','tone',
  'reasonable','victoria','filed','allowing','wishlist','vacations','recipe','ties','ranging','stability',
  'reasonably','offshore','flooring','gorgeous','fought','entirely','packaging','ranking','extras','argument',
  'shoulder','pontiac','vulnerable','township','islamic','critics','powerful','remained','sad','circulation',
]);
// Synced to the account (users/{username}.autocorrect) instead of
// localStorage, so it follows you between devices — same pattern as
// avatarColor. myProfile is kept current by the users/{myUid} snapshot
// listener in initAppForUser().
function isAutocorrectEnabled() { return !!(myProfile && myProfile.autocorrect); }
// Same account-synced pattern for the other two keyboard preferences.
// Both default ON (undefined counts as true) since that's the existing
// behavior for anyone who hasn't touched these settings yet.
function useCustomKeyboard() { return !myProfile || myProfile.customKeyboard !== false; }
function showQuickButtons() { return !myProfile || myProfile.keyboardQuickButtons !== false; }
let ckLastAutocorrect = null; // { start, end, original } — lets one immediate backspace undo the last correction
$('autocorrect-toggle').addEventListener('change', async (e) => {
  const on = e.target.checked;
  try { await db.collection('users').doc(myUid).update({ autocorrect: on }); }
  catch (err) { e.target.checked = !on; toast('Could not save that setting.', 'error'); }
});
$('custom-keyboard-toggle').addEventListener('change', async (e) => {
  const on = e.target.checked;
  try { await db.collection('users').doc(myUid).update({ customKeyboard: on }); }
  catch (err) { e.target.checked = !on; toast('Could not save that setting.', 'error'); return; }
  applyCustomKeyboardSetting();
});
$('quick-buttons-toggle').addEventListener('change', async (e) => {
  const on = e.target.checked;
  try { await db.collection('users').doc(myUid).update({ keyboardQuickButtons: on }); }
  catch (err) { e.target.checked = !on; toast('Could not save that setting.', 'error'); return; }
  if (ckField && !$('custom-keyboard').classList.contains('hidden')) renderCustomKeyboard();
});
function renderQuickTextList() {
  const wrap = $('quicktext-list');
  const items = getQuickTexts();
  wrap.innerHTML = items.map((t, i) => `
    <div class="quicktext-row" data-i="${i}">
      <input type="text" class="quicktext-input" maxlength="300" value="${esc(t)}">
      <button type="button" class="quicktext-remove" title="Remove">${icon('trash')}</button>
    </div>`).join('') || `<p class="desc" style="margin:0;font-size:12px;">No quick text yet.</p>`;
  wrap.querySelectorAll('.quicktext-row').forEach(row => {
    const i = parseInt(row.dataset.i, 10);
    const input = row.querySelector('.quicktext-input');
    const commit = async () => {
      const list = getQuickTexts().slice();
      const val = input.value.trim();
      if (!val) { list.splice(i, 1); }
      else list[i] = val;
      try { await db.collection('users').doc(myUid).update({ quickTexts: list }); }
      catch (err) { toast('Could not save quick text.', 'error'); return; }
      renderQuickTextList();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    row.querySelector('.quicktext-remove').onclick = async () => {
      const list = getQuickTexts().slice();
      list.splice(i, 1);
      try { await db.collection('users').doc(myUid).update({ quickTexts: list }); }
      catch (err) { toast('Could not remove that.', 'error'); return; }
      renderQuickTextList();
    };
  });
}
$('quicktext-add-btn').addEventListener('click', async () => {
  const list = getQuickTexts().slice();
  if (list.length >= 20) { toast('You can have up to 20 quick text entries.'); return; }
  list.push('');
  try { await db.collection('users').doc(myUid).update({ quickTexts: list }); }
  catch (err) { toast('Could not add that.', 'error'); return; }
  renderQuickTextList();
  const rows = $('quicktext-list').querySelectorAll('.quicktext-input');
  if (rows.length) rows[rows.length - 1].focus();
});
function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
function ckFindClosestWord(word) {
  const maxDist = word.length <= 4 ? 1 : 2;
  let best = null, bestDist = maxDist + 1;
  for (const w of CK_DICTIONARY) {
    if (Math.abs(w.length - word.length) > maxDist) continue;
    if (w[0] !== word[0]) continue; // cheap prune — typos rarely change the first letter, keeps this fast
    const d = levenshtein(word, w);
    if (d < bestDist) { bestDist = d; best = w; if (d === 0) break; }
  }
  return bestDist <= maxDist ? best : null;
}
// Runs on space/punctuation/enter — checks only the word that was just
// completed, not the whole field, so this stays cheap regardless of
// message length.
function ckWordBoundaryCheck(el) {
  if (!isAutocorrectEnabled()) return;
  const pos = el.selectionStart;
  if (pos == null) return;
  // Called right after a space is inserted (cursor now sits after that
  // space) or right before Enter (cursor sits right after the word,
  // nothing trailing yet) — back up past a trailing space so either
  // way we're looking at the word that was actually just completed.
  let checkPos = pos;
  if (checkPos > 0 && el.value[checkPos - 1] === ' ') checkPos -= 1;
  const before = el.value.slice(0, checkPos);
  const m = /([A-Za-z]+)$/.exec(before);
  if (!m) return;
  const word = m[1];
  if (word.length < 3) return;
  const wordStart = checkPos - word.length;
  const lower = word.toLowerCase();
  if (CK_DICTIONARY.has(lower)) return;
  const corrected = ckFindClosestWord(lower);
  if (!corrected || corrected === lower) return;
  const finalWord = word[0] === word[0].toUpperCase() ? corrected[0].toUpperCase() + corrected.slice(1) : corrected;
  el.value = el.value.slice(0, wordStart) + finalWord + el.value.slice(checkPos);
  const newPos = wordStart + finalWord.length + (pos - checkPos);
  el.selectionStart = el.selectionEnd = newPos;
  ckLastAutocorrect = { start: wordStart, end: wordStart + finalWord.length, original: word };
  autoResize(el);
  ckFireInput(el);
  if (ckField && ckField.el === el) positionCkCursor();
}

let ckField = null;       // { el, onEnter(el), multiline } — field currently being driven
let ckShiftOn = false;    // capitalizes just the next letter
let ckCapsLock = false;   // capitalizes until toggled off again
let ckPage = 'letters';   // 'letters' | 'symbols1' | 'symbols2' | 'emoji'
let ckLastShiftTap = 0;

function ckFireInput(el) { el.dispatchEvent(new Event('input', { bubbles: true })); }

function insertAtCursor(el, text) {
  ckLastAutocorrect = null;
  const start = el.selectionStart != null ? el.selectionStart : el.value.length;
  const end = el.selectionEnd != null ? el.selectionEnd : el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  el.selectionStart = el.selectionEnd = pos;
  // autoResize runs as part of the dispatched 'input' event below (every
  // wired field's own input listener already calls it) — calling it here
  // too just repeated the same forced-layout work twice per keystroke.
  ckFireInput(el);
  if (ckField && ckField.el === el) positionCkCursor();
}
function deleteAtCursor(el) {
  // One immediate backspace right after an autocorrect undoes it
  // instead of just chopping its last letter — matches how phone
  // keyboards handle this. Covers both the space-triggered case
  // (cursor sits one past the word, after the space) and the
  // Enter-triggered case (cursor sits right at the word's end).
  if (ckLastAutocorrect && el.selectionStart === el.selectionEnd) {
    const { start, end, original } = ckLastAutocorrect;
    const sel = el.selectionStart;
    const atSpaceAfter = sel === end + 1 && el.value[end] === ' ';
    if (sel === end || atSpaceAfter) {
      el.value = el.value.slice(0, start) + original + el.value.slice(sel);
      el.selectionStart = el.selectionEnd = start + original.length;
      ckLastAutocorrect = null;
      ckFireInput(el);
      if (ckField && ckField.el === el) positionCkCursor();
      return;
    }
  }
  ckLastAutocorrect = null;
  const start = el.selectionStart != null ? el.selectionStart : el.value.length;
  const end = el.selectionEnd != null ? el.selectionEnd : el.value.length;
  if (start === end) {
    if (start === 0) return;
    el.value = el.value.slice(0, start - 1) + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start - 1;
  } else {
    el.value = el.value.slice(0, start) + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start;
  }
  ckFireInput(el);
  if (ckField && ckField.el === el) positionCkCursor();
}

// ---- blinking cursor overlay (readOnly fields don't reliably show a native caret) ----
// The field's own font/padding/etc. never change between keystrokes, so the
// (forced-reflow) getComputedStyle call and property copy only need to run
// again when the mirror is being pointed at a *different* field than last
// time — not on every single character.
let ckMirrorConfiguredFor = null;
let ckMirrorLineHeight = 18;
function measureCaretOffset(field) {
  let mirror = document.getElementById('ck-mirror');
  if (!mirror) {
    mirror = document.createElement('div');
    mirror.id = 'ck-mirror';
    document.body.appendChild(mirror);
    // Fixed at a known, constant position so we never need to measure the
    // mirror's own rect just to subtract it back out below — position:fixed
    // means it can't move regardless of its content, so (0, -9999) is exact.
    mirror.style.position = 'fixed';
    mirror.style.top = '-9999px';
    mirror.style.left = '0';
    mirror.style.visibility = 'hidden';
  }
  if (ckMirrorConfiguredFor !== field) {
    const cs = window.getComputedStyle(field);
    ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
      'textTransform', 'textIndent'].forEach(p => { mirror.style[p] = cs[p]; });
    mirror.style.whiteSpace = field.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre';
    mirror.style.wordWrap = 'break-word';
    mirror.style.overflowWrap = 'break-word';
    ckMirrorLineHeight = parseFloat(cs.lineHeight) || 18;
    ckMirrorConfiguredFor = field;
  }

  const pos = field.selectionEnd != null ? field.selectionEnd : field.value.length;
  mirror.textContent = '';
  mirror.appendChild(document.createTextNode(field.value.slice(0, pos)));
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.appendChild(marker);
  mirror.appendChild(document.createTextNode(field.value.slice(pos) || '.'));

  const markerRect = marker.getBoundingClientRect();
  return {
    x: markerRect.left,
    y: markerRect.top + 9999,
    h: markerRect.height || ckMirrorLineHeight,
  };
}
function positionCkCursor() {
  const field = ckField && ckField.el;
  const cur = $('ck-cursor');
  if (!field || !cur) return;
  const fRect = field.getBoundingClientRect();
  const off = measureCaretOffset(field);
  const y = off.y - (field.scrollTop || 0);
  cur.style.left = (fRect.left + off.x - (field.scrollLeft || 0)) + 'px';
  cur.style.top = (fRect.top + y) + 'px';
  cur.style.height = off.h + 'px';
  cur.style.display = (y < -2 || y > fRect.height) ? 'none' : 'block';
  cur.classList.remove('ck-blink'); void cur.offsetWidth; cur.classList.add('ck-blink');
}

// ---- floating emoji/gif/sticker panels sit above whichever field is
// active; when the keyboard grows underneath the composer, nudge them
// up by its height so they don't get covered ----
function ckAdjustFloatingPanels(open) {
  ['emoji-picker-panel', 'gif-picker-panel', 'sticker-picker-panel'].forEach(id => {
    const el = $(id);
    if (open) {
      if (!el.dataset.ckBaseBottom) el.dataset.ckBaseBottom = window.getComputedStyle(el).bottom;
      el.style.bottom = `calc(${el.dataset.ckBaseBottom} + ${$('custom-keyboard').offsetHeight || 0}px)`;
    } else {
      el.style.bottom = '';
    }
  });
}

// Shift toggling and the very common "one capital letter, then back to
// lowercase" case used to call the full renderCustomKeyboard() rebuild —
// destroying and recreating every key (and every one of their listeners)
// just to re-case some letters. Since the only things that actually change
// are each letter's displayed case, the shift key's highlight, and (on a
// multiline field) the enter key's icon, updating those directly in place
// is both correct and far cheaper — this runs after nearly every real
// keystroke (any capitalized letter), so it's the single biggest lever on
// how snappy typing feels.
function ckUpdateKeyCasing() {
  if (ckPage !== 'letters') return;
  const kb = $('custom-keyboard');
  const upper = ckShiftOn || ckCapsLock;
  kb.querySelectorAll('.ck-key[data-ch]').forEach(btn => {
    btn.textContent = upper ? btn.dataset.ch.toUpperCase() : btn.dataset.ch;
  });
  const shiftBtn = kb.querySelector('.ck-shift');
  if (shiftBtn) { shiftBtn.classList.toggle('on', upper); shiftBtn.classList.toggle('caps', ckCapsLock); }
  const enterBtn = kb.querySelector('.ck-enter');
  if (enterBtn) enterBtn.innerHTML = (ckField && ckField.multiline && ckShiftOn) ? '⏎' : icon('send');
}
function ckConsumeOneShotShift() {
  if (ckShiftOn && !ckCapsLock) { ckShiftOn = false; ckUpdateKeyCasing(); }
}
function ckTapLetter(ch) {
  if (!ckField) return;
  const upper = ckPage === 'letters' && (ckShiftOn || ckCapsLock);
  insertAtCursor(ckField.el, upper ? ch.toUpperCase() : ch);
  ckConsumeOneShotShift();
}
function ckTapShift() {
  const now = Date.now();
  if (now - ckLastShiftTap < 350) { ckCapsLock = !ckCapsLock; ckShiftOn = false; }
  else { ckShiftOn = !ckShiftOn; ckCapsLock = false; }
  ckLastShiftTap = now;
  ckUpdateKeyCasing();
}
function ckTapEnter() {
  if (!ckField) return;
  if (slashState && slashState.el === ckField.el) { completeSlash(slashCandidates[slashSelectedIndex]); return; }
  if (mentionState && mentionState.el === ckField.el) { completeMention(mentionCandidates[mentionSelectedIndex]); return; }
  ckWordBoundaryCheck(ckField.el);
  if (ckField.multiline && ckShiftOn) { insertAtCursor(ckField.el, '\n'); ckShiftOn = false; ckUpdateKeyCasing(); }
  else ckField.onEnter(ckField.el);
}
function ckTapEmojiToggle() {
  // Switches the keyboard's own middle rows to an emoji grid, in place —
  // same shell (tool row, bottom row), just different keys, exactly like
  // the 123/ABC toggle. Nothing about the keyboard hides or swaps out for
  // a separate floating panel here anymore.
  ckPage = ckPage === 'emoji' ? 'letters' : 'emoji';
  ckShiftOn = false;
  renderCustomKeyboard();
}
async function ckTapCopy() {
  if (!ckField) return;
  const el = ckField.el;
  const start = el.selectionStart != null ? el.selectionStart : 0;
  const end = el.selectionEnd != null ? el.selectionEnd : el.value.length;
  const text = start !== end ? el.value.slice(start, end) : el.value;
  if (!text) return;
  try { await navigator.clipboard.writeText(text); toast('Copied.'); }
  catch (e) { toast('Could not copy — clipboard access was blocked.', 'error'); }
}
async function ckTapPaste() {
  if (!ckField) return;
  try {
    const text = await navigator.clipboard.readText();
    if (text) insertAtCursor(ckField.el, text);
  } catch (e) { toast('Could not paste — allow clipboard access and try again.', 'error'); }
}
function ckClearSelectionHighlight() { if (ckField) ckField.el.classList.remove('ck-all-selected'); }

// ---- quick text: a user-editable list of canned messages (Settings →
// Keyboard) that send instantly when tapped, replacing whatever was in
// the field — no separate "are you sure" step, matching a one-tap canned
// reply rather than a snippet you'd still need to review and send. ----
function getQuickTexts() { return (myProfile && Array.isArray(myProfile.quickTexts)) ? myProfile.quickTexts : []; }
function ckQuickTextOutsideClick(e) {
  const pop = $('ck-quicktext-popover');
  if (pop && !pop.contains(e.target) && !e.target.closest('[data-act="quick-text"]')) closeCkQuickTextPopover();
}
function closeCkQuickTextPopover() {
  const pop = $('ck-quicktext-popover');
  if (pop) pop.remove();
  document.removeEventListener('click', ckQuickTextOutsideClick);
}
function ckTapQuickText(btn) {
  if (!ckField) return;
  closeCkQuickTextPopover();
  const items = getQuickTexts();
  const pop = document.createElement('div');
  pop.className = 'ck-quicktext-popover';
  pop.id = 'ck-quicktext-popover';
  pop.innerHTML = items.length
    ? items.map((t, i) => `<button type="button" class="ck-qt-item" data-i="${i}">${esc(t)}</button>`).join('')
    : `<div class="ck-qt-empty">No quick text yet — add some in Settings → Keyboard.</div>`;
  document.body.appendChild(pop);
  const kbRect = $('custom-keyboard').getBoundingClientRect();
  pop.style.left = '8px';
  pop.style.right = '8px';
  pop.style.bottom = `${window.innerHeight - kbRect.top + 6}px`;
  pop.querySelectorAll('.ck-qt-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = items[parseInt(el.dataset.i, 10)];
      closeCkQuickTextPopover();
      if (!ckField) return;
      const field = ckField.el;
      field.value = text;
      field.selectionStart = field.selectionEnd = text.length;
      ckFireInput(field);
      ckField.onEnter(field);
    });
  });
  setTimeout(() => document.addEventListener('click', ckQuickTextOutsideClick), 0);
}

// ---- press feedback + long-press for accented/alternate characters ----
// Mirrors the standard mobile-keyboard interaction: tapping a key briefly
// shows it enlarged above the key; holding one that has alternates (e.g.
// "e" → "é è ê ë") morphs that into a row you can slide across and release
// on. Scoped to data-ch keys generally (letters, symbols, and the emoji
// grid all share that attribute) — CK_ALT_CHARS simply has no entries for
// most of them, so they just get the plain tap-feedback bubble.
const CK_ALT_CHARS = {
  a: ['á', 'à', 'â', 'ä', 'æ', 'ã', 'å'],
  e: ['é', 'è', 'ê', 'ë'],
  i: ['í', 'ì', 'î', 'ï'],
  o: ['ó', 'ò', 'ô', 'ö', 'õ', 'ø'],
  u: ['ú', 'ù', 'û', 'ü'],
  n: ['ñ'],
  c: ['ç'],
  y: ['ý', 'ÿ'],
  s: ['ß', 'ś'],
  '-': ['–', '—'],
  "'": ['\u2019', '\u2018'],
  '"': ['\u201d', '\u201c'],
};
let ckPressTimer = null;
let ckPressBubble = null;
let ckAltActiveIndex = -1; // -1 = no alt-picker active yet; 0 = base char; 1+ = an alternate
function ckRemoveBubble() {
  if (ckPressBubble) { ckPressBubble.remove(); ckPressBubble = null; }
  if (ckPressTimer) { clearTimeout(ckPressTimer); ckPressTimer = null; }
  ckAltActiveIndex = -1;
}
function ckShowBubble(btn, chars, activeIndex) {
  if (!ckPressBubble) {
    ckPressBubble = document.createElement('div');
    ckPressBubble.className = 'ck-press-bubble';
    document.body.appendChild(ckPressBubble);
  }
  ckPressBubble.innerHTML = chars.map((c, i) => `<span class="ck-press-char${i === activeIndex ? ' active' : ''}">${esc(c)}</span>`).join('');
  const r = btn.getBoundingClientRect();
  const bw = ckPressBubble.offsetWidth;
  const bh = ckPressBubble.offsetHeight;
  ckPressBubble.style.left = `${Math.max(4, Math.min(window.innerWidth - bw - 4, r.left + r.width / 2 - bw / 2))}px`;
  ckPressBubble.style.top = `${Math.max(4, r.top - bh - 6)}px`;
}
function ckWireCharKey(btn) {
  const ch = btn.dataset.ch;
  let startX = 0, startY = 0, cancelled = false, released = false;
  // Range of the character this press already typed on the way down, so
  // onUp can swap it for a chosen long-press alternate instead of
  // inserting a second character.
  let insertedRange = null;
  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    ckClearSelectionHighlight();
    cancelled = false; released = false; ckAltActiveIndex = -1; insertedRange = null;
    startX = e.clientX; startY = e.clientY;
    const upper = ckPage === 'letters' && (ckShiftOn || ckCapsLock);
    const baseDisplay = ckPage !== 'letters' ? ch : (upper ? ch.toUpperCase() : ch);
    ckShowBubble(btn, [baseDisplay], -1);
    // Type on finger-down, not finger-up. Waiting for release before
    // committing anything — so it could first check whether this was
    // turning into a long-press — is what made typing feel like it had a
    // built-in delay on every single key. A real keyboard doesn't wait
    // either. If this does turn into a long-press pick, onUp swaps the
    // character already sitting in the field for the chosen alternate
    // instead of inserting a fresh one. The emoji grid is exempt: a touch
    // there might turn into a scroll, and we don't want a swipe-to-scroll
    // to leave a trail of emoji behind.
    if (ckPage !== 'emoji' && ckField) {
      const el = ckField.el;
      const start = el.selectionStart != null ? el.selectionStart : el.value.length;
      ckTapLetter(ch);
      insertedRange = { start, end: start + baseDisplay.length };
    }
    const alts = CK_ALT_CHARS[ch.toLowerCase()];
    if (alts && alts.length) {
      ckPressTimer = setTimeout(() => {
        if (cancelled) return;
        const shown = upper ? alts.map(a => a.toUpperCase()) : alts;
        ckShowBubble(btn, [baseDisplay, ...shown], 0);
        ckAltActiveIndex = 0;
      }, 400);
    }
  };
  const onMove = (e) => {
    if (cancelled || !ckPressBubble) return;
    if (ckAltActiveIndex < 0) {
      // Long-press hasn't kicked in yet — real finger movement this early
      // means a scroll (the emoji grid) or a change of mind, not a pick.
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (dist > 12) {
        cancelled = true;
        // We may have already typed this key's base character on the way
        // down — undo it, but only if the cursor is still sitting exactly
        // where that insert left it (nothing else has touched the field
        // since, so this is safe to remove cleanly).
        if (insertedRange && ckField) {
          const el = ckField.el;
          if (el.selectionStart === insertedRange.end && el.selectionEnd === insertedRange.end) {
            el.value = el.value.slice(0, insertedRange.start) + el.value.slice(insertedRange.end);
            el.selectionStart = el.selectionEnd = insertedRange.start;
            ckFireInput(el);
            if (ckField.el === el) positionCkCursor();
          }
        }
        ckRemoveBubble();
      }
      return;
    }
    const chars = [...ckPressBubble.querySelectorAll('.ck-press-char')];
    let closest = 0, closestDist = Infinity;
    chars.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - e.clientX);
      if (d < closestDist) { closestDist = d; closest = i; }
    });
    if (closest !== ckAltActiveIndex) {
      ckAltActiveIndex = closest;
      chars.forEach((el, i) => el.classList.toggle('active', i === closest));
    }
  };
  const onUp = () => {
    if (released) return;
    released = true;
    if (!cancelled && ckField) {
      if (ckPressBubble && ckAltActiveIndex > 0) {
        const chars = [...ckPressBubble.querySelectorAll('.ck-press-char')];
        const alt = chars[ckAltActiveIndex].textContent;
        if (insertedRange) {
          const el = ckField.el;
          el.value = el.value.slice(0, insertedRange.start) + alt + el.value.slice(insertedRange.end);
          el.selectionStart = el.selectionEnd = insertedRange.start + alt.length;
          ckFireInput(el);
          if (ckField.el === el) positionCkCursor();
        } else {
          insertAtCursor(ckField.el, alt);
        }
        ckConsumeOneShotShift();
      } else if (!insertedRange) {
        // Nothing typed on the way down (emoji grid) — commit here instead, same as before.
        ckTapLetter(ch);
      }
    }
    ckRemoveBubble();
  };
  const onCancel = () => { cancelled = true; released = true; ckRemoveBubble(); };
  btn.addEventListener('pointerdown', onDown);
  btn.addEventListener('pointermove', onMove);
  btn.addEventListener('pointerup', onUp);
  btn.addEventListener('pointercancel', onCancel);
}

// ---- hold-to-repeat delete ----
// Backspace used to be tap-only (one character per click), so clearing
// anything longer than a word meant mashing it repeatedly. This makes
// holding it behave like a real keyboard's delete key: one immediate
// delete on press, then a repeating delete for as long as it's held.
let ckBackspaceTimer = null, ckBackspaceInterval = null;
function ckStopBackspaceRepeat() {
  clearTimeout(ckBackspaceTimer); ckBackspaceTimer = null;
  clearInterval(ckBackspaceInterval); ckBackspaceInterval = null;
}
function ckWireBackspaceKey(btn) {
  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    ckClearSelectionHighlight();
    ckStopBackspaceRepeat();
    if (ckField) deleteAtCursor(ckField.el); // first delete happens right away, same as a single tap always did
    ckBackspaceTimer = setTimeout(() => {
      ckBackspaceInterval = setInterval(() => { if (ckField) deleteAtCursor(ckField.el); }, 45);
    }, 350);
  };
  const onUp = () => ckStopBackspaceRepeat();
  btn.addEventListener('pointerdown', onDown);
  btn.addEventListener('pointerup', onUp);
  btn.addEventListener('pointercancel', onUp);
  btn.addEventListener('pointerleave', onUp);
}

function renderCustomKeyboard() {
  const kb = $('custom-keyboard');
  const rows = ckPage === 'letters' ? CK_LETTERS : (ckPage === 'symbols1' ? CK_SYMBOLS_1 : CK_SYMBOLS_2);
  const upper = ckShiftOn || ckCapsLock;
  const keyHTML = (item) => {
    if (typeof item === 'string') {
      const disp = ckPage !== 'letters' ? item : (upper ? item.toUpperCase() : item);
      return `<button type="button" class="ck-key" data-ch="${esc(item)}">${esc(disp)}</button>`;
    }
    const wideCls = item.act === 'shift' ? `ck-shift${upper ? ' on' : ''}${ckCapsLock ? ' caps' : ''}` : '';
    return `<button type="button" class="ck-key ck-wide ${wideCls}" data-act="${item.act}">${esc(item.label)}</button>`;
  };
  const toolRow = showQuickButtons() ? `
    <div class="ck-row ck-tool-row">
      <button type="button" class="ck-key ck-tool" data-act="quick-text">Quick Text</button>
      <button type="button" class="ck-key ck-tool" data-act="copy">Copy</button>
      <button type="button" class="ck-key ck-tool" data-act="paste">Paste</button>
    </div>` : '';
  const bottomRow = `
    <div class="ck-row ck-bottom-row">
      <button type="button" class="ck-key ck-tag" data-act="toggle-symbols">${ckPage === 'letters' ? '123' : 'ABC'}</button>
      <button type="button" class="ck-key ck-tag${ckPage === 'emoji' ? ' on' : ''}" data-act="emoji">${icon('smiley')}</button>
      ${ckPage === 'emoji'
        ? `<button type="button" class="ck-key ck-space" data-act="backspace">⌫</button>`
        : `<button type="button" class="ck-key ck-space" data-act="space">space</button>`}
      <button type="button" class="ck-key ck-tag ck-enter" data-act="enter">${ckField && ckField.multiline && ckShiftOn ? '⏎' : icon('send')}</button>
    </div>`;
  const bodyHTML = ckPage === 'emoji' ? ckEmojiRowsHTML() : rows.map(row => `<div class="ck-row">${row.map(keyHTML).join('')}</div>`).join('');
  kb.innerHTML = toolRow + bodyHTML + bottomRow;

  // Letter/symbol/emoji keys use pointer events (see ckWireCharKey) rather
  // than click, both for the press-feedback bubble/long-press-for-alternates
  // feature and so nothing here needs the same stopPropagation workaround
  // the data-act keys below still do (preventDefault on a touch pointerdown
  // already suppresses the synthetic click that would otherwise follow).
  kb.querySelectorAll('.ck-key[data-ch]').forEach(ckWireCharKey);
  kb.querySelectorAll('.ck-key[data-custom-emoji]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!ckField) return;
      ckClearSelectionHighlight();
      insertAtCursor(ckField.el, `:${btn.dataset.customEmoji}:`);
      ckConsumeOneShotShift();
    });
  });
  kb.querySelectorAll('.ck-key[data-act]').forEach(btn => {
    // Backspace is wired separately (pointerdown/up) so holding it repeats —
    // see ckWireBackspaceKey. It never reaches this click handler.
    if (btn.dataset.act === 'backspace') { ckWireBackspaceKey(btn); return; }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act !== 'copy') ckClearSelectionHighlight();
      if (act === 'shift') ckTapShift();
      else if (act === 'space') { if (ckField) { insertAtCursor(ckField.el, ' '); ckConsumeOneShotShift(); ckWordBoundaryCheck(ckField.el); } }
      else if (act === 'enter') ckTapEnter();
      else if (act === 'toggle-symbols') { ckPage = ckPage === 'letters' ? 'symbols1' : 'letters'; renderCustomKeyboard(); }
      else if (act === 'page1') { ckPage = 'symbols1'; renderCustomKeyboard(); }
      else if (act === 'page2') { ckPage = 'symbols2'; renderCustomKeyboard(); }
      else if (act === 'emoji') ckTapEmojiToggle();
      else if (act === 'quick-text') ckTapQuickText(btn);
      else if (act === 'copy') ckTapCopy();
      else if (act === 'paste') ckTapPaste();
    });
  });
}
// Flattens custom server emoji (as image tiles, inserted as :name:) and the
// full standard emoji set (as literal characters) into rows the same shape
// as the letter/symbol rows, so they pick up identical key styling.
function ckEmojiRowsHTML() {
  const customTiles = Object.keys(customEmojis).sort().map(n =>
    `<button type="button" class="ck-key ck-emoji-key" data-custom-emoji="${esc(n)}" title=":${esc(n)}:"><img src="${customEmojis[n].dataUrl}" alt=":${esc(n)}:"></button>`);
  const stdTiles = ALL_EMOJI_FLAT.map(e => `<button type="button" class="ck-key ck-emoji-key" data-ch="${esc(e)}">${e}</button>`);
  const tiles = customTiles.concat(stdTiles);
  const perRow = 7;
  const rowsArr = [];
  for (let i = 0; i < tiles.length; i += perRow) rowsArr.push(tiles.slice(i, i + perRow));
  return `<div class="ck-emoji-scroll">${rowsArr.map(r => `<div class="ck-row">${r.join('')}</div>`).join('')}</div>`;
}
function showCustomKeyboardFor(el, opts) {
  ['emoji-picker-panel', 'sticker-picker-panel', 'gif-picker-panel'].forEach(id => {
    const panel = $(id);
    if (!panel.contains(el)) panel.classList.add('hidden');
  });
  if (ckField && ckField.el !== el) ckClearSelectionHighlight();
  ckField = { el, onEnter: (opts && opts.onEnter) || (() => hideCustomKeyboard()), multiline: !!(opts && opts.multiline) };
  ckShiftOn = false;
  ckPage = 'letters';
  ckLastAutocorrect = null;
  el.readOnly = true;
  renderCustomKeyboard();
  $('custom-keyboard').classList.remove('hidden');
  ckAdjustFloatingPanels(true);
  positionCkCursor();
  // readOnly should already stop the native keyboard on its own (this is
  // the documented iOS behavior), but that's less consistently documented
  // across every Android browser. As a safety net, blur right after in
  // case any browser sneaks a native keyboard open anyway — doesn't
  // affect the custom keyboard, since nothing here depends on real focus.
  setTimeout(() => { if (document.activeElement === el) el.blur(); }, 0);
}
function showCustomKeyboard() { showCustomKeyboardFor($('composer-input'), { onEnter: () => sendMessage(), multiline: true }); }
function hideCustomKeyboard() {
  $('custom-keyboard').classList.add('hidden');
  $('ck-cursor').style.display = 'none';
  ckAdjustFloatingPanels(false);
  ckClearSelectionHighlight();
  ckField = null;
  closeMentionPopup();
}
// Fields the custom keyboard can drive, so the "custom keyboard" setting
// can flip all of them the moment it changes (rather than waiting for the
// next tap) — see applyCustomKeyboardSetting(). Always defined (even on
// desktop, where it just stays empty) so that function is always safe to call.
const CK_WIRED_FIELDS = [];
function applyCustomKeyboardSetting() {
  const on = useCustomKeyboard();
  CK_WIRED_FIELDS.forEach(el => { el.readOnly = on; });
  if (!on) hideCustomKeyboard();
}
if (isMobile()) {
  const wireField = (el, opts) => {
    CK_WIRED_FIELDS.push(el);
    el.readOnly = useCustomKeyboard();
    el.addEventListener('click', () => { if (useCustomKeyboard()) showCustomKeyboardFor(el, opts); });
  };
  wireField($('composer-input'), { onEnter: () => sendMessage(), multiline: true });
  wireField($('emoji-search'), { onEnter: () => hideCustomKeyboard(), multiline: false });
  wireField($('gif-search'), { onEnter: () => hideCustomKeyboard(), multiline: false });
  document.addEventListener('click', (e) => {
    if ($('custom-keyboard').classList.contains('hidden')) return;
    if (e.target.closest('#custom-keyboard') || e.target.closest('#composer-input') ||
      e.target.closest('#emoji-search') || e.target.closest('#gif-search') || e.target.closest('#emoji-picker-btn') ||
      e.target.closest('.msg-edit-box')) return;
    hideCustomKeyboard();
  });
  window.addEventListener('resize', () => {
    ckMirrorConfiguredFor = null; // field width may have changed — re-measure its style next time
    if (ckField && !$('custom-keyboard').classList.contains('hidden')) positionCkCursor();
  });
}

// ---- emoji picker (composer, and reused for poll-answer emojis) ----
// emojiPickerTarget is null when the panel is feeding the composer (its
// normal job); it's set to {type:'poll', row, btn} while it's anchored
// next to a poll answer row instead — see openPollEmojiPicker.
let emojiPickerTarget = null;
function applyEmojiPick(pick) {
  if (emojiPickerTarget && emojiPickerTarget.type === 'poll') {
    const { row, btn } = emojiPickerTarget;
    if (pick.custom) { row.dataset.emoji = `:${pick.custom}:`; btn.innerHTML = `<img class="custom-emoji" src="${esc(customEmojis[pick.custom].dataUrl)}" alt="">`; }
    else { row.dataset.emoji = pick.native; btn.textContent = pick.native; }
    closeEmojiPickerPanel();
    return;
  }
  const el = (ckField && ckField.el) || $('composer-input');
  if (pick.custom) insertAtCursor(el, `:${pick.custom}:`);
  else insertAtCursor(el, pick.native);
}
function closeEmojiPickerPanel() {
  const panel = $('emoji-picker-panel');
  panel.classList.add('hidden');
  panel.classList.remove('ep-anchored');
  panel.style.left = '';
  panel.style.top = '';
  emojiPickerTarget = null;
  document.removeEventListener('click', emojiPickerOutsideClick);
}
function emojiPickerOutsideClick(e) {
  const panel = $('emoji-picker-panel');
  if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !e.target.closest('#emoji-picker-btn') && !e.target.closest('.poll-answer-emoji-btn')) {
    closeEmojiPickerPanel();
  }
}
function renderEmojiPickerGrids() {
  const q = ($('emoji-search').value || '').toLowerCase();
  const clearSlot = $('ep-poll-clear');
  clearSlot.classList.toggle('hidden', !(emojiPickerTarget && emojiPickerTarget.type === 'poll' && emojiPickerTarget.row.dataset.emoji));

  const customWrap = $('ep-custom-grid');
  const customNames = Object.keys(customEmojis).filter(n => !q || n.includes(q)).sort();
  customWrap.innerHTML = customNames.length
    ? customNames.map(n => `<button type="button" title=":${esc(n)}:"><img src="${customEmojis[n].dataUrl}" alt=":${esc(n)}:"></button>`).join('')
    : '<div class="ep-empty">No custom emoji yet</div>';
  customWrap.querySelectorAll('button').forEach((btn, i) => { btn.onclick = () => applyEmojiPick({ custom: customNames[i] }); });

  const sectionsWrap = $('ep-standard-sections');
  sectionsWrap.innerHTML = EMOJI_CATEGORIES.map(cat => {
    const names = Object.keys(cat.items).filter(n => !q || n.includes(q));
    if (!names.length) return '';
    return `<div class="ep-section-label" id="ep-sec-${cat.key}">${esc(cat.label)}</div>
      <div class="ep-grid">${names.map(n => `<button type="button" title=":${esc(n)}:">${cat.items[n]}</button>`).join('')}</div>`;
  }).join('') || '<div class="ep-empty">No emoji match "' + esc(q) + '"</div>';
  sectionsWrap.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => applyEmojiPick({ native: btn.textContent });
  });

  $('ep-cats').innerHTML = EMOJI_CATEGORIES.map(cat => `<button type="button" class="ep-cat-btn" data-cat="${cat.key}" title="${esc(cat.label)}">${cat.icon}</button>`).join('');
  $('ep-cats').querySelectorAll('.ep-cat-btn').forEach(btn => {
    btn.onclick = () => {
      const target = $('ep-sec-' + btn.dataset.cat);
      if (target) target.scrollIntoView({ block: 'start' });
    };
  });
}
$('ep-poll-clear-btn').onclick = () => {
  if (!emojiPickerTarget || emojiPickerTarget.type !== 'poll') return;
  const { row, btn } = emojiPickerTarget;
  delete row.dataset.emoji;
  btn.innerHTML = icon('smiley');
  renderEmojiPickerGrids();
};
$('emoji-picker-btn').onclick = (e) => {
  e.stopPropagation();
  $('sticker-picker-panel').classList.add('hidden');
  $('gif-picker-panel').classList.add('hidden');
  $('composer-action-menu').classList.add('hidden');
  const panel = $('emoji-picker-panel');
  emojiPickerTarget = null;
  panel.classList.remove('ep-anchored');
  panel.style.left = '';
  panel.style.top = '';
  const willOpen = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (isMobile() && useCustomKeyboard()) $('custom-keyboard').classList.toggle('hidden', willOpen);
  if (willOpen) { $('emoji-search').value = ''; renderEmojiPickerGrids(); if (!isMobile() || !useCustomKeyboard()) $('emoji-search').focus(); }
};
$('emoji-search').addEventListener('input', renderEmojiPickerGrids);
document.addEventListener('click', emojiPickerOutsideClick);

// ============================================================
// SETTINGS MODAL
// ============================================================
$('open-my-settings').onclick = () => openProfileModal(myUid);
$('open-settings-gear').onclick = openSettings;
function openSettings() { populateSettings(); openModal('settings-modal'); }

document.querySelectorAll('#settings-nav .nav-item[data-pane]').forEach(item => {
  item.onclick = () => {
    document.querySelectorAll('#settings-nav .nav-item[data-pane]').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.settings-pane').forEach(p => p.classList.add('hidden'));
    $(item.dataset.pane).classList.remove('hidden');
    if (item.dataset.pane === 'pane-updates') renderUpdates();
  };
});

$('open-admin-panel').onclick = () => { closeModal('settings-modal'); openAdminEntry(); };

function populateSettings() {
  if (!myProfile) return;
  $('set-username').value = myProfile.username;
  $('autocorrect-toggle').checked = isAutocorrectEnabled();
  $('custom-keyboard-toggle').checked = useCustomKeyboard();
  $('quick-buttons-toggle').checked = showQuickButtons();
  renderQuickTextList();

  const swatchWrap = $('avatar-color-swatches');
  swatchWrap.innerHTML = '';
  AVATAR_COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (myProfile.avatarColor === c ? ' selected' : '');
    sw.style.background = c;
    sw.onclick = async () => { await db.collection('users').doc(myUid).update({ avatarColor: c }); };
    swatchWrap.appendChild(sw);
  });

  $('orb-balance-amt').textContent = myProfile.orbs || 0;
  $('premium-action-area').innerHTML = buildPremiumActionHTML();
  wirePremiumActionButtons('premium-action-area');

  renderThemeGrid();
  renderQuests();
}

function buildPremiumActionHTML() {
  const active = isPremium(myProfile);
  const balance = myProfile.orbs || 0;
  const days = Math.round(PREMIUM_DURATION_MS / 86400000);
  if (active) {
    const until = new Date(myProfile.premiumUntil).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    return `
      <span class="premium-active-badge">${icon('star')} Frixion Premium Active</span>
      <p class="desc" style="margin-top:12px;">Active until ${until}. Renewing early adds another ${days} days on top of your current expiry.</p>
      <button class="btn-accent-inline" style="width:100%;" data-premium-action="renew">Renew Now — ${PREMIUM_COST_ORBS} Orbs</button>`;
  }
  const canAfford = balance >= PREMIUM_COST_ORBS;
  return `
    <button class="btn-accent-inline" style="width:100%;" data-premium-action="subscribe" ${canAfford ? '' : 'disabled'}>Subscribe — ${PREMIUM_COST_ORBS} Orbs / ${days} days</button>
    ${canAfford ? '' : `<p class="desc" style="margin-top:10px;">You have ${balance} Orbs. Complete quests to earn the rest.</p>`}`;
}
function wirePremiumActionButtons(containerId) {
  const btn = $(containerId).querySelector('[data-premium-action]');
  if (btn) btn.onclick = subscribeToPremium;
}

function genRedeemCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `FRX-${seg()}-${seg()}`;
}
async function createRedeemCode(type, value, createdBy, customCode) {
  const code = (customCode || '').trim().toUpperCase() || genRedeemCode();
  const existing = await db.collection('redeemCodes').doc(code).get();
  if (existing.exists) throw new Error('That code is already in use.');
  await db.collection('redeemCodes').doc(code).set({
    code, type, value, createdBy, redeemedBy: null, createdAt: FieldValue.serverTimestamp(), redeemedAt: null,
  });
  return code;
}
function showCodeModal(code, description) {
  $('code-reveal-text').textContent = code;
  $('code-reveal-desc').textContent = description;
  openModal('code-reveal-modal');
}
$('code-reveal-copy').onclick = () => {
  navigator.clipboard.writeText($('code-reveal-text').textContent).then(() => toast('Code copied.')).catch(() => {});
};

async function subscribeToPremium() {
  const fresh = (await db.collection('users').doc(myUid).get()).data();
  if ((fresh.orbs || 0) < PREMIUM_COST_ORBS) { toast('Not enough Orbs — complete quests to earn more.'); return; }
  const days = Math.round(PREMIUM_DURATION_MS / 86400000);
  try {
    await db.collection('users').doc(myUid).update({ orbs: FieldValue.increment(-PREMIUM_COST_ORBS) });
    const code = await createRedeemCode('premium', days, myUid);
    closeModal('premium-modal');
    showCodeModal(code, `This code adds ${days} days of Frixion Premium. Redeem it any time from Codes.`);
  } catch (e) { toast('Something went wrong.', 'error'); }
}

async function giftPremiumTo(recipientUsername) {
  const fresh = (await db.collection('users').doc(myUid).get()).data();
  if ((fresh.orbs || 0) < PREMIUM_COST_ORBS) { toast(`You need ${PREMIUM_COST_ORBS} Orbs to gift Premium.`); return; }
  if (!confirm(`Gift Frixion Premium to ${recipientUsername} for ${PREMIUM_COST_ORBS} Orbs?`)) return;
  const days = Math.round(PREMIUM_DURATION_MS / 86400000);
  try {
    await db.collection('users').doc(myUid).update({ orbs: FieldValue.increment(-PREMIUM_COST_ORBS) });
    const code = await createRedeemCode('premium', days, myUid);
    const dmId = dmIdFor(myUid, recipientUsername);
    const ref = db.collection('dms').doc(dmId);
    const dsnap = await ref.get();
    if (!dsnap.exists) await ref.set({ participants: [myUid, recipientUsername], autoDelete: true, createdAt: FieldValue.serverTimestamp() });
    await ref.collection('messages').add({
      text: `Gifted Frixion Premium! Redeem this code in Settings > Codes for ${days} days: ${code}`,
      uid: myUid, username: myProfile.username, createdAt: FieldValue.serverTimestamp(),
    });
    await ref.update({ updatedAt: FieldValue.serverTimestamp() });
    toast(`Gifted Premium to ${recipientUsername}!`);
    closeModal('gift-modal');
  } catch (e) { toast('Something went wrong.', 'error'); }
}

async function redeemCode() {
  const code = ($('redeem-code-input').value || '').trim().toUpperCase();
  $('redeem-code-error').textContent = '';
  if (!code) { $('redeem-code-error').textContent = 'Enter a code.'; return; }
  try {
    const ref = db.collection('redeemCodes').doc(code);
    const snap = await ref.get();
    if (!snap.exists) { $('redeem-code-error').textContent = 'That code is invalid.'; return; }
    const data = snap.data();
    if (data.redeemedBy) { $('redeem-code-error').textContent = 'That code has already been redeemed.'; return; }
    if (data.type === 'orbs') {
      await db.collection('users').doc(myUid).update({ orbs: FieldValue.increment(data.value) });
      toast(`+${data.value} Orbs redeemed!`);
    } else if (data.type === 'premium') {
      const fresh = (await db.collection('users').doc(myUid).get()).data();
      const base = isPremium(fresh) ? fresh.premiumUntil : Date.now();
      await db.collection('users').doc(myUid).update({ premiumUntil: base + data.value * 86400000 });
      toast(`Frixion Premium extended by ${data.value} days!`);
    }
    await ref.update({ redeemedBy: myUid, redeemedAt: FieldValue.serverTimestamp() });
    $('redeem-code-input').value = '';
    renderCodesView();
  } catch (e) { $('redeem-code-error').textContent = 'Something went wrong.'; }
}

function openPremiumModal() {
  $('premium-modal-orb-amt').textContent = myProfile.orbs || 0;
  $('premium-modal-action-area').innerHTML = buildPremiumActionHTML();
  wirePremiumActionButtons('premium-modal-action-area');
  openModal('premium-modal');
}

function renderThemeGrid() {
  const themeGrid = $('theme-grid');
  themeGrid.innerHTML = '';
  THEMES.forEach(t => {
    const locked = t.premium && !isPremium(myProfile);
    const card = document.createElement('div');
    card.className = `theme-card theme-swatch-${t.key}` + (locked ? ' locked' : '') + (((myProfile.theme || 'dark') === t.key) ? ' selected' : '');
    card.innerHTML = `<span>${esc(t.name)}</span>` + (locked ? `<span class="lock-badge">${icon('shield')}</span>` : '');
    card.onclick = async () => {
      if (locked) { openPremiumModal(); return; }
      await db.collection('users').doc(myUid).update({ theme: t.key });
    };
    themeGrid.appendChild(card);
  });
}

function questRowsHTML(profile) {
  const stats = profile.dailyStats || {};
  const claimed = profile.claimedQuestsToday || [];
  return QUESTS.map(q => {
    const progress = Math.min(stats[q.stat] || 0, q.goal);
    const pct = Math.round((progress / q.goal) * 100);
    const done = progress >= q.goal;
    const isClaimed = claimed.includes(q.id);
    return `
    <div class="quest-row">
      <div class="quest-info">
        <div class="quest-title">${esc(q.title)}</div>
        <div class="quest-desc">${esc(q.desc)}</div>
        <div class="quest-bar"><div class="quest-bar-fill" style="width:${pct}%"></div></div>
        <div class="quest-progress">${progress} / ${q.goal}</div>
      </div>
      <div class="quest-reward">
        <span class="orb-chip small">${icon('orb')}${q.reward}</span>
        ${isClaimed
          ? '<span class="quest-claimed">Claimed</span>'
          : (done ? `<button class="btn-accent-inline slim" data-qid="${q.id}">Claim</button>` : '<span class="quest-locked">In progress</span>')}
      </div>
    </div>`;
  }).join('');
}
async function renderQuests() {
  myProfile = await ensureQuestsFresh(myProfile);
  const html = questRowsHTML(myProfile);
  [$('quests-list'), $('quests-list-main')].forEach(el => { if (el) el.innerHTML = html; });
  document.querySelectorAll('#quests-list [data-qid], #quests-list-main [data-qid]').forEach(btn => {
    btn.onclick = () => claimQuest(btn.dataset.qid);
  });
  const note = 'Quests refresh every day at midnight.';
  if ($('quests-reset-note-main')) $('quests-reset-note-main').textContent = note;
}

async function claimQuest(id) {
  const q = QUESTS.find(x => x.id === id);
  if (!q) return;
  const fresh = await ensureQuestsFresh((await db.collection('users').doc(myUid).get()).data());
  const stats = fresh.dailyStats || {};
  const claimed = fresh.claimedQuestsToday || [];
  if (claimed.includes(id) || (stats[q.stat] || 0) < q.goal) return;
  try {
    await db.collection('users').doc(myUid).update({
      orbs: FieldValue.increment(q.reward),
      claimedQuestsToday: FieldValue.arrayUnion(id),
    });
    toast(`+${q.reward} Orbs — ${q.title} complete!`);
  } catch (e) { toast('Could not claim reward.', 'error'); }
}

$('save-account-btn').onclick = async () => {
  const uname = $('set-username').value.trim();
  if (!uname || uname === myProfile.username) { toast('Nothing to change.'); return; }
  toast("Username can't be changed after registration — it's your document ID.", 'error');
  $('set-username').value = myProfile.username;
};

// ============================================================
// ADMIN PANEL (Toblox-style: password hash in Firestore, OPs skip it)
// ============================================================
async function getAdminHash() {
  try {
    const d = await db.collection('config').doc('admin').get();
    if (d.exists && d.data().passHash) return d.data().passHash;
    await db.collection('config').doc('admin').set({ passHash: ADMIN_HASH });
  } catch (e) { console.warn('admin config', e); }
  return ADMIN_HASH;
}

function openAdminEntry() {
  if (isAdmin) { openAdminPanel(); return; }
  $('admin-pass-input').value = '';
  $('admin-login-error').textContent = '';
  openModal('admin-login-modal');
  setTimeout(() => $('admin-pass-input').focus(), 60);
}

$('admin-login-submit').onclick = submitAdminLogin;
$('admin-pass-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAdminLogin(); });

async function submitAdminLogin() {
  $('admin-login-error').textContent = 'Checking...';
  const entered = await sha256($('admin-pass-input').value);
  const stored = await getAdminHash();
  if (entered === stored) {
    isAdmin = true;
    closeModal('admin-login-modal');
    openAdminPanel();
  } else {
    $('admin-login-error').textContent = 'Wrong password.';
  }
}

let adminSelectedUser = null;
function openAdminPanel() {
  openModal('admin-panel-modal');
  adminSelectedUser = null;
  renderAdminList();
}
$('admin-search').addEventListener('input', renderAdminList);

document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('on'));
    tab.classList.add('on');
    document.querySelectorAll('.admin-pane').forEach(p => p.classList.add('hidden'));
    $('admin-pane-' + tab.dataset.adminTab).classList.remove('hidden');
    if (tab.dataset.adminTab === 'emojis') renderAdminEmojiList();
    if (tab.dataset.adminTab === 'stickers') renderAdminStickerList();
    if (tab.dataset.adminTab === 'filter') renderAdminFilterList();
    if (tab.dataset.adminTab === 'codes') renderAdminCodesList();
    if (tab.dataset.adminTab === 'conversations') renderAdminConversationsList();
  };
});

$('gen-code-btn').onclick = async () => {
  const type = $('gen-code-type').value;
  const value = parseInt($('gen-code-value').value || '0', 10);
  const custom = $('gen-code-custom').value.trim();
  if (!value || value < 1) { toast('Enter an amount.'); return; }
  try {
    const code = await createRedeemCode(type, value, myUid, custom);
    toast(`Generated ${code}`);
    $('gen-code-value').value = '';
    $('gen-code-custom').value = '';
    renderAdminCodesList();
  } catch (e) { toast(e.message || 'Could not generate code.', 'error'); }
};

async function renderAdminConversationsList() {
  const wrap = $('admin-conversations-list');
  wrap.innerHTML = '<div class="empty">Loading...</div>';
  const rows = [];
  try {
    const dmSnap = await db.collection('dms').get();
    dmSnap.forEach(d => rows.push({ label: d.id, ref: d.ref, autoDelete: d.data().autoDelete !== false }));

    const gSnap = await db.collection('groupDMs').get();
    gSnap.forEach(d => {
      const data = d.data();
      const label = 'Group: ' + (data.name || (data.participants || []).join(', '));
      rows.push({ label, ref: d.ref, autoDelete: data.autoDelete !== false });
    });

    const serversSnap = await db.collection('servers').get();
    for (const sDoc of serversSnap.docs) {
      const sData = sDoc.data();
      const chSnap = await sDoc.ref.collection('channels').get();
      chSnap.forEach(c => {
        rows.push({ label: `${sData.name} / #${c.data().name}`, ref: c.ref, autoDelete: c.data().autoDelete !== false });
      });
    }
  } catch (e) { wrap.innerHTML = '<div class="empty">Could not load conversations.</div>'; return; }

  wrap.innerHTML = rows.length ? rows.map((r, i) => `
    <div class="admin-row conv-row" style="cursor:default;">
      <span class="ar-name">${esc(r.label)}</span>
      <label class="toggle-switch">
        <input type="checkbox" data-conv-idx="${i}" ${r.autoDelete ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <span class="ab-note">Auto-delete (7d)</span>
    </div>`).join('') : '<div class="empty">No conversations yet.</div>';

  wrap.querySelectorAll('[data-conv-idx]').forEach(input => {
    input.onchange = async () => {
      const row = rows[parseInt(input.dataset.convIdx, 10)];
      try { await row.ref.update({ autoDelete: input.checked }); }
      catch (e) { toast('Could not update.', 'error'); input.checked = !input.checked; }
    };
  });
}

function resizeImageToDataURLSized(file, w, h) { return resizeImageToDataURL(file, w, h); }

$('admin-sticker-publish').onclick = async () => {
  const file = $('admin-sticker-file').files[0];
  const name = ($('admin-sticker-name').value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!file) { toast('Choose an image first.'); return; }
  if (!name) { toast('Enter a name (letters, numbers, underscore).'); return; }
  try {
    const existing = await db.collection('stickers').doc(name).get();
    if (existing.exists) { toast('That sticker name is already taken.'); return; }
    const dataUrl = await resizeImageToDataURL(file, 160, 160);
    await db.collection('stickers').doc(name).set({ name, dataUrl, createdBy: myUid, createdAt: FieldValue.serverTimestamp() });
    $('admin-sticker-file').value = '';
    $('admin-sticker-name').value = '';
    toast(`Published sticker "${name}"`);
  } catch (e) { toast(e.message || 'Failed to publish sticker.', 'error'); }
};
async function renderAdminStickerList() {
  const wrap = $('admin-sticker-list');
  wrap.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const snap = await db.collection('stickers').get();
    const items = [];
    snap.forEach(d => items.push(d.data()));
    wrap.innerHTML = items.length
      ? items.map(s => `<div class="admin-emoji-chip" data-n="${esc(s.name)}"><img src="${s.dataUrl}" alt="" style="width:32px;height:32px;"><span>${esc(s.name)}</span><span class="rm" title="Delete">${icon('trash')}</span></div>`).join('')
      : '<div class="empty">No stickers yet.</div>';
    wrap.querySelectorAll('.admin-emoji-chip .rm').forEach(btn => {
      btn.onclick = async () => { await db.collection('stickers').doc(btn.closest('.admin-emoji-chip').dataset.n).delete(); renderAdminStickerList(); };
    });
  } catch (e) { wrap.innerHTML = '<div class="empty">Could not load stickers.</div>'; }
}

async function renderAdminCodesList() {
  const wrap = $('admin-codes-list');
  wrap.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const snap = await db.collection('redeemCodes').orderBy('createdAt', 'desc').limit(50).get();
    const rows = [];
    snap.forEach(d => rows.push(d.data()));
    wrap.innerHTML = rows.length ? rows.map(r => `
      <div class="admin-row" style="cursor:default;">
        <span class="ar-name" style="font-family:monospace;">${esc(r.code)}</span>
        <span class="ab-note">${r.type === 'premium' ? r.value + 'd Premium' : r.value + ' Orbs'}</span>
        <span class="${r.redeemedBy ? 'ban-tag' : 'op-tag'}">${r.redeemedBy ? ('Used by ' + esc(r.redeemedBy)) : 'Unused'}</span>
      </div>`).join('') : '<div class="empty">No codes generated yet.</div>';
  } catch (e) { wrap.innerHTML = '<div class="empty">Could not load codes.</div>'; }
}

function resizeImageToDataURL(file, w, h) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        const scale = Math.min(w / img.width, h / img.height);
        const dw = img.width * scale, dh = img.height * scale;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

$('admin-emoji-publish').onclick = async () => {
  const file = $('admin-emoji-file').files[0];
  const name = ($('admin-emoji-name').value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!file) { toast('Choose an image first.'); return; }
  if (!name) { toast('Enter a shortcode name (letters, numbers, underscore).'); return; }
  if (customEmojis[name]) { toast('That shortcode is already taken.'); return; }
  try {
    const dataUrl = await resizeImageToDataURL(file, 48, 48);
    await db.collection('customEmojis').doc(name).set({ name, dataUrl, createdBy: myUid, createdAt: FieldValue.serverTimestamp() });
    $('admin-emoji-file').value = '';
    $('admin-emoji-name').value = '';
    toast(`Published :${name}:`);
  } catch (e) { toast(e.message || 'Failed to publish emoji.', 'error'); }
};

function renderAdminEmojiList() {
  const wrap = $('admin-emoji-list');
  const names = Object.keys(customEmojis).sort();
  wrap.innerHTML = names.length
    ? names.map(n => `<div class="admin-emoji-chip" data-n="${esc(n)}"><img src="${customEmojis[n].dataUrl}" alt=""><span>:${esc(n)}:</span><span class="rm" title="Delete">${icon('trash')}</span></div>`).join('')
    : '<div class="empty">No custom emojis yet.</div>';
  wrap.querySelectorAll('.admin-emoji-chip .rm').forEach(btn => {
    btn.onclick = async () => { await db.collection('customEmojis').doc(btn.closest('.admin-emoji-chip').dataset.n).delete(); };
  });
}

$('admin-filter-add').onclick = async () => {
  const word = ($('admin-filter-word').value || '').trim().toLowerCase();
  if (!word) { toast('Enter a word first.'); return; }
  if (filteredWords.includes(word)) { toast('That word is already filtered.'); return; }
  try {
    await db.collection('config').doc('filter').set({ words: FieldValue.arrayUnion(word) }, { merge: true });
    $('admin-filter-word').value = '';
  } catch (e) { toast('Could not add word.', 'error'); }
};
$('admin-filter-word').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('admin-filter-add').click(); });

function renderAdminFilterList() {
  const wrap = $('admin-filter-list');
  wrap.innerHTML = filteredWords.length
    ? filteredWords.slice().sort().map(w => `<div class="admin-emoji-chip" data-w="${esc(w)}"><span>${esc(w)}</span><span class="rm" title="Remove">${icon('trash')}</span></div>`).join('')
    : '<div class="empty">No filtered words yet.</div>';
  wrap.querySelectorAll('.admin-emoji-chip .rm').forEach(btn => {
    btn.onclick = async () => {
      const w = btn.closest('.admin-emoji-chip').dataset.w;
      await db.collection('config').doc('filter').set({ words: FieldValue.arrayRemove(w) }, { merge: true });
    };
  });
}

async function renderAdminList() {
  const list = $('admin-user-list');
  const q = ($('admin-search').value || '').toLowerCase();
  list.innerHTML = '<div class="empty">Loading...</div>';
  let users = [];
  try {
    const snap = await db.collection('users').get();
    snap.forEach(d => users.push(d.data()));
  } catch (e) { list.innerHTML = '<div class="empty">Could not load users.</div>'; return; }
  users = users.filter(u => !q || u.username.toLowerCase().includes(q)).sort((a, b) => a.username.localeCompare(b.username));
  list.innerHTML = users.map(u => {
    const ban = banStatus(u);
    return `<div class="admin-row ${adminSelectedUser === u.username ? 'on' : ''}" data-u="${esc(u.username)}">
      ${avatarHTML(30, u.avatarColor, initials(u.username), null, u.avatarUrl)}
      <span class="ar-name">${esc(u.username)}</span>
      ${u.op ? '<span class="op-tag">Admin</span>' : ''}${ban.banned ? '<span class="ban-tag">Banned</span>' : ''}
    </div>`;
  }).join('') || '<div class="empty">No users found.</div>';
  list.querySelectorAll('.admin-row').forEach(row => {
    row.onclick = () => { adminSelectedUser = row.dataset.u; renderAdminList(); renderAdminActions(); };
  });
  renderAdminActions();
}

async function renderAdminActions() {
  const wrap = $('admin-actions');
  if (!adminSelectedUser) { wrap.innerHTML = '<div class="empty">Select a user to manage.</div>'; return; }
  const snap = await db.collection('users').doc(adminSelectedUser).get();
  if (!snap.exists) { wrap.innerHTML = '<div class="empty">User not found.</div>'; adminSelectedUser = null; return; }
  const u = snap.data();
  const ban = banStatus(u);
  wrap.innerHTML = `
    <div class="admin-sel-head">${avatarHTML(44, u.avatarColor, initials(u.username), null, u.avatarUrl)}<div><div class="as-name">${esc(u.username)}${u.op ? '<span class="op-tag">Admin</span>' : ''}</div><div class="as-sub">${ban.banned ? ('Banned — ' + esc(ban.reason)) : 'Not banned'}</div></div></div>
    <div class="admin-block">
      <div class="ab-title">Orbs — Balance: ${u.orbs || 0}</div>
      <div class="ab-row">
        <input id="admin-orbs-amt" type="number" min="1" placeholder="Amount" class="fld-input">
        <button class="btn-accent-inline slim" id="admin-orbs-grant">Grant</button>
        <button class="btn-secondary slim" id="admin-orbs-remove">Remove</button>
      </div>
    </div>
    <div class="admin-block">
      <div class="ab-title">Frixion Premium — ${isPremium(u) ? ('Active until ' + new Date(u.premiumUntil).toLocaleDateString()) : 'Not active'}</div>
      <div class="ab-row">
        <input id="admin-premium-days" type="number" min="1" placeholder="Days" class="fld-input">
        <button class="btn-accent-inline slim" id="admin-premium-grant">Grant</button>
        <button class="btn-secondary slim" id="admin-premium-remove">Remove</button>
      </div>
    </div>
    <div class="admin-block">
      <div class="ab-title">Operator</div>
      <div class="ab-row">
        <span class="ab-note">${u.op ? 'This user has full admin access with no password.' : 'Not an operator.'}</span>
        ${u.op
          ? `<button class="btn-secondary slim" id="admin-deop-btn">Remove Admin</button>`
          : `<button class="btn-accent-inline slim" id="admin-op-btn">Make Admin</button>`}
      </div>
    </div>
    <div class="admin-block">
      <div class="ab-title">Temporary Ban</div>
      <div class="ab-row">
        <input id="admin-ban-dur" type="number" min="1" placeholder="Duration" class="fld-input">
        <select id="admin-ban-unit" class="fld-input">
          <option value="60000">Minutes</option>
          <option value="3600000" selected>Hours</option>
          <option value="86400000">Days</option>
        </select>
      </div>
      <input id="admin-ban-reason" type="text" placeholder="Reason" class="fld-input" style="margin-top:8px" maxlength="120">
      <div class="ab-row" style="margin-top:8px">
        <button class="btn-danger slim" id="admin-ban-btn">Ban</button>
        ${ban.banned ? '<button class="btn-secondary slim" id="admin-unban-btn">Unban</button>' : ''}
      </div>
    </div>
    <div class="admin-block">
      <div class="ab-title">Danger Zone</div>
      <button class="btn-danger" id="admin-delete-btn">Delete Account</button>
    </div>`;

  $('admin-orbs-grant').onclick = () => adminAdjustOrbs(u.username, 1);
  $('admin-orbs-remove').onclick = () => adminAdjustOrbs(u.username, -1);
  $('admin-premium-grant').onclick = () => adminAdjustPremium(u.username, 1);
  $('admin-premium-remove').onclick = () => adminAdjustPremium(u.username, -1);
  if (u.op) $('admin-deop-btn').onclick = () => adminSetOp(u.username, false);
  else $('admin-op-btn').onclick = () => adminSetOp(u.username, true);
  $('admin-ban-btn').onclick = adminBan;
  if (ban.banned) $('admin-unban-btn').onclick = adminUnban;
  $('admin-delete-btn').onclick = adminDelete;
}

async function adminAdjustPremium(username, sign) {
  const days = parseInt($('admin-premium-days').value || '0', 10);
  if (!days || days < 1) { toast('Enter a number of days.'); return; }
  try {
    const snap = await db.collection('users').doc(username).get();
    const u = snap.data();
    if (sign > 0) {
      const base = isPremium(u) ? u.premiumUntil : Date.now();
      await db.collection('users').doc(username).update({ premiumUntil: base + days * 86400000 });
    } else {
      const base = isPremium(u) ? u.premiumUntil : Date.now();
      const newUntil = Math.max(Date.now() - 1, base - days * 86400000);
      await db.collection('users').doc(username).update({ premiumUntil: newUntil });
    }
    toast(`${sign > 0 ? 'Granted' : 'Removed'} ${days} days of Premium ${sign > 0 ? 'to' : 'from'} ${username}.`);
    renderAdminActions();
  } catch (e) { toast('Could not update Premium.', 'error'); }
}

async function adminAdjustOrbs(username, sign) {
  const amt = parseInt($('admin-orbs-amt').value || '0', 10);
  if (!amt || amt < 1) { toast('Enter an amount.'); return; }
  try {
    await db.collection('users').doc(username).update({ orbs: FieldValue.increment(sign * amt) });
    toast(`${sign > 0 ? 'Granted' : 'Removed'} ${amt} Orbs ${sign > 0 ? 'to' : 'from'} ${username}.`);
    renderAdminActions();
  } catch (e) { toast('Could not update Orbs.', 'error'); }
}

async function adminSetOp(username, val) {
  await db.collection('users').doc(username).update({ op: val });
  if (username === myUid) isAdmin = val;
  toast(val ? `Made ${username} an admin.` : `Removed admin from ${username}.`);
  renderAdminList();
}

async function adminBan() {
  const dur = parseInt($('admin-ban-dur').value || '0', 10);
  const unit = parseInt($('admin-ban-unit').value, 10);
  const reason = ($('admin-ban-reason').value || '').trim() || 'No reason given';
  if (!adminSelectedUser || !dur || dur < 1) { toast('Enter a duration.'); return; }
  const until = Date.now() + dur * unit;
  await db.collection('users').doc(adminSelectedUser).update({ banned: true, banReason: reason, bannedUntil: until });
  toast(`Banned ${adminSelectedUser}.`);
  renderAdminList(); renderAdminActions();
}
async function adminUnban() {
  if (!adminSelectedUser) return;
  await db.collection('users').doc(adminSelectedUser).update({ banned: false, banReason: '', bannedUntil: null });
  toast(`Unbanned ${adminSelectedUser}.`);
  renderAdminList(); renderAdminActions();
}
async function adminDelete() {
  if (!adminSelectedUser) return;
  if (!confirm(`Permanently delete ${adminSelectedUser}'s account?`)) return;
  await db.collection('users').doc(adminSelectedUser).delete();
  toast(`Deleted ${adminSelectedUser}.`);
  adminSelectedUser = null;
  renderAdminList();
}

// ============================================================
// BOOT
// ============================================================
// Best-effort only: browsers don't guarantee an async write finishes before
// the page actually unloads, so a hard-closed tab can still get stuck
// showing "online" until the next login. There's no full presence system
// here (that needs Firebase Realtime Database's onDisconnect, not Firestore).
window.addEventListener('beforeunload', () => {
  if (myUid) { try { db.collection('users').doc(myUid).update({ status: 'offline' }); } catch (e) {} }
});

boot();
