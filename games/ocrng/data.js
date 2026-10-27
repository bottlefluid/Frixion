// Overcontrol RNG: every aura, potion, item and weather, plus the shared clock (day/night, weather, the Jester).
// Inspired by Sol's RNG on Roblox. All art here is our own; rarities are "1 in N".

// ---------------- rarity tiers (what colour a roll flashes, how big the reveal is) ----------------
export const TIERS = [
  { id: 'basic', min: 1, color: '#d6dbe4', label: 'Basic' },
  { id: 'epic', min: 1000, color: '#a77bff', label: 'Epic' },
  { id: 'unique', min: 10000, color: '#ffcf4a', label: 'Unique' },
  { id: 'legendary', min: 100000, color: '#3ee0ff', label: 'Legendary' },
  { id: 'mythic', min: 1000000, color: '#ff4fd8', label: 'Mythic' },
  { id: 'exalted', min: 10000000, color: '#5b8cff', label: 'Exalted' },
  { id: 'glorious', min: 100000000, color: '#ff4040', label: 'Glorious' },
  { id: 'transcendent', min: 1000000000, color: '#ffffff', label: 'Transcendent' },
];
export const tierOf = rarity => { let t = TIERS[0]; for (const x of TIERS) if (rarity >= x.min) t = x; return t; };
export const tierIndex = rarity => TIERS.indexOf(tierOf(rarity));

// ---------------- aura effect layers (drawn by avatar.js) ----------------
const L = {
  glow: (c, s = 4, o = {}) => ({ t: 'glow', c, s, ...o }),
  motes: (c, n = 24, o = {}) => ({ t: 'motes', c, n, ...o }),
  orbit: (c, n = 3, o = {}) => ({ t: 'orbit', c, n, ...o }),
  ring: (c, o = {}) => ({ t: 'ring', c, ...o }),
  halo: (c, o = {}) => ({ t: 'halo', c, ...o }),
  pillar: (c, o = {}) => ({ t: 'pillar', c, ...o }),
  crystals: (c, n = 4, o = {}) => ({ t: 'crystals', c, n, ...o }),
  wings: (c, o = {}) => ({ t: 'wings', c, ...o }),
  flames: (c, c2, o = {}) => ({ t: 'flames', c, c2, ...o }),
  fall: (c, o = {}) => ({ t: 'fall', c, ...o }),
  sparkle: (c, o = {}) => ({ t: 'sparkle', c, ...o }),
  spiral: (c, o = {}) => ({ t: 'spiral', c, ...o }),
  cubes: (c, n = 6, o = {}) => ({ t: 'cubes', c, n, ...o }),
  bolts: (c, o = {}) => ({ t: 'bolts', c, ...o }),
  rainbow: (o = {}) => ({ t: 'rainbow', ...o }),
  yinyang: (o = {}) => ({ t: 'yinyang', ...o }),
};

// id, name, 1-in-N, main colour, effect layers, only: { time: 'day'|'night', weather }, title: how the name looks over your head
const A = (id, name, rarity, c, fx, only = null, title = {}) => ({ id, name, rarity, c, fx, only, title });

