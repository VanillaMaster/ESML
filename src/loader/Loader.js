import { Parser } from "../parser/parser.js";
import { Resolver } from "../pathResolver/Resolver.js";

import { META } from "../Symbol.js";

import { cyrb53_b } from "../utilities.js";

import { DB } from "../cache.js";

// const registry = new FinalizationRegistry((heldValue) => {
//     console.log(heldValue);
// });

/**
 * @param { any } o 
 * @returns { o is Object }
 */
function isPlainObject(o){
    if (typeof o !== "object") return false;
    if (o === null) return false;
    if (Object.getPrototypeOf(o) !== Object.prototype) return false;

    return true;
}
/**
 * @param { any } o 
 * @returns { o is string }
 */
function isString(o){
    return typeof o === "string";
}

/**
 * @param { any } o 
 * @returns { o is ESML.module }
 */
function isModule(o){
    return Object.prototype.isPrototypeOf.call(MODULE_PROTO, o);
}

const MODULE_PROTO = Object.create(null, {
    [Symbol.toStringTag]: {
        value: "module",
        configurable: false,
        enumerable: false,
        writable: false
    }
});

const MODULE_META_PROTO = Object.create(null, {
    [Symbol.toStringTag]: {
        value: "meta",
        configurable: false,
        enumerable: false,
        writable: false
    }
})

const AsyncFunction = (async function(){}).constructor;
const hashCache = new Set();
const idCache = new Set();
{
    const transaction = await DB.transaction("cache");
    let cursor = await transaction.objectStore("cache").openKeyCursor();
    
    while (cursor) {
        const [hash, id] = /**@type { [Number, String]} */ (cursor.key);
        hashCache.add(hash);
        idCache.add(id);
        cursor = await cursor.continue();
    }
}

export class Loader extends EventTarget{
    /**
     * @param { Parser } parser 
     * @param { Resolver } resolver 
     */
    constructor(parser, resolver){
        super();
        this.#parser = parser;
        this.#resolver = resolver;
    }
    /**@returns { Promise<Loader> } */
    static async new(){
        const parser = await Parser.new();
        const resolver = new Resolver();
        return new Loader(parser, resolver);
    }
    #parser;
    #resolver;

    /**@param { Optional<ESML.importMap>  } value*/
    set importmap(value) {
        this.#resolver.importmap = value;
    }

    /**@type { Map<string, ESML.module> } */
    registry = new Map();


    /**@type { Map<ESML.module, ({ resolve: (value: ESML.module) => void; reject: (reason?: any) => void; })[]> } */
    #pendingModules = new Map();

    /**
     * @private
     * @param { [string, ESML.importOptions?] | [ESML.module, string, ESML.importOptions?] } args
     * @returns { readonly [ESML.module?, string, ESML.importOptions?] }
     */
    static parseImportArguments(args) {
        if (
            (args.length === 1 || args.length === 2) &&
            (isString(args[0])) &&
            (args[1] === undefined || isPlainObject(args[1]))
        ) {
            return [
                undefined,
                /**@type { String } */ (args[0]),
                /**@type { ESML.importOptions | undefined } */ (args[1])
            ];
        }

        if (
            (args.length === 2 || args.length === 3) &&
            (isModule(args[0])) &&
            (isString(args[1])) &&
            (args[2] === undefined || isPlainObject(args[2]))
        ) {
            return [
                /**@type { ESML.module } */ (args[0]),
                /**@type { String } */ (args[1]),
                /**@type { ESML.importOptions | undefined } */ (args[2])
            ];
        }

        throw new Error("unexpected arguments");
    }


