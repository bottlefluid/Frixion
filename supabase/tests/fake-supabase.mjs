// A stand-in for supabase-js, for testing fdb.js on PGlite: rpc() runs the database function as the given person
// (with Firebase-style claims, like the real site), and a small hub plays the part of Supabase Realtime: after each
// fx_commit it sends every subscriber the rows that changed, but only rows that person's read policies let them see
// (deletes go to everyone whose filter matches, as in Supabase).
import { as } from './harness.mjs';

export function makeHub(db) {
  const subs = new Set();
  let routes = null;
  async function route(path) {
    routes = routes || (await db.query('select pattern, tbl, cols from fx.routes')).rows;
    const segs = path.split('/');
    const pattern = segs.map((s, i) => (i % 2 ? '*' : s)).join('/');
    const r = routes.find(x => x.pattern === pattern);
    return r && { tbl: r.tbl, cols: r.cols, ids: segs.filter((_, i) => i % 2) };
  }
  const hub = {
    sent: 0,
    channel(who, name) {
      const ch = {
        who, name, bindings: [],
        on(type, filter, cb) { ch.bindings.push({ filter, cb }); return ch; },
        subscribe(cb) { subs.add(ch); setTimeout(() => cb && cb('SUBSCRIBED'), 5); return ch; },
      };
      return ch;
    },
    remove(ch) { subs.delete(ch); },
    async afterCommit(writes) {
      for (const w of writes) {
        if (w.verify) continue;
        const r = await route(w.path);
        if (!r) continue;
        const where = r.cols.map((c, i) => `"${c}" = $${i + 1}`).join(' and ');
        const row = (await db.query(`select * from public."${r.tbl}" where ${where}`, r.ids)).rows[0];
        const keys = Object.fromEntries(r.cols.map((c, i) => [c, r.ids[i]]));
        for (const ch of [...subs]) for (const b of ch.bindings) {
          if (b.filter.table !== r.tbl) continue;
          if (b.filter.filter) { const [col, val] = b.filter.filter.split('=eq.'); if (String(keys[col]) !== val) continue; }
          if (!row) { hub.sent++; b.cb({ eventType: 'DELETE', old: keys, new: null, commit_timestamp: new Date().toISOString() }); continue; }
          const seen = await as(db, ch.who, `select data from public."${r.tbl}" where ${where}`, r.ids);
          if (!seen.ok || !seen.rows.length) continue;
          hub.sent++;
          b.cb({ eventType: 'UPDATE', new: { ...keys, data: row.data, updated_at: row.updated_at && row.updated_at.toISOString() }, old: keys, commit_timestamp: new Date().toISOString() });
        }
      }
    },
  };
  return hub;
}

export function fakeSupabase(db, who, hub) {
  return {
    async rpc(name, args) {
      const keys = Object.keys(args);
      const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) r`;
      const params = keys.map(k => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
      const r = await as(db, who, sql, params);
      if (!r.ok) return { data: null, error: { message: r.error, code: r.code }, status: 400 };
      // (live changes go out before the answer, unless hub.lag is set: then that many ms after it, as on the real
      // Supabase, where Realtime is the slower of the two)
      if (name === 'fx_commit' && hub) { if (hub.lag != null) setTimeout(() => hub.afterCommit(args.writes), hub.lag); else await hub.afterCommit(args.writes); }
      return { data: r.rows[0].r, error: null, status: 200 };
    },
    channel(name) { return hub.channel(who, name); },
    removeChannel(ch) { hub.remove(ch); },
  };
}
