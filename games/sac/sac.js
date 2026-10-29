// Steal a Character: a 3D multiplayer game inside Frixion, in the buy-and-steal genre. Characters parade down the
// runway: buy them and they stand on the pedestals in your base, earning money every second (step on the cash button
// in front of each pedestal to collect it). Walk into someone else's base, grab one of theirs and carry it home to make it yours, while they chase
// you with a Bonk Bat or a Freeze Ray. Lock your base with a force field for 40 seconds when thieves come. Gear from
// the Gear Shop goes in your backpack and on the hotbar (1 to 9). Rebirth for more income and more pads.
// Every character, the map and the gear are original to Frixion.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { buildAvatar, shirtColorFor } from '../ocrng/avatar.js';
import { createChat } from '../ocrng/chat.js';
import { CHARACTERS, CHAR, RARITY, RARITIES, MUTATIONS, GEARS, GEAR, RUNWAY, LIFE, slotChar, keyOf, parseKey, nameOf, priceOf, incomeOf, rebirthCost, padsFor, START_COINS, fmt } from './sacdata.js';
import { makeCharacter, tickRainbow } from './sacchars.js';
import { createWorld } from './sacworld.js';
import { createSacNet } from './sacnet.js';

const VERSION = '1.0';
const API = () => window.FrixionGameAPI;
const WALK = 16, JUMP = 24, GRAVITY = 72, STEP = 1.25, R = 0.6, H = 5;
const LOCK_FOR = 40000, LOCK_EVERY = 60000, CARRY_MAX = 60000, OFFLINE_SHARE = 0.25, OFFLINE_MAX = 3600;
let G = null;
const now = () => Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $q = s => G.root.querySelector(s);
const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); G.listeners.push(() => el.removeEventListener(ev, fn, opt)); };
const sNow = () => (G && G.net ? G.net.serverNow() : now());
const opfun = () => !!(G && G.me.owner && G.save && G.save.settings.opfun);

// ---------------- opening and closing ----------------
export async function open() {
  if (G) return;
  const cssReady = ensureCss();
  const api = API(), me = api.me(), rank = api.rank();
  G = {
    me: { uid: me.uid, name: me.name, owner: rank >= 3, staff: rank >= 2 },
    root: null, listeners: [], others: new Map(), input: { keys: {}, joy: { x: 0, y: 0 } }, cam: { yaw: Math.PI, pitch: 0.32, dist: 18 },
    panel: null, effects: [], parade: new Map(), walkers: [], padModels: new Map(), padsData: {}, baseOwner: {}, baseOf: {}, steals: {},
    traps: new Map(), carry: null, gearCd: {}, held: -1, alerts: new Set(), sold: new Map(), closed: false, cssReady,
  };
  G.root = buildShell();
  G.root.style.cssText = 'position:fixed;inset:0;z-index:2147482000;overflow:hidden;background:#8fd3ff';   // full screen before the stylesheet arrives
  document.body.appendChild(G.root);
  document.body.classList.add('sac-open');
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__sacDebug = { state: () => G, panel: id => openPanel(id), give: (c, m) => ownerGive(c, m) };
  try {
    setLoading('Starting the engine', 0.15);
    await G.cssReady;
    G.quality = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4 ? 'low' : 'high';
    setupRenderer();
    setLoading('Building the city', 0.35);
    await sleep(30);
    G.world = createWorld(G.scene, G.quality);
    setLoading('Loading your base', 0.6);
    await loadSave();
    buildPlayer();
    setupNet();
    setLoading('Finding you a base', 0.8);
    await claimBase();
    setupInput();
    G.clock = new THREE.Clock();
    loop();
    setLoading('Ready', 1);
    await sleep(300);
    $q('.sac-loading').classList.add('hidden');
    G.playing = true;
    updateHud(); renderHotbar();
    if (G.offline > 0) toast(`While you were away your characters earned $${fmt(G.offline)}. Collect it from the cash buttons in your base.`, 'gold');
  } catch (e) {
    console.error(e);
    api.toast('Steal a Character hit a problem while loading. Try again in a moment.', 'error');
    close();
  }
}
export function close() {
  if (!G || G.closed) return;
  G.closed = true;
  try { saveNow(); } catch (e) {}
  if (G.carry && G.net) G.net.drop(G.carry.victim, G.carry.pad);
  if (G.net) G.net.leave();
  if (G.chat) G.chat.destroy();
  cancelAnimationFrame(G.raf);
  clearInterval(G.slowTimer);
  G.listeners.forEach(f => f());
  if (G.renderer) { G.renderer.dispose(); G.renderer.forceContextLoss && G.renderer.forceContextLoss(); }
  G.root.remove();
  document.body.classList.remove('sac-open');
  G = null;
}

function ensureCss() {
  if (!document.getElementById('ocrng-font')) { const f = document.createElement('link'); f.id = 'ocrng-font'; f.rel = 'stylesheet'; f.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800;900&display=swap'; document.head.appendChild(f); }
  const href = new URL('./sac.css?v=' + VERSION, import.meta.url).href;
  let l = document.querySelector('link[data-sac-css]');
  if (!l) { l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.dataset.sacCss = '1'; document.head.appendChild(l); }
  // the game waits for its stylesheet (at most 4 seconds), so nothing is measured before it's laid out
  return l.sheet ? Promise.resolve() : new Promise(r => { l.addEventListener('load', r, { once: true }); l.addEventListener('error', r, { once: true }); setTimeout(r, 4000); });
}
const ICON = {
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  shop: '<svg viewBox="0 0 24 24"><path d="M4 9h16l-1.5 11h-13z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/></svg>',
  bag: '<svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="13" rx="2"/><path d="M9 7V5h6v2M5 12h14"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/></svg>',
  rebirth: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
};
// the gear icons on the hotbar and in the backpack
const GEAR_ICON = {
  bat: '<path d="M5 19l9-9" stroke-width="3.4"/><path d="M13 11l5-5a2 2 0 0 1 3 3l-5 5z"/>',
  sneakers: '<path d="M3 16h17a2 2 0 0 1 0 4H3zM3 16l1-7h5l2 3 6 2"/>',
  springs: '<path d="M6 20h12M8 16c4 0 4-3 8-3M8 13c4 0 4-3 8-3M8 10c4 0 4-3 8-3"/>',
  smoke: '<circle cx="9" cy="14" r="4"/><circle cx="15" cy="12" r="5"/><path d="M12 5v3"/>',
  grapple: '<path d="M4 20l9-9M13 11l2-6 2 4 4 2-6 2z"/>',
  trap: '<path d="M4 17h16M6 17l3-6 3 6 3-6 3 6"/>',
  freeze: '<path d="M12 3v18M4 7.5l16 9M4 16.5l16-9"/>',
  rocket: '<path d="M12 3c4 3 5 8 3 13H9C7 11 8 6 12 3z"/><path d="M9 16l-2 4M15 16l2 4M12 16v5"/>',
};
const gearSvg = id => `<svg viewBox="0 0 24 24">${GEAR_ICON[id] || ''}</svg>`;

function buildShell() {
  const root = document.createElement('div');
  root.id = 'sac';
  root.innerHTML = `
    <canvas class="sac-canvas"></canvas>
    <div class="sac-loading"><div class="sac-load-card"><h1>STEAL A CHARACTER</h1><div class="sac-bar"><i></i></div><p>Loading</p></div></div>
    <div class="sac-hud">
      <div class="sac-top"><button type="button" class="sac-x" title="Leave">${ICON.close}</button><button type="button" class="sac-chat-btn" title="Chat">${ICON.chat}</button></div>
      <div class="sac-money"><b>$0</b><small>+$0/s</small></div>
      <div class="sac-side">
        <button type="button" data-panel="shop">${ICON.shop}<span>Shop</span></button>
        <button type="button" data-panel="bag">${ICON.bag}<span>Backpack</span></button>
        <button type="button" data-panel="index">${ICON.book}<span>Index</span></button>
        <button type="button" data-panel="rebirth">${ICON.rebirth}<span>Rebirth</span></button>
        <button type="button" data-panel="settings">${ICON.gear}<span>Settings</span></button>
      </div>
      <button type="button" class="sac-lock">${ICON.lock}<b>Lock base</b><small></small></button>
      <div class="sac-banner hidden"></div>
      <div class="sac-alert hidden"></div>
      <div class="sac-prompt hidden"><kbd>E</kbd><span></span></div>
      <div class="sac-hotbar"></div>
      <div class="sac-toasts"></div>
      <div class="sac-touch hidden"><div class="sac-joy"><i></i></div><button type="button" class="sac-jump">Jump</button><button type="button" class="sac-act hidden">E</button><button type="button" class="sac-use hidden">Use</button></div>
    </div>
    <div class="sac-panel hidden"><div class="sac-panel-box"><div class="sac-panel-head"><h2></h2><button type="button" class="sac-panel-x">${ICON.close}</button></div><div class="sac-panel-body"></div></div></div>`;
  return root;
}
function setLoading(text, k) { const el = G.root.querySelector('.sac-loading'); el.querySelector('p').textContent = text; el.querySelector('i').style.width = Math.round(k * 100) + '%'; }

// ---------------- the renderer and the camera ----------------
function setupRenderer() {
  const cvs = $q('.sac-canvas');
  G.renderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: G.quality !== 'low', powerPreference: 'high-performance' });
  G.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, G.quality === 'low' ? 1 : 1.5));
  G.renderer.outputColorSpace = THREE.SRGBColorSpace;
  G.renderer.shadowMap.enabled = G.quality !== 'low'; G.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  G.scene = new THREE.Scene();
  G.camera = new THREE.PerspectiveCamera(65, 1, 0.3, 1400);
  const resize = () => { const w = G.root.clientWidth, h = G.root.clientHeight; G.renderer.setSize(w, h, false); G.camera.aspect = w / Math.max(1, h); G.camera.updateProjectionMatrix(); };
  resize(); on(window, 'resize', resize);
  // and whenever the game's own box changes size (the stylesheet arriving, the browser zooming, a phone turning)
  if (window.ResizeObserver) { const ro = new ResizeObserver(resize); ro.observe(G.root); G.listeners.push(() => ro.disconnect()); }
}
const _camRay = new THREE.Ray(), _camHit = new THREE.Vector3(), _camBox = new THREE.Box3();
function updateCamera(dt) {
  const c = G.cam, p = G.player.pos, target = new THREE.Vector3(p.x, p.y + 3.6, p.z);
  const dir = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch));
  // a wall between you and the camera brings it in front of the wall, so you never look at the back of one
  let d = c.dist;
  _camRay.set(target, dir);
  for (const b of G.world.colliders) {
    if (b.max.y - b.min.y < 2) continue;
    _camBox.min.copy(b.min); _camBox.max.copy(b.max);
    if (_camRay.intersectBox(_camBox, _camHit)) { const h = _camHit.distanceTo(target); if (h > 0.5 && h < d) d = h; }
  }
  G.camera.position.copy(target).addScaledVector(dir, Math.max(2.5, d - 0.6));
  if (G.camera.position.y < 1) G.camera.position.y = 1;
  G.camera.lookAt(target);
}

