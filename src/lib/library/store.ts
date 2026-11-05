import type { LibraryAsset, SavedPost } from './types';

export function libraryStore(name: string) {
  let opening: Promise<IDBDatabase> | undefined;
  function open() {
    if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('posts')) request.result.createObjectStore('posts', { keyPath: 'id' });
        if (!request.result.objectStoreNames.contains('assets')) request.result.createObjectStore('assets', { keyPath: 'key' });
        const assets = request.transaction!.objectStore('assets');
        if (!assets.indexNames.contains('postId')) assets.createIndex('postId', 'postId');
      };
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = undefined; }; resolve(request.result); };
      request.onerror = () => { opening = undefined; reject(new Error('Local storage could not be opened. Check browser storage permissions.')); };
      request.onblocked = () => { opening = undefined; reject(new Error('Close other Memoar tabs and retry.')); };
    });
    return opening;
  }
  async function read<T>(store: string, key?: IDBValidKey, index?: string): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const request = index ? tx.objectStore(store).index(index).getAll(key) : key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
      tx.oncomplete = () => resolve(request.result as T);
      tx.onabort = tx.onerror = () => reject(new Error('Could not read the local library.'));
    });
  }
  async function write(action: (posts: IDBObjectStore, assets: IDBObjectStore) => void) {
    const db = await open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['posts', 'assets'], 'readwrite');
      action(tx.objectStore('posts'), tx.objectStore('assets'));
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error('Could not save changes. Browser storage may be full.'));
    });
  }
  return {
    list: () => read<SavedPost[]>('posts'),
    get: (id: string) => read<SavedPost | undefined>('posts', id),
    assets: async (id: string) => (await read<(LibraryAsset & { key: string; postId: string })[]>('assets', id, 'postId')).filter(asset => !asset.temporaryUntil || asset.temporaryUntil > Date.now()),
    put: (post: SavedPost, assets?: LibraryAsset[]) => write((posts, store) => {
      posts.put(post);
      if (assets) for (const asset of assets) store.put({ ...asset, key: `${post.id}:${asset.itemIndex}`, postId: post.id });
    }),
    update: async (id: string, update: (post: SavedPost) => SavedPost) => write(posts => {
      const request = posts.get(id);
      request.onsuccess = () => { if (request.result) posts.put(update(request.result as SavedPost)); };
    }),
    cacheAsset: (id: string, asset: LibraryAsset) => write((posts, assets) => {
      const request = posts.get(id);
      request.onsuccess = () => { if (request.result) assets.put({ ...asset, key: `${id}:${asset.itemIndex}`, postId: id }); };
    }),
    remove: (id: string) => write((posts, assets) => {
      posts.delete(id);
      const request = assets.openCursor();
      request.onsuccess = () => { const cursor = request.result; if (cursor) { if (cursor.value.postId === id) cursor.delete(); cursor.continue(); } };
    }),
    clear: () => write((posts, assets) => { posts.clear(); assets.clear(); }),
    reconcile: (records: SavedPost[]) => write((posts, assets) => {
      const ids = new Set(records.map(post => post.id));
      const old = posts.openCursor();
      old.onsuccess = () => { const cursor = old.result; if (cursor) { if (!ids.has(String(cursor.key))) cursor.delete(); cursor.continue(); } };
      const media = assets.openCursor();
      media.onsuccess = () => { const cursor = media.result; if (cursor) { if (!ids.has(cursor.value.postId)) cursor.delete(); cursor.continue(); } };
      for (const post of records) posts.put(post);
    }),
    purgeTemporary: () => write((_posts, assets) => {
      const request = assets.openCursor();
      request.onsuccess = () => { const cursor = request.result; if (cursor) { if (cursor.value.temporaryUntil && cursor.value.temporaryUntil <= Date.now()) cursor.delete(); cursor.continue(); } };
    }),
    dropTemporary: (id: string, savedAt: string) => write((posts, assets) => {
      const post = posts.get(id);
      post.onsuccess = () => {
        if (!post.result || post.result.savedAt !== savedAt) return;
        const request = assets.index('postId').openCursor(IDBKeyRange.only(id));
        request.onsuccess = () => { const cursor = request.result; if (cursor) { if (cursor.value.temporaryUntil) cursor.delete(); cursor.continue(); } };
      };
    }),
  };
}
