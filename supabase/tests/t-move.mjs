// The Owner's copy tool (functions/api/admin, route "move": plan, count, copy) from the Firestore emulator into the local
// Supabase stand-in, then every document compared with what was put in Firestore. Needs the Firestore emulator (8080),
// the Auth emulator (9099) and supabase/local/serve.mjs (the stand-in on 54321). It wipes all three first.
// ADMIN_FN: the admin function to test (default: the main checkout's, where the tool runs until the switch).
import { pathToFileURL } from 'node:url';
import { section, check, summary } from './harness.mjs';

const ADMIN_FN = process.env.ADMIN_FN || 'D:/Downloads/Frixion/functions/api/admin/[[path]].js';
const FS = 'http://127.0.0.1:8080/v1/projects/liquidalt/databases/(default)/documents', AUTH = 'http://127.0.0.1:9099';
const SB = 'http://127.0.0.1:54321', SECRET = 'local-secret-key';
const ENV = { FIRESTORE_URL: FS, FIRESTORE_BEARER: 'owner', AUTH_URL: `${AUTH}/identitytoolkit.googleapis.com/v1/projects/liquidalt`, TEST_TOKENS: '1',
  SUPABASE_URL: SB, SUPABASE_SECRET_KEY: SECRET };
const admin = await import(pathToFileURL(ADMIN_FN).href);
const hexEmail = name => [...Buffer.from(name, 'utf8')].map(b => b.toString(16).padStart(2, '0')).join('') + '@u.frixionbeta.pages.dev';

// ---------- Firestore, as the documents were put there ----------
class Geo { constructor(lat, lng) { this.lat = lat; this.lng = lng; } }
const val = v => (v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() } : v instanceof Geo ? { geoPointValue: { latitude: v.lat, longitude: v.lng } }
  : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'string' ? { stringValue: v }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } });
