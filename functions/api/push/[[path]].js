// Push notifications: a phone or computer gets a notification for a new message even when Frixion is closed (Web Push:
// iPhones from the home screen app, Android and computer browsers). A Cloudflare Pages Function, served at
// /api/push/* on the main site (frixionbeta); every copy of Frixion calls it there.
//   POST /api/push/send   the sender's Frixion calls this right after a message goes into a DM, a group or a channel.
//                         It works out who should hear about it, the way Frixion's own notifications do (the others in a
//                         DM or group; in a channel, whoever is mentioned or replied to, and @everyone in a channel
//                         everyone can see), and sends each of their devices a notification.
//   GET  /api/push/info   whether push is set up here.
// Each device that turned notifications on has a pushSubs/{id} doc: { uid, endpoint, p256dh, auth, muted, at }, where
// muted lists the chats that device muted ("dm:<id>", "gdm:<id>", "ch:<channel id>"). The service worker (/sw.js) shows
// what arrives.
//
// SETUP, once: Cloudflare > Workers & Pages > frixionbeta > Settings > Variables and Secrets: add a Secret called
// VAPID_PRIVATE_KEY with the private key (a JSON web key; it's kept off the repo, see D:\Downloads\frixion-push-key on
// the owner's computer), then redeploy. Its public half is VAPID_PUBLIC in script.js. Changing the key means everyone
// turns notifications on again.
//
// Frixion's database is open to every visitor, so a request is only trusted as far as the database backs it up: the
// message has to exist, be by the sender named, be new, and each message is only sent once (the first request claims
// it). Notifications are encrypted for each device (RFC 8291) and signed with the key (VAPID, RFC 8292).
// For tests, FIRESTORE_URL and FIREBASE_KEY can point at the Firebase emulator.
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/liquidalt/databases/(default)/documents';
const FIREBASE_KEY = 'AIzaSyCaDVRWLOSgC_Nl0YOeoG86G_hd_LKdW2U';   // the site's public web key
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });
class Fail extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new Fail(status, message); };

export async function onRequest({ request, env, params }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const route = [].concat(params.path || []).join('/');
  try {
    if (route === 'info' && request.method === 'GET') return json(await info(env));
    if (!env.VAPID_PRIVATE_KEY) fail(503, 'Push notifications aren\'t set up on this site yet.');
    if (route === 'send' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));   // sent as text/plain, so other sites can call it without a preflight
      return json(await send(env, body, new URL(request.url).origin));
    }
    return json({ error: 'Not found.' }, 404);
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Push notifications hit a problem.' }, 500);
  }
}

// Ready only once the key works: signing a token with it proves it was pasted whole. key is its public half, to compare
// with VAPID_PUBLIC in script.js.
async function info(env) {
  if (!env.VAPID_PRIVATE_KEY) return { ready: false };
  try {
    await vapid(env, 'https://push.example/');
    return { ready: true, key: signer.pub };
  } catch (e) {
    return { ready: false, error: 'VAPID_PRIVATE_KEY is there but isn\'t a working key. Paste everything in VAPID_PRIVATE_KEY.txt again.' };
  }
}

// ---------------- Frixion's database, through Firestore's REST API ----------------
const fsBase = env => env.FIRESTORE_URL || FIRESTORE;
const fsKey = env => encodeURIComponent(env.FIREBASE_KEY || FIREBASE_KEY);
const docPath = p => p.split('/').map(encodeURIComponent).join('/');
const dec = v => ('stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue
  : 'timestampValue' in v ? Date.parse(v.timestampValue) : 'mapValue' in v ? decFields(v.mapValue.fields) : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec) : 'nullValue' in v ? null : undefined);
const decFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, dec(v)]));
const fsName = (env, path) => new URL(fsBase(env)).pathname.replace(/^\/v1\//, '') + '/' + path;
async function fsGet(env, path, mask) {
  const q = new URLSearchParams({ key: env.FIREBASE_KEY || FIREBASE_KEY });
  for (const f of mask || []) q.append('mask.fieldPaths', f);
  const r = await fetch(`${fsBase(env)}/${docPath(path)}?${q}`);
  if (r.status === 404) return null;
  if (!r.ok) fail(502, 'Could not read Frixion.');
  return decFields((await r.json()).fields);
}
const fsCommit = (env, writes) => fetch(`${fsBase(env)}:commit?key=${fsKey(env)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }) });
// Adds 1 to the message's pushClaim and says what that came to: only the request that gets 1 sends it.
async function claim(env, path) {
  const r = await fsCommit(env, [{ update: { name: fsName(env, path), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'pushClaim', increment: { integerValue: '1' } }], currentDocument: { exists: true } }]);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null), v = j && j.writeResults && j.writeResults[0] && (j.writeResults[0].transformResults || [])[0];
  return v ? Number(v.integerValue ?? v.doubleValue) : null;
}
// The devices of these people that turned notifications on (30 people per question, Firestore's most for "in")
async function subsOf(env, uids) {
  const out = [];
  for (let i = 0; i < uids.length; i += 30) {
    const values = uids.slice(i, i + 30).map(u => ({ stringValue: u }));
    const q = { structuredQuery: { from: [{ collectionId: 'pushSubs' }], where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'IN', value: { arrayValue: { values } } } }, limit: 300 } };
    const r = await fetch(`${fsBase(env)}:runQuery?key=${fsKey(env)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) });
    if (!r.ok) continue;
    for (const x of (await r.json().catch(() => [])) || []) if (x.document) out.push({ id: x.document.name.split('/').pop(), ...decFields(x.document.fields) });
  }
  return out;
}

