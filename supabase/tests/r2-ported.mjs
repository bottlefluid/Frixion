// Made by make-r2-ported.js from rules2.test.js (the Firebase rule tests): the same seed data and checks, run on the
// Supabase version through r2compat.mjs. Don't edit by hand; change the generator or rules2.test.js.
import { db, uidOf, write, commit, setDoc, updateDoc, delDoc, getDoc, query, rtPut, rtDel, rtGet, allow, deny, daysAgo, section, seedMode, summary } from './r2compat.mjs';

const EVERYONE = ['viewChannels', 'createExpressions', 'createInvite', 'changeNickname', 'sendMessages', 'sendMessagesInThreads',
  'createPublicThreads', 'createPrivateThreads', 'embedLinks', 'attachFiles', 'addReactions', 'useExternalEmoji', 'useExternalStickers',
  'readMessageHistory', 'createPolls', 'useApplicationCommands'];

async function seed() {
  const user = async (name, extra = {}) => {
    await setDoc('owner', `users/${name}`, { username: name, authUid: uidOf(name), avatarColor: '#5865f2', orbs: 50, friends: [], incomingRequests: [], outgoingRequests: [], banned: false, op: false, premiumUntil: null, ...extra });
    await setDoc('owner', `accounts/${uidOf(name)}`, { username: name, at: 1 });
  };
  await user('Owner1', { owner: true });
  await user('Co', { coowner: true });
  await user('Mod', { op: true });
  await user('Alice', { orbs: 2000, friends: ['Carol', 'Dan'], ownedNameplates: ['np1'], ownedDecorations: ['halo', 'mask1'], equippedNameplate: null });
  await user('Bob', { outgoingRequests: ['Alice'], equippedDecoration: 'legacy' });
  await user('Carol', { friends: ['Alice'] });
  await user('Dan', { friends: ['Alice'] });
  await user('Eve');
  await user('Kid');
  await user('Mo');
  await user('Ad');
  await user('Rm');
  await user('Joy');
  await user('Muted', { mutedUntil: 8640000000000000 });
  await user('Banned', { banned: true, bannedUntil: null });
  await user('Expired', { banned: true, bannedUntil: Date.now() - 1000 });
  // a profile from before Orbs and the Shop existed (no orbs field, no owned lists)
  await setDoc('owner', 'users/Oldie', { username: 'Oldie', authUid: uidOf('Oldie'), avatarColor: '#5865f2', friends: [], incomingRequests: [], outgoingRequests: [], banned: false, op: false, premiumUntil: null });
  await setDoc('owner', `accounts/${uidOf('Oldie')}`, { username: 'Oldie', at: 1 });
  await updateDoc('owner', 'users/Alice', { incomingRequests: ['Bob'] });
  // a sign-in that claimed Alice's name in accounts/ before the rules got stricter (Alice's profile names her own)
  await setDoc('owner', `accounts/${uidOf('Squat')}`, { username: 'Alice', at: 1 });

  await setDoc('owner', 'servers/s1', {
    name: 'Test', ownerId: 'Alice', inviteCode: 'abcde', createdAt: new Date('2026-10-01T00:00:00Z'),
    members: ['Alice', 'Bob', 'Muted', 'Banned', 'Kid', 'Mo', 'Ad', 'Rm'], bannedUsers: ['Dan'], timeouts: { Bob: 0, Kid: 8640000000000000 },
    roles: [
      { id: 'everyone', name: '@everyone', permissions: EVERYONE, position: 0, permsV2: true },
      { id: 'r-mod', name: 'Mod', permissions: ['manageMessages', 'kickMembers'], position: 1 },
      { id: 'r-admin', name: 'Admin', permissions: ['administrator'], position: 2 },
      { id: 'r-roles', name: 'Role Manager', permissions: ['manageRoles'], position: 3 },
      { id: 'r-cool', name: 'Cool', permissions: ['addReactions'], position: 4 },
    ],
    memberRoles: { Mo: ['r-mod'], Ad: ['r-admin'], Rm: ['r-roles'] }, nicknames: {},
  });
  await setDoc('owner', 'servers/s1/channels/c1', { name: 'general', autoDelete: true });
  await setDoc('owner', 'servers/s1/channels/c3', { name: 'mods-only', overwrites: { everyone: { deny: ['viewChannels'] }, 'r-mod': { allow: ['viewChannels'] } } });
  await setDoc('owner', 'servers/s1/channels/c3/messages/h1', { uid: 'Mo', username: 'Mo', text: 'secret', createdAt: new Date() });
  await setDoc('owner', 'servers/s1/channels/c4', { name: 'announcements', overwrites: { everyone: { deny: ['sendMessages'] } } });
  await setDoc('owner', 'servers/s1/channels/c5', { name: 'old-private', visibleToRoles: ['r-mod'] });
  await setDoc('owner', 'servers/s1/threads/t5', { channelId: 'c3', name: 'secret thread', createdBy: 'Mo', messageCount: 0 });
  await setDoc('owner', 'servers/s1/threads/t5/messages/tm5', { uid: 'Mo', text: 'thread secret', createdAt: new Date() });
  await setDoc('owner', 'servers/s1/channels/c2', { name: 'bridged', autoDelete: false, discord: { channel: '111111111111111111', sig: 'abc', last: '1', since: '1' } });
  await setDoc('owner', 'servers/s1/channels/c1/messages/m1', { uid: 'Bob', username: 'Bob', text: 'hello', createdAt: new Date(), reactions: {}, attachments: [{ url: 'https://x/a.png' }] });
  await setDoc('owner', 'servers/s1/channels/c1/messages/old1', { uid: 'Bob', username: 'Bob', text: 'old', createdAt: daysAgo(8) });
  await setDoc('owner', 'servers/s1/channels/c2/messages/old2', { uid: 'Bob', username: 'Bob', text: 'old but kept', createdAt: daysAgo(8) });
  await setDoc('owner', 'servers/s1/channels/c1/messages/poll1', { uid: 'Bob', username: 'Bob', createdAt: new Date(), type: 'poll', poll: { question: 'q', answers: [{ text: 'a' }, { text: 'b' }], allowMultiple: false, votes: { Alice: [0] } } });
  await setDoc('owner', 'servers/s1/channels/c1/messages/wordle1', { uid: 'bot-wordle', username: 'Wordle', createdAt: new Date(), wordle: { puzzle: 1, startedBy: 'Bob', plays: { Bob: { guesses: ['crane'] } } } });
  await setDoc('owner', 'servers/s1/channels/c2/messages/dc_222222222222222222', { uid: 'discord:555', username: 'disco', dc: '222222222222222222', text: 'from discord', createdAt: new Date(), attachments: [{ url: 'https://cdn.discordapp.com/x.png' }] });
  await setDoc('owner', 'servers/s1/threads/t1', { channelId: 'c1', name: 'thread', starterId: 'm1', createdBy: 'Bob', messageCount: 0, lastMessageAt: new Date() });
  await setDoc('owner', 'servers/s1/threads/t1/messages/tm1', { uid: 'Bob', username: 'Bob', text: 'in thread', createdAt: new Date() });

  await setDoc('owner', 'serverCards/s1', { name: 'Test', inviteCode: 'abcde', memberCount: 8, createdAt: new Date('2026-10-01T00:00:00Z') });
  await setDoc('owner', 'servers/s6', { name: 'Old', ownerId: 'Alice', inviteCode: 'oldd', members: ['Alice', 'Bob'], roles: [{ id: 'everyone', name: '@everyone', permissions: [] }], memberRoles: {} });
  await setDoc('owner', 'servers/s6/channels/g', { name: 'general' });
  await setDoc('owner', 'dms/Alice_Bob', { participants: ['Alice', 'Bob'], autoDelete: true });
  await setDoc('owner', 'dms/Alice_Bob/messages/d1', { uid: 'Bob', text: 'hi Alice', createdAt: new Date() });
  await setDoc('owner', 'dms/Alice_Bob/messages/old1', { uid: 'Bob', text: 'old', createdAt: daysAgo(8) });
  await setDoc('owner', 'groupDMs/g1', { participants: ['Alice', 'Carol'], name: 'pals', ownerId: 'Alice' });
  await setDoc('owner', 'groupDMs/g1/messages/gm1', { uid: 'Carol', text: 'yo', createdAt: new Date() });

  await setDoc('owner', 'redeemCodes/CODE1', { code: 'CODE1', type: 'orbs', value: 100, createdBy: 'Mod', maxUses: 1, uses: 0, usedBy: [], redeemedBy: null });
  await setDoc('owner', 'redeemCodes/OLDONE', { code: 'OLDONE', type: 'orbs', value: 100, createdBy: 'Mod', redeemedBy: 'Bob' });
  await setDoc('owner', 'redeemCodes/MULTI', { code: 'MULTI', type: 'orbs', value: 5, createdBy: 'Mod', maxUses: 0, uses: 2, usedBy: ['Bob', 'Dan'], redeemedBy: 'Dan' });
  await setDoc('owner', 'config/filter', { words: ['badword'] });
  await setDoc('owner', 'devices/dev_aaaa', { id: 'dev_aaaa', accounts: ['Alice'], banned: false });
  await setDoc('owner', 'devices/dev_bbbb', { id: 'dev_bbbb', accounts: ['Carol'], banned: true, banReason: 'x' });
  await setDoc('owner', 'pushSubs/p1', { uid: 'Bob', endpoint: 'https://push.example/bob', p256dh: 'k', auth: 'a', muted: [] });
  await setDoc('owner', 'discordLinks/s1__c2', { sid: 's1', cid: 'c2', channel: '111111111111111111', at: 1, seen: 'x' });
  await setDoc('owner', 'rngSaves/Alice', { rolls: 5, name: 'Alice' });
  await setDoc('owner', 'rngCodes/RNG1', { reward: { rolls: 10 }, maxUses: 5, uses: 1 });
}

