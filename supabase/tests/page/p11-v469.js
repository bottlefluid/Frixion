// v4.69 in the page (after p1 to p10, on fresh seed data): the permission lists, private and locked threads with Thread
// Settings, voice messages (sent with a stand-in upload: there's no microphone here), webhooks, events (request 50), and
// Grow a Garden's backpack and a trade from Tester to Sumi, accepted by her and collected by him (request 65).
const { check, until, doc, sql, put, wait } = T;
const hideModals = () => document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
const openPcs = async () => {
  const srv = await until(() => (window.__myServers || []).find(s => s.id === 'pcs01'), 8000);
  selectServer(srv);
  await until(() => currentServerId === 'pcs01' && currentServerData && lastChannelsList.length, 8000);
  selectChannel(lastChannelsList.find(c => c.name === 'general'));
  await until(() => currentView === 'channel' && lastRawMessages.some(m => m.id === 's1'), 8000);
};
check('Tester logs in', await T.login('Tester'));
hideModals();

// ---------- 50: the permission lists ----------
const groups = SERVER_PERMISSION_GROUPS.filter(g => shownPermissions(g.key).length).map(g => g.key);
check('50: no voice or Stage permissions in the editors, and nothing "Coming soon"', !groups.includes('voice') && !groups.includes('stage')
  && !shownPermissions().some(p => HIDDEN_PERMISSIONS.has(p.key)) && typeof UNUSED_PERMISSIONS === 'undefined', groups);
check('50: ...while threads, voice messages, webhooks and events are in', ['createPrivateThreads', 'manageThreads', 'sendVoiceMessages', 'manageWebhooks', 'createEvents', 'manageEvents']
  .every(k => shownPermissions().some(p => p.key === k)));

// ---------- 50: private threads and Thread Settings ----------
await openPcs();
openCreateThread('s1');
check('50: Create Thread offers Private', !$('thread-private-row').classList.contains('hidden'));
$('thread-name').value = 'secret plans'; $('thread-private').checked = true;
await createThreadFromModal();
const thr = await until(async () => (await sql("select id, data from public.threads where server_id = 'pcs01' and data->>'name' = 'secret plans'"))[0], 8000);
check('50: a private thread, with just Tester in it', !!thr && thr.data.private === true && JSON.stringify(thr.data.members) === '["Tester"]', thr);
check('50: ...and nothing on the message it started from', !(await doc('servers/pcs01/channels/general/messages/s1')).thread);
await until(() => currentThreadId === (thr && thr.id), 6000);
check('50: the thread menu shows in a thread', !$('thread-menu-btn').classList.contains('hidden'));
openThreadSettings();
check('50: Thread Settings shows its people, and Tester (the server\'s owner) can lock it', !$('ts-members-wrap').classList.contains('hidden') && !$('ts-lock').classList.contains('hidden'));
$('ts-add').value = 'Air';
$('ts-add-btn').click();
check('50: adding Air', !!(await until(async () => ((await doc('servers/pcs01/threads/' + thr.id)).members || []).includes('Air'), 8000)));
closeModal('thread-settings-modal');
$('composer-input').value = 'hey @Sumi, look';
$('composer-input').dispatchEvent(new Event('input'));
await sendMessage();
check('50: mentioning Sumi in a private thread adds her', !!(await until(async () => ((await doc('servers/pcs01/threads/' + thr.id)).members || []).includes('Sumi'), 8000)));
await wait(500);
openThreadSettings();
$('ts-lock').click();
check('50: locking it', !!(await until(async () => (await doc('servers/pcs01/threads/' + thr.id)).locked === true, 8000)));
closeModal('thread-settings-modal');
await put('servers/pcs01/threads/justme', { channelId: 'general', name: 'just me', createdBy: 'Tester', private: true, members: ['Tester'], createdAt: { $t: Date.now() }, lastMessageAt: { $t: Date.now() }, messageCount: 0 });

// ---------- 50: voice messages ----------
goToThreadParent();
await until(() => !currentThreadId && currentView === 'channel');
check('50: the microphone shows where voice messages are allowed', !$('voice-btn').classList.contains('hidden') || !voiceMessagesOk());
const realUpload = uploadFileGeneric;
uploadFileGeneric = async () => 'https://example.com/voice-test.webm';   // (no Cloudinary from a test)
await sendVoiceMessage(new Blob(['x'], { type: 'audio/webm' }), 4200, 'audio/webm');
uploadFileGeneric = realUpload;
const vm = await until(() => lastRawMessages.find(m => m.attachments && m.attachments[0] && m.attachments[0].voice), 8000);
check('50: a voice message goes out with how long it is', !!vm && vm.attachments[0].duration === 4.2 && vm.attachments[0].url === 'https://example.com/voice-test.webm', vm);
check('50: ...shows as a player, and as "Sent a voice message" in lists', !!(await until(() => document.querySelector('#messages .voice-msg'), 6000))
  && previewForMessage(vm) === 'Sent a voice message' && /0:04/.test(document.querySelector('#messages .voice-msg').textContent));

