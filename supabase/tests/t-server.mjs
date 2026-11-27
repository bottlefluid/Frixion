// The server's routes (functions/api: admin, push, discord) with their database on the local Supabase stand-in, through
// functions/_lib/firestore-on-supabase.js. Needs the local setup running (supabase/PLAN.md, "Testing on this PC": the
// Firebase emulators and supabase/local/serve.mjs); starts from fresh data (seed.mjs).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import crypto from 'node:crypto';
import { section, check, summary } from './harness.mjs';
import { OWNER, CHANNEL } from '../local/fake-discord.mjs';

const API = 'http://127.0.0.1:8788/api', SB = 'http://127.0.0.1:54321', SECRET = 'local-secret-key', AUTH = 'http://127.0.0.1:9099', DC = 'http://127.0.0.1:8789';
const seeded = spawnSync(process.execPath, [fileURLToPath(new URL('../local/seed.mjs', import.meta.url))], { encoding: 'utf8' });
if (seeded.status !== 0) { console.error('seed.mjs failed (is serve.mjs running?):', seeded.stderr || seeded.stdout); process.exit(1); }
const uids = JSON.parse(seeded.stdout.trim().split('\n').pop());

const hexEmail = name => [...Buffer.from(name, 'utf8')].map(b => b.toString(16).padStart(2, '0')).join('') + '@u.frixionbeta.pages.dev';
async function tokenOf(name) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: hexEmail(name), password: 'frixion:pass1', returnSecureToken: true }) });
  return (await r.json()).idToken;
}
async function call(fn, route, body, method = 'POST') {
  const r = await fetch(`${API}/${fn}/${route}`, method === 'GET' ? {} : { method, headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...(Array.isArray(j) ? { list: j } : j) };
}
async function rpc(name, args) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SECRET, Authorization: 'Bearer ' + SECRET }, body: JSON.stringify(args) });
  const j = await r.json();
  if (!r.ok) throw new Error(name + ': ' + JSON.stringify(j));
  return j;
}
const doc = async path => { const g = await rpc('fx_get', { path }); return g.exists ? g.data : null; };
const put = (path, data) => rpc('fx_commit', { writes: [{ path, set: data }] });
const now = () => ({ $t: Date.now() });

// ---------------- functions/api/admin ----------------
section('Owner tools and the economy (functions/api/admin)');
const tester = await tokenOf('Tester'), sumi = await tokenOf('Sumi');
let x = await call('admin', 'info', null, 'GET');
check('info: ready', x.ready === true && x.auth === 'ready', x);
x = await call('admin', 'ip', null, 'GET');
check('ip: this address isn\'t banned', x.status === 200 && x.banned === false, x);
const device = 'dev_' + 'a1'.repeat(16);
x = await call('admin', 'seen', { token: tester, device });
const ip = x.id && await doc('ips/' + x.id);
check('seen: the address entry lists the account and the device (append transforms)', !!ip && ip.accounts.includes('Tester') && ip.devices.includes(device) && !!ip.lastSeen, { x, ip });
x = await call('admin', 'claims', { token: tester });
check('claims: role, name and rank from the profile', x.ok && x.claims.role === 'authenticated' && x.claims.n === 'Tester' && x.claims.r === 3, x);

x = await call('admin', 'earn', { token: sumi, n: 100 });
check('earn: 100 Orbs (a new day record, increment result read back)', x.added === 100 && x.orbs === 150, x);
x = await call('admin', 'earn', { token: sumi, n: 50 });
check('earn again: 50 more (the day record\'s version checked)', x.added === 50 && x.orbs === 200, x);
const day = await doc('orbDays/Sumi');
check('earn: the day record counts 150', !!day && day.got === 150 && typeof day.at === 'object', day);

x = await call('admin', 'code', { token: sumi, code: 'welcome' });
check('code: WELCOME pays 10', x.ok && x.orbs === 210, x);
x = await call('admin', 'code', { token: sumi, code: 'WELCOME' });
check('code: not twice by the same account', x.status === 409, x);
const code = await doc('redeemCodes/WELCOME');
check('code: its use is recorded (field mask, version checked)', code.uses === 1 && code.usedBy.includes('Sumi') && code.redeemedBy === 'Sumi', code);

x = await call('admin', 'egg', { token: sumi, egg: 'frixion' });
const eggOrbs = x.orbs;
check('egg: found and paid once', x.ok && eggOrbs > 0 && x.balance === 210 + eggOrbs, x);
x = await call('admin', 'egg', { token: sumi, egg: 'frixion' });
check('egg: the second time pays nothing', x.already === true, x);

await put('shopPrices/builtin', { p: { themes: { midnight_test: 100 } } });
x = await call('admin', 'buy', { token: sumi, cat: 'themes', id: 'midnight_test' });
check('buy: paid', x.ok && x.price === 100 && x.orbs === 210 + eggOrbs - 100, x);
let sumiP = await doc('users/Sumi');
check('buy: owned, worn and Orbs taken in one write', sumiP.ownedThemes.includes('midnight_test') && sumiP.equippedTheme === 'midnight_test' && sumiP.orbs === x.orbs, sumiP);
x = await call('admin', 'buy', { token: sumi, cat: 'themes', id: 'midnight_test' });
check('buy: not twice', x.status === 409, x);

const before = sumiP.orbs;
x = await call('admin', 'casino', { token: sumi, game: 'coinflip', bet: 10, side: 'h' });
sumiP = await doc('users/Sumi');
check('casino coinflip: settled by the server', x.status === 200 && (x.result === 'h' || x.result === 't'), x);
check('casino: the balance is the bet taken and the win paid', sumiP.orbs === before - 10 + (Number(x.payout) || 0), { before, after: sumiP.orbs, x });

