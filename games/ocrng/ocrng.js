// ============================================================
// OVERCONTROL RNG — a 3D aura-rolling game inside Frixion, inspired by Sol's RNG on Roblox.
// One shared lobby for everyone (net.js), a studded map (world.js), blocky players and aura effects (avatar.js),
// and all the auras, potions, items and fish (data.js). Progress is saved to Firestore at rngSaves/{username}.
// The Frixion Owner has everything unlocked (every aura, endless potions). The Owner and Co-Owners get an admin panel.
// ============================================================
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import {
  AURAS, auraKey, rollAura, coinsFor, POTIONS, POTION, MIXED_POOL, ITEMS, ITEM, WEATHERS, tierOf, tierIndex,
  timeOfDay, dayProgress, weatherAt, jesterHere, nextJesterIn, fmt, fmtTime,
  FISH, FISHES, FISHING_SPOTS, catchFish, dailyStock, dayIndex, zalgo,
} from './data.js';
import { buildAvatar, AuraFX, shirtColorFor } from './avatar.js';
import { createWorld } from './world.js';
import { createNet } from './net.js';

const VERSION = '1.1';
const API = () => window.FrixionGameAPI;
const WALK = 16, JUMP = 24, GRAVITY = 72, STEP = 1.25, R = 0.6, H = 5;
const ROLL_ANIM_MS = 2600, ROLL_COOLDOWN_MS = 600;
const CAM_SENS = 0.0048;   // radians per pixel, close to Roblox's default
let G = null;

const $q = (sel, el) => (el || G.root).querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();

