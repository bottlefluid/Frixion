// v4.75 in the page: peer-to-peer WebRTC Screenshare (silent video) in DMs, group chats and server channels,
// sharer-side membership enforcement (rejects outsiders), real 2-peer Offer/Answer/ICE video delivery,
// away-sharing Return/Stop bar, preview hide/show, mobile watch-only fallback, and 3 new eggs (96 total).
const { check, until, wait } = T;
const hideModals = () => document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));

// Helper: animated canvas MediaStream so real WebRTC encodes & decodes live frames cleanly in headless Edge
function makeFakeScreenStream(label, color) {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 360;
  const ctx = c.getContext('2d');
  let n = 0;
  const draw = () => {
    n++;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = color || '#22c55e';
    ctx.fillRect(40 + ((n * 6) % 240), 70, 220, 120);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(label || 'FRIXION LIVE', 48, 250);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px monospace';
    ctx.fillText('FRAME #' + n, 48, 290);
  };
  draw();
  const timer = setInterval(draw, 80);
  const stream = c.captureStream(15);
  const origStop = stream.getVideoTracks()[0].stop.bind(stream.getVideoTracks()[0]);
  stream.getVideoTracks()[0].stop = () => { clearInterval(timer); origStop(); };
  return { stream, stop: () => { clearInterval(timer); stream.getTracks().forEach(t => t.stop()); } };
}

check('Tester (Owner) logs in', await T.login('Tester'));
await until(async () => Array.isArray((await doc('users/Tester')).ownedThemes), 6000);
hideModals();

check('v4.75: UPDATES top entry is 4.75 and EGGS has 96 entries',
  UPDATES[0].v === '4.75' && EGGS.length === 96 && !!EGG_BY_ID.watchparty && !!EGG_BY_ID.screensaver && !!EGG_BY_ID.golive,
  { v: UPDATES[0].v, count: EGGS.length });

// Header button must be hidden on non-chat views (Friends)
openHomeMainView('friends');
await wait(120);
check('v4.75: Share Screen button is hidden on Friends view', $('screenshare-toggle').classList.contains('hidden'));

// Stub getDisplayMedia so we test 100% of the real production code path with a real canvas video stream
const origGetDisplay = navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia
  ? navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices) : null;
let lastConstraints = null;
let nextFake = null;
if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
navigator.mediaDevices.getDisplayMedia = async (opts) => {
  lastConstraints = opts;
  nextFake = makeFakeScreenStream('TESTER SCREEN', '#38bdf8');
  return nextFake.stream;
};

// ---------- 1. Host flow in DM + Unauthorized rejection + Authorized 2-peer WebRTC ----------
await until(() => Array.isArray(window.__myDMs) && window.__myDMs.some(d => d.id === 'Sumi_Tester'), 6000);
await selectDM('Sumi_Tester', 'Sumi');
await until(() => ssViewRoom === 'dm:Sumi_Tester' && ssChannels.get('dm:Sumi_Tester')?.joined, 6000);
check('v4.75: Share Screen button is visible in DM header', !$('screenshare-toggle').classList.contains('hidden'));

// Start sharing via the real header button
$('screenshare-toggle').click();
check('v4.75: clicking Share Screen captures silent video (audio: false) and shows local preview',
  !!(await until(() => !!ssLocalStream && !$('screen-stage').classList.contains('hidden'), 5000))
  && lastConstraints && lastConstraints.audio === false
  && $('screenshare-toggle').classList.contains('ss-live')
  && $('screen-video').muted === true,
  { lastConstraints, liveClass: $('screenshare-toggle').classList.contains('ss-live') });

check('v4.75: starting a screenshare unlocks the Front Row (watchparty) egg',
  !!(await until(() => eggFoundSet.has('watchparty'), 5000)));

// Connect a second real Supabase Realtime client as remote peer (testing both Nova=outsider & Sumi=participant)
const remoteSb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const dmChan = remoteSb.channel('screen:dm:Sumi_Tester', { config: { broadcast: { self: false }, presence: { key: 'Sumi' } } });
const offersForNova = [];
let sumiGotTrack = false, sumiConnected = false, sumiGotShareStop = false;
const sumiPc = new RTCPeerConnection({ iceServers: [] });
const sumiPendingIce = [];
sumiPc.ontrack = ev => { if (ev.track && ev.track.kind === 'video') sumiGotTrack = true; };
sumiPc.onconnectionstatechange = () => { if (sumiPc.connectionState === 'connected') sumiConnected = true; };
sumiPc.onicecandidate = ev => {
  if (ev.candidate) dmChan.send({ type: 'broadcast', event: 'ice', payload: { to: 'Tester', from: 'Sumi', dir: 'v2h', sessionId: 'sumi-s1', candidate: ev.candidate } });
};

