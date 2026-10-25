const CACHE = "chytalnia-cache-v6";
const ASSETS = [
  "./", "index.html", "style.css", "app.js", "manifest.json",
  "vendor/jszip.min.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(u => fetch(new Request(u, { cache: "reload" })).then(r => { if (!r.ok) throw new Error(u); return c.put(u, r); }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // книги й API йдуть напряму
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      const net = fetch(req, { cache: "no-cache" }).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
