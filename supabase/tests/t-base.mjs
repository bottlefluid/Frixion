// Tests for supabase/sql/001_base.sql: who is asking, ranks, bans, the list helpers, and the accounts table.
import { makeDb, as, uidOf, section, check, allow, deny, sees, summary } from './harness.mjs';

const db = await makeDb();
const user = (name, extra = {}) => db.query('insert into public.users (id, data) values ($1, $2)', [name, { username: name, authUid: uidOf(name), orbs: 50, ...extra }]);
const account = name => db.query('insert into public.accounts (id, data) values ($1, $2)', [uidOf(name), { username: name, at: 1 }]);
for (const [n, x] of [['Alice', {}], ['Bob', {}], ['Mod', { op: true }], ['Co', { coowner: true }], ['Owner1', { owner: true }],
  ['Banned', { banned: true, bannedUntil: null }], ['Muted', { mutedUntil: 8640000000000000 }], ['Expired', { banned: true, bannedUntil: Date.now() - 1000 }]]) await user(n, x);
for (const n of ['Mod', 'Co', 'Owner1', 'Banned', 'Muted', 'Expired']) await account(n);
const who = async name => (await as(db, name, 'select (fx.who()).*')).rows[0];

section('Who is asking');
let w = await who('Alice');
check('Alice before she has an account row: no name, not ok', w && w.name === null && w.ok === false, w);
w = await who(null);
check('signed out: no name, not ok', w && w.name === null && w.ok === false, w);

section('accounts');
await allow('Alice makes her own account row', as(db, 'Alice', 'insert into public.accounts (id, data) values ($1, $2)', [uidOf('Alice'), { username: 'Alice', at: 1 }]));
await deny('Alice makes one for someone else\'s sign-in', as(db, 'Alice', 'insert into public.accounts (id, data) values ($1, $2)', [uidOf('Bob'), { username: 'Bob', at: 1 }]));
await deny('Bob makes his naming Alice\'s profile', as(db, 'Bob', 'insert into public.accounts (id, data) values ($1, $2)', [uidOf('Bob'), { username: 'Alice', at: 1 }]));
await deny('Bob adds an extra field', as(db, 'Bob', 'insert into public.accounts (id, data) values ($1, $2)', [uidOf('Bob'), { username: 'Bob', at: 1, owner: true }]));
await deny('Bob names a profile that doesn\'t exist', as(db, 'Bob', 'insert into public.accounts (id, data) values ($1, $2)', [uidOf('Bob'), { username: 'Nobody', at: 1 }]));
await allow('Bob makes his own properly', as(db, 'Bob', 'insert into public.accounts (id, data) values ($1, $2)', [uidOf('Bob'), { username: 'Bob', at: 1 }]));
await deny('Bob makes a second one', as(db, 'Bob', 'insert into public.accounts (id, data) values ($1, $2)', [uidOf('Bob'), { username: 'Bob', at: 2 }]));
await sees('Alice reads the accounts table: only her own row', as(db, 'Alice', 'select id from public.accounts'), 1);
await sees('Mod (staff) reads all of them', as(db, 'Mod', 'select id from public.accounts'), 8);
await deny('Alice changes her account row', as(db, 'Alice', 'update public.accounts set data = $1 where id = $2', [{ username: 'Mod', at: 1 }, uidOf('Alice')]));
await deny('Alice deletes it', as(db, 'Alice', 'delete from public.accounts where id = $1', [uidOf('Alice')]));
await deny('someone signed out reads accounts', as(db, null, 'select id from public.accounts'));
await allow('the server (secret key) reads accounts', as(db, 'server', 'select id from public.accounts'));
await deny('Alice reads profiles directly before the profile rules exist', as(db, 'Alice', 'select id from public.users'));

section('Ranks and bans');
w = await who('Alice');
check('Alice: name Alice, ok, rank 0', w.name === 'Alice' && w.ok === true && w.rank === 0, w);
check('Mod is rank 1, Co 2, Owner1 3', (await who('Mod')).rank === 1 && (await who('Co')).rank === 2 && (await who('Owner1')).rank === 3);
await db.query("update public.users set data = data || '{\"authUid\": \"someone-else\"}' where id = 'Muted'");
w = await who('Muted');
check('a profile that names a different sign-in: not ok', w.name === 'Muted' && w.ok === false, w);
await db.query('update public.users set data = data || $1 where id = $2', [{ authUid: uidOf('Muted') }, 'Muted']);
const post = async n => (await as(db, n, 'select fx.can_post(fx.who()) v')).rows[0].v;
const active = async n => (await as(db, n, 'select fx.active(fx.who()) v')).rows[0].v;
check('Alice can post', await post('Alice') === true);
check('Banned can\'t post and isn\'t active', await post('Banned') === false && await active('Banned') === false);
check('Muted can\'t post but is active', await post('Muted') === false && await active('Muted') === true);
check('Expired (ban ran out) can post and is active', await post('Expired') === true && await active('Expired') === true);
check('staff checks: Mod staff, not owner level; Co owner level; only Owner1 is the Owner',
  (await as(db, 'Mod', 'select fx.is_staff(fx.who()) a, fx.is_owner_level(fx.who()) b')).rows[0].a === true
  && (await as(db, 'Mod', 'select fx.is_owner_level(fx.who()) b')).rows[0].b === false
  && (await as(db, 'Co', 'select fx.is_owner_level(fx.who()) b, fx.is_the_owner(fx.who()) c')).rows[0].b === true
  && (await as(db, 'Co', 'select fx.is_the_owner(fx.who()) c')).rows[0].c === false
  && (await as(db, 'Owner1', 'select fx.is_the_owner(fx.who()) c')).rows[0].c === true);

section('List helpers');
const q = async (sql, p) => (await db.query(sql, p)).rows[0].v;
check('only_added: [a] -> [a, b] added b', await q('select fx.only_added($1, $2, $3, $4) v', [{ f: ['a'] }, { f: ['b', 'a'] }, 'f', 'b']) === true);
check('only_added: [a] -> [b] is not just adding b', await q('select fx.only_added($1, $2, $3, $4) v', [{ f: ['a'] }, { f: ['b'] }, 'f', 'b']) === false);
check('only_taken_out: [a, b] -> [a] took out b', await q('select fx.only_taken_out($1, $2, $3, $4) v', [{ f: ['a', 'b'] }, { f: ['a'] }, 'f', 'b']) === true);
check('only_removed: [a, b] -> [b] ok, [a] -> [a, c] not', await q('select fx.only_removed($1, $2, $3) v', [{ f: ['a', 'b'] }, { f: ['b'] }, 'f']) === true
  && await q('select fx.only_removed($1, $2, $3) v', [{ f: ['a'] }, { f: ['a', 'c'] }, 'f']) === false);
check('changed: {a:1,b:2} -> {a:1,b:3,c:4} is [b, c]', JSON.stringify(await q('select fx.changed($1, $2) v', [{ a: 1, b: 2 }, { a: 1, b: 3, c: 4 }])) === '["b","c"]');

process.exit(summary() ? 1 : 0);
