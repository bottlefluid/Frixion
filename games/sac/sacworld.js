// Steal a Character: the city. A raised conveyor runway down the middle with tiled walkways either side, four bases on
// each side right next to it (glass walls, 16 round pedestals that glow in their character's rarity colour, a cash
// button in front of each, red lasers across the door when it's locked), and a lobby at the south end with the Gear
// Shop and the Rebirth altar. Everything that never moves is merged into a few meshes, so it's cheap to draw.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { RUNWAY } from './sacdata.js';

export const BASE_COLORS = ['#ef5350', '#42a5f5', '#66bb6a', '#ffca28', '#ab47bc', '#26c6da', '#ff7043', '#ec407a'];
const BASE_Z = [-81, -27, 27, 81], FRONT = 18, DEPTH = 32, HALF = 24;
const GEO = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 20), ball: new THREE.IcosahedronGeometry(0.5, 1) };
const M = (x, y, z, sx, sy, sz, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));

// merge parts into one geometry (vertex colours, and uvs when the parts are textured)
const tc = new THREE.Color();
function merge(parts, uv) {
  let n = 0;
  const gs = parts.map(p => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone(); g.applyMatrix4(p.m); n += g.attributes.position.count; return { g, p }; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uvs = uv ? new Float32Array(n * 2) : null;
  let o = 0;
  for (const { g, p } of gs) {
    const k = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    tc.set(p.c); for (let i = 0; i < k; i++) { col[(o + i) * 3] = tc.r; col[(o + i) * 3 + 1] = tc.g; col[(o + i) * 3 + 2] = tc.b; }
    if (uv) { const a = g.attributes.uv.array; for (let i = 0; i < k; i++) { uvs[(o + i) * 2] = a[i * 2] * (p.ru || 1); uvs[(o + i) * 2 + 1] = a[i * 2 + 1] * (p.rv || 1); } }
    o += k; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.computeBoundingSphere();
  return out;
}
// small canvas textures
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
// a flat sign with text on it (it faces +z until it's turned)
function signPlane(text, w, h, bg, fg, sub) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * h / w);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const draw = (txt, color = bg, subText = sub) => {
    const g = c.getContext('2d'), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = color; roundRect(g, 6, 6, W - 12, H - 12, H * 0.22); g.fill();
    g.lineWidth = H * 0.06; g.strokeStyle = 'rgba(255,255,255,.85)'; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fg; g.lineJoin = 'round';
    g.font = `900 ${Math.round(H * (subText ? 0.42 : 0.55))}px "Segoe UI", system-ui, sans-serif`;
    g.lineWidth = H * 0.08; g.strokeStyle = 'rgba(0,0,0,.35)'; g.strokeText(txt, W / 2, H * (subText ? 0.42 : 0.52), W - 60); g.fillText(txt, W / 2, H * (subText ? 0.42 : 0.52), W - 60);
    if (subText) { g.font = `800 ${Math.round(H * 0.2)}px "Segoe UI", system-ui, sans-serif`; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(subText, W / 2, H * 0.78, W - 60); }
    t.needsUpdate = true;
  };
  draw(text);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
  m.userData.draw = draw;
  return m;
}
// the money waiting on a cash button
function moneyLabel() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 80;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); s.scale.set(3.4, 1.06, 1);
  s.userData.draw = text => {
    const g = c.getContext('2d'); g.clearRect(0, 0, 256, 80); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.font = '900 46px "Segoe UI", system-ui, sans-serif'; g.lineWidth = 9; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(text, 128, 42, 248); g.fillStyle = '#69f0ae'; g.fillText(text, 128, 42, 248);
    t.needsUpdate = true;
  };
  return s;
}
const mix = (a, b, k) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

