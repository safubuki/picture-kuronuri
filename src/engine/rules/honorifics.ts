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
interface CompactMapping {
  compact: string;
  origIndices: number[];
}

function buildCompactMapping(text: string): CompactMapping {
  let compact = "";
  const origIndices: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\u3000") continue;
    compact += ch;
    origIndices.push(i);
  }
  return { compact, origIndices };
}

/**
 * 与えられた文字列の中から人名（名字＋敬称、フルネーム、役職付き人名）を精密に抽出する
 * OCR特有の空白混入（例:「山 田 太 郎」「山 田 様」）も完全に吸収する
 */
export function detectPersonsInText(text: string): PersonMatch[] {
  if (!text) return [];
  const results: PersonMatch[] = [];
  const { compact, origIndices } = buildCompactMapping(text);

  const toOrigRange = (cStart: number, cEnd: number): { start: number; end: number } => {
    const start = origIndices[cStart];
    const end = origIndices[cEnd - 1] + 1;
    return { start, end };
  };

  const honorificPattern = HONORIFICS.join("|");

  // 1. 敬称・役職付き人名マッチング (例: 「山田様」「山 田 様」「田中社長」)
  const honorificRegex = new RegExp(`([\\p{Script=Han}\\p{Script=Katakana}a-zA-Z]{1,6}|[\\p{Script=Hiragana}]{2,4})(${honorificPattern})`, "gu");

  let match: RegExpExecArray | null;
  while ((match = honorificRegex.exec(compact)) !== null) {
    const namePart = match[1];
    const matchedFull = match[0];

    // 定型挨拶・一般名詞の除外（「お疲れ様」「ご苦労様」「皆様」「お客様」「ご対応様」等は人名ではない）
    if (/^(?:お疲れ|おつかれ|ご苦労|ごくろう|お世話|おせわ|皆|みな|客|神|仏|王)$/.test(namePart)) {
      continue;
    }

    const cStart = match.index;
    const cEnd = cStart + matchedFull.length;
    const { start, end } = toOrigRange(cStart, cEnd);

    results.push({
      matchedText: text.slice(start, end),
      nameOnly: namePart,
      startIndex: start,
      endIndex: end,
      reason: "honorific_match"
    });
  }

  // 1b. 中黒・スラッシュ区切りの名字列 (例: 「山田・鈴木」)
  const pairRegex = /([\p{Script=Han}]{2,4})[・･·/／]([\p{Script=Han}]{2,4})/gu;
  while ((match = pairRegex.exec(compact)) !== null) {
    const a = match[1];
    const b = match[2];
    if (!matchSurname(a) && !matchSurname(b)) continue;
    const cStart = match.index;
    const cEnd = cStart + match[0].length;
    const { start, end } = toOrigRange(cStart, cEnd);

    const isCovered = results.some((r) => start >= r.startIndex && end <= r.endIndex);
    if (!isCovered) {
      results.push({
        matchedText: text.slice(start, end),
        nameOnly: text.slice(start, end),
        startIndex: start,
        endIndex: end,
        reason: "full_name_pattern"
      });
    }
  }

  // 1c. 名字＋名乗り・助動詞表現 (例: 「鈴木です」「田中でした」「佐藤より」「高橋から」)
  const introRegex = /([\p{Script=Han}]{1,4})(?:です|ます|でした|より|から)(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu;
  while ((match = introRegex.exec(compact)) !== null) {
    const candidate = match[1];
    if (matchSurname(candidate)) {
      const cStart = match.index;
      const cEnd = cStart + candidate.length;
      const { start, end } = toOrigRange(cStart, cEnd);
      const isCovered = results.some(r => start >= r.startIndex && end <= r.endIndex);
      if (!isCovered) {
        results.push({
          matchedText: text.slice(start, end),
          nameOnly: candidate,
          startIndex: start,
          endIndex: end,
          reason: "surname_match"
        });
      }
    }
  }

  // 2. フルネームパターン (例: "山田 太郎", "山 田 太 郎", "鈴木 一郎", "山田太郎")
  const fullNameRegex = /([\p{Script=Han}\p{Script=Katakana}]{1,4})([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,3})/gu;
  while ((match = fullNameRegex.exec(compact)) !== null) {
    const candidateSurname = match[1];
    const candidateGiven = match[2];

    // 敬称は1ですでに処理済みなので除外
    if (/^(?:さん|サン|様|サマ|さま|君|くん|ちゃん|殿|どの|氏)$/.test(candidateGiven)) {
      continue;
    }

    const matchedFull = match[0];
    const cStart = match.index;
    const cEnd = cStart + matchedFull.length;
    const { start, end } = toOrigRange(cStart, cEnd);

    // 助動詞・助詞除外
    if (/^(?:です|ます|でした|から|より|こと|など|との|について|として|ので|ため|よう|わけ)$/.test(candidateGiven)) {
      if (matchSurname(candidateSurname)) {
        const sEnd = toOrigRange(cStart, cStart + candidateSurname.length).end;
        const isCovered = results.some(r => start >= r.startIndex && sEnd <= r.endIndex);
        if (!isCovered) {
          results.push({
            matchedText: text.slice(start, sEnd),
            nameOnly: candidateSurname,
            startIndex: start,
            endIndex: sEnd,
            reason: "surname_match"
          });
        }
      }
      continue;
    }

    if (matchSurname(candidateSurname)) {
      const isCovered = results.some(r => start >= r.startIndex && end <= r.endIndex);
      if (!isCovered) {
        results.push({
          matchedText: text.slice(start, end),
          nameOnly: matchedFull,
          startIndex: start,
          endIndex: end,
          reason: "full_name_pattern"
        });
      }
    }
  }

  // 3. 名字単体マッチング (例: 「山田」「鈴木」)
  for (let i = 0; i < compact.length; i++) {
    const sub = compact.slice(i);
    const surname = matchSurname(sub);
    if (surname && surname.length >= 2) {
      const cStart = i;
      const cEnd = i + surname.length;
      const { start, end } = toOrigRange(cStart, cEnd);
      const isCovered = results.some(r => start >= r.startIndex && end <= r.endIndex);
      if (!isCovered) {
        results.push({
          matchedText: text.slice(start, end),
          nameOnly: surname,
          startIndex: start,
          endIndex: end,
          reason: "surname_match"
        });
        i += surname.length - 1;
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
  let t = text.trim();
  t = t.replace(/\s*(?:\d{1,2}:\d{2}|既読|未読|送信済み)\s*$/g, "").trim();
  if (t.length < 1 || t.length > 18) return false;

  // タイムスタンプやシステムメッセージ、プロジェクト名・ルーム名は除外
  if (/^(?:\d{1,2}:\d{2}|既読|未読|送信済み|今日|昨日|\d{1,2}\/\d{1,2})$/.test(t)) {
    return false;
  }
  if (/(?:プロジェクト|連絡|グループ|トーク|会議|チャット|チーム|チャンネル|ルーム|件名)/.test(t)) {
    return false;
  }

  // フルネーム（スペース混入も吸収: 例「山田 太郎」「山 田 太 郎」「山田太郎」「鈴木一郎」）
  const compact = t.replace(/[\s\t\u3000]/g, "");
  if (compact.length >= 2 && compact.length <= 8) {
    const compactSurname = matchSurname(compact);
    if (compactSurname && compactSurname.length >= 2) {
      if (compact.length === compactSurname.length) return true; // 名字単体
      const given = compact.slice(compactSurname.length);
      if (given.length <= 4 && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,4}$/u.test(given)) {
        return true; // 名字＋名前
      }
    }
  }

  // 名字単体（2〜4文字）
  const surname = matchSurname(t);
  if (surname && surname === t) return true;

  // アルファベットのみの短いユーザー名（例: "alice", "ken_tanaka"）
  if (/^[a-zA-Z0-9_.]{2,15}$/.test(t)) return true;

  return false;
}
