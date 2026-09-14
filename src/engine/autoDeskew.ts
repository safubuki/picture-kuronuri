/**
 * AI不使用・完全機械的（数学・画像処理アルゴリズム）による
 * 自動傾き検出 (Auto-Deskew) および 台形透視変換 (Perspective Transform)
 */

import {
  detectDocumentCornersDetailed,
  quadNeedsWarp
} from "./screenQuad";

export type { QuadDetectionResult, QuadMethod } from "./screenQuad";
export { detectDocumentCornersDetailed, quadNeedsWarp };

export interface Point2D {
  x: number;
  y: number;
}

export interface QuadCorners {
  topLeft: Point2D;
  topRight: Point2D;
  bottomRight: Point2D;
  bottomLeft: Point2D;
}

/**
 * 文字行の傾き検出（粗探索＋0.1°精密探索＋勾配方位の照合）
 */
export function detectImageDeskewAngle(
  source: HTMLImageElement | HTMLCanvasElement,
  minAngle: number = -18,
  maxAngle: number = 18,
  _step: number = 0.5
): number {
  const origW = source.width;
  const origH = source.height;

  const scale = Math.min(1, 480 / origW);
  const w = Math.round(origW * scale);
  const h = Math.round(origH * scale);
  if (w < 40 || h < 40) return 0;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] + 0.5;
  }

  const x0 = Math.floor(w * 0.08);
  const x1 = Math.ceil(w * 0.92);
  const y0 = Math.floor(h * 0.08);
  const y1 = Math.ceil(h * 0.92);

  const edgeXY: number[] = [];
  const gradBins = new Float32Array(41);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const gy = gray[(y + 1) * w + x] - gray[(y - 1) * w + x];
      const gx = gray[y * w + (x + 1)] - gray[y * w + (x - 1)];
      const mag = Math.abs(gx) + Math.abs(gy);
      if (mag > 28) {
        edgeXY.push(x, y);
        const lineDeg = (Math.atan2(gx, gy) * 180) / Math.PI;
        const clamped = Math.max(-20, Math.min(20, lineDeg));
        const bin = Math.round(clamped + 20);
        gradBins[bin] += mag;
      }
    }
  }
  if (edgeXY.length < 80) return 0;

  let gradPeak = 0;
  let gradMax = -1;
  for (let i = 0; i < gradBins.length; i++) {
    const sm =
      (gradBins[Math.max(0, i - 1)] + gradBins[i] * 2 + gradBins[Math.min(40, i + 1)]) / 4;
    if (sm > gradMax) {
      gradMax = sm;
      gradPeak = i - 20;
    }
  }

  const cx = w / 2;
  const cy = h / 2;
  const nEdge = edgeXY.length / 2;

  const varianceAt = (angle: number): number => {
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const hist = new Float32Array(h);
    let total = 0;
    for (let i = 0; i < nEdge; i++) {
      const x = edgeXY[i * 2];
      const y = edgeXY[i * 2 + 1];
      const rotY = Math.round(-(x - cx) * sin + (y - cy) * cos + cy);
      if (rotY >= 0 && rotY < h) {
        hist[rotY]++;
        total++;
      }
    }
    if (total === 0) return -1;
    const mean = total / h;
    let variance = 0;
    for (let i = 0; i < h; i++) {
      const d = hist[i] - mean;
      variance += d * d;
    }
    return variance;
  };

  let bestAngle = 0;
  let maxVar = -1;
  for (let angle = minAngle; angle <= maxAngle; angle += 1) {
    const v = varianceAt(angle);
    if (v > maxVar) {
      maxVar = v;
      bestAngle = angle;
    }
  }

  const fineLo = Math.max(minAngle, bestAngle - 1.6);
  const fineHi = Math.min(maxAngle, bestAngle + 1.6);
  for (let angle = fineLo; angle <= fineHi + 1e-6; angle += 0.1) {
    const a = Math.round(angle * 10) / 10;
    const v = varianceAt(a);
    if (v > maxVar) {
      maxVar = v;
      bestAngle = a;
    }
  }

  if (Math.abs(bestAngle - gradPeak) < 1.5) {
    bestAngle = Math.round((bestAngle * 0.65 + gradPeak * 0.35) * 10) / 10;
  }

  return bestAngle;
}

/**
 * 透視変換（台形補正 / 4点ワープ変換）
 * 斜めから撮影された四角形領域を、正面の長方形に射影変換する
 */
