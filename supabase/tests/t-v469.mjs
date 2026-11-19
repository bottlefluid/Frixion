// Tests for supabase/sql/015_v469.sql (v4.69): private and locked threads, the thread permissions, webhooks and events
// (request 50), and Grow a Garden trades, which only the server writes (request 65).
import { makeDb, as, uidOf, section, check, allow, deny, sees, summary } from './harness.mjs';

const db = await makeDb();
for (const name of ['Owner', 'Bob', 'Cat', 'Dan', 'Eve', 'Out']) {
  await db.query('insert into public.accounts (id, data) values ($1, $2)', [uidOf(name), { username: name }]);
  await db.query('insert into public.users (id, data) values ($1, $2)', [name, { username: name, authUid: uidOf(name), orbs: 100, ...(name === 'Owner' ? { owner: true } : {}) }]);
}
const EVERYONE = ['viewChannels', 'sendMessages', 'sendMessagesInThreads', 'createPublicThreads', 'createPrivateThreads', 'createEvents', 'readMessageHistory', 'addReactions'];
const server = (id, everyone) => ({ name: id, ownerId: 'Bob', members: ['Bob', 'Cat', 'Dan', 'Eve'], inviteCode: id + 'inv',
  roles: [{ id: 'everyone', name: '@everyone', permissions: everyone, position: 0, permsV2: true }, { id: 'r-mod', name: 'Mod', permissions: ['manageThreads', 'manageWebhooks', 'manageEvents'], position: 1 }],
  memberRoles: { Cat: ['r-mod'] }, createdAt: { $t: Date.now() } });
await db.query('insert into public.servers (id, data) values ($1, $2), ($3, $4)', ['s1', server('s1', EVERYONE), 's2', server('s2', ['viewChannels', 'sendMessages', 'sendMessagesInThreads'])]);
await db.query("insert into public.channels (server_id, id, data) values ('s1', 'c1', '{\"name\":\"general\"}'), ('s2', 'c1', '{\"name\":\"general\"}')");
const now = () => ({ $t: Date.now() });
const J = x => JSON.stringify(x);
const newThread = (who, sid, id, d) => as(db, who, 'insert into public.threads (server_id, id, data) values ($1, $2, $3)', [sid, id, J({ channelId: 'c1', name: id, createdBy: who, createdAt: now(), lastMessageAt: now(), messageCount: 0, ...d })]);
const setThread = (who, id, patch) => as(db, who, "update public.threads set data = data || $2::jsonb where server_id = 's1' and id = $1", [id, J(patch)]);
const seeThreads = who => as(db, who, "select id from public.threads where server_id = 's1' order by id");
let n = 0;
const post = (who, tid) => as(db, who, "insert into public.thread_messages (server_id, thread_id, id, data) values ('s1', $1, $2, $3)", [tid, 'm' + (++n), J({ uid: who, text: 'hi', createdAt: now() })]);
const readMsgs = (who, tid) => as(db, who, "select id from public.thread_messages where server_id = 's1' and thread_id = $1", [tid]);

