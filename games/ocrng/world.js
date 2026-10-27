// Overcontrol RNG: the map. Everything is built from studded blocks like a Roblox place: a spawn plaza with the
// Overcontrol monument, the Mixer's potion shop, the Jester's tent, a fishing pond with a dock, a waterfall cliff, a
// tall tower, trees, lamps, and a few secrets. Also the sky, day and night, and the weather.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { glowTex, buildAvatar } from './avatar.js';

// ---------------- studs ----------------
let studCanvas = null;
function studImage() {
  if (studCanvas) return studCanvas;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(0,0,0,.10)'; g.lineWidth = 2; g.strokeRect(1, 1, 62, 62);
  g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.arc(34, 35, 17, 0, Math.PI * 2); g.fill();          // stud shadow
  const r = g.createRadialGradient(27, 26, 2, 32, 32, 18);
  r.addColorStop(0, '#ffffff'); r.addColorStop(0.6, '#e6e6e6'); r.addColorStop(1, '#bdbdbd');
  g.fillStyle = r; g.beginPath(); g.arc(32, 32, 16, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 1.5; g.stroke();
  return (studCanvas = c);
}
const matCache = new Map();
function studMat(color, rx, ry, opts = {}) {
  const key = `${color}|${rx}|${ry}|${opts.emissive || ''}`;
  if (matCache.has(key)) return matCache.get(key);
  const t = new THREE.CanvasTexture(studImage());
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(Math.max(1, rx), Math.max(1, ry));
  t.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ color, map: t, roughness: 0.75, metalness: 0.02, emissive: opts.emissive || '#000000', emissiveIntensity: opts.emissive ? 0.6 : 0 });
  matCache.set(key, m);
  return m;
}
function plainMat(color, opts = {}) {
  const key = `plain|${color}|${opts.emissive || ''}|${opts.opacity || 1}`;
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.7, metalness: opts.metal ?? 0.03, emissive: opts.emissive || '#000000', emissiveIntensity: opts.emissive ? (opts.glow || 0.8) : 0, transparent: (opts.opacity || 1) < 1, opacity: opts.opacity || 1 });
  matCache.set(key, m);
  return m;
}

