/**
 * 端末内AIモデル・データの永続ローカルキャッシュマネージャー
 * ブラウザ標準の Cache API を使用し、初回ダウンロード後は外部通信を100%遮断して
 * 端末ストレージからミリ秒単位で高速復元する。
 */

const CACHE_NAME = 'kuronuri-models-cache-v1';

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
      let hasLlm = false;

      for (const req of requests) {
        const res = await cache.match(req);
        if (res) {
          const lenStr = res.headers.get('content-length');
          let size = lenStr ? parseInt(lenStr, 10) : 0;
          if (!size) {
            // ヘッダーに無ければ blob サイズで取得
            const blob = await res.clone().blob();
            size = blob.size;
          }
          totalBytes += size;

          const url = req.url.toLowerCase();
          if (url.includes('ner') || url.includes('bert')) {
            hasNer = true;
            nerBytes += size;
          } else if (url.includes('tesseract') || url.includes('jpn') || url.includes('ocr')) {
            hasOcr = true;
            ocrBytes += size;
          } else if (url.includes('qwen') || url.includes('llm')) {
            hasLlm = true;
            llmBytes += size;
          }
        }
      }

      // transformers-cache も合算・確認
      if ('caches' in window) {
        try {
          const tfCache = await caches.open('transformers-cache');
          if (tfCache) {
            const tfKeys = await tfCache.keys();
            for (const req of tfKeys) {
              const res = await tfCache.match(req);
              if (res) {
                const lenStr = res.headers.get('content-length');
                let size = lenStr ? parseInt(lenStr, 10) : 0;
                if (!size) {
                  const blob = await res.clone().blob();
                  size = blob.size;
                }
                totalBytes += size;
                const url = req.url.toLowerCase();
                if (url.includes('qwen') || url.includes('0.5b')) {
                  hasLlm = true;
                  llmBytes += size;
                } else if (url.includes('ner') || url.includes('bert')) {
                  hasNer = true;
                  nerBytes += size;
                }
              }
            }
          }
        } catch {
          // ignore
        }
      }

      return {
        totalBytes,
        itemsCount: requests.length,
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
            const url = req.url.toLowerCase();
            let match = false;
            if (category === 'ner' && (url.includes('ner') || url.includes('bert'))) match = true;
            if (category === 'ocr' && (url.includes('tesseract') || url.includes('jpn') || url.includes('ocr'))) match = true;
            if (category === 'llm' && (url.includes('qwen') || url.includes('llm') || url.includes('0.5b'))) match = true;

            if (match) {
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
