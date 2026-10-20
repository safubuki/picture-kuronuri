/**
 * 端末内AIモデル・データの永続ローカルキャッシュマネージャー
 * ブラウザ標準の Cache API を使用し、初回ダウンロード後は外部通信を100%遮断して
 * 端末ストレージからミリ秒単位で高速復元する。
 */

import { LOCAL_LLM_DTYPES, LOCAL_LLM_MODEL_ID } from './localLlmConfig';

const CACHE_NAME = 'kuronuri-models-cache-v1';
const REQUIRED_LLM_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json'];
const LLM_WEIGHT_FILES = LOCAL_LLM_DTYPES.map((dtype) => `onnx/model_${dtype}.onnx`);
// 配布されている Qwen3 重みは 500 MB 以上。エラーページや小さな途中ファイルを除外する。
const MIN_LLM_WEIGHT_BYTES = 100 * 1024 * 1024;

function getCurrentLlmFile(url: string): { revision: string; file: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'huggingface.co' && parsed.hostname !== 'hf.co') return null;
    const prefix = `/${LOCAL_LLM_MODEL_ID}/resolve/`;
    const path = decodeURIComponent(parsed.pathname);
    if (!path.startsWith(prefix)) return null;
    const suffix = path.slice(prefix.length);
    const separator = suffix.indexOf('/');
    if (separator <= 0) return null;
    return { revision: suffix.slice(0, separator), file: suffix.slice(separator + 1) };
  } catch {
    return null;
  }
}

function getModelCategory(url: string): 'ocr' | 'ner' | 'llm' | null {
  if (getCurrentLlmFile(url)) return 'llm';
  try {
    const path = decodeURIComponent(new URL(url).pathname).toLowerCase();
    // 移行前の Qwen2.5 も容量集計・ユーザーが指定する LLM 削除の対象に残す。
    if (path.includes('qwen') || path.includes('llm') || path.includes('0.5b')) return 'llm';
    if (path.includes('ner') || path.includes('bert')) return 'ner';
    if (path.includes('tesseract') || path.includes('jpn') || path.includes('ocr')) return 'ocr';
  } catch {
    // URL として解釈できないキーはモデル判定に使用しない。
  }
  return null;
}

export interface ModelCacheItem {
  id: string;
  name: string;
  category: 'ocr' | 'ner' | 'llm';
  sizeBytes: number;
  isCached: boolean;
  lastUpdated?: number;
}

export class ModelCacheManager {
  /**
   * CacheStorage インスタンスの取得
   */
  private static async getCache(): Promise<Cache | null> {
    if (typeof window === 'undefined' || !('caches' in window)) {
      return null;
    }
    try {
      return await caches.open(CACHE_NAME);
    } catch (e) {
      console.warn('[ModelCacheManager] Cache API not accessible:', e);
      return null;
    }
  }

  /**
   * 指定したキーまたはURLがキャッシュに存在するか判定
   */
  static async has(urlOrKey: string): Promise<boolean> {
    const cache = await this.getCache();
    if (!cache) return false;
    try {
      const match = await cache.match(urlOrKey);
      return !!match;
    } catch {
      return false;
    }
  }

  /**
   * キャッシュから Response を直接取得
   */
  static async get(urlOrKey: string): Promise<Response | null> {
    const cache = await this.getCache();
    if (!cache) return null;
    try {
      return (await cache.match(urlOrKey)) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * キャッシュから ArrayBuffer を直接取得（0ms復元）
   */
  static async getBuffer(urlOrKey: string): Promise<ArrayBuffer | null> {
    const res = await this.get(urlOrKey);
    if (!res) return null;
    try {
      return await res.arrayBuffer();
    } catch {
      return null;
    }
  }

  /**
   * データをキャッシュに永続保存
   */
  static async put(urlOrKey: string, data: ArrayBuffer | Blob | string, contentType = 'application/octet-stream'): Promise<void> {
    const cache = await this.getCache();
    if (!cache) return;
    try {
      let byteLength = 0;
      if (typeof data === 'string') {
        byteLength = new Blob([data]).size;
      } else if (data instanceof Blob) {
        byteLength = data.size;
      } else if (data instanceof ArrayBuffer) {
        byteLength = data.byteLength;
      }

      const response = new Response(data, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': `${byteLength}`,
          'X-Kuronuri-Cached-At': `${Date.now()}`
        }
      });
      await cache.put(urlOrKey, response);
    } catch (e) {
      console.warn('[ModelCacheManager] Failed to put into cache:', e);
    }
  }

  /**
   * プログレス付きで取得し、同時に永続キャッシュに保存する（Cache-First）
   */
  static async fetchAndCache(
    url: string,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<ArrayBuffer> {
    // 1. キャッシュを最優先確認
    const cachedBuffer = await this.getBuffer(url);
    if (cachedBuffer && cachedBuffer.byteLength > 0) {
      onProgress?.(cachedBuffer.byteLength, cachedBuffer.byteLength);
      return cachedBuffer;
    }

    // 2. キャッシュにない場合のみネットワークからダウンロード
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }

    const contentLengthHeader = response.headers.get('content-length');
    const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

    if (!response.body) {
      const buffer = await response.arrayBuffer();
      await this.put(url, buffer);
      onProgress?.(buffer.byteLength, buffer.byteLength);
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        receivedBytes += value.length;
        onProgress?.(receivedBytes, totalBytes || receivedBytes);
      }
    }

