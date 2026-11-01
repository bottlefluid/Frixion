// Overcontrol RNG: _________, the Commander. A boss you fight alone, in his own arena far from the island, with one
// life: die and you're back on the island. He has 5,000 health, a shield, a spear (no lunge), a mace and an elytra, and
// fights like a Minecraft PvP player: he rockets up on his elytra, swaps it for his chestplate at the top, looks down,
// swaps back and dives, and right before he lands swaps again and maces you (250 at least, more the higher he came
// from). Wind Burst bounces him back up and he does it again. Or he jousts: straight at you on the elytra with the
// spear lowered (80). Team null comes through two portals in waves: 50 soldiers (250 health) and 2 generals (1,000),
// and they're good at it: they circle you, jump for critical hits and put their shields up when you swing.
// The whole fight runs on your own computer and uses no database at all, unless an admin joins it from the Admin panel;
// then your game hosts it for them over ocrng/cmd/{id} until it ends.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { createMcPerson, createCrowd, createPortal, FX, mcTag } from './xboss.js';

export const CMD = { hp: 5000, gen: 1000, mob: 250, waves: 5, perWave: 10, gensIn: [1, 3] };
export const ARENA = { x: 1400, z: 0, half: 70 };
const GRAV = 72, ENGAGE = 6;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const fwd = yaw => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
const inArena = p => Math.abs(p.x - ARENA.x) < ARENA.half && Math.abs(p.z - ARENA.z) < ARENA.half;
const groundOf = p => (inArena(p) ? 0 : -999);
// his mace: 250 at least, and 15 more for every stud he fell (three times ____X____'s 5)
const maceDmg = fell => Math.round(250 + 15 * Math.max(0, fell));

// ---------------- the arena: a dark stone square high in a red sky ----------------
function buildArena(scene) {
  const g = new THREE.Group(); scene.add(g);
  const { x: cx, z: cz, half: H } = ARENA, colliders = [];
  const tex = (draw, rep) => { const c = document.createElement('canvas'); c.width = c.height = 64; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.magFilter = THREE.NearestFilter; return t; };
  const stone = tex(c => { for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x += 4) { const v = 26 + Math.floor(Math.random() * 14); c.fillStyle = `rgb(${v + 6},${v},${v + 4})`; c.fillRect(x, y, 4, 4); } c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, 64, 2); c.fillRect(0, 0, 2, 64); }, H / 4);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(H * 2, 4, H * 2), new THREE.MeshLambertMaterial({ map: stone })); floor.position.set(cx, -2, cz); floor.receiveShadow = true; g.add(floor);
  colliders.push({ min: new THREE.Vector3(cx - H, -4, cz - H), max: new THREE.Vector3(cx + H, 0, cz + H) });
  const ring = new THREE.Mesh(new THREE.RingGeometry(26, 27.5, 64), new THREE.MeshBasicMaterial({ color: '#b71c1c', side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.set(cx, 0.05, cz); g.add(ring);
  const dark = new THREE.MeshLambertMaterial({ color: '#1c1418' }), glow = new THREE.MeshBasicMaterial({ color: '#ff3d00' });
  // walls round the edge (and an invisible one all the way up, so wings can't carry anyone out)
  for (const [x, z, w, d] of [[cx, cz - H, H * 2, 2], [cx, cz + H, H * 2, 2], [cx - H, cz, 2, H * 2], [cx + H, cz, 2, H * 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 6, d), dark); m.position.set(x, 3, z); m.castShadow = true; g.add(m);
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d * 1.1), glow); s.position.set(x, 6.1, z); g.add(s);
    colliders.push({ min: new THREE.Vector3(x - w / 2, 0, z - d / 2), max: new THREE.Vector3(x + w / 2, 140, z + d / 2) });
  }
  // pillars with braziers
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + Math.PI / 8, x = cx + Math.cos(a) * 52, z = cz + Math.sin(a) * 52;
    const p = new THREE.Mesh(new THREE.BoxGeometry(4, 16, 4), dark); p.position.set(x, 8, z); p.castShadow = true; g.add(p);
    const top = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 5), glow); top.position.set(x, 16.5, z); g.add(top);
    colliders.push({ min: new THREE.Vector3(x - 2, 0, z - 2), max: new THREE.Vector3(x + 2, 16, z + 2) });
  }
  const sun = new THREE.PointLight('#ff6a3d', 2.2, 260, 1.2); sun.position.set(cx, 60, cz); g.add(sun);
  // the two portals team null comes through
  const portals = [{ x: cx - H + 9, z: cz, yaw: Math.PI / 2 }, { x: cx + H - 9, z: cz, yaw: -Math.PI / 2 }];
  return { group: g, colliders, portals, dispose() { scene.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }); } };
}

// sparks behind a firework rocket
export function rocketSparks(scene, x, y, z) {
  const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
  const bits = Array.from({ length: 18 }, (_, i) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), new THREE.MeshBasicMaterial({ color: ['#ffd54f', '#ff7043', '#ffffff'][i % 3], transparent: true })); m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 8, -6 - Math.random() * 10, (Math.random() - 0.5) * 8); g.add(m); return m; });
  let t = 0;
  return { update(dt) { t += dt; bits.forEach(b => { b.position.addScaledVector(b.userData.v, dt); b.material.opacity = Math.max(0, 1 - t / 0.8); }); if (t > 0.8) { scene.remove(g); bits.forEach(b => { b.geometry.dispose(); b.material.dispose(); }); return false; } return true; } };
}

