// Mouse Maze (v4.64; reworked in v4.66): guide the mouse from the green square to the gold one without touching a wall.
// 125 levels, each built from its own fixed seed, so a level is the same for everyone and every time. Computer only:
// it needs a mouse and fullscreen (the Fullscreen button, or F11), and pauses whenever you leave fullscreen or the
// window. Right-click does nothing here (so it can't be used to freeze the game).
// v4.66 (request 39, "users are ANGRY"): the game has its own mouse. While you play, the browser's pointer is locked
// and hidden (the Pointer Lock API: Esc gives it back and pauses), and the game moves a mouse of its own by how far you
// move. So touching something puts the mouse straight back on your checkpoint, a new level starts it on the green
// square (not where the last level's gold square was), and the gold square needs a CLICK to finish. Moves are still
// checked along the whole line between two positions, so a fast flick can't jump through a wall. Browsers without
// Pointer Lock play the old way (move your own pointer back onto the highlighted square).
// Orbs: a little for every clear (replays too) and more the first time, paid the way every Frixion game pays
// (script.js gives this file `api`).
const LEVELS = 125;
const W = 1600, H = 900;                       // the level's own units; the canvas scales them to the screen
let api = null, root = null, cv = null, ctx = null, raf = 0, level = null, state = 'menu', t0 = 0, deaths = 0;
let progress = { best: 0, cleared: '' }, arm = null, last = null, paused = '', msg = '', msgUntil = 0, offFns = [];
let pos = null, frozenUntil = 0, atEnd = false, flawless = 0, wonAt = 0, lockAt = 0;
let botOn = false, botWp = 1, botLastAt = 0;
let padOn = false, padTouch = false, padSlow = false, padVec = { x: 0, y: 0 }, padPtrId = null, padLastAt = 0, padUsedRun = false, hwFinishPrev = false;
let padEl = null, stickEl = null, knobEl = null, slowBtn = null, finBtn = null, padBtn = null;
const botAllowed = () => !!(botOn && api && typeof api.isOwner === 'function' && api.isOwner());
const canLock = () => !!(cv && cv.requestPointerLock);
const locked = () => !!cv && document.pointerLockElement === cv;
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function reqFull(el) {
  if (!el) return Promise.reject();
  try {
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return Promise.reject();
    const r = fn.call(el);
    return r && typeof r.then === 'function' ? r : Promise.resolve();
  } catch (e) { return Promise.reject(e); }
}
function exitFull() {
  try {
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (fn) { const r = fn.call(document); if (r && r.catch) r.catch(() => {}); }
  } catch (e) {}
}

