// Frixion Casino (v4.63). The Casino tab under Shop (index.html #casino-view). Every result comes from the server
// (functions/api/admin/casino): this page only asks for a game, then shows what came back. The odds and payout tables
// here are copies of the server's, for showing; the server's are the ones that count.
// Everything lives inside this function so nothing clashes with script.js; openCasino, casinoLeave and
// casinoProfileChanged are what script.js calls.
(function () {
'use strict';

const BET_MIN = 10, BET_MAX = 1e300, WIN_MAX = Infinity, DAY_GAMES = 200, RTP = 0.97;   // (no top limit since v4.67: the server decides the same)
const el = id => document.getElementById(id);
// No spinning or rolling for Epilepsy mode or the computer's reduce-motion setting. (Reduce screen shake doesn't stop
// these: nothing here shakes or moves the screen.)
const calm = () => (typeof epilepsyMode === 'function' && epilepsyMode()) || !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const fmt = n => (typeof fmtOrbs === 'function' ? fmtOrbs(n) : String(Math.floor(n || 0)));
// multipliers round down, the same way payouts do (1.2597x shows as 1.25x)
const fmtX = x => (x >= 1000 ? Math.floor(x).toLocaleString() : x >= 100 ? String(Math.floor(x)) : x >= 10 ? (Math.floor(x * 10 + 1e-9) / 10).toFixed(1) : (Math.floor(x * 100 + 1e-9) / 100).toFixed(2)) + 'x';
const e = s => (typeof esc === 'function' ? esc(String(s)) : String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// two frames from now (so a CSS transition starts from where things are), or 60 ms in a hidden tab, which draws none
const nextFrames = () => new Promise(r => { let done = false; const fin = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(() => requestAnimationFrame(fin)); setTimeout(fin, 60); });
const store = {
  get(k, d) { try { const v = localStorage.getItem('frx_cz_' + k); return v == null ? d : JSON.parse(v); } catch (x) { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem('frx_cz_' + k); else localStorage.setItem('frx_cz_' + k, JSON.stringify(v)); } catch (x) {} },
};
const utcDay = () => new Date().toISOString().slice(0, 10);

let view = 'lobby';     // the lobby, or the id of the game on screen
let live = 0;           // goes up whenever the page changes, so animations from before stop
const recent = {};      // game id -> last results, newest first
const casinoRec = () => (typeof myProfile !== 'undefined' && myProfile && myProfile.casino && typeof myProfile.casino === 'object' ? myProfile.casino : {});
const gamesLeft = () => { const c = casinoRec(); return DAY_GAMES - (c.day === utcDay() ? Math.max(0, Number(c.n) || 0) : 0); };
const infinite = () => typeof myProfile !== 'undefined' && !!myProfile && (myProfile.infOrbs === true || myProfile.orbs === Infinity);   // infinite Orbs (v4.64; the infinity sign too, v4.66)
const balance = () => (infinite() ? Infinity : typeof myProfile !== 'undefined' && myProfile ? Math.floor(myProfile.orbs || 0) : 0);

// ---------- talking to the server ----------
async function call(game, action, body) {
  try {
    const j = await orbsCall('casino', Object.assign({ game, action }, body || {}));
    if (j.orbs != null && typeof myProfile !== 'undefined' && myProfile) myProfile.orbs = j.orbs;
    if (j.fair && game !== 'fair') rememberBet(game, body, j);
    if (body && Number(body.bet) >= 1e6 && typeof eggFind === 'function') eggFind('bigbet');   // (an easter egg: a million on one game)
    showTop();
    return j;
  } catch (x) {
    toast(x.message || 'Something went wrong.', 'error');
    throw x;
  }
}

// ---------- Provably Fair (v4.67) ----------
// casino-fair.js (the file the server plays every bet with) checks them here. Each finished bet is kept on this device
// with the seeds it used (its server seed's fingerprint, your client seed and its nonce); once you change seeds, the
// server shows the old server seed, and every bet made with it can be worked out again and compared.
const FAIR_KEEP = 60, EDGE = { roulette: '2.7%', blackjack: 'about 1% if you play well' };
const fairKey = () => 'fair_bets_' + (typeof myUid !== 'undefined' && myUid ? myUid : '');
let fairJs = null;
const fairLib = () => (fairJs = fairJs || import('./casino-fair.js?v=1').catch(x => { fairJs = null; throw x; }));
function rememberBet(game, body, j) {
  const done = j.over === true || j.won !== undefined || (j.stake !== undefined && !j.ticket && game !== 'crash' && game !== 'mega');
  if (!done) return;
  const b = Object.assign({}, body || {});
  delete b.ticket;
  const res = {};
  ['result', 'roll', 'house', 'reels', 'path', 'drawn', 'item', 'mines', 'rows', 'hit', 'cards', 'p', 'd', 'point', 'won', 'payout', 'stake'].forEach(k => { if (j[k] !== undefined) res[k] = j[k]; });
  const list = store.get(fairKey(), []);
  list.unshift({ at: Date.now(), game, body: b, res, fair: j.fair });
  store.set(fairKey(), list.slice(0, FAIR_KEEP));
}
// a server seed you've seen (after changing seeds), or the server's answer for an earlier one
async function seedFor(f) {
  const seeds = store.get('fair_seeds', {});
  if (seeds[f.hash]) return seeds[f.hash];
  try {
    const r = await orbsCall('casino', { game: 'fair', action: 'reveal', e: f.e });
    if (r && r.seed) { seeds[r.hash] = r.seed; store.set('fair_seeds', seeds); return r.hash === f.hash ? r.seed : null; }
  } catch (x) {}
  return null;
}
// Works a bet out again from its seeds and compares it with what came back: { ok: true / false / null, text }
async function checkBet(bet) {
  const F = await fairLib(), f = bet.fair, seed = await seedFor(f);
  if (!seed) return { ok: null, text: 'Its server seed is still in use. Change seeds, then check it.' };
  if (await F.sha256Hex(seed) !== f.hash) return { ok: false, text: 'The server seed doesn\'t have the fingerprint you were shown.' };
  const r = await F.fairStream(seed, f.c, f.n), x = bet.res, b = bet.body || {}, same = (a, c) => JSON.stringify(a) === JSON.stringify(c);
  const sorted = a => (a || []).slice().sort((p, q) => p - q);
  let want, got;
  switch (bet.game) {
    case 'dice': want = F.DRAW.dice(r) / 100; got = x.roll; break;
    case 'limbo': want = F.DRAW.limbo(r); got = x.result; break;
    case 'coinflip': want = F.DRAW.coinflip(r); got = x.result; break;
    case 'rps': want = F.DRAW.rps(r); got = x.house; break;
    case 'roulette': want = F.DRAW.roulette(r); got = x.result; break;
    case 'slots': want = F.DRAW.slots(r); got = x.reels; break;
    case 'plinko': want = F.DRAW.plinko(r, { rows: Number(b.rows) }); got = x.path; break;
    case 'keno': want = F.DRAW.keno(r); got = x.drawn; break;
    case 'cases': want = F.DRAW.cases(r, CASES[b.box] || { items: [[0, 1]] }); got = x.item; break;
    case 'upgrader': want = F.DRAW.upgrader(r); got = x.roll; break;
    case 'mines': want = sorted(F.DRAW.mines(r, { m: (x.mines || []).length })); got = sorted(x.mines); break;
    case 'towers': { const [cols, bad] = TOWER[(x.p || {}).l] || [3, 1]; want = F.DRAW.towers(r, { rows: TOWER_ROWS, cols, bad }).map(sorted); got = (x.rows || []).map(sorted); break; }
    case 'cross': {   // (the lane that got you among those you crossed, as the server worked it out; none if you cashed out)
      const [p, lanes] = CROSS[(x.p || {}).l] || [0.8, 20], first = F.DRAW.cross(r, { p, lanes }).slice(0, Number(b.path) || 0).indexOf(true);
      want = first < 0 ? null : first; got = x.hit == null ? null : x.hit; break;
    }
    case 'hilo': {
      const moves = String(b.path || ''); let key = ''; want = [await F.hiloCard(seed, f.c, f.n, '')];
      for (const mv of moves.slice(0, (x.cards || []).length - 1)) { key += mv === 's' ? 's' : 'g'; want.push(await F.hiloCard(seed, f.c, f.n, key)); }
      got = (x.cards || []).map(c => ({ r: c.r, s: c.s })); break;
    }
    case 'blackjack': {
      const shoe = F.DRAW.blackjack(r), p = x.p || [], d = x.d || [];
      const extra = shoe.slice(4, 4 + Math.max(0, p.length - 2)), dealer = shoe.slice(4 + extra.length, 4 + extra.length + Math.max(0, d.length - 2));
      want = { p: [shoe[0], shoe[2], ...extra], d: [shoe[1], shoe[3], ...dealer] }; got = { p, d }; break;
    }
    case 'crash': want = F.DRAW.crash(r); got = x.point; break;
    case 'mega': want = F.DRAW.mega(r, { chance: 0.01 }); got = x.won; break;
    default: return { ok: null, text: 'This game can\'t be checked here.' };
  }
  const ok = same(want, got);
  if (ok && typeof eggFind === 'function') eggFind('seedcheck');   // (an easter egg)
  return { ok, text: ok ? 'It matches: this result came from those seeds.' : 'It doesn\'t match.' };
}

// ---------- the games ----------
const GAMES = [
  { id: 'crash', name: 'Crash', group: 'Climb', blurb: 'The number climbs. Cash out before it crashes.' },
  { id: 'mines', name: 'Mines', group: 'Climb', blurb: 'Find gems, skip the mines, stop when you like.' },
  { id: 'towers', name: 'Towers', group: 'Climb', blurb: 'Pick a safe tile on each floor to go up.' },
  { id: 'cross', name: 'Crossing', group: 'Climb', blurb: 'Cross one lane at a time. Each lane pays more.' },
  { id: 'hilo', name: 'Hi-Lo', group: 'Cards', blurb: 'Higher or lower than this card?' },
  { id: 'blackjack', name: 'Blackjack', group: 'Cards', blurb: 'Get closer to 21 than the dealer.' },
  { id: 'roulette', name: 'Roulette', group: 'Cards', blurb: 'One zero, 37 pockets, bet on anything.' },
  { id: 'dice', name: 'Dice', group: 'Quick', blurb: 'Roll over or under your line.' },
  { id: 'limbo', name: 'Limbo', group: 'Quick', blurb: 'Pick a target. Hit it or go over.' },
  { id: 'coinflip', name: 'Coinflip', group: 'Quick', blurb: 'Heads or tails against the house.' },
  { id: 'rps', name: 'Rock Paper Scissors', group: 'Quick', blurb: 'Beat the house. A tie gives your bet back.' },
  { id: 'upgrader', name: 'Upgrader', group: 'Quick', blurb: 'Aim high. The higher, the smaller the chance.' },
  { id: 'plinko', name: 'Plinko', group: 'Luck', blurb: 'Drop a ball through the pegs.' },
  { id: 'slots', name: 'Slots', group: 'Luck', blurb: 'Three reels. Line up three of a kind.' },
  { id: 'keno', name: 'Keno', group: 'Luck', blurb: 'Pick up to 10 numbers. 10 get drawn.' },
  { id: 'cases', name: 'Cases', group: 'Luck', blurb: 'Open a case of Orbs.' },
  { id: 'mega', name: 'Mega Ticket', group: 'Luck', blurb: 'One ticket, drawn a day later. 1 in 100 wins big.' },
];
const GAME_BY_ID = Object.fromEntries(GAMES.map(g => [g.id, g]));
const GROUPS = [['Climb', 'Cash out before it goes wrong'], ['Cards', 'Table games'], ['Quick', 'One click, one result'], ['Luck', 'Pure luck']];
const ICONS = {
  crash: '<path d="M4 20 C9 19 13 15 16 6" /><path d="M13 6h3v3" /><path d="M4 20h16" />',
  mines: '<circle cx="12" cy="13" r="6"/><path d="M12 7V4M16.5 8.5l2-2M18 13h3"/><circle cx="10" cy="11" r="1.3" fill="currentColor"/>',
  towers: '<rect x="4" y="15" width="16" height="5" rx="1"/><rect x="6" y="9.5" width="12" height="5" rx="1"/><rect x="8" y="4" width="8" height="5" rx="1"/>',
  cross: '<path d="M3 6h18M3 12h18M3 18h18" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  hilo: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M12 8l-3 3h6zM12 16l-3-3h6z" fill="currentColor"/>',
  blackjack: '<rect x="3" y="5" width="11" height="15" rx="2"/><rect x="10" y="3" width="11" height="15" rx="2"/><path d="M15.5 8.5v5M13 11h5"/>',
  roulette: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="15" cy="15" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  limbo: '<path d="M4 18h16"/><path d="M7 18V9M12 18V5M17 18v-6"/>',
  coinflip: '<ellipse cx="12" cy="12" rx="8" ry="8.5"/><ellipse cx="12" cy="12" rx="4.5" ry="5"/>',
  rps: '<circle cx="7" cy="15" r="3.5"/><rect x="12" y="4" width="8" height="10" rx="1"/><path d="M5 4l5 6M10 4L5 10"/>',
  upgrader: '<path d="M5 16a8 8 0 1 1 14 0"/><path d="M12 13l4-5"/><circle cx="12" cy="13" r="1.4" fill="currentColor"/>',
  plinko: '<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/><circle cx="6" cy="15" r="1.2" fill="currentColor"/><circle cx="12" cy="15" r="1.2" fill="currentColor"/><circle cx="18" cy="15" r="1.2" fill="currentColor"/><path d="M4 20h16"/>',
  slots: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14M15 5v14"/><path d="M5.5 12h1.5M11.3 12h1.5M17 12h1.5"/>',
  keno: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
  cases: '<rect x="3.5" y="8" width="17" height="11" rx="1.5"/><path d="M3.5 12h17M10 12v2.5h4V12"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  mega: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/>',
};
const icon = (id, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[id] || ''}</svg>`;

// ---------- the page ----------
function shell() {
  const r = el('casino-root');
  if (!r || r.dataset.ready) return r;
  r.dataset.ready = '1';
  r.innerHTML = `<div class="cz">
    <div class="cz-bar">
      <span class="cz-bal" title="Your Orbs"><svg viewBox="0 0 24 24" width="15" height="15"><circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="9" cy="9" r="2.6" fill="#fff" opacity=".55"/></svg><span id="cz-bal">0</span></span>
      <span class="cz-left" id="cz-left"></span>
      <button type="button" class="cz-link" id="cz-how">How it works</button>
      <button type="button" class="cz-link cz-fair-link" id="cz-fair-btn"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>Provably Fair</button>
      <button type="button" class="cz-link" id="cz-ref-btn">Referrals</button>
    </div>
    <div class="cz-how hidden" id="cz-how-box">
      <p>Every result is picked by Frixion's server from seeds you can check afterwards (Provably Fair), the same way for everyone. Nobody can change the odds, not even staff.</p>
      <p>The house has a small edge: most games pay back 97% of what's bet over time, a 3% house edge (Roulette 97.3%, Blackjack about 99% if you play well). Over a lot of games you'll lose a bit more than you win, so only bet what you're fine losing.</p>
      <p>Bets start at 10 Orbs and go as high as the Orbs you have, wins are as big as they come, and you can play 200 games a day. Casino wins don't count toward the 20,000 Orbs a day from other games. High rollers get noticed.</p>
      <p class="cz-egg">There are a few easter eggs in here too.</p>
    </div>
    <div class="cz-panel hidden" id="cz-fair-box"></div>
    <div class="cz-panel hidden" id="cz-ref-box"></div>
    <div id="cz-open-note"></div>
    <div id="cz-page"></div>
  </div>`;
  el('cz-how').onclick = () => el('cz-how-box').classList.toggle('hidden');
  el('cz-fair-btn').onclick = () => toggleFair();
  el('cz-ref-btn').onclick = () => toggleRef();
  return r;
}
// ----- the Provably Fair panel: your seeds, changing them, and checking the bets kept on this device -----
function toggleFair(open) {
  const box = el('cz-fair-box');
  if (!box) return;
  const show = open === true || box.classList.contains('hidden');
  box.classList.toggle('hidden', !show);
  if (show) { el('cz-ref-box').classList.add('hidden'); renderFair(); box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}
async function renderFair(old) {
  const box = el('cz-fair-box');
  if (!box) return;
  let info = null;
  try { info = await orbsCall('casino', { game: 'fair', action: 'info' }); } catch (x) {}
  const bets = store.get(fairKey(), []);
  const what = bt => {
    const x = bt.res || {}, g = GAME_BY_ID[bt.game];
    const res = x.roll !== undefined ? `rolled ${x.roll}` : x.point !== undefined ? `crashed at ${x.point}x` : x.won !== undefined ? (x.won ? 'won' : 'not a winner')
      : x.result !== undefined ? `result ${x.result}` : x.house !== undefined ? `the house picked ${x.house}` : '';
    return `${e(g ? g.name : bt.game)} <span class="cz-fair-n">#${bt.fair.n}</span>${res ? ` <span class="cz-fair-res">${e(res)}</span>` : ''}`;
  };
  box.innerHTML = `<div class="cz-panel-head"><b>Provably Fair</b><button type="button" class="cz-link" id="cz-fair-close">Close</button></div>
    <p class="cz-panel-text">Every result comes from three things: a server seed (kept hidden, but you see its fingerprint before you bet), your client seed, and the bet's number on that seed (its nonce). Change seeds and the server shows you the old server seed, so you can work out any bet made with it again and see that it matches. Checking is free, and sometimes worth it.</p>
    ${info ? `<div class="cz-fair-grid">
      <div><span class="cz-fair-lbl">Server seed fingerprint</span><code class="cz-fair-code">${e(info.hash)}</code></div>
      <div><span class="cz-fair-lbl">Your client seed</span><code class="cz-fair-code">${e(info.c)}</code></div>
      <div><span class="cz-fair-lbl">Bets on these seeds</span><code class="cz-fair-code">${e(String(info.n))}</code></div>
    </div>
    <div class="cz-fair-change"><input type="text" id="cz-fair-client" maxlength="32" placeholder="New client seed (empty: a random one)" autocomplete="off"><button type="button" class="cz-btn" id="cz-fair-rotate">Change seeds</button></div>` : '<p class="cz-panel-text">Could not load your seeds.</p>'}
    ${old ? `<div class="cz-fair-old">Your old server seed (fingerprint ${e(old.hash.slice(0, 16))}...): <code class="cz-fair-code">${e(old.seed)}</code> It was used for ${old.n} bet${old.n === 1 ? '' : 's'}, which you can check below.</div>` : ''}
    <div class="cz-panel-sub">Your recent bets on this device</div>
    <div class="cz-fair-bets">${bets.length ? bets.map((bt, i) => `<div class="cz-fair-row"><span>${what(bt)}</span><button type="button" class="cz-link" data-fair-check="${i}">Check</button><span class="cz-fair-out" id="cz-fair-out-${i}"></span></div>`).join('') : '<span class="cz-panel-text">No bets yet.</span>'}</div>`;
  el('cz-fair-close').onclick = () => toggleFair();
  if (el('cz-fair-rotate')) el('cz-fair-rotate').onclick = async () => {
    const client = el('cz-fair-client').value.trim();
    try {
      const r = await orbsCall('casino', Object.assign({ game: 'fair', action: 'rotate' }, client ? { client } : {}));
      const seeds = store.get('fair_seeds', {}); seeds[r.old.hash] = r.old.seed; store.set('fair_seeds', seeds);
      renderFair(r.old);
    } catch (x) { toast(x.message || 'Could not change seeds.', 'error'); }
  };
  box.querySelectorAll('[data-fair-check]').forEach(btn => {
    btn.onclick = async () => {
      const i = Number(btn.dataset.fairCheck), out = el('cz-fair-out-' + i);
      out.textContent = 'Checking...'; out.className = 'cz-fair-out';
      try { const r = await checkBet(bets[i]); out.textContent = r.text; out.className = 'cz-fair-out ' + (r.ok === true ? 'good' : r.ok === false ? 'bad' : ''); }
      catch (x) { out.textContent = 'Could not check it.'; }
    };
  });
}
// ----- Referrals (v4.67): your code and link, who joined with it and what it's earned; or joining with a friend's -----
function toggleRef() {
  const box = el('cz-ref-box');
  if (!box) return;
  const show = box.classList.contains('hidden');
  box.classList.toggle('hidden', !show);
  if (show) { el('cz-fair-box').classList.add('hidden'); renderRef(); }
}
async function renderRef() {
  const box = el('cz-ref-box');
  if (!box) return;
  let r = null;
  try { r = await orbsCall('referral', { action: 'info' }); } catch (x) {}
  const link = r && r.code ? `${location.origin}/?ref=${r.code}` : '';
  box.innerHTML = `<div class="cz-panel-head"><b>Earn from every bet your friends make</b><button type="button" class="cz-link" id="cz-ref-close">Close</button></div>
    <div class="cz-ref-stats"><div><b>10%</b><span>of the house edge on every bet they place</span></div><div><b>5%</b><span>of every winning bet they make</span></div><div><b>10,000 Orbs</b><span>for every friend who joins, once they've bet 10,000</span></div></div>
    ${!r ? '<p class="cz-panel-text">Could not load your referrals.</p>' : r.code
      ? `<div class="cz-ref-code">Your code <code class="cz-fair-code">${e(r.code)}</code> <input type="text" readonly value="${e(link)}" class="cz-ref-link" id="cz-ref-link"><button type="button" class="cz-btn" id="cz-ref-copy">Copy link</button></div>
         <p class="cz-panel-text">${r.friends} friend${r.friends === 1 ? '' : 's'} joined with it, and it's earned you ${fmt(r.earned)} Orbs.</p>`
      : `<div class="cz-fair-change"><input type="text" id="cz-ref-new" maxlength="16" placeholder="Make your code (3 to 16 letters and digits)" autocomplete="off"><button type="button" class="cz-btn" id="cz-ref-make">Make code</button></div>`}
    ${r && r.canJoin ? `<div class="cz-fair-change"><input type="text" id="cz-ref-join" maxlength="16" placeholder="Joined because of a friend? Their code" autocomplete="off"><button type="button" class="cz-btn" id="cz-ref-join-btn">Use code</button></div>` : ''}
    ${r && r.referredBy ? `<p class="cz-panel-text">You joined with ${e(r.referredBy)}'s code.</p>` : ''}
    <p class="cz-panel-text cz-fine">New accounts can use a code on their first day, before their first Casino game. Accounts on the same device or network as the code's owner can't, so no farming with alts. Nothing is paid from infinite Orbs.</p>`;
  el('cz-ref-close').onclick = () => toggleRef();
  if (el('cz-ref-copy')) el('cz-ref-copy').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Link copied.'); } catch (x) { el('cz-ref-link').select(); } };
  if (el('cz-ref-make')) el('cz-ref-make').onclick = async () => {
    try { const x = await orbsCall('referral', { action: 'make', code: el('cz-ref-new').value.trim() }); toast(`Your code is ${x.code}.`); renderRef(); }
    catch (x) { toast(x.message || 'Could not make that code.', 'error'); }
  };
  if (el('cz-ref-join-btn')) el('cz-ref-join-btn').onclick = async () => {
    try { const x = await orbsCall('referral', { action: 'join', code: el('cz-ref-join').value.trim() }); toast(`You joined with ${x.referredBy}'s code.`); renderRef(); }
    catch (x) { toast(x.message || 'That code didn\'t work.', 'error'); }
  };
}
function showTop() {
  if (!el('cz-bal')) return;
  el('cz-bal').textContent = infinite() ? 'Inf' : fmt(balance());
  const n = gamesLeft();
  el('cz-left').textContent = n > 0 ? `${n} game${n === 1 ? '' : 's'} left today` : 'No games left today. More after midnight UTC.';
  showOpenNote();
}
// a game left going (another tab, or a reload): a way back to it
function showOpenNote() {
  const box = el('cz-open-note');
  if (!box) return;
  const o = casinoRec().open, g = o && GAME_BY_ID[o.g];
  if (!g || view === o.g || (o.g === 'crash')) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="cz-note">You have a ${e(g.name)} game going (${fmt(o.b)} Orbs bet). <button type="button" class="cz-link" id="cz-open-go">Go back to it</button></div>`;
  el('cz-open-go').onclick = () => openGame(o.g);
}
function lobby() {
  view = 'lobby'; live++;
  const page = el('cz-page');
  if (!page) return;
  const mega = casinoRec().mega;
  page.innerHTML = GROUPS.map(([grp, sub]) => `<section class="cz-group"><div class="cz-group-head"><h3>${grp}</h3><span>${sub}</span></div><div class="cz-tiles">
    ${GAMES.filter(g => g.group === grp).map(g => `<button type="button" class="cz-tile cz-t-${g.id}" data-cz-game="${g.id}">
      <span class="cz-tile-ico">${icon(g.id, 26)}</span><span class="cz-tile-name">${e(g.name)}</span><span class="cz-tile-blurb">${e(g.blurb)}</span>
      ${g.id === 'mega' && mega ? `<span class="cz-tile-tag">${Date.now() >= mega.at + 86400000 ? 'Ready to draw' : 'Ticket bought'}</span>` : ''}
    </button>`).join('')}</div></section>`).join('');
  page.querySelectorAll('[data-cz-game]').forEach(b => { b.onclick = () => openGame(b.dataset.czGame); });
  showTop();
}
// the frame every game sits in: settings on one side, the game on the other, recent results under it
function frame(id, sideHTML, stageHTML) {
  view = id; live++;
  const g = GAME_BY_ID[id], page = el('cz-page');
  page.innerHTML = `<div class="cz-game cz-g-${id}">
    <div class="cz-game-head"><button type="button" class="cz-back" id="cz-back"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>All games</button>
      <h2>${e(g.name)}</h2><span class="cz-game-blurb">${e(g.blurb)}</span>
      <span class="cz-edge">House edge ${EDGE[id] || '3%'}<button type="button" class="cz-link cz-fair-link" data-cz-fair>Provably Fair</button></span></div>
    <div class="cz-game-main"><div class="cz-side">${sideHTML}<div class="cz-result" id="cz-result"></div></div><div class="cz-stage" id="cz-stage">${stageHTML}</div></div>
    <div class="cz-recent" id="cz-recent"></div>
  </div>`;
  el('cz-back').onclick = () => { if (busyNow) { toast('Wait for this round to finish.'); return; } lobby(); };
  page.querySelectorAll('[data-cz-fair]').forEach(b => { b.onclick = () => toggleFair(true); });
  showRecent(id);
  showTop();
  return live;
}
let busyNow = false;
// the bet box: last bet remembered per game; half, double and max
function betHTML(id, label) {
  const last = Math.min(BET_MAX, Math.max(BET_MIN, Number(store.get('bet_' + id, 100)) || 100));
  return `<label class="cz-lbl" for="cz-bet">${label || 'Bet'}</label><div class="cz-bet"><input type="number" id="cz-bet" min="${BET_MIN}" max="${BET_MAX}" step="1" value="${last}" inputmode="numeric">
    <button type="button" data-cz-bet="half" title="Half">1/2</button><button type="button" data-cz-bet="double" title="Double">2x</button><button type="button" data-cz-bet="max" title="As much as you can">Max</button></div>`;
}
function wireBet(id, onChange) {
  const box = el('cz-bet');
  if (!box) return;
  document.querySelectorAll('[data-cz-bet]').forEach(b => {
    b.onclick = () => {
      const v = Math.floor(Number(box.value) || BET_MIN);
      box.value = b.dataset.czBet === 'half' ? Math.max(BET_MIN, Math.floor(v / 2)) : b.dataset.czBet === 'double' ? Math.min(BET_MAX, v * 2) : Math.max(BET_MIN, Math.min(BET_MAX, balance()));
      store.set('bet_' + id, Number(box.value));
      if (onChange) onChange();
    };
  });
  box.oninput = () => { if (onChange) onChange(); };
  box.onchange = () => { store.set('bet_' + id, Math.floor(Number(box.value) || 0)); if (onChange) onChange(); };
}
// the bet as a whole number of Orbs, or null (and a note) when it can't be bet
function readBet(id, need) {
  const box = el('cz-bet'), v = Number(box && box.value);
  if (!Number.isInteger(v) || v < BET_MIN || v > BET_MAX) { toast('Bets start at 10 Orbs.', 'error'); return null; }
  if ((need || v) > balance()) { toast('You don\'t have enough Orbs for that.', 'error'); return null; }
  if (gamesLeft() <= 0) { toast('That\'s all 200 casino games for today. More after midnight UTC.', 'error'); return null; }
  store.set('bet_' + id, v);
  return v;
}
function result(stake, payout, extra) {
  const box = el('cz-result');
  if (!box) return;
  const won = payout > stake, push = payout === stake && payout > 0;
  if (stake > 0 && payout >= stake * 10) egg('tenx');   // (an easter egg)
  box.className = 'cz-result ' + (won ? 'win' : push ? 'push' : 'lose');
  box.innerHTML = won ? `<b>Won ${fmt(payout)} Orbs</b><span>${fmtX(payout / stake)}${extra ? ' &middot; ' + extra : ''}</span>`
    : push ? `<b>Got your ${fmt(payout)} Orbs back</b>${extra ? `<span>${extra}</span>` : ''}`
    : payout > 0 ? `<b>Got ${fmt(payout)} of ${fmt(stake)} back</b><span>${fmtX(payout / stake)}${extra ? ' &middot; ' + extra : ''}</span>`
    : `<b>Lost ${fmt(stake)} Orbs</b>${extra ? `<span>${extra}</span>` : ''}`;
}
function clearResult() { const box = el('cz-result'); if (box) { box.className = 'cz-result'; box.innerHTML = ''; } }
function addRecent(id, label, good) {
  (recent[id] = recent[id] || []).unshift({ label, good });
  recent[id].length = Math.min(recent[id].length, 14);
  showRecent(id);
}
function showRecent(id) {
  const box = el('cz-recent');
  if (!box) return;
  const list = recent[id] || [];
  box.innerHTML = list.length ? `<span class="cz-recent-lbl">Recent</span>${list.map(x => `<span class="cz-chip ${x.good ? 'good' : ''}">${e(x.label)}</span>`).join('')}` : '';
}
const setBusy = (on, ids) => {
  busyNow = !!on;
  (ids || []).forEach(id => { const b = el(id); if (b) b.disabled = !!on; });
};

// ---------- one-click games ----------
// a number that runs from `from` to `to` (or just shows `to` when motion is off)
function runNumber(node, from, to, ms, fmtFn, still) {
  return new Promise(res => {
    if (!node) return res();
    if (calm() || ms <= 0 || document.hidden) { node.textContent = fmtFn(to); return res(); }
    const t0 = performance.now(), mine = live;
    // (a hidden tab draws no frames, so this also finishes on a timer)
    const stop = setTimeout(() => { node.textContent = fmtFn(to); res(); }, ms + 400);
    const step = t => {
      if (mine !== live) { clearTimeout(stop); return res(); }
      const k = Math.min(1, (t - t0) / ms), v = from + (to - from) * (1 - Math.pow(1 - k, 3));
      node.textContent = fmtFn(k >= 1 ? to : v);
      if (k < 1) requestAnimationFrame(step); else { clearTimeout(stop); res(); }
    };
    requestAnimationFrame(step);
  });
}
function seg(id, opts, value) {
  return `<div class="cz-seg" id="${id}">${opts.map(([v, label]) => `<button type="button" data-v="${e(v)}" class="${String(v) === String(value) ? 'on' : ''}">${e(label)}</button>`).join('')}</div>`;
}
function wireSeg(id, onPick) {
  const box = el(id);
  box.querySelectorAll('button').forEach(b => { b.onclick = () => { if (busyNow) return; box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); onPick(b.dataset.v); }; });
}
const segValue = id => { const b = el(id) && el(id).querySelector('button.on'); return b ? b.dataset.v : null; };

// Dice: a roll from 0.00 to 99.99, under or over your line
function dice() {
  const st = store.get('dice', { t: 50, over: false });
  frame('dice', `${betHTML('dice')}
    <label class="cz-lbl">You win if the roll is</label>${seg('cz-dice-dir', [['0', 'Under'], ['1', 'Over']], st.over ? '1' : '0')}
    <label class="cz-lbl" for="cz-dice-t">Line</label><input type="number" class="cz-num" id="cz-dice-t" step="0.01" value="${st.t}">
    <div class="cz-stats"><span>Win chance<b id="cz-dice-ch"></b></span><span>Pays<b id="cz-dice-x"></b></span><span>Win<b id="cz-dice-win"></b></span></div>
    <button type="button" class="cz-go" id="cz-go">Roll</button>`,
  `<div class="cz-dice"><div class="cz-dice-num" id="cz-dice-num">--</div>
    <div class="cz-dice-track"><div class="cz-dice-zone" id="cz-dice-zone"></div><div class="cz-dice-mark hidden" id="cz-dice-mark"></div></div>
    <input type="range" class="cz-dice-range" id="cz-dice-range" min="1" max="99" step="1" value="${Math.round(st.t)}" aria-label="Line">
    <div class="cz-dice-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div></div>`);
  const over = () => segValue('cz-dice-dir') === '1';
  const clampT = t => (over() ? Math.min(99, Math.max(5, t)) : Math.min(95, Math.max(1, t)));
  const update = () => {
    let t = Math.round(Number(el('cz-dice-t').value) * 100) / 100;
    if (!Number.isFinite(t)) t = 50;
    const chance = over() ? 100 - clampT(t) : clampT(t), x = Math.floor(RTP * 100 / chance * 10000) / 10000;
    el('cz-dice-ch').textContent = chance.toFixed(2) + '%';
    el('cz-dice-x').textContent = x.toFixed(4) + 'x';
    el('cz-dice-win').textContent = fmt(Math.min(WIN_MAX, Math.floor((Number(el('cz-bet').value) || 0) * x)));
    const zone = el('cz-dice-zone'), at = clampT(t);
    zone.style.left = over() ? at + '%' : '0';
    zone.style.width = (over() ? 100 - at : at) + '%';
    store.set('dice', { t: at, over: over() });
  };
  wireBet('dice', update);
  wireSeg('cz-dice-dir', () => { el('cz-dice-t').value = clampT(Number(el('cz-dice-t').value)); update(); });
  el('cz-dice-t').oninput = update;
  el('cz-dice-t').onchange = () => { el('cz-dice-t').value = clampT(Math.round(Number(el('cz-dice-t').value) * 100) / 100 || 50); el('cz-dice-range').value = Math.round(Number(el('cz-dice-t').value)); update(); };
  el('cz-dice-range').oninput = () => { el('cz-dice-t').value = clampT(Number(el('cz-dice-range').value)); update(); };
  update();
  el('cz-go').onclick = async () => {
    const bet = readBet('dice');
    if (bet == null || busyNow) return;
    const t = clampT(Math.round(Number(el('cz-dice-t').value) * 100) / 100), mine = live;
    setBusy(true, ['cz-go']); clearResult();
    try {
      const j = await call('dice', 'play', { bet, target: t, over: over() });
      if (mine !== live) return;
      const mark = el('cz-dice-mark');
      mark.classList.remove('hidden', 'win', 'lose');
      mark.style.transition = calm() ? 'none' : '';
      mark.style.left = j.roll + '%';
      await runNumber(el('cz-dice-num'), 0, j.roll, 550, v => v.toFixed(2));
      if (mine !== live) return;
      const won = j.payout > 0;
      mark.classList.add(won ? 'win' : 'lose');
      el('cz-dice-num').className = 'cz-dice-num ' + (won ? 'win' : 'lose');
      result(j.stake, j.payout, 'rolled ' + j.roll.toFixed(2));
      addRecent('dice', j.roll.toFixed(2), won);
    } catch (x) {} finally { if (mine === live) setBusy(false, ['cz-go']); }
  };
}

