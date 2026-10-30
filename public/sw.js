/* Cache the offline coordination guide and static assets while online. */
const CACHE="umrah-live-v4";
const SHELL=["/","/manifest.webmanifest","/icons/icon-192.png","/icons/icon-512.png"];
self.addEventListener("install",event=>{
 event.waitUntil((async()=>{
   const c=await caches.open(CACHE);
   await c.addAll(SHELL);
   // Next.js JS/CSS must also be cached before the first fully offline launch.
   try{
     const html=await (await c.match("/")).text();
     const assets=[...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map(x=>x[1].replaceAll("&amp;","&"));
     await Promise.allSettled([...new Set(assets)].map(url=>c.add(url)));
   }catch(e){ /* do not block install; verify offline before travel */ }
   await self.skipWaiting();
 })());
});
self.addEventListener("activate",event=>{
 event.waitUntil(Promise.all([
   caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),
   self.clients.claim()
 ]));
});
self.addEventListener("fetch",event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=="GET"||url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;
 event.respondWith((async()=>{
   const c=await caches.open(CACHE);
   if(req.mode==="navigate"){
     try{const response=await fetch(req);if(response.ok)await c.put(req,response.clone());return response;}
     catch{return await c.match(req)||await c.match("/")||Response.error();}
   }
   const old=await c.match(req);
   if(old)return old;
   try{const response=await fetch(req);if(response.ok)await c.put(req,response.clone());return response;}
   catch{return Response.error();}
 })());
});
