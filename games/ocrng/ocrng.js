// ============================================================
// OVERCONTROL RNG — a 3D aura-rolling game inside Frixion, inspired by Sol's RNG on Roblox.
// One shared lobby for everyone (net.js), a studded map (world.js), blocky players and aura effects (avatar.js),
// and all the auras, potions and items (data.js). Progress is saved to Firestore at rngSaves/{username}.
// The Frixion Owner has everything unlocked (every aura, endless potions). The Owner and Co-Owners get an admin panel.
// ============================================================
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import {
  AURAS, AURA, auraKey, rollAura, coinsFor, POTIONS, POTION, ITEMS, ITEM, WEATHERS, TIERS, tierOf, tierIndex,
  timeOfDay, dayProgress, weatherAt, jesterHere, nextJesterIn, fmt, fmtTime,
} from './data.js';
import { buildAvatar, AuraFX, shirtColorFor } from './avatar.js';
import { createWorld } from './world.js';
import { createNet } from './net.js';

const VERSION = '1.0';
const API = () => window.FrixionGameAPI;
const WALK = 16, JUMP = 24, GRAVITY = 72, STEP = 1.25, R = 0.6, H = 5;
const ROLL_ANIM_MS = 2600, ROLL_COOLDOWN_MS = 600;
let G = null;

const $q = (sel, el) => (el || G.root).querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();

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
    env: { time: 'day', weather: 'clear', jester: false, progress: 0 }, worldState: {}, effects: [], toasts: [],
    rolling: false, nextRollAt: 0, cam: { yaw: 0, pitch: 0.32, dist: 18 }, panel: null, closed: false,
  };
  document.body.appendChild(G.root);
  document.body.classList.add('ocrng-open');
  // Testing on your own computer only: lets a test script look inside the running game. Never on the live site.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__ocrngDebug = { state: () => G, interact: () => interact(), admin: a => adminAction(a), attack: () => attack() };
  try {
    setLoading('Loading the engine…', 0.1);
    await sleep(60);
    const quality = qualityFor();
    G.quality = quality;
    setupRenderer(quality);
    setLoading('Building the world…', 0.35);
    await sleep(30);
    G.world = createWorld(G.scene, quality);
    setLoading('Loading your auras…', 0.6);
    await loadSave();
    setLoading('Polishing the studs…', 0.8);
    buildPlayer();
    setupInput();
    G.clock = new THREE.Clock();
    loop();
    setLoading('Ready!', 1);
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
  if (g.renderer) { g.renderer.dispose(); g.renderer.forceContextLoss && g.renderer.forceContextLoss(); }
  if (g.audio) g.audio.close().catch(() => {});
  g.root.remove();
  document.body.classList.remove('ocrng-open');
  G = null;
}
const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); G.listeners.push([t, ev, fn, o]); };

