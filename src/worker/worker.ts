import { database } from "../shared/idb.js"
import { createRouter } from "/node_modules/radix3/dist/index.mjs";

declare var self: ServiceWorkerGlobalScope;

type handler = (e: FetchEvent, params: Record<string, string>) => Promise<Response>

const router = createRouter<{ handler: handler }>();

const defaultParams = {};
const defaultHandler = {
    handler: function defaultHandler(e: FetchEvent) {
        return fetch(e.request);
    },
    params: defaultParams
}

router.insert("/pkg/:uuid", {
    handler: async function (e, params) {
        if (e.request.method !== "GET")
            return new Response(null, { status: 403 });
        const db = await database;
        const { uuid } = params;
        const transaction = db.transaction("body", "readonly");
        const store = transaction.objectStore("body");
        const resp = await store.get(uuid);
        
        if (resp) return new Response(resp.data, { status: 200 });
        return new Response(null, { status: 404 });
    }
})

self.addEventListener("fetch", function(e) {
    const { pathname } = new URL(e.request.url);
    // console.log("fetch", pathname);
    // e.stopImmediatePropagation();
    // e.respondWith(fromCache(e.request));
    const { handler, params } = router.lookup(pathname) ?? defaultHandler;
    e.respondWith(handler(e, params ?? defaultParams));
})

// async function fromCache(request: Request): Promise<Response> {
//     const cache = await caches.open("pkg/src");
//     const resp = await cache.match(request);
//     if (resp) return resp;
//     return fetch(request);
// }


self.addEventListener('install', function(event) {
    console.log("Service worker installed");
    event.waitUntil(self.skipWaiting()); // Activate worker immediately
});

self.addEventListener('activate', function(event) {
    console.log("Service worker activated");
    event.waitUntil(self.clients.claim()); // Become available to all pages
});

self.addEventListener("push", function(event) {
    console.log(event, event.data?.text());
    const text = event.data?.text() ?? "unknown";
    self.registration.showNotification(text, {
        body: "body"
    });
})