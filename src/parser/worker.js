//@ts-nocheck
import "https://cdnjs.cloudflare.com/ajax/libs/acorn/8.8.2/acorn.min.js";


const DEFAULT_EXPORT_NAME = "__default__";
const IMPORTS_CONTAINER = "__imports__";

const utf8decoder = new TextDecoder()

const exportNodeTypes = new Set(["ExportDefaultDeclaration", "ExportAllDeclaration", "ExportNamedDeclaration"])
const importNodeTypes = new Set(["ImportDeclaration"])


self.addEventListener("message",
/**
 * @param { MessageEvent<{ code: string, id: string, payload: ArrayBuffer }> } e 
 */
function(e){
    const { code, id, payload } = e.data;
    switch (code) {
        case "parse":
            parse(payload, id);
            break;
        default:
            console.error("unknown code");
            break;
    }
})

/**
 * @param { ArrayBuffer } data 
 * @param { string } id 
 */
function parse(data, id){
    //console.time("parse time");
    
    const raw = utf8decoder.decode(data);

    const text = raw;//raw.replaceAll(commentExp, "");

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


    const AST = acorn.parse(text, {
        ecmaVersion: "latest",
        sourceType: "module"
    })

    for (const node of AST.body) {
        if (importNodeTypes.has(node.type)) {
            getImportNames(node, ".", imports, namespaceImports, positions);
        }

        if (exportNodeTypes.has(node.type)) {
            getExportNames(node, ".", exports, allExports, positions);
        }
    }

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



    const module = `//prefix\n"use strict";\n${prefix.join("\n\n")}\n//body\n` + body.join("").trim() + `\n//suffix\nreturn {\n    ${suffix.join(",\n    ")}\n}`

    //console.log(module);
    //console.log([...dependencies]);

    const payload = {
        text: module,
        dependencies: [...dependencies]
    };

    self.postMessage({
        code: "result",
        id: id,
        payload
    });
    
    //console.timeEnd("parse time");

}

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


// ready
postMessage({code: "ready"});