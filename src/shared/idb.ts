// import { openDB, DBSchema } from "/node_modules/idb/with-async-ittr.js";
import { openDB, DBSchema } from "idb";

export interface Schema extends DBSchema {
    body: {
        value: {
            uuid: string,
            data: Blob;
            crc: number;
        },
        key: string;
        indexes: {};
    },
    description: {
        value: {
            uuid: string;
            url: string;
            dependencies: string[];
        };
        key: string;
        indexes: { uuid: string };
    }
}

export const database = openDB<Schema>("pkg", 1, {
    upgrade(database, oldVersion, newVersion, transaction, event) {
        const description = database.createObjectStore("description", { keyPath: "url"})
        description.createIndex("uuid", "uuid", {unique: true});
        const body = database.createObjectStore("body", { keyPath: "uuid"});

    },
})