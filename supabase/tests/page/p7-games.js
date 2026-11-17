// As Sumi: Orbs from a game (the server's earn route) and spent by one, a game's saved state, cheating refused; the
// RNG game's save, leaderboards and aura queries; a Wordle game and a guess on it; the Shop (buy, equip, unequip,
// equipping what you don't own refused); the privacy setting.
const { check, until, doc, tryIt } = T;
await T.patch('users/Sumi', { orbs: 5000 });
check('Sumi logs in', await T.login('Sumi'));
const start = await until(() => (myProfile.orbs === 5000 && UC.coins === 5000 ? 5000 : null), 10000);
check('the games see Sumi\'s Orbs', start === 5000, { profile: myProfile.orbs, games: UC.coins });
const day0 = await doc('orbDays/Sumi'), got0 = day0 && day0.day === new Date().toISOString().slice(0, 10) ? day0.got : 0;
UC.coins += 40;
await dbUpdateUser(getU(), { coins: UC.coins });
check('a game pays 40 Orbs (through the server)', !!(await until(() => myProfile.orbs === 5040, 12000)), myProfile.orbs);
check('...counted for the day', !!(await until(async () => ((await doc('orbDays/Sumi')) || {}).got === got0 + 40)));
UC.coins -= 15;
await dbUpdateUser(getU(), { coins: UC.coins });
check('a game costs 15 Orbs', !!(await until(() => myProfile.orbs === 5025, 8000)), myProfile.orbs);
await dbUpdateUser(getU(), { cookies: 1234, cookieBuildings: { cursor: 3 } });
check('a game\'s state is saved', !!(await until(async () => { const u = await doc('users/Sumi'); return u.tb && u.tb.cookies === 1234 && u.tb.cookieBuildings.cursor === 3; })));
check('adding Orbs by hand is refused', (await tryIt(() => db.collection('users').doc('Sumi').update({ orbs: firebase.firestore.FieldValue.increment(1000) }))) === 'permission-denied');

// the RNG game (games/ocrng): its whole save in one write, the leaderboards, and the Owner tools' aura queries
const FP = firebase.firestore.FieldPath, save = { name: 'Sumi', rolls: 4321, bestRarity: 2000000, best: 'equinox:x', luck: 1.25,
  auras: { common: 12, 'equinox:x': 1 }, found: { equinox: true }, settings: { vol: { sfx: 0.4, music: 0 }, opfun: false }, gears: {}, hands: { left: null, right: null }, titles: ['Roller'] };
const ref = db.collection('rngSaves').doc('Sumi');
await ref.set(JSON.parse(JSON.stringify(save)));
const back = (await ref.get()).data();
check('the RNG game\'s save, written and read back whole', JSON.stringify(back.auras) === JSON.stringify(save.auras) && back.settings.vol.sfx === 0.4 && back.hands.left === null);
const top = await db.collection('rngSaves').orderBy('rolls', 'desc').limit(8).get();
check('its leaderboard (most rolls)', top.docs.some(d => d.id === 'Sumi'));
check('its leaderboard (rarest aura)', (await db.collection('rngSaves').orderBy('bestRarity', 'desc').limit(8).get()).docs.some(d => d.id === 'Sumi'));
check('who has an aura (a field path with a colon in it)', (await db.collection('rngSaves').where(new FP('auras', 'equinox:x'), '>', 0).get()).docs.some(d => d.id === 'Sumi'));
check('who has found one', (await db.collection('rngSaves').where(new FP('found', 'equinox'), '==', true).get()).docs.some(d => d.id === 'Sumi'));
await ref.update(new FP('auras', 'equinox:x'), firebase.firestore.FieldValue.delete(), new FP('auras', 'legacyequinox:x'), 1);
const swept = (await ref.get()).data().auras;
check('an update by field paths', !('equinox:x' in swept) && swept['legacyequinox:x'] === 1, swept);

// Wordle, in the seeded server's #general
const pcs = await until(() => (window.__myServers || []).find(s => s.id === 'pcs01'));
selectServer(pcs);
await until(() => currentServerId === 'pcs01' && currentChannelId);
await T.patch('servers/pcs01', { apps: ['wordle'] });   // (its owner adding the app: server menu, Add App)
check('the server\'s new app reaches the page live', !!(await until(() => serverHasApp(currentServerData, 'wordle'))));
await startWordleGame();
const game = await until(() => lastRawMessages.find(m => m.wordle && m.wordle.startedBy === 'Sumi'));
check('a Wordle game is posted', !!game);
if (game) {
  await msgRef(game.id).set({ wordle: { plays: { Sumi: { guesses: ['crane'], status: 'playing', at: Date.now() } } } }, { merge: true });
  const after = await doc(`servers/pcs01/channels/${currentChannelId}/messages/${game.id}`);
  check('a guess is saved on it (merged in)', !!after && after.wordle.plays.Sumi.guesses[0] === 'crane' && typeof after.wordle.puzzle === 'number', after && after.wordle);
}

// the Shop: the cheapest theme (the server takes the Orbs), then equip and unequip
const def = SHOP_CATEGORY_DEFS.themes, owned = myProfile[def.ownedField] || [];
const item = def.catalog.filter(i => !i.disabled && i.price > 0 && i.price <= 5000 && !owned.includes(i.id)).sort((a, b) => a.price - b.price)[0];
if (item) {
  const before = myProfile.orbs;
  await buyShopItem('themes', item.id);
  check(`buy the ${item.id} theme`, !!(await until(() => (myProfile[def.ownedField] || []).includes(item.id) && myProfile.orbs === before - item.price, 10000)), { orbs: myProfile.orbs, before, price: item.price });
  await equipShopItem('themes', null);
  check('unequip it', !!(await until(async () => (await doc('users/Sumi'))[def.equipField] === null)));
  await equipShopItem('themes', item.id);
  check('equip it', !!(await until(async () => (await doc('users/Sumi'))[def.equipField] === item.id)));
  check('wearing one you don\'t own is refused', (await tryIt(() => db.collection('users').doc('Sumi').update({ [def.equipField]: 'not_owned_' + Date.now() }))) === 'permission-denied');
} else check('a theme for sale', false, def.catalog.length);

// Settings > Privacy: hide Orbs, then show them again
const box = $('privacy-orbs-toggle');
box.checked = false; await box.onchange({ target: box });
check('hide my Orbs', !!(await until(async () => (await doc('users/Sumi')).hideOrbs === true)));
box.checked = true; await box.onchange({ target: box });
check('show them again', !!(await until(async () => (await doc('users/Sumi')).hideOrbs === undefined)));
T.errorToasts.splice(0); T.uncaught = T.uncaught.filter(u => !/permission-denied/.test(u));   // (the refusals above were the point)
return T.report();
