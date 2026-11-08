const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (loaded, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename
  });
  loaded._compile(compiled.outputText, filename);
};

const { ModelCacheManager } = require('../src/engine/modelCache.ts');

// tesseract.js（idb-keyval）が使う IndexedDB の最小限の代替。
// 成功イベントは実ブラウザと同様に非同期タスクで通知する。
function createFakeIndexedDb() {
  const databases = new Map();
  const later = (fn) => setTimeout(fn, 0);

  function makeRequest(tx, run) {
    const request = { result: undefined, error: null, onsuccess: null, onerror: null };
    if (tx) tx.pending++;
    later(() => {
      request.result = run();
      request.onsuccess?.();
      if (tx) tx.finish();
    });
    return request;
  }

  function makeDb(name) {
    const stores = databases.get(name);
    return {
      objectStoreNames: { contains: (store) => stores.has(store) },
      createObjectStore: (store) => { stores.set(store, new Map()); },
      close() {},
      transaction(storeName) {
        const tx = {
          pending: 0,
          oncomplete: null,
          onerror: null,
          onabort: null,
          finish() {
            this.pending--;
            later(() => { if (this.pending === 0) this.oncomplete?.(); });
          },
          objectStore() {
            const data = stores.get(storeName);
            return {
              getAllKeys: () => makeRequest(tx, () => [...data.keys()]),
              get: (key) => makeRequest(tx, () => data.get(key)),
              delete: (key) => makeRequest(tx, () => { data.delete(key); })
            };
          }
        };
        return tx;
      }
    };
  }

  return {
    databases,
    open(name) {
      const request = { result: undefined, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      later(() => {
        const isNew = !databases.has(name);
        if (isNew) databases.set(name, new Map());
        request.result = makeDb(name);
        if (isNew) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
}

function seed(fakeDb, entries) {
  fakeDb.databases.set('keyval-store', new Map([['keyval', new Map(entries)]]));
}

let passed = 0;
async function test(name, fn) {
  try {
    global.indexedDB = createFakeIndexedDb();
    await fn(global.indexedDB);
    passed++;
    process.stdout.write('.');
  } catch (error) {
    process.exitCode = 1;
    console.error(`\nFAIL: ${name}`);
    console.error(error);
  }
}

(async () => {
  await test('未取得なら0件を返し、tesseract.js が保存できるようにストアを作成する', async (fakeDb) => {
    const stats = await ModelCacheManager.getCacheStorageStats();
    assert.equal(stats.totalBytes, 0);
    assert.equal(stats.itemsCount, 0);
    assert.equal(stats.models.ocr.isCached, false);
    assert.deepEqual(stats.models.ocr.languages, []);
    assert.equal(fakeDb.databases.get('keyval-store').has('keyval'), true);
  });

  await test('日本語・英語の両方があれば保存済みとし、容量を合算する', async (fakeDb) => {
    seed(fakeDb, [
      ['./jpn.traineddata', new Uint8Array(3_000)],
      ['./eng.traineddata', new Uint8Array(5_000)],
      ['unrelated-key', new Uint8Array(9_999)]
    ]);
    const stats = await ModelCacheManager.getCacheStorageStats();
    assert.equal(stats.models.ocr.isCached, true);
    assert.equal(stats.models.ocr.sizeBytes, 8_000);
    assert.equal(stats.totalBytes, 8_000);
    assert.equal(stats.itemsCount, 2);
    assert.deepEqual([...stats.models.ocr.languages].sort(), ['eng', 'jpn']);
  });

  await test('片方の言語しかなければ保存済みにしない', async (fakeDb) => {
    seed(fakeDb, [['./jpn.traineddata', new Uint8Array(3_000)]]);
    const stats = await ModelCacheManager.getCacheStorageStats();
    assert.equal(stats.models.ocr.isCached, false);
    assert.deepEqual(stats.models.ocr.languages, ['jpn']);
    assert.equal(stats.models.ocr.sizeBytes, 3_000);
  });

  await test('削除はOCR言語データだけを消し、他のキーは残す', async (fakeDb) => {
    seed(fakeDb, [
      ['./jpn.traineddata', new Uint8Array(3_000)],
      ['./eng.traineddata', new Uint8Array(5_000)],
      ['unrelated-key', 'keep']
    ]);
    assert.equal(await ModelCacheManager.clearAll(), true);
    const store = fakeDb.databases.get('keyval-store').get('keyval');
    assert.deepEqual([...store.keys()], ['unrelated-key']);
    const stats = await ModelCacheManager.getCacheStorageStats();
    assert.equal(stats.models.ocr.isCached, false);
    assert.equal(stats.totalBytes, 0);
  });

  await test('IndexedDB が使えない環境では空の結果と削除失敗を返す', async () => {
    delete global.indexedDB;
    const stats = await ModelCacheManager.getCacheStorageStats();
    assert.equal(stats.models.ocr.isCached, false);
    assert.equal(await ModelCacheManager.clearAll(), false);
  });

  if (!process.exitCode) process.stdout.write(`\n${passed} OCR language cache checks passed.\n`);
})();
