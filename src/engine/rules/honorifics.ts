import { matchSurname } from "./surnameList";

export const HONORIFICS = [
  "様", "さま", "サマ", "さん", "サン", "君", "くん", "クン", "ちゃん", "チャン",
  "氏", "先生", "殿", "閣下", "社長", "副社長", "会長", "専務", "常務", "取締役", "執行役員",
  "部長", "次長", "課長", "係長", "主任", "主幹", "リーダー", "サブリーダー", "マネージャー",
  "マネージャ", "プロデューサー", "ディレクター", "代表", "CEO", "CTO", "CFO", "COO", "CIO", "PM", "PL", "担当"
] as const;

export interface PersonMatch {
  matchedText: string;
  nameOnly: string;
  startIndex: number;
  endIndex: number;
  reason: "surname_match" | "honorific_match" | "full_name_pattern" | "chat_sender_header";
}

// 名字と同じ綴りの地名・一般語や、画面の操作名を人名へ昇格させない。
const NON_PERSON_WORDS = /(?:確認|承知|了解|連絡|対応|添付|送付|返信|相談|報告|依頼|検討|作成|資料|画像|表示|設定|保存|編集|削除|検索|共有|通知|履歴|一覧|詳細|管理|運用|利用|契約|費用|電話|住所|至急|完了|開始|予定|午前|午後|重要|質問|回答|入力|変更|登録|選択|受付|申請|送信|受信|情報|項目|手順|操作|処理|氏名|名前|担当|責任|部署|総務|営業|社内|お疲れ|ご苦労|皆様|お客様|ユーザー|メンバー|ファイル|フォルダ|アカウント|プロジェクト|グループ|トーク|会議|チャット|チーム|チャンネル|ルーム|件名|ホーム|メニュー|カレンダー|スタンプ|システム|センター|ダウンロード|アップロード|オンライン|オフライン|プレミアム)/u;
const NON_PERSON_ENDING = /(?:都|道|府|県|市|区|町|村|郡|駅|公園|空港|通り|会社|法人|工業|商事|製薬|電機|病院|銀行|大学|学校|研究所|事務所|製作所|支店|店舗|店|課|部|課長|部長|社長)$/u;
const NON_PERSON_EXACT = /^(?:皆|みな|客|神|仏|王|お疲れ|おつかれ|ご苦労|ごくろう|お世話|おせわ|利用者|管理者|参加者|申請者|契約者|代表者|担当者|本日|明日|昨日|未設定|未登録|未入力|不明|なし|無し|任意|必須|テスト|サンプル)$/u;
const UI_WORDS = /^(?:home|menu|settings?|search|save|edit|delete|download|upload|profile|account|login|logout|password|email|name|next|back|cancel|submit|help|support|status|file|folder|project|notification|message|read|unread|online|offline|admin|user|bot)$/i;
const COMMON_SURNAME_COMPOUNDS = /^(?:原材料|原文|原稿|原理|原価|原因|原点|林檎|森林|林業|平野地形|高山地帯|清水湧水|小川沿い|小林製薬|山田電機)$/u;
const GREETING_PATTERN = /(?:お疲れ|おつかれ|ご苦労|ごくろう|お世話|おせわ|ご馳走|ごちそう|お互い|おたがい|お待ちどう|おまちどう)(?:様|さま|サマ|さん|サン)/gu;
const NAME_CHAR = /[\p{Script=Han}々\p{Script=Katakana}a-zA-Z0-9_]/u;
const AFTER_NAME = /^(?:さん|様|さま|君|くん|ちゃん|氏|殿|先生|です|でした|より|から|は|が|を|に|へ|と|の)/u;
const HONORIFIC_PATTERN = [...HONORIFICS].sort((a, b) => b.length - a.length).join("|");

function isExactSurname(value: string): boolean {
  return matchSurname(value) === value;
}

function isKnownFullName(value: string): boolean {
  if (!/^[\p{Script=Han}々][\p{Script=Han}々\p{Script=Katakana}ー]{1,7}$/u.test(value) || NON_PERSON_WORDS.test(value) || NON_PERSON_ENDING.test(value) || COMMON_SURNAME_COMPOUNDS.test(value)) return false;
  const surname = matchSurname(value);
  if (!surname) return false;
  const given = value.slice(surname.length);
  return given.length >= 1 && given.length <= 3;
}

