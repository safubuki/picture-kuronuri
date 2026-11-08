const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  fileName: filename
}).outputText, filename);

const { StateManager } = require("../src/state/appState.ts");
const { findAnnotationAt, isAnnotationLargeEnough } = require("../src/engine/annotations.ts");

// ---- 黒塗りの複数選択と一括変更 ----
{
  const app = new StateManager();
  app.setSourceImage({ width: 400, height: 300 });
  const a = app.addManualBox({ x: 10, y: 10, width: 50, height: 12 }, undefined, false);
  const b = app.addManualBox({ x: 10, y: 40, width: 50, height: 12 }, undefined, false);
  const c = app.addManualBox({ x: 10, y: 70, width: 50, height: 12 }, undefined, false);

  app.setSelection([a.id, b.id, a.id, "missing"]);
  assert.deepEqual(app.getState().selectedBoxIds, [a.id, b.id], "重複と存在しない黒塗りは選択に入らない");
  assert.equal(app.getState().selectedBoxId, b.id, "基準は最後に選んだ黒塗り");

  const before = app.getState().historyIndex;
  app.updateBoxes([a.id, b.id], { label: "" });
  assert.equal(app.getState().historyIndex, before + 1, "一括変更は戻す1回ぶん");
  assert.deepEqual(app.getState().boxes.map((box) => box.label), ["", "", "手動"], "選んだ黒塗りだけが変わる");

  app.undo();
  assert.deepEqual(app.getState().boxes.map((box) => box.label), ["手動", "手動", "手動"], "戻すで全件が元に戻る");

  app.setSelection([a.id, b.id, c.id], a.id);
  app.removeBoxes([a.id, c.id]);
  assert.deepEqual(app.getState().selectedBoxIds, [b.id], "消した黒塗りは選択から外れる");
  assert.equal(app.getState().selectedBoxId, b.id, "基準が消えたら残りの黒塗りが基準になる");

  app.setSelectedBoxId(b.id);
  assert.deepEqual(app.getState().selectedBoxIds, [b.id]);
  app.setSelectedBoxId(null);
  assert.deepEqual(app.getState().selectedBoxIds, []);
}

// ---- 図形は黒塗りと同じ「戻す」で扱う ----
{
  const app = new StateManager();
  app.setSourceImage({ width: 400, height: 300 });
  const shape = { id: "s1", kind: "arrow", x1: 10, y1: 10, x2: 100, y2: 10, color: "#ef4444", width: 4 };
  app.addAnnotation(shape);
  assert.equal(app.getState().selectedAnnotationId, "s1");
  assert.equal(app.getState().historyIndex, 1, "画像を開いた直後の空の状態が最初の1段");

  app.updateAnnotation("s1", { x1: 20, x2: 110 }, false);
  app.updateAnnotation("s1", { x1: 30, x2: 120 }, false);
  app.commitHistory();
  assert.equal(app.getState().historyIndex, 2, "ドラッグ移動は離したときの1段だけ");

  app.undo();
  assert.equal(app.getState().annotations[0].x1, 10, "移動を戻すと元の位置");
  app.undo();
  assert.equal(app.getState().annotations.length, 0, "最初に描いた図形も戻すで消える");
  assert.equal(app.getState().selectedAnnotationId, null, "消えた図形の選択は外れる");
  app.redo();
  assert.equal(app.getState().annotations.length, 1);

  app.addManualBox({ x: 10, y: 10, width: 50, height: 12 }, undefined, false);
  app.undo();
  assert.equal(app.getState().annotations.length, 1, "黒塗りを戻しても図形は残る");
}

// ---- 図形の当たり判定 ----
{
  const rect = { id: "r", kind: "rect", x1: 100, y1: 100, x2: 200, y2: 160, color: "#fff", width: 4 };
  const ellipse = { id: "e", kind: "ellipse", x1: 300, y1: 100, x2: 400, y2: 160, color: "#fff", width: 4 };
  const arrow = { id: "a", kind: "arrow", x1: 0, y1: 250, x2: 100, y2: 250, color: "#fff", width: 4 };
  const all = [rect, ellipse, arrow];

  assert.equal(findAnnotationAt(all, 101, 130, 6)?.id, "r", "四角の左辺を押せば選べる");
  assert.equal(findAnnotationAt(all, 150, 130, 6), null, "四角の内側は空けておく（中から別の図形を描ける）");
  assert.equal(findAnnotationAt(all, 350, 101, 6)?.id, "e", "丸の上端を押せば選べる");
  assert.equal(findAnnotationAt(all, 350, 130, 6), null, "丸の中心は掴まない");
  assert.equal(findAnnotationAt(all, 50, 253, 6)?.id, "a", "矢印の軸の近く");
  assert.equal(findAnnotationAt(all, 50, 280, 6), null, "矢印から離れた場所");

  const overlap = [{ ...rect, id: "under" }, { ...rect, id: "over" }];
  assert.equal(findAnnotationAt(overlap, 100, 130, 6)?.id, "over", "重なったら上に描いた図形を優先");

  assert.equal(isAnnotationLargeEnough({ x1: 0, y1: 0, x2: 3, y2: 3 }, 8), false, "クリックしただけでは図形を残さない");
  assert.equal(isAnnotationLargeEnough({ x1: 0, y1: 0, x2: 20, y2: 0 }, 8), true);
}

console.log("selection & shape regression ok");
