// ============================================================
// OVERCONTROL RNG — a 3D aura-rolling game inside Frixion, modelled on Sol's RNG on Roblox.
// One shared lobby for everyone (net.js) with a Roblox-style chat (chat.js), a studded island with a mountain and a
// cave (world.js), blocky players and aura effects (avatar.js), aura moves (moves.js), music composed for every aura
// (music.js), and all the auras, potions, items, biomes and quests (data.js). Progress is saved to Firestore at
// rngSaves/{username}. The Frixion Owner has an Owner tab with every aura and endless potions, and still rolls like
// everyone else. The Owner and Co-Owners get an admin panel (biomes, time, the Jester, fly, and codes).
// ============================================================
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import {
  AURAS, AURA, auraKey, rollAura, POTIONS, POTION, ITEMS, ITEM, WEATHERS, tierOf, tierIndex, STRANGE, POTION_RENAMES,
  timeOfDay, dayProgress, weatherAt, TIERS, weatherEndsAt, jesterHere, fmt, fmtTime, zalgo, movesFor, elementOf,
  FISH, FISHES, FISHING_SPOTS, catchFish, dailyStock, dayIndex, PICKUPS, DAILY_QUESTS, dailyQuests, SIDE_QUEST, BUILTIN_CODES,
  GEARS, GEAR, HEX_SHOP, isSpecial, MUTATIONS, ACHIEVEMENTS, CHEST_POOLS, SEASON, PASS_REWARDS, JACK_SHOP, mariDeals, MARI_SLOT_MS, RAID, loreOf, isHalloween, HALLOWEEN_BIOMES, WEATHER_SLOT_MS,
} from './data.js';
import { createCrawler } from './raid.js';
import { createXFight } from './xfight.js';
import { makeItem, makeShield, FX as MCFX } from './xboss.js';
import { buildAvatar, AuraFX, shirtColorFor } from './avatar.js';
import { createWorld, potionModel } from './world.js';
import { createNet } from './net.js';
import { createChat } from './chat.js';
import { createMusic } from './music.js';
import { castFx, hitTest } from './moves.js';
import { createEquinoxCinematic, EQUINOX_MERGE, EQUINOX_LENGTH } from './cinematics.js';
import { glowTex } from './avatar.js';
import { IC, potionArt, gearArt, handGearArt, fishArt, coinArt, starArt, titleArt, titleInfo } from './icons.js';

const VERSION = '2.5';
const API = () => window.FrixionGameAPI;
const WALK = 16, JUMP = 24, GRAVITY = 72, STEP = 1.25, R = 0.6, H = 5;
const ROLL_ANIM_MS = 2600, ROLL_COOLDOWN_MS = 600;
const CAM_SENS = 0.016;   // radians per pixel at sensitivity 1 (and the default is 1.5): quick
let G = null;

const $q = (sel, el) => (el || G.root).querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();
const x2 = v => (Math.round(v * 100) / 100).toString();

// ---------------- opening and closing ----------------
export async function open() {
  if (G) return;
  ensureCss();
  const api = API();
  const me = api.me();
  const rank = api.rank();
  G = {
    me: { uid: me.uid, name: me.name, rank, owner: rank >= 3, staff: rank >= 2 },
    root: buildShell(), listeners: [], others: new Map(), input: { keys: {}, joy: { x: 0, y: 0 } },
    env: { time: 'day', weather: 'clear', jester: false, progress: 0 }, worldState: {}, effects: [], queued: [], rollBuffs: [],
    rolling: false, nextRollAt: 0, cam: { yaw: 0, pitch: 0.32, dist: 18, zoom: 18 }, panel: null, closed: false, shiftLock: false,
    fxObjects: [], pickups: [], bubbles: new Map(), moveCd: {}, moves: [], konami: [],
  };
  document.body.appendChild(G.root);
  document.body.classList.add('ocrng-open');
  // Testing on your own computer only: lets a test script look inside the running game. Never on the live site.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__ocrngDebug = { state: () => G, interact: () => interact(), admin: a => adminAction(a), panel: id => openPanel(id), cut: key => cutscene(auraKey(key)), move: k => useMove(k), chat: t => G.chat && G.chat.system(t), spawn: id => spawnPickup(id, true), equip: k => equip(k), hurt: (d, o) => hurtMe(d, o), potion: id => usePotion(id, true), tp: (x, y, z) => teleportTo(new THREE.Vector3(x, y, z), 'Test teleport.'), zoom: s => zoomBy(s) };
  try {
    setLoading('Loading the engine', 0.1);
    await sleep(60);
    const quality = qualityFor();
    G.quality = quality;
    setupRenderer(quality);
    setLoading('Building the island', 0.35);
    await sleep(30);
    G.world = createWorld(G.scene, quality);
    setLoading('Loading your auras', 0.6);
    await claimSession();
    await loadSave();
    setLoading('Placing the studs', 0.8);
    buildPlayer();
    setupInput();
    refreshWorldFlags();
    G.clock = new THREE.Clock();
    loop();
    setLoading('Ready', 1);
    await sleep(500);
    showTitle();
  } catch (e) {
    console.error(e);
    api.toast('Overcontrol RNG hit a problem while loading. Try again in a moment.', 'error');
    close();
  }
}

export function close() {
  if (!G || G.closed) return;
  const g = G;
  g.closed = true;
  try { saveNow(); } catch (e) {}
  if (g.sessionOff) g.sessionOff();
  if (g.net) g.net.leave();
  if (g.chat) g.chat.destroy();
  if (g.music) g.music.dispose();
  clearInterval(g.slowTimer);
  cancelAnimationFrame(g.raf);
  g.listeners.forEach(([t, ev, fn, o]) => t.removeEventListener(ev, fn, o));
  if (document.pointerLockElement) document.exitPointerLock();
  if (document.fullscreenElement && g.wentFullscreen) document.exitFullscreen().catch(() => {});
  if (g.renderer) { g.renderer.dispose(); g.renderer.forceContextLoss && g.renderer.forceContextLoss(); }
  if (g.audio) g.audio.close().catch(() => {});
  g.root.remove();
  document.body.classList.remove('ocrng-open');
  G = null;
}
const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); G.listeners.push([t, ev, fn, o]); };

function ensureCss() {
  if (!document.getElementById('ocrng-font')) {
    const f = document.createElement('link');
    f.id = 'ocrng-font'; f.rel = 'stylesheet'; f.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&display=swap';
    document.head.appendChild(f);
  }
  const href = new URL('./ocrng.css?v=' + VERSION, import.meta.url).href;
  const old = document.getElementById('ocrng-css');
  if (old && old.href === href) return;
  if (old) old.remove();
  const l = document.createElement('link');
  l.id = 'ocrng-css'; l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
}
function qualityFor() {
  const saved = (() => { try { return localStorage.getItem('ocrng.quality'); } catch (e) { return null; } })();
  if (saved) return saved;
  return API().isMobile() ? 'low' : 'medium';
}

// ---------------- the page around the game ----------------
function buildShell() {
  const root = document.createElement('div');
  root.id = 'ocrng';
  root.innerHTML = `
  <canvas class="oc-canvas"></canvas>
  <div class="oc-loading">
    <div class="oc-load-mark"><span class="ring"></span><span class="orb w"></span><span class="orb b"></span></div>
    <div class="oc-logo"><span class="pre">OVERCONTROL'S</span><span class="big">RNG</span></div>
    <div class="oc-load-bar"><i></i></div>
    <div class="oc-load-step">Loading</div>
    <div class="oc-load-tip"></div>
  </div>
  <div class="oc-title hidden">
    <div class="oc-logo big-logo"><span class="pre">OVERCONTROL'S</span><span class="big">RNG</span></div>
    <div class="oc-title-btns">
      <button type="button" class="oc-btn primary oc-play">Play</button>
      <button type="button" class="oc-btn oc-title-exit">Back to Frixion</button>
    </div>
    <div class="oc-title-foot"><span class="oc-online"></span><span>v${VERSION}</span></div>
  </div>
  <div class="oc-hud hidden">
    <div class="oc-topleft"><button type="button" class="oc-sq oc-exit" title="Back to Frixion">${IC.close}</button><button type="button" class="oc-sq oc-chat-btn" title="Chat (/)">${IC.chat}</button><button type="button" class="oc-sq oc-admin-btn hidden" data-open="admin" title="Admin Panel">${IC.admin}</button></div>
    <div class="oc-menu">
      <button type="button" class="oc-sq" data-open="storage" title="Aura Storage" data-label="Auras">${IC.storage}</button>
      <button type="button" class="oc-sq" data-open="collection" title="Collection" data-label="Index">${IC.collection}</button>
      <button type="button" class="oc-sq" data-open="inventory" title="Inventory" data-label="Items">${IC.inventory}</button>
      <button type="button" class="oc-sq" data-open="quests" title="Quests" data-label="Quests">${IC.quests}<i class="oc-dot hidden"></i></button>
      <button type="button" class="oc-sq oc-set-btn" data-open="settings" title="Settings" data-label="Settings">${IC.settings}</button>
      <button type="button" class="oc-sq oc-menu-btn" title="Menu" data-label="Menu">${IC.menu}<i class="oc-dot hidden"></i></button>
      <div class="oc-more hidden">
        <button type="button" data-open="achievements">${IC.trophy}<span>Achievements</span><i class="oc-dot hidden"></i></button>
        <button type="button" data-open="pass">${IC.pass}<span>Season Pass</span><i class="oc-dot hidden"></i></button>
        <button type="button" data-open="stats">${IC.stats}<span>Stats</span></button>
        <button type="button" data-open="settings">${IC.settings}<span>Settings</span></button>
      </div>
    </div>
    <div class="oc-raidbar hidden"><b>THE CRAWLER</b><div class="oc-raid-hp"><i></i><span></span></div><small></small></div>
    <div class="oc-bossbar hidden"><b class="oc-mcname">____X____</b><div class="oc-boss-hp"><i></i><u></u></div><small></small></div>
    <div class="oc-opfun hidden">OPFUN</div>
    <div class="oc-hearts hidden"></div>
    <div class="oc-players"></div>
    <div class="oc-bl">
      <div class="oc-luckline"></div>
      <div class="oc-biome"></div>
      <div class="oc-daytime"></div>
      <div class="oc-money"></div>
    </div>
    <div class="oc-prompt hidden"></div>
    <div class="oc-rolltext hidden"><div class="oc-rt-name"></div><div class="oc-rt-sub"></div><div class="oc-rt-actions hidden"><button type="button" class="oc-btn ok" data-eq>Equip</button><button type="button" class="oc-btn bad" data-skip>Skip</button></div></div>
    <div class="oc-rollbar">
      <button type="button" class="oc-toggle oc-auto"><span>Auto Roll</span><b>OFF</b></button>
      <button type="button" class="oc-roll"><b>Roll</b><small class="oc-roll-count">0/10</small><span class="oc-roll-cd"></span></button>
      <button type="button" class="oc-toggle oc-quick"><span>Quick Roll</span><b>OFF</b></button>
    </div>
    <div class="oc-br">
      <div class="oc-buffs"></div>
      <div class="oc-hp hidden"><i></i><span>100</span></div>
      <div class="oc-abilities"></div>
    </div>
    <div class="oc-crosshair hidden"></div>
    <div class="oc-lockmark hidden">${IC.lock}</div>
    <div class="oc-joy hidden"><span class="knob"></span></div>
    <button type="button" class="oc-jump hidden">Jump</button>
    <button type="button" class="oc-act hidden">E</button>
    <div class="oc-bubbles"></div>
    <div class="oc-batch hidden"></div>
    <div class="oc-tip hidden"></div>
    <div class="oc-lockon hidden"></div>
    <div class="oc-announce"></div>
    <div class="oc-toasts"></div>
  </div>
  <div class="oc-panel hidden"><div class="oc-panel-box"><div class="oc-panel-head"><h2></h2><button type="button" class="oc-sq oc-panel-x" title="Close">${IC.close}</button></div><div class="oc-panel-body"></div></div></div>
  <div class="oc-fishbar hidden"></div>
  <div class="oc-cut hidden"></div>
  <div class="oc-rotate hidden"><div class="oc-rotate-phone">${IC.phone}</div><b>Turn your phone sideways</b><span>Overcontrol RNG plays in landscape.</span></div>`;
  const tips = ['Every 10th roll is twice as lucky. Watch the counter on the Roll button.', 'Day and night swap every 10 minutes. Solar and Lunar only show up in their time.', 'The Jester visits every 4 hours. Bring 5 Void Coins.',
    'Stella brews potions in a cave inside the mountain.', 'Nova\'s daily shop changes every day at midnight.', 'Biomes make some auras easier. Glitched lets you roll them all.',
    'There are secrets all over the island.', 'Press / to chat.', 'Rare auras have moves. Z, X, C and V attack, F moves you.', 'Climb the mountain and ring the bell.'];
  root.querySelector('.oc-load-tip').textContent = tips[Math.floor(Math.random() * tips.length)];
  return root;
}
function setLoading(text, p) {
  if (!G) return;
  $q('.oc-load-step').textContent = text;
  $q('.oc-load-bar i').style.width = Math.round(p * 100) + '%';
}

// ---------------- renderer, scene, camera ----------------
function setupRenderer(quality) {
  const canvas = $q('.oc-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
  G.renderer = renderer; G.scene = scene; G.camera = camera;
  const fit = () => { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); checkOrientation(); };
  fit(); on(window, 'resize', fit);
  if (screen.orientation) on(screen.orientation, 'change', fit);
}
// Phones play sideways. In portrait the game waits behind a "turn your phone" screen.
function checkOrientation() {
  if (!G) return;
  const touch = API().isMobile() || (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);
  const portrait = window.innerHeight > window.innerWidth;
  G.portraitBlock = touch && portrait;
  $q('.oc-rotate').classList.toggle('hidden', !G.portraitBlock);
}

// ---------------- saving ----------------
const blankSave = () => ({
  v: 3, name: '', coins: 0, f: 0, void: 0, rolls: 0, auras: { common: 0 }, equipped: 'common', potions: {}, items: {}, fish: {}, quickRoll: false,
  settings: { auto: false, quick: false, autoEquip: true, cutscenes: 'all', pvp: false, bubbles: true, serverRolls: true, sens: 1.5, sensV2: true, vol: { music: 0.45, mine: 0.7, others: 0.5, sfx: 0.7 } },
  eggs: {}, effects: [], queued: [], rollBuffs: [], daily: { day: 0, bought: [] }, best: 'common', bestRarity: 2,
  quests: { day: 0, prog: {}, claimed: [], side: {} }, stats: { fish: 0, pickups: 0, potions: 0, kos: 0, moves: 0, playSecs: 0, raids: 0, crafted: 0, dailies: 0 }, found: {}, redeemed: {}, ownerGear: {},
  lastObby: 0, lastBell: 0, chest: false,
  // gears worn in each hand, and the ones you own; auras you locked; achievements, titles, the season pass
  gears: {}, hands: { left: null, right: null }, locked: {}, achievements: {}, titles: [], title: '', pass: { xp: 0, free: [], prem: [] },
  tokens: 0, keys: {}, biomes: {}, caught: {}, flags: {}, qblockDay: 0, bestTier: 0,
});
async function loadSave() {
  const api = API();
  G.saveRef = api.db.collection('rngSaves').doc(G.me.uid);
  let data = {};
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) { try { const d = await G.saveRef.get(); data = d.exists ? d.data() : {}; ok = true; } catch (e) { await sleep(900); } }
  if (!ok) { G.loadFailed = true; setTimeout(() => toast('Your save didn' + "'" + 't load, so this session won' + "'" + 't save over it. Reopen the game to try again.', 'warn'), 3000); }
  const b = blankSave(), s = { ...b, ...data };
  s.settings = { ...b.settings, ...(data.settings || {}), vol: { ...b.settings.vol, ...((data.settings || {}).vol || {}) } };
  if (data.settings && data.settings.sound === false) s.settings.vol.sfx = 0;
  s.quests = { ...b.quests, ...(data.quests || {}) }; s.quests.side = s.quests.side || {};
  s.stats = { ...b.stats, ...(data.stats || {}) };
  ['auras', 'fish', 'potions', 'items', 'eggs', 'found', 'redeemed', 'ownerGear', 'gears', 'locked', 'achievements', 'keys', 'biomes', 'caught', 'flags'].forEach(k => { s[k] = s[k] || {}; });
  s.hands = { left: null, right: null, ...(s.hands || {}) }; s.pass = { ...b.pass, ...(s.pass || {}) }; s.titles = s.titles || [];
  s.bestTier = Math.max(s.bestTier || 0, tierIndex(auraKey(s.best).rarity));
  s.daily = s.daily || { day: 0, bought: [] };
  // older versions: the balance auras merged, a few potions were renamed
  for (const [k, n] of Object.entries(s.auras)) { const nk = auraKey(k).key; if (nk !== k) { s.auras[nk] = (s.auras[nk] || 0) + n; delete s.auras[k]; } }
  for (const [id, n] of Object.entries(s.potions)) { if (!POTION[id]) { const to = POTION_RENAMES[id]; if (to) s.potions[to] = (s.potions[to] || 0) + n; delete s.potions[id]; } }
  s.equipped = auraKey(s.equipped).key; s.best = auraKey(s.best).key;
  for (const k of Object.keys(s.auras)) if (s.auras[k] > 0) s.found[auraKey(k).aura.id] = true;
  if (!s.flags.noEquinox) {   // once: every 『EQUINOX』 you had (mutations too) becomes 『LEGACY EQUINOX』
    let had = 0;
    for (const k of Object.keys(s.auras)) { const nk = toLegacy(k); if (nk === k) continue; had += s.auras[k]; s.auras[nk] = (s.auras[nk] || 0) + s.auras[k]; delete s.auras[k]; }
    if (!had && s.found.equinox) { s.auras.legacyequinox = 1; had = 1; }   // rolled it once, even if it was removed since
    s.equipped = toLegacy(s.equipped); s.best = toLegacy(s.best);
    if (had) { delete s.found.equinox; s.found.legacyequinox = true; G.equinoxTaken = had; setTimeout(() => markDirty(), 0); }
    s.flags.noEquinox = true;
  }
  G.save = s;
  G.effects = (s.effects || []).map(e => (e.left != null ? { ...e, until: now() + e.left } : e)).filter(e => e.until > now() && POTION[e.id]).map(({ left, ...e }) => e);
  G.queued = (s.queued || []).filter(id => POTION[id]);
  // Warp and Transcendent roll instantly now: their old leftover speed buffs turn back into potions
  for (const r of s.rollBuffs || []) if (POTION[r.id] && POTION[r.id].batch && !G.me.owner) s.potions[r.id] = (s.potions[r.id] || 0) + 1;
  G.rollBuffs = (s.rollBuffs || []).filter(r => (r.id === 'gem' || (POTION[r.id] && POTION[r.id].boost)) && r.left > 0);
  if (s.settings.serverRolls === undefined) s.settings.serverRolls = true;
  if (!s.settings.sensV2) { if (s.settings.sens === 1) s.settings.sens = 1.5; s.settings.sensV2 = true; }
  if (!s.auras[s.equipped] && !G.me.owner && s.equipped !== 'common') s.equipped = 'common';
  checkDay();
}
// One game per account at a time, like Roblox. Opening Overcontrol RNG somewhere else makes this window save one last
// time and close, so two windows can never save over each other (that is how progress went backwards).
async function claimSession() {
  let ref; try { ref = API().rtdb.ref('ocrng/session/' + G.me.uid); } catch (e) { return; }
  const myId = G.sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);   // kept here: G is gone once the game closes
  let had = null;
  try { had = (await ref.get()).val(); } catch (e) {}
  try { await ref.set({ id: G.sessionId, t: Date.now() }); } catch (e) { return; }
  if (had && had.id && Date.now() - (had.t || 0) < 12 * 3600000) await sleep(1600);   // let the other window save first
  const watch = s => { const v = s.val(); if (G && G.sessionId === myId && !G.kicked && v && v.id && v.id !== myId) sessionTaken(); };
  ref.on('value', watch);
  G.sessionOff = () => { ref.off('value', watch); ref.transaction(v => (v && v.id === myId ? null : v)).catch(() => {}); };
}
function sessionTaken() {
  if (G.save && !G.loadFailed) saveNow();
  G.kicked = true;
  API().toast('Overcontrol RNG was opened somewhere else, so this window closed. Your progress is saved.', 'warn');
  close();
}
let saveTimer = 0;
function markDirty() { if (!G) return; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 3000); }
function saveNow() {
  if (!G || !G.saveRef || !G.save || G.wiped || G.kicked || G.loadFailed) return;
  clearTimeout(saveTimer);
  G.save.effects = G.effects.filter(e => e.until > now()).map(e => ({ ...e, left: e.until - now() }));
  G.save.queued = G.queued; G.save.rollBuffs = G.rollBuffs;
  G.save.name = G.me.name; G.save.bestRarity = auraKey(G.save.best).rarity;
  G.saveRef.set(JSON.parse(JSON.stringify(G.save))).catch(() => {});
}

// What you have. The Owner also has the Owner tabs, with everything.
const isOwner = () => G.me.owner;
// OpFun, the Owner's fun mode: no cooldowns on anything (moves, rolling, the shield)
const opfun = () => !!(G && G.me && G.me.owner && G.save && G.save.settings.opfun);
const potionCount = id => G.save.potions[id] || 0;
const hasItem = id => !!G.save.items[id] || (isOwner() && !!G.save.ownerGear[id]);
const auraCount = key => G.save.auras[key] || 0;
const canAuto = () => isOwner() || API().premium();
const canQuick = () => isOwner() || G.save.quickRoll;
const vol = k => G.save.settings.vol[k] ?? 0.6;

// ---------------- the player ----------------
function buildPlayer() {
  const a = buildAvatar(G.me.name, shirtColorFor(G.me.name));
  G.scene.add(a.root);
  G.player = { avatar: a, pos: G.world.spawn.clone(), vel: new THREE.Vector3(), yaw: Math.PI, onGround: true, hp: 100, pvp: false, fly: false, noclip: false, fx: null, scale: 1 };
  a.root.position.copy(G.player.pos);
  equip(G.save.equipped, true);
}
const drawMyTag = () => G.player.avatar.tag.userData.draw(G.me.name, G.save.equipped, G.player.pvp ? G.player.hp : null, { afk: G.afk });
function equip(key, silent) {
  const p = G.player;
  if (p.fx) p.fx.dispose();
  p.fx = new AuraFX(key, G.quality === 'low');
  p.avatar.fxHolder.add(p.fx.group);
  G.save.equipped = key;
  drawMyTag();
  G.moves = movesFor(key);
  if (!G.moves.some(m => m.toggle)) p.flyToggle = false;
  const xa = auraKey(key).aura.id === 'xboss';
  xGear(p.avatar, xa); if (xa) xHold(p.avatar, 'sword'); else { p.blocking = false; p.eating = null; }
  renderAbilities();
  if (G.net) G.net.update({ aura: key });
  if (!silent) { toast(`Equipped ${auraKey(key).name}`); markDirty(); }
}

// ---------------- input: Roblox-style keyboard, mouse and touch ----------------
const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
function setupInput() {
  const k = G.input.keys, cvs = $q('.oc-canvas');
  if (document.activeElement && document.activeElement.blur && !G.root.contains(document.activeElement)) document.activeElement.blur();
  const typing = e => e.target instanceof Node && G.root.contains(e.target) && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && /^(text|search|number)$/.test(e.target.type)));
  on(window, 'keydown', e => {
    if (!G || !G.playing || typing(e)) return;
    const key = e.key.toLowerCase();
    if (G.lockOn) { if (key === 'escape') pickLock(''); else if (/^[1-9]$/.test(key)) pickLock(key === '1' ? 'nearest' : ((G.lockOn.list[+key - 2] || {}).id || '')); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (e.key === 'Escape') { if (G.panel) closePanel(); else if (G.fishing) stopFishing(); e.stopImmediatePropagation(); return; }
    G.konami.push(key); if (G.konami.length > 10) G.konami.shift();
    if (G.konami.join() === KONAMI.join()) { G.konami = []; findEgg('konami'); }
    if (key === '/' && G.chat) { e.preventDefault(); e.stopImmediatePropagation(); G.chat.focus(); return; }
    if (key === 'i' || key === 'o') { zoomBy(key === 'i' ? -1 : 1); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (key === 'tab') { e.preventDefault(); $q('.oc-players').classList.toggle('closed'); return; }
    if (e.repeat && ['e', 'r', 'f', 'z', 'x', 'c', 'v', 'shift'].includes(key)) return;
    k[key] = true;
    if (key === 'e') interact();
    if (key === 'r' && !G.panel) rollOnce();
    if (['z', 'x', 'c', 'v', 'f'].includes(key) && !G.panel) useMove(key);
    if (key === 'shift' && !G.player.fly && !G.touch) setShiftLock(!G.shiftLock);
    if ([' ', 'w', 'a', 's', 'd', 'e', 'r', 'f', 'q', 'z', 'x', 'c', 'v', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  on(window, 'keyup', e => { if (!G) return; const kk = e.key.toLowerCase(); k[kk] = false; if (kk === 'z' && G.player && G.player.blocking) setBlock(false); }, true);
  on(window, 'blur', () => { for (const x in k) k[x] = false; });
  // The camera turns as fast as the mouse moves: hold the right button (the cursor hides while you do), or drag with
  // the left one. Shift Lock keeps it turning without holding anything.
  let dragging = false;
  on(cvs, 'mousedown', e => {
    if (!G.playing) return;
    if (e.button === 2) { dragging = true; if (!G.shiftLock && cvs.requestPointerLock) cvs.requestPointerLock(); }
    if (e.button === 0) {
      if (xMoveOf('sword') && !G.panel) { useMove('m1'); if (firstPerson() && cvs.requestPointerLock && document.pointerLockElement !== cvs) cvs.requestPointerLock(); return; }
      dragging = true; if (firstPerson() && cvs.requestPointerLock && document.pointerLockElement !== cvs) cvs.requestPointerLock();
    }
  });
  on(window, 'mouseup', () => { dragging = false; if (!G.shiftLock && !firstPerson() && document.pointerLockElement === cvs) document.exitPointerLock(); });
  on(window, 'mousemove', e => {
    if (!G.playing || G.panel) return;
    if (!(dragging || G.shiftLock || firstPerson() || document.pointerLockElement === cvs)) return;
    if (firstPerson() && !dragging && document.pointerLockElement !== cvs) return;
    const s = CAM_SENS * (G.save.settings.sens || 1);
    G.cam.yaw -= e.movementX * s;
    G.cam.pitch = Math.max(-1.2, Math.min(1.35, G.cam.pitch + e.movementY * s));
  });
  on(document, 'pointerlockchange', () => { if (G && G.shiftLock && document.pointerLockElement !== cvs) setShiftLock(false); });
  on(cvs, 'contextmenu', e => e.preventDefault());
  on(cvs, 'wheel', e => { zoomBy(Math.sign(e.deltaY)); e.preventDefault(); }, { passive: false });
  // touch: a joystick on the left, drag anywhere else to turn, pinch to zoom
  if (API().isMobile() || (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0)) {
    G.touch = true;
    G.root.classList.add('oc-touch');
    ['.oc-joy', '.oc-jump', '.oc-act'].forEach(s => $q(s).classList.remove('hidden'));
    $q('.oc-players').classList.add('closed');
    const joy = $q('.oc-joy'), knob = joy.querySelector('.knob');
    let joyId = null, turnId = null, last = null, pinch = null;
    on(joy, 'touchstart', e => { const t = e.changedTouches[0]; joyId = t.identifier; e.preventDefault(); }, { passive: false });
    on(window, 'touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          let dx = (t.clientX - cx) / (r.width / 2), dy = (t.clientY - cy) / (r.height / 2); const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
          G.input.joy = { x: dx, y: dy }; knob.style.transform = `translate(${dx * 32}px, ${dy * 32}px)`;
        } else if (t.identifier === turnId && last) {
          const s = 0.022 * (G.save.settings.sens || 1);
          G.cam.yaw -= (t.clientX - last.x) * s; G.cam.pitch = Math.max(-1.2, Math.min(1.35, G.cam.pitch + (t.clientY - last.y) * s * 0.8)); last = { x: t.clientX, y: t.clientY };
        }
      }
      if (e.touches.length === 2 && pinch) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); const z = Math.max(pinch.zoom, 3) * pinch.d / d; G.cam.zoom = z < 3.5 ? 0 : Math.min(48, z); }
    }, { passive: true });
    on(cvs, 'touchstart', e => {
      if (e.touches.length === 2) { pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), zoom: G.cam.zoom }; turnId = null; return; }
      const t = e.changedTouches[0]; if (turnId === null) { turnId = t.identifier; last = { x: t.clientX, y: t.clientY }; }
    }, { passive: true });
    on(window, 'touchend', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) { joyId = null; G.input.joy = { x: 0, y: 0 }; knob.style.transform = ''; }
        if (t.identifier === turnId) { turnId = null; last = null; }
      }
      if (e.touches.length < 2) pinch = null;
    });
    on($q('.oc-jump'), 'touchstart', e => { e.preventDefault(); G.input.keys[' '] = true; setTimeout(() => { if (G) G.input.keys[' '] = false; }, 150); }, { passive: false });
    on($q('.oc-act'), 'click', () => interact());
    on($q('.oc-prompt'), 'click', () => interact());   // on phones the prompt itself is the button
  }
  // AFK: nothing pressed for 5 minutes
  const awake = () => { G.lastInput = now(); if (G.afk) { G.afk = false; drawMyTag(); if (G.net) G.net.update({ afk: null }); } };
  ['keydown', 'mousedown', 'touchstart', 'wheel'].forEach(ev => on(window, ev, awake, { passive: true }));
  G.lastInput = now();
  on($q('.oc-menu-btn'), 'click', () => $q('.oc-more').classList.toggle('hidden'));
  on($q('.oc-exit'), 'click', () => close());
  on($q('.oc-title-exit'), 'click', () => close());
  on($q('.oc-play'), 'click', () => play());
  on($q('.oc-roll'), 'click', () => rollOnce());
  on($q('.oc-auto'), 'click', toggleAuto);
  on($q('.oc-quick'), 'click', toggleQuick);
  on($q('.oc-chat-btn'), 'click', () => G.chat && G.chat.focus());
  on($q('.oc-panel-x'), 'click', closePanel);
  on($q('.oc-panel'), 'click', e => { if (e.target.classList.contains('oc-panel')) closePanel(); });
  const abEl = $q('.oc-abilities'), moveOfBtn = b => b && shownMoves().find(m => m.key === b.dataset.move);
  on(abEl, 'pointerdown', e => { const m = moveOfBtn(e.target.closest('[data-move]')); if (m && m.kind === 'shield') { e.preventDefault(); setBlock(true); } });
  on(window, 'pointerup', () => { if (G && G.player && G.player.blocking && !G.input.keys.z) setBlock(false); });
  on(abEl, 'click', e => { const b = e.target.closest('[data-move]'), m = moveOfBtn(b); if (b && !(m && m.kind === 'shield')) useMove(b.dataset.move); });
  // potions: hover (or tap) one for what it does, and the + button shows them all
  const buffsEl = $q('.oc-buffs'), hideTip = () => { G.tipKey = null; $q('.oc-tip').classList.add('hidden'); };
  on(buffsEl, 'mouseover', e => { const c = e.target.closest('.oc-buff'); if (c && !G.touch) showBuffTip(c.dataset.k); });
  on(buffsEl, 'mouseleave', () => { if (!G.touch) hideTip(); });
  on(buffsEl, 'click', e => {
    if (e.target.closest('[data-more]')) { G.buffsOpen = !G.buffsOpen; hideTip(); updateHud(); return; }
    const c = e.target.closest('.oc-buff'); if (!c) return;
    if (G.tipKey === c.dataset.k) hideTip(); else showBuffTip(c.dataset.k);
  });
  const endOffer = () => { G.offer = null; $q('.oc-rt-actions').classList.add('hidden'); $q('.oc-rolltext').classList.add('hidden'); };
  on($q('[data-eq]'), 'click', () => { if (G.offer) equip(G.offer); endOffer(); });
  on($q('[data-skip]'), 'click', endOffer);
  G.root.querySelectorAll('[data-open]').forEach(b => on(b, 'click', () => { $q('.oc-more').classList.add('hidden'); openPanel(b.dataset.open); }));
}
function setShiftLock(onOff) {
  const cvs = $q('.oc-canvas');
  G.shiftLock = onOff;
  $q('.oc-lockmark').classList.toggle('hidden', !onOff);
  if (onOff && cvs.requestPointerLock) cvs.requestPointerLock();
  if (!onOff && document.pointerLockElement === cvs) document.exitPointerLock();
}

