// Tests for supabase/sql/013_v466.sql (v4.66): staff on the same rank (request 48), who may delete an account, the
// server-only securityNotice (52), and Shop items that are deleted leaving everyone's lists (53), plus the one-time
// cleanup of what deleted items already left behind and the report of Orbs the copy couldn't bring over (51).
import fs from 'node:fs';
import { makeDb, as, uidOf, section, check, allow, deny, summary, SQL_DIR } from './harness.mjs';

const db = await makeDb();
const people = {
  Owner: { owner: true }, Co1: { coowner: true }, Co2: { coowner: true }, Adm1: { op: true }, Adm2: { op: true },
  Bob: {}, Carol: {}, Dave: {},
};
for (const [name, extra] of Object.entries(people)) {
  await db.query('insert into public.accounts (id, data) values ($1, $2)', [uidOf(name), { username: name }]);
  await db.query('insert into public.users (id, data) values ($1, $2)', [name, { username: name, authUid: uidOf(name), orbs: 100, ...extra }]);
}
const set = (who, target, patch) => as(db, who, 'update public.users set data = data || $2::jsonb where id = $1', [target, JSON.stringify(patch)]);
const drop = (who, target, key) => as(db, who, 'update public.users set data = data - $2 where id = $1', [target, key]);
const del = (who, target) => as(db, who, 'delete from public.users where id = $1', [target]);
const data = async id => ((await db.query('select data from public.users where id = $1', [id])).rows[0] || {}).data;

section('48: Co-Owners on another Co-Owner');
await allow('Co1 gives Co2 Orbs', set('Co1', 'Co2', { orbs: 5000 }));
await allow('...a Shop item', set('Co1', 'Co2', { ownedThemes: ['aurora'] }));
await allow('...Premium', set('Co1', 'Co2', { premiumUntil: Date.now() + 86400000 }));
await allow('...a staff badge', set('Co1', 'Co2', { staffBadges: ['tester'] }));
await allow('...infinite Orbs', set('Co1', 'Co2', { infOrbs: true }));
await deny('...but can\'t ban Co2', set('Co1', 'Co2', { banned: true, banReason: 'x' }));
await deny('...time Co2 out', set('Co1', 'Co2', { mutedUntil: Date.now() + 60000 }));
await deny('...take away the Co-Owner rank', set('Co1', 'Co2', { coowner: false }));
await deny('...give a custom rank', set('Co1', 'Co2', { customRank: 'tester' }));
await deny('...send Co2 somewhere else', set('Co1', 'Co2', { redirectUrl: 'https://example.com', redirectNonce: 1 }));
await deny('...flag Co2\'s account for deletion', set('Co1', 'Co2', { terminated: { mode: 'real', at: 1 } }));
await deny('...or delete it', del('Co1', 'Co2'));
check('Co2 is still there, unbanned', (await data('Co2')).banned === undefined && (await data('Co2')).coowner === true);
await deny('Co1 still can\'t touch the Owner\'s Orbs', set('Co1', 'Owner', { orbs: 1 }));
await deny('...nor delete the Owner\'s account (allowed before v4.66)', del('Co1', 'Owner'));

section('48: Admins');
await allow('Adm1 gives Adm2 Orbs', set('Adm1', 'Adm2', { orbs: 777 }));
await allow('...and Premium', set('Adm1', 'Adm2', { premiumUntil: Date.now() + 86400000 }));
await deny('...but can\'t ban Adm2 any more (allowed before v4.66)', set('Adm1', 'Adm2', { banned: true }));
await deny('...nor time Adm2 out', set('Adm1', 'Adm2', { mutedUntil: Date.now() + 60000 }));
await deny('Admins still can\'t give Shop items, even to the same rank', set('Adm1', 'Adm2', { ownedThemes: ['aurora'] }));
await allow('Adm1 bans Bob (lower rank)', set('Adm1', 'Bob', { banned: true, banReason: 'test' }));
await allow('...and lifts it', set('Adm1', 'Bob', { banned: false }));
await allow('Co1 bans Adm1 (higher rank)', set('Co1', 'Adm1', { banned: true }));
await allow('...and lifts it', set('Co1', 'Adm1', { banned: false }));
await deny('Adm1 can\'t touch Co1 at all', set('Adm1', 'Co1', { orbs: 1 }));

section('Deleting accounts');
await allow('Co1 deletes Dave (lower rank)', del('Co1', 'Dave'));
await deny('Bob can\'t delete Carol', del('Bob', 'Carol'));
await allow('Co1 flags Bob\'s account for real deletion (lower rank)', set('Co1', 'Bob', { terminated: { mode: 'real', at: Date.now() } }));
await allow('...and Bob\'s own app deletes it', del('Bob', 'Bob'));
await db.query('insert into public.users (id, data) values ($1, $2) on conflict (id) do update set data = excluded.data', ['Bob', { username: 'Bob', authUid: uidOf('Bob'), orbs: 100 }]);
await allow('The Owner deletes Co2 (higher rank)', del('Owner', 'Co2'));

