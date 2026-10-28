// Overcontrol RNG: the map. Everything is built from studded blocks like a Roblox place: a spawn plaza with the
// Overcontrol monument, a stats board and a quest board, Mari's shop, the Jester's tent, a pond with a dock, a waterfall
// cliff, a tall tower, the Sky Parkour, a graveyard, and in the west a giant mountain with a trail to a bell on top and,
// inside it, the cave where Stella brews her potions. Also the sky, day and night, and every biome.
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
  const key = `${color}|${Math.round(rx)}|${Math.round(ry)}|${opts.emissive || ''}`;
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
// A rectangle with holes cut out of it, as a few rectangles (for carving caves out of the mountain).
function rectMinus(r, holes) {
  const xs = new Set([r[0], r[1]]), zs = new Set([r[2], r[3]]);
  for (const h of holes) { [h[0], h[1]].forEach(x => { if (x > r[0] && x < r[1]) xs.add(x); }); [h[2], h[3]].forEach(z => { if (z > r[2] && z < r[3]) zs.add(z); }); }
  const X = [...xs].sort((a, b) => a - b), Z = [...zs].sort((a, b) => a - b), cells = [];
  for (let i = 0; i < X.length - 1; i++) {
    let run = null;
    for (let j = 0; j < Z.length - 1; j++) {
      const cx = (X[i] + X[i + 1]) / 2, cz = (Z[j] + Z[j + 1]) / 2;
      const inHole = holes.some(h => cx > h[0] && cx < h[1] && cz > h[2] && cz < h[3]);
      if (!inHole) { if (run) run[3] = Z[j + 1]; else run = [X[i], X[i + 1], Z[j], Z[j + 1]]; }
      else if (run) { cells.push(run); run = null; }
    }
    if (run) cells.push(run);
  }
  return cells;
}