// ---------------- your save ----------------
// Firestore sacSaves/{uid}. If the database rules don't allow that collection yet, it lives next to your Overcontrol
// RNG save instead (rngSaves/sac_{uid}), so it saves either way.
function blankSave() {
  return { coins: START_COINS, bank: Array(16).fill(0), pads: Array(16).fill(null), gears: {}, hot: Array(9).fill(null), index: {}, rebirths: 0, stats: { bought: 0, stole: 0, lost: 0, earned: 0 }, last: now(), settings: { sfx: 0.7, opfun: false }, v: 1 };
}
async function loadSave() {
  const db = API().db, refs = [db.collection('sacSaves').doc(G.me.uid), db.collection('rngSaves').doc('sac_' + G.me.uid)];
  let data = null;
  for (const r of refs) {
    try { const d = await r.get(); G.saveRef = r; data = d.exists ? d.data() : {}; break; }
    catch (e) { if (!/permission/i.test(String(e.code || e.message))) { G.loadFailed = true; break; } }
  }
  if (!G.saveRef) G.saveRef = refs[0];
  const b = blankSave(), s = { ...b, ...(data || {}) };
  s.settings = { ...b.settings, ...(s.settings || {}) }; s.stats = { ...b.stats, ...(s.stats || {}) };
  s.pads = Array.from({ length: 16 }, (_, i) => { const p = (s.pads || [])[i]; return p && CHAR[p.c] ? { c: p.c, m: MUTATIONS[p.m] ? p.m : '' } : null; });
  s.hot = Array.from({ length: 9 }, (_, i) => ((s.hot || [])[i] && GEAR[s.hot[i]] ? s.hot[i] : null));
  s.gears = s.gears || {}; s.index = s.index || {};
  s.bank = Array.from({ length: 16 }, (_, i) => Math.max(0, +((s.bank || [])[i]) || 0));
  if (s.pending) { s.coins += Math.floor(s.pending); delete s.pending; }   // from before each pedestal had its own cash button
  // money your characters made while you were away: a quarter of it, for up to an hour, waiting on their cash buttons
  const away = Math.min(OFFLINE_MAX, Math.max(0, (now() - (s.last || now())) / 1000));
  G.save = s; G.offline = 0;
  if (away > 60) s.pads.forEach((p, i) => { if (!p) return; const got = Math.floor(away * incomeOf(p.c, p.m, s.rebirths) * OFFLINE_SHARE); s.bank[i] += got; G.offline += got; });
}
function markDirty() { if (G) G.dirty = true; }
function saveNow() {
  if (!G || !G.save || G.loadFailed || G.kicked) return;
  G.save.last = now(); G.dirty = false;
  const data = JSON.parse(JSON.stringify(G.save));
  G.saveRef.set(data).catch(e => {
    if (/permission/i.test(String(e.code || e.message)) && G && G.saveRef.parent.id === 'sacSaves') { G.saveRef = API().db.collection('rngSaves').doc('sac_' + G.me.uid); G.saveRef.set(data).catch(() => {}); }
  });
}
// income a second, from every character on your pads
const income = () => G.save.pads.reduce((a, p) => a + (p ? incomeOf(p.c, p.m, G.save.rebirths) : 0), 0);
const freePad = () => { const n = padsFor(G.save.rebirths); for (let i = 0; i < n; i++) if (!G.save.pads[i] && !(G.arriving && G.arriving.has(i))) return i; return -1; };
function found(c, m) { const e = G.save.index[c] = G.save.index[c] || {}; const fresh = !e.n; e.n = 1; if (m) e[m] = 1; return fresh; }

// ---------------- the network ----------------
function setupNet() {
  const api = API();
  if (!api.rtdb) return;
  G.net = createSacNet(api.rtdb, api.firebase, G.me.uid, {
    joined: (uid, d) => addOther(uid, d), changed: (uid, d) => addOther(uid, d), left: uid => removeOther(uid),
    pos: (uid, p) => { const o = G.others.get(uid); if (!o) return; o.target.set(p.x, p.y, p.z); o.targetYaw = p.r; o.moving = !!p.a; o.state = p; if (!o.placed) { o.pos.copy(o.target); o.placed = true; } },
    posGone: uid => { const o = G.others.get(uid); if (o) o.placed = false; },
    bases: v => onBases(v), pads: (uid, list) => { G.padsData[uid] = list || null; syncPads(); },
    sold: (slot, uid) => onSold(slot, uid), steals: v => onSteals(v),
    hit: h => onHit(h), fx: f => playFx(f, false), trap: (id, t) => onTrap(id, t),
    denied: () => { if (!G.netDenied) { G.netDenied = true; toast('The server is closed right now (the database rules need an "ocrng" section), so you are playing alone.', 'warn'); } },
  });
  G.sessionId = Math.random().toString(36).slice(2);
  G.net.claimSession(G.sessionId, () => { if (!G || G.kicked) return; G.kicked = true; toast('You opened Steal a Character somewhere else, so this one is closing.', 'warn'); setTimeout(close, 2500); }).catch(() => {});
  G.net.join({ name: G.me.name, shirt: shirtColorFor(G.me.name), rb: G.save.rebirths });
  G.chat = createChat({ host: $q('.sac-hud'), rtdb: api.rtdb, uid: G.me.uid, name: G.me.name, path: 'ocrng/sac/chat', onMessage: () => {}, onCommand: () => false });
}
async function claimBase() {
  let i = G.net ? await G.net.claimBase(G.me.name) : 0;
  if (i < 0 && !G.net) i = 0;
  G.base = i;
  if (i < 0) { toast('All 8 bases are taken, so you are watching for now. A base frees up when someone leaves.', 'warn'); G.player.pos.copy(G.world.spawn); return; }
  G.baseOwner[i] = G.me.uid; G.baseOf[G.me.uid] = i;
  const b = G.world.bases[i];
  G.world.setOwner(b, G.me.name, true);
  G.player.pos.copy(b.spawn); G.player.yaw = b.side * Math.PI / 2;   // facing into the base
  G.cam.yaw = G.player.yaw + Math.PI;
  if (G.net) G.net.update({ base: i });
  publishPads(); syncPads();
}
function onBases(v) {
  G.baseOwner = {}; G.baseOf = {};
  for (const [i, d] of Object.entries(v)) if (d && d.uid) { G.baseOwner[i] = d.uid; G.baseOf[d.uid] = +i; }
  if (G.base >= 0) { G.baseOwner[G.base] = G.me.uid; G.baseOf[G.me.uid] = G.base; }
  G.world.bases.forEach((b, i) => { const uid = G.baseOwner[i]; G.world.setOwner(b, uid ? (uid === G.me.uid ? G.me.name : ((G.net && G.net.roster[uid]) || {}).name || (v[i] || {}).name || 'Someone') : '', uid === G.me.uid); });
  syncPads();
}
const publishPads = () => { if (G.net && G.base >= 0) G.net.setPads(padList(G.me.uid)); };

// ---------------- the other players ----------------
function addOther(uid, d) {
  let o = G.others.get(uid);
  if (!o) {
    const a = buildAvatar(d.name || uid, d.shirt || shirtColorFor(d.name || uid));
    a.tag.visible = false;
    const tag = nameTag(d.name || uid); tag.position.y = 6.9; a.root.add(tag);
    a.root.visible = false; G.scene.add(a.root);
    o = { uid, data: d, avatar: a, tag, pos: new THREE.Vector3(0, -50, 0), target: new THREE.Vector3(0, -50, 0), yaw: 0, targetYaw: 0, placed: false, state: {}, held: null, carry: null, carryKey: '' };
    G.others.set(uid, o);
  }
  o.data = d;
  const lock = d.lock && d.lock > sNow(), bi = G.baseOf[uid];
  if (bi !== undefined) G.world.bases[bi].field.visible = lock;
  onBases(Object.fromEntries(Object.entries(G.baseOwner).map(([i, u]) => [i, { uid: u }])));
}
function removeOther(uid) {
  const o = G.others.get(uid); if (!o) return;
  if (o.carry) o.carry.dispose();
  G.scene.remove(o.avatar.root); o.avatar.dispose(); G.others.delete(uid);
  if (G.carry && G.carry.victim === uid) dropCarry('They left, so it went back.');
}
function updateOthers(dt) {
  for (const o of G.others.values()) {
    const st = o.state || {}, vis = o.placed && !st.iv;
    o.avatar.root.visible = o.placed && (!st.iv || false);
    if (!o.placed) continue;
    const before = o.pos.clone();
    o.pos.lerp(o.target, 1 - Math.exp(-dt * 12));
    let d = o.targetYaw - o.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); o.yaw += d * Math.min(1, dt * 14);
    o.avatar.root.position.copy(o.pos); o.avatar.root.rotation.y = o.yaw;
    const sp = before.distanceTo(o.pos) / Math.max(dt, 0.001);
    const act = o.act && now() - o.act.t0 < o.act.dur ? { kind: o.act.kind, k: (now() - o.act.t0) / o.act.dur } : null;
    o.avatar.animate(dt, st.fz ? 0 : sp > 1 ? Math.max(sp, 8) : 0, o.target.y - o.pos.y > 0.5, null, null, act);
    if ((o.heldId || null) !== (st.gr || null)) { o.heldId = st.gr || null; holdGear(o.avatar, o.heldId); }
    const ck = st.cr || '';
    if (ck !== o.carryKey) { o.carryKey = ck; if (o.carry) { o.carry.dispose(); o.carry = null; } const k = parseKey(ck); if (k) { o.carry = makeCharacter(k.c, k.m); o.carry.group.scale.setScalar(0.7); o.carry.group.position.y = 6.2; o.avatar.root.add(o.carry.group); } }
    if (o.carry) o.carry.update(dt, false);
    tintFrozen(o.avatar, !!st.fz);
    if (!vis) continue;
  }
}
function nameTag(name) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.font = '900 52px "Segoe UI", system-ui, sans-serif'; g.lineWidth = 9; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(name, 256, 48, 500); g.fillStyle = '#ffffff'; g.fillText(name, 256, 48, 500);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); s.scale.set(6, 1.125, 1); return s;
}
const frozenMat = new THREE.MeshBasicMaterial({ color: '#9fe8ff', transparent: true, opacity: 0.45, depthWrite: false });
function tintFrozen(a, on) {
  if (!!a.iceBox === on) return;
  if (on) { a.iceBox = new THREE.Mesh(new THREE.BoxGeometry(3.2, 6.2, 2.4), frozenMat); a.iceBox.position.y = 3; a.root.add(a.iceBox); }
  else { a.root.remove(a.iceBox); a.iceBox.geometry.dispose(); a.iceBox = null; }
}

