// Overcontrol RNG: what aura moves look like. castFx() draws one move for everyone to see (the game sends the same
// numbers to the other players, so a storm's bolts land in the same places on every screen), and hitTest() says who
// is caught in it. Damage only lands on players who have PvP on.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { glowTex } from './avatar.js';
import { seeded } from './data.js';

const add = THREE.AdditiveBlending;
const glowMat = (color, opacity = 0.9) => new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity, depthWrite: false, blending: add });
const basic = (color, opacity = 0.85, side = THREE.DoubleSide) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: add, side, depthWrite: false });
const dirOf = yaw => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
// where a move lands (meteor and vortex hit a spot in front of you)
export function targetOf(p) { const d = dirOf(p.yaw); return new THREE.Vector3(p.x + d.x * (p.dist || 0), p.y, p.z + d.z * (p.dist || 0)); }
export function stormPoints(p) {
  const r = seeded(p.seed || 1), out = [];
  for (let i = 0; i < (p.n || 6); i++) { const a = r() * Math.PI * 2, d = 3 + r() * (p.r || 12); out.push(new THREE.Vector3(p.x + Math.cos(a) * d, p.y, p.z + Math.sin(a) * d)); }
  return out;
}

// One effect: a group in the scene and an update(dt) that returns false when it is finished.
function fx(scene, life, build) {
  const g = new THREE.Group(); scene.add(g);
  const step = build(g);
  let t = 0;
  return {
    update(dt) {
      t += dt;
      const k = Math.min(1, t / life);
      step(k, dt, t);
      if (k >= 1) { scene.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); return false; }
      return true;
    },
  };
}
function ring(g, color, y, inner = 0.7, outer = 1.3) { const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 56), basic(color)); m.rotation.x = -Math.PI / 2; m.position.y = y; g.add(m); return m; }
function sprite(g, color, scale, opacity) { const s = new THREE.Sprite(glowMat(color, opacity)); s.scale.set(scale, scale, 1); g.add(s); return s; }
function bolt(g, color, from, to, jag = 1.6) {
  const pts = [], n = 9;
  for (let i = 0; i <= n; i++) { const p = from.clone().lerp(to, i / n); if (i && i < n) { p.x += (Math.random() - 0.5) * jag; p.z += (Math.random() - 0.5) * jag; } pts.push(p); }
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: add }));
  g.add(l); return l;
}