export function createCmdFight(ctx) {
  const scene = ctx.scene;
  let F = null;

  // ---------------- starting and ending ----------------
  // host: your own fight. guest: an admin watching (and helping in) someone else's.
  function start(id, mode = 'host') {
    stop();
    const arena = buildArena(scene), n = performance.now();
    F = {
      id, mode, t0: n, over: null, arena, myDmg: 0, seq: 0, ev: [], names: [], sendAt: 0, guests: {}, offs: [],
      C: mode === 'host' ? { pos: new THREE.Vector3(ARENA.x, 70, ARENA.z - 40), vel: new THREE.Vector3(), yaw: 0, act: 'enter', t: 0, data: {}, hp: CMD.hp, max: CMD.hp, w: 'spear', ely: 2, onGround: false, peak: 0, cd: { jab: 0, air: n + 7000, joust: n + 14000, block: 0 }, shieldOff: 0, combo: 0 } : null,
      mobs: [], wave: 0, nextWaveAt: n + 4000,
      view: { c: null, mobs: [] },   // what's drawn
    };
    F.cmdModel = createMcPerson(scene, { chest: 'white', name: '_________', scale: 1.08 });
    F.cmdModel.hold('spear');
    F.crowd = createCrowd(scene, CMD.waves * CMD.perWave, 'black');
    F.gens = createCrowd(scene, 2, 'red');
    F.ringMesh = new THREE.Mesh(new THREE.RingGeometry(5.6, 7, 40), new THREE.MeshBasicMaterial({ color: '#ff1a1a', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    F.ringMesh.rotation.x = -Math.PI / 2; F.ringMesh.visible = false; scene.add(F.ringMesh);
    F.portals = arena.portals.map(p => createPortal(scene, p.x, p.z, p.yaw));
    F.tags = new Map();
    ctx.loadNames().then(txt => { if (F) F.names = String(txt).split(/\r?\n/).map(s => s.trim()).filter(Boolean); }).catch(() => {});
    if (mode === 'host') { ctx.sound('xspawn'); ctx.banner('_________', 'The Commander'); }
    return arena;
  }
  function stop() {
    if (!F) return;
    F.offs.forEach(f => f()); F.offs = [];
    F.cmdModel.dispose(); F.crowd.dispose(); F.gens.dispose(); scene.remove(F.ringMesh);
    F.portals.forEach(p => p && p.dispose()); F.tags.forEach(t => scene.remove(t)); F.arena.dispose();
    F = null;
  }
  const live = () => !!(F && !F.over);

  // ---------------- events: what happens, for whoever is in the fight to see (and be hit by) ----------------
  function emit(e) {
    e.id = ++F.seq; play(e);
    if (F.mode === 'host' && Object.keys(F.guests).length && ctx.net) { const r = ctx.net.ref(`ocrng/cmd/${F.id}/ev`).push({ ...e, t: Date.now() }); r.catch(() => {}); setTimeout(() => r.remove().catch(() => {}), 3000); }
  }
  function play(e) {
    const me = ctx.player(), mp = me.pos, add = f => f && ctx.addFx(f);
    const src = e.k === 'mob' ? 'cmdm' + e.i : 'cmd';   // who hit you (for Equilized and the reflections)
    const hurt = (dmg, kx, kz, vy, how, extra) => { if (!ctx.isDead() && (dmg > 0 || vy)) ctx.hurtMe(dmg, { kx, kz, vy, how, fx: e.fx ?? e.x, fz: e.fz ?? e.z, src, ...extra }); };
    switch (e.k) {
      case 'jab': case 'mob': {
        add(FX.sweep(scene, e.x, e.y, e.z, e.yaw)); ctx.sound(e.k === 'jab' ? 'axe' : 'sword', 0);
        if (e.crit) add(FX.crit(scene, e.x + Math.sin(e.yaw) * 2, e.y + 2, e.z + Math.cos(e.yaw) * 2));
        const dx = mp.x - e.x, dz = mp.z - e.z, d = Math.hypot(dx, dz);
        if (d <= e.r && Math.abs(mp.y - e.y) < 6 && (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / (d || 1) > -0.05) hurt(e.dmg, Math.sin(e.yaw) * (e.kb || 12), Math.cos(e.yaw) * (e.kb || 12), 9, e.k === 'jab' ? 'was skewered by _________ using [Spear]' : `was slain by ${e.name || 'null'}`);
        break;
      }
      case 'smash': {
        add(FX.smash(scene, e.x, e.y, e.z, e.power || 1.6)); add(FX.crit(scene, e.x, e.y, e.z)); ctx.sound('smash'); ctx.shake(1.3);
        const d = Math.hypot(mp.x - e.x, mp.z - e.z);
        if (Math.abs(mp.y - e.y) < 6 && d <= e.r2) hurt(d <= e.r1 ? e.dmg : (e.splash ?? Math.round(e.dmg / 2)), (mp.x - e.x) / (d || 1) * 18, (mp.z - e.z) / (d || 1) * 18, 16, 'was smashed by _________ using [Mace]');
        break;
      }
      case 'joust': {
        const ax = e.x2 - e.x, az = e.z2 - e.z, len = Math.hypot(ax, az) || 1, ux = ax / len, uz = az / len;
        const along = (mp.x - e.x) * ux + (mp.z - e.z) * uz, side = Math.abs((mp.x - e.x) * uz - (mp.z - e.z) * ux);
        if (!play.jousted || play.jousted !== e.j) if (along > -2 && along < len + 2 && side < e.w && Math.abs(mp.y - e.y) < 6) { play.jousted = e.j; hurt(e.dmg, ux * 24, uz * 24, 12, 'was jousted by _________ using [Spear]'); ctx.sound('axe'); add(FX.crit(scene, mp.x, mp.y + 3, mp.z)); }
        break;
      }
      case 'burst': add(FX.gust(scene, e.x, e.y, e.z)); ctx.sound('gust'); break;
      case 'rocket': add(rocketTrail(e.x, e.y, e.z)); ctx.sound('windthrow'); break;
      case 'swap': ctx.sound('tick', 300); break;
      case 'join': add(FX.portal(scene, e.x, 1, e.z)); ctx.chat(`${e.name} joined the game`, '#ffff55'); break;
      case 'poof': add(FX.poof(scene, e.x, e.y, e.z)); break;
      case 'win': ctx.sound('bossdie'); break;
    }
  }
  const rocketTrail = (x, y, z) => rocketSparks(scene, x, y, z);

  // ---------------- who they fight: you, and any admin who joined ----------------
  function fighters() {
    const out = [], me = ctx.player();
    if (!ctx.isDead() && inArena(me.pos)) out.push({ uid: ctx.uid, pos: me.pos.clone(), act: me.act });
    for (const o of ctx.others()) if (F.guests[o.uid] && inArena(o.pos)) out.push({ uid: o.uid, pos: o.pos.clone(), act: o.act });
    return out;
  }
  const nearest = (p, list) => { let b = null, bd = 1e9; for (const f of list) { const d = flat(p, f.pos); if (d < bd) { bd = d; b = f; } } return b; };
  const swinging = f => !!(f && f.act && Date.now() - f.act.t0 < 260);   // they just swung (or threw something)

  // ---------------- the Commander ----------------
  function go(C, act, data = {}) { C.act = act; C.t = 0; C.data = data; C.done = {}; }
  const once = (C, k) => (C.done[k] ? false : (C.done[k] = true));
  function swapEly(C, on, spread = 1) { if (C.ely === (on ? spread + 1 : 0)) return; C.ely = on ? spread + 1 : 0; emit({ k: 'swap', x: C.pos.x, y: C.pos.y, z: C.pos.z }); }
  function cmdTick(dt, n, list) {
    const C = F.C; if (!C || C.act === 'dead') return;
    C.t += dt;
    const tg = nearest(C.pos, list), fast = C.hp < C.max * 0.5;
    const tp = tg ? tg.pos : new THREE.Vector3(ARENA.x, 0, ARENA.z), d = flat(C.pos, tp);
    const face = p => { C.yaw = Math.atan2(p.x - C.pos.x, p.z - C.pos.z); };
    let fly = false;
    switch (C.act) {
      case 'enter': {   // glides in from the sky
        fly = true; swapEly(C, true, 1); const to = new THREE.Vector3(ARENA.x, 0, ARENA.z - 6), dir = to.clone().sub(C.pos);
        if (dir.length() < 4 || C.t > 4) { swapEly(C, false); go(C, 'chase'); break; }
        C.vel.copy(dir.normalize().multiplyScalar(34)); face(to); break;
      }
      case 'chase': {
        C.w = 'spear';
        if (!tg) { C.vel.x = 0; C.vel.z = 0; break; }
        face(tp); const f = fwd(C.yaw), sp = d > 4.5 ? 14 : 0; C.vel.x = f.x * sp; C.vel.z = f.z * sp;
        if (C.onGround && d > 8 && Math.random() < dt * 0.7) C.vel.y = 22;
        if (swinging(tg) && d < 7 && n > C.cd.block && n > C.shieldOff && Math.random() < 0.55) { C.cd.block = n + (fast ? 3500 : 5000); go(C, 'block'); break; }
        if (d < 5.8 && n > C.cd.jab) { C.cd.jab = n + (fast ? 700 : 950); go(C, 'jab'); break; }
        if (n > C.cd.air && d < 60) { C.cd.air = n + (fast ? 7000 : 10000) + Math.random() * 3000; C.combo = 0; go(C, 'rocket'); break; }
        if (d > 14 && n > C.cd.joust) { C.cd.joust = n + (fast ? 9000 : 13000) + Math.random() * 3000; go(C, 'joust', { j: n }); break; }
        break;
      }
      case 'jab': {   // the spear, no lunge: a quick stab with a long reach
        C.vel.x = 0; C.vel.z = 0; face(tp);
        if (C.t > 0.2 && once(C, 'hit')) emit({ k: 'jab', x: C.pos.x, y: C.pos.y, z: C.pos.z, yaw: C.yaw, r: 6.2, dmg: 18, kb: 14 });
        if (C.t > 0.5) go(C, 'chase');
        break;
      }
      case 'block': { C.vel.x = 0; C.vel.z = 0; face(tp); if (C.t > 1.1 || C.shieldOff > n) go(C, 'chase'); break; }
      // The elytra mace, the way PvP players do it: elytra on and a rocket straight up...
      case 'rocket': {
        fly = true; C.w = 'mace';
        if (once(C, 'go')) { swapEly(C, true, 1); emit({ k: 'rocket', x: C.pos.x, y: C.pos.y, z: C.pos.z }); C.data.from = C.pos.clone(); }
        const over = tp.clone().sub(C.pos).setY(0), drift = over.length() > 1 ? over.normalize().multiplyScalar(Math.min(26, d)) : over;
        C.vel.set(drift.x, 62, drift.z);
        if (C.t > 1.0 || C.pos.y > 70) go(C, 'peak');
        break;
      }
      // ...the chestplate back on at the top so he falls, looking down at you...
      case 'peak': {
        if (once(C, 'swap')) { swapEly(C, false); C.vel.set(0, Math.min(C.vel.y, 6), 0); C.peak = C.pos.y; C.data.from = C.pos.clone(); }
        face(tp); C.vel.x *= 0.9; C.vel.z *= 0.9;
        if (C.t > 0.35) go(C, 'dive', { from: C.data.from });
        break;
      }
      // ...the elytra again to dive at you, fast, and the chestplate on right before he hits so it counts as a fall
      case 'dive': {
        fly = true; C.w = 'mace';
        if (once(C, 'swap')) { swapEly(C, true, 0); C.peak = Math.max(C.peak, C.pos.y); C.data.from = C.data.from || C.pos.clone(); C.data.aim = tp.clone().setY(groundOf(tp) + 0.5); }
        // he dives at where you were, and the red ring there only creeps after you: keep moving and he misses
        const want = tp.clone().setY(groundOf(tp) + 0.5).sub(C.data.aim), wd = want.length();
        if (wd > 0.01) C.data.aim.addScaledVector(want, Math.min(1, (fast ? 7 : 5) * dt / wd));
        const aim = C.data.aim, dir = aim.clone().sub(C.pos), dl = dir.length();
        C.vel.copy(dir.normalize().multiplyScalar(fast ? 84 : 74)); face(aim);
        F.ring = [aim.x, aim.z];
        const h = C.pos.y - groundOf(C.pos);
        if (h < 6 && C.ely) swapEly(C, false);
        if (h < 1.2 || dl < 2.5 || C.t > 3) { F.ring = null; go(C, 'smash'); }
        break;
      }
      case 'smash': {
        if (once(C, 'hit')) {
          const fell = Math.max(0, C.peak - C.pos.y), from = C.data.from || C.pos;
          emit({ k: 'smash', x: C.pos.x, y: Math.max(groundOf(C.pos), C.pos.y - 1), z: C.pos.z, dmg: maceDmg(fell), r1: 6.5, r2: 11, splash: 30, power: Math.min(2.4, 1 + fell / 30), fx: from.x, fz: from.z });
          // Wind Burst: back up about three people high, to do it again
          emit({ k: 'burst', x: C.pos.x, y: C.pos.y, z: C.pos.z });
          C.vel.set(0, 46, 0); C.onGround = false; C.combo++;
        }
        fly = false;
        if (C.t > 0.15) { if (C.combo < (fast ? 4 : 3) && tg && d < 26) go(C, 'rebound'); else go(C, 'land'); }
        break;
      }
      case 'rebound': {   // still looking down, rising off the burst; at the top it's the elytra and down again
        face(tp); C.vel.x *= 0.92; C.vel.z *= 0.92;
        if (C.vel.y <= 0) { C.peak = C.pos.y; C.data.from = C.pos.clone(); go(C, 'dive', { from: C.pos.clone() }); }
        break;
      }
      case 'land': { C.vel.x = 0; C.vel.z = 0; if (C.onGround && C.t > 0.4) go(C, 'chase'); break; }
      // The joust: elytra on, a rocket, and straight at you with the spear lowered
      case 'joust': {
        fly = true; C.w = 'spear';
        if (once(C, 'go')) { swapEly(C, true, 1); emit({ k: 'rocket', x: C.pos.x, y: C.pos.y, z: C.pos.z }); }
        if (C.t < 0.45) { C.vel.set(0, 26, 0); face(tp); break; }
        if (!C.data.dir) { const aim = tp.clone().setY(tp.y + 1.5); C.data.dir = aim.sub(C.pos).normalize(); C.data.last = C.pos.clone(); }
        C.vel.copy(C.data.dir).multiplyScalar(fast ? 92 : 80); C.yaw = Math.atan2(C.data.dir.x, C.data.dir.z);
        if (C.t - 0.45 > 0.06) { emit({ k: 'joust', j: C.data.j, x: C.data.last.x, y: C.pos.y, z: C.data.last.z, x2: C.pos.x, z2: C.pos.z, w: 3.4, dmg: 80 }); C.data.last = C.pos.clone(); }
        if (C.t > 1.7 || !inArena(C.pos.clone().addScaledVector(C.vel, 0.1))) { swapEly(C, false); go(C, 'land'); }
        break;
      }
    }
    // moving: flying moves are his own, everything else falls
    if (!fly) C.vel.y -= GRAV * dt;
    C.pos.addScaledVector(C.vel, dt);
    const g = groundOf(C.pos);
    if (C.pos.y <= g) { C.pos.y = g; if (C.vel.y < 0) C.vel.y = 0; C.onGround = true; } else C.onGround = C.pos.y - g < 0.05;
    C.pos.x = Math.max(ARENA.x - ARENA.half + 2, Math.min(ARENA.x + ARENA.half - 2, C.pos.x)); C.pos.z = Math.max(ARENA.z - ARENA.half + 2, Math.min(ARENA.z + ARENA.half - 2, C.pos.z));
    C.pos.y = Math.min(C.pos.y, 90);
  }

  // ---------------- team null: waves through the portals, skilled ----------------
  function addMob(gen, portal, delayMs) {
    const p = F.arena.portals[portal], i = F.mobs.length, f = fwd(p.yaw);
    F.mobs.push({ i, gen, name: '', pos: new THREE.Vector3(p.x + f.x * 2, 0, p.z + f.z * 2), vel: new THREE.Vector3(), yaw: p.yaw, act: 'chase', t: 0, hp: gen ? CMD.gen : CMD.mob, max: gen ? CMD.gen : CMD.mob, cd: 0, block: false, blockUntil: 0, shieldOff: 0, walk: 0, dead: false, deadT: 0, hurtT: 0, at: performance.now() + delayMs, out: false, strafe: Math.random() < 0.5 ? 1 : -1, ring: Math.random() * Math.PI * 2, onGround: true });
  }
  function waveTick(n) {
    const alive = F.mobs.filter(m => !m.dead).length;
    if (F.wave >= CMD.waves || (alive > 3 && n < F.nextWaveAt)) return;
    if (!F.wave && !F.names.length && n < F.t0 + 4000) return;   // the names aren't here yet
    const w = F.wave++;
    for (let k = 0; k < CMD.perWave; k++) addMob(false, k % 2, k * 450);
    if (CMD.gensIn.includes(w)) addMob(true, w % 2, 5000);
    F.nextWaveAt = n + 45000;
    ctx.chat(`[Server]: Team null, wave ${w + 1} of ${CMD.waves}, is coming through the portals.`, '#ff8a80');
  }
  function mobTick(dt, n, list) {
    const alive = F.mobs.filter(m => !m.dead && m.out);
    // the six nearest (and the generals) fight; the rest circle further out and wait their turn
    const tgOf = m => nearest(m.pos, list), engaged = new Set(alive.slice().sort((a, b) => (tgOf(a) ? flat(a.pos, tgOf(a).pos) : 1e9) - (tgOf(b) ? flat(b.pos, tgOf(b).pos) : 1e9)).slice(0, ENGAGE));
    alive.forEach(m => { if (m.gen) engaged.add(m); });
    for (const m of F.mobs) {
      if (m.dead) { m.deadT += dt; continue; }
      if (!m.out) { if (n >= m.at) { m.out = true; m.name = F.names.length ? F.names[Math.floor(Math.random() * F.names.length)] : `null${m.i}`; emit({ k: 'join', x: m.pos.x, z: m.pos.z, name: m.name }); } else continue; }
      m.t += dt; m.hurtT = Math.max(0, m.hurtT - dt);
      if (m.act === 'swing' && m.t > 0.45) { m.act = 'chase'; m.t = 0; }
      if (m.block && n > m.blockUntil) m.block = false;
      const tg = tgOf(m);
      if (!tg) { m.vel.x = 0; m.vel.z = 0; physicsOf(m, dt); continue; }
      const d = flat(m.pos, tg.pos), eng = engaged.has(m);
      // where to stand: close in, circling (engaged), or a ring further out
      let ang, R;
      if (eng) { if (Math.random() < dt * 0.35) m.strafe *= -1; ang = Math.atan2(m.pos.x - tg.pos.x, m.pos.z - tg.pos.z) + m.strafe * dt * 1.1; R = n > m.cd - 350 ? 2.6 : 3.6; }
      else { ang = m.ring + n / 9000; R = 13 + (m.i % 3) * 2; }
      const want = new THREE.Vector3(tg.pos.x + Math.sin(ang) * R, 0, tg.pos.z + Math.cos(ang) * R);
      const to = want.sub(m.pos).setY(0);
      // keep a little apart from each other
      for (const o of alive) { if (o === m) continue; const dx = m.pos.x - o.pos.x, dz = m.pos.z - o.pos.z, dd = Math.hypot(dx, dz); if (dd < 2.4 && dd > 0.01) { to.x += dx / dd * (2.4 - dd) * 3; to.z += dz / dd * (2.4 - dd) * 3; } }
      const sp = (m.gen ? 13.5 : 12.5) * (m.block ? 0.35 : 1), tl = to.length();
      if (tl > 0.3) { m.vel.x = to.x / tl * Math.min(sp, tl * 4); m.vel.z = to.z / tl * Math.min(sp, tl * 4); } else { m.vel.x = 0; m.vel.z = 0; }
      m.yaw = Math.atan2(tg.pos.x - m.pos.x, tg.pos.z - m.pos.z);
      m.walk += dt * Math.hypot(m.vel.x, m.vel.z) * 0.5;
      // shields up when you swing at them (or when a general feels like it)
      if (!m.block && n > m.shieldOff && d < 6.5 && swinging(tg) && Math.random() < (m.gen ? 0.65 : 0.45)) { m.block = true; m.blockUntil = n + 650 + Math.random() * 500; }
      // attacks: a jump first now and then, to land a critical hit on the way down
      if (eng && d < 4.4 && n > m.cd && !m.block && m.act !== 'swing') {
        m.cd = n + (m.gen ? 620 : 820) + Math.random() * 260;
        if (m.onGround && Math.random() < 0.35) { m.vel.y = 20; m.critAt = n + 360; }
        else swing(m, false);
      }
      if (m.critAt && n > m.critAt) { m.critAt = 0; swing(m, true); }
      physicsOf(m, dt);
    }
  }
  function swing(m, crit) {
    m.act = 'swing'; m.t = 0;
    const dmg = Math.round((m.gen ? 14 : 8) * (crit ? 1.5 : 1));
    emit({ k: 'mob', i: m.i, x: m.pos.x, y: m.pos.y, z: m.pos.z, yaw: m.yaw, r: 4.8, dmg, kb: 12, crit: crit ? 1 : 0, name: m.name });
  }
  function physicsOf(e, dt) {
    e.vel.y -= GRAV * dt; e.pos.addScaledVector(e.vel, dt);
    const g = groundOf(e.pos);
    if (e.pos.y <= g) { e.pos.y = g; if (e.vel.y < 0) e.vel.y = 0; e.onGround = true; } else e.onGround = false;
    e.pos.x = Math.max(ARENA.x - ARENA.half + 2, Math.min(ARENA.x + ARENA.half - 2, e.pos.x)); e.pos.z = Math.max(ARENA.z - ARENA.half + 2, Math.min(ARENA.z + ARENA.half - 2, e.pos.z));
  }

  // ---------------- your hits on them ----------------
  // Like ____X____'s fight: f is a move ('punch', 'melee', 'smash', or anything hitTest knows). Shields stop most of a
  // hit from the front; an axe knocks a shield down for 5 seconds instead. Returns what it hit.
  function hitFrom(f, dmg, hitTest) {
    if (!live() || !dmg) return [];
    const me = ctx.player().pos, targets = [];
    const V = F.mode === 'host' ? { c: F.C, mobs: F.mobs } : F.view;
    if (V.c && V.c.act !== 'dead' && V.c.act !== 'enter') targets.push({ uid: 'c', pos: V.c.pos, act: V.c.act, yaw: V.c.yaw, big: 1.6 });
    for (const m of V.mobs) if (!m.dead && m.out !== false) targets.push({ uid: 'm' + m.i, pos: m.pos, act: m.block ? 'block' : m.act, yaw: m.yaw, big: 1 });
    let hits;
    if (f.kind === 'punch' || f.kind === 'melee') {
      const R = f.kind === 'melee' ? f.r : 5.2, fy = f.yaw;
      let best = null; for (const t of targets) { const d = flat(t.pos, me); if (d < R + t.big && (fy === undefined || ((t.pos.x - me.x) * Math.sin(fy) + (t.pos.z - me.z) * Math.cos(fy)) / (d || 1) > -0.2) && (!best || d < best.d)) best = { t, d }; }
      hits = best ? [best.t] : [];
    } else if (f.kind === 'smash') hits = targets.filter(t => Math.hypot(t.pos.x - f.x, t.pos.z - f.z) < f.r + t.big);
    else { const ring = []; for (const t of targets) for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) ring.push({ uid: t.uid, pos: { x: t.pos.x + dx * t.big, z: t.pos.z + dz * t.big } }); const got = new Set(hitTest(f, ring).map(h => h.uid)); hits = targets.filter(t => got.has(t.uid)); }
    for (const t of hits) {
      let d = dmg, broke = false;
      if (t.act === 'block') { const dx = me.x - t.pos.x, dz = me.z - t.pos.z, dl = Math.hypot(dx, dz) || 1; if ((dx * Math.sin(t.yaw) + dz * Math.cos(t.yaw)) / dl > 0.2) { if (f.axe) { broke = true; ctx.sound('shieldbreak'); } else { d = Math.max(1, Math.round(dmg * 0.15)); ctx.sound('block'); } } }
      if (F.mode === 'host') damage(t.uid, d, broke);
      else if (ctx.net) ctx.net.ref(`ocrng/cmd/${F.id}/hit`).push({ id: t.uid, d, broke: broke ? 1 : 0, t: Date.now() }).catch(() => {});
      F.myDmg += d;
    }
    return hits.map(t => (t.uid === 'c' ? 'cmd' : 'cmd' + t.uid));
  }
  // damage, on the host's game (its own hits and the ones admins send)
  function damage(id, d, broke) {
    const n = performance.now();
    if (id === 'c') {
      const C = F.C; if (!C || C.act === 'dead' || C.act === 'enter') return;
      if (broke) { C.shieldOff = n + 5000; if (C.act === 'block') go(C, 'chase'); }
      C.hp = Math.max(0, C.hp - d); F.cmdModel.hurt(); ctx.sound('bosshurt');
      if (C.hp <= 0) { go(C, 'dead'); F.over = 'win'; F.ring = null; emit({ k: 'win' }); F.cmdModel.die(); ctx.onEnd('win'); }
      return;
    }
    const m = F.mobs[+String(id).slice(1)]; if (!m || m.dead) return;
    if (broke) { m.shieldOff = n + 5000; m.block = false; }
    m.hp -= d; m.hurtT = 0.3; ctx.sound('mobhurt');
    if (m.hp <= 0) { m.dead = true; m.deadT = 0; emit({ k: 'poof', x: m.pos.x, y: m.pos.y, z: m.pos.z }); ctx.onMobKill(m); }
  }

  // ---------------- every frame ----------------
  function update(dt) {
    if (!F) return;
    const n = performance.now();
    if (F.mode === 'host' && !F.over) {
      const list = fighters();
      waveTick(n); cmdTick(dt, n, list); mobTick(dt, n, list);
      if (Object.keys(F.guests).length && n > F.sendAt) { F.sendAt = n + 125; publish(); }
    }
    draw(dt);
  }
  // what's drawn: from the simulation (host) or from what the host sends (guest)
  function draw(dt) {
    const V = F.mode === 'host' ? { c: F.C, mobs: F.mobs } : F.view, C = V.c, M = F.cmdModel;
    if (C) {
      if (F.mode === 'host') M.root.position.copy(C.pos); else M.root.position.lerp(C.pos, 1 - Math.exp(-dt * 14));
      M.root.rotation.y = C.yaw;
      // his lean follows his flight (0 upright, PI/2 flat, PI head first down), and diving tucks the wings back, like Minecraft
      const v = C.vel || new THREE.Vector3(), vl = v.length() || 1, pitch = Math.max(0.1, Math.min(Math.PI - 0.1, Math.PI / 2 - Math.atan2(v.y, Math.hypot(v.x, v.z) || 0.001)));
      M.hold(C.w); M.setElytra(C.ely > 0, C.ely === 2 ? (v.y < 0 ? 1 - Math.pow(Math.min(1, -v.y / vl), 1.5) : 1) : 0);
      const act = C.act === 'jab' ? 'lunge' : C.act === 'block' ? 'block' : C.act === 'dive' ? 'dive' : C.act === 'joust' && C.t > 0.45 ? 'joust' : (C.act === 'rocket' || C.act === 'enter') ? 'glide' : C.act === 'peak' || C.act === 'rebound' ? 'raise' : C.act === 'smash' ? 'smash' : null;
      const alive = M.pose(dt, { speed: C.act === 'chase' ? 12 : 0, act, k: Math.min(1, C.t / 0.5), lookUp: C.act === 'rocket', pitch: act === 'glide' || act === 'joust' || act === 'dive' ? pitch : undefined });
      if (!alive && C.act === 'dead') M.root.visible = false;
    }
    // the red ring where he'll land
    F.ringMesh.visible = !!F.ring; if (F.ring) F.ringMesh.position.set(F.ring[0], 0.15, F.ring[1]);
    // team null, and the generals' (and the nearest soldiers') name tags
    const me = ctx.player().pos, soldiers = [], gens = [];
    for (const m of V.mobs) {
      if (m.out === false || (m.dead && m.deadT > 1.4)) continue;
      const e = { x: m.pos.x, y: m.pos.y, z: m.pos.z, yaw: m.yaw, speed: m.dead ? 0 : Math.hypot(m.vel ? m.vel.x : 0, m.vel ? m.vel.z : 0), walk: m.walk || 0, act: m.act, k: Math.min(1, (m.t || 0) / 0.45), block: m.block, hurt: m.hurtT > 0, dead: m.dead ? m.deadT : -1, scale: m.gen ? 1.06 : 0.96 };
      (m.gen ? gens : soldiers).push(e);
    }
    F.crowd.set(soldiers); F.gens.set(gens);
    const named = V.mobs.filter(m => !m.dead && m.out !== false).sort((a, b) => (b.gen - a.gen) || flat(a.pos, me) - flat(b.pos, me)).slice(0, 8), show = new Set(named.map(m => m.i));
    for (const m of named) {
      let t = F.tags.get(m.i);
      if (!t) { t = mcTag(m.name + (m.gen ? ' (general)' : ''), m.gen ? '#ff8a80' : '#ffffff'); F.tags.set(m.i, t); scene.add(t); }
      t.visible = true; t.position.set(m.pos.x, m.pos.y + 36 * 0.25 * (m.gen ? 1.06 : 0.96), m.pos.z);
    }
    for (const [i, t] of F.tags) if (!show.has(i)) t.visible = false;
    F.portals = F.portals.map(p => (p && p.update(dt) ? p : null));
  }

  // ---------------- admins: joining someone's fight ----------------
  // The host sends what's happening 8 times a second only while an admin is in; an admin's hits come back to the host.
  function publish() {
    const C = F.C, r2 = x => Math.round(x * 100) / 100;
    const s = { t: Date.now(), over: F.over || null, wave: F.wave, ring: F.ring || null, c: C ? [r2(C.pos.x), r2(C.pos.y), r2(C.pos.z), r2(C.yaw), C.act, C.ely, C.w, Math.round(C.hp), r2(C.t)] : null, m: F.mobs.filter(m => m.out && !(m.dead && m.deadT > 1.4)).map(m => [m.i, r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), r2(m.yaw), m.act, m.block ? 1 : 0, m.dead ? 1 : 0, m.gen ? 1 : 0, Math.round(m.hp), m.name]) };
    ctx.net.ref(`ocrng/cmd/${F.id}/s`).set(s).catch(() => {});
  }
  // on the host: watch for admins joining, and take their hits
  function hostSync() {
    if (!ctx.net || F.mode !== 'host') return;
    const jr = ctx.net.ref(`ocrng/cmd/${F.id}/join`), hr = ctx.net.ref(`ocrng/cmd/${F.id}/hit`);
    const onJoin = s => { const v = s.val() || {}; F.guests[s.key] = v.name || s.key; if (!F.cleanup) { F.cleanup = true; ctx.net.ref(`ocrng/cmd/${F.id}`).onDisconnect().remove(); } ctx.chat(`[Admin]: ${v.name || 'An admin'} joined your fight.`, '#ffd54f'); publish(); };
    const onHit = s => { const h = s.val(); s.ref.remove().catch(() => {}); if (h && Date.now() - (h.t || 0) < 5000) damage(h.id, Math.max(0, Math.min(5000, +h.d || 0)), !!h.broke); };
    jr.on('child_added', onJoin); hr.on('child_added', onHit);
    F.offs.push(() => { jr.off('child_added', onJoin); hr.off('child_added', onHit); });
  }
  // on an admin's game: what the host sends
  function guestSync() {
    const sr = ctx.net.ref(`ocrng/cmd/${F.id}/s`), er = ctx.net.ref(`ocrng/cmd/${F.id}/ev`).limitToLast(10), joined = Date.now();
    const onS = s => {
      const v = s.val(); if (!v || !F) return;
      if (v.c) { const c = F.view.c || (F.view.c = { pos: new THREE.Vector3(v.c[0], v.c[1], v.c[2]), vel: new THREE.Vector3() }); c.vel.set((v.c[0] - c.pos.x) * 8, (v.c[1] - c.pos.y) * 8, (v.c[2] - c.pos.z) * 8); c.pos.set(v.c[0], v.c[1], v.c[2]); c.yaw = v.c[3]; c.act = v.c[4]; c.ely = v.c[5]; c.w = v.c[6]; c.hp = v.c[7]; c.t = v.c[8]; c.max = CMD.hp; }
      const old = new Map(F.view.mobs.map(m => [m.i, m]));
      F.view.mobs = (v.m || []).map(a => { const m = old.get(a[0]) || { i: a[0], pos: new THREE.Vector3(a[1], a[2], a[3]), vel: new THREE.Vector3(), walk: 0, t: 0 }; const was = m.pos.clone(); m.pos.set(a[1], a[2], a[3]); m.vel.set((a[1] - was.x) * 8, 0, (a[3] - was.z) * 8); m.walk += Math.hypot(m.vel.x, m.vel.z) * 0.06; m.yaw = a[4]; if (m.act !== a[5]) m.t = 0; m.act = a[5]; m.block = !!a[6]; if (a[7] && !m.dead) m.deadT = 0; m.dead = !!a[7]; m.gen = !!a[8]; m.hp = a[9]; m.name = a[10]; return m; });
      F.ring = v.ring; F.wave = v.wave;
      if (v.over && !F.over) { F.over = v.over; ctx.onEnd(v.over === 'win' ? 'guest-win' : 'guest-end'); }
    };
    const onE = s => { const e = s.val(); if (e && (e.t || 0) > joined - 500 && F) play(e); };
    sr.on('value', onS); er.on('child_added', onE);
    F.offs.push(() => { sr.off('value', onS); er.off('child_added', onE); });
  }
  // the dead keep falling over in guest views too
  const tickGuestDead = dt => { if (F && F.mode === 'guest') F.view.mobs.forEach(m => { if (m.dead) m.deadT += dt; m.t = (m.t || 0) + dt; }); if (F && F.mode === 'guest' && F.view.c) F.view.c.t += dt; };

  return {
    ARENA,
    start(id, mode) { const a = start(id, mode); if (mode === 'host') hostSync(); else guestSync(); return a; },
    stop, live, hitFrom,
    update(dt) { tickGuestDead(dt); update(dt); },
    // Ends it for good (result: 'win', 'lost', 'left'). Admins watching see how it ended, then what the fight left in
    // the database is cleared away.
    finish(result) {
      if (!F) return;
      if (!F.over) F.over = result;
      const id = F.id;
      if (F.mode === 'host' && Object.keys(F.guests).length && ctx.net) { publish(); setTimeout(() => ctx.net.ref(`ocrng/cmd/${id}`).remove().catch(() => {}), 3000); }
      if (F.mode === 'guest' && ctx.net) ctx.net.ref(`ocrng/cmd/${id}/join/${ctx.uid}`).remove().catch(() => {});
      stop();
    },
    get hasGuests() { return !!(F && F.mode === 'host' && Object.keys(F.guests).length); },
    state: () => F,   // everything about the fight going on, for tests
    get mode() { return F && F.mode; },
    get id() { return F && F.id; },
    get over() { return F && F.over; },
    get myDmg() { return F ? F.myDmg : 0; },
    inArena,
    // to lock on to (and aim at): him and his soldiers
    targets() {
      if (!F) return [];
      const V = F.mode === 'host' ? { c: F.C, mobs: F.mobs } : F.view, out = [];
      if (V.c && V.c.act !== 'dead') out.push({ id: 'cmd', name: '_________', pos: V.c.pos });
      for (const m of V.mobs) if (!m.dead && m.out !== false) out.push({ id: 'cmdm' + m.i, name: (m.name || 'null') + (m.gen ? ' (general)' : ''), pos: m.pos });
      return out;
    },
    // straight damage (Equilized, reflections' bolts): 'cmd' for him, 'cmdm3' for a soldier
    damage(id, d) { if (!live()) return; const t = id === 'cmd' ? 'c' : String(id).replace('cmdm', 'm'); if (F.mode === 'host') damage(t, Math.round(d)); else if (ctx.net) ctx.net.ref(`ocrng/cmd/${F.id}/hit`).push({ id: t, d: Math.round(d), t: Date.now() }).catch(() => {}); F.myDmg += d; },
    info() {
      if (!F) return null;
      const C = F.mode === 'host' ? F.C : F.view.c, mobs = (F.mode === 'host' ? F.mobs : F.view.mobs).filter(m => !m.dead);
      return C ? { hp: C.hp, max: CMD.hp, dead: C.act === 'dead', wave: F.wave, waves: CMD.waves, mobs: mobs.length, myDmg: F.myDmg, over: F.over } : null;
    },
  };
}