    /**
     * @template {string} K
     * @param { [K, ESML.importOptions?] | [ESML.module, K, ESML.importOptions?] } args
     * @returns { Promise<ESML.module> }
     */
    import(...args){       
        //debugger; 
        return new Promise(async (resolve, reject) => {
            const [parent, request, options] = Loader.parseImportArguments(args);
            //console.time(request)
            const [url, scopes, type] = this.#resolver.resolveModuleInfo(request, parent);
            //const name = url.pathname.substring(Math.max(url.pathname.lastIndexOf("/"), 0) + 1);
            const name = (type == "mapped"? request : url.href);
            const id = url.href;


            //debugger

            const cached = this.registry.get(id); 
            if (cached) {
                if (cached[META].status == "fulfilled") {
                    console.log(`${name}: found in cache`);
                    resolve(Object.create(cached));
                    return;
                }
                if (cached[META].status == "rejected") {
                    console.log(`${name}: rejected from cache`);
                    reject("TODO cache + reject error");
                    return;
                }
                if (cached[META].status == "pending") {
                    const container = this.#pendingModules.get(cached) ?? (()=>{throw new Error("unreachable")})();
                    container.push({
                        reject,
                        resolve
                    })
                    return;
                }
            }

            const module = Object.create(MODULE_PROTO, {
                [META]: {
                    /**@type { ESML.module[META] } */
                    value: Object.create(MODULE_META_PROTO, {
                        scopes: {
                            value: scopes,
                            writable: false,
                            configurable: false,
                            enumerable: false
                        },
                        url: {
                            value: url,
                            writable: false,
                            configurable: false,
                            enumerable: false
                        },
                        name: {
                            value: name,
                            writable: false,
                            configurable: false,
                            enumerable: false
                        },
                        status: {
                            value: "pending",
                            writable: true,
                        },
                        id: {
                            value: id,
                            writable: false,
                            configurable: false,
                            enumerable: false
                        }
                    }),
                    enumerable: false,
                    writable: false,
                    configurable: false
                }
            })
            
            /**@type { { resolve: (value: ESML.module) => void; reject: (reason?: any) => void; }[] }*/
            const container = [];
            this.#pendingModules.set(module, container);
            this.registry.set(id, module);

            container.push({ resolve, reject });
            
            const controller = new AbortController();
            
            const respPromies = fetch(url, {
                signal: controller.signal
            }).catch((e)=>{
                //console.log();
            });
            this.dispatchEvent(new CustomEvent("fetch"));

            if (true) {
                const transaction = await DB.transaction("cache", "readonly");
                const store = await transaction.objectStore("cache");
                const data = await store.index("id").get(id);
                if (data) {
                    if (data == undefined) debugger;
                    await this.compileJsModule(data, module)
                    //console.timeEnd(request)
                    console.log(`got "${id}" from cache`);
                    if (true) {
                        const resp = /**@type {Response} */ (await respPromies);
                        this.reValidateCache(resp, id);
                    } else {
                        controller.abort();
                        this.dispatchEvent(new CustomEvent("fetchend"));
                    }

                    return;
                }
            }
            
            const resp = /**@type {Response} */ (await respPromies);
            const mime = resp.headers.get("Content-Type")?.split(";")[0] ?? "";
            //console.log(mime);
            if (mime in Loader.#mimeBinging) {
                await Loader.#mimeBinging[mime].call(this, resp, module);
                //console.timeEnd(request)
            } else {
                reject(`unknown mime type: ${mime}`);
            }
            
        })
    }

