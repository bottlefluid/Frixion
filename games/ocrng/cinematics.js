// Overcontrol RNG: the 『EQUINOX』 reveal, made like Sol's. The camera rises until it looks straight down on you, a white sun
// and a black sun circle you, spiralling closer and faster until they meet, an eight-pointed star bursts across the
// ground, and (the game does this part) the world turns black and white while the name appears.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { glowTex } from './avatar.js';

export const EQUINOX_MERGE = 4.8, EQUINOX_LENGTH = 8.4;

let starCanvas = null;
function starTex() {   // an eight-pointed star: two squares, one turned 45 degrees, with a soft glow
  if (!starCanvas) {
    starCanvas = document.createElement('canvas'); starCanvas.width = starCanvas.height = 512;
    const x = starCanvas.getContext('2d'), c = 256;
    const glow = x.createRadialGradient(c, c, 0, c, c, 250); glow.addColorStop(0, 'rgba(255,255,255,.9)'); glow.addColorStop(0.35, 'rgba(255,255,255,.25)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = glow; x.fillRect(0, 0, 512, 512);
    x.fillStyle = '#ffffff';
    for (const rot of [0, Math.PI / 4]) {
      x.save(); x.translate(c, c); x.rotate(rot);
      x.beginPath(); x.moveTo(0, -230); x.lineTo(46, -46); x.lineTo(230, 0); x.lineTo(46, 46); x.lineTo(0, 230); x.lineTo(-46, 46); x.lineTo(-230, 0); x.lineTo(-46, -46); x.closePath(); x.fill();
      x.restore();
    }
  }
  const t = new THREE.CanvasTexture(starCanvas); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const glowSprite = (color, scale, opacity = 1, normal = false) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity, depthWrite: false, blending: normal ? THREE.NormalBlending : THREE.AdditiveBlending }));
  s.scale.set(scale, scale, 1); return s;
};
const ease = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

// center: where you stand. from: where the camera was, so the shot starts there.
export function createEquinoxCinematic(scene, center, from) {
  const g = new THREE.Group(); g.position.copy(center); scene.add(g);
  const orb = white => {
    const o = new THREE.Mesh(new THREE.SphereGeometry(2.4, 32, 22), new THREE.MeshBasicMaterial({ color: white ? '#ffffff' : '#030303' }));
    if (white) o.add(glowSprite('#ffffff', 15, 0.95));
    else {   // a pale rim and a faint white halo under a dark one, so the black sun still shows against a night sky
      o.add(new THREE.Mesh(new THREE.SphereGeometry(2.7, 32, 22), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.BackSide, transparent: true, opacity: 0.65 })));
      const pale = glowSprite('#ffffff', 11, 0.35), dark = glowSprite('#000000', 9, 0.8, true); pale.renderOrder = 1; dark.renderOrder = 2; o.add(pale, dark);
    }
    o.scale.setScalar(0.001); g.add(o); return o;
  };
  const W = orb(true), K = orb(false);
  // tails: the last positions of each orb, fading out (the black one has a pale rim so it shows at night)
  const tails = [true, false].map(white => Array.from({ length: 40 }, (_, i) => {
    const k = 1 - i / 40, s = glowSprite(white ? '#ffffff' : '#000000', 2.8 * k + 0.5, 0.9 * k, !white);
    if (!white) { const rim = glowSprite('#ffffff', 1, 0.28 * k); rim.scale.set(1.3, 1.3, 1); rim.renderOrder = 1; s.renderOrder = 2; s.add(rim); }
    g.add(s); return s;
  }));
  const hist = [[], []];
  const star = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: starTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  star.rotation.x = -Math.PI / 2; star.position.y = 0.4; star.scale.setScalar(0.001); g.add(star);
  const star2 = star.clone(); star2.material = star.material.clone(); star2.material.blending = THREE.NormalBlending; star2.material.color.set('#000000'); star2.position.y = 0.35; g.add(star2);
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  shock.rotation.x = -Math.PI / 2; shock.position.y = 0.5; shock.scale.setScalar(0.001); g.add(shock);
  const flash = glowSprite('#ffffff', 0.001, 1); flash.position.y = 3; g.add(flash);
  let t = 0, theta = 0;
  const camFrom = from.clone(), top = new THREE.Vector3(0, 40, 6), close = new THREE.Vector3(0, 9, 17);
  return {
    get t() { return t; },
    update(dt) {
      t += dt;
      // the orbs spiral in, faster and faster, and meet at EQUINOX_MERGE
      const k = Math.min(1, t / EQUINOX_MERGE);
      theta += dt * (1.6 + 8 * k * k);
      const r = 17 * (1 - Math.pow(k, 1.5));
      const show = t > 0.6 && t < EQUINOX_MERGE;
      [W, K].forEach((o, i) => {
        const a = theta + i * Math.PI;
        o.position.set(Math.cos(a) * r, 3.5 + Math.sin(a * 0.5) * 0.7, Math.sin(a) * r);
        o.scale.setScalar(show ? Math.min(1, (t - 0.6) / 0.6) : 0.001);
        hist[i].unshift(o.position.clone()); if (hist[i].length > 40) hist[i].pop();
        tails[i].forEach((s, j) => { const p = hist[i][Math.min(j * 1, hist[i].length - 1)]; if (p) s.position.copy(p); s.visible = show && j < hist[i].length; });
      });
      // the meeting: a flash, an eight-pointed star and a shockwave across the ground
      const m = t - EQUINOX_MERGE;
      if (m > 0) {
        const e = Math.min(1, m / 1.3);
        star.scale.setScalar(4 + e * 70); star.rotation.z = m * 0.35; star.material.opacity = 1 - Math.max(0, m - 2) / 1.6;
        star2.scale.setScalar(2 + e * 52); star2.rotation.z = Math.PI / 8 - m * 0.25; star2.material.opacity = (1 - Math.max(0, m - 2) / 1.6) * 0.8;
        shock.scale.setScalar(1 + m * 60); shock.material.opacity = Math.max(0, 1 - m / 1.4);
        flash.scale.setScalar(Math.max(0.001, Math.sin(Math.min(1, m / 0.7) * Math.PI) * 60)); flash.material.opacity = Math.max(0, 1 - m / 0.9);
      }
      return t < EQUINOX_LENGTH;
    },
    // the shot: up to a bird's-eye view, a slow turn while the orbs circle, then back down to see you
    camera(cam) {
      const pos = new THREE.Vector3(), look = new THREE.Vector3(0, 2, 0);
      if (t < 1.5) pos.copy(camFrom).sub(center).lerp(top, ease(t / 1.5));
      else if (t < EQUINOX_MERGE + 0.5) { const a = (t - 1.5) * 0.25; pos.set(Math.sin(a) * 6, 40 - (t - 1.5) * 1.6, Math.cos(a) * 6); }
      else { const e = ease(Math.min(1, (t - EQUINOX_MERGE - 0.5) / 2.6)); const a = (EQUINOX_MERGE - 1) * 0.25; pos.set(Math.sin(a) * 6, 40 - (EQUINOX_MERGE - 1) * 1.6, Math.cos(a) * 6).lerp(close, e); look.y = 2 + e * 2; }
      cam.position.copy(pos).add(center);
      cam.lookAt(look.add(center));
    },
    dispose() { scene.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); },
  };
}
