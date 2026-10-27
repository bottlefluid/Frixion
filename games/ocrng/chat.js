// Overcontrol RNG: the in-game chat, like Roblox's. Press / (or tap the chat button) to type, Enter to send.
// Nothing is saved: a message lives in the Realtime Database for 20 seconds so everyone in the lobby sees it, then it
// deletes itself (and anything left behind is removed when its sender disconnects). The game also posts its own
// server messages here: biomes starting, the Jester, rare rolls.
const NAME_COLORS = ['#fd2943', '#01a2ff', '#02b857', '#a75ea6', '#f0841c', '#ebc71e', '#e8b0d7', '#d7c59a'];
const nameColor = name => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return NAME_COLORS[h % NAME_COLORS.length]; };

export function createChat({ host, rtdb, uid, name, onMessage, onCommand }) {
  const box = document.createElement('div');
  box.className = 'oc-chat idle';
  box.innerHTML = '<div class="oc-chat-log"></div><form class="oc-chat-bar"><input class="oc-chat-input" maxlength="150" autocomplete="off" spellcheck="false" placeholder="To chat click here or press &quot;/&quot; key"></form>';
  host.appendChild(box);
  const log = box.querySelector('.oc-chat-log'), form = box.querySelector('form'), input = box.querySelector('input');
  const ref = rtdb ? rtdb.ref('ocrng/chat') : null;
  const joinedAt = Date.now();
  let lastSent = 0, idleTimer = 0, off = null;

  function wake() {
    box.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (document.activeElement !== input) box.classList.add('idle'); }, 12000);
  }
  function line(html, cls = '') {
    const el = document.createElement('div');
    el.className = 'oc-chat-line ' + cls;
    el.innerHTML = html;
    log.appendChild(el);
    while (log.children.length > 60) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
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
  input.addEventListener('focus', () => { box.classList.add('typing'); wake(); });
  input.addEventListener('blur', () => { box.classList.remove('typing'); wake(); });

  const api = {
    el: box,
    // a line from the game itself, like "[Server]: Starfall has begun"
    system(text, color = '#ffffff') { line(`<span style="color:${color}">${esc(text)}</span>`, 'sys'); },
    focus() { input.focus(); },
    get typing() { return document.activeElement === input; },
    destroy() { if (off) off(); clearTimeout(idleTimer); box.remove(); },
  };
  return api;
}