x = await call('admin', 'one-time-password', { token: tester, username: 'Air' });
const otp = x.password;
check('one-time password: made by the Owner', typeof otp === 'string' && otp.length === 10, x);
x = await call('admin', 'one-time-password', { token: sumi, username: 'Air' });
check('one-time password: nobody else may make one', x.status === 403, x);
let y = await call('admin', 'redeem', { username: 'Air', code: otp });
check('one-time password: logs in (a custom token)', typeof y.token === 'string', y);
const signed = y.token && await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: y.token, returnSecureToken: true }) })).json();
check('one-time password: the token signs in as Air', !!signed && !!signed.idToken && JSON.parse(Buffer.from(signed.idToken.split('.')[1], 'base64url')).user_id === uids.Air, signed);
y = await call('admin', 'redeem', { username: 'Air', code: otp });
check('one-time password: only once (deleted with an exists check)', y.status === 403, y);

x = await call('admin', 'loan', { token: sumi, action: 'ask', to: 'Tester', amount: 100, time: '1d', note: 'test loan' });
const loanId = x.id || (x.loan && x.loan.id);
check('loan: asked', x.status === 200 && !!loanId, x);
x = await call('admin', 'loan', { token: tester, action: 'answer', id: loanId, yes: true });
let loan = loanId && await doc('loans/' + loanId);
check('loan: answered yes (the loan and the lender in one write)', x.status === 200 && !!loan && loan.status === 'active', { x, loan });
x = await call('admin', 'loan', { token: sumi, action: 'check', with: 'Tester' });
check('loan: check finds it (a query on two fields)', x.status === 200 && JSON.stringify(x).includes(loanId), x);
x = await call('admin', 'loan', { token: sumi, action: 'pay', id: loanId, amount: 40 });
loan = await doc('loans/' + loanId);
check('loan: part paid back', x.status === 200 && loan.paid === 40, { x, loan });

section('v4.66 on the server');
let air = await doc('users/Air');
check('52: the one-time password used on Air is in Air\'s securityLog, with who made it',
  Array.isArray(air.securityLog) && air.securityLog.length === 1 && air.securityLog[0].by === 'Tester' && air.securityLog[0].at > 0, air.securityLog);
// 45: Sumi and Tester were both seen on this network (127.0.0.1), so paying the rest back moves no credit
await call('admin', 'seen', { token: sumi, device: 'dev_' + 'b2'.repeat(16) });
const credit0 = (await doc('users/Sumi')).credit || 0;
x = await call('admin', 'loan', { token: sumi, action: 'pay', id: loanId });
check('45: a loan between accounts on the same network, paid back in full on time: no credit', x.status === 200 && x.done === true && x.credit === 0 && ((await doc('users/Sumi')).credit || 0) === credit0, x);
// two accounts never seen together: the first loan paid back counts in full, the second between them half
const nova = await tokenOf('Nova');
await rpc('fx_commit', { writes: [{ path: 'users/Nova', updatePaths: [[['orbs'], 5000]] }] });
const airTok = await tokenOf('Air'), credits = [];
for (let i = 0; i < 2; i++) {
  x = await call('admin', 'loan', { token: airTok, action: 'ask', to: 'Nova', amount: 1000, time: '1d' });
  const id = x.loan && x.loan.id;
  await call('admin', 'loan', { token: nova, action: 'answer', id, yes: true });
  x = await call('admin', 'loan', { token: airTok, action: 'pay', id });
  credits.push(x.credit);
}
check('45: Air and Nova (not linked): the first loan paid back gives 20 credit, the second between them 10', credits[0] === 20 && credits[1] === 10, credits);
// 51: Orbs past what a number can hold (written as 1e309, read back as Infinity) count as infinite on the server
const big = await fetch(`${SB}/rest/v1/rpc/fx_commit`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SECRET, Authorization: 'Bearer ' + SECRET },
  body: '{"writes":[{"path":"users/Nova","updatePaths":[[["orbs"],1e309]]}]}' });
