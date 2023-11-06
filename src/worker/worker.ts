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


self.addEventListener("install", event => {
    console.log("Service worker installed");
    self.skipWaiting();
});
self.addEventListener("activate", event => {
    console.log("Service worker activated");
});

self.addEventListener("fetch", function(e) {
    const { pathname } = new URL(e.request.url);
    
    const { handler, params } = router.lookup(pathname) ?? defaultHandler;
    e.respondWith(handler(e, params ?? defaultParams));
})
