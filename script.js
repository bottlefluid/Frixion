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
const STATUSES = [
  { key: 'online', label: 'Online' },
  { key: 'idle', label: 'Idle' },
  { key: 'dnd', label: 'Do Not Disturb' },
  { key: 'offline', label: 'Invisible' },
];

// ---------- Frixion Premium economy ----------
const STARTING_ORBS = 50;
const PREMIUM_COST_ORBS = 1400;
const PREMIUM_DURATION_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
function isPremium(p) { return !!(p && p.premiumUntil && p.premiumUntil > Date.now()); }
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
};
function icon(name, cls) { return `<span class="i ${cls||''}">${ICONS[name] || ''}</span>`; }

// ---------- emoji: reactions + shortcodes + custom (uploaded via Admin Panel) ----------
const REACT_EMOJIS = ['👍','❤️','😂','🔥','😮','😢','🎉'];
const EMOJI_CATEGORIES = [
  { key: 'smileys', label: 'Smileys', icon: '😀', items: {
    grinning:'😀', smile:'😄', laughing:'😆', grin:'😁', joy:'😂', rofl:'🤣', slight_smile:'🙂',
    upside_down:'🙃', wink:'😉', blush:'😊', innocent:'😇', heart_eyes:'😍', star_struck:'🤩',
    kissing_heart:'😘', kissing:'😗', yum:'😋', stuck_out_tongue:'😛', sunglasses:'😎', smirk:'😏',
    unamused:'😒', neutral:'😐', expressionless:'😑', thinking:'🤔', zipper_mouth:'🤐',
    raised_eyebrow:'🤨', confused:'😕', worried:'😟', slight_frown:'🙁', frowning:'☹️',
    open_mouth:'😮', hushed:'😯', astonished:'😲', flushed:'😳', pleading:'🥺', cry:'😢',
    sob:'😭', scream:'😱', angry:'😠', rage:'😡', triumph:'😤', sleepy:'😪', sleeping:'😴',
    drooling:'🤤', mask:'😷', dizzy_face:'😵', exploding_head:'🤯', cowboy:'🤠', partying:'🥳',
    woozy:'🥴', nauseated:'🤢', shush:'🤫', clown:'🤡', poop:'💩', ghost:'👻', skull:'💀',
    alien:'👽', robot:'🤖',
  } },
  { key: 'people', label: 'People', icon: '👋', items: {
    wave:'👋', raised_hand:'✋', ok_hand:'👌', pinch:'🤏', vulcan:'🖖', crossed_fingers:'🤞',
    love_you:'🤟', metal:'🤘', point_up:'☝️', point_down:'👇', point_left:'👈', point_right:'👉',
    thumbsup:'👍', thumbsdown:'👎', fist:'✊', punch:'👊', clap:'👏', raised_hands:'🙌',
    pray:'🙏', handshake:'🤝', muscle:'💪', eyes:'👀', brain:'🧠', tongue:'👅', ear:'👂',
    nose:'👃', baby:'👶', boy:'👦', girl:'👧', man:'👨', woman:'👩', older_man:'👴',
    older_woman:'👵', cop:'👮', student:'🧑‍🎓', mage:'🧙', vampire:'🧛', zombie:'🧟',
    superhero:'🦸', supervillain:'🦹',
  } },
  { key: 'animals', label: 'Animals', icon: '🐶', items: {
    dog:'🐶', cat:'🐱', mouse:'🐭', hamster:'🐹', rabbit:'🐰', fox:'🦊', bear:'🐻',
    panda:'🐼', koala:'🐨', tiger:'🐯', lion:'🦁', cow:'🐮', pig:'🐷', frog:'🐸',
    monkey:'🐵', chicken:'🐔', penguin:'🐧', bird:'🐦', unicorn:'🦄', bee:'🐝',
    butterfly:'🦋', snail:'🐌', turtle:'🐢', snake:'🐍', octopus:'🐙', fish:'🐟',
    dolphin:'🐬', whale:'🐳', shark:'🦈', crab:'🦀', dragon:'🐉', wolf:'🐺',
    elephant:'🐘', horse:'🐴', dove:'🕊️',
  } },
  { key: 'food', label: 'Food', icon: '🍕', items: {
    apple:'🍎', banana:'🍌', grapes:'🍇', watermelon:'🍉', strawberry:'🍓', peach:'🍑',
    pineapple:'🍍', carrot:'🥕', corn:'🌽', bread:'🍞', cheese:'🧀', egg:'🥚',
    bacon:'🥓', pancakes:'🥞', pizza:'🍕', hamburger:'🍔', fries:'🍟', hotdog:'🌭',
    taco:'🌮', burrito:'🌯', sushi:'🍣', ramen:'🍜', spaghetti:'🍝', popcorn:'🍿',
    donut:'🍩', cookie:'🍪', cake:'🍰', birthday_cake:'🎂', chocolate:'🍫', candy:'🍬',
    icecream:'🍦', coffee:'☕', tea:'🍵', beer:'🍺', wine:'🍷', cocktail:'🍸',
    soda:'🥤',
  } },
  { key: 'activities', label: 'Activities', icon: '⚽', items: {
    soccer:'⚽', basketball:'🏀', football:'🏈', baseball:'⚾', tennis:'🎾', volleyball:'🏐',
    rugby:'🏉', pool_8ball:'🎱', bowling:'🎳', golf:'⛳', dart:'🎯', video_game:'🎮',
    dice:'🎲', chess:'♟️', puzzle:'🧩', guitar:'🎸', microphone:'🎤', headphones:'🎧',
    trophy:'🏆', medal:'🏅', tada:'🎉', confetti:'🎊', gift:'🎁', balloon:'🎈',
    fishing:'🎣', skateboard:'🛹', running:'🏃', swimmer:'🏊', biking:'🚴',
  } },
  { key: 'travel', label: 'Travel', icon: '🚗', items: {
    car:'🚗', taxi:'🚕', bus:'🚌', truck:'🚚', bike:'🚲', motorcycle:'🏍️',
    train:'🚆', airplane:'✈️', rocket:'🚀', helicopter:'🚁', ship:'🚢', anchor:'⚓',
    fuelpump:'⛽', traffic_light:'🚦', map:'🗺️', mountain:'⛰️', beach:'🏖️',
    desert:'🏜️', camping:'🏕️', house:'🏠', city:'🏙️', castle:'🏰', bridge:'🌉',
    sunrise:'🌅', sunset:'🌇', night:'🌃', rainbow:'🌈', star:'⭐', full_moon:'🌕',
    sun:'☀️', cloud:'☁️', rain:'🌧️', snow:'❄️', lightning:'⚡', tornado:'🌪️',
  } },
  { key: 'objects', label: 'Objects', icon: '💡', items: {
    bulb:'💡', flashlight:'🔦', candle:'🕯️', book:'📖', notebook:'📓', pencil:'✏️',
    pen:'🖊️', paperclip:'📎', scissors:'✂️', lock:'🔒', unlock:'🔓', key:'🔑',
    hammer:'🔨', wrench:'🔧', gear:'⚙️', magnet:'🧲', gem:'💎', money:'💵',
    dollar:'💲', credit_card:'💳', envelope:'✉️', package:'📦', phone:'📱',
    computer:'💻', camera:'📷', tv:'📺', battery:'🔋', bomb:'💣', knife:'🔪',
    shield:'🛡️', crown:'👑', ring:'💍', umbrella:'☂️', clock:'🕐', hourglass:'⌛',
  } },
  { key: 'symbols', label: 'Symbols', icon: '❤️', items: {
    heart:'❤️', orange_heart:'🧡', yellow_heart:'💛', green_heart:'💚', blue_heart:'💙',
    purple_heart:'💜', black_heart:'🖤', white_heart:'🤍', broken_heart:'💔',
    sparkling_heart:'💖', two_hearts:'💕', heartbeat:'💓', sparkles:'✨', star2:'🌟',
    boom:'💥', dizzy:'💫', zzz:'💤', hundred:'💯', check:'✅', x:'❌',
    warning:'⚠️', question:'❓', exclamation:'❗', no_entry:'🚫', recycle:'♻️',
    infinity:'♾️', peace:'☮️', yinyang:'☯️', atom:'⚛️', radioactive:'☢️',
    flag_checkered:'🏁', arrow_up:'⬆️', arrow_down:'⬇️', arrow_left:'⬅️', arrow_right:'➡️',
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
  return safe.replace(/:([a-z0-9_]+):/gi, (whole, name) => {
    const key = name.toLowerCase();
    if (customEmojis[key]) return `<img class="custom-emoji" src="${customEmojis[key].dataUrl}" alt=":${esc(key)}:" title=":${esc(key)}:">`;
    if (SHORTCODE_MAP[key]) return `<span class="native-emoji">${SHORTCODE_MAP[key]}</span>`;
    return whole;
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

let unsub = { servers: null, channels: null, categories: null, messages: null, dms: null, groupDms: null, self: null };

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
function premiumStar(profile) { return isPremium(profile) ? icon('star', 'premium-star') : ''; }
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
    const data = snap.exists ? snap.data() : { username: uid, avatarColor: '#5865f2', status: 'offline', premiumUntil: null };
    profileCache[uid] = data;
    return data;
  } catch (e) {
    return { username: uid, avatarColor: '#5865f2', status: 'offline', premiumUntil: null };
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
  showHomeView();
}

let systemThemeListenerAdded = false;
function applyTheme(themeKey) {
  document.body.className = '';
  if (themeKey === 'sync') {
    const wantsLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    if (wantsLight) document.body.classList.add('theme-light');
    if (!systemThemeListenerAdded && window.matchMedia) {
      systemThemeListenerAdded = true;
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (myProfile && myProfile.theme === 'sync') applyTheme('sync');
      });
    }
    return;
  }
  if (themeKey && themeKey !== 'dark') document.body.classList.add('theme-' + themeKey);
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
function isMobile() { return window.matchMedia('(max-width: 600px)').matches; }
function setMobilePane(pane) {
  $('app').classList.toggle('mobile-show-chat', pane === 'chat');
}
$('back-to-list-btn').onclick = () => setMobilePane('list');

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
  if (unsub.messages) { unsub.messages(); unsub.messages = null; }
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
  if (unsub.messages) { unsub.messages(); unsub.messages = null; }
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
    snap.forEach(d => dms.push({ id: d.id, ...d.data() }));
    window.__myDMs = dms;
    await Promise.all(dms.map(dm => getProfile(dm.participants.find(p => p !== myUid))));
    if (currentView !== 'channel') renderDMRows();
  });
  if (unsub.groupDms) unsub.groupDms();
  unsub.groupDms = db.collection('groupDMs').where('participants', 'array-contains', myUid).onSnapshot(async snap => {
    const gs = [];
    snap.forEach(d => gs.push({ id: d.id, ...d.data() }));
    window.__myGroupDMs = gs;
    await Promise.all(gs.flatMap(g => g.participants.filter(p => p !== myUid).map(p => getProfile(p))));
    if (currentView !== 'channel') renderDMRows();
  });
}

