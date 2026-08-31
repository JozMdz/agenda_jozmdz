/* AgendaApp — service worker mínimo.
   Estrategia: red primero, caché como respaldo.
   Así siempre ves la versión más nueva, pero la app abre sin señal. */
const CACHE = "agendaapp-v4";
const SHELL = ["./", "./index.html", "./icon-192-v2.png", "./icon-512-v2.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const copia = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});

/* ---------- Notificaciones ---------- */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data.json(); }
  catch(_) { d = { title: "AgendaApp", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "AgendaApp", {
    body:  d.body || "",
    icon:  "./icon-192-v2.png",
    badge: "./icon-192-v2.png",
    tag:   d.tag || "resumen",
    renotify: true,
    data: { url: d.url || "./" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(lista => {
      for (const c of lista) if (c.url.startsWith(self.location.origin) && "focus" in c) return c.focus();
      return self.clients.openWindow(e.notification.data && e.notification.data.url || "./");
    })
  );
});
