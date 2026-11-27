// v4.78 in the page (Requests #93-#99):
// - #93: OCRNG Quick Open toggle-undo mid-load cancels cleanly with no error toast
// - #94: Closing DMs like Discord (hover/tap ×, users/{uid}/meta/closedDMs, auto-reopen on new msg or selectDM, cleandms egg)
// - #95: Blox Merge & Block Blast death screens sit above tiles (z-index >= 20, Play Again clickable at center)
// - #96: Mobile typing stability (autoResize single-line no-reflow, keyboard-open fixed lock, keepMessagesAnchored height-delta)
// - #98: The Great Shop Rush (4,200+ new items, 4,300+ total, zero dupes, lazy pagination, filter/sort, global search, real buy+equip, shoprush & prismframe eggs)
// - #99: Admin/Owner Panel Gradient Profile Frames creator + live preview + publish + editor
const { check, until, doc, patch, wait } = T;
const hideModals = () => document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));

check('Tester (Owner) logs in', await T.login('Tester'));
await until(() => Array.isArray(window.__myServers) && window.__myServers.some(s => s.id === 'pcs01'), 6000);
await until(() => Array.isArray(window.__myDMs) && window.__myDMs.some(d => d.id === 'Sumi_Tester'), 6000);
hideModals();

// Ensure Tester has plenty of Orbs for Shop Rush purchase checks
await patch('users/Tester', { orbs: 50000 });
await until(() => (myProfile && myProfile.orbs) >= 50000, 4000);

// ---------- 1. Changelog & 105 Easter Eggs ----------
const groupEggIds = EGG_GROUPS.flatMap(g => g[1]);
check('v4.78: UPDATES top is 4.78, EGGS total is 105, all 3 new eggs registered & grouped',
  UPDATES[0].v === '4.78' && EGGS.length === 105 && new Set(groupEggIds).size === 105
  && !!EGG_BY_ID.shoprush && !!EGG_BY_ID.cleandms && !!EGG_BY_ID.prismframe,
  { v: UPDATES[0].v, count: EGGS.length, grouped: new Set(groupEggIds).size });

// ---------- 2. #93 OCRNG Quick Open shortcut + immediate undo ----------
{
  const toasts = [];
  const toastObs = new MutationObserver(muts => {
    muts.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType === 1 && n.classList && n.classList.contains('toast')) toasts.push(n.textContent || '');
    }));
  });
  toastObs.observe(document.body, { childList: true, subtree: true });

  // Case A: Toggle shut while openOcrng is still importing / claiming
  qoOpen({ t: 'game', id: 'ocrng' });
  await wait(15);
  qoOpen({ t: 'game', id: 'ocrng' });
  await wait(350);
  const badA = toasts.filter(t => /problem while loading|could not load/i.test(t));
  check('#93a: Quick Open OCRNG + immediate undo cancels cleanly with no error toast',
    !document.getElementById('ocrng') && badA.length === 0, { hasEl: !!document.getElementById('ocrng'), badA });

  // Case B: Toggle shut right after #ocrng mounts, while open() is mid-await
  qoOpen({ t: 'game', id: 'ocrng' });
  const mounted = await until(() => !!document.getElementById('ocrng'), 6000);
  qoOpen({ t: 'game', id: 'ocrng' });
  await wait(900);
  const badB = toasts.filter(t => /problem while loading|could not load/i.test(t));
  toastObs.disconnect();
  check('#93b: Quick Open OCRNG + undo mid-load closes #ocrng with zero error toast',
    mounted && !document.getElementById('ocrng') && badB.length === 0, { mounted, hasEl: !!document.getElementById('ocrng'), badB });
}

