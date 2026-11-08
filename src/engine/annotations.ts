/**
 * 黒塗りとは別に、画像の上へ描く注釈の図形（矢印・丸・四角）。
 * 黒塗りの上に重ねて描くので、黒塗りした箇所を指し示すこともできる。
 */

export type ShapeKind = "arrow" | "ellipse" | "rect";

export interface Annotation {
  id: string;
  kind: ShapeKind;
  /** 描き始めの点（矢印なら根元）。画像座標。 */
  x1: number;
  y1: number;
  /** 描き終わりの点（矢印なら先端）。画像座標。 */
  x2: number;
  y2: number;
  color: string;
  /** 線の太さ（画像のピクセル）。 */
  width: number;
}

export const SHAPE_COLORS: { value: string; name: string }[] = [
  { value: "#ef4444", name: "赤" },
  { value: "#f59e0b", name: "黄" },
  { value: "#22c55e", name: "緑" },
  { value: "#3b82f6", name: "青" },
  { value: "#ffffff", name: "白" },
  { value: "#111827", name: "黒" }
];

/** 太さの段階（画像の短辺に対する割合）。小さな画像でも細すぎないよう下限をつける。 */
export const SHAPE_WIDTH_LEVELS = { thin: 0.004, medium: 0.007, thick: 0.012 } as const;
export type ShapeWidthLevel = keyof typeof SHAPE_WIDTH_LEVELS;

export function strokeWidthFor(level: ShapeWidthLevel, imageWidth: number, imageHeight: number): number {
  return Math.max(2, Math.round(Math.min(imageWidth, imageHeight) * SHAPE_WIDTH_LEVELS[level]));
}

/** 図形として残すのに十分な大きさか（うっかりクリックで点が残らないようにする）。 */
export function isAnnotationLargeEnough(a: Pick<Annotation, "x1" | "y1" | "x2" | "y2">, minSize: number): boolean {
  return Math.hypot(a.x2 - a.x1, a.y2 - a.y1) >= minSize;
}

export function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation): void {
  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = a.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([]);
  // 白や黒の図形でも背景に埋もれないよう、ごく薄い影をつける
  ctx.shadowColor = a.color === "#111827" ? "rgba(255, 255, 255, 0.55)" : "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = Math.max(2, a.width * 0.8);

  const left = Math.min(a.x1, a.x2);
  const top = Math.min(a.y1, a.y2);
  const w = Math.abs(a.x2 - a.x1);
  const h = Math.abs(a.y2 - a.y1);

  switch (a.kind) {
    case "rect":
      ctx.strokeRect(left, top, w, h);
      break;
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(left + w / 2, top + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "arrow": {
      const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
      const length = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
      const head = Math.min(length * 0.6, Math.max(12, a.width * 4.5));
      const spread = Math.PI / 7;
      // 軸は矢じりの手前で止め、太い線でも先端がとがって見えるようにする
      const shaftEnd = Math.max(0, length - head * 0.7);
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      ctx.lineTo(a.x1 + Math.cos(angle) * shaftEnd, a.y1 + Math.sin(angle) * shaftEnd);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(a.x2, a.y2);
      ctx.lineTo(a.x2 - head * Math.cos(angle - spread), a.y2 - head * Math.sin(angle - spread));
      ctx.lineTo(a.x2 - head * Math.cos(angle + spread), a.y2 - head * Math.sin(angle + spread));
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

export function drawAnnotations(ctx: CanvasRenderingContext2D, annotations: Annotation[]): void {
  for (const a of annotations) drawAnnotation(ctx, a);
}

/** 選択中の図形の目印（点線の枠と両端の丸）。書き出しには含めない。 */
export function drawAnnotationSelection(ctx: CanvasRenderingContext2D, a: Annotation, zoom: number): void {
  const pad = a.width / 2 + 4 / Math.max(0.5, zoom);
  const left = Math.min(a.x1, a.x2) - pad;
  const top = Math.min(a.y1, a.y2) - pad;
  const w = Math.abs(a.x2 - a.x1) + pad * 2;
  const h = Math.abs(a.y2 - a.y1) + pad * 2;
  ctx.save();
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = Math.max(1, 1.5 / Math.max(0.5, zoom));
  ctx.setLineDash([6 / Math.max(0.5, zoom), 4 / Math.max(0.5, zoom)]);
  ctx.strokeRect(left, top, w, h);
  ctx.setLineDash([]);
  const r = Math.max(4, 6 / Math.max(0.5, zoom));
  for (const [x, y] of [[a.x1, a.y1], [a.x2, a.y2]]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * 線の近くを押したときだけ図形を掴む。囲みの内側は空けておき、
 * 四角の中から矢印を引き始めるといった操作を邪魔しない。上に描いたものを優先する。
 */
export function findAnnotationAt(annotations: Annotation[], x: number, y: number, tolerance: number): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i];
    const reach = tolerance + a.width / 2;
    const left = Math.min(a.x1, a.x2);
    const right = Math.max(a.x1, a.x2);
    const top = Math.min(a.y1, a.y2);
    const bottom = Math.max(a.y1, a.y2);
    let dist: number;
    if (a.kind === "arrow") {
      dist = distanceToSegment(x, y, a.x1, a.y1, a.x2, a.y2);
    } else if (a.kind === "rect") {
      dist = Math.min(
        distanceToSegment(x, y, left, top, right, top),
        distanceToSegment(x, y, right, top, right, bottom),
        distanceToSegment(x, y, right, bottom, left, bottom),
        distanceToSegment(x, y, left, bottom, left, top)
      );
    } else {
      const rx = Math.max(1, (right - left) / 2);
      const ry = Math.max(1, (bottom - top) / 2);
      const cx = left + rx;
      const cy = top + ry;
      // 楕円の式の値から、輪郭までのおおよその距離を出す
      const norm = Math.hypot((x - cx) / rx, (y - cy) / ry);
      dist = Math.abs(norm - 1) * Math.min(rx, ry);
    }
    if (dist <= reach) return a;
  }
  return null;
}
