const CACHE_NAME = 'uw-accounting-v47';
const DOCUMENT_CACHE = 'uw-accounting-documents-v2';
const APP_SHELL = ['./', './index.html', './css/documents.css?v=47', './css/pricing.css?v=47', './js/pricing-core.js?v=47', './js/fabrics.js?v=47', './item-presets.js?v=47', './js/item-presets.js?v=47', './js/document-lines.js?v=47', './js/fabric-picker.js?v=47', './js/pricing.js?v=47', './js/quote-history.js?v=47', './js/document-numbers.js?v=47', './js/imported-quotes.js?v=47', './js/document-editor.js?v=47', './js/document-format.js?v=47', './js/local-recovery.js?v=47', './js/document-views.js?v=47', './js/quotes.js?v=47', './js/dashboard.js?v=47', './js/suppliers.js?v=47', './js/app-version.js?v=47', './js/shared-sync.js?v=47', './imported-data.js?v=47', './income-2026.js?v=47', './operations-data.js?v=47', './scanned-data.js?v=47', './bank-statements.js?v=47', './manifest.webmanifest', './icon.svg', './uw-round-logo.png', './uw-document-logo.png', './uw-official-logo.png', './uw-logo.png', './uw-logo-quote.png', './Invoice%20Template.docx', './Quote%20Template.xlsx'];

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
  if (requestUrl.origin !== self.location.origin) return;
  const isDocumentRequest = (requestUrl.pathname === '/api/source-file'
    || /^\/api\/documents\/[a-f0-9]{32}$/i.test(requestUrl.pathname)
    || requestUrl.pathname.startsWith('/__source/'));
  if (isDocumentRequest) {
    event.respondWith(caches.open(DOCUMENT_CACHE).then(async cache => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request, { cache: 'default' }).then(response => {
        const type = response.headers.get('content-type') || '';
        if (response.ok && (type.startsWith('application/pdf') || type.startsWith('image/'))) cache.put(event.request, response.clone()).catch(()=>{});
        return response;
      }).catch(() => cached || Response.error());
      const cachedType = cached ? (cached.headers.get('content-type') || '') : '';
      return cached && (cachedType.startsWith('application/pdf') || cachedType.startsWith('image/')) ? cached : network;
    }));
    return;
  }
  if (requestUrl.pathname.startsWith('/api/') || requestUrl.pathname === '/build-info.json') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(()=>new Response(JSON.stringify({error:'The local server is unavailable. Your unsynced work is retained; reconnect the local server to save.'}),{status:503,headers:{'Content-Type':'application/json'}})));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      if(response.ok)caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(()=>{});
      return response;
    }).catch(async () => event.request.mode==='navigate' ? await caches.match('./index.html') || Response.error() : Response.error()))
  );
});