// ---------------- the world ----------------
export function createWorld(scene, quality) {
  const colliders = [];     // { min: Vector3, max: Vector3 }
  const animated = [];      // (dt, t, env) => void
  const root = new THREE.Group(); scene.add(root);
  const shadows = quality !== 'low';

  // A studded block. (x, z) is its middle, y its bottom.
  function box(x, y, z, w, h, d, color, o = {}) {
    const side = o.studsAllOver ? studMat(color, w, h, o) : plainMat(color, o);
    const top = o.smooth ? plainMat(color, o) : studMat(color, w, d, o);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, plainMat(color, o), side, side]);
    mesh.position.set(x, y + h / 2, z);
    if (o.ry) mesh.rotation.y = o.ry;
    mesh.castShadow = shadows && !o.noShadow; mesh.receiveShadow = shadows;
    (o.parent || root).add(mesh);
    if (!o.noCollide) colliders.push({ min: new THREE.Vector3(x - w / 2, y, z - d / 2), max: new THREE.Vector3(x + w / 2, y + h, z + d / 2), id: o.id });
    return mesh;
  }
  const glow = (color, scale, x, y, z, parent = root, opacity = 0.7) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity }));
    s.scale.set(scale, scale, 1); s.position.set(x, y, z); parent.add(s); return s;
  };

  // ---- ground: a green baseplate with a moat-free edge fence ----
  const SIZE = 200;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), studMat('#5aa34f', SIZE, SIZE));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = shadows; root.add(ground);
  // the edges: a low fence, and invisible walls so nobody walks off the world
  for (const [x, z, w, d] of [[0, -99, 200, 1], [0, 99, 200, 1], [-99, 0, 1, 200], [99, 0, 1, 200]]) {
    box(x, 0, z, w, 2.2, d, '#8d6e63', { smooth: true });
    colliders.push({ min: new THREE.Vector3(x - w / 2, 0, z - d / 2), max: new THREE.Vector3(x + w / 2, 60, z + d / 2) });
  }

  // ---- paths from the plaza to each place ----
  const path = (x, z, w, d) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), studMat('#a1a1a1', w, d)); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.03, z); m.receiveShadow = shadows; root.add(m); };
  path(0, 30, 6, 30); path(-28, -6, 30, 6); path(29, -6, 28, 6); path(0, -40, 6, 50); path(-40, 18, 6, 40);

  // ---- spawn plaza and the Overcontrol monument ----
  box(0, 0, 0, 30, 1, 30, '#9e9e9e');
  box(0, 0, 0, 34, 0.5, 34, '#757575', { noCollide: true });
  box(0, 1, -7, 7, 1.5, 7, '#424242');
  box(0, 2.5, -7, 5, 1.2, 5, '#616161');
  box(0, 3.7, -7, 2, 12, 2, '#1d1240', { emissive: '#3a1f80', glow: 0.35 });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.6), new THREE.MeshStandardMaterial({ color: '#b794ff', emissive: '#8b5cff', emissiveIntensity: 1.2, metalness: 0.4, roughness: 0.2 }));
  core.position.set(0, 20, -7); root.add(core);
  glow('#9c6bff', 12, 0, 20, -7);
  const rings = [0, 1, 2].map(i => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(3 + i * 0.9, 0.12, 8, 64), new THREE.MeshBasicMaterial({ color: i === 1 ? '#ffffff' : '#a98bff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }));
    r.position.set(0, 20, -7); root.add(r); return r;
  });
  animated.push((dt, t) => { core.rotation.y += dt; core.position.y = 20 + Math.sin(t * 1.2) * 0.5; rings.forEach((r, i) => { r.rotation.x = t * (0.4 + i * 0.2); r.rotation.y = t * (0.3 - i * 0.15); r.position.y = core.position.y; }); });
  // plaza benches and planters
  for (const [x, z] of [[-11, 8], [11, 8], [-11, -2], [11, -2]]) { box(x, 1, z, 4, 0.8, 1.4, '#795548'); }
  for (const [x, z] of [[-13, -13], [13, -13], [-13, 13], [13, 13]]) { box(x, 1, z, 3, 1.4, 3, '#6d4c41'); box(x, 2.4, z, 2.4, 0.6, 2.4, '#43a047'); }
  // the welcome sign
  const sign = signBoard('OVERCONTROL\'S RNG', 'Roll · Fish · Trade with the Jester', '#9c6bff');
  sign.position.set(11, 0, 17.5); root.add(sign);   // at the plaza's south corner, facing people walking up from the pond

  // ---- the Mixer's potion shop (north-west) ----
  const MX = -42, MZ = -8;
  box(MX, 0, MZ, 16, 1, 14, '#8d6e63');
  box(MX, 1, MZ - 6.5, 16, 8, 1, '#efebe9');
  box(MX - 7.5, 1, MZ, 1, 8, 14, '#efebe9');
  box(MX + 7.5, 1, MZ - 3, 1, 8, 8, '#efebe9');
  box(MX, 9, MZ, 18, 1, 16, '#6a1b9a', { noShadow: true });
  box(MX, 10, MZ, 14, 1, 12, '#7b1fa2', { noShadow: true });
  box(MX, 11, MZ, 9, 1, 8, '#8e24aa', { noShadow: true });
  box(MX + 1, 1, MZ + 1, 10, 3, 2, '#5d4037');                         // counter
  const caul = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.2, 2, 20), plainMat('#263238', { metal: 0.5, rough: 0.4 }));
  caul.position.set(MX - 3, 2, MZ - 3); caul.castShadow = shadows; root.add(caul);
  colliders.push({ min: new THREE.Vector3(MX - 4.6, 1, MZ - 4.6), max: new THREE.Vector3(MX - 1.4, 3, MZ - 1.4) });
  const brew = new THREE.Mesh(new THREE.CircleGeometry(1.45, 20), new THREE.MeshBasicMaterial({ color: '#76ff03' }));
  brew.rotation.x = -Math.PI / 2; brew.position.set(MX - 3, 2.95, MZ - 3); root.add(brew);
  const brewGlow = glow('#76ff03', 6, MX - 3, 3.6, MZ - 3);
  const bubbles = bubbleDots('#b2ff59'); bubbles.obj.position.set(MX - 3, 3, MZ - 3); root.add(bubbles.obj); animated.push((dt, t) => { bubbles.update(dt); brewGlow.material.opacity = 0.5 + Math.sin(t * 3) * 0.15; });
  // shelves of potions
  for (let i = 0; i < 6; i++) {
    const colors = ['#3ddc84', '#4fc3ff', '#ffd54a', '#ff80ab', '#7c4dff', '#ff7043'];
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.9, 10), new THREE.MeshStandardMaterial({ color: colors[i], emissive: colors[i], emissiveIntensity: 0.5, transparent: true, opacity: 0.85 }));
    b.position.set(MX - 5 + i * 2, 6.2, MZ - 5.6); root.add(b);
  }
  box(MX, 5.5, MZ - 5.6, 14, 0.3, 1, '#4e342e', { noCollide: true });
  const mixer = npc('Mixer', 'Potion Brewer', '#7b1fa2', '#ffd54f'); mixer.root.position.set(MX + 1, 1, MZ - 1.6); mixer.root.rotation.y = 0; root.add(mixer.root);
  const shopSign = signBoard('MIXER\'S BREWERY', 'Potions for luck and speed', '#ab47bc'); shopSign.position.set(MX, 12.2, MZ + 7.2); shopSign.rotation.y = Math.PI; root.add(shopSign);

  // ---- the Jester's tent (east) ----
  const JX = 42, JZ = -10;
  const tent = new THREE.Group(); tent.position.set(JX, 0, JZ); root.add(tent);
  const stripes = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 9, 11, 16, 1, true), new THREE.MeshStandardMaterial({ map: stripeTex(), side: THREE.DoubleSide, roughness: 0.8 }));
  stripes.position.y = 5.5; stripes.castShadow = shadows; tent.add(stripes);
  const flag = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.6, 4), plainMat('#ffd600', { emissive: '#ffd600', glow: 0.3 })); flag.position.y = 11.6; tent.add(flag);
  colliders.push({ min: new THREE.Vector3(JX - 6.4, 0, JZ - 6.4), max: new THREE.Vector3(JX + 6.4, 9, JZ + 6.4) });
  box(JX, 0, JZ + 11.5, 10, 0.4, 5, '#4a148c', { smooth: true, noCollide: true });
  const jester = npc('Jester', 'Trades Void Coins', '#6a1b9a', '#ffd600', true); jester.root.position.set(JX, 0.4, JZ + 11); root.add(jester.root);
  const jesterSign = signBoard('THE JESTER', 'Visits every 4 hours', '#ffd600'); jesterSign.position.set(JX + 9, 0, JZ + 12); jesterSign.rotation.y = Math.PI * 1.15; root.add(jesterSign);
  const jesterGlow = glow('#b388ff', 10, JX, 3, JZ + 11, root, 0);

  // ---- the pond, the dock and Old Finn (south) ----
  const PX = 0, PZ = 50, PW = 44, PD = 26;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(PW, PD, 1, 1), new THREE.MeshStandardMaterial({ color: '#1f7ae0', map: waterTex(), transparent: true, opacity: 0.86, roughness: 0.15, metalness: 0.1 }));
  water.rotation.x = -Math.PI / 2; water.position.set(PX, 0.12, PZ); root.add(water);
  animated.push((dt) => { water.material.map.offset.x += dt * 0.02; water.material.map.offset.y += dt * 0.012; });
  // stone rim, with a gap where the dock starts
  box(PX - PW / 2 - 0.75, 0, PZ, 1.5, 1.2, PD + 3, '#90a4ae'); box(PX + PW / 2 + 0.75, 0, PZ, 1.5, 1.2, PD + 3, '#90a4ae');
  box(PX, 0, PZ + PD / 2 + 0.75, PW, 1.2, 1.5, '#90a4ae');
  box(PX - 13, 0, PZ - PD / 2 - 0.75, PW / 2 - 4, 1.2, 1.5, '#90a4ae'); box(PX + 13, 0, PZ - PD / 2 - 0.75, PW / 2 - 4, 1.2, 1.5, '#90a4ae');
  // the water itself can't be walked on: tall invisible walls, too high to step or jump onto
  colliders.push({ min: new THREE.Vector3(PX - PW / 2, 0, PZ - PD / 2), max: new THREE.Vector3(PX - 2.2, 14, PZ + PD / 2), water: true });
  colliders.push({ min: new THREE.Vector3(PX + 2.2, 0, PZ - PD / 2), max: new THREE.Vector3(PX + PW / 2, 14, PZ + PD / 2), water: true });
  colliders.push({ min: new THREE.Vector3(PX - 2.2, 0, PZ + 2.2), max: new THREE.Vector3(PX + 2.2, 14, PZ + PD / 2), water: true });
  box(PX, 0.6, PZ - 6, 4, 0.5, 16, '#a1887f');                          // the dock
  for (const z of [PZ - 12, PZ - 6, PZ, PZ + 2]) for (const sx of [-1.7, 1.7]) box(PX + sx, 0, z, 0.5, 1.8, 0.5, '#6d4c41', { noCollide: true });
  const finn = npc('Old Finn', 'Fishing supplies', '#0277bd', '#ffcc80'); finn.root.position.set(PX - 5, 0, PZ - 16); finn.root.rotation.y = Math.PI / 2; root.add(finn.root);
  // lily pads
  for (const [x, z] of [[-12, 44], [-8, 58], [14, 54], [18, 42], [-17, 52]]) { const l = new THREE.Mesh(new THREE.CircleGeometry(1.1, 12), plainMat('#2e7d32')); l.rotation.x = -Math.PI / 2; l.position.set(x, 0.16, z); root.add(l); }
  // Easter egg: a rubber duck floating out on the pond
  const duck = new THREE.Group(); duck.position.set(11, 0.2, 51); root.add(duck);
  const yellow = plainMat('#ffeb3b');
  const dB = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.9), yellow); dB.position.y = 0.4; duck.add(dB);
  const dH = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), yellow); dH.position.set(0.45, 1, 0); duck.add(dH);
  const dK = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.3), plainMat('#ff9800')); dK.position.set(0.85, 0.95, 0); duck.add(dK);
  animated.push((dt, t) => { duck.position.y = 0.2 + Math.sin(t * 1.6) * 0.06; duck.rotation.y = Math.sin(t * 0.3) * 0.6; });

  // ---- the waterfall cliff (north), with a hidden cave behind the water ----
  const CZ = -78;
  // the cliff face runs along z = CZ + 5, with a cave mouth at x 13..23 hidden behind the waterfall
  box(-18.5, 0, CZ, 63, 32, 10, '#78716c', { studsAllOver: true });
  box(36.5, 0, CZ, 27, 32, 10, '#78716c', { studsAllOver: true });
  box(18, 7, CZ, 10, 25, 10, '#78716c', { studsAllOver: true });                                        // above the cave mouth
  box(18, 0, CZ - 9, 12, 32, 8, '#6d6560', { studsAllOver: true });                                      // the back of the cave
  for (let i = 0; i < 6; i++) box(-30 + i * 11, 32, CZ + (i % 2) * 2, 9, 2 + (i % 3), 8, '#43a047');  // grass on top
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(6, 30), new THREE.MeshBasicMaterial({ map: fallTex(), transparent: true, opacity: 0.85, depthWrite: false }));
  fall.position.set(18, 15.5, CZ + 5.4); root.add(fall);
  animated.push((dt) => { fall.material.map.offset.y += dt * 0.9; });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshStandardMaterial({ color: '#29b6f6', transparent: true, opacity: 0.8, roughness: 0.1 }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(18, 0.1, CZ + 8); root.add(pool);
  const mist = bubbleDots('#e1f5fe', 30, true); mist.obj.position.set(18, 0.5, CZ + 6.5); root.add(mist.obj); animated.push(dt => mist.update(dt));
  // inside: the Dev Room
  const devSign = signBoard('DEV ROOM', 'You found the secret cave!', '#5865f2'); devSign.position.set(18, 0.5, CZ - 4.6); root.add(devSign);
  const env = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 0.3), new THREE.MeshStandardMaterial({ color: '#5865f2', emissive: '#5865f2', emissiveIntensity: 0.8 }));
  env.position.set(18, 5.2, CZ - 3); root.add(env); glow('#7c88ff', 8, 18, 5.2, CZ - 3);
  animated.push((dt, t) => { env.rotation.y = t; env.position.y = 5.2 + Math.sin(t * 2) * 0.3; });

  // ---- the tower (west), climb its stairs to the top ----
  const TX = -70, TZ = 40, TH = 36;
  box(TX, 0, TZ, 6, TH, 6, '#5d6d7e', { studsAllOver: true });
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    const a = (i / 12) * Math.PI * 2, r = 5.2;
    const y = (i + 1) * (TH / steps);
    box(TX + Math.cos(a) * r, y - 0.6, TZ + Math.sin(a) * r, 3, 0.6, 3, i % 2 ? '#8d6e63' : '#a1887f');
  }
  box(TX, TH, TZ, 7, 1, 7, '#455a64');   // the top; the stairs arrive on its open +x side
  for (const [x, z, w, d] of [[TX, TZ - 3.5, 7, 0.5], [TX, TZ + 3.5, 7, 0.5], [TX - 3.5, TZ, 0.5, 7]]) box(x, TH + 1, z, w, 1.2, d, '#37474f');
  const goldStud = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.5, 20), new THREE.MeshStandardMaterial({ color: '#ffd700', emissive: '#ffb300', emissiveIntensity: 0.7, metalness: 0.8, roughness: 0.2 }));
  goldStud.position.set(TX, TH + 1.6, TZ); root.add(goldStud); glow('#ffd54a', 6, TX, TH + 1.8, TZ);
  animated.push((dt) => { goldStud.rotation.y += dt * 1.5; });

  // ---- a glitch in the far corner, which leads to the Null room ----
  const GX = 88, GZ = -88;
  const glitch = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ color: '#000000' }));
  glitch.position.set(GX, 1, GZ); root.add(glitch);
  const glitchEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.05, 2.05, 2.05)), new THREE.LineBasicMaterial({ color: '#00ffd0' }));
  glitch.add(glitchEdges);
  animated.push((dt, t) => { glitch.rotation.y = t * 0.7; glitch.position.x = GX + (Math.random() < 0.08 ? (Math.random() - 0.5) * 0.6 : 0); glitchEdges.material.color.setHSL((t * 0.5) % 1, 1, 0.55); });
  // the Null room, far away from everything
  const NX = 0, NZ = 900;
  box(NX, 0, NZ, 30, 1, 30, '#212121');
  for (const [x, z, w, d] of [[NX, NZ - 15, 30, 1], [NX, NZ + 15, 30, 1], [NX - 15, NZ, 1, 30], [NX + 15, NZ, 1, 30]]) box(x, 1, z, w, 12, d, '#111111');
  const nullSign = signBoard('NULL', 'Nothing is real here. Step into the light to go home.', '#9e9e9e'); nullSign.position.set(NX, 1, NZ - 14); root.add(nullSign);
  const portal = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.25, 12, 48), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  portal.position.set(NX, 3.5, NZ + 10); root.add(portal); glow('#ffffff', 10, NX, 3.5, NZ + 10);
  animated.push((dt, t) => { portal.rotation.z = t; });

  // ---- more water to fish in ----
  // A patch of water with stone edges; invisible walls keep people out of it.
  const waterPatch = (x, z, w, d, color, rimColor) => {
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color, map: waterTex(), transparent: true, opacity: 0.86, roughness: 0.15, metalness: 0.1 }));
    wm.rotation.x = -Math.PI / 2; wm.position.set(x, 0.12, z); root.add(wm);
    animated.push(dt => { wm.material.map.offset.x += dt * 0.025; });
    if (rimColor) { box(x, 0, z - d / 2 - 0.5, w + 2, 0.8, 1, rimColor); box(x, 0, z + d / 2 + 0.5, w + 2, 0.8, 1, rimColor); box(x - w / 2 - 0.5, 0, z, 1, 0.8, d, rimColor); box(x + w / 2 + 0.5, 0, z, 1, 0.8, d, rimColor); }
    colliders.push({ min: new THREE.Vector3(x - w / 2, 0, z - d / 2), max: new THREE.Vector3(x + w / 2, 14, z + d / 2), water: true });
    return wm;
  };
  // Sunset Lagoon (north-east): sand, palm-ish trees and a little pier
  const LX = 66, LZ = -36;
  box(LX, 0, LZ, 30, 0.3, 26, '#e8d29a', { noCollide: true });
  waterPatch(LX + 3, LZ - 3, 18, 12, '#22a7c9');
  box(LX - 7.5, 0.3, LZ - 3, 4, 0.5, 3, '#a1887f');                    // the pier you fish from
  for (const [x, z] of [[LX - 12, LZ + 9], [LX + 12, LZ + 10], [LX - 13, LZ - 10]]) { box(x, 0, z, 1.2, 9, 1.2, '#8d6e63'); box(x, 9, z, 6, 0.8, 1.6, '#2e7d32', { noCollide: true }); box(x, 9, z, 1.6, 0.8, 6, '#388e3c', { noCollide: true }); }
  // Tower Creek (west, by the tower)
  waterPatch(-86, 40, 6, 56, '#2a8fd6', '#78909c');
  // the Void Pool, inside the Null room
  const vp = waterPatch(NX - 8, NZ + 2, 8, 6, '#1a0033');
  vp.material.opacity = 0.95; glow('#7c4dff', 10, NX - 8, 0.6, NZ + 2, root, 0.5);
  // a glowing ring marks every place you can fish
  const spotRing = (x, y, z) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.55, 40), new THREE.MeshBasicMaterial({ color: '#4fd8ff', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.06, z); root.add(m);
    animated.push((dt, t) => { m.material.opacity = 0.45 + Math.sin(t * 2.5) * 0.25; m.scale.setScalar(1 + Math.sin(t * 2.5) * 0.06); });
  };
  const SPOTS = {
    dock: new THREE.Vector3(PX, 1.1, PZ + 1),
    falls: new THREE.Vector3(18, 0, CZ + 13),
    lagoon: new THREE.Vector3(LX - 7.5, 0.8, LZ - 3),
    creek: new THREE.Vector3(-81.5, 0, 40),
    void: new THREE.Vector3(NX - 8, 1, NZ + 6.5),
  };
  for (const p of Object.values(SPOTS)) spotRing(p.x, p.y, p.z);
  // Marlin's fish stall, at the foot of the dock
  const stall = (x, z, roofA, roofB, ry = 0) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; root.add(g);
    const part = (px, py, pz, w, h, d, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), plainMat(c)); m.position.set(px, py + h / 2, pz); m.castShadow = shadows; m.receiveShadow = shadows; g.add(m); };
    part(0, 0, 1.2, 6, 1.6, 1.2, '#795548');                                // counter
    for (const sx of [-2.8, 2.8]) part(sx, 0, 1.6, 0.35, 4.6, 0.35, '#5d4037');
    for (let i = 0; i < 6; i++) part(-2.5 + i, 4.6, 1.2, 1, 0.35, 3, i % 2 ? roofA : roofB);   // striped awning
    const s = Math.sin(ry), c = Math.cos(ry);
    const cx = x + 1.2 * s, cz = z + 1.2 * c, hx = 3 * Math.abs(c) + 0.6 * Math.abs(s), hz = 3 * Math.abs(s) + 0.6 * Math.abs(c);   // the counter, after turning
    colliders.push({ min: new THREE.Vector3(cx - hx, 0, cz - hz), max: new THREE.Vector3(cx + hx, 1.6, cz + hz) });
    return g;
  };
  stall(10, 32, '#1e88e5', '#ffffff', -Math.PI / 2);   // the counter faces the path
  const marlin = npc('Marlin', 'Buys your fish', '#00897b', '#80deea'); marlin.root.position.set(11.4, 0, 32); marlin.root.rotation.y = -Math.PI / 2; root.add(marlin.root);
  // Nova's daily shop, beside the plaza
  stall(23, 11, '#8e24aa', '#ffd54f', -Math.PI / 2);
  const nova = npc('Nova', 'Daily Shop', '#6a1b9a', '#ffd54f'); nova.root.position.set(24.4, 0, 11); nova.root.rotation.y = -Math.PI / 2; root.add(nova.root);

  // ---- a sun statue, a thank-you to Sol's RNG (south-east) ----
  const SX = 62, SZ = 46;
  box(SX, 0, SZ, 6, 3, 6, '#bdbdbd'); box(SX, 3, SZ, 4, 1, 4, '#9e9e9e');
  const sun = new THREE.Mesh(new THREE.IcosahedronGeometry(2, 0), new THREE.MeshStandardMaterial({ color: '#ffca28', emissive: '#ffa000', emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 }));
  sun.position.set(SX, 7, SZ); root.add(sun); glow('#ffd54f', 9, SX, 7, SZ);
  animated.push((dt) => { sun.rotation.y += dt * 0.4; sun.rotation.x += dt * 0.2; });
  const plaque = signBoard('THANK YOU, SOL', 'Inspired by Sol\'s RNG on Roblox', '#ffca28'); plaque.position.set(SX, 0, SZ + 3.4); plaque.rotation.y = Math.PI; root.add(plaque);

  // ---- trees, rocks, flowers and lamps ----
  const rand = mulberry(42);
  const blocked = (x, z) => Math.hypot(x, z) < 24 || (Math.abs(x - MX) < 14 && Math.abs(z - MZ) < 14) || (Math.abs(x - JX) < 14 && Math.abs(z - JZ) < 16)
    || (Math.abs(x - PX) < 28 && Math.abs(z - PZ) < 22) || z < -68 || (Math.abs(x - 66) < 18 && Math.abs(z + 36) < 16) || (x < -78 && z > 8 && z < 72) || (Math.abs(x - 23) < 6 && Math.abs(z - 11) < 6) || (Math.abs(x - TX) < 12 && Math.abs(z - TZ) < 12) || (Math.abs(x - SX) < 8 && Math.abs(z - SZ) < 8)
    || Math.abs(x) < 5 || (Math.abs(z + 6) < 5 && Math.abs(x) < 45) || (Math.abs(x + 40) < 5 && z > 0 && z < 40) || (Math.abs(x - GX) < 6 && Math.abs(z - GZ) < 6);
  let trees = 0;
  for (let i = 0; i < 400 && trees < 46; i++) {
    const x = (rand() - 0.5) * 186, z = (rand() - 0.5) * 186;
    if (blocked(x, z)) continue;
    trees++;
    const h = 5 + Math.floor(rand() * 4);
    box(x, 0, z, 1.6, h, 1.6, '#6d4c41');
    const leaf = ['#2e7d32', '#388e3c', '#43a047', '#1b5e20'][Math.floor(rand() * 4)];
    box(x, h, z, 6, 3, 6, leaf, { noCollide: true });
    box(x, h + 3, z, 4, 2, 4, leaf, { noCollide: true });
  }
  for (let i = 0; i < 26; i++) {
    const x = (rand() - 0.5) * 180, z = (rand() - 0.5) * 180;
    if (blocked(x, z)) continue;
    const s = 1 + rand() * 2.5;
    box(x, 0, z, s * 1.4, s, s * 1.2, '#8d8d8d', { ry: rand() * 3 });
  }
  const flowerColors = ['#ff5252', '#ffd740', '#e040fb', '#ffffff', '#40c4ff'];
  for (let i = 0; i < 90; i++) {
    const x = (rand() - 0.5) * 180, z = (rand() - 0.5) * 180;
    if (blocked(x, z)) continue;
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), plainMat(flowerColors[i % 5]));
    f.position.set(x, 0.6, z); root.add(f);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), plainMat('#2e7d32')); st.position.set(x, 0.3, z); root.add(st);
  }
  const lamps = [];
  for (const [x, z] of [[4, 26], [-4, 36], [-4, 44], [-22, -2], [-34, -10], [20, -2], [32, -10], [-4, -30], [4, -50], [-36, 10], [-44, 28], [16, 16], [-16, 16]]) {
    box(x, 0, z, 0.6, 7, 0.6, '#37474f');
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4), new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffcc66', emissiveIntensity: 0.2 }));
    head.position.set(x, 7.5, z); root.add(head);
    lamps.push({ head, glow: glow('#ffcc66', 9, x, 7.5, z, root, 0) });
  }

  // ---------------- sky, sun, moon, stars ----------------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color('#4aa3ff') }, bottom: { value: new THREE.Color('#cfe9ff') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = max(vP.y, 0.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.6)), 1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat); scene.add(sky);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#fff3c4', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  sunSprite.scale.set(90, 90, 1); scene.add(sunSprite);
  const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#dfe7ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  moonSprite.scale.set(60, 60, 1); scene.add(moonSprite);
  const starGeo = new THREE.BufferGeometry(), starPos = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) { const v = new THREE.Vector3(rand() - 0.5, rand() * 0.9 + 0.1, rand() - 0.5).normalize().multiplyScalar(450); starPos.set([v.x, v.y, v.z], i * 3); }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  scene.add(stars);

  // lights
  const hemi = new THREE.HemisphereLight('#bfe3ff', '#3d5a3a', 0.9); scene.add(hemi);
  const sunLight = new THREE.DirectionalLight('#ffffff', 1.6);
  sunLight.castShadow = shadows;
  if (shadows) { sunLight.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024); const sc = sunLight.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 260; sunLight.shadow.bias = -0.0008; }
  scene.add(sunLight); scene.add(sunLight.target);
  scene.fog = new THREE.Fog('#cfe9ff', 120, 420);

  // ---------------- weather around the player ----------------
  const weatherFx = makeWeather(scene);

  // How everything looks for a given time and weather. Colours ease towards their targets so changes are smooth.
  const look = {
    day: { top: '#3d8fff', bottom: '#cfe9ff', fog: '#cfe9ff', sun: 1.7, hemi: 0.95, stars: 0 },
    night: { top: '#071033', bottom: '#243266', fog: '#151d40', sun: 0.5, hemi: 0.6, stars: 1 },
    rain: { top: '#4b5867', bottom: '#8795a3', fog: '#7c8a98', sun: 0.6, hemi: 0.7, fogNear: 50, fogFar: 230 },
    snow: { top: '#a9c3db', bottom: '#eef5fb', fog: '#e4eef7', sun: 1.0, hemi: 1.0, fogNear: 40, fogFar: 220 },
    hell: { top: '#3a0400', bottom: '#b3260a', fog: '#7a1500', sun: 0.8, hemi: 0.6, sunColor: '#ff6a3d', fogNear: 30, fogFar: 200 },
    heaven: { top: '#fff7d6', bottom: '#ffffff', fog: '#fffbe8', sun: 1.9, hemi: 1.2, sunColor: '#fff3c4', fogNear: 40, fogFar: 260 },
    null: { top: '#111111', bottom: '#3a3a3a', fog: '#1c1c1c', sun: 0.5, hemi: 0.55, fogNear: 25, fogFar: 160 },
    solar: { top: '#ff9a3c', bottom: '#ffe0a3', fog: '#ffd9a0', sun: 2.4, hemi: 1.1, sunColor: '#ffd27a', fogNear: 80, fogFar: 380 },
  };
  const cur = { top: new THREE.Color(look.day.top), bottom: new THREE.Color(look.day.bottom), fog: new THREE.Color(look.day.fog), sun: 1.6, hemi: 0.9, stars: 0, near: 120, far: 420, sunColor: new THREE.Color('#ffffff') };
  const tmp = new THREE.Color();

  return {
    root, colliders,
    spawn: new THREE.Vector3(0, 1, 6),
    places: {
      mixer: { pos: new THREE.Vector3(MX + 1, 1, MZ + 2.5), r: 6.5, label: 'Talk to the Mixer' },
      jester: { pos: new THREE.Vector3(JX, 0, JZ + 13), r: 6, label: 'Talk to the Jester' },
      finn: { pos: new THREE.Vector3(PX - 5, 0, PZ - 16), r: 6, label: 'Talk to Old Finn' },
      fish_dock: { pos: SPOTS.dock, r: 3.4, label: 'Fish (The Dock)', spot: 'dock' },
      fish_falls: { pos: SPOTS.falls, r: 3.4, label: 'Fish (Waterfall Pool)', spot: 'falls' },
      fish_lagoon: { pos: SPOTS.lagoon, r: 3.4, label: 'Fish (Sunset Lagoon)', spot: 'lagoon' },
      fish_creek: { pos: SPOTS.creek, r: 3.4, label: 'Fish (Tower Creek)', spot: 'creek' },
      fish_void: { pos: SPOTS.void, r: 3.4, label: 'Fish (The Void Pool)', spot: 'void' },
      marlin: { pos: new THREE.Vector3(6.5, 0, 32), r: 4.5, label: 'Sell fish to Marlin' },
      nova: { pos: new THREE.Vector3(19.5, 0, 11), r: 4.5, label: 'Daily Shop' },
    },
    eggs: {
      duck: { pos: new THREE.Vector3(11, 0.5, 51), r: 9, name: 'the rubber duck' },
      cave: { box: { min: new THREE.Vector3(13, 0, CZ - 9), max: new THREE.Vector3(23, 7, CZ + 1) }, name: 'the secret cave' },
      tower: { pos: new THREE.Vector3(TX, TH + 1, TZ), r: 4, name: 'the top of the tower' },
      glitch: { pos: new THREE.Vector3(GX, 1, GZ), r: 2.8, name: 'the glitch' },
      sun: { pos: new THREE.Vector3(SX, 0, SZ + 4), r: 6, name: 'the sun statue' },
    },
    nullRoom: { spawn: new THREE.Vector3(NX, 1, NZ - 6), portal: new THREE.Vector3(NX, 1, NZ + 10) },
    npcs: { mixer, jester, finn, marlin, nova },
    lookFor(time, weather) { return look[weather !== 'clear' ? weather : time]; },
    update(dt, t, env) {
      for (const a of animated) a(dt, t, env);
      for (const n of [mixer, jester, finn, marlin, nova]) n.update(dt, t);
      // the Jester is only here when he's visiting
      jester.root.visible = env.jester; jesterGlow.material.opacity = env.jester ? 0.35 + Math.sin(t * 3) * 0.15 : 0;
      // sky and light
      const target = look[env.weather !== 'clear' ? env.weather : env.time];
      const base = look[env.time];
      const k = 1 - Math.exp(-dt * 1.5);
      cur.top.lerp(tmp.set(env.weather !== 'clear' && env.time === 'night' ? tmp.set(target.top).lerp(new THREE.Color(base.top), 0.6) : target.top), k);
      cur.bottom.lerp(tmp.set(target.bottom), k);
      cur.fog.lerp(tmp.set(env.weather !== 'clear' && env.time === 'night' ? new THREE.Color(target.fog).lerp(new THREE.Color(base.fog), 0.6) : target.fog), k);
      cur.sun += ((env.time === 'night' ? Math.min(target.sun, base.sun) : target.sun) - cur.sun) * k;
      cur.hemi += ((env.time === 'night' ? Math.min(target.hemi, base.hemi + 0.1) : target.hemi) - cur.hemi) * k;
      cur.stars += ((env.time === 'night' && env.weather !== 'rain' && env.weather !== 'null' ? 1 : 0) - cur.stars) * k;
      cur.near += ((target.fogNear || 120) - cur.near) * k; cur.far += ((target.fogFar || 420) - cur.far) * k;
      cur.sunColor.lerp(tmp.set(target.sunColor || (env.time === 'night' ? '#9fb4ff' : '#ffffff')), k);
      skyMat.uniforms.top.value.copy(cur.top); skyMat.uniforms.bottom.value.copy(cur.bottom);
      scene.fog.color.copy(cur.fog); scene.fog.near = cur.near; scene.fog.far = cur.far;
      hemi.intensity = cur.hemi; sunLight.intensity = cur.sun; sunLight.color.copy(cur.sunColor);
      stars.material.opacity = cur.stars;
      // the sun and moon cross the sky over each 10-minute day and night
      const a = env.progress * Math.PI, cam = env.camPos;
      const arc = (ang) => new THREE.Vector3(Math.cos(ang) * 300, Math.sin(ang) * 220 + 20, -160);
      const sp = arc(env.time === 'day' ? a : a), mp = arc(a);
      sunSprite.visible = env.time === 'day'; moonSprite.visible = env.time === 'night';
      sunSprite.position.copy(sp).add(cam); moonSprite.position.copy(mp).add(cam);
      sky.position.copy(cam); stars.position.copy(cam);
      sunSprite.material.opacity = env.weather === 'rain' || env.weather === 'null' ? 0.25 : 1;
      const lightDir = env.time === 'day' ? sp : mp;
      sunLight.position.copy(env.player).add(lightDir.clone().normalize().multiplyScalar(120));
      sunLight.target.position.copy(env.player);
      // lamps light up at night and in dark weather
      const dark = env.time === 'night' || env.weather === 'rain' || env.weather === 'null' || env.weather === 'hell';
      for (const l of lamps) { l.head.material.emissiveIntensity += ((dark ? 1.4 : 0.15) - l.head.material.emissiveIntensity) * k; l.glow.material.opacity += ((dark ? 0.75 : 0) - l.glow.material.opacity) * k; }
      weatherFx.update(dt, t, env.weather, env.camPos);
    },
  };

  // ---- small builders ----
  function npc(name, role, shirt, accent, jesterHat) {
    const a = buildAvatar(name, shirt);
    a.root.remove(a.tag);
    const label = signLabel(name, role, accent); label.position.y = 6.9; a.root.add(label);
    if (jesterHat) {
      const hatMat = [plainMat('#6a1b9a'), plainMat('#ffd600')];
      for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.5, 8), hatMat[s > 0 ? 1 : 0]); h.position.set(s * 0.45, 5.6, 0); h.rotation.z = -s * 0.7; a.body.add(h); const bell = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), plainMat('#ffd600', { emissive: '#ffd600', glow: 0.5 })); bell.position.set(s * 1.0, 5.95, 0); a.body.add(bell); }
    }
    let t0 = Math.random() * 6;
    return { root: a.root, update(dt, t) { a.animate(dt, 0, false); a.body.position.y = Math.sin(t * 2 + t0) * 0.05; a.head.rotation.y = Math.sin(t * 0.7 + t0) * 0.35; } };
  }
}

