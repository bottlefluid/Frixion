// A stand-in for a Supabase project on this PC: PGlite (real Postgres in Node) with Supabase's roles (anon,
// authenticated, service_role) and its auth.uid()/auth.jwt() functions, which read the request's JWT claims the same
// way Supabase does. Loads Frixion's SQL from the supabase branch in order, then the tests talk to it as a person.
// PGlite (@electric-sql/pglite 0.5.12, unpacked anywhere): set PGLITE to its package/dist/index.js as a file:// URL.
const { PGlite } = await import(process.env.PGLITE || 'file:///C:/Users/peter/AppData/Local/Temp/claude/5cb1245c0ba41c74/75275064-7605-4192-9d72-563121202775/scratchpad/pglite-dl/package/dist/index.js');
import fs from 'node:fs';
import crypto from 'node:crypto';

export const SQL_DIR = 'D:/Downloads/Frixion-supabase/supabase/sql';
const BOOT = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
`;

// a stable made-up sign-in id per test name, shaped like a Supabase user id
export const uidOf = name => {
  const h = crypto.createHash('sha1').update('frixion-test:' + name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export async function makeDb(files) {
  const db = new PGlite();
  await db.exec(BOOT);
  const list = files || fs.readdirSync(SQL_DIR).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  for (const f of list) {
    try { await db.exec(fs.readFileSync(`${SQL_DIR}/${f}`, 'utf8')); }
    catch (e) { throw new Error(`${f}: ${e.message}`); }
  }
  return db;
}

// Runs one statement as someone: null = signed out (anon), 'server' = the secret key (service_role), or a test name
// (signed in as uidOf(name)). Each call is its own transaction, so a refused one changes nothing.
export async function as(db, who, sql, params = []) {
  await db.exec('begin');
  try {
    if (who === 'server') await db.exec('set local role service_role');
    else if (who) {
      await db.exec('set local role authenticated');
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uidOf(who), role: 'authenticated' })]);
    } else await db.exec('set local role anon');
    const r = await db.query(sql, params);
    await db.exec('commit');
    return { ok: true, rows: r.rows, count: Math.max(r.rows.length, r.affectedRows || 0) };
  } catch (e) {
    await db.exec('rollback');
    return { ok: false, error: e.message };
  }
}

// The checks, worded like rules2.test.js. A write counts as refused if it errors or touches no row; a read is
// checked by what it returns.
let pass = 0, fail = 0;
export function section(t) { console.log('\n' + t); }
export function check(label, ok, info) {
  if (ok) { pass++; console.log('  ok    ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (info !== undefined ? '\n        ' + JSON.stringify(info).slice(0, 500) : '')); }
}
export const allow = async (label, p) => { const r = await p; check(label, r.ok && r.count > 0, r); return r; };
export const deny = async (label, p) => { const r = await p; check(label, !r.ok || r.count === 0, r); return r; };
export const sees = async (label, p, n) => { const r = await p; check(label, r.ok && r.rows.length === n, r); return r; };
export function summary() { console.log(`\n${pass} passed, ${fail} failed`); return fail; }
