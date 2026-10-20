import { normalizeOcrText } from "./ocrNormalize";

export interface SearchText {
  text: string;
  starts: number[];
  ends: number[];
}

/** 文書内の一致検索用。原文の UTF-16 座標を保持して一度だけ正規化する。 */
export function prepareSearchText(raw: string): SearchText {
  const normalized = normalizeOcrText(raw);
  const starts: number[] = [];
  const ends: number[] = [];
  let text = "";
  for (let i = 0; i < normalized.text.length;) {
    const ch = String.fromCodePoint(normalized.text.codePointAt(i)!);
    const length = ch.length;
    if (!/\s/u.test(ch)) {
      const folded = ch.replace(/[ー−–—‐]/g, "-").toLowerCase();
      const start = normalized.indexMap[i] ?? i;
      const end = (normalized.indexMap[i + length - 1] ?? start) + 1;
      text += folded;
      for (let j = 0; j < folded.length; j++) {
        starts.push(start);
        ends.push(end);
      }
    }
    i += length;
  }
  return { text, starts, ends };
}

/** 1文字違いを文書全体へ伝播しない。人名の部分一致も避ける。 */
export function findExactEntityRanges(
  raw: string,
  prepared: SearchText,
  entity: string,
  type: "person" | "company"
): { startIndex: number; endIndex: number; matchedText: string }[] {
  const results: { startIndex: number; endIndex: number; matchedText: string }[] = [];
  if (!entity) return results;
  let from = 0;
  let at: number;
  while ((at = prepared.text.indexOf(entity, from)) !== -1) {
    const startIndex = prepared.starts[at];
    const endIndex = prepared.ends[at + entity.length - 1];
    const before = raw.slice(0, startIndex).match(/.$/u)?.[0] ?? "";
    const after = raw.slice(endIndex).match(/^./u)?.[0] ?? "";
    const personBoundary = /[\p{Script=Han}\p{Script=Katakana}A-Za-z0-9_]/u;
    const latinBoundary = /[A-Za-z0-9_]/;
    const blocked = type === "person"
      ? personBoundary.test(before) || personBoundary.test(after)
      : (/^[a-z0-9]/i.test(entity) && latinBoundary.test(before)) ||
        (/[a-z0-9]$/i.test(entity) && latinBoundary.test(after));
    if (!blocked) results.push({ startIndex, endIndex, matchedText: raw.slice(startIndex, endIndex) });
    from = at + entity.length;
  }
  return results;
}