export function applyPerspectiveTransform(
  source: HTMLImageElement | HTMLCanvasElement,
  corners: QuadCorners,
  outputWidth?: number,
  outputHeight?: number
): HTMLCanvasElement {
  const origW = source.width;
  const origH = source.height;

  // 出力サイズが未指定の場合、四辺の長さから自動計算
  const topW = Math.hypot(corners.topRight.x - corners.topLeft.x, corners.topRight.y - corners.topLeft.y);
  const bottomW = Math.hypot(corners.bottomRight.x - corners.bottomLeft.x, corners.bottomRight.y - corners.bottomLeft.y);
  const leftH = Math.hypot(corners.bottomLeft.x - corners.topLeft.x, corners.bottomLeft.y - corners.topLeft.y);
  const rightH = Math.hypot(corners.bottomRight.x - corners.topRight.x, corners.bottomRight.y - corners.topRight.y);

  let outW = Math.round(outputWidth || Math.max(topW, bottomW, 300));
  let outH = Math.round(outputHeight || Math.max(leftH, rightH, 400));
  const maxSide = 2400;
  if (outW > maxSide || outH > maxSide) {
    const s = maxSide / Math.max(outW, outH);
    outW = Math.max(300, Math.round(outW * s));
    outH = Math.max(400, Math.round(outH * s));
  }

  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) return outCanvas;

  // 元画像のコンテキスト
  const inCanvas = document.createElement("canvas");
  inCanvas.width = origW;
  inCanvas.height = origH;
  const inCtx = inCanvas.getContext("2d", { willReadFrequently: true });
  if (!inCtx) return outCanvas;
  inCtx.drawImage(source, 0, 0);

  // 3x3 透視変換行列（ホモグラフィ）の計算
  // src: corners -> dst: [0, 0], [outW, 0], [outW, outH], [0, outH]
  const H = computeHomography(
    [
      { x: 0, y: 0 },
      { x: outW, y: 0 },
      { x: outW, y: outH },
      { x: 0, y: outH }
    ],
    [
      corners.topLeft,
      corners.topRight,
      corners.bottomRight,
      corners.bottomLeft
    ]
  );

  // 逆マッピングによるピクセル補間
  const inData = inCtx.getImageData(0, 0, origW, origH);
  const outData = outCtx.createImageData(outW, outH);
  const inPixels = inData.data;
  const outPixels = outData.data;

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      // 逆投影座標の計算 (sx, sy)
      const denom = H[6] * dx + H[7] * dy + H[8];
      const sx = (H[0] * dx + H[1] * dy + H[2]) / denom;
      const sy = (H[3] * dx + H[4] * dy + H[5]) / denom;

      const outIdx = (dy * outW + dx) * 4;

      if (sx >= 1 && sx < origW - 2 && sy >= 1 && sy < origH - 2) {
        sampleCatmullRom(inPixels, origW, sx, sy, outPixels, outIdx);
      } else if (sx >= 0 && sx < origW - 1 && sy >= 0 && sy < origH - 1) {
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = x0 + 1;
        const y1 = y0 + 1;
        const fx = sx - x0;
        const fy = sy - y0;
        const idx00 = (y0 * origW + x0) * 4;
        const idx10 = (y0 * origW + x1) * 4;
        const idx01 = (y1 * origW + x0) * 4;
        const idx11 = (y1 * origW + x1) * 4;
        for (let c = 0; c < 4; c++) {
          const top = inPixels[idx00 + c] * (1 - fx) + inPixels[idx10 + c] * fx;
          const bottom = inPixels[idx01 + c] * (1 - fx) + inPixels[idx11 + c] * fx;
          outPixels[outIdx + c] = top * (1 - fy) + bottom * fy + 0.5;
        }
      } else {
        outPixels[outIdx] = 11;
        outPixels[outIdx + 1] = 13;
        outPixels[outIdx + 2] = 18;
        outPixels[outIdx + 3] = 255;
      }
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return outCanvas;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
  );
}

