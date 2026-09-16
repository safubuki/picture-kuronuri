/**
 * 完全ローカル・端末内極小LLM（Small Language Model）文脈理解エンジン
 * Qwen2.5-0.5B-Instruct (4-bit 量子化 ONNX) を WebGPU / WASM でブラウザ内実行。
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
 * WebGPU が実際に使用可能か検証（アダプター取得まで確認）
 */
async function detectWebGpuAvailability(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gpu = (navigator as any).gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") return false;

  try {
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch (e) {
    console.warn("[LocalLlm] WebGPU adapter check failed:", e);
    return false;
  }
}

/**
 * 極小LLMパイプラインの初期化・取得
 * WebGPU対応環境では高速なWebGPU、非対応環境ではCPU/WASM安全モードで自動初期化
 */
export async function getLocalLlmPipeline(
  onProgress?: LlmProgressCallback
): Promise<any> {
  if (llmPipelineInstance) return llmPipelineInstance;

  if (isLlmLoading) {
    let waited = 0;
    while (isLlmLoading && waited < 300) {
      await new Promise((r) => setTimeout(r, 100));
      waited++;
    }
    if (llmPipelineInstance) return llmPipelineInstance;
  }

  isLlmLoading = true;

  try {
    onProgress?.("文脈理解AI（LLM）を準備中...\n(初回のみモデルを取得)", 0.05);

    const hasWebGpu = await detectWebGpuAvailability();
    const deviceName = hasWebGpu ? "WEBGPU" : "WASM/CPU";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progressCallback = (progressInfo: any) => {
      if (progressInfo.status === "progress" && typeof progressInfo.progress === "number") {
        const p = Math.min(0.95, progressInfo.progress / 100);
        const percentText = `${Math.round(p * 100)}%`;
        const mbText = progressInfo.loaded
          ? `${(progressInfo.loaded / (1024 * 1024)).toFixed(1)} MB`
          : "";
        const subInfo = mbText ? `${mbText} / ${percentText}` : percentText;
        onProgress?.(`文脈AIをロード中 (${deviceName})...\n${subInfo}`, p);
      } else if (progressInfo.status === "done") {
        onProgress?.("文脈AIの展開完了", 0.98);
      }
    };

    // transformers.js の execution providers:
    // 'webgpu' または undefined（未指定でcpu/wasmに自動フォールバック）
    // 注意: 'wasm' という文字列は unsupported device 例外になるため絶対に渡さない
    const pipelineOptions: Record<string, any> = {
      dtype: "q4",
      progress_callback: progressCallback
    };

    if (hasWebGpu) {
      pipelineOptions.device = "webgpu";
    }

    try {
      llmPipelineInstance = await pipeline("text-generation", LLM_MODEL_ID, pipelineOptions);
    } catch (gpuErr) {
      if (hasWebGpu) {
        console.warn("[LocalLlm] WebGPU init failed, retrying with CPU/WASM fallback:", gpuErr);
        onProgress?.("CPU/WASM安全モードで再初期化中...", 0.5);
        delete pipelineOptions.device;
        llmPipelineInstance = await pipeline("text-generation", LLM_MODEL_ID, pipelineOptions);
      } else {
        throw gpuErr;
      }
    }

    onProgress?.("文脈理解AI 準備完了", 1.0);
    return llmPipelineInstance;
  } catch (err) {
    console.warn("[LocalLlm] Failed to initialize Qwen2.5-0.5B:", err);
    llmPipelineInstance = null;
    throw err;
  } finally {
    isLlmLoading = false;
  }
}

/**
 * OCR認識テキストから、文脈上隠すべき機密キーワードをLLMで抽出
 * （タイムアウト10秒保護付き・非同期フェイルセーフ）
 */
export async function extractConfidentialKeywordsWithLlm(
  ocrFullText: string,
  onProgress?: (status: string) => void
): Promise<string[]> {
  if (!isLlmOptInEnabled() || !ocrFullText || ocrFullText.trim().length < 5) {
    return [];
  }

  const runExtraction = async (): Promise<string[]> => {
    onProgress?.("文脈理解AIが機密キーワードを解析中...");
    const pipe = await getLocalLlmPipeline();
    if (!pipe) return [];

    // テキストが長すぎる場合は先頭800文字にトリム
    const snippet = ocrFullText.slice(0, 800);

    const messages = [
      {
        role: "system",
        content:
          "あなたは情報漏洩を防ぐプライバシー保護AIです。以下のテキストから、個人特定につながるキーワード（人名、会社名、電話番号、住所、取引金額、社内秘プロジェクト名等）を抽出し、該当する単語をJSON配列形式（例: [\"田中\", \"50万円\", \"ProjectX\"]）のみで出力してください。余計な解説や前置きは一切不要です。"
      },
      {
        role: "user",
        content: `テキスト:\n${snippet}\n\nJSON配列:`
      }
    ];

    let outputText = "";
    try {
      // 1. チャット形式での生成を試行
      const result = await pipe(messages, {
        max_new_tokens: 120,
        temperature: 0.1,
        do_sample: false
      });
      const generated = result?.[0]?.generated_text;
      if (Array.isArray(generated)) {
        const lastMsg = generated[generated.length - 1];
        outputText = typeof lastMsg === "object" ? lastMsg.content || "" : String(lastMsg);
      } else if (typeof generated === "string") {
        outputText = generated;
      }
    } catch {
      // 2. チャット形式が非対応の場合はプレーンテキストプロンプトでフォールバック
      const rawPrompt = `指示: 以下のテキストから個人情報・社外秘キーワード（人名、会社名、金額、秘密ID等）を抽出し、JSON配列形式（例: ["田中", "50万円"]）のみで出力してください。\nテキスト:\n${snippet}\n\nJSON:`;
      const result = await pipe(rawPrompt, {
        max_new_tokens: 120,
        temperature: 0.1,
        do_sample: false
      });
      outputText = result?.[0]?.generated_text || "";
    }

    // 出力からJSON配列を抽出
    const jsonMatch = outputText.match(/\[[\s\S]*?\]/);
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
        // JSONパース失敗時はフォールバック
      }
    }

    return [];
  };

  // 10秒のタイムアウト保護（タイムアウト時は安全に空配列を返し、画像解析全体を止めない）
  try {
    const timeoutPromise = new Promise<string[]>((_, reject) => {
      setTimeout(() => reject(new Error("LLM extraction timed out after 10s")), 10000);
    });
    return await Promise.race([runExtraction(), timeoutPromise]);
  } catch (e) {
    console.warn("[LocalLlm] Keyword extraction skipped or timed out:", e);
    return [];
  }
}
