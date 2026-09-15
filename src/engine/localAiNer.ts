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
    onProgress?.("端末内AIモデルを準備中...\n(初回のみダウンロード)", 0.05);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progressCallback = (progressInfo: any) => {
      if (progressInfo.status === "progress" && typeof progressInfo.progress === "number") {
        const p = Math.min(0.95, progressInfo.progress / 100);
        const percentText = `${Math.round(p * 100)}%`;
        const mbText = progressInfo.loaded
          ? `${(progressInfo.loaded / (1024 * 1024)).toFixed(1)} MB`
          : "";
        const subInfo = mbText ? `${mbText} / ${percentText}` : percentText;
        onProgress?.(`端末内AIモデルをロード中...\n${subInfo}`, p);
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
 * 単一テキストスニペットに対するNERトークン分類
 */
async function runNerOnSnippet(
  pipe: any,
  snippet: string,
  minScore: number
): Promise<ExtractedEntity[]> {
  if (!snippet || snippet.trim().length < 2) return [];

  try {
    const rawOutput = await pipe(snippet, {
      ignore_labels: ["O"]
    });

    if (!Array.isArray(rawOutput)) return [];

    const entities: ExtractedEntity[] = [];

    // B-PER, I-PER, B-ORG, I-ORG などのトークンを結合
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
      const word: string = (item.word || "").replace(/^##/, "");
      const start: number = typeof item.start === "number" ? item.start : snippet.indexOf(word);
      const end: number = typeof item.end === "number" ? item.end : start + word.length;

      let type: "person" | "company" | "location" | null = null;
      if (entityTag.includes("PER")) type = "person";
      else if (entityTag.includes("ORG")) type = "company";
      else if (entityTag.includes("LOC")) type = "location";

      if (!type) {
        if (currentEntity && currentEntity.text.trim().length >= 2) {
          entities.push({
            type: currentEntity.type,
            text: currentEntity.text.trim(),
            start: currentEntity.start,
            end: currentEntity.end,
            score: currentEntity.score
          });
        }
        currentEntity = null;
        continue;
      }

      const isSubword = (item.word || "").startsWith("##");
      const isContinuation =
        currentEntity &&
        currentEntity.type === type &&
        (isSubword || start <= currentEntity.end + 2);

      if (isContinuation && currentEntity) {
        // 継続トークン（I-PERなど）は姓名の結合を維持するためスコア閾値を緩和
        if (score >= minScore * 0.45) {
          currentEntity.text = snippet.slice(currentEntity.start, end);
          currentEntity.end = end;
          currentEntity.score = (currentEntity.score * currentEntity.count + score) / (currentEntity.count + 1);
          currentEntity.count++;
        }
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

        // 新規エンティティ開始時は minScore を要求
        if (score >= minScore) {
          currentEntity = {
            type,
            text: word,
            start,
            end,
            score,
            count: 1
          };
        } else {
          currentEntity = null;
        }
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

    return entities;
  } catch {
    return [];
  }
}

/**
 * テキストから人名・組織名・住所を端末内AI（文脈理解・マルチパス）で徹底抽出
 */
export async function extractEntitiesWithLocalAi(
  fullText: string,
  onProgress?: AiLoadProgressCallback,
  minScore: number = 0.5,
  linesText?: string[]
): Promise<ExtractedEntity[]> {
  if (!fullText || fullText.trim().length === 0) return [];

  const pipe = await getLocalAiNerPipeline(onProgress);
  if (!pipe) {
    return [];
  }

  try {
    onProgress?.("端末内AIで文脈・個人情報を徹底解析中 (マルチパス)...", 0.5);

    const allEntitiesMap = new Map<string, ExtractedEntity>();

    // Pass 1: ドキュメント全体（大域文脈）でのNER推論
    const globalEntities = await runNerOnSnippet(pipe, fullText, minScore);
    for (const e of globalEntities) {
      const key = `${e.type}:${e.text.trim()}`;
      allEntitiesMap.set(key, e);
    }

    // Pass 2: 行単位 / メッセージ単位（局所短文文脈）でのNER推論
    // 短文ではAttentionが人名や組織名に強く集中し、長文で見落とされた人名を確実に救済
    const lines = linesText && linesText.length > 0
      ? linesText
      : fullText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 2);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length < 2) continue;

      // チャット送信者ヘッダー風の行は「送信者: 〇〇」のようにプロンプト補強して判定
      const isHeaderLike = line.length <= 12 && !/[、。！？!?]/.test(line);
      const testSnippet = isHeaderLike ? `送信者: ${line}` : line;

      const localEntities = await runNerOnSnippet(pipe, testSnippet, minScore * 0.85);
      for (const e of localEntities) {
        const cleanedText = e.text.replace(/^送信者[:：\s]*/, "").trim();
        if (cleanedText.length >= 2 && !/^[0-9]+$/.test(cleanedText)) {
          const key = `${e.type}:${cleanedText}`;
          const existing = allEntitiesMap.get(key);
          if (!existing || existing.score < e.score) {
            allEntitiesMap.set(key, {
              ...e,
              text: cleanedText
            });
          }
        }
      }
    }

    // 一般的な定型句や記号のフィルタリング
    const validEntities = Array.from(allEntitiesMap.values()).filter((e) => {
      const cleaned = e.text.replace(/[\s\r\n\t]/g, "");
      if (cleaned.length < 2) return false;
      if (/^[0-9]+$/.test(cleaned)) return false;
      // 定型語句の誤検知を除外
      if (/^(お疲れ様|よろしく|ありがとう|承知|了解|相談|確認|連絡|対応|添付|送付|返信)$/.test(cleaned)) return false;
      return true;
    });

    console.log("[LocalAiNer] Multi-pass extracted entities:", JSON.stringify(validEntities));
    return validEntities;
  } catch (err) {
    console.warn("[LocalAiNer] Entity extraction error:", err);
    return [];
  }
}