    /**
     * @private
     * @param { {text: string; dependencies: string[];} } data
     * @param { ESML.module } module
     */
    async compileJsModule(data, module){
        const { dependencies } = data;
      
        const values = await Promise.all(dependencies.map( (dependency) => this.import(module, dependency) ));
        /**@type { Record<string, ESML.module> } */
        const imports = Object.create(null);
        for (let i = 0; i < dependencies.length; i++) {
            Object.defineProperty(imports, dependencies[i], {
                value: values[i],
                configurable: false,
                enumerable: false,
                writable: false
            })
        }
        /**@type { (__imports__: Record<string, ESML.module>, __self__: ESML.module) => Promise<any>} */
        const execute = AsyncFunction("__imports__", "__self__", data.text);
        //Object.defineProperty(execute, "name", { value: "module" });
        const exports = Object.assign(Object.create(null), await execute.call(null, imports, module));
        const meta = module[META];
        Object.defineProperties(meta,{
            status: {
                value: "fulfilled",
                writable: false,
                configurable: false,
                enumerable: false
            },
            execute: {
                value: execute,
                writable: false,
                configurable: false,
                enumerable: false
            },
            exports: {
                value: exports,
                writable: false,
                configurable: false,
                enumerable: false
            },
            imports: {
                value: imports,
                writable: false,
                configurable: false,
                enumerable: false
            }
        });

        for (const key in exports) {
            Object.defineProperty(execute,key, {
                configurable: false,
                enumerable: false,
                writable: false
            });
            Object.defineProperty(module, key, {
                /**@this { ESML.module & {[META]: {status: "fulfilled"}} } */
                get() {
                    return this[META].exports[key];
                },
                configurable: false,
                enumerable: true
            })
        }
        
        const container = this.#pendingModules.get(module) ?? (()=>{throw new Error("unreachable")})();
        this.#pendingModules.delete(module);

        for (const { resolve, reject } of container) {
            resolve(Object.create(module));
        }

    }

    /**
     * 
     * @param { Response } response 
     * @param { string } id
     */
    async reValidateCache(response, id){
        const buffer = await response.arrayBuffer();
        this.dispatchEvent(new CustomEvent("fetchend"));
        const hash = cyrb53_b(buffer);
        if (!hashCache.has(hash)) {
            this.dispatchEvent(new CustomEvent("updatestart", {detail: { id }}));
            console.time(`(${id}) parsed (revalidation) in`)
            const data = await this.#parser.parse(buffer);
            console.timeEnd(`(${id}) parsed (revalidation) in`)
            
            const transaction = await DB.transaction("cache","readwrite");
            const store = transaction.objectStore("cache");
            let cursor = await store.index("id").openKeyCursor(id);
            while (cursor) {
                //console.log("pkey", cursor.primaryKey);
                store.delete(cursor.primaryKey)
                cursor = await cursor.continue();
            }
            //store.delete([hash, id]);
            //store.add(Object.assign(data, {hash, id}));
            Object.assign(data, {hash, id})
            store.put(data);
            transaction.commit();
            this.dispatchEvent(new CustomEvent("updateend", {detail: { id }}));
        }
    }

    /**@type { Record<string, (this: Loader, response: Response, module: ESML.module) => void> } */
    static #mimeBinging = {}

    static {
        /**
         * @this { Loader }
         * @param { Response } response
         * @param { ESML.module } module
         */
        async function loadJavaScript(response, module){
            const { id } = module[META];
            const buffer = await response.arrayBuffer();
            this.dispatchEvent(new CustomEvent("fetchend"));
            //console.time(`module (${id}) parse time`)
            const hash = cyrb53_b(buffer);
            /** @type { {text: string; dependencies: string[];} }*/
            let data;
            if (hashCache.has(hash)) {
                console.time(`(${module[META].id}) retrieved from cache in`)
                data = /**@type {any}*/(await DB.getFromIndex("cache", "hash", hash));
                console.timeEnd(`(${module[META].id}) retrieved from cache in`)
            } else {
                console.time(`(${module[META].id}) parsed in`)
                data = await this.#parser.parse(buffer);
                console.timeEnd(`(${module[META].id}) parsed in`)
                queueMicrotask(async ()=>{
                    const transaction = await DB.transaction("cache","readwrite");
                    const store = transaction.objectStore("cache");
                    store.delete([hash, id]);
                    Object.assign(data, {hash, id})
                    store.add(data);
                    transaction.commit();
                })
            }
            await this.compileJsModule(data, module);
        }

        this.#mimeBinging["application/javascript"] = loadJavaScript;
        this.#mimeBinging["text/javascript"] = loadJavaScript;

    }
}