// ---------- 3. #94 Closing DMs like Discord ----------
{
  const rowBefore = document.querySelector('#dm-rows .dm-row[data-dm-id="Sumi_Tester"]');
  check('#94a: DM row renders Discord-style close button (.dm-close-btn)', !!rowBefore && !!rowBefore.querySelector('.dm-close-btn'));

  await selectDM('Sumi_Tester', 'Sumi');
  await until(() => currentView === 'dm' && currentDMId === 'Sumi_Tester', 4000);
  document.querySelector('#dm-rows .dm-row[data-dm-id="Sumi_Tester"] .dm-close-btn').click();
  await wait(250);
  check('#94b: clicking close hides DM from sidebar and leaves the open DM cleanly',
    !document.querySelector('#dm-rows .dm-row[data-dm-id="Sumi_Tester"]') && currentView !== 'dm',
    { stillInDom: !!document.querySelector('#dm-rows .dm-row[data-dm-id="Sumi_Tester"]'), currentView });

  const savedClosed = await until(async () => {
    const d = await doc('users/Tester/meta/closedDMs');
    return d && d.map && Number(d.map.Sumi_Tester) > 0;
  }, 4000);
  check('#94c: closed DM timestamp persisted privately in users/Tester/meta/closedDMs', !!savedClosed);
  check('#94d: closing a DM awards the cleandms (Clean Slate) easter egg',
    !!(await until(() => eggFoundSet.has('cleandms'), 5000)));

  // A newer message brings the DM right back into the list automatically
  await patch('dms/Sumi_Tester', { updatedAt: { $t: Date.now() + 10000 } });
  const backOnMsg = await until(() => !!document.querySelector('#dm-rows .dm-row[data-dm-id="Sumi_Tester"]'), 5000);
  check('#94e: closed DM automatically reappears when a newer message arrives', !!backOnMsg);

  // Close again, then reopen manually via selectDM
  document.querySelector('#dm-rows .dm-row[data-dm-id="Sumi_Tester"] .dm-close-btn').click();
  await until(() => !document.querySelector('#dm-rows .dm-row[data-dm-id="Sumi_Tester"]'), 3000);
  await selectDM('Sumi_Tester', 'Sumi');
  const backOnOpen = await until(() => !!document.querySelector('#dm-rows .dm-row[data-dm-id="Sumi_Tester"]'), 4000);
  check('#94f: opening a closed DM clears closedDMs and restores it to the sidebar', !!backOnOpen && !('Sumi_Tester' in myClosedDMs));
}

// ---------- 4. #95 Blox Merge & Block Blast death screens ----------
{
  openGame('merge');
  await until(() => !!document.getElementById('mg-board') && typeof mergeState === 'object' && !!mergeState, 4000);
  // Fill board with a deadlock (no valid merges) and trigger death screen
  mergeState.grid = [
    [2, 4, 8, 16],
    [32, 64, 128, 256],
    [512, 1024, 2, 4],
    [8, 16, 32, 64],
  ];
  mergeState.highest = 1024;
  mergeState.score = 16964;
  mergeDraw();
  if (mergeNoMoves()) {
    mergeState.over = true;
    const ov = document.getElementById('mg-over');
    ov.style.display = 'flex';
    ov.innerHTML = `<div class="mg-over-card"><div class="sn-title">No moves left</div><div class="sn-sub">Score ${mergeState.score} &middot; Best tile ${mergeState.highest}</div><button class="sn-btn" onclick="mergeStart()">Play again</button></div>`;
  }
  await wait(120);
  const ov = document.getElementById('mg-over');
  const tile = document.querySelector('#mg-board .mg-tile');
  const btn = ov && ov.querySelector('.sn-btn');
  const ovZ = parseInt(getComputedStyle(ov).zIndex, 10) || 0;
  const tileZ = tile ? (parseInt(getComputedStyle(tile).zIndex, 10) || 0) : 0;
  const br = btn.getBoundingClientRect();
  const topAtBtn = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
  check('#95a: Blox Merge death screen paints ABOVE all tiles and Play Again is directly clickable',
    ovZ > tileZ && ovZ >= 20 && (topAtBtn === btn || btn.contains(topAtBtn)),
    { ovZ, tileZ, hitTag: topAtBtn && topAtBtn.className });

  openGame('blockblast');
  await until(() => !!document.getElementById('bb-overlay') && !!bbState, 4000);
  bbStart();
  bbOver();
  await wait(100);
  const bbOv = document.getElementById('bb-overlay');
  const bbBtn = bbOv && bbOv.querySelector('.ts-btn');
  const bbZ = parseInt(getComputedStyle(bbOv).zIndex, 10) || 0;
  const bbr = bbBtn.getBoundingClientRect();
  const topAtBb = document.elementFromPoint(bbr.left + bbr.width / 2, bbr.top + bbr.height / 2);
  check('#95b: Block Blast death screen has z-index >= 20 and Play Again is clickable',
    bbZ >= 20 && (topAtBb === bbBtn || bbBtn.contains(topAtBb)),
    { bbZ, hitTag: topAtBb && topAtBb.className });
  closeGame();
}

