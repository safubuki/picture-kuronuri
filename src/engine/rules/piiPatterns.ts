/**
 * 個人特定可能情報 (PII) 精密正規表現ルール
 * ラベル（TEL:, Email:, 住所: 等）を巻き込まず、値そのものだけを正確に検出する
 */

export interface PiiMatch {
  matchedText: string;
  startIndex: number;
  endIndex: number;
  category: "phone" | "email" | "postal" | "address" | "money" | "sns_id" | "id_number";
  label: string;
}

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
];

const PREF_PATTERN = PREFECTURES.join("|");

export function detectPiiInText(text: string): PiiMatch[] {
  if (!text) return [];
  const results: PiiMatch[] = [];

  // 1. 電話番号・携帯番号
  // 撮影OCRで入りがちな O/0 混同、中点・空白・各種ダッシュも許容
  const phoneRegex =
    /(?:0|O|o|〇)[\dOo]{1,4}[-ー−–‐・･.\s]{1,3}[\dOo]{1,4}[-ー−–‐・･.\s]{1,3}[\dOo]{3,5}|(?:0[789]0\d{8}|0\d{9,10})\b/g;
  let match: RegExpExecArray | null;
  while ((match = phoneRegex.exec(text)) !== null) {
    const raw = match[0].trim();
    const digits = raw.replace(/[OoｏＯ〇○]/g, "0").replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 11) continue;
    results.push({
      matchedText: raw,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      category: "phone",
      label: "電話番号"
    });
  }

  // 2. メールアドレス（@ 前後の空白・全角化済みの半角を許容）
  const emailRegex = /\b[a-zA-Z0-9_.+-]+\s*@\s*[a-zA-Z0-9-]+\s*\.\s*[a-zA-Z0-9-.]+\b/g;
  while ((match = emailRegex.exec(text)) !== null) {
    results.push({
      matchedText: match[0].replace(/\s+/g, ""),
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      category: "email",
      label: "メールアドレス"
    });
  }

  // 3. 郵便番号 (〒マークまたは郵便番号表記のみ。電話番号と重ならないもの)
  const postalRegex = /(?:〒\s*)\d{3}[-ー−–‐]\d{4}\b/g;
  while ((match = postalRegex.exec(text)) !== null) {
    const isCovered = results.some(r => match!.index >= r.startIndex && match!.index < r.endIndex);
    if (!isCovered) {
      results.push({
        matchedText: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        category: "postal",
        label: "郵便番号"
      });
    }
  }

  // 4. 住所パターン (都道府県から始まり、丁目番地号で終わる部分のみ)
  // 例: "住所: 東京都千代田区丸の内1-2-3" -> "東京都千代田区丸の内1-2-3" のみ
  const addressRegex = new RegExp(`(?:${PREF_PATTERN})[^\\s\\n\\r0-9０-９]{1,12}[0-9０-９ー丁目番地号-]+`, "gu");
  while ((match = addressRegex.exec(text)) !== null) {
    results.push({
      matchedText: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      category: "address",
      label: "住所"
    });
  }

  // 5. 金額 (例: 1,500円, ￥50,000)
  const moneyRegex = /(?:[￥¥]\s*[\d,]+|[\d,]+\s*円)/g;
  while ((match = moneyRegex.exec(text)) !== null) {
    // 住所や電話番号の数値と被らないか確認
    const isCovered = results.some(r => match!.index >= r.startIndex && match!.index < r.endIndex);
    if (!isCovered) {
      results.push({
        matchedText: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        category: "money",
        label: "金額"
      });
    }
  }

  // 6. SNS ID (例: @john_doe, ただしメールアドレスの中の@は除外)
  const snsRegex = /(?:^|\s)(@[a-zA-Z0-9_]{3,25})\b/g;
  while ((match = snsRegex.exec(text)) !== null) {
    const actualId = match[1];
    const actualStart = match.index + match[0].indexOf(actualId);
    const isCovered = results.some(r => actualStart >= r.startIndex && actualStart < r.endIndex);
    if (!isCovered) {
      results.push({
        matchedText: actualId,
        startIndex: actualStart,
        endIndex: actualStart + actualId.length,
        category: "sns_id",
        label: "SNS・アカウントID"
      });
    }
  }

  return results;
}
