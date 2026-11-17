// Builds supabase/setup-all.sql: everything in sql/ in order, in one file to paste into Supabase's SQL Editor, with a
// start that removes what an earlier run made (the fx schema, Frixion's tables and its public functions), so it can be
// run again after the SQL changes. That start deletes every row in those tables, so it is ONLY for before the data
// copy; after that, changes go out as their own migration files.
// It runs the SQL on PGlite to find what it makes (the tables and functions to remove first), then checks the whole
// file runs twice in a row on a fresh database. Run: node make-setup.mjs (from this folder; Node 24 and PGlite as in
// tests/harness.mjs).
import fs from 'node:fs';
import { makeDb, SQL_DIR } from './tests/harness.mjs';

const files = fs.readdirSync(SQL_DIR).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
const db = await makeDb(files);
const tables = (await db.query("select tablename::text t from pg_tables where schemaname = 'public' order by 1")).rows.map(r => r.t);
const funcs = (await db.query("select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1")).rows.map(r => r.f);
await db.close();

const head = `-- Frixion on Supabase: the whole database setup (supabase/sql/${files[0]} to ${files[files.length - 1]}, in order), made by
-- supabase/make-setup.mjs. Paste all of it into the SQL Editor and run it once.
--
-- It starts by removing what an earlier run made, so it can be run again when the SQL changes. That also deletes every
-- row in Frixion's tables: run it again ONLY before Frixion's data has been copied in.
drop schema if exists fx cascade;
${funcs.map(f => `drop function if exists public.${f} cascade;`).join('\n')}
drop table if exists ${tables.map(t => 'public.' + t).join(', ')} cascade;
`;
const body = files.map(f => `\n-- ======================== ${f} ========================\n` + fs.readFileSync(`${SQL_DIR}/${f}`, 'utf8').replace(/\r\n/g, '\n')).join('\n');
const out = head + body;
const target = new URL('./setup-all.sql', import.meta.url);
fs.writeFileSync(target, out);

// the check: a fresh database (with Supabase's roles), then the file twice
const check = await makeDb([]);   // (only the Supabase roles and auth functions)
await check.exec(out);
await check.exec(out);
const n = (await check.query("select count(*)::int n from pg_tables where schemaname = 'public'")).rows[0].n;
await check.close();
console.log(`setup-all.sql: ${files.length} files, ${(out.length / 1024).toFixed(0)} KB, ${tables.length} tables, ${funcs.length} public functions; ran twice on a fresh database (${n} tables after)`);
