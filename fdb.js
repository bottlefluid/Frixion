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
  class DocumentSnapshot {
    constructor(ref, raw, updatedAt, meta) { this.ref = ref; this.id = ref.id; this._raw = raw; this._updatedAt = updatedAt || null; this.metadata = meta || META; }
    get exists() { return this._raw != null; }
    data() { return this._raw == null ? undefined : dec(this._raw, this.ref.firestore); }
    get(field) {
      if (this._raw == null) return undefined;
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

  // ---------- the database ----------
  function createFdb(sb, opts) {
    opts = opts || {};
    const storage = opts.storage !== undefined ? opts.storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    const cache = new Map();   // path -> { raw, updatedAt }: for get({ source: 'cache' })
    const KEEP = /^(accounts|users)\/[^/]+$/;   // (kept between visits too: logging in when the daily limit is out)
    let routesP = null, seq = 0;

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

    const db = {
      FieldValue, Timestamp, FieldPath,
      collection: p => new CollectionReference(db, p),
      doc: p => new DocumentReference(db, p),
      batch: () => new WriteBatch(db),
      settings() {},
      enablePersistence: () => Promise.resolve(),
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
      async _commit(writes) {
        const res = await rpc('fx_commit', { writes });
        (res || []).forEach(r => { if (r.data !== undefined) remember(r.path, r.data, r.updatedAt); });
        return res;
      },
      _listen(target, args) { return listen(db, target, args); },
      _routeFor: routeFor,
      _channel: name => sb.channel(name),
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
  function listen(db, target, args) {
    let next, error;
    if (args[0] && typeof args[0] === 'object' && typeof args[0].next !== 'function' && args.length > 1) args = args.slice(1);   // (options: nothing to do)
    if (args[0] && typeof args[0] === 'object' && typeof args[0].next === 'function') { next = args[0].next.bind(args[0]); error = args[0].error && args[0].error.bind(args[0]); }
    else { next = args[0]; error = args[1]; }
    const isDoc = target instanceof DocumentReference;
    const collPath = isDoc ? target.parent.path : target._path;
    const q = isDoc ? null : target._q;
    let channel = null, stopped = false, ready = false, pending = [], docs = new Map(), list = [], refill = null;
    let loadSeq = 0, appliedSeq = 0, emitted = false, lastDocKey = undefined;
    const report = e => { if (!stopped && error) error(e); else if (!stopped) console.warn('fdb listener:', e && e.message); };

    function emitDoc() {
      const s = docs.get(target.id);
      const key = s ? JSON.stringify(s._raw) : null;
      if (emitted && key === lastDocKey) return;   // (nothing new: no second call)
      emitted = true; lastDocKey = key;
      next(new DocumentSnapshot(target, s ? s._raw : null, s ? s._updatedAt : null));
    }
    function emitQuery(first) {
      let all = [...docs.values()].filter(s => matches(q, s.id, s._raw)).sort(sorter(q));
      if (q.limit != null) all = q.last ? all.slice(Math.max(0, all.length - q.limit)) : all.slice(0, q.limit);
      const before = new Map(list.map((s, i) => [s.id, { s, i }])), changes = [];
      all.forEach((s, i) => {
        const b = before.get(s.id);
        if (!b) changes.push({ type: 'added', doc: s, oldIndex: -1, newIndex: i });
        else if (b.s !== s) changes.push({ type: 'modified', doc: s, oldIndex: b.i, newIndex: i });
      });
      const now = new Set(all.map(s => s.id));
      list.forEach((s, i) => { if (!now.has(s.id)) changes.push({ type: 'removed', doc: s, oldIndex: i, newIndex: -1 }); });
      // a limited list that lost something may have room for one that wasn't loaded: read it again
      if (q.limit != null && !first && list.length >= q.limit && all.length < q.limit) scheduleRefill();
      list = all;
      for (const id of [...docs.keys()]) if (!now.has(id)) docs.delete(id);   // (only what's in the list is kept)
      if (!emitted || changes.length) { emitted = true; next(new QuerySnapshot(target, all, changes)); }
    }
    async function load() {
      const mine = ++loadSeq;
      ready = false;
      try {
        let fresh;
        if (isDoc) { const r = await db._get(target); fresh = new Map(r.exists ? [[target.id, r]] : []); }
        else {
          const rows = await db._rows(target);
          fresh = new Map(rows.map(r => [r.id, new DocumentSnapshot(new DocumentReference(db, collPath + '/' + r.id), r.data, r.updatedAt)]));
        }
        if (stopped || mine < appliedSeq) return;   // (an older read that finished after a newer one)
        appliedSeq = mine;
        if (!isDoc) for (const [id, s] of fresh) { const old = docs.get(id); if (old && JSON.stringify(old._raw) === JSON.stringify(s._raw)) fresh.set(id, old); }
        docs = fresh;
        if (isDoc) emitDoc(); else emitQuery(!emitted);
        if (mine === loadSeq) {
          ready = true;
          const p = pending; pending = [];
          p.forEach(apply);
        }
      } catch (e) { report(e); }
    }
    function scheduleRefill() {
      if (refill) return;
      refill = setTimeout(() => { refill = null; if (!stopped) load(); }, 50);
    }
    function apply(payload) {
      if (!ready) { pending.push(payload); return; }
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!row) return;
      const route = apply.route;
      if (!route.cols.slice(0, -1).every((c, i) => row[c] === undefined || String(row[c]) === route.ids[i])) return;   // another parent
      const id = String(row.id);
      if (isDoc && id !== target.id) return;
      if (payload.eventType === 'DELETE') docs.delete(id);
      else docs.set(id, new DocumentSnapshot(new DocumentReference(db, collPath + '/' + id), row.data, row.updated_at || null));
      if (isDoc) emitDoc(); else emitQuery(false);
    }
    load();
    db._routeFor(collPath).then(route => {
      if (stopped) return;
      apply.route = route;
      // the closest parent's column narrows what Supabase sends (a document with no parent: its own id)
      const n = route.ids.length;
      const filter = n ? `${route.cols[n - 1]}=eq.${route.ids[n - 1]}` : (isDoc ? `id=eq.${target.id}` : undefined);
      channel = db._channel('fdb-' + db._nextId())
        .on('postgres_changes', Object.assign({ event: '*', schema: 'public', table: route.tbl }, filter ? { filter } : {}), p => apply(p))
        .subscribe((status, err) => {
          if (stopped) return;
          if (status === 'SUBSCRIBED') load();   // (live from here on: read once more for anything in between)
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('fdb: live updates for ' + collPath + ' stopped:', status, err && err.message);
        });
    }, report);
    return function unsubscribe() {
      stopped = true;
      if (refill) clearTimeout(refill);
      if (channel) db._removeChannel(channel);
    };
  }

  createFdb.Timestamp = Timestamp;
  createFdb.FieldValue = FieldValue;
  createFdb.FieldPath = FieldPath;
  return createFdb;
});
