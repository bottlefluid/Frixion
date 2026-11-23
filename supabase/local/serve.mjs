// Frixion's whole local test setup on the Supabase branch, in one process, for trying the site with ?emulators:
//   http://127.0.0.1:8124   the site (this checkout's files, never cached)
//   http://127.0.0.1:54321  a stand-in for the Supabase project: PGlite (real Postgres, in memory) with Frixion's SQL
//                           (supabase/sql), answering supabase-js the way Supabase does: /rest/v1/rpc/<function>
//                           (PostgREST) and /realtime/v1/websocket (Realtime's Postgres Changes, Phoenix protocol)
//   http://127.0.0.1:8788   the server's routes (functions/api/admin, push and discord), on the stand-in too
//   http://127.0.0.1:8789   a fake Discord for the bridge (fake-discord.mjs)
// Sign-in and the Realtime Database stay on the Firebase emulators (Auth 9099, Realtime Database 9000): start those
// first, then this, then seed it (seed.mjs). Then open http://localhost:8124/?emulators and log in as Tester / pass1.
//
// Who is asking comes from each request's token, the way Supabase reads it: a Firebase token for liquidalt counts as
// signed in only with role: 'authenticated' on it (otherwise it's signed out, like the real thing), the secret key
// below is the server (service_role), and no token or the publishable key is signed out. The Auth emulator's tokens
// aren't signed, so they're only decoded: this is for this computer only and listens on 127.0.0.1 alone.
//
// Node 24 (it uses fetch and Request), and PGlite: set PGLITE to its package/dist/index.js as a file:// URL (see
// tests/harness.mjs). PORT_SITE, PORT_SUPABASE and PORT_API change the ports.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { makeDb, FIREBASE } from '../tests/harness.mjs';
import { startFakeDiscord, TOKEN as DISCORD_TOKEN } from './fake-discord.mjs';

export const SECRET = 'local-secret-key';             // the stand-in's "secret key" (the server)
export const PUBLISHABLE = 'local-publishable-key';   // and its "publishable key" (what script.js uses here)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT_SITE = +(process.env.PORT_SITE || 8124), PORT_SUPABASE = +(process.env.PORT_SUPABASE || 54321), PORT_API = +(process.env.PORT_API || 8788);
const PORT_DISCORD = +(process.env.PORT_DISCORD || 8789);
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

// ---------------- the database ----------------
// Every change to a public table is noted (fx_local.changes) by a trigger, the way Supabase Realtime reads the
// write-ahead log: changes made by the rules' own triggers are seen too, and ones that are rolled back never are.
const CAPTURE = `
create schema if not exists fx_local;
create table if not exists fx_local.changes (n bigserial primary key, tbl text not null, op text not null, rec jsonb, old jsonb);
create or replace function fx_local.capture() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into fx_local.changes (tbl, op, rec, old) values (tg_table_name, tg_op,
    case when tg_op <> 'DELETE' then to_jsonb(new) end, case when tg_op <> 'INSERT' then to_jsonb(old) end);
  return null;
end $$;
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('create trigger zz_local_capture after insert or update or delete on public.%I for each row execute function fx_local.capture()', t);
  end loop;
end $$;`;

let db = null, PK = {}, COLS = {};
async function start() {
  const t0 = Date.now();
  const fresh = await makeDb();
  await fresh.exec(CAPTURE);
  const pk = await fresh.query(`select c.relname as tbl, array_agg(a.attname::text order by array_position(i.indkey::int2[], a.attnum)) as cols
    from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey) where i.indisprimary and n.nspname = 'public' group by c.relname`);
  const cols = await fresh.query(`select table_name::text as tbl, json_agg(json_build_object('name', column_name, 'type', udt_name) order by ordinal_position) as cols
    from information_schema.columns where table_schema = 'public' group by table_name`);
  PK = Object.fromEntries(pk.rows.map(r => [r.tbl, r.cols]));
  COLS = Object.fromEntries(cols.rows.map(r => [r.tbl, r.cols]));
  if (db) await db.close().catch(() => {});
  db = fresh;
  log(`database ready: ${Object.keys(PK).length} tables, ${Date.now() - t0} ms`);
}

// PGlite is one connection, so each request runs on its own, in turn
let chain = Promise.resolve();
const locked = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

