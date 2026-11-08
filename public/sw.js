// Service worker mínimo: só para o app ser instalável e mostrar "Sem conexão" offline.
// NUNCA guarda /api/* nem páginas com dados financeiros: o único item em cache é /offline.html.
const CACHE = 'fi-offline-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/offline.html')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Só navegação (abrir páginas); APIs e demais recursos seguem direto para a rede, sem cache.
  if (request.mode !== 'navigate' || new URL(request.url).pathname.startsWith('/api/')) return;
  event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
});