// Limbo: a number from 1.00x up (at most 1000x); win if it reaches your target
function limbo() {
  const t0 = store.get('limbo', 2);
  frame('limbo', `${betHTML('limbo')}
    <label class="cz-lbl" for="cz-limbo-t">Target</label><input type="number" class="cz-num" id="cz-limbo-t" min="1.01" max="1000" step="0.01" value="${t0}">
    <div class="cz-stats"><span>Win chance<b id="cz-limbo-ch"></b></span><span>Win<b id="cz-limbo-win"></b></span></div>
    <button type="button" class="cz-go" id="cz-go">Play</button>`,
  `<div class="cz-limbo"><div class="cz-limbo-num" id="cz-limbo-num">1.00x</div><div class="cz-limbo-target" id="cz-limbo-tg"></div></div>`);
  const target = () => Math.min(1000, Math.max(1.01, Math.round(Number(el('cz-limbo-t').value) * 100) / 100 || 2));
  const update = () => {
    const t = target();
    el('cz-limbo-ch').textContent = (RTP / t * 100).toFixed(t > 97 ? 4 : 2) + '%';
    el('cz-limbo-win').textContent = fmt(Math.min(WIN_MAX, Math.floor((Number(el('cz-bet').value) || 0) * t)));
    el('cz-limbo-tg').textContent = 'Target ' + fmtX(t);
    store.set('limbo', t);
  };
  wireBet('limbo', update);
  el('cz-limbo-t').oninput = update;
  el('cz-limbo-t').onchange = () => { el('cz-limbo-t').value = target(); update(); };
  update();
  el('cz-go').onclick = async () => {
    const bet = readBet('limbo');
    if (bet == null || busyNow) return;
    const t = target(), mine = live, num = el('cz-limbo-num');
    setBusy(true, ['cz-go']); clearResult(); num.className = 'cz-limbo-num';
    try {
      const j = await call('limbo', 'play', { bet, target: t });
      if (mine !== live) return;
      await runNumber(num, 1, j.result, Math.min(900, 300 + Math.log(j.result) * 120), v => v.toFixed(2) + 'x');
      if (mine !== live) return;
      const won = j.payout > 0;
      num.className = 'cz-limbo-num ' + (won ? 'win' : 'lose');
      result(j.stake, j.payout);
      addRecent('limbo', fmtX(j.result), won);
    } catch (x) {} finally { if (mine === live) setBusy(false, ['cz-go']); }
  };
}

