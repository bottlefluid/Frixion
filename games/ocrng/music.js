// Overcontrol RNG: music. Every aura from Shadowed up has its own theme, composed from its name when the game
// starts (nothing is downloaded), and so do the biomes and day and night. One theme plays at a time and the next
// one crossfades in. The game decides which: your aura, a rarer aura near you, or the biome.
import { auraKey, tierIndex, hashStr, seeded, elementOf } from './data.js';

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], harmonic: [0, 2, 3, 5, 7, 8, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], locrian: [0, 1, 3, 5, 6, 8, 10],
  whole: [0, 2, 4, 6, 8, 10, 12], hijaz: [0, 1, 4, 5, 7, 8, 10],
};
const PROGS = {
  bright: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 4], [5, 3, 0, 4], [0, 2, 3, 4]],
  dark: [[0, 5, 2, 6], [0, 3, 4, 0], [0, 6, 5, 6], [0, 5, 3, 4], [0, 1, 0, 6]],
};
// mood for each element: scale, bright or dark chords, extra layers
const MOODS = {
  fire: { scale: 'phrygian', prog: 'dark', drive: 1 }, ice: { scale: 'dorian', prog: 'dark', bells: 1 }, storm: { scale: 'minor', prog: 'dark', drive: 1 },
  light: { scale: 'lydian', prog: 'bright', choir: 1 }, dark: { scale: 'harmonic', prog: 'dark' }, nature: { scale: 'mixolydian', prog: 'bright' },
  water: { scale: 'dorian', prog: 'dark', bells: 1 }, star: { scale: 'lydian', prog: 'bright', bells: 1 }, void: { scale: 'whole', prog: 'dark' },
  gem: { scale: 'major', prog: 'bright', bells: 1 }, wind: { scale: 'mixolydian', prog: 'bright' }, earth: { scale: 'hijaz', prog: 'dark', drive: 1 },
  toxic: { scale: 'locrian', prog: 'dark' }, glitch: { scale: 'locrian', prog: 'dark', glitch: 1, drive: 1 }, arcane: { scale: 'dorian', prog: 'dark', bells: 1 },
  balance: { scale: 'major', prog: 'bright', choir: 1, balance: 1 },
};
const BIOMES = {
  'clear-day': { scale: 'major', prog: 'bright', bpm: 84, energy: 1 }, 'clear-night': { scale: 'dorian', prog: 'dark', bpm: 70, energy: 1, bells: 1 },
  windy: { scale: 'mixolydian', prog: 'bright', bpm: 98, energy: 1.5 }, rain: { scale: 'minor', prog: 'dark', bpm: 74, energy: 1 },
  snow: { scale: 'lydian', prog: 'bright', bpm: 68, energy: 1, bells: 1 }, sandstorm: { scale: 'hijaz', prog: 'dark', bpm: 102, energy: 2 },
  hell: { scale: 'phrygian', prog: 'dark', bpm: 124, energy: 3, drive: 1 }, starfall: { scale: 'lydian', prog: 'bright', bpm: 90, energy: 2, bells: 1 },
  heaven: { scale: 'major', prog: 'bright', bpm: 66, energy: 1, choir: 1 }, corruption: { scale: 'locrian', prog: 'dark', bpm: 92, energy: 2 },
  null: { scale: 'whole', prog: 'dark', bpm: 58, energy: 0.5 }, glitched: { scale: 'locrian', prog: 'dark', bpm: 140, energy: 3, glitch: 1 },
  pumpkinmoon: { scale: 'harmonic', prog: 'dark', bpm: 96, energy: 2, bells: 1 }, graveyard: { scale: 'minor', prog: 'dark', bpm: 62, energy: 1, choir: 1 },
  bloodrain: { scale: 'phrygian', prog: 'dark', bpm: 112, energy: 2.5, drive: 1 }, limbo: { scale: 'whole', prog: 'dark', bpm: 48, energy: 0.5, bells: 1 },
  raid: { scale: 'phrygian', prog: 'dark', bpm: 138, energy: 3, drive: 1 },
};

