// Frixion and Discord, linked: a Frixion server channel and a Discord channel that act like one room.
// A Cloudflare Pages Function, served at /api/discord/* on the main site (the beta site and the computer app call it
// there too, so only this site needs the bot's token).
//   POST /api/discord/send    the sender's Frixion calls this right after a message goes into a linked channel: it is
//                             posted in the Discord channel through a webhook, with the sender's Frixion name and
//                             profile picture.
//   POST /api/discord/sync    after a message from Frixion is edited or deleted (or loses its text or a file), its
//                             Frixion calls this to make the Discord copy match: the new text, or gone.
//   GET  /api/discord/pull    whoever has a linked channel open asks every few seconds for what was said in the
//                             Discord channel since, and adds it to the channel with each Discord user's name and
//                             picture (and deletes what was deleted there).
//   POST /api/discord/verify  links a channel, once someone who runs the Discord server has posted the code Frixion
//                             showed in the Discord channel.
//   GET  /api/discord/info    whether the bridge is set up here, and the bot's invite link.
//   POST /api/discord/tick    brings every linked channel's new Discord messages over, so they're there (with unread
//                             dots) even when nobody has the channel open, and edits and deletes made in Discord too.
//                             A timer calls it every 10 seconds (step 4), and every open Frixion calls it now and
//                             then. One pass every 8 seconds at most.
//
// SETUP, once:
//   1. https://discord.com/developers/applications > New Application. In Bot, turn on "Message Content Intent" and
//      press Reset Token to get the bot's token.
//   2. Cloudflare > Workers & Pages > this Pages project > Settings > Variables and Secrets: add a Secret called
//      DISCORD_BOT_TOKEN with that token, then redeploy. Keep the token out of the code and out of chats.
//   3. Invite the bot (Channel Settings > Discord in Frixion shows the link) and link a channel there.
//   4. For Discord messages to come over 24/7 (not just while someone has Frixion open): Cloudflare > Workers & Pages
//      > Create > Create Worker, called frixion-discord-timer, with this code, and in its Settings add a Cron Trigger
//      for every minute (* * * * *). Cron can't go below a minute, so each run calls 6 times, 10 seconds apart:
//        export default { async scheduled(event, env, ctx) {
//          const tick = () => fetch('https://equilibrium-incarnate.pages.dev/api/discord/tick', { method: 'POST' }).catch(() => {});
//          ctx.waitUntil((async () => { for (let i = 0; i < 6; i++) { if (i) await new Promise(r => setTimeout(r, 10000)); await tick(); } })()); } };
//   5. Since v4.51 the database's rules are locked (firestore.rules), so this function signs in as a service account:
//      Google Cloud > IAM & Admin > Service Accounts (project liquidalt) > Create service account, give it the role
//      "Cloud Datastore User", then Keys > Add key > JSON. Add a Secret called FIREBASE_SERVICE_ACCOUNT with that whole
//      file's text here (and on frixionbeta for /api/push), then redeploy. /api/discord/info then says db: "service
//      account". Keep the file out of the repo and out of chats.
//
// Anyone can call this function, so nothing it's told is trusted on its own: a link only counts with the signature
// verify made from the bot's token (which only this function knows), and a message is sent once (the first request
// claims it with an update that fails if the message changed after it was read). sync only ever changes the bot's own
// webhook posts, and only deletes one once no Frixion message points at it any more.
// For tests, DISCORD_API, FIRESTORE_URL and FIREBASE_KEY (or FIRESTORE_BEARER) can point at a fake Discord and the
// Firebase emulators.
const DISCORD = 'https://discord.com/api/v10';
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/liquidalt/databases/(default)/documents';
const FIREBASE_KEY = 'AIzaSyCaDVRWLOSgC_Nl0YOeoG86G_hd_LKdW2U';   // the site's public web key
const UA = 'DiscordBot (https://equilibrium-incarnate.pages.dev, 1)';
const SNOWFLAKE = /^\d{15,22}$/, ID = /^[A-Za-z0-9_-]{1,128}$/;
// View Channel, Send Messages, Manage Messages (to tidy up the link code), Embed Links, Attach Files, Read Message
// History and Manage Webhooks (it posts as each Frixion user through a webhook)
const PERMS = String((1 << 10) + (1 << 11) + (1 << 13) + (1 << 14) + (1 << 15) + (1 << 16) + (1 << 29));
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });
class Fail extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const fail = (status, message, extra) => { throw new Fail(status, message, extra); };

export async function onRequest({ request, env, params }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const route = [].concat(params.path || []).join('/'), url = new URL(request.url);
  try {
    if (route === 'info' && request.method === 'GET') return json(await info(env));
    if (!env.DISCORD_BOT_TOKEN) fail(503, 'The Discord bridge is not set up on this site yet.');
    if (route === 'pull' && request.method === 'GET') return json(await pull(env, url));
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));   // sent as text/plain, so other sites can call it without a preflight
      if (route === 'send') return json(await send(env, body, url.origin));
      if (route === 'sync') return json(await sync(env, body));
      if (route === 'verify') return json(await verify(env, body));
      if (route === 'tick') return json(await tick(env));
    }
    return json({ error: 'Not found.' }, 404);
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message, ...(e.extra || {}) }, e.status);
    console.error(e);
    return json({ error: 'The Discord bridge hit a problem.' }, 500);
  }
}

