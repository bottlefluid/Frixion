// Overcontrol RNG: the blocky players, the title over their heads, and every aura's effects.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { auraKey, tierIndex } from './data.js';

// ---------------- textures drawn once on canvases ----------------
const texCache = {};
function canvasTex(key, w, h, draw) {
  if (texCache[key]) return texCache[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (texCache[key] = t);
}
export const glowTex = () => canvasTex('glow', 64, 64, (g, w) => {
  const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.75)'); r.addColorStop(0.6, 'rgba(255,255,255,.18)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, w);
});
const ringTex = (runes, rays, half) => canvasTex(`ring${runes}${rays}${half}`, 256, 256, (g, w) => {
  const c = w / 2;
  if (half) {   // yin and yang: a white half and a black half
    g.lineWidth = 14;
    g.strokeStyle = 'rgba(255,255,255,1)'; g.beginPath(); g.arc(c, c, 100, -Math.PI / 2, Math.PI / 2); g.stroke();
    g.strokeStyle = 'rgba(10,10,10,1)'; g.beginPath(); g.arc(c, c, 100, Math.PI / 2, Math.PI * 1.5); g.stroke();
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(c, c, 84, 0, Math.PI * 2); g.stroke();
  } else {
    const r = g.createRadialGradient(c, c, 70, c, c, 120);
    r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.45, 'rgba(255,255,255,.9)'); r.addColorStop(0.55, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.beginPath(); g.arc(c, c, 120, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(c, c, 72, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = 'source-over';
  }
  if (runes) {   // little marks around the circle, like a summoning ring
    g.fillStyle = half ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,1)';
    for (let i = 0; i < 16; i++) {
      g.save(); g.translate(c, c); g.rotate((i / 16) * Math.PI * 2); g.translate(0, -66);
      g.fillRect(-3, -6, 6, 12); g.fillRect(-7, -2, 14, 3);
      g.restore();
    }
  }
  if (rays) {
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 4;
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; g.beginPath(); g.moveTo(c + Math.cos(a) * 112, c + Math.sin(a) * 112); g.lineTo(c + Math.cos(a) * 127, c + Math.sin(a) * 127); g.stroke(); }
  }
});
const pillarTex = () => canvasTex('pillar', 16, 128, (g, w, h) => {
  const r = g.createLinearGradient(0, h, 0, 0);
  r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(0.5, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, h);
});
const wingTex = () => canvasTex('wing', 128, 256, (g) => {
  // a wing shape: long feathers fanning out, brightest near the body
  for (let i = 0; i < 7; i++) {
    const a = -0.15 - i * 0.16, len = 210 - i * 18;
    g.save(); g.translate(8, 70 + i * 6); g.rotate(a + Math.PI / 2.1);
    const gr = g.createLinearGradient(0, 0, len, 0);
    gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(len / 2, 0, len / 2, 13 - i, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
});
const faceTex = (skin) => canvasTex('face' + skin, 64, 64, (g, w) => {
  g.fillStyle = skin; g.fillRect(0, 0, w, w);
  g.fillStyle = '#111';
  g.beginPath(); g.ellipse(22, 26, 3.5, 6, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(42, 26, 3.5, 6, 0, 0, Math.PI * 2); g.fill();
  g.lineWidth = 3.5; g.strokeStyle = '#111'; g.lineCap = 'round';
  g.beginPath(); g.arc(32, 36, 12, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
});

// ---------------- the name over your head: your aura's title, then your name ----------------
export function titleStyle(g, aura, x, y, w) {
  const t = aura.title || {};
  if (t.bw) {
    const gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.49, '#ffffff'); gr.addColorStop(0.51, '#0a0a0a'); gr.addColorStop(1, '#0a0a0a');
    return gr;
  }
  if (t.rainbow) {
    const gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#b388ff', '#ff4081'].forEach((c, i, a) => gr.addColorStop(i / (a.length - 1), c));
    return gr;
  }
  if (t.gold) { const gr = g.createLinearGradient(0, y - 30, 0, y + 10); gr.addColorStop(0, '#fff6c2'); gr.addColorStop(0.5, '#ffcc33'); gr.addColorStop(1, '#e08a00'); return gr; }
  if (t.violet) { const gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0); gr.addColorStop(0, '#e9dcff'); gr.addColorStop(0.5, '#9c6bff'); gr.addColorStop(1, '#e9dcff'); return gr; }
  return aura.c;
}
export function makeNameTag(name, key) {
  const c = document.createElement('canvas'); c.width = 768; c.height = 192;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(7.2, 1.8, 1);
  sprite.renderOrder = 10;
  sprite.userData.draw = (nm, k, hp) => {
    const { aura, mut, name: auraName } = auraKey(k);
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.textAlign = 'center';
    const tier = tierIndex(auraKey(k).rarity);
    // aura title
    g.font = `900 ${tier >= 5 ? 64 : 58}px "Segoe UI", system-ui, sans-serif`;
    const w = Math.min(740, g.measureText(auraName).width);
    g.lineJoin = 'round';
    g.lineWidth = 10; g.strokeStyle = aura.title && aura.title.bw ? '#7a7a7a' : 'rgba(0,0,0,.75)';
    g.shadowColor = mut ? mut.color : aura.c; g.shadowBlur = 8 + tier * 4;
    g.strokeText(auraName, 384, 78, 740);
    g.shadowBlur = 0;
    g.fillStyle = titleStyle(g, aura, 384, 78, w);
    g.fillText(auraName, 384, 78, 740);
    // name
    g.font = '700 42px "Segoe UI", system-ui, sans-serif';
    g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(nm, 384, 140, 700);
    g.fillStyle = '#ffffff'; g.fillText(nm, 384, 140, 700);
    // health while PvP is on
    if (hp != null) {
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(234, 158, 300, 18);
      g.fillStyle = hp > 50 ? '#43d17a' : hp > 25 ? '#ffc107' : '#ff4d4d'; g.fillRect(237, 161, 294 * Math.max(0, hp) / 100, 12);
    }
    tex.needsUpdate = true;
  };
  sprite.userData.draw(name, key, null);
  return sprite;
}

// ---------------- the player model: Roblox-style blocks, 5 studs tall ----------------
const SKIN = '#f5cd30';
const boxMat = color => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05 });
export function shirtColorFor(name) {
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.55, 0.5).getStyle();
}
export function buildAvatar(name, shirt) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const mk = (w, h, d, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const skin = boxMat(SKIN), shirtM = boxMat(shirt), pants = boxMat('#2b3a67');
  const torso = mk(2, 2, 1, shirtM); torso.position.y = 3; body.add(torso);
  const limb = (x, y, mat) => { const pivot = new THREE.Group(); pivot.position.set(x, y, 0); const m = mk(1, 2, 1, mat); m.position.y = -1; pivot.add(m); body.add(pivot); return pivot; };
  const legL = limb(-0.5, 2, pants), legR = limb(0.5, 2, pants), armL = limb(-1.5, 4, skin), armR = limb(1.5, 4, skin);
  const headMats = [skin, skin, skin, skin, new THREE.MeshStandardMaterial({ map: faceTex(SKIN), roughness: 0.7 }), skin];
  const head = mk(1.25, 1.25, 1.25, headMats); head.position.y = 4.65; body.add(head);
  const tag = makeNameTag(name, 'common'); tag.position.y = 6.9; root.add(tag);
  const fxHolder = new THREE.Group(); root.add(fxHolder);
  let walk = 0, clock = 0;
  return {
    root, body, tag, fxHolder, head,
    // emote: 'dance' or 'wave' (from the chat's /e commands), shown while standing still
    animate(dt, speed, airborne, emote) {
      walk += dt * Math.min(speed, 24) * 0.55; clock += dt;
      armL.rotation.z = 0; armR.rotation.z = 0; body.rotation.y = 0; body.position.y = 0;
      if (emote && speed < 1 && !airborne) {
        if (emote === 'dance') {
          const b = Math.sin(clock * 9);
          armL.rotation.x = -2.6 + b * 0.5; armR.rotation.x = -2.6 - b * 0.5; armL.rotation.z = -0.4; armR.rotation.z = 0.4;
          legL.rotation.x = Math.max(0, b) * 0.6; legR.rotation.x = Math.max(0, -b) * 0.6;
          body.position.y = Math.abs(b) * 0.35; body.rotation.y = Math.sin(clock * 4.5) * 0.5;
        } else {
          armR.rotation.x = -2.9; armR.rotation.z = 0.35 + Math.sin(clock * 10) * 0.35; armL.rotation.x = 0; legL.rotation.x = 0; legR.rotation.x = 0;
        }
        return;
      }
      const s = airborne ? 0.6 : Math.min(1, speed / 10) * Math.sin(walk);
      legL.rotation.x = s * 0.9; legR.rotation.x = -s * 0.9;
      armL.rotation.x = airborne ? -2.6 : -s * 0.9; armR.rotation.x = airborne ? -2.6 : s * 0.9;
    },
    dispose() { root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); },
  };
}

