// v4.77 in the page:
// - #2: Live sidebar LIVE badges for screenshare (DM + Server Channel) + checkForNewVersion reload guard while sharing/watching
// - #3a: Server AutoMod (Server Settings tab, blocked words, external links w/ Frixion exemption, anti-spam flood/duplicate, 5m cooldown, staff bypass)
// - #3b: Message Forwarding (hover button + modal search across DMs & channels + optional comment -> renders .msg-forwarded card + passiton egg)
// - #3c: Bookmarks / Saved Messages (hover toggle -> private users/{uid}/meta/bookmarks + header Saved Messages modal w/ search & remove + savedforlater egg)
// - #6: 100th Easter Egg Milestone (centurion via "century", 102 total eggs, UPDATES top is 4.77)
const { check, until, doc, put, patch, wait } = T;
const hideModals = () => document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));

check('Tester (Owner) logs in', await T.login('Tester'));
await until(() => Array.isArray(window.__myServers) && window.__myServers.some(s => s.id === 'pcs01'), 6000);
await until(() => Array.isArray(window.__myDMs) && window.__myDMs.some(d => d.id === 'Sumi_Tester'), 6000);
hideModals();

// ---------- 1. Changelog & 100th Egg Milestone (#6) ----------
check('v4.77: UPDATES top is 4.77 and EGGS total is 102',
  UPDATES[0].v === '4.77' && EGGS.length === 102 && !!EGG_BY_ID.centurion && !!EGG_BY_ID.savedforlater && !!EGG_BY_ID.passiton,
  { v: UPDATES[0].v, count: EGGS.length });