// ---------------- who hears about a message ----------------
const MENTION = /(^|[\s(>])@([A-Za-z0-9_]{3,24})\b/g;
function preview(m) {
  const text = String(m.text || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  if (text) return text.slice(0, 180);
  const n = (m.attachments || []).length || (m.attachment ? 1 : 0);
  return n ? (n > 1 ? `Sent ${n} files` : 'Sent a file') : m.sticker ? 'Sent a sticker' : m.gifUrl ? 'Sent a GIF' : m.poll ? `Poll: ${m.poll.question || ''}` : 'Sent a message';
}
const nameOf = (p, uid) => (p && (p.displayName || p.username)) || uid;
const iconOf = (p, origin) => (p && /^https:\/\//.test(p.avatarUrl || '') ? p.avatarUrl : `${origin}/default-avatar.png`);

async function send(env, { kind, id, sid, cid, tid, mid, uid }, origin) {
  if (!ID.test(mid || '') || !ID.test(uid || '')) fail(400, 'Something is missing.');
  let path, convo;
  if (kind === 'dm' || kind === 'gdm') {
    if (!ID.test(id || '')) fail(400, 'Something is missing.');
    convo = `${kind === 'dm' ? 'dms' : 'groupDMs'}/${id}`;
    path = `${convo}/messages/${mid}`;
  } else if (kind === 'ch') {
    if (!ID.test(sid || '') || !ID.test(cid || '') || (tid && !ID.test(tid))) fail(400, 'Something is missing.');
    path = tid ? `servers/${sid}/threads/${tid}/messages/${mid}` : `servers/${sid}/channels/${cid}/messages/${mid}`;
  } else fail(400, 'Something is missing.');

  const m = await fsGet(env, path);
  if (!m) fail(404, 'That message is gone.');
  if (m.uid !== uid || m.system || m.ext) return { ok: true, skipped: 'not theirs' };
  if (!m.createdAt || Math.abs(Date.now() - m.createdAt) > 2 * 60000) return { ok: true, skipped: 'old' };
  if ((await claim(env, path)) !== 1) return { ok: true, skipped: 'taken' };

  const sender = await fsGet(env, `users/${uid}`, ['username', 'displayName', 'avatarUrl']);
  const body = preview(m), icon = iconOf(sender, origin);
  let to = [], note, mute;
  if (kind === 'dm' || kind === 'gdm') {
    const c = await fsGet(env, convo, ['participants', 'name']);
    if (!c || !(c.participants || []).includes(uid)) return { ok: true, skipped: 'not in it' };
    to = c.participants.filter(p => p !== uid);
    mute = `${kind}:${id}`;
    note = kind === 'dm'
      ? { title: nameOf(sender, uid), body, icon, tag: mute, open: { type: 'dm', id, other: uid } }
      : { title: c.name || 'Group message', body: `${nameOf(sender, uid)}: ${body}`, icon, tag: mute, open: { type: 'gdm', id } };
  } else {
    const [server, channel, thread] = await Promise.all([
      fsGet(env, `servers/${sid}`, ['name', 'members', 'nicknames']),
      fsGet(env, `servers/${sid}/channels/${cid}`, ['name', 'overwrites', 'visibleToRoles']),
      tid ? fsGet(env, `servers/${sid}/threads/${tid}`, ['name']) : null,
    ]);
    if (!server || !channel || !(server.members || []).includes(uid)) return { ok: true, skipped: 'not in it' };
    const members = new Set(server.members), targets = new Set(), raw = String(m.text || '');
    let x;
    while ((x = MENTION.exec(raw))) if (members.has(x[2])) targets.add(x[2]);
    if (m.replyTo && members.has(m.replyTo.uid)) targets.add(m.replyTo.uid);
    // @everyone reaches the whole server, but only in a channel everyone can see
    const ev = channel.overwrites && channel.overwrites.everyone;
    const hidden = (ev && (ev.deny || []).includes('viewChannels')) || (channel.visibleToRoles || []).length;
    if (/(^|[\s(>])@(everyone|here)\b/i.test(raw) && m.everyoneBlocked !== true && !hidden) members.forEach(u => targets.add(u));
    targets.delete(uid);
    to = [...targets].slice(0, 300);
    mute = `ch:${cid}`;
    const nick = server.nicknames && server.nicknames[uid];
    const where = thread ? `${thread.name || 'thread'} in #${channel.name || 'channel'}` : `#${channel.name || 'channel'}`;
    note = { title: `${nick || nameOf(sender, uid)} (${where}, ${server.name || 'server'})`, body, icon, tag: `msg:${mid}`, open: { type: 'ch', sid, cid, tid: tid || null } };
  }
  if (!to.length) return { ok: true, sent: 0 };

  const subs = (await subsOf(env, to)).filter(s => s.endpoint && s.p256dh && s.auth && !(s.muted || []).includes(mute));
  const payload = JSON.stringify(note);
  const results = await Promise.all(subs.map(s => pushTo(env, s, payload).catch(() => 0)));
  // a device that unsubscribed (or whose browser was reset) is told apart by 404 or 410: forget it
  const gone = subs.filter((s, i) => results[i] === 404 || results[i] === 410);
  if (gone.length) await fsCommit(env, gone.map(s => ({ delete: fsName(env, `pushSubs/${s.id}`) }))).catch(() => {});
  return { ok: true, sent: results.filter(r => r >= 200 && r < 300).length, devices: subs.length };
}

// ---------------- Web Push ----------------
const te = s => new TextEncoder().encode(s);
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(s).length % 4)) % 4)), c => c.charCodeAt(0));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// The VAPID signature (RFC 8292): a short token for the push service, signed with the private key
let signer = null;
async function vapid(env, endpoint) {
  if (!signer || signer.raw !== env.VAPID_PRIVATE_KEY) {
    const jwk = JSON.parse(env.VAPID_PRIVATE_KEY);
    const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    signer = { raw: env.VAPID_PRIVATE_KEY, key, pub: b64u(concat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y))) };
  }
  const part = o => b64u(te(JSON.stringify(o)));
  const unsigned = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://frixionbeta.pages.dev' });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer.key, te(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${signer.pub}`;
}
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
}
// The message, encrypted so only that device can read it (RFC 8291, aes128gcm: one record)
async function encrypt(sub, payload) {
  const devicePub = unb64u(sub.p256dh), auth = unb64u(sub.auth);
  const mine = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const myPub = new Uint8Array(await crypto.subtle.exportKey('raw', mine.publicKey));
  const theirs = await crypto.subtle.importKey('raw', devicePub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, mine.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(auth, shared, concat(te('WebPush: info\0'), devicePub, myPub), 32);
  const cek = await hkdf(salt, ikm, te('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(te(payload), new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = myPub.length;
  return concat(head, myPub, sealed);
}
async function pushTo(env, sub, payload) {
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapid(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
    body: await encrypt(sub, payload),
  });
  return r.status;
}
