// Owner tools that need Google's admin powers, which no page has. A Cloudflare Pages Function, served at /api/admin/* on
// the main site (frixionbeta, which has the FIREBASE_SERVICE_ACCOUNT secret); Frixion calls it there.
//   POST /api/admin/one-time-password  { token, username }: the Owner (owner: true, from the caller's Firebase ID
//                                 token) makes a one-time password: a code, generated here, that logs that person in
//                                 once. Several can be waiting at once and they don't expire. Their own password never
//                                 changes, and nobody can see or set it (v4.55: the Owner's Set Password was removed).
//   POST /api/admin/redeem        { username, code }: logging in with one (nobody signed in yet): the code is used up
//                                 and a Firebase custom token for that account comes back (signInWithCustomToken).
//   GET  /api/admin/ip            whether the network address this comes from is banned (bannedIps/<its id>), checked
//                                 before anyone signs in; and its id, so the Owner can't ban their own.
//   POST /api/admin/seen          { token, device }: notes that this account (on this device) used this address
//                                 (ips/<id>), for the Owner panel's IP tab.
//                                 Addresses are never kept: only an id (an HMAC of the address, keyed from the service
//                                 account's own key, so it can't be turned back) and a shortened label like 73.12.x.x.
//   POST /api/admin/claims        { token, username? }: puts the account's username (n) and rank (r: 3 Owner, 2 Co-Owner,
//                                 1 Admin, 0 everyone) on its sign-in, from its profile, so the Realtime Database's
//                                 rules (database.rules.json: the games' shared lobby) know who is writing. Everyone
//                                 asks for their own when they sign in (ensureClaims() in script.js); the Owner and
//                                 Co-Owners also redo someone else's after changing their rank. Every sign-in also gets
//                                 role: 'authenticated', without which Supabase treats its requests as signed out
//                                 (supabaseToken() in script.js asks before the first one); a sign-in that isn't a
//                                 Frixion account yet (someone registering) gets only that.
//   GET  /api/admin/info          whether it's set up here (auth: "ready" once the service account may change sign-ins;
//                                 supabase: "ready" once SUPABASE_URL and SUPABASE_SECRET_KEY reach a set-up Supabase).
//   POST /api/admin/move          { token, action, group?, after?, size? }: the Owner copies Frixion's data from Firestore
//                                 into Supabase for the switch (the Owner panel's Supabase tab): 'plan' lists the kinds
//                                 of documents, 'count' counts one kind, 'copy' copies its next page. See "moving to
//                                 Supabase" at the end.
//
// The Orbs economy (v4.57). A page can't add Orbs, Premium time or Shop items to its own account any more
// (firestore.rules); they come from here, where the page can't change the numbers:
//   POST /api/admin/earn          { token, n }: Orbs a game paid out. Each account gets up to 20,000 a day from games
//                                 (the day is UTC), counted in orbDays/<username>; past that it adds nothing.
//   POST /api/admin/buy           { token, cat, id }: buys a Shop item. The price comes from the database: the item's own
//                                 document (or its entry in config/customMusic) for ones staff made, and
//                                 shopPrices/builtin for the ones built into script.js, which the Owner's and Co-Owners'
//                                 apps keep in step with it (syncShopPrices()).
//   POST /api/admin/code          { token, code }: redeems an Orbs or Premium code (redeemCodes/<code>).
//   POST /api/admin/egg           { token, egg, answer? }: an easter egg was found (v4.62). Each of the 50 pays its Orbs once
//                                 per account, on top of the 20,000 a day from games (the Owner's choice). What each one
//                                 pays is set here, not in the page. Eggs found by typing a secret (a code or a riddle's
//                                 answer) also send what was typed, and only the right answer pays (only its SHA-256 is
//                                 written anywhere). Found eggs are kept in eggs/<username> { found, at }, which only this
//                                 writes (firestore.rules); the 50th puts cracker: true on the profile (the Cracker tag).
//   POST /api/admin/casino        { token, game, action, ... }: the Casino (v4.63). Every result is picked here, and the
//                                 bet and the win change Orbs in the same commit. See "the Casino" at the bottom.
//
// SETUP, once: the service account the other functions use (frixion-functions) also needs the role "Firebase
// Authentication Admin": Google Cloud > IAM & Admin > IAM > the pencil next to frixion-functions > Add another role.
//
// For tests: FIRESTORE_URL with FIRESTORE_BEARER=owner (the Firestore emulator), AUTH_URL (the Auth emulator, which takes
// "owner" too) and TEST_TOKENS=1, which accepts the emulator's unsigned ID tokens. Never set TEST_TOKENS on a real site.
const PROJECT = 'liquidalt';
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
// (Supabase switch) With SUPABASE_URL and SUPABASE_SECRET_KEY set, every Firestore REST request in this file goes to
// Supabase instead and is answered in Firestore's shapes (functions/_lib/firestore-on-supabase.js), so the code below
// stays as it is. ENV is the site's settings, the same for every request.
import { firestoreFetch } from '../../_lib/firestore-on-supabase.js';
// the Casino's results (v4.67): the same file the Casino page checks bets with
import { DRAW, fairStream, hiloCard, sha256Hex as fairHash, hex as hexOf, stream, SLOT_SYMS } from '../../../casino-fair.js';
let ENV = null;
const fetch = (url, init) => firestoreFetch(ENV, url, init);
const IDENTITY = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });
class Fail extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new Fail(status, message); };

export async function onRequest({ request, env, params }) {
  ENV = env;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const route = [].concat(params.path || []).join('/');
  try {
    if (route === 'info' && request.method === 'GET') return json(await info(env));
    if (!env.FIREBASE_SERVICE_ACCOUNT && !env.FIRESTORE_BEARER) fail(503, 'Owner tools aren\'t set up on this site.');
    // (bodies come as text/plain, so other sites can call these without a preflight)
    if (route === 'one-time-password' && request.method === 'POST') return json(await oneTimePassword(env, await request.json().catch(() => ({}))));
    if (route === 'redeem' && request.method === 'POST') return json(await redeem(env, request, await request.json().catch(() => ({}))));
    if (route === 'ip' && request.method === 'GET') return json(await ipCheck(env, request));
    if (route === 'seen' && request.method === 'POST') return json(await ipSeen(env, request, await request.json().catch(() => ({}))));
    if (route === 'claims' && request.method === 'POST') return json(await setClaims(env, await request.json().catch(() => ({}))));
    if (route === 'earn' && request.method === 'POST') return json(await earn(env, await request.json().catch(() => ({}))));
    if (route === 'buy' && request.method === 'POST') return json(await buy(env, await request.json().catch(() => ({}))));
    if (route === 'buyall' && request.method === 'POST') return json(await buyAll(env, await request.json().catch(() => ({}))));
    if (route === 'banner' && request.method === 'POST') return json(await setBanner(env, await request.json().catch(() => ({}))));
    if (route === 'loan' && request.method === 'POST') return json(await loanRoute(env, await request.json().catch(() => ({}))));
    if (route === 'referral' && request.method === 'POST') return json(await referralRoute(env, await request.json().catch(() => ({}))));
    if (route === 'code' && request.method === 'POST') return json(await redeemCode(env, await request.json().catch(() => ({}))));
    if (route === 'egg' && request.method === 'POST') return json(await findEgg(env, await request.json().catch(() => ({}))));
    if (route === 'casino' && request.method === 'POST') return json(await casino(env, await request.json().catch(() => ({}))));
    if (route === 'move' && request.method === 'POST') return json(await move(env, await request.json().catch(() => ({}))));
    if (route === 'unlink' && request.method === 'POST') return json(await unlink(env, await request.json().catch(() => ({}))));
    if (route === 'gagtrade' && request.method === 'POST') return json(await gardenTrade(env, await request.json().catch(() => ({}))));
    if (route.startsWith('hook/')) return json(await webhookPost(env, request, route.split('/').slice(1)));   // (from functions/api/webhooks)
    return json({ error: 'Not found.' }, 404);
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong.' }, 500);
  }
}

async function info(env) {
  // (the Supabase switch: whether this site reaches Supabase with its secret key, which the Owner panel's Supabase tab
  // needs now, and every route after the switch)
  const supabase = !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY ? 'not set up here'
    : await supabaseRpc(env, 'fx_routes', {}).then(r => (Array.isArray(r) && r.length ? 'ready' : 'reachable, but its setup hasn\'t been run'),
      e => 'Supabase said: ' + String(e && e.message).slice(0, 160));
  if (!env.FIREBASE_SERVICE_ACCOUNT && !env.FIRESTORE_BEARER) return { ready: false, supabase };
  try {
    const r = await authCall(env, 'accounts:query', { returnUserInfo: false, limit: 1 });
    if (r.ok) return { ready: true, auth: 'ready', supabase };
    const why = await googleWhy(r);
    return { ready: true, auth: noRole(r, why) ? 'the service account needs the Firebase Authentication Admin role' : `Google said ${r.status}: ${why.slice(0, 200)}`, supabase };
  } catch (e) { return { ready: true, auth: e.message, supabase }; }
}
// What Google's answer says went wrong, and whether it's the missing role (Google answers that with 400
// INSUFFICIENT_PERMISSION, or a 403).
const googleWhy = async r => { const j = await r.json().catch(() => ({})); return String((j.error && j.error.message) || r.status); };
const noRole = (r, why) => r.status === 403 || /INSUFFICIENT_PERMISSION|PERMISSION_DENIED/.test(why);

