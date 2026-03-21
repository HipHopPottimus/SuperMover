/*
This module is from three years ago
I think it still works, but the coding practices might not be up to scratch...
As long as at it does what it needs to do I'm not touching it
*/

export default class IDBWebStorage{
    dbName;

    data = {};

    constructor(dbName){
        this.dbName = dbName;
        this.setup();
    }
    
    setup(){
        return new Promise(async (resolve,reject) => {
            let openRequest = indexedDB.open(this.dbName);
            openRequest.onerror = (e) => {
                reject(new IDBWebStorageError(e.result)); 
                return;
            }
    
            openRequest.onupgradeneeded = (e) => {
                if(e.oldVersion == 0){
                    this.db = openRequest.result;
                    this.db.createObjectStore("data");
                }
                else{
                    indexedDB.deleteDatabase(this.dbName);
                    reject(new IDBWebStorageError("Database was of an unrecoverable version"));
                    return;
                }
            }
            
            openRequest.onsuccess = async (e) => {
                this.db = openRequest.result;
                resolve();
            }
            openRequest.onerror = () => {
                reject(new IDBWebStorageError(openRequest.error));
                return;
            };
        });
    }

    loadData() {
        return new Promise(async (resolve,reject) => {
            if(!this.db) await this.setup();
            let request;
            try{
                request = this.db.transaction("data","readonly").objectStore("data").get("data");
            }
            catch(e){
                reject(new IDBWebStorageError("Error opening object store\n"+e.message));
                return;
            }
            request.onsuccess = (e) => {
                this.data = request.result || {};
                resolve(request.result);
            }
            request.onerror = (e) => {
                reject(new IDBWebStorageError(request.error));
                return;
            }
        }); 
    }

    saveData() {
        return new Promise(async (resolve,reject) => {
            if(!this.db) await this.setup();
            let request;
            try{
                request = this.db.transaction("data","readwrite").objectStore("data").put(this.data,"data");
            }
            catch{
                return null;
            }

            request.onsuccess = (e) => {
                resolve();
            }
            request.onerror = (e) => {
                reject(new IDBWebStorageError(request.error));
                return;
            }
        });
    }
}

export class IDBWebStorageError extends Error{
    name =  "IDBWebStorageError";
}