// Tests for fdb.js (the site's Firestore-shaped adapter) on PGlite, through the real tables and rules: gets, writes,
// FieldValue transforms, Timestamps, queries, batches, transactions, live listeners and errors.
import { createRequire } from 'node:module';
import { makeDb, uidOf, section, check, summary } from './harness.mjs';
import { makeHub, fakeSupabase } from './fake-supabase.mjs';
const require = createRequire(import.meta.url);
const createFdb = require('../../fdb.js');
const { Timestamp, FieldValue, FieldPath } = createFdb;

const db = await makeDb();
for (const n of ['Alice', 'Bob']) {
  await db.query('insert into public.users (id, data) values ($1, $2)', [n, { username: n, authUid: uidOf(n), orbs: 100, friends: [] }]);
  await db.query('insert into public.accounts (id, data) values ($1, $2)', [uidOf(n), { username: n, at: 1 }]);
}
const hub = makeHub(db);
const alice = createFdb(fakeSupabase(db, 'Alice', hub), { storage: null });
const alice2 = createFdb(fakeSupabase(db, 'Alice', hub), { storage: null });   // (Alice on another device)
const bob = createFdb(fakeSupabase(db, 'Bob', hub), { storage: null });
const wait = ms => new Promise(r => setTimeout(r, ms));
// (takes a promise, or a function for calls that refuse on the spot, the way Firestore does with bad data)
const code = async p => { try { await (typeof p === 'function' ? p() : p); return 'ok'; } catch (e) { return e.code || e.message; } };
const meta = (who, id) => who.collection('users').doc('Alice').collection('meta').doc(id);   // (Alice's own, any shape allowed)

section('Documents');
let s = await meta(alice, 'nothing').get();
check('a missing document: exists false, data() undefined', s.exists === false && s.data() === undefined, s);
await meta(alice, 'a').set({ n: 1, m: { p: 1 }, list: [1], at: Timestamp.fromMillis(1700000000123), when: new Date(1700000000456) });
s = await meta(alice, 'a').get();
let d = s.data();
check('set, then get: the same data', s.exists && d.n === 1 && d.m.p === 1 && d.list[0] === 1, d);
check('...Timestamps and Dates come back as Timestamps', d.at instanceof Timestamp && d.at.toMillis() === 1700000000123 && d.when.toMillis() === 1700000000456, d);
check('...get(field) reads one field, with dots for maps', s.get('m.p') === 1 && s.get('nope') === undefined && s.id === 'a' && s.ref.path === 'users/Alice/meta/a');
await meta(alice, 'a').update({ 'm.q': 2, n: FieldValue.increment(4), list: FieldValue.arrayUnion(2, 3), at: FieldValue.serverTimestamp() });
d = (await meta(alice, 'a').get()).data();
check('update: dotted fields, increment, arrayUnion, serverTimestamp', d.m.p === 1 && d.m.q === 2 && d.n === 5 && d.list.join() === '1,2,3' && Math.abs(d.at.toMillis() - Date.now()) < 60000, d);
await meta(alice, 'a').update('list', FieldValue.arrayRemove(1), new FieldPath('auras', 'equinox:x.y'), 7, 'when', FieldValue.delete());
d = (await meta(alice, 'a').get()).data();
check('update with field, value pairs: arrayRemove, a FieldPath with a dot in a name, delete', d.list.join() === '2,3' && d.auras['equinox:x.y'] === 7 && !('when' in d), d);
await meta(alice, 'a').set({ m: { r: 3 }, extra: FieldValue.serverTimestamp() }, { merge: true });
d = (await meta(alice, 'a').get()).data();
check('set with merge keeps the rest and merges maps', d.n === 5 && d.m.p === 1 && d.m.r === 3 && d.extra instanceof Timestamp, d);
await meta(alice, 'a').set({ only: true });
check('set without merge replaces the document', JSON.stringify(Object.keys((await meta(alice, 'a').get()).data())) === '["only"]');
check('update on a missing document: not-found', (await code(meta(alice, 'ghost').update({ a: 1 }))) === 'not-found');
check('undefined in a write is refused on the spot, like Firestore', (await code(() => meta(alice, 'a').set({ a: undefined }))) === 'invalid-argument');
const added = await alice.collection('users').doc('Alice').collection('meta').add({ made: true });
check('add() makes a 20-character id and the document', added.id.length === 20 && (await added.get()).data().made === true, added.id);
await meta(alice, 'a').delete();
check('delete', (await meta(alice, 'a').get()).exists === false);