section('50: private threads');
await allow('Eve starts a public thread', newThread('Eve', 's1', 't0', {}));
await allow('Dan starts a private thread with just himself in it', newThread('Dan', 's1', 't1', { private: true, members: ['Dan'] }));
await deny('...not with someone from outside the server in it', newThread('Dan', 's1', 'tx', { private: true, members: ['Dan', 'Out'] }));
await deny('...not without himself in it', newThread('Dan', 's1', 'ty', { private: true, members: ['Eve'] }));
await deny('...and not locked from the start', newThread('Dan', 's1', 'tz', { locked: true }));
await sees('Eve sees the public thread only', seeThreads('Eve'), 1);
await sees('Dan sees both', seeThreads('Dan'), 2);
await sees('Cat (Manage Threads) sees both', seeThreads('Cat'), 2);
await allow('Dan posts in his private thread', post('Dan', 't1'));
await deny('Eve can\'t post in it', post('Eve', 't1'));
await sees('...or read it', readMsgs('Eve', 't1'), 0);
await sees('Dan reads it', readMsgs('Dan', 't1'), 1);
await deny('Eve can\'t add herself', setThread('Eve', 't1', { members: ['Dan', 'Eve'] }));
await allow('Dan adds Eve', setThread('Dan', 't1', { members: ['Dan', 'Eve'] }));
await allow('...and now Eve posts there', post('Eve', 't1'));
await sees('...and reads it', readMsgs('Eve', 't1'), 2);
await allow('Eve (a member) adds Bob', setThread('Eve', 't1', { members: ['Bob', 'Dan', 'Eve'] }));
await deny('Eve can\'t take Dan out', setThread('Eve', 't1', { members: ['Bob', 'Eve'] }));
await deny('...or add someone from outside the server', setThread('Eve', 't1', { members: ['Bob', 'Dan', 'Eve', 'Out'] }));
// (leaving goes through fx_commit, as the app does: a raw UPDATE can't leave a row its writer can no longer read)
await allow('Eve leaves', as(db, 'Eve', 'select public.fx_commit($1::jsonb) as r', [J([{ path: 'servers/s1/threads/t1', update: { members: ['Bob', 'Dan'] } }])]));
await sees('...and can\'t see it any more', seeThreads('Eve'), 1);
await allow('Dan (who made it) renames it', setThread('Dan', 't1', { name: 'secret plans' }));
await deny('Dan can\'t lock it (that takes Manage Threads)', setThread('Dan', 't1', { locked: true }));
await deny('...or make it public', setThread('Dan', 't1', { private: false }));
await allow('Cat locks it', setThread('Cat', 't1', { locked: true }));
await deny('Dan can\'t post in a locked thread', post('Dan', 't1'));
await allow('...Cat can', post('Cat', 't1'));
await deny('Nobody changes who made it', setThread('Cat', 't1', { createdBy: 'Cat' }));
await deny('Eve can\'t write a typing note in it', as(db, 'Eve', "insert into public.thread_typing (server_id, thread_id, id, data) values ('s1', 't1', 'Eve', '{}')"));
await allow('Dan can', as(db, 'Dan', "insert into public.thread_typing (server_id, thread_id, id, data) values ('s1', 't1', 'Dan', '{}')"));
await allow('Anyone in the server bumps a public thread\'s count by one', setThread('Eve', 't0', { messageCount: 1, lastMessageAt: now() }));
await deny('Eve can\'t delete Dan\'s thread', as(db, 'Eve', "delete from public.threads where server_id = 's1' and id = 't1'"));
await allow('Cat (Manage Threads) can', as(db, 'Cat', "delete from public.threads where server_id = 's1' and id = 't1'"));
section('50: the thread permissions');
await deny('Without Create Public Threads, no public thread', newThread('Dan', 's2', 'u1', {}));
await deny('Without Create Private Threads, no private one', newThread('Dan', 's2', 'u2', { private: true, members: ['Dan'] }));
await allow('The server\'s owner can (Administrator)', newThread('Bob', 's2', 'u3', { private: true, members: ['Bob'] }));

section('50: webhooks');
const hook = (who, d) => as(db, who, "insert into public.server_webhooks (server_id, id, data) values ('s1', 'w1', $1) on conflict (server_id, id) do update set data = excluded.data", [J({ name: 'Bot', channelId: 'c1', tokenHash: 'a'.repeat(64), createdBy: who, createdAt: now(), ...d })]);
await deny('Dan (no Manage Webhooks) can\'t make one', hook('Dan', {}));
await deny('Cat: not with a token that isn\'t a SHA-256', hook('Cat', { tokenHash: 'nope' }));
await deny('...not for a channel that isn\'t there', hook('Cat', { channelId: 'gone' }));
await deny('...not with an avatar that isn\'t https', hook('Cat', { avatarUrl: 'javascript:alert(1)' }));
await deny('...not with other fields', hook('Cat', { token: 'x' }));
await allow('Cat (Manage Webhooks) makes one', hook('Cat', {}));
await sees('Dan can\'t see it', as(db, 'Dan', "select id from public.server_webhooks where server_id = 's1'"), 0);
await sees('Cat can', as(db, 'Cat', "select id from public.server_webhooks where server_id = 's1'"), 1);
await allow('Cat renames it and gives it a new token', as(db, 'Cat', "update public.server_webhooks set data = data || $1::jsonb where server_id = 's1' and id = 'w1'", [J({ name: 'Bot 2', tokenHash: 'b'.repeat(64) })]));
await deny('...but not who made it', as(db, 'Cat', "update public.server_webhooks set data = data || $1::jsonb where server_id = 's1' and id = 'w1'", [J({ createdBy: 'Bob' })]));
await deny('Dan can\'t delete it', as(db, 'Dan', "delete from public.server_webhooks where server_id = 's1' and id = 'w1'"));
await allow('Cat can', as(db, 'Cat', "delete from public.server_webhooks where server_id = 's1' and id = 'w1'"));

