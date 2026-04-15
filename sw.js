/**
 * QuizOpus Service Worker
 * 静的アセットのキャッシュとオフラインフォールバックを提供。
 * REST API通信はキャッシュしない（常にライブデータを使用）。
 */

const CACHE_NAME = 'quizopus-v4';
const STATIC_ASSETS = [
    'css/design_system.css',
    'js/config.js',
    'js/crypto.js',
    'js/shared.js',
    'favicon.png',
    '404.html',
];

// インストール時に静的アセットをプリキャッシュ
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// 古いキャッシュをクリーンアップ
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) => {
            return Promise.all(
                names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
            );
        })
    );
    self.clients.claim();
});

// フェッチ戦略: Network First (with cache fallback for static assets)
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Firebase REST API やGASはキャッシュしない
    if (url.hostname.includes('firebasedatabase') ||
        url.hostname.includes('firebasestorage') ||
        url.hostname.includes('googleapis') ||
        url.hostname.includes('google.com')) {
        return;
    }

    // 外部CDN（fonts, FA等）もネットワーク優先
    if (url.origin !== self.location.origin) {
        event.respondWith(
            fetch(event.request).catch(() => caches.match(event.request))
        );
        return;
    }

    // ローカルアセット: Network first, cache fallback
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // レスポンスをキャッシュに保存
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            })
            .catch(() => {
                return caches.match(event.request).then((cached) => {
                    // HTMLリクエストでキャッシュがなければ404ページを返す
                    if (!cached && event.request.headers.get('Accept')?.includes('text/html')) {
                        return caches.match('404.html');
                    }
                    return cached;
                });
            })
    );
});