// ---------- seeded numbers ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- building a level ----------
// The path goes cell to cell through a grid from the left side to the right. The corridor is the path's cells and
// the joins between them, `width` wide; everything else is wall. Obstacles move across it; tricks sit on dead ends.
function build(n) {
  const r = rng(n * 7919 + 1013);
  const C = 7 + Math.floor(n / 9), R = 4 + Math.floor(n / 13);
  const cs = Math.min((W - 80) / C, (H - 80) / R), ox = (W - cs * C) / 2, oy = (H - cs * R) / 2;
  const width = cs * Math.max(0.3, 0.72 - n * 0.0034);
  const want = Math.min(Math.floor(C * R * 0.6), 8 + Math.floor(n * 0.55));
  const center = (c, rr) => ({ x: ox + cs * (c + 0.5), y: oy + cs * (rr + 0.5) });
  // a path from the left column to the right one: a random walk that leans right, with backtracking
  const key = (c, rr) => c + ',' + rr;
  let path = null;
  for (let tries = 0; tries < 40 && !path; tries++) {
    const start = [0, Math.floor(r() * R)], seen = new Set([key(...start)]), stack = [start];
    let steps = 0;
    while (stack.length && steps < 4000) {
      steps++;
      const [c, rr] = stack[stack.length - 1];
      if (c === C - 1 && stack.length >= Math.min(want, C + 2)) { path = stack.slice(); break; }
      const opts = [[1, 0], [0, 1], [0, -1], [-1, 0]].map(([dc, dr]) => [c + dc, rr + dr])
        .filter(([a, b]) => a >= 0 && b >= 0 && a < C && b < R && !seen.has(key(a, b)));
      if (!opts.length) { stack.pop(); continue; }
      // lean right once the path is long enough, wander before that
      const push = stack.length < want * 0.7 ? 0.25 : 0.7;
      opts.sort(() => r() - 0.5);
      const pick = opts.find(([a]) => a > c && r() < push) || opts[0];
      seen.add(key(...pick));
      stack.push(pick);
    }
  }
  if (!path) { path = []; for (let c = 0; c < C; c++) path.push([c, Math.floor(R / 2)]); }
  const onPath = new Set(path.map(p => key(...p)));
  const rects = [];                                     // the corridor: axis-aligned rectangles
  const addSquare = (p, s) => rects.push({ x: p.x - s / 2, y: p.y - s / 2, w: s, h: s });
  const addJoin = (a, b) => rects.push({ x: Math.min(a.x, b.x) - width / 2, y: Math.min(a.y, b.y) - width / 2, w: Math.abs(a.x - b.x) + width, h: Math.abs(a.y - b.y) + width });
  path.forEach((p, i) => { const c = center(...p); addSquare(c, width); if (i) addJoin(center(...path[i - 1]), c); });
  const zone = (cell, kind) => { const c = center(...cell); return { kind, x: c.x - width * 0.42, y: c.y - width * 0.42, w: width * 0.84, h: width * 0.84 }; };
  const startZone = zone(path[0], 'start'), endZone = zone(path[path.length - 1], 'end');
  // checkpoints on long paths
  const checkpoints = [];
  if (path.length > 18) for (let i = 12; i < path.length - 4; i += 12) checkpoints.push({ ...zone(path[i], 'check'), at: i });
  // tricks (level 10 on): a dead end off the path with a fake finish, or a fake checkpoint
  const tricks = [];
  const tryBranch = kind => {
    for (let a = 0; a < 30; a++) {
      const i = 3 + Math.floor(r() * Math.max(1, path.length - 6)), [c, rr] = path[i];
      const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc, dr]) => [c + dc, rr + dr])
        .filter(([x, y]) => x >= 0 && y >= 0 && x < C && y < R && !onPath.has(key(x, y)));
      if (!opts.length) continue;
      const end = opts[Math.floor(r() * opts.length)];
      onPath.add(key(...end));
      addJoin(center(c, rr), center(...end)); addSquare(center(...end), width);
      tricks.push(zone(end, kind));
      return;
    }
  };
  if (n >= 10) { const k = 1 + Math.floor(n / 45); for (let i = 0; i < k; i++) tryBranch(i % 2 ? 'fakecheck' : 'fakeend'); }
  // obstacles across the corridor at path cells (never on the start, the end or a checkpoint)
  const obstacles = [], speed = 1 + n / 55;
  const count = n < 4 ? 0 : Math.min(18, Math.floor((n - 2) / 5) + 1);
  const types = ['h', ...(n >= 8 ? ['v'] : []), ...(n >= 14 ? ['spin'] : []), ...(n >= 20 ? ['grow'] : [])];
  const used = new Set([0, path.length - 1, ...checkpoints.map(c => c.at)]);
  for (let k = 0; k < count; k++) {
    let i = 0;
    for (let a = 0; a < 20; a++) { i = 2 + Math.floor(r() * Math.max(1, path.length - 4)); if (!used.has(i) && !used.has(i - 1) && !used.has(i + 1)) break; }
    if (used.has(i)) continue;
    used.add(i);
    const c = center(...path[i]), type = types[Math.floor(r() * types.length)];
    obstacles.push({ type, x: c.x, y: c.y, size: width * (0.28 + r() * 0.12), amp: width * 0.5, sp: speed * (0.7 + r() * 0.6), ph: r() * Math.PI * 2, len: width * 0.92 });
  }
  // Build obstacle-aware bot waypoints: skirts around obstacle centers (0.48 * width from center, strictly inside corridor)
  const rawWps = path.map(p => center(...p)), obsIdx = new Set();
  obstacles.forEach(o => {
    const idx = rawWps.findIndex(w => Math.hypot(w.x - o.x, w.y - o.y) < 4);
    if (idx > 0 && idx < rawWps.length - 1) obsIdx.add(idx);
  });
  const waypoints = [rawWps[0]], wpIndexForCell = [0];
  const d = width * 0.48;
  for (let i = 1; i < rawWps.length; i++) {
    wpIndexForCell[i] = waypoints.length;
    if (!obsIdx.has(i)) { waypoints.push(rawWps[i]); continue; }
    const prev = rawWps[i - 1], cur = rawWps[i], next = rawWps[i + 1];
    const id = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1, ix = (cur.x - prev.x) / id, iy = (cur.y - prev.y) / id;
    const od = Math.hypot(next.x - cur.x, next.y - cur.y) || 1, ox = (next.x - cur.x) / od, oy = (next.y - cur.y) / od;
    if (Math.abs(ix - ox) < 0.01 && Math.abs(iy - oy) < 0.01) {
      const px = -iy, py = ix;
      waypoints.push({ x: cur.x - ix * d + px * d, y: cur.y - iy * d + py * d });
      waypoints.push({ x: cur.x + ix * d + px * d, y: cur.y + iy * d + py * d });
    } else {
      waypoints.push({ x: cur.x - ix * d - ox * d, y: cur.y - iy * d - oy * d });
      waypoints.push({ x: cur.x + ix * d - ox * d, y: cur.y + iy * d - oy * d });
      waypoints.push({ x: cur.x + ix * d + ox * d, y: cur.y + iy * d + oy * d });
    }
  }
  return { n, rects, start: startZone, end: endZone, checkpoints, tricks, obstacles, width, waypoints, wpIndexForCell };
}