// Coinflip: 1.94x on the side you pick
function coinflip() {
  frame('coinflip', `${betHTML('coinflip')}
    <label class="cz-lbl">Your side</label>${seg('cz-coin-side', [['h', 'Heads'], ['t', 'Tails']], store.get('coin', 'h'))}
    <div class="cz-stats"><span>Win chance<b>50%</b></span><span>Pays<b>1.94x</b></span></div>
    <button type="button" class="cz-go" id="cz-go">Flip</button>`,
  `<div class="cz-coin-wrap"><div class="cz-coin" id="cz-coin"><div class="cz-coin-face h">${coinFace('h')}</div><div class="cz-coin-face t">${coinFace('t')}</div></div><div class="cz-coin-said" id="cz-coin-said"></div></div>`);
  wireBet('coinflip');
  wireSeg('cz-coin-side', v => store.set('coin', v));
  let turns = 0;
  el('cz-go').onclick = async () => {
    const bet = readBet('coinflip');
    if (bet == null || busyNow) return;
    const side = segValue('cz-coin-side'), mine = live, coin = el('cz-coin');
    setBusy(true, ['cz-go']); clearResult(); el('cz-coin-said').textContent = '';
    try {
      const j = await call('coinflip', 'play', { bet, side });
      if (mine !== live) return;
      turns += calm() ? 0 : 5;
      coin.style.transition = calm() ? 'none' : '';
      coin.style.transform = `rotateY(${turns * 360 + (j.result === 't' ? 180 : 0)}deg)`;
      if (!calm()) await sleep(1100);
      if (mine !== live) return;
      el('cz-coin-said').textContent = j.result === 'h' ? 'Heads' : 'Tails';
      result(j.stake, j.payout);
      addRecent('coinflip', j.result === 'h' ? 'H' : 'T', j.payout > 0);
    } catch (x) {} finally { if (mine === live) setBusy(false, ['cz-go']); }
  };
}
function coinFace(s) {
  return s === 'h'
    ? '<svg viewBox="0 0 48 48" width="56" height="56"><circle cx="24" cy="24" r="12" fill="currentColor"/><circle cx="19.5" cy="19.5" r="3.5" fill="#fff" opacity=".55"/></svg>'
    : '<svg viewBox="0 0 48 48" width="56" height="56" fill="none" stroke="currentColor" stroke-width="3.5"><circle cx="24" cy="24" r="12"/><circle cx="24" cy="24" r="4.5"/></svg>';
}

// Rock Paper Scissors: a win pays 1.91x, a tie gives the bet back
const RPS_NAMES = { r: 'Rock', p: 'Paper', s: 'Scissors' };
function rpsIcon(k, size = 64) {
  const d = {
    r: '<path d="M14 30c-2-8 3-15 10-15 8 0 13 5 12 13-1 7-6 11-12 11-5 0-9-3-10-9z" fill="currentColor" opacity=".9"/>',
    p: '<rect x="13" y="9" width="22" height="30" rx="2" fill="none" stroke="currentColor" stroke-width="3"/><path d="M18 17h12M18 23h12M18 29h8" stroke="currentColor" stroke-width="2.5"/>',
    s: '<circle cx="15" cy="33" r="5" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="31" cy="33" r="5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M18 29L33 9M28 29L15 9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  }[k];
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}">${d}</svg>`;
}
function rps() {
  frame('rps', `${betHTML('rps')}
    <label class="cz-lbl">Pick one to play</label>
    <div class="cz-rps-picks">${['r', 'p', 's'].map(k => `<button type="button" class="cz-rps-pick" data-rps="${k}">${rpsIcon(k, 34)}<span>${RPS_NAMES[k]}</span></button>`).join('')}</div>
    <div class="cz-stats"><span>Win<b>1.91x</b></span><span>Tie<b>bet back</b></span></div>`,
  `<div class="cz-rps"><div class="cz-rps-side"><span class="cz-rps-who">You</span><div class="cz-rps-hand" id="cz-rps-me"></div></div><span class="cz-rps-vs">vs</span><div class="cz-rps-side"><span class="cz-rps-who">House</span><div class="cz-rps-hand" id="cz-rps-house"></div></div></div>`);
  wireBet('rps');
  document.querySelectorAll('[data-rps]').forEach(b => {
    b.onclick = async () => {
      const bet = readBet('rps');
      if (bet == null || busyNow) return;
      const pick = b.dataset.rps, mine = live;
      busyNow = true; clearResult();
      document.querySelectorAll('[data-rps]').forEach(x => { x.disabled = true; });
      el('cz-rps-me').innerHTML = rpsIcon(pick);
      el('cz-rps-house').innerHTML = '<span class="cz-rps-wait">...</span>';
      try {
        const j = await call('rps', 'play', { bet, pick });
        if (mine !== live) return;
        if (!calm()) await sleep(350);
        el('cz-rps-house').innerHTML = rpsIcon(j.house);
        const tie = j.house === pick;
        result(j.stake, j.payout, tie ? 'a tie' : `${RPS_NAMES[pick]} vs ${RPS_NAMES[j.house]}`);
        addRecent('rps', tie ? 'Tie' : j.payout ? 'Win' : 'Loss', j.payout > j.stake);
      } catch (x) {} finally { if (mine === live) { busyNow = false; document.querySelectorAll('[data-rps]').forEach(x => { x.disabled = false; }); } }
    };
  });
}

