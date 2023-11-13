import * as acorn from "/node_modules/acorn/dist/acorn.mjs";
import * as walk from "/node_modules/acorn-walk/dist/walk.mjs";

import { database as __database } from "../shared/idb.js";

import type { Module } from "./types.js";

const DYNAMIC_IMPORT_IDENTIFIER = "__import__"; 

const database = await __database;

function parse(input: string, options: any) {
    try {
        return acorn.parse(input, options);
    } catch (error) {
        return null;
    }
}

type CrawlerState = {
    self: LoaderMeta,
    sourceText: string,
    module: Module,
    body: string[],
    children: Promise<Module>[],
    offset: number
}

export class LoaderMeta {

    private static readonly Crawler = {
        ImportDeclaration(node: acorn.ImportDeclaration, state: CrawlerState) {
            const start = node.source.start + 1;
            const end = node.source.end - 1;

            const i = state.body.length;
            state.body.length += 2;
            state.body[i] = state.sourceText.substring(state.offset, start);

            state.offset = end;

            state.children.push(
                state.self.prepareModule(state.sourceText.substring(start, end), state.module.url, state.module)
            );
        },

        ImportExpression(node: acorn.ImportExpression, state: CrawlerState) {
            const { start } = node;
            const end = state.sourceText.indexOf("(", start) + 1;
            state.body.push(state.sourceText.substring(state.offset, start), `${DYNAMIC_IMPORT_IDENTIFIER}("${state.module.id}", `);
            state.offset = end;
        },

        ExportAllDeclaration(node: acorn.ExportAllDeclaration, state: CrawlerState) {
            if (node.source == null) return;
            const start = node.source.start + 1;
            const end = node.source.end - 1;

            const i = state.body.length;
            state.body.length += 2;
            state.body[i] = state.sourceText.substring(state.offset, start);

            state.offset = end;
            
            state.children.push(
                state.self.prepareModule(state.sourceText.substring(start, end), state.module.url, state.module)
            );
        },

        ExportNamedDeclaration(node: acorn.ExportNamedDeclaration, state: CrawlerState) {
            if (node.source == null) return;
            const start = node.source.start + 1;
            const end = node.source.end - 1;

            const i = state.body.length;
            state.body.length += 2;
            state.body[i] = state.sourceText.substring(state.offset, start);

            state.offset = end;
            
            state.children.push(
                state.self.prepareModule(state.sourceText.substring(start, end), state.module.url, state.module)
            );
        },
    };

    constructor() {
    }

    resolve(specifier: string, base: URL, parent: Module | null): URL | PromiseLike<URL> {
        return new URL(specifier, base);
    }

    readonly registry = new Map<string, Module>();
    readonly url2id = new Map<string, string>();

    private readonly prepareModuleWIP = new Map<string, Promise<Module>>();
    private readonly getModuleWIP = new Map<string, Promise<Module | undefined>>();

    getModule(id: string): Promise<Module | undefined> {
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
            };
        }
    }

    prepareModule(specifier: string, base: URL, parent: Module | null): Promise<Module> {
        return this.prepareModulePhaseOne(specifier, base, parent);
    }

    private async prepareModulePhaseOne(specifier: string, base: URL, parent: Module | null): Promise<Module> {

        const url = await this.resolve(specifier, base, parent);

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
                };
            }
        }
        return this.createModule(url);
    }

    async createModule(url: URL): Promise<Module> {

        const dependencies: string[] = [];
        const id = crypto.randomUUID();
        const module: Module = {
            id: id,
            url: url,
            dependencies: dependencies,
            ready: new Promise<void>(executor),
        }
        const load = this.loadModule(module);
        load.then(executor.resolve);
        load.catch(executor.reject);
        return module
    }

    private async loadModule(module: Module): Promise<void> {
        //#region fetching
        const controller = new AbortController();

        const resp = await fetch(module.url, {
            signal: controller.signal
        });

        const mime = resp.headers.get("Content-type") ?? "application/octet-stream";
        if (!mime.startsWith("application/javascript")) {
            controller.abort(`Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "${mime}". Strict MIME type checking is enforced for module scripts per HTML spec.`);
            throw new TypeError(`Failed to fetch module: ${module.url.toString()}`);
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
            module: module,
            self: this,
            sourceText,
            offset: 0,
            body: [],
            children: []
        };
        walk.simple<CrawlerState>(ast, LoaderMeta.Crawler, undefined, state);
        state.body.push(state.sourceText.substring(state.offset));
        const { children, body } = state;
        //#endregion
        //#region updating text
        for (let i = 0, j = 0; i < body.length; i++) {
            if (body[i] != undefined) continue;
            const { id } = await children[j++];
            body[i] = `/pkg/${id}`;
            if (!module.dependencies.includes(id)) module.dependencies.push(id);
        }
        //#endregion
        //#region seve to idb
        {
            const transaction = database.transaction(["body", "description"], "readwrite");
            const bodyStore = transaction.objectStore("body");
            const descriptionStore = transaction.objectStore("description");
            await Promise.all([
                descriptionStore.add({
                    id: module.id,
                    url: module.url.href,
                    dependencies: module.dependencies,
                }),
                bodyStore.add({
                    id: module.id,
                    data: new Blob(body, { type: "application/javascript" })
                })
            ]);
        }
        //#endregion
        return;
    }
}

function executor<T>(resolve: (value: T) => void, reject: (reason?: any) => void): void {
    executor.resolve = resolve; executor.reject = reject;
}
declare namespace executor {
    let resolve: (value: any) => void;
    let reject: (reason?: any) => void;
}