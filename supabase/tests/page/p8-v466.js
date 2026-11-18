// v4.66 in the page (run after p1 to p7, on fresh seed data): the profile window (38), Mouse Maze's own mouse (39),
// 8-color name gradients (40), Set To and the Equilibrium Button (41, 55), the new-version check (42), Quick Open
// closing what it opened (46), the same rank in System Hub (48), Enter to log in (49), the infinity sign (51), the
// one-time password log (52) and the loan history (54).
const { check, until, doc, patch, put, wait } = T;
const SB = 'http://127.0.0.1:54321', SECRET = 'local-secret-key';
const shown = id => !$(id).classList.contains('hidden');
check('Tester logs in', await T.login('Tester'));

// ---------- 38: the profile window ----------
await openProfileModal('Sumi');
await until(() => shown('profile-modal') && $('profile-gift-btn'));
const pw = $('profile-modal-box').offsetWidth;   // (not its on-screen size: the pop-in scales it for a moment)
check('38: the profile window is bigger (600px, or the screen\'s width on a small one)', pw === 600 || pw >= innerWidth * 0.9, pw);
$('profile-gift-btn').click();
await until(() => shown('gift-modal'));
const gb = $('gift-modal').querySelector('.modal-box').getBoundingClientRect();
check('38: Gift Premium closes the profile', !shown('profile-modal'));
check('38: ...and sits in the middle of the screen', Math.abs((gb.left + gb.right) / 2 - innerWidth / 2) < 30, { left: gb.left, right: gb.right, w: innerWidth });
closeModal('gift-modal');
await openProfileModal('Sumi');
await until(() => shown('profile-modal') && $('profile-loan-btn'));
$('profile-loan-btn').click();
await until(() => shown('loan-modal'));
check('38: Ask for a Loan closes the profile too', !shown('profile-modal'));
closeModal('loan-modal');

// ---------- 54: the loan history ----------
for (let i = 0; i < 7; i++) await put(`loans/lpage${i}abc`, { from: 'Sumi', to: 'Tester', amount: 100 + i, paid: 100 + i, time: '1d', status: 'paid', at: Date.now() - i * 1000, paidAt: Date.now() - i * 1000 });
await patch('users/Tester', { loanWith: ['Sumi'] });
await until(() => (myProfile.loanWith || []).includes('Sumi'));
$('profile-loans').dataset.all = '';
await openProfileModal('Sumi');
const loanRows = () => $('profile-loans').querySelectorAll('.loan-row').length;
await until(() => loanRows() > 0, 8000);
check('54: 5 finished loans show, with a Show all button', loanRows() === 5 && !!$('profile-loans').querySelector('[data-loan-more]'), { rows: loanRows(), html: $('profile-loans').innerText.slice(0, 200) });
$('profile-loans').querySelector('[data-loan-more]').click();
await until(() => loanRows() >= 7, 8000);
check('54: ...Show all shows all of them (7 or more)', loanRows() >= 7, loanRows());
closeModal('profile-modal');

// ---------- 41 and 55: Set To and the Equilibrium Button ----------
openAdminPanel();
await until(() => shown('admin-panel-modal'));
adminSelectedUser = 'Air';
await renderAdminActions();
$('admin-orbs-amt').value = '-75';
$('admin-orbs-set').click();
check('41: Set To makes Air\'s Orbs exactly -75', !!(await until(async () => (await doc('users/Air')).orbs === -75)));
await until(() => $('admin-orbs-zero'));
$('admin-orbs-zero').click();
check('55: the Equilibrium Button makes them exactly 0', !!(await until(async () => (await doc('users/Air')).orbs === 0)));
closeModal('admin-panel-modal');