// ---------- 50: webhooks ----------
openServerSettings('webhooks');
check('50: Server Settings has Integrations for Tester', !$('ss-tab-webhooks').classList.contains('hidden') && !$('ss-pane-webhooks').classList.contains('hidden'));
$('wh-name').value = 'Builds';
await until(() => $('wh-channel').options.length, 4000);
$('wh-channel').value = lastChannelsList.find(c => c.name === 'general').id;
await $('wh-create').onclick();
const url = await until(() => !$('wh-made').classList.contains('hidden') && $('wh-url').value, 6000);
check('50: a new webhook shows its link (once)', /\/api\/webhooks\/pcs01\/[A-Za-z0-9_-]+\/[0-9a-f]{64}$/.test(url || ''), url);
check('50: ...and only a hash of its secret is kept', !!(await until(async () => { const r = await sql("select data from public.server_webhooks where server_id = 'pcs01'"); return r[0] && /^[0-9a-f]{64}$/.test(r[0].data.tokenHash) && !JSON.stringify(r[0].data).includes(url.split('/').pop()); })));
const posted = await (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Build 7 passed' }) })).json();
check('50: posting to the link works', posted.ok === true, posted);
closeModal('server-settings-modal');
check('50: the post shows in #general under the webhook\'s name, with an APP tag', !!(await until(() => /Build 7 passed/.test($('messages').textContent) && /Builds/.test($('messages').textContent) && /APP/.test($('messages').textContent), 8000)));

// ---------- 50: events ----------
openEvents();
check('50: Events opens, with Create Event for Tester', !$('ev-new-btn').parentElement.classList.contains('hidden'));
$('ev-new-btn').click();
$('ev-name').value = 'Game night'; $('ev-desc').value = 'Bring snacks';
const at = new Date(); at.setDate(at.getDate() + 1); at.setHours(0, 0, 0, 0);
$('ev-start').value = toLocalInput(at.getTime());
$('ev-channel').value = lastChannelsList.find(c => c.name === 'general').id;
await $('ev-save').onclick();
const ev = await until(async () => (await sql("select id, data from public.server_events where server_id = 'pcs01'"))[0], 8000);
check('50: the event is saved, with Tester interested', !!ev && ev.data.name === 'Game night' && ev.data.startAt === at.getTime() && JSON.stringify(ev.data.interested) === '["Tester"]', ev);
check('egg: Midnight Meetup', !!(await until(() => eggFoundSet.has('midnightevent'))));
check('50: the channel list counts it', !!(await until(() => $('server-events-count').textContent === '1' && !$('server-events-count').classList.contains('hidden'), 6000)));
await until(() => document.querySelector('#events-list .ev-card [data-ev-int]'), 6000);
document.querySelector('#events-list [data-ev-int]').click();
check('50: Tester takes back "interested"', !!(await until(async () => !((await doc('servers/pcs01/events/' + ev.id)).interested || []).includes('Tester'), 6000)));
closeModal('events-modal');

// ---------- 65: the backpack ----------
UC.ggSheckles = 100000;
UC.ggPlots[0] = null;
openGame('growgarden');
await until(() => $('gg-plots'), 6000);
ggBuyToBackpack('seeds', 'carrot'); ggBuyToBackpack('seeds', 'carrot');
check('65: Buy puts seeds in the backpack, and pays for them', ggBpCount('seeds', 'carrot') === 2 && UC.ggSheckles < 100000);
check('65: ...saved with the garden (tb.ggBackpack)', !!(await until(async () => (((await doc('users/Tester')).tb || {}).ggBackpack || { seeds: {} }).seeds.carrot === 2, 8000)));
const sh = UC.ggSheckles;
ggSel = 'carrot';
await ggPlant(0);
check('65: planting uses the backpack first (no Sheckles spent)', ggBpCount('seeds', 'carrot') === 1 && UC.ggSheckles === sh && UC.ggPlots[0] && UC.ggPlots[0].seed === 'carrot');

// ---------- 65: a trade ----------
await ggOpenTrade('Sumi');
check('65: the trade window lists Tester\'s backpack', !!document.querySelector('#gg-trade-give [data-id="carrot"]'));
document.querySelector('#gg-trade-give [data-id="carrot"]').value = '1';
await $('gg-trade-send').onclick();
const tr = await until(async () => (await sql("select id, data from public.garden_trades where data->>'from' = 'Tester'"))[0], 8000);
check('65: the offer is made, and the carrot waits in it', !!tr && tr.data.status === 'open' && tr.data.give.seeds.carrot === 1 && ggBpCount('seeds', 'carrot') === 0, tr);
closeGame();
check('Sumi logs in', await T.login('Sumi'));
hideModals();
check('65: Sumi is told about the offer', !!(await until(() => { try { return Number(localStorage.getItem('frixion_trade_seen_Sumi')) > 0; } catch (e) { return false; } }, 6000)));
openGame('growgarden');
await until(() => $('gg-shopbody'), 6000);
ggSetShopTab('trades');
await until(() => document.querySelector('#gg-shopbody [data-tr-do="accept"]'), 8000);
document.querySelector('#gg-shopbody [data-tr-do="accept"]').click();
check('65: Sumi accepts, and the carrot is in her backpack', !!(await until(() => ggBpCount('seeds', 'carrot') === 1, 8000)) && (await doc('gardenTrades/' + tr.id)).status === 'accepted');
check('egg: Fair Trade', !!(await until(() => eggFoundSet.has('firsttrade'))));
closeGame();
// (Sumi is a Co-Owner since p8, and Frixion's staff see every private thread, so this is Air, a plain member)
check('Air logs in', await T.login('Air'));
hideModals();
await openPcs();
const airSees = await until(() => (lastThreadsList.length ? lastThreadsList.map(t => t.name) : null), 8000);
check('50: Air (added to it) sees the private thread', !!airSees && airSees.includes('secret plans'), airSees);
check('50: ...but not the one he isn\'t in', !!airSees && !airSees.includes('just me'), airSees);
check('Tester logs in again', await T.login('Tester'));
hideModals();
check('65: Tester\'s app collects his side once he\'s back', !!(await until(async () => (await doc('gardenTrades/' + tr.id)).fromDone === true, 10000)));
return T.report();