export const AURAS = [
  A('common', 'Common', 2, '#c9ced6', [L.motes('#c9ced6', 10, { size: 0.35 })]),
  A('uncommon', 'Uncommon', 4, '#9be58a', [L.motes('#9be58a', 14)]),
  A('good', 'Good', 5, '#79a8ff', [L.motes('#79a8ff', 16), L.glow('#79a8ff', 3)]),
  A('natural', 'Natural', 8, '#5fc35a', [L.fall('#7ccf5a', { n: 18, leaf: 1 }), L.glow('#3e9b43', 3)]),
  A('rare', 'Rare', 16, '#3f6bff', [L.motes('#3f6bff', 22), L.ring('#2f5bff', { r: 1.6 })]),
  A('divinus', 'Divinus', 32, '#fff2b3', [L.halo('#fff2b3'), L.motes('#ffe680', 20)]),
  A('crystallized', 'Crystallized', 64, '#9ff3ff', [L.crystals('#9ff3ff', 4), L.glow('#7fe8ff', 3)]),
  A('rage', 'Rage', 128, '#ff3b30', [L.flames('#ff3b30', '#ff9f0a'), L.glow('#ff3b30', 3)]),
  A('topaz', 'Topaz', 150, '#ffb347', [L.crystals('#ffb347', 3, { size: 0.35 }), L.sparkle('#ffd27f')]),
  A('ruby', 'Ruby', 350, '#e0115f', [L.crystals('#e0115f', 5), L.glow('#e0115f', 4)]),
  A('forbidden', 'Forbidden', 403, '#38c172', [L.spiral('#38c172'), L.glow('#0b3d20', 4, { dark: 1 })]),
  A('emerald', 'Emerald', 500, '#2ecc71', [L.crystals('#2ecc71', 6), L.ring('#2ecc71')]),
  A('gilded', 'Gilded', 512, '#ffcc33', [L.sparkle('#ffd966', { n: 40 }), L.halo('#ffcc33')]),
  A('ink', 'Ink', 700, '#5b2d8f', [L.motes('#2a0f45', 30, { dark: 1 }), L.fall('#1a0a2e', { drip: 1, dark: 1 })]),
  A('jackpot', 'Jackpot', 777, '#ffd700', [L.orbit('#ffd700', 7, { size: 0.3 }), L.sparkle('#fff4a3')], null, { gold: 1 }),
  A('sapphire', 'Sapphire', 800, '#2f6bff', [L.crystals('#0f52ba', 5), L.glow('#3d7bff', 4)]),
  A('aquamarine', 'Aquamarine', 900, '#7fffd4', [L.spiral('#7fffd4'), L.ring('#58e8c6')]),
  A('wind', 'Wind', 1000, '#e8fbff', [L.spiral('#e8fbff', { wide: 1, fast: 1, n: 50 })]),
  A('diaboli', 'Diaboli', 1004, '#ff2a2a', [L.flames('#8b0000', '#ff2a00'), L.halo('#ff0000', { horns: 1 })]),
  A('precious', 'Precious', 1024, '#ff7eb6', [L.crystals('#ff7eb6', 6, { size: 0.3 }), L.sparkle('#ffd1e6')]),
  A('magnetic', 'Magnetic', 2048, '#6f95ff', [L.orbit('#ff4d4d', 2, { r: 1.9 }), L.orbit('#4d7cff', 2, { r: 1.9, phase: Math.PI / 2 }), L.bolts('#bcd3ff')]),
  A('flutter', 'Flutter', 2222, '#ff9ff3', [L.orbit('#ff9ff3', 5, { r: 2.2, bob: 1, size: 0.22 }), L.sparkle('#ffd6f7')]),
  A('sidereum', 'Sidereum', 4096, '#7aa2ff', [L.sparkle('#cfe0ff', { n: 50 }), L.orbit('#5b8cff', 3)]),
  A('bleeding', 'Bleeding', 4444, '#d1102e', [L.fall('#b3001b', { drip: 1 }), L.glow('#b3001b', 4)]),
  A('solar', 'Solar', 5000, '#ffb000', [L.ring('#ffb000', { r: 2.2, rays: 1 }), L.glow('#ffd54a', 5), L.motes('#ffcf5a', 24)], { time: 'day' }, { gold: 1 }),
  A('lunar', 'Lunar', 5000, '#c9d6ff', [L.halo('#e8eeff', { r: 0.9 }), L.glow('#9fb4ff', 5), L.sparkle('#ffffff')], { time: 'night' }),
  A('starlight', 'Starlight', 6000, '#a8c7ff', [L.sparkle('#ffffff', { n: 60 }), L.spiral('#a8c7ff')]),
  A('frostbite', 'Frostbite', 8000, '#bfefff', [L.fall('#ffffff', { n: 40 }), L.crystals('#bfefff', 4)], { weather: 'snow' }),
  A('stormal', 'Stormal', 9000, '#8f9fff', [L.bolts('#d6dcff'), L.fall('#9fb3ff', { rain: 1, n: 40 })], { weather: 'rain' }),
  A('undead', 'Undead', 12000, '#5bff6a', [L.flames('#2bff66', '#0a3311'), L.halo('#5bff6a')], { weather: 'hell' }),
  A('corrosive', 'Corrosive', 12000, '#b6ff00', [L.motes('#b6ff00', 40), L.spiral('#6b8f00')]),
  A('comet', 'Comet', 20000, '#7fd1ff', [L.orbit('#bfe8ff', 1, { trail: 1, r: 2.4, size: 0.35 }), L.sparkle('#ffffff')], { time: 'night' }),
  A('jade', 'Jade', 25000, '#00c07a', [L.crystals('#00a86b', 8), L.halo('#00e08f')]),
  A('spectre', 'Spectre', 30000, '#d0d0ff', [L.motes('#d0d0ff', 40, { size: 0.7 }), L.glow('#8080ff', 4)]),
  A('aether', 'Aether', 40000, '#fff8e1', [L.wings('#fff8e1'), L.halo('#ffe9a6')], { weather: 'heaven' }),
  A('nullified', 'Nullified', 50000, '#bdbdbd', [L.cubes('#ffffff', 8), L.cubes('#111111', 8, { dark: 1 })], { weather: 'null' }),
  A('seraphim', 'Seraphim', 80000, '#ffe082', [L.wings('#ffe082', { big: 1 }), L.pillar('#fff3c4'), L.halo('#ffd54f')], { weather: 'heaven' }),
  A('exotic', 'Exotic', 99999, '#ff3dff', [L.rainbow({ n: 40 }), L.ring('#ff00ff')], null, { rainbow: 1 }),
  A('chromatic', 'Chromatic', 200000, '#ff4da6', [L.rainbow({ n: 60, orbit: 1 }), L.halo('#ffffff')], null, { rainbow: 1 }),
  A('celestial', 'Celestial', 350000, '#ffe9a8', [L.wings('#fff6d5'), L.sparkle('#fff3b0', { n: 60 }), L.pillar('#ffe9a8')], null, { gold: 1 }),
  A('galaxy', 'Galaxy', 500000, '#8a63ff', [L.spiral('#a07bff', { n: 80, galaxy: 1 }), L.sparkle('#ffffff', { n: 40 }), L.glow('#2a0f6b', 6)]),
  A('solaris', 'Solaris', 500000, '#ff8a00', [L.ring('#ff7a00', { r: 3, rays: 1 }), L.flames('#ffd000', '#ff4500'), L.pillar('#ffae00')], { weather: 'solar' }, { gold: 1 }),
  A('arcane', 'Arcane', 1000000, '#5c77ff', [L.ring('#3d5afe', { r: 2.6, runes: 1 }), L.orbit('#8c9eff', 4), L.pillar('#536dfe')]),
  A('eclipse', 'Eclipse', 2000000, '#ff9100', [L.halo('#ff9100', { r: 1.2, eclipse: 1 }), L.ring('#ff9100', { r: 2.8 }), L.motes('#ff6d00', 40)], { time: 'night' }),
  A('matrix', 'Matrix', 3000000, '#00ff41', [L.fall('#00ff41', { code: 1, n: 60 }), L.cubes('#00ff41', 10)], { weather: 'null' }),
  A('hades', 'Hades', 6666666, '#9b4dff', [L.flames('#7b00ff', '#1a0033', { big: 1 }), L.orbit('#b388ff', 6), L.pillar('#4b0082')], { weather: 'hell' }),
  A('overseer', 'Overseer', 45000000, '#00e5ff', [L.halo('#00e5ff', { eye: 1 }), L.orbit('#00e5ff', 8, { r: 3 }), L.pillar('#00b8d4'), L.sparkle('#e0f7fa')]),
  A('bloodlust', 'Bloodlust', 50000000, '#ff1744', [L.flames('#ff1744', '#4a0000', { big: 1 }), L.wings('#b71c1c', { big: 1 }), L.orbit('#ff5252', 5)], { weather: 'hell' }),
  A('sovereign', 'Sovereign', 100000000, '#ffd700', [L.halo('#ffd700', { crown: 1 }), L.wings('#fff1a8', { big: 1 }), L.pillar('#ffd700'), L.sparkle('#fffde7', { n: 80 })], null, { gold: 1 }),
  A('archangel', 'Archangel', 250000000, '#ffffff', [L.wings('#ffffff', { big: 1, many: 1 }), L.halo('#fff9c4'), L.pillar('#ffffff', { tall: 1 }), L.motes('#fff59d', 60)], { weather: 'heaven' }),
  A('overcontrol', 'OVERCONTROL', 777777777, '#9c6bff', [L.orbit('#c4b5ff', 8, { r: 3.2, trail: 1 }), L.ring('#8b5cff', { r: 3.4, runes: 1 }), L.pillar('#7c4dff', { tall: 1 }), L.spiral('#b39dff', { n: 100 }), L.bolts('#e1d6ff')], null, { violet: 1 }),
  A('equinox', '『EQUINOX』', 2500000000, '#ffffff', [L.yinyang({ r: 2.4 }), L.ring('#ffffff', { r: 3, half: 1 }), L.motes('#ffffff', 30), L.motes('#000000', 30, { dark: 1 })], null, { bw: 1 }),
  A('equilibrium', '『EQUILIBRIUM INCARNATE』', 10000000000, '#ffffff', [L.yinyang({ r: 3, many: 1, big: 1 }), L.ring('#ffffff', { r: 3.8, half: 1, runes: 1 }), L.pillar('#ffffff', { tall: 1, split: 1 }), L.spiral('#ffffff', { n: 90, bw: 1 })], null, { bw: 1 }),
];
export const AURA = Object.fromEntries(AURAS.map(a => [a.id, a]));
export const AURAS_RAREST_FIRST = [...AURAS].sort((a, b) => b.rarity - a.rarity);