check('51: Nova\'s Orbs set past the largest number', big.ok && (await doc('users/Nova')).orbs === Infinity, await big.text());
x = await call('admin', 'casino', { token: nova, game: 'coinflip', bet: 100, side: 'h' });
check('51: the infinity sign can bet (it said "not enough Orbs" after the move)', x.status === 200 && (x.result === 'h' || x.result === 't'), x);
check('...and stays infinite, win or lose', (await doc('users/Nova')).orbs === Infinity, await doc('users/Nova'));
x = await call('admin', 'egg', { token: nova, egg: 'equilibrium' });
check('the new eggs are known to the server (105 in all since v4.78)', x.ok && x.total === 105, x);
x = await call('admin', 'egg', { token: nova, egg: 'matchingset' });
check('v4.71: Matching Set (a nameplate and a theme with the same name) is one of them', x.ok && x.total === 105, x);
const bhEggs = await Promise.all(['hawking', 'spaghetti', 'lostinspace'].map(egg => call('admin', 'egg', { token: nova, egg })));
check('v4.72: Hawking Radiation, Spaghettified and Lost in Space pay their tiers (100, 250, 500)', bhEggs.every(r => r.ok && r.total === 105) && bhEggs.map(r => r.orbs).join() === '100,250,500', bhEggs);
const botEggs = await Promise.all(['autopilot', 'beepboop', 'arcadepro'].map(egg => call('admin', 'egg', { token: nova, egg })));
check('v4.73: Autopilot, Beep Boop and Arcade Regular pay their tiers (100, 100, 250)', botEggs.every(r => r.ok && r.total === 105) && botEggs.map(r => r.orbs).join() === '100,100,250', botEggs);
const oldSimon = await call('admin', 'egg', { token: nova, egg: 'simon15' });
const newSimon = await call('admin', 'egg', { token: nova, egg: 'simon67' });
check('v4.74: old simon15 is retired (404, forcing re-earn without SQL) and simon67 pays 1000', oldSimon.status === 404 && newSimon.ok && newSimon.orbs === 1000 && newSimon.total === 105, { oldSimon, newSimon });
const v474Eggs = await Promise.all(['liquiddash', 'pocketmaze', 'gdwave'].map(egg => call('admin', 'egg', { token: nova, egg })));
check('v4.74: Demon Slayer, Thumb Runner and Nine Circles pay their tiers (500, 100, 100)', v474Eggs.every(r => r.ok && r.total === 105) && v474Eggs.map(r => r.orbs).join() === '500,100,100', v474Eggs);
const v475Eggs = await Promise.all(['watchparty', 'screensaver', 'golive'].map(egg => call('admin', 'egg', { token: nova, egg })));
check('v4.75: Front Row, Screen Saver and Going Live pay their tiers (100, 100, 100)', v475Eggs.every(r => r.ok && r.total === 105) && v475Eggs.map(r => r.orbs).join() === '100,100,100', v475Eggs);
const v476Eggs = await Promise.all(['supernovae', 'coownerbot', 'cosmicwardrobe'].map(egg => call('admin', 'egg', { token: nova, egg })));
check('v4.76: Starburst, Double Shift and Cosmic Drip pay their tiers (100, 100, 250)', v476Eggs.every(r => r.ok && r.total === 105) && v476Eggs.map(r => r.orbs).join() === '100,100,250', v476Eggs);
const v477Eggs = await Promise.all(['centurion', 'savedforlater', 'passiton'].map(egg => call('admin', 'egg', { token: nova, egg })));
check('v4.77: Century Club (#100), Saved for Later and Pass It On pay their tiers (500, 100, 100)', v477Eggs.every(r => r.ok && r.total === 105) && v477Eggs.map(r => r.orbs).join() === '500,100,100', v477Eggs);
const v478Eggs = await Promise.all(['shoprush', 'cleandms', 'prismframe'].map(egg => call('admin', 'egg', { token: nova, egg })));
check('v4.78: The Great Shop Rush, Clean Slate and Prism Border pay their tiers (100, 100, 250)', v478Eggs.every(r => r.ok && r.total === 105) && v478Eggs.map(r => r.orbs).join() === '100,100,250', v478Eggs);

// v4.78: Great Shop Rush (4,200 deterministic items) server pricing + buy & buyAll
x = await call('admin', 'buy', { token: nova, cat: 'themes', id: 'gsr_th_0001' });
check('v4.78: buy Great Shop Rush theme gsr_th_0001 directly without shopPrices/builtin bloat', x.ok && Number.isInteger(x.price) && x.price > 0, x);
x = await call('admin', 'buyall', { token: nova, cat: 'profile_frames', ids: ['gsr_pf_0001', 'gsr_pf_0002', 'gsr_pf_0003'] });
check('v4.78: buyAll works on Great Shop Rush gradient profile frames', x.ok && Array.isArray(x.bought) && x.bought.length === 3 && x.total > 0, x);
x = await call('admin', 'buy', { token: nova, cat: 'themes', id: 'gsr_th_9999' });
check('v4.78: out-of-range GSR id is rejected (404)', x.status === 404, x);
await put('shopPrices/builtin', { p: { themes: { midnight_test: 100, gsr_th_0002: 77 } } });
x = await call('admin', 'buy', { token: nova, cat: 'themes', id: 'gsr_th_0002' });
check('v4.78: staff price override in shopPrices/builtin still overrides GSR default price', x.ok && x.price === 77, x);
// Buy Entire Shop (/api/admin/buyshop): buys every unowned item across ALL categories (built-in, GSR, and staff-made) in one commit
await put('shopBanners/custom_ban_1', { name: 'Staff Banner', desc: 'Test', price: 250, colors: ['#ff0000', '#0000ff'], angle: 90 });
x = await call('admin', 'buyshop', { token: sumi });
check('buyshop: refuses when caller cannot afford the entire Shop (402)', x.status === 402, x);
x = await call('admin', 'buyshop', { token: nova });
const novaAll = await doc('users/Nova');
check('buyshop: Nova (infinite Orbs) buys every remaining Shop item across all categories in one commit',
  x.ok && x.count >= 4045 && x.total > 0 && novaAll.ownedThemes.length >= 1000 && novaAll.ownedBanners.includes('custom_ban_1')
  && novaAll.ownedNameplates.length >= 850 && novaAll.ownedProfileFrames.length >= 800 && novaAll.ownedDecorations.length >= 350
  && novaAll.ownedProfileEffects.length >= 250 && !(novaAll.ownedBadges || []).includes('gsr_bd_0001'),
  { ok: x.ok, count: x.count, total: x.total, th: novaAll.ownedThemes.length, bn: novaAll.ownedBanners.length });
x = await call('admin', 'buy', { token: nova, cat: 'badges', id: 'gsr_bd_0001' });
check('April Fools badges (gsr_bd_*) stay off until re-enabled (404)', x.status === 404, x);
x = await call('admin', 'buyshop', { token: nova });
check('buyshop: calling again once everything is owned returns 409', x.status === 409, x);

