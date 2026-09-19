/**
 * 個人特定可能情報 (PII) 精密正規表現ルール
 * ラベル（TEL:, Email:, 住所: 等）を巻き込まず、値そのものだけを正確に検出する
 */

export interface PiiMatch {
  matchedText: string;
  startIndex: number;
  endIndex: number;
  category:
    | "phone"
    | "email"
    | "postal"
    | "address"
    | "money"
    | "sns_id"
    | "id_number"
    | "password"
    | "credit_card"
    | "person"
    | "birth_date"
    | "bank_account"
    | "secret";
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
 * 全角ASCIIだけを半角へ寄せる。1文字→1文字の変換に限定することで、
 * 正規化後のインデックスをそのままOCR文字座標へ戻せるようにする。
 */
function normalizeWidthPreservingLength(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === 0x3000) out += " ";
    else if (code !== undefined && code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCodePoint(code - 0xfee0);
    } else {
      out += ch;
    }
  }
  return out;
}

const NEXT_LABEL_PATTERN =
  /\s+(?=(?:TEL|電話|Email|E-?mail|メール|住所|Address|氏名|名前|Name|生年月日|誕生日|口座番号|支店番号|顧客番号|社員番号|会員ID|ユーザーID|ログインID|パスワード|Password|PW|カード番号|有効期限)\s*[:：])/iu;

function trimLabeledValue(value: string): string {
  const pipe = value.search(/[|｜]/u);
  const nextLabel = value.search(NEXT_LABEL_PATTERN);
  let end = value.length;
  if (pipe >= 0) end = Math.min(end, pipe);
  if (nextLabel >= 0) end = Math.min(end, nextLabel);
  return value.slice(0, end).trimEnd();
}

function digitsOnly(value: string): string {
  return value
    .replace(/[OoｏＯ〇○]/g, "0")
    .replace(/[IlＩｌ|]/g, "1")
    .replace(/\D/g, "");
}

/** マイナンバーの検査用数字を含む12桁についてチェックディジットを確認する。 */
function isValidMyNumber(value: string): boolean {
  const digits = digitsOnly(value);
  if (!/^\d{12}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const positionFromRight = 11 - i;
    const weight = positionFromRight <= 6 ? positionFromRight + 1 : positionFromRight - 5;
    sum += Number(digits[i]) * weight;
  }
  const remainder = sum % 11;
  const check = remainder <= 1 ? 0 : 11 - remainder;
  return check === Number(digits[11]);
}

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
  const normalizedText = normalizeWidthPreservingLength(text);
  const rules: { re: RegExp; category: PiiMatch["category"]; label: string }[] = [
    // メール
    { re: /(?:Email|E-?mail|メール(?:アドレス)?)\s*[:：\s]\s*([a-zA-Z0-9_.+-]+\s*@\s*[a-zA-Z0-9.-]+)/giu, category: "email", label: "メールアドレス" },
    // 電話
    { re: /(?:TEL|電話(?:番号)?|携帯(?:番号)?)\s*[:：\s]\s*([0-9Oo〇○()（）+\-ー−–‐・･.\s]{8,24})/giu, category: "phone", label: "電話番号" },
    // 郵便番号
    { re: /(?:郵便番号|〒)\s*[:：\s]?\s*(\d{3}\s*[-ー−–‐]?\s*\d{4})/giu, category: "postal", label: "郵便番号" },
    // 住所（建物名・部屋番号まで）
    { re: /(?:住所|Address)\s*[:：\s]?\s*([^、。\n\r]{4,80})/giu, category: "address", label: "住所" },
    // パスワード（マスク文字や平文）
    { re: /(?:パスワード|Password|PW)\s*[:：\s]\s*([^\n\r]{2,80})/giu, category: "password", label: "パスワード" },
    // クレジットカード / お支払い
    { re: /(?:カード(?:番号)?|Card|クレジットカード|お支払い(?:方法)?)\s*[:：\s(（]?\s*(?:下\d桁\s*[:：]?\s*)?([0-9\-*\s]{4,24}(?:\s*有効期限\s*[:：]?\s*[0-9/]+)?)/giu, category: "credit_card", label: "カード情報" },
    // お名前 / 氏名
    { re: /(?:お?名前|氏名|Name)\s*(?:\([^)]*\)|（[^）]*）)?\s*[:：\s]\s*([^\n\r]{2,60})/giu, category: "person", label: "人名" },
    // 生年月日
    { re: /(?:生年月日|誕生日|Date\s*of\s*Birth|DOB)\s*[:：\s]\s*((?:明治|大正|昭和|平成|令和)?\s*\d{1,4}\s*[年/.\-]\s*\d{1,2}\s*[月/.\-]\s*\d{1,2}\s*日?)/giu, category: "birth_date", label: "生年月日" },
    // 銀行口座・支店番号
    { re: /(?:口座番号|口座No\.?|Account\s*(?:No\.?|Number))\s*[:：\s]\s*([0-9\-\s]{4,16})/giu, category: "bank_account", label: "口座番号" },
    { re: /(?:支店番号|店番号|Branch\s*(?:No\.?|Number))\s*[:：\s]\s*([0-9\-\s]{3,8})/giu, category: "bank_account", label: "支店番号" },
    // 公的・業務ID。ラベル必須にして通常の数値との誤検出を防ぐ。
    { re: /(?:マイナンバー|個人番号)\s*[:：\s]\s*([0-9\-\s]{12,18})/giu, category: "id_number", label: "個人番号" },
    { re: /(?:運転免許証?(?:番号)?|免許証番号)\s*[:：\s]\s*([0-9A-Z\-\s]{8,18})/giu, category: "id_number", label: "免許証番号" },
    { re: /(?:旅券番号|パスポート番号)\s*[:：\s]\s*([A-Z]{1,2}\s*\d{6,8})/giu, category: "id_number", label: "旅券番号" },
    { re: /(?:保険者番号|被保険者番号|記号番号)\s*[:：\s]\s*([0-9A-Zぁ-んァ-ヶ一-龠\-\s]{4,24})/giu, category: "id_number", label: "保険証番号" },
    { re: /(?:社員番号|従業員番号|顧客番号|会員番号|会員ID|ユーザーID|ログインID)\s*[:：\s]\s*([a-zA-Z0-9_.@\-]{2,40})/giu, category: "id_number", label: "識別番号" }
  ];

  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(normalizedText)) !== null) {
      if (!m[1]) continue;
      const value = trimLabeledValue(m[1]);
      if (value.length < 2) continue;
      const startIndex = normalizedText.indexOf(m[1], m.index);
      if (startIndex < 0) continue;
      pushOrMerge(results, {
        matchedText: text.slice(startIndex, startIndex + value.length),
        startIndex,
        endIndex: startIndex + value.length,
        category: rule.category,
        label: rule.label
      }, text);
    }
  }
  return results;
}