// ---------------- signing in as Frixion (the service account) ----------------
const tokens = new Map();   // scope -> { value, until }
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = s => b64url(new TextEncoder().encode(s));
const unb64url = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - String(s).length % 4) % 4)), c => c.charCodeAt(0));
// the service account's private key, ready to sign with
let saKeyP = null;
function saKey(sa) {
  if (!saKeyP) {
    const der = Uint8Array.from(atob(String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
    saKeyP = crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  }
  return saKeyP;
}
async function googleToken(env) {
  if (env.FIRESTORE_BEARER) return env.FIRESTORE_BEARER;
  const scope = 'https://www.googleapis.com/auth/cloud-platform', hit = tokens.get(scope);
  if (hit && hit.until > Date.now() + 60000) return hit.value;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT), now = Math.floor(Date.now() / 1000);
  const head = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
  const claims = b64urlText(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await saKey(sa), new TextEncoder().encode(head + '.' + claims)));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claims + '.' + b64url(sig) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Google refused the service account (' + (j.error_description || j.error || r.status) + ')');
  tokens.set(scope, { value: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}
const fsBase = env => env.FIRESTORE_URL || FIRESTORE;
const authBase = env => env.AUTH_URL || IDENTITY;
const dec = v => ('stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? Number(v.doubleValue) : 'booleanValue' in v ? v.booleanValue
  : 'timestampValue' in v ? Date.parse(v.timestampValue) : 'mapValue' in v ? decFields(v.mapValue.fields) : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec) : 'nullValue' in v ? null : undefined);
const decFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, dec(v)]));
async function fsGet(env, path) {
  const r = await fetch(`${fsBase(env)}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: { Authorization: 'Bearer ' + await googleToken(env) } });
  if (r.status === 404) return null;
  if (r.status === 429) fail(503, 'Frixion reached its database limit for today. Try again later.');
  if (!r.ok) fail(502, 'Could not read Frixion.');
  return decFields((await r.json()).fields);
}
const enc = v => (v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: Number.isFinite(v) ? v : String(v) }) : { stringValue: String(v) });
// Infinite Orbs: the Owner's and Co-Owners' Inf (infOrbs, v4.64), or a balance that grew past what a number can hold
// (it shows as the infinity sign). Both count as infinite: nothing is taken and nothing is added (v4.66, request 51).
function infinite(u) { return !!u && (u.infOrbs === true || Number(u.orbs) === Infinity); }
const docUrl = (env, path) => `${fsBase(env)}/${path.split('/').map(encodeURIComponent).join('/')}`;
// a document's full name, as commits want it (projects/<id>/databases/(default)/documents/<path>)
const docName = (env, path) => new URL(fsBase(env)).pathname.replace(/^\/v1\//, '') + '/' + path;
// these fields only (made if the document isn't there)
async function fsPatch(env, path, data) {
  const mask = Object.keys(data).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const r = await fetch(`${docUrl(env, path)}?${mask}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await googleToken(env) },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }) });
  if (!r.ok) fail(502, 'Could not save that.');
}
async function authCall(env, method, body) {
  return fetch(`${authBase(env)}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await googleToken(env) }, body: JSON.stringify(body) });
}

// ---------------- who is asking ----------------
// A Firebase ID token, checked the way Google says: signed by Google's key for it (fetched and kept for an hour), for this
// project, not expired. The emulator's tokens aren't signed, so tests (TEST_TOKENS) skip only the signature.
let googleKeys = null;   // { at, keys: Map(kid -> CryptoKey) }
async function keysFor(kid) {
  if (!googleKeys || Date.now() - googleKeys.at > 3600000 || !googleKeys.keys.has(kid)) {
    const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    const j = await r.json().catch(() => ({}));
    const keys = new Map();
    for (const k of j.keys || []) keys.set(k.kid, await crypto.subtle.importKey('jwk', { kty: k.kty, n: k.n, e: k.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
    googleKeys = { at: Date.now(), keys };
  }
  return googleKeys.keys.get(kid);
}
async function verifyIdToken(env, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) fail(401, 'Sign in again, then try once more.');
  let head, claims;
  try { head = JSON.parse(new TextDecoder().decode(unb64url(parts[0]))); claims = JSON.parse(new TextDecoder().decode(unb64url(parts[1]))); }
  catch (e) { fail(401, 'Sign in again, then try once more.'); }
  if (!(env.TEST_TOKENS && head.alg === 'none')) {
    const key = head.alg === 'RS256' && await keysFor(head.kid);
    const ok = key && await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) fail(401, 'Sign in again, then try once more.');
  }
  const now = Date.now() / 1000;
  if (claims.aud !== PROJECT || claims.iss !== 'https://securetoken.google.com/' + PROJECT || !(claims.exp > now) || !(claims.iat <= now + 300) || !claims.sub) fail(401, 'Sign in again, then try once more.');
  return claims;
}
// The Owner: the sign-in's accounts/ entry names a profile with owner: true that names the sign-in back.
async function requireOwner(env, token) {
  const claims = await verifyIdToken(env, token);
  const acct = await fsGet(env, `accounts/${claims.sub}`);
  const me = acct && typeof acct.username === 'string' ? await fsGet(env, `users/${acct.username}`) : null;
  if (!me || me.authUid !== claims.sub || me.owner !== true) fail(403, 'Only the Owner can do that.');
  return acct.username;
}

// ---------------- password help ----------------
const USERNAME = /^[A-Za-z0-9_]{1,40}$/;
// 10 characters from letters and digits that can't be mixed up (no I, O, 0 or 1)
const OTP_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeOtp = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => OTP_CHARS[b % OTP_CHARS.length]).join('');
// The code is kept only as its SHA-256 (loginCodes/c_<hash>, with whose it is), so nobody reading the database can use
// it. Any number can be waiting at once, for anyone, and they don't run out on their own.
const CODE_RE = /^[A-HJ-NP-Z2-9]{10}$/;
const sha256Hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
async function oneTimePassword(env, { token, username }) {
  const me = await requireOwner(env, token);
  if (typeof username !== 'string' || !USERNAME.test(username)) fail(400, 'That isn\'t a username.');
  const target = await fsGet(env, `users/${username}`);
  if (!target) fail(404, 'No account has that username.');
  if (typeof target.authUid !== 'string' || !target.authUid) fail(409, 'That account has no sign-in yet.');
  const password = makeOtp();
  await fsPatch(env, `loginCodes/c_${await sha256Hex(password)}`, { username, by: me, at: new Date() });
  return { ok: true, password };
}
// Logging in with one (typed in the password box: redeemLoginCode() in script.js): the code is used up, and the page
// gets a sign-in for that account (a Firebase custom token), whose own password doesn't change. A few tries a minute
// per address, so nobody can guess codes (there are about a million billion of them anyway).
const tries = new Map();   // address -> { at, n }
async function redeem(env, request, { username, code }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local', t = tries.get(ip);
  if (t && Date.now() - t.at < 60000 && t.n >= 10) fail(429, 'Too many tries. Wait a minute.');
  tries.set(ip, t && Date.now() - t.at < 60000 ? { at: t.at, n: t.n + 1 } : { at: Date.now(), n: 1 });
  if (tries.size > 5000) tries.clear();
  if (typeof username !== 'string' || !USERNAME.test(username) || typeof code !== 'string' || !CODE_RE.test(code)) fail(403, 'That one-time password doesn\'t work.');
  const path = `loginCodes/c_${await sha256Hex(code)}`;
  const c = await fsGet(env, path);
  if (!c || c.username !== username) fail(403, 'That one-time password doesn\'t work.');
  // used up: deleted only if it's still there, so two tries at once can't both get in
  const r = await fetch(`${fsBase(env)}:commit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await googleToken(env) },
    body: JSON.stringify({ writes: [{ delete: docName(env, path), currentDocument: { exists: true } }] }) });
  if (!r.ok) fail(403, 'That one-time password doesn\'t work.');
  const target = await fsGet(env, `users/${username}`);
  if (!target || typeof target.authUid !== 'string' || !target.authUid) fail(409, 'That account has no sign-in yet.');
  // The account keeps a log of these (v4.66, request 52: staff signing in to someone's account must never go unseen):
  // who made the password and when it was used, the last 10. Only the server writes securityLog
  // (supabase/sql/013_v466.sql), so whoever is signed in as the account can't hide it from its owner. A failure here
  // doesn't stop the sign-in.
  const entry = { kind: 'one-time password', by: typeof c.by === 'string' ? c.by : '', made: Number(c.at) || null, at: Date.now() };
  const log = [...(Array.isArray(target.securityLog) ? target.securityLog.filter(x => x && typeof x === 'object') : []), entry].slice(-10);
  await fetch(`${fsBase(env)}:commit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await googleToken(env) },
    body: JSON.stringify({ writes: [{ update: { name: docName(env, `users/${username}`), fields: { securityLog: encAny(log) } }, updateMask: { fieldPaths: ['securityLog'] }, currentDocument: { exists: true } }] }) }).catch(() => {});
  return { token: await customToken(env, target.authUid) };
}
// A Firebase custom token: signed with the service account's key, it lets a page sign in as that account once.
// (The Auth emulator takes unsigned ones, for tests.)
const CUSTOM_AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
async function customToken(env, uid) {
  const now = Math.floor(Date.now() / 1000);
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    if (!env.TEST_TOKENS) fail(503, 'Owner tools aren\'t set up on this site.');
    return b64urlText(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + b64urlText(JSON.stringify({ iss: 'test@liquidalt.iam.gserviceaccount.com', sub: 'test@liquidalt.iam.gserviceaccount.com', aud: CUSTOM_AUD, iat: now, exp: now + 3600, uid })) + '.';
  }
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const head = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
  const body = b64urlText(JSON.stringify({ iss: sa.client_email, sub: sa.client_email, aud: CUSTOM_AUD, iat: now, exp: now + 3600, uid }));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await saKey(sa), new TextEncoder().encode(head + '.' + body)));
  return head + '.' + body + '.' + b64url(sig);
}

// ---------------- network addresses (IP bans) ----------------
// The address a request comes from (Cloudflare says), never kept as is: its id is an HMAC keyed from the service
// account's private key (or IP_KEY), so the ids can't be turned back into addresses; the label keeps only the start.
function callerIp(env, request) {
  const ip = request.headers.get('CF-Connecting-IP') || (env.TEST_TOKENS ? request.headers.get('X-Test-IP') || '127.0.0.1' : '');
  if (!ip) fail(400, 'No address.');
  return ip;
}
let ipKey = null;
async function ipIdOf(env, text) {
  if (!ipKey) {
    const secret = env.IP_KEY || (env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT).private_key : 'test-ip-key');
    const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('frixion-ip:' + secret));
    ipKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', ipKey, new TextEncoder().encode(text.toLowerCase())));
  return 'ip_' + [...mac.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// The 8 groups of an IPv6 address (null if it isn't one)
function v6Groups(ip) {
  const s = String(ip).toLowerCase().split('%')[0], halves = s.split('::');
  if (halves.length > 2 || /[^0-9a-f:]/.test(s)) return null;
  const a = halves[0] ? halves[0].split(':') : [], b = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - a.length - b.length : 0, all = [...a, ...Array(Math.max(0, fill)).fill('0'), ...b];
  return fill >= 0 && all.length === 8 && all.every(g => /^[0-9a-f]{1,4}$/.test(g)) ? all.map(g => g.replace(/^0+(?=.)/, '')) : null;
}
// The network an address belongs to (v4.68, request 69). An IPv6 address changes every day or so inside one home or
// school network (privacy addresses), which made the same network show up again and again, so IPv6 goes by its first
// half (its /64), which stays put. An IPv4 address is the whole network already (a home's one outside address).
function ipNetwork(ip) {
  const v4 = String(ip).match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (v4) return v4[1];
  const g = v6Groups(ip);
  return g ? g.slice(0, 4).join(':') + '::/64' : String(ip);
}
const ipId = (env, ip) => ipIdOf(env, ipNetwork(ip));
// (before v4.68 an IPv6 address was its own entry, so a ban made on one of those still counts for that address)
const ipOldId = (env, ip) => (ipNetwork(ip) === String(ip).toLowerCase() ? null : ipIdOf(env, ip));
const ipLabel = ip => (ip.includes(':') ? ip.split(':').slice(0, 2).join(':') + ':…' : ip.split('.').slice(0, 2).join('.') + '.x.x');
// Is this address banned? Asked on every page load, so the answer is kept for a minute.
const banLooks = new Map();   // id -> { at, ban }
async function ipCheck(env, request) {
  const ip = callerIp(env, request), id = await ipId(env, ip), old = await ipOldId(env, ip);
  let hit = banLooks.get(id);
  if (!hit || Date.now() - hit.at > 60000) {
    const [net, addr] = await fsGetMany(env, [`bannedIps/${id}`, ...(old ? [`bannedIps/${old}`] : [])]);
    hit = { at: Date.now(), ban: net ? net.data : addr ? addr.data : null };
    banLooks.set(id, hit);
    if (banLooks.size > 5000) banLooks.clear();
  }
  return hit.ban ? { id, banned: true, reason: hit.ban.reason || 'No reason given' } : { id, banned: false };
}
// Who used this address: signed in (their ID token says who), and on which device (as the page says).
async function ipSeen(env, request, { token, device }) {
  const claims = await verifyIdToken(env, token);
  const acct = await fsGet(env, `accounts/${claims.sub}`);
  const name = acct && typeof acct.username === 'string' ? acct.username : null;
  if (!name) fail(403, 'That sign-in isn\'t a Frixion account.');
  const ip = callerIp(env, request), id = await ipId(env, ip);
  const add = { accounts: [name], ...(/^dev_[a-f0-9]{32}$/.test(device || '') ? { devices: [device] } : {}) };
  const r = await fetch(`${fsBase(env)}:commit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await googleToken(env) },
    body: JSON.stringify({ writes: [{ update: { name: docName(env, `ips/${id}`), fields: { label: enc(ipLabel(ip)), lastSeen: enc(new Date()) } }, updateMask: { fieldPaths: ['label', 'lastSeen'] },
      updateTransforms: Object.entries(add).map(([f, v]) => ({ fieldPath: f, appendMissingElements: { values: v.map(enc) } })) }] }) });
  if (!r.ok) fail(502, 'Could not save that.');
  return { ok: true, id };
}

// The Owner panel's Devices and IP tabs: take an account off devices or networks (v4.68, request 69), like accounts the
// Owner signed in to on their own computer, so they stop counting as linked there. It's added back if that account
// signs in there again. An entry left with no accounts goes too, unless it's a banned device (that keeps the ban).
async function unlink(env, { token, kind, ids, account }) {
  await requireOwner(env, token);
  if (kind !== 'devices' && kind !== 'ips') fail(400, 'Pick devices or networks.');
  if (typeof account !== 'string' || !USERNAME.test(account)) fail(400, 'That isn\'t a username.');
  const idRe = kind === 'devices' ? /^dev_[a-f0-9]{32}$/ : /^ip_[a-f0-9]{24}$/;
  const list = [...new Set(Array.isArray(ids) ? ids : [])].filter(id => typeof id === 'string' && idRe.test(id)).slice(0, 200);
  if (!list.length) fail(400, 'Nothing to change.');
  for (let i = 0; i < 4; i++) {
    const docs = await fsGetMany(env, list.map(id => `${kind}/${id}`)), writes = [];
    docs.forEach((d, n) => {
      const accounts = d && Array.isArray(d.data.accounts) ? d.data.accounts : [];
      if (!accounts.includes(account)) return;
      const path = `${kind}/${list[n]}`;
      writes.push(accounts.length === 1 && d.data.banned !== true
        ? { delete: docName(env, path), currentDocument: { updateTime: d.updateTime } }
        : { transform: { document: docName(env, path), fieldTransforms: [{ fieldPath: 'accounts', removeAllFromArray: { values: [enc(account)] } }] }, currentDocument: { updateTime: d.updateTime } });
    });
    if (!writes.length) return { ok: true, changed: 0 };
    if (await fsCommit(env, writes)) return { ok: true, changed: writes.length };
  }
  fail(409, 'Frixion is busy. Try again.');
}

// ---------- who someone is, for the Realtime Database ----------
const rankOf = u => (u.owner === true ? 3 : u.coowner === true ? 2 : u.op === true ? 1 : 0);
async function setClaims(env, { token, username }) {
  const claims = await verifyIdToken(env, token);
  const acct = await fsGet(env, `accounts/${claims.sub}`);
  const myName = acct && typeof acct.username === 'string' ? acct.username : null;
  const me = myName ? await fsGet(env, `users/${myName}`) : null;
  if (!me || me.authUid !== claims.sub) {
    if (username != null) fail(403, 'That sign-in isn\'t a Frixion account.');
    return putClaims(env, claims.sub, { role: 'authenticated' });   // (registering: it has no username or rank yet)
  }
  let name = myName, target = me;
  if (username != null && username !== myName) {
    if (rankOf(me) < 2) fail(403, 'Only the Owner can do that.');
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{1,40}$/.test(username)) fail(400, 'That isn\'t a username.');
    target = await fsGet(env, `users/${username}`);
    if (!target) fail(404, 'No account has that username.');
    if (typeof target.authUid !== 'string' || !target.authUid) return { ok: true, skipped: 'no sign-in yet' };
    name = username;
  }
  return putClaims(env, target.authUid, { role: 'authenticated', n: name, r: rankOf(target) });
}
async function putClaims(env, localId, want) {
  const r = await authCall(env, 'accounts:update', { localId, customAttributes: JSON.stringify(want) });
  if (!r.ok) {
    const why = await googleWhy(r);
    if (/USER_NOT_FOUND/.test(why)) fail(404, 'That account\'s sign-in is gone.');
    if (noRole(r, why)) fail(503, 'The service account can\'t change sign-ins yet: give it the Firebase Authentication Admin role.');
    fail(502, 'Google refused (' + why + ').');
  }
  return { ok: true, claims: want };
}

// ---------------- the Orbs economy (v4.57) ----------------
// Orbs only ever go up here (or by staff): a page may only take its own away (firestore.rules). Each change is one commit
// that only lands if what it read hasn't changed since (otherwise it reads again and retries), so two requests at once
// can't spend the same Orbs or use the same code twice.
const EARN_CAP = 20000;   // Orbs a day from games, per account
const EARN_CAP_PREMIUM = 100000;   // ...or with Frixion Premium (v4.68, request 67)
const earnCapOf = u => (Number(u && u.premiumUntil) > Date.now() ? EARN_CAP_PREMIUM : EARN_CAP);
const utcDay = () => new Date().toISOString().slice(0, 10);
const nextUtcDay = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
// Google's free plan allows so many database reads and writes a day; past that it answers 429 until it starts over
// (midnight Pacific time)
const OUT_OF_READS = 'Frixion reached its database limit for today. Try again later.';

