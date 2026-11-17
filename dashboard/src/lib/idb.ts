// Tiny IndexedDB store for local media files (queued songs and bridges). The panel writes, media.html reads.
const DB = 'sidestage'
const STORE = 'files'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    let req: IDBRequest<T>
    transaction.oncomplete = () => { db.close(); resolve(req.result) }
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('Media transaction aborted')) }
    transaction.onerror = () => { /* onabort handles transaction failure */ }
    try {
      req = fn(transaction.objectStore(STORE))
    } catch (error) {
      transaction.abort()
      db.close()
      reject(error)
    }
  }))
}

export const putFile = (key: string, blob: Blob) => tx('readwrite', (s) => s.put(blob, key))
export const getFile = (key: string) => tx<Blob | undefined>('readonly', (s) => s.get(key))
export const deleteFile = (key: string) => tx('readwrite', (s) => s.delete(key))
export const listFileKeys = () => tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).then((ks) => ks.map(String))
