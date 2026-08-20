const CACHE_NAME = 'flashcards-v1.4.3';
// ملفات أساسية: التطبيق لا يعمل offline بدونها إطلاقًا
const CRITICAL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json'
];
// ملفات اختيارية (أيقونات): لو مش موجودة أو فشل تحميلها لا نوقف تثبيت
// الـ Service Worker بالكامل بسببها. هذا هو السبب الأكثر ترجيحًا لعدم عمل
// أي تخزين offline إطلاقًا: cache.addAll() تفشل بالكامل (all-or-nothing)
// لو ملف واحد فقط منها 404 (مثل أيقونة ناقصة)، فلا يُخزَّن حتى index.html/script.js.
const OPTIONAL_ASSETS = [
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // نحاول تخزين كل ملف أساسي على حدة (وليس addAll) حتى لو ملف واحد فشل
      // لا يمنع باقي الملفات الأساسية من التخزين.
      await Promise.all(
        CRITICAL_ASSETS.map(url => cache.add(url).catch(err => {
          console.warn('[SW] فشل تخزين ملف أساسي:', url, err);
        }))
      );
      // الأيقونات: نتجاهل أي فشل تمامًا بدون التأثير على باقي التثبيت.
      await Promise.all(
        OPTIONAL_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    })
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

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

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

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
