// Overcontrol RNG: every aura, potion, item, biome and quest, plus the shared clock (day/night, biomes, the Jester).
// Modelled on Sol's RNG on Roblox. All art and music here are our own; rarities are "1 in N".

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
// A repeatable random number generator: the same seed always gives the same numbers.
export function seeded(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const hashStr = str => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

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

// id, name, 1-in-N, main colour, effect layers, only: { time: 'day'|'night', weather }, title: how the name looks,
// extra: { native: a biome where it is easier to roll (a "breakthrough"), sub: a subtitle shown under the name }
const A = (id, name, rarity, c, fx, only = null, title = {}, extra = {}) => ({ id, name, rarity, c, fx, only, title, ...extra });

export const AURAS = [
  A('common', 'Common', 2, '#c9ced6', [L.motes('#c9ced6', 10, { size: 0.35 })]),
  A('uncommon', 'Uncommon', 4, '#9be58a', [L.motes('#9be58a', 14)]),
  A('good', 'Good', 5, '#79a8ff', [L.motes('#79a8ff', 16), L.glow('#79a8ff', 3)]),
  A('natural', 'Natural', 8, '#5fc35a', [L.fall('#7ccf5a', { n: 18, leaf: 1 }), L.glow('#3e9b43', 3)], null, {}, { native: 'windy' }),
  A('flora', 'Flora', 10, '#8be07a', [L.fall('#ff9ecf', { n: 16, leaf: 1 }), L.motes('#b6f08f', 10)], null, {}, { native: 'windy' }),
  A('rare', 'Rare', 16, '#3f6bff', [L.motes('#3f6bff', 22), L.ring('#2f5bff', { r: 1.6 })]),
  A('honey', 'Honey', 25, '#ffb300', [L.fall('#ffb300', { drip: 1, n: 14 }), L.glow('#ffca28', 3)]),
  A('divinus', 'Divinus', 32, '#fff2b3', [L.halo('#fff2b3'), L.motes('#ffe680', 20)], null, {}, { native: 'heaven' }),
  A('quartz', 'Quartz', 48, '#f2f2f2', [L.crystals('#f5f5f5', 4, { size: 0.26 }), L.sparkle('#ffffff', { n: 20 })]),
  A('crystallized', 'Crystallized', 64, '#9ff3ff', [L.crystals('#9ff3ff', 4), L.glow('#7fe8ff', 3)]),
  A('ember', 'Ember', 90, '#ff7a2f', [L.flames('#ff9a3c', '#7a1f00', { n: 30 }), L.motes('#ffb06b', 12)], null, {}, { native: 'hell' }),
  A('rage', 'Rage', 128, '#ff3b30', [L.flames('#ff3b30', '#ff9f0a'), L.glow('#ff3b30', 3)]),
  A('topaz', 'Topaz', 150, '#ffb347', [L.crystals('#ffb347', 3, { size: 0.35 }), L.sparkle('#ffd27f')], null, {}, { native: 'sandstorm' }),
  A('glacier', 'Glacier', 220, '#9fe3ff', [L.crystals('#bdeeff', 6, { size: 0.3 }), L.ring('#9fe3ff', { r: 1.8 })], null, {}, { native: 'snow' }),
  A('ruby', 'Ruby', 350, '#e0115f', [L.crystals('#e0115f', 5), L.glow('#e0115f', 4)]),
  A('forbidden', 'Forsaken', 403, '#38c172', [L.spiral('#38c172'), L.glow('#0b3d20', 4, { dark: 1 })]),
  A('emerald', 'Emerald', 500, '#2ecc71', [L.crystals('#2ecc71', 6), L.ring('#2ecc71')]),
  A('gilded', 'Gilded', 512, '#ffcc33', [L.sparkle('#ffd966', { n: 40 }), L.halo('#ffcc33')], null, {}, { native: 'sandstorm' }),
  A('velvet', 'Velvet', 600, '#b0123a', [L.motes('#c2185b', 28), L.ring('#7f0f2b', { r: 2 })]),
  A('ink', 'Ink', 700, '#5b2d8f', [L.motes('#2a0f45', 30, { dark: 1 }), L.fall('#1a0a2e', { drip: 1, dark: 1 })], null, {}, { native: 'corruption' }),
  A('jackpot', 'Jackpot', 777, '#ffd700', [L.orbit('#ffd700', 7, { size: 0.3 }), L.sparkle('#fff4a3')], null, { gold: 1 }, { native: 'sandstorm' }),
  A('sapphire', 'Sapphire', 800, '#2f6bff', [L.crystals('#0f52ba', 5), L.glow('#3d7bff', 4)]),
  A('aquamarine', 'Aquamarine', 900, '#7fffd4', [L.spiral('#7fffd4'), L.ring('#58e8c6')], null, {}, { native: 'rain' }),
  A('wind', 'Wind', 1000, '#e8fbff', [L.spiral('#e8fbff', { wide: 1, fast: 1, n: 50 })], null, {}, { native: 'windy' }),
  A('diaboli', 'Diaboli', 1004, '#ff2a2a', [L.flames('#8b0000', '#ff2a00'), L.halo('#ff0000', { horns: 1 })], null, {}, { native: 'hell' }),
  A('precious', 'Precious', 1024, '#ff7eb6', [L.crystals('#ff7eb6', 6, { size: 0.3 }), L.sparkle('#ffd1e6')]),
  A('hazard', 'Hazard', 1200, '#ffd000', [L.cubes('#ffd000', 6), L.cubes('#111111', 6, { dark: 1 }), L.ring('#ffd000', { r: 2.2, runes: 1 })], null, {}, { native: 'corruption' }),
  A('echo', 'Echo', 1500, '#7fd8ff', [L.ring('#7fd8ff', { r: 1.6 }), L.ring('#c9f0ff', { r: 2.8 }), L.motes('#7fd8ff', 16)]),
  A('magnetic', 'Magnetic', 2048, '#6f95ff', [L.orbit('#ff4d4d', 2, { r: 1.9 }), L.orbit('#4d7cff', 2, { r: 1.9, phase: Math.PI / 2 }), L.bolts('#bcd3ff')]),
  A('flutter', 'Flutter', 2222, '#ff9ff3', [L.orbit('#ff9ff3', 5, { r: 2.2, bob: 1, size: 0.22 }), L.sparkle('#ffd6f7')]),
  A('static', 'Static', 2600, '#eef2ff', [L.bolts('#ffffff'), L.bolts('#9fb4ff'), L.sparkle('#ffffff', { n: 24 })], null, {}, { native: 'glitched' }),
  A('raven', 'Raven', 3300, '#6b6f80', [L.fall('#151515', { dark: 1, leaf: 1, n: 26 }), L.glow('#20202a', 4, { dark: 1 }), L.wings('#3a3d4a')]),
  A('sidereum', 'Sidereum', 4096, '#7aa2ff', [L.sparkle('#cfe0ff', { n: 50 }), L.orbit('#5b8cff', 3)], null, {}, { native: 'starfall' }),
  A('bleeding', 'Bleeding', 4444, '#d1102e', [L.fall('#b3001b', { drip: 1 }), L.glow('#b3001b', 4)], null, {}, { native: 'hell' }),
  A('solar', 'Solar', 5000, '#ffb000', [L.ring('#ffb000', { r: 2.2, rays: 1 }), L.glow('#ffd54a', 5), L.motes('#ffcf5a', 24)], { time: 'day' }, { gold: 1 }),
  A('lunar', 'Lunar', 5000, '#c9d6ff', [L.halo('#e8eeff', { r: 0.9 }), L.glow('#9fb4ff', 5), L.sparkle('#ffffff')], { time: 'night' }),
  A('starlight', 'Starlight', 6000, '#a8c7ff', [L.sparkle('#ffffff', { n: 60 }), L.spiral('#a8c7ff')], null, {}, { native: 'starfall' }),
  A('twilight', 'Twilight', 7000, '#c77dff', [L.spiral('#ff9e7a', { n: 40 }), L.spiral('#9d4edd', { n: 40, wide: 1 }), L.glow('#7b2cbf', 4)], { time: 'night' }),
  A('frostbite', 'Frostbite', 8000, '#bfefff', [L.fall('#ffffff', { n: 40 }), L.crystals('#bfefff', 4)], { weather: 'snow' }),
  A('stormal', 'Stormal', 9000, '#8f9fff', [L.bolts('#d6dcff'), L.fall('#9fb3ff', { rain: 1, n: 40 })], { weather: 'rain' }),
  A('undead', 'Undead', 12000, '#5bff6a', [L.flames('#2bff66', '#0a3311'), L.halo('#5bff6a')], { weather: 'hell' }),
  A('corrosive', 'Corrosive', 12000, '#b6ff00', [L.motes('#b6ff00', 40), L.spiral('#6b8f00')], null, {}, { native: 'corruption' }),
  A('blizzard', 'Blizzard', 15000, '#e3f6ff', [L.fall('#ffffff', { n: 70 }), L.spiral('#cfefff', { fast: 1, wide: 1, n: 50 }), L.crystals('#e3f6ff', 5)], { weather: 'snow' }),
  A('lostsoul', 'Lost Soul', 18000, '#6fb7ff', [L.motes('#6fb7ff', 40, { size: 0.6 }), L.orbit('#cfe7ff', 3, { bob: 1, r: 2.2 }), L.glow('#1e4b8f', 5)]),
  A('comet', 'Comet', 20000, '#7fd1ff', [L.orbit('#bfe8ff', 1, { trail: 1, r: 2.4, size: 0.35 }), L.sparkle('#ffffff')], { weather: 'starfall' }),
  A('jade', 'Jade', 25000, '#00c07a', [L.crystals('#00a86b', 8), L.halo('#00e08f')]),
  A('gale', 'Gale', 25000, '#c9f7ff', [L.spiral('#e0fbff', { fast: 1, wide: 1, n: 70 }), L.fall('#ffffff', { leaf: 1, n: 20 }), L.ring('#bdf4ff', { r: 2.6 })], { weather: 'windy' }),
  A('spectre', 'Spectre', 30000, '#d0d0ff', [L.motes('#d0d0ff', 40, { size: 0.7 }), L.glow('#8080ff', 4)]),
  A('aether', 'Aether', 40000, '#fff8e1', [L.wings('#fff8e1'), L.halo('#ffe9a6')], { weather: 'heaven' }),
  A('kyawthuite', 'Kyawthuite', 40000, '#ff5f7e', [L.crystals('#ff5f7e', 8, { size: 0.32 }), L.sparkle('#ffd0da', { n: 40 }), L.halo('#ff5f7e')]),
  A('nullified', 'Nullified', 50000, '#bdbdbd', [L.cubes('#ffffff', 8), L.cubes('#111111', 8, { dark: 1 })], { weather: 'null' }),
  A('mirage', 'Mirage', 60000, '#e8c37a', [L.fall('#e8c37a', { n: 50 }), L.ring('#ffdf9e', { r: 2.4 }), L.glow('#c98f2b', 4)], { weather: 'sandstorm' }),
  A('tempest', 'Tempest', 65000, '#8aa8ff', [L.bolts('#e6ecff'), L.bolts('#8aa8ff'), L.spiral('#8aa8ff', { fast: 1, n: 60 }), L.fall('#aebfff', { rain: 1, n: 40 })], { weather: 'rain' }),
  A('seraphim', 'Seraphim', 80000, '#ffe082', [L.wings('#ffe082', { big: 1 }), L.pillar('#fff3c4'), L.halo('#ffd54f')], { weather: 'heaven' }),
  A('parasite', 'Parasite', 90000, '#9cff3a', [L.motes('#9cff3a', 50), L.spiral('#3b6b00', { n: 50 }), L.glow('#1b2e00', 5, { dark: 1 })], { weather: 'corruption' }),
  A('exotic', 'Exotic', 99999, '#ff3dff', [L.rainbow({ n: 40 }), L.ring('#ff00ff')], null, { rainbow: 1 }),
  A('phantom', 'Phantom', 120000, '#c8d0ff', [L.wings('#c8d0ff'), L.motes('#e8ebff', 40, { size: 0.6 }), L.glow('#6a72c9', 5)]),
  A('chromatic', 'Chromatic', 200000, '#ff4da6', [L.rainbow({ n: 60, orbit: 1 }), L.halo('#ffffff')], null, { rainbow: 1 }),
  A('aurora', 'Aurora', 250000, '#7dffcf', [L.rainbow({ n: 60, orbit: 1 }), L.spiral('#7dffcf', { n: 50, wide: 1 }), L.halo('#b8ffe8')], { time: 'night' }, { rainbow: 1 }),
  A('astral', 'Astral', 267000, '#9fb8ff', [L.sparkle('#ffffff', { n: 80 }), L.orbit('#9fb8ff', 4, { trail: 1, r: 2.6 }), L.ring('#c5d3ff', { r: 3, runes: 1 })], { weather: 'starfall' }),
  A('celestial', 'Celestial', 350000, '#ffe9a8', [L.wings('#fff6d5'), L.sparkle('#fff3b0', { n: 60 }), L.pillar('#ffe9a8')], null, { gold: 1 }, { native: 'heaven' }),
  A('galaxy', 'Galaxy', 500000, '#8a63ff', [L.spiral('#a07bff', { n: 80, galaxy: 1 }), L.sparkle('#ffffff', { n: 40 }), L.glow('#2a0f6b', 6)], null, {}, { native: 'starfall' }),
  A('solaris', 'Solaris', 500000, '#ff8a00', [L.ring('#ff7a00', { r: 3, rays: 1 }), L.flames('#ffd000', '#ff4500'), L.pillar('#ffae00')], { weather: 'sandstorm' }, { gold: 1 }),
  A('nebula', 'Nebula', 750000, '#ff6ad5', [L.spiral('#ff6ad5', { n: 90, galaxy: 1 }), L.sparkle('#ffffff', { n: 50 }), L.glow('#5b1a7a', 6)], null, {}, { native: 'starfall' }),
  A('arcane', 'Arcane', 1000000, '#5c77ff', [L.ring('#3d5afe', { r: 2.6, runes: 1 }), L.orbit('#8c9eff', 4), L.pillar('#536dfe')]),
  A('prism', 'Prism', 1500000, '#ffffff', [L.crystals('#ffffff', 8, { size: 0.36 }), L.rainbow({ n: 50 }), L.ring('#ffffff', { r: 2.6, rays: 1 })], null, { rainbow: 1 }),
  A('pharaoh', 'Pharaoh', 1800000, '#ffd54f', [L.halo('#ffd54f', { crown: 1 }), L.pillar('#ffca28'), L.fall('#e8c37a', { n: 40 }), L.sparkle('#fff3c4', { n: 40 })], { weather: 'sandstorm' }, { gold: 1 }),
  A('eclipse', 'Eclipse', 2000000, '#ff9100', [L.halo('#ff9100', { r: 1.2, eclipse: 1 }), L.ring('#ff9100', { r: 2.8 }), L.motes('#ff6d00', 40)], { time: 'night' }),
  A('fault', 'Fault', 3000000, '#00ffd0', [L.cubes('#00ffd0', 14), L.bolts('#00ffd0'), L.ring('#00ffd0', { r: 2.8, runes: 1, half: 1 })], { weather: 'glitched' }),
  A('matrix', 'Matrix', 3000000, '#00ff41', [L.fall('#00ff41', { code: 1, n: 60 }), L.cubes('#00ff41', 10)], { weather: 'null' }),
  A('leviathan', 'Leviathan', 4000000, '#2f6dff', [L.orbit('#5d8bff', 1, { trail: 1, r: 3, size: 0.5 }), L.orbit('#1a3fa8', 1, { trail: 1, r: 2.2, size: 0.4, phase: Math.PI }), L.fall('#7fb0ff', { drip: 1, n: 30 }), L.glow('#0d2a6b', 6)]),
  A('hades', 'Hades', 6666666, '#9b4dff', [L.flames('#7b00ff', '#1a0033', { big: 1 }), L.orbit('#b388ff', 6), L.pillar('#4b0082')], { weather: 'hell' }),
  A('monarch', 'Monarch', 10000000, '#b14dff', [L.wings('#b14dff', { big: 1 }), L.motes('#e1bee7', 50), L.halo('#7b1fa2', { crown: 1 }), L.glow('#2a0038', 6, { dark: 1 })], { weather: 'corruption' }),
  A('dawnbreaker', 'Dawnbreaker', 12000000, '#ffcc4d', [L.pillar('#ffd77a', { tall: 1 }), L.ring('#ffcc4d', { r: 3.2, rays: 1 }), L.wings('#fff0c2', { big: 1 }), L.sparkle('#fff6d8', { n: 60 })], { time: 'day' }, { gold: 1 }),
  A('requiem', 'Requiem', 25000000, '#e6e6e6', [L.halo('#ffffff', { crown: 1 }), L.motes('#ffffff', 40), L.motes('#000000', 40, { dark: 1 }), L.wings('#9a9a9a', { big: 1 })], null, { bw: 1 }),
  A('overseer', 'Overseer', 45000000, '#00e5ff', [L.halo('#00e5ff', { eye: 1 }), L.orbit('#00e5ff', 8, { r: 3 }), L.pillar('#00b8d4'), L.sparkle('#e0f7fa')]),
  A('bloodlust', 'Bloodlust', 50000000, '#ff1744', [L.flames('#ff1744', '#4a0000', { big: 1 }), L.wings('#b71c1c', { big: 1 }), L.orbit('#ff5252', 5)], { weather: 'hell' }),
  A('deleted', '[ DELETED ]', 80000000, '#ff0044', [L.cubes('#ff0044', 14), L.cubes('#000000', 14, { dark: 1 }), L.ring('#ff0044', { r: 3.2, runes: 1, half: 1 }), L.bolts('#ff5c8a')], { weather: 'glitched' }),
  A('starscourge', 'Starscourge', 80000000, '#ff3b3b', [L.sparkle('#ffffff', { n: 80 }), L.orbit('#ff3b3b', 6, { r: 3, trail: 1 }), L.pillar('#ff2a2a'), L.bolts('#ff8a8a')]),
  A('sovereign', 'Sovereign', 100000000, '#ffd700', [L.halo('#ffd700', { crown: 1 }), L.wings('#fff1a8', { big: 1 }), L.pillar('#ffd700'), L.sparkle('#fffde7', { n: 80 })], null, { gold: 1 }),
  A('paradox', 'Paradox', 150000000, '#00ffd0', [L.cubes('#00ffd0', 12), L.cubes('#ff00aa', 12), L.ring('#ffffff', { r: 3, runes: 1, half: 1 }), L.bolts('#00ffd0')], { weather: 'null' }),
  A('archangel', 'Archangel', 250000000, '#ffffff', [L.wings('#ffffff', { big: 1, many: 1 }), L.halo('#fff9c4'), L.pillar('#ffffff', { tall: 1 }), L.motes('#fff59d', 60)], { weather: 'heaven' }),
  A('singularity', 'Singularity', 600000000, '#7c4dff', [L.spiral('#b39dff', { n: 120, galaxy: 1 }), L.glow('#0a0014', 5, { dark: 1 }), L.ring('#7c4dff', { r: 3.6, runes: 1 }), L.pillar('#4527a0', { tall: 1 })], null, { violet: 1 }),
  A('overcontrol', 'OVERCONTROL', 777777777, '#9c6bff', [L.orbit('#c4b5ff', 8, { r: 3.2, trail: 1 }), L.ring('#8b5cff', { r: 3.4, runes: 1 }), L.pillar('#7c4dff', { tall: 1 }), L.spiral('#b39dff', { n: 100 }), L.bolts('#e1d6ff')], null, { violet: 1 }),
  A('genesis', 'GENESIS', 1500000000, '#fff4d6', [L.wings('#fff4d6', { big: 1, many: 1 }), L.pillar('#ffffff', { tall: 1 }), L.ring('#ffd77a', { r: 3.8, runes: 1, rays: 1 }), L.sparkle('#fffbe6', { n: 90 }), L.halo('#ffe9a6', { crown: 1 })], null, { gold: 1 }),
  // One aura, like Sol's: 『EQUINOX』, the Equilibrium Incarnate. A white sun and a black sun in balance.
  A('equinox', '『EQUINOX』', 2500000000, '#ffffff', [L.yinyang({ r: 3, many: 1, big: 1 }), L.ring('#ffffff', { r: 3.8, half: 1, runes: 1 }), L.pillar('#ffffff', { tall: 1, split: 1 }), L.spiral('#ffffff', { n: 90, bw: 1 }), L.motes('#ffffff', 30), L.motes('#000000', 30, { dark: 1 })], null, { bw: 1 }, { sub: 'Equilibrium Incarnate' }),
];
// Gem auras: the Jewelry Potion makes these more likely.
export const GEM_AURAS = new Set(['crystallized', 'topaz', 'ruby', 'emerald', 'sapphire', 'aquamarine', 'precious', 'jade', 'quartz', 'glacier', 'kyawthuite', 'prism']);
export const AURA = Object.fromEntries(AURAS.map(a => [a.id, a]));
export const AURAS_RAREST_FIRST = [...AURAS].sort((a, b) => b.rarity - a.rarity);
// Old saves: the two balance auras became one.
export const AURA_RENAMES = { equilibrium: 'equinox' };

// ---------------- mutations: a rare twist on a rolled aura, which multiplies its rarity ----------------
export const MUTATIONS = {
  shiny: { id: 'shiny', name: 'Shiny', mult: 5, color: '#ffe066' },
  corrupted: { id: 'corrupted', name: 'Corrupted', mult: 12, color: '#b14dff' },
  glitched: { id: 'glitched', name: 'Glitched', mult: 25, color: '#00ffd0' },
};
// "ruby" or "ruby:shiny" -> { aura, mut, rarity, name }
export function auraKey(key) {
  let [id, m] = String(key || 'common').split(':');
  if (AURA_RENAMES[id]) id = AURA_RENAMES[id];
  const aura = AURA[id] || AURA.common, mut = MUTATIONS[m] || null;
  return { key: mut ? `${aura.id}:${mut.id}` : aura.id, aura, mut, rarity: aura.rarity * (mut ? mut.mult : 1), name: mut ? `${mut.name} ${aura.name}` : aura.name };
}

// ---------------- biomes ----------------
// bt: a "breakthrough": auras native to the biome are this many times easier while it lasts.
// During Glitched, every biome's own auras can be rolled at once.
export const WEATHERS = {
  clear: { id: 'clear', name: 'Normal', color: '#ffffff', bt: 1, desc: '' },
  windy: { id: 'windy', name: 'Windy', color: '#bdf4ff', bt: 3, desc: 'Wind, Flora and Natural are 3x as likely. Gale only blows in now.' },
  rain: { id: 'rain', name: 'Rainy', color: '#8fb6ff', bt: 4, desc: 'Aquamarine is 4x as likely. Stormal and Tempest only fall in the rain.' },
  snow: { id: 'snow', name: 'Snowy', color: '#e3f6ff', bt: 3, desc: 'Glacier is 3x as likely. Frostbite and Blizzard only come with the snow.' },
  sandstorm: { id: 'sandstorm', name: 'Sandstorm', color: '#f0c87a', bt: 4, desc: 'Topaz, Gilded and Jackpot are 4x as likely. Mirage, Solaris and Pharaoh rise from the sand.' },
  hell: { id: 'hell', name: 'Hell', color: '#ff4a2b', bt: 6, desc: 'Ember, Diaboli and Bleeding are 6x as likely. Undead, Hades and Bloodlust rise from Hell.' },
  starfall: { id: 'starfall', name: 'Starfall', color: '#8fb0ff', bt: 5, desc: 'Star auras are 5x as likely. Comet and Astral fall now, and so does Stella\'s Star.' },
  heaven: { id: 'heaven', name: 'Heaven', color: '#fff3b0', bt: 5, desc: 'Divinus and Celestial are 5x as likely. Aether, Seraphim and Archangel come down.' },
  corruption: { id: 'corruption', name: 'Corruption', color: '#c06bff', bt: 5, desc: 'Ink, Hazard and Corrosive are 5x as likely. Parasite and Monarch crawl out.' },
  null: { id: 'null', name: 'Null', color: '#9e9e9e', bt: 10, desc: 'Nothing is real. Nullified, Matrix and Paradox, and auras glitch more often.' },
  glitched: { id: 'glitched', name: 'Glitched', color: '#00ffd0', bt: 1, desc: 'Every biome\'s auras can be rolled at once. Fault and [ DELETED ] only exist here.' },
};

// ---------------- rolling ----------------
// Rarest first: each aura you could get right now succeeds with luck / rarity. If none do, you get Common.
// opts.gem: extra luck for gem auras (Jewelry Potion). opts.mut: how many times more often auras mutate.
// opts.anyWeather: biomes whose own auras can be rolled anyway (Universe Potion: starfall).
export function rollAura(luck, time, weather, opts = {}, rand = Math.random) {
  let got = AURA.common;
  const gem = opts.gem || 1, mm = opts.mut || 1, anyW = opts.anyWeather || [];
  const bt = (WEATHERS[weather] || WEATHERS.clear).bt;
  for (const a of AURAS_RAREST_FIRST) {
    if (a.id === 'common') continue;
    if (a.only) {
      if (a.only.time && a.only.time !== time) continue;
      if (a.only.weather && a.only.weather !== weather && weather !== 'glitched' && !anyW.includes(a.only.weather)) continue;
    }
    let l = GEM_AURAS.has(a.id) ? luck * gem : luck;
    if (a.native && a.native === weather) l *= bt;
    if (rand() < l / a.rarity) { got = a; break; }
  }
  // Auras rarer than 1 in 1,000 sometimes mutate.
  let mut = null;
  if (got.rarity >= 1000) {
    const r = rand();
    const corrupt = weather === 'corruption' ? 1 / 15 : 1 / 80;   // Corruption corrupts more often
    if (weather === 'glitched' && r < mm / 8) mut = 'glitched';
    else if (weather === 'null' && r < mm / 20) mut = 'glitched';
    else if (r < mm * corrupt) mut = 'corrupted';
    else if (r < mm * (corrupt + 1 / 30)) mut = 'shiny';
  }
  return auraKey(mut ? `${got.id}:${mut}` : got.id);
}

// ---------------- aura moves ----------------
// Good auras fight. Anomalous and up get Z, Forbidden and up get X too, Cataclysmic and up get C, null auras get V.
// F is a mobility move (a dash, a blink, a leap or flight) that only some auras have. 『EQUINOX』 has all five.
const MOVE_KIND = {
  burst: { cd: 3, dmg: 10, r: 7 },
  orbs: { cd: 5, dmg: 7, n: 5, range: 28 },
  beam: { cd: 6, dmg: 16, len: 34, w: 2.4 },
  meteor: { cd: 9, dmg: 24, r: 8, dist: 14 },
  vortex: { cd: 10, dmg: 5, r: 9, dist: 10, dur: 2.4 },
  storm: { cd: 10, dmg: 12, n: 7, r: 14 },
  nova: { cd: 18, dmg: 40, r: 18 },
  dash: { cd: 4, dist: 20 },
  blink: { cd: 5, dist: 24 },
  leap: { cd: 5, h: 30, dist: 18 },
  flight: { cd: 14, dur: 4 },
};
const ELEMENTS = {
  fire: { z: ['burst', 'Flare'], x: ['orbs', 'Fireballs'], c: ['meteor', 'Meteor'], v: ['nova', 'Inferno'], f: ['dash', 'Flame Dash'] },
  ice: { z: ['burst', 'Frost Nova'], x: ['beam', 'Ice Lance'], c: ['storm', 'Hailstorm'], v: ['nova', 'Absolute Zero'], f: ['dash', 'Glide'] },
  storm: { z: ['storm', 'Static'], x: ['beam', 'Thunderbolt'], c: ['storm', 'Tempest'], v: ['nova', 'Judgement'], f: ['blink', 'Flash Step'] },
  light: { z: ['burst', 'Radiance'], x: ['beam', 'Holy Lance'], c: ['meteor', 'Smite'], v: ['nova', 'Ascension'], f: ['flight', 'Wings'] },
  dark: { z: ['burst', 'Shadow Pulse'], x: ['orbs', 'Soul Bolts'], c: ['vortex', 'Abyss'], v: ['nova', 'Eclipse'], f: ['blink', 'Shadow Step'] },
  nature: { z: ['burst', 'Bloom'], x: ['orbs', 'Thorns'], c: ['vortex', 'Overgrowth'], v: ['nova', 'Gaia'], f: ['leap', 'Vault'] },
  water: { z: ['burst', 'Splash'], x: ['beam', 'Riptide'], c: ['vortex', 'Maelstrom'], v: ['nova', 'Tsunami'], f: ['dash', 'Current'] },
  star: { z: ['burst', 'Starburst'], x: ['orbs', 'Shooting Stars'], c: ['meteor', 'Comet Fall'], v: ['nova', 'Supernova'], f: ['blink', 'Warp'] },
  void: { z: ['vortex', 'Void Pull'], x: ['beam', 'Null Ray'], c: ['storm', 'Fracture'], v: ['nova', 'Collapse'], f: ['blink', 'Phase'] },
  gem: { z: ['burst', 'Shatter'], x: ['orbs', 'Shards'], c: ['meteor', 'Crystal Rain'], v: ['nova', 'Prism Break'], f: ['dash', 'Refract'] },
  wind: { z: ['burst', 'Gust'], x: ['beam', 'Cyclone'], c: ['vortex', 'Tornado'], v: ['nova', 'Hurricane'], f: ['leap', 'Updraft'] },
  earth: { z: ['burst', 'Quake'], x: ['orbs', 'Boulders'], c: ['meteor', 'Landslide'], v: ['nova', 'Cataclysm'], f: ['leap', 'Sand Leap'] },
  toxic: { z: ['burst', 'Toxin'], x: ['orbs', 'Spores'], c: ['vortex', 'Infestation'], v: ['nova', 'Plague'], f: ['dash', 'Skitter'] },
  glitch: { z: ['storm', 'Corrupt'], x: ['beam', 'Overwrite'], c: ['vortex', 'Stack Overflow'], v: ['nova', 'Fatal Error'], f: ['blink', 'Teleport'] },
  arcane: { z: ['burst', 'Arcane Pulse'], x: ['orbs', 'Arcane Missiles'], c: ['meteor', 'Starfall'], v: ['nova', 'Arcanum'], f: ['blink', 'Blink'] },
  balance: { z: ['burst', 'Duality'], x: ['beam', 'Twin Lance'], c: ['vortex', 'Yin and Yang'], v: ['nova', 'Equilibrium'], f: ['blink', 'Balance Step'] },
};
const ELEMENT_OF = {};
for (const [el, ids] of Object.entries({
  fire: 'rage ember solaris eclipse bloodlust diaboli hades bleeding velvet',
  ice: 'glacier frostbite blizzard crystallized quartz',
  storm: 'stormal tempest static magnetic',
  light: 'divinus aether seraphim celestial archangel dawnbreaker genesis gilded solar sovereign',
  dark: 'ink raven spectre phantom lostsoul requiem forbidden undead lunar twilight',
  nature: 'natural flora uncommon honey jade emerald flutter',
  water: 'aquamarine leviathan sapphire',
  star: 'starlight sidereum comet galaxy nebula astral aurora starscourge overseer singularity',
  void: 'nullified overcontrol',
  gem: 'topaz ruby precious kyawthuite prism jackpot exotic chromatic rare good common',
  wind: 'wind gale echo',
  earth: 'mirage pharaoh hazard',
  toxic: 'corrosive parasite monarch',
  glitch: 'matrix fault deleted paradox',
  balance: 'equinox',
})) ids.split(' ').forEach(id => { ELEMENT_OF[id] = el; });
export const elementOf = id => ELEMENT_OF[id] || 'arcane';
const HAS_F = new Set('wind gale magnetic static comet phantom tempest leviathan aurora dawnbreaker starscourge singularity overcontrol genesis archangel seraphim aether paradox fault monarch pharaoh astral equinox'.split(' '));
// The moves an aura gives you: [{ key: 'z', kind, name, cd, dmg, ... }]
export function movesFor(key) {
  const { aura, mut } = auraKey(key);
  const t = tierIndex(aura.rarity);
  const el = ELEMENTS[ELEMENT_OF[aura.id] || 'arcane'];
  const keys = [];
  if (aura.id === 'equinox') keys.push('z', 'x', 'c', 'v', 'f');
  else {
    if (t >= 2) keys.push('z');
    if (t >= 3) keys.push('x');
    if (t >= 5) keys.push('c');
    if (t >= 7) keys.push('v');
    if (HAS_F.has(aura.id)) keys.push('f');
  }
  const power = (0.7 + t * 0.12) * (mut ? 1.1 : 1);
  return keys.map(k => {
    const [kind, name] = el[k], base = MOVE_KIND[kind];
    return { key: k, kind, name, ...base, dmg: base.dmg ? Math.round(base.dmg * power) : 0, color: mut ? mut.color : aura.c, tier: t };
  });
}

// ---------------- potions ----------------
// Every potion from Sol's RNG. Effects (luck and speed are shares: +1 = +100%):
//   luck, speed, secs      while it lasts           group/level   only one level of a family at a time
//   oneRoll                luck added to your next roll        boost {n, l}   +l luck on your next n rolls
//   rollSpeed {n, speed}   +speed roll speed for your next n rolls
//   strange: 1 | 2         a random effect (good or bad)         universe      Starfall auras can be rolled anywhere
//   size: 'min' | 'max'    shrinks or grows you                  hellAnywhere  Hell auras can be rolled anywhere
//   mystery                something unpredictable
// src: where it comes from (map, mari, jester, stella, quest, code, event, finn). recipe: what Stella needs.
// shape: how the bottle looks (icons.js draws it).
const P = (id, name, color, shape, fx, more, desc) => ({ id, name, color, shape, ...fx, ...more, desc });
export const POTIONS = [
  P('lucky', 'Lucky Potion', '#3ddc84', 'round', { luck: 0.25, secs: 60 }, { src: 'map mari jester', price: { coins: 250 } }, '+25% luck for 1 minute.'),
  P('luckl', 'Lucky Potion L', '#2fcf73', 'round', { luck: 0.25, secs: 300 }, { src: 'mari', price: { coins: 1100 } }, '+25% luck for 5 minutes.'),
  P('luckxl', 'Lucky Potion XL', '#21b863', 'round', { luck: 0.25, secs: 600 }, { src: 'mari', price: { coins: 2000 } }, '+25% luck for 10 minutes.'),
  P('speed', 'Speed Potion', '#4fc3ff', 'tall', { speed: 0.1, secs: 60 }, { src: 'map mari jester', price: { coins: 250 } }, '+10% roll speed for 1 minute.'),
  P('speedl', 'Speed Potion L', '#36b4f5', 'tall', { speed: 0.1, secs: 300 }, { src: 'mari', price: { coins: 1100 } }, '+10% roll speed for 5 minutes.'),
  P('speedxl', 'Speed Potion XL', '#1e9fe6', 'tall', { speed: 0.1, secs: 600 }, { src: 'mari', price: { coins: 2000 } }, '+10% roll speed for 10 minutes.'),
  P('spoid1', 'Fortune Spoid I', '#ffe082', 'spoid', { luck: 0.5, secs: 60, group: 'spoid', level: 1 }, { src: 'mari', price: { coins: 1500 } }, '+50% luck for 1 minute.'),
  P('spoid2', 'Fortune Spoid II', '#ffd54f', 'spoid', { luck: 0.75, secs: 60, group: 'spoid', level: 2 }, { src: 'mari', price: { coins: 3000 } }, '+75% luck for 1 minute.'),
  P('spoid3', 'Fortune Spoid III', '#ffca28', 'spoid', { luck: 1, secs: 60, group: 'spoid', level: 3 }, { src: 'mari', price: { coins: 6000 } }, '+100% luck for 1 minute.'),
  P('fortune1', 'Fortune Potion I', '#ffd54a', 'flask', { luck: 0.5, secs: 300, group: 'fortune', level: 1 }, { src: 'stella quest', recipe: { potions: { lucky: 10 } } }, '+50% luck for 5 minutes.'),
  P('fortune2', 'Fortune Potion II', '#ffc21a', 'flask', { luck: 0.75, secs: 300, group: 'fortune', level: 2 }, { src: 'stella quest', recipe: { potions: { lucky: 25 } } }, '+75% luck for 5 minutes.'),
  P('fortune3', 'Fortune Potion III', '#ffab00', 'flask', { luck: 1, secs: 300, group: 'fortune', level: 3 }, { src: 'stella quest', recipe: { potions: { lucky: 50 } } }, '+100% luck for 5 minutes.'),
  P('hugefortune', 'Huge Fortune Potion I', '#ff9800', 'big', { luck: 0.5, secs: 3600 }, { src: 'quest' }, '+50% luck for 1 hour.'),
  P('haste1', 'Haste Potion I', '#80d8ff', 'vial', { speed: 0.2, secs: 300, group: 'haste', level: 1 }, { src: 'stella quest', recipe: { potions: { speed: 10 } } }, '+20% roll speed for 5 minutes.'),
  P('haste2', 'Haste Potion II', '#40c4ff', 'vial', { speed: 0.25, secs: 300, group: 'haste', level: 2 }, { src: 'stella quest', recipe: { potions: { speed: 25 } } }, '+25% roll speed for 5 minutes.'),
  P('haste3', 'Haste Potion III', '#00b0ff', 'vial', { speed: 0.3, secs: 300, group: 'haste', level: 3 }, { src: 'stella quest', recipe: { potions: { speed: 50 } } }, '+30% roll speed for 5 minutes.'),
  P('rage', 'Rage Potion', '#ff5252', 'vial', { speed: 0.35, secs: 600 }, { src: 'stella', recipe: { auras: { diaboli: 1, rage: 5 }, potions: { speed: 10 } } }, '+35% roll speed for 10 minutes.'),
  P('diver', 'Diver Potion', '#26c6da', 'tall', { speed: 0.4, secs: 600 }, { src: 'stella finn', price: { f: 400 }, recipe: { auras: { aquamarine: 1 }, potions: { speed: 20 } } }, '+40% roll speed for 10 minutes.'),
  P('jewelry', 'Jewelry Potion', '#ff6ec7', 'gem', { luck: 1.2, secs: 600 }, { src: 'stella', recipe: { auras: { aquamarine: 1, sapphire: 1, emerald: 1, ruby: 1, topaz: 1, gilded: 1 }, potions: { lucky: 20 } } }, '+120% luck for 10 minutes.'),
  P('zombie', 'Zombie Potion', '#7cb342', 'skull', { luck: 1.5, secs: 600 }, { src: 'stella', recipe: { auras: { bleeding: 1, undead: 1 }, potions: { lucky: 10 } } }, '+150% luck for 10 minutes.'),
  P('zeus', 'Godly Potion (Zeus)', '#ffee58', 'godly', { luck: 2, speed: 0.3, secs: 14400 }, { src: 'stella', recipe: { auras: { tempest: 1, stormal: 1, wind: 15 }, potions: { speed: 25, lucky: 25 } } }, '+200% luck and +30% roll speed for 4 hours.'),
  P('poseidon', 'Godly Potion (Poseidon)', '#29b6f6', 'godly', { luck: -0.5, speed: 0.75, secs: 14400 }, { src: 'stella', recipe: { auras: { aquamarine: 3, stormal: 1 }, potions: { speed: 50 } } }, '-50% luck but +75% roll speed for 4 hours.'),
  P('hades', 'Godly Potion (Hades)', '#7e57c2', 'godly', { luck: 3, speed: -0.3, secs: 14400 }, { src: 'stella', recipe: { auras: { undead: 1, diaboli: 6, bleeding: 6 }, potions: { lucky: 50 } } }, '+300% luck but -30% roll speed for 4 hours.'),
  P('godlike', 'Godlike Potion', '#ff80ab', 'star', { oneRoll: 400000 }, { src: 'stella', recipe: { potions: { zeus: 1, poseidon: 1, hades: 1, lucky: 600 } } }, '+40,000,000% luck on your next roll.'),
  P('mixed', 'Mixed Potion', '#ab47bc', 'round', { luck: 0.25, speed: 0.1, secs: 180 }, { src: 'mari', price: { coins: 900 } }, '+25% luck and +10% roll speed for 3 minutes.'),
  P('strange1', 'Strange Potion I', '#9e9e9e', 'swirl', { strange: 1, secs: 300 }, { src: 'jester', price: { coins: 15000 } }, 'A random effect for 5 minutes. Could be great. Could be awful.'),
  P('strange2', 'Strange Potion II', '#616161', 'swirl', { strange: 2, secs: 600 }, { src: 'jester', price: { coins: 60000 } }, 'A stronger random effect for 10 minutes, good or bad.'),
  P('bound', 'Potion of Bound', '#8e24aa', 'ornate', { oneRoll: 50000 }, { src: 'jester stella', price: { coins: 400000 }, recipe: { auras: { blizzard: 3, lostsoul: 20 }, potions: { lucky: 100 } } }, '+5,000,000% luck on your next roll.'),
  P('heavenly', 'Heavenly Potion', '#fff3b0', 'star', { oneRoll: 150000 }, { src: 'jester stella', price: { coins: 1500000 }, recipe: { auras: { celestial: 2, exotic: 1, quartz: 5 }, potions: { lucky: 250 } } }, '+15,000,000% luck on your next roll.'),
  P('oblivion', 'Oblivion Potion', '#3a0f6b', 'void', { oneRoll: 1000000 }, { src: 'jester', price: { void: 5 } }, '+1,000,000 luck on your next roll. Only the Jester has these.'),
  P('warp', 'Warp Potion', '#7c4dff', 'hourglass', { rollSpeed: { n: 2000, speed: 10 } }, { src: 'stella', recipe: { auras: { arcane: 1, comet: 5, lunar: 50 }, potions: { speed: 500 } } }, '+1,000% roll speed for your next 2,000 rolls.'),
  P('transcendent', 'Transcendent Potion', '#f5f5f5', 'hourglass', { rollSpeed: { n: 20000, speed: 10 } }, { src: 'quest' }, '+1,000% roll speed for your next 20,000 rolls.'),
  P('gladiator', 'Gladiator Potion', '#e53935', 'ornate', { luck: 1, secs: 600 }, { src: 'quest' }, '+100% luck for 10 minutes. Earned in PvP.'),
  P('forbidden1', 'Forbidden Potion I', '#6a1b9a', 'dark', { luck: 0.5, speed: 0.2, secs: 1800, group: 'forbidden', level: 1 }, { src: 'stella', recipe: { auras: { forbidden: 1 }, potions: { lucky: 2, speed: 2 } } }, '+50% luck and +20% roll speed for 30 minutes.'),
  P('forbidden2', 'Forbidden Potion II', '#4a148c', 'dark', { luck: 2.5, speed: 0.5, secs: 3600, group: 'forbidden', level: 2 }, { src: 'stella', recipe: { auras: { raven: 1 }, potions: { lucky: 20, speed: 20 } } }, '+250% luck and +50% roll speed for 1 hour.'),
  P('forbidden3', 'Forbidden Potion III', '#311b92', 'dark', { luck: 10, speed: 2, secs: 10800, group: 'forbidden', level: 3 }, { src: 'stella', recipe: { auras: { phantom: 1 }, potions: { lucky: 100, speed: 100 } } }, '+1,000% luck and +200% roll speed for 3 hours.'),
  P('raid', 'Raid Potion', '#ff7043', 'big', { luck: 1, secs: 600 }, { src: 'quest' }, '+100% luck for 10 minutes.'),
  P('dune', 'Potion of the Dune', '#d4a85a', 'ornate', { oneRoll: 10000 }, { src: 'map' }, '+1,000,000% luck on your next roll. Lies in the sand during a Sandstorm.'),
  P('redmoon', 'Red Moon Potion', '#c62828', 'ornate', { oneRoll: 11000 }, { src: 'map' }, '+1,100,000% luck on your next roll. Shows up in Hell at night.'),
  P('universe', 'Universe Potion I', '#5c6bc0', 'star', { universe: true, secs: 600 }, { src: 'stella', recipe: { auras: { rare: 15, comet: 2 }, potions: { lucky: 10 } } }, 'Starfall auras can be rolled anywhere for 10 minutes.'),
  P('heavenly1', 'Heavenly Potion I', '#fff8e1', 'star', { oneRoll: 10000 }, { src: 'event' }, '+1,000,000% luck on your next roll. An old event potion.'),
  P('heavenly2', 'Heavenly Potion II', '#ffecb3', 'star', { boost: { n: 2, l: 20000 } }, { src: 'event' }, '+2,000,000% luck on your next 2 rolls. An old event potion.'),
  P('santa', 'Santa Claus Potion', '#e53935', 'round', { luck: 1, speed: 0.2, secs: 900 }, { src: 'event' }, '+100% luck and +20% roll speed for 15 minutes. Ho ho ho.'),
  P('sizemin', 'Sizemin Potion', '#81d4fa', 'vial', { size: 'min', secs: 300 }, { src: 'event' }, 'Shrinks you for 5 minutes.'),
  P('sizemax', 'Sizemax Potion', '#ef9a9a', 'big', { size: 'max', secs: 300 }, { src: 'event' }, 'Makes you huge for 5 minutes.'),
  P('pumpking', 'Pump King\'s Blood', '#ff6f00', 'skull', { luck: 3, secs: 900, hellAnywhere: true }, { src: 'event' }, '+300% luck for 15 minutes, and Hell auras can be rolled anywhere.'),
  P('xyz', '???', '#00ffd0', 'swirl', { mystery: true, secs: 300 }, { src: 'event' }, 'Nobody knows what this does.'),
  // not real potions: the bonuses for the Sky Parkour and the bell on the mountain
  P('parkour', 'Head in the Clouds', '#9fd8ff', 'round', { luck: 0.3, secs: 60 }, { hidden: true }, '+30% luck for 1 minute, for finishing the Sky Parkour.'),
  P('summit', 'Summit Blessing', '#ffffff', 'round', { luck: 0.5, secs: 120 }, { hidden: true }, '+50% luck for 2 minutes, for ringing the bell on the mountain.'),
];
export const POTION = Object.fromEntries(POTIONS.map(p => [p.id, p]));
// Strange Potions: what they can turn into (luck, speed).
export const STRANGE = {
  1: [{ name: 'The Chosen', luck: 1.5, speed: 0.3, w: 1 }, { name: 'The Power I', luck: 1.5, w: 3 }, { name: 'The Knowledge I', speed: 0.3, w: 3 }, { name: 'The Wrath I', luck: -0.5, w: 2 }, { name: 'The Sloth I', speed: -0.15, w: 2 }],
  2: [{ name: 'GODLIKE', luck: 2.5, speed: 0.4, w: 1 }, { name: 'The Power II', luck: 2.5, w: 3 }, { name: 'The Knowledge II', speed: 0.4, w: 3 }, { name: 'The Wrath II', luck: -1, w: 2 }, { name: 'The Sloth II', speed: -0.25, w: 2 }],
};
// Potions that come out of the ground and the old ones from earlier versions, so old saves keep their stuff.
export const POTION_RENAMES = { heavenly1: 'heavenly1', clover: 'luckxl', sprint: 'speedxl', chrono: 'lucky', midas: 'mixed', mutagen: 'mixed', angler: 'diver', stormflask: 'luckl', frostflask: 'luckl', solartonic: 'luckl', celestialdew: 'luckxl', voiddraught: 'luckxl', starcandle: 'luckl', sunbrew: 'luckl' };

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
  { id: 'midasring', name: 'Midas Ring', color: '#ffc107', coin: 0.5, price: { f: 2000 }, desc: '+50% coins from everything you pick up and every quest.', daily: true },
  { id: 'stargazer', name: 'Stargazer Charm', color: '#7986cb', luck: 1, when: 'night', price: { coins: 300000 }, desc: '+100% luck at night.', daily: true },
  { id: 'sunforged', name: 'Sunforged Charm', color: '#ff8f00', luck: 1, when: 'day', price: { coins: 300000 }, desc: '+100% luck during the day.', daily: true },
  { id: 'voidmagnet', name: 'Void Magnet', color: '#4a148c', voidLuck: 2, price: { f: 4000 }, desc: 'Void Coins bite 3x as often.', daily: true },
];
export const ITEM = Object.fromEntries(ITEMS.map(i => [i.id, i]));

