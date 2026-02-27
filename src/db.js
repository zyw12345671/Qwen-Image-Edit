const DB_NAME = 'QwenImageEdit';
const DB_VERSION = 1;
const STORE_NAME = 'images';

let db = null;
let dbInitPromise = null;

export const initDB = () => {
  if (db) {
    return Promise.resolve(db);
  }
  if (dbInitPromise) {
    return dbInitPromise;
  }
  
  dbInitPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB打开失败:', request.error);
      dbInitPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      dbInitPromise = null;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
  
  return dbInitPromise;
};

const convertBlobToBase64 = (blobUrl) => {
  return fetch(blobUrl)
    .then(response => response.blob())
    .then(blob => {
      return new Promise((resolveBase64, rejectBase64) => {
        const reader = new FileReader();
        reader.onloadend = () => resolveBase64(reader.result);
        reader.onerror = rejectBase64;
        reader.readAsDataURL(blob);
      });
    })
    .catch(() => blobUrl);
};

export const saveImageToDB = (record) => {
  return new Promise((resolve, reject) => {
    convertBlobToBase64(record.image).then(base64Image => {
      initDB().then(() => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        const simpleRecord = {
          id: record.id,
          imageData: base64Image,
          prompt: record.prompt,
          seed: record.seed,
          numInferenceSteps: record.numInferenceSteps,
          guidanceScale: record.guidanceScale,
          timestamp: record.timestamp,
          date: record.date
        };

        const request = store.put(simpleRecord);

        request.onsuccess = () => resolve(simpleRecord);
        request.onerror = () => reject(request.error);
      }).catch(reject);
    }).catch(reject);
  });
};

export const getAllImagesFromDB = () => {
  return new Promise((resolve, reject) => {
    initDB().then(() => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(reject);
  });
};

export const deleteImageFromDB = (id) => {
  return new Promise((resolve, reject) => {
    initDB().then(() => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }).catch(reject);
  });
};

export const clearAllImagesFromDB = () => {
  return new Promise((resolve, reject) => {
    initDB().then(() => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }).catch(reject);
  });
};
