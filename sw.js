// Cache exclusivo da homologação V3.0. Não remove o cache da V2.9.
const SCOPE_PATH=new URL(self.registration.scope).pathname;
const CACHE='pepday-v3-b1-gate-hardening-'+SCOPE_PATH;
const ASSETS=['./','./index.html','./style.css','./account.css','./app.js',
  './manifest.json','./icon.svg','./config.js','./src/account-ui.mjs','./src/entitlement.mjs','./src/access-control.mjs','./src/pro-gate.mjs',
  './src/import-completion.mjs','./src/account.mjs','./src/cloud.mjs','./src/legacy-import.mjs',
  './vendor/supabase-2.116.0.js'];
const PUBLIC_ASSETS=new Set(ASSETS.map(path=>new URL(path,self.registration.scope).href));
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'}))))
    .then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(names=>Promise.all(names
    .filter(name=>name!==CACHE&&name.startsWith('pepday-v3-')&&name.endsWith(SCOPE_PATH))
    .map(name=>caches.delete(name))))
    .then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url), scope=new URL(self.registration.scope);
  // Auth, API e conteúdo privado nunca entram no cache da aplicação.
  if(url.origin!==scope.origin || url.search || request.headers.has('Authorization'))return;
  if(request.mode==='navigate' && PUBLIC_ASSETS.has(url.href)){
    event.respondWith(fetch(request).catch(()=>caches.open(CACHE).then(cache=>cache.match('./index.html'))));
  }else if(PUBLIC_ASSETS.has(url.href)){
    event.respondWith(caches.open(CACHE).then(cache=>cache.match(request)).then(hit=>hit||fetch(request)));
  }
});