// ---------------- things lying on the ground ----------------
// One appears every so often at a random spot. Walk into it to pick it up.
export const PICKUPS = [
  { id: 'coin', kind: 'coins', min: 40, max: 160, w: 40, color: '#ffd54f', name: 'Coins' },
  { id: 'gilded', kind: 'coins', min: 600, max: 1200, w: 4, color: '#ffb300', name: 'Gilded Coin' },
  { id: 'lucky', kind: 'potion', w: 26, name: 'Lucky Potion' },
  { id: 'speed', kind: 'potion', w: 22, name: 'Speed Potion' },
  { id: 'mixed', kind: 'potion', w: 3, name: 'Mixed Potion' },
  { id: 'spoid1', kind: 'potion', w: 2, name: 'Fortune Spoid I' },
  { id: 'stellastar', kind: 'star', w: 6, weather: 'starfall', name: 'Stella\'s Star', color: '#9fd0ff' },
  { id: 'dune', kind: 'potion', w: 0.6, weather: 'sandstorm', name: 'Potion of the Dune' },
  { id: 'redmoon', kind: 'potion', w: 0.6, weather: 'hell', night: true, name: 'Red Moon Potion' },
];

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
  { id: 'sunfish', name: 'Blazing Sunfish', color: '#ffab40', value: 50, w: 6, weather: 'sandstorm' },
  { id: 'starfish', name: 'Falling Starfish', color: '#9fb8ff', value: 60, w: 6, weather: 'starfall' },
  { id: 'gustfish', name: 'Gustfin', color: '#e0fbff', value: 40, w: 6, weather: 'windy' },
  { id: 'sludge', name: 'Sludge Eel', color: '#9cff3a', value: 50, w: 6, weather: 'corruption' },
  { id: 'glitchfish', name: 'Glitchfish', color: '#00ffd0', value: 70, w: 6, weather: 'null' },
  { id: 'bitfish', name: '01 Fish', color: '#00ff41', value: 150, w: 8, weather: 'glitched' },
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
  { kind: 'potion', id: 'oblivion', price: { coins: 2500000 } },
  { kind: 'potion', id: 'godlike', price: { coins: 900000 } },
  { kind: 'potion', id: 'transcendent', price: { coins: 300000 } },
  { kind: 'potion', id: 'heavenly', price: { coins: 1000000 } },
  { kind: 'potion', id: 'bound', price: { f: 1200 } },
  { kind: 'potion', id: 'zeus', price: { coins: 180000 } },
  { kind: 'potion', id: 'forbidden3', price: { coins: 600000 } },
  { kind: 'potion', id: 'warp', price: { f: 2500 } },
  { kind: 'potion', id: 'strange2', price: { coins: 40000 } },
  { kind: 'item', id: 'cosmicdice' }, { kind: 'item', id: 'hourglass' }, { kind: 'item', id: 'abyssrod' }, { kind: 'item', id: 'mutlens' },
  { kind: 'item', id: 'midasring' }, { kind: 'item', id: 'stargazer' }, { kind: 'item', id: 'sunforged' }, { kind: 'item', id: 'voidmagnet' },
  { kind: 'void', id: 'void', price: { f: 1500 } },
];
export const dayIndex = now => Math.floor(now / 86400000);
export function dailyStock(day) {
  const rnd = seeded(day);
  const pool = [...DAILY_POOL];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 5).map(o => ({ ...o, price: o.price || ITEM[o.id].price }));
}