function ensureCss() {
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
    <div class="oc-load-sky"></div>
    <div class="oc-load-emblem"><span class="ring r1"></span><span class="ring r2"></span><span class="orb w"></span><span class="orb b"></span><span class="core"></span></div>
    <div class="oc-load-title"><span>OVERCONTROL'S</span><b>RNG</b></div>
    <div class="oc-load-bar"><i></i></div>
    <div class="oc-load-step">Loading…</div>
    <div class="oc-load-tip"></div>
  </div>
  <div class="oc-title hidden">
    <div class="oc-title-logo"><span class="pre">OVERCONTROL'S</span><span class="big">RNG</span><span class="tag">Roll for auras. Chase 『EQUINOX』.</span></div>
    <div class="oc-title-btns">
      <button type="button" class="oc-btn oc-play">PLAY</button>
      <button type="button" class="oc-btn ghost oc-title-exit">Back to Frixion</button>
    </div>
    <div class="oc-title-foot"><span class="oc-online">Finding the lobby…</span><span>v${VERSION}</span></div>
  </div>
  <div class="oc-hud hidden">
    <button type="button" class="oc-exit" title="Back to Frixion">✕</button>
    <div class="oc-buffs"></div>
    <div class="oc-status">
      <div class="oc-world"></div>
      <div class="oc-money"></div>
    </div>
    <div class="oc-menu">
      <button type="button" data-open="auras"><i>✦</i><span>Auras</span></button>
      <button type="button" data-open="inventory"><i>⚗</i><span>Items</span></button>
      <button type="button" data-open="settings"><i>⚙</i><span>Settings</span></button>
      <button type="button" data-open="admin" class="oc-admin-btn hidden"><i>★</i><span>Admin</span></button>
    </div>
    <div class="oc-prompt hidden"></div>
    <div class="oc-rolltext hidden"><div class="oc-rt-name"></div><div class="oc-rt-sub"></div></div>
    <div class="oc-rollbar">
      <button type="button" class="oc-toggle oc-auto"><b>Auto Roll</b><small>OFF</small></button>
      <button type="button" class="oc-roll"><span class="oc-roll-fill"></span><b>ROLL</b><small class="oc-roll-luck"></small></button>
      <button type="button" class="oc-toggle oc-quick"><b>Quick Roll</b><small>OFF</small></button>
    </div>
    <div class="oc-pvp">
      <button type="button" class="oc-pvp-btn">PvP OFF</button>
      <div class="oc-hp hidden"><i></i><span>100</span></div>
      <button type="button" class="oc-attack hidden" title="Aura attack (F)">ATTACK</button>
    </div>
    <div class="oc-joy hidden"><span class="knob"></span></div>
    <button type="button" class="oc-jump hidden">JUMP</button>
    <button type="button" class="oc-act hidden">E</button>
    <div class="oc-announce"></div>
    <div class="oc-toasts"></div>
  </div>
  <div class="oc-panel hidden"><div class="oc-panel-box"><div class="oc-panel-head"><h2></h2><button type="button" class="oc-panel-x">✕</button></div><div class="oc-panel-body"></div></div></div>
  <div class="oc-cut hidden"></div>`;
  const tips = ['Every 10th roll is twice as lucky.', 'Day and night swap every 10 minutes. Solar and Lunar only show up in their time.', 'The Jester visits every 4 hours. Bring 5 Void Coins.',
    'Fish at the end of the dock for F, the blue coins.', 'Rare weather brings auras you can\'t get any other time.', 'Some auras mutate: Shiny, Corrupted, even Glitched.', 'There are 5 secrets hidden on the map.'];
  root.querySelector('.oc-load-tip').textContent = 'Tip: ' + tips[Math.floor(Math.random() * tips.length)];
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
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
  G.renderer = renderer; G.scene = scene; G.camera = camera;
  const fit = () => { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  fit(); on(window, 'resize', fit);
}

// ---------------- saving ----------------
const blankSave = () => ({ v: 1, coins: 0, f: 0, void: 0, rolls: 0, auras: { common: 0 }, equipped: 'common', potions: {}, items: {}, quickRoll: false, settings: { auto: false, quick: false, autoEquip: true, sound: true }, eggs: {}, effects: [], queued: [], best: 'common' });
async function loadSave() {
  const api = API();
  G.saveRef = api.db.collection('rngSaves').doc(G.me.uid);
  try { const d = await G.saveRef.get(); G.save = { ...blankSave(), ...(d.exists ? d.data() : {}) }; }
  catch (e) { G.save = blankSave(); }
  G.save.settings = { ...blankSave().settings, ...(G.save.settings || {}) };
  G.save.auras = G.save.auras || {};
  G.effects = (G.save.effects || []).filter(e => e.until > now() && POTION[e.id]);
  G.queued = (G.save.queued || []).filter(id => POTION[id]);
  if (!G.save.auras[G.save.equipped] && !G.me.owner) G.save.equipped = 'common';
}
let saveTimer = 0;
function markDirty() { if (!G) return; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 3000); }
function saveNow() {
  if (!G || !G.saveRef) return;
  clearTimeout(saveTimer);
  G.save.effects = G.effects.filter(e => e.until > now());
  G.save.queued = G.queued;
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

// ---------------- input: keyboard, mouse, touch ----------------
function setupInput() {
  const k = G.input.keys, cvs = $q('.oc-canvas');
  // Only a text box inside the game counts as typing; a Frixion box left focused behind the game doesn't steal the keys.
  if (document.activeElement && document.activeElement.blur && !G.root.contains(document.activeElement)) document.activeElement.blur();
  const typing = e => e.target && G.root.contains(e.target) && (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && /^(text|search|number)$/.test(e.target.type)));
  on(window, 'keydown', e => {
    if (!G || !G.playing || typing(e)) return;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') { if (G.panel) closePanel(); e.stopImmediatePropagation(); return; }
    k[key] = true; k[e.code] = true;
    if (key === 'e') interact();
    if (key === 'r' && !G.panel) rollOnce();
    if (key === 'f' && G.player.pvp) attack();
    if ([' ', 'w', 'a', 's', 'd', 'e', 'r', 'f', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  on(window, 'keyup', e => { if (!G) return; k[e.key.toLowerCase()] = false; k[e.code] = false; }, true);
  on(window, 'blur', () => { for (const x in k) k[x] = false; });
  // drag to turn the camera, wheel to zoom
  let drag = null;
  on(cvs, 'pointerdown', e => { if (e.pointerType === 'touch') return; drag = { x: e.clientX, y: e.clientY }; cvs.setPointerCapture(e.pointerId); });
  on(cvs, 'pointermove', e => {
    if (!drag || e.pointerType === 'touch') return;
    G.cam.yaw -= (e.clientX - drag.x) * 0.006; G.cam.pitch = Math.max(-0.15, Math.min(1.25, G.cam.pitch + (e.clientY - drag.y) * 0.005));
    drag = { x: e.clientX, y: e.clientY };
  });
  on(cvs, 'pointerup', () => { drag = null; });
  on(cvs, 'contextmenu', e => e.preventDefault());
  on(cvs, 'wheel', e => { G.cam.dist = Math.max(6, Math.min(48, G.cam.dist * (1 + Math.sign(e.deltaY) * 0.1))); e.preventDefault(); }, { passive: false });
  // touch: a joystick on the left, drag anywhere else to turn, pinch to zoom
  if (API().isMobile() || ('ontouchstart' in window && navigator.maxTouchPoints > 0)) {
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
          G.input.joy = { x: dx, y: dy }; knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
        } else if (t.identifier === turnId && last) {
          G.cam.yaw -= (t.clientX - last.x) * 0.008; G.cam.pitch = Math.max(-0.15, Math.min(1.25, G.cam.pitch + (t.clientY - last.y) * 0.006)); last = { x: t.clientX, y: t.clientY };
        }
      }
      if (e.touches.length === 2 && pinch) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); G.cam.dist = Math.max(6, Math.min(48, pinch.dist * pinch.d / d)); }
    }, { passive: true });
    on(cvs, 'touchstart', e => {
      if (e.touches.length === 2) { pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), dist: G.cam.dist }; turnId = null; return; }
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

// ---------------- title screen and joining ----------------
function showTitle() {
  $q('.oc-loading').classList.add('gone');
  setTimeout(() => G && $q('.oc-loading').classList.add('hidden'), 700);
  $q('.oc-title').classList.remove('hidden');
  G.titleCam = true;
  // peek at how many people are in the lobby (one read, no listener)
  API().rtdb.ref('ocrng/roster').once('value').then(s => {
    if (!G) return;
    const n = s.numChildren();
    $q('.oc-online').textContent = n ? `${n} ${n === 1 ? 'person is' : 'people are'} playing right now` : 'Nobody is playing yet. Be the first!';
  }).catch(() => { if (G) $q('.oc-online').textContent = 'Overcontrol\'s RNG'; });
}
function play() {
  if (G.playing) return;
  audio();
  G.titleCam = false; G.playing = true;
  $q('.oc-title').classList.add('gone');
  setTimeout(() => G && $q('.oc-title').classList.add('hidden'), 600);
  $q('.oc-hud').classList.remove('hidden');
  if (G.me.staff) $q('.oc-admin-btn').classList.remove('hidden');
  G.cam.yaw = G.player.yaw + Math.PI;
  // join the lobby
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
      toast(G.me.staff ? 'Multiplayer is off: the Realtime Database rules need an "ocrng" section (see the Frixion update notes). You can still play solo.'
        : 'The lobby is closed right now, so you\'re playing solo. Your progress still saves.', 'warn');
    },
  });
  G.net.join({ name: G.me.name, aura: G.save.equipped, shirt: shirtColorFor(G.me.name), pvp: false });
  refreshToggles();
  updateHud(true);
  if (owner()) toast('Owner: every aura and endless potions are unlocked for you.', 'gold');
  sound('join');
}

// ---------------- other players ----------------
function addOther(uid, d) {
  if (G.others.has(uid)) return updateOther(uid, d);
  const a = buildAvatar(d.name || uid, d.shirt || shirtColorFor(uid));
  a.root.visible = false;
  G.scene.add(a.root);
  const o = { uid, data: d, avatar: a, fx: null, key: null, pos: new THREE.Vector3(0, -50, 0), target: new THREE.Vector3(0, -50, 0), yaw: 0, targetYaw: 0, placed: false, hp: 100, speed: 0 };
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
  // the shared clock
  const env = G.env;
  const ws = G.worldState || {};
  const time = timeOfDay(n, ws), weather = weatherAt(n, ws), jester = jesterHere(n, ws);
  if (G.playing && weather !== env.weather) announceWeather(weather);
  if (G.playing && jester && !env.jester) { toast('The Jester has arrived! Find his tent to the east.', 'gold'); sound('jester'); }
  if (G.playing && time !== env.time) toast(time === 'night' ? 'Night falls. Lunar can be rolled now.' : 'The sun rises. Solar can be rolled now.');
  env.time = time; env.weather = weather; env.jester = jester; env.progress = dayProgress(n);
  if (G.playing) { movePlayer(dt); updateOthers(dt, t); checkPlaces(); checkEggs(); }
  updateCamera(dt, t);
  G.player.avatar.root.position.copy(G.player.pos);
  G.player.avatar.root.rotation.y = G.player.yaw;
  G.player.fx && G.player.fx.update(dt, t);
  G.world.update(dt, t, { ...env, camPos: G.camera.position, player: G.player.pos });
  if (G.fxObjects) G.fxObjects = G.fxObjects.filter(f => f.update(dt));
  if (G.playing) {
    if (G.save.settings.auto && canAuto() && !G.rolling && !G.panelBlocksAuto && n >= G.nextRollAt) rollOnce();
    if (G.net) G.net.sendPos({ x: G.player.pos.x, y: G.player.pos.y, z: G.player.pos.z, r: G.player.yaw, a: G.player.moving ? 1 : 0, hp: G.player.pvp ? G.player.hp : -1 });
    if ((G.hudTick = (G.hudTick || 0) + dt) > 0.25) { G.hudTick = 0; updateHud(); }
  }
  // Null weather drains the colour from the world
  if (weather !== G.filterFor) { G.filterFor = weather; G.renderer.domElement.style.filter = weather === 'null' ? 'grayscale(.85) contrast(1.15)' : ''; }
  G.renderer.render(G.scene, G.camera);
}

function movePlayer(dt) {
  const p = G.player, k = G.input.keys, j = G.input.joy;
  let fx = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0) + j.x;
  let fz = (k.s || k.arrowdown ? 1 : 0) - (k.w || k.arrowup ? 1 : 0) + j.y;
  if (G.panel && !G.touch) { fx = 0; fz = 0; }
  const m = Math.min(1, Math.hypot(fx, fz));
  const yaw = G.cam.yaw;
  const dirX = fx * Math.cos(yaw) + fz * Math.sin(yaw), dirZ = -fx * Math.sin(yaw) + fz * Math.cos(yaw);
  const speed = WALK * (p.fly ? 2.4 : 1);
  if (m > 0.05) {
    const len = Math.hypot(dirX, dirZ) || 1;
    p.vel.x = dirX / len * speed * m; p.vel.z = dirZ / len * speed * m;
    const want = Math.atan2(p.vel.x, p.vel.z);
    let d = want - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); p.yaw += d * Math.min(1, dt * 12);
  } else { p.vel.x = 0; p.vel.z = 0; }
  p.moving = m > 0.05;
  if (p.knock) { p.vel.x += p.knock.x; p.vel.z += p.knock.z; p.knock.x *= Math.pow(0.02, dt); p.knock.z *= Math.pow(0.02, dt); if (Math.hypot(p.knock.x, p.knock.z) < 0.5) p.knock = null; }
  const prevY = p.pos.y;
  p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt;
  if (p.fly) {
    p.vel.y = ((k[' '] ? 1 : 0) - (k.shift ? 1 : 0)) * speed;
    p.pos.y += p.vel.y * dt;
  } else {
    if (k[' '] && p.onGround) { p.vel.y = JUMP; p.onGround = false; sound('jump'); }
    p.vel.y -= GRAVITY * dt;
    p.pos.y += p.vel.y * dt;
  }
  if (!p.noclip) collide(p, prevY);
  if (p.pos.y < -60) { p.pos.copy(G.world.spawn); p.vel.set(0, 0, 0); toast('You fell out of the world. Back to spawn!'); }
  p.avatar.animate(dt, Math.hypot(p.vel.x, p.vel.z), !p.onGround && !p.fly);
}
// Bump into blocks, step up small ledges (like stairs), stand on things.
function collide(p, prevY) {
  const C = G.world.colliders;
  for (const b of C) {
    if (p.pos.x + R <= b.min.x || p.pos.x - R >= b.max.x || p.pos.z + R <= b.min.z || p.pos.z - R >= b.max.z) continue;
    if (p.pos.y >= b.max.y - 0.001 || p.pos.y + H <= b.min.y) continue;
    if (!b.water && b.max.y - p.pos.y <= STEP && (p.onGround || p.vel.y <= 0)) { p.pos.y = b.max.y; p.vel.y = Math.max(0, p.vel.y); continue; }
    if (p.vel.y > 0 && prevY + H <= b.min.y + 0.05) { p.pos.y = b.min.y - H; p.vel.y = 0; continue; }   // bumped your head
    const dx1 = b.max.x - (p.pos.x - R), dx2 = (p.pos.x + R) - b.min.x, dz1 = b.max.z - (p.pos.z - R), dz2 = (p.pos.z + R) - b.min.z;
    const mn = Math.min(dx1, dx2, dz1, dz2);
    if (mn === dx1) p.pos.x += dx1; else if (mn === dx2) p.pos.x -= dx2; else if (mn === dz1) p.pos.z += dz1; else p.pos.z -= dz2;
  }
  // the ground under you
  let ground = Math.abs(p.pos.x) <= 100 && Math.abs(p.pos.z) <= 100 ? 0 : -Infinity;
  for (const b of C) {
    if (b.water || p.pos.x + R * 0.7 <= b.min.x || p.pos.x - R * 0.7 >= b.max.x || p.pos.z + R * 0.7 <= b.min.z || p.pos.z - R * 0.7 >= b.max.z) continue;
    if (b.max.y <= p.pos.y + 0.05 && b.max.y > ground) ground = b.max.y;
  }
  if (p.pos.y <= ground) { p.pos.y = ground; if (p.vel.y < 0) p.vel.y = 0; p.onGround = true; }
  else p.onGround = p.pos.y - ground < 0.05;
}

function updateCamera(dt, t) {
  const cam = G.camera;
  if (G.titleCam) {   // the title screen: a slow flight around the map
    const a = t * 0.06;
    cam.position.set(Math.cos(a) * 70, 34 + Math.sin(t * 0.2) * 4, Math.sin(a) * 70);
    cam.lookAt(0, 8, 0);
    return;
  }
  const p = G.player.pos, c = G.cam;
  const target = new THREE.Vector3(p.x, p.y + 4.2, p.z);
  const off = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch)).multiplyScalar(c.dist);
  const want = target.clone().add(off);
  if (want.y < 1) want.y = 1;
  cam.position.lerp(want, 1 - Math.exp(-dt * 14));
  cam.lookAt(target);
}

function updateOthers(dt, t) {
  for (const o of G.others.values()) {
    const visible = o.placed && G.net && G.net.streaming;
    o.avatar.root.visible = visible;
    if (!visible) continue;
    const before = o.pos.clone();
    o.pos.lerp(o.target, 1 - Math.exp(-dt * 10));
    let d = o.targetYaw - o.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); o.yaw += d * Math.min(1, dt * 10);
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
    if (near) el.innerHTML = `<kbd>${G.touch ? 'E' : 'E'}</kbd> ${esc(G.world.places[near].label)}`;
    $q('.oc-act').classList.toggle('ready', !!near);
  }
}
function interact() {
  if (!G.near) return;
  if (G.near === 'mixer') openPanel('mixer');
  else if (G.near === 'jester') openPanel('jester');
  else if (G.near === 'finn') openPanel('finn');
  else if (G.near === 'fish') openPanel('fish');
}
const EGG_REWARD = { duck: { coins: 500 }, cave: { coins: 1500 }, tower: { coins: 2500 }, glitch: { void: 1 }, sun: { coins: 1000 } };
function checkEggs() {
  const p = G.player.pos, eggs = G.world.eggs;
  for (const [id, e] of Object.entries(eggs)) {
    let inside;
    if (e.box) inside = p.x > e.box.min.x && p.x < e.box.max.x && p.z > e.box.min.z && p.z < e.box.max.z && p.y < e.box.max.y;
    else inside = Math.hypot(p.x - e.pos.x, p.z - e.pos.z) < e.r && Math.abs(p.y - e.pos.y) < 4;
    if (!inside) continue;
    if (id === 'glitch' && !G.inNull) { G.inNull = true; glitchTo(G.world.nullRoom.spawn, 'You slipped through a glitch…'); }
    if (G.save.eggs[id]) continue;
    G.save.eggs[id] = true;
    const r = EGG_REWARD[id] || {};
    if (r.coins) G.save.coins += r.coins;
    if (r.void) G.save.void += r.void;
    const found = Object.keys(G.save.eggs).length;
    toast(`Secret found: ${e.name}! (${found}/5)  +${r.coins ? fmt(r.coins) + ' coins' : r.void + ' Void Coin'}`, 'gold');
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

// ---------------- luck and speed ----------------
function activeEffects() { const n = now(); G.effects = G.effects.filter(e => e.until > n); return G.effects; }
function luckBonus() {
  let add = 0;
  for (const e of activeEffects()) add += POTION[e.id].luck || 0;
  for (const it of ITEMS) if (it.luck && hasItem(it.id) && (!it.when || it.when === G.env.time)) add += it.luck;
  return add;
}
function speedNow() {
  let add = 0;
  for (const e of activeEffects()) add += POTION[e.id].speed || 0;
  for (const it of ITEMS) if (it.speed && hasItem(it.id)) add += it.speed;
  return 1 + add;
}
const tenthRoll = () => (G.save.rolls + 1) % 10 === 0;
function luckNow() { return (1 + luckBonus()) * (tenthRoll() ? 2 : 1); }

// ---------------- rolling ----------------
async function rollOnce() {
  if (!G || !G.playing || G.rolling || now() < G.nextRollAt) return;
  G.rolling = true;
  let luck = luckNow(), used = null;
  if (G.queued.length) { used = G.queued.shift(); luck += POTION[used].oneRoll; }
  const res = rollAura(luck, G.env.time, G.env.weather);
  G.save.rolls++;
  const coins = coinsFor(res.rarity);
  G.save.coins += coins;
  G.save.auras[res.key] = (G.save.auras[res.key] || 0) + 1;
  if (Math.random() < 1 / 1500) { G.save.void++; toast('A Void Coin fell out of your roll!', 'gold'); }
  if (res.rarity > auraKey(G.save.best).rarity) G.save.best = res.key;
  const speed = speedNow();
  const quick = G.save.settings.quick && canQuick();
  if (used) toast(`${POTION[used].name} used on this roll!`);
  markDirty();
  try {
    if (tierIndex(res.rarity) >= 4) await cutscene(res);
    else if (!quick) await rollAnimation(res, speed);
    showResult(res, coins, quick);
  } finally {
    if (G) {
      if (G.save.settings.autoEquip && res.rarity > auraKey(G.save.equipped).rarity) equip(res.key, true);
      if (res.rarity >= 100000 && G.net) G.net.announce({ name: G.me.name, key: res.key, rarity: res.rarity });
      G.nextRollAt = now() + ROLL_COOLDOWN_MS / speed;
      G.rolling = false;
      updateHud();
    }
  }
}
// Names flicker past, slowing down, then the real one lands. Like the roll in Sol's RNG.
async function rollAnimation(res, speed) {
  const box = $q('.oc-rolltext'), nameEl = $q('.oc-rt-name'), sub = $q('.oc-rt-sub');
  box.classList.remove('hidden', 'land'); box.className = 'oc-rolltext';
  const total = ROLL_ANIM_MS / Math.max(1, speed), frames = 11;
  let elapsed = 0;
  for (let i = 0; i < frames; i++) {
    const a = randomFlicker(i / frames);
    paintName(nameEl, a.name, a);
    sub.textContent = '1 in ' + fmt(a.rarity);
    sound('tick', 300 + i * 40);
    const wait = total * (0.35 * Math.pow(1.32, i)) / 30;
    elapsed += wait;
    await sleep(wait);
    if (!G) return;
  }
}
function randomFlicker(progress) {
  // mostly common names, with the odd rare one for suspense
  let pool = AURAS.filter(a => !a.only);
  const r = Math.random();
  const pick = r < 0.08 + progress * 0.1 ? pool[Math.floor(Math.random() * pool.length)] : pool[Math.floor(Math.random() * 14)];
  return { name: pick.name, rarity: pick.rarity, aura: pick };
}
function paintName(el, text, res) {
  const aura = res.aura || res;
  el.textContent = text;
  const t = aura.title || {};
  el.className = 'oc-rt-name' + (t.bw ? ' bw' : t.rainbow ? ' rainbow' : t.gold ? ' gold' : t.violet ? ' violet' : '');
  el.style.color = t.bw || t.rainbow || t.gold || t.violet ? '' : aura.c;
  el.style.setProperty('--glow', res.mut ? res.mut.color : aura.c);
}
function showResult(res, coins, quick) {
  const box = $q('.oc-rolltext'), nameEl = $q('.oc-rt-name'), sub = $q('.oc-rt-sub');
  box.className = 'oc-rolltext land tier-' + tierOf(res.rarity).id;
  paintName(nameEl, res.name, res);
  sub.innerHTML = `1 in ${fmt(res.rarity)}${res.mut ? ` · <b style="color:${res.mut.color}">${res.mut.name}!</b>` : ''} <span class="oc-coin-gain">+${fmt(coins)} coins</span>`;
  sound('land', tierIndex(res.rarity));
  clearTimeout(G.rollHide);
  G.rollHide = setTimeout(() => G && box.classList.add('hidden'), quick ? 1300 : 2400);
}
// The big reveal for very rare auras: the screen goes dark, light bursts, and the name arrives.
// 『EQUINOX』 and 『EQUILIBRIUM INCARNATE』: a white ball and a black ball circle each other, then merge.
async function cutscene(res) {
  const cut = $q('.oc-cut'), tier = tierOf(res.rarity), bw = res.aura.title && res.aura.title.bw;
  G.panelBlocksAuto = true;
  cut.className = `oc-cut tier-${tier.id}${bw ? ' bw' : ''}`;
  cut.style.setProperty('--c', res.mut ? res.mut.color : res.aura.c);
  cut.innerHTML = `<div class="cut-bg"></div><div class="cut-rays"></div>${bw ? '<div class="cut-orb w"></div><div class="cut-orb b"></div>' : '<div class="cut-star"></div>'}
    <div class="cut-flash"></div><div class="cut-name"></div><div class="cut-sub">1 in ${fmt(res.rarity)}</div><button type="button" class="cut-skip">Skip</button>`;
  const cutName = cut.querySelector('.cut-name');
  paintName(cutName, res.name, res);
  cutName.classList.add('cut-name');
  sound('cut', tierIndex(res.rarity));
  const dur = bw ? 6500 : tierIndex(res.rarity) >= 6 ? 5200 : 4000;
  await new Promise(resolve => {
    const done = () => { clearTimeout(tm); resolve(); };
    const tm = setTimeout(done, dur);
    cut.querySelector('.cut-skip').onclick = done;
  });
  if (!G) return;
  cut.classList.add('out');
  setTimeout(() => { if (G) { cut.className = 'oc-cut hidden'; cut.innerHTML = ''; } }, 500);
  G.panelBlocksAuto = false;
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
    G.save.quickRoll = true; toast('Quick Roll unlocked! Rolls skip the animation while it\'s on.', 'gold'); sound('secret');
  }
  G.save.settings.quick = !G.save.settings.quick; refreshToggles(); markDirty();
}
function refreshToggles() {
  const a = $q('.oc-auto'), q = $q('.oc-quick');
  a.classList.toggle('on', !!G.save.settings.auto && canAuto()); a.querySelector('small').textContent = !canAuto() ? 'Premium' : G.save.settings.auto ? 'ON' : 'OFF';
  q.classList.toggle('on', !!G.save.settings.quick && canQuick()); q.querySelector('small').textContent = !canQuick() ? '5,000 Orbs' : G.save.settings.quick ? 'ON' : 'OFF';
}

// ---------------- the HUD ----------------
function updateHud(force) {
  if (!G) return;
  const s = G.save, env = G.env, n = now();
  // buffs
  const effects = activeEffects();
  const chips = effects.map(e => { const p = POTION[e.id]; return `<div class="oc-buff" style="--c:${p.color}">${potionIcon(p.color)}<span>${esc(p.name)}</span><b>${fmtTime(e.until - n)}</b></div>`; });
  G.queued.forEach(id => chips.push(`<div class="oc-buff next" style="--c:${POTION[id].color}">${potionIcon(POTION[id].color)}<span>${esc(POTION[id].name)}</span><b>next roll</b></div>`));
  const luck = luckNow(), speed = speedNow();
  chips.unshift(`<div class="oc-stats"><span>Luck <b>x${luck.toFixed(2).replace(/\.00$/, '')}</b></span><span>Speed <b>x${speed.toFixed(2).replace(/\.00$/, '')}</b></span><span>Rolls <b>${fmt(s.rolls)}</b></span>${tenthRoll() ? '<span class="lucky">Next roll is x2 lucky!</span>' : ''}</div>`);
  $q('.oc-buffs').innerHTML = chips.join('');
  // world
  const w = WEATHERS[env.weather];
  const ws = G.worldState || {};
  const jest = env.jester ? `<span class="oc-chip jester">Jester is here${ws.jesterUntil > n ? ' · ' + fmtTime(ws.jesterUntil - n) : ''}</span>` : `<span class="oc-chip dim">Jester in ${fmtTime(nextJesterIn(n))}</span>`;
  const left = 600000 - (n % 600000);
  $q('.oc-world').innerHTML = `<span class="oc-chip ${env.time}">${env.time === 'day' ? '☀ Day' : '☾ Night'} · ${fmtTime(ws.time && ws.time.until > n ? ws.time.until - n : left)}</span>` +
    `<span class="oc-chip w-${env.weather}" title="${esc(w.desc)}">${w.icon} ${w.name}</span>${jest}<span class="oc-chip dim">${G.net ? G.net.count : 1} in lobby</span>`;
  $q('.oc-money').innerHTML = `<span class="oc-cur coin"><i>C</i>${fmt(s.coins)}</span><span class="oc-cur f"><i>F</i>${fmt(s.f)}</span><span class="oc-cur void"><i>V</i>${fmt(s.void)}</span>`;
  $q('.oc-roll-luck').textContent = G.rolling ? 'Rolling…' : `Luck x${luck.toFixed(2).replace(/\.00$/, '')}`;
  const rb = $q('.oc-roll');
  rb.classList.toggle('busy', G.rolling || n < G.nextRollAt);
  if (G.panel === 'inventory' || G.panel === 'auras') { /* keep counts fresh without rebuilding while open */ }
}
const potionIcon = (c) => `<svg class="oc-potion" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6v2h-1v4.2l4.6 7.9A3.3 3.3 0 0 1 15.8 21H8.2a3.3 3.3 0 0 1-2.8-4.9L10 8.2V4H9z" fill="rgba(255,255,255,.18)" stroke="rgba(255,255,255,.7)" stroke-width="1"/><path d="M7.2 14h9.6l1.4 2.4A2 2 0 0 1 16.5 19.5h-9A2 2 0 0 1 5.8 16.4z" fill="${c}"/></svg>`;

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
  const { aura, mut, name } = auraKey(a.key);
  const el = $q('.oc-announce');
  el.innerHTML = `<span>${esc(a.name)} HAS FOUND</span> <b class="oc-ann-name"></b> <span>CHANCE OF 1 IN ${fmt(a.rarity)}</span>`;
  const n = el.querySelector('.oc-ann-name'); paintName(n, name, { aura, mut }); n.classList.add('oc-ann-name');
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  sound('announce');
}
function announceWeather(w) {
  const W = WEATHERS[w];
  if (w === 'clear') toast('The weather has cleared.');
  else { toast(`${W.icon} ${W.name} has started! ${W.desc}`, 'gold'); sound('weather'); }
}

