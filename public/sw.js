// RunStride's service worker: shows notifications from the server (Web Push), even when the site is
// closed, and opens the right screen when one is tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const url = data.url || "/";
  event.waitUntil(
    self.registration.showNotification(data.title || "RunStride", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: url, // a newer notification about the same chat replaces the older one
      renotify: true,
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const win of windows) {
        if ("focus" in win) {
          win.postMessage({ type: "open", url }); // the app moves to that screen
          return win.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
