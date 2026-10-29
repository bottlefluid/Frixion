// Steal a Character: the map. A runway down the middle where the characters parade, four bases on each side (16 pads
// along their walls, a collector plate at the front and a force field for when they're locked), the Gear Shop and the
// Rebirth altar at the far end, and trees all round.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { RUNWAY } from './sacdata.js';

export const BASE_COLORS = ['#ef5350', '#42a5f5', '#66bb6a', '#ffca28', '#ab47bc', '#26c6da', '#ff7043', '#ec407a'];
const BASE_Z = [-84, -28, 28, 84];

function label(text, color, w = 512, h = 128, size = 64) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const draw = (txt, col = color) => {
    const g = c.getContext('2d'); g.clearRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.font = `900 ${size}px "Segoe UI", system-ui, sans-serif`; g.lineWidth = size / 6; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(txt, w / 2, h / 2, w - 16); g.fillStyle = col; g.fillText(txt, w / 2, h / 2, w - 16);
    t.needsUpdate = true;
  };
  draw(text);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.userData.draw = draw;
  return s;
}

export function createWorld(scene, quality) {
  const root = new THREE.Group(); scene.add(root);
  const colliders = [], mats = new Map();
  const mat = c => mats.get(c) || mats.set(c, new THREE.MeshLambertMaterial({ color: c })).get(c);
  const shadows = quality !== 'low';
  // a block; solid ones are added to the colliders
  const box = (x, y, z, w, h, d, color, solid = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color)); m.position.set(x, y + h / 2, z); m.castShadow = shadows && h > 1; m.receiveShadow = shadows; root.add(m);
    if (solid) colliders.push({ min: new THREE.Vector3(x - w / 2, y, z - d / 2), max: new THREE.Vector3(x + w / 2, y + h, z + d / 2) });
    return m;
  };

  // light and sky
  scene.background = new THREE.Color('#8fd3ff'); scene.fog = new THREE.Fog('#8fd3ff', 140, 360);
  scene.add(new THREE.HemisphereLight('#ffffff', '#5d8a4a', 0.95));
  const sun = new THREE.DirectionalLight('#fff4dc', 1.5); sun.position.set(60, 120, 40);
  if (shadows) { sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 10, far: 320 }); }
  scene.add(sun);

  // the ground, the plaza and the runway
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), mat('#6dbb4f')); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = shadows; root.add(ground);
  box(0, -0.2, 0, 24, 0.25, 250, '#d9d4c7', false);
  const stripes = document.createElement('canvas'); stripes.width = 64; stripes.height = 64;
  { const g = stripes.getContext('2d'); g.fillStyle = '#3a3f4b'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#4a5160'; g.beginPath(); g.moveTo(8, 14); g.lineTo(32, 42); g.lineTo(56, 14); g.lineTo(46, 14); g.lineTo(32, 30); g.lineTo(18, 14); g.fill(); }
  const runTex = new THREE.CanvasTexture(stripes); runTex.wrapS = runTex.wrapT = THREE.RepeatWrapping; runTex.repeat.set(2, (RUNWAY.end - RUNWAY.start) / 6); runTex.colorSpace = THREE.SRGBColorSpace;
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(12, RUNWAY.end - RUNWAY.start), new THREE.MeshLambertMaterial({ map: runTex })); runway.rotation.x = -Math.PI / 2; runway.position.set(0, 0.07, 0); runway.receiveShadow = shadows; root.add(runway);
  for (const s of [-1, 1]) box(s * 6.3, 0, 0, 0.6, 0.35, RUNWAY.end - RUNWAY.start, '#ffd54f', false);
  // an arch at each end of the runway
  for (const [z, c] of [[RUNWAY.start - 2, '#7c4dff'], [RUNWAY.end + 2, '#ff4081']]) {
    box(-8, 0, z, 1.6, 11, 1.6, '#eceff1'); box(8, 0, z, 1.6, 11, 1.6, '#eceff1'); box(0, 11, z, 17.6, 1.6, 1.6, c, false);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(14.4, 11), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false })); glow.position.set(0, 5.5, z); root.add(glow);
  }
  const startSign = label('STEAL A CHARACTER', '#ffffff', 1024, 160, 96); startSign.scale.set(26, 4, 1); startSign.position.set(0, 15.5, RUNWAY.start - 2); root.add(startSign);

  // the bases: four on each side, open towards the runway
  const bases = [];
  BASE_Z.forEach(cz => [-1, 1].forEach(side => {
    const i = bases.length, color = BASE_COLORS[i], front = side * 32, back = side * 68, cx = side * 50;
    const x0 = Math.min(front, back), x1 = Math.max(front, back), z0 = cz - 24, z1 = cz + 24;
    box(cx, 0, cz, 36, 0.3, 48, '#f3efe6');   // the floor (you walk on it)
    box(cx, 0.3, cz, 34, 0.02, 4, color, false);   // the aisle stripe
    box(back, 0, cz, 1.2, 9, 48, color); box(cx, 0, z0, 36, 9, 1.2, color); box(cx, 0, z1, 36, 9, 1.2, color);
    box(front, 0, z0 + 1.5, 1.6, 10, 1.6, '#eceff1'); box(front, 0, z1 - 1.5, 1.6, 10, 1.6, '#eceff1'); box(front, 10, cz, 1.6, 1.4, 48, color, false);
    // pads along the side walls, facing the aisle: 0-7 at the front, 8-15 at the back
    const pads = [];
    for (let k = 0; k < 16; k++) {
      const row = k % 2, col = Math.floor(k / 2), x = front + side * (5 + col * 4.2), z = row ? z1 - 5 : z0 + 5;
      const pad = box(x, 0.3, z, 3.6, 0.35, 3.6, '#cfd8dc', false);
      pads.push({ x, z, yaw: row ? Math.PI : 0, mesh: pad });
    }
    // the collector plate at the front, the lock button at the back
    const plate = { x: front + side * 4, z: cz };
    const pm = box(plate.x, 0.3, plate.z, 4.6, 0.3, 4.6, '#43a047', false);
    const plateSign = label('$0', '#69f0ae', 512, 128, 80); plateSign.scale.set(6, 1.5, 1); plateSign.position.set(plate.x, 2.6, plate.z); root.add(plateSign);
    const button = { x: back - side * 3, z: cz };
    box(button.x, 0.3, button.z, 2.2, 1.2, 2.2, '#455a64');
    const knob = box(button.x, 1.5, button.z, 1.4, 0.5, 1.4, '#ef5350', false);
    // the force field, when it's locked
    const field = new THREE.Mesh(new THREE.BoxGeometry(36, 14, 48), new THREE.MeshBasicMaterial({ color: '#4fc3ff', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    field.position.set(cx, 7, cz); field.visible = false; root.add(field);
    const sign = label('Free base', '#ffffff', 512, 128, 64); sign.scale.set(14, 3.5, 1); sign.position.set(front, 14, cz); root.add(sign);
    bases.push({ i, side, color, cx, cz, x0, x1, z0, z1, front, back, pads, plate, plateMesh: pm, plateSign, button, knob, field, sign, spawn: new THREE.Vector3(front + side * 17, 0.3, cz) });
  }));

  // the Gear Shop and the Rebirth altar, at the far end of the runway
  const shop = { x: -18, z: RUNWAY.end + 14, r: 8 };
  box(shop.x, 0, shop.z + 3, 12, 6, 2, '#8d6e63'); box(shop.x, 0, shop.z, 12, 1.4, 1.2, '#a1887f'); box(shop.x - 5.5, 0, shop.z + 1.5, 1, 6, 1, '#6d4c41'); box(shop.x + 5.5, 0, shop.z + 1.5, 1, 6, 1, '#6d4c41');
  box(shop.x, 6, shop.z + 1.5, 13, 0.8, 4.5, '#ffa726', false);
  const shopSign = label('GEAR SHOP', '#ffd54f', 512, 128, 76); shopSign.scale.set(12, 3, 1); shopSign.position.set(shop.x, 9, shop.z + 1); root.add(shopSign);
  const rebirth = { x: 18, z: RUNWAY.end + 14, r: 8 };
  box(rebirth.x, 0, rebirth.z, 6, 1.2, 6, '#5e35b1');
  const ringM = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.3, 10, 40), new THREE.MeshBasicMaterial({ color: '#b388ff' })); ringM.position.set(rebirth.x, 4.5, rebirth.z); root.add(ringM);
  const rbSign = label('REBIRTH', '#b388ff', 512, 128, 76); rbSign.scale.set(10, 2.5, 1); rbSign.position.set(rebirth.x, 8.6, rebirth.z); root.add(rbSign);

  // trees and lamps
  const rnd = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  for (let k = 0; k < 46; k++) {
    const side = k % 2 ? 1 : -1, x = side * (84 + rnd() * 50), z = -170 + rnd() * 340;
    box(x, 0, z, 1.6, 5, 1.6, '#795548');
    const leaves = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 6), mat(rnd() < 0.5 ? '#2e7d32' : '#388e3c')); leaves.position.set(x, 7, z); leaves.castShadow = shadows; root.add(leaves);
  }
  for (let z = RUNWAY.start + 10; z < RUNWAY.end; z += 28) for (const s of [-1, 1]) { box(s * 10, 0, z, 0.5, 6, 0.5, '#37474f'); box(s * 10, 6, z, 1.2, 0.8, 1.2, '#fff59d', false); }

  const ringSpin = dt => { ringM.rotation.y += dt * 1.4; };
  return {
    root, colliders, bases, shop, rebirth,
    bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 },
    spawn: new THREE.Vector3(0, 0.3, RUNWAY.start - 10),
    inBase: (b, p) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1,
    setOwner(b, name, mine) { b.sign.userData.draw(name ? `${name}${mine ? ' (you)' : ''}` : 'Free base', name ? '#ffffff' : '#9e9e9e'); },
    update(dt) { ringSpin(dt); runTex.offset.y += dt * RUNWAY.speed / 6; },
  };
}
