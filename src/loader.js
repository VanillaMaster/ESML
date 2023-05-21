export const META = Symbol("meta");
const AsyncFunction = (async function(){}).constructor;

export class ESMLoader {
    constructor(){
        this.#parser.addEventListener("message", ESMLoader.onMessage.bind(this));
    }

    /**@type { Record<string, (this: ESMLoader, response: Response, id: string) => void> } */
    static #mimeBinging = {}
    
    /**@type { Map<string, { entries: { resolve: (value: ESML.module) => void; reject: (reason?: any) => void; }[]; module: ESML.module }> } */
    #pendingImports = new Map();

    #parser = new Worker(new URL("./parser.js", import.meta.url));

    #scopes = {
        /**@type { ESML.Scope } */
        global: { [Symbol.toStringTag]: "global" },
        /**@type  {Record<string, ESML.Scope> } */
        local: {}
    };
    
    /**@type { ESML.importMap } */
    #importmap = {
        imports: []
    }
    /**@param { Optional<ESML.importMap>  } value*/
    set importmap(value) {
        for (const key in this.#importmap) {
            if (value[key] != undefined) {
                //Object.assign(this.#importmap[key] ?? (this.#importmap[key] = {}), value[key])
                this.#importmap[key] = value[key];
            }
        }
    }

    /**
     * @private
     * @param { string } request 
     * @param { ESML.module } [parent] 
     * @returns { readonly [URL, "inherit" | "mapped" | "relative"] }
     */
    resolveModuleInfo(request, parent){
        if (request in this.#importmap.imports) {
            const info = this.#importmap.imports[request];
            return [new URL(info.path , window.location.href), "mapped"]
        }

        if (parent) {
            const { url } = parent[META];
            return [new URL(request, url), "inherit"]
        }
        
        return [new URL(request, window.location.href), "relative"];
    }

    /**
     * @template { "inherit" | "mapped" | "relative" } K
     * @param { K } type 
     * @param { string } request
     * @param { K extends "inherit" ? ESML.module : undefined } parent 
     */
    resolveModuleScopes(type, request, parent){
        switch (type) {
            case "inherit": {
                return [ ...(/**@type { ESML.module }*/(parent)[META].scopes)];
            }
            case "mapped": {
                const { scopes: names } = this.#importmap.imports[request];
                /**@type { ESML.Scope[] } */
                const scopes = [];
                for (const name of names) {
                    scopes.push(this.#scopes.local[name] ?? (this.#scopes.local[name] = {[Symbol.toStringTag]: name}))
                }
                scopes.push(this.#scopes.global);
                return scopes;
            }
            case "relative": {
                return [ this.#scopes.global ]
            }
            default:
                throw new Error("unknown type");
        }
    }
    
    /**
     * @template {string} K
     * @param { [K, ESML.importOptions?] | [ESML.module, K, ESML.importOptions?] } args
     * @returns { Promise<ESML.module> }
     */
    import(...args){        
        return new Promise(async (resolve, reject) => {

            const [parent, request, options] = ESMLoader.parseImportArguments(args);
            const [url, type] = this.resolveModuleInfo(request, parent);
            const scopes = this.resolveModuleScopes(type, request, parent);
            //const name = url.pathname.substring(Math.max(url.pathname.lastIndexOf("/"), 0) + 1);
            const name = type == "mapped"? request : url.href;

            //check cache
            for (const scope of scopes) {
                if (name in scope) {
                    const modules = scope[name];
                    if (modules.length > 1) {
                        reject("cannot resolve name due to name collision in scope");
                        return;
                    }
                    const [cached] = modules;
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

            const id = crypto.randomUUID();

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

            for (const scope of scopes) {
                const container = scope[name] ?? (scope[name] = []);
                container.push(module);
            }

            console.time(`module (${name}) load time`);

            const resp = await fetch(url);

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
     * @private
     * @this { ESMLoader }
     * @param { MessageEvent<{id: string, module: string, dependencies: string[]}> } e 
     */
    static async onMessage(e){
        const { id, module: text, dependencies } = e.data;
        //console.timeEnd(`module (${id}) parse time`);
        
        const { module: __module__, entries } = this.#pendingImports.get(id) ?? (()=>{throw new Error("unreachable")})();
        const module = /**@type { ESML.module & {[META]: {status: "fulfilled"}}} */(__module__);

        const values = await Promise.all(dependencies.map( (dependency) => this.import(module, dependency) ));
        /**@type { Record<string, ESML.module> } */
        const imports = {};
        for (let i = 0; i < dependencies.length; i++) {
            imports[dependencies[i]] = values[i]
        }
        
        const execute = AsyncFunction("__imports__", "__self__", text);
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
}