// ---------------- Discord ----------------
const api = env => env.DISCORD_API || DISCORD;
// What Discord says is left of a channel's allowance for reading messages, so screens can be told to slow down
// before Discord starts refusing.
const buckets = new Map();
async function dc(env, method, path, body, bucket) {
  const r = await fetch(api(env) + path, { method, headers: { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, 'Content-Type': 'application/json', 'User-Agent': UA }, body: body ? JSON.stringify(body) : undefined });
  if (bucket) {
    const left = parseFloat(r.headers.get('x-ratelimit-remaining')), after = parseFloat(r.headers.get('x-ratelimit-reset-after'));
    if (Number.isFinite(left) && Number.isFinite(after)) buckets.set(bucket, { left, until: Date.now() + after * 1000 });
  }
  if (r.status === 204) return null;
  const j = await r.json().catch(() => null);
  if (r.status === 429) fail(429, 'Discord is busy. Trying again in a moment.', { retry: (j && j.retry_after) || 2 });
  if (!r.ok) fail(r.status, (j && j.message) || 'Discord said no.', { code: j && j.code });
  return j;
}
// who the bot is (its id is also its application's id, for the invite link)
let bot = null;
async function botUser(env) {
  if (bot && bot.token === env.DISCORD_BOT_TOKEN) return bot.user;
  const user = await dc(env, 'GET', '/users/@me');
  bot = { token: env.DISCORD_BOT_TOKEN, user };
  return user;
}
async function info(env) {
  const db = await dbStatus(env);
  if (!env.DISCORD_BOT_TOKEN) return { ready: false, db };
  const me = await botUser(env).catch(() => null);
  if (!me) return { ready: false, db, error: 'The bot token was refused. Make a new one and save it again.' };
  return { ready: true, db, bot: me.username, invite: `https://discord.com/oauth2/authorize?client_id=${me.id}&scope=bot&permissions=${PERMS}` };
}
// The webhook the bot posts through in a Discord channel (one per channel, made the first time it's needed).
const hooks = new Map();
async function hookFor(env, channel, create) {
  const hit = hooks.get(channel);
  if (hit && Date.now() - hit.at < 600000) return hit.hook;
  const me = await botUser(env);
  const list = await dc(env, 'GET', `/channels/${channel}/webhooks`);
  let hook = (list || []).find(w => w.type === 1 && w.token && w.user && w.user.id === me.id);
  if (!hook && create) hook = await dc(env, 'POST', `/channels/${channel}/webhooks`, { name: 'Frixion' });
  const out = hook ? { id: hook.id, token: hook.token } : null;
  if (out) hooks.set(channel, { at: Date.now(), hook: out });
  return out;
}
async function hookSend(env, channel, msg, known) {
  for (let tries = 0; tries < 2; tries++) {
    const h = (tries === 0 && known) || await hookFor(env, channel, true);
    const r = await fetch(`${api(env)}/webhooks/${h.id}/${h.token}?wait=true`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(msg) });
    if (r.status === 404) { hooks.delete(channel); continue; }   // someone deleted the webhook in Discord: make a new one
    const j = await r.json().catch(() => null);
    if (r.status === 429) fail(429, 'Discord is busy. Trying again in a moment.', { retry: (j && j.retry_after) || 2 });
    if (!r.ok) fail(502, (j && j.message) || 'Discord refused the message.');
    return j;
  }
  fail(502, 'Could not reach the Discord channel.');
}
const snowflakeOf = ms => String((BigInt(Math.floor(ms)) - 1420070400000n) << 22n);
function avatarOf(u) {
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith('a_') ? 'gif' : 'png'}?size=128`;
  const i = u.discriminator && u.discriminator !== '0' ? Number(u.discriminator) % 5 : Number((BigInt(u.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${i}.png`;
}

// ---------------- Frixion's database, through Firestore's REST API ----------------
const fsBase = env => env.FIRESTORE_URL || FIRESTORE;
// The database's rules only let Frixion's pages in as whoever is signed in there. This function is nobody's page, so it
// signs in as Frixion itself: a Google service account (setup step 5), whose key is the FIREBASE_SERVICE_ACCOUNT secret.
// Without one it uses the public web key, which only works while the rules leave things open. For tests,
// FIRESTORE_BEARER can be "owner", the emulator's way of skipping the rules.
let gToken = null;   // Google's access token for the service account, kept until a minute before it runs out
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = s => b64url(new TextEncoder().encode(s));
async function dbToken(env) {
  if (env.FIRESTORE_BEARER) return env.FIRESTORE_BEARER;
  if (!env.FIREBASE_SERVICE_ACCOUNT) return null;
  if (gToken && gToken.until > Date.now() + 60000) return gToken.value;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT), now = Math.floor(Date.now() / 1000);
  const head = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
  const claims = b64urlText(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const der = Uint8Array.from(atob(String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claims)));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claims + '.' + b64url(sig) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Google refused the service account (' + (j.error_description || j.error || r.status) + ')');
  gToken = { value: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return gToken.value;
}
// A request to the database, signed in as the service account when there is one (or with the public web key).
async function dbFetch(env, url, init = {}) {
  const token = await dbToken(env);
  if (token) return fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + token } });
  const u = new URL(url);
  u.searchParams.set('key', env.FIREBASE_KEY || FIREBASE_KEY);
  return fetch(u, init);
}
// How this function gets into the database, for /info: "service account" once it works, "public key" without one.
async function dbStatus(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT && !env.FIRESTORE_BEARER) return 'public key';
  try {
    const r = await dbFetch(env, `${fsBase(env)}/config/filter?mask.fieldPaths=enabled`);
    return r.ok || r.status === 404 ? 'service account' : `the service account can't read the database (${r.status}): give it the Cloud Datastore User role`;
  } catch (e) { return e.message; }
}
const docPath = p => p.split('/').map(encodeURIComponent).join('/');
const dec = v => ('stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue
  : 'timestampValue' in v ? Date.parse(v.timestampValue) : 'mapValue' in v ? decFields(v.mapValue.fields) : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec) : 'nullValue' in v ? null : undefined);
const decFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, dec(v)]));
const enc = v => (v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : { mapValue: { fields: encFields(v) } });
// (a field set to undefined is deleted: it's in the update mask but not in the fields)
const encFields = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, enc(v)]));
async function fsGet(env, path, mask) {
  const q = new URLSearchParams();
  for (const f of mask || []) q.append('mask.fieldPaths', f);
  const r = await dbFetch(env, `${fsBase(env)}/${docPath(path)}?${q}`);
  if (r.status === 404) return null;
  if (!r.ok) fail(502, 'Could not read Frixion.');
  const j = await r.json();
  return { data: decFields(j.fields), updateTime: j.updateTime };
}
// Only the fields given are changed, and only if the document is still there. when: an updateTime (only if it hasn't
// changed since then either), or { exists: false } (only if it isn't there yet). Keys can be paths ('discord.last').
// (A commit, because that's where the precondition is kept: the emulator ignores one passed to PATCH in the URL.)
const fsName = (env, path) => new URL(fsBase(env)).pathname.replace(/^\/v1\//, '') + '/' + path;
const fsCommit = (env, writes) => dbFetch(env, `${fsBase(env)}:commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }) });
async function fsPatch(env, path, data, when) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) { const parts = k.split('.'); let o = fields; parts.slice(0, -1).forEach(s => { o = o[s] = o[s] || {}; }); o[parts[parts.length - 1]] = v; }
  const r = await fsCommit(env, [{ update: { name: fsName(env, path), fields: encFields(fields) }, updateMask: { fieldPaths: Object.keys(data) }, currentDocument: typeof when === 'string' ? { updateTime: when } : when || { exists: true } }]);
  return r.ok;
}
// a new document, only if there isn't one there already (false if there is)
async function fsCreate(env, path, data) {
  const r = await fsCommit(env, [{ update: { name: fsName(env, path), fields: encFields(data) }, currentDocument: { exists: false } }]);
  return r.ok;
}
async function fsDelete(env, path) {
  const r = await fsCommit(env, [{ delete: fsName(env, path) }]);
  return r.ok;
}
async function fsList(env, coll) {
  const r = await dbFetch(env, `${fsBase(env)}/${docPath(coll)}?pageSize=100`);
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return (j.documents || []).map(d => decFields(d.fields));
}
// Claims a message for sending in one trip: adds 1 to its dcClaim and says what that came to. Only the request that
// gets 1 sends it. (null if the message isn't there.)
async function fsClaim(env, path) {
  const write = { update: { name: fsName(env, path), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'dcClaim', increment: { integerValue: '1' } }], currentDocument: { exists: true } };
  const r = await fsCommit(env, [write]);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null), v = j && j.writeResults && j.writeResults[0] && (j.writeResults[0].transformResults || [])[0];
  return v ? Number(v.integerValue ?? v.doubleValue) : null;
}

// ---------------- links ----------------
// The signature on a link: an HMAC of "server/channel/Discord channel" with a key made from the bot's token.
async function sign(env, sid, cid, channel) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('frixion-discord-link:' + env.DISCORD_BOT_TOKEN));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${sid}/${cid}/${channel}`));
  return [...new Uint8Array(s)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const same = (a, b) => { if (typeof a !== 'string' || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
// A channel's link, read from its document (and remembered for 30 seconds, so a channel open on several screens
// doesn't read it every few seconds). No link is only remembered for 3: a channel that was just linked asks right
// away, sometimes before the link has reached the database.
const links = new Map();
async function linkOf(env, sid, cid, keep = 30000) {
  const k = sid + '/' + cid, hit = links.get(k);
  if (hit && Date.now() - hit.at < (hit.link ? keep : 3000)) return hit.link;
  const doc = await fsGet(env, `servers/${sid}/channels/${cid}`, ['discord']);
  const d = doc && doc.data.discord;
  const ok = !!(d && SNOWFLAKE.test(d.channel || '') && same(d.sig, await sign(env, sid, cid, d.channel)));
  const link = ok ? { channel: d.channel, since: SNOWFLAKE.test(d.since || '') ? d.since : snowflakeOf(Date.now() - 60000), last: SNOWFLAKE.test(d.last || '') ? d.last : '' } : null;
  links.set(k, { at: Date.now(), link });
  if (links.size > 500) links.delete(links.keys().next().value);
  return link;
}
// Can this Discord user link the server's channels? Its owner, or anyone whose roles can manage the server, its
// channels or its webhooks (or are administrators).
async function runsServer(env, guild, uid) {
  if (guild.owner_id === uid) return true;
  const member = await dc(env, 'GET', `/guilds/${guild.id}/members/${uid}`).catch(() => null);
  if (!member) return false;
  const roles = new Map((guild.roles || []).map(r => [r.id, BigInt(r.permissions || '0')]));
  let perms = roles.get(guild.id) || 0n;   // @everyone's role has the server's id
  for (const r of member.roles || []) perms |= roles.get(r) || 0n;
  return (perms & (8n | 16n | 32n | (1n << 29n))) !== 0n;
}
async function verify(env, { sid, cid, channel, code }) {
  if (!ID.test(sid || '') || !ID.test(cid || '') || !SNOWFLAKE.test(channel || '') || !/^[A-Z0-9]{6}$/.test(code || '')) fail(400, 'Something is missing. Paste the channel ID again.');
  const [server, here] = await Promise.all([fsGet(env, `servers/${sid}`, ['name']), fsGet(env, `servers/${sid}/channels/${cid}`, ['name'])]);
  if (!server || !here) fail(404, 'That Frixion channel is gone.');
  const ch = await dc(env, 'GET', `/channels/${channel}`).catch(e => fail(e.status === 429 ? 429 : 404, e.status === 429 ? e.message : 'The bot can\'t see that Discord channel. Invite the bot to the server, check the channel ID, and make sure the bot can view the channel.', e.extra));
  if (ch.type !== 0 && ch.type !== 5) fail(400, 'That Discord channel isn\'t a text channel.');
  const [guild, recent] = await Promise.all([dc(env, 'GET', `/guilds/${ch.guild_id}`), dc(env, 'GET', `/channels/${channel}/messages?limit=30`)]);
  const tag = `frixion-link-${code}`.toLowerCase();
  const post = (recent || []).find(m => (m.content || '').toLowerCase().includes(tag) && Date.now() - Date.parse(m.timestamp) < 20 * 60000);
  if (!post) fail(404, `The code isn't in #${ch.name} yet. Post frixion-link-${code} there, then press Verify. (If it is there, turn on Message Content Intent for the bot in the Discord Developer Portal.)`);
  if (!(await runsServer(env, guild, post.author.id))) fail(403, 'The code has to be posted by the Discord server\'s owner, or by someone who can manage the server, its channels or its webhooks.');
  await hookFor(env, channel, true).catch(e => fail(e.status === 429 ? 429 : 403, e.status === 429 ? e.message : 'The bot needs the Manage Webhooks permission in that Discord channel.', e.extra));
  await dc(env, 'DELETE', `/channels/${channel}/messages/${post.id}`).catch(() => {});   // tidy the code away (needs Manage Messages)
  links.delete(sid + '/' + cid);
  const name = here.data.name || 'channel';
  await hookSend(env, channel, { username: 'Frixion', content: `This channel is now linked to **#${name}** in **${server.data.name || 'a Frixion server'}** on Frixion. Messages sent here show up there, and messages sent there show up here.`, allowed_mentions: { parse: [] } }).catch(() => {});
  return { channel, name: ch.name, guild: guild.name, since: snowflakeOf(Date.now()), sig: await sign(env, sid, cid, channel) };
}

// ---------------- Frixion to Discord ----------------
// a webhook's name: 1 to 80 characters, and Discord refuses ones containing "discord" or "clyde"
const hookName = s => (String(s || '').replace(/\s+/g, ' ').trim().replace(/discord/gi, w => w.replace(/o/i, 'ο')).replace(/clyde/gi, w => w.replace(/y/i, 'у')).slice(0, 80) || 'Frixion user').replace(/^(everyone|here)$/i, '$1 (Frixion)');
const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();
function discordText(m) {
  const out = [];
  if (m.replyTo && m.replyTo.username) out.push(`> **${oneLine(m.replyTo.username).replace(/[*_`~|]/g, '')}**: ${oneLine(m.replyTo.text).slice(0, 140) || '(a message)'}`);
  if (m.text) out.push(String(m.text));
  if (m.poll && m.poll.question) out.push(`**Poll:** ${m.poll.question}\n` + (m.poll.answers || []).map(a => `- ${a.emoji && !/^:/.test(a.emoji) ? a.emoji + ' ' : ''}${a.text}`).join('\n'));
  if (m.sticker) out.push(`*[sticker: ${oneLine(m.sticker.name) || 'sticker'}]*`);
  if (m.gifUrl && /^https:\/\//.test(m.gifUrl)) out.push(m.gifUrl);
  for (const a of m.attachments || (m.attachment ? [m.attachment] : [])) if (a && /^https:\/\//.test(a.url || '')) out.push(a.url);
  const text = out.join('\n').trim();
  return text.length > 2000 ? text.slice(0, 1997) + '...' : text;
}
// Everything it needs is fetched at once (the link and its webhook, the message, a claim on it, who wrote it and the
// server's nicknames), so the message reaches Discord one database trip after the request arrives. uid is the
// sender's, as their Frixion says; if the message says otherwise, its own author is looked up instead.
const PROFILE = ['username', 'displayName', 'avatarUrl'];
async function send(env, { sid, cid, mid, uid }, origin) {
  if (!ID.test(sid || '') || !ID.test(cid || '') || !ID.test(mid || '')) fail(400, 'Something is missing.');
  const path = `servers/${sid}/channels/${cid}/messages/${mid}`, hint = ID.test(uid || '') ? uid : null, linkP = linkOf(env, sid, cid);
  const [link, hook, doc, claim, user, server] = await Promise.all([
    linkP, linkP.then(l => (l ? hookFor(env, l.channel, true) : null)).catch(e => e),
    fsGet(env, path), fsClaim(env, path),
    hint ? fsGet(env, `users/${hint}`, PROFILE) : null, fsGet(env, `servers/${sid}`, ['nicknames']),
  ]);
  if (!link) fail(404, 'This channel isn\'t linked to Discord.');
  if (!doc) fail(404, 'That message is gone.');
  const m = doc.data;
  if (m.dc || m.ext || m.system || !m.uid || String(m.uid).startsWith('discord:')) return { ok: true, skipped: 'not new' };
  if (!m.createdAt || Math.abs(Date.now() - m.createdAt) > 5 * 60000) return { ok: true, skipped: 'old' };
  if (claim !== 1) return { ok: true, skipped: 'taken' };   // another request is sending it
  const content = discordText(m);
  if (!content) return { ok: true, skipped: 'empty' };
  try {
    if (hook instanceof Error) throw hook;
    const p = ((m.uid === hint ? user : await fsGet(env, `users/${m.uid}`, PROFILE)) || {}).data || {}, nick = server && server.data.nicknames && server.data.nicknames[m.uid];
    const avatar = /^https:\/\//.test(p.avatarUrl || '') ? p.avatarUrl : `${origin}/default-avatar.png`;
    const sent = await hookSend(env, link.channel, { content, username: hookName(nick || p.displayName || p.username || m.username), avatar_url: avatar, allowed_mentions: { parse: [] } }, hook);
    await fsPatch(env, path, { dc: sent.id });
    return { ok: true, id: sent.id };
  } catch (e) {
    await fsPatch(env, path, { dcClaim: 0 }).catch(() => {});   // so it can be tried again
    throw e;
  }
}
// After a message from Frixion is edited, loses its text or a file, or is deleted, its Frixion asks for the Discord
// copy to match (dc: the copy's id, for a message that's gone). Only posts the bot's webhook made can be changed this
// way (Discord refuses the rest, so nobody's own Discord messages can be touched from here), and a copy is only
// deleted once no Frixion message points at it any more.
async function sync(env, { sid, cid, mid, dc: copy }) {
  if (!ID.test(sid || '') || !ID.test(cid || '') || !ID.test(mid || '')) fail(400, 'Something is missing.');
  const path = `servers/${sid}/channels/${cid}/messages/${mid}`;
  const [link, doc] = await Promise.all([linkOf(env, sid, cid), fsGet(env, path)]);
  if (!link) fail(404, 'This channel isn\'t linked to Discord.');
  const m = doc && doc.data;
  if (m && (!SNOWFLAKE.test(m.dc || '') || m.ext || String(m.uid || '').startsWith('discord:'))) return { ok: true, skipped: 'not from here' };
  const id = m ? m.dc : copy;
  if (!SNOWFLAKE.test(id || '')) fail(400, 'Something is missing.');
  if (!m && await findByDc(env, sid, cid, id)) return { ok: true, skipped: 'still here' };
  const content = m ? discordText(m) : '';
  const r = await hookEdit(env, link.channel, id, content ? { content, allowed_mentions: { parse: [] } } : null);
  // nothing left to show: the message stops pointing at the deleted copy, so the tick doesn't delete it here as well
  if (m && !content && r.deleted) await fsPatch(env, path, { dc: undefined });
  return r;
}
// Edits (body) or deletes (no body) a post the bot's webhook made in a Discord channel.
async function hookEdit(env, channel, id, body) {
  const h = await hookFor(env, channel, false);
  if (!h) return { ok: true, skipped: 'gone' };
  const r = await fetch(`${api(env)}/webhooks/${h.id}/${h.token}/messages/${id}`, { method: body ? 'PATCH' : 'DELETE', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 404 || r.status === 403) return { ok: true, skipped: 'gone' };   // deleted already, not the webhook's, or an earlier webhook's
  const j = r.status === 204 ? null : await r.json().catch(() => null);
  if (r.status === 429) fail(429, 'Discord is busy. Trying again in a moment.', { retry: (j && j.retry_after) || 2 });
  if (!r.ok) fail(502, (j && j.message) || 'Discord refused the change.');
  return { ok: true, [body ? 'edited' : 'deleted']: true };
}

// ---------------- Discord to Frixion ----------------
// Discord's markup in plain text: mentions as @name, custom emoji as :name:, timestamps as dates
function plainText(m) {
  const users = new Map((m.mentions || []).map(u => [u.id, u.global_name || u.username]));
  let t = String(m.content || '')
    .replace(/<@!?(\d+)>/g, (_, id) => '@' + (users.get(id) || 'someone'))
    .replace(/<@&\d+>/g, '@role').replace(/<#\d+>/g, '#channel')
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<t:(\d+)(?::\w)?>/g, (_, s) => new Date(+s * 1000).toUTCString());
  if (!t && m.embeds && m.embeds.length) t = [m.embeds[0].title, m.embeds[0].description].filter(Boolean).join('\n');
  return t.slice(0, 4000);
}
function fromDiscord(m) {
  const a = m.author, r = m.referenced_message, ra = r && r.author;
  return {
    id: m.id, at: Date.parse(m.timestamp),
    author: { id: a.id, name: a.global_name || a.username, tag: a.username, avatar: avatarOf(a), bot: !!a.bot },
    text: plainText(m),
    files: (m.attachments || []).map(f => ({ url: f.url, name: f.filename, type: f.content_type || '', size: f.size || 0 })),
    stickers: (m.sticker_items || []).map(s => s.name),
    reply: r && ra ? { id: r.id, uid: ra.id, name: ra.global_name || ra.username, text: oneLine(plainText(r)).slice(0, 200), hook: !!r.webhook_id } : null,
  };
}
// A linked Discord channel's newest 50 messages (or the 50 after a message), oldest first, and how to tell them apart:
// ours are Frixion's messages, posted through the bot's webhook; keep is people talking in Discord (not the bot, its
// webhook or the link codes). at is when they were asked for.
async function discordList(env, link, after) {
  const at = Date.now();
  const [list, hook, me] = await Promise.all([dc(env, 'GET', `/channels/${link.channel}/messages?${after ? `after=${after}&` : ''}limit=50`, null, link.channel), hookFor(env, link.channel, false).catch(() => null), botUser(env)]);
  const ours = m => !!(m.webhook_id && ((hook && m.webhook_id === hook.id) || m.application_id === me.id));
  const keep = m => (m.type === 0 || m.type === 19) && m.author && m.author.id !== me.id && !ours(m) && !/frixion-link-[a-z0-9]{6}/i.test(m.content || '');
  return { at, list: (list || []).slice().sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1)), ours, keep };
}
// What's been said in a linked Discord channel since a message, ready to come over. last is the newest message looked
// at, said by anyone.
async function discordSince(env, link, after) {
  const { list, keep } = await discordList(env, link, after);
  return { last: list.length ? list[list.length - 1].id : after, messages: list.filter(keep).map(fromDiscord) };
}
// Screens asking about the same channel within a moment of each other share one look at its newest 50 messages (never
// an old one: that would hold messages back). pace, when Discord's allowance for the channel is nearly used up, is how
// long to wait (in ms). recent is every message among those 50 (from: the oldest of them, or 0 when they're the whole
// channel; at: when they were read), so an open channel can delete what was deleted in Discord.
const looks = new Map();
async function pull(env, url) {
  const sid = url.searchParams.get('sid'), cid = url.searchParams.get('cid');
  if (!ID.test(sid || '') || !ID.test(cid || '')) fail(400, 'Something is missing.');
  const link = await linkOf(env, sid, cid);
  if (!link) fail(404, 'This channel isn\'t linked to Discord.');
  let after = url.searchParams.get('after') || '';
  if (!SNOWFLAKE.test(after) || BigInt(after) < BigInt(link.since)) after = link.since;
  const n = Date.now(), b = buckets.get(link.channel);
  if (b && b.left <= 0 && b.until > n) return { last: after, messages: [], pace: b.until - n };
  let look = looks.get(link.channel);
  if (!look || n - look.at >= 700) {
    look = { at: n, p: discordList(env, link) };
    looks.set(link.channel, look);
    look.p.catch(() => looks.delete(link.channel));
    for (const [k, v] of looks) if (n - v.at > 10000) looks.delete(k);
  }
  const w = await look.p;
  // what's new is among them, unless the screen is more than 50 behind: then it gets the 50 after where it got to
  const behind = w.list.length >= 50 && BigInt(w.list[0].id) > BigInt(after);
  const out = behind ? await discordSince(env, link, after)
    : { last: newestOf(after, ...w.list.map(m => m.id)), messages: w.list.filter(m => BigInt(m.id) > BigInt(after) && w.keep(m)).map(fromDiscord) };
  if (w.list.length) out.recent = { at: w.at, from: w.list.length < 50 ? '0' : w.list[0].id, ids: w.list.map(m => m.id) };
  out.added = await importPulled(env, sid, cid, link, out).catch(() => 0);
  const nb = buckets.get(link.channel);
  return { ...out, pace: nb && nb.left <= 1 && nb.until > Date.now() ? Math.ceil(nb.until - Date.now()) : 0 };
}
// What a pull found is added here, the way the timer adds it (messages/dc_<Discord id>, only if it isn't there yet), so
// no page ever writes a Discord user's message itself: since v4.51 the database's rules don't let pages do that, which
// keeps anyone from making up "Discord" messages. Then the channel's place and newest message are stamped, as the
// timer does. Screens asking at the same moment share one import of each message here.
const importing = new Map();   // Discord message id -> its import, while running (and a minute after)
async function importPulled(env, sid, cid, link, out) {
  const done = BigInt(newestOf(link.since, link.last));
  const fresh = (out.messages || []).filter(d => d && SNOWFLAKE.test(d.id || '') && BigInt(d.id) > done);
  const dir = `servers/${sid}/channels/${cid}/messages`;
  const made = (await Promise.all(fresh.map(d => {
    if (!importing.has(d.id)) {
      importing.set(d.id, (async () => {
        if (await fsGet(env, `${dir}/dc_${d.id}`, ['dc']).catch(() => null)) return null;   // already over (another copy of this function)
        const m = await importedMessage(env, sid, cid, d);
        return m && await fsCreate(env, `${dir}/dc_${d.id}`, m) ? m : null;
      })().catch(() => null));
      setTimeout(() => importing.delete(d.id), 60000);
    }
    return importing.get(d.id);
  }))).filter(Boolean);
  const newest = made.reduce((a, b) => (!a || BigInt(b.dc) > BigInt(a.dc) ? b : a), null);
  const up = {}, last = newestOf(out.last, link.last);
  // how far it got: saved with anything new, or when the saved place is more than 10 minutes behind
  if (BigInt(last) > BigInt(newestOf(link.last)) && (newest || snowflakeMs(last) - snowflakeMs(newestOf(link.last, link.since)) > 600000)) { up['discord.last'] = last; link.last = last; }
  if (newest) up.lastMessageAt = newest.createdAt, up.lastMessage = { uid: newest.uid, text: (newest.text || (newest.attachments ? 'Sent a file' : '')).slice(0, 200), everyone: false, mid: 'dc_' + newest.dc };
  if (Object.keys(up).length) await fsPatch(env, `servers/${sid}/channels/${cid}`, up).catch(() => {});
  return made.length;
}

// ---------------- Discord to Frixion, with nobody watching ----------------
// Every linked channel (listed in discordLinks, which Frixion keeps up to date) gets what was said in Discord since
// the last pass, added the way an open Frixion adds it (messages/dc_<Discord id>, only if it isn't there already),
// and the channel's newest message stamped, so everyone gets the unread dot. Discord's file links stop working after
// a day, so files are copied to Cloudinary first, like files sent in Frixion.
// Each pass reads the channel's newest 50 Discord messages, which also shows what was edited or deleted in Discord
// since the last pass (see recheck).
// The timer asks every 10 seconds, so a pass with nothing new costs the database nothing: the list of links (5
// minutes), each link (5 minutes) and how far each channel has got are remembered here, and how far it got is only
// saved when something comes over, or every 10 minutes otherwise. Two passes at once can't double anything up (a
// message is only created if it isn't there, and an edit or delete done twice comes out the same), so there's nothing
// to coordinate.
const CLOUDINARY = { cloud: 'a97nqv9w', preset: 'frixion' };   // the site's own (public) unsigned upload preset
let lastTick = 0, linkList = null;
const cursors = new Map();   // 'server/channel' -> { last: newest looked at, saved: what the channel doc says, seen and seenSaved: see recheck }
const newestOf = (...ids) => ids.filter(x => SNOWFLAKE.test(x || '')).reduce((a, b) => (BigInt(b) > BigInt(a) ? b : a), '0');
const snowflakeMs = id => Number((BigInt(id) >> 22n) + 1420070400000n);
async function tick(env) {
  const n = Date.now();
  if (n - lastTick < 8000) return { ok: true, skipped: 'recent' };
  lastTick = n;
  if (!linkList || n - linkList.at > 300000) linkList = { at: n, list: await fsList(env, 'discordLinks') };
  let imported = 0;
  for (const l of linkList.list.slice(0, 25)) {
    if (!ID.test(l.sid || '') || !ID.test(l.cid || '')) continue;
    try { imported += await importChannel(env, l); } catch (e) { if (e instanceof Fail && e.status === 429) break; }
  }
  return { ok: true, links: linkList.list.length, imported };
}
async function importChannel(env, l) {
  const { sid, cid } = l, k = sid + '/' + cid, link = await linkOf(env, sid, cid, 300000);
  if (!link) { cursors.delete(k); return 0; }
  const c = cursors.get(k) || { last: '', saved: link.last || '', ...seenOf(l, link.channel) };
  const after = newestOf(link.since, link.last, c.last);
  // what's new is among the newest 50, unless more than that came since the last pass: then the 50 after it go first
  const w = await discordList(env, link);
  const behind = w.list.length >= 50 && BigInt(w.list[0].id) > BigInt(after);
  const { last, messages } = behind ? await discordSince(env, link, after)
    : { last: newestOf(after, ...w.list.map(m => m.id)), messages: w.list.filter(m => BigInt(m.id) > BigInt(after) && w.keep(m)).map(fromDiscord) };
  let made = 0, newest = null;
  const added = new Set();
  for (const d of messages) {
    const m = await importedMessage(env, sid, cid, d);
    if (m && await fsCreate(env, `servers/${sid}/channels/${cid}/messages/dc_${d.id}`, m)) { made++; newest = m; added.add(d.id); }
  }
  // how far it got (saved with anything new, or every 10 minutes), and the channel's newest message, for the dots
  c.last = newestOf(c.last, last);
  const up = {};
  if (BigInt(c.last) > BigInt(c.saved || '0') && (newest || !c.saved || snowflakeMs(c.last) - snowflakeMs(c.saved) > 600000)) { up['discord.last'] = c.last; c.saved = c.last; }
  if (newest) { up.lastMessageAt = newest.createdAt; up.lastMessage = { uid: newest.uid, text: (newest.text || (newest.attachments ? 'Sent a file' : '')).slice(0, 200), everyone: false, mid: 'dc_' + newest.dc }; }
  if (Object.keys(up).length) await fsPatch(env, `servers/${sid}/channels/${cid}`, up);
  await recheck(env, l, link, c, w, added);
  cursors.set(k, c);
  return made;
}
// Edits and deletes made in Discord, found by comparing the newest messages with what they were on the last pass
// (also kept as seen on the channel's discordLinks entry, so a restart of this function doesn't lose them): one whose
// edit time changed gets its new text here, and one that's gone from among them is deleted here too, whoever wrote
// it (a Frixion message whose copy a Discord moderator deleted goes as well). An empty answer says nothing.
// seen is "<Discord channel>|<id>:<edit time> ...", with w instead of a time for Frixion's own posts.
// Cloudflare can run this in several places at once, each remembering its own last pass, so before the saved seen is
// replaced, it's read: anything another pass saw that isn't in Discord any more is deleted here first (unless it's
// newer than this look at Discord), or the next pass would never know it had been there.
async function recheck(env, l, link, c, w, added) {
  if (!w.list.length) return;
  const { sid, cid } = l, dir = `servers/${sid}/channels/${cid}/messages`, now = new Map();
  for (const m of w.list) {
    if (BigInt(m.id) <= BigInt(link.since)) continue;
    if (w.ours(m)) now.set(m.id, 'w');
    else if (w.keep(m)) now.set(m.id, m.edited_timestamp ? Date.parse(m.edited_timestamp) || 1 : 0);
  }
  // fewer than 50 is the whole channel; otherwise anything older than the oldest of them has only scrolled out
  const from = w.list.length < 50 ? 0n : BigInt(w.list[0].id), jobs = [];
  const gone = (id, was) => (was === 'w' ? findByDc(env, sid, cid, id).then(o => o && fsDelete(env, `${dir}/${o.id}`)) : fsDelete(env, `${dir}/dc_${id}`));
  for (const [id, was] of c.seen) if (!now.has(id) && BigInt(id) >= from) jobs.push(gone(id, was));
  for (const m of w.list) {
    const t = now.get(m.id);
    if (typeof t !== 'number' || !t || added.has(m.id) || c.seen.get(m.id) === t) continue;
    const d = fromDiscord(m);
    jobs.push(fsPatch(env, `${dir}/dc_${m.id}`, { text: String(d.text || (d.stickers.length ? `[sticker: ${d.stickers[0]}]` : '')).slice(0, 4000), edited: true }));
  }
  const seen = link.channel + '|' + [...now].map(([id, t]) => id + ':' + t).join(' ');
  if (seen !== c.seenSaved) {
    const saved = await fsGet(env, `discordLinks/${sid}__${cid}`, ['seen']).catch(() => null);
    for (const [id, was] of seenOf((saved && saved.data) || {}, link.channel).seen)
      if (!now.has(id) && !c.seen.has(id) && BigInt(id) >= from && snowflakeMs(id) < w.at - 2000) jobs.push(gone(id, was));
  }
  await Promise.all(jobs.map(j => j.catch(() => {})));
  c.seen = now;
  if (seen !== c.seenSaved && await fsPatch(env, `discordLinks/${sid}__${cid}`, { seen })) c.seenSaved = seen;
}
// what seen in a discordLinks entry says about its Discord channel (nothing, if it was about another one)
function seenOf(l, channel) {
  const [ch, list] = String(l.seen || '').split('|');
  const seen = new Map(ch === channel && list ? list.split(' ').map(x => { const [id, t] = x.split(':'); return [id, t === 'w' ? 'w' : Number(t) || 0]; }) : []);
  return { seen, seenSaved: l.seen || '' };
}
// a Discord message as a Frixion one (the same fields an open Frixion writes: see DISCORD BRIDGE in script.js)
async function importedMessage(env, sid, cid, d) {
  if (!d || !SNOWFLAKE.test(d.id || '') || !d.author) return null;
  const ext = { src: 'discord', id: String(d.author.id), name: String(d.author.name || 'Discord user').slice(0, 80), tag: String(d.author.tag || '').slice(0, 40), avatar: /^https:\/\//.test(d.author.avatar || '') ? d.author.avatar : '', bot: !!d.author.bot };
  const m = { uid: 'discord:' + ext.id, username: ext.name, ext, dc: d.id, createdAt: new Date(d.at || Date.now()), text: String(d.text || (d.stickers && d.stickers.length ? `[sticker: ${d.stickers[0]}]` : '')).slice(0, 4000) };
  const files = (d.files || []).filter(f => f && /^https?:\/\//.test(f.url || '')).slice(0, 10);
  if (files.length) m.attachments = await Promise.all(files.map(async f => { const a = { url: f.url, name: String(f.name || 'file').slice(0, 200), type: /^image\//.test(f.type || '') ? 'image' : 'file', size: +f.size || 0 }; return { ...a, url: await rehost(a) }; }));
  if (d.reply) {
    const o = d.reply.hook ? await findByDc(env, sid, cid, d.reply.id) : null;   // a reply to a message from Frixion
    m.replyTo = { id: o ? o.id : 'dc_' + d.reply.id, uid: o ? o.uid : 'discord:' + d.reply.uid, username: o ? (o.username || '') : String(d.reply.name || ''), text: String(d.reply.text || '').slice(0, 200) };
  }
  return m.text || m.attachments ? m : null;
}
async function rehost(a) {
  if (!/^https:\/\/(cdn|media)\.discordapp\.(com|net)\//.test(a.url) || (a.size || 0) > 10 * 1024 * 1024) return a.url;
  try {
    const fd = new FormData(); fd.append('file', a.url); fd.append('upload_preset', CLOUDINARY.preset);
    const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloud}/${a.type === 'image' ? 'image' : 'auto'}/upload`, { method: 'POST', body: fd });
    const j = await r.json();
    return (j && j.secure_url) || a.url;
  } catch (e) { return a.url; }
}
// the Frixion message that went to Discord as this Discord message
async function findByDc(env, sid, cid, id) {
  const q = { structuredQuery: { from: [{ collectionId: 'messages' }], where: { fieldFilter: { field: { fieldPath: 'dc' }, op: 'EQUAL', value: { stringValue: id } } }, limit: 1 } };
  const r = await dbFetch(env, `${fsBase(env)}/${docPath(`servers/${sid}/channels/${cid}`)}:runQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) });
  if (!r.ok) return null;
  const hit = ((await r.json().catch(() => [])) || []).find(x => x.document);
  if (!hit) return null;
  const f = decFields(hit.document.fields);
  return { id: hit.document.name.split('/').pop(), uid: f.uid, username: f.username };
}
