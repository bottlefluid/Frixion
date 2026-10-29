// Steal a Character: the characters, rarities and mutations, the gear, and the parade on the runway.
// Every character is original: built from blocks by sacchars.js from the look described here.

export const RARITIES = [
  { id: 'common', name: 'Common', color: '#b0bec5', weight: 500 },
  { id: 'uncommon', name: 'Uncommon', color: '#66bb6a', weight: 250 },
  { id: 'rare', name: 'Rare', color: '#42a5f5', weight: 130 },
  { id: 'epic', name: 'Epic', color: '#b05cff', weight: 70 },
  { id: 'legendary', name: 'Legendary', color: '#ffb300', weight: 35 },
  { id: 'mythic', name: 'Mythic', color: '#ff3d71', weight: 13 },
  { id: 'secret', name: 'Secret', color: '#ffffff', weight: 2 },
];
export const RARITY = Object.fromEntries(RARITIES.map(r => [r.id, r]));

// look: body/head/accent colours, a shape (box, round, tall, wide, tiny), a hat, a face and an extra
const C = (id, name, rarity, price, look) => ({ id, name, rarity, price, inc: Math.max(1, Math.round(price / 40)), look });
export const CHARACTERS = [
  C('pebble', 'Pebble Pete', 'common', 25, { body: '#8d939b', head: '#a3a9b1', accent: '#6d737b', shape: 'round', hat: 'none', face: 'sleepy' }),
  C('sock', 'Sock Sam', 'common', 40, { body: '#e53935', head: '#f5f5f5', accent: '#f5f5f5', shape: 'tall', hat: 'ears', face: 'grin' }),
  C('toast', 'Toasty', 'common', 60, { body: '#d9a05b', head: '#e8b974', accent: '#8a5a2b', shape: 'box', hat: 'none', face: 'smile' }),
  C('leafy', 'Leafy Lou', 'common', 75, { body: '#4caf50', head: '#81c784', accent: '#2e7d32', shape: 'box', hat: 'leaf', face: 'smile' }),
  C('carton', 'Carl Carton', 'common', 90, { body: '#b88a5a', head: '#c89a68', accent: '#3d6fd8', shape: 'box', hat: 'cap', face: 'wow' }),
  C('duckling', 'Bath Duck Bo', 'common', 110, { body: '#ffd54f', head: '#ffe082', accent: '#ff8f00', shape: 'round', hat: 'none', face: 'smile' }),
  C('pencil', 'Pencil Pal', 'common', 140, { body: '#fdd835', head: '#f8e9a1', accent: '#f48fb1', shape: 'tall', hat: 'cap', face: 'grin' }),
  C('cactus', 'Cactus Kid', 'uncommon', 300, { body: '#43a047', head: '#66bb6a', accent: '#8d6e63', shape: 'tall', hat: 'tophat', face: 'cool', extra: 'spikes' }),
  C('cupcake', 'Captain Cupcake', 'uncommon', 450, { body: '#f48fb1', head: '#fce4ec', accent: '#e91e63', shape: 'round', hat: 'cap', face: 'grin', extra: 'cape' }),
  C('teapot', 'Teapot Tim', 'uncommon', 650, { body: '#e3f2fd', head: '#ffffff', accent: '#1e88e5', shape: 'round', hat: 'tophat', face: 'smile' }),
  C('snowball', 'Snowball Sid', 'uncommon', 800, { body: '#f5f9ff', head: '#ffffff', accent: '#e53935', shape: 'round', hat: 'none', face: 'grin', extra: 'scarf' }),
  C('jelly', 'Jellybean Jo', 'uncommon', 1000, { body: '#9c27b0', head: '#ce93d8', accent: '#e1bee7', shape: 'tiny', hat: 'antenna', face: 'wow', extra: 'glow' }),
  C('robo', 'Robo Rascal', 'rare', 2500, { body: '#9ea7b3', head: '#cfd8dc', accent: '#00e5ff', shape: 'box', hat: 'antenna', face: 'pixel', extra: 'glow' }),
  C('pickle', 'Pirate Pickle', 'rare', 4000, { body: '#7cb342', head: '#9ccc65', accent: '#d32f2f', shape: 'tall', hat: 'bandana', face: 'angry', extra: 'sword' }),
  C('llama', 'Disco Llama', 'rare', 5500, { body: '#fafafa', head: '#ffffff', accent: '#ff4081', shape: 'tall', hat: 'ears', face: 'cool', extra: 'orbit' }),
  C('ghost', 'Ghosty Gus', 'rare', 8000, { body: '#eceff1', head: '#ffffff', accent: '#90caf9', shape: 'round', hat: 'none', face: 'wow', extra: 'glow' }),
  C('knight', 'Sir Toastalot', 'epic', 18000, { body: '#d9a05b', head: '#e8b974', accent: '#b0bec5', shape: 'box', hat: 'helmet', face: 'angry', extra: 'shield' }),
  C('dragonpup', 'Dragon Pup', 'epic', 26000, { body: '#e53935', head: '#ef5350', accent: '#ffca28', shape: 'wide', hat: 'horns', face: 'grin', extra: 'wings' }),
  C('wizard', 'Wizard Waffle', 'epic', 38000, { body: '#f0b54a', head: '#f6c76c', accent: '#5e35b1', shape: 'box', hat: 'wizard', face: 'cool', extra: 'cape' }),
  C('otter', 'Astro Otter', 'epic', 52000, { body: '#8d6e63', head: '#a1887f', accent: '#eceff1', shape: 'round', hat: 'bubble', face: 'smile', extra: 'backpack' }),
  C('pudding', 'King Pudding', 'legendary', 120000, { body: '#e0a050', head: '#f1c27d', accent: '#ffd54f', shape: 'wide', hat: 'crown', face: 'smile', extra: 'cape' }),
  C('yeti', 'Thunder Yeti', 'legendary', 220000, { body: '#e3f2fd', head: '#ffffff', accent: '#29b6f6', shape: 'wide', hat: 'horns', face: 'angry', extra: 'orbit' }),
  C('ninja', 'Neon Ninja', 'legendary', 380000, { body: '#1a1a24', head: '#262633', accent: '#00ffa3', shape: 'tall', hat: 'band', face: 'cool', extra: 'sword' }),
  C('gecko', 'Galaxy Gecko', 'mythic', 1200000, { body: '#283593', head: '#3949ab', accent: '#b388ff', shape: 'box', hat: 'antenna', face: 'grin', extra: 'tail' }),
  C('phoenix', 'Phoenix Feather', 'mythic', 2500000, { body: '#ff7043', head: '#ffab40', accent: '#ffd740', shape: 'tall', hat: 'halo', face: 'cool', extra: 'wings' }),
  C('golem', 'Crystal Golem', 'mythic', 4000000, { body: '#4dd0e1', head: '#80deea', accent: '#e0f7fa', shape: 'wide', hat: 'none', face: 'angry', extra: 'spikes' }),
  C('pixelprince', 'The Pixel Prince', 'secret', 25000000, { body: '#3d5afe', head: '#ffffff', accent: '#ffd600', shape: 'box', hat: 'crown', face: 'pixel', extra: 'cape' }),
  C('cosmiccat', 'Cosmic Cat', 'secret', 60000000, { body: '#111122', head: '#1d1d33', accent: '#e040fb', shape: 'round', hat: 'ears', face: 'cool', extra: 'orbit' }),
];
export const CHAR = Object.fromEntries(CHARACTERS.map(c => [c.id, c]));

