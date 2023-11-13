// import { Loader } from "../index.js";
// const loader = await Loader.new();

import { loader } from "../dist/client/index.js"
console.log(loader);

loader.meta.resolve = function(specifier, base, parent) {
    console.log(specifier, base, parent);
    return new URL(specifier, base);
}

console.time("load");
const module = await loader.import("./a.js", {
    resolverCtx: ["42"]
});
console.timeEnd("load");
console.log(module);

// loader.importmap = {
//     imports: [
//         {
//             name: "#a",
//             path: "./a.js",
//             scopes: ["scopeName1"]
//         }, {
//             name: "#aa",
//             path: "./b.js",
//             scopes: []
//         },
//     ]
// }
// //debugger;
// const module = await loader.import("#a");
// console.log(module);
// console.log(loader);

// import "./a.js"

//const moduleb = await loader.import("./b.js");
//console.log(moduleb);