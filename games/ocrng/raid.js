// Overcontrol RNG: The Crawler, the raid boss. A giant sand worm built from studded segments that bursts out of the
// arena's sand, sways, glares at the nearest player and slams the ground. The game keeps its health in the lobby's
// Realtime Database so everyone fights the same worm; this file only draws it.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { glowTex } from './avatar.js';

export function createCrawler(scene, at) {
  const group = new THREE.Group(); group.position.copy(at); scene.add(group);
  const sand = new THREE.MeshStandardMaterial({ color: '#c9a35c', roughness: 0.85 });
  const band = new THREE.MeshStandardMaterial({ color: '#7d5a2c', roughness: 0.9 });
  const hurt = new THREE.Color('#ff3b3b');
  const N = 13, segs = [];
  for (let i = 0; i < N; i++) {
    const r = 3.1 - i * 0.07;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, 2.3, 14), i % 2 ? band : sand);
    m.castShadow = true; group.add(m); segs.push(m);
  }
  // the head: a wide maw with four mandibles and two glowing eyes
  const head = new THREE.Group(); group.add(head);
  const skull = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 3.2, 14), sand); skull.castShadow = true; head.add(skull);
  const maw = new THREE.Mesh(new THREE.CircleGeometry(2.1, 20), new THREE.MeshBasicMaterial({ color: '#3a0505' })); maw.rotation.x = -Math.PI / 2; maw.position.y = 1.62; head.add(maw);
  const jaws = [];
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4;
    const j = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3.4, 6), new THREE.MeshStandardMaterial({ color: '#efe3c2' }));
    j.position.set(Math.cos(a) * 2.2, 2.6, Math.sin(a) * 2.2); j.rotation.z = -Math.cos(a) * 0.5; j.rotation.x = Math.sin(a) * 0.5; head.add(j); jaws.push(j);
  }
  const eyes = [-1, 1].map(s => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff1744' })); e.position.set(s * 1.3, 0.6, 2.6); head.add(e); const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ff1744', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); g.scale.set(2.4, 2.4, 1); e.add(g); return e; });
  // dust where it comes out of the ground
  const dust = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#d9b56e', size: 1.4, map: glowTex(), transparent: true, opacity: 0.6, depthWrite: false }));
  const DN = 60, dpos = new Float32Array(DN * 3), dp = Array.from({ length: DN }, () => ({ a: Math.random() * 6.3, r: 3 + Math.random() * 5, y: Math.random() * 4, v: 1 + Math.random() * 2 }));
  dust.geometry.setAttribute('position', new THREE.BufferAttribute(dpos, 3)); group.add(dust);
  const marks = [];   // slam warnings on the ground
  let rise = 0, dying = 0, flashT = 0, look = 0;
  const api = {
    group,
    // where the head is, for aiming and for the health bar
    headPos: new THREE.Vector3(),
    update(dt, t, target) {
      if (dying) { dying += dt; group.position.y = at.y - dying * 12; if (dying > 3) return false; }
      else rise = Math.min(1, rise + dt / 2.2);
      const up = (1 - Math.pow(1 - rise, 3)) * 1;
      // which way to lean: towards the target, slowly
      if (target) { const want = Math.atan2(target.x - at.x, target.z - at.z); let d = want - look; d = Math.atan2(Math.sin(d), Math.cos(d)); look += d * Math.min(1, dt * 1.5); }
      const lean = 0.35 + Math.sin(t * 0.9) * 0.12;
      let x = 0, y = -26 * (1 - up), z = 0;
      segs.forEach((s, i) => {
        const k = i / N;
        x = Math.sin(look) * lean * i * i * 0.09 + Math.sin(t * 1.7 + i * 0.5) * 0.25 * k * 3;
        z = Math.cos(look) * lean * i * i * 0.09 + Math.cos(t * 1.3 + i * 0.4) * 0.2 * k * 3;
        s.position.set(x, y + i * 2.15, z);
        s.rotation.set(Math.cos(look) * lean * k * 0.8, 0, -Math.sin(look) * lean * k * 0.8);
      });
      head.position.set(x * 1.06, y + N * 2.15 + 0.6, z * 1.06);
      head.rotation.set(Math.cos(look) * (0.9 + Math.sin(t * 2) * 0.1), 0, -Math.sin(look) * (0.9 + Math.sin(t * 2) * 0.1), 'XYZ');
      jaws.forEach((j, i) => { j.scale.y = 1 + Math.sin(t * 6 + i) * 0.12; });
      head.getWorldPosition(api.headPos);
      dp.forEach((p, i) => { p.a += dt * 0.6; p.y += p.v * dt; if (p.y > 6) p.y = 0; dpos.set([Math.cos(p.a) * p.r, p.y, Math.sin(p.a) * p.r], i * 3); });
      dust.geometry.attributes.position.needsUpdate = true;
      if (flashT > 0) { flashT -= dt; sand.emissive.copy(hurt); sand.emissiveIntensity = flashT * 3; } else sand.emissiveIntensity = 0;
      for (let i = marks.length - 1; i >= 0; i--) {
        const m = marks[i]; m.t += dt;
        const k = Math.min(1, m.t / m.wait);
        m.fill.scale.setScalar(Math.max(0.01, k)); m.ring.material.opacity = 0.9;
        if (m.t >= m.wait && !m.fired) { m.fired = true; m.cb && m.cb(); m.ring.material.color.set('#ffffff'); }
        if (m.t > m.wait + 0.35) { scene.remove(m.g); m.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); marks.splice(i, 1); }
      }
      return true;
    },
    // a red ring on the ground that fills up, then slams: cb runs at the moment of the slam
    telegraph(x, z, r, wait, cb) {
      const g = new THREE.Group(); g.position.set(x, 0.15, z); scene.add(g);
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.4, r, 48), new THREE.MeshBasicMaterial({ color: '#ff1744', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; g.add(ring);
      const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color: '#ff1744', transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2; fill.position.y = 0.02; g.add(fill);
      marks.push({ g, ring, fill, t: 0, wait, cb });
    },
    flash() { flashT = 0.25; },
    die() { if (!dying) dying = 0.001; },
    dispose() { scene.remove(group); marks.forEach(m => scene.remove(m.g)); group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); },
  };
  return api;
}
