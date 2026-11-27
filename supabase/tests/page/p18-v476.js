// v4.76 in the page (requests 86, 88, 89, 90, 91, 92):
// - 86: 4 new Black Hole-tier animated themes (Supernova, Solar Eclipse, Cosmic Nebula, Crimson Rift) w/ CIEDE2000 >= 5 & Shop card animations
// - 88: Gifted/bought 3d Premium codes hidden from Admin/Owner Codes panel while staff promo codes stay visible
// - 89: Matching Set & Lost in Space (and other equip eggs) no longer re-toast once found or when equipping Music/other items
// - 90: Equinox music has dedicated rpcImage cover art (Banners/equinox-icon.png) in Listening to Activity Status
// - 91: Co-Owner can see and use the Game BOT (still blocked for regular users & Mods/OPs, hidden in /sfmode)
// - 92: Screenshare defaults getDisplayMedia to displaySurface: 'window' and supports live Switch Window (replaceTrack)
// - 3 new easter eggs (supernovae, coownerbot, cosmicwardrobe) -> 99 total
const { check, until, doc, put, patch, wait } = T;
const hideModals = () => document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));

// ---------- 1. Co-Owner can use Game BOT (#91), regular/OP cannot ----------
await patch('users/Sumi', { coowner: true, op: false });
check('Sumi (Co-Owner) logs in', await T.login('Sumi'));
await until(async () => Array.isArray((await doc('users/Sumi')).ownedThemes), 6000);
hideModals();
openGame('merge');
const botBtn = () => gameWin && gameWin.querySelector('#fg-bot-btn');
check('91: Co-Owner sees the BOT button in Blox Merge',
  !!botBtn() && !botBtn().classList.contains('hidden') && gameBotAllowed());
botBtn().click();
check('91: Co-Owner can turn Game BOT ON', gameBotOn === true && botBtn().classList.contains('on'));
sfMode = true; applyAdminVisibility();
check('91: /sfmode still hides and disables Game BOT for Co-Owner', !gameBotOn && botBtn().classList.contains('hidden'));
sfMode = false; applyAdminVisibility();
closeGame();

await patch('users/Sumi', { coowner: false, op: true });
await until(() => myProfile && !myProfile.coowner && myProfile.op === true, 5000);
openGame('merge');
gameBotToggle();
check('91: Mod/OP still cannot use Game BOT', !gameBotAllowed() && !gameBotOn && botBtn().classList.contains('hidden'));
closeGame();
await patch('users/Sumi', { op: false });

// ---------- 2. Log in as Owner (Tester) for remaining checks ----------
check('Tester (Owner) logs in', await T.login('Tester'));
await until(async () => Array.isArray((await doc('users/Tester')).ownedThemes), 6000);
hideModals();

check('v4.76: UPDATES has 4.76 and EGGS has all v4.76 eggs',
  UPDATES.some(u => u.v === '4.76') && EGGS.length >= 99 && !!EGG_BY_ID.supernovae && !!EGG_BY_ID.coownerbot && !!EGG_BY_ID.cosmicwardrobe,
  { v: UPDATES[0].v, count: EGGS.length });

// ---------- 3. #86: 4 new animated W themes + Shop preview + Cosmic Drip egg ----------
const newIds = ['supernova', 'eclipse', 'nebula', 'crimsonrift'];
check('86: all 4 new space themes exist in SHOP_THEMES with anim & featured',
  newIds.every(id => { const t = shopThemeById(id); return t && t.anim === id && t.featured === true && shopSectionOf('themes', t) === 'Dark & Space'; }));

await patch('users/Tester', {
  ownedThemes: [...new Set([...(myProfile.ownedThemes || []), 'blackhole', ...newIds])],
  ownedNameplates: [...new Set([...(myProfile.ownedNameplates || []), 'blackhole'])],
  ownedProfileEffects: [...new Set([...(myProfile.ownedProfileEffects || []), 'fx-blackhole'])],
  ownedProfileFrames: [...new Set([...(myProfile.ownedProfileFrames || []), 'eventhorizon'])],
  ownedDecorations: [...new Set([...(myProfile.ownedDecorations || []), 'pocket-blackhole'])],
  ownedMusic: [...new Set([...(myProfile.ownedMusic || []), 'equinox', 'pure-vessel'])],
});
await until(() => (myProfile.ownedThemes || []).includes('supernova'), 5000);