// ---------- what's where at time t ----------
const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const middle = z => ({ x: z.x + z.w / 2, y: z.y + z.h / 2 });
function obstacleShape(o, t) {
  const s = Math.sin(t * o.sp + o.ph);
  if (o.type === 'h') return { box: { x: o.x + s * o.amp - o.size / 2, y: o.y - o.size / 2, w: o.size, h: o.size } };
  if (o.type === 'v') return { box: { x: o.x - o.size / 2, y: o.y + s * o.amp - o.size / 2, w: o.size, h: o.size } };
  if (o.type === 'grow') { const z = o.len * (0.45 + 0.4 * s); return { box: { x: o.x - z / 2, y: o.y - z / 2, w: z, h: z } }; }
  const a = t * o.sp * 1.3 + o.ph, dx = Math.cos(a) * o.len / 2, dy = Math.sin(a) * o.len / 2;
  return { bar: { x1: o.x - dx, y1: o.y - dy, x2: o.x + dx, y2: o.y + dy, th: Math.max(8, o.size * 0.35) } };
}
function hitsObstacle(p, t) {
  for (const o of level.obstacles) {
    const sh = obstacleShape(o, t);
    if (sh.box && inRect(p, sh.box)) return true;
    if (sh.bar) {
      const { x1, y1, x2, y2, th } = sh.bar, vx = x2 - x1, vy = y2 - y1, len2 = vx * vx + vy * vy;
      const k = Math.max(0, Math.min(1, ((p.x - x1) * vx + (p.y - y1) * vy) / len2)), qx = x1 + k * vx, qy = y1 + k * vy;
      if ((p.x - qx) ** 2 + (p.y - qy) ** 2 < (th / 2) ** 2) return true;
    }
  }
  return false;
}
// what touching this point does: 'wall', 'trick', 'end', 'check' (with which), or null (fine)
function touch(p, t) {
  if (!level.rects.some(r => inRect(p, r))) return { what: 'wall' };
  for (const tr of level.tricks) if (inRect(p, tr)) return { what: 'trick', kind: tr.kind };
  if (hitsObstacle(p, t)) return { what: 'wall' };
  if (inRect(p, level.end)) return { what: 'end' };
  for (const c of level.checkpoints) if (inRect(p, c)) return { what: 'check', c };
  return null;
}

// ---------- playing ----------
const scaleOf = () => { const b = cv.getBoundingClientRect(); return Math.min(b.width / W, b.height / H) || 1; };
function toLevel(e) {
  const b = cv.getBoundingClientRect(), s = Math.min(b.width / W, b.height / H), ox = (b.width - W * s) / 2, oy = (b.height - H * s) / 2;
  return { x: (e.clientX - b.left - ox) / s, y: (e.clientY - b.top - oy) / s };
}
const isFull = () => !!fsEl() || (Math.abs(window.innerHeight - screen.height) < 6 && Math.abs(window.innerWidth - screen.width) < 6);
function resetStick() {
  padVec = { x: 0, y: 0 }; padPtrId = null;
  if (stickEl) stickEl.classList.remove('active');
  if (knobEl) knobEl.style.transform = '';
}
function say(text, ms) { msg = text; msgUntil = performance.now() + (ms || 1600); }
function lockPointer() {
  if (!canLock() || locked()) return;
  try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}
