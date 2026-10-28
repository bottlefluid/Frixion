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
  // ---- Halloween: only during the Pumpkin Moon, Graveyard and Blood Rain biomes ----
  A('lantern', 'Jack-o\'-Lantern', 13000, '#ff8a00', [L.flames('#ff9800', '#4a1a00', { n: 26 }), L.halo('#ffb74d'), L.motes('#ffcc80', 16)], { weather: 'pumpkinmoon' }),
  A('wraith', 'Wraith', 66666, '#cfd8dc', [L.motes('#eceff1', 50, { size: 0.7 }), L.wings('#90a4ae'), L.glow('#263238', 5, { dark: 1 })], { weather: 'graveyard' }),
  A('undertaker', 'Undertaker', 300000, '#78909c', [L.fall('#37474f', { dark: 1, n: 40 }), L.halo('#b0bec5', { crown: 1 }), L.pillar('#546e7a')], { weather: 'graveyard' }),
  A('bloodmoon', 'Blood Moon', 6660000, '#d50000', [L.halo('#ff1744', { r: 1.2, eclipse: 1 }), L.fall('#b71c1c', { rain: 1, n: 50 }), L.ring('#d50000', { r: 3, runes: 1 })], { weather: 'bloodrain' }),
  A('pumpking', 'PUMP KING', 66666666, '#ff6f00', [L.halo('#ffab00', { crown: 1 }), L.flames('#ff6f00', '#3e1300', { big: 1 }), L.orbit('#ffb300', 7, { r: 3, trail: 1 }), L.pillar('#ff8f00')], { weather: 'pumpkinmoon' }, { gold: 1 }),
  A('hallowed', '『HALLOWED』', 1313131313, '#ff6d00', [L.wings('#212121', { big: 1, many: 1 }), L.flames('#ff6d00', '#000000', { big: 1 }), L.ring('#ff6d00', { r: 3.8, runes: 1 }), L.pillar('#ff3d00', { tall: 1 }), L.motes('#000000', 40, { dark: 1 })], { weather: 'halloween' }),
  // ---- Limbo: a place between places. These can only be rolled while you are there. ----
  A('limbo', 'Limbo', 99999, '#e0e0e0', [L.motes('#ffffff', 40), L.ring('#9e9e9e', { r: 2.6, half: 1 }), L.glow('#000000', 5, { dark: 1 })], { weather: 'limbo' }),
  A('unknown', 'The Unknown', 9999999, '#9e9e9e', [L.cubes('#ffffff', 10), L.cubes('#000000', 10, { dark: 1 }), L.halo('#ffffff', { eye: 1 }), L.pillar('#bdbdbd', { tall: 1 })], { weather: 'limbo' }),
  // One aura, like Sol's: 『EQUINOX』, the Equilibrium Incarnate. A white sun and a black sun in balance.
  // only from beating ____X____: be his top damager, never die, and do at least 250 damage
  A('xboss', '____X____', 999999999, '#b388ff', [{ t: 'weapons' }, L.spiral('#9c6bff', { n: 36 }), L.motes('#b388ff', 26), L.motes('#ffffff', 14), L.ring('#7c4dff', { r: 3.2, runes: 1 })], { boss: true }, { violet: 1 }, { sub: 'Slayer of the Undying' }),
  A('equinox', '『EQUINOX』', 2500000000, '#ffffff', [L.yinyang({ r: 3.4, huge: 1 }), L.ring('#ffffff', { r: 3.8, half: 1, runes: 1 }), L.motes('#ffffff', 30), L.motes('#000000', 30, { dark: 1 })], null, { bw: 1 }, { sub: 'Equilibrium Incarnate', float: true }),
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
  // Halloween only (mid October to early November)
  pumpkinmoon: { id: 'pumpkinmoon', name: 'Pumpkin Moon', color: '#ff9100', bt: 1, event: true, desc: 'A Halloween night. Jack-o\'-Lantern and the PUMP KING come out, and so does 『HALLOWED』.' },
  graveyard: { id: 'graveyard', name: 'Graveyard', color: '#9ccc9c', bt: 1, event: true, desc: 'The dead walk. Wraith and Undertaker rise, and so does 『HALLOWED』.' },
  bloodrain: { id: 'bloodrain', name: 'Blood Rain', color: '#ff1744', bt: 1, event: true, desc: 'It rains red. Blood Moon can be rolled, and so can 『HALLOWED』.' },
  // not a biome you can see: where you are when you stand in Limbo
  limbo: { id: 'limbo', name: 'Limbo', color: '#e0e0e0', bt: 1, hidden: true, desc: 'Between places.' },
};
// The Halloween event: from October 15 to November 10, every year.
export const isHalloween = (now = Date.now()) => { const d = new Date(now), m = d.getUTCMonth(), day = d.getUTCDate(); return (m === 9 && day >= 15) || (m === 10 && day <= 10); };
export const HALLOWEEN_BIOMES = ['pumpkinmoon', 'graveyard', 'bloodrain'];

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
      if (a.only.boss) continue;   // never rolled
      if (a.only.time && a.only.time !== time) continue;
      const ow = a.only.weather;
      if (ow === 'limbo') { if (weather !== 'limbo') continue; }
      else if (ow === 'halloween') { if (!HALLOWEEN_BIOMES.includes(weather)) continue; }
      else if (ow && ow !== weather && weather !== 'glitched' && !anyW.includes(ow)) continue;
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
  balance: { z: ['burst', 'Duality'], x: ['beam', 'Twin Lance'], c: ['vortex', 'Yin and Yang'], v: ['nova', 'Equilibrium'], f: ['flight', 'Weightless'] },
  warrior: { z: ['burst', 'Sweeping Edge'], x: ['beam', 'Axe Cleave'], c: ['dash', 'Spear Lunge'], v: ['meteor', 'Mace Smash'], f: ['blink', 'Ender Pearl'] },
};
const ELEMENT_OF = {};
for (const [el, ids] of Object.entries({
  fire: 'rage ember solaris eclipse bloodlust diaboli hades bleeding velvet lantern pumpking bloodmoon',
  ice: 'glacier frostbite blizzard crystallized quartz',
  storm: 'stormal tempest static magnetic',
  light: 'divinus aether seraphim celestial archangel dawnbreaker genesis gilded solar sovereign',
  dark: 'ink raven spectre phantom lostsoul requiem forbidden undead lunar twilight wraith undertaker hallowed',
  nature: 'natural flora uncommon honey jade emerald flutter',
  water: 'aquamarine leviathan sapphire',
  star: 'starlight sidereum comet galaxy nebula astral aurora starscourge overseer singularity',
  void: 'nullified overcontrol limbo unknown',
  gem: 'topaz ruby precious kyawthuite prism jackpot exotic chromatic rare good common',
  wind: 'wind gale echo',
  earth: 'mirage pharaoh hazard',
  toxic: 'corrosive parasite monarch',
  glitch: 'matrix fault deleted paradox',
  balance: 'equinox',
  warrior: 'xboss',
})) ids.split(' ').forEach(id => { ELEMENT_OF[id] = el; });
export const elementOf = id => ELEMENT_OF[id] || 'arcane';
const HAS_F = new Set('wind gale magnetic static comet phantom tempest leviathan aurora dawnbreaker starscourge singularity overcontrol genesis archangel seraphim aether paradox fault monarch pharaoh astral equinox hallowed unknown wraith'.split(' '));
// The moves an aura gives you: [{ key: 'z', kind, name, cd, dmg, ... }]
export function movesFor(key) {
  const { aura, mut } = auraKey(key);
  const t = tierIndex(aura.rarity);
  const el = ELEMENTS[ELEMENT_OF[aura.id] || 'arcane'];
  const keys = [];
  if (aura.id === 'equinox' || aura.id === 'xboss') keys.push('z', 'x', 'c', 'v', 'f');
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
    // 『EQUINOX』's F turns flight on and off instead of lasting a few seconds
    const toggle = aura.id === 'equinox' && k === 'f' ? { toggle: true, cd: 0.6 } : {};
    return { key: k, kind, name, ...base, dmg: base.dmg ? Math.round(base.dmg * power) : 0, color: mut ? mut.color : aura.c, tier: t, ...toggle };
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
  P('warp', 'Warp Potion', '#7c4dff', 'hourglass', { batch: 2000 }, { src: 'stella', recipe: { auras: { arcane: 1, comet: 5, lunar: 50 }, potions: { speed: 500 } } }, 'Rolls 2,000 times, instantly.'),
  P('transcendent', 'Transcendent Potion', '#f5f5f5', 'hourglass', { batch: 20000 }, { src: 'quest' }, 'Rolls 20,000 times, instantly.'),
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
  // ---- items you use, like Sol's: chests, runes and biome changers (they sit in the Items tab with the potions) ----
  P('chest1', 'Potion Chest', '#a1887f', 'chest', { chest: 1 }, { src: 'achievement pass', cat: 'item' }, 'Opens into 3 random potions.'),
  P('chest2', 'Rare Potion Chest', '#7e57c2', 'chest', { chest: 2 }, { src: 'achievement pass', cat: 'item' }, 'Opens into 4 better potions.'),
  P('chest3', 'Mega Potion Chest', '#ffb300', 'chest', { chest: 3 }, { src: 'achievement pass', cat: 'item' }, 'Opens into 5 great potions, maybe a godly one.'),
  P('rune_wind', 'Rune of Wind', '#bdf4ff', 'rune', { biome: 'windy' }, { src: 'jester', price: { coins: 30000 }, cat: 'item' }, 'Starts a Windy biome for everyone.'),
  P('rune_frost', 'Rune of Frost', '#e3f6ff', 'rune', { biome: 'snow' }, { src: 'jester', price: { coins: 30000 }, cat: 'item' }, 'Starts a Snowy biome for everyone.'),
  P('rune_rain', 'Rune of Rainstorm', '#8fb6ff', 'rune', { biome: 'rain' }, { src: 'jester', price: { coins: 30000 }, cat: 'item' }, 'Starts a Rainy biome for everyone.'),
  P('rune_sand', 'Rune of Dust', '#f0c87a', 'rune', { biome: 'sandstorm' }, { src: 'jester', price: { coins: 60000 }, cat: 'item' }, 'Starts a Sandstorm for everyone.'),
  P('rune_hell', 'Rune of Hell', '#ff4a2b', 'rune', { biome: 'hell' }, { src: 'jester', price: { coins: 120000 }, cat: 'item' }, 'Starts a Hell biome for everyone.'),
  P('rune_galaxy', 'Rune of Galaxy', '#8fb0ff', 'rune', { biome: 'starfall' }, { src: 'jester', price: { coins: 120000 }, cat: 'item' }, 'Starts a Starfall for everyone.'),
  P('rune_corruption', 'Rune of Corruption', '#c06bff', 'rune', { biome: 'corruption' }, { src: 'jester', price: { coins: 150000 }, cat: 'item' }, 'Starts a Corruption for everyone.'),
  P('rune_nothing', 'Rune of Nothing', '#9e9e9e', 'rune', { biome: 'null' }, { src: 'jester', price: { coins: 200000 }, cat: 'item' }, 'Starts a Null biome for everyone.'),
  P('rune_everything', 'Rune of Everything', '#ffffff', 'rune', { biome: 'random' }, { src: 'achievement', cat: 'item' }, 'Starts any biome at all, for everyone.'),
  P('randomizer', 'Biome Randomizer', '#26a69a', 'device', { biome: 'random' }, { src: 'mari', price: { coins: 50000 }, cat: 'item' }, 'Starts a random biome for everyone.'),
  P('controller', 'Strange Controller', '#00ffd0', 'device', { biome: 'strange' }, { src: 'jester', price: { coins: 90000 }, cat: 'item' }, 'Starts a random biome for everyone, with a 1 in 10 chance of Glitched.'),
  P('penny', 'Lucky Penny', '#c77c3c', 'coin', { luck: 0.77, secs: 420 }, { src: 'mari', price: { coins: 77777 }, cat: 'item' }, '+77% luck for 7 minutes.'),
  P('candy', 'Candy Corn Brew', '#ff9800', 'round', { luck: 0.5, speed: 0.1, secs: 300 }, { src: 'jack event', cat: 'potion' }, '+50% luck and +10% roll speed for 5 minutes. Halloween only.'),
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

// ---------------- gears: crafted at Jake's Workshop, worn one in each hand (like Sol's) ----------------
// Right hand: luck and roll speed. Left hand: changes to the bonus roll.
//   luck, speed            always            wLuck {w: [biomes], l}  luck in those biomes   wSpeed {w, s}  speed in a biome
//   bonusEvery             bonus roll every n rolls (instead of 10)       bonusMult  how lucky the bonus roll is (instead of 2x)
//   bonusAll               every roll is a bonus roll, at this multiplier  noBonus    no bonus roll at all (base luck is better instead)
//   gem                    every 10 rolls a random gem gives up to +30% luck or speed for 10 rolls
//   tide                   bonus rolls can roll Rainy auras anywhere       jackpotCoins  coins when you roll Jackpot
const GR = (id, name, hand, color, fx, recipe, desc, more = {}) => ({ id, name, hand, color, ...fx, recipe, desc, ...more });
export const GEARS = [
  GR('luckglove', 'Luck Glove', 'right', '#81c784', { luck: 0.25 }, { auras: { common: 25, uncommon: 10, good: 10, rare: 5 } }, '+25% luck.'),
  GR('lunardevice', 'Lunar Device', 'right', '#9fa8da', { speed: 0.15 }, { auras: { rare: 1, divinus: 1, lunar: 1 } }, '+15% roll speed.'),
  GR('solardevice', 'Solar Device', 'right', '#ffb300', { luck: 0.5 }, { auras: { rare: 1, divinus: 1, solar: 1 } }, '+50% luck.'),
  GR('desireglove', 'Desire Glove', 'right', '#e91e63', { luck: 0.4 }, { auras: { rage: 1, ruby: 1, diaboli: 1, bleeding: 1 } }, '+40% luck.'),
  GR('aquadevice', 'Aqua Device', 'right', '#26c6da', { speed: 0.1, wSpeed: { w: ['rain'], s: 0.9 } }, { auras: { aquamarine: 3, sapphire: 1 } }, '+10% roll speed, and +100% while it rains.'),
  GR('shiningstar', 'Shining Star', 'right', '#c5d3ff', { luck: 0.5, wLuck: { w: ['starfall'], l: 2 } }, { auras: { starlight: 1, comet: 1 } }, '+50% luck, and +250% during Starfall.'),
  GR('eclipsedevice', 'Eclipse Device', 'right', '#ff9100', { luck: 0.5, speed: 0.15 }, { gears: { solardevice: 1, lunardevice: 1 }, auras: { twilight: 1 } }, '+50% luck and +15% roll speed.'),
  GR('exogauntlet', 'Exo Gauntlet', 'right', '#90a4ae', { luck: 1, speed: 0.2 }, { auras: { gilded: 3, precious: 2, magnetic: 2, sidereum: 1, undead: 1, exotic: 1 } }, '+100% luck and +20% roll speed.'),
  GR('frozengauntlet', 'Frozen Gauntlet', 'right', '#b3e5fc', { luck: 1.5, speed: -0.25 }, { auras: { glacier: 1, blizzard: 1 } }, '+150% luck, but -25% roll speed.'),
  GR('windstorm', 'Windstorm Device', 'right', '#e0f7fa', { luck: 1.15, speed: 0.25 }, { auras: { wind: 25, stormal: 1, aquamarine: 1, sidereum: 4, precious: 12 } }, '+115% luck and +25% roll speed.'),
  GR('subzero', 'Subzero Device', 'right', '#80deea', { luck: 1.5, speed: 0.3 }, { auras: { blizzard: 2, crystallized: 300, glacier: 60, sidereum: 10, magnetic: 20, precious: 40 } }, '+150% luck and +30% roll speed.'),
  GR('galactic', 'Galactic Device', 'right', '#8a63ff', { luck: 2.5, speed: 0.3 }, { gears: { eclipsedevice: 1 }, auras: { galaxy: 1, sapphire: 100, solar: 15, magnetic: 60, diaboli: 80, comet: 3, lunar: 15 } }, '+250% luck and +30% roll speed.'),
  GR('volcanic', 'Volcanic Device', 'right', '#ff5722', { luck: 2.9, speed: 0.35 }, { gears: { solardevice: 1, windstorm: 1 }, auras: { hades: 1, diaboli: 140, rage: 1000, bleeding: 55 } }, '+290% luck and +35% roll speed.'),
  GR('ragnaroker', 'Ragnaröker', 'right', '#ffd54f', { luck: 4.55, speed: 0.4, wLuck: { w: ['windy', 'rain', 'hell'], l: 0.45 } }, { potions: { zeus: 3, hades: 3, poseidon: 3 }, auras: { solar: 175, lunar: 175, lostsoul: 35, sidereum: 80, diaboli: 320, rage: 2300 } }, '+455% luck and +40% roll speed, and +45% more luck when it is Windy, Rainy or Hell.'),
  GR('starshaper', 'Starshaper', 'right', '#b39dff', { luck: 7, speed: 0.5 }, { gears: { galactic: 1 }, auras: { starscourge: 1, galaxy: 3, comet: 90, solar: 150, lunar: 150, sidereum: 270, magnetic: 560 } }, '+700% luck and +50% roll speed.'),
  GR('genesisdrive', 'Genesis Drive', 'right', '#fff4d6', { luck: 12, speed: 1 }, { gears: { starshaper: 1 }, auras: { genesis: 1, matrix: 2, chromatic: 2, aether: 20, exotic: 40 } }, '+1,200% luck and +100% roll speed.'),
  GR('heavenlydevice', 'Heavenly Device', 'right', '#fffde7', { luck: 15, speed: 1.2 }, { gears: { genesisdrive: 1 }, auras: { archangel: 1, seraphim: 15, celestial: 10, divinus: 600 } }, '+1,500% luck and +120% roll speed.'),
  GR('vampirehunter', 'Vampire Hunter', 'right', '#8e0000', { luck: 2.4, speed: 0.3 }, null, '+240% luck and +30% roll speed. A Season Pass reward.', { pass: true }),
  GR('pumppunch', 'Pump Punch', 'right', '#ff6f00', { luck: 8, speed: -0.5 }, null, '+800% luck, but -50% roll speed. Jack trades it for Pumpkin Tokens.', { jack: true }),
  GR('gemstone', 'Gemstone Gauntlet', 'left', '#ff6ec7', { gem: true }, { auras: { topaz: 1, ruby: 1, emerald: 1, sapphire: 1, aquamarine: 1, quartz: 1 } }, 'Every 10 rolls, a random gem gives up to +30% luck or roll speed for the next 10 rolls.'),
  GR('jackpotgauntlet', 'Jackpot Gauntlet', 'left', '#ffd700', { luck: 0.77, speed: 0.07, jackpotCoins: 77 }, { auras: { rare: 777, gilded: 77, jackpot: 77 } }, '+77% luck and +7% roll speed, and 77 coins every time you roll Jackpot.'),
  GR('tidegauntlet', 'Tide Gauntlet', 'left', '#4fc3f7', { luck: 0.5, tide: true }, { auras: { solar: 3, rage: 1 } }, '+50% luck. Bonus rolls can roll Rainy auras in any biome.'),
  GR('darkshader', 'Darkshader', 'left', '#4a148c', { bonusEvery: 5 }, { auras: { arcane: 1, twilight: 5, ink: 115, lunar: 270, hazard: 225, bleeding: 350, diaboli: 1480, forbidden: 3700 } }, 'A bonus roll every 5 rolls instead of 10.'),
  GR('fleshdevice', 'Flesh Device', 'left', '#d81b60', { bonusAll: 1.3 }, { auras: { astral: 1, hazard: 30, corrosive: 15, undead: 10, crystallized: 600, ink: 190, bleeding: 30 } }, 'Every roll is a bonus roll, but bonus rolls are only 1.3x.'),
  GR('gravitational', 'Gravitational Device', 'left', '#5c6bc0', { bonusMult: 6 }, { auras: { exotic: 5, magnetic: 75, diaboli: 152, sidereum: 31, precious: 152 } }, 'Bonus rolls are 6x as lucky instead of 2x.'),
  GR('thething', 'The Thing', 'left', '#880e4f', { bonusMult: 11 }, { gears: { fleshdevice: 1 }, auras: { parasite: 20, hazard: 600, ink: 400, bleeding: 1000 } }, 'Bonus rolls are 11x as lucky instead of 2x.'),
  GR('polelight', 'Pole Light Core Device', 'left', '#e1f5fe', { luck: 5 }, { auras: { blizzard: 3, jade: 100, magnetic: 900, solar: 500, sidereum: 725 } }, '+500% luck.'),
  GR('ominouscoffin', 'Ominous Coffin', 'left', '#3e2723', { baseLuck: 1.35, noBonus: true, wSpeed: { w: ['pumpkinmoon', 'graveyard', 'bloodrain'], s: 0.3 } }, null, '1.35x base luck with no bonus roll, and +30% roll speed in Halloween biomes. A Season Pass reward.', { pass: true }),
];
export const GEAR = Object.fromEntries(GEARS.map(g => [g.id, g]));

// ---------------- achievements: Sol's-style milestones, each with a reward, some with a title ----------------
// test(s): s is a small summary of your save (see achieveStats in the game). Every 10 achievements: +5% luck forever.
const AC = (id, name, desc, test, reward, title) => ({ id, name, desc, test, reward, title });
export const ACHIEVEMENTS = [
  AC('roll1', 'Roll Once', 'Roll for the first time.', s => s.rolls >= 1, { coins: 10 }, 'Newbie'),
  AC('roll100', 'Getting Started', 'Roll 100 times.', s => s.rolls >= 100, { coins: 50 }),
  AC('roll1k', 'Roller', 'Roll 1,000 times.', s => s.rolls >= 1000, { coins: 300 }, 'Roller'),
  AC('roll10k', 'Dedicated', 'Roll 10,000 times.', s => s.rolls >= 10000, { coins: 3000, potions: { chest1: 2 } }, 'Dedicated'),
  AC('roll100k', 'Grinder', 'Roll 100,000 times.', s => s.rolls >= 100000, { coins: 10000, potions: { chest2: 2 } }, 'Grinder'),
  AC('roll1m', 'Unstoppable', 'Roll 1,000,000 times.', s => s.rolls >= 1000000, { coins: 50000, void: 1 }, 'Unstoppable'),
  AC('roll5m', 'Living Legend', 'Roll 5,000,000 times.', s => s.rolls >= 5000000, { coins: 100000, void: 2, potions: { transcendent: 1 } }, 'Living Legend'),
  AC('tier1', 'In the Shadows', 'Roll a Shadowed aura or rarer.', s => s.bestTier >= 1, { coins: 500 }),
  AC('tier2', 'Anomaly', 'Roll an Anomalous aura or rarer.', s => s.bestTier >= 2, { coins: 2000, potions: { chest1: 1 } }, 'Anomalous'),
  AC('tier3', 'Forbidden Knowledge', 'Roll a Forbidden aura or rarer.', s => s.bestTier >= 3, { potions: { chest2: 1 } }, 'Forbidden'),
  AC('tier4', 'Eldritch Truth', 'Roll an Eldritch aura or rarer.', s => s.bestTier >= 4, { potions: { chest3: 1 } }, 'Eldritch'),
  AC('tier5', 'Cataclysm', 'Roll a Cataclysmic aura or rarer.', s => s.bestTier >= 5, { void: 1, potions: { chest3: 1 } }, 'Cataclysmic'),
  AC('tier6', 'Primordial', 'Roll a Primordial aura or rarer.', s => s.bestTier >= 6, { void: 3 }, 'Primordial'),
  AC('tier7', 'Nothing Is Real', 'Roll a null aura.', s => s.bestTier >= 7, { void: 5, potions: { rune_everything: 1 } }, 'null'),
  AC('equinox', 'Equilibrium', 'Roll 『EQUINOX』.', s => s.found.equinox, { void: 10, potions: { heavenly: 3 } }, 'Equilibrium Incarnate'),
  AC('glitchmut', 'Flaws in the World', 'Roll a Glitched aura (the mutation).', s => s.glitchMut, { void: 1 }),
  AC('monarch', 'Fate Sealer', 'Roll Monarch.', s => s.found.monarch, { potions: { oblivion: 1 } }),
  AC('deleted', 'Content Deleted', 'Roll [ DELETED ].', s => s.found.deleted, { potions: { controller: 10 } }, 'Deleted'),
  AC('hallowed', 'Trick or Treat', 'Roll 『HALLOWED』.', s => s.found.hallowed, { void: 5, potions: { pumpking: 3 } }, 'Hallowed'),
  AC('collect25', 'Collector', 'Find 25 different auras.', s => s.foundCount >= 25, { potions: { chest1: 3 } }, 'Collector'),
  AC('collect50', 'Curator', 'Find 50 different auras.', s => s.foundCount >= 50, { potions: { chest2: 3 } }, 'Curator'),
  AC('collect75', 'Archivist', 'Find 75 different auras.', s => s.foundCount >= 75, { potions: { chest3: 3 } }, 'Archivist'),
  AC('glitchbiome', 'Something Went Wrong', 'Be there for a Glitched biome.', s => s.biomes.glitched, { coins: 10101 }),
  AC('allbiomes', 'Storm Chaser', 'See every natural biome.', s => ['windy', 'rain', 'snow', 'sandstorm', 'hell', 'starfall', 'heaven', 'corruption', 'null', 'glitched'].every(b => s.biomes[b]), { potions: { chest2: 2 } }, 'Storm Chaser'),
  AC('limbo', 'Lost in Limbo', 'Find your way into Limbo.', s => s.eggs.limbo, { potions: { chest2: 1 } }, 'Lost'),
  AC('play30', 'Take a Break', 'Play for 30 minutes.', s => s.playSecs >= 1800, { potions: { chest1: 3 } }),
  AC('play60', 'I Can\'t Stop Playing This', 'Play for 1 hour.', s => s.playSecs >= 3600, { potions: { chest1: 5 } }),
  AC('play600', 'The Day Is Going By Fast', 'Play for 10 hours.', s => s.playSecs >= 36000, { potions: { chest2: 5 } }, 'No Life'),
  AC('play6000', 'Touch the Grass', 'Play for 100 hours.', s => s.playSecs >= 360000, { potions: { chest3: 10 } }, 'Touch Grass'),
  AC('fish100', 'Angler', 'Catch 100 fish.', s => s.fish >= 100, { potions: { diver: 3 } }, 'Angler'),
  AC('leviathan', 'Sea Monster', 'Catch a Baby Leviathan.', s => s.caught.leviathan, { void: 1 }),
  AC('secrets10', 'Curious', 'Find 10 secrets.', s => s.secrets >= 10, { potions: { chest2: 1 } }, 'Curious'),
  AC('secretsall', 'Explorer', 'Find every secret.', s => s.secrets >= s.secretsTotal, { void: 3, potions: { chest3: 2 } }, 'Explorer'),
  AC('sidequests', 'Helping Hand', 'Finish every side quest.', s => s.sideDone >= s.sideTotal, { potions: { chest3: 1 } }, 'Helping Hand'),
  AC('ko10', 'Gladiator', 'Knock out 10 players in PvP.', s => s.kos >= 10, { potions: { gladiator: 3 } }, 'Gladiator'),
  AC('raid1', 'Raider', 'Help defeat The Crawler.', s => s.raids >= 1, { potions: { raid: 3, dune: 1 } }, 'Raider'),
  AC('craft1', 'Tinkerer', 'Craft a gear at Jake\'s Workshop.', s => s.crafted >= 1, { coins: 2500 }, 'Tinkerer'),
  AC('potions100', 'Alchemist', 'Use 100 potions.', s => s.potions >= 100, { potions: { chest2: 1 } }, 'Alchemist'),
  AC('daily10', 'Busy Bee', 'Claim 10 daily quests.', s => s.dailies >= 10, { potions: { chest2: 1 } }),
  AC('xboss1', 'Pop Goes the Totem', 'Help defeat ____X____.', s => s.xboss >= 1, { void: 2, potions: { chest3: 1 } }, 'Totem Popper'),
  AC('xaura', 'The Real ____X____', 'Earn the ____X____ aura.', s => s.found.xboss, { void: 5 }, '____X____'),
  AC('pass30', 'Seasoned', 'Reach level 30 on the Season Pass.', s => s.passLevel >= 30, { void: 2 }, 'Seasoned'),
];
export const ACHIEVEMENT = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));
// what potion chests open into
export const CHEST_POOLS = {
  1: { n: 3, pool: [['lucky', 30], ['speed', 30], ['luckl', 10], ['speedl', 10], ['mixed', 10], ['spoid1', 6], ['fortune1', 4]] },
  2: { n: 4, pool: [['luckxl', 20], ['speedxl', 20], ['fortune2', 15], ['haste2', 15], ['spoid2', 10], ['jewelry', 8], ['zombie', 6], ['strange1', 6]] },
  3: { n: 5, pool: [['fortune3', 20], ['haste3', 20], ['strange2', 14], ['bound', 8], ['zeus', 8], ['hades', 6], ['poseidon', 6], ['heavenly', 4], ['forbidden2', 6], ['transcendent', 2], ['godlike', 1]] },
};