// several documents in one read: { data, updateTime } for each path (null if it isn't there), in the same order
async function fsGetMany(env, paths) {
  const names = paths.map(p => docName(env, p));
  const r = await fetch(`${fsBase(env)}:batchGet`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await googleToken(env) },
    body: JSON.stringify({ documents: names }) });
  if (r.status === 429) fail(503, OUT_OF_READS);
  if (!r.ok) fail(502, 'Could not read Frixion.');
  const got = new Map();
  for (const x of await r.json()) if (x.found) got.set(x.found.name, { data: decFields(x.found.fields), updateTime: x.found.updateTime });
  return names.map(n => got.get(n) || null);
}
// these writes together, or none: null when one of their checks failed because something changed since it was read
async function fsCommit(env, writes) {
  const r = await fetch(`${fsBase(env)}:commit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await googleToken(env) },
    body: JSON.stringify({ writes }) });
  if (r.ok) return r.json();
  const j = await r.json().catch(() => ({})), status = String((j.error && j.error.status) || '');
  if (/^(FAILED_PRECONDITION|NOT_FOUND|ALREADY_EXISTS|ABORTED)$/.test(status)) return null;
  if (r.status === 429 || status === 'RESOURCE_EXHAUSTED') fail(503, OUT_OF_READS);
  console.error('commit refused', r.status, status, j.error && j.error.message);
  fail(502, 'Could not save that.');
}
// the new Orbs balance a commit's increment left (Firestore says it back)
const orbsAfter = (done, i) => { const t = done && done.writeResults && done.writeResults[i] && done.writeResults[i].transformResults; return t && t[0] ? dec(t[0]) : null; };

// Who is asking: their ID token, and the username on it (n, which /claims put there from the profile) or else their
// accounts/ entry. Every route then reads the profile, which has to name this sign-in back.
async function caller(env, token) {
  const claims = await verifyIdToken(env, token);
  let name = typeof claims.n === 'string' && USERNAME.test(claims.n) ? claims.n : null;
  if (!name) {
    const acct = await fsGet(env, `accounts/${claims.sub}`);
    name = acct && typeof acct.username === 'string' && USERNAME.test(acct.username) ? acct.username : null;
  }
  if (!name) fail(403, 'That sign-in isn\'t a Frixion account.');
  return { uid: claims.sub, name };
}
const bannedNow = u => u.banned === true && (u.bannedUntil == null || u.bannedUntil > Date.now());
function mine(prof, me) {
  if (!prof || prof.data.authUid !== me.uid) fail(403, 'That sign-in isn\'t a Frixion account.');
  if (bannedNow(prof.data)) fail(403, 'This account is banned.');
  return prof.data;
}
// a few requests a minute per account and route (each copy of this function counts its own)
const asks = new Map();   // "route:name" -> { at, n }
function slowDown(key, most) {
  const t = asks.get(key), now = Date.now();
  if (t && now - t.at < 60000 && t.n >= most) fail(429, 'Too many tries. Wait a minute.');
  asks.set(key, t && now - t.at < 60000 ? { at: t.at, n: t.n + 1 } : { at: now, n: 1 });
  if (asks.size > 5000) asks.clear();
}

// Orbs from games: up to EARN_CAP a day per account (EARN_CAP_PREMIUM with Premium); whatever is past that isn't added.
async function earn(env, { token, n }) {
  const me = await caller(env, token);
  const want = Math.floor(Number(n));
  if (!(want >= 1)) fail(400, 'Nothing to add.');
  slowDown('earn:' + me.name, 40);
  for (let i = 0; i < 6; i++) {
    const [prof, day] = await fsGetMany(env, [`users/${me.name}`, `orbDays/${me.name}`]);
    const cap = earnCapOf(mine(prof, me));
    const today = utcDay(), got = day && day.data.day === today ? Math.max(0, Number(day.data.got) || 0) : 0;
    const add = Math.min(want, cap - got);
    if (add <= 0) return { added: 0, left: 0, cap, resetsAt: nextUtcDay() };
    const done = await fsCommit(env, [
      { update: { name: docName(env, `orbDays/${me.name}`), fields: { day: enc(today), got: enc(got + add), at: enc(new Date()) } },
        currentDocument: day ? { updateTime: day.updateTime } : { exists: false } },
      { transform: { document: docName(env, `users/${me.name}`), fieldTransforms: [{ fieldPath: 'orbs', increment: enc(add) }] }, currentDocument: { exists: true } },
    ]);
    if (done) return { added: add, left: cap - got - add, cap, resetsAt: nextUtcDay(), orbs: orbsAfter(done, 1) };
  }
  fail(409, 'Frixion is busy. Try again.');
}

// The Shop: [owned list, equipped field, the collection staff-made ones live in] for each tab (SHOP_CATEGORY_DEFS in
// script.js). Staff songs are entries in config/customMusic instead.
const SHOP = {
  decorations: ['ownedDecorations', 'equippedDecoration', 'shopDecorations'],
  masks: ['ownedDecorations', 'equippedMask', 'shopDecorations'],
  nameplates: ['ownedNameplates', 'equippedNameplate', 'shopNameplates'],
  profile_effects: ['ownedProfileEffects', 'equippedProfileEffect', 'shopProfileEffects'],
  profile_frames: ['ownedProfileFrames', 'equippedProfileFrame', 'shopProfileFrames'],
  badges: ['ownedBadges', 'equippedBadge', 'shopBadges'],   // (v4.65: they all show on the profile; the equipped one doesn't matter)
  themes: ['ownedThemes', 'equippedTheme', 'shopThemes'],
  banners: ['ownedBanners', 'equippedBanner', 'shopBanners'],
  music: ['ownedMusic', 'equippedMusic', null],
};
const ITEM_ID = /^(?!__)[A-Za-z0-9_-]{1,100}$/;
const wholePrice = p => (Number.isInteger(p) && p >= 0 ? p : null);
// What an item costs, or null when it isn't for sale: the built-in price (shopPrices/builtin), else the staff-made item's
// own, while it isn't switched off.
function priceOf(cat, id, builtin, custom) {
  const list = builtin && builtin.data.p && builtin.data.p[cat];
  if (own(list, id)) return wholePrice(Number(list[id]));
  const coll = SHOP[cat][2], item = custom && (coll ? custom.data : (own(custom.data, id) ? custom.data[id] : null));
  if (!item || typeof item !== 'object' || item.disabled === true) return null;
  if (coll === 'shopDecorations' && (item.mask === true) !== (cat === 'masks')) return null;
  if (!coll && !(typeof item.src === 'string' && /^https:\/\//i.test(item.src) && item.name)) return null;
  return wholePrice(Number(item.price));
}
async function buy(env, { token, cat, id }) {
  const me = await caller(env, token);
  if (!own(SHOP, cat) || typeof id !== 'string' || !ITEM_ID.test(id)) fail(404, 'That item isn\'t in the Shop.');
  slowDown('buy:' + me.name, 20);
  const [owned, equip, coll] = SHOP[cat];
  for (let i = 0; i < 6; i++) {
    const [prof, builtin, custom] = await fsGetMany(env, [`users/${me.name}`, 'shopPrices/builtin', coll ? `${coll}/${id}` : 'config/customMusic']);
    const u = mine(prof, me);
    const price = priceOf(cat, id, builtin, custom);
    if (price == null) fail(404, 'That item isn\'t for sale right now.');
    if ((Array.isArray(u[owned]) ? u[owned] : []).includes(id)) fail(409, 'You already own this.');
    const inf = infinite(u);   // infinite Orbs (v4.64, and the infinity sign since v4.66): nothing is taken
    if (!inf && (Number(u.orbs) || 0) < price) fail(402, 'Not enough Orbs. Play games to earn more.');
    // paid, owned and worn at once (like Discord's shop), only if the profile is still what was read
    const done = await fsCommit(env, [{
      update: { name: docName(env, `users/${me.name}`), fields: { [equip]: enc(id) } }, updateMask: { fieldPaths: [equip] },
      updateTransforms: [...(inf ? [] : [{ fieldPath: 'orbs', increment: enc(-price) }]), { fieldPath: owned, appendMissingElements: { values: [enc(id)] } }],
      currentDocument: { updateTime: prof.updateTime },
    }]);
    if (done) return { ok: true, price, orbs: inf ? Number(u.orbs) || 0 : orbsAfter(done, 0) };
  }
  fail(409, 'Frixion is busy. Try again.');
}
// Banner pictures (v4.64): 5,000 Orbs every upload (the Owner's price). The picture is uploaded to Frixion's Cloudinary
// first; this checks it's from there, takes the Orbs and puts it on the profile in one commit. Nothing else may set
// bannerImage (firestore.rules); the profile's owner may only take it off.
const BANNER_PRICE = 5000;
const BANNER_URL = /^https:\/\/res\.cloudinary\.com\/a97nqv9w\/image\/upload\/[A-Za-z0-9_./,-]{1,300}\.(png|jpe?g|webp|gif|avif)$/i;
async function setBanner(env, { token, url }) {
  const me = await caller(env, token);
  if (typeof url !== 'string' || !BANNER_URL.test(url) || url.includes('..')) fail(400, 'That picture didn\'t upload right. Try again.');
  slowDown('banner:' + me.name, 6);
  for (let i = 0; i < 6; i++) {
    const [prof] = await fsGetMany(env, [`users/${me.name}`]);
    const u = mine(prof, me), inf = infinite(u);
    if (!inf && (Number(u.orbs) || 0) < BANNER_PRICE) fail(402, 'A banner picture costs 5,000 Orbs.');
    const done = await fsCommit(env, [{
      update: { name: docName(env, `users/${me.name}`), fields: { bannerImage: enc(url) } }, updateMask: { fieldPaths: ['bannerImage'] },
      ...(inf ? {} : { updateTransforms: [{ fieldPath: 'orbs', increment: enc(-BANNER_PRICE) }] }),
      currentDocument: { updateTime: prof.updateTime },
    }]);
    if (done) return { ok: true, bannerImage: url, orbs: inf ? Number(u.orbs) || 0 : orbsAfter(done, 0) };
  }
  fail(409, 'Frixion is busy. Try again.');
}
// Buy All (v4.64): every item in the list the buyer doesn't own yet, in one commit (one read of each item's price, one
// write). Items that aren't for sale are skipped; nothing is equipped.
async function buyAll(env, { token, cat, ids }) {
  const me = await caller(env, token);
  if (!own(SHOP, cat) || !Array.isArray(ids) || !ids.length || ids.length > 60 || ids.some(id => typeof id !== 'string' || !ITEM_ID.test(id))) fail(400, 'Nothing to buy.');
  slowDown('buy:' + me.name, 20);
  const [owned, , coll] = SHOP[cat], want = [...new Set(ids)];
  for (let i = 0; i < 6; i++) {
    const [prof, builtin, ...docs] = await fsGetMany(env, [`users/${me.name}`, 'shopPrices/builtin', ...(coll ? want.map(id => `${coll}/${id}`) : ['config/customMusic'])]);
    const u = mine(prof, me), have = Array.isArray(u[owned]) ? u[owned] : [], inf = infinite(u);
    let total = 0;
    const bought = [];
    want.forEach((id, k) => {
      if (have.includes(id)) return;
      const price = priceOf(cat, id, builtin, coll ? docs[k] : docs[0]);
      if (price == null) return;
      total += price; bought.push(id);
    });
    if (!bought.length) fail(409, 'You already own all of those.');
    if (!inf && (Number(u.orbs) || 0) < total) fail(402, `That's ${total.toLocaleString('en-US')} Orbs. You don't have enough.`);
    const done = await fsCommit(env, [{
      transform: { document: docName(env, `users/${me.name}`), fieldTransforms: [...(inf ? [] : [{ fieldPath: 'orbs', increment: enc(-total) }]), { fieldPath: owned, appendMissingElements: { values: bought.map(enc) } }] },
      currentDocument: { updateTime: prof.updateTime },
    }]);
    if (done) return { ok: true, bought, total, orbs: inf ? Number(u.orbs) || 0 : orbsAfter(done, 0) };
  }
  fail(409, 'Frixion is busy. Try again.');
}

// Easter eggs (v4.62): the 50, and how hard each is to find (e easy, m medium, h hard, v very hard, l legendary), which
// sets its Orbs. [tier, hash] for the ones found by typing a secret: the SHA-256 of "frixion-egg:" + the answer in capitals
// with only letters and digits kept (eggHash). The same list, with names and how each is found, is EGGS in script.js.
const EGG_ORBS = { e: 100, m: 250, h: 500, v: 1000, l: 2500 };
const EGGS = {
  oldcode: 'm', frixion: 'e', hello: 'e', esrever: 'm', gravity: 'm', letitsnow: 'e', party: 'e', greencode: 'm', shift10: 'e',
  ctrlalto: 'm', spin: 'm', pi: 'h', logo10: 'e', avatar7: 'm', version5: 'e', orbchip: 'm', settings10: 'm', typingclick: 'h',
  hiddendot: 'h', credits: 'h', emptypins: 'e', eggmsg: 'e', threeam: 'h', eleveneleven: 'm', midnight: 'h', hashegg: 'm',
  console: 'h', idle10: 'm', dnd5: 'm', themehop: 'm', lightmode: 'e', quickopen: 'e', selfadd: 'e', displayegg: 'm',
  snake67: 'm', merge2048: 'v', typingegg: 'e', simon67: 'v', luckyrush: 'h', voidcrop: 'v', samegarden: 'h', lastegg: 'l',
  zerohero: 'm', onepointoh: 'e', triple: 'm', tenx: 'h', jackpot: 'e',   // v4.63: the Casino
  tricked: 'e', mazehalf: 'h', ontime: 'm', hideorbs: 'e',                // v4.64
  badgefan: 'm', allbadges: 'h', fxwatch: 'm', slimepoke: 'e',           // v4.65: badges and drawn effects
  equilibrium: 'm', mazeflawless: 'h', quickflip: 'e', rainbowname: 'm', // v4.66: 0 Orbs, the maze, Quick Open, name colors
  seedcheck: 'm', bigbet: 'h', koifeed: 'e', stockout: 'm',               // v4.67: Provably Fair, big bets, the koi, the garden
  sixseven: 'e', gardentour: 'm', maxedout: 'h',                          // v4.68: Orb gifts, garden visits, the daily game limit
  longwinded: 'h', midnightevent: 'm', secretclub: 'm', firsttrade: 'e',  // v4.69: voice messages, events, private threads, trades
  keepout: 'e', glassphone: 'm', forever: 'm',                            // v4.70: a private garden, glass on a phone, forever Premium
  smoothplate: 'e', freshpaint: 'm', matchingset: 'm',                    // v4.71: a built-in nameplate, 3 themes, a matching set
  hawking: 'e', spaghetti: 'm', lostinspace: 'h',                          // v4.72: the word, poking the Black Hole effect, the whole set
  autopilot: 'e', beepboop: 'e', arcadepro: 'm',                           // v4.73: two bot words, opening 5 games in one visit
  liquiddash: 'h', pocketmaze: 'e', gdwave: 'e',                           // v4.74: Liquid Dash 600, Mouse Maze gamepad, "ninecircles"
  watchparty: 'e', screensaver: 'e', golive: 'e',                          // v4.75: Screenshare watch/host, "screenshare", "golive"
  xyzzy: ['m', '7d76c6d11ed06a3e671afa826c4f88f4e8227fdef446cbd576a3428967e45af9'],
  codeb1: ['e', '4f3cd88dc035fd4d04dda074fd7ced1722751824644c1a27a700dfd5d06ba19e'],
  codeb2: ['e', 'c886bb737cc711b2dfcb069ea8179dc430661db13a38113ddf718b9098f653c7'],
  codecracker: ['m', '9272bb2cd0bf657e4d7fa917a2677e687e6f7c70df391b3c1ec399bdc8f407db'],
  freeorbs: ['e', 'adb07b3f3ea4d065e0dba64721a9d7cba035856b4c7acd071322245a919cb619'],
  riddle1: ['h', '45da9aba60eb46f8346b9b3dfe89d2861ce4b509b9640c95d43909aae9b0dbae'],
  riddle2: ['v', 'b9565c29fb4549d0c32b53de11180eabe4d22f4aca067e5aa132f397b7363d82'],
  riddle3: ['l', '78be81c5a939aa73a905369bd86a8616a912917ac1612936a08c310482a53e7d'],
};
const EGG_COUNT = Object.keys(EGGS).length;
async function eggHash(answer) {
  const a = String(answer == null ? '' : answer).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 64);
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('frixion-egg:' + a));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function findEgg(env, { token, egg: id, answer }) {
  const me = await caller(env, token);
  const def = typeof id === 'string' && own(EGGS, id) ? [].concat(EGGS[id]) : null;
  if (!def) fail(404, 'That isn\'t an egg.');
  slowDown('egg:' + me.name, 30);
  if (def[1] && await eggHash(answer) !== def[1]) fail(403, 'That isn\'t it.');
  const orbs = EGG_ORBS[def[0]];
  for (let i = 0; i < 6; i++) {
    const [prof, rec] = await fsGetMany(env, [`users/${me.name}`, `eggs/${me.name}`]);
    mine(prof, me);
    const found = rec && Array.isArray(rec.data.found) ? rec.data.found.filter(x => typeof x === 'string' && own(EGGS, x)) : [];
    if (found.includes(id)) return { ok: true, already: true, found, total: EGG_COUNT };
    if (id === 'riddle2' && !found.includes('riddle1')) fail(403, 'Solve the first riddle first.');
    if (id === 'riddle3' && !found.includes('riddle2')) fail(403, 'Solve the second riddle first.');
    if (id === 'lastegg' && found.length < EGG_COUNT - 1) fail(403, 'Not yet.');
    const now = [...new Set([...found, id])], all = now.length >= EGG_COUNT;
    // paid once: only if the list is still what was read (or still missing)
    const done = await fsCommit(env, [
      { update: { name: docName(env, `eggs/${me.name}`), fields: { found: enc(now), at: enc(new Date()) } },
        currentDocument: rec ? { updateTime: rec.updateTime } : { exists: false } },
      all
        ? { update: { name: docName(env, `users/${me.name}`), fields: { cracker: enc(true) } }, updateMask: { fieldPaths: ['cracker'] },
            updateTransforms: [{ fieldPath: 'orbs', increment: enc(orbs) }], currentDocument: { exists: true } }
        : { transform: { document: docName(env, `users/${me.name}`), fieldTransforms: [{ fieldPath: 'orbs', increment: enc(orbs) }] }, currentDocument: { exists: true } },
    ]);
    if (done) return { ok: true, orbs, found: now, total: EGG_COUNT, cracker: all, balance: orbsAfter(done, 1) };
  }
  fail(409, 'Frixion is busy. Try again.');
}

// Codes (Settings > Codes): FRX-XXXX-XXXX ones bought with Orbs, or whatever staff typed. Each account can use a code
// once, and it pays out while it has uses left (maxUses 0: no limit).
function codeId(code) {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
  return c && c.length <= 64 && !c.includes('/') && c !== '.' && c !== '..' && !/^__.*__$/.test(c) ? c : null;
}
// (codeUsage() in script.js: codes made before limits existed only had redeemedBy)
function codeUsage(d) {
  const n = Number(d.maxUses), maxUses = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
  const usedBy = Array.isArray(d.usedBy) ? d.usedBy : (d.redeemedBy ? [d.redeemedBy] : []);
  const uses = Math.max(Number(d.uses) || 0, usedBy.length);
  return { maxUses, usedBy, uses, usedUp: maxUses > 0 && uses >= maxUses };
}
async function redeemCode(env, { token, code }) {
  const me = await caller(env, token);
  slowDown('code:' + me.name, 10);
  const id = codeId(code);
  if (!id) fail(404, 'That code is invalid.');
  for (let i = 0; i < 6; i++) {
    const [prof, c] = await fsGetMany(env, [`users/${me.name}`, `redeemCodes/${id}`]);
    const u = mine(prof, me);
    if (!c) fail(404, 'That code is invalid.');
    const usage = codeUsage(c.data), type = c.data.type;
    if (usage.usedBy.includes(me.name)) fail(409, 'You have already redeemed this code.');
    if (usage.usedUp) fail(409, usage.maxUses === 1 ? 'That code has already been redeemed.' : 'That code has been used up.');
    if (type !== 'orbs' && type !== 'premium') fail(404, 'That code is invalid.');
    const value = Math.max(0, Math.floor(Number(c.data.value) || 0));
    // the use that reaches the code's limit deletes it (v4.68, request 66); before that, it's counted
    const lastUse = usage.maxUses > 0 && usage.uses + 1 >= usage.maxUses;
    const writes = [lastUse ? { delete: docName(env, `redeemCodes/${id}`), currentDocument: { updateTime: c.updateTime } } : {
      update: { name: docName(env, `redeemCodes/${id}`), fields: { uses: enc(usage.uses + 1), usedBy: enc([...usage.usedBy, me.name]), redeemedBy: enc(me.name), redeemedAt: enc(new Date()) } },
      updateMask: { fieldPaths: ['uses', 'usedBy', 'redeemedBy', 'redeemedAt'] }, currentDocument: { updateTime: c.updateTime },
    }];
    let until = null;
    if (type === 'orbs') {
      writes.push({ transform: { document: docName(env, `users/${me.name}`), fieldTransforms: [{ fieldPath: 'orbs', increment: enc(value) }] }, currentDocument: { exists: true } });
    } else {
      // more days on top of Premium that's still running, or from now
      const now = Date.now(), base = typeof u.premiumUntil === 'number' && u.premiumUntil > now ? u.premiumUntil : now;
      until = base + value * 86400000;
      writes.push({ update: { name: docName(env, `users/${me.name}`), fields: { premiumUntil: enc(until) } }, updateMask: { fieldPaths: ['premiumUntil'] }, currentDocument: { updateTime: prof.updateTime } });
    }
    const done = await fsCommit(env, writes);
    if (done) return { ok: true, type, value, ...(until ? { premiumUntil: until } : { orbs: orbsAfter(done, 1) }) };
  }
  fail(409, 'Frixion is busy. Try again.');
}

// ---------------- the Casino (v4.63) ----------------
// Every result is picked here, never in the page. Most games pay back 97% of what's bet over time (Roulette 97.3%,
// Blackjack about 99% played well), so the house wins slowly but nothing is rigged: the odds are the same for everyone,
// every time, and the page shows them.
//   Instant games (dice, limbo, coinflip, rps, roulette, slots, plinko, keno, cases, upgrader): one read, one commit that
//   takes the bet and pays the win together.
//   Step games (mines, towers, hilo, cross): 'start' takes the bet and notes the game on the profile (casino.open). The
//   board comes from an HMAC of the game's id (keyed from the service account's key), so it's the same on every request
//   and nothing is saved between clicks: the page holds a sealed ticket (game, bet, settings, username) and the moves so
//   far, and each request replays them all, so a move onto a mine anywhere in the list loses. Losing and cashing out
//   close the game with a commit that only lands if the profile hasn't changed since it was read: a game pays once.
//   Blackjack saves each card drawn (casino.open.a), so nobody can look at a card and then take the move back.
//   Crash: the crash point comes from the game's id too; 'watch' waits for the round to end and settles it, and any
//   later request settles a round nobody watched.
// Limits: bets from 10 Orbs, with no top limit beyond what you have, and wins as big as they come (v4.67, request 60:
// before, 10,000 a bet and 1,000,000 a game); 200 games a day per account (UTC days). (1e300: big enough for anyone, and
// a bet times any multiplier here still fits in a number.)
const CASINO_RTP = 0.97, BET_MIN = 10, BET_MAX = 1e300, WIN_MAX = Infinity, CASINO_DAY = 200;
const CRASH_RATE = 0.17, CRASH_MAX = 1000, CRASH_LEAD = 1200;   // e^(0.17 s): 2x at 4 s, 10x at 13.5 s, 1000x at 40.6 s
const MEGA_PRICE = 1000, MEGA_PRIZE = 97000, MEGA_CHANCE = 0.01, MEGA_WAIT = 86400000;

let casinoKeyP = null;
function casinoKey(env) {
  if (!casinoKeyP) casinoKeyP = (async () => {
    const secret = env.CASINO_KEY || (env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT).private_key : 'test-casino-key');
    const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('frixion-casino:' + secret));
    return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  })();
  return casinoKeyP;
}
const hmacBytes = async (env, text) => new Uint8Array(await crypto.subtle.sign('HMAC', await casinoKey(env), new TextEncoder().encode(text)));
// (games started before v4.67 got their numbers from a key made from the game's id; they still finish that way)
const gameStream = async (env, id) => stream(await hmacBytes(env, 'game:' + id));
const newGameId = () => 'g' + Date.now().toString(36) + [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
const payOf = (bet, mult) => Math.min(WIN_MAX, Math.floor(bet * mult + 1e-9));

// ---------- Provably Fair (v4.67, request 56): casino-fair.js says how every result is worked out ----------
// casino.fair on the profile is { e: which server seed, c: your client seed, n: the next bet's nonce }. Server seed e is
// an HMAC of the casino's secret key, your username and e, so it's never stored and can't be guessed, and it's only shown
// once you've moved on to the next one (fairRoute). A game takes f = { u, e, c, n } when it starts and saves n + 1.
const fairOf = u => { const f = casinoOf(u).fair; return f && Number.isInteger(f.e) && f.e >= 0 && typeof f.c === 'string' && Number.isInteger(f.n) && f.n >= 0 ? { e: f.e, c: f.c, n: f.n } : { e: 0, c: 'frixion', n: 0 }; };
const fairFor = (name, u) => ({ u: name, ...fairOf(u) });
const fairNext = f => ({ e: f.e, c: f.c, n: f.n + 1 });
async function serverSeed(env, name, e) { return hexOf(await hmacBytes(env, `fair:${name}:${e}`)); }
async function fairR(env, f) { return fairStream(await serverSeed(env, f.u, f.e), f.c, f.n); }
// what a bet's answer says about its seeds, so the page can check it later
async function fairShown(env, f) { return f ? { e: f.e, hash: await fairHash(await serverSeed(env, f.u, f.e)), c: f.c, n: f.n } : null; }
function betOf(x) {
  const b = Number(x);
  if (!Number.isInteger(b) || b < BET_MIN || b > BET_MAX) fail(400, 'Bets start at 10 Orbs.');
  return b;
}

// A ticket the page holds for a step game: what it is, sealed so it can't be changed.
async function seal(env, o) {
  const body = b64urlText(JSON.stringify(o));
  return body + '.' + b64url((await hmacBytes(env, 'seal:' + body)).slice(0, 18));
}
async function unseal(env, s) {
  const [body, mac] = String(s || '').split('.');
  if (!body || !mac || b64url((await hmacBytes(env, 'seal:' + body)).slice(0, 18)) !== mac) fail(400, 'That game is over.');
  try { return JSON.parse(new TextDecoder().decode(unb64url(body))); } catch (e) { fail(400, 'That game is over.'); }
}

// The profile's casino map: day and n (games that day), open (the game going on), mega (a Mega ticket), and totals.
const casinoOf = u => (u && u.casino && typeof u.casino === 'object' ? u.casino : {});
const encAny = v => (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
  ? { mapValue: { fields: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, encAny(x)])) } }
  : Array.isArray(v) ? { arrayValue: { values: v.map(encAny) } } : enc(v));
// One commit on the profile, only if it hasn't changed since `prof` was read: Orbs up by `delta` (down when it's
// negative), these casino fields set (removed when null), and the totals added to. null if the profile had changed.
// Referrals (v4.67, request 56): whoever brought this player in (referredBy, set by the referral route) gets 10% of the
// house edge on each bet, 5% of each win (the part over the bet), and 10,000 Orbs once this player has bet 10,000 Orbs
// in all (casino.refPaid marks that it's been paid). Nothing from infinite Orbs, and nothing for an account that's gone.
const REF_EDGE_CUT = 0.1, REF_WIN_CUT = 0.05, REF_BONUS = 10000, REF_BONUS_AT = 10000;
async function casinoCommit(env, name, prof, u, { delta = 0, set = {}, stake = 0, paid = 0, win = 0, game = false }) {
  const fields = { at: enc(new Date()) }, paths = ['casino.at'];
  for (const [k, v] of Object.entries(set)) { paths.push('casino.' + k); if (v !== null) fields[k] = encAny(v); }
  const tf = [], writes = [];
  const refName = !infinite(u) && typeof u.referredBy === 'string' && USERNAME.test(u.referredBy) && u.referredBy !== name ? u.referredBy : null;
  if (refName) {
    const c = casinoOf(u), before = Number(c.wagered) || 0;
    let cut = Math.floor(stake * (1 - CASINO_RTP) * REF_EDGE_CUT) + Math.floor(Math.max(0, win) * REF_WIN_CUT);
    if (c.refPaid !== true && before < REF_BONUS_AT && before + stake >= REF_BONUS_AT) { cut += REF_BONUS; fields.refPaid = enc(true); paths.push('casino.refPaid'); }
    if (cut > 0 && Number.isFinite(cut) && await fsGet(env, `users/${refName}`)) {
      writes.push({ transform: { document: docName(env, `users/${refName}`), fieldTransforms: [{ fieldPath: 'orbs', increment: enc(cut) }, { fieldPath: 'referral.earned', increment: enc(cut) }] }, currentDocument: { exists: true } });
    }
  }
  if (infinite(u)) delta = 0;            // infinite Orbs (v4.64; the infinity sign too, v4.66) never go up or down
  if (delta) tf.push({ fieldPath: 'orbs', increment: enc(delta) });
  if (game) tf.push({ fieldPath: 'casino.games', increment: enc(1) });
  if (stake) tf.push({ fieldPath: 'casino.wagered', increment: enc(stake) });
  if (paid) tf.push({ fieldPath: 'casino.won', increment: enc(paid) }, { fieldPath: 'casino.best', maximum: enc(paid) });
  const done = await fsCommit(env, [{ update: { name: docName(env, `users/${name}`), fields: { casino: { mapValue: { fields } } } },
    updateMask: { fieldPaths: paths }, updateTransforms: tf, currentDocument: { updateTime: prof.updateTime } }, ...writes]);
  if (!done) return null;
  const tr = done.writeResults && done.writeResults[0] && done.writeResults[0].transformResults;
  return { orbs: delta ? (tr && tr[0] ? dec(tr[0]) : null) : Number(u.orbs) || 0 };
}
// one more game today, or no if that's all of them
function dayCount(c) {
  const today = utcDay(), n = c.day === today ? Math.max(0, Number(c.n) || 0) : 0;
  if (n >= CASINO_DAY) fail(429, 'That\'s all 200 casino games for today. More after midnight UTC.');
  return { day: today, n: n + 1 };
}
const gamesLeft = c => CASINO_DAY - (c.day === utcDay() ? Math.max(0, Number(c.n) || 0) : 0);
async function readProfile(env, me) { const [prof] = await fsGetMany(env, [`users/${me.name}`]); return { prof, u: mine(prof, me) }; }
const BUSY = 'Frixion is busy. Try again.';
const hasOrbs = (u, n) => { if (!infinite(u) && (Number(u.orbs) || 0) < n) fail(400, 'You don\'t have enough Orbs for that.'); };

async function casino(env, b) {
  const me = await caller(env, b.token);
  slowDown('casino:' + me.name, 150);
  const game = String(b.game || ''), action = String(b.action || 'play');
  if (game === 'info') return casinoInfo(env, me);
  if (game === 'fair') return fairRoute(env, me, action, b);
  if (action === 'forfeit') return forfeit(env, me);
  if (own(INSTANT, game)) return instantGame(env, me, game, b);
  if (game === 'mega') return megaTicket(env, me, action);
  if (game === 'crash') return crashGame(env, me, action, b);
  if (game === 'blackjack') return blackjack(env, me, action, b);
  if (own(STEP, game)) return stepGame(env, me, game, action, b);
  fail(404, 'That game isn\'t in the casino.');
}

// ----- instant games: each checks its settings and picks the result: { stake, payout, ...what the page shows } -----
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
// outside bets: [pays (times the chips, chips included), does it win on n?]
const ROULETTE_BETS = {
  red: [2, n => RED.has(n)], black: [2, n => n > 0 && !RED.has(n)],
  odd: [2, n => n > 0 && n % 2 === 1], even: [2, n => n > 0 && n % 2 === 0],
  low: [2, n => n >= 1 && n <= 18], high: [2, n => n >= 19],
  d1: [3, n => n >= 1 && n <= 12], d2: [3, n => n >= 13 && n <= 24], d3: [3, n => n >= 25],
  c1: [3, n => n > 0 && n % 3 === 1], c2: [3, n => n > 0 && n % 3 === 2], c3: [3, n => n > 0 && n % 3 === 0],
};
// Slots: three reels with the same strip (27 stops); three of a kind pays these times the bet, two cherries 1.5x, one
// cherry 0.5x. 96.9% back.
const SLOT_THREE = { cherry: 10, lemon: 12, grape: 16, bell: 25, star: 50, seven: 150, orb: 800 };
// Plinko: what each slot pays, left to right, for 8, 12 and 16 rows (96.8% to 97% back)
const PLINKO = {
  8: { low: [5.5, 2, 1, 0.99, 0.54, 0.99, 1, 2, 5.5], medium: [12.9, 2.9, 1.2, 0.69, 0.45, 0.69, 1.2, 2.9, 12.9], high: [28.9, 3.9, 1.4, 0.29, 0.24, 0.29, 1.4, 3.9, 28.9] },
  12: { low: [9.9, 2.9, 1.5, 1.3, 1, 0.99, 0.6, 0.99, 1, 1.3, 1.5, 2.9, 9.9], medium: [32.9, 10.9, 3.9, 1.9, 1, 0.59, 0.4, 0.59, 1, 1.9, 3.9, 10.9, 32.9],
    high: [169, 23.9, 8, 1.9, 0.66, 0.2, 0.2, 0.2, 0.66, 1.9, 8, 23.9, 169] },
  16: { low: [15.9, 8.9, 1.9, 1.3, 1.3, 1.1, 1, 0.99, 0.64, 0.99, 1, 1.1, 1.3, 1.3, 1.9, 8.9, 15.9],
    medium: [109, 40.9, 9.9, 4.9, 2.9, 1.4, 0.99, 0.49, 0.33, 0.49, 0.99, 1.4, 2.9, 4.9, 9.9, 40.9, 109],
    high: [1000, 129, 25.9, 8.9, 3.9, 1.9, 0.2, 0.2, 0.2, 0.2, 0.2, 1.9, 3.9, 8.9, 25.9, 129, 1000] },
};
// Keno: 40 numbers, 10 drawn. KENO[picked][hits] is what it pays (96.7% to 97% back).
const KENO = {
  1: [0, 3.88], 2: [0, 1.75, 5.1], 3: [0, 0, 5.47, 18.3], 4: [0, 0, 2.22, 11.4, 19.1], 5: [0, 0, 1.07, 5.4, 21.9, 87.9],
  6: [0, 0, 0, 3, 15.2, 101, 509], 7: [0, 0, 0, 1.6, 8.2, 41.1, 197, 659], 8: [0, 0, 0, 1.02, 4.6, 20.1, 93.9, 402, 1000],
  9: [0, 0, 0, 0.71, 2.8, 11.5, 46.3, 208, 695, 1000], 10: [0, 0, 0, 0.56, 1.9, 6.9, 24.9, 99.9, 399, 500, 1000],
};
// Cases: [Orbs inside, weight]. 97% back each.
const CASES = {
  pouch: { price: 100, items: [[10, 29786], [30, 25000], [60, 15000], [120, 10000], [300, 5000], [1000, 1500], [5000, 250], [25000, 40]] },
  chest: { price: 1000, items: [[100, 30579], [300, 25000], [700, 15000], [1500, 9000], [4000, 4000], [12000, 1200], [50000, 200], [250000, 30]] },
  vault: { price: 10000, items: [[1000, 22323], [4000, 25000], [8000, 15000], [15000, 9000], [40000, 3500], [120000, 1000], [400000, 150], [1000000, 40]] },
};
const INSTANT = {
  dice(b, r) {
    const bet = betOf(b.bet), t = Math.round(Number(b.target) * 100), over = b.over === true;
    const chance = (over ? 10000 - t : t) / 100;
    if (!(chance >= 1 && chance <= 95)) fail(400, 'Pick a win chance from 1% to 95%.');
    const roll = DRAW.dice(r), mult = Math.floor(CASINO_RTP * 100 / chance * 10000) / 10000;
    return { stake: bet, payout: (over ? roll >= t : roll < t) ? payOf(bet, mult) : 0, roll: roll / 100, mult };
  },
  limbo(b, r) {
    const bet = betOf(b.bet), t = Math.round(Number(b.target) * 100);
    if (!(t >= 101 && t <= CRASH_MAX * 100)) fail(400, 'Pick a target from 1.01x to 1,000x.');
    const res = DRAW.limbo(r);
    return { stake: bet, payout: Math.round(res * 100) >= t ? payOf(bet, t / 100) : 0, result: res };
  },
  coinflip(b, r) {
    const bet = betOf(b.bet), side = b.side;
    if (side !== 'h' && side !== 't') fail(400, 'Pick heads or tails.');
    const res = DRAW.coinflip(r);
    return { stake: bet, payout: res === side ? payOf(bet, 1.94) : 0, result: res };
  },
  rps(b, r) {
    const bet = betOf(b.bet), pick = b.pick;
    if (!['r', 'p', 's'].includes(pick)) fail(400, 'Pick rock, paper or scissors.');
    const house = DRAW.rps(r), beats = { r: 's', p: 'r', s: 'p' };
    return { stake: bet, payout: pick === house ? bet : beats[pick] === house ? payOf(bet, 1.91) : 0, house };
  },
  roulette(b, r) {
    const list = Array.isArray(b.bets) ? b.bets : [];
    if (!list.length || list.length > 60) fail(400, 'Put some chips on the table first.');
    let stake = 0;
    const bets = list.map(x => {
      const a = Number(x && x.a);
      if (!Number.isInteger(a) || a < 1) fail(400, 'Chips are whole numbers of Orbs.');
      stake += a;
      if (x.t === 'n') {
        const n = Number(x.n);
        if (!Number.isInteger(n) || n < 0 || n > 36) fail(400, 'That number isn\'t on the wheel.');
        return [36, m => m === n, a];
      }
      if (!own(ROULETTE_BETS, x.t)) fail(400, 'That bet isn\'t on the table.');
      return [ROULETTE_BETS[x.t][0], ROULETTE_BETS[x.t][1], a];
    });
    if (stake < BET_MIN || stake > BET_MAX) fail(400, 'Bets start at 10 Orbs in all.');
    const n = DRAW.roulette(r);
    return { stake, payout: Math.min(WIN_MAX, bets.reduce((s, [m, hit, a]) => s + (hit(n) ? m * a : 0), 0)), result: n };
  },
  slots(b, r) {
    const bet = betOf(b.bet);
    const reels = DRAW.slots(r), cherries = reels.filter(s => s === 'cherry').length;
    const mult = reels[0] === reels[1] && reels[1] === reels[2] ? SLOT_THREE[reels[0]] : cherries === 2 ? 1.5 : cherries === 1 ? 0.5 : 0;
    return { stake: bet, payout: payOf(bet, mult), reels, mult };
  },
  plinko(b, r) {
    const bet = betOf(b.bet), rows = Number(b.rows), risk = String(b.risk || '');
    if (!own(PLINKO, rows) || !own(PLINKO[rows], risk)) fail(400, 'Pick the rows and the risk.');
    const path = DRAW.plinko(r, { rows }), slot = path.reduce((a, x) => a + x, 0);
    const mult = PLINKO[rows][risk][slot];
    return { stake: bet, payout: payOf(bet, mult), path, slot, mult };
  },
  keno(b, r) {
    const bet = betOf(b.bet), picks = Array.isArray(b.picks) ? b.picks.map(Number) : [];
    if (picks.length < 1 || picks.length > 10 || new Set(picks).size !== picks.length || picks.some(n => !Number.isInteger(n) || n < 1 || n > 40)) fail(400, 'Pick 1 to 10 numbers from 1 to 40.');
    const drawn = DRAW.keno(r), hits = picks.filter(n => drawn.includes(n)).length, mult = KENO[picks.length][hits];
    return { stake: bet, payout: payOf(bet, mult), drawn, hits, mult };
  },
  cases(b, r) {
    const c = own(CASES, b.box) ? CASES[b.box] : null;
    if (!c) fail(400, 'Pick a case.');
    const i = DRAW.cases(r, c);
    return { stake: c.price, payout: Math.min(WIN_MAX, c.items[i][0]), item: i };
  },
  upgrader(b, r) {
    const bet = betOf(b.bet), t = Math.round(Number(b.target) * 100);
    if (!(t >= 110 && t <= 10000)) fail(400, 'Pick a target from 1.1x to 100x.');
    const chance = CASINO_RTP / (t / 100), roll = DRAW.upgrader(r);
    return { stake: bet, payout: roll < chance ? payOf(bet, t / 100) : 0, roll, chance };
  },
};
async function instantGame(env, me, game, b) {
  INSTANT[game](b, () => 0);                        // settings checked before anything is read
  for (let i = 0; i < 5; i++) {
    const { prof, u } = await readProfile(env, me);
    const f = fairFor(me.name, u), r = INSTANT[game](b, await fairR(env, f));   // this bet's numbers (Provably Fair)
    hasOrbs(u, r.stake);
    const c = casinoOf(u), count = dayCount(c);
    const done = await casinoCommit(env, me.name, prof, u, { delta: r.payout - r.stake, set: { ...count, fair: fairNext(f) }, stake: r.stake, paid: r.payout, win: r.payout - r.stake, game: true });
    if (done) { const { stake, payout, ...shown } = r; return { ok: true, game, stake, payout, orbs: done.orbs, left: CASINO_DAY - count.n, fair: await fairShown(env, f), ...shown }; }
  }
  fail(409, BUSY);
}

// ----- step games -----
const TOWER = { easy: [4, 1], medium: [3, 1], hard: [2, 1], expert: [3, 2] };   // [tiles in a row, bad ones in it]
const TOWER_ROWS = 8;
const CROSS = { easy: [0.9, 20], medium: [0.8, 20], hard: [0.7, 15], daredevil: [0.55, 12] };   // [chance to clear a lane, lanes]
const HILO_MAX = 60;   // moves in one game
const round4 = x => Math.floor(x * 10000) / 10000;
// a step game's numbers: from the seeds it started with (v4.67), or from its id (games from before)
const stepNumbers = (env, t) => (t.f ? fairR(env, t.f) : gameStream(env, t.id));
// What each game's settings are (kept on the ticket as p), and the replay of the moves so far: { lost (the move that
// lost, or null), k (good moves), mult (what cashing out pays per Orb bet), done (nothing left to do), shown (for the page) }
const STEP = {
  mines: {
    settings(b) { const m = Number(b.mines); if (!Number.isInteger(m) || m < 1 || m > 24) fail(400, 'Pick 1 to 24 mines.'); return { m }; },
    async replay(env, t, path) {
      const moves = Array.isArray(path) ? path.map(Number) : [];
      if (moves.length > 25 - t.p.m || new Set(moves).size !== moves.length || moves.some(x => !Number.isInteger(x) || x < 0 || x > 24)) fail(400, 'That isn\'t a move.');
      const mines = DRAW.mines(await stepNumbers(env, t), t.p);
      const lost = moves.findIndex(x => mines.includes(x)), k = lost < 0 ? moves.length : lost;
      let m = CASINO_RTP;
      for (let i = 0; i < k; i++) m *= (25 - i) / (25 - t.p.m - i);
      return { lost: lost < 0 ? null : lost, k, mult: round4(m), done: k === 25 - t.p.m, board: { mines } };
    },
  },
  towers: {
    settings(b) { if (!own(TOWER, b.level)) fail(400, 'Pick a difficulty.'); return { l: b.level }; },
    async replay(env, t, path) {
      const [cols, bad] = TOWER[t.p.l], moves = Array.isArray(path) ? path.map(Number) : [];
      if (moves.length > TOWER_ROWS || moves.some(x => !Number.isInteger(x) || x < 0 || x >= cols)) fail(400, 'That isn\'t a move.');
      const rows = DRAW.towers(await stepNumbers(env, t), { rows: TOWER_ROWS, cols, bad });
      const lost = moves.findIndex((x, i) => rows[i].includes(x)), k = lost < 0 ? moves.length : lost;
      return { lost: lost < 0 ? null : lost, k, mult: round4(CASINO_RTP * (cols / (cols - bad)) ** k), done: k === TOWER_ROWS, board: { rows } };
    },
  },
  cross: {
    settings(b) { if (!own(CROSS, b.level)) fail(400, 'Pick a difficulty.'); return { l: b.level }; },
    async replay(env, t, path) {
      const [p, lanes] = CROSS[t.p.l], n = Number(path);
      if (!Number.isInteger(n) || n < 0 || n > lanes) fail(400, 'That isn\'t a move.');
      const hits = DRAW.cross(await stepNumbers(env, t), { p, lanes });
      const lost = hits.slice(0, n).indexOf(true), k = lost < 0 ? n : lost;
      return { lost: lost < 0 ? null : lost, k, mult: round4(CASINO_RTP / p ** k), done: k === lanes, board: { hit: lost < 0 ? null : lost } };
    },
  },
  // Hi-Lo: the card after a move comes from an HMAC of the moves before it (both guesses draw the same card, a skip
  // draws a different one), so trying one move tells nothing about another. Same rank is a push: nothing won or lost.
  // A right guess on rank r pays 12 / (13 - r) going higher, 12 / (r - 1) going lower; the 3% comes off once at the end.
  hilo: {
    settings() { return {}; },
    async replay(env, t, path) {
      const moves = String(path || '');
      if (!/^[hls]*$/.test(moves) || moves.length > HILO_MAX) fail(400, 'That isn\'t a move.');
      const seed = t.f ? await serverSeed(env, t.f.u, t.f.e) : null;
      const card = async key => { if (seed) return hiloCard(seed, t.f.c, t.f.n, key); const h = await hmacBytes(env, 'hilo:' + t.id + ':' + key); const x = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0; return { r: 1 + (x % 13), s: h[4] % 4 }; };
      let key = '', cur = await card(''), m = 1, k = 0;
      const cards = [cur];
      for (let i = 0; i < moves.length; i++) {
        const mv = moves[i];
        if ((mv === 'h' && cur.r === 13) || (mv === 'l' && cur.r === 1)) fail(400, 'That isn\'t a move.');
        key += mv === 's' ? 's' : 'g';
        const next = await card(key);
        cards.push(next);
        if (mv === 'h' && next.r < cur.r) return { lost: i, k, mult: 0, done: false, board: { cards } };
        if (mv === 'l' && next.r > cur.r) return { lost: i, k, mult: 0, done: false, board: { cards } };
        if (mv === 'h' && next.r > cur.r) { m *= 12 / (13 - cur.r); k++; }
        if (mv === 'l' && next.r < cur.r) { m *= 12 / (cur.r - 1); k++; }
        cur = next;
      }
      return { lost: null, k, mult: k ? round4(CASINO_RTP * m) : 0, done: moves.length >= HILO_MAX, board: { cards } };
    },
  },
};
// what the page sees of a replay: the whole board only once the game is over
function stepShown(game, res, over) {
  if (game === 'hilo') return { cards: res.board.cards };
  return over ? res.board : {};
}
async function stepGame(env, me, game, action, b) {
  if (action === 'start') return stepStart(env, me, game, b);
  if (action === 'resume') return resumeOpen(env, me, game);
  const t = await unseal(env, b.ticket);
  if (t.u !== me.name || t.g !== game) fail(400, 'That game is over.');
  const res = await STEP[game].replay(env, t, b.path);
  if (res.lost !== null) return closeStep(env, me, t, 0, res);
  if (action === 'step') {
    if (res.done) return closeStep(env, me, t, res.k ? payOf(t.b, res.mult) : 0, res);
    return { ok: true, k: res.k, mult: res.mult, ...stepShown(game, res, false) };
  }
  if (action === 'cashout') {
    if (!res.k) fail(400, 'Make a move first.');
    return closeStep(env, me, t, payOf(t.b, res.mult), res);
  }
  fail(400, 'That isn\'t a move.');
}
async function stepStart(env, me, game, b) {
  const bet = betOf(b.bet), p = STEP[game].settings(b);
  for (let i = 0; i < 5; i++) {
    const { prof, u } = await readProfile(env, me);
    const c = casinoOf(u), stale = await staleCrash(env, c.open);
    if (c.open && !stale) fail(409, openNote(c.open));
    hasOrbs(u, bet - (stale ? stale.payout : 0));
    const count = dayCount(c), id = newGameId(), f = fairFor(me.name, u);
    const open = { id, g: game, b: bet, p, f, at: Date.now() };
    const paid = stale ? stale.payout : 0;
    const done = await casinoCommit(env, me.name, prof, u, { delta: paid - bet, set: { ...count, open, fair: fairNext(f) }, stake: bet, paid, game: true });
    if (!done) continue;
    const ticket = await seal(env, { id, g: game, b: bet, p, u: me.name, f });
    const first = game === 'hilo' ? stepShown(game, await STEP.hilo.replay(env, { id, p, f }, ''), false) : {};
    return { ok: true, ticket, bet, p, orbs: done.orbs, left: CASINO_DAY - count.n, ...first };
  }
  fail(409, BUSY);
}
// Ends a step game: pays what it pays (0 for a loss) if it's still the open game; shows the board.
async function closeStep(env, me, t, payout, res) {
  for (let i = 0; i < 5; i++) {
    const { prof, u } = await readProfile(env, me);
    const open = casinoOf(u).open;
    if (!open || open.id !== t.id) {
      if (payout) fail(409, 'That game is already over.');
      return { ok: true, over: true, lost: res.lost, payout: 0, ...stepShown(t.g, res, true) };
    }
    const done = await casinoCommit(env, me.name, prof, u, { delta: payout, set: { open: null }, paid: payout, win: payout - t.b });
    if (done) return { ok: true, over: true, lost: res.lost, k: res.k, mult: res.mult, payout, orbs: done.orbs, fair: await fairShown(env, t.f), p: t.p, ...stepShown(t.g, res, true) };
  }
  fail(409, BUSY);
}
const GAME_NAMES = { mines: 'Mines', towers: 'Towers', hilo: 'Hi-Lo', cross: 'Crossing', blackjack: 'Blackjack', crash: 'Crash' };
const openNote = open => `You have a ${GAME_NAMES[open.g] || 'casino'} game going. Finish it first.`;
// The open game, picked up again (another tab, or after a reload): a new ticket for step games.
async function resumeOpen(env, me, game, u) {
  if (!u) u = (await readProfile(env, me)).u;
  const open = casinoOf(u).open;
  if (!open || (game && open.g !== game)) return { ok: true, open: null };
  const out = { g: open.g, b: open.b, p: open.p || {}, at: open.at };
  if (own(STEP, open.g)) out.ticket = await seal(env, { id: open.id, g: open.g, b: open.b, p: open.p || {}, u: me.name, f: open.f });
  if (open.g === 'blackjack') Object.assign(out, await bjShown(env, open, false));
  if (open.g === 'crash') Object.assign(out, { id: open.id, startAt: open.at, auto: open.auto || 0, now: Date.now(), rate: CRASH_RATE });
  return { ok: true, open: out };
}
// Giving up the open game: the bet stays lost. (A Crash round can't be given up; it ends on its own.)
async function forfeit(env, me) {
  for (let i = 0; i < 5; i++) {
    const { prof, u } = await readProfile(env, me);
    const open = casinoOf(u).open;
    if (!open) return { ok: true, payout: 0 };
    const stale = await staleCrash(env, open);
    if (open.g === 'crash' && !stale) fail(409, 'A Crash round ends on its own.');
    const payout = stale ? stale.payout : 0;
    const done = await casinoCommit(env, me.name, prof, u, { delta: payout, set: { open: null }, paid: payout });
    if (done) return { ok: true, payout, orbs: done.orbs };
  }
  fail(409, BUSY);
}

// ----- Mega ticket (from LiquidType): 1,000 Orbs, one at a time, drawn 24 hours later; 1 in 100 wins 97,000 -----
async function megaTicket(env, me, action) {
  for (let i = 0; i < 5; i++) {
    const { prof, u } = await readProfile(env, me);
    const c = casinoOf(u), mega = c.mega && typeof c.mega === 'object' ? c.mega : null;
    if (action === 'buy') {
      if (mega) fail(409, 'You already have a Mega ticket.');
      hasOrbs(u, MEGA_PRICE);
      const count = dayCount(c), f = fairFor(me.name, u), ticket = { id: newGameId(), at: Date.now(), f };
      const done = await casinoCommit(env, me.name, prof, u, { delta: -MEGA_PRICE, set: { ...count, mega: ticket, fair: fairNext(f) }, stake: MEGA_PRICE, game: true });
      if (done) return { ok: true, mega: ticket, drawAt: ticket.at + MEGA_WAIT, orbs: done.orbs, left: CASINO_DAY - count.n };
    } else if (action === 'claim') {
      if (!mega) fail(404, 'You don\'t have a Mega ticket.');
      if (Date.now() < mega.at + MEGA_WAIT) fail(409, 'It isn\'t drawn yet.');
      const won = mega.f ? DRAW.mega(await fairR(env, mega.f), { chance: MEGA_CHANCE }) : (await gameStream(env, mega.id))() < MEGA_CHANCE, payout = won ? MEGA_PRIZE : 0;
      const done = await casinoCommit(env, me.name, prof, u, { delta: payout, set: { mega: null }, paid: payout, win: payout - MEGA_PRICE });
      if (done) return { ok: true, won, payout, orbs: done.orbs, fair: await fairShown(env, mega.f) };
    } else fail(400, 'That isn\'t a move.');
  }
  fail(409, BUSY);
}

// ----- Blackjack: 6 decks shuffled from the game's id. Dealer stands on all 17s, blackjack pays 3 to 2, double on the
// first two cards, the dealer checks for blackjack first. Cards are 0..51: c % 13 is the rank (0 is an ace), c / 13 the suit.
const bjTotal = cards => {
  let t = 0, aces = 0;
  for (const c of cards) { const r = c % 13; if (r === 0) { aces++; t += 11; } else t += Math.min(10, r + 1); }
  while (t > 21 && aces) { t -= 10; aces--; }
  return t;
};
async function bjDeal(env, open) {
  const shoe = DRAW.blackjack(open.f ? await fairR(env, open.f) : await gameStream(env, open.id));
  let i = 0;
  const p = [shoe[i++]], d = [shoe[i++]];
  p.push(shoe[i++]); d.push(shoe[i++]);
  for (const x of String(open.a || '')) if (x === 'h' || x === 'd') p.push(shoe[i++]);
  return { p, d, shoe, i };
}
// the dealer's turn, then what the hand pays per Orb staked
function bjFinish(h) {
  const d = h.d.slice();
  let i = h.i;
  if (bjTotal(h.p) <= 21) while (bjTotal(d) < 17) d.push(h.shoe[i++]);
  const pt = bjTotal(h.p), dt = bjTotal(d);
  return { d, mult: pt > 21 ? 0 : dt > 21 || pt > dt ? 2 : pt === dt ? 1 : 0 };
}
async function bjShown(env, open, over) {
  const h = await bjDeal(env, open);
  return { p: h.p, d: over ? h.d : [h.d[0]], total: bjTotal(h.p), canDouble: !open.a };
}
async function blackjack(env, me, action, b) {
  for (let i = 0; i < 5; i++) {
    const { prof, u } = await readProfile(env, me);
    const c = casinoOf(u), stale = await staleCrash(env, c.open);
    if (action === 'start') {
      if (c.open && !stale) fail(409, openNote(c.open));
      const bet = betOf(b.bet);
      hasOrbs(u, bet - (stale ? stale.payout : 0));
      const count = dayCount(c), open = { id: newGameId(), g: 'blackjack', b: bet, a: '', f: fairFor(me.name, u), at: Date.now() };
      const h = await bjDeal(env, open), pt = bjTotal(h.p), dt = bjTotal(h.d), extra = stale ? stale.payout : 0;
      if (pt === 21 || dt === 21) {            // a blackjack on either side ends it now
        const payout = pt === 21 && dt === 21 ? bet : pt === 21 ? Math.floor(bet * 2.5) : 0;
        const done = await casinoCommit(env, me.name, prof, u, { delta: payout + extra - bet, set: { ...count, open: null, fair: fairNext(open.f) }, stake: bet, paid: payout + extra, win: payout - bet, game: true });
        if (done) return { ok: true, over: true, p: h.p, d: h.d, total: pt, dealer: dt, payout, orbs: done.orbs, left: CASINO_DAY - count.n, fair: await fairShown(env, open.f) };
        continue;
      }
      const done = await casinoCommit(env, me.name, prof, u, { delta: extra - bet, set: { ...count, open, fair: fairNext(open.f) }, stake: bet, paid: extra, game: true });
      if (done) return { ok: true, p: h.p, d: [h.d[0]], total: pt, canDouble: true, orbs: done.orbs, left: CASINO_DAY - count.n };
      continue;
    }
    const open = c.open;
    if (!open || open.g !== 'blackjack') fail(409, 'That hand is over.');
    if (action === 'state') return { ok: true, ...(await bjShown(env, open, false)) };
    if (action === 'double' && open.a) fail(400, 'You can only double on your first two cards.');
    if (action !== 'hit' && action !== 'stand' && action !== 'double') fail(400, 'That isn\'t a move.');
    if (action === 'double') hasOrbs(u, open.b);
    const a = String(open.a || '') + (action === 'hit' ? 'h' : action === 'double' ? 'd' : 's');
    const h = await bjDeal(env, { ...open, a }), pt = bjTotal(h.p);
    if (action === 'hit' && pt < 21) {          // still going: the card drawn is saved before it's shown
      const done = await casinoCommit(env, me.name, prof, u, { set: { open: { ...open, a } } });
      if (done) return { ok: true, p: h.p, d: [h.d[0]], total: pt, canDouble: false };
      continue;
    }
    const stake = action === 'double' ? open.b * 2 : open.b, end = bjFinish(h), payout = Math.floor(stake * end.mult);
    const done = await casinoCommit(env, me.name, prof, u, { delta: payout - (action === 'double' ? open.b : 0), set: { open: null }, stake: action === 'double' ? open.b : 0, paid: payout, win: payout - stake });
    if (done) return { ok: true, over: true, p: h.p, d: end.d, total: pt, dealer: bjTotal(end.d), payout, orbs: done.orbs, fair: await fairShown(env, open.f) };
  }
  fail(409, BUSY);
}

// ----- Crash: the multiplier is e^(0.17 t); the round ends at the crash point (from the game's id), or pays the
// auto cash-out first if the crash point reaches it. Cash out any time before it crashes.
const crashMs = m => (Math.log(m) / CRASH_RATE) * 1000;          // ms after the start that the multiplier is m
const crashMultAt = ms => Math.floor(Math.exp(CRASH_RATE * Math.max(0, ms) / 1000) * 100) / 100;
async function crashOf(env, open) { return DRAW.crash(open.f ? await fairR(env, open.f) : await gameStream(env, open.id)); }
// when the round ends on its own (ms after the start), and what it pays then
async function crashEnd(env, open) {
  const point = await crashOf(env, open), auto = Number(open.auto) || 0;
  return auto && point >= auto ? { point, ms: crashMs(auto), payout: payOf(open.b, auto) } : { point, ms: crashMs(point), payout: 0 };
}
// an open Crash round that has already ended: { payout } (it gets settled with whatever comes next), else null
async function staleCrash(env, open) {
  if (!open || open.g !== 'crash') return null;
  const end = await crashEnd(env, open);
  return Date.now() >= open.at + end.ms + 250 ? end : null;
}
// where a round that's already settled crashed (null if that's not the last one)
const lastCrash = (u, id) => { const l = casinoOf(u).last; return l && l.id === id ? l.point : null; };
async function crashGame(env, me, action, b) {
  if (action === 'start') {
    const bet = betOf(b.bet), auto = b.auto ? Math.round(Number(b.auto) * 100) / 100 : 0;
    if (auto && !(auto >= 1.01 && auto <= CRASH_MAX)) fail(400, 'Auto cash out goes from 1.01x to 1,000x.');
    for (let i = 0; i < 5; i++) {
      const { prof, u } = await readProfile(env, me);
      const c = casinoOf(u), stale = await staleCrash(env, c.open);
      if (c.open && !stale) fail(409, openNote(c.open));
      hasOrbs(u, bet - (stale ? stale.payout : 0));
      const count = dayCount(c), open = { id: newGameId(), g: 'crash', b: bet, auto, f: fairFor(me.name, u), at: Date.now() + CRASH_LEAD };
      const paid = stale ? stale.payout : 0;
      const done = await casinoCommit(env, me.name, prof, u, { delta: paid - bet, set: { ...count, open, fair: fairNext(open.f) }, stake: bet, paid, game: true });
      if (done) return { ok: true, id: open.id, startAt: open.at, now: Date.now(), rate: CRASH_RATE, auto, orbs: done.orbs, left: CASINO_DAY - count.n };
    }
    fail(409, BUSY);
  }
  const id = String(b.id || '');
  if (action === 'watch') {
    // wait (up to 45 s at a time) for the round to end, then settle it
    const { u } = await readProfile(env, me), open = casinoOf(u).open;
    if (!open || open.id !== id) return { ok: true, over: true, point: lastCrash(u, id) };
    const end = await crashEnd(env, open), wait = open.at + end.ms + 60 - Date.now();
    if (wait > 45000) { await new Promise(r => setTimeout(r, 45000)); return { ok: true, over: false }; }
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    return settleCrash(env, me, id, null);
  }
  if (action === 'cashout') return settleCrash(env, me, id, Number(b.t));
  fail(400, 'That isn\'t a move.');
}
// Ends the round: a cash-out at `t` ms (what the page saw, at most 0.8 s before now, so slow connections aren't
// punished) if it hasn't crashed by then, else however it ends on its own.
async function settleCrash(env, me, id, t) {
  for (let i = 0; i < 5; i++) {
    const { prof, u } = await readProfile(env, me);
    const open = casinoOf(u).open;
    if (!open || open.id !== id || open.g !== 'crash') return { ok: true, over: true, point: lastCrash(u, id), gone: true };
    const end = await crashEnd(env, open), now = Date.now() - open.at;
    let payout, at = null;
    if (now >= end.ms) {                       // it already ended on its own: crashed, or reached the auto cash-out
      payout = end.payout;
      if (payout) at = Number(open.auto);
    } else if (t === null) {                   // (watch woke a little early) still going
      return { ok: true, over: false };
    } else {                                   // cashing out while it's still going
      if (now < 0) fail(409, 'It hasn\'t started yet.');
      at = crashMultAt(Number.isFinite(t) && t <= now && t >= now - 800 ? t : now);
      payout = payOf(open.b, at);
    }
    const done = await casinoCommit(env, me.name, prof, u, { delta: payout, set: { open: null, last: { id: open.id, point: end.point } }, paid: payout, win: payout - open.b });
    if (done) return { ok: true, over: true, point: end.point, at, payout, orbs: done.orbs, fair: await fairShown(env, open.f) };
  }
  fail(409, BUSY);
}

// ----- what the page needs when the Casino opens: games left today, the open game (with a ticket) and the Mega ticket.
async function casinoInfo(env, me) {
  const { u } = await readProfile(env, me);
  const r = await resumeOpen(env, me, '', u);
  const c = casinoOf(u), mega = c.mega && typeof c.mega === 'object' ? { at: c.mega.at, drawAt: c.mega.at + MEGA_WAIT } : null;
  const f = fairFor(me.name, u), fair = { ...(await fairShown(env, f)), n: f.n };
  return { ok: true, left: gamesLeft(c), open: r.open, mega, fair, stats: { games: c.games || 0, wagered: c.wagered || 0, won: c.won || 0, best: c.best || 0 } };
}
// Provably Fair (v4.67): game 'fair'. info: this seed's fingerprint, your client seed and the next nonce. rotate: show the
// server seed you've been using (so your bets on it can be checked) and start a new one, with a client seed you choose
// (or a new random one); not while a game is going. reveal: any earlier server seed, again (one you've moved on from).
const CLIENT_SEED = /^[A-Za-z0-9_-]{1,32}$/;
const randomClientSeed = () => hexOf(crypto.getRandomValues(new Uint8Array(8)));
async function fairRoute(env, me, action, b) {
  for (let i = 0; i < 5; i++) {
    const { prof, u } = await readProfile(env, me);
    const f = fairFor(me.name, u);
    if (action === 'info' || action === 'play') return { ok: true, ...(await fairShown(env, f)) };
    if (action === 'reveal') {
      const e = Number(b.e);
      if (!Number.isInteger(e) || e < 0 || e >= f.e) fail(400, 'That seed is still in use. Change seeds to see it.');
      const seed = await serverSeed(env, me.name, e);
      return { ok: true, e, seed, hash: await fairHash(seed) };
    }
    if (action !== 'rotate') fail(400, 'That isn\'t a move.');
    if (casinoOf(u).open) fail(409, 'Finish your game first.');
    if (b.client != null && !CLIENT_SEED.test(String(b.client))) fail(400, 'A client seed is 1 to 32 letters, digits, - or _.');
    const next = { e: f.e + 1, c: b.client != null ? String(b.client) : randomClientSeed(), n: 0 };
    const done = await casinoCommit(env, me.name, prof, u, { set: { fair: next } });
    if (!done) continue;
    const seed = await serverSeed(env, me.name, f.e);
    return { ok: true, old: { e: f.e, seed, hash: await fairHash(seed), c: f.c, n: f.n }, ...(await fairShown(env, { u: me.name, ...next })) };
  }
  fail(409, BUSY);
}

// ---------------- Referrals (v4.67, request 56) ----------------
// POST /api/admin/referral { token, action }. make { code }: your own code (3 to 16 letters and digits, kept in capitals;
// referralCodes/<CODE> = { u }, written only here). join { code }: a new account (made in the last day, no Casino games
// yet) says who brought it, never someone on the same device, computer or network (linkedAccounts). info: your code,
// how many joined with it and what it's earned you. What referrals pay comes in casinoCommit. refCode, referredBy and
// referral are written only by this server (supabase/sql/014_v467.sql).
const REF_CODE = /^[A-Za-z0-9]{3,16}$/, REF_JOIN_MS = 86400000;
async function referralRoute(env, b) {
  const me = await caller(env, b.token);
  slowDown('referral:' + me.name, 20);
  const action = String(b.action || 'info');
  const [prof] = await fsGetMany(env, [`users/${me.name}`]);
  const u = mine(prof, me), ref = u.referral && typeof u.referral === 'object' ? u.referral : {};
  const isNew = Date.now() - (Number(u.createdAt) || 0) < REF_JOIN_MS && !(Number(casinoOf(u).games) > 0);
  if (action === 'info') {
    return { ok: true, code: typeof u.refCode === 'string' ? u.refCode : null, friends: Number(ref.friends) || 0, earned: Number(ref.earned) || 0,
      referredBy: typeof u.referredBy === 'string' ? u.referredBy : null, canJoin: !u.referredBy && isNew };
  }
  if (action === 'make') {
    if (typeof u.refCode === 'string') fail(409, 'You already have a code: ' + u.refCode + '.');
    const code = String(b.code || '').trim().toUpperCase();
    if (!REF_CODE.test(code)) fail(400, 'A code is 3 to 16 letters and digits.');
    const done = await fsCommit(env, [
      { update: { name: docName(env, `referralCodes/${code}`), fields: { u: enc(me.name), at: enc(new Date()) } }, currentDocument: { exists: false } },
      { update: { name: docName(env, `users/${me.name}`), fields: { refCode: enc(code) } }, updateMask: { fieldPaths: ['refCode'] }, currentDocument: { updateTime: prof.updateTime } },
    ]);
    if (!done) fail(409, 'Someone already has that code. Try another one.');
    return { ok: true, code };
  }
  if (action === 'join') {
    if (u.referredBy) fail(409, 'You already joined with a code.');
    if (!isNew) fail(403, 'Codes are for new accounts, on their first day and before their first Casino game.');
    const code = String(b.code || '').trim().toUpperCase();
    const [rc] = REF_CODE.test(code) ? await fsGetMany(env, [`referralCodes/${code}`]) : [null];
    const owner = rc && typeof rc.data.u === 'string' && USERNAME.test(rc.data.u) ? rc.data.u : null;
    if (!owner) fail(404, 'That code isn\'t anyone\'s.');
    if (owner === me.name) fail(400, 'That\'s your own code.');
    if (await linkedAccounts(env, me.name, owner)) fail(403, 'A code can\'t be used on the same device or network as its owner.');
    const done = await fsCommit(env, [
      { update: { name: docName(env, `users/${me.name}`), fields: { referredBy: enc(owner) } }, updateMask: { fieldPaths: ['referredBy'] }, currentDocument: { updateTime: prof.updateTime } },
      { transform: { document: docName(env, `users/${owner}`), fieldTransforms: [{ fieldPath: 'referral.friends', increment: enc(1) }] }, currentDocument: { exists: true } },
    ]);
    if (!done) fail(409, BUSY);
    return { ok: true, referredBy: owner };
  }
  fail(400, 'That isn\'t a referral action.');
}

// ---------------- Loans (v4.64) ----------------
// POST /api/admin/loan { token, action, ... }. Someone asks another person for Orbs, to pay back within a time they
// pick (the two can talk the time over in their DMs, and the lender can change it when accepting). Accepting moves the
// Orbs at once. Nothing is ever taken back (the Owner's choice, 2026-11-15): paying back on time raises the borrower's
// credit, not paying back in time lowers it (twice as much), and bigger loans move it more. Paying back after that wins
// half of it back. loans/<id> is written only here (firestore.rules: the two people in it can read it). Each profile
// keeps credit, loanWith (everyone you've had a loan or a request with, so a profile only looks loans up when there
// are some) and loanNext (the soonest due date of a running loan, so the app knows when to ask for a check).
const LOAN_MIN = 10, LOAN_MAX = 1000000000;
const LOAN_TIMES = { '1h': 3600000, '1d': 86400000, '3d': 259200000, '7d': 604800000, '14d': 1209600000, '30d': 2592000000 };
const loanWeight = n => Math.max(1, Math.round(Math.log10(Math.max(10, n)) * 10 - 10));   // 100 Orbs: 10, 1,000: 20, 10,000: 30
// documents matching every [field, value], straight from the database (up to `limit`)
async function fsQuery(env, coll, where, limit = 100) {
  const ff = ([field, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: enc(value) } });
  const body = { structuredQuery: { from: [{ collectionId: coll }], where: where.length === 1 ? ff(where[0]) : { compositeFilter: { op: 'AND', filters: where.map(ff) } }, limit } };
  const r = await fetch(`${fsBase(env)}:runQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await googleToken(env) }, body: JSON.stringify(body) });
  if (r.status === 429) fail(503, OUT_OF_READS);
  if (!r.ok) fail(502, 'Could not read Frixion.');
  return (await r.json()).filter(x => x.document).map(x => ({ id: x.document.name.split('/').pop(), data: decFields(x.document.fields), updateTime: x.document.updateTime }));
}
// Accounts used on the same device (a browser), the same computer (two device records with one hardware fingerprint)
// or from the same network: what the Owner panel's Devices and IPs tabs show. Loans between them don't move credit,
// so nobody raises their own with an alt (v4.66, request 45).
async function devicesOf(env, coll, name) {
  const body = { structuredQuery: { from: [{ collectionId: coll }], where: { fieldFilter: { field: { fieldPath: 'accounts' }, op: 'ARRAY_CONTAINS', value: enc(name) } }, limit: 200 } };
  const r = await fetch(`${fsBase(env)}:runQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await googleToken(env) }, body: JSON.stringify(body) });
  if (r.status === 429) fail(503, OUT_OF_READS);
  if (!r.ok) fail(502, 'Could not read Frixion.');
  return (await r.json()).filter(x => x.document).map(x => decFields(x.document.fields));
}
async function linkedAccounts(env, a, b) {
  const [devA, devB, netA] = await Promise.all([devicesOf(env, 'devices', a), devicesOf(env, 'devices', b), devicesOf(env, 'ips', a)]);
  const has = d => Array.isArray(d.accounts) && d.accounts.includes(b);
  if (devA.some(has) || netA.some(has)) return true;
  const hwA = new Set(devA.map(d => d.hw).filter(h => typeof h === 'string' && h));
  return devB.some(d => typeof d.hw === 'string' && hwA.has(d.hw));
}
// How much paying a loan back raises credit: nothing between linked accounts, and less each time the same two people
// (either way round) have already paid one back in the last 30 days: half the second time, a third the third, and so on.
async function creditFactor(env, lender, borrower) {
  if (await linkedAccounts(env, lender, borrower)) return 0;
  const since = Date.now() - 30 * 86400000;
  const [a, b] = await Promise.all([fsQuery(env, 'loans', [['from', lender], ['to', borrower], ['status', 'paid']]), fsQuery(env, 'loans', [['from', borrower], ['to', lender], ['status', 'paid']])]);
  return 1 / (1 + [...a, ...b].filter(x => (Number(x.data.paidAt) || 0) >= since).length);
}
const loanUpdate = (env, id, fields, updateTime) => ({
  update: { name: docName(env, `loans/${id}`), fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encAny(v)])) },
  updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { updateTime },
});
// Orbs and the like onto a profile: [path, transforms] as one write
const profileTransform = (env, name, tf, updateTime) => ({ transform: { document: docName(env, `users/${name}`), fieldTransforms: tf }, currentDocument: updateTime ? { updateTime } : { exists: true } });
const loanShown = l => ({ id: l.id, from: l.data.from, to: l.data.to, amount: l.data.amount, paid: l.data.paid || 0, time: l.data.time, dueAt: l.data.dueAt || null,
  status: l.data.status, note: l.data.note || '', at: l.data.at, late: l.data.late === true });

async function loanRoute(env, b) {
  const me = await caller(env, b.token);
  const action = String(b.action || '');
  slowDown('loan:' + me.name, 30);
  if (action === 'ask') return loanAsk(env, me, b);
  if (action === 'answer') return loanAnswer(env, me, b);
  if (action === 'cancel') return loanCancel(env, me, b);
  if (action === 'pay') return loanPay(env, me, b);
  if (action === 'check') return loanCheck(env, me, b);
  if (action === 'gift') return orbGift(env, me, b);
  fail(400, 'That isn\'t a loan action.');
}
// Orb gifts (v4.68, request 68): any amount to anyone, alts included (the Owner's choice, 2026-11-18, the same as loans),
// never more than you have (infinite Orbs give without running out). A gift is kept with the loans (status 'gift'), so
// both people see it in the history on their profiles, and it never moves credit.
const GIFT_MAX = 1e300;
async function orbGift(env, me, { to, amount, note }) {
  const n = Number(amount);
  if (typeof to !== 'string' || !USERNAME.test(to) || to === me.name) fail(400, 'Pick someone to gift Orbs to.');
  if (!Number.isInteger(n) || n < 1 || n > GIFT_MAX) fail(400, 'Gift at least 1 Orb.');
  const text = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  for (let i = 0; i < 5; i++) {
    const [prof, them] = await fsGetMany(env, [`users/${me.name}`, `users/${to}`]);
    const u = mine(prof, me), inf = infinite(u);
    if (!them || them.data.terminated === true) fail(404, 'No account has that username.');
    if (!inf && (Number(u.orbs) || 0) < n) fail(402, 'You don\'t have that many Orbs.');
    const id = 'l' + Date.now().toString(36) + [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, '0')).join('');
    const gift = { from: me.name, to, amount: n, paid: n, time: 'gift', note: text, status: 'gift', at: Date.now() };
    const done = await fsCommit(env, [
      { update: { name: docName(env, `loans/${id}`), fields: Object.fromEntries(Object.entries(gift).map(([k, v]) => [k, encAny(v)])) }, currentDocument: { exists: false } },
      profileTransform(env, me.name, [...(inf ? [] : [{ fieldPath: 'orbs', increment: enc(-n) }]), { fieldPath: 'loanWith', appendMissingElements: { values: [enc(to)] } }], prof.updateTime),
      // (giftIn: the newest gift they got, so their app can say so once)
      { update: { name: docName(env, `users/${to}`), fields: { giftIn: encAny({ id, from: me.name, amount: n, at: gift.at }) } }, updateMask: { fieldPaths: ['giftIn'] },
        updateTransforms: [{ fieldPath: 'orbs', increment: enc(n) }, { fieldPath: 'loanWith', appendMissingElements: { values: [enc(me.name)] } }], currentDocument: { exists: true } },
    ]);
    if (done) return { ok: true, gift: loanShown({ id, data: gift }), orbs: inf ? Number(u.orbs) || 0 : orbsAfter(done, 1) };
  }
  fail(409, 'Frixion is busy. Try again.');
}
async function loanAsk(env, me, { to, amount, time, note }) {
  const n = Number(amount);
  if (typeof to !== 'string' || !USERNAME.test(to) || to === me.name) fail(400, 'Pick someone to ask.');
  if (!Number.isInteger(n) || n < LOAN_MIN || n > LOAN_MAX) fail(400, 'Ask for 10 to 1,000,000,000 Orbs.');
  if (!own(LOAN_TIMES, time)) fail(400, 'Pick when you\'ll pay it back.');
  const text = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const [prof, them] = await fsGetMany(env, [`users/${me.name}`, `users/${to}`]);
  mine(prof, me);
  if (!them) fail(404, 'No account has that username.');
  const id = 'l' + Date.now().toString(36) + [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, '0')).join('');
  const loan = { from: to, to: me.name, amount: n, paid: 0, time, dueIn: LOAN_TIMES[time], note: text, status: 'asked', at: Date.now() };
  const done = await fsCommit(env, [
    { update: { name: docName(env, `loans/${id}`), fields: Object.fromEntries(Object.entries(loan).map(([k, v]) => [k, encAny(v)])) }, currentDocument: { exists: false } },
    profileTransform(env, me.name, [{ fieldPath: 'loanWith', appendMissingElements: { values: [enc(to)] } }]),
    profileTransform(env, to, [{ fieldPath: 'loanWith', appendMissingElements: { values: [enc(me.name)] } }]),
  ]);
  if (!done) fail(409, 'Frixion is busy. Try again.');
  return { ok: true, loan: loanShown({ id, data: loan }) };
}
async function loanAnswer(env, me, { id, yes, time }) {
  if (typeof id !== 'string' || !/^l[a-z0-9]{6,30}$/.test(id)) fail(404, 'That loan isn\'t there.');
  for (let i = 0; i < 5; i++) {
    const [l, lender] = await fsGetMany(env, [`loans/${id}`, `users/${me.name}`]);
    const u = mine(lender, me);
    if (!l || l.data.from !== me.name) fail(404, 'That loan isn\'t there.');
    if (l.data.status !== 'asked') fail(409, 'That request was already answered.');
    l.id = id;
    if (!yes) {
      const done = await fsCommit(env, [loanUpdate(env, id, { status: 'denied', decidedAt: Date.now() }, l.updateTime)]);
      if (done) return { ok: true, loan: loanShown({ id, data: { ...l.data, status: 'denied' } }) };
      continue;
    }
    const t = own(LOAN_TIMES, time) ? time : l.data.time, dueIn = LOAN_TIMES[t] || LOAN_TIMES['1d'];
    const amount = Number(l.data.amount) || 0, inf = infinite(u);
    if (!inf && (Number(u.orbs) || 0) < amount) fail(402, `You don't have ${amount.toLocaleString('en-US')} Orbs to lend.`);
    const dueAt = Date.now() + dueIn;
    const done = await fsCommit(env, [
      loanUpdate(env, id, { status: 'active', time: t, dueIn, dueAt, decidedAt: Date.now() }, l.updateTime),
      profileTransform(env, me.name, [...(inf ? [] : [{ fieldPath: 'orbs', increment: enc(-amount) }]), { fieldPath: 'loanNext', minimum: enc(dueAt) }], lender.updateTime),
      profileTransform(env, l.data.to, [{ fieldPath: 'orbs', increment: enc(amount) }, { fieldPath: 'loanNext', minimum: enc(dueAt) }]),
    ]);
    if (done) return { ok: true, orbs: inf ? Number(u.orbs) || 0 : orbsAfter(done, 1), loan: loanShown({ id, data: { ...l.data, status: 'active', time: t, dueAt } }) };
  }
  fail(409, 'Frixion is busy. Try again.');
}
async function loanCancel(env, me, { id }) {
  if (typeof id !== 'string' || !/^l[a-z0-9]{6,30}$/.test(id)) fail(404, 'That loan isn\'t there.');
  const [l] = await fsGetMany(env, [`loans/${id}`]);
  if (!l || l.data.to !== me.name) fail(404, 'That loan isn\'t there.');
  if (l.data.status !== 'asked') fail(409, 'It was already answered.');
  const done = await fsCommit(env, [loanUpdate(env, id, { status: 'cancelled', decidedAt: Date.now() }, l.updateTime)]);
  if (!done) fail(409, 'Frixion is busy. Try again.');
  return { ok: true };
}
async function loanPay(env, me, { id, amount }) {
  if (typeof id !== 'string' || !/^l[a-z0-9]{6,30}$/.test(id)) fail(404, 'That loan isn\'t there.');
  let factor = null;   // (creditFactor, looked up once however many tries it takes)
  for (let i = 0; i < 5; i++) {
    const [l, prof] = await fsGetMany(env, [`loans/${id}`, `users/${me.name}`]);
    const u = mine(prof, me);
    if (!l || l.data.to !== me.name) fail(404, 'That loan isn\'t there.');
    if (l.data.status !== 'active') fail(409, l.data.status === 'paid' ? 'It\'s already paid back.' : 'That loan isn\'t running.');
    const total = Number(l.data.amount) || 0, paid = Number(l.data.paid) || 0, owed = total - paid;
    const want = amount == null ? owed : Math.floor(Number(amount));
    if (!(want >= 1)) fail(400, 'Pay at least 1 Orb.');
    const pay = Math.min(owed, want), inf = infinite(u);
    if (!inf && (Number(u.orbs) || 0) < pay) fail(402, 'You don\'t have that many Orbs.');
    const now = Date.now(), all = paid + pay >= total, late = l.data.late === true || now > (l.data.dueAt || 0);
    const w = loanWeight(total);
    let credit = 0;
    if ((late && l.data.late !== true) || all) {
      if (factor === null) factor = await creditFactor(env, l.data.from, me.name);
      if (late && l.data.late !== true && factor > 0) credit -= 2 * w;   // it went past its due date and no check had counted that yet
      if (all) credit += Math.round((late ? Math.ceil(w / 2) : w) * factor);   // paid back: all of it on time, half after the due date
    }
    const fields = { paid: paid + pay, ...(all ? { status: 'paid', paidAt: now } : {}), ...(late && l.data.late !== true ? { late: true } : {}) };
    const done = await fsCommit(env, [
      loanUpdate(env, id, fields, l.updateTime),
      profileTransform(env, me.name, [...(inf ? [] : [{ fieldPath: 'orbs', increment: enc(-pay) }]), ...(credit ? [{ fieldPath: 'credit', increment: enc(credit) }] : [])], prof.updateTime),
      profileTransform(env, l.data.from, [{ fieldPath: 'orbs', increment: enc(pay) }]),
    ]);
    if (done) return { ok: true, paid: pay, owed: owed - pay, done: all, credit, late, orbs: inf ? Number(u.orbs) || 0 : orbsAfter(done, 1) };
  }
  fail(409, 'Frixion is busy. Try again.');
}
// Looks over your loans (both ways): any past its due date and not paid back costs the borrower credit, once. Also
// returns them, newest first, for the page (with someone: only the ones between you two).
async function loanCheck(env, me, { with: other }) {
  const [prof] = await fsGetMany(env, [`users/${me.name}`]);
  mine(prof, me);
  const [mineOut, mineIn] = await Promise.all([fsQuery(env, 'loans', [['from', me.name]]), fsQuery(env, 'loans', [['to', me.name]])]);
  const all = [...mineOut, ...mineIn], now = Date.now();
  let next = null;
  for (const l of all) {
    const d = l.data;
    if (d.status === 'active' && !d.late && now > (d.dueAt || 0)) {
      const w = loanWeight(Number(d.amount) || 0);
      const alt = await linkedAccounts(env, d.from, d.to);   // (between linked accounts credit doesn't move, v4.66)
      const done = await fsCommit(env, [
        loanUpdate(env, l.id, { late: true }, l.updateTime),
        ...(alt ? [] : [profileTransform(env, d.to, [{ fieldPath: 'credit', increment: enc(-2 * w) }])]),
      ]);
      if (done) d.late = true;
    }
    if (d.status === 'active' && now <= (d.dueAt || 0) && (next === null || d.dueAt < next)) next = d.dueAt;
  }
  // the soonest due date still to come, so the app knows when to ask again
  const want = next === null ? null : next;
  if ((prof.data.loanNext || null) !== want) {
    await fsCommit(env, [{ update: { name: docName(env, `users/${me.name}`), fields: want === null ? {} : { loanNext: enc(want) } }, updateMask: { fieldPaths: ['loanNext'] } }]).catch(() => null);
  }
  const shown = all.filter(l => !other || l.data.from === other || l.data.to === other).map(loanShown).sort((a, b) => b.at - a.at).slice(0, 40);
  return { ok: true, loans: shown };
}