section('Permissions and errors');
check('Bob reading Alice\'s meta: permission-denied', (await code(meta(bob, 'x').get())) === 'permission-denied');
check('Bob writing it: permission-denied', (await code(meta(bob, 'x').set({ a: 1 }))) === 'permission-denied');
check('Bob reads Alice\'s profile (anyone signed in may)', (await bob.collection('users').doc('Alice').get()).data().username === 'Alice');
check('Alice can\'t give herself Orbs through the adapter either', (await code(alice.collection('users').doc('Alice').update({ orbs: FieldValue.increment(50) }))) === 'permission-denied');
check('...but can spend them', (await code(alice.collection('users').doc('Alice').update({ orbs: FieldValue.increment(-10) }))) === 'ok');

section('Saved copies (get from cache)');
check('get({source: cache}) before any read: unavailable', (await code(meta(alice, 'c1').get({ source: 'cache' }))) === 'unavailable');
await meta(alice, 'c1').set({ v: 1 });
await meta(alice, 'c1').get();
s = await meta(alice, 'c1').get({ source: 'cache' });
check('after a read: the saved copy, marked fromCache', s.exists && s.data().v === 1 && s.metadata.fromCache === true);

section('Queries');
const col = alice.collection('users').doc('Alice').collection('meta');
for (const [id, v] of [['q1', { n: 1, tags: ['x'] }], ['q2', { n: 5, tags: ['y'] }], ['q3', { n: 3, tags: ['x', 'y'] }], ['q4', { n: 9 }], ['q5', { other: true }], ['q6', { n: 'text' }]]) await col.doc(id).set(v);
let ids = q => q.get().then(r => r.docs.map(x => x.id).join(','));
check('where n > 2 (numbers only, like Firestore), orderBy n desc', (await ids(col.where('n', '>', 2).orderBy('n', 'desc'))) === 'q4,q2,q3');
check('...with limit 2', (await ids(col.where('n', '>', 2).orderBy('n', 'desc').limit(2))) === 'q4,q2');
check('orderBy n leaves out documents without n', (await ids(col.where('n', '<', 100).orderBy('n'))) === 'q1,q3,q2,q4');
check('limitToLast 2, in the query\'s own order', (await ids(col.where('n', '<', 100).orderBy('n').limitToLast(2))) === 'q2,q4');
check('array-contains', (await ids(col.where('tags', 'array-contains', 'x').orderBy('n'))) === 'q1,q3');
check('in', (await ids(col.where('n', 'in', [1, 9, 42]).orderBy('n'))) === 'q1,q4');
check('== on a string', (await ids(col.where('n', '==', 'text'))) === 'q6');
check('a FieldPath filter', (await ids(col.where(new FieldPath('n'), '>=', 5).orderBy('n'))) === 'q2,q4');
const snap = await col.where('n', '>', 2).get();
check('a query snapshot: size, empty, forEach, docChanges all added', snap.size === 3 && !snap.empty && snap.docChanges().every(c => c.type === 'added'));
check('Bob can\'t list Alice\'s meta (he sees nothing)', (await bob.collection('users').doc('Alice').collection('meta').get()).size === 0);

section('Batches');
let b = alice.batch();
b.set(col.doc('b1'), { v: 1 }); b.update(col.doc('q1'), { n: 2 }); b.delete(col.doc('q6'));
await b.commit();
check('a batch: set, update and delete together', (await col.doc('b1').get()).data().v === 1 && (await col.doc('q1').get()).data().n === 2 && !(await col.doc('q6').get()).exists);
b = alice.batch();
b.set(col.doc('b2'), { v: 2 }); b.set(bob.collection('users').doc('Bob').collection('meta').doc('x'), { evil: true });
check('a batch with one refused write fails...', (await code(b.commit())) === 'permission-denied');
check('...and nothing in it happened', !(await col.doc('b2').get()).exists);