// ---------------- the Season Pass: XP from rolling, fishing and quests; a reward at every level ----------------
// Free rewards for everyone; Frixion Premium unlocks the second row.
export const SEASON = { id: 1, name: 'Season of the Pumpkin Moon', levels: 30, xpFor: level => 200 + level * 40 };
export const PASS_REWARDS = Array.from({ length: 30 }, (_, i) => {
  const L = i + 1;
  const free = L === 10 ? { gears: ['ominouscoffin'] } : L === 30 ? { gears: ['vampirehunter'] } : L % 5 === 0 ? { potions: { chest2: 1 }, coins: 2500 * L / 5 } : L % 2 ? { potions: { lucky: 3 + L, speed: 2 + L } } : { coins: 500 * L };
  const prem = L === 30 ? { void: 5, potions: { heavenly: 2 } } : L % 10 === 0 ? { potions: { chest3: 2 } } : L % 5 === 0 ? { void: 1 } : L % 3 === 0 ? { potions: { fortune2: 2, haste2: 1 } } : { potions: { luckxl: 1, speedxl: 1 } };
  return { level: L, free, prem };
});

// ---------------- Jack the Pumpkin (Halloween): trades Pumpkin Tokens ----------------
export const JACK_SHOP = [
  { kind: 'potion', id: 'candy', tokens: 6 },
  { kind: 'potion', id: 'pumpking', tokens: 90 },
  { kind: 'potion', id: 'chest2', tokens: 35 },
  { kind: 'gear', id: 'pumppunch', tokens: 260 },
  { kind: 'title', id: 'Pumpkin Head', tokens: 50 },
];

