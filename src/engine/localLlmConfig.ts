/** モデルの読み込み・保存状態・画面表示で共有する設定。 */
export const LOCAL_LLM_MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX";
export const LOCAL_LLM_DISPLAY_NAME = "Qwen3 0.6B";
// 重みとトークナイザー等の初回取得量の目安。実行時メモリとは別。
export const LOCAL_LLM_DOWNLOAD_LABEL = "約600～950MB";
export const LOCAL_LLM_DTYPES = ["q4f16", "q4"] as const;
