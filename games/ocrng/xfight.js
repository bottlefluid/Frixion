// Overcontrol RNG: the ____X____ raid in the Pit. He comes every 6 hours (or when the Owner summons him), fights with a
// netherite sword and axe on the ground, lunges with a spear, launches himself with wind charges and an ender pearl
// to come down with a mace (which almost always kills), throws wind charges that launch you, pearls after whoever runs,
// and goes after whoever has hurt him most. At 0 health he pops a Totem of Undying and comes back with 1,000, eats
// enchanted golden apples, and team null (four soldiers and their general) comes through a nether portal.
//
// One player's game is the host: it moves X and his soldiers and sends where they are 8 times a second (ocrng/xboss/s).
// Everyone draws that, and every player checks only whether an attack hit themselves, so dodging is always fair on
// your own screen. Health lives in ocrng/xboss/life and changes only in transactions, so two hits never overwrite each
// other, and the hit that empties his first health bar is the one that pops the totem. If the host leaves, the next
// player takes over.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { createMcPerson, createPortal, FX } from './xboss.js';

export const X_SLOT_MS = 6 * 3600000;          // every 6 hours
const WINDOW = 30 * 60000, FIGHT_MS = 12 * 60000, ZONE = 62, GRAV = 72;   // the spawn is 77 studs away, so the dead are left alone
export const X_HP = { p1: 250, p2: 1000, gap: 100, mob: 100, general: 250 };
const DUR = { spawn: 2.6, sword: 0.5, axe: 0.8, lunge: 0.45, pearl: 1.05, charge: 0.5, eat: 3, block: 1.4, totem: 2.4, smash: 0.45, dead: 9, air: 6 };
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function createXFight(ctx) {
  const { scene, net, uid } = ctx;
  const S = () => net.serverNow();
  let xb = null, fightId = null;                    // the latest from the database, and which fight it is
  let H = null;                                     // the simulation, only while this game is the host
  let xm = null, mobs = {}, portal = null;          // what is drawn
  let lastEv = 0, shown = {}, myDmg = 0, dmgSent = 0, lastDmgSend = 0, rewarded = null, lastLife = null, mobLife = {};
  let disp = null;                                  // the drawn state: X and the mobs, eased towards the last update
  let poolNames = null;
  const isHost = () => xb && xb.host === uid && !xb.dead && !xb.gone;
  const live = () => !!(xb && xb.life && !xb.life.dead && !xb.gone && (xb.until || 0) > S());

  // ---------------- the database ----------------
  function onState(v) {
    const was = xb; xb = v;
    if (!v || !v.id) { teardown(); return; }
    if (v.id !== fightId) { teardown(); fightId = v.id; lastEv = 0; myDmg = 0; dmgSent = 0; lastLife = null; mobLife = {}; disp = null; if (live()) intro(); }
    const L = v.life || {};
    // he took damage: flash red; a new phase: the totem
    if (lastLife && xm) {
      if (L.hp < lastLife.hp && L.phase === lastLife.phase) { xm.hurt(); ctx.sound('bosshurt'); }
      if (L.phase === 2 && lastLife.phase === 1) ctx.chat(`[Server]: ____X____ used a Totem of Undying!`, '#e8d84a');
      if (L.dead && !lastLife.dead) { ctx.sound('bossdie'); ctx.chat('[Server]: ____X____ has been defeated!', '#b388ff'); }
    }
    lastLife = { ...L };
    for (const [i, m] of Object.entries(v.mobs || {})) {
      const was2 = mobLife[i];
      if (was2 && m.hp < was2.hp && mobs[i]) { mobs[i].model.hurt(); ctx.sound('mobhurt'); }
      if (m.dead && was2 && !was2.dead) { if (m.by === uid) ctx.onMobKill(m); ctx.chat(`${m.name} was slain`, '#bdbdbd'); }
      mobLife[i] = { ...m };
    }
    if (v.s && v.s.ev && !isHost()) for (const e of v.s.ev) if (e.id > lastEv) { lastEv = e.id; play(e); }
    if (L.dead && rewarded !== v.id) { rewarded = v.id; reward(); }
    if (was && was.host !== v.host && v.host === uid) becomeHost();
  }
  function intro() {
    ctx.chat('[Server]: ____X____ has appeared in the Pit, east of the plaza! Hurt him most to be his target.', '#b388ff');
    ctx.banner('____X____', 'HAS APPEARED IN THE PIT');
    ctx.sound('xspawn');
  }
  function teardown() {
    if (xm) { xm.dispose(); xm = null; }
    for (const k in mobs) mobs[k].model.dispose(); mobs = {};
    if (portal) { portal.dispose(); portal = null; }
    H = null; disp = null;
  }

  // Start a fight (scheduled or summoned). Only one can start: the database transaction picks the winner.
  async function start(by, slot = -1) {
    const n = S(), a = ctx.arena;
    const st = { id: n, slot, by: by || 'the clock', start: n, until: n + FIGHT_MS, host: uid, hb: n, life: { hp: X_HP.p1, max: X_HP.p1, phase: 1, inv: n + 2600 } };
    const r = await net.xStart(st).catch(() => null);
    if (r && r.committed && r.snapshot.val() && r.snapshot.val().id === n) { onState(r.snapshot.val()); becomeHost({ x: a.x, y: 0, z: a.z - 6 }); }
    return r;
  }
  function stop() { if (xb && !xb.gone) net.xSet({ gone: true }); }
  // every 6 hours, for the first half hour, any game in the lobby may start him
  function tryScheduled() {
    if (!net || xb && live()) return;
    const n = S(), slot = Math.floor(n / X_SLOT_MS);
    if (n - slot * X_SLOT_MS > WINDOW || (xb && xb.slot === slot) || ctx.busy()) return;
    if (tryScheduled.last === slot) return; tryScheduled.last = slot;
    start('the clock', slot);
  }

  // ---------------- hosting ----------------
  function becomeHost(at) {
    if (!xb) return;
    const s = xb.s || {}, x = s.x || {};
    const p = x.p ? v3(x.p) : new THREE.Vector3(at ? at.x : ctx.arena.x, at ? at.y : 0, at ? at.z : ctx.arena.z);
    H = {
      x: { pos: p, vel: new THREE.Vector3(), yaw: x.r || 0, onGround: true, act: x.a && x.a !== 'dead' ? 'chase' : (x.a || 'spawn'), t: 0, w: 'sword', up: 0, data: {}, peak: p.y },
      mobs: {}, ev: [], seq: Math.max(lastEv, (s.ev || []).reduce((m, e) => Math.max(m, e.id), 0)), pending: [], lastSend: 0, think: 0,
      cd: { sword: 0, axe: 0, lunge: 0, pearl: 0, air: S() + 5000, charge: 0, block: 0, eat: 0 }, gaps: xb.gaps || 0, phaseSeen: (xb.life || {}).phase || 1, recent: [],
    };
    if (!x.a) H.x.act = 'spawn';
    for (const [i, m] of Object.entries(s.m || {})) H.mobs[i] = { pos: v3(m.p), vel: new THREE.Vector3(), yaw: m.r || 0, onGround: true, act: 'chase', t: 0, cd: 0, out: true };
  }
  const emit = e => { e.id = ++H.seq; e.t = S(); H.ev.push(e); if (H.ev.length > 16) H.ev.shift(); lastEv = e.id; play(e); };
  function groundAt(pos) {
    let g = Math.hypot(pos.x - ctx.arena.x, pos.z - ctx.arena.z) < 300 ? 0 : -50;
    for (const b of ctx.colliders()) { if (b.water || pos.x < b.min.x || pos.x > b.max.x || pos.z < b.min.z || pos.z > b.max.z) continue; if (b.max.y <= pos.y + 1.3 && b.max.y > g) g = b.max.y; }
    return g;
  }
  function physics(e, dt, noGrav) {
    if (!noGrav) e.vel.y -= GRAV * dt;
    e.pos.addScaledVector(e.vel, dt);
    const g = groundAt(e.pos);
    if (e.pos.y <= g) { e.pos.y = g; if (e.vel.y < 0) e.vel.y = 0; e.onGround = true; } else e.onGround = e.pos.y - g < 0.05;
  }
  // who can be fought: everyone near the Pit who is alive. X wants whoever has done the most damage to him.
  function fighters() {
    const out = [], a = ctx.arena;
    const me = ctx.player();
    if (!ctx.isDead() && flat(me.pos, a) < ZONE) out.push({ uid, pos: me.pos.clone() });
    for (const o of ctx.others()) if (flat(o.pos, a) < ZONE) out.push({ uid: o.uid, pos: o.pos.clone() });
    return out;
  }
  function xTarget(list) {
    if (!list.length) return null;
    const dmg = xb.dmg || {};
    let best = null;
    for (const f of list) { const d = dmg[f.uid] || 0; if (!best || d > best.d || (d === best.d && flat(f.pos, H.x.pos) < flat(best.f.pos, H.x.pos))) best = { f, d }; }
    return best.f;
  }
  const faceTo = (e, p) => { e.yaw = Math.atan2(p.x - e.pos.x, p.z - e.pos.z); };
  const fwd = yaw => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  function go(e, act, data = {}) { e.act = act; e.t = 0; e.data = data; e.done = {}; }
  const once = (e, k) => (e.done[k] ? false : (e.done[k] = true));
  const lifeTx = fn => net.xLife(fn).catch(() => {});

  function hostTick(dt) {
    const n = S(), X = H.x, L = xb.life || {}, list = fighters(), tg = xTarget(list);
    X.t += dt;
    if (L.dead && X.act !== 'dead') { go(X, 'dead'); emit({ k: 'xdie', x: X.pos.x, y: X.pos.y, z: X.pos.z }); for (const i in H.mobs) emit({ k: 'leave', i: +i }); }
    if (L.phase === 2 && H.phaseSeen === 1) { H.phaseSeen = 2; go(X, 'totem'); X.vel.set(0, X.vel.y, 0); }
    if ((xb.until || 0) < n && !xb.gone && !L.dead && !H.fled) { H.fled = true; emit({ k: 'pearl', x: X.pos.x, y: X.pos.y, z: X.pos.z, x2: X.pos.x, y2: X.pos.y + 60, z2: X.pos.z }); net.xSet({ gone: true }); }
    // pending things: wind charges reaching their target
    H.pending = H.pending.filter(p => { if (n < p.at) return true; emit(p.ev); return false; });
    const D = X.data;
    switch (X.act) {
      case 'spawn': X.w = 'sword'; if (X.t > DUR.spawn) go(X, 'chase'); break;
      case 'dead': X.vel.set(0, X.vel.y, 0); break;
      case 'totem': {
        X.w = 'totem'; X.vel.x = 0; X.vel.z = 0;
        if (X.t > 0.35 && once(X, 'pop')) emit({ k: 'totem', x: X.pos.x, y: X.pos.y, z: X.pos.z });
        if (X.t > 1.2 && once(X, 'portal')) openPortal();
        if (X.t > DUR.totem) go(X, 'chase');
        break;
      }
      case 'chase': {
        X.w = 'sword'; X.up = 0;
        if (!tg) { const home = ctx.arena; if (flat(X.pos, home) > 4) { faceTo(X, home); const f = fwd(X.yaw); X.vel.x = f.x * 9; X.vel.z = f.z * 9; } else { X.vel.x = 0; X.vel.z = 0; } break; }
        faceTo(X, tg.pos);
        const d = flat(X.pos, tg.pos), f = fwd(X.yaw), sp = d > 4 ? 13.5 : 0;
        X.vel.x = f.x * sp; X.vel.z = f.z * sp;
        if (X.onGround && (tg.pos.y - X.pos.y > 2 || Math.random() < dt * 0.6) && d > 6) X.vel.y = 24;   // sprint-jumping, like a PvP player
        if (n < H.think) break;
        H.think = n + 280;
        const r = Math.random(), cd = H.cd;
        const recent = H.recent.filter(h => h.t > n - 2000).reduce((s, h) => s + h.d, 0);
        if (L.phase === 2 && L.hp < L.max * 0.5 && H.gaps < 4 && n > cd.eat) { cd.eat = n + 15000; go(X, 'eat'); break; }
        if (L.phase === 2 && recent > 45 && n > cd.block) { cd.block = n + 6000; go(X, 'block'); break; }
        if (d > 24) {   // far away: 3 times in 4 he pearls to you, otherwise he lunges after you until he can mace you
          if (r < 0.75 && n > cd.pearl) { cd.pearl = n + 3500; go(X, 'pearl', { to: tg.pos.clone(), who: tg.uid }); }
          else go(X, 'spam', { left: 3 });
          break;
        }
        if (d <= 4.4) { if (n > cd.axe && r < 0.33) { cd.axe = n + 2200; go(X, 'axe'); } else if (n > cd.sword) { cd.sword = n + 600; go(X, 'sword'); } break; }
        if (n > cd.air && r < 0.45) { go(X, 'air'); break; }
        if (d > 7 && n > cd.lunge && r < 0.4) { cd.lunge = n + 2400; go(X, 'lunge'); break; }
        if (n > cd.charge && r < 0.2) { cd.charge = n + 5000; go(X, 'charge', { to: tg.pos.clone() }); }
        break;
      }
      case 'sword': case 'axe': {
        const axe = X.act === 'axe';
        X.w = axe ? 'axe' : 'sword'; X.vel.x *= 0.5; X.vel.z *= 0.5; if (tg) faceTo(X, tg.pos);
        if (X.t > (axe ? 0.45 : 0.22) && once(X, 'hit')) emit({ k: axe ? 'axe' : 'sweep', x: X.pos.x, y: X.pos.y, z: X.pos.z, yaw: X.yaw, r: axe ? 4.9 : 4.7, dmg: axe ? 21 : 13, kb: axe ? 20 : 14 });
        if (X.t > DUR[X.act]) go(X, 'chase');
        break;
      }
      case 'lunge': case 'spam': {
        X.w = 'spear';
        const per = DUR.lunge, k = X.t % per, nth = Math.floor(X.t / per);
        // lunge after lunge until he is close (or six of them), then up he goes for the mace
        if (X.act === 'spam' && (nth >= 6 || (nth >= D.left && (!tg || flat(X.pos, tg.pos) < 12)))) { go(X, 'air'); break; }
        if (k < 0.14) { if (tg) faceTo(X, tg.pos); X.vel.x = 0; X.vel.z = 0; X.data.from = X.pos.clone(); }
        else if (k < 0.4) { const f = fwd(X.yaw); X.vel.x = f.x * 58; X.vel.z = f.z * 58; }
        else { X.vel.x = 0; X.vel.z = 0; if (once(X, 'hit' + nth)) emit({ k: 'lunge', x: X.data.from.x, y: X.pos.y, z: X.data.from.z, x2: X.pos.x, z2: X.pos.z, w: 2.7, dmg: 15, kb: 22 }); }
        if (X.act === 'lunge' && X.t > per) go(X, 'chase');
        break;
      }
      case 'pearl': {
        X.w = 'pearl'; X.vel.x = 0; X.vel.z = 0;
        if (X.t > 0.25 && once(X, 'throw')) {
          const to = D.to.clone(), back = X.pos.clone().sub(to).setY(0).normalize().multiplyScalar(2.6); to.add(back); to.y = groundAt(to);
          D.land = to; emit({ k: 'throw', kind: 'pearl', x: X.pos.x, y: X.pos.y + 6, z: X.pos.z, x2: to.x, y2: to.y + 1, z2: to.z, dur: 0.75, arc: 7 });
        }
        if (X.t > 1.0 && once(X, 'tp')) {
          emit({ k: 'pearl', x: X.pos.x, y: X.pos.y, z: X.pos.z, x2: D.land.x, y2: D.land.y, z2: D.land.z });
          X.pos.copy(D.land); X.vel.set(0, 0, 0);
          lifeTx(l => (l && !l.dead && l.hp > 5 ? { ...l, hp: l.hp - 5 } : l));   // like Minecraft, a pearl costs the thrower 5 health
        }
        if (X.t > DUR.pearl) go(X, 'chase');
        break;
      }
      case 'charge': {
        X.w = 'wind'; X.vel.x = 0; X.vel.z = 0; if (tg) faceTo(X, tg.pos);
        if (X.t > 0.25 && once(X, 'throw')) {
          const to = D.to.clone(), dist = flat(X.pos, to), dur = Math.max(0.2, dist / 32);
          emit({ k: 'throw', kind: 'wind', x: X.pos.x, y: X.pos.y + 5, z: X.pos.z, x2: to.x, y2: to.y + 1.5, z2: to.z, dur, arc: 0 });
          H.pending.push({ at: n + dur * 1000, ev: { k: 'gust', x: to.x, y: to.y, z: to.z, r: 3.6, dmg: 3, vy: 34 } });
        }
        if (X.t > DUR.charge) go(X, 'chase');
        break;
      }
      case 'eat': {
        X.w = 'apple'; X.vel.x = 0; X.vel.z = 0;
        if (X.t > DUR.eat && once(X, 'heal')) { H.gaps++; net.xSet({ gaps: H.gaps }); lifeTx(l => (l && !l.dead ? { ...l, hp: Math.min(l.max, l.hp + X_HP.gap) } : l)); emit({ k: 'heal', x: X.pos.x, y: X.pos.y, z: X.pos.z }); }
        if (X.t > DUR.eat + 0.3) go(X, 'chase');
        break;
      }
      case 'block': { X.vel.x = 0; X.vel.z = 0; if (tg) faceTo(X, tg.pos); if (X.t > DUR.block) go(X, 'chase'); break; }
      // Wind charge at his feet, look up and pearl up, wind charge again: very high in about a second. Then down with
      // the mace onto his target, with a spear lunge on the way if they are far. Damage: 6, plus 5 for every stud he fell.
      case 'air': {
        const tgp = tg ? tg.pos : X.pos;
        if (X.t < 0.05 && once(X, 'g1')) { X.w = 'wind'; emit({ k: 'gust', x: X.pos.x, y: X.pos.y, z: X.pos.z, r: 3.6, dmg: 2, vy: 30, self: 1 }); X.vel.y = 42; X.vel.x = 0; X.vel.z = 0; X.peak = X.pos.y; D.from = X.pos.y; }
        if (X.t > 0.3 && once(X, 'p')) { X.w = 'pearl'; X.up = 1; emit({ k: 'throw', kind: 'pearl', x: X.pos.x, y: X.pos.y + 6, z: X.pos.z, x2: X.pos.x, y2: X.pos.y + 18, z2: X.pos.z, dur: 0.3, arc: 0 }); }
        if (X.t > 0.6 && once(X, 'tp')) { emit({ k: 'pearl', x: X.pos.x, y: X.pos.y, z: X.pos.z, x2: X.pos.x, y2: X.pos.y + 9, z2: X.pos.z }); X.pos.y += 9; X.vel.y = Math.max(X.vel.y, 8); }
        if (X.t > 0.78 && once(X, 'g2')) { X.w = 'wind'; X.up = 0; emit({ k: 'gust', x: X.pos.x, y: X.pos.y, z: X.pos.z, r: 3.2, dmg: 0, vy: 0 }); X.vel.y = 36; }
        X.peak = Math.max(X.peak, X.pos.y);
        if (X.t > 0.9 && X.vel.y < 0) {
          const hd = flat(X.pos, tgp);
          if (!D.spear && hd > 7 && X.pos.y - groundAt(X.pos) > 6) { D.spear = X.t; }
          if (D.spear && X.t - D.spear < 0.28) { X.w = 'spear'; faceTo(X, tgp); const f = fwd(X.yaw); X.vel.x = f.x * 44; X.vel.z = f.z * 44; }
          else { X.w = 'mace'; faceTo(X, tgp); const f = fwd(X.yaw), sp = Math.min(17, hd * 2.2); X.vel.x = f.x * sp; X.vel.z = f.z * sp; }
          // where he will land, for the red ring everyone sees
          const h = X.pos.y - groundAt(X.pos), vy = -X.vel.y, tt = (-vy + Math.sqrt(vy * vy + 2 * GRAV * h)) / GRAV;
          D.ring = [X.pos.x + X.vel.x * tt, X.pos.z + X.vel.z * tt];
        }
        if (X.t > 0.9 && X.onGround && once(X, 'smash')) {
          const fell = Math.max(0, X.peak - X.pos.y), dmg = Math.round(6 + 5 * fell);
          emit({ k: 'smash', x: X.pos.x, y: X.pos.y, z: X.pos.z, dmg, r1: 3.3, r2: 6.2, power: Math.min(2, 0.6 + fell / 22) });
          H.cd.air = n + 9000 + Math.random() * 5000; D.ring = null; go(X, 'smash');
        }
        if (X.t > DUR.air) go(X, 'chase');
        break;
      }
      case 'smash': X.w = 'mace'; X.vel.x = 0; X.vel.z = 0; if (X.t > DUR.smash) go(X, 'chase'); break;
    }
    physics(X, dt, X.act === 'dead' && X.onGround);
    if (flat(X.pos, ctx.arena) > ZONE + 30) { X.pos.set(ctx.arena.x, 0, ctx.arena.z); X.vel.set(0, 0, 0); }
    if (!L.dead) mobTick(dt, n, list);
    // send it all, 8 times a second, and a heartbeat so others know the host is still here
    if (n - H.lastSend > 120) {
      H.lastSend = n; H.ev = H.ev.filter(e => n - e.t < 2500);
      const m = {};
      for (const [i, e] of Object.entries(H.mobs)) if (e.out && !(xb.mobs && xb.mobs[i] && xb.mobs[i].dead)) m[i] = { p: [+e.pos.x.toFixed(2), +e.pos.y.toFixed(2), +e.pos.z.toFixed(2)], r: +e.yaw.toFixed(2), a: e.act, k: +(e.t || 0).toFixed(2), w: e.w || 'sword' };
      const s = { t: n, x: { p: [+X.pos.x.toFixed(2), +X.pos.y.toFixed(2), +X.pos.z.toFixed(2)], r: +X.yaw.toFixed(3), a: X.act, k: +X.t.toFixed(2), w: X.w, up: X.up || 0, ring: X.data && X.data.ring ? X.data.ring.map(v => +v.toFixed(1)) : 0 }, m, ev: H.ev };
      net.xSet({ s, hb: n });
    }
  }

  // ---------------- team null ----------------
  async function openPortal() {
    const a = ctx.arena, ang = Math.random() * Math.PI * 2, px = a.x + Math.cos(ang) * 16, pz = a.z + Math.sin(ang) * 16, yaw = Math.atan2(a.x - px, a.z - pz);
    const pool = await names();
    const picks = []; while (picks.length < 5) { const nm = pool[Math.floor(Math.random() * pool.length)]; if (!picks.includes(nm)) picks.push(nm); }
    const at = S() + 900, list = {};
    picks.forEach((nm, i) => { list[i] = { name: nm, gen: i === 0, hp: i === 0 ? X_HP.general : X_HP.mob, max: i === 0 ? X_HP.general : X_HP.mob, dead: false, at: at + 1400 + i * 1100 }; });
    net.xSet({ portal: { x: +px.toFixed(2), z: +pz.toFixed(2), yaw: +yaw.toFixed(3), at, breakAt: at + 1400 + 4 * 1100 + 5000 }, mobs: list });
  }
  async function names() {
    if (poolNames) return poolNames;
    try { poolNames = (await ctx.loadNames()).split(/\r?\n/).map(s => s.trim()).filter(s => /^[A-Za-z0-9]{3,16}$/.test(s)); } catch (e) { poolNames = []; }
    if (!poolNames.length) poolNames = ['m0xee11p4', 'kh7fvl', '877px18qg', 'f9eci5j', 'q2Lr0zT'];
    return poolNames;
  }
  function mobTick(dt, n, list) {
    const P = xb.portal, M = xb.mobs || {};
    for (const [i, m] of Object.entries(M)) {
      let e = H.mobs[i];
      if (!e && P && n >= m.at && !m.dead) {
        const f = fwd(P.yaw);
        e = H.mobs[i] = { pos: new THREE.Vector3(P.x - f.x * 0.5, 0, P.z - f.z * 0.5), vel: new THREE.Vector3(), yaw: P.yaw, onGround: true, act: 'chase', t: 0, cd: n + 1200, out: true, w: 'sword' };
        emit({ k: 'join', i: +i, x: e.pos.x, y: 0, z: e.pos.z });
      }
      if (!e || m.dead) { if (e && m.dead && !e.gone) { e.gone = true; emit({ k: 'poof', x: e.pos.x, y: e.pos.y, z: e.pos.z }); } continue; }
      e.t += dt;
      if (e.act === 'block' && e.t > 1.1) { e.act = 'chase'; e.t = 0; }
      let tg = null, best = 1e9;
      for (const f of list) { const d = flat(f.pos, e.pos); if (d < best) { best = d; tg = f; } }
      if (xb.life && xb.life.dead) tg = null;
      if (tg) {
        faceTo(e, tg.pos);
        const f = fwd(e.yaw), sp = best > 3 && e.act !== 'swing' && e.act !== 'block' ? (m.gen ? 12.5 : 11) : 0;
        e.vel.x = f.x * sp; e.vel.z = f.z * sp;
        if (e.onGround && (tg.pos.y - e.pos.y > 2 || Math.random() < dt * 0.4) && best > 5) e.vel.y = 22;
        if (e.act === 'swing' && e.t > 0.45) { e.act = 'chase'; e.t = 0; }
        if (best <= 3.8 && n > e.cd && e.act === 'chase') {
          e.cd = n + (m.gen ? 750 : 950); e.act = 'swing'; e.t = 0;
          emit({ k: 'mob', i: +i, x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: e.yaw, r: 4, dmg: m.gen ? 12 : 8, kb: 12 });
        } else if (e.act === 'chase' && Math.random() < dt * 0.25) { e.act = 'block'; e.t = 0; }
      } else { e.vel.x = 0; e.vel.z = 0; }
      physics(e, dt);
    }
    if (P && P.breakAt && n > P.breakAt && !H.portalBroke) { H.portalBroke = true; emit({ k: 'portalbreak' }); }
  }

  // ---------------- what everyone sees (and whether it hit you) ----------------
  function play(e) {
    const me = ctx.player(), mp = me.pos, sc = scene;
    const hurt = (dmg, kx, kz, vy, how) => { if (dmg > 0 || vy) ctx.hurtMe(dmg, { kx, kz, vy, how }); };
    const add = f => f && ctx.addFx(f);
    switch (e.k) {
      case 'sweep': case 'axe': case 'mob': {
        add(FX.sweep(sc, e.x, e.y, e.z, e.yaw)); ctx.sound(e.k === 'axe' ? 'axe' : 'sword');
        if (e.k === 'axe') add(FX.crit(sc, e.x + Math.sin(e.yaw) * 2, e.y, e.z + Math.cos(e.yaw) * 2));
        const dx = mp.x - e.x, dz = mp.z - e.z, d = Math.hypot(dx, dz);
        if (d <= e.r && Math.abs(mp.y - e.y) < 5 && (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / (d || 1) > 0.1) hurt(e.dmg, Math.sin(e.yaw) * e.kb, Math.cos(e.yaw) * e.kb, 9, e.k === 'mob' ? `was slain by ${mobName(e.i)}` : `was slain by ____X____ using [${e.k === 'axe' ? 'Netherite Axe' : 'Netherite Sword'}]`);
        break;
      }
      case 'lunge': {
        ctx.sound('lunge');
        const ax = e.x2 - e.x, az = e.z2 - e.z, len = Math.hypot(ax, az) || 1, ux = ax / len, uz = az / len;
        const along = (mp.x - e.x) * ux + (mp.z - e.z) * uz, side = Math.abs((mp.x - e.x) * uz - (mp.z - e.z) * ux);
        if (along > -1 && along < len + 2 && side < e.w && Math.abs(mp.y - e.y) < 5) hurt(e.dmg, ux * e.kb, uz * e.kb, 10, 'was skewered by ____X____ using [Netherite Spear]');
        break;
      }
      case 'gust': {
        add(FX.gust(sc, e.x, e.y, e.z)); ctx.sound('gust');
        // it launches him, and you too if you are in the gust
        const d = Math.hypot(mp.x - e.x, mp.z - e.z);
        if (e.r && e.vy && d <= e.r && Math.abs(mp.y - e.y) < 4) hurt(e.dmg || 0, (mp.x - e.x) / (d || 1) * 11, (mp.z - e.z) / (d || 1) * 11, e.vy, 'was blown away by ____X____');
        break;
      }
      case 'smash': {
        add(FX.smash(sc, e.x, e.y, e.z, e.power || 1)); add(FX.crit(sc, e.x, e.y, e.z)); ctx.sound('smash'); ctx.shake(Math.min(1.4, (e.power || 1) * 0.8));
        const d = Math.hypot(mp.x - e.x, mp.z - e.z);
        if (Math.abs(mp.y - e.y) < 4 && d <= e.r2) { const full = d <= e.r1; hurt(full ? e.dmg : Math.round(e.dmg / 2), (mp.x - e.x) / (d || 1) * 16, (mp.z - e.z) / (d || 1) * 16, 14, 'was smashed by ____X____ using [Mace]'); }
        break;
      }
      case 'throw': add(FX.throw(sc, e.kind, new THREE.Vector3(e.x, e.y, e.z), new THREE.Vector3(e.x2, e.y2, e.z2), e.dur, e.arc)); ctx.sound(e.kind === 'pearl' ? 'throw' : 'windthrow'); break;
      case 'pearl': add(FX.portal(sc, e.x, e.y, e.z)); add(FX.portal(sc, e.x2, e.y2, e.z2)); ctx.sound('pearl'); if (xm && disp) disp.snap = true; break;
      case 'totem': add(FX.totem(sc, e.x, e.y, e.z)); ctx.sound('totem'); ctx.shake(0.5); break;
      case 'heal': add(FX.heal(sc, e.x, e.y, e.z)); ctx.sound('burp'); break;
      case 'xdie': if (xm) xm.die(); setTimeout(() => ctx.addFx(FX.poof(scene, e.x, e.y, e.z)), 1300); break;
      case 'poof': add(FX.poof(sc, e.x, e.y, e.z)); break;
      case 'join': add(FX.portal(sc, e.x, 1, e.z)); ctx.chat(`${mobName(e.i)} joined the game`, '#ffff55'); ctx.sound('portal'); break;
      case 'leave': ctx.chat(`${mobName(e.i)} left the game`, '#ffff55'); if (mobs[e.i]) { const p = mobs[e.i].pos; add(FX.poof(sc, p.x, p.y, p.z)); mobs[e.i].model.dispose(); delete mobs[e.i]; } break;
      case 'portalbreak': if (portal) portal.break(); ctx.sound('glass'); break;
    }
  }
  const mobName = i => ((xb && xb.mobs && xb.mobs[i]) || {}).name || 'null';

  // Your move or punch: does it hit X or one of his soldiers? Shields cut hits from the front.
  function hitFrom(f, dmg, hitTest) {
    if (!live() || !dmg) return;
    const me = ctx.player().pos, n = S(), L = xb.life || {}, targets = [];
    if (xm && disp && disp.x && !L.dead && !((L.inv || 0) > n)) targets.push({ uid: 'x', pos: disp.x.pos, act: disp.x.a, yaw: disp.x.r });
    for (const [i, m] of Object.entries(mobs)) if (xb.mobs && xb.mobs[i] && !xb.mobs[i].dead) targets.push({ uid: 'm' + i, pos: m.pos, act: m.a, yaw: m.r });
    let hits;
    if (f.kind === 'punch') { let best = null; for (const t of targets) { const d = flat(t.pos, me); if (d < 5.2 && (!best || d < best.d)) best = { t, d }; } hits = best ? [best.t] : []; }
    else { const ring = []; for (const t of targets) for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) ring.push({ uid: t.uid, pos: { x: t.pos.x + dx, z: t.pos.z + dz }, t }); const got = new Set(hitTest(f, ring).map(h => h.uid)); hits = targets.filter(t => got.has(t.uid)); }
    for (const t of hits) {
      let d = dmg;
      if (t.act === 'block') { const dx = me.x - t.pos.x, dz = me.z - t.pos.z, dl = Math.hypot(dx, dz) || 1; if ((dx * Math.sin(t.yaw) + dz * Math.cos(t.yaw)) / dl > 0.2) { d = Math.max(1, Math.round(dmg * 0.2)); ctx.sound('block'); } }
      if (t.uid === 'x') {
        net.xLife(l => {
          if (!l || l.dead || (l.inv || 0) > S()) return l;
          l.hp -= d;
          if (l.hp <= 0) { if (l.phase === 1) { l.phase = 2; l.hp = X_HP.p2; l.max = X_HP.p2; l.totemAt = S(); l.inv = S() + 2400; } else { l.hp = 0; l.dead = true; l.deadAt = S(); } }
          return l;
        }).then(r => { if (r && r.committed) { myDmg += d; if (H) H.recent.push({ t: S(), d }); } }).catch(() => {});
      } else {
        const i = t.uid.slice(1);
        net.xMob(i, m => { if (!m || m.dead) return m; m.hp -= d; if (m.hp <= 0) { m.hp = 0; m.dead = true; m.by = uid; } return m; }).catch(() => {});
      }
    }
  }
  // you died: your damage counter goes back to 0 (so X looks for someone else) and it counts against the aura
  function onMyDeath() { if (!live()) return; myDmg = 0; net.xDmg(0); dmgSent = 0; net.xDied(); }

  // ---------------- every frame ----------------
  function update(dt) {
    if (!xb || !xb.id) return;
    const n = S();
    if (isHost() && !H) becomeHost();
    if (H && !isHost()) H = null;
    if (H && live()) hostTick(dt);
    else if (H && xb.life && xb.life.dead) hostTick(dt);
    // the host is gone (no heartbeat): someone near the Pit takes over
    if (!isHost() && live() && (xb.hb || 0) < n - 3500 && n - (update.tried || 0) > 2000) { update.tried = n; net.xHost(uid).then(r => { if (r && r.committed && r.snapshot.val().host === uid) becomeHost(); }).catch(() => {}); }
    if (myDmg !== dmgSent && n - lastDmgSend > 500) { dmgSent = myDmg; lastDmgSend = n; net.xDmg(myDmg); }
    draw(dt, n);
  }
  function draw(dt, n) {
    const s = xb.s, showing = xb.life && (!xb.gone || (xb.life.dead && n - (xb.life.deadAt || 0) < 9000));
    if (!showing || (!s && !H)) { if (xm && xb.gone && !xb.life.dead) { ctx.addFx(FX.portal(scene, xm.root.position.x, xm.root.position.y, xm.root.position.z)); teardown(); } return; }
    // X
    const want = H ? { p: [H.x.pos.x, H.x.pos.y, H.x.pos.z], r: H.x.yaw, a: H.x.act, k: H.x.t, w: H.x.w, up: H.x.up, ring: H.x.data && H.x.data.ring } : s.x;
    if (!want) return;
    if (!xm) { xm = createMcPerson(scene, { trim: '#e4ded8', name: '____X____' }); disp = { x: { pos: v3(want.p), r: want.r, a: want.a, t: 0 } }; }
    const dx = disp.x, wp = v3(want.p);
    if (H || disp.snap || dx.pos.distanceTo(wp) > 14) { dx.pos.copy(wp); disp.snap = false; } else dx.pos.lerp(wp, 1 - Math.exp(-dt * 14));
    let dr = want.r - dx.r; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); dx.r += dr * Math.min(1, dt * 14);
    if (want.a !== dx.a) { dx.a = want.a; dx.t = want.k || 0; } else dx.t += dt;
    xm.root.position.copy(dx.pos); xm.root.rotation.y = dx.r;
    xm.hold(want.w === 'totem' ? 'totem' : want.w);
    const act = { sword: 'swing', axe: 'axe', lunge: 'lunge', spam: 'lunge', eat: 'eat', block: 'block', totem: 'totem', smash: 'smash', pearl: 'throw', charge: 'throw' }[dx.a] || (dx.a === 'air' ? (want.w === 'mace' ? 'raise' : want.w === 'spear' ? 'lunge' : 'air') : null);
    const k = dx.a === 'sword' ? dx.t / DUR.sword : dx.a === 'axe' ? dx.t / DUR.axe : dx.a === 'smash' ? dx.t / DUR.smash : dx.a === 'pearl' || dx.a === 'charge' ? dx.t / 0.5 : 0;
    if (!xm.pose(dt, { speed: dx.a === 'chase' ? 12 : 0, act, k, lookUp: !!want.up }) && dx.a === 'dead') xm.root.visible = false;
    if (dx.a === 'eat' && Math.random() < dt * 6) ctx.addFx(FX.crumbs(scene, dx.pos.x + Math.sin(dx.r) * 1.2, dx.pos.y + 6.6, dx.pos.z + Math.cos(dx.r) * 1.2));
    if (dx.a === 'eat' && (n / 300 | 0) !== ((n - dt * 1000) / 300 | 0)) ctx.sound('eat');
    ring(want.ring);
    // the portal
    const P = xb.portal;
    if (P && !portal && n < (P.breakAt || 0) + 2500 && !xb.life.dead) { portal = createPortal(scene, P.x, P.z, P.yaw); ctx.sound('portal'); }
    if (portal && !portal.update(dt)) portal = null;
    // the soldiers
    const M = H ? Object.fromEntries(Object.entries(H.mobs).filter(([, e]) => e.out).map(([i, e]) => [i, { p: [e.pos.x, e.pos.y, e.pos.z], r: e.yaw, a: e.act, w: e.w }])) : (s && s.m) || {};
    for (const [i, m] of Object.entries(M)) {
      const info = xb.mobs && xb.mobs[i]; if (!info || info.dead || xb.life.dead) continue;
      let o = mobs[i];
      if (!o) { o = mobs[i] = { model: createMcPerson(scene, { trim: info.gen ? '#e3241b' : null, name: info.name, scale: info.gen ? 1.06 : 0.96 }), pos: v3(m.p), r: m.r, a: m.a }; o.model.hold('sword'); }
      const tp = v3(m.p); if (H || o.pos.distanceTo(tp) > 12) o.pos.copy(tp); else o.pos.lerp(tp, 1 - Math.exp(-dt * 14));
      let r2 = m.r - o.r; r2 = Math.atan2(Math.sin(r2), Math.cos(r2)); o.r += r2 * Math.min(1, dt * 14); o.a = m.a;
      o.model.root.position.copy(o.pos); o.model.root.rotation.y = o.r;
      o.swingT = m.a === 'swing' ? (o.swingT || 0) + dt : 0;
      o.model.pose(dt, { speed: m.a === 'chase' ? 10 : 0, act: m.a === 'swing' ? 'swing' : m.a === 'block' ? 'block' : null, k: Math.min(1, o.swingT / 0.45) });
    }
    for (const [i, o] of Object.entries(mobs)) { const info = xb.mobs && xb.mobs[i]; if (!info || info.dead) { if (!o.dying) { o.dying = true; o.model.die(); } if (!o.model.pose(dt, {})) { o.model.dispose(); delete mobs[i]; } } }
  }
  // the red ring where he will land
  let ringMesh = null;
  function ring(r) {
    if (!r) { if (ringMesh) ringMesh.visible = false; return; }
    if (!ringMesh) { ringMesh = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.3, 40), new THREE.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false })); ringMesh.rotation.x = -Math.PI / 2; scene.add(ringMesh); }
    ringMesh.visible = true; ringMesh.position.set(r[0], groundAt({ x: r[0], y: 40, z: r[1] }) + 0.15, r[1]);
  }

  // ---------------- the end: rewards by damage ----------------
  function reward() {
    const dmg = xb.dmg || {}, died = (xb.died || {})[uid] || 0;
    const mine = Math.max(myDmg, dmg[uid] || 0);
    const ranks = Object.entries({ ...dmg, [uid]: mine }).filter(([, d]) => d > 0).sort((a, b) => b[1] - a[1]);
    const rank = ranks.findIndex(([u]) => u === uid) + 1;
    if (!rank) return;
    ctx.onWin({ rank, dmg: mine, died, players: ranks.length, aura: rank === 1 && died === 0 && mine >= 250 });
  }

  return {
    onState, update, hitFrom, onMyDeath, start, stop, tryScheduled,
    live, get host() { return isHost(); },
    near: p => !!(xb && live() && flat(p, ctx.arena) < 140),
    // for the boss bar
    info() {
      if (!xb || !xb.life || !(live() || (xb.life.dead && S() - (xb.life.deadAt || 0) < 6000))) return null;
      const M = Object.values(xb.mobs || {});
      return { hp: xb.life.hp, max: xb.life.max, phase: xb.life.phase, dead: xb.life.dead, left: (xb.until || 0) - S(), mobs: M.filter(m => !m.dead).length, mobsTotal: M.length, myDmg, rank: Object.entries({ ...(xb.dmg || {}), [uid]: myDmg }).filter(([, d]) => d > 0).sort((a, b) => b[1] - a[1]).findIndex(([u]) => u === uid) + 1 };
    },
    dispose() { teardown(); if (ringMesh) { scene.remove(ringMesh); ringMesh = null; } },
  };
}
