// Builds supabase/tests/r2-ported.mjs from the Firebase rule tests (rules2.test.js): the same seed data and the same
// checks, on top of r2compat.mjs. The Gavinperri section is left out (that site stays on Firebase).
const fs = require('fs');
const SRC = 'C:/Users/peter/AppData/Local/Temp/claude/5cb1245c0ba41c74/ab28a137-fd20-43a4-9361-bfe84f367209/scratchpad/emu/rules2.test.js';
const OUT = 'D:/Downloads/Frixion-supabase/supabase/tests/r2-ported.mjs';
const src = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);
const find = (re, from = 0) => { const i = src.findIndex((l, j) => j >= from && re.test(l)); if (i < 0) throw new Error('not found: ' + re); return i; };
const iEvery = find(/^const EVERYONE = \[/);
const iSeed = find(/^async function seed\(\) \{/);
const iMain = find(/^\(async \(\) => \{/);
if (!/^\s*await seed\(\);\s*$/.test(src[iMain + 1])) throw new Error('expected await seed() after the main line');
const iGav = find(/section\('Gavinperri/, iMain);
const iEggs = find(/section\('Easter eggs and typing dots/, iGav);
const iEnd = find(/^\s*console\.log\(`\\n\$\{pass\} passed/, iEggs);
let everyEnd = iEvery; while (!/\];\s*$/.test(src[everyEnd])) everyEnd++;
const out = [
  '// Made by make-r2-ported.js from rules2.test.js (the Firebase rule tests): the same seed data and checks, run on the',
  '// Supabase version through r2compat.mjs. Don\'t edit by hand; change the generator or rules2.test.js.',
  "import { db, uidOf, write, commit, setDoc, updateDoc, delDoc, getDoc, query, rtPut, rtDel, rtGet, allow, deny, daysAgo, section, seedMode, summary } from './r2compat.mjs';",
  '',
  ...src.slice(iEvery, everyEnd + 1),
  '',
  ...src.slice(iSeed, iMain).filter(l => !/call\('DELETE'/.test(l)),
  '(async () => {',
  '  seedMode(true); await seed(); seedMode(false);',
  ...src.slice(iMain + 2, iGav),
  ...src.slice(iEggs, iEnd),
  '  process.exit(summary() ? 1 : 0);',
  '})().catch(e => { console.error(e); process.exit(2); });',
  '',
];
fs.writeFileSync(OUT, out.join('\n'));
console.log(`wrote ${OUT}: ${out.length} lines (left out the Gavinperri section, ${iEggs - iGav} lines)`);