// ---------------- title screen and joining ----------------
function showTitle() {
  $q('.oc-loading').classList.add('gone');
  setTimeout(() => G && $q('.oc-loading').classList.add('hidden'), 600);
  $q('.oc-title').classList.remove('hidden');
  G.titleCam = true;
  API().rtdb.ref('ocrng/roster').once('value').then(s => {
    if (!G) return;
    const n = s.numChildren();
    $q('.oc-online').textContent = n ? `${n} ${n === 1 ? 'player' : 'players'} in the lobby` : 'The lobby is empty. Be the first!';
  }).catch(() => {});
}
function play() {
  if (G.playing) return;
  audio();
  if (G.touch) {
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen({ navigationUI: 'hide' }).then(() => { G && (G.wentFullscreen = true); return screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'); }).catch(() => {});
  }
  G.titleCam = false; G.playing = true;
  $q('.oc-title').classList.add('gone');
  setTimeout(() => G && $q('.oc-title').classList.add('hidden'), 500);
  $q('.oc-hud').classList.remove('hidden');
  if (G.me.owner) $q('.oc-admin-btn').classList.remove('hidden');   // events and codes are the Frixion Owner's alone, not Co-Owners'
  G.cam.yaw = G.player.yaw + Math.PI;
  const api = API();
  G.chat = createChat({ host: $q('.oc-hud'), rtdb: api.rtdb, uid: G.me.uid, name: G.me.name, onMessage: (uid, name, text) => showBubble(uid, text), onCommand: chatCommand });
  G.chat.system('Welcome to Overcontrol RNG. Press / to chat, and type /help for commands.', '#bdbdbd');
  G.net = createNet(api.rtdb, api.firebase, G.me.uid, {
    joined: (uid, d) => { addOther(uid, d); G.chat.system(`${d.name || uid} joined the game.`, '#bdbdbd'); },
    changed: (uid, d) => updateOther(uid, d),
    left: uid => { const o = G.others.get(uid); if (o) G.chat.system(`${(o.data && o.data.name) || uid} left the game.`, '#bdbdbd'); removeOther(uid); },
    pos: (uid, p) => { const o = G.others.get(uid); if (o) { o.target.set(p.x, p.y, p.z); o.targetYaw = p.r; o.anim = p.a; o.hp = p.hp; if (!o.placed) { o.pos.copy(o.target); o.placed = true; } o.seen = now(); } },
    posGone: uid => { const o = G.others.get(uid); if (o) o.placed = false; },
    hit: h => takeHit(h),
    fx: f => { if (String(f.kind).startsWith('mc')) { mcFx(f, false); return; } if (f.kind === 'equinox') { remoteEquinox(f); return; } if (f.kind === 'death') { G.chat && G.chat.system(String(f.text || '').slice(0, 120), '#ffffff'); return; } const fxo = castFx(G.scene, f); if (fxo) G.fxObjects.push(fxo); },
    announce: a => announce(a),
    world: w => { G.worldState = w; },
    raid: r => onRaid(r),
    xboss: v => G.xfight && G.xfight.onState(v),
    wiped: at => onWiped(at),
    gift: (g, done) => onGift(g, done),
    denied: () => {
      if (!G || G.netDenied) return;
      G.netDenied = true;
      toast(G.me.staff ? 'Multiplayer is off: the Realtime Database rules need an "ocrng" section. You can still play solo.' : 'The lobby is closed right now, so you\'re playing solo. Your progress still saves.', 'warn');
    },
  });
  G.xfight = createXFight({
    scene: G.scene, net: G.net, uid: G.me.uid, arena: G.world.arena, colliders: () => G.world.colliders,
    spawn: G.world.spawn, lunge: (x, y, z) => playLunge(Math.max(0, 1 - Math.hypot(x - G.player.pos.x, z - G.player.pos.z) / 90)),
    player: () => G.player, isDead: () => !!G.respawning, others: () => [...G.others.values()].filter(o => o.placed).map(o => ({ uid: o.uid, pos: o.pos })),
    hurtMe, addFx: f => G.fxObjects.push(f), sound, shake: k => { G.shake = Math.max(G.shake || 0, k); },
    chat: (text, color) => G.chat && G.chat.system(text, color), banner: (big, small) => bossBanner(big, small),
    busy: () => !!(G.crawler && !G.crawler.dying), onWin: xReward, onMobKill: m => { toast(`You defeated ${m.name}. ` + giveReward({ coins: m.gen ? 6000 : 1500 }), 'gold'); },
    loadNames: () => fetch(new URL('./nullnames.txt', import.meta.url)).then(r => r.text()),
  });
  G.net.join({ name: G.me.name, aura: G.save.equipped, shirt: shirtColorFor(G.me.name), pvp: false, rolls: G.save.rolls, ...(G.save.title ? { title: G.save.title } : {}) });
  G.music = G.audio ? createMusic(G.audio) : null;
  loadLunge();
  setTimeout(() => { if (G) sweepEquinox(); }, 6000);
  if (G.equinoxTaken) setTimeout(() => { if (G) toast('『EQUINOX』 is 1 in a trillion now. Yours became 『LEGACY EQUINOX』: it is in the Special tab of Aura Storage.', 'gold'); }, 4500);
  refreshToggles();
  updateHud();
  progress('none');
  loadBoard();
  G.slowTimer = setInterval(slowTick, 1000);
  if (isOwner()) toast('Owner: everything is in the Owner tabs of Aura Storage and the Inventory.', 'gold');
  sound('join');
}

// ---------------- other players ----------------
function addOther(uid, d) {
  if (G.others.has(uid)) return updateOther(uid, d);
  const a = buildAvatar(d.name || uid, d.shirt || shirtColorFor(uid));
  a.root.visible = false;
  G.scene.add(a.root);
  const o = { uid, data: d, avatar: a, fx: null, key: null, pos: new THREE.Vector3(0, -50, 0), target: new THREE.Vector3(0, -50, 0), yaw: 0, targetYaw: 0, placed: false, hp: 100 };
  G.others.set(uid, o);
  updateOther(uid, d);
}
function updateOther(uid, d) {
  const o = G.others.get(uid); if (!o) return addOther(uid, d);
  o.data = d;
  if (d.aura !== o.key) { if (o.fx) o.fx.dispose(); o.key = auraKey(d.aura || 'common').key; o.fx = new AuraFX(o.key, true); o.avatar.fxHolder.add(o.fx.group); }
  o.avatar.tag.userData.draw(d.name || uid, o.key, d.pvp ? (o.hp ?? 100) : null, { afk: d.afk });
  o.lastHp = o.hp;
}
function removeOther(uid) {
  const o = G.others.get(uid); if (!o) return;
  if (o.fx) o.fx.dispose(); G.scene.remove(o.avatar.root); o.avatar.dispose(); G.others.delete(uid);
  const b = G.bubbles.get(uid); if (b) { b.el.remove(); G.bubbles.delete(uid); }
}

// ---------------- the main loop ----------------
function loop() {
  if (!G) return;
  G.raf = requestAnimationFrame(loop);
  const raw = G.clock.getDelta(), dt = Math.min(0.05, raw), t = G.clock.elapsedTime, n = now();
  adaptResolution(raw);
  const env = G.env, ws = G.worldState || {};
  const time = timeOfDay(n, ws), weather = weatherAt(n, ws), jester = jesterHere(n, ws);
  if (G.playing) {
    if (G.save) G.save.biomes[weather] = true;
    if (weather !== env.weather) announceWeather(weather, env.weather);
    if (jester && !env.jester) { G.chat && G.chat.system('[Server]: The Jester has arrived. His tent is to the east.', '#d6a8ff'); sound('jester'); }
    if (!jester && env.jester) G.chat && G.chat.system('[Server]: The Jester has left.', '#d6a8ff');
    if (time !== env.time) G.chat && G.chat.system(time === 'night' ? '[Server]: Night has fallen.' : '[Server]: The sun has risen.', time === 'night' ? '#9fb4ff' : '#ffe082');
  }
  env.time = time; env.weather = weather; env.jester = jester; env.progress = dayProgress(n);
  if (G.playing && !G.portraitBlock) { movePlayer(dt); updateOthers(dt, t); checkPlaces(); checkEggs(); updatePickups(dt, t); }
  updateCamera(dt, t);
  const p = G.player;
  p.avatar.root.position.copy(p.pos);
  p.avatar.root.rotation.y = p.yaw;
  const want = p.sizeUntil > n ? p.sizeTo : 1; p.scale += (want - p.scale) * Math.min(1, dt * 4); p.avatar.root.scale.setScalar(p.scale);
  const tk = p.tpAt ? (n - p.tpAt) / 420 : 1;
  if (tk < 1) { const e = 1 - tk; p.avatar.root.scale.set(p.scale * (1 - 0.75 * e), p.scale * (1 + 1.4 * e), p.scale * (1 - 0.75 * e)); }
  p.fx && p.fx.update(dt, t);
  G.world.update(dt, t, { ...env, weather: G.world.inLimbo(p.pos) ? 'limbo' : env.weather, camPos: G.camera.position, player: p.pos });
  G.fxObjects = G.fxObjects.filter(f => f.update(dt));
  if (G.cine) G.cine.update(Math.min(0.25, raw));   // real time, so slow devices see it at the same pace as the music
  if (G.fishing) fishingTick(dt);
  if (G.crawler) updateRaid(dt, t);
  if (G.xfight) G.xfight.update(dt);
  if (G.playing) {
    if (G.save.settings.auto && canAuto() && !G.rolling && !G.cutting && n >= G.nextRollAt) rollOnce();
    if (G.net) G.net.sendPos({ x: p.pos.x, y: p.pos.y, z: p.pos.z, r: p.yaw, a: p.moving ? 1 : 0, hp: p.pvp ? p.hp : -1 });
    if ((G.hudTick = (G.hudTick || 0) + dt) > 0.25) { G.hudTick = 0; updateHud(); updateAbilityCds(); }
    const b = buffs();
    $q('.oc-roll-cd').style.transform = `scaleX(${G.rolling ? 1 : Math.max(0, Math.min(1, (G.nextRollAt - n) / (ROLL_COOLDOWN_MS / b.speed)))})`;
    updateBubbles();
  }
  if ((G.zalgoTick = (G.zalgoTick || 0) + dt) > 0.15) { G.zalgoTick = 0; G.root.querySelectorAll('.oc-tier.t-null').forEach(el => { el.textContent = zalgo('null'); }); }
  if (!G.cine && weather !== G.filterFor) { G.filterFor = weather; G.renderer.domElement.style.filter = weather === 'null' ? 'grayscale(.85) contrast(1.15)' : ''; }
  G.renderer.render(G.scene, G.camera);
}
// A slow computer or phone draws fewer pixels until the game runs smoothly, and goes back up when there is room. If a
// step down doesn't help, the screen is just capped (a 30 Hz phone), so it goes back and stops trying.
function adaptResolution(raw) {
  if (!G.playing || raw > 0.5 || document.hidden) return;
  const a = G.adapt || (G.adapt = { t: 0, n: 0, low: 0, tried: null, stuck: false, hold: 0 });
  a.t += raw; a.n++;
  if (a.t < 2) return;
  const fps = a.n / a.t, r = G.renderer, pr = r.getPixelRatio(), n = now();
  a.t = 0; a.n = 0;
  const max = Math.min(window.devicePixelRatio || 1, G.quality === 'high' ? 2 : G.quality === 'medium' ? 1.5 : 1);
  const set = v => { r.setPixelRatio(v); r.setSize(window.innerWidth, window.innerHeight, false); };
  if (a.tried) { if (fps < a.tried.fps * 1.12) { a.stuck = true; set(a.tried.pr); } a.tried = null; return; }
  if (fps < 40 && !a.stuck && pr > 0.75) { if (++a.low >= 2) { a.low = 0; a.tried = { fps, pr }; a.hold = n + 20000; set(Math.max(0.75, pr - 0.2)); } return; }
  a.low = 0;
  if (fps > 57 && pr < max && n > a.hold) set(Math.min(max, pr + 0.1));
}
// Once a second: music, play time, the player list, the new day.
function slowTick() {
  if (!G || !G.playing) return;
  G.save.stats.playSecs++;
  checkDay();
  pickMusic();
  renderPlayers();
  if (G.net && Math.abs((G.lastRollsSent || 0) - G.save.rolls) >= 25) { G.lastRollsSent = G.save.rolls; G.net.update({ rolls: G.save.rolls }); }
  if ((G.boardTick = (G.boardTick || 0) + 1) >= 120) { G.boardTick = 0; loadBoard(); }
  if (G.raid) renderRaidBar();
  if (G.player.raidHp < 100 && !G.respawning && now() - (G.player.lastHurt || 0) > 4000) G.player.raidHp = Math.min(100, G.player.raidHp + 5);
  { const p = G.player, n = now();   // the golden apple: Regeneration, and golden hearts that wear off after 2 minutes
    if ((p.regenUntil || 0) > n) { p.hp = Math.min(100, p.hp + 5); if (p.raidHp !== undefined) p.raidHp = Math.min(100, p.raidHp + 5); if (p.pvp) drawMyTag(); }
    if (p.absorb && n > (p.absorbUntil || 0)) p.absorb = 0;
    if (p.absorb || (p.regenUntil || 0) > n - 1500) renderBossBar(); }
  if (G.crawler && (G.player.pos.distanceTo(G.world.arena) < 60) !== !!G.nearArena) renderAbilities();
  if (G.player.emoteUntil && G.player.emoteUntil < now()) { G.player.emote = null; G.player.emoteUntil = 0; if (G.net) G.net.update({ emote: null }); }
  // AFK after 5 minutes of nothing, like Roblox; a secret after 10
  const idle = now() - (G.lastInput || now());
  if (idle > 300000 && !G.afk) { G.afk = true; drawMyTag(); if (G.net) G.net.update({ afk: true }); }
  if (idle > 600000) findEgg('afk');
  if ((G.achTick = (G.achTick || 0) + 1) >= 4) { G.achTick = 0; checkAchievements(); }
  maybeStartRaid();
  if (G.xfight) G.xfight.tryScheduled();
}

function movePlayer(dt) {
  const p = G.player, k = G.input.keys, j = G.input.joy, n = now();
  if (p.xdive) {
    const prevY = p.pos.y; diveTick(dt); if (!p.noclip) collide(p, prevY);
    if (p.xdive && (p.xdive.land || (p.xdive.stage >= 7 && p.onGround))) spearmaceHit(p.xdive);
    p.avatar.animate(dt, 0, true, null, null, { kind: p.xdive && p.xdive.stage >= 7 && p.xdive.stage < 8 ? 'lunge' : 'raise' });
    return;
  }
  eatTick();
  let fx = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0) + j.x;
  let fz = (k.s || k.arrowdown ? 1 : 0) - (k.w || k.arrowup ? 1 : 0) + j.y;
  if ((G.panel && !G.touch) || G.fishing || (G.chat && G.chat.typing) || G.cine) { fx = 0; fz = 0; }
  const m = Math.min(1, Math.hypot(fx, fz));
  const yaw = G.cam.yaw;
  const dirX = fx * Math.cos(yaw) + fz * Math.sin(yaw), dirZ = -fx * Math.sin(yaw) + fz * Math.cos(yaw);
  const flying = p.fly || p.flyUntil > n || p.flyToggle;
  const speed = WALK * (flying ? 2.4 : 1) * (p.blocking ? 0.35 : 1) * (p.eating ? 0.45 : 1);
  if (m > 0.05) { const len = Math.hypot(dirX, dirZ) || 1; p.vel.x = dirX / len * speed * m; p.vel.z = dirZ / len * speed * m; }
  else { p.vel.x = 0; p.vel.z = 0; }
  const want = G.shiftLock || firstPerson() ? yaw + Math.PI : m > 0.05 ? Math.atan2(p.vel.x, p.vel.z) : p.yaw;
  let d = want - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); p.yaw += d * Math.min(1, dt * 28);
  p.moving = m > 0.05;
  if (p.moving && p.emote) { p.emote = null; p.emoteUntil = 0; if (G.net) G.net.update({ emote: null }); }
  if (p.knock) { p.vel.x += p.knock.x; p.vel.z += p.knock.z; p.knock.x *= Math.pow(0.02, dt); p.knock.z *= Math.pow(0.02, dt); if (Math.hypot(p.knock.x, p.knock.z) < 0.5) p.knock = null; }
  if (p.dash) { p.vel.x += p.dash.x; p.vel.z += p.dash.z; p.dash.t -= dt; if (p.dash.t <= 0) p.dash = null; }
  const prevY = p.pos.y;
  p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt;
  if (flying) {
    p.vel.y = ((k[' '] ? 1 : 0) - (k.q ? 1 : 0)) * speed;
    p.pos.y += p.vel.y * dt;
  } else {
    if (k[' '] && p.onGround) { p.vel.y = JUMP; p.onGround = false; sound('jump'); }
    p.vel.y -= GRAVITY * dt;
    p.pos.y += p.vel.y * dt;
  }
  if (!p.noclip) collide(p, prevY);
  const pit = G.world.pit;
  if (p.pos.x > pit.min.x && p.pos.x < pit.max.x && p.pos.z > pit.min.z && p.pos.z < pit.max.z && p.pos.y < pit.max.y) { p.pos.copy(pit.back); p.vel.set(0, 0, 0); toast('You fell into the dark. Back to the corridor.'); }
  // into the sea: back to the last dry place you stood on
  if (p.onGround && p.pos.y > -1 && Math.abs(p.pos.z) < 140 && Math.abs(p.pos.x) < 300) G.safe = p.pos.clone();
  if (p.pos.y < -4 && Math.abs(p.pos.z) < 140 && Math.abs(p.pos.x) < 300) { p.pos.copy(G.safe || G.world.spawn); p.vel.set(0, 0, 0); toast('Splash! Back to dry land.'); sound('splash'); }
  if (p.pos.y < -60) { p.pos.copy(G.world.spawn); p.vel.set(0, 0, 0); toast('You fell out of the world. Back to spawn.'); }
  xShieldUp(p.avatar, !!p.blocking);
  p.avatar.animate(dt, Math.hypot(p.vel.x, p.vel.z), !p.onGround && !flying, p.emote, floats(G.save.equipped) ? 'float' : null, xAct(p));
}
// Bump into blocks, step up small ledges (like stairs), stand on things.
function collide(p, prevY) {
  const C = G.world.colliders, B = G.world.bounds;
  for (const b of C) {
    if (p.pos.x + R <= b.min.x || p.pos.x - R >= b.max.x || p.pos.z + R <= b.min.z || p.pos.z - R >= b.max.z) continue;
    if (p.pos.y >= b.max.y - 0.001 || p.pos.y + H <= b.min.y) continue;
    if (!b.water && b.max.y - p.pos.y <= STEP && (p.onGround || p.vel.y <= 0)) { p.pos.y = b.max.y; p.vel.y = Math.max(0, p.vel.y); continue; }
    if (p.vel.y > 0 && prevY + H <= b.min.y + 0.05) { p.pos.y = b.min.y - H; p.vel.y = 0; continue; }
    const dx1 = b.max.x - (p.pos.x - R), dx2 = (p.pos.x + R) - b.min.x, dz1 = b.max.z - (p.pos.z - R), dz2 = (p.pos.z + R) - b.min.z;
    const mn = Math.min(dx1, dx2, dz1, dz2);
    if (mn === dx1) p.pos.x += dx1; else if (mn === dx2) p.pos.x -= dx2; else if (mn === dz1) p.pos.z += dz1; else p.pos.z -= dz2;
  }
  const inPit = p.pos.x > G.world.pit.min.x && p.pos.x < G.world.pit.max.x && p.pos.z > G.world.pit.min.z && p.pos.z < G.world.pit.max.z;
  let ground = (p.pos.x >= B.minX && p.pos.x <= B.maxX && p.pos.z >= B.minZ && p.pos.z <= B.maxZ) || Math.abs(p.pos.z - 900) < 20 ? (inPit ? -10 : 0) : -Infinity;
  for (const b of C) {
    if (b.water || p.pos.x + R * 0.7 <= b.min.x || p.pos.x - R * 0.7 >= b.max.x || p.pos.z + R * 0.7 <= b.min.z || p.pos.z - R * 0.7 >= b.max.z) continue;
    if (b.max.y <= p.pos.y + 0.05 && b.max.y > ground) ground = b.max.y;
  }
  if (p.pos.y <= ground) { p.pos.y = ground; if (p.vel.y < 0) p.vel.y = 0; p.onGround = true; }
  else p.onGround = p.pos.y - ground < 0.05;
}

// The camera sits exactly where it should every frame (no drifting behind), like Roblox. Only the zoom eases.
// Zoom in steps like Roblox (wheel, or I and O). All the way in is first person.
const firstPerson = () => !!(G && G.cam && G.cam.zoom < 0.5 && !G.cine);
function zoomBy(step) {
  const c = G.cam, cvs = $q('.oc-canvas');
  if (step < 0) c.zoom = c.zoom <= 4 ? 0 : Math.max(4, c.zoom - 3);
  else c.zoom = c.zoom < 0.5 ? 4 : Math.min(48, c.zoom + 3);
  if (c.zoom < 0.5 && !G.touch && cvs.requestPointerLock && document.pointerLockElement !== cvs) { try { const r = cvs.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
  if (c.zoom >= 0.5 && !G.shiftLock && document.pointerLockElement === cvs) document.exitPointerLock();
}
const floats = key => !!(key && auraKey(key).aura.float);
function updateCamera(dt, t) {
  const cam = G.camera;
  if (G.cine) { G.cine.camera(cam); return; }
  if (G.titleCam) {
    const a = t * 0.06;
    cam.position.set(-20 + Math.cos(a) * 95, 42 + Math.sin(t * 0.2) * 4, Math.sin(a) * 80);
    cam.lookAt(-30, 10, -10);
    return;
  }
  const p = G.player.pos, c = G.cam, s = G.player.scale;
  c.dist += (c.zoom * Math.max(0.6, s) - c.dist) * Math.min(1, dt * 18);
  const lift = floats(G.save.equipped) ? 1.5 : 0;
  const dir = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch));
  // first person: the camera is your eyes, and you don't see your own body
  const fp = c.zoom < 0.5 && c.dist < 1;
  G.player.avatar.root.visible = !fp;
  $q('.oc-crosshair').classList.toggle('hidden', !fp);
  if (fp) { const eye = new THREE.Vector3(p.x, p.y + (4.65 + lift) * s, p.z); cam.position.copy(eye); cam.lookAt(eye.sub(dir)); return; }
  const target = new THREE.Vector3(p.x, p.y + (4.5 + lift) * s, p.z);
  if (G.shiftLock) target.add(new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw)).multiplyScalar(1.75));
  // like Roblox, the camera slides in when a wall is between it and you
  let reach = c.dist;
  for (const b of G.world.colliders) { if (b.water || b.cam === false) continue; const hit = rayBox(target, dir, b.min, b.max, reach); if (hit !== null) reach = hit; }
  cam.position.copy(target).addScaledVector(dir, Math.max(1.2, reach - 0.35));
  if (cam.position.y < 0.6) cam.position.y = 0.6;
  cam.lookAt(target);
  if (G.shake > 0.01) { cam.position.x += (Math.random() - 0.5) * G.shake; cam.position.y += (Math.random() - 0.5) * G.shake; G.shake *= Math.pow(0.02, dt); }
}

// where a ray from o along d first enters the box, or null (slab test)
function rayBox(o, d, min, max, maxT) {
  let t0 = 0, t1 = maxT;
  for (const ax of ['x', 'y', 'z']) {
    if (Math.abs(d[ax]) < 1e-9) { if (o[ax] < min[ax] || o[ax] > max[ax]) return null; continue; }
    let tn = (min[ax] - o[ax]) / d[ax], tf = (max[ax] - o[ax]) / d[ax];
    if (tn > tf) { const s = tn; tn = tf; tf = s; }
    if (tn > t0) t0 = tn; if (tf < t1) t1 = tf;
    if (t0 > t1) return null;
  }
  return t0 > 0 ? t0 : null;
}

function updateOthers(dt, t) {
  for (const o of G.others.values()) {
    const visible = o.placed && G.net && G.net.streaming;
    o.avatar.root.visible = visible;
    if (!visible) continue;
    const before = o.pos.clone();
    o.pos.lerp(o.target, 1 - Math.exp(-dt * 12));
    let d = o.targetYaw - o.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); o.yaw += d * Math.min(1, dt * 14);
    o.avatar.root.position.copy(o.pos); o.avatar.root.rotation.y = o.yaw;
    const sp = before.distanceTo(o.pos) / Math.max(dt, 0.001);
    const xa = !!(o.key && auraKey(o.key).aura.id === 'xboss');
    if (xa !== !!o.avatar.xgear) { xGear(o.avatar, xa); if (xa) xHold(o.avatar, 'sword'); }
    o.blocking = xa && !!(o.data && o.data.blk); if (xa) xShieldUp(o.avatar, o.blocking);
    o.avatar.animate(dt, o.anim ? Math.max(sp, 8) : 0, o.target.y - o.pos.y > 0.5, o.data && o.data.emote, floats(o.key) ? 'float' : null, xa ? xAct(o) : null);
    if (o.fx) o.fx.update(dt, t);
    if (o.data && o.data.pvp && o.hp !== o.lastHp) { o.lastHp = o.hp; o.avatar.tag.userData.draw(o.data.name || o.uid, o.key, o.hp < 0 ? 100 : o.hp, { afk: o.data.afk }); }
  }
}

// ---------------- chat bubbles over heads, and chat commands ----------------
function showBubble(uid, text) {
  if (!G || !G.save.settings.bubbles) return;
  let b = G.bubbles.get(uid);
  if (!b) { const el = document.createElement('div'); el.className = 'oc-bubble'; $q('.oc-bubbles').appendChild(el); b = { el }; G.bubbles.set(uid, b); }
  b.el.textContent = text; b.until = now() + 7000;
}
function updateBubbles() {
  if (!G.bubbles.size) return;
  const v = new THREE.Vector3(), w = window.innerWidth, h = window.innerHeight, n = now();
  for (const [uid, b] of G.bubbles) {
    if (b.until < n) { b.el.remove(); G.bubbles.delete(uid); continue; }
    const holder = uid === G.me.uid ? G.player.avatar.root : (G.others.get(uid) || {}).avatar && G.others.get(uid).avatar.root;
    if (!holder || !holder.visible) { b.el.style.display = 'none'; continue; }
    v.copy(holder.position); v.y += 8.4 * (uid === G.me.uid ? G.player.scale : 1);
    const dist = v.distanceTo(G.camera.position);
    v.project(G.camera);
    if (v.z > 1 || dist > 90) { b.el.style.display = 'none'; continue; }
    b.el.style.display = '';
    b.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
  }
}
function chatCommand(cmd, args) {
  const p = G.player;
  const emote = name => {
    p.emote = name; p.emoteUntil = now() + 6000; if (G.net) G.net.update({ emote: name });
    const b = G.world.places.bell.pos; if (name === 'dance' && Math.hypot(p.pos.x - b.x, p.pos.z - b.z) < 12 && Math.abs(p.pos.y - b.y) < 5) findEgg('summitdance');
    return true;
  };
  if (cmd === 'help') { G.chat.system('/e dance, /e wave: emotes. /title: your titles. /clear: clear the chat. Press Tab for the player list.', '#bdbdbd'); return true; }
  if (cmd === 'e' || cmd === 'emote') { const e = (args[0] || '').toLowerCase(); if (e === 'dance' || e === 'wave') return emote(e); G.chat.system('Emotes: /e dance, /e wave', '#bdbdbd'); return true; }
  if (cmd === 'dance' || cmd === 'wave') return emote(cmd);
  if (cmd === 'clear') { G.chat.el.querySelector('.oc-chat-log').innerHTML = ''; return true; }
  if (cmd === 'sol') { G.chat.system('[???]: The sun remembers every roll.', '#ffca28'); findEgg('solchat'); return true; }
  if (cmd === 'title') { G.chat.system(G.save.titles.length ? 'Your titles: ' + G.save.titles.join(', ') + '. Pick one in Settings, Miscellaneous.' : 'No titles yet. Achievements give them.', '#bdbdbd'); return true; }
  return false;
}

// ---------------- places you can talk to, and the secrets ----------------
function placeActive(id) {
  const side = G.save.quests.side, env = G.env;
  if (id === 'jester') return env.jester;
  if (id === 'ghost') return env.time === 'night';
  if (id === 'portal_stella' || id === 'portal_back') return side.stella === 'done';
  if (id === 'chest') return !G.save.chest;
  if (id.startsWith('card')) return side.cards && side.cards.state === 'active' && !(side.cards.found || []).includes(id);
  if (id === 'jack' || id === 'hex') return isHalloween();
  return true;
}
function checkPlaces() {
  const p = G.player.pos;
  let near = null;
  for (const [id, pl] of Object.entries(G.world.places)) {
    if (Math.hypot(p.x - pl.pos.x, p.z - pl.pos.z) >= pl.r || Math.abs(p.y - pl.pos.y) >= 4 || !placeActive(id)) continue;
    if (pl.auto) {
      if (id === 'obby') finishObby();
      if (id === 'jukebox_exit') teleportOnce(G.world.rooms.tower, 'Back at the tower.');
      if (id === 'limbo_exit') teleportOnce(G.world.rooms.limboDoor, 'You found your way back.');
      continue;
    }
    near = id; break;
  }
  if (near !== G.near) {
    G.near = near;
    const el = $q('.oc-prompt');
    el.classList.toggle('hidden', !near);
    if (near) el.innerHTML = `<kbd>E</kbd><span>${esc(G.world.places[near].label)}</span>`;
    $q('.oc-act').classList.toggle('ready', !!near);
    if (!near && G.fishing) stopFishing();
  }
}
function interact() {
  if (!G.near || G.portraitBlock) return;
  const id = G.near, pl = G.world.places[id];
  if (pl.spot) { if (G.fishing) reelPress(); else startFishing(pl.spot); return; }
  if (id === 'bell') return ringBell();
  if (id === 'portal_stella') return teleportTo(G.world.stellaCamp, 'The portal takes you to Stella.');
  if (id === 'portal_back') return teleportTo(G.world.caveMouth, 'Back outside the mountain.');
  if (id === 'chest') return openChest();
  if (id.startsWith('card')) return pickCard(id);
  if (id === 'questboard') return openPanel('quests');
  if (id === 'towerdoor') return teleportTo(G.world.rooms.jukebox, 'A little room under the tower. Music is playing.');
  if (id === 'limbodoor') {
    if (!G.save.keys.void) { toast('The black door is locked. Something from the deepest water might open it.', 'warn'); sound('hurt'); return; }
    return teleportTo(G.world.rooms.limbo, 'The Void Key turns. You are in Limbo. Rolls here can find Limbo auras.');
  }
  if (id === 'qblock') return hitQBlock();
  openPanel(id);
}
const EGGS = ['duck', 'cave', 'tower', 'glitch', 'sun', 'summit', 'crystal', 'graveyard', 'moonsun', 'konami', 'devpc',
  'duck2', 'duck3', 'duck4', 'ducks', 'islet', 'jukebox', 'limbo', 'qblock', 'bellringer', 'summitdance', 'boots', 'unlucky', 'solchat', 'afk'];
