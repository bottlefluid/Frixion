// Overcontrol RNG: every aura, potion, item and weather, plus the shared clock (day/night, weather, the Jester).
// Inspired by Sol's RNG on Roblox. All art here is our own; rarities are "1 in N".

// ---------------- Zalgo text: letters buried under stacks of combining marks ----------------
const ZALGO_UP = [...'̍̎̄̅̿̑̆̐͒͗͑̇̈̊͂̓̈́͊͋͌̃̂̌͐̀́̋̏̒̓̔̽̉ͣͤͥͦͧͨͩͪͫͬͭͮͯ̾͛͆̚'];
const ZALGO_MID = [...'̴̵̶̸̷̡̢̧̨̛̀́̕͘͜͟͢͝͞͠͡'];
const ZALGO_DOWN = [...'̖̗̘̙̜̝̞̟̠̤̥̦̩̪̫̬̭̮̯̰̱̲̳̹̺̻̼͇͈͉͍͎͓͔͕͖͙͚̣ͅ'];
export function zalgo(text, rand = Math.random) {
  const pick = list => list[Math.floor(rand() * list.length)];
  let out = '';
  for (const ch of text) {
    out += ch;
    for (let i = 2 + Math.floor(rand() * 4); i > 0; i--) out += pick(ZALGO_UP);
    for (let i = Math.floor(rand() * 2); i > 0; i--) out += pick(ZALGO_MID);
    for (let i = 2 + Math.floor(rand() * 4); i > 0; i--) out += pick(ZALGO_DOWN);
  }
  return out;
}
const fixedRand = seed => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// ---------------- rarity tiers (what colour a roll flashes, how big the reveal is) ----------------
// Cataclysmic and Primordial are gradients (see .oc-tier in ocrng.css); color is the gradient's end.
export const TIERS = [
  { id: 'mundane', min: 1, color: '#ffffff', label: 'Mundane' },
  { id: 'shadowed', min: 1000, color: '#383838', label: 'Shadowed' },
  { id: 'anomalous', min: 10000, color: '#8a66de', label: 'Anomalous' },
  { id: 'forbidden', min: 100000, color: '#3f62d8', label: 'Forbidden' },
  { id: 'eldritch', min: 1000000, color: '#006300', label: 'Eldritch' },
  { id: 'cataclysmic', min: 10000000, color: '#751006', label: 'Cataclysmic' },
  { id: 'primordial', min: 100000000, color: '#c5aef2', label: 'Primordial' },
  { id: 'null', min: 1000000000, color: '#ff1f1f', label: zalgo('null', fixedRand(1337)) },   // red and black, and the letters keep glitching in the game
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
  A('forbidden', 'Forsaken', 403, '#38c172', [L.spiral('#38c172'), L.glow('#0b3d20', 4, { dark: 1 })]),
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
  // ---- added in the second wave ----
  A('flora', 'Flora', 10, '#8be07a', [L.fall('#ff9ecf', { n: 16, leaf: 1 }), L.motes('#b6f08f', 10)]),
  A('honey', 'Honey', 25, '#ffb300', [L.fall('#ffb300', { drip: 1, n: 14 }), L.glow('#ffca28', 3)]),
  A('quartz', 'Quartz', 48, '#f2f2f2', [L.crystals('#f5f5f5', 4, { size: 0.26 }), L.sparkle('#ffffff', { n: 20 })]),
  A('ember', 'Ember', 90, '#ff7a2f', [L.flames('#ff9a3c', '#7a1f00', { n: 30 }), L.motes('#ffb06b', 12)]),
  A('glacier', 'Glacier', 220, '#9fe3ff', [L.crystals('#bdeeff', 6, { size: 0.3 }), L.ring('#9fe3ff', { r: 1.8 })]),
  A('velvet', 'Velvet', 600, '#b0123a', [L.motes('#c2185b', 28), L.ring('#7f0f2b', { r: 2 })]),
  A('hazard', 'Hazard', 1200, '#ffd000', [L.cubes('#ffd000', 6), L.cubes('#111111', 6, { dark: 1 }), L.ring('#ffd000', { r: 2.2, runes: 1 })]),
  A('echo', 'Echo', 1500, '#7fd8ff', [L.ring('#7fd8ff', { r: 1.6 }), L.ring('#c9f0ff', { r: 2.8 }), L.motes('#7fd8ff', 16)]),
  A('static', 'Static', 2600, '#eef2ff', [L.bolts('#ffffff'), L.bolts('#9fb4ff'), L.sparkle('#ffffff', { n: 24 })]),
  A('raven', 'Raven', 3300, '#6b6f80', [L.fall('#151515', { dark: 1, leaf: 1, n: 26 }), L.glow('#20202a', 4, { dark: 1 }), L.wings('#3a3d4a')]),
  A('twilight', 'Twilight', 7000, '#c77dff', [L.spiral('#ff9e7a', { n: 40 }), L.spiral('#9d4edd', { n: 40, wide: 1 }), L.glow('#7b2cbf', 4)], { time: 'night' }),
  A('blizzard', 'Blizzard', 15000, '#e3f6ff', [L.fall('#ffffff', { n: 70 }), L.spiral('#cfefff', { fast: 1, wide: 1, n: 50 }), L.crystals('#e3f6ff', 5)], { weather: 'snow' }),
  A('lostsoul', 'Lost Soul', 18000, '#6fb7ff', [L.motes('#6fb7ff', 40, { size: 0.6 }), L.orbit('#cfe7ff', 3, { bob: 1, r: 2.2 }), L.glow('#1e4b8f', 5)]),
  A('kyawthuite', 'Kyawthuite', 40000, '#ff5f7e', [L.crystals('#ff5f7e', 8, { size: 0.32 }), L.sparkle('#ffd0da', { n: 40 }), L.halo('#ff5f7e')]),
  A('tempest', 'Tempest', 65000, '#8aa8ff', [L.bolts('#e6ecff'), L.bolts('#8aa8ff'), L.spiral('#8aa8ff', { fast: 1, n: 60 }), L.fall('#aebfff', { rain: 1, n: 40 })], { weather: 'rain' }),
  A('phantom', 'Phantom', 120000, '#c8d0ff', [L.wings('#c8d0ff'), L.motes('#e8ebff', 40, { size: 0.6 }), L.glow('#6a72c9', 5)]),
  A('aurora', 'Aurora', 250000, '#7dffcf', [L.rainbow({ n: 60, orbit: 1 }), L.spiral('#7dffcf', { n: 50, wide: 1 }), L.halo('#b8ffe8')], { time: 'night' }, { rainbow: 1 }),
  A('nebula', 'Nebula', 750000, '#ff6ad5', [L.spiral('#ff6ad5', { n: 90, galaxy: 1 }), L.sparkle('#ffffff', { n: 50 }), L.glow('#5b1a7a', 6)]),
  A('prism', 'Prism', 1500000, '#ffffff', [L.crystals('#ffffff', 8, { size: 0.36 }), L.rainbow({ n: 50 }), L.ring('#ffffff', { r: 2.6, rays: 1 })], null, { rainbow: 1 }),
  A('leviathan', 'Leviathan', 4000000, '#2f6dff', [L.orbit('#5d8bff', 1, { trail: 1, r: 3, size: 0.5 }), L.orbit('#1a3fa8', 1, { trail: 1, r: 2.2, size: 0.4, phase: Math.PI }), L.fall('#7fb0ff', { drip: 1, n: 30 }), L.glow('#0d2a6b', 6)]),
  A('dawnbreaker', 'Dawnbreaker', 12000000, '#ffcc4d', [L.pillar('#ffd77a', { tall: 1 }), L.ring('#ffcc4d', { r: 3.2, rays: 1 }), L.wings('#fff0c2', { big: 1 }), L.sparkle('#fff6d8', { n: 60 })], { time: 'day' }, { gold: 1 }),
  A('requiem', 'Requiem', 25000000, '#e6e6e6', [L.halo('#ffffff', { crown: 1 }), L.motes('#ffffff', 40), L.motes('#000000', 40, { dark: 1 }), L.wings('#9a9a9a', { big: 1 })], null, { bw: 1 }),
  A('starscourge', 'Starscourge', 80000000, '#ff3b3b', [L.sparkle('#ffffff', { n: 80 }), L.orbit('#ff3b3b', 6, { r: 3, trail: 1 }), L.pillar('#ff2a2a'), L.bolts('#ff8a8a')]),
  A('paradox', 'Paradox', 150000000, '#00ffd0', [L.cubes('#00ffd0', 12), L.cubes('#ff00aa', 12), L.ring('#ffffff', { r: 3, runes: 1, half: 1 }), L.bolts('#00ffd0')], { weather: 'null' }),
  A('singularity', 'Singularity', 600000000, '#7c4dff', [L.spiral('#b39dff', { n: 120, galaxy: 1 }), L.glow('#0a0014', 5, { dark: 1 }), L.ring('#7c4dff', { r: 3.6, runes: 1 }), L.pillar('#4527a0', { tall: 1 })], null, { violet: 1 }),
  A('genesis', 'GENESIS', 1500000000, '#fff4d6', [L.wings('#fff4d6', { big: 1, many: 1 }), L.pillar('#ffffff', { tall: 1 }), L.ring('#ffd77a', { r: 3.8, runes: 1, rays: 1 }), L.sparkle('#fffbe6', { n: 90 }), L.halo('#ffe9a6', { crown: 1 })], null, { gold: 1 }),
];
// Gem auras: the Jewelry Potion makes these more likely.
export const GEM_AURAS = new Set(['crystallized', 'topaz', 'ruby', 'emerald', 'sapphire', 'aquamarine', 'precious', 'jade', 'quartz', 'glacier', 'kyawthuite', 'prism']);
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
// opts.gem: extra luck multiplier for gem auras (Jewelry Potion). opts.mut: how many times more often auras mutate.
export function rollAura(luck, time, weather, opts = {}, rand = Math.random) {
  let got = AURA.common;
  const gem = opts.gem || 1, mm = opts.mut || 1;
  for (const a of AURAS_RAREST_FIRST) {
    if (a.id === 'common') continue;
    if (a.only && ((a.only.time && a.only.time !== time) || (a.only.weather && a.only.weather !== weather))) continue;
    if (rand() < (GEM_AURAS.has(a.id) ? luck * gem : luck) / a.rarity) { got = a; break; }
  }
  // Auras rarer than 1 in 1,000 sometimes mutate.
  let mut = null;
  if (got.rarity >= 1000) {
    const r = rand();
    if (weather === 'null' && r < mm / 20) mut = 'glitched';
    else if (r < mm / 80) mut = 'corrupted';
    else if (r < mm * (1 / 80 + 1 / 30)) mut = 'shiny';
  }
  return auraKey(mut ? `${got.id}:${mut}` : got.id);
}
// Coins for a roll: rarer pays more.
export const coinsFor = rarity => Math.max(1, Math.ceil(Math.sqrt(rarity)));

