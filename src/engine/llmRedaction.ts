import { isLlmOptInEnabled } from "./aiPreferences";
import type { OcrResult } from "./ocr";

export interface LlmRedactionEntity {
  lineIndex: number;
  text: string;
  type: "person" | "company" | "pii" | "confidential";
}

export interface LlmAnalysisSummary {
  status: "disabled" | "applied" | "no_additions" | "failed" | "timeout" | "skipped";
  addedBoxes: number;
  analyzedLines: number;
  totalLines: number;
  cached: boolean;
  message?: string;
}

interface LlmOcrAnalysis {
  entities: LlmRedactionEntity[];
  analysis: LlmAnalysisSummary;
}

const MAX_LINES = 40;
const MAX_CHARACTERS = 1800;
const BATCH_LINES = 20;
const BATCH_CHARACTERS = 900;
const ANALYSIS_TIMEOUT_MS = 15000;

// フィルターや余白変更時も同じOCRの推論を再利用する。失敗は保存しない。
const analysisCache = new WeakMap<OcrResult, {
  fingerprint: string;
  pending?: Promise<LlmOcrAnalysis>;
  result?: LlmOcrAnalysis;
}>();

function truncateUtf16(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const last = text.charCodeAt(limit - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit);
}

/** 行番号を維持し、原文の先頭から最大2バッチに制限する。 */
function selectBatches(ocr: OcrResult): { lineIndex: number; text: string }[][] {
  const batches: { lineIndex: number; text: string }[][] = [];
  let batch: { lineIndex: number; text: string }[] = [];
  let batchCharacters = 0;
  let totalCharacters = 0;
  let totalLines = 0;
  for (let lineIndex = 0; lineIndex < ocr.lines.length; lineIndex++) {
    const text = ocr.lines[lineIndex].text;
    if (!text.trim()) continue;
    if (totalLines >= MAX_LINES || totalCharacters >= MAX_CHARACTERS) break;
    if (batch.length >= BATCH_LINES || batchCharacters >= BATCH_CHARACTERS) {
      batches.push(batch);
      batch = [];
      batchCharacters = 0;
      if (batches.length >= 2) break;
    }
    const snippet = truncateUtf16(text, Math.min(BATCH_CHARACTERS - batchCharacters, MAX_CHARACTERS - totalCharacters));
    if (!snippet.trim()) {
      if (batch.length) batches.push(batch);
      batch = [];
      batchCharacters = 0;
      if (batches.length >= 2) break;
      continue;
    }
    batch.push({ lineIndex, text: snippet });
    batchCharacters += snippet.length;
    totalCharacters += snippet.length;
    totalLines++;
  }
  if (batch.length && batches.length < 2) batches.push(batch);
  return batches;
}

function baseAnalysis(ocr: OcrResult, status: LlmAnalysisSummary["status"]): LlmAnalysisSummary {
  return { status, addedBoxes: 0, analyzedLines: 0, totalLines: ocr.lines.length, cached: false };
}

function copyResult(result: LlmOcrAnalysis, cached: boolean): LlmOcrAnalysis {
  return { entities: result.entities, analysis: { ...result.analysis, cached } };
}

/** OFFならモデルをimportしない。ONでも失敗・時間超過時は既存ルールの結果を使える。 */
export async function analyzeOcrWithLlm(
  ocr: OcrResult,
  enabledCategories: boolean,
  onProgress?: (status: string) => void
): Promise<LlmOcrAnalysis> {
  if (!isLlmOptInEnabled()) return { entities: [], analysis: baseAnalysis(ocr, "disabled") };
  if (!enabledCategories || !ocr.lines.some((line) => line.text.trim())) {
    return { entities: [], analysis: { ...baseAnalysis(ocr, "skipped"), message: "文脈AIの対象となる文字またはフィルターがありません。" } };
  }

  // 同じOCRオブジェクトが編集された場合も古い抽出語を流用しない。
  const fingerprint = JSON.stringify(ocr.lines.map((line) => line.text));
  const cached = analysisCache.get(ocr);
  if (cached?.fingerprint === fingerprint) {
    if (cached.result) return copyResult(cached.result, true);
    if (cached.pending) {
      onProgress?.("同じ画像の文脈AI解析を待機中...");
      return copyResult(await cached.pending, true);
    }
  }

  const batches = selectBatches(ocr);
  const analyzedLines = batches.reduce((count, batch) => count + batch.length, 0);
  const entry: { fingerprint: string; pending?: Promise<LlmOcrAnalysis>; result?: LlmOcrAnalysis } = { fingerprint };
  analysisCache.set(ocr, entry);
  entry.pending = (async (): Promise<LlmOcrAnalysis> => {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const extraction = async (): Promise<LlmRedactionEntity[]> => {
      onProgress?.("文脈AIを準備中...（初回はモデルの取得が必要です）");
      const { extractRedactionEntitiesWithLlm } = await import("./localLlm");
      const entities: LlmRedactionEntity[] = [];
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        if (controller.signal.aborted) throw new DOMException("文脈AI解析の待ち時間を超過しました。", "AbortError");
        onProgress?.(`文脈AIが文字を判定中... (${batchIndex + 1}/${batches.length})`);
        const batch = batches[batchIndex];
        const result = await extractRedactionEntitiesWithLlm(batch, onProgress, { signal: controller.signal });
        const originals = new Map(batch.map((line) => [line.lineIndex, line.text]));
        // バックエンドに加えて画像側でも行番号と完全一致を検証する。
        for (const entity of result) {
          if (!Number.isInteger(entity.lineIndex) || typeof entity.text !== "string" || entity.text.length < 2) continue;
          if (!["person", "company", "pii", "confidential"].includes(entity.type)) continue;
          const original = originals.get(entity.lineIndex);
          if (!original?.includes(entity.text)) continue;
          entities.push(entity);
        }
      }
      return entities;
    };
    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error("文脈AI解析が15秒の待ち時間を超過しました。"));
        }, ANALYSIS_TIMEOUT_MS);
      });
      // abortは生成停止条件へ渡される。共有モデルの初回取得は次の解析に備えて継続する。
      const entities = await Promise.race([extraction(), timeout]);
      return { entities, analysis: { ...baseAnalysis(ocr, "no_additions"), analyzedLines } };
    } catch (error) {
      console.warn("[LlmRedaction] Context analysis skipped:", error);
      return { entities: [], analysis: {
        ...baseAnalysis(ocr, timedOut ? "timeout" : "failed"), analyzedLines,
        message: timedOut ? "文脈AIが時間内に完了しませんでした。ルール判定の結果を保持しています。" : "文脈AIの解析に失敗しました。ルール判定の結果を保持しています。"
      } };
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  })();

  const result = await entry.pending;
  if (analysisCache.get(ocr) === entry) {
    if (result.analysis.status === "failed" || result.analysis.status === "timeout") analysisCache.delete(ocr);
    else { entry.result = result; entry.pending = undefined; }
  }
  return copyResult(result, false);
}