section('v4.67 on the server: Provably Fair, bets without a top limit, referrals');
const fairJs = await import(new URL('../../casino-fair.js', import.meta.url).href);
await rpc('fx_commit', { writes: [{ path: 'users/Air', updatePaths: [[['orbs'], 200000], [['createdAt'], { $t: Date.now() - 3600000 }]] }] });
x = await call('admin', 'casino', { token: airTok, game: 'info' });
const fair0 = x.fair;
check('56: the Casino shows your seed before you bet: its fingerprint, client seed and nonce 0', !!fair0 && /^[0-9a-f]{64}$/.test(fair0.hash) && fair0.n === 0 && typeof fair0.c === 'string', x.fair);
const bets = [];
for (const side of ['h', 't']) bets.push(await call('admin', 'casino', { token: airTok, game: 'coinflip', bet: 10, side }));
check('56: each bet says which seed and nonce it used (0, then 1)', bets[0].fair && bets[0].fair.n === 0 && bets[1].fair.n === 1 && bets[0].fair.hash === fair0.hash, bets.map(b => b.fair));
const diceBet = await call('admin', 'casino', { token: airTok, game: 'dice', bet: 10, target: 50, over: true });
let mineBet = await call('admin', 'casino', { token: airTok, game: 'mines', action: 'start', bet: 10, mines: 3 });
mineBet = await call('admin', 'casino', { token: airTok, game: 'mines', action: 'step', ticket: mineBet.ticket, path: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21] });
check('56: a finished Mines game shows its board and seeds', mineBet.over === true && Array.isArray(mineBet.mines) && mineBet.fair && mineBet.fair.n === 3, mineBet);
x = await call('admin', 'casino', { token: airTok, game: 'mines', action: 'start', bet: 10, mines: 3 });
const rot409 = await call('admin', 'casino', { token: airTok, game: 'fair', action: 'rotate' });
check('56: no changing seeds while a game is going', rot409.status === 409, rot409);
await call('admin', 'casino', { token: airTok, game: 'mines', action: 'forfeit' });
await call('admin', 'casino', { token: airTok, action: 'forfeit' });
const bad = await call('admin', 'casino', { token: airTok, game: 'fair', action: 'rotate', client: 'not ok!' });
check('56: a client seed is letters, digits, - and _', bad.status === 400, bad);
const rot = await call('admin', 'casino', { token: airTok, game: 'fair', action: 'rotate', client: 'my-seed_1' });
check('56: changing seeds shows the old server seed, which has the fingerprint shown before', !!rot.old && rot.old.hash === fair0.hash && await fairJs.sha256Hex(rot.old.seed) === fair0.hash && rot.old.n === 5, rot.old);
check('...and starts a new one: new fingerprint, your client seed, nonce 0', rot.hash !== fair0.hash && rot.c === 'my-seed_1' && rot.n === 0 && rot.e === 1, rot);
const seed0 = rot.old.seed, numbersFor = n => fairJs.fairStream(seed0, fair0.c, n);
check('56: anyone can work the coinflips out again from the seeds', fairJs.DRAW.coinflip(await numbersFor(0)) === bets[0].result && fairJs.DRAW.coinflip(await numbersFor(1)) === bets[1].result, bets.map(b => b.result));
check('...and the dice roll', fairJs.DRAW.dice(await numbersFor(2)) / 100 === diceBet.roll, { roll: diceBet.roll });
check('...and where the mines were', fairJs.DRAW.mines(await numbersFor(3), { m: 3 }).sort((a, b) => a - b).join() === mineBet.mines.slice().sort((a, b) => a - b).join(), mineBet.mines);
x = await call('admin', 'casino', { token: airTok, game: 'fair', action: 'reveal', e: 0 });
check('56: an earlier seed can be shown again', x.ok && x.seed === seed0, x);
x = await call('admin', 'casino', { token: airTok, game: 'fair', action: 'reveal', e: 1 });
check('...but never the one in use', x.status === 400, x);

x = await call('admin', 'casino', { token: airTok, game: 'coinflip', bet: 50000, side: 'h' });
check('60: a bet over the old 10,000 limit goes through', x.status === 200 && x.stake === 50000, x);
x = await call('admin', 'casino', { token: airTok, game: 'coinflip', bet: 10000000, side: 'h' });
check('60: ...but never more than you have', x.status === 400 && /enough Orbs/.test(x.error), x);

x = await call('admin', 'referral', { token: nova, action: 'make', code: 'nova1' });
check('56: Nova makes a referral code (kept in capitals)', x.ok && x.code === 'NOVA1', x);
x = await call('admin', 'referral', { token: nova, action: 'make', code: 'other' });
check('...only one each', x.status === 409, x);
x = await call('admin', 'referral', { token: sumi, action: 'make', code: 'NOVA1' });
check('...and nobody else gets the same code', x.status === 409, x);
const vee = await tokenOf('Air');
x = await call('admin', 'referral', { token: vee, action: 'join', code: 'NOVA1' });
check('56: Air (played Casino games already) can\'t join with a code', x.status === 403, x);
await rpc('fx_commit', { writes: [{ path: 'users/Air', updatePaths: [[['casino', 'games'], 0]] }] });
x = await call('admin', 'referral', { token: vee, action: 'join', code: 'nova1' });
check('56: a new account joins with Nova\'s code', x.ok && x.referredBy === 'Nova' && (await doc('users/Nova')).referral.friends === 1, x);
x = await call('admin', 'referral', { token: vee, action: 'join', code: 'NOVA1' });
check('...once', x.status === 409, x);
const earned0 = ((await doc('users/Nova')).referral || {}).earned || 0, wag0 = ((await doc('users/Air')).casino || {}).wagered || 0;
x = await call('admin', 'casino', { token: vee, game: 'coinflip', bet: 10000, side: 'h' });
const expect = Math.floor(10000 * 0.03 * 0.1) + Math.floor(Math.max(0, x.payout - 10000) * 0.05) + (wag0 < 10000 ? 10000 : 0);
check('56: Nova earns from Air\'s bet: 10% of the house edge, 5% of a win, and 10,000 at 10,000 bet', ((await doc('users/Nova')).referral.earned - earned0) === expect, { expect, earned: (await doc('users/Nova')).referral, payout: x.payout, wag0 });
await call('admin', 'referral', { token: sumi, action: 'make', code: 'SUMI1' });
await rpc('fx_commit', { writes: [{ path: 'users/Tester', updatePaths: [[['createdAt'], { $t: Date.now() }], [['casino'], {}]] }] });
x = await call('admin', 'referral', { token: tester, action: 'join', code: 'SUMI1' });
check('56: a code can\'t be used on its owner\'s network (Tester and Sumi share one)', x.status === 403 && /same device or network/.test(x.error), x);