const EGG_INFO = {
  duck: ['the rubber duck', { coins: 500 }], cave: ['the Dev Room', { coins: 1500 }], tower: ['the top of the tower', { coins: 2500 }], glitch: ['the glitch', { void: 1 }],
  sun: ['the sun statue', { coins: 1000 }], summit: ['the top of the mountain', { potions: { fortune2: 1 } }], crystal: ['the hidden crystal room', { coins: 3000 }],
  graveyard: ['the graveyard at night', { potions: { zombie: 1 } }], moonsun: ['the sun asleep at night', { potions: { fortune1: 2 } }], konami: ['an old cheat code', { potions: { lucky: 5 } }],
  devpc: ['secret.exe', { coins: 1337 }],
  duck2: ['a duck in the creek', { coins: 500 }], duck3: ['a duck behind Mari\'s shop', { coins: 500 }], duck4: ['a duck on the tiny island', { coins: 500 }],
  ducks: ['the whole duck family', { void: 1, potions: { chest2: 1 } }], islet: ['the edge of the world', { coins: 2500 }], jukebox: ['the room under the tower', { potions: { chest1: 2 } }],
  limbo: ['Limbo', { potions: { chest3: 1 } }], qblock: ['the ? block', { coins: 777 }], bellringer: ['a very loud bell (10 rings)', { potions: { haste2: 2 } }],
  summitdance: ['a dance on top of the world', { potions: { fortune3: 1 } }], boots: ['ten old boots', { potions: { diver: 2 } }], unlucky: ['ten Commons in a row', { potions: { heavenly1: 1 } }],
  solchat: ['a word to the sun', { potions: { lucky: 7 } }], afk: ['a very long nap', { potions: { chest1: 1 } }],
};
const DUCKS = ['duck', 'duck2', 'duck3', 'duck4'];
function findEgg(id) {
  if (!G || G.save.eggs[id]) return;
  G.save.eggs[id] = true;
  const [name, reward] = EGG_INFO[id];
  const got = giveReward(reward);
  toast(`Secret found: ${name} (${Object.keys(G.save.eggs).filter(e => EGGS.includes(e)).length}/${EGGS.length}). ${got}`, 'gold');
  sound(DUCKS.includes(id) ? 'quack' : 'secret');
  addXp(100);
  markDirty();
  if (DUCKS.includes(id) && DUCKS.every(d => G.save.eggs[d])) setTimeout(() => findEgg('ducks'), 1200);
}
function checkEggs() {
  const p = G.player.pos, eggs = G.world.eggs;
  for (const [id, e] of Object.entries(eggs)) {
    if (e.night && G.env.time !== 'night') continue;
    let inside;
    if (e.box) inside = p.x > e.box.min.x && p.x < e.box.max.x && p.z > e.box.min.z && p.z < e.box.max.z && p.y > e.box.min.y && p.y < e.box.max.y;
    else inside = Math.hypot(p.x - e.pos.x, p.z - e.pos.z) < e.r && Math.abs(p.y - e.pos.y) < 4;
    if (!inside) continue;
    if (id === 'glitch' && !G.inNull) { G.inNull = true; glitchTo(G.world.nullRoom.spawn, 'You slipped through a glitch.'); }
    if (id === 'sun' && G.env.time === 'night') findEgg('moonsun');
    findEgg(id);
  }
  if (G.inNull && p.distanceTo(G.world.nullRoom.portal) < 3.5) { G.inNull = false; glitchTo(G.world.spawn, 'Back to reality.'); }
}
// for the automatic exits: only once, until you have walked away
// Portals and doors: you stretch into a beam of your aura's colour and step out of another one.
function teleportOnce(where, msg) { if (G.lastGlitch && now() - G.lastGlitch < 1500) return; G.lastGlitch = now(); teleportTo(where, msg); }
function teleportTo(where, msg) {
  const p = G.player, f = { kind: 'tp', x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), x2: +where.x.toFixed(2), y2: +where.y.toFixed(2), z2: +where.z.toFixed(2), c: auraKey(G.save.equipped).aura.c || '#ffffff', tier: 0 };
  const fx = castFx(G.scene, f); if (fx) G.fxObjects.push(fx);
  if (G.net) G.net.fx(f);
  sound('teleport');
  p.pos.copy(where); p.vel.set(0, 0, 0); p.tpAt = now();
  toast(msg);
}
function glitchToOnce(where, msg) { if (G.lastGlitch && now() - G.lastGlitch < 1500) return; G.lastGlitch = now(); glitchTo(where, msg); }
function glitchTo(where, msg) {
  const el = G.root;
  el.classList.add('oc-glitching');
  sound('glitch');
  setTimeout(() => { if (!G) return; G.player.pos.copy(where); G.player.vel.set(0, 0, 0); toast(msg); }, 250);
  setTimeout(() => el.classList.remove('oc-glitching'), 700);
}
// Rewards: { coins, f, void, potions: { id: n }, items: [id] } -> "+2 Lucky Potion, +500 coins"
function giveReward(r, label = true) {
  const out = [], b = buffs();
  if (r.coins) { const c = Math.round(r.coins * b.coin); G.save.coins += c; out.push(`+${fmt(c)} coins`); }
  if (r.f) { G.save.f += r.f; out.push(`+${fmt(r.f)} F`); }
  if (r.void) { G.save.void += r.void; out.push(`+${r.void} Void Coin${r.void > 1 ? 's' : ''}`); }
  for (const [id, n] of Object.entries(r.potions || {})) if (POTION[id]) { G.save.potions[id] = potionCount(id) + n; out.push(`+${n} ${POTION[id].name}`); }
  for (const id of r.items || []) if (ITEM[id]) { G.save.items[id] = true; out.push(ITEM[id].name); }
  for (const id of r.gears || []) if (GEAR[id]) { G.save.gears[id] = (G.save.gears[id] || 0) + 1; out.push(GEAR[id].name); }
  if (r.title && !G.save.titles.includes(r.title)) { G.save.titles.push(r.title); out.push(`the title ${r.title}`); }
  markDirty(); updateHud();
  return label ? out.join(', ') : out;
}

// ---------------- the Sky Parkour, the bell, the chest and the Jester's cards ----------------
function finishObby() {
  const n = now();
  if (n - (G.save.lastObby || 0) < 180000) return;
  G.save.lastObby = n;
  addEffect('parkour');
  progress('obby');
  const side = G.save.quests.side;
  if (side.parkour !== 'done') { side.parkour = 'done'; G.save.coins += 2500; toast('Side quest done: Head in the Clouds. +2,500 coins', 'gold'); }
  toast('You finished the Sky Parkour: +30% luck for 1 minute.', 'gold');
  sound('secret'); markDirty();
}
function ringBell() {
  const n = now();
  G.world.ringBell(); sound('bell');
  G.bellRings = [...(G.bellRings || []).filter(x => n - x < 20000), n];
  if (G.bellRings.length >= 10) findEgg('bellringer');
  if (G.chat) G.chat.system(`${G.me.name} rang the bell on the mountain.`, '#ffe082');
  const side = G.save.quests.side;
  if (side.summit === 'active') { side.summit = 'done'; toast('Side quest done: The Bell at the Top. ' + giveReward({ potions: { fortune2: 3 } }), 'gold'); }
  progress('bell');
  if (n - (G.save.lastBell || 0) > 600000) { G.save.lastBell = n; addEffect('summit'); toast('Summit Blessing: +50% luck for 2 minutes.', 'gold'); }
  markDirty();
}
function openChest() {
  if (G.save.chest) return;
  G.save.chest = true; G.world.setChest(true);
  toast('The chest held a Heavenly Potion. ' + giveReward({ potions: { heavenly: 1 } }), 'gold');
  sound('secret');
}
function pickCard(id) {
  const c = G.save.quests.side.cards;
  if (!c || c.state !== 'active') return;
  c.found = [...new Set([...(c.found || []), id])];
  sound('secret');
  if (c.found.length >= 3) { c.state = 'done'; toast('All three cards found. The Jester sends his thanks: ' + giveReward({ potions: { strange2: 1 }, void: 1 }), 'gold'); }
  else toast(`You found one of the Jester's cards (${c.found.length}/3).`, 'gold');
  refreshWorldFlags(); markDirty();
}
function refreshWorldFlags() {
  const side = G.save.quests.side, cards = side.cards || {};
  G.world.setHalloween(isHalloween());
  G.world.setPortals(side.stella === 'done');
  G.world.setChest(!!G.save.chest);
  const vis = {}; if (cards.state === 'active') ['card1', 'card2', 'card3'].forEach(id => { vis[id] = !(cards.found || []).includes(id); });
  G.world.setCards(vis);
}

// ---------------- things lying on the ground ----------------
function pickupKind(def) {
  if (def.kind === 'potion') return { model: () => potionModel(POTION[def.id].color, 1), color: POTION[def.id].color };
  if (def.kind === 'star') return { model: () => { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), new THREE.MeshStandardMaterial({ color: '#e3f2ff', emissive: '#9fd0ff', emissiveIntensity: 1 })); return m; }, color: def.color };
  if (def.kind === 'token') return { model: () => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), new THREE.MeshStandardMaterial({ color: '#ff7a00', emissive: '#ff6d00', emissiveIntensity: 0.4 })); m.scale.y = 0.8; g.add(m); const s = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 6), new THREE.MeshStandardMaterial({ color: '#4e7a2a' })); s.position.y = 0.55; g.add(s); return g; }, color: def.color };
  return { model: () => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.18, 20), new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.3 })); m.rotation.x = Math.PI / 2; const g = new THREE.Group(); g.add(m); return g; }, color: def.color };
}
const TOKEN = { id: 'token', kind: 'token', w: 22, color: '#ff9800', name: 'Pumpkin Token' };
function spawnPickup(forceId, near) {
  const env = G.env, side = G.save.quests.side, all = [...PICKUPS, ...(isHalloween() ? [TOKEN] : [])];
  const pool = all.filter(d => (!d.weather || d.weather === env.weather) && (!d.night || env.time === 'night') && (d.id !== 'stellastar' || side.stella === 'active'));
  let def = forceId ? all.find(d => d.id === forceId) : null;
  if (!def) { let r = Math.random() * pool.reduce((s, d) => s + d.w, 0); def = pool.find(d => (r -= d.w) <= 0) || pool[0]; }
  const used = new Set(G.pickups.map(p => p.spot));
  const spots = G.world.itemSpots.map((s, i) => i).filter(i => !used.has(i));
  if (!spots.length) return;
  let spot = spots[Math.floor(Math.random() * spots.length)];
  if (near) spot = spots.sort((a, b) => G.world.itemSpots[a].distanceTo(G.player.pos) - G.world.itemSpots[b].distanceTo(G.player.pos))[0];
  const at = G.world.itemSpots[spot];
  const k = pickupKind(def), obj = new THREE.Group(), model = k.model();
  obj.add(model);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: k.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
  glow.scale.set(3.2, 3.2, 1); glow.position.y = 0.6; obj.add(glow);
  obj.position.set(at.x, at.y + 0.5, at.z);
  G.scene.add(obj);
  G.pickups.push({ def, spot, obj, model, base: at.y + 0.5, born: now() });
}
function updatePickups(dt, t) {
  G.pickupTimer = (G.pickupTimer || 0) - dt;
  if (G.pickupTimer <= 0) { G.pickupTimer = 9 + Math.random() * 6; if (G.pickups.length < 12) spawnPickup(); }
  const p = G.player.pos;
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const it = G.pickups[i];
    it.model.rotation.y += dt * 2; it.obj.position.y = it.base + Math.sin(t * 2.4 + i) * 0.25;
    const expired = now() - it.born > 6 * 60000;
    if (!expired && (Math.hypot(p.x - it.obj.position.x, p.z - it.obj.position.z) > 2.4 || Math.abs(p.y - it.base) > 3.5)) continue;
    G.scene.remove(it.obj); it.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    G.pickups.splice(i, 1);
    if (!expired) collect(it.def);
  }
}
function collect(def) {
  if (def.kind === 'coins') { const c = Math.round((def.min + Math.random() * (def.max - def.min)) * buffs().coin); G.save.coins += c; toast(`+${fmt(c)} coins`, 'gold'); sound('coin'); }
  else if (def.kind === 'potion') { G.save.potions[def.id] = potionCount(def.id) + 1; toast(`You picked up a ${POTION[def.id].name}.`, 'gold'); sound('potion'); }
  else if (def.kind === 'star') { const side = G.save.quests.side; if (side.stella === 'active') { side.stella = 'star'; toast('You found a Stella\'s Star. Bring it to Stella in the mountain cave.', 'gold'); sound('secret'); } }
  else if (def.kind === 'token') { const n = 1 + Math.floor(Math.random() * 3); G.save.tokens += n; toast(`+${n} Pumpkin Token${n > 1 ? 's' : ''}. Jack at the graveyard trades them.`, 'gold'); sound('coin'); }
  G.save.stats.pickups++; progress('pickups'); addXp(5); markDirty(); updateHud();
}

// ---------------- buffs: potions and gear added up ----------------
function activeEffects() { const n = now(); G.effects = G.effects.filter(e => e.until > n); return G.effects; }
function buffs() {
  const env = G.env, b = { luck: 1, speed: 1, gem: 1, coin: 1, mut: 1, fish: 1, fishLuck: 0, voidLuck: 1, rod: 1, anyWeather: [] };
  const add = x => {
    if (!x) return;
    if (x.luck && (!x.when || x.when === env.time)) b.luck += x.luck;
    if (x.speed) b.speed += x.speed;
    if (x.gem) b.gem = Math.max(b.gem, x.gem);
    if (x.coin) b.coin += x.coin;
    if (x.mut) b.mut += x.mut;
    if (x.fish) b.fish += x.fish;
    if (x.fishLuck) b.fishLuck += x.fishLuck;
    if (x.voidLuck) b.voidLuck += x.voidLuck;
    if (x.rod) b.rod = Math.max(b.rod, x.rod);
    if (x.universe) b.anyWeather.push('starfall');
    if (x.hellAnywhere) b.anyWeather.push('hell');
  };
  for (const e of activeEffects()) add(e.out || POTION[e.id]);
  for (const it of ITEMS) if (hasItem(it.id)) add(it);
  for (const r of G.rollBuffs) { const p = POTION[r.id]; if (!p) { if (r.luck) b.luck += r.luck; if (r.speed) b.speed += r.speed; continue; } if (p.rollSpeed) b.speed += p.rollSpeed.speed; }
  // gears in your hands
  let base = 1;
  for (const g of wornGears()) {
    add(g);
    if (g.wLuck && g.wLuck.w.includes(env.weather)) b.luck += g.wLuck.l;
    if (g.wSpeed && g.wSpeed.w.includes(env.weather)) b.speed += g.wSpeed.s;
    if (g.baseLuck) base *= g.baseLuck;
  }
  // +5% luck for every 10 achievements, like Sol's
  b.luck += 0.05 * Math.floor(Object.keys(G.save.achievements).length / 10);
  b.luck = Math.max(0.1, b.luck) * base; b.speed = Math.max(0.25, b.speed);
  const sl = (G.worldState || {}).luck; b.server = sl && sl.until > now() ? sl.mult : 1;
  return b;
}
const hasGear = id => (G.save.gears[id] || 0) > 0 || isOwner();
const wornGears = () => [G.save.hands.left, G.save.hands.right].filter(id => id && GEAR[id] && hasGear(id)).map(id => GEAR[id]);
// the bonus roll: every 10th roll is 2x as lucky, unless a left-hand gear changes it
function bonusInfo() {
  const g = GEAR[G.save.hands.left], ok = g && hasGear(g.id);
  return { every: ok && g.bonusEvery || 10, mult: ok && g.bonusMult || 2, all: ok && g.bonusAll || 0, none: ok && !!g.noBonus };
}
const tenthRoll = () => { const bi = bonusInfo(); return bi.none ? false : bi.all ? true : (G.save.rolls + 1) % bi.every === 0; };
function luckNow(b = buffs()) {
  const bi = bonusInfo();
  let luck = b.luck * (tenthRoll() ? (bi.all || bi.mult) : 1);
  for (const r of G.rollBuffs) { const p = POTION[r.id]; if (p && p.boost) luck += p.boost.l; }
  return luck * b.server;
}
function addEffect(id, out) {
  const p = POTION[id], cur = G.effects.find(e => e.id === id && !e.out);
  if (cur && !out) cur.until += p.secs * 1000; else G.effects.push({ id, until: now() + p.secs * 1000, ...(out ? { out } : {}) });
  updateHud();
}

// ---------------- quests ----------------
function checkDay() {
  const day = dayIndex(now()), q = G.save.quests;
  if (q.day !== day) { q.day = day; q.prog = {}; q.claimed = []; }
  G.todays = dailyQuests(day);
}
function progress(stat, n = 1) {
  const q = G.save.quests;
  for (const d of G.todays || []) if (d.stat === stat && !q.claimed.includes(d.id)) q.prog[d.id] = Math.min(d.goal, (q.prog[d.id] || 0) + n);
  const ready = (G.todays || []).some(d => (q.prog[d.id] || 0) >= d.goal && !q.claimed.includes(d.id));
  const dot = $q('[data-open="quests"] .oc-dot'); if (dot) dot.classList.toggle('hidden', !ready);
}

// ---------------- achievements and titles ----------------
function achieveStats() {
  const s = G.save, st = s.stats, side = Object.values(s.quests.side);
  return {
    rolls: s.rolls, bestTier: s.bestTier || 0, found: s.found, foundCount: Object.keys(s.found).filter(id => AURA[id]).length, glitchMut: !!s.flags.glitchMut,
    biomes: s.biomes, eggs: s.eggs, playSecs: st.playSecs, fish: st.fish, caught: s.caught, secrets: Object.keys(s.eggs).filter(e => EGGS.includes(e)).length, secretsTotal: EGGS.length,
    sideDone: side.filter(v => v === 'done' || (v && v.state === 'done')).length, sideTotal: Object.keys(SIDE_QUEST).length, kos: st.kos, raids: st.raids || 0, crafted: st.crafted || 0,
    potions: st.potions, dailies: st.dailies || 0, passLevel: passLevel().level, xboss: st.xboss || 0,
  };
}
function checkAchievements() {
  if (!G || !G.save) return;
  const s = achieveStats(), got = G.save.achievements;
  let any = false;
  for (const a of ACHIEVEMENTS) {
    if (got[a.id]) continue;
    let ok = false; try { ok = !!a.test(s); } catch (e) {}
    if (!ok) continue;
    got[a.id] = now(); any = true;
    const reward = giveReward({ ...a.reward, ...(a.title ? { title: a.title } : {}) });
    toast(`Achievement: ${a.name}. ${reward}`, 'gold');
    if (G.chat) G.chat.system(`[Achievement] ${a.name}: ${a.desc}`, '#ffd54f');
    addXp(50);
    sound('secret');
  }
  if (any) { markDirty(); dotFor('achievements', true); }
}
const dotFor = (panel, onOff) => { const d = $q(`[data-open="${panel}"] .oc-dot`); if (d) d.classList.toggle('hidden', !onOff); const m = $q('.oc-menu-btn .oc-dot'); if (m) m.classList.toggle('hidden', !G.root.querySelector('.oc-more .oc-dot:not(.hidden)')); };

// ---------------- the Season Pass ----------------
function passLevel() {
  let xp = G.save.pass.xp || 0, level = 0;
  while (level < SEASON.levels && xp >= SEASON.xpFor(level + 1)) { xp -= SEASON.xpFor(level + 1); level++; }
  return { level, xp, need: level < SEASON.levels ? SEASON.xpFor(level + 1) : 0 };
}
function addXp(n) {
  if (!G || !G.save) return;
  const before = passLevel().level;
  G.save.pass.xp = (G.save.pass.xp || 0) + n;
  const after = passLevel().level;
  if (after > before) { toast(`Season Pass: level ${after}! A reward is waiting.`, 'gold'); dotFor('pass', true); sound('secret'); }
}

// ---------------- the ? block on the tiny island: one prize a day ----------------
function hitQBlock() {
  const day = dayIndex(now());
  findEgg('qblock');
  if (G.save.qblockDay === day) { toast('The ? block is empty. Come back tomorrow.'); return; }
  G.save.qblockDay = day;
  const r = Math.random();
  const prize = r < 0.02 ? { void: 1 } : r < 0.25 ? { potions: { chest1: 1 } } : r < 0.5 ? { potions: { fortune1: 1, haste1: 1 } } : { coins: 500 + Math.floor(Math.random() * 4500) };
  toast('? block: ' + giveReward(prize), 'gold'); sound('coin');
}

