// Steal a Character: building a character out of blocks from its look (sacdata.js). The body, head, hat and extras
// are merged into one mesh with vertex colours, plus a face, so a base full of them stays cheap to draw. Mutations
// recolour them: Golden, Diamond, and Rainbow (which cycles through the colours).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { CHAR, MUTATIONS, RARITY, nameOf, priceOf, incomeOf, fmt } from './sacdata.js';
import { glowTex } from '../ocrng/avatar.js';

const GEO = { box: new THREE.BoxGeometry(1, 1, 1), ball: new THREE.SphereGeometry(0.5, 14, 10), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14), cone: new THREE.ConeGeometry(0.5, 1, 12), ring: new THREE.TorusGeometry(0.5, 0.08, 8, 24), plane: new THREE.PlaneGeometry(1, 1) };
const M = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const SCALE = { common: 1, uncommon: 1.05, rare: 1.1, epic: 1.18, legendary: 1.28, mythic: 1.38, secret: 1.5 };
// the body and head of each shape: [width, height, depth]
const SHAPES = {
  box: { body: [1.8, 1.8, 1.2], head: [1.5, 1.5, 1.5] },
  round: { body: [2.1, 2, 2], head: [1.6, 1.6, 1.6], round: true },
  tall: { body: [1.3, 2.6, 1], head: [1.2, 1.2, 1.2] },
  wide: { body: [2.6, 1.6, 1.6], head: [1.6, 1.3, 1.4] },
  tiny: { body: [1.2, 1.1, 0.9], head: [1.1, 1.1, 1.1] },
};

// merge the parts (a shared geometry, a colour and where it goes) into one geometry with vertex colours
const tmp = new THREE.Color();
function merge(parts) {
  let count = 0;
  const gs = parts.map(p => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone(); g.applyMatrix4(p.m); count += g.attributes.position.count; return { g, c: p.c }; });
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const { g, c } of gs) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    tmp.set(c); for (let i = 0; i < n; i++) col.set([tmp.r, tmp.g, tmp.b], (o + i) * 3);
    o += n; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
// a mutation's colours: Golden and Diamond pull every colour towards theirs; Rainbow towards white, and the material
// tints it through the colours
const TINT = { gold: ['#ffc933', 0.72], diamond: ['#a6f6ff', 0.7], rainbow: ['#ffffff', 0.55] };
const tint = (c, m) => (TINT[m] ? '#' + new THREE.Color(c).lerp(new THREE.Color(TINT[m][0]), TINT[m][1]).getHexString() : c);