// ---------------- panels ----------------
function openPanel(id) {
  G.panel = id;
  const box = $q('.oc-panel'), head = box.querySelector('h2'), body = box.querySelector('.oc-panel-body');
  box.classList.remove('hidden');
  box.dataset.panel = id;
  const titles = { auras: 'Aura Storage', inventory: 'Items & Potions', settings: 'Settings', admin: 'Admin Panel', mixer: "Mixer's Brewery", jester: 'The Jester', finn: "Old Finn's Bait & Tackle", fish: 'Fishing' };
  head.textContent = titles[id] || '';
  ({ auras: renderAuras, inventory: renderInventory, settings: renderSettings, admin: renderAdmin, mixer: () => renderShop('mixer'), jester: () => renderShop('jester'), finn: () => renderShop('finn'), fish: renderFishing })[id](body);
}
function closePanel() {
  if (!G) return;
  if (G.fishing) { clearTimeout(G.fishing.timer); G.fishing = null; }
  G.panel = null;
  $q('.oc-panel').classList.add('hidden');
}

function renderAuras(body, filter = G.auraFilter || 'owned') {
  G.auraFilter = filter;
  const keys = new Set(Object.keys(G.save.auras).filter(k => G.save.auras[k] > 0));
  if (owner()) AURAS.forEach(a => keys.add(a.id));
  const list = filter === 'owned' ? [...keys].map(auraKey) : AURAS.map(a => auraKey(a.id));
  list.sort((a, b) => b.rarity - a.rarity);
  body.innerHTML = `<div class="oc-tabs"><button type="button" data-f="owned" class="${filter === 'owned' ? 'on' : ''}">Yours (${keys.size})</button><button type="button" data-f="all" class="${filter === 'all' ? 'on' : ''}">Collection (${AURAS.length})</button></div>
    <div class="oc-aura-grid">${list.map(r => {
      const have = auraCount(r.key) > 0, eq = G.save.equipped === r.key, tier = tierOf(r.rarity);
      const only = r.aura.only ? (r.aura.only.time ? (r.aura.only.time === 'day' ? 'Day only' : 'Night only') : WEATHERS[r.aura.only.weather].name + ' only') : '';
      return `<div class="oc-aura-card ${have ? '' : 'locked'} ${eq ? 'eq' : ''}" style="--c:${r.mut ? r.mut.color : r.aura.c};--t:${tier.color}">
        <div class="oc-ac-name" data-key="${esc(r.key)}"></div>
        <div class="oc-ac-meta"><span class="tier" style="color:${tier.color}">${tier.label}</span> · 1 in ${fmt(r.rarity)}${only ? ` · <i>${only}</i>` : ''}</div>
        <div class="oc-ac-foot"><span>${have ? 'x' + fmt(auraCount(r.key)) : 'Not found yet'}</span>${have ? `<button type="button" data-equip="${esc(r.key)}" ${eq ? 'disabled' : ''}>${eq ? 'Equipped' : 'Equip'}</button>` : ''}</div></div>`;
    }).join('')}</div>`;
  body.querySelectorAll('.oc-ac-name').forEach(el => { const r = auraKey(el.dataset.key); paintName(el, auraCount(r.key) > 0 || filter === 'owned' ? r.name : '???', r); el.classList.add('oc-ac-name'); });
  body.querySelectorAll('[data-f]').forEach(b => b.onclick = () => renderAuras(body, b.dataset.f));
  body.querySelectorAll('[data-equip]').forEach(b => b.onclick = () => { equip(b.dataset.equip); renderAuras(body); });
}

