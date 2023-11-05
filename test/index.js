// import { Loader } from "../index.js";
// const loader = await Loader.new();

import { loader } from "../dist/client/index.js"
// const loader = await Loader.new();
console.log(loader);
const module = await loader.import("./a.js");
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