// ---------------- the raid: The Crawler ----------------
// The lobby's Realtime Database holds its health (ocrng/raid), so everyone fights the same worm. Each player's screen
// draws it and makes it attack them; hits from aura moves (and punches) go into the shared health.
function maybeStartRaid() {
  if (!G.net || G.netDenied) return;
  const n = now(), r = G.raid, slot = Math.floor(n / WEATHER_SLOT_MS);
  if (G.env.weather !== 'sandstorm' || (r && !r.dead && !r.gone && r.until > n) || G.raidTriedSlot === slot || (G.xfight && G.xfight.live())) return;
  G.raidTriedSlot = slot;
  if (r && r.slot === slot) return;
  startRaid(slot);
}
function startRaid(slot, by) {
  const players = Math.max(1, G.net.count || 1), max = Math.max(RAID.hpMin, RAID.hpPer * players), n = now();
  G.net.raidStart({ boss: RAID.id, hp: max, max, start: n, until: n + RAID.mins * 60000, slot: slot ?? -1, by: by || 'the sand' }).catch(() => {});
}
function onRaid(r) {
  const was = G.raid, n = now();
  G.raid = r && r.boss ? r : null;
  const live = G.raid && !G.raid.dead && !G.raid.gone && G.raid.until > n;
  if (live && !G.crawler) {
    G.crawler = createCrawler(G.scene, G.world.arena);
    G.raidDmg = 0; G.raidStart = G.raid.start; G.nextSlam = n + 4000; G.player.raidHp = 100;
    if (G.chat) G.chat.system('[Server]: THE CRAWLER has burst out of the sand in the Pit, east of the plaza! Everyone, fight it!', '#f0c87a');
    sound('announce');
  }
  if (G.raid && G.raid.dead && G.crawler && !G.crawler.dying) { G.crawler.die(); G.crawler.dying = true; raidOver(true); }
  if (G.raid && G.raid.gone && G.crawler && !G.crawler.dying) { G.crawler.die(); G.crawler.dying = true; raidOver(false); }
  if (!G.raid && G.crawler && !G.crawler.dying) { G.crawler.die(); G.crawler.dying = true; }
  if (G.raid && G.raid.hp <= 0 && !G.raid.dead && G.raidDmg > 0) G.net.raidUpdate({ dead: true, killedAt: n });
  renderRaidBar();
  renderAbilities();
}
function raidOver(won) {
  if (G.chat) G.chat.system(won ? '[Server]: THE CRAWLER has been defeated!' : '[Server]: THE CRAWLER burrowed back under the sand.', won ? '#f0c87a' : '#bdbdbd');
  if (won && G.raidDmg > 0 && G.raidRewarded !== G.raidStart) {
    G.raidRewarded = G.raidStart;
    G.save.stats.raids = (G.save.stats.raids || 0) + 1;
    const extra = Math.random() < RAID.duneChance ? { dune: 1 } : {};
    toast(`You helped defeat The Crawler (${fmt(G.raidDmg)} damage). ` + giveReward({ ...RAID.reward, potions: { ...RAID.reward.potions, ...extra } }), 'gold');
    addXp(300); sound('secret'); checkAchievements();
  }
  G.raidDmg = 0;
}
function updateRaid(dt, t) {
  const n = now(), r = G.raid, p = G.player;
  const near = p.pos.distanceTo(G.world.arena) < 60;
  if (!G.crawler.update(dt, t, near ? p.pos : null)) { G.crawler.dispose(); G.crawler = null; renderRaidBar(); renderAbilities(); return; }
  if (!r || r.dead || r.gone || G.crawler.dying) return;
  if (r.until < n) { if (G.raidDmg > 0) G.net.raidUpdate({ gone: true }); return; }
  // the worm slams where you are standing (only on your own screen: everyone dodges their own slams)
  if (near && n > G.nextSlam && !G.portraitBlock) {
    G.nextSlam = n + 2600 + Math.random() * 1600;
    const at = p.pos.clone(), rad = 6.5;
    G.crawler.telegraph(at.x, at.z, rad, 1.15, () => {
      if (!G) return;
      sound('slam');
      const d = Math.hypot(G.player.pos.x - at.x, G.player.pos.z - at.z);
      if (d > rad || G.player.pos.y - at.y > 5) return;
      G.player.raidHp = (G.player.raidHp ?? 100) - 22;
      G.player.knock = { x: (G.player.pos.x - at.x) / (d || 1) * 30, z: (G.player.pos.z - at.z) / (d || 1) * 30 }; G.player.vel.y = 16; G.player.onGround = false;
      G.root.classList.remove('oc-hurt'); void G.root.offsetWidth; G.root.classList.add('oc-hurt');
      if (G.player.raidHp <= 0) { G.player.raidHp = 100; G.player.pos.copy(G.world.spawn); G.player.vel.set(0, 0, 0); toast('The Crawler got you. Back to spawn.', 'warn'); }
      renderRaidBar();
    });
  }
}
// How much of a move hits the worm. It is big, so it counts as a circle around where it stands.
function raidHitFrom(f, dmg) {
  if (!G.crawler || !G.raid || G.raid.dead || !dmg) return;
  const a = G.world.arena;
  const ring = [[0, 0], [2.8, 0], [-2.8, 0], [0, 2.8], [0, -2.8]].map(([dx, dz]) => ({ uid: 'b', pos: { x: a.x + dx, z: a.z + dz } }));
  const pts = f.kind === 'punch' ? (Math.hypot(G.player.pos.x - a.x, G.player.pos.z - a.z) < 12 ? 1 : 0) : hitTest(f, ring).length;
  if (!pts) return;
  const total = Math.round(dmg * (f.kind === 'punch' ? 1 : 3));
  G.raidDmg = (G.raidDmg || 0) + total;
  G.crawler.flash();
  G.net.raidHit(total).catch(() => {});
}
// Something in a raid hit you. Raid health is 10 hearts (100), like Minecraft; at 0 you die, go back to spawn, and
// (against ____X____) your damage counter starts over.
function hurtMe(dmg, o = {}) {
  const p = G.player;
  if (G.respawning || G.portraitBlock) return;
  if (dmg && !o.smash && blocks(o.fx, o.fz)) { shieldHit(o.axe); if (o.kx || o.kz) p.knock = { x: (o.kx || 0) * 0.25, z: (o.kz || 0) * 0.25 }; return; }
  dmg = soak(dmg);
  if (o.kx || o.kz) p.knock = { x: o.kx || 0, z: o.kz || 0 };
  if (o.vy) { p.vel.y = o.vy; p.onGround = false; }
  if (!dmg) return;
  p.raidHp = (p.raidHp ?? 100) - dmg; p.lastHurt = now();
  G.root.classList.remove('oc-hurt'); void G.root.offsetWidth; G.root.classList.add('oc-hurt');
  sound('hurt');
  if (p.raidHp <= 0) {
    G.respawning = true;
    const text = `${G.me.name} ${o.how || 'died'}`;
    if (G.chat) G.chat.system(text, '#ffffff');
    if (G.net) G.net.fx({ kind: 'death', text });
    if (G.xfight) G.xfight.onMyDeath();
    toast('You died! Your damage to ____X____ is back to 0.', 'warn');
    setTimeout(() => { if (!G) return; G.respawning = false; p.raidHp = 100; p.pos.copy(G.world.spawn); p.vel.set(0, 0, 0); p.knock = null; renderBossBar(); }, 1200);
  }
  renderBossBar();
}
// ____X____ is beaten: rewards by how much damage you did. The ____X____ aura goes to whoever did the most, as long as
// they never died and did at least 250 damage.
function xReward(r) {
  const s = G.save;
  s.stats.xboss = (s.stats.xboss || 0) + 1;
  const tiers = [{ void: 3, potions: { heavenly: 2, transcendent: 1, chest3: 2 } }, { void: 2, potions: { heavenly: 1, chest3: 1 } }, { void: 1, potions: { bound: 1, chest2: 2 } }];
  const top = tiers[r.rank - 1] || { potions: { chest2: 1 } };
  const got = giveReward({ coins: 15000, void: top.void || 0, potions: { lucky: 5, speed: 5, ...top.potions } });
  toast(`____X____ is defeated! You were #${r.rank} of ${r.players} with ${fmt(r.dmg)} damage. ${got}`, 'gold');
  if (r.aura) {
    s.auras.xboss = (s.auras.xboss || 0) + 1; s.found.xboss = true;
    const res = auraKey('xboss');
    if (G.net) G.net.announce({ name: G.me.name, key: 'xboss', rarity: res.rarity });
    setTimeout(() => { if (G) cutscene(res).then(() => { if (G && s.settings.autoEquip && res.rarity > auraKey(s.equipped).rarity) equip('xboss'); }); }, 1500);
  } else if (r.rank === 1) toast(r.died ? 'You were #1, but you died, so no ____X____ aura this time.' : 'You were #1, but the ____X____ aura needs at least 250 damage.', 'warn');
  addXp(500); sound('secret'); checkAchievements(); markDirty();
}
function bossBanner(big, small) {
  const el = $q('.oc-announce');
  el.innerHTML = `<b class="oc-mcname big">${esc(big)}</b><span>${esc(small)}</span>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
// The boss bar at the top, like Minecraft's, and your hearts while you are near a raid.
function renderBossBar() {
  if (!G || !G.player) return;
  const info = G.xfight && G.xfight.info(), near = !!(info && G.xfight.near(G.player.pos)), bar = $q('.oc-bossbar');
  bar.classList.toggle('hidden', !near);
  if (near) {
    bar.classList.toggle('p2', info.phase === 2);
    bar.querySelector('i').style.width = (info.dead ? 0 : Math.max(0, Math.min(1, info.hp / info.max)) * 100).toFixed(1) + '%';
    bar.querySelector('small').textContent = info.dead ? 'Defeated' : `${Math.max(0, Math.ceil(info.hp))} / ${info.max}${info.phase === 2 ? '   Phase 2' : ''}${info.mobsTotal ? `   Team null: ${info.mobs} left` : ''}   Your damage: ${fmt(info.myDmg)}${info.rank ? ` (#${info.rank})` : ''}   ${fmtTime(Math.max(0, info.left))}`;
  }
  const p = G.player, raid = near || (G.crawler && !G.crawler.dying && p.pos.distanceTo(G.world.arena) < 70);
  const show = raid || p.pvp || p.absorb > 0 || (p.regenUntil || 0) > now() || !!p.eating;
  const hearts = $q('.oc-hearts');
  hearts.classList.toggle('hidden', !show);
  if (show) {
    // 10 red hearts, and the golden ones (Absorption) in a row above them, like Minecraft
    const hp = Math.max(0, raid ? p.raidHp ?? 100 : p.hp), ab = Math.max(0, Math.ceil(p.absorb || 0));
    const gold = ab > 0 ? `<div class="gold">${Array.from({ length: Math.ceil(ab / 10) }, (_, i) => `<i class="${ab - i * 10 >= 10 ? 'g' : 'gh'}"></i>`).join('')}</div>` : '';
    const html = gold + `<div>${Array.from({ length: 10 }, (_, i) => { const v = hp - i * 10; return `<i class="${v >= 10 ? 'f' : v >= 5 ? 'h' : 'e'}"></i>`; }).join('')}</div>`;
    if (hearts.dataset.h !== html) { hearts.innerHTML = html; hearts.dataset.h = html; hearts.classList.toggle('low', hp <= 30); }
  }
}
function renderRaidBar() {
  const bar = $q('.oc-raidbar'), r = G.raid, live = r && !r.dead && !r.gone && r.until > now() && G.crawler;
  bar.classList.toggle('hidden', !live);
  if (!live) return;
  bar.querySelector('i').style.width = Math.max(0, r.hp / r.max * 100) + '%';
  bar.querySelector('.oc-raid-hp span').textContent = `${fmt(Math.max(0, r.hp))} / ${fmt(r.max)}`;
  bar.querySelector('small').textContent = `Your HP ${Math.max(0, Math.round(G.player.raidHp ?? 100))}  |  ${fmtTime(r.until - now())} left`;
}

// ---------------- rolling ----------------
async function rollOnce() {
  if (!G || !G.playing || G.rolling || G.cutting || G.portraitBlock || (!opfun() && now() < G.nextRollAt)) return;
  G.rolling = true;
  const b = buffs();
  let luck = luckNow(b), used = null;
  if (G.queued.length) { used = G.queued.shift(); luck += POTION[used].oneRoll; }
  G.rollBuffs.forEach(r => { r.left--; }); G.rollBuffs = G.rollBuffs.filter(r => r.left > 0);
  // in Limbo you roll Limbo's auras; the Tide Gauntlet lets bonus rolls find Rainy auras anywhere
  const worn = wornGears(), bonus = tenthRoll();
  const anyWeather = [...b.anyWeather, ...(bonus && worn.some(g => g.tide) ? ['rain'] : [])];
  const rollWeather = G.world.inLimbo(G.player.pos) ? 'limbo' : G.env.weather;
  const res = rollAura(luck, G.env.time, rollWeather, { gem: b.gem, mut: b.mut, anyWeather });
  const s = G.save;
  s.rolls++;
  s.bestTier = Math.max(s.bestTier || 0, tierIndex(res.rarity));
  if (res.mut && res.mut.id === 'glitched') s.flags.glitchMut = true;
  s.flags.commonRow = res.aura.id === 'common' ? (s.flags.commonRow || 0) + 1 : 0;
  if (s.flags.commonRow >= 10) findEgg('unlucky');
  if (res.aura.id === 'jackpot' && worn.some(g => g.jackpotCoins)) { s.coins += 77; toast('Jackpot Gauntlet: +77 coins', 'gold'); }
  if (s.rolls % 10 === 0 && worn.some(g => g.gem)) {   // the Gemstone Gauntlet: a gem lights up for the next 10 rolls
    const luckGem = Math.random() < 0.5, amt = Math.round(Math.random() * 30) / 100;
    G.rollBuffs.push({ id: 'gem', left: 10, ...(luckGem ? { luck: amt } : { speed: amt }) });
    toast(`Gemstone Gauntlet: +${Math.round(amt * 100)}% ${luckGem ? 'luck' : 'roll speed'} for 10 rolls.`);
  }
  addXp(1);
  s.auras[res.key] = (s.auras[res.key] || 0) + 1;
  s.found[res.aura.id] = true;
  if (Math.random() < 1 / 1500) { s.void++; toast('A Void Coin fell out of your roll.', 'gold'); }
  if (res.rarity > auraKey(s.best).rarity) s.best = res.key;
  progress('rolls');
  if (G.env.weather !== 'clear') progress('biomeRolls');
  if (res.rarity >= 1000) progress('rare');
  if (res.rarity >= 10000) progress('anom');
  const quick = s.settings.quick && canQuick();
  if (used) toast(`${POTION[used].name} was used on this roll.`);
  markDirty();
  try {
    const t = tierIndex(res.rarity), cut = s.settings.cutscenes;
    if (cut !== 'off' && t >= (cut === 'rare' ? 5 : 4)) await cutscene(res);
    else if (!quick && !opfun()) await rollAnimation(res, b.speed);
    if (G && !quick) showResult(res, quick);
  } finally {
    if (G) {
      const rarer = res.rarity > auraKey(s.equipped).rarity;
      if (rarer && s.settings.autoEquip) equip(res.key, true);
      else if (rarer && !s.settings.auto && !quick) offerEquip(res.key);
      if (res.rarity >= 100000 && G.net) G.net.announce({ name: G.me.name, key: res.key, rarity: res.rarity });
      checkAchievements();
      G.nextRollAt = opfun() ? 0 : now() + ROLL_COOLDOWN_MS / b.speed;
      G.rolling = false;
      updateHud();
    }
  }
}
// Warp and Transcendent, like Sol's: thousands of rolls at once. Everything lands in your storage and counts as rolls,
// the rarest finds are listed on screen, and the rarest of all gets its cutscene.
function queueBatch(n, name) {
  G.batchQueue = (G.batchQueue || 0) + n; G.batchTotal = (G.batchTotal || 0) + n;
  G.batchLabel = G.batching && G.batchLabel !== name ? 'Instant Rolls' : name;
  if (!G.batching) runBatch();
}
async function runBatch() {
  G.batching = true;
  while (G && (G.rolling || G.cutting)) await sleep(100);
  if (!G) return;
  G.rolling = true;
  const s = G.save, got = new Map(), counts = { rare: 0, anom: 0, jackpot: 0, voids: 0 };
  let done = 0, best = null;
  showBatch(0, got, false);
  while (G && G.batchQueue > 0) {
    const chunk = Math.min(4000, G.batchQueue); G.batchQueue -= chunk;
    const b = buffs(), bi = bonusInfo(), worn = wornGears(), tide = worn.some(g => g.tide), jack = worn.some(g => g.jackpotCoins);
    const weather = G.world.inLimbo(G.player.pos) ? 'limbo' : G.env.weather;
    for (let i = 0; i < chunk; i++) {
      const bonus = tenthRoll();
      const res = rollAura(b.luck * (bonus ? (bi.all || bi.mult) : 1) * b.server, G.env.time, weather, { gem: b.gem, mut: b.mut, anyWeather: bonus && tide ? [...b.anyWeather, 'rain'] : b.anyWeather });
      s.rolls++;
      s.auras[res.key] = (s.auras[res.key] || 0) + 1;
      s.found[res.aura.id] = true;
      if (res.mut && res.mut.id === 'glitched') s.flags.glitchMut = true;
      if (res.rarity >= 1000) counts.rare++;
      if (res.rarity >= 10000) counts.anom++;
      if (jack && res.aura.id === 'jackpot') counts.jackpot++;
      if (Math.random() < 1 / 1500) counts.voids++;
      const g = got.get(res.key); if (g) g.n++; else got.set(res.key, { res, n: 1 });
      if (!best || res.rarity > best.rarity) best = res;
    }
    done += chunk;
    showBatch(done, got, false);
    await sleep(16);
  }
  if (!G) return;
  if (best.rarity > auraKey(s.best).rarity) s.best = best.key;
  s.bestTier = Math.max(s.bestTier || 0, tierIndex(best.rarity));
  if (counts.jackpot) s.coins += 77 * counts.jackpot;
  if (counts.voids) { s.void += counts.voids; toast(`${counts.voids} Void Coin${counts.voids > 1 ? 's' : ''} fell out of your rolls.`, 'gold'); }
  progress('rolls', done);
  if (G.env.weather !== 'clear') progress('biomeRolls', done);
  if (counts.rare) progress('rare', counts.rare);
  if (counts.anom) progress('anom', counts.anom);
  addXp(Math.floor(done / 20));
  showBatch(done, got, true);
  G.batching = false; G.batchTotal = 0;
  markDirty();
  try {
    const cut = s.settings.cutscenes, tier = tierIndex(best.rarity);
    if (cut !== 'off' && tier >= (cut === 'rare' ? 5 : 4)) await cutscene(best);
  } finally {
    if (G) {
      if (best.rarity > auraKey(s.equipped).rarity && s.settings.autoEquip) equip(best.key, true);
      if (best.rarity >= 100000 && G.net) G.net.announce({ name: G.me.name, key: best.key, rarity: best.rarity });
      checkAchievements();
      G.rolling = false;
      updateHud();
      clearTimeout(G.batchHide); G.batchHide = setTimeout(() => { if (G && !G.batching) $q('.oc-batch').classList.add('hidden'); }, 8000);   // after any cutscene, so the list gets seen
    }
  }
}
// what a batch found: the six rarest, with how many of each
function showBatch(done, got, finished) {
  const el = $q('.oc-batch'), total = Math.max(done, G.batchTotal || done);
  el.classList.remove('hidden');
  const top = [...got.values()].sort((a, b) => b.res.rarity - a.res.rarity).slice(0, 6);
  el.innerHTML = `<div class="oc-batch-head"><b>${esc(G.batchLabel || 'Instant Rolls')}</b><span>${finished ? `${fmt(done)} rolls` : `Rolling ${fmt(done)} / ${fmt(total)}`}</span></div>
    <div class="oc-batch-bar"><i style="width:${total ? Math.round(done / total * 100) : 0}%"></i></div>
    ${top.map(x => `<div class="oc-batch-row"><span class="nm"></span><span class="oc-tier t-${tierOf(x.res.rarity).id}">${tierOf(x.res.rarity).label}</span><b>x${fmt(x.n)}</b></div>`).join('')}`;
  el.querySelectorAll('.oc-batch-row .nm').forEach((n, i) => paintName(n, top[i].res.name, top[i].res, 'nm'));
  clearTimeout(G.batchHide);
  if (finished) el.onclick = () => el.classList.add('hidden');
}
function offerEquip(key) {
  G.offer = key;
  $q('.oc-rt-actions').classList.remove('hidden');
  clearTimeout(G.offerHide); G.offerHide = setTimeout(() => { if (G && G.offer === key) { G.offer = null; $q('.oc-rt-actions').classList.add('hidden'); $q('.oc-rolltext').classList.add('hidden'); } }, 6000);
}
// Names flicker past, slowing down, then the real one lands.
async function rollAnimation(res, speed) {
  const box = $q('.oc-rolltext'), nameEl = $q('.oc-rt-name'), sub = $q('.oc-rt-sub');
  box.className = 'oc-rolltext rolling';
  const total = ROLL_ANIM_MS / Math.max(1, speed), frames = 11;
  for (let i = 0; i < frames; i++) {
    const a = randomFlicker(i / frames);
    paintName(nameEl, a.name, { aura: a });
    sub.innerHTML = tierLine(a.rarity);
    sound('tick', 300 + i * 40);
    await sleep(total * (0.35 * Math.pow(1.32, i)) / 30);
    if (!G) return;
  }
}
function randomFlicker(progress) {
  const pool = AURAS.filter(a => !a.only).sort((a, b) => a.rarity - b.rarity);
  return Math.random() < 0.08 + progress * 0.1 ? pool[Math.floor(Math.random() * pool.length)] : pool[Math.floor(Math.random() * 16)];
}
// The aura's name in its own style.
function paintName(el, text, res, base = 'oc-rt-name') {
  const aura = res.aura || res;
  el.textContent = text;
  const t = aura.title || {};
  el.className = base + (t.bw ? ' bw' : t.rainbow ? ' rainbow' : t.gold ? ' gold' : t.violet ? ' violet' : '');
  el.style.color = t.bw || t.rainbow || t.gold || t.violet ? '' : (res.mut ? res.mut.color : aura.c);
}
// "1 in 2,048  Shadowed" with the tier in its colour (null is red and black, and glitches).
function tierLine(rarity, mut) {
  const tier = tierOf(rarity);
  return `<span>1 in ${fmt(rarity)}</span><span class="oc-tier t-${tier.id}">${tier.label}</span>${mut ? `<span class="oc-mut" style="color:${mut.color}">${mut.name}</span>` : ''}`;
}
function showResult(res, quick) {
  const box = $q('.oc-rolltext'), nameEl = $q('.oc-rt-name'), sub = $q('.oc-rt-sub');
  box.className = 'oc-rolltext land';
  paintName(nameEl, res.name, res);
  sub.innerHTML = tierLine(res.rarity, res.mut);
  sound('land', tierIndex(res.rarity));
  clearTimeout(G.rollHide);
  G.rollHide = setTimeout(() => { if (G && !G.offer) box.classList.add('hidden'); }, quick ? 1300 : 2600);
}
// The big reveal for very rare auras. 『EQUINOX』: a white ball and a black ball circle each other, then merge.
async function cutscene(res) {
  const cut = $q('.oc-cut'), tier = tierOf(res.rarity), bw = res.aura.title && res.aura.title.bw;
  G.cutting = true; G.cutKey = res.aura.id;
  if (document.pointerLockElement) document.exitPointerLock();
  pickMusic();
  if (G.music) G.music.sting(48 + tierIndex(res.rarity), tierIndex(res.rarity) >= 6);
  if (res.aura.id === 'equinox' && !G.cine) { await equinoxCutscene(res, cut); return; }
  cut.className = `oc-cut t-${tier.id}${bw ? ' bw' : ''}`;
  cut.style.setProperty('--c', res.mut ? res.mut.color : res.aura.c);
  cut.innerHTML = `<div class="cut-bg"></div><div class="cut-rays"></div>${bw ? '<div class="cut-orb w"></div><div class="cut-orb b"></div>' : '<div class="cut-star"></div>'}
    <div class="cut-flash"></div><div class="cut-name"></div>${res.aura.sub ? `<div class="cut-subtitle">${esc(res.aura.sub)}</div>` : ''}<div class="cut-sub">${tierLine(res.rarity, res.mut)}</div><button type="button" class="cut-skip">Skip</button>`;
  paintName(cut.querySelector('.cut-name'), res.name, res, 'oc-rt-name cut-name');
  sound('cut', tierIndex(res.rarity));
  const dur = bw ? 7000 : tierIndex(res.rarity) >= 6 ? 5200 : 4000;
  await new Promise(resolve => {
    const done = () => { clearTimeout(tm); resolve(); };
    const tm = setTimeout(done, dur);
    cut.querySelector('.cut-skip').onclick = done;
  });
  if (!G) return;
  cut.classList.add('out');
  setTimeout(() => { if (G) { cut.className = 'oc-cut hidden'; cut.innerHTML = ''; } }, 450);
  G.cutting = false; G.cutKey = null;
  pickMusic();
}
// 『EQUINOX』 plays out in the world, like Sol's: the camera rises over you, a white sun and a black sun circle in
// closer and faster until they meet in an eight-pointed star, then the world turns black and white and the name lands.
function remoteEquinox(f) {
  const c = createEquinoxCinematic(G.scene, new THREE.Vector3(f.x, f.y, f.z), G.camera.position.clone());
  G.fxObjects.push({ update(dt) { const alive = c.update(dt); if (!alive) c.dispose(); return alive; } });
}
async function equinoxCutscene(res, cut) {
  const cvs = G.renderer.domElement;
  G.cine = createEquinoxCinematic(G.scene, G.player.pos.clone(), G.camera.position.clone());
  G.player.avatar.root.visible = true; $q('.oc-crosshair').classList.add('hidden');
  G.root.classList.add('oc-cine');
  if (G.net) G.net.fx({ kind: 'equinox', x: G.player.pos.x, y: G.player.pos.y, z: G.player.pos.z });
  cut.className = 'oc-cut cine bw';
  cut.style.setProperty('--c', '#ffffff');
  cut.innerHTML = `<div class="cut-flash"></div><div class="cut-name"></div><div class="cut-subtitle">${esc(res.aura.sub || '')}</div><div class="cut-sub">${tierLine(res.rarity, res.mut)}</div><button type="button" class="cut-skip">Skip</button>`;
  paintName(cut.querySelector('.cut-name'), res.name, res, 'oc-rt-name cut-name');
  sound('cut', tierIndex(res.rarity));
  let skip = false;
  cut.querySelector('.cut-skip').onclick = () => { skip = true; };
  await new Promise(resolve => {
    const tick = () => {
      if (!G || !G.cine || skip || G.cine.t >= EQUINOX_LENGTH) { resolve(); return; }
      if (G.cine.t >= EQUINOX_MERGE && !cut.classList.contains('show')) { cut.classList.add('show'); cvs.style.filter = 'grayscale(1) contrast(1.25)'; sound('slam'); }
      setTimeout(tick, 30);
    };
    tick();
  });
  if (!G) return;
  if (G.cine) { G.cine.dispose(); G.cine = null; }
  G.filterFor = null;   // the loop puts the biome's own filter back
  G.root.classList.remove('oc-cine');
  cut.classList.add('out');
  setTimeout(() => { if (G) { cut.className = 'oc-cut hidden'; cut.innerHTML = ''; } }, 450);
  G.cutting = false; G.cutKey = null;
  pickMusic();
}
function toggleAuto() {
  if (!canAuto()) { toast('Auto Roll comes with Frixion Premium.', 'warn'); return; }
  G.save.settings.auto = !G.save.settings.auto; refreshToggles(); markDirty();
}
async function toggleQuick() {
  if (!canQuick()) {
    if ((API().orbs() || 0) < 5000) { toast('Quick Roll costs 5,000 Orbs. Play Frixion games to earn more.', 'warn'); return; }
    const ok = await API().spendOrbs(5000).catch(() => false);
    if (!ok) { toast('Not enough Orbs for Quick Roll.', 'warn'); return; }
    G.save.quickRoll = true; toast('Quick Roll unlocked. Rolls skip the animation while it is on.', 'gold'); sound('secret');
  }
  G.save.settings.quick = !G.save.settings.quick; refreshToggles(); markDirty();
}
function refreshToggles() {
  const set = (el, ok, onNow, lockText) => { el.classList.toggle('on', ok && onNow); el.classList.toggle('locked', !ok); el.querySelector('b').textContent = !ok ? lockText : onNow ? 'ON' : 'OFF'; };
  set($q('.oc-auto'), canAuto(), !!G.save.settings.auto, 'Premium');
  set($q('.oc-quick'), canQuick(), !!G.save.settings.quick, '5,000 Orbs');
}

// ---------------- small pieces of UI ----------------
const amountHtml = max => `<div class="oc-amt"><button type="button" data-amt="-1">-</button><input type="number" min="1" max="${max}" value="1"><button type="button" data-amt="1">+</button><button type="button" data-amt="max">Max</button></div>`;
const amountOf = (el, max) => { const i = el.querySelector('.oc-amt input'); return Math.max(1, Math.min(max, Math.floor(+(i && i.value) || 1))); };
function wireAmount(el, max) {
  const i = el.querySelector('.oc-amt input'); if (!i) return;
  i.onkeydown = e => e.stopPropagation();
  el.querySelectorAll('[data-amt]').forEach(b => b.onclick = () => { i.value = b.dataset.amt === 'max' ? max : Math.max(1, Math.min(max, (Math.floor(+i.value) || 1) + +b.dataset.amt)); });
}
function confirmBox(text, ok = 'Yes') {
  return new Promise(res => {
    const box = document.createElement('div'); box.className = 'oc-confirm';
    box.innerHTML = `<div class="oc-confirm-card"><p>${esc(text)}</p><div><button type="button" class="oc-btn bad" data-y>${esc(ok)}</button><button type="button" class="oc-btn" data-n>Cancel</button></div></div>`;
    $q('.oc-panel').appendChild(box);
    const done = v => { box.remove(); res(v); };
    box.querySelector('[data-y]').onclick = () => done(true); box.querySelector('[data-n]').onclick = () => done(false);
    box.onclick = e => { if (e.target === box) done(false); };
  });
}
// ---------------- the HUD ----------------
const BUFF_ROW = 6;   // potions shown before the expand button
// "237h 0m", "12m 5s", "40s", like Sol's
function buffTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}
const pct = v => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
function effectText(o) { return [o.luck ? `${pct(o.luck)} luck` : '', o.speed ? `${pct(o.speed)} roll speed` : ''].filter(Boolean).join(', ') || 'Something strange.'; }
// the little card over a potion: its name, what it does and how long it has left
function showBuffTip(k) {
  const tip = $q('.oc-tip'), t = G.buffTips && G.buffTips[k], el = t && G.root.querySelector(`.oc-buff[data-k="${CSS.escape(k)}"]`);
  if (!el) { tip.classList.add('hidden'); G.tipKey = null; return; }
  G.tipKey = k;
  tip.innerHTML = `<b style="color:${t.color}">${esc(t.name)}</b><span>${esc(t.text || '')}</span><small>${esc(t.left)}</small>`;
  tip.classList.remove('hidden');
  const r = el.getBoundingClientRect(), box = G.root.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(6, Math.min(box.width - w - 6, r.left - box.left + r.width / 2 - w / 2)) + 'px';
  tip.style.top = Math.max(6, r.top - box.top - h - 8) + 'px';
}
function updateHud() {
  if (!G || !G.save) return;
  const s = G.save, env = G.env, n = now(), b = buffs(), ws = G.worldState || {};
  const luck = luckNow(b);
  // bottom left, like Sol's: the biome in brackets, the time of day, then money
  const limbo = G.world.inLimbo(G.player.pos), w = limbo ? WEATHERS.limbo : WEATHERS[env.weather] || WEATHERS.clear;
  const left = env.weather !== 'clear' && !limbo ? weatherEndsAt(n, ws) - n : 0;
  $q('.oc-biome').innerHTML = `<span style="color:${w.color}">[ ${w.name.toUpperCase()} ]</span>${left > 0 ? `<small>${fmtTime(left)}</small>` : ''}`;
  $q('.oc-daytime').textContent = env.time === 'day' ? 'DAYTIME' : 'NIGHTTIME';
  const sl = ws.luck && ws.luck.until > n ? ws.luck : null;
  $q('.oc-luckline').innerHTML = `Luck <b>${x2(luck)}x</b><span class="sep"></span>Speed <b>${x2(b.speed)}x</b>${sl ? `<span class="sep"></span><b class="oc-server">SERVER LUCK x${sl.mult} ${fmtTime(sl.until - n)}</b>` : ''}`;
  $q('.oc-money').innerHTML = `<span class="oc-pill coin">$ ${fmt(s.coins)}</span><span class="oc-pill f">F ${fmt(s.f)}</span>${s.void ? `<span class="oc-pill void">V ${fmt(s.void)}</span>` : ''}`;
  // potions at work, bottom right like Sol's: one icon per potion (with a count), hover or tap one to see what it does,
  // and only the first row until you press the expand button
  const chips = [];
  const chip = (k, p, label, tip, next) => chips.push({ k, tip, html: `<div class="oc-buff${next ? ' next' : ''}" data-k="${esc(k)}">${potionArt(p)}<b>${label}</b></div>` });
  activeEffects().filter((e, i, arr) => arr.findIndex(x => x.id === e.id && !x.out === !e.out) === i).forEach(e => {
    const p = POTION[e.id];
    chip('e:' + e.id + (e.out ? ':o' : ''), p, buffTime(e.until - n), { name: p.name + (e.out ? ': ' + e.out.name : ''), color: p.color, text: e.out ? effectText(e.out) : p.desc, left: 'Ends in ' + buffTime(e.until - n) });
  });
  const queued = new Map(), perRoll = new Map();
  G.queued.forEach(id => queued.set(id, (queued.get(id) || 0) + 1));
  G.rollBuffs.forEach(r => perRoll.set(r.id, (perRoll.get(r.id) || 0) + r.left));
  queued.forEach((c, id) => chip('q:' + id, POTION[id], c > 1 ? 'x' + fmt(c) : 'next', { name: POTION[id].name, color: POTION[id].color, text: POTION[id].desc, left: c > 1 ? `${fmt(c)} waiting, one per roll` : 'Works on your next roll' }, true));
  perRoll.forEach((left, id) => { const p = POTION[id] || { name: 'Gemstone Gauntlet', color: '#ff6ec7', shape: 'gem', desc: 'A gem lit up: a little extra luck or roll speed.' }; chip('r:' + id, p, fmt(left), { name: p.name, color: p.color, text: p.desc, left: `${fmt(left)} rolls left` }, true); });
  G.buffTips = Object.fromEntries(chips.map(c => [c.k, c.tip]));
  const shown = G.buffsOpen ? chips : chips.slice(0, BUFF_ROW);
  let html = shown.map(c => c.html).join('');
  if (chips.length > BUFF_ROW) html += `<button type="button" class="oc-buff-more" data-more title="${G.buffsOpen ? 'Show less' : 'Show all'}">${G.buffsOpen ? IC.close : '+' + (chips.length - BUFF_ROW)}</button>`;
  const buffsEl = $q('.oc-buffs');
  if (buffsEl.dataset.h !== html) { buffsEl.innerHTML = html; buffsEl.dataset.h = html; }
  if (G.tipKey) showBuffTip(G.tipKey);
  renderBossBar();
  $q('.oc-opfun').classList.toggle('hidden', !opfun());
  // the Roll button counts towards the bonus roll: 9/10 means the next one is twice as lucky (gears can change it)
  const bi = bonusInfo(), c = s.rolls % bi.every;
  $q('.oc-roll-count').textContent = bi.none ? 'No bonus roll' : bi.all ? `Every roll x${bi.all}` : `${c}/${bi.every}${bi.mult !== 2 ? ` (x${bi.mult})` : ''}`;
  $q('.oc-roll').classList.toggle('bonus', !bi.none && !bi.all && c === bi.every - 1);
}
function renderPlayers() {
  const el = $q('.oc-players');
  const rows = [];
  const roster = G.net && G.net.roster ? G.net.roster : {};
  const list = Object.entries(roster).map(([uid, d]) => ({ uid, name: d.name || uid, rolls: uid === G.me.uid ? G.save.rolls : d.rolls || 0, aura: uid === G.me.uid ? G.save.equipped : d.aura, title: uid === G.me.uid ? G.save.title : d.title }));
  if (!list.some(r => r.uid === G.me.uid)) list.push({ uid: G.me.uid, name: G.me.name, rolls: G.save.rolls, aura: G.save.equipped, title: G.save.title });
  list.sort((a, b) => b.rolls - a.rolls);
  for (const r of list.slice(0, 12)) {
    const a = auraKey(r.aura || 'common');
    // like Sol's, your leaderboard title sits under your name with its little picture
    const ttl = r.title ? `<span class="t">${titleArt(r.title, 'oc-ttl')}<small style="color:${titleInfo(r.title).color}">${esc(r.title)}</small></span>` : '';
    rows.push(`<div class="oc-pl-row${r.uid === G.me.uid ? ' me' : ''}"><span class="n"><span class="nm">${esc(r.name)}</span>${ttl}</span><span class="r">${fmt(r.rolls)}</span><span class="a" style="color:${a.mut ? a.mut.color : a.aura.c}">${esc(a.name)}</span></div>`);
  }
  const html = `<div class="oc-pl-head"><span class="n">Players (${list.length})</span><span class="r">Rolls</span><span class="a">Aura</span></div>${rows.join('')}`;
  if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
}
function toast(text, kind) {
  if (!G) return;
  const box = $q('.oc-toasts');
  const el = document.createElement('div');
  el.className = 'oc-toast ' + (kind || '');
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.classList.add('out'), 3800);
  setTimeout(() => el.remove(), 4300);
}
// Someone in the lobby rolled something very rare.
// Rare rolls from everyone, in the chat's Server tab (Settings, Miscellaneous can turn them off).
function announce(a) {
  if (G.save.settings.serverRolls === false) return;
  const { aura, mut, name, rarity } = auraKey(a.key);
  if (G.chat) G.chat.system(`[Server]: ${a.name} HAS FOUND ${name.toUpperCase()}, CHANCE OF 1 IN ${fmt(rarity)}`, mut ? mut.color : aura.c === '#ffffff' ? '#e0e0e0' : aura.c, 'server');
  if (tierIndex(rarity) < 4) return;
  const el = $q('.oc-announce');
  el.innerHTML = `<span>${esc(a.name)} HAS FOUND</span><b class="oc-ann-name"></b><span>1 IN ${fmt(rarity)}</span>`;
  paintName(el.querySelector('.oc-ann-name'), name, { aura, mut }, 'oc-rt-name oc-ann-name');
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  sound('announce');
}
function announceWeather(w, was) {
  const W = WEATHERS[w] || WEATHERS.clear;
  if (G.chat) {
    if (w === 'clear') G.chat.system(`[Server]: The ${(WEATHERS[was] || W).name.toUpperCase()} biome has ended.`, '#bdbdbd');
    else G.chat.system(`[Server]: A ${W.name.toUpperCase()} biome has started! ${W.desc}`, W.color);
  }
  if (w !== 'clear') { sound('weather'); pickMusic(); }
}

// ---------------- music: your aura's theme, a rarer one nearby, or the biome's ----------------
function pickMusic() {
  if (!G || !G.music) return;
  const n = now();
  let id, v;
  if (G.cutting && G.cutKey) { id = 'aura:' + G.cutKey; v = Math.max(vol('mine'), 0.6); }
  else if (G.jukebox && G.player.pos.distanceTo(G.world.rooms.jukebox) < 30) { id = G.jukebox; v = Math.max(vol('music'), 0.5); }
  else if (G.xfight && G.xfight.near(G.player.pos)) { id = 'biome:xboss'; v = Math.max(vol('music'), 0.5); }
  else if (G.crawler && !G.crawler.dying && G.player.pos.distanceTo(G.world.arena) < 70) { id = 'biome:raid'; v = Math.max(vol('music'), 0.45); }
  else if (G.world.inLimbo(G.player.pos)) { id = 'biome:limbo'; v = Math.max(vol('music'), 0.4); }
  else {
    let best = null;
    const mine = auraKey(G.save.equipped);
    if (vol('mine') > 0 && tierIndex(mine.aura.rarity) >= 1) best = { id: mine.aura.id, r: mine.aura.rarity, v: vol('mine') };
    if (vol('others') > 0) for (const o of G.others.values()) {
      if (!o.placed || !o.key) continue;
      const a = auraKey(o.key).aura, d = o.pos.distanceTo(G.player.pos);
      if (d < 30 && tierIndex(a.rarity) >= 1 && (!best || a.rarity > best.r)) best = { id: a.id, r: a.rarity, v: vol('others') * Math.max(0.3, 1 - d / 30) };
    }
    if (best) { id = 'aura:' + best.id; v = best.v; }
    else { id = 'biome:' + (G.env.weather === 'clear' ? 'clear-' + G.env.time : G.env.weather); v = vol('music'); }
  }
  G.music.play(id, v);
}

// ---------------- aura moves: Z X C V attack, F moves you ----------------
// near The Crawler, anyone without a Z move can punch it
const PUNCH = { key: 'z', kind: 'punch', name: 'Punch', cd: 0.55, dmg: 6, color: '#ffffff', tier: 0 };
function shownMoves() { const near = G.crawler && !G.crawler.dying && G.player.pos.distanceTo(G.world.arena) < 60; return near && !G.moves.some(m => m.key === 'z') ? [PUNCH, ...G.moves] : G.moves; }
function renderAbilities() {
  const el = $q('.oc-abilities');
  if (!el) return;
  const list = shownMoves(); G.nearArena = list !== G.moves;
  el.innerHTML = list.map(m => `<button type="button" class="oc-ab" data-move="${m.key}" style="--c:${m.color}"><kbd>${m.key.toUpperCase()}</kbd><span>${esc(m.name)}</span><i class="cd"></i></button>`).join('');
  el.classList.toggle('hidden', !list.length);
}
function updateAbilityCds() {
  const n = now();
  G.root.querySelectorAll('.oc-ab').forEach(b => {
    const m = shownMoves().find(x => x.key === b.dataset.move); if (!m) return;
    const left = Math.max(0, (G.moveCd[m.key] || 0) - n), k = left / (m.cd * 1000);
    b.classList.toggle('cooling', left > 0);
    b.querySelector('.cd').style.transform = `scaleY(${k})`;
  });
}
function useMove(key) {
  if (!G || !G.playing || G.portraitBlock) return;
  const m = shownMoves().find(x => x.key === key);
  if (!m) return;
  const n = now();
  if (!opfun() && (G.moveCd[key] || 0) > n) return;
  if (XKINDS.has(m.kind)) { xMove(m, n); return; }
  G.moveCd[key] = opfun() ? 0 : n + m.cd * 1000;
  const p = G.player, yaw = p.yaw, d = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const f = { kind: m.kind === 'punch' ? 'burst' : m.kind, r: m.kind === 'punch' ? 2.4 : m.r, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), yaw: +yaw.toFixed(3), c: m.color, tier: m.tier, len: m.len, w: m.w, dist: m.dist, n: m.n, range: m.range, dur: m.dur, seed: Math.floor(Math.random() * 1e6) };
  if (m.kind === 'dash') { p.dash = { x: d.x * m.dist * 4, z: d.z * m.dist * 4, t: 0.22 }; Object.assign(f, { x2: p.pos.x + d.x * m.dist, y2: p.pos.y, z2: p.pos.z + d.z * m.dist }); }
  if (m.kind === 'blink') { const to = p.pos.clone().add(new THREE.Vector3(d.x * m.dist, 0.5, d.z * m.dist)); Object.assign(f, { x2: to.x, y2: to.y, z2: to.z }); p.pos.copy(to); p.vel.set(0, 0, 0); p.tpAt = n; sound('teleport'); }
  if (m.kind === 'leap') { p.vel.y = Math.sqrt(2 * GRAVITY * m.h); p.onGround = false; p.dash = { x: d.x * m.dist * 1.6, z: d.z * m.dist * 1.6, t: 0.6 }; Object.assign(f, { x2: p.pos.x + d.x * m.dist, y2: p.pos.y + m.h, z2: p.pos.z + d.z * m.dist }); }
  if (m.kind === 'flight' && m.toggle) { p.flyToggle = !p.flyToggle; p.flyUntil = 0; f.dur = 0.8; toast(p.flyToggle ? `${m.name}: flight on. ${G.touch ? 'Jump goes up.' : 'Space goes up, Q goes down.'} Press F again to land.` : `${m.name}: flight off.`); }
  else if (m.kind === 'flight') { p.flyUntil = n + m.dur * 1000; toast(`${m.name}: you can fly for ${m.dur} seconds. Space goes up, Q goes down.`); }
  Object.keys(f).forEach(k => { if (f[k] === undefined || Number.isNaN(f[k])) delete f[k]; });   // the database refuses empty values
  const fx = castFx(G.scene, f); if (fx) G.fxObjects.push(fx);
  if (G.net) {
    G.net.fx(f);
    if (p.pvp && m.dmg) {
      const targets = [...G.others.values()].filter(o => o.placed && o.data && o.data.pvp);
      for (const h of hitTest(f, targets)) G.net.hit(h.uid, { dmg: m.dmg, kx: h.kx, kz: h.kz, by: G.me.name, aura: auraKey(G.save.equipped).name, move: m.name });
    }
  }
  raidHitFrom(m.kind === 'punch' ? { kind: 'punch' } : f, m.dmg);
  if (G.xfight) G.xfight.hitFrom(m.kind === 'punch' ? { kind: 'punch' } : f, m.dmg, hitTest);
  G.save.stats.moves++; progress('moves');
  sound('attack', m.tier);
  updateAbilityCds();
}
function togglePvp() {
  const p = G.player;
  p.pvp = !p.pvp; p.hp = 100;
  renderBossBar();
  drawMyTag();
  if (G.net) G.net.update({ pvp: p.pvp });
  toast(p.pvp ? 'PvP on. Your aura\'s moves (Z, X, C, V) hit other players who have PvP on.' : 'PvP off. Nobody can hit you.');
}
function updateHp() { const p = G.player; $q('.oc-hp i').style.width = Math.max(0, p.hp) + '%'; $q('.oc-hp span').textContent = Math.max(0, Math.round(p.hp)); }
function takeHit(h) {
  const p = G.player;
  if (h.ko) {   // you knocked someone out
    G.save.stats.kos++;
    const g = G.save.quests.side.gladiator;
    if (g && g.state === 'active') { g.ko = (g.ko || 0) + 1; if (g.ko >= 5) { g.state = 'done'; toast('Side quest done: Gladiator. ' + giveReward({ potions: { gladiator: 3 } }), 'gold'); } }
    toast(`You knocked out ${h.by}.`, 'gold'); markDirty(); return;
  }
  if (!p.pvp) return;
  const from = h.fx !== undefined ? [h.fx, h.fz] : [p.pos.x - (h.kx || 0), p.pos.z - (h.kz || 0)];
  if (!h.smash && blocks(from[0], from[1])) { shieldHit(h.axe); p.knock = { x: (h.kx || 0) * 0.25, z: (h.kz || 0) * 0.25 }; return; }
  p.hp -= soak(h.dmg || 0);
  p.knock = { x: h.kx || 0, z: h.kz || 0 }; p.vel.y = 12; p.onGround = false;
  G.root.classList.remove('oc-hurt'); void G.root.offsetWidth; G.root.classList.add('oc-hurt');
  sound('hurt');
  if (p.hp <= 0) {
    toast(`${h.by || 'Someone'} knocked you out with ${h.move || h.aura || 'their aura'}.`, 'warn');
    if (G.net && h.from) G.net.hit(h.from, { ko: true, by: G.me.name });
    p.hp = 100; p.pos.copy(G.world.spawn); p.vel.set(0, 0, 0); p.knock = null;
  }
  renderBossBar();
  drawMyTag();
}

// ---------------- ____X____'s aura: fight like him ----------------
// M1 swings his sword. Z raises his shield for as long as it is held: it stops hits from the front, and an axe knocks
// it down for 5 seconds, like Minecraft. X swings his axe. C eats an enchanted golden apple: Regeneration until you are
// full, and 8 golden hearts on top that take damage first and never heal back (Absorption). V asks who to lock on to,
// then wind charge, pearl, wind charge, pearl: very high, and down on them with the spear and the mace. F is a spear
// lunge. His sword is in your right hand and his shield on your left arm, for you and for everyone who sees you.
const XKINDS = new Set(['sword', 'axe', 'shield', 'egap', 'spearmace', 'lunge']);
const xMoveOf = kind => (G.moves || []).find(m => m.kind === kind);
function xMove(m, n) {
  const p = G.player;
  if (p.xdive) return;
  if (m.kind === 'shield') { setBlock(true); return; }
  if (p.eating) return;
  if (m.kind === 'spearmace') { openLockOn(m); return; }
  G.moveCd[m.key] = opfun() ? 0 : n + m.cd * 1000;
  if (m.kind === 'sword' || m.kind === 'axe') xMelee(m);
  else if (m.kind === 'egap') { p.eating = { until: n + 1600 }; xHold(p.avatar, 'apple'); }
  else if (m.kind === 'lunge') xLunge();
  G.save.stats.moves++; progress('moves'); updateAbilityCds();
}
// the sword (or axe) in the right hand, and the shield, which hangs at the side and comes round in front to block
function xGear(av, on) {
  if (!on) { if (av.xgear) { av.xgear.items.forEach(it => it.parent && it.parent.remove(it)); av.xgear.shield.parent && av.xgear.shield.parent.remove(av.xgear.shield); av.xgear = null; } return; }
  if (av.xgear) return;
  const shield = makeShield(0.62), side = new THREE.Group(), front = new THREE.Group();
  side.position.set(0.72, -1.55, 0.2); side.rotation.y = Math.PI / 2 - 0.3; av.leftArm.add(side);
  front.position.set(0.3, 3.05, 1.2); front.rotation.y = -0.18; av.body.add(front);
  side.add(shield);
  av.xgear = { shield, side, front, items: new Map(), held: null };
}
function xHold(av, id) {
  const g = av.xgear; if (!g || g.held === id) return;
  g.held = id;
  g.items.forEach(it => { it.visible = false; });
  let it = g.items.get(id);
  if (!it) {
    const small = id === 'apple' || id === 'pearl' || id === 'wind';
    it = makeItem(id, small ? 0.9 : 1.7, !small);
    if (id === 'spear') { it.scale.setScalar(0.62); it.rotation.x = Math.PI / 2; it.position.set(0, -1.9, -0.25); }
    else { it.rotation.set(0, Math.PI / 2, -Math.PI / 4); it.position.set(0, -1.95, 0.32); }
    av.rightArm.add(it); g.items.set(id, it);
  }
  it.visible = true;
}
const xShieldUp = (av, up) => { const g = av.xgear; if (!g) return; const to = up ? g.front : g.side; if (g.shield.parent !== to) to.add(g.shield); };
// what the body is doing right now (a swing, eating, the shield up), for the animation
function xAct(who) {
  const n = now(), a = who.act && n - who.act.t0 < who.act.dur ? { kind: who.act.kind, k: (n - who.act.t0) / who.act.dur } : null;
  const act = a || (who.eating ? { kind: 'eat' } : null);
  return who.blocking ? { ...(act || {}), block: true } : act;
}

// ---- the shield ----
function setBlock(on) {
  const p = G.player, n = now();
  if (on && !opfun() && (p.shieldOffUntil || 0) > n) { if (n - (p.blockWarned || 0) > 1500) { p.blockWarned = n; toast(`Your shield is down for ${Math.ceil((p.shieldOffUntil - n) / 1000)} more seconds.`, 'warn'); } return; }
  if (on && (!xMoveOf('shield') || p.xdive)) return;
  if (!!p.blocking === !!on) return;
  p.blocking = !!on;
  if (on) sound('shieldup');
  if (G.net) G.net.update({ blk: on ? 1 : null });
  updateAbilityCds();
}
// is a hit from (fx, fz) in front of you while your shield is up?
function blocks(fx, fz) {
  const p = G.player;
  if (!p.blocking || fx === undefined || fx === null) return false;
  const dx = fx - p.pos.x, dz = fz - p.pos.z, d = Math.hypot(dx, dz) || 1;
  return (dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)) / d > 0.15;
}
function shieldHit(axe) {
  const p = G.player;
  sound('block');
  if (!axe || opfun()) return;
  p.blocking = false; p.shieldOffUntil = now() + 5000;
  sound('shieldbreak'); toast('An axe knocked your shield down for 5 seconds.', 'warn');
  if (G.net) G.net.update({ blk: null });
}
// Absorption, the golden hearts: they take damage first
function soak(dmg) { const p = G.player; if (!p.absorb || dmg <= 0) return dmg; const a = Math.min(p.absorb, dmg); p.absorb -= a; return dmg - a; }

// ---- the sword and the axe ----
function xMelee(m) {
  const p = G.player, axe = m.kind === 'axe', yaw = p.yaw, d = { x: Math.sin(yaw), z: Math.cos(yaw) }, reach = axe ? 5.6 : 5;
  p.act = { kind: axe ? 'axe' : 'swing', t0: now(), dur: axe ? 550 : 360 };
  xHold(p.avatar, axe ? 'axe' : 'sword');
  const f = { kind: 'mcsweep', x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), yaw: +yaw.toFixed(3), axe: axe ? 1 : 0 };
  mcFx(f, true); if (G.net) G.net.fx(f);
  if (G.net && p.pvp) for (const o of G.others.values()) {
    if (!o.placed || !o.data || !o.data.pvp) continue;
    const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, dist = Math.hypot(dx, dz);
    if (dist > reach || Math.abs(o.pos.y - p.pos.y) > 4 || (dx * d.x + dz * d.z) / (dist || 1) < 0.2) continue;
    G.net.hit(o.uid, { dmg: m.dmg, kx: d.x * 16, kz: d.z * 16, fx: f.x, fz: f.z, by: G.me.name, aura: '____X____', move: m.name, axe: axe ? 1 : 0 });
  }
  if (G.xfight) G.xfight.hitFrom({ kind: 'melee', r: reach, x: p.pos.x, z: p.pos.z, yaw }, m.dmg, hitTest);
  raidHitFrom({ kind: 'punch' }, m.dmg);
}

// ---- the enchanted golden apple: 1.6 seconds of eating, then Regeneration and 8 golden hearts ----
function eatTick() {
  const p = G.player, n = now();
  if (!p.eating) return;
  if ((p.eating.chew || 0) < n) { p.eating.chew = n + 240; sound('eat'); G.fxObjects.push(MCFX.crumbs(G.scene, p.pos.x + Math.sin(p.yaw) * 0.7, p.pos.y + 4.4, p.pos.z + Math.cos(p.yaw) * 0.7)); }
  if (n < p.eating.until) return;
  p.eating = null;
  p.regenUntil = n + 20000; p.absorb = 80; p.absorbUntil = n + 120000;
  const f = { kind: 'mcheal', x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2) };
  mcFx(f, true); if (G.net) G.net.fx(f);
  toast('Enchanted Golden Apple: Regeneration, and 8 golden hearts.', 'gold');
  xHold(p.avatar, 'sword');
  renderBossBar();
}

// ---- the spear-mace: pick who, then up and down on them ----
function lockTargets() {
  const p = G.player, out = [];
  if (G.xfight) for (const t of G.xfight.targets()) out.push({ ...t, kind: 'boss' });
  if (p.pvp) for (const o of G.others.values()) if (o.placed && o.data && o.data.pvp) out.push({ id: 'p:' + o.uid, uid: o.uid, name: o.data.name || o.uid, pos: o.pos, kind: 'player' });
  for (const t of out) t.d = t.pos.distanceTo(p.pos);
  return out.filter(t => t.d < 220).sort((a, b) => a.d - b.d);
}
function openLockOn(m) {
  const list = lockTargets();
  if (!list.length) { toast('Nobody to lock on to. Turn PvP on in Settings, or find ____X____.', 'warn'); return; }
  const el = $q('.oc-lockon');
  el.innerHTML = `<div class="oc-lockon-card"><b>Spearmace: who?</b><button type="button" data-lock="nearest"><kbd>1</kbd><span>Nearest</span><small>${esc(list[0].name)}, ${Math.round(list[0].d)} studs</small></button>${list.slice(0, 8).map((t, i) => `<button type="button" data-lock="${esc(t.id)}"><kbd>${i + 2}</kbd><span>${esc(t.name)}</span><small>${Math.round(t.d)} studs</small></button>`).join('')}<button type="button" class="cancel" data-lock="">Cancel <small>(Esc)</small></button></div>`;
  el.classList.remove('hidden');
  G.lockOn = { m, list };
  el.querySelectorAll('[data-lock]').forEach(b => b.onclick = () => pickLock(b.dataset.lock));
}
function pickLock(id) {
  const L = G.lockOn; $q('.oc-lockon').classList.add('hidden'); G.lockOn = null;
  if (!L || !id) return;
  const t = id === 'nearest' ? L.list[0] : L.list.find(x => x.id === id);
  if (!t) return;
  G.moveCd[L.m.key] = opfun() ? 0 : now() + L.m.cd * 1000; updateAbilityCds();
  const p = G.player;
  setBlock(false); p.eating = null;
  p.xdive = { m: L.m, t, t0: now(), stage: 0, peak: p.pos.y };
  G.save.stats.moves++; progress('moves');
}
const lockPos = t => { if (t.kind === 'player') { const o = G.others.get(t.uid); return o && o.placed ? o.pos : null; } const cur = G.xfight && G.xfight.targets().find(x => x.id === t.id); return cur ? cur.pos : null; };
// every frame of the spear-mace (instead of walking)
function diveTick(dt) {
  const p = G.player, D = p.xdive, t = (now() - D.t0) / 1000;
  const at = () => ({ x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2) });
  const send = f => { mcFx(f, true); if (G.net) G.net.fx(f); };
  const step = k => (D.stage < k ? ((D.stage = k), true) : false);
  if (step(1)) { xHold(p.avatar, 'wind'); send({ kind: 'mcgust', ...at() }); p.vel.set(0, 46, 0); p.onGround = false; }
  if (t > 0.35 && step(2)) { xHold(p.avatar, 'pearl'); send({ kind: 'mcthrow', ...at() }); }
  if (t > 0.6 && step(3)) { const from = at(); p.pos.y += 14; send({ kind: 'mcpearl', ...from, y2: +p.pos.y.toFixed(2) }); p.vel.y = Math.max(p.vel.y, 10); }
  if (t > 0.82 && step(4)) { xHold(p.avatar, 'wind'); send({ kind: 'mcgust', ...at() }); p.vel.y = 40; }
  if (t > 1.05 && step(5)) { xHold(p.avatar, 'pearl'); send({ kind: 'mcthrow', ...at() }); }
  if (t > 1.3 && step(6)) { const from = at(); p.pos.y += 14; send({ kind: 'mcpearl', ...from, y2: +p.pos.y.toFixed(2) }); p.vel.y = Math.max(p.vel.y, 6); }
  D.peak = Math.max(D.peak, p.pos.y);
  if (t < 1.55) { p.vel.x = 0; p.vel.z = 0; p.vel.y -= GRAVITY * dt; p.pos.y += p.vel.y * dt; return; }
  // down on them, homing all the way: the spear first, the mace at the end
  const tp = lockPos(D.t) || D.last || p.pos;
  D.last = new THREE.Vector3(tp.x, tp.y, tp.z);
  if (step(7)) { xHold(p.avatar, 'spear'); playLunge(1); }
  const dx = tp.x - p.pos.x, dy = tp.y + 1 - p.pos.y, dz = tp.z - p.pos.z, len = Math.hypot(dx, dy, dz) || 1;
  if (len < 10 && step(8)) xHold(p.avatar, 'mace');
  p.vel.set(dx / len * 78, dy / len * 78, dz / len * 78);
  p.yaw = Math.atan2(dx, dz);
  p.pos.addScaledVector(p.vel, dt);
  if ((Math.hypot(dx, dz) < 2.5 && Math.abs(dy) < 4) || t > 4.5) D.land = true;
}
function spearmaceHit(D) {
  const p = G.player, m = D.m, R = 7.5;   // a big hitbox
  p.xdive = null; p.vel.set(0, 0, 0);
  const f = { kind: 'mcsmash', x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), power: Math.min(2, 0.8 + Math.max(0, D.peak - p.pos.y) / 25) };
  mcFx(f, true); if (G.net) G.net.fx(f);
  if (G.net && p.pvp) for (const o of G.others.values()) {
    if (!o.placed || !o.data || !o.data.pvp) continue;
    const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, dist = Math.hypot(dx, dz);
    if (dist > R || Math.abs(o.pos.y - p.pos.y) > 6) continue;
    G.net.hit(o.uid, { dmg: m.dmg, kx: dx / (dist || 1) * 20, kz: dz / (dist || 1) * 20, fx: f.x, fz: f.z, by: G.me.name, aura: '____X____', move: 'Spearmace', smash: 1 });
  }
  if (G.xfight) G.xfight.hitFrom({ kind: 'smash', x: p.pos.x, z: p.pos.z, r: R }, m.dmg, hitTest);
  raidHitFrom({ kind: 'burst', x: p.pos.x, z: p.pos.z, yaw: 0, r: R }, m.dmg);
  xHold(p.avatar, 'sword');
}

// ---- the spear lunge: no damage, once a second ----
function xLunge() {
  const p = G.player, d = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
  p.dash = { x: d.x * 64, z: d.z * 64, t: 0.24 };
  p.act = { kind: 'lunge', t0: now(), dur: 380 };
  xHold(p.avatar, 'spear');
  const f = { kind: 'mclunge', x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), yaw: +p.yaw.toFixed(3) };
  mcFx(f, true); if (G.net) G.net.fx(f);
}

// Minecraft-style effects from the aura, for whoever used it and everyone watching
function mcFx(f, mine) {
  const sc = G.scene, add = o => o && G.fxObjects.push(o), o = !mine && f.uid ? G.others.get(f.uid) : null;
  const near = Math.max(0, 1 - Math.hypot(f.x - G.player.pos.x, f.z - G.player.pos.z) / 90);
  switch (f.kind) {
    case 'mcsweep': add(MCFX.sweep(sc, f.x, f.y - 1.4, f.z, f.yaw)); if (near > 0) sound(f.axe ? 'axe' : 'sword'); if (o) { o.act = { kind: f.axe ? 'axe' : 'swing', t0: now(), dur: f.axe ? 550 : 360 }; xHold(o.avatar, f.axe ? 'axe' : 'sword'); } break;
    case 'mcgust': add(MCFX.gust(sc, f.x, f.y, f.z)); if (near > 0) sound('gust'); if (o) xHold(o.avatar, 'wind'); break;
    case 'mcthrow': add(MCFX.throw(sc, 'pearl', new THREE.Vector3(f.x, f.y + 4, f.z), new THREE.Vector3(f.x, f.y + 18, f.z), 0.25, 0)); if (near > 0) sound('throw'); if (o) xHold(o.avatar, 'pearl'); break;
    case 'mcpearl': add(MCFX.portal(sc, f.x, f.y, f.z)); add(MCFX.portal(sc, f.x, f.y2, f.z)); if (near > 0) sound('pearl'); break;
    case 'mcsmash': add(MCFX.smash(sc, f.x, f.y, f.z, f.power || 1)); add(MCFX.crit(sc, f.x, f.y, f.z)); if (near > 0) { sound('smash'); G.shake = Math.max(G.shake || 0, near * 1.2); } if (o) xHold(o.avatar, 'mace'); break;
    case 'mclunge': if (mine) playLunge(1); else playLunge(near); add(castFx(sc, { kind: 'dash', x: f.x, y: f.y, z: f.z, x2: f.x + Math.sin(f.yaw) * 15, y2: f.y, z2: f.z + Math.cos(f.yaw) * 15, c: '#b388ff' })); if (o) { o.act = { kind: 'lunge', t0: now(), dur: 380 }; xHold(o.avatar, 'spear'); } break;
    case 'mcheal': add(MCFX.heal(sc, f.x, f.y - 1.5, f.z)); if (near > 0) sound('burp'); if (o) xHold(o.avatar, 'sword'); break;
  }
}

// The spear lunge sound, a recording, for every lunge in the game (yours, other players', and X's)
let lungeBuf = null, lungeLoad = null;
function loadLunge() {
  if (lungeBuf || lungeLoad || !G || !G.audio) return;
  const get = name => fetch(new URL('./sfx/' + name, import.meta.url)).then(r => { if (!r.ok) throw new Error(name); return r.arrayBuffer(); }).then(b => G.audio.decodeAudioData(b));
  lungeLoad = get('spear_lunge.ogg').catch(() => get('spear_lunge.wav')).then(b => { lungeBuf = b; }).catch(() => {});
}
function playLunge(v = 1) {
  if (!G || !G.audio) return;
  if (!lungeBuf) { loadLunge(); return; }
  const gain = v * vol('sfx'); if (gain < 0.02) return;
  const src = G.audio.createBufferSource(), g = G.audio.createGain();
  src.buffer = lungeBuf; src.playbackRate.value = 0.95 + Math.random() * 0.1; g.gain.value = gain;
  src.connect(g); g.connect(G.audio.destination); src.start();
}

// ---------------- panels ----------------
const TITLES = { storage: 'Aura Storage', collection: 'Collection', inventory: 'Inventory', quests: 'Quests', stats: 'Stats', settings: 'Settings', admin: 'Admin',
  mari: 'Mari', jester: 'The Jester', finn: 'Old Finn', marlin: 'Marlin\'s Fish Market', nova: 'Nova\'s Daily Shop', stella: 'Stella', ghost: 'The Ghost', devpc: 'Terminal',
  jake: 'Jake\'s Workshop', jack: 'Jack the Pumpkin', hex: 'Hex' + "'" + 's Halloween Auras', achievements: 'Achievements', pass: 'Season Pass', jukebox: 'Jukebox' };
function openPanel(id) {
  if (G.fishing) stopFishing();
  if (document.pointerLockElement) document.exitPointerLock();
  G.panel = id;
  const box = $q('.oc-panel'), body = box.querySelector('.oc-panel-body');
  box.classList.remove('hidden');
  box.dataset.panel = id;
  box.querySelector('h2').textContent = TITLES[id] || '';
  body.scrollTop = 0;
  ({ storage: renderStorage, collection: renderCollection, inventory: renderInventory, quests: renderQuests, stats: renderStats, settings: renderSettings, admin: renderAdmin,
    mari: () => renderShop('mari'), jester: () => renderShop('jester'), finn: () => renderShop('finn'), marlin: renderMarlin, nova: renderDaily, stella: renderStella, ghost: renderGhost, devpc: renderTerminal,
    jake: renderJake, jack: renderJack, hex: renderHex, achievements: renderAchievements, pass: renderPass, jukebox: renderJukebox })[id](body);
  if (id === 'achievements' || id === 'pass') dotFor(id, false);
}
function closePanel() {
  if (!G) return;
  G.panel = null;
  $q('.oc-panel').classList.add('hidden');
}
const rerender = () => { if (G && G.panel) openPanel(G.panel); };
const priceText = pr => pr.coins ? `$ ${fmt(pr.coins)}` : pr.f ? `F ${fmt(pr.f)}` : `V ${pr.void}`;
const priceClass = pr => pr.coins ? 'coin' : pr.f ? 'f' : 'void';
const moneyRow = () => `<div class="oc-money-row"><span class="oc-pill coin">$ ${fmt(G.save.coins)}</span><span class="oc-pill f">F ${fmt(G.save.f)}</span><span class="oc-pill void">V ${fmt(G.save.void)}</span></div>`;
const tabsHtml = (tabs, cur) => `<div class="oc-tabs">${tabs.map(([id, label]) => `<button type="button" data-tab="${id}" class="${cur === id ? 'on' : ''}">${label}</button>`).join('')}</div>`;
const onlyText = a => { const o = a.only; if (!o) return a.native ? `${WEATHERS[a.native].name}: ${WEATHERS[a.native].bt}x as likely` : ''; if (o.legacy) return 'Only for players who had 『EQUINOX』 before it changed'; if (o.boss) return 'Only from beating ____X____: most damage, no deaths, 250 damage or more'; if (o.time) return o.time === 'day' ? 'Only during the day' : 'Only at night'; if (o.weather === 'halloween') return 'Only during the Halloween event (or from Hex)'; const w = WEATHERS[o.weather]; return w ? `Only in ${w.name}` : ''; };

// The Sol's-style storage screen: information on the left, a grid of tiles on the right.
function storageLayout(body, { tabs, tab, tiles, info, onTab, after, search = true }) {
  body.innerHTML = `<div class="oc-store"><div class="oc-info"><div class="oc-info-title">[ Information ]</div><div class="oc-info-body"></div></div>
    <div class="oc-store-main"><div class="oc-store-top">${search ? '<label class="oc-search">' + IC.search + '<input type="search" placeholder="Search..."></label>' : ''}${tabs ? tabsHtml(tabs, tab) : ''}</div><div class="oc-grid"></div></div></div>`;
  const grid = body.querySelector('.oc-grid'), infoEl = body.querySelector('.oc-info-body');
  const scrollKey = (G.panel || '') + ':' + (tab || ''), keepScroll = G.gridScroll && G.gridScroll.k === scrollKey ? G.gridScroll.y : 0;
  grid.onscroll = () => { G.gridScroll = { k: scrollKey, y: grid.scrollTop }; };
  let sel = G.sel && tiles.find(t => t.id === G.sel) ? G.sel : tiles[0] && tiles[0].id;
  const draw = (q = '') => {
    const list = tiles.filter(t => !q || t.search.includes(q.toLowerCase()));
    grid.innerHTML = list.length ? list.map(t => `<button type="button" class="oc-tile${t.id === sel ? ' sel' : ''}${t.eq ? ' eq' : ''}${t.locked ? ' locked' : ''}${t.dim ? ' dim' : ''}${t.fav ? ' fav' : ''}" data-id="${esc(t.id)}">${t.html}${t.count != null ? `<b class="oc-tile-n">${t.count}</b>` : ''}</button>`).join('') : '<p class="oc-empty">Nothing here yet.</p>';
    grid.querySelectorAll('.oc-tile').forEach(b => b.onclick = () => { sel = G.sel = b.dataset.id; grid.querySelectorAll('.oc-tile').forEach(x => x.classList.toggle('sel', x === b)); showInfo(); });
    if (after) after(grid);
  };
  const showInfo = () => { const t = tiles.find(x => x.id === sel); infoEl.innerHTML = ''; if (t) info(t, infoEl); else infoEl.innerHTML = '<p class="oc-empty">Pick something on the right.</p>'; };
  draw(); showInfo(); grid.scrollTop = keepScroll;
  const s = body.querySelector('.oc-search input'); if (s) s.oninput = () => draw(s.value.trim());
  body.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { G.sel = null; onTab(b.dataset.tab); });
}
function auraTile(key, opts = {}) {
  const r = auraKey(key);
  return { id: r.key, search: r.name.toLowerCase(), eq: G.save.equipped === r.key, fav: !!G.save.locked[r.key], count: opts.count, locked: opts.locked, dim: opts.dim, html: `<span class="oc-tile-name" data-paint="${esc(r.key)}"${opts.locked ? ' data-hide="1"' : ''}></span>`, r };
}
function paintTiles(grid) {
  grid.querySelectorAll('[data-paint]').forEach(el => { const r = auraKey(el.dataset.paint); paintName(el, el.dataset.hide ? '???' : r.name, r, 'oc-tile-name'); });
}
function auraInfo(t, el, { owner } = {}) {
  const r = t.r, a = r.aura, moves = movesFor(r.key);
  const hidden = t.locked;
  el.innerHTML = `<div class="oc-info-name"></div><div class="oc-info-line">${tierLine(r.rarity, r.mut)}</div>
    ${a.sub && !hidden ? `<div class="oc-info-line dim">${esc(a.sub)}</div>` : ''}
    ${onlyText(a) ? `<div class="oc-info-line dim">${esc(onlyText(a))}</div>` : ''}
    ${!owner && !hidden ? `<div class="oc-info-line">Owned: <b>${fmt(auraCount(r.key))}</b></div>` : ''}
    ${!hidden ? `<div class="oc-info-line dim lore">${esc(loreOf(a.id))}</div>` : ''}
    ${moves.length && !hidden ? `<div class="oc-moves">${moves.map(m => `<div><kbd>${m.key.toUpperCase()}</kbd>${esc(m.name)}${m.dmg ? `<small>${m.dmg} dmg</small>` : '<small>move</small>'}</div>`).join('')}</div>` : ''}
    <div class="oc-info-actions"></div>`;
  paintName(el.querySelector('.oc-info-name'), hidden ? '???' : r.name, r, 'oc-info-name');
  const actions = el.querySelector('.oc-info-actions');
  if ((auraCount(r.key) > 0 || owner) && !hidden) {
    const eq = G.save.equipped === r.key, locked = !!G.save.locked[r.key];
    actions.innerHTML = `<button type="button" class="oc-btn ${eq ? 'bad' : 'ok'}" data-eq>${eq ? 'Unequip' : 'Equip'}</button>`
      + (owner ? '' : `<button type="button" class="oc-btn" data-lock>${locked ? 'Unlock' : 'Lock'}</button>`);
    const canRm = owner || locked ? 0 : auraCount(r.key) - (eq ? 1 : 0);
    if (!owner) actions.insertAdjacentHTML('afterend', `${canRm > 0 ? amountHtml(canRm) : ''}<div class="oc-info-actions"><button type="button" class="oc-btn bad" data-rm ${canRm > 0 ? '' : 'disabled'}>${locked ? 'Locked' : eq && canRm < 1 ? 'Equipped' : 'Remove'}</button></div>`);
    actions.querySelector('[data-eq]').onclick = () => { equip(eq ? 'common' : r.key); rerender(); };
    const lk = actions.querySelector('[data-lock]'); if (lk) lk.onclick = () => { if (locked) delete G.save.locked[r.key]; else G.save.locked[r.key] = true; toast(locked ? 'Unlocked. It can be removed or used in crafting.' : 'Locked. It can\'t be removed or used in crafting.'); markDirty(); rerender(); };
    const rm = el.querySelector('[data-rm]');
    if (rm && canRm > 0) { wireAmount(el, canRm); rm.onclick = async () => {
      if (G.save.locked[r.key]) return;
      const n = amountOf(el, canRm);
      if (!(await confirmBox(`Remove ${fmt(n)} ${r.name}? You can't get ${n > 1 ? 'them' : 'it'} back.`, 'Remove'))) return;
      G.save.auras[r.key] = auraCount(r.key) - n; if (G.save.auras[r.key] <= 0) delete G.save.auras[r.key];
      toast(`Removed ${fmt(n)} ${r.name}.`); markDirty(); rerender();
    }; }
  }
}
function renderStorage(body, tab = G.storeTab || 'storage') {
  G.storeTab = tab;
  const tabs = [['storage', 'Storage'], ['special', 'Special'], ...(isOwner() ? [['owner', 'Owner']] : [])];
  if (tab === 'owner' && !isOwner()) tab = 'storage';
  const keys = tab === 'owner' ? AURAS.map(a => a.id) : tab === 'special' ? AURAS.filter(isSpecial).map(a => a.id) : Object.keys(G.save.auras).filter(k => G.save.auras[k] > 0);
  const tiles = keys.map(k => auraTile(k, { count: tab === 'owner' ? null : fmt(auraCount(k)), dim: tab === 'special' && !auraCount(k) && !isOwner() })).sort((a, b) => b.r.rarity - a.r.rarity);
  storageLayout(body, { tabs, tab, tiles, after: paintTiles, info: (t, el) => auraInfo(t, el, { owner: tab === 'owner' }), onTab: tb => renderStorage(body, tb) });
  if (tab === 'storage') body.querySelector('.oc-store-top').insertAdjacentHTML('beforeend', `<div class="oc-found">Storage [${fmt(Object.values(G.save.auras).reduce((a, b) => a + b, 0))}]</div>`);
  if (tab === 'special') body.querySelector('.oc-store-top').insertAdjacentHTML('beforeend', '<div class="oc-found">Limited and boss auras</div>');
}
function renderCollection(body) {
  const found = G.save.found;
  const tiles = [...AURAS].sort((a, b) => b.rarity - a.rarity).map(a => auraTile(a.id, { locked: !found[a.id] }));
  storageLayout(body, { tiles, after: paintTiles, info: (t, el) => auraInfo(t, el, {}), onTab: () => {} });
  body.querySelector('.oc-store-top').insertAdjacentHTML('beforeend', `<div class="oc-found">Found ${Object.keys(found).filter(id => AURA[id]).length}/${AURAS.length}</div>`);
}
function renderInventory(body, tab = G.invTab || 'items') {
  if (tab === 'potions') tab = 'items'; if (tab === 'gear') tab = 'gears';
  if (tab === 'owner' && !isOwner()) tab = 'items';
  G.invTab = tab;
  const tabs = [['items', 'Items'], ['gears', 'Gears'], ['fish', 'Fish']];
  if (isOwner()) tabs.push(['owner', 'Owner']);
  const potionTile = (p, free) => ({ id: 'p:' + p.id, search: p.name.toLowerCase(), count: free ? '∞' : fmt(potionCount(p.id)), html: potionArt(p, 'oc-tile-art'), p });
  const gearTile = (g, free) => ({ id: 'gear:' + g.id, search: g.name.toLowerCase(), eq: G.save.hands[g.hand] === g.id, count: free ? null : fmt(G.save.gears[g.id] || 0), html: handGearArt(g, 'oc-tile-art'), gear: g });
  const charmTile = (i, free) => ({ id: 'g:' + i.id, search: i.name.toLowerCase(), eq: free && !!G.save.ownerGear[i.id], html: gearArt(i, 'oc-tile-art'), g: i });
  // a potion: how many to use, and deleting some (with a confirmation)
  const potionInfo = (p, free, el) => {
    const verb = p.chest ? 'Open' : 'Use', owned = potionCount(p.id), max = p.biome ? 1 : free ? 100 : owned;
    el.innerHTML = `${potionArt(p, 'oc-info-art')}<div class="oc-info-title2">${esc(p.name)}</div><div class="oc-info-line dim">${esc(p.desc)}</div>
      ${free ? '' : `<div class="oc-info-line">Owned: <b>${fmt(owned)}</b></div>`}${max > 0 ? amountHtml(max) : ''}<div class="oc-info-actions"><button type="button" class="oc-btn ok" data-use ${max > 0 ? '' : 'disabled'}>${verb}</button>${free ? '' : `<button type="button" class="oc-btn bad" data-del ${owned > 0 ? '' : 'disabled'}>Delete</button>`}</div>`;
    wireAmount(el, max);
    el.querySelector('[data-use]').onclick = () => { const n = amountOf(el, max); for (let i = 0; i < n; i++) if (!usePotion(p.id, free)) break; rerender(); };
    const del = el.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      const n = amountOf(el, owned);
      if (!(await confirmBox(`Delete ${fmt(n)} ${p.name}? You can't get ${n > 1 ? 'them' : 'it'} back.`, 'Delete'))) return;
      G.save.potions[p.id] = potionCount(p.id) - n; if (G.save.potions[p.id] <= 0) delete G.save.potions[p.id];
      toast(`Deleted ${fmt(n)} ${p.name}.`); markDirty(); rerender();
    };
  };
  const gearInfo = (g, free, el) => {
    const worn = G.save.hands[g.hand] === g.id;
    el.innerHTML = `${handGearArt(g, 'oc-info-art')}<div class="oc-info-title2">${esc(g.name)}</div><div class="oc-info-line dim">${g.hand === 'left' ? 'Left hand' : 'Right hand'}</div><div class="oc-info-line dim">${esc(g.desc)}</div>
      ${free ? '' : `<div class="oc-info-line">Owned: <b>${fmt(G.save.gears[g.id] || 0)}</b></div>`}<div class="oc-info-actions"><button type="button" class="oc-btn ${worn ? 'bad' : 'ok'}">${worn ? 'Unequip' : 'Equip'}</button></div>`;
    el.querySelector('button').onclick = () => { G.save.hands[g.hand] = worn ? null : g.id; toast(worn ? `Took off ${g.name}.` : `${g.name} is on your ${g.hand} hand.`); markDirty(); updateHud(); rerender(); };
  };
  const charmInfo = (i, free, el) => {
    const onNow = !!G.save.ownerGear[i.id];
    el.innerHTML = `${gearArt(i, 'oc-info-art')}<div class="oc-info-title2">${esc(i.name)}</div><div class="oc-info-line dim">Charm</div><div class="oc-info-line dim">${esc(i.desc)}</div>${free ? `<div class="oc-info-actions"><button type="button" class="oc-btn ${onNow ? 'bad' : 'ok'}">${onNow ? 'Unequip' : 'Equip'}</button></div>` : '<div class="oc-info-line ok">Works while you own it</div>'}`;
    const b = el.querySelector('button'); if (b) b.onclick = () => { G.save.ownerGear[i.id] = !onNow; markDirty(); updateHud(); rerender(); };
  };
  let tiles = [];
  if (tab === 'items') tiles = POTIONS.filter(p => !p.hidden && potionCount(p.id) > 0).map(p => potionTile(p, false));
  else if (tab === 'gears') tiles = [...GEARS.filter(g => (G.save.gears[g.id] || 0) > 0).map(g => gearTile(g, false)), ...ITEMS.filter(i => G.save.items[i.id]).map(i => charmTile(i, false))];
  else if (tab === 'owner') tiles = [...POTIONS.filter(p => !p.hidden).map(p => potionTile(p, true)), ...GEARS.map(g => gearTile(g, true)), ...ITEMS.map(i => charmTile(i, true))];
  else tiles = FISH.filter(f => (G.save.fish[f.id] || 0) > 0).map(f => ({ id: 'f:' + f.id, search: f.name.toLowerCase(), count: fmt(G.save.fish[f.id]), html: fishArt(f.color, 'oc-tile-art'), f }));
  const free = tab === 'owner';
  const info = (t, el) => {
    if (t.p) return potionInfo(t.p, free, el);
    if (t.gear) return gearInfo(t.gear, free, el);
    if (t.g) return charmInfo(t.g, free, el);
    el.innerHTML = `${fishArt(t.f.color, 'oc-info-art')}<div class="oc-info-title2">${esc(t.f.name)}</div><div class="oc-info-line dim">${t.f.junk ? 'Worth nothing. Marlin takes it anyway.' : `Marlin pays ${t.f.value} F each.`}</div><div class="oc-info-line">Owned: <b>${fmt(G.save.fish[t.f.id])}</b></div>`;
  };
  storageLayout(body, { tabs, tab, tiles, info, onTab: tb => renderInventory(body, tb) });
  if (tab === 'gears' || tab === 'owner') {
    const name = id => (id && GEAR[id] ? GEAR[id].name : 'empty');
    body.querySelector('.oc-store-top').insertAdjacentHTML('beforeend', `<div class="oc-found">Left hand: <b>${esc(name(G.save.hands.left))}</b>  |  Right hand: <b>${esc(name(G.save.hands.right))}</b></div>`);
  }
}
// Using a potion. free: the Owner tab (nothing is used up).
function usePotion(id, free = false) {
  let p = POTION[id];
  if (!p || (!free && potionCount(id) < 1)) return false;
  if (p.group) {
    const other = activeEffects().find(e => POTION[e.id].group === p.group && e.id !== id);
    if (other) { toast(`${POTION[other.id].name} is already working. Only one of those at a time.`, 'warn'); return false; }
  }
  if (p.biome) return useBiomeItem(p, free);
  if (p.batch && (G.batchQueue || 0) >= 1000000) { toast('Let the rolls you have going finish first.', 'warn'); return false; }
  if (!free) G.save.potions[id] = potionCount(id) - 1;
  if (p.chest) {   // a potion chest: a handful of random potions
    const c = CHEST_POOLS[p.chest], got = {};
    for (let i = 0; i < c.n; i++) { let r = Math.random() * c.pool.reduce((s2, x) => s2 + x[1], 0); const pick = c.pool.find(x => (r -= x[1]) <= 0) || c.pool[0]; got[pick[0]] = (got[pick[0]] || 0) + 1; }
    toast(`${p.name}: ` + giveReward({ potions: got }), 'gold'); sound('secret'); markDirty(); updateHud();
    return true;
  }
  if (p.mystery) {   // ???: anything can happen
    const roll = Math.random();
    if (roll < 0.4) { G.queued.push('heavenly'); toast('??? turned into a Heavenly Potion for your next roll.', 'gold'); }
    else if (roll < 0.7) { addEffect('xyz', { name: 'Overclocked', luck: 3, speed: 1 }); toast('???: Overclocked. +300% luck and +100% roll speed for 5 minutes.', 'gold'); }
    else { G.player.sizeTo = Math.random() < 0.5 ? 0.4 : 2.4; G.player.sizeUntil = now() + 120000; toast('??? did something to your body.', 'gold'); }
  } else if (p.strange) {
    const pool = STRANGE[p.strange]; let r = Math.random() * pool.reduce((s, o) => s + o.w, 0);
    const out = pool.find(o => (r -= o.w) <= 0) || pool[0];
    addEffect(id, out);
    toast(`${p.name}: ${out.name}.`, out.luck < 0 || out.speed < 0 ? 'warn' : 'gold');
  } else if (p.size) { G.player.sizeTo = p.size === 'min' ? 0.45 : 2.2; G.player.sizeUntil = now() + p.secs * 1000; addEffect(id); toast(`${p.name} is working.`, 'gold'); }
  else if (p.oneRoll) { G.queued.push(id); toast(`${p.name} is ready for your next roll.`, 'gold'); }
  else if (p.batch) queueBatch(p.batch, p.name);
  else if (p.boost) { G.rollBuffs.push({ id, left: p.boost.n }); toast(`${p.name} works on your next ${fmt(p.boost.n)} rolls.`, 'gold'); }
  else { addEffect(id); toast(`${p.name} is working.`, 'gold'); }
  G.save.stats.potions++; progress('potions');
  sound('potion'); markDirty(); updateHud();
  return true;
}