// A theme: everything needed to play it, worked out once from a seed.
function compose(seedStr, o) {
  const rnd = seeded(hashStr(seedStr));
  const scale = SCALES[o.scale] || SCALES.minor;
  const progs = PROGS[o.prog] || PROGS.dark;
  const prog = progs[Math.floor(rnd() * progs.length)];
  const root = 45 + Math.floor(rnd() * 10);                      // MIDI A2..F#3
  const bpm = o.bpm || Math.round(70 + rnd() * 50 + (o.energy || 1) * 8);
  const deg = (d, oct = 0) => { const n = scale.length, i = ((d % n) + n) % n; return root + scale[i] + 12 * (oct + Math.floor(d / n)); };
  // a melody of 4 bars x 16 steps, built from a 2-bar idea and an answer
  const density = Math.min(0.75, 0.3 + (o.energy || 1) * 0.12);
  const motif = [];
  let d = 2 + Math.floor(rnd() * 3);
  for (let s = 0; s < 32; s++) {
    if (s % 4 === 0 || rnd() < density * (s % 2 ? 0.5 : 1)) { d += Math.round((rnd() - 0.5) * 3.2); d = Math.max(-1, Math.min(9, d)); motif.push(d); }
    else motif.push(null);
  }
  const answer = motif.map((x, i) => (x == null ? null : i > 24 ? x - 1 + Math.floor(rnd() * 2) : x + (rnd() < 0.3 ? 2 : 0)));
  const melody = [...motif, ...answer];
  const arpShape = [[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3], [2, 1, 0, 1]][Math.floor(rnd() * 4)];
  return { ...o, rnd, scale, prog, root, bpm, deg, melody, arpShape, stepDur: 60 / bpm / 4 };
}