// ---------------- quests ----------------
// Three daily quests, the same for everyone each day. stat: what counts towards it.
export const DAILY_QUESTS = [
  { id: 'roll500', text: 'Roll 500 times', stat: 'rolls', goal: 500, reward: { coins: 1500, potions: { lucky: 3 } } },
  { id: 'roll1500', text: 'Roll 1,500 times', stat: 'rolls', goal: 1500, reward: { coins: 4000, potions: { fortune1: 1 } } },
  { id: 'fish5', text: 'Catch 5 fish', stat: 'fish', goal: 5, reward: { coins: 1200, potions: { speed: 3 } } },
  { id: 'fish12', text: 'Catch 12 fish', stat: 'fish', goal: 12, reward: { coins: 3000, potions: { haste1: 1 } } },
  { id: 'pick6', text: 'Pick up 6 things around the island', stat: 'pickups', goal: 6, reward: { coins: 1000, potions: { lucky: 2, speed: 2 } } },
  { id: 'pick15', text: 'Pick up 15 things around the island', stat: 'pickups', goal: 15, reward: { coins: 2500, potions: { fortune2: 1 } } },
  { id: 'pot3', text: 'Use 3 potions', stat: 'potions', goal: 3, reward: { coins: 800, potions: { mixed: 1 } } },
  { id: 'rare1', text: 'Roll an aura rarer than 1 in 1,000', stat: 'rare', goal: 1, reward: { coins: 2000, potions: { fortune1: 1 } } },
  { id: 'anom1', text: 'Roll an aura rarer than 1 in 10,000', stat: 'anom', goal: 1, reward: { coins: 5000, potions: { hugefortune: 1 } } },
  { id: 'biome200', text: 'Roll 200 times during a biome', stat: 'biomeRolls', goal: 200, reward: { coins: 2500, potions: { haste2: 1 } } },
  { id: 'obby', text: 'Finish the Sky Parkour', stat: 'obby', goal: 1, reward: { coins: 1500, potions: { lucky: 3 } } },
  { id: 'bell', text: 'Ring the bell on the mountain top', stat: 'bell', goal: 1, reward: { coins: 2000, potions: { fortune2: 1 } } },
  { id: 'moves20', text: 'Use your aura\'s moves 20 times', stat: 'moves', goal: 20, reward: { coins: 1500, potions: { raid: 1 } } },
];
export function dailyQuests(day) {
  const rnd = seeded(day * 7 + 3), pool = [...DAILY_QUESTS], out = [];
  while (out.length < 3 && pool.length) {
    const q = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    if (out.some(o => o.stat === q.stat)) continue;
    out.push(q);
  }
  return out;
}
// Side quests: one time each, given by people around the island.
export const SIDE_QUESTS = [
  { id: 'stella', giver: 'Stella', where: 'the cave in the mountain', title: 'Let\'s find the magical ingredient', text: 'Stella needs one Stella\'s Star for her brew. They only fall during Starfall, somewhere on the island.', reward: 'A portal to her camp, and her cauldron opens.' },
  { id: 'summit', giver: 'Old Finn', where: 'the dock', title: 'The Bell at the Top', text: 'Old Finn hung a bell on top of the mountain years ago. Climb up and ring it.', reward: '3 Fortune Potion II' },
  { id: 'cards', giver: 'The Jester', where: 'his tent', title: 'Cards of the Jester', text: 'The Jester lost three cards: one up high, one behind falling water, one deep underground.', reward: 'Strange Potion II and a Void Coin' },
  { id: 'koi', giver: 'Marlin', where: 'the fish market', title: 'The One That Got Away', text: 'Marlin wants to see a Spirit Koi (Waterfall Pool) and a Moon Jelly (Sunset Lagoon, at night). Bring one of each.', reward: 'Golden Rod' },
  { id: 'ghost', giver: 'The Ghost', where: 'the graveyard, at night', title: 'Lost and Found', text: 'A ghost lost her locket in Tower Creek. Fish for it at night.', reward: 'Moon Locket and 5,000 coins' },
  { id: 'gladiator', giver: 'Nova', where: 'the daily shop', title: 'Gladiator', text: 'Knock out 5 players with PvP on.', reward: '3 Gladiator Potions' },
  { id: 'parkour', giver: 'The sign', where: 'the Sky Parkour by the plaza', title: 'Head in the Clouds', text: 'Finish the floating parkour next to the plaza.', reward: '2,500 coins, and +30% luck for a minute every time you finish' },
];
export const SIDE_QUEST = Object.fromEntries(SIDE_QUESTS.map(q => [q.id, q]));
// Codes anyone can redeem (the Owner and Co-Owners can make more in the Admin panel). Case-sensitive, like Sol's.
export const BUILTIN_CODES = {
  FRIXION: { potions: { lucky: 5, speed: 5 } },
  OVERCONTROL: { potions: { fortune1: 1, haste1: 1 }, coins: 2000 },
  hello_sol: { potions: { mixed: 2 } },
};

