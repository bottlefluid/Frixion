// v4.72 in the page (after p1 to p13, on fresh seed data): request 84 (the black hole and space set in the Shop,
// Featured collection row with kind labels, buying through shopPrices/builtin, animations + Epilepsy mode), Blood Moon
// with no blue, and the 3 new easter eggs (making 87).
const { check, until, doc, patch, wait } = T;
const hideModals = () => document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
const css = (el, pseudo) => getComputedStyle(el, pseudo || null);
check('Tester logs in', await T.login('Tester'));
hideModals();

// ---------- syncShopPrices() writes the 7 new built-in items for the server ----------
const pricesDoc = await until(async () => {
  const d = await doc('shopPrices/builtin');
  return d && d.v === '4.72' && d.p && d.p.themes && d.p.themes.blackhole === 1500 ? d : null;
}, 8000);
check('84: Owner login syncs shopPrices/builtin with v4.72 and all 7 space items', !!pricesDoc
  && pricesDoc.p.themes.blackhole === 1500
  && pricesDoc.p.nameplates.blackhole === 800
  && pricesDoc.p.nameplates.planetrise === 600
  && pricesDoc.p.profile_frames.eventhorizon === 800
  && pricesDoc.p.decorations['pocket-blackhole'] === 750
  && pricesDoc.p.profile_effects['fx-blackhole'] === 3600
  && pricesDoc.p.badges.blackhole === 3000, pricesDoc && { v: pricesDoc.v, themes: pricesDoc.p && pricesDoc.p.themes && pricesDoc.p.themes.blackhole });

// ---------- Featured collection row + Shop tabs ----------
const shopBtn = [...document.querySelectorAll('.home-nav-item')].find(e => /Shop/.test(e.textContent));
shopBtn.click();
const colGrid = await until(() => document.querySelector('#shop-pane-featured .shop-collection[data-collection="space"]'), 6000);
const colCards = colGrid ? [...colGrid.querySelectorAll('.shop-item-card')] : [];
const colKeys = colCards.map(c => c.dataset.cat + ':' + c.dataset.item);
const expectedSpace = ['themes:blackhole', 'decorations:pocket-blackhole', 'nameplates:blackhole', 'nameplates:planetrise', 'profile_effects:fx-blackhole', 'profile_frames:eventhorizon', 'badges:blackhole'];
check('84: Featured opens with the "New: black hole and space" collection holding all 7 items',
  !!colGrid && colGrid.previousElementSibling && /black hole and space/i.test(colGrid.previousElementSibling.textContent)
  && expectedSpace.every(k => colKeys.includes(k)) && colCards.length === 7, colKeys);
check('84: every card in the collection row shows its item kind (Theme, Nameplate, etc.)',
  colCards.length === 7 && colCards.every(c => c.querySelector('.sic-kind') && c.querySelector('.sic-kind').textContent.trim().length > 0),
  colCards.map(c => c.querySelector('.sic-kind') && c.querySelector('.sic-kind').textContent));
const featBelow = [...document.querySelectorAll('#shop-pane-featured .shop-item-card')].filter(c => !c.closest('.shop-collection'));
check('84: none of the collection items are duplicated lower down in Featured',
  !featBelow.some(c => expectedSpace.includes(c.dataset.cat + ':' + c.dataset.item)));

// Black Hole theme preview + Blood Moon no-blue fix
switchShopTab('themes', $('shop-browse-toggle'));
const bhThemeCard = await until(() => document.querySelector('#shop-pane-themes .shop-item-card[data-item="blackhole"]'), 4000);
const bhPreview = bhThemeCard && bhThemeCard.querySelector('.sic-theme-preview.sic-theme-blackhole');
check('84: Black Hole theme appears in Dark & Space with its black-hole preview class',
  !!bhPreview && css(bhPreview, '::before').animationName === 'shopBlackHoleTurn', bhPreview && css(bhPreview, '::before').animationName);
const bm = shopThemeById('bloodmoon');
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
check('Blood Moon has no blue left: pure black to dark red to blood red',
  !!bm && bm.bg.join() === '#0a0202,#2a0505,#9a1010' && bm.bg.every(h => { const [r, g, b] = rgb(h); return r > b * 3 && g <= b; }), bm && bm.bg);

// Nameplates tab: round-corner isolation + real backgrounds
switchShopTab('nameplates', $('shop-browse-toggle'));
const bhPlate = await until(() => document.querySelector('#shop-pane-nameplates .sic-nameplate-preview.nameplate-blackhole'), 4000);
const prPlate = document.querySelector('#shop-pane-nameplates .sic-nameplate-preview.nameplate-planetrise');
check('84: Black Hole and Planetrise nameplates show their own backgrounds and keep Safari corner isolation',
  !!bhPlate && !!prPlate && /gradient/.test(css(bhPlate).backgroundImage) && /gradient/.test(css(prPlate).backgroundImage)
  && css(bhPlate).isolation === 'isolate' && css(prPlate).isolation === 'isolate'
  && css(bhPlate, '::before').animationName === 'nameplateBlackHoleTurn',
  bhPlate && { bh: css(bhPlate, '::before').animationName, iso: css(bhPlate).isolation });

// Profile Effects tab: Black Hole canvas draws pixels + Spaghettified egg on 5 pokes
switchShopTab('profile_effects', $('shop-browse-toggle'));
const fxCard = await until(() => document.querySelector('#shop-pane-profile_effects .shop-item-card[data-item="fx-blackhole"]'), 4000);
const fxCv = fxCard && fxCard.querySelector('canvas[data-fx="blackhole"]');
await wait(300);
let fxPixels = 0;
if (fxCv && fxCv.width && fxCv.height) {
  const d = fxCv.getContext('2d').getImageData(0, 0, fxCv.width, fxCv.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 20) fxPixels++;
}
check('84: Black Hole profile effect preview canvas renders its black hole and stars', fxPixels > 50, fxPixels);