function renderInventory(body) {
  const pots = POTIONS.filter(p => potionCount(p.id) > 0);
  const items = ITEMS.filter(i => hasItem(i.id));
  body.innerHTML = `<div class="oc-money-big"><span class="oc-cur coin"><i>C</i>${fmt(G.save.coins)} coins</span><span class="oc-cur f"><i>F</i>${fmt(G.save.f)} F</span><span class="oc-cur void"><i>V</i>${fmt(G.save.void)} Void Coins</span></div>
    <h3>Potions</h3>${pots.length ? `<div class="oc-list">${pots.map(p => `<div class="oc-row" style="--c:${p.color}">${potionIcon(p.color)}<div class="oc-row-text"><b>${esc(p.name)}</b><span>${esc(p.desc)}</span></div><span class="oc-count">x${fmt(potionCount(p.id))}</span><button type="button" data-use="${p.id}">Use</button></div>`).join('')}</div>` : '<p class="oc-empty">No potions yet. Buy some from the Mixer, Old Finn or the Jester.</p>'}
    <h3>Gear</h3>${items.length ? `<div class="oc-list">${items.map(i => `<div class="oc-row" style="--c:${i.color}"><span class="oc-gear" style="background:${i.color}"></span><div class="oc-row-text"><b>${esc(i.name)}</b><span>${esc(i.desc)}</span></div><span class="oc-count on">Active</span></div>`).join('')}</div>` : '<p class="oc-empty">No gear yet.</p>'}
    <h3>Secrets found</h3><p class="oc-empty">${Object.keys(G.save.eggs).length} of 5. Look around the map!</p>`;
  body.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { usePotion(b.dataset.use); renderInventory(body); });
}
function usePotion(id) {
  const p = POTION[id];
  if (potionCount(id) < 1) return;
  if (p.oneRoll) G.queued.push(id);
  else {
    if (p.group) {
      const other = activeEffects().find(e => POTION[e.id].group === p.group && e.id !== id);
      if (other) { toast(`${POTION[other.id].name} is already active. You can't use two levels at once.`, 'warn'); return; }
    }
    const cur = G.effects.find(e => e.id === id);
    if (cur) cur.until += p.secs * 1000; else G.effects.push({ id, until: now() + p.secs * 1000 });
  }
  if (!owner()) G.save.potions[id] = (G.save.potions[id] || 0) - 1;
  toast(p.oneRoll ? `${p.name} is ready. It works on your next roll.` : `${p.name} is working!`, 'gold');
  sound('potion'); markDirty(); updateHud();
}

