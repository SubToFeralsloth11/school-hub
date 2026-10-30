/* School Hub service worker.
   Phones (Android Chrome, iPhone home-screen apps) only show notifications that go through a
   service worker, and only a service worker can bring the app back when one is tapped.
   Nothing is cached here, so the site always loads fresh. */

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = new URL('./#reminders', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.registration.scope) === 0 && 'focus' in list[i]) return list[i].focus();
    }
    return self.clients.openWindow(target);
  }));
});
