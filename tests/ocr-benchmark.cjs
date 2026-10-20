const fs = require("node:fs");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const baselineRef = process.argv[2] || "HEAD";

function load(source, names) {
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled + `\nmodule.exports.__test = { ${names.join(",")} };`)(() => ({}), module, module.exports);
  return module.exports.__test;
}
function old(filename) {
  return execFileSync("git", ["-c", "safe.directory=C:/git_home/picture-kuronuri", "show", `${baselineRef}:${filename}`], { encoding: "utf8" });
}
const filename = "src/engine/ocrPreprocess.ts";
const names = ["claheGray", "gaussianBlurSeparable"];
const before = load(old(filename), names);
const after = load(fs.readFileSync(filename, "utf8"), names);
function pixels(w, h) {
  const data = new Uint8Array(w * h);
  let seed = 7321;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = seed >>> 24;
  }
  return data;
}
const hash = crypto.createHash("sha256");
for (const [w, h] of [[1, 1], [3, 5], [31, 23], [97, 61], [480, 320]]) {
  const input = pixels(w, h);
  for (const sigma of [0.4, 0.55, 0.65, 0.75]) {
    const expected = before.gaussianBlurSeparable(input, w, h, sigma);
    assert.deepEqual(after.gaussianBlurSeparable(input, w, h, sigma), expected);
    hash.update(expected);
  }
  for (const [tiles, clip] of [[6, 1.8], [8, 2.2], [8, 2.3]]) {
    const expected = before.claheGray(input, w, h, tiles, tiles, clip);
    assert.deepEqual(after.claheGray(input, w, h, tiles, tiles, clip), expected);
    hash.update(expected);
  }
}
console.log("Exact pixel match, golden fingerprint:", hash.digest("hex"));
console.log("Baseline git ref:", baselineRef);
const w = 2000, h = 1500;
const input = pixels(w, h);
function timings(call) {
  call(); call();
  const samples = [];
  for (let i = 0; i < 7; i++) {
    const started = performance.now();
    call();
    samples.push(performance.now() - started);
  }
  return Number(samples.sort((a,b) => a - b)[3].toFixed(2));
}
function comparison(oldCall, newCall) {
  for (let i = 0; i < 4; i++) { oldCall(); newCall(); }
  const oldSamples = [], newSamples = [];
  function measure(call, samples) {
    const started = performance.now();
    call();
    samples.push(performance.now() - started);
  }
  for (let i = 0; i < 11; i++) {
    if (i % 2) { measure(newCall, newSamples); measure(oldCall, oldSamples); }
    else { measure(oldCall, oldSamples); measure(newCall, newSamples); }
  }
  return [oldSamples, newSamples].map((samples) => Number(samples.sort((a,b) => a - b)[5].toFixed(2)));
}
for (const [name, args] of [["claheGray", [input, w, h, 6, 6, 1.8]], ["gaussianBlurSeparable", [input, w, h, 0.55]]]) {
  const [oldMs, newMs] = comparison(() => before[name](...args), () => after[name](...args));
  console.log(JSON.stringify({ name, width: w, height: h, oldMs, newMs, reduction: `${((1-newMs/oldMs)*100).toFixed(1)}%` }));
}
const normBefore = load(old("src/engine/ocrNormalize.ts"), ["normalizeOcrText"]);
const normAfter = load(fs.readFileSync("src/engine/ocrNormalize.ts", "utf8"), ["normalizeOcrText"]);
const whitespace = "山" + " ".repeat(10000) + "田";
assert.deepEqual(normBefore.normalizeOcrText(whitespace), normAfter.normalizeOcrText(whitespace));
console.log(JSON.stringify({ name: "normalizeOcrText", whitespace: 10000, oldMs: timings(() => normBefore.normalizeOcrText(whitespace)), newMs: timings(() => normAfter.normalizeOcrText(whitespace)) }));