const SHOPS = {
  mixer: { intro: 'Bubble, bubble! Potions for luck and speed, and gear that lasts.', potions: ['lucky', 'speed', 'fortune1', 'fortune2', 'fortune3', 'haste1', 'haste2', 'haste3', 'heavenly1', 'heavenly2'], items: ['gloves', 'boots', 'solarlens', 'moonlocket'] },
  finn: { intro: 'Ahoy. Fish at the end of the dock for F. I take F for my wares.', potions: ['diver', 'warp', 'godlike'], items: ['goldrod', 'voidlantern'] },
  jester: { intro: 'Hehehe… Bring me five Void Coins and I\'ll give you something… oblivious.', potions: ['oblivion', 'heavenly2', 'godlike'], items: [] },
};
const priceText = pr => pr.coins ? `${fmt(pr.coins)} coins` : pr.f ? `${fmt(pr.f)} F` : `${pr.void} Void Coins`;
const canAfford = pr => owner() || (pr.coins ? G.save.coins >= pr.coins : pr.f ? G.save.f >= pr.f : G.save.void >= pr.void);
function renderShop(id, body = $q('.oc-panel-body')) {
  if (id === 'jester' && !G.env.jester) { body.innerHTML = '<p class="oc-empty">The Jester has left. He comes back every 4 hours.</p>'; return; }
  const sh = SHOPS[id];
  const row = (thing, isItem) => {
    const owned = isItem && hasItem(thing.id), price = thing.price;
    return `<div class="oc-row" style="--c:${thing.color}">${isItem ? `<span class="oc-gear" style="background:${thing.color}"></span>` : potionIcon(thing.color)}
      <div class="oc-row-text"><b>${esc(thing.name)}</b><span>${esc(thing.desc)}</span></div>
      <span class="oc-price ${canAfford(price) ? '' : 'no'}">${owner() ? 'Free (Owner)' : priceText(price)}</span>
      <button type="button" data-buy="${isItem ? 'item' : 'potion'}:${thing.id}" ${owned || !canAfford(price) ? 'disabled' : ''}>${owned ? 'Owned' : id === 'jester' && thing.price.void ? 'Trade' : 'Buy'}</button></div>`;
  };
  body.innerHTML = `<p class="oc-intro">${esc(sh.intro)}</p><div class="oc-money-big"><span class="oc-cur coin"><i>C</i>${fmt(G.save.coins)}</span><span class="oc-cur f"><i>F</i>${fmt(G.save.f)}</span><span class="oc-cur void"><i>V</i>${fmt(G.save.void)}</span></div>
    <div class="oc-list">${sh.potions.map(p => row(POTION[p], false)).join('')}${sh.items.map(i => row(ITEM[i], true)).join('')}</div>`;
  body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { const [kind, tid] = b.dataset.buy.split(':'); buy(kind, tid); renderShop(id, body); });
}
function buy(kind, id) {
  const thing = kind === 'item' ? ITEM[id] : POTION[id], pr = thing.price;
  if (!canAfford(pr)) { toast('You can\'t afford that yet.', 'warn'); return; }
  if (!owner()) { if (pr.coins) G.save.coins -= pr.coins; else if (pr.f) G.save.f -= pr.f; else G.save.void -= pr.void; }
  if (kind === 'item') G.save.items[id] = true; else G.save.potions[id] = (G.save.potions[id] || 0) + 1;
  toast(`You got ${thing.name}!`, 'gold'); sound('coin'); markDirty(); updateHud();
}