// ---------------- you ----------------
function buildPlayer() {
  const a = buildAvatar(G.me.name, shirtColorFor(G.me.name));
  a.tag.visible = false;
  const tag = nameTag(G.me.name); tag.position.y = 6.9; a.root.add(tag);
  G.scene.add(a.root);
  G.player = { avatar: a, pos: G.world.spawn.clone(), vel: new THREE.Vector3(), yaw: 0, onGround: true, act: null };
}
function movePlayer(dt) {
  const p = G.player, k = G.input.keys, j = G.input.joy, n = now();
  const frozen = (G.frozenUntil || 0) > n || (G.stunUntil || 0) > n;
  // a grapple pulls you along an arc to where it hooked
  if (G.grapple) {
    const gr = G.grapple, t = Math.min(1, (n - gr.t0) / gr.dur);
    p.pos.lerpVectors(gr.from, gr.to, t); p.pos.y += Math.sin(t * Math.PI) * gr.arc; p.vel.set(0, 0, 0);
    if (t >= 1) { G.grapple = null; p.vel.y = 6; }
    p.avatar.root.position.copy(p.pos); p.avatar.animate(dt, 0, true, null, null, { kind: 'raise', k: 1 });
    return;
  }
  let ix = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0) + j.x, iz = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0) - j.y;
  if (G.typing() || G.panel || frozen) { ix = 0; iz = 0; }
  const len = Math.hypot(ix, iz);
  const held = heldGear(), carrying = !!G.carry;
  let speed = WALK * (held === 'sneakers' ? 1.4 : 1) * (carrying ? 0.65 : 1) * ((G.rocketUntil || 0) > n ? 1.5 : 1);
  if (len > 0.05) {
    const f = new THREE.Vector3(-Math.sin(G.cam.yaw), 0, -Math.cos(G.cam.yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
    const dir = f.multiplyScalar(iz).add(r.multiplyScalar(ix)).normalize(), s = Math.min(1, len);
    p.vel.x = dir.x * speed * s; p.vel.z = dir.z * speed * s;
    const want = Math.atan2(dir.x, dir.z); let d = want - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); p.yaw += d * Math.min(1, dt * 14);
  } else { p.vel.x = 0; p.vel.z = 0; }
  const jumpHeld = !frozen && !G.typing() && !G.panel && (k[' '] || G.input.jump);
  if (jumpHeld && p.onGround) { p.vel.y = JUMP * (held === 'springs' ? 1.35 : 1); p.onGround = false; sound('jump'); }
  if ((G.rocketUntil || 0) > n && jumpHeld && !carrying) { p.vel.y = Math.max(p.vel.y, 22); if (Math.random() < dt * 30) addPuff(p.pos.x, p.pos.y + 1.5, p.pos.z, '#ff8a50', 0.8); }
  p.vel.y -= GRAVITY * dt;
  const prevY = p.pos.y;
  p.pos.addScaledVector(p.vel, dt);
  collide(p, prevY);
  keepOut(p);
  if (p.pos.y < -30) { p.pos.copy(homeSpot()); p.vel.set(0, 0, 0); }
  p.avatar.root.position.copy(p.pos); p.avatar.root.rotation.y = p.yaw;
  const act = p.act && n - p.act.t0 < p.act.dur ? { kind: p.act.kind, k: (n - p.act.t0) / p.act.dur } : null;
  p.avatar.animate(dt, Math.hypot(p.vel.x, p.vel.z), !p.onGround, null, null, act);
  p.avatar.root.visible = !((G.invisUntil || 0) > n) || Math.sin(n / 60) > 0.6;
  tintFrozen(p.avatar, (G.frozenUntil || 0) > n);
}
const homeSpot = () => (G.base >= 0 ? G.world.bases[G.base].spawn.clone() : G.world.spawn.clone());
// bump into walls, step up small ledges, stand on things
function collide(p, prevY) {
  const C = G.world.colliders;
  for (const b of C) {
    if (p.pos.x + R <= b.min.x || p.pos.x - R >= b.max.x || p.pos.z + R <= b.min.z || p.pos.z - R >= b.max.z) continue;
    if (p.pos.y >= b.max.y - 0.001 || p.pos.y + H <= b.min.y) continue;
    if (b.max.y - p.pos.y <= STEP && (p.onGround || p.vel.y <= 0)) { p.pos.y = b.max.y; p.vel.y = Math.max(0, p.vel.y); continue; }
    if (p.vel.y > 0 && prevY + H <= b.min.y + 0.05) { p.pos.y = b.min.y - H; p.vel.y = 0; continue; }
    const dx1 = b.max.x - (p.pos.x - R), dx2 = (p.pos.x + R) - b.min.x, dz1 = b.max.z - (p.pos.z - R), dz2 = (p.pos.z + R) - b.min.z, mn = Math.min(dx1, dx2, dz1, dz2);
    if (mn === dx1) p.pos.x += dx1; else if (mn === dx2) p.pos.x -= dx2; else if (mn === dz1) p.pos.z += dz1; else p.pos.z -= dz2;
  }
  let ground = 0;
  for (const b of C) {
    if (p.pos.x + R * 0.7 <= b.min.x || p.pos.x - R * 0.7 >= b.max.x || p.pos.z + R * 0.7 <= b.min.z || p.pos.z - R * 0.7 >= b.max.z) continue;
    if (b.max.y <= p.pos.y + 0.05 && b.max.y > ground) ground = b.max.y;
  }
  if (p.pos.y <= ground) { p.pos.y = ground; if (p.vel.y < 0) p.vel.y = 0; p.onGround = true; } else p.onGround = p.pos.y - ground < 0.05;
}
// a locked base's force field keeps everyone else out (and pushes out anyone inside when it goes up)
function keepOut(p) {
  const t = sNow();
  G.world.bases.forEach((b, i) => {
    const uid = G.baseOwner[i]; if (!uid || uid === G.me.uid) return;
    const d = uid === G.me.uid ? null : (G.net && G.net.roster[uid]) || {};
    if (!(d && d.lock > t)) return;
    if (p.pos.x > b.x0 - R && p.pos.x < b.x1 + R && p.pos.z > b.z0 - R && p.pos.z < b.z1 + R && p.pos.y < 14) { p.pos.x = b.front - b.side * (R + 0.6); if (p.pos.z < b.z0) p.pos.z = b.z0; if (p.pos.z > b.z1) p.pos.z = b.z1; }
  });
}

