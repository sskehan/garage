// MyGarage — offline support. Bump VERSION when you change any app file.
const VERSION = "gl-v1.47";
const SHELL = ["./", "index.html", "app.js", "jszip.min.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== "gl-fonts").map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (u.host === "fonts.googleapis.com" || u.host === "fonts.gstatic.com") {
    e.respondWith(caches.open("gl-fonts").then(async c => { const hit = await c.match(e.request); const net = fetch(e.request).then(r => { c.put(e.request, r.clone()); return r; }).catch(() => hit); return hit || net; }));
    return;
  }
  if (u.origin !== location.origin) return;
  // App files: network first when online, skipping the browser cache so updates arrive straight away; cached copy when offline.
  e.respondWith(fetch(e.request.url, { cache: "no-cache" }).then(r => { if (r.ok) caches.open(VERSION).then(c => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match("index.html"))));
});