// Fishing: cast, wait for a bite, then reel in fast.
function renderFishing(body) {
  const boost = (hasItem('goldrod') ? 0.5 : 0) + (activeEffects().some(e => e.id === 'diver') ? 1 : 0);
  body.innerHTML = `<div class="oc-fish"><div class="oc-fish-water"><span class="bob"></span><span class="ripple"></span></div><p class="oc-fish-msg">Cast your line into the pond.</p><button type="button" class="oc-btn oc-fish-btn">Cast</button>
    <p class="oc-fish-note">Catch F (blue coins). Sometimes a Void Coin bites. ${boost ? `<b>Bites ${Math.round(boost * 100)}% faster.</b>` : ''}</p></div>`;
  const btn = body.querySelector('.oc-fish-btn'), msg = body.querySelector('.oc-fish-msg'), water = body.querySelector('.oc-fish-water');
  const cast = () => {
    G.fishing = { state: 'wait' };
    water.className = 'oc-fish-water cast'; msg.textContent = 'Waiting for a bite…'; btn.textContent = 'Reel in'; btn.disabled = true;
    sound('cast');
    G.fishing.timer = setTimeout(() => {
      if (!G || !G.fishing) return;
      G.fishing.state = 'bite'; water.className = 'oc-fish-water bite'; msg.textContent = 'Something bit! Reel it in!'; btn.disabled = false; btn.classList.add('flash');
      sound('bite');
      G.fishing.timer = setTimeout(() => { if (!G || !G.fishing) return; G.fishing = null; water.className = 'oc-fish-water'; msg.textContent = 'It got away… Cast again.'; btn.textContent = 'Cast'; btn.classList.remove('flash'); }, 1100);
    }, (2500 + Math.random() * 4500) / (1 + boost));
  };
  btn.onclick = () => {
    if (!G.fishing) { cast(); return; }
    if (G.fishing.state !== 'bite') return;
    clearTimeout(G.fishing.timer); G.fishing = null; btn.classList.remove('flash'); btn.textContent = 'Cast'; water.className = 'oc-fish-water';
    const voidChance = (1 / 25) * (hasItem('voidlantern') ? 2 : 1);
    if (Math.random() < voidChance) { G.save.void++; msg.innerHTML = 'You caught a <b class="void">Void Coin</b>!'; sound('secret'); }
    else if (Math.random() < 1 / 60) { G.save.f += 25; msg.innerHTML = 'A <b class="f">Golden Fish</b>! +25 F'; sound('coin'); }
    else { const f = Math.ceil((1 + Math.floor(Math.random() * 4)) * (hasItem('goldrod') ? 1.5 : 1)); G.save.f += f; msg.innerHTML = `You caught <b class="f">${f} F</b>.`; sound('coin'); }
    markDirty(); updateHud();
  };
}