// ---------------- the shared clock: everyone sees the same time, biome and Jester ----------------
export const DAY_MS = 10 * 60 * 1000;              // day and night swap every 10 minutes
export const WEATHER_SLOT_MS = 8 * 60 * 1000;      // a biome can start every 8 minutes
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
const BIOME_ODDS = [['windy', 0.12], ['rain', 0.11], ['snow', 0.09], ['sandstorm', 0.07], ['hell', 0.05], ['starfall', 0.05], ['heaven', 0.04], ['corruption', 0.04], ['null', 0.03], ['glitched', 0.015]];
export function weatherAt(now, world = {}) {
  if (world.weather && world.weather.until > now) return world.weather.type;
  const slot = Math.floor(now / WEATHER_SLOT_MS);
  if (now - slot * WEATHER_SLOT_MS > WEATHER_LEN_MS) return 'clear';
  let r = hash01(slot + 7);
  for (const [w, p] of BIOME_ODDS) { if (r < p) return w; r -= p; }
  return 'clear';
}
// when the current biome ends (for the timer in the corner)
export function weatherEndsAt(now, world = {}) {
  if (world.weather && world.weather.until > now) return world.weather.until;
  const slot = Math.floor(now / WEATHER_SLOT_MS);
  return slot * WEATHER_SLOT_MS + WEATHER_LEN_MS;
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