// ---------------- mutations: a rare twist on a rolled aura, which multiplies its rarity ----------------
export const MUTATIONS = {
  shiny: { id: 'shiny', name: 'Shiny', mult: 5, color: '#ffe066' },
  corrupted: { id: 'corrupted', name: 'Corrupted', mult: 12, color: '#b14dff' },
  glitched: { id: 'glitched', name: 'Glitched', mult: 25, color: '#00ffd0' },
};
// "ruby" or "ruby:shiny" -> { aura, mut, rarity, name }
export function auraKey(key) {
  const [id, m] = String(key || 'common').split(':');
  const aura = AURA[id] || AURA.common, mut = MUTATIONS[m] || null;
  return { key: mut ? `${aura.id}:${mut.id}` : aura.id, aura, mut, rarity: aura.rarity * (mut ? mut.mult : 1), name: mut ? `${mut.name} ${aura.name}` : aura.name };
}

// ---------------- rolling ----------------
// Rarest first: each aura you could get right now succeeds with luck / rarity. If none do, you get Common.
export function rollAura(luck, time, weather, rand = Math.random) {
  let got = AURA.common;
  for (const a of AURAS_RAREST_FIRST) {
    if (a.id === 'common') continue;
    if (a.only && ((a.only.time && a.only.time !== time) || (a.only.weather && a.only.weather !== weather))) continue;
    if (rand() < luck / a.rarity) { got = a; break; }
  }
  // Auras rarer than 1 in 1,000 sometimes mutate.
  let mut = null;
  if (got.rarity >= 1000) {
    const r = rand();
    if (weather === 'null' && r < 1 / 20) mut = 'glitched';
    else if (r < 1 / 80) mut = 'corrupted';
    else if (r < 1 / 80 + 1 / 30) mut = 'shiny';
  }
  return auraKey(mut ? `${got.id}:${mut}` : got.id);
}
// Coins for a roll: rarer pays more.
export const coinsFor = rarity => Math.max(1, Math.ceil(Math.sqrt(rarity)));

