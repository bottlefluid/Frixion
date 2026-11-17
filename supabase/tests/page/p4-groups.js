// As Tester: a group chat with Sumi and Air (through its form), a message in it, blocking Air, banning Sumi from the
// test server.
const { check, until, sql, doc } = T;
check('Tester logs in', await T.login('Tester'));
await until(() => (myProfile.friends || []).includes('Sumi') && (myProfile.friends || []).includes('Air'));
$('new-group-dm-btn').onclick();
for (const n of ['Sumi', 'Air']) { const box = $('group-dm-friend-picker').querySelector(`input[value="${n}"]`); if (box) box.checked = true; }
$('new-group-dm-name').value = 'Trio';
await $('confirm-new-group-dm').onclick();
const g = await until(() => (window.__myGroupDMs || []).find(x => x.name === 'Trio'));
check('a group chat through its form', !!g && ['Tester', 'Sumi', 'Air'].every(u => g.participants.includes(u)), window.__myGroupDMs);
if (g) {
  check('...with its "added" line', !!(await until(async () => (await sql("select 1 from public.group_messages where conv_id = $1 and data->>'system' = 'add'", [g.id])).length)));
  await until(() => currentView === 'groupdm');
  $('composer-input').value = 'hello trio';
  await sendMessage();
  check('a message in the group', !!(await until(async () => (await sql("select 1 from public.group_messages where conv_id = $1 and data->>'text' = 'hello trio'", [g.id])).length)));
}
await setBlocked('Air', true);
const blocks = await until(async () => { const b = await doc('users/Tester/meta/blocks'); return b && (b.list || []).includes('Air') ? b : null; });
check('block Air: on my block list', !!blocks);
check('block Air: no longer friends, both sides', !(await doc('users/Tester')).friends.includes('Air') && !(await doc('users/Air')).friends.includes('Tester'));
check('block Air: our DM says so', ((await doc('dms/Air_Tester')).blockedBy || []).includes('Tester'));
const srv = (window.__myServers || []).find(s => s.inviteCode === 'ptest');
if (srv) {
  selectServer(srv);
  await until(() => currentServerData && currentServerData.members.includes('Sumi'));
  openManageMemberModal('Sumi', currentServerData);
  $('mm-ban-btn').onclick();
  await T.confirm();
  const s = await until(async () => { const d = await doc('servers/' + srv.id); return d && !d.members.includes('Sumi') && (d.bannedUsers || []).includes('Sumi') ? d : null; });
  check('ban Sumi from the server', !!s);
  check('...with who and when', !!s && s.banInfo && s.banInfo.Sumi && s.banInfo.Sumi.by === 'Tester');
}
return T.report();