// ---------------- aura effects ----------------
const rnd = (a, b) => a + Math.random() * (b - a);
const blend = dark => (dark ? THREE.NormalBlending : THREE.AdditiveBlending);

// Particles drawn as soft glowing dots. mode decides how they move.
class Dots {
  constructor(spec, mode) {
    this.spec = spec; this.mode = mode;
    this.n = spec.n || (mode === 'flames' ? 40 : mode === 'sparkle' ? 30 : mode === 'spiral' ? 50 : 24);
    if (spec.big) this.n = Math.round(this.n * 1.6);
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.n * 3); this.col = new Float32Array(this.n * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const dark = spec.dark || spec.bw;
    this.mat = new THREE.PointsMaterial({ size: spec.size || (mode === 'flames' ? 0.55 : mode === 'fall' && spec.rain ? 0.25 : 0.42), map: glowTex(), vertexColors: true, transparent: true, depthWrite: false, blending: blend(dark), opacity: dark ? 0.9 : 1 });
    this.obj = new THREE.Points(geo, this.mat);
    this.obj.frustumCulled = false;
    this.base = new THREE.Color(spec.c || '#ffffff'); this.base2 = new THREE.Color(spec.c2 || spec.c || '#ffffff');
    this.p = Array.from({ length: this.n }, (_, i) => this.spawn({}, i, true));
  }
  spawn(p, i, first) {
    const s = this.spec, m = this.mode;
    p.i = i; p.ph = Math.random() * 6.28; p.life = 0;
    if (m === 'motes' || m === 'rainbow') { p.a = rnd(0, 6.28); p.r = rnd(0.9, s.orbit ? 2.2 : 2.4); p.y = first ? rnd(0, 5.5) : 0; p.vy = rnd(0.4, 1.1); p.va = rnd(-0.6, 0.6); }
    else if (m === 'flames') { p.a = rnd(0, 6.28); p.r = rnd(0, s.big ? 1.9 : 1.3); p.y = first ? rnd(0, 3) : rnd(0, 0.3); p.vy = rnd(2, s.big ? 5 : 3.6); p.max = rnd(0.7, 1.4); p.life = first ? rnd(0, p.max) : 0; }
    else if (m === 'fall') { p.a = rnd(0, 6.28); p.r = rnd(0.3, 2.6); p.y = first ? rnd(0, 7) : rnd(6.2, 7.5); p.vy = -(s.rain ? rnd(8, 11) : s.code ? rnd(2.5, 4) : s.drip ? rnd(1.6, 2.6) : s.leaf ? rnd(0.8, 1.4) : rnd(0.7, 1.2)); p.sway = rnd(0.5, 1.5); }
    else if (m === 'sparkle') { p.a = rnd(0, 6.28); p.r = rnd(0.5, 2.6); p.y = rnd(0.4, 5.8); p.tw = rnd(2, 6); }
    else if (m === 'spiral') { p.a0 = rnd(0, 6.28); p.y = first ? rnd(0, 6) : 0; p.vy = rnd(1, 2.2) * (s.fast ? 1.8 : 1); p.r = s.galaxy ? rnd(0.3, 3.2) : (s.wide ? 2.4 : 1.6) + rnd(-0.2, 0.2); }
    return p;
  }
  update(dt, t) {
    const s = this.spec, m = this.mode, P = this.pos, C = this.col, c = new THREE.Color();
    for (const p of this.p) {
      let x = 0, y = 0, z = 0, k = 1;
      if (m === 'motes' || m === 'rainbow') {
        p.y += p.vy * dt; p.a += p.va * dt + (s.orbit ? dt * 1.5 : 0);
        if (p.y > 5.8) this.spawn(p, p.i);
        x = Math.cos(p.a) * p.r; z = Math.sin(p.a) * p.r; y = p.y;
        k = Math.min(1, p.y / 0.6) * Math.min(1, (5.8 - p.y) / 1.2);
        if (m === 'rainbow') c.setHSL(((t * 0.25 + p.i / this.n) % 1), 1, 0.6); else c.copy(this.base);
      } else if (m === 'flames') {
        p.life += dt; if (p.life > p.max) this.spawn(p, p.i);
        p.y += p.vy * dt; const f = p.life / p.max;
        x = Math.cos(p.a) * p.r * (1 - f * 0.6); z = Math.sin(p.a) * p.r * (1 - f * 0.6); y = p.y;
        c.copy(this.base).lerp(this.base2, f); k = 1 - f;
      } else if (m === 'fall') {
        p.y += p.vy * dt; if (p.y < 0) this.spawn(p, p.i);
        const sw = s.rain || s.code || s.drip ? 0 : Math.sin(t * p.sway + p.ph) * 0.35;
        x = Math.cos(p.a) * p.r + sw; z = Math.sin(p.a) * p.r; y = p.y;
        c.copy(this.base); if (s.code) k = 0.4 + 0.6 * ((Math.sin(t * 20 + p.ph) + 1) / 2);
      } else if (m === 'sparkle') {
        x = Math.cos(p.a) * p.r; z = Math.sin(p.a) * p.r; y = p.y + Math.sin(t + p.ph) * 0.15;
        k = Math.max(0, Math.sin(t * p.tw + p.ph)); k *= k;
        if (k < 0.01 && Math.random() < 0.02) { p.a = rnd(0, 6.28); p.r = rnd(0.5, 2.6); p.y = rnd(0.4, 5.8); }
        c.copy(this.base);
      } else if (m === 'spiral') {
        if (s.galaxy) {
          const arm = p.i % 3, a = p.a0 * 0.2 + arm * 2.094 + p.r * 0.9 - t * 0.8;
          x = Math.cos(a) * p.r; z = Math.sin(a) * p.r; y = 2.6 + Math.sin(p.ph + t) * 0.08;
          c.copy(this.base).lerp(new THREE.Color('#ffffff'), 1 - p.r / 3.2);
        } else {
          p.y += p.vy * dt; if (p.y > 6.2) this.spawn(p, p.i);
          const a = p.a0 + p.y * 1.4 + t * (s.fast ? 3 : 1.6);
          x = Math.cos(a) * p.r; z = Math.sin(a) * p.r; y = p.y;
          k = Math.min(1, p.y / 0.5) * Math.min(1, (6.2 - p.y) / 1);
          c.copy(s.bw ? new THREE.Color(p.i % 2 ? '#ffffff' : '#050505') : this.base);
        }
      }
      P[p.i * 3] = x; P[p.i * 3 + 1] = y; P[p.i * 3 + 2] = z;
      const dark = s.dark || (s.bw && p.i % 2 === 0);
      const kk = dark ? 1 : k;
      C[p.i * 3] = c.r * kk; C[p.i * 3 + 1] = c.g * kk; C[p.i * 3 + 2] = c.b * kk;
    }
    this.obj.geometry.attributes.position.needsUpdate = true;
    this.obj.geometry.attributes.color.needsUpdate = true;
  }
}