// ---------------- potions ----------------
// luck/speed: added as a share (+1 = +100%). secs: how long it lasts. oneRoll: luck added to your next roll only.
// group: only one level of a group at a time (Fortune, Haste). price: what the shop asks (coins, F, or Void Coins).
export const POTIONS = [
  { id: 'lucky', name: 'Lucky Potion', color: '#3ddc84', luck: 1, secs: 180, price: { coins: 300 }, desc: '+100% luck for 3 minutes.' },
  { id: 'speed', name: 'Speed Potion', color: '#4fc3ff', speed: 0.25, secs: 180, price: { coins: 300 }, desc: '+25% roll speed for 3 minutes.' },
  { id: 'fortune1', name: 'Fortune Potion I', color: '#ffd54a', luck: 0.5, secs: 300, group: 'fortune', level: 1, price: { coins: 900 }, desc: '+50% luck for 5 minutes.' },
  { id: 'fortune2', name: 'Fortune Potion II', color: '#ffc21a', luck: 0.75, secs: 300, group: 'fortune', level: 2, price: { coins: 2500 }, desc: '+75% luck for 5 minutes.' },
  { id: 'fortune3', name: 'Fortune Potion III', color: '#ffab00', luck: 1, secs: 300, group: 'fortune', level: 3, price: { coins: 6000 }, desc: '+100% luck for 5 minutes.' },
  { id: 'haste1', name: 'Haste Potion I', color: '#80d8ff', speed: 0.5, secs: 300, group: 'haste', level: 1, price: { coins: 900 }, desc: '+50% roll speed for 5 minutes.' },
  { id: 'haste2', name: 'Haste Potion II', color: '#40c4ff', speed: 0.75, secs: 300, group: 'haste', level: 2, price: { coins: 2500 }, desc: '+75% roll speed for 5 minutes.' },
  { id: 'haste3', name: 'Haste Potion III', color: '#00b0ff', speed: 1, secs: 300, group: 'haste', level: 3, price: { coins: 6000 }, desc: '+100% roll speed for 5 minutes.' },
  { id: 'warp', name: 'Warp Potion', color: '#7c4dff', speed: 3, secs: 60, price: { f: 350 }, desc: '+300% roll speed for 1 minute.' },
  { id: 'diver', name: 'Diver Potion', color: '#26c6da', fish: 1, secs: 300, price: { f: 90 }, desc: 'Fish bite twice as fast for 5 minutes.' },
  { id: 'heavenly1', name: 'Heavenly Potion I', color: '#fff3b0', oneRoll: 15000, price: { coins: 150000 }, desc: '+1,500,000% luck for your next roll.' },
  { id: 'heavenly2', name: 'Heavenly Potion II', color: '#ffe57f', oneRoll: 150000, price: { coins: 1500000 }, desc: '+15,000,000% luck for your next roll.' },
  { id: 'godlike', name: 'Godlike Potion', color: '#ff80ab', oneRoll: 400000, price: { f: 4000 }, desc: '+40,000,000% luck for your next roll.' },
  { id: 'oblivion', name: 'Oblivion Potion', color: '#3a0f6b', oneRoll: 1000000, jester: true, price: { void: 5 }, desc: '+1,000,000 luck for your next roll. Only the Jester has these.' },
];
export const POTION = Object.fromEntries(POTIONS.map(p => [p.id, p]));