// ---------------- the runway ----------------
// One character every 3 seconds walks from one end to the other; anyone can buy it on the way.
function updateParade(dt) {
  const t = sNow(), first = Math.ceil((t - LIFE) / RUNWAY.every), last = Math.floor(t / RUNWAY.every), seen = new Set();
  for (let slot = first; slot <= last; slot++) {
    if (G.sold.has(slot)) continue;
    seen.add(slot);
    let e = G.parade.get(slot);
    if (!e) { const d = slotChar(slot); const ch = makeCharacter(d.c, d.m, { label: 'price', shadow: G.quality !== 'low' }); G.scene.add(ch.group); e = { slot, c: d.c, m: d.m, ch }; G.parade.set(slot, e); }
    const z = RUNWAY.start + (t - slot * RUNWAY.every) / 1000 * RUNWAY.speed;
    e.z = z; e.ch.group.position.set(0, 0.62, z); e.ch.group.rotation.y = 0; e.ch.update(dt, true);
  }
  for (const [slot, e] of G.parade) if (!seen.has(slot)) { if (!e.taken) e.ch.dispose(); G.parade.delete(slot); }
}
function onSold(slot, uid) {
  G.sold.set(slot, uid);
  if (G.sold.size > 80) G.sold.delete(G.sold.keys().next().value);
  const e = G.parade.get(slot);
  if (!e) { const done = G.landers && G.landers[slot]; if (done) { delete G.landers[slot]; done(); } return; }
  G.parade.delete(slot); e.taken = true;
  // it walks off to its new base (if we know which), and the pad shows it when it gets there
  const bi = G.baseOf[uid], b = bi !== undefined ? G.world.bases[bi] : null;
  const done = G.landers && G.landers[slot]; if (done) delete G.landers[slot];
  if (!b) { addPuff(0, 2, e.z, '#ffffff', 2); e.ch.dispose(); if (done) done(); return; }
  e.ch.setLabel(null);
  const from = e.ch.group.position.clone(), door = new THREE.Vector3(b.front, 0.3, b.cz);
  const path = [from, new THREE.Vector3(b.front - b.side * 3, 0.3, b.cz), door, new THREE.Vector3(b.cx, 0.3, b.cz)];
  const len = path.reduce((a, q, k) => a + (k ? q.distanceTo(path[k - 1]) : 0), 0);
  G.walkers.push({ slot, done, ch: e.ch, path, t: 0, speed: Math.max(24, len / 4.5) });   // home in about 4 seconds
}
function updateWalkers(dt) {
  for (let i = G.walkers.length - 1; i >= 0; i--) {
    const w = G.walkers[i]; let left = w.speed * dt;
    while (left > 0 && w.path.length > 1) {
      const a = w.path[0], b = w.path[1], d = a.distanceTo(b);
      if (d <= left) { left -= d; w.path.shift(); continue; }
      a.lerp(b, left / d); left = 0;
    }
    const at = w.path[0]; w.ch.group.position.copy(at);
    if (w.path[1]) w.ch.group.rotation.y = Math.atan2(w.path[1].x - at.x, w.path[1].z - at.z);
    w.ch.update(dt, true);
    if (w.path.length <= 1) { addPuff(at.x, at.y + 2, at.z, '#69f0ae', 1.2); w.ch.dispose(); G.walkers.splice(i, 1); if (w.done) w.done(); }
  }
}
async function buy(e) {
  const price = priceOf(e.c, e.m), s = G.save;
  if (s.coins < price) { toast(`You need $${fmt(price - s.coins)} more for ${nameOf(e.c, e.m)}.`, 'warn'); sound('no'); return; }
  const pad = freePad();
  if (pad < 0) { toast('Your base is full. Sell a character in your Backpack, or Rebirth for more pads.', 'warn'); sound('no'); return; }
  if (G.buying) return;
  G.buying = true;
  try {
    const ok = G.net ? await G.net.buy(e.slot, LIFE) : true;
    if (!ok) { toast('Someone else bought it first.', 'warn'); sound('no'); return; }
    if (!G.net) onSold(e.slot, G.me.uid);
    s.coins -= price; s.stats.bought++;
    G.arriving = G.arriving || new Set(); G.arriving.add(pad);
    s.pads[pad] = { c: e.c, m: e.m };
    // it shows on your pad when it has walked there
    const land = () => { if (!G || !G.arriving.has(pad)) return; G.arriving.delete(pad); publishPads(); syncPads(); };
    const w = G.walkers.find(x => x.slot === e.slot);
    if (w) w.done = land;
    else { G.landers = G.landers || {}; G.landers[e.slot] = land; setTimeout(() => { if (G && G.landers && G.landers[e.slot]) { delete G.landers[e.slot]; land(); } }, 12000); }
    const fresh = found(e.c, e.m);
    toast(`You bought ${nameOf(e.c, e.m)}! It earns $${fmt(incomeOf(e.c, e.m, s.rebirths))} a second.${fresh ? ' New in your Index.' : ''}`, 'gold'); sound('buy');
    const rar = CHAR[e.c].rarity;
    if (G.net && (['legendary', 'mythic', 'secret'].includes(rar) || e.m)) G.net.fx({ kind: 'news', text: `${G.me.name} bought ${e.m ? 'a ' : ''}${nameOf(e.c, e.m)} (${RARITY[rar].name})` });
    publishPads(); saveNow(); updateHud();
  } catch (err) { toast('That didn\'t go through. Try again.', 'warn'); }
  finally { G.buying = false; }
}

// ---------------- the pads: your characters and everyone else's ----------------
function padList(uid) {
  if (uid === G.me.uid) return G.save.pads.map((p, i) => (p && !(G.arriving && G.arriving.has(i)) ? keyOf(p.c, p.m) : ''));
  return G.padsData[uid] || [];
}
function syncPads() {
  if (!G || !G.world) return;
  const want = new Map();
  for (const [bi, uid] of Object.entries(G.baseOwner)) {
    const list = padList(uid), b = G.world.bases[bi], stolen = G.steals[uid] || {};
    list.forEach((k, i) => { if (k && i < 16 && !stolen[i]) want.set(`${bi}:${i}`, { k, b, i, uid }); });
  }
  for (const [key, e] of G.padModels) if (!want.has(key) || want.get(key).k !== e.k) { e.ch.dispose(); G.padModels.delete(key); }
  for (const [key, w] of want) {
    if (G.padModels.has(key)) continue;
    const pk = parseKey(w.k); if (!pk) continue;
    const ch = makeCharacter(pk.c, pk.m, { label: 'income', shadow: G.quality !== 'low' }), pad = w.b.pads[w.i];
    ch.group.position.set(pad.x, pad.y, pad.z); ch.group.rotation.y = pad.yaw; G.scene.add(ch.group);
    G.padModels.set(key, { k: w.k, ch, uid: w.uid, pad: w.i, base: +w.b.i, c: pk.c, m: pk.m });
  }
  // each pedestal's ring: its character's rarity colour, grey when empty, dark until it's unlocked
  G.world.bases.forEach((b, bi) => {
    const uid = G.baseOwner[bi], list = uid ? padList(uid) : [], stolen = (uid && G.steals[uid]) || {};
    const n = !uid ? 16 : uid === G.me.uid ? padsFor(G.save.rebirths) : padsFor(((G.net && G.net.roster[uid]) || {}).rb || 0);
    for (let k = 0; k < 16; k++) { const pk = parseKey(list[k]); G.world.padState(b, k, k >= n ? 'locked' : pk && !stolen[k] ? RARITY[CHAR[pk.c].rarity].color : 'empty'); }
  });
}

// ---------------- stealing ----------------
async function startSteal(e) {
  if (G.carry) return;
  if (freePad() < 0) { toast('Your base is full, so you have nowhere to put it.', 'warn'); sound('no'); return; }
  const ok = G.net ? await G.net.steal(e.uid, e.pad, { c: e.c, m: e.m }) : false;
  if (!ok) { toast('Someone is already carrying that one.', 'warn'); return; }
  G.carry = { victim: e.uid, pad: e.pad, c: e.c, m: e.m, t0: now(), arriving: false };
  const ch = makeCharacter(e.c, e.m); ch.group.scale.setScalar(0.7); ch.group.position.y = 6.2; G.player.avatar.root.add(ch.group); G.carry.ch = ch;
  G.carry.unwatch = G.net.watchSteal(e.uid, e.pad, v => onMySteal(v));
  if (G.held >= 0 && ['grapple', 'rocket', 'smoke'].includes(heldGear())) equip(-1);
  sound('grab');
  const victim = ((G.net && G.net.roster[e.uid]) || {}).name || 'them';
  toast(`You grabbed ${nameOf(e.c, e.m)} from ${victim}! Get it back to your base.`, 'gold');
}
// what happens to the character you're carrying
function onMySteal(v) {
  const C = G && G.carry; if (!C) return;
  if (!v) { if (!C.completing) endCarry(); if (!C.completing) toast(`${nameOf(C.c, C.m)} went back home.`, 'warn'); return; }
  if (v.ok && C.arriving && !C.completing) {
    C.completing = true;
    const pad = freePad(), s = G.save;
    if (pad >= 0) { s.pads[pad] = { c: C.c, m: C.m }; s.stats.stole++; found(C.c, C.m); toast(`You stole ${nameOf(C.c, C.m)}! It's yours now.`, 'gold'); sound('buy'); if (G.net) G.net.fx({ kind: 'news', text: `${G.me.name} stole ${nameOf(C.c, C.m)} from ${((G.net.roster[C.victim]) || {}).name || 'someone'}!` }); }
    G.net.clearSteal(C.victim, C.pad);
    endCarry(); publishPads(); syncPads(); saveNow(); updateHud();
  }
}
function endCarry() { const C = G.carry; if (!C) return; if (C.unwatch) C.unwatch(); if (C.ch) C.ch.dispose(); clearTimeout(C.timer); G.carry = null; }
function dropCarry(why) {
  const C = G.carry; if (!C) return;
  if (G.net) G.net.drop(C.victim, C.pad);
  endCarry();
  if (why) toast(why, 'warn');
  sound('drop');
}
// carrying: home is your base; it can't be carried for ever
function carryTick() {
  const C = G.carry; if (!C || C.arriving) return;
  if (now() - C.t0 > CARRY_MAX) { dropCarry('You took too long, so it went back.'); return; }
  if (G.base >= 0 && G.world.inBase(G.world.bases[G.base], G.player.pos)) {
    C.arriving = true;
    G.net.arrive(C.victim, C.pad).then(ok => { if (!ok && G && G.carry === C) dropCarry('It was taken back.'); });
    C.timer = setTimeout(() => { if (G && G.carry === C && !C.completing) dropCarry('The owner wasn\'t there to hand it over, so it went back.'); }, 6000);
  }
}
// the other side: someone is stealing from you, or has got one home
function onSteals(all) {
  G.steals = {};
  for (const [victim, pads] of Object.entries(all)) { G.steals[victim] = {}; for (const [pad, v] of Object.entries(pads || {})) G.steals[victim][pad] = v; }
  const mine = G.steals[G.me.uid] || {}, n = padsFor(G.save.rebirths);
  for (const [pad, v] of Object.entries(mine)) {
    const p = G.save.pads[pad], thief = ((G.net && G.net.roster[v.by]) || {}).name || 'Someone';
    if (!G.alerts.has(`${pad}:${v.by}:${v.t}`)) { G.alerts.add(`${pad}:${v.by}:${v.t}`); toast(`${thief} is stealing your ${nameOf(v.c, v.m)}! Bonk them to get it back.`, 'bad'); sound('alarm'); showAlert(`${thief} is stealing your ${nameOf(v.c, v.m)}!`); }
    if (v.done && !v.ok && !G.alerts.has(`ok:${pad}:${v.t}`)) {
      G.alerts.add(`ok:${pad}:${v.t}`);
      if (p && p.c === v.c && (p.m || '') === (v.m || '') && +pad < n) { G.save.coins += Math.floor(G.save.bank[pad]); G.save.bank[pad] = 0; drawBanks(); G.save.pads[pad] = null; G.save.stats.lost++; saveNow(); publishPads(); toast(`${thief} stole your ${nameOf(v.c, v.m)}.`, 'bad'); sound('lost'); G.net.stealOk(+pad); }
      else G.net.clearSteal(G.me.uid, +pad);
    }
  }
  if (!Object.keys(mine).length) showAlert('');
  syncPads();
}

