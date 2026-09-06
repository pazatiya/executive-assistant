/* המזכירה — service worker: push notifications + installable shell */
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "המזכירה", body: event.data && event.data.text() };
  }
  const title = data.title || "המזכירה";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/badge.png",
    dir: "rtl",
    lang: "he",
    tag: data.tag || "mazkira",
    renotify: true,
    data: { href: data.href || "/dashboard" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(href);
          return c.focus();
        }
      }
      return self.clients.openWindow(href);
    }),
  );
});
