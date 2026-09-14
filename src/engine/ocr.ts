import { createWorker, PSM, type Worker } from "tesseract.js";
import { preprocessForOcr, type OcrSourceAnalysis } from "./ocrPreprocess";
import { isCjkChar, isSpaceChar, toHalfwidthChar } from "./ocrNormalize";

export interface OcrProgress {
  status: string;
  progress: number;
}

export interface OcrChar {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export interface OcrLine {
  text: string;
  rawText: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: OcrWord[];
  symbols: OcrChar[];
  /** text の各文字と 1:1 対応するシンボル（スペース除去後） */
  alignedSymbols: OcrChar[];
  confidence: number;
}

export interface OcrResult {
  fullText: string;
  lines: OcrLine[];
  symbols: OcrChar[];
  scale: number;
  analysis?: OcrSourceAnalysis;
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
        const mapped = 0.38 + Math.min(1, Math.max(0, m.progress)) * 0.5;
        onProgress({
          status: m.status || "処理中...",
          progress: mapped
        });
      }
    }
  });

  await worker.setParameters({
    // チャット画面・書類はアバター、ヘッダー、吹き出しが散在するため AUTO（完全自動セグメンテーション）が最適
    tessedit_pageseg_mode: PSM.AUTO,
    preserve_interword_spaces: "1"
  });

  cachedWorker = worker;
  currentLanguage = lang;
  return worker;
}

interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function emptyBBox(): BBox {
  return { x0: 0, y0: 0, x1: 0, y1: 0 };
}

function scaleBBox(b: BBox, inv: number): BBox {
  return {
    x0: Math.round(b.x0 * inv),
    y0: Math.round(b.y0 * inv),
    x1: Math.round(b.x1 * inv),
    y1: Math.round(b.y1 * inv)
  };
}

function explodeSymbolsFromWord(word: OcrWord): OcrChar[] {
  const chars = [...word.text].map(toHalfwidthChar);
  if (chars.length === 0) return [];
  if (chars.length === 1) {
    return [{ text: chars[0], bbox: word.bbox, confidence: word.confidence }];
  }
  const w = Math.max(1, word.bbox.x1 - word.bbox.x0);
  const out: OcrChar[] = [];
  for (let i = 0; i < chars.length; i++) {
    const x0 = word.bbox.x0 + (w * i) / chars.length;
    const x1 = word.bbox.x0 + (w * (i + 1)) / chars.length;
    out.push({
      text: chars[i],
      bbox: { x0, y0: word.bbox.y0, x1, y1: word.bbox.y1 },
      confidence: word.confidence
    });
  }
  return out;
}

function buildAlignedLine(
  rawText: string,
  bbox: BBox,
  words: OcrWord[],
  symbols: OcrChar[],
  confidence: number
): OcrLine {
  let units: OcrChar[] = [];
  if (symbols.length > 0) {
    for (const s of symbols) {
      const chars = [...(s.text || "")].map(toHalfwidthChar);
      if (chars.length <= 1) {
        units.push({
          text: chars[0] || s.text || "",
          bbox: s.bbox,
          confidence: s.confidence
        });
      } else {
        const w = Math.max(1, s.bbox.x1 - s.bbox.x0);
        for (let i = 0; i < chars.length; i++) {
          units.push({
            text: chars[i],
            bbox: {
              x0: s.bbox.x0 + (w * i) / chars.length,
              y0: s.bbox.y0,
              x1: s.bbox.x0 + (w * (i + 1)) / chars.length,
              y1: s.bbox.y1
            },
            confidence: s.confidence
          });
        }
      }
    }
  } else {
    for (const word of words) {
      units = units.concat(explodeSymbolsFromWord(word));
    }
  }

  let text = "";
  const aligned: OcrChar[] = [];
  for (let i = 0; i < units.length; i++) {
    const ch = toHalfwidthChar(units[i].text || "");
    if (!ch) continue;

    if (isSpaceChar(ch)) {
      const prev = text.length > 0 ? text[text.length - 1] : "";
      let next = "";
      for (let j = i + 1; j < units.length; j++) {
        const nch = toHalfwidthChar(units[j].text || "");
        if (nch && !isSpaceChar(nch)) {
          next = nch;
          break;
        }
      }
      if (isCjkChar(prev) && isCjkChar(next)) continue;
      if (prev === " " || prev === "") continue;
      text += " ";
      aligned.push({ ...units[i], text: " " });
      continue;
    }

    text += ch;
    aligned.push({ ...units[i], text: ch });
  }

  const fallbackText = text || rawText.trim();
  return {
    text: fallbackText,
    rawText,
    bbox,
    words,
    symbols,
    alignedSymbols: aligned,
    confidence
  };
}

