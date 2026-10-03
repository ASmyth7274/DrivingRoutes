// Minimal IndexedDB key-value store with an in-memory fallback.

const DB_NAME = 'driving-test-routes';
const DB_VERSION = 1;
const STORES = ['routes', 'kv'];

let dbPromise = null;
const memory = new Map(STORES.map((s) => [s, new Map()]));

function open() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function idbGet(store, key) {
  const db = await open();
  if (!db) return memory.get(store).get(key);
  try {
    return await tx(db, store, 'readonly', (s) => s.get(key));
  } catch {
    return memory.get(store).get(key);
  }
}

export async function idbSet(store, key, value) {
  const db = await open();
  memory.get(store).set(key, value);
  if (!db) return;
  try {
    await tx(db, store, 'readwrite', (s) => s.put(value, key));
  } catch (err) {
    console.warn('IndexedDB write failed', err);
  }
}

export async function idbDelete(store, key) {
  const db = await open();
  memory.get(store).delete(key);
  if (!db) return;
  try {
    await tx(db, store, 'readwrite', (s) => s.delete(key));
  } catch { /* ignore */ }
}

export async function idbKeys(store) {
  const db = await open();
  if (!db) return [...memory.get(store).keys()];
  try {
    return await tx(db, store, 'readonly', (s) => s.getAllKeys());
  } catch {
    return [...memory.get(store).keys()];
  }
}

export async function idbClear(store) {
  const db = await open();
  memory.get(store).clear();
  if (!db) return;
  try {
    await tx(db, store, 'readwrite', (s) => s.clear());
  } catch { /* ignore */ }
}
