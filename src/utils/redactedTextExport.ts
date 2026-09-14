import type { RedactBox } from "../engine/redactionEngine";
import type { OcrResult } from "../engine/ocr";

/**
 * 伏字化されたテキストと統計情報
 */
export interface RedactedTextResult {
  /** 伏字化されたクリーンなテキスト文章 */
  redactedText: string;
  /** 元の全文テキスト */
  rawText: string;
  /** 伏字にした項目の件数内訳 */
  stats: {
    personCount: number;
    companyCount: number;
    piiCount: number;
    customCount: number;
  };
}

/**
 * ラベルに応じた伏字プレースホルダーを取得
 */
function getPlaceholder(box: RedactBox): string {
  switch (box.type) {
    case "person":
      return "[人名]";
    case "company":
      return "[会社名]";
    case "pii":
      if (box.label.includes("電話")) return "[電話番号]";
      if (box.label.includes("メール")) return "[メールアドレス]";
      if (box.label.includes("住所")) return "[住所]";
      return `[${box.label}]`;
    case "custom":
      return `[伏字: ${box.text || "非公開"}]`;
    default:
      return "[非公開]";
  }
}

/**
 * OCR認識行と黒塗りボックス群から、個人情報を安全に伏字化したテキスト文章を生成する
 */
export function generateRedactedText(
  ocrResult: OcrResult,
  boxes: RedactBox[]
): RedactedTextResult {
  const stats = {
    personCount: 0,
    companyCount: 0,
    piiCount: 0,
    customCount: 0
  };

  const enabledBoxes = boxes.filter((b) => b.enabled && b.type !== "face" && b.type !== "avatar");
  const processedLines: string[] = [];

  for (const line of ocrResult.lines) {
    let lineText = line.text;
    if (!lineText || lineText.trim().length === 0) continue;

    // この行の Y 座標と重なるボックスを抽出
    const lineBoxes = enabledBoxes.filter((box) => {
      const boxMidY = box.rect.y + box.rect.height / 2;
      return boxMidY >= line.bbox.y0 - 6 && boxMidY <= line.bbox.y1 + 6;
    });

    if (lineBoxes.length === 0) {
      processedLines.push(lineText);
      continue;
    }

    // 行内の文字列置換
    // ボックスに記録されたテキストやマッチ語句を長い順に置換
    lineBoxes.sort((a, b) => (b.text?.length || 0) - (a.text?.length || 0));

    for (const box of lineBoxes) {
      const placeholder = getPlaceholder(box);
      if (box.text && box.text.trim().length > 0) {
        const target = box.text.trim();
        // スペースを含めたゆらぎ置換
        const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const fuzzyRegex = new RegExp(escaped.split("").join("\\s*"), "gu");
        if (fuzzyRegex.test(lineText)) {
          lineText = lineText.replace(fuzzyRegex, placeholder);
          recordStat(stats, box.type);
          continue;
        }
      }

      // X 座標による比率置換（ボックスの位置から推測）
      const totalW = Math.max(1, line.bbox.x1 - line.bbox.x0);
      const startRatio = Math.max(0, (box.rect.x - line.bbox.x0) / totalW);
      const endRatio = Math.min(1, (box.rect.x + box.rect.width - line.bbox.x0) / totalW);
      const sIdx = Math.floor(startRatio * lineText.length);
      const eIdx = Math.min(lineText.length, Math.ceil(endRatio * lineText.length));

      if (eIdx > sIdx && sIdx >= 0) {
        lineText = lineText.slice(0, sIdx) + placeholder + lineText.slice(eIdx);
        recordStat(stats, box.type);
      }
    }

    processedLines.push(lineText);
  }

  // 連続する空行を整理
  const cleanLines = processedLines
    .map((l) => l.trim())
    .filter((l, idx, arr) => !(l === "" && arr[idx - 1] === ""));

  const redactedText = cleanLines.join("\n");
  const rawText = ocrResult.lines.map((l) => l.text).join("\n");

  return {
    redactedText,
    rawText,
    stats
  };
}

function recordStat(stats: RedactedTextResult["stats"], type: RedactBox["type"]): void {
  if (type === "person") stats.personCount++;
  else if (type === "company") stats.companyCount++;
  else if (type === "pii") stats.piiCount++;
  else if (type === "custom") stats.customCount++;
}

/**
 * AI相談用プロンプトテンプレート付きテキストを生成
 */
export function buildAiPromptWithRedactedText(
  redactedText: string,
  promptTemplate: string = "summary"
): string {
  let instructions = "以下のチャット履歴を確認し、要点と決定事項、および次のアクションを箇条書きで整理してください：";

  switch (promptTemplate) {
    case "reply":
      instructions = "以下のチャット履歴を踏まえて、丁寧でプロフェッショナルな返信メール／チャットの返信案を作成してください：";
      break;
    case "action":
      instructions = "以下のチャット内容から、担当者ごとのToDo（タスク）と期日・連絡先事項を漏れなく抽出してください：";
      break;
    case "risk":
      instructions = "以下のチャット内容から、契約・納期・合意事項に関する潜在的なリスクや注意点を洗い出してください：";
      break;
    case "summary":
    default:
      instructions = "以下のチャット履歴の要点・決定事項・連絡先情報を分かりやすく整理してください：";
      break;
  }

  return `${instructions}

--- チャット内容（個人情報・機密情報は伏字処理済み） ---
${redactedText}
-------------------------------------------------------`;
}
