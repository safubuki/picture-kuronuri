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
const { LOCAL_LLM_MODEL_ID } = require('../src/engine/localLlmConfig.ts');

const APP_CACHE = 'kuronuri-models-cache-v1';
const TF_CACHE = 'transformers-cache';
const WEIGHT_BYTES = 570_000_000;
const modelUrl = (file, revision = 'main', id = LOCAL_LLM_MODEL_ID) =>
  `https://huggingface.co/${id}/resolve/${revision}/${file}`;

class MemoryCache {
  entries = new Map();
  async keys() { return [...this.entries.keys()].map((url) => new Request(url)); }
  async match(key) { return this.entries.get(typeof key === 'string' ? key : key.url); }
  async put(key, response) { this.entries.set(typeof key === 'string' ? key : key.url, response); }
  async delete(key) { return this.entries.delete(typeof key === 'string' ? key : key.url); }
}

let cacheMap;
function resetCache() {
  cacheMap = new Map();
  global.window = { caches: true };
  global.caches = {
    open: async (name) => {
      if (!cacheMap.has(name)) cacheMap.set(name, new MemoryCache());
      return cacheMap.get(name);
    },
    delete: async (name) => cacheMap.delete(name)
  };
}

// 大容量モデルをダウンロードせず、Cache API のレスポンス情報を再現する。
async function cachedFile(url, size = 100, { cacheName = TF_CACHE, status = 200, headers = {} } = {}) {
  const response = {
    status,
    headers: new Headers({ 'content-length': String(size), ...headers }),
    clone() { return this; },
    blob: async () => ({ size })
  };
  await (await caches.open(cacheName)).put(url, response);
}

async function metadata({ revision = 'main', id = LOCAL_LLM_MODEL_ID, cacheName = TF_CACHE } = {}) {
  for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) {
    await cachedFile(modelUrl(file, revision, id), 100, { cacheName });
  }
}