// ---------------- baking ----------------
// Every block on the map used to be its own mesh with six faces, and a face per material is a draw call: about 1,700 draw
// calls a frame, twice over with shadows, which is what made the game lag. Blocks that never move are merged here into
// one mesh per material (same colour, studded or smooth), so the whole island draws in a few dozen calls. Studs keep
// their size: each face's texture coordinates are scaled to its size in studs, on one shared stud texture.
const bakedStudMats = new Map();
function bakedStudMat(m) {
  const key = m.color.getHexString() + '|' + m.emissive.getHexString() + '|' + m.emissiveIntensity;
  if (bakedStudMats.has(key)) return bakedStudMats.get(key);
  const tx = new THREE.CanvasTexture(studImage());
  tx.colorSpace = THREE.SRGBColorSpace; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ color: m.color, map: tx, roughness: m.roughness, metalness: m.metalness, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity });
  bakedStudMats.set(key, mat);
  return mat;
}
function bakeStatic(root) {
  const buckets = new Map(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), n = new THREE.Vector3();
  const kids = root.children.filter(o => o.isMesh && o.userData.bake && o.geometry.type === 'BoxGeometry' && (Array.isArray(o.material) ? o.material : [o.material]).every(m => !m.transparent));
  for (const m of kids) {
    m.updateMatrix(); nm.getNormalMatrix(m.matrix);
    const geo = m.geometry, mats = Array.isArray(m.material) ? m.material : [m.material];
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv, idx = geo.index;
    const { width: W = 1, height: H = 1, depth: D = 1 } = geo.parameters;
    const size = [[D, H], [D, H], [W, D], [W, D], [W, H], [W, H]];   // the box's faces: +x, -x, +y, -y, +z, -z
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: idx.count, materialIndex: 0 }];
    groups.forEach((gr, gi) => {
      const src = mats[gr.materialIndex] || mats[0];
      const studded = !!src.map, mat = studded ? bakedStudMat(src) : src;
      const key = mat.uuid + (m.castShadow ? '|c' : '') + (m.receiveShadow ? '|r' : '');
      let b = buckets.get(key); if (!b) buckets.set(key, (b = { mat, cast: m.castShadow, receive: m.receiveShadow, p: [], n: [], u: [] }));
      const [su, sv] = geo.groups.length ? size[gi] : [1, 1];
      for (let i = gr.start; i < gr.start + gr.count; i++) {
        const k = idx ? idx.getX(i) : i;
        v.fromBufferAttribute(pos, k).applyMatrix4(m.matrix); b.p.push(v.x, v.y, v.z);
        n.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize(); b.n.push(n.x, n.y, n.z);
        b.u.push(uv.getX(k) * (studded ? su : 1), uv.getY(k) * (studded ? sv : 1));
      }
    });
    root.remove(m); geo.dispose();
  }
  for (const b of buckets.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, b.mat); mesh.castShadow = b.cast; mesh.receiveShadow = b.receive; mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
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
    const top = o.smooth ? plainMat(o.topColor || color, o) : studMat(o.topColor || color, w, d, o);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, plainMat(color, o), side, side]);
    mesh.position.set(x, y + h / 2, z);
    if (o.ry) mesh.rotation.y = o.ry;
    mesh.castShadow = shadows && !o.noShadow; mesh.receiveShadow = shadows;
    mesh.userData.bake = !o.parent;   // blocks straight on the map never move: they get merged (see bakeStatic)
    (o.parent || root).add(mesh);
    if (!o.noCollide) colliders.push({ min: new THREE.Vector3(x - w / 2, y, z - d / 2), max: new THREE.Vector3(x + w / 2, y + h, z + d / 2), id: o.id });
    return mesh;
  }
  const boxR = (r, y, h, color, o) => box((r[0] + r[1]) / 2, y, (r[2] + r[3]) / 2, r[1] - r[0], h, r[3] - r[2], color, o);
  const glow = (color, scale, x, y, z, parent = root, opacity = 0.7) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity }));
    s.scale.set(scale, scale, 1); s.position.set(x, y, z); parent.add(s); return s;
  };

  // ---- the island: green on top, dirt cliffs down the sides, sand around it, and the ocean all the way out ----
  const B = { minX: -170, maxX: 100, minZ: -100, maxZ: 100 };
  const GW = B.maxX - B.minX, GD = B.maxZ - B.minZ, cx0 = (B.minX + B.maxX) / 2;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GW, GD), studMat('#5aa34f', GW, GD));
  ground.rotation.x = -Math.PI / 2; ground.position.set(cx0, 0, 0); ground.receiveShadow = shadows; root.add(ground);
  const cliff = new THREE.Mesh(new THREE.BoxGeometry(GW, 10, GD), [studMat('#7a5236', GD, 10), studMat('#7a5236', GD, 10), plainMat('#5aa34f'), plainMat('#5a3a24'), studMat('#7a5236', GW, 10), studMat('#7a5236', GW, 10)]);
  cliff.position.set(cx0, -5.02, 0); root.add(cliff);
  const SAND = 7, sandY = -0.5;
  const sand = (x0, x1, z0, z1) => box((x0 + x1) / 2, -4, (z0 + z1) / 2, x1 - x0, 4 + sandY, z1 - z0, '#e8d29a', { topColor: '#efdca6', noShadow: true });
  sand(B.minX - SAND, B.maxX + SAND, B.maxZ, B.maxZ + SAND); sand(B.minX - SAND, B.maxX + SAND, B.minZ - SAND, B.minZ);
  sand(B.minX - SAND, B.minX, B.minZ, B.maxZ); sand(B.maxX, B.maxX + SAND, B.minZ, -24); sand(B.maxX, B.maxX + SAND, -16, B.maxZ);
  sand(B.maxX, B.maxX + 3, -24, -16);
  // a ragged coastline: chunks of grass and dirt sticking out into the sand
  const coast = mulberry(7);
  for (let i = 0; i < 26; i++) {
    const side = i % 4, len = 8 + coast() * 18, dep = 2 + coast() * 4;
    if (side === 0) box(B.minX + 10 + coast() * (GW - 30), -8, B.maxZ + dep / 2, len, 8, dep, '#7a5236', { topColor: '#5aa34f', studsAllOver: true });
    if (side === 1) box(B.minX + 10 + coast() * (GW - 30), -8, B.minZ - dep / 2, len, 8, dep, '#7a5236', { topColor: '#5aa34f', studsAllOver: true });
    if (side === 2) box(B.minX - dep / 2, -8, B.minZ + 10 + coast() * (GD - 30), dep, 8, len, '#7a5236', { topColor: '#5aa34f', studsAllOver: true });
    if (side === 3) { const z = B.minZ + 10 + coast() * (GD - 30); if (Math.abs(z + 20) > 14) box(B.maxX + dep / 2, -8, z, dep, 8, len, '#7a5236', { topColor: '#5aa34f', studsAllOver: true }); }
  }
  // the ocean
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: '#1e6bff', map: waterTex(), roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.94 }));
  ocean.material.map.repeat.set(160, 160);
  ocean.rotation.x = -Math.PI / 2; ocean.position.set(cx0, -1.4, 0); root.add(ocean);
  animated.push(dt => { ocean.material.map.offset.x += dt * 0.01; ocean.material.map.offset.y += dt * 0.006; });
  // invisible walls at the water's edge, with a gap in the east where stepping stones lead out to a tiny island
  const edge = (x0, x1, z0, z1) => colliders.push({ min: new THREE.Vector3(x0, -6, z0), max: new THREE.Vector3(x1, 90, z1), cam: false });
  const E = SAND + 1;
  edge(B.minX - E, B.maxX + E, B.maxZ + SAND, B.maxZ + E); edge(B.minX - E, B.maxX + E, B.minZ - E, B.minZ - SAND);
  edge(B.minX - E, B.minX - SAND, B.minZ - E, B.maxZ + E); edge(B.maxX + SAND, B.maxX + E, B.minZ - E, -24); edge(B.maxX + SAND, B.maxX + E, -16, B.maxZ + E);

  // ---- paths from the plaza to each place ----
  const path = (x, z, w, d) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), studMat('#a1a1a1', w, d)); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.03, z); m.receiveShadow = shadows; root.add(m); };
  path(0, 30, 6, 30); path(-28, -6, 30, 6); path(29, -6, 28, 6); path(0, -40, 6, 50); path(-40, 18, 6, 40); path(-70, -6, 50, 6);

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
  const sign = signBoard('OVERCONTROL\'S RNG', 'Roll · Fish · Climb the mountain', '#9c6bff');
  sign.position.set(11, 0, 17.5); root.add(sign);
  // the stats board and the quest board, at the north edge of the plaza, facing spawn
  const board = statsBoard(); board.group.position.set(-11, 0, -18.5); root.add(board.group);
  colliders.push({ min: new THREE.Vector3(-17.5, 0, -19), max: new THREE.Vector3(-4.5, 9, -18) });
  const qboard = signBoard('QUEST BOARD', 'Daily quests: press E', '#ffd54f'); qboard.position.set(11, 0, -18.5); root.add(qboard);

  // ---- Mari's shop (north-west of the plaza) ----
  const MX = -42, MZ = -8;
  box(MX, 0, MZ, 16, 1, 14, '#8d6e63');
  box(MX, 1, MZ - 6.5, 16, 8, 1, '#efebe9');
  box(MX - 7.5, 1, MZ, 1, 8, 14, '#efebe9');
  box(MX + 7.5, 1, MZ - 3, 1, 8, 8, '#efebe9');
  box(MX, 9, MZ, 18, 1, 16, '#6a1b9a', { noShadow: true });
  box(MX, 10, MZ, 14, 1, 12, '#7b1fa2', { noShadow: true });
  box(MX, 11, MZ, 9, 1, 8, '#8e24aa', { noShadow: true });
  box(MX + 1, 1, MZ + 1, 10, 3, 2, '#5d4037');                         // counter
  // shelves of potions
  const shelfColors = ['#3ddc84', '#4fc3ff', '#ffd54a', '#ff80ab', '#7c4dff', '#ff7043', '#26c6da', '#ffee58'];
  shelfColors.forEach((col, i) => { const b = potionModel(col, 0.8); b.position.set(MX - 6 + i * 1.7, 5.75, MZ - 5.6); root.add(b); });
  box(MX, 5.5, MZ - 5.6, 15, 0.3, 1, '#4e342e', { noCollide: true });
  shelfColors.slice().reverse().forEach((col, i) => { const b = potionModel(col, 0.7); b.position.set(MX - 6 + i * 1.7, 3.15, MZ - 5.6); root.add(b); });
  box(MX, 2.9, MZ - 5.6, 15, 0.3, 1, '#4e342e', { noCollide: true });
  const mari = npc('Mari', 'Potions and gear', '#c2185b', '#f8bbd0'); mari.root.position.set(MX + 1, 1, MZ - 1.6); root.add(mari.root);
  const shopSign = signBoard('MARI\'S SHOP', 'Potions and gear', '#f06292'); shopSign.position.set(MX, 12.2, MZ + 7.2); shopSign.rotation.y = Math.PI; root.add(shopSign);

  // ---- the Jester's tent (east) ----
  const JX = 42, JZ = -10;
  const tent = new THREE.Group(); tent.position.set(JX, 0, JZ); root.add(tent);
  const stripes = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 9, 11, 16, 1, true), new THREE.MeshStandardMaterial({ map: stripeTex('#6a1b9a', '#ffd600'), side: THREE.DoubleSide, roughness: 0.8 }));
  stripes.position.y = 5.5; stripes.castShadow = shadows; tent.add(stripes);
  const flag = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.6, 4), plainMat('#ffd600', { emissive: '#ffd600', glow: 0.3 })); flag.position.y = 11.6; tent.add(flag);
  colliders.push({ min: new THREE.Vector3(JX - 6.4, 0, JZ - 6.4), max: new THREE.Vector3(JX + 6.4, 9, JZ + 6.4) });
  box(JX, 0, JZ + 11.5, 10, 0.4, 5, '#4a148c', { smooth: true, noCollide: true });
  const jester = npc('Jester', 'Strange goods', '#6a1b9a', '#ffd600', 'jester'); jester.root.position.set(JX, 0.4, JZ + 11); root.add(jester.root);
  const jesterSign = signBoard('THE JESTER', 'Visits every 4 hours', '#ffd600'); jesterSign.position.set(JX + 9, 0, JZ + 12); jesterSign.rotation.y = Math.PI * 1.15; root.add(jesterSign);
  const jesterGlow = glow('#b388ff', 10, JX, 3, JZ + 11, root, 0);

  // ---- the pond, the dock and Old Finn (south) ----
  const PX = 0, PZ = 50, PW = 44, PD = 26;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(PW, PD, 1, 1), new THREE.MeshStandardMaterial({ color: '#1f7ae0', map: waterTex(), transparent: true, opacity: 0.86, roughness: 0.15, metalness: 0.1 }));
  water.rotation.x = -Math.PI / 2; water.position.set(PX, 0.12, PZ); root.add(water);
  animated.push((dt) => { water.material.map.offset.x += dt * 0.02; water.material.map.offset.y += dt * 0.012; });
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
  for (const [x, z] of [[-12, 44], [-8, 58], [14, 54], [18, 42], [-17, 52]]) { const l = new THREE.Mesh(new THREE.CircleGeometry(1.1, 12), plainMat('#2e7d32')); l.rotation.x = -Math.PI / 2; l.position.set(x, 0.16, z); root.add(l); }
  // Secret: a rubber duck floating out on the pond
  const duck = new THREE.Group(); duck.position.set(11, 0.2, 51); root.add(duck);
  const yellow = plainMat('#ffeb3b');
  const dB = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.9), yellow); dB.position.y = 0.4; duck.add(dB);
  const dH = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), yellow); dH.position.set(0.45, 1, 0); duck.add(dH);
  const dK = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.3), plainMat('#ff9800')); dK.position.set(0.85, 0.95, 0); duck.add(dK);
  animated.push((dt, t) => { duck.position.y = 0.2 + Math.sin(t * 1.6) * 0.06; duck.rotation.y = Math.sin(t * 0.3) * 0.6; });

  // ---- the waterfall cliff (north), with the Dev Room hidden behind the water ----
  const CZ = -78;
  box(-18.5, 0, CZ, 63, 32, 10, '#78716c', { studsAllOver: true });
  box(36.5, 0, CZ, 27, 32, 10, '#78716c', { studsAllOver: true });
  box(18, 7, CZ, 10, 25, 10, '#78716c', { studsAllOver: true });                                        // above the cave mouth
  box(18, 0, CZ - 9, 12, 32, 8, '#6d6560', { studsAllOver: true });                                      // the back of the cave
  for (let i = 0; i < 6; i++) box(-30 + i * 11, 32, CZ + (i % 2) * 2, 9, 2 + (i % 3), 8, '#43a047');
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(6, 30), new THREE.MeshBasicMaterial({ map: fallTex(), transparent: true, opacity: 0.85, depthWrite: false }));
  fall.position.set(18, 15.5, CZ + 5.4); root.add(fall);
  animated.push((dt) => { fall.material.map.offset.y += dt * 0.9; });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshStandardMaterial({ color: '#29b6f6', transparent: true, opacity: 0.8, roughness: 0.1 }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(18, 0.1, CZ + 8); root.add(pool);
  const mist = bubbleDots('#e1f5fe', 30, true); mist.obj.position.set(18, 0.5, CZ + 6.5); root.add(mist.obj); animated.push(dt => mist.update(dt));
  const devSign = signBoard('DEV ROOM', 'You found the secret cave!', '#5865f2'); devSign.position.set(18, 0.5, CZ - 4.6); root.add(devSign);
  const env = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 0.3), new THREE.MeshStandardMaterial({ color: '#5865f2', emissive: '#5865f2', emissiveIntensity: 0.8 }));
  env.position.set(14.5, 5.2, CZ - 3); root.add(env); glow('#7c88ff', 8, 14.5, 5.2, CZ - 3);
  animated.push((dt, t) => { env.rotation.y = t; env.position.y = 5.2 + Math.sin(t * 2) * 0.3; });
  // the dev's computer: press E for a terminal
  box(21, 0, CZ - 6, 3, 1.6, 1.4, '#4e342e');
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 0.15), [plainMat('#212121'), plainMat('#212121'), plainMat('#212121'), plainMat('#212121'), new THREE.MeshBasicMaterial({ map: terminalTex() }), plainMat('#212121')]);
  monitor.position.set(21, 2.4, CZ - 6.2); root.add(monitor); glow('#00ff9c', 4, 21, 2.4, CZ - 5.9, root, 0.35);

  // ---- the tower (west), climb its stairs to the top ----
  const TX = -70, TZ = 40, TH = 36;
  box(TX, 0, TZ, 6, TH, 6, '#5d6d7e', { studsAllOver: true });
  for (let i = 0; i < 48; i++) {
    const a = (i / 12) * Math.PI * 2, r = 5.2;
    box(TX + Math.cos(a) * r, (i + 1) * (TH / 48) - 0.6, TZ + Math.sin(a) * r, 3, 0.6, 3, i % 2 ? '#8d6e63' : '#a1887f');
  }
  box(TX, TH, TZ, 7, 1, 7, '#455a64');
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
  const NX = 0, NZ = 900;
  box(NX, 0, NZ, 30, 1, 30, '#212121');
  for (const [x, z, w, d] of [[NX, NZ - 15, 30, 1], [NX, NZ + 15, 30, 1], [NX - 15, NZ, 1, 30], [NX + 15, NZ, 1, 30]]) box(x, 1, z, w, 12, d, '#111111');
  const nullSign = signBoard('NULL', 'Nothing is real here. Step into the light to go home.', '#9e9e9e'); nullSign.position.set(NX, 1, NZ - 14); root.add(nullSign);
  const portal = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.25, 12, 48), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  portal.position.set(NX, 3.5, NZ + 10); root.add(portal); glow('#ffffff', 10, NX, 3.5, NZ + 10);
  animated.push((dt, t) => { portal.rotation.z = t; });

  // ---- more water to fish in ----
  const waterPatch = (x, z, w, d, color, rimColor) => {
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color, map: waterTex(), transparent: true, opacity: 0.86, roughness: 0.15, metalness: 0.1 }));
    wm.rotation.x = -Math.PI / 2; wm.position.set(x, 0.12, z); root.add(wm);
    animated.push(dt => { wm.material.map.offset.x += dt * 0.025; });
    if (rimColor) { box(x, 0, z - d / 2 - 0.5, w + 2, 0.8, 1, rimColor); box(x, 0, z + d / 2 + 0.5, w + 2, 0.8, 1, rimColor); box(x - w / 2 - 0.5, 0, z, 1, 0.8, d, rimColor); box(x + w / 2 + 0.5, 0, z, 1, 0.8, d, rimColor); }
    colliders.push({ min: new THREE.Vector3(x - w / 2, 0, z - d / 2), max: new THREE.Vector3(x + w / 2, 14, z + d / 2), water: true });
    return wm;
  };
  const LX = 66, LZ = -36;
  box(LX, 0, LZ, 30, 0.3, 26, '#e8d29a', { noCollide: true });
  waterPatch(LX + 3, LZ - 3, 18, 12, '#22a7c9');
  box(LX - 7.5, 0.3, LZ - 3, 4, 0.5, 3, '#a1887f');
  for (const [x, z] of [[LX - 12, LZ + 9], [LX + 12, LZ + 10], [LX - 13, LZ - 10]]) { box(x, 0, z, 1.2, 9, 1.2, '#8d6e63'); box(x, 9, z, 6, 0.8, 1.6, '#2e7d32', { noCollide: true }); box(x, 9, z, 1.6, 0.8, 6, '#388e3c', { noCollide: true }); }
  waterPatch(-86, 40, 6, 56, '#2a8fd6', '#78909c');
  const vp = waterPatch(NX - 8, NZ + 2, 8, 6, '#1a0033');
  vp.material.opacity = 0.95; glow('#7c4dff', 10, NX - 8, 0.6, NZ + 2, root, 0.5);
  const spotRing = (x, y, z, color = '#4fd8ff') => {
    const m = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.55, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.06, z); root.add(m);
    animated.push((dt, t) => { m.material.opacity = 0.45 + Math.sin(t * 2.5) * 0.25; m.scale.setScalar(1 + Math.sin(t * 2.5) * 0.06); });
    return m;
  };
  const SPOTS = {
    dock: new THREE.Vector3(PX, 1.1, PZ + 1),
    falls: new THREE.Vector3(18, 0, CZ + 13),
    lagoon: new THREE.Vector3(LX - 7.5, 0.8, LZ - 3),
    creek: new THREE.Vector3(-81.5, 0, 40),
    void: new THREE.Vector3(NX - 8, 1, NZ + 6.5),
  };
  for (const p of Object.values(SPOTS)) spotRing(p.x, p.y, p.z);
  // market stalls
  const stall = (x, z, roofA, roofB, ry = 0) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; root.add(g);
    const part = (px, py, pz, w, h, d, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), plainMat(c)); m.position.set(px, py + h / 2, pz); m.castShadow = shadows; m.receiveShadow = shadows; g.add(m); };
    part(0, 0, 1.2, 6, 1.6, 1.2, '#795548');
    for (const sx of [-2.8, 2.8]) part(sx, 0, 1.6, 0.35, 4.6, 0.35, '#5d4037');
    for (let i = 0; i < 6; i++) part(-2.5 + i, 4.6, 1.2, 1, 0.35, 3, i % 2 ? roofA : roofB);
    const s = Math.sin(ry), c = Math.cos(ry);
    const cx = x + 1.2 * s, cz = z + 1.2 * c, hx = 3 * Math.abs(c) + 0.6 * Math.abs(s), hz = 3 * Math.abs(s) + 0.6 * Math.abs(c);
    colliders.push({ min: new THREE.Vector3(cx - hx, 0, cz - hz), max: new THREE.Vector3(cx + hx, 1.6, cz + hz) });
    return g;
  };
  stall(10, 32, '#1e88e5', '#ffffff', -Math.PI / 2);
  const marlin = npc('Marlin', 'Buys your fish', '#00897b', '#80deea'); marlin.root.position.set(11.4, 0, 32); marlin.root.rotation.y = -Math.PI / 2; root.add(marlin.root);
  stall(23, 11, '#8e24aa', '#ffd54f', -Math.PI / 2);
  const nova = npc('Nova', 'Daily Shop', '#6a1b9a', '#ffd54f'); nova.root.position.set(24.4, 0, 11); nova.root.rotation.y = -Math.PI / 2; root.add(nova.root);

  // ---- a sun statue, a thank-you to Sol's RNG (south-east) ----
  const SX = 62, SZ = 46;
  box(SX, 0, SZ, 6, 3, 6, '#bdbdbd'); box(SX, 3, SZ, 4, 1, 4, '#9e9e9e');
  const sun = new THREE.Mesh(new THREE.IcosahedronGeometry(2, 0), new THREE.MeshStandardMaterial({ color: '#ffca28', emissive: '#ffa000', emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 }));
  sun.position.set(SX, 7, SZ); root.add(sun); glow('#ffd54f', 9, SX, 7, SZ);
  animated.push((dt) => { sun.rotation.y += dt * 0.4; sun.rotation.x += dt * 0.2; });
  const plaque = signBoard('THANK YOU, SOL', 'Inspired by Sol\'s RNG on Roblox', '#ffca28'); plaque.position.set(SX, 0, SZ + 3.4); plaque.rotation.y = Math.PI; root.add(plaque);

  // ---- the Sky Parkour: floating islands next to the plaza. Reach the top for +30% luck for a minute. ----
  const OB = { x: -27, z: 26, r: 8.5 };
  const obbyColors = ['#ef5350', '#ffa726', '#ffee58', '#66bb6a', '#29b6f6', '#7e57c2'];
  let lastTop = 0;
  for (let k = 0; k < 13; k++) {
    const a = k * 0.62, x = OB.x + Math.cos(a) * OB.r, z = OB.z + Math.sin(a) * OB.r, top = 1.6 + k * 2.4;
    box(x, top - 0.8, z, 3, 0.8, 3, obbyColors[k % obbyColors.length]);
    lastTop = top;
  }
  const fa = 13 * 0.62, FX = OB.x + Math.cos(fa) * (OB.r + 1), FZ = OB.z + Math.sin(fa) * (OB.r + 1), FY = lastTop + 2.4;
  box(FX, FY - 1, FZ, 7, 1, 7, '#ffffff');
  const pad = spotRing(FX, FY, FZ, '#ffd54f'); pad.scale.setScalar(1.6);
  glow('#ffd54f', 8, FX, FY + 1.5, FZ, root, 0.45);
  const obbySign = signBoard('SKY PARKOUR', 'Reach the top: +30% luck', '#29b6f6'); obbySign.position.set(OB.x + 2, 0, OB.z + 11.5); obbySign.rotation.y = Math.PI; root.add(obbySign);

  // ---- the graveyard (south-west). Someone wanders here at night. ----
  const GYX = -46, GYZ = 74;
  box(GYX, 0, GYZ, 22, 0.25, 16, '#4e5b43', { noCollide: true, smooth: true });
  for (const [x, z, w, d] of [[GYX, GYZ - 8, 22, 0.4], [GYX, GYZ + 8, 22, 0.4], [GYX - 11, GYZ, 0.4, 16], [GYX + 11, GYZ + 4.5, 0.4, 7]]) box(x, 0, z, w, 1.6, d, '#3e2723', { smooth: true });
  for (let i = 0; i < 6; i++) { const x = GYX - 7 + (i % 3) * 6, z = GYZ - 3 + Math.floor(i / 3) * 6; box(x, 0, z, 1.6, 2 + (i % 2) * 0.6, 0.5, '#9e9e9e', { smooth: true }); box(x, 0, z + 1.6, 1.4, 0.2, 2.4, '#5d4037', { noCollide: true }); }
  box(GYX + 8, 0, GYZ - 4, 0.9, 7, 0.9, '#3e2723');
  for (const [dx, dy, ry] of [[1.2, 5, 0.6], [-1.1, 6, -0.7]]) { const br = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 0.4), plainMat('#3e2723')); br.position.set(GYX + 8 + dx, dy, GYZ - 4); br.rotation.z = ry; root.add(br); }
  const ghost = npc('The Ghost', 'Lost something', '#cfe8ff', '#bfe3ff', 'ghost'); ghost.root.position.set(GYX - 2, 0, GYZ + 2); ghost.root.rotation.y = Math.PI / 2; root.add(ghost.root);
  const ghostGlow = glow('#bfe3ff', 8, GYX - 2, 3, GYZ + 2, root, 0);

  // ---- THE MOUNTAIN (far west): 16 terraces of studs, a switchback trail up the south face, a bell on top ----
  const MT = { x0: -165, x1: -99, z0: -95, z1: -7, n: 16, h: 3.6 };
  const lay = i => [MT.x0 + 1.5 * i, MT.x1 - 1.5 * i, MT.z0 + 1.5 * i, MT.z1 - 3.5 * i];
  // inside: a cave. Layer 0 has a chasm; layers 1-3 hold the cavern; a corridor runs in from the east face;
  // a hidden crystal room sits behind a wall you can walk through.
  const PIT = [-140, -122, -74, -38], CAVERN = [-150, -120, -74, -38], CORRIDOR = [-120, -97, -58, -52], CRYSTAL = [-138, -128, -84, -74];
  // like Sol's mountain: brown dirt with grass on the lower terraces, grey rock higher up, snow on top
  const mtColor = i => (i >= 12 ? ['#d6dee8', '#f4f8ff'] : i >= 8 ? ['#7d7f84', '#8f959c'] : ['#7a5236', '#5aa34f']);
  for (let i = 0; i < MT.n; i++) {
    const r = lay(i), y = i * MT.h, [side, top] = mtColor(i);
    const holes = i === 0 ? [PIT] : i <= 2 ? [CAVERN, CORRIDOR, CRYSTAL] : i === 3 ? [CAVERN] : [];
    for (const piece of holes.length ? rectMinus(r, holes) : [r]) boxR(piece, y, MT.h, side, { studsAllOver: true, topColor: top });
  }
  // boulders and outcrops on the north, west and east faces (never on the trail side), so it isn't a neat pyramid
  const rock = mulberry(99);
  for (let i = 0; i < MT.n - 2; i++) {
    const r = lay(i), y = i * MT.h, [side, top] = mtColor(i);
    for (let k = 0; k < 3; k++) {
      const face = Math.floor(rock() * 3), w = 3 + rock() * 6, h = 2 + rock() * 4, d = 2 + rock() * 3;
      if (face === 0) { const x = r[0] + 6 + rock() * (r[1] - r[0] - 12); if (i > 1 || Math.abs(x + 132) > 7) box(x, y, r[2] - d / 2 + 1.2, w, h, d, side, { studsAllOver: true, topColor: top }); }
      if (face === 1) box(r[0] - d / 2 + 1.2, y, r[2] + 6 + rock() * (r[3] - r[2] - 22), d, h, w, side, { studsAllOver: true, topColor: top });
      if (face === 2 && !(y < 11 && rock() < 2)) { const z = r[2] + 6 + rock() * (r[3] - r[2] - 22); if (Math.abs(z + 55) > 9) box(r[1] + d / 2 - 1.2, y, z, d, h, w, side, { studsAllOver: true, topColor: top }); }
    }
  }
  // stone floors inside the cave, and two old ladders on the north face
  for (const f of [[-150, -140, -74, -38], [-122, -97, -58, -52], [-138, -128, -84, -74], [-122, -120, -74, -38]]) box((f[0] + f[1]) / 2, 3.6, (f[2] + f[3]) / 2, f[1] - f[0], 0.04, f[3] - f[2], '#6d6560', { noCollide: true, topColor: '#7e7873' });
  for (const lx of [-150, -118]) { for (const s of [-0.6, 0.6]) box(lx + s, 0, -95.4, 0.2, 14, 0.2, '#6d4c41', { noCollide: true, smooth: true }); for (let k = 1; k < 14; k += 1.2) box(lx, k, -95.4, 1.3, 0.15, 0.2, '#8d6e63', { noCollide: true, smooth: true }); }
  // the trail: three steps on each terrace's south ledge, alternating ends, starting on the ground at the east end
  for (let i = -1; i < MT.n - 1; i++) {
    const r = i < 0 ? [MT.x0, MT.x1, 0, MT.z1] : lay(i), y = i < 0 ? 0 : (i + 1) * MT.h;
    const zA = MT.z1 - 3.5 * (i + 1), zB = i < 0 ? MT.z1 + 3.5 : MT.z1 - 3.5 * i;   // the ledge in front of the next terrace
    const west = i >= 0 && i % 2 === 0;
    const L = r[0] + 0.6, R = r[1] - 0.6;
    for (let k = 1; k <= 3; k++) {
      const x = west ? L + 7.2 - 1.2 - (k - 1) * 2.4 : R - 7.2 + 1.2 + (k - 1) * 2.4;
      box(x, y, (zA + zB) / 2, 2.4, 1.2 * k, zB - zA, '#a1887f', { topColor: '#bcaaa4' });
    }
  }
  // the cave's chasm is dark and deep; falling in sends you back to the corridor
  const abyss = new THREE.Mesh(new THREE.PlaneGeometry(PIT[1] - PIT[0], PIT[3] - PIT[2]), new THREE.MeshBasicMaterial({ color: '#07020f' }));
  abyss.rotation.x = -Math.PI / 2; abyss.position.set((PIT[0] + PIT[1]) / 2, 0.08, (PIT[2] + PIT[3]) / 2); root.add(abyss);
  glow('#4a148c', 26, (PIT[0] + PIT[1]) / 2, 0.5, (PIT[2] + PIT[3]) / 2, root, 0.35);
  // floating stones across the chasm, and a branch to the crystal room
  for (const [x, top, z] of [[-125, 4.6, -55], [-129.5, 5.8, -51.5], [-133.5, 6.6, -57], [-137.6, 5.4, -54], [-133, 6, -63], [-133, 5.2, -69.5]]) box(x, top - 0.6, z, 2.6, 0.6, 2.6, '#6d6560', { topColor: '#8e8a86' });
  // steps up to the cave mouth on the east face
  for (let k = 1; k <= 3; k++) box(-99 + 2.4 * (3 - k) + 1.2 + 0.0, 0, -55, 2.4, 1.2 * k, 6, '#8d8d8d');
  // candles along the corridor
  const candle = (x, y, z) => { box(x, y, z, 0.3, 0.6, 0.3, '#fff3e0', { noCollide: true, smooth: true }); const f = glow('#ffb74d', 1.6, x, y + 0.85, z, root, 0.9); animated.push((dt, t) => { f.material.opacity = 0.7 + Math.sin(t * 13 + x) * 0.2; }); };
  for (let x = -100; x > -120; x -= 4) { candle(x, 3.6, -57.4); candle(x - 2, 3.6, -52.6); }
  // glowing crystals on the cavern walls
  const crystal = (x, y, z, c, s = 1) => { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.9 * s, 0), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, roughness: 0.2 })); m.position.set(x, y, z); m.scale.y = 1.8; m.rotation.z = (x % 3) * 0.3; root.add(m); glow(c, 4 * s, x, y, z, root, 0.4); return m; };
  [[-149, 8, -45, '#7c4dff'], [-149, 6, -70, '#00e5ff'], [-121, 9, -72, '#7c4dff'], [-121, 8, -40, '#00e5ff'], [-131, 13.5, -56, '#b388ff']].forEach(([x, y, z, c]) => crystal(x, y, z, c));
  // Stella's camp, on the far side of the chasm
  const ST = { x: -145.5, y: 3.6, z: -56 };
  const stella = npc('Stella', 'Potion brewer', '#283593', '#b39ddb', 'witch'); stella.root.position.set(ST.x, ST.y, ST.z); stella.root.rotation.y = Math.PI / 2; root.add(stella.root);
  const scaul = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.25, 2.1, 20), plainMat('#263238', { metal: 0.5, rough: 0.4 }));
  scaul.position.set(-146, ST.y + 1.05, -49.5); scaul.castShadow = shadows; root.add(scaul);
  colliders.push({ min: new THREE.Vector3(-147.7, ST.y, -51.2), max: new THREE.Vector3(-144.3, ST.y + 2.1, -47.8) });
  const sbrew = new THREE.Mesh(new THREE.CircleGeometry(1.5, 20), new THREE.MeshBasicMaterial({ color: '#b388ff' }));
  sbrew.rotation.x = -Math.PI / 2; sbrew.position.set(-146, ST.y + 2.02, -49.5); root.add(sbrew);
  const sglow = glow('#b388ff', 7, -146, ST.y + 2.8, -49.5);
  const sbub = bubbleDots('#e1bee7'); sbub.obj.position.set(-146, ST.y + 2.1, -49.5); root.add(sbub.obj);
  animated.push((dt, t) => { sbub.update(dt); sglow.material.opacity = 0.5 + Math.sin(t * 2.6) * 0.2; });
  const stTent = new THREE.Mesh(new THREE.ConeGeometry(4, 5, 4, 1, true), new THREE.MeshStandardMaterial({ color: '#5e35b1', side: THREE.DoubleSide, roughness: 0.9 }));
  stTent.position.set(-146.5, ST.y + 2.5, -67); stTent.rotation.y = Math.PI / 4; root.add(stTent);
  colliders.push({ min: new THREE.Vector3(-149.3, ST.y, -69.8), max: new THREE.Vector3(-143.7, ST.y + 4, -64.2) });
  for (const [dx, dz, ry] of [[0, 0, 0.4], [0, 0, -0.8]]) { const log = new THREE.Mesh(new THREE.BoxGeometry(2, 0.35, 0.35), plainMat('#4e342e')); log.position.set(-142.5 + dx, ST.y + 0.2, -62.5 + dz); log.rotation.y = ry; root.add(log); }
  const fire = glow('#ff8f00', 3.4, -142.5, ST.y + 0.9, -62.5, root, 0.95), fire2 = glow('#ffd54f', 1.8, -142.5, ST.y + 1.2, -62.5, root, 0.9);
  animated.push((dt, t) => { fire.scale.setScalar(3.2 + Math.sin(t * 17) * 0.4); fire2.material.opacity = 0.7 + Math.sin(t * 23) * 0.25; });
  box(-149.2, ST.y, -58, 0.8, 3.2, 5, '#4e342e');   // a shelf of finished brews
  ['#ffd54a', '#80d8ff', '#ff6ec7', '#7cb342', '#ffee58', '#29b6f6'].forEach((col, i) => { const b = potionModel(col, 0.6); b.position.set(-149, ST.y + 3.2 + 0.05, -60 + i * 0.8); root.add(b); });
  for (let z = -46; z > -70; z -= 6) candle(-141, ST.y, z);
  // portals, once Stella's quest is done: one by the cave mouth outside, one back from her camp
  const portalRing = (x, y, z, c) => {
    const g = new THREE.Group(); g.position.set(x, y + 3, z); root.add(g);
    const t = new THREE.Mesh(new THREE.TorusGeometry(2, 0.22, 12, 48), new THREE.MeshBasicMaterial({ color: c })); g.add(t);
    const f = new THREE.Mesh(new THREE.CircleGeometry(1.8, 40), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); g.add(f);
    glow(c, 7, 0, 0, 0, g, 0.6);
    animated.push((dt, tt) => { t.rotation.z = tt * 1.5; f.material.opacity = 0.3 + Math.sin(tt * 3) * 0.1; });
    g.visible = false; return g;
  };
  const portalOut = portalRing(-93, 0, -64, '#b388ff'), portalBack = portalRing(-142.5, ST.y, -44, '#b388ff');
  portalOut.rotation.y = Math.PI / 2; portalBack.rotation.y = Math.PI / 2;
  // the crystal room's false wall, and its treasure
  box((CRYSTAL[0] + CRYSTAL[1]) / 2, 3.6, -74, CRYSTAL[1] - CRYSTAL[0], 7.2, 0.8, '#78716c', { studsAllOver: true, noCollide: true });
  [[-137, 5, -82, '#ff4081'], [-129, 6, -83, '#00e5ff'], [-136, 8, -78, '#ffd740'], [-129.5, 4.6, -77, '#7c4dff']].forEach(([x, y, z, c]) => crystal(x, y, z, c, 0.8));
  const chest = new THREE.Group(); chest.position.set(-133, 3.6, -81.5); root.add(chest);
  const cBase = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 1.4), plainMat('#6d4c41')); cBase.position.y = 0.6; chest.add(cBase);
  const cLid = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 1.4), plainMat('#8d6e63')); cLid.position.y = 1.45; chest.add(cLid);
  const cBand = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.8, 1.45), plainMat('#ffd54f', { metal: 0.6 })); cBand.position.y = 0.9; chest.add(cBand);
  const chestGlow = glow('#ffd54f', 5, -133, 5.2, -81.5, root, 0.5);
  colliders.push({ min: new THREE.Vector3(-134.1, 3.6, -82.2), max: new THREE.Vector3(-131.9, 5.3, -80.8) });
  // the summit: a bell and a flag
  const top = lay(MT.n - 1), SUM = { x: (top[0] + top[1]) / 2, y: MT.n * MT.h, z: (top[2] + top[3]) / 2 };
  box(SUM.x - 2.2, SUM.y, SUM.z, 0.5, 5, 0.5, '#5d4037'); box(SUM.x + 2.2, SUM.y, SUM.z, 0.5, 5, 0.5, '#5d4037'); box(SUM.x, SUM.y + 5, SUM.z, 5, 0.5, 0.6, '#5d4037', { noCollide: true });
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 1.6, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#ffca28', metalness: 0.8, roughness: 0.25, side: THREE.DoubleSide, emissive: '#7a5200', emissiveIntensity: 0.4 }));
  bell.position.set(SUM.x, SUM.y + 4, SUM.z); root.add(bell);
  const bellGlow = glow('#ffe082', 6, SUM.x, SUM.y + 4, SUM.z, root, 0.4);
  let bellSwing = 0;
  animated.push((dt, t) => { bellSwing *= Math.pow(0.25, dt); bell.rotation.z = Math.sin(t * 9) * bellSwing; bellGlow.material.opacity = 0.35 + bellSwing; });
  box(SUM.x + 5, SUM.y, SUM.z + 2, 0.3, 8, 0.3, '#eeeeee');
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), new THREE.MeshStandardMaterial({ color: '#9c6bff', side: THREE.DoubleSide, emissive: '#4a2a99', emissiveIntensity: 0.4 }));
  banner.position.set(SUM.x + 6.5, SUM.y + 7, SUM.z + 2); root.add(banner);
  animated.push((dt, t) => { banner.rotation.y = Math.sin(t * 2) * 0.2; });
  const mtSign = signBoard('THE MOUNTAIN', 'Trail to the top. A cave in the east face.', '#cfd8e3'); mtSign.position.set(-94, 0, -2); mtSign.rotation.y = Math.PI * 1.75; root.add(mtSign);

  // ---- Jake's Workshop: a wooden hut north of the plaza where gears are made ----
  const JKX = -24, JKZ = -34;
  box(JKX, 0, JKZ, 12, 0.6, 9, '#8d6e63', { topColor: '#a1887f' });
  box(JKX, 0.6, JKZ - 4.2, 12, 6, 0.6, '#795548'); box(JKX - 5.7, 0.6, JKZ - 1, 0.6, 6, 6.4, '#795548'); box(JKX + 5.7, 0.6, JKZ - 1, 0.6, 6, 6.4, '#795548');
  for (const s of [-1, 1]) { const roof = new THREE.Mesh(new THREE.BoxGeometry(13.4, 0.5, 6), plainMat('#c62828')); roof.position.set(JKX, 7.6, JKZ - 1 + s * 2.4); roof.rotation.x = s * 0.42; roof.castShadow = shadows; root.add(roof); }
  box(JKX - 2.5, 0.6, JKZ - 2.6, 4.5, 1.6, 1.6, '#5d4037', { topColor: '#6d4c41' });                       // workbench
  box(JKX + 2.6, 0.6, JKZ - 2.6, 1.6, 1.1, 1.2, '#37474f'); box(JKX + 2.6, 1.7, JKZ - 2.6, 2.4, 0.5, 1, '#455a64');   // anvil
  const sparks = bubbleDots('#ffb74d', 10); sparks.obj.position.set(JKX + 2.6, 2.3, JKZ - 2.6); root.add(sparks.obj); animated.push(dt => sparks.update(dt));
  const jake = npc('Jake', 'Gears', '#5d4037', '#ffb74d'); jake.root.position.set(JKX, 0.6, JKZ - 0.5); root.add(jake.root);
  const jakeSign = signBoard('JAKE\'S WORKSHOP', 'Gears for your hands', '#ffb74d'); jakeSign.position.set(JKX + 7.5, 0, JKZ + 4); jakeSign.rotation.y = -0.4; root.add(jakeSign);

  // ---- the raid arena (east): The Crawler bursts out of the sand here ----
  const ARENA = new THREE.Vector3(76, 0, 18);
  const arenaSand = new THREE.Mesh(new THREE.CircleGeometry(17, 40), studMat('#d9b56e', 34, 34)); arenaSand.rotation.x = -Math.PI / 2; arenaSand.position.set(ARENA.x, 0.04, ARENA.z); root.add(arenaSand);
  for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; box(ARENA.x + Math.cos(a) * 18.5, 0, ARENA.z + Math.sin(a) * 18.5, 2.2, 1 + (i % 3) * 0.7, 2.2, '#a1887f', { ry: a }); }
  const arenaSign = signBoard('THE PIT', 'Something lives under the sand', '#f0c87a'); arenaSign.position.set(ARENA.x - 20, 0, ARENA.z - 10); arenaSign.rotation.y = Math.PI * 0.35; root.add(arenaSign);

  // ---- Halloween: pumpkins everywhere, and Jack, who trades Pumpkin Tokens ----
  const spooky = new THREE.Group(); spooky.visible = false; root.add(spooky);
  const faceTex = textCanvas(64, 64, x => { x.fillStyle = '#000'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#ffcc33'; x.beginPath(); x.moveTo(12, 26); x.lineTo(22, 14); x.lineTo(28, 28); x.fill(); x.beginPath(); x.moveTo(52, 26); x.lineTo(42, 14); x.lineTo(36, 28); x.fill(); x.beginPath(); x.moveTo(10, 38); x.lineTo(20, 44); x.lineTo(26, 38); x.lineTo(32, 46); x.lineTo(38, 38); x.lineTo(44, 44); x.lineTo(54, 38); x.lineTo(46, 54); x.lineTo(18, 54); x.fill(); });
  const pumpkinFaces = [];
  const pumpkin = (x, y, z, s = 1, ry = 0) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; spooky.add(g);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.9 * s, 14, 10), plainMat('#ff7a00')); body.scale.y = 0.78; body.position.y = 0.7 * s; body.castShadow = shadows; g.add(body);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.14 * s, 0.4 * s, 6), plainMat('#4e7a2a')); stem.position.y = 1.45 * s; g.add(stem);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.1 * s, 1.1 * s), new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); face.position.set(0, 0.72 * s, 0.86 * s); g.add(face);
    pumpkinFaces.push(face.material);
    return g;
  };
  [[-14, 16], [14, 16], [-14, -16], [14, -16], [-6, 18], [6, 18]].forEach(([x, z], i) => pumpkin(x, 1, z, 1.1, i < 4 ? Math.atan2(-x, -z) : 0));
  [[-40, 66], [-52, 66], [-35, 80], [-58, 80], [JKX - 6, JKZ + 4], [JKX + 6, JKZ + 4], [ARENA.x, ARENA.z + 20], [-94, -4]].forEach(([x, z]) => pumpkin(x, 0, z, 0.9, Math.random() * 6));
  const jack = npc('Jack', 'Pumpkin Tokens', '#3e2723', '#ff9800', 'pumpkin'); jack.root.position.set(-33, 0, 70); jack.root.rotation.y = -Math.PI / 2; spooky.add(jack.root);
  // Hex, the Halloween merchant: Halloween auras, only while the event is on
  const hex = npc('Hex', 'Halloween Auras', '#1a0f24', '#b14dff', 'pumpkin'); hex.root.position.set(-33, 0, 62); hex.root.rotation.y = -Math.PI / 2; spooky.add(hex.root);

  // ---- secrets ----
  const duckAt = (x, y, z, s = 1) => {
    const d = new THREE.Group(); d.position.set(x, y, z); d.scale.setScalar(s); root.add(d);
    const yl = plainMat('#ffeb3b');
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.9), yl); b.position.y = 0.4; d.add(b);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), yl); h.position.set(0.45, 1, 0); d.add(h);
    const k = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.3), plainMat('#ff9800')); k.position.set(0.85, 0.95, 0); d.add(k);
    animated.push((dt, t) => { d.rotation.y = Math.sin(t * 0.4 + x) * 0.8; });
    return d;
  };
  duckAt(-86, 0.2, 58, 0.8); duckAt(-51, 0, -17.5, 0.7);
  // a tiny island out in the eastern sea, reached by stepping stones
  for (let i = 0; i < 8; i++) box(B.maxX + 5 + i * 4.6, -2.4, -20 + Math.sin(i * 1.3) * 2.2, 2.6, 2.4 + 0.15 * i, 2.6, '#8d8d8d', { topColor: '#9e9e9e' });
  const ISX = B.maxX + 47, ISZ = -20;
  box(ISX, -3, ISZ, 14, 3.6, 12, '#7a5236', { topColor: '#e8d29a', studsAllOver: true });
  box(ISX + 2.5, 0.6, ISZ - 1.5, 1, 7, 1, '#8d6e63'); box(ISX + 2.5, 7.6, ISZ - 1.5, 5, 0.6, 1.4, '#43a047', { noCollide: true }); box(ISX + 2.5, 7.6, ISZ - 1.5, 1.4, 0.6, 5, '#388e3c', { noCollide: true });
  duckAt(ISX - 3, 0.6, ISZ + 2.5, 0.9);
  const isleSign = signBoard('THE EDGE', 'You swam to the end of the world. Well, walked.', '#4fc3f7'); isleSign.position.set(ISX - 2, 0.6, ISZ - 4.5); root.add(isleSign);
  edge(ISX - 8, ISX + 8, ISZ - 7, ISZ - 6); edge(ISX - 8, ISX + 8, ISZ + 6, ISZ + 7); edge(ISX + 7, ISX + 8, ISZ - 7, ISZ + 7);
  const qb = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), new THREE.MeshStandardMaterial({ map: textCanvas(64, 64, x => { x.fillStyle = '#ffb300'; x.fillRect(0, 0, 64, 64); x.strokeStyle = '#7a4a00'; x.lineWidth = 4; x.strokeRect(2, 2, 60, 60); x.fillStyle = '#fff'; x.font = '900 46px Montserrat, sans-serif'; x.textAlign = 'center'; x.fillText('?', 32, 48); }), emissive: '#ffb300', emissiveIntensity: 0.35 }));
  qb.position.set(ISX + 3, 3.4, ISZ + 2.5); root.add(qb); glow('#ffd54f', 4, ISX + 3, 3.4, ISZ + 2.5, root, 0.4);
  animated.push((dt, t) => { qb.rotation.y += dt; qb.position.y = 3.4 + Math.sin(t * 2) * 0.2; });
  // a little door at the bottom of the tower, which leads to a room with a jukebox
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 1.6), plainMat('#3e2723')); door.position.set(TX - 3.1, 1.3, TZ); root.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), plainMat('#ffd54f', { metal: 0.6 })); knob.position.set(TX - 3.25, 1.3, TZ + 0.5); root.add(knob);
  const JBX = 0, JBZ = 1100;
  box(JBX, 0, JBZ, 22, 1, 22, '#1a1a24');
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const tile = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ color: (i + j) % 2 ? '#7c4dff' : '#00e5ff', transparent: true, opacity: 0.55 })); tile.rotation.x = -Math.PI / 2; tile.position.set(JBX - 8.4 + i * 2.4, 1.02, JBZ - 8.4 + j * 2.4); root.add(tile); animated.push((dt, t) => { tile.material.opacity = 0.25 + 0.35 * (Math.sin(t * 4 + i * 0.7 + j * 1.3) * 0.5 + 0.5); }); }
  for (const [x, z, w, d] of [[JBX, JBZ - 11, 22, 1], [JBX, JBZ + 11, 22, 1], [JBX - 11, JBZ, 1, 22], [JBX + 11, JBZ, 1, 22]]) box(x, 1, z, w, 9, d, '#11111a');
  box(JBX, 10, JBZ, 23, 1, 23, '#0d0d14', { noShadow: true });   // the ceiling
  for (let i = 0; i < 4; i++) { const disco = glow(['#ff4081', '#7c4dff', '#00e5ff', '#ffd740'][i], 7, JBX - 6 + i * 4, 8.6, JBZ, root, 0.5); animated.push((dt, t) => { disco.material.opacity = 0.25 + 0.3 * (Math.sin(t * 3 + i * 1.6) * 0.5 + 0.5); }); }
  const jbox = new THREE.Group(); jbox.position.set(JBX, 1, JBZ - 8.5); root.add(jbox);
  const jb1 = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 1.6), plainMat('#5d4037')); jb1.position.y = 2; jbox.add(jb1);
  const jbTop = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 1.6, 20, 1, false, 0, Math.PI), plainMat('#6d4c41')); jbTop.rotation.z = Math.PI / 2; jbTop.rotation.y = Math.PI / 2; jbTop.position.y = 4; jbox.add(jbTop);
  const jbGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.4), new THREE.MeshBasicMaterial({ color: '#ff4081' })); jbGlow.position.set(0, 2.2, 0.81); jbox.add(jbGlow);
  animated.push((dt, t) => { jbGlow.material.color.setHSL((t * 0.15) % 1, 0.9, 0.6); });
  glow('#ff4081', 8, JBX, 4, JBZ - 8, root, 0.4);
  const jbSign = signBoard('JUKEBOX', 'Every aura you have found has a song', '#ff4081'); jbSign.position.set(JBX + 6, 1, JBZ - 10); root.add(jbSign);
  const jbExit = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.2, 10, 40), new THREE.MeshBasicMaterial({ color: '#ffffff' })); jbExit.position.set(JBX, 3.6, JBZ + 9); root.add(jbExit); glow('#ffffff', 6, JBX, 3.6, JBZ + 9);
  animated.push((dt, t) => { jbExit.rotation.z = t; });
  // Limbo: a black door on the mountain's north face, and the nowhere behind it
  const ldoor = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4, 0.3), new THREE.MeshStandardMaterial({ color: '#050505', emissive: '#2a0050', emissiveIntensity: 0.6 })); ldoor.position.set(-132, 2, -95.2); root.add(ldoor);
  glow('#7c4dff', 6, -132, 2, -95.6, root, 0.3);
  const LX0 = -900, LZ0 = 0;
  const limboFloor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshBasicMaterial({ color: '#050505' })); limboFloor.rotation.x = -Math.PI / 2; limboFloor.position.set(LX0, 0, LZ0); root.add(limboFloor);
  const grid = new THREE.GridHelper(120, 40, '#3a3a3a', '#1a1a1a'); grid.position.set(LX0, 0.02, LZ0); root.add(grid);
  colliders.push({ min: new THREE.Vector3(LX0 - 60, -2, LZ0 - 60), max: new THREE.Vector3(LX0 + 60, 0, LZ0 + 60) });
  for (const [x0, x1, z0, z1] of [[-60, 60, -61, -60], [-60, 60, 60, 61], [-61, -60, -60, 60], [60, 61, -60, 60]]) colliders.push({ min: new THREE.Vector3(LX0 + x0, 0, LZ0 + z0), max: new THREE.Vector3(LX0 + x1, 40, LZ0 + z1), cam: false });
  const limboCubes = [];
  for (let i = 0; i < 30; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: i % 4 ? '#ffffff' : '#000000', wireframe: i % 4 !== 0 })); c.position.set(LX0 + (Math.random() - 0.5) * 100, 3 + Math.random() * 20, LZ0 + (Math.random() - 0.5) * 100); c.userData.s = 0.2 + Math.random(); root.add(c); limboCubes.push(c); }
  animated.push((dt, t) => limboCubes.forEach(c => { c.rotation.x += dt * c.userData.s; c.rotation.y += dt * c.userData.s * 0.7; }));
  const limboLight = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 80, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  limboLight.position.set(LX0, 40, LZ0 + 30); root.add(limboLight);
  const limboSign = signBoard('LIMBO', 'Rolls here can find Limbo auras. Walk into the light to leave.', '#bdbdbd'); limboSign.position.set(LX0, 0, LZ0 - 6); root.add(limboSign);

  // ---- the Jester's lost cards (only shown while his quest is on) ----
  const cardAt = { card1: new THREE.Vector3(TX - 2, TH + 1, TZ + 2), card2: new THREE.Vector3(15, 0.3, CZ - 6), card3: new THREE.Vector3(-129.5, 3.6, -80) };
  const cards = {};
  for (const [id, p] of Object.entries(cardAt)) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.05), new THREE.MeshStandardMaterial({ map: cardTex(), emissive: '#ffffff', emissiveIntensity: 0.15 }));
    m.position.set(p.x, p.y + 1.4, p.z); m.visible = false; root.add(m);
    const g = glow('#ffd600', 3, p.x, p.y + 1.4, p.z, root, 0); g.visible = false;
    cards[id] = { m, g };
    animated.push((dt, t) => { m.rotation.y = t * 1.8; m.position.y = p.y + 1.4 + Math.sin(t * 2) * 0.15; g.material.opacity = 0.5; });
  }

  // ---- trees, rocks, flowers and lamps ----
  const rand = mulberry(42);
  const blocked = (x, z) => Math.hypot(x, z) < 24 || (Math.abs(x - MX) < 14 && Math.abs(z - MZ) < 14) || (Math.abs(x - JX) < 14 && Math.abs(z - JZ) < 16)
    || (Math.abs(x - PX) < 28 && Math.abs(z - PZ) < 22) || z < -68 || (Math.abs(x - 66) < 18 && Math.abs(z + 36) < 16) || (x < -78 && z > 8 && z < 72) || (Math.abs(x - 23) < 6 && Math.abs(z - 11) < 6) || (Math.abs(x - TX) < 12 && Math.abs(z - TZ) < 12) || (Math.abs(x - SX) < 8 && Math.abs(z - SZ) < 8)
    || Math.abs(x) < 5 || (Math.abs(z + 6) < 5 && Math.abs(x) < 45) || (Math.abs(x + 40) < 5 && z > 0 && z < 40) || (Math.abs(x - GX) < 6 && Math.abs(z - GZ) < 6)
    || (x < -92 && z < 4) || (Math.abs(x - OB.x) < 14 && Math.abs(z - OB.z) < 14) || (Math.abs(x - GYX) < 15 && Math.abs(z - GYZ) < 12) || (Math.abs(z + 18) < 4 && Math.abs(x) < 20) || (Math.abs(z + 6) < 5 && x < -40 && x > -96)
    || (Math.abs(x - JKX) < 12 && z > JKZ - 10 && z < JKZ + 16) || Math.hypot(x - ARENA.x, z - ARENA.z) < 22 || (Math.abs(x + 33) < 4 && Math.abs(z - 70) < 4);
  let trees = 0;
  for (let i = 0; i < 1400 && trees < 120; i++) {
    const x = B.minX + 6 + rand() * (GW - 12), z = B.minZ + 6 + rand() * (GD - 12);
    if (blocked(x, z)) continue;
    trees++;
    const h = 5 + Math.floor(rand() * 4);
    box(x, 0, z, 1.6, h, 1.6, '#6d4c41');
    const leaf = ['#2e7d32', '#388e3c', '#43a047', '#1b5e20'][Math.floor(rand() * 4)];
    box(x, h, z, 6, 3, 6, leaf, { noCollide: true });
    box(x, h + 3, z, 4, 2, 4, leaf, { noCollide: true });
  }
  for (let i = 0; i < 36; i++) {
    const x = B.minX + 6 + rand() * (GW - 12), z = B.minZ + 6 + rand() * (GD - 12);
    if (blocked(x, z)) continue;
    const s = 1 + rand() * 2.5;
    box(x, 0, z, s * 1.4, s, s * 1.2, '#8d8d8d', { ry: rand() * 3 });
  }
  const flowerColors = ['#ff5252', '#ffd740', '#e040fb', '#ffffff', '#40c4ff'];
  for (let i = 0; i < 120; i++) {
    const x = B.minX + 6 + rand() * (GW - 12), z = B.minZ + 6 + rand() * (GD - 12);
    if (blocked(x, z)) continue;
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), plainMat(flowerColors[i % 5]));
    f.position.set(x, 0.6, z); f.userData.bake = true; root.add(f);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), plainMat('#2e7d32')); st.position.set(x, 0.3, z); st.userData.bake = true; root.add(st);
  }
  const lamps = [];
  for (const [x, z] of [[4, 26], [-4, 36], [-4, 44], [-22, -2], [-34, -10], [20, -2], [32, -10], [-4, -30], [4, -50], [-36, 10], [-44, 28], [16, 16], [-16, 16], [-60, -2], [-80, -10], [-50, 62], [-90, -50]]) {
    box(x, 0, z, 0.6, 7, 0.6, '#37474f');
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4), new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffcc66', emissiveIntensity: 0.2 }));
    head.position.set(x, 7.5, z); root.add(head);
    lamps.push({ head, glow: glow('#ffcc66', 9, x, 7.5, z, root, 0) });
  }
  // where things can lie on the ground for people to pick up
  const itemSpots = [];
  for (let i = 0; i < 400 && itemSpots.length < 44; i++) {
    const x = B.minX + 8 + rand() * (GW - 16), z = B.minZ + 8 + rand() * (GD - 16);
    if (blocked(x, z) && !(Math.hypot(x, z) > 18 && Math.hypot(x, z) < 24)) continue;
    if (x < -92 && z < 4) continue;
    itemSpots.push(new THREE.Vector3(x, 0, z));
  }
  for (const i of [1, 4, 7, 10, 13]) { const r = lay(i); itemSpots.push(new THREE.Vector3((r[0] + r[1]) / 2, (i + 1) * MT.h, MT.z1 - 3.5 * (i + 0.5))); }
  itemSpots.push(new THREE.Vector3(-143, ST.y, -46), new THREE.Vector3(SUM.x - 3, SUM.y, SUM.z - 3), new THREE.Vector3(FX + 2, FY, FZ + 2));

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

  const hemi = new THREE.HemisphereLight('#bfe3ff', '#3d5a3a', 0.9); scene.add(hemi);
  const sunLight = new THREE.DirectionalLight('#ffffff', 1.6);
  sunLight.castShadow = shadows;
  if (shadows) { sunLight.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024); const sc = sunLight.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 300; sunLight.shadow.bias = -0.0008; }
  scene.add(sunLight); scene.add(sunLight.target);
  scene.fog = new THREE.Fog('#cfe9ff', 120, 420);

  const weatherFx = makeWeather(scene);
  // How everything looks for a given time and biome. Colours ease towards their targets so changes are smooth.
  const look = {
    day: { top: '#3d8fff', bottom: '#cfe9ff', fog: '#cfe9ff', sun: 1.7, hemi: 0.95, stars: 0 },
    night: { top: '#071033', bottom: '#243266', fog: '#151d40', sun: 0.5, hemi: 0.6, stars: 1 },
    windy: { top: '#5aa9ff', bottom: '#e6f7ff', fog: '#dff3ff', sun: 1.6, hemi: 1.0, fogNear: 90, fogFar: 360 },
    rain: { top: '#4b5867', bottom: '#8795a3', fog: '#7c8a98', sun: 0.6, hemi: 0.7, fogNear: 50, fogFar: 230 },
    snow: { top: '#a9c3db', bottom: '#eef5fb', fog: '#e4eef7', sun: 1.0, hemi: 1.0, fogNear: 40, fogFar: 220 },
    sandstorm: { top: '#b98a4b', bottom: '#e3c58e', fog: '#d2ad6e', sun: 1.2, hemi: 0.9, sunColor: '#ffd59a', fogNear: 18, fogFar: 140 },
    hell: { top: '#3a0400', bottom: '#b3260a', fog: '#7a1500', sun: 0.8, hemi: 0.6, sunColor: '#ff6a3d', fogNear: 30, fogFar: 200 },
    starfall: { top: '#030824', bottom: '#1c2c6e', fog: '#141f52', sun: 0.55, hemi: 0.7, sunColor: '#9fb4ff', fogNear: 80, fogFar: 380 },
    heaven: { top: '#fff7d6', bottom: '#ffffff', fog: '#fffbe8', sun: 1.9, hemi: 1.2, sunColor: '#fff3c4', fogNear: 40, fogFar: 260 },
    corruption: { top: '#1e0730', bottom: '#5b2a6e', fog: '#3a1550', sun: 0.6, hemi: 0.65, sunColor: '#d38cff', fogNear: 30, fogFar: 200 },
    null: { top: '#111111', bottom: '#3a3a3a', fog: '#1c1c1c', sun: 0.5, hemi: 0.55, fogNear: 25, fogFar: 160 },
    glitched: { top: '#001a14', bottom: '#00594a', fog: '#002a22', sun: 0.7, hemi: 0.75, sunColor: '#00ffd0', fogNear: 30, fogFar: 200 },
    pumpkinmoon: { top: '#1a0b00', bottom: '#5a2a00', fog: '#2e1400', sun: 0.6, hemi: 0.6, sunColor: '#ffa040', fogNear: 40, fogFar: 240 },
    graveyard: { top: '#1c2420', bottom: '#4c5a52', fog: '#3a463f', sun: 0.55, hemi: 0.6, sunColor: '#b8d8c0', fogNear: 18, fogFar: 140 },
    bloodrain: { top: '#2a0000', bottom: '#6b0a0a', fog: '#3a0505', sun: 0.6, hemi: 0.6, sunColor: '#ff5252', fogNear: 30, fogFar: 190 },
    limbo: { top: '#000000', bottom: '#0a0a0a', fog: '#000000', sun: 0.35, hemi: 0.55, sunColor: '#ffffff', fogNear: 25, fogFar: 95 },
  };
  const cur = { top: new THREE.Color(look.day.top), bottom: new THREE.Color(look.day.bottom), fog: new THREE.Color(look.day.fog), sun: 1.6, hemi: 0.9, stars: 0, near: 120, far: 420, sunColor: new THREE.Color('#ffffff') };
  const tmp = new THREE.Color();
  let glitchT = 0;

  bakeStatic(root);
  const npcs = { mari, jester, finn, marlin, nova, stella, ghost, jake, jack, hex };
  return {
    root, colliders, bounds: B,
    spawn: new THREE.Vector3(0, 1, 6),
    places: {
      mari: { pos: new THREE.Vector3(MX + 1, 1, MZ + 2.5), r: 6.5, label: 'Talk to Mari' },
      jester: { pos: new THREE.Vector3(JX, 0, JZ + 13), r: 6, label: 'Talk to the Jester' },
      finn: { pos: new THREE.Vector3(PX - 5, 0, PZ - 16), r: 6, label: 'Talk to Old Finn' },
      fish_dock: { pos: SPOTS.dock, r: 3.4, label: 'Fish (The Dock)', spot: 'dock' },
      fish_falls: { pos: SPOTS.falls, r: 3.4, label: 'Fish (Waterfall Pool)', spot: 'falls' },
      fish_lagoon: { pos: SPOTS.lagoon, r: 3.4, label: 'Fish (Sunset Lagoon)', spot: 'lagoon' },
      fish_creek: { pos: SPOTS.creek, r: 3.4, label: 'Fish (Tower Creek)', spot: 'creek' },
      fish_void: { pos: SPOTS.void, r: 3.4, label: 'Fish (The Void Pool)', spot: 'void' },
      marlin: { pos: new THREE.Vector3(6.5, 0, 32), r: 4.5, label: 'Sell fish to Marlin' },
      nova: { pos: new THREE.Vector3(19.5, 0, 11), r: 4.5, label: 'Daily Shop' },
      questboard: { pos: new THREE.Vector3(11, 0, -15.5), r: 4, label: 'Read the Quest Board' },
      stella: { pos: new THREE.Vector3(ST.x + 3, ST.y, ST.z), r: 7, label: 'Talk to Stella' },
      bell: { pos: new THREE.Vector3(SUM.x, SUM.y, SUM.z + 1.5), r: 4.5, label: 'Ring the bell' },
      portal_stella: { pos: new THREE.Vector3(-93, 0, -64), r: 3.5, label: 'Enter the portal to Stella' },
      portal_back: { pos: new THREE.Vector3(-142.5, ST.y, -44), r: 3.5, label: 'Enter the portal' },
      chest: { pos: new THREE.Vector3(-133, 3.6, -79.5), r: 3, label: 'Open the chest' },
      devpc: { pos: new THREE.Vector3(21, 0, CZ - 4.5), r: 3, label: 'Use the computer' },
      ghost: { pos: new THREE.Vector3(GYX - 2, 0, GYZ + 2), r: 5, label: 'Talk to the Ghost' },
      card1: { pos: cardAt.card1, r: 2.5, label: 'Pick up the card' },
      card2: { pos: cardAt.card2, r: 2.5, label: 'Pick up the card' },
      card3: { pos: cardAt.card3, r: 2.5, label: 'Pick up the card' },
      obby: { pos: new THREE.Vector3(FX, FY, FZ), r: 3.4, auto: true },
      jake: { pos: new THREE.Vector3(JKX, 0.6, JKZ + 3), r: 5, label: 'Talk to Jake' },
      jack: { pos: new THREE.Vector3(-35, 0, 70), r: 4.5, label: 'Talk to Jack' },
      hex: { pos: new THREE.Vector3(-35, 0, 62), r: 4.5, label: 'Talk to Hex' },
      towerdoor: { pos: new THREE.Vector3(TX - 4.2, 0, TZ), r: 2.6, label: 'Open the little door' },
      jukebox: { pos: new THREE.Vector3(JBX, 1, JBZ - 6), r: 3.5, label: 'Use the jukebox' },
      jukebox_exit: { pos: new THREE.Vector3(JBX, 1, JBZ + 9), r: 2.6, auto: true },
      limbodoor: { pos: new THREE.Vector3(-132, 0, -97.5), r: 3, label: 'Touch the black door' },
      limbo_exit: { pos: new THREE.Vector3(LX0, 0, LZ0 + 30), r: 2.4, auto: true },
      qblock: { pos: new THREE.Vector3(ISX + 3, 0.6, ISZ + 2.5), r: 3, label: 'Hit the ? block' },
    },
    eggs: {
      duck: { pos: new THREE.Vector3(11, 0.5, 51), r: 9, name: 'the rubber duck' },
      cave: { box: { min: new THREE.Vector3(13, 0, CZ - 9), max: new THREE.Vector3(23, 7, CZ + 1) }, name: 'the Dev Room' },
      tower: { pos: new THREE.Vector3(TX, TH + 1, TZ), r: 4, name: 'the top of the tower' },
      glitch: { pos: new THREE.Vector3(GX, 1, GZ), r: 2.8, name: 'the glitch' },
      sun: { pos: new THREE.Vector3(SX, 0, SZ + 4), r: 6, name: 'the sun statue' },
      summit: { pos: new THREE.Vector3(SUM.x, SUM.y, SUM.z), r: 9, name: 'the top of the mountain' },
      crystal: { box: { min: new THREE.Vector3(CRYSTAL[0], 3, CRYSTAL[2]), max: new THREE.Vector3(CRYSTAL[1], 11, CRYSTAL[3] - 0.5) }, name: 'the hidden crystal room' },
      graveyard: { box: { min: new THREE.Vector3(GYX - 11, 0, GYZ - 8), max: new THREE.Vector3(GYX + 11, 6, GYZ + 8) }, name: 'the graveyard at night', night: true },
      duck2: { pos: new THREE.Vector3(-86, 0, 58), r: 7, name: 'a duck in the creek' },
      duck3: { pos: new THREE.Vector3(-51, 0, -17.5), r: 4, name: 'a duck behind Mari\'s shop' },
      duck4: { pos: new THREE.Vector3(ISX - 3, 0.6, ISZ + 2.5), r: 4, name: 'a duck on the tiny island' },
      islet: { pos: new THREE.Vector3(ISX, 0.6, ISZ), r: 8, name: 'the edge of the world' },
      jukebox: { pos: new THREE.Vector3(JBX, 1, JBZ), r: 14, name: 'the jukebox room' },
      limbo: { pos: new THREE.Vector3(LX0, 0, LZ0), r: 70, name: 'Limbo' },
    },
    // the cave's chasm: fall in and you land back in the corridor
    pit: { min: new THREE.Vector3(PIT[0], -5, PIT[2]), max: new THREE.Vector3(PIT[1], 1.5, PIT[3]), back: new THREE.Vector3(-104, 3.6, -55) },
    stellaCamp: new THREE.Vector3(-141.5, ST.y, -53), caveMouth: new THREE.Vector3(-90, 0, -60),
    nullRoom: { spawn: new THREE.Vector3(NX, 1, NZ - 6), portal: new THREE.Vector3(NX, 1, NZ + 10) },
    itemSpots, npcs,
    lookFor(time, weather) { return look[weather !== 'clear' ? weather : time]; },
    setPortals(onOff) { portalOut.visible = onOff; portalBack.visible = onOff; },
    setCards(visible) { for (const [id, c] of Object.entries(cards)) { c.m.visible = !!visible[id]; c.g.visible = !!visible[id]; } },
    setChest(opened) { cLid.rotation.x = opened ? -1.2 : 0; cLid.position.z = opened ? -0.5 : 0; cLid.position.y = opened ? 1.8 : 1.45; chestGlow.visible = !opened; },
    ringBell() { bellSwing = 0.6; },
    setBoard(data) { board.draw(data); },
    setHalloween(onOff) { spooky.visible = onOff; },
    arena: ARENA,
    rooms: { jukebox: new THREE.Vector3(JBX, 1, JBZ + 5), limbo: new THREE.Vector3(LX0, 0, LZ0 - 2), tower: new THREE.Vector3(TX - 5, 0, TZ), limboDoor: new THREE.Vector3(-132, 0, -98.5) },
    inLimbo: p => Math.abs(p.x - LX0) < 61 && Math.abs(p.z - LZ0) < 61,
    update(dt, t, env) {
      for (const a of animated) a(dt, t, env);
      for (const n of Object.values(npcs)) n.update(dt, t);
      jester.root.visible = env.jester; jesterGlow.material.opacity = env.jester ? 0.35 + Math.sin(t * 3) * 0.15 : 0;
      const night = env.time === 'night';
      ghost.root.visible = night; ghostGlow.material.opacity = night ? 0.3 + Math.sin(t * 2) * 0.1 : 0;
      if (spooky.visible) { const lit = night || ['graveyard', 'bloodrain', 'pumpkinmoon'].includes(env.weather); pumpkinFaces.forEach((m, i) => { m.opacity = lit ? 0.75 + Math.sin(t * 9 + i) * 0.15 : 0.35; }); }
      // sky and light
      let target = look[env.weather !== 'clear' ? env.weather : env.time];
      const base = look[env.time];
      if (env.weather === 'glitched') { glitchT -= dt; if (glitchT < 0) { glitchT = 0.15 + Math.random() * 0.5; target = { ...target, top: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') }; cur.top.set(target.top); } }
      const k = 1 - Math.exp(-dt * 1.5);
      const blendNight = env.weather !== 'clear' && night && env.weather !== 'starfall';
      if (env.weather !== 'glitched') cur.top.lerp(tmp.set(blendNight ? tmp.set(target.top).lerp(new THREE.Color(base.top), 0.6) : target.top), k);
      cur.bottom.lerp(tmp.set(target.bottom), k);
      cur.fog.lerp(tmp.set(blendNight ? new THREE.Color(target.fog).lerp(new THREE.Color(base.fog), 0.6) : target.fog), k);
      cur.sun += ((night ? Math.min(target.sun, base.sun) : target.sun) - cur.sun) * k;
      cur.hemi += ((night ? Math.min(target.hemi, base.hemi + 0.1) : target.hemi) - cur.hemi) * k;
      cur.stars += (((night || env.weather === 'starfall') && !['rain', 'null', 'sandstorm'].includes(env.weather) ? 1 : 0) - cur.stars) * k;
      cur.near += ((target.fogNear || 120) - cur.near) * k; cur.far += ((target.fogFar || 420) - cur.far) * k;
      cur.sunColor.lerp(tmp.set(target.sunColor || (night ? '#9fb4ff' : '#ffffff')), k);
      skyMat.uniforms.top.value.copy(cur.top); skyMat.uniforms.bottom.value.copy(cur.bottom);
      scene.fog.color.copy(cur.fog); scene.fog.near = cur.near; scene.fog.far = cur.far;
      hemi.intensity = cur.hemi; sunLight.intensity = cur.sun; sunLight.color.copy(cur.sunColor);
      stars.material.opacity = cur.stars;
      const a = env.progress * Math.PI, cam = env.camPos;
      const arc = (ang) => new THREE.Vector3(Math.cos(ang) * 300, Math.sin(ang) * 220 + 20, -160);
      const sp = arc(a), mp = arc(a);
      sunSprite.visible = env.time === 'day' && env.weather !== 'starfall'; moonSprite.visible = night || env.weather === 'starfall';
      sunSprite.position.copy(sp).add(cam); moonSprite.position.copy(mp).add(cam);
      sky.position.copy(cam); stars.position.copy(cam);
      sunSprite.material.opacity = ['rain', 'null', 'sandstorm', 'corruption'].includes(env.weather) ? 0.25 : 1;
      const lightDir = env.time === 'day' ? sp : mp;
      sunLight.position.copy(env.player).add(lightDir.clone().normalize().multiplyScalar(120));
      sunLight.target.position.copy(env.player);
      const dark = night || ['rain', 'null', 'hell', 'starfall', 'corruption', 'sandstorm', 'glitched'].includes(env.weather);
      for (const l of lamps) { l.head.material.emissiveIntensity += ((dark ? 1.4 : 0.15) - l.head.material.emissiveIntensity) * k; l.glow.material.opacity += ((dark ? 0.75 : 0) - l.glow.material.opacity) * k; }
      weatherFx.update(dt, t, env.weather, env.camPos);
    },
  };

  // ---- small builders ----
  function npc(name, role, shirt, accent, hat) {
    const a = buildAvatar(name, shirt);
    a.root.remove(a.tag);
    const label = signLabel(name, role, accent); label.position.y = 6.9; a.root.add(label);
    if (hat === 'jester') {
      const hatMat = [plainMat('#6a1b9a'), plainMat('#ffd600')];
      for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.5, 8), hatMat[s > 0 ? 1 : 0]); h.position.set(s * 0.45, 5.6, 0); h.rotation.z = -s * 0.7; a.body.add(h); const bell = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), plainMat('#ffd600', { emissive: '#ffd600', glow: 0.5 })); bell.position.set(s * 1.0, 5.95, 0); a.body.add(bell); }
    }
    if (hat === 'witch') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.12, 20), plainMat('#1a237e')); brim.position.y = 5.32; a.body.add(brim);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.2, 16), plainMat('#1a237e')); cone.position.set(0, 6.4, -0.15); cone.rotation.x = -0.25; a.body.add(cone);
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), plainMat('#ffd54f', { emissive: '#ffd54f', glow: 0.8 })); star.position.set(0, 5.75, 0.62); a.body.add(star);
    }
    if (hat === 'pumpkin') {
      a.head.visible = false;
      const ph = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), plainMat('#ff7a00')); ph.scale.set(1, 0.85, 1); ph.position.y = 4.85; a.body.add(ph);
      const pf = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); pf.position.set(0, 4.85, 0.98); a.body.add(pf);
      const ps = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 6), plainMat('#4e7a2a')); ps.position.y = 5.8; a.body.add(ps);
    }
    if (hat === 'ghost') {
      const ghostly = m => { m = m.clone(); m.transparent = true; m.opacity = 0.5; m.color.set('#dceeff'); m.emissive = new THREE.Color('#9fc8ff'); m.emissiveIntensity = 0.5; return m; };
      a.root.traverse(o => { if (o.isMesh && o.material && o.parent !== a.root) { o.material = Array.isArray(o.material) ? o.material.map(ghostly) : ghostly(o.material); o.castShadow = false; } });
    }
    let t0 = Math.random() * 6;
    return { root: a.root, update(dt, t) { a.animate(dt, 0, false); a.body.position.y = Math.sin(t * 2 + t0) * 0.05 + (hat === 'ghost' ? 0.5 + Math.sin(t * 1.3) * 0.25 : 0); a.head.rotation.y = Math.sin(t * 0.7 + t0) * 0.35; } };
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
    x.textAlign = 'center'; x.fillStyle = '#ffffff'; x.font = '800 52px Montserrat, "Segoe UI", sans-serif'; x.fillText(title, 256, 92, 470);
    x.fillStyle = accent; x.font = '600 28px Montserrat, "Segoe UI", sans-serif'; x.fillText(sub, 256, 148, 470);
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(7, 2.8, 0.3), [plainMat('#4e342e'), plainMat('#4e342e'), plainMat('#4e342e'), plainMat('#4e342e'), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), plainMat('#4e342e')]);
  board.position.y = 3.6; g.add(board);
  for (const s of [-2.6, 2.6]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.4, 0.4), plainMat('#4e342e')); p.position.set(s, 1.2, 0); g.add(p); }
  return g;
}
// The stats board in the plaza: the top rollers and the rarest auras ever found. The game fills it in.
function statsBoard() {
  const g = new THREE.Group();
  const c = document.createElement('canvas'); c.width = 1024; c.height = 600;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(12, 7), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.set(0, 5.4, 0.21); g.add(face);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(12.6, 7.6, 0.4), plainMat('#1a1a1f')); frame.position.y = 5.4; g.add(frame);
  for (const s of [-5.6, 5.6]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2, 0.5), plainMat('#1a1a1f')); p.position.set(s, 0.8, 0); g.add(p); }
  const draw = (data = {}) => {
    const x = c.getContext('2d');
    x.fillStyle = '#0d0d12'; x.fillRect(0, 0, 1024, 600);
    x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 3; x.strokeRect(14, 14, 996, 572);
    x.textAlign = 'center'; x.fillStyle = '#fff'; x.font = '800 44px Montserrat, "Segoe UI", sans-serif'; x.fillText('STATS', 512, 72);
    const col = (title, rows, cx) => {
      x.font = '700 30px Montserrat, "Segoe UI", sans-serif'; x.fillStyle = '#cfcfd6'; x.fillText(title, cx, 130);
      x.fillStyle = 'rgba(255,255,255,.3)'; x.fillRect(cx - 220, 146, 440, 2);
      (rows || []).slice(0, 8).forEach((r, i) => {
        const y = 192 + i * 50;
        x.textAlign = 'left'; x.font = '700 28px Montserrat, "Segoe UI", sans-serif'; x.fillStyle = i === 0 ? '#ffd54f' : i === 1 ? '#e0e0e0' : i === 2 ? '#d7a46b' : '#ffffff';
        x.fillText(`${i + 1}. ${r.name}`, cx - 215, y, 250);
        x.textAlign = 'right'; x.font = '600 26px Montserrat, "Segoe UI", sans-serif'; x.fillStyle = r.color || '#b9b9c2'; x.fillText(r.value, cx + 215, y, 190);
        x.textAlign = 'center';
      });
      if (!rows || !rows.length) { x.font = '600 24px Montserrat, "Segoe UI", sans-serif'; x.fillStyle = '#8a8a94'; x.fillText(data.loading ? 'Loading...' : 'Nobody yet', cx, 220); }
    };
    col('MOST ROLLS', data.rolls, 266);
    col('RAREST AURA', data.rare, 758);
    tex.needsUpdate = true;
  };
  draw({ loading: true });
  return { group: g, draw };
}
function signLabel(name, role, accent) {
  const tex = textCanvas(768, 192, x => {
    x.textAlign = 'center'; x.lineJoin = 'round';
    x.font = '800 60px Montserrat, "Segoe UI", sans-serif'; x.lineWidth = 10; x.strokeStyle = 'rgba(0,0,0,.75)'; x.strokeText(name, 384, 80); x.fillStyle = accent; x.fillText(name, 384, 80);
    x.font = '600 38px Montserrat, "Segoe UI", sans-serif'; x.lineWidth = 7; x.strokeText(role, 384, 140); x.fillStyle = '#ffffff'; x.fillText(role, 384, 140);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(7.2, 1.8, 1); return s;
}
// A small 3D potion bottle (shop shelves, Stella's shelf, and potions lying on the ground).
export function potionModel(color, s = 1) {
  const g = new THREE.Group();
  const liquid = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.25, transparent: true, opacity: 0.92 });
  const glass = new THREE.MeshStandardMaterial({ color: '#dff3ff', transparent: true, opacity: 0.35, roughness: 0.1 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42 * s, 14, 10), liquid); body.position.y = 0.42 * s; g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * s, 0.16 * s, 0.36 * s, 10), glass); neck.position.y = 0.92 * s; g.add(neck);
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s, 0.13 * s, 0.16 * s, 10), new THREE.MeshStandardMaterial({ color: '#a1887f' })); cork.position.y = 1.16 * s; g.add(cork);
  return g;
}
function stripeTex(a, b) {
  const t = textCanvas(256, 64, x => { for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? b : a; x.fillRect(i * 32, 0, 32, 64); } });
  t.wrapS = THREE.RepeatWrapping; t.repeat.set(2, 1); return t;
}
function cardTex() {
  return textCanvas(64, 96, x => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 96); x.strokeStyle = '#6a1b9a'; x.lineWidth = 4; x.strokeRect(2, 2, 60, 92);
    x.fillStyle = '#111'; x.font = '800 18px Montserrat, sans-serif'; x.fillText('A', 7, 22);
    x.beginPath(); x.moveTo(32, 30); x.bezierCurveTo(14, 46, 18, 62, 30, 58); x.lineTo(26, 72); x.lineTo(38, 72); x.lineTo(34, 58); x.bezierCurveTo(46, 62, 50, 46, 32, 30); x.fill();
  });
}
function terminalTex() {
  return textCanvas(256, 170, x => {
    x.fillStyle = '#04120a'; x.fillRect(0, 0, 256, 170);
    x.fillStyle = '#00ff9c'; x.font = '600 15px monospace';
    ['> overcontrol_rng.exe', '> loading auras... ok', '> luck: ???', '> hint: codes are', '  case-sensitive', '> _'].forEach((l, i) => x.fillText(l, 10, 24 + i * 24));
  });
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
function bubbleDots(color, n = 16, wide) {
  const pos = new Float32Array(n * 3), geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const obj = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: wide ? 1.4 : 0.45, map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: wide ? 0.5 : 0.9 }));
  const p = Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * (wide ? 6 : 2), y: Math.random() * 2, z: (Math.random() - 0.5) * (wide ? 3 : 2), v: 0.5 + Math.random() }));
  return { obj, update(dt) { p.forEach((q, i) => { q.y += q.v * dt; if (q.y > (wide ? 4 : 2.2)) q.y = 0; pos[i * 3] = q.x; pos[i * 3 + 1] = q.y; pos[i * 3 + 2] = q.z; }); geo.attributes.position.needsUpdate = true; } };
}

