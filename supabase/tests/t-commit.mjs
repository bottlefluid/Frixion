// Tests for supabase/sql/002_commit.sql: fx_commit's writes, transforms, preconditions, all-or-nothing batches,
// and checks that compare a batch's end with its start. Uses two test-only tables (t_docs and its subs).
import { makeDb, as, section, check, allow, deny, summary } from './harness.mjs';

const db = await makeDb();
await db.exec(`
create table public.t_docs (id text primary key, data jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.t_subs (parent_id text, id text, data jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (parent_id, id));
insert into fx.routes values ('tdocs/*', 't_docs', '{id}'), ('tdocs/*/subs/*', 't_subs', '{parent_id,id}');
alter table public.t_docs enable row level security;
alter table public.t_subs enable row level security;
create policy r on public.t_docs for select to authenticated using (not fx.is_true(data->'hidden'));
create policy i on public.t_docs for insert to authenticated with check (true);
create policy u on public.t_docs for update to authenticated using (true) with check (true);
create policy d on public.t_docs for delete to authenticated using (true);
create policy a on public.t_subs for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.t_docs, public.t_subs to authenticated;
grant all on public.t_docs, public.t_subs to service_role;
-- the test rules: a document with deny: true can't be written, one with locked: true can't be deleted
create function fx.t_docs_check() returns trigger language plpgsql as $$ begin
  if fx.trusted() then return coalesce(new, old); end if;
  if tg_op <> 'DELETE' and fx.is_true(new.data->'deny') then raise exception 'permission denied' using errcode = '42501'; end if;
  if tg_op = 'DELETE' and fx.is_true(old.data->'locked') then raise exception 'permission denied' using errcode = '42501'; end if;
  return coalesce(new, old); end $$;
create trigger chk before insert or update or delete on public.t_docs for each row execute function fx.t_docs_check();
create trigger stamp before insert or update on public.t_docs for each row execute function fx.stamp();
create trigger stamp before insert or update on public.t_subs for each row execute function fx.stamp();
-- a sub with paid: true needs tdocs/bank's coins to have gone down by 10 or more in the same batch, in any order
create function fx.t_paid() returns trigger language plpgsql as $$
declare b0 numeric; b1 numeric; begin
  if fx.trusted() or not fx.is_true(new.data->'paid') then return null; end if;
  b0 := fx.num(fx.before('tdocs/bank')->'coins');
  select fx.num(data->'coins') into b1 from public.t_docs where id = 'bank';
  if not fx.in_batch('tdocs/bank') or b0 is null or b1 is null or b1 > b0 - 10 then raise exception 'permission denied' using errcode = '42501'; end if;
  return null; end $$;
create constraint trigger paid after insert on public.t_subs deferrable initially deferred for each row execute function fx.t_paid();
`);
const commit = (who, writes) => as(db, who, 'select public.fx_commit($1) r', [JSON.stringify(writes)]);
const doc = async id => (await db.query('select data, updated_at::text u from public.t_docs where id = $1', [id])).rows[0];
const code = r => (r.error || '').slice(0, 80);

section('Writing');
let r = await allow('set makes a document', commit('Alice', [{ path: 'tdocs/a', set: { x: 1, m: { p: 1 }, y: 'gone soon', list: [1], objs: [{ a: 1 }] } }]));
check('...and returns its data and when it was written', r.rows[0].r[0].data.x === 1 && typeof r.rows[0].r[0].updatedAt === 'string', r.rows[0].r);
await allow('update with dotted paths goes inside maps, making them if needed', commit('Alice', [{ path: 'tdocs/a', update: { 'm.q': 2, 'n.o.p': 3 } }]));
let d = (await doc('a')).data;
check('...m is {p:1, q:2} and n.o.p is 3, x untouched', d.m.p === 1 && d.m.q === 2 && d.n.o.p === 3 && d.x === 1, d);
await allow('set with merge merges maps and keeps other fields', commit('Alice', [{ path: 'tdocs/a', set: { m: { r: 3 } }, merge: true }]));
d = (await doc('a')).data;
check('...m is {p, q, r}, x still 1', d.m.p === 1 && d.m.q === 2 && d.m.r === 3 && d.x === 1, d);
await allow('transforms: increment, a new counter, maximum, minimum, arrayUnion, arrayRemove, serverTime, delete', commit('Alice', [{ path: 'tdocs/a', update: { touched: true }, transforms: [
  { field: 'x', increment: 5 }, { field: 'stats.games', increment: 2 }, { field: 'best', maximum: 7 }, { field: 'x', minimum: 4 },
  { field: 'list', arrayUnion: [1, 2, 2] }, { field: 'objs', arrayUnion: [{ a: 1, b: 2 }, { a: 1 }] }, { field: 'list', arrayRemove: [1] },
  { field: 'at', serverTime: true }, { field: 'y', delete: true }] }]));