// ---------------- Mari: a few rotating deals every 15 minutes, like Sol's traveling merchant ----------------
const MARI_EXTRA = [
  { kind: 'potion', id: 'penny' }, { kind: 'potion', id: 'randomizer' }, { kind: 'potion', id: 'spoid3' }, { kind: 'potion', id: 'luckxl', price: { coins: 1500 } },
  { kind: 'potion', id: 'speedxl', price: { coins: 1500 } }, { kind: 'void', price: { coins: 500000 } }, { kind: 'potion', id: 'chest1', price: { coins: 4000 } }, { kind: 'potion', id: 'strange1', price: { coins: 12000 } },
];
export const MARI_SLOT_MS = 15 * 60 * 1000;
export function mariDeals(now) {
  const rnd = seeded(Math.floor(now / MARI_SLOT_MS) * 13 + 5), pool = [...MARI_EXTRA], out = [];
  for (let i = 0; i < 3; i++) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}

// ---------------- the raid boss ----------------
// The Crawler: a giant sand worm that bursts out of the arena during Sandstorms (or when staff summon it).
export const RAID = { id: 'crawler', name: 'The Crawler', hpPer: 2500, hpMin: 6000, mins: 8, reward: { potions: { raid: 1 }, coins: 3000 }, duneChance: 0.25 };