// Biome particles that follow the camera: rain, snow, embers, motes, dust, wind, falling stars, null cubes.
function makeWeather(scene) {
  const N = 900, geo = new THREE.BufferGeometry(), pos = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 0.35, map: glowTex(), transparent: true, depthWrite: false, opacity: 0.9, color: '#ffffff' });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
  const lineGeo = new THREE.BufferGeometry(), linePos = new Float32Array(N * 6);
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: '#b8d4ff', transparent: true, opacity: 0.55 });
  const lines = new THREE.LineSegments(lineGeo, lineMat); lines.frustumCulled = false; scene.add(lines);
  const P = Array.from({ length: N }, () => ({ x: (Math.random() - 0.5) * 120, y: Math.random() * 60, z: (Math.random() - 0.5) * 120, s: Math.random() }));
  const cubes = new THREE.Group(); scene.add(cubes);
  for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: i % 3 ? '#000000' : '#ffffff' })); m.userData = { x: (Math.random() - 0.5) * 140, y: 4 + Math.random() * 30, z: (Math.random() - 0.5) * 140, s: 0.2 + Math.random() }; cubes.add(m); }
  let kind = null;
  const POINTS = { snow: '#ffffff', hell: '#ff6a2b', heaven: '#fff3b0', sandstorm: '#e3c58e', corruption: '#c06bff', windy: '#c8f0a0', graveyard: '#c8d8d0', pumpkinmoon: '#ffab40' };
  return {
    update(dt, t, w, cam) {
      if (w !== kind) {
        kind = w;
        pts.visible = !!POINTS[w]; lines.visible = ['rain', 'windy', 'starfall', 'sandstorm', 'bloodrain'].includes(w); cubes.visible = w === 'null' || w === 'glitched';
        mat.color.set(POINTS[w] || '#ffffff');
        mat.size = w === 'snow' ? 0.5 : w === 'hell' ? 0.45 : w === 'heaven' ? 0.6 : w === 'sandstorm' ? 0.55 : w === 'windy' ? 0.4 : 0.6;
        mat.blending = w === 'snow' || w === 'sandstorm' || w === 'windy' ? THREE.NormalBlending : THREE.AdditiveBlending;
        lineMat.color.set(w === 'starfall' ? '#dfe9ff' : w === 'windy' ? '#ffffff' : w === 'sandstorm' ? '#e9d2a2' : w === 'bloodrain' ? '#ff1744' : '#b8d4ff');
        lineMat.opacity = w === 'starfall' ? 0.9 : w === 'windy' ? 0.35 : 0.55;
        cubes.children.forEach((m, i) => m.material.color.set(w === 'glitched' ? (i % 2 ? '#00ffd0' : '#ff00aa') : (i % 3 ? '#000000' : '#ffffff')));
      }
      if (pts.visible) {
        P.forEach((p, i) => {
          if (w === 'snow') { p.y -= (2 + p.s * 2) * dt; p.x += Math.sin(t + i) * dt * 0.8; }
          else if (w === 'hell') { p.y += (2 + p.s * 3) * dt; p.x += Math.sin(t * 2 + i) * dt; }
          else if (w === 'sandstorm' || w === 'windy') { p.x += (w === 'sandstorm' ? 26 : 18) * (0.6 + p.s) * dt; p.y += Math.sin(t * 3 + i) * dt * 2; if (p.x > 60) p.x -= 120; }
          else if (w === 'corruption' || w === 'graveyard') { p.y += (0.6 + p.s) * dt * (w === 'graveyard' ? 0.4 : 1); p.x += Math.sin(t + i) * dt; }
          else if (w === 'pumpkinmoon') { p.y += (1.5 + p.s * 2) * dt; p.x += Math.sin(t * 2 + i) * dt; }
          else { p.y += (0.3 + p.s) * dt; }
          if (p.y < 0) p.y += 60; if (p.y > 60) p.y -= 60;
          pos[i * 3] = cam.x + p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = cam.z + p.z;
        });
        geo.attributes.position.needsUpdate = true;
      }
      if (lines.visible) {
        P.forEach((p, i) => {
          let x = cam.x + p.x, z = cam.z + p.z;
          if (w === 'rain' || w === 'bloodrain') { p.y -= (40 + p.s * 20) * dt; if (p.y < 0) p.y += 60; linePos.set([x, p.y, z, x + 0.15, p.y + 1.6, z], i * 6); }
          else if (w === 'windy' || w === 'sandstorm') { p.x += (w === 'windy' ? 50 : 40) * (0.5 + p.s) * dt; if (p.x > 60) p.x -= 120; x = cam.x + p.x; linePos.set([x, p.y * 0.5, z, x - 3 - p.s * 3, p.y * 0.5 + 0.1, z], i * 6); }
          else if (w === 'starfall') {
            if (i % 9) { linePos.set([0, -99, 0, 0, -99, 0], i * 6); return; }
            p.y -= (30 + p.s * 25) * dt; p.x -= 20 * dt; if (p.y < 0) { p.y += 60; p.x = (Math.random() - 0.5) * 120; } x = cam.x + p.x;
            linePos.set([x, p.y + 30, z, x + 4, p.y + 36, z], i * 6);
          }
        });
        lineGeo.attributes.position.needsUpdate = true;
      }
      if (cubes.visible) cubes.children.forEach(m => { const u = m.userData; m.position.set(cam.x + u.x, u.y + Math.sin(t * u.s) * 2, cam.z + u.z); m.rotation.x += dt * u.s; m.rotation.y += dt * u.s * 1.3; });
    },
  };
}
