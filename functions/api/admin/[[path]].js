// Owner tools that need Google's admin powers, which no page has. A Cloudflare Pages Function, served at /api/admin/* on
// the main site (frixionbeta, which has the FIREBASE_SERVICE_ACCOUNT secret); Frixion calls it there.
//   POST /api/admin/set-password  { token, username, password }: the Owner sets someone's password, for someone who
//                                 can't log in. token is the caller's Firebase ID token, and only the account with
//                                 owner: true may do this. The person is signed out everywhere and logs in with their
//                                 username and the new password (the same made-up email and "frixion:" password as
//                                 everyone: see AUTH in script.js).
//   GET  /api/admin/info          whether it's set up here (auth: "ready" once the service account may change sign-ins).
//
// SETUP, once: the service account the other functions use (frixion-functions) also needs the role "Firebase
// Authentication Admin": Google Cloud > IAM & Admin > IAM > the pencil next to frixion-functions > Add another role.
//
// For tests: FIRESTORE_URL with FIRESTORE_BEARER=owner (the Firestore emulator), AUTH_URL (the Auth emulator, which takes
// "owner" too) and TEST_TOKENS=1, which accepts the emulator's unsigned ID tokens. Never set TEST_TOKENS on a real site.
const PROJECT = 'liquidalt';
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const IDENTITY = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;
const AUTH_EMAIL_DOMAIN = 'u.frixionbeta.pages.dev';
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
    if (route === 'set-password' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));   // sent as text/plain, so other sites can call it without a preflight
      return json(await setPassword(env, body));
    }
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
    return { ready: true, auth: r.ok ? 'ready' : `the service account can't manage sign-ins (${r.status}): give it the Firebase Authentication Admin role` };
  } catch (e) { return { ready: true, auth: e.message }; }
}

// ---------------- signing in as Frixion (the service account) ----------------
const tokens = new Map();   // scope -> { value, until }
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = s => b64url(new TextEncoder().encode(s));
const unb64url = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - String(s).length % 4) % 4)), c => c.charCodeAt(0));
async function googleToken(env) {
  if (env.FIRESTORE_BEARER) return env.FIRESTORE_BEARER;
  const scope = 'https://www.googleapis.com/auth/cloud-platform', hit = tokens.get(scope);
  if (hit && hit.until > Date.now() + 60000) return hit.value;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT), now = Math.floor(Date.now() / 1000);
  const head = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
  const claims = b64urlText(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const der = Uint8Array.from(atob(String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claims)));
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

// ---------------- setting a password ----------------
const authEmail = username => [...new TextEncoder().encode(username)].map(b => b.toString(16).padStart(2, '0')).join('') + '@' + AUTH_EMAIL_DOMAIN;
async function setPassword(env, { token, username, password }) {
  await requireOwner(env, token);
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{1,40}$/.test(username)) fail(400, 'That isn\'t a username.');
  if (typeof password !== 'string' || password.length < 4 || password.length > 100) fail(400, 'Passwords need 4 to 100 characters.');
  const target = await fsGet(env, `users/${username}`);
  if (!target) fail(404, 'No account has that username.');
  if (typeof target.authUid !== 'string' || !target.authUid) fail(409, 'That account has no sign-in yet.');
  // The username's made-up email goes on too, so an account that only used Google can then log in with its username.
  // (validSince: everywhere they were signed in is signed out)
  const r = await authCall(env, 'accounts:update', { localId: target.authUid, email: authEmail(username), password: 'frixion:' + password, validSince: String(Math.floor(Date.now() / 1000)) });
  if (!r.ok) {
    const j = await r.json().catch(() => ({})), why = String((j.error && j.error.message) || r.status);
    if (/EMAIL_EXISTS/.test(why)) fail(409, 'Another sign-in already uses this username\'s login. Ask for help to clear it.');
    if (/USER_NOT_FOUND/.test(why)) fail(404, 'That account\'s sign-in is gone.');
    if (r.status === 403) fail(503, 'The service account can\'t change sign-ins yet: give it the Firebase Authentication Admin role.');
    fail(502, 'Google refused (' + why + ').');
  }
  return { ok: true };
}
