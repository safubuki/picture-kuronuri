import { detectFacesAndAvatars, type DetectedFaceOrAvatar } from "./faceAvatarDetector";
import { runOcr, type OcrResult, type OcrLine, type OcrProgress } from "./ocr";
import { detectCompaniesInText } from "./rules/companyRules";
import { detectPersonsInText, isLikelyChatSender } from "./rules/honorifics";
import { detectPiiInText } from "./rules/piiPatterns";
import { snapBoxesToInk } from "./inkSnap";
import { extractEntitiesWithLocalAi } from "./localAiNer";

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
  aiConfidenceThreshold?: number; // AI判定感度しきい値 (0.3〜0.85, デフォルト: 0.5)
}

export const DEFAULT_FILTER_OPTIONS: RedactionFilterOptions = {
  detectFaces: true,
  detectAvatars: true,
  detectPersons: true,
  detectCompanies: true,
  detectPii: true,
  customKeywords: [],
  padding: 2,
  aiConfidenceThreshold: 0.5
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

  // 3. 端末内完全ローカルAI（Transformers.js NER）による文脈理解エンティティ抽出
  const fullText = ocrResult.lines.map(l => l.text).join("\n");
  if (fullText.trim().length > 0) {
    try {
      const aiEntities = await extractEntitiesWithLocalAi(
        fullText,
        (status, p) => {
          onProgress?.({ status, progress: 0.85 + p * 0.08 });
        },
        options.aiConfidenceThreshold ?? 0.5
      );

      for (const entity of aiEntities) {
        if (entity.type === "person" && !options.detectPersons) continue;
        if (entity.type === "company" && !options.detectCompanies) continue;
        if (entity.type === "location" && !options.detectPii) continue;

        // 各行をスキャンしてファジーマッピングでエンティティの文字座標を特定
        for (const line of ocrResult.lines) {
          const matches = findEntityInLineWithFuzzy(line.text, entity.text);
          for (const m of matches) {
            const rect = calculateBBoxForRange(line, m.startIndex, m.endIndex);
            if (rect) {
              const label = entity.type === "person" ? "人名 (AI)" : entity.type === "company" ? "会社名 (AI)" : "住所 (AI)";
              boxes.push({
                id: `ai-${entity.type}-${line.bbox.x0}-${m.startIndex}`,
                type: entity.type === "location" ? "pii" : entity.type,
                label,
                text: m.matchedText,
                reason: `端末内AI文脈認識 (${Math.round(entity.score * 100)}%)`,
                rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText),
                enabled: true,
                confidence: entity.score
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn("[redactionEngine] Local AI NER skipped:", err);
    }
  }

  onProgress?.({ status: "個人情報解析・統合中...", progress: 0.94 });

  // 4. OCRテキストに対するルールベース解析（相補的ハイブリッド）
  for (const line of ocrResult.lines) {
    const lineText = line.text;
    if (!lineText || lineText.trim().length === 0) continue;

    // A. チャット送信者ヘッダー判定（短くて行頭にあり、人名らしい）
    if (options.detectPersons && isLikelyChatSender(lineText)) {
      const rect = calculateBBoxForRange(line, 0, lineText.length);
      console.log("[redactionEngine:header]", { lineText, rect });
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
        console.log("[redactionEngine:person]", {
          lineText,
          matched: p.matchedText,
          range: [p.startIndex, p.endIndex],
          rect
        });
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
  // すでに画素側で正対化している場合は回転を掛けない（箱が文字からズレる）
  if (rotationAngle !== 0 && Math.abs(rotationAngle) >= 0.8) {
    for (const b of boxes) {
      if (b.rotation === undefined) {
        b.rotation = rotationAngle;
      }
    }
  }

  // サンプル画像（事前定義メタデータあり）の場合は、位置ズレや誤マージを起こさないようスナップとマージをバイパス
  const isSampleOrPreloaded = !!preloadedOcr || (preloadedAvatars && preloadedAvatars.length > 0);

  if (!isSampleOrPreloaded) {
    onProgress?.({ status: "黒塗り位置を文字に合わせて調整中...", progress: 0.94 });
    try {
      snapBoxesToInk(imageElement, boxes);
    } catch (err) {
      console.warn("Ink snap failed:", err);
    }
  }

  // 重複矩形の整理（同じ領域に対する完全重複・包含を排除）
  const dedupedBoxes = removeDuplicateBoxes(boxes);
  const finalBoxes = isSampleOrPreloaded ? dedupedBoxes : mergeAdjacentBoxes(dedupedBoxes);

  onProgress?.({ status: "解析完了", progress: 1.0 });

  return {
    boxes: finalBoxes,
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

interface FuzzyMatchResult {
  startIndex: number;
  endIndex: number;
  matchedText: string;
}

/**
 * OCRテキスト行の中から、スペースや記号混じり、表記揺れを吸収してエンティティの文字位置を特定
 */
function findEntityInLineWithFuzzy(lineText: string, entityText: string): FuzzyMatchResult[] {
  const results: FuzzyMatchResult[] = [];
  if (!lineText || !entityText) return results;

  const cleanEntity = entityText.replace(/[\s\t\r\n\u3000]/g, "");
  if (cleanEntity.length === 0) return results;

  // lineText の各文字について、空白を除いた文字インデックスマップを作成
  const mapping: number[] = [];
  let cleanLine = "";
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (!/[\s\t\r\n\u3000]/.test(ch)) {
      mapping.push(i);
      cleanLine += ch;
    }
  }

  let searchPos = 0;
  while (searchPos < cleanLine.length) {
    const foundPos = cleanLine.indexOf(cleanEntity, searchPos);
    if (foundPos === -1) break;

    const startOriginal = mapping[foundPos];
    const endClean = foundPos + cleanEntity.length - 1;
    const endOriginal = mapping[endClean] + 1; // inclusive -> exclusive

    results.push({
      startIndex: startOriginal,
      endIndex: endOriginal,
      matchedText: lineText.slice(startOriginal, endOriginal)
    });

    searchPos = foundPos + 1;
  }

  return results;
}

function calculateBBoxForRange(
  line: OcrLine,
  startIndex: number,
  endIndex: number
): { x: number; y: number; width: number; height: number } | null {
  const textLen = line.text.length;
  if (startIndex < 0 || endIndex > textLen || startIndex >= endIndex) return null;

  // 1. ターゲットテキストの直接シンボル照合（文字一致でピンポイント特定）
  const targetText = line.text.slice(startIndex, endIndex).replace(/[\s\t\u3000]/g, "");
  const symbolsToSearch = (line.alignedSymbols && line.alignedSymbols.length > 0) ? line.alignedSymbols : line.symbols;

  let resultBox: { x: number; y: number; width: number; height: number } | null = null;

  if (targetText && symbolsToSearch && symbolsToSearch.length > 0) {
    const symTexts = symbolsToSearch.map((s) => (s.text || "").replace(/[\s\t\u3000]/g, ""));
    const fullSymStr = symTexts.join("");
    let matchIdx = fullSymStr.indexOf(targetText);

    // 完全一致しない場合、末尾側（例:「田様」）や先頭側で部分一致を試行
    if (matchIdx === -1 && targetText.length >= 2) {
      const sub = targetText.slice(1);
      const subIdx = fullSymStr.indexOf(sub);
      if (subIdx > 0) {
        matchIdx = subIdx - 1;
      }
    }

    if (matchIdx !== -1) {
      const matchedSlice = symbolsToSearch.slice(matchIdx, matchIdx + targetText.length);
      resultBox = bboxFromSymbols(matchedSlice, 0, matchedSlice.length);
    }
  }

  // 2. シンボル照合ができなかった場合のフォールバック
  if (!resultBox) {
    if (line.alignedSymbols && line.alignedSymbols.length > 0) {
      resultBox = bboxFromSymbols(line.alignedSymbols, startIndex, endIndex);
    }
  }

  if (!resultBox && line.symbols && line.symbols.length > 0) {
    resultBox = bboxFromSymbols(line.symbols, startIndex, endIndex);
  }

  // 3. 単語列からの比率推定フォールバック
  if (!resultBox && line.words && line.words.length > 0) {
    const ratioStart = startIndex / textLen;
    const ratioEnd = endIndex / textLen;
    const from = Math.floor(ratioStart * line.words.length);
    const to = Math.min(line.words.length - 1, Math.max(from, Math.ceil(ratioEnd * line.words.length) - 1));
    resultBox = bboxFromSymbols(
      line.words.map((w) => ({ bbox: w.bbox })),
      from,
      to + 1
    );
  }

  if (!resultBox) {
    const lineBox = line.bbox;
    const totalW = lineBox.x1 - lineBox.x0;
    const totalH = lineBox.y1 - lineBox.y0;
    const startRatio = startIndex / textLen;
    const endRatio = endIndex / textLen;
    const x = Math.round(lineBox.x0 + totalW * startRatio);
    const width = Math.max(10, Math.round(totalW * (endRatio - startRatio)));
    resultBox = { x, y: lineBox.y0, width, height: totalH };
  }

  // ★ 4. 行頭・境界アンカーによるズレの幾何学的完全補正 ★
  if (resultBox) {
    // A. 行頭（または空白・記号直後）から始まる語句の場合、行頭の文字のはみ出しを防止
    const prefix = line.text.slice(0, startIndex);
    if (/^[\s\t\u3000「『"']{0,2}$/.test(prefix)) {
      // 行の最左端（line.bbox.x0）まで黒塗りを確実に左伸張
      const origRight = resultBox.x + resultBox.width;
      resultBox.x = Math.min(resultBox.x, line.bbox.x0);
      resultBox.width = Math.max(resultBox.width, origRight - resultBox.x);
    }

    // B. 「（」や「(」の直後から始まる語句（例:「プロジェクト連絡（山田・鈴木）」）
    const parenMatch = prefix.match(/[（(][\s\t]*$/);
    if (parenMatch) {
      // 括弧の直後から始まるため、もし黒塗りが右にズレていたら左側（括弧のすぐ右）までカバー
      const parenRatio = (prefix.length - parenMatch[0].length + 1) / textLen;
      const expectedLeft = Math.round(line.bbox.x0 + (line.bbox.x1 - line.bbox.x0) * parenRatio);
      if (resultBox.x > expectedLeft + 6) {
        const origRight = resultBox.x + resultBox.width;
        resultBox.x = expectedLeft;
        resultBox.width = Math.max(resultBox.width, origRight - resultBox.x);
      }
    }
  }

  return resultBox;
}

/**
 * 安全マージン（パディング）を適用し、画像境界内にクランプ
 */
function applyPadding(
  rect: { x: number; y: number; width: number; height: number },
  padding: number,
  maxWidth: number,
  maxHeight: number,
  _expandForPhoto: boolean = false
): { x: number; y: number; width: number; height: number } {
  // 黒塗りを細くスタイリッシュに保つため、上下は0〜1pxに厳格制限（行間を潰さず文字にフィット）
  const padY = Math.min(1, Math.max(0, padding));
  // 左右は文字末尾が見切れないよう適度に1〜2px
  const padX = Math.min(2, Math.max(1, padding));

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

function getBoxPriority(type: RedactType): number {
  switch (type) {
    case "pii": return 100;
    case "company": return 90;
    case "person": return 80;
    case "custom": return 70;
    case "manual": return 60;
    case "avatar": return 50;
    case "face": return 40;
    default: return 0;
  }
}

function removeDuplicateBoxes(boxes: RedactBox[]): RedactBox[] {
  // 優先度の高い順（PII > 会社名 > 人名 > アイコン）にソート
  const sorted = [...boxes].sort((a, b) => getBoxPriority(b.type) - getBoxPriority(a.type));
  const result: RedactBox[] = [];

  for (const b of sorted) {
    let merged = false;
    for (let i = 0; i < result.length; i++) {
      const r = result[i];
      const xLeft = Math.max(r.rect.x, b.rect.x);
      const yTop = Math.max(r.rect.y, b.rect.y);
      const xRight = Math.min(r.rect.x + r.rect.width, b.rect.x + b.rect.width);
      const yBottom = Math.min(r.rect.y + r.rect.height, b.rect.y + b.rect.height);

      if (xRight > xLeft && yBottom > yTop) {
        const overlapArea = (xRight - xLeft) * (yBottom - yTop);
        const smallerArea = Math.min(boxArea(r.rect), boxArea(b.rect));
        const overlapRatio = smallerArea > 0 ? overlapArea / smallerArea : 0;

        // 35%以上重なっている場合は優先度の高い方に統合（多重ラベル・真っ黒ブロック化を防止）
        if (overlapRatio >= 0.35) {
          const unionX = Math.min(r.rect.x, b.rect.x);
          const unionY = Math.min(r.rect.y, b.rect.y);
          const unionR = Math.max(r.rect.x + r.rect.width, b.rect.x + b.rect.width);
          const unionB = Math.max(r.rect.y + r.rect.height, b.rect.y + b.rect.height);

          result[i] = {
            ...r,
            text: r.text || b.text,
            rect: {
              x: unionX,
              y: unionY,
              width: unionR - unionX,
              height: unionB - unionY
            }
          };
          merged = true;
          break;
        }
      }
    }

    if (!merged) {
      result.push(b);
    }
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
        if (gap > 2) continue; // 重なりまたは完全接触（2px以内）のみ結合を許可
        if (gap < -Math.max(a.height, b.height) * 0.3) continue;

        // 人名同士でどちらかが敬称付き（「山田さん」等）なら別人なので結合しない
        if (acc.type === "person") {
          const aText = acc.text || "";
          const bText = other.text || "";
          if (/(?:様|さま|さん|サン|君|くん|ちゃん|氏|殿)$/.test(aText) || /(?:様|さま|さん|サン|君|くん|ちゃん|氏|殿)$/.test(bText)) {
            continue;
          }
        }

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
