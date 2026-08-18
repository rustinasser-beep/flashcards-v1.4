const CACHE_NAME = 'flashcards-v1.4.2';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// يسمح للصفحة بطلب تفعيل فوري لأي نسخة جديدة تنتظر (اختياري، ندعمه احتياطًا).
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // لا نتدخل في طلبات الخدمات الخارجية مثل Web3Forms.
  if (url.origin !== self.location.origin) return;

  // صفحات HTML: الشبكة أولًا حتى تصل التحديثات الجديدة، والكاش للطوارئ فقط.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // الأصول الثابتة (script.js, style.css, manifest.json...): الشبكة أولًا
  // حتى تظهر التحديثات فور توفر الإنترنت، والكاش يُستخدم فقط كاحتياط عند
  // انقطاع الاتصال أو فشل الطلب.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
