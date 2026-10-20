/**
 * node tests/face-avatar-benchmark.cjs <baseline git ref>
 * 同一の合成画像で旧・新の CPU 処理を比較する。Canvas 自体はモック。
 * 実写精度・Canvas 描画時間・OCR を含むアプリ全体の速度は測定しない。
 */
const cp = require("node:child_process");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const { image, initial, texturedFace, browserStub, sidebarChat } = require("./face-avatar-regression.cjs");
const updated = require("../src/engine/faceAvatarDetector.ts");

const baselineRef = process.argv[2] || "HEAD";
const cwd = path.resolve(__dirname, "..");
const legacySource = cp.execFileSync("git", [
  "-c", `safe.directory=${cwd.replaceAll("\\", "/")}`,
  "show", `${baselineRef}:src/engine/faceAvatarDetector.ts`
], { cwd, encoding: "utf8" });
const legacy = new Module(path.join(__dirname, "legacy-avatar-benchmark.cjs"));
legacy.filename = legacy.id;
legacy.paths = Module._nodeModulePaths(__dirname);
legacy._compile(ts.transpileModule(legacySource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText, legacy.filename);

const avatar = { x: 20, y: 160, width: 38, height: 38 };
const negative = image();
[[59, 130, 246], [245, 158, 11], [100, 100, 100]].forEach((color, index) =>
  initial(negative, { ...avatar, y: avatar.y + index * 100 }, color));
const positive = image();
texturedFace(positive, avatar);
texturedFace(positive, { ...avatar, x: 342, y: 390 });

async function measure(label, detector, img, textRegions) {
  const counts = browserStub(img);
  for (let i = 0; i < 5; i++) await detector(img, undefined, { textRegions });
  const timings = [];
  let detected;
  for (let i = 0; i < 25; i++) {
    const start = performance.now();
    detected = await detector(img, undefined, { textRegions });
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  const allocationCounts = counts();
  return {
    label,
    medianMs: +timings[12].toFixed(3),
    p90Ms: +timings[22].toFixed(3),
    detected: detected.length,
    canvasesPerCall: allocationCounts.canvases / 30,
    readsPerCall: allocationCounts.reads / 30,
    rects: detected.map(item => item.rect)
  };
}

(async () => {
  process.stdout.write(`baseline=${baselineRef}; synthetic 400x700; Canvas mocked; 5 warmups + 25 samples\n`);
  const sidebarPhoto = sidebarChat(true);
  const sidebarInitial = sidebarChat(false);
  for (const [label, img, textRegions] of [
    ["initial-icons", negative], ["photo-features-left-and-right", positive], ["blank", image()],
    ["sidebar-photo-central", sidebarPhoto.img, sidebarPhoto.textRegions],
    ["sidebar-initial-central", sidebarInitial.img, sidebarInitial.textRegions]
  ]) {
    const before = await measure(`baseline-${label}`, legacy.exports.detectFacesAndAvatars, img, textRegions);
    const after = await measure(`updated-${label}`, updated.detectFacesAndAvatars, img, textRegions);
    process.stdout.write(`${JSON.stringify(before)}\n${JSON.stringify(after)}\n`);
    process.stdout.write(`CPU speed ratio: ${(before.medianMs / after.medianMs).toFixed(2)}x\n`);
  }
  delete global.document;
  delete global.window;
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
