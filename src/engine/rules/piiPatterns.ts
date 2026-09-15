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

function pushUnique(results: PiiMatch[], item: PiiMatch): void {
  const covered = results.some(
    (r) => item.startIndex >= r.startIndex && item.endIndex <= r.endIndex
  );
  if (!covered) results.push(item);
}

/**
 * 「Email:」「住所:」などラベルの直後から行末までを値として取る。
 * OCRがアドレス自体を崩しても、値の位置だけは隠せる。
 */
function detectLabeledValues(text: string): PiiMatch[] {
  const results: PiiMatch[] = [];
  const rules: { re: RegExp; category: PiiMatch["category"]; label: string }[] = [
    // コロンの欠落・スペース混入・大文字小文字に対応
    { re: /(?:Email|E-?mail|メール(?:アドレス)?)\s*[:：\s]\s*([a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+)/iu, category: "email", label: "メールアドレス" },
    { re: /(?:TEL|Tel|電話(?:番号)?)\s*[:：\s]\s*([0-9０-９\-ー−–‐・･\s]{8,22})/iu, category: "phone", label: "電話番号" },
    { re: /(?:住所|Address)\s*[:：\s]?\s*([^、。\n\r]{4,45})/iu, category: "address", label: "住所" }
  ];
  for (const rule of rules) {
    const m = rule.re.exec(text);
    if (!m || !m[1]) continue;
    const value = m[1].trimEnd();
    if (value.length < 3) continue;
    const startIndex = text.indexOf(m[1], m.index);
    if (startIndex < 0) continue;
    results.push({
      matchedText: value,
      startIndex,
      endIndex: startIndex + value.length,
      category: rule.category,
      label: rule.label
    });
  }
  return results;
}

export function detectPiiInText(text: string): PiiMatch[] {
  if (!text) return [];
  const results: PiiMatch[] = detectLabeledValues(text);

  // 1. 電話番号・携帯番号
  // 撮影OCRで入りがちな O/0 混同、中点・空白・各種ダッシュも許容
  const phoneRegex =
    /(?:0|O|o|〇)[\dOo]{1,4}[-ー−–‐・･.\s]{1,3}[\dOo]{1,4}[-ー−–‐・･.\s]{1,3}[\dOo]{3,5}|(?:0[789]0[\s\-]?\d{4}[\s\-]?\d{4}|0\d{1,4}[\s\-]?\d{1,4}[\s\-]?\d{4})\b/g;
  let match: RegExpExecArray | null;
  while ((match = phoneRegex.exec(text)) !== null) {
    const raw = match[0].trim();
    const digits = raw.replace(/[OoｏＯ〇○]/g, "0").replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 11) continue;
    pushUnique(results, {
      matchedText: raw,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      category: "phone",
      label: "電話番号"
    });
  }

  // 2. メールアドレス（@ 前後の空白・全角化済みの半角を許容）
  const emailRegex = /[a-zA-Z0-9][a-zA-Z0-9_.+-]*\s*[@＠]\s*[a-zA-Z0-9][a-zA-Z0-9.-]*\s*[.．]\s*[a-zA-Z]{2,}/g;
  while ((match = emailRegex.exec(text)) !== null) {
    pushUnique(results, {
      matchedText: match[0],
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

  // 4. 住所パターン
  // 4a. 都道府県から始まり、市区町村・番地で終わる（例: "東京都港区六本木6-10-1"）
  const prefAddressRegex = new RegExp(`(?:${PREF_PATTERN})[^\n\r0-9０-９、。！？]{1,25}[0-9０-９ー丁目番地号\\-\\s]+`, "gu");
  while ((match = prefAddressRegex.exec(text)) !== null) {
    pushUnique(results, {
      matchedText: match[0].trim(),
      startIndex: match.index,
      endIndex: match.index + match[0].trim().length,
      category: "address",
      label: "住所"
    });
  }

  // 4b. 都道府県省略の市区町村・番地表記（例: 「港区六本木6-10-1」「新宿区西新宿2-8-1」）
  const cityAddressRegex = /([^\n\r0-9０-９、。！？\s]{1,12}(?:[市区町村郡])[^\n\r0-9０-９、。！？\s]{1,15}[0-9０-９ー丁目番地号\-\s]+)/gu;
  while ((match = cityAddressRegex.exec(text)) !== null) {
    const raw = match[0].trim();
    pushUnique(results, {
      matchedText: raw,
      startIndex: match.index,
      endIndex: match.index + raw.length,
      category: "address",
      label: "住所"
    });
  }

  // 4c. 市区町村すら省略された地名＋番地記法（例: 「六本木6-10-1」「丸の内1-1-1」）
  const blockAddressRegex = /([\p{Script=Han}]{2,6}[0-9０-９]+(?:[-ー−–‐][0-9０-９]+){1,3})/gu;
  while ((match = blockAddressRegex.exec(text)) !== null) {
    const raw = match[0].trim();
    pushUnique(results, {
      matchedText: raw,
      startIndex: match.index,
      endIndex: match.index + raw.length,
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