(async () => {
  seedMode(true); await seed(); seedMode(false);

  section('Who is asking');
  await deny('signed-out visitor reads a profile', getDoc(null, 'users/Bob'));
  await allow("Alice reads Bob's profile", getDoc('Alice', 'users/Bob'));
  await allow('a new sign-in with no account yet checks a name is free', getDoc('Fresh', 'users/Bob'));
  await deny('signed-out visitor lists the stickers', query(null, '', 'stickers'));
  await deny('signed-out visitor reads the word filter list', query(null, '', 'config'));
  await allow('Alice lists the stickers', query('Alice', '', 'stickers'));
  await deny('signed-out visitor lists every profile', query(null, '', 'users'));
  await allow('Alice lists profiles (games, leaderboards)', query('Alice', '', 'users'));
  await deny('a sign-in whose accounts/ entry claims Alice edits her bio', updateDoc('Squat', 'users/Alice', { bio: 'pwned' }));
  await deny('...and reads her DMs', query('Squat', 'dms/Alice_Bob', 'messages'));
  await deny('...and posts as her', setDoc('Squat', 'servers/s1/channels/c1/messages/sq1', { uid: 'Alice', text: 'hi', createdAt: new Date() }));
  await deny('Eve claims Alice\'s name for another sign-in', setDoc('Eve2', `accounts/${uidOf('Eve2')}`, { username: 'Alice', at: 1 }));
  await deny('a sign-in claims a name with no profile yet', setDoc('Ghost', `accounts/${uidOf('Ghost')}`, { username: 'Ghost', at: 1 }));
  await deny('Eve changes which account her sign-in is', updateDoc('Eve', `accounts/${uidOf('Eve')}`, { username: 'Alice' }));
  await deny('Bob reads Alice\'s accounts/ entry', getDoc('Bob', `accounts/${uidOf('Alice')}`));
  await allow('Alice reads her own accounts/ entry', getDoc('Alice', `accounts/${uidOf('Alice')}`));
  await allow('Newbie signs up: the profile first...', setDoc('Newbie', 'users/Newbie', { username: 'Newbie', authUid: uidOf('Newbie'), op: false, banned: false, premiumUntil: null, orbs: 50 }));
  await allow('...then its accounts/ entry', setDoc('Newbie', `accounts/${uidOf('Newbie')}`, { username: 'Newbie', at: 1 }));
  await deny('Newbie makes a second profile', setDoc('Newbie', 'users/Newbie2', { username: 'Newbie2', authUid: uidOf('Newbie'), op: false, orbs: 50 }));
  await deny('new sign-in Sneaky makes itself an admin', setDoc('Sneaky', 'users/Sneaky', { username: 'Sneaky', authUid: uidOf('Sneaky'), op: true, orbs: 50 }));
  await deny('new sign-in Rich starts with 999999 Orbs', setDoc('Rich', 'users/Rich', { username: 'Rich', authUid: uidOf('Rich'), orbs: 999999 }));
  await deny('new sign-in makes a profile tied to another sign-in', setDoc('Rich', 'users/Rich', { username: 'Rich', authUid: uidOf('Alice'), orbs: 50 }));
  await deny('new sign-in starts out owning Shop items (v4.57)', setDoc('Rich', 'users/Rich', { username: 'Rich', authUid: uidOf('Rich'), orbs: 50, ownedThemes: ['aurora'] }));
  await deny('...or wearing one', setDoc('Rich', 'users/Rich', { username: 'Rich', authUid: uidOf('Rich'), orbs: 50, equippedDecoration: 'halo' }));
  await deny('...or with a two-color banner (Premium)', setDoc('Rich', 'users/Rich', { username: 'Rich', authUid: uidOf('Rich'), orbs: 50, bannerColor: 'linear-gradient(135deg,#123456,#654321)' }));
  await deny('...or with Orbs written as text', setDoc('Rich', 'users/Rich', { username: 'Rich', authUid: uidOf('Rich'), orbs: '50' }));

  section('Your own profile');
  await allow('Alice edits her bio', updateDoc('Alice', 'users/Alice', { bio: 'hi' }));
  await deny('Alice makes herself an admin', updateDoc('Alice', 'users/Alice', { op: true }));
  await deny('Alice makes herself owner', updateDoc('Alice', 'users/Alice', { owner: true }));
  await deny('Alice changes the sign-in on her profile', updateDoc('Alice', 'users/Alice', { authUid: 'someone-else' }));
  await deny('Muted unmutes themself', updateDoc('Muted', 'users/Muted', { mutedUntil: null }));
  await deny('Banned unbans themself (no end date)', updateDoc('Banned', 'users/Banned', { banned: false, banReason: '', bannedUntil: null }));
  await allow('Expired clears their finished ban', updateDoc('Expired', 'users/Expired', { banned: false, banReason: '', bannedUntil: null }));
  section('Orbs, Premium and Shop items on your own profile (v4.57)');
  await deny('Alice gives herself Orbs', updateDoc('Alice', 'users/Alice', { orbs: 999999 }));
  await deny('...with an increment', commit('Alice', [write('users/Alice', { inc: { orbs: 100 } })]));
  await allow('Alice spends Orbs (a game\'s cost)', commit('Alice', [write('users/Alice', { inc: { orbs: -10 } })]));
  await deny('Alice spends more than she has', updateDoc('Alice', 'users/Alice', { orbs: -5 }));
  await deny('Alice deletes her Orbs (to get 50 again)', commit('Alice', [write('users/Alice', { merge: ['orbs'], exists: true })]));
  await deny('Alice saves her Orbs as text', updateDoc('Alice', 'users/Alice', { orbs: '999999' }));
  await allow('a profile from before Orbs gets the 50 new accounts start with', commit('Oldie', [write('users/Oldie', { set: { orbs: 50, ownedDecorations: [], equippedDecoration: null, ownedMusic: [], equippedMusic: null }, merge: ['orbs', 'ownedDecorations', 'equippedDecoration', 'ownedMusic', 'equippedMusic'], exists: true })]));
  await deny('...but no more than that', updateDoc('Joy', 'users/Joy', { orbs: 51 }));
  await deny('Alice gives herself Premium', updateDoc('Alice', 'users/Alice', { premiumUntil: Date.now() + 365 * 86400000 }));
  await deny('Alice clears her Premium field', commit('Alice', [write('users/Alice', { merge: ['premiumUntil'], exists: true })]));
  await deny('Alice adds a Shop item to what she owns', commit('Alice', [write('users/Alice', { union: { ownedThemes: ['aurora'] } })]));
  await deny('...or swaps one for another', updateDoc('Alice', 'users/Alice', { ownedNameplates: ['np2'] }));
  await deny('Alice wears an item she doesn\'t own', updateDoc('Alice', 'users/Alice', { equippedDecoration: 'crown' }));
  await deny('...as a mask', updateDoc('Alice', 'users/Alice', { equippedMask: 'crown' }));
  await allow('Alice wears an item she owns', updateDoc('Alice', 'users/Alice', { equippedNameplate: 'np1' }));
  await allow('...and a mask she owns', updateDoc('Alice', 'users/Alice', { equippedMask: 'mask1' }));
  await allow('...and takes it off', updateDoc('Alice', 'users/Alice', { equippedNameplate: null }));
  await allow('Alice lets go of an item', commit('Alice', [write('users/Alice', { remove: { ownedNameplates: ['np1'] } })]));
  await allow('Bob still wears an item from before (only a slot that changes is checked)', updateDoc('Bob', 'users/Bob', { bio: 'still wearing it', equippedNameplate: null }));
  await deny('Bob switches to another item he does not own', updateDoc('Bob', 'users/Bob', { equippedDecoration: 'legacy2' }));
  await deny('Alice saves a plain password on her profile', updateDoc('Alice', 'users/Alice', { password: 'x' }));
  await deny('Alice deletes her own account without the owner\'s flag', delDoc('Alice', 'users/Alice'));

  section('Someone else\'s profile');
  await deny('Eve edits Bob\'s bio', updateDoc('Eve', 'users/Bob', { bio: 'pwned' }));
  await deny('Eve gives Bob 0 Orbs', updateDoc('Eve', 'users/Bob', { orbs: 0 }));
  await allow('Carol sends Bob a friend request (both sides, one batch)', commit('Carol', [write('users/Carol', { union: { outgoingRequests: ['Bob'] } }), write('users/Bob', { union: { incomingRequests: ['Carol'] } })]));
  await deny('Carol adds someone else to Bob\'s requests', commit('Carol', [write('users/Bob', { union: { incomingRequests: ['Dan'] } })]));
  await deny('Dan adds himself to Bob\'s friends with no request', commit('Dan', [write('users/Bob', { union: { friends: ['Dan'] } })]));
  await allow('Alice accepts Bob\'s request (both sides, one batch)', commit('Alice', [
    write('users/Alice', { remove: { incomingRequests: ['Bob'] }, union: { friends: ['Bob'] } }),
    write('users/Bob', { remove: { outgoingRequests: ['Alice'] }, union: { friends: ['Alice'] } })]));
  await allow('Alice removes Bob as a friend (both sides)', commit('Alice', [write('users/Alice', { remove: { friends: ['Bob'] } }), write('users/Bob', { remove: { friends: ['Alice'] } })]));
  await allow('Alice writes her private note about Bob', setDoc('Alice', 'users/Bob/privateNotes/Alice', { text: 'nice' }));
  await deny('Carol reads Alice\'s private note about Bob', getDoc('Carol', 'users/Bob/privateNotes/Alice'));
  await deny('Bob reads Alice\'s private note about him', getDoc('Bob', 'users/Bob/privateNotes/Alice'));
  await allow('Alice saves what she has read', setDoc('Alice', 'users/Alice/meta/read', { 'ch:s1:c1': 5 }));
  await deny('Bob reads what Alice has read', getDoc('Bob', 'users/Alice/meta/read'));

  section('Mentions');
  const note = extra => ({ set: { sid: 's1', cid: 'c1', tid: null, mid: 'm1', from: 'Bob', text: 'hi @Alice', server: 'Test', channel: 'general', thread: '', ...extra }, serverTime: ['at'], full: true });
  await allow('Bob mentions Alice (both in the server)', commit('Bob', [write('users/Alice/mentions/mn1', note({}))]));
  await deny("Bob's mention note says it came from another server", commit('Bob', [write('users/Alice/mentions/mn7', note({ server: 'Frixion Official' }))]));
  await deny('...or another channel', commit('Bob', [write('users/Alice/mentions/mn8', note({ channel: 'announcements' }))]));
  await deny('...or is backdated', setDoc('Bob', 'users/Alice/mentions/mn9', { sid: 's1', cid: 'c1', tid: null, mid: 'm1', from: 'Bob', text: 'hi', server: 'Test', channel: 'general', thread: '', at: daysAgo(3) }));
  await deny('Bob leaves a mention signed as Kid', setDoc('Bob', 'users/Alice/mentions/mn2', { sid: 's1', cid: 'c1', mid: 'm1', from: 'Kid', text: 'x' }));
  await deny('Bob leaves a mention about a message that isn\'t his', setDoc('Bob', 'users/Alice/mentions/mn4', { sid: 's1', cid: 'c1', mid: 'wordle1', from: 'Bob', text: 'x' }));
  await deny('Eve (not in the server) mentions Alice', setDoc('Eve', 'users/Alice/mentions/mn3', { sid: 's1', cid: 'c1', mid: 'm1', from: 'Eve', text: 'spam' }));
  await allow('Alice reads her mentions', query('Alice', 'users/Alice', 'mentions'));
  await deny('Bob reads Alice\'s mentions', query('Bob', 'users/Alice', 'mentions'));
  await allow('Alice clears a mention', delDoc('Alice', 'users/Alice/mentions/mn1'));

  section('Staff');
  await allow('Mod (admin) bans Carol', updateDoc('Mod', 'users/Carol', { banned: true, banReason: 'spam', bannedUntil: null }));
  await allow('Mod (admin) gives Carol Orbs', commit('Mod', [write('users/Carol', { inc: { orbs: 10 } })]));
  await allow('Mod (admin) gives Carol Premium days', updateDoc('Mod', 'users/Carol', { premiumUntil: Date.now() + 3 * 86400000 }));
  await deny('Mod (admin) gives Carol a Shop item (admins: Orbs, Premium, bans and mutes)', commit('Mod', [write('users/Carol', { union: { ownedThemes: ['aurora'] } })]));
  await allow('Co (co-owner) gives Kid a Shop item', commit('Co', [write('users/Kid', { union: { ownedThemes: ['aurora'] } })]));
  await deny('Mod (admin) makes Carol an admin', updateDoc('Mod', 'users/Carol', { op: true }));
  await deny('Mod (admin) makes Carol a co-owner', updateDoc('Mod', 'users/Carol', { coowner: true }));
  await deny('Mod (admin) redirects Carol (co-owner and up)', updateDoc('Mod', 'users/Carol', { redirectUrl: 'https://x.com', redirectNonce: 1 }));
  await deny('Mod (admin) bans the Owner', updateDoc('Mod', 'users/Owner1', { banned: true }));
  await deny('Co (co-owner) bans the Owner', updateDoc('Co', 'users/Owner1', { banned: true }));
  await allow('Co (co-owner) makes Kid an admin', updateDoc('Co', 'users/Kid', { op: true }));
  await allow('Co (co-owner) takes it away again', updateDoc('Co', 'users/Kid', { op: false }));
  await deny('Co (co-owner) makes Kid a co-owner', updateDoc('Co', 'users/Kid', { coowner: true }));
  await deny('Co (co-owner) moves Kid\'s profile to another sign-in', updateDoc('Co', 'users/Kid', { authUid: uidOf('Eve') }));
  await deny('nobody can change who is Owner, not even the Owner', updateDoc('Owner1', 'users/Mod', { owner: true }));
  await allow('Owner redirects Dan', updateDoc('Owner1', 'users/Dan', { redirectUrl: 'https://example.com', redirectNonce: 1 }));
  await allow('Dan\'s app clears the redirect after following it', commit('Dan', [write('users/Dan', { merge: ['redirectUrl', 'redirectNonce'], exists: true })]));
  await deny('Dan sets a redirect on himself', updateDoc('Dan', 'users/Dan', { redirectUrl: 'https://x.com', redirectNonce: 2 }));

  section('Things staff publish');
  await allow('Alice reads the filter list', getDoc('Alice', 'config/filter'));
  await deny('signed-out visitor reads the filter list', getDoc(null, 'config/filter'));
  await deny('Alice changes the filter list', setDoc('Alice', 'config/filter', { words: [] }));
  await deny('Alice publishes a custom emoji', setDoc('Alice', 'customEmojis/lol', { name: 'lol', dataUrl: 'data:image/png;base64,AA' }));
  await allow('Mod publishes a custom emoji', setDoc('Mod', 'customEmojis/lol', { name: 'lol', dataUrl: 'data:image/png;base64,AA' }));
  await deny('Alice adds a Shop theme', setDoc('Alice', 'shopThemes/t1', { name: 'x', price: 0 }));
  await deny('Alice adds a garden seed', setDoc('Alice', 'gardenSeeds/s1', { name: 'x' }));

  section('Codes');
  await deny('Alice looks up a code someone else made (v4.57: using one happens in the function)', getDoc('Alice', 'redeemCodes/CODE1'));
  await allow('Alice checks a new code name is free (buying one)', getDoc('Alice', 'redeemCodes/NOPE1'));
  await allow('Mod looks up any code', getDoc('Mod', 'redeemCodes/CODE1'));
  await deny('Alice lists every code', query('Alice', '', 'redeemCodes'));
  await deny('Alice redeems CODE1 herself, code + reward in one transaction (the function does it now)', commit('Alice', [
    write('redeemCodes/CODE1', { set: { uses: 1, usedBy: ['Alice'], redeemedBy: 'Alice' }, merge: ['uses', 'usedBy', 'redeemedBy'], serverTime: ['redeemedAt'] }),
    write('users/Alice', { inc: { orbs: 100 } })]));
  await deny('...or just marks it used', commit('Alice', [write('redeemCodes/CODE1', { set: { uses: 1, usedBy: ['Alice'], redeemedBy: 'Alice' }, merge: ['uses', 'usedBy', 'redeemedBy'], serverTime: ['redeemedAt'] })]));
  await deny('Bob redeems CODE1 a second time (used up)', commit('Bob', [write('redeemCodes/CODE1', { set: { uses: 2, usedBy: ['Alice', 'Bob'], redeemedBy: 'Bob' }, merge: ['uses', 'usedBy', 'redeemedBy'] })]));
  await deny('Carol redeems an old code Bob already used', commit('Carol', [write('redeemCodes/OLDONE', { set: { uses: 2, usedBy: ['Bob', 'Carol'], redeemedBy: 'Carol' }, merge: ['uses', 'usedBy', 'redeemedBy'] })]));
  await deny('Carol redeems an unlimited code herself (the function does it now)', commit('Carol', [write('redeemCodes/MULTI', { set: { uses: 3, usedBy: ['Bob', 'Dan', 'Carol'], redeemedBy: 'Carol' }, merge: ['uses', 'usedBy', 'redeemedBy'] })]));
  await deny('Bob redeems the unlimited code twice', commit('Bob', [write('redeemCodes/MULTI', { set: { uses: 4, usedBy: ['Bob', 'Dan', 'Carol', 'Bob'], redeemedBy: 'Bob' }, merge: ['uses', 'usedBy', 'redeemedBy'] })]));
  await deny('Carol resets a code\'s users', commit('Carol', [write('redeemCodes/MULTI', { set: { uses: 0, usedBy: [] }, merge: ['uses', 'usedBy'] })]));
  await allow('Alice buys a Premium code, paying 1400 Orbs in the same transaction', commit('Alice', [
    write('users/Alice', { inc: { orbs: -1400 } }),
    write('redeemCodes/BUY1', { set: { code: 'BUY1', type: 'premium', value: 3, createdBy: 'Alice', maxUses: 1, uses: 0, usedBy: [], redeemedBy: null, redeemedAt: null }, exists: false })]));
  await deny('Alice makes a Premium code without paying', setDoc('Alice', 'redeemCodes/FREE1', { code: 'FREE1', type: 'premium', value: 3, createdBy: 'Alice', maxUses: 1, uses: 0, usedBy: [], redeemedBy: null }));
  await deny('Alice makes an Orbs code', commit('Alice', [write('users/Alice', { inc: { orbs: -1400 } }), write('redeemCodes/FREE2', { set: { code: 'FREE2', type: 'orbs', value: 99999, createdBy: 'Alice', redeemedBy: null }, exists: false })]));
  await allow('Mod makes any code', setDoc('Mod', 'redeemCodes/MOD1', { code: 'MOD1', type: 'orbs', value: 500, createdBy: 'Mod', redeemedBy: null }));
  await allow('Alice reads the code she bought', getDoc('Alice', 'redeemCodes/BUY1'));
  await deny('Bob reads the code Alice bought', getDoc('Bob', 'redeemCodes/BUY1'));

  section('Orbs from games and Shop prices (v4.57)');
  await setDoc('owner', 'orbDays/Alice', { day: '2026-11-06', got: 500 });
  await allow('Alice reads how many Orbs games paid her today', getDoc('Alice', 'orbDays/Alice'));
  await deny('Bob reads Alice\'s', getDoc('Bob', 'orbDays/Alice'));
  await allow('Mod reads Alice\'s', getDoc('Mod', 'orbDays/Alice'));
  await deny('Alice resets her count to 0 (only the function writes it)', setDoc('Alice', 'orbDays/Alice', { day: '2026-11-06', got: 0 }));
  await deny('Alice deletes her count', delDoc('Alice', 'orbDays/Alice'));
  await deny('the Owner writes one from a page', setDoc('Owner1', 'orbDays/Bob', { day: '2026-11-06', got: 0 }));
  await deny('Bob lists everyone\'s', query('Bob', '', 'orbDays'));
  await allow('Alice reads the built-in Shop prices', getDoc('Alice', 'shopPrices/builtin'));
  await deny('Alice makes everything free', setDoc('Alice', 'shopPrices/builtin', { v: '9.99', p: { decorations: { halo: 0 } } }));
  await deny('Mod (admin) changes them', setDoc('Mod', 'shopPrices/builtin', { v: '9.99', p: { decorations: { halo: 0 } } }));
  await allow('Co (co-owner) saves them (syncShopPrices())', setDoc('Co', 'shopPrices/builtin', { v: '4.57', p: { decorations: { halo: 500 } } }));

  section('Device bans');
  await allow('signed-out visitor checks their device', getDoc(null, 'devices/dev_bbbb'));
  await allow('Alice records her device visit', commit('Alice', [write('devices/dev_aaaa', { set: { id: 'dev_aaaa', lastSeen: Date.now() }, merge: ['id', 'lastSeen'], union: { accounts: ['Alice'] } })]));
  await allow('Alice registers a new device', commit('Alice', [write('devices/dev_cccc', { set: { id: 'dev_cccc', lastSeen: Date.now() }, merge: ['id', 'lastSeen'], union: { accounts: ['Alice'] } })]));
  await deny('Eve registers a device in Alice\'s name too', setDoc('Eve', 'devices/dev_eeee', { id: 'dev_eeee', accounts: ['Eve', 'Alice'], banned: false }));
  await deny('Carol unbans her own device', updateDoc('Carol', 'devices/dev_bbbb', { banned: false, banReason: '' }));
  await deny('Eve bans Alice\'s device', updateDoc('Eve', 'devices/dev_aaaa', { banned: true, banReason: 'x' }));
  await allow('Alice\'s app bans its own device (ban-evasion check)', updateDoc('Alice', 'devices/dev_cccc', { banned: true, banReason: 'Same device', bannedBy: 'auto', bannedAt: 1, autoBanned: true }));
  await allow('Alice lists the devices she has used', query('Alice', '', 'devices', ['accounts', 'ARRAY_CONTAINS', 'Alice']));
  await deny('Alice lists every device', query('Alice', '', 'devices'));
  await allow('Owner unbans a device', updateDoc('Owner1', 'devices/dev_bbbb', { banned: false }));

  section('Servers');
  await deny('Carol (not a member) reads the server itself', getDoc('Carol', 'servers/s1'));
  await allow('Carol sees its card in Explore', getDoc('Carol', 'serverCards/s1'));
  await allow('Carol lists the cards', query('Carol', '', 'serverCards'));
  await deny('signed-out visitor sees the card', getDoc(null, 'serverCards/s1'));
  await deny('Carol lists every server', query('Carol', '', 'servers'));
  await allow('Bob lists the servers he is in', query('Bob', '', 'servers', ['members', 'ARRAY_CONTAINS', 'Bob']));
  await allow('Mod (Frixion staff) lists every server (Admin Panel)', query('Mod', '', 'servers'));
  await allow('Bob (member) writes the card as it is', setDoc('Bob', 'serverCards/s1', { name: 'Test', inviteCode: 'abcde', memberCount: 8, createdAt: new Date('2026-10-01T00:00:00Z') }));
  await deny('Bob writes a card that lies about it', setDoc('Bob', 'serverCards/s1', { name: 'Free Nitro', inviteCode: 'abcde', memberCount: 9999, createdAt: new Date('2026-10-01T00:00:00Z') }));
  await deny('Carol (not a member) writes its card', setDoc('Carol', 'serverCards/s1', { name: 'Test', inviteCode: 'abcde', memberCount: 8, createdAt: new Date('2026-10-01T00:00:00Z') }));
  await deny('Carol (not a member) reads its channels', query('Carol', 'servers/s1', 'channels'));
  await deny('Carol (not a member) reads its messages', query('Carol', 'servers/s1/channels/c1', 'messages'));
  await allow('Bob (member) reads its messages', query('Bob', 'servers/s1/channels/c1', 'messages'));
  await allow('Mod (Frixion staff) reads its channels (Admin Panel)', query('Mod', 'servers/s1', 'channels'));
  await allow('Joy joins the server', commit('Joy', [write('servers/s1', { union: { members: ['Joy'] } })]));
  await deny('Carol (banned from Frixion) joins the server', commit('Carol', [write('servers/s1', { union: { members: ['Carol'] } })]));
  await deny('Dan (banned from it) joins the server', commit('Dan', [write('servers/s1', { union: { members: ['Dan'] } })]));
  await deny('Eve adds someone else while joining', commit('Eve', [write('servers/s1', { union: { members: ['Eve', 'Owner1'] } })]));
  await deny('Bob takes over the server', updateDoc('Bob', 'servers/s1', { ownerId: 'Bob' }));
  await deny('Ad (Administrator role) takes over the server', updateDoc('Ad', 'servers/s1', { ownerId: 'Ad' }));
  await deny('Bob changes its invite code', updateDoc('Bob', 'servers/s1', { inviteCode: 'zzzz' }));
  await deny('Kid (no role) renames it', updateDoc('Kid', 'servers/s1', { name: 'pwned' }));
  await deny('Mo (Manage Messages, Kick) renames it', updateDoc('Mo', 'servers/s1', { name: 'pwned' }));
  await allow('Alice (its owner) renames it', updateDoc('Alice', 'servers/s1', { name: 'Test 2' }));
  await allow('Ad (Administrator role) renames it', updateDoc('Ad', 'servers/s1', { name: 'Test 3' }));
  await deny('Kid gives himself the Administrator role', updateDoc('Kid', 'servers/s1', { memberRoles: { Mo: ['r-mod'], Ad: ['r-admin'], Kid: ['r-admin'] } }));
  await deny('Kid edits the roles', updateDoc('Kid', 'servers/s1', { roles: [{ id: 'everyone', permissions: ['administrator'] }] }));
  await deny('Kid kicks Bob', commit('Kid', [write('servers/s1', { remove: { members: ['Bob'] } })]));
  await deny('Kid wipes the member list', updateDoc('Kid', 'servers/s1', { members: [] }));
  await allow('Mo (Kick Members) kicks Muted', commit('Mo', [write('servers/s1', { remove: { members: ['Muted'] } })]));
  await deny('Mo bans Kid (no Ban Members)', commit('Mo', [write('servers/s1', { set: { banInfo: { Kid: { by: 'Mo' } } }, merge: ['banInfo.Kid'], remove: { members: ['Kid'] }, union: { bannedUsers: ['Kid'] } })]));
  await deny('Mo times Bob out (no Timeout Members)', commit('Mo', [write('servers/s1', { set: { timeouts: { Bob: 9 } }, merge: ['timeouts.Bob'] })]));
  await allow('Kid sets his own nickname', commit('Kid', [write('servers/s1', { set: { nicknames: { Kid: 'kiddo' } }, merge: ['nicknames.Kid'] })]));
  await deny('Kid sets Bob\'s nickname', commit('Kid', [write('servers/s1', { set: { nicknames: { Bob: 'dork' } }, merge: ['nicknames.Bob'] })]));
  await allow('Kid vanishes', commit('Kid', [write('servers/s1', { union: { vanished: ['Kid'] } })]));
  await deny('Kid (no moderation permission) rewrites the audit log', updateDoc('Kid', 'servers/s1', { auditLog: [] }));
  await allow('Mo (a moderator) keeps the audit log', updateDoc('Mo', 'servers/s1', { auditLog: [{ at: 1, by: 'Mo', action: 'kicked Muted' }] }));
  await deny('Rm (Manage Roles) gives himself the Administrator role', updateDoc('Rm', 'servers/s1', { memberRoles: { Mo: ['r-mod'], Ad: ['r-admin'], Rm: ['r-roles', 'r-admin'] } }));
  await deny('Rm makes his own role Administrator', commit('Rm', [write('servers/s1', { set: { roles: [
      { id: 'everyone', name: '@everyone', permissions: ['viewChannels', 'sendMessages', 'addReactions'], position: 0, permsV2: true },
      { id: 'r-mod', name: 'Mod', permissions: ['manageMessages', 'kickMembers'], position: 1 },
      { id: 'r-admin', name: 'Admin', permissions: ['administrator'], position: 2 },
      { id: 'r-roles', name: 'Role Manager', permissions: ['manageRoles', 'administrator'], position: 3 },
      { id: 'r-cool', name: 'Cool', permissions: ['addReactions'], position: 4 }] }, merge: ['roles'], exists: true })]));
  await deny('Rm gives Kid the Cool role (it ranks above his own)', updateDoc('Rm', 'servers/s1', { memberRoles: { Mo: ['r-mod'], Ad: ['r-admin'], Rm: ['r-roles'], Kid: ['r-cool'] }, roleEdit: { m: 'Kid', i: 4, j: 3 } }));
  await deny('Rm says the Cool role is the Mod role', updateDoc('Rm', 'servers/s1', { memberRoles: { Mo: ['r-mod'], Ad: ['r-admin'], Rm: ['r-roles'], Kid: ['r-cool'] }, roleEdit: { m: 'Kid', i: 1, j: 3 } }));
  await deny('Rm gives Kid the Mod role without saying whose roles changed', updateDoc('Rm', 'servers/s1', { memberRoles: { Mo: ['r-mod'], Ad: ['r-admin'], Rm: ['r-roles'], Kid: ['r-mod'] } }));
  await deny('Rm changes two members at once', updateDoc('Rm', 'servers/s1', { memberRoles: { Mo: [], Ad: ['r-admin'], Rm: ['r-roles'], Kid: ['r-mod'] }, roleEdit: { m: 'Kid', i: 1, j: 3 } }));
  await allow('Rm gives Kid the Mod role (it ranks below his own)', updateDoc('Rm', 'servers/s1', { memberRoles: { Mo: ['r-mod'], Ad: ['r-admin'], Rm: ['r-roles'], Kid: ['r-mod'] }, roleEdit: { m: 'Kid', i: 1, j: 3 } }));
  await deny('Rm gives Kid the Admin role too, claiming the Mod role is his own', updateDoc('Rm', 'servers/s1', { memberRoles: { Mo: ['r-mod'], Ad: ['r-admin'], Rm: ['r-roles'], Kid: ['r-mod', 'r-admin'] }, roleEdit: { m: 'Kid', i: 2, j: 1 } }));
  await deny('Rm gives Kid two roles in one go', updateDoc('Rm', 'servers/s1', { memberRoles: { Mo: ['r-mod'], Ad: ['r-admin'], Rm: ['r-roles'], Kid: ['r-mod', 'r-admin', 'everyone'] }, roleEdit: { m: 'Kid', i: 2, j: 3 } }));
  await allow('Ad (Administrator) gives Kid the Cool role instead', updateDoc('Ad', 'servers/s1', { memberRoles: { Mo: ['r-mod'], Ad: ['r-admin'], Rm: ['r-roles'], Kid: ['r-cool'] }, roleEdit: { m: 'Kid', i: 1, j: 3 } }));
  await deny('Rm takes the Cool role off Kid (it ranks above his own)', updateDoc('Rm', 'servers/s1', { memberRoles: { Mo: ['r-mod'], Ad: ['r-admin'], Rm: ['r-roles'], Kid: [] }, roleEdit: { m: 'Kid', i: 4, j: 3 } }));
  await deny('Rm (Manage Roles) recolors a role (only the owner and Administrators edit roles)', commit('Rm', [write('servers/s1', { set: { roles: [
      { id: 'everyone', name: '@everyone', permissions: ['viewChannels', 'sendMessages', 'addReactions'], position: 0, permsV2: true },
      { id: 'r-mod', name: 'Mod', permissions: ['manageMessages', 'kickMembers'], position: 1 },
      { id: 'r-admin', name: 'Admin', permissions: ['administrator'], position: 2 },
      { id: 'r-roles', name: 'Role Manager', permissions: ['manageRoles'], position: 3 },
      { id: 'r-cool', name: 'Cool', permissions: ['addReactions'], position: 4, color: '#ff0000' }] }, merge: ['roles'], exists: true })]));
  await allow('Ad (Administrator) makes a role Administrator', commit('Ad', [write('servers/s1', { set: { roles: [
      { id: 'everyone', name: '@everyone', permissions: ['viewChannels', 'sendMessages', 'addReactions'], position: 0, permsV2: true },
      { id: 'r-mod', name: 'Mod', permissions: ['manageMessages', 'kickMembers', 'administrator'], position: 1 },
      { id: 'r-admin', name: 'Admin', permissions: ['administrator'], position: 2 },
      { id: 'r-roles', name: 'Role Manager', permissions: ['manageRoles'], position: 3 },
      { id: 'r-cool', name: 'Cool', permissions: ['addReactions'], position: 4, color: '#ff0000' }] }, merge: ['roles'], exists: true })]));
  await allow('...and takes it back', commit('Ad', [write('servers/s1', { set: { roles: [
      { id: 'everyone', name: '@everyone', permissions: ['viewChannels', 'sendMessages', 'addReactions'], position: 0, permsV2: true },
      { id: 'r-mod', name: 'Mod', permissions: ['manageMessages', 'kickMembers'], position: 1 },
      { id: 'r-admin', name: 'Admin', permissions: ['administrator'], position: 2 },
      { id: 'r-roles', name: 'Role Manager', permissions: ['manageRoles'], position: 3 },
      { id: 'r-cool', name: 'Cool', permissions: ['addReactions'], position: 4, color: '#ff0000' }] }, merge: ['roles'], exists: true })]));
  await deny('Kid adds the Sapphire app (owner only)', commit('Kid', [write('servers/s1', { union: { apps: ['sapphire'] } })]));
  await allow('Alice adds the Sapphire app', commit('Alice', [write('servers/s1', { union: { apps: ['sapphire'] } })]));
  await allow('Eve makes her own server', setDoc('Eve', 'servers/s2', { name: 'Eve', ownerId: 'Eve', members: ['Eve'], inviteCode: 'evee', roles: [], memberRoles: {}, bannedUsers: [] }, { serverTime: ['createdAt'], full: true, exists: false }));
  await deny('Eve makes a server that says it\'s older (to steal an invite code)', setDoc('Eve', 'servers/s3', { name: 'Eve', ownerId: 'Eve', members: ['Eve'], inviteCode: 'abcde', createdAt: daysAgo(99), memberRoles: {}, bannedUsers: [] }));
  await deny('Eve makes a server owned by Alice', setDoc('Eve', 'servers/s4', { name: 'x', ownerId: 'Alice', members: ['Alice'], inviteCode: 'qqqq', memberRoles: {}, bannedUsers: [] }, { serverTime: ['createdAt'], full: true, exists: false }));
  await deny('Kid deletes the server', delDoc('Kid', 'servers/s2'));

  section('Channels and threads');
  await deny('Kid makes a channel', setDoc('Kid', 'servers/s1/channels/c9', { name: 'x', createdAt: new Date() }));
  await allow('Alice makes a channel', setDoc('Alice', 'servers/s1/channels/c9', { name: 'x', createdAt: new Date() }));
  await allow('Ad (Administrator) renames it', updateDoc('Ad', 'servers/s1/channels/c9', { name: 'y' }));
  await deny('Kid renames a channel', updateDoc('Kid', 'servers/s1/channels/c1', { name: 'pwned' }));
  await deny('Kid turns off auto-delete', updateDoc('Kid', 'servers/s1/channels/c1', { autoDelete: false }));
  await allow('Bob stamps a channel with his own message', commit('Bob', [write('servers/s1/channels/c1', { set: { lastMessage: { uid: 'Bob', text: 'hello', mid: 'm1' } }, merge: ['lastMessage'], serverTime: ['lastMessageAt'] })]));
  await deny('Bob stamps a channel with a made-up preview of Alice', commit('Bob', [write('servers/s1/channels/c1', { set: { lastMessage: { uid: 'Alice', text: 'I quit', mid: 'm1' } }, merge: ['lastMessage'] })]));
  await deny('Kid stamps a channel with a message that is not his', commit('Kid', [write('servers/s1/channels/c1', { set: { lastMessage: { uid: 'Kid', text: 'x', mid: 'm1' } }, merge: ['lastMessage'] })]));
  await deny('Kid\'s page moves the Discord place along (the bridge does that now)', commit('Kid', [write('servers/s1/channels/c2', { set: { discord: { last: '5' } }, merge: ['discord.last'] })]));
  await deny('Kid changes the Discord link', commit('Kid', [write('servers/s1/channels/c2', { set: { discord: { channel: '999999999999999999' } }, merge: ['discord.channel'] })]));
  await deny('Kid deletes a channel', delDoc('Kid', 'servers/s1/channels/c9'));
  await deny('Kid makes a category', setDoc('Kid', 'servers/s1/categories/k1', { name: 'x' }));
  // (v4.69: starting a thread takes Create Public Threads, which @everyone here lost when Ad remade the roles above)
  await deny('Bob can\'t start a thread without Create Public Threads', setDoc('Bob', 'servers/s1/threads/t2', { channelId: 'c1', name: 'x', starterId: 'm1', createdBy: 'Bob', messageCount: 0 }));
  await allow('Ad (Administrator) starts one', setDoc('Ad', 'servers/s1/threads/t2', { channelId: 'c1', name: 'x', starterId: 'm1', createdBy: 'Ad', messageCount: 0 }));
  await deny('Kid starts a thread "by Bob"', setDoc('Kid', 'servers/s1/threads/t3', { channelId: 'c1', name: 'x', starterId: 'm1', createdBy: 'Bob', messageCount: 0 }));
  await allow('Kid counts a reply in Bob\'s thread', commit('Kid', [write('servers/s1/threads/t1', { inc: { messageCount: 1 }, serverTime: ['lastMessageAt'] })]));
  await deny('Kid renames Bob\'s thread', updateDoc('Kid', 'servers/s1/threads/t1', { name: 'pwned' }));
  await allow('Alice posts in Bob\'s thread', setDoc('Alice', 'servers/s1/threads/t1/messages/tm2', { uid: 'Alice', text: 'reply', createdAt: new Date() }));
  await deny('Eve (not a member) reads the thread', query('Eve', 'servers/s1/threads/t1', 'messages'));
  await deny('Kid deletes Bob\'s thread message', delDoc('Kid', 'servers/s1/threads/t1/messages/tm1'));

  section('Server messages');
  await allow('Bob posts as Bob', setDoc('Bob', 'servers/s1/channels/c1/messages/n1', { uid: 'Bob', username: 'Bob', text: 'hi', createdAt: new Date() }));
  await deny('Bob posts as Alice', setDoc('Bob', 'servers/s1/channels/c1/messages/n2', { uid: 'Alice', username: 'Alice', text: 'I quit', createdAt: new Date() }));
  await deny('Eve (not a member) posts', setDoc('Eve', 'servers/s1/channels/c1/messages/n3', { uid: 'Eve', text: 'hi', createdAt: new Date() }));
  await deny('Muted (muted on Frixion) posts', setDoc('Muted', 'servers/s1/channels/c1/messages/n4', { uid: 'Muted', text: 'hi', createdAt: new Date() }));
  await deny('Banned posts', setDoc('Banned', 'servers/s1/channels/c1/messages/n5', { uid: 'Banned', text: 'hi', createdAt: new Date() }));
  await deny('Kid (timed out in this server) posts', setDoc('Kid', 'servers/s1/channels/c1/messages/n6', { uid: 'Kid', text: 'hi', createdAt: new Date() }));
  await deny('Bob posts a made-up Sapphire message', setDoc('Bob', 'servers/s1/channels/c1/messages/n7', { uid: 'bot-sapphire', username: 'Sapphire', text: 'You are banned', createdAt: new Date() }));
  await deny('Bob posts a Sapphire purge card (he can\'t purge)', setDoc('Bob', 'servers/s1/channels/c1/messages/n8', { uid: 'bot-sapphire', username: 'Sapphire', purgeResult: { count: 3 }, createdAt: new Date() }));
  await deny('Mo (Manage Messages, no purge perms) posts a Sapphire purge card (v4.60: purge perms only)', setDoc('Mo', 'servers/s1/channels/c1/messages/n8', { uid: 'bot-sapphire', username: 'Sapphire', purgeResult: { count: 3 }, createdAt: new Date() }));
  await deny('Co (co-owner, no purge perms) posts a Sapphire purge card', setDoc('Co', 'servers/s1/channels/c1/messages/n8', { uid: 'bot-sapphire', username: 'Sapphire', purgeResult: { count: 3 }, createdAt: new Date() }));
  await allow('Owner1 posts a Sapphire purge card', setDoc('Owner1', 'servers/s1/channels/c1/messages/n8', { uid: 'bot-sapphire', username: 'Sapphire', purgeResult: { count: 3 }, createdAt: new Date() }));
  await allow('Bob sends a /raw message (raw: true, shown exactly as typed)', setDoc('Bob', 'servers/s1/channels/c1/messages/raw1', { uid: 'Bob', username: 'Bob', text: '*Hi*', raw: true, createdAt: new Date() }));
  await allow('Bob starts a Wordle game', setDoc('Bob', 'servers/s1/channels/c1/messages/n9', { uid: 'bot-wordle', username: 'Wordle', wordle: { puzzle: 1, startedBy: 'Bob', plays: {} }, createdAt: new Date() }));
  await deny('Bob starts a Wordle game "by Alice"', setDoc('Bob', 'servers/s1/channels/c1/messages/n10', { uid: 'bot-wordle', username: 'Wordle', wordle: { puzzle: 1, startedBy: 'Alice', plays: {} }, createdAt: new Date() }));
  await deny('Bob\'s page brings a Discord message over (only the bridge does now)', setDoc('Bob', 'servers/s1/channels/c2/messages/dc_333333333333333333', { uid: 'discord:555', username: 'disco', dc: '333333333333333333', text: 'hey', createdAt: new Date() }));
  await deny('...into a channel with no link', setDoc('Bob', 'servers/s1/channels/c1/messages/dc_333333333333333333', { uid: 'discord:555', username: 'disco', dc: '333333333333333333', text: 'hey', createdAt: new Date() }));
  await deny('...under some other id', setDoc('Bob', 'servers/s1/channels/c2/messages/fake1', { uid: 'discord:555', username: 'disco', dc: '333333333333333333', text: 'hey', createdAt: new Date() }));
  await allow('Kid reacts to Bob\'s message', commit('Kid', [write('servers/s1/channels/c1/messages/m1', { set: { reactions: { smile: ['Kid'] }, lastReaction: { e: 'smile', by: 'Kid' } }, merge: ['reactions.smile', 'lastReaction'] })]));
  await deny('Kid reacts without saying which', commit('Kid', [write('servers/s1/channels/c1/messages/m1', { set: { reactions: { heart: ['Kid'] } }, merge: ['reactions.heart'] })]));
  await deny('Kid adds Alice\'s name to a reaction', commit('Kid', [write('servers/s1/channels/c1/messages/m1', { set: { reactions: { smile: ['Kid', 'Alice'] }, lastReaction: { e: 'smile', by: 'Kid' } }, merge: ['reactions.smile', 'lastReaction'] })]));
  await allow('Mo reacts too', commit('Mo', [write('servers/s1/channels/c1/messages/m1', { set: { reactions: { smile: ['Kid', 'Mo'] }, lastReaction: { e: 'smile', by: 'Mo' } }, merge: ['reactions.smile', 'lastReaction'] })]));
  await deny('Kid takes Mo\'s reaction off', commit('Kid', [write('servers/s1/channels/c1/messages/m1', { set: { reactions: { smile: ['Kid'] }, lastReaction: { e: 'smile', by: 'Kid' } }, merge: ['reactions.smile', 'lastReaction'] })]));
  await deny('Kid changes two reactions at once', commit('Kid', [write('servers/s1/channels/c1/messages/m1', { set: { reactions: { smile: ['Mo'], fire: ['Kid'] }, lastReaction: { e: 'fire', by: 'Kid' } }, merge: ['reactions.smile', 'reactions.fire', 'lastReaction'] })]));
  await allow('Kid takes his own reaction off', commit('Kid', [write('servers/s1/channels/c1/messages/m1', { set: { reactions: { smile: ['Mo'] }, lastReaction: { e: 'smile', by: 'Kid' } }, merge: ['reactions.smile', 'lastReaction'] })]));
  await deny('Bob fakes reactions on his own message', commit('Bob', [write('servers/s1/channels/c1/messages/m1', { set: { reactions: { smile: ['Mo', 'Alice', 'Carol'] }, lastReaction: { e: 'smile', by: 'Bob' } }, merge: ['reactions.smile', 'lastReaction'] })]));
  await allow('Kid votes in Bob\'s poll', commit('Kid', [write('servers/s1/channels/c1/messages/poll1', { set: { poll: { votes: { Alice: [0], Kid: [1] } } }, merge: ['poll.votes'] })]));
  await deny('Kid changes Alice\'s vote', commit('Kid', [write('servers/s1/channels/c1/messages/poll1', { set: { poll: { votes: { Alice: [1] } } }, merge: ['poll.votes'] })]));
  await deny('Kid changes the poll question', commit('Kid', [write('servers/s1/channels/c1/messages/poll1', { set: { poll: { question: 'pwned' } }, merge: ['poll.question'] })]));
  await allow('Kid plays Bob\'s Wordle', commit('Kid', [write('servers/s1/channels/c1/messages/wordle1', { set: { wordle: { plays: { Kid: { guesses: ['adieu'] } } } }, merge: ['wordle.plays.Kid'] })]));
  await deny('Kid changes Bob\'s Wordle guesses', commit('Kid', [write('servers/s1/channels/c1/messages/wordle1', { set: { wordle: { plays: { Bob: { guesses: [] } } } }, merge: ['wordle.plays.Bob'] })]));
  await deny('Kid edits Bob\'s text', updateDoc('Kid', 'servers/s1/channels/c1/messages/m1', { text: 'I am dumb', edited: true }));
  await deny('Kid pins Bob\'s message', updateDoc('Kid', 'servers/s1/channels/c1/messages/m1', { pinned: true }));
  await allow('Mo (Manage Messages) pins it', updateDoc('Mo', 'servers/s1/channels/c1/messages/m1', { pinned: true }));
  await allow('Mo clears Bob\'s text (the file stays)', updateDoc('Mo', 'servers/s1/channels/c1/messages/m1', { text: '', edited: false }));
  await deny('Mo rewrites Bob\'s text', updateDoc('Mo', 'servers/s1/channels/c1/messages/m1', { text: 'something else' }));
  await allow('Bob edits his own message', updateDoc('Bob', 'servers/s1/channels/c1/messages/n1', { text: 'hi!', edited: true }));
  await deny('Bob hands his message to Alice', updateDoc('Bob', 'servers/s1/channels/c1/messages/n1', { uid: 'Alice' }));
  await deny('Kid changes a Discord user\'s files (the bridge copies them now)', updateDoc('Kid', 'servers/s1/channels/c2/messages/dc_222222222222222222', { attachments: [{ url: 'https://evil.example/x.png' }] }));
  await deny('Kid deletes Bob\'s message', delDoc('Kid', 'servers/s1/channels/c1/messages/n1'));
  await allow('Kid\'s page sweeps a week-old message (auto-delete on)', delDoc('Kid', 'servers/s1/channels/c1/messages/old1'));
  await deny('...in a channel with auto-delete off', delDoc('Kid', 'servers/s1/channels/c2/messages/old2'));
  await deny("Kid deletes a Discord user's message (only the bridge, after checking Discord, or a moderator)", delDoc('Kid', 'servers/s1/channels/c2/messages/dc_222222222222222222'));
  await allow("Mo (Manage Messages) deletes a Discord user's message", delDoc('Mo', 'servers/s1/channels/c2/messages/dc_222222222222222222'));
  await allow('Mo deletes Bob\'s message', delDoc('Mo', 'servers/s1/channels/c1/messages/n1'));
  await allow('Mod (Frixion staff) purges a message', delDoc('Mod', 'servers/s1/channels/c1/messages/n8'));
  await allow('Bob posts again', setDoc('Bob', 'servers/s1/channels/c1/messages/n12', { uid: 'Bob', text: 'oops', createdAt: new Date() }));
  await allow('Bob deletes his own message', delDoc('Bob', 'servers/s1/channels/c1/messages/n12'));
  await deny("Bob deletes the Wordle card he started (it's Wordle's)", delDoc('Bob', 'servers/s1/channels/c1/messages/n9'));

  section('Hidden and read-only channels');
  await deny('Bob reads the mods-only channel', query('Bob', 'servers/s1/channels/c3', 'messages'));
  await allow('Mo (its role is let in) reads it', query('Mo', 'servers/s1/channels/c3', 'messages'));
  await allow('Alice (the owner) reads it', query('Alice', 'servers/s1/channels/c3', 'messages'));
  await allow('Ad (Administrator) reads it', query('Ad', 'servers/s1/channels/c3', 'messages'));
  await deny('Bob posts in it', setDoc('Bob', 'servers/s1/channels/c3/messages/x1', { uid: 'Bob', text: 'hi', createdAt: new Date() }));
  await deny('Bob reacts in it', commit('Bob', [write('servers/s1/channels/c3/messages/h1', { set: { reactions: { smile: ['Bob'] }, lastReaction: { e: 'smile', by: 'Bob' } }, merge: ['reactions.smile', 'lastReaction'] })]));
  await deny('Bob watches who types in it', query('Bob', 'servers/s1/channels/c3', 'typing'));
  await deny('Bob reads a thread in it', query('Bob', 'servers/s1/threads/t5', 'messages'));
  await allow('Mo reads the thread', query('Mo', 'servers/s1/threads/t5', 'messages'));
  await allow('Bob reads the announcements channel', query('Bob', 'servers/s1/channels/c4', 'messages'));
  await deny('Bob posts in announcements (read-only)', setDoc('Bob', 'servers/s1/channels/c4/messages/x2', { uid: 'Bob', text: 'hi', createdAt: new Date() }));
  await allow('Ad (Administrator) posts in announcements', setDoc('Ad', 'servers/s1/channels/c4/messages/x3', { uid: 'Ad', text: 'news', createdAt: new Date() }));
  await deny('Bob reads the old-style private channel', query('Bob', 'servers/s1/channels/c5', 'messages'));
  await allow('Mo reads the old-style private channel', query('Mo', 'servers/s1/channels/c5', 'messages'));
  await allow('Bob posts in a server whose @everyone predates the permission list (Discord defaults)', setDoc('Bob', 'servers/s6/channels/g/messages/o1', { uid: 'Bob', text: 'hi', createdAt: new Date() }));
  await deny('Banned (still a member) reads the server\'s messages', query('Banned', 'servers/s1/channels/c1', 'messages'));
  await deny('Banned reads her DMs', query('Banned', '', 'dms', ['participants', 'ARRAY_CONTAINS', 'Banned']));

  section('Slowmode (v4.54)');
  await setDoc('owner', 'servers/s1/channels/c6', { name: 'slow', slowmode: 30, autoDelete: true });
  const slowPost = (who, id) => commit(who, [write(`servers/s1/channels/c6/messages/${id}`, { set: { uid: who, text: 'hi ' + id }, serverTime: ['createdAt'], full: true }),
    write(`servers/s1/channels/c6/slow/${who}`, { set: {}, serverTime: ['at'], full: true })]);
  await allow('Bob posts in a 30-second slowmode channel', slowPost('Bob', 'sl1'));
  await deny('Bob posts there again right away', slowPost('Bob', 'sl2'));
  await deny('Bob posts there without the stamp', setDoc('Bob', 'servers/s1/channels/c6/messages/sl3', { uid: 'Bob', text: 'sneaky', createdAt: new Date() }));
  await deny('Bob deletes his stamp to start over', delDoc('Bob', 'servers/s1/channels/c6/slow/Bob'));
  await deny('Bob backdates his stamp', setDoc('Bob', 'servers/s1/channels/c6/slow/Bob', { at: daysAgo(1) }));
  await deny("Kid stamps Bob's slowmode", commit('Kid', [write('servers/s1/channels/c6/slow/Bob', { set: {}, serverTime: ['at'], full: true })]));
  await allow('Mo (Manage Messages) skips slowmode', slowPost('Mo', 'sl4'));
  await allow('...twice in a row', slowPost('Mo', 'sl5'));
  await allow("Alice (the server's owner) posts twice in a row", slowPost('Alice', 'sl6'));
  await allow('...twice', slowPost('Alice', 'sl7'));
  await setDoc('owner', 'servers/s1/channels/c6/slow/Bob', { at: new Date(Date.now() - 31000) });
  await allow('Bob posts again 31 seconds later', slowPost('Bob', 'sl8'));
  await allow('a channel without slowmode needs no stamp', setDoc('Bob', 'servers/s1/channels/c1/messages/sl9', { uid: 'Bob', text: 'quick', createdAt: new Date() }));

  section('@everyone (v4.54)');
  const ping = (who, id, text, extra = {}) => setDoc(who, `servers/s1/channels/c1/messages/${id}`, { uid: who, text, createdAt: new Date(), ...extra });
  await deny('Bob pings @everyone without Mention @everyone', ping('Bob', 'ev1', 'hey @everyone look'));
  await allow('...the app marks it as not a ping, so it posts', ping('Bob', 'ev2', 'hey @everyone look', { everyoneBlocked: true }));
  await deny('Bob pings (@HERE) in capitals on a second line', ping('Bob', 'ev3', 'line one\n(@HERE)'));
  await allow('Bob writes an email address with @here in it', ping('Bob', 'ev4', 'mail me@here.com'));
  await allow('Bob writes @everyones (not a ping)', ping('Bob', 'ev5', 'hi @everyones'));
  await allow("Alice (the server's owner) pings @everyone", ping('Alice', 'ev6', '@everyone meeting'));
  await deny('Bob pings @here in a thread', setDoc('Bob', 'servers/s1/threads/t1/messages/ev7', { uid: 'Bob', text: '@here', createdAt: new Date() }));

  section('Virtual machines (v4.54)');
  await setDoc('owner', 'devices/dev_vm1', { id: 'dev_vm1', accounts: ['Bob'], banned: true, banReason: 'vm', autoBanned: true, vm: 'VMware' });
  await deny('Bob lets his own virtual machine in', updateDoc('Bob', 'devices/dev_vm1', { vmAllowed: true }));
  await deny('Bob makes a new device entry that is already let in', setDoc('Bob', 'devices/dev_vm2', { id: 'dev_vm2', accounts: ['Bob'], banned: false, vmAllowed: true }));
  await allow('Bob records a visit on his virtual machine (still banned)', updateDoc('Bob', 'devices/dev_vm1', { lastSeen: Date.now(), vm: 'VMware' }));
  await deny('Co (Co-Owner) lets it in (the Owner\'s alone since v4.63)', updateDoc('Co', 'devices/dev_vm1', { vmAllowed: true, banned: false }));
  await allow('Owner1 lets it in', updateDoc('Owner1', 'devices/dev_vm1', { vmAllowed: true, banned: false }));
  await deny('Bob changes whether it is let in', updateDoc('Bob', 'devices/dev_vm1', { vmAllowed: false }));

  section('Devices and networks (v4.55)');
  await setDoc('owner', 'devices/dev_sec1', { id: 'dev_sec1', accounts: ['Bob', 'Eve'], banned: false, name: 'Windows PC' });
  await allow('Eve records a visit on a device she uses', updateDoc('Eve', 'devices/dev_sec1', { lastSeen: 5 }));
  await deny("Owner1 adds Alice to Bob's device", updateDoc('Owner1', 'devices/dev_sec1', { accounts: ['Bob', 'Eve', 'Alice'] }));
  await deny("Owner1 renames someone's device", updateDoc('Owner1', 'devices/dev_sec1', { name: 'Fake PC' }));
  await allow('Owner1 still bans it', updateDoc('Owner1', 'devices/dev_sec1', { banned: true, banReason: 'x', bannedBy: 'Owner1', bannedAt: 1 }));
  await allow('...and unbans it', updateDoc('Owner1', 'devices/dev_sec1', { banned: false, banReason: '', unbannedBy: 'Owner1', unbannedAt: 2 }));
  await setDoc('owner', 'ips/ip_aaaa', { label: '73.12.x.x', accounts: ['Bob'], devices: ['dev_sec1'], lastSeen: new Date() });
  await deny('Bob reads which accounts use his network', getDoc('Bob', 'ips/ip_aaaa'));
  await deny('Bob writes himself off a network', updateDoc('Bob', 'ips/ip_aaaa', { accounts: [] }));
  await deny('Owner1 writes a network entry from a page (only the function does)', setDoc('Owner1', 'ips/ip_bbbb', { label: 'x', accounts: ['Alice'] }));
  await allow('Owner1 sees the networks', query('Owner1', '', 'ips'));
  await allow('Owner1 bans a network', setDoc('Owner1', 'bannedIps/ip_aaaa', { reason: 'alts', by: 'Owner1', at: 1, label: '73.12.x.x' }));
  await deny('Owner1 bans one with extra fields', setDoc('Owner1', 'bannedIps/ip_cccc', { reason: 'x', by: 'Owner1', at: 1, label: 'x', note: 'y' }));
  await deny('Bob bans a network', setDoc('Bob', 'bannedIps/ip_dddd', { reason: 'x', by: 'Bob', at: 1, label: 'x' }));
  await deny('Bob unbans his network', delDoc('Bob', 'bannedIps/ip_aaaa'));
  await deny('Bob looks at the banned networks', query('Bob', '', 'bannedIps'));
  await deny('signed-out visitor checks a network ban directly (the function does that)', getDoc(null, 'bannedIps/ip_aaaa'));
  await allow('Owner1 unbans it', delDoc('Owner1', 'bannedIps/ip_aaaa'));
  await setDoc('owner', 'loginCodes/c_x1', { username: 'Bob', by: 'Owner1', at: new Date() });
  await deny('Bob reads the one-time password list', query('Bob', '', 'loginCodes'));
  await deny('Bob makes himself a one-time password', setDoc('Bob', 'loginCodes/c_x2', { username: 'Bob', by: 'Owner1', at: new Date() }));
  await deny('Bob cancels one', delDoc('Bob', 'loginCodes/c_x1'));
  await deny('signed-out visitor reads one', getDoc(null, 'loginCodes/c_x1'));
  await deny('Owner1 makes one from a page (only the function does)', setDoc('Owner1', 'loginCodes/c_x3', { username: 'Alice', by: 'Owner1', at: new Date() }));
  await allow("Owner1 counts Bob's unused ones", query('Owner1', '', 'loginCodes', ['username', 'EQUAL', 'Bob']));
  await allow('Owner1 cancels one', delDoc('Owner1', 'loginCodes/c_x1'));
  await updateDoc('owner', 'users/Bob', { mustChangePassword: true });
  await allow('Bob clears must-change-password after picking his own', updateDoc('Bob', 'users/Bob', { mustChangePassword: false }));

  section('Profile colors (v4.56)');
  await allow('Bob picks a banner color', updateDoc('Bob', 'users/Bob', { bannerColor: '#23a55a' }));
  await deny('Bob (no Premium) mixes a two-color banner (v4.57: Premium only)', updateDoc('Bob', 'users/Bob', { bannerColor: 'linear-gradient(135deg,#12ab34,#FFaa00)' }));
  await deny('Bob (no Premium) sets a name gradient', updateDoc('Bob', 'users/Bob', { nameGradient: ['#5865f2', '#eb459e'] }));
  await updateDoc('owner', 'users/Bob', { premiumUntil: Date.now() + 86400000 });
  await allow('Bob (Premium) mixes his own gradient banner', updateDoc('Bob', 'users/Bob', { bannerColor: 'linear-gradient(135deg,#12ab34,#FFaa00)' }));
  await deny('Bob hides a web address in his banner (it would load on other screens)', updateDoc('Bob', 'users/Bob', { bannerColor: 'url(https://evil.example/track.png)' }));
  await deny('...or tacks one onto a gradient', updateDoc('Bob', 'users/Bob', { bannerColor: 'linear-gradient(135deg,#12ab34,#ffaa00),url(https://evil.example/x)' }));
  await allow('Bob sets a name gradient', updateDoc('Bob', 'users/Bob', { nameGradient: ['#5865f2', '#eb459e'] }));
  await deny('Bob puts something else in his name gradient', updateDoc('Bob', 'users/Bob', { nameGradient: ['#5865f2', 'red;background:url(https://evil.example)'] }));
  // (v4.66, request 40: up to 8 colors, like nameplates and banners; before, exactly 2)
  await allow('Bob uses three colors (v4.66)', updateDoc('Bob', 'users/Bob', { nameGradient: ['#5865f2', '#eb459e', '#000000'] }));
  await allow('...or eight', updateDoc('Bob', 'users/Bob', { nameGradient: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888'] }));
  await deny('...but not nine', updateDoc('Bob', 'users/Bob', { nameGradient: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888', '#999999'] }));
  await deny('...nor one', updateDoc('Bob', 'users/Bob', { nameGradient: ['#111111'] }));
  await deny('...nor something that isn\'t a color among eight', updateDoc('Bob', 'users/Bob', { nameGradient: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', 'url(x)'] }));
  await allow('Bob turns his name gradient off', commit('Bob', [{ update: { name: 'projects/liquidalt/databases/(default)/documents/users/Bob', fields: {} }, updateMask: { fieldPaths: ['nameGradient'] }, currentDocument: { exists: true } }]));
  await allow('Bob picks an avatar color', updateDoc('Bob', 'users/Bob', { avatarColor: '#ed4245' }));
  await updateDoc('owner', 'users/Bob', { premiumUntil: Date.now() - 1000 });
  await allow('Bob\'s Premium ran out: editing his bio still works (the old gradient is left alone)', updateDoc('Bob', 'users/Bob', { bio: 'expired' }));
  await deny('...but he can\'t pick a new two-color banner', updateDoc('Bob', 'users/Bob', { bannerColor: 'linear-gradient(135deg,#000000,#ffffff)' }));
  await allow('...and can switch back to a plain one', updateDoc('Bob', 'users/Bob', { bannerColor: '#23a55a' }));
  await deny('Bob hides a web address in his avatar color', updateDoc('Bob', 'users/Bob', { avatarColor: 'url(https://evil.example)' }));

  section('Message times, sizes and other small fakes');
  await deny('Bob posts a message dated last year', setDoc('Bob', 'servers/s1/channels/c1/messages/old9', { uid: 'Bob', text: 'from the past', createdAt: daysAgo(365) }));
  await deny('Bob posts a message dated next year (stuck at the bottom)', setDoc('Bob', 'servers/s1/channels/c1/messages/fut9', { uid: 'Bob', text: 'pinned forever', createdAt: daysAgo(-365) }));
  await deny('Bob posts a 20,000-character message', setDoc('Bob', 'servers/s1/channels/c1/messages/big9', { uid: 'Bob', text: 'x'.repeat(20000), createdAt: new Date() }));
  await setDoc('owner', 'dms/Bob_Owner1', { participants: ['Bob', 'Owner1'], autoDelete: true });
  await allow('the Owner posts a 20,000-character message (the app lets the Owner)', setDoc('Owner1', 'dms/Bob_Owner1/messages/big1', { uid: 'Owner1', text: 'x'.repeat(20000), createdAt: new Date() }));
  await allow('the Owner edits it to 30,000 characters', updateDoc('Owner1', 'dms/Bob_Owner1/messages/big1', { text: 'y'.repeat(30000), edited: true }));
  await deny('the Owner posts 1,000,000 characters', setDoc('Owner1', 'dms/Bob_Owner1/messages/big4', { uid: 'Owner1', text: 'z'.repeat(1000000), createdAt: new Date() }));
  await deny('Bob posts 20,000 characters in the same DM', setDoc('Bob', 'dms/Bob_Owner1/messages/big2', { uid: 'Bob', text: 'x'.repeat(20000), createdAt: new Date() }));
  await allow('Bob posts 10,000 characters there', setDoc('Bob', 'dms/Bob_Owner1/messages/big3', { uid: 'Bob', text: 'x'.repeat(10000), createdAt: new Date() }));
  await deny('Bob edits his to 10,001 characters', updateDoc('Bob', 'dms/Bob_Owner1/messages/big3', { text: 'x'.repeat(10001) }));
  await allow('Bob posts a normal message', setDoc('Bob', 'servers/s1/channels/c1/messages/ok9', { uid: 'Bob', text: 'normal', createdAt: new Date() }));
  await deny('Bob backdates his own message', updateDoc('Bob', 'servers/s1/channels/c1/messages/ok9', { createdAt: daysAgo(30) }));
  await deny("Bob says he is typing under Alice's name", setDoc('Bob', 'servers/s1/channels/c1/typing/Bob', { username: 'Alice', updatedAt: new Date() }));
  await deny("Kid sets a thread's reply count to 999", updateDoc('Kid', 'servers/s1/threads/t1', { messageCount: 999 }));
  await deny("Bob writes Alice's name on their DM's preview", updateDoc('Bob', 'dms/Alice_Bob', { lastMessage: { text: 'I hate you', username: 'Alice' } }));
  await allow('signed-out visitor checks whether their computer is banned', getDoc(null, 'bannedHw/hw_test123'));
  await deny('Eve lists the banned computers', query('Eve', '', 'bannedHw'));
  await deny('Eve bans a computer', setDoc('Eve', 'bannedHw/hw_victim', { reason: 'x', by: 'Eve' }));
  await deny('Co (co-owner) bans a computer (the Owner\'s alone since v4.63)', setDoc('Co', 'bannedHw/hw_test123', { reason: 'spam', by: 'Co', at: 1 }));
  await allow('Owner1 bans a computer', setDoc('Owner1', 'bannedHw/hw_test123', { reason: 'spam', by: 'Owner1', at: 1 }));
  await deny('Co unbans it', delDoc('Co', 'bannedHw/hw_test123'));
  await allow('Owner1 unbans it', delDoc('Owner1', 'bannedHw/hw_test123'));

  section('Typing');
  await allow('Bob says he is typing', setDoc('Bob', 'servers/s1/channels/c1/typing/Bob', { username: 'Bob', updatedAt: new Date() }));
  await deny('Bob says Alice is typing', setDoc('Bob', 'servers/s1/channels/c1/typing/Alice', { username: 'Alice', updatedAt: new Date() }));
  await deny('Eve (not a member) sees who is typing', query('Eve', 'servers/s1/channels/c1', 'typing'));
  await allow('Alice types in her DM', setDoc('Alice', 'dms/Alice_Bob/typing/Alice', { username: 'Alice' }));
  await deny('Carol watches Alice and Bob type', query('Carol', 'dms/Alice_Bob', 'typing'));

  section('Direct messages');
  await allow('Alice reads her DM with Bob', query('Alice', 'dms/Alice_Bob', 'messages'));
  await deny('Carol reads Alice and Bob\'s DM', query('Carol', 'dms/Alice_Bob', 'messages'));
  await deny('Mod (Frixion staff) reads Alice and Bob\'s DM', query('Mod', 'dms/Alice_Bob', 'messages'));
  await deny('signed-out visitor reads it', query(null, 'dms/Alice_Bob', 'messages'));
  await allow('Alice lists her DMs', query('Alice', '', 'dms', ['participants', 'ARRAY_CONTAINS', 'Alice']));
  await deny('Alice lists everyone\'s DMs', query('Alice', '', 'dms'));
  await allow('Mod lists DMs (Admin Panel auto-delete switches)', query('Mod', '', 'dms'));
  await allow('Carol starts a DM with Dan', setDoc('Carol', 'dms/Carol_Dan', { participants: ['Carol', 'Dan'], autoDelete: true }));
  await deny('Carol makes a DM between Alice and Dan', setDoc('Carol', 'dms/Alice_Dan', { participants: ['Alice', 'Dan'] }));
  await deny('Carol adds herself to Alice and Bob\'s DM', updateDoc('Carol', 'dms/Alice_Bob', { participants: ['Alice', 'Bob', 'Carol'] }));
  await allow('Bob sends Alice a DM', setDoc('Bob', 'dms/Alice_Bob/messages/d2', { uid: 'Bob', text: 'hey', createdAt: new Date() }));
  await deny('Bob sends a DM as Alice', setDoc('Bob', 'dms/Alice_Bob/messages/d3', { uid: 'Alice', text: 'hey', createdAt: new Date() }));
  await deny('Carol sends into their DM', setDoc('Carol', 'dms/Alice_Bob/messages/d4', { uid: 'Carol', text: 'hey', createdAt: new Date() }));
  await allow('Alice reacts to Bob\'s DM', commit('Alice', [write('dms/Alice_Bob/messages/d1', { set: { reactions: { heart: ['Alice'] }, lastReaction: { e: 'heart', by: 'Alice' } }, merge: ['reactions.heart', 'lastReaction'] })]));
  await deny('Alice reacts to Bob\'s DM as Bob too', commit('Alice', [write('dms/Alice_Bob/messages/d1', { set: { reactions: { heart: ['Alice', 'Bob'] }, lastReaction: { e: 'heart', by: 'Alice' } }, merge: ['reactions.heart', 'lastReaction'] })]));
  await deny('Bob posts a Sapphire purge card in a DM (only staff can purge DMs)', setDoc('Bob', 'dms/Alice_Bob/messages/d9', { uid: 'bot-sapphire', username: 'Sapphire', purgeResult: { count: 1 }, createdAt: new Date() }));
  await deny('Alice edits Bob\'s DM', updateDoc('Alice', 'dms/Alice_Bob/messages/d1', { text: 'pwned' }));
  await deny('Alice deletes Bob\'s DM', delDoc('Alice', 'dms/Alice_Bob/messages/d1'));
  await allow('Alice\'s page sweeps a week-old DM', delDoc('Alice', 'dms/Alice_Bob/messages/old1'));
  await allow('Bob updates the DM\'s last message', updateDoc('Bob', 'dms/Alice_Bob', { lastMessage: { text: 'hey', username: 'Bob' } }));

  section('Group DMs');
  await allow('Alice makes a group with her friends', setDoc('Alice', 'groupDMs/g2', { participants: ['Alice', 'Carol', 'Dan'], ownerId: 'Alice', name: null }));
  await deny('Alice puts a stranger in a group', setDoc('Alice', 'groupDMs/g3', { participants: ['Alice', 'Eve'], ownerId: 'Alice' }));
  await deny('Carol adds Dan (not her friend)', commit('Carol', [write('groupDMs/g1', { union: { participants: ['Dan'] } })]));
  await allow('Alice adds Dan (her friend)', commit('Alice', [write('groupDMs/g1', { union: { participants: ['Dan'] } })]));
  await deny('Carol makes herself the group\'s owner', updateDoc('Carol', 'groupDMs/g1', { ownerId: 'Carol' }));
  await deny('Eve reads the group', query('Eve', 'groupDMs/g1', 'messages'));
  await allow('Dan posts in the group', setDoc('Dan', 'groupDMs/g1/messages/gm2', { uid: 'Dan', text: 'hi', createdAt: new Date() }));
  await deny('Carol (banned on Frixion) posts in the group', setDoc('Carol', 'groupDMs/g1/messages/gm3', { uid: 'Carol', text: 'hi', createdAt: new Date() }));
  await deny("Dan deletes Carol's group message", delDoc('Dan', 'groupDMs/g1/messages/gm1'));
  await deny('Dan (not the owner) takes Carol out of the group', commit('Dan', [write('groupDMs/g1', { remove: { participants: ['Carol'] } })]));
  await deny('Carol (banned from Frixion) leaves the group', commit('Carol', [write('groupDMs/g1', { remove: { participants: ['Carol'] } })]));
  await allow('Alice (the owner) takes Carol out', commit('Alice', [write('groupDMs/g1', { remove: { participants: ['Carol'] } })]));
  await allow('Dan leaves the group', commit('Dan', [write('groupDMs/g1', { remove: { participants: ['Dan'] } })]));

  section('Push notifications');
  await allow('Bob reads his device\'s subscription', getDoc('Bob', 'pushSubs/p1'));
  await deny('Alice reads Bob\'s subscription', getDoc('Alice', 'pushSubs/p1'));
  await deny('Alice subscribes a device for Bob', setDoc('Alice', 'pushSubs/p2', { uid: 'Bob', endpoint: 'https://push.example/x' }));
  await deny('Alice takes over Bob\'s subscription without its address', setDoc('Alice', 'pushSubs/p1', { uid: 'Alice', endpoint: 'https://push.example/alice' }));
  await allow('the same device signing in as Alice takes it over', setDoc('Alice', 'pushSubs/p1', { uid: 'Alice', endpoint: 'https://push.example/bob' }));
  await deny('Bob deletes it now that it\'s Alice\'s', delDoc('Bob', 'pushSubs/p1'));
  await allow('Alice turns it off', delDoc('Alice', 'pushSubs/p1'));

  section('Discord bridge list');
  await allow('Bob keeps the linked-channel list up to date', setDoc('Bob', 'discordLinks/s1__c2', { sid: 's1', cid: 'c2', channel: '111111111111111111', at: 2 }, { merge: ['sid', 'cid', 'channel', 'at'] }));
  await deny('Bob writes the bridge\'s own notes on it', updateDoc('Bob', 'discordLinks/s1__c2', { seen: 'y' }));
  await deny('Eve (not a member) adds an entry', setDoc('Eve', 'discordLinks/s1__c1', { sid: 's1', cid: 'c1', channel: '1', at: 1 }));
  await deny('Bob reads the list', getDoc('Bob', 'discordLinks/s1__c2'));
  await deny('Kid removes it', delDoc('Kid', 'discordLinks/s1__c2'));
  await allow('Alice (Manage Channels) removes it when unlinking', delDoc('Alice', 'discordLinks/s1__c2'));

  section('Games');
  await allow('Alice saves her RNG game', setDoc('Alice', 'rngSaves/Alice', { rolls: 9, name: 'Alice' }));
  await deny('Alice saves over Bob\'s game', setDoc('Alice', 'rngSaves/Bob', { rolls: 0 }));
  await allow('Bob reads the leaderboard', query('Bob', '', 'rngSaves'));
  await allow('Co (co-owner) puts Bob\'s rolls back', setDoc('Co', 'rngSaves/Bob', { rolls: 100 }));
  await allow('Alice uses an RNG code', commit('Alice', [write('rngCodes/RNG1', { inc: { uses: 1 } })]));
  await deny('Alice resets an RNG code', updateDoc('Alice', 'rngCodes/RNG1', { uses: 0 }));
  await deny('Alice makes an RNG code', setDoc('Alice', 'rngCodes/FREE', { reward: { rolls: 1e9 } }));

  section('Realtime Database');
  await allow('Alice says she is online', rtPut('Alice', `presence/${uidOf('Alice')}/connections/c1`, { idle: false }));
  await deny('Alice says Bob is online', rtPut('Alice', `presence/${uidOf('Bob')}/connections/c1`, { idle: false }));
  await allow('Bob sees who is online', rtGet('Bob', `presence/${uidOf('Alice')}`));
  await deny('signed-out visitor sees who is online', rtGet(null, `presence/${uidOf('Alice')}`));
  const now = Date.now();
  await allow('Alice chats in the RNG lobby', rtPut('Alice', 'ocrng/chat/x1', { uid: 'Alice', name: 'Alice', text: 'hi', t: now }));
  await deny('Alice chats as Bob', rtPut('Alice', 'ocrng/chat/x2', { uid: 'Bob', name: 'Bob', text: 'hi', t: now }));
  await deny('Alice says 200 characters at once', rtPut('Alice', 'ocrng/chat/x4', { uid: 'Alice', name: 'Alice', text: 'x'.repeat(200), t: now }));
  await deny("Bob deletes Alice's chat message", rtDel('Bob', 'ocrng/chat/x1'));
  await allow('Alice deletes her chat message', rtDel('Alice', 'ocrng/chat/x1'));
  await deny('a sign-in from before v4.54 (no claims) chats', rtPut('Alice', 'ocrng/chat/x3', { uid: 'Alice', name: 'Alice', text: 'hi', t: now }, { n: undefined, r: undefined }));
  await deny('signed-out visitor chats in the RNG lobby', rtPut(null, 'ocrng/chat/x2', { uid: 'x', name: 'x', text: 'hi', t: now }));
  await rtPut('owner', 'ocrng', { roster: { Bob: { name: 'Bob' } }, world: { luck: { mult: 2, until: now + 60000 } }, raid: { hp: 100, max: 100, until: now + 60000 },
    xboss: { life: { hp: 5 } }, gifts: { Bob: { g1: { key: 'common', n: 1 } } }, announce: { a1: { uid: 'Bob', text: 'X', t: now } }, hits: { Bob: { h0: { from: 'Kid', t: now } } } });
  await deny('Alice wipes the whole game database', rtDel('Alice', 'ocrng'));
  await deny('Alice wipes the lobby', rtDel('Alice', 'ocrng/roster'));
  await deny('Alice takes Bob out of the lobby', rtDel('Alice', 'ocrng/roster/Bob'));
  await allow('Alice joins the lobby', rtPut('Alice', 'ocrng/roster/Alice', { name: 'Alice', aura: 'common' }));
  await allow('Alice moves', rtPut('Alice', 'ocrng/pos/Alice', { x: 1, y: 2 }));
  await deny('Alice moves Bob', rtPut('Alice', 'ocrng/pos/Bob', { x: 1, y: 2 }));
  await deny("Alice takes over Bob's game session (closing his game)", rtPut('Alice', 'ocrng/session/Bob', { id: 'x', t: now }));
  await allow('Alice hits Bob, as herself', rtPut('Alice', 'ocrng/hits/Bob/h1', { from: 'Alice', d: 5, t: now }));
  await deny('Alice hits Bob as someone else', rtPut('Alice', 'ocrng/hits/Bob/h2', { from: 'Kid', d: 5, t: now }));
  await deny("Alice clears Bob's hits", rtDel('Alice', 'ocrng/hits/Bob'));
  await allow('Bob clears his hits', rtDel('Bob', 'ocrng/hits/Bob'));
  await deny('Alice turns on 1000x server luck', rtPut('Alice', 'ocrng/world/luck', { mult: 1000, until: now + 60000 }));
  await deny('Alice ends every event', rtDel('Alice', 'ocrng/world'));
  await allow('Alice uses a Biome Randomizer (weather for 5 minutes)', rtPut('Alice', 'ocrng/world/weather', { type: 'rainy', until: now + 300000, by: 'Alice' }));
  await deny('...but not for a year', rtPut('Alice', 'ocrng/world/weather', { type: 'rainy', until: now + 365 * 86400000, by: 'Alice' }));
  await allow('Owner1 turns on server luck', rtPut('Owner1', 'ocrng/world/luck', { mult: 2, until: now + 60000 }));
  await deny('Alice gives herself an aura', rtPut('Alice', 'ocrng/gifts/Alice/g9', { key: 'equinox', n: 1 }));
  await allow('Owner1 gives Bob an aura', rtPut('Owner1', 'ocrng/gifts/Bob/g2', { key: 'common', n: 1 }));
  await deny("Alice takes Bob's gift", rtDel('Alice', 'ocrng/gifts/Bob/g2'));
  await allow('Bob picks up his gift', rtDel('Bob', 'ocrng/gifts/Bob/g2'));
  await deny("Alice wipes Bob's game (closing it)", rtPut('Alice', 'ocrng/wipe/Bob', now));
  await allow("Co (a Co-Owner) wipes Bob's game", rtPut('Co', 'ocrng/wipe/Bob', now));
  await allow('Alice hits the raid boss', rtPut('Alice', 'ocrng/raid/hp', 90));
  await deny('Alice deletes the raid', rtDel('Alice', 'ocrng/raid'));
  await deny('Alice deletes the X boss', rtDel('Alice', 'ocrng/xboss'));
  await allow('Alice records her X boss damage', rtPut('Alice', 'ocrng/xboss/dmg/Alice', 12));
  await deny("Alice deletes Bob's new announcement", rtDel('Alice', 'ocrng/announce/a1'));
  await deny('Alice clears every announcement', rtDel('Alice', 'ocrng/announce'));
  await allow('Alice hosts a Commander fight', rtPut('Alice', 'ocrng/cmd/Alice/s', { hp: 100 }));
  await deny("Bob joins Alice's fight (only admins watch fights)", rtPut('Bob', 'ocrng/cmd/Alice/join/Bob', { name: 'Bob' }));
  await allow("Owner1 joins Alice's fight", rtPut('Owner1', 'ocrng/cmd/Alice/join/Owner1', { name: 'Owner1' }));
  await deny("Bob ends Alice's fight", rtDel('Bob', 'ocrng/cmd/Alice'));
  await allow('Alice ends her fight', rtDel('Alice', 'ocrng/cmd/Alice'));
  await allow('a one-time sweep is marked done', rtPut('Alice', 'ocrng/sweeps/test1', now));
  await deny('...and nobody can undo it', rtDel('Bob', 'ocrng/sweeps/test1'));
  await deny("Alice writes in Steal a Character (it's off)", rtPut('Alice', 'ocrng/sac/roster/Alice', { name: 'Alice' }));
  await deny('anyone writes outside presence and ocrng', rtPut('Alice', 'other/x', { t: 1 }));

  section('Purge Perms (v4.59)');
  await setDoc('owner', 'servers/s1/channels/c1/messages/pp1', { uid: 'Bob', username: 'Bob', text: 'purge me', createdAt: new Date() });
  await setDoc('owner', 'servers/s1/channels/c1/messages/pp2', { uid: 'Bob', username: 'Bob', text: 'and me', createdAt: new Date() });
  await setDoc('owner', 'servers/s1/channels/c3/messages/pp3', { uid: 'Mo', username: 'Mo', text: 'mods only', createdAt: new Date() });
  await setDoc('owner', 'dms/Bob_Rm', { participants: ['Bob', 'Rm'], autoDelete: false });
  await setDoc('owner', 'dms/Bob_Rm/messages/pd1', { uid: 'Bob', text: 'hi Rm', createdAt: new Date() });
  await setDoc('owner', 'dms/Alice_Bob/messages/pd2', { uid: 'Bob', text: 'just for Alice', createdAt: new Date() });
  await deny("Rm (no purge perms) deletes Bob's message", delDoc('Rm', 'servers/s1/channels/c1/messages/pp1'));
  await deny('Rm gives himself purge perms', updateDoc('Rm', 'users/Rm', { purgePerm: true }));
  await deny('Mod (admin) gives Rm purge perms', updateDoc('Mod', 'users/Rm', { purgePerm: true }));
  await deny("Co (co-owner) gives Rm purge perms (the Owner's alone)", updateDoc('Co', 'users/Rm', { purgePerm: true }));
  await deny('a new sign-in starts out with purge perms', setDoc('Pg', 'users/Pg', { username: 'Pg', authUid: uidOf('Pg'), orbs: 50, purgePerm: true }));
  await allow('Owner1 gives Rm purge perms', updateDoc('Owner1', 'users/Rm', { purgePerm: true }));
  await allow("Rm (purge perms) deletes Bob's message in a channel he can see", delDoc('Rm', 'servers/s1/channels/c1/messages/pp1'));
  await allow("...and posts Sapphire's purge card", setDoc('Rm', 'servers/s1/channels/c1/messages/pc1', { uid: 'bot-sapphire', username: 'Sapphire', purgeResult: { count: 1 }, createdAt: new Date() }));
  await deny("...but not in a channel he can't see", delDoc('Rm', 'servers/s1/channels/c3/messages/pp3'));
  await allow("...and in a DM he's in", delDoc('Rm', 'dms/Bob_Rm/messages/pd1'));
  await deny("...but not in someone else's DM", delDoc('Rm', 'dms/Alice_Bob/messages/pd2'));
  await deny('Rm changes his own purge perms (even taking them off)', commit('Rm', [write('users/Rm', { merge: ['purgePerm'], exists: true })]));
  await allow('Owner1 takes them away', commit('Owner1', [write('users/Rm', { merge: ['purgePerm'], exists: true })]));
  await deny("Rm can't purge any more", delDoc('Rm', 'servers/s1/channels/c1/messages/pp2'));

  section('A server with 9 roles (the rules go through the first 8)');
  {
    const roles = [{ id: 'everyone', name: '@everyone', permissions: EVERYONE, permsV2: true }];
    for (let i = 1; i < 7; i++) roles.push({ id: 'r' + i, name: 'R' + i, permissions: ['addReactions', 'createInvite', 'embedLinks'], color: '#fff' });
    roles.push({ id: 'r7', name: 'Banner', permissions: ['banMembers', 'kickMembers', 'manageMessages', 'pinMessages', 'manageChannels'] });
    roles.push({ id: 'r8', name: 'Too far', permissions: ['administrator'] });
    const many = Array.from({ length: 6 }, (_, i) => 'r' + (i + 1));
    await setDoc('owner', 'servers/big', { name: 'Big', ownerId: 'Owner1', inviteCode: 'bigg', createdAt: daysAgo(3), members: ['Owner1', 'Mo', 'Kid', 'Bob', 'Dan'], bannedUsers: [], roles, memberRoles: { Mo: [...many, 'r7'], Kid: many, Dan: ['r8'] } });
    await setDoc('owner', 'servers/big/channels/bc', { name: 'general', autoDelete: true });
    await setDoc('owner', 'servers/big/channels/bc/messages/bm1', { uid: 'Bob', text: 'hi', createdAt: new Date() });
    await allow('Mo (8th role: Ban Members) bans Bob', commit('Mo', [write('servers/big', { set: { banInfo: { Bob: { by: 'Mo', at: 1, reason: '' } } }, merge: ['banInfo.Bob'], remove: { members: ['Bob'] }, union: { bannedUsers: ['Bob'] } })]));
    await deny('Kid (6 roles, none of them Ban Members) bans Dan', commit('Kid', [write('servers/big', { set: { banInfo: { Dan: { by: 'Kid' } } }, merge: ['banInfo.Dan'], remove: { members: ['Dan'] }, union: { bannedUsers: ['Dan'] } })]));
    await deny('Kid renames the server', updateDoc('Kid', 'servers/big', { name: 'pwned' }));
    await deny('Dan (9th role: Administrator, past the 8 the rules read) renames it', updateDoc('Dan', 'servers/big', { name: 'pwned' }));
    await allow('Mo pins a message', updateDoc('Mo', 'servers/big/channels/bc/messages/bm1', { pinned: true }));
    await deny('Kid pins a message', updateDoc('Kid', 'servers/big/channels/bc/messages/bm1', { pinned: false }));
    await allow('Mo makes a channel', setDoc('Mo', 'servers/big/channels/bc2', { name: 'x' }));
    await deny('Kid makes a channel', setDoc('Kid', 'servers/big/channels/bc3', { name: 'x' }));
    await allow("Mo deletes Bob's message", delDoc('Mo', 'servers/big/channels/bc/messages/bm1'));
  }

  section('Blocking (v4.61)');
  for (const n of ['Blk', 'Pest', 'Pal', 'Fren']) {
    await setDoc('owner', `users/${n}`, { username: n, authUid: uidOf(n), avatarColor: '#5865f2', orbs: 50, friends: [], incomingRequests: [], outgoingRequests: [], banned: false, op: false, premiumUntil: null });
    await setDoc('owner', `accounts/${uidOf(n)}`, { username: n, at: 1 });
  }
  await setDoc('owner', 'dms/Blk_Pest', { participants: ['Blk', 'Pest'], autoDelete: true });
  await allow('Blk keeps his own block list (Pest, Pal and Mod on it)', setDoc('Blk', 'users/Blk/meta/blocks', { list: ['Pest', 'Pal', 'Mod'] }));
  await deny("Pest reads Blk's block list", getDoc('Pest', 'users/Blk/meta/blocks'));
  await deny("Pest changes Blk's block list", setDoc('Pest', 'users/Blk/meta/blocks', { list: [] }));
  await allow('Blk blocks Pest in the DM they already have', commit('Blk', [write('dms/Blk_Pest', { union: { blockedBy: ['Blk'] } })]));
  await deny('Pest messages Blk there', setDoc('Pest', 'dms/Blk_Pest/messages/b1', { uid: 'Pest', text: 'hi', createdAt: new Date() }));
  await deny("Pest takes Blk's block off that DM", commit('Pest', [write('dms/Blk_Pest', { remove: { blockedBy: ['Blk'] } })]));
  await deny('Pest puts someone else in its blockedBy', commit('Pest', [write('dms/Blk_Pest', { union: { blockedBy: ['Pal'] } })]));
  await deny('Pal starts a DM with Blk, who blocked her', setDoc('Pal', 'dms/Blk_Pal', { participants: ['Pal', 'Blk'], autoDelete: true }));
  await deny('Pal sends Blk a friend request', commit('Pal', [write('users/Pal', { union: { outgoingRequests: ['Blk'] } }), write('users/Blk', { union: { incomingRequests: ['Pal'] } })]));
  await allow('Fren (not blocked) sends Blk a friend request', commit('Fren', [write('users/Fren', { union: { outgoingRequests: ['Blk'] } }), write('users/Blk', { union: { incomingRequests: ['Fren'] } })]));
  await allow('Mod (an Admin, ranked above Blk) still starts a DM with him, even though he is on his list', setDoc('Mod', 'dms/Blk_Mod', { participants: ['Mod', 'Blk'], autoDelete: true }));
  await allow('...and messages him', setDoc('Mod', 'dms/Blk_Mod/messages/b2', { uid: 'Mod', text: 'hello', createdAt: new Date() }));
  await deny('Blk blocks Mod in that DM (Mod is ranked above him)', commit('Blk', [write('dms/Blk_Mod', { union: { blockedBy: ['Blk'] } })]));
  await allow("Mod blocks Blk in it (Blk isn't ranked above him)", commit('Mod', [write('dms/Blk_Mod', { union: { blockedBy: ['Mod'] } })]));
  await deny('Blk messages Mod there now', setDoc('Blk', 'dms/Blk_Mod/messages/b3', { uid: 'Blk', text: 'hey', createdAt: new Date() }));
  await deny('Pal makes a DM with a block already in it', setDoc('Pal', 'dms/Fren_Pal', { participants: ['Pal', 'Fren'], autoDelete: true, blockedBy: ['Fren'] }));
  await allow('Pal makes a plain DM with Fren', setDoc('Pal', 'dms/Fren_Pal', { participants: ['Pal', 'Fren'], autoDelete: true }));
  await allow('Blk unblocks Pest in their DM', commit('Blk', [write('dms/Blk_Pest', { remove: { blockedBy: ['Blk'] } })]));
  await allow('...and Pest can message him again', setDoc('Pest', 'dms/Blk_Pest/messages/b4', { uid: 'Pest', text: 'thanks', createdAt: new Date() }));

  section('Server deletion');
  await deny('Bob deletes Alice\'s server', delDoc('Bob', 'servers/s1'));
  await allow('Eve deletes her own server', delDoc('Eve', 'servers/s2'));
  await allow('Co (co-owner) deletes any server', delDoc('Co', 'servers/s1'));

  // Another site on this project (D:\Downloads\Gavinperri, bottlefluid/gavinperri): a library of documents that
  // Frixion's admins write there and anyone reads. Its rules are at the end of firestore.rules.
  section('Gavinperri (another site on this project)');
  {
    await setDoc('owner', 'users/BanMod', { username: 'BanMod', authUid: uidOf('BanMod'), avatarColor: '#5865f2', orbs: 50, friends: [], incomingRequests: [], outgoingRequests: [], banned: true, bannedUntil: null, op: true, premiumUntil: null });
    await setDoc('owner', `accounts/${uidOf('BanMod')}`, { username: 'BanMod', at: 1 });
    const D = 'site_gavinperri_doc', pics = 'site_gavinperri_images', d1 = `${D}/doc1`, lib = `${D}/library`;
    // What one save writes: the live copy and the same thing filed in its history (o changes one side or the other).
    const pair = (who, id, rev, body, o = {}) => {
      const base = { rev, body, imgs: o.imgs || [], ...(o.ids ? { ids: o.ids } : {}) };
      return [
        write(`${D}/${id}`, { set: { ...base, ...(o.main || {}) }, serverTime: ['at'], full: true }),
        write(`${D}/${id}/history/${o.hid || rev}`, { set: { ...base, by: o.by || who, ...(o.hist || {}) }, serverTime: ['at'], full: true }),
      ];
    };
    const save = (who, id, rev, body, o) => commit(who, pair(who, id, rev, body, o));
    const liveOnly = (who, id, rev, body, o = {}) => commit(who, [pair(who, id, rev, body, o)[0]]);
    const histOnly = (who, id, rev, body, o = {}) => commit(who, [pair(who, id, rev, body, o)[1]]);

    await allow('a signed-out visitor fetches the library before there is one', getDoc(null, lib));
    await allow('a signed-out visitor fetches the covers before there are any', getDoc(null, `${D}/covers`));
    await deny('a signed-out visitor fetches a document while there is no library', getDoc(null, d1));
    await deny('a signed-out visitor makes a document', save(null, 'doc1', 1, 'x'));
    await deny('Alice (not an admin) makes a document', save('Alice', 'doc1', 1, 'x'));
    await deny('BanMod (a banned admin) makes a document', save('BanMod', 'doc1', 1, 'x'));
    await deny('Alice makes a document claiming to be the owner in it', save('Alice', 'doc1', 1, 'x', { main: { owner: true }, hist: { owner: true } }));
    await deny('Mod makes one without filing it in the history', liveOnly('Mod', 'doc1', 1, 'x'));
    await deny('Mod files a history entry with no document', histOnly('Mod', 'doc1', 1, 'x'));
    await deny('Mod makes one starting at revision 2', save('Mod', 'doc1', 2, 'x'));
    await deny('Mod makes one with a history entry that says something else', save('Mod', 'doc1', 1, 'x', { hist: { body: 'y' } }));
    await deny('Mod makes one with different pictures listed in the history', save('Mod', 'doc1', 1, 'x', { hist: { imgs: ['a'.repeat(64)] } }));
    await deny("Mod files it under someone else's name", save('Mod', 'doc1', 1, 'x', { by: 'Alice' }));
    await deny('Mod makes one with an extra field', save('Mod', 'doc1', 1, 'x', { main: { owner: true } }));
    await deny('Mod makes one saying who saved it (only the history says)', save('Mod', 'doc1', 1, 'x', { main: { by: 'Mod' } }));
    await deny('Mod files it with an extra field', save('Mod', 'doc1', 1, 'x', { hist: { note: 'hi' } }));
    await deny('Mod makes one with a made-up date', commit('Mod', [
      write(d1, { set: { rev: 1, body: 'x', imgs: [], at: new Date('2020-01-01T00:00:00Z') } }),
      write(`${d1}/history/1`, { set: { rev: 1, body: 'x', imgs: [], by: 'Mod', at: new Date('2020-01-01T00:00:00Z') } })]));
    await deny('Mod makes one with text that is too long (200,001 characters)', save('Mod', 'doc1', 1, 'x'.repeat(200001)));
    await deny('Mod makes one with something that is not text', save('Mod', 'doc1', 1, { html: 'x' }));
    await deny('Mod makes one listing 25 pictures', save('Mod', 'doc1', 1, 'x', { imgs: Array.from({ length: 25 }, (_, i) => 'p' + i) }));
    await deny('Mod makes one that lists documents (only the library does)', save('Mod', 'doc1', 1, 'x', { ids: ['doc1'] }));
    await deny('Mod makes one under a name with capitals and a space', save('Mod', 'Bad Name', 1, 'x'));
    await deny('Mod makes one under a name that is too short', save('Mod', 'ab', 1, 'x'));
    await deny('Mod makes a document where the covers go', save('Mod', 'covers', 1, 'x'));
    await allow('Mod (admin) publishes a document, revision 1', save('Mod', 'doc1', 1, 'first'));
    await deny("a signed-out visitor fetches it before the library lists it", getDoc(null, d1));
    await deny('Alice fetches it before the library lists it', getDoc('Alice', d1));
    await allow('Mod fetches it anyway (to edit with)', getDoc('Mod', d1));

    await deny('Alice publishes the library', save('Alice', 'library', 1, 'lib', { ids: ['doc1'] }));
    await deny('BanMod publishes the library', save('BanMod', 'library', 1, 'lib', { ids: ['doc1'] }));
    await deny('Mod publishes the library without its list of documents', save('Mod', 'library', 1, 'lib'));
    await deny('Mod publishes the library with a list that is not a list', save('Mod', 'library', 1, 'lib', { main: { ids: 'doc1' }, hist: { ids: 'doc1' } }));
    await deny('Mod publishes the library listing 101 documents', save('Mod', 'library', 1, 'lib', { ids: Array.from({ length: 101 }, (_, i) => 'doc' + i) }));
    await deny('Mod publishes the library with another list in its history', save('Mod', 'library', 1, 'lib', { ids: ['doc1'], hist: { ids: ['doc1', 'doc2'] } }));
    await deny('Mod publishes the library listing the shelf (the admin-only list)', save('Mod', 'library', 1, 'lib', { ids: ['doc1', 'shelf'] }));
    await deny('Mod publishes the library listing itself', save('Mod', 'library', 1, 'lib', { ids: ['library'] }));
    await allow('Mod publishes the library, listing the document', save('Mod', 'library', 1, 'lib', { ids: ['doc1'] }));
    await allow('Mod publishes the shelf (the full list, hidden documents too)', save('Mod', 'shelf', 1, 'all'));
    await deny('a signed-out visitor reads the shelf', getDoc(null, `${D}/shelf`));
    await deny('Alice reads the shelf', getDoc('Alice', `${D}/shelf`));
    await allow('Mod reads the shelf', getDoc('Mod', `${D}/shelf`));
    await deny('Alice publishes the shelf', save('Alice', 'shelf', 2, 'mine'));
    await allow('a signed-out visitor reads the library', getDoc(null, lib));
    await allow('a signed-out visitor reads the listed document', getDoc(null, d1));
    await allow('Alice reads the listed document', getDoc('Alice', d1));
    await deny('a signed-out visitor reads a name that is not listed', getDoc(null, `${D}/other`));
    await deny('a signed-out visitor lists the documents', query(null, '', D));
    await deny('Mod lists the documents', query('Mod', '', D));
    await deny('a signed-out visitor reads a history entry', getDoc(null, `${d1}/history/1`));
    await deny("a signed-out visitor reads the library's history", getDoc(null, `${lib}/history/1`));
    await deny('Alice reads a history entry', getDoc('Alice', `${d1}/history/1`));
    await deny('BanMod reads a history entry', getDoc('BanMod', `${d1}/history/1`));
    await allow('Mod reads a history entry', getDoc('Mod', `${d1}/history/1`));
    await allow('Mod lists a history', query('Mod', d1, 'history'));
    await deny('Alice lists a history', query('Alice', d1, 'history'));
    await deny('a signed-out visitor lists a history', query(null, d1, 'history'));

    await deny('Mod publishes revision 1 again', save('Mod', 'doc1', 1, 'again'));
    await deny('Mod skips to revision 3', save('Mod', 'doc1', 3, 'skip'));
    await deny('Mod publishes revision 2 without filing it', liveOnly('Mod', 'doc1', 2, 'x'));
    await deny('Mod publishes revision 2 but files it as 3', save('Mod', 'doc1', 2, 'x', { hid: 3 }));
    await deny("Mod publishes revision 2 but files it in another document's history", commit('Mod', [
      pair('Mod', 'doc1', 2, 'x')[0], pair('Mod', 'doc9', 2, 'x')[1]]));
    await deny('Mod files revision 2 ahead of time', histOnly('Mod', 'doc1', 2, 'x'));
    await deny('Mod files revision 2 under a second name (02)', commit('Mod', [
      ...pair('Mod', 'doc1', 2, 'x'), write(`${d1}/history/02`, { set: { rev: 2, body: 'x', imgs: [], by: 'Mod' }, serverTime: ['at'], full: true })]));
    await deny('Mod changes the live document in place (same revision)', updateDoc('Mod', d1, { body: 'sneaky' }));
    await deny('Alice publishes revision 2', save('Alice', 'doc1', 2, 'x'));
    await deny('BanMod publishes revision 2', save('BanMod', 'doc1', 2, 'x'));
    await allow('Co (co-owner) publishes revision 2', save('Co', 'doc1', 2, 'second'));
    await allow('Owner1 publishes revision 3', save('Owner1', 'doc1', 3, 'third'));
    await deny('Mod rewrites a history entry', updateDoc('Mod', `${d1}/history/1`, { body: 'changed' }));
    await deny('Owner1 rewrites a history entry', histOnly('Owner1', 'doc1', 1, 'changed'));
    await deny('Mod deletes a document', delDoc('Mod', d1));
    await deny('Owner1 deletes a document', delDoc('Owner1', d1));
    await deny('Owner1 deletes a history entry', delDoc('Owner1', `${d1}/history/1`));
    await deny('Owner1 deletes the library', delDoc('Owner1', lib));
    await deny('a signed-out visitor deletes a document', delDoc(null, d1));

    // Naming a revision: Admins and up give one a name (or change or clear it), and that is all that changes.
    const h1 = `${d1}/history/1`;
    const label = (who, name, o = {}) => commit(who, [write(o.path || h1, {
      set: { name, namedBy: o.by || who, ...(o.set || {}) }, merge: ['name', 'namedBy', ...Object.keys(o.set || {})],
      ...(o.when ? {} : { serverTime: ['namedAt'] }) })]);
    await deny('a signed-out visitor names a revision', label(null, 'First draft', { by: 'Mod' }));
    await deny('Alice names a revision', label('Alice', 'First draft'));
    await deny('BanMod names a revision', label('BanMod', 'First draft'));
    await deny('Mod names a revision as someone else', label('Mod', 'First draft', { by: 'Owner1' }));
    await deny('Mod names a revision without saying when', label('Mod', 'First draft', { when: true }));
    await deny('Mod names a revision with a made-up date', label('Mod', 'First draft', { when: true, set: { namedAt: new Date('2020-01-01T00:00:00Z') } }));
    await deny('Mod names a revision and changes what it says', label('Mod', 'First draft', { set: { body: 'changed' } }));
    await deny('Mod names a revision and changes its pictures', label('Mod', 'First draft', { set: { imgs: ['a'.repeat(64)] } }));
    await deny('Mod names a revision and changes who published it', label('Mod', 'First draft', { set: { by: 'Owner1' } }));
    await deny('Mod names a revision and changes its number', label('Mod', 'First draft', { set: { rev: 7 } }));
    await deny('Mod names a revision and adds another field', label('Mod', 'First draft', { set: { note: 'hi' } }));
    await deny('Mod gives a revision a name that is too long (61 characters)', label('Mod', 'x'.repeat(61)));
    await deny('Mod gives a revision a name that is not text', label('Mod', 5));
    await deny('Mod names a revision that was never published', label('Mod', 'Ghost', { path: `${d1}/history/9` }));
    await deny('Mod names the live document (only revisions in a history have names)', label('Mod', 'Live', { path: d1 }));
    await allow('Mod names a revision', label('Mod', 'First draft'));
    await allow('Co (co-owner) renames it', label('Co', 'The very first one'));
    await allow("Owner1 names one of the library's revisions", label('Owner1', 'One document', { path: `${lib}/history/1` }));
    await allow('Mod clears a name', label('Mod', ''));
    await allow('Mod names it again (60 characters)', label('Mod', 'n'.repeat(60)));
    await deny('Mod takes the name field away', commit('Mod', [write(h1, { set: {}, merge: ['name'], exists: true })]));
    await deny('Alice reads a named revision', getDoc('Alice', h1));
    await allow('Mod reads it, name and all', getDoc('Mod', h1));
    await deny('Owner1 deletes a named revision', delDoc('Owner1', h1));

    await allow('Mod publishes a second document and lists it, in one write', commit('Mod', [
      ...pair('Mod', 'doc2', 1, 'another'), ...pair('Mod', 'library', 2, 'lib', { ids: ['doc1', 'doc2'] })]));
    await allow('a signed-out visitor reads the second document', getDoc(null, `${D}/doc2`));
    await allow('Mod takes the first document off the list', save('Mod', 'library', 3, 'lib', { ids: ['doc2'] }));
    await deny('a signed-out visitor can no longer read the first document', getDoc(null, d1));
    await allow('...but the second still', getDoc(null, `${D}/doc2`));
    await allow('Mod still reads the first (it is hidden, not gone)', getDoc('Mod', d1));
    await allow('Mod still publishes to it', save('Mod', 'doc1', 4, 'fourth'));

    const png = 'data:image/png;base64,iVBORw0KGgo=', id1 = 'a'.repeat(64), id2 = 'b'.repeat(64), id3 = 'c'.repeat(64);
    const covers = (who, data, extra = {}) => commit(who, [write(`${D}/covers`, { set: { covers: data, ...extra }, serverTime: ['at'], full: true })]);
    await deny('a signed-out visitor writes the covers', covers(null, { [id1]: png }));
    await deny('Alice writes the covers', covers('Alice', { [id1]: png }));
    await deny('BanMod writes the covers', covers('BanMod', { [id1]: png }));
    await deny('Mod writes the covers with an extra field', covers('Mod', { [id1]: png }, { rev: 1 }));
    await deny('Mod writes covers that are not a set of pictures', covers('Mod', 'x'));
    await deny('Mod writes the covers with a made-up date', commit('Mod', [write(`${D}/covers`, { set: { covers: {}, at: new Date('2020-01-01T00:00:00Z') } })]));
    await allow('Mod writes the covers', covers('Mod', { [id1]: png }));
    await allow('Mod writes them again', covers('Mod', { [id1]: png, [id2]: png }));
    await allow('a signed-out visitor reads the covers', getDoc(null, `${D}/covers`));
    await deny('Owner1 deletes the covers', delDoc('Owner1', `${D}/covers`));
    await deny('Mod files a history entry for the covers', histOnly('Mod', 'covers', 1, 'x'));

    const pic = (who, id, data, extra = {}) => commit(who, [write(`${pics}/${id}`, { set: { data, w: 10, h: 10, ...extra }, serverTime: ['at'], full: true })]);
    await deny('a signed-out visitor adds a picture', pic(null, id1, png));
    await deny('Alice adds a picture', pic('Alice', id1, png));
    await deny('BanMod adds a picture', pic('BanMod', id1, png));
    await deny('Mod adds a picture under a made-up id', pic('Mod', 'logo', png));
    await deny('Mod adds a web address as a picture', pic('Mod', id1, 'https://example.com/a.png'));
    await deny('Mod adds an SVG', pic('Mod', id1, 'data:image/svg+xml;base64,PHN2Zz4='));
    await deny('Mod adds a web page pretending to be a picture', pic('Mod', id1, 'data:text/html;base64,PGI+'));
    await deny('Mod adds a picture with something tacked on after it', pic('Mod', id1, png + '"><script>alert(1)</script>'));
    await deny('Mod adds a picture with an extra field', pic('Mod', id1, png, { by: 'Mod' }));
    await deny('Mod adds a picture with a made-up size', pic('Mod', id1, png, { w: 99999 }));
    await deny('Mod adds a picture that is too big (950,001 characters)', pic('Mod', id1, 'data:image/png;base64,' + 'A'.repeat(950001 - 22)));
    await allow('Mod adds a picture', pic('Mod', id1, png));
    await allow('Mod adds a big picture (900,000 characters)', pic('Mod', id2, 'data:image/webp;base64,' + 'A'.repeat(900000 - 23)));
    await deny('Mod replaces a picture', pic('Mod', id1, 'data:image/png;base64,AAAA'));
    await deny('Owner1 deletes a picture', delDoc('Owner1', `${pics}/${id1}`));
    await deny('Mod lists the pictures', query('Mod', '', pics));
    await deny('a signed-out visitor lists the pictures', query(null, '', pics));
    await deny("a signed-out visitor fetches a picture the library doesn't list", getDoc(null, `${pics}/${id1}`));
    await deny("Alice fetches a picture the library doesn't list", getDoc('Alice', `${pics}/${id1}`));
    await allow('Mod fetches it anyway (to edit with)', getDoc('Mod', `${pics}/${id1}`));
    await allow('Mod publishes the library, now listing the picture', save('Mod', 'library', 4, 'lib', { ids: ['doc2'], imgs: [id1] }));
    await allow('a signed-out visitor fetches the picture now', getDoc(null, `${pics}/${id1}`));
    await deny("...but still not one the library doesn't list", getDoc(null, `${pics}/${id2}`));
    await deny('...or one that was never made', getDoc(null, `${pics}/${id3}`));
    await allow('Mod publishes the library without the picture', save('Mod', 'library', 5, 'lib', { ids: ['doc2'] }));
    await deny('a signed-out visitor can no longer fetch it', getDoc(null, `${pics}/${id1}`));
    await allow("Mod still reads the library's earlier versions", getDoc('Mod', `${lib}/history/4`));
    // (nothing here opens Frixion itself)
    await deny('a signed-out visitor still reads no profile', getDoc(null, 'users/Mod'));
    await deny('a signed-out visitor still reads no account', getDoc(null, `accounts/${uidOf('Mod')}`));
  }

  section('Easter eggs and typing dots (v4.62)');
  {
    await deny('Alice gives herself the Cracker tag', updateDoc('Alice', 'users/Alice', { cracker: true }));
    await deny('Mod gives Eve the Cracker tag', updateDoc('Mod', 'users/Eve', { cracker: true }));
    await allow('Co gives Eve the Cracker tag', updateDoc('Co', 'users/Eve', { cracker: true }));
    await setDoc('owner', 'eggs/Alice', { found: ['party'], at: 1 });
    await allow('Alice reads her own eggs', getDoc('Alice', 'eggs/Alice'));
    await deny("Bob reads Alice's eggs", getDoc('Bob', 'eggs/Alice'));
    await allow("Mod reads Alice's eggs", getDoc('Mod', 'eggs/Alice'));
    await deny('Alice writes her own eggs', setDoc('Alice', 'eggs/Alice', { found: ['party', 'pi'], at: 2 }));
    await deny('Co writes eggs', setDoc('Co', 'eggs/Eve', { found: ['party'], at: 2 }));
    await deny('Bob lists everyone\'s eggs', query('Bob', '', 'eggs'));
    const at = { '.sv': 'timestamp' }, to = `typingTo/${uidOf('Bob')}`, mine = `${to}/${uidOf('Alice')}`;
    await allow('Alice tells Bob she is typing in their DM', rtPut('Alice', mine, { c: 'dm:Alice_Bob', n: 'Alice', at }));
    await allow('Alice tells Bob she is typing in a group', rtPut('Alice', mine, { c: 'gdm:AbC123xyz', n: 'Alice', at }));
    await deny('Alice writes an entry as Carol', rtPut('Alice', `${to}/${uidOf('Carol')}`, { c: 'dm:Alice_Bob', n: 'Carol', at }));
    await deny('Alice puts another name on her own entry', rtPut('Alice', mine, { c: 'dm:Alice_Bob', n: 'Carol', at }));
    await deny('Alice adds an extra field', rtPut('Alice', mine, { c: 'dm:Alice_Bob', n: 'Alice', at, x: 1 }));
    await deny('Alice names something that is not a DM or group', rtPut('Alice', mine, { c: 'server:s1', n: 'Alice', at }));
    await deny('Alice makes up the time', rtPut('Alice', mine, { c: 'dm:Alice_Bob', n: 'Alice', at: 5 }));
    await deny('Alice leaves out the conversation', rtPut('Alice', mine, { n: 'Alice', at }));
    await deny('a signed-out visitor writes one', rtPut(null, mine, { c: 'dm:Alice_Bob', n: 'Alice', at }));
    await allow('Bob reads who is typing to him', rtGet('Bob', to));
    await deny('Carol reads who is typing to Bob', rtGet('Carol', to));
    await deny('Alice reads who is typing to Bob', rtGet('Alice', to));
    await allow('Alice clears her own entry', rtDel('Alice', mine));
  }
  section('The Owner\'s own tabs and the Casino (v4.63)');
  {
    await setDoc('owner', 'ips/ip_v463', { label: '10.1.x.x', accounts: ['Bob'], devices: [], lastSeen: new Date() });
    await allow('Owner1 reads a network', getDoc('Owner1', 'ips/ip_v463'));
    await deny('Co reads a network', getDoc('Co', 'ips/ip_v463'));
    await deny('Co lists the networks', query('Co', '', 'ips'));
    await deny('Co bans a network', setDoc('Co', 'bannedIps/ip_v463', { reason: 'x', by: 'Co', at: 1, label: '10.1.x.x' }));
    await allow('Owner1 bans it', setDoc('Owner1', 'bannedIps/ip_v463', { reason: 'x', by: 'Owner1', at: 1, label: '10.1.x.x' }));
    await deny('Co lists the banned networks', query('Co', '', 'bannedIps'));
    await deny('Co unbans it', delDoc('Co', 'bannedIps/ip_v463'));
    await allow('Owner1 unbans it', delDoc('Owner1', 'bannedIps/ip_v463'));
    await setDoc('owner', 'loginCodes/c_v463', { username: 'Bob', by: 'Owner1', at: new Date() });
    await deny("Co counts Bob's one-time passwords", query('Co', '', 'loginCodes', ['username', 'EQUAL', 'Bob']));
    await deny('Co cancels one', delDoc('Co', 'loginCodes/c_v463'));
    await allow('Owner1 cancels it', delDoc('Owner1', 'loginCodes/c_v463'));
    await setDoc('owner', 'devices/dev_v463', { id: 'dev_v463', accounts: ['Bob'], banned: false });
    await deny('Co lists every device', query('Co', '', 'devices'));
    await allow('Owner1 lists every device', query('Owner1', '', 'devices'));
    await deny("Co bans Bob's device", updateDoc('Co', 'devices/dev_v463', { banned: true, banReason: 'x', bannedBy: 'Co', bannedAt: 1 }));
    await allow("Owner1 bans Bob's device", updateDoc('Owner1', 'devices/dev_v463', { banned: true, banReason: 'x', bannedBy: 'Owner1', bannedAt: 1 }));
    await deny('Co deletes a device entry', delDoc('Co', 'devices/dev_v463'));
    await allow('Co still bans a player', updateDoc('Co', 'users/Eve', { banned: true, banReason: 'x' }));
    await allow('...and unbans them', updateDoc('Co', 'users/Eve', { banned: false, banReason: '' }));
    // the Casino record: only functions/api/admin/casino writes it
    await allow('(the casino puts a record on Alice)', updateDoc('owner', 'users/Alice', { casino: { day: '2026-11-15', n: 200, open: { id: 'g1', g: 'mines', b: 100, p: { m: 3 }, at: 1 } } }));
    await deny('Alice resets her games for today', updateDoc('Alice', 'users/Alice', { casino: { day: '2026-11-15', n: 0 } }));
    await deny('Alice clears her open game', updateDoc('Alice', 'users/Alice', { casino: { day: '2026-11-15', n: 200 } }));
    await deny('Alice deletes her casino record', updateDoc('Alice', 'users/Alice', { casino: null }));
    await allow('Alice still changes her bio', updateDoc('Alice', 'users/Alice', { bio: 'hi' }));
    await deny("Mod (admin) changes Alice's casino record", updateDoc('Mod', 'users/Alice', { casino: { n: 0 } }));
  }
  section('Infinite Orbs, banner pictures, ranks and loans (v4.64)');
  {
    await deny('Alice gives herself infinite Orbs', updateDoc('Alice', 'users/Alice', { infOrbs: true }));
    await deny('Mod (admin) gives Eve infinite Orbs', updateDoc('Mod', 'users/Eve', { infOrbs: true }));
    await allow('Co gives Eve infinite Orbs', updateDoc('Co', 'users/Eve', { infOrbs: true }));
    await deny('Alice puts a banner picture on herself without paying', updateDoc('Alice', 'users/Alice', { bannerImage: 'https://res.cloudinary.com/a97nqv9w/image/upload/v1/x.png' }));
    await allow('(the server puts one on Alice)', updateDoc('owner', 'users/Alice', { bannerImage: 'https://res.cloudinary.com/a97nqv9w/image/upload/v1/x.png' }));
    await deny('Alice swaps it for another picture', updateDoc('Alice', 'users/Alice', { bannerImage: 'https://example.com/y.png' }));
    await allow('Alice takes her banner picture off', commit('Alice', [write('users/Alice', { set: {}, merge: ['bannerImage'], exists: true })]));
    await deny('Alice gives herself a rank', updateDoc('Alice', 'users/Alice', { customRank: 'r1' }));
    await deny('Mod (admin) gives Eve a rank', updateDoc('Mod', 'users/Eve', { customRank: 'r1' }));
    await allow('Co gives Eve a rank', updateDoc('Co', 'users/Eve', { customRank: 'r1' }));
    await deny('Mod (admin) changes the ranks', setDoc('Mod', 'config/ranks', { list: [] }));
    await allow('Co changes the ranks', setDoc('Co', 'config/ranks', { list: [{ id: 'r1', name: 'Tester', c1: '#ff0000', c2: '#00ff00' }] }));
    await allow('Mod still changes the word filter', updateDoc('Mod', 'config/filter', { enabled: true }));
    await allow('Bob reads the ranks', getDoc('Bob', 'config/ranks'));
    await deny('Alice raises her own credit', updateDoc('Alice', 'users/Alice', { credit: 500 }));
    await deny('Alice fills in her own loan list', updateDoc('Alice', 'users/Alice', { loanWith: ['Bob'] }));
    await deny('Alice moves her loan check', updateDoc('Alice', 'users/Alice', { loanNext: 1 }));
    await allow('Alice hides her Orbs', updateDoc('Alice', 'users/Alice', { hideOrbs: true }));
    await setDoc('owner', 'loans/l1', { from: 'Bob', to: 'Alice', amount: 100, paid: 0, status: 'active', at: 1, dueAt: 2 });
    await allow('Alice (the borrower) reads the loan', getDoc('Alice', 'loans/l1'));
    await allow('Bob (the lender) reads the loan', getDoc('Bob', 'loans/l1'));
    await deny('Carol reads the loan', getDoc('Carol', 'loans/l1'));
    await allow('Mod (staff) reads the loan', getDoc('Mod', 'loans/l1'));
    await allow('Alice lists the loans to her', query('Alice', '', 'loans', ['to', 'EQUAL', 'Alice']));
    await deny('Carol lists the loans to Alice', query('Carol', '', 'loans', ['to', 'EQUAL', 'Alice']));
    await deny('Alice marks her loan paid', updateDoc('Alice', 'loans/l1', { status: 'paid' }));
    await deny('Alice makes up a loan', setDoc('Alice', 'loans/l2', { from: 'Bob', to: 'Alice', amount: 100, status: 'active' }));
    await deny('Bob deletes the loan', delDoc('Bob', 'loans/l1'));
  }
  section('Badges (v4.65)');
  {
    const gm = (who, path, n, more = {}) => commit(who, [write(path, { inc: { 'stats.gameMinutes': n }, serverTime: ['stats.gameAt'], ...more })]);
    await allow('Eve saves 10 minutes of game time', gm('Eve', 'users/Eve', 10));
    await deny('...and 5 more right away (at most once every 9 minutes)', gm('Eve', 'users/Eve', 5));
    await updateDoc('owner', 'users/Dan', { stats: { gameMinutes: 30, gameAt: new Date(Date.now() - 10 * 60000), messagesSent: 4 } });
    await deny('Dan saves 11 minutes at once', gm('Dan', 'users/Dan', 11));
    await allow('Dan saves 10 more minutes, 10 minutes after his last save', gm('Dan', 'users/Dan', 10));
    await updateDoc('owner', 'users/Dan', { stats: { gameMinutes: 40, gameAt: new Date(Date.now() - 10 * 60000), messagesSent: 4 } });
    await deny('Dan adds minutes without the server\'s time on them', commit('Dan', [write('users/Dan', { inc: { 'stats.gameMinutes': 5 } })]));
    await deny('Dan adds minutes with a made-up time', updateDoc('Dan', 'users/Dan', { stats: { gameMinutes: 45, gameAt: new Date(), messagesSent: 4 } }));
    await deny('Dan moves his save time without adding minutes', commit('Dan', [write('users/Dan', { serverTime: ['stats.gameAt'] })]));
    await deny('Dan lowers his game time', commit('Dan', [write('users/Dan', { inc: { 'stats.gameMinutes': -5 }, serverTime: ['stats.gameAt'] })]));
    await allow('Dan still counts a message he sent', commit('Dan', [write('users/Dan', { inc: { 'stats.messagesSent': 1 } })]));
    await deny('Dan counts a gift without paying for it', commit('Dan', [write('users/Dan', { inc: { 'stats.giftsGiven': 1 } })]));
    await updateDoc('owner', 'users/Dan', { orbs: 5000 });
    await deny('Dan counts a gift but pays only 1000', commit('Dan', [write('users/Dan', { inc: { 'stats.giftsGiven': 1, orbs: -1000 } })]));
    await deny('Dan counts two gifts for one', commit('Dan', [write('users/Dan', { inc: { 'stats.giftsGiven': 2, orbs: -1400 } })]));
    await allow('Dan gifts Premium: 1400 Orbs and the gift counted in the same transaction', commit('Dan', [
      write('users/Dan', { inc: { orbs: -1400, 'stats.giftsGiven': 1 } }),
      write('redeemCodes/GIFT465', { set: { code: 'GIFT465', type: 'premium', value: 3, createdBy: 'Dan', maxUses: 1, uses: 0, usedBy: [], redeemedBy: null, redeemedAt: null }, exists: false })]));
    await deny('a new account starts with game time', setDoc('Fresh', 'users/Fresh', { username: 'Fresh', authUid: uidOf('Fresh'), op: false, banned: false, premiumUntil: null, orbs: 50, stats: { gameMinutes: 9000 } }));
    await deny('a new account starts with gifts', setDoc('Fresh', 'users/Fresh', { username: 'Fresh', authUid: uidOf('Fresh'), op: false, banned: false, premiumUntil: null, orbs: 50, stats: { giftsGiven: 25 } }));
    await allow('...but one that starts at zero signs up fine', setDoc('Fresh', 'users/Fresh', { username: 'Fresh', authUid: uidOf('Fresh'), op: false, banned: false, premiumUntil: null, orbs: 50, stats: { messagesSent: 0, reactionsGiven: 0, dmsStarted: 0, serversCount: 0 } }));
    await deny('Alice gives herself the Tester badge', updateDoc('Alice', 'users/Alice', { staffBadges: ['tester'] }));
    await deny('Mod (admin) gives Eve the Tester badge', updateDoc('Mod', 'users/Eve', { staffBadges: ['tester'] }));
    await allow('Co gives Eve the Tester badge', updateDoc('Co', 'users/Eve', { staffBadges: ['tester'] }));
    await deny('Eve takes her staff badge off herself', updateDoc('Eve', 'users/Eve', { staffBadges: [] }));
    await deny('Alice adds a Shop badge to herself', commit('Alice', [write('users/Alice', { union: { ownedBadges: ['crown'] } })]));
    await deny('Alice wears a badge she doesn\'t own', updateDoc('Alice', 'users/Alice', { equippedBadge: 'crown' }));
    await allow('(the server sells Alice the Crown badge)', commit('owner', [write('users/Alice', { set: { equippedBadge: 'crown' }, merge: ['equippedBadge'], union: { ownedBadges: ['crown'] } })]));
    await allow('Alice wears the Crown badge she owns', updateDoc('Alice', 'users/Alice', { equippedBadge: 'crown' }));
    await allow('Alice lets go of the Crown badge', commit('Alice', [write('users/Alice', { remove: { ownedBadges: ['crown'] } })]));
    await allow('Bob reads the Shop badges', query('Bob', '', 'shopBadges'));
    await deny('Bob adds a Shop badge', setDoc('Bob', 'shopBadges/b1', { name: 'Free', price: 0 }));
    await allow('Mod (staff) adds a Shop badge', setDoc('Mod', 'shopBadges/b1', { name: 'Gem', price: 900 }));
  }
  process.exit(summary() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
