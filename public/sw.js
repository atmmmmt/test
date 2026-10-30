/* Offline-ready shell. All app files are cached during the first online visit. */
const CACHE="umrah-live-v2";
const SHELL=["/","/manifest.webmanifest","/icons/icon-192.png","/icons/icon-512.png"];
self.addEventListener("install",event=>{
 event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
 event.waitUntil(Promise.all([
   caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),
   self.clients.claim()
 ]));
});
self.addEventListener("fetch",event=>{
 const req=event.request;
 if(req.method!=="GET"||new URL(req.url).origin!==self.location.origin)return;
 event.respondWith((async()=>{
   const cache=await caches.open(CACHE);
   if(req.mode==="navigate"){
     try{const fresh=await fetch(req);if(fresh.ok)await cache.put(req,fresh.clone());return fresh;}
     catch{return await cache.match(req)||await cache.match("/")||Response.error();}
   }
   const old=await cache.match(req);if(old)return old;
   try{const fresh=await fetch(req);if(fresh.ok)await cache.put(req,fresh.clone());return fresh;}
   catch{return Response.error();}
 })());
});
