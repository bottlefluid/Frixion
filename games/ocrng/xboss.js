// Overcontrol RNG: ____X____ and the null soldiers, drawn like Minecraft players. Blocky bodies with Minecraft's
// proportions, netherite armour painted pixel by pixel (X wears Flow trims in quartz, the null general wears them in
// redstone), the purple enchantment glint sliding over everything, held items made of 16 x 16 pixels pushed out into 3D
// like Minecraft's, a nether portal, and Minecraft's square particles: totem pops, mace smashes, wind charge gusts,
// ender pearl teleports and golden apple crumbs. Everything here is drawn in code; nothing is copied from the game.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { glowTex, EXTRA_LAYERS } from './avatar.js';

export const PX = 0.25;   // studs per Minecraft pixel: X stands 8 studs tall, half again as big as a player

// ---------------- pixel textures ----------------
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function pixTex(w, h, paint) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  paint((x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); }, w, h, g);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const NETH = ['#3b3638', '#332f31', '#2b2729', '#433d40', '#4c4548', '#2f2a2d'];
const pickN = () => NETH[Math.floor(rnd() * NETH.length)];
const SLEEVE = ['#141317', '#1b191d', '#101013'];
// a Flow trim swirl, 3 x 3, drawn at (x, y)
const swirl = (set, x, y, c, flip) => { const p = flip ? [[2, 0], [1, 0], [0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [1, 1]] : [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1], [1, 1]]; p.slice(0, 8).forEach(([a, b]) => set(x + a, y + b, c)); };

// Each part's six faces, in three.js box order: +x, -x, +y, -y, +z (front), -z (back).
function armourSet(trim) {
  const T = trim || null, T2 = trim ? shade(trim, -0.25) : null;
  const base = (w, h) => (set => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, pickN()); });
  const face = (w, h, extra) => pixTex(w, h, (set, W, H, g) => { base(w, h)(set); if (extra) extra(set, W, H, g); });
  const head = [
    face(8, 8, set => { if (T) for (let y = 0; y < 3; y++) set(7 - (y > 1 ? 1 : 0), y + 1, T2); }),
    face(8, 8, set => { if (T) for (let y = 0; y < 3; y++) set(y > 1 ? 1 : 0, y + 1, T2); }),
    face(8, 8, set => { if (T) for (let y = 0; y < 8; y++) { set(3, y, T); set(4, y, T2); } }),
    face(8, 8),
    // the front: a hood around a black face with two deeper eyes; the trim runs down the brow
    face(8, 8, set => {
      for (let y = 2; y < 8; y++) for (let x = 1; x < 7; x++) set(x, y, y === 7 && (x === 1 || x === 6) ? '#2a2628' : '#0b0a0d');
      set(2, 4, '#000000'); set(5, 4, '#000000'); set(2, 5, '#050407'); set(5, 5, '#050407');
      if (T) { set(3, 0, T); set(4, 0, T); set(3, 1, T2); set(4, 1, T2); }
    }),
    face(8, 8, set => { if (T) for (let y = 0; y < 7; y++) { set(3, y, T); set(4, y, T2); } }),
  ];
  const body = [
    face(4, 12, set => { for (let y = 10; y < 12; y++) for (let x = 0; x < 4; x++) set(x, y, '#232023'); }),
    face(4, 12, set => { for (let y = 10; y < 12; y++) for (let x = 0; x < 4; x++) set(x, y, '#232023'); }),
    face(8, 4), face(8, 4),
    face(8, 12, set => {   // front: the chestplate's trim like a collar and a spine, then the belt
      for (let y = 10; y < 12; y++) for (let x = 0; x < 8; x++) set(x, y, '#232023');
      if (T) { [[1, 0], [2, 1], [3, 2], [6, 0], [5, 1], [4, 2]].forEach(([x, y]) => set(x, y, T)); for (let y = 3; y < 9; y++) { set(3, y, y % 2 ? T : T2); set(4, y, y % 2 ? T2 : T); } swirl(set, 0, 5, T2); swirl(set, 5, 5, T2, true); }
    }),
    face(8, 12, set => {   // back: a zigzag of trim
      for (let y = 10; y < 12; y++) for (let x = 0; x < 8; x++) set(x, y, '#232023');
      if (T) [[0, 3], [1, 4], [2, 5], [3, 4], [4, 4], [5, 5], [6, 4], [7, 3], [3, 6], [4, 6], [3, 7], [4, 7]].forEach(([x, y]) => set(x, y, T));
    }),
  ];
  // arms: a netherite shoulder with a swirl, a band of trim, and a black sleeve
  const arm = outer => face(4, 12, set => {
    for (let y = 6; y < 12; y++) for (let x = 0; x < 4; x++) set(x, y, SLEEVE[Math.floor(rnd() * SLEEVE.length)]);
    if (T) { for (let x = 0; x < 4; x++) set(x, 5, x % 2 ? T : T2); if (outer) swirl(set, 0, 1, T, false); }
  });
  const arms = [arm(true), arm(false), face(4, 4, set => { if (T) set(1, 1, T2); }), face(4, 4, set => { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) set(x, y, '#141317'); }), arm(false), arm(false)];
  const armsL = [arm(false), arm(true), arms[2], arms[3], arms[4], arms[5]];
  // legs: leggings, then boots with a swirl on the outside
  const leg = outer => face(4, 12, set => {
    for (let x = 0; x < 4; x++) set(x, 11, '#1e1b1e');
    if (T) { for (let x = 0; x < 4; x++) set(x, 6, T2); if (outer) { swirl(set, 0, 1, T2, true); swirl(set, 1, 8, T, false); } else swirl(set, 0, 8, T2, true); }
  });
  const legR = [leg(true), leg(false), face(4, 4), face(4, 4, set => { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) set(x, y, '#1a171a'); }), leg(false), leg(false)];
  const legL = [leg(false), leg(true), legR[2], legR[3], legR[4], legR[5]];
  return { head, body, armR: arms, armL: armsL, legR, legL };
}
function shade(hex, k) { const c = new THREE.Color(hex); if (k < 0) c.multiplyScalar(1 + k); else c.lerp(new THREE.Color('#ffffff'), k); return '#' + c.getHexString(); }