// p: { kind, x, y, z, yaw, c (colour), tier, r, len, w, dist, n, range, seed, dur, x2, y2, z2 (for dashes: where you ended up) }
export function castFx(scene, p) {
  const c = new THREE.Color(p.c || '#ffffff'), white = new THREE.Color('#ffffff');
  const big = 1 + (p.tier || 0) * 0.08;
  switch (p.kind) {
    case 'burst': return fx(scene, 0.55, g => {
      g.position.set(p.x, p.y + 0.3, p.z);
      const r1 = ring(g, c, 0), r2 = ring(g, white, 0.05, 0.85, 1.05), flash = sprite(g, c, 6 * big, 1); flash.position.y = 2.5;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 6, 28, 1, true), basic(c, 0.4)); col.position.y = 3; g.add(col);
      return k => { const s = 1 + k * p.r; r1.scale.setScalar(s); r2.scale.setScalar(s * 0.92); r1.material.opacity = 0.9 * (1 - k); r2.material.opacity = 1 - k; flash.material.opacity = 1 - k; col.scale.set(1 + k * 2, 1, 1 + k * 2); col.material.opacity = 0.4 * (1 - k); };
    });
    case 'orbs': return fx(scene, 0.75, g => {
      g.position.set(p.x, p.y + 2.6, p.z);
      const orbs = [];
      for (let i = 0; i < (p.n || 5); i++) {
        const a = p.yaw + ((i / Math.max(1, (p.n || 5) - 1)) - 0.5) * 0.7;
        const o = sprite(g, c, 2.2 * big, 1); const core = sprite(g, white, 0.9, 1);
        orbs.push({ o, core, d: dirOf(a) });
      }
      return k => orbs.forEach(({ o, core, d }) => { const dist = k * (p.range || 26); o.position.set(d.x * dist, Math.sin(k * Math.PI) * 0.8, d.z * dist); core.position.copy(o.position); o.material.opacity = k > 0.85 ? (1 - k) / 0.15 : 1; core.material.opacity = o.material.opacity; });
    });
    case 'beam': return fx(scene, 0.5, g => {
      const d = dirOf(p.yaw), len = p.len || 32;
      g.position.set(p.x + d.x * len / 2, p.y + 2.6, p.z + d.z * len / 2); g.rotation.y = p.yaw;
      const outer = new THREE.Mesh(new THREE.BoxGeometry(p.w || 2.4, p.w || 2.4, len), basic(c, 0.55)); g.add(outer);
      const core = new THREE.Mesh(new THREE.BoxGeometry((p.w || 2.4) * 0.35, (p.w || 2.4) * 0.35, len), basic(white, 0.95)); g.add(core);
      const tip = sprite(g, c, 7 * big, 1); tip.position.z = len / 2;
      return k => { const s = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85; outer.scale.set(s, s, 1); core.scale.set(s, s, 1); outer.material.opacity = 0.55 * s; core.material.opacity = 0.95 * s; tip.material.opacity = s; };
    });
    case 'meteor': return fx(scene, 1.3, g => {
      const at = targetOf(p); g.position.set(at.x, at.y, at.z);
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 * big, 0), new THREE.MeshBasicMaterial({ color: c })); g.add(rock);
      const trail = sprite(g, c, 6 * big, 0.9);
      const mark = ring(g, c, 0.2, (p.r || 8) - 0.6, p.r || 8); mark.material.opacity = 0.5;
      const boom = ring(g, white, 0.25), flash = sprite(g, c, 0.1, 0); flash.position.y = 2;
      return k => {
        const fall = Math.min(1, k / 0.5);
        rock.position.set(-12 * (1 - fall), 40 * (1 - fall) + 1, 0); trail.position.copy(rock.position); rock.visible = fall < 1; trail.visible = fall < 1;
        mark.material.opacity = 0.5 * (1 - fall * 0.3);
        if (fall >= 1) { const e = (k - 0.5) / 0.5; boom.scale.setScalar(1 + e * (p.r || 8)); boom.material.opacity = 1 - e; flash.scale.set(14 * big * (1 - e * 0.5), 14 * big * (1 - e * 0.5), 1); flash.material.opacity = 1 - e; mark.material.opacity = 0.4 * (1 - e); }
      };
    });
    case 'vortex': return fx(scene, p.dur || 2.4, g => {
      const at = targetOf(p); g.position.set(at.x, at.y + 0.4, at.z);
      const rings = [0, 1, 2].map(i => { const m = ring(g, i === 1 ? white : c, i * 1.2, 0.6, 1.1); return m; });
      const core = sprite(g, c, 8 * big, 0.9); core.position.y = 2;
      const dark = sprite(g, '#000000', 4, 0.6); dark.material.blending = THREE.NormalBlending; dark.position.y = 2;
      return (k, dt, t) => { rings.forEach((m, i) => { m.rotation.z = t * (3 + i); m.scale.setScalar((p.r || 9) * (0.4 + i * 0.25) * (1 - 0.3 * Math.sin(t * 6 + i))); m.material.opacity = 0.8 * (1 - k); }); core.material.opacity = 0.9 * (1 - k); dark.material.opacity = 0.6 * (1 - k); };
    });
    case 'storm': return fx(scene, 0.9, g => {
      const pts = stormPoints(p), parts = [];
      pts.forEach((pt, i) => {
        const delay = i * 0.08;
        const b = bolt(g, c, new THREE.Vector3(pt.x, 34, pt.z), new THREE.Vector3(pt.x, pt.y, pt.z), 2.4);
        const r = ring(g, c, pt.y + 0.2); r.position.x = pt.x; r.position.z = pt.z;
        const f = sprite(g, white, 5, 0); f.position.set(pt.x, pt.y + 1.5, pt.z);
        parts.push({ b, r, f, delay });
      });
      return (k, dt, t) => parts.forEach(({ b, r, f, delay }) => { const e = Math.max(0, Math.min(1, (t - delay) / 0.5)); b.visible = t >= delay && e < 0.6; b.material.opacity = 1 - e; r.scale.setScalar(1 + e * 3.5); r.material.opacity = t >= delay ? 1 - e : 0; f.material.opacity = t >= delay ? 1 - e : 0; });
    });
    case 'nova': return fx(scene, 1.1, g => {
      g.position.set(p.x, p.y + 0.3, p.z);
      const r1 = ring(g, c, 0, 0.8, 1.2), r2 = ring(g, white, 0.1, 0.9, 1.05), r3 = ring(g, c, 6, 0.9, 1.1);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 60, 32, 1, true), basic(c, 0.55)); pillar.position.y = 30; g.add(pillar);
      const flash = sprite(g, white, 2, 1); flash.position.y = 3;
      return k => { const s = 1 + Math.pow(k, 0.6) * (p.r || 18); r1.scale.setScalar(s); r2.scale.setScalar(s * 0.9); r3.scale.setScalar(s * 0.6); [r1, r2, r3].forEach(r => { r.material.opacity = 1 - k; }); pillar.scale.set(1 + k * 3, 1, 1 + k * 3); pillar.material.opacity = 0.55 * (1 - k); flash.scale.setScalar(4 + k * 40); flash.material.opacity = 1 - k; };
    });
    // a teleport (blink moves, portals, doors): a beam and a collapsing ring where you left, a flash and an
    // expanding ring where you arrive, and sparks streaming between the two, all in your aura's colour
    case 'blink': case 'tp': return fx(scene, 1.1, g => {
      const a = new THREE.Vector3(p.x, p.y, p.z), b = new THREE.Vector3(p.x2 ?? p.x, p.y2 ?? p.y, p.z2 ?? p.z), far = a.distanceTo(b) > 40;
      const end = (at, leaving) => {
        const h = new THREE.Group(); h.position.copy(at); g.add(h);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 14, 24, 1, true), basic(c, 0.6)); beam.position.y = 7; h.add(beam);
        const core = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 14, 12, 1, true), basic(white, 0.9)); core.position.y = 7; h.add(core);
        const r1 = ring(h, c, 0.12, 0.9, 1.4), r2 = ring(h, white, 0.16, 1.2, 1.45);
        const flash = sprite(h, leaving ? c : white, 2, 1); flash.position.y = 2.6;
        const bits = Array.from({ length: 14 }, (_, i) => { const s = sprite(h, i % 2 ? white : c, 0.9, 1); s.userData = { a: i / 14 * Math.PI * 2, r: 1 + Math.random() * 1.5, v: 4 + Math.random() * 6 }; return s; });
        return k => {
          const e = leaving ? k : Math.max(0, 1 - k * 1.3);
          beam.scale.set(leaving ? 1 - k : 0.4 + k, 1, leaving ? 1 - k : 0.4 + k); beam.material.opacity = 0.6 * (1 - k); core.material.opacity = 0.9 * (1 - k);
          const rs = leaving ? 3.2 * (1 - k) + 0.1 : 0.2 + k * 5; r1.scale.setScalar(rs); r2.scale.setScalar(rs * 0.85); r1.material.opacity = r2.material.opacity = 1 - k;
          flash.scale.setScalar(leaving ? 6 * (1 - k) + 0.1 : 2 + Math.sin(Math.min(1, k * 2) * Math.PI) * 9); flash.material.opacity = 1 - k;
          bits.forEach(s => { const u = s.userData, y = leaving ? 0.5 + e * u.v * 1.2 : 0.5 + (1 - k) * u.v; const rr = leaving ? u.r * (1 - k) : u.r * (1 + k * 2); s.position.set(Math.cos(u.a + k * 4) * rr, y, Math.sin(u.a + k * 4) * rr); s.material.opacity = 1 - k; });
        };
      };
      const leave = end(a, true), arrive = end(b, false);
      const streak = far ? null : Array.from({ length: 12 }, () => sprite(g, c, 1.4, 0.9));
      return k => {
        leave(k); arrive(k);
        if (streak) streak.forEach((s, i) => { const f = Math.min(1, k * 2.4 + i / 24); s.position.copy(a).lerp(b, f); s.position.y += 2.5 + Math.sin(f * Math.PI) * 1.5; s.material.opacity = Math.max(0, 0.9 - k * 1.4); });
      };
    });
    case 'dash': case 'leap': case 'flight': return fx(scene, p.kind === 'flight' ? (p.dur || 4) : 0.6, g => {
      const a = new THREE.Vector3(p.x, p.y + 2.5, p.z), b = new THREE.Vector3(p.x2 ?? p.x, (p.y2 ?? p.y) + 2.5, p.z2 ?? p.z);
      const puffs = [];
      const n = 10;
      for (let i = 0; i < n; i++) { const s = sprite(g, i % 2 ? white : c, 3, 0.9); s.position.copy(a.clone().lerp(b, i / (n - 1))); puffs.push(s); }
      return k => puffs.forEach(s => { s.material.opacity = 0.9 * (1 - k); });
    });
  }
  return null;
}