// ---------------- shops and people ----------------
const SHOPS = {
  mari: { intro: 'Hello, dear. Potions for luck and speed, and charms that last. My special deals change every 15 minutes.', potions: ['lucky', 'luckl', 'luckxl', 'speed', 'speedl', 'speedxl', 'spoid1', 'spoid2', 'spoid3', 'mixed'], items: ['gloves', 'boots', 'solarlens', 'moonlocket'], rotating: true },
  finn: { intro: 'Rods and a brew for divers. I only take F.', potions: ['diver'], items: ['goldrod', 'voidlantern'], quest: 'summit' },
  jester: { intro: 'Strange things for strange people. Five Void Coins, and I will give you something... oblivious.', potions: ['strange1', 'strange2', 'bound', 'heavenly', 'oblivion', 'controller', 'rune_wind', 'rune_frost', 'rune_rain', 'rune_sand', 'rune_hell', 'rune_galaxy', 'rune_corruption', 'rune_nothing'], items: [], quest: 'cards' },
};
const canAfford = pr => (pr.coins ? G.save.coins >= pr.coins : pr.f ? G.save.f >= pr.f : G.save.void >= pr.void);
function shopRow(thing, isItem, price, button) {
  return `<div class="oc-row">${isItem ? gearArt(thing) : potionArt(thing)}<div class="oc-row-text"><b>${esc(thing.name)}</b><span>${esc(thing.desc)}</span></div>
    <span class="oc-price ${priceClass(price)} ${canAfford(price) ? '' : 'no'}">${priceText(price)}</span>${button}</div>`;
}
function pay(pr) { if (pr.coins) G.save.coins -= pr.coins; else if (pr.f) G.save.f -= pr.f; else G.save.void -= pr.void; }
function buy(kind, id, price) {
  const thing = kind === 'item' ? ITEM[id] : POTION[id], pr = price || thing.price;
  if (!canAfford(pr)) { toast('You can\'t afford that yet.', 'warn'); return false; }
  pay(pr);
  if (kind === 'item') G.save.items[id] = true; else G.save.potions[id] = potionCount(id) + 1;
  toast(`You got ${thing.name}.`, 'gold'); sound('coin'); markDirty(); updateHud();
  return true;
}
// A side quest card at the top of an NPC's panel: start it, see how it is going, or hand it in.
function questCard(id) {
  const q = SIDE_QUEST[id], st = G.save.quests.side[id];
  const state = typeof st === 'object' && st ? st.state : st;
  let status = '', button = '';
  if (!state) button = `<button type="button" class="oc-btn ok" data-q-start="${id}">Accept</button>`;
  else if (state === 'done') status = '<span class="oc-q-done">Done</span>';
  else {
    if (id === 'cards') status = `Cards found: ${(st.found || []).length}/3`;
    if (id === 'gladiator') status = `Knockouts: ${st.ko || 0}/5`;
    if (id === 'koi') { const has = (G.save.fish.koi || 0) > 0 && (G.save.fish.jelly || 0) > 0; status = has ? 'You have both fish.' : 'Bring a Spirit Koi and a Moon Jelly.'; if (has) button = '<button type="button" class="oc-btn ok" data-q-turn="koi">Hand them over</button>'; }
    if (id === 'ghost') { status = st.locket ? 'You found the locket.' : 'Fish in Tower Creek at night.'; if (st.locket) button = '<button type="button" class="oc-btn ok" data-q-turn="ghost">Give back the locket</button>'; }
    if (id === 'stella') { status = state === 'star' ? 'You have a Stella\'s Star.' : 'Find a Stella\'s Star during Starfall.'; if (state === 'star') button = '<button type="button" class="oc-btn ok" data-q-turn="stella">Give her the star</button>'; }
    if (id === 'summit') status = 'Climb the mountain and ring the bell.';
  }
  return `<div class="oc-quest-card"><div class="oc-q-title">${IC.quests}<b>${esc(q.title)}</b>${status ? `<span class="oc-q-status">${status}</span>` : ''}</div><p>${esc(q.text)}</p><div class="oc-q-foot"><span>Reward: ${esc(q.reward)}</span>${button}</div></div>`;
}
function wireQuestCards(body) {
  body.querySelectorAll('[data-q-start]').forEach(b => b.onclick = () => {
    const id = b.dataset.qStart, side = G.save.quests.side;
    side[id] = id === 'cards' ? { state: 'active', found: [] } : id === 'gladiator' ? { state: 'active', ko: 0 } : id === 'ghost' ? { state: 'active' } : id === 'koi' ? { state: 'active' } : 'active';
    toast(`Quest started: ${SIDE_QUEST[id].title}`, 'gold'); sound('secret'); refreshWorldFlags(); markDirty(); rerender();
  });
  body.querySelectorAll('[data-q-turn]').forEach(b => b.onclick = () => {
    const id = b.dataset.qTurn, side = G.save.quests.side;
    if (id === 'koi') { G.save.fish.koi--; G.save.fish.jelly--; side.koi = { state: 'done' }; toast('Marlin is amazed. ' + giveReward({ items: ['goldrod'] }), 'gold'); }
    if (id === 'ghost') { side.ghost = { state: 'done' }; toast('The ghost smiles and fades. ' + giveReward({ items: ['moonlocket'], coins: 5000 }), 'gold'); }
    if (id === 'stella') { side.stella = 'done'; toast('Stella can brew again. A portal now links her camp and the cave mouth, and her cauldron is open.', 'gold'); }
    sound('secret'); refreshWorldFlags(); markDirty(); rerender();
  });
}
function renderShop(id, body = $q('.oc-panel-body')) {
  if (id === 'jester' && !G.env.jester) { body.innerHTML = '<p class="oc-empty">The Jester has left. He comes back every 4 hours.</p>'; return; }
  const sh = SHOPS[id];
  const row = (thing, isItem) => { const owned = isItem && G.save.items[thing.id]; return shopRow(thing, isItem, thing.price, `<button type="button" class="oc-btn sm" data-buy="${isItem ? 'item' : 'potion'}:${thing.id}" ${owned || !canAfford(thing.price) ? 'disabled' : ''}>${owned ? 'Owned' : thing.price.void ? 'Trade' : 'Buy'}</button>`); };
  body.innerHTML = `<p class="oc-intro">${esc(sh.intro)}</p>${sh.quest ? questCard(sh.quest) : ''}${moneyRow()}
    ${sh.rotating ? mariDealsHtml() : ''}<div class="oc-list">${sh.potions.map(p => row(POTION[p], false)).join('')}${sh.items.map(i => row(ITEM[i], true)).join('')}</div>`;
  body.querySelectorAll('[data-deal]').forEach(b => b.onclick = () => buyDeal(+b.dataset.deal, () => renderShop(id, body)));
  body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { const [kind, tid] = b.dataset.buy.split(':'); buy(kind, tid); renderShop(id, body); });
  wireQuestCards(body);
}
// Mari's specials: three deals that change every 15 minutes, one of each per player
function mariDealsHtml() {
  const n = now(), slot = Math.floor(n / MARI_SLOT_MS), deals = mariDeals(n), bought = G.save.mariSlot === slot ? G.save.mariBought || [] : [];
  return `<h3>Special deals <small>new ones in ${fmtTime(MARI_SLOT_MS - (n % MARI_SLOT_MS))}</small></h3><div class="oc-list">${deals.map((o, i) => {
    const thing = o.kind === 'void' ? { name: 'Void Coin', desc: 'Trade 5 with the Jester for an Oblivion Potion.', price: o.price } : POTION[o.id], price = o.price || thing.price, sold = bought.includes(i);
    const btn = `<button type="button" class="oc-btn sm" data-deal="${i}" ${sold || !canAfford(price) ? 'disabled' : ''}>${sold ? 'Sold out' : 'Buy'}</button>`;
    return o.kind === 'void' ? `<div class="oc-row">${coinArt('void')}<div class="oc-row-text"><b>Void Coin</b><span>${thing.desc}</span></div><span class="oc-price ${priceClass(price)}">${priceText(price)}</span>${btn}</div>` : shopRow(thing, false, price, btn);
  }).join('')}</div><h3>Always in stock</h3>`;
}
function buyDeal(i, after) {
  const n = now(), slot = Math.floor(n / MARI_SLOT_MS), o = mariDeals(n)[i];
  if (G.save.mariSlot !== slot) { G.save.mariSlot = slot; G.save.mariBought = []; }
  if (!o || G.save.mariBought.includes(i)) return;
  const price = o.price || POTION[o.id].price;
  if (!canAfford(price)) { toast('You can\'t afford that yet.', 'warn'); return; }
  pay(price);
  if (o.kind === 'void') G.save.void++; else G.save.potions[o.id] = potionCount(o.id) + 1;
  G.save.mariBought.push(i); toast(`You got ${o.kind === 'void' ? 'a Void Coin' : POTION[o.id].name}.`, 'gold'); sound('coin'); markDirty(); updateHud(); after();
}
// Nova: five deals a day, one of each per player. Changes at midnight UTC.
function renderDaily(body) {
  const day = dayIndex(now());
  if (G.save.daily.day !== day) G.save.daily = { day, bought: [] };
  const stock = dailyStock(day);
  const left = 86400000 - (now() % 86400000);
  body.innerHTML = `<p class="oc-intro">New deals every day. One of each, so choose well. Next deals in <b>${fmtTime(left)}</b>.</p>${questCard('gladiator')}${moneyRow()}
    <div class="oc-list">${stock.map((o, i) => {
      const sold = G.save.daily.bought.includes(i) || (o.kind === 'item' && G.save.items[o.id]);
      const btn = `<button type="button" class="oc-btn sm" data-d="${i}" ${sold || !canAfford(o.price) ? 'disabled' : ''}>${sold ? 'Sold out' : 'Buy'}</button>`;
      if (o.kind === 'void') return `<div class="oc-row">${coinArt('void')}<div class="oc-row-text"><b>Void Coin</b><span>Trade 5 with the Jester for an Oblivion Potion.</span></div><span class="oc-price ${priceClass(o.price)} ${canAfford(o.price) ? '' : 'no'}">${priceText(o.price)}</span>${btn}</div>`;
      return shopRow(o.kind === 'item' ? ITEM[o.id] : POTION[o.id], o.kind === 'item', o.price, btn);
    }).join('')}</div>`;
  body.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
    const i = +b.dataset.d, o = stock[i];
    if (o.kind === 'void') { if (!canAfford(o.price)) return; pay(o.price); G.save.void++; toast('You got a Void Coin.', 'gold'); sound('coin'); }
    else if (!buy(o.kind, o.id, o.price)) return;
    G.save.daily.bought.push(i); markDirty(); updateHud(); renderDaily(body);
  });
  wireQuestCards(body);
}
// Marlin buys fish for F.
function renderMarlin(body) {
  const fish = FISH.filter(f => (G.save.fish[f.id] || 0) > 0);
  const total = fish.reduce((s, f) => s + f.value * G.save.fish[f.id], 0);
  body.innerHTML = `<p class="oc-intro">Fresh fish, fair prices. I pay in F.</p>${questCard('koi')}
    ${fish.length ? `<div class="oc-list">${fish.map(f => `<div class="oc-row">${fishArt(f.color)}<div class="oc-row-text"><b>${esc(f.name)}</b><span>x${G.save.fish[f.id]} at ${f.value} F each</span></div><span class="oc-price f">F ${fmt(f.value * G.save.fish[f.id])}</span><button type="button" class="oc-btn sm" data-sell="${f.id}">Sell</button></div>`).join('')}</div>
    <button type="button" class="oc-btn wide ok" data-sellall>Sell all for F ${fmt(total)}</button>` : '<p class="oc-empty">You have no fish. Fish at any glowing ring by the water, then come back.</p>'}`;
  const sell = ids => { let got = 0; ids.forEach(id => { got += FISHES[id].value * (G.save.fish[id] || 0); G.save.fish[id] = 0; }); G.save.f += got; toast(`Sold for ${fmt(got)} F.`, 'gold'); sound('coin'); markDirty(); updateHud(); renderMarlin(body); };
  body.querySelectorAll('[data-sell]').forEach(b => b.onclick = () => sell([b.dataset.sell]));
  const all = body.querySelector('[data-sellall]'); if (all) all.onclick = () => sell(fish.map(f => f.id));
  wireQuestCards(body);
}
// Stella: her quest, then her cauldron. Recipes use potions and auras from your storage.
function renderStella(body) {
  const side = G.save.quests.side, open = side.stella === 'done';
  const recipes = POTIONS.filter(p => p.recipe);
  const have = (kind, id) => (kind === 'auras' ? auraCount(id) : potionCount(id));
  const parts = p => Object.entries(p.recipe).flatMap(([kind, list]) => Object.entries(list).map(([id, n]) => ({ kind, id, n, name: kind === 'auras' ? AURA[id].name : POTION[id].name, ok: have(kind, id) >= n })));
  body.innerHTML = `<p class="oc-intro">${open ? 'Ah, a fellow brewer. Bring me what a recipe needs and I will brew it for you.' : 'My cauldron has gone cold. I need one Stella\'s Star to light it again. They only fall during Starfall.'}</p>${questCard('stella')}
    ${open ? `<div class="oc-list">${recipes.map(p => { const ps = parts(p), ok = ps.every(x => x.ok); return `<div class="oc-row recipe">${potionArt(p)}<div class="oc-row-text"><b>${esc(p.name)}</b><span>${esc(p.desc)}</span><span class="oc-need">${ps.map(x => `<i class="${x.ok ? 'ok' : 'no'}">${x.n} ${esc(x.name)}${x.kind === 'auras' ? ' (aura)' : ''}</i>`).join('')}</span></div><button type="button" class="oc-btn sm ok" data-craft="${p.id}" ${ok ? '' : 'disabled'}>Brew</button></div>`; }).join('')}</div>` : ''}`;
  body.querySelectorAll('[data-craft]').forEach(b => b.onclick = () => {
    const p = POTION[b.dataset.craft], ps = parts(p);
    if (!ps.every(x => x.ok)) return;
    for (const x of ps) { if (x.kind === 'auras') { G.save.auras[x.id] -= x.n; if (G.save.auras[x.id] <= 0) { delete G.save.auras[x.id]; if (G.save.equipped === x.id) equip('common', true); } } else G.save.potions[x.id] -= x.n; }
    G.save.potions[p.id] = potionCount(p.id) + 1;
    toast(`Stella brewed a ${p.name}.`, 'gold'); sound('potion'); markDirty(); renderStella(body);
  });
  wireQuestCards(body);
}
function renderGhost(body) {
  body.innerHTML = `<p class="oc-intro">Oh... you can see me? I lost my locket in the creek by the tower, long ago. Could you fish it out for me?</p>${questCard('ghost')}`;
  wireQuestCards(body);
}
// The computer in the Dev Room.
function renderTerminal(body) {
  const lines = ['OVERCONTROL RNG dev console', `build ${VERSION}`, '', '> list auras', `  ${AURAS.length} auras loaded. The rarest is 1 in ${fmt(AURAS[AURAS.length - 1].rarity)}.`, '> whoami', `  ${G.me.name}`, '> cat notes.txt', '  remember: the code OVERCONTROL still works.', '  also FRIXION. codes are case-sensitive.', '  todo: stop the duck from escaping the pond', ''];
  body.innerHTML = `<pre class="oc-term">${esc(lines.join('\n'))}<span class="oc-caret">_</span></pre><div class="oc-info-actions"><button type="button" class="oc-btn" data-run>Run secret.exe</button></div>`;
  body.querySelector('[data-run]').onclick = () => { findEgg('devpc'); body.querySelector('.oc-term').insertAdjacentText('beforeend', '\n> secret.exe\n  access granted. thanks for playing.\n'); };
}

