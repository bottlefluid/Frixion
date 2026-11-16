// Mouse Maze (v4.64): guide the mouse from the green square to the gold one without touching a wall. 125 levels,
// each built from its own fixed seed, so a level is the same for everyone and every time. Computer only: it needs a
// mouse and fullscreen (the Fullscreen button, or F11), and pauses whenever you leave fullscreen or the window.
// Right-click does nothing here (so it can't be used to freeze the game), and the mouse leaving the play area counts
// as touching a wall. Moves are checked along the whole line between two mouse positions, so a fast flick can't jump
// through a wall. Orbs: a little for every clear (replays too) and more the first time, paid the way every Frixion game
// pays (script.js gives this file `api`).
const LEVELS = 125;
const W = 1600, H = 900;                       // the level's own units; the canvas scales them to the screen
let api = null, root = null, cv = null, ctx = null, raf = 0, level = null, state = 'menu', t0 = 0, deaths = 0;
let progress = { best: 0, cleared: '' }, arm = null, last = null, paused = '', msg = '', msgUntil = 0, offFns = [];

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
  return { n, rects, start: startZone, end: endZone, checkpoints, tricks, obstacles, width };
}

// ---------- what's where at time t ----------
const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
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
function toLevel(e) {
  const b = cv.getBoundingClientRect(), s = Math.min(b.width / W, b.height / H), ox = (b.width - W * s) / 2, oy = (b.height - H * s) / 2;
  return { x: (e.clientX - b.left - ox) / s, y: (e.clientY - b.top - oy) / s };
}
const isFull = () => !!document.fullscreenElement || (Math.abs(window.innerHeight - screen.height) < 3 && Math.abs(window.innerWidth - screen.width) < 3);
function say(text, ms) { msg = text; msgUntil = performance.now() + (ms || 1600); }
function startLevel(n) {
  level = build(n); state = 'arming'; arm = level.start; last = null; deaths = 0; t0 = performance.now();
  say('Move the mouse onto the green square to start.', 2600);
  showMenu(false);
}
function die(why) {
  deaths++;
  state = 'arming'; last = null;
  say(why === 'trick' ? 'That one was a trick. Back to your checkpoint.' : why === 'left' ? 'You left the maze. Back to your checkpoint.' : 'You touched a wall. Back to your checkpoint.', 1800);
  if (why === 'trick') api.egg('tricked');
}
function clear() {
  const n = level.n, first = progress.cleared[n - 1] !== '1';
  const orbs = 1 + Math.floor(n / 12) + (first ? 15 + 2 * n : 0);
  const cl = progress.cleared.padEnd(LEVELS, '0').split('');
  cl[n - 1] = '1';
  progress = { best: Math.max(progress.best, n), cleared: cl.join('') };
  api.save(progress, orbs);
  if (n >= 50) api.egg('mazehalf');
  state = 'won';
  say(`Level ${n} cleared${first ? ' for the first time' : ''}! +${orbs} Orbs${deaths ? ` (${deaths} ${deaths === 1 ? 'try' : 'tries'})` : ''}`, 2600);
  setTimeout(() => { if (state === 'won') { if (n < LEVELS) startLevel(n + 1); else { showMenu(true); say('That was the last level. You beat Mouse Maze.', 4000); } } }, 2200);
}
function onMove(e) {
  if (!level || paused || state === 'menu' || state === 'won') return;
  const p = toLevel(e), t = (performance.now() - t0) / 1000;
  if (state === 'arming') {                       // waiting on the start square or the last checkpoint
    if (inRect(p, arm)) { state = 'play'; last = p; say(arm === level.start ? 'Go!' : 'Go on!', 700); }
    return;
  }
  // check every few units along the move, so a fast flick can't skip over a wall
  const from = last || p, d = Math.hypot(p.x - from.x, p.y - from.y), steps = Math.max(1, Math.ceil(d / 3));
  for (let i = 1; i <= steps; i++) {
    const q = { x: from.x + (p.x - from.x) * i / steps, y: from.y + (p.y - from.y) * i / steps }, hit = touch(q, t);
    if (!hit) continue;
    if (hit.what === 'wall') return die('wall');
    if (hit.what === 'trick') return die('trick');
    if (hit.what === 'end') return clear();
    if (hit.what === 'check' && arm !== hit.c) { arm = hit.c; say('Checkpoint.', 900); }
  }
  last = p;
}
function onLeave() { if (state === 'play' && !paused) die('left'); }
function checkPause() {
  const why = !isFull() ? 'full' : !document.hasFocus() ? 'focus' : '';
  if (why === paused) return;
  paused = why;
  if (why && state === 'play') { state = 'arming'; last = null; }   // pick up again from the square you're on
}

