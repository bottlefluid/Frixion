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
  timeOfDay, dayProgress, weatherAt, weatherEndsAt, jesterHere, fmt, fmtTime, zalgo, movesFor, elementOf,
  FISH, FISHES, FISHING_SPOTS, catchFish, dailyStock, dayIndex, PICKUPS, DAILY_QUESTS, dailyQuests, SIDE_QUEST, BUILTIN_CODES,
} from './data.js';
import { buildAvatar, AuraFX, shirtColorFor } from './avatar.js';
import { createWorld, potionModel } from './world.js';
import { createNet } from './net.js';
import { createChat } from './chat.js';
import { createMusic } from './music.js';
import { castFx, hitTest } from './moves.js';
import { glowTex } from './avatar.js';
import { IC, potionArt, gearArt, fishArt, coinArt, starArt } from './icons.js';

const VERSION = '2.0';
const API = () => window.FrixionGameAPI;
const WALK = 16, JUMP = 24, GRAVITY = 72, STEP = 1.25, R = 0.6, H = 5;
const ROLL_ANIM_MS = 2600, ROLL_COOLDOWN_MS = 600;
const CAM_SENS = 0.0085;   // radians per pixel at sensitivity 1: quick, like Roblox
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
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__ocrngDebug = { state: () => G, interact: () => interact(), admin: a => adminAction(a), panel: id => openPanel(id), cut: key => cutscene(auraKey(key)), move: k => useMove(k), chat: t => G.chat && G.chat.system(t), spawn: id => spawnPickup(id, true) };
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
    <div class="oc-topleft"><button type="button" class="oc-sq oc-exit" title="Back to Frixion">${IC.close}</button><button type="button" class="oc-sq oc-chat-btn" title="Chat (/)">${IC.chat}</button></div>
    <div class="oc-menu">
      <button type="button" class="oc-sq" data-open="storage" title="Aura Storage">${IC.storage}</button>
      <button type="button" class="oc-sq" data-open="collection" title="Collection">${IC.collection}</button>
      <button type="button" class="oc-sq" data-open="inventory" title="Inventory">${IC.inventory}</button>
      <button type="button" class="oc-sq" data-open="quests" title="Quests">${IC.quests}<i class="oc-dot hidden"></i></button>
      <button type="button" class="oc-sq" data-open="stats" title="Stats">${IC.stats}</button>
      <button type="button" class="oc-sq" data-open="settings" title="Settings">${IC.settings}</button>
      <button type="button" class="oc-sq oc-admin-btn hidden" data-open="admin" title="Admin">${IC.admin}</button>
    </div>
    <div class="oc-players"></div>
    <div class="oc-bl">
      <div class="oc-buffs"></div>
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
      <div class="oc-hp hidden"><i></i><span>100</span></div>
      <div class="oc-abilities"></div>
      <button type="button" class="oc-pvp-btn">PvP: Off</button>
    </div>
    <div class="oc-lockmark hidden">${IC.lock}</div>
    <div class="oc-joy hidden"><span class="knob"></span></div>
    <button type="button" class="oc-jump hidden">Jump</button>
    <button type="button" class="oc-act hidden">E</button>
    <div class="oc-bubbles"></div>
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
  settings: { auto: false, quick: false, autoEquip: true, cutscenes: 'all', pvp: false, bubbles: true, sens: 1, vol: { music: 0.45, mine: 0.7, others: 0.5, sfx: 0.7 } },
  eggs: {}, effects: [], queued: [], rollBuffs: [], daily: { day: 0, bought: [] }, best: 'common', bestRarity: 2,
  quests: { day: 0, prog: {}, claimed: [], side: {} }, stats: { fish: 0, pickups: 0, potions: 0, kos: 0, moves: 0, playSecs: 0 }, found: {}, redeemed: {}, ownerGear: {},
  lastObby: 0, lastBell: 0, chest: false,
});
async function loadSave() {
  const api = API();
  G.saveRef = api.db.collection('rngSaves').doc(G.me.uid);
  let data = {};
  try { const d = await G.saveRef.get(); data = d.exists ? d.data() : {}; } catch (e) {}
  const b = blankSave(), s = { ...b, ...data };
  s.settings = { ...b.settings, ...(data.settings || {}), vol: { ...b.settings.vol, ...((data.settings || {}).vol || {}) } };
  if (data.settings && data.settings.sound === false) s.settings.vol.sfx = 0;
  s.quests = { ...b.quests, ...(data.quests || {}) }; s.quests.side = s.quests.side || {};
  s.stats = { ...b.stats, ...(data.stats || {}) };
  ['auras', 'fish', 'potions', 'items', 'eggs', 'found', 'redeemed', 'ownerGear'].forEach(k => { s[k] = s[k] || {}; });
  s.daily = s.daily || { day: 0, bought: [] };
  // older versions: the balance auras merged, a few potions were renamed
  for (const [k, n] of Object.entries(s.auras)) { const nk = auraKey(k).key; if (nk !== k) { s.auras[nk] = (s.auras[nk] || 0) + n; delete s.auras[k]; } }
  for (const [id, n] of Object.entries(s.potions)) { if (!POTION[id]) { const to = POTION_RENAMES[id]; if (to) s.potions[to] = (s.potions[to] || 0) + n; delete s.potions[id]; } }
  s.equipped = auraKey(s.equipped).key; s.best = auraKey(s.best).key;
  for (const k of Object.keys(s.auras)) if (s.auras[k] > 0) s.found[auraKey(k).aura.id] = true;
  G.save = s;
  G.effects = (s.effects || []).filter(e => e.until > now() && POTION[e.id]);
  G.queued = (s.queued || []).filter(id => POTION[id]);
  G.rollBuffs = (s.rollBuffs || []).filter(r => POTION[r.id] && r.left > 0);
  if (!s.auras[s.equipped] && !G.me.owner && s.equipped !== 'common') s.equipped = 'common';
  checkDay();
}
let saveTimer = 0;
function markDirty() { if (!G) return; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 3000); }
function saveNow() {
  if (!G || !G.saveRef || !G.save) return;
  clearTimeout(saveTimer);
  G.save.effects = G.effects.filter(e => e.until > now());
  G.save.queued = G.queued; G.save.rollBuffs = G.rollBuffs;
  G.save.name = G.me.name; G.save.bestRarity = auraKey(G.save.best).rarity;
  G.saveRef.set(JSON.parse(JSON.stringify(G.save))).catch(() => {});
}

