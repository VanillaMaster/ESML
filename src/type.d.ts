namespace ESML {
    declare const META: typeof import("./loader.js").META;

    type module = {
        [META]: {
            url: URL;
            execute: ( __imports__: any, __self__: any ) => Promise<Record<string, any>>;
            exports?: Record<string, any>;
            imports: Record<string, ESML.module>;
        };
        [Symbol.toStringTag]: string;
        readonly [key: string]: any;
    }
}