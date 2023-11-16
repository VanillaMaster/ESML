import * as acorn from "acorn";
import * as walk from "acorn-walk";

import crc32 from "../shared/crc32.js";
import generateUUID, { NameSpace_URL } from "uuidv5"

import { database as __database } from "../shared/idb.js";

import type { Module } from "./types.js";
import type { Loader } from "./Loader.js";

export const DYNAMIC_IMPORT_IDENTIFIER = "__import__"; 
const DECODER_OPTIONS = { stream: true };

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
    private static readonly encoder = new TextEncoder();

    private static readonly Crawler = {
        ImportDeclaration(node: acorn.ImportDeclaration, state: CrawlerState) {
            const start = node.source.start + 1;
            const end = node.source.end - 1;

            const i = state.body.length;
            state.body.length += 2;
            state.body[i] = state.sourceText.substring(state.offset, start);

            state.offset = end;

            state.children.push(
                state.self.resolveAndPrepare(state.sourceText.substring(start, end), state.module.url)
            );
        },

        ImportExpression(node: acorn.ImportExpression, state: CrawlerState) {
            const { start } = node;
            const end = state.sourceText.indexOf("(", start) + 1;
            state.body.push(state.sourceText.substring(state.offset, start), `${DYNAMIC_IMPORT_IDENTIFIER}("${state.module.url.href}",`);
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
                state.self.resolveAndPrepare(state.sourceText.substring(start, end), state.module.url)
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
                state.self.resolveAndPrepare(state.sourceText.substring(start, end), state.module.url)
            );
        },
    };

    constructor(private target: Loader) {
    }

    resolve(specifier: string, parent: string): URL | PromiseLike<URL> {
        return new URL(specifier, parent);
    }

    /**
     * provide an opportunity to override dynamic import call, if bundler mess it up
     * 
     * the easiest option is just use function constructor
     * ```js
     * loader.meta.dynamicImport = new Function("specifier", "options", "return import(specifier, options);");
     * ```
     */
    dynamicImport(specifier: string, options?: ImportCallOptions): Promise<unknown>{
        return import(specifier, options);
    }

    readonly registry = new Map<string, Module>();

    private readonly prepareModuleWIP = new Map<string, Promise<Module>>();
    private readonly getModuleWIP = new Map<string, Promise<Module | undefined>>();

    getModule(url: URL | string) {
        if (url instanceof URL) ({href: url} = url);
        return this.getModulePhaseOne(url)
    }

    private getModulePhaseOne(url: string): Promise<Module | undefined> {
        {
            const module = this.registry.get(url);
            if (module) return Promise.resolve(module);
        }
        {
            const modulePromise = this.getModuleWIP.get(url);
            if (modulePromise) return modulePromise;
        }
        const modulePromise = this.getModulePhaseTwo(url);
        this.getModuleWIP.set(url, modulePromise);
        this.getModuleCleanUp(url, modulePromise);
        return modulePromise;
    }

    private async getModuleCleanUp(url: string, promise: Promise<Module | undefined>) {
        const module = await promise;
        if (module) this.registry.set(url, module);
        this.getModuleWIP.delete(url);
    }

    private async getModulePhaseTwo(url: string): Promise<Module | undefined> {
        const transaction = database.transaction("description", "readonly");
        const store = transaction.objectStore("description");
        const rawModule = await store.get(url);
        if (rawModule) {
            return {
                url: new URL(rawModule.url),
                uuid: rawModule.uuid,
                dependencies: rawModule.dependencies,
                ready: Promise.resolve()
            };
        }
    }

    async resolveAndPrepare(specifier: string, parent: URL | string): Promise<Module> {
        if (parent instanceof URL) ({href: parent} = parent);
        const url = await this.resolve(specifier, parent);
        return this.prepareModule(url, parent);
    }

    prepareModule(url: URL | string, parent: URL | string | null): Promise<Module> {
        if (url instanceof URL) ({href: url} = url);
        if (parent instanceof URL) ({href: parent} = parent);
        return this.prepareModulePhaseOne(url, parent);
    }

    private prepareModulePhaseOne(url: string, parent: string | null): Promise<Module> {

        {
            const module = this.registry.get(url);
            if (module) return Promise.resolve(module);
        }
        {
            const modulePromise = this.prepareModuleWIP.get(url);
            if (modulePromise) return modulePromise;
        }
        const modulePromise = this.prepareModulePhaseTwo(url);
        this.prepareModuleWIP.set(url, modulePromise);
        this.prepareModuleCleanUp(url, modulePromise);
        return modulePromise;
    }

    private async prepareModuleCleanUp(url: string, promise: Promise<Module>) {
        const module = await promise;
        this.registry.set(url, module);
        this.prepareModuleWIP.delete(url);
    }

    private async prepareModulePhaseTwo(url: string): Promise<Module> {
        {
            const transaction = database.transaction("description", "readonly");
            const store = transaction.objectStore("description");
            const rawModule = await store.get(url);
            if (rawModule) {
                return {
                    url: new URL(rawModule.url),
                    uuid: rawModule.uuid,
                    dependencies: rawModule.dependencies,
                    ready: Promise.resolve()
                };
            }
        }
        return this.createModule(url);
    }

    async createModule(url: string): Promise<Module> {

        const dependencies: string[] = [];
        const uuid = await generateUUID(LoaderMeta.encoder.encode(url), NameSpace_URL);
        const module: Module = {
            uuid: uuid,
            url: new URL(url),
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
        const contentLength = Number.parseInt(resp.headers.get("Content-Length")!);
        if (contentLength < 0 || Number.isNaN(contentLength)) {
            controller.abort();
            throw new Error("internal error");
        }
        if (resp.body == null) {
            controller.abort();
            throw new Error("internal error");
        }
        if (!mime.startsWith("application/javascript")) {
            controller.abort(`Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "${mime}". Strict MIME type checking is enforced for module scripts per HTML spec.`);
            throw new TypeError(`Failed to fetch module: ${module.url.toString()}`);
        }

        const decoder = new TextDecoder();
        const reader = resp.body.getReader();
        const sourceTextChunks: string[] = [];
        let crc: number = <any>undefined;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sourceTextChunks.push(decoder.decode(value, DECODER_OPTIONS));
            crc = crc32(value, crc);
        }
        sourceTextChunks.push(decoder.decode());

        const sourceText = sourceTextChunks.join("");
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
            const { url: { href: url }, uuid } = await children[j++];
            body[i] = `/pkg/${uuid}`;
            if (!module.dependencies.includes(url)) module.dependencies.push(url);
        }
        //#endregion

        //#region seve to idb
        {
            const transaction = database.transaction(["body", "description"], "readwrite");
            const bodyStore = transaction.objectStore("body");
            const descriptionStore = transaction.objectStore("description");
            await Promise.all([
                descriptionStore.add({
                    url: module.url.href,
                    uuid: module.uuid,
                    dependencies: module.dependencies,
                }),
                bodyStore.add({
                    uuid: module.uuid,
                    crc: crc,
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