// what Supabase should hold for it: dates as {"$t": ms}
const want = v => (v instanceof Date ? { $t: v.getTime() } : Array.isArray(v) ? v.map(want) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, want(x)])) : v);
const put = async (path, data) => {
  const r = await fetch(`${FS}/${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields: val(data).mapValue.fields }) });
  if (!r.ok) throw new Error(path + ': ' + r.status + ' ' + await r.text());
};
async function sbGet(path) {
  const r = await fetch(`${SB}/rest/v1/rpc/fx_get`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SECRET, Authorization: 'Bearer ' + SECRET }, body: JSON.stringify({ path }) });
  const j = await r.json();
  return j && j.exists ? j.data : null;
}
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const sorted = v => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v);

// ---------- fresh data ----------
for (let i = 0; i < 60; i++) { try { if ((await fetch('http://127.0.0.1:8080/')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 1000)); }
await fetch('http://127.0.0.1:8080/emulator/v1/projects/liquidalt/databases/(default)/documents', { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
await fetch(`${AUTH}/emulator/v1/projects/liquidalt/accounts`, { method: 'DELETE' });
await fetch(`${SB}/local/reset`, { method: 'POST', headers: { Authorization: 'Bearer ' + SECRET } });
// a document Supabase refuses: the stand-in is told to say no to users/Boom
for (const sql of [
  `create or replace function public.t_boom() returns trigger language plpgsql as $$ begin if new.id = 'Boom' then raise exception 'boom: no thanks'; end if; return new; end $$`,
  `create trigger t_boom before insert on public.users for each row execute function public.t_boom()`]) {
  const r = await fetch(`${SB}/local/sql`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SECRET }, body: JSON.stringify({ sql }) });
  if (!r.ok) throw new Error('stand-in: ' + await r.text());
}
const signUp = async name => (await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: hexEmail(name), password: 'frixion:pass1', returnSecureToken: true }) })).json());
const tester = await signUp('Tester'), sumi = await signUp('Sumi');
const t0 = new Date('2026-11-01T12:00:00.123Z'), t1 = new Date(Date.now() - 3600000);
const docs = {   // path -> data (what should arrive), plus the ones that shouldn't
  [`users/Tester`]: { username: 'Tester', authUid: tester.localId, owner: true, orbs: 3000, friends: ['Sumi'], stats: { messagesSent: 12, games: { rng: 3 } }, createdAt: t0, premiumUntil: null, ratio: 0.75, banned: false },
  [`users/Sumi`]: { username: 'Sumi', authUid: sumi.localId, orbs: 50, friends: ['Tester'], incomingRequests: [], createdAt: t1, casino: { day: '2026-11-16', games: 4, open: null } },
  [`accounts/${tester.localId}`]: { username: 'Tester', at: 1731800000000 },
  [`accounts/${sumi.localId}`]: { username: 'Sumi', at: 1731800000001 },
  'users/Tester/meta/blocks': { list: ['Spammer'] },
  'users/Tester/privateNotes/Sumi': { text: 'met in #general', at: t1 },
  'users/Tester/mentions/x1': { sid: 's1', cid: 'c1', mid: 'm1', from: 'Sumi', at: t1 },
  's': null,
  'servers/s1': { name: 'Test server', ownerId: 'Tester', members: ['Tester', 'Sumi'], roles: [{ id: 'everyone', name: '@everyone', permissions: ['viewChannels', 'sendMessages'], position: 0 }, { id: 'r2', name: 'Mods', color: '#ff0000', permissions: ['manageMessages'], position: 1 }], memberRoles: { Sumi: ['r2'] }, nicknames: {}, createdAt: t0 },
  'servers/s1/channels/c1': { name: 'general', categoryId: 'cat1', autoDelete: true, slowmode: 0, discord: { channel: '930000000000000001', since: '1572000000000000000', sig: 'abc' }, createdAt: t0 },
  'servers/s1/categories/cat1': { name: 'Text', position: 0 },
  'servers/s1/threads/t1': { name: 'a thread', parentChannelId: 'c1', createdAt: t1, archived: false },
  'servers/s1/threads/t1/messages/tm1': { uid: 'Sumi', username: 'Sumi', text: 'in the thread', createdAt: t1 },
  'dms/Sumi_Tester': { participants: ['Sumi', 'Tester'], autoDelete: true, createdAt: t0 },
  'dms/Sumi_Tester/messages/d1': { uid: 'Sumi', username: 'Sumi', text: 'psst', createdAt: t1, reactions: { '👍': ['Tester'] } },
  'groupDMs/g1': { participants: ['Sumi', 'Tester'], name: 'two of us', owner: 'Tester', createdAt: t0 },
  'groupDMs/g1/messages/gm1': { uid: 'Tester', username: 'Tester', text: 'group hello', createdAt: t1, attachments: [{ url: 'https://res.cloudinary.com/x/image/upload/a.png', type: 'image', name: 'a.png', size: 1234 }] },
  'redeemCodes/CODE1': { code: 'CODE1', type: 'orbs', value: 10, maxUses: 0, uses: 0, usedBy: [], createdBy: 'Tester', createdAt: t0 },
  'config/filter': { words: ['badword'], enabled: true },
  'shopDecorations/d1': { name: 'Halo', price: 500, src: 'https://res.cloudinary.com/x/image/upload/h.png', disabled: false },
  'customEmojis/e1': { name: 'wave', url: 'https://res.cloudinary.com/x/image/upload/w.gif', by: 'Tester' },
  'devices/dev_0123456789abcdef0123456789abcdef': { accounts: ['Tester'], lastSeen: t1, ua: 'Test browser' },
  'ips/ip1': { label: '73.12.x.x', accounts: ['Tester'], lastSeen: t1 },
  'loans/l1': { from: 'Tester', to: 'Sumi', amount: 100, paid: 40, status: 'active', time: '1d', at: 1731800000000, dueAt: 1731886400000, late: false },
  'orbDays/Sumi': { day: '2026-11-16', got: 150, at: t1 },
  'eggs/Sumi': { found: ['frixion', 'hello'], at: t1 },
  'pushSubs/p1': { uid: 'Sumi', endpoint: 'https://push.example/abc', p256dh: 'BKx', auth: 'au', muted: ['dm:Sumi_Tester'], at: 1731800000000 },
  'discordLinks/s1__c1': { sid: 's1', cid: 'c1', channel: '930000000000000001', at: 1731800000000 },
  'rngSaves/Tester': { auras: { 'equinox:x': 2 }, rolls: 12345, luck: 1.5, at: t1 },
};
delete docs.s;
for (let i = 0; i < 25; i++) docs[`servers/s1/channels/c1/messages/m${String(i).padStart(2, '0')}`] = { uid: i % 2 ? 'Sumi' : 'Tester', username: i % 2 ? 'Sumi' : 'Tester', text: 'message ' + i, createdAt: new Date(t1.getTime() + i * 1000), ...(i === 3 ? { replyTo: { id: 'm02', username: 'Tester', text: 'message 2' }, edited: true } : {}) };
const notCopied = {   // path -> why it stays behind
  'servers/s1/channels/c1/typing/Sumi': 'typing notes aren\'t copied',
  'users/Tester/messages/x': 'Supabase has no table for it',
  'users/Geo': 'it holds a geoPointValue',
  'users/Boom': 'Supabase refused it',
};
for (const [p, d] of Object.entries(docs)) await put(p, d);
await put('servers/s1/channels/c1/typing/Sumi', { at: t1 });
await put('users/Tester/messages/x', { text: 'a misplaced one' });
await put('users/Geo', { username: 'Geo', where: new Geo(40.7, -74) });
await put('users/Boom', { username: 'Boom' });
await put('oldStuff/o1', { left: 'from long ago' });   // a whole collection Supabase keeps nothing of

// ---------- the tool, as the Owner's tab uses it ----------
const call = async body => {
  const res = await admin.onRequest({ request: new Request('http://x/api/admin/move', { method: 'POST', body: JSON.stringify(body) }), env: ENV, params: { path: ['move'] } });
  return { status: res.status, ...(await res.json()) };
};
section('The plan and the counts');
const nobody = await call({ token: sumi.idToken, action: 'plan' });
check('only the Owner may use it', nobody.status === 403, nobody);
const plan = await call({ token: tester.idToken, action: 'plan' });
check('plan: the kinds of documents, without typing notes', Array.isArray(plan.groups) && plan.groups.includes('messages') && plan.groups.includes('privateNotes') && !plan.groups.includes('typing'), plan);
check('plan: names the collection Supabase has no table for', JSON.stringify(plan.unknown) === '["oldStuff"]', plan.unknown);
const counts = {};
for (const g of plan.groups) counts[g] = (await call({ token: tester.idToken, action: 'count', group: g })).count;
const inFs = p => p.split('/').slice(-2, -1)[0];
const expectCount = g => Object.keys(docs).filter(p => inFs(p) === g).length + Object.keys(notCopied).filter(p => inFs(p) === g).length;
check('count: each kind as many as Firestore holds', plan.groups.every(g => counts[g] === expectCount(g)), plan.groups.filter(g => counts[g] !== expectCount(g)).map(g => [g, counts[g], expectCount(g)]));
const odd = await call({ token: tester.idToken, action: 'count', group: 'typing' });
check('typing notes can\'t be asked for', odd.status === 400, odd);

section('The copy (small pages, so pages carry on from each other)');
const after = {}, copied = {}, skipped = [];
let size = 7, calls = 0, smaller = 0;
for (const g of plan.groups) {
  for (let done = false; !done;) {
    const r = await call({ token: tester.idToken, action: 'copy', group: g, after: after[g] || null, size });
    calls++;
    if (r.status !== 200) { check(`copy ${g}`, false, r); done = true; break; }
    if (r.retrySmaller) { smaller++; size = Math.max(1, Math.floor(size / 4)); continue; }
    copied[g] = (copied[g] || 0) + r.copied;
    skipped.push(...r.skipped);
    if (r.last) after[g] = r.last;
    done = r.done;
    size = Math.min(7, size * 2);
  }
}
const total = Object.values(copied).reduce((a, b) => a + b, 0);
check(`copied every document that belongs (${Object.keys(docs).length}) in ${calls} requests`, total === Object.keys(docs).length, { total, copied });
check('a page Supabase refused was tried again smaller', smaller > 0, { smaller });
for (const [p, why] of Object.entries(notCopied)) {
  if (p.includes('/typing/')) { check(`left behind: ${p} (${why})`, (await sbGet(p).catch(() => null)) === null && !skipped.some(s => s.startsWith(p + ':')), skipped); continue; }
  check(`left behind and listed: ${p} (${why})`, skipped.some(s => s.startsWith(p + ':')) && (await sbGet(p).catch(() => null)) === null, skipped);
}
check('nothing else listed', skipped.length === Object.keys(notCopied).length - 1, skipped);

section('Every document, compared');
let bad = [];
for (const [p, d] of Object.entries(docs)) { const got = await sbGet(p); if (!same(got, want(d))) bad.push({ p, want: want(d), got }); }
check(`all ${Object.keys(docs).length} match what was put in Firestore (timestamps, nested maps, lists of maps, doubles, nulls)`, !bad.length, bad.slice(0, 3));
const again = await call({ token: tester.idToken, action: 'copy', group: 'messages', after: null, size: 300 });
const messages = Object.keys(docs).filter(p => inFs(p) === 'messages').length;
check(`copying a page again is harmless (all ${messages} messages at once)`, again.status === 200 && again.copied === messages && (await sbGet('servers/s1/channels/c1/messages/m03')).edited === true, again);
const gone = await call({ token: tester.idToken, action: 'copy', group: 'messages', after: 'projects/other/databases/(default)/documents/x/y', size: 5 });
check('a made-up place to carry on from is refused', gone.status === 400, gone);

process.exit(summary() ? 1 : 0);