section('v4.68 on the server: the Premium game limit, used-up codes, Orb gifts, networks, taking accounts off');
const today = new Date().toISOString().slice(0, 10);
await put('orbDays/Nova', { day: today, got: 19990, at: now() });
x = await call('admin', 'earn', { token: nova, n: 100 });
check('67: without Premium, games still stop at 20,000 a day', x.added === 10 && x.cap === 20000 && x.left === 0, x);
await rpc('fx_commit', { writes: [{ path: 'users/Nova', updatePaths: [[['premiumUntil'], Date.now() + 86400000]] }] });
x = await call('admin', 'earn', { token: nova, n: 100 });
check('67: with Premium the limit is 100,000', x.added === 100 && x.cap === 100000 && x.left === 100000 - 20100, x);
await put('redeemCodes/ONCE68', { code: 'ONCE68', type: 'orbs', value: 5, maxUses: 1, createdBy: 'Tester', createdAt: now() });
await put('redeemCodes/TWICE68', { code: 'TWICE68', type: 'orbs', value: 5, maxUses: 2, createdBy: 'Tester', createdAt: now() });
x = await call('admin', 'code', { token: sumi, code: 'ONCE68' });
check('66: a one-use code pays, then it\'s deleted', x.ok && (await doc('redeemCodes/ONCE68')) === null, x);
x = await call('admin', 'code', { token: sumi, code: 'TWICE68' });
const twice = await doc('redeemCodes/TWICE68');
check('66: a two-use code stays after its first use', x.ok && !!twice && twice.uses === 1, { x, twice });
x = await call('admin', 'code', { token: nova, code: 'TWICE68' });
check('66: ...and is deleted by its second', x.ok && (await doc('redeemCodes/TWICE68')) === null, x);
const sumi68 = (await doc('users/Sumi')).orbs, nova68 = (await doc('users/Nova')).orbs;
x = await call('admin', 'loan', { token: sumi, action: 'gift', to: 'Nova', amount: 67, note: 'six seven' });
const giftDoc = x.gift && await doc('loans/' + x.gift.id), novaG = await doc('users/Nova');
check('68: a gift moves the Orbs at once', x.ok && x.orbs === sumi68 - 67 && (await doc('users/Sumi')).orbs === sumi68 - 67 && novaG.orbs === nova68 + 67, { x, sumi68, nova68, after: novaG.orbs });
check('68: ...is kept with the loans, for both histories', !!giftDoc && giftDoc.status === 'gift' && giftDoc.from === 'Sumi' && giftDoc.to === 'Nova' && giftDoc.amount === 67 && giftDoc.note === 'six seven', giftDoc);
check('68: ...and tells Nova (giftIn), with both in each other\'s loanWith', novaG.giftIn && novaG.giftIn.from === 'Sumi' && novaG.giftIn.amount === 67 && novaG.loanWith.includes('Sumi') && (await doc('users/Sumi')).loanWith.includes('Nova'), novaG);
x = await call('admin', 'loan', { token: sumi, action: 'check', with: 'Nova' });
check('68: the gift comes back in the loan list', x.ok && x.loans.some(l => l.status === 'gift' && l.amount === 67), x);
x = await call('admin', 'loan', { token: sumi, action: 'gift', to: 'Nova', amount: sumi68 });
check('68: never more than you have', x.status === 402, x);
x = await call('admin', 'loan', { token: sumi, action: 'gift', to: 'Sumi', amount: 5 });
const self68 = x.status;
x = await call('admin', 'loan', { token: sumi, action: 'gift', to: 'Nova', amount: 1.5 });
check('68: not to yourself, and only whole Orbs', self68 === 400 && x.status === 400, { self68, x });
x = await call('admin', 'loan', { token: sumi, action: 'gift', to: 'NoSuchPerson', amount: 5 });
check('68: not to an account that isn\'t there', x.status === 404, x);
await rpc('fx_commit', { writes: [{ path: 'users/Tester', updatePaths: [[['infOrbs'], true]] }] });
const testerOrbs = (await doc('users/Tester')).orbs, air68 = (await doc('users/Air')).orbs;
x = await call('admin', 'loan', { token: tester, action: 'gift', to: 'Air', amount: 1e12 });
check('68: infinite Orbs give without running out', x.ok && (await doc('users/Tester')).orbs === testerOrbs && (await doc('users/Air')).orbs === air68 + 1e12, x);
await rpc('fx_commit', { writes: [{ path: 'users/Tester', updatePaths: [[['infOrbs'], false]] }] });

