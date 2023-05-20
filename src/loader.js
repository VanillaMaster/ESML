export const META = Symbol("meta");
const AsyncFunction = (async function(){}).constructor;

/**
 * @returns {Generator<number, never, void>}
 */
function* idGen(){
    let i = 0;
    while (true) { yield i++; }
}

export class ESMLoader {
    constructor(){
        this.#worker.addEventListener("message", ESMLoader.onMessage.bind(this));
    }
    /**@type { Map<string, ESML.module> } */
    #cache = new Map();
    #id = idGen();

    /**
     * @param { string } request 
     * @param { { [key: string]: any; base?: string | URL; } } [options] 
     * @returns { Promise<ESML.module> }
     */
    import(request, options){
        return new Promise(async (resolve, reject) => {
            const url = new URL(request, options?.base ?? window.location.href);
            const pending = this.#pendingImports.get(url.href);
            if (pending != undefined) {
                pending.entries.push({
                    reject,
                    resolve
                });
                return;
            }
            const cached = this.#cache.get(url.href);
            if (cached != undefined) {
                const module = /**@type { ESML.module } */({});
                Object.setPrototypeOf(module, cached);
                console.log(`${request} resolved from cache`);
                resolve(module);
                return;
            }

            const id = url.href;
            console.time(`module (${id}) load time`)
            const resp = await fetch(url);

            const mime = resp.headers.get("Content-Type")?.split(";")[0] ?? "";
            console.log(mime);
            if (mime in ESMLoader.#mimeBinging) {
                
                this.#pendingImports.set(id, {
                    location: url,
                    entries: [{
                        resolve,
                        reject
                    }]
                });
                
                ESMLoader.#mimeBinging[mime].call(this, resp, id);
            }
            
        })
    }

    /**@type { Record<string, (this: ESMLoader, response: Response, id: string) => void> } */
    static #mimeBinging = {}

    static {
        /**
         * @this { ESMLoader }
         * @param { Response } response
         * @param { string } id
         */
        async function loadJavaScript(response, id){
            const buffer = await response.arrayBuffer();

            console.time(`module (${id}) parse time`)
            this.#worker.postMessage({ data: buffer, id: id }, [buffer]);
        }

        this.#mimeBinging["application/javascript"] = loadJavaScript;
        this.#mimeBinging["text/javascript"] = loadJavaScript;

    }

    /**@type { Map<string, { entries: { resolve: (value: ESML.module) => void; reject: (reason?: any) => void; }[]; location: URL }> } */
    #pendingImports = new Map();

    #worker = new Worker(new URL("./parser.js", import.meta.url));

    /**
     * @private
     * @this { ESMLoader }
     * @param { MessageEvent<{id: string, module: string, dependencies: string[]}> } e 
     */
    static async onMessage(e){
        const { id, module: text, dependencies } = e.data;
        console.timeEnd(`module (${id}) parse time`);
        const { location, entries } = this.#pendingImports.get(id) ?? (()=>{throw new Error("unreachable")})();

        const execute = AsyncFunction("__imports__", "__self__", text);
        
        const values = await Promise.all(dependencies.map( (dependency) => this.import(dependency, {base: location}) ));
        /**@type { Record<string, ESML.module> } */
        const imports = {};
        for (let i = 0; i < dependencies.length; i++) {
            imports[dependencies[i]] = values[i]
        }

        /**@type {ESML.module} */
        const module = {
            [META]: {
                url: location,
                execute,
                imports,
            },
            [Symbol.toStringTag]: "module",
        }
        /**@type { Record<string, any> } */
        const exports = await execute(imports, module);
        module[META].exports = exports;
        for (const key in exports) {
            Object.defineProperty(module, key, {
                /**@this { ESML.module } */
                get() {
                    return this[META].exports?.[key];
                },
                configurable: false,
                enumerable: true
            })
        }

        this.#cache.set(location.href, module);
        console.timeEnd(`module (${id}) load time`)
        this.#pendingImports.delete(id);
        for (const { resolve, reject } of entries) {
            resolve(Object.setPrototypeOf({}, module));
        }

    }
}