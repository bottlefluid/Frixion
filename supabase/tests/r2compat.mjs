// rules2.test.js's helpers (setDoc, updateDoc, commit, write, getDoc, query, delDoc, allow, deny...) on top of the
// PGlite stand-in, so the Firebase rule tests run against the new database almost word for word.
// - Writes go through public.fx_commit as that person ('owner' in the old tests = the server's secret key).
// - getDoc is allowed if the row comes back, or if it doesn't exist at all (Firestore's "not found means allowed").
// - query is allowed if the person sees every row the query matches (Firestore refuses a list that could include
//   something you can't read; row level security would quietly leave it out, so seeing fewer counts as refused).
// - A test that touches a collection that isn't ported yet counts as "waiting", not as a pass or a failure.
import { makeDb, as, uidOf as uuidOf, FIREBASE } from './harness.mjs';

export const db = await makeDb();
export const uidOf = uuidOf;
const who2 = who => (who === 'owner' ? 'server' : who);

// Dates become {"$t": milliseconds}, the way timestamps are kept in `data`
export function enc(v) {
  if (v instanceof Date) return { $t: v.getTime() };
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]));
  return v;
}

const atPath = (o, f) => f.split('.').reduce((x, k) => (x && typeof x === 'object' && k in x ? x[k] : undefined), o);

// rules2's write(path, op), op = { set, merge (field names), del, union, remove, inc, serverTime, exists, full },
// turned into an fx_commit write. A field mask (merge) replaces each named field, or removes it if `set` doesn't
// have it, like Firestore's REST updateMask; transforms without a mask change nothing else.
export function write(path, op) {
  if (op.del) return { path, delete: true };
  const t = [];
  Object.entries(op.union || {}).forEach(([f, v]) => t.push({ field: f, arrayUnion: enc(v) }));
  Object.entries(op.remove || {}).forEach(([f, v]) => t.push({ field: f, arrayRemove: enc(v) }));
  Object.entries(op.inc || {}).forEach(([f, v]) => t.push({ field: f, increment: v }));
  (op.serverTime || []).forEach(f => t.push({ field: f, serverTime: true }));
  const w = { path }, set = enc(op.set || {});
  if (op.merge || (t.length && !op.full)) {
    w.update = {};
    // (a mask path may be dotted, nicknames.Bob: its value is read from inside `set`)
    for (const f of op.merge || []) { const v = atPath(set, f); if (v !== undefined) w.update[f] = v; else t.unshift({ field: f, delete: true }); }
    if (op.exists === undefined) w.upsert = true;
  } else w.set = set;
  if (t.length) w.transforms = t;
  if (op.exists !== undefined) w.exists = op.exists;
  return w;
}

// A few tests hand over a raw Firestore REST write ({update: {name, fields}, updateMask, currentDocument, ...});
// this turns one into an fx_commit write.
const DOC_NAME = /\/documents\/(.+)$/;
function unval(v) {
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return { $t: Date.parse(v.timestampValue) };
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(unval);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, unval(x)]));
  throw new Error('value ' + JSON.stringify(v));
}
function fromRest(w) {
  if (w.path) return w;
  if (w.delete) return { path: DOC_NAME.exec(w.delete)[1], delete: true };
  const out = { path: DOC_NAME.exec(w.update.name)[1] };
  const fields = Object.fromEntries(Object.entries(w.update.fields || {}).map(([k, v]) => [k, unval(v)]));
  const t = (w.updateTransforms || []).map(x => x.increment ? { field: x.fieldPath, increment: unval(x.increment) }
    : x.appendMissingElements ? { field: x.fieldPath, arrayUnion: x.appendMissingElements.values.map(unval) }
    : x.removeAllFromArray ? { field: x.fieldPath, arrayRemove: x.removeAllFromArray.values.map(unval) }
    : x.setToServerValue ? { field: x.fieldPath, serverTime: true } : (() => { throw new Error('transform ' + JSON.stringify(x)); })());
  if (w.updateMask) {
    out.update = {};
    for (const f of w.updateMask.fieldPaths) { const v = atPath(fields, f); if (v !== undefined) out.update[f] = v; else t.unshift({ field: f, delete: true }); }
    if (!w.currentDocument) out.upsert = true;
  } else out.set = fields;
  if (t.length) out.transforms = t;
  if (w.currentDocument && 'exists' in w.currentDocument) out.exists = w.currentDocument.exists;
  return out;
}

let seeding = false;
export async function commit(who, writes) {
  // (2 ms first, like the trip to a real server: the local database's clock only counts whole milliseconds, so a
  // time a test makes up could otherwise land on the very millisecond of the write)
  await new Promise(res => setTimeout(res, 2));
  writes = writes.map(fromRest);
  const r = await as(db, who2(who), 'select public.fx_commit($1) r', [JSON.stringify(writes)]);
  const out = { ok: r.ok, status: r.ok ? 200 : 403, text: r.ok ? '' : r.error };
  if (seeding && !r.ok && !/no table for/.test(r.error)) throw new Error('seed write refused: ' + r.error + ' ' + JSON.stringify(writes).slice(0, 300));
  return out;
}
export const setDoc = (who, path, data, extra = {}) => commit(who, [write(path, { set: data, ...extra })]);
export const updateDoc = (who, path, data, extra = {}) => commit(who, [write(path, { set: data, merge: Object.keys(data), exists: true, ...extra })]);
export const delDoc = (who, path) => commit(who, [write(path, { del: true })]);

