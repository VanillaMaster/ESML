import { LoaderMeta } from "./LoaderMeta.js";

import type { Module } from "./types.js";

export interface ImportAttributes {
    [key: string]: string;
    type: string;
}

export interface ImportOptions {
    /**
     * parent's url
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

    readonly meta = new LoaderMeta(this);

    async import(specifier: string, options?: ImportOptions): Promise<unknown> {
        let parent = options?.parent ?? window.location.href;

        const module = await this.meta.resolveAndPrepare(specifier, parent);
        const toCheck = [module];
        const checked = new WeakSet<Module>();

        for (const module of toCheck) {
            if (checked.has(module)) continue;
            await module.ready;
            for (const url of module.dependencies) {
                const dependency = this.meta.registry.get(url);
                if (dependency == undefined) continue;
                if (!checked.has(dependency)) toCheck.push(dependency);
            }
        }
        return this.meta.dynamicImport(`/pkg/${module.uuid}`);
        // return import(`/pkg/${module.id}`);
    }
}

interface LoaderEventMap {
    "module": CustomEvent<Module>;
}

export interface Loader {
    addEventListener<K extends keyof LoaderEventMap>(type: K, listener: (this: Loader, ev: LoaderEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
    addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions | undefined): void;
}

