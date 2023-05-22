export const META = Symbol("meta");
const AsyncFunction = (async function(){}).constructor;

export class ESMLoader {
    constructor(){
        this.#parser.addEventListener("message", ESMLoader.onMessage.bind(this));
    }

    #parser = new Worker(new URL("./parser.js", import.meta.url), {type: "module"});

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

            const id = url.href;

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