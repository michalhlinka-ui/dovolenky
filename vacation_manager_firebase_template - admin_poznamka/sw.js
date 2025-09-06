self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('vacay-v8').then(cache => cache.addAll([
    '/', '/index.html', '/styles.css', '/app.js', '/firebase.js'
  ])));
});
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then(resp => resp || fetch(e.request)));
});