export function createWorld(scene, quality) {
  const root = new THREE.Group(); scene.add(root);
  const shadows = quality !== 'low', colliders = [];
  const solid = [], floors = [], glass = [];
  // a block: drawn as part of a merged mesh, and solid unless told otherwise
  const block = (list, x, y, z, w, h, d, c, o = {}) => {
    list.push({ geo: o.geo || GEO.box, c, m: M(x, y + h / 2, z, w, h, d, o.ry || 0), ru: o.ru, rv: o.rv });
    if (o.solid !== false) colliders.push({ min: new THREE.Vector3(x - w / 2, y, z - d / 2), max: new THREE.Vector3(x + w / 2, y + h, z + d / 2) });
  };
  const box = (x, y, z, w, h, d, c, o) => block(solid, x, y, z, w, h, d, c, o);

  // ---- the sky and the light ----
  const skyTex = canvasTex(4, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2f8fff'); gr.addColorStop(0.42, '#8fd0ff'); gr.addColorStop(0.5, '#e4f5ff'); gr.addColorStop(1, '#e4f5ff'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1; scene.add(sky);
  scene.background = new THREE.Color('#bfe6ff'); scene.fog = new THREE.Fog('#d6efff', 170, 420);
  scene.add(new THREE.HemisphereLight('#ffffff', '#7aa860', 1.05));
  const sun = new THREE.DirectionalLight('#fff1d6', 1.55); sun.position.set(70, 140, 50);
  if (shadows) { sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 150, bottom: -150, near: 20, far: 360 }); sun.shadow.bias = -0.0005; }
  scene.add(sun); scene.add(sun.target);

  // ---- the ground: grass, the walkways and the lobby ----
  const grassTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#62b04c'; g.fillRect(0, 0, w, h); for (let i = 0; i < 260; i++) { g.fillStyle = Math.random() < 0.5 ? '#6cbd55' : '#58a243'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, true);
  grassTex.repeat.set(90, 90);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshLambertMaterial({ map: grassTex })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = shadows; root.add(ground);
  const tileImg = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#e3e5ea'; g.fillRect(0, 0, w, h); g.fillStyle = '#c9ccd4'; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h); g.fillStyle = '#eef0f4'; g.fillRect(6, 6, 24, 24); }, true);
  const walk = (x, z, w, d) => { const t = tileImg.clone(); t.needsUpdate = true; t.repeat.set(w / 4, d / 4); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: t })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.04, z); m.receiveShadow = shadows; root.add(m); };
  walk(0, 0, 36, 236); walk(0, -128, 80, 24);
  // the conveyor: red and raised, with arrows that move the way the characters walk, and rails either side
  const len = RUNWAY.end - RUNWAY.start, mid = (RUNWAY.start + RUNWAY.end) / 2;
  const beltTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#c62828'; g.fillRect(0, 0, w, h); g.fillStyle = '#e53935'; g.fillRect(4, 0, w - 8, h); g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.moveTo(14, 18); g.lineTo(32, 40); g.lineTo(50, 18); g.lineTo(42, 18); g.lineTo(32, 30); g.lineTo(22, 18); g.fill(); }, true);
  beltTex.repeat.set(1, len / 8);
  const belt = new THREE.Mesh(new THREE.PlaneGeometry(9, len), new THREE.MeshLambertMaterial({ map: beltTex })); belt.rotation.x = -Math.PI / 2; belt.position.set(0, 0.62, mid); belt.receiveShadow = shadows; root.add(belt);
  box(0, 0, mid, 9, 0.6, len, '#8e2020');
  for (const s of [-1, 1]) { box(s * 4.9, 0, mid, 0.8, 1.1, len, '#37474f'); box(s * 4.9, 1.1, mid, 0.82, 0.12, len, '#ffd54f', { solid: false }); }
  // an arch where they come in (a glowing door) and one where they leave
  for (const [z, c, txt] of [[RUNWAY.start - 1, '#7c4dff', 'STEAL A CHARACTER'], [RUNWAY.end + 1, '#ff4081', '']]) {
    box(-7.5, 0, z, 2, 12, 2, '#eceff1'); box(7.5, 0, z, 2, 12, 2, '#eceff1'); box(0, 12, z, 17, 2, 2.4, c, { solid: false });
    const door = new THREE.Mesh(new THREE.PlaneGeometry(13, 12), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })); door.position.set(0, 6, z); root.add(door);
    const glowM = new THREE.MeshBasicMaterial({ color: c });
    for (const [gx, gy, gw, gh] of [[-6.4, 6, 0.3, 12], [6.4, 6, 0.3, 12], [0, 11.85, 13, 0.3]]) { const f = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, 0.3), glowM); f.position.set(gx, gy, z); root.add(f); }
    if (txt) { const sg = signPlane(txt, 20, 3.2, c, '#ffffff', 'buy them, then steal the best'); sg.position.set(0, 15.8, z - 0.2); sg.rotation.y = Math.PI; root.add(sg); }
  }
  // lamps along the walkways
  for (let z = RUNWAY.start + 14; z < RUNWAY.end; z += 27) for (const s of [-1, 1]) { box(s * 15.5, 0, z, 0.45, 6.5, 0.45, '#455a64'); box(s * 15.5, 6.5, z, 1.3, 0.8, 1.3, '#fff59d', { solid: false }); }

  // ---- the bases ----
  const floorTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#e2e2e2'; g.fillRect(0, 0, w / 2, h / 2); g.fillRect(w / 2, h / 2, w / 2, h / 2); }, true);
  const ringGeo = new THREE.TorusGeometry(1.55, 0.14, 8, 32); ringGeo.rotateX(Math.PI / 2);
  const rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), 128);
  const cash = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.16, 1.5), new THREE.MeshLambertMaterial({ color: '#ffffff' }), 128);
  const bases = [], tmpM = new THREE.Matrix4(), dark = new THREE.Color('#263238'), cashC = new THREE.Color('#43a047');
  BASE_Z.forEach(cz => [-1, 1].forEach(side => {
    const i = bases.length, color = BASE_COLORS[i], front = side * FRONT, back = side * (FRONT + DEPTH), cx = side * (FRONT + DEPTH / 2);
    const x0 = Math.min(front, back), x1 = Math.max(front, back), z0 = cz - HALF, z1 = cz + HALF, light = mix(color, '#ffffff', 0.55);
    block(floors, cx, 0, cz, DEPTH, 0.3, HALF * 2, light, { ru: DEPTH / 4, rv: HALF / 2 });
    box(cx, 0.3, cz, DEPTH - 2, 0.02, 6, mix(color, '#ffffff', 0.15), { solid: false });   // the aisle
    // walls: solid at the back; low walls with glass on top along the sides
    box(back, 0, cz, 1, 8, HALF * 2, color);
    for (const z of [z0, z1]) {
      box(cx, 0, z, DEPTH, 2.4, 1, color);
      block(glass, cx, 2.4, z, DEPTH - 1, 5, 0.4, '#bfe9ff', { solid: false }); colliders.push({ min: new THREE.Vector3(x0, 2.4, z - 0.5), max: new THREE.Vector3(x1, 7.4, z + 0.5) });
      box(cx, 7.4, z, DEPTH, 0.5, 1.1, mix(color, '#000000', 0.2), { solid: false });
    }
    // the doorway: pillars, and a beam with the owner's sign
    box(front, 0, z0 + 1.2, 1.6, 9, 1.6, '#eceff1'); box(front, 0, z1 - 1.2, 1.6, 9, 1.6, '#eceff1'); box(front, 9, cz, 1.8, 1.4, HALF * 2, mix(color, '#000000', 0.15), { solid: false });
    // the owner's sign stands up on posts above the doorway, above where the camera usually is
    box(front, 10.4, z0 + 9, 0.6, 3.6, 0.6, '#eceff1', { solid: false }); box(front, 10.4, z1 - 9, 0.6, 3.6, 0.6, '#eceff1', { solid: false });
    const sign = signPlane('Free base', 18, 3, '#607d8b', '#ffffff'); sign.position.set(front - side * 0.4, 15.4, cz); sign.rotation.y = -side * Math.PI / 2; root.add(sign);
    // pedestals in two rows facing the aisle, a cash button in front of each
    const pads = [];
    for (let k = 0; k < 16; k++) {
      const row = k % 2, col = Math.floor(k / 2), x = front + side * (4.5 + col * 3.55), z = row ? z1 - 5 : z0 + 5, bz = row ? z - 3.2 : z + 3.2;
      box(x, 0.3, z, 3.1, 0.6, 3.1, '#f5f5f5', { geo: GEO.cyl });
      tmpM.makeTranslation(x, 0.93, z); rings.setMatrixAt(i * 16 + k, tmpM); rings.setColorAt(i * 16 + k, dark);
      tmpM.makeTranslation(x, 0.38, bz); cash.setMatrixAt(i * 16 + k, tmpM); cash.setColorAt(i * 16 + k, cashC);
      pads.push({ x, z, y: 0.9, yaw: row ? Math.PI : 0, button: { x, z: bz } });
    }
    // the lock button at the back
    const button = { x: back - side * 3.5, z: cz };
    box(button.x, 0.3, button.z, 2, 1.6, 2, '#455a64', { geo: GEO.cyl });
    box(button.x, 1.9, button.z, 1.4, 0.5, 1.4, '#e53935', { geo: GEO.cyl, solid: false });
    // the lasers across the door, when it's locked
    const field = new THREE.Group(); field.visible = false; root.add(field);
    const laserMat = new THREE.MeshBasicMaterial({ color: '#ff1744' });
    for (const y of [1.2, 2.8, 4.4, 6]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, HALF * 2 - 3, 6), laserMat); l.rotation.x = Math.PI / 2; l.position.set(front, y, cz); field.add(l); }
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 - 3, 8.5), new THREE.MeshBasicMaterial({ color: '#ff1744', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })); haze.rotation.y = Math.PI / 2; haze.position.set(front, 4.25, cz); field.add(haze);
    bases.push({ i, side, color, cx, cz, x0, x1, z0, z1, front, back, pads, button, field, sign, labels: [], spawn: new THREE.Vector3(front + side * 5, 0.3, cz) });
  }));
  rings.instanceMatrix.needsUpdate = true; rings.instanceColor.needsUpdate = true; root.add(rings);
  cash.instanceMatrix.needsUpdate = true; cash.instanceColor.needsUpdate = true; cash.receiveShadow = shadows; root.add(cash);

  // ---- the lobby: the Gear Shop and the Rebirth altar, as market stalls ----
  const stall = (x, z, c, c2) => {
    box(x, 0, z + 2.5, 10, 1.3, 2, '#8d6e63'); box(x, 1.3, z + 2.5, 10.4, 0.3, 2.4, '#a1887f', { solid: false });
    for (const [dx, dz] of [[-4.8, 4.5], [4.8, 4.5], [-4.8, 0.5], [4.8, 0.5]]) box(x + dx, 0, z + dz, 0.6, 6, 0.6, '#6d4c41');
    for (let k = 0; k < 5; k++) box(x - 4 + k * 2, 6, z + 2.5, 2, 0.5, 5.4, k % 2 ? c : c2, { solid: false });
  };
  const shop = { x: -16, z: -132, r: 7 }, rebirth = { x: 16, z: -132, r: 7 };
  stall(shop.x, shop.z, '#ff9800', '#fff3e0'); stall(rebirth.x, rebirth.z, '#7e57c2', '#ede7f6');
  const shopSign = signPlane('GEAR SHOP', 10, 2.2, '#ef6c00', '#ffffff'); shopSign.position.set(shop.x, 8.2, shop.z + 5.3); root.add(shopSign);
  const rbSign = signPlane('REBIRTH', 10, 2.2, '#5e35b1', '#ffffff'); rbSign.position.set(rebirth.x, 8.2, rebirth.z + 5.3); root.add(rbSign);
  const orb = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.25, 10, 40), new THREE.MeshBasicMaterial({ color: '#b388ff' })); orb.position.set(rebirth.x, 3.6, rebirth.z + 2.5); root.add(orb);

  // ---- trees, bushes and flowers round the outside ----
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 60; k++) {
    const s = k % 2 ? 1 : -1, x = s * (58 + rnd() * 70), z = -150 + rnd() * 280, h = 3 + rnd() * 2, c = rnd() < 0.5 ? '#2e7d32' : '#43a047';
    box(x, 0, z, 0.9, h, 0.9, '#6d4c41');
    box(x, h - 0.6, z, 5.2, 3.2, 5.2, c, { geo: GEO.ball, solid: false }); box(x, h + 1.6, z, 3.6, 2.6, 3.6, mix(c, '#ffffff', 0.12), { geo: GEO.ball, solid: false });
  }
  for (let k = 0; k < 70; k++) { const s = k % 2 ? 1 : -1, x = s * (54 + rnd() * 60), z = -140 + rnd() * 260; box(x, 0, z, 1.6 + rnd(), 1, 1.6 + rnd(), '#388e3c', { geo: GEO.ball, solid: false }); }
  for (let k = 0; k < 90; k++) { const x = (rnd() < 0.5 ? -1 : 1) * (20 + rnd() * 100), z = -150 + rnd() * 290; if (Math.abs(x) < 52 && Math.abs(z) < 108) continue; box(x, 0, z, 0.35, 0.5, 0.35, ['#ff8a80', '#fff59d', '#ffffff', '#ce93d8'][k % 4], { solid: false }); }

  // ---- merge it all ----
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadows; m.receiveShadow = shadows; root.add(m); return m; };
  add(merge(solid), new THREE.MeshLambertMaterial({ vertexColors: true }));
  add(merge(floors, true), new THREE.MeshLambertMaterial({ vertexColors: true, map: floorTex }));
  const gm = add(merge(glass), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false })); gm.castShadow = false;

  const ringColor = new THREE.Color();
  return {
    root, colliders, bases, shop, rebirth,
    bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 },
    spawn: new THREE.Vector3(0, 0, -126),
    inBase: (b, p) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1,
    setOwner(b, name, mine) { b.sign.userData.draw(name ? `${name}${mine ? ' (you)' : ''}` : 'Free base', name ? b.color : '#607d8b', name ? `Base ${b.i + 1}` : ''); },
    // a pedestal's ring: its character's rarity colour, grey when empty, dark when it isn't unlocked yet
    padState(b, k, state) { ringColor.set(state === 'locked' ? '#263238' : state === 'empty' ? '#b0bec5' : state); rings.setColorAt(b.i * 16 + k, ringColor); rings.instanceColor.needsUpdate = true; },
    // the money waiting on a pedestal's cash button (only shown in your own base)
    padLabel(b, k, text) {
      let s = b.labels[k];
      if (!text) { if (s) s.visible = false; return; }
      if (!s) { s = b.labels[k] = moneyLabel(); s.position.set(b.pads[k].button.x, 2.1, b.pads[k].button.z); root.add(s); }
      if (s.userData.text !== text) { s.userData.text = text; s.userData.draw(text); }
      s.visible = true;
    },
    update(dt) { beltTex.offset.y += dt * RUNWAY.speed / 8; orb.rotation.y += dt * 1.4; },
  };
}