// the enchantment glint: purple streaks that slide across, added on top
let glintTexture = null;
export function glintTex() {
  if (glintTexture) return glintTexture;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 5; i++) {
    const x = rnd() * 64, w = 4 + rnd() * 10, a = 0.1 + rnd() * 0.22;
    g.fillStyle = `rgba(${150 + rnd() * 60},${70 + rnd() * 40},255,${a})`;
    for (let k = -64; k < 128; k += 64) { g.beginPath(); g.moveTo(x + k, 0); g.lineTo(x + k + w, 0); g.lineTo(x + k + w - 64, 64); g.lineTo(x + k - 64, 64); g.fill(); }
  }
  glintTexture = new THREE.CanvasTexture(c); glintTexture.wrapS = glintTexture.wrapT = THREE.RepeatWrapping; glintTexture.colorSpace = THREE.SRGBColorSpace;
  return glintTexture;
}
const glintMat = (opacity = 0.42) => new THREE.MeshBasicMaterial({ map: glintTex(), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

// ---------------- items: 16 x 16 pictures pushed out into 3D, like Minecraft's ----------------
function itemPixels(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  draw(g);
  const d = g.getImageData(0, 0, 16, 16).data, px = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = (y * 16 + x) * 4; if (d[i + 3] > 110) px.push({ x, y, c: new THREE.Color(`rgb(${d[i]},${d[i + 1]},${d[i + 2]})`) }); }
  return px;
}
const L = (g, c, w, pts) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'square'; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
const R = (g, c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const ITEMS = {
  sword: g => { L(g, '#1f1c1e', 3, [[4.5, 11.5], [14, 2]]); L(g, '#4a4446', 1.4, [[5, 11], [13.5, 2.5]]); L(g, '#7a7174', 0.9, [[6.5, 9], [13, 2.4]]); L(g, '#2b2729', 2, [[2, 9], [7, 14]]); L(g, '#5b3d27', 2, [[1.5, 14.5], [4.5, 11.5]]); R(g, '#2b2729', 0, 14, 2, 2); },
  axe: g => { L(g, '#6b4a2f', 1.8, [[2, 14.5], [11.5, 4]]); g.fillStyle = '#3d383a'; g.beginPath(); g.moveTo(8, 2); g.lineTo(13, 0.5); g.lineTo(15.5, 4); g.lineTo(14.5, 9); g.lineTo(11.5, 7); g.lineTo(9, 5); g.closePath(); g.fill(); L(g, '#756c6f', 1, [[13, 1.5], [15, 4.5], [14.2, 8.2]]); R(g, '#24201f', 10, 3, 2, 2); },
  mace: g => { L(g, '#a9dcea', 2.2, [[2, 14.5], [9, 7.5]]); L(g, '#5fa6bf', 0.9, [[2.5, 13], [8, 7.5]]); R(g, '#4a4a52', 8, 1, 7, 7); R(g, '#6e6e78', 8, 1, 7, 1); R(g, '#33333a', 8, 7, 7, 1); [[7, 0], [14, 0], [7, 7], [14, 7], [10, 0], [15, 3], [11, 7], [7, 4]].forEach(([x, y]) => R(g, '#8a8a95', x, y, 1, 1)); },
  totem: g => { R(g, '#e8c547', 5, 1, 6, 5); R(g, '#f7e27a', 5, 1, 6, 1); R(g, '#3fbf3f', 6, 3, 1, 1); R(g, '#3fbf3f', 9, 3, 1, 1); R(g, '#d7a92b', 4, 6, 8, 6); R(g, '#a87d1e', 4, 9, 8, 1); R(g, '#c99a26', 1, 6, 3, 4); R(g, '#c99a26', 12, 6, 3, 4); R(g, '#3fbf3f', 7, 7, 2, 2); R(g, '#a87d1e', 6, 12, 4, 3); },
  apple: g => { g.fillStyle = '#c99a26'; g.beginPath(); g.arc(8, 9.5, 6, 0, Math.PI * 2); g.fill(); g.fillStyle = '#f2c94c'; g.beginPath(); g.arc(7.5, 9, 5, 0, Math.PI * 2); g.fill(); R(g, '#fff2a8', 5, 6, 2, 2); R(g, '#5a3d27', 8, 1, 1, 3); R(g, '#3f9e3f', 9, 2, 3, 2); },
  pearl: g => { g.fillStyle = '#0c3b37'; g.beginPath(); g.arc(8, 8, 6, 0, Math.PI * 2); g.fill(); g.fillStyle = '#1f7a6e'; g.beginPath(); g.arc(8, 8, 4.5, 0, Math.PI * 2); g.fill(); g.fillStyle = '#0a2a27'; g.beginPath(); g.arc(8, 8, 2.2, 0, Math.PI * 2); g.fill(); R(g, '#7ff0d8', 5, 5, 2, 1); },
  wind: g => { g.fillStyle = '#9cc7da'; g.beginPath(); g.arc(8, 8, 6, 0, Math.PI * 2); g.fill(); g.fillStyle = '#d9f1fb'; g.beginPath(); g.arc(8, 8, 4.4, 0, Math.PI * 2); g.fill(); L(g, '#7fb0c8', 1.2, [[4, 8], [8, 5], [12, 8], [8, 11], [6, 8]]); R(g, '#ffffff', 6, 5, 2, 1); },
};
const itemGeo = new Map();
function extrude(id) {
  if (itemGeo.has(id)) return itemGeo.get(id);
  const px = itemPixels(ITEMS[id]), on = new Set(px.map(p => p.x + ',' + p.y));
  const pos = [], col = [], uv = [], s = 1 / 16, t = 0.5 / 16;
  const quad = (a, b, c, d, color) => { for (const v of [a, b, c, a, c, d]) { pos.push(...v); col.push(color.r, color.g, color.b); uv.push(v[0] + 0.5, v[1] + 0.5); } };
  for (const p of px) {
    const x0 = p.x * s - 0.5, x1 = x0 + s, y1 = 0.5 - p.y * s, y0 = y1 - s, cc = p.c, dk = cc.clone().multiplyScalar(0.72);
    quad([x0, y0, t], [x1, y0, t], [x1, y1, t], [x0, y1, t], cc);
    quad([x1, y0, -t], [x0, y0, -t], [x0, y1, -t], [x1, y1, -t], cc);
    if (!on.has(p.x - 1 + ',' + p.y)) quad([x0, y0, -t], [x0, y0, t], [x0, y1, t], [x0, y1, -t], dk);
    if (!on.has(p.x + 1 + ',' + p.y)) quad([x1, y0, t], [x1, y0, -t], [x1, y1, -t], [x1, y1, t], dk);
    if (!on.has(p.x + ',' + (p.y - 1))) quad([x0, y1, t], [x1, y1, t], [x1, y1, -t], [x0, y1, -t], dk);
    if (!on.has(p.x + ',' + (p.y + 1))) quad([x0, y0, -t], [x1, y0, -t], [x1, y0, t], [x0, y0, t], dk);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  itemGeo.set(id, geo);
  return geo;
}
const itemMat = new Map();
// an item mesh, `size` studs across; enchanted ones carry the glint
export function makeItem(id, size = 2.4, enchanted = true) {
  const g = new THREE.Group();
  if (id === 'spear') {   // a long netherite spear, built from blocks rather than a picture
    const dark = new THREE.MeshLambertMaterial({ color: '#2e2a2c' }), edge = new THREE.MeshLambertMaterial({ color: '#6d6467' });
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.16, 6.2, 0.16), dark); pole.position.y = 1.6; g.add(pole);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.5, 4), edge); tip.position.y = 5.4; g.add(tip);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.9, 0.22), new THREE.MeshLambertMaterial({ color: '#5b3d27' })); grip.position.y = -0.6; g.add(grip);
    if (enchanted) [pole, tip].forEach(m => { const o = new THREE.Mesh(m.geometry, glintMat(0.5)); o.position.copy(m.position); o.scale.setScalar(1.06); g.add(o); });
    return g;
  }
  if (!itemMat.has('v')) itemMat.set('v', new THREE.MeshLambertMaterial({ vertexColors: true }));
  const m = new THREE.Mesh(extrude(id), itemMat.get('v')); m.scale.setScalar(size); g.add(m);
  if (enchanted) { const o = new THREE.Mesh(extrude(id), glintMat(0.55)); o.scale.set(size * 1.01, size * 1.01, size * 1.3); g.add(o); }
  return g;
}
// the shield: purple, a light disc in the middle and a pale frame, like the ones in the pictures
let shieldFace = null;
function makeShield() {
  if (!shieldFace) shieldFace = pixTex(12, 22, set => {
    for (let y = 0; y < 22; y++) for (let x = 0; x < 12; x++) {
      const edge = x === 0 || y === 0 || x === 11 || y === 21;
      set(x, y, edge ? '#a98cf0' : (x + y) % 5 === 0 ? '#3e2380' : '#35206e');
    }
    for (let y = 0; y < 22; y++) for (let x = 0; x < 12; x++) { const d = Math.hypot(x - 5.5, y - 10.5); if (d < 2.6) set(x, y, d < 1.6 ? '#f1ecff' : '#d9ceff'); }
    [[2, 4], [3, 4], [8, 4], [9, 4], [2, 17], [3, 17], [8, 17], [9, 17], [5, 3], [6, 3], [5, 18], [6, 18]].forEach(([x, y]) => set(x, y, '#7d62c9'));
  });
  const back = new THREE.MeshLambertMaterial({ color: '#4a3a6e' }), front = new THREE.MeshLambertMaterial({ map: shieldFace });
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.BoxGeometry(12 * PX * 0.62, 22 * PX * 0.62, 0.16), [back, back, back, back, front, back]); g.add(s);
  const o = new THREE.Mesh(s.geometry, glintMat(0.2)); o.scale.set(1.02, 1.02, 1.4); g.add(o);
  return g;
}