// One document, through public.fx_get like the site's doc.get(): allowed if it comes back, or doesn't exist.
export async function getDoc(who, path) {
  const r = await as(db, who2(who), 'select public.fx_get($1) r', [path]);
  return { ok: r.ok, status: r.ok ? 200 : 403, text: r.error || '' };
}

const OPS = { EQUAL: '=', LESS_THAN: '<', LESS_THAN_OR_EQUAL: '<=', GREATER_THAN: '>', GREATER_THAN_OR_EQUAL: '>=', NOT_EQUAL: '<>' };
export async function query(who, parentPath, collectionId, where) {
  const pattern = (parentPath ? parentPath.split('/').map((s, i) => (i % 2 ? '*' : s)).join('/') + '/' : '') + collectionId + '/*';
  const rt = (await db.query('select tbl, cols from fx.routes where pattern = $1', [pattern])).rows[0];
  if (!rt) return { ok: false, status: 400, text: 'no table for ' + pattern };
  const ids = parentPath ? parentPath.split('/').filter((_, i) => i % 2) : [];
  const conds = ids.map((_, i) => `"${rt.cols[i]}" = $${i + 1}`), params = [...ids];
  if (where) {
    const [field, op, value] = where;
    params.push(JSON.stringify(enc(value)));
    const p = `$${params.length}::jsonb`, f = `(data #> '{${field.split('.').join(',')}}')`;
    if (op === 'ARRAY_CONTAINS') conds.push(`${f} @> jsonb_build_array(${p})`);
    else if (op === 'IN') conds.push(`${f} in (select jsonb_array_elements(${p}))`);
    else if (OPS[op]) conds.push(`${f} ${OPS[op]} ${p}`);
    else throw new Error('query op ' + op);
  }
  const sql = `select count(*)::int n from public."${rt.tbl}"` + (conds.length ? ' where ' + conds.join(' and ') : '');
  const all = (await db.query(sql, params)).rows[0].n;
  if (all === 0 && who !== 'owner') return probe(who, rt, ids, where, sql, params);
  const r = await as(db, who2(who), sql, params);
  return { ok: r.ok && r.rows[0].n === all, status: r.ok ? 200 : 403, text: r.error || `saw ${r.ok ? r.rows[0].n : '?'} of ${all}` };
}
// An empty list: Firestore still refuses it when the rules would refuse what it could hold. So add one sample row
// that matches the query (made by the database itself, no rules), see whether the person can read it, and undo it.
async function probe(who, rt, ids, where, sql, params) {
  let data = {};
  if (where) {
    const [field, op, value] = where, v = enc(op === 'ARRAY_CONTAINS' ? [value] : op === 'IN' ? value[0] : value);
    data = field.split('.').reduceRight((acc, k) => ({ [k]: acc }), v);
  }
  const keys = [...ids, '__probe__'];
  await db.exec('begin');
  try {
    await db.query(`insert into public."${rt.tbl}" (${rt.cols.map(c => `"${c}"`).join(', ')}, data) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}, $${keys.length + 1})`,
      [...keys, JSON.stringify(data)]);
    if (who) {
      await db.exec('set local role authenticated');
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uidOf(who), role: 'authenticated', ...FIREBASE })]);
    } else await db.exec('set local role anon');
    const n = (await db.query(sql, params)).rows[0].n;
    return { ok: n === 1, status: n === 1 ? 200 : 403, text: n === 1 ? '' : 'the sample row was hidden' };
  } catch (e) {
    return { ok: false, status: 403, text: e.message };
  } finally {
    await db.exec('rollback');
  }
}

// The Realtime Database stays on Firebase, with sign-in (2026-11-16): rules2.test.js keeps testing it on the Firebase
// emulators, so here those checks are only counted.
const RTDB_STAYS = 'stays on Firebase (Realtime Database)';
const rtStays = async () => ({ ok: false, status: 0, text: RTDB_STAYS });
export const rtPut = rtStays, rtDel = rtStays, rtGet = rtStays;

// ---------- the runner, as in rules2 ----------
let pass = 0, fail = 0, waiting = 0, onFirebase = 0;
const waitingBy = {};
export async function expect(label, want, p) {
  const r = await p;
  if (r.text === RTDB_STAYS) { onFirebase++; return; }
  const m = /no table for ([^\s:]+)/.exec(r.text || '');
  if (m) { waiting++; waitingBy[m[1]] = (waitingBy[m[1]] || 0) + 1; if (process.env.VERBOSE) console.log('  wait  ' + label); return; }
  const got = r.ok ? 'allow' : 'deny';
  if (got === want) { pass++; if (process.env.VERBOSE) console.log(`  ok    ${want.padEnd(5)}  ${label}`); }
  else { fail++; console.log(`  FAIL  wanted ${want}, got ${got}  ${label}\n        ${(r.text || '').replace(/\s+/g, ' ').slice(0, 300)}`); }
}
export const allow = (l, p) => expect(l, 'allow', p), deny = (l, p) => expect(l, 'deny', p);
export const daysAgo = d => new Date(Date.now() - d * 86400000);
export const section = s => console.log('\n' + s);
export function seedMode(on) { seeding = on; }
export function summary() {
  console.log(`\n${pass} passed, ${fail} failed, ${waiting} waiting for collections not ported yet, ${onFirebase} Realtime Database checks that stay on Firebase`);
  const top = Object.entries(waitingBy).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} ${n}`).join(', ');
  if (top) console.log('waiting on: ' + top);
  return fail;
}