function renderSettings(body) {
  const s = G.save.settings;
  const quality = G.quality;
  body.innerHTML = `<div class="oc-set"><label><input type="checkbox" data-s="autoEquip" ${s.autoEquip ? 'checked' : ''}> Equip rarer auras automatically</label>
    <label><input type="checkbox" data-s="sound" ${s.sound ? 'checked' : ''}> Sound effects</label>
    <div class="oc-set-row"><span>Graphics</span>${['low', 'medium', 'high'].map(q => `<button type="button" data-q="${q}" class="${q === quality ? 'on' : ''}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div>
    <p class="oc-empty">Graphics changes apply next time you open the game.</p>
    <div class="oc-keys"><b>Controls</b><span>WASD / arrows: move · Space: jump · Drag: turn the camera · Wheel: zoom</span><span>R: roll · E: talk / fish · F: aura attack (PvP on)</span></div>
    <p class="oc-empty">Your best aura: <b class="oc-best"></b> · ${fmt(G.save.rolls)} rolls</p></div>`;
  const best = auraKey(G.save.best), bestEl = body.querySelector('.oc-best');
  paintName(bestEl, best.name, best); bestEl.classList.add('oc-best');
  body.querySelectorAll('[data-s]').forEach(c => c.onchange = () => { s[c.dataset.s] = c.checked; markDirty(); });
  body.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { try { localStorage.setItem('ocrng.quality', b.dataset.q); } catch (e) {} body.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('on', x === b)); });
}

// The Owner and Co-Owners: start weather, change the time, summon the Jester, fly and noclip.
function renderAdmin(body) {
  if (!G.me.staff) { body.innerHTML = ''; return; }
  const ws = G.worldState || {}, n = now();
  const btn = (act, label, on) => `<button type="button" data-a="${act}" class="${on ? 'on' : ''}">${label}</button>`;
  body.innerHTML = `<div class="oc-admin">
    <h3>Weather events <small>5 minutes, for everyone</small></h3><div class="oc-admin-row">${Object.values(WEATHERS).filter(w => w.id !== 'clear').map(w => btn('w:' + w.id, `${w.icon} ${w.name}`, ws.weather && ws.weather.type === w.id && ws.weather.until > n)).join('')}${btn('w:stop', 'Stop weather')}</div>
    <h3>Time <small>10 minutes</small></h3><div class="oc-admin-row">${btn('t:day', '☀ Force day', ws.time && ws.time.mode === 'day' && ws.time.until > n)}${btn('t:night', '☾ Force night', ws.time && ws.time.mode === 'night' && ws.time.until > n)}${btn('t:stop', 'Back to normal')}</div>
    <h3>The Jester <small>15 minutes</small></h3><div class="oc-admin-row">${btn('j:on', 'Summon the Jester', ws.jesterUntil > n)}${btn('j:off', 'Send him away')}</div>
    <h3>Movement <small>just you</small></h3><div class="oc-admin-row">${btn('m:fly', 'Fly', G.player.fly)}${btn('m:noclip', 'Noclip', G.player.noclip)}${btn('m:spawn', 'Back to spawn')}</div>
    <p class="oc-empty">Fly: Space goes up, Shift goes down.</p>
    <div class="oc-admin-row">${btn('x:clear', 'End every event')}</div></div>`;
  body.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { adminAction(b.dataset.a); setTimeout(() => G && G.panel === 'admin' && renderAdmin(body), 300); });
}
function adminAction(a) {
  const [k, v] = a.split(':'), n = now(), net = G.net;
  if (!G.me.staff || !net) return;
  if (k === 'w') { net.setWorld({ weather: v === 'stop' ? null : { type: v, until: n + 5 * 60000, by: G.me.name } }); toast(v === 'stop' ? 'Weather stopped.' : `${WEATHERS[v].name} started for everyone.`); }
  if (k === 't') { net.setWorld({ time: v === 'stop' ? null : { mode: v, until: n + 10 * 60000, by: G.me.name } }); toast(v === 'stop' ? 'Time is back to normal.' : `It's ${v} for everyone now.`); }
  if (k === 'j') { net.setWorld({ jesterUntil: v === 'on' ? n + 15 * 60000 : 0 }); toast(v === 'on' ? 'The Jester has been summoned.' : 'The Jester has gone.'); }
  if (k === 'm') {
    if (v === 'fly') { G.player.fly = !G.player.fly; G.player.vel.y = 0; toast(G.player.fly ? 'Fly on.' : 'Fly off.'); }
    if (v === 'noclip') { G.player.noclip = !G.player.noclip; toast(G.player.noclip ? 'Noclip on. You go through walls.' : 'Noclip off.'); }
    if (v === 'spawn') { G.player.pos.copy(G.world.spawn); G.player.vel.set(0, 0, 0); }
  }
  if (k === 'x') { net.clearWorld(); toast('Every event ended.'); }
}

