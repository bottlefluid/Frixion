// Back as Tester: give Sumi the role, pin Sumi's message, mention Sumi, the typing note, and /purge.
const { check, until, sql, doc } = T;
check('Tester logs in', await T.login('Tester'));
const srv = await until(() => (window.__myServers || []).find(s => s.inviteCode === 'ptest'));
if (!srv) { check('the test server', false); return T.report(); }
selectServer(srv);
await until(() => currentServerData && (currentServerData.members || []).includes('Sumi') && currentChannelId && lastRawMessages.length);
const role = serverRoles(currentServerData).find(r => r.name === 'new role');
check('the new role is there', !!role);
if (role) {
  await setMemberRole('Sumi', role.id, true);
  check('the role given to Sumi', !!(await until(async () => (((await doc('servers/' + srv.id)).memberRoles || {}).Sumi || []).includes(role.id))));
}
const m = lastRawMessages.find(x => x.text === 'thread starter');
const wasPinned = !!m.pinned;
await togglePin(m.id);
check('pin a message (or unpin it)', !!(await until(async () => !!(await doc(`servers/${srv.id}/channels/${currentChannelId}/messages/${m.id}`)).pinned === !wasPinned)));
$('composer-input').value = 'hey @Sumi look';
await sendMessage();
check('a mention reaches Sumi\'s list', !!(await until(async () => (await sql("select 1 from public.user_mentions where user_id = 'Sumi' and data->>'from' is not null or user_id = 'Sumi'")).length)));
$('composer-input').value = 'typing...';
noteComposerTyping();
check('the typing note is written', !!(await until(async () => (await sql('select 1 from public.channel_typing where server_id = $1 and id = $2', [srv.id, 'Tester'])).length)));
$('composer-input').value = '';
noteComposerTyping();
check('...and taken away', !!(await until(async () => !(await sql('select 1 from public.channel_typing where server_id = $1 and id = $2', [srv.id, 'Tester'])).length)));
for (const t of ['one', 'two', 'three']) { $('composer-input').value = 'purge me ' + t; await sendMessage(); }
await until(() => lastRawMessages.some(x => x.text === 'purge me three'));
const texts = async () => (await sql("select data->>'text' t, data->'purgeResult' p from public.channel_messages where server_id = $1 and channel_id = $2", [srv.id, currentChannelId]));
await runPurgeCommand('2');
check('/purge 2 deletes the last two', !!(await until(async () => { const t = (await texts()).map(r => r.t); return !t.includes('purge me three') && !t.includes('purge me two') && t.includes('purge me one'); }, 8000)), await texts());
check('...then posts the command and Sapphire\'s result', !!(await until(async () => { const r = await texts(); return r.some(x => x.t === '/purge 2') && r.some(x => x.p && x.p.count === 2); })), await texts());
check('...they leave the screen too', !!(await until(() => !lastRawMessages.some(x => x.text === 'purge me three' || x.text === 'purge me two'))));
return T.report();
