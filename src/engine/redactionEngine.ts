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
          rect: applyPadding(item.rect, options.padding, imageElement.width, imageElement.height, false),
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
      ocrResult = { fullText: "", lines: [], symbols: [], scale: 1 };
    }
  }

  const isScreenPhoto = ocrResult.analysis?.isLikelyScreenPhoto === true;
  const smallText =
    (ocrResult.analysis?.estimatedLineHeight || 99) > 0 &&
    (ocrResult.analysis?.estimatedLineHeight || 99) < 18;

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
          rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText),
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
            rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText),
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
            rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText),
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
            rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText),
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
              rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText),
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

  // 重複矩形の整理（同じ領域に対する完全重複・包含を排除）
  const uniqueBoxes = mergeAdjacentBoxes(removeDuplicateBoxes(boxes));

  onProgress?.({ status: "解析完了", progress: 1.0 });

  return {
    boxes: uniqueBoxes,
    ocrResult
  };
}

/**
 * 行内の文字インデックス範囲 [startIndex, endIndex) に対応する矩形座標を計算する
 */
function bboxFromSymbols(
  symbols: { bbox: { x0: number; y0: number; x1: number; y1: number } }[],
  startIndex: number,
  endIndex: number
): { x: number; y: number; width: number; height: number } | null {
  if (!symbols || symbols.length === 0) return null;
  const symStart = Math.min(Math.max(0, startIndex), symbols.length - 1);
  const symEnd = Math.min(Math.max(symStart, endIndex - 1), symbols.length - 1);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = symStart; i <= symEnd; i++) {
    const b = symbols[i].bbox;
    minX = Math.min(minX, b.x0);
    minY = Math.min(minY, b.y0);
    maxX = Math.max(maxX, b.x1);
    maxY = Math.max(maxY, b.y1);
  }

  if (minX === Infinity || maxX <= minX) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: Math.max(1, maxY - minY)
  };
}

function calculateBBoxForRange(
  line: OcrLine,
  startIndex: number,
  endIndex: number
): { x: number; y: number; width: number; height: number } | null {
  const textLen = line.text.length;
  if (startIndex < 0 || endIndex > textLen || startIndex >= endIndex) return null;

  // 正規化後テキストと 1:1 の alignedSymbols を最優先
  if (line.alignedSymbols && line.alignedSymbols.length > 0) {
    const aligned = bboxFromSymbols(line.alignedSymbols, startIndex, endIndex);
    if (aligned) return aligned;
  }

  if (line.symbols && line.symbols.length > 0) {
    const fromSym = bboxFromSymbols(line.symbols, startIndex, endIndex);
    if (fromSym) return fromSym;
  }

  // 単語列から比率推定
  if (line.words && line.words.length > 0) {
    const joined = line.words.map((w) => w.text).join("");
    if (joined.length > 0) {
      const ratioStart = startIndex / textLen;
      const ratioEnd = endIndex / textLen;
      const from = Math.floor(ratioStart * line.words.length);
      const to = Math.min(line.words.length - 1, Math.max(from, Math.ceil(ratioEnd * line.words.length) - 1));
      const fromWord = bboxFromSymbols(
        line.words.map((w) => ({ bbox: w.bbox })),
        from,
        to + 1
      );
      if (fromWord) return fromWord;
    }
  }

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
  maxHeight: number,
  expandForPhoto: boolean = false
): { x: number; y: number; width: number; height: number } {
  let padX = padding;
  let padY = padding;
  if (expandForPhoto) {
    padY = Math.max(padding + 2, Math.round(rect.height * 0.2));
    padX = Math.max(padding + 1, Math.round(rect.width * 0.07));
  } else if (rect.height > 0 && rect.height < 16) {
    padY = Math.max(padding + 1, Math.round(rect.height * 0.16));
    padX = Math.max(padding, Math.round(rect.width * 0.05));
  }

  const x = Math.max(0, rect.x - padX);
  const y = Math.max(0, rect.y - padY);
  const right = Math.min(maxWidth, rect.x + rect.width + padX);
  const bottom = Math.min(maxHeight, rect.y + rect.height + padY);

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
function boxArea(r: { width: number; height: number }): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

function containsBox(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    inner.x >= outer.x - 2 &&
    inner.y >= outer.y - 2 &&
    inner.x + inner.width <= outer.x + outer.width + 2 &&
    inner.y + inner.height <= outer.y + outer.height + 2
  );
}

function removeDuplicateBoxes(boxes: RedactBox[]): RedactBox[] {
  const result: RedactBox[] = [];

  for (const b of boxes) {
    const isDuplicate = result.some(r => {
      if (r.type !== b.type) return false;
      const xDiff = Math.abs(r.rect.x - b.rect.x);
      const yDiff = Math.abs(r.rect.y - b.rect.y);
      const wDiff = Math.abs(r.rect.width - b.rect.width);
      const hDiff = Math.abs(r.rect.height - b.rect.height);
      return xDiff < 8 && yDiff < 8 && wDiff < 15 && hDiff < 15;
    });
    if (isDuplicate) continue;

    const containedByLarger = result.some(r => {
      if (r.type !== b.type) return false;
      return containsBox(r.rect, b.rect) && boxArea(r.rect) >= boxArea(b.rect);
    });
    if (containedByLarger) continue;

    for (let i = result.length - 1; i >= 0; i--) {
      const r = result[i];
      if (r.type === b.type && containsBox(b.rect, r.rect) && boxArea(b.rect) > boxArea(r.rect)) {
        result.splice(i, 1);
      }
    }

    result.push(b);
  }

  return result;
}

/**
 * 同一行で隣接する同種ボックスを結合（細切れ OCR 対策）
 */
function mergeAdjacentBoxes(boxes: RedactBox[]): RedactBox[] {
  const mergeable = new Set<RedactBox["type"]>(["person", "company", "pii", "custom"]);
  const out: RedactBox[] = [];
  const used = new Uint8Array(boxes.length);

  for (let i = 0; i < boxes.length; i++) {
    if (used[i]) continue;
    let acc = boxes[i];
    if (!mergeable.has(acc.type) || acc.isManual) {
      out.push(acc);
      used[i] = 1;
      continue;
    }
    used[i] = 1;
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < boxes.length; j++) {
        if (used[j]) continue;
        const other = boxes[j];
        if (other.type !== acc.type || other.isManual) continue;

        const a = acc.rect;
        const b = other.rect;
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        const minH = Math.min(a.height, b.height) || 1;
        if (overlapY / minH < 0.5) continue;
        if (Math.abs(a.height - b.height) / Math.max(a.height, b.height, 1) > 0.5) continue;

        const gap = a.x <= b.x ? b.x - (a.x + a.width) : a.x - (b.x + b.width);
        if (gap > Math.max(a.height, b.height) * 0.55) continue;
        if (gap < -Math.max(a.height, b.height) * 0.3) continue;

        acc = {
          ...acc,
          text: [acc.text, other.text].filter(Boolean).join(""),
          rect: {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
            height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y)
          }
        };
        used[j] = 1;
        changed = true;
      }
    }
    out.push(acc);
  }

  return out;
}
