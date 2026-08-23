/* ============================================
   FRIXION — script.js
   A Discord-style client backed by Firebase Firestore.

   AUTH: username + password only, no email — accounts are
   documents at users/{username}, same pattern as Toblox.
   NOTE: passwords are stored as plain fields on that doc,
   matching how the Toblox account system works. Fine for a
   personal project; don't reuse a real password here.

   ADMIN: password below is hashed (SHA-256) and checked
   against a hash stored in Firestore at config/admin, same
   as Toblox's admin panel. Operators (op:true on their user
   doc) skip the password entirely, same as Toblox.

   REQUIRED Firestore security rules (Firebase Console >
   Firestore > Rules):

   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{username} {
         allow read: if request.auth == null || true;
         allow write: if true;
       }
       match /config/{doc} {
         allow read: if true;
         allow write: if true;
       }
       match /servers/{sid} {
         allow read, write: if true;
         match /channels/{cid} {
           allow read, write: if true;
           match /messages/{mid} { allow read, write: if true; }
         }
       }
       match /dms/{did} {
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

// ---------- constants ----------
const SESSION_KEY = 'frixion_user';
const ADMIN_HASH = 'f7c323a01e4a88630c1301300a5212a6d21c874c5dee36d26de35cb9b75ca8d4'; // sha256("theflyisflying")

const AVATAR_COLORS = ['#5865f2','#eb459e','#ed4245','#f0b232','#23a55a','#00a8fc','#9b59b6','#e67e22','#1abc9c'];
const THEMES = [
  { key: 'default', name: 'Frixion Dark', premium: false },
  { key: 'void',     name: 'Void',        premium: true },
  { key: 'crimson',  name: 'Crimson',     premium: true },
  { key: 'emerald',  name: 'Emerald',     premium: true },
  { key: 'sunset',   name: 'Sunset',      premium: true },
  { key: 'glacier',  name: 'Glacier',     premium: true },
];
const STATUSES = [
  { key: 'online', label: 'Online' },
  { key: 'idle', label: 'Idle' },
  { key: 'dnd', label: 'Do Not Disturb' },
  { key: 'offline', label: 'Invisible' },
];

// ============================================================
// UPDATE LOG — newest first. Add a new entry after every update.
// ============================================================
const UPDATES = [
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
};
function icon(name, cls) { return `<span class="i ${cls||''}">${ICONS[name] || ''}</span>`; }

// ---------- emoji: reactions + shortcodes + custom (uploaded via Admin Panel) ----------
const REACT_EMOJIS = ['👍','❤️','😂','🔥','😮','😢','🎉'];
const SHORTCODE_MAP = {
  smile:'😄', grin:'😁', joy:'😂', rofl:'🤣', wink:'😉', blush:'😊', sunglasses:'😎',
  heart_eyes:'😍', kissing_heart:'😘', thinking:'🤔', neutral:'😐', unamused:'😒',
  sob:'😭', cry:'😢', angry:'😠', rage:'😡', scream:'😱', open_mouth:'😮', flushed:'😳',
  sleepy:'😴', mask:'😷', clown:'🤡', ghost:'👻', skull:'💀', robot:'🤖', alien:'👽',
  poop:'💩', heart:'❤️', broken_heart:'💔', sparkling_heart:'💖', fire:'🔥', star:'⭐',
  sparkles:'✨', tada:'🎉', confetti:'🎊', hundred:'💯', boom:'💥', zzz:'💤', eyes:'👀',
  thumbsup:'👍', thumbsdown:'👎', clap:'👏', wave:'👋', pray:'🙏', muscle:'💪',
  ok_hand:'👌', point_up:'☝️', v:'✌️', crossed_fingers:'🤞',
  dog:'🐶', cat:'🐱', fox:'🦊', unicorn:'🦄', frog:'🐸', chicken:'🐔',
  pizza:'🍕', hamburger:'🍔', fries:'🍟', taco:'🌮', coffee:'☕', beer:'🍺', cake:'🎂',
  rocket:'🚀', gem:'💎', crown:'👑', trophy:'🏆', bulb:'💡', warning:'⚠️', check:'✅', x:'❌',
};
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
  return safe.replace(/:([a-z0-9_]+):/gi, (whole, name) => {
    const key = name.toLowerCase();
    if (customEmojis[key]) return `<img class="custom-emoji" src="${customEmojis[key].dataUrl}" alt=":${esc(key)}:" title=":${esc(key)}:">`;
    if (SHORTCODE_MAP[key]) return `<span class="native-emoji">${SHORTCODE_MAP[key]}</span>`;
    return whole;
  });
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
let currentView = 'none';
let lastRawMessages = [];
let lastChannelsList = [];

let unsub = { servers: null, channels: null, messages: null, dms: null, self: null };

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
function avatarHTML(size, color, letter, status) {
  return `<div class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.42)}px;background:${color}">${esc(letter)}${
    status ? `<span class="status-dot ${status}"></span>` : ''
  }</div>`;
}
function premiumStar(profile) { return profile && profile.premium ? icon('star', 'premium-star') : ''; }
function opTag(profile) { return profile && profile.op ? '<span class="op-tag">Admin</span>' : ''; }
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
  if (profileCache[uid]) return profileCache[uid];
  try {
    const snap = await db.collection('users').doc(uid).get();
    const data = snap.exists ? snap.data() : { username: uid, avatarColor: '#5865f2', status: 'offline', premium: false };
    profileCache[uid] = data;
    return data;
  } catch (e) {
    return { username: uid, avatarColor: '#5865f2', status: 'offline', premium: false };
  }
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
$('rail-explore').onclick = () => toast('Server discovery is coming soon.');

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

async function boot() {
  const saved = getSession();
  if (!saved) { showAuthScreen(); return; }
  const snap = await db.collection('users').doc(saved).get();
  if (!snap.exists) { setSession(null); showAuthScreen(); return; }
  const data = snap.data();
  const ban = banStatus(data);
  if (ban.banned) { setSession(null); showAuthScreen(); $('login-error').textContent = `You're banned: ${ban.reason}`; return; }
  myUid = saved;
  myProfile = data;
  profileCache[myUid] = data;
  enterApp();
}

function showAuthScreen() {
  $('auth-screen').classList.remove('hidden');
  $('app').classList.add('hidden');
  $('login-view').classList.remove('hidden');
  $('register-view').classList.add('hidden');
}

function enterApp() {
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
    await db.collection('users').doc(username).update({ status: data.status === 'offline' ? 'online' : data.status });
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
      premium: false, theme: 'default', op: false,
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
  try { if (myUid) await db.collection('users').doc(myUid).update({ status: 'offline' }); } catch (e) {}
  cleanupAllListeners();
  setSession(null);
  myUid = null; myProfile = null; profileCache = {}; isAdmin = false;
  currentServerId = null; currentServerData = null; currentChannelId = null;
  currentDMId = null; currentDMOtherUid = null; currentView = 'none';
  closeModal('settings-modal');
  showAuthScreen();
};

function cleanupAllListeners() {
  if (unsub.servers) unsub.servers();
  if (unsub.channels) unsub.channels();
  if (unsub.messages) unsub.messages();
  if (unsub.dms) unsub.dms();
  if (unsub.self) unsub.self();
  unsub = { servers: null, channels: null, messages: null, dms: null, self: null };
}

// ============================================================
// APP INIT
// ============================================================
function initAppForUser() {
  unsub.self = db.collection('users').doc(myUid).onSnapshot(snap => {
    if (!snap.exists) return;
    myProfile = snap.data();
    profileCache[myUid] = myProfile;
    isAdmin = !!myProfile.op;
    applyTheme(myProfile.theme || 'default');
    renderSelfPanel();
    if (!$('settings-modal').classList.contains('hidden')) populateSettings();
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
  showHomeView();
}

function applyTheme(themeKey) {
  document.body.className = '';
  if (themeKey && themeKey !== 'default') document.body.classList.add('theme-' + themeKey);
}

function renderSelfPanel() {
  if (!myProfile) return;
  $('self-avatar').outerHTML = `<div class="avatar" id="self-avatar" style="width:32px;height:32px;font-size:13px;background:${myProfile.avatarColor}">${initials(myProfile.username)}<span class="status-dot ${myProfile.status || 'online'}"></span></div>`;
  $('self-username').innerHTML = esc(myProfile.username) + premiumStar(myProfile) + opTag(myProfile);
  const st = STATUSES.find(s => s.key === (myProfile.status || 'online'));
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
$('rail-premium').onclick = () => openPremiumModal();

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
    await ref.collection('channels').add({ name: 'general', createdAt: FieldValue.serverTimestamp() });
    $('new-server-name').value = '';
    closeModal('create-server-modal');
    toast('Server created.');
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
    }
    $('join-server-code').value = '';
    closeModal('join-server-modal');
    selectServer({ id: doc.id, ...doc.data() });
    toast('Joined server.');
  } catch (e) { $('join-server-error').textContent = e.message; }
};

// ============================================================
// HOME VIEW (DMs)
// ============================================================
function showHomeView() {
  currentServerId = null; currentServerData = null; currentChannelId = null;
  currentView = 'none'; currentDMId = null; currentDMOtherUid = null;
  if (unsub.channels) { unsub.channels(); unsub.channels = null; }
  if (unsub.messages) { unsub.messages(); unsub.messages = null; }
  $('rail-home').classList.add('active');
  document.querySelectorAll('#server-rail-list .rail-item').forEach(e => e.classList.remove('active'));
  $('side-header-title').textContent = 'Direct Messages';
  $('dm-list').classList.remove('hidden');
  $('channel-list').classList.add('hidden');
  $('members-toggle').classList.add('hidden');
  $('app').classList.remove('member-list-open');
  hideHeaderActions();
  showWelcome();
  renderDMRows();
}

function subscribeDMList() {
  if (unsub.dms) unsub.dms();
  unsub.dms = db.collection('dms').where('participants', 'array-contains', myUid).onSnapshot(async snap => {
    const dms = [];
    snap.forEach(d => dms.push({ id: d.id, ...d.data() }));
    window.__myDMs = dms;
    await Promise.all(dms.map(dm => getProfile(dm.participants.find(p => p !== myUid))));
    if (currentView !== 'channel') renderDMRows();
  });
}

function renderDMRows() {
  const wrap = $('dm-rows');
  wrap.innerHTML = '';
  const dms = window.__myDMs || [];
  dms.forEach(dm => {
    const otherUid = dm.participants.find(p => p !== myUid);
    const p = profileCache[otherUid] || { username: '...', avatarColor: '#5865f2', status: 'offline' };
    const row = document.createElement('div');
    row.className = 'dm-row' + (currentDMId === dm.id ? ' active' : '');
    row.innerHTML = avatarHTML(32, p.avatarColor, initials(p.username), p.status || 'offline') +
      `<span class="dm-name">${esc(p.username)}${premiumStar(p)}${opTag(p)}</span>`;
    row.onclick = () => selectDM(dm.id, otherUid);
    wrap.appendChild(row);
  });
}

$('dm-add-btn').onclick = () => { $('new-dm-username').value = ''; $('new-dm-error').textContent = ''; openModal('new-dm-modal'); };

$('confirm-new-dm').onclick = async () => {
  const uname = $('new-dm-username').value.trim();
  $('new-dm-error').textContent = '';
  if (!uname) { $('new-dm-error').textContent = 'Enter a username.'; return; }
  if (uname === myProfile.username) { $('new-dm-error').textContent = "That's you!"; return; }
  try {
    const snap = await db.collection('users').doc(uname).get();
    if (!snap.exists) { $('new-dm-error').textContent = 'No user found with that username.'; return; }
    const otherUid = uname;
    profileCache[otherUid] = snap.data();
    const id = dmIdFor(myUid, otherUid);
    const ref = db.collection('dms').doc(id);
    const dsnap = await ref.get();
    if (!dsnap.exists) {
      await ref.set({ participants: [myUid, otherUid], createdAt: FieldValue.serverTimestamp() });
    }
    closeModal('new-dm-modal');
    selectDM(id, otherUid);
  } catch (e) { $('new-dm-error').textContent = e.message; }
};

async function selectDM(id, otherUid) {
  currentServerId = null; currentServerData = null; currentChannelId = null;
  currentView = 'dm'; currentDMId = id; currentDMOtherUid = otherUid;
  document.querySelectorAll('#server-rail-list .rail-item').forEach(e => e.classList.remove('active'));
  $('rail-home').classList.add('active');
  $('members-toggle').classList.add('hidden');
  $('app').classList.remove('member-list-open');
  const p = await getProfile(otherUid);
  $('chat-header-hash').textContent = '@';
  $('chat-header-title').textContent = p.username;
  $('composer-input').placeholder = `Message @${p.username}`;
  showHeaderActions();
  renderDMRows();
  showChat();
  if (unsub.messages) unsub.messages();
  unsub.messages = db.collection('dms').doc(id).collection('messages').orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      const msgs = [];
      snap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
      onMessagesUpdate(msgs);
    });
}

// ============================================================
// SERVER VIEW
// ============================================================
async function selectServer(server) {
  currentServerId = server.id;
  currentServerData = server;
  currentDMId = null; currentDMOtherUid = null;
  currentView = 'none';
  document.querySelectorAll('#server-rail-list .rail-item').forEach(e => e.classList.remove('active'));
  $('rail-home').classList.remove('active');
  [...$('server-rail-list').children].forEach(el => { if (el.dataset.id === server.id) el.classList.add('active'); });
  $('side-header-title').textContent = server.name;
  $('dm-list').classList.add('hidden');
  $('channel-list').classList.remove('hidden');
  showWelcome();
  subscribeChannels(server.id);
  renderMemberPanel(server);
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

function subscribeChannels(serverId) {
  if (unsub.channels) unsub.channels();
  unsub.channels = db.collection('servers').doc(serverId).collection('channels').orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      const channels = [];
      snap.forEach(d => channels.push({ id: d.id, ...d.data() }));
      lastChannelsList = channels;
      renderChannelRows(channels);
      if (!currentChannelId && channels.length) selectChannel(channels[0]);
    });
}

function renderChannelRows(channels) {
  const wrap = $('channel-rows');
  wrap.innerHTML = '';
  channels.forEach(c => {
    const row = document.createElement('div');
    row.className = 'channel-row' + (currentChannelId === c.id ? ' active' : '');
    row.innerHTML = `<span class="hash">#</span><span class="cname">${esc(c.name)}</span><span class="del-channel" title="Delete channel">${icon('trash')}</span>`;
    row.querySelector('.cname').onclick = () => selectChannel(c);
    row.querySelector('.del-channel').onclick = async (e) => {
      e.stopPropagation();
      if (currentServerData.ownerId !== myUid && !isAdmin) { toast('Only the server owner can delete channels.'); return; }
      if (!confirm(`Delete #${c.name}?`)) return;
      const msgSnap = await db.collection('servers').doc(currentServerId).collection('channels').doc(c.id).collection('messages').get();
      await Promise.all(msgSnap.docs.map(m => m.ref.delete()));
      await db.collection('servers').doc(currentServerId).collection('channels').doc(c.id).delete();
      if (currentChannelId === c.id) { currentChannelId = null; showWelcome(); }
    };
    wrap.appendChild(row);
  });
}

$('channel-add-btn').onclick = () => {
  if (!currentServerId) return;
  if (currentServerData.ownerId !== myUid && !isAdmin) { toast('Only the server owner can create channels.'); return; }
  $('new-channel-name').value = '';
  openModal('create-channel-modal');
};

$('confirm-create-channel').onclick = async () => {
  const name = sanitizeChannelName($('new-channel-name').value || '');
  if (!currentServerId) return;
  await db.collection('servers').doc(currentServerId).collection('channels').add({ name, createdAt: FieldValue.serverTimestamp() });
  closeModal('create-channel-modal');
};

function selectChannel(channel) {
  currentChannelId = channel.id;
  currentView = 'channel';
  $('chat-header-hash').textContent = '#';
  $('chat-header-title').textContent = channel.name;
  $('composer-input').placeholder = `Message #${channel.name}`;
  $('members-toggle').classList.remove('hidden');
  showHeaderActions();
  renderChannelRows(lastChannelsList);
  showChat();
  if (unsub.messages) unsub.messages();
  unsub.messages = db.collection('servers').doc(currentServerId).collection('channels').doc(channel.id)
    .collection('messages').orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      const msgs = [];
      snap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
      onMessagesUpdate(msgs);
    });
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
      ${avatarHTML(34, p.avatarColor, initials(p.username))}
      <div class="pr-body">
        <div class="pr-head"><span class="pr-author">${esc(p.username)}</span><span class="pr-time">${timeStr(m.createdAt)}</span></div>
        <div class="pr-text">${renderMessageText(m.text)}</div>
      </div>
      ${canPin() ? `<span class="pr-unpin" title="Unpin">${icon('trash')}</span>` : ''}
    </div>`;
  }).join('');
  wrap.querySelectorAll('.pr-unpin').forEach(btn => {
    btn.onclick = () => togglePin(btn.closest('.pinned-row').dataset.mid, true);
  });
}
async function togglePin(msgId, forceUnpin) {
  const msg = lastRawMessages.find(m => m.id === msgId);
  const newVal = forceUnpin ? false : !(msg && msg.pinned);
  const ref = currentView === 'channel'
    ? db.collection('servers').doc(currentServerId).collection('channels').doc(currentChannelId).collection('messages').doc(msgId)
    : db.collection('dms').doc(currentDMId).collection('messages').doc(msgId);
  try { await ref.update({ pinned: newVal }); } catch (e) { toast('Could not update pin.', 'error'); }
}

let searchActive = false;
$('search-toggle').onclick = () => {
  searchActive = !searchActive;
  $('search-toggle').classList.toggle('on', searchActive);
  $('search-bar').classList.toggle('hidden', !searchActive);
  if (searchActive) { $('search-input').value = ''; $('search-input').focus(); }
  renderMessages(lastRawMessages);
};
$('search-close').onclick = () => {
  searchActive = false;
  $('search-toggle').classList.remove('on');
  $('search-bar').classList.add('hidden');
  renderMessages(lastRawMessages);
};
$('search-input').addEventListener('input', () => renderMessages(lastRawMessages));
$('search-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('search-close').click(); });

function showHeaderActions() {
  $('mute-toggle').classList.remove('hidden');
  $('pins-toggle').classList.remove('hidden');
  $('search-toggle').classList.remove('hidden');
  updateMuteIcon();
  searchActive = false;
  $('search-toggle').classList.remove('on');
  $('search-bar').classList.add('hidden');
}
function hideHeaderActions() {
  $('mute-toggle').classList.add('hidden');
  $('pins-toggle').classList.add('hidden');
  $('search-toggle').classList.add('hidden');
  $('search-bar').classList.add('hidden');
}

function onMessagesUpdate(msgs) {
  lastRawMessages = msgs;
  renderMessages(msgs);
  if (!$('pinned-modal').classList.contains('hidden')) renderPinnedList(msgs.filter(m => m.pinned));
}

// ============================================================
// MEMBER PANEL
// ============================================================
$('members-toggle').onclick = () => $('app').classList.toggle('member-list-open');

async function renderMemberPanel(server) {
  const members = server.members || [];
  await Promise.all(members.map(uid => getProfile(uid)));
  const online = [], offline = [];
  members.forEach(uid => {
    const p = profileCache[uid] || { username: uid, avatarColor: '#5865f2', status: 'offline' };
    (p.status && p.status !== 'offline' ? online : offline).push({ uid, p });
  });
  $('online-count').textContent = online.length;
  $('offline-count').textContent = offline.length;
  const renderRows = (arr) => arr.map(({ uid, p }) => `
    <div class="member-row">
      ${avatarHTML(32, p.avatarColor, initials(p.username), p.status || 'offline')}
      <span class="mname${p.status !== 'offline' ? ' online-name' : ''}">${esc(p.username)}${premiumStar(p)}${opTag(p)}${uid === server.ownerId ? '<span class="owner-tag">Owner</span>' : ''}</span>
    </div>`).join('');
  $('member-rows-online').innerHTML = renderRows(online);
  $('member-rows-offline').innerHTML = renderRows(offline);
}

// ============================================================
// CHAT VIEW SWITCH
// ============================================================
function showWelcome() {
  $('welcome-view').classList.remove('hidden');
  $('chat-view').classList.add('hidden');
  $('chat-header-hash').textContent = '';
  $('chat-header-title').textContent = 'Select a conversation';
  $('members-toggle').classList.add('hidden');
  hideHeaderActions();
}
function showChat() {
  $('welcome-view').classList.add('hidden');
  $('chat-view').classList.remove('hidden');
}

function renderCurrentView() {
  if (currentView === 'channel' || currentView === 'dm') renderMessages(lastRawMessages);
  if (currentServerData) renderMemberPanel(currentServerData);
  renderDMRows();
}

// ============================================================
// MESSAGES
// ============================================================
function reactionsHTML(reactions) {
  if (!reactions) return '';
  const entries = Object.entries(reactions).filter(([, arr]) => arr && arr.length);
  if (!entries.length) return '';
  return `<div class="reaction-row">` + entries.map(([e, arr]) =>
    `<button type="button" class="reaction-pill${arr.includes(myUid) ? ' mine' : ''}" data-e="${esc(e)}">${e}<span>${arr.length}</span></button>`
  ).join('') + `</div>`;
}

function buildMessageLineEl(m, canDelete) {
  const pinnable = canPin();
  const line = document.createElement('div');
  line.className = 'msg-line' + (m.pinned ? ' is-pinned' : '');
  const rowWrap = document.createElement('div');
  rowWrap.className = 'msg-row-wrap';
  rowWrap.innerHTML =
    (m.pinned ? `<span class="pin-flag">${icon('pin')}Pinned</span>` : '') +
    `<span class="msg-text">${renderMessageText(m.text)}</span>` +
    `<span class="msg-hover-actions">` +
    `<span class="hover-icon-btn react-btn" title="Add Reaction">${icon('smiley')}</span>` +
    (pinnable ? `<span class="hover-icon-btn pin-msg${m.pinned ? ' on' : ''}" title="${m.pinned ? 'Unpin' : 'Pin Message'}">${icon('pin')}</span>` : '') +
    (canDelete ? `<span class="hover-icon-btn del-msg" title="Delete">${icon('trash')}</span>` : '') +
    `</span>`;
  rowWrap.querySelector('.react-btn').onclick = (e) => { e.stopPropagation(); toggleReactPopover(e.currentTarget, m.id); };
  if (pinnable) rowWrap.querySelector('.pin-msg').onclick = () => togglePin(m.id);
  if (canDelete) rowWrap.querySelector('.del-msg').onclick = () => deleteMessage(m.id);
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

async function renderMessages(rawMsgs) {
  const searching = searchActive;
  const q = searching ? ($('search-input').value || '').trim().toLowerCase() : '';
  const msgs = q ? rawMsgs.filter(m => (m.text || '').toLowerCase().includes(q)) : rawMsgs;
  if (searching) $('search-count').textContent = q ? `${msgs.length} result${msgs.length === 1 ? '' : 's'}` : '';

  const uids = [...new Set(msgs.map(m => m.uid))];
  await Promise.all(uids.map(u => getProfile(u)));
  const wrap = $('messages');
  const wasAtBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;
  wrap.innerHTML = '';

  if (searching && q && !msgs.length) {
    wrap.innerHTML = '<div class="empty" style="padding:20px 16px;">No messages match your search.</div>';
    return;
  }

  let lastUid = null, lastMillis = 0, lastDay = null, groupEl = null;

  msgs.forEach(m => {
    const millis = m.createdAt && m.createdAt.toMillis ? m.createdAt.toMillis() : Date.now();
    const day = dayStr(m.createdAt) || 'Today';
    if (day !== lastDay) {
      const div = document.createElement('div');
      div.className = 'day-divider';
      div.textContent = day;
      wrap.appendChild(div);
      lastDay = day; lastUid = null;
    }
    const p = profileCache[m.uid] || { username: m.username || 'Unknown User', avatarColor: '#5865f2' };
    const sameGroup = !searching && m.uid === lastUid && (millis - lastMillis) < 5 * 60 * 1000;
    const canDelete = m.uid === myUid || isAdmin || (currentServerData && currentServerData.ownerId === myUid);

    if (sameGroup && groupEl) {
      groupEl.querySelector('.msg-body').appendChild(buildMessageLineEl(m, canDelete));
    } else {
      groupEl = document.createElement('div');
      groupEl.className = 'msg-group';
      const body = document.createElement('div');
      body.className = 'msg-body';
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      meta.innerHTML = `<span class="author${m.uid === myUid ? ' own' : ''}">${esc(p.username)}${premiumStar(p)}${opTag(p)}</span><span class="time">${timeStr(m.createdAt)}</span>`;
      body.appendChild(meta);
      body.appendChild(buildMessageLineEl(m, canDelete));
      groupEl.innerHTML = avatarHTML(40, p.avatarColor, initials(p.username));
      groupEl.appendChild(body);
      wrap.appendChild(groupEl);
    }
    lastUid = m.uid; lastMillis = millis;
  });

  if (!searching && (wasAtBottom || msgs.length <= 20)) wrap.scrollTop = wrap.scrollHeight;
}

// ---------- reaction popover ----------
let openReactPopover = null;
function toggleReactPopover(anchorEl, msgId) {
  closeReactPopover();
  const pop = document.createElement('div');
  pop.className = 'react-popover';
  pop.innerHTML = REACT_EMOJIS.map(e => `<button type="button" class="react-pick">${e}</button>`).join('');
  document.body.appendChild(pop);
  const r = anchorEl.getBoundingClientRect();
  const pw = pop.offsetWidth || 260;
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8)) + 'px';
  pop.style.top = Math.max(8, r.top - pop.offsetHeight - 8) + 'px';
  pop.querySelectorAll('.react-pick').forEach((btn, i) => {
    btn.onclick = () => { toggleReaction(msgId, REACT_EMOJIS[i]); closeReactPopover(); };
  });
  openReactPopover = pop;
  setTimeout(() => document.addEventListener('click', outsideReactClose), 0);
}
function outsideReactClose(e) { if (openReactPopover && !openReactPopover.contains(e.target)) closeReactPopover(); }
function closeReactPopover() {
  if (openReactPopover) { openReactPopover.remove(); openReactPopover = null; document.removeEventListener('click', outsideReactClose); }
}

async function toggleReaction(msgId, emoji) {
  if (currentView !== 'channel' && currentView !== 'dm') return;
  const ref = currentView === 'channel'
    ? db.collection('servers').doc(currentServerId).collection('channels').doc(currentChannelId).collection('messages').doc(msgId)
    : db.collection('dms').doc(currentDMId).collection('messages').doc(msgId);
  const msg = lastRawMessages.find(m => m.id === msgId);
  const already = !!(msg && msg.reactions && (msg.reactions[emoji] || []).includes(myUid));
  try {
    await ref.update({ [`reactions.${emoji}`]: already ? FieldValue.arrayRemove(myUid) : FieldValue.arrayUnion(myUid) });
  } catch (e) { toast('Could not react.', 'error'); }
}

async function deleteMessage(id) {
  try {
    if (currentView === 'channel') {
      await db.collection('servers').doc(currentServerId).collection('channels').doc(currentChannelId).collection('messages').doc(id).delete();
    } else if (currentView === 'dm') {
      await db.collection('dms').doc(currentDMId).collection('messages').doc(id).delete();
    }
  } catch (e) { toast('Could not delete message.', 'error'); }
}

async function sendMessage() {
  const input = $('composer-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  autoResize(input);
  const payload = { text, uid: myUid, username: myProfile.username, createdAt: FieldValue.serverTimestamp() };
  try {
    if (currentView === 'channel') {
      await db.collection('servers').doc(currentServerId).collection('channels').doc(currentChannelId).collection('messages').add(payload);
    } else if (currentView === 'dm') {
      await db.collection('dms').doc(currentDMId).collection('messages').add(payload);
      await db.collection('dms').doc(currentDMId).update({ updatedAt: FieldValue.serverTimestamp() });
    }
  } catch (e) { toast('Failed to send message.', 'error'); }
}
$('send-btn').onclick = sendMessage;
$('composer-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px'; }
$('composer-input').addEventListener('input', (e) => autoResize(e.target));

// ---------- emoji picker (composer) ----------
function insertAtCursor(el, text) {
  const start = el.selectionStart != null ? el.selectionStart : el.value.length;
  const end = el.selectionEnd != null ? el.selectionEnd : el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  el.selectionStart = el.selectionEnd = pos;
  el.focus();
  autoResize(el);
}
function renderEmojiPickerGrids() {
  const q = ($('emoji-search').value || '').toLowerCase();
  const customWrap = $('ep-custom-grid');
  const stdWrap = $('ep-standard-grid');
  const customNames = Object.keys(customEmojis).filter(n => !q || n.includes(q)).sort();
  customWrap.innerHTML = customNames.length
    ? customNames.map(n => `<button type="button" title=":${esc(n)}:"><img src="${customEmojis[n].dataUrl}" alt=":${esc(n)}:"></button>`).join('')
    : '<div class="ep-empty">No custom emoji yet</div>';
  customWrap.querySelectorAll('button').forEach((btn, i) => { btn.onclick = () => insertAtCursor($('composer-input'), `:${customNames[i]}:`); });

  const stdNames = Object.keys(SHORTCODE_MAP).filter(n => !q || n.includes(q));
  stdWrap.innerHTML = stdNames.map(n => `<button type="button" title=":${esc(n)}:">${SHORTCODE_MAP[n]}</button>`).join('');
  stdWrap.querySelectorAll('button').forEach((btn, i) => { btn.onclick = () => insertAtCursor($('composer-input'), SHORTCODE_MAP[stdNames[i]]); });
}
$('emoji-picker-btn').onclick = (e) => {
  e.stopPropagation();
  const panel = $('emoji-picker-panel');
  const willOpen = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (willOpen) { $('emoji-search').value = ''; renderEmojiPickerGrids(); $('emoji-search').focus(); }
};
$('emoji-search').addEventListener('input', renderEmojiPickerGrids);
document.addEventListener('click', (e) => {
  const panel = $('emoji-picker-panel');
  if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !e.target.closest('#emoji-picker-btn')) {
    panel.classList.add('hidden');
  }
});

// ============================================================
// SETTINGS MODAL
// ============================================================
$('open-my-settings').onclick = openSettings;
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

  const swatchWrap = $('avatar-color-swatches');
  swatchWrap.innerHTML = '';
  AVATAR_COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (myProfile.avatarColor === c ? ' selected' : '');
    sw.style.background = c;
    sw.onclick = async () => { await db.collection('users').doc(myUid).update({ avatarColor: c }); };
    swatchWrap.appendChild(sw);
  });

  const statusWrap = $('status-picker');
  statusWrap.innerHTML = '';
  STATUSES.forEach(s => {
    const row = document.createElement('div');
    row.className = 'status-opt' + ((myProfile.status || 'online') === s.key ? ' selected' : '');
    row.innerHTML = `<span class="dot status-dot ${s.key}" style="position:static;border:none;"></span><span>${s.label}</span>`;
    row.onclick = async () => { await db.collection('users').doc(myUid).update({ status: s.key }); };
    statusWrap.appendChild(row);
  });

  const premOwned = !!myProfile.premium;
  $('premium-not-owned').classList.toggle('hidden', premOwned);
  $('premium-owned').classList.toggle('hidden', !premOwned);

  const themeGrid = $('theme-grid');
  themeGrid.innerHTML = '';
  THEMES.forEach(t => {
    const locked = t.premium && !myProfile.premium;
    const card = document.createElement('div');
    card.className = `theme-card theme-swatch-${t.key}` + (locked ? ' locked' : '') + (((myProfile.theme || 'default') === t.key) ? ' selected' : '');
    card.innerHTML = `<span>${esc(t.name)}</span>` + (locked ? `<span class="lock-badge">${icon('shield')}</span>` : '');
    card.onclick = async () => {
      if (locked) { openPremiumModal(); return; }
      await db.collection('users').doc(myUid).update({ theme: t.key });
    };
    themeGrid.appendChild(card);
  });
}

$('save-account-btn').onclick = async () => {
  const uname = $('set-username').value.trim();
  if (!uname || uname === myProfile.username) { toast('Nothing to change.'); return; }
  toast("Username can't be changed after registration — it's your document ID.", 'error');
  $('set-username').value = myProfile.username;
};

$('activate-premium-btn').onclick = activatePremium;
$('premium-modal-activate-btn').onclick = activatePremium;
async function activatePremium() {
  await db.collection('users').doc(myUid).update({ premium: true });
  toast('Frixion Premium activated.');
  closeModal('premium-modal');
  if (!$('settings-modal').classList.contains('hidden')) populateSettings();
}
function openPremiumModal() {
  const owned = myProfile && myProfile.premium;
  $('premium-modal-activate-btn').classList.toggle('hidden', !!owned);
  openModal('premium-modal');
}

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
  };
});

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
      ${avatarHTML(30, u.avatarColor, initials(u.username))}
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
    <div class="admin-sel-head">${avatarHTML(44, u.avatarColor, initials(u.username))}<div><div class="as-name">${esc(u.username)}${u.op ? '<span class="op-tag">Admin</span>' : ''}</div><div class="as-sub">${ban.banned ? ('Banned — ' + esc(ban.reason)) : 'Not banned'}</div></div></div>
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

  if (u.op) $('admin-deop-btn').onclick = () => adminSetOp(u.username, false);
  else $('admin-op-btn').onclick = () => adminSetOp(u.username, true);
  $('admin-ban-btn').onclick = adminBan;
  if (ban.banned) $('admin-unban-btn').onclick = adminUnban;
  $('admin-delete-btn').onclick = adminDelete;
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
boot();