// The parts of one character, in its own units (it stands on y = 0 facing +z)
function partsOf(def) {
  const L = def.look, S = SHAPES[L.shape] || SHAPES.box, P = [];
  const add = (geo, c, m) => P.push({ geo, c, m });
  const [bw, bh, bd] = S.body, [hw, hh, hd] = S.head, legH = 0.8;
  // legs and feet, arms
  add(GEO.box, L.accent === L.body ? '#333333' : shade(L.body, -0.25), M(-bw * 0.25, legH / 2, 0, 0.55, legH, 0.6));
  add(GEO.box, L.accent === L.body ? '#333333' : shade(L.body, -0.25), M(bw * 0.25, legH / 2, 0, 0.55, legH, 0.6));
  const by = legH + bh / 2;
  if (S.round) add(GEO.ball, L.body, M(0, by, 0, bw, bh, bd)); else add(GEO.box, L.body, M(0, by, 0, bw, bh, bd));
  add(GEO.box, L.body, M(-(bw / 2 + 0.22), by + bh * 0.1, 0, 0.42, bh * 0.75, 0.42, 0, 0, 0.12));
  add(GEO.box, L.body, M(bw / 2 + 0.22, by + bh * 0.1, 0, 0.42, bh * 0.75, 0.42, 0, 0, -0.12));
  // the head
  const hy = legH + bh + hh / 2 - (S.round ? 0.25 : 0);
  if (S.round) add(GEO.ball, L.head, M(0, hy, 0, hw, hh, hd)); else add(GEO.box, L.head, M(0, hy, 0, hw, hh, hd));
  const top = hy + hh / 2, A = L.accent;
  switch (L.hat) {
    case 'cap': add(GEO.box, A, M(0, top + 0.12, 0, hw * 1.02, 0.28, hd * 1.02)); add(GEO.box, A, M(0, top + 0.02, hd / 2 + 0.3, hw * 0.8, 0.1, 0.6)); break;
    case 'tophat': add(GEO.cyl, '#26262e', M(0, top + 0.05, 0, hw * 1.1, 0.1, hw * 1.1)); add(GEO.cyl, '#26262e', M(0, top + 0.55, 0, hw * 0.7, 0.95, hw * 0.7)); add(GEO.cyl, A, M(0, top + 0.2, 0, hw * 0.72, 0.18, hw * 0.72)); break;
    case 'crown': add(GEO.cyl, '#ffd54f', M(0, top + 0.18, 0, hw * 0.9, 0.36, hw * 0.9)); for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; add(GEO.cone, '#ffd54f', M(Math.cos(a) * hw * 0.38, top + 0.55, Math.sin(a) * hw * 0.38, 0.28, 0.45, 0.28)); } add(GEO.ball, '#e53935', M(0, top + 0.2, hw * 0.45, 0.22, 0.22, 0.22)); break;
    case 'antenna': add(GEO.cyl, '#cfd8dc', M(0, top + 0.45, 0, 0.08, 0.9, 0.08)); add(GEO.ball, A, M(0, top + 0.95, 0, 0.32, 0.32, 0.32)); break;
    case 'horns': add(GEO.cone, A, M(-hw * 0.32, top + 0.32, 0, 0.3, 0.7, 0.3, 0, 0, 0.35)); add(GEO.cone, A, M(hw * 0.32, top + 0.32, 0, 0.3, 0.7, 0.3, 0, 0, -0.35)); break;
    case 'halo': add(GEO.ring, '#fff59d', M(0, top + 0.55, 0, hw * 1.1, hw * 1.1, hw * 1.1, Math.PI / 2)); break;
    case 'leaf': add(GEO.box, '#2e7d32', M(0.15, top + 0.3, 0, 0.5, 0.08, 0.9, 0, 0.4, 0.5)); add(GEO.cyl, '#5d4037', M(0, top + 0.12, 0, 0.08, 0.3, 0.08)); break;
    case 'helmet': add(GEO.box, A, M(0, hy + hh * 0.18, 0, hw * 1.12, hh * 0.75, hd * 1.12)); add(GEO.box, '#37474f', M(0, hy + hh * 0.08, hd * 0.57, hw * 0.8, 0.12, 0.05)); add(GEO.box, '#e53935', M(0, top + 0.3, 0, 0.12, 0.4, hd * 0.9)); break;
    case 'wizard': add(GEO.cyl, A, M(0, top + 0.05, 0, hw * 1.3, 0.1, hw * 1.3)); add(GEO.cone, A, M(0, top + 0.85, 0, hw * 0.85, 1.6, hw * 0.85, 0, 0, 0.12)); add(GEO.ball, '#ffd54f', M(0.12, top + 0.6, hw * 0.35, 0.2, 0.2, 0.2)); break;
    case 'ears': add(GEO.box, A, M(-hw * 0.3, top + 0.25, 0, 0.32, 0.55, 0.22, 0, 0, 0.2)); add(GEO.box, A, M(hw * 0.3, top + 0.25, 0, 0.32, 0.55, 0.22, 0, 0, -0.2)); break;
    case 'bandana': add(GEO.box, A, M(0, top - 0.12, 0, hw * 1.06, 0.35, hd * 1.06)); add(GEO.box, A, M(0, top - 0.25, -hd / 2 - 0.2, 0.3, 0.3, 0.4, 0.5)); break;
    case 'band': add(GEO.box, A, M(0, hy + hh * 0.18, 0, hw * 1.05, 0.22, hd * 1.05)); add(GEO.box, A, M(0.2, hy + hh * 0.1, -hd / 2 - 0.35, 0.12, 0.18, 0.7, 0.3)); break;
  }
  const back = -bd / 2, side = bw / 2;
  switch (L.extra) {
    case 'cape': add(GEO.box, A, M(0, by + 0.05, back - 0.12, bw * 0.95, bh * 1.15, 0.12, 0.12)); break;
    case 'wings': add(GEO.box, A, M(-side - 0.5, by + 0.4, back - 0.2, 1.3, 0.9, 0.1, 0, 0.5, 0.35)); add(GEO.box, A, M(side + 0.5, by + 0.4, back - 0.2, 1.3, 0.9, 0.1, 0, -0.5, -0.35)); break;
    case 'tail': for (let i = 0; i < 3; i++) add(GEO.box, i === 2 ? A : L.body, M(0, legH + 0.3 - i * 0.05, back - 0.35 - i * 0.45, 0.4 - i * 0.08, 0.4 - i * 0.08, 0.5)); break;
    case 'shield': add(GEO.box, A, M(-side - 0.5, by, 0.25, 0.15, 1.3, 1.1)); add(GEO.box, '#e53935', M(-side - 0.6, by, 0.25, 0.05, 0.9, 0.25)); break;
    case 'sword': add(GEO.box, '#cfd8dc', M(side + 0.45, by + 0.6, 0.3, 0.12, 1.8, 0.22)); add(GEO.box, '#6d4c41', M(side + 0.45, by - 0.25, 0.3, 0.5, 0.12, 0.2)); break;
    case 'backpack': add(GEO.box, A, M(0, by + 0.1, back - 0.35, bw * 0.7, bh * 0.75, 0.6)); break;
    case 'spikes': for (let i = 0; i < 5; i++) add(GEO.cone, A, M((i - 2) * bw * 0.2, by + bh * 0.25 + (i % 2) * 0.2, back - 0.15, 0.3, 0.6, 0.3, -1.2)); break;
    case 'scarf': add(GEO.box, A, M(0, legH + bh - 0.05, 0, bw * 1.04, 0.32, bd * 1.04)); add(GEO.box, A, M(bw * 0.25, legH + bh - 0.5, bd / 2 + 0.05, 0.32, 0.8, 0.12)); break;
  }
  return { parts: P, height: top, headY: hy, head: S.head, round: !!S.round };
}
function shade(c, k) { const x = new THREE.Color(c); return '#' + (k < 0 ? x.lerp(new THREE.Color('#000000'), -k) : x.lerp(new THREE.Color('#ffffff'), k)).getHexString(); }

