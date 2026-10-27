// Overcontrol RNG: every icon in the game, drawn as SVG (never emoji), and a bottle for each potion.

const svg = (d, extra = '') => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
const S = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
export const IC = {
  storage: svg(`<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" ${S}/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" ${S}/>`),
  collection: svg(`<path d="M4 4.5h6a2 2 0 0 1 2 2V20a2 2 0 0 0-2-2H4z" ${S}/><path d="M20 4.5h-6a2 2 0 0 0-2 2V20a2 2 0 0 1 2-2h6z" ${S}/>`),
  inventory: svg(`<path d="M5 8h14l-1 12H6z" ${S}/><path d="M9 8V6a3 3 0 0 1 6 0v2" ${S}/>`),
  quests: svg(`<path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v15l-3-1.8-3 1.8-3-1.8-3 1.8V5A1.5 1.5 0 0 1 7 3.5z" ${S}/><path d="M9 8.5h6M9 12h6" ${S}/>`),
  stats: svg(`<path d="M4 20h16M7 20v-6M12 20V7M17 20v-9" ${S}/>`),
  settings: svg(`<circle cx="12" cy="12" r="3" ${S}/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.4 1a7.4 7.4 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.6A7.4 7.4 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a7.4 7.4 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 2.6-1.5l2.4 1 2-3.4z" ${S}/>`),
  owner: svg(`<path d="M3.5 8l4.5 3.5L12 5l4 6.5L20.5 8 19 18H5z" ${S}/>`),
  admin: svg(`<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6z" ${S}/><path d="M9 12l2 2 4-4" ${S}/>`),
  close: svg('<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'),
  chat: svg(`<path d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4z" ${S}/>`),
  people: svg(`<circle cx="9" cy="8" r="3" ${S}/><path d="M3.5 19c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" ${S}/><path d="M16 5.5a3 3 0 0 1 0 5.6M18 13.8c1.6.8 2.5 2.6 2.5 5.2" ${S}/>`),
  lock: svg('<rect x="5" y="10" width="14" height="11" rx="2" fill="currentColor"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/>'),
  phone: svg('<rect x="7" y="2" width="10" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="18.5" r="1" fill="currentColor"/>'),
  fish: svg('<path d="M2 12c3-4 7-6 11-6 4 0 7 3 8 6-1 3-4 6-8 6-4 0-8-2-11-6zm0 0L0 8m2 4L0 16" fill="currentColor" stroke="currentColor" stroke-width="1.5"/><circle cx="16.5" cy="11" r="1.2" fill="#000"/>'),
  search: svg(`<circle cx="10.5" cy="10.5" r="6" ${S}/><path d="M15 15l5 5" ${S}/>`),
  menu: svg(`<path d="M4 7h16M4 12h16M4 17h16" ${S}/>`),
  star: svg('<path d="M12 2.5l2.7 6.2 6.8.6-5.2 4.5 1.6 6.6L12 17l-5.9 3.4 1.6-6.6L2.5 9.3l6.8-.6z" fill="currentColor"/>'),
  sword: svg(`<path d="M14.5 3.5H20v5.5L9 20l-5.5-5.5z" ${S}/><path d="M7 13l4 4M4 20l2-2" ${S}/>`),
  trophy: svg(`<path d="M8 4h8v5a4 4 0 0 1-8 0z" ${S}/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4" ${S}/>`),
  cauldron: svg(`<path d="M4 9h16l-1.5 8a3 3 0 0 1-3 2.5h-7a3 3 0 0 1-3-2.5z" ${S}/><path d="M3 9h18M8 5.5c0-1 1-1.5 1.5-1M12.5 6c.5-1.5 2-1.5 2.5-2" ${S}/>`),
  pass: svg(`<path d="M4 6.5h16v4a2 2 0 0 0 0 3v4H4v-4a2 2 0 0 0 0-3z" ${S}/><path d="M14 6.5v11" ${S} stroke-dasharray="2 2"/>`),
  hammer: svg(`<path d="M14 4l6 6-3 3-6-6zM11 7l-7.5 7.5a1.8 1.8 0 0 0 0 2.5l.5.5a1.8 1.8 0 0 0 2.5 0L14 10" ${S}/>`),
  sword2: svg(`<path d="M5 19l9-9M14 4h6v6l-9 9-6-6zM4 20l2-2" ${S}/>`),
  music: svg(`<path d="M9 18V6l11-2v12" ${S}/><circle cx="6.5" cy="18" r="2.5" ${S}/><circle cx="17.5" cy="16" r="2.5" ${S}/>`),
  eye: svg(`<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" ${S}/><circle cx="12" cy="12" r="3" ${S}/>`),
  pin: svg(`<path d="M7 11V6.5h10V11l2 3H5zM12 14v6" ${S}/>`),
};

