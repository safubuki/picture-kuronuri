import { detectFacesAndAvatars, type DetectedFaceOrAvatar } from "./faceAvatarDetector";
import { runOcr, type OcrResult, type OcrLine, type OcrProgress } from "./ocr";
import { detectCompaniesInText } from "./rules/companyRules";
import { detectPersonsInText, isLikelyChatSender } from "./rules/honorifics";
import { detectPiiInText } from "./rules/piiPatterns";

export type RedactType =
  | "face"
  | "avatar"
  | "person"
  | "company"
  | "pii"
  | "custom"
  | "manual";

export interface RedactBox {
  id: string;
  type: RedactType;
  label: string;
  text?: string;
  reason: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  rotation?: number; // 傾き角度（度数法、例: 3.5度）
  enabled: boolean;
  confidence?: number;
  isManual?: boolean;
}

export interface RedactionFilterOptions {
  detectFaces: boolean;
  detectAvatars: boolean;
  detectPersons: boolean;
  detectCompanies: boolean;
  detectPii: boolean;
  customKeywords: string[];
  padding: number; // 安全マージン (px)
}

export const DEFAULT_FILTER_OPTIONS: RedactionFilterOptions = {
  detectFaces: true,
  detectAvatars: true,
  detectPersons: true,
  detectCompanies: true,
  detectPii: true,
  customKeywords: [],
  padding: 2
};

/**
 * 画像解析および自動墨消し領域の生成
 */
export async function analyzeImageForRedaction(
  imageElement: HTMLImageElement | HTMLCanvasElement,
  options: RedactionFilterOptions = DEFAULT_FILTER_OPTIONS,
  onProgress?: (p: OcrProgress) => void,
  preloadedOcr?: OcrResult,
  preloadedAvatars?: { x: number; y: number; width: number; height: number }[],
  rotationAngle: number = 0
): Promise<{ boxes: RedactBox[]; ocrResult: OcrResult }> {
  const boxes: RedactBox[] = [];

  // 1. 顔・アバター検出（非同期並行実行可能）
  let facesAndAvatars: DetectedFaceOrAvatar[] = [];
  if (options.detectFaces || options.detectAvatars) {
    onProgress?.({ status: "顔写真・チャットアイコンを検出中...", progress: 0.05 });
    try {
      facesAndAvatars = await detectFacesAndAvatars(imageElement, preloadedAvatars);
      for (const item of facesAndAvatars) {
        if (item.type === "face" && !options.detectFaces) continue;
        if (item.type === "avatar" && !options.detectAvatars) continue;

        boxes.push({
          id: item.id,
          type: item.type,
          label: item.label,
          reason: item.type === "face" ? "顔写真の保護" : "チャットアバターの保護",
          rect: applyPadding(item.rect, options.padding, imageElement.width, imageElement.height),
          enabled: true,
          confidence: item.confidence
        });
      }
    } catch (err) {
      console.warn("Face/Avatar detection error:", err);
    }
  }

  // 2. OCRによるテキスト抽出（preloadedOcrがあればそれを優先利用）
  let ocrResult: OcrResult;
  if (preloadedOcr) {
    ocrResult = preloadedOcr;
  } else {
    try {
      ocrResult = await runOcr(imageElement, onProgress);
    } catch (err) {
      console.warn("OCR failed or offline fallback:", err);
      ocrResult = { fullText: "", lines: [], symbols: [] };
    }
  }

  onProgress?.({ status: "ルールベース個人情報解析中...", progress: 0.9 });

  // 3. OCRテキストに対するルールベース解析
  for (const line of ocrResult.lines) {
    const lineText = line.text;
    if (!lineText || lineText.trim().length === 0) continue;

    // A. チャット送信者ヘッダー判定（短くて行頭にあり、人名らしい）
    if (options.detectPersons && isLikelyChatSender(lineText)) {
      const rect = calculateBBoxForRange(line, 0, lineText.length);
      if (rect) {
        boxes.push({
          id: `person-header-${line.bbox.x0}-${line.bbox.y0}`,
          type: "person",
          label: "送信者名",
          text: lineText.trim(),
          reason: "チャット送信者名の推定",
          rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height),
          enabled: true
        });
      }
    }

    // B. 本文中の人名・敬称判定
    if (options.detectPersons) {
      const personMatches = detectPersonsInText(lineText);
      for (const p of personMatches) {
        const rect = calculateBBoxForRange(line, p.startIndex, p.endIndex);
        if (rect) {
          boxes.push({
            id: `person-${line.bbox.x0}-${p.startIndex}`,
            type: "person",
            label: "人名",
            text: p.matchedText,
            reason: getPersonReasonText(p.reason),
            rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height),
            enabled: true
          });
        }
      }
    }

    // C. 会社名・法人名判定
    if (options.detectCompanies) {
      const companyMatches = detectCompaniesInText(lineText);
      for (const c of companyMatches) {
        const rect = calculateBBoxForRange(line, c.startIndex, c.endIndex);
        if (rect) {
          boxes.push({
            id: `corp-${line.bbox.x0}-${c.startIndex}`,
            type: "company",
            label: "会社名・組織",
            text: c.matchedText,
            reason: "法人格または企業名パターン",
            rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height),
            enabled: true
          });
        }
      }
    }

    // D. PII（電話、メール、住所、金額、SNS ID）判定
    if (options.detectPii) {
      const piiMatches = detectPiiInText(lineText);
      for (const p of piiMatches) {
        const rect = calculateBBoxForRange(line, p.startIndex, p.endIndex);
        if (rect) {
          boxes.push({
            id: `pii-${p.category}-${line.bbox.x0}-${p.startIndex}`,
            type: "pii",
            label: p.label,
            text: p.matchedText,
            reason: `特定個人情報 (${p.label})`,
            rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height),
            enabled: true
          });
        }
      }
    }

    // E. ユーザー指定のカスタムキーワード判定
    if (options.customKeywords && options.customKeywords.length > 0) {
      for (const keyword of options.customKeywords) {
        const kw = keyword.trim();
        if (!kw) continue;
        let startIndex = 0;
        while ((startIndex = lineText.indexOf(kw, startIndex)) !== -1) {
          const endIndex = startIndex + kw.length;
          const rect = calculateBBoxForRange(line, startIndex, endIndex);
          if (rect) {
            boxes.push({
              id: `custom-${line.bbox.x0}-${startIndex}-${kw}`,
              type: "custom",
              label: "カスタム単語",
              text: kw,
              reason: `指定キーワード: "${kw}"`,
              rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height),
              enabled: true
            });
          }
          startIndex = endIndex;
        }
      }
    }
  }

  // 傾き角度の反映（斜め文字行の追従マスキング用）
  if (rotationAngle !== 0) {
    for (const b of boxes) {
      if (b.rotation === undefined) {
        b.rotation = rotationAngle;
      }
    }
  }

  // 重複矩形の整理（同じ領域に対する完全重複を排除）
  const uniqueBoxes = removeDuplicateBoxes(boxes);

  onProgress?.({ status: "解析完了", progress: 1.0 });

  return {
    boxes: uniqueBoxes,
    ocrResult
  };
}