// ---------- drawing ----------
function draw(now) {
  raf = requestAnimationFrame(draw);
  checkPause();
  const b = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(b.width * dpr)) { cv.width = Math.round(b.width * dpr); cv.height = Math.round(b.height * dpr); }
  const s = Math.min(b.width / W, b.height / H) * dpr, ox = (cv.width - W * s) / 2, oy = (cv.height - H * s) / 2;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#07080b'; ctx.fillRect(0, 0, cv.width, cv.height);
  if (!level) return;
  ctx.setTransform(s, 0, 0, s, ox, oy);
  ctx.fillStyle = '#101218'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#2b2f3a';
  level.rects.forEach(r => ctx.fillRect(r.x, r.y, r.w, r.h));
  const zoneFill = (z, color) => { ctx.fillStyle = color; ctx.fillRect(z.x, z.y, z.w, z.h); };
  zoneFill(level.start, '#2faf4e');
  level.checkpoints.forEach(c => zoneFill(c, arm === c ? '#5aa8ff' : '#2f6fb8'));
  level.tricks.forEach(tr => zoneFill(tr, tr.kind === 'fakeend' ? '#e3b23c' : '#2f6fb8'));
  zoneFill(level.end, '#e3b23c');
  const t = (now - t0) / 1000;
  ctx.fillStyle = '#e5484d'; ctx.strokeStyle = '#e5484d'; ctx.lineCap = 'round';
  level.obstacles.forEach(o => {
    const sh = obstacleShape(o, t);
    if (sh.box) ctx.fillRect(sh.box.x, sh.box.y, sh.box.w, sh.box.h);
    else { ctx.lineWidth = sh.bar.th; ctx.beginPath(); ctx.moveTo(sh.bar.x1, sh.bar.y1); ctx.lineTo(sh.bar.x2, sh.bar.y2); ctx.stroke(); }
  });
  if (state === 'arming' && arm) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.strokeRect(arm.x - 4, arm.y - 4, arm.w + 8, arm.h + 8); ctx.setLineDash([]); }
  // the top line: level, tries, and what's going on
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '600 15px Inter, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`Level ${level.n} of ${LEVELS}   Tries ${deaths}`, 16, 26);
  const text = paused === 'full' ? 'Paused: Mouse Maze only plays in fullscreen. Press the Fullscreen button or F11.' : paused === 'focus' ? 'Paused: click back into Frixion.' : (now < msgUntil ? msg : state === 'arming' ? 'Move the mouse onto the highlighted square.' : '');
  if (text) { ctx.textAlign = 'center'; ctx.font = '700 18px Inter, sans-serif'; ctx.fillText(text, b.width / 2, b.height - 24); }
}

// ---------- the menu ----------
function showMenu(on) {
  const m = root.querySelector('.mz-menu');
  if (!on) { m.hidden = true; return; }
  state = 'menu';
  const cl = progress.cleared;
  m.hidden = false;
  m.querySelector('.mz-levels').innerHTML = Array.from({ length: LEVELS }, (_, i) => {
    const n = i + 1, open = n <= progress.best + 1, done = cl[i] === '1';
    return `<button type="button" class="mz-lv${done ? ' done' : ''}" data-lv="${n}"${open ? '' : ' disabled'}>${n}</button>`;
  }).join('');
  m.querySelector('.mz-continue').textContent = progress.best >= LEVELS ? 'Play level 1 again' : `Play level ${progress.best + 1}`;
  m.querySelectorAll('[data-lv]').forEach(b => { b.onclick = () => go(Number(b.dataset.lv)); });
}
function go(n) {
  if (!isFull()) { (root.requestFullscreen ? root.requestFullscreen() : Promise.reject()).catch(() => {}); }
  startLevel(n);
}

export function open(stage, frixion) {
  api = frixion;
  close();
  root = document.createElement('div');
  root.className = 'mz-root';
  stage.appendChild(root);
  if (api.isTouchOnly()) {
    root.innerHTML = '<div class="mz-note"><b>Mouse Maze needs a computer.</b><span>It\'s played with a mouse, so it doesn\'t work on phones or tablets.</span></div>';
    return;
  }
  progress = api.load();
  root.innerHTML = `<canvas class="mz-canvas"></canvas>
    <div class="mz-menu"><div class="mz-menu-box">
      <h2>Mouse Maze</h2>
      <p>Get the mouse from the <b class="g">green</b> square to the <b class="y">gold</b> one without touching a wall or anything red. Touch something and you go back to your last checkpoint (the blue squares). Watch out: some gold and blue squares are tricks.</p>
      <p class="mz-fine">It only plays in fullscreen, and right-click is off. Every clear pays Orbs, and a level's first clear pays more.</p>
      <button type="button" class="mz-continue"></button>
      <div class="mz-levels"></div>
    </div></div>
    <div class="mz-bar"><button type="button" class="mz-btn" data-mz="menu">Levels</button><button type="button" class="mz-btn" data-mz="full">Fullscreen</button></div>`;
  cv = root.querySelector('.mz-canvas'); ctx = cv.getContext('2d');
  const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); offFns.push(() => el.removeEventListener(ev, fn, opt)); };
  on(cv, 'mousemove', onMove);
  on(cv, 'mouseleave', onLeave);
  on(root, 'contextmenu', e => e.preventDefault());       // no right-click menu in the maze
  on(window, 'blur', () => { if (state === 'play') { state = 'arming'; last = null; } });
  root.querySelector('.mz-continue').onclick = () => go(progress.best >= LEVELS ? 1 : progress.best + 1);
  root.querySelector('[data-mz="menu"]').onclick = () => showMenu(true);
  root.querySelector('[data-mz="full"]').onclick = () => { if (!document.fullscreenElement) root.requestFullscreen().catch(() => {}); else document.exitFullscreen().catch(() => {}); };
  showMenu(true);
  raf = requestAnimationFrame(draw);
}
export function close() {
  cancelAnimationFrame(raf); raf = 0;
  offFns.forEach(f => f()); offFns = [];
  if (document.fullscreenElement && root && root.contains(document.fullscreenElement) || document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
  if (root) root.remove();
  root = cv = ctx = level = null; state = 'menu'; paused = '';
}
// (for tests: the level as built)
export const _build = build;