// ---------------- helpers ----------------
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function textCanvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function signBoard(title, sub, accent) {
  const g = new THREE.Group();
  const tex = textCanvas(512, 200, x => {
    x.fillStyle = '#2b2118'; x.fillRect(0, 0, 512, 200);
    x.strokeStyle = accent; x.lineWidth = 10; x.strokeRect(5, 5, 502, 190);
    x.textAlign = 'center'; x.fillStyle = '#ffffff'; x.font = '900 52px "Segoe UI", sans-serif'; x.fillText(title, 256, 92, 470);
    x.fillStyle = accent; x.font = '600 28px "Segoe UI", sans-serif'; x.fillText(sub, 256, 148, 470);
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(7, 2.8, 0.3), [plainMat('#4e342e'), plainMat('#4e342e'), plainMat('#4e342e'), plainMat('#4e342e'), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), plainMat('#4e342e')]);
  board.position.y = 3.6; g.add(board);
  for (const s of [-2.6, 2.6]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.4, 0.4), plainMat('#4e342e')); p.position.set(s, 1.2, 0); g.add(p); }
  return g;
}
function signLabel(name, role, accent) {
  const tex = textCanvas(768, 192, x => {
    x.textAlign = 'center'; x.lineJoin = 'round';
    x.font = '900 60px "Segoe UI", sans-serif'; x.lineWidth = 10; x.strokeStyle = 'rgba(0,0,0,.75)'; x.strokeText(name, 384, 80); x.fillStyle = accent; x.fillText(name, 384, 80);
    x.font = '700 38px "Segoe UI", sans-serif'; x.lineWidth = 7; x.strokeText(role, 384, 140); x.fillStyle = '#ffffff'; x.fillText(role, 384, 140);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(7.2, 1.8, 1); return s;
}
function stripeTex() {
  const t = textCanvas(256, 64, x => { for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#ffd600' : '#6a1b9a'; x.fillRect(i * 32, 0, 32, 64); } });
  t.wrapS = THREE.RepeatWrapping; t.repeat.set(2, 1); return t;
}
function waterTex() {
  const t = textCanvas(128, 128, x => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 128, 128);
    x.strokeStyle = 'rgba(160,210,255,.55)'; x.lineWidth = 3;
    for (let i = 0; i < 14; i++) { const y = Math.random() * 128, xx = Math.random() * 128; x.beginPath(); x.moveTo(xx, y); x.quadraticCurveTo(xx + 10, y - 4, xx + 22, y); x.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 4); return t;
}
function fallTex() {
  const t = textCanvas(64, 256, x => {
    const g = x.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, 'rgba(180,230,255,.4)'); g.addColorStop(0.5, 'rgba(240,250,255,.95)'); g.addColorStop(1, 'rgba(180,230,255,.4)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 256);
    x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 2;
    for (let i = 0; i < 26; i++) { const xx = Math.random() * 64, y = Math.random() * 256; x.beginPath(); x.moveTo(xx, y); x.lineTo(xx, y + 30 + Math.random() * 40); x.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 2); return t;
}
// Little rising bubbles (the cauldron) or mist (the waterfall).
function bubbleDots(color, n = 16, wide) {
  const pos = new Float32Array(n * 3), geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const obj = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: wide ? 1.4 : 0.45, map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: wide ? 0.5 : 0.9 }));
  const p = Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * (wide ? 6 : 2), y: Math.random() * 2, z: (Math.random() - 0.5) * (wide ? 3 : 2), v: 0.5 + Math.random() }));
  return { obj, update(dt) { p.forEach((q, i) => { q.y += q.v * dt; if (q.y > (wide ? 4 : 2.2)) q.y = 0; pos[i * 3] = q.x; pos[i * 3 + 1] = q.y; pos[i * 3 + 2] = q.z; }); geo.attributes.position.needsUpdate = true; } };
}

