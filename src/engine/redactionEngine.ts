import { detectFacesAndAvatars, type DetectedFaceOrAvatar } from "./faceAvatarDetector";
import { runOcr, type OcrResult, type OcrLine, type OcrProgress } from "./ocr";
import { detectCompaniesInText } from "./rules/companyRules";
import { detectPersonsInText, isLikelyChatSender } from "./rules/honorifics";
import { detectPiiInText } from "./rules/piiPatterns";
import { detectLayoutPii } from "./rules/layoutRules";
import { mapNormRangeToOriginal, normalizeOcrText } from "./ocrNormalize";
import { snapBoxesToInk } from "./inkSnap";
import { findExactEntityRanges, prepareSearchText } from "./textMatching";
import { analyzeOcrWithLlm, type LlmAnalysisSummary } from "./llmRedaction";

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

// 画像が同じなら、フィルターや余白変更で画素解析を繰り返さない。
const avatarCache = new WeakMap<HTMLImageElement, {
  src: string;
  width: number;
  height: number;
  ocr: OcrResult;
  known: typeof undefined | { x: number; y: number; width: number; height: number }[];
  items: DetectedFaceOrAvatar[];
}>();

/** 短い文字列だけで送信者と決めず、本文と時刻/実写アイコンの配置を確認する。 */
export function hasChatSenderContext(
  line: OcrLine,
  lines: OcrLine[],
  avatars: DetectedFaceOrAvatar[]
): boolean {
  const height = Math.max(1, line.bbox.y1 - line.bbox.y0);
  const hasBodyBelow = lines.some((other) => other !== line && other.text.trim().length >= 3 &&
    other.bbox.y0 >= line.bbox.y1 - height * 0.1 &&
    other.bbox.y0 - line.bbox.y1 <= height * 2.5 &&
    Math.abs(other.bbox.x0 - line.bbox.x0) <= height * 2);
  if (!hasBodyBelow) return false;
  if (/\s\d{1,2}:\d{2}(?:\s*(?:既読|未読|送信済み))?\s*$/.test(line.text)) return true;
  return avatars.some(({ rect }) => {
    const gap = line.bbox.x0 - (rect.x + rect.width);
    return gap >= -height * 0.2 && gap <= height * 2 &&
      line.bbox.y0 >= rect.y - height * 0.5 &&
      line.bbox.y0 <= rect.y + rect.height * 0.5;
  });
}

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
): Promise<{ boxes: RedactBox[]; ocrResult: OcrResult; llmAnalysis: LlmAnalysisSummary }> {
  const boxes: RedactBox[] = [];

  // OCRの本文座標を先に確定し、文字を写真と誤検出する経路を除外する。
  let ocrResult: OcrResult;
  if (preloadedOcr) {
    ocrResult = preloadedOcr;
  } else {
    try {
      ocrResult = await runOcr(imageElement, onProgress);
    } catch (err) {
      console.warn("OCR failed or offline fallback:", err);
      ocrResult = {
        fullText: "",
        lines: [],
        symbols: [],
        scale: 1,
        status: "failed",
        warnings: ["OCRの初期化または文字認識に失敗しました。自動検出結果を確認できません。"]
      };
    }
  }

  let facesAndAvatars: DetectedFaceOrAvatar[] = [];
  if (options.detectFaces || options.detectAvatars) {
    onProgress?.({ status: "顔写真・実写アイコンを確認中...", progress: 0.87 });
    try {
      const cacheImage = typeof HTMLImageElement !== "undefined" && imageElement instanceof HTMLImageElement ? imageElement : null;
      const cached = cacheImage ? avatarCache.get(cacheImage) : undefined;
      if (cached && cached.src === cacheImage?.src && cached.width === imageElement.width &&
          cached.height === imageElement.height && cached.ocr === ocrResult && cached.known === preloadedAvatars) {
        facesAndAvatars = cached.items;
      } else {
        facesAndAvatars = await detectFacesAndAvatars(imageElement, preloadedAvatars, {
          textRegions: ocrResult.lines.map(({ bbox }) => ({
            x: bbox.x0, y: bbox.y0, width: bbox.x1 - bbox.x0, height: bbox.y1 - bbox.y0
          }))
        });
        if (cacheImage) avatarCache.set(cacheImage, {
          src: cacheImage.src, width: imageElement.width, height: imageElement.height,
          ocr: ocrResult, known: preloadedAvatars, items: facesAndAvatars
        });
      }
      for (const item of facesAndAvatars) {
        if (item.type === "face" && !options.detectFaces) continue;
        if (item.type === "avatar" && !options.detectAvatars) continue;
        boxes.push({
          id: item.id, type: item.type, label: item.label,
          reason: item.type === "face" ? "顔写真の保護" : "実写アバターの保護",
          rect: applyPadding(item.rect, options.padding, imageElement.width, imageElement.height, false),
          enabled: true, confidence: item.confidence
        });
      }
    } catch (err) {
      console.warn("Face/Avatar detection error:", err);
    }
  }

  const isScreenPhoto = ocrResult.analysis?.isLikelyScreenPhoto === true;
  const smallText =
    (ocrResult.analysis?.estimatedLineHeight || 99) > 0 &&
    (ocrResult.analysis?.estimatedLineHeight || 99) < 18;

  // 3. 辞書・形式・配置ルールの確定結果を先に作り、ON時の文脈AIで追加候補を補う。
  onProgress?.({ status: "個人情報をルール解析中...", progress: 0.89 });
  const keywords = options.customKeywords.map((keyword) => ({
    raw: keyword.trim(),
    normalized: normalizeOcrText(keyword.trim()).text.replace(/[ー−–—‐]/g, "-").toLowerCase()
  })).filter((keyword) => keyword.normalized);

  // 4. OCRテキストに対するルールベース解析（相補的ハイブリッド）
  for (const line of ocrResult.lines) {
    const lineText = line.text;
    if (!lineText || lineText.trim().length === 0) continue;

    // A. チャット送信者ヘッダー判定（短くて行頭にあり、人名らしい）
    if (options.detectPersons && isLikelyChatSender(lineText, true) && hasChatSenderContext(line, ocrResult.lines, facesAndAvatars)) {
      const senderEnd = lineText.replace(/\s*(?:\d{1,2}:\d{2}|既読|未読|送信済み)\s*$/g, "").trimEnd().length;
      const rect = calculateBBoxForRange(line, 0, senderEnd);
      if (rect) {
        boxes.push({
          id: `person-header-${line.bbox.x0}-${line.bbox.y0}`,
          type: "person",
          label: "送信者名",
          text: lineText.slice(0, senderEnd).trim(),
          reason: "チャット送信者名の推定",
          rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText),
          enabled: true,
          confidence: line.confidence / 100
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
            id: `person-${line.bbox.x0}-${line.bbox.y0}-${p.startIndex}`,
            type: "person",
            label: "人名",
            text: p.matchedText,
            reason: getPersonReasonText(p.reason),
            rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText),
            enabled: true,
            confidence: line.confidence / 100
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
            id: `corp-${line.bbox.x0}-${line.bbox.y0}-${c.startIndex}`,
            type: "company",
            label: "会社名・組織",
            text: c.matchedText,
            reason: "法人格または企業名パターン",
            rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText),
            enabled: true,
            confidence: line.confidence / 100
          });
        }
      }
    }

    // D. PII（電話、メール、住所、金額、SNS ID、パスワード、クレジットカード）判定
    if (options.detectPii || options.detectPersons) {
      const piiMatches = detectPiiInText(lineText);
      for (const p of piiMatches) {
        if (p.category === "person" && !options.detectPersons) continue;
        if (p.category !== "person" && !options.detectPii) continue;
        const rect = calculateBBoxForRange(line, p.startIndex, p.endIndex);
        if (rect) {
          const boxType = p.category === "person" ? "person" : "pii";
          boxes.push({
            id: `pii-${p.category}-${line.bbox.x0}-${line.bbox.y0}-${p.startIndex}`,
            type: boxType,
            label: p.label,
            text: p.matchedText,
            reason: `特定個人情報 (${p.label})`,
            rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText),
            enabled: true,
            confidence: line.confidence / 100
          });
        }
      }
    }

    // E. ユーザー指定のカスタムキーワード判定
    if (options.customKeywords && options.customKeywords.length > 0) {
      const normalizedLine = normalizeOcrText(lineText);
      const lineSearchText = normalizedLine.text
        .replace(/[ー−–—‐]/g, "-")
        .toLowerCase();
      for (const { raw: kw, normalized: normalizedKeyword } of keywords) {
        let normalizedStart = 0;
        while ((normalizedStart = lineSearchText.indexOf(normalizedKeyword, normalizedStart)) !== -1) {
          const normalizedEnd = normalizedStart + normalizedKeyword.length;
          const originalRange = mapNormRangeToOriginal(
            normalizedLine.indexMap,
            normalizedStart,
            normalizedEnd
          );
          const startIndex = originalRange.start;
          const endIndex = originalRange.end;
          const rect = calculateBBoxForRange(line, startIndex, endIndex);
          if (rect) {
            boxes.push({
              id: `custom-${line.bbox.x0}-${line.bbox.y0}-${startIndex}-${kw}`,
              type: "custom",
              label: "カスタム単語",
              text: kw,
              reason: `指定キーワード: "${kw}"`,
              rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText),
              enabled: true,
              confidence: line.confidence / 100
            });
          }
          normalizedStart = normalizedEnd;
        }
      }
    }
  }

  // 4.5 帳票で項目ラベルと値が別のOCR行・列に分かれた場合を座標関係から補完する。
  if (options.detectPii || options.detectPersons) {
    for (const p of detectLayoutPii(ocrResult.lines)) {
      if (p.category === "person" && !options.detectPersons) continue;
      if (p.category !== "person" && !options.detectPii) continue;
      const rect = calculateBBoxForRange(p.line, p.startIndex, p.endIndex);
      if (!rect) continue;
      boxes.push({
        id: `layout-${p.category}-${p.line.bbox.x0}-${p.line.bbox.y0}-${p.startIndex}`,
        type: p.category === "person" ? "person" : "pii",
        label: p.label,
        text: p.matchedText,
        reason: `項目ラベルと値の配置 (${p.label})`,
        rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText),
        enabled: true,
        confidence: Math.max(0, Math.min(0.98, p.line.confidence / 100))
      });
    }
  }

  // 5. ルールで同定済みの名称を文書内の全出現箇所へ伝播する。
  // 正規化した同一名称のみを保護し、似た単語や地名への誤伝播を避ける。
  const detectedPersonNames = new Set<string>();
  const detectedCompanyNames = new Set<string>();

  for (const b of boxes) {
    if (!b.text || b.text.length < 2) continue;
    if (b.type === "person") {
      // 敬称・役職を除いた名前部分（例: 「鈴木部長」-> 「鈴木」）
      const nameOnly = b.text.replace(/(?:様|さま|さん|サン|君|くん|ちゃん|氏|殿|部長|課長|社長|係長|主任|先生)$/, "").trim();
      if (nameOnly.length >= 2 && !/^[0-9]+$/.test(nameOnly)) {
        detectedPersonNames.add(nameOnly);
      }
      detectedPersonNames.add(b.text.trim());
    } else if (b.type === "company") {
      detectedCompanyNames.add(b.text.trim());
    }
  }

  const searchLines = detectedPersonNames.size || detectedCompanyNames.size
    ? ocrResult.lines.map((line) => ({ line, prepared: prepareSearchText(line.text) })) : [];
  if (options.detectPersons && detectedPersonNames.size > 0) {
    for (const name of detectedPersonNames) {
      const entity = prepareSearchText(name).text;
      for (const { line, prepared } of searchLines) {
        const matches = findExactEntityRanges(line.text, prepared, entity, "person");
        for (const m of matches) {
          const rect = calculateBBoxForRange(line, m.startIndex, m.endIndex);
          if (rect) {
            boxes.push({
              id: `person-prop-${line.bbox.x0}-${line.bbox.y0}-${m.startIndex}`,
              type: "person",
              label: "人名 (文書内一致)",
              text: m.matchedText,
              reason: `同定済み人物名の全域保護 (${name})`,
              rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText),
              enabled: true,
              confidence: line.confidence / 100
            });
          }
        }
      }
    }
  }

  if (options.detectCompanies && detectedCompanyNames.size > 0) {
    for (const corp of detectedCompanyNames) {
      const entity = prepareSearchText(corp).text;
      for (const { line, prepared } of searchLines) {
        const matches = findExactEntityRanges(line.text, prepared, entity, "company");
        for (const m of matches) {
          const rect = calculateBBoxForRange(line, m.startIndex, m.endIndex);
          if (rect) {
            boxes.push({
              id: `corp-prop-${line.bbox.x0}-${line.bbox.y0}-${m.startIndex}`,
              type: "company",
              label: "会社名 (文書内一致)",
              text: m.matchedText,
              reason: `同定済み組織名の全域保護 (${corp})`,
              rect: applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText),
              enabled: true,
              confidence: line.confidence / 100
            });
          }
        }
      }
    }
  }

  // AIの名称は文書全体へ伝播させず、指定されたOCR行の原文一致位置だけに追加する。
  const llmResult = await analyzeOcrWithLlm(ocrResult,
    options.detectPersons || options.detectCompanies || options.detectPii,
    (status) => onProgress?.({ status, progress: 0.92 }));
  const llmAnalysis = llmResult.analysis;
  for (const entity of llmResult.entities) {
    if (entity.type === "person" && !options.detectPersons) continue;
    if (entity.type === "company" && !options.detectCompanies) continue;
    if ((entity.type === "pii" || entity.type === "confidential") && !options.detectPii) continue;
    const line = ocrResult.lines[entity.lineIndex];
    if (!line) continue;
    let start = line.text.indexOf(entity.text);
    while (start !== -1) {
      const end = start + entity.text.length;
      const rect = calculateBBoxForRange(line, start, end);
      if (rect) {
        const padded = applyPadding(rect, options.padding, imageElement.width, imageElement.height, isScreenPhoto || smallText);
        const alreadyCovered = boxes.some((box) => {
          if (box.type === "face" || box.type === "avatar" || !box.enabled) return false;
          const overlapWidth = Math.min(box.rect.x + box.rect.width, padded.x + padded.width) - Math.max(box.rect.x, padded.x);
          const overlapHeight = Math.min(box.rect.y + box.rect.height, padded.y + padded.height) - Math.max(box.rect.y, padded.y);
          return overlapWidth > 0 && overlapHeight > 0 && overlapWidth * overlapHeight / Math.max(1, padded.width * padded.height) >= 0.85;
        });
        if (!alreadyCovered) {
          const label = entity.type === "person" ? "人名 (AI)" : entity.type === "company" ? "会社名 (AI)" : entity.type === "confidential" ? "機密情報 (AI)" : "個人情報 (AI)";
          boxes.push({
            id: `llm-${entity.type}-${entity.lineIndex}-${start}`,
            type: entity.type === "confidential" ? "pii" : entity.type,
            label,
            text: entity.text,
            reason: `文脈AIの追加判定 (${label})`,
            rect: padded,
            enabled: true,
            confidence: Math.max(0, Math.min(0.9, line.confidence / 100))
          });
          llmAnalysis.addedBoxes++;
        }
      }
      start = line.text.indexOf(entity.text, end);
    }
  }
  if (llmAnalysis.status === "no_additions" && llmAnalysis.addedBoxes > 0) llmAnalysis.status = "applied";

  // 傾き角度の反映（斜め文字行の追従マスキング用）
  // すでに画素側で正対化している場合は回転を掛けない（箱が文字からズレる）
  if (rotationAngle !== 0 && Math.abs(rotationAngle) >= 0.8) {
    for (const b of boxes) {
      if (b.rotation === undefined) {
        b.rotation = rotationAngle;
      }
    }
  }

  // 再利用した実OCRも初回と同じ位置補正を行う。サンプル座標だけを除外。
  const isSampleOrPreloaded = !!preloadedAvatars?.length;

  if (!isSampleOrPreloaded) {
    onProgress?.({ status: "黒塗り位置を文字に合わせて調整中...", progress: 0.94 });
    try {
      snapBoxesToInk(imageElement, boxes, options.padding, isScreenPhoto || smallText);
    } catch (err) {
      console.warn("Ink snap failed:", err);
    }
  }

  // 重複矩形の整理（同じ領域に対する完全重複・包含を排除）
  const dedupedBoxes = removeDuplicateBoxes(boxes);
  // 同一行で隣接する同種ボックスを常に結合（サンプル画像でも住所や人名の二重ボックスを確実に防止）
  const finalBoxes = mergeAdjacentBoxes(dedupedBoxes);

  onProgress?.({ status: "解析完了", progress: 1.0 });

  return {
    boxes: finalBoxes,
    ocrResult,
    llmAnalysis
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

export function calculateBBoxForRange(
  line: OcrLine,
  startIndex: number,
  endIndex: number
): { x: number; y: number; width: number; height: number } | null {
  const textLen = line.text.length;
  if (startIndex < 0 || endIndex > textLen || startIndex >= endIndex) return null;

  // 1. text と1:1で揃っているシンボルは文字インデックスを直接使う。
  // 同じ文字列が同一行に複数存在しても、先頭側へ誤配置しない。
  if (line.alignedSymbols && line.alignedSymbols.length === textLen) {
    const direct = bboxFromSymbols(line.alignedSymbols, startIndex, endIndex);
    if (direct) return direct;
  }

  // 2. ターゲットテキストの直接シンボル照合
  const targetText = line.text.slice(startIndex, endIndex).replace(/[\s\t\u3000]/g, "");
  const symbolsToSearch = (line.alignedSymbols && line.alignedSymbols.length > 0) ? line.alignedSymbols : line.symbols;

  let resultBox: { x: number; y: number; width: number; height: number } | null = null;

  if (targetText && symbolsToSearch && symbolsToSearch.length > 0) {
    // symbolsToSearch 内の各文字について、空白を除いた文字インデックスマップを作成
    const symIndexMap: number[] = [];
    let fullSymStr = "";
    for (let i = 0; i < symbolsToSearch.length; i++) {
      const cleanChar = (symbolsToSearch[i].text || "").replace(/[\s\t\u3000]/g, "");
      for (let c = 0; c < cleanChar.length; c++) {
        symIndexMap.push(i);
        fullSymStr += cleanChar[c];
      }
    }

    const expectedCleanStart = line.text
      .slice(0, startIndex)
      .replace(/[\s\t\u3000]/g, "").length;
    const occurrences: number[] = [];
    let occurrence = fullSymStr.indexOf(targetText);
    while (occurrence !== -1) {
      occurrences.push(occurrence);
      occurrence = fullSymStr.indexOf(targetText, occurrence + 1);
    }
    const matchIdx = occurrences.length > 0
      ? occurrences.reduce((best, current) =>
          Math.abs(current - expectedCleanStart) < Math.abs(best - expectedCleanStart) ? current : best)
      : -1;

    if (matchIdx !== -1 && matchIdx + targetText.length <= symIndexMap.length) {
      const symStartIdx = symIndexMap[matchIdx];
      const symEndIdx = symIndexMap[matchIdx + targetText.length - 1]; // 末尾文字の正確なインデックス (inclusive)
      const matchedSlice = symbolsToSearch.slice(symStartIdx, symEndIdx + 1);
      resultBox = bboxFromSymbols(matchedSlice, 0, matchedSlice.length);
    }
  }

  // 不整合なシンボル列へ原文インデックスを適用しない。
  // 単語テキストを原文へ対応させ、単語内の該当部分だけを推定する。
  if (!resultBox && line.words && line.words.length > 0) {
    const parts: { bbox: OcrLine["bbox"] }[] = [];
    let cursor = 0;
    let covered = 0;
    for (const word of line.words) {
      if (!word.text) continue;
      const at = line.text.indexOf(word.text, cursor);
      if (at === -1) continue;
      cursor = at + word.text.length;
      const from = Math.max(startIndex, at);
      const to = Math.min(endIndex, cursor);
      if (from >= to) continue;
      covered += to - from;
      const width = word.bbox.x1 - word.bbox.x0;
      parts.push({ bbox: {
        x0: word.bbox.x0 + width * (from - at) / word.text.length,
        x1: word.bbox.x0 + width * (to - at) / word.text.length,
        y0: word.bbox.y0, y1: word.bbox.y1
      }});
    }
    if (covered === endIndex - startIndex && parts.length) resultBox = bboxFromSymbols(parts, 0, parts.length);
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

  return resultBox;
}

/**
 * 安全マージン（パディング）を適用し、画像境界内にクランプ
 */
export function applyPadding(
  rect: { x: number; y: number; width: number; height: number },
  padding: number,
  maxWidth: number,
  maxHeight: number,
  expandForPhoto: boolean = false
): { x: number; y: number; width: number; height: number } {
  const scalePadX = Math.ceil(rect.height * (expandForPhoto ? 0.1 : 0.07));
  const scalePadY = Math.ceil(rect.height * (expandForPhoto ? 0.07 : 0.04));
  // 高解像度画像でもアンチエイリアス端が残らないよう、px指定と文字高比例の大きい方を採用。
  const padY = Math.max(Math.round(padding * 0.4), Math.min(6, scalePadY));
  const padX = Math.max(2, padding + 1, Math.min(10, scalePadX));

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

export function removeDuplicateBoxes(boxes: RedactBox[]): RedactBox[] {
  // 優先度の高い順（PII > 会社名 > 人名 > アイコン）にソート
  const sorted = [...boxes].sort((a, b) => getBoxPriority(b.type) - getBoxPriority(a.type));
  const result: RedactBox[] = [];

  for (const b of sorted) {
    let merged = false;
    for (let i = 0; i < result.length; i++) {
      const r = result[i];
      if (!!r.isManual !== !!b.isManual || r.enabled !== b.enabled || (r.rotation ?? 0) !== (b.rotation ?? 0)) continue;
      const rPhoto = r.type === "avatar" || r.type === "face";
      const bPhoto = b.type === "avatar" || b.type === "face";
      if (rPhoto !== bPhoto) continue;
      const xLeft = Math.max(r.rect.x, b.rect.x);
      const yTop = Math.max(r.rect.y, b.rect.y);
      const xRight = Math.min(r.rect.x + r.rect.width, b.rect.x + b.rect.width);
      const yBottom = Math.min(r.rect.y + r.rect.height, b.rect.y + b.rect.height);

      if (xRight > xLeft && yBottom > yTop) {
        const overlapArea = (xRight - xLeft) * (yBottom - yTop);
        const smallerArea = Math.min(boxArea(r.rect), boxArea(b.rect));
        const overlapRatio = smallerArea > 0 ? overlapArea / smallerArea : 0;

        const heightRatio = Math.min(r.rect.height, b.rect.height) / Math.max(r.rect.height, b.rect.height, 1);
        const sameRow = (yBottom - yTop) / Math.max(1, Math.min(r.rect.height, b.rect.height)) >= 0.85 && heightRatio >= 0.75;
        // 部分的に交差する別行・写真と文字を外接矩形で埋めない。
        if (overlapRatio >= 0.85 && (rPhoto || sameRow)) {
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
        if (overlapY / minH < 0.85) continue;
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
