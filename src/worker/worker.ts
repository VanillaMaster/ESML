import { dbPromise } from "../shared/idb.js"

let db: Awaited<typeof dbPromise>;

declare var self: ServiceWorkerGlobalScope;

console.log(self);

self.addEventListener("install", event => {
    console.log("Service worker installed");
});
self.addEventListener("activate", event => {
    console.log("Service worker activated");
    console.log('Claiming control');
});

const prefix = `${self.location.origin}/pkg/`;

self.addEventListener("fetch", function(e) {
    e.respondWith((async()=>{
        // console.log(e.request.url);
        // e.respondWith(fetch(e.request));
        // return;
        if (e.request.method === "GET" && e.request.url.startsWith(prefix)) {
            console.log("cache:", e.request.url);
            const db = await dbPromise;
            const uuid = e.request.url.substring(prefix.length);
            const transaction = db.transaction("body", "readonly");
            const store = transaction.objectStore("body");
            const resp = await store.get(uuid);
            console.log(uuid, resp);
            if (resp) {
                return new Response(resp.data, {
                    status: 200,
                })
            } else {
                return new Response(null, {
                    status: 404
                })
            }
        } else {
            console.log("default:", e.request.url);
            return fetch(e.request)
        }
        
    })());
})