// ---------------- PvP and aura attacks ----------------
function togglePvp() {
  const p = G.player;
  p.pvp = !p.pvp; p.hp = 100;
  $q('.oc-pvp-btn').textContent = p.pvp ? 'PvP ON' : 'PvP OFF';
  $q('.oc-pvp-btn').classList.toggle('on', p.pvp);
  $q('.oc-hp').classList.toggle('hidden', !p.pvp); $q('.oc-attack').classList.toggle('hidden', !p.pvp);
  updateHp();
  p.avatar.tag.userData.draw(G.me.name, G.save.equipped, p.pvp ? p.hp : null);
  if (G.net) G.net.update({ pvp: p.pvp });
  toast(p.pvp ? 'PvP is on. Press F (or ATTACK) to use your aura\'s attack. Only players with PvP on can be hit.' : 'PvP is off. Nobody can hit you.');
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
    toast(`${h.by || 'Someone'} knocked you out with ${h.aura || 'their aura'}!`, 'warn');
    p.hp = 100; p.pos.copy(G.world.spawn); p.vel.set(0, 0, 0); p.knock = null;
  }
  updateHp();
  p.avatar.tag.userData.draw(G.me.name, G.save.equipped, p.hp);
}
// An expanding ring of the aura's colour, bigger for rarer auras.
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