/** ラベル・送信者配置など、人名を指す明示的な文脈内で使う形状検証。 */
export function isPlausiblePersonValue(text: string): boolean {
  const value = text.trim().replace(/[（(][A-Za-z\s.'-]+[）)]$/u, "").trim();
  const compact = value.replace(/[\s\u3000]/g, "");
  if (compact.length < 2 || compact.length > 24 || NON_PERSON_WORDS.test(compact) ||
      NON_PERSON_EXACT.test(compact) || NON_PERSON_ENDING.test(compact) || COMMON_SURNAME_COMPOUNDS.test(compact) || UI_WORDS.test(compact)) return false;
  if (/^[\p{Script=Han}々]{2,8}$/u.test(compact)) return true;
  if (/^[\p{Script=Hiragana}\p{Script=Katakana}ー・]{2,12}$/u.test(compact)) return true;
  if (/^[\p{Script=Han}々]{1,4}[\p{Script=Hiragana}\p{Script=Katakana}ー]{1,4}$/u.test(compact)) return true;
  return /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3}$/.test(value);
}

/**
 * 敬称、区切られた既知の名字、姓名の形を手掛かりにする。
 * 辞書の名字を本文の全位置で探さず、地名や単語中の部分一致を避ける。
 */
export function detectPersonsInText(text: string): PersonMatch[] {
  if (!text) return [];
  let compact = "";
  const origIndices: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (/[ \t\u3000]/.test(text[i])) continue;
    compact += text[i];
    origIndices.push(i);
  }
  const results: PersonMatch[] = [];
  // 混合表記の正名も扱うため、「疲れ様」のように挨拶から接頭辞だけが落ちた
  // 候補が生じる。候補単体だけでなく、元文の挨拶範囲と照合して除外する。
  const greetings = [...compact.matchAll(GREETING_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length
  }));
  const atBoundary = (start: number, end: number): boolean => {
    const before = compact[start - 1] ?? "";
    const after = compact.slice(end);
    const leftSpace = start > 0 && origIndices[start] > origIndices[start - 1] + 1;
    const rightSpace = end < compact.length && origIndices[end] > origIndices[end - 1] + 1;
    return (!NAME_CHAR.test(before) || leftSpace) &&
      (!NAME_CHAR.test(after[0] ?? "") || rightSpace || AFTER_NAME.test(after));
  };
  const add = (start: number, end: number, nameOnly: string, reason: PersonMatch["reason"], includeReading = false): void => {
    if (greetings.some((greeting) => start < greeting.end && end > greeting.start)) return;
    const originalStart = origIndices[start];
    let originalEnd = origIndices[end - 1] + 1;
    if (includeReading) {
      const reading = text.slice(originalEnd).match(/^[\s　]*[（(][A-Za-z\s.'-]+[）)]/);
      if (reading) originalEnd += reading[0].length;
    }
    if (results.some((r) => originalStart >= r.startIndex && originalEnd <= r.endIndex)) return;
    results.push({ matchedText: text.slice(originalStart, originalEnd), nameOnly, startIndex: originalStart, endIndex: originalEnd, reason });
  };

  const honorificRegex = new RegExp(`([\\p{Script=Han}々]{1,4}[\\p{Script=Hiragana}]{1,4}|[\\p{Script=Han}々\\p{Script=Katakana}a-zA-Z]{1,12}|[\\p{Script=Hiragana}]{2,4})(${HONORIFIC_PATTERN})`, "gu");
  let match: RegExpExecArray | null;
  while ((match = honorificRegex.exec(compact)) !== null) {
    const name = match[1];
    if (NON_PERSON_WORDS.test(name) || NON_PERSON_EXACT.test(name) || NON_PERSON_ENDING.test(name) || UI_WORDS.test(name)) continue;
    if (!(isExactSurname(name) || isKnownFullName(name) || isPlausiblePersonValue(name))) continue;
    const end = match.index + match[0].length;
    if (atBoundary(match.index, end)) add(match.index, end, name, "honorific_match");
  }

  // 区切りの両側とも名字である場合に限る。「山田・資料」のような列名は除外。
  const pairRegex = /([\p{Script=Han}々]{1,4})[・･·/／]([\p{Script=Han}々]{1,4})/gu;
  while ((match = pairRegex.exec(compact)) !== null) {
    if (!isExactSurname(match[1]) || !isExactSurname(match[2])) continue;
    const end = match.index + match[0].length;
    if (atBoundary(match.index, end)) add(match.index, end, match[0], "full_name_pattern");
  }

  // 漢字の連続全体を検証する。長い文章や会社名の中から名字だけを切り出さない。
  const nameRegex = /[\p{Script=Han}々\p{Script=Katakana}ー]+/gu;
  while ((match = nameRegex.exec(compact)) !== null) {
    const candidate = match[0];
    const start = match.index;
    const end = start + candidate.length;
    if (!atBoundary(start, end) || NON_PERSON_WORDS.test(candidate) || NON_PERSON_ENDING.test(candidate)) continue;
    if (isKnownFullName(candidate)) {
      add(start, end, candidate, "full_name_pattern", true);
    } else if (candidate.length >= 2 && isExactSurname(candidate)) {
      // 「山田です」「山田から」「山田」等。ひらがな本文を名前へ巻き込まない。
      const after = compact.slice(end);
      const kanaGiven = after.match(/^([\p{Script=Hiragana}]{2,4})(?=$|[（(])/u)?.[1];
      if (kanaGiven && !/^(?:です|ます|でした|より|から|なら|でも|だよ|だね|だと|だが|では|には|とは|への|のみ|だけ|こと|など|ので|ため)$/u.test(kanaGiven) &&
          isPlausiblePersonValue(candidate + kanaGiven)) {
        add(start, end + kanaGiven.length, candidate + kanaGiven, "full_name_pattern", true);
        continue;
      }
      if (!/^[\p{Script=Hiragana}]/u.test(after) || AFTER_NAME.test(after)) add(start, end, candidate, "surname_match");
    }
  }
  return results;
}

/** 強い送信者配置がある場合だけ、辞書にない氏名・username の形まで許可する。 */
export function isLikelyChatSender(text: string, hasSenderContext = false): boolean {
  const value = text.trim().replace(/\s*(?:\d{1,2}:\d{2}|既読|未読|送信済み)\s*$/g, "").trim();
  if (value.length < 2 || value.length > 24 || NON_PERSON_WORDS.test(value) || UI_WORDS.test(value) ||
      /^(?:今日|昨日|既読|未読|送信済み|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})$/.test(value)) return false;
  if (detectPersonsInText(value).some((match) => match.startIndex === 0 && match.endIndex === value.length)) return true;
  if (/^[A-Z][a-z]+(?:[ .'-]+[A-Z][a-z]+)+$/.test(value)) return true;
  if (!hasSenderContext) return false;
  return isPlausiblePersonValue(value) || /^[A-Za-z][A-Za-z0-9_.]{1,14}$/.test(value);
}
