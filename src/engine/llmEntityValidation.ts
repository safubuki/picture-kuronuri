/** LLMの出力を、実際のOCR行に存在する短い文字列へ限定する。 */
export type LlmRedactionEntity = {
  lineIndex: number;
  text: string;
  type: "person" | "company" | "pii" | "confidential";
};

export type LlmRedactionLine = { lineIndex: number; text: string };

const ENTITY_TYPES = new Set(["person", "company", "pii", "confidential"]);
const GENERAL_WORDS = new Set([
  "teams", "microsoft teams", "slack", "チャット", "チーム", "チャンネル", "スレッド",
  "ホーム", "検索", "通知", "アクティビティ", "返信", "送信", "編集", "削除", "共有",
  "保存", "設定", "ヘルプ", "メニュー", "ファイル", "メッセージ", "リアクション",
  "オンライン", "オフライン", "未読", "既読", "会議", "通話", "カレンダー", "一般",
  "今日", "昨日", "明日", "午前", "午後", "月曜日", "火曜日", "水曜日", "木曜日",
  "金曜日", "土曜日", "日曜日", "名前", "人名", "会社名", "電話番号", "住所",
  "メールアドレス", "パスワード", "金額", "機密", "社外秘", "社内秘", "未公開",
  "案件", "プロジェクト", "取引", "見積", "見積額", "確認", "資料", "予定", "報告",
  "担当", "担当者", "管理者", "ユーザー", "ゲスト", "メンバー", "参加者", "皆さん",
  "お疲れ様", "お疲れさま", "疲れ様", "疲れさま", "ご苦労様", "苦労様",
  "ありがとう", "ありがとうございます", "よろしく", "よろしくお願いします",
  "こんにちは", "こんばんは", "おはよう", "おはようございます", "了解", "承知",
]);
const CONFIDENTIAL_CONTEXT = /社外秘|社内秘|機密|未公開|案件|プロジェクト|取引|見積/;
const TIME_OR_DATE = /^(?:\d{1,2}[:：]\d{2}(?:[:：]\d{2})?|(?:午前|午後|am|pm)?\s*\d{1,2}時(?:\d{1,2}分)?|\d{1,4}[\/年.-]\d{1,2}(?:[\/月.-]\d{1,2}日?)?|[月火水木金土日](?:曜(?:日)?)?)$/i;

function isGeneralText(text: string): boolean {
  const normalized = text.normalize("NFKC").trim().replace(/[。.!！?？:：]+$/u, "").toLowerCase();
  return GENERAL_WORDS.has(normalized) || TIME_OR_DATE.test(normalized) ||
    /(?:お疲れ(?:様|さま)|ご苦労様|ありがとう|よろしくお願い)/u.test(normalized);
}

function hasPiiContext(text: string, line: string): boolean {
  // メール・電話・住所は形式、認証情報や口座等は明示ラベルも確認する。
  return /[^\s@]+@[^\s@]+\.[^\s@]+/u.test(text) ||
    (/^[+\d()（）\s－ー-]+$/u.test(text) && text.replace(/\D/g, "").length >= 7) ||
    /(?:都|道|府|県|市|区|町|村).*(?:丁目|番地|番|号|\d)/u.test(text) ||
    /(?:パスワード|暗証番号|認証コード|秘密鍵|API\s*キー|口座番号|口座情報)\s*[:：=]/iu.test(line);
}

/** JSON破損は失敗として通知する。正しい空配列は正常な「追加候補なし」。 */
export function validateLlmRedactionEntities(
  outputText: string,
  lines: LlmRedactionLine[]
): LlmRedactionEntity[] {
  const json = outputText.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("文脈AIの抽出結果が正しいJSONではありませんでした。");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("文脈AIの抽出結果がJSON配列ではありませんでした。");
  }

  const lineByIndex = new Map(lines.map((line) => [line.lineIndex, line.text]));
  const entities: LlmRedactionEntity[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const { lineIndex, text, type } = item;
    if (!Number.isSafeInteger(lineIndex) || typeof text !== "string" ||
      typeof type !== "string" || !ENTITY_TYPES.has(type)) continue;
    const line = lineByIndex.get(lineIndex);
    if (typeof line !== "string" || text !== text.trim() || !line.includes(text)) continue;
    const length = Array.from(text).length;
    if (length < 2 || length > 80 || text.includes("\n") || text.includes("\r")) continue;
    // 行全文の誤った分類を丸ごと黒塗りへ昇格させない。
    if (text === line.trim() || isGeneralText(text)) continue;
    if (type === "person" && (length > 40 || !/^[\p{L}\p{M} .・'’ʼ-]+$/u.test(text))) continue;
    if (type === "pii" && !hasPiiContext(text, line)) continue;
    if (type === "confidential") {
      // 直前のOCR行で「社外秘:」等が分割される場合も扱う。離れた行へ伝播しない。
      const context = `${lineByIndex.get(lineIndex - 1) ?? ""}\n${line}`;
      if (!CONFIDENTIAL_CONTEXT.test(context)) continue;
    }
    const key = `${lineIndex}\u0000${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push({ lineIndex, text, type: type as LlmRedactionEntity["type"] });
    if (entities.length >= 8) break;
  }
  return entities;
}