let passed = 0;
async function test(name, run) {
  resetCache();
  try {
    await run();
    passed++;
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok - ${name}\n${error.stack || error}\n`);
    process.exitCode = 1;
  }
}

(async () => {
  await test('旧 Qwen2.5 だけでは Qwen3 を保存済みにしない', async () => {
    const id = 'onnx-community/Qwen2.5-0.5B-Instruct';
    await metadata({ id });
    await cachedFile(modelUrl('onnx/model_q4.onnx', 'main', id), 786_000_000);
    const stats = await ModelCacheManager.getCacheStorageStats();
    assert.equal(stats.models.llm.isCached, false);
    assert.equal(stats.models.llm.sizeBytes, 786_000_300);
    assert.equal(stats.itemsCount, 4);
    assert.equal((await (await caches.open(TF_CACHE)).keys()).length, 4);
  });

  await test('設定・トークナイザーだけ取得した失敗状態を保存済みにしない', async () => {
    await metadata();
    assert.equal((await ModelCacheManager.getCacheStorageStats()).models.llm.isCached, false);
  });

  await test('重みだけでは必要な設定不足として保存済みにしない', async () => {
    await cachedFile(modelUrl('onnx/model_q4f16.onnx'), WEIGHT_BYTES);
    assert.equal((await ModelCacheManager.getCacheStorageStats()).models.llm.isCached, false);
  });

  await test('重みのダウンロード失敗後も未保存のままにする', async () => {
    await metadata();
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.error(new Error('Download interrupted'));
      }
    }), { headers: { 'content-length': String(WEIGHT_BYTES) } });
    try {
      await assert.rejects(ModelCacheManager.fetchAndCache(modelUrl('onnx/model_q4f16.onnx')), /Download interrupted/);
      assert.equal(await ModelCacheManager.has(modelUrl('onnx/model_q4f16.onnx')), false);
      assert.equal((await ModelCacheManager.getCacheStorageStats()).models.llm.isCached, false);
    } finally {
      global.fetch = originalFetch;
    }
  });

  for (const [name, options, size] of [
    ['空ファイル', {}, 0],
    ['小さな途中ファイル', {}, 100],
    ['206 部分レスポンス', { status: 206 }, WEIGHT_BYTES],
    ['Content-Range 付きレスポンス', { headers: { 'content-range': 'bytes 0-569999999/919000000' } }, WEIGHT_BYTES],
    ['エラーレスポンス', { status: 500 }, WEIGHT_BYTES]
  ]) {
    await test(`${name}を保存済みにしない`, async () => {
      await metadata();
      await cachedFile(modelUrl('onnx/model_q4f16.onnx'), size, options);
      assert.equal((await ModelCacheManager.getCacheStorageStats()).models.llm.isCached, false);
    });
  }

  for (const file of ['onnx/model_q4f16.onnx', 'onnx/model_q4.onnx']) {
    await test(`${file} と必須ファイルの保存を認識する`, async () => {
      await metadata();
      await cachedFile(modelUrl(file), WEIGHT_BYTES);
      assert.equal((await ModelCacheManager.getCacheStorageStats()).models.llm.isCached, true);
    });
  }

  await test('別モデル・別配布元・類似ファイル名を現在モデルと混同しない', async () => {
    await metadata({ id: 'someone-else/Qwen3-0.6B-ONNX' });
    await cachedFile(modelUrl('onnx/model_q4f16.onnx', 'main', 'someone-else/Qwen3-0.6B-ONNX'), WEIGHT_BYTES);
    await metadata();
    await cachedFile(modelUrl('onnx/model_q4f16.onnx_data'), WEIGHT_BYTES);
    await cachedFile(modelUrl('onnx/model_q4f16.onnx').replace('huggingface.co', 'example.com'), WEIGHT_BYTES);
    await cachedFile(`https://example.com/file?url=${modelUrl('onnx/model_q4f16.onnx')}`, WEIGHT_BYTES);
    assert.equal((await ModelCacheManager.getCacheStorageStats()).models.llm.isCached, false);
  });

  await test('異なる revision の設定と重みを合成して保存済みにしない', async () => {
    await metadata({ revision: 'old-commit' });
    await cachedFile(modelUrl('onnx/model_q4f16.onnx', 'new-commit'), WEIGHT_BYTES);
    assert.equal((await ModelCacheManager.getCacheStorageStats()).models.llm.isCached, false);
  });

  await test('同じモデルを二つのキャッシュに分けて保存しても認識する', async () => {
    await metadata({ cacheName: APP_CACHE });
    await cachedFile(modelUrl('onnx/model_q4f16.onnx'), WEIGHT_BYTES);
    const stats = await ModelCacheManager.getCacheStorageStats();
    assert.equal(stats.models.llm.isCached, true);
    assert.equal(stats.itemsCount, 4);
    assert.equal(stats.totalBytes, WEIGHT_BYTES + 300);
  });

  await test('旧新の LLM は共存でき、LLM 削除で OCR・NER を保持する', async () => {
    await metadata();
    await cachedFile(modelUrl('onnx/model_q4f16.onnx'), WEIGHT_BYTES);
    await cachedFile(modelUrl('onnx/model_q4.onnx', 'main', 'onnx-community/Qwen2.5-0.5B-Instruct'), 786_000_000);
    await cachedFile(modelUrl('generation_config.json', 'main', 'onnx-community/Qwen2.5-0.5B-Instruct'), 100);
    const ocrUrl = 'https://example.com/tesseract/jpn.traineddata';
    const nerUrl = 'https://huggingface.co/onnx-community/bert-ner/resolve/main/model.onnx';
    await cachedFile(ocrUrl, 5_000_000, { cacheName: APP_CACHE });
    await cachedFile(nerUrl, 1_000_000);
    const before = await ModelCacheManager.getCacheStorageStats();
    assert.equal(before.models.llm.isCached, true);
    assert.equal(before.models.llm.sizeBytes, WEIGHT_BYTES + 786_000_400);
    assert.equal(await ModelCacheManager.clearCategory('llm'), 6);
    const after = await ModelCacheManager.getCacheStorageStats();
    assert.equal(after.models.llm.isCached, false);
    assert.equal(after.models.llm.sizeBytes, 0);
    assert.equal(after.models.ocr.isCached, true);
    assert.equal(after.models.ner.isCached, true);
    assert.equal(after.totalBytes, 6_000_000);
    assert.equal(after.itemsCount, 2);
  });

  process.stdout.write(`model cache regression: ${passed} passed\n`);
})();