// ---------------- icons (drawn, never emoji) ----------------
const svg = (d, extra = '') => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
const IC = {
  auras: svg('<path d="M12 2l2.6 6.4L21 9.3l-4.9 4.3 1.5 6.6L12 16.8 6.4 20.2l1.5-6.6L3 9.3l6.4-.9z" fill="currentColor"/>'),
  items: svg('<path d="M8 6V5a4 4 0 0 1 8 0v1h2.5A1.5 1.5 0 0 1 20 7.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7.5A1.5 1.5 0 0 1 5.5 6zm2 0h4V5a2 2 0 0 0-4 0zM8 11v2h8v-2z" fill="currentColor"/>'),
  settings: svg('<path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4L10.6 6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5A3.5 3.5 0 1 1 13 8.5a3.5 3.5 0 0 1 0 7z" fill="currentColor"/>'),
  admin: svg('<path d="M3 8l4.5 3L12 4l4.5 7L21 8l-2 11H5z" fill="currentColor"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>'),
  sun: svg('<circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  moon: svg('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor"/>'),
  clear: svg('<circle cx="12" cy="12" r="5" fill="currentColor"/>'),
  rain: svg('<path d="M7 15a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19 9.5a3.8 3.8 0 0 1-.5 7.5H7z" fill="currentColor"/><path d="M8 19l-1 3M12 19l-1 3M16 19l-1 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  snow: svg('<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 3.5l3 2 3-2M9 20.5l3-2 3 2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>'),
  hell: svg('<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 1.5-4.5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z" fill="currentColor"/>'),
  heaven: svg('<ellipse cx="12" cy="6" rx="7" ry="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10l1.8 4.2 4.5.4-3.4 3 1 4.4L12 19.6 8.1 22l1-4.4-3.4-3 4.5-.4z" fill="currentColor"/>'),
  null: svg('<rect x="4" y="4" width="16" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M4 20L20 4" stroke="currentColor" stroke-width="2.4"/>'),
  solar: svg('<circle cx="12" cy="12" r="5.5" fill="currentColor"/><path d="M12 0v4M12 20v4M0 12h4M20 12h4M3.5 3.5l3 3M17.5 17.5l3 3M3.5 20.5l3-3M17.5 6.5l3-3" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'),
  fish: svg('<path d="M2 12c3-4 7-6 11-6 4 0 7 3 8 6-1 3-4 6-8 6-4 0-8-2-11-6zm0 0L0 8m2 4L0 16" fill="currentColor" stroke="currentColor" stroke-width="1.5"/><circle cx="16.5" cy="11" r="1.2" fill="#000"/>'),
  jester: svg('<path d="M4 18l2-10 4 5 2-8 2 8 4-5 2 10z" fill="currentColor"/><circle cx="6" cy="7" r="1.6" fill="currentColor"/><circle cx="12" cy="4" r="1.6" fill="currentColor"/><circle cx="18" cy="7" r="1.6" fill="currentColor"/>'),
  people: svg('<circle cx="9" cy="8" r="3.5" fill="currentColor"/><path d="M2 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5z" fill="currentColor"/><circle cx="17" cy="9" r="2.6" fill="currentColor"/><path d="M15.5 13.6c3.6.2 6.5 2.3 6.5 6.4h-4.6" fill="currentColor"/>'),
  lock: svg('<rect x="5" y="10" width="14" height="11" rx="2" fill="currentColor"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/>'),
  phone: svg('<rect x="7" y="2" width="10" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="18.5" r="1" fill="currentColor"/>'),
};
const weatherIcon = w => IC[w] || IC.clear;

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
  };
  document.body.appendChild(G.root);
  document.body.classList.add('ocrng-open');
  // Testing on your own computer only: lets a test script look inside the running game. Never on the live site.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__ocrngDebug = { state: () => G, interact: () => interact(), admin: a => adminAction(a), attack: () => attack(), panel: id => openPanel(id), cut: key => cutscene(auraKey(key)) };
  try {
    setLoading('Loading the engine', 0.1);
    await sleep(60);
    const quality = qualityFor();
    G.quality = quality;
    setupRenderer(quality);
    setLoading('Building the world', 0.35);
    await sleep(30);
    G.world = createWorld(G.scene, quality);
    setLoading('Loading your auras', 0.6);
    await loadSave();
    setLoading('Placing the studs', 0.8);
    buildPlayer();
    setupInput();
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
    f.id = 'ocrng-font'; f.rel = 'stylesheet'; f.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800;900&display=swap';
    document.head.appendChild(f);
  }
  if (document.getElementById('ocrng-css')) return;
  const l = document.createElement('link');
  l.id = 'ocrng-css'; l.rel = 'stylesheet'; l.href = new URL('./ocrng.css?v=' + VERSION, import.meta.url).href;
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
      <button type="button" class="oc-btn oc-play">Play</button>
      <button type="button" class="oc-btn dark oc-title-exit">Back to Frixion</button>
    </div>
    <div class="oc-title-foot"><span class="oc-online"></span><span>v${VERSION}</span></div>
  </div>
  <div class="oc-hud hidden">
    <button type="button" class="oc-exit oc-x" title="Back to Frixion">${IC.close}</button>
    <div class="oc-stats"></div>
    <div class="oc-buffs"></div>
    <div class="oc-biome"></div>
    <div class="oc-money"></div>
    <div class="oc-menu">
      <button type="button" data-open="auras">${IC.auras}<span>Auras</span></button>
      <button type="button" data-open="inventory">${IC.items}<span>Items</span></button>
      <button type="button" data-open="settings">${IC.settings}<span>Settings</span></button>
      <button type="button" data-open="admin" class="oc-admin-btn hidden">${IC.admin}<span>Admin</span></button>
    </div>
    <div class="oc-prompt hidden"></div>
    <div class="oc-rolltext hidden"><div class="oc-rt-name"></div><div class="oc-rt-sub"></div></div>
    <div class="oc-rollbar">
      <button type="button" class="oc-toggle oc-auto"><b>Auto Roll</b><small>OFF</small></button>
      <button type="button" class="oc-roll"><b>Roll</b><small class="oc-roll-luck"></small><span class="oc-roll-cd"></span></button>
      <button type="button" class="oc-toggle oc-quick"><b>Quick Roll</b><small>OFF</small></button>
    </div>
    <div class="oc-pvp">
      <button type="button" class="oc-pvp-btn">PvP: Off</button>
      <div class="oc-hp hidden"><i></i><span>100</span></div>
      <button type="button" class="oc-attack hidden" title="Aura attack (F)">Attack</button>
    </div>
    <div class="oc-lockmark hidden">${IC.lock}</div>
    <div class="oc-joy hidden"><span class="knob"></span></div>
    <button type="button" class="oc-jump hidden">Jump</button>
    <button type="button" class="oc-act hidden">Use</button>
    <div class="oc-announce"></div>
    <div class="oc-toasts"></div>
  </div>
  <div class="oc-panel hidden"><div class="oc-panel-box"><div class="oc-panel-head"><h2></h2><button type="button" class="oc-panel-x oc-x">${IC.close}</button></div><div class="oc-panel-body"></div></div></div>
  <div class="oc-fishbar hidden"></div>
  <div class="oc-cut hidden"></div>
  <div class="oc-rotate hidden"><div class="oc-rotate-phone">${IC.phone}</div><b>Turn your phone sideways</b><span>Overcontrol RNG plays in landscape.</span></div>`;
  const tips = ['Every 10th roll is twice as lucky.', 'Day and night swap every 10 minutes. Solar and Lunar only show up in their time.', 'The Jester visits every 4 hours. Bring 5 Void Coins.',
    'Each fishing spot has its own fish. Marlin buys them for F.', 'Nova\'s daily shop changes every day at midnight.', 'Rare weather brings auras you can\'t get any other time.', 'There are 5 secrets hidden on the map.'];
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
const blankSave = () => ({ v: 2, coins: 0, f: 0, void: 0, rolls: 0, auras: { common: 0 }, equipped: 'common', potions: {}, items: {}, fish: {}, quickRoll: false,
  settings: { auto: false, quick: false, autoEquip: true, sound: true }, eggs: {}, effects: [], queued: [], rollBuffs: [], daily: { day: 0, bought: [] }, best: 'common' });
async function loadSave() {
  const api = API();
  G.saveRef = api.db.collection('rngSaves').doc(G.me.uid);
  try { const d = await G.saveRef.get(); G.save = { ...blankSave(), ...(d.exists ? d.data() : {}) }; }
  catch (e) { G.save = blankSave(); }
  G.save.settings = { ...blankSave().settings, ...(G.save.settings || {}) };
  G.save.auras = G.save.auras || {}; G.save.fish = G.save.fish || {}; G.save.daily = G.save.daily || { day: 0, bought: [] };
  G.effects = (G.save.effects || []).filter(e => e.until > now() && POTION[e.id]);
  G.queued = (G.save.queued || []).filter(id => POTION[id]);
  G.rollBuffs = (G.save.rollBuffs || []).filter(b => POTION[b.id] && b.left > 0);
  if (!G.save.auras[G.save.equipped] && !G.me.owner) G.save.equipped = 'common';
}
let saveTimer = 0;
function markDirty() { if (!G) return; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 3000); }
function saveNow() {
  if (!G || !G.saveRef) return;
  clearTimeout(saveTimer);
  G.save.effects = G.effects.filter(e => e.until > now());
  G.save.queued = G.queued; G.save.rollBuffs = G.rollBuffs;
  G.saveRef.set(JSON.parse(JSON.stringify(G.save))).catch(() => {});
}

// What you have. The Owner has everything, without end.
const owner = () => G.me.owner;
const potionCount = id => (owner() ? Infinity : G.save.potions[id] || 0);
const hasItem = id => owner() || !!G.save.items[id];
const auraCount = key => (owner() && !key.includes(':') ? Infinity : G.save.auras[key] || 0);
const canAuto = () => owner() || API().premium();
const canQuick = () => owner() || G.save.quickRoll;

// ---------------- the player ----------------
function buildPlayer() {
  const a = buildAvatar(G.me.name, shirtColorFor(G.me.name));
  G.scene.add(a.root);
  G.player = { avatar: a, pos: G.world.spawn.clone(), vel: new THREE.Vector3(), yaw: Math.PI, onGround: true, hp: 100, pvp: false, fly: false, noclip: false, fx: null, attackAt: 0 };
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
  if (G.net) G.net.update({ aura: key });
  if (!silent) { toast(`Equipped ${auraKey(key).name}`); markDirty(); }
}

// ---------------- input: Roblox-style keyboard, mouse and touch ----------------
function setupInput() {
  const k = G.input.keys, cvs = $q('.oc-canvas');
  // Only a text box inside the game counts as typing; a Frixion box left focused behind the game doesn't steal the keys.
  if (document.activeElement && document.activeElement.blur && !G.root.contains(document.activeElement)) document.activeElement.blur();
  const typing = e => e.target && G.root.contains(e.target) && (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && /^(text|search|number)$/.test(e.target.type)));
  on(window, 'keydown', e => {
    if (!G || !G.playing || typing(e)) return;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') { if (G.panel) closePanel(); else if (G.fishing) stopFishing(); e.stopImmediatePropagation(); return; }
    if (e.repeat && ['e', 'r', 'f', 'shift'].includes(key)) return;
    k[key] = true;
    if (key === 'e') interact();
    if (key === 'r' && !G.panel) rollOnce();
    if (key === 'f' && G.player.pvp) attack();
    if (key === 'shift' && !G.player.fly && !G.touch) setShiftLock(!G.shiftLock);
    if ([' ', 'w', 'a', 's', 'd', 'e', 'r', 'f', 'q', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  on(window, 'keyup', e => { if (!G) return; k[e.key.toLowerCase()] = false; }, true);
  on(window, 'blur', () => { for (const x in k) k[x] = false; });
  // The camera turns as fast as the mouse moves, like Roblox: hold the right button (the cursor hides while you do),
  // or drag with the left one. Shift Lock keeps it turning without holding anything.
  let dragging = false;
  on(cvs, 'mousedown', e => {
    if (!G.playing && !G.titleCam) return;
    if (e.button === 2) { dragging = true; if (!G.shiftLock && cvs.requestPointerLock) cvs.requestPointerLock(); }
    if (e.button === 0) dragging = true;
  });
  on(window, 'mouseup', () => { dragging = false; if (!G.shiftLock && document.pointerLockElement === cvs) document.exitPointerLock(); });
  on(window, 'mousemove', e => {
    if (!G.playing || G.panel) return;
    if (!(dragging || G.shiftLock || document.pointerLockElement === cvs)) return;
    G.cam.yaw -= e.movementX * CAM_SENS;
    G.cam.pitch = Math.max(-1.2, Math.min(1.35, G.cam.pitch + e.movementY * CAM_SENS));
  });
  on(document, 'pointerlockchange', () => { if (G && G.shiftLock && document.pointerLockElement !== cvs) setShiftLock(false); });
  on(cvs, 'contextmenu', e => e.preventDefault());
  // the wheel zooms in steps, like Roblox
  on(cvs, 'wheel', e => { G.cam.zoom = Math.max(4, Math.min(48, G.cam.zoom + Math.sign(e.deltaY) * 3)); e.preventDefault(); }, { passive: false });
  // touch: a joystick on the left, drag anywhere else to turn, pinch to zoom
  if (API().isMobile() || (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0)) {
    G.touch = true;
    ['.oc-joy', '.oc-jump', '.oc-act'].forEach(s => $q(s).classList.remove('hidden'));
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
          G.cam.yaw -= (t.clientX - last.x) * 0.009; G.cam.pitch = Math.max(-1.2, Math.min(1.35, G.cam.pitch + (t.clientY - last.y) * 0.007)); last = { x: t.clientX, y: t.clientY };
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
  // HUD buttons
  on($q('.oc-exit'), 'click', () => close());
  on($q('.oc-title-exit'), 'click', () => close());
  on($q('.oc-play'), 'click', () => play());
  on($q('.oc-roll'), 'click', () => rollOnce());
  on($q('.oc-auto'), 'click', toggleAuto);
  on($q('.oc-quick'), 'click', toggleQuick);
  on($q('.oc-pvp-btn'), 'click', togglePvp);
  on($q('.oc-attack'), 'click', () => attack());
  on($q('.oc-panel-x'), 'click', closePanel);
  on($q('.oc-panel'), 'click', e => { if (e.target.classList.contains('oc-panel')) closePanel(); });
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
  // Phones: go fullscreen and hold the screen sideways where the browser allows it.
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
  G.net = createNet(api.rtdb, api.firebase, G.me.uid, {
    joined: (uid, d) => { addOther(uid, d); toast(`${d.name || uid} joined the lobby`); },
    changed: (uid, d) => updateOther(uid, d),
    left: uid => { removeOther(uid); },
    pos: (uid, p) => { const o = G.others.get(uid); if (o) { o.target.set(p.x, p.y, p.z); o.targetYaw = p.r; o.anim = p.a; o.hp = p.hp; if (!o.placed) { o.pos.copy(o.target); o.placed = true; } o.seen = now(); } },
    posGone: uid => { const o = G.others.get(uid); if (o) o.placed = false; },
    hit: h => takeHit(h),
    fx: f => attackFx(f.x, f.z, f.c, f.tier),
    announce: a => announce(a),
    world: w => { G.worldState = w; },
    denied: () => {
      if (!G || G.netDenied) return;
      G.netDenied = true;
      toast(G.me.staff ? 'Multiplayer is off: the Realtime Database rules need an "ocrng" section. You can still play solo.' : 'The lobby is closed right now, so you\'re playing solo. Your progress still saves.', 'warn');
    },
  });
  G.net.join({ name: G.me.name, aura: G.save.equipped, shirt: shirtColorFor(G.me.name), pvp: false });
  refreshToggles();
  updateHud();
  if (owner()) toast('Owner: every aura and endless potions are unlocked.', 'gold');
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
  if (d.aura !== o.key) { if (o.fx) o.fx.dispose(); o.key = d.aura || 'common'; o.fx = new AuraFX(o.key, true); o.avatar.fxHolder.add(o.fx.group); }
  o.avatar.tag.userData.draw(d.name || uid, o.key, d.pvp ? (o.hp ?? 100) : null);
  o.lastHp = o.hp;
}
function removeOther(uid) {
  const o = G.others.get(uid); if (!o) return;
  if (o.fx) o.fx.dispose(); G.scene.remove(o.avatar.root); o.avatar.dispose(); G.others.delete(uid);
}

// ---------------- the main loop ----------------
function loop() {
  if (!G) return;
  G.raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, G.clock.getDelta()), t = G.clock.elapsedTime, n = now();
  const env = G.env, ws = G.worldState || {};
  const time = timeOfDay(n, ws), weather = weatherAt(n, ws), jester = jesterHere(n, ws);
  if (G.playing && weather !== env.weather) announceWeather(weather);
  if (G.playing && jester && !env.jester) { toast('The Jester has arrived. His tent is to the east.', 'gold'); sound('jester'); }
  if (G.playing && time !== env.time) toast(time === 'night' ? 'Night has fallen. Lunar can be rolled now.' : 'The sun is up. Solar can be rolled now.');
  env.time = time; env.weather = weather; env.jester = jester; env.progress = dayProgress(n);
  if (G.playing && !G.portraitBlock) { movePlayer(dt); updateOthers(dt, t); checkPlaces(); checkEggs(); }
  updateCamera(dt, t);
  G.player.avatar.root.position.copy(G.player.pos);
  G.player.avatar.root.rotation.y = G.player.yaw;
  G.player.fx && G.player.fx.update(dt, t);
  G.world.update(dt, t, { ...env, camPos: G.camera.position, player: G.player.pos });
  if (G.fxObjects) G.fxObjects = G.fxObjects.filter(f => f.update(dt));
  if (G.fishing) fishingTick(dt);
  if (G.playing) {
    if (G.save.settings.auto && canAuto() && !G.rolling && !G.cutting && n >= G.nextRollAt) rollOnce();
    if (G.net) G.net.sendPos({ x: G.player.pos.x, y: G.player.pos.y, z: G.player.pos.z, r: G.player.yaw, a: G.player.moving ? 1 : 0, hp: G.player.pvp ? G.player.hp : -1 });
    if ((G.hudTick = (G.hudTick || 0) + dt) > 0.25) { G.hudTick = 0; updateHud(); }
    $q('.oc-roll-cd').style.transform = `scaleX(${G.rolling ? 1 : Math.max(0, Math.min(1, (G.nextRollAt - n) / (ROLL_COOLDOWN_MS / buffs().speed)))})`;
  }
  if ((G.zalgoTick = (G.zalgoTick || 0) + dt) > 0.15) { G.zalgoTick = 0; G.root.querySelectorAll('.oc-tier.t-null').forEach(el => { el.textContent = zalgo('null'); }); }
  if (weather !== G.filterFor) { G.filterFor = weather; G.renderer.domElement.style.filter = weather === 'null' ? 'grayscale(.85) contrast(1.15)' : ''; }
  G.renderer.render(G.scene, G.camera);
}

function movePlayer(dt) {
  const p = G.player, k = G.input.keys, j = G.input.joy;
  let fx = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0) + j.x;
  let fz = (k.s || k.arrowdown ? 1 : 0) - (k.w || k.arrowup ? 1 : 0) + j.y;
  if ((G.panel && !G.touch) || G.fishing) { fx = 0; fz = 0; }
  const m = Math.min(1, Math.hypot(fx, fz));
  const yaw = G.cam.yaw;
  const dirX = fx * Math.cos(yaw) + fz * Math.sin(yaw), dirZ = -fx * Math.sin(yaw) + fz * Math.cos(yaw);
  const speed = WALK * (p.fly ? 2.4 : 1);
  if (m > 0.05) {
    const len = Math.hypot(dirX, dirZ) || 1;
    p.vel.x = dirX / len * speed * m; p.vel.z = dirZ / len * speed * m;
  } else { p.vel.x = 0; p.vel.z = 0; }
  // the character turns almost instantly, like Roblox; with Shift Lock it always faces where the camera looks
  const want = G.shiftLock ? yaw + Math.PI : m > 0.05 ? Math.atan2(p.vel.x, p.vel.z) : p.yaw;
  let d = want - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); p.yaw += d * Math.min(1, dt * 28);
  p.moving = m > 0.05;
  if (p.knock) { p.vel.x += p.knock.x; p.vel.z += p.knock.z; p.knock.x *= Math.pow(0.02, dt); p.knock.z *= Math.pow(0.02, dt); if (Math.hypot(p.knock.x, p.knock.z) < 0.5) p.knock = null; }
  const prevY = p.pos.y;
  p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt;
  if (p.fly) {
    p.vel.y = ((k[' '] ? 1 : 0) - (k.q ? 1 : 0)) * speed;
    p.pos.y += p.vel.y * dt;
  } else {
    if (k[' '] && p.onGround) { p.vel.y = JUMP; p.onGround = false; sound('jump'); }
    p.vel.y -= GRAVITY * dt;
    p.pos.y += p.vel.y * dt;
  }
  if (!p.noclip) collide(p, prevY);
  if (p.pos.y < -60) { p.pos.copy(G.world.spawn); p.vel.set(0, 0, 0); toast('You fell out of the world. Back to spawn.'); }
  p.avatar.animate(dt, Math.hypot(p.vel.x, p.vel.z), !p.onGround && !p.fly);
}
// Bump into blocks, step up small ledges (like stairs), stand on things.
function collide(p, prevY) {
  const C = G.world.colliders;
  for (const b of C) {
    if (p.pos.x + R <= b.min.x || p.pos.x - R >= b.max.x || p.pos.z + R <= b.min.z || p.pos.z - R >= b.max.z) continue;
    if (p.pos.y >= b.max.y - 0.001 || p.pos.y + H <= b.min.y) continue;
    if (!b.water && b.max.y - p.pos.y <= STEP && (p.onGround || p.vel.y <= 0)) { p.pos.y = b.max.y; p.vel.y = Math.max(0, p.vel.y); continue; }
    if (p.vel.y > 0 && prevY + H <= b.min.y + 0.05) { p.pos.y = b.min.y - H; p.vel.y = 0; continue; }
    const dx1 = b.max.x - (p.pos.x - R), dx2 = (p.pos.x + R) - b.min.x, dz1 = b.max.z - (p.pos.z - R), dz2 = (p.pos.z + R) - b.min.z;
    const mn = Math.min(dx1, dx2, dz1, dz2);
    if (mn === dx1) p.pos.x += dx1; else if (mn === dx2) p.pos.x -= dx2; else if (mn === dz1) p.pos.z += dz1; else p.pos.z -= dz2;
  }
  let ground = Math.abs(p.pos.x) <= 100 && Math.abs(p.pos.z) <= 100 ? 0 : -Infinity;
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
    cam.position.set(Math.cos(a) * 70, 34 + Math.sin(t * 0.2) * 4, Math.sin(a) * 70);
    cam.lookAt(0, 8, 0);
    return;
  }
  const p = G.player.pos, c = G.cam;
  c.dist += (c.zoom - c.dist) * Math.min(1, dt * 18);
  const target = new THREE.Vector3(p.x, p.y + 4.5, p.z);
  if (G.shiftLock) target.add(new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw)).multiplyScalar(1.75));   // over the right shoulder
  const off = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch)).multiplyScalar(c.dist);
  cam.position.copy(target).add(off);
  if (cam.position.y < 0.6) cam.position.y = 0.6;
  cam.lookAt(target);
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
    o.avatar.animate(dt, o.anim ? Math.max(sp, 8) : 0, o.target.y - o.pos.y > 0.5);
    if (o.fx) o.fx.update(dt, t);
    if (o.data && o.data.pvp && o.hp !== o.lastHp) { o.lastHp = o.hp; o.avatar.tag.userData.draw(o.data.name || o.uid, o.key, o.hp < 0 ? 100 : o.hp); }
  }
}

// ---------------- places you can talk to, and the secrets ----------------
function checkPlaces() {
  const p = G.player.pos;
  let near = null;
  for (const [id, pl] of Object.entries(G.world.places)) {
    if (id === 'jester' && !G.env.jester) continue;
    if (Math.hypot(p.x - pl.pos.x, p.z - pl.pos.z) < pl.r && Math.abs(p.y - pl.pos.y) < 4) { near = id; break; }
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
  const pl = G.world.places[G.near];
  if (pl.spot) { if (G.fishing) reelPress(); else startFishing(pl.spot); return; }
  openPanel(G.near);
}
const EGG_REWARD = { duck: { coins: 500 }, cave: { coins: 1500 }, tower: { coins: 2500 }, glitch: { void: 1 }, sun: { coins: 1000 } };
function checkEggs() {
  const p = G.player.pos, eggs = G.world.eggs;
  for (const [id, e] of Object.entries(eggs)) {
    let inside;
    if (e.box) inside = p.x > e.box.min.x && p.x < e.box.max.x && p.z > e.box.min.z && p.z < e.box.max.z && p.y < e.box.max.y;
    else inside = Math.hypot(p.x - e.pos.x, p.z - e.pos.z) < e.r && Math.abs(p.y - e.pos.y) < 4;
    if (!inside) continue;
    if (id === 'glitch' && !G.inNull) { G.inNull = true; glitchTo(G.world.nullRoom.spawn, 'You slipped through a glitch.'); }
    if (G.save.eggs[id]) continue;
    G.save.eggs[id] = true;
    const r = EGG_REWARD[id] || {};
    if (r.coins) G.save.coins += r.coins;
    if (r.void) G.save.void += r.void;
    toast(`Secret found: ${e.name} (${Object.keys(G.save.eggs).length}/5). +${r.coins ? fmt(r.coins) + ' coins' : r.void + ' Void Coin'}`, 'gold');
    sound(id === 'duck' ? 'quack' : 'secret');
    markDirty();
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

// ---------------- buffs: potions and gear added up ----------------
function activeEffects() { const n = now(); G.effects = G.effects.filter(e => e.until > n); return G.effects; }
function buffs() {
  const env = G.env, b = { luck: 1, speed: 1, gem: 1, coin: 1, mut: 1, fish: 1, fishLuck: 0, voidLuck: 1, rod: 1 };
  const add = x => {
    if (x.luck && (!x.when || x.when === env.time)) b.luck += x.luck;
    if (x.wLuck && x.wLuck.w === env.weather) b.luck += x.wLuck.l;
    if (x.tLuck && x.tLuck.t === env.time) b.luck += x.tLuck.l;
    if (x.speed) b.speed += x.speed;
    if (x.gem) b.gem = Math.max(b.gem, x.gem);
    if (x.coin) b.coin += x.coin;
    if (x.mut) b.mut += x.mut;
    if (x.fish) b.fish += x.fish;
    if (x.fishLuck) b.fishLuck += x.fishLuck;
    if (x.voidLuck) b.voidLuck += x.voidLuck;
    if (x.rod) b.rod = Math.max(b.rod, x.rod);
  };
  for (const e of activeEffects()) add(POTION[e.id]);
  for (const it of ITEMS) if (hasItem(it.id)) add(it);
  return b;
}
const tenthRoll = () => (G.save.rolls + 1) % 10 === 0;
function luckNow() {
  let luck = buffs().luck * (tenthRoll() ? 2 : 1);
  for (const r of G.rollBuffs) { const p = POTION[r.id].rolls; if (p.l) luck += p.l; if (p.x) luck *= p.x; }
  return luck;
}

// ---------------- rolling ----------------
async function rollOnce() {
  if (!G || !G.playing || G.rolling || G.portraitBlock || now() < G.nextRollAt) return;
  G.rolling = true;
  const b = buffs();
  let luck = luckNow(), used = null;
  G.rollBuffs.forEach(r => { r.left--; }); G.rollBuffs = G.rollBuffs.filter(r => r.left > 0);
  if (G.queued.length) { used = G.queued.shift(); luck += POTION[used].oneRoll; }
  const res = rollAura(luck, G.env.time, G.env.weather, { gem: b.gem, mut: b.mut });
  G.save.rolls++;
  const coins = Math.round(coinsFor(res.rarity) * b.coin);
  G.save.coins += coins;
  G.save.auras[res.key] = (G.save.auras[res.key] || 0) + 1;
  if (Math.random() < 1 / 1500) { G.save.void++; toast('A Void Coin fell out of your roll.', 'gold'); }
  if (res.rarity > auraKey(G.save.best).rarity) G.save.best = res.key;
  const quick = G.save.settings.quick && canQuick();
  if (used) toast(`${POTION[used].name} was used on this roll.`);
  markDirty();
  try {
    if (tierIndex(res.rarity) >= 4) await cutscene(res);
    else if (!quick) await rollAnimation(res, b.speed);
    showResult(res, coins, quick);
  } finally {
    if (G) {
      if (G.save.settings.autoEquip && res.rarity > auraKey(G.save.equipped).rarity) equip(res.key, true);
      if (res.rarity >= 100000 && G.net) G.net.announce({ name: G.me.name, key: res.key, rarity: res.rarity });
      G.nextRollAt = now() + ROLL_COOLDOWN_MS / b.speed;
      G.rolling = false;
      updateHud();
    }
  }
}
// Names flicker past, slowing down, then the real one lands.
async function rollAnimation(res, speed) {
  const box = $q('.oc-rolltext'), nameEl = $q('.oc-rt-name'), sub = $q('.oc-rt-sub');
  box.className = 'oc-rolltext';
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
function paintName(el, text, res) {
  const aura = res.aura || res;
  el.textContent = text;
  const t = aura.title || {};
  el.className = 'oc-rt-name' + (t.bw ? ' bw' : t.rainbow ? ' rainbow' : t.gold ? ' gold' : t.violet ? ' violet' : '');
  el.style.color = t.bw || t.rainbow || t.gold || t.violet ? '' : aura.c;
}
// "1 in 2,048 · Shadowed" with the tier in its colour (null is red and black).
function tierLine(rarity, mut) {
  const tier = tierOf(rarity);
  return `<span>1 in ${fmt(rarity)}</span><span class="oc-tier t-${tier.id}">${tier.label}</span>${mut ? `<span class="oc-mut" style="color:${mut.color}">${mut.name}</span>` : ''}`;
}
function showResult(res, coins, quick) {
  const box = $q('.oc-rolltext'), nameEl = $q('.oc-rt-name'), sub = $q('.oc-rt-sub');
  box.className = 'oc-rolltext land';
  paintName(nameEl, res.name, res);
  sub.innerHTML = tierLine(res.rarity, res.mut) + `<span class="oc-coin-gain">+${fmt(coins)} coins</span>`;
  sound('land', tierIndex(res.rarity));
  clearTimeout(G.rollHide);
  G.rollHide = setTimeout(() => G && box.classList.add('hidden'), quick ? 1300 : 2400);
}
// The big reveal for very rare auras. 『EQUINOX』-style auras: a white ball and a black ball circle each other, then merge.
async function cutscene(res) {
  const cut = $q('.oc-cut'), tier = tierOf(res.rarity), bw = res.aura.title && res.aura.title.bw;
  G.cutting = true;
  cut.className = `oc-cut t-${tier.id}${bw ? ' bw' : ''}`;
  cut.style.setProperty('--c', res.mut ? res.mut.color : res.aura.c);
  cut.innerHTML = `<div class="cut-bg"></div><div class="cut-rays"></div>${bw ? '<div class="cut-orb w"></div><div class="cut-orb b"></div>' : '<div class="cut-star"></div>'}
    <div class="cut-flash"></div><div class="cut-name"></div><div class="cut-sub">${tierLine(res.rarity, res.mut)}</div><button type="button" class="cut-skip">Skip</button>`;
  const cutName = cut.querySelector('.cut-name');
  paintName(cutName, res.name, res); cutName.classList.add('cut-name');
  sound('cut', tierIndex(res.rarity));
  const dur = bw ? 6500 : tierIndex(res.rarity) >= 6 ? 5200 : 4000;
  await new Promise(resolve => {
    const done = () => { clearTimeout(tm); resolve(); };
    const tm = setTimeout(done, dur);
    cut.querySelector('.cut-skip').onclick = done;
  });
  if (!G) return;
  cut.classList.add('out');
  setTimeout(() => { if (G) { cut.className = 'oc-cut hidden'; cut.innerHTML = ''; } }, 450);
  G.cutting = false;
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
  const a = $q('.oc-auto'), q = $q('.oc-quick');
  const set = (el, ok, onNow, lockText) => { el.classList.toggle('on', ok && onNow); el.classList.toggle('locked', !ok); el.querySelector('small').textContent = !ok ? lockText : onNow ? 'ON' : 'OFF'; };
  set(a, canAuto(), !!G.save.settings.auto, 'Premium');
  set(q, canQuick(), !!G.save.settings.quick, '5,000 Orbs');
}

// ---------------- the HUD ----------------
function updateHud() {
  if (!G) return;
  const s = G.save, env = G.env, n = now(), b = buffs();
  const luck = luckNow();
  const x2 = v => v.toFixed(2).replace(/\.?0+$/, '');
  $q('.oc-stats').innerHTML = `<div>Luck: <b>${x2(luck)}x</b></div><div>Roll speed: <b>${x2(b.speed)}x</b></div><div class="dim">Rolls: ${fmt(s.rolls)}</div>${tenthRoll() ? '<div class="lucky">Next roll: 2x luck</div>' : ''}`;
  const chips = activeEffects().map(e => { const p = POTION[e.id]; return `<div class="oc-buff" title="${esc(p.name)}">${potionIcon(p.color)}<b>${fmtTime(e.until - n)}</b></div>`; });
  G.queued.forEach(id => chips.push(`<div class="oc-buff next" title="${esc(POTION[id].name)}">${potionIcon(POTION[id].color)}<b>next</b></div>`));
  G.rollBuffs.forEach(r => chips.push(`<div class="oc-buff next" title="${esc(POTION[r.id].name)}">${potionIcon(POTION[r.id].color)}<b>${r.left}x</b></div>`));
  $q('.oc-buffs').innerHTML = chips.join('');
  const ws = G.worldState || {};
  const left = ws.time && ws.time.until > n ? ws.time.until - n : 600000 - (n % 600000);
  $q('.oc-biome').innerHTML = `<div class="oc-biome-main w-${env.weather}">${weatherIcon(env.weather)}<span>${env.weather === 'clear' ? 'Normal' : WEATHERS[env.weather].name}</span></div>` +
    `<div class="oc-biome-sub">${env.time === 'day' ? IC.sun : IC.moon}<span>${env.time === 'day' ? 'Day' : 'Night'} ${fmtTime(left)}</span>` +
    `<span class="sep"></span>${IC.jester}<span>${env.jester ? `Jester here${ws.jesterUntil > n ? ' ' + fmtTime(ws.jesterUntil - n) : ''}` : 'Jester in ' + fmtTime(nextJesterIn(n))}</span>` +
    `<span class="sep"></span>${IC.people}<span>${G.net ? G.net.count || 1 : 1}</span></div>`;
  $q('.oc-money').innerHTML = `<div class="oc-cur coin"><i>C</i>${fmt(s.coins)}</div><div class="oc-cur f"><i>F</i>${fmt(s.f)}</div><div class="oc-cur void"><i>V</i>${fmt(s.void)}</div>`;
  $q('.oc-roll-luck').textContent = G.rolling ? 'Rolling' : `${x2(luck)}x luck`;
}
const potionIcon = c => `<svg class="oc-potion" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6v2h-1v4.2l4.6 7.9A3.3 3.3 0 0 1 15.8 21H8.2a3.3 3.3 0 0 1-2.8-4.9L10 8.2V4H9z" fill="#1b1b1f" stroke="#000" stroke-width="1.6"/><path d="M7.2 14h9.6l1.4 2.4A2 2 0 0 1 16.5 19.5h-9A2 2 0 0 1 5.8 16.4z" fill="${c}"/><path d="M10.3 9.2h3.4" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"/></svg>`;
const gearIcon = c => `<svg class="oc-potion" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" fill="${c}" stroke="#000" stroke-width="1.6"/><path d="M7 8h10M7 12h10M7 16h6" stroke="#000" stroke-opacity=".35" stroke-width="1.8"/></svg>`;
const fishIcon = c => `<svg class="oc-potion" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c3-4 7-6 11-6 4 0 7 3 8 6-1 3-4 6-8 6-4 0-8-2-11-6zm0 0L0 8m2 4L0 16" fill="${c}" stroke="#000" stroke-width="1.4"/><circle cx="16.5" cy="11" r="1.2" fill="#000"/></svg>`;

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
function announce(a) {
  const { aura, mut, name, rarity } = auraKey(a.key);
  const el = $q('.oc-announce');
  el.innerHTML = `<span>${esc(a.name)} HAS FOUND</span><b class="oc-ann-name"></b><span>CHANCE OF 1 IN ${fmt(rarity)}</span>`;
  const n = el.querySelector('.oc-ann-name'); paintName(n, name, { aura, mut }); n.classList.add('oc-ann-name');
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  sound('announce');
}
function announceWeather(w) {
  if (w === 'clear') toast('The weather has cleared.');
  else { toast(`${WEATHERS[w].name} has started. ${WEATHERS[w].desc}`, 'gold'); sound('weather'); }
}

// ---------------- panels ----------------
const TITLES = { auras: 'Aura Storage', inventory: 'Inventory', settings: 'Settings', admin: 'Admin', mixer: "Mixer's Brewery", jester: 'The Jester', finn: "Old Finn's Tackle", marlin: "Marlin's Fish Market", nova: "Nova's Daily Shop" };
function openPanel(id) {
  if (G.fishing) stopFishing();
  G.panel = id;
  const box = $q('.oc-panel'), body = box.querySelector('.oc-panel-body');
  box.classList.remove('hidden');
  box.dataset.panel = id;
  box.querySelector('h2').textContent = TITLES[id] || '';
  ({ auras: renderAuras, inventory: renderInventory, settings: renderSettings, admin: renderAdmin, mixer: () => renderShop('mixer'), jester: () => renderShop('jester'), finn: () => renderShop('finn'), marlin: renderMarlin, nova: renderDaily })[id](body);
}
function closePanel() {
  if (!G) return;
  G.panel = null;
  $q('.oc-panel').classList.add('hidden');
}
const priceText = pr => pr.coins ? `${fmt(pr.coins)} C` : pr.f ? `${fmt(pr.f)} F` : `${pr.void} V`;
const priceClass = pr => pr.coins ? 'coin' : pr.f ? 'f' : 'void';

function renderAuras(body, filter = G.auraFilter || 'owned') {
  G.auraFilter = filter;
  const keys = new Set(Object.keys(G.save.auras).filter(k => G.save.auras[k] > 0));
  if (owner()) AURAS.forEach(a => keys.add(a.id));
  const list = filter === 'owned' ? [...keys].map(auraKey) : AURAS.map(a => auraKey(a.id));
  list.sort((a, b) => b.rarity - a.rarity);
  body.innerHTML = `<div class="oc-tabs"><button type="button" data-f="owned" class="${filter === 'owned' ? 'on' : ''}">Yours (${keys.size})</button><button type="button" data-f="all" class="${filter === 'all' ? 'on' : ''}">Index (${AURAS.length})</button></div>
    <div class="oc-aura-grid">${list.map(r => {
      const have = auraCount(r.key) > 0, eq = G.save.equipped === r.key, tier = tierOf(r.rarity);
      const only = r.aura.only ? (r.aura.only.time ? (r.aura.only.time === 'day' ? 'Day only' : 'Night only') : WEATHERS[r.aura.only.weather].name + ' only') : '';
      return `<div class="oc-aura-card ${have ? '' : 'locked'} ${eq ? 'eq' : ''}" style="--c:${r.mut ? r.mut.color : r.aura.c}">
        <div class="oc-ac-name" data-key="${esc(r.key)}"></div>
        <div class="oc-ac-meta">1 in ${fmt(r.rarity)}<span class="oc-tier t-${tier.id}">${tier.label}</span></div>
        ${only ? `<div class="oc-ac-only">${only}</div>` : ''}
        <div class="oc-ac-foot"><span>${have ? 'x' + fmt(auraCount(r.key)) : 'Not found'}</span>${have ? `<button type="button" class="oc-sbtn" data-equip="${esc(r.key)}" ${eq ? 'disabled' : ''}>${eq ? 'Equipped' : 'Equip'}</button>` : ''}</div></div>`;
    }).join('')}</div>`;
  body.querySelectorAll('.oc-ac-name').forEach(el => { const r = auraKey(el.dataset.key); paintName(el, auraCount(r.key) > 0 || filter === 'owned' ? r.name : '???', r); el.classList.add('oc-ac-name'); });
  body.querySelectorAll('[data-f]').forEach(b => b.onclick = () => renderAuras(body, b.dataset.f));
  body.querySelectorAll('[data-equip]').forEach(b => b.onclick = () => { equip(b.dataset.equip); renderAuras(body); });
}

function renderInventory(body, tab = G.invTab || 'potions') {
  G.invTab = tab;
  const pots = POTIONS.filter(p => potionCount(p.id) > 0);
  const items = ITEMS.filter(i => hasItem(i.id));
  const fish = FISH.filter(f => (G.save.fish[f.id] || 0) > 0);
  const row = (icon, name, desc, right) => `<div class="oc-row">${icon}<div class="oc-row-text"><b>${esc(name)}</b><span>${esc(desc)}</span></div>${right}</div>`;
  const tabs = `<div class="oc-tabs">${[['potions', `Potions (${pots.length})`], ['gear', `Gear (${items.length})`], ['fish', `Fish (${fish.reduce((n, f) => n + G.save.fish[f.id], 0)})`]].map(([id, l]) => `<button type="button" data-t="${id}" class="${tab === id ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  let list = '';
  if (tab === 'potions') list = pots.length ? pots.map(p => row(potionIcon(p.color), p.name, p.desc, `<span class="oc-count">x${fmt(potionCount(p.id))}</span><button type="button" class="oc-sbtn" data-use="${p.id}">Use</button>`)).join('') : '<p class="oc-empty">No potions. The Mixer, Old Finn, the Jester and Nova sell them.</p>';
  if (tab === 'gear') list = items.length ? items.map(i => row(gearIcon(i.color), i.name, i.desc, '<span class="oc-count on">Active</span>')).join('') : '<p class="oc-empty">No gear yet.</p>';
  if (tab === 'fish') list = fish.length ? fish.map(f => row(fishIcon(f.color), f.name, f.junk ? 'Worth nothing. Marlin takes it anyway.' : `Marlin pays ${f.value} F each.`, `<span class="oc-count">x${fmt(G.save.fish[f.id])}</span>`)).join('') : '<p class="oc-empty">No fish yet. Find a glowing ring by the water and press E.</p>';
  body.innerHTML = `<div class="oc-money-row"><div class="oc-cur coin"><i>C</i>${fmt(G.save.coins)}</div><div class="oc-cur f"><i>F</i>${fmt(G.save.f)}</div><div class="oc-cur void"><i>V</i>${fmt(G.save.void)}</div><div class="oc-secrets">Secrets ${Object.keys(G.save.eggs).length}/5</div></div>${tabs}<div class="oc-list">${list}</div>`;
  body.querySelectorAll('[data-t]').forEach(b => b.onclick = () => renderInventory(body, b.dataset.t));
  body.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { usePotion(b.dataset.use); renderInventory(body); });
}
function usePotion(id) {
  let p = POTION[id];
  if (potionCount(id) < 1) return;
  if (!owner()) G.save.potions[id] = (G.save.potions[id] || 0) - 1;
  if (p.mixed) {   // turns into a random effect
    const into = POTION[MIXED_POOL[Math.floor(Math.random() * MIXED_POOL.length)]];
    toast(`The Mixed Potion turned into ${into.name}.`, 'gold');
    p = into; id = into.id;
  }
  if (p.oneRoll) G.queued.push(id);
  else if (p.rolls) G.rollBuffs.push({ id, left: p.rolls.n });
  else {
    if (p.group) {
      const other = activeEffects().find(e => POTION[e.id].group === p.group && e.id !== id);
      if (other) {
        toast(`${POTION[other.id].name} is already active. Only one level at a time.`, 'warn');
        if (!owner()) G.save.potions[id] = (G.save.potions[id] || 0) + 1;
        return;
      }
    }
    const cur = G.effects.find(e => e.id === id);
    if (cur) cur.until += p.secs * 1000; else G.effects.push({ id, until: now() + p.secs * 1000 });
  }
  toast(p.oneRoll ? `${p.name} is ready for your next roll.` : p.rolls ? `${p.name} works on your next ${p.rolls.n === 1 ? 'roll' : p.rolls.n + ' rolls'}.` : `${p.name} is working.`, 'gold');
  sound('potion'); markDirty(); updateHud();
}

