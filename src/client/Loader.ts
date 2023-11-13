import { LoaderMeta } from "./LoaderMeta.js";

import type { Module } from "./types.js";

// const worker = await navigator.serviceWorker.register("/sw.js", {
//     type: "module",
//     scope: "/",
//     updateViaCache: 'none'
// })
// await navigator.serviceWorker.ready;


export interface ImportAttributes {
    [key: string]: string;
    type: string;
}

export interface ImportOptions {
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

    // static readonly worker = worker;

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