// ---------------- potions ----------------
// Effects (shares are added: +1 = +100%):
//   luck, speed         while it lasts (secs)
//   wLuck {w, l}        luck only in that weather       tLuck {t, l}  luck only by day or at night
//   gem                 gem auras this many times more likely (Jewelry Potion)
//   coin                more coins from rolls            mut          auras mutate this many times more often
//   fish, fishLuck      fish bite faster / rarer fish bite
//   oneRoll             luck added to your next roll     rolls {n, l, x}  the next n rolls get +l luck (or x times luck)
//   mixed               a random timed effect
// group: only one level at a time (Fortune, Haste). price: coins, f (blue coins) or void (Void Coins).
const P = (id, name, color, fx, price, desc) => ({ id, name, color, ...fx, price, desc });
export const POTIONS = [
  P('lucky', 'Lucky Potion', '#3ddc84', { luck: 1, secs: 180 }, { coins: 300 }, '+100% luck for 3 minutes.'),
  P('speed', 'Speed Potion', '#4fc3ff', { speed: 0.25, secs: 180 }, { coins: 300 }, '+25% roll speed for 3 minutes.'),
  P('clover', 'Clover Elixir', '#7cd67a', { luck: 0.25, secs: 1800 }, { coins: 1200 }, '+25% luck for 30 minutes.'),
  P('sprint', 'Sprint Tonic', '#6ec6ff', { speed: 0.25, secs: 1800 }, { coins: 1200 }, '+25% roll speed for 30 minutes.'),
  P('fortune1', 'Fortune Potion I', '#ffd54a', { luck: 0.5, secs: 300, group: 'fortune', level: 1 }, { coins: 900 }, '+50% luck for 5 minutes.'),
  P('fortune2', 'Fortune Potion II', '#ffc21a', { luck: 0.75, secs: 300, group: 'fortune', level: 2 }, { coins: 2500 }, '+75% luck for 5 minutes.'),
  P('fortune3', 'Fortune Potion III', '#ffab00', { luck: 1, secs: 300, group: 'fortune', level: 3 }, { coins: 6000 }, '+100% luck for 5 minutes.'),
  P('haste1', 'Haste Potion I', '#80d8ff', { speed: 0.5, secs: 300, group: 'haste', level: 1 }, { coins: 900 }, '+50% roll speed for 5 minutes.'),
  P('haste2', 'Haste Potion II', '#40c4ff', { speed: 0.75, secs: 300, group: 'haste', level: 2 }, { coins: 2500 }, '+75% roll speed for 5 minutes.'),
  P('haste3', 'Haste Potion III', '#00b0ff', { speed: 1, secs: 300, group: 'haste', level: 3 }, { coins: 6000 }, '+100% roll speed for 5 minutes.'),
  P('rage', 'Rage Potion', '#ff5252', { speed: 1.5, secs: 120 }, { coins: 4000 }, '+150% roll speed for 2 minutes.'),
  P('warp', 'Warp Potion', '#7c4dff', { speed: 3, secs: 60 }, { f: 350 }, '+300% roll speed for 1 minute.'),
  P('jewelry', 'Jewelry Potion', '#ff6ec7', { gem: 3, secs: 300 }, { coins: 3500 }, 'Gem auras (Ruby, Sapphire, Jade and more) are 3x as likely for 5 minutes.'),
  P('zombie', 'Zombie Potion', '#7cb342', { wLuck: { w: 'hell', l: 4 }, secs: 600 }, { coins: 5000 }, '+400% luck while it is Hell, for 10 minutes.'),
  P('stormflask', 'Storm Flask', '#90a4ff', { wLuck: { w: 'rain', l: 4 }, secs: 600 }, { coins: 4000 }, '+400% luck in the rain, for 10 minutes.'),
  P('frostflask', 'Frost Flask', '#b3e5fc', { wLuck: { w: 'snow', l: 4 }, secs: 600 }, { coins: 4000 }, '+400% luck in the snow, for 10 minutes.'),
  P('solartonic', 'Solar Tonic', '#ffb74d', { wLuck: { w: 'solar', l: 4 }, secs: 600 }, { coins: 4000 }, '+400% luck in Solar weather, for 10 minutes.'),
  P('celestialdew', 'Celestial Dew', '#fff59d', { wLuck: { w: 'heaven', l: 5 }, secs: 600 }, { f: 600 }, '+500% luck in Heaven, for 10 minutes.'),
  P('voiddraught', 'Void Draught', '#757575', { wLuck: { w: 'null', l: 5 }, secs: 600 }, { f: 600 }, '+500% luck in Null, for 10 minutes.'),
  P('starcandle', 'Starlit Candle', '#c5cae9', { tLuck: { t: 'night', l: 1 }, secs: 900 }, { coins: 2500 }, '+100% luck at night, for 15 minutes.'),
  P('sunbrew', 'Sunrise Brew', '#ffe082', { tLuck: { t: 'day', l: 1 }, secs: 900 }, { coins: 2500 }, '+100% luck during the day, for 15 minutes.'),
  P('midas', 'Midas Draught', '#ffd54f', { coin: 1, secs: 600 }, { f: 250 }, 'Double coins from rolls for 10 minutes.'),
  P('mutagen', 'Mutation Serum', '#00e5ff', { mut: 4, secs: 300 }, { f: 800 }, 'Auras mutate 4x as often for 5 minutes.'),
  P('diver', 'Diver Potion', '#26c6da', { fish: 1, secs: 300 }, { f: 90 }, 'Fish bite twice as fast for 5 minutes.'),
  P('angler', "Angler's Brew", '#00897b', { fishLuck: 1, secs: 600 }, { f: 150 }, 'Rarer fish bite for 10 minutes.'),
  P('zeus', 'Godly Potion (Zeus)', '#ffee58', { luck: 2, speed: 0.3, secs: 600 }, { f: 1500 }, '+200% luck and +30% roll speed for 10 minutes.'),
  P('poseidon', 'Godly Potion (Poseidon)', '#29b6f6', { luck: 1, fish: 1, fishLuck: 1, secs: 600 }, { f: 1500 }, '+100% luck, and fish bite faster and rarer, for 10 minutes.'),
  P('hades', 'Godly Potion (Hades)', '#7e57c2', { tLuck: { t: 'night', l: 4 }, secs: 600 }, { f: 1500 }, '+400% luck at night, for 10 minutes.'),
  P('transcendent', 'Transcendent Potion', '#f5f5f5', { luck: 5, speed: 1, secs: 120 }, { f: 9000 }, '+500% luck and +100% roll speed for 2 minutes.'),
  P('bound', 'Potion of Bound', '#8e24aa', { rolls: { n: 10, l: 2.5 } }, { coins: 9000 }, '+250% luck on your next 10 rolls.'),
  P('chrono', 'Chrono Potion', '#4db6ac', { rolls: { n: 1, x: 2 } }, { coins: 1500 }, 'Your next roll is doubly lucky, like a 10th roll.'),
  P('mixed', 'Mixed Potion', '#ab47bc', { mixed: 1 }, { coins: 1500 }, 'A random potion effect. Could be anything.'),
  P('heavenly1', 'Heavenly Potion I', '#fff3b0', { oneRoll: 15000 }, { coins: 150000 }, '+1,500,000% luck for your next roll.'),
  P('heavenly2', 'Heavenly Potion II', '#ffe57f', { oneRoll: 150000 }, { coins: 1500000 }, '+15,000,000% luck for your next roll.'),
  P('godlike', 'Godlike Potion', '#ff80ab', { oneRoll: 400000 }, { f: 4000 }, '+40,000,000% luck for your next roll.'),
  P('oblivion', 'Oblivion Potion', '#3a0f6b', { oneRoll: 1000000, jester: true }, { void: 5 }, '+1,000,000 luck for your next roll. Only the Jester has these.'),
];
export const POTION = Object.fromEntries(POTIONS.map(p => [p.id, p]));
// What a Mixed Potion can turn into.
export const MIXED_POOL = ['lucky', 'speed', 'fortune2', 'haste2', 'jewelry', 'midas', 'mutagen', 'zeus', 'rage', 'starcandle', 'sunbrew'];