// ---------------- gear ----------------
const heldGear = () => (G.held >= 0 ? G.save.hot[G.held] : null);
function equip(slot) {
  const id = slot >= 0 ? G.save.hot[slot] : null;
  if (slot >= 0 && (!id || !(G.save.gears[id] > 0))) return;
  if (G.carry && ['grapple', 'rocket', 'smoke'].includes(id)) { toast('You can\'t use that while carrying a character.', 'warn'); return; }
  G.held = G.held === slot ? -1 : slot;
  holdGear(G.player.avatar, heldGear());
  renderHotbar(); sound('tick');
}
// what you hold, in your right hand (or on your back)
function holdGear(a, id) {
  if (a.heldObj) { a.heldObj.parent.remove(a.heldObj); a.heldObj = null; }
  if (!id || id === 'sneakers' || id === 'springs') return;
  const g = new THREE.Group(), mat = c => new THREE.MeshLambertMaterial({ color: c }), bx = (w, h, d, c, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); g.add(m); };
  const col = GEAR[id].color;
  if (id === 'bat') { bx(0.35, 3, 0.35, col, 0, 1.2, 0); bx(0.5, 1.4, 0.5, col, 0, 2.3, 0); }
  else if (id === 'grapple' || id === 'freeze') { bx(0.5, 0.6, 1.8, col, 0, 0, 0.6); bx(0.4, 0.8, 0.4, '#37474f', 0, -0.5, 0.1); }
  else if (id === 'trap') bx(1.2, 0.3, 1.2, col);
  else if (id === 'smoke') { const s = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), mat(col)); g.add(s); }
  if (id === 'rocket') { bx(1.4, 1.8, 0.8, col, 0, 3.2, -0.9); a.root.add(g); a.heldObj = g; return; }
  g.position.set(0, -2, 0.2); g.rotation.x = id === 'bat' ? 1.2 : 0; a.rightArm.add(g); a.heldObj = g;
}
function useGear() {
  const id = heldGear(), n = now(); if (!id || !G.playing || G.panel) return;
  const gdef = GEAR[id];
  if (gdef.passive) return;
  if (!opfun() && (G.gearCd[id] || 0) > n) return;
  if ((G.frozenUntil || 0) > n || (G.stunUntil || 0) > n) return;
  const p = G.player, f = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
  if (gdef.pack) { if (!(G.save.gears[id] > 0)) return; }
  G.gearCd[id] = n + (gdef.cd || 1) * 1000;
  if (id === 'bat') {
    p.act = { kind: 'swing', t0: n, dur: 360 }; sound('swing');
    if (G.net) G.net.fx({ kind: 'swing' });
    for (const o of G.others.values()) {
      if (!o.placed) continue;
      const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > 6.5 || Math.abs(o.pos.y - p.pos.y) > 5 || (dx * f.x + dz * f.z) / (d || 1) < 0.1) continue;
      if (!G.net) continue;
      G.net.hit(o.uid, { kind: 'bonk', kx: dx / (d || 1) * 30, kz: dz / (d || 1) * 30 });
      G.net.fx({ kind: 'bonk', x: +o.pos.x.toFixed(1), y: +o.pos.y.toFixed(1), z: +o.pos.z.toFixed(1) }); stars(o.pos.x, o.pos.y + 4, o.pos.z); sound('bonk');
    }
  } else if (id === 'smoke') {
    G.save.gears.smoke--; G.invisUntil = n + 5000; addPuff(p.pos.x, p.pos.y + 2, p.pos.z, '#9e9e9e', 3); sound('smoke');
    if (G.net) G.net.fx({ kind: 'smoke', x: +p.pos.x.toFixed(1), y: +p.pos.y.toFixed(1), z: +p.pos.z.toFixed(1) });
    if (!(G.save.gears.smoke > 0)) dropHotbar('smoke');
  } else if (id === 'grapple') {
    const hit = aimHit(60);
    if (!hit) { toast('Point at something within 60 studs.', 'warn'); G.gearCd[id] = 0; return; }
    const to = hit.clone(); to.y = Math.max(to.y, 0.3);
    G.grapple = { from: p.pos.clone(), to, t0: n, dur: Math.max(300, p.pos.distanceTo(to) * 12), arc: Math.min(10, p.pos.distanceTo(to) * 0.15) };
    rope(p.pos.clone().setY(p.pos.y + 3), to); sound('grapple');
    if (G.net) G.net.fx({ kind: 'rope', x: +p.pos.x.toFixed(1), y: +(p.pos.y + 3).toFixed(1), z: +p.pos.z.toFixed(1), x2: +to.x.toFixed(1), y2: +to.y.toFixed(1), z2: +to.z.toFixed(1) });
  } else if (id === 'trap') {
    G.save.gears.trap--;
    if (G.net) G.net.placeTrap({ x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), by: G.me.uid, until: now() + 60000 });
    toast('Shock Trap set. It lasts a minute.'); sound('tick');
    if (!(G.save.gears.trap > 0)) dropHotbar('trap');
  } else if (id === 'freeze') {
    const from = p.pos.clone().setY(p.pos.y + 3), dir = aimDir(), end = from.clone().addScaledVector(dir, 45);
    let best = null;
    for (const o of G.others.values()) {
      if (!o.placed) continue;
      const v = o.pos.clone().setY(o.pos.y + 2.5).sub(from), along = v.dot(dir);
      if (along < 0 || along > 45) continue;
      if (v.addScaledVector(dir, -along).length() < 2.6 && (!best || along < best.along)) best = { o, along };
    }
    const to = best ? best.o.pos.clone().setY(best.o.pos.y + 2.5) : end;
    beam(from, to, '#80deea'); sound('freeze');
    if (G.net) G.net.fx({ kind: 'beam', x: +from.x.toFixed(1), y: +from.y.toFixed(1), z: +from.z.toFixed(1), x2: +to.x.toFixed(1), y2: +to.y.toFixed(1), z2: +to.z.toFixed(1) });
    if (best && G.net) G.net.hit(best.o.uid, { kind: 'freeze', secs: 3 });
  } else if (id === 'rocket') {
    G.rocketUntil = n + 3000; toast('Hold jump to fly.'); sound('rocket');
  }
  G.save.stats.used = (G.save.stats.used || 0) + 1; markDirty(); renderHotbar();
}
const dropHotbar = id => { G.save.hot = G.save.hot.map(h => (h === id ? null : h)); if (G.held >= 0 && !G.save.hot[G.held]) { G.held = -1; holdGear(G.player.avatar, null); } renderHotbar(); };
// what the middle of the screen (or your mouse) points at
function aimDir() { const d = new THREE.Vector3(); G.camera.getWorldDirection(d); return d.normalize(); }
function aimHit(max) {
  const o = G.camera.position.clone(), d = aimDir(), p = G.player.pos, ray = new THREE.Ray(o, d), hit = new THREE.Vector3(), boxes = G.world.colliders;
  let best = null;
  for (const b of boxes) { const bb = new THREE.Box3(b.min, b.max); if (ray.intersectBox(bb, hit) && hit.distanceTo(p) <= max && (!best || o.distanceTo(hit) < o.distanceTo(best))) best = hit.clone(); }
  if (d.y < -0.01) { const k = -o.y / d.y, g = o.clone().addScaledVector(d, k); if (g.distanceTo(p) <= max && (!best || o.distanceTo(g) < o.distanceTo(best))) best = g; }
  return best;
}
// you got hit: dropped what you carried, knocked back, frozen or stunned
function onHit(h) {
  const p = G.player, n = now();
  if (h.kind === 'bonk') { p.vel.x = h.kx || 0; p.vel.z = h.kz || 0; p.vel.y = 14; p.onGround = false; G.stunUntil = n + 500; stars(p.pos.x, p.pos.y + 4, p.pos.z); sound('bonk'); }
  if (h.kind === 'freeze') { G.frozenUntil = n + (h.secs || 3) * 1000; sound('freeze'); toast('You were frozen!', 'warn'); }
  if (h.kind === 'shock') { G.stunUntil = n + 2000; sound('shock'); toast('A Shock Trap got you!', 'warn'); }
  if (G.carry && !G.carry.arriving) dropCarry('You dropped it!');
}
function onTrap(id, t) {
  const cur = G.traps.get(id);
  if (!t) { if (cur) { G.scene.remove(cur.mesh); G.traps.delete(id); } return; }
  if (cur) return;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.3, 16), new THREE.MeshLambertMaterial({ color: '#ffee58', emissive: '#4a4400' }));
  mesh.position.set(t.x, (t.y || 0) + 0.15, t.z); G.scene.add(mesh);
  G.traps.set(id, { ...t, mesh });
}
function trapTick() {
  const p = G.player;
  for (const [id, t] of G.traps) {
    t.mesh.rotation.y += 0.05;
    if (t.by === G.me.uid || t.busy) continue;
    if (Math.hypot(p.pos.x - t.x, p.pos.z - t.z) < 2 && Math.abs(p.pos.y - (t.y || 0)) < 3) { t.busy = true; G.net.trigger(id).then(ok => { if (ok && G) onHit({ kind: 'shock' }); }); }
  }
}