// Upgrader: pick how much you want back; the chance is 97% divided by that
function upgrader() {
  const t0 = store.get('upgrader', 2);
  frame('upgrader', `${betHTML('upgrader')}
    <label class="cz-lbl" for="cz-up-t">Upgrade to</label><input type="number" class="cz-num" id="cz-up-t" min="1.1" max="100" step="0.01" value="${t0}">
    <div class="cz-stats"><span>Chance<b id="cz-up-ch"></b></span><span>Win<b id="cz-up-win"></b></span></div>
    <button type="button" class="cz-go" id="cz-go">Upgrade</button>`,
  `<div class="cz-up"><svg viewBox="0 0 200 200" class="cz-up-dial"><circle cx="100" cy="100" r="80" class="cz-up-track"/><path id="cz-up-arc" class="cz-up-arc"/><g id="cz-up-needle" class="cz-up-needle"><path d="M100 100 L100 26"/><circle cx="100" cy="100" r="6"/></g></svg><div class="cz-up-mid" id="cz-up-mid"></div></div>`);
  const target = () => Math.min(100, Math.max(1.1, Math.round(Number(el('cz-up-t').value) * 100) / 100 || 2));
  const arc = ch => {
    const a = Math.min(0.9999, ch) * Math.PI * 2, x = 100 + 80 * Math.sin(a), y = 100 - 80 * Math.cos(a);
    return `M100 20 A80 80 0 ${ch > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
  };
  const update = () => {
    const t = target(), ch = RTP / t;
    el('cz-up-ch').textContent = (ch * 100).toFixed(2) + '%';
    el('cz-up-win').textContent = fmt(Math.min(WIN_MAX, Math.floor((Number(el('cz-bet').value) || 0) * t)));
    el('cz-up-arc').setAttribute('d', arc(ch));
    el('cz-up-mid').textContent = fmtX(t);
    store.set('upgrader', t);
  };
  wireBet('upgrader', update);
  el('cz-up-t').oninput = update;
  el('cz-up-t').onchange = () => { el('cz-up-t').value = target(); update(); };
  update();
  let spun = 0;
  el('cz-go').onclick = async () => {
    const bet = readBet('upgrader');
    if (bet == null || busyNow) return;
    const t = target(), mine = live, needle = el('cz-up-needle');
    setBusy(true, ['cz-go']); clearResult();
    try {
      const j = await call('upgrader', 'play', { bet, target: t });
      if (mine !== live) return;
      spun += calm() ? 0 : 3;
      needle.style.transition = calm() ? 'none' : '';
      needle.style.transform = `rotate(${spun * 360 + j.roll * 360}deg)`;
      if (!calm()) await sleep(1700);
      if (mine !== live) return;
      result(j.stake, j.payout);
      el('cz-up-mid').textContent = j.payout ? 'Upgraded' : 'Missed';
      addRecent('upgrader', fmtX(t), j.payout > 0);
    } catch (x) {} finally { if (mine === live) setBusy(false, ['cz-go']); }
  };
}

// Slots: three reels, the middle line pays
const SLOT_SYMS = ['cherry', 'lemon', 'grape', 'bell', 'star', 'seven', 'orb'];
const SLOT_THREE = { cherry: 10, lemon: 12, grape: 16, bell: 25, star: 50, seven: 150, orb: 800 };
const SLOT_ART = {
  cherry: '<path d="M24 10c-3 6-8 12-11 18M24 10c2 6 4 11 9 17" fill="none" stroke="#3a7d32" stroke-width="2.5"/><circle cx="13" cy="32" r="7" fill="#d8323c"/><circle cx="33" cy="31" r="7" fill="#c42430"/><circle cx="11" cy="30" r="2" fill="#fff" opacity=".5"/>',
  lemon: '<ellipse cx="24" cy="26" rx="15" ry="11" fill="#f2d03b"/><path d="M38 24l4-2M10 28l-4 2" stroke="#d9b21c" stroke-width="3" stroke-linecap="round"/><ellipse cx="19" cy="22" rx="4" ry="2" fill="#fff" opacity=".45"/>',
  grape: '<g fill="#7b3fb5"><circle cx="18" cy="20" r="5.5"/><circle cx="29" cy="20" r="5.5"/><circle cx="24" cy="29" r="5.5"/><circle cx="13" cy="29" r="5"/><circle cx="34" cy="29" r="5"/><circle cx="24" cy="38" r="5"/></g><path d="M24 14V7" stroke="#3a7d32" stroke-width="2.5"/>',
  bell: '<path d="M24 8c-8 0-12 7-12 15v8l-4 5h32l-4-5v-8c0-8-4-15-12-15z" fill="#f0b232"/><circle cx="24" cy="39" r="4" fill="#c78a12"/>',
  star: '<path d="M24 6l5.5 11.5 12.5 1.7-9.1 8.7 2.3 12.4L24 34.3l-11.2 6 2.3-12.4-9.1-8.7 12.5-1.7z" fill="#f5c542"/>',
  seven: '<path d="M12 10h24l-12 30" fill="none" stroke="#e03c3c" stroke-width="7" stroke-linejoin="round"/>',
  orb: '<circle cx="24" cy="24" r="15" fill="#5865f2"/><circle cx="18.5" cy="18.5" r="4.5" fill="#fff" opacity=".55"/>',
};
const slotSvg = (s, size = 54) => `<svg viewBox="0 0 48 48" width="${size}" height="${size}">${SLOT_ART[s]}</svg>`;
function slots() {
  const pays = SLOT_SYMS.slice().reverse().map(s => `<div class="cz-pay-row"><span>${slotSvg(s, 18)}${slotSvg(s, 18)}${slotSvg(s, 18)}</span><b>${SLOT_THREE[s]}x</b></div>`).join('')
    + `<div class="cz-pay-row"><span>Two ${slotSvg('cherry', 18)}</span><b>1.5x</b></div><div class="cz-pay-row"><span>One ${slotSvg('cherry', 18)}</span><b>0.5x</b></div>`;
  frame('slots', `${betHTML('slots')}<button type="button" class="cz-go" id="cz-go">Spin</button><div class="cz-paytable">${pays}</div>`,
    `<div class="cz-slots"><div class="cz-reels">${[0, 1, 2].map(i => `<div class="cz-reel"><div class="cz-strip" id="cz-strip-${i}">${[0, 1, 2].map(() => `<div class="cz-sym">${slotSvg(SLOT_SYMS[Math.floor(Math.random() * 7)])}</div>`).join('')}</div></div>`).join('')}<div class="cz-payline"></div></div></div>`);
  wireBet('slots');
  el('cz-go').onclick = async () => {
    const bet = readBet('slots');
    if (bet == null || busyNow) return;
    const mine = live;
    setBusy(true, ['cz-go']); clearResult();
    try {
      const j = await call('slots', 'play', { bet });
      if (mine !== live) return;
      await Promise.all(j.reels.map((s, i) => spinReel(i, s, 900 + i * 450, mine)));
      if (mine !== live) return;
      result(j.stake, j.payout);
      if (j.reels[0] === j.reels[1] && j.reels[1] === j.reels[2]) egg('triple');   // (an easter egg)
      addRecent('slots', j.payout ? fmtX(j.mult) : '0x', j.payout > j.stake);
    } catch (x) {} finally { if (mine === live) setBusy(false, ['cz-go']); }
  };
}
function spinReel(i, sym, ms, mine) {
  const strip = el('cz-strip-' + i);
  if (!strip) return Promise.resolve();
  const rand = () => SLOT_SYMS[Math.floor(Math.random() * 7)];
  const n = calm() ? 0 : 18, list = [];
  for (let k = 0; k < n; k++) list.push(rand());
  list.push(rand(), sym, rand());
  strip.style.transition = 'none';
  strip.style.transform = 'translateY(0)';
  strip.innerHTML = list.reverse().map(s => `<div class="cz-sym">${slotSvg(s)}</div>`).join('');
  // the strip is drawn bottom-up: start at the bottom, roll down to the top three
  const cell = strip.firstElementChild ? strip.firstElementChild.offsetHeight : 64;
  strip.style.transform = `translateY(-${n * cell}px)`;
  if (calm()) return Promise.resolve();
  return nextFrames().then(() => new Promise(res => {
    if (mine !== live) return res();
    strip.style.transition = `transform ${ms}ms cubic-bezier(.15,.85,.25,1)`;
    strip.style.transform = 'translateY(0)';
    setTimeout(res, ms + 30);
  }));
}

// Keno: pick 1 to 10 of 40 numbers; 10 are drawn
const KENO = {
  1: [0, 3.88], 2: [0, 1.75, 5.1], 3: [0, 0, 5.47, 18.3], 4: [0, 0, 2.22, 11.4, 19.1], 5: [0, 0, 1.07, 5.4, 21.9, 87.9],
  6: [0, 0, 0, 3, 15.2, 101, 509], 7: [0, 0, 0, 1.6, 8.2, 41.1, 197, 659], 8: [0, 0, 0, 1.02, 4.6, 20.1, 93.9, 402, 1000],
  9: [0, 0, 0, 0.71, 2.8, 11.5, 46.3, 208, 695, 1000], 10: [0, 0, 0, 0.56, 1.9, 6.9, 24.9, 99.9, 399, 500, 1000],
};
function keno() {
  let picks = new Set(store.get('keno', []).filter(n => n >= 1 && n <= 40).slice(0, 10));
  frame('keno', `${betHTML('keno')}
    <div class="cz-row2"><button type="button" class="cz-btn2" id="cz-keno-rand">Random</button><button type="button" class="cz-btn2" id="cz-keno-clear">Clear</button></div>
    <button type="button" class="cz-go" id="cz-go">Play</button><div class="cz-paytable" id="cz-keno-pay"></div>`,
  `<div class="cz-keno" id="cz-keno">${Array.from({ length: 40 }, (_, i) => `<button type="button" class="cz-kn" data-kn="${i + 1}">${i + 1}</button>`).join('')}</div>`);
  const paint = () => {
    document.querySelectorAll('[data-kn]').forEach(b => { b.classList.toggle('on', picks.has(Number(b.dataset.kn))); });
    const row = KENO[picks.size];
    el('cz-keno-pay').innerHTML = row ? `<div class="cz-pay-head">${picks.size} picked</div>` + row.map((x, h) => (x ? `<div class="cz-pay-row"><span>${h} hit${h === 1 ? '' : 's'}</span><b>${x}x</b></div>` : '')).reverse().join('') : '<div class="cz-pay-head">Pick 1 to 10 numbers</div>';
    store.set('keno', [...picks]);
  };
  const reset = () => document.querySelectorAll('[data-kn]').forEach(b => b.classList.remove('drawn', 'hit'));
  document.querySelectorAll('[data-kn]').forEach(b => {
    b.onclick = () => {
      if (busyNow) return;
      const n = Number(b.dataset.kn);
      reset();
      if (picks.has(n)) picks.delete(n); else if (picks.size < 10) picks.add(n); else toast('You can pick up to 10.');
      paint();
    };
  });
  el('cz-keno-rand').onclick = () => {
    if (busyNow) return;
    reset();
    const want = picks.size || 10, all = Array.from({ length: 40 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    picks = new Set(all.slice(0, want)); paint();
  };
  el('cz-keno-clear').onclick = () => { if (!busyNow) { reset(); picks.clear(); paint(); } };
  wireBet('keno');
  paint();
  el('cz-go').onclick = async () => {
    if (!picks.size) { toast('Pick at least one number.'); return; }
    const bet = readBet('keno');
    if (bet == null || busyNow) return;
    const mine = live;
    setBusy(true, ['cz-go', 'cz-keno-rand', 'cz-keno-clear']); clearResult(); reset();
    try {
      const j = await call('keno', 'play', { bet, picks: [...picks] });
      for (const n of j.drawn) {
        if (mine !== live) return;
        const b = document.querySelector(`[data-kn="${n}"]`);
        if (b) b.classList.add(picks.has(n) ? 'hit' : 'drawn');
        if (!calm()) await sleep(110);
      }
      result(j.stake, j.payout, `${j.hits} of ${picks.size} hit`);
      addRecent('keno', `${j.hits}/${picks.size}`, j.payout > j.stake);
    } catch (x) {} finally { if (mine === live) setBusy(false, ['cz-go', 'cz-keno-rand', 'cz-keno-clear']); }
  };
}

// Plinko: the ball goes left or right at each row (the server picks); the slot it lands in pays
const PLINKO = {
  8: { low: [5.5, 2, 1, 0.99, 0.54, 0.99, 1, 2, 5.5], medium: [12.9, 2.9, 1.2, 0.69, 0.45, 0.69, 1.2, 2.9, 12.9], high: [28.9, 3.9, 1.4, 0.29, 0.24, 0.29, 1.4, 3.9, 28.9] },
  12: { low: [9.9, 2.9, 1.5, 1.3, 1, 0.99, 0.6, 0.99, 1, 1.3, 1.5, 2.9, 9.9], medium: [32.9, 10.9, 3.9, 1.9, 1, 0.59, 0.4, 0.59, 1, 1.9, 3.9, 10.9, 32.9],
    high: [169, 23.9, 8, 1.9, 0.66, 0.2, 0.2, 0.2, 0.66, 1.9, 8, 23.9, 169] },
  16: { low: [15.9, 8.9, 1.9, 1.3, 1.3, 1.1, 1, 0.99, 0.64, 0.99, 1, 1.1, 1.3, 1.3, 1.9, 8.9, 15.9],
    medium: [109, 40.9, 9.9, 4.9, 2.9, 1.4, 0.99, 0.49, 0.33, 0.49, 0.99, 1.4, 2.9, 4.9, 9.9, 40.9, 109],
    high: [1000, 129, 25.9, 8.9, 3.9, 1.9, 0.2, 0.2, 0.2, 0.2, 0.2, 1.9, 3.9, 8.9, 25.9, 129, 1000] },
};
function plinko() {
  const st = store.get('plinko', { rows: 12, risk: 'medium' });
  frame('plinko', `${betHTML('plinko')}
    <label class="cz-lbl">Rows</label>${seg('cz-pl-rows', [['8', '8'], ['12', '12'], ['16', '16']], String(st.rows))}
    <label class="cz-lbl">Risk</label>${seg('cz-pl-risk', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], st.risk)}
    <button type="button" class="cz-go" id="cz-go">Drop</button>`,
  `<div class="cz-plinko"><svg id="cz-pl-svg" class="cz-pl-svg"></svg></div>`);
  let flying = 0;
  const geo = () => {
    const rows = Number(segValue('cz-pl-rows')), W = 400, gap = W / (rows + 2), top = 24;
    return { rows, W, gap, top, H: top + gap * (rows + 0.6) + 34 };
  };
  const draw = () => {
    const { rows, W, gap, top, H } = geo(), risk = segValue('cz-pl-risk'), table = PLINKO[rows][risk], svg = el('cz-pl-svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    let s = '';
    for (let r = 0; r < rows; r++) for (let i = 0; i <= r + 2; i++) s += `<circle class="cz-peg" cx="${W / 2 + (i - (r + 2) / 2) * gap}" cy="${top + r * gap}" r="${Math.max(2.2, gap / 9)}"/>`;
    const by = top + (rows - 0.4) * gap, bw = gap - 3;
    table.forEach((m, k) => {
      const x = W / 2 + (k - rows / 2) * gap, hot = m >= 10 ? 'hot' : m >= 2 ? 'warm' : m >= 1 ? 'mid' : 'cold';
      s += `<g class="cz-slot ${hot}" id="cz-pl-slot-${k}"><rect x="${x - bw / 2}" y="${by}" width="${bw}" height="22" rx="4"/><text x="${x}" y="${by + 15}">${m >= 100 ? Math.round(m) : m}</text></g>`;
    });
    s += '<g id="cz-pl-balls"></g>';
    svg.innerHTML = s;
    store.set('plinko', { rows, risk });
  };
  wireBet('plinko');
  wireSeg('cz-pl-rows', () => { if (!flying) draw(); });
  wireSeg('cz-pl-risk', () => { if (!flying) draw(); });
  draw();
  el('cz-go').onclick = async () => {
    if (flying >= 4) return;
    const bet = readBet('plinko');
    if (bet == null) return;
    const { rows } = geo(), risk = segValue('cz-pl-risk'), mine = live;
    flying++; clearResult();
    el('cz-pl-rows').classList.add('locked'); el('cz-pl-risk').classList.add('locked');
    busyNow = true;
    try {
      const j = await call('plinko', 'play', { bet, rows, risk });
      if (mine !== live) return;
      await dropBall(j.path, mine);
      if (mine !== live) return;
      const slot = el('cz-pl-slot-' + j.slot);
      if (slot) { slot.classList.remove('bump'); void slot.getBBox(); slot.classList.add('bump'); }
      result(j.stake, j.payout);
      addRecent('plinko', fmtX(j.mult), j.payout > j.stake);
    } catch (x) {} finally {
      flying--;
      if (mine === live && !flying) { busyNow = false; el('cz-pl-rows').classList.remove('locked'); el('cz-pl-risk').classList.remove('locked'); }
    }
  };
  function dropBall(path, mine) {
    const { rows, W, gap, top } = geo(), g = el('cz-pl-balls');
    if (!g) return Promise.resolve();
    const ball = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ball.setAttribute('class', 'cz-ball'); ball.setAttribute('r', Math.max(4, gap / 4.2));
    g.appendChild(ball);
    // where the ball is just above each row: it starts in the middle and moves half a gap left or right per row
    const pts = [[W / 2, top - gap * 0.7]];
    let x = W / 2;
    path.forEach((d, r) => { pts.push([x, top + r * gap - gap * 0.35]); x += (d ? 0.5 : -0.5) * gap; });
    pts.push([x, top + (rows - 0.4) * gap + 6]);
    if (calm() || document.hidden) { ball.setAttribute('cx', x); ball.setAttribute('cy', pts[pts.length - 1][1]); setTimeout(() => ball.remove(), 600); return Promise.resolve(); }
    const per = 120, t0 = performance.now();
    return new Promise(res => {
      // (a hidden tab draws no frames, so the drop also finishes on a timer)
      const stop = setTimeout(() => { ball.remove(); res(); }, per * pts.length + 500);
      const step = t => {
        if (mine !== live) { clearTimeout(stop); ball.remove(); return res(); }
        const f = (t - t0) / per, i = Math.min(pts.length - 2, Math.floor(f)), k = Math.min(1, f - i);
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        ball.setAttribute('cx', x0 + (x1 - x0) * k);
        ball.setAttribute('cy', y0 + (y1 - y0) * k - Math.sin(k * Math.PI) * gap * 0.25);
        if (f < pts.length - 1) requestAnimationFrame(step); else { clearTimeout(stop); setTimeout(() => ball.remove(), 400); res(); }
      };
      requestAnimationFrame(step);
    });
  }
}

// Cases: a case of Orbs; the strip rolls to what's inside
const CASES = {
  pouch: { name: 'Orb Pouch', price: 100, items: [[10, 29786], [30, 25000], [60, 15000], [120, 10000], [300, 5000], [1000, 1500], [5000, 250], [25000, 40]] },
  chest: { name: 'Orb Chest', price: 1000, items: [[100, 30579], [300, 25000], [700, 15000], [1500, 9000], [4000, 4000], [12000, 1200], [50000, 200], [250000, 30]] },
  vault: { name: 'Void Vault', price: 10000, items: [[1000, 22323], [4000, 25000], [8000, 15000], [15000, 9000], [40000, 3500], [120000, 1000], [400000, 150], [1000000, 40]] },
};
const RARITY = ['Common', 'Common', 'Uncommon', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];
// colors that match the names: Common gray, Uncommon green, Rare blue, Epic purple, Legendary gold, Mythic red
const rarityClass = i => (i <= 1 ? 'r0' : i <= 3 ? 'r1' : 'r' + Math.min(5, i - 2));
function cases() {
  let box = store.get('case', 'pouch');
  if (!CASES[box]) box = 'pouch';
  frame('cases', `<label class="cz-lbl">Case</label><div class="cz-cases" id="cz-cases">${Object.entries(CASES).map(([id, c]) => `<button type="button" class="cz-case ${id === box ? 'on' : ''}" data-case="${id}">${icon('cases', 26)}<span>${c.name}</span><b>${fmt(c.price)} Orbs</b></button>`).join('')}</div>
    <button type="button" class="cz-go" id="cz-go">Open</button><div class="cz-paytable" id="cz-case-odds"></div>`,
  `<div class="cz-roll"><div class="cz-roll-line"></div><div class="cz-roll-strip" id="cz-roll-strip"></div></div>`);
  const odds = () => {
    const c = CASES[box], tot = c.items.reduce((s, [, w]) => s + w, 0);
    el('cz-case-odds').innerHTML = `<div class="cz-pay-head">What's inside</div>` + c.items.slice().reverse().map(([v, w], i) => {
      const idx = c.items.length - 1 - i;
      return `<div class="cz-pay-row ${rarityClass(idx)}"><span>${fmt(v)} Orbs</span><b>${(w / tot * 100).toFixed(w / tot < 0.001 ? 3 : 2)}%</b></div>`;
    }).join('');
    fillStrip(null);
  };
  const itemCard = idx => { const v = CASES[box].items[idx][0]; return `<div class="cz-item ${rarityClass(idx)}"><span class="cz-item-r">${RARITY[idx]}</span><b>${fmt(v)}</b><span>Orbs</span></div>`; };
  const randomIdx = () => { const c = CASES[box], tot = c.items.reduce((s, [, w]) => s + w, 0); let x = Math.random() * tot; for (let i = 0; i < c.items.length; i++) { x -= c.items[i][1]; if (x < 0) return i; } return 0; };
  function fillStrip(win) {
    const list = Array.from({ length: 40 }, randomIdx);
    if (win != null) list[34] = win;
    const strip = el('cz-roll-strip');
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(0)';
    strip.innerHTML = list.map(itemCard).join('');
  }
  document.querySelectorAll('[data-case]').forEach(b => {
    b.onclick = () => { if (busyNow) return; box = b.dataset.case; store.set('case', box); document.querySelectorAll('[data-case]').forEach(x => x.classList.toggle('on', x === b)); odds(); };
  });
  odds();
  el('cz-go').onclick = async () => {
    if (busyNow) return;
    const c = CASES[box];
    if (c.price > balance()) { toast('You don\'t have enough Orbs for that.', 'error'); return; }
    if (gamesLeft() <= 0) { toast('That\'s all 200 casino games for today. More after midnight UTC.', 'error'); return; }
    const mine = live;
    setBusy(true, ['cz-go']); clearResult();
    try {
      const j = await call('cases', 'play', { box });
      if (mine !== live) return;
      fillStrip(j.item);
      const strip = el('cz-roll-strip'), card = strip.children[34], wrap = strip.parentElement;
      const target = card.offsetLeft + card.offsetWidth / 2 - wrap.clientWidth / 2 + (Math.random() - 0.5) * card.offsetWidth * 0.6;
      if (calm()) strip.style.transform = `translateX(-${target}px)`;
      else {
        await nextFrames();
        strip.style.transition = 'transform 4.2s cubic-bezier(.12,.8,.18,1)';
        strip.style.transform = `translateX(-${target}px)`;
        await sleep(4300);
      }
      if (mine !== live) return;
      card.classList.add('won');
      result(j.stake, j.payout, `${RARITY[j.item]}`);
      addRecent('cases', fmt(j.payout), j.payout > j.stake);
    } catch (x) {} finally { if (mine === live) setBusy(false, ['cz-go']); }
  };
}

