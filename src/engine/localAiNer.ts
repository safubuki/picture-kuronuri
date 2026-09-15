/**
 * 完全ローカル・ブラウザ内AI固有表現抽出（NER）エンジン
 * Transformers.js (ONNX Runtime Web) を使用し、外部サーバーへの通信ゼロ（100%端末内）で
 * 文脈から「人名 (PER)」「組織・会社名 (ORG)」「地名・住所 (LOC)」を特定する。
 */

import { pipeline, env } from "@huggingface/transformers";

// ブラウザキャッシュを有効化（初回のみダウンロード、以降は完全オフライン動作）
env.allowLocalModels = false;
env.useBrowserCache = true;

export interface ExtractedEntity {
  type: "person" | "company" | "location";
  text: string;
  start: number;
  end: number;
  score: number;
}

// 多言語・日本語対応の超軽量量子化NERモデル（INT8 ONNX 約45MB）
const DEFAULT_NER_MODEL = "Xenova/bert-base-multilingual-cased-ner-hrl";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nerPipelineInstance: any = null;
let isModelLoading = false;
let modelLoadFailed = false;

export type AiLoadProgressCallback = (status: string, progress: number) => void;

/**
 * ローカルAI NERパイプラインの初期化
 */
export async function getLocalAiNerPipeline(
  onProgress?: AiLoadProgressCallback
): Promise<any> {
  if (nerPipelineInstance) return nerPipelineInstance;
  if (modelLoadFailed) return null;

  if (isModelLoading) {
    // 既にロード中なら少し待つ
    while (isModelLoading) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return nerPipelineInstance;
  }

  isModelLoading = true;

  try {
    onProgress?.("端末内AIモデルを準備中 (初回のみダウンロード)...", 0.05);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progressCallback = (progressInfo: any) => {
      if (progressInfo.status === "progress" && typeof progressInfo.progress === "number") {
        const p = Math.min(0.95, progressInfo.progress / 100);
        const mb = progressInfo.loaded ? ` (${(progressInfo.loaded / (1024 * 1024)).toFixed(1)} MB)` : "";
        onProgress?.(`端末内AIモデルをロード中${mb}...`, p);
      } else if (progressInfo.status === "done") {
        onProgress?.("端末内AIモデルの展開完了", 0.98);
      }
    };

    // token-classification パイプラインを初期化
    nerPipelineInstance = await pipeline("token-classification", DEFAULT_NER_MODEL, {
      progress_callback: progressCallback
    });

    onProgress?.("端末内AIモデル準備完了", 1.0);
    return nerPipelineInstance;
  } catch (err) {
    console.warn("[LocalAiNer] Failed to load browser AI model, falling back to rule-based engine:", err);
    modelLoadFailed = true;
    return null;
  } finally {
    isModelLoading = false;
  }
}

/**
 * テキストから人名・組織名・住所を端末内AI（文脈理解）で抽出
 */
export async function extractEntitiesWithLocalAi(
  text: string,
  onProgress?: AiLoadProgressCallback
): Promise<ExtractedEntity[]> {
  if (!text || text.trim().length === 0) return [];

  const pipe = await getLocalAiNerPipeline(onProgress);
  if (!pipe) {
    // モデルロード不可時は空配列を返し、既存のルールベースエンジンにフォールバック
    return [];
  }

  try {
    onProgress?.("端末内AIで文脈・個人情報を解析中...", 0.5);

    // 単語ごとのトークン分類を実行
    // ignore_labels: O (その他)
    const rawOutput = await pipe(text, {
      ignore_labels: ["O"]
    });

    if (!Array.isArray(rawOutput)) return [];

    const entities: ExtractedEntity[] = [];

    // B-PER, I-PER, B-ORG, I-ORG などのトークンをひとまとまりのエンティティに結合
    let currentEntity: {
      type: "person" | "company" | "location";
      text: string;
      start: number;
      end: number;
      score: number;
      count: number;
    } | null = null;

    for (const item of rawOutput) {
      const entityTag: string = item.entity || item.label || "";
      const score: number = item.score || 0;
      const word: string = (item.word || "").replace(/^##/, ""); // サブワード記号の除去
      const start: number = typeof item.start === "number" ? item.start : text.indexOf(word);
      const end: number = typeof item.end === "number" ? item.end : start + word.length;

      // 信頼度閾値（低すぎるものは除外）
      if (score < 0.5) continue;

      let type: "person" | "company" | "location" | null = null;
      if (entityTag.includes("PER")) type = "person";
      else if (entityTag.includes("ORG")) type = "company";
      else if (entityTag.includes("LOC")) type = "location";

      if (!type) continue;

      const isSubword = (item.word || "").startsWith("##");
      const isContinuation =
        currentEntity &&
        currentEntity.type === type &&
        (isSubword || start <= currentEntity.end + 2);

      if (isContinuation && currentEntity) {
        currentEntity.text = text.slice(currentEntity.start, end);
        currentEntity.end = end;
        currentEntity.score = (currentEntity.score * currentEntity.count + score) / (currentEntity.count + 1);
        currentEntity.count++;
      } else {
        if (currentEntity && currentEntity.text.trim().length >= 2) {
          entities.push({
            type: currentEntity.type,
            text: currentEntity.text.trim(),
            start: currentEntity.start,
            end: currentEntity.end,
            score: currentEntity.score
          });
        }
        currentEntity = {
          type,
          text: word,
          start,
          end,
          score,
          count: 1
        };
      }
    }

    if (currentEntity && currentEntity.text.trim().length >= 2) {
      entities.push({
        type: currentEntity.type,
        text: currentEntity.text.trim(),
        start: currentEntity.start,
        end: currentEntity.end,
        score: currentEntity.score
      });
    }

    // 記号のみや1文字のノイズを除外
    const validEntities = entities.filter(e => {
      const cleaned = e.text.replace(/[\s\r\n\t]/g, "");
      return cleaned.length >= 2 && !/^[0-9]+$/.test(cleaned);
    });

    console.log("[LocalAiNer] Extracted entities:", JSON.stringify(validEntities));
    return validEntities;
  } catch (err) {
    console.warn("[LocalAiNer] Entity extraction error:", err);
    return [];
  }
}
