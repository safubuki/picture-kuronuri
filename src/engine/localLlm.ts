/**
 * 完全ローカル・端末内極小LLM（Small Language Model）文脈理解エンジン
 * Qwen2.5-0.5B-Instruct (4-bit 量子化 ONNX, 約350MB) を WebGPU/Wasm でブラウザ内実行。
 * 外部通信ゼロで、文脈から「取引金額」「社外秘プロジェクト名」「特定可能なキーワード」を特定する。
 */

import { pipeline } from "@huggingface/transformers";

const LLM_MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const LLM_OPT_IN_KEY = "kuronuri_llm_opt_in";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let llmPipelineInstance: any = null;
let isLlmLoading = false;

export type LlmProgressCallback = (status: string, progress: number) => void;

/**
 * ユーザーがLLMオプトインを有効にしているか判定
 */
export function isLlmOptInEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(LLM_OPT_IN_KEY) === "true";
}

/**
 * LLMオプトイン設定を保存
 */
export function setLlmOptInEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LLM_OPT_IN_KEY, enabled ? "true" : "false");
}

/**
 * 極小LLMパイプラインの初期化・取得
 */
export async function getLocalLlmPipeline(
  onProgress?: LlmProgressCallback
): Promise<any> {
  if (llmPipelineInstance) return llmPipelineInstance;

  if (isLlmLoading) {
    while (isLlmLoading) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return llmPipelineInstance;
  }

  isLlmLoading = true;

  try {
    onProgress?.("文脈理解AI（LLM）を準備中...\n(初回のみ約350MB)", 0.05);

    // WebGPU が利用可能かチェック
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasWebGpu = typeof navigator !== "undefined" && !!(navigator as any).gpu;
    const device = hasWebGpu ? "webgpu" : "wasm";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progressCallback = (progressInfo: any) => {
      if (progressInfo.status === "progress" && typeof progressInfo.progress === "number") {
        const p = Math.min(0.95, progressInfo.progress / 100);
        const percentText = `${Math.round(p * 100)}%`;
        const mbText = progressInfo.loaded
          ? `${(progressInfo.loaded / (1024 * 1024)).toFixed(1)} MB`
          : "";
        const subInfo = mbText ? `${mbText} / ${percentText}` : percentText;
        onProgress?.(`文脈AIをロード中 (${device.toUpperCase()})...\n${subInfo}`, p);
      } else if (progressInfo.status === "done") {
        onProgress?.("文脈AIの展開完了", 0.98);
      }
    };

    // text-generation パイプラインを q4 でロード
    llmPipelineInstance = await pipeline("text-generation", LLM_MODEL_ID, {
      dtype: "q4",
      device: device as any,
      progress_callback: progressCallback
    });

    onProgress?.("文脈理解AI 準備完了", 1.0);
    return llmPipelineInstance;
  } catch (err) {
    console.warn("[LocalLlm] Failed to initialize Qwen2.5-0.5B:", err);
    return null;
  } finally {
    isLlmLoading = false;
  }
}

/**
 * OCR認識テキストから、文脈上隠すべき機密キーワードをLLMで抽出
 */
export async function extractConfidentialKeywordsWithLlm(
  ocrFullText: string,
  onProgress?: (status: string) => void
): Promise<string[]> {
  if (!isLlmOptInEnabled() || !ocrFullText || ocrFullText.trim().length < 5) {
    return [];
  }

  try {
    onProgress?.("文脈理解AIが機密キーワードを解析中...");
    const pipe = await getLocalLlmPipeline();
    if (!pipe) return [];

    // テキストが長すぎる場合は先頭1000文字にトリム
    const snippet = ocrFullText.slice(0, 1000);

    const prompt = `あなたは情報漏洩を防ぐプライバシー保護AIです。以下のテキストから、個人特定につながるキーワード（人名、会社名、電話番号、住所、取引金額、社内秘プロジェクト名、秘密のID・パスワード等）を抽出し、該当する単語をJSON配列形式（例: ["田中", "50万円", "ProjectX"]）のみで出力してください。余計な解説は不要です。

テキスト:
${snippet}

JSON:`;

    const result = await pipe(prompt, {
      max_new_tokens: 120,
      temperature: 0.1,
      top_p: 0.9,
      do_sample: false
    });

    // 出力からJSON配列をパース
    const generatedText: string = result?.[0]?.generated_text || "";
    const jsonMatch = generatedText.slice(prompt.length).match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          const keywords = parsed
            .filter((item) => typeof item === "string" && item.trim().length >= 2)
            .map((item) => item.trim());
          return Array.from(new Set(keywords));
        }
      } catch {
        // パース失敗時はフォールバック
      }
    }

    return [];
  } catch (e) {
    console.warn("[LocalLlm] Keyword extraction failed:", e);
    return [];
  }
}
