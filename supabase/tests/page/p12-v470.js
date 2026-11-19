// v4.70 in the page (after p1 to p11, on fresh seed data): "Premium until... forever" (75), the phone layout kept after
// logging out and in (77), Liquid glass on the phone's profile bar (78), the slow-start note and early connections (79),
// a private garden (80), and the Stock tab's Add stock and Reset to 0 (74).
const { check, until, doc, patch, wait } = T;
const hideModals = () => document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
check('Tester logs in', await T.login('Tester'));
hideModals();

// ---------- 75: Premium that never ends ----------
const prem = p => (badgesFor(p, false).find(b => b.key === 'premium') || {}).text;
check('75: never-ending Premium says forever', prem({ username: 'X', premiumUntil: 9e15 }) === 'Premium until... forever', prem({ username: 'X', premiumUntil: 9e15 }));
check('75: ...and Premium with an end says the date', /^Premium until \S/.test(prem({ username: 'X', premiumUntil: Date.now() + 86400000 }) || '') && !/Invalid/.test(prem({ username: 'X', premiumUntil: Date.now() + 86400000 })));
await patch('users/Air', { premiumUntil: 9e15 });
await openProfileModal('Air');
check('egg: To Infinity (opening a profile whose Premium never ends)', !!(await until(() => eggFoundSet.has('forever'))));
closeModal('profile-modal');

// ---------- 77: the phone layout survives logging out and in ----------
const realIsMobile = isMobile;
isMobile = () => true;   // (this browser is a computer: pretend it's a phone)
syncDeviceClasses();
await T.logout();
check('77: logging out keeps the phone layout on', document.body.classList.contains('is-mobile'));
check('Tester logs in again', await T.login('Tester'));
check('77: ...and so does logging back in', document.body.classList.contains('is-mobile'));
hideModals();

// ---------- 78: Liquid glass on the phone's profile bar ----------
document.documentElement.setAttribute('data-liquid-glass', '');
const pill = getComputedStyle($('mobile-user-pill'));
check('78: with Liquid glass, the phone\'s floating profile bar is glass', /blur/.test(pill.backdropFilter || pill.webkitBackdropFilter || ''), pill.backdropFilter);
document.documentElement.removeAttribute('data-liquid-glass');
isMobile = realIsMobile;
syncDeviceClasses();

// ---------- 79: opening ----------
check('79: a slow start gets a note with Reload (hidden once Frixion is in)', !!$('boot-slow') && $('boot-slow').querySelector('button') && $('boot-screen').classList.contains('hidden'));
check('79: early connections go to Supabase and sign-in, not to Firestore', !!document.querySelector('link[rel="preconnect"][href*="supabase.co"]')
  && !!document.querySelector('link[rel="preconnect"][href*="identitytoolkit"]') && !document.querySelector('link[rel="preconnect"][href*="firestore"]'));

// ---------- 80: a private garden ----------
await patch('users/Tester', { 'tb.ggUnlocked': 4 });
$('privacy-garden-toggle').checked = false;
$('privacy-garden-toggle').dispatchEvent(new Event('change'));
check('80: turning "Let people visit my garden" off saves it', !!(await until(async () => (await doc('users/Tester')).hideGarden === true)));
check('egg: Keep Out', !!(await until(() => eggFoundSet.has('keepout'))));
check('Air logs in', await T.login('Air'));
hideModals();
await openProfileModal('Tester');
await until(() => $('profile-orbgift-btn'), 6000);
check('80: Tester\'s profile has no Visit Garden for Air', !$('profile-garden-btn'));
closeModal('profile-modal');
await ggVisitGarden('Tester');
check('80: ...and visiting by name is turned away', !document.getElementById('gg-visit-plots') && !ggVisit);
await ggOpenTrade('Tester');
check('80: ...and so is offering a trade', $('gg-trade-modal').classList.contains('hidden'));
closeGame();
check('Tester logs in again', await T.login('Tester'));
hideModals();
$('privacy-garden-toggle').checked = true;
$('privacy-garden-toggle').dispatchEvent(new Event('change'));
check('80: turning it back on', !!(await until(async () => (await doc('users/Tester')).hideGarden === undefined)));

// ---------- 74: Add stock and Reset to 0 ----------
openAdminPanel();
await until(() => !$('admin-panel-modal').classList.contains('hidden'));
document.querySelector('[data-admin-tab="quests"]').click();
await until(() => document.querySelector('[data-stock-add="seeds:carrot"]'), 8000);
const carrot = GG_SEED_MAP.carrot, before = ggStockOf(carrot, 'seeds');
document.querySelector('.gag-stock-add[data-kind="seeds"][data-id="carrot"]').value = '5';
document.querySelector('[data-stock-add="seeds:carrot"]').click();
check('74: Add stock: 5 more carrots in this restock, for everyone', !!(await until(async () => { const d = await doc('config/gardenStock'); return d && d.now && d.now.w === ggStockWindow() && d.now.seeds.carrot === before + 5; }, 8000)) && ggStockOf(carrot, 'seeds') === before + 5, { before, now: ggStockOf(carrot, 'seeds') });
await wait(300);
document.querySelector('[data-stock-zero="seeds:carrot"]').click();
check('74: Reset to 0: sold out until the next restock', !!(await until(async () => { const d = await doc('config/gardenStock'); return d && d.now && d.now.seeds.carrot === 0; }, 8000)) && ggStockOf(carrot, 'seeds') === 0 && ggStockLeft(carrot, 'seeds') === 0);
await wait(300);
$('gag-stock-reset').click();
check('74: Back to Rarity leaves this restock\'s stock as set', !!(await until(async () => { const d = await doc('config/gardenStock'); return d && d.now && d.now.seeds.carrot === 0 && d.seeds && !Object.keys(d.seeds).length; }, 8000)));
closeModal('admin-panel-modal');
return T.report();
