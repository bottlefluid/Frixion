// v4.74 in the page: Color Simon egg moved to round 67 (forces re-earn for old simon15 holders with no SQL),
// Very Hard Liquid Dash (7 modes, speed portals, mini mode, glowing 45° Wave trail, Demon Slayer egg at 600),
// Mouse Maze playable on mobile & desktop via virtual analog gamepad (+ Thumb Runner egg), and Nine Circles egg (93 total).
const { check, until, put, wait } = T;
const hideModals = () => document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));

check('Tester (Owner) logs in', await T.login('Tester'));
await until(async () => Array.isArray((await doc('users/Tester')).ownedThemes), 6000);
hideModals();

// ---------- 1. Color Simon egg moved to round 67 & retires simon15 without SQL ----------
await put('eggs/Tester', { found: ['simon15'], at: { $t: Date.now() } });
await loadEggs();
check('v4.74: old simon15 holder is NOT credited for simon67 (must re-earn, no SQL)',
  !eggFoundSet.has('simon15') && !eggFoundSet.has('simon67') && !EGG_BY_ID.simon15 && EGG_BY_ID.simon67 && EGG_BY_ID.simon67.t === 'v');

openGame('simon');
check('v4.74: Color Simon hint mentions round 67', /67/.test($('game-stage').textContent));
smState.seq = new Array(14).fill(0);
smNext(); // reaches round 15 -> must NOT unlock simon67
await wait(200);
check('v4.74: reaching round 15 no longer awards the Color Simon egg', !eggFoundSet.has('simon67') && smState.round === 15);
smState.seq = new Array(66).fill(0);
smNext(); // reaches round 67 -> unlocks simon67!
check('v4.74: reaching round 67 awards simon67 (1000 Orbs)', !!(await until(() => eggFoundSet.has('simon67'), 6000)));
closeGame();

// ---------- 2. Very Hard Liquid Dash + Wave Trail + Demon Slayer egg (score 600) + Immortal BOT ----------
check('v4.74: Liquid Dash has 7 GD modes (incl. ufo) and 4 speed tiers (1x..4x)',
  GD_MODES.length === 7 && GD_MODES.includes('ufo') && GD_SPEEDS.length === 4);

openGame('geodash');
check('v4.74: Liquid Dash card hints at the 600 score egg', /600/.test($('game-stage').textContent));
gameBotSet(true);
// Let Owner BOT survive organically past the first portal, then test the score 600 Demon Slayer egg trigger live!
const dashLive = !!(await until(() => gdState && gdState.running && !gdState.dead && gdState.score >= 160, 12000));
if (gdState && gdState.running && gdState.dist < 5960) gdState.dist = 5960;
const dashOk = dashLive && !!(await until(() => gdState && gdState.running && !gdState.dead && gdState.score >= 600 && eggFoundSet.has('liquiddash'), 6000));
check('v4.74: Hard Liquid Dash BOT survives with 0 deaths and score 600 unlocks Demon Slayer egg',
  dashOk, gdState && { dashLive, score: gdState.score, dead: gdState.dead, mode: gdState.mode, speed: gdState.speed, egg: eggFoundSet.has('liquiddash') });

// Verify Wave trail populates wave points and renders bright neon/white trail pixels on canvas
gdSetMode(gdState, 'wave', false);
await wait(350);
const wavePts = gdState.trail.filter(pt => !pt.brk && pt.mode === 'wave');
const ctx = gdState.ctx;
const img = ctx.getImageData(0, gdState.ceil + 4, gdState.x + 2, gdState.groundY - gdState.ceil - 8).data;
let brightWavePx = 0;
for (let i = 0; i < img.length; i += 4) {
  if (img[i] > 210 && img[i + 2] > 200) brightWavePx++; // magenta/white wave trail
}
check('v4.74: Liquid Dash Wave leaves a glowing 45° laser trail behind the dart',
  wavePts.length >= 6 && brightWavePx >= 40, { wavePts: wavePts.length, brightWavePx });
closeGame();

// ---------- 3. Mouse Maze playable on mobile & desktop via virtual analog gamepad ----------
openGame('maze');
await until(() => mazeMod, 5000);
const mz = await mazeMod;
await until(() => document.querySelector('.mz-continue'), 5000);