/**
 * 行内の文字インデックス範囲 [startIndex, endIndex) に対応する矩形座標を計算する
 */
function calculateBBoxForRange(
  line: OcrLine,
  startIndex: number,
  endIndex: number
): { x: number; y: number; width: number; height: number } | null {
  const textLen = line.text.length;
  if (startIndex < 0 || endIndex > textLen || startIndex >= endIndex) return null;

  // symbols（文字単位情報）がある場合はそれを利用
  if (line.symbols && line.symbols.length > 0) {
    // line.symbols の長さと line.text の長さが一致しない場合があるため、比率またはインデックスでクランプ
    const symStart = Math.min(startIndex, line.symbols.length - 1);
    const symEnd = Math.min(endIndex - 1, line.symbols.length - 1);

    if (symStart <= symEnd && symStart >= 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (let i = symStart; i <= symEnd; i++) {
        const b = line.symbols[i].bbox;
        minX = Math.min(minX, b.x0);
        minY = Math.min(minY, b.y0);
        maxX = Math.max(maxX, b.x1);
        maxY = Math.max(maxY, b.y1);
      }

      if (minX !== Infinity && maxX > minX) {
        return {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY
        };
      }
    }
  }

  // symbolsがない場合は行全体の幅から比率で推定
  const lineBox = line.bbox;
  const totalW = lineBox.x1 - lineBox.x0;
  const totalH = lineBox.y1 - lineBox.y0;

  const startRatio = startIndex / textLen;
  const endRatio = endIndex / textLen;

  const x = Math.round(lineBox.x0 + totalW * startRatio);
  const width = Math.max(10, Math.round(totalW * (endRatio - startRatio)));

  return {
    x,
    y: lineBox.y0,
    width,
    height: totalH
  };
}

/**
 * 安全マージン（パディング）を適用し、画像境界内にクランプ
 */
function applyPadding(
  rect: { x: number; y: number; width: number; height: number },
  padding: number,
  maxWidth: number,
  maxHeight: number
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, rect.x - padding);
  const y = Math.max(0, rect.y - padding);
  const right = Math.min(maxWidth, rect.x + rect.width + padding);
  const bottom = Math.min(maxHeight, rect.y + rect.height + padding);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y
  };
}

function getPersonReasonText(reason: string): string {
  switch (reason) {
    case "surname_match":
      return "主要名字辞書との一致";
    case "honorific_match":
      return "敬称・役職付き人名パターン";
    case "full_name_pattern":
      return "フルネーム（姓名）パターン";
    case "chat_sender_header":
      return "チャット送信者名の推定";
    default:
      return "人名パターンの検知";
  }
}

/**
 * ほぼ完全に同一の領域を指す重複ボックスを統合・除去
 */
function removeDuplicateBoxes(boxes: RedactBox[]): RedactBox[] {
  const result: RedactBox[] = [];

  for (const b of boxes) {
    const isDuplicate = result.some(r => {
      const xDiff = Math.abs(r.rect.x - b.rect.x);
      const yDiff = Math.abs(r.rect.y - b.rect.y);
      const wDiff = Math.abs(r.rect.width - b.rect.width);
      const hDiff = Math.abs(r.rect.height - b.rect.height);
      // 位置が5px以内で幅高さも近似している場合は同一とみなす
      return xDiff < 8 && yDiff < 8 && wDiff < 15 && hDiff < 15;
    });

    if (!isDuplicate) {
      result.push(b);
    }
  }

  return result;
}
