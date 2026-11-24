// Cache pentru funcționare offline pe șantier. Schimbă VERSION la fiecare actualizare a aplicației.
const VERSION = 'jc-v4';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png', 'rotter-logo.svg',
  'fonts/Poppins-Regular.woff', 'fonts/Poppins-Medium.woff', 'fonts/Poppins-Bold.woff'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Google Apps Script merge direct la rețea
  // rețea întâi (ca să vină mereu ultima versiune), cache dacă nu e semnal
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