// ---------------- aura lore, shown in the Collection ----------------
const LORE = {
  common: 'Where every story starts.', uncommon: 'A little greener than the rest.', good: 'Good enough.', rare: 'Rare, they say. You will see a lot of it.',
  divinus: 'A small blessing from somewhere above.', crystallized: 'Light, frozen in place.', rage: 'It burns hot and fast.', ruby: 'Red, deep and precious.',
  forbidden: 'Some things were left alone for a reason.', gilded: 'Everything it touches looks expensive.', jackpot: 'Seven, seven, seven.', wind: 'It never stays in one place.',
  magnetic: 'Opposites attract.', solar: 'The sun, worn like a crown.', lunar: 'Moonlight never lies.', starlight: 'Light that left its star long ago.',
  stormal: 'The calm never comes.', undead: 'It got back up.', comet: 'Gone before you can make a wish.', aether: 'The air the gods breathe.',
  nullified: 'Erased, almost.', exotic: 'No one knows where it came from.', celestial: 'Born among the stars.', galaxy: 'Billions of suns in a spiral.',
  arcane: 'Old magic, older than words.', eclipse: 'When the moon swallows the sun.', matrix: 'Wake up.', hades: 'Lord of everything below.',
  monarch: 'It rules the rot.', requiem: 'A song for the end.', overseer: 'It sees every roll.', bloodlust: 'Never full.', deleted: 'This aura has been removed.',
  starscourge: 'A plague of falling stars.', sovereign: 'Kneel.', paradox: 'It is and it is not.', archangel: 'The highest of the host.',
  singularity: 'Everything falls in.', overcontrol: 'The one who holds the dice.', genesis: 'The first light.', equinox: 'The white sun and the black sun, perfectly balanced. The Equilibrium Incarnate.',
  lantern: 'Carved with a grin.', wraith: 'Cold where it passes.', undertaker: 'Every grave, dug by hand.', bloodmoon: 'The moon bleeds on this night.', pumpking: 'All hail the King of the Patch.',
  hallowed: 'The night when the walls between worlds are thinnest.', limbo: 'Neither here nor there.', unknown: '???',
  fault: 'A crack in the code.', pharaoh: 'Buried with his gold.', mirage: 'It was never there.', gale: 'Hold on to something.', astral: 'Walks between constellations.', parasite: 'It is inside you now.',
};
const LORE_BY_ELEMENT = { fire: 'It burns.', ice: 'Cold to the touch.', storm: 'Charged with lightning.', light: 'Warm and bright.', dark: 'It lives in the shadows.', nature: 'Grown, not made.', water: 'From the deep.', star: 'From far above.', void: 'From nowhere.', gem: 'Cut and polished.', wind: 'Restless.', earth: 'From the sand.', toxic: 'Do not breathe it in.', glitch: 'ERROR.', arcane: 'Strange and old.', balance: 'In balance.' };
export const loreOf = id => LORE[id] || LORE_BY_ELEMENT[ELEMENT_OF[id] || 'arcane'];

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
// during Halloween the spooky biomes take some of Normal's place (Pumpkin Moon only at night)
const HALLOWEEN_ODDS = [['pumpkinmoon', 0.07], ['graveyard', 0.06], ['bloodrain', 0.04]];
export function weatherAt(now, world = {}) {
  if (world.weather && world.weather.until > now) return world.weather.type;
  const slot = Math.floor(now / WEATHER_SLOT_MS);
  if (now - slot * WEATHER_SLOT_MS > WEATHER_LEN_MS) return 'clear';
  let r = hash01(slot + 7);
  for (const [w, p] of BIOME_ODDS) { if (r < p) return w; r -= p; }
  if (isHalloween(now)) for (const [w, p] of HALLOWEEN_ODDS) { if (r < p) return w === 'pumpkinmoon' && timeOfDay(now, world) !== 'night' ? 'graveyard' : w; r -= p; }
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
