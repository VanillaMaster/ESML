# ESML
esm compatible loader for js

q: whats the point ?\
a: manual controll of module resolution

```js
import { ESMLoader } from "ESML";
const loader = new ESMLoader();

const module = await loader.import("./a.js");
```

todo:
 - implement import map
 - implement module resolution scopes