const seenFrom = async (addr, tok = tester) => (await (await fetch(`${API}/admin/seen`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Test-IP': addr }, body: JSON.stringify({ token: tok }) })).json()).id;
const v6a = await seenFrom('2601:abc:def:1:aaaa:bbbb:cccc:1'), v6b = await seenFrom('2601:abc:def:1::77'), v6c = await seenFrom('2601:abc:def:2::1');
check('69: two addresses in one IPv6 network are one entry (its /64)', !!v6a && v6a === v6b && v6c !== v6a, { v6a, v6b, v6c });
check('69: an IPv4 address keeps the id it always had', (await seenFrom('203.0.113.9')) === 'ip_' + crypto.createHmac('sha256', crypto.createHash('sha256').update('frixion-ip:test-ip-key').digest()).update('203.0.113.9').digest('hex').slice(0, 24));
const oldId = 'ip_' + crypto.createHmac('sha256', crypto.createHash('sha256').update('frixion-ip:test-ip-key').digest()).update('2601:abc:def:9::5').digest('hex').slice(0, 24);
await put('bannedIps/' + oldId, { reason: 'old ban', at: Date.now() });
x = await (await fetch(`${API}/admin/ip`, { headers: { 'X-Test-IP': '2601:abc:def:9::5' } })).json();
check('69: a ban made on one IPv6 address before v4.68 still counts for it', x.banned === true && x.reason === 'old ban', x);

const devBoth = 'dev_' + 'c3'.repeat(16), devOnly = 'dev_' + 'c4'.repeat(16), devBanned = 'dev_' + 'c5'.repeat(16), netBoth = 'ip_' + 'ab'.repeat(12);
await put('devices/' + devBoth, { id: devBoth, accounts: ['Tester', 'Sumi'], name: 'Windows PC' });
await put('devices/' + devOnly, { id: devOnly, accounts: ['Sumi'], name: 'Windows PC' });
await put('devices/' + devBanned, { id: devBanned, accounts: ['Sumi'], name: 'Windows PC', banned: true });
await put('ips/' + netBoth, { accounts: ['Sumi', 'Tester'], label: '198.51.x.x' });
x = await call('admin', 'unlink', { token: sumi, kind: 'devices', ids: [devBoth], account: 'Tester' });
check('69: only the Owner can take accounts off', x.status === 403, x);
x = await call('admin', 'unlink', { token: tester, kind: 'devices', ids: [devBoth, devOnly, devBanned], account: 'Sumi' });
const [dBoth, dOnly, dBanned] = [await doc('devices/' + devBoth), await doc('devices/' + devOnly), await doc('devices/' + devBanned)];
check('69: Sumi is taken off the devices; an entry left empty goes, a banned one stays (with its ban)',
  x.ok && x.changed === 3 && dBoth.accounts.join() === 'Tester' && dOnly === null && !!dBanned && dBanned.banned === true && dBanned.accounts.length === 0, { x, dBoth, dOnly, dBanned });
x = await call('admin', 'unlink', { token: tester, kind: 'ips', ids: [netBoth], account: 'Sumi' });
check('69: ...and off a network', x.ok && (await doc('ips/' + netBoth)).accounts.join() === 'Tester', x);
x = await call('admin', 'unlink', { token: tester, kind: 'ips', ids: ['not-an-id'], account: 'Sumi' });
check('69: nothing happens with ids that aren\'t ids', x.status === 400, x);

section('v4.69 on the server: Grow a Garden trades, webhooks');
await rpc('fx_commit', { writes: [
  { path: 'users/Sumi', updatePaths: [[['tb', 'ggBackpack'], { seeds: { carrot: 3 }, sprinklers: { basic: 1 } }]] },
  { path: 'users/Nova', updatePaths: [[['tb', 'ggBackpack'], { seeds: { tomato: 2 }, sprinklers: {} }]] }] });
const trade = (tok, body) => call('admin', 'gagtrade', { token: tok, ...body });
x = await trade(sumi, { action: 'offer', to: 'Nova', give: { seeds: { carrot: 5 } }, want: {} });
check('65: no offering more than your backpack holds', x.status === 409, x);
x = await trade(sumi, { action: 'offer', to: 'Sumi', give: { seeds: { carrot: 1 } } });
const selfOffer = x.status;
x = await trade(sumi, { action: 'offer', to: 'Nova', give: {}, want: {} });
const emptyOffer = x.status;
x = await trade(sumi, { action: 'offer', to: 'Nova', give: { seeds: { carrot: 1.5 } } });
check('65: not to yourself, not empty, whole numbers only', selfOffer === 400 && emptyOffer === 400 && x.status === 400, { selfOffer, emptyOffer, x });
x = await trade(sumi, { action: 'offer', to: 'Nova', give: { seeds: { carrot: 2 } }, want: { seeds: { tomato: 1 } }, note: 'carrots for a tomato' });
const t1 = x.trade && x.trade.id, t1doc = t1 && await doc('gardenTrades/' + t1);
check('65: Sumi offers 2 carrots for a tomato', x.ok && t1doc && t1doc.status === 'open' && t1doc.give.seeds.carrot === 2 && t1doc.want.seeds.tomato === 1 && t1doc.note === 'carrots for a tomato', { x, t1doc });
check('65: ...and Nova is told (ggTradeIn)', (await doc('users/Nova')).ggTradeIn.kind === 'offer' && (await doc('users/Nova')).ggTradeIn.from === 'Sumi');
x = await trade(sumi, { action: 'accept', id: t1 });
check('65: Sumi can\'t accept her own offer', x.status === 403, x);
x = await trade(airTok, { action: 'accept', id: t1 });
check('65: nobody else can either', x.status === 404, x);
x = await trade(nova, { action: 'accept', id: t1 });
check('65: Nova accepts', x.ok && x.trade.status === 'accepted' && (await doc('gardenTrades/' + t1)).status === 'accepted', x);
check('65: ...and Sumi is told', (await doc('users/Sumi')).ggTradeIn.kind === 'accepted');
x = await trade(nova, { action: 'accept', id: t1 });
check('65: only once', x.status === 409, x);
x = await trade(sumi, { action: 'collect', id: t1 });
check('65: Sumi collects what she\'s owed', x.ok && x.trade.fromDone === true && x.trade.want.seeds.tomato === 1, x);
x = await trade(sumi, { action: 'collect', id: t1 });
check('65: ...once', x.status === 409, x);
x = await trade(sumi, { action: 'offer', to: 'Nova', give: { sprinklers: { basic: 1 } }, want: { seeds: { tomato: 9 } } });
const t2 = x.trade && x.trade.id;
x = await trade(nova, { action: 'accept', id: t2 });
check('65: Nova can\'t accept what her backpack can\'t pay', x.status === 409, x);
x = await trade(nova, { action: 'decline', id: t2 });
const declined = x.ok && x.trade.status === 'declined';
x = await trade(sumi, { action: 'collect', id: t2 });
check('65: a declined offer goes back to Sumi once she collects', declined && x.ok && x.trade.give.sprinklers.basic === 1, x);
x = await trade(sumi, { action: 'offer', to: 'Nova', give: { seeds: { carrot: 1 } }, want: {} });
const t3 = x.trade && x.trade.id;
x = await trade(sumi, { action: 'cancel', id: t3 });
check('65: Sumi takes an offer back (collected at once)', x.ok && x.trade.status === 'cancelled' && x.trade.fromDone === true, x);
x = await trade(nova, { action: 'accept', id: t3 });
check('65: ...and then it can\'t be accepted', x.status === 409, x);
await rpc('fx_commit', { writes: [{ path: 'users/Nova', updatePaths: [[['hideGarden'], true]] }] });
x = await trade(sumi, { action: 'offer', to: 'Nova', give: { seeds: { carrot: 1 } }, want: {} });
check('80 (v4.70): nobody can offer a trade to someone whose garden is private', x.status === 403, x);
await rpc('fx_commit', { writes: [{ path: 'users/Nova', updatePaths: [[['hideGarden'], false]] }] });

const hookToken = crypto.randomBytes(32).toString('hex');
await put('servers/pcs01/webhooks/wh1', { name: 'Builds', channelId: 'general', avatarUrl: '', tokenHash: crypto.createHash('sha256').update(hookToken).digest('hex'), createdBy: 'Tester', createdAt: now() });
const hook = (tokenPart, body, method = 'POST') => fetch(`${API}/webhooks/pcs01/wh1/${tokenPart}`, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) })
  .then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
x = await hook(hookToken, { content: 'Build 42 passed', username: 'CI', avatar_url: 'https://example.com/ci.png' });
const hm = x.id && await doc(`servers/pcs01/channels/general/messages/${x.id}`);
check('50: a webhook posts in its channel, as itself', x.ok && hm && hm.uid === 'webhook:wh1' && hm.text === 'Build 42 passed' && hm.ext.src === 'webhook' && hm.ext.name === 'CI' && hm.ext.avatar === 'https://example.com/ci.png', { x, hm });
check('50: ...and the channel knows its newest message (unread dots)', (await doc('servers/pcs01/channels/general')).lastMessage.mid === x.id);
x = await hook(hookToken, { content: 'no name given' });
check('50: without a username it goes by the webhook\'s own name', x.ok && (await doc(`servers/pcs01/channels/general/messages/${x.id}`)).ext.name === 'Builds', x);
x = await hook('b'.repeat(64), { content: 'hi' });
check('50: a wrong token posts nothing', x.status === 404, x);
x = await hook(hookToken, { content: '   ' });
const blank = x.status;
x = await hook(hookToken, null, 'GET');
check('50: nothing to post, or not a POST: refused', blank === 400 && x.status === 405, { blank, x });

// ---------------- functions/api/push ----------------
section('Push notifications (functions/api/push)');
x = await call('push', 'info', null, 'GET');
check('info: ready, with Supabase as its database', x.ready === true && x.db === 'Supabase', x);
const pushed = [];
const pushService = http.createServer((req, res) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => { pushed.push({ url: req.url, headers: req.headers, bytes: Buffer.concat(c).length }); res.writeHead(201); res.end(); }); });
await new Promise(r => pushService.listen(8791, '127.0.0.1', r));
async function deviceOf(id, uid) {   // a browser's subscription: its public key and auth secret, at the fake push service
  const kp = await crypto.webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = Buffer.from(await crypto.webcrypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url');
  await put('pushSubs/' + id, { uid, endpoint: 'http://127.0.0.1:8791/push/' + id, p256dh, auth: crypto.randomBytes(16).toString('base64url'), muted: [], at: Date.now() });
}
await deviceOf('sub-sumi', 'Sumi');
await deviceOf('sub-air', 'Air');
await put('dms/Sumi_Tester/messages/pm1', { uid: 'Tester', username: 'Tester', text: 'push test', createdAt: now() });
x = await call('push', 'send', { kind: 'dm', id: 'Sumi_Tester', mid: 'pm1', uid: 'Tester' });
check('DM: Sumi\'s device gets one', x.status === 200 && pushed.filter(p => p.url === '/push/sub-sumi').length === 1 && !pushed.some(p => p.url === '/push/sub-air'), { x, pushed });
check('DM: encrypted and signed (aes128gcm, VAPID)', !!pushed[0] && pushed[0].headers['content-encoding'] === 'aes128gcm' && /^vapid t=/.test(pushed[0].headers.authorization || ''), pushed[0]);
x = await call('push', 'send', { kind: 'dm', id: 'Sumi_Tester', mid: 'pm1', uid: 'Tester' });
check('DM: a second request sends nothing (the claim counts 2)', x.skipped === 'taken' && pushed.length === 1, x);
await put('servers/pcs01/channels/general/messages/pm2', { uid: 'Tester', username: 'Tester', text: 'hey @Air look', createdAt: now() });
x = await call('push', 'send', { kind: 'ch', sid: 'pcs01', cid: 'general', mid: 'pm2', uid: 'Tester' });
check('channel mention: Air\'s device gets one, Sumi\'s doesn\'t', x.status === 200 && pushed.some(p => p.url === '/push/sub-air') && pushed.filter(p => p.url === '/push/sub-sumi').length === 1, { x, pushed });
await put('users/Air/meta/blocks', { list: ['Sumi', 'Tester'] });
await put('servers/pcs01/channels/general/messages/pm3', { uid: 'Sumi', username: 'Sumi', text: '@Air again', createdAt: now() });
const n0 = pushed.length;
x = await call('push', 'send', { kind: 'ch', sid: 'pcs01', cid: 'general', mid: 'pm3', uid: 'Sumi' });
check('a block counts: nothing to Air from Sumi, whom Air blocked', x.status === 200 && pushed.length === n0, { x, pushed: pushed.slice(n0) });
await put('servers/pcs01/channels/general/messages/pm4', { uid: 'Tester', username: 'Tester', text: '@Air from the Owner', createdAt: now() });
x = await call('push', 'send', { kind: 'ch', sid: 'pcs01', cid: 'general', mid: 'pm4', uid: 'Tester' });
check('...but not against someone ranked above (the Owner still reaches Air)', x.status === 200 && pushed.length === n0 + 1 && pushed[n0].url === '/push/sub-air', { x, pushed: pushed.slice(n0) });
pushService.close();

// ---------------- functions/api/discord ----------------
section('The Discord bridge (functions/api/discord)');
const say = body => fetch(DC + '/test/say', { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
const state = () => fetch(DC + '/test/state').then(r => r.json());
x = await call('discord', 'info', null, 'GET');
check('info: answers', x.status === 200, x);
await say({ author: OWNER, content: 'frixion-link-ABC123' });
x = await call('discord', 'verify', { sid: 'pcs01', cid: 'general', channel: CHANNEL.id, code: 'ABC123' });
check('verify: linked by the Discord server\'s owner', x.channel === CHANNEL.id && typeof x.sig === 'string', x);
// what the page saves next (script.js: the channel's discord field and the discordLinks entry)
await rpc('fx_commit', { writes: [
  { path: 'servers/pcs01/channels/general', updatePaths: [[['discord'], { channel: x.channel, name: x.name, guild: x.guild, since: x.since, sig: x.sig, by: 'Tester', at: Date.now() }]] },
  { path: 'discordLinks/pcs01__general', set: { sid: 'pcs01', cid: 'general', channel: x.channel, at: Date.now() } }] });
await put('servers/pcs01/channels/general/messages/br1', { uid: 'Tester', username: 'Tester', text: 'hello Discord', createdAt: now() });
x = await call('discord', 'send', { sid: 'pcs01', cid: 'general', mid: 'br1', uid: 'Tester' });
let st = await state();
check('send: posted in Discord as Tester', st.posts.some(p => p.content === 'hello Discord' && /Tester/.test(p.username || '')), { x, posts: st.posts });
const br1 = await doc('servers/pcs01/channels/general/messages/br1');
check('send: the message knows its Discord copy (claimed once)', !!br1 && /^\d+$/.test(br1.dc || '') && br1.dcClaim === 1, br1);
await rpc('fx_commit', { writes: [{ path: 'servers/pcs01/channels/general/messages/br1', updatePaths: [[['text'], 'hello Discord (edited)'], [['edited'], true]] }] });
x = await call('discord', 'sync', { sid: 'pcs01', cid: 'general', mid: 'br1', dc: br1.dc });
st = await state();
check('sync: the Discord copy was edited', st.hookEdits.some(e => e.method === 'PATCH' && /edited/.test(e.content || '')), { x, edits: st.hookEdits });
const d1 = await say({ content: 'hi from Discord' });
x = await call('discord', 'pull?sid=pcs01&cid=general', null, 'GET');
const imported = await doc(`servers/pcs01/channels/general/messages/dc_${d1.id}`);
check('pull: the Discord message is in the channel', !!imported && imported.text === 'hi from Discord', { x, imported });
const d2 = await say({ content: 'while nobody watches' });
x = await call('discord', 'tick');
const ticked = await doc(`servers/pcs01/channels/general/messages/dc_${d2.id}`);
check('tick: lists the links and brings it over', x.ok === true && x.links === 1 && !!ticked && ticked.text === 'while nobody watches', { x, ticked });
const ch = await doc('servers/pcs01/channels/general');
check('the channel keeps where the bridge got to (a dotted field)', !!ch.discord && /^\d+$/.test(ch.discord.last || ''), ch.discord);

process.exit(summary() ? 1 : 0);
