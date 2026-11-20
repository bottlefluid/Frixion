// v4.71 in the page (after p1 to p12, on fresh seed data): round corners on every nameplate (81), the Shop showing the
// built-in nameplates' real colors, Shop themes that don't look alike (82), text boxes no brighter than before, and the
// 3 new easter eggs.
const { check, until, doc, patch, wait } = T;
const hideModals = () => document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
const css = (el, pseudo) => getComputedStyle(el, pseudo || null);
check('Tester logs in', await T.login('Tester'));
hideModals();
await patch('users/Tester', { ownedNameplates: NAMEPLATES.map(n => n.id), ownedThemes: SHOP_THEMES.map(t => t.id), equippedNameplate: null, equippedTheme: null });
await patch('users/Air', { equippedNameplate: 'galaxy', ownedNameplates: ['galaxy'] });

// ---------- 81: round corners, whatever the browser ----------
// a DM row with a built-in, animated nameplate
const row = document.createElement('div');
row.className = 'dm-row has-nameplate';
row.innerHTML = nameplateBgHTML(nameplateById('aurora')) + '<div class="dm-copy"><div class="dm-name">Air</div></div>';
$('dm-list') ? $('dm-list').appendChild(row) : document.body.appendChild(row);
const art = row.querySelector('.dm-row-nameplate-bg');
check('81: a DM row with a nameplate starts its own stacking context (Safari then clips animated layers to its corners)', css(row).isolation === 'isolate');
check('81: ...and the nameplate art rounds itself to the row', css(art).borderRadius === css(row).borderRadius && css(art).overflow === 'hidden', [css(art).borderRadius, css(row).borderRadius]);
check('81: ...and so does its animated glow layer', css(art, '::before').borderRadius === css(row).borderRadius, css(art, '::before').borderRadius);
row.remove();
// the profile card
await openProfileModal('Air');
await until(() => $('profile-nameplate-bg').classList.contains('nameplate-galaxy'), 6000);
const block = $('profile-name-block'), bg = $('profile-nameplate-bg');
check('81: the profile\'s name block isolates too', css(block).isolation === 'isolate');
check('81: ...and Galaxy\'s art and its stars keep the card\'s round top corners', css(bg).borderRadius === css(block).borderRadius && /^8px 8px 0px 0px$/.test(css(bg).borderRadius) && css(bg, '::before').borderRadius === css(block).borderRadius, [css(bg).borderRadius, css(bg, '::before').borderRadius]);
closeModal('profile-modal');
// the Shop
const shopBtn = [...document.querySelectorAll('.home-nav-item')].find(e => /Shop/.test(e.textContent));
shopBtn.click();
await until(() => $('shop-browse-toggle'), 4000);
switchShopTab('nameplates', $('shop-browse-toggle'));
const blazing = await until(() => document.querySelector('#shop-pane-nameplates .sic-nameplate-preview.nameplate-blazing'), 6000);
check('Shop: Blazing shows its own colors, not the plain gray behind it', !!blazing && /gradient/.test(css(blazing).backgroundImage), blazing && css(blazing).backgroundImage);
const firstSix = ['blazing', 'starfall', 'aurora', 'cybergrid', 'ocean', 'blossom'].map(id => document.querySelector('#shop-pane-nameplates .sic-nameplate-preview.nameplate-' + id));
check('Shop: ...and so do the other five that used to be gray', firstSix.every(p => p && /gradient/.test(css(p).backgroundImage)));
check('81: Shop previews isolate and their glow layers keep the corners', !!blazing && css(blazing).isolation === 'isolate' && css(blazing, '::before').borderRadius === css(blazing).borderRadius);