// ---------- Roulette: one zero (37 pockets). Numbers pay 36x, dozens and columns 3x, the rest 2x ----------
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = n => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const ROUL_OUT = {   // [label, pays, wins on n]
  red: ['Red', 2, n => RED.has(n)], black: ['Black', 2, n => n > 0 && !RED.has(n)], odd: ['Odd', 2, n => n > 0 && n % 2 === 1], even: ['Even', 2, n => n > 0 && n % 2 === 0],
  low: ['1 to 18', 2, n => n >= 1 && n <= 18], high: ['19 to 36', 2, n => n >= 19],
  d1: ['1st 12', 3, n => n >= 1 && n <= 12], d2: ['2nd 12', 3, n => n >= 13 && n <= 24], d3: ['3rd 12', 3, n => n >= 25],
  c1: ['2 to 1', 3, n => n > 0 && n % 3 === 1], c2: ['2 to 1', 3, n => n > 0 && n % 3 === 2], c3: ['2 to 1', 3, n => n > 0 && n % 3 === 0],
};
const CHIPS = [10, 50, 100, 500, 1000, 5000];
const chipLabel = v => (v >= 1000 ? v / 1000 + 'K' : String(v));
function roulette() {
  let chip = store.get('chip', 100), bets = {}, lastBets = store.get('roul_last', null), spinning = false, wheelAt = 0, ballAt = 0;
  if (!CHIPS.includes(chip)) chip = 100;
  const total = () => Object.values(bets).reduce((s, a) => s + a, 0);
  const numCell = n => `<button type="button" class="cz-rt-n ${colorOf(n)}" data-rb="n:${n}">${n}<i class="cz-rt-chip" data-chip-for="n:${n}"></i></button>`;
  const outCell = (k, cls) => `<button type="button" class="cz-rt-o ${cls || ''}" data-rb="${k}">${k === 'red' || k === 'black' ? `<span class="cz-rt-dot ${k}"></span>` : ''}${ROUL_OUT[k][0]}<i class="cz-rt-chip" data-chip-for="${k}"></i></button>`;
  let grid = '<div class="cz-rt-zero">' + numCell(0) + '</div><div class="cz-rt-nums">';
  for (let row = 3; row >= 1; row--) for (let col = 0; col < 12; col++) grid += numCell(col * 3 + row);
  grid += '</div><div class="cz-rt-cols">' + outCell('c3') + outCell('c2') + outCell('c1') + '</div>';
  // the wheel: 37 pockets, numbers around the rim
  const R = 150, C0 = 160, seg = 360 / 37;
  let wheel = `<circle cx="${C0}" cy="${C0}" r="${R + 8}" class="cz-wh-rim"/>`;
  WHEEL.forEach((n, i) => {
    const a0 = (i - 0.5) * seg * Math.PI / 180, a1 = (i + 0.5) * seg * Math.PI / 180, r1 = R, r2 = R - 34;
    const p = (r, a) => `${(C0 + r * Math.sin(a)).toFixed(2)} ${(C0 - r * Math.cos(a)).toFixed(2)}`;
    wheel += `<path class="cz-wh-p ${colorOf(n)}" d="M${p(r2, a0)} L${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r2, a1)} A${r2} ${r2} 0 0 0 ${p(r2, a0)}Z"/>`;
    wheel += `<text class="cz-wh-t" transform="rotate(${i * seg} ${C0} ${C0})" x="${C0}" y="${C0 - R + 20}">${n}</text>`;
  });
  wheel += `<circle cx="${C0}" cy="${C0}" r="${R - 34}" class="cz-wh-in"/><circle cx="${C0}" cy="${C0}" r="${R - 70}" class="cz-wh-hub"/>`;
  frame('roulette', `<label class="cz-lbl">Chip</label><div class="cz-chips" id="cz-chips">${CHIPS.map(v => `<button type="button" class="cz-chipbtn ${v === chip ? 'on' : ''}" data-chipv="${v}">${chipLabel(v)}</button>`).join('')}</div>
    <div class="cz-stats"><span>On the table<b id="cz-rt-total">0</b></span></div>
    <div class="cz-row2"><button type="button" class="cz-btn2" id="cz-rt-undo">Undo</button><button type="button" class="cz-btn2" id="cz-rt-clear">Clear</button></div>
    <div class="cz-row2"><button type="button" class="cz-btn2" id="cz-rt-again">Same again</button><button type="button" class="cz-btn2" id="cz-rt-x2">Double</button></div>
    <button type="button" class="cz-go" id="cz-go">Spin</button>
    <div class="cz-hint">Click a spot to put a chip on it. Right-click (or hold) takes one off.</div>`,
  `<div class="cz-rt"><div class="cz-wheel-wrap"><svg viewBox="0 0 320 320" class="cz-wheel"><g id="cz-wh">${wheel}</g><g id="cz-ball-orbit"><circle id="cz-ball" class="cz-ball2" cx="${C0}" cy="${C0 - R + 4}" r="7"/></g></svg>
      <div class="cz-wh-num" id="cz-wh-num"></div></div>
    <div class="cz-rt-table"><div class="cz-rt-grid">${grid}</div>
      <div class="cz-rt-dozens">${outCell('d1')}${outCell('d2')}${outCell('d3')}</div>
      <div class="cz-rt-outs">${outCell('low')}${outCell('even')}${outCell('red')}${outCell('black')}${outCell('odd')}${outCell('high')}</div></div></div>`);
  const history = [];
  const paint = () => {
    document.querySelectorAll('[data-chip-for]').forEach(i => {
      const a = bets[i.dataset.chipFor];
      i.textContent = a ? chipLabel(a) : '';
      i.classList.toggle('on', !!a);
    });
    el('cz-rt-total').textContent = fmt(total());
  };
  const add = (k, v) => {
    if (spinning) return;
    if (total() + v > BET_MAX) { toast('The table takes up to 10,000 Orbs a spin.'); return; }
    if (total() + v > balance()) { toast('You don\'t have enough Orbs for that.'); return; }
    bets[k] = (bets[k] || 0) + v; history.push([k, v]);
    document.querySelectorAll('.cz-rt .hit').forEach(x => x.classList.remove('hit'));
    paint();
  };
  const takeOff = k => {
    if (spinning || !bets[k]) return;
    bets[k] -= Math.min(bets[k], chip);
    if (!bets[k]) delete bets[k];
    paint();
  };
  document.querySelectorAll('[data-rb]').forEach(b => {
    b.onclick = () => add(b.dataset.rb, chip);
    b.oncontextmenu = ev => { ev.preventDefault(); takeOff(b.dataset.rb); };
    let hold = 0;
    b.addEventListener('touchstart', () => { hold = setTimeout(() => { hold = -1; takeOff(b.dataset.rb); }, 550); }, { passive: true });
    b.addEventListener('touchend', ev => { if (hold === -1) ev.preventDefault(); clearTimeout(hold); hold = 0; });
  });
  document.querySelectorAll('[data-chipv]').forEach(b => {
    b.onclick = () => { chip = Number(b.dataset.chipv); store.set('chip', chip); document.querySelectorAll('[data-chipv]').forEach(x => x.classList.toggle('on', x === b)); };
  });
  el('cz-rt-undo').onclick = () => {
    if (spinning) return;
    const last = history.pop();
    if (!last) return;
    bets[last[0]] -= last[1];
    if (bets[last[0]] <= 0) delete bets[last[0]];
    paint();
  };
  el('cz-rt-clear').onclick = () => { if (!spinning) { bets = {}; history.length = 0; paint(); } };
  el('cz-rt-again').onclick = () => {
    if (spinning || !lastBets) return;
    const sum = Object.values(lastBets).reduce((s, a) => s + a, 0);
    if (sum > balance()) { toast('You don\'t have enough Orbs for that.'); return; }
    bets = Object.assign({}, lastBets); history.length = 0; paint();
  };
  el('cz-rt-x2').onclick = () => {
    if (spinning || !total()) return;
    if (total() * 2 > BET_MAX) { toast('The table takes up to 10,000 Orbs a spin.'); return; }
    if (total() * 2 > balance()) { toast('You don\'t have enough Orbs for that.'); return; }
    Object.keys(bets).forEach(k => { bets[k] *= 2; }); history.length = 0; paint();
  };
  paint();
  paintRouletteRecent();
  el('cz-go').onclick = async () => {
    if (spinning) return;
    const sum = total();
    if (!sum) { toast('Put some chips on the table first.'); return; }
    if (sum < BET_MIN) { toast('Put at least 10 Orbs on the table.'); return; }
    if (sum > balance()) { toast('You don\'t have enough Orbs for that.', 'error'); return; }
    if (gamesLeft() <= 0) { toast('That\'s all 200 casino games for today. More after midnight UTC.', 'error'); return; }
    const mine = live, list = Object.entries(bets).map(([k, a]) => (k.startsWith('n:') ? { t: 'n', n: Number(k.slice(2)), a } : { t: k, a }));
    spinning = true; busyNow = true; setBusy(true, ['cz-go']); clearResult();
    el('cz-wh-num').textContent = ''; el('cz-wh-num').className = 'cz-wh-num';
    document.querySelectorAll('.cz-rt .hit').forEach(x => x.classList.remove('hit'));
    try {
      const j = await call('roulette', 'play', { bets: list });
      if (mine !== live) return;
      lastBets = Object.assign({}, bets); store.set('roul_last', lastBets);
      // the wheel turns one way, the ball the other, and the ball ends on the pocket that came up
      const idx = WHEEL.indexOf(j.result), wh = el('cz-wh'), orbit = el('cz-ball-orbit'), ball = el('cz-ball');
      // the ball starts back on the rim
      ball.style.transition = 'none'; ball.style.transform = 'translateY(0)';
      void ball.getBBox();
      wheelAt += calm() ? 0 : 720 + Math.random() * 180;
      const target = wheelAt + idx * seg;        // where that pocket is once the wheel stops
      ballAt = calm() ? target : target - 360 * Math.ceil((target - (ballAt - 1080)) / 360);   // at least 3 turns the other way
      [wh, orbit].forEach(g => { g.style.transition = calm() ? 'none' : 'transform 5s cubic-bezier(.2,.75,.25,1)'; });
      ball.style.transition = calm() ? 'none' : 'transform 1.4s ease-in 3.4s';
      wh.style.transform = `rotate(${wheelAt}deg)`;
      orbit.style.transform = `rotate(${ballAt}deg)`;
      ball.style.transform = 'translateY(17px)';   // drops off the rim into the pocket ring
      if (!calm()) await sleep(5100);
      if (mine !== live) return;
      const n = j.result;
      el('cz-wh-num').textContent = n; el('cz-wh-num').className = 'cz-wh-num ' + colorOf(n);
      document.querySelectorAll('[data-rb]').forEach(b => {
        const k = b.dataset.rb, hit = k.startsWith('n:') ? Number(k.slice(2)) === n : ROUL_OUT[k][2](n);
        b.classList.toggle('hit', hit);
      });
      result(j.stake, j.payout, `${n} ${colorOf(n)}`);
      if (n === 0 && j.payout > 0 && lastBets['n:0']) egg('zerohero');   // (an easter egg)
      addRecent('roulette', String(n), false);
      paintRouletteRecent();
      bets = {}; history.length = 0; paint();
    } catch (x) {} finally {
      if (mine === live) { spinning = false; busyNow = false; setBusy(false, ['cz-go']); }
    }
  };
}
// recent Roulette numbers in their own colors
function paintRouletteRecent() {
  document.querySelectorAll('#cz-recent .cz-chip').forEach(c => { c.classList.remove('good'); c.classList.add('rt-' + colorOf(Number(c.textContent))); });
}