function parseRecognizeData(data: {
  text?: string;
  blocks?: unknown;
  lines?: unknown;
}): { lines: OcrLine[]; symbols: OcrChar[]; fullText: string } {
  const lines: OcrLine[] = [];
  const allSymbols: OcrChar[] = [];

  const ingestRawLine = (rawLine: {
    text?: string;
    bbox?: BBox;
    confidence?: number;
    words?: {
      text?: string;
      bbox?: BBox;
      confidence?: number;
      symbols?: { text?: string; bbox?: BBox; confidence?: number }[];
    }[];
  }) => {
    const words: OcrWord[] = (rawLine.words || []).map((w) => ({
      text: w.text || "",
      bbox: w.bbox || emptyBBox(),
      confidence: w.confidence || 0
    }));

    const lineSymbols: OcrChar[] = [];
    if (rawLine.words) {
      for (const w of rawLine.words) {
        if (!w.symbols) continue;
        for (const s of w.symbols) {
          const charObj: OcrChar = {
            text: s.text || "",
            bbox: s.bbox || emptyBBox(),
            confidence: s.confidence || 0
          };
          lineSymbols.push(charObj);
          allSymbols.push(charObj);
        }
      }
    }

    const line = buildAlignedLine(
      rawLine.text || "",
      rawLine.bbox || emptyBBox(),
      words,
      lineSymbols,
      rawLine.confidence || 0
    );
    if (line.text.trim().length === 0) return;
    lines.push(line);
  };

  const blocks = data?.blocks;
  if (Array.isArray(blocks)) {
    for (const block of blocks as {
      paragraphs?: { lines?: Parameters<typeof ingestRawLine>[0][] }[];
    }[]) {
      for (const para of block.paragraphs || []) {
        for (const rawLine of para.lines || []) {
          ingestRawLine(rawLine);
        }
      }
    }
  }

  if (lines.length === 0 && Array.isArray(data?.lines)) {
    for (const rawLine of data.lines as Parameters<typeof ingestRawLine>[0][]) {
      ingestRawLine(rawLine);
    }
  }

  return {
    lines,
    symbols: allSymbols,
    fullText: data?.text || lines.map((l) => l.text).join("\n")
  };
}

function scaleOcrGeometry(lines: OcrLine[], symbols: OcrChar[], scale: number): void {
  if (Math.abs(scale - 1) < 0.001) return;
  const inv = 1 / scale;
  for (const line of lines) {
    line.bbox = scaleBBox(line.bbox, inv);
    for (const w of line.words) w.bbox = scaleBBox(w.bbox, inv);
    for (const s of line.symbols) s.bbox = scaleBBox(s.bbox, inv);
    for (const s of line.alignedSymbols) s.bbox = scaleBBox(s.bbox, inv);
  }
  for (const s of symbols) s.bbox = scaleBBox(s.bbox, inv);
}

function yOverlapRatio(a: BBox, b: BBox): number {
  const top = Math.max(a.y0, b.y0);
  const bot = Math.min(a.y1, b.y1);
  const overlap = bot - top;
  if (overlap <= 0) return 0;
  const minH = Math.min(a.y1 - a.y0, b.y1 - b.y0) || 1;
  return overlap / minH;
}

/**
 * ジャギー画像で行が細切れになった OCR 結果を同一ベースラインで結合
 */
