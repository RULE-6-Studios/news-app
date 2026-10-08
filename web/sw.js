const CACHE = 'news-shell-v1';
const SHELL = ['/', 'index.html', 'css/app.css', 'js/app.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Data is always fetched fresh (falling back to cache only if offline) --
  // never show a stale feed when the network is actually available.
  if (url.pathname.endsWith('/data/stories.json')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          caches.open(CACHE).then((cache) => cache.put(event.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
