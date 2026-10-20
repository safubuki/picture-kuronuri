const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename
  });
  module._compile(compiled.outputText, filename);
};

const {
  detectFacesAndAvatars, detectPhotoAvatarCandidates, evaluatePhotoAvatar
} = require("../src/engine/faceAvatarDetector.ts");

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

function image(width = 400, height = 700) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([238, 241, 245, 255], i);
  return { data, width, height };
}

function drawCircle(img, rect, painter, square = false) {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const nx = (x - rect.x) / rect.width * 2 - 1;
      const ny = (y - rect.y) / rect.height * 2 - 1;
      if (!square && nx * nx + ny * ny > 1) continue;
      img.data.set([...painter(nx, ny, x, y), 255], (y * img.width + x) * 4);
    }
  }
}

function initial(img, rect, color) {
  drawCircle(img, rect, (x, y) => (
    Math.abs(x) < 0.11 || (Math.abs(y) < 0.09 && Math.abs(x) < 0.48)
      ? [255, 255, 255] : color
  ));
}

// 顔の肌・髪・服・背景に階調がある画像を決定論的に合成する。
// これは実写データセットの精度測定ではなく、写真特徴を失わない回帰ケース。
function texturedFace(img, rect, darkSkin = false, square = false) {
  drawCircle(img, rect, (nx, ny, x, y) => {
    const grain = ((x * 17 + y * 29) % 23) - 11;
    const shade = Math.round(25 * (1 - nx) + 12 * ny);
    if ((nx / 0.6) ** 2 + ((ny + 0.08) / 0.75) ** 2 < 1 && ny > -0.6) {
      if ((Math.abs(nx - 0.25) < 0.1 || Math.abs(nx + 0.25) < 0.1) && Math.abs(ny + 0.13) < 0.08)
        return [35 + grain, 28 + grain, 23 + grain];
      if (Math.abs(nx) < 0.3 && Math.abs(ny - 0.4) < 0.055) return [115, 55, 45];
      return darkSkin
        ? [100 + shade + grain, 55 + shade + grain, 30 + shade + grain]
        : [180 + shade + grain, 115 + shade + grain, 80 + shade + grain];
    }
    if (ny < -0.35 || Math.abs(nx) < 0.7 && ny < 0.55)
      return [36 + grain + shade / 3, 28 + grain + shade / 3, 23 + grain + shade / 3];
    return [70 + grain + shade, 110 + grain + shade, 170 + grain + shade];
  }, square);
}

function overlap(a, b) {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = w * h;
  return intersection / (a.width * a.height + b.width * b.height - intersection);
}

function browserStub(img, nativeFaces) {
  let canvases = 0;
  let reads = 0;
  global.document = { createElement() {
    canvases++;
    return { width: 0, height: 0, getContext() {
      return { drawImage() {}, getImageData() { reads++; return { data: img.data }; } };
    } };
  } };
  global.window = nativeFaces ? { FaceDetector: class {
    async detect() { return nativeFaces.map(boundingBox => ({ boundingBox })); }
  } } : {};
  return () => ({ canvases, reads });
}

function sidebarChat(photo = true, avatarX = 148, size = 28, width = 400, lineHeight = 14) {
  const img = image(width);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < 110; x++) img.data.set([45, 48, 62, 255], (y * img.width + x) * 4);
  }
  const avatar = { x: avatarX, y: 170, width: size, height: size };
  if (photo) texturedFace(img, avatar);
  else initial(img, avatar, [245, 158, 11]);
  const textX = avatarX + size + Math.round(lineHeight * 0.7);
  const textRegions = [
    { x: textX, y: 170, width: 80, height: lineHeight },
    { x: textX, y: 196, width: 140, height: lineHeight },
    { x: textX, y: 219, width: 110, height: lineHeight }
  ];
  // OCR の対象となる本文を画素にも描き、文字を写真へ巻き込まないことを確認する。
  for (const text of textRegions) {
    for (let y = text.y; y < text.y + text.height; y++) {
      for (let x = text.x; x < Math.min(img.width, text.x + text.width); x++) {
        if ((x - text.x) % 8 < 4 && y - text.y > 3 && y - text.y < 11)
          img.data.set([30, 30, 35, 255], (y * img.width + x) * 4);
      }
    }
  }
  return { img, avatar, textRegions };
}