// ---------------- runes and biome changers: start a biome for everyone ----------------
const NATURAL_BIOMES = ['windy', 'rain', 'snow', 'sandstorm', 'hell', 'starfall', 'heaven', 'corruption', 'null'];
function useBiomeItem(p, free) {
  if (!G.net || G.netDenied) { toast('Biome items need the lobby. Try again when you are online.', 'warn'); return false; }
  const ws = G.worldState || {}, n = now();
  if (ws.weather && ws.weather.until > n) { toast(`A biome someone started is still going (${fmtTime(ws.weather.until - n)} left).`, 'warn'); return false; }
  let type = p.biome;
  if (type === 'random') type = NATURAL_BIOMES[Math.floor(Math.random() * NATURAL_BIOMES.length)];
  if (type === 'strange') type = Math.random() < 0.1 ? 'glitched' : NATURAL_BIOMES[Math.floor(Math.random() * NATURAL_BIOMES.length)];
  if (!free) G.save.potions[p.id] = potionCount(p.id) - 1;
  G.net.setWorld({ weather: { type, until: n + 5 * 60000, by: G.me.name } });
  toast(`${p.name}: ${WEATHERS[type].name} is starting for everyone.`, 'gold');
  sound('weather'); markDirty();
  return true;
}

// ---------------- Jake's Workshop: craft gears from auras (locked auras are never used) ----------------
function haveFor(kind, id) {
  if (kind === 'auras') return G.save.locked[id] ? 0 : auraCount(id);
  if (kind === 'gears') return (G.save.gears[id] || 0) - (G.save.hands.left === id || G.save.hands.right === id ? 1 : 0);
  return potionCount(id);
}
const nameFor = (kind, id) => (kind === 'auras' ? AURA[id].name : kind === 'gears' ? GEAR[id].name : POTION[id].name);
function recipeParts(recipe) {
  return Object.entries(recipe).flatMap(([kind, list]) => Object.entries(list).map(([id, n]) => ({ kind, id, n, have: haveFor(kind, id), name: nameFor(kind, id) })));
}
function renderJake(body, hand = G.jakeHand || 'right') {
  G.jakeHand = hand;
  const list = GEARS.filter(g => g.recipe && g.hand === hand);
  body.innerHTML = `<p class="oc-intro">Bring me auras and I'll build you something for your hands. One gear in each hand. Locked auras stay safe.</p>
    ${tabsHtml([['right', 'Right hand: luck and speed'], ['left', 'Left hand: the bonus roll']], hand)}
    <div class="oc-list">${list.map(g => {
      const parts = recipeParts(g.recipe), ok = parts.every(x => x.have >= x.n), owned = G.save.gears[g.id] || 0;
      return `<div class="oc-row recipe">${handGearArt(g)}<div class="oc-row-text"><b>${esc(g.name)}${owned ? ` <small class="oc-owned">x${owned}</small>` : ''}</b><span>${esc(g.desc)}</span>
        <span class="oc-need">${parts.map(x => `<i class="${x.have >= x.n ? 'ok' : 'no'}">${fmt(Math.min(x.have, x.n))}/${fmt(x.n)} ${esc(x.name)}</i>`).join('')}</span></div>
        <button type="button" class="oc-btn sm ok" data-craft="${g.id}" ${ok ? '' : 'disabled'}>Craft</button></div>`;
    }).join('')}</div>`;
  body.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => renderJake(body, b.dataset.tab));
  body.querySelectorAll('[data-craft]').forEach(b => b.onclick = () => {
    const g = GEAR[b.dataset.craft], parts = recipeParts(g.recipe);
    if (!parts.every(x => x.have >= x.n)) return;
    for (const x of parts) {
      if (x.kind === 'auras') { G.save.auras[x.id] -= x.n; if (G.save.auras[x.id] <= 0) { delete G.save.auras[x.id]; if (G.save.equipped === x.id) equip('common', true); } }
      else if (x.kind === 'gears') G.save.gears[x.id] -= x.n;
      else G.save.potions[x.id] -= x.n;
    }
    G.save.gears[g.id] = (G.save.gears[g.id] || 0) + 1;
    if (!G.save.hands[g.hand]) G.save.hands[g.hand] = g.id;
    G.save.stats.crafted = (G.save.stats.crafted || 0) + 1;
    toast(`Jake made you a ${g.name}.${G.save.hands[g.hand] === g.id ? ' It is on your ' + g.hand + ' hand.' : ' Equip it in the Inventory, under Gears.'}`, 'gold');
    sound('anvil'); markDirty(); checkAchievements(); updateHud(); renderJake(body, hand);
  });
}

// ---------------- Jack the Pumpkin (Halloween): Pumpkin Tokens for spooky things ----------------
// Hex sells Halloween auras for coins (the crown of the season also takes Pumpkin Tokens), only during the event.
function renderHex(body) {
  const keep = body.scrollTop, s = G.save;
  body.innerHTML = `<p class="oc-npc-intro">Once a year, darling, and never again until next October. Coins, please. For 『HALLOWED』, Pumpkin Tokens too.</p>
    <div class="oc-money-row"><span class="oc-pill coin">$ ${fmt(s.coins)}</span><span class="oc-pill token">Tokens ${fmt(s.tokens)}</span></div>
    <div class="oc-list">${HEX_SHOP.map((o, i) => { const a = auraKey(o.aura), can = s.coins >= o.coins && s.tokens >= (o.tokens || 0);
      return `<div class="oc-row"><div class="oc-row-text"><b data-hexname="${i}"></b><span>1 in ${fmt(a.rarity)} ${tierOf(a.rarity).label}  |  Owned: ${fmt(auraCount(a.key))}</span></div><span class="oc-price ${can ? '' : 'no'}">$ ${fmt(o.coins)}${o.tokens ? ` + ${o.tokens} tokens` : ''}</span><button type="button" class="oc-btn sm ok" data-hex="${i}" ${can ? '' : 'disabled'}>Buy</button></div>`; }).join('')}</div>`;
  body.querySelectorAll('[data-hexname]').forEach(el => { const a = auraKey(HEX_SHOP[+el.dataset.hexname].aura); paintName(el, a.name, a, 'oc-row-aura'); });
  body.querySelectorAll('[data-hex]').forEach(b => b.onclick = () => {
    const o = HEX_SHOP[+b.dataset.hex], a = auraKey(o.aura);
    if (s.coins < o.coins || s.tokens < (o.tokens || 0)) return;
    s.coins -= o.coins; s.tokens -= o.tokens || 0; s.auras[a.key] = auraCount(a.key) + 1; s.found[a.aura.id] = true;
    toast(`Bought ${a.name} from Hex.`, 'gold'); sound('secret'); markDirty(); updateHud(); checkAchievements(); renderHex(body);
  });
  body.scrollTop = keep;
}
function renderJack(body) {
  if (!isHalloween()) { body.innerHTML = '<p class="oc-empty">Jack only comes out for Halloween.</p>'; return; }
  body.innerHTML = `<p class="oc-intro">Heh heh. Pumpkin Tokens fall all over the island this time of year. Bring them to me.</p>
    <div class="oc-money-row"><span class="oc-pill token">Tokens ${fmt(G.save.tokens)}</span></div>
    <div class="oc-list">${JACK_SHOP.map((o, i) => {
      const thing = o.kind === 'potion' ? POTION[o.id] : o.kind === 'gear' ? GEAR[o.id] : { name: `Title: ${o.id}`, desc: 'Wear it under your name.' };
      const art = o.kind === 'potion' ? potionArt(thing) : o.kind === 'gear' ? handGearArt(thing) : `<span class="oc-titleart">T</span>`;
      const done = o.kind === 'title' && G.save.titles.includes(o.id);
      return `<div class="oc-row">${art}<div class="oc-row-text"><b>${esc(thing.name)}</b><span>${esc(thing.desc)}</span></div><span class="oc-price token ${G.save.tokens >= o.tokens ? '' : 'no'}">${o.tokens} tokens</span><button type="button" class="oc-btn sm" data-j="${i}" ${G.save.tokens >= o.tokens && !done ? '' : 'disabled'}>${done ? 'Owned' : 'Trade'}</button></div>`;
    }).join('')}</div>`;
  body.querySelectorAll('[data-j]').forEach(b => b.onclick = () => {
    const o = JACK_SHOP[+b.dataset.j]; if (G.save.tokens < o.tokens) return;
    G.save.tokens -= o.tokens;
    const got = o.kind === 'potion' ? giveReward({ potions: { [o.id]: 1 } }) : o.kind === 'gear' ? giveReward({ gears: [o.id] }) : giveReward({ title: o.id });
    toast('Jack: ' + got, 'gold'); sound('coin'); renderJack(body);
  });
}