section('Transactions');
await col.doc('counter').set({ n: 0 });
let tries = 0;
const out = await alice.runTransaction(async t => {
  tries++;
  const c = await t.get(col.doc('counter'));
  if (tries === 1) await alice2.collection('users').doc('Alice').collection('meta').doc('counter').update({ n: FieldValue.increment(10) });   // (someone else, in between)
  t.set(col.doc('counter'), { n: c.data().n + 1 });
  return c.data().n + 1;
});
check('a transaction that was overtaken starts over and uses the new value', tries === 2 && out === 11 && (await col.doc('counter').get()).data().n === 11, { tries, out });
await alice.runTransaction(async t => { const g = await t.get(col.doc('fresh')); if (!g.exists) t.set(col.doc('fresh'), { made: 1 }); });
check('a transaction can make a document it found missing', (await col.doc('fresh').get()).data().made === 1);
check('a transaction that only reads just returns', (await alice.runTransaction(async t => (await t.get(col.doc('fresh'))).data().made)) === 1);

section('Live listeners');
const seen = [];
const stop = col.where('n', '>', 0).orderBy('n').onSnapshot(sn => seen.push({ ids: sn.docs.map(x => x.id).join(','), ch: sn.docChanges().map(c => c.type + ':' + c.doc.id).join(',') }), e => seen.push({ err: e.code }));
await wait(80);
check('first snapshot: what matches, all added', seen.length >= 1 && seen[0].ids.split(',').length >= 3 && seen[0].ch.split(',').every(x => x.startsWith('added')), seen[0]);
const before = seen.length;
await alice2.collection('users').doc('Alice').collection('meta').doc('live1').set({ n: 4 });
await wait(30);
check('another device adds a matching document: one new snapshot, added:live1', seen.length === before + 1 && seen[seen.length - 1].ch === 'added:live1', seen.slice(before));
await alice2.collection('users').doc('Alice').collection('meta').doc('live1').update({ n: 6 });
await wait(30);
check('...changes it: modified:live1', seen[seen.length - 1].ch === 'modified:live1', seen[seen.length - 1]);
await alice2.collection('users').doc('Alice').collection('meta').doc('live1').delete();
await wait(30);
check('...deletes it: removed:live1', seen[seen.length - 1].ch === 'removed:live1', seen[seen.length - 1]);
await alice2.collection('users').doc('Alice').collection('meta').doc('nomatch').set({ other: 1 });
await wait(30);
check('a change that doesn\'t match the query: no new snapshot', seen[seen.length - 1].ch === 'removed:live1');
stop();
await alice2.collection('users').doc('Alice').collection('meta').doc('live2').set({ n: 7 });
await wait(30);
check('after unsubscribing: nothing more', seen[seen.length - 1].ch === 'removed:live1');
const profiles = [];
const stopP = bob.collection('users').doc('Alice').onSnapshot(sn => profiles.push(sn.data().bio || ''));
await wait(60);
await alice.collection('users').doc('Alice').update({ bio: 'hello' });
await wait(30);
check('a document listener (Bob watching Alice\'s profile) sees her new bio', profiles[profiles.length - 1] === 'hello', profiles);
stopP();
const sneaky = [];
const stopS = bob.collection('users').doc('Alice').collection('meta').onSnapshot(sn => sneaky.push(sn.size), () => sneaky.push('err'));
await wait(60);
await alice.collection('users').doc('Alice').collection('meta').doc('secret').set({ n: 1 });
await wait(30);
check('Bob listening to Alice\'s meta hears nothing about her new document', sneaky.every(x => x === 0), sneaky);
stopS();
const lim = [];
const stopL = col.orderBy('n').limit(2).onSnapshot(sn => lim.push(sn.docs.map(x => x.id).join(',')));
await wait(80);
const firstTwo = lim[lim.length - 1];
await alice2.collection('users').doc('Alice').collection('meta').doc(firstTwo.split(',')[0]).delete();
await wait(150);
check('a limited list that loses one fills back up from the database', lim[lim.length - 1].split(',').length === 2 && !lim[lim.length - 1].includes(firstTwo.split(',')[0]), { before: firstTwo, after: lim[lim.length - 1] });
stopL();