// ---------- step games: Mines, Towers, Crossing, Hi-Lo ----------
// The server gives a sealed ticket at the start. The moves so far are kept here (and in localStorage, so a reload can
// carry on) and sent with each move; the server replays them all.
const TOWER = { easy: [4, 1], medium: [3, 1], hard: [2, 1], expert: [3, 2] };
const TOWER_ROWS = 8;
const CROSS = { easy: [0.9, 20], medium: [0.8, 20], hard: [0.7, 15], daredevil: [0.55, 12] };
const floor4 = x => Math.floor(x * 10000) / 10000;
const minesMult = (m, k) => { let x = RTP; for (let i = 0; i < k; i++) x *= (25 - i) / (25 - m - i); return floor4(x); };
const towerMult = (l, k) => { const [c, b] = TOWER[l]; return floor4(RTP * (c / (c - b)) ** k); };
const crossMult = (l, k) => floor4(RTP / CROSS[l][0] ** k);

// what's saved for a game going on: { ticket, path, b, p }
const saved = g => store.get('step_' + g, null);
const save = (g, s) => store.set('step_' + g, s);
// picks a game up again if the profile says it's going: a new ticket from the server, plus the moves saved here
async function resumeStep(game) {
  const o = casinoRec().open;
  if (!o || o.g !== game) { save(game, null); return null; }
  const j = await call(game, 'resume');
  if (!j.open || !j.open.ticket) { save(game, null); return null; }
  const s = saved(game);
  const path = s && s.ticket === j.open.ticket ? s.path : (game === 'hilo' ? '' : game === 'cross' ? 0 : []);
  const st = { ticket: j.open.ticket, path, b: j.open.b, p: j.open.p };
  const r = await call(game, 'step', { ticket: st.ticket, path });   // replays what was saved (nothing new)
  if (r.over) { save(game, null); return { over: r }; }
  save(game, st);
  return { st, r };
}
function stepFrame(id, settingsHTML, stageHTML) {
  return frame(id, `${betHTML(id)}${settingsHTML}
    <div class="cz-stats" id="cz-step-stats"></div>
    <button type="button" class="cz-go" id="cz-go">Bet</button>
    <button type="button" class="cz-go cash hidden" id="cz-cash">Cash out</button>
    <button type="button" class="cz-btn2 hidden" id="cz-giveup">Give up this game</button>`, stageHTML);
}
// switches the side panel between "set up a bet" and "playing"
function playing(on) {
  ['cz-go'].forEach(id => el(id) && el(id).classList.toggle('hidden', on));
  ['cz-cash', 'cz-giveup'].forEach(id => el(id) && el(id).classList.toggle('hidden', !on));
  document.querySelectorAll('.cz-side .cz-seg, #cz-bet, [data-cz-bet], #cz-mines-n').forEach(x => {
    if (x.tagName === 'DIV') x.classList.toggle('locked', on); else x.disabled = on;
  });
}
function wireGiveUp(game, after) {
  el('cz-giveup').onclick = () => confirmAction({
    title: 'Give up this game?', body: 'Your bet stays lost.', confirmLabel: 'Give Up',
    onConfirm: async () => { try { await call(game, 'forfeit'); save(game, null); after(); } catch (x) {} },
  });
}

// Mines: 5 by 5, you pick how many mines
const GEM = '<svg viewBox="0 0 24 24" width="60%" height="60%"><path d="M6 4h12l4 6-10 11L2 10z" fill="#3ddc97"/><path d="M2 10h20M8.5 4L12 21l3.5-17" fill="none" stroke="#1d9e66" stroke-width="1.3"/></svg>';
const MINE = '<svg viewBox="0 0 24 24" width="62%" height="62%"><circle cx="12" cy="13" r="7" fill="#e5484d"/><path d="M12 6V3M17 8l2-2M19 13h3M5 13H2M7 8L5 6" stroke="#e5484d" stroke-width="2" stroke-linecap="round"/><circle cx="9.5" cy="10.5" r="1.8" fill="#fff" opacity=".6"/></svg>';
function mines() {
  const m0 = store.get('mines_n', 3);
  stepFrame('mines', `<label class="cz-lbl" for="cz-mines-n">Mines</label><select id="cz-mines-n" class="cz-num">${Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}" ${i + 1 === m0 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>
    <button type="button" class="cz-btn2 hidden" id="cz-mines-rand">Pick a random tile</button>`,
  `<div class="cz-mines" id="cz-mines">${Array.from({ length: 25 }, (_, i) => `<button type="button" class="cz-tile2" data-mt="${i}" disabled></button>`).join('')}</div>`);
  let st = null, going = false;
  const mine = live;
  const stats = () => {
    const m = st ? st.p.m : Number(el('cz-mines-n').value), k = st ? st.path.length : 0, bet = st ? st.b : Number(el('cz-bet').value) || 0;
    el('cz-step-stats').innerHTML = `<span>Next tile<b>${fmtX(minesMult(m, k + 1))}</b></span><span>Now<b>${k ? fmtX(minesMult(m, k)) : '-'}</b></span>`;
    el('cz-cash').textContent = k ? `Cash out ${fmt(Math.min(WIN_MAX, Math.floor(bet * minesMult(m, k))))} Orbs` : 'Cash out';
    el('cz-cash').disabled = !k;
  };
  const tiles = () => document.querySelectorAll('[data-mt]');
  const reset = () => tiles().forEach(t => { t.className = 'cz-tile2'; t.innerHTML = ''; t.disabled = true; });
  const showBoard = (minesAt, hit) => tiles().forEach(t => {
    const i = Number(t.dataset.mt), isMine = minesAt.includes(i);
    if (!t.classList.contains('gem')) { t.classList.add(isMine ? 'mine' : 'gem', 'dim'); t.innerHTML = isMine ? MINE : GEM; }
    if (i === hit) { t.classList.remove('dim'); t.classList.add('boom'); }
    t.disabled = true;
  });
  const begin = s => {
    st = s; going = true; playing(true); el('cz-mines-rand').classList.remove('hidden');
    reset();
    tiles().forEach(t => { t.disabled = false; });
    st.path.forEach(i => { const t = tiles()[i]; t.classList.add('gem'); t.innerHTML = GEM; t.disabled = true; });
    stats();
  };
  const end = r => {
    going = false; playing(false); el('cz-mines-rand').classList.add('hidden');
    if (r.mines) showBoard(r.mines, r.lost != null ? st.path[r.lost] : -1);
    result(st.b, r.payout || 0, r.lost != null ? 'hit a mine' : `${st.path.length - (r.lost != null ? 1 : 0)} gem${st.path.length === 1 ? '' : 's'}`);
    addRecent('mines', r.payout ? fmtX(r.payout / st.b) : '0x', r.payout > st.b);
    save('mines', null);
    showTop();
  };
  const pick = async i => {
    if (!going || busyNow || st.path.includes(i)) return;
    busyNow = true;
    const t = tiles()[i];
    t.classList.add('wait');
    const path = st.path.concat(i);
    try {
      const r = await call('mines', 'step', { ticket: st.ticket, path });
      if (mine !== live) return;
      t.classList.remove('wait');
      st.path = path;
      if (r.over) { end(r); return; }
      t.classList.add('gem'); t.innerHTML = GEM; t.disabled = true;
      save('mines', st);
      stats();
    } catch (x) { t.classList.remove('wait'); } finally { busyNow = false; }
  };
  tiles().forEach(t => { t.onclick = () => pick(Number(t.dataset.mt)); });
  el('cz-mines-rand').onclick = () => { const free = [...Array(25).keys()].filter(i => !st.path.includes(i)); if (free.length) pick(free[Math.floor(Math.random() * free.length)]); };
  el('cz-mines-n').onchange = () => { store.set('mines_n', Number(el('cz-mines-n').value)); stats(); };
  wireBet('mines', stats);
  wireGiveUp('mines', () => { if (mine === live) { going = false; playing(false); reset(); clearResult(); stats(); } });
  el('cz-go').onclick = async () => {
    const bet = readBet('mines');
    if (bet == null || busyNow) return;
    busyNow = true; clearResult();
    try {
      const j = await call('mines', 'start', { bet, mines: Number(el('cz-mines-n').value) });
      if (mine !== live) return;
      const s = { ticket: j.ticket, path: [], b: j.bet, p: j.p };
      save('mines', s); begin(s);
    } catch (x) {} finally { busyNow = false; }
  };
  el('cz-cash').onclick = async () => {
    if (!going || busyNow || !st.path.length) return;
    busyNow = true;
    try { const r = await call('mines', 'cashout', { ticket: st.ticket, path: st.path }); if (mine === live) end(r); } catch (x) {} finally { busyNow = false; }
  };
  stats();
  resumeStep('mines').then(x => { if (!x || mine !== live) return; if (x.st) begin(x.st); }).catch(() => {});
}