// The mouse goes onto a square (the start, or the checkpoint after a touch), held still a moment so a hand still moving
// doesn't carry it straight into the next wall.
function placeOn(z, holdMs) {
  pos = middle(z); last = pos; atEnd = false; frozenUntil = performance.now() + (holdMs || 0);
  if (level && level.waypoints) {
    if (z === level.start) botWp = 1;
    else if (z && typeof z.at === 'number' && level.wpIndexForCell) botWp = Math.min(level.waypoints.length - 1, (level.wpIndexForCell[z.at] || 0) + 1);
  }
}
function startLevel(n) {
  level = build(n); arm = level.start; deaths = 0; t0 = performance.now(); atEnd = false; botWp = 1; padUsedRun = padOn;
  if (canLock() || botAllowed() || padOn) {
    placeOn(level.start, botAllowed() ? 80 : 250);
    state = 'play';
    if (!botAllowed() && !padOn) lockPointer();
    say(botAllowed() ? 'BOT active.' : padOn ? 'Steer with the stick. Tap FINISH on gold.' : locked() ? 'Go! Reach the gold square and click it.' : 'Click the maze to start.', 2400);
  } else {
    state = 'arming'; last = null; pos = null;
    say('Move the mouse onto the green square to start.', 2600);
  }
  showMenu(false);
}
function die(why) {
  deaths++; flawless = 0;
  say(why === 'trick' ? 'That one was a trick. Back to your checkpoint.' : why === 'left' ? 'You left the maze. Back to your checkpoint.' : 'You touched a wall. Back to your checkpoint.', 1800);
  if (why === 'trick') api.egg('tricked');
  if (canLock() || padOn) placeOn(arm, 450);       // straight back onto the checkpoint (or the start)
  else { state = 'arming'; last = null; }
}
function clear() {
  const n = level.n, first = progress.cleared[n - 1] !== '1';
  const orbs = 1 + Math.floor(n / 12) + (first ? 15 + 2 * n : 0);
  const cl = progress.cleared.padEnd(LEVELS, '0').split('');
  cl[n - 1] = '1';
  progress = { best: Math.max(progress.best, n), cleared: cl.join('') };
  api.save(progress, orbs);
  if (n >= 50) api.egg('mazehalf');
  if ((padOn || padUsedRun) && !botAllowed()) api.egg('pocketmaze');
  flawless = deaths ? 0 : flawless + 1;
  if (flawless >= 10) api.egg('mazeflawless');     // ten levels in a row without touching anything
  state = 'won'; wonAt = performance.now(); atEnd = false;
  resetStick();
  say(`Level ${n} cleared${first ? ' for the first time' : ''}! +${orbs} Orbs${deaths ? ` (${deaths} ${deaths === 1 ? 'try' : 'tries'})` : ' without a single touch'}`, 2400);
  setTimeout(() => { if (state === 'won') { if (n < LEVELS) startLevel(n + 1); else { showMenu(true); say('That was the last level. You beat Mouse Maze.', 4000); } } }, botAllowed() ? 650 : 2000);
}
// one step of the mouse, from where it was to `p`, checked all the way along
function moveTo(p) {
  const t = (performance.now() - t0) / 1000;
  const from = last || p, d = Math.hypot(p.x - from.x, p.y - from.y), steps = Math.max(1, Math.ceil(d / 3));
  let inEnd = false;
  for (let i = 1; i <= steps; i++) {
    const q = { x: from.x + (p.x - from.x) * i / steps, y: from.y + (p.y - from.y) * i / steps }, hit = touch(q, t);
    if (!hit) continue;
    if (hit.what === 'wall') return die('wall');
    if (hit.what === 'trick') return die('trick');
    if (hit.what === 'end') { inEnd = true; continue; }
    if (hit.what === 'check' && arm !== hit.c) { arm = hit.c; say('Checkpoint.', 900); }
  }
  last = p; pos = p;
  inEnd = inEnd && inRect(p, level.end);
  if (inEnd && !atEnd) say(padOn ? 'Tap FINISH!' : 'Click to finish!', 1400);
  atEnd = inEnd;
}
function onMove(e) {
  if (botAllowed() || padOn || !level || paused || state === 'menu' || state === 'won') return;
  if (canLock()) {
    if (!locked() || state !== 'play' || !pos) return;
    const now = performance.now();
    if (now < frozenUntil || now - lockAt < 60) return;
    if (Math.hypot(e.movementX || 0, e.movementY || 0) > 350) return;
    const s = scaleOf();
    moveTo({ x: Math.max(0, Math.min(W, pos.x + e.movementX / s)), y: Math.max(0, Math.min(H, pos.y + e.movementY / s)) });
    return;
  }
  const p = toLevel(e);
  if (state === 'arming') {                       // (no Pointer Lock) waiting on the start square or the last checkpoint
    if (inRect(p, arm)) { state = 'play'; last = p; pos = p; say(arm === level.start ? 'Go!' : 'Go on!', 700); }
    return;
  }
  moveTo(p);
}
function onDown(e) {
  if (botAllowed() || e.button !== 0 || !level || state === 'menu' || state === 'won') return;
  if (padOn) { if (atEnd && state === 'play') clear(); return; }
  if (canLock() && !locked()) { lockPointer(); return; }   // clicking the maze takes the mouse back
  if (paused) return;
  if (atEnd && state === 'play') clear();
}
function onLeave() { if (!botAllowed() && !padOn && !canLock() && state === 'play' && !paused) die('left'); }
function checkPause() {
  if (botAllowed() || padOn) { paused = ''; return; }
  const why = !isFull() ? 'full' : !document.hasFocus() ? 'focus' : (canLock() && level && state === 'play' && !locked()) ? 'lock' : '';
  if (why === paused) return;
  paused = why;
  if (why && state === 'play' && !canLock()) { state = 'arming'; last = null; }   // pick up again from the square you're on
}
// ---------- mobile virtual gamepad + Bluetooth/USB hardware gamepad ----------
function syncPadUI() {
  if (!root) return;
  root.classList.toggle('mz-pad-on', padOn);
  if (padEl) padEl.hidden = !padOn;
  if (padBtn) {
    padBtn.classList.toggle('on', padOn);
    padBtn.textContent = padOn ? 'Gamepad: ON' : 'Gamepad';
  }
  if (slowBtn) {
    slowBtn.classList.toggle('on', padSlow);
    slowBtn.setAttribute('aria-pressed', padSlow ? 'true' : 'false');
    slowBtn.textContent = padSlow ? 'SLOW: ON' : 'SLOW';
  }
  if (finBtn) {
    const rdy = state === 'play' && atEnd;
    finBtn.disabled = !rdy;
    finBtn.classList.toggle('ready', rdy);
  }
}
function setPadMode(on) {
  padOn = !!on;
  if (padOn) {
    paused = '';
    if (locked()) document.exitPointerLock();
    if (level && state === 'arming' && arm) { placeOn(arm, 0); state = 'play'; }
    if (level && state === 'play' && !pos) placeOn(arm || level.start, 0);
  } else {
    padVec = { x: 0, y: 0 }; padPtrId = null;
    if (knobEl) knobEl.style.transform = '';
  }
  syncPadUI();
}
function padStep(now) {
  if (botAllowed() || !level || state !== 'play' || paused) { padLastAt = now; return; }
  const dt = padLastAt ? Math.min(0.05, Math.max(0.004, (now - padLastAt) / 1000)) : 0.016;
  padLastAt = now;
  let vx = padOn ? padVec.x : 0, vy = padOn ? padVec.y : 0, slow = padSlow, hwFin = false;
  // Also poll real Bluetooth/USB controllers via the Web Gamepad API
  try {
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of gps) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.15) { vx = ax; vy = ay; padUsedRun = true; }
      const up = gp.buttons[12] && gp.buttons[12].pressed, dn = gp.buttons[13] && gp.buttons[13].pressed;
      const lt = gp.buttons[14] && gp.buttons[14].pressed, rt = gp.buttons[15] && gp.buttons[15].pressed;
      if (up || dn || lt || rt) { vx = (rt ? 1 : 0) - (lt ? 1 : 0); vy = (dn ? 1 : 0) - (up ? 1 : 0); padUsedRun = true; }
      if ((gp.buttons[4] && gp.buttons[4].pressed) || (gp.buttons[6] && gp.buttons[6].pressed)) slow = true;
      if (gp.buttons[0] && gp.buttons[0].pressed) hwFin = true;
    }
  } catch (_) {}
  if (hwFin && !hwFinishPrev && atEnd) { padUsedRun = true; clear(); }
  hwFinishPrev = hwFin;
  const mag = Math.hypot(vx, vy);
  if (mag < 0.04 || now < frozenUntil) return;
  if (!pos) placeOn(arm || level.start, 0);
  const clamped = Math.min(1, mag);
  const curve = 0.2 * clamped + 0.8 * clamped * clamped;
  const maxSpd = slow ? 155 : 440;
  const step = curve * maxSpd * dt;
  padUsedRun = true;
  moveTo({
    x: Math.max(0, Math.min(W, pos.x + (vx / mag) * step)),
    y: Math.max(0, Math.min(H, pos.y + (vy / mag) * step)),
  });
}
function botSegWallFree(a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(d / 3));
  for (let i = 1; i <= steps; i++) {
    const q = { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps };
    if (!level.rects.some(r => inRect(q, r))) return false;
    if (level.tricks.some(tr => inRect(q, tr))) return false;
  }
  return true;
}
function botSegSafe(a, b, t) {
  const d = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(d / 3));
  for (let i = 1; i <= steps; i++) {
    const q = { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps };
    if (!level.rects.some(r => inRect(q, r))) return false;
    if (level.tricks.some(tr => inRect(q, tr))) return false;
    if (hitsObstacle(q, t) || hitsObstacle(q, t + 0.02)) return false;
  }
  return true;
}
function botFindSafeWp(p) {
  const wps = level && level.waypoints;
  if (!wps || !wps.length) return 0;
  for (let i = wps.length - 1; i >= 0; i--) {
    if (botSegWallFree(p, wps[i])) return i;
  }
  let best = 0, bestD = Infinity;
  for (let i = 0; i < wps.length; i++) {
    const d = Math.hypot(wps[i].x - p.x, wps[i].y - p.y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
function botStep() {
  if (!botAllowed() || !level) return;
  const pnow = performance.now();
  if (state === 'menu') { startLevel(progress.best >= LEVELS ? 1 : progress.best + 1); return; }
  if (state === 'arming' && arm) { placeOn(arm, 0); state = 'play'; }
  if (state !== 'play' || pnow < frozenUntil) { botLastAt = pnow; return; }
  if (atEnd) { clear(); return; }
  if (!pos) placeOn(arm || level.start, 0);
  const wps = level.waypoints;
  if (!wps || !wps.length) return;
  const dt = botLastAt ? Math.min(0.06, Math.max(0.012, (pnow - botLastAt) / 1000)) : 0.016;
  botLastAt = pnow;
  let budget = Math.max(36, Math.min(96, 2600 * dt));
  const t = (pnow - t0) / 1000;
  while (budget > 0.5 && state === 'play' && !atEnd) {
    while (botWp < wps.length - 1 && Math.hypot(wps[botWp].x - pos.x, wps[botWp].y - pos.y) < 3) botWp++;
    const wp = wps[botWp], dx = wp.x - pos.x, dy = wp.y - pos.y, dist = Math.hypot(dx, dy);
    if (dist < 1) { if (inRect(pos, level.end)) { atEnd = true; clear(); } break; }
    const ux = dx / dist, uy = dy / dist, step = Math.min(budget, dist);
    let cand = { x: pos.x + ux * step, y: pos.y + uy * step };
    if (!botSegWallFree(pos, cand)) { botWp = botFindSafeWp(pos); break; }
    if (!botSegSafe(pos, cand, t) && step > 8) {
      const half = { x: pos.x + ux * (step * 0.4), y: pos.y + uy * (step * 0.4) };
      if (botSegSafe(pos, half, t) && !hitsObstacle(half, t + 0.04)) cand = half;
    }
    if (botSegSafe(pos, cand, t)) {
      const moved = Math.hypot(cand.x - pos.x, cand.y - pos.y);
      moveTo(cand);
      budget -= Math.max(moved, 1);
      if (atEnd) { clear(); return; }
      if (moved < step * 0.9) break;
      continue;
    }
    // blocked by a moving obstacle ahead: retreat strictly along the corridor if our spot is about to be clipped
    if (hitsObstacle(pos, t + 0.04) || hitsObstacle(pos, t + 0.09)) {
      let tb = Math.max(0, botWp - 1);
      if (Math.hypot(wps[tb].x - pos.x, wps[tb].y - pos.y) < 3 && tb > 0) tb--;
      const prev = wps[tb], bdx = prev.x - pos.x, bdy = prev.y - pos.y, bd = Math.hypot(bdx, bdy);
      if (bd >= 1) {
        for (const r of [16, 32, Math.min(56, bd)]) {
          const back = { x: pos.x + (bdx / bd) * Math.min(r, bd), y: pos.y + (bdy / bd) * Math.min(r, bd) };
          if (botSegSafe(pos, back, t) && !hitsObstacle(back, t + 0.05)) { moveTo(back); botWp = tb + 1; break; }
        }
      }
    }
    break;
  }
}

// ---------- drawing ----------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  else ctx.rect(x, y, w, h);
}
function drawZone(z, fill, label, glow) {
  ctx.save();
  if (glow) { ctx.shadowColor = fill; ctx.shadowBlur = glow; }
  ctx.fillStyle = fill; roundRect(z.x, z.y, z.w, z.h, z.w * 0.18); ctx.fill();
  ctx.restore();
  if (label && z.w > 34) {
    ctx.fillStyle = 'rgba(10,12,16,.75)'; ctx.font = `800 ${Math.max(9, Math.min(15, z.w * 0.2))}px Inter, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, z.x + z.w / 2, z.y + z.h / 2);
  }
}
// the game's mouse: a pointer arrow, white with a dark edge
function drawPointer(p, s, blink) {
  if (blink) return;
  const k = 1 / s;                                // (about the same size on every screen)
  ctx.save();
  ctx.translate(p.x, p.y); ctx.scale(k, k);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 19); ctx.lineTo(4.5, 14.5); ctx.lineTo(8, 22); ctx.lineTo(11, 20.6); ctx.lineTo(7.6, 13.4); ctx.lineTo(13.6, 13.4); ctx.closePath();
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#0b0d12'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4;
  ctx.fill(); ctx.shadowBlur = 0; ctx.stroke();
  ctx.restore();
}
function pill(text, x, y, align, strong, maxW) {
  let fs = strong ? 16 : 13.5;
  ctx.font = `${strong ? 700 : 600} ${fs}px Inter, sans-serif`;
  if (maxW && maxW > 80) {
    while (fs > 11 && ctx.measureText(text).width + 24 > maxW) {
      fs -= 0.5;
      ctx.font = `${strong ? 700 : 600} ${fs}px Inter, sans-serif`;
    }
  }
  const w = Math.min(maxW || Infinity, ctx.measureText(text).width + 24), h = strong ? 34 : 28, left = align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = strong ? 'rgba(14,16,22,.88)' : 'rgba(20,22,30,.78)';
  roundRect(left, y, w, h, h / 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = strong ? '#ffffff' : 'rgba(232,234,240,.92)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, left + w / 2, y + h / 2 + 0.5, w - 16);
}
function draw(now) {
  raf = requestAnimationFrame(draw);
  checkPause();
  if (botAllowed()) botStep();
  else padStep(performance.now());
  if (finBtn) {
    const rdy = state === 'play' && atEnd;
    if (finBtn.disabled === rdy) { finBtn.disabled = !rdy; finBtn.classList.toggle('ready', rdy); }
  }
  const b = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(b.width * dpr) || cv.height !== Math.round(b.height * dpr)) { cv.width = Math.round(b.width * dpr); cv.height = Math.round(b.height * dpr); }
  const s = Math.min(b.width / W, b.height / H) * dpr, ox = (cv.width - W * s) / 2, oy = (cv.height - H * s) / 2;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, cv.height);
  bg.addColorStop(0, '#0b0d14'); bg.addColorStop(1, '#05060a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
  if (!level) return;
  ctx.setTransform(s, 0, 0, s, ox, oy);
  // the board, with a faint grid
  ctx.fillStyle = '#0f1118'; roundRect(0, 0, W, H, 18); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1;
  for (let x = 40; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 40; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // the corridor: an edge first (every piece a little bigger), then the floor on top, so it reads as one clean path
  const edge = Math.max(3, level.width * 0.06);
  ctx.fillStyle = '#3a4152';
  level.rects.forEach(r => { roundRect(r.x - edge, r.y - edge, r.w + edge * 2, r.h + edge * 2, edge * 1.5); ctx.fill(); });
  ctx.fillStyle = '#232835';
  level.rects.forEach(r => ctx.fillRect(r.x, r.y, r.w, r.h));
  const t = (now - t0) / 1000, beat = 0.5 + 0.5 * Math.sin(now / 260);
  drawZone(level.start, '#2faf4e', 'START', 0);
  level.checkpoints.forEach(c => drawZone(c, arm === c ? '#5aa8ff' : '#2f6fb8', '', arm === c ? 14 : 0));
  level.tricks.forEach(tr => drawZone(tr, tr.kind === 'fakeend' ? '#e3b23c' : '#2f6fb8', tr.kind === 'fakeend' ? 'FINISH' : '', 0));
  drawZone(level.end, '#e3b23c', 'FINISH', atEnd ? 18 + 14 * beat : 0);
  // red things
  ctx.save();
  ctx.fillStyle = '#ef4b55'; ctx.strokeStyle = '#ef4b55'; ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(239,75,85,.55)'; ctx.shadowBlur = 10;
  level.obstacles.forEach(o => {
    const sh = obstacleShape(o, t);
    if (sh.box) { roundRect(sh.box.x, sh.box.y, sh.box.w, sh.box.h, Math.min(sh.box.w, sh.box.h) * 0.22); ctx.fill(); }
    else { ctx.lineWidth = sh.bar.th; ctx.beginPath(); ctx.moveTo(sh.bar.x1, sh.bar.y1); ctx.lineTo(sh.bar.x2, sh.bar.y2); ctx.stroke(); }
  });
  ctx.restore();
  if (state === 'arming' && arm) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.strokeRect(arm.x - 4, arm.y - 4, arm.w + 8, arm.h + 8); ctx.setLineDash([]); }
  if (pos && (canLock() || botAllowed() || padOn) && state !== 'menu') drawPointer(pos, s / dpr, now < frozenUntil && Math.floor(now / 90) % 2 === 0);
  // what's going on: level and tries at the top, messages at the bottom
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pill(`Level ${level.n} of ${LEVELS}`, 14, 12, 'left');
  ctx.font = '600 13.5px Inter, sans-serif';
  pill(`Tries ${deaths}`, 14 + ctx.measureText(`Level ${level.n} of ${LEVELS}`).width + 34, 12, 'left');
  const text = paused === 'full' ? 'Paused: Mouse Maze only plays in fullscreen. Press the Fullscreen button or F11.'
    : paused === 'focus' ? 'Paused: click back into Frixion.'
    : paused === 'lock' ? 'Paused. Click the maze to keep playing (Esc lets go of the mouse).'
    : (now < msgUntil ? msg : state === 'arming' ? 'Move the mouse onto the highlighted square.' : atEnd ? (padOn ? 'Tap FINISH!' : 'Click to finish!') : '');
  if (text) pill(text, b.width / 2, b.height - 54, 'center', true, b.width - 16);
}

// ---------- the menu ----------
function showMenu(on) {
  const m = root.querySelector('.mz-menu');
  root.classList.toggle('mz-in-menu', !!on);
  if (!on) { m.hidden = true; return; }
  state = 'menu'; atEnd = false;
  resetStick();
  if (locked()) document.exitPointerLock();
  const cl = progress.cleared, done = [...cl].filter(c => c === '1').length;
  m.hidden = false;
  m.scrollTop = 0;
  m.querySelector('.mz-progress-fill').style.width = `${(done / LEVELS) * 100}%`;
  m.querySelector('.mz-progress-text').textContent = `${done} of ${LEVELS} levels cleared`;
  m.querySelector('.mz-levels').innerHTML = Array.from({ length: LEVELS }, (_, i) => {
    const n = i + 1, open = n <= progress.best + 1, ok = cl[i] === '1';
    return `<button type="button" class="mz-lv${ok ? ' done' : ''}${n === progress.best + 1 ? ' next' : ''}" data-lv="${n}"${open ? '' : ' disabled'}>${n}</button>`;
  }).join('');
  m.querySelector('.mz-continue').textContent = progress.best >= LEVELS ? 'Play level 1 again' : `Play level ${progress.best + 1}`;
  m.querySelectorAll('[data-lv]').forEach(b => { b.onclick = () => go(Number(b.dataset.lv)); });
}
function go(n) {
  const needFs = !botAllowed() && !padOn && !isFull();
  startLevel(n);
  if (needFs) {
    reqFull(root).then(() => { if (state === 'play' && !padOn && !botAllowed()) lockPointer(); }).catch(() => {});
  }
}

export function open(stage, frixion) {
  api = frixion;
  close();
  root = document.createElement('div');
  root.className = 'mz-root';
  stage.appendChild(root);
  padTouch = !!(api && typeof api.isTouchOnly === 'function' && api.isTouchOnly());
  padOn = padTouch;
  padSlow = false; padVec = { x: 0, y: 0 }; padPtrId = null; padLastAt = 0; padUsedRun = padOn; hwFinishPrev = false;
  if (padTouch) root.classList.add('mz-touch');
  progress = api.load();
  const intro = padTouch
    ? 'Use the thumbstick below to steer from the <b class="g">green</b> square to the <b class="y">gold</b> one, then tap FINISH. Don\'t touch a wall or anything red: touching something sends you back to your last checkpoint. Watch out for fake gold and blue squares.'
    : 'Get the mouse from the <b class="g">green</b> square to the <b class="y">gold</b> one, then click it. Don\'t touch a wall or anything red: touch something and the mouse goes straight back to your last checkpoint (the blue squares). Watch out, some gold and blue squares are tricks.';
  const fine = padTouch
    ? 'Tap SLOW for surgical cornering in narrow corridors. Bluetooth/USB gamepads work too. Every clear pays Orbs, and a level\'s first clear pays more.'
    : 'Plays in fullscreen with the game\'s own mouse (Esc pauses), or press Gamepad for stick controls. Every clear pays Orbs, and a level\'s first clear pays more.';
  root.innerHTML = `<div class="mz-stage">
      <canvas class="mz-canvas"></canvas>
      <div class="mz-menu"><div class="mz-menu-box">
        <h2>Mouse Maze</h2>
        <p>${intro}</p>
        <p class="mz-fine">${fine}</p>
        <div class="mz-progress"><div class="mz-progress-fill"></div></div>
        <div class="mz-progress-text"></div>
        <button type="button" class="mz-continue"></button>
        <div class="mz-levels"></div>
      </div></div>
      <div class="mz-bar">
        <button type="button" class="mz-btn" data-mz="menu">Levels</button>
        ${padTouch ? '' : '<button type="button" class="mz-btn" data-mz="pad">Gamepad</button><button type="button" class="mz-btn" data-mz="full">Fullscreen</button>'}
      </div>
    </div>
    <div class="mz-pad"${padOn ? '' : ' hidden'}>
      <div class="mz-stick" aria-label="Move pointer">
        <div class="mz-stick-ring"></div>
        <div class="mz-knob"></div>
      </div>
      <div class="mz-pad-mid">
        <div class="mz-pad-label">GAMEPAD</div>
        <div class="mz-pad-hint">Drag stick to steer</div>
      </div>
      <div class="mz-pad-acts">
        <button type="button" class="mz-act mz-act-slow" aria-pressed="false">SLOW</button>
        <button type="button" class="mz-act mz-act-finish" disabled>FINISH</button>
      </div>
    </div>`;
  cv = root.querySelector('.mz-canvas'); ctx = cv.getContext('2d');
  padEl = root.querySelector('.mz-pad');
  stickEl = root.querySelector('.mz-stick');
  knobEl = root.querySelector('.mz-knob');
  slowBtn = root.querySelector('.mz-act-slow');
  finBtn = root.querySelector('.mz-act-finish');
  padBtn = root.querySelector('[data-mz="pad"]');
  const on = (el, ev, fn, opt) => { if (!el) return; el.addEventListener(ev, fn, opt); offFns.push(() => el.removeEventListener(ev, fn, opt)); };
  on(document, 'mousemove', onMove);              // (with the pointer locked, moves come to the document)
  on(document, 'pointerlockchange', () => { if (locked()) lockAt = performance.now(); });
  on(cv, 'mousedown', onDown);
  on(cv, 'mouseleave', onLeave);
  on(root, 'contextmenu', e => e.preventDefault());       // no right-click menu in the maze
  on(window, 'blur', () => { resetStick(); if (!botAllowed() && !padOn && state === 'play' && !canLock()) { state = 'arming'; last = null; } });

  // Virtual analog stick (multi-touch safe via pointerId; tracked on window so dragging outside never drops)
  const updateStick = e => {
    const r = stickEl.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const maxR = Math.max(20, r.width * 0.36);
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > maxR) { dx = dx / d * maxR; dy = dy / d * maxR; }
    padVec = { x: dx / maxR, y: dy / maxR };
    if (knobEl) knobEl.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  };
  on(stickEl, 'pointerdown', e => {
    if (botAllowed()) return;
    e.preventDefault();
    padPtrId = e.pointerId;
    try { stickEl.setPointerCapture(e.pointerId); } catch (_) {}
    stickEl.classList.add('active');
    updateStick(e);
  });
  on(window, 'pointermove', e => {
    if (e.pointerId !== padPtrId || botAllowed()) return;
    if (e.cancelable) e.preventDefault();
    updateStick(e);
  }, { passive: false });
  const endStick = e => {
    if (e.pointerId !== padPtrId) return;
    resetStick();
  };
  on(window, 'pointerup', endStick);
  on(window, 'pointercancel', endStick);

  slowBtn.onclick = () => { if (botAllowed()) return; padSlow = !padSlow; syncPadUI(); };
  finBtn.onclick = () => { if (!botAllowed() && state === 'play' && atEnd) { padUsedRun = true; clear(); } };
  if (padBtn) padBtn.onclick = () => { if (!botAllowed()) setPadMode(!padOn); };
  root.querySelector('.mz-continue').onclick = () => go(progress.best >= LEVELS ? 1 : progress.best + 1);
  root.querySelector('[data-mz="menu"]').onclick = () => showMenu(true);
  const fullBtn = root.querySelector('[data-mz="full"]');
  if (fullBtn) fullBtn.onclick = () => { if (!fsEl()) reqFull(root).then(() => { if (state === 'play' && !padOn && !botAllowed()) lockPointer(); }).catch(() => {}); else exitFull(); };
  syncPadUI();
  showMenu(true);
  raf = requestAnimationFrame(draw);
}
export function setBot(on) {
  botOn = !!(on && api && typeof api.isOwner === 'function' && api.isOwner());
  if (botOn && root && cv) {
    paused = '';
    padVec = { x: 0, y: 0 }; padPtrId = null;
    if (knobEl) knobEl.style.transform = '';
    if (locked()) document.exitPointerLock();
    if (state === 'menu') startLevel(progress.best >= LEVELS ? 1 : progress.best + 1);
    else if (state === 'arming' && arm) { placeOn(arm, 0); state = 'play'; }
    else if (state === 'play' && pos && level) botWp = botFindSafeWp(pos);
  }
}
export function close() {
  botOn = false; botWp = 1;
  padOn = false; padTouch = false; padSlow = false; padVec = { x: 0, y: 0 }; padPtrId = null; padLastAt = 0; padUsedRun = false;
  cancelAnimationFrame(raf); raf = 0;
  offFns.forEach(f => f()); offFns = [];
  if (cv && document.pointerLockElement === cv) document.exitPointerLock();
  if (fsEl() && root && (root.contains(fsEl()) || fsEl() === root)) exitFull();
  if (root) root.remove();
  root = cv = ctx = padEl = stickEl = knobEl = slowBtn = finBtn = padBtn = level = null; state = 'menu'; paused = ''; pos = null; atEnd = false;
}
// (for tests: the level as built, and where things stand)
export const _build = build;
export const _peek = () => ({ state, pos: pos && { ...pos }, atEnd, n: level && level.n, deaths, paused, onStart: !!(level && arm === level.start), start: level && middle(level.start), padOn, padTouch, padSlow });