// ---------------- items (gear works while you own it; Void Coins are a currency) ----------------
export const ITEMS = [
  { id: 'gloves', name: 'Lucky Gloves', color: '#66bb6a', luck: 0.25, price: { coins: 25000 }, desc: '+25% luck, always.' },
  { id: 'boots', name: 'Swift Boots', color: '#42a5f5', speed: 0.15, price: { coins: 25000 }, desc: '+15% roll speed, always.' },
  { id: 'solarlens', name: 'Solar Lens', color: '#ffb300', luck: 0.3, when: 'day', price: { coins: 60000 }, desc: '+30% luck during the day.' },
  { id: 'moonlocket', name: 'Moon Locket', color: '#9fa8da', luck: 0.3, when: 'night', price: { coins: 60000 }, desc: '+30% luck at night.' },
  { id: 'goldrod', name: 'Golden Rod', color: '#ffd54f', fish: 0.5, price: { f: 400 }, desc: 'Fish bite 50% faster and you catch more F.' },
  { id: 'voidlantern', name: 'Void Lantern', color: '#7e57c2', voidLuck: 1, price: { f: 2500 }, desc: 'Void Coins turn up twice as often when fishing.' },
];
export const ITEM = Object.fromEntries(ITEMS.map(i => [i.id, i]));