section('52: securityLog is the server\'s');
const notice = { securityLog: [{ by: 'Owner', at: Date.now(), kind: 'one-time password' }] };
await deny('Bob can\'t write his own', set('Bob', 'Bob', notice));
await deny('Co1 can\'t write Bob\'s', set('Co1', 'Bob', notice));
await allow('The server can', set('server', 'Bob', notice));
await deny('Co1 can\'t take it off Bob\'s', drop('Co1', 'Bob', 'securityLog'));
await deny('Bob can\'t clear it either (whoever used the password was signed in as Bob)', drop('Bob', 'Bob', 'securityLog'));
await deny('...nor empty it', set('Bob', 'Bob', { securityLog: [] }));
await allow('...but can still edit the rest of his profile', set('Bob', 'Bob', { bio: 'still me' }));
await db.query('insert into public.accounts (id, data) values ($1, $2)', [uidOf('Newbie'), { username: 'Newbie' }]);
await db.query('delete from public.accounts where id = $1', [uidOf('Newbie')]);
await deny('A new account can\'t start with one', as(db, 'Newbie', 'insert into public.users (id, data) values ($1, $2)',
  ['Newbie', JSON.stringify({ username: 'Newbie', authUid: uidOf('Newbie'), orbs: 50, ...notice })]));
await allow('...but can be made without it', as(db, 'Newbie', 'insert into public.users (id, data) values ($1, $2)',
  ['Newbie', JSON.stringify({ username: 'Newbie', authUid: uidOf('Newbie'), orbs: 50 })]));

section('53: a deleted Shop item leaves everyone\'s lists');
const T1 = 'AbCdEfGhIjKlMnOpQrSt', T2 = 'ZyXwVuTsRqPoNmLkJiHg';
for (const id of [T1, T2]) await db.query('insert into public.shop_themes (id, data) values ($1, $2)', [id, { name: id }]);
await set('server', 'Bob', { ownedThemes: ['aurora', T1, T2], equippedTheme: T1 });
await set('server', 'Carol', { ownedThemes: [T1], equippedTheme: 'aurora' });
await deny('Bob can\'t delete a Shop theme', as(db, 'Bob', 'delete from public.shop_themes where id = $1', [T2]));
await allow('Co1 deletes theme T1', as(db, 'Co1', 'delete from public.shop_themes where id = $1', [T1]));
let b = await data('Bob'), c = await data('Carol');
check('...it\'s gone from Bob\'s themes, the others stay', JSON.stringify(b.ownedThemes) === JSON.stringify(['aurora', T2]), b.ownedThemes);
check('...Bob no longer wears it', !('equippedTheme' in b), b.equippedTheme);
check('...gone from Carol\'s too; what she wears (a different theme) stays', JSON.stringify(c.ownedThemes) === '[]' && c.equippedTheme === 'aurora', c);
await db.query('insert into public.shop_decorations (id, data) values ($1, $2)', ['MaskMaskMaskMaskMask', { mask: true }]);
await set('server', 'Carol', { ownedDecorations: ['crown', 'MaskMaskMaskMaskMask'], equippedMask: 'MaskMaskMaskMaskMask', equippedDecoration: 'crown' });
await allow('Co1 deletes a mask', as(db, 'Co1', 'delete from public.shop_decorations where id = $1', ['MaskMaskMaskMaskMask']));
c = await data('Carol');
check('...off Carol\'s list and face; her built-in crown stays on', JSON.stringify(c.ownedDecorations) === '["crown"]' && !('equippedMask' in c) && c.equippedDecoration === 'crown', c);
await db.query('insert into public.config (id, data) values ($1, $2)', ['customMusic', { s1: { name: 'One' }, s2: { name: 'Two' } }]);
await set('server', 'Carol', { ownedMusic: ['s1', 's2', 'chill'], equippedMusic: 's1' });
await allow('Co1 removes song s1 from config/customMusic', as(db, 'Co1', "update public.config set data = data - 's1' where id = 'customMusic'"));
c = await data('Carol');
check('...it leaves Carol\'s songs and stops playing for her', JSON.stringify(c.ownedMusic) === '["s2","chill"]' && !('equippedMusic' in c), c);

section('53: what deleted items had already left behind (013 run again)');
const LEFT = 'LeftLeftLeftLeftLeft';
await set('server', 'Carol', { ownedThemes: ['aurora', LEFT, T2], equippedTheme: LEFT, ownedBanners: ['oldBanner'], equippedBanner: 'oldBanner',
  ownedProfileFrames: ['rainbow'], orbs: null });
const out = await db.exec(fs.readFileSync(`${SQL_DIR}/013_v466.sql`, 'utf8'));
c = await data('Carol');
check('the leftover id is cleared, the built-in and the existing theme stay', JSON.stringify(c.ownedThemes) === JSON.stringify(['aurora', T2]) && !('equippedTheme' in c), c);
check('a banner that no longer exists is cleared', JSON.stringify(c.ownedBanners) === '[]' && !('equippedBanner' in c), c);
check('built-in frames are left alone', JSON.stringify(c.ownedProfileFrames) === '["rainbow"]', c);
const report = out[out.length - 1].rows[0];
check('the last statement reports empty Orbs (51): 1, Carol', Number(report.accounts_with_empty_orbs) === 1 && report.usernames === 'Carol', report);
check('running it twice changes nothing else (Bob unchanged)', JSON.stringify((await data('Bob')).ownedThemes) === JSON.stringify(['aurora', T2]));

process.exit(summary() ? 1 : 0);