section('This page\'s own writes show at once');
// `me` is Alice on a page whose answers from the database can be held back (hold()), to look in between
const slowSb = fakeSupabase(db, 'Alice', hub), plainRpc = slowSb.rpc;
let held = null;
slowSb.rpc = async (name, a) => { const r = await plainRpc(name, a); if (name === 'fx_commit' && held) await held; return r; };
const hold = () => { let go; held = new Promise(r => (go = r)); return () => { held = null; go(); }; };
const me = createFdb(slowSb, { storage: null });
const mcol = me.collection('users').doc('Alice').collection('meta');
const theirs = id => alice2.collection('users').doc('Alice').collection('meta').doc(id);
const shots = [];
const stopM = mcol.where('k', '>', 0).orderBy('k').onSnapshot({ includeMetadataChanges: true }, sn => shots.push(sn), e => shots.push({ err: e.code }));
await wait(80);
const last = () => shots[shots.length - 1];
const docIn = id => last() && last().docs && last().docs.find(x => x.id === id);
const ofIds = () => last().docs.map(x => x.id).join(',');

// (first with the fake's usual order: the live change arrives before the answer)
let p = mcol.doc('race1').set({ k: 1 });
await null;   // (one turn: what a page sees right after the call)
check('a new document is in the list before the database answers, marked as still saving', docIn('race1') && docIn('race1').metadata.hasPendingWrites === true && last().metadata.hasPendingWrites === true && last().docChanges().some(c => c.type === 'added' && c.doc.id === 'race1'), ofIds());
await p;
check('...the live change coming before the answer: still once in the list, and saved', ofIds().split(',').filter(x => x === 'race1').length === 1 && docIn('race1').metadata.hasPendingWrites === false && shots.every(sn => !sn.docs || sn.docs.filter(x => x.id === 'race1').length <= 1));

hub.lag = 40;   // (from here on as on the real Supabase: the answer first, the live change after it)
let go = hold();
p = mcol.doc('fast1').set({ k: 2, at: FieldValue.serverTimestamp() });
await wait(5);
d = docIn('fast1');
check('with the answer held back: shown, still saving', d && d.metadata.hasPendingWrites === true, ofIds());
check('...a serverTimestamp reads null until the database gives it (as in Firestore), or this device\'s clock with estimate', d && d.data().at === null && d.get('at') === null && d.data({ serverTimestamps: 'estimate' }).at instanceof Timestamp && Math.abs(d.data({ serverTimestamps: 'estimate' }).at.toMillis() - Date.now()) < 5000 && d.data({ serverTimestamps: 'previous' }).at === null);
go(); await p;
d = docIn('fast1');
check('after the answer: no longer saving, and the time is the database\'s', d && d.metadata.hasPendingWrites === false && d.data().at instanceof Timestamp && last().metadata.hasPendingWrites === false);
let n = shots.length;
await wait(80);
check('the live change that comes after adds nothing', shots.length === n, shots.length - n);

const quiet = [];
const stopQ = mcol.where('k', '>=', 100).onSnapshot(sn => quiet.push(sn));
await wait(80);
n = quiet.length;
await mcol.doc('q100').set({ k: 100 });
await wait(80);
check('without includeMetadataChanges: one snapshot for your own write (the saving mark clearing raises none)', quiet.length === n + 1 && quiet[quiet.length - 1].docs.map(x => x.id).join() === 'q100', quiet.length - n);
stopQ();

const prof = [];
const stopPr = me.collection('users').doc('Alice').onSnapshot(sn => prof.push(sn.data()));
await wait(80);
const orbs0 = prof[prof.length - 1].orbs;
const bad = await code(me.collection('users').doc('Alice').update({ orbs: FieldValue.increment(50) }));
check('a refused write shows at once, then goes away again', bad === 'permission-denied' && prof.some(x => x.orbs === orbs0 + 50) && prof[prof.length - 1].orbs === orbs0, prof.map(x => x.orbs));
go = hold();
p = me.collection('users').doc('Alice').update({ bio: 'quick', orbs: FieldValue.increment(-1) });
await wait(5);
check('a document listener shows your own update at once', prof[prof.length - 1].bio === 'quick' && prof[prof.length - 1].orbs === orbs0 - 1);
go(); await p; await wait(80);
check('...and keeps it once saved', prof[prof.length - 1].bio === 'quick' && prof[prof.length - 1].orbs === orbs0 - 1);
stopPr();

