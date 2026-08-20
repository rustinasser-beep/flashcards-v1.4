const CACHE_NAME = 'flashcards-v1.4.3';
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
  // لا نستخدم skipWaiting هنا عمدًا: نترك النسخة الجديدة "منتظرة" ولا نفعّلها
  // فورًا حتى لو كان هناك اتصال بالإنترنت وتحديث جديد. هذا يضمن أن التطبيق
  // المفتوح حاليًا (وأي جلسة حفظني/اختبار نشطة) لا يتأثر إطلاقًا ولا يُعاد
  // تحميله فجأة من تحت المستخدم. التحديث سيُطبَّق تلقائيًا وبأمان في المرة
  // القادمة التي يُفتح فيها التطبيق من جديد (بعد إغلاق كل التبويبات القديمة) —
  // وبيانات localStorage لا تتأثر بهذا إطلاقًا في كل الأحوال.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
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