// ---------------- Minecraft-style name tags ----------------
export function mcTag(text, color = '#ffffff') {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = 'bold 10px "Courier New", monospace';
  const w = Math.ceil(g.measureText(text).width) + 6;
  c.width = w; c.height = 13;
  g.fillStyle = 'rgba(0,0,0,.38)'; g.fillRect(0, 0, w, 13);
  g.font = 'bold 10px "Courier New", monospace'; g.textBaseline = 'top';
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillText(text, 4, 2.5); g.fillStyle = color; g.fillText(text, 3, 1.5);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set(w * 0.085, 13 * 0.085, 1);
  return s;
}

// ---------------- a Minecraft-style person ----------------
// opts: { trim, name, nameColor, scale }. pose() is called every frame with what they are doing.
export function createMcPerson(scene, opts = {}) {
  const root = new THREE.Group(); scene.add(root);
  const set = armourSet(opts.trim), mats = {};
  for (const k in set) mats[k] = set[k].map(t => new THREE.MeshLambertMaterial({ map: t }));
  const all = [];
  const part = (k, w, h, d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w * PX, h * PX, d * PX), mats[k]); m.castShadow = true; const gl = new THREE.Mesh(m.geometry, glintMat(0.13)); gl.scale.setScalar(1.015); m.add(gl); all.push(m); return m; };
  const body = new THREE.Group(); root.add(body);
  const torso = part('body', 8, 12, 4); torso.position.y = 18 * PX; body.add(torso);
  const head = part('head', 8, 8, 8); head.position.y = 4 * PX;
  const neck = new THREE.Group(); neck.position.y = 24 * PX; neck.add(head); body.add(neck);
  const limb = (k, x, y) => { const pivot = new THREE.Group(); pivot.position.set(x * PX, y * PX, 0); const m = part(k, 4, 12, 4); m.position.y = -6 * PX; pivot.add(m); body.add(pivot); return pivot; };
  const armR = limb('armR', -6, 24), armL = limb('armL', 6, 24), legR = limb('legR', -2, 12), legL = limb('legL', 2, 12);
  const handR = new THREE.Group(); handR.position.set(0, -10.5 * PX, 1 * PX); armR.add(handR);
  const handL = new THREE.Group(); handL.position.set(0, -10.5 * PX, 1 * PX); armL.add(handL);
  const shield = makeShield(); shield.position.set(1.4 * PX, -0.5, 1.1); shield.rotation.y = -0.15; handL.add(shield);
  const tag = mcTag(opts.name || '', opts.nameColor); tag.position.y = 36 * PX; root.add(tag);
  root.scale.setScalar(opts.scale || 1);
  // what is in the right hand
  const held = {}; let holding = null;
  const hold = id => {
    if (holding === id) return; holding = id;
    for (const k in held) held[k].visible = false;
    if (!id) return;
    if (!held[id]) {
      const it = makeItem(id, id === 'totem' || id === 'apple' || id === 'pearl' || id === 'wind' ? 1.5 : 2.6, id !== 'totem' && id !== 'pearl' && id !== 'wind');
      if (id === 'spear') { it.rotation.x = Math.PI / 2; it.position.z = -0.6; }
      else { it.rotation.set(0, Math.PI / 2, -Math.PI / 4); it.position.set(0, 0.35, 0.35); }
      handR.add(it); held[id] = it;
    }
    held[id].visible = true;
  };
  let walk = 0, clock = 0, hurtUntil = 0, deadT = -1;
  const tint = c => all.forEach(m => m.material.forEach(x => x.color.set(c)));
  return {
    root, head, neck, handR, handL, shield, tag,
    hold,
    hurt() { hurtUntil = clock + 0.35; tint('#ff6a6a'); },
    die() { if (deadT < 0) { deadT = 0; tint('#ff5a5a'); } },
    // p: { speed, act, k (0..1 through the action), lookUp }
    pose(dt, p) {
      clock += dt; walk += dt * Math.min(p.speed || 0, 20) * 0.5;
      if (hurtUntil && clock > hurtUntil && deadT < 0) { hurtUntil = 0; tint('#ffffff'); }
      if (deadT >= 0) { deadT += dt; root.rotation.z = -Math.min(1, deadT / 0.5) * Math.PI / 2; return deadT < 1.4; }
      const s = Math.min(1, (p.speed || 0) / 10) * Math.sin(walk);
      legR.rotation.x = s * 0.8; legL.rotation.x = -s * 0.8;
      armR.rotation.set(-s * 0.6, 0, 0); armL.rotation.set(s * 0.6, 0, 0);
      body.rotation.x = 0; neck.rotation.x = p.lookUp ? -0.9 : 0; root.rotation.z = 0;
      shield.visible = true;
      const k = p.k || 0, a = p.act;
      if (a === 'swing' || a === 'axe') { const e = k < 0.45 ? k / 0.45 : 1 - (k - 0.45) / 0.55 * 0.3; armR.rotation.x = -2.4 + e * 2.6; armR.rotation.y = -0.3; body.rotation.y = (0.5 - k) * 0.5; }
      else if (a === 'block') { armL.rotation.x = -1.2; armL.rotation.y = 0.5; armR.rotation.x = -0.4; }
      else if (a === 'eat') { armR.rotation.x = -1.4 + Math.sin(clock * 22) * 0.12; armR.rotation.y = 0.6; neck.rotation.x = 0.15 + Math.sin(clock * 22) * 0.06; }
      else if (a === 'raise') { armR.rotation.x = -2.9; armL.rotation.x = -0.5; legR.rotation.x = 0.4; legL.rotation.x = -0.2; }
      else if (a === 'smash') { armR.rotation.x = Math.min(0.5, -2.9 + k * 7); }
      else if (a === 'throw') { armR.rotation.x = -2.6 + Math.min(1, k * 2.4) * 2.8; }
      else if (a === 'lunge') { armR.rotation.x = -1.5; body.rotation.x = 0.35; legR.rotation.x = -0.9; legL.rotation.x = 0.7; }
      else if (a === 'totem') { armR.rotation.x = -2.8; armR.rotation.z = 0.2; }
      else if (a === 'air') { armR.rotation.x = -2.2; armL.rotation.x = -2.2; legR.rotation.x = 0.3; legL.rotation.x = -0.3; }
      return true;
    },
    dispose() { const shared = new Set(itemGeo.values()); scene.remove(root); root.traverse(o => { if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose(); }); },
  };
}

