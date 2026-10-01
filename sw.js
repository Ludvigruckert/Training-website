// Service worker: gör att Fitsphere kan installeras som app och startar snabbt.
// Sidans egna filer hämtas i första hand från nätet (så att uppdateringar syns direkt)
// och från cachen om man saknar uppkoppling. Bilder tas från cachen först.
// Anrop till Supabase (inloggning och data) går alltid direkt till nätet och sparas aldrig här.
const CACHE = 'fitsphere-v1';

const APP_SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/config.js',
  'js/generator.js',
  'js/storage.js',
  'js/auth.js',
  'js/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'images/hero/1-sled-push.jpg',
  'images/hero/2-wall-ball.jpg',
  'images/hero/3-kalk.jpg',
  'images/hero/4-ringar.jpg',
  'images/hero/5-skivstang.jpg',
];
// Supabase-biblioteket från CDN behövs för att appen ska starta.
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL).then(() => cache.add(CDN).catch(() => {})))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Ta bort cachar från äldre versioner.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.href.startsWith(CDN)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.origin !== self.location.origin) return; // t.ex. Supabase – hanteras inte här
  event.respondWith(request.destination === 'image' ? cacheFirst(request) : networkFirst(request));
});