// ---------------- Grow a Garden trades (v4.69, request 65) ----------------
// POST /api/admin/gagtrade { token, action, ... }. gardenTrades/<id> = { from, to, give, want, note, status, at, fromDone }
// (give and want: { seeds: { id: count }, sprinklers: { id: count } }); only this route writes them, and the two people
// in a trade can read it (supabase/sql/015). The items themselves stay in each person's backpack (tb.ggBackpack on their
// profile, which their own app saves), so two apps never write one backpack at once:
//   offer   the sender's app takes the give items out of its backpack once this says yes (the trade holds them);
//   accept  the receiver's app swaps both sides in its own backpack once this says yes;
//   decline / cancel   nothing moves on the receiver's side;
//   collect the sender's app gets what the trade owes it, once: the want items (accepted) or its own back (declined),
//           and fromDone stops a second app collecting again. A cancel is collected at once.
// Each person's app is told through ggTradeIn on their profile ({ at, from, kind }). Checks against the saved backpacks
// are only as good as the backpacks (a page can write its own), as with the rest of the garden.
const TRADE_KINDS = ['seeds', 'sprinklers'];
const TRADE_OPEN_MAX = 20;
function tradeItems(x) {
  const out = { seeds: {}, sprinklers: {} };
  if (x == null) return out;
  if (typeof x !== 'object' || Array.isArray(x)) return null;
  let n = 0;
  for (const kind of TRADE_KINDS) {
    const m = x[kind] == null ? {} : x[kind];
    if (typeof m !== 'object' || Array.isArray(m)) return null;
    for (const [id, c] of Object.entries(m)) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || !Number.isInteger(c) || c < 1 || c > 999 || ++n > 20) return null;
      out[kind][id] = c;
    }
  }
  return out;
}
const tradeEmpty = t => TRADE_KINDS.every(k => !Object.keys(t[k]).length);
const backpackOf = u => { const b = u && u.tb && u.tb.ggBackpack; return b && typeof b === 'object' ? b : {}; };
const hasItems = (bp, t) => TRADE_KINDS.every(k => Object.entries(t[k]).every(([id, c]) => (Number((bp[k] || {})[id]) || 0) >= c));
const tradeShown = (id, d) => ({ id, from: d.from, to: d.to, give: d.give || {}, want: d.want || {}, note: d.note || '', status: d.status, at: d.at, fromDone: d.fromDone === true });
const tradeNote = (env, name, from, kind) => ({ update: { name: docName(env, `users/${name}`), fields: { ggTradeIn: encAny({ at: Date.now(), from, kind }) } },
  updateMask: { fieldPaths: ['ggTradeIn'] }, currentDocument: { exists: true } });
