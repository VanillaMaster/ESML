import { META } from "../loader.js";

export class Resolver{
    constructor(){}

    #scopes = {
        /**@type { ESML.Scope } */
        global: { [Symbol.toStringTag]: "global" },
        /**@type  {Record<string, ESML.Scope> } */
        local: {}
    };

    /**
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
}