// Weather particles that follow the camera: rain streaks, snow, embers, heavenly motes, null cubes, solar glare.
function makeWeather(scene) {
  const N = 900, geo = new THREE.BufferGeometry(), pos = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 0.35, map: glowTex(), transparent: true, depthWrite: false, opacity: 0.9, color: '#ffffff' });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
  const rainGeo = new THREE.BufferGeometry(), rainPos = new Float32Array(N * 6);
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#b8d4ff', transparent: true, opacity: 0.55 })); rain.frustumCulled = false; scene.add(rain);
  const P = Array.from({ length: N }, () => ({ x: (Math.random() - 0.5) * 120, y: Math.random() * 60, z: (Math.random() - 0.5) * 120, s: Math.random() }));
  const cubes = new THREE.Group(); scene.add(cubes);
  for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: i % 3 ? '#000000' : '#ffffff' })); m.userData = { x: (Math.random() - 0.5) * 140, y: 4 + Math.random() * 30, z: (Math.random() - 0.5) * 140, s: 0.2 + Math.random() }; cubes.add(m); }
  let kind = null;
  return {
    update(dt, t, w, cam) {
      if (w !== kind) {
        kind = w;
        pts.visible = ['snow', 'hell', 'heaven', 'solar'].includes(w); rain.visible = w === 'rain'; cubes.visible = w === 'null';
        mat.color.set(w === 'hell' ? '#ff6a2b' : w === 'heaven' ? '#fff3b0' : w === 'solar' ? '#ffd27a' : '#ffffff');
        mat.size = w === 'snow' ? 0.5 : w === 'hell' ? 0.45 : w === 'heaven' ? 0.6 : 0.8;
        mat.blending = w === 'snow' ? THREE.NormalBlending : THREE.AdditiveBlending;
      }
      if (pts.visible) {
        P.forEach((p, i) => {
          if (w === 'snow') { p.y -= (2 + p.s * 2) * dt; p.x += Math.sin(t + i) * dt * 0.8; }
          else if (w === 'hell') { p.y += (2 + p.s * 3) * dt; p.x += Math.sin(t * 2 + i) * dt; }
          else { p.y += (0.3 + p.s) * dt * (w === 'solar' ? 0.4 : 1); }
          if (p.y < 0) p.y += 60; if (p.y > 60) p.y -= 60;
          pos[i * 3] = cam.x + p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = cam.z + p.z;
        });
        geo.attributes.position.needsUpdate = true;
      }
      if (rain.visible) {
        P.forEach((p, i) => {
          p.y -= (40 + p.s * 20) * dt; if (p.y < 0) p.y += 60;
          const x = cam.x + p.x, z = cam.z + p.z;
          rainPos.set([x, p.y, z, x + 0.15, p.y + 1.6, z], i * 6);
        });
        rainGeo.attributes.position.needsUpdate = true;
      }
      if (cubes.visible) cubes.children.forEach(m => { const u = m.userData; m.position.set(cam.x + u.x, u.y + Math.sin(t * u.s) * 2, cam.z + u.z); m.rotation.x += dt * u.s; m.rotation.y += dt * u.s * 1.3; });
    },
  };
}