// ---------------- achievements and the season pass ----------------
function renderAchievements(body) {
  const got = G.save.achievements, done = Object.keys(got).length;
  const rewardText = r => [r.coins ? `$ ${fmt(r.coins)}` : '', r.void ? `${r.void} Void Coin${r.void > 1 ? 's' : ''}` : '', ...Object.entries(r.potions || {}).map(([id, n]) => `${n} ${POTION[id].name}`)].filter(Boolean).join(', ');
  body.innerHTML = `<p class="oc-intro">${done}/${ACHIEVEMENTS.length} done. Every 10 achievements give +5% luck forever (you have +${5 * Math.floor(done / 10)}%).</p>
    <div class="oc-list">${ACHIEVEMENTS.map(a => `<div class="oc-quest${got[a.id] ? ' got' : ''}"><div class="oc-q-text"><b>${esc(a.name)}${a.title ? ` <small class="oc-titletag">Title: ${esc(a.title)}</small>` : ''}</b><span>${esc(a.desc)}</span><span>Reward: ${esc(rewardText(a.reward))}</span></div><span class="oc-q-state ${got[a.id] ? 'ok' : ''}">${got[a.id] ? 'Done' : 'Locked'}</span></div>`).join('')}</div>`;
}
function renderPass(body) {
  const keep = body.scrollTop, keepX = (body.querySelector('.oc-pass') || {}).scrollLeft || 0;
  const lv = passLevel(), prem = API().premium(), P = G.save.pass;
  const open = PASS_REWARDS.filter(r => lv.level >= r.level && (!P.free.includes(r.level) || (prem && !P.prem.includes(r.level)))).length;
  const rewardText = r => [r.coins ? `$ ${fmt(r.coins)}` : '', r.void ? `${r.void} Void` : '', ...Object.entries(r.potions || {}).map(([id, n]) => `${n} ${POTION[id].name}`), ...(r.gears || []).map(id => GEAR[id].name + ' (gear)')].filter(Boolean).join(', ');
  body.innerHTML = `<div class="oc-pass-head"><b>${esc(SEASON.name)}</b><span>Level ${lv.level}/${SEASON.levels}</span></div>
    <div class="oc-bar big"><i style="width:${lv.need ? Math.round(lv.xp / lv.need * 100) : 100}%"></i><em>${lv.need ? `${fmt(lv.xp)} / ${fmt(lv.need)} XP` : 'Max level'}</em></div>
    <div class="oc-pass-tools"><p class="oc-empty">XP comes from rolling, fishing, picking things up, quests, secrets, achievements and raids. The second row is for Frixion Premium.</p><button type="button" class="oc-btn ok" data-claimall ${open ? '' : 'disabled'}>Claim all${open ? ` (${open})` : ''}</button></div>
    <div class="oc-pass">${PASS_REWARDS.map(r => {
      const reached = lv.level >= r.level, gotF = P.free.includes(r.level), gotP = P.prem.includes(r.level);
      return `<div class="oc-pass-lv${reached ? ' reached' : ''}"><b>${r.level}</b>
        <div class="oc-pass-cell">${esc(rewardText(r.free))}<button type="button" class="oc-btn sm ok" data-pf="${r.level}" ${reached && !gotF ? '' : 'disabled'}>${gotF ? 'Claimed' : 'Claim'}</button></div>
        <div class="oc-pass-cell prem">${esc(rewardText(r.prem))}<button type="button" class="oc-btn sm" data-pp="${r.level}" ${reached && !gotP && prem ? '' : 'disabled'}>${gotP ? 'Claimed' : prem ? 'Claim' : 'Premium'}</button></div></div>`;
    }).join('')}</div>`;
  const claim = (row, level, quiet) => {
    const r = PASS_REWARDS[level - 1]; if (!r || passLevel().level < level || P[row].includes(level)) return false;
    if (row === 'prem' && !API().premium()) return false;
    P[row].push(level);
    const got = giveReward(row === 'free' ? r.free : r.prem);
    if (!quiet) { toast(`Season Pass level ${level}: ` + got, 'gold'); sound('secret'); markDirty(); renderPass(body); }
    return true;
  };
  body.querySelector('[data-claimall]').onclick = () => {
    let n = 0;
    for (const r of PASS_REWARDS) { if (claim('free', r.level, true)) n++; if (prem && claim('prem', r.level, true)) n++; }
    if (n) { toast(`Season Pass: claimed ${n} reward${n > 1 ? 's' : ''}.`, 'gold'); sound('secret'); markDirty(); }
    renderPass(body);
  };
  body.scrollTop = keep; body.querySelector('.oc-pass').scrollLeft = keepX;
  body.querySelectorAll('[data-pf]').forEach(b => b.onclick = () => claim('free', +b.dataset.pf));
  body.querySelectorAll('[data-pp]').forEach(b => b.onclick = () => claim('prem', +b.dataset.pp));
}
// The jukebox under the tower: play the theme of any aura you have found.
function renderJukebox(body) {
  const found = AURAS.filter(a => G.save.found[a.id] && tierIndex(a.rarity) >= 1).sort((a, b) => b.rarity - a.rarity);
  const biomes = ['clear-day', 'clear-night', ...Object.keys(WEATHERS).filter(w => w !== 'clear' && !WEATHERS[w].hidden)];
  body.innerHTML = `<p class="oc-intro">Every aura from Shadowed up has a song. Pick one. ${G.jukebox ? '<button type="button" class="oc-btn sm bad" data-stop>Stop</button>' : ''}</p>
    <h3>Auras you have found</h3><div class="oc-chips">${found.length ? found.map(a => `<button type="button" class="oc-chip${G.jukebox === 'aura:' + a.id ? ' on' : ''}" data-song="aura:${a.id}" style="color:${a.c}">${esc(a.name)}</button>`).join('') : '<p class="oc-empty">Roll a Shadowed aura or rarer first.</p>'}</div>
    <h3>Biomes</h3><div class="oc-chips">${biomes.map(b => `<button type="button" class="oc-chip${G.jukebox === 'biome:' + b ? ' on' : ''}" data-song="biome:${b}">${esc(b === 'clear-day' ? 'Normal (day)' : b === 'clear-night' ? 'Normal (night)' : WEATHERS[b].name)}</button>`).join('')}</div>`;
  body.querySelectorAll('[data-song]').forEach(b => b.onclick = () => { G.jukebox = b.dataset.song; pickMusic(); renderJukebox(body); });
  const s = body.querySelector('[data-stop]'); if (s) s.onclick = () => { G.jukebox = null; pickMusic(); renderJukebox(body); };
}

// ---------------- quests, stats ----------------
function renderQuests(body) {
  checkDay();
  const q = G.save.quests, left = 86400000 - (now() % 86400000);
  const daily = G.todays.map(d => {
    const n = q.prog[d.id] || 0, done = n >= d.goal, claimed = q.claimed.includes(d.id);
    const reward = [d.reward.coins ? `$ ${fmt(d.reward.coins)}` : '', ...Object.entries(d.reward.potions || {}).map(([id, k]) => `${k} ${POTION[id].name}`)].filter(Boolean).join(', ');
    return `<div class="oc-quest${claimed ? ' claimed' : ''}"><div class="oc-q-text"><b>${esc(d.text)}</b><span>Reward: ${esc(reward)}</span><div class="oc-bar"><i style="width:${Math.round(n / d.goal * 100)}%"></i><em>${fmt(n)}/${fmt(d.goal)}</em></div></div>
      <button type="button" class="oc-btn sm ok" data-claim="${d.id}" ${done && !claimed ? '' : 'disabled'}>${claimed ? 'Claimed' : 'Claim'}</button></div>`;
  }).join('');
  const side = Object.values(SIDE_QUEST).map(sq => {
    const st = q.side[sq.id], state = typeof st === 'object' && st ? st.state : st;
    return `<div class="oc-quest side"><div class="oc-q-text"><b>${esc(sq.title)}</b><span>${esc(sq.giver)}, ${esc(sq.where)}</span></div><span class="oc-q-state ${state === 'done' ? 'ok' : state ? 'on' : ''}">${state === 'done' ? 'Done' : state ? 'In progress' : 'Not started'}</span></div>`;
  }).join('');
  body.innerHTML = `<h3>Daily quests <small>New ones in ${fmtTime(left)}</small></h3><div class="oc-list">${daily}</div><h3>Side quests <small>Talk to people around the island</small></h3><div class="oc-list">${side}</div>`;
  body.querySelectorAll('[data-claim]').forEach(b => b.onclick = () => {
    const d = DAILY_QUESTS.find(x => x.id === b.dataset.claim);
    if (!d || q.claimed.includes(d.id) || (q.prog[d.id] || 0) < d.goal) return;
    q.claimed.push(d.id); G.save.stats.dailies = (G.save.stats.dailies || 0) + 1; addXp(150);
    toast('Quest done: ' + giveReward(d.reward), 'gold'); sound('secret'); progress('none'); renderQuests(body);
  });
}
async function loadBoard() {
  if (!G) return;
  const api = API();
  try {
    const [rolls, rare] = await Promise.all([
      api.db.collection('rngSaves').orderBy('rolls', 'desc').limit(8).get(),
      api.db.collection('rngSaves').orderBy('bestRarity', 'desc').limit(8).get(),
    ]);
    if (!G) return;
    G.board = {
      rolls: rolls.docs.map(d => ({ name: d.data().name || d.id, value: fmt(d.data().rolls || 0) })),
      rare: rare.docs.map(d => { const a = auraKey(d.data().best || 'common'); return { name: d.data().name || d.id, value: a.name, color: a.mut ? a.mut.color : a.aura.c }; }),
    };
    G.world.setBoard(G.board);
  } catch (e) { G.world.setBoard({ rolls: [], rare: [] }); }
}
function renderStats(body, tab = G.statsTab || 'you', fresh = false) {
  G.statsTab = tab;
  const s = G.save, st = s.stats, best = auraKey(s.best);
  const row = (label, value) => `<div class="oc-stat"><span>${label}</span><b>${value}</b></div>`;
  const list = (rows) => rows && rows.length ? rows.map((r, i) => `<div class="oc-stat"><span>${i + 1}. ${esc(r.name)}</span><b style="${r.color ? 'color:' + r.color : ''}">${esc(r.value)}</b></div>`).join('') : '<p class="oc-empty">Loading...</p>';
  body.innerHTML = tabsHtml([['you', 'You'], ['top', 'Top Players']], tab) + (tab === 'you' ? `<div class="oc-stats-grid">
    ${row('Rolls', fmt(s.rolls))}${row('Best aura', '<span class="oc-best"></span>')}${row('Auras found', `${Object.keys(s.found).filter(id => AURA[id]).length}/${AURAS.length}`)}
    ${row('Fish caught', fmt(st.fish))}${row('Things picked up', fmt(st.pickups))}${row('Potions used', fmt(st.potions))}
    ${row('Moves used', fmt(st.moves))}${row('PvP knockouts', fmt(st.kos))}${row('Secrets', `${Object.keys(s.eggs).filter(e => EGGS.includes(e)).length}/${EGGS.length}`)}
    ${row('Time played', fmtTime(st.playSecs * 1000))}${row('Coins', '$ ' + fmt(s.coins))}${row('Side quests done', `${Object.values(s.quests.side).filter(v => v === 'done' || (v && v.state === 'done')).length}/${Object.keys(SIDE_QUEST).length}`)}</div>`
    : `<div class="oc-two"><div><h3>Most rolls</h3>${list(G.board && G.board.rolls)}</div><div><h3>Rarest aura</h3>${list(G.board && G.board.rare)}</div></div>`);
  const bestEl = body.querySelector('.oc-best'); if (bestEl) paintName(bestEl, best.name, best, 'oc-best');
  body.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => renderStats(body, b.dataset.tab));
  if (tab === 'top' && !fresh) loadBoard().then(() => { if (G && G.panel === 'stats' && G.statsTab === 'top') renderStats(body, 'top', true); });
}

