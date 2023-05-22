import { openDB, deleteDB, wrap, unwrap } from 'https://cdn.jsdelivr.net/npm/idb@7/+esm';

export const DB = await openDB("ESML", 1, {
    upgrade(db, oldVersion, newVersion, transaction, event) {
        const store = db.createObjectStore('cache', {keyPath: ["hash", "id"]});
        store.createIndex("hash", "hash", {unique: true});
        store.createIndex("id", "id", {unique: true});
    }
})