// ---------------- a nether portal ----------------
// A 4 x 5 obsidian frame (one block is 4 studs, as tall as half of X) with the swirling purple sheet inside.
let obsTex = null;
export function createPortal(scene, x, z, yaw) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw; scene.add(g);
  if (!obsTex) obsTex = pixTex(16, 16, set => { for (let y = 0; y < 16; y++) for (let x2 = 0; x2 < 16; x2++) set(x2, y, ['#0e0919', '#160e27', '#1d1233', '#26173f', '#120b20'][Math.floor(rnd() * 5)]); [[3, 4], [4, 4], [10, 9], [11, 10], [6, 12], [12, 3]].forEach(([a, b]) => set(a, b, '#3c2766')); });
  const om = new THREE.MeshLambertMaterial({ map: obsTex }), B = 4, blocks = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) {
    if (i > 0 && i < 3 && j > 0 && j < 4) continue;
    const b = new THREE.Mesh(new THREE.BoxGeometry(B, B, B), om); b.position.set((i - 1.5) * B, j * B + B / 2, 0); b.castShadow = true; g.add(b); blocks.push(b);
  }
  // the purple sheet: a canvas that keeps swirling
  const c = document.createElement('canvas'); c.width = 32; c.height = 48;
  const cg = c.getContext('2d'), tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(2 * B, 3 * B), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.86, side: THREE.DoubleSide, depthWrite: false }));
  sheet.position.y = 2.5 * B; g.add(sheet);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#a12cff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.set(16, 18, 1); glow.position.y = 2.5 * B; g.add(glow);
  let t = 0, broken = -1;
  const swirlPaint = () => {
    const img = cg.createImageData(32, 48);
    for (let y = 0; y < 48; y++) for (let x2 = 0; x2 < 32; x2++) {
      const v = Math.sin(x2 * 0.45 + t * 2.2 + Math.sin(y * 0.3 + t) * 2) + Math.sin(y * 0.35 - t * 1.7 + x2 * 0.2);
      const i = (y * 32 + x2) * 4, k = (v + 2) / 4;
      img.data[i] = 90 + k * 110; img.data[i + 1] = 20 + k * 40; img.data[i + 2] = 170 + k * 85; img.data[i + 3] = 200 + k * 55;
    }
    cg.putImageData(img, 0, 0); tex.needsUpdate = true;
  };
  swirlPaint();
  const bits = [];
  return {
    group: g,
    // the frame breaks: the blocks fly apart and the sheet goes out
    break() { if (broken >= 0) return; broken = 0; blocks.forEach(b => bits.push({ m: b, v: new THREE.Vector3((Math.random() - 0.5) * 14, 6 + Math.random() * 12, (Math.random() - 0.5) * 14), r: (Math.random() - 0.5) * 8 })); },
    update(dt) {
      t += dt;
      if ((t * 12 | 0) !== (((t - dt) * 12) | 0)) swirlPaint();
      if (broken >= 0) {
        broken += dt;
        sheet.material.opacity = Math.max(0, 0.86 - broken * 2); glow.material.opacity = Math.max(0, 0.5 - broken);
        for (const b of bits) { b.v.y -= 40 * dt; b.m.position.addScaledVector(b.v, dt); b.m.rotation.x += b.r * dt; b.m.scale.setScalar(Math.max(0.01, 1 - broken * 0.6)); }
        if (broken > 1.8) { scene.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); tex.dispose(); return false; }
      }
      return true;
    },
    dispose() { scene.remove(g); },
  };
}

