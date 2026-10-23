// Service worker: dastur fayllarini telefonda saqlaydi — ilova bir zumda ochiladi.
const CACHE = "davomat-v5.0.0";
const ASSETS = ["./", "index.html", "style.css?v=5.0.0", "app.js?v=5.0.0", "config.js?v=5.0.0", "manifest.webmanifest",
  "assets/icon-192.png", "assets/icon-512.png", "assets/favicon.png"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {})); });
self.addEventListener("activate", e => e.waitUntil(Promise.all([self.clients.claim(),
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))])));
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return; // API so'rovlari keshlanmaydi
  const isPage = r.mode === "navigate";
  // Sahifa: avval tarmoq (yangi versiya), bo'lmasa kesh. Fayllar: keshdan darhol + fonda yangilash.
  if (isPage) {
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put("index.html", c)); return res; })
      .catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(r).then(hit => {
    const net = fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(r, c)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
