// In-page helpers for trying the Supabase version of Frixion against the local setup (supabase/local): the checks
// drive the app's own functions and forms, and look at the local database directly (the stand-in's /local/sql and
// fx_get with its secret key, which only exists on this computer). Run from the browser pane, page by page:
//   const run = async f => new (Object.getPrototypeOf(async function () {}).constructor)(
//     await (await fetch('/supabase/tests/page/' + f, { cache: 'no-store' })).text())();
//   await run('helpers.js'); await run('p1-servers.js')
const SB = 'http://127.0.0.1:54321', SECRET = 'local-secret-key';
const T = window.T = window.T || {};
Object.assign(T, {
  wait: ms => new Promise(r => setTimeout(r, ms)),
  async until(f, ms = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { const v = await f(); if (v) return v; } catch (e) {} await T.wait(150); }
    return null;
  },
  async sql(sql, params = []) {
    const r = await fetch(SB + '/local/sql', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SECRET }, body: JSON.stringify({ sql, params }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j.rows;
  },
  async doc(path) {
    const r = await fetch(SB + '/rest/v1/rpc/fx_get', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SECRET, Authorization: 'Bearer ' + SECRET }, body: JSON.stringify({ path }) });
    const j = await r.json();
    return j && j.exists ? j.data : null;
  },
  async put(path, data) {   // straight into the database, as the server would (for setting a test up)
    const r = await fetch(SB + '/rest/v1/rpc/fx_commit', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SECRET, Authorization: 'Bearer ' + SECRET }, body: JSON.stringify({ writes: [{ path, set: data }] }) });
    if (!r.ok) throw new Error(await r.text());
  },
  async patch(path, fields) {   // some fields of a document, as the server ('a.b' for a field inside a map)
    const writes = [{ path, updatePaths: Object.entries(fields).map(([k, v]) => [k.split('.'), v]) }];
    const r = await fetch(SB + '/rest/v1/rpc/fx_commit', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SECRET, Authorization: 'Bearer ' + SECRET }, body: JSON.stringify({ writes }) });
    if (!r.ok) throw new Error(await r.text());
  },
  async tryIt(f) { try { await f(); return 'allowed'; } catch (e) { return e.code || e.message; } },
  async login(name, pass = 'pass1') {
    if (myUid === name) return true;
    if (myUid) await T.logout();
    await T.until(() => !$('auth-screen').classList.contains('hidden'));
    authView('login-view');
    $('login-username').value = name; $('login-password').value = pass; $('login-error').textContent = '';
    await $('login-btn').onclick();
    return !!(await T.until(() => !$('app').classList.contains('hidden') && myUid === name && myProfile, 15000));
  },
  async logout() { await $('logout-btn').onclick(); await T.until(() => !$('auth-screen').classList.contains('hidden')); await T.wait(400); },
  // a modal's confirm button (confirmAction)
  async confirm() { await T.until(() => !$('confirm-modal').classList.contains('hidden'), 3000); await $('confirm-modal-confirm-btn').onclick(); },
  results: T.results || {},
  check(label, ok, info) { T.results[label] = ok ? 'ok' : 'FAIL ' + JSON.stringify(info === undefined ? null : info).slice(0, 400); return ok; },
  // what went wrong along the way: error toasts and promises nobody caught
  problems() { const p = { errorToasts: T.errorToasts.splice(0), uncaught: T.uncaught.splice(0) }; return p.errorToasts.length || p.uncaught.length ? p : null; },
  report() { const r = T.results; T.results = {}; const bad = Object.entries(r).filter(([, v]) => v !== 'ok'); return { passed: Object.keys(r).length - bad.length, failed: Object.fromEntries(bad), problems: T.problems() }; },
});
if (!window.__tWrapped) {
  window.__tWrapped = true;
  T.errorToasts = []; T.uncaught = [];
  const rt = window.toast;
  window.toast = (m, k) => { if (k === 'error') T.errorToasts.push(String(m)); return rt(m, k); };
  window.addEventListener('unhandledrejection', e => { T.uncaught.push(String((e.reason && (e.reason.code ? e.reason.code + ': ' : '') + (e.reason.message || '')) || e.reason)); });
}
return 'helpers ready';