// Who a move catches. others: [{ uid, pos }]. Returns [{ uid, kx, kz }] with a knockback push.
export function hitTest(p, others) {
  const out = [], d = dirOf(p.yaw), push = 14 + (p.tier || 0) * 3;
  for (const o of others) {
    const dx = o.pos.x - p.x, dz = o.pos.z - p.z, dist = Math.hypot(dx, dz) || 0.001;
    let hit = false, kx = dx / dist * push, kz = dz / dist * push;
    if (p.kind === 'burst' || p.kind === 'nova') hit = dist <= p.r;
    else if (p.kind === 'orbs') { const along = dx * d.x + dz * d.z, side = Math.abs(dx * d.z - dz * d.x); hit = along > 0 && along < (p.range || 26) && side < 2.5 + along * 0.35; }
    else if (p.kind === 'beam') { const along = dx * d.x + dz * d.z, side = Math.abs(dx * d.z - dz * d.x); hit = along > 0 && along < (p.len || 32) && side < (p.w || 2.4) + 0.6; kx = d.x * push; kz = d.z * push; }
    else if (p.kind === 'meteor' || p.kind === 'vortex') {
      const at = targetOf(p), ex = o.pos.x - at.x, ez = o.pos.z - at.z, e = Math.hypot(ex, ez) || 0.001;
      hit = e <= (p.r || 8);
      if (p.kind === 'vortex') { kx = -ex / e * push * 0.8; kz = -ez / e * push * 0.8; } else { kx = ex / e * push; kz = ez / e * push; }
    } else if (p.kind === 'storm') {
      for (const pt of stormPoints(p)) { const e = Math.hypot(o.pos.x - pt.x, o.pos.z - pt.z); if (e < 3.2) { hit = true; kx = (o.pos.x - pt.x) / (e || 1) * push; kz = (o.pos.z - pt.z) / (e || 1) * push; break; } }
    }
    if (hit) out.push({ uid: o.uid, kx, kz });
  }
  return out;
}