// ---------- 5. #98 The Great Shop Rush (4,000+ items) ----------
{
  const gsrCount = Object.values(GSR).reduce((s, a) => s + a.length, 0);
  const totalCount = shopCatalogCounts().total;
  const noDupes = Object.entries(GSR).every(([, list]) =>
    new Set(list.map(x => x.id)).size === list.length && new Set(list.map(x => x.name)).size === list.length);
  const dupeBadgesHidden = SHOP_CATEGORY_DEFS.badges.catalog.length === SHOP_BADGES.length
    && !badgesFor({ ...myProfile, ownedBadges: ['star', 'gsr_bd_0001', 'gsr_bd_0002'] }, true).some(b => String(b.key).includes('gsr_bd_'));
  check('#98a: Great Shop Rush has 4,150+ active items (zero dupes) & 150 April Fools badges stay hidden',
    gsrCount === 4200 && totalCount >= 4150 && noDupes && dupeBadgesHidden, { gsrCount, totalCount, noDupes, dupeBadgesHidden });

  goHomePage('shop');
  await until(() => !$('shop-view').classList.contains('hidden') && !!document.querySelector('.shop-rush-banner'), 4000);
  check('#98b: Shop Featured displays THE GREAT SHOP RUSH banner with live count & jump pills',
    document.querySelector('.shop-rush-banner').textContent.includes('THE GREAT SHOP RUSH')
    && document.querySelectorAll('.shop-rush-pill').length >= 7);

  // Lazy rendering: clicking Themes renders first 48 (+ Free) instead of 1,000+ DOM cards
  document.querySelector('.shop-rush-pill[data-jump-tab="themes"]').click();
  await wait(80);
  const initialThemeCards = document.querySelectorAll('#shop-pane-themes .shop-item-card').length;
  const loadMoreBtn = document.querySelector('#shop-pane-themes .shop-load-more-btn');
  check('#98c: Themes tab paginates lazily (<= 60 cards initially) and shows Load More + filter bar',
    initialThemeCards >= 40 && initialThemeCards <= 60 && !!loadMoreBtn && !!document.querySelector('#shop-pane-themes .shop-filter-bar'),
    { initialThemeCards, hasMore: !!loadMoreBtn });

  loadMoreBtn.click();
  await wait(80);
  const afterMoreCards = document.querySelectorAll('#shop-pane-themes .shop-item-card').length;
  check('#98d: Load More smoothly appends the next batch of Shop items', afterMoreCards > initialThemeCards + 30,
    { initialThemeCards, afterMoreCards });

  // Collection filter + price sort
  const secSel = document.querySelector('#shop-pane-themes [data-sf="sec"]');
  secSel.value = 'Cyberpunk';
  secSel.dispatchEvent(new Event('change'));
  const sortSel = document.querySelector('#shop-pane-themes [data-sf="sort"]');
  sortSel.value = 'price_asc';
  sortSel.dispatchEvent(new Event('change'));
  await wait(60);
  const firstShownIds = [...document.querySelectorAll('#shop-pane-themes .shop-item-card[data-item]')].slice(0, 10).map(el => el.dataset.item);
  const pricesAsc = firstShownIds.map(id => (shopThemeById(id) || {}).price || 0);
  const sortedOk = pricesAsc.length >= 5 && pricesAsc.every((v, i) => i === 0 || v >= pricesAsc[i - 1]);
  check('#98e: Collection filter (Cyberpunk) and Price Low-to-High sort work cleanly', sortedOk, { pricesAsc });

  // Global search from Featured
  document.querySelector('.shop-tab[data-shop-tab="featured"]').click();
  await wait(50);
  $('shop-search').value = 'Prism';
  $('shop-search').dispatchEvent(new Event('input'));
  await wait(80);
  const searchHits = document.querySelectorAll('#shop-pane-featured .shop-item-card').length;
  check('#98f: Global search from Featured finds matching items across all 4,300+ items', searchHits >= 10, { searchHits });
  $('shop-search').value = '';
  $('shop-search').dispatchEvent(new Event('input'));

  // Real server purchase + equip of a Great Shop Rush Gradient Profile Frame -> triggers prismframe egg & renders on profile!
  const pf = profileFrameById('gsr_pf_0001');
  const orbsBefore = myProfile.orbs;
  await buyShopItem('profile_frames', 'gsr_pf_0001');
  const boughtOk = await until(() => (myProfile.ownedProfileFrames || []).includes('gsr_pf_0001') && myProfile.equippedProfileFrame === 'gsr_pf_0001', 5000);
  check('#98g: buying & equipping GSR Gradient Profile Frame gsr_pf_0001 works end-to-end with server pricing',
    !!boughtOk && myProfile.orbs === orbsBefore - pf.price, { boughtOk, orbsBefore, after: myProfile.orbs, price: pf.price });
  check('#98h: equipping a gradient profile frame awards prismframe (Prism Border) egg',
    !!(await until(() => eggFoundSet.has('prismframe'), 5000)));

  await openProfileModal('Tester');
  await until(() => !$('profile-modal').classList.contains('hidden'), 3000);
  const fl = $('profile-frame-layer');
  check('#98i: Profile modal renders gradient profile frame with .frame-custom-gradient & linear-gradient --ring-bg',
    fl.classList.contains('frame-custom-gradient') && /linear-gradient\(/i.test(fl.style.getPropertyValue('--ring-bg')),
    { cls: fl.className, ringBg: fl.style.getPropertyValue('--ring-bg') });
  closeModal('profile-modal');

  // Buy Entire Shop button (all categories in one click)
  await patch('users/Tester', { infOrbs: true });
  await until(() => myProfile && myProfile.infOrbs === true, 4000);
  document.querySelector('.shop-tab[data-shop-tab="featured"]').click();
  await wait(80);
  const entireBtn = $('shop-buy-entire-hero');
  check('Buy Entire Shop button renders on Shop Featured & topbar', !!entireBtn && !!$('shop-buy-entire-btn') && /Buy Entire Shop/.test(entireBtn.textContent));
  entireBtn.click();
  await until(() => !$('confirm-modal').classList.contains('hidden'), 3000);
  $('confirm-modal-confirm-btn').click();
  const ownedEverything = await until(() => shopUnownedSummary().count === 0, 8000);
  check('Buy Entire Shop buys every item across all categories and switches button to Entire Shop Owned',
    !!ownedEverything && (myProfile.ownedThemes || []).length >= 1050 && (myProfile.ownedBanners || []).length >= 800
    && (myProfile.ownedProfileFrames || []).length >= 800 && /Entire Shop Owned/.test($('shop-buy-entire-btn').textContent),
    { left: shopUnownedSummary().count, th: (myProfile.ownedThemes || []).length, bn: (myProfile.ownedBanners || []).length });
  await patch('users/Tester', { infOrbs: false });
}

// ---------- 6. #99 Admin/Owner Panel Gradient Profile Frames creator ----------
{
  openAdminPanel();
  await until(() => !$('admin-panel-modal').classList.contains('hidden'), 3000);
  const shopTab = document.querySelector('.admin-tab[data-admin-tab="shopmanage"]');
  shopTab.click();
  await wait(80);
  const framesSecBtn = document.querySelector('.shop-mgr-tab[data-shop-section="frames"]');
  framesSecBtn.click();
  await wait(80);
  const gradBtn = document.querySelector('.frame-mode-btn[data-mode="gradient"]');
  gradBtn.click();
  await wait(60);
  colorListSet('frame-colors', ['#ff0066', '#ffaa00', '#00e5ff'], updateFramePreview);
  $('frame-angle-input').value = '90';
  $('frame-angle-input').dispatchEvent(new Event('input'));
  $('frame-animated-input').checked = true;
  $('frame-animated-input').dispatchEvent(new Event('change'));
  $('frame-glow-input').checked = true;
  $('frame-glow-input').dispatchEvent(new Event('change'));
  await wait(60);
  const sw = $('frame-preview-swatch');
  check('#99a: Gradient Profile Frame creator live preview shows gradient ring, animation, and glow',
    !$('frame-gradient-fields').classList.contains('hidden')
    && sw.classList.contains('frame-custom-gradient') && sw.classList.contains('frame-grad-anim') && sw.classList.contains('frame-custom-glow')
    && /linear-gradient\(90deg/i.test(sw.style.getPropertyValue('--ring-bg')),
    { cls: sw.className, ringBg: sw.style.getPropertyValue('--ring-bg') });

  $('frame-name-input').value = 'Prism Test';
  $('frame-desc-input').value = 'Staff-made gradient frame';
  $('frame-price-input').value = '777';
  $('frame-publish-btn').click();
  const created = await until(() => customProfileFrames.find(f => f.name === 'Prism Test'), 5000);
  check('#99b: publishing a gradient profile frame saves colors, angle, gradAnim, glow to shopProfileFrames',
    !!created && Array.isArray(created.colors) && created.colors.length === 3 && created.angle === 90 && created.gradAnim === true && created.glow === true,
    created);

  // Open Shop Item Editor on the newly published gradient frame
  if (created) {
    await openShopItemEditor('profile_frames', created.id);
    await until(() => !$('shop-edit-modal').classList.contains('hidden'), 3000);
    const hasColorList = !!$('shop-edit-extra').querySelector('[data-type="color-list"][data-path="colors"]');
    const hasAngle = !!$('shop-edit-extra').querySelector('[data-path="angle"]');
    const hasGradAnim = !!$('shop-edit-extra').querySelector('[data-path="gradAnim"]');
    check('#99c: Shop Item Editor exposes gradient colors, angle, and flowing gradient animation for gradient frames',
      hasColorList && hasAngle && hasGradAnim, { hasColorList, hasAngle, hasGradAnim });
    closeModal('shop-edit-modal');
    // Clean up test frame
    await db.collection('shopProfileFrames').doc(created.id).delete();
  }
  closeModal('admin-panel-modal');
}

// ---------- 7. #96 Mobile typing scroll stability ----------
{
  const input = $('composer-input');
  input.value = 'short test line';
  input.style.height = '';
  autoResize(input);
  const stayedCompact = input.style.height === '';
  document.body.classList.add('is-mobile', 'keyboard-open');
  const bodyPos = getComputedStyle(document.body).position;
  const msgAnchor = getComputedStyle($('messages')).overflowAnchor;
  document.body.classList.remove('is-mobile', 'keyboard-open');
  input.value = '';
  autoResize(input);
  check('#96: autoResize avoids single-line height collapse & mobile keyboard-open pins body position + disables overflow-anchor',
    stayedCompact && bodyPos === 'fixed' && msgAnchor === 'none', { stayedCompact, bodyPos, msgAnchor });
}

// ---------- 8. shoprush word easter egg ----------
{
  for (const ch of 'shoprush') {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
  }
  check('v4.78: typing "shoprush" awards The Great Shop Rush easter egg',
    !!(await until(() => eggFoundSet.has('shoprush'), 5000)));
}

return T.report();
