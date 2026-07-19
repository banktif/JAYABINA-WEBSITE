// JAYACLEAN — Service Worker (network-first so updates show immediately; cache = offline fallback)
var CACHE='jayaclean-v3';
var FILES=[
  '/','/index.html','/success.html','/test-pay.html',
  '/admin/','/worker/','/customer/','/login/',
  '/theme.css','/manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  'https://unpkg.com/lucide@latest/dist/umd/lucide.min.js',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'
];

self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(FILES).catch(function(){})}));
  self.skipWaiting();
});

self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==CACHE}).map(function(k){return caches.delete(k)}));
  }));
  self.clients.claim();
});

// Network-first: always try network (fresh), update cache, fall back to cache when offline.
self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET')return;
  e.respondWith(
    fetch(e.request).then(function(res){
      if(res&&res.status===200&&(e.request.url.indexOf('http')===0)){
        var clone=res.clone();
        caches.open(CACHE).then(function(c){c.put(e.request,clone)});
      }
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(c){return c||new Response('Offline',{status:503});});
    })
  );
});
