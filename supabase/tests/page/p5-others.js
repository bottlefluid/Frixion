// As Air (blocked by Tester): can't DM Tester any more, but can write in the group. As Sumi (banned from the test
// server): can't rejoin it, and leaves the group.
const { check, until, sql } = T;
check('Air logs in', await T.login('Air'));
const n0 = (await sql("select count(*)::int n from public.dm_messages where conv_id = 'Air_Tester'"))[0].n;
await startDMWith('Tester');
await until(() => currentView === 'dm');
$('composer-input').value = 'are you there?';
await sendMessage().catch(() => {});
await T.wait(1500);
check('blocked: Air\'s DM to Tester is refused', (await sql("select count(*)::int n from public.dm_messages where conv_id = 'Air_Tester'"))[0].n === n0);
T.errorToasts.splice(0); T.uncaught.splice(0);   // (that refusal is expected)
const g = await until(() => (window.__myGroupDMs || []).find(x => x.name === 'Trio'));
check('Air sees the group', !!g);
if (g) {
  await selectGroupDM(g.id);
  await until(() => currentView === 'groupdm' && lastRawMessages.some(m => m.text === 'hello trio'));
  check('...and its messages', lastRawMessages.some(m => m.text === 'hello trio'));
  $('composer-input').value = 'air in the group';
  await sendMessage();
  check('Air writes in the group (blocks are for DMs)', !!(await until(async () => (await sql("select 1 from public.group_messages where conv_id = $1 and data->>'text' = 'air in the group'", [g.id])).length)));
}
check('Sumi logs in', await T.login('Sumi'));
openModal('join-server-modal');
$('join-server-code').value = 'ptest';
await $('confirm-join-server').onclick();
check('banned: Sumi can\'t rejoin', /banned/i.test($('join-server-error').textContent), $('join-server-error').textContent);
closeModal('join-server-modal');
const g2 = await until(() => (window.__myGroupDMs || []).find(x => x.name === 'Trio'));
if (g2) {
  await selectGroupDM(g2.id);
  await until(() => currentView === 'groupdm');
  $('leave-group-toggle').onclick();
  await T.confirm();
  check('Sumi leaves the group', !!(await until(async () => !(await sql("select data->'participants' p from public.group_dms where id = $1", [g2.id]))[0].p.includes('Sumi'))));
}
return T.report();
