const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: filename
}).outputText, filename);
const { prepareSearchText, findExactEntityRanges } = require("../src/engine/textMatching.ts");
let llmEnabled = false;
global.localStorage = { getItem: () => String(llmEnabled) };
let llmImports = 0;
let llmCalls = 0;
let lastLlmSignal;
let llmExtract = async () => [];
const llmFilename = path.resolve(__dirname, "../src/engine/llmRedaction.ts");
const llmModule = new Module(llmFilename, module);
llmModule.filename = llmFilename;
llmModule.paths = Module._nodeModulePaths(path.dirname(llmFilename));
const llmOriginalRequire = llmModule.require.bind(llmModule);
llmModule.require = (request) => {
  if (request === "./localLlm") {
    llmImports++;
    return { extractRedactionEntitiesWithLlm: async (lines, progress, options) => {
      llmCalls++;
      lastLlmSignal = options.signal;
      return llmExtract(lines, progress, options);
    } };
  }
  return llmOriginalRequire(request);
};
require.extensions[".ts"](llmModule, llmFilename);
let faceCalls = 0;
let snapCalls = 0;
let lastTextRegions;
const filename = path.resolve(__dirname, "../src/engine/redactionEngine.ts");
const engineModule = new Module(filename, module);
engineModule.filename = filename;
engineModule.paths = Module._nodeModulePaths(path.dirname(filename));
const originalRequire = engineModule.require.bind(engineModule);
engineModule.require = (request) => {
  if (request === "./llmRedaction") return llmModule.exports;
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
  const noPhotos = { ...DEFAULT_FILTER_OPTIONS, detectFaces: false, detectAvatars: false };
  await test("文脈AIがOFFならモデルを読み込まずルール判定のみを返す", async () => {
    llmEnabled = false;
    const beforeImports = llmImports;
    const beforeCalls = llmCalls;
    const result = await analyzeImageForRedaction(new HTMLImageElement(), noPhotos, undefined, ocr([line("確認をお願いします")]));
    assert.equal(result.llmAnalysis.status, "disabled");
    assert.equal(llmImports, beforeImports);
    assert.equal(llmCalls, beforeCalls);
  });
  await test("文脈AIの指定行にだけ追加し、同じ語の別行へ伝播しない", async () => {
    llmEnabled = true;
    llmExtract = async () => [{ lineIndex: 1, text: "Orion", type: "confidential" }];
    const result = await analyzeImageForRedaction(new HTMLImageElement(), noPhotos, undefined,
      ocr([line("Orionは天体です", 100, 50), line("📩 社外秘: Orion / Orion", 180, 420)]));
    const added = result.boxes.filter((b) => b.id.startsWith("llm-"));
    assert.equal(added.length, 2);
    assert(added.every((b) => b.type === "pii" && b.rect.y === 179));
    // 1文字10px。「📩」はUTF-16で2文字ぶんなので、1つ目の Orion は8文字目。左右の余白は3px。
    const text = "📩 社外秘: Orion / Orion";
    assert.equal(added[0].rect.x, 420 + text.indexOf("Orion") * 10 - 3);
    assert.equal(added[1].rect.x, 420 + text.lastIndexOf("Orion") * 10 - 3);
    assert.equal(result.llmAnalysis.status, "applied");
    assert.equal(result.llmAnalysis.addedBoxes, 2);
  });
  await test("原文にない名称、空白正規化だけで一致する名称、無効な行番号を拒否する", async () => {
    llmExtract = async () => [
      { lineIndex: 0, text: "Orion", type: "confidential" },
      { lineIndex: 1, text: "Or ion", type: "confidential" },
      { lineIndex: 8, text: "Orion", type: "confidential" },
      { lineIndex: 0, text: "生成された会社", type: "company" }
    ];
    const result = await analyzeImageForRedaction(new HTMLImageElement(), noPhotos, undefined,
      ocr([line("社外秘: Or ion"), line("本文の連絡です", 150)]));
    assert(!result.boxes.some((b) => b.id.startsWith("llm-")));
    assert.equal(result.llmAnalysis.status, "no_additions");
  });
  await test("AI追加も人名・会社・連絡先フィルターを守り、同じOCRの抽出結果は共通再利用する", async () => {
    const text = ocr([line("aliceから連絡", 100), line("Acmeに連絡", 150), line("社外秘: Orion", 200)]);
    llmExtract = async () => [
      { lineIndex: 0, text: "alice", type: "person" },
      { lineIndex: 1, text: "Acme", type: "company" },
      { lineIndex: 2, text: "Orion", type: "confidential" }
    ];
    const before = llmCalls;
    const first = await analyzeImageForRedaction(new HTMLImageElement(), { ...noPhotos, detectPersons: false, detectPii: false }, undefined, text);
    assert.deepEqual(first.boxes.filter((b) => b.id.startsWith("llm-")).map((b) => b.type), ["company"]);
    const second = await analyzeImageForRedaction(new HTMLImageElement(), { ...noPhotos, detectCompanies: false, padding: 5 }, undefined, text);
    assert.deepEqual(second.boxes.filter((b) => b.id.startsWith("llm-")).map((b) => b.type).sort(), ["person", "pii"]);
    assert.equal(llmCalls - before, 1);
    assert.equal(second.llmAnalysis.cached, true);
    assert.equal(first.llmAnalysis.cached, false);
  });
  await test("既存のルール枠に収まるAI候補は重複追加に数えない", async () => {
    llmExtract = async () => [{ lineIndex: 0, text: "taro@example.jp", type: "pii" }];
    const result = await analyzeImageForRedaction(new HTMLImageElement(), noPhotos, undefined, ocr([line("Email: taro@example.jp")]));
    assert.equal(result.boxes.length, 1);
    assert.equal(result.llmAnalysis.addedBoxes, 0);
    assert.equal(result.llmAnalysis.status, "no_additions");
  });
  await test("同じOCRの並行解析は同じ推論を共有し、本文変更では再実行する", async () => {
    const text = ocr([line("社外秘: Orion")]);
    let resolve;
    llmExtract = async () => new Promise((done) => { resolve = done; });
    const before = llmCalls;
    const first = analyzeImageForRedaction(new HTMLImageElement(), noPhotos, undefined, text);
    const second = analyzeImageForRedaction(new HTMLImageElement(), noPhotos, undefined, text);
    await new Promise((done) => setImmediate(done));
    resolve([{ lineIndex: 0, text: "Orion", type: "confidential" }]);
    const results = await Promise.all([first, second]);
    assert.equal(llmCalls - before, 1);
    assert.deepEqual(results.map((r) => r.llmAnalysis.cached), [false, true]);
    text.lines[0] = line("社外秘: Nova");
    llmExtract = async () => [{ lineIndex: 0, text: "Nova", type: "confidential" }];
    const changed = await analyzeImageForRedaction(new HTMLImageElement(), noPhotos, undefined, text);
    assert.equal(llmCalls - before, 2);
    assert.equal(changed.llmAnalysis.cached, false);
    assert(changed.boxes.some((b) => b.text === "Nova"));
  });
  await test("文脈AI失敗時はルール枠を保持し、失敗結果をキャッシュせず再試行する", async () => {
    const text = ocr([line("Email: taro@example.jp")]);
    llmExtract = async () => { throw new Error("fixture inference failure"); };
    const before = llmCalls;
    const first = await analyzeImageForRedaction(new HTMLImageElement(), noPhotos, undefined, text);
    assert.equal(first.llmAnalysis.status, "failed");
    assert(first.boxes.some((b) => b.text === "taro@example.jp"));
    llmExtract = async () => [];
    const second = await analyzeImageForRedaction(new HTMLImageElement(), noPhotos, undefined, text);
    assert.equal(second.llmAnalysis.status, "no_additions");
    assert.equal(llmCalls - before, 2);
  });
  await test("時間超過でAbortSignalを停止し、ルール枠と次回の再試行を維持する", async () => {
    const text = ocr([line("Email: taro@example.jp")]);
    const nativeSetTimeout = global.setTimeout;
    global.setTimeout = (callback, delay, ...args) => nativeSetTimeout(callback, delay === 15000 ? 5 : delay, ...args);
    llmExtract = async (_lines, _progress, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("fixture aborted", "AbortError")), { once: true });
    });
    try {
      const result = await analyzeImageForRedaction(new HTMLImageElement(), noPhotos, undefined, text);
      assert.equal(result.llmAnalysis.status, "timeout");
      assert.equal(lastLlmSignal.aborted, true);
      assert(result.boxes.some((b) => b.text === "taro@example.jp"));
    } finally { global.setTimeout = nativeSetTimeout; }
    llmExtract = async () => [];
    const second = await analyzeImageForRedaction(new HTMLImageElement(), noPhotos, undefined, text);
    assert.equal(second.llmAnalysis.status, "no_additions");
    assert.equal(second.llmAnalysis.cached, false);
  });
  await test("長いOCRは最大2バッチ・40行・1800文字に制限し、対象外の行は採用しない", async () => {
    const batches = [];
    llmExtract = async (lines) => { batches.push(lines); return [{ lineIndex: 49, text: "Orion", type: "confidential" }]; };
    const result = await analyzeImageForRedaction(new HTMLImageElement(), noPhotos, undefined,
      ocr(Array.from({ length: 50 }, (_, i) => line("社外秘: Orion / " + "長い本文".repeat(40), 25 * i))));
    assert.equal(batches.length, 2);
    assert(batches.flat().length <= 40);
    assert(batches.flat().reduce((n, item) => n + item.text.length, 0) <= 1800);
    assert(batches.every((batch) => batch.length <= 20 && batch.reduce((n, item) => n + item.text.length, 0) <= 900));
    assert.equal(result.llmAnalysis.totalLines, 50);
    assert.equal(result.llmAnalysis.analyzedLines, batches.flat().length);
    assert(!result.boxes.some((b) => b.id.startsWith("llm-")));
  });
  llmEnabled = false;
  if (!process.exitCode) process.stdout.write(`\n${passed} redaction regression checks passed.\n`);
})();