const tradeSet = (env, id, fields, updateTime) => ({ update: { name: docName(env, `gardenTrades/${id}`), fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encAny(v)])) },
  updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { updateTime } });
async function gardenTrade(env, b) {
  const me = await caller(env, b.token);
  slowDown('gagtrade:' + me.name, 30);
  const action = String(b.action || '');
  if (action === 'offer') {
    const to = b.to, give = tradeItems(b.give), want = tradeItems(b.want), note = String(b.note || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (typeof to !== 'string' || !USERNAME.test(to) || to === me.name) fail(400, 'Pick someone to trade with.');
    if (!give || !want || (tradeEmpty(give) && tradeEmpty(want))) fail(400, 'Pick what to give and what you want.');
    const [prof, them] = await fsGetMany(env, [`users/${me.name}`, `users/${to}`]);
    const u = mine(prof, me);
    if (!them || them.data.terminated === true) fail(404, 'No account has that username.');
    if (them.data.hideGarden === true) fail(403, 'They keep their garden private, so they can\'t be offered trades.');   // (v4.70, request 80)
    if (!hasItems(backpackOf(u), give)) fail(409, 'Your backpack doesn\'t have all of that.');
    const open = await fsQuery(env, 'gardenTrades', [['from', me.name], ['status', 'open']], TRADE_OPEN_MAX + 1);
    if (open.length >= TRADE_OPEN_MAX) fail(429, `You have ${TRADE_OPEN_MAX} offers waiting already. Cancel one first.`);
    const id = 't' + Date.now().toString(36) + [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, '0')).join('');
    const d = { from: me.name, to, give, want, note, status: 'open', at: Date.now(), fromDone: false };
    const done = await fsCommit(env, [
      { update: { name: docName(env, `gardenTrades/${id}`), fields: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, encAny(v)])) }, currentDocument: { exists: false } },
      tradeNote(env, to, me.name, 'offer'),
    ]);
    if (!done) fail(409, 'Frixion is busy. Try again.');
    return { ok: true, trade: tradeShown(id, d) };
  }
  const id = String(b.id || '');
  if (!/^t[a-z0-9]{6,30}$/.test(id)) fail(404, 'That trade isn\'t there.');
  for (let i = 0; i < 4; i++) {
    const [t, prof] = await fsGetMany(env, [`gardenTrades/${id}`, `users/${me.name}`]);
    const u = mine(prof, me);
    if (!t || (t.data.from !== me.name && t.data.to !== me.name)) fail(404, 'That trade isn\'t there.');
    const d = t.data, mineOut = d.from === me.name;
    let fields, note = null;
    if (action === 'accept' || action === 'decline') {
      if (mineOut) fail(403, 'Only the other person can answer it.');
      if (d.status !== 'open') fail(409, 'That trade was already answered.');
      if (action === 'accept' && !hasItems(backpackOf(u), tradeItems(d.want) || { seeds: {}, sprinklers: {} })) fail(409, 'Your backpack doesn\'t have what they want any more.');
      fields = { status: action === 'accept' ? 'accepted' : 'declined', decidedAt: Date.now() };
      note = tradeNote(env, d.from, me.name, fields.status);
    } else if (action === 'cancel') {
      if (!mineOut) fail(403, 'Only who sent it can take it back.');
      if (d.status !== 'open') fail(409, 'They already answered it.');
      fields = { status: 'cancelled', decidedAt: Date.now(), fromDone: true };
    } else if (action === 'collect') {
      if (!mineOut) fail(403, 'That trade isn\'t yours to collect.');
      if (d.status !== 'accepted' && d.status !== 'declined') fail(409, 'Nothing to collect yet.');
      if (d.fromDone === true) fail(409, 'Already collected.');
      fields = { fromDone: true };
    } else fail(400, 'That isn\'t a trade action.');
    const done = await fsCommit(env, [tradeSet(env, id, fields, t.updateTime), ...(note ? [note] : [])]);
    if (done) return { ok: true, trade: tradeShown(id, { ...d, ...fields }) };
  }
  fail(409, 'Frixion is busy. Try again.');
}