// 3a. Desktop Gamepad toggle button opens the virtual gamepad & allows play without fullscreen or pointer lock
const padToggle = document.querySelector('[data-mz="pad"]');
check('v4.74: desktop Mouse Maze has a Gamepad toggle button', !!padToggle);
padToggle.click();
await wait(100);
check('v4.74: turning Gamepad on shows the analog stick, SLOW and FINISH controls',
  mz._peek().padOn === true && !document.querySelector('.mz-pad').hidden && !!document.querySelector('.mz-stick') && !!document.querySelector('.mz-act-finish'));

document.querySelector('[data-lv="1"]').click();
await wait(320);
check('v4.74: Gamepad mode starts Level 1 unpaused without fullscreen or pointer lock',
  mz._peek().state === 'play' && mz._peek().paused === '' && mz._peek().n === 1, mz._peek());

// Toggle SLOW precision mode
const slowBtn = document.querySelector('.mz-act-slow');
slowBtn.click();
check('v4.74: SLOW precision toggle works on the gamepad', mz._peek().padSlow === true && slowBtn.classList.contains('on'));
slowBtn.click(); // normal speed for quick traversal

// Steer all the way through Level 1 using real pointer drags on the virtual analog stick!
const stick = document.querySelector('.mz-stick');
const lv1 = mz._build(1);
const squares = [lv1.rects[0], ...lv1.rects.filter((r, i) => i % 2 === 1)].map(r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }));
const sr = stick.getBoundingClientRect(), scx = sr.left + sr.width / 2, scy = sr.top + sr.height / 2, smax = sr.width * 0.36;
stick.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: scx, clientY: scy, bubbles: true }));
for (const target of squares.slice(1)) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const q = mz._peek().pos;
    if (!q || mz._peek().atEnd) break;
    const dx = target.x - q.x, dy = target.y - q.y, dist = Math.hypot(dx, dy);
    if (dist < 10) break;
    const ux = dx / dist, uy = dy / dist;
    stick.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: scx + ux * smax, clientY: scy + uy * smax, bubbles: true }));
    await wait(22);
  }
}
stick.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: scx, clientY: scy, bubbles: true }));
await wait(40);
const finBtn = document.querySelector('.mz-act-finish');
check('v4.74: steering with the analog stick reaches the gold square and lights up FINISH',
  mz._peek().atEnd === true && !finBtn.disabled && finBtn.classList.contains('ready'), mz._peek());
finBtn.click();
check('v4.74: tapping FINISH clears Level 1 and awards Thumb Runner (pocketmaze) egg',
  mz._peek().state === 'won' && !!(await until(() => eggFoundSet.has('pocketmaze'), 6000)), { peek: mz._peek(), egg: eggFoundSet.has('pocketmaze') });
closeGame();

// 3b. Mobile touch-only detection automatically launches Mouse Maze in Gamepad mode (no "needs a computer" wall!)
const stage = document.createElement('div');
document.body.appendChild(stage);
mz.open(stage, { isTouchOnly: () => true, isOwner: () => false, load: () => ({ best: 0, cleared: '' }), save: () => {}, egg: () => {} });
const mobPeek = mz._peek();
const mobHasNote = !!stage.querySelector('.mz-note');
const mobHasPad = !!stage.querySelector('.mz-pad') && !stage.querySelector('.mz-pad').hidden;
mz.close();
stage.remove();
check('v4.74: mobile touch devices open Mouse Maze directly with Gamepad ON (no desktop-only lockout)',
  !mobHasNote && mobHasPad && mobPeek.padOn === true && mobPeek.padTouch === true, { mobHasNote, mobHasPad, mobPeek });

// ---------- 4. Nine Circles egg & 93 total eggs ----------
if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
for (const ch of 'ninecircles') document.dispatchEvent(new KeyboardEvent('keydown', { key: ch, code: 'Key' + ch.toUpperCase(), bubbles: true }));
check('v4.74: typing "ninecircles" unlocks the Nine Circles (gdwave) egg', !!(await until(() => eggFoundSet.has('gdwave'), 6000)));
check('v4.74: EGGS total is 93 with v4.74 group present',
  EGGS.length === 93 && EGG_GROUPS.some(([name, ids]) => /v4\.74/.test(name) && ids.join() === 'liquiddash,pocketmaze,gdwave'),
  EGGS.length);

return T.report();
