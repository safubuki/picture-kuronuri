/**
 * 端末内に保存されたOCR言語データの状態確認・削除。
 *
 * tesseract.js は初回のOCR時に言語データを取得し、idb-keyval の既定ストア
 * （IndexedDB "keyval-store" / "keyval"）へ `./<言語>.traineddata` として保存する。
 * ここではそのストアを直接読み、設定画面に実際の保存状態と容量を表示する。
 */

const OCR_DB_NAME = "keyval-store";
const OCR_STORE_NAME = "keyval";
const TRAINEDDATA_SUFFIX = ".traineddata";
/** ocr.ts の既定言語（jpn+eng）。両方そろって初めて「保存済み」とする。 */
export const OCR_REQUIRED_LANGUAGES = ["jpn", "eng"] as const;

export interface OcrLanguageCacheStats {
  isCached: boolean;
  sizeBytes: number;
  languages: string[];
}

export interface CacheStorageStats {
  totalBytes: number;
  itemsCount: number;
  models: { ocr: OcrLanguageCacheStats };
}

function emptyStats(): CacheStorageStats {
  return { totalBytes: 0, itemsCount: 0, models: { ocr: { isCached: false, sizeBytes: 0, languages: [] } } };
}

function byteLengthOf(value: unknown): number {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;
  if (typeof value === "string") return value.length;
  return 0;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * idb-keyval と同じ手順でストアを開く。DBが未作成のときに空のDBだけを作ると、
 * 後から tesseract.js がストアを作れず保存に失敗するため、ストアも同時に作成する。
 */
function openOcrStore(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(OCR_DB_NAME);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OCR_STORE_NAME)) {
        request.result.createObjectStore(OCR_STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OCR_STORE_NAME)) {
        db.close();
        resolve(null);
        return;
      }
      resolve(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function languageOf(key: IDBValidKey): string | null {
  if (typeof key !== "string" || !key.endsWith(TRAINEDDATA_SUFFIX)) return null;
  const name = key.slice(key.lastIndexOf("/") + 1, -TRAINEDDATA_SUFFIX.length);
  return name || null;
}

export class ModelCacheManager {
  /** 保存済みのOCR言語データの合計容量と内訳を取得する。 */
  static async getCacheStorageStats(): Promise<CacheStorageStats> {
    const db = await openOcrStore();
    if (!db) return emptyStats();
    try {
      const store = db.transaction(OCR_STORE_NAME, "readonly").objectStore(OCR_STORE_NAME);
      const keys = await requestToPromise(store.getAllKeys());
      const languages: string[] = [];
      let sizeBytes = 0;
      for (const key of keys) {
        const language = languageOf(key);
        if (!language) continue;
        sizeBytes += byteLengthOf(await requestToPromise(store.get(key)));
        languages.push(language);
      }
      const isCached = OCR_REQUIRED_LANGUAGES.every((language) => languages.includes(language));
      return { totalBytes: sizeBytes, itemsCount: languages.length, models: { ocr: { isCached, sizeBytes, languages } } };
    } catch (e) {
      console.warn("[ModelCacheManager] Failed to read OCR language data:", e);
      return emptyStats();
    } finally {
      db.close();
    }
  }

  /** 保存済みのOCR言語データを削除する。次回のOCR開始時に再取得される。 */
  static async clearAll(): Promise<boolean> {
    const db = await openOcrStore();
    if (!db) return false;
    try {
      const transaction = db.transaction(OCR_STORE_NAME, "readwrite");
      const store = transaction.objectStore(OCR_STORE_NAME);
      const keys = await requestToPromise(store.getAllKeys());
      for (const key of keys) {
        if (languageOf(key)) store.delete(key);
      }
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      return true;
    } catch (e) {
      console.warn("[ModelCacheManager] Failed to delete OCR language data:", e);
      return false;
    } finally {
      db.close();
    }
  }
}
