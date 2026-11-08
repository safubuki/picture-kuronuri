const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: filename
}).outputText, filename);
const { prepareSearchText, findExactEntityRanges } = require("../src/engine/textMatching.ts");
let faceCalls = 0;
let snapCalls = 0;
let lastTextRegions;
const filename = path.resolve(__dirname, "../src/engine/redactionEngine.ts");
const engineModule = new Module(filename, module);
engineModule.filename = filename;
engineModule.paths = Module._nodeModulePaths(path.dirname(filename));
const originalRequire = engineModule.require.bind(engineModule);
engineModule.require = (request) => {
  if (request === "./ocr") return { runOcr: async () => { throw new Error("preloaded OCR expected"); } };
  if (request === "./faceAvatarDetector") return { detectFacesAndAvatars: async (_source, _hints, options) => {
    faceCalls++;
    lastTextRegions = options.textRegions;
    return [];
  }};
  if (request === "./inkSnap") return { snapBoxesToInk: () => { snapCalls++; } };
  return originalRequire(request);
};
require.extensions[".ts"](engineModule, filename);
const { analyzeImageForRedaction, calculateBBoxForRange, removeDuplicateBoxes, hasChatSenderContext, DEFAULT_FILTER_OPTIONS } = engineModule.exports;

function line(text, y = 100, x = 100) {
  const bbox = { x0: x, y0: y, x1: x + text.length * 10, y1: y + 20 };
  const symbols = Array.from({ length: text.length }, (_, index) => ({ text: text[index], confidence: 95,
    bbox: { x0: x + index * 10, y0: y, x1: x + (index + 1) * 10, y1: y + 20 } }));
  return { text, rawText: text, bbox, symbols, alignedSymbols: symbols, words: [], confidence: 95 };
}
function ocr(lines) { return { fullText: lines.map((l) => l.text).join("\n"), lines, symbols: lines.flatMap((l) => l.symbols), scale: 1, status: "ok" }; }
function box(id, rect, type = "person") { return { id, rect, type, label: type, reason: "test", enabled: true }; }
global.HTMLImageElement = class { width = 800; height = 1200; src = "fixture"; };
let passed = 0;
async function test(name, run) {
  try { await run(); passed++; process.stdout.write(`ok - ${name}\n`); }
  catch (error) { process.stderr.write(`not ok - ${name}\n${error.stack}\n`); process.exitCode = 1; }
}