const SHOPS = {
  mixer: { intro: 'Potions for luck and speed, and gear that lasts.', potions: ['lucky', 'speed', 'clover', 'sprint', 'fortune1', 'fortune2', 'fortune3', 'haste1', 'haste2', 'haste3', 'rage', 'jewelry', 'zombie', 'stormflask', 'frostflask', 'solartonic', 'starcandle', 'sunbrew', 'bound', 'chrono', 'mixed', 'heavenly1', 'heavenly2'], items: ['gloves', 'boots', 'solarlens', 'moonlocket'] },
  finn: { intro: 'Rods, bait and brews. I only take F.', potions: ['diver', 'angler', 'midas', 'mutagen', 'warp', 'celestialdew', 'voiddraught', 'zeus', 'poseidon', 'hades', 'transcendent', 'godlike'], items: ['goldrod', 'voidlantern'] },
  jester: { intro: 'Five Void Coins, and I will give you something... oblivious.', potions: ['oblivion', 'heavenly2', 'godlike', 'transcendent'], items: [] },
};
const canAfford = pr => owner() || (pr.coins ? G.save.coins >= pr.coins : pr.f ? G.save.f >= pr.f : G.save.void >= pr.void);
function shopRow(thing, isItem, price, button) {
  return `<div class="oc-row">${isItem ? gearIcon(thing.color) : potionIcon(thing.color)}<div class="oc-row-text"><b>${esc(thing.name)}</b><span>${esc(thing.desc)}</span></div>
    <span class="oc-price ${priceClass(price)} ${canAfford(price) ? '' : 'no'}">${owner() ? 'Free' : priceText(price)}</span>${button}</div>`;
}
function renderShop(id, body = $q('.oc-panel-body')) {
  if (id === 'jester' && !G.env.jester) { body.innerHTML = '<p class="oc-empty">The Jester has left. He comes back every 4 hours.</p>'; return; }
  const sh = SHOPS[id];
  const row = (thing, isItem) => { const owned = isItem && hasItem(thing.id); return shopRow(thing, isItem, thing.price, `<button type="button" class="oc-sbtn" data-buy="${isItem ? 'item' : 'potion'}:${thing.id}" ${owned || !canAfford(thing.price) ? 'disabled' : ''}>${owned ? 'Owned' : thing.price.void ? 'Trade' : 'Buy'}</button>`); };
  body.innerHTML = `<p class="oc-intro">${esc(sh.intro)}</p><div class="oc-money-row"><div class="oc-cur coin"><i>C</i>${fmt(G.save.coins)}</div><div class="oc-cur f"><i>F</i>${fmt(G.save.f)}</div><div class="oc-cur void"><i>V</i>${fmt(G.save.void)}</div></div>
    <div class="oc-list">${sh.potions.map(p => row(POTION[p], false)).join('')}${sh.items.map(i => row(ITEM[i], true)).join('')}</div>`;
  body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { const [kind, tid] = b.dataset.buy.split(':'); buy(kind, tid); renderShop(id, body); });
}
function pay(pr) { if (owner()) return; if (pr.coins) G.save.coins -= pr.coins; else if (pr.f) G.save.f -= pr.f; else G.save.void -= pr.void; }
function buy(kind, id, price) {
  const thing = kind === 'item' ? ITEM[id] : POTION[id], pr = price || thing.price;
  if (!canAfford(pr)) { toast('You can\'t afford that yet.', 'warn'); return false; }
  pay(pr);
  if (kind === 'item') G.save.items[id] = true; else G.save.potions[id] = (G.save.potions[id] || 0) + 1;
  toast(`You got ${thing.name}.`, 'gold'); sound('coin'); markDirty(); updateHud();
  return true;
}
// Nova: five deals a day, one of each per player. Changes at midnight UTC.
function renderDaily(body) {
  const day = dayIndex(now());
  if (G.save.daily.day !== day) G.save.daily = { day, bought: [] };
  const stock = dailyStock(day);
  const left = 86400000 - (now() % 86400000);
  body.innerHTML = `<p class="oc-intro">New deals every day. One of each, so choose well. Next deals in <b>${fmtTime(left)}</b>.</p><div class="oc-money-row"><div class="oc-cur coin"><i>C</i>${fmt(G.save.coins)}</div><div class="oc-cur f"><i>F</i>${fmt(G.save.f)}</div><div class="oc-cur void"><i>V</i>${fmt(G.save.void)}</div></div>
    <div class="oc-list">${stock.map((o, i) => {
      const sold = G.save.daily.bought.includes(i) || (o.kind === 'item' && hasItem(o.id) && !owner());
      if (o.kind === 'void') return `<div class="oc-row"><span class="oc-voidcoin">V</span><div class="oc-row-text"><b>Void Coin</b><span>Trade 5 with the Jester for an Oblivion Potion.</span></div><span class="oc-price ${priceClass(o.price)} ${canAfford(o.price) ? '' : 'no'}">${owner() ? 'Free' : priceText(o.price)}</span><button type="button" class="oc-sbtn" data-d="${i}" ${sold || !canAfford(o.price) ? 'disabled' : ''}>${sold ? 'Sold out' : 'Buy'}</button></div>`;
      const thing = o.kind === 'item' ? ITEM[o.id] : POTION[o.id];
      return shopRow(thing, o.kind === 'item', o.price, `<button type="button" class="oc-sbtn" data-d="${i}" ${sold || !canAfford(o.price) ? 'disabled' : ''}>${sold ? 'Sold out' : 'Buy'}</button>`);
    }).join('')}</div>`;
  body.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
    const i = +b.dataset.d, o = stock[i];
    if (o.kind === 'void') { if (!canAfford(o.price)) return; pay(o.price); G.save.void++; toast('You got a Void Coin.', 'gold'); sound('coin'); }
    else if (!buy(o.kind, o.id, o.price)) return;
    G.save.daily.bought.push(i); markDirty(); updateHud(); renderDaily(body);
  });
}
// Marlin buys fish for F.
function renderMarlin(body) {
  const fish = FISH.filter(f => (G.save.fish[f.id] || 0) > 0);
  const total = fish.reduce((s, f) => s + f.value * G.save.fish[f.id], 0);
  body.innerHTML = `<p class="oc-intro">Fresh fish, fair prices. I pay in F.</p>
    ${fish.length ? `<div class="oc-list">${fish.map(f => `<div class="oc-row">${fishIcon(f.color)}<div class="oc-row-text"><b>${esc(f.name)}</b><span>x${G.save.fish[f.id]} at ${f.value} F each</span></div><span class="oc-price f">${fmt(f.value * G.save.fish[f.id])} F</span><button type="button" class="oc-sbtn" data-sell="${f.id}">Sell</button></div>`).join('')}</div>
    <button type="button" class="oc-btn wide" data-sellall>Sell all for ${fmt(total)} F</button>` : '<p class="oc-empty">You have no fish. Fish at any glowing ring by the water, then come back.</p>'}`;
  const sell = ids => { let got = 0; ids.forEach(id => { got += FISHES[id].value * (G.save.fish[id] || 0); G.save.fish[id] = 0; }); G.save.f += got; toast(`Sold for ${fmt(got)} F.`, 'gold'); sound('coin'); markDirty(); updateHud(); renderMarlin(body); };
  body.querySelectorAll('[data-sell]').forEach(b => b.onclick = () => sell([b.dataset.sell]));
  const all = body.querySelector('[data-sellall]'); if (all) all.onclick = () => sell(fish.map(f => f.id));
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
    const b = buffs();
    const voidChance = (f.spot === 'void' ? 1 / 6 : 1 / 40) * b.voidLuck;
    f.catch = Math.random() < voidChance ? { void: true, name: 'Void Coin', speed: 1.6 } : catchFish(f.spot, G.env.time, G.env.weather, b.fishLuck);
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
    if (c.void) G.save.void++; else G.save.fish[c.id] = (G.save.fish[c.id] || 0) + 1;
    markDirty(); updateHud();
    renderFishResult(c);
    sound(c.void || c.value >= 50 ? 'secret' : 'coin');
  } else if (f.misses >= 2) { renderFishResult(null); }
  else renderFishBar();
}
function renderFishBar() {
  const f = G.fishing, el = $q('.oc-fishbar');
  el.classList.remove('hidden');
  const spot = FISHING_SPOTS[f.spot].name;
  if (f.state === 'wait') {
    el.innerHTML = `<div class="oc-fb-title">${IC.fish}<span>${esc(spot)}</span></div><div class="oc-fb-msg">Waiting for a bite<span class="dots"></span></div><div class="oc-fb-row"><button type="button" class="oc-sbtn dark" data-stop>Stop</button></div>`;
  } else if (f.state === 'reel') {
    el.innerHTML = `<div class="oc-fb-title">${IC.fish}<span>Reel it in</span></div>
      <div class="oc-fb-bar"><span class="oc-fb-zone" style="left:${f.zoneAt * 100}%;width:${f.zone * 100}%"></span><span class="oc-fb-marker" style="left:${f.pos * 100}%"></span></div>
      <div class="oc-fb-pips">${[0, 1, 2].map(i => `<i class="${i < f.hits ? 'on' : ''}"></i>`).join('')}<span class="miss">${f.misses ? 'Missed ' + f.misses + '/2' : ''}</span></div>
      <div class="oc-fb-row"><button type="button" class="oc-btn" data-reel>Reel</button></div>`;
  }
  const r = el.querySelector('[data-reel]'); if (r) r.onclick = reelPress;
  const s = el.querySelector('[data-stop]'); if (s) s.onclick = stopFishing;
}
function renderFishResult(c) {
  const f = G.fishing, el = $q('.oc-fishbar');
  if (!f) return;
  f.state = 'done';
  el.innerHTML = c
    ? `<div class="oc-fb-title">${c.void ? '<span class="oc-voidcoin">V</span>' : fishIcon(c.color)}<span>${c.void ? 'A Void Coin' : esc(c.name)}</span></div><div class="oc-fb-msg">${c.void ? 'Rare catch. Trade 5 with the Jester.' : c.junk ? 'Worth nothing. Still counts.' : `Marlin pays ${c.value} F for it.`}</div>`
    : `<div class="oc-fb-title">${IC.fish}<span>It got away</span></div><div class="oc-fb-msg">Try again.</div>`;
  el.innerHTML += `<div class="oc-fb-row"><button type="button" class="oc-btn" data-again>Cast again</button><button type="button" class="oc-sbtn dark" data-stop>Done</button></div>`;
  el.querySelector('[data-again]').onclick = () => startFishing(f.spot);
  el.querySelector('[data-stop]').onclick = stopFishing;
}

