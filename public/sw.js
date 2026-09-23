// Service Worker «Контроля задач»: нажатие на уведомление Chrome открывает нужный раздел приложения —
// в уже открытой вкладке, если она есть. Уведомления показывает сама вкладка (без внешних служб и интернета).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const own = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (own) {
        await own.focus();
        // Переход внутри приложения без перезагрузки: вкладка сама откроет раздел.
        own.postMessage({ type: 'navigate', url: target.pathname });
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
