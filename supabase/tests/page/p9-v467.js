// v4.67 in the page (after p1 to p8, on fresh seed data): Grow a Garden's Stock tab for the Owner and Co-Owners (57, 59),
// bets over the old 10,000 limit (60), the Casino's house edge, Provably Fair panel and checking a bet (56), referrals
// (56), and the 8 new drawn profile effects (47, 58).
const { check, until, doc, patch, wait } = T;
const shown = id => !$(id).classList.contains('hidden');
check('Tester logs in', await T.login('Tester'));

// ---------- 57 and 59: the garden's stock ----------
openAdminPanel();
await until(() => shown('admin-panel-modal'));
document.querySelector('[data-admin-tab="quests"]').click();
await until(() => document.querySelectorAll('.gag-stock-pct').length > 5, 8000);
check('59: the Owner gets the Stock tab', !$('gag-tab-stock').classList.contains('hidden'));
const carrot = document.querySelector('.gag-stock-pct[data-kind="seeds"][data-id="carrot"]');
check('59: every seed and sprinkler has a chance box', !!carrot && document.querySelectorAll('.gag-stock-pct[data-kind="sprinklers"]').length > 0);
carrot.value = '0';
$('gag-stock-save').click();
check('59: saving writes config/gardenStock', !!(await until(async () => { const d = await doc('config/gardenStock'); return d && d.seeds && d.seeds.carrot === 0; })));
check('59: ...and the shop goes by it: carrot is never in stock now', ggStockChance(GG_SEED_MAP.carrot, 'seeds') === 0 && ggStockOf(GG_SEED_MAP.carrot, 'seeds') === 0);
$('gag-stock-bypass').checked = true; $('gag-stock-bypass').dispatchEvent(new Event('change'));
check('57: with bypass on, nothing sells out for the Owner', ggStockLeft(GG_SEED_MAP.carrot, 'seeds') > 0 && /No limit/.test(ggStockTag(GG_SEED_MAP.carrot, 'seeds')));
$('gag-stock-bypass').checked = false; $('gag-stock-bypass').dispatchEvent(new Event('change'));
check('57: ...and off again', ggStockLeft(GG_SEED_MAP.carrot, 'seeds') === 0);
$('gag-stock-reset').click();
check('59: Back to Rarity clears them', !!(await until(async () => { const d = await doc('config/gardenStock'); return d && d.seeds && !('carrot' in d.seeds); })));
closeModal('admin-panel-modal');

// ---------- 60 and 56: the Casino ----------
await patch('users/Tester', { orbs: 100000 });
await until(() => myProfile.orbs === 100000);
goHomePage('casino');
await until(() => $('cz-fair-btn'), 8000);
document.querySelector('[data-cz-game="coinflip"]').click();
await until(() => $('cz-go'));
check('56: a game shows its house edge and a Provably Fair link', /House edge 3%/.test(document.querySelector('.cz-edge').innerText) && !!document.querySelector('[data-cz-fair]'));
$('cz-bet').value = '20000';
$('cz-go').click();
const flipped = await until(() => { const l = JSON.parse(localStorage.getItem('frx_cz_fair_bets_Tester') || '[]'); return l.length ? l[0] : null; }, 8000);
check('60: a 20,000 Orbs bet (over the old limit) goes through', !!flipped && flipped.res.stake === 20000, flipped);
check('56: the bet is kept with its seeds, for checking', !!flipped && /^[0-9a-f]{64}$/.test(flipped.fair.hash) && flipped.fair.n === 0, flipped && flipped.fair);
await until(() => !busyNowCheck(), 3000).catch(() => {});
document.querySelector('[data-cz-fair]').click();
await until(() => $('cz-fair-rotate'), 6000);
check('56: the panel shows the fingerprint of the seed in use, and the nonce (1 bet so far)', $('cz-fair-box').innerText.includes(flipped.fair.hash) && /Bets on these seeds\s*1/.test($('cz-fair-box').innerText), $('cz-fair-box').innerText.slice(0, 300));
document.querySelector('[data-fair-check="0"]').click();
check('56: a bet on the seed in use can\'t be checked yet', !!(await until(() => /still in use/.test(($('cz-fair-out-0') || {}).textContent || ''), 6000)));
$('cz-fair-client').value = 'page-test';
$('cz-fair-rotate').click();
check('56: changing seeds shows the old server seed', !!(await until(() => document.querySelector('.cz-fair-old'), 6000)) && /page-test/.test($('cz-fair-box').innerText));
document.querySelector('[data-fair-check="0"]').click();
check('56: ...and now the bet checks out', !!(await until(() => /It matches/.test(($('cz-fair-out-0') || {}).textContent || ''), 8000)), ($('cz-fair-out-0') || {}).textContent);
check('egg: Trust, But Verify', !!(await until(() => eggFoundSet.has('seedcheck'))));
$('cz-ref-btn').click();
await until(() => $('cz-ref-make') || $('cz-ref-copy'), 6000);
$('cz-ref-new').value = 'tester1';
$('cz-ref-make').click();
check('56: making a referral code shows its link', !!(await until(() => $('cz-ref-link') && /\?ref=TESTER1$/.test($('cz-ref-link').value), 6000)));

// ---------- 47 and 58: the new drawn effects ----------
const kinds = ['fireworks', 'galaxy', 'lava', 'ocean', 'sunbeams', 'koi', 'storm', 'soap'];
check('47, 58: 8 new effects in the Shop', kinds.every(k => PROFILE_EFFECTS.some(p => p.fx === k)));
const cv = document.createElement('canvas'); cv.width = 300; cv.height = 400;
const c = cv.getContext('2d'), bad = [];
for (const k of kinds) { try { const d = FX_DRAW[k]; const st = d.make(fxRand(3)); for (const t of [0, 400, d.intro, d.intro + 5000]) d.draw(c, st, t, 300, 400); } catch (x) { bad.push(k + ': ' + x.message); } }
check('...each draws its intro and loop without an error', !bad.length, bad);
return T.report();

function busyNowCheck() { const b = $('cz-go'); return b && b.disabled; }
