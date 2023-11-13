//throw new Error();

export const asd = 420;
function f1(){
    console.log("f1");
}
export function f2(){
    console.log("f2");
}
export { f1 as f3, f1 as f8 };

export class c1 {

}

export const {e1, key: {subKey: e2}} = {e1: 4, key: {subKey: 5}};

export * from "./c.js"

export {answer as answer2} from "./c.js"

export * as namespaceExport from "./c.js"

export default function (){
    return "42"
};

const smth = await import("./f1/foo.js");

(function(){
        
})();

// // Exporting declarations
// export let name1, name2/*, … */; // also var
// export const name1 = 1, name2 = 2/*, … */; // also var, let
// export function functionName() { /* … */ }
// export class ClassName { /* … */ }
// export function* generatorFunctionName() { /* … */ }
// export const { name1, name2: bar, name3: { name4 } } = o;
// export const [ name1, name2 ] = array;

// // Export list
// export { name1, /* …, */ nameN };
// export { variable1 as name1, variable2 as name2, /* …, */ nameN };
// export { variable1 as "string name" };
// export { name1 as default /*, … */ };

// // Default exports
// export default expression;
// export default 42;
// export default function functionName() { /* … */ }
// export default class ClassName { /* … */ }
// export default function* generatorFunctionName() { /* … */ }
// export default (function () { /* … */ })
// export default class { /* … */ }
// export default function* () { /* … */ }
// export default 22 + 20;

// // Aggregating modules
// export * from "module-name";
// export * as name1 from "module-name";
// export { name1, /* …, */ nameN } from "module-name";
// export { import1 as name1, import2 as name2, /* …, */ nameN } from "module-name";
// export { default, /* …, */ } from "module-name";
// export { default as name1 } from "module-name";

// export * from "./a.js"


// import defaultExport from "module-name";
// import * as name from "module-name";
// import { export1 } from "module-name";
// import { export1 as alias1 } from "module-name";
// import { default as alias } from "module-name";
// import { export1, export2 } from "module-name2";
// import { export1, export2 as alias2, /* … */ } from "module-name";
// import { "string name" as alias } from "module-name";
// import defaultExport, { export1, /* … */ } from "module-name";
// import defaultExport, * as name from "module-name";
// import "module-name";