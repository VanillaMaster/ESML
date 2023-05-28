# ESML
esm compatible loader for js

## FAQ
q: whats the point ?\
a: manual controll over ~~module resolution~~ everything

q: does this shit use eval ?\
a: kind of (function constuctor)

q: any dependencies?\
a: acorn

## example

```js
import { Loader } from "ESML";
const loader = await Loader.new();

const module = await loader.import("./a.js");
```

todo:
 - ~~implement import map~~
 - ~~implement module resolution scopes~~
 - fix dynamic import
