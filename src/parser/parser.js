export class Parser {
    /**
     * to get instance with default wokrer use `Parser.new()`
     * @param { Worker } worker 
     */
    constructor(worker){
        this.#worker = worker;
        this.#worker.addEventListener("message", this.onMessage.bind(this));
    }

    /**
     * @returns { Promise<Parser> }
     */
    static new(){
        return new Promise((resolve, reject)=>{
            const worker = new Worker(new URL("./worker.js", import.meta.url), {type: "module"});
            worker.addEventListener("message", (ev) => {
                if (ev.data.code != "ready") {
                    worker.terminate();
                    throw new Error();
                }
                resolve(new Parser(worker));
            }, {once: true});
        });
    }

    /**@type { Map<string | number, { resolve: (value: any) => void, reject: (reason?: any) => void }> } */
    #pendingRequests = new Map();

    /**
     * @returns { Promise<{ text: string, dependencies: string[] }> }
     * @param { ArrayBuffer } data 
     * @param { string | number } [id]
     */
    parse(data, id = crypto.randomUUID()) {
        return new Promise((resolve, reject)=>{
            this.#pendingRequests.set(id, {
                resolve,
                reject
            })
            this.#worker.postMessage({code: "parse", id: id, payload: data}, [data]);
        });
    }

    #worker;
    
    /**
     * @private
     * @param { MessageEvent<{code: string, id: string | number, payload: any}> } ev 
     */
    onMessage(ev){
        const {code, id, payload} =  ev.data;
        switch (code) {
            case "result":
                this.onResult(id, payload)
                break;
            default:
                throw new Error("unexpected code")
        }
    }

    /**
     * @private
     * @param { string | number } id 
     * @param { { text: string, dependencies: string[]} } data 
     */
    onResult(id, data){
        const { resolve } = this.#pendingRequests.get(id) ?? (()=>{throw new Error("unreachable")})();
        resolve(data);
    }
}