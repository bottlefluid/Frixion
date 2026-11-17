// A fake Discord for testing the bridge (functions/api/discord) on this computer: one server, one text channel, its
// webhooks and messages, with Discord's answers and its read allowance (5 every 5 seconds). From the earlier
// emulator harness (combo-dev.js). Test hooks: POST /test/say {author, content, attachments, reply} adds a message,
// /test/edit {id, content}, /test/delete {id}; GET /test/state shows everything it got.
import http from 'node:http';

export const BOT = { id: '900000000000000001', username: 'Frixion Bridge', bot: true, avatar: null, discriminator: '0' };
export const OWNER = { id: '920000000000000001', username: 'peterdc', global_name: 'Peter', avatar: 'abc123', discriminator: '0' };
export const GUILD = { id: '910000000000000001', name: 'Test Discord', owner_id: OWNER.id, roles: [{ id: '910000000000000001', permissions: '1024' }, { id: '911000000000000001', permissions: '8' }] };
export const CHANNEL = { id: '930000000000000001', type: 0, name: 'general', guild_id: GUILD.id };
export const TOKEN = 'test-token';

export function startFakeDiscord(port = 8789) {
  const sf = (() => { let n = 0n; return () => String(((BigInt(Date.now()) - 1420070400000n) << 22n) + (n++ % 4000n)); })();
  const S = { messages: [], hooks: [], posts: [], deleted: [], calls: [], hookEdits: [] };
  const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  function discord(req, res, body) {
    const u = new URL(req.url, 'http://x'), p = u.pathname.replace(/^\/api\/v10/, ''), M = req.method;
    if (M === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); return res.end(); }
    S.calls.push(`${M} ${p}${u.search}`);
    if (p === '/test/say' && M === 'POST') {
      const a = body.author || { id: '940000000000000001', username: 'discordpal', global_name: 'DiscordPal', avatar: 'deadbeef', discriminator: '0' };
      const ref = body.reply ? S.messages.find(m => m.id === body.reply) : null;
      const m = { id: sf(), type: ref ? 19 : 0, channel_id: CHANNEL.id, author: a, content: body.content || '', timestamp: new Date().toISOString(), edited_timestamp: null, attachments: body.attachments || [], mentions: body.mentions || [], embeds: [], referenced_message: ref || undefined };
      S.messages.push(m); return send(res, 200, m);
    }
    if (p === '/test/edit' && M === 'POST') { const m = S.messages.find(x => x.id === body.id); if (m) { m.content = body.content; m.edited_timestamp = new Date().toISOString(); } return send(res, 200, m || null); }
    if (p === '/test/delete' && M === 'POST') { S.messages = S.messages.filter(x => x.id !== body.id); return send(res, 200, { ok: true }); }
    if (p === '/test/state') return send(res, 200, S);
    if (req.headers.authorization !== 'Bot ' + TOKEN && !p.startsWith('/webhooks/')) return send(res, 401, { message: '401: Unauthorized', code: 0 });
    if (p === '/users/@me') return send(res, 200, BOT);
    let m;
    if ((m = p.match(/^\/channels\/(\d+)$/))) return m[1] === CHANNEL.id ? send(res, 200, CHANNEL) : send(res, 404, { message: 'Unknown Channel', code: 10003 });
    if ((m = p.match(/^\/guilds\/(\d+)$/))) return send(res, 200, GUILD);
    if ((m = p.match(/^\/guilds\/\d+\/members\/(\d+)$/))) return send(res, 200, { user: { id: m[1] }, roles: m[1] === '950000000000000001' ? ['911000000000000001'] : [] });
    if ((m = p.match(/^\/channels\/(\d+)\/messages$/)) && M === 'GET') {
      const now = Date.now(); S.rl = (S.rl || []).filter(x => now - x < 5000);
      if (S.rl.length >= 5) { const wait = (5000 - (now - S.rl[0])) / 1000; res.writeHead(429, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': String(wait) }); return res.end(JSON.stringify({ message: 'You are being rate limited.', retry_after: wait })); }
      S.rl.push(now);
      res.setHeader('x-ratelimit-remaining', String(5 - S.rl.length)); res.setHeader('x-ratelimit-reset-after', String((5000 - (now - S.rl[0])) / 1000));
      const after = u.searchParams.get('after'), limit = +(u.searchParams.get('limit') || 50);
      let list = S.messages.filter(x => !after || BigInt(x.id) > BigInt(after)).sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
      list = after ? list.slice(0, limit) : list.slice(-limit);
      return send(res, 200, list.reverse());   // newest first, like Discord
    }
    if ((m = p.match(/^\/channels\/\d+\/messages\/(\d+)$/)) && M === 'DELETE') { S.deleted.push(m[1]); S.messages = S.messages.filter(x => x.id !== m[1]); res.writeHead(204); return res.end(); }
    if ((m = p.match(/^\/channels\/(\d+)\/webhooks$/))) {
      if (M === 'GET') return send(res, 200, S.hooks.filter(h => h.channel_id === m[1]));
      const h = { id: sf(), token: 'hooktoken' + S.hooks.length, type: 1, name: body.name, channel_id: m[1], user: BOT, application_id: BOT.id };
      S.hooks.push(h); return send(res, 200, h);
    }
    if ((m = p.match(/^\/webhooks\/(\d+)\/(\w+)$/)) && M === 'POST') {
      const h = S.hooks.find(x => x.id === m[1] && x.token === m[2]);
      if (!h) return send(res, 404, { message: 'Unknown Webhook', code: 10015 });
      S.posts.push({ ...body, wait: u.searchParams.get('wait') });
      const msg = { id: sf(), type: 0, channel_id: h.channel_id, webhook_id: h.id, application_id: BOT.id, author: { id: h.id, username: body.username || h.name, avatar: null, bot: true, discriminator: '0000' }, content: body.content || '', timestamp: new Date().toISOString(), attachments: [], mentions: [], embeds: [] };
      S.messages.push(msg); return send(res, 200, msg);
    }
    if ((m = p.match(/^\/webhooks\/(\d+)\/(\w+)\/messages\/(\d+)$/)) && (M === 'PATCH' || M === 'DELETE')) {
      const h = S.hooks.find(x => x.id === m[1] && x.token === m[2]);
      if (!h) return send(res, 404, { message: 'Unknown Webhook', code: 10015 });
      const msg = S.messages.find(x => x.id === m[3] && x.webhook_id === h.id);
      if (!msg) return send(res, 404, { message: 'Unknown Message', code: 10008 });
      S.hookEdits.push({ method: M, id: m[3], content: body.content });
      if (M === 'DELETE') { S.messages = S.messages.filter(x => x !== msg); res.writeHead(204); return res.end(); }
      msg.content = body.content; msg.edited_timestamp = new Date().toISOString();
      return send(res, 200, msg);
    }
    send(res, 404, { message: 'Not found ' + p, code: 0 });
  }
  const readBody = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString())); });
  const server = http.createServer(async (req, res) => { const t = await readBody(req); let b = {}; try { b = t ? JSON.parse(t) : {}; } catch (e) {} discord(req, res, b); });
  server.listen(port, '127.0.0.1');
  return { server, state: S };
}
