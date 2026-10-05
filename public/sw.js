const CACHE_NAME = 'uw-accounting-v40';
const DOCUMENT_CACHE = 'uw-accounting-documents-v2';
const APP_SHELL = ['./', './index.html', './css/pricing.css?v=40', './js/pricing-core.js?v=40', './js/fabrics.js?v=40', './js/fabric-picker.js?v=40', './js/pricing.js?v=40', './js/quote-history.js?v=40', './js/document-editor.js?v=40', './js/document-views.js?v=40', './js/quotes.js?v=40', './js/dashboard.js?v=40', './js/suppliers.js?v=40', './js/app-version.js?v=40', './imported-data.js?v=40', './income-2026.js?v=40', './operations-data.js?v=40', './scanned-data.js?v=40', './bank-statements.js?v=40', './manifest.webmanifest', './icon.svg', './uw-round-logo.png', './uw-official-logo.png', './uw-logo.png', './uw-logo-quote.png', './Invoice%20Template.docx', './Quote%20Template.xlsx'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME && key !== DOCUMENT_CACHE).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  const isDocumentRequest = (requestUrl.pathname === '/api/source-file'
    || /^\/api\/documents\/[a-f0-9]{32}$/i.test(requestUrl.pathname)
    || requestUrl.pathname.startsWith('/__source/'));
  if (isDocumentRequest) {
    event.respondWith(caches.open(DOCUMENT_CACHE).then(async cache => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request, { cache: 'default' }).then(response => {
        const type = response.headers.get('content-type') || '';
        if (response.ok && (type.startsWith('application/pdf') || type.startsWith('image/'))) cache.put(event.request, response.clone());
        return response;
      }).catch(() => cached || Response.error());
      const cachedType = cached ? (cached.headers.get('content-type') || '') : '';
      return cached && (cachedType.startsWith('application/pdf') || cachedType.startsWith('image/')) ? cached : network;
    }));
    return;
  }
  if (requestUrl.pathname.startsWith('/api/') || requestUrl.pathname === '/build-info.json') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});