export function detectPiiInText(text: string): PiiMatch[] {
  if (!text) return [];
  const results: PiiMatch[] = detectLabeledValues(text);
  const normalizedText = normalizeWidthPreservingLength(text);

  // 1. 電話番号・携帯番号
  const phoneRegex =
    /(?:0|O|o|〇)[\dOo]{1,4}[-ー−–‐・･.\s]{1,3}[\dOo]{1,4}[-ー−–‐・･.\s]{1,3}[\dOo]{3,5}|(?:0[789]0[\s\-]?\d{4}[\s\-]?\d{4}|0\d{1,4}[\s\-]?\d{1,4}[\s\-]?\d{4})\b/g;
  let match: RegExpExecArray | null;
  while ((match = phoneRegex.exec(normalizedText)) !== null) {
    const raw = text.slice(match.index, match.index + match[0].length).trim();
    const digits = digitsOnly(raw);
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
  while ((match = emailRegex.exec(normalizedText)) !== null) {
    pushOrMerge(results, {
      matchedText: text.slice(match.index, match.index + match[0].length),
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      category: "email",
      label: "メールアドレス"
    }, text);
  }

  // 3. 郵便番号
  const postalRegex = /(?:〒\s*)\d{3}[-ー−–‐]\d{4}\b/g;
  while ((match = postalRegex.exec(normalizedText)) !== null) {
    pushOrMerge(results, {
      matchedText: text.slice(match.index, match.index + match[0].length),
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

  // 5. マスク済みパスワード表記。ラベル付き平文は detectLabeledValues で値だけを検出済み。
  const pwRegex = /[●•*]{4,24}/g;
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
  while ((match = cardDigitsRegex.exec(normalizedText)) !== null) {
    pushOrMerge(
      results,
      {
        matchedText: text.slice(match.index, match.index + match[0].length),
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
  while ((match = moneyRegex.exec(normalizedText)) !== null) {
    pushOrMerge(
      results,
      {
        matchedText: text.slice(match.index, match.index + match[0].length),
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
  while ((match = snsRegex.exec(normalizedText)) !== null) {
    const actualId = text.slice(match.index + match[0].indexOf(match[1]), match.index + match[0].indexOf(match[1]) + match[1].length);
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

  // 9. チェックディジットが正しいラベルなしマイナンバー。
  // 通常の12桁数値は対象にせず、誤検出を増やさない。
  const twelveDigitRegex = /(?:^|\D)(\d{4}[\s-]?\d{4}[\s-]?\d{4})(?!\d)/g;
  while ((match = twelveDigitRegex.exec(normalizedText)) !== null) {
    const candidate = match[1];
    if (!isValidMyNumber(candidate)) continue;
    const startIndex = match.index + match[0].indexOf(candidate);
    pushOrMerge(results, {
      matchedText: text.slice(startIndex, startIndex + candidate.length),
      startIndex,
      endIndex: startIndex + candidate.length,
      category: "id_number",
      label: "個人番号"
    }, text);
  }

  // 10. 形式が十分に固い認証情報。一般単語との衝突を避けるため代表的な接頭辞に限定。
  const secretRegex = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g;
  while ((match = secretRegex.exec(normalizedText)) !== null) {
    pushOrMerge(results, {
      matchedText: text.slice(match.index, match.index + match[0].length),
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      category: "secret",
      label: "認証情報"
    }, text);
  }


  return results;
}