// ---------------- items (gear works while you own it) ----------------
export const ITEMS = [
  { id: 'gloves', name: 'Lucky Gloves', color: '#66bb6a', luck: 0.25, price: { coins: 25000 }, desc: '+25% luck, always.' },
  { id: 'boots', name: 'Swift Boots', color: '#42a5f5', speed: 0.15, price: { coins: 25000 }, desc: '+15% roll speed, always.' },
  { id: 'solarlens', name: 'Solar Lens', color: '#ffb300', luck: 0.3, when: 'day', price: { coins: 60000 }, desc: '+30% luck during the day.' },
  { id: 'moonlocket', name: 'Moon Locket', color: '#9fa8da', luck: 0.3, when: 'night', price: { coins: 60000 }, desc: '+30% luck at night.' },
  { id: 'goldrod', name: 'Golden Rod', color: '#ffd54f', fish: 0.5, rod: 2, price: { f: 400 }, desc: 'Fish bite 50% faster, and the reel zone is wider.' },
  { id: 'voidlantern', name: 'Void Lantern', color: '#7e57c2', voidLuck: 1, price: { f: 2500 }, desc: 'Void Coins bite twice as often.' },
  // the daily shop's specials
  { id: 'cosmicdice', name: 'Cosmic Dice', color: '#b388ff', luck: 0.6, price: { coins: 500000 }, desc: '+60% luck, always.', daily: true },
  { id: 'hourglass', name: 'Eternal Hourglass', color: '#ffe082', speed: 0.4, price: { coins: 400000 }, desc: '+40% roll speed, always.', daily: true },
  { id: 'abyssrod', name: 'Abyssal Rod', color: '#311b92', fish: 1, fishLuck: 1, rod: 3, price: { f: 3000 }, desc: 'Fish bite twice as fast and rarer, with the widest reel zone.', daily: true },
  { id: 'mutlens', name: 'Mutation Lens', color: '#00e5ff', mut: 2, price: { coins: 750000 }, desc: 'Auras mutate 3x as often, always.', daily: true },
  { id: 'midasring', name: 'Midas Ring', color: '#ffc107', coin: 0.5, price: { f: 2000 }, desc: '+50% coins from every roll.', daily: true },
  { id: 'stargazer', name: 'Stargazer Charm', color: '#7986cb', luck: 1, when: 'night', price: { coins: 300000 }, desc: '+100% luck at night.', daily: true },
  { id: 'sunforged', name: 'Sunforged Charm', color: '#ff8f00', luck: 1, when: 'day', price: { coins: 300000 }, desc: '+100% luck during the day.', daily: true },
  { id: 'voidmagnet', name: 'Void Magnet', color: '#4a148c', voidLuck: 2, price: { f: 4000 }, desc: 'Void Coins bite 3x as often.', daily: true },
];
export const ITEM = Object.fromEntries(ITEMS.map(i => [i.id, i]));