    const completeBuffer = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      completeBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // 永続保存
    await this.put(url, completeBuffer.buffer);
    return completeBuffer.buffer;
  }

  /**
   * 保存済みモデル全体の合計サイズと内訳を取得
   */
  static async getCacheStorageStats(): Promise<{
    totalBytes: number;
    itemsCount: number;
    models: {
      ner: { isCached: boolean; sizeBytes: number };
      ocr: { isCached: boolean; sizeBytes: number };
      llm: { isCached: boolean; sizeBytes: number };
    };
  }> {
    const cache = await this.getCache();
    if (!cache) {
      return {
        totalBytes: 0,
        itemsCount: 0,
        models: {
          ner: { isCached: false, sizeBytes: 0 },
          ocr: { isCached: false, sizeBytes: 0 },
          llm: { isCached: false, sizeBytes: 0 }
        }
      };
    }

    try {
      const requests = await cache.keys();
      let totalBytes = 0;
      let nerBytes = 0;
      let ocrBytes = 0;
      let llmBytes = 0;
      let hasNer = false;
      let hasOcr = false;
      let itemsCount = 0;
      const currentLlmFiles = new Map<string, Set<string>>();

      const collectStats = async (modelCache: Cache, keys: readonly Request[]) => {
        for (const req of keys) {
          const res = await modelCache.match(req);
          if (!res) continue;
          const lenStr = res.headers.get('content-length');
          let size = lenStr ? Number(lenStr) : 0;
          if (!Number.isFinite(size) || size <= 0) {
            // ヘッダーが無い場合のみ本体を読み、大容量の重みを重複展開しない。
            size = (await res.clone().blob()).size;
          }
          totalBytes += size;
          itemsCount++;

          const category = getModelCategory(req.url);
          if (category === 'ner') {
            hasNer = true;
            nerBytes += size;
          } else if (category === 'ocr') {
            hasOcr = true;
            ocrBytes += size;
          } else if (category === 'llm') {
            llmBytes += size;
          }

          const currentFile = getCurrentLlmFile(req.url);
          if (!currentFile || res.status !== 200 || res.headers.has('content-range') || size <= 0) continue;
          if (LLM_WEIGHT_FILES.includes(currentFile.file) && size < MIN_LLM_WEIGHT_BYTES) continue;
          let files = currentLlmFiles.get(currentFile.revision);
          if (!files) {
            files = new Set<string>();
            currentLlmFiles.set(currentFile.revision, files);
          }
          files.add(currentFile.file);
        }
      };

      await collectStats(cache, requests);

      // transformers-cache も合算し、移行先モデルの必須ファイルを確認する。
      if ('caches' in window) {
        try {
          const tfCache = await caches.open('transformers-cache');
          if (tfCache) {
            await collectStats(tfCache, await tfCache.keys());
          }
        } catch {
          // ignore
        }
      }

      const hasLlm = [...currentLlmFiles.values()].some((files) =>
        REQUIRED_LLM_FILES.every((file) => files.has(file)) && LLM_WEIGHT_FILES.some((file) => files.has(file))
      );

      return {
        totalBytes,
        itemsCount,
        models: {
          ner: { isCached: hasNer, sizeBytes: nerBytes },
          ocr: { isCached: hasOcr, sizeBytes: ocrBytes },
          llm: { isCached: hasLlm, sizeBytes: llmBytes }
        }
      };
    } catch (e) {
      console.warn('[ModelCacheManager] Failed to read cache stats:', e);
      return {
        totalBytes: 0,
        itemsCount: 0,
        models: {
          ner: { isCached: false, sizeBytes: 0 },
          ocr: { isCached: false, sizeBytes: 0 },
          llm: { isCached: false, sizeBytes: 0 }
        }
      };
    }
  }

  /**
   * 全てのモデルキャッシュを削除（端末容量を解放）
   */
  static async clearAll(): Promise<boolean> {
    if (typeof window === 'undefined' || !('caches' in window)) return false;
    try {
      await caches.delete(CACHE_NAME);
      await caches.delete('transformers-cache');
      return true;
    } catch (e) {
      console.warn('[ModelCacheManager] Failed to delete cache:', e);
      return false;
    }
  }

  /**
   * カテゴリ指定でキャッシュを削除（例: llm のみ削除）
   */
  static async clearCategory(category: 'ner' | 'ocr' | 'llm'): Promise<number> {
    let deleted = 0;
    try {
      const cacheList = [CACHE_NAME, 'transformers-cache'];
      for (const cName of cacheList) {
        if (!('caches' in window)) continue;
        try {
          const cache = await caches.open(cName);
          const requests = await cache.keys();
          for (const req of requests) {
            if (getModelCategory(req.url) === category) {
              await cache.delete(req);
              deleted++;
            }
          }
        } catch {
          // ignore
        }
      }
      return deleted;
    } catch {
      return deleted;
    }
  }
}
