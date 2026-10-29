// Steal a Character: the one shared server, on Firebase's Realtime Database (under ocrng/, the part the rules allow).
//   ocrng/sac/roster/{uid}        who is playing: name, shirt colour, base, and until when their base is locked
//   ocrng/sac/bases/{i}           who has each of the 8 bases
//   ocrng/sac/pos/{uid}           where everyone is, what they hold and carry (only sent while 2 or more are in)
//   ocrng/sac/pads/{uid}          the characters on each player's pads, so everyone sees them (and can steal them)
//   ocrng/sac/sold/{slot}         who bought each character off the runway: the first one wins
//   ocrng/sac/steal/{victim}/{pad}  a character being carried off: { by, c, m }, then done when it reaches the thief's
//                                 base, then ok once the owner's game has taken it off their pad
//   ocrng/sac/hits/{uid}          bonks, freezes and shocks aimed at someone
//   ocrng/sac/fx                  effects everyone sees; each one deletes itself
//   ocrng/sac/traps/{id}          shock traps on the ground
//   ocrng/sac/session/{uid}       which window is playing, so two can't save over each other
//   ocrng/sac/chat                the chat (chat.js)
// Everything about a player goes away by itself when they disconnect.
export function createSacNet(rtdb, firebase, uid, on) {
  const ref = p => rtdb.ref('ocrng/sac/' + p);
  const roster = {}, offs = [], TS = firebase.database.ServerValue.TIMESTAMP;
  const myRoster = ref('roster/' + uid), myPos = ref('pos/' + uid), myPads = ref('pads/' + uid);
  let streaming = false, posOff = null, lastSent = 0, lastKey = '', offset = 0, joinedAt = Date.now(), base = -1;
  const listen = (r, ev, fn) => { r.on(ev, fn); offs.push(() => r.off(ev, fn)); };
  const serverNow = () => Date.now() + offset;

  function startStreaming() {
    if (streaming) return;
    streaming = true;
    const pr = ref('pos'), add = s => { if (s.key !== uid) on.pos(s.key, s.val()); }, rem = s => on.posGone(s.key);
    pr.on('child_added', add); pr.on('child_changed', add); pr.on('child_removed', rem);
    posOff = () => { pr.off('child_added', add); pr.off('child_changed', add); pr.off('child_removed', rem); };
    lastKey = '';
  }
  function stopStreaming() { if (!streaming) return; streaming = false; if (posOff) posOff(); posOff = null; myPos.remove().catch(() => {}); }
  const checkStreaming = () => (Object.keys(roster).length >= 2 ? startStreaming() : stopStreaming());

  return {
    roster, serverNow,
    get base() { return base; },
    // one window at a time: a newer one takes over, and the older one is told to close
    claimSession(id, onTaken) {
      const r = ref('session/' + uid);
      r.onDisconnect().remove();
      const watch = s => { const v = s.val(); if (v && v.id && v.id !== id) onTaken(); };
      return r.set({ id, t: TS }).then(() => { listen(r, 'value', watch); });
    },
    join(info) {
      joinedAt = Date.now();
      myRoster.onDisconnect().remove(); myPos.onDisconnect().remove(); myPads.onDisconnect().remove();
      ref('hits/' + uid).onDisconnect().remove(); ref('hits/' + uid).remove().catch(() => {});
      myRoster.set({ ...info, t: TS }).catch(err => on.denied && on.denied(err));
      listen(rtdb.ref('.info/serverTimeOffset'), 'value', s => { offset = s.val() || 0; });
      const rr = ref('roster');
      listen(rr, 'child_added', s => { roster[s.key] = s.val(); if (s.key !== uid) on.joined(s.key, s.val()); checkStreaming(); });
      listen(rr, 'child_changed', s => { roster[s.key] = s.val(); if (s.key !== uid) on.changed(s.key, s.val()); });
      listen(rr, 'child_removed', s => { delete roster[s.key]; if (s.key !== uid) on.left(s.key); checkStreaming(); });
      listen(ref('bases'), 'value', s => on.bases(s.val() || {}));
      const pads = ref('pads'), padAdd = s => { if (s.key !== uid) on.pads(s.key, s.val()); };
      listen(pads, 'child_added', padAdd); listen(pads, 'child_changed', padAdd); listen(pads, 'child_removed', s => on.pads(s.key, null));
      listen(ref('sold').limitToLast(40), 'child_added', s => on.sold(+s.key, s.val()));
      listen(ref('steal'), 'value', s => on.steals(s.val() || {}));
      listen(ref('hits/' + uid), 'child_added', s => { const h = s.val(); s.ref.remove().catch(() => {}); if (h && Date.now() - (h.t || 0) < 6000) on.hit(h); });
      listen(ref('fx').limitToLast(10), 'child_added', s => { const f = s.val(); if (f && f.uid !== uid && Date.now() - (f.t || 0) < 4000) on.fx(f); });
      const traps = ref('traps');
      listen(traps, 'child_added', s => on.trap(s.key, s.val())); listen(traps, 'child_removed', s => on.trap(s.key, null));
    },
    update(partial) { myRoster.update(partial).catch(() => {}); },
    // a free base (or the one you already have): the first of the 8 nobody holds
    async claimBase(name) {
      for (let i = 0; i < 8; i++) {
        const r = ref('bases/' + i);
        try {
          const res = await r.transaction(cur => (!cur || cur.uid === uid ? { uid, name, t: Date.now() } : undefined));
          if (res.committed) { r.onDisconnect().remove(); base = i; return i; }
        } catch (e) { if (on.denied) on.denied(e); return -1; }
      }
      return -1;
    },
    setPads(list) { myPads.set(list).catch(() => {}); },
    sendPos(p) {
      if (!streaming) return;
      const now = Date.now();
      if (now - lastSent < 100) return;
      const key = JSON.stringify(p);
      if (key === lastKey && now - lastSent < 3000) return;
      lastSent = now; lastKey = key;
      myPos.set({ ...p, t: now }).catch(() => {});
    },
    hit(to, h) { ref('hits/' + to).push({ ...h, from: uid, t: Date.now() }).catch(() => {}); },
    fx(f) { const r = ref('fx').push({ ...f, uid, t: Date.now() }); r.catch(() => {}); setTimeout(() => r.remove().catch(() => {}), 4000); },
    // buy a character off the runway: true if you were first
    async buy(slot, lifeMs) {
      const r = ref('sold/' + slot);
      const res = await r.transaction(cur => (cur ? undefined : uid));
      if (!res.committed) return false;
      r.onDisconnect().remove(); setTimeout(() => { r.remove().catch(() => {}); r.onDisconnect().cancel(); }, lifeMs + 15000);
      return true;
    },
    // stealing: take it (if nobody else is), hand it over at your base, or drop it
    async steal(victim, pad, d) {
      const r = ref(`steal/${victim}/${pad}`);
      const res = await r.transaction(cur => (cur ? undefined : { by: uid, c: d.c, m: d.m || '', t: serverNow() }));
      if (res.committed) r.onDisconnect().remove();
      return res.committed;
    },
    async arrive(victim, pad) { const res = await ref(`steal/${victim}/${pad}`).transaction(cur => (cur && cur.by === uid ? { ...cur, done: 1 } : undefined)); return res.committed; },
    drop(victim, pad) { return ref(`steal/${victim}/${pad}`).transaction(cur => (cur && cur.by === uid ? null : undefined)).catch(() => {}); },
    // the owner's side: it's off your pad now (ok), or clear a finished hand-over
    stealOk(pad) { return ref(`steal/${uid}/${pad}/ok`).set(1).catch(() => {}); },
    clearSteal(victim, pad) { return ref(`steal/${victim}/${pad}`).remove().catch(() => {}); },
    watchSteal(victim, pad, fn) { const r = ref(`steal/${victim}/${pad}`); const cb = s => fn(s.val()); r.on('value', cb); return () => r.off('value', cb); },
    placeTrap(t) { const r = ref('traps').push(t); r.catch(() => {}); r.onDisconnect().remove(); setTimeout(() => r.remove().catch(() => {}), Math.max(0, t.until - Date.now())); },
    async trigger(id) { const res = await ref('traps/' + id).transaction(cur => (cur ? null : undefined)); return res.committed; },
    leave() {
      offs.forEach(f => f()); offs.length = 0; stopStreaming();
      myRoster.remove().catch(() => {}); myPads.remove().catch(() => {});
      if (base >= 0) ref('bases/' + base).transaction(cur => (cur && cur.uid === uid ? null : undefined)).catch(() => {});
      ref('session/' + uid).remove().catch(() => {});
    },
  };
}
