import * as acorn from "../../lib/acorn.mjs";
import * as walk from "../../lib/walk.mjs";

import { db, uuid } from "../shared/idbSync.js"


Object.defineProperty(window, "__import__", { value: new Proxy({}, {
    get(target, key: uuid) {
        console.log(key);
        return function(specifier: string){
            return loader.import(specifier, {
                parent: key,
            })
        }
    }
}) });

type Module = {
    id: uuid;
    url: URL;
    dependencies: Module[];
    ready: Promise<void>;
}

function exception(message?: string | undefined, options?: ErrorOptions | undefined): never {
    debugger
    throw new Error(message, options);
}

type importOptions = {
    parent?: uuid
}

export class Loader {
    private constructor(registryInit: Map<string, Module>) {
        this.registry = registryInit;
    }

    private registry;

    static async new() {
        const registryInit = new Map<string, Module>();
        const index = new Map<uuid, Module>();

        const transaction = db.transaction("description", "readonly");
        const store = transaction.objectStore("description");
        const resp = await store.getAll();
        for (const entry of resp) {
            index.set(entry.id, {
                id: entry.id,
                url: new URL(entry.url),
                dependencies: [],
                ready: Promise.resolve()
            })
        }
        for (const entry of resp) {
            const module = index.get(entry.id) ?? exception("invalid id");
            module.dependencies.push( ...(entry.dependencies.map( id => index.get(id) ?? exception("invalid id"))) );
            registryInit.set(entry.url, module);
        }
        const instance = new Loader(registryInit);
        // debugger
        return instance;
    }

    async import(specifier: string, params?: importOptions): Promise<unknown> {
        let url = window.location.href;
        if (params?.parent) {
            const parent = this.registry.get(params.parent);
            if (parent) url = parent.url.href;
        }

        const module = await this.prepareModule(specifier, {
            parent: new URL(url)
        });
        const toCheck = [module];
        const checked = new Set<Module>();

        for (const module of toCheck) {
            if (checked.has(module)) continue;
            await module.ready;
            for (const dependency of module.dependencies) if (!checked.has(dependency)) toCheck.push(dependency);
        }
        // debugger;
        return import(`/pkg/${module.id}`);
        return;
    }

    private prepareModule(specifier: string, params: { parent: URL }): Promise<Module> {
        return new Promise(async (resolve) => {
            const url = new URL(specifier, params.parent);
            console.log(url.toString());
            //#region early return
            {
                const module = this.registry.get(url.href);
                if (module) {
                    resolve(module)
                    return;
                }
            }
            //#endregion
            
            //#region module creation
            const ready = {} as {
                resolve: (value: void | PromiseLike<void>) => void;
                reject: (reason?: any) => void;
            };
            
            const module: Module = {
                id: crypto.randomUUID(),
                url: url,
                dependencies: [],
                ready: new Promise(function(resolve, reject){ ready.resolve = resolve; ready.reject = reject; }),
            }
            this.registry.set(url.href, module);
            resolve(module);
            //#region 
            
            //#region fetching
            const controller = new AbortController();
    
            const resp = await fetch(url, {
                signal: controller.signal
            });
    
            const mime = resp.headers.get("Content-type") ?? "application/octet-stream";
            if (!mime.startsWith("application/javascript")) {
                controller.abort(`Failed to fetch dynamically imported module: ${url}`);
                ready.reject(`Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "${mime}". Strict MIME type checking is enforced for module scripts per HTML spec.`)
                return;
            }
    
            const sourceText = await resp.text();
            //#endregion
            
            //#region parse
            const ast = await parse(sourceText, {
                ecmaVersion: "latest",
                sourceType: "module",
            });
            
            if (ast === null) throw new Error();
            //#endregion
            
            //#region collecting children info 
            let offset = 0;
            const body: Array<string> = [];
    
            const dependencies: Promise<Module>[] = [];
            walk.simple(ast, {
                ImportDeclaration: (node) => {
                    const start = node.source.start + 1;
                    const end = node.source.end - 1;
                    body.push(sourceText.substring(offset, start), null as any);
                    offset = end;
                    dependencies.push(
                        this.prepareModule(sourceText.substring(start, end), {
                            parent: url
                        })
                    );
                    // dependencies.push()
                    // debugger
                },
                ImportExpression: (node) => {
                    const { start } = node;
                    const end = start + 6;
                    body.push(sourceText.substring(offset, start), `__import__["${module.id}"]`);
                    offset = end;
                    console.log(start, start + 6, sourceText.substring(start, end));
                    // debugger
                },
                ExportAllDeclaration: (node) => {
                    if (node.source == null) return;
                    const start = node.source.start + 1;
                    const end = node.source.end - 1;

                    body.push(sourceText.substring(offset, start), null as any);
                    offset = end;
                    dependencies.push(
                        this.prepareModule(sourceText.substring(start, end), {
                            parent: url
                        })
                    );
                },
                ExportNamedDeclaration: (node) => {
                    if (node.source == null) return;
                    const start = node.source.start + 1;
                    const end = node.source.end - 1;

                    body.push(sourceText.substring(offset, start), null as any);
                    offset = end;
                    dependencies.push(
                        this.prepareModule(sourceText.substring(start, end), {
                            parent: url
                        })
                    );
                }
            })
            body.push(sourceText.substring(offset))
            //#endregion
            debugger
            const children = await Promise.all(dependencies);

            //#region updating text;
            for (let i = 0; i < children.length; i++) {
                const module = children[i];
                body[(i * 2) + 1] = `/pkg/${module.id}`;
                if (!module.dependencies.includes(module)) module.dependencies.push(module);
            }
            //#endregion
            
            //#region seve to idb
            {
                const transaction = db.transaction(["body", "description"], "readwrite");
                const bodyStore = transaction.objectStore("body");
                const descriptionStore = transaction.objectStore("description");
                await Promise.all([
                    descriptionStore.add({
                        id: module.id,
                        url: module.url.href,
                        dependencies: module.dependencies.map(module => module.id),
                    }),
                    bodyStore.add({
                        id: module.id,
                        data: new Blob(body, { type: "application/javascript" })
                    })
                ])
                debugger
            }
            //#region 

            ready.resolve();
        })
    }
}


async function parse(input: string, options: any) {
    try {
        return acorn.parse(input, options);
    } catch (error) {
        return null;
    }
}

export const loader = await Loader.new();

// (async function() {
//     const loader = new Loader();
//     console.log(loader);
//     const module = await loader.import("./a.js");
//     console.log(module);
// })()

const worker = await navigator.serviceWorker.register("/sw.js", {
    type: "module",
    scope: "/",
    updateViaCache: 'none'
})

console.log(worker);
