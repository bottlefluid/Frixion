// Tests for supabase/sql/014_v467.sql (v4.67): the garden's stock chances are the Owner's and Co-Owners' (request 59),
// referral codes are the server's alone, and so are a profile's refCode, referredBy and referral (request 56).
import { makeDb, as, uidOf, section, check, allow, deny, summary } from './harness.mjs';

const db = await makeDb();
for (const [name, extra] of Object.entries({ Owner: { owner: true }, Co: { coowner: true }, Adm: { op: true }, Bob: {} })) {
  await db.query('insert into public.accounts (id, data) values ($1, $2)', [uidOf(name), { username: name }]);
  await db.query('insert into public.users (id, data) values ($1, $2)', [name, { username: name, authUid: uidOf(name), orbs: 100, ...extra }]);
}
const put = (who, id, data) => as(db, who, "insert into public.config (id, data) values ($1, $2) on conflict (id) do update set data = excluded.data", [id, JSON.stringify(data)]);
const set = (who, target, patch) => as(db, who, 'update public.users set data = data || $2::jsonb where id = $1', [target, JSON.stringify(patch)]);

section('59: config/gardenStock');
const chances = { seeds: { carrot: 50 }, sprinklers: {} };
await deny('Bob can\'t change the stock chances', put('Bob', 'gardenStock', chances));
await deny('...nor an Admin', put('Adm', 'gardenStock', chances));
await allow('a Co-Owner can', put('Co', 'gardenStock', chances));
await allow('...and the Owner', put('Owner', 'gardenStock', { seeds: {}, sprinklers: {} }));
await allow('an Admin still publishes other config, as before', put('Adm', 'someStaffThing', { a: 1 }));
await deny('...but not config/ranks (unchanged)', put('Adm', 'ranks', { list: [] }));
const read = await as(db, 'Bob', "select data from public.config where id = 'gardenStock'");
check('anyone signed in reads the stock chances (the garden needs them)', read.ok && read.rows.length === 1, read);

section('56: referral codes are the server\'s');
await allow('the server makes a code', as(db, 'server', "insert into public.referral_codes (id, data) values ('BOBCODE', '{\"u\":\"Bob\"}')"));
const look = await as(db, 'Bob', "select * from public.referral_codes");
check('Bob can\'t read the codes (not even his own)', !look.ok || look.rows.length === 0, look);
await deny('...nor make one himself', as(db, 'Bob', "insert into public.referral_codes (id, data) values ('MINE', '{\"u\":\"Bob\"}')"));
await deny('...nor change one', as(db, 'Bob', "update public.referral_codes set data = '{\"u\":\"Adm\"}' where id = 'BOBCODE'"));
await deny('...and neither can the Owner from a page', as(db, 'Owner', "update public.referral_codes set data = '{\"u\":\"Owner\"}' where id = 'BOBCODE'"));

section('56: refCode, referredBy and referral on profiles');
for (const [k, v] of [['refCode', 'BOBCODE'], ['referredBy', 'Owner'], ['referral', { friends: 9, earned: 99999 }]]) {
  await deny(`Bob can't set his own ${k}`, set('Bob', 'Bob', { [k]: v }));
  await deny(`...nor can the Owner set Bob's`, set('Owner', 'Bob', { [k]: v }));
  await allow(`the server can (${k})`, set('server', 'Bob', { [k]: v }));
  await deny(`Bob can't change or clear it`, as(db, 'Bob', 'update public.users set data = data - $2 where id = $1', ['Bob', k]));
}
await allow('Bob still edits the rest of his profile', set('Bob', 'Bob', { bio: 'hi' }));
await db.query('insert into public.accounts (id, data) values ($1, $2)', [uidOf('Newbie'), { username: 'Newbie' }]);
await db.query('delete from public.accounts where id = $1', [uidOf('Newbie')]);
await deny('a new account can\'t start already referred', as(db, 'Newbie', 'insert into public.users (id, data) values ($1, $2)',
  ['Newbie', JSON.stringify({ username: 'Newbie', authUid: uidOf('Newbie'), orbs: 50, referredBy: 'Bob' })]));
await allow('...but can be made without it', as(db, 'Newbie', 'insert into public.users (id, data) values ($1, $2)',
  ['Newbie', JSON.stringify({ username: 'Newbie', authUid: uidOf('Newbie'), orbs: 50 })]));

process.exit(summary() ? 1 : 0);
