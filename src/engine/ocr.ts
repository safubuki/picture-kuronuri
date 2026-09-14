import { createWorker, type Worker } from "tesseract.js";

export interface OcrProgress {
  status: string;
  progress: number;
}

export interface OcrChar {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export interface OcrLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: {
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    confidence: number;
  }[];
  symbols: OcrChar[];
}

export interface OcrResult {
  fullText: string;
  lines: OcrLine[];
  symbols: OcrChar[];
}

let cachedWorker: Worker | null = null;
let currentLanguage: string = "jpn+eng";

/**
 * Tesseract.js Web Worker の初期化または取得
 */
export async function getOcrWorker(
  lang: string = "jpn+eng",
  onProgress?: (p: OcrProgress) => void
): Promise<Worker> {
  if (cachedWorker && currentLanguage === lang) {
    return cachedWorker;
  }

  if (cachedWorker) {
    await cachedWorker.terminate();
    cachedWorker = null;
  }

  const worker = await createWorker(lang, 1, {
    logger: (m: { status: string; progress: number }) => {
      if (onProgress && typeof m.progress === "number") {
        onProgress({
          status: m.status || "処理中...",
          progress: Math.min(1, Math.max(0, m.progress))
        });
      }
    }
  });

  cachedWorker = worker;
  currentLanguage = lang;
  return worker;
}

/**
 * 画像に対してOCRを実行し、行・単語・文字単位の詳細なバウンディングボックスを返す
 */
export async function runOcr(
  imageSource: HTMLImageElement | HTMLCanvasElement | string,
  onProgress?: (p: OcrProgress) => void
): Promise<OcrResult> {
  onProgress?.({ status: "OCRエンジン初期化中...", progress: 0.1 });
  const worker = await getOcrWorker("jpn+eng", onProgress);

  onProgress?.({ status: "テキスト認識・座標解析中...", progress: 0.3 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await worker.recognize(imageSource);

  const lines: OcrLine[] = [];
  const allSymbols: OcrChar[] = [];

  // lines のパース
  if (result?.data?.lines) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const rawLine of result.data.lines) {
      const lineSymbols: OcrChar[] = [];
      
      // rawLine.words
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const words = (rawLine.words || []).map((w: any) => ({
        text: w.text || "",
        bbox: w.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
        confidence: w.confidence || 0
      }));

      // symbols（文字単位）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (rawLine.words) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const w of rawLine.words) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (w.symbols) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const s of w.symbols) {
              const charObj: OcrChar = {
                text: s.text || "",
                bbox: s.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
                confidence: s.confidence || 0
              };
              lineSymbols.push(charObj);
              allSymbols.push(charObj);
            }
          }
        }
      }

      lines.push({
        text: rawLine.text || "",
        bbox: rawLine.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
        words,
        symbols: lineSymbols
      });
    }
  }

  onProgress?.({ status: "完了", progress: 1.0 });

  return {
    fullText: result?.data?.text || "",
    lines,
    symbols: allSymbols
  };
}

/**
 * 終了時にWorkerを破棄
 */
export async function terminateOcrWorker(): Promise<void> {
  if (cachedWorker) {
    await cachedWorker.terminate();
    cachedWorker = null;
  }
}
