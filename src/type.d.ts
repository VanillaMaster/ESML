namespace ESML {
    declare const META: typeof import("./loader.js").META;

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
        [name: string]: module[];
        [Symbol.toStringTag]: string;
    }
}

type Optional<T> = {
    [K in keyof T]?: T[K]
}