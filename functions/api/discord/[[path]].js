// Frixion and Discord, linked: a Frixion server channel and a Discord channel that act like one room.
// A Cloudflare Pages Function, served at /api/discord/* on the main site (the beta site and the computer app call it
// there too, so only this site needs the bot's token).
//   POST /api/discord/send    the sender's Frixion calls this right after a message goes into a linked channel: it is
//                             posted in the Discord channel through a webhook, with the sender's Frixion name and
//                             profile picture.
//   GET  /api/discord/pull    whoever has a linked channel open asks every few seconds for what was said in the
//                             Discord channel since, and adds it to the channel with each Discord user's name and
//                             picture.
//   POST /api/discord/verify  links a channel, once someone who runs the Discord server has posted the code Frixion
//                             showed in the Discord channel.
//   GET  /api/discord/info    whether the bridge is set up here, and the bot's invite link.
//
// SETUP, once:
//   1. https://discord.com/developers/applications > New Application. In Bot, turn on "Message Content Intent" and
//      press Reset Token to get the bot's token.
//   2. Cloudflare > Workers & Pages > this Pages project > Settings > Variables and Secrets: add a Secret called
//      DISCORD_BOT_TOKEN with that token, then redeploy. Keep the token out of the code and out of chats.
//   3. Invite the bot (Channel Settings > Discord in Frixion shows the link) and link a channel there.
//
// Frixion's database is open to every visitor, so nothing stored in it is trusted on its own: a link only counts with
// the signature verify made from the bot's token (which only this function knows), and a message is sent once (the
// first request claims it with an update that fails if the message changed after it was read).
// For tests, DISCORD_API, FIRESTORE_URL and FIREBASE_KEY can point at a fake Discord and the Firebase emulators.
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
      if (route === 'verify') return json(await verify(env, body));
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
  if (!env.DISCORD_BOT_TOKEN) return { ready: false };
  const me = await botUser(env).catch(() => null);
  if (!me) return { ready: false, error: 'The bot token was refused. Make a new one and save it again.' };
  return { ready: true, bot: me.username, invite: `https://discord.com/oauth2/authorize?client_id=${me.id}&scope=bot&permissions=${PERMS}` };
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
const docPath = p => p.split('/').map(encodeURIComponent).join('/');
const dec = v => ('stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue
  : 'timestampValue' in v ? Date.parse(v.timestampValue) : 'mapValue' in v ? decFields(v.mapValue.fields) : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec) : 'nullValue' in v ? null : undefined);
const decFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, dec(v)]));
const enc = v => (v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : { mapValue: { fields: encFields(v) } });
// (a field set to undefined is deleted: it's in the update mask but not in the fields)
const encFields = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, enc(v)]));
async function fsGet(env, path, mask) {
  const q = new URLSearchParams({ key: env.FIREBASE_KEY || FIREBASE_KEY });
  for (const f of mask || []) q.append('mask.fieldPaths', f);
  const r = await fetch(`${fsBase(env)}/${docPath(path)}?${q}`);
  if (r.status === 404) return null;
  if (!r.ok) fail(502, 'Could not read Frixion.');
  const j = await r.json();
  return { data: decFields(j.fields), updateTime: j.updateTime };
}
// Only the fields given are changed, and only if the document is still there; with updateTime, only if it hasn't
// changed since then either. (A commit, because that's where the precondition is kept: the emulator ignores one
// passed to PATCH in the URL.)
async function fsPatch(env, path, data, updateTime) {
  const name = new URL(fsBase(env)).pathname.replace(/^\/v1\//, '') + '/' + path;
  const write = { update: { name, fields: encFields(data) }, updateMask: { fieldPaths: Object.keys(data) }, currentDocument: updateTime ? { updateTime } : { exists: true } };
  const r = await fetch(`${fsBase(env)}:commit?key=${encodeURIComponent(env.FIREBASE_KEY || FIREBASE_KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes: [write] }) });
  return r.ok;
}
// Claims a message for sending in one trip: adds 1 to its dcClaim and says what that came to. Only the request that
// gets 1 sends it. (null if the message isn't there.)
async function fsClaim(env, path) {
  const name = new URL(fsBase(env)).pathname.replace(/^\/v1\//, '') + '/' + path;
  const write = { update: { name, fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'dcClaim', increment: { integerValue: '1' } }], currentDocument: { exists: true } };
  const r = await fetch(`${fsBase(env)}:commit?key=${encodeURIComponent(env.FIREBASE_KEY || FIREBASE_KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes: [write] }) });
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
async function linkOf(env, sid, cid) {
  const k = sid + '/' + cid, hit = links.get(k);
  if (hit && Date.now() - hit.at < (hit.link ? 30000 : 3000)) return hit.link;
  const doc = await fsGet(env, `servers/${sid}/channels/${cid}`, ['discord']);
  const d = doc && doc.data.discord;
  const ok = !!(d && SNOWFLAKE.test(d.channel || '') && same(d.sig, await sign(env, sid, cid, d.channel)));
  const link = ok ? { channel: d.channel, since: SNOWFLAKE.test(d.since || '') ? d.since : snowflakeOf(Date.now() - 60000) } : null;
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
// Screens asking the same thing within a moment of each other share one answer (never an old one: that would hold
// messages back). pace, when Discord's allowance for the channel is nearly used up, is how long to wait (in ms).
const pulls = new Map();
async function pull(env, url) {
  const sid = url.searchParams.get('sid'), cid = url.searchParams.get('cid');
  if (!ID.test(sid || '') || !ID.test(cid || '')) fail(400, 'Something is missing.');
  const link = await linkOf(env, sid, cid);
  if (!link) fail(404, 'This channel isn\'t linked to Discord.');
  let after = url.searchParams.get('after') || '';
  if (!SNOWFLAKE.test(after) || BigInt(after) < BigInt(link.since)) after = link.since;
  const key = link.channel + ':' + after, hit = pulls.get(key), n = Date.now();
  if (hit && n - hit.at < 700) return hit.p;
  const b = buckets.get(link.channel);
  if (b && b.left <= 0 && b.until > n) return { last: after, messages: [], pace: b.until - n };
  const p = (async () => {
    const [list, hook, me] = await Promise.all([dc(env, 'GET', `/channels/${link.channel}/messages?after=${after}&limit=50`, null, link.channel), hookFor(env, link.channel, false).catch(() => null), botUser(env)]);
    const sorted = (list || []).slice().sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
    // not the bot's own posts (Frixion's messages, already there) or the link codes; just people talking
    const keep = m => (m.type === 0 || m.type === 19) && m.author && m.author.id !== me.id && !(m.webhook_id && ((hook && m.webhook_id === hook.id) || m.application_id === me.id)) && !/frixion-link-[a-z0-9]{6}/i.test(m.content || '');
    const nb = buckets.get(link.channel);
    return { last: sorted.length ? sorted[sorted.length - 1].id : after, messages: sorted.filter(keep).map(fromDiscord), pace: nb && nb.left <= 1 && nb.until > Date.now() ? Math.ceil(nb.until - Date.now()) : 0 };
  })();
  pulls.set(key, { at: n, p });
  p.catch(() => pulls.delete(key));
  for (const [k, v] of pulls) if (n - v.at > 10000) pulls.delete(k);
  return p;
}
