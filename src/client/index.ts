import * as acorn from "/node_modules/acorn/dist/acorn.mjs";
import * as walk from "/node_modules/acorn-walk/dist/walk.mjs";

import { database as __database } from "../shared/idb.js";

const DYNAMIC_IMPORT_IDENTIFIER = "__import__"; 

const worker = await navigator.serviceWorker.register("/sw.js", {
    type: "module",
    scope: "/",
    updateViaCache: 'none'
})
await navigator.serviceWorker.ready;
const database = await __database;

interface ImportAttributes {
    [key: string]: string;
    type: string;
}

interface ImportOptions<T> {
    /**
     * parent's uuid
     */
    parent?: string;
    /**
     * @deprecated
     */
    assert?: ImportAttributes;
    with?: ImportAttributes;
    resolver?: (specifier: string, base: URL, ctx: T) => any;
    resolverCtx?: T
}

class LoaderMeta {
    resolve() {

    }
}

type CrawlerState = {
    loader: Loader,
    sourceText: string,
    id: string,
    url: URL,
    body: string[],
    children: Promise<Module>[],
    offset: number
}

class Loader {
    constructor() {
        
    }

    static readonly worker = worker;

    private static readonly Crawler = {
        ImportDeclaration(node: acorn.ImportDeclaration, state: CrawlerState) {
            const start = node.source.start + 1;
            const end = node.source.end - 1;
            state.body.push(state.sourceText.substring(state.offset, start), null as any);
            state.offset = end;
            state.children.push(
                state.loader.prepareModule(state.sourceText.substring(start, end), {
                    base: state.url
                })
            );
        },
    
        ImportExpression(node: acorn.ImportExpression, state: CrawlerState) {
            const { start } = node;
            const end = start + 6;
            state.body.push(state.sourceText.substring(state.offset, start), `${DYNAMIC_IMPORT_IDENTIFIER}["${state.id}"]`);
            state.offset = end;
        },
    
        ExportAllDeclaration(node: acorn.ExportAllDeclaration, state: CrawlerState) {
            if (node.source == null) return;
            const start = node.source.start + 1;
            const end = node.source.end - 1;
    
            state.body.push(state.sourceText.substring(state.offset, start), null as any);
            state.offset = end;
            state.children.push(
                state.loader.prepareModule(state.sourceText.substring(start, end), {
                    base: state.url
                })
            );
        },
    
        ExportNamedDeclaration(node: acorn.ExportNamedDeclaration, state: CrawlerState) {
            if (node.source == null) return;
            const start = node.source.start + 1;
            const end = node.source.end - 1;
    
            state.body.push(state.sourceText.substring(state.offset, start), null as any);
            state.offset = end;
            state.children.push(
                state.loader.prepareModule(state.sourceText.substring(start, end), {
                    base: state.url
                })
            );
        },
    }

    private readonly registry = new Map<string, Module>();
    private readonly url2id = new Map<string, string>();

    private readonly prepareModuleWIP = new Map<string, Promise<Module>>();
    private readonly getModuleWIP = new Map<string, Promise<Module | undefined>>();

    async import<C = undefined>(specifier: string, params?: ImportOptions<C>): Promise<unknown> {
        let base = new URL(window.location.href);
        if (params?.parent) {
            const module = await this.getModule(params.parent);
            if (module == undefined) throw new Error(`parent with id ${params.parent} doesn't exists`);
            base = module.url;
        }

        const module = await this.prepareModule(specifier, {
            base: base
        });
        const toCheck = [module];
        const checked = new WeakSet<Module>();

        for (const module of toCheck) {
            if (checked.has(module)) continue;
            await module.ready;
            for (const id of module.dependencies) {
                const dependency = this.registry.get(id);
                if (dependency == undefined) continue;
                if (!checked.has(dependency)) toCheck.push(dependency);
            }
        }
        // debugger
        return import(`/pkg/${module.id}`);
    }

    private getModule(id: string): Promise<Module | undefined> {
        return this.getModulePhaseOne(id);
    }

    private getModulePhaseOne(id: string): Promise<Module | undefined> {
        {
            const module = this.registry.get(id);
            if (module) return Promise.resolve(module);
        }
        {
            const modulePromise = this.getModuleWIP.get(id);
            if (modulePromise) return modulePromise;
        }
        const modulePromise = this.getModulePhaseTwo(id);
        this.getModuleWIP.set(id, modulePromise);
        this.getModuleCleanUp(id, modulePromise);
        return modulePromise;
    }

    private async getModuleCleanUp(id: string, promise: Promise<Module | undefined>) {
        const module = await promise;
        if (module) this.registry.set(id, module);
        this.getModuleWIP.delete(id);
    }

