import { DB } from "./cache.js"


export const META = Symbol("meta");
const AsyncFunction = (async function(){}).constructor;

const props = {
    strategies: {
        cacheFirst: false,
    }
}


export class ESMLoader {
    /**
     * @param { (loader: ESMLoader) => void } callback
     */
    constructor(callback){
        this.#parser.addEventListener("message", ESMLoader.onMessage.bind(this));
        /**@param {MessageEvent} e */
        const onReady = ({ data }) => {
            if (data.type == "ready") {
                callback(this);
                this.#parser.removeEventListener("message", onReady)
            }
        }
        this.#parser.addEventListener("message", onReady)
    }

    /**@returns { Promise<ESMLoader> } */
    static new(){
        return new Promise((resolve) => new ESMLoader(resolve));
    }

    #parser = new Worker(new URL("./worker.js", import.meta.url), {type: "module"});

    /**@type { Record<string, (this: ESMLoader, response: Response, id: string) => void> } */
    static #mimeBinging = {}
    
    /**@type { Map<string, { entries: { resolve: (value: ESML.module) => void; reject: (reason?: any) => void; }[]; module: ESML.module }> } */
    #pendingImports = new Map();

    /**@type { Map<string, ESML.module> } */
    registry = new Map();

    #scopes = {
        /**@type { ESML.Scope } */
        global: { [Symbol.toStringTag]: "global" },
        /**@type  {Record<string, ESML.Scope> } */
        local: {}
    };
    
    /**
     * @param { string } name 
     */
    getLocalScopeByName(name) {
        return this.#scopes.local[name] ?? (this.#scopes.local[name] = {[Symbol.toStringTag]: name});
    }

    /**
     * @private
     * @param { ESML.Scope } scope 
     * @param { string } name 
     * @param { string } path 
     * @param { string[] } scopeNames 
     */
    initScope(scope, name, path, scopeNames){
        const container = scope[name] ?? (scope[name] = []); 
        const scopes = scopeNames.map( name => this.getLocalScopeByName(name));
        scopes.push(this.#scopes.global);
        container.push({
            path: new URL(path, window.location.href),
            scopes: scopes
        });
    }
    /**@param { Optional<ESML.importMap>  } value*/
    set importmap(value) {
        if (value.imports != undefined) {
            for (const { name, path, scopes: scopeNames } of value.imports) {
                this.initScope(this.#scopes.global, name, path, scopeNames)
                for (const scopeName of scopeNames) {
                    const scope = this.getLocalScopeByName(scopeName);
                    this.initScope(scope, name, path, scopeNames);
                }
            }
        }
    }

    /**
     * @private
     * @param { string } request 
     * @param { ESML.module } [parent] 
     * @returns { readonly [URL, ESML.Scope[], "inherit" | "mapped" | "relative"] }
     */
    resolveModuleInfo(request, parent){

        for (const scope of (parent?.[META].scopes ?? [this.#scopes.global]) ) {
            if (request in scope) {
                const info = scope[request];
                if (info.length > 1) {
                    throw new Error("cannot resolve name due to name collision in scope");
                }
                const [{ path, scopes }] = info;
                return [new URL(path , window.location.href), scopes, "mapped"];
            }
        }

        if (parent) {
            const { url } = parent[META];
            return [new URL(request, url), parent[META].scopes, "inherit"]
        }
        
        return [new URL(request, window.location.href), [ this.#scopes.global ], "relative"];
    }

    /**
     * @private
     * @param { [string, ESML.importOptions?] | [ESML.module, string, ESML.importOptions?] } args
     * @returns { readonly [ESML.module?, string, ESML.importOptions?] }
     */
    static parseImportArguments(args) {
        /**@type {ESML.module | undefined} */
        let parent;
        /**@type {string} */
        let request;
        /**@type {ESML.importOptions | undefined} */
        let options;
        if (typeof args[0] == "string") {
            request = /**@type { String } */ (args[0]);
            options = /**@type { ESML.importOptions | undefined } */ (args[1]);
        } else {
            parent = /**@type { ESML.module } */ (args[0]);
            request = /**@type { String } */ (args[1]);
            options = /**@type { ESML.importOptions | undefined } */ (args[2]);
        }
        //console.log(parent, request, options);
        return [parent, request, options]
    }
    
    /**
     * @template {string} K
     * @param { [K, ESML.importOptions?] | [ESML.module, K, ESML.importOptions?] } args
     * @returns { Promise<ESML.module> }
     */
    import(...args){        
        return new Promise(async (resolve, reject) => {

            const [parent, request, options] = ESMLoader.parseImportArguments(args);
            const [url, scopes, type] = this.resolveModuleInfo(request, parent);
            //const name = url.pathname.substring(Math.max(url.pathname.lastIndexOf("/"), 0) + 1);
            const name = (type == "mapped"? request : url.href);
            const id = url.href;

            //check cache
            for (const scope of scopes) {
                if (name in scope) {
                    const modules = scope[name];
                    if (modules.length > 1) {
                        reject("cannot resolve name due to name collision in scope");
                        return;
                    }
                    const [{ path: {href: path} }] = modules;
                    const cached = this.registry.get(path);

                    if (cached == undefined) break;

                    if (cached[META].status == "fulfilled") {
                        console.log(`${name}: found in cache`);
                        resolve(cached);
                        return;
                    }
                    if (cached[META].status == "rejected") {
                        console.log(`${name}: rejected from cache`);
                        reject("TODO cache + reject error");
                        return;
                    }
                    if (cached[META].status == "pending") {
                        const { id } = cached[META];
                        const { entries } = this.#pendingImports.get(id) ?? (()=>{throw new Error("unreachable")})();
                        entries.push({
                            reject,
                            resolve
                        })
                        return;
                    }
                }
            }
            
            /**@type { ESML.module } */
            const module = {
                [META]: {
                    scopes: scopes,
                    url: url,
                    name: name,
                    status: "pending",
                    id: id
                },
                [Symbol.toStringTag]: "module"
            }

            this.registry.set(id, module);
            
            console.time(`module (${name}) load time`);
            const controller = new AbortController();
            
            const respPromies = fetch(url, {
                signal: controller.signal
            }).catch((e)=>{
                //console.log();
            });

            // {
            //     const transaction = await DB.transaction("cache", "readonly");
            //     const store = await transaction.objectStore("cache");
            //     const data = await store.index("id").get(id);
            //     if (data) {
            //         controller.abort();

            //         this.#pendingImports.set(id, {
            //             module: module,
            //             entries: [{
            //                 resolve,
            //                 reject
            //             }]
            //         });

            //         this.compileJsModule(data)
            //         return;
            //     }
            // }
            
            const resp = /**@type {Response} */ (await respPromies);
            const mime = resp.headers.get("Content-Type")?.split(";")[0] ?? "";
            //console.log(mime);
            if (mime in ESMLoader.#mimeBinging) {
                
                this.#pendingImports.set(id, {
                    module: module,
                    entries: [{
                        resolve,
                        reject
                    }]
                });
                
                ESMLoader.#mimeBinging[mime].call(this, resp, id);
            } else {
                reject(`unknown mime type: ${mime}`);
            }
            
        })
    }

    /**
     * @param { (ESML.parser.message & {type: "cached"})["payload"] } data 
     */
    async compileJsModuleFromCache(data){
        const transaction = await DB.transaction("cache", "readonly");
        const store = await transaction.objectStore("cache");
        const cachedData = await store.index("hash").get(data.key)
        if (cachedData == undefined) debugger;
        this.compileJsModule(cachedData);
    }

    /**
     * @private
     * @param { (ESML.parser.message & {type: "result"})["payload"] } data 
     */
    async compileJsModule(data){
        const { id, dependencies } = data;
        //console.timeEnd(`module (${id}) parse time`);
        
        const { module: __module__, entries } = this.#pendingImports.get(id) ?? (()=>{throw new Error("unreachable")})();
        const module = /**@type { ESML.module & {[META]: {status: "fulfilled"}}} */(__module__);

        const values = await Promise.all(dependencies.map( (dependency) => this.import(module, dependency) ));
        /**@type { Record<string, ESML.module> } */
        const imports = {};
        for (let i = 0; i < dependencies.length; i++) {
            imports[dependencies[i]] = values[i]
        }
        
        const execute = AsyncFunction("__imports__", "__self__", data.text);
        const exports = await execute(imports, module);
        
        module[META].status = "fulfilled";
        module[META].execute = execute;
        module[META].exports = exports;
        module[META].imports = imports;

        for (const key in exports) {
            Object.defineProperty(module, key, {
                /**@this { typeof module } */
                get() {
                    return this[META].exports[key];
                },
                configurable: false,
                enumerable: true
            })
        }

        console.timeEnd(`module (${module[META].name}) load time`);
        
        this.#pendingImports.delete(id);

        for (const { resolve, reject } of entries) {
            resolve(Object.setPrototypeOf({}, module));
        }

    }

    static {
        /**
         * @this { ESMLoader }
         * @param { Response } response
         * @param { string } id
         */
        async function loadJavaScript(response, id){
            const buffer = await response.arrayBuffer();
            //console.time(`module (${id}) parse time`)
            this.#parser.postMessage({ data: buffer, id: id }, [buffer]);
        }

        this.#mimeBinging["application/javascript"] = loadJavaScript;
        this.#mimeBinging["text/javascript"] = loadJavaScript;

    }

    /**
     * @private
     * @this { ESMLoader }
     * @param { MessageEvent< ESML.parser.message > } e 
     */
    static onMessage({data}){
        switch (data.type) {
            case "result":
                this.compileJsModule(data.payload);
                break;
            case "cached":
                this.compileJsModuleFromCache(data.payload)
                break;
            case "ready": break;
            default: throw new Error("unreachable")
        }
    }
}