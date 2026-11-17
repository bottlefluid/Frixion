// The Owner panel, as Tester: the user list, ban/unban, mute, Orbs, Make Admin, purge perms, a code, the word filter,
// and the Devices, IP, Conversations, Codes, Ranks and Supabase tabs drawing without errors.
const { check, until, doc, sql } = T;
check('Tester logs in', await T.login('Tester'));
openAdminPanel();
await until(() => !$('admin-panel-modal').classList.contains('hidden'));
await renderAdminList();
const listText = () => ($(activeAdminListEl()) || {}).innerText || '';
check('System Hub lists the accounts', !!(await until(() => /Nova/.test(listText()) && /Sumi/.test(listText()))), listText().slice(0, 200));
adminSelectedUser = 'Nova';
await renderAdminActions();
$('admin-ban-reason').value = 'page test';
await adminBan();
check('ban Nova', !!(await until(async () => (await doc('users/Nova')).banned === true)));
await adminUnban();
check('unban Nova', !!(await until(async () => (await doc('users/Nova')).banned === false)));
$('admin-mute-reason').value = 'quiet';
await adminMute();
check('mute Nova', !!(await until(async () => !!(await doc('users/Nova')).mutedUntil)));
await renderAdminActions();
const orbs0 = (await doc('users/Nova')).orbs;
$('admin-orbs-amt').value = '25';
await adminAdjustOrbs('Nova', 1);
check('grant Nova 25 Orbs', !!(await until(async () => (await doc('users/Nova')).orbs === orbs0 + 25)));
await adminSetOp('Nova', true);
check('make Nova an Admin', !!(await until(async () => (await doc('users/Nova')).op === true)));
await adminSetOp('Nova', false);
check('...and not', !!(await until(async () => (await doc('users/Nova')).op === false)));
await setPurgePerm('Sumi', true);
check('give Sumi purge perms', !!(await until(async () => (await doc('users/Sumi')).purgePerm === true)));
await setPurgePerm('Sumi', false);
check('...and take them away', !!(await until(async () => (await doc('users/Sumi')).purgePerm === undefined)));
await createRedeemCode('orbs', 25, 'Tester', 'PAGECODE', 3);
check('make a code', !!(await until(async () => { const c = await doc('redeemCodes/PAGECODE'); return c && c.value === 25 && c.maxUses === 3; })));
$('admin-filter-word').value = 'pagebadword';
await $('admin-filter-add').onclick();
check('add a word to the filter', !!(await until(async () => ((await doc('config/filter')).words || []).includes('pagebadword'))));
for (const [tab, el] of [['devices', 'devices-list'], ['ips', 'ips-list'], ['conversations', null], ['codes', null], ['ranks', null], ['move', 'move-list']]) {
  document.querySelector(`.admin-tab[data-admin-tab="${tab}"]`).click();
  await T.wait(1500);
  const pane = $('admin-pane-' + tab), text = (el ? $(el) : pane).innerText || '';
  check(`the ${tab} tab draws`, !pane.classList.contains('hidden') && !/Could not load|Something went wrong/i.test(text) && text.trim().length > 0, text.slice(0, 160));
}
check('Devices lists this browser and its accounts', /\d+ accounts?/.test($('devices-list').innerText), $('devices-list').innerText.slice(0, 200));
check('Codes lists the new code', /PAGECODE/.test($('admin-pane-codes').innerText));
closeModal('admin-panel-modal');
return T.report();
