// move-to-supabase.html (served as /move-to-supabase): the copy for switch day, on a page of its own. (Not /move:
// that could be a server's invite link.) On switch day Firestore is locked to every page
// (firestore.rules: the switch-day lock), so Frixion itself couldn't load; this page never reads Firestore. It signs in with
// Frixion's Firebase sign-in and asks functions/api/admin/move, which checks it's the Owner and does the reading (the
// service account, which the lock doesn't apply to) and the writing (Supabase's secret key), a page of one kind of
// document at a time. Where it got to is kept on this device, under the same name as the Owner panel's Supabase tab,
// so it can stop and carry on.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const app = initializeApp({ apiKey: 'AIzaSyCaDVRWLOSgC_Nl0YOeoG86G_hd_LKdW2U', authDomain: 'liquidalt.firebaseapp.com', projectId: 'liquidalt', appId: '1:151067316267:web:522330446b0fae7cdbda6e' });
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const auth = getAuth(app);
if (LOCAL && new URLSearchParams(location.search).has('emulators')) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const ADMIN_API = LOCAL ? 'http://127.0.0.1:8788/api/admin' : 'https://frixionbeta.pages.dev/api/admin';
// (Frixion's sign-ins: the username in hex as a made-up email, and "frixion:" before the password)
const authEmail = u => [...new TextEncoder().encode(u)].map(b => b.toString(16).padStart(2, '0')).join('') + '@u.frixionbeta.pages.dev';
const $ = id => document.getElementById(id);
const N = n => Number(n || 0).toLocaleString();

const KEY = 'frixion_move';
const state = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } };
const keep = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} };
let run = null;   // { stop } while counting or copying
async function ask(body) {
  const token = await auth.currentUser.getIdToken();
  const r = await fetch(`${ADMIN_API}/move`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `The server answered ${r.status}.`), { status: r.status });
  return j;
}
const why = e => (e && e.status === 503 && /limit/i.test(e.message) ? "Firebase's daily reads ran out. They come back at midnight Pacific time: press Carry On then, and it picks up from here." : (e && e.message) || 'Something went wrong.');

function render(msg) {
  const s = state(), groups = s.groups || [], counts = s.counts || {}, copied = s.copied || {}, done = s.done || {};
  if (msg !== undefined) $('status').textContent = msg;
  $('count').disabled = $('copy').disabled = $('reset').disabled = $('out').disabled = !!run;
  $('stop').disabled = !run;
  const started = groups.some(g => copied[g] || done[g]), finished = groups.length > 0 && groups.every(g => done[g]);
  $('copy').textContent = !run && started && !finished ? 'Carry On' : 'Copy';
  const list = $('list');
  list.textContent = '';
  const row = (name, sub, cls) => { const li = document.createElement('li'); if (cls) li.className = cls; const a = document.createElement('span'), b = document.createElement('span'); a.textContent = name; b.textContent = sub; li.append(a, b); list.append(li); };
  if (groups.length) {
    const total = groups.reduce((n, g) => n + (counts[g] || 0), 0), moved = groups.reduce((n, g) => n + (copied[g] || 0), 0);
    row('Everything', `${s.counted ? N(total) + ' in Firebase, ' : ''}${N(moved)} copied${finished ? ', done' : ''}`, 'all');
    for (const g of groups) row(g, [counts[g] != null ? N(counts[g]) + ' in Firebase' : '', copied[g] ? N(copied[g]) + ' copied' : '', done[g] ? 'done' : ''].filter(Boolean).join(', ') || 'waiting');
  }
  const notes = [];
  if ((s.unknown || []).length) notes.push(`Supabase has no table for these, so they aren't copied: ${s.unknown.join(', ')}.`);
  if ((s.skipped || []).length) notes.push(`Not copied (${s.skipped.length}): ${s.skipped.slice(0, 30).join('; ')}${s.skipped.length > 30 ? '; ...' : ''}`);
  $('notes').textContent = notes.join(' ');
}

$('count').onclick = async () => {
  if (run) return;
  const r = run = { stop: false };
  render('Counting...');
  try {
    const { groups, unknown } = await ask({ action: 'plan' });
    const s = state();
    s.groups = groups; s.unknown = unknown || []; s.counts = {}; s.counted = false;
    for (const g of groups) {
      if (r.stop) break;
      s.counts[g] = (await ask({ action: 'count', group: g })).count;
      keep(s); render(`Counting ${g}...`);
    }
    s.counted = !r.stop; keep(s);
    run = null;
    render(s.counted ? `${N(groups.reduce((n, g) => n + (s.counts[g] || 0), 0))} documents to copy.` : 'Stopped.');
  } catch (e) { run = null; render(why(e)); }
};
$('copy').onclick = async () => {
  if (run) return;
  const r = run = { stop: false };
  render('Copying...');
  try {
    const s = state();
    if (!s.groups) { const p = await ask({ action: 'plan' }); s.groups = p.groups; s.unknown = p.unknown || []; }
    s.copied = s.copied || {}; s.done = s.done || {}; s.after = s.after || {}; s.skipped = s.skipped || [];
    let size = 200;
    for (const g of s.groups) {
      while (!s.done[g] && !r.stop) {
        const p = await ask({ action: 'copy', group: g, after: s.after[g] || null, size });
        if (p.retrySmaller) { size = Math.max(1, Math.floor(size / 4)); continue; }   // (down to the one Supabase won't take)
        s.copied[g] = (s.copied[g] || 0) + p.copied;
        s.skipped.push(...(p.skipped || []));
        if (p.last) s.after[g] = p.last;
        if (p.done) s.done[g] = true;
        keep(s);
        render(`Copying ${g}...`);
        size = Math.min(200, size * 2);
      }
      if (r.stop) break;
    }
    run = null;
    const all = s.groups.every(g => s.done[g]);
    render(all ? `Done: ${N(s.groups.reduce((n, g) => n + (s.copied[g] || 0), 0))} documents copied into Supabase.`
      : s.groups.some(g => s.copied[g] || s.done[g]) ? 'Stopped. Press Carry On to pick up where it left off.' : 'Stopped.');
  } catch (e) { run = null; render(why(e)); }
};
$('stop').onclick = () => { if (run) { run.stop = true; render('Stopping after this page...'); } };
$('reset').onclick = () => {
  if (run || !confirm('Forget what was counted and copied on this device? What is already in Supabase stays there; copying again writes it again.')) return;
  keep({}); render('');
};
$('out').onclick = () => signOut(auth);
$('signin').onsubmit = async e => {
  e.preventDefault();
  const user = $('user').value.trim(), pass = $('pass').value;
  if (!user || !pass) { $('status').textContent = 'Fill in both.'; return; }
  $('go').disabled = true; $('status').textContent = 'Signing in...';
  try { await signInWithEmailAndPassword(auth, authEmail(user), 'frixion:' + pass); $('status').textContent = ''; }
  catch (err) { $('status').textContent = /invalid|wrong|not-found/.test(err.code || '') ? 'Wrong username or password.' : (err.code || err.message); }
  $('pass').value = ''; $('go').disabled = false;
};
onAuthStateChanged(auth, user => {
  $('signin').classList.toggle('hidden', !!user);
  $('tools').classList.toggle('hidden', !user);
  $('who').textContent = user ? 'Signed in. The server checks that this is the Owner before it copies anything.' : '';
  if (user) render(); else { $('list').textContent = ''; $('notes').textContent = ''; }
});