// Towers: 8 floors; each floor has a safe tile or more. Pick one to go up.
function towers() {
  const l0 = store.get('towers_l', 'medium');
  stepFrame('towers', `<label class="cz-lbl">Difficulty</label>${seg('cz-tw-l', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['expert', 'Expert']], l0)}`,
    `<div class="cz-towers" id="cz-towers"></div>`);
  let st = null, going = false;
  const mine = live, level = () => (st ? st.p.l : segValue('cz-tw-l'));
  const draw = () => {
    const l = level(), [cols] = TOWER[l], k = st ? st.path.length : -1;
    let h = '';
    for (let r = TOWER_ROWS - 1; r >= 0; r--) {
      h += `<div class="cz-tw-row ${going && r === k ? 'now' : ''} ${st && r < k ? 'done' : ''}"><span class="cz-tw-x">${fmtX(towerMult(l, r + 1))}</span><div class="cz-tw-tiles">`;
      for (let c = 0; c < cols; c++) h += `<button type="button" class="cz-tile2" data-tw="${r}:${c}" ${going && r === k ? '' : 'disabled'}>${st && st.path[r] === c ? GEM : ''}</button>`;
      h += '</div></div>';
    }
    el('cz-towers').innerHTML = h;
    document.querySelectorAll('[data-tw]').forEach(b => { b.onclick = () => climb(Number(b.dataset.tw.split(':')[1])); });
    const bet = going && st ? st.b : Number(el('cz-bet').value) || 0, kk = going && st ? st.path.length : 0;
    el('cz-step-stats').innerHTML = `<span>Next floor<b>${fmtX(towerMult(l, kk + 1))}</b></span><span>Now<b>${kk ? fmtX(towerMult(l, kk)) : '-'}</b></span>`;
    el('cz-cash').textContent = kk ? `Cash out ${fmt(Math.min(WIN_MAX, Math.floor(bet * towerMult(l, kk))))} Orbs` : 'Cash out';
    el('cz-cash').disabled = !kk;
  };
  const end = r => {
    going = false; playing(false);
    draw();
    if (r.rows) r.rows.forEach((bad, row) => bad.forEach(c => {
      const b = document.querySelector(`[data-tw="${row}:${c}"]`);
      if (b) { b.classList.add('mine', r.lost === row ? 'boom' : 'dim'); b.innerHTML = MINE; }
    }));
    result(st.b, r.payout || 0, r.lost != null ? `fell on floor ${r.lost + 1}` : `${st.path.length} floor${st.path.length === 1 ? '' : 's'}`);
    addRecent('towers', r.payout ? fmtX(r.payout / st.b) : '0x', r.payout > st.b);
    save('towers', null); showTop();
  };
  const climb = async c => {
    if (!going || busyNow) return;
    busyNow = true;
    const path = st.path.concat(c);
    try {
      const r = await call('towers', 'step', { ticket: st.ticket, path });
      if (mine !== live) return;
      st.path = path;
      if (r.over) { end(r); return; }
      save('towers', st); draw();
    } catch (x) {} finally { busyNow = false; }
  };
  wireSeg('cz-tw-l', v => { store.set('towers_l', v); draw(); });
  wireBet('towers', draw);
  wireGiveUp('towers', () => { if (mine === live) { going = false; st = null; playing(false); clearResult(); draw(); } });
  el('cz-go').onclick = async () => {
    const bet = readBet('towers');
    if (bet == null || busyNow) return;
    busyNow = true; clearResult();
    try {
      const j = await call('towers', 'start', { bet, level: segValue('cz-tw-l') });
      if (mine !== live) return;
      st = { ticket: j.ticket, path: [], b: j.bet, p: j.p }; save('towers', st);
      going = true; playing(true); draw();
    } catch (x) {} finally { busyNow = false; }
  };
  el('cz-cash').onclick = async () => {
    if (!going || busyNow || !st.path.length) return;
    busyNow = true;
    try { const r = await call('towers', 'cashout', { ticket: st.ticket, path: st.path }); if (mine === live) end(r); } catch (x) {} finally { busyNow = false; }
  };
  draw();
  resumeStep('towers').then(x => { if (!x || mine !== live || !x.st) return; st = x.st; going = true; playing(true); draw(); }).catch(() => {});
}

// Crossing: lanes of traffic; each lane you cross pays more, one hit and it's over
const RUNNER = '<svg viewBox="0 0 32 32" width="100%" height="100%"><circle cx="16" cy="17" r="10" fill="#5865f2"/><circle cx="12.5" cy="13.5" r="3" fill="#fff" opacity=".55"/><circle cx="13" cy="18" r="1.6" fill="#fff"/><circle cx="20" cy="18" r="1.6" fill="#fff"/></svg>';
function cross() {
  const l0 = store.get('cross_l', 'easy');
  stepFrame('cross', `<label class="cz-lbl">Difficulty</label>${seg('cz-cr-l', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['daredevil', 'Daredevil']], l0)}
    <button type="button" class="cz-go hidden" id="cz-cr-step">Cross the next lane</button>`,
  `<div class="cz-road-wrap"><div class="cz-road" id="cz-road"></div></div>`);
  let st = null, going = false;
  const mine = live, level = () => (st ? st.p.l : segValue('cz-cr-l'));
  const draw = (hitLane) => {
    const l = level(), lanes = CROSS[l][1], n = st ? st.path : 0;
    let h = `<div class="cz-lane start">${!going && hitLane == null && !st ? `<div class="cz-runner">${RUNNER}</div>` : n === 0 && going ? `<div class="cz-runner">${RUNNER}</div>` : ''}</div>`;
    for (let i = 0; i < lanes; i++) {
      const here = going ? i === n - 1 : hitLane === i;
      h += `<div class="cz-lane ${i < n && hitLane !== i ? 'crossed' : ''} ${hitLane === i ? 'hit' : ''} ${going && i === n ? 'next' : ''}"><span class="cz-lane-x">${fmtX(crossMult(l, i + 1))}</span>${here ? `<div class="cz-runner ${hitLane === i ? 'down' : ''}">${RUNNER}</div>` : ''}${hitLane === i ? '<div class="cz-car"></div>' : ''}</div>`;
    }
    el('cz-road').innerHTML = h;
    const cur = el('cz-road').querySelector('.cz-runner');
    if (cur && cur.parentElement && cur.parentElement.scrollIntoView) cur.parentElement.scrollIntoView({ block: 'nearest', inline: 'center', behavior: calm() ? 'auto' : 'smooth' });
    const bet = going && st ? st.b : Number(el('cz-bet').value) || 0, nn = going ? n : 0;
    el('cz-step-stats').innerHTML = `<span>Clear chance<b>${Math.round(CROSS[l][0] * 100)}%</b></span><span>Next lane<b>${fmtX(crossMult(l, nn + 1))}</b></span>`;
    el('cz-cash').textContent = nn ? `Cash out ${fmt(Math.min(WIN_MAX, Math.floor(bet * crossMult(l, nn))))} Orbs` : 'Cash out';
    el('cz-cash').disabled = !nn;
  };
  const setGoing = on => { going = on; playing(on); el('cz-cr-step').classList.toggle('hidden', !on); };
  const end = r => {
    setGoing(false);
    draw(r.lost != null ? r.lost : (r.hit != null ? r.hit : undefined));
    result(st.b, r.payout || 0, r.lost != null ? `hit in lane ${r.lost + 1}` : `${st.path} lane${st.path === 1 ? '' : 's'}`);
    addRecent('cross', r.payout ? fmtX(r.payout / st.b) : '0x', r.payout > st.b);
    save('cross', null); showTop();
  };
  el('cz-cr-step').onclick = async () => {
    if (!going || busyNow) return;
    busyNow = true;
    const n = st.path + 1;
    try {
      const r = await call('cross', 'step', { ticket: st.ticket, path: n });
      if (mine !== live) return;
      st.path = n;
      if (r.over) { end(r); return; }
      save('cross', st); draw();
    } catch (x) {} finally { busyNow = false; }
  };
  wireSeg('cz-cr-l', v => { store.set('cross_l', v); draw(); });
  wireBet('cross', () => draw());
  wireGiveUp('cross', () => { if (mine === live) { st = null; setGoing(false); clearResult(); draw(); } });
  el('cz-go').onclick = async () => {
    const bet = readBet('cross');
    if (bet == null || busyNow) return;
    busyNow = true; clearResult();
    try {
      const j = await call('cross', 'start', { bet, level: segValue('cz-cr-l') });
      if (mine !== live) return;
      st = { ticket: j.ticket, path: 0, b: j.bet, p: j.p }; save('cross', st);
      setGoing(true); draw();
    } catch (x) {} finally { busyNow = false; }
  };
  el('cz-cash').onclick = async () => {
    if (!going || busyNow || !st.path) return;
    busyNow = true;
    try { const r = await call('cross', 'cashout', { ticket: st.ticket, path: st.path }); if (mine === live) end(r); } catch (x) {} finally { busyNow = false; }
  };
  draw();
  resumeStep('cross').then(x => { if (!x || mine !== live || !x.st) return; st = x.st; setGoing(true); draw(); }).catch(() => {});
}