// ---------------- fishing ----------------
// Each spot has its own fish. w: how often it bites (higher is more common). value: what Marlin pays, in F.
export const FISHING_SPOTS = {
  dock: { name: 'The Dock' },
  falls: { name: 'Waterfall Pool' },
  lagoon: { name: 'Sunset Lagoon' },
  creek: { name: 'Tower Creek' },
  void: { name: 'The Void Pool' },
};
export const FISH = [
  { id: 'boot', name: 'Old Boot', color: '#6d4c41', value: 0, w: 9, junk: true, spots: ['dock', 'falls', 'lagoon', 'creek'] },
  { id: 'minnow', name: 'Minnow', color: '#b0bec5', value: 2, w: 40, spots: ['dock', 'creek', 'lagoon'] },
  { id: 'perch', name: 'Perch', color: '#aed581', value: 4, w: 28, spots: ['dock', 'creek'] },
  { id: 'bass', name: 'Bass', color: '#8d9b5a', value: 8, w: 18, spots: ['dock', 'lagoon'] },
  { id: 'trout', name: 'Rainbow Trout', color: '#f48fb1', value: 9, w: 18, spots: ['creek', 'falls'] },
  { id: 'salmon', name: 'Salmon', color: '#ff8a65', value: 12, w: 14, spots: ['falls'] },
  { id: 'crab', name: 'Sand Crab', color: '#e57373', value: 11, w: 14, spots: ['lagoon'] },
  { id: 'carp', name: 'Golden Carp', color: '#ffd54f', value: 25, w: 5, spots: ['dock', 'falls'] },
  { id: 'pike', name: 'Shadow Pike', color: '#455a64', value: 30, w: 4, spots: ['creek'], night: true },
  { id: 'jelly', name: 'Moon Jelly', color: '#ce93d8', value: 34, w: 4, spots: ['lagoon'], night: true },
  { id: 'koi', name: 'Spirit Koi', color: '#fafafa', value: 60, w: 2, spots: ['falls'] },
  { id: 'eel', name: 'Storm Eel', color: '#7986cb', value: 45, w: 6, weather: 'rain' },
  { id: 'frostfin', name: 'Frostfin', color: '#b3e5fc', value: 45, w: 6, weather: 'snow' },
  { id: 'magma', name: 'Magma Snapper', color: '#ff5722', value: 55, w: 6, weather: 'hell' },
  { id: 'seraph', name: 'Seraph Angelfish', color: '#fff59d', value: 55, w: 6, weather: 'heaven' },
  { id: 'sunfish', name: 'Blazing Sunfish', color: '#ffab40', value: 50, w: 6, weather: 'solar' },
  { id: 'glitchfish', name: 'Glitchfish', color: '#00ffd0', value: 70, w: 6, weather: 'null' },
  { id: 'leviathan', name: 'Baby Leviathan', color: '#1a237e', value: 300, w: 0.5, spots: ['lagoon', 'dock'] },
  { id: 'voidfish', name: 'Void Fish', color: '#4a148c', value: 120, w: 30, spots: ['void'] },
  { id: 'abyssal', name: 'Abyssal Angler', color: '#0d0221', value: 400, w: 3, spots: ['void'] },
];
export const FISHES = Object.fromEntries(FISH.map(f => [f.id, f]));
// What bites at a spot right now. luck > 0 makes the rarer ones more likely.
export function catchFish(spot, time, weather, luck = 0, rand = Math.random) {
  const pool = FISH.filter(f => (f.spots ? f.spots.includes(spot) : spot !== 'void') && (!f.night || time === 'night') && (!f.weather || f.weather === weather));
  const weight = f => (f.junk ? f.w / (1 + luck) : f.w < 10 ? f.w * (1 + luck) : f.w);
  let r = rand() * pool.reduce((s, f) => s + weight(f), 0);
  for (const f of pool) { r -= weight(f); if (r <= 0) return f; }
  return pool[0];
}

