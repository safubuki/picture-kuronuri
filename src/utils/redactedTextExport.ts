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
  const l = (box.label || "").trim();
  if (l && l !== "手動指定" && l !== "手動") {
    if (l === "メール" || l.includes("メール")) return "[メールアドレス]";
    if (l === "電話番号" || l.includes("電話")) return "[電話番号]";
    if (l === "住所" || l.includes("住所")) return "[住所]";
    if (l === "人名" || l.includes("人名")) return "[人名]";
    if (l === "会社名" || l.includes("会社")) return "[会社名]";
    if (l === "パスワード" || l.includes("パスワード")) return "[パスワード]";
    if (l === "金額" || l.includes("金額")) return "[金額]";
    return `[${l}]`;
  }

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
    const originalText = line.text;
    if (!originalText || originalText.trim().length === 0) continue;

    const chars = [...originalText];
    const nChars = chars.length;
    if (nChars === 0) continue;

    // 各文字のバウンディングボックスを取得または推定
    const symbols = (line.alignedSymbols && line.alignedSymbols.length === nChars)
      ? line.alignedSymbols
      : (line.symbols && line.symbols.length === nChars)
      ? line.symbols
      : null;

    const totalW = Math.max(1, line.bbox.x1 - line.bbox.x0);
    const charW = totalW / nChars;

    const charBBoxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (let i = 0; i < nChars; i++) {
      if (symbols && symbols[i] && symbols[i].bbox) {
        charBBoxes.push(symbols[i].bbox);
      } else {
        charBBoxes.push({
          x0: Math.round(line.bbox.x0 + i * charW),
          y0: line.bbox.y0,
          x1: Math.round(line.bbox.x0 + (i + 1) * charW),
          y1: line.bbox.y1
        });
      }
    }

    // 各文字がどのボックスで伏字化されるかを記録
    interface CharCover {
      covered: boolean;
      placeholder: string;
      boxId: string;
      type: RedactBox["type"];
    }
    const coverage: (CharCover | null)[] = new Array(nChars).fill(null);

    // この行の Y 座標と重なるボックスを抽出
    const lineBoxes = enabledBoxes.filter((box) => {
      const bY0 = box.rect.y;
      const bY1 = box.rect.y + box.rect.height;
      return bY1 >= line.bbox.y0 - 4 && bY0 <= line.bbox.y1 + 4;
    });

    for (const box of lineBoxes) {
      const placeholder = getPlaceholder(box);

      // A. テキストが明示されているボックスは文字列マッチを優先
      let matchedByText = false;
      if (box.text && box.text.trim().length > 0) {
        const target = box.text.trim().replace(/[\s\u3000]/g, "");
        const cleanLine = originalText.replace(/[\s\u3000]/g, "");
        if (target.length >= 2 && cleanLine.includes(target)) {
          // 元テキスト上の出現位置を特定
          let searchIdx = 0;
          while (searchIdx < originalText.length) {
            const found = originalText.indexOf(box.text.trim(), searchIdx);
            if (found === -1) break;
            const endIdx = found + box.text.trim().length;
            for (let c = found; c < endIdx; c++) {
              if (c < nChars) {
                coverage[c] = { covered: true, placeholder, boxId: box.id, type: box.type };
              }
            }
            matchedByText = true;
            searchIdx = endIdx;
          }
        }
      }

      // B. テキストで完全一致しなかった場合、または手動黒塗りは文字座標との幾何交差判定
      if (!matchedByText) {
        const bx0 = box.rect.x;
        const bx1 = box.rect.x + box.rect.width;
        const by0 = box.rect.y;
        const by1 = box.rect.y + box.rect.height;

        for (let i = 0; i < nChars; i++) {
          const cb = charBBoxes[i];
          const cxMid = (cb.x0 + cb.x1) / 2;
          const cyMid = (cb.y0 + cb.y1) / 2;

          // 文字の中心がボックス内にある、または横方向のオーバーラップが50%以上
          const xOverlap = Math.max(0, Math.min(bx1, cb.x1) - Math.max(bx0, cb.x0));
          const charWidth = Math.max(1, cb.x1 - cb.x0);
          const isCoveredX = (cxMid >= bx0 && cxMid <= bx1) || (xOverlap / charWidth >= 0.45);
          const isCoveredY = (cyMid >= by0 && cyMid <= by1) || (by1 >= cb.y0 && by0 <= cb.y1);

          if (isCoveredX && isCoveredY) {
            coverage[i] = { covered: true, placeholder, boxId: box.id, type: box.type };
          }
        }
      }
    }

    // 連続する伏字区間をスパン置換して行テキストを再構築
    let lineResult = "";
    let i = 0;
    const recordedBoxIds = new Set<string>();

    while (i < nChars) {
      const cov = coverage[i];
      if (!cov) {
        lineResult += chars[i];
        i++;
      } else {
        const currentPlaceholder = cov.placeholder;
        const currentBoxId = cov.boxId;
        if (!recordedBoxIds.has(currentBoxId)) {
          recordStat(stats, cov.type);
          recordedBoxIds.add(currentBoxId);
        }

        // 同じボックスまたは同じプレースホルダーの連続区間をスキップ
        while (i < nChars && coverage[i] && (coverage[i]?.boxId === currentBoxId || coverage[i]?.placeholder === currentPlaceholder)) {
          i++;
        }
        lineResult += currentPlaceholder;
      }
    }

    processedLines.push(lineResult);
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