section('50: events');
const event = (who, id, d) => as(db, who, "insert into public.server_events (server_id, id, data) values ('s1', $1, $2)", [id, J({ name: 'Game night', startAt: Date.now() + 86400000, createdBy: who, createdAt: now(), interested: [who], ...d })]);
const setEvent = (who, id, patch) => as(db, who, "update public.server_events set data = data || $2::jsonb where server_id = 's1' and id = $1", [id, J(patch)]);
await allow('Dan (Create Events) makes an event', event('Dan', 'e1', { description: 'Bring snacks', place: 'Voice? No, here.', channelId: 'c1' }));
await deny('Out (not in the server) can\'t', event('Out', 'e2', {}));
await deny('...nor can an event end before it starts', event('Dan', 'e3', { endAt: Date.now() }));
await deny('...nor sign someone else up', event('Dan', 'e4', { interested: ['Dan', 'Eve'] }));
await sees('Everyone in the server sees it', as(db, 'Eve', "select id from public.server_events where server_id = 's1'"), 1);
await sees('Out doesn\'t', as(db, 'Out', "select id from public.server_events where server_id = 's1'"), 0);
await allow('Eve marks herself interested', setEvent('Eve', 'e1', { interested: ['Dan', 'Eve'] }));
await deny('...but can\'t take Dan off', setEvent('Eve', 'e1', { interested: ['Eve'] }));
await allow('...and can take herself off', setEvent('Eve', 'e1', { interested: ['Dan'] }));
await deny('Eve can\'t rename Dan\'s event', setEvent('Eve', 'e1', { name: 'Mine now' }));
await allow('Dan can', setEvent('Dan', 'e1', { name: 'Game night!' }));
await allow('...and so can Cat (Manage Events)', setEvent('Cat', 'e1', { name: 'Game night (moved)' }));
await deny('Eve can\'t cancel it', as(db, 'Eve', "delete from public.server_events where server_id = 's1' and id = 'e1'"));
await allow('Cat can', as(db, 'Cat', "delete from public.server_events where server_id = 's1' and id = 'e1'"));

section('65: Grow a Garden trades');
await deny('Nobody writes a trade from the page', as(db, 'Dan', "insert into public.garden_trades (id, data) values ('g1', $1)", [J({ from: 'Dan', to: 'Eve', status: 'open' })]));
await db.query("insert into public.garden_trades (id, data) values ('g1', $1)", [J({ from: 'Dan', to: 'Eve', status: 'open', give: { seeds: { carrot: 2 } }, want: {} })]);
await sees('Dan sees his trade', as(db, 'Dan', 'select id from public.garden_trades'), 1);
await sees('...and so does Eve', as(db, 'Eve', 'select id from public.garden_trades'), 1);
await sees('...but nobody else', as(db, 'Cat', 'select id from public.garden_trades'), 0);
await deny('Eve can\'t accept it herself', as(db, 'Eve', "update public.garden_trades set data = data || '{\"status\":\"accepted\"}'::jsonb where id = 'g1'"));
await allow('The server can', as(db, 'server', "update public.garden_trades set data = data || '{\"status\":\"accepted\"}'::jsonb where id = 'g1'"));

process.exit(summary() ? 1 : 0);
