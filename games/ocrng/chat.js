// Overcontrol RNG: the in-game chat, like Roblox's. Press / (or tap the chat button) to type, Enter to send.
// Nothing is saved: a message lives in the Realtime Database for 20 seconds so everyone in the lobby sees it, then it
// deletes itself (and anything left behind is removed when its sender disconnects). The game also posts its own
// server messages here: biomes starting, the Jester, rare rolls.
const NAME_COLORS = ['#fd2943', '#01a2ff', '#02b857', '#a75ea6', '#f0841c', '#ebc71e', '#e8b0d7', '#d7c59a'];
const nameColor = name => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return NAME_COLORS[h % NAME_COLORS.length]; };

export function createChat({ host, rtdb, uid, name, onMessage, onCommand }) {
  const box = document.createElement('div');
  box.className = 'oc-chat idle';
  // two tabs like a Roblox chat window: General (players and the game) and Server (who found what, everywhere)
  box.innerHTML = '<div class="oc-chat-tabs"><button type="button" data-ch="general" class="on">General</button><button type="button" data-ch="server">Server<i class="oc-chat-new hidden"></i></button></div>'
    + '<div class="oc-chat-log" data-ch="general"></div><div class="oc-chat-log hidden" data-ch="server"></div>'
    + '<form class="oc-chat-bar"><input class="oc-chat-input" maxlength="150" autocomplete="off" spellcheck="false" placeholder="To chat click here or press &quot;/&quot; key"></form>';
  host.appendChild(box);
  const logs = { general: box.querySelector('[data-ch="general"].oc-chat-log'), server: box.querySelector('[data-ch="server"].oc-chat-log') };
  const log = logs.general, form = box.querySelector('form'), input = box.querySelector('input');
  let tab = 'general';
  const show = ch => {
    tab = ch;
    box.querySelectorAll('.oc-chat-tabs button').forEach(b => b.classList.toggle('on', b.dataset.ch === ch));
    for (const [k, el] of Object.entries(logs)) el.classList.toggle('hidden', k !== ch);
    if (ch === 'server') box.querySelector('.oc-chat-new').classList.add('hidden');
    logs[ch].scrollTop = logs[ch].scrollHeight;
  };
  box.querySelectorAll('.oc-chat-tabs button').forEach(b => b.addEventListener('click', () => { show(b.dataset.ch); wake(); }));
  const ref = rtdb ? rtdb.ref('ocrng/chat') : null;
  const joinedAt = Date.now();
  let lastSent = 0, idleTimer = 0, off = null;

  function wake() {
    box.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (document.activeElement !== input) box.classList.add('idle'); }, 12000);
  }
  function line(html, cls = '', ch = 'general') {
    const to = logs[ch] || log, el = document.createElement('div');
    el.className = 'oc-chat-line ' + cls;
    el.innerHTML = html;
    to.appendChild(el);
    while (to.children.length > 60) to.firstChild.remove();
    to.scrollTop = to.scrollHeight;
    if (ch !== tab && ch === 'server') box.querySelector('.oc-chat-new').classList.remove('hidden');
    wake();
    return el;
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  if (ref) {
    const q = ref.limitToLast(25);
    const add = s => {
      const m = s.val();
      if (!m || !m.text || (m.t || 0) < joinedAt - 1500) return;
      line(`<b style="color:${nameColor(m.name)}">[${esc(m.name)}]:</b> <span>${esc(m.text)}</span>`);
      if (onMessage) onMessage(m.uid, m.name, m.text);
    };
    q.on('child_added', add);
    off = () => q.off('child_added', add);
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150);
    input.value = '';
    if (!text) { input.blur(); return; }
    if (text.startsWith('/')) {
      const [cmd, ...args] = text.slice(1).split(' ');
      if (!onCommand || !onCommand(cmd.toLowerCase(), args)) api.system('Unknown command. Type /help to see what you can do.', '#c9c9c9');
      return;
    }
    if (Date.now() - lastSent < 900) { api.system('You are sending messages too fast.', '#ff8a80'); return; }
    lastSent = Date.now();
    if (!ref) { line(`<b style="color:${nameColor(name)}">[${esc(name)}]:</b> <span>${esc(text)}</span>`); if (onMessage) onMessage(uid, name, text); return; }
    const r = ref.push({ uid, name, text, t: Date.now() });
    r.onDisconnect().remove();
    setTimeout(() => { r.remove().catch(() => {}); r.onDisconnect().cancel(); }, 20000);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { input.value = ''; input.blur(); } e.stopPropagation(); });
  input.addEventListener('focus', () => { box.classList.add('typing'); if (tab !== 'general') show('general'); wake(); });
  input.addEventListener('blur', () => { box.classList.remove('typing'); wake(); });

  const api = {
    el: box,
    // a line from the game itself, like "[Server]: Starfall has begun"
    system(text, color = '#ffffff', ch = 'general') { line(`<span style="color:${color}">${esc(text)}</span>`, 'sys', ch); },
    focus() { input.focus(); },
    get typing() { return document.activeElement === input; },
    destroy() { if (off) off(); clearTimeout(idleTimer); box.remove(); },
  };
  return api;
}
