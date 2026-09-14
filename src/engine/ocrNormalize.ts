/**
 * OCR結果の正規化（AI不使用）
 * 撮影ノイズで入りがちな CJK 間スペース・全角英数・字形の取り違えを吸収する。
 */

const CJK_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** 見た目が近いため低解像度・モアレ下で取り違えやすい文字 → 代表形 */
const VISUAL_FOLD: Record<string, string> = {
  口: "ロ",
  力: "カ",
  二: "ニ",
  工: "エ",
  八: "ハ",
  夕: "タ",
  干: "チ",
  才: "オ",
  卜: "ト",
  ヘ: "へ",
  べ: "ベ",
  ぺ: "ペ",
  り: "リ",
  ー: "一",
  "−": "一",
  "–": "一",
  "—": "一",
  "‐": "一",
  杜: "社",
  殊: "株"
};

const DIGIT_FOLD: Record<string, string> = {
  O: "0",
  o: "0",
  Ｏ: "0",
  ｏ: "0",
  "〇": "0",
  "○": "0",
  I: "1",
  l: "1",
  "|": "1",
  Ｉ: "1",
  ｌ: "1",
  S: "5",
  ｓ: "5"
};

export function isCjkChar(ch: string): boolean {
  if (!ch) return false;
  return CJK_REGEX.test(ch[0]);
}

export function isSpaceChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "　" || ch === "\u00a0";
}

/**
 * 全角英数・記号を半角へ（1文字↔1文字。U+FF01〜FF5E）
 */
export function toHalfwidthChar(ch: string): string {
  if (!ch) return ch;
  const code = ch.codePointAt(0);
  if (code === undefined) return ch;
  if (code === 0x3000) return " ";
  if (code >= 0xff01 && code <= 0xff5e) {
    return String.fromCodePoint(code - 0xfee0);
  }
  return ch;
}

export function foldVisualJa(text: string): string {
  let out = "";
  for (const ch of text) {
    out += VISUAL_FOLD[ch] ?? ch;
  }
  return out;
}

export function foldDigits(text: string): string {
  let out = "";
  for (const ch of text) {
    out += DIGIT_FOLD[ch] ?? ch;
  }
  return out;
}

export interface NormalizedOcrText {
  /** マッチング用（CJK間スペース除去・半角化済み） */
  text: string;
  /** text[i] が元文字列の何文字目か */
  indexMap: number[];
}

/**
 * OCR生テキストを黒塗りマッチング用に正規化する。
 * 長さが変わる操作は indexMap で元位置へ戻せる。
 */
export function normalizeOcrText(raw: string): NormalizedOcrText {
  if (!raw) return { text: "", indexMap: [] };

  const chars = [...raw];
  const half = chars.map(toHalfwidthChar);
  let text = "";
  const indexMap: number[] = [];

  for (let i = 0; i < half.length; i++) {
    const ch = half[i];
    if (!ch) continue;

    if (isSpaceChar(ch)) {
      const prev = text.length > 0 ? text[text.length - 1] : "";
      let next = "";
      for (let j = i + 1; j < half.length; j++) {
        if (!isSpaceChar(half[j])) {
          next = half[j];
          break;
        }
      }
      if (isCjkChar(prev) && isCjkChar(next)) continue;
      if (prev === " " || prev === "") continue;
      text += " ";
      indexMap.push(i);
      continue;
    }

    text += ch;
    indexMap.push(i);
  }

  return { text, indexMap };
}

export function mapNormRangeToOriginal(
  indexMap: number[],
  startIndex: number,
  endIndex: number
): { start: number; end: number } {
  if (indexMap.length === 0) {
    return { start: startIndex, end: endIndex };
  }
  const s = Math.max(0, Math.min(startIndex, indexMap.length - 1));
  const e = Math.max(s, Math.min(endIndex - 1, indexMap.length - 1));
  return {
    start: indexMap[s],
    end: indexMap[e] + 1
  };
}