    private async getModulePhaseTwo(id: string): Promise<Module | undefined> {
        const transaction = database.transaction("description", "readonly");
        const store = transaction.objectStore("description");
        const rawModule = await store.get(id);
        if (rawModule) {
            return {
                id: rawModule.id,
                url: new URL(rawModule.url),
                dependencies: rawModule.dependencies,
                ready: Promise.resolve()
            }
        }
    }

    private prepareModule(specifier: string, params: { base: URL }): Promise<Module> {
        return this.prepareModulePhaseOne(specifier, params);
    }

    private prepareModulePhaseOne(specifier: string, params: { base: URL }): Promise<Module> {

        const url = resolveModuleSpecifier(specifier, params.base);

        {
            const id = this.url2id.get(url.href);
            if (id) return Promise.resolve(this.registry.get(id)!);
        }
        {
            const modulePromise = this.prepareModuleWIP.get(url.href);
            if (modulePromise) return modulePromise;
        }
        const modulePromise = this.prepareModulePhaseTwo(url);
        this.prepareModuleWIP.set(url.href, modulePromise);
        this.prepareModuleCleanUp(url.href, modulePromise);
        return modulePromise;
    }

    private async prepareModuleCleanUp(url: string, promise: Promise<Module>) {
        const module = await promise;
        this.registry.set(module.id, module);
        this.url2id.set(url, module.id);
        this.prepareModuleWIP.delete(url);
    }

    private async prepareModulePhaseTwo(url: URL): Promise<Module> {
        {
            const transaction = database.transaction("description", "readonly");
            const store = transaction.objectStore("description");
            const index = store.index("url");
            const rawModule = await index.get(url.href);
            if (rawModule) {
                return {
                    id: rawModule.id,
                    url: new URL(rawModule.url),
                    dependencies: rawModule.dependencies,
                    ready: Promise.resolve()
                }
            }
        }
        return this.createModule(url)
    }

    async createModule(url: URL): Promise<Module> {

        const dependencies: string[] = [];
        const id = crypto.randomUUID();
        return {
            id: id,
            url: url,
            dependencies: dependencies,
            ready: this.loadModule(id, url, dependencies)
        }
    }

    private async loadModule(id: string, url: URL, dependencies: string[]): Promise<void> {
        //#region fetching
        const controller = new AbortController();

        const resp = await fetch(url, {
            signal: controller.signal
        });

        const mime = resp.headers.get("Content-type") ?? "application/octet-stream";
        if (!mime.startsWith("application/javascript")) {
            controller.abort(`Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "${mime}". Strict MIME type checking is enforced for module scripts per HTML spec.`);
            throw new TypeError(`Failed to fetch module: ${url.toString()}`);
        }

        const sourceText = await resp.text();
        //#endregion

        //#region parse
        const ast = parse(sourceText, {
            ecmaVersion: "latest",
            sourceType: "module",
        });

        if (ast === null) throw new Error();
        //#endregion

        //#region collecting children info 
        const state: CrawlerState = {
            url,
            id,
            sourceText,
            loader: this,
            offset: 0,
            body: [],
            children: []
        }
        walk.simple<CrawlerState>(ast, Loader.Crawler, undefined, state);
        state.body.push(state.sourceText.substring(state.offset));
        const { children, body } = state;
        //#endregion

        //#region updating text
        for (let i = 0; i < children.length; i++) {
            const { id } = await children[i];
            body[(i * 2) + 1] = `/pkg/${id}`;
            if (!dependencies.includes(id)) dependencies.push(id);
        }
        //#endregion

        //#region seve to idb
        {
            const transaction = database.transaction(["body", "description"], "readwrite");
            const bodyStore = transaction.objectStore("body");
            const descriptionStore = transaction.objectStore("description");
            await Promise.all([
                descriptionStore.add({
                    id: id,
                    url: url.href,
                    dependencies: dependencies,
                }),
                bodyStore.add({
                    id: id,
                    data: new Blob(body, { type: "application/javascript" })
                })
            ]);
        }
        //#endregion

        return;
    }
}

export const loader = new Loader();

export function dynamicImport<C = undefined>(specifier: string, options: ImportOptions<C> = {}) {
    if (loader === null) throw new Error(`attempt to import ${specifier} before loader initialization`);
    options.parent ??= dynamicImport.context;
    dynamicImport.context = undefined;
    return loader.import(specifier, options)
}
export declare namespace dynamicImport {
    let context: string | undefined;
}

Object.defineProperty(window, DYNAMIC_IMPORT_IDENTIFIER, {
    value: new Proxy(dynamicImport, {
        get(target, key: string, receiver: unknown) {
            if (Object.hasOwn(target, key)) return Reflect.get(target, key, receiver);
            dynamicImport.context = key;
            return dynamicImport;
        }
    }),
    configurable: false,
    writable: false,
    enumerable: false
});

function parse(input: string, options: any) {
    try {
        return acorn.parse(input, options);
    } catch (error) {
        return null;
    }
}

function resolveModuleSpecifier(specifier: string, base: URL): URL {
    return new URL(specifier, base);
}