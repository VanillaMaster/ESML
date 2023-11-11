import { database } from "../shared/idb.js"
import { type RadixRouter, createRouter } from "/node_modules/radix3/dist/index.mjs";

declare var self: ServiceWorkerGlobalScope;

type handler = (e: FetchEvent, params: Record<string, string>) => void;

class Router {
    private static readonly paramsEmptyDummy = Object.freeze({});
    private readonly hosts: Record<string, Record<string, RadixRouter<{ handler: handler }>>> = {};

    insert(hostname: string, method: string, path: string, handler: handler): void {
        const trees = this.hosts[hostname] ?? (this.hosts[hostname] = {});
        const tree = trees[method] ?? (trees[method] = createRouter());
        tree.insert(path, { handler });
    }
    lookup(e: FetchEvent): void {
        const { hostname, pathname } = new URL(e.request.url);
        const data = this.hosts[hostname]?.[e.request.method]?.lookup(pathname);
        if (data) data.handler(e, data.params ?? Router.paramsEmptyDummy);
    }
    remove(hostname: string, method: string, path: string): boolean {
        return this.hosts[hostname]?.[method]?.remove(path);
    }
}

const router = new Router();

router.insert(self.location.hostname, "GET", "/pkg/:uuid", function (e, params) {
    const { uuid } = params;
    e.respondWith(handlePkg(uuid));
})

async function handlePkg(uuid: string): Promise<Response> {
    const db = await database;
    const transaction = db.transaction("body", "readonly");
    const store = transaction.objectStore("body");
    const resp = await store.get(uuid);
    
    if (resp) return new Response(resp.data, { status: 200 });
    return new Response(null, { status: 404 });
}

self.addEventListener("fetch", function(e) {

    router.lookup(e);
})

self.addEventListener("push", function(event) {
    console.log(event, event.data?.text());
    const text = event.data?.text() ?? "unknown";
    self.registration.showNotification(text, {
        body: "body"
    });
})