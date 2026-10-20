const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const crypto = require("node:crypto");
const ts = require("typescript");

function loadTypeScript(filename, internals = [], overrides = {}) {
  filename = path.resolve(__dirname, filename);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename
  });
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = (name) => Object.hasOwn(overrides, name) ? overrides[name] : originalRequire(name);
  loaded._compile(compiled.outputText + `\nmodule.exports.__test = { ${internals.join(", ")} };`, filename);
  return loaded.exports;
}

require.extensions[".ts"] = (loaded, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename
  });
  loaded._compile(compiled.outputText, filename);
};

const normalization = loadTypeScript("../src/engine/ocrNormalize.ts");
const tesseract = { PSM: { SINGLE_BLOCK: 6, SPARSE_TEXT: 11 }, createWorker: async () => { throw new Error("Unexpected OCR worker"); } };
const { __test: ocr } = loadTypeScript("../src/engine/ocr.ts", ["parseRecognizeData", "scaleOcrGeometry", "buildAlignedLine"], { "tesseract.js": tesseract });

function symbol(text, x0, x1) {
  return { text, confidence: 95, bbox: { x0, y0: 40, x1, y1: 80 } };
}

function recognition(symbols) {
  const text = symbols.map((s) => s.text).join("");
  const bbox = { x0: symbols[0]?.bbox.x0 || 0, y0: 40, x1: symbols.at(-1)?.bbox.x1 || 0, y1: 80 };
  return { text, blocks: [{ paragraphs: [{ lines: [{ text, bbox, confidence: 95, words: [{ text, bbox, confidence: 95, symbols }] }] }] }] };
}

