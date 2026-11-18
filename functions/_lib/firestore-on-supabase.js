// Firestore's REST API, answered by Supabase (the Supabase switch).
// Frixion's server functions (functions/api/admin, discord, push) talk to the database in Firestore's REST shapes.
// With SUPABASE_URL and SUPABASE_SECRET_KEY set, each of those requests becomes one call to the database functions in
// supabase/sql (fx_get, fx_get_many, fx_query, fx_commit) made with the secret key, which the database's rules let do
// anything (fx.trusted()), and the answer comes back in Firestore's shapes. So the routes keep their tested logic, and
// one Firestore request stays one request (a Cloudflare function may only make 50).
// It understands what the functions use: getting, listing, patching and deleting a document; :commit (update, with or
// without a mask, its transforms, delete, transform writes; preconditions exists and updateTime); :batchGet; :runQuery
// (field filters, AND, orderBy, limit). Anything else gets 501, so a new kind of request shows up in testing.
// Timestamps go in as Firestore timestamps and come out the same; the database keeps them as {"$t": milliseconds}.
// updateTime is the database's own version stamp (updated_at): only good for handing back as a precondition, as the
// functions do.
// Not a route: this file exports no onRequest, so Cloudflare Pages doesn't serve it as one.

const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/liquidalt/databases/(default)/documents';

// fetch(), except that Firestore's REST requests go to Supabase once env.SUPABASE_URL is set
export function firestoreFetch(env, url, init) {
  const base = (env && env.FIRESTORE_URL) || FIRESTORE, u = String(url);
  const ours = env && env.SUPABASE_URL && env.SUPABASE_SECRET_KEY && (u.startsWith(base + '/') || u.startsWith(base + ':') || u.startsWith(base + '?') || u === base);
  if (!ours) return fetch(url, init);
  return answer(env, base, u, init || {}).catch(e => reply(e.status || 500, { error: { code: e.status || 500, message: String((e && e.message) || e), status: e.why || 'INTERNAL' } }));
}

// ---------- values ----------
function toFx(v) {
  if (!v || typeof v !== 'object' || 'nullValue' in v) return null;
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return String(v.stringValue);
  if ('timestampValue' in v) return { $t: Date.parse(v.timestampValue) };
  if ('referenceValue' in v) return { $ref: String(v.referenceValue).replace(/^.*?\/documents\//, '') };
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(toFx);
  if ('mapValue' in v) return fieldsToFx(v.mapValue && v.mapValue.fields);
  throw oops(501, 'UNIMPLEMENTED', 'That kind of value isn\'t kept: ' + Object.keys(v).join());
}
const fieldsToFx = f => Object.fromEntries(Object.entries(f || {}).map(([k, x]) => [k, toFx(x)]));
function fromFx(v, prefix) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : Number.isFinite(v) ? { doubleValue: v }
    : { doubleValue: v > 0 ? 'Infinity' : v < 0 ? '-Infinity' : 'NaN' };   // (as Firestore's REST API writes them: JSON has no Infinity)
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(x => fromFx(x, prefix)) } : {} };
  const keys = Object.keys(v);
  if (keys.length === 1 && keys[0] === '$t' && typeof v.$t === 'number') return { timestampValue: new Date(v.$t).toISOString() };
  if (keys.length === 1 && keys[0] === '$ref' && typeof v.$ref === 'string') return { referenceValue: prefix + v.$ref };
  return { mapValue: { fields: fieldsFromFx(v, prefix) } };
}
const fieldsFromFx = (o, prefix) => Object.fromEntries(Object.entries(o || {}).map(([k, x]) => [k, fromFx(x, prefix)]));

