import { detectFacesAndAvatars, type DetectedFaceOrAvatar } from "./faceAvatarDetector";
import { runOcr, type OcrResult, type OcrLine, type OcrProgress } from "./ocr";
import { detectCompaniesInText } from "./rules/companyRules";
import { detectPersonsInText, isLikelyChatSender } from "./rules/honorifics";
import { detectPiiInText } from "./rules/piiPatterns";
import { detectLayoutPii } from "./rules/layoutRules";
import { mapNormRangeToOriginal, normalizeOcrText } from "./ocrNormalize";
import { snapBoxesToInk } from "./inkSnap";

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

  const isScreenPhoto = ocrResult.analysis?.isLikelyScreenPhoto === true;
  const smallText =
    (ocrResult.analysis?.estimatedLineHeight || 99) > 0 &&
    (ocrResult.analysis?.estimatedLineHeight || 99) < 18;

  // 3. 個人情報の判定は、決定論的な辞書・形式・配置ルールだけで行う。
  onProgress?.({ status: "個人情報をルール解析中...", progress: 0.89 });

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
            id: `corp-${line.bbox.x0}-${c.startIndex}`,
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
    if (options.detectPii) {
      const piiMatches = detectPiiInText(lineText);
      for (const p of piiMatches) {
        const rect = calculateBBoxForRange(line, p.startIndex, p.endIndex);
        if (rect) {
          const boxType = p.category === "person" ? "person" : "pii";
          boxes.push({
            id: `pii-${p.category}-${line.bbox.x0}-${p.startIndex}`,
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
        .toLocaleLowerCase();
      for (const keyword of options.customKeywords) {
        const kw = keyword.trim();
        if (!kw) continue;
        const normalizedKeyword = normalizeOcrText(kw).text
          .replace(/[ー−–—‐]/g, "-")
          .toLocaleLowerCase();
        if (!normalizedKeyword) continue;
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
              id: `custom-${line.bbox.x0}-${startIndex}-${kw}`,
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
  // 1箇所でも特定された人名・会社名は、ドキュメント内の全出現箇所で100%確実に保護
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

  if (options.detectPersons && detectedPersonNames.size > 0) {
    for (const name of detectedPersonNames) {
      for (const line of ocrResult.lines) {
        const matches = findEntityInLineWithFuzzy(line.text, name);
        for (const m of matches) {
          const rect = calculateBBoxForRange(line, m.startIndex, m.endIndex);
          if (rect) {
            boxes.push({
              id: `person-prop-${line.bbox.x0}-${m.startIndex}`,
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
      for (const line of ocrResult.lines) {
        const matches = findEntityInLineWithFuzzy(line.text, corp);
        for (const m of matches) {
          const rect = calculateBBoxForRange(line, m.startIndex, m.endIndex);
          if (rect) {
            boxes.push({
              id: `corp-prop-${line.bbox.x0}-${m.startIndex}`,
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
  if (!lineText || typeof lineText !== "string" || !entityText || typeof entityText !== "string") return results;

  const cleanEntity = normalizeOcrText(entityText).text
    .replace(/[\s\t\r\n\u3000]/g, "")
    .replace(/[ー−–—‐]/g, "-")
    .toLocaleLowerCase();
  if (cleanEntity.length === 0) return results;

  // 全角半角・大小文字・ハイフン表記を正規化しつつ、元文字位置へのマップを保持する。
  const normalizedLine = normalizeOcrText(lineText);
  const mapping: number[] = [];
  let cleanLine = "";
  for (let i = 0; i < normalizedLine.text.length; i++) {
    const ch = normalizedLine.text[i];
    if (!/[\s\t\r\n\u3000]/.test(ch)) {
      mapping.push(normalizedLine.indexMap[i] ?? i);
      cleanLine += ch.replace(/[ー−–—‐]/g, "-").toLocaleLowerCase();
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

  // 完全一致で見つからなかった場合、3文字以上なら1文字違い（OCR文字化け・誤認識）のファジー一致を探索
  if (results.length === 0 && cleanEntity.length >= 3 && cleanLine.length >= cleanEntity.length) {
    const targetLen = cleanEntity.length;
    for (let i = 0; i <= cleanLine.length - targetLen; i++) {
      const windowStr = cleanLine.slice(i, i + targetLen);
      let diff = 0;
      for (let j = 0; j < targetLen; j++) {
        if (windowStr[j] !== cleanEntity[j]) diff++;
        if (diff > 1) break;
      }
      if (diff === 1) {
        const startOriginal = mapping[i];
        const endClean = i + targetLen - 1;
        const endOriginal = mapping[endClean] + 1;
        results.push({
          startIndex: startOriginal,
          endIndex: endOriginal,
          matchedText: lineText.slice(startOriginal, endOriginal)
        });
        break; // 最適な1箇所
      }
    }
  }

  return results;
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
    let matchIdx = occurrences.length > 0
      ? occurrences.reduce((best, current) =>
          Math.abs(current - expectedCleanStart) < Math.abs(best - expectedCleanStart) ? current : best)
      : -1;

    // 完全一致しない場合、末尾側（例:「田様」）や先頭側で部分一致を試行
    if (matchIdx === -1 && targetText.length >= 2) {
      const sub = targetText.slice(1);
      const subIdx = fullSymStr.indexOf(sub);
      if (subIdx > 0) {
        matchIdx = subIdx - 1;
      }
    }

    if (matchIdx !== -1 && matchIdx + targetText.length <= symIndexMap.length) {
      const symStartIdx = symIndexMap[matchIdx];
      const symEndIdx = symIndexMap[matchIdx + targetText.length - 1]; // 末尾文字の正確なインデックス (inclusive)
      const matchedSlice = symbolsToSearch.slice(symStartIdx, symEndIdx + 1);
      resultBox = bboxFromSymbols(matchedSlice, 0, matchedSlice.length);
    }
  }

  // 3. シンボル照合ができなかった場合のフォールバック
  if (!resultBox) {
    if (line.alignedSymbols && line.alignedSymbols.length > 0) {
      resultBox = bboxFromSymbols(line.alignedSymbols, startIndex, endIndex);
    }
  }

  if (!resultBox && line.symbols && line.symbols.length > 0) {
    resultBox = bboxFromSymbols(line.symbols, startIndex, endIndex);
  }

  // 4. 単語列からの比率推定フォールバック
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

  // 5. 行頭・境界アンカーによるズレの幾何学的補正
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
