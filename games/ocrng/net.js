// Overcontrol RNG: the one shared lobby, on Firebase's Realtime Database.
//   ocrng/roster/{name}  who is in the lobby: name, aura, shirt colour, PvP. Small, and only written when it changes.
//   ocrng/pos/{name}     where each player is. Only sent while at least 2 people are in, so playing alone costs nothing.
//   ocrng/hits/{name}    aura attacks aimed at someone (applied only if both of you have PvP on).
//   ocrng/fx             attack effects for everyone to see. Each one deletes itself after a few seconds.
//   ocrng/announce       "X HAS FOUND EQUINOX" for very rare rolls.
//   ocrng/world          biomes, day or night, the Jester and server luck: from the admin panel, runes and Biome Randomizers.
//   ocrng/raid           the raid boss everyone is fighting: its health, and when it gave up or died.
//   ocrng/chat           chat messages (chat.js), each one deleted after 20 seconds.
//   ocrng/xboss          ____X____: his health (life), what the host game sees him do (s), everyone's damage, team null.
//   ocrng/wipe/{name}    when the Owner wiped this player's data, so a game they have open stops saving and closes.
//   ocrng/gifts/{name}   auras the Owner gave this player, waiting until their game picks them up (right away if they
//                        are playing), so their own save can never write over a gift.
// Everyone leaves the roster automatically when they disconnect.
export function createNet(rtdb, firebase, uid, on) {
  const ref = p => rtdb.ref('ocrng/' + p);
  const roster = {}, offs = [];
  const myRoster = ref('roster/' + uid), myPos = ref('pos/' + uid);
  let streaming = false, posOff = null, lastSent = 0, lastKey = '', joinedAt = Date.now(), offset = 0;
  const listen = (r, ev, fn) => { r.on(ev, fn); offs.push(() => r.off(ev, fn)); };

  function startStreaming() {
    if (streaming) return;
    streaming = true;
    const pr = ref('pos');
    const add = s => { if (s.key !== uid) on.pos(s.key, s.val()); };
    const rem = s => on.posGone(s.key);
    pr.on('child_added', add); pr.on('child_changed', add); pr.on('child_removed', rem);
    posOff = () => { pr.off('child_added', add); pr.off('child_changed', add); pr.off('child_removed', rem); };
    lastKey = '';
  }
  function stopStreaming() {
    if (!streaming) return;
    streaming = false;
    if (posOff) posOff(); posOff = null;
    myPos.remove().catch(() => {});
  }
  const checkStreaming = () => (Object.keys(roster).length >= 2 ? startStreaming() : stopStreaming());

  return {
    get streaming() { return streaming; },
    get count() { return Object.keys(roster).length; },
    roster,
    join(info) {
      joinedAt = Date.now();
      myRoster.onDisconnect().remove(); myPos.onDisconnect().remove();
      ref('hits/' + uid).onDisconnect().remove();
      ref('hits/' + uid).remove().catch(() => {});
      // Refused means the database rules don't have the ocrng section yet: the game then plays solo.
      myRoster.set({ ...info, t: firebase.database.ServerValue.TIMESTAMP }).catch(err => { if (on.denied) on.denied(err); });
      const rr = ref('roster');
      listen(rr, 'child_added', s => { roster[s.key] = s.val(); if (s.key !== uid) on.joined(s.key, s.val()); checkStreaming(); });
      listen(rr, 'child_changed', s => { roster[s.key] = s.val(); if (s.key !== uid) on.changed(s.key, s.val()); });
      listen(rr, 'child_removed', s => { delete roster[s.key]; if (s.key !== uid) on.left(s.key); checkStreaming(); });
      listen(ref('hits/' + uid), 'child_added', s => { const h = s.val(); s.ref.remove().catch(() => {}); if (h && Date.now() - (h.t || 0) < 5000) on.hit(h); });
      listen(ref('fx').limitToLast(8), 'child_added', s => { const f = s.val(); if (f && f.uid !== uid && Date.now() - (f.t || 0) < 4000) on.fx(f); });
      const shown = new Set();   // announcements clear themselves out, which can bring an older one back to the end: show each once
      listen(ref('announce').limitToLast(1), 'child_added', s => { const a = s.val(); if (a && !shown.has(s.key) && (a.t || 0) > joinedAt - 15000) { shown.add(s.key); on.announce(a); } });
      listen(ref('world'), 'value', s => on.world(s.val() || {}));
      listen(rtdb.ref('.info/serverTimeOffset'), 'value', s => { offset = s.val() || 0; });
      listen(ref('xboss'), 'value', s => on.xboss && on.xboss(s.val()));
      listen(ref('wipe/' + uid), 'value', s => on.wiped && on.wiped(s.val()));
      listen(ref('gifts/' + uid), 'child_added', s => { const g = s.val(); if (g && on.gift) on.gift(g, () => s.ref.remove().catch(() => {})); });
      listen(ref('raid'), 'value', s => on.raid && on.raid(s.val()));
    },
    update(partial) { myRoster.update(partial).catch(() => {}); },
    // Where you are, at most 10 times a second, and only when something changed.
    sendPos(p) {
      if (!streaming) return;
      const now = Date.now();
      if (now - lastSent < 100) return;
      const ex = p.ex ? JSON.stringify(p.ex) : '';
      const key = `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)},${p.r.toFixed(2)},${p.a},${p.hp},${ex}`;
      if (key === lastKey && now - lastSent < 3000) return;
      lastSent = now; lastKey = key;
      myPos.set({ x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), r: +p.r.toFixed(3), a: p.a, hp: p.hp, t: now, ...(p.ex || {}) }).catch(() => {});
    },
    hit(target, h) { ref('hits/' + target).push({ ...h, from: uid, t: Date.now() }).catch(() => {}); },
    fx(f) { const r = ref('fx').push({ ...f, uid, t: Date.now() }); setTimeout(() => r.remove().catch(() => {}), 4000); },
    announce(a) { const r = ref('announce').push({ ...a, uid, t: Date.now() }); r.catch(() => {}); r.onDisconnect().remove(); setTimeout(() => { r.remove().catch(() => {}); r.onDisconnect().cancel(); }, 60000); },
    setWorld(partial) { return ref('world').update(partial); },
    // only starts if nothing is being fought already (or the last fight is over)
    raidStart(state) { return ref('raid').transaction(cur => (!cur || cur.dead || cur.gone || cur.until < Date.now() ? state : undefined)); },
    raidHit(dmg) { return ref('raid/hp').transaction(hp => (typeof hp === 'number' ? Math.max(0, hp - dmg) : hp)); },
    raidUpdate(fields) { return ref('raid').update(fields).catch(() => {}); },
    raidClear() { return ref('raid').remove().catch(() => {}); },
    clearWorld() { return ref('world').remove(); },
    // the database's clock, so every game agrees when things happen
    serverNow: () => Date.now() + offset,
    xStart(state) { const n = Date.now() + offset; return ref('xboss').transaction(cur => (!cur || cur.gone || (cur.life && cur.life.dead) || (cur.until || 0) < n ? state : undefined)); },
    xSet(fields) { return ref('xboss').update(fields).catch(() => {}); },
    xLife(fn) { return ref('xboss/life').transaction(fn); },
    xMob(i, fn) { return ref('xboss/mobs/' + i).transaction(fn); },
    xDmg(n) { return ref('xboss/dmg/' + uid).set(n).catch(() => {}); },
    xDied() { return ref('xboss/died/' + uid).transaction(n => (n || 0) + 1).catch(() => {}); },
    xHost(me) { const n = Date.now() + offset; return ref('xboss').transaction(cur => (cur && !cur.gone && !(cur.life && cur.life.dead) && (cur.hb || 0) < n - 3500 ? { ...cur, host: me, hb: n } : undefined)); },
    wipe(name) { return ref('wipe/' + name).set(Date.now() + offset); },
    gift(to, g) { return ref('gifts/' + to).push({ ...g, t: Date.now() + offset }); },
    leave() {
      offs.forEach(f => f()); offs.length = 0;
      stopStreaming();
      myRoster.remove().catch(() => {}); myPos.remove().catch(() => {});
      myRoster.onDisconnect().cancel(); myPos.onDisconnect().cancel();
    },
  };
}
