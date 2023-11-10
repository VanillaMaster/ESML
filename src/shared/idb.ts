import { openDB, DBSchema } from "/node_modules/idb/with-async-ittr.js"


export interface Schema extends DBSchema {
    body: {
        value: {
            id: string,
            data: Blob;
        },
        key: string;
        indexes: {};
    },
    description: {
        value: {
            id: string;
            url: string;
            dependencies: string[]
        };
        key: string;
        indexes: { url: string };
    }
}

export const database = openDB<Schema>("pkg", 1, {
    upgrade(database, oldVersion, newVersion, transaction, event) {
        const description = database.createObjectStore("description", { keyPath: "id"})
        description.createIndex("url", "url", {unique: true});
        const body = database.createObjectStore("body", { keyPath: "id"});

    },
})