// the faces, drawn once each
const faces = new Map();
function faceTex(kind) {
  if (faces.has(kind)) return faces.get(kind);
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = '#1b1b1f'; g.strokeStyle = '#1b1b1f'; g.lineWidth = 9; g.lineCap = 'round';
  const eye = (x, y, r = 9) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  if (kind === 'cool') { g.fillRect(18, 38, 92, 26); g.fillRect(56, 42, 16, 8); g.beginPath(); g.arc(64, 82, 18, 0.2, Math.PI - 0.2); g.stroke(); }
  else if (kind === 'angry') { eye(42, 56); eye(86, 56); g.beginPath(); g.moveTo(26, 34); g.lineTo(54, 46); g.moveTo(102, 34); g.lineTo(74, 46); g.stroke(); g.beginPath(); g.arc(64, 100, 16, Math.PI + 0.3, -0.3); g.stroke(); }
  else if (kind === 'sleepy') { g.beginPath(); g.moveTo(30, 56); g.lineTo(54, 56); g.moveTo(74, 56); g.lineTo(98, 56); g.stroke(); g.beginPath(); g.arc(64, 86, 10, 0, Math.PI * 2); g.lineWidth = 6; g.stroke(); }
  else if (kind === 'wow') { eye(42, 50, 11); eye(86, 50, 11); g.beginPath(); g.ellipse(64, 90, 12, 16, 0, 0, Math.PI * 2); g.fill(); }
  else if (kind === 'pixel') { g.fillStyle = '#00e5ff'; g.fillRect(28, 38, 20, 20); g.fillRect(80, 38, 20, 20); g.fillRect(36, 80, 56, 10); g.fillRect(28, 72, 10, 10); g.fillRect(90, 72, 10, 10); }
  else if (kind === 'grin') { eye(42, 50); eye(86, 50); g.beginPath(); g.arc(64, 70, 30, 0.15, Math.PI - 0.15); g.closePath(); g.fill(); g.fillStyle = '#ffffff'; g.fillRect(44, 74, 40, 8); }
  else { eye(42, 52); eye(86, 52); g.beginPath(); g.arc(64, 72, 26, 0.25, Math.PI - 0.25); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; faces.set(kind, t); return t;
}

// what's written over them: the mutation, the name, the rarity, and the price (on the runway) or the income (on a pad)
const labels = new Map();
function labelTex(c, m, mode) {
  const key = `${c}:${m}:${mode}`;
  if (labels.has(key)) return labels.get(key);
  const def = CHAR[c], rar = RARITY[def.rarity], cv = document.createElement('canvas'); cv.width = 320; cv.height = 128;
  const g = cv.getContext('2d'); g.textAlign = 'center'; g.lineJoin = 'round';
  const line = (text, y, size, color, weight = 900) => { g.font = `${weight} ${size}px "Segoe UI", system-ui, sans-serif`; g.lineWidth = Math.max(4, size / 5); g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(text, 160, y, 310); g.fillStyle = color; g.fillText(text, 160, y, 310); };
  let y = 24;
  if (m) { line(MUTATIONS[m].name.toUpperCase(), y, 20, MUTATIONS[m].color); y += 26; } else y += 4;
  line(def.name, y + 6, 30, '#ffffff'); y += 34;
  line(rar.name, y + 2, 22, rar.color, 800); y += 30;
  line(mode === 'price' ? '$' + fmt(priceOf(c, m)) : '$' + fmt(incomeOf(c, m)) + '/s', y, 26, mode === 'price' ? '#69f0ae' : '#ffd54f');
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; labels.set(key, t); return t;
}

// one geometry per character and mutation, shared by every copy
const geos = new Map(), MAT = {}, faceMats = new Map();
function geoOf(c, m) {
  const key = `${c}:${m}`;
  if (!geos.has(key)) { const info = partsOf(CHAR[c]); geos.set(key, { geo: merge(info.parts.map(p => ({ ...p, c: tint(p.c, m) }))), info }); }
  return geos.get(key);
}
const matOf = m => MAT[m || 'none'] || (MAT[m || 'none'] = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: m === 'gold' ? '#4a3200' : m === 'diamond' ? '#0d4a52' : m === 'rainbow' ? '#222222' : '#000000' }));
const faceMat = kind => faceMats.get(kind) || faceMats.set(kind, new THREE.MeshBasicMaterial({ map: faceTex(kind), transparent: true, depthWrite: false })).get(kind);
let orbitGeo = null;