// ---------------- the base: collecting, the lock ----------------
// every second each character puts its income on its own cash button
function incomeTick() {
  const s = G.save;
  s.pads.forEach((p, i) => { if (!p || (G.arriving && G.arriving.has(i))) return; const inc = incomeOf(p.c, p.m, s.rebirths); s.bank[i] += inc; s.stats.earned += inc; });
  drawBanks(); markDirty();
}
const drawBanks = () => { if (G.base < 0) return; const b = G.world.bases[G.base], s = G.save; for (let i = 0; i < 16; i++) G.world.padLabel(b, i, s.bank[i] >= 1 ? '$' + fmt(s.bank[i]) : null); };
// step on a cash button to collect what's on it
function collectTick() {
  if (G.base < 0) return;
  const b = G.world.bases[G.base], p = G.player.pos, s = G.save;
  for (let i = 0; i < 16; i++) {
    if (s.bank[i] < 1) continue;
    const bt = b.pads[i].button;
    if (Math.abs(p.x - bt.x) > 1.3 || Math.abs(p.z - bt.z) > 1.3 || p.y > 2) continue;
    const got = Math.floor(s.bank[i]); s.coins += got; s.bank[i] -= got;
    G.world.padLabel(b, i, null); addPuff(bt.x, 1, bt.z, '#69f0ae', 1.2); sound('coins'); floatText(`+$${fmt(got)}`); updateHud(); markDirty();
  }
}
function lockBase() {
  if (G.base < 0) return;
  const t = sNow();
  if ((G.lockUntil || 0) > t) { toast('Your base is already locked.'); return; }
  if (!opfun() && (G.lockReadyAt || 0) > t) { toast(`You can lock it again in ${Math.ceil((G.lockReadyAt - t) / 1000)} seconds.`, 'warn'); return; }
  G.lockUntil = t + LOCK_FOR; G.lockReadyAt = t + LOCK_EVERY;
  G.world.bases[G.base].field.visible = true;
  if (G.net) G.net.update({ lock: G.lockUntil });
  toast('Base locked for 40 seconds. Nobody else can get in.', 'gold'); sound('lock');
}

// ---------------- what you can do here: the E prompt ----------------
function findAction() {
  const p = G.player.pos;
  let best = null;
  const offer = (d, a) => { if (!best || d < best.d) best = { ...a, d }; };
  for (const e of G.parade.values()) { const d = Math.hypot(p.x - 0, p.z - e.z); if (d < 7) offer(d, { kind: 'buy', e, text: `Buy ${nameOf(e.c, e.m)} for $${fmt(priceOf(e.c, e.m))}`, bad: G.save.coins < priceOf(e.c, e.m) }); }
  if (!G.carry) for (const e of G.padModels.values()) {
    if (e.uid === G.me.uid) continue;
    const pad = G.world.bases[e.base].pads[e.pad], d = Math.hypot(p.x - pad.x, p.z - pad.z);
    if (d < 4) offer(d, { kind: 'steal', e, text: `Steal ${nameOf(e.c, e.m)}` });
  }
  if (G.base >= 0) { const b = G.world.bases[G.base], d = Math.hypot(p.x - b.button.x, p.z - b.button.z); if (d < 4.5) offer(d, { kind: 'lock', text: 'Lock your base' }); }
  { const s = G.world.shop, d = Math.hypot(p.x - s.x, p.z - s.z); if (d < s.r) offer(d, { kind: 'shop', text: 'Open the Gear Shop' }); }
  { const s = G.world.rebirth, d = Math.hypot(p.x - s.x, p.z - s.z); if (d < s.r) offer(d, { kind: 'rebirth', text: 'Rebirth' }); }
  return best;
}
function act() {
  const a = G.action; if (!a || G.panel || !G.playing) return;
  if (a.kind === 'buy') buy(a.e);
  else if (a.kind === 'steal') startSteal(a.e);
  else if (a.kind === 'lock') lockBase();
  else if (a.kind === 'shop') openPanel('shop');
  else if (a.kind === 'rebirth') openPanel('rebirth');
}

// ---------------- every frame ----------------
function loop() {
  if (!G || G.closed) return;
  G.raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, G.clock.getDelta()), t = G.clock.elapsedTime;
  if (G.playing) {
    movePlayer(dt);
    carryTick(); trapTick(); collectTick();
    if (G.net && G.base !== undefined) G.net.sendPos({ x: +G.player.pos.x.toFixed(2), y: +G.player.pos.y.toFixed(2), z: +G.player.pos.z.toFixed(2), r: +G.player.yaw.toFixed(2), a: Math.hypot(G.player.vel.x, G.player.vel.z) > 1 ? 1 : 0, ...(heldGear() ? { gr: heldGear() } : {}), ...(G.carry ? { cr: keyOf(G.carry.c, G.carry.m) } : {}), ...((G.invisUntil || 0) > now() ? { iv: 1 } : {}), ...((G.frozenUntil || 0) > now() ? { fz: 1 } : {}) });
    G.action = findAction(); drawPrompt();
  }
  updateParade(dt); updateWalkers(dt); updateOthers(dt);
  for (const e of G.padModels.values()) e.ch.update(dt, false);
  if (G.carry && G.carry.ch) G.carry.ch.update(dt, false);
  G.effects = G.effects.filter(f => f.update(dt) !== false);
  G.world.update(dt); tickRainbow(t);
  if (G.player) updateCamera(dt);
  G.renderer.render(G.scene, G.camera);
  if ((G.hudTick = (G.hudTick || 0) + dt) > 0.25) { G.hudTick = 0; updateHud(); }
  if ((G.secTick = (G.secTick || 0) + dt) >= 1) { G.secTick -= 1; slowTick(); }
}
function slowTick() {
  if (!G.playing) return;
  incomeTick();
  const t = sNow();
  // locks wearing off
  G.world.bases.forEach((b, i) => { const uid = G.baseOwner[i]; const lock = uid === G.me.uid ? G.lockUntil : uid && G.net ? (G.net.roster[uid] || {}).lock : 0; b.field.visible = !!(lock && lock > t); });
  if ((G.saveTick = (G.saveTick || 0) + 1) >= 15 && G.dirty) { G.saveTick = 0; saveNow(); }
}

// ---------------- the HUD ----------------
function updateHud() {
  if (!G || !G.save) return;
  const s = G.save, m = $q('.sac-money');
  m.querySelector('b').textContent = '$' + fmt(s.coins);
  m.querySelector('small').textContent = `+$${fmt(income())}/s${s.rebirths ? `  ·  Rebirth ${s.rebirths}` : ''}`;
  const lk = $q('.sac-lock'), t = sNow();
  if ((G.lockUntil || 0) > t) { lk.classList.add('on'); lk.querySelector('small').textContent = `Locked ${Math.ceil((G.lockUntil - t) / 1000)}s`; }
  else if ((G.lockReadyAt || 0) > t && !opfun()) { lk.classList.remove('on'); lk.classList.add('cooling'); lk.querySelector('small').textContent = `Ready in ${Math.ceil((G.lockReadyAt - t) / 1000)}s`; }
  else { lk.classList.remove('on', 'cooling'); lk.querySelector('small').textContent = 'for 40 seconds'; }
  const ban = $q('.sac-banner');
  if (G.carry) { ban.classList.remove('hidden'); ban.innerHTML = `Carrying <b>${esc(nameOf(G.carry.c, G.carry.m))}</b>: get it to your base! <small>${Math.max(0, Math.ceil((CARRY_MAX - (now() - G.carry.t0)) / 1000))}s</small>`; }
  else ban.classList.add('hidden');
  // cooldowns on the hotbar
  G.root.querySelectorAll('.sac-hotbar .sac-slot').forEach(el => { const id = s.hot[+el.dataset.slot]; const left = id ? Math.max(0, (G.gearCd[id] || 0) - now()) : 0; el.querySelector('.cd').textContent = left > 0 ? (left / 1000).toFixed(left < 10000 ? 1 : 0) : ''; el.classList.toggle('cooling', left > 0); });
}
function drawPrompt() {
  const a = G.action, el = $q('.sac-prompt'), btn = $q('.sac-act');
  if (!a || G.panel) { el.classList.add('hidden'); btn.classList.add('hidden'); return; }
  el.classList.remove('hidden'); el.classList.toggle('bad', !!a.bad);
  if (el.dataset.t !== a.text) { el.dataset.t = a.text; el.querySelector('span').textContent = a.text; }
  btn.classList.remove('hidden'); btn.textContent = a.kind === 'buy' ? 'Buy' : a.kind === 'steal' ? 'Steal' : a.kind === 'lock' ? 'Lock' : 'Open';
}
function showAlert(text) { const el = $q('.sac-alert'); el.textContent = text; el.classList.toggle('hidden', !text); clearTimeout(G.alertTimer); if (text) G.alertTimer = setTimeout(() => { if (G) el.classList.add('hidden'); }, 5000); }
function renderHotbar() {
  const s = G.save, bar = $q('.sac-hotbar');
  bar.innerHTML = s.hot.map((id, i) => `<button type="button" class="sac-slot${G.held === i ? ' on' : ''}${id ? '' : ' empty'}" data-slot="${i}" style="--c:${id ? GEAR[id].color : '#555'}"><kbd>${i + 1}</kbd>${id ? gearSvg(id) : ''}${id && GEAR[id].pack ? `<em>${s.gears[id] || 0}</em>` : ''}<span class="cd"></span></button>`).join('');
  const use = $q('.sac-use'), id = heldGear(); use.classList.toggle('hidden', !id || GEAR[id].passive);
}
function toast(text, kind) {
  if (!G) return;
  const box = $q('.sac-toasts'), el = document.createElement('div');
  el.className = 'sac-toast ' + (kind || ''); el.textContent = text; box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 3800);
}
function floatText(text) { const el = document.createElement('div'); el.className = 'sac-float'; el.textContent = text; $q('.sac-hud').appendChild(el); setTimeout(() => el.remove(), 1200); }

