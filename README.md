# ESML
esm compatible loader for js

## FAQ
q: whats the point ?\
a: manual controll of module resolution

q: does this shit use eval ?\
a: kind of (function constuctor)

q: any dependencies?\
a: acorn

## example

```js
import { ESMLoader } from "ESML";
const loader = new ESMLoader();

const module = await loader.import("./a.js");
```

todo:
 - implement import map
 - implement module resolution scopes