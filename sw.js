// Frixion's service worker: shows push notifications (sent by functions/api/push) even when Frixion is closed, and opens
// the right chat when one is tapped. It caches nothing, so every page still comes straight from the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Safari (every iPhone browser, and home screen apps) takes notifications away from sites that receive a push without
// showing one, so there it always shows. Elsewhere it stays quiet while you're looking at Frixion.
const SAFARI = /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(navigator.userAgent);

self.addEventListener('push', e => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil((async () => {
    if (!SAFARI) {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (wins.some(w => w.visibilityState === 'visible' && w.focused)) return;
    }
    await self.registration.showNotification(n.title || 'Frixion', {
      body: n.body || '',
      icon: n.icon || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: n.tag || undefined,
      renotify: !!n.tag,
      data: { open: n.open || null },
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const open = (e.notification.data || {}).open || null;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      const w = wins.find(x => x.focused) || wins[0];
      try { await w.focus(); } catch (err) {}
      if (open) w.postMessage({ type: 'frixion-open', open });
      return;
    }
    await self.clients.openWindow('/' + (open ? '?open=' + encodeURIComponent(JSON.stringify(open)) : ''));
  })());
});