openHomeMainView('shop');
await until(() => document.querySelector('#shop-pane-featured .sic-theme-supernova'), 5000);
check('86: Shop Featured shows all 4 new animated space themes with their corner-art preview classes',
  newIds.every(id => !!document.querySelector(`#shop-pane-featured .sic-theme-${id}`)));

await equipShopItem('themes', 'supernova');
check('86: equipping Supernova applies .shop-anim-supernova and unlocks Cosmic Drip egg',
  document.body.classList.contains('shop-anim-supernova') && !!(await until(() => eggFoundSet.has('cosmicwardrobe'), 5000)));

// ---------- 4. #89: Matching Set & Lost in Space do NOT re-toast when equipping Music or other items ----------
await put('eggs/Tester', { found: ['matchingset', 'lostinspace', 'smoothplate', 'freshpaint', 'cosmicwardrobe'], at: { $t: Date.now() } });
await loadEggs();
await patch('users/Tester', {
  equippedTheme: 'blackhole',
  equippedNameplate: 'blackhole',
  equippedProfileEffect: 'fx-blackhole',
  equippedProfileFrame: 'eventhorizon',
  equippedDecoration: 'pocket-blackhole',
});
await until(() => myProfile.equippedTheme === 'blackhole' && myProfile.equippedDecoration === 'pocket-blackhole', 5000);
document.querySelectorAll('.egg-toast').forEach(el => el.remove());
await equipShopItem('music', 'equinox');
await wait(250);
const toastsAfterMusic = [...document.querySelectorAll('.egg-toast')].map(el => el.textContent);
check('89: equipping Music while wearing full Black Hole set does NOT re-show Matching Set or Lost in Space egg toasts',
  toastsAfterMusic.length === 0, toastsAfterMusic);

// ---------- 5. #90: Equinox music has dedicated cover art in Listening to Activity Status ----------
const eqTrack = MUSIC_TRACKS.find(m => m.id === 'equinox');
const eqImgResp = await fetch('/' + eqTrack.rpcImage);
musicTrack = eqTrack;
const eqUrl = new URL(eqTrack.rpcImage, 'https://frixionbeta.pages.dev/').href;
const eqAct = cleanActivity({ type: 'listening', name: eqTrack.name, details: 'on Frixion', image: eqUrl, startedAt: Date.now(), source: 'music' });
check('90: Equinox has rpcImage Banners/equinox-icon.png (reachable PNG) and cleanActivity keeps it',
  eqTrack.rpcImage === 'Banners/equinox-icon.png' && eqImgResp.ok && !eqTrack.banner && eqAct && eqAct.image === eqUrl,
  { rpcImage: eqTrack.rpcImage, status: eqImgResp.status, eqAct });
musicTrack = null;

// ---------- 6. #88: Gifted/bought 3d Premium codes hidden from Admin Codes panel ----------
// Seed 1 legacy gifted 3d code (no gifted flag), 1 new gifted code, 1 admin-created 3d Premium code, and 1 Orb code
await put('redeemCodes/FRX-GFT2-GFT3', { code: 'FRX-GFT2-GFT3', type: 'premium', value: 3, createdBy: 'Sumi', maxUses: 1, uses: 0, usedBy: [], redeemedBy: null, createdAt: { $t: Date.now() - 3000 } });
await put('redeemCodes/FRX-NEW4-NEW5', { code: 'FRX-NEW4-NEW5', type: 'premium', value: 3, createdBy: 'Sumi', bought: true, gifted: true, maxUses: 1, uses: 0, usedBy: [], redeemedBy: null, createdAt: { $t: Date.now() - 2000 } });
const staffPrem = await createRedeemCode('premium', 3, 'Tester', 'FRX-ADM2-ADM3', 1);
const staffOrbs = await createRedeemCode('orbs', 500, 'Tester', 'PROMO500', 5);
await renderAdminCodesList();
const codesTxt = $('admin-codes-list').textContent;
check('88: Admin Codes panel hides both legacy & new gifted 3d Premium codes while keeping admin promo codes visible',
  !codesTxt.includes('FRX-GFT2-GFT3') && !codesTxt.includes('FRX-NEW4-NEW5')
  && codesTxt.includes(staffPrem) && codesTxt.includes(staffOrbs)
  && /2 gifted Premium codes hidden/.test(codesTxt),
  { codesTxt });

