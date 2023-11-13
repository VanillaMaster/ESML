import { LoaderMeta } from "./LoaderMeta.js";

import type { Module } from "./types.js";

const DYNAMIC_IMPORT_IDENTIFIER = "__import__"; 

const worker = await navigator.serviceWorker.register("/sw.js", {
    type: "module",
    scope: "/",
    updateViaCache: 'none'
})
await navigator.serviceWorker.ready;


interface ImportAttributes {
    [key: string]: string;
    type: string;
}

interface ImportOptions {
    /**
     * parent's uuid
     */
    parent?: string;
    /**
     * @deprecated
     */
    assert?: ImportAttributes;
    with?: ImportAttributes;
}

export class Loader extends EventTarget {
    constructor() {
        super()
    }

    static readonly worker = worker;

    readonly meta = new LoaderMeta();

    async import(specifier: string, options?: ImportOptions): Promise<unknown> {
        let base = new URL(window.location.href);
        let parent: Module | null = null;
        if (options?.parent) {
            const module = await this.meta.getModule(options.parent);
            if (module == undefined) throw new Error(`parent with id ${options.parent} doesn't exists`);
            parent = module;
            base = module.url;
        }

        const module = await this.meta.prepareModule(specifier, base, parent);
        const toCheck = [module];
        const checked = new WeakSet<Module>();

        for (const module of toCheck) {
            if (checked.has(module)) continue;
            await module.ready;
            for (const id of module.dependencies) {
                const dependency = this.meta.registry.get(id);
                if (dependency == undefined) continue;
                if (!checked.has(dependency)) toCheck.push(dependency);
            }
        }
        // debugger
        return import(`/pkg/${module.id}`);
    }

}

export const loader = new Loader();

function dynamicImport(caller: string, specifier: string, options: ImportOptions = {}) {
    options.parent = caller;
    return loader.import(specifier, options)
}

// export function dynamicImport(specifier: string, options: ImportOptions = {}) {
//     if (loader === null) throw new Error(`attempt to import ${specifier} before loader initialization`);
//     options.parent ??= dynamicImport.context;
//     dynamicImport.context = undefined;
//     return loader.import(specifier, options)
// }
// export declare namespace dynamicImport {
//     let context: string | undefined;
// }

Object.defineProperty(window, DYNAMIC_IMPORT_IDENTIFIER, {
    value: dynamicImport,
    configurable: false,
    writable: false,
    enumerable: false
});