// ---------------- weather ----------------
export const WEATHERS = {
  clear: { id: 'clear', name: 'Clear', icon: '☀', desc: 'A calm day in the lobby.' },
  rain: { id: 'rain', name: 'Rain', icon: '🌧', desc: 'Stormal can only be rolled in the rain.' },
  snow: { id: 'snow', name: 'Snow', icon: '❄', desc: 'Frostbite can only be rolled in the snow.' },
  hell: { id: 'hell', name: 'Hell', icon: '🔥', desc: 'Undead, Hades and Bloodlust rise from Hell.' },
  heaven: { id: 'heaven', name: 'Heaven', icon: '✨', desc: 'Aether, Seraphim and Archangel come down from Heaven.' },
  null: { id: 'null', name: 'Null', icon: '◼', desc: 'Nothing is real. Nullified and Matrix, and auras glitch more often.' },
  solar: { id: 'solar', name: 'Solar', icon: '🌞', desc: 'A blazing sun. Solaris can only be rolled now.' },
};

// ---------------- the shared clock: everyone sees the same time, weather and Jester ----------------
export const DAY_MS = 10 * 60 * 1000;              // day and night swap every 10 minutes
export const WEATHER_SLOT_MS = 8 * 60 * 1000;      // a weather can start every 8 minutes
export const WEATHER_LEN_MS = 5 * 60 * 1000;       // and lasts 5
export const JESTER_EVERY_MS = 4 * 60 * 60 * 1000; // the Jester visits every 4 hours
export const JESTER_STAYS_MS = 15 * 60 * 1000;     // for 15 minutes
function hash01(n) { let t = (n * 2654435761) >>> 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
// world: what staff have forced from the admin panel ({ time: { mode, until }, weather: { type, until }, jesterUntil })
export function timeOfDay(now, world = {}) {
  if (world.time && world.time.until > now) return world.time.mode;
  return Math.floor(now / DAY_MS) % 2 ? 'night' : 'day';
}
// 0..1: how far into the current day or night (for the sun and moon)
export const dayProgress = now => (now % DAY_MS) / DAY_MS;
export function weatherAt(now, world = {}) {
  if (world.weather && world.weather.until > now) return world.weather.type;
  const slot = Math.floor(now / WEATHER_SLOT_MS);
  if (now - slot * WEATHER_SLOT_MS > WEATHER_LEN_MS) return 'clear';
  const r = hash01(slot + 7);
  const w = r < 0.5 ? 'clear' : r < 0.65 ? 'rain' : r < 0.75 ? 'snow' : r < 0.82 ? 'solar' : r < 0.88 ? 'hell' : r < 0.94 ? 'heaven' : 'null';
  return w === 'solar' && timeOfDay(now, world) === 'night' ? 'rain' : w;
}
export function jesterHere(now, world = {}) {
  return (world.jesterUntil || 0) > now || now % JESTER_EVERY_MS < JESTER_STAYS_MS;
}
export const nextJesterIn = now => JESTER_EVERY_MS - (now % JESTER_EVERY_MS);

// ---------------- formatting ----------------
export function fmt(n) {
  if (n === Infinity) return '∞';
  if (n >= 1e15) return n.toExponential(2).replace('e+', 'e');
  return Math.floor(n).toLocaleString('en-US');
}
export function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
}