// What you have. The Owner also has the Owner tabs, with everything.
const isOwner = () => G.me.owner;
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
function equip(key, silent) {
  const p = G.player;
  if (p.fx) p.fx.dispose();
  p.fx = new AuraFX(key, G.quality === 'low');
  p.avatar.fxHolder.add(p.fx.group);
  G.save.equipped = key;
  p.avatar.tag.userData.draw(G.me.name, key, p.pvp ? p.hp : null);
  G.moves = movesFor(key);
  renderAbilities();
  if (G.net) G.net.update({ aura: key });
  if (!silent) { toast(`Equipped ${auraKey(key).name}`); markDirty(); }
}

// ---------------- input: Roblox-style keyboard, mouse and touch ----------------
const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
function setupInput() {
  const k = G.input.keys, cvs = $q('.oc-canvas');
  if (document.activeElement && document.activeElement.blur && !G.root.contains(document.activeElement)) document.activeElement.blur();
  const typing = e => e.target && G.root.contains(e.target) && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && /^(text|search|number)$/.test(e.target.type)));
  on(window, 'keydown', e => {
    if (!G || !G.playing || typing(e)) return;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') { if (G.panel) closePanel(); else if (G.fishing) stopFishing(); e.stopImmediatePropagation(); return; }
    G.konami.push(key); if (G.konami.length > 10) G.konami.shift();
    if (G.konami.join() === KONAMI.join()) { G.konami = []; findEgg('konami'); }
    if (key === '/' && G.chat) { e.preventDefault(); e.stopImmediatePropagation(); G.chat.focus(); return; }
    if (key === 'tab') { e.preventDefault(); $q('.oc-players').classList.toggle('closed'); return; }
    if (e.repeat && ['e', 'r', 'f', 'z', 'x', 'c', 'v', 'shift'].includes(key)) return;
    k[key] = true;
    if (key === 'e') interact();
    if (key === 'r' && !G.panel) rollOnce();
    if (['z', 'x', 'c', 'v', 'f'].includes(key) && !G.panel) useMove(key);
    if (key === 'shift' && !G.player.fly && !G.touch) setShiftLock(!G.shiftLock);
    if ([' ', 'w', 'a', 's', 'd', 'e', 'r', 'f', 'q', 'z', 'x', 'c', 'v', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  on(window, 'keyup', e => { if (!G) return; k[e.key.toLowerCase()] = false; }, true);
  on(window, 'blur', () => { for (const x in k) k[x] = false; });
  // The camera turns as fast as the mouse moves: hold the right button (the cursor hides while you do), or drag with
  // the left one. Shift Lock keeps it turning without holding anything.
  let dragging = false;
  on(cvs, 'mousedown', e => {
    if (!G.playing) return;
    if (e.button === 2) { dragging = true; if (!G.shiftLock && cvs.requestPointerLock) cvs.requestPointerLock(); }
    if (e.button === 0) dragging = true;
  });
  on(window, 'mouseup', () => { dragging = false; if (!G.shiftLock && document.pointerLockElement === cvs) document.exitPointerLock(); });
  on(window, 'mousemove', e => {
    if (!G.playing || G.panel) return;
    if (!(dragging || G.shiftLock || document.pointerLockElement === cvs)) return;
    const s = CAM_SENS * (G.save.settings.sens || 1);
    G.cam.yaw -= e.movementX * s;
    G.cam.pitch = Math.max(-1.2, Math.min(1.35, G.cam.pitch + e.movementY * s));
  });
  on(document, 'pointerlockchange', () => { if (G && G.shiftLock && document.pointerLockElement !== cvs) setShiftLock(false); });
  on(cvs, 'contextmenu', e => e.preventDefault());
  on(cvs, 'wheel', e => { G.cam.zoom = Math.max(4, Math.min(48, G.cam.zoom + Math.sign(e.deltaY) * 3)); e.preventDefault(); }, { passive: false });
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
          const s = 0.014 * (G.save.settings.sens || 1);
          G.cam.yaw -= (t.clientX - last.x) * s; G.cam.pitch = Math.max(-1.2, Math.min(1.35, G.cam.pitch + (t.clientY - last.y) * s * 0.8)); last = { x: t.clientX, y: t.clientY };
        }
      }
      if (e.touches.length === 2 && pinch) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); G.cam.zoom = Math.max(4, Math.min(48, pinch.zoom * pinch.d / d)); }
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
  }
  on($q('.oc-exit'), 'click', () => close());
  on($q('.oc-title-exit'), 'click', () => close());
  on($q('.oc-play'), 'click', () => play());
  on($q('.oc-roll'), 'click', () => rollOnce());
  on($q('.oc-auto'), 'click', toggleAuto);
  on($q('.oc-quick'), 'click', toggleQuick);
  on($q('.oc-pvp-btn'), 'click', togglePvp);
  on($q('.oc-chat-btn'), 'click', () => G.chat && G.chat.focus());
  on($q('.oc-panel-x'), 'click', closePanel);
  on($q('.oc-panel'), 'click', e => { if (e.target.classList.contains('oc-panel')) closePanel(); });
  on($q('.oc-abilities'), 'click', e => { const b = e.target.closest('[data-move]'); if (b) useMove(b.dataset.move); });
  const endOffer = () => { G.offer = null; $q('.oc-rt-actions').classList.add('hidden'); $q('.oc-rolltext').classList.add('hidden'); };
  on($q('[data-eq]'), 'click', () => { if (G.offer) equip(G.offer); endOffer(); });
  on($q('[data-skip]'), 'click', endOffer);
  G.root.querySelectorAll('[data-open]').forEach(b => on(b, 'click', () => openPanel(b.dataset.open)));
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
  if (G.me.staff) $q('.oc-admin-btn').classList.remove('hidden');
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
    fx: f => { const fxo = castFx(G.scene, f); if (fxo) G.fxObjects.push(fxo); },
    announce: a => announce(a),
    world: w => { G.worldState = w; },
    denied: () => {
      if (!G || G.netDenied) return;
      G.netDenied = true;
      toast(G.me.staff ? 'Multiplayer is off: the Realtime Database rules need an "ocrng" section. You can still play solo.' : 'The lobby is closed right now, so you\'re playing solo. Your progress still saves.', 'warn');
    },
  });
  G.net.join({ name: G.me.name, aura: G.save.equipped, shirt: shirtColorFor(G.me.name), pvp: false, rolls: G.save.rolls });
  G.music = G.audio ? createMusic(G.audio) : null;
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
  o.avatar.tag.userData.draw(d.name || uid, o.key, d.pvp ? (o.hp ?? 100) : null);
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
  const dt = Math.min(0.05, G.clock.getDelta()), t = G.clock.elapsedTime, n = now();
  const env = G.env, ws = G.worldState || {};
  const time = timeOfDay(n, ws), weather = weatherAt(n, ws), jester = jesterHere(n, ws);
  if (G.playing) {
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
  p.fx && p.fx.update(dt, t);
  G.world.update(dt, t, { ...env, camPos: G.camera.position, player: p.pos });
  G.fxObjects = G.fxObjects.filter(f => f.update(dt));
  if (G.fishing) fishingTick(dt);
  if (G.playing) {
    if (G.save.settings.auto && canAuto() && !G.rolling && !G.cutting && n >= G.nextRollAt) rollOnce();
    if (G.net) G.net.sendPos({ x: p.pos.x, y: p.pos.y, z: p.pos.z, r: p.yaw, a: p.moving ? 1 : 0, hp: p.pvp ? p.hp : -1 });
    if ((G.hudTick = (G.hudTick || 0) + dt) > 0.25) { G.hudTick = 0; updateHud(); updateAbilityCds(); }
    const b = buffs();
    $q('.oc-roll-cd').style.transform = `scaleX(${G.rolling ? 1 : Math.max(0, Math.min(1, (G.nextRollAt - n) / (ROLL_COOLDOWN_MS / b.speed)))})`;
    updateBubbles();
  }
  if ((G.zalgoTick = (G.zalgoTick || 0) + dt) > 0.15) { G.zalgoTick = 0; G.root.querySelectorAll('.oc-tier.t-null').forEach(el => { el.textContent = zalgo('null'); }); }
  if (weather !== G.filterFor) { G.filterFor = weather; G.renderer.domElement.style.filter = weather === 'null' ? 'grayscale(.85) contrast(1.15)' : ''; }
  G.renderer.render(G.scene, G.camera);
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
  if (G.player.emoteUntil && G.player.emoteUntil < now()) { G.player.emote = null; G.player.emoteUntil = 0; if (G.net) G.net.update({ emote: null }); }
}