// ---------- 40: a name in 8 colors ----------
await patch('users/Tester', { premiumUntil: Date.now() + 86400000 });
await until(() => isPremium(myProfile));
renderNameGradientPicker();
for (let i = 0; i < 6; i++) $('name-grad-add').click();
check('40: the picker goes up to 8 colors and stops there', nameGradColors().length === 8 && $('name-grad-add').disabled, nameGradColors().length);
await $('save-profile-btn').onclick();
const grad = await until(async () => { const g = (await doc('users/Tester')).nameGradient; return Array.isArray(g) && g.length === 8 ? g : null; });
check('40: saved with all 8', !!grad, grad);
check('40: a name shows all 8 in its gradient', (nameStyle(myProfile).match(/#[0-9a-f]{6}/gi) || []).length === 8, nameStyle(myProfile));
check('egg: Full Spectrum (8 colors)', !!(await until(() => eggFoundSet.has('rainbowname'))));
$('name-grad-remove').click();
check('40: one fewer works too (7)', nameGradColors().length === 7);

// ---------- 46: Quick Open closes what it opened ----------
await patch('users/Tester', { quickOpen: [{ t: 'settings', b: { code: 'KeyY', ctrl: true, alt: true, shift: false, meta: false } }] });
await until(() => qoList().length === 1);
const press = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY', key: 'y', ctrlKey: true, altKey: true, bubbles: true }));
press();
check('46: the shortcut opens Settings', !!(await until(() => shown('settings-modal'))));
press();
check('46: ...and the same shortcut closes it', !!(await until(() => !shown('settings-modal'))));
for (let i = 0; i < 4; i++) { press(); await wait(150); press(); await wait(150); }
check('egg: Make Up Your Mind (5 times in 10 seconds)', !!(await until(() => eggFoundSet.has('quickflip'))));
closeModal('settings-modal');

// ---------- 52: one-time password sign-ins ----------
try { localStorage.removeItem('frixion_seclog_seen_Tester'); } catch (e) {}
await patch('users/Tester', { securityLog: [{ kind: 'one-time password', by: 'Tester', made: Date.now() - 60000, at: Date.now() }] });
check('52: a notice comes up', !!(await until(() => shown('confirm-modal') && /one-time password/.test($('confirm-modal-title').textContent))), $('confirm-modal-title').textContent);
closeModal('confirm-modal');
openSettings();
await until(() => shown('settings-modal'));
check('52: ...and Settings, My Account lists it', shown('seclog-block') && /signed in with a one-time password made by Tester/.test($('seclog-block').innerText), $('seclog-block').innerText);
closeModal('settings-modal');
check('52: Tester can\'t clear it', (await T.tryIt(() => db.collection('users').doc('Tester').update({ securityLog: FieldValue.delete() }))) === 'permission-denied');

// ---------- 51: the infinity sign ----------
const big = await fetch(SB + '/rest/v1/rpc/fx_commit', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SECRET, Authorization: 'Bearer ' + SECRET },
  body: '{"writes":[{"path":"users/Tester","updatePaths":[[["orbs"],1e309]]}]}' });
check('51: Tester\'s Orbs set past the largest number', big.ok && !!(await until(() => myProfile.orbs === Infinity)), myProfile.orbs);
check('51: shown as the infinity sign, and counted as infinite', orbsLabel(myProfile) === '∞' && hasInfiniteOrbs(myProfile) && hasOrbsFor(1e12), orbsLabel(myProfile));
await patch('users/Tester', { orbs: 1000 });
await until(() => myProfile.orbs === 1000);

// ---------- 42: a newer Frixion ----------
const realFetch = window.fetch;
window.fetch = async (u, o) => (String(u).startsWith('/?fresh=')
  ? new Response((await (await realFetch('/index.html', { cache: 'no-store' })).text()).replace(/script\.js\?v=\d+/, 'script.js?v=99999'), { status: 200, headers: { 'Content-Type': 'text/html' } })
  : realFetch(u, o));
openSettings();   // (something open: it offers the reload instead of doing it)
await until(() => shown('settings-modal'));
versionCheckAt = 0;
try { sessionStorage.removeItem('frixion_reloaded_for'); } catch (e) {}
await checkForNewVersion();
window.fetch = realFetch;
check('42: a new version is noticed, and with a window open a bar offers the reload', !!document.querySelector('.version-bar'), document.querySelector('.version-bar') && document.querySelector('.version-bar').innerText);
if (versionBar) { versionBar.remove(); versionBar = null; }
closeModal('settings-modal');
versionCheckAt = 0;
await checkForNewVersion();
check('42: the same files as the site: nothing happens', !document.querySelector('.version-bar'));

// ---------- 48: the same rank ----------
await patch('users/Sumi', { coowner: true });
await patch('users/Nova', { coowner: true });
check('Sumi logs in (a Co-Owner now)', await T.login('Sumi'));
await until(() => isOwner);
openAdminPanel();
await until(() => shown('admin-panel-modal'));
adminSelectedUser = 'Nova';
await renderAdminActions();
const wrap = $(activeAdminActionsEl());
check('48: Sumi opens Nova (the same rank) in System Hub, with a note why some things are missing', /The same rank as you/.test(wrap.innerText), wrap.innerText.slice(0, 300));
check('48: ...Orbs and Premium are there; Ban, Mute, Operator and the Danger Zone aren\'t',
  !!$('admin-orbs-grant') && !!$('admin-premium-grant') && !$('admin-ban-btn') && !$('admin-mute-btn') && !$('admin-op-btn') && !$('admin-delete-btn'));
const novaOrbs = (await doc('users/Nova')).orbs || 0;
$('admin-orbs-amt').value = '33';
await adminAdjustOrbs('Nova', 1);
check('48: Sumi gives Nova 33 Orbs', !!(await until(async () => (await doc('users/Nova')).orbs === novaOrbs + 33)));
check('48: ...but the database still won\'t let Sumi ban Nova', (await T.tryIt(() => db.collection('users').doc('Nova').update({ banned: true }))) === 'permission-denied');
adminSelectedUser = 'Tester';
await renderAdminActions();
check('48: the Owner is still out of reach', /outrank you/.test(wrap.innerText), wrap.innerText.slice(0, 120));
closeModal('admin-panel-modal');

// ---------- 49: Enter logs in ----------
await T.logout();
authView('login-view');
$('login-username').value = 'Tester'; $('login-password').value = '';
$('login-username').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
check('49: Enter in the username box with no password moves on to the password', document.activeElement === $('login-password'));
$('login-password').value = 'pass1';
$('login-password').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
check('49: Enter in the password box logs in', !!(await until(() => myUid === 'Tester' && myProfile, 15000)));

// ---------- 39: Mouse Maze's own mouse ----------
openGame('maze');
const m = await mazeMod;
await until(() => document.querySelector('.mz-continue'));
const cv = document.querySelector('.mz-canvas'), mzRoot = document.querySelector('.mz-root'), realHasFocus = document.hasFocus;
// (the test can't press F11 or take the real mouse: say it's fullscreen, focused and locked)
Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => mzRoot });
Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => cv });
document.hasFocus = () => true;
try {
  document.querySelector('[data-lv="1"]').click();
  await wait(350);
  let p = m._peek();
  const near = (a, b, d = 3) => a && b && Math.abs(a.x - b.x) < d && Math.abs(a.y - b.y) < d;
  check('39: a level starts with the mouse on the green square', p.state === 'play' && p.n === 1 && near(p.pos, p.start), p);
  const b = cv.getBoundingClientRect(), s = Math.min(b.width / 1600, b.height / 900);
  const nudge = (dx, dy) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: Math.round(dx * s), movementY: Math.round(dy * s), bubbles: true }));
  nudge(0, -500);
  p = m._peek();
  check('39: touching a wall puts it straight back on the start (no moving it back by hand)', p.deaths === 1 && near(p.pos, p.start) && p.state === 'play', p);
  await wait(500);
  // along the path, square by square (level 1: no tricks or obstacles), to the gold one
  const lv = m._build(1), squares = [lv.rects[0], ...lv.rects.filter((r, i) => i % 2 === 1)].map(r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }));
  for (const target of squares.slice(1)) {
    for (let i = 0; i < 60; i++) {
      const q = m._peek().pos, dx = target.x - q.x, dy = target.y - q.y;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) break;
      const k = Math.min(1, 25 / Math.hypot(dx, dy));
      nudge(dx * k, dy * k);
    }
  }
  p = m._peek();
  check('39: reaching the gold square doesn\'t finish the level by itself', p.atEnd === true && p.state === 'play' && p.deaths === 1, p);
  cv.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
  p = m._peek();
  check('39: a click on it does', p.state === 'won', p);
  await until(() => m._peek().n === 2, 4000);
  await wait(300);
  p = m._peek();
  check('39: the next level starts on its green square, not where the gold one was', p.n === 2 && p.state === 'play' && near(p.pos, p.start), p);
} finally {
  delete document.fullscreenElement; delete document.pointerLockElement; document.hasFocus = realHasFocus;
  closeGame();
}
return T.report();