// ---------------- the daily shop: five deals that change every day at midnight (UTC) ----------------
export const DAILY_POOL = [
  { kind: 'potion', id: 'oblivion', price: { coins: 2000000 } },
  { kind: 'potion', id: 'godlike', price: { coins: 600000 } },
  { kind: 'potion', id: 'transcendent', price: { coins: 250000 } },
  { kind: 'potion', id: 'heavenly2', price: { coins: 900000 } },
  { kind: 'potion', id: 'bound', price: { f: 900 } },
  { kind: 'potion', id: 'zeus', price: { coins: 120000 } },
  { kind: 'item', id: 'cosmicdice' }, { kind: 'item', id: 'hourglass' }, { kind: 'item', id: 'abyssrod' }, { kind: 'item', id: 'mutlens' },
  { kind: 'item', id: 'midasring' }, { kind: 'item', id: 'stargazer' }, { kind: 'item', id: 'sunforged' }, { kind: 'item', id: 'voidmagnet' },
  { kind: 'void', id: 'void', price: { f: 1500 } },
];
export const dayIndex = now => Math.floor(now / 86400000);
export function dailyStock(day) {
  let s = (day * 2654435761) >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pool = [...DAILY_POOL];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 5).map(o => ({ ...o, price: o.price || ITEM[o.id].price }));
}

// ---------------- weather ----------------
export const WEATHERS = {
  clear: { id: 'clear', name: 'Clear', desc: 'A calm day in the lobby.' },
  rain: { id: 'rain', name: 'Rain', desc: 'Stormal and Tempest can only be rolled in the rain.' },
  snow: { id: 'snow', name: 'Snow', desc: 'Frostbite and Blizzard can only be rolled in the snow.' },
  hell: { id: 'hell', name: 'Hell', desc: 'Undead, Hades and Bloodlust rise from Hell.' },
  heaven: { id: 'heaven', name: 'Heaven', desc: 'Aether, Seraphim and Archangel come down from Heaven.' },
  null: { id: 'null', name: 'Null', desc: 'Nothing is real. Nullified, Matrix and Paradox, and auras glitch more often.' },
  solar: { id: 'solar', name: 'Solar', desc: 'A blazing sun. Solaris can only be rolled now.' },
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