function mergeFragmentedLines(lines: OcrLine[]): OcrLine[] {
  if (lines.length <= 1) return lines;
  const sorted = [...lines].sort((a, b) => {
    const ay = (a.bbox.y0 + a.bbox.y1) / 2;
    const by = (b.bbox.y0 + b.bbox.y1) / 2;
    if (Math.abs(ay - by) > 4) return ay - by;
    return a.bbox.x0 - b.bbox.x0;
  });

  const used = new Uint8Array(sorted.length);
  const out: OcrLine[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    let acc = sorted[i];
    used[i] = 1;
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < sorted.length; j++) {
        if (used[j]) continue;
        const other = sorted[j];
        const h1 = Math.max(1, acc.bbox.y1 - acc.bbox.y0);
        const h2 = Math.max(1, other.bbox.y1 - other.bbox.y0);
        if (yOverlapRatio(acc.bbox, other.bbox) < 0.68) continue;
        if (Math.abs(h1 - h2) / Math.max(h1, h2) > 0.35) continue;

        const gap =
          acc.bbox.x0 <= other.bbox.x0
            ? other.bbox.x0 - acc.bbox.x1
            : acc.bbox.x0 - other.bbox.x1;
        const maxH = Math.max(h1, h2);
        if (gap > maxH * 1.15) continue;
        if (gap < -maxH * 0.25) continue;

        const left = acc.bbox.x0 <= other.bbox.x0 ? acc : other;
        const right = left === acc ? other : acc;
        const joinGap = right.bbox.x0 - left.bbox.x1;
        const leftEnd = left.text[left.text.length - 1] || "";
        const rightStart = right.text[0] || "";
        const insertSpace =
          joinGap > maxH * 0.35 && !isCjkChar(leftEnd) && !isCjkChar(rightStart);

        acc = {
          text: left.text + (insertSpace ? " " : "") + right.text,
          rawText: left.rawText + (insertSpace ? " " : "") + right.rawText,
          bbox: {
            x0: Math.min(acc.bbox.x0, other.bbox.x0),
            y0: Math.min(acc.bbox.y0, other.bbox.y0),
            x1: Math.max(acc.bbox.x1, other.bbox.x1),
            y1: Math.max(acc.bbox.y1, other.bbox.y1)
          },
          words: left.words.concat(right.words),
          symbols: left.symbols.concat(right.symbols),
          alignedSymbols: insertSpace
            ? left.alignedSymbols.concat(
                [
                  {
                    text: " ",
                    bbox: {
                      x0: left.bbox.x1,
                      y0: left.bbox.y0,
                      x1: right.bbox.x0,
                      y1: left.bbox.y1
                    },
                    confidence: 0
                  }
                ],
                right.alignedSymbols
              )
            : left.alignedSymbols.concat(right.alignedSymbols),
          confidence: (left.confidence + right.confidence) / 2
        };
        used[j] = 1;
        changed = true;
      }
    }
    out.push(acc);
  }

  return out;
}

/**
 * 画像に対してOCRを実行し、行・単語・文字単位の詳細なバウンディングボックスを返す
 */
export async function runOcr(
  imageSource: HTMLImageElement | HTMLCanvasElement | string,
  onProgress?: (p: OcrProgress) => void
): Promise<OcrResult> {
  onProgress?.({ status: "OCRエンジン初期化中...", progress: 0.08 });
  const worker = await getOcrWorker("jpn+eng", onProgress);

  let ocrInput: HTMLImageElement | HTMLCanvasElement | string = imageSource;
  let scale = 1;
  let analysis: OcrSourceAnalysis | undefined;

  if (typeof imageSource !== "string") {
    onProgress?.({
      status: "撮影ノイズ除去・文字拡大（OCR前処理）...",
      progress: 0.22
    });
    try {
      const prepared = preprocessForOcr(imageSource);
      ocrInput = prepared.canvas;
      scale = prepared.scale;
      analysis = prepared.analysis;
    } catch (err) {
      console.warn("OCR preprocess failed, using original image:", err);
    }
  }

  onProgress?.({ status: "テキスト認識・座標解析中...", progress: 0.38 });
  
  // 18秒タイムアウト保護（Workerハングやネットワーク不通でアプリが止まるのを防止）
  const timeoutPromise = new Promise<{ data?: any }>((resolve) => {
    setTimeout(() => {
      console.warn("OCR recognize timed out after 18s, falling back gracefully");
      resolve({ data: { text: "", blocks: [], lines: [] } });
    }, 18000);
  });

  const result = await Promise.race([
    worker.recognize(ocrInput, {}, { text: true, blocks: true }),
    timeoutPromise
  ]);

  const parsed = parseRecognizeData(result?.data || {});
  scaleOcrGeometry(parsed.lines, parsed.symbols, scale);
  const merged = mergeFragmentedLines(parsed.lines);

  onProgress?.({ status: "完了", progress: 1.0 });

  return {
    fullText: parsed.fullText,
    lines: merged,
    symbols: parsed.symbols,
    scale,
    analysis
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
