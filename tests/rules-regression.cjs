const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    },
    fileName: filename
  });
  module._compile(compiled.outputText, filename);
};

const { detectPiiInText } = require("../src/engine/rules/piiPatterns.ts");
const { detectPersonsInText, isLikelyChatSender } = require("../src/engine/rules/honorifics.ts");
const { detectCompaniesInText } = require("../src/engine/rules/companyRules.ts");
const { detectLayoutPii } = require("../src/engine/rules/layoutRules.ts");
const { calculateBBoxForRange, applyPadding } = require("../src/engine/redactionEngine.ts");

let passed = 0;

function test(name, run) {
  try {
    run();
    passed++;
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok - ${name}\n${error.stack || error}\n`);
    process.exitCode = 1;
  }
}

function categories(text) {
  return detectPiiInText(text).map((match) => match.category);
}

function line(text, x0, y0, x1, y1) {
  const charWidth = (x1 - x0) / Math.max(1, text.length);
  const alignedSymbols = [...text].map((ch, index) => ({
    text: ch,
    confidence: 95,
    bbox: {
      x0: x0 + charWidth * index,
      y0,
      x1: x0 + charWidth * (index + 1),
      y1
    }
  }));
  return {
    text,
    rawText: text,
    bbox: { x0, y0, x1, y1 },
    words: [],
    symbols: alignedSymbols,
    alignedSymbols,
    confidence: 95
  };
}

test("従来の電話・メール・住所検出を維持する", () => {
  const matches = detectPiiInText("連絡先 090-1234-5678 mail@example.com 東京都千代田区丸の内1-1");
  assert(matches.some((m) => m.category === "phone"));
  assert(matches.some((m) => m.category === "email"));
  assert(matches.some((m) => m.category === "address"));
});

test("全角の電話・メール・郵便番号を検出する", () => {
  const matches = detectPiiInText("電話：０９０－１２３４－５６７８ Email：ａｂｃ＠ｅｘａｍｐｌｅ．ｃｏｍ 郵便番号：１００－０００１");
  assert(matches.some((m) => m.category === "phone"));
  assert(matches.some((m) => m.category === "email"));
  assert(matches.some((m) => m.category === "postal"));
});

test("同一行に複数ある同種ラベルをすべて検出する", () => {
  const matches = detectPiiInText("Email: first@example.com  Email: second@example.net");
  assert.equal(matches.filter((m) => m.category === "email").length, 2);
});

test("1つの空白で続く別カテゴリのラベルを値へ巻き込まない", () => {
  const matches = detectPiiInText("氏名: 山田太郎 Email: taro@example.jp");
  const person = matches.find((m) => m.category === "person");
  assert(person);
  assert.equal(person.matchedText, "山田太郎");
  assert(matches.some((m) => m.category === "email"));
});

test("ラベル値を次の項目までに限定する", () => {
  const matches = detectPiiInText("Password: secret-123  TEL: 090-1234-5678");
  const password = matches.find((m) => m.category === "password");
  assert(password);
  assert.equal(password.matchedText, "secret-123");
});

test("生年月日・口座番号・識別番号をラベル付きで検出する", () => {
  const found = categories("生年月日: 1990/01/02  口座番号: 1234567  社員番号: A-1024");
  assert(found.includes("birth_date"));
  assert(found.includes("bank_account"));
  assert(found.includes("id_number"));
});

test("有効なチェックディジットの個人番号だけをラベルなし検出する", () => {
  assert(categories("123456789018").includes("id_number"));
  assert(!categories("123456789012").includes("id_number"));
});

test("代表的な認証トークンを検出する", () => {
  assert(categories("token=ghp_1234567890ABCDEFGHIJ").includes("secret"));
});

test("既存の人名・会社名規則を維持する", () => {
  assert(detectPersonsInText("山田様へ").some((m) => m.nameOnly === "山田"));
  assert(detectCompaniesInText("株式会社テックラボの山田です").some((m) => m.matchedText.includes("株式会社")));
});

test("別列の氏名ラベルと値を座標で結び付ける", () => {
  const matches = detectLayoutPii([
    line("氏名", 10, 10, 50, 30),
    line("山田太郎", 120, 10, 220, 30)
  ]);
  assert(matches.some((m) => m.category === "person" && m.matchedText === "山田太郎"));
});

test("同一行の値を近い下段の別項目より優先する", () => {
  const matches = detectLayoutPii([
    line("氏名", 10, 10, 50, 30),
    line("山田太郎", 420, 10, 520, 30),
    line("09012345678", 10, 34, 170, 54)
  ]);
  const person = matches.find((m) => m.category === "person");
  assert(person);
  assert.equal(person.matchedText, "山田太郎");
});

test("折り返された住所行を保護対象に含める", () => {
  const matches = detectLayoutPii([
    line("住所", 10, 10, 50, 30),
    line("東京都千代田区丸の内1-1", 10, 35, 260, 55),
    line("サンプルビル101号室", 10, 58, 220, 78)
  ]);
  assert(matches.filter((m) => m.category === "address").length >= 2);
});

test("同一行の同じ文字列でも指定された出現位置へ矩形を置く", () => {
  const repeated = line("山田と山田", 0, 0, 100, 20);
  const first = calculateBBoxForRange(repeated, 0, 2);
  const second = calculateBBoxForRange(repeated, 3, 5);
  assert(first && second);
  assert(second.x > first.x + first.width);
});

test("高解像度文字では安全余白を文字高に応じて確保する", () => {
  const padded = applyPadding({ x: 100, y: 100, width: 80, height: 60 }, 2, 1000, 1000, true);
  assert(padded.x <= 94);
  assert(padded.y <= 96);
  assert(padded.width >= 92);
  assert(padded.height >= 68);
});

test("地名・施設・一般の見出しを人名にしない", () => {
  for (const text of ["山口県", "清水公園", "田中工業", "小林製薬", "資料 作成", "氏名 変更", "お客様", "皆様"]) {
    assert.deepEqual(detectPersonsInText(text), [], text);
  }
});

test("敬称・姓名・列記した名字の検出を維持する", () => {
  for (const text of ["山田 太郎", "山 田 太 郎", "佐々木 葵（Aoi Sasaki）", "先ほど佐藤さんから", "鈴木部長に", "山田・鈴木", "山田です"]) {
    assert(detectPersonsInText(text).length > 0, text);
  }
});

test("操作名を送信者名にせず、未知の名前は送信者文脈を要求する", () => {
  for (const text of ["設定", "ホーム", "Download", "Search", "保存", "画像"]) {
    assert.equal(isLikelyChatSender(text, true), false, text);
  }
  for (const text of ["勅使河原", "alice", "ken_tanaka"]) {
    assert.equal(isLikelyChatSender(text), false, text);
    assert.equal(isLikelyChatSender(text, true), true, text);
  }
});

test("一般の画面名称や法人格単体を会社名にしない", () => {
  for (const text of ["画像処理システム", "通知センター", "開発グループ", "株式会社の設立"]) {
    assert.deepEqual(detectCompaniesInText(text), [], text);
  }
});

test("会社名の末尾を欠かさず検出する", () => {
  assert(detectCompaniesInText("Google LLC").some((match) => match.matchedText === "Google LLC"));
  assert(detectCompaniesInText("トヨタ自動車株式会社").some((match) => match.matchedText === "トヨタ自動車株式会社"));
});

test("名前変更UIとファイル名を氏名として検出しない", () => {
  for (const text of ["名前を変更してください", "Name: Settings", "File Name: document.pdf", "住所変更はこちら"]) {
    assert.deepEqual(detectPiiInText(text), [], text);
  }
  assert(detectPiiInText("氏名: 勅使河原花子").some((match) => match.category === "person"));
});

test("氏名ラベルの横の操作名や電話を人名にしない", () => {
  for (const text of ["保存", "未設定", "09012345678"]) {
    assert.deepEqual(detectLayoutPii([line("氏名", 10, 10, 50, 30), line(text, 100, 10, 240, 30)]), [], text);
  }
  assert(detectLayoutPii([line("氏名", 10, 10, 50, 30), line("勅使河原花子", 100, 10, 240, 30)]).length > 0);
});

test("一般語を含む正しい名は残さず、短い名字に似た一般語を黒塗りしない", () => {
  assert(detectPersonsInText("山田明日香").some((match) => match.matchedText === "山田明日香"));
  assert.deepEqual(detectPersonsInText("原材料"), []);
  for (const text of ["山田はるか", "山田のぞみ", "山田はるかさん", "山田ハルカ", "原れい様"]) {
    assert(detectPersonsInText(text).some((match) => match.matchedText === text), text);
  }
});

test("チャットの挨拶を人名にせず、同じ行の実名を検出する", () => {
  for (const text of ["お疲れ様です", "ご苦労様です", "お世話様です", "おつかれさま", "ごくろうさま", "おせわさま"]) {
    assert.deepEqual(detectPersonsInText(text), [], text);
    const combined = `${text}。山田様に連絡しました。`;
    const matches = detectPersonsInText(combined);
    assert(matches.some((match) => match.matchedText === "山田様"), combined);
    assert(matches.every((match) => match.startIndex > text.length), combined);
  }
});

test("都道府県と会議の日付を住所として黒塗りしない", () => {
  assert(!categories("東京都の会議は2026年10月").includes("address"));
  assert(categories("東京都千代田区丸の内1-2-3").includes("address"));
});

test("カード番号はチェックディジットを確認し、ラベル指定の番号は保持する", () => {
  assert(categories("4111 1111 1111 1111").includes("credit_card"));
  assert(!categories("1234 5678 9012 3456").includes("credit_card"));
  assert(categories("カード番号: 1234 5678 9012 3456").includes("credit_card"));
});

test("装飾のアスタリスクとラベル付きパスワードを区別する", () => {
  assert.deepEqual(detectPiiInText("**** お知らせ ****"), []);
  assert(categories("Password: ****").includes("password"));
});

if (!process.exitCode) {
  process.stdout.write(`\n${passed} regression checks passed.\n`);
}