function movePlayer(dt) {
  const p = G.player, k = G.input.keys, j = G.input.joy, n = now();
  let fx = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0) + j.x;
  let fz = (k.s || k.arrowdown ? 1 : 0) - (k.w || k.arrowup ? 1 : 0) + j.y;
  if ((G.panel && !G.touch) || G.fishing || (G.chat && G.chat.typing)) { fx = 0; fz = 0; }
  const m = Math.min(1, Math.hypot(fx, fz));
  const yaw = G.cam.yaw;
  const dirX = fx * Math.cos(yaw) + fz * Math.sin(yaw), dirZ = -fx * Math.sin(yaw) + fz * Math.cos(yaw);
  const flying = p.fly || p.flyUntil > n;
  const speed = WALK * (flying ? 2.4 : 1);
  if (m > 0.05) { const len = Math.hypot(dirX, dirZ) || 1; p.vel.x = dirX / len * speed * m; p.vel.z = dirZ / len * speed * m; }
  else { p.vel.x = 0; p.vel.z = 0; }
  const want = G.shiftLock ? yaw + Math.PI : m > 0.05 ? Math.atan2(p.vel.x, p.vel.z) : p.yaw;
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
  if (p.pos.y < -60) { p.pos.copy(G.world.spawn); p.vel.set(0, 0, 0); toast('You fell out of the world. Back to spawn.'); }
  p.avatar.animate(dt, Math.hypot(p.vel.x, p.vel.z), !p.onGround && !flying, p.emote);
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
function updateCamera(dt, t) {
  const cam = G.camera;
  if (G.titleCam) {
    const a = t * 0.06;
    cam.position.set(-20 + Math.cos(a) * 95, 42 + Math.sin(t * 0.2) * 4, Math.sin(a) * 80);
    cam.lookAt(-30, 10, -10);
    return;
  }
  const p = G.player.pos, c = G.cam, s = G.player.scale;
  c.dist += (c.zoom * Math.max(0.6, s) - c.dist) * Math.min(1, dt * 18);
  const target = new THREE.Vector3(p.x, p.y + 4.5 * s, p.z);
  if (G.shiftLock) target.add(new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw)).multiplyScalar(1.75));
  // like Roblox, the camera slides in when a wall is between it and you
  const dir = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch));
  let reach = c.dist;
  for (const b of G.world.colliders) { if (b.water || b.cam === false) continue; const hit = rayBox(target, dir, b.min, b.max, reach); if (hit !== null) reach = hit; }
  cam.position.copy(target).addScaledVector(dir, Math.max(1.2, reach - 0.35));
  if (cam.position.y < 0.6) cam.position.y = 0.6;
  cam.lookAt(target);
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
    o.avatar.animate(dt, o.anim ? Math.max(sp, 8) : 0, o.target.y - o.pos.y > 0.5, o.data && o.data.emote);
    if (o.fx) o.fx.update(dt, t);
    if (o.data && o.data.pvp && o.hp !== o.lastHp) { o.lastHp = o.hp; o.avatar.tag.userData.draw(o.data.name || o.uid, o.key, o.hp < 0 ? 100 : o.hp); }
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
  const emote = name => { p.emote = name; p.emoteUntil = now() + 6000; if (G.net) G.net.update({ emote: name }); return true; };
  if (cmd === 'help') { G.chat.system('/e dance, /e wave: emotes. /clear: clear the chat. Press Tab for the player list.', '#bdbdbd'); return true; }
  if (cmd === 'e' || cmd === 'emote') { const e = (args[0] || '').toLowerCase(); if (e === 'dance' || e === 'wave') return emote(e); G.chat.system('Emotes: /e dance, /e wave', '#bdbdbd'); return true; }
  if (cmd === 'dance' || cmd === 'wave') return emote(cmd);
  if (cmd === 'clear') { G.chat.el.querySelector('.oc-chat-log').innerHTML = ''; return true; }
  if (cmd === 'sol') { G.chat.system('[???]: The sun remembers every roll.', '#ffca28'); return true; }
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
  return true;
}
function checkPlaces() {
  const p = G.player.pos;
  let near = null;
  for (const [id, pl] of Object.entries(G.world.places)) {
    if (Math.hypot(p.x - pl.pos.x, p.z - pl.pos.z) >= pl.r || Math.abs(p.y - pl.pos.y) >= 4 || !placeActive(id)) continue;
    if (pl.auto) { if (id === 'obby') finishObby(); continue; }
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
  if (id === 'portal_stella') return glitchTo(G.world.stellaCamp, 'The portal takes you to Stella.');
  if (id === 'portal_back') return glitchTo(G.world.caveMouth, 'Back outside the mountain.');
  if (id === 'chest') return openChest();
  if (id.startsWith('card')) return pickCard(id);
  if (id === 'questboard') return openPanel('quests');
  openPanel(id);
}
const EGGS = ['duck', 'cave', 'tower', 'glitch', 'sun', 'summit', 'crystal', 'graveyard', 'moonsun', 'konami', 'devpc'];
const EGG_INFO = {
  duck: ['the rubber duck', { coins: 500 }], cave: ['the Dev Room', { coins: 1500 }], tower: ['the top of the tower', { coins: 2500 }], glitch: ['the glitch', { void: 1 }],
  sun: ['the sun statue', { coins: 1000 }], summit: ['the top of the mountain', { potions: { fortune2: 1 } }], crystal: ['the hidden crystal room', { coins: 3000 }],
  graveyard: ['the graveyard at night', { potions: { zombie: 1 } }], moonsun: ['the sun asleep at night', { potions: { fortune1: 2 } }], konami: ['an old cheat code', { potions: { lucky: 5 } }],
  devpc: ['secret.exe', { coins: 1337 }],
};
function findEgg(id) {
  if (!G || G.save.eggs[id]) return;
  G.save.eggs[id] = true;
  const [name, reward] = EGG_INFO[id];
  const got = giveReward(reward);
  toast(`Secret found: ${name} (${Object.keys(G.save.eggs).filter(e => EGGS.includes(e)).length}/${EGGS.length}). ${got}`, 'gold');
  sound(id === 'duck' ? 'quack' : 'secret');
  markDirty();
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
  G.world.setPortals(side.stella === 'done');
  G.world.setChest(!!G.save.chest);
  const vis = {}; if (cards.state === 'active') ['card1', 'card2', 'card3'].forEach(id => { vis[id] = !(cards.found || []).includes(id); });
  G.world.setCards(vis);
}

// ---------------- things lying on the ground ----------------
function pickupKind(def) {
  if (def.kind === 'potion') return { model: () => potionModel(POTION[def.id].color, 1), color: POTION[def.id].color };
  if (def.kind === 'star') return { model: () => { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), new THREE.MeshStandardMaterial({ color: '#e3f2ff', emissive: '#9fd0ff', emissiveIntensity: 1 })); return m; }, color: def.color };
  return { model: () => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.18, 20), new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.3 })); m.rotation.x = Math.PI / 2; const g = new THREE.Group(); g.add(m); return g; }, color: def.color };
}
function spawnPickup(forceId, near) {
  const env = G.env, side = G.save.quests.side;
  const pool = PICKUPS.filter(d => (!d.weather || d.weather === env.weather) && (!d.night || env.time === 'night') && (d.id !== 'stellastar' || side.stella === 'active'));
  let def = forceId ? PICKUPS.find(d => d.id === forceId) : null;
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
  G.save.stats.pickups++; progress('pickups'); markDirty(); updateHud();
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
  for (const r of G.rollBuffs) { const p = POTION[r.id]; if (p.rollSpeed) b.speed += p.rollSpeed.speed; }
  b.luck = Math.max(0.1, b.luck); b.speed = Math.max(0.25, b.speed);
  return b;
}
const tenthRoll = () => (G.save.rolls + 1) % 10 === 0;
function luckNow(b = buffs()) {
  let luck = b.luck * (tenthRoll() ? 2 : 1);
  for (const r of G.rollBuffs) { const p = POTION[r.id]; if (p.boost) luck += p.boost.l; }
  return luck;
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

// ---------------- rolling ----------------
async function rollOnce() {
  if (!G || !G.playing || G.rolling || G.cutting || G.portraitBlock || now() < G.nextRollAt) return;
  G.rolling = true;
  const b = buffs();
  let luck = luckNow(b), used = null;
  if (G.queued.length) { used = G.queued.shift(); luck += POTION[used].oneRoll; }
  G.rollBuffs.forEach(r => { r.left--; }); G.rollBuffs = G.rollBuffs.filter(r => r.left > 0);
  const res = rollAura(luck, G.env.time, G.env.weather, { gem: b.gem, mut: b.mut, anyWeather: b.anyWeather });
  const s = G.save;
  s.rolls++;
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
    else if (!quick) await rollAnimation(res, b.speed);
    if (G) showResult(res, quick);
  } finally {
    if (G) {
      const rarer = res.rarity > auraKey(s.equipped).rarity;
      if (rarer && s.settings.autoEquip) equip(res.key, true);
      else if (rarer && !s.settings.auto) offerEquip(res.key);
      if (res.rarity >= 100000 && G.net) G.net.announce({ name: G.me.name, key: res.key, rarity: res.rarity });
      G.nextRollAt = now() + ROLL_COOLDOWN_MS / b.speed;
      G.rolling = false;
      updateHud();
    }
  }
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
  pickMusic();
  if (G.music) G.music.sting(48 + tierIndex(res.rarity), tierIndex(res.rarity) >= 6);
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

// ---------------- the HUD ----------------
function updateHud() {
  if (!G || !G.save) return;
  const s = G.save, env = G.env, n = now(), b = buffs(), ws = G.worldState || {};
  const luck = luckNow(b);
  // bottom left, like Sol's: the biome in brackets, the time of day, then money
  const w = WEATHERS[env.weather] || WEATHERS.clear;
  const left = env.weather !== 'clear' ? weatherEndsAt(n, ws) - n : 0;
  $q('.oc-biome').innerHTML = `<span style="color:${w.color}">[ ${w.name.toUpperCase()} ]</span>${left > 0 ? `<small>${fmtTime(left)}</small>` : ''}`;
  $q('.oc-daytime').textContent = env.time === 'day' ? 'DAYTIME' : 'NIGHTTIME';
  $q('.oc-luckline').innerHTML = `Luck <b>${x2(luck)}x</b><span class="sep"></span>Speed <b>${x2(b.speed)}x</b>`;
  $q('.oc-money').innerHTML = `<span class="oc-pill coin">$ ${fmt(s.coins)}</span><span class="oc-pill f">F ${fmt(s.f)}</span>${s.void ? `<span class="oc-pill void">V ${fmt(s.void)}</span>` : ''}`;
  const chips = activeEffects().filter((e, i, arr) => arr.findIndex(x => x.id === e.id && !x.out === !e.out) === i).map(e => { const p = POTION[e.id]; return `<div class="oc-buff" title="${esc(e.out ? p.name + ': ' + e.out.name : p.name)}">${potionArt(p)}<b>${fmtTime(e.until - n)}</b></div>`; });
  G.queued.forEach(id => chips.push(`<div class="oc-buff next" title="${esc(POTION[id].name)}">${potionArt(POTION[id])}<b>next</b></div>`));
  G.rollBuffs.forEach(r => chips.push(`<div class="oc-buff next" title="${esc(POTION[r.id].name)}">${potionArt(POTION[r.id])}<b>${fmt(r.left)}</b></div>`));
  const buffsEl = $q('.oc-buffs'), html = chips.join('');
  if (buffsEl.dataset.h !== html) { buffsEl.innerHTML = html; buffsEl.dataset.h = html; }
  // the Roll button counts towards the bonus roll: 9/10 means the next one is twice as lucky
  const c = s.rolls % 10;
  $q('.oc-roll-count').textContent = `${c}/10`;
  $q('.oc-roll').classList.toggle('bonus', c === 9);
}
function renderPlayers() {
  const el = $q('.oc-players');
  const rows = [];
  const roster = G.net && G.net.roster ? G.net.roster : {};
  const list = Object.entries(roster).map(([uid, d]) => ({ uid, name: d.name || uid, rolls: uid === G.me.uid ? G.save.rolls : d.rolls || 0, aura: uid === G.me.uid ? G.save.equipped : d.aura }));
  if (!list.some(r => r.uid === G.me.uid)) list.push({ uid: G.me.uid, name: G.me.name, rolls: G.save.rolls, aura: G.save.equipped });
  list.sort((a, b) => b.rolls - a.rolls);
  for (const r of list.slice(0, 12)) {
    const a = auraKey(r.aura || 'common');
    rows.push(`<div class="oc-pl-row${r.uid === G.me.uid ? ' me' : ''}"><span class="n">${esc(r.name)}</span><span class="r">${fmt(r.rolls)}</span><span class="a" style="color:${a.mut ? a.mut.color : a.aura.c}">${esc(a.name)}</span></div>`);
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
function announce(a) {
  const { aura, mut, name, rarity } = auraKey(a.key);
  if (G.chat) G.chat.system(`[Server]: ${a.name} HAS FOUND ${name.toUpperCase()}, CHANCE OF 1 IN ${fmt(rarity)}`, mut ? mut.color : aura.c === '#ffffff' ? '#e0e0e0' : aura.c);
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
function renderAbilities() {
  const el = $q('.oc-abilities');
  if (!el) return;
  el.innerHTML = G.moves.map(m => `<button type="button" class="oc-ab" data-move="${m.key}" style="--c:${m.color}"><kbd>${m.key.toUpperCase()}</kbd><span>${esc(m.name)}</span><i class="cd"></i></button>`).join('');
  el.classList.toggle('hidden', !G.moves.length);
}
function updateAbilityCds() {
  const n = now();
  G.root.querySelectorAll('.oc-ab').forEach(b => {
    const m = G.moves.find(x => x.key === b.dataset.move); if (!m) return;
    const left = Math.max(0, (G.moveCd[m.key] || 0) - n), k = left / (m.cd * 1000);
    b.classList.toggle('cooling', left > 0);
    b.querySelector('.cd').style.transform = `scaleY(${k})`;
  });
}
function useMove(key) {
  if (!G || !G.playing || G.portraitBlock) return;
  const m = G.moves.find(x => x.key === key);
  if (!m) return;
  const n = now();
  if ((G.moveCd[key] || 0) > n) return;
  G.moveCd[key] = n + m.cd * 1000;
  const p = G.player, yaw = p.yaw, d = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const f = { kind: m.kind, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), yaw: +yaw.toFixed(3), c: m.color, tier: m.tier, r: m.r, len: m.len, w: m.w, dist: m.dist, n: m.n, range: m.range, dur: m.dur, seed: Math.floor(Math.random() * 1e6) };
  if (m.kind === 'dash') { p.dash = { x: d.x * m.dist * 4, z: d.z * m.dist * 4, t: 0.22 }; Object.assign(f, { x2: p.pos.x + d.x * m.dist, y2: p.pos.y, z2: p.pos.z + d.z * m.dist }); }
  if (m.kind === 'blink') { const to = p.pos.clone().add(new THREE.Vector3(d.x * m.dist, 0.5, d.z * m.dist)); Object.assign(f, { x2: to.x, y2: to.y, z2: to.z }); p.pos.copy(to); p.vel.set(0, 0, 0); }
  if (m.kind === 'leap') { p.vel.y = Math.sqrt(2 * GRAVITY * m.h); p.onGround = false; p.dash = { x: d.x * m.dist * 1.6, z: d.z * m.dist * 1.6, t: 0.6 }; Object.assign(f, { x2: p.pos.x + d.x * m.dist, y2: p.pos.y + m.h, z2: p.pos.z + d.z * m.dist }); }
  if (m.kind === 'flight') { p.flyUntil = n + m.dur * 1000; toast(`${m.name}: you can fly for ${m.dur} seconds. Space goes up, Q goes down.`); }
  Object.keys(f).forEach(k => { if (f[k] === undefined || Number.isNaN(f[k])) delete f[k]; });   // the database refuses empty values
  const fx = castFx(G.scene, f); if (fx) G.fxObjects.push(fx);
  if (G.net) {
    G.net.fx(f);
    if (p.pvp && m.dmg) {
      const targets = [...G.others.values()].filter(o => o.placed && o.data && o.data.pvp);
      for (const h of hitTest(f, targets)) G.net.hit(h.uid, { dmg: m.dmg, kx: h.kx, kz: h.kz, by: G.me.name, aura: auraKey(G.save.equipped).name, move: m.name });
    }
  }
  G.save.stats.moves++; progress('moves');
  sound('attack', m.tier);
  updateAbilityCds();
}
function togglePvp() {
  const p = G.player;
  p.pvp = !p.pvp; p.hp = 100;
  const b = $q('.oc-pvp-btn'); b.textContent = p.pvp ? 'PvP: On' : 'PvP: Off'; b.classList.toggle('on', p.pvp);
  $q('.oc-hp').classList.toggle('hidden', !p.pvp);
  updateHp();
  p.avatar.tag.userData.draw(G.me.name, G.save.equipped, p.pvp ? p.hp : null);
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
  p.hp -= h.dmg || 0;
  p.knock = { x: h.kx || 0, z: h.kz || 0 }; p.vel.y = 12; p.onGround = false;
  G.root.classList.remove('oc-hurt'); void G.root.offsetWidth; G.root.classList.add('oc-hurt');
  sound('hurt');
  if (p.hp <= 0) {
    toast(`${h.by || 'Someone'} knocked you out with ${h.move || h.aura || 'their aura'}.`, 'warn');
    if (G.net && h.from) G.net.hit(h.from, { ko: true, by: G.me.name });
    p.hp = 100; p.pos.copy(G.world.spawn); p.vel.set(0, 0, 0); p.knock = null;
  }
  updateHp();
  p.avatar.tag.userData.draw(G.me.name, G.save.equipped, p.hp);
}

// ---------------- panels ----------------
const TITLES = { storage: 'Aura Storage', collection: 'Collection', inventory: 'Inventory', quests: 'Quests', stats: 'Stats', settings: 'Settings', admin: 'Admin',
  mari: 'Mari', jester: 'The Jester', finn: 'Old Finn', marlin: 'Marlin\'s Fish Market', nova: 'Nova\'s Daily Shop', stella: 'Stella', ghost: 'The Ghost', devpc: 'Terminal' };
function openPanel(id) {
  if (G.fishing) stopFishing();
  G.panel = id;
  const box = $q('.oc-panel'), body = box.querySelector('.oc-panel-body');
  box.classList.remove('hidden');
  box.dataset.panel = id;
  box.querySelector('h2').textContent = TITLES[id] || '';
  body.scrollTop = 0;
  ({ storage: renderStorage, collection: renderCollection, inventory: renderInventory, quests: renderQuests, stats: renderStats, settings: renderSettings, admin: renderAdmin,
    mari: () => renderShop('mari'), jester: () => renderShop('jester'), finn: () => renderShop('finn'), marlin: renderMarlin, nova: renderDaily, stella: renderStella, ghost: renderGhost, devpc: renderTerminal })[id](body);
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
const onlyText = a => a.only ? (a.only.time ? (a.only.time === 'day' ? 'Only during the day' : 'Only at night') : `Only in ${WEATHERS[a.only.weather].name}`) : a.native ? `${WEATHERS[a.native].name}: ${WEATHERS[a.native].bt}x as likely` : '';

// The Sol's-style storage screen: information on the left, a grid of tiles on the right.
function storageLayout(body, { tabs, tab, tiles, info, onTab, after, search = true }) {
  body.innerHTML = `<div class="oc-store"><div class="oc-info"><div class="oc-info-title">[ Information ]</div><div class="oc-info-body"></div></div>
    <div class="oc-store-main"><div class="oc-store-top">${search ? '<label class="oc-search">' + IC.search + '<input type="search" placeholder="Search..."></label>' : ''}${tabs ? tabsHtml(tabs, tab) : ''}</div><div class="oc-grid"></div></div></div>`;
  const grid = body.querySelector('.oc-grid'), infoEl = body.querySelector('.oc-info-body');
  let sel = G.sel && tiles.find(t => t.id === G.sel) ? G.sel : tiles[0] && tiles[0].id;
  const draw = (q = '') => {
    const list = tiles.filter(t => !q || t.search.includes(q.toLowerCase()));
    grid.innerHTML = list.length ? list.map(t => `<button type="button" class="oc-tile${t.id === sel ? ' sel' : ''}${t.eq ? ' eq' : ''}${t.locked ? ' locked' : ''}" data-id="${esc(t.id)}">${t.html}${t.count != null ? `<b class="oc-tile-n">${t.count}</b>` : ''}</button>`).join('') : '<p class="oc-empty">Nothing here yet.</p>';
    grid.querySelectorAll('.oc-tile').forEach(b => b.onclick = () => { sel = G.sel = b.dataset.id; grid.querySelectorAll('.oc-tile').forEach(x => x.classList.toggle('sel', x === b)); showInfo(); });
    if (after) after(grid);
  };
  const showInfo = () => { const t = tiles.find(x => x.id === sel); infoEl.innerHTML = ''; if (t) info(t, infoEl); else infoEl.innerHTML = '<p class="oc-empty">Pick something on the right.</p>'; };
  draw(); showInfo();
  const s = body.querySelector('.oc-search input'); if (s) s.oninput = () => draw(s.value.trim());
  body.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { G.sel = null; onTab(b.dataset.tab); });
}
function auraTile(key, opts = {}) {
  const r = auraKey(key);
  return { id: r.key, search: r.name.toLowerCase(), eq: G.save.equipped === r.key, count: opts.count, locked: opts.locked, html: `<span class="oc-tile-name" data-paint="${esc(r.key)}"${opts.locked ? ' data-hide="1"' : ''}></span>`, r };
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
    ${moves.length && !hidden ? `<div class="oc-moves">${moves.map(m => `<div><kbd>${m.key.toUpperCase()}</kbd>${esc(m.name)}${m.dmg ? `<small>${m.dmg} dmg</small>` : '<small>move</small>'}</div>`).join('')}</div>` : ''}
    <div class="oc-info-actions"></div>`;
  paintName(el.querySelector('.oc-info-name'), hidden ? '???' : r.name, r, 'oc-info-name');
  const actions = el.querySelector('.oc-info-actions');
  if ((auraCount(r.key) > 0 || owner) && !hidden) {
    const eq = G.save.equipped === r.key;
    actions.innerHTML = `<button type="button" class="oc-btn ${eq ? 'bad' : 'ok'}">${eq ? 'Unequip' : 'Equip'}</button>`;
    actions.firstChild.onclick = () => { equip(eq ? 'common' : r.key); rerender(); };
  }
}
function renderStorage(body, tab = G.storeTab || 'storage') {
  G.storeTab = tab;
  const tabs = isOwner() ? [['storage', 'Storage'], ['owner', 'Owner']] : null;
  if (tab === 'owner' && !isOwner()) tab = 'storage';
  const keys = tab === 'owner' ? AURAS.map(a => a.id) : Object.keys(G.save.auras).filter(k => G.save.auras[k] > 0);
  const tiles = keys.map(k => auraTile(k, { count: tab === 'owner' ? null : fmt(auraCount(k)) })).sort((a, b) => b.r.rarity - a.r.rarity);
  storageLayout(body, { tabs, tab, tiles, after: paintTiles, info: (t, el) => auraInfo(t, el, { owner: tab === 'owner' }), onTab: tb => renderStorage(body, tb) });
}
function renderCollection(body) {
  const found = G.save.found;
  const tiles = [...AURAS].sort((a, b) => b.rarity - a.rarity).map(a => auraTile(a.id, { locked: !found[a.id] }));
  storageLayout(body, { tiles, after: paintTiles, info: (t, el) => auraInfo(t, el, {}), onTab: () => {} });
  body.querySelector('.oc-store-top').insertAdjacentHTML('beforeend', `<div class="oc-found">Found ${Object.keys(found).filter(id => AURA[id]).length}/${AURAS.length}</div>`);
}
function renderInventory(body, tab = G.invTab || 'potions') {
  G.invTab = tab;
  if (tab === 'owner' && !isOwner()) tab = 'potions';
  const tabs = [['potions', 'Potions'], ['gear', 'Gear'], ['fish', 'Fish']];
  if (isOwner()) tabs.push(['owner', 'Owner']);
  let tiles = [], info;
  if (tab === 'potions' || tab === 'owner') {
    const list = tab === 'owner' ? POTIONS.filter(p => !p.hidden) : POTIONS.filter(p => potionCount(p.id) > 0);
    tiles = list.map(p => ({ id: 'p:' + p.id, search: p.name.toLowerCase(), count: tab === 'owner' ? '∞' : fmt(potionCount(p.id)), html: potionArt(p, 'oc-tile-art'), p }));
    if (tab === 'owner') tiles.push(...ITEMS.map(i => ({ id: 'g:' + i.id, search: i.name.toLowerCase(), eq: !!G.save.ownerGear[i.id], html: gearArt(i, 'oc-tile-art'), g: i })));
    info = (t, el) => {
      if (t.g) {
        const onNow = !!G.save.ownerGear[t.g.id];
        el.innerHTML = `${gearArt(t.g, 'oc-info-art')}<div class="oc-info-title2">${esc(t.g.name)}</div><div class="oc-info-line dim">${esc(t.g.desc)}</div><div class="oc-info-actions"><button type="button" class="oc-btn ${onNow ? 'bad' : 'ok'}">${onNow ? 'Unequip' : 'Equip'}</button></div>`;
        el.querySelector('button').onclick = () => { G.save.ownerGear[t.g.id] = !onNow; markDirty(); updateHud(); rerender(); };
        return;
      }
      const p = t.p, free = tab === 'owner';
      el.innerHTML = `${potionArt(p, 'oc-info-art')}<div class="oc-info-title2">${esc(p.name)}</div><div class="oc-info-line dim">${esc(p.desc)}</div>
        ${free ? '' : `<div class="oc-info-line">Owned: <b>${fmt(potionCount(p.id))}</b></div>`}<div class="oc-info-actions"><button type="button" class="oc-btn ok" data-u="1">Use</button>${free || potionCount(p.id) >= 10 ? '<button type="button" class="oc-btn" data-u="10">Use 10</button>' : ''}</div>`;
      el.querySelectorAll('[data-u]').forEach(b => b.onclick = () => { for (let i = 0; i < +b.dataset.u; i++) if (!usePotion(p.id, free)) break; rerender(); });
    };
  } else if (tab === 'gear') {
    tiles = ITEMS.filter(i => G.save.items[i.id]).map(i => ({ id: 'g:' + i.id, search: i.name.toLowerCase(), html: gearArt(i, 'oc-tile-art'), g: i }));
    info = (t, el) => { el.innerHTML = `${gearArt(t.g, 'oc-info-art')}<div class="oc-info-title2">${esc(t.g.name)}</div><div class="oc-info-line dim">${esc(t.g.desc)}</div><div class="oc-info-line ok">Active while you own it</div>`; };
  } else {
    tiles = FISH.filter(f => (G.save.fish[f.id] || 0) > 0).map(f => ({ id: 'f:' + f.id, search: f.name.toLowerCase(), count: fmt(G.save.fish[f.id]), html: fishArt(f.color, 'oc-tile-art'), f }));
    info = (t, el) => { el.innerHTML = `${fishArt(t.f.color, 'oc-info-art')}<div class="oc-info-title2">${esc(t.f.name)}</div><div class="oc-info-line dim">${t.f.junk ? 'Worth nothing. Marlin takes it anyway.' : `Marlin pays ${t.f.value} F each.`}</div><div class="oc-info-line">Owned: <b>${fmt(G.save.fish[t.f.id])}</b></div>`; };
  }
  storageLayout(body, { tabs, tab, tiles, info, onTab: tb => renderInventory(body, tb) });
}
// Using a potion. free: the Owner tab (nothing is used up).
function usePotion(id, free = false) {
  let p = POTION[id];
  if (!p || (!free && potionCount(id) < 1)) return false;
  if (p.group) {
    const other = activeEffects().find(e => POTION[e.id].group === p.group && e.id !== id);
    if (other) { toast(`${POTION[other.id].name} is already working. Only one of those at a time.`, 'warn'); return false; }
  }
  if (!free) G.save.potions[id] = potionCount(id) - 1;
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
  else if (p.rollSpeed || p.boost) { G.rollBuffs.push({ id, left: (p.rollSpeed || p.boost).n }); toast(`${p.name} works on your next ${fmt((p.rollSpeed || p.boost).n)} rolls.`, 'gold'); }
  else { addEffect(id); toast(`${p.name} is working.`, 'gold'); }
  G.save.stats.potions++; progress('potions');
  sound('potion'); markDirty(); updateHud();
  return true;
}

// ---------------- shops and people ----------------
const SHOPS = {
  mari: { intro: 'Hello, dear. Potions for luck and speed, and gear that lasts.', potions: ['lucky', 'luckl', 'luckxl', 'speed', 'speedl', 'speedxl', 'spoid1', 'spoid2', 'spoid3', 'mixed'], items: ['gloves', 'boots', 'solarlens', 'moonlocket'] },
  finn: { intro: 'Rods and a brew for divers. I only take F.', potions: ['diver'], items: ['goldrod', 'voidlantern'], quest: 'summit' },
  jester: { intro: 'Strange things for strange people. Five Void Coins, and I will give you something... oblivious.', potions: ['strange1', 'strange2', 'bound', 'heavenly', 'oblivion'], items: [], quest: 'cards' },
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
    <div class="oc-list">${sh.potions.map(p => row(POTION[p], false)).join('')}${sh.items.map(i => row(ITEM[i], true)).join('')}</div>`;
  body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { const [kind, tid] = b.dataset.buy.split(':'); buy(kind, tid); renderShop(id, body); });
  wireQuestCards(body);
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
    q.claimed.push(d.id);
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
  if (tab === 'controls') html = `<label class="oc-slider"><span>Camera Sensitivity</span><input type="range" min="25" max="300" value="${Math.round((s.sens || 1) * 100)}" data-sens><b>${(s.sens || 1).toFixed(2)}x</b></label>
    <div class="oc-keys"><b>Keys</b><span>WASD: move. Space: jump. Hold right mouse: turn the camera. Wheel: zoom. Shift: Shift Lock.</span><span>R: roll. E: talk, fish, use. Z X C V: aura moves. F: mobility move. /: chat. Tab: player list.</span></div>`;
  if (tab === 'misc') html = `${check('bubbles', 'Chat bubbles over heads')}
    <div class="oc-set-row"><b>PvP Mode</b><button type="button" class="oc-btn sm ${G.player.pvp ? 'bad' : ''}" data-pvp>${G.player.pvp ? 'On' : 'Off'}</button></div>
    <div class="oc-set-row"><b>Graphics</b>${['low', 'medium', 'high'].map(q => `<button type="button" class="oc-btn sm ${q === G.quality ? 'ok' : ''}" data-q="${q}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div>
    <p class="oc-empty">Graphics changes apply the next time you open the game.</p>
    <div class="oc-set-row"><b>Redeem Code</b><button type="button" class="oc-btn sm" data-code>Open</button></div>
    <div class="oc-code hidden"><input type="text" maxlength="32" placeholder="Enter Code..." spellcheck="false" autocomplete="off"><button type="button" class="oc-btn ok sm" data-redeem>Redeem</button></div>`;
  body.innerHTML = tabsHtml([['rolling', 'Rolling'], ['sound', 'Sound'], ['controls', 'Controls'], ['misc', 'Miscellaneous']], tab) + `<div class="oc-set">${html}</div>`;
  body.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => renderSettings(body, b.dataset.tab));
  body.querySelectorAll('[data-s]').forEach(c => c.onchange = () => { s[c.dataset.s] = c.checked; markDirty(); });
  body.querySelectorAll('[data-cut]').forEach(b => b.onclick = () => { s.cutscenes = b.dataset.cut; markDirty(); renderSettings(body); });
  body.querySelectorAll('[data-v]').forEach(r => r.oninput = () => { s.vol[r.dataset.v] = r.value / 100; r.nextElementSibling.textContent = r.value; if (r.dataset.v === 'sfx') sound('tick', 600); pickMusic(); markDirty(); });
  const sens = body.querySelector('[data-sens]'); if (sens) sens.oninput = () => { s.sens = sens.value / 100; sens.nextElementSibling.textContent = s.sens.toFixed(2) + 'x'; markDirty(); };
  const pvp = body.querySelector('[data-pvp]'); if (pvp) pvp.onclick = () => { togglePvp(); renderSettings(body); };
  body.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { try { localStorage.setItem('ocrng.quality', b.dataset.q); } catch (e) {} body.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('ok', x === b)); });
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
function renderAdmin(body) {
  if (!G.me.staff) { body.innerHTML = ''; return; }
  const ws = G.worldState || {}, n = now();
  const btn = (act, label, onNow) => `<button type="button" class="oc-btn sm ${onNow ? 'ok' : ''}" data-a="${act}">${label}</button>`;
  const potionOpts = POTIONS.filter(p => !p.hidden).map(p => `<option value="potion:${p.id}">${esc(p.name)}</option>`).join('');
  const gearOpts = ITEMS.map(i => `<option value="item:${i.id}">${esc(i.name)} (gear)</option>`).join('');
  body.innerHTML = `<div class="oc-admin">
    <h3>Biome <small>5 minutes, for everyone</small></h3><div class="oc-admin-row">${Object.values(WEATHERS).filter(w => w.id !== 'clear').map(w => btn('w:' + w.id, w.name, ws.weather && ws.weather.type === w.id && ws.weather.until > n)).join('')}${btn('w:stop', 'Stop')}</div>
    <h3>Time <small>10 minutes</small></h3><div class="oc-admin-row">${btn('t:day', 'Force day', ws.time && ws.time.mode === 'day' && ws.time.until > n)}${btn('t:night', 'Force night', ws.time && ws.time.mode === 'night' && ws.time.until > n)}${btn('t:stop', 'Normal')}</div>
    <h3>Jester <small>15 minutes</small></h3><div class="oc-admin-row">${btn('j:on', 'Summon the Jester', ws.jesterUntil > n)}${btn('j:off', 'Send him away')}</div>
    <h3>Movement <small>just you</small></h3><div class="oc-admin-row">${btn('m:fly', 'Fly', G.player.fly)}${btn('m:noclip', 'Noclip', G.player.noclip)}${btn('m:spawn', 'Spawn')}${btn('m:summit', 'Mountain top')}${btn('m:stella', 'Stella')}</div>
    <p class="oc-empty">Fly: Space goes up, Q goes down.</p>
    <div class="oc-admin-row">${btn('x:clear', 'End every event')}</div>
    <h3>Codes <small>players redeem them in Settings, Miscellaneous</small></h3>
    <div class="oc-codeform">
      <input type="text" data-c="code" maxlength="24" placeholder="CODE (case-sensitive)" spellcheck="false">
      <select data-c="what"><option value="coins">Coins</option><option value="f">F (blue coins)</option><option value="void">Void Coins</option>${potionOpts}${gearOpts}</select>
      <label><small>Amount</small><input type="number" data-c="amount" min="1" max="1000000000" value="1"></label>
      <label><small>Max uses</small><input type="number" data-c="uses" min="0" value="0"></label>
      <label><small>Hours</small><input type="number" data-c="hours" min="0" value="0"></label>
      <button type="button" class="oc-btn ok sm" data-mk>Make code</button>
    </div>
    <p class="oc-empty">Max uses 0 means no limit. Hours 0 means it never expires.</p>
    <div class="oc-list oc-codes"><p class="oc-empty">Loading codes...</p></div></div>`;
  body.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { adminAction(b.dataset.a); setTimeout(() => G && G.panel === 'admin' && renderAdmin(body), 300); });
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
  loadCodes(body);
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
  if (!G.me.staff) return;
  if (k === 'm') {
    if (v === 'fly') { G.player.fly = !G.player.fly; G.player.vel.y = 0; if (G.player.fly && G.shiftLock) setShiftLock(false); toast(G.player.fly ? 'Fly on.' : 'Fly off.'); }
    if (v === 'noclip') { G.player.noclip = !G.player.noclip; toast(G.player.noclip ? 'Noclip on.' : 'Noclip off.'); }
    if (v === 'spawn') { G.player.pos.copy(G.world.spawn); G.player.vel.set(0, 0, 0); }
    if (v === 'summit') { const b = G.world.places.bell.pos; G.player.pos.set(b.x, b.y + 0.5, b.z + 2); G.player.vel.set(0, 0, 0); }
    if (v === 'stella') { G.player.pos.copy(G.world.stellaCamp); G.player.vel.set(0, 0, 0); }
    return;
  }
  if (!net) return;
  if (k === 'w') { net.setWorld({ weather: v === 'stop' ? null : { type: v, until: n + 5 * 60000, by: G.me.name } }); toast(v === 'stop' ? 'Biome stopped.' : `${WEATHERS[v].name} started for everyone.`); }
  if (k === 't') { net.setWorld({ time: v === 'stop' ? null : { mode: v, until: n + 10 * 60000, by: G.me.name } }); toast(v === 'stop' ? 'Time is back to normal.' : `It is ${v} for everyone now.`); }
  if (k === 'j') { net.setWorld({ jesterUntil: v === 'on' ? n + 15 * 60000 : 0 }); toast(v === 'on' ? 'The Jester has been summoned.' : 'The Jester has gone.'); }
  if (k === 'x') { net.clearWorld(); toast('Every event ended.'); }
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
    else G.save.fish[c.id] = (G.save.fish[c.id] || 0) + 1;
    G.save.stats.fish++; progress('fish');
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
    ? `<div class="oc-fb-title">${c.void ? coinArt('void') : fishArt(c.color)}<span>${c.void ? 'A Void Coin' : esc(c.name)}</span></div><div class="oc-fb-msg">${c.void ? 'Rare catch. Trade 5 with the Jester.' : c.locket ? 'It glows faintly. Someone is missing this.' : c.junk ? 'Worth nothing. Still counts.' : `Marlin pays ${c.value} F for it.`}</div>`
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
  }
}