// ---------- 82: no two Shop themes look alike ----------
// CIEDE2000, averaged at 9 points along the Shop card's 135deg gradient (the same measure used to pick the colors)
const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
function lab([r, g, b]) {
  [r, g, b] = [r, g, b].map(lin);
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, Y = r * 0.2126 + g * 0.7152 + b * 0.0722, Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
function de([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G), C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hh = (a, b) => { if (a === 0 && b === 0) return 0; const x = Math.atan2(b, a) / rad; return x < 0 ? x + 360 : x; };
  const h1p = hh(a1p, b1), h2p = hh(a2p, b2), dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0; if (C1p * C2p) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * rad / 2), Lpm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p; if (C1p * C2p) hpm = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2 : (h1p + h2p) / 2;
  const Tt = 1 - 0.17 * Math.cos((hpm - 30) * rad) + 0.24 * Math.cos(2 * hpm * rad) + 0.32 * Math.cos((3 * hpm + 6) * rad) - 0.2 * Math.cos((4 * hpm - 63) * rad);
  const dTh = 30 * Math.exp(-(((hpm - 275) / 25) ** 2)), RC = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const SL = 1 + 0.015 * (Lpm - 50) ** 2 / Math.sqrt(20 + (Lpm - 50) ** 2), SC = 1 + 0.045 * Cpm, SH = 1 + 0.015 * Cpm * Tt, RT = -Math.sin(2 * dTh * rad) * RC;
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}
const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
const points = t => { const c = t.bg.map(rgbOf); return [0, 0.12, 0.25, 0.4, 0.55, 0.66, 0.78, 0.9, 1].map(p => lab(p <= 0.55 ? mix(c[0], c[1], p / 0.55) : mix(c[1], c[2], (p - 0.55) / 0.45))); };
const P = SHOP_THEMES.map(t => ({ id: t.id, p: points(t) }));
let closest = { d: Infinity };
for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
  const d = P[i].p.reduce((n, x, k) => n + de(x, P[j].p[k]), 0) / P[i].p.length;
  if (d < closest.d) closest = { d: +d.toFixed(2), pair: P[i].id + ' ~ ' + P[j].id };
}
check('82: every pair of Shop theme cards differs by at least 5 (it was 0: Gold and Solar were the same)', closest.d >= 5, closest);
const same = (a, b) => JSON.stringify(shopThemeById(a).bg) === JSON.stringify(shopThemeById(b).bg);
check('82: the pairs that were identical or nearly so now differ', !same('gold', 'solar') && !same('holographic', 'obsidian') && !same('lava', 'copper') && !same('rust', 'neonorange'));
check('82: every theme still has 3 colors', SHOP_THEMES.length === 48 && SHOP_THEMES.every(t => t.bg.length === 3 && t.bg.every(c => /^#[0-9a-f]{6}$/.test(c))));

// ---------- text boxes stay as dark as before ----------
const lum = s => { const m = s.match(/(\d+),\s*(\d+),\s*(\d+)/); const c = [m[1], m[2], m[3]].map(v => lin(v / 255)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const oldBrightest = lum(hexToRgbaStr(lightenHex('#2a5248', 12), 1));   // Mint's text boxes before v4.71, the brightest there was
applyShopTheme('solar');
const solarInput = document.body.style.getPropertyValue('--bg-input');
check('82: Solar (the brightest new color) keeps its text boxes no brighter than the brightest before', lum(solarInput) <= oldBrightest + 0.003, [solarInput, oldBrightest]);
applyShopTheme('blood');
check('82: a theme that kept its colors has exactly the same text boxes as before', document.body.style.getPropertyValue('--bg-input') === hexToRgbaStr(lightenHex('#350606', 12), 0.8));
applyShopTheme(null);

// ---------- the 3 new eggs ----------
await equipShopItem('nameplates', 'lava');
check('egg: Smooth Edges (equip one of Frixion\'s own nameplates)', !!(await until(() => eggFoundSet.has('smoothplate'))));
await until(() => myProfile.equippedNameplate === 'lava', 6000);
await equipShopItem('themes', 'lava');
check('egg: Matching Set (the Lava nameplate and the Lava theme)', !!(await until(() => eggFoundSet.has('matchingset'))));
check('...and not Fresh Paint after one theme', !eggFoundSet.has('freshpaint'));
await wait(300);
await equipShopItem('themes', 'gold');
await wait(300);
await equipShopItem('themes', 'solar');
check('egg: Fresh Paint (3 different bought themes within 2 minutes)', !!(await until(() => eggFoundSet.has('freshpaint'))));
await wait(300);
await equipShopItem('themes', null);
await equipShopItem('nameplates', null);
await until(() => !myProfile.equippedTheme && !myProfile.equippedNameplate, 6000);
check('taking the theme and nameplate off again', !myProfile.equippedTheme && !myProfile.equippedNameplate && !document.body.classList.contains('shop-theme-active'));
return T.report();
