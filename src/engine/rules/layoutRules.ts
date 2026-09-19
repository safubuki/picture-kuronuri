import type { OcrLine } from "../ocr";
import type { PiiMatch } from "./piiPatterns";

export interface LayoutPiiMatch extends PiiMatch {
  line: OcrLine;
}

interface LabelRule {
  re: RegExp;
  category: PiiMatch["category"];
  label: string;
}

const LABEL_RULES: LabelRule[] = [
  { re: /^(?:氏名|お?名前|Name|担当者|契約者|申請者|代表者)\s*[:：]?$/iu, category: "person", label: "人名" },
  { re: /^(?:TEL|電話(?:番号)?|携帯(?:番号)?)\s*[:：]?$/iu, category: "phone", label: "電話番号" },
  { re: /^(?:Email|E-?mail|メール(?:アドレス)?)\s*[:：]?$/iu, category: "email", label: "メールアドレス" },
  { re: /^(?:〒|郵便番号)\s*[:：]?$/u, category: "postal", label: "郵便番号" },
  { re: /^(?:住所|Address)\s*[:：]?$/iu, category: "address", label: "住所" },
  { re: /^(?:生年月日|誕生日|DOB)\s*[:：]?$/iu, category: "birth_date", label: "生年月日" },
  { re: /^(?:口座番号|口座No\.?)\s*[:：]?$/iu, category: "bank_account", label: "口座番号" },
  { re: /^(?:支店番号|店番号)\s*[:：]?$/u, category: "bank_account", label: "支店番号" },
  { re: /^(?:マイナンバー|個人番号)\s*[:：]?$/u, category: "id_number", label: "個人番号" },
  { re: /^(?:運転免許証?(?:番号)?|免許証番号|旅券番号|パスポート番号|保険者番号|被保険者番号)\s*[:：]?$/u, category: "id_number", label: "公的識別番号" },
  { re: /^(?:社員番号|従業員番号|顧客番号|会員番号|会員ID|ユーザーID|ログインID)\s*[:：]?$/iu, category: "id_number", label: "識別番号" },
  { re: /^(?:パスワード|Password|PW)\s*[:：]?$/iu, category: "password", label: "パスワード" },
  { re: /^(?:カード番号|クレジットカード)\s*[:：]?$/u, category: "credit_card", label: "カード情報" }
];

function yOverlapRatio(a: OcrLine, b: OcrLine): number {
  const overlap = Math.min(a.bbox.y1, b.bbox.y1) - Math.max(a.bbox.y0, b.bbox.y0);
  const minH = Math.min(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0) || 1;
  return Math.max(0, overlap) / minH;
}

function isAnotherLabel(text: string): boolean {
  const compact = text.trim();
  return LABEL_RULES.some((rule) => rule.re.test(compact));
}

function isPlausibleValue(text: string, category: PiiMatch["category"]): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 100 || isAnotherLabel(t)) return false;
  const digits = t.replace(/[Oo〇○]/g, "0").replace(/\D/g, "");
  switch (category) {
    case "phone": return digits.length >= 9 && digits.length <= 11;
    case "email": return /@|＠/.test(t);
    case "postal": return digits.length === 7;
    case "birth_date": return /\d{1,4}\s*[年/.\-]\s*\d{1,2}/.test(t);
    case "bank_account": return digits.length >= 3 && digits.length <= 12;
    case "person": return t.length <= 40 && !/[：:]/.test(t);
    default: return !/^[：:]$/.test(t);
  }
}

/**
 * OCRが帳票のラベルと値を別々の行として返した場合に、座標関係から値を結び付ける。
 * 完全なラベル行だけを起点にするため、本文中の語から広く推測しない。
 */
export function detectLayoutPii(lines: OcrLine[]): LayoutPiiMatch[] {
  const results: LayoutPiiMatch[] = [];
  const sorted = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);

  for (const labelLine of sorted) {
    const labelText = labelLine.text.trim();
    const rule = LABEL_RULES.find((candidate) => candidate.re.test(labelText));
    if (!rule) continue;

    const lineH = Math.max(8, labelLine.bbox.y1 - labelLine.bbox.y0);
    const candidates = sorted
      .filter((candidate) => candidate !== labelLine)
      .map((candidate) => {
        const sameRow = yOverlapRatio(labelLine, candidate) >= 0.55 &&
          candidate.bbox.x0 >= labelLine.bbox.x1 - lineH * 0.25;
        const verticalGap = candidate.bbox.y0 - labelLine.bbox.y1;
        const below = verticalGap >= -lineH * 0.15 && verticalGap <= lineH * 2.2 &&
          Math.abs(candidate.bbox.x0 - labelLine.bbox.x0) <= Math.max(64, labelLine.bbox.x1 - labelLine.bbox.x0);
        if (!sameRow && !below) return null;
        if (!isPlausibleValue(candidate.text, rule.category)) return null;
        const distance = sameRow
          ? Math.max(0, candidate.bbox.x0 - labelLine.bbox.x1)
          : Math.max(0, verticalGap) + Math.abs(candidate.bbox.x0 - labelLine.bbox.x0) * 0.25;
        return { candidate, distance, sameRow };
      })
      .filter((item): item is { candidate: OcrLine; distance: number; sameRow: boolean } => item !== null)
      // 同じ行の別列を最優先する。距離だけで並べると、右に離れた正しい値より
      // 次の行の別項目を誤って選ぶことがある。
      .sort((a, b) => Number(b.sameRow) - Number(a.sameRow) || a.distance - b.distance);

    const best = candidates[0]?.candidate;
    if (!best) continue;
    const value = best.text.trim();
    const startIndex = best.text.indexOf(value);
    results.push({
      line: best,
      matchedText: value,
      startIndex,
      endIndex: startIndex + value.length,
      category: rule.category,
      label: rule.label
    });

    // 住所だけは、同じ左端で直後に続く折り返し行も保護する。
    if (rule.category === "address") {
      let previous = best;
      let continuationCount = 0;
      for (const continuation of sorted) {
        if (continuation === labelLine || continuation === best) continue;
        const gap = continuation.bbox.y0 - previous.bbox.y1;
        const aligned = Math.abs(continuation.bbox.x0 - best.bbox.x0) <= lineH * 1.5;
        if (gap < -lineH * 0.1 || gap > lineH * 1.25 || !aligned) continue;
        if (continuation.text.trim().length < 2 || isAnotherLabel(continuation.text)) continue;
        const continuedValue = continuation.text.trim();
        const continuedStart = continuation.text.indexOf(continuedValue);
        results.push({
          line: continuation,
          matchedText: continuedValue,
          startIndex: continuedStart,
          endIndex: continuedStart + continuedValue.length,
          category: "address",
          label: "住所"
        });
        previous = continuation;
        continuationCount++;
        if (continuationCount >= 2) break;
      }
    }
  }

  return results;
}
