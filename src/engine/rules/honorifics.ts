import { matchSurname } from "./surnameList";

/**
 * 敬称・役職パターンの定義
 */
export const HONORIFICS = [
  // 一般敬称
  "様", "さま", "サマ",
  "さん", "サン",
  "君", "くん", "クン",
  "ちゃん", "チャン",
  "氏", "先生", "殿", "閣下",
  // 役職
  "社長", "副社長", "会長", "専務", "常務", "取締役", "執行役員",
  "部長", "次長", "課長", "係長", "主任", "主幹", "リーダー", "サブリーダー",
  "マネージャー", "マネージャ", "プロデューサー", "ディレクター",
  "代表", "CEO", "CTO", "CFO", "COO", "CIO", "PM", "PL", "担当"
] as const;

// 助詞・接続詞・句読点・中黒・各種記号（人名の境界となる区切り文字）
const PARTICLES_REGEX = /[をにはがのでへとよりからてで、。！？\s\n\r/／()（）「」:：・·•|｜\-ー_＿,，.．\[\]［］{}｛｝【】『』<><>《》〜~;；]/;

export interface PersonMatch {
  matchedText: string;
  nameOnly: string;
  startIndex: number;
  endIndex: number;
  reason: "surname_match" | "honorific_match" | "full_name_pattern" | "chat_sender_header";
}

/**
 * 与えられた文字列の中から人名（名字＋敬称、フルネーム、役職付き人名）を精密に抽出する
 */
export function detectPersonsInText(text: string): PersonMatch[] {
  if (!text) return [];
  const results: PersonMatch[] = [];

  // 1. 敬称・役職付き人名マッチング
  // 敬称の直前の 1〜5 文字の名前部分のみを抽出する（直前の助詞や空白は絶対に含めない）
  const honorificPattern = HONORIFICS.join("|");
  // 直前の名前部分は漢字・カタカナ・アルファベット1〜5文字、またはひらがな2〜4文字
  const honorificRegex = new RegExp(`([\\p{Script=Han}\\p{Script=Katakana}a-zA-Z]{1,6}|[\\p{Script=Hiragana}]{2,4})(?:${honorificPattern})`, "gu");

  let match: RegExpExecArray | null;
  while ((match = honorificRegex.exec(text)) !== null) {
    const fullMatched = match[0];
    const namePart = match[1];
    const matchStart = match.index;

    // 直前が助詞や句読点でない場合、名前部分の先頭に助詞が含まれていないか確認
    // 例: "を鈴木部長" -> "鈴木部長"
    let cleanName = fullMatched;
    let cleanStart = matchStart;
    
    // 名前の先頭1文字がもし助詞なら削る
    if (PARTICLES_REGEX.test(cleanName[0])) {
      cleanName = cleanName.slice(1);
      cleanStart += 1;
    }

    results.push({
      matchedText: cleanName,
      nameOnly: namePart,
      startIndex: cleanStart,
      endIndex: cleanStart + cleanName.length,
      reason: "honorific_match"
    });
  }

  // 2. フルネームパターン (例: "山田 太郎", "鈴木 一郎", "山田太郎")
  // 名字辞書にマッチする名字 + (空白任意) + 1〜3文字の名前
  const fullNameRegex = /([\p{Script=Han}]{1,4})(?:[\s　]+)?([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,3})/gu;
  while ((match = fullNameRegex.exec(text)) !== null) {
    const candidateSurname = match[1];
    const candidateGiven = match[2];
    const matchedFull = match[0];
    const startIndex = match.index;
    const endIndex = startIndex + matchedFull.length;

    // candidateGiven が一般的な助詞・助動詞（「です」「ます」「でした」「から」「より」「こと」「など」）の場合は人名ではない
    if (/^(?:です|ます|でした|から|より|こと|など|との|について|として|ので|ため|よう|わけ)$/.test(candidateGiven)) {
      // 名字部分だけを登録
      if (matchSurname(candidateSurname)) {
        const isCovered = results.some(r => startIndex >= r.startIndex && (startIndex + candidateSurname.length) <= r.endIndex);
        if (!isCovered) {
          results.push({
            matchedText: candidateSurname,
            nameOnly: candidateSurname,
            startIndex,
            endIndex: startIndex + candidateSurname.length,
            reason: "surname_match"
          });
        }
      }
      continue;
    }

    // 名字辞書との一致確認
    if (matchSurname(candidateSurname)) {
      const isCovered = results.some(r => startIndex >= r.startIndex && endIndex <= r.endIndex);
      if (!isCovered) {
        results.push({
          matchedText: matchedFull,
          nameOnly: matchedFull,
          startIndex,
          endIndex,
          reason: "full_name_pattern"
        });
      }
    }
  }

  // 3. 名字単体マッチング（「山田」「鈴木」）
  // 単語の前後に助詞がある場合でも、名字部分（2〜4文字）のみを正確に切り出す
  for (let i = 0; i < text.length; i++) {
    const isCovered = results.some(r => i >= r.startIndex && i < r.endIndex);
    if (isCovered) continue;

    const sub = text.slice(i);
    const surname = matchSurname(sub);
    if (surname && surname.length >= 2) {
      // 直前が文字（漢字・ひらがな・カタカナ）でないこと、または助詞であること
      const prevChar = i > 0 ? text[i - 1] : "";
      const isStartOfWord = !prevChar || PARTICLES_REGEX.test(prevChar) || !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(prevChar);

      if (isStartOfWord) {
        // 直後が助詞（「です」「さん」「様」等）または句読点・空白
        const nextChar = text[i + surname.length] || "";
        const isEndOfWord = !nextChar || PARTICLES_REGEX.test(nextChar) || /^(?:です|ます|でした|の|は|が|に|を|と)/.test(text.slice(i + surname.length));

        if (isEndOfWord) {
          results.push({
            matchedText: surname,
            nameOnly: surname,
            startIndex: i,
            endIndex: i + surname.length,
            reason: "surname_match"
          });
          i += surname.length - 1;
        }
      }
    }
  }

  return results;
}

/**
 * チャット画面のヘッダー（メッセージ吹き出し上部やアバター横の短文）が
 * 送信者名である可能性を判定するヒューリスティック
 */
export function isLikelyChatSender(text: string): boolean {
  const t = text.trim();
  if (t.length < 1 || t.length > 15) return false;

  // タイムスタンプやシステムメッセージ、プロジェクト名・ルーム名は除外
  if (/^(?:\d{1,2}:\d{2}|既読|未読|送信済み|今日|昨日|\d{1,2}\/\d{1,2})$/.test(t)) {
    return false;
  }
  if (/(?:プロジェクト|連絡|グループ|トーク|会議|チャット|チーム|チャンネル|ルーム|件名)/.test(t)) {
    return false;
  }

  // フルネーム（スペース区切り: 例「山田 太郎」）
  if (/^[\p{Script=Han}]{1,4}[\s　]+[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,4}$/u.test(t)) {
    return true;
  }

  // 名字単体（2〜4文字）
  const surname = matchSurname(t);
  if (surname && surname === t) return true;

  // アルファベットのみの短いユーザー名（例: "alice", "ken_tanaka"）
  if (/^[a-zA-Z0-9_.]{2,15}$/.test(t)) return true;

  return false;
}