// Firestore field paths: names joined by dots, a name with other characters in backticks
function fieldPath(fp) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < fp.length; i++) {
    const c = fp[i];
    if (quoted) { if (c === '\\') cur += fp[++i]; else if (c === '`') quoted = false; else cur += c; }
    else if (c === '`') quoted = true;
    else if (c === '.') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function getPath(o, names) {
  for (const n of names) { if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined; o = o[n]; }
  return o;
}
function setPath(o, names, v) {
  names.slice(0, -1).forEach(n => { if (!o[n] || typeof o[n] !== 'object') o[n] = {}; o = o[n]; });
  o[names[names.length - 1]] = v;
}
// only these fields (a read's mask)
function masked(data, mask) {
  if (!mask || !mask.length || !data) return data;
  const out = {};
  for (const fp of mask) { const names = fieldPath(fp), v = getPath(data, names); if (v !== undefined) setPath(out, names, v); }
  return out;
}

// ---------- answers ----------
function oops(status, why, message) { return Object.assign(new Error(message), { status, why }); }
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
// Infinity has no JSON form: JSON.stringify writes it as null, which everything reads as 0. A number far past what
// JavaScript can hold (1e309) is kept by Postgres as it is and reads back in JavaScript as Infinity, so Orbs that are
// infinite stay infinite on their way through the server (v4.66, request 51).
const INF = '\u0000inf\u0000';
const bigJson = v => JSON.stringify(v, (k, x) => (typeof x === 'number' && (x === Infinity || x === -Infinity) ? (x > 0 ? INF : '-' + INF) : x))
  .replace(/"(-?)\\u0000inf\\u0000"/g, (m, sign) => sign + '1e309');
export { bigJson as _bigJsonForTests };
async function rpc(env, name, args) {
  const key = env.SUPABASE_SECRET_KEY;
  const r = await fetch(`${String(env.SUPABASE_URL).replace(/\/+$/, '')}/rest/v1/rpc/${name}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key }, body: bigJson(args) });
  const j = await r.json().catch(() => null);
  if (r.ok) return j;
  // the database's refusals as Firestore says them (the functions look at the status)
  const code = (j && j.code) || '', msg = (j && j.message) || ('database error ' + r.status);
  if (code === 'FX409') throw oops(400, 'FAILED_PRECONDITION', msg);
  if (code === '23505') throw oops(409, 'ALREADY_EXISTS', msg);
  if (code === 'P0002') throw oops(404, 'NOT_FOUND', msg);
  if (code === '42501') throw oops(403, 'PERMISSION_DENIED', msg);
  if (code === 'FX400' || code === '22023' || code === '22P02') throw oops(400, 'INVALID_ARGUMENT', msg);
  if (r.status === 402 || r.status === 429 || /quota|exceed|restricted/i.test(msg)) throw oops(429, 'RESOURCE_EXHAUSTED', msg);
  throw oops(r.status >= 500 ? 503 : 500, r.status >= 500 ? 'UNAVAILABLE' : 'INTERNAL', msg);
}
const OPS = { EQUAL: '==', NOT_EQUAL: '!=', LESS_THAN: '<', LESS_THAN_OR_EQUAL: '<=', GREATER_THAN: '>', GREATER_THAN_OR_EQUAL: '>=',
  ARRAY_CONTAINS: 'array-contains', IN: 'in', ARRAY_CONTAINS_ANY: 'array-contains-any', NOT_IN: 'not-in' };
function filtersOf(w, out = []) {
  if (!w) return out;
  if (w.fieldFilter) {
    const op = OPS[w.fieldFilter.op];
    if (!op) throw oops(501, 'UNIMPLEMENTED', 'Filter ' + w.fieldFilter.op);
    out.push([fieldPath(w.fieldFilter.field.fieldPath), op, toFx(w.fieldFilter.value)]);
  } else if (w.compositeFilter && w.compositeFilter.op === 'AND') (w.compositeFilter.filters || []).forEach(f => filtersOf(f, out));
  else throw oops(501, 'UNIMPLEMENTED', 'Only field filters joined by AND.');
  return out;
}
function transformOf(t) {
  const field = fieldPath(t.fieldPath);
  if ('increment' in t) return { field, increment: toFx(t.increment) };
  if ('maximum' in t) return { field, maximum: toFx(t.maximum) };
  if ('minimum' in t) return { field, minimum: toFx(t.minimum) };
  if ('appendMissingElements' in t) return { field, arrayUnion: ((t.appendMissingElements && t.appendMissingElements.values) || []).map(toFx) };
  if ('removeAllFromArray' in t) return { field, arrayRemove: ((t.removeAllFromArray && t.removeAllFromArray.values) || []).map(toFx) };
  if (t.setToServerValue === 'REQUEST_TIME') return { field, serverTime: true };
  throw oops(501, 'UNIMPLEMENTED', 'Transform ' + Object.keys(t).join());
}
// one write of a :commit, as public.fx_commit takes it (transforms: the Firestore ones, in order, for the results)
function writeOf(w, pathOf) {
  const pre = {}, cd = w.currentDocument;
  if (cd && 'exists' in cd) pre.exists = !!cd.exists;
  if (cd && cd.updateTime) pre.updatedAt = cd.updateTime;
  if (w.delete) return { fx: { path: pathOf(w.delete), delete: true, ...pre }, transforms: [] };
  if (w.transform) {
    const tf = (w.transform.fieldTransforms || []).map(transformOf);
    return { fx: { path: pathOf(w.transform.document), updatePaths: [], upsert: true, transforms: tf, ...pre }, transforms: tf };
  }
  if (!w.update) throw oops(501, 'UNIMPLEMENTED', 'Only update, delete and transform writes.');
  const path = pathOf(w.update.name), data = fieldsToFx(w.update.fields), tf = (w.updateTransforms || []).map(transformOf);
  if (!w.updateMask) return { fx: { path, set: data, ...(tf.length ? { transforms: tf } : {}), ...pre }, transforms: tf };
  // only the fields in the mask: set from the given ones, deleted where the mask names one that wasn't given
  const updatePaths = [], gone = [];
  for (const fp of w.updateMask.fieldPaths || []) {
    const names = fieldPath(fp), v = getPath(data, names);
    if (v === undefined) gone.push({ field: names, delete: true }); else updatePaths.push([names, v]);
  }
  return { fx: { path, updatePaths, upsert: true, transforms: [...gone, ...tf], ...pre }, transforms: tf };
}

async function answer(env, base, u, init) {
  const prefix = new URL(base).pathname.replace(/^\/v1\//, '') + '/';
  const pathOf = name => {
    const s = String(name), i = s.indexOf('/documents/');
    if (i < 0) throw oops(400, 'INVALID_ARGUMENT', 'Not a document name: ' + s);
    return s.slice(i + '/documents/'.length);
  };
  const doc = (path, data, updatedAt) => ({ name: prefix + path, fields: fieldsFromFx(data || {}, prefix), ...(updatedAt ? { updateTime: updatedAt } : {}) });
  const now = new Date().toISOString();
  const method = String(init.method || 'GET').toUpperCase();
  const q = new URL(u).searchParams;
  const tail = u.slice(base.length).split('?')[0];          // "/users/x", ":commit", "/servers/a/channels/b:runQuery"
  const m = /^(?:\/([^:]*))?(?::(commit|batchGet|runQuery))?$/.exec(tail);
  if (!m) throw oops(501, 'UNIMPLEMENTED', 'Not a request this understands: ' + tail);
  const path = (m[1] || '').split('/').filter(Boolean).map(decodeURIComponent).join('/'), op = m[2];
  const body = init.body ? JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body)) : {};

  if (op === 'commit') {
    const ws = (body.writes || []).map(w => writeOf(w, pathOf));
    if (!ws.length) return reply(200, { writeResults: [], commitTime: now });
    const res = await rpc(env, 'fx_commit', { writes: ws.map(w => w.fx) });
    return reply(200, { commitTime: now, writeResults: ws.map((w, i) => {
      const r = res[i] || {};
      return { ...(r.updatedAt ? { updateTime: r.updatedAt } : { updateTime: now }),
        transformResults: w.transforms.map(t => (t.arrayUnion || t.arrayRemove ? { nullValue: null } : fromFx(getPath(r.data, t.field), prefix))) };
    }) });
  }
  if (op === 'batchGet') {
    const names = body.documents || [], mask = body.mask && body.mask.fieldPaths;
    if (!names.length) return reply(200, []);
    const got = await rpc(env, 'fx_get_many', { paths: names.map(pathOf) });
    return reply(200, names.map((n, i) => {
      const g = got[i] || {};
      return g.exists ? { found: doc(pathOf(n), masked(g.data, mask), g.updatedAt), readTime: now } : { missing: n, readTime: now };
    }));
  }
  if (op === 'runQuery') {
    const sq = body.structuredQuery || {}, from = (sq.from || [])[0];
    if (!from || from.allDescendants) throw oops(501, 'UNIMPLEMENTED', 'Only one collection at a time.');
    const coll = (path ? path + '/' : '') + from.collectionId;
    const orders = (sq.orderBy || []).map(o => [fieldPath(o.field.fieldPath), o.direction === 'DESCENDING' ? 'desc' : 'asc']);
    const lim = sq.limit == null ? null : Number(typeof sq.limit === 'object' ? sq.limit.value : sq.limit);
    const rows = await rpc(env, 'fx_query', { coll, filters: filtersOf(sq.where), orders, lim, last: false });
    const mask = sq.select && sq.select.fields && sq.select.fields.map(f => f.fieldPath);
    return reply(200, rows.length ? rows.map(r => ({ document: doc(coll + '/' + r.id, masked(r.data, mask), r.updatedAt), readTime: now })) : [{ readTime: now }]);
  }
  const segs = path ? path.split('/').length : 0;
  if (!segs) throw oops(501, 'UNIMPLEMENTED', 'No path.');
  if (segs % 2 === 1) {   // a collection: list its documents
    if (method !== 'GET') throw oops(501, 'UNIMPLEMENTED', 'Only listing a collection.');
    const rows = await rpc(env, 'fx_query', { coll: path, filters: [], orders: [], lim: Math.min(Number(q.get('pageSize')) || 100, 300), last: false });
    return reply(200, rows.length ? { documents: rows.map(r => doc(path + '/' + r.id, r.data, r.updatedAt)) } : {});
  }
  if (method === 'GET') {
    const g = await rpc(env, 'fx_get', { path });
    if (!g || !g.exists) return reply(404, { error: { code: 404, message: 'No document to read: ' + path, status: 'NOT_FOUND' } });
    return reply(200, doc(path, masked(g.data, q.getAll('mask.fieldPaths')), g.updatedAt));
  }
  if (method === 'PATCH' || method === 'DELETE') {
    const w = method === 'DELETE' ? { delete: prefix + path } : { update: { name: prefix + path, fields: body.fields || {} },
      ...(q.getAll('updateMask.fieldPaths').length ? { updateMask: { fieldPaths: q.getAll('updateMask.fieldPaths') } } : {}) };
    if (q.has('currentDocument.exists')) w.currentDocument = { exists: q.get('currentDocument.exists') === 'true' };
    if (q.has('currentDocument.updateTime')) w.currentDocument = { updateTime: q.get('currentDocument.updateTime') };
    const one = writeOf(w, pathOf);
    const [r] = await rpc(env, 'fx_commit', { writes: [one.fx] });
    return reply(200, method === 'DELETE' ? {} : doc(path, r && r.data, r && r.updatedAt));
  }
  throw oops(501, 'UNIMPLEMENTED', method + ' on a document.');
}