// ---------------- webhooks (v4.69, request 50) ----------------
// POST /api/webhooks/<server>/<webhook>/<token> (functions/api/webhooks) with JSON shaped like Discord's, { content,
// username, avatar_url }, posts a message in the webhook's channel as the webhook. The webhook lives at
// servers/<sid>/webhooks/<id>, made by someone with Manage Webhooks (supabase/sql/015); only the SHA-256 of its token
// is kept, so nobody reading the database can post with it. 30 posts a minute per webhook.
const HOOK_ID = /^[A-Za-z0-9_-]{1,64}$/;
async function webhookPost(env, request, parts) {
  if (request.method !== 'POST') fail(405, 'Post to it with a message: {"content": "hi"}.');
  const [sid, wid, token, extra] = parts;
  if (!HOOK_ID.test(sid || '') || !HOOK_ID.test(wid || '') || !/^[0-9a-f]{64}$/.test(token || '') || extra) fail(404, 'Unknown webhook.');
  slowDown('hook:' + sid + '/' + wid, 30);
  const body = await request.json().catch(() => null);
  const text = body && typeof body.content === 'string' ? body.content.trim().slice(0, 4000) : '';
  if (!text) fail(400, 'Send some content: {"content": "hi"}.');
  const hook = await fsGet(env, `servers/${sid}/webhooks/${wid}`);
  if (!hook || hook.tokenHash !== await sha256Hex(token)) fail(404, 'Unknown webhook.');
  const cid = String(hook.channelId || '');
  if (!HOOK_ID.test(cid) || !(await fsGet(env, `servers/${sid}/channels/${cid}`))) fail(404, 'The webhook\'s channel is gone.');
  const named = body && typeof body.username === 'string' ? body.username.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) : '';
  const pic = body && typeof body.avatar_url === 'string' && /^https:\/\/\S{1,490}$/.test(body.avatar_url) ? body.avatar_url : '';
  const name = named || String(hook.name || 'Webhook').slice(0, 80);
  const avatar = pic || (/^https:\/\//.test(hook.avatarUrl || '') ? hook.avatarUrl : '');
  const mid = 'wh' + Date.now().toString(36) + [...crypto.getRandomValues(new Uint8Array(5))].map(x => x.toString(16).padStart(2, '0')).join('');
  const m = { uid: 'webhook:' + wid, username: name, ext: { src: 'webhook', id: wid, name, avatar }, createdAt: new Date(), text };
  const done = await fsCommit(env, [
    { update: { name: docName(env, `servers/${sid}/channels/${cid}/messages/${mid}`), fields: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, encAny(v)])) }, currentDocument: { exists: false } },
    { update: { name: docName(env, `servers/${sid}/channels/${cid}`), fields: { lastMessageAt: enc(new Date()), lastMessage: encAny({ uid: m.uid, text: text.slice(0, 200), everyone: false, mid }) } },
      updateMask: { fieldPaths: ['lastMessageAt', 'lastMessage'] }, currentDocument: { exists: true } },
  ]);
  if (!done) fail(409, 'Frixion is busy. Try again.');
  return { ok: true, id: mid, channel_id: cid };
}