(async () => {
  await test("文書内伝播は同名のみで、1文字違いや地名へ広げない", () => {
    for (const raw of ["山田次郎", "山田太郎町", "田山田太郎", "山田町"]) {
      const name = raw === "山田町" ? "山田" : "山田太郎";
      assert.deepEqual(findExactEntityRanges(raw, prepareSearchText(raw), prepareSearchText(name).text, "person"), []);
    }
    const raw = "📩 山 田 太 郎に相談、山田太郎へ連絡";
    const matches = findExactEntityRanges(raw, prepareSearchText(raw), prepareSearchText("山田太郎").text, "person");
    assert.deepEqual(matches.map((m) => m.matchedText), ["山 田 太 郎", "山田太郎"]);
  });
  await test("会社の英字名称を別の単語へ部分一致させない", () => {
    assert.deepEqual(findExactEntityRanges("ABC Incidental", prepareSearchText("ABC Incidental"), prepareSearchText("ABC Inc").text, "company"), []);
    assert.equal(findExactEntityRanges("ＡＢＣ Ｉｎｃ", prepareSearchText("ＡＢＣ Ｉｎｃ"), prepareSearchText("ABC Inc").text, "company").length, 1);
  });
  await test("1単語が行全体でも名前の部分だけを黒塗り座標にする", () => {
    const value = line("内容山田連絡");
    value.symbols = [];
    value.alignedSymbols = [];
    value.words = [{ text: value.text, bbox: value.bbox, confidence: 90 }];
    assert.deepEqual(calculateBBoxForRange(value, 2, 4), { x: 120, y: 100, width: 20, height: 20 });
  });
  await test("不整合な文字配列の別位置へ黒塗りを置かない", () => {
    const value = line("内容山田連絡");
    value.alignedSymbols = [];
    value.symbols = [{ text: "山田", bbox: { x0: 400, y0: 100, x1: 420, y1: 120 }, confidence: 90 }];
    const rect = calculateBBoxForRange(value, 4, 6);
    assert.equal(rect.x, 140);
    assert.equal(rect.width, 20);
  });
  await test("別行の部分交差や写真と文字を大きな外接矩形へ結合しない", () => {
    const a = box("a", { x: 0, y: 0, width: 100, height: 20 });
    const b = box("b", { x: 60, y: 10, width: 100, height: 20 });
    assert.equal(removeDuplicateBoxes([a, b]).length, 2);
    assert.equal(removeDuplicateBoxes([a, box("photo", { x: 0, y: 0, width: 80, height: 80 }, "face")]).length, 2);
    assert.equal(removeDuplicateBoxes([a, box("inside", { x: 10, y: 0, width: 30, height: 20 })]).length, 1);
  });
  await test("送信者推定は時刻と直下の本文を要求し、時刻だけでは判定しない", () => {
    const sender = line("alice 10:24", 100);
    assert.equal(hasChatSenderContext(sender, [sender], []), false);
    assert.equal(hasChatSenderContext(sender, [sender, line("本文の連絡です", 125)], []), true);
    assert.equal(hasChatSenderContext(line("設定"), [line("設定"), line("本文の連絡です", 125)], []), false);
  });
  await test("一般の見出しを残し、氏名・連絡先の検出を維持する", async () => {
    const result = await analyzeImageForRedaction(new HTMLImageElement(), { ...DEFAULT_FILTER_OPTIONS, detectFaces: false, detectAvatars: false }, undefined,
      ocr([line("設定"), line("資料 作成", 150), line("山口県", 200), line("氏名: 山田太郎", 250), line("Email: taro@example.jp", 300)]));
    assert(result.boxes.some((b) => b.type === "person" && b.text === "山田太郎"));
    assert(result.boxes.some((b) => b.type === "pii" && b.text === "taro@example.jp"));
    assert(result.boxes.every((b) => b.rect.y >= 245));
  });
  await test("人名スイッチが無効ならPII内の氏名も黒塗りしない", async () => {
    const result = await analyzeImageForRedaction(new HTMLImageElement(), { ...DEFAULT_FILTER_OPTIONS, detectPersons: false, detectFaces: false, detectAvatars: false }, undefined,
      ocr([line("氏名: 山田太郎"), line("Email: taro@example.jp", 150)]));
    assert(!result.boxes.some((b) => b.type === "person"));
    assert(result.boxes.some((b) => b.type === "pii"));
  });
  await test("連絡先スイッチが無効でも氏名ラベルの辞書外氏名は保護する", async () => {
    const result = await analyzeImageForRedaction(new HTMLImageElement(), { ...DEFAULT_FILTER_OPTIONS, detectPii: false, detectFaces: false, detectAvatars: false }, undefined,
      ocr([line("氏名: 勅使河原花子"), line("Email: taro@example.jp", 150)]));
    assert(result.boxes.some((b) => b.type === "person" && b.text === "勅使河原花子"));
    assert(!result.boxes.some((b) => b.type === "pii"));
  });
  await test("同じ画像の再解析は写真探索を再利用し、実OCRの位置補正を毎回維持する", async () => {
    faceCalls = 0;
    snapCalls = 0;
    const image = new HTMLImageElement();
    const text = ocr([line("山田様", 100), line("山田様", 150)]);
    const first = await analyzeImageForRedaction(image, DEFAULT_FILTER_OPTIONS, undefined, text);
    const second = await analyzeImageForRedaction(image, { ...DEFAULT_FILTER_OPTIONS, padding: 5 }, undefined, text);
    assert.equal(faceCalls, 1);
    assert.equal(snapCalls, 2);
    assert.equal(lastTextRegions.length, 2);
    assert.equal(new Set(first.boxes.map((b) => b.id)).size, first.boxes.length);
    assert(second.boxes[0].rect.width > first.boxes[0].rect.width);
    await analyzeImageForRedaction(new HTMLImageElement(), DEFAULT_FILTER_OPTIONS, undefined, text);
    assert.equal(faceCalls, 2);
    image.src = "changed";
    await analyzeImageForRedaction(image, DEFAULT_FILTER_OPTIONS, undefined, text);
    assert.equal(faceCalls, 3);
  });
  if (!process.exitCode) process.stdout.write(`\n${passed} redaction regression checks passed.\n`);
})();