function sampleCatmullRom(
  data: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  oi: number
): void {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  for (let c = 0; c < 4; c++) {
    const col0 = catmullRom(
      data[((y0 - 1) * w + (x0 - 1)) * 4 + c],
      data[((y0 - 1) * w + x0) * 4 + c],
      data[((y0 - 1) * w + (x0 + 1)) * 4 + c],
      data[((y0 - 1) * w + (x0 + 2)) * 4 + c],
      fx
    );
    const col1 = catmullRom(
      data[(y0 * w + (x0 - 1)) * 4 + c],
      data[(y0 * w + x0) * 4 + c],
      data[(y0 * w + (x0 + 1)) * 4 + c],
      data[(y0 * w + (x0 + 2)) * 4 + c],
      fx
    );
    const col2 = catmullRom(
      data[((y0 + 1) * w + (x0 - 1)) * 4 + c],
      data[((y0 + 1) * w + x0) * 4 + c],
      data[((y0 + 1) * w + (x0 + 1)) * 4 + c],
      data[((y0 + 1) * w + (x0 + 2)) * 4 + c],
      fx
    );
    const col3 = catmullRom(
      data[((y0 + 2) * w + (x0 - 1)) * 4 + c],
      data[((y0 + 2) * w + x0) * 4 + c],
      data[((y0 + 2) * w + (x0 + 1)) * 4 + c],
      data[((y0 + 2) * w + (x0 + 2)) * 4 + c],
      fx
    );
    const v = catmullRom(col0, col1, col2, col3, fy);
    out[oi + c] = v < 0 ? 0 : v > 255 ? 255 : v + 0.5;
  }
}

/**
 * 4組の対応点から3x3のホモグラフィ行列 H を計算
 */
function computeHomography(src: Point2D[], dst: Point2D[]): number[] {
  // 8元1次連立方程式を解く (Gauss-Jordan消去法)
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x;
    const sy = src[i].y;
    const dx = dst[i].x;
    const dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);

    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }

  // ガウス・ジョルダン法
  const n = 8;
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    const tempA = A[i]; A[i] = A[maxRow]; A[maxRow] = tempA;
    const tempB = b[i]; b[i] = b[maxRow]; b[maxRow] = tempB;

    const pivot = A[i][i];
    if (Math.abs(pivot) < 1e-8) continue;
    for (let j = i; j < n; j++) A[i][j] /= pivot;
    b[i] /= pivot;

    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = A[k][i];
        for (let j = i; j < n; j++) A[k][j] -= factor * A[i][j];
        b[k] -= factor * b[i];
      }
    }
  }

  return [
    b[0], b[1], b[2],
    b[3], b[4], b[5],
    b[6], b[7], 1.0
  ];
}

/**
 * 画像からチャット画面や書類の四隅（輪郭）をAI不使用・純粋画像処理で自動検出
 */
export function detectDocumentCornersAuto(source: HTMLImageElement | HTMLCanvasElement): QuadCorners {
  return detectDocumentCornersDetailed(source).corners;
}

/**
 * Canvas 上で任意角度回転（中間パイプライン用・同期）
 */
export function rotateCanvasByAngle(
  source: HTMLImageElement | HTMLCanvasElement,
  angleDegrees: number
): HTMLCanvasElement {
  const radians = (angleDegrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const origW = source.width;
  const origH = source.height;
  const newW = Math.round(origW * cos + origH * sin);
  const newH = Math.round(origW * sin + origH * cos);

  const canvas = document.createElement("canvas");
  canvas.width = newW;
  canvas.height = newH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, newW, newH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(radians);
  ctx.drawImage(source, -origW / 2, -origH / 2);
  return canvas;
}

/**
 * 互換性のための既存インターフェース
 */
export function estimateDocumentCorners(source: HTMLImageElement | HTMLCanvasElement): QuadCorners {
  return detectDocumentCornersAuto(source);
}

/**
 * 自動台形透視変換＆水平補正（完全自動フラット化）
 * 斜め撮影のスマホ画面や書類を、AIを使わずに真正面フラットな画像へ一発変換
 */
export function autoFlattenImage(
  source: HTMLImageElement | HTMLCanvasElement
): { canvas: HTMLCanvasElement; appliedTransform: boolean; deskewAngle: number } {
  const detected = detectDocumentCornersDetailed(source);
  const origW = source.width;
  const origH = source.height;

  let currentCanvas: HTMLCanvasElement;
  let appliedTransform = false;

  const canWarp =
    detected.method !== "fallback" &&
    detected.confidence >= 0.35 &&
    quadNeedsWarp(detected.corners, origW, origH, detected.method);

  if (canWarp) {
    currentCanvas = applyPerspectiveTransform(source, detected.corners);
    appliedTransform = true;
  } else {
    currentCanvas = document.createElement("canvas");
    currentCanvas.width = origW;
    currentCanvas.height = origH;
    const ctx = currentCanvas.getContext("2d");
    if (ctx) ctx.drawImage(source, 0, 0);
  }

  const angle = detectImageDeskewAngle(currentCanvas);

  return {
    canvas: currentCanvas,
    appliedTransform,
    deskewAngle: angle
  };
}

export function copySourceToCanvas(
  source: HTMLImageElement | HTMLCanvasElement
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(source, 0, 0);
  return canvas;
}