// ---------------- settings, like Sol's: tabs along the top, and Redeem Code under Misc ----------------
function renderSettings(body, tab = G.setTab || 'rolling') {
  G.setTab = tab;
  const s = G.save.settings;
  const check = (key, label) => `<label class="oc-check"><input type="checkbox" data-s="${key}" ${s[key] ? 'checked' : ''}><span></span>${label}</label>`;
  const slider = (key, label) => `<label class="oc-slider"><span>${label}</span><input type="range" min="0" max="100" value="${Math.round(vol(key) * 100)}" data-v="${key}"><b>${Math.round(vol(key) * 100)}</b></label>`;
  let html = '';
  if (tab === 'rolling') html = `${check('autoEquip', 'Auto Equip: wear rarer auras as soon as you roll them')}
    <div class="oc-set-row"><b>Cutscenes</b>${[['all', 'Eldritch and up'], ['rare', 'Cataclysmic and up'], ['off', 'Off']].map(([v, l]) => `<button type="button" class="oc-btn sm ${s.cutscenes === v ? 'ok' : ''}" data-cut="${v}">${l}</button>`).join('')}</div>`;
  if (tab === 'sound') html = `${slider('music', 'Background Music')}${slider('mine', 'My Aura BGM')}${slider('others', 'Others\' Aura BGM')}${slider('sfx', 'Sound Effects')}`;
  if (tab === 'controls') html = `<label class="oc-slider"><span>Camera Sensitivity</span><input type="range" min="25" max="800" step="5" value="${Math.round((s.sens || 1) * 100)}" data-sens><b>${(s.sens || 1).toFixed(2)}x</b></label>
    <div class="oc-keys"><b>Keys</b><span>WASD: move. Space: jump. Hold right mouse: turn the camera. Wheel: zoom. Shift: Shift Lock.</span><span>R: roll. E: talk, fish, use. Z X C V: aura moves. F: mobility move. /: chat. Tab: player list.</span></div>`;
  if (tab === 'misc') html = `<div class="oc-set-row"><b>PvP</b><button type="button" class="oc-btn sm ${G.player.pvp ? 'bad' : ''}" data-pvp>${G.player.pvp ? 'On' : 'Off'}</button><small class="oc-dim">With PvP on, your aura's moves hit other players who have it on too, and theirs hit you.</small></div>
    ${check('bubbles', 'Chat bubbles over heads')}
    ${check('serverRolls', 'Server roll messages: rare finds from everyone, in the chat\'s Server tab')}
    <div class="oc-set-row"><b>Graphics</b>${['low', 'medium', 'high'].map(q => `<button type="button" class="oc-btn sm ${q === G.quality ? 'ok' : ''}" data-q="${q}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div>
    <p class="oc-empty">Graphics changes apply the next time you open the game.</p>
    <div class="oc-set-row"><b>Redeem Code</b><button type="button" class="oc-btn sm" data-code>Open</button></div>
    <div class="oc-code hidden"><input type="text" maxlength="32" placeholder="Enter Code..." spellcheck="false" autocomplete="off"><button type="button" class="oc-btn ok sm" data-redeem>Redeem</button></div>`;
  if (tab === 'titles') html = `<p class="oc-empty">Your title shows next to your name on the leaderboard, with its picture. Achievements give titles.</p>
    <div class="oc-titles">${[''].concat(G.save.titles).map(x => `<button type="button" class="oc-title-card${(G.save.title || '') === x ? ' on' : ''}" data-ttl="${esc(x)}">${x ? titleArt(x, 'oc-ttl big') : '<i class="oc-ttl big none"></i>'}<b style="color:${x ? titleInfo(x).color : '#bdbdbd'}">${x ? esc(x) : 'No title'}</b>${(G.save.title || '') === x ? '<small>Equipped</small>' : ''}</button>`).join('')}</div>`;
  body.innerHTML = tabsHtml([['rolling', 'Rolling'], ['sound', 'Sound'], ['controls', 'Controls'], ['titles', 'Leaderboard Titles'], ['misc', 'Miscellaneous']], tab) + `<div class="oc-set">${html}</div>`;
  body.querySelectorAll('[data-ttl]').forEach(b => b.onclick = () => { G.save.title = b.dataset.ttl; if (G.net) G.net.update({ title: b.dataset.ttl || null }); markDirty(); renderPlayers(); renderSettings(body); });
  body.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => renderSettings(body, b.dataset.tab));
  body.querySelectorAll('[data-s]').forEach(c => c.onchange = () => { s[c.dataset.s] = c.checked; markDirty(); });
  body.querySelectorAll('[data-cut]').forEach(b => b.onclick = () => { s.cutscenes = b.dataset.cut; markDirty(); renderSettings(body); });
  body.querySelectorAll('[data-v]').forEach(r => r.oninput = () => { s.vol[r.dataset.v] = r.value / 100; r.nextElementSibling.textContent = r.value; if (r.dataset.v === 'sfx') sound('tick', 600); pickMusic(); markDirty(); });
  const sens = body.querySelector('[data-sens]'); if (sens) sens.oninput = () => { s.sens = sens.value / 100; sens.nextElementSibling.textContent = s.sens.toFixed(2) + 'x'; markDirty(); };
  const pvp = body.querySelector('[data-pvp]'); if (pvp) pvp.onclick = () => { togglePvp(); renderSettings(body); };
  body.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { try { localStorage.setItem('ocrng.quality', b.dataset.q); } catch (e) {} body.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('ok', x === b)); });
  const ts = body.querySelector('[data-title]'); if (ts) ts.onchange = () => { G.save.title = ts.value; drawMyTag(); if (G.net) G.net.update({ title: ts.value || null }); markDirty(); };
  const codeBtn = body.querySelector('[data-code]');
  if (codeBtn) codeBtn.onclick = () => { const box = body.querySelector('.oc-code'); box.classList.toggle('hidden'); box.querySelector('input').focus(); };
  const red = body.querySelector('[data-redeem]');
  if (red) {
    const input = body.querySelector('.oc-code input');
    const go = () => redeemCode(input.value.trim()).then(ok => { if (ok) input.value = ''; });
    red.onclick = go; input.onkeydown = e => { if (e.key === 'Enter') go(); e.stopPropagation(); };
  }
}
// Codes: a few built in, and the ones the Owner and Co-Owners make in the Admin panel (Firestore: rngCodes/{code}).
async function redeemCode(code) {
  if (!code) return false;
  if (G.save.redeemed[code]) { toast('You already redeemed that code.', 'warn'); return false; }
  let reward = BUILTIN_CODES[code];
  if (!reward) {
    try {
      const ref = API().db.collection('rngCodes').doc(code), d = await ref.get();
      if (!d.exists) { toast('That code doesn\'t exist. Codes are case-sensitive.', 'warn'); return false; }
      const c = d.data();
      if (c.expires && c.expires < now()) { toast('That code has expired.', 'warn'); return false; }
      if (c.maxUses && (c.uses || 0) >= c.maxUses) { toast('That code has been used up.', 'warn'); return false; }
      reward = c.reward || {};
      ref.update({ uses: API().FieldValue.increment(1) }).catch(() => {});
    } catch (e) { toast('Couldn\'t check that code. Try again.', 'warn'); return false; }
  }
  G.save.redeemed[code] = now();
  toast('Code redeemed: ' + giveReward(reward), 'gold'); sound('secret'); saveNow();
  return true;
}

// The Owner and Co-Owners: start biomes, change the time, summon the Jester, fly and noclip, and make codes.
// The Owner's admin panel, laid out like Sol's: tabs along the top and big outlined tiles, each in its own colour. An
// active tile is filled in. Events and codes are for the Frixion Owner only.
function renderAdmin(body, tab = G.adminTab || 'biomes') {
  if (!G.me.owner) { body.innerHTML = ''; return; }
  G.adminTab = tab;
  const ws = G.worldState || {}, n = now();
  const tile = (act, label, sub, onNow, color, cls = '') => `<button type="button" class="oc-adm-tile${onNow ? ' on' : ''}${cls ? ' ' + cls : ''}" data-a="${act}" style="--c:${color || '#ffffff'}"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}${onNow ? '<i>ACTIVE</i>' : ''}</button>`;
  let html = '';
  if (tab === 'biomes') html = `<h3>[ Biomes ] <small>5 minutes, for everyone</small></h3><div class="oc-adm-grid">${Object.values(WEATHERS).filter(w => w.id !== 'clear' && !w.hidden).map(w => tile('w:' + w.id, `[ ${w.name.toUpperCase()} ]`, w.event ? 'Halloween' : '', ws.weather && ws.weather.type === w.id && ws.weather.until > n, w.color)).join('')}${tile('w:stop', 'NORMAL', 'End the biome', false, '#9e9e9e', 'stop')}</div>`;
  if (tab === 'events') html = `
    <h3>[ Raids ] <small>in the Pit, east of the plaza</small></h3><div class="oc-adm-grid">${tile('x:boss', '____X____', 'Summon him', G.xfight && G.xfight.live(), '#b388ff')}${tile('x:bossoff', 'SEND X AWAY', 'Ends his fight', false, '#9e9e9e', 'stop')}${tile('r:start', 'THE CRAWLER', 'Summon the worm', G.crawler && !G.crawler.dying, '#f0c87a')}${tile('r:stop', 'SEND IT AWAY', 'Ends the worm', false, '#9e9e9e', 'stop')}</div>
    <h3>[ Server Luck ] <small>10 minutes, for everyone</small></h3><div class="oc-adm-grid">${[2, 3, 10].map(m => tile('l:' + m, `LUCK x${m}`, 'Everyone rolls luckier', ws.luck && ws.luck.mult === m && ws.luck.until > n, '#ffd54f')).join('')}${tile('l:stop', 'NORMAL', 'End server luck', false, '#9e9e9e', 'stop')}</div>
    <h3>[ Time ] <small>10 minutes</small></h3><div class="oc-adm-grid">${tile('t:day', 'DAYTIME', 'Force day', ws.time && ws.time.mode === 'day' && ws.time.until > n, '#ffe082')}${tile('t:night', 'NIGHTTIME', 'Force night', ws.time && ws.time.mode === 'night' && ws.time.until > n, '#9fb4ff')}${tile('t:stop', 'NORMAL', 'Day and night as usual', false, '#9e9e9e', 'stop')}</div>
    <h3>[ The Jester ] <small>15 minutes</small></h3><div class="oc-adm-grid">${tile('j:on', 'SUMMON', 'The Jester arrives', ws.jesterUntil > n, '#d6a8ff')}${tile('j:off', 'SEND AWAY', 'The Jester leaves', false, '#9e9e9e', 'stop')}</div>
    <h3>[ Everything ]</h3><div class="oc-adm-grid">${tile('x:clear', 'END EVERY EVENT', 'Biome, time, luck and the Jester', false, '#ff6b6b', 'stop')}</div>`;
  if (tab === 'players') {
    const online = Object.entries((G.net && G.net.roster) || {}).filter(([u]) => u !== G.me.uid);
    html = `<h3>[ Find a Player ] <small>give them auras, set their rolls, or wipe everything they have (Me finds you)</small></h3>
      <div class="oc-adm-find"><input type="text" data-wn maxlength="40" placeholder="Username" spellcheck="false" autocomplete="off"><button type="button" class="oc-adm-btn" data-wf>Find</button><button type="button" class="oc-adm-btn" data-me>Me</button></div>
      ${online.length ? `<div class="oc-adm-online"><small>In the lobby:</small>${online.map(([u, d]) => `<button type="button" class="oc-adm-chip" data-pick="${esc(u)}">${esc(d.name || u)}</button>`).join('')}</div>` : ''}
      <div class="oc-adm-card hidden" data-wc></div>
      <h3>[ Give Everyone Online ] <small>${online.length + 1} in the lobby, you included</small></h3><div class="oc-adm-give" data-gall>${auraPicker()}<button type="button" class="oc-adm-btn ok" data-giveall>Give everyone</button></div>`;
  }
  if (tab === 'codes') {
    const potionOpts = POTIONS.filter(p => !p.hidden).map(p => `<option value="potion:${p.id}">${esc(p.name)}</option>`).join('');
    const gearOpts = ITEMS.map(i => `<option value="item:${i.id}">${esc(i.name)} (gear)</option>`).join('');
    html = `<h3>[ Make a Code ] <small>players redeem them in Settings, Miscellaneous</small></h3>
    <div class="oc-codeform">
      <input type="text" data-c="code" maxlength="24" placeholder="CODE (case-sensitive)" spellcheck="false">
      <select data-c="what"><option value="coins">Coins</option><option value="f">F (blue coins)</option><option value="void">Void Coins</option>${potionOpts}${gearOpts}</select>
      <label><small>Amount</small><input type="number" data-c="amount" min="1" max="1000000000" value="1"></label>
      <label><small>Max uses</small><input type="number" data-c="uses" min="0" value="0"></label>
      <label><small>Hours</small><input type="number" data-c="hours" min="0" value="0"></label>
      <button type="button" class="oc-adm-btn ok" data-mk>Make code</button>
    </div>
    <p class="oc-empty">Max uses 0 means no limit. Hours 0 means it never expires.</p>
    <h3>[ Codes ]</h3><div class="oc-list oc-codes"><p class="oc-empty">Loading codes...</p></div>`;
  }
  if (tab === 'me') html = `<h3>[ OpFun ] <small>the Owner's fun mode</small></h3><div class="oc-adm-grid">${tile('m:opfun', 'OPFUN', 'No cooldowns on anything', G.save.settings.opfun, '#ff4fd8')}</div>
    <h3>[ Equip Any Aura ] <small>with any mutation</small></h3><div class="oc-adm-give">${auraPicker({ key: G.save.equipped, amount: false })}<button type="button" class="oc-adm-btn ok" data-eqgo>Equip</button></div>
    <h3>[ Movement ] <small>just you</small></h3><div class="oc-adm-grid">${tile('m:fly', 'FLY', 'Space up, Q down', G.player.fly, '#80d8ff')}${tile('m:noclip', 'NOCLIP', 'Walk through walls', G.player.noclip, '#80d8ff')}</div>
    <h3>[ Teleport ]</h3><div class="oc-adm-grid">${tile('m:spawn', 'SPAWN', 'The plaza', false, '#ffffff')}${tile('m:pit', 'THE PIT', 'Where raids happen', false, '#b388ff')}${tile('m:summit', 'MOUNTAIN TOP', 'The bell', false, '#ffffff')}${tile('m:stella', 'STELLA', 'Her cave', false, '#ffffff')}</div>`;
  body.innerHTML = tabsHtml([['biomes', 'Biomes'], ['events', 'Events'], ['players', 'Players'], ['codes', 'Codes'], ['me', 'Me']], tab) + `<div class="oc-admin">${html}</div>`;
  body.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => renderAdmin(body, b.dataset.tab));
  body.querySelectorAll('.oc-apick').forEach(wirePicker);
  body.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { adminAction(b.dataset.a); setTimeout(() => G && G.panel === 'admin' && renderAdmin(body), 300); });
  const eqGo = body.querySelector('[data-eqgo]');
  if (eqGo) eqGo.onclick = () => { equip(readPick(eqGo.parentElement).key); renderAdmin(body, 'me'); };
  if (tab === 'players') {
    const input = body.querySelector('[data-wn]'), card = body.querySelector('[data-wc]');
    const find = async () => {
      const q = input.value.trim(); if (!q) return;
      card.classList.remove('hidden'); card.innerHTML = '<p class="oc-empty">Looking...</p>';
      const found = await findSave(q);
      if (!G || G.panel !== 'admin') return;
      if (!found) { card.innerHTML = `<p class="oc-empty">Nobody called ${esc(q)} has Overcontrol RNG data.</p>`; return; }
      const d = found.data, best = auraKey(d.best || 'common');
      card.innerHTML = `<b>${esc(d.name || found.id)}</b><span>${fmt(d.rolls || 0)} rolls  |  rarest: ${esc(best.name)}  |  ${Object.keys(d.auras || {}).length} kinds of aura</span><div class="oc-adm-find"><input type="number" min="0" data-rolls value="${d.rolls || 0}"><button type="button" class="oc-adm-btn ok" data-setrolls>Set rolls</button></div><div class="oc-adm-give"><small>Give an aura</small>${auraPicker()}<button type="button" class="oc-adm-btn ok" data-give>Give</button></div><button type="button" class="oc-adm-btn bad" data-wipe>Wipe ALL data</button>`;
      const ri = card.querySelector('[data-rolls]'); ri.onkeydown = e => e.stopPropagation();
      card.querySelector('[data-setrolls]').onclick = () => setRolls(found.id, d.name || found.id, Math.max(0, Math.floor(+ri.value || 0)));
      card.querySelectorAll('.oc-apick').forEach(wirePicker);
      card.querySelector('[data-give]').onclick = () => { const g = readPick(card); giveAura(found.id, d.name || found.id, g.key, g.n); };
      let armed = 0;
      card.querySelector('[data-wipe]').onclick = e => {
        const b = e.currentTarget;
        if (Date.now() - armed > 4000) { armed = Date.now(); b.textContent = `Click again to wipe ${d.name || found.id} for good`; return; }
        wipeSave(found.id, d.name || found.id).then(() => { card.innerHTML = `<p class="oc-empty">${esc(d.name || found.id)}'s data was wiped.</p>`; });
      };
    };
    body.querySelector('[data-wf]').onclick = find;
    body.querySelector('[data-me]').onclick = () => { input.value = G.me.name; find(); };
    body.querySelector('[data-giveall]').onclick = async () => {
      const g = readPick(body.querySelector('[data-gall]')), r = auraKey(g.key), roster = Object.entries((G.net && G.net.roster) || {}).filter(([u]) => u !== G.me.uid);
      applyGift(r.key, g.n, G.me.name, true);
      for (const [u] of roster) await G.net.gift(u, { key: r.key, n: g.n, by: G.me.name }).catch(() => {});
      toast(`Gave everyone in the lobby (${roster.length + 1}) ${g.n > 1 ? fmt(g.n) + 'x ' : ''}${r.name}.`, 'gold');
      if (G.chat && roster.length) G.chat.system(`[Admin]: ${G.me.name} gave everyone ${g.n > 1 ? fmt(g.n) + 'x ' : ''}${r.name}!`, '#ffd54f', 'server');
    };
    input.onkeydown = e => { if (e.key === 'Enter') find(); e.stopPropagation(); };
    body.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { input.value = b.dataset.pick; find(); });
  }
  if (tab === 'codes') {
    const val = k => body.querySelector(`[data-c="${k}"]`).value;
    body.querySelector('[data-mk]').onclick = async () => {
      const code = val('code').trim();
      if (!/^[A-Za-z0-9_-]{3,24}$/.test(code)) { toast('Codes are 3 to 24 letters, numbers, - or _.', 'warn'); return; }
      const [kind, id] = val('what').split(':'), amount = Math.max(1, Math.floor(+val('amount') || 1));
      const reward = kind === 'potion' ? { potions: { [id]: amount } } : kind === 'item' ? { items: [id] } : { [kind]: amount };
      const hours = +val('hours') || 0;
      try {
        await API().db.collection('rngCodes').doc(code).set({ reward, maxUses: Math.max(0, Math.floor(+val('uses') || 0)), uses: 0, expires: hours ? now() + hours * 3600000 : 0, by: G.me.name, made: now() });
        toast(`Code ${code} is live.`, 'gold'); loadCodes(body);
      } catch (e) { toast('Couldn\'t save that code.', 'warn'); }
    };
    body.querySelectorAll('.oc-codeform input').forEach(i => { i.onkeydown = e => e.stopPropagation(); });
    loadCodes(body);
  }
}
// Put a player's roll count back (or change it). Your own changes at once; someone playing right now sees it after
// they rejoin.
async function setRolls(id, name, n) {
  if (id === G.me.uid) { G.save.rolls = n; markDirty(); saveNow(); renderPlayers(); toast(`Your rolls are ${fmt(n)} now.`, 'gold'); return; }
  try { await API().db.collection('rngSaves').doc(id).update({ rolls: n }); toast(`${name} has ${fmt(n)} rolls now. If they are playing, they see it after rejoining.`, 'gold'); } catch (e) { toast('Could not change their rolls.', 'warn'); }
}
// 『EQUINOX』 (and its mutations) as 『LEGACY EQUINOX』
const toLegacy = k => { const r = auraKey(k); return r.aura.id === 'equinox' ? 'legacyequinox' + (r.mut ? ':' + r.mut.id : '') : k; };
// Swap 『EQUINOX』 for 『LEGACY EQUINOX』 in every save, once, from the Owner's game, so players who don't come back
// get it too (everyone else got it when they loaded).
async function sweepEquinox() {
  if (!G || !G.me.owner || !G.net) return;
  const api = API(), flag = api.rtdb.ref('ocrng/sweeps/equinox1');
  try { if ((await flag.get()).val()) return; } catch (e) { return; }
  const col = api.db.collection('rngSaves'), FP = api.firebase.firestore.FieldPath, FV = api.FieldValue;
  const keys = ['equinox', ...Object.keys(MUTATIONS).map(m => 'equinox:' + m)], found = new Map();
  for (const k of keys) { try { (await col.where(new FP('auras', k), '>', 0).get()).docs.forEach(d => found.set(d.id, d)); } catch (e) {} }
  try { (await col.where('best', 'in', keys).get()).docs.forEach(d => found.set(d.id, d)); } catch (e) {}
  try { (await col.where(new FP('found', 'equinox'), '==', true).get()).docs.forEach(d => found.set(d.id, d)); } catch (e) {}
  let n = 0;
  for (const [id, d] of found) {
    if (id === G.me.uid) continue;
    const s = d.data(), auras = s.auras || {}, args = [], legacy = {};
    if ((s.flags || {}).noEquinox) continue;   // they have played since, and got theirs then
    for (const k of Object.keys(auras)) { const nk = toLegacy(k); if (nk !== k) { args.push(new FP('auras', k), FV.delete()); legacy[nk] = (legacy[nk] || auras[nk] || 0) + auras[k]; } }
    if (!Object.keys(legacy).length) legacy.legacyequinox = (auras.legacyequinox || 0) + 1;
    for (const [nk, c] of Object.entries(legacy)) args.push(new FP('auras', nk), c);
    const best = toLegacy(s.best || 'common');
    args.push('best', best, 'bestRarity', auraKey(best).rarity, new FP('found', 'equinox'), FV.delete(), new FP('found', 'legacyequinox'), true, new FP('flags', 'noEquinox'), true);
    if (s.equipped) args.push('equipped', toLegacy(s.equipped));
    try { await d.ref.update(...args); n++; } catch (e) {}
  }
  try { await flag.set({ at: Date.now(), players: n }); } catch (e) {}
  if (n) toast(`Gave 『LEGACY EQUINOX』 to ${n} player${n > 1 ? 's' : ''} who had 『EQUINOX』 and haven't played since.`, 'gold');
}
// Giving auras, like Sol's admins: any aura, any mutation, any amount. To yourself it goes straight in; to anyone else it
// waits in their gift inbox until their game takes it (right away if they are playing), so their own save never
// writes over it.
// The aura picker: the chosen aura in its own colours with its odds, mutation chips, an amount, and a list you can search
// and filter by tier (arrow keys and Enter work too).
function auraPicker(o = {}) {
  const cur = auraKey(o.key || 'common');
  return `<div class="oc-apick" data-aura="${cur.aura.id}" data-mut="${cur.mut ? cur.mut.id : ''}">
    <button type="button" class="oc-apick-sel" data-ap-open><span class="oc-apick-name"></span><span class="oc-apick-meta"></span><i class="oc-apick-caret"></i></button>
    <div class="oc-apick-muts"><button type="button" data-ap-mut="" class="${cur.mut ? '' : 'on'}">No mutation</button>${Object.values(MUTATIONS).map(m => `<button type="button" data-ap-mut="${m.id}" class="${cur.mut && cur.mut.id === m.id ? 'on' : ''}${m.rainbow ? ' rb' : ''}" style="--m:${m.color}">${m.name}<small>x${m.mult}</small></button>`).join('')}</div>
    ${o.amount === false ? '' : '<div class="oc-amt oc-apick-amt"><button type="button" data-amt="-1">-</button><input type="number" data-gn min="1" max="1000000" value="1" title="How many"><button type="button" data-amt="1">+</button><button type="button" data-amt="10">+10</button><button type="button" data-amt="100">+100</button></div>'}
    <div class="oc-apick-pop hidden"><label class="oc-search">${IC.search}<input type="search" data-ap-q placeholder="Search ${AURAS.length} auras" spellcheck="false" autocomplete="off"></label><div class="oc-apick-tiers"></div><div class="oc-apick-list"></div></div>
  </div>`;
}
function wirePicker(el) {
  const pop = el.querySelector('.oc-apick-pop'), list = el.querySelector('.oc-apick-list'), q = el.querySelector('[data-ap-q]'), tiersEl = el.querySelector('.oc-apick-tiers');
  let tierF = 'all', hi = 0, rows = [], offOutside = null;
  const show = () => {
    const r = auraKey(el.dataset.aura + (el.dataset.mut ? ':' + el.dataset.mut : ''));
    paintName(el.querySelector('.oc-apick-name'), r.name, r, 'oc-apick-name');
    el.querySelector('.oc-apick-meta').innerHTML = tierLine(r.rarity);
  };
  tiersEl.innerHTML = [['all', 'All'], ['special', 'Special'], ...[...TIERS].reverse().map(t => [t.id, t.id === 'null' ? 'null' : t.label])]
    .map(([id, label]) => `<button type="button" data-ap-tier="${id}" class="${id === 'all' ? 'on' : ''}" style="--t:${(TIERS.find(t => t.id === id) || { color: '#ffffff' }).color}">${esc(label)}</button>`).join('');
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    rows = [...AURAS].filter(a => (tierF === 'all' || (tierF === 'special' ? isSpecial(a) : tierOf(a.rarity).id === tierF)) && (!s || a.name.toLowerCase().includes(s) || a.id.includes(s)))
      .sort((a, b) => b.rarity - a.rarity);
    hi = Math.max(0, Math.min(hi, rows.length - 1));
    list.innerHTML = rows.length ? rows.map((a, i) => `<button type="button" class="oc-apick-row${a.id === el.dataset.aura ? ' sel' : ''}${i === hi ? ' hi' : ''}" data-ap-id="${a.id}"><i style="background:${a.c}"></i><span class="nm"></span>${isSpecial(a) ? '<em>SPECIAL</em>' : ''}<span class="oc-tier t-${tierOf(a.rarity).id}">${tierOf(a.rarity).label}</span><small>1 in ${fmt(a.rarity)}</small></button>`).join('') : '<p class="oc-empty">No aura matches.</p>';
    list.querySelectorAll('.oc-apick-row').forEach((b, i) => paintName(b.querySelector('.nm'), rows[i].name, rows[i], 'nm'));
  };
  const open = on => {
    pop.classList.toggle('hidden', !on); el.classList.toggle('open', on);
    if (offOutside) { document.removeEventListener('pointerdown', offOutside, true); offOutside = null; }
    if (!on) return;
    q.value = ''; hi = 0; draw();
    hi = Math.max(0, rows.findIndex(a => a.id === el.dataset.aura)); draw();
    const sel = list.querySelector('.sel'); if (sel) sel.scrollIntoView({ block: 'center' });
    q.focus();
    offOutside = e => { if (!el.contains(e.target)) open(false); };
    document.addEventListener('pointerdown', offOutside, true);
  };
  const choose = id => { el.dataset.aura = id; show(); open(false); sound('tick', 700); };
  el.querySelector('[data-ap-open]').onclick = () => open(pop.classList.contains('hidden'));
  q.oninput = () => { hi = 0; draw(); };
  q.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, Math.min(rows.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1))); draw(); const h = list.querySelector('.hi'); if (h) h.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' && rows[hi]) choose(rows[hi].id);
    else if (e.key === 'Escape') open(false);
  };
  tiersEl.onclick = e => { const b = e.target.closest('[data-ap-tier]'); if (!b) return; tierF = b.dataset.apTier; tiersEl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); hi = 0; draw(); q.focus(); };
  list.onclick = e => { const b = e.target.closest('[data-ap-id]'); if (b) choose(b.dataset.apId); };
  el.querySelector('.oc-apick-muts').onclick = e => { const b = e.target.closest('[data-ap-mut]'); if (!b) return; el.dataset.mut = b.dataset.apMut; el.querySelectorAll('[data-ap-mut]').forEach(x => x.classList.toggle('on', x === b)); show(); };
  const amt = el.querySelector('[data-gn]');
  if (amt) { amt.onkeydown = e => e.stopPropagation(); el.querySelectorAll('.oc-apick-amt [data-amt]').forEach(b => b.onclick = () => { amt.value = Math.max(1, Math.min(1000000, (Math.floor(+amt.value) || 1) + +b.dataset.amt)); }); }
  show();
}
function readPick(el) {
  const p = el.classList.contains('oc-apick') ? el : el.querySelector('.oc-apick'), amt = p.querySelector('[data-gn]');
  return { key: p.dataset.mut ? `${p.dataset.aura}:${p.dataset.mut}` : p.dataset.aura, n: amt ? Math.max(1, Math.min(1000000, Math.floor(+amt.value || 1))) : 1 };
}
async function giveAura(to, name, key, n) {
  const r = auraKey(key), what = `${n > 1 ? fmt(n) + 'x ' : ''}${r.name}`;
  if (to === G.me.uid) { applyGift(r.key, n, G.me.name, true); return; }
  try { await G.net.gift(to, { key: r.key, n, by: G.me.name }); toast(`Gave ${name} ${what}. ${G.net.roster[to] ? 'They have it now.' : 'They get it the next time they play.'}`, 'gold'); }
  catch (e) { toast('Could not send that.', 'warn'); }
}
function applyGift(key, n, by, self) {
  const s = G.save, r = auraKey(key), what = `${n > 1 ? fmt(n) + 'x ' : ''}${r.name}`;
  s.auras[r.key] = auraCount(r.key) + n; s.found[r.aura.id] = true;
  if (r.rarity > auraKey(s.best).rarity) s.best = r.key;
  s.bestTier = Math.max(s.bestTier || 0, tierIndex(r.rarity));
  if (self) toast(`Added ${what} to your Aura Storage.`, 'gold');
  else { toast(`${by} gave you ${what}!`, 'gold'); if (G.chat) G.chat.system(`[Admin]: ${by} gave you ${what}.`, '#ffd54f'); }
  sound('secret'); checkAchievements(); markDirty();
}
// a gift arrived: take it, save, then clear it from the inbox (a game that couldn't load its save leaves it for later)
function onGift(g, done) {
  if (!G || !G.save || G.loadFailed || G.wiped) return;
  const n = Math.floor(+g.n || 0), r = auraKey(g.key);
  if (n >= 1 && n <= 1000000 && r.key === String(g.key)) applyGift(r.key, n, String(g.by || 'The Owner').slice(0, 40));
  saveNow(); done();
}
// A save by username, or by the name it was saved under.
async function findSave(q) {
  // yourself: always found (any capitalisation), straight from the game you have open
  if ([G.me.uid, G.me.name].some(x => String(x).toLowerCase() === q.toLowerCase())) return { id: G.me.uid, data: G.save };
  const col = API().db.collection('rngSaves');
  try {
    const d = await col.doc(q).get();
    if (d.exists) return { id: d.id, data: d.data() };
    const s = await col.where('name', '==', q).limit(1).get();
    if (!s.empty) return { id: s.docs[0].id, data: s.docs[0].data() };
  } catch (e) {}
  return null;
}
// Wipe: the save becomes empty, and a game they have open hears about it, stops saving and closes.
async function wipeSave(id, name) {
  try {
    await API().db.collection('rngSaves').doc(id).set({ name, wipedAt: now(), wipedBy: G.me.name });
    if (G.net) G.net.wipe(id).catch(() => {});
    toast(`Wiped ${name}'s Overcontrol RNG data.`, 'gold');
    if (G.chat) G.chat.system(`[Admin]: ${name}'s data was wiped.`, '#ff8a80');
  } catch (e) { toast('Couldn\'t wipe that save.', 'warn'); }
}
function onWiped(at) {
  if (!G) return;
  if (G.wipeBase === undefined) { G.wipeBase = at || 0; return; }   // the first value is from before you joined
  if (!at || at === G.wipeBase) return;
  G.wiped = true;
  API().toast('The Owner wiped your Overcontrol RNG data.', 'warn');
  close();
}
async function loadCodes(body) {
  const box = body.querySelector('.oc-codes'); if (!box) return;
  try {
    const snap = await API().db.collection('rngCodes').orderBy('made', 'desc').limit(30).get();
    if (!G || G.panel !== 'admin') return;
    const describe = r => [r.coins ? `$ ${fmt(r.coins)}` : '', r.f ? `F ${fmt(r.f)}` : '', r.void ? `${r.void} Void` : '', ...Object.entries(r.potions || {}).map(([id, n]) => `${n} ${(POTION[id] || { name: id }).name}`), ...(r.items || []).map(id => (ITEM[id] || { name: id }).name)].filter(Boolean).join(', ');
    box.innerHTML = snap.empty ? '<p class="oc-empty">No codes yet.</p>' : snap.docs.map(d => { const c = d.data(); return `<div class="oc-row"><div class="oc-row-text"><b>${esc(d.id)}</b><span>${esc(describe(c.reward || {}))} · used ${c.uses || 0}${c.maxUses ? '/' + c.maxUses : ''}${c.expires ? (c.expires < now() ? ' · expired' : ' · ends in ' + fmtTime(c.expires - now())) : ''} · by ${esc(c.by || '?')}</span></div><button type="button" class="oc-btn sm bad" data-del="${esc(d.id)}">Delete</button></div>`; }).join('');
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => API().db.collection('rngCodes').doc(b.dataset.del).delete().then(() => loadCodes(body)).catch(() => toast('Couldn\'t delete that code.', 'warn')));
  } catch (e) { box.innerHTML = '<p class="oc-empty">Couldn\'t load codes.</p>'; }
}
function adminAction(a) {
  const [k, v] = a.split(':'), n = now(), net = G.net;
  if (!G.me.owner) return;
  if (k === 'm') {
    if (v === 'fly') { G.player.fly = !G.player.fly; G.player.vel.y = 0; if (G.player.fly && G.shiftLock) setShiftLock(false); toast(G.player.fly ? 'Fly on.' : 'Fly off.'); }
    if (v === 'noclip') { G.player.noclip = !G.player.noclip; toast(G.player.noclip ? 'Noclip on.' : 'Noclip off.'); }
    if (v === 'spawn') { G.player.pos.copy(G.world.spawn); G.player.vel.set(0, 0, 0); }
    if (v === 'summit') { const b = G.world.places.bell.pos; G.player.pos.set(b.x, b.y + 0.5, b.z + 2); G.player.vel.set(0, 0, 0); }
    if (v === 'stella') { G.player.pos.copy(G.world.stellaCamp); G.player.vel.set(0, 0, 0); }
    if (v === 'opfun') { const st = G.save.settings; st.opfun = !st.opfun; if (st.opfun) G.moveCd = {}; toast(st.opfun ? 'OpFun on: no cooldowns on anything.' : 'OpFun off.', st.opfun ? 'gold' : undefined); markDirty(); renderAbilities(); updateHud(); }
    if (v === 'pit') { const a = G.world.arena; G.player.pos.set(a.x - 24, 1, a.z); G.player.vel.set(0, 0, 0); }
    return;
  }
  if (!net) return;
  if (k === 'w') { net.setWorld({ weather: v === 'stop' ? null : { type: v, until: n + 5 * 60000, by: G.me.name } }); toast(v === 'stop' ? 'Biome stopped.' : `${WEATHERS[v].name} started for everyone.`); }
  if (k === 't') { net.setWorld({ time: v === 'stop' ? null : { mode: v, until: n + 10 * 60000, by: G.me.name } }); toast(v === 'stop' ? 'Time is back to normal.' : `It is ${v} for everyone now.`); }
  if (k === 'j') { net.setWorld({ jesterUntil: v === 'on' ? n + 15 * 60000 : 0 }); toast(v === 'on' ? 'The Jester has been summoned.' : 'The Jester has gone.'); }
  if (k === 'x' && v === 'clear') { net.clearWorld(); toast('Every event ended.'); }
  if (k === 'x' && v === 'boss' && G.xfight) { if (G.xfight.live()) toast('____X____ is already here.', 'warn'); else G.xfight.start(G.me.name).then(r => toast(r && r.committed ? '____X____ is coming to the Pit.' : 'Could not summon him right now.', r && r.committed ? 'gold' : 'warn')); }
  if (k === 'x' && v === 'bossoff' && G.xfight) { G.xfight.stop(); toast('____X____ was sent away.'); }
  if (k === 'r') { if (v === 'start') { startRaid(-1, G.me.name); toast('The Crawler is coming up in the Pit.'); } else { net.raidUpdate({ gone: true }); toast('The Crawler was sent away.'); } }
  if (k === 'l') { net.setWorld({ luck: v === 'stop' ? null : { mult: +v, until: n + 10 * 60000, by: G.me.name } }); toast(v === 'stop' ? 'Server luck is back to normal.' : `Server luck x${v} for 10 minutes, for everyone.`); if (G.chat && v !== 'stop') G.chat.system(`[Server]: SERVER LUCK x${v} for 10 minutes!`, '#ffd54f'); }
}

// ---------------- fishing: cast, wait for a bite, then reel ----------------
// The reel: a marker slides along a bar; press Reel (or E) while it is inside the green zone. Three hits land the fish,
// two misses and it gets away. Better rods widen the zone; rarer fish move the marker faster.
function startFishing(spot) {
  const b = buffs();
  G.fishing = { spot, state: 'wait', t: 0, wait: (2.2 + Math.random() * 4) / b.fish, hits: 0, misses: 0, pos: 0, dir: 1 };
  G.player.vel.set(0, G.player.vel.y, 0);
  renderFishBar();
  sound('cast');
}
function stopFishing() { G.fishing = null; $q('.oc-fishbar').classList.add('hidden'); }
function fishingTick(dt) {
  const f = G.fishing; f.t += dt;
  if (f.state === 'wait' && f.t > f.wait) {
    const b = buffs(), ghost = G.save.quests.side.ghost;
    const voidChance = (f.spot === 'void' ? 1 / 6 : 1 / 40) * b.voidLuck;
    if (ghost && ghost.state === 'active' && !ghost.locket && f.spot === 'creek' && G.env.time === 'night' && Math.random() < 0.3) f.catch = { locket: true, name: 'Old Locket', value: 300, color: '#cfd8dc' };
    else if (f.spot === 'void' && !G.save.keys.void && Math.random() < 0.12) f.catch = { key: true, name: 'Void Key', value: 999, color: '#7c4dff' };
    else f.catch = Math.random() < voidChance ? { void: true, name: 'Void Coin', speed: 1.6 } : catchFish(f.spot, G.env.time, G.env.weather, b.fishLuck);
    const val = f.catch.void ? 200 : f.catch.value;
    f.speed = 0.8 + Math.min(1.6, Math.log10(1 + val) * 0.55);
    f.zone = Math.min(0.42, 0.16 + (b.rod - 1) * 0.08);
    f.zoneAt = 0.15 + Math.random() * (0.85 - f.zone - 0.15);
    f.state = 'reel'; f.t = 0;
    sound('bite');
    renderFishBar();
  } else if (f.state === 'reel') {
    f.pos += f.dir * f.speed * dt;
    if (f.pos > 1) { f.pos = 1; f.dir = -1; } if (f.pos < 0) { f.pos = 0; f.dir = 1; }
    const m = $q('.oc-fb-marker'); if (m) m.style.left = (f.pos * 100) + '%';
    if (f.t > 9) { toast('It got away.'); renderFishResult(null); }
  }
}
function reelPress() {
  const f = G.fishing;
  if (!f) return;
  if (f.state === 'done') { startFishing(f.spot); return; }
  if (f.state !== 'reel') return;
  const inZone = f.pos >= f.zoneAt && f.pos <= f.zoneAt + f.zone;
  if (inZone) { f.hits++; sound('tick', 700 + f.hits * 120); f.zoneAt = 0.1 + Math.random() * (0.9 - f.zone - 0.1); }
  else { f.misses++; sound('hurt'); }
  if (f.hits >= 3) {
    const c = f.catch;
    if (c.void) G.save.void++;
    else if (c.locket) { G.save.quests.side.ghost.locket = true; toast('The ghost\'s locket! Bring it to the graveyard at night.', 'gold'); }
    else if (c.key) { G.save.keys.void = true; toast('A Void Key! It must open something dark.', 'gold'); }
    else {
      G.save.fish[c.id] = (G.save.fish[c.id] || 0) + 1; G.save.caught[c.id] = true;
      if (c.id === 'boot') { G.save.flags.boots = (G.save.flags.boots || 0) + 1; if (G.save.flags.boots >= 10) findEgg('boots'); }
    }
    G.save.stats.fish++; progress('fish'); addXp(10);
    markDirty(); updateHud();
    renderFishResult(c);
    sound(c.void || c.locket || c.value >= 50 ? 'secret' : 'coin');
  } else if (f.misses >= 2) { renderFishResult(null); }
  else renderFishBar();
}
function renderFishBar() {
  const f = G.fishing, el = $q('.oc-fishbar');
  el.classList.remove('hidden');
  const spot = FISHING_SPOTS[f.spot].name;
  if (f.state === 'wait') {
    el.innerHTML = `<div class="oc-fb-title">${IC.fish}<span>${esc(spot)}</span></div><div class="oc-fb-msg">Waiting for a bite<span class="dots"></span></div><div class="oc-fb-row"><button type="button" class="oc-btn sm" data-stop>Stop</button></div>`;
  } else if (f.state === 'reel') {
    el.innerHTML = `<div class="oc-fb-title">${IC.fish}<span>Reel it in</span></div>
      <div class="oc-fb-bar"><span class="oc-fb-zone" style="left:${f.zoneAt * 100}%;width:${f.zone * 100}%"></span><span class="oc-fb-marker" style="left:${f.pos * 100}%"></span></div>
      <div class="oc-fb-pips">${[0, 1, 2].map(i => `<i class="${i < f.hits ? 'on' : ''}"></i>`).join('')}<span class="miss">${f.misses ? 'Missed ' + f.misses + '/2' : ''}</span></div>
      <div class="oc-fb-row"><button type="button" class="oc-btn primary" data-reel>Reel</button></div>`;
  }
  const r = el.querySelector('[data-reel]'); if (r) r.onclick = reelPress;
  const s = el.querySelector('[data-stop]'); if (s) s.onclick = stopFishing;
}
function renderFishResult(c) {
  const f = G.fishing, el = $q('.oc-fishbar');
  if (!f) return;
  f.state = 'done';
  el.innerHTML = c
    ? `<div class="oc-fb-title">${c.void ? coinArt('void') : fishArt(c.color)}<span>${c.void ? 'A Void Coin' : esc(c.name)}</span></div><div class="oc-fb-msg">${c.void ? 'Rare catch. Trade 5 with the Jester.' : c.key ? 'Cold and heavy. Somewhere there is a black door.' : c.locket ? 'It glows faintly. Someone is missing this.' : c.junk ? 'Worth nothing. Still counts.' : `Marlin pays ${c.value} F for it.`}</div>`
    : `<div class="oc-fb-title">${IC.fish}<span>It got away</span></div><div class="oc-fb-msg">Try again.</div>`;
  el.innerHTML += `<div class="oc-fb-row"><button type="button" class="oc-btn primary" data-again>Cast again</button><button type="button" class="oc-btn sm" data-stop>Done</button></div>`;
  el.querySelector('[data-again]').onclick = () => startFishing(f.spot);
  el.querySelector('[data-stop]').onclick = stopFishing;
}

// ---------------- sound: little synth blips, no files to download ----------------
function audio() {
  if (G.audio) return G.audio;
  try { G.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { G.audio = null; }
  return G.audio;
}
function sound(kind, n = 0) {
  if (!G || !G.save) return;
  const ctx = G.audio, v0 = vol('sfx'); if (!ctx || v0 <= 0) return;
  const noise = (d, v, delay = 0, f = 1200) => {
    const len = Math.max(1, Math.floor(ctx.sampleRate * d)), buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain(), t0 = ctx.currentTime + delay;
    src.buffer = buf; flt.type = 'bandpass'; flt.frequency.value = f; flt.Q.value = 0.8; g.gain.value = v * v0 * 1.6;
    src.connect(flt); flt.connect(g); g.connect(ctx.destination); src.start(t0);
  };
  const tone = (f, d, type = 'sine', v = 0.08, delay = 0, slide) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(v * v0 * 1.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + d + 0.02);
  };
  const chord = (base, notes, d, type, v) => notes.forEach((s, i) => tone(base * Math.pow(2, s / 12), d, type, v, i * 0.06));
  switch (kind) {
    case 'tick': tone(n || 400, 0.05, 'square', 0.03); break;
    case 'land': chord(330 + n * 40, n >= 3 ? [0, 4, 7, 12] : [0, 7], 0.5, 'triangle', 0.07); break;
    case 'cut': chord(110, [0, 7, 12, 19, 24], 2.5, 'sawtooth', 0.04); chord(220 + n * 20, [0, 4, 7, 11, 14], 3, 'sine', 0.05); break;
    case 'coin': tone(988, 0.08, 'square', 0.04); tone(1319, 0.2, 'square', 0.04, 0.08); break;
    case 'potion': tone(300, 0.3, 'sine', 0.06, 0, 900); break;
    case 'quack': tone(500, 0.12, 'sawtooth', 0.06, 0, 300); tone(520, 0.12, 'sawtooth', 0.06, 0.16, 310); break;
    case 'secret': chord(523, [0, 4, 7, 12, 16], 0.6, 'triangle', 0.06); break;
    case 'teleport': tone(300, 0.35, 'sine', 0.05, 0, 1400); tone(1800, 0.3, 'triangle', 0.03, 0.12, 500); break;
    case 'glitch': for (let i = 0; i < 6; i++) tone(100 + Math.random() * 900, 0.05, 'square', 0.05, i * 0.04); break;
    case 'jump': tone(400, 0.12, 'sine', 0.03, 0, 650); break;
    case 'cast': tone(800, 0.25, 'sine', 0.04, 0, 200); break;
    case 'bite': tone(660, 0.1, 'square', 0.06); tone(660, 0.1, 'square', 0.06, 0.15); break;
    case 'attack': tone(160 + n * 30, 0.35, 'sawtooth', 0.07, 0, 60); tone(900 + n * 60, 0.15, 'triangle', 0.04, 0, 400); break;
    case 'hurt': tone(220, 0.2, 'square', 0.06, 0, 110); break;
    case 'jester': chord(392, [0, 3, 7, 10], 0.5, 'square', 0.04); break;
    case 'weather': chord(262, [0, 5, 9], 0.8, 'sine', 0.05); break;
    case 'announce': chord(196, [0, 7, 12, 16, 19], 1.6, 'triangle', 0.05); break;
    case 'join': chord(392, [0, 4, 7, 12], 0.4, 'triangle', 0.05); break;
    case 'bell': chord(880, [0, 12, 19, 24], 2.6, 'sine', 0.07); chord(440, [0, 7], 2.2, 'triangle', 0.05); break;
    case 'splash': for (let i = 0; i < 5; i++) tone(300 + Math.random() * 500, 0.18, 'sine', 0.04, i * 0.03, 120); break;
    case 'slam': tone(70, 0.5, 'sawtooth', 0.12, 0, 35); tone(140, 0.3, 'square', 0.05); break;
    // ____X____ and team null
    case 'sword': noise(0.12, 0.09, 0, 2600); tone(520, 0.08, 'triangle', 0.03, 0, 300); break;
    case 'axe': noise(0.18, 0.12, 0, 900); tone(160, 0.2, 'square', 0.05, 0, 70); break;
    case 'lunge': noise(0.25, 0.07, 0, 3800); tone(300, 0.2, 'sawtooth', 0.025, 0, 900); break;
    case 'smash': noise(0.7, 0.22, 0, 420); tone(60, 0.7, 'sawtooth', 0.14, 0, 28); tone(120, 0.4, 'square', 0.06, 0.02, 50); break;
    case 'gust': noise(0.5, 0.12, 0, 1600); tone(220, 0.45, 'sine', 0.05, 0, 900); break;
    case 'windthrow': noise(0.2, 0.05, 0, 2400); break;
    case 'throw': tone(700, 0.15, 'sine', 0.03, 0, 300); break;
    case 'pearl': tone(1400, 0.3, 'sine', 0.05, 0, 300); tone(300, 0.35, 'triangle', 0.04, 0.05, 1200); noise(0.25, 0.04, 0, 5000); break;
    case 'totem': for (let i = 0; i < 6; i++) tone(500 + i * 160, 0.5, 'sine', 0.05, i * 0.06); noise(0.8, 0.06, 0, 6000); break;
    case 'eat': noise(0.07, 0.06, 0, 1200 + Math.random() * 800); break;
    case 'burp': tone(140, 0.35, 'sawtooth', 0.06, 0, 90); tone(180, 0.3, 'square', 0.03, 0.03, 120); break;
    case 'block': tone(240, 0.12, 'square', 0.06, 0, 180); noise(0.1, 0.07, 0, 700); break;
    case 'bosshurt': tone(170, 0.18, 'sawtooth', 0.05, 0, 120); noise(0.12, 0.06, 0, 1100); break;
    case 'mobhurt': tone(260, 0.15, 'sawtooth', 0.04, 0, 180); break;
    case 'bossdie': tone(200, 1.2, 'sawtooth', 0.08, 0, 50); tone(400, 0.9, 'square', 0.04, 0.1, 80); break;
    case 'portal': tone(110, 1.4, 'sine', 0.05, 0, 160); tone(220, 1.2, 'triangle', 0.025, 0.2, 260); break;
    case 'glass': for (let i = 0; i < 5; i++) noise(0.15, 0.08, i * 0.05, 3000 + i * 600); break;
    case 'xspawn': tone(55, 2, 'sawtooth', 0.08, 0, 45); tone(82, 1.8, 'square', 0.04, 0.2, 70); noise(1.2, 0.05, 0, 600); break;
    case 'shieldup': tone(330, 0.12, 'triangle', 0.04, 0, 260); noise(0.08, 0.05, 0, 900); break;
    case 'shieldbreak': noise(0.35, 0.14, 0, 700); tone(180, 0.4, 'sawtooth', 0.06, 0, 70); break;
    case 'anvil': tone(1600, 0.25, 'triangle', 0.06); tone(2400, 0.4, 'sine', 0.04, 0.05); tone(1600, 0.25, 'triangle', 0.05, 0.3); break;
  }
}
