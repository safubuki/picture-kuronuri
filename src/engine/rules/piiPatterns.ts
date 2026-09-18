/**
 * 個人特定可能情報 (PII) 精密正規表現ルール
 * ラベル（TEL:, Email:, 住所: 等）を巻き込まず、値そのものだけを正確に検出する
 */

export interface PiiMatch {
  matchedText: string;
  startIndex: number;
  endIndex: number;
  category: "phone" | "email" | "postal" | "address" | "money" | "sns_id" | "id_number" | "password" | "credit_card" | "person";
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

/**
 * 重複や隣接する同カテゴリの検出結果を賢く結合・重複排除する
 */
function pushOrMerge(results: PiiMatch[], item: PiiMatch, fullText?: string): void {
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    // 同じカテゴリで、重なっているか隣接している（隙間が2文字以内）場合は結合
    if (r.category === item.category) {
      const overlapOrClose = !(item.endIndex < r.startIndex - 2 || item.startIndex > r.endIndex + 2);
      if (overlapOrClose) {
        r.startIndex = Math.min(r.startIndex, item.startIndex);
        r.endIndex = Math.max(r.endIndex, item.endIndex);
        if (fullText) {
          r.matchedText = fullText.slice(r.startIndex, r.endIndex);
        } else if (item.matchedText.length > r.matchedText.length) {
          r.matchedText = item.matchedText;
        }
        return;
      }
    }
    // 完全に包含されているならスキップ
    if (item.startIndex >= r.startIndex && item.endIndex <= r.endIndex) {
      return;
    }
    // 既存のものを完全に包含しているなら既存側を拡大
    if (item.startIndex <= r.startIndex && item.endIndex >= r.endIndex) {
      r.startIndex = item.startIndex;
      r.endIndex = item.endIndex;
      r.matchedText = fullText ? fullText.slice(item.startIndex, item.endIndex) : item.matchedText;
      r.category = item.category;
      r.label = item.label;
      return;
    }
  }
  results.push(item);
}


/**
 * 「Email:」「住所:」「Password:」などラベルの直後から値として取る。
 * OCRがアドレスやパスワード自体を崩しても、値の位置を確実に隠せる。
 */