// ---------------- effects ----------------
function addPuff(x, y, z, color, size = 1) {
  const g = new THREE.Group(); g.position.set(x, y, z); G.scene.add(g);
  const bits = Array.from({ length: 10 }, () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial({ color, transparent: true })); m.userData.v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(10 * size); g.add(m); return m; });
  let t = 0;
  G.effects.push({ update(dt) { t += dt; bits.forEach(b => { b.position.addScaledVector(b.userData.v, dt); b.userData.v.y -= 12 * dt; b.material.opacity = Math.max(0, 1 - t / 0.7); }); if (t > 0.7) { G.scene.remove(g); bits.forEach(b => { b.geometry.dispose(); b.material.dispose(); }); return false; } return true; } });
}
function stars(x, y, z) { addPuff(x, y, z, '#ffeb3b', 0.8); }
function line3(a, b, color, life) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]), l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true })); G.scene.add(l);
  let t = 0; G.effects.push({ update(dt) { t += dt; l.material.opacity = Math.max(0, 1 - t / life); if (t > life) { G.scene.remove(l); geo.dispose(); l.material.dispose(); return false; } return true; } });
}
const rope = (a, b) => line3(a, b, '#ffcc80', 0.6);
function beam(a, b, color) {
  const d = b.clone().sub(a), len = d.length(), m = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, len, 8, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); G.scene.add(m);
  let t = 0; G.effects.push({ update(dt) { t += dt; m.material.opacity = Math.max(0, 0.9 - t / 0.4); if (t > 0.4) { G.scene.remove(m); m.geometry.dispose(); m.material.dispose(); return false; } return true; } });
  addPuff(b.x, b.y, b.z, color, 0.7);
}
// someone else's effect
function playFx(f) {
  const o = G.others.get(f.uid), V = (x, y, z) => new THREE.Vector3(x, y, z);
  if (f.kind === 'swing' && o) { o.act = { kind: 'swing', t0: now(), dur: 360 }; sound('swing', 0.5); }
  else if (f.kind === 'bonk') { stars(f.x, f.y + 4, f.z); sound('bonk', 0.6); }
  else if (f.kind === 'smoke') { addPuff(f.x, f.y + 2, f.z, '#9e9e9e', 3); sound('smoke', 0.5); }
  else if (f.kind === 'rope') rope(V(f.x, f.y, f.z), V(f.x2, f.y2, f.z2));
  else if (f.kind === 'beam') beam(V(f.x, f.y, f.z), V(f.x2, f.y2, f.z2), '#80deea');
  else if (f.kind === 'news' && G.chat) G.chat.system(f.text, '#ffd54f');
}

// ---------------- panels ----------------
const TITLES = { shop: 'Gear Shop', bag: 'Backpack', index: 'Index', rebirth: 'Rebirth', settings: 'Settings' };
function openPanel(id) {
  G.panel = id;
  const box = $q('.sac-panel'); box.classList.remove('hidden'); box.dataset.panel = id;
  box.querySelector('h2').textContent = TITLES[id];
  renderPanel();
}
function closePanel() { G.panel = null; G.pick = null; $q('.sac-panel').classList.add('hidden'); }
function renderPanel() {
  const body = $q('.sac-panel-body'), s = G.save, id = G.panel;
  if (id === 'shop') {
    body.innerHTML = `<p class="sac-note">Gear goes in your Backpack and on the hotbar: press its number (or tap it) to hold it, then click (or press Use) to use it.</p><div class="sac-shop">${GEARS.map(g => {
      const owned = s.gears[g.id] || 0, have = !g.pack && owned > 0;
      return `<div class="sac-item" style="--c:${g.color}">${gearSvg(g.id)}<div><b>${esc(g.name)}</b><small>${esc(g.desc)}</small></div><button type="button" class="sac-btn ${have ? 'owned' : s.coins >= g.price ? 'ok' : 'no'}" data-buy="${g.id}" ${have ? 'disabled' : ''}>${have ? 'Owned' : `$${fmt(g.price)}${g.pack ? ` (x${g.pack})` : ''}`}</button>${g.pack && owned ? `<em>${owned} left</em>` : ''}</div>`;
    }).join('')}</div>`;
    body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => buyGear(b.dataset.buy));
  }
  if (id === 'bag') {
    const n = padsFor(s.rebirths), owned = GEARS.filter(g => s.gears[g.id] > 0);
    body.innerHTML = `<h3>Hotbar <small>${G.pick ? 'now pick a slot for it' : 'pick a gear, then a slot'}</small></h3>
      <div class="sac-bag-hot">${s.hot.map((g, i) => `<button type="button" class="sac-slot big${g ? '' : ' empty'}" data-hot="${i}" style="--c:${g ? GEAR[g].color : '#555'}"><kbd>${i + 1}</kbd>${g ? gearSvg(g) : ''}</button>`).join('')}</div>
      <h3>Gear <small>${owned.length} of ${GEARS.length}</small></h3>
      <div class="sac-bag-gear">${owned.length ? owned.map(g => `<button type="button" class="sac-gear${G.pick === g.id ? ' on' : ''}" data-gear="${g.id}" style="--c:${g.color}">${gearSvg(g.id)}<b>${esc(g.name)}</b>${g.pack ? `<small>${s.gears[g.id]} left</small>` : ''}</button>`).join('') : '<p class="sac-note">No gear yet. Buy some at the Gear Shop.</p>'}</div>
      <h3>Your characters <small>${s.pads.filter(Boolean).length} of ${n} pads · $${fmt(income())}/s</small></h3>
      <div class="sac-chars">${s.pads.slice(0, n).map((p, i) => p ? `<div class="sac-char" style="--c:${RARITY[CHAR[p.c].rarity].color}"><b>${esc(nameOf(p.c, p.m))}</b><small>${RARITY[CHAR[p.c].rarity].name} · $${fmt(incomeOf(p.c, p.m, s.rebirths))}/s</small><button type="button" class="sac-btn bad" data-sell="${i}">Sell $${fmt(Math.floor(priceOf(p.c, p.m) / 2))}</button></div>` : `<div class="sac-char empty"><small>Pad ${i + 1}: empty</small></div>`).join('')}</div>`;
    body.querySelectorAll('[data-gear]').forEach(b => b.onclick = () => { G.pick = G.pick === b.dataset.gear ? null : b.dataset.gear; renderPanel(); });
    body.querySelectorAll('[data-hot]').forEach(b => b.onclick = () => { const i = +b.dataset.hot; if (G.pick) { s.hot = s.hot.map(h => (h === G.pick ? null : h)); s.hot[i] = G.pick; G.pick = null; } else s.hot[i] = null; if (G.held === i) { G.held = -1; holdGear(G.player.avatar, null); } markDirty(); renderHotbar(); renderPanel(); });
    body.querySelectorAll('[data-sell]').forEach(b => b.onclick = () => {
      if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Sure?'; setTimeout(() => { if (b.isConnected) renderPanel(); }, 3000); return; }
      const i = +b.dataset.sell, p = s.pads[i]; if (!p) return;
      if ((G.steals[G.me.uid] || {})[i]) { toast('Someone is carrying that one off. Get it back first.', 'warn'); return; }
      s.coins += Math.floor(priceOf(p.c, p.m) / 2) + Math.floor(s.bank[i]); s.bank[i] = 0; s.pads[i] = null; drawBanks(); sound('coins'); publishPads(); syncPads(); saveNow(); updateHud(); renderPanel();
    });
  }
  if (id === 'index') {
    const got = CHARACTERS.filter(c => s.index[c.id]).length;
    body.innerHTML = `<p class="sac-note">${got} of ${CHARACTERS.length} found. Buy or steal one to add it; Golden, Diamond and Rainbow ones get their own marks.</p><div class="sac-index">${RARITIES.map(r => CHARACTERS.filter(c => c.rarity === r.id).map(c => {
      const e = s.index[c.id];
      return `<div class="sac-ix${e ? '' : ' unknown'}" style="--c:${r.color}"><b>${e ? esc(c.name) : '???'}</b><small>${r.name} · $${fmt(c.price)}</small><span>${Object.values(MUTATIONS).map(m => `<i class="${e && e[m.id] ? 'on' : ''}" style="--m:${m.color}" title="${m.name}"></i>`).join('')}</span></div>`;
    }).join('')).join('')}</div>`;
  }
  if (id === 'rebirth') {
    const cost = rebirthCost(s.rebirths), can = s.coins >= cost, maxed = padsFor(s.rebirths) >= 16 && s.rebirths >= 10;
    body.innerHTML = `<div class="sac-rebirth"><b class="big">Rebirth ${s.rebirths + 1}</b>
      <p>Start over with <b>+50% income</b> for good (you have +${s.rebirths * 50}% now) and <b>${Math.min(16, padsFor(s.rebirths + 1))} pads</b> in your base.</p>
      <p class="sac-note">You lose your money and the characters on your pads. You keep your gear and your Index.</p>
      <div class="sac-progress"><i style="width:${Math.min(100, s.coins / cost * 100).toFixed(1)}%"></i><span>$${fmt(s.coins)} / $${fmt(cost)}</span></div>
      <button type="button" class="sac-btn big ${can && !maxed ? 'ok' : 'no'}" data-rebirth ${can && !maxed ? '' : 'disabled'}>${maxed ? 'Fully reborn' : can ? 'Rebirth' : `Need $${fmt(cost - s.coins)} more`}</button></div>`;
    const rb = body.querySelector('[data-rebirth]');
    if (rb) rb.onclick = () => {
      if (!rb.classList.contains('armed')) { rb.classList.add('armed'); rb.textContent = 'Sure? Click again'; return; }
      if (s.coins < cost) return;
      s.rebirths++; s.coins = START_COINS; s.bank = Array(16).fill(0); s.pads = Array(16).fill(null); drawBanks();
      if (G.net) G.net.update({ rb: s.rebirths });
      if (G.carry) dropCarry();
      publishPads(); syncPads(); saveNow(); updateHud(); sound('rebirth');
      toast(`Rebirth ${s.rebirths}! +${s.rebirths * 50}% income and ${padsFor(s.rebirths)} pads.`, 'gold');
      if (G.net) G.net.fx({ kind: 'news', text: `${G.me.name} reached Rebirth ${s.rebirths}!` });
      renderPanel();
    };
  }
  if (id === 'settings') {
    const st = s.settings;
    body.innerHTML = `<div class="sac-set"><label>Sound effects <input type="range" min="0" max="100" value="${Math.round(st.sfx * 100)}" data-sfx></label>
      <p class="sac-note">Move with WASD, jump with Space, look around by dragging, E to buy, steal or open things, 1 to 9 for your gear and click to use it.</p></div>
      ${G.me.owner ? `<h3>Owner</h3><div class="sac-owner"><button type="button" class="sac-btn ok" data-own="1e6">+$1M</button><button type="button" class="sac-btn ok" data-own="1e9">+$1B</button><button type="button" class="sac-btn ok" data-own="gear">All gear</button><button type="button" class="sac-btn ${st.opfun ? 'ok' : ''}" data-own="opfun">OpFun: ${st.opfun ? 'on' : 'off'}</button>
        <select data-own-c>${CHARACTERS.map(c => `<option value="${c.id}">${esc(c.name)} (${RARITY[c.rarity].name})</option>`).join('')}</select><select data-own-m><option value="">No mutation</option>${Object.values(MUTATIONS).map(m => `<option value="${m.id}">${m.name}</option>`).join('')}</select><button type="button" class="sac-btn ok" data-own="give">Put on a pad</button></div>` : ''}`;
    body.querySelector('[data-sfx]').oninput = e => { st.sfx = e.target.value / 100; markDirty(); };
    body.querySelectorAll('[data-own]').forEach(b => b.onclick = () => {
      const k = b.dataset.own;
      if (k === '1e6' || k === '1e9') { s.coins += +k; updateHud(); }
      if (k === 'gear') { GEARS.forEach(g => { s.gears[g.id] = g.pack ? (s.gears[g.id] || 0) + 9 : 1; }); GEARS.forEach(g => { if (!s.hot.includes(g.id)) { const f = s.hot.indexOf(null); if (f >= 0) s.hot[f] = g.id; } }); renderHotbar(); }
      if (k === 'opfun') { st.opfun = !st.opfun; G.gearCd = {}; }
      if (k === 'give') ownerGive(body.querySelector('[data-own-c]').value, body.querySelector('[data-own-m]').value);
      markDirty(); renderPanel();
    });
  }
}
function ownerGive(c, m) {
  const pad = freePad(); if (pad < 0) { toast('Your base is full.', 'warn'); return; }
  G.save.pads[pad] = { c, m: m || '' }; found(c, m); publishPads(); syncPads(); saveNow(); updateHud();
}
function buyGear(id) {
  const g = GEAR[id], s = G.save;
  if (!g.pack && s.gears[id] > 0) return;
  if (s.coins < g.price) { toast(`You need $${fmt(g.price - s.coins)} more.`, 'warn'); sound('no'); return; }
  s.coins -= g.price; s.gears[id] = (s.gears[id] || 0) + (g.pack || 1);
  if (!s.hot.includes(id)) { const f = s.hot.indexOf(null); if (f >= 0) s.hot[f] = id; }
  toast(`You got ${g.name}${g.pack ? ` x${g.pack}` : ''}. It's on your hotbar.`, 'gold'); sound('buy');
  saveNow(); updateHud(); renderHotbar(); renderPanel();
}

