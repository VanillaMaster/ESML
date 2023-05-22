///@ts-nocheck
///<reference lib="WebWorker"/>
///<reference lib="es2022" />

const cacheKeys = new Set();

/**@type { IDBDatabase | Promise<IDBDatabase> } */
let DB = openCache(1);
DB.then(db => {
    const transaction = db.transaction("cache", "readonly");
    const store = transaction.objectStore("cache");
    const cursor = store.openCursor();
    cursor.addEventListener("success", function(e){
        const cursor = this.result;
        if (cursor) {
            cacheKeys.add(cursor.key)
            cursor.continue();
        } else {
            console.log("done");
        }
    })
});

/**
 * @param { number } version
 * @returns { Promise<IDBDatabase> }
 */
function openCache(version) {
    return new Promise(function(resolve, reject){
        const request = self.indexedDB.open("ESML", version);
        request.addEventListener("success", function(e){
            resolve(this.result);
        });
        request.addEventListener("error", function(e){
            reject(e)
        });
        request.addEventListener("upgradeneeded", function(e){
            this.result.createObjectStore("cache", { keyPath: "hash" });
        })
    })
}

/**
 * @param { string } str 
 * @param { number } [seed] 
 * @returns { number }
 */
function cyrb53 (str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for(let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1  = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2  = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

import "https://cdnjs.cloudflare.com/ajax/libs/acorn/8.8.2/acorn.min.js";

//self.importScripts("https://cdnjs.cloudflare.com/ajax/libs/acorn/8.8.2/acorn.min.js");


const DEFAULT_EXPORT_NAME = "__default__";
const IMPORTS_CONTAINER = "__imports__";

const exportExp = new RegExp(String.raw`(^|[^\w])export[^\w]`, "g");
const importExp = new RegExp(String.raw`(^|[^\w])import[^\w]`, "g");
const commentExp = new RegExp(String.raw`\/\/.*?(\n|$)|\/\*.*?\*\/`, "gs");

self.addEventListener("message", /**@param { MessageEvent<{data: ArrayBuffer, id: number}> } e*/ async function(e){
    const { data, id } = e.data;

    const raw = /**@type {string} */(String.fromCharCode.apply(undefined, new Uint8Array(data)))
    console.time("hash");
    const hash = cyrb53(raw);
    console.log(cacheKeys);
    console.timeEnd("hash");
    console.log(hash);
    const text = raw.replaceAll(commentExp, "");

    /**@type {Record<string, Record<string, string>>} */
    const exports = {};
    /**@type { { shared: string[]; named: Record<string, string> } } */
    const allExports = {
        named: {},
        shared: []
    };

    /**@type {Record<string, Record<string, string>>} */
    const imports = {}
    /**@type {Record<string, string>} */
    const namespaceImports = {};

    /**@type {Array<[number, number, boolean] | [number, number]>} */
    const positions = [];

    //console.time("parse")
    for (const match of text.matchAll(exportExp)) {
        const parser = new acorn.Parser({
            ecmaVersion: "latest",
            sourceType: "module"
        }, text, match.index);
        parser.nextToken();
        const statement = parser.parseStatement(true, true, {});
        getExportNames(statement, ".", exports, allExports, positions);
    }

    for (const match of text.matchAll(importExp)) {
        const parser = new acorn.Parser({
            ecmaVersion: "latest",
            sourceType: "module"
        }, text, match.index);
        parser.nextToken();
        const statement = parser.parseStatement(true, true, {});
        getImportNames(statement, ".", imports, namespaceImports, positions);
    }

    //console.timeEnd("parse");

    const prefix = [];
    for (const specifier in imports) {
        prefix.push(
            `const {\n    ${
                Object.entries(imports[specifier]).map( ([key, value]) => `${value}: ${key}` ).join(",\n    ")
            }\n} = ${IMPORTS_CONTAINER}["${specifier}"];`
        )
    }
    for (const identifier in namespaceImports) {
        prefix.push(
            `const ${identifier} = ${IMPORTS_CONTAINER}["${namespaceImports[identifier]}"];`
        );
    }

    const suffix = [];
    for (const specifier in exports) {
        if (specifier == ".") {
            for (const [exported, local] of Object.entries(exports[specifier])) {
                suffix.push(`${exported}: ${local}`);
            }
        } else {
            for (const [exported, local] of Object.entries(exports[specifier])) {
                suffix.push(`${exported}: ${IMPORTS_CONTAINER}["${specifier}"]["${local}"]`);
            }
        }
    }
    for (const [exported, specifier] of Object.entries(allExports.named)) {
        suffix.push(`${exported}: ${IMPORTS_CONTAINER}["${specifier}"]`)
    }
    for (const specifier of allExports.shared) {
        suffix.push(`...(${IMPORTS_CONTAINER}["${specifier}"])`);
    }

    positions.sort( ([a], [b]) => a - b );

    /**@type { string[] } */
    const body = [];
    let i = 0;
    for (const [start, end, isDefault] of positions) {
        body.push(text.substring(i, start));
        i = end;
        if (isDefault) {
            body.push(`const ${DEFAULT_EXPORT_NAME} = `)
        }
    }
    body.push(text.substring(i));

    //console.log(body.join("").trim());

    //console.log(exports, allExports);

    const dependencies = new Set();
    for (const dependency in imports) {
        dependencies.add(dependency);
    }
    for (const dependency of Object.values(namespaceImports)) {
        dependencies.add(dependency);
    }
    for (const dependency in exports) {
        if (dependency == ".") continue;
        dependencies.add(dependency);
    }



    const module = `//prefix\n${prefix.join("\n\n")}\n//body\n` + body.join("").trim() + `\n//suffix\nreturn {\n    ${suffix.join(",\n    ")}\n}`

    //console.log(module);
    //console.log([...dependencies]);

    self.postMessage({id, module, dependencies: [...dependencies]});
})

/**
 * @param { acorn.Node } node 
 * @param { string } location 
 * @param { Record<string, Record<string, string>> } imports 
 * @param { Record<string, string> } namespaceImports
 * @param { Array<[number, number, boolean] | [number, number]> } positions
 */
function getImportNames(node, location, imports, namespaceImports, positions) {
    switch (node.type) {
        case "ImportDeclaration": {
            positions.push([node.start, node.end]);
            for (const specifier of node.specifiers) {
                getImportNames(specifier, node.source?.value ?? location, imports, namespaceImports, positions);                
            }
        }; break;
        case "ImportDefaultSpecifier": {
            const container = imports[location] ?? (imports[location] = {});
            const local = node.local.name;
            container[local] = "default";
        }; break;
        case "ImportNamespaceSpecifier": {
            const local = node.local.name;
            namespaceImports[local] = location;
        }; break;
        case "ImportSpecifier": {
            const container = imports[location] ?? (imports[location] = {});
            let imported;
            switch (node.imported.type) {
                case "Literal":
                    imported = node.imported.raw;
                    break;
                case "Identifier":
                    imported = node.imported.name;
                    break;
                default:
                    throw new Error("unreachable");
            }
            const local = node.local.name;
            container[local] = imported;
        }; break;
        default:
            throw new Error("unreachable");
    }
}

/**
 * 
 * @param { acorn.Node } node
 * @param { string } location
 * @param { Record<string, Record<string, string>> } exports
 * @param { { shared: string[]; named: Record<string, string> } } allExports    
 * @param { Array<[number, number, boolean] | [number, number]> } positions
 */
function getExportNames(node, location, exports, allExports, positions) {
    switch (node.type) {
        case "ExportNamedDeclaration": {
            //debugger;
            if (node.declaration) {
                positions.push([node.start, node.declaration.start]);
                getExportNames(node.declaration, node.source?.value ?? location, exports, allExports, positions)
            }
            if (node.specifiers.length > 0) positions.push([node.start, node.end]);
            for (const specifier of node.specifiers) {
                getExportNames(specifier, node.source?.value ?? location, exports, allExports, positions)
            }       
        }; break;
        case "ExportAllDeclaration": {
            positions.push([node.start, node.end]);
            if (node.exported == null) {
                allExports.shared.push(node.source?.value ?? location)
            } else {
                const exported = node.exported.name; 
                allExports.named[exported] = node.source?.value ?? location;
            }
        }; break;
        case "ExportDefaultDeclaration": {
            const { declaration } = node;
            const container = exports[location] ?? (exports[location] = {});
            let identifier = null;
            switch (declaration.type) {
                case "FunctionDeclaration":
                    identifier = declaration.id?.name ?? null;
                    break;
                case "FunctionExpression":
                    identifier = declaration.id?.name ?? null;
                    break;
                case "ClassDeclaration":
                    identifier = declaration.id?.name ?? null;
                    break;
                default:
                    identifier = null;
            }
            if (identifier == null) {
                positions.push([node.start, declaration.start, true]);
                container.default = DEFAULT_EXPORT_NAME;
            } else {
                positions.push([node.start, declaration.start]);
                container.default = identifier;
            }
        }; break;
        case "VariableDeclaration":
            for (const declaration of node.declarations) {
                getExportNames(declaration, location, exports, allExports, positions)    
            }
            break;
        case "VariableDeclarator": {
            getExportNames(node.id, location, exports, allExports, positions)
        }; break;
        case "FunctionDeclaration": {
            const container = exports[location] ?? (exports[location] = {});
            const exported = node.id.name;
            container[exported] = exported;
        }; break;
        case "ClassDeclaration": {
            const container = exports[location] ?? (exports[location] = {});
            const exported = node.id.name;
            container[exported] = exported;
        }; break;
        case "ObjectPattern":
            for (const property of node.properties) {
                getExportNames(property, location, exports, allExports, positions)
            }
            break;
        case "Property":
            getExportNames(node.value, location, exports, allExports, positions)
            break;
        case "ArrayPattern":
            //debugger;
            for (const element of node.elements) {
                getExportNames(element, location, exports, allExports, positions);
            }
            break;
        case "Identifier": {
            const container = exports[location] ?? (exports[location] = {});
            const exported = node.name;
            container[exported] = exported;
        }; break;
        case "ExportSpecifier": {
            const container = exports[location] ?? (exports[location] = {});
            //const exported = node.exported.name;
            let exported;
            switch (node.exported.type) {
                case "Literal":
                    exported = node.exported.raw;
                    break;
                case "Identifier":
                    exported = node.exported.name;
                    break;
                default:
                    throw new Error("unreachable");
            }
            const local = node.local.name;
            container[exported] = local;
        }; break;
        default:
            throw new Error("unreachable");
    }
}

