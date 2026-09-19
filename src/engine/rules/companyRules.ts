/**
 * 会社名・法人名・組織名の精密検出ルール
 * 余計な文脈や助詞を含めず、会社名・組織名そのもののみを抽出する
 */

import { foldVisualJa } from "../ocrNormalize";

function escapeRegex(str: string): string {
  return str.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export const CORPORATE_TYPES = [
  "株式会社", "有限会社", "合同会社", "合資会社", "合名会社",
  "一般社団法人", "公益社団法人", "一般財団法人", "公益財団法人",
  "特定非営利活動法人", "NPO法人", "学校法人", "医療法人", "社会福祉法人",
  "弁護士法人", "税理士法人", "監査法人", "特許業務法人", "司法書士法人", "行政書士法人",
  "（株）", "(株)", "【株】", "㈱", "（有）", "(有)", "㈲", "（同）", "(同)",
  "Inc.", "Corp.", "Ltd.", "LLC", "Co., Ltd.", "Co.,Ltd.", "Corporation"
] as const;

export const ORG_SUFFIXES = [
  "銀行", "信託銀行", "信用金庫", "信金", "労働金庫", "農協",
  "病院", "医院", "クリニック", "診療所", "歯科", "眼科",
  "大学", "短期大学", "大学院", "学園", "高等学校", "中学校", "小学校", "専門学校",
  "警察署", "市役所", "区役所", "町役場", "村役場", "税務署", "消防署", "裁判所",
  "法律事務所", "特許事務所", "会計事務所", "税理士事務所", "社労士事務所",
  "製作所", "製造所", "工業", "興業", "商事", "物産", "不動産", "住宅", "開発",
  "システムズ", "システム", "ソリューションズ", "ソリューション", "テクノロジー", "テクノロジーズ",
  "ラボ", "研究所", "スタジオ", "パートナーズ", "ホールディングス", "グループ",
  "協会", "連合会", "組合", "機構", "公社", "公団", "センター", "事業所"
] as const;

// 会社名と本文を区切る助詞・助動詞・句読点
const COMPANY_STOP_WORDS = /^(?:の|は|が|を|に|で|と|より|から|へ|など|等|様|さん|殿|御中|です|ます|でした|にて|とも|との|として)/;
const PREV_DELIMITER_REGEX = /[はがのをにとへからよりで、。！？\s\n\r/／()（）「」:：]/;

export interface CompanyMatch {
  matchedText: string;
  startIndex: number;
  endIndex: number;
  reason: "corporate_prefix" | "corporate_suffix" | "org_suffix";
}

/**
 * 与えられた文字列の中から法人名・会社名・組織名のみを精密に検出する
 */
export function detectCompaniesInText(text: string): CompanyMatch[] {
  if (!text) return [];
  const results: CompanyMatch[] = [];
  const folded = foldVisualJa(text);

  // 1. 法人格プレフィックス型 (例: "株式会社テックラボの山田です" -> "株式会社テックラボ")
  for (const corp of CORPORATE_TYPES) {
    const escaped = escapeRegex(foldVisualJa(corp));
    // 「株式会社」に続く社名部分（漢字・カタカナ・アルファベット・数字・中黒・ハイフン）
    // ひらがなは助詞にぶつかるまでか、カタカナ・漢字のみ
    const prefixRegex = new RegExp(`(${escaped})\\s*([\\p{Script=Han}\\p{Script=Katakana}a-zA-Z0-9_ー・-]{1,20}|[\\p{Script=Hiragana}\\p{Script=Han}\\p{Script=Katakana}a-zA-Z0-9_ー・-]{1,20})`, "gu");
    
    let match: RegExpExecArray | null;
    while ((match = prefixRegex.exec(folded)) !== null) {
      const matchIndex = match.index;
      const matchedCorp = match[1];
      const namePart = match[2];

      // namePart の中から、助詞（「の」「は」「が」など）が現れたらそこでカットする！
      let cleanNamePart = "";
      for (let i = 0; i < namePart.length; i++) {
        const remaining = namePart.slice(i);
        if (i > 0 && COMPANY_STOP_WORDS.test(remaining)) {
          break; // 助詞以降は社名ではない！
        }
        cleanNamePart += namePart[i];
      }

      if (cleanNamePart.length > 0) {
        // match[0] の中で matchedCorp と cleanNamePart を含む実長
        const cutOffLen = namePart.length - cleanNamePart.length;
        const totalLen = match[0].length - cutOffLen;
        const finalCorpName = text.slice(matchIndex, matchIndex + totalLen);
        if (finalCorpName.length >= matchedCorp.length + 1) {
          results.push({
            matchedText: finalCorpName,
            startIndex: matchIndex,
            endIndex: matchIndex + finalCorpName.length,
            reason: "corporate_prefix"
          });
        }
      }
    }

    // 2. 法人格サフィックス型 (例: "トヨタ自動車株式会社", "Google LLC")
    const suffixRegex = new RegExp(`([\\p{Script=Han}\\p{Script=Katakana}a-zA-Z0-9_ー・-]{1,20})\\s*${escaped}`, "gu");
    while ((match = suffixRegex.exec(folded)) !== null) {
      const matchIndex = match.index;
      const rawBefore = match[1];

      // 直前が助詞ならそこを削る（例: "のトヨタ自動車株式会社" -> "トヨタ自動車株式会社"）
      let cleanBefore = rawBefore;
      let offset = 0;
      for (let i = rawBefore.length - 1; i >= 0; i--) {
        if (PREV_DELIMITER_REGEX.test(rawBefore[i])) {
          cleanBefore = rawBefore.slice(i + 1);
          offset = i + 1;
          break;
        }
      }

      if (cleanBefore.length > 0) {
        const actualStart = matchIndex + offset;
        const finalCorpName = text.slice(actualStart, actualStart + cleanBefore.length + corp.length);
        const isCovered = results.some(r => actualStart >= r.startIndex && (actualStart + finalCorpName.length) <= r.endIndex);
        if (!isCovered && finalCorpName.length > corp.length) {
          results.push({
            matchedText: finalCorpName,
            startIndex: actualStart,
            endIndex: actualStart + finalCorpName.length,
            reason: "corporate_suffix"
          });
        }
      }
    }
  }

  // 3. 組織サフィックス (例: "〇〇銀行", "〇〇病院", "〇〇大学")
  const suffixPattern = ORG_SUFFIXES.map(escapeRegex).join("|");
  const orgRegex = new RegExp(`([\\p{Script=Han}\\p{Script=Katakana}a-zA-Z0-9_ー]{2,15})(?:${suffixPattern})`, "gu");
  let orgMatch: RegExpExecArray | null;
  while ((orgMatch = orgRegex.exec(folded)) !== null) {
    const full = text.slice(orgMatch.index, orgMatch.index + orgMatch[0].length);
    const startIndex = orgMatch.index;
    const isCovered = results.some(r => startIndex >= r.startIndex && (startIndex + full.length) <= r.endIndex);
    if (!isCovered) {
      results.push({
        matchedText: full,
        startIndex,
        endIndex: startIndex + full.length,
        reason: "org_suffix"
      });
    }
  }

  return results;
}