let passed = 0;
async function test(name, run) {
  try {
    await run();
    passed++;
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok - ${name}\n${error.stack || error}\n`);
    process.exitCode = 1;
  }
}

(async () => {
  for (const scale of [2, 0.5]) {
    await test(`OCR 縮尺 ${scale} で共有する文字矩形を一度だけ変換する`, () => {
      const parsed = ocr.parseRecognizeData(recognition([symbol("山", 100, 140), symbol("田", 140, 180)]));
      ocr.scaleOcrGeometry(parsed.lines, parsed.symbols, scale);
      const expected = { x0: 100 / scale, y0: 40 / scale, x1: 140 / scale, y1: 80 / scale };
      assert.deepEqual(parsed.symbols[0].bbox, expected);
      assert.deepEqual(parsed.lines[0].symbols[0].bbox, expected);
      assert.deepEqual(parsed.lines[0].alignedSymbols[0].bbox, expected);
    });
  }

  await test("絵文字の後の氏名を UTF-16 の元位置へ戻す", () => {
    const raw = "📩 氏名：𠮷 田 太 郎 Email：ａｂｃ@example.jp";
    const normalized = normalization.normalizeOcrText(raw);
    assert.equal(normalized.text, "📩 氏名:𠮷田太郎 Email:abc@example.jp");
    assert.equal(normalized.indexMap.length, normalized.text.length);
    const start = normalized.text.indexOf("𠮷田太郎");
    const range = normalization.mapNormRangeToOriginal(normalized.indexMap, start, start + "𠮷田太郎".length);
    assert.equal(raw.slice(range.start, range.end), "𠮷 田 太 郎");
    const email = normalized.text.indexOf("abc@example.jp");
    assert.equal(raw.slice(normalized.indexMap[email]), "ａｂｃ@example.jp");
  });

  await test("絵文字・拡張漢字の後も文字ごとの実矩形を保持する", () => {
    const symbols = [symbol("📩", 0, 40), symbol("𠮷", 40, 80), symbol("田", 80, 120)];
    const line = ocr.buildAlignedLine("📩𠮷田", { x0: 0, y0: 40, x1: 120, y1: 80 }, [], symbols, 95);
    assert.equal(line.alignedSymbols.length, line.text.length);
    assert.equal(line.alignedSymbols.map((s) => s.text).join(""), line.text);
    assert.deepEqual(line.alignedSymbols[0].bbox, symbols[0].bbox);
    assert.deepEqual(line.alignedSymbols[1].bbox, symbols[0].bbox);
    assert.deepEqual(line.alignedSymbols[2].bbox, symbols[1].bbox);
    assert.deepEqual(line.alignedSymbols[4].bbox, symbols[2].bbox);
  });

  await test("日本語の句読点前後の空白除去で矩形をずらさない", () => {
    const symbols = [symbol("山", 0, 20), symbol(" ", 20, 30), symbol("、", 30, 40), symbol(" ", 40, 50), symbol("田", 50, 70)];
    const line = ocr.buildAlignedLine("山 、 田", { x0: 0, y0: 40, x1: 70, y1: 80 }, [], symbols, 95);
    assert.equal(line.text, "山、田");
    assert.deepEqual(line.alignedSymbols[2].bbox, symbols[4].bbox);
  });

  await test("英単語間の空白と末尾空白を維持して連続空白をまとめる", () => {
    const raw = "  John\t \tDoe  ";
    const normalized = normalization.normalizeOcrText(raw);
    assert.equal(normalized.text, "John Doe ");
    assert.deepEqual(normalized.indexMap, [2, 3, 4, 5, 6, 9, 10, 11, 12]);
  });

  await test("通常 OCR は 1 回、低信頼 OCR の再確認は画像解析を再利用する", async () => {
    const analysis = { estimatedLineHeight: 20, isLikelyScreenPhoto: false, isDarkBackground: false, contrast: 30, colorFringe: 0 };
    const primaryCanvas = {};
    const alternativeCanvas = {};
    const responses = [{ data: {} }, { data: recognition([symbol("山", 100, 140), symbol("田", 140, 180)]) }];
    const calls = [];
    const worker = { setParameters: async (parameters) => calls.push(parameters), terminate: async () => {}, recognize: async (input) => { calls.push(input); return responses.shift(); } };
    const engine = loadTypeScript("../src/engine/ocr.ts", [], {
      "tesseract.js": { ...tesseract, createWorker: async () => worker },
      "./ocrPreprocess": {
        preprocessForOcr: () => ({ canvas: primaryCanvas, scale: 2, analysis }),
        preprocessForOcrAlternative: (_source, reused) => {
          assert.equal(reused, analysis);
          return { canvas: alternativeCanvas, scale: 2, analysis };
        }
      }
    });
    const retried = await engine.runOcr({ width: 100, height: 100 });
    assert.equal(retried.status, "ok");
    assert.deepEqual(retried.symbols[0].bbox, { x0: 50, y0: 20, x1: 70, y1: 40 });
    assert.equal(calls.filter((value) => value === primaryCanvas || value === alternativeCanvas).length, 2);
    assert.equal(calls.at(-1).tessedit_pageseg_mode, tesseract.PSM.SINGLE_BLOCK);
    responses.push({ data: recognition([symbol("山", 100, 140), symbol("田", 140, 180)]) });
    calls.length = 0;
    await engine.runOcr({ width: 100, height: 100 });
    assert.equal(calls.filter((value) => value === primaryCanvas || value === alternativeCanvas).length, 1);
  });

  await test("最終クリーニング後も残した文字へ元の矩形を対応させる", async () => {
    const symbols = [symbol("山", 0, 20), symbol(" ", 20, 30), symbol("\v", 30, 40), symbol(" ", 40, 50), symbol("田", 50, 70)];
    const worker = { setParameters: async () => {}, terminate: async () => {}, recognize: async () => ({ data: recognition(symbols) }) };
    const engine = loadTypeScript("../src/engine/ocr.ts", [], { "tesseract.js": { ...tesseract, createWorker: async () => worker } });
    const result = await engine.runOcr("image");
    assert.equal(result.lines[0].text, "山田");
    assert.equal(result.lines[0].alignedSymbols.length, 2);
    assert.deepEqual(result.lines[0].alignedSymbols[1].bbox, symbols.at(-1).bbox);
  });

  await test("高速化した前処理は各サイズ・設定で従来と同じ全画素を生成する", () => {
    const { __test: filters } = loadTypeScript("../src/engine/ocrPreprocess.ts", ["gaussianBlurSeparable", "claheGray"]);
    const hash = crypto.createHash("sha256");
    for (const [width, height] of [[1, 1], [3, 5], [31, 23], [97, 61], [480, 320]]) {
      const input = new Uint8Array(width * height);
      let seed = 7321;
      for (let index = 0; index < input.length; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        input[index] = seed >>> 24;
      }
      for (const sigma of [0.4, 0.55, 0.65, 0.75]) hash.update(filters.gaussianBlurSeparable(input, width, height, sigma));
      for (const [tiles, clip] of [[6, 1.8], [8, 2.2], [8, 2.3]]) hash.update(filters.claheGray(input, width, height, tiles, tiles, clip));
    }
    // 変更前の実装から取得した 35 通りの画素列のチェックサム。
    assert.equal(hash.digest("hex"), "8963229ab207deafc56df146508ba80b3810acbe3bb4fc126bd9221a5672192f");
  });

  await test("絵文字の後の氏名・メールだけを伏字化し、後続の文章を残す", () => {
    const { generateRedactedText } = loadTypeScript("../src/utils/redactedTextExport.ts");
    for (const [target, suffix, type, label, placeholder] of [
      ["山田", "と会話", "person", "人名", "[人名]"],
      ["abc@example.jp", "へ連絡", "pii", "メール", "[メールアドレス]"]
    ]) {
      const text = "📩" + target + suffix;
      const chars = [...text];
      const symbols = chars.map((char, index) => symbol(char, index * 20, (index + 1) * 20));
      const line = ocr.buildAlignedLine(text, { x0: 0, y0: 40, x1: chars.length * 20, y1: 80 }, [], symbols, 95);
      const exported = generateRedactedText({ fullText: text, lines: [line], symbols, scale: 1 }, [{
        id: "target", type, label, text: target, enabled: true, reason: "test", confidence: 1,
        rect: { x: 20, y: 40, width: target.length * 20, height: 40 }
      }]);
      assert.equal(exported.redactedText, `📩 ${placeholder}${suffix}`);
      assert.equal(exported.stats.personCount + exported.stats.piiCount, 1);
    }
  });

  await test("手動矩形が拡張漢字の片側だけを覆っても文字を分断しない", () => {
    const { generateRedactedText } = loadTypeScript("../src/utils/redactedTextExport.ts");
    const text = "𠮷田";
    const line = { text, rawText: text, bbox: { x0: 0, y0: 40, x1: 60, y1: 80 }, words: [], symbols: [], alignedSymbols: [], confidence: 95 };
    const exported = generateRedactedText({ fullText: text, lines: [line], symbols: [], scale: 1 }, [{
      id: "manual", type: "person", label: "人名", enabled: true, isManual: true, reason: "test", confidence: 1,
      rect: { x: 0, y: 40, width: 19, height: 40 }
    }]);
    assert.equal(exported.redactedText, "[人名]田");
  });

  if (!process.exitCode) process.stdout.write(`\n${passed} OCR regression checks passed.\n`);
})();
