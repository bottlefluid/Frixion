// v4.68 in the page (after p1 to p9, on fresh seed data): Shop prices with letters (71), every color of an item in the
// Shop's edit window (61), name gradients on the name alone (62), rounded corners with a nameplate (72), Neon Grid from
// the banner down (73), the Games page's Orbs left and the Premium limit (63, 67), Gift Orbs (68), visiting gardens
// (64), the Owner's device and network lists and taking an account off (69), and the send button keeping the keyboard
// (70).
const { check, until, doc, patch, put, wait } = T;
check('Tester logs in', await T.login('Tester'));
document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));

// ---------- 71: Shop prices ----------
const card = shopItemCardHTML('banners', { id: 'v468big', name: 'Big One', price: 1e16, colors: ['#ff0000', '#0000ff'], angle: 90 });
check('71: a huge price gets letters, with the whole number in its tooltip', />10\.0Qa</.test(card) && /title="10,000,000,000,000,000 Orbs"/.test(card), card.slice(0, 500));

// ---------- 61: every color in the Shop's edit window ----------
await put('shopBanners/v468ban', { name: 'Five Colors', desc: 'Test banner', price: 100, colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'], angle: 90, createdBy: 'Tester', createdAt: { $t: Date.now() } });
await until(() => customBanners.some(b => b.id === 'v468ban'), 8000);
await openShopItemEditor('banners', 'v468ban');
const colorBoxes = () => $('shop-edit-extra').querySelectorAll('.color-list input[type="color"]');
check('61: the edit window shows all 5 colors (it used to show 3)', colorBoxes().length === 5 && colorBoxes()[4].value === '#ff00ff', colorBoxes().length);
$('shop-edit-extra').querySelector('.color-list .cl-add').click();
check('61: ...and can add more, up to 8', colorBoxes().length === 6);
$('shop-edit-save-btn').click();
check('61: saving keeps every color', !!(await until(async () => { const d = await doc('shopBanners/v468ban'); return d && d.colors.length === 6 && d.colors[4] === '#ff00ff'; }, 8000)));
closeModal('shop-edit-modal');

// ---------- 62: the name gradient on the name alone ----------
const grad = { username: 'G', premiumUntil: Date.now() + 1e8, nameGradient: ['#ff0000', '#ff8800', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#8800ff', '#ff00ff'] };
check('62: a gradient name keeps no style on the whole line (tags after it aren\'t colored by it)', nameStyle(grad, '#123456') === '');
check('62: ...and goes on the name text alone, with all 8 colors', /^<span class="grad-name" style="background-image:linear-gradient\(90deg,#ff0000,.*#ff00ff\)">Gee<\/span>$/.test(nameText(grad, 'Gee')), nameText(grad, 'Gee'));
check('62: no gradient: the role color, as before', nameStyle({ username: 'P' }, '#123456').includes('color:#123456') && nameText({ username: 'P' }, 'Pee') === 'Pee');

// ---------- 72 and 73: the profile card ----------
await patch('users/Tester', { equippedProfileEffect: 'fx-grid', ownedProfileEffects: ['fx-grid'] });
await until(() => myProfile.equippedProfileEffect === 'fx-grid');
await openProfileModal('Tester');
await until(() => !$('profile-modal').classList.contains('hidden'));
const rad = getComputedStyle($('profile-name-block')).borderTopLeftRadius, bodyRad = getComputedStyle(document.querySelector('#profile-modal .profile-body')).borderTopLeftRadius;
check('72: the name block (where a nameplate goes) keeps the card\'s rounded corners', rad === bodyRad && parseFloat(rad) > 0, { rad, bodyRad });
const bb = profileBannerBottom();
check('73: the profile knows where its banner ends', bb > 40 && bb < 300, bb);
const cv = document.createElement('canvas'); cv.width = 300; cv.height = 500;
const c = cv.getContext('2d'), gd = FX_DRAW.grid, gst = gd.make(fxRand(3));
gst.horizon = () => 120;
gd.draw(c, gst, 4000, 300, 500);
const px = y => [...c.getImageData(150, y, 1, 1).data];
const at120 = px(120), at190 = px(190);
check('73: Neon Grid\'s horizon line sits where the banner ends (not 38% down)', at120[0] > 150 && at120[3] > 150 && at190[3] < at120[3], { at120, at190 });
closeModal('profile-modal');

// ---------- 63 and 67: game Orbs ----------
await patch('users/Tester', { premiumUntil: 0 });
await until(() => !isPremium(myProfile));
goHomePage('quests');
await until(() => /You can still get/.test(($('quests-view').querySelector('.fg-left-text') || {}).textContent || ''), 8000);
const leftText = () => $('quests-view').querySelector('.fg-left-text').textContent;
check('63: the Games page says how many Orbs games can still pay today, above Overcontrol RNG',
  /20,000 a day, 100,000 with Premium/.test(leftText()) && $('quests-view').querySelector('.fg-left').nextElementSibling.classList.contains('fg-grid'), leftText());
check('67: without Premium the limit is 20,000', earnCap() === 20000);
await patch('users/Tester', { premiumUntil: Date.now() + 86400000 });
await until(() => isPremium(myProfile));
check('67: with Premium it\'s 100,000, and the page says so', earnCap() === 100000 && !!(await until(() => /with your Premium/.test(leftText()), 5000)), leftText());

// ---------- 68: Gift Orbs ----------
await patch('users/Tester', { orbs: 5000 });
await until(() => myProfile.orbs === 5000);
const sumiBefore = (await doc('users/Sumi')).orbs;
await openProfileModal('Sumi');
await until(() => $('profile-orbgift-btn'), 6000);
$('profile-orbgift-btn').click();
await until(() => !$('orb-gift-modal').classList.contains('hidden'));
check('68: Gift Orbs opens its window (and the profile closes)', $('profile-modal').classList.contains('hidden') || $('profile-modal').classList.contains('sheet-closing'));
$('orb-gift-amount').value = '100'; $('orb-gift-note').value = 'for you';
$('orb-gift-send').click();
check('68: the gift goes through: 100 Orbs move from Tester to Sumi', !!(await until(async () => (await doc('users/Sumi')).orbs === sumiBefore + 100 && (await doc('users/Tester')).orbs === 4900 && myProfile.orbs === 4900, 8000)), { sumi: (await doc('users/Sumi')).orbs, me: myProfile.orbs });
openOrbGiftModal('Sumi');
$('orb-gift-amount').value = '67';
$('orb-gift-send').click();
check('egg: Six Seven (a gift of exactly 67)', !!(await until(() => eggFoundSet.has('sixseven'))) && !!(await until(async () => (await doc('users/Sumi')).orbs === sumiBefore + 167, 8000)));
openOrbGiftModal('Sumi');
$('orb-gift-amount').value = '999999';
$('orb-gift-send').click();
check('68: not more than you have', !(await until(async () => (await doc('users/Sumi')).orbs > sumiBefore + 167, 1500)) && T.errorToasts.some(t => /don't have that many/.test(t)));
T.errorToasts.splice(0);   // (that error was the point)
closeModal('orb-gift-modal');
await openProfileModal('Sumi');
check('68: both gifts show under Loans and Gifts', !!(await until(() => /gifted 67 Orbs to/.test($('profile-loans').textContent) && /gifted 100 Orbs to/.test($('profile-loans').textContent), 8000)), $('profile-loans').textContent.slice(0, 200));
check('68: Sumi is told once she\'s on (giftIn: the newest gift)', (await doc('users/Sumi')).giftIn.amount === 67);

// ---------- 64: visiting gardens ----------
// (games keep their state under tb on the profile, the way dbUpdateUser saves it)
await patch('users/Sumi', { 'tb.ggUnlocked': 4, 'tb.ggSheckles': 1234, 'tb.ggPlots': [{ seed: 'carrot', at: Date.now() - 1e9, w: 1, sprinklers: [] }, { seed: 'carrot', at: Date.now(), w: 1, sprinklers: [] }, null, null], 'tb.ggPets': [] });
closeModal('profile-modal');
await openProfileModal('Sumi');
check('64: a profile with a garden has Visit Garden', !!(await until(() => $('profile-garden-btn'), 6000)));
$('profile-garden-btn').click();
check('64: it opens their garden, as it is now', !!(await until(() => document.querySelectorAll('#gg-visit-plots .gg-plot.planted').length === 2, 8000)) && /1,234|1\.23K/.test($('gg-game').textContent) && /Sumi/.test($('gg-game').textContent));
check('64: ...grown ones ready, the new one still growing, with nothing to tap', document.querySelectorAll('#gg-visit-plots .gg-plot.ready').length === 1 && !$('gg-visit-plots').querySelector('[onclick]'));
await ggVisitGarden('Air'); await ggVisitGarden('Nova');
check('egg: Garden Tour (3 gardens)', !!(await until(() => eggFoundSet.has('gardentour'))));
ggVisitEnd();
check('64: Back to My Garden draws yours again', !!$('gg-plots') && !$('gg-visit-plots'));
closeGame();

// ---------- 69: the Owner's lists ----------
const devA = { id: 'dev_a', accounts: ['Air'], name: 'Windows PC', os: 'Windows 11', tz: 'America/New_York', hw: 'hw_1', browser: 'Edge 142' };
const devB = { id: 'dev_b', accounts: ['Air'], name: 'Windows PC', os: 'Windows 11', tz: 'America/New_York', hw: 'hw_2', browser: 'Edge 142' };
check('69: entries of one account on the same kind of device, system and time zone show as one device', groupDevices([devA, devB]).length === 1);
check('69: ...but bans still need the same hardware fingerprint', sameDevice(devA, devB) === false);
check('69: different time zones stay apart', groupDevices([devA, { ...devB, tz: 'Europe/Paris' }]).length === 2);
const net1 = 'ip_' + 'd1'.repeat(12), net2 = 'ip_' + 'd2'.repeat(12);
await put('ips/' + net1, { label: '192.0.x.x', accounts: ['Air', 'Nova'], devices: [], lastSeen: { $t: Date.now() } });
await put('ips/' + net2, { label: '192.0.x.x', accounts: ['Air'], devices: [], lastSeen: { $t: Date.now() - 60000 } });
openAdminPanel();
await until(() => !$('admin-panel-modal').classList.contains('hidden'));
document.querySelector('.admin-tab[data-admin-tab="ips"]').click();
const rows = () => [...$('ips-list').querySelectorAll('.admin-row')].filter(r => /192\.0\.x\.x/.test(r.textContent));
await until(() => rows().length > 0, 8000);
check('69: one network with two addresses shows as one row', rows().length === 1 && /2 addresses/.test(rows()[0].textContent), rows().map(r => r.textContent));
rows()[0].click();
await until(() => $('ips-detail').querySelector('[data-unlink="Nova"]'), 6000);
$('ips-detail').querySelector('[data-unlink="Nova"]').click();
await T.confirm();
check('69: the x takes an account off the network', !!(await until(async () => { const d = await doc('ips/' + net1); return d && !d.accounts.includes('Nova') && d.accounts.includes('Air'); }, 8000)));
closeModal('admin-panel-modal');

// ---------- 70: the send button keeps the keyboard ----------
await startDMWith('Sumi');
await until(() => currentView === 'dm' && currentDMOtherUid === 'Sumi', 8000);
const box = $('composer-input');
box.focus(); box.value = 'sent with a tap'; box.dispatchEvent(new Event('input'));
const btn = $('composer-send-btn');
const touch = new Touch({ identifier: 1, target: btn, clientX: 0, clientY: 0 });
btn.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch], touches: [], bubbles: true, cancelable: true }));
check('70: tapping send sends the message', !!(await until(() => lastRawMessages.some(m => m.text === 'sent with a tap'), 8000)));
check('70: ...and the message box keeps the focus (so a phone\'s keyboard stays up)', document.activeElement === box);
return T.report();