// ---------- 7. #92: Screenshare defaults to Window surface + Switch Window replaces track live ----------
function mkStream(col) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 180;
  const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 320, 180);
  return c.captureStream(10);
}
const origGdm = navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia ? navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices) : null;
let calls = [], streams = [mkStream('#22c55e'), mkStream('#f97316')];
if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
navigator.mediaDevices.getDisplayMedia = async (opts) => { calls.push(opts); return streams.shift(); };

await until(() => Array.isArray(window.__myDMs) && window.__myDMs.some(d => d.id === 'Sumi_Tester'), 6000);
await selectDM('Sumi_Tester', 'Sumi');
await until(() => ssViewRoom === 'dm:Sumi_Tester' && ssChannels.get('dm:Sumi_Tester')?.joined, 6000);
$('screenshare-toggle').click();
await until(() => !!ssLocalStream && !$('ss-switch-btn').classList.contains('hidden'), 5000);
const firstStream = ssLocalStream;
check('92: getDisplayMedia hints displaySurface:"window" and shows Switch Window button while sharing',
  calls[0] && calls[0].video && calls[0].video.displaySurface === 'window' && !$('ss-switch-btn').classList.contains('hidden'),
  calls[0]);

$('ss-switch-btn').click();
await until(() => ssLocalStream && ssLocalStream !== firstStream, 5000);
check('92: Switch Window swaps to the new window stream live and stops the old track cleanly',
  ssLocalStream !== firstStream && firstStream.getVideoTracks()[0].readyState === 'ended' && ssLocalStream.getVideoTracks()[0].readyState === 'live');
ssStopSharing({ silent: true });
if (origGdm) navigator.mediaDevices.getDisplayMedia = origGdm;
else delete navigator.mediaDevices.getDisplayMedia;

// ---------- 8. Remaining v4.76 word eggs ("supernova" & "coowner") ----------
const box = $('composer-input');
box.focus();
for (const [w, id] of [['supernova', 'supernovae'], ['coowner', 'coownerbot']]) {
  box.value = w;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  check(`v4.76: typing "${w}" unlocks ${id}`, !!(await until(() => eggFoundSet.has(id), 5000)));
}
box.value = '';

// ---------- 9. #85: Accessibility > "Don't repeat easter eggs" toggle (ON by default) ----------
const nrToggle = $('a11y-no-repeat-eggs-toggle');
check('85: Accessibility has "Don\'t repeat easter eggs" toggle (on by default)', !!nrToggle && noRepeatEggsOn() && nrToggle.checked);
// With default ON, already-found egg does NOT replay its toast/effects
document.querySelectorAll('.egg-toast').forEach(el => el.remove());
await eggFind('supernovae');
await wait(150);
check('85: with default ON, already-found egg does NOT replay its toast/effects',
  noRepeatEggsOn() && document.querySelectorAll('.egg-toast').length === 0);

// Unfound egg ("hello") MUST still work and pay Orbs even with toggle ON!
await eggFind('hello');
check('85: with toggle ON, brand-new unfound eggs still trigger and save normally',
  !!(await until(() => eggFoundSet.has('hello'), 5000)) && document.querySelectorAll('.egg-toast').length >= 1);

// Turn toggle OFF via UI checkbox -> saves to localStorage & user profile, re-triggering replays toast!
nrToggle.checked = false;
nrToggle.dispatchEvent(new Event('change'));
await until(async () => (await doc('users/Tester')).a11yNoRepeatEggs === false, 5000);
document.querySelectorAll('.egg-toast').forEach(el => el.remove());
await eggFind('supernovae');
await wait(120);
check('85: turning toggle OFF persists to profile and lets already-found eggs replay their toast',
  !noRepeatEggsOn() && document.querySelectorAll('.egg-toast').length >= 1 && (await doc('users/Tester')).a11yNoRepeatEggs === false);

// Restore default ON cleanly
nrToggle.checked = true;
nrToggle.dispatchEvent(new Event('change'));
await until(async () => (await doc('users/Tester')).a11yNoRepeatEggs === true, 5000);

return T.report();