// A character: { group, update(dt, walking), setLabel(mode), dispose() }
export function makeCharacter(c, m = '', o = {}) {
  const def = CHAR[c], { geo, info } = geoOf(c, m), group = new THREE.Group(), inner = new THREE.Group(), s = SCALE[def.rarity] || 1;
  inner.scale.setScalar(s); group.add(inner);
  const body = new THREE.Mesh(geo, matOf(m)); body.castShadow = !!o.shadow; inner.add(body);
  const face = new THREE.Mesh(GEO.plane, faceMat(def.look.face));
  const [hw, hh, hd] = info.head;
  face.scale.set(hw * 0.86, hh * 0.86, 1); face.position.set(0, info.headY, (info.round ? hd * 0.47 : hd / 2) + 0.02); inner.add(face);
  let glow = null, orbit = null, bubble = null;
  if (def.look.extra === 'glow' || m === 'diamond' || m === 'rainbow' || def.rarity === 'secret') {
    glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: m ? MUTATIONS[m].color : def.look.accent, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(5, 5, 1); glow.position.y = info.height * 0.55; inner.add(glow);
  }
  if (def.look.extra === 'orbit') {
    if (!orbitGeo) orbitGeo = merge([0, 1, 2].map(i => ({ geo: GEO.ball, c: '#ffffff', m: M(Math.cos(i / 3 * Math.PI * 2) * 1.8, 0, Math.sin(i / 3 * Math.PI * 2) * 1.8, 0.45, 0.45, 0.45) })));
    orbit = new THREE.Mesh(orbitGeo, new THREE.MeshBasicMaterial({ color: tint(def.look.accent, m) })); orbit.position.y = info.height * 0.5; inner.add(orbit);
  }
  if (def.look.hat === 'bubble') { bubble = new THREE.Mesh(GEO.ball, new THREE.MeshLambertMaterial({ color: '#cdeeff', transparent: true, opacity: 0.35, depthWrite: false })); bubble.scale.setScalar(hw * 1.5); bubble.position.y = info.headY; inner.add(bubble); }
  let label = null;
  const setLabel = mode => {
    if (label) { inner.remove(label); label.material.dispose(); label = null; }
    if (!mode) return;
    label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(c, m, mode), transparent: true, depthWrite: false }));
    label.scale.set(5.2, 2.08, 1); label.position.y = info.height + 1.9 / s; label.scale.multiplyScalar(1 / s); label.renderOrder = 5; inner.add(label);
  };
  if (o.label) setLabel(o.label);
  let t = Math.random() * 10;
  return {
    group, c, m, height: info.height * s,
    setLabel,
    update(dt, walking) {
      t += dt;
      inner.position.y = walking ? Math.abs(Math.sin(t * 9)) * 0.35 : Math.sin(t * 2.2) * 0.08;
      inner.rotation.z = walking ? Math.sin(t * 9) * 0.06 : 0;
      if (orbit) orbit.rotation.y += dt * 2.4;
      if (glow) glow.material.opacity = 0.45 + Math.sin(t * 3) * 0.12;
    },
    dispose() { if (label) label.material.dispose(); if (glow) glow.material.dispose(); if (orbit) orbit.material.dispose(); if (bubble) bubble.material.dispose(); group.parent && group.parent.remove(group); },
  };
}
// Rainbow characters cycle through the colours together
export function tickRainbow(t) { if (MAT.rainbow) MAT.rainbow.color.setHSL((t * 0.15) % 1, 0.9, 0.62); }
