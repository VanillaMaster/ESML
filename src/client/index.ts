import { type ImportOptions, Loader } from "./Loader.js";

import { DYNAMIC_IMPORT_IDENTIFIER } from "./LoaderMeta.js";

export const loader = new Loader();

function dynamicImport(caller: string, specifier: string, options: ImportOptions = {}) {
    options.parent = caller;
    return loader.import(specifier, options)
}

Object.defineProperty(window, DYNAMIC_IMPORT_IDENTIFIER, {
    value: dynamicImport,
    configurable: false,
    writable: false,
    enumerable: false
});