// ---------- 2. Live Sidebar LIVE Badges (#2) ----------
// 2a. DM sidebar LIVE badge when remote peer Sumi tracks presence on screen:dm:Sumi_Tester
const remoteSb = window.supabase.createClient('http://127.0.0.1:54321', 'local-anon-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
await until(() => ssDmWatched.has('dm:Sumi_Tester') && ssChannels.get('dm:Sumi_Tester')?.joined, 6000);
const dmPeerCh = remoteSb.channel('screen:dm:Sumi_Tester', { config: { presence: { key: 'Sumi' } } });
let dmPeerJoined = false;
dmPeerCh.subscribe(st => { if (st === 'SUBSCRIBED') dmPeerJoined = true; });
await until(() => dmPeerJoined, 5000);
dmPeerCh.track({ sharing: true, uid: 'Sumi', name: 'Sumi', since: Date.now(), viewers: 0 });
check('v4.77: DM row in sidebar shows green LIVE badge when remote peer shares screen',
  !!(await until(() => !!document.querySelector('#dm-rows .dm-row[data-room="dm:Sumi_Tester"] .ss-side-live'), 5000)));
dmPeerCh.untrack();
check('v4.77: DM LIVE badge disappears immediately when remote peer stops sharing',
  !!(await until(() => !document.querySelector('#dm-rows .dm-row[data-room="dm:Sumi_Tester"] .ss-side-live'), 5000)));
await remoteSb.removeChannel(dmPeerCh);

// 2b. Server channel sidebar LIVE badge when remote peer shares in #general via screen-srv:pcs01
const srv = window.__myServers.find(s => s.id === 'pcs01');
await selectServer(srv);
await until(() => currentServerId === 'pcs01' && !!document.querySelector('#channel-rows .channel-row[data-room="ch:pcs01:general"]'), 6000);
await until(() => ssSrvChannels.get('pcs01')?.joined, 6000);
const remoteSb2 = window.supabase.createClient('http://127.0.0.1:54321', 'local-anon-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const srvPeerCh = remoteSb2.channel('screen-srv:pcs01', { config: { presence: { key: 'Sumi' } } });
let srvPeerJoined = false;
srvPeerCh.subscribe(st => { if (st === 'SUBSCRIBED') srvPeerJoined = true; });
await until(() => srvPeerJoined, 5000);
srvPeerCh.track({ sharing: true, uid: 'Sumi', name: 'Sumi', cid: 'general', tid: null });
check('v4.77: server channel row shows green LIVE badge when remote peer shares in that channel',
  !!(await until(() => !!document.querySelector('#channel-rows .channel-row[data-room="ch:pcs01:general"] .ss-side-live'), 5000)));
srvPeerCh.untrack();
check('v4.77: server channel LIVE badge disappears when remote peer stops sharing',
  !!(await until(() => !document.querySelector('#channel-rows .channel-row[data-room="ch:pcs01:general"] .ss-side-live'), 5000)));
await remoteSb2.removeChannel(srvPeerCh);

// 2c. checkForNewVersion() does NOT auto-reload while actively sharing (shows versionBar instead)
const realFetch = window.fetch;
const origLocalStream = ssLocalStream;
try {
  ssLocalStream = { fake: true };
  versionCheckAt = 0;
  if (versionBar) { versionBar.remove(); versionBar = null; }
  sessionStorage.removeItem('frixion_reloaded_for');
  window.fetch = async (u, o) => String(u).startsWith('/?fresh=')
    ? new Response((await (await realFetch('/index.html', { cache: 'no-store' })).text()).replace(/script\.js\?v=\d+/, 'script.js?v=99998'), { status: 200, headers: { 'Content-Type': 'text/html' } })
    : realFetch(u, o);
  await checkForNewVersion();
  check('v4.77: checkForNewVersion shows Reload bar instead of reloading while screensharing', !!versionBar && !!document.querySelector('.version-bar'));
} finally {
  window.fetch = realFetch;
  ssLocalStream = origLocalStream;
  if (versionBar) { versionBar.remove(); versionBar = null; }
}

// ---------- 3. Bookmarks / Saved Messages (#3c) ----------
await selectDM('Sumi_Tester', 'Sumi');
await until(() => currentView === 'dm' && currentDMId === 'Sumi_Tester', 5000);
// Send a fresh message so we definitely have one to bookmark & forward
$('composer-input').value = 'Remember this secret plan for Friday';
await sendMessage();
await until(() => lastRawMessages.some(m => m.text === 'Remember this secret plan for Friday'), 5000);
const targetMsg = lastRawMessages.find(m => m.text === 'Remember this secret plan for Friday');
const msgLine = document.querySelector(`.msg-line[data-mid="${CSS.escape(targetMsg.id)}"]`);
check('v4.77: message hover bar includes Forward and Bookmark buttons',
  !!msgLine && !!msgLine.querySelector('.forward-msg') && !!msgLine.querySelector('.bookmark-msg'));

msgLine.querySelector('.bookmark-msg').click();
check('v4.77: bookmarking a message saves it to private users/Tester/meta/bookmarks and unlocks savedforlater egg',
  !!(await until(async () => {
    const bm = await doc('users/Tester/meta/bookmarks');
    return bm && Array.isArray(bm.items) && bm.items.some(i => i.mid === targetMsg.id) && eggFoundSet.has('savedforlater');
  }, 6000)));

$('bookmarks-toggle').click();
await wait(120);
check('v4.77: Saved Messages modal displays the bookmarked message',
  !$('bookmarks-modal').classList.contains('hidden') && $('bookmarks-list').textContent.includes('Remember this secret plan for Friday'));

// Search inside Bookmarks modal
$('bookmarks-search').value = 'zzznomatch';
$('bookmarks-search').dispatchEvent(new Event('input'));
check('v4.77: Saved Messages search filters cleanly', $('bookmarks-list').textContent.includes('No saved messages match'));
$('bookmarks-search').value = 'secret plan';
$('bookmarks-search').dispatchEvent(new Event('input'));
check('v4.77: Saved Messages search matches text', $('bookmarks-list').textContent.includes('Remember this secret plan for Friday'));

// Remove bookmark from modal
$('bookmarks-list').querySelector('[data-bm-del]').click();
check('v4.77: removing a bookmark clears it from users/Tester/meta/bookmarks',
  !!(await until(async () => {
    const bm = await doc('users/Tester/meta/bookmarks');
    return bm && Array.isArray(bm.items) && !bm.items.some(i => i.mid === targetMsg.id);
  }, 5000)));
closeModal('bookmarks-modal');

// ---------- 4. Message Forwarding (#3b) ----------
msgLine.querySelector('.forward-msg').click();
await until(() => !$('forward-modal').classList.contains('hidden') && !!$('forward-targets').querySelector('[data-fwd-send="ch:pcs01:general"]'), 6000);
$('forward-note').value = 'Sharing this with the channel';
$('forward-targets').querySelector('[data-fwd-send="ch:pcs01:general"]').click();
check('v4.77: forwarding a message marks Sent and unlocks passiton egg',
  !!(await until(() => $('forward-targets').querySelector('[data-fwd-send="ch:pcs01:general"]')?.textContent === 'Sent' && eggFoundSet.has('passiton'), 6000)));
closeModal('forward-modal');

// Open #general and verify the forwarded quote card renders with optional comment
await selectServer(window.__myServers.find(s => s.id === 'pcs01'));
await until(() => currentServerId === 'pcs01' && lastChannelsList.some(c => c.id === 'general'), 6000);
selectChannel(lastChannelsList.find(c => c.id === 'general'));
check('v4.77: forwarded message renders crisp .msg-forwarded card with comment in destination channel',
  !!(await until(() => {
    const card = document.querySelector('.msg-forwarded');
    return card && card.textContent.includes('Remember this secret plan for Friday') && document.body.textContent.includes('Sharing this with the channel');
  }, 6000)));

// ---------- 5. Server AutoMod (#3a) ----------
// 5a. Owner configures AutoMod via Server Settings > AutoMod tab
openServerSettings('automod');
await wait(120);
check('v4.77: Owner sees AutoMod tab in Server Settings',
  !$('ss-tab-automod').classList.contains('hidden') && !$('ss-pane-automod').classList.contains('hidden'));
$('am-enabled').checked = true;
$('am-words').value = 'forbiddenword, free nitro';
$('am-links').checked = true;
$('am-spam').checked = true;
$('am-action').value = 'block';
$('am-save-btn').click();
check('v4.77: AutoMod settings save to servers/pcs01.automod',
  !!(await until(async () => {
    const s = await doc('servers/pcs01');
    return s && s.automod && s.automod.enabled === true && s.automod.blockLinks === true && s.automod.antiSpam === true && s.automod.words.includes('forbiddenword');
  }, 6000)));
closeModal('server-settings-modal');

// 5b. Owner bypasses AutoMod even with blocked word & external link
$('composer-input').value = 'Owner bypass check forbiddenword https://example.com';
await sendMessage();
check('v4.77: Server Owner bypasses AutoMod rules',
  !!(await until(() => lastRawMessages.some(m => m.text && m.text.includes('Owner bypass check')), 5000)));

// 5c. Switch to regular member Sumi -> AutoMod blocks banned word, external link (while allowing Frixion link), and duplicate spam + cooldown!
await patch('users/Sumi', { coowner: false, admin: false, owner: false });
check('Sumi (regular member) logs in', await T.login('Sumi'));
await until(() => Array.isArray(window.__myServers) && window.__myServers.some(s => s.id === 'pcs01'), 6000);
hideModals();
try { localStorage.removeItem('frixion_am_cd:pcs01:Sumi'); } catch (e) {}
automodRecent.delete('pcs01');
await selectServer(window.__myServers.find(s => s.id === 'pcs01'));
await until(() => currentServerId === 'pcs01' && lastChannelsList.some(c => c.id === 'general'), 6000);
selectChannel(lastChannelsList.find(c => c.id === 'general'));
await until(() => currentView === 'channel' && currentChannelId === 'general', 5000);

// Blocked word
const beforeCount = lastRawMessages.length;
$('composer-input').value = 'Hey try this forbiddenword now';
await sendMessage();
await wait(250);
check('v4.77: AutoMod blocks message containing restricted word for regular member',
  lastRawMessages.length === beforeCount && ephemeralMsgs.some(e => /AutoMod/i.test(e.text)));

// External link blocked
$('composer-input').value = 'Check out https://evil-spam-site.example/deal';
await sendMessage();
await wait(250);
check('v4.77: AutoMod blocks external link for regular member',
  !lastRawMessages.some(m => m.text && m.text.includes('evil-spam-site.example')));

// Frixion link allowed!
$('composer-input').value = 'Join us at https://frixionbeta.pages.dev/#invite=abc';
await sendMessage();
check('v4.77: AutoMod allows Frixion own links',
  !!(await until(() => lastRawMessages.some(m => m.text && m.text.includes('frixionbeta.pages.dev')), 5000)));

// Duplicate spam blocked on 3rd identical send
$('composer-input').value = 'dupmsg one';
await sendMessage();
await until(() => lastRawMessages.filter(m => m.text === 'dupmsg one').length === 1, 5000);
$('composer-input').value = 'dupmsg one';
await sendMessage();
await until(() => lastRawMessages.filter(m => m.text === 'dupmsg one').length === 2, 5000);
$('composer-input').value = 'dupmsg one';
await sendMessage();
await wait(250);
check('v4.77: AutoMod anti-spam blocks 3rd repeated duplicate message',
  lastRawMessages.filter(m => m.text === 'dupmsg one').length === 2);

// Cooldown action puts user on 5-minute local cooldown
await patch('servers/pcs01', { automod: { enabled: true, words: ['forbiddenword'], blockLinks: false, antiSpam: false, action: 'cooldown' } });
await until(() => currentServerData && currentServerData.automod && currentServerData.automod.action === 'cooldown', 5000);
$('composer-input').value = 'forbiddenword triggers cooldown';
await sendMessage();
await wait(150);
check('v4.77: AutoMod cooldown action sets a 5-minute cooldown and blocks subsequent clean messages',
  automodCooldownUntil('pcs01') > Date.now() && checkServerAutoMod(currentServerData, 'clean message').blocked === true);
try { localStorage.removeItem('frixion_am_cd:pcs01:Sumi'); } catch (e) {}

// ---------- 6. 100th Easter Egg Milestone word trigger ("century") ----------
const box = $('composer-input');
box.focus();
box.value = 'century';
box.dispatchEvent(new Event('input', { bubbles: true }));
check('v4.77: typing "century" unlocks Century Club (#100) milestone egg',
  !!(await until(() => eggFoundSet.has('centurion'), 6000)));
box.value = '';

return T.report();