// ---------------- potion bottles ----------------
let uid = 0;
const SHADE = (hex, k) => {   // lighten (k > 0) or darken (k < 0) a colour
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = c => Math.max(0, Math.min(255, Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k))));
  return '#' + [f(r), f(g), f(b)].map(c => c.toString(16).padStart(2, '0')).join('');
};
// Body outlines in a 48x48 box: [glass path, liquid top (y), neck rect, extra decoration]
const SHAPES = {
  round: { body: 'M19 17h10v4c6 2 10 7 10 13a15 15 0 0 1-30 0c0-6 4-11 10-13z', liquid: 27, neck: [19, 10, 10, 8] },
  tall: { body: 'M18 16h12v5c2 1 3 2.5 3 5v16a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V26c0-2.5 1-4 3-5z', liquid: 25, neck: [19, 9, 10, 8] },
  spoid: { body: 'M21 20h6v18l-3 7-3-7z', liquid: 26, neck: [19, 7, 10, 13], bulb: true },
  flask: { body: 'M20 16h8v9l11 16a3 3 0 0 1-2.5 4.5h-25A3 3 0 0 1 9 41l11-16z', liquid: 32, neck: [19, 9, 10, 8] },
  big: { body: 'M17 15h14v4c6 1 9 5 9 10v12a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V29c0-5 3-9 9-10z', liquid: 26, neck: [18, 8, 12, 8], handle: true },
  vial: { body: 'M20 14h8v28a4 4 0 0 1-8 0z', liquid: 24, neck: [19, 8, 10, 7] },
  gem: { body: 'M19 17h10v3l9 9-14 16-14-16 9-9z', liquid: 30, neck: [19, 10, 10, 8] },
  skull: { body: 'M19 17h10v3c5 1.5 9 6 9 11 0 4-2 6.5-4 7.5V44a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 14 44v-5.5c-2-1-4-3.5-4-7.5 0-5 4-9.5 9-11z', liquid: 28, neck: [19, 10, 10, 8], skull: true },
  godly: { body: 'M19 17h10v3c5 1.5 8 6 8 11v8a6 6 0 0 1-6 6H17a6 6 0 0 1-6-6v-8c0-5 3-9.5 8-11z', liquid: 28, neck: [19, 10, 10, 8], wings: true },
  star: { body: 'M24 15l3.5 8.5 9 .5-7 6 2.4 9L24 34l-7.9 5 2.4-9-7-6 9-.5z', liquid: 22, neck: [20, 8, 8, 8], starburst: true },
  swirl: { body: 'M19 17h10v4c6 2 10 7 10 13a15 15 0 0 1-30 0c0-6 4-11 10-13z', liquid: 26, neck: [19, 10, 10, 8], swirl: true },
  ornate: { body: 'M20 16h8v4l6 4-2 4 4 6-4 6 2 4H12l2-4-4-6 4-6-2-4 6-4z', liquid: 28, neck: [19, 9, 10, 8], gold: true },
  void: { body: 'M24 17a14 14 0 1 1 0 28 14 14 0 0 1 0-28z', liquid: 18, neck: [20, 9, 8, 9], voidGlow: true },
  hourglass: { body: 'M13 12h22v3c0 5-6 7-8 9 2 2 8 4 8 9v3H13v-3c0-5 6-7 8-9-2-2-8-4-8-9z', liquid: 30, neck: null, frame: true },
  dark: { body: 'M19 17h10v3l7 6v13a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6V26l7-6z', liquid: 27, neck: [19, 10, 10, 8], spikes: true },
};
// things that aren't bottles
function specialArt(p, cls) {
  const c = p.color, light = SHADE(c, 0.45), dark = SHADE(c, -0.4), o = 'stroke="#0d0d10" stroke-width="1.8" stroke-linejoin="round"';
  if (p.shape === 'chest') return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><path d="M8 22h32v17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" fill="${c}" ${o}/><path d="M8 22c0-6 4-10 10-10h12c6 0 10 4 10 10z" fill="${light}" ${o}/><path d="M8 22h32" ${o}/><rect x="21" y="19" width="6" height="8" rx="1" fill="#ffd54f" ${o}/><path d="M14 22v19M34 22v19" stroke="${dark}" stroke-width="2"/></svg>`;
  if (p.shape === 'rune') return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4l14 9v22l-14 9-14-9V13z" fill="#3a3f4a" ${o}/><path d="M24 9l10 6.5v17L24 39l-10-6.5v-17z" fill="#4b5260"/><path d="M24 14v20M18 19l12 10M30 19L18 29" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/><circle cx="24" cy="24" r="14" fill="${c}" opacity=".18"/></svg>`;
  if (p.shape === 'device') return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><rect x="9" y="10" width="30" height="28" rx="6" fill="#263238" ${o}/><rect x="14" y="15" width="20" height="12" rx="2" fill="${c}" ${o}/><circle cx="18" cy="32" r="2.4" fill="${light}"/><circle cx="30" cy="32" r="2.4" fill="#ff5252"/><path d="M17 21h6l2-3 2 6 2-3h2" fill="none" stroke="#0d0d10" stroke-width="1.4"/></svg>`;
  return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="16" fill="${c}" ${o}/><circle cx="24" cy="24" r="11" fill="none" stroke="${light}" stroke-width="1.6"/><path d="M20 27c0 2 2 3 4 3s4-1 4-3-2-2.5-4-3-4-1-4-3 2-3 4-3 4 1 4 3M24 15v18" fill="none" stroke="#0d0d10" stroke-width="1.6"/></svg>`;
}
export function potionArt(p, cls = 'oc-potion') {
  if (['chest', 'rune', 'device', 'coin'].includes(p.shape)) return specialArt(p, cls);
  const sh = SHAPES[p.shape] || SHAPES.round, c = p.color, id = 'pc' + (++uid);
  const light = SHADE(c, 0.45), dark = SHADE(c, -0.35);
  let out = `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><defs><clipPath id="${id}"><path d="${sh.body}"/></clipPath>`
    + `<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${dark}"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>`;
  if (sh.voidGlow) out += `<circle cx="24" cy="31" r="18" fill="#7c4dff" opacity=".35"/>`;
  if (sh.starburst) out += `<circle cx="24" cy="27" r="17" fill="${light}" opacity=".25"/>`;
  if (sh.wings) out += `<path d="M11 28c-6-2-9-7-9-12 3 3 6 4 10 4M37 28c6-2 9-7 9-12-3 3-6 4-10 4" fill="#fff" stroke="#0d0d10" stroke-width="1.2"/>`;
  if (sh.handle) out += `<path d="M38 24c5 0 6 9 1 10" fill="none" stroke="#0d0d10" stroke-width="3"/><path d="M38 24c5 0 6 9 1 10" fill="none" stroke="#dfe6ea" stroke-width="1.4"/>`;
  // glass, liquid, shine
  out += `<path d="${sh.body}" fill="rgba(220,235,245,.22)"/>`;
  out += `<g clip-path="url(#${id})"><rect x="0" y="${sh.liquid}" width="48" height="48" fill="url(#${id}g)"/><rect x="0" y="${sh.liquid}" width="48" height="1.6" fill="${light}"/>`;
  if (sh.swirl) out += `<path d="M14 36c4-6 10 2 14-4s8 0 8 0" fill="none" stroke="${light}" stroke-width="2"/><path d="M12 30c4-5 8 2 12-3" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.4"/>`;
  if (sh.skull) out += `<circle cx="20" cy="33" r="2.4" fill="#0d0d10"/><circle cx="28" cy="33" r="2.4" fill="#0d0d10"/><path d="M22 39h4" stroke="#0d0d10" stroke-width="1.6"/>`;
  if (sh.frame) out += `<path d="M21 24h6" stroke="${light}" stroke-width="2"/>`;
  out += `<rect x="13" y="0" width="3.2" height="48" fill="#fff" opacity=".28"/></g>`;
  out += `<path d="${sh.body}" fill="none" stroke="#0d0d10" stroke-width="1.8" stroke-linejoin="round"/>`;
  if (sh.gold) out += `<path d="${sh.body}" fill="none" stroke="#ffd54f" stroke-width=".8" stroke-linejoin="round" transform="translate(0 0)"/>`;
  if (sh.spikes) out += `<path d="M12 26l-4-3M36 26l4-3M12 34l-4 1M36 34l4 1" stroke="#0d0d10" stroke-width="1.8" stroke-linecap="round"/>`;
  if (sh.frame) out += `<rect x="11" y="9" width="26" height="3.5" rx="1" fill="#8d6e63" stroke="#0d0d10" stroke-width="1.4"/><rect x="11" y="35.5" width="26" height="3.5" rx="1" fill="#8d6e63" stroke="#0d0d10" stroke-width="1.4"/>`;
  if (sh.neck) {
    const [x, y, w, h] = sh.neck;
    out += `<rect x="${x + 1}" y="${y + 3}" width="${w - 2}" height="${h}" fill="rgba(220,235,245,.3)" stroke="#0d0d10" stroke-width="1.6"/>`;
    out += sh.bulb
      ? `<rect x="${x - 1}" y="${y - 3}" width="${w + 2}" height="9" rx="4.5" fill="#e53935" stroke="#0d0d10" stroke-width="1.6"/>`
      : `<rect x="${x}" y="${y}" width="${w}" height="5" rx="1.2" fill="#a1887f" stroke="#0d0d10" stroke-width="1.6"/>`;
  }
  return out + '</svg>';
}
export function handGearArt(g, cls = 'oc-potion') {
  const c = g.color, light = SHADE(c, 0.45), dark = SHADE(c, -0.35), o = 'stroke="#0d0d10" stroke-width="1.8" stroke-linejoin="round"';
  if (g.hand === 'left') return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><path d="M13 22V12a3 3 0 0 1 6 0v8V9a3 3 0 0 1 6 0v11-9a3 3 0 0 1 6 0v11-5a3 3 0 0 1 6 0v12c0 8-6 14-13 14s-12-5-12-11l-3-6a3 3 0 0 1 5-3z" fill="${c}" ${o}/><rect x="14" y="34" width="20" height="6" rx="2" fill="${dark}" ${o}/><circle cx="24" cy="27" r="3.4" fill="${light}" ${o}/></svg>`;
  return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="14" width="32" height="22" rx="5" fill="${c}" ${o}/><rect x="12" y="18" width="14" height="14" rx="7" fill="${light}" ${o}/><circle cx="19" cy="25" r="3" fill="${dark}"/><path d="M30 20h6M30 25h6M30 30h4" stroke="#0d0d10" stroke-width="2" stroke-linecap="round"/><path d="M16 14v-4h16v4" fill="none" ${o}/></svg>`;
}
export function gearArt(item, cls = 'oc-potion') {
  const c = item.color, light = SHADE(c, 0.4);
  return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="8" width="32" height="32" rx="6" fill="${c}" stroke="#0d0d10" stroke-width="2"/><rect x="12" y="12" width="24" height="10" rx="3" fill="${light}" opacity=".55"/><path d="M16 30h16M16 35h10" stroke="#0d0d10" stroke-opacity=".45" stroke-width="2.4" stroke-linecap="round"/></svg>`;
}
export function fishArt(color, cls = 'oc-potion') {
  return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><path d="M5 24c6-8 14-12 22-12 8 0 14 6 16 12-2 6-8 12-16 12-8 0-16-4-22-12zm0 0L1 16m4 8L1 32" fill="${color}" stroke="#0d0d10" stroke-width="2" stroke-linejoin="round"/><circle cx="33" cy="22" r="2.4" fill="#0d0d10"/><path d="M22 16c3 5 3 11 0 16" fill="none" stroke="#0d0d10" stroke-opacity=".35" stroke-width="1.6"/></svg>`;
}
export function coinArt(kind, cls = 'oc-potion') {
  const c = kind === 'f' ? '#2f9bff' : kind === 'void' ? '#4a148c' : '#ffcf33', t = kind === 'f' ? 'F' : kind === 'void' ? 'V' : '$';
  return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="17" fill="${c}" stroke="#0d0d10" stroke-width="2"/><circle cx="24" cy="24" r="12.5" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.6"/><text x="24" y="30.5" text-anchor="middle" font-family="Montserrat,Arial" font-weight="800" font-size="17" fill="#fff" stroke="#0d0d10" stroke-width=".8">${t}</text></svg>`;
}
export function starArt(cls = 'oc-potion') {
  return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="18" fill="#9fd0ff" opacity=".3"/><path d="M24 6l4.8 11.4 12.2 1-9.3 8 2.9 12L24 32l-10.6 6.4 2.9-12-9.3-8 12.2-1z" fill="#e3f2ff" stroke="#0d0d10" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}