await mcol.doc('cnt').set({ k: 5, n: 1, tags: ['a', 'z'] });
await wait(80);
go = hold();
p = mcol.doc('cnt').update({ n: FieldValue.increment(2), tags: FieldValue.arrayUnion('b', 'a'), 'm.x': 1 });
await wait(5);
d = docIn('cnt');
check('increment, arrayUnion and a dotted field are worked out here too', d && d.data().n === 3 && d.data().tags.join() === 'a,z,b' && d.data().m.x === 1 && d.metadata.hasPendingWrites);
go(); await p;
p = mcol.doc('cnt').update({ tags: FieldValue.arrayRemove('z'), m: FieldValue.delete() });
await null;   // (one turn: what a page sees right after the call)
d = docIn('cnt');
check('...arrayRemove and delete()', d && d.data().tags.join() === 'a,b' && !('m' in d.data()));
await p; await wait(80);
d = docIn('cnt');
check('...and the database agrees with all of it', d && d.data().n === 3 && d.data().tags.join() === 'a,b' && !('m' in d.data()) && !d.metadata.hasPendingWrites);
p = mcol.doc('cnt').set({ k: 5, extra: true }, { merge: true });
await null;   // (one turn: what a page sees right after the call)
check('set with merge keeps the other fields', docIn('cnt').data().n === 3 && docIn('cnt').data().extra === true);
await p;

go = hold();
p = mcol.doc('fast1').delete();
await wait(5);
check('a delete takes it out of the list at once', !docIn('fast1') && last().docChanges().some(c => c.type === 'removed' && c.doc.id === 'fast1'));
go(); await p; await wait(80);
check('...and it stays out', !docIn('fast1'));

go = hold();
const bt = me.batch();
bt.set(mcol.doc('bt1'), { k: 11 }); bt.set(mcol.doc('bt2'), { k: 12 });
p = bt.commit();
await wait(5);
check('a batch\'s documents show together at once', !!docIn('bt1') && !!docIn('bt2'));
go(); await p;

go = hold();
p = me.runTransaction(async t => { const g = await t.get(mcol.doc('tx1')); t.set(mcol.doc('tx1'), { k: 7, was: g.exists }); });
await wait(15);
check('a transaction\'s writes wait for the database\'s answer', !docIn('tx1'));
go(); await p;
check('...and show as soon as it comes (before the live change)', !!docIn('tx1') && docIn('tx1').data().was === false);

go = hold();
p = mcol.doc('cnt').update({ v: 'mine' });
await wait(10);
await theirs('cnt').update({ v: 'theirs' });
await wait(80);
check('while yours is on its way, it shows on top of a newer change from elsewhere', docIn('cnt').data().v === 'mine');
go(); await p; await wait(5);
check('an older answer arriving after a newer live change doesn\'t undo it', docIn('cnt').data().v === 'theirs', docIn('cnt').data().v);
await wait(80);
check('...nor does the late live change of your own write', docIn('cnt').data().v === 'theirs', docIn('cnt').data().v);

go = hold();
p = mcol.doc('cnt').update({ w: 1 });
await wait(10);
await theirs('cnt').delete();
await wait(80);
go(); await p; await wait(80);
check('a late answer doesn\'t bring back a document deleted since', !docIn('cnt'), ofIds());

const msgs = [];
const stopMsg = mcol.orderBy('sentAt').limitToLast(3).onSnapshot(sn => msgs.push(sn.docs.map(x => x.id).join(',')));
for (const i of [1, 2, 3]) { await mcol.doc('m' + i).set({ sentAt: FieldValue.serverTimestamp() }); await wait(3); }
await wait(80);
go = hold();
p = mcol.doc('m4').set({ sentAt: FieldValue.serverTimestamp() });
await wait(5);
check('a message sent into a "newest 3" list shows at the end at once', msgs[msgs.length - 1] === 'm2,m3,m4', msgs[msgs.length - 1]);
go(); await p; await wait(80);
check('...and is still there, in place, once saved', msgs[msgs.length - 1] === 'm2,m3,m4', msgs[msgs.length - 1]);
stopMsg();
stopM();
check('no listener errors', shots.every(x => !x.err), shots.filter(x => x.err));
hub.lag = null;

process.exit(summary() ? 1 : 0);