dmChan.on('broadcast', { event: 'offer' }, async ({ payload }) => {
  if (payload.to === 'Nova') { offersForNova.push(payload); return; }
  if (payload.to !== 'Sumi' || payload.sessionId !== 'sumi-s1') return;
  await sumiPc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
  for (const c of sumiPendingIce.splice(0)) { try { await sumiPc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {} }
  const ans = await sumiPc.createAnswer();
  await sumiPc.setLocalDescription(ans);
  dmChan.send({ type: 'broadcast', event: 'answer', payload: { to: 'Tester', from: 'Sumi', sessionId: 'sumi-s1', sdp: sumiPc.localDescription } });
});
dmChan.on('broadcast', { event: 'ice' }, async ({ payload }) => {
  if (payload.to !== 'Sumi' || payload.dir !== 'h2v' || payload.sessionId !== 'sumi-s1') return;
  if (sumiPc.remoteDescription) { try { await sumiPc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch (e) {} }
  else sumiPendingIce.push(payload.candidate);
});
dmChan.on('broadcast', { event: 'share-stop' }, ({ payload }) => {
  if (payload && payload.from === 'Tester') sumiGotShareStop = true;
});

let dmJoined = false;
dmChan.subscribe(st => { if (st === 'SUBSCRIBED') dmJoined = true; });
await until(() => dmJoined, 5000);
await until(() => {
  const st = dmChan.presenceState();
  return st && st.Tester && st.Tester.some(m => m.sharing === true);
}, 5000);
check('v4.75: remote peer sees Tester live in Realtime Presence',
  !!(dmChan.presenceState().Tester && dmChan.presenceState().Tester.some(m => m.sharing === true)));

// Security: outsider Nova is NOT in DM Sumi_Tester -> sharer must silently reject watch-req!
dmChan.send({ type: 'broadcast', event: 'watch-req', payload: { to: 'Tester', from: 'Nova', sessionId: 'evil-1' } });
await wait(450);
check('v4.75: sharer rejects unauthorized outsider (Nova) from watching a DM screenshare',
  offersForNova.length === 0 && !ssHostPeers.has('Nova'), { offersForNova: offersForNova.length, hasPeer: ssHostPeers.has('Nova') });

// Authorized participant Sumi requests stream -> real WebRTC Offer/Answer/ICE + live video track!
dmChan.send({ type: 'broadcast', event: 'watch-req', payload: { to: 'Tester', from: 'Sumi', sessionId: 'sumi-s1' } });
check('v4.75: authorized DM peer (Sumi) completes real WebRTC handshake and receives live video track',
  !!(await until(() => sumiGotTrack && sumiConnected, 8000)),
  { sumiGotTrack, sumiConnected, pcState: sumiPc.connectionState });

check('v4.75: sharer stage displays live viewer count ("1 watching")',
  !!(await until(() => /1 watching/.test($('ss-meta').textContent), 5000)),
  { meta: $('ss-meta').textContent });

// Away-sharing bar when navigating to Friends, and Return jumps back to DM
openHomeMainView('friends');
await wait(150);
check('v4.75: navigating away while sharing shows the green away-sharing bar with Return & Stop',
  !$('screen-away-bar').classList.contains('hidden') && /Sumi/.test($('ss-away-text').textContent) && !!ssLocalStream,
  { text: $('ss-away-text').textContent });

$('ss-away-return').click();
check('v4.75: clicking Return on the away-sharing bar brings you back to the live DM',
  !!(await until(() => currentView === 'dm' && currentDMId === 'Sumi_Tester' && $('screen-away-bar').classList.contains('hidden'), 5000)));

// Hide Preview / Show Preview toggle
$('ss-hide-preview-btn').click();
await wait(80);
check('v4.75: Hide Preview collapses the stage and shows the in-room banner with Show Preview',
  $('screen-stage').classList.contains('hidden') && !$('screen-banner').classList.contains('hidden') && /Show Preview/.test($('screen-banner').textContent));
$('screen-banner').querySelector('[data-ss-act="show-preview"]').click();
await wait(80);
check('v4.75: Show Preview restores the local preview stage', !$('screen-stage').classList.contains('hidden'));

// Stop Sharing cleans up everything and notifies viewers
$('ss-stop-btn').click();
check('v4.75: Stop Sharing closes peers, ends media tracks, hides stage and notifies Sumi',
  !!(await until(() => sumiGotShareStop && !ssLocalStream && ssHostPeers.size === 0 && $('screen-stage').classList.contains('hidden'), 5000))
  && nextFake.stream.getVideoTracks()[0].readyState === 'ended');

sumiPc.close();
remoteSb.removeChannel(dmChan);

// ---------- 2. Viewer flow in a Server Channel (Sumi shares -> Tester watches!) ----------
const srvRow = await until(() => document.querySelector('#server-rail-list .rail-item'), 5000);
srvRow.click();
await until(() => currentView === 'channel' && currentServerId === 'pcs01' && !!currentChannelId && ssChannels.get(ssViewRoom)?.joined, 6000);
const chRoom = ssViewRoom;
check('v4.75: Share Screen button is visible in server channel header',
  chRoom.startsWith('ch:pcs01:') && !$('screenshare-toggle').classList.contains('hidden'), { chRoom });

// Remote host Sumi goes live in this channel
const sumiFake = makeFakeScreenStream('SUMI CHANNEL STREAM', '#a855f7');
const hostChan = remoteSb.channel('screen:' + chRoom, { config: { broadcast: { self: false }, presence: { key: 'Sumi' } } });
const hostPcs = new Map();
hostChan.on('broadcast', { event: 'watch-req' }, async ({ payload }) => {
  if (payload.to !== 'Sumi') return;
  const pc = new RTCPeerConnection({ iceServers: [] });
  hostPcs.set(payload.from, { pc, sessionId: payload.sessionId, pending: [] });
  pc.addTrack(sumiFake.stream.getVideoTracks()[0], sumiFake.stream);
  pc.onicecandidate = ev => {
    if (ev.candidate) hostChan.send({ type: 'broadcast', event: 'ice', payload: { to: payload.from, from: 'Sumi', dir: 'h2v', sessionId: payload.sessionId, candidate: ev.candidate } });
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  hostChan.send({ type: 'broadcast', event: 'offer', payload: { to: payload.from, from: 'Sumi', sessionId: payload.sessionId, sdp: pc.localDescription } });
});
hostChan.on('broadcast', { event: 'answer' }, async ({ payload }) => {
  const h = hostPcs.get(payload.from);
  if (!h || h.sessionId !== payload.sessionId) return;
  await h.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
  for (const c of h.pending.splice(0)) { try { await h.pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {} }
});
hostChan.on('broadcast', { event: 'ice' }, async ({ payload }) => {
  const h = hostPcs.get(payload.from);
  if (!h || payload.dir !== 'v2h' || h.sessionId !== payload.sessionId) return;
  if (h.pc.remoteDescription) { try { await h.pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch (e) {} }
  else h.pending.push(payload.candidate);
});

let hostJoined = false;
hostChan.subscribe(async st => {
  if (st === 'SUBSCRIBED') {
    hostJoined = true;
    await hostChan.track({ sharing: true, uid: 'Sumi', name: 'Sumi', since: Date.now(), viewers: 0 });
  }
});
await until(() => hostJoined, 5000);

// Tester sees live banner and clicks Watch
check('v4.75: server channel shows live "Sumi is sharing their screen" banner with Watch button',
  !!(await until(() => !$('screen-banner').classList.contains('hidden') && !!$('screen-banner').querySelector('[data-ss-watch="Sumi"]'), 5000)));

$('screen-banner').querySelector('[data-ss-watch="Sumi"]').click();
check('v4.75: clicking Watch receives real decoded video frames in #screen-video (LIVE, muted, playsinline)',
  !!(await until(() => ssWatchState === 'live' && $('screen-video').videoWidth > 0 && $('screen-video').videoHeight > 0, 8000))
  && $('ss-status-text').textContent === 'LIVE'
  && $('screen-video').muted === true
  && $('screen-video').playsInline === true,
  { state: ssWatchState, w: $('screen-video').videoWidth, h: $('screen-video').videoHeight });

// Expand / Compact button works
$('ss-size-btn').click();
check('v4.75: Expand button toggles expanded stage height', $('screen-stage').classList.contains('expanded'));
$('ss-size-btn').click();

// Simulate phone without getDisplayMedia: Share button hides, while watching continues uninterrupted!
const savedGdm = navigator.mediaDevices.getDisplayMedia;
navigator.mediaDevices.getDisplayMedia = undefined;
ssUpdateHeaderBtn();
check('v4.75: on devices without getDisplayMedia (phones), Share button hides while watching still works',
  $('screenshare-toggle').classList.contains('hidden') && !$('screen-stage').classList.contains('hidden') && ssWatchState === 'live');
navigator.mediaDevices.getDisplayMedia = savedGdm;
ssUpdateHeaderBtn();

// Remote host stops sharing -> viewer stage closes automatically
hostChan.send({ type: 'broadcast', event: 'share-stop', payload: { from: 'Sumi' } });
await hostChan.untrack();
check('v4.75: when sharer stops, viewer stage closes cleanly and peer connection is released',
  !!(await until(() => ssWatchState === 'idle' && !ssWatchPc && $('screen-stage').classList.contains('hidden'), 5000)));

for (const h of hostPcs.values()) h.pc.close();
sumiFake.stop();
remoteSb.removeChannel(hostChan);

// ---------- 3. Group DM room key & header button ----------
if (Array.isArray(window.__myGroupDMs) && window.__myGroupDMs.length) {
  await selectGroupDM(window.__myGroupDMs[0].id);
  await wait(150);
  check('v4.75: Group DM shows Share Screen button and joins gdm: room',
    ssViewRoom === 'gdm:' + window.__myGroupDMs[0].id && !$('screenshare-toggle').classList.contains('hidden'));
}

// ---------- 4. Word easter eggs ("screenshare" & "golive") ----------
const box = $('composer-input');
box.focus();
for (const [word, id] of [['screenshare', 'screensaver'], ['golive', 'golive']]) {
  box.value = word;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  check(`v4.75: typing "${word}" unlocks ${id}`, !!(await until(() => eggFoundSet.has(id), 5000)));
}
box.value = '';

// Restore original getDisplayMedia
if (origGetDisplay) navigator.mediaDevices.getDisplayMedia = origGetDisplay;
else delete navigator.mediaDevices.getDisplayMedia;

return T.report();
