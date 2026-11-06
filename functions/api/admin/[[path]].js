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
//                                 Co-Owners also redo someone else's after changing their rank.
//   GET  /api/admin/info          whether it's set up here (auth: "ready" once the service account may change sign-ins).
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
//
// SETUP, once: the service account the other functions use (frixion-functions) also needs the role "Firebase
// Authentication Admin": Google Cloud > IAM & Admin > IAM > the pencil next to frixion-functions > Add another role.
//
// For tests: FIRESTORE_URL with FIRESTORE_BEARER=owner (the Firestore emulator), AUTH_URL (the Auth emulator, which takes
// "owner" too) and TEST_TOKENS=1, which accepts the emulator's unsigned ID tokens. Never set TEST_TOKENS on a real site.
const PROJECT = 'liquidalt';
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const IDENTITY = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });
class Fail extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new Fail(status, message); };

export async function onRequest({ request, env, params }) {
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
    if (route === 'code' && request.method === 'POST') return json(await redeemCode(env, await request.json().catch(() => ({}))));
    return json({ error: 'Not found.' }, 404);
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong.' }, 500);
  }
}

async function info(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT && !env.FIRESTORE_BEARER) return { ready: false };
  try {
    const r = await authCall(env, 'accounts:query', { returnUserInfo: false, limit: 1 });
    if (r.ok) return { ready: true, auth: 'ready' };
    const why = await googleWhy(r);
    return { ready: true, auth: noRole(r, why) ? 'the service account needs the Firebase Authentication Admin role' : `Google said ${r.status}: ${why.slice(0, 200)}` };
  } catch (e) { return { ready: true, auth: e.message }; }
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
const dec = v => ('stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue
  : 'timestampValue' in v ? Date.parse(v.timestampValue) : 'mapValue' in v ? decFields(v.mapValue.fields) : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec) : 'nullValue' in v ? null : undefined);
const decFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, dec(v)]));
async function fsGet(env, path) {
  const r = await fetch(`${fsBase(env)}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: { Authorization: 'Bearer ' + await googleToken(env) } });
  if (r.status === 404) return null;
  if (!r.ok) fail(502, 'Could not read Frixion.');
  return decFields((await r.json()).fields);
}
const enc = v => (v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : { stringValue: String(v) });
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
async function ipId(env, ip) {
  if (!ipKey) {
    const secret = env.IP_KEY || (env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT).private_key : 'test-ip-key');
    const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('frixion-ip:' + secret));
    ipKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', ipKey, new TextEncoder().encode(ip.toLowerCase())));
  return 'ip_' + [...mac.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const ipLabel = ip => (ip.includes(':') ? ip.split(':').slice(0, 2).join(':') + ':…' : ip.split('.').slice(0, 2).join('.') + '.x.x');
// Is this address banned? Asked on every page load, so the answer is kept for a minute.
const banLooks = new Map();   // id -> { at, ban }
async function ipCheck(env, request) {
  const id = await ipId(env, callerIp(env, request));
  let hit = banLooks.get(id);
  if (!hit || Date.now() - hit.at > 60000) {
    hit = { at: Date.now(), ban: await fsGet(env, `bannedIps/${id}`) };
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

// ---------- who someone is, for the Realtime Database ----------
const rankOf = u => (u.owner === true ? 3 : u.coowner === true ? 2 : u.op === true ? 1 : 0);
async function setClaims(env, { token, username }) {
  const claims = await verifyIdToken(env, token);
  const acct = await fsGet(env, `accounts/${claims.sub}`);
  const myName = acct && typeof acct.username === 'string' ? acct.username : null;
  const me = myName ? await fsGet(env, `users/${myName}`) : null;
  if (!me || me.authUid !== claims.sub) fail(403, 'That sign-in isn\'t a Frixion account.');
  let name = myName, target = me;
  if (username != null && username !== myName) {
    if (rankOf(me) < 2) fail(403, 'Only the Owner can do that.');
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{1,40}$/.test(username)) fail(400, 'That isn\'t a username.');
    target = await fsGet(env, `users/${username}`);
    if (!target) fail(404, 'No account has that username.');
    if (typeof target.authUid !== 'string' || !target.authUid) return { ok: true, skipped: 'no sign-in yet' };
    name = username;
  }
  const want = { n: name, r: rankOf(target) };
  const r = await authCall(env, 'accounts:update', { localId: target.authUid, customAttributes: JSON.stringify(want) });
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
const utcDay = () => new Date().toISOString().slice(0, 10);
const nextUtcDay = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

// several documents in one read: { data, updateTime } for each path (null if it isn't there), in the same order
async function fsGetMany(env, paths) {
  const names = paths.map(p => docName(env, p));
  const r = await fetch(`${fsBase(env)}:batchGet`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await googleToken(env) },
    body: JSON.stringify({ documents: names }) });
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

// Orbs from games: up to EARN_CAP a day per account; whatever is past that isn't added.
async function earn(env, { token, n }) {
  const me = await caller(env, token);
  const want = Math.floor(Number(n));
  if (!(want >= 1)) fail(400, 'Nothing to add.');
  slowDown('earn:' + me.name, 40);
  for (let i = 0; i < 6; i++) {
    const [prof, day] = await fsGetMany(env, [`users/${me.name}`, `orbDays/${me.name}`]);
    mine(prof, me);
    const today = utcDay(), got = day && day.data.day === today ? Math.max(0, Number(day.data.got) || 0) : 0;
    const add = Math.min(want, EARN_CAP - got);
    if (add <= 0) return { added: 0, left: 0, cap: EARN_CAP, resetsAt: nextUtcDay() };
    const done = await fsCommit(env, [
      { update: { name: docName(env, `orbDays/${me.name}`), fields: { day: enc(today), got: enc(got + add), at: enc(new Date()) } },
        currentDocument: day ? { updateTime: day.updateTime } : { exists: false } },
      { transform: { document: docName(env, `users/${me.name}`), fieldTransforms: [{ fieldPath: 'orbs', increment: enc(add) }] }, currentDocument: { exists: true } },
    ]);
    if (done) return { added: add, left: EARN_CAP - got - add, cap: EARN_CAP, resetsAt: nextUtcDay(), orbs: orbsAfter(done, 1) };
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
    if ((Number(u.orbs) || 0) < price) fail(402, 'Not enough Orbs. Play games to earn more.');
    // paid, owned and worn at once (like Discord's shop), only if the profile is still what was read
    const done = await fsCommit(env, [{
      update: { name: docName(env, `users/${me.name}`), fields: { [equip]: enc(id) } }, updateMask: { fieldPaths: [equip] },
      updateTransforms: [{ fieldPath: 'orbs', increment: enc(-price) }, { fieldPath: owned, appendMissingElements: { values: [enc(id)] } }],
      currentDocument: { updateTime: prof.updateTime },
    }]);
    if (done) return { ok: true, price, orbs: orbsAfter(done, 0) };
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
    const writes = [{
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