// Runs one statement as someone ({ role, claims }), in its own transaction like a PostgREST request.
async function runAs(who, sql, params = []) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${who.role}`);
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(who.claims)]);
    const r = await db.query(sql, params);
    await db.exec('commit');
    return { ok: true, rows: r.rows };
  } catch (e) {
    await db.exec('rollback').catch(() => {});
    return { ok: false, error: e };
  }
}
async function takeChanges() {
  // (rows as text, read with parseKeepBig: a number too big for JavaScript reaches the page as Postgres wrote it)
  const rows = (await db.query('with d as (delete from fx_local.changes returning *) select n, tbl, op, rec::text as rec, old::text as old from d order by n')).rows;
  return rows.map(r => ({ ...r, rec: r.rec == null ? null : parseKeepBig(r.rec), old: r.old == null ? null : parseKeepBig(r.old) }));
}

// ---------------- who is asking ----------------
class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const SIGNED_OUT = { role: 'anon', claims: { role: 'anon' } };
function whoFrom(token) {
  if (!token || token === PUBLISHABLE) return SIGNED_OUT;
  if (token === SECRET) return { role: 'service_role', claims: { role: 'service_role' } };
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'PGRST301', `Expected 3 parts in JWT; got ${parts.length}`);
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch (e) { throw new HttpError(401, 'PGRST301', 'JWT cannot be decoded'); }
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) throw new HttpError(401, 'PGRST303', 'JWT expired');
  if (claims.iss !== FIREBASE.iss || claims.aud !== FIREBASE.aud) throw new HttpError(401, 'PGRST301', 'No suitable key or wrong key type');
  return { role: claims.role === 'authenticated' ? 'authenticated' : 'anon', claims };
}
const bearer = req => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : (req.headers.apikey || null); };

// ---------------- PostgREST's part: /rest/v1/rpc/<function> ----------------
const RPCS = new Set(['fx_commit', 'fx_get', 'fx_query', 'fx_routes', 'fx_get_many']);
// Postgres errors as PostgREST sends them (its status for each SQLSTATE)
function statusFor(code, who) {
  if (code === '42501') return who.role === 'anon' ? 401 : 403;
  if (code === '23505' || code === '23503') return 409;
  if (code === 'P0001') return 400;
  if (/^(08|53)/.test(code)) return 503;
  if (/^(P0|XX|09|25|2D|38|39|3B|40|55|57|58|F0|HV)/.test(code) || code === '42P17') return 500;
  return 400;
}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Content-Profile, X-Total-Count' };
function reply(res, status, body, extra) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...(extra || {}) });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const readBody = req => new Promise((ok, no) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => ok(Buffer.concat(c).toString('utf8'))); req.on('error', no); });
// Numbers too big for JavaScript (1e309: infinite Orbs since v4.66) go to Postgres as they were written, and come back
// as Postgres writes them, the way PostgREST passes JSON through as text. (JSON.parse would make them Infinity, and
// JSON.stringify then null.) Needs Node's JSON.parse source text (Node 21 and later).
const BIG = '\u0000big:';
const parseKeepBig = t => JSON.parse(t, (k, v, ctx) => (typeof v === 'number' && !Number.isFinite(v) && ctx && ctx.source ? BIG + ctx.source : v));
const stringifyKeepBig = v => JSON.stringify(v).replace(/"\\u0000big:([-+0-9.eE]+)"/g, '$1');

const stats = { rpc: 0, refused: 0, changes: 0, sent: 0 };
async function supabaseHttp(req, res) {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*', 'Access-Control-Max-Age': '86400' });
    return res.end();
  }
  const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/);
  if (m && req.method === 'POST') {
    let who;
    try { who = whoFrom(bearer(req)); } catch (e) { return reply(res, e.status, { code: e.code, message: e.message, details: null, hint: null }); }
    if (!RPCS.has(m[1])) return reply(res, 404, { code: 'PGRST202', message: `Could not find the function public.${m[1]} in the schema cache`, details: null, hint: null });
    let args;
    try { const t = await readBody(req); args = t ? parseKeepBig(t) : {}; } catch (e) { return reply(res, 400, { code: 'PGRST102', message: 'Empty or invalid json', details: null, hint: null }); }
    const keys = Object.keys(args || {});
    if (keys.some(k => !/^[a-z_][a-z0-9_]*$/.test(k))) return reply(res, 400, { code: 'PGRST202', message: 'Unknown argument', details: null, hint: null });
    const sql = `select public.${m[1]}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})::text as r`;   // (as text: see BIG)
    const params = keys.map(k => (args[k] !== null && typeof args[k] === 'object' ? stringifyKeepBig(args[k]) : args[k]));
    stats.rpc++;
    const out = await locked(async () => { const r = await runAs(who, sql, params); return { r, changes: r.ok ? await takeChanges() : [] }; });
    if (!out.r.ok) {
      const e = out.r.error, code = e.code || 'XX000';
      stats.refused++;
      if (process.env.VERBOSE) log('refused', m[1], who.claims.sub || who.role, code, e.message);
      return reply(res, statusFor(code, who), { code, message: e.message, details: e.detail || null, hint: e.hint || null });
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS });
    res.end(out.r.rows[0].r == null ? 'null' : out.r.rows[0].r);   // (Postgres's own JSON text, as PostgREST sends it)
    if (out.changes.length) { stats.changes += out.changes.length; dispatch(out.changes).catch(e => log('realtime:', e.message)); }
    return;
  }
  // the stand-in's own tools, with the secret key: start over empty, look inside, counts
  if (url.pathname.startsWith('/local/')) {
    if (bearer(req) !== SECRET) return reply(res, 401, { message: 'secret key needed' });
    if (url.pathname === '/local/reset' && req.method === 'POST') { await locked(start); return reply(res, 200, { ok: true }); }
    if (url.pathname === '/local/sql' && req.method === 'POST') {
      const { sql, params } = JSON.parse(await readBody(req) || '{}');
      try { const r = await locked(() => db.query(sql, params || [])); return reply(res, 200, { rows: r.rows }); }
      catch (e) { return reply(res, 400, { error: e.message }); }
    }
    if (url.pathname === '/local/stats') return reply(res, 200, { ...stats, sockets: sockets.size, channels: [...sockets].reduce((n, c) => n + c.channels.size, 0) });
  }
  if (url.pathname === '/rest/v1/' || url.pathname === '/') return reply(res, 200, { stand_in: 'Frixion local Supabase' });
  reply(res, 404, { code: 'PGRST125', message: 'Invalid path specified in request URL', details: null, hint: null });
}

// ---------------- Realtime's part: /realtime/v1/websocket ----------------
// Just enough of the WebSocket protocol (RFC 6455: text frames, ping, close) and of Phoenix channels (join, leave,
// heartbeat, access_token) for supabase-js's Postgres Changes. As Supabase does it: inserts and updates go to each
// subscriber whose filter matches and whose read rules let them see the row (checked as them), deletes go to every
// subscriber whose filter matches the old row's key (no rules: the row is gone), with only the key in old_record.
const sockets = new Set();
let bindingSeq = 1000, presSeq = 1;
function presStateFor(topic) {
  const st = {};
  for (const c of sockets) {
    const ch = c.channels.get(topic);
    if (!ch || !ch.pres) continue;
    const { key, phx_ref, meta } = ch.pres;
    (st[key] || (st[key] = { metas: [] })).metas.push({ phx_ref, ...meta });
  }
  return st;
}
function presBroadcast(topic, joins, leaves) {
  for (const peer of [...sockets]) {
    const ch = peer.channels.get(topic);
    if (ch) push(peer, { join_ref: ch.joinRef, ref: null, topic, event: 'presence_diff', payload: { joins, leaves } });
  }
}
function leaveTopic(conn, topic) {
  const ch = conn.channels.get(topic);
  if (!ch) return;
  conn.channels.delete(topic);
  if (ch.pres) {
    const { key, phx_ref, meta } = ch.pres;
    ch.pres = null;
    presBroadcast(topic, {}, { [key]: { metas: [{ phx_ref, ...meta }] } });
  }
}
function dropConn(conn) {
  if (!sockets.delete(conn)) return;
  for (const topic of [...conn.channels.keys()]) leaveTopic(conn, topic);
}
function wsAccept(req, socket, head) {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/realtime/v1/websocket' || !key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const conn = { socket, vsn: url.searchParams.get('vsn') || '1.0.0', apikey: url.searchParams.get('apikey'), channels: new Map(), buf: Buffer.alloc(0), frags: [], fragOp: 1 };
  sockets.add(conn);
  const drop = () => dropConn(conn);
  socket.on('data', d => { try { wsData(conn, d); } catch (e) { log('websocket:', e.message); socket.destroy(); drop(); } });
  socket.on('close', drop);
  socket.on('error', drop);
  if (head && head.length) wsData(conn, head);
}
function wsData(conn, chunk) {
  conn.buf = Buffer.concat([conn.buf, chunk]);
  for (;;) {
    const b = conn.buf;
    if (b.length < 2) return;
    const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    const maskAt = off;
    if (masked) off += 4;
    if (b.length < off + len) return;
    let payload = Buffer.from(b.subarray(off, off + len));
    if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= b[maskAt + (i & 3)];
    conn.buf = b.subarray(off + len);
    if (op === 8) { wsFrame(conn, 8, Buffer.alloc(0)); conn.socket.end(); dropConn(conn); return; }
    if (op === 9) { wsFrame(conn, 10, payload); continue; }
    if (op === 10) continue;
    if (op === 1 || op === 2) conn.fragOp = op;
    conn.frags.push(payload);
    if (!fin) continue;
    const whole = Buffer.concat(conn.frags);
    conn.frags = [];
    if (conn.fragOp === 1) phoenix(conn, whole.toString('utf8'));
    else if (conn.fragOp === 2) phoenixBin(conn, whole);
  }
}
function relayBroadcast(conn, topic, payload) {
  const senderCh = conn.channels.get(topic);
  const allowSelf = !!(senderCh && senderCh.broadcastSelf);
  for (const peer of [...sockets]) {
    const peerCh = peer.channels.get(topic);
    if (!peerCh) continue;
    if (peer === conn && !allowSelf) continue;
    push(peer, { join_ref: peerCh.joinRef, ref: null, topic, event: 'broadcast', payload });
  }
}
// Phoenix v2 binary userBroadcastPush (used by @supabase/realtime-js v2.118+):
// [kind=3, joinRefLen, refLen, topicLen, eventLen, metaLen, encoding(1=json), ...fields, ...payload]
function phoenixBin(conn, buf) {
  if (!buf || buf.length < 7 || buf[0] !== 3) return;
  const jl = buf[1], rl = buf[2], tl = buf[3], el = buf[4], ml = buf[5], enc = buf[6];
  let o = 7;
  if (o + jl + rl + tl + el + ml > buf.length) return;
  const joinRef = buf.subarray(o, o += jl).toString('utf8');
  const ref = buf.subarray(o, o += rl).toString('utf8');
  const topic = buf.subarray(o, o += tl).toString('utf8');
  const event = buf.subarray(o, o += el).toString('utf8');
  o += ml;
  let body = null;
  if (enc === 1) {
    try { body = JSON.parse(buf.subarray(o).toString('utf8')); } catch (e) { return; }
  }
  relayBroadcast(conn, topic, { type: 'broadcast', event, payload: body });
  if (ref) push(conn, { join_ref: joinRef || null, ref, topic, event: 'phx_reply', payload: { status: 'ok', response: {} } });
}
function wsFrame(conn, op, payload) {
  const n = payload.length;
  let head;
  if (n < 126) head = Buffer.from([0x80 | op, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  if (!conn.socket.destroyed) conn.socket.write(Buffer.concat([head, payload]));
}
function push(conn, m) {   // Phoenix 2.0.0 sends [join_ref, ref, topic, event, payload]; 1.0.0 an object
  const text = conn.vsn === '2.0.0' ? stringifyKeepBig([m.join_ref ?? null, m.ref ?? null, m.topic, m.event, m.payload]) : stringifyKeepBig(m);
  wsFrame(conn, 1, Buffer.from(text, 'utf8'));
}
function phoenix(conn, text) {
  let m;
  try { const x = JSON.parse(text); m = Array.isArray(x) ? { join_ref: x[0], ref: x[1], topic: x[2], event: x[3], payload: x[4] } : x; } catch (e) { return; }
  const answer = (status, response) => push(conn, { join_ref: m.join_ref, ref: m.ref, topic: m.topic, event: 'phx_reply', payload: { status, response } });
  if (m.topic === 'phoenix' && m.event === 'heartbeat') return answer('ok', {});
  const p = m.payload || {};
  if (m.event === 'phx_join') {
    let who;
    try { who = whoFrom(p.access_token || null); } catch (e) { return answer('error', { reason: e.message }); }
    const cfg = p.config || {};
    const bindings = (cfg.postgres_changes || []).map(b => ({ id: ++bindingSeq, event: b.event, schema: b.schema, table: b.table, filter: b.filter }));
    const presKey = String((cfg.presence && cfg.presence.key) || ('p_' + (++presSeq)));
    const broadcastSelf = !!(cfg.broadcast && cfg.broadcast.self);
    if (conn.channels.has(m.topic)) leaveTopic(conn, m.topic);
    conn.channels.set(m.topic, { joinRef: m.join_ref, who, bindings, presKey, broadcastSelf, pres: null });
    answer('ok', { postgres_changes: bindings.map(b => Object.assign({ id: b.id, event: b.event, schema: b.schema, table: b.table }, b.filter !== undefined ? { filter: b.filter } : {})) });
    if (bindings.length) push(conn, { join_ref: m.join_ref, ref: null, topic: m.topic, event: 'system', payload: { channel: m.topic.replace(/^realtime:/, ''), extension: 'postgres_changes', message: 'Subscribed to PostgreSQL', status: 'ok' } });
    if (cfg.presence) push(conn, { join_ref: m.join_ref, ref: null, topic: m.topic, event: 'presence_state', payload: presStateFor(m.topic) });
    return;
  }
  if (m.event === 'access_token') {
    const ch = conn.channels.get(m.topic);
    if (ch) { try { ch.who = whoFrom(p.access_token || null); } catch (e) { ch.who = SIGNED_OUT; } }
    return answer('ok', {});
  }
  if (m.event === 'phx_leave') { leaveTopic(conn, m.topic); return answer('ok', {}); }
  if (m.event === 'broadcast') {
    relayBroadcast(conn, m.topic, p);
    if (m.ref != null) answer('ok', {});
    return;
  }
  if (m.event === 'presence') {
    const ch = conn.channels.get(m.topic);
    if (ch && p.event === 'track') {
      const leaves = {};
      if (ch.pres) leaves[ch.pres.key] = { metas: [{ phx_ref: ch.pres.phx_ref, ...ch.pres.meta }] };
      const phx_ref = 'r' + (++presSeq);
      const meta = (p.payload && typeof p.payload === 'object') ? p.payload : {};
      ch.pres = { key: ch.presKey, phx_ref, meta };
      presBroadcast(m.topic, { [ch.pres.key]: { metas: [{ phx_ref, ...meta }] } }, leaves);
    } else if (ch && p.event === 'untrack') {
      if (ch.pres) {
        const { key, phx_ref, meta } = ch.pres;
        ch.pres = null;
        presBroadcast(m.topic, {}, { [key]: { metas: [{ phx_ref, ...meta }] } });
      }
    }
    if (m.ref != null) answer('ok', {});
    return;
  }
  if (m.ref != null) answer('ok', {});
}
function filterOk(filter, row) {
  const m = /^([a-z_][a-z0-9_]*)=(eq|neq)\.(.*)$/.exec(filter || '');
  if (!m) return false;
  const v = row[m[1]] == null ? null : String(row[m[1]]);
  return m[2] === 'eq' ? v === m[3] : v !== m[3];
}
async function dispatch(changes) {
  for (const c of changes) {
    const pk = PK[c.tbl] || ['id'];
    const keyOf = row => Object.fromEntries(pk.map(k => [k, row[k]]));
    const isDelete = c.op === 'DELETE', row = isDelete ? keyOf(c.old) : c.rec;
    for (const conn of [...sockets]) {
      for (const [topic, ch] of [...conn.channels]) {
        const ids = ch.bindings.filter(b => b.schema === 'public' && b.table === c.tbl && (b.event === '*' || b.event === c.op) && (!b.filter || filterOk(b.filter, row))).map(b => b.id);
        if (!ids.length) continue;
        if (ch.who.claims.exp && ch.who.claims.exp * 1000 < Date.now()) { log(`realtime: ${topic}'s token has expired, nothing sent`); continue; }
        if (!isDelete) {
          const where = pk.map((k, i) => `"${k}" = $${i + 1}`).join(' and ');
          const seen = await locked(() => runAs(ch.who, `select 1 from public."${c.tbl}" where ${where}`, pk.map(k => c.rec[k])));
          if (!seen.ok || !seen.rows.length) continue;
        }
        stats.sent++;
        push(conn, { join_ref: ch.joinRef, ref: null, topic, event: 'postgres_changes', payload: { ids, data: {
          schema: 'public', table: c.tbl, commit_timestamp: new Date().toISOString(), type: c.op, columns: COLS[c.tbl] || [],
          record: isDelete ? {} : c.rec, old_record: c.old ? keyOf(c.old) : {}, errors: null } } });
      }
    }
  }
}