export const MUTATIONS = {
  gold: { id: 'gold', name: 'Golden', mult: 2, color: '#ffcc33', chance: 0.04 },
  diamond: { id: 'diamond', name: 'Diamond', mult: 3, color: '#7df9ff', chance: 0.015 },
  rainbow: { id: 'rainbow', name: 'Rainbow', mult: 5, color: '#ff4fd8', chance: 0.004 },
};
// A character as it is owned: { c: id, m: mutation id or '' }
export const keyOf = (c, m) => (m ? `${c}:${m}` : c);
export const parseKey = k => { const [c, m = ''] = String(k || '').split(':'); return CHAR[c] ? { c, m: MUTATIONS[m] ? m : '' } : null; };
export const nameOf = (c, m) => (m && MUTATIONS[m] ? MUTATIONS[m].name + ' ' : '') + CHAR[c].name;
export const priceOf = (c, m) => CHAR[c].price * (m && MUTATIONS[m] ? MUTATIONS[m].mult : 1);
export const incomeOf = (c, m, rebirths = 0) => CHAR[c].inc * (m && MUTATIONS[m] ? MUTATIONS[m].mult : 1) * (1 + 0.5 * rebirths);

// ---- the runway: one character every 3 seconds, walking end to end. Everyone sees the same parade, picked from the
// slot number, so nothing needs sending. ----
export const RUNWAY = { start: -112, end: 112, speed: 6, every: 3000 };
export const LIFE = (RUNWAY.end - RUNWAY.start) / RUNWAY.speed * 1000;   // how long one is on the runway
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
export function slotChar(slot) {
  const r = rng(slot * 2654435761 + 12345); r(); r();
  const total = RARITIES.reduce((a, x) => a + x.weight, 0);
  let x = r() * total, rar = RARITIES[0];
  for (const q of RARITIES) { if (x < q.weight) { rar = q; break; } x -= q.weight; }
  const pool = CHARACTERS.filter(c => c.rarity === rar.id), c = pool[Math.floor(r() * pool.length)];
  const mr = r();
  const m = mr < MUTATIONS.rainbow.chance ? 'rainbow' : mr < MUTATIONS.rainbow.chance + MUTATIONS.diamond.chance ? 'diamond' : mr < MUTATIONS.rainbow.chance + MUTATIONS.diamond.chance + MUTATIONS.gold.chance ? 'gold' : '';
  return { slot, c: c.id, m };
}

