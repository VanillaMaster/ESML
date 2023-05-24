import { Loader } from "../index.js";
const loader = await Loader.new();

loader.importmap = {
    imports: [
        {
            name: "#a",
            path: "./a.js",
            scopes: ["scopeName1"]
        }, {
            name: "#aa",
            path: "./b.js",
            scopes: []
        },
    ]
}
//debugger;
const module = await loader.import("#a");
console.log(module);
console.log(loader);

//const moduleb = await loader.import("./b.js");
//console.log(moduleb);