// ---------------- moving to Supabase (the switch, 2026-11) ----------------
// The Owner panel's Supabase tab copies Frixion's documents from Firestore into Supabase, a page of one kind at a time.
// The kinds are the collection names in Supabase's own path table (fx_routes), except typing notes, which only last
// seconds. Firestore is read with the service account (each document copied is one of its daily reads; a count costs
// one read per 1,000 documents); Supabase is written with its secret key (SUPABASE_URL and SUPABASE_SECRET_KEY,
// Cloudflare secrets), which its rules let do anything, a whole document at a time, so copying a page again is
// harmless. (globalThis.fetch: on the Supabase branch, this file's fetch answers Firestore's requests from Supabase.)
const MOVE_SKIP = new Set(['typing']);
const moveToFx = v => ('nullValue' in v ? null : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? Number(v.doubleValue) : 'stringValue' in v ? v.stringValue : 'timestampValue' in v ? { $t: Date.parse(v.timestampValue) }
  : 'referenceValue' in v ? { $ref: String(v.referenceValue).replace(/^.*?\/documents\//, '') } : 'arrayValue' in v ? (v.arrayValue.values || []).map(moveToFx)
  : 'mapValue' in v ? moveFields(v.mapValue.fields) : (() => { throw new Error('it holds a ' + Object.keys(v)[0] + ', which Supabase has no place for'); })());
const moveFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, x]) => [k, moveToFx(x)]));
async function supabaseRpc(env, name, args) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) fail(503, 'Add SUPABASE_URL and SUPABASE_SECRET_KEY to this site in Cloudflare first.');
  const key = env.SUPABASE_SECRET_KEY;
  const r = await globalThis.fetch(`${String(env.SUPABASE_URL).replace(/\/+$/, '')}/rest/v1/rpc/${name}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key }, body: JSON.stringify(args) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error((j && j.message) || `Supabase answered ${r.status}`), { supabase: true, status: r.status });
  return j;
}
async function firestorePost(env, op, body) {
  const r = await globalThis.fetch(`${fsBase(env)}:${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await googleToken(env) }, body: JSON.stringify(body) });
  if (r.status === 429) fail(503, OUT_OF_READS);
  if (!r.ok) fail(502, `Firestore answered ${r.status}.`);
  return r.json();
}
let moveRoutes = null, moveOwner = null;   // (kept a few minutes: the tab asks for page after page)
async function move(env, { token, action, group, after, size }) {
  const claims = await verifyIdToken(env, token);
  if (!moveOwner || moveOwner.uid !== claims.sub || Date.now() - moveOwner.at > 300000) { await requireOwner(env, token); moveOwner = { uid: claims.sub, at: Date.now() }; }
  if (!moveRoutes || Date.now() - moveRoutes.at > 600000) {
    try { moveRoutes = { at: Date.now(), list: (await supabaseRpc(env, 'fx_routes', {})).map(r => r.pattern) }; }
    catch (e) { if (e.supabase) fail(502, 'Supabase didn\'t answer (' + e.message + '). Is its setup run?'); throw e; }
  }
  const routes = new Set(moveRoutes.list);
  const groups = [...new Set(moveRoutes.list.map(p => p.split('/').slice(-2, -1)[0]))].filter(g => !MOVE_SKIP.has(g)).sort();
  if (action === 'plan') {
    // (and any collection at the top that Supabase keeps nothing of, so nothing is left behind unseen)
    const tops = new Set(moveRoutes.list.map(p => p.split('/')[0]));
    const j = await firestorePost(env, 'listCollectionIds', { pageSize: 300 });
    return { groups, unknown: ((j && j.collectionIds) || []).filter(c => !tops.has(c)).sort() };
  }
  if (typeof group !== 'string' || !groups.includes(group)) fail(400, 'Supabase doesn\'t keep that kind of document.');
  const from = [{ collectionId: group, allDescendants: true }];   // every collection with that name, at any depth
  if (action === 'count') {
    const j = await firestorePost(env, 'runAggregationQuery', { structuredAggregationQuery: { structuredQuery: { from }, aggregations: [{ alias: 'n', count: {} }] } });
    const n = j && j[0] && j[0].result && j[0].result.aggregateFields && j[0].result.aggregateFields.n;
    return { group, count: n ? Number(n.integerValue) : 0 };
  }
  if (action !== 'copy') fail(400, 'That isn\'t a move action.');
  const take = Math.max(1, Math.min(300, Math.floor(Number(size) || 200))), root = docName(env, '');
  const q = { from, orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: take };
  if (after != null) {
    if (typeof after !== 'string' || !after.startsWith(root)) fail(400, 'That isn\'t a place to carry on from.');
    q.startAt = { values: [{ referenceValue: after }], before: false };   // (just after it)
  }
  const docs = (await firestorePost(env, 'runQuery', { structuredQuery: q })).filter(x => x.document).map(x => x.document);
  const writes = [], skipped = [];
  for (const d of docs) {
    const path = d.name.slice(root.length);
    if (!routes.has(path.split('/').map((s, i) => (i % 2 ? '*' : s)).join('/'))) { skipped.push(path + ': Supabase has no table for it'); continue; }
    try { writes.push({ path, set: moveFields(d.fields) }); } catch (e) { skipped.push(path + ': ' + e.message); }
  }
  let copied = 0;
  try {
    for (let i = 0; i < writes.length; i += 500) { await supabaseRpc(env, 'fx_commit', { writes: writes.slice(i, i + 500) }); copied += Math.min(500, writes.length - i); }
  } catch (e) {
    if (!e.supabase) throw e;
    // A page Supabase won't take is asked for again in smaller pages, down to the one document it won't take, which is
    // noted and passed over.
    if (writes.length > 1) return { group, retrySmaller: true, error: e.message };
    if (writes.length === 1) skipped.push(writes[0].path + ': ' + e.message);
  }
  return { group, read: docs.length, copied, skipped, last: docs.length ? docs[docs.length - 1].name : after || null, done: docs.length < take };
}