// cards: rank 1..13 (A..K), suit 0..3 (spades, hearts, diamonds, clubs)
const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = [
  '<path d="M12 3C9 7 4 9.5 4 13.5a4 4 0 0 0 7 2.6L10 21h4l-1-4.9a4 4 0 0 0 7-2.6C20 9.5 15 7 12 3z"/>',
  '<path d="M12 20.5S3.5 15 3.5 9.2A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 8.5 2.2C20.5 15 12 20.5 12 20.5z"/>',
  '<path d="M12 2.5L19.5 12 12 21.5 4.5 12z"/>',
  '<circle cx="12" cy="7.5" r="3.6"/><circle cx="7.2" cy="13.2" r="3.6"/><circle cx="16.8" cy="13.2" r="3.6"/><path d="M11 13h2l1 8h-4z"/>',
];
const suitSvg = (s, size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor">${SUITS[s]}</svg>`;
function cardHTML(r, s, extra) {
  if (r == null) return `<div class="cz-card back ${extra || ''}"></div>`;
  return `<div class="cz-card ${s === 1 || s === 2 ? 'red' : ''} ${extra || ''}"><span class="cz-card-r">${RANKS[r]}</span>${suitSvg(s, 16)}<span class="cz-card-big">${suitSvg(s, 34)}</span></div>`;
}

// Hi-Lo: is the next card higher or lower? Same rank changes nothing.
function hilo() {
  stepFrame('hilo', `<div class="cz-hilo-moves hidden" id="cz-hl-moves">
      <button type="button" class="cz-go hl" id="cz-hl-h"></button>
      <button type="button" class="cz-go hl" id="cz-hl-l"></button>
      <button type="button" class="cz-btn2" id="cz-hl-s">Skip this card</button></div>`,
  `<div class="cz-hilo"><div class="cz-hilo-card" id="cz-hl-card">${cardHTML(null)}</div><div class="cz-hilo-trail" id="cz-hl-trail"></div></div>`);
  let st = null, going = false, cards = [];
  const mine = live;
  const cur = () => cards[cards.length - 1];
  const multNow = () => {   // what the moves so far are worth (before the 3%)
    let m = 1, wins = 0;
    for (let i = 0; i < st.path.length; i++) {
      const a = cards[i], b = cards[i + 1], mv = st.path[i];
      if (mv === 'h' && b.r > a.r) { m *= 12 / (13 - a.r); wins++; }
      if (mv === 'l' && b.r < a.r) { m *= 12 / (a.r - 1); wins++; }
    }
    return { m, wins };
  };
  const draw = () => {
    const c = cur();
    el('cz-hl-card').innerHTML = c ? cardHTML(c.r, c.s, 'big') : cardHTML(null, 0, 'big');
    el('cz-hl-trail').innerHTML = cards.slice(0, -1).slice(-12).map((x, i, arr) => {
      const mv = st && st.path[cards.length - 1 - arr.length + i];
      return `<div class="cz-trail-item">${cardHTML(x.r, x.s, 'small')}<span>${mv === 'h' ? 'Higher' : mv === 'l' ? 'Lower' : mv === 's' ? 'Skip' : ''}</span></div>`;
    }).join('');
    if (!going || !c) { el('cz-step-stats').innerHTML = ''; return; }
    const { m, wins } = multNow(), bet = st.b;
    const up = c.r < 13 ? 12 / (13 - c.r) : 0, down = c.r > 1 ? 12 / (c.r - 1) : 0;
    el('cz-hl-h').innerHTML = up ? `Higher <small>${((13 - c.r) / 13 * 100).toFixed(1)}% &middot; ${fmtX(up)}</small>` : 'Higher <small>none higher</small>';
    el('cz-hl-l').innerHTML = down ? `Lower <small>${((c.r - 1) / 13 * 100).toFixed(1)}% &middot; ${fmtX(down)}</small>` : 'Lower <small>none lower</small>';
    el('cz-hl-h').disabled = !up; el('cz-hl-l').disabled = !down;
    el('cz-step-stats').innerHTML = `<span>Same rank<b>nothing happens</b></span><span>Now<b>${wins ? fmtX(floor4(RTP * m)) : '-'}</b></span>`;
    el('cz-cash').textContent = wins ? `Cash out ${fmt(Math.min(WIN_MAX, Math.floor(bet * floor4(RTP * m))))} Orbs` : 'Cash out';
    el('cz-cash').disabled = !wins;
  };
  const setGoing = on => { going = on; playing(on); el('cz-hl-moves').classList.toggle('hidden', !on); };
  const end = r => {
    if (r.cards) cards = r.cards;
    setGoing(false); draw();
    result(st.b, r.payout || 0, r.lost != null ? 'wrong guess' : '');
    addRecent('hilo', r.payout ? fmtX(r.payout / st.b) : '0x', r.payout > st.b);
    save('hilo', null); showTop();
  };
  const move = async mv => {
    if (!going || busyNow) return;
    busyNow = true;
    const path = st.path + mv;
    try {
      const r = await call('hilo', 'step', { ticket: st.ticket, path });
      if (mine !== live) return;
      st.path = path;
      if (r.over) { end(r); return; }
      cards = r.cards; save('hilo', st);
      const card = el('cz-hl-card');
      draw();
      if (!calm()) { card.classList.remove('flip'); void card.offsetWidth; card.classList.add('flip'); }
    } catch (x) {} finally { busyNow = false; }
  };
  el('cz-hl-h').onclick = () => move('h');
  el('cz-hl-l').onclick = () => move('l');
  el('cz-hl-s').onclick = () => move('s');
  wireBet('hilo');
  wireGiveUp('hilo', () => { if (mine === live) { setGoing(false); cards = []; st = null; clearResult(); draw(); } });
  el('cz-go').onclick = async () => {
    const bet = readBet('hilo');
    if (bet == null || busyNow) return;
    busyNow = true; clearResult();
    try {
      const j = await call('hilo', 'start', { bet });
      if (mine !== live) return;
      st = { ticket: j.ticket, path: '', b: j.bet, p: j.p }; cards = j.cards; save('hilo', st);
      setGoing(true); draw();
    } catch (x) {} finally { busyNow = false; }
  };
  el('cz-cash').onclick = async () => {
    if (!going || busyNow) return;
    busyNow = true;
    try { const r = await call('hilo', 'cashout', { ticket: st.ticket, path: st.path }); if (mine === live) end(r); } catch (x) {} finally { busyNow = false; }
  };
  draw();
  resumeStep('hilo').then(x => { if (!x || mine !== live || !x.st) return; st = x.st; cards = x.r.cards || []; setGoing(true); draw(); }).catch(() => {});
}

// ---------- Blackjack ----------
const bjCard = c => cardHTML((c % 13) + 1, Math.floor(c / 13));
const bjTotal = cards => {
  let t = 0, aces = 0;
  for (const c of cards) { const r = c % 13; if (r === 0) { aces++; t += 11; } else t += Math.min(10, r + 1); }
  while (t > 21 && aces) { t -= 10; aces--; }
  return t;
};
function blackjack() {
  frame('blackjack', `${betHTML('blackjack')}
    <button type="button" class="cz-go" id="cz-go">Deal</button>
    <div class="cz-bj-moves hidden" id="cz-bj-moves"><button type="button" class="cz-go" id="cz-bj-hit">Hit</button><button type="button" class="cz-go alt" id="cz-bj-stand">Stand</button><button type="button" class="cz-btn2" id="cz-bj-double">Double</button></div>
    <div class="cz-hint">The dealer stands on every 17. Blackjack pays 3 to 2. You can double on your first two cards.</div>`,
  `<div class="cz-bj"><div class="cz-bj-hand"><span class="cz-bj-who">Dealer <b id="cz-bj-dt"></b></span><div class="cz-bj-cards" id="cz-bj-d"></div></div>
    <div class="cz-bj-hand"><span class="cz-bj-who">You <b id="cz-bj-pt"></b></span><div class="cz-bj-cards" id="cz-bj-p"></div></div></div>`);
  const mine = live;
  let bet = 0;
  const show = (j, over) => {
    el('cz-bj-p').innerHTML = j.p.map(bjCard).join('');
    el('cz-bj-d').innerHTML = j.d.map(bjCard).join('') + (over ? '' : cardHTML(null));
    el('cz-bj-pt').textContent = bjTotal(j.p);
    el('cz-bj-dt').textContent = over ? bjTotal(j.d) : bjTotal(j.d.slice(0, 1));
    const going = !over;
    el('cz-go').classList.toggle('hidden', going);
    el('cz-bj-moves').classList.toggle('hidden', !going);
    el('cz-bet').disabled = going;
    document.querySelectorAll('[data-cz-bet]').forEach(b => { b.disabled = going; });
    el('cz-bj-double').disabled = !j.canDouble || bet > balance();
  };
  const finish = j => {
    show(j, true);
    const pt = bjTotal(j.p), dt = bjTotal(j.d), stake = j.doubled ? bet * 2 : bet, bj = j.p.length === 2 && pt === 21;
    result(stake, j.payout, pt > 21 ? 'bust' : bj && j.payout > stake ? 'blackjack' : dt > 21 ? 'dealer bust' : `${pt} vs ${dt}`);
    addRecent('blackjack', pt > 21 ? 'Bust' : j.payout > stake ? 'Win' : j.payout === stake ? 'Push' : 'Loss', j.payout > stake);
    showTop();
  };
  const act = async (action, extra) => {
    if (busyNow) return;
    busyNow = true;
    try {
      const j = await call('blackjack', action, extra);
      if (mine !== live) return;
      if (action === 'double') j.doubled = true;
      if (j.over) finish(j); else show(j, false);
    } catch (x) {} finally { busyNow = false; }
  };
  el('cz-go').onclick = () => { const b = readBet('blackjack'); if (b == null) return; bet = b; clearResult(); act('start', { bet: b }); };
  el('cz-bj-hit').onclick = () => act('hit');
  el('cz-bj-stand').onclick = () => act('stand');
  el('cz-bj-double').onclick = () => { if (bet > balance()) { toast('You don\'t have enough Orbs to double.', 'error'); return; } act('double'); };
  wireBet('blackjack');
  const o = casinoRec().open;
  if (o && o.g === 'blackjack') {
    bet = o.b;
    call('blackjack', 'state').then(j => { if (mine === live && j.p) show(j, false); }).catch(() => {});
  }
}

// ---------- Crash: the number climbs from 1.00x; cash out before it crashes ----------
let crashRound = null;   // { id, startAt (server ms), rate, offset (server - here), bet, auto, done }
function crash() {
  const a0 = store.get('crash_auto', '');
  frame('crash', `${betHTML('crash')}
    <label class="cz-lbl" for="cz-cr-auto">Auto cash out at</label><input type="number" class="cz-num" id="cz-cr-auto" min="1.01" max="1000" step="0.01" placeholder="Off" value="${a0}">
    <button type="button" class="cz-go" id="cz-go">Bet</button><button type="button" class="cz-go cash hidden" id="cz-cash">Cash out</button>
    <div class="cz-hint">It can crash any time, even right at 1.00x (about 1 round in 25). It never goes past 1000x.</div>`,
  `<div class="cz-crash"><canvas id="cz-cr-canvas"></canvas><div class="cz-cr-num" id="cz-cr-num">1.00x</div><div class="cz-cr-sub" id="cz-cr-sub">Place a bet to start a round</div></div>`);
  const mine = live;
  wireBet('crash');
  el('cz-cr-auto').onchange = () => {
    const v = Number(el('cz-cr-auto').value);
    el('cz-cr-auto').value = v ? Math.min(1000, Math.max(1.01, Math.round(v * 100) / 100)) : '';
    store.set('crash_auto', el('cz-cr-auto').value);
  };
  el('cz-go').onclick = async () => {
    const bet = readBet('crash');
    if (bet == null || busyNow || (crashRound && !crashRound.done)) return;
    const auto = Number(el('cz-cr-auto').value) || 0;
    busyNow = true; clearResult();
    try {
      const j = await call('crash', 'start', { bet, auto: auto || undefined });
      if (mine !== live) return;
      runCrash({ id: j.id, startAt: j.startAt, rate: j.rate, offset: j.now - Date.now(), bet, auto: j.auto || 0, done: false }, mine);
    } catch (x) { busyNow = false; }
  };
  el('cz-cash').onclick = async () => {
    const r = crashRound;
    if (!r || r.done || r.cashing) return;
    const t = Date.now() + r.offset - r.startAt;
    if (t < 0) return;
    r.cashing = true;
    try { const j = await call('crash', 'cashout', { id: r.id, t: Math.round(t) }); crashEnded(r, j, mine); } catch (x) { r.cashing = false; }
  };
  const o = casinoRec().open;
  if (o && o.g === 'crash') call('crash', 'resume').then(j => {
    if (mine !== live || !j.open || j.open.g !== 'crash') return;
    runCrash({ id: j.open.id, startAt: j.open.startAt, rate: j.open.rate, offset: j.open.now - Date.now(), bet: j.open.b, auto: j.open.auto || 0, done: false }, mine);
  }).catch(() => {});
  drawCrash(null, 1, 'idle');
}
function runCrash(r, mine) {
  crashRound = r;
  busyNow = true;
  el('cz-go').classList.add('hidden'); el('cz-cash').classList.remove('hidden');
  el('cz-bet').disabled = true; el('cz-cr-auto').disabled = true;
  document.querySelectorAll('[data-cz-bet]').forEach(b => { b.disabled = true; });
  el('cz-cr-sub').textContent = r.auto ? `Auto cash out at ${fmtX(r.auto)}` : '';
  drawCrash(r, 1, 'wait');
  el('cz-cr-num').textContent = '1.00x'; el('cz-cr-num').className = 'cz-cr-num';
  el('cz-cash').textContent = 'Cash out';
  // the server holds this answer until the round ends, then settles it
  const watch = () => call('crash', 'watch', { id: r.id }).then(j => { if (!j.over) return watch(); crashEnded(r, j, mine); }).catch(() => { if (!r.done) setTimeout(watch, 2000); });
  watch();
  const tick = () => {
    if (mine !== live || crashRound !== r) return;
    const t = (Date.now() + r.offset - r.startAt) / 1000;
    if (r.done) return;                      // (crashEnded takes over)
    if (t < 0) { drawCrash(r, 1, 'wait'); el('cz-cr-num').textContent = 'Starting'; requestAnimationFrame(tick); return; }
    const m = Math.exp(r.rate * t);
    drawCrash(r, m, 'up');
    el('cz-cash').textContent = `Cash out ${fmt(Math.min(WIN_MAX, Math.floor(r.bet * Math.floor(m * 100) / 100)))} Orbs`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function crashEnded(r, j, mine) {
  if (r.done) return;
  r.done = true; r.point = j.point; r.at = j.at;
  busyNow = false;
  if (mine !== live) return;
  el('cz-go').classList.remove('hidden'); el('cz-cash').classList.add('hidden');
  el('cz-bet').disabled = false; el('cz-cr-auto').disabled = false;
  document.querySelectorAll('[data-cz-bet]').forEach(b => { b.disabled = false; });
  const paid = j.payout || 0;
  if (paid > 0) {
    result(r.bet, paid, `cashed out at ${fmtX(j.at)}`);
    el('cz-cr-sub').textContent = `Cashed out at ${fmtX(j.at)}`;
    // the line keeps climbing to where it would have crashed
    const after = () => {
      if (mine !== live || crashRound !== r) return;
      const t = (Date.now() + r.offset - r.startAt) / 1000, m = Math.min(r.point, Math.exp(r.rate * Math.max(0, t)));
      if (m < r.point && !calm()) { drawCrash(r, m, 'out'); requestAnimationFrame(after); return; }
      drawCrash(r, r.point, 'crashed');
      el('cz-cr-num').className = 'cz-cr-num win';
      el('cz-cr-num').textContent = fmtX(j.at);
      el('cz-cr-sub').textContent = `Cashed out at ${fmtX(j.at)}. It crashed at ${fmtX(r.point)}.`;
    };
    requestAnimationFrame(after);
  } else {
    drawCrash(r, r.point, 'crashed');
    result(r.bet, 0, `crashed at ${fmtX(j.point)}`);
    el('cz-cr-sub').textContent = j.point <= 1 ? 'Busted right at the start.' : '';
    if (j.point <= 1) egg('onepointoh');
  }
  addRecent('crash', fmtX(j.point), j.point >= 2);
  showTop();
}
function drawCrash(r, m, state) {
  const cv = el('cz-cr-canvas');
  if (!cv) return;
  const W = cv.clientWidth || 600, H = cv.clientHeight || 320, dpr = window.devicePixelRatio || 1;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const rate = r ? r.rate : 0.17, tNow = Math.log(Math.max(1, m)) / rate;
  const tMax = Math.max(8, tNow * 1.15), mMax = Math.max(2, m * 1.2), pad = 36;
  const X = t => pad + (t / tMax) * (W - pad - 12), Y = v => H - pad - ((v - 1) / (mMax - 1)) * (H - pad - 16);
  const css = getComputedStyle(document.documentElement);
  g.strokeStyle = css.getPropertyValue('--divider') || 'rgba(255,255,255,.08)';
  g.fillStyle = css.getPropertyValue('--text-faint') || '#777';
  g.font = '11px Inter, sans-serif';
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = 1 + (mMax - 1) * i / 4, y = Y(v);
    g.beginPath(); g.moveTo(pad, y); g.lineTo(W - 8, y); g.stroke();
    g.fillText(v.toFixed(v < 10 ? 1 : 0) + 'x', 4, y + 4);
  }
  if (state !== 'idle' && state !== 'wait') {
    g.beginPath();
    for (let i = 0; i <= 80; i++) { const t = tNow * i / 80, v = Math.exp(rate * t); i ? g.lineTo(X(t), Y(v)) : g.moveTo(X(t), Y(v)); }
    g.strokeStyle = state === 'crashed' ? '#e5484d' : '#3ddc97';
    g.lineWidth = 3; g.stroke();
  }
  const num = el('cz-cr-num');
  if (num && state !== 'wait') {
    num.textContent = (Math.floor(m * 100) / 100).toFixed(2) + 'x';
    num.className = 'cz-cr-num ' + (state === 'crashed' ? 'lose' : state === 'out' ? 'win' : '');
  }
}

// ---------- Mega Ticket: 1,000 Orbs, drawn 24 hours later, 1 in 100 wins 97,000 ----------
let megaTimer = 0;
function mega() {
  frame('mega', `<div class="cz-stats"><span>Ticket<b>1,000 Orbs</b></span><span>Prize<b>97,000 Orbs</b></span><span>Chance<b>1 in 100</b></span></div>
    <button type="button" class="cz-go" id="cz-go">Buy a ticket</button><div class="cz-hint">One ticket at a time. It's drawn 24 hours after you buy it, and you come back to see if it won.</div>`,
  `<div class="cz-mega" id="cz-mega"></div>`);
  const mine = live;
  const paint = () => {
    clearInterval(megaTimer);
    if (mine !== live || !el('cz-mega')) return;
    const t = casinoRec().mega, box = el('cz-mega');
    el('cz-go').classList.toggle('hidden', !!t);
    if (!t) { box.innerHTML = `<div class="cz-ticket empty">${icon('mega', 54)}<span>No ticket</span></div>`; return; }
    const at = t.at + 86400000;
    const tickNow = () => {
      const left = at - Date.now();
      if (left <= 0) {
        clearInterval(megaTimer);
        box.innerHTML = `<div class="cz-ticket ready">${icon('mega', 54)}<span>Your ticket is ready</span><button type="button" class="cz-go" id="cz-mega-claim">See if it won</button></div>`;
        el('cz-mega-claim').onclick = async () => {
          if (busyNow) return;
          busyNow = true;
          try {
            const j = await call('mega', 'claim');
            if (mine !== live) return;
            box.innerHTML = `<div class="cz-ticket ${j.won ? 'won' : ''}">${icon('mega', 54)}<span>${j.won ? 'It won 97,000 Orbs.' : 'Not this time.'}</span></div>`;
            result(1000, j.payout || 0);
            addRecent('mega', j.won ? 'Won' : 'No', j.won);
            setTimeout(() => { if (mine === live) paint(); }, 2500);
          } catch (x) {} finally { busyNow = false; }
        };
        return;
      }
      const h = Math.floor(left / 3600000), mi = Math.floor(left % 3600000 / 60000), s = Math.floor(left % 60000 / 1000);
      box.innerHTML = `<div class="cz-ticket">${icon('mega', 54)}<span>Drawn in</span><b class="cz-count">${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}</b></div>`;
    };
    tickNow();
    megaTimer = setInterval(() => { if (mine !== live || !el('cz-mega')) { clearInterval(megaTimer); return; } tickNow(); }, 1000);
  };
  el('cz-go').onclick = async () => {
    if (busyNow) return;
    if (balance() < 1000) { toast('You don\'t have enough Orbs for that.', 'error'); return; }
    busyNow = true;
    try {
      const j = await call('mega', 'buy');
      if (mine !== live) return;
      if (typeof myProfile !== 'undefined' && myProfile) myProfile.casino = Object.assign({}, casinoRec(), { mega: j.mega });
      paint();
    } catch (x) {} finally { busyNow = false; }
  };
  paint();
  megaPaint = paint;
}
let megaPaint = null;

// ---------- easter eggs (script.js keeps the list) ----------
function egg(id) { try { if (typeof eggFind === 'function') eggFind(id); } catch (x) {} }

// ---------- opening and leaving ----------
const OPENERS = { crash, mines, towers, cross, hilo, blackjack, roulette, dice, limbo, coinflip, rps, upgrader, plinko, slots, keno, cases, mega };
function openGame(id) {
  if (!OPENERS[id]) { lobby(); return; }
  busyNow = false;
  clearInterval(megaTimer);
  OPENERS[id]();
}
window.openCasino = function () {
  if (!shell()) return;
  if (view !== 'lobby' && OPENERS[view]) openGame(view); else lobby();
};
window.casinoLeave = function () {
  live++;
  clearInterval(megaTimer);
};
window.casinoProfileChanged = function () {
  const v = el('casino-view');
  if (!v || v.classList.contains('hidden')) return;
  showTop();
  if (view === 'mega' && megaPaint && !busyNow) megaPaint();
};
})();
