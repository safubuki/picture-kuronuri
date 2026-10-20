const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  fileName: filename
}).outputText, filename);

const { rectsShareRedactionLine, extendRectOnSameLine } = require("../src/engine/manualStroke.ts");

const base = { x: 10, y: 100, width: 80, height: 20 };

assert.equal(
  rectsShareRedactionLine(base, { x: 88, y: 100, width: 18, height: 20 }),
  true,
  "隣へ1文字ぶん重ねたストロークは同じ行"
);

assert.equal(
  rectsShareRedactionLine(base, { x: 102, y: 102, width: 16, height: 18 }),
  true,
  "1文字ぶんの隙間でも同じ行として伸ばせる"
);

const extended = extendRectOnSameLine(base, { x: 102, y: 98, width: 16, height: 24 });
assert.deepEqual(extended, { x: 10, y: 98, width: 108, height: 24 });

assert.equal(
  rectsShareRedactionLine(base, { x: 220, y: 100, width: 40, height: 20 }),
  false,
  "同じ高さでも大きく離れた区間は別の黒塗り"
);

assert.equal(
  rectsShareRedactionLine(base, { x: 10, y: 160, width: 40, height: 20 }),
  false,
  "別の行は結合しない"
);

assert.equal(
  rectsShareRedactionLine(base, { x: 10, y: 90, width: 40, height: 80 }),
  false,
  "複数行を囲む大きな矩形は既存の一行に吸収しない"
);

console.log("manual stroke regression ok");
