// 앱 화면 파일을 저장해 두고, 인터넷이 없어도 열리게 해요. 새 버전이 있으면 네트워크 것을 먼저 써요.
const CACHE = 'todo-cal-v15';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'firebase-config.js', 'gcal.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'img/1.png', 'img/2.png', 'img/3.png', 'img/4.png', 'img/p5-a.png', 'img/p5-b.png', 'img/p6-a.png', 'img/p6-b.png', 'img/p7-a.png', 'img/p7-b.png', 'img/p8-a.png', 'img/p8-b.png', 'img/p9-a.png', 'img/p9-b.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 브라우저 캐시에 남은 예전 파일 대신 항상 서버에서 최신 파일을 확인해요
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