function renderSettings(body) {
  const s = G.save.settings;
  body.innerHTML = `<div class="oc-set">
    <label class="oc-check"><input type="checkbox" data-s="autoEquip" ${s.autoEquip ? 'checked' : ''}><span></span>Equip rarer auras automatically</label>
    <label class="oc-check"><input type="checkbox" data-s="sound" ${s.sound ? 'checked' : ''}><span></span>Sound effects</label>
    <div class="oc-set-row"><b>Graphics</b>${['low', 'medium', 'high'].map(q => `<button type="button" class="oc-sbtn ${q === G.quality ? '' : 'dark'}" data-q="${q}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div>
    <p class="oc-empty">Graphics changes apply the next time you open the game.</p>
    <div class="oc-keys"><b>Controls</b><span>WASD: move. Space: jump. Hold right mouse: turn the camera. Wheel: zoom.</span><span>Shift: Shift Lock. R: roll. E: talk or fish. F: aura attack (PvP on).</span></div>
    <p class="oc-best-line">Best aura: <b class="oc-best"></b>  |  ${fmt(G.save.rolls)} rolls</p></div>`;
  const best = auraKey(G.save.best), bestEl = body.querySelector('.oc-best');
  paintName(bestEl, best.name, best); bestEl.classList.add('oc-best');
  body.querySelectorAll('[data-s]').forEach(c => c.onchange = () => { s[c.dataset.s] = c.checked; markDirty(); });
  body.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { try { localStorage.setItem('ocrng.quality', b.dataset.q); } catch (e) {} body.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('dark', x !== b)); });
}

// The Owner and Co-Owners: start weather, change the time, summon the Jester, fly and noclip.
function renderAdmin(body) {
  if (!G.me.staff) { body.innerHTML = ''; return; }
  const ws = G.worldState || {}, n = now();
  const btn = (act, label, onNow) => `<button type="button" class="oc-sbtn ${onNow ? '' : 'dark'}" data-a="${act}">${label}</button>`;
  body.innerHTML = `<div class="oc-admin">
    <h3>Weather <small>5 minutes, for everyone</small></h3><div class="oc-admin-row">${Object.values(WEATHERS).filter(w => w.id !== 'clear').map(w => btn('w:' + w.id, w.name, ws.weather && ws.weather.type === w.id && ws.weather.until > n)).join('')}${btn('w:stop', 'Stop')}</div>
    <h3>Time <small>10 minutes</small></h3><div class="oc-admin-row">${btn('t:day', 'Force day', ws.time && ws.time.mode === 'day' && ws.time.until > n)}${btn('t:night', 'Force night', ws.time && ws.time.mode === 'night' && ws.time.until > n)}${btn('t:stop', 'Normal')}</div>
    <h3>Jester <small>15 minutes</small></h3><div class="oc-admin-row">${btn('j:on', 'Summon the Jester', ws.jesterUntil > n)}${btn('j:off', 'Send him away')}</div>
    <h3>Movement <small>just you</small></h3><div class="oc-admin-row">${btn('m:fly', 'Fly', G.player.fly)}${btn('m:noclip', 'Noclip', G.player.noclip)}${btn('m:spawn', 'Back to spawn')}</div>
    <p class="oc-empty">Fly: Space goes up, Q goes down.</p>
    <div class="oc-admin-row">${btn('x:clear', 'End every event')}</div></div>`;
  body.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { adminAction(b.dataset.a); setTimeout(() => G && G.panel === 'admin' && renderAdmin(body), 300); });
}
function adminAction(a) {
  const [k, v] = a.split(':'), n = now(), net = G.net;
  if (!G.me.staff || !net) return;
  if (k === 'w') { net.setWorld({ weather: v === 'stop' ? null : { type: v, until: n + 5 * 60000, by: G.me.name } }); toast(v === 'stop' ? 'Weather stopped.' : `${WEATHERS[v].name} started for everyone.`); }
  if (k === 't') { net.setWorld({ time: v === 'stop' ? null : { mode: v, until: n + 10 * 60000, by: G.me.name } }); toast(v === 'stop' ? 'Time is back to normal.' : `It is ${v} for everyone now.`); }
  if (k === 'j') { net.setWorld({ jesterUntil: v === 'on' ? n + 15 * 60000 : 0 }); toast(v === 'on' ? 'The Jester has been summoned.' : 'The Jester has gone.'); }
  if (k === 'm') {
    if (v === 'fly') { G.player.fly = !G.player.fly; G.player.vel.y = 0; if (G.player.fly && G.shiftLock) setShiftLock(false); toast(G.player.fly ? 'Fly on.' : 'Fly off.'); }
    if (v === 'noclip') { G.player.noclip = !G.player.noclip; toast(G.player.noclip ? 'Noclip on.' : 'Noclip off.'); }
    if (v === 'spawn') { G.player.pos.copy(G.world.spawn); G.player.vel.set(0, 0, 0); }
  }
  if (k === 'x') { net.clearWorld(); toast('Every event ended.'); }
}

// ---------------- PvP and aura attacks ----------------
function togglePvp() {
  const p = G.player;
  p.pvp = !p.pvp; p.hp = 100;
  const b = $q('.oc-pvp-btn'); b.textContent = p.pvp ? 'PvP: On' : 'PvP: Off'; b.classList.toggle('on', p.pvp);
  $q('.oc-hp').classList.toggle('hidden', !p.pvp); $q('.oc-attack').classList.toggle('hidden', !p.pvp);
  updateHp();
  p.avatar.tag.userData.draw(G.me.name, G.save.equipped, p.pvp ? p.hp : null);
  if (G.net) G.net.update({ pvp: p.pvp });
  toast(p.pvp ? 'PvP on. F (or Attack) uses your aura\'s attack. Only players with PvP on can be hit.' : 'PvP off. Nobody can hit you.');
}
function updateHp() { const p = G.player; $q('.oc-hp i').style.width = Math.max(0, p.hp) + '%'; $q('.oc-hp span').textContent = Math.max(0, Math.round(p.hp)); }
function attack() {
  const p = G.player, n = now();
  if (!p.pvp || n < p.attackAt) return;
  const { aura, mut, rarity } = auraKey(G.save.equipped);
  const tier = tierIndex(rarity);
  p.attackAt = n + 2500;
  const radius = 6 + tier * 1.6, dmg = 8 + tier * 5, push = 14 + tier * 4;
  const color = mut ? mut.color : aura.c;
  attackFx(p.pos.x, p.pos.z, color, tier);
  if (G.net) {
    G.net.fx({ x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1), c: color, tier });
    for (const o of G.others.values()) {
      if (!o.placed || !o.data || !o.data.pvp) continue;
      const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > radius) continue;
      G.net.hit(o.uid, { dmg, kx: dx / (d || 1) * push, kz: dz / (d || 1) * push, by: G.me.name, aura: auraKey(G.save.equipped).name });
    }
  }
  sound('attack', tier);
}
function takeHit(h) {
  const p = G.player;
  if (!p.pvp) return;
  p.hp -= h.dmg || 0;
  p.knock = { x: h.kx || 0, z: h.kz || 0 }; p.vel.y = 12; p.onGround = false;
  G.root.classList.remove('oc-hurt'); void G.root.offsetWidth; G.root.classList.add('oc-hurt');
  sound('hurt');
  if (p.hp <= 0) {
    toast(`${h.by || 'Someone'} knocked you out with ${h.aura || 'their aura'}.`, 'warn');
    p.hp = 100; p.pos.copy(G.world.spawn); p.vel.set(0, 0, 0); p.knock = null;
  }
  updateHp();
  p.avatar.tag.userData.draw(G.me.name, G.save.equipped, p.hp);
}
function attackFx(x, z, color, tier) {
  G.fxObjects = G.fxObjects || [];
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.4, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.4, z); G.scene.add(ring);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 10, 24, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  pillar.position.set(x, 5, z); G.scene.add(pillar);
  const max = 6 + tier * 1.6;
  let life = 0;
  G.fxObjects.push({ update(dt) {
    life += dt; const k = life / 0.6;
    ring.scale.setScalar(1 + k * max); ring.material.opacity = 0.9 * (1 - k); pillar.material.opacity = 0.4 * (1 - k); pillar.scale.set(1 + k * 2, 1, 1 + k * 2);
    if (k >= 1) { G.scene.remove(ring); G.scene.remove(pillar); ring.geometry.dispose(); pillar.geometry.dispose(); return false; }
    return true;
  } });
}

// ---------------- sound: little synth blips, no files to download ----------------
function audio() {
  if (G.audio) return G.audio;
  try { G.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { G.audio = null; }
  return G.audio;
}
function sound(kind, n = 0) {
  if (!G || !G.save || !G.save.settings.sound) return;
  const ctx = G.audio; if (!ctx) return;
  const tone = (f, d, type = 'sine', v = 0.08, delay = 0, slide) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
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
    case 'attack': tone(160 + n * 30, 0.35, 'sawtooth', 0.07, 0, 60); break;
    case 'hurt': tone(220, 0.2, 'square', 0.06, 0, 110); break;
    case 'jester': chord(392, [0, 3, 7, 10], 0.5, 'square', 0.04); break;
    case 'weather': chord(262, [0, 5, 9], 0.8, 'sine', 0.05); break;
    case 'announce': chord(196, [0, 7, 12, 16, 19], 1.6, 'triangle', 0.05); break;
    case 'join': chord(392, [0, 4, 7, 12], 0.4, 'triangle', 0.05); break;
  }
}