function groupDMDisplayName(g) {
  if (g.name) return g.name;
  const others = g.participants.filter(p => p !== myUid);
  return others.map(u => (profileCache[u] || { username: u }).username).join(', ') || 'Group';
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
  const groups = window.__myGroupDMs || [];
  groups.forEach(g => {
    const name = groupDMDisplayName(g);
    const row = document.createElement('div');
    row.className = 'dm-row' + (currentGroupDMId === g.id ? ' active' : '');
    row.innerHTML = `<div class="avatar group-avatar" style="width:32px;height:32px;">${icon('people')}</div><span class="dm-name">${esc(name)}</span>`;
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
    await ref.set({ participants: [myUid, uname], createdAt: FieldValue.serverTimestamp() });
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
  if (unsub.messages) unsub.messages();
  unsub.messages = db.collection('dms').doc(id).collection('messages').orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      const msgs = [];
      snap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
      onMessagesUpdate(msgs);
    });
}

async function selectGroupDM(id) {
  currentServerId = null; currentServerData = null; currentChannelId = null;
  currentDMId = null; currentDMOtherUid = null;
  currentView = 'groupdm'; currentGroupDMId = id;
  document.querySelectorAll('#server-rail-list .rail-item').forEach(e => e.classList.remove('active'));
  $('rail-home').classList.add('active');
  $('members-toggle').classList.add('hidden');
  $('app').classList.remove('member-list-open');
  hideMainPageViews();
  const g = (window.__myGroupDMs || []).find(x => x.id === id);
  const name = g ? groupDMDisplayName(g) : 'Group';
  $('chat-header-hash').textContent = '';
  $('chat-header-title').textContent = name;
  $('composer-input').placeholder = `Message ${name}`;
  $('gift-btn').classList.add('hidden');
  showHeaderActions();
  $('pins-toggle').classList.remove('hidden');
  renderDMRows();
  showChat();
  setMobilePane('chat');
  if (unsub.messages) unsub.messages();
  unsub.messages = db.collection('groupDMs').doc(id).collection('messages').orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      const msgs = [];
      snap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
      onMessagesUpdate(msgs);
    });
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
  renderFriendPicker('add-to-group-friend-picker', g ? g.participants : [myUid]);
  openModal('add-to-group-modal');
};

