// Fresh test data for the local setup (serve.mjs and the Firebase emulators): sign-ins in the Auth emulator (password
// "pass1", stored the way Frixion does it), their profiles and accounts/ entries, a server with messages, two DMs, a
// code and the word filter, written the way the real server will write: public.fx_commit with the secret key.
// The sign-ins get no role claim, like everyone's before the switch: the site asks the server for it on the first
// request (supabaseToken() in script.js), which is part of what this tests.
// Run: node seed.mjs (after serve.mjs is up). Prints the sign-in ids.
const AUTH = 'http://127.0.0.1:9099', RTDB = 'http://127.0.0.1:9000', SB = 'http://127.0.0.1:54321', SECRET = 'local-secret-key';
const hexEmail = name => [...Buffer.from(name, 'utf8')].map(b => b.toString(16).padStart(2, '0')).join('') + '@u.frixionbeta.pages.dev';
const daysAgo = d => new Date(Date.now() - d * 86400000);
const EVERYONE = ['viewChannels', 'createExpressions', 'createInvite', 'changeNickname', 'sendMessages', 'sendMessagesInThreads',
  'createPublicThreads', 'createPrivateThreads', 'embedLinks', 'attachFiles', 'addReactions', 'useExternalEmoji', 'useExternalStickers',
  'readMessageHistory', 'sendTTS', 'sendVoiceMessages', 'createPolls', 'connect', 'speak', 'video', 'useSoundboard', 'useExternalSounds',
  'useVAD', 'useApplicationCommands', 'useActivities', 'useExternalApps', 'requestToSpeak', 'createEvents'];

// dates as the database keeps them ({"$t": ms})
const enc = v => (v instanceof Date ? { $t: v.getTime() } : Array.isArray(v) ? v.map(enc)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
async function sb(path, body) {
  const r = await fetch(SB + path, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SECRET, Authorization: 'Bearer ' + SECRET }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + JSON.stringify(j));
  return j;
}
const setDoc = (path, data) => sb('/rest/v1/rpc/fx_commit', { writes: [{ path, set: enc(data) }] }).catch(e => { throw new Error(path + ': ' + e.message); });

await fetch(`${RTDB}/.json?ns=liquidalt-default-rtdb`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
await fetch(`${AUTH}/emulator/v1/projects/liquidalt/accounts`, { method: 'DELETE' });
await sb('/local/reset', {});
const uids = {};
async function person(name, extra = {}) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: hexEmail(name), password: 'frixion:pass1', returnSecureToken: true }) });
  const j = await r.json();
  if (!j.localId) throw new Error('sign-up failed for ' + name + ': ' + JSON.stringify(j));
  uids[name] = j.localId;
  await setDoc(`users/${name}`, {
    username: name, authUid: j.localId, avatarColor: '#5865f2', status: 'online', premiumUntil: null, theme: 'dark', op: false, orbs: 50,
    stats: { messagesSent: 0, reactionsGiven: 0, dmsStarted: 0, serversCount: 0 }, dailyStats: { messagesSent: 0, reactionsGiven: 0, dmsMessaged: 0, channelsMessaged: 0 },
    claimedQuestsToday: [], bio: '', pronouns: '', bannerColor: '#5865f2', friends: [], incomingRequests: [], outgoingRequests: [],
    banned: false, banReason: '', bannedUntil: null, createdAt: daysAgo(10), ...extra });
  await setDoc(`accounts/${j.localId}`, { username: name, at: Date.now() });
}
await person('Tester', { owner: true, orbs: 3000, friends: ['Sumi', 'Air'] });
await person('Sumi', { friends: ['Tester'] });
await person('Air', { friends: ['Tester'] });
await person('Nova');

// someone who only used Continue with Google (removed): a profile, but no username sign-in
await setDoc('users/Gonly', { username: 'Gonly', authUid: 'google-only-uid', avatarColor: '#5865f2', orbs: 50, friends: [], incomingRequests: [], outgoingRequests: [], banned: false, op: false, premiumUntil: null });
await setDoc('accounts/google-only-uid', { username: 'Gonly', at: 1 });
await setDoc('servers/pcs01', { name: 'PC server', ownerId: 'Tester', inviteCode: 'pcs1', createdAt: daysAgo(9), members: ['Tester', 'Sumi', 'Air'],
  roles: [{ id: 'everyone', name: '@everyone', color: null, permissions: EVERYONE, position: 0, permsV2: true }], memberRoles: {}, bannedUsers: [] });
await setDoc('servers/pcs01/channels/general', { name: 'general', categoryId: null, autoDelete: true, createdAt: daysAgo(9) });
await setDoc('servers/pcs01/channels/general/messages/s1', { uid: 'Sumi', username: 'Sumi', text: 'hi from Sumi', createdAt: new Date(Date.now() - 60000) });
await setDoc('servers/pcs01/channels/general/messages/poll1', { uid: 'Sumi', username: 'Sumi', createdAt: new Date(Date.now() - 50000), type: 'poll',
  poll: { question: 'Pizza?', answers: [{ text: 'yes', emoji: null }, { text: 'no', emoji: null }], allowMultiple: false, expiresAt: new Date(Date.now() + 86400000), votes: {} } });
await setDoc('servers/pcs01/channels/general/messages/old1', { uid: 'Sumi', username: 'Sumi', text: 'a week old', createdAt: daysAgo(8) });
await setDoc('dms/Sumi_Tester', { participants: ['Sumi', 'Tester'], autoDelete: true, createdAt: daysAgo(5) });
await setDoc('dms/Sumi_Tester/messages/d1', { uid: 'Sumi', username: 'Sumi', text: 'psst, Tester', createdAt: new Date(Date.now() - 40000) });
await setDoc('dms/Air_Tester', { participants: ['Air', 'Tester'], autoDelete: true });
await setDoc('dms/Air_Tester/messages/a1', { uid: 'Air', username: 'Air', text: 'just between us', createdAt: new Date() });
await setDoc('redeemCodes/WELCOME', { code: 'WELCOME', type: 'orbs', value: 10, createdBy: 'Tester', maxUses: 0, uses: 0, usedBy: [], redeemedBy: null });
await setDoc('config/filter', { words: [], enabled: true });
console.log(JSON.stringify(uids));