// ---- gear, from the Gear Shop. Consumables come in packs; the rest you keep. ----
export const GEARS = [
  { id: 'bat', name: 'Bonk Bat', price: 500, color: '#a1887f', desc: 'Swing it at a thief: they drop what they took. Knocks anyone back.', cd: 1 },
  { id: 'sneakers', name: 'Speed Sneakers', price: 2000, color: '#29b6f6', desc: 'Run 40% faster while you hold them.', passive: true },
  { id: 'springs', name: 'Spring Boots', price: 3500, color: '#66bb6a', desc: 'Jump almost twice as high while you hold them.', passive: true },
  { id: 'smoke', name: 'Smoke Bomb', price: 5000, color: '#78909c', desc: 'Vanish for 5 seconds. Comes in packs of 3.', pack: 3, cd: 2 },
  { id: 'grapple', name: 'Grapple Gun', price: 7500, color: '#ffa726', desc: 'Pull yourself to wherever you point, up to 60 studs away.', cd: 4 },
  { id: 'trap', name: 'Shock Trap', price: 10000, color: '#ffee58', desc: 'Put one down: whoever steps on it is stunned and drops what they carry. Packs of 3.', pack: 3, cd: 1 },
  { id: 'freeze', name: 'Freeze Ray', price: 15000, color: '#80deea', desc: 'Freeze a player for 3 seconds. They drop what they carry.', cd: 8 },
  { id: 'rocket', name: 'Rocket Pack', price: 25000, color: '#ef5350', desc: 'Hold jump to fly for 3 seconds.', cd: 10 },
];
export const GEAR = Object.fromEntries(GEARS.map(g => [g.id, g]));

// ---- rebirths: start over for good, with more income and more pads ----
export const rebirthCost = n => 1000000 * Math.pow(4, n);
export const padsFor = rebirths => Math.min(16, 8 + rebirths * 2);
export const START_COINS = 100;

// 1,234 and 12,345 as they are; 1.23M, 4.5B and so on from a million up
const UNITS = [['Qi', 1e18], ['Qa', 1e15], ['T', 1e12], ['B', 1e9], ['M', 1e6]];
export const fmt = n => { n = Math.floor(n || 0); if (n < 1e6) return n.toLocaleString('en-US'); for (const [u, v] of UNITS) if (n >= v) return Math.floor(n / v * 100) / 100 + u; return String(n); };