$('confirm-new-group-dm').onclick = async () => {
  const checks = [...$('group-dm-friend-picker').querySelectorAll('input:checked')].map(i => i.value);
  if (checks.length < 2) { toast('Pick at least 2 friends for a group.'); return; }
  const name = $('new-group-dm-name').value.trim();
  try {
    const participants = [myUid, ...checks];
    const ref = await db.collection('groupDMs').add({
      name: name || null, participants, ownerId: myUid, createdAt: FieldValue.serverTimestamp(),
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
$('open-my-settings').addEventListener('dblclick', () => openProfileModal(myUid));
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
  $('profile-avatar').style.background = p.avatarColor;
  $('profile-avatar').textContent = initials(p.username);
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
  } else {
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

$('gift-btn').onclick = () => { if (currentDMOtherUid) openGiftModal(currentDMOtherUid); };
$('attach-btn').onclick = () => toast("File uploads aren't available yet.");
$('gif-btn').onclick = () => toast("GIFs aren't available yet.");
$('sticker-btn').onclick = () => toast("Stickers aren't available yet.");

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
    ${avatarHTML(36, p.avatarColor, initials(p.username), p.status || 'offline')}
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
  showLoadingView();
  setMobilePane('list');
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
    row.querySelector('.cname').onclick = () => selectChannel(c);
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
  await db.collection('servers').doc(currentServerId).collection('channels').add({ name, categoryId, createdAt: FieldValue.serverTimestamp() });
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
  currentChannelId = channel.id;
  currentView = 'channel';
  $('chat-header-hash').textContent = '#';
  $('chat-header-title').textContent = channel.name;
  $('composer-input').placeholder = `Message #${channel.name}`;
  $('members-toggle').classList.remove('hidden');
  $('gift-btn').classList.add('hidden');
  showHeaderActions();
  renderChannelRows(lastChannelsList);
  showChat();
  setMobilePane('chat');
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
function msgRef(msgId) {
  if (currentView === 'channel') return db.collection('servers').doc(currentServerId).collection('channels').doc(currentChannelId).collection('messages').doc(msgId);
  if (currentView === 'dm') return db.collection('dms').doc(currentDMId).collection('messages').doc(msgId);
  if (currentView === 'groupdm') return db.collection('groupDMs').doc(currentGroupDMId).collection('messages').doc(msgId);
  return null;
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
    <div class="member-row" data-u="${esc(uid)}">
      ${avatarHTML(32, p.avatarColor, initials(p.username), p.status || 'offline')}
      <span class="mname${p.status !== 'offline' ? ' online-name' : ''}">${esc(p.username)}${premiumStar(p)}${opTag(p)}${uid === server.ownerId ? '<span class="owner-tag">Owner</span>' : ''}</span>
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
function showWelcome() {
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
  hideMainPageViews();
  $('loading-view').classList.add('hidden');
  $('welcome-view').classList.add('hidden');
  $('chat-view').classList.remove('hidden');
}
function showLoadingView() {
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
  if (currentView === 'channel' || currentView === 'dm' || currentView === 'groupdm') renderMessages(lastRawMessages);
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
      groupEl.dataset.uid = m.uid;
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

async function deleteMessage(id) {
  try {
    const ref = msgRef(id);
    if (ref) await ref.delete();
  } catch (e) { toast('Could not delete message.', 'error'); }
}

async function sendMessage() {
  const input = $('composer-input');
  const raw = input.value.trim();
  if (!raw) return;
  input.value = '';
  autoResize(input);
  const text = applyMessageFilter(raw);
  const payload = { text, uid: myUid, username: myProfile.username, createdAt: FieldValue.serverTimestamp() };
  try {
    if (currentView === 'channel') {
      await db.collection('servers').doc(currentServerId).collection('channels').doc(currentChannelId).collection('messages').add(payload);
      db.collection('users').doc(myUid).update({ 'dailyStats.channelsMessaged': FieldValue.increment(1) }).catch(() => {});
    } else if (currentView === 'dm') {
      await db.collection('dms').doc(currentDMId).collection('messages').add(payload);
      await db.collection('dms').doc(currentDMId).update({ updatedAt: FieldValue.serverTimestamp() });
      db.collection('users').doc(myUid).update({ 'dailyStats.dmsMessaged': FieldValue.increment(1) }).catch(() => {});
    } else if (currentView === 'groupdm') {
      await db.collection('groupDMs').doc(currentGroupDMId).collection('messages').add(payload);
      await db.collection('groupDMs').doc(currentGroupDMId).update({ updatedAt: FieldValue.serverTimestamp() });
      db.collection('users').doc(myUid).update({ 'dailyStats.dmsMessaged': FieldValue.increment(1) }).catch(() => {});
    }
    db.collection('users').doc(myUid).update({
      'stats.messagesSent': FieldValue.increment(1),
      'dailyStats.messagesSent': FieldValue.increment(1),
    }).catch(() => {});
  } catch (e) { toast('Failed to send message.', 'error'); }
}
// No explicit Send button — matches Discord's real composer (Enter to send).
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
  const customNames = Object.keys(customEmojis).filter(n => !q || n.includes(q)).sort();
  customWrap.innerHTML = customNames.length
    ? customNames.map(n => `<button type="button" title=":${esc(n)}:"><img src="${customEmojis[n].dataUrl}" alt=":${esc(n)}:"></button>`).join('')
    : '<div class="ep-empty">No custom emoji yet</div>';
  customWrap.querySelectorAll('button').forEach((btn, i) => { btn.onclick = () => insertAtCursor($('composer-input'), `:${customNames[i]}:`); });

  const sectionsWrap = $('ep-standard-sections');
  sectionsWrap.innerHTML = EMOJI_CATEGORIES.map(cat => {
    const names = Object.keys(cat.items).filter(n => !q || n.includes(q));
    if (!names.length) return '';
    return `<div class="ep-section-label" id="ep-sec-${cat.key}">${esc(cat.label)}</div>
      <div class="ep-grid">${names.map(n => `<button type="button" title=":${esc(n)}:">${cat.items[n]}</button>`).join('')}</div>`;
  }).join('') || '<div class="ep-empty">No emoji match "' + esc(q) + '"</div>';
  sectionsWrap.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => insertAtCursor($('composer-input'), btn.textContent);
  });

  $('ep-cats').innerHTML = EMOJI_CATEGORIES.map(cat => `<button type="button" class="ep-cat-btn" data-cat="${cat.key}" title="${esc(cat.label)}">${cat.icon}</button>`).join('');
  $('ep-cats').querySelectorAll('.ep-cat-btn').forEach(btn => {
    btn.onclick = () => {
      const target = $('ep-sec-' + btn.dataset.cat);
      if (target) target.scrollIntoView({ block: 'start' });
    };
  });
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
async function createRedeemCode(type, value, createdBy) {
  const code = genRedeemCode();
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
    if (!dsnap.exists) await ref.set({ participants: [myUid, recipientUsername], createdAt: FieldValue.serverTimestamp() });
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
    if (tab.dataset.adminTab === 'filter') renderAdminFilterList();
    if (tab.dataset.adminTab === 'codes') renderAdminCodesList();
  };
});

$('gen-code-btn').onclick = async () => {
  const type = $('gen-code-type').value;
  const value = parseInt($('gen-code-value').value || '0', 10);
  if (!value || value < 1) { toast('Enter an amount.'); return; }
  try {
    const code = await createRedeemCode(type, value, myUid);
    toast(`Generated ${code}`);
    $('gen-code-value').value = '';
    renderAdminCodesList();
  } catch (e) { toast('Could not generate code.', 'error'); }
};

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