export function createMusic(ctx) {
  const master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
  // a little echo for space
  const delay = ctx.createDelay(1); delay.delayTime.value = 0.27;
  const fb = ctx.createGain(); fb.gain.value = 0.3;
  const wet = ctx.createGain(); wet.gain.value = 0.22;
  const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2400;
  delay.connect(damp); damp.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);
  const noise = (() => { const b = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; })();
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  const songs = [];          // playing or fading out
  let current = null, timer = null;

  function voice(out, type, midi, t, dur, vol, o = {}) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(hz(midi), t);
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(hz(midi + o.slide), t + dur);
    const a = o.attack ?? 0.01, r = o.release ?? 0.12;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, t + Math.max(a, dur - r)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.cutoff) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.cutoff; f.Q.value = o.q || 0.7; osc.connect(f); node = f; }
    node.connect(g); g.connect(out); if (o.send) g.connect(o.send);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function drum(out, kind, t, vol) {
    if (kind === 'kick') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.25); return;
    }
    const src = ctx.createBufferSource(); src.buffer = noise;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const len = kind === 'hat' ? 0.04 : 0.16;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f); f.connect(g); g.connect(out); src.start(t); src.stop(t + len + 0.02);
  }
  // one 16th-note step of a theme
  function playStep(song, step, t) {
    const th = song.th, out = song.gain, e = th.energy || 1, bar = Math.floor(step / 16) % 4, s = step % 16;
    const chordDeg = th.prog[bar], chord = [0, 2, 4].map(i => th.deg(chordDeg + i));
    const sd = th.stepDur;
    if (s === 0) {   // pad (or choir) holds the chord for the bar
      chord.forEach((m, i) => {
        voice(out, th.choir ? 'sine' : 'sawtooth', m + 12, t, sd * 16, th.choir ? 0.035 : 0.018, { attack: 0.5, release: 0.6, detune: (i - 1) * 7, cutoff: th.choir ? 0 : 900, send: delay });
        if (th.choir) voice(out, 'triangle', m + 24, t + 0.05, sd * 16, 0.012, { attack: 0.7, release: 0.7, detune: 5 });
      });
      if (th.balance) voice(out, 'sine', chord[0] + 36, t, sd * 8, 0.02, { attack: 0.3, release: 0.5, send: delay });
    }
    // bass on the beat
    if (s % (e >= 2 ? 4 : 8) === 0) voice(out, th.drive ? 'sawtooth' : 'triangle', chord[0] - 12, t, sd * (e >= 2 ? 3.6 : 7), th.drive ? 0.05 : 0.08, { cutoff: th.drive ? 420 : 0, release: 0.08 });
    // arpeggio
    const arpEvery = e >= 1.5 ? 2 : 4;
    if (s % arpEvery === 0) {
      const i = th.arpShape[(s / arpEvery) % th.arpShape.length];
      const m = th.deg(chordDeg + (i === 3 ? 7 : i * 2), 1);
      voice(out, th.bells ? 'sine' : 'triangle', m + (th.bells ? 12 : 0), t, sd * (th.bells ? 6 : 2.2), th.bells ? 0.035 : 0.03, { release: th.bells ? 0.5 : 0.1, send: delay });
    }
    // melody (rarer auras: stronger themes)
    if (e >= 1.5 || th.lead) {
      const n = th.melody[(step % 64)];
      if (n != null) voice(out, th.glitch ? 'square' : 'triangle', th.deg(n, 2) - 12, t, sd * 1.8, th.glitch ? 0.02 : 0.04, { cutoff: th.glitch ? 2600 : 3200, send: delay });
    }
    // drums
    if (e >= 2) {
      if (s % 2 === 0) drum(out, 'hat', t, 0.03);
      if (s === 0 || s === 8 || (e >= 3 && (s === 10 || s === 3))) drum(out, 'kick', t, 0.32);
      if (s === 4 || s === 12) drum(out, 'snare', t, 0.12);
    }
    // glitch: little stutters of random notes
    if (th.glitch && th.rnd() < 0.18) for (let k = 0; k < 3; k++) voice(out, 'square', th.deg(Math.floor(th.rnd() * 10), 2), t + k * sd / 3, sd / 3, 0.015);
  }
  function tick() {
    const ahead = ctx.currentTime + 0.15;
    for (const song of songs) {
      while (song.next < ahead) { playStep(song, song.step, song.next); song.step++; song.next += song.th.stepDur; }
    }
    for (let i = songs.length - 1; i >= 0; i--) if (songs[i].dead && ctx.currentTime > songs[i].deadAt) { songs[i].gain.disconnect(); songs.splice(i, 1); }
  }
  function fadeOut(song, secs = 1.6) {
    if (!song || song.dead) return;
    song.dead = true; song.deadAt = ctx.currentTime + secs + 0.2;
    song.gain.gain.cancelScheduledValues(ctx.currentTime);
    song.gain.gain.setValueAtTime(song.gain.gain.value, ctx.currentTime);
    song.gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + secs);
  }
  function start(id, th, vol) {
    const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(master);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 1.4);
    const song = { id, th, gain: g, vol, step: 0, next: ctx.currentTime + 0.05 };
    songs.push(song);
    return song;
  }
  if (!timer) timer = setInterval(tick, 30);

  // Theme ids: 'aura:<key>' or 'biome:<name>'. Themes are composed once and kept.
  const themes = new Map();
  function themeFor(id) {
    if (themes.has(id)) return themes.get(id);
    let th;
    if (id.startsWith('aura:')) {
      const { aura } = auraKey(id.slice(5)), t = tierIndex(aura.rarity);
      const mood = MOODS[elementOf(aura.id)] || MOODS.arcane;
      th = compose(id, { ...mood, energy: Math.min(3, 1 + t * 0.4), lead: t >= 3, glitch: mood.glitch || t >= 7, choir: mood.choir || t >= 6 });
    } else th = compose(id, BIOMES[id.slice(6)] || BIOMES['clear-day']);
    themes.set(id, th);
    return th;
  }
  return {
    // play this theme (crossfading from whatever is on), at this volume (0..1)
    play(id, vol) {
      vol = Math.max(0, Math.min(1, vol)) * 0.5;
      if (current && current.id === id && !current.dead) {
        if (Math.abs(current.vol - vol) > 0.01) { current.vol = vol; current.gain.gain.cancelScheduledValues(ctx.currentTime); current.gain.gain.linearRampToValueAtTime(Math.max(0.0001, vol), ctx.currentTime + 0.4); }
        return;
      }
      fadeOut(current);
      current = vol > 0.001 && id ? start(id, themeFor(id), vol) : null;
    },
    // a big hit when a rare aura lands
    sting(midi = 50, big = false) {
      const t = ctx.currentTime + 0.02;
      [0, 7, 12, 16, 19].forEach((iv, i) => voice(master, 'sawtooth', midi + iv, t + i * 0.03, big ? 3 : 1.6, 0.03, { attack: 0.02, release: 1, cutoff: 2400, send: delay }));
      drum(master, 'kick', t, 0.5);
    },
    stop() { songs.forEach(s => fadeOut(s, 0.4)); current = null; },
    dispose() { clearInterval(timer); timer = null; try { master.disconnect(); } catch (e) {} },
  };
}