// ---------------- the site ----------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' };
function site(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT + path.sep) || /[\\/]\.(git|claude)([\\/]|$)/.test(file)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------------- the server's routes (functions/api: admin, push, discord) ----------------
// Each one's database requests go to the stand-in (SUPABASE_URL), the Owner tools' sign-in work to the Auth emulator,
// the Discord bridge to a fake Discord (fake-discord.mjs, port 8789), and push gets a key made for this run.
const SB = { SUPABASE_URL: `http://127.0.0.1:${PORT_SUPABASE}`, SUPABASE_SECRET_KEY: SECRET };
const ENVS = {
  admin: { ...SB, FIRESTORE_URL: 'http://127.0.0.1:8080/v1/projects/liquidalt/databases/(default)/documents', FIRESTORE_BEARER: 'owner',
    AUTH_URL: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/liquidalt', TEST_TOKENS: '1' },
  push: { ...SB },
  discord: { ...SB, DISCORD_BOT_TOKEN: DISCORD_TOKEN, DISCORD_API: `http://127.0.0.1:${PORT_DISCORD}/api/v10` },
};
async function api(fns, req, res) {
  const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : await readBody(req);
  const url = `http://127.0.0.1:${PORT_API}${req.url}`, u = new URL(url);
  const m = /^\/api\/(admin|push|discord|webhooks)(?:\/(.*))?$/.exec(u.pathname);
  if (!m) { res.writeHead(404, CORS); return res.end(); }
  const rest = m[2] || '';
  const r = await fns[m[1]].onRequest({ request: new Request(url, { method: req.method, headers: req.headers, body }), env: ENVS[m[1]], params: { path: rest ? rest.split('/') : [] } });
  const h = {};
  r.headers.forEach((v, k) => { h[k] = v; });
  res.writeHead(r.status, h);
  res.end(Buffer.from(await r.arrayBuffer()));
  log('api', req.method, u.pathname, r.status);
}

await start();
const fns = {};
// --admin-from=<folder>: the admin routes from another checkout (main's, to try its Supabase tab against the Firestore
// emulator: its routes still read Firestore there, and only its copy tool writes to this stand-in)
const ADMIN_FROM = (process.argv.find(a => a.startsWith('--admin-from=')) || '').slice('--admin-from='.length) || ROOT;
for (const name of ['admin', 'push', 'discord', 'webhooks']) fns[name] = await import(pathToFileURL(path.join(name === 'admin' ? ADMIN_FROM : ROOT, `functions/api/${name}/[[path]].js`)).href);
ENVS.webhooks = ENVS.admin;   // (functions/api/webhooks hands its requests to the admin routes, v4.69)
if (ADMIN_FROM !== ROOT) log('admin routes from ' + ADMIN_FROM);
// a push key for this run (the real one, VAPID_PRIVATE_KEY, is a Cloudflare secret)
const vapid = await crypto.webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
ENVS.push.VAPID_PRIVATE_KEY = JSON.stringify(await crypto.webcrypto.subtle.exportKey('jwk', vapid.privateKey));
startFakeDiscord(PORT_DISCORD);
const sbServer = http.createServer((req, res) => supabaseHttp(req, res).catch(e => { log('supabase:', e.message); if (!res.headersSent) reply(res, 500, { message: e.message }); }));
sbServer.on('upgrade', wsAccept);
sbServer.listen(PORT_SUPABASE, '127.0.0.1', () => log(`Supabase stand-in on http://127.0.0.1:${PORT_SUPABASE}`));
http.createServer((req, res) => api(fns, req, res).catch(e => { log('api:', e.message); if (!res.headersSent) { res.writeHead(500, CORS); res.end(); } }))
  .listen(PORT_API, '127.0.0.1', () => log(`server routes on http://127.0.0.1:${PORT_API}/api/{admin,push,discord}, fake Discord on ${PORT_DISCORD}`));
http.createServer(site).listen(PORT_SITE, '127.0.0.1', () => log(`site on http://localhost:${PORT_SITE}/?emulators`));