// ---------------- particles ----------------
// Minecraft's particles are little squares. Points without a texture draw exactly that.
export function squares(scene, o) {
  const n = o.n || 40, geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = [];
  const cols = (o.colors || ['#ffffff']).map(c => new THREE.Color(c));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = (o.speed || 6) * (0.4 + Math.random() * 0.8), r = (o.spread || 0.6) * Math.random();
    pos.set([o.x + Math.cos(a) * r, o.y + (o.h || 0) * Math.random(), o.z + Math.sin(a) * r], i * 3);
    const c = cols[i % cols.length]; col.set([c.r, c.g, c.b], i * 3);
    vel.push(new THREE.Vector3(Math.cos(a) * sp * (o.flat ?? 1), (o.up ?? 4) * (0.5 + Math.random()), Math.sin(a) * sp * (o.flat ?? 1)));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: o.size || 0.32, vertexColors: true, transparent: true, depthWrite: false });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
  let t = 0; const life = o.life || 1;
  return {
    update(dt) {
      t += dt;
      for (let i = 0; i < n; i++) { const v = vel[i]; v.y -= (o.gravity ?? 12) * dt; v.multiplyScalar(1 - (o.drag ?? 0.8) * dt); pos[i * 3] += v.x * dt; pos[i * 3 + 1] += v.y * dt; pos[i * 3 + 2] += v.z * dt; }
      geo.attributes.position.needsUpdate = true; mat.opacity = Math.max(0, 1 - Math.pow(t / life, 2));
      if (t >= life) { scene.remove(pts); geo.dispose(); mat.dispose(); return false; }
      return true;
    },
  };
}
// a swirl of wind for wind charges
let gustTexture = null;
function gustTex() {
  if (gustTexture) return gustTexture;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.strokeStyle = 'rgba(235,248,255,.95)'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); for (let a = 0; a < Math.PI * 3.2; a += 0.15) { const r = 4 + a * 2.6; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.stroke();
  gustTexture = new THREE.CanvasTexture(c); gustTexture.colorSpace = THREE.SRGBColorSpace; return gustTexture;
}
// The effects. Each returns something with update(dt) that says false when it is finished.
export const FX = {
  totem(scene, x, y, z) {   // green and yellow squares everywhere, and the totem rising and spinning
    const p = squares(scene, { x, y: y + 4, z, n: 160, colors: ['#4fc832', '#99e550', '#f5e55c', '#e8c547', '#2e9e2a'], speed: 11, up: 9, gravity: -2, drag: 1.6, life: 2.4, size: 0.35, h: 3 });
    const it = makeItem('totem', 3.2, false); it.position.set(x, y + 5, z); scene.add(it);
    let t = 0;
    return { update(dt) { t += dt; it.position.y = y + 5 + t * 3.2; it.rotation.y += dt * 9; it.scale.setScalar(Math.max(0.01, 1 + t * 0.6 - Math.max(0, t - 0.9) * 2)); const alive = p.update(dt); if (t > 1.4 && it.parent) scene.remove(it); return alive; } };
  },
  smash(scene, x, y, z, power = 1) {   // the ground bursts in a ring of block bits, then dust
    const a = squares(scene, { x, y: y + 0.3, z, n: Math.round(70 * power), colors: ['#5a8f3a', '#7a5236', '#8d8d8d', '#6d4c41', '#4f7f32'], speed: 14 * power, up: 16, gravity: 40, drag: 0.6, life: 1.1, size: 0.45, spread: 2 });
    const b = squares(scene, { x, y: y + 0.4, z, n: 40, colors: ['#d8d8d8', '#bdbdbd', '#ffffff'], speed: 22, up: 1.5, gravity: 0, drag: 3, life: 0.9, size: 0.5, flat: 1, spread: 1 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.2, 40), new THREE.MeshBasicMaterial({ color: '#f5f5f5', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.25, z); scene.add(ring);
    let t = 0;
    return { update(dt) { t += dt; ring.scale.setScalar(1 + t * 22 * power); ring.material.opacity = Math.max(0, 0.8 - t * 1.6); const l1 = a.update(dt), l2 = b.update(dt); if (t > 0.6 && ring.parent) { scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); } return l1 || l2; } };
  },
  gust(scene, x, y, z) {   // a wind charge bursting
    const sprites = Array.from({ length: 7 }, (_, i) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: gustTex(), transparent: true, depthWrite: false, opacity: 0.9 })); s.position.set(x + (Math.random() - 0.5) * 2, y + 0.5 + Math.random() * 2, z + (Math.random() - 0.5) * 2); s.userData.spin = (i % 2 ? 1 : -1) * (4 + Math.random() * 4); scene.add(s); return s; });
    const p = squares(scene, { x, y: y + 1, z, n: 30, colors: ['#ffffff', '#e3f4fb', '#cfe9f5'], speed: 12, up: 6, gravity: 0, drag: 3, life: 0.7, size: 0.3 });
    let t = 0;
    return { update(dt) { t += dt; sprites.forEach(s => { s.material.rotation += s.userData.spin * dt; s.scale.setScalar(1.5 + t * 9); s.material.opacity = Math.max(0, 0.9 - t * 1.6); }); const alive = p.update(dt); if (t > 0.6) { sprites.forEach(s => { scene.remove(s); s.material.dispose(); }); return alive && false; } return true; } };
  },
  portal(scene, x, y, z) { return squares(scene, { x, y: y + 1, z, n: 50, colors: ['#b44cff', '#7a29c9', '#e07aff', '#5b1a9e'], speed: 3, up: 2, gravity: -1, drag: 1.2, life: 1.3, size: 0.28, h: 6, spread: 1.5 }); },
  crumbs(scene, x, y, z) { return squares(scene, { x, y, z, n: 9, colors: ['#f2c94c', '#c99a26', '#fff2a8'], speed: 2, up: 3, gravity: 25, drag: 0.5, life: 0.6, size: 0.22, spread: 0.3 }); },
  poof(scene, x, y, z) { return squares(scene, { x, y: y + 1, z, n: 28, colors: ['#ffffff', '#e0e0e0', '#bdbdbd'], speed: 2.5, up: 2.5, gravity: -1, drag: 1.4, life: 1.2, size: 0.5, h: 5, spread: 1.2 }); },
  crit(scene, x, y, z) { return squares(scene, { x, y: y + 3, z, n: 18, colors: ['#c8a46a', '#8a6a3a', '#ffffff'], speed: 7, up: 5, gravity: 18, drag: 1, life: 0.6, size: 0.24 }); },
  heal(scene, x, y, z) { return squares(scene, { x, y: y + 6, z, n: 24, colors: ['#ff5b5b', '#ffd54f', '#ff8a80'], speed: 2, up: 4, gravity: -2, drag: 1.3, life: 1.4, size: 0.42, h: 2, spread: 2 }); },
  sweep(scene, x, y, z, yaw) {   // the sword's white sweep in front
    const m = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.6, 24, 1, -0.9, 1.8), new THREE.MeshBasicMaterial({ color: '#eeeeee', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.set(-Math.PI / 2, 0, -yaw + Math.PI / 2); m.position.set(x, y + 4, z); scene.add(m);
    let t = 0;
    return { update(dt) { t += dt; m.material.opacity = Math.max(0, 0.85 - t * 3.5); m.scale.setScalar(1 + t * 1.5); if (t > 0.3) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); return false; } return true; } };
  },
  // a thrown thing flying from a to b (pearls arc, wind charges fly straight)
  throw(scene, kind, a, b, dur, arc) {
    const it = kind === 'pearl' ? makeItem('pearl', 0.9, false) : makeItem('wind', 1.1, false);
    scene.add(it); let t = 0;
    return { update(dt) { t += dt; const k = Math.min(1, t / dur); it.position.lerpVectors(a, b, k); it.position.y += Math.sin(k * Math.PI) * (arc || 0); it.rotation.y += dt * 10; it.rotation.z += dt * 6; if (k >= 1) { scene.remove(it); return false; } return true; } };
  },
};

// The ____X____ aura: his sword, axe, mace and spear circle you, and a totem floats over your head.
EXTRA_LAYERS.weapons = () => {
  const g = new THREE.Group(), items = ['sword', 'axe', 'mace', 'spear'].map((id, i) => { const it = makeItem(id, id === 'spear' ? 1 : 1.5); if (id === 'spear') it.scale.setScalar(0.45); g.add(it); return { it, i }; });
  const totem = makeItem('totem', 1.1, false); totem.position.y = 6.9; g.add(totem);
  return { obj: g, update: (dt, t) => {
    items.forEach(({ it, i }) => { const a = t * 0.9 + i * Math.PI / 2; it.position.set(Math.cos(a) * 2.7, 3 + Math.sin(t * 2 + i) * 0.35, Math.sin(a) * 2.7); it.rotation.set(0, -a, 0.5); });
    totem.rotation.y = t * 1.6; totem.position.y = 6.9 + Math.sin(t * 2.2) * 0.15;
  } };
};
