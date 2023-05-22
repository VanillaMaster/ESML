namespace ESML {
    declare const META: typeof import("./loader.js").META;

    namespace parser {

        type message = ({
            type: "ready";
            payload: {};
        } | {
            type: "cached";
            payload: {
                key: number;
            }
        } | {
            type: "result";
            payload: {
                text: string;
                dependencies: string[];
                id: string;
                hash: number;
            }
        })
        
    }

    type module = {
        [META]: {
            scopes: Scope[];
            url: URL;
            name: string;
            id: string;
        };
        [Symbol.toStringTag]: string;
    } & ({
        [META]: {
            status: "pending" | "rejected";
        };
    } | {
        [META]: {
            status: "fulfilled"
            execute: ( __imports__: any, __self__: any ) => Promise<Record<string, any>>;
            exports: Record<string, any>;
            imports: Record<string, ESML.module>;
        };
    })

    type importOptions = {
        [key: string]: any;
        base?: string | URL;
    }

    type importMap = {
        [K: string]: any;
        imports: {
            name: string;
            path: string;
            scopes: string[];
        }[];
    }

    type Scope = {
        [name: string]: {
            path: URL;
            scopes: Scope[];
        }[];
        [Symbol.toStringTag]: string;
    }
}

type Optional<T> = {
    [K in keyof T]?: T[K];
}