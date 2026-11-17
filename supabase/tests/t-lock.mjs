// The switch-day lock (main's firestore.lock.rules), on the Firestore emulator (8080) loaded with it: no page can read or
// write anything, signed out, signed in, or as the Owner; the server (the emulator's "owner", like the service
// account) still reads, which is what the copy needs. Run after t-move.mjs (its data and sign-ins).
import { section, check, summary } from './harness.mjs';

const FS = 'http://127.0.0.1:8080/v1/projects/liquidalt/databases/(default)/documents';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = uid => { const now = Math.floor(Date.now() / 1000); return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: 'https://securetoken.google.com/liquidalt', aud: 'liquidalt', iat: now, exp: now + 3600, auth_time: now, sub: uid, user_id: uid, firebase: { sign_in_provider: 'password', identities: {} } })}.`; };
const accounts = await (await fetch(`${FS}:runQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'accounts' }] } }) })).json();
const uidOf = name => (accounts.find(a => a.document && a.document.fields.username.stringValue === name) || {}).document.name.split('/').pop();
const as = who => (who === 'server' ? { Authorization: 'Bearer owner' } : who ? { Authorization: 'Bearer ' + token(uidOf(who)) } : {});
const get = async (who, path) => (await fetch(`${FS}/${path}`, { headers: as(who) })).status;
const patch = async (who, path) => (await fetch(`${FS}/${path}?updateMask.fieldPaths=probe`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...as(who) }, body: JSON.stringify({ fields: { probe: { integerValue: '1' } } }) })).status;
const list = async (who, coll) => (await fetch(`${FS}/${coll}`, { headers: as(who) })).status;

section('The lock');
for (const [who, label] of [[null, 'signed out'], ['Sumi', 'Sumi (an ordinary account)'], ['Tester', 'Tester (the Owner)']]) {
  check(`${label} can't read a profile`, await get(who, 'users/Tester') === 403);
  check(`${label} can't change one`, await patch(who, 'users/Sumi') === 403);
  check(`${label} can't list messages`, await list(who, 'servers/s1/channels/c1/messages') === 403);
  check(`${label} can't read Gavinperri's library`, await get(who, 'site_gavinperri_doc/library') === 403);
}
check('the server still reads (for the copy)', await get('server', 'users/Tester') === 200);
process.exit(summary() ? 1 : 0);
