/* 火柴人剑斗 —— Service Worker
 *
 * 目的：让 iOS / Android 把游戏「装到主屏」后彻底离线可玩。
 * 策略：app shell 预缓存 + 缓存优先（游戏是纯静态资源，不需要网络）。
 * 版本号改了才会清旧缓存 —— 更新游戏时记得改 CACHE_VERSION。
 */
const CACHE_VERSION = 'stick-boss-v1';
const CACHE_NAME = CACHE_VERSION;

// 需要离线可用的文件清单（相对路径，配合 scope）
const ASSETS = [
  './',
  './index.html',
  './game.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 只接管自己域名下的资源
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // 顺手把新资源写进缓存（例如以后再追加的图片）
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => {
        // 离线且没缓存：导航请求回退到 index.html
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