function detectLabeledValues(text: string): PiiMatch[] {
  const results: PiiMatch[] = [];
  const rules: { re: RegExp; category: PiiMatch["category"]; label: string }[] = [
    // メール
    { re: /(?:Email|E-?mail|メール(?:アドレス)?)\s*[:：\s]\s*([a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+)/iu, category: "email", label: "メールアドレス" },
    // 電話
    { re: /(?:TEL|Tel|電話(?:番号)?)\s*[:：\s]\s*([0-9０-９\-ー−–‐・･\s]{8,22})/iu, category: "phone", label: "電話番号" },
    // 住所（建物名・部屋番号まで）
    { re: /(?:住所|Address)\s*[:：\s]?\s*([^、。\n\r]{4,55})/iu, category: "address", label: "住所" },
    // パスワード（マスク文字や平文）
    { re: /(?:パスワード|Password|PW)\s*[:：\s]\s*([^\n\r]+)/iu, category: "password", label: "パスワード" },
    // クレジットカード / お支払い
    { re: /(?:カード(?:番号)?|Card|クレジットカード|お支払い(?:方法)?)\s*[:：\s(（]?\s*(?:下[0-9０-９]桁\s*[:：]?\s*)?([0-9０-９\-*\s]{4,24}(?:\s*有効期限\s*[:：]?\s*[0-9０-９/]+)?)/iu, category: "credit_card", label: "カード情報" },
    // お名前 / 氏名
    { re: /(?:お?名前|氏名|Name)\s*(?:\([^)]*\)|（[^）]*）)?\s*[:：\s]\s*([^\n\r]+)/iu, category: "person", label: "人名" }
  ];

  for (const rule of rules) {
    const m = rule.re.exec(text);
    if (!m || !m[1]) continue;
    const value = m[1].trimEnd();
    if (value.length < 2) continue;
    const startIndex = text.indexOf(m[1], m.index);
    if (startIndex < 0) continue;
    pushOrMerge(results, {
      matchedText: value,
      startIndex,
      endIndex: startIndex + value.length,
      category: rule.category,
      label: rule.label
    }, text);
  }
  return results;
}

export function detectPiiInText(text: string): PiiMatch[] {
  if (!text) return [];
  const results: PiiMatch[] = detectLabeledValues(text);

  // 1. 電話番号・携帯番号
  const phoneRegex =
    /(?:0|O|o|〇)[\dOo]{1,4}[-ー−–‐・･.\s]{1,3}[\dOo]{1,4}[-ー−–‐・･.\s]{1,3}[\dOo]{3,5}|(?:0[789]0[\s\-]?\d{4}[\s\-]?\d{4}|0\d{1,4}[\s\-]?\d{1,4}[\s\-]?\d{4})\b/g;
  let match: RegExpExecArray | null;
  while ((match = phoneRegex.exec(text)) !== null) {
    const raw = match[0].trim();
    const digits = raw.replace(/[OoｏＯ〇○]/g, "0").replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 11) continue;
    pushOrMerge(results, {
      matchedText: raw,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      category: "phone",
      label: "電話番号"
    }, text);
  }

  // 2. メールアドレス
  const emailRegex = /[a-zA-Z0-9][a-zA-Z0-9_.+-]*\s*[@＠]\s*[a-zA-Z0-9][a-zA-Z0-9.-]*\s*[.．]\s*[a-zA-Z]{2,}/g;
  while ((match = emailRegex.exec(text)) !== null) {
    pushOrMerge(results, {
      matchedText: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      category: "email",
      label: "メールアドレス"
    }, text);
  }

  // 3. 郵便番号
  const postalRegex = /(?:〒\s*)\d{3}[-ー−–‐]\d{4}\b/g;
  while ((match = postalRegex.exec(text)) !== null) {
    pushOrMerge(results, {
      matchedText: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      category: "postal",
      label: "郵便番号"
    }, text);
  }

  // 4. 住所パターン（都道府県＋市区町村＋番地＋ビル/マンション名・部屋番号まで包括）
  const prefAddressRegex = new RegExp(
    `(?:${PREF_PATTERN})[^\n\r0-9０-９、。！？]{1,25}[0-9０-９ー丁目番地号\\-\\s]+(?:[\\s　]*[^\n\r0-9０-９、。！？\\s]{1,15}[0-9０-９]+(?:号室?)?)?`,
    "gu"
  );
  while ((match = prefAddressRegex.exec(text)) !== null) {
    pushOrMerge(results, {
      matchedText: match[0].trim(),
      startIndex: match.index,
      endIndex: match.index + match[0].trim().length,
      category: "address",
      label: "住所"
    }, text);
  }

  // 4b. 市区町村・番地表記（都道府県省略）
  const cityAddressRegex = /([^\n\r0-9０-９、。！？\s]{1,12}(?:[市区町村郡])[^\n\r0-9０-９、。！？\s]{1,15}[0-9０-９ー丁目番地号\-\s]+(?:[\s　]*[^\n\r0-9０-９、。！？\s]{1,15}[0-9０-９]+(?:号室?)?)?)/gu;
  while ((match = cityAddressRegex.exec(text)) !== null) {
    const raw = match[0].trim();
    pushOrMerge(
      results,
      {
        matchedText: raw,
        startIndex: match.index,
        endIndex: match.index + raw.length,
        category: "address",
        label: "住所"
      },
      text
    );
  }

  // 5. パスワード表記（●●●● や Password: xxx）
  const pwRegex = /(?:[●•*]{4,24}|Password:\s*[^\s)\n\r]+)/gi;
  while ((match = pwRegex.exec(text)) !== null) {
    pushOrMerge(
      results,
      {
        matchedText: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        category: "password",
        label: "パスワード"
      },
      text
    );
  }

  // 6. クレジットカード（下4桁、有効期限）
  const cardDigitsRegex = /(?:下[0-9０-９]桁\s*[:：]?\s*[0-9]{4}|有効期限\s*[:：]?\s*[0-9]{2}\/[0-9]{2}|\b(?:\d{4}[-\s]?){3}\d{4}\b)/gi;
  while ((match = cardDigitsRegex.exec(text)) !== null) {
    pushOrMerge(
      results,
      {
        matchedText: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        category: "credit_card",
        label: "カード情報"
      },
      text
    );
  }

  // 7. 金額 (例: 1,500円, ￥50,000)
  const moneyRegex = /(?:[￥¥]\s*[\d,]+|[\d,]+\s*円)/g;
  while ((match = moneyRegex.exec(text)) !== null) {
    pushOrMerge(
      results,
      {
        matchedText: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        category: "money",
        label: "金額"
      },
      text
    );
  }

  // 8. SNS ID (例: @aoi_lifestyle)
  const snsRegex = /(?:^|\s)(@[a-zA-Z0-9_]{3,25})\b/g;
  while ((match = snsRegex.exec(text)) !== null) {
    const actualId = match[1];
    const actualStart = match.index + match[0].indexOf(actualId);
    pushOrMerge(
      results,
      {
        matchedText: actualId,
        startIndex: actualStart,
        endIndex: actualStart + actualId.length,
        category: "sns_id",
        label: "SNS・アカウントID"
      },
      text
    );
  }


  return results;
}

