// casino-fair.js: how the Casino picks every result (v4.67, request 56: Provably Fair). The server plays your bets with
// it (functions/api/admin), and the Casino page uses the very same file to check them, so the two can't disagree.
//
// Every bet's luck comes from three things:
//   - a server seed: 64 hex letters only Frixion's server can make (an HMAC of a secret, your username and the seed's
//     number, so nothing has to be stored and nobody can guess it). Before you bet, you see only its SHA-256, the
//     "fingerprint". When you change seeds, the server shows you the old seed, and anyone can check it has that
//     fingerprint, so it was fixed before your bets.
//   - your client seed: a short text you pick (or the one you were given).
//   - the nonce: 0 for your first bet on a server seed, then 1, 2, 3...
// HMAC-SHA256 (key: the server seed, message: "client seed:nonce") gives 32 bytes; the first 16 start an sfc32
// generator, and each number a game needs (0 up to 1) comes from it in order. Hi-Lo's cards are their own HMACs instead
// ("client seed:nonce:hilo:" and the moves before that card), so a card doesn't depend on which guess you made.
// DRAW turns those numbers into a game's result, the same way for the server and for you.
const te = new TextEncoder();

export async function hmac(keyText, message) {
  const key = await crypto.subtle.importKey('raw', te.encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(message)));
}
export const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(text) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(text)))); }

// the same numbers every time for the same bytes (sfc32), each from 0 up to (not including) 1
export function stream(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, 16);
  let a = v.getUint32(0), b = v.getUint32(4), c = v.getUint32(8), d = v.getUint32(12);
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}
// a bet's numbers, from its server seed, client seed and nonce
export async function fairStream(serverSeed, client, nonce) { return stream(await hmac(serverSeed, `${client}:${nonce}`)); }
// one Hi-Lo card (rank 1 to 13, suit 0 to 3), from the moves before it: '' for the first, then g (a guess) or s (a skip)
export async function hiloCard(serverSeed, client, nonce, before) {
  const h = await hmac(serverSeed, `${client}:${nonce}:hilo:${before}`);
  const x = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
  return { r: 1 + (x % 13), s: h[4] % 4 };
}

export function shuffleWith(r, list) { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; }
export const RTP = 0.97, CRASH_MAX = 1000;
// Crash and Limbo: 0.97 / (1 - u), so it reaches x or more with chance 0.97 / x. Under 1 (3% of rounds) is a 1.00x bust.
export function crashPoint(u) { const x = RTP / (1 - u); return x < 1 ? 1 : Math.min(CRASH_MAX, Math.floor(x * 100) / 100); }
export const SLOT_SYMS = ['cherry', 'lemon', 'grape', 'bell', 'star', 'seven', 'orb'];
export const SLOT_W = [6, 6, 5, 4, 3, 2, 1];

// What each game draws from a bet's numbers (r) and its settings (p). The server pays from these; the page checks them.
export const DRAW = {
  dice: r => Math.floor(r() * 10000),                                      // 0 to 9999, shown as 0.00 to 99.99
  limbo: r => crashPoint(r()),
  coinflip: r => (r() < 0.5 ? 'h' : 't'),
  rps: r => 'rps'[Math.floor(r() * 3)],                                    // the house's pick
  roulette: r => Math.floor(r() * 37),
  slots: r => [0, 1, 2].map(() => { let x = r() * 27; for (let i = 0; i < SLOT_W.length; i++) { x -= SLOT_W[i]; if (x < 0) return SLOT_SYMS[i]; } return SLOT_SYMS[0]; }),
  plinko: (r, p) => Array.from({ length: p.rows }, () => (r() < 0.5 ? 0 : 1)),   // left (0) or right (1) at each row
  keno: r => {
    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    for (let i = 0; i < 10; i++) { const j = i + Math.floor(r() * (40 - i)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, 10);
  },
  cases: (r, p) => {                                                       // which item (p.items: [Orbs, weight])
    let x = r() * p.items.reduce((s, [, w]) => s + w, 0), i = 0;
    for (; i < p.items.length - 1; i++) { x -= p.items[i][1]; if (x < 0) break; }
    return i;
  },
  upgrader: r => r(),                                                      // wins when under 0.97 / the target
  mines: (r, p) => shuffleWith(r, Array.from({ length: 25 }, (_, i) => i)).slice(0, p.m),
  towers: (r, p) => Array.from({ length: p.rows }, () => shuffleWith(r, Array.from({ length: p.cols }, (_, i) => i)).slice(0, p.bad)),
  cross: (r, p) => Array.from({ length: p.lanes }, () => r() >= p.p),      // true: that lane gets you
  blackjack: r => shuffleWith(r, Array.from({ length: 312 }, (_, i) => i % 52)),   // 6 decks; you, dealer, you, dealer, then hits
  crash: r => crashPoint(r() + r() / 4294967296),
  mega: (r, p) => r() < p.chance,
};
