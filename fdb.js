/* fdb.js: Frixion's database calls, Firestore-shaped, on Supabase.
   The site keeps talking to `db` the way it talked to Firestore (collection/doc, get/set/update/delete/add, where/
   orderBy/limit/limitToLast, onSnapshot, batch, runTransaction, FieldValue, Timestamp, FieldPath). This turns those
   calls into Supabase ones:
   - one document: public.fx_get (the "get" rules, including the few that let more people fetch one than list them);
   - lists: public.fx_query (filters, sorts and limits worked out in the database, under the tables' read rules);
   - every write, batch and transaction: public.fx_commit (one transaction, judged by the tables' write rules);
   - live listeners: Supabase Realtime's Postgres Changes on the document's table, applied as they come instead of
     reading the whole list again (Supabase's free plan counts data sent out).
   Sign-in stays on Firebase: supabase-js is made with an accessToken function that hands it Firebase's token.
   Timestamps are kept in the database as {"$t": milliseconds} and come back as Timestamp objects.
   Works as a plain <script> (window.createFdb) and from Node (module.exports) for the tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.createFdb = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- values ----------
  class Timestamp {
    constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
    static now() { return Timestamp.fromMillis(Date.now()); }
    static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
    static fromMillis(ms) { const s = Math.floor(ms / 1000); return new Timestamp(s, Math.round((ms - s * 1000) * 1e6)); }
    toMillis() { return this.seconds * 1000 + this.nanoseconds / 1e6; }
    toDate() { return new Date(this.toMillis()); }
    isEqual(o) { return o instanceof Timestamp && o.seconds === this.seconds && o.nanoseconds === this.nanoseconds; }
    valueOf() { return String(this.seconds).padStart(12, '0') + '.' + String(this.nanoseconds).padStart(9, '0'); }
    toJSON() { return { seconds: this.seconds, nanoseconds: this.nanoseconds }; }
  }
  class Sentinel { constructor(kind, arg) { this.kind = kind; this.arg = arg; } }
  const FieldValue = {
    serverTimestamp: () => new Sentinel('serverTime'),
    increment: n => new Sentinel('increment', n),
    arrayUnion: (...v) => new Sentinel('arrayUnion', v),
    arrayRemove: (...v) => new Sentinel('arrayRemove', v),
    delete: () => new Sentinel('delete'),
  };
  class FieldPath {
    constructor(...names) { this.names = names; }
    static documentId() { return new FieldPath('__name__'); }
    isEqual(o) { return o instanceof FieldPath && o.names.join('\u0000') === this.names.join('\u0000'); }
  }
  const pathOf = f => (f instanceof FieldPath ? f.names.slice() : String(f).split('.'));

  function fail(code, message) { return Object.assign(new Error(message), { code, name: 'FirebaseError' }); }
  // Postgres and Supabase errors as the codes Frixion already checks (e.code === 'permission-denied' and so on)
  function mapError(err, status) {
    if (!err) return fail('unknown', 'Something went wrong.');
    const code = err.code || '', msg = err.message || String(err);
    if (code === '42501' || /permission denied|row-level security/i.test(msg)) return fail('permission-denied', 'Missing or insufficient permissions.');
    if (code === 'P0002') return fail('not-found', msg);
    if (code === '23505') return fail('already-exists', msg);
    if (code === 'FX409') return fail('failed-precondition', msg);
    if (code === 'FX400' || code === '22023' || code === '22P02') return fail('invalid-argument', msg);
    if (status === 401 || code === 'PGRST301' || code === 'PGRST303') return fail('unauthenticated', msg);
    if (status === 402 || status === 429 || /quota|exceed|restricted/i.test(msg)) return fail('resource-exhausted', 'Quota exceeded.');
    if (/fetch|network|Failed to fetch|NetworkError/i.test(msg) || status === 0 || status >= 500) return fail('unavailable', msg);
    return fail('unknown', msg);
  }

  // JS values to what the database keeps, and back
  function enc(v) {
    if (v === undefined) throw fail('invalid-argument', 'Unsupported field value: undefined');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw fail('invalid-argument', 'Unsupported field value: ' + v); return v; }
    if (v instanceof Timestamp) return { $t: v.toMillis() };
    if (v instanceof Date) return { $t: v.getTime() };
    if (v instanceof Sentinel) throw fail('invalid-argument', 'FieldValue can\'t go inside an array.');
    if (v instanceof DocumentReference) return { $ref: v.path };
    if (Array.isArray(v)) return v.map(enc);
    if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = enc(v[k]); return o; }
    throw fail('invalid-argument', 'Unsupported field value: ' + typeof v);
  }
  function dec(v, db) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(x => dec(x, db));
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === '$t' && typeof v.$t === 'number') return Timestamp.fromMillis(v.$t);
    if (keys.length === 1 && keys[0] === '$ref' && typeof v.$ref === 'string' && db) return new DocumentReference(db, v.$ref);
    const o = {};
    for (const k of keys) o[k] = dec(v[k], db);
    return o;
  }
  // Pulls FieldValue sentinels out of a document (or an update's value) into transforms at their full paths.
  function split(obj, base, transforms) {
    const out = {};
    for (const k of Object.keys(obj)) {
      const v = obj[k], p = base.concat([k]);
      if (v === undefined) throw fail('invalid-argument', 'Unsupported field value: undefined (in field ' + p.join('.') + ')');
      if (v instanceof Sentinel) { transforms.push(toTransform(p, v)); continue; }
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp) && !(v instanceof Date) && !(v instanceof DocumentReference)) out[k] = split(v, p, transforms);
      else out[k] = enc(v);
    }
    return out;
  }
  function toTransform(field, s) {
    if (s.kind === 'serverTime') return { field, serverTime: true };
    if (s.kind === 'delete') return { field, delete: true };
    if (s.kind === 'increment') return { field, increment: s.arg };
    if (s.kind === 'arrayUnion') return { field, arrayUnion: s.arg.map(enc) };
    if (s.kind === 'arrayRemove') return { field, arrayRemove: s.arg.map(enc) };
    throw fail('invalid-argument', 'Unknown FieldValue');
  }

  // ---------- references and snapshots ----------
  let fdbDb = null;   // (set by createFdb; references need their db)
  class DocumentReference {
    constructor(db, path) {
      const segs = String(path).split('/');
      if (!path || segs.length % 2 || segs.some(s => !s)) throw fail('invalid-argument', 'Not a document path: ' + path);
      this.firestore = db; this.path = String(path); this.id = segs[segs.length - 1];
    }
    get parent() { return new CollectionReference(this.firestore, this.path.split('/').slice(0, -1).join('/')); }
    collection(name) { return new CollectionReference(this.firestore, this.path + '/' + name); }
    get(opts) { return this.firestore._get(this, opts); }
    set(data, opts) { return this.firestore._commit([this.firestore._setWrite(this, data, opts)]).then(() => undefined); }
    update(...args) { return this.firestore._commit([this.firestore._updateWrite(this, args)]).then(() => undefined); }
    delete() { return this.firestore._commit([{ path: this.path, delete: true }]).then(() => undefined); }
    onSnapshot(...args) { return this.firestore._listen(this, args); }
    isEqual(o) { return o instanceof DocumentReference && o.path === this.path; }
  }
  class Query {
    constructor(db, path, q) { this.firestore = db; this._path = path; this._q = q || { filters: [], orders: [], limit: null, last: false }; }
    _with(ch) { return new Query(this.firestore, this._path, Object.assign({}, this._q, ch)); }
    where(field, op, value) { return this._with({ filters: this._q.filters.concat([[pathOf(field), op, value]]) }); }
    orderBy(field, dir) { return this._with({ orders: this._q.orders.concat([[pathOf(field), dir === 'desc' ? 'desc' : 'asc']]) }); }
    limit(n) { return this._with({ limit: n, last: false }); }
    limitToLast(n) { return this._with({ limit: n, last: true }); }
    get() { return this.firestore._query(this); }
    onSnapshot(...args) { return this.firestore._listen(this, args); }
  }
  class CollectionReference extends Query {
    constructor(db, path) {
      super(db, path);
      const segs = String(path).split('/');
      if (!path || segs.length % 2 === 0 || segs.some(s => !s)) throw fail('invalid-argument', 'Not a collection path: ' + path);
      this.path = String(path); this.id = segs[segs.length - 1];
    }
    get parent() { const segs = this.path.split('/'); return segs.length > 1 ? new DocumentReference(this.firestore, segs.slice(0, -1).join('/')) : null; }
    doc(id) { return new DocumentReference(this.firestore, this.path + '/' + (id === undefined ? autoId() : id)); }
    add(data) { const ref = this.doc(); return this.firestore._commit([this.firestore._setWrite(ref, data, null, true)]).then(() => ref); }
  }
  const META = Object.freeze({ fromCache: false, hasPendingWrites: false });
  const SAVING = Object.freeze({ fromCache: false, hasPendingWrites: true });   // (this page's own write, on its way)
  class DocumentSnapshot {
    // times: the fields holding a time this page asked the database for (serverTimestamp) and hasn't got back yet;
    // prev: the document before this page's writes on their way (for serverTimestamps: 'previous')
    constructor(ref, raw, updatedAt, meta, times, prev) {
      this.ref = ref; this.id = ref.id; this._raw = raw; this._updatedAt = updatedAt || null; this.metadata = meta || META;
      this._times = times && times.length ? times : null; this._prev = prev == null ? null : prev;
    }
    get exists() { return this._raw != null; }
    // Such a time reads as null until the database gives it, the way Firestore did; { serverTimestamps: 'estimate' }
    // gives this device's clock instead, and 'previous' the value it had before.
    data(o) {
      if (this._raw == null) return undefined;
      const out = dec(this._raw, this.ref.firestore), how = o && o.serverTimestamps;
      if (this._times && how !== 'estimate') for (const p of this._times) {
        const was = how === 'previous' ? getPath(this._prev, p) : undefined;
        setPath(out, p, was === undefined ? null : dec(was, this.ref.firestore));
      }
      return out;
    }
    get(field, o) {
      if (this._raw == null) return undefined;
      if (this._times && !(o && o.serverTimestamps === 'estimate')) return getPath(this.data(o), pathOf(field));
      let v = this._raw;
      for (const k of pathOf(field)) { if (v == null || typeof v !== 'object') return undefined; v = v[k]; }
      return v === undefined ? undefined : dec(v, this.ref.firestore);
    }
  }
  class QuerySnapshot {
    constructor(query, docs, changes, meta) { this.query = query; this.docs = docs; this._changes = changes; this.metadata = meta || META; }
    get size() { return this.docs.length; }
    get empty() { return this.docs.length === 0; }
    forEach(fn, thisArg) { this.docs.forEach(fn, thisArg); }
    docChanges() { return this._changes; }
  }
  function autoId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(20);
    (globalThis.crypto || require('crypto').webcrypto).getRandomValues(bytes);
    let id = '';
    for (const b of bytes) id += chars[b % 62];
    return id;
  }

  // ---------- comparing values the way the database does (for live updates) ----------
  const kind = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? (typeof v.$t === 'number' && Object.keys(v).length === 1 ? 'time' : 'object') : typeof v);
  function same(a, b) {
    if (a === b) return true;
    if (kind(a) !== kind(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
    if (a && typeof a === 'object') { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every(k => same(a[k], b[k])); }
    return false;
  }
  function cmp(a, b) {   // within one kind
    const k = kind(a);
    if (k === 'time') return a.$t - b.$t;
    if (k === 'number') return a - b;
    if (k === 'string') return a < b ? -1 : a > b ? 1 : 0;
    if (k === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
    return 0;
  }
  const at = (data, id, path) => {
    if (path.length === 1 && path[0] === '__name__') return id;
    let v = data;
    for (const k of path) { if (v == null || typeof v !== 'object' || Array.isArray(v)) return undefined; v = v[k]; }
    return v;
  };
  function matches(q, id, data) {
    for (const [path, op, raw] of q.filters) {
      const v = at(data, id, path), w = enc(raw);
      if (op === '==') { if (v === undefined || !same(v, w)) return false; }
      else if (op === '!=') { if (v === undefined || same(v, w)) return false; }
      else if (op === 'array-contains') { if (!Array.isArray(v) || !v.some(x => same(x, w))) return false; }
      else if (op === 'array-contains-any') { if (!Array.isArray(v) || !v.some(x => w.some(y => same(x, y)))) return false; }
      else if (op === 'in') { if (v === undefined || !w.some(y => same(v, y))) return false; }
      else if (op === 'not-in') { if (v === undefined || w.some(y => same(v, y))) return false; }
      else {   // < <= > >= only between values of the same kind
        if (v === undefined || kind(v) !== kind(w)) return false;
        const c = cmp(v, w);
        if (!((op === '<' && c < 0) || (op === '<=' && c <= 0) || (op === '>' && c > 0) || (op === '>=' && c >= 0))) return false;
      }
    }
    for (const [path] of q.orders) if (at(data, id, path) === undefined) return false;
    return true;
  }
  function sorter(q) {
    const lastDir = q.orders.length ? q.orders[q.orders.length - 1][1] : 'asc';
    return (a, b) => {
      for (const [path, dir] of q.orders) {
        const x = at(a._raw, a.id, path), y = at(b._raw, b.id, path);
        let c = kind(x) === kind(y) ? cmp(x, y) : (kind(x) < kind(y) ? -1 : 1);
        if (c) return dir === 'desc' ? -c : c;
      }
      const c = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      return lastDir === 'desc' ? -c : c;
    };
  }

  // ---------- this page's own writes, worked out here before the database answers ----------
  // The same steps fx_commit takes (fx.set_path, fx.deep_merge and fx.transform in supabase/sql/002_commit.sql), on
  // the stored form ({"$t": ms} times), so a list can show what was just written while the database checks it.
  const isMap = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const copy = v => (v === null || typeof v !== 'object' ? v : Array.isArray(v) ? v.map(copy) : Object.fromEntries(Object.keys(v).map(k => [k, copy(v[k])])));
  function getPath(doc, p) { let v = doc; for (const k of p) { if (!isMap(v)) return undefined; v = v[k]; } return v; }
  function setPath(doc, p, val) { let o = doc; for (const k of p.slice(0, -1)) { if (!isMap(o[k])) o[k] = {}; o = o[k]; } o[p[p.length - 1]] = val; }
  function delPath(doc, p) { const o = getPath(doc, p.slice(0, -1)); if (isMap(o)) delete o[p[p.length - 1]]; }
  function mergeInto(a, b) { for (const k of Object.keys(b)) { if (isMap(b[k]) && isMap(a[k])) mergeInto(a[k], b[k]); else a[k] = copy(b[k]); } return a; }
  // A document (stored form, or null) after this page's writes on their way ([{ w, at }], oldest first): { raw (null
  // if they delete it), times (the fields waiting for the database's time, which gets this device's clock for now) }.
  // undefined if it can't be worked out here (an update to a document this page hasn't read).
  function estimate(raw, writes) {
    let doc = raw == null ? null : copy(raw);
    const stamps = [];
    for (const { w, at } of writes) {
      if (w.delete) { doc = null; continue; }
      if (w.verify) continue;
      if (w.create) doc = copy(w.create);
      else if (w.set) doc = w.merge ? mergeInto(isMap(doc) ? doc : {}, w.set) : copy(w.set);
      else if (w.updatePaths) { if (doc == null) return undefined; for (const [p, v] of w.updatePaths) setPath(doc, p, copy(v)); }
      else return undefined;
      for (const t of w.transforms || []) {
        const p = t.field;
        if (t.delete) { delPath(doc, p); continue; }
        const cur = getPath(doc, p);
        let out;
        if ('increment' in t) out = typeof cur === 'number' ? cur + t.increment : t.increment;
        else if (t.arrayUnion) { out = Array.isArray(cur) ? cur.slice() : []; for (const v of t.arrayUnion) if (!out.some(x => same(x, v))) out.push(copy(v)); }
        else if (t.arrayRemove) out = (Array.isArray(cur) ? cur : []).filter(x => !t.arrayRemove.some(y => same(x, y)));
        else if (t.serverTime) { out = { $t: at }; stamps.push([p, out]); }
        else return undefined;
        setPath(doc, p, out);
      }
    }
    return { raw: doc, times: doc == null ? [] : stamps.filter(([p, v]) => getPath(doc, p) === v).map(([p]) => p) };
  }
  // A database time ("2026-11-17 21:40:00.123456+00" from a read or a write's answer, or the ISO form a live change
  // carries) in milliseconds, for telling which of two answers about a document is the newer one.
  function tsNum(s) {
    if (typeof s !== 'string') return -Infinity;
    const m = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d+))?\s*(Z|[+-]\d\d(?::?\d\d)?)?$/i.exec(s.trim());
    if (!m) { const t = Date.parse(s); return Number.isNaN(t) ? -Infinity : t; }
    let off = (m[4] || 'Z').toUpperCase();
    if (off !== 'Z') off = off.length === 3 ? off + ':00' : off.includes(':') ? off : off.slice(0, 3) + ':' + off.slice(3);
    const ms = Date.parse(m[1] + 'T' + m[2] + off);
    return Number.isNaN(ms) ? -Infinity : ms + Number((m[3] || '').slice(0, 3).padEnd(3, '0'));
  }

  // ---------- the database ----------
  function createFdb(sb, opts) {
    opts = opts || {};
    const storage = opts.storage !== undefined ? opts.storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    const cache = new Map();   // path -> { raw, updatedAt }: for get({ source: 'cache' })
    const KEEP = /^(accounts|users)\/[^/]+$/;   // (kept between visits too: logging in when the daily limit is out)
    let routesP = null, seq = 0;
    const inflight = new Set();   // writes on their way (waitForPendingWrites)
    const queue = [];             // ...those this page's live lists show already: { writes, at }, oldest first
    const watchers = new Set();   // live listeners, told when this page writes and when the database answers
    function tell(paths, results) {
      for (const fn of [...watchers]) { try { fn(paths, results); } catch (e) { console.warn('fdb listener:', e && e.message); } }
    }

    async function rpc(name, args) {
      let res;
      try { res = await sb.rpc(name, args); } catch (e) { throw mapError(e, 0); }
      if (res.error) throw mapError(res.error, res.status);
      return res.data;
    }
    function remember(path, raw, updatedAt) {
      cache.set(path, { raw, updatedAt });
      if (storage && KEEP.test(path)) { try { storage.setItem('fdb:' + path, JSON.stringify({ raw, updatedAt })); } catch (e) {} }
    }
    function saved(path) {
      if (cache.has(path)) return cache.get(path);
      if (storage && KEEP.test(path)) { try { const s = storage.getItem('fdb:' + path); if (s) return JSON.parse(s); } catch (e) {} }
      return null;
    }
    function routeFor(collPath) {   // a collection path -> { tbl, cols, ids }
      routesP = routesP || rpc('fx_routes', {}).catch(e => { routesP = null; throw e; });
      return routesP.then(list => {
        const segs = collPath.split('/'), ids = segs.filter((_, i) => i % 2);
        const pattern = segs.map((s, i) => (i % 2 ? '*' : s)).join('/') + '/*';
        const r = list.find(x => x.pattern === pattern);
        if (!r) throw fail('invalid-argument', 'No table for ' + pattern);
        return { tbl: r.tbl, cols: r.cols, ids };
      });
    }

    let rtAuthP = null, rtAuthAt = 0;
    const db = {
      FieldValue, Timestamp, FieldPath,
      collection: p => new CollectionReference(db, p),
      doc: p => new DocumentReference(db, p),
      batch: () => new WriteBatch(db),
      settings() {},
      enablePersistence: () => Promise.resolve(),
      waitForPendingWrites: () => Promise.all([...inflight].map(p => p.catch(() => {}))).then(() => undefined),
      runTransaction: fn => runTransaction(db, fn),

      async _get(ref, o) {
        if (o && o.source === 'cache') {
          const s = saved(ref.path);
          if (!s) throw fail('unavailable', 'Not saved on this device.');
          return new DocumentSnapshot(ref, s.raw, s.updatedAt, { fromCache: true, hasPendingWrites: false });
        }
        const r = await rpc('fx_get', { path: ref.path });
        remember(ref.path, r.exists ? r.data : null, r.updatedAt);
        return new DocumentSnapshot(ref, r.exists ? r.data : null, r.updatedAt);
      },
      async _rows(query) {
        return rpc('fx_query', { coll: query._path, filters: query._q.filters.map(([p, op, v]) => [p, op, enc(v)]),
          orders: query._q.orders, lim: query._q.limit, last: !!query._q.last });
      },
      async _query(query) {
        const rows = await db._rows(query);
        const docs = rows.map(r => new DocumentSnapshot(new DocumentReference(db, query._path + '/' + r.id), r.data, r.updatedAt));
        return new QuerySnapshot(query, docs, docs.map((d, i) => ({ type: 'added', doc: d, oldIndex: -1, newIndex: i })));
      },
      _setWrite(ref, data, o, create) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail('invalid-argument', 'A document is a map.');
        const transforms = [], body = split(data, [], transforms);
        const w = { path: ref.path };
        if (create) w.create = body;
        else { w.set = body; if (o && o.merge) w.merge = true; }
        if (transforms.length) w.transforms = transforms;
        return w;
      },
      _updateWrite(ref, args) {
        const pairs = [];
        if (args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof FieldPath)) {
          for (const k of Object.keys(args[0])) pairs.push([pathOf(k), args[0][k]]);
        } else {
          if (args.length % 2) throw fail('invalid-argument', 'update() wants field, value pairs.');
          for (let i = 0; i < args.length; i += 2) pairs.push([pathOf(args[i]), args[i + 1]]);
        }
        const transforms = [], updatePaths = [];
        for (const [p, v] of pairs) {
          if (v === undefined) throw fail('invalid-argument', 'Unsupported field value: undefined (in field ' + p.join('.') + ')');
          if (v instanceof Sentinel) transforms.push(toTransform(p, v));
          else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp) && !(v instanceof Date) && !(v instanceof DocumentReference)) updatePaths.push([p, split(v, p, transforms)]);
          else updatePaths.push([p, enc(v)]);
        }
        const w = { path: ref.path, updatePaths };
        if (transforms.length) w.transforms = transforms;
        return w;
      },
      // Plain writes and batches show on this page's live lists and documents at once, marked as still saving (the
      // way Firestore did it); the database's answer then confirms them, or takes them away again if it refused
      // them. A transaction's writes (they check what it read) wait for the answer.
      async _commit(writes) {
        const paths = new Set(writes.map(w => w.path));
        const item = writes.some(w => w.verify || 'updatedAt' in w || 'exists' in w) ? null : { writes, at: Date.now() };
        if (item) { queue.push(item); Promise.resolve().then(() => { if (queue.includes(item)) tell(paths, null); }); }
        const p = rpc('fx_commit', { writes });
        inflight.add(p);
        let res;
        try { res = (await p) || []; }
        catch (e) {
          if (item && queue.includes(item)) { queue.splice(queue.indexOf(item), 1); tell(paths, null); }
          throw e;
        } finally { inflight.delete(p); }
        res.forEach(r => { if (r.data !== undefined) remember(r.path, r.data, r.updatedAt); });
        if (item) queue.splice(queue.indexOf(item), 1);
        tell(paths, res.map((r, i) => ({ path: r.path, data: r.data, updatedAt: r.updatedAt, gone: !!(writes[i] && writes[i].delete) })));
        return res;
      },
      // this page's writes on their way to one document (docPath) or to a collection's documents: id -> [{ w, at }]
      _pending(docPath, collPath) {
        const out = new Map();
        for (const it of queue) for (const w of it.writes) {
          const cut = w.path.lastIndexOf('/');
          if (docPath ? w.path !== docPath : w.path.slice(0, cut) !== collPath) continue;
          const id = w.path.slice(cut + 1);
          if (!out.has(id)) out.set(id, []);
          out.get(id).push({ w, at: it.at });
        }
        return out;
      },
      _watch(fn) { watchers.add(fn); return () => watchers.delete(fn); },
      _listen(target, args) { return listen(db, target, args); },
      _routeFor: routeFor,
      _channel: name => sb.channel(name),
      _realtimeAuth: () => {
        if (!sb.realtime || typeof sb.realtime.setAuth !== 'function') return Promise.resolve();
        const now = Date.now();
        if (rtAuthP && now - rtAuthAt < 3000) return rtAuthP;
        rtAuthAt = now;
        rtAuthP = sb.realtime.setAuth().catch(() => {}).finally(() => { setTimeout(() => { if (Date.now() - rtAuthAt >= 3000) rtAuthP = null; }, 3100); });
        return rtAuthP;
      },
      _removeChannel: ch => { try { sb.removeChannel(ch); } catch (e) {} },
      _nextId: () => ++seq,
    };
    fdbDb = db;
    return db;
  }

  class WriteBatch {
    constructor(db) { this._db = db; this._writes = []; this._done = false; }
    set(ref, data, o) { this._writes.push(this._db._setWrite(ref, data, o)); return this; }
    update(ref, ...args) { this._writes.push(this._db._updateWrite(ref, args)); return this; }
    delete(ref) { this._writes.push({ path: ref.path, delete: true }); return this; }
    async commit() {
      if (this._done) throw fail('failed-precondition', 'A batch can only be committed once.');
      this._done = true;
      if (this._writes.length) await this._db._commit(this._writes);
    }
  }

  // Firestore's transactions: read, then write only if nothing read has changed in between (each read's updatedAt,
  // or that it still doesn't exist), and start over if it has, up to 5 times.
  async function runTransaction(db, fn) {
    let lastErr = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const reads = new Map(), writes = [];
      const t = {
        get: async ref => { const s = await db._get(ref); reads.set(ref.path, s._updatedAt); return s; },
        set(ref, data, o) { writes.push(db._setWrite(ref, data, o)); return t; },
        update(ref, ...args) { writes.push(db._updateWrite(ref, args)); return t; },
        delete(ref) { writes.push({ path: ref.path, delete: true }); return t; },
      };
      const result = await fn(t);
      const written = new Set();
      for (const w of writes) {
        if (reads.has(w.path) && !written.has(w.path)) { const u = reads.get(w.path); if (u) w.updatedAt = u; else w.exists = false; }
        written.add(w.path);
      }
      for (const [path, u] of reads) if (!written.has(path)) writes.push(u ? { path, verify: true, updatedAt: u } : { path, verify: true, exists: false });
      if (!writes.length) return result;
      try { await db._commit(writes); return result; }
      catch (e) { if (e.code !== 'failed-precondition') throw e; lastErr = e; }
    }
    throw Object.assign(lastErr || fail('aborted', 'Transaction failed'), { code: 'aborted' });
  }

  // ---------- live listeners ----------
  // Reads right away (a quick first picture), subscribes to the document's table (narrowed to its closest parent, or
  // its id), reads once more when the subscription is up (anything that changed in between), then applies each
  // change as it comes. A list with a limit reads again when a removal leaves a gap. If live updates can't start, the
  // first read still arrives.
  // What it shows is the database's picture with this page's own writes on top while they're on their way (marked
  // metadata.hasPendingWrites), so a message shows the moment it's sent; the database's answer then confirms it, and
  // the live change that follows has nothing left to show.
  function listen(db, target, args) {
    let next, error, withMeta = false;
    if (args[0] && typeof args[0] === 'object' && typeof args[0].next !== 'function' && args.length > 1) { withMeta = !!args[0].includeMetadataChanges; args = args.slice(1); }
    if (args[0] && typeof args[0] === 'object' && typeof args[0].next === 'function') { next = args[0].next.bind(args[0]); error = args[0].error && args[0].error.bind(args[0]); }
    else { next = args[0]; error = args[1]; }
    const isDoc = target instanceof DocumentReference;
    const collPath = isDoc ? target.parent.path : target._path;
    const q = isDoc ? null : target._q;
    const sort = isDoc ? null : sorter(q);
    const trim = a => (q.limit == null ? a : q.last ? a.slice(Math.max(0, a.length - q.limit)) : a.slice(0, q.limit));
    const ours = path => (isDoc ? path === target.path : path.slice(0, path.lastIndexOf('/')) === collPath);
    const refOf = id => (isDoc ? target : new DocumentReference(db, collPath + '/' + id));
    let channel = null, stopped = false, ready = false, pending = [], refill = null;
    let docs = new Map();      // id -> what the database last said (for a list: only what's in it)
    const ver = new Map();     // id -> the database's time for that, so an older answer never undoes a newer one
    const gone = new Map();    // id -> when the database deleted it, so a late answer doesn't bring it back
    let list = [], baseCount = 0, lastSaving = false;
    let loadSeq = 0, appliedSeq = 0, emitted = false, lastDocKey;
    const report = e => { if (!stopped && error) error(e); else if (!stopped) console.warn('fdb listener:', e && e.message); };

    // One thing the database says about a document: { id, raw (null: gone), updatedAt, deletedAt, live }. A read, a
    // live change and the answer to this page's own write can arrive in any order; the newer one wins.
    function put(ev) {
      const id = ev.id;
      if (ev.raw == null) {
        if (ev.deletedAt != null) { if (ver.has(id) && ver.get(id) > ev.deletedAt) return; gone.set(id, ev.deletedAt); }
        docs.delete(id); ver.delete(id);
        return;
      }
      const t = tsNum(ev.updatedAt);
      if (ver.has(id) && ver.get(id) > t) return;
      if (!ev.live && gone.has(id) && gone.get(id) >= t) return;
      const old = docs.get(id);
      docs.set(id, old && JSON.stringify(old._raw) === JSON.stringify(ev.raw) ? old : new DocumentSnapshot(refOf(id), ev.raw, ev.updatedAt));
      ver.set(id, t);
    }
    // (while a read is on its way, news is also kept to apply again on top of what it brings; before the first
    // picture there is nothing to change yet)
    function take(ev) {
      if (!ready) { pending.push(ev); if (!emitted) return false; }
      put(ev);
      return true;
    }
    // the database's document with this page's writes on top: null if they delete it, undefined if nothing can be
    // shown for them (an update to a document this page hasn't read)
    function withMine(id, writes) {
      const s = docs.get(id), e = estimate(s ? s._raw : null, writes);
      if (e === undefined) return undefined;
      return e.raw === null ? null : new DocumentSnapshot(refOf(id), e.raw, s ? s._updatedAt : null, SAVING, e.times, s ? s._raw : null);
    }
    function emit(first) { if (isDoc) emitDoc(); else emitQuery(first); }
    function emitDoc() {
      const w = db._pending(target.path, null).get(target.id);
      let s = docs.get(target.id) || null;
      if (w) { const m = withMine(target.id, w); if (m !== undefined) s = m; }
      const key = s ? JSON.stringify(s._raw) + (withMeta && s.metadata.hasPendingWrites ? ' saving' : '') : null;
      if (emitted && key === lastDocKey) return;   // (nothing new: no second call)
      emitted = true; lastDocKey = key;
      next(s || new DocumentSnapshot(target, null, null));
    }
    function emitQuery(first) {
      // the database's picture, trimmed to the list
      const base = trim([...docs.values()].filter(s => matches(q, s.id, s._raw)).sort(sort));
      const keep = new Set(base.map(s => s.id));
      for (const id of [...docs.keys()]) if (!keep.has(id)) { docs.delete(id); ver.delete(id); }
      // a limited list that lost something may have room for one that wasn't loaded: read it again
      if (q.limit != null && !first && baseCount >= q.limit && base.length < q.limit) scheduleRefill();
      baseCount = base.length;
      // with this page's own writes on top
      let all = base;
      const mine = db._pending(null, collPath);
      if (mine.size) {
        const m = new Map(base.map(s => [s.id, s]));
        for (const [id, w] of mine) { const v = withMine(id, w); if (v === null) m.delete(id); else if (v) m.set(id, v); }
        all = trim([...m.values()].filter(s => matches(q, s.id, s._raw)).sort(sort));
      }
      const before = new Map(list.map((s, i) => [s.id, { s, i }])), changes = [];
      all = all.map((s, i) => {
        const b = before.get(s.id);
        if (!b) { changes.push({ type: 'added', doc: s, oldIndex: -1, newIndex: i }); return s; }
        if (b.s === s) return s;
        const sameData = JSON.stringify(b.s._raw) === JSON.stringify(s._raw);
        if (sameData && b.s.metadata === s.metadata) return b.s;   // (nothing changed: the same object as before)
        if (!sameData || withMeta) changes.push({ type: 'modified', doc: s, oldIndex: b.i, newIndex: i });
        return s;
      });
      const now = new Set(all.map(s => s.id));
      list.forEach((s, i) => { if (!now.has(s.id)) changes.push({ type: 'removed', doc: s, oldIndex: i, newIndex: -1 }); });
      list = all;
      const saving = all.some(s => s.metadata.hasPendingWrites);
      if (!emitted || changes.length || (withMeta && saving !== lastSaving)) {
        emitted = true; lastSaving = saving;
        next(new QuerySnapshot(target, all, changes, saving ? SAVING : META));
      }
    }
    async function load() {
      const mine = ++loadSeq;
      ready = false;
      try {
        let rows;
        if (isDoc) { const r = await db._get(target); rows = r.exists ? [{ id: target.id, data: r._raw, updatedAt: r._updatedAt }] : []; }
        else rows = await db._rows(target);
        if (stopped || mine < appliedSeq) return;   // (an older read that finished after a newer one)
        appliedSeq = mine;
        const fresh = new Map();
        ver.clear();
        for (const r of rows) {
          const old = docs.get(r.id);
          fresh.set(r.id, old && JSON.stringify(old._raw) === JSON.stringify(r.data) ? old : new DocumentSnapshot(refOf(r.id), r.data, r.updatedAt));
          ver.set(r.id, tsNum(r.updatedAt));
        }
        docs = fresh;
        pending.forEach(put);   // (what came in while it was on its way, on top)
        if (mine === loadSeq) { ready = true; pending = []; }
        emit(!emitted);
      } catch (e) { report(e); }
    }
    function scheduleRefill() {
      if (refill) return;
      refill = setTimeout(() => { refill = null; if (!stopped) load(); }, 50);
    }
    function apply(payload) {   // a live change from Supabase
      const del = payload.eventType === 'DELETE', row = del ? payload.old : payload.new;
      if (!row) return;
      const route = apply.route;
      if (!route.cols.slice(0, -1).every((c, i) => row[c] === undefined || String(row[c]) === route.ids[i])) return;   // another parent
      const id = String(row.id);
      if (isDoc && id !== target.id) return;
      if (!del && row.data === undefined) { scheduleRefill(); return; }   // (a change too big to be sent: read it instead)
      const when = del ? tsNum(payload.commit_timestamp) : -Infinity;
      if (take(del ? { id, raw: null, deletedAt: when > -Infinity ? when : null } : { id, raw: row.data, updatedAt: row.updated_at || null, live: true })) emit(false);
    }
    // this page's own writes: on their way (results null), or the database's answers ({ path, data, updatedAt, gone })
    const unwatch = db._watch((paths, results) => {
      if (stopped || ![...paths].some(ours)) return;
      for (const r of results || []) {
        if (!ours(r.path)) continue;
        const id = r.path.slice(r.path.lastIndexOf('/') + 1);
        if (r.gone) take({ id, raw: null });
        else if (r.data != null) take({ id, raw: r.data, updatedAt: r.updatedAt });
      }
      if (emitted) emit(false);
    });
    load();
    db._routeFor(collPath).then(async route => {
      if (stopped) return;
      apply.route = route;
      // The subscription carries the sign-in's token, but supabase-js only sends the one it already has, and gives a
      // changed one only to subscriptions that have finished joining: one that joined before it fetched the token would
      // stay signed out and never get anything the read rules protect. So it fetches the current one first.
      await db._realtimeAuth();
      if (stopped) return;
      // the closest parent's column narrows what Supabase sends (a document with no parent: its own id)
      const n = route.ids.length;
      const filter = n ? `${route.cols[n - 1]}=eq.${route.ids[n - 1]}` : (isDoc ? `id=eq.${target.id}` : undefined);
      channel = db._channel('fdb-' + db._nextId())
        .on('postgres_changes', Object.assign({ event: '*', schema: 'public', table: route.tbl }, filter ? { filter } : {}), p => apply(p))
        .subscribe((status, err) => {
          if (stopped) return;
          if (status === 'SUBSCRIBED') { if (emitted) load(); }   // (if initial load is still in flight it covers live state; otherwise reload for reconnect/gap)
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('fdb: live updates for ' + collPath + ' stopped:', status, err && err.message);
        });
    }, report);
    return function unsubscribe() {
      stopped = true;
      unwatch();
      if (refill) clearTimeout(refill);
      if (channel) db._removeChannel(channel);
    };
  }

  createFdb.Timestamp = Timestamp;
  createFdb.FieldValue = FieldValue;
  createFdb.FieldPath = FieldPath;
  return createFdb;
});