// ---------------- input: keyboard, mouse, touch ----------------
function setupInput() {
  const k = G.input.keys, cvs = $q('.sac-canvas');
  G.typing = () => !!(G.chat && G.chat.typing);
  on(window, 'keydown', e => {
    if (!G || !G.playing || G.typing()) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') { if (G.panel) closePanel(); return; }
    if (key === '/' && G.chat) { e.preventDefault(); G.chat.focus(); return; }
    if (G.panel) return;
    k[key] = true;
    if (key === 'e' && !e.repeat) act();
    if (/^[1-9]$/.test(key) && !e.repeat) equip(+key - 1);
    if (key === 'f' && !e.repeat) useGear();
    if ([' ', 'w', 'a', 's', 'd', 'e', 'f', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) e.preventDefault();
  }, true);
  on(window, 'keyup', e => { if (G) k[e.key.toLowerCase()] = false; }, true);
  on(window, 'blur', () => { for (const x in k) k[x] = false; });
  // drag to look around; a click (no drag) uses what you're holding
  let drag = null;
  on(cvs, 'pointerdown', e => {
    if (!G.playing || e.pointerType === 'touch') return;
    drag = { x: e.clientX, y: e.clientY, moved: 0, t: now(), button: e.button };
    cvs.setPointerCapture && cvs.setPointerCapture(e.pointerId);
  });
  on(cvs, 'pointermove', e => {
    if (!drag || e.pointerType === 'touch') return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    G.cam.yaw -= dx * 0.006; G.cam.pitch = Math.max(-0.2, Math.min(1.25, G.cam.pitch + dy * 0.005));
  });
  on(cvs, 'pointerup', e => { if (!drag || e.pointerType === 'touch') return; if (drag.moved < 6 && drag.button === 0 && now() - drag.t < 400) useGear(); drag = null; });
  on(cvs, 'contextmenu', e => e.preventDefault());
  on(cvs, 'wheel', e => { G.cam.dist = Math.max(8, Math.min(60, G.cam.dist + Math.sign(e.deltaY) * 3)); e.preventDefault(); }, { passive: false });
  // buttons
  on($q('.sac-x'), 'click', () => close());
  on($q('.sac-chat-btn'), 'click', () => G.chat && G.chat.focus());
  on($q('.sac-lock'), 'click', () => lockBase());
  on($q('.sac-panel-x'), 'click', closePanel);
  on($q('.sac-panel'), 'click', e => { if (e.target.classList.contains('sac-panel')) closePanel(); });
  G.root.querySelectorAll('[data-panel]').forEach(b => on(b, 'click', () => (G.panel === b.dataset.panel ? closePanel() : openPanel(b.dataset.panel))));
  on($q('.sac-hotbar'), 'click', e => { const b = e.target.closest('[data-slot]'); if (b) equip(+b.dataset.slot); });
  on($q('.sac-act'), 'click', () => act());
  on($q('.sac-use'), 'click', () => useGear());
  // phones: a joystick on the left, drag anywhere else to look, and buttons
  const touch = 'ontouchstart' in window && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if (!touch) return;
  G.root.classList.add('sac-touchy'); $q('.sac-touch').classList.remove('hidden');
  const joy = $q('.sac-joy'), knob = joy.querySelector('i'); let jid = null, look = null;
  on(joy, 'touchstart', e => { const t = e.changedTouches[0]; jid = t.identifier; e.preventDefault(); }, { passive: false });
  on(window, 'touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === jid) { const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let x = (t.clientX - cx) / (r.width / 2), y = (t.clientY - cy) / (r.height / 2); const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } G.input.joy.x = x; G.input.joy.y = y; knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`; }
      else if (look && t.identifier === look.id) { G.cam.yaw -= (t.clientX - look.x) * 0.008; G.cam.pitch = Math.max(-0.2, Math.min(1.25, G.cam.pitch + (t.clientY - look.y) * 0.006)); look.x = t.clientX; look.y = t.clientY; }
    }
  }, { passive: true });
  const end = e => { for (const t of e.changedTouches) { if (t.identifier === jid) { jid = null; G.input.joy.x = 0; G.input.joy.y = 0; knob.style.transform = ''; } if (look && t.identifier === look.id) look = null; } };
  on(window, 'touchend', end); on(window, 'touchcancel', end);
  on(cvs, 'touchstart', e => { const t = e.changedTouches[0]; if (!look) look = { id: t.identifier, x: t.clientX, y: t.clientY }; }, { passive: true });
  const jump = $q('.sac-jump');
  on(jump, 'touchstart', e => { G.input.jump = true; e.preventDefault(); }, { passive: false });
  on(jump, 'touchend', () => { G.input.jump = false; });
}

// ---------------- sound ----------------
let audio = null;
function sound(kind, vol = 1) {
  if (!G || !G.save) return;
  const v0 = (G.save.settings.sfx ?? 0.7) * vol; if (v0 <= 0) return;
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  const ctx = audio, t0 = ctx.currentTime;
  const tone = (f, d, type = 'sine', v = 0.08, delay = 0, slide) => { const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + delay; o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d); g.gain.setValueAtTime(v * v0, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + d + 0.02); };
  const noise = (d, v, f = 1200, delay = 0) => { const len = Math.max(1, Math.floor(ctx.sampleRate * d)), buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0); for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len); const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = buf; fl.type = 'bandpass'; fl.frequency.value = f; g.gain.value = v * v0 * 1.6; s.connect(fl); fl.connect(g); g.connect(ctx.destination); s.start(t0 + delay); };
  switch (kind) {
    case 'buy': tone(880, 0.12, 'square', 0.05); tone(1320, 0.25, 'square', 0.05, 0.1); break;
    case 'coins': tone(1500, 0.08, 'square', 0.04); tone(2000, 0.12, 'square', 0.04, 0.06); break;
    case 'no': tone(160, 0.25, 'sawtooth', 0.05); break;
    case 'tick': tone(600, 0.05, 'square', 0.03); break;
    case 'jump': tone(420, 0.12, 'sine', 0.03, 0, 640); break;
    case 'swing': noise(0.18, 0.05, 2500); break;
    case 'bonk': tone(220, 0.15, 'square', 0.09, 0, 110); noise(0.12, 0.08, 600); break;
    case 'freeze': tone(900, 0.4, 'sine', 0.06, 0, 2400); break;
    case 'shock': tone(120, 0.3, 'sawtooth', 0.08); noise(0.3, 0.07, 3000); break;
    case 'smoke': noise(0.6, 0.08, 500); break;
    case 'grapple': tone(300, 0.35, 'triangle', 0.05, 0, 900); break;
    case 'rocket': noise(0.8, 0.08, 300); tone(90, 0.8, 'sawtooth', 0.04); break;
    case 'grab': tone(500, 0.1, 'square', 0.05); tone(750, 0.15, 'square', 0.05, 0.08); break;
    case 'drop': tone(400, 0.25, 'triangle', 0.05, 0, 180); break;
    case 'alarm': for (let i = 0; i < 4; i++) tone(i % 2 ? 660 : 880, 0.16, 'square', 0.05, i * 0.17); break;
    case 'lost': tone(330, 0.5, 'triangle', 0.06, 0, 160); break;
    case 'lock': tone(140, 0.6, 'sine', 0.08, 0, 280); tone(280, 0.6, 'triangle', 0.04); break;
    case 'rebirth': [0, 4, 7, 12, 16].forEach((s, i) => tone(392 * Math.pow(2, s / 12), 0.7, 'triangle', 0.05, i * 0.08)); break;
  }
}