d = (await doc('a')).data;
check('...x 1+5 then min 4 = 4, stats.games 2, best 7', d.x === 4 && d.stats.games === 2 && d.best === 7, d);
check('...list [1] + [1,2,2] - [1] = [2]; objs keeps {a:1} once and adds {a:1,b:2}', JSON.stringify(d.list) === '[2]' && d.objs.length === 2, d);
check('...at is the server\'s time, y is gone', Math.abs(d.at.$t - Date.now()) < 60000 && !('y' in d), d);
await allow('set without merge replaces the whole document', commit('Alice', [{ path: 'tdocs/r', set: { a: 1, b: 2 } }, { path: 'tdocs/r', set: { c: 3 } }]));
check('...only c is left', JSON.stringify((await doc('r')).data) === '{"c":3}', await doc('r'));
r = await deny('update on a missing document', commit('Alice', [{ path: 'tdocs/none', update: { a: 1 } }]));
check('...says not found (P0002)', /no document/.test(code(r)), r);
r = await deny('create on one that exists', commit('Alice', [{ path: 'tdocs/a', create: { a: 1 } }]));
check('...says it already exists', /already exists/.test(code(r)), r);
await allow('create on a new one', commit('Alice', [{ path: 'tdocs/new1', create: { a: 1 } }]));
await allow('a document under another (tdocs/a/subs/s1)', commit('Alice', [{ path: 'tdocs/a/subs/s1', set: { k: 1 } }]));
check('...lands in t_subs with parent a', (await db.query("select count(*)::int n from public.t_subs where parent_id = 'a' and id = 's1'")).rows[0].n === 1);

section('Preconditions');
await deny('exists: false on a document that exists', commit('Alice', [{ path: 'tdocs/a', set: { z: 1 }, merge: true, exists: false }]));
await deny('exists: true on one that doesn\'t', commit('Alice', [{ path: 'tdocs/ghost', set: { z: 1 }, exists: true }]));
check('...and nothing was left behind', (await doc('ghost')) === undefined);
const u0 = (await doc('a')).u;
await allow('updatedAt that matches what was read', commit('Alice', [{ path: 'tdocs/a', update: { v: 1 }, updatedAt: u0 }]));
r = await deny('the same updatedAt again (someone wrote in between)', commit('Alice', [{ path: 'tdocs/a', update: { v: 2 }, updatedAt: u0 }]));
check('...says precondition failed', /precondition/.test(code(r)), r);

section('All or nothing');
await deny('a batch whose second write is refused', commit('Alice', [{ path: 'tdocs/b', set: { v: 1 } }, { path: 'tdocs/c', set: { deny: true } }]));
check('...left nothing: tdocs/b doesn\'t exist', (await doc('b')) === undefined);
await allow('(the server writes deny: true anyway, it skips the rules)', commit('server', [{ path: 'tdocs/srv', set: { deny: true } }]));
await db.query('insert into public.t_docs (id, data) values ($1, $2), ($3, $4)', ['lk', { locked: true }, 'hid', { hidden: true }]);
await deny('deleting a locked document', commit('Alice', [{ path: 'tdocs/lk', delete: true }]));
check('...it\'s still there', (await doc('lk')) !== undefined);
await allow('deleting another', commit('Alice', [{ path: 'tdocs/new1', delete: true }]));
check('...it\'s gone', (await doc('new1')) === undefined);
r = await commit('Alice', [{ path: 'tdocs/nothing-here', delete: true }]);
check('deleting a missing document is fine (like Firestore)', r.ok, r);
await deny('updating a document the person can\'t see', commit('Alice', [{ path: 'tdocs/hid', update: { a: 1 } }]));
await deny('moving a document to another id with a plain UPDATE', as(db, 'Alice', "update public.t_docs set id = 'moved' where id = 'a'"));
await deny('someone signed out using fx_commit', commit(null, [{ path: 'tdocs/x', set: { a: 1 } }]));

section('Bad writes');
for (const [label, w] of [['a collection path (odd length)', [{ path: 'tdocs', set: {} }]], ['an empty id', [{ path: 'tdocs//x', set: {} }]],
  ['a collection with no table', [{ path: 'nope/x', set: {} }]], ['no kind of write', [{ path: 'tdocs/q' }]], ['a document that isn\'t a map', [{ path: 'tdocs/q', set: [1] }]],
  ['an empty batch', []], ['501 writes', Array.from({ length: 501 }, (_, i) => ({ path: 'tdocs/m' + i, set: {} }))], ['increment by text', [{ path: 'tdocs/q', set: {}, transforms: [{ field: 'n', increment: '5' }] }]]])
  await deny(label, commit('Alice', w));

section('Comparing a batch\'s end with its start');
await db.query('insert into public.t_docs (id, data) values ($1, $2)', ['bank', { coins: 100 }]);
await allow('paid: the sub first, then 10 coins off (checked at the end, any order)', commit('Alice', [{ path: 'tdocs/a/subs/p1', set: { paid: true } }, { path: 'tdocs/bank', update: {}, transforms: [{ field: 'coins', increment: -10 }] }]));
await deny('a paid sub with only 5 coins off', commit('Alice', [{ path: 'tdocs/bank', update: {}, transforms: [{ field: 'coins', increment: -5 }] }, { path: 'tdocs/a/subs/p2', set: { paid: true } }]));
check('...the 5 coins came back too (bank still 90)', (await doc('bank')).data.coins === 90, await doc('bank'));
await deny('a paid sub on its own', commit('Alice', [{ path: 'tdocs/a/subs/p3', set: { paid: true } }]));
await deny('a paid sub with a plain INSERT, no batch', as(db, 'Alice', "insert into public.t_subs (parent_id, id, data) values ('a', 'p4', '{\"paid\": true}')"));

process.exit(summary() ? 1 : 0);