async function main() {
  const avatar = { x: 20, y: 160, width: 38, height: 38 };
  await test("青・橙・灰色のイニシャルと単色 UI アイコンを候補にしない", () => {
    const img = image();
    for (const [index, color] of [[59, 130, 246], [245, 158, 11], [100, 100, 100]].entries()) {
      initial(img, { ...avatar, y: avatar.y + index * 100 }, color);
    }
    const results = detectPhotoAvatarCandidates(img.data, img.width, img.height);
    assert.deepEqual(results, []);
  });

  await test("肌色の顔文字・ベタ塗りイラストは色階調条件で除外する", () => {
    const img = image();
    drawCircle(img, avatar, (x, y) =>
      Math.abs(x) < 0.4 && (Math.abs(y - 0.3) < 0.06 || Math.abs(y + 0.25) < 0.08)
        ? [30, 25, 20] : [245, 185, 120]);
    assert.equal(evaluatePhotoAvatar(img.data, img.width, img.height, avatar), 0);
    assert.deepEqual(detectPhotoAvatarCandidates(img.data, img.width, img.height), []);
  });

  await test("写真の階調・肌・暗い髪がある候補を維持する", () => {
    const img = image();
    texturedFace(img, avatar);
    assert(evaluatePhotoAvatar(img.data, img.width, img.height, avatar) > 0);
    const results = detectPhotoAvatarCandidates(img.data, img.width, img.height);
    assert(results.some(item => overlap(item.rect, avatar) > 0.9));
  });

  await test("明暗だけを理由に濃い肌色の候補を落とさない", () => {
    const img = image();
    texturedFace(img, avatar, true);
    assert(evaluatePhotoAvatar(img.data, img.width, img.height, avatar) > 0);
  });

  await test("小さい・大きいアバターと正方形写真を検出できる", () => {
    for (const size of [20, 38, 64]) {
      for (const square of [false, true]) {
        const img = image();
        const target = { ...avatar, width: size, height: size };
        texturedFace(img, target, false, square);
        const results = detectPhotoAvatarCandidates(img.data, img.width, img.height);
        assert(results.some(item => overlap(item.rect, target) > 0.9), `size=${size}, square=${square}`);
      }
    }
  });

  await test("左側に写真がある画像でも右側の写真を探索する", () => {
    const img = image();
    const right = { ...avatar, x: 342, y: 390 };
    texturedFace(img, avatar);
    texturedFace(img, right);
    const results = detectPhotoAvatarCandidates(img.data, img.width, img.height);
    assert(results.some(item => overlap(item.rect, avatar) > 0.9));
    assert(results.some(item => overlap(item.rect, right) > 0.9));
  });

  await test("OCR 本文へ重なる独自の写真推定を自動黒塗りにしない", () => {
    const img = image();
    texturedFace(img, avatar);
    const text = { x: 15, y: 155, width: 70, height: 48 };
    assert.deepEqual(detectPhotoAvatarCandidates(img.data, img.width, img.height, [text]), []);
  });

  await test("サイドバー付きチャットの中央写真を OCR 配置から検出する", () => {
    for (const x of [120, 148, 196]) {
      for (const size of [20, 28, 38]) {
        const { img, avatar, textRegions } = sidebarChat(true, x, size);
        const results = detectPhotoAvatarCandidates(img.data, img.width, img.height, textRegions);
        assert(results.some(item => overlap(item.rect, avatar) > 0.9), `x=${x}, size=${size}`);
      }
    }
  });

  await test("中央列でも単色イニシャルや本文を写真と誤認しない", () => {
    const { img, textRegions } = sidebarChat(false);
    assert.deepEqual(detectPhotoAvatarCandidates(img.data, img.width, img.height, textRegions), []);
  });

  await test("デスクトップの画面幅5%未満の小さい写真を行高から検出する", () => {
    const { img, avatar, textRegions } = sidebarChat(true, 196, 16, 512, 8);
    const results = detectPhotoAvatarCandidates(img.data, img.width, img.height, textRegions);
    assert(results.some(item => overlap(item.rect, avatar) > 0.9));
  });

  await test("中央列の写真特徴が本文に重なる場合は採用しない", () => {
    const { img, avatar, textRegions } = sidebarChat(true);
    assert.deepEqual(detectPhotoAvatarCandidates(img.data, img.width, img.height, [...textRegions, avatar]), []);
  });

  await test("事前座標も画像内容を検証し、単色イニシャルを即採用しない", async () => {
    const img = image();
    initial(img, avatar, [245, 158, 11]);
    const counts = browserStub(img);
    assert.deepEqual(await detectFacesAndAvatars(img, [avatar]), []);
    assert.deepEqual(counts(), { canvases: 1, reads: 1 });
  });

  await test("ネイティブ顔検出は肌色や OCR 重なりを理由に失わない", async () => {
    const img = image();
    browserStub(img, [avatar]);
    const results = await detectFacesAndAvatars(img, undefined, { textRegions: [avatar] });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, "face-native-20-160");
    assert.equal(results[0].confidence, 0.95);
  });

  await test("無効なネイティブ座標を無視し、はみ出しは画像内に収める", async () => {
    const img = image();
    browserStub(img, [
      { x: NaN, y: 50, width: 20, height: 20 },
      { x: 10, y: 50, width: -10, height: 20 },
      { x: -5, y: 50, width: 20, height: 20 }
    ]);
    const results = await detectFacesAndAvatars(img);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].rect, { x: 0, y: 50, width: 15, height: 20 });
  });

  delete global.document;
  delete global.window;
  process.stdout.write(`${passed} face/avatar regression tests passed\n`);
}
module.exports = { image, initial, texturedFace, browserStub, overlap, sidebarChat };
if (require.main === module) {
  main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
}