for (let i = 0; i < 5; i++) fxCard.querySelector('.sic-name').click();
check('egg: Spaghettified (poke the Black Hole profile effect 5 times)', !!(await until(() => eggFoundSet.has('spaghetti'), 6000)));

// ---------- Real purchase flow through /api/admin/buy + Lost in Space egg ----------
await until(async () => Array.isArray((await doc('users/Tester')).ownedThemes), 6000);
const hadEggs = new Set(eggFoundSet);
await patch('users/Tester', { orbs: 20000, ownedThemes: [], ownedNameplates: [], ownedProfileEffects: [], ownedProfileFrames: [], ownedDecorations: [], ownedBadges: [],
  equippedTheme: null, equippedNameplate: null, equippedProfileEffect: null, equippedProfileFrame: null, equippedDecoration: null });
await until(() => myProfile.orbs === 20000, 6000);
await buyShopItem('themes', 'blackhole');
await buyShopItem('nameplates', 'blackhole');
await buyShopItem('profile_effects', 'fx-blackhole');
await buyShopItem('profile_frames', 'eventhorizon');
await buyShopItem('decorations', 'pocket-blackhole');
await buyShopItem('badges', 'blackhole');
check('egg: Lost in Space (wearing the whole black hole set at once)', !!(await until(() => eggFoundSet.has('lostinspace'), 8000)));
const eggBonus = (hadEggs.has('smoothplate') ? 0 : 100) + (hadEggs.has('matchingset') ? 0 : 250) + (hadEggs.has('lostinspace') ? 0 : 500);
const expectedOrbs = 20000 - (1500 + 800 + 3600 + 800 + 750 + 3000) + eggBonus;
const afterBuy = await until(async () => {
  const d = await doc('users/Tester');
  return d && (d.ownedBadges || []).includes('blackhole') && d.orbs === expectedOrbs ? d : null;
}, 8000);
check('84: buying the 6 Black Hole items through the server charges 10,450 Orbs (plus egg rewards) and equips them',
  !!afterBuy && afterBuy.orbs === expectedOrbs
  && afterBuy.equippedTheme === 'blackhole' && afterBuy.equippedNameplate === 'blackhole'
  && afterBuy.equippedProfileEffect === 'fx-blackhole' && afterBuy.equippedProfileFrame === 'eventhorizon'
  && afterBuy.equippedDecoration === 'pocket-blackhole' && (afterBuy.ownedBadges || []).includes('blackhole'),
  afterBuy || (await doc('users/Tester')));

// ---------- Visual effects on app & profile card ----------
check('84: Black Hole theme activates body.shop-anim-blackhole and turns the corner black hole',
  document.body.classList.contains('shop-anim-blackhole') && css(document.body, '::after').animationName === 'shopBlackHoleTurn',
  css(document.body, '::after').animationName);

await openProfileModal('Tester');
await until(() => $('profile-modal-box').classList.contains('fx-on') && $('profile-frame-layer').classList.contains('frame-eventhorizon'), 6000);
await wait(400);
const profCv = $('profile-fx-canvas');
let profPixels = 0;
if (profCv && profCv.width && profCv.height) {
  const d = profCv.getContext('2d').getImageData(0, 0, profCv.width, profCv.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 20) profPixels++;
}
const hasBadge = badgesFor(myProfile, true).some(b => b.key === 'shop:blackhole');
check('84: profile card shows Event Horizon frame, Black Hole effect, Black Hole nameplate and Black Hole badge',
  css($('profile-frame-layer'), '::before').animationName === 'frameEventHorizonTurn'
  && $('profile-nameplate-bg').classList.contains('nameplate-blackhole')
  && profPixels > 100 && hasBadge,
  { frameAnim: css($('profile-frame-layer'), '::before').animationName, profPixels, hasBadge });

// ---------- Epilepsy mode stops every new animation ----------
document.documentElement.setAttribute('data-epilepsy', '');
const epiStopped = css(document.body, '::after').animationName === 'none'
  && css($('profile-frame-layer'), '::before').animationName === 'none'
  && css($('profile-nameplate-bg'), '::before').animationName === 'none';
document.documentElement.removeAttribute('data-epilepsy');
check('84: Epilepsy mode stops every new black hole animation (theme, frame, nameplate)', epiStopped);
closeModal('profile-modal');

// ---------- Hawking Radiation egg (typed anywhere) + total 87 ----------
if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
for (const ch of 'hawking') document.dispatchEvent(new KeyboardEvent('keydown', { key: ch, code: 'Key' + ch.toUpperCase(), bubbles: true }));
check('egg: Hawking Radiation (type "hawking" anywhere)', !!(await until(() => eggFoundSet.has('hawking'), 6000)));
check('84: EGGS total is 87 and Black holes (v4.72) is in EGG_GROUPS',
  EGGS.length === 87 && EGG_GROUPS.some(([name, ids]) => /v4\.72/.test(name) && ids.join() === 'hawking,spaghetti,lostinspace'),
  EGGS.length);

// Clean up
await equipShopItem('themes', null);
await equipShopItem('nameplates', null);
await equipShopItem('profile_effects', null);
await equipShopItem('profile_frames', null);
await equipShopItem('decorations', null);
return T.report();