function glowSprite(color, scale, dark) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, depthWrite: false, blending: blend(dark), opacity: dark ? 0.75 : 0.6 }));
  s.scale.set(scale, scale, 1);
  return s;
}

// Builds every layer for an aura (and its mutation) and moves them each frame.
export class AuraFX {
  constructor(key, lowDetail) {
    this.group = new THREE.Group();
    this.parts = [];
    this.key = key;
    const { aura, mut } = auraKey(key);
    const layers = [...aura.fx];
    if (mut && mut.id === 'shiny') layers.push({ t: 'sparkle', c: '#ffe066', n: 30 }, { t: 'glow', c: '#ffd54a', s: 3 });
    if (mut && mut.id === 'corrupted') layers.push({ t: 'motes', c: '#4a0072', n: 22, dark: 1 }, { t: 'bolts', c: '#d580ff' });
    if (mut && mut.id === 'glitched') { layers.push({ t: 'cubes', c: '#00ffd0', n: 6 }, { t: 'cubes', c: '#ff00aa', n: 6 }); this.glitch = true; }
    for (const L of layers) {
      const spec = lowDetail && L.n ? { ...L, n: Math.ceil(L.n / 2) } : L;
      this.add(spec);
    }
  }
  add(L) {
    const g = this.group, push = (obj, update) => { g.add(obj); this.parts.push({ obj, update }); };
    if (['motes', 'flames', 'fall', 'sparkle', 'spiral', 'rainbow'].includes(L.t)) {
      const d = new Dots(L, L.t); push(d.obj, (dt, t) => d.update(dt, t)); return;
    }
    if (L.t === 'glow') { const s = glowSprite(L.c, L.s * 2, L.dark); s.position.y = 2.6; push(s, (dt, t) => { s.material.opacity = (L.dark ? 0.7 : 0.45) + Math.sin(t * 2) * 0.12; }); return; }
    if (L.t === 'ring') {
      const r = L.r || 2;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2.2, r * 2.2), new THREE.MeshBasicMaterial({ map: ringTex(L.runes, L.rays, L.half), color: L.half ? '#ffffff' : L.c, transparent: true, depthWrite: false, blending: L.half ? THREE.NormalBlending : THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.08;
      push(m, (dt, t) => { m.rotation.z += dt * (L.half ? 0.9 : 0.6); m.material.opacity = 0.75 + Math.sin(t * 3) * 0.2; });
      return;
    }
    if (L.t === 'halo') {
      const r = L.r || 0.75, grp = new THREE.Group(); grp.position.y = 5.75;
      const mat = new THREE.MeshBasicMaterial({ color: L.c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const torus = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 8, 40), mat); torus.rotation.x = Math.PI / 2; grp.add(torus);
      const glow = glowSprite(L.c, r * 3); grp.add(glow);
      if (L.horns) for (const sx of [-1, 1]) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 10), new THREE.MeshBasicMaterial({ color: L.c })); h.position.set(sx * 0.55, -0.35, 0); h.rotation.z = -sx * 0.35; grp.add(h); }
      if (L.crown) for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.28, cn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.45, 6), mat); cn.position.set(Math.cos(a) * r, 0.22, Math.sin(a) * r); grp.add(cn); }
      if (L.eclipse) { const disk = new THREE.Mesh(new THREE.CircleGeometry(r * 0.8, 32), new THREE.MeshBasicMaterial({ color: '#000000' })); disk.position.set(0, 0.6, -0.9); grp.add(disk); const cor = glowSprite(L.c, r * 4.5); cor.position.set(0, 0.6, -0.95); grp.add(cor); }
      if (L.eye) { const eye = glowSprite('#ffffff', 0.9); eye.position.y = 0.55; grp.add(eye); }
      push(grp, (dt, t) => { grp.rotation.y += dt * 0.8; grp.position.y = 5.75 + Math.sin(t * 2) * 0.08; });
      return;
    }
    if (L.t === 'pillar') {
      const h = L.tall ? 26 : 14, w = L.tall ? 1.3 : 1;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(w, w * 1.15, h, 24, 1, true), new THREE.MeshBasicMaterial({ map: pillarTex(), color: L.c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.position.y = h / 2;
      push(m, (dt, t) => { m.material.opacity = 0.35 + Math.sin(t * 2.5) * 0.12; m.rotation.y += dt; });
      return;
    }
    if (L.t === 'crystals') {
      const grp = new THREE.Group(); grp.position.y = 2.6;
      const mat = new THREE.MeshStandardMaterial({ color: L.c, emissive: L.c, emissiveIntensity: 0.55, metalness: 0.35, roughness: 0.15, transparent: true, opacity: 0.92 });
      const items = [];
      for (let i = 0; i < L.n; i++) { const m = new THREE.Mesh(new THREE.OctahedronGeometry(L.size || 0.28), mat); m.scale.y = 1.6; grp.add(m); items.push(m); }
      push(grp, (dt, t) => items.forEach((m, i) => {
        const a = t * 0.9 + (i / L.n) * 6.28;
        m.position.set(Math.cos(a) * 1.9, Math.sin(t * 2 + i) * 0.45, Math.sin(a) * 1.9); m.rotation.y += dt * 2;
      }));
      return;
    }
    if (L.t === 'orbit') {
      const grp = new THREE.Group(); grp.position.y = 2.7;
      const r = L.r || 2, size = L.size || 0.2, items = [];
      for (let i = 0; i < L.n; i++) {
        const o = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 10), new THREE.MeshBasicMaterial({ color: L.c }));
        o.add(glowSprite(L.c, size * 7)); grp.add(o); items.push(o);
      }
      let trail = null;
      if (L.trail) { trail = new Dots({ c: L.c, n: 40, size: size * 2.2 }, 'sparkle'); trail.p.forEach(p => { p.hist = 0; }); grp.add(trail.obj); }
      push(grp, (dt, t) => {
        items.forEach((o, i) => {
          const a = t * (L.trail ? 2.2 : 1.4) + (i / L.n) * 6.28 + (L.phase || 0);
          o.position.set(Math.cos(a) * r, (L.bob ? Math.sin(t * 3 + i) * 0.8 : Math.sin(a * 2) * 0.3), Math.sin(a) * r);
        });
        if (trail) {   // a tail following the first orb
          const P = trail.pos, C = trail.col, base = new THREE.Color(L.c);
          for (let j = 0; j < trail.n; j++) {
            const a = t * 2.2 - j * 0.06 + (L.phase || 0);
            P[j * 3] = Math.cos(a) * r; P[j * 3 + 1] = Math.sin(a * 2) * 0.3; P[j * 3 + 2] = Math.sin(a) * r;
            const k = 1 - j / trail.n; C[j * 3] = base.r * k; C[j * 3 + 1] = base.g * k; C[j * 3 + 2] = base.b * k;
          }
          trail.obj.geometry.attributes.position.needsUpdate = true; trail.obj.geometry.attributes.color.needsUpdate = true;
        }
      });
      return;
    }
    if (L.t === 'wings') {
      const grp = new THREE.Group(); grp.position.set(0, 3.4, -0.65);
      const sc = L.big ? 1.7 : 1.15, pairs = L.many ? 2 : 1, wings = [];
      for (let p = 0; p < pairs; p++) for (const side of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2 * sc, 4.4 * sc), new THREE.MeshBasicMaterial({ map: wingTex(), color: L.c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        const pivot = new THREE.Group(); m.position.set(side * 1.1 * sc, 0.4 * sc - p * 1.4, 0); m.scale.x = side; pivot.add(m); grp.add(pivot);
        wings.push({ pivot, side, p });
      }
      push(grp, (dt, t) => wings.forEach(w => { w.pivot.rotation.y = w.side * (0.35 + Math.sin(t * 2.4 + w.p) * 0.25); }));
      return;
    }
    if (L.t === 'cubes') {
      const grp = new THREE.Group(); grp.position.y = 2.6;
      const mat = new THREE.MeshBasicMaterial({ color: L.c, transparent: true, opacity: 0.9, blending: blend(L.dark) });
      const items = Array.from({ length: L.n }, () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), mat); m.userData = { a: rnd(0, 6.28), r: rnd(1.2, 2.6), y: rnd(-2, 2.6), s: rnd(0.6, 1.8) }; grp.add(m); return m; });
      push(grp, (dt, t) => items.forEach(m => {
        const u = m.userData, a = u.a + t * u.s;
        m.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * u.s * 2) * 0.3, Math.sin(a) * u.r);
        m.rotation.x += dt * 2; m.rotation.y += dt * 3;
        m.visible = Math.random() > 0.04;
      }));
      return;
    }
    if (L.t === 'bolts') {
      const pts = new Float32Array(10 * 3), geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: L.c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      line.frustumCulled = false; let next = 0;
      push(line, (dt, t) => {
        if (t < next) return;
        next = t + rnd(0.08, 0.35);
        line.visible = Math.random() < 0.55;
        const a = rnd(0, 6.28), r = rnd(1, 2.4);
        for (let i = 0; i < 10; i++) { pts[i * 3] = Math.cos(a) * r + rnd(-0.35, 0.35); pts[i * 3 + 1] = 6 - i * 0.65; pts[i * 3 + 2] = Math.sin(a) * r + rnd(-0.35, 0.35); }
        geo.attributes.position.needsUpdate = true;
      });
      return;
    }
    if (L.t === 'yinyang') {
      // Equinox: a white ball and a black ball circling you, always opposite each other, each with a tail.
      const grp = new THREE.Group(); grp.position.y = 2.7;
      const r = L.r || 2.4, size = L.big ? 0.42 : 0.32, orbs = [];
      const pairs = L.many ? 2 : 1;
      for (let p = 0; p < pairs; p++) for (const white of [true, false]) {
        const o = new THREE.Mesh(new THREE.SphereGeometry(size, 20, 16), new THREE.MeshBasicMaterial({ color: white ? '#ffffff' : '#050505' }));
        if (white) o.add(glowSprite('#ffffff', size * 8));
        else { const rim = new THREE.Mesh(new THREE.SphereGeometry(size * 1.18, 20, 16), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.BackSide, transparent: true, opacity: 0.55 })); o.add(rim); }
        const tail = new Dots({ c: white ? '#ffffff' : '#000000', n: 34, size: size * 2.1, dark: !white }, 'sparkle');
        grp.add(o); grp.add(tail.obj);
        orbs.push({ o, tail, white, p });
      }
      push(grp, (dt, t) => orbs.forEach(({ o, tail, white, p }) => {
        const tilt = p ? 0.9 : 0, speed = 1.9;
        const at = (k) => {
          const a = t * speed - k * 0.07 + (white ? 0 : Math.PI) + p * 1.2;
          const x = Math.cos(a) * r, z = Math.sin(a) * r, y = Math.sin(a * 2) * 0.5;
          return [x, y * Math.cos(tilt) - z * Math.sin(tilt) * (p ? 0.6 : 0), z];
        };
        const [x, y, z] = at(0); o.position.set(x, y, z);
        const P = tail.pos, C = tail.col;
        for (let j = 0; j < tail.n; j++) {
          const [tx, ty, tz] = at(j + 1); P[j * 3] = tx; P[j * 3 + 1] = ty; P[j * 3 + 2] = tz;
          const k = white ? 1 - j / tail.n : 1; C[j * 3] = k; C[j * 3 + 1] = k; C[j * 3 + 2] = k;
          if (!white) { C[j * 3] = C[j * 3 + 1] = C[j * 3 + 2] = 0.02; }
        }
        tail.mat.opacity = white ? 1 : 0.65;
        tail.obj.geometry.attributes.position.needsUpdate = true; tail.obj.geometry.attributes.color.needsUpdate = true;
      }));
    }
  }
  update(dt, t) {
    for (const p of this.parts) p.update(dt, t);
    if (this.glitch) this.group.position.x = Math.random() < 0.05 ? rnd(-0.25, 0.25) : 0;
  }
  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && !o.material.map) o.material.dispose(); });
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
