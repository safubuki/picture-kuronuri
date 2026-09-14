/**
 * 画像のエクスポート、クリップボードコピー、AI相談プロンプト生成
 */

export interface ExportResult {
  success: boolean;
  message: string;
}

/**
 * Canvasの内容を高画質PNGとしてクリップボードにコピーする
 */
export async function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<ExportResult> {
  try {
    if (!navigator.clipboard || !window.ClipboardItem) {
      return { success: false, message: "お使いのブラウザはクリップボードへの画像コピーに対応していません。ダウンロードをご利用ください。" };
    }

    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(b => resolve(b), "image/png", 1.0);
    });

    if (!blob) {
      return { success: false, message: "画像の生成に失敗しました。" };
    }

    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": blob
      })
    ]);

    return { success: true, message: "画像をクリップボードにコピーしました！AIチャットに直接ペーストできます。" };
  } catch (err) {
    console.error("Clipboard copy failed:", err);
    return { success: false, message: `コピーに失敗しました: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * 画像をファイルとしてダウンロード
 */
export function downloadCanvasImage(
  canvas: HTMLCanvasElement,
  filename: string = "kuronuri_protected.png"
): void {
  const dataUrl = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * AI相談用プロンプトのテキストをクリップボードにコピーする
 */
export async function copyAiPromptToClipboard(promptType: "summary" | "reply" | "advice"): Promise<ExportResult> {
  let promptText = "";

  switch (promptType) {
    case "summary":
      promptText = `【チャット画像の要約依頼】
添付したチャット画像のやり取り内容を要約し、重要ポイントと決定事項を箇条書きで整理してください。
※なお、社名・人名・顔写真・連絡先等の個人情報・機密情報は、完全ローカル環境にて事前に黒塗りマスキング処理済みです。`;
      break;

    case "reply":
      promptText = `【返信メッセージの作成依頼】
添付したチャット画像のやり取りを読み取り、相手への丁寧かつ適切な返信メッセージの文案を2〜3パターン作成してください。
※なお、社名・人名・顔写真・連絡先等の個人情報・機密情報は、完全ローカル環境にて事前に黒塗りマスキング処理済みです。`;
      break;

    case "advice":
      promptText = `【ビジネスアドバイス・課題分析の依頼】
添付したチャット画像のやり取りにおいて、見落とされているリスクや今後のアクションについての助言をお願いします。
※なお、社名・人名・顔写真・連絡先等の個人情報・機密情報は、完全ローカル環境にて事前に黒塗りマスキング処理済みです。`;
      break;
  }

  try {
    await navigator.clipboard.writeText(promptText);
    return { success: true, message: "AI相談用プロンプトをコピーしました！AIの入力欄に貼り付けてご活用ください。" };
  } catch (err) {
    return { success: false, message: "プロンプトのコピーに失敗しました。" };
  }
}
