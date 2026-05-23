/**
 * Helper module to manage linking a local file using the File System Access API
 * and persisting the file handle in IndexedDB.
 */
const LocalFileLinker = {
  DB_NAME: 'LocalFileLinkerDB',
  STORE_NAME: 'fileHandles',
  KEY_NAME: 'linkedFile',

  /**
   * Open or create the IndexedDB database.
   */
  _openDB: () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(LocalFileLinker.DB_NAME, 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(LocalFileLinker.STORE_NAME)) {
          db.createObjectStore(LocalFileLinker.STORE_NAME);
        }
      };
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    });
  },

  /**
   * Retrieve the stored FileSystemFileHandle from IndexedDB wrapped in a LinkedFile instance.
   */
  getStoredHandle: async (key) => {
    try {
      const db = await LocalFileLinker._openDB();
      const handle = await new Promise((resolve, reject) => {
        const transaction = db.transaction(LocalFileLinker.STORE_NAME, 'readonly');
        const store = transaction.objectStore(LocalFileLinker.STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });

      return handle ? new LinkedFile(handle, key) : null;
    } catch (err) {
      console.error('Failed to retrieve file handle from IndexedDB:', err);
      return null;
    }
  },

  /**
   * Store a FileSystemFileHandle in IndexedDB.
   */
  storeHandle: async (handle, key) => {
    const db = await LocalFileLinker._openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(LocalFileLinker.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(LocalFileLinker.STORE_NAME);
      const request = store.put(handle, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Remove the stored FileSystemFileHandle from IndexedDB.
   */
  clearHandle: async (key) => {
    const db = await LocalFileLinker._openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(LocalFileLinker.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(LocalFileLinker.STORE_NAME);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Prompt user to pick a file to link.
   * Returns a LinkedFile instance on success, or null if aborted.
   */
  pickAndLinkFile: async (key) => {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{
          description: 'JSON Files',
          accept: {
            'application/json': ['.json'],
          },
        }],
      });

      if (handle) {
        await LocalFileLinker.storeHandle(handle, key);
        return new LinkedFile(handle, key);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error selecting file:', err);
        throw err;
      }
    }
    return null;
  },

  /**
   * Create a new file to link to.
   * Returns a LinkedFile instance on success, or null if aborted.
   */
  createAndLinkFile: async (suggestedName = 'data.json', key) => {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggestedName,
        types: [{
          description: 'JSON Files',
          accept: {
            'application/json': ['.json'],
          },
        }],
      });

      if (handle) {
        await LocalFileLinker.storeHandle(handle, key);
        return new LinkedFile(handle, key);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error creating file:', err);
        throw err;
      }
    }
    return null;
  }
};

/**
 * Represents a wrapper class around FileSystemFileHandle to provide direct
 * methods for checking permissions, reading, writing, and clearing the link.
 */
class LinkedFile {
  constructor(fileHandle, key) {
    this.fileHandle = fileHandle;
    this.key = key;
  }

  /**
   * Verify read/write permission, prompting the user if necessary.
   */
  async verifyPermission(readWrite = true) {
    const options = {};
    if (readWrite) {
      options.mode = 'readwrite';
    }
    if ((await this.fileHandle.queryPermission(options)) === 'granted') {
      return true;
    }
    if ((await this.fileHandle.requestPermission(options)) === 'granted') {
      return true;
    }
    return false;
  }

  /**
   * Check if the permission is granted without prompting.
   */
  async checkPermission(readWrite = true) {
    const options = {};
    if (readWrite) {
      options.mode = 'readwrite';
    }
    return (await this.fileHandle.queryPermission(options)) === 'granted';
  }

  /**
   * Read the JSON data from the linked file.
   */
  async read() {
    const file = await this.fileHandle.getFile();
    const contents = await file.text();
    return contents ? JSON.parse(contents) : null;
  }

  /**
   * Write JSON data directly to the linked file.
   */
  async write(data) {
    const writable = await this.fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  }

  /**
   * Clear the file link state.
   */
  async clear() {
    await LocalFileLinker.clearHandle(this.key);
  }
}
