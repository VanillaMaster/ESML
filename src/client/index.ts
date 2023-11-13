import { type ImportOptions, Loader } from "./Loader.js";

const DYNAMIC_IMPORT_IDENTIFIER = "__import__"; 

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