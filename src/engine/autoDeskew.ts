/**
 * AI不使用・完全機械的（数学・画像処理アルゴリズム）による
 * 自動傾き検出 (Auto-Deskew) および 台形透視変換 (Perspective Transform)
 */

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
 * 水平投影プロファイル分散法 (Horizontal Projection Profile Method)
 * テキスト行のエッジが水平に揃った時、行方向の投影ヒストグラムの分散が最大になる原理を利用。
 * AIを一切使わず、-20°〜+20°の傾き角度を0.5°精度で爆速自動検出する。
 */
export function detectImageDeskewAngle(
  source: HTMLImageElement | HTMLCanvasElement,
  minAngle: number = -15,
  maxAngle: number = 15,
  step: number = 0.5
): number {
  const origW = source.width;
  const origH = source.height;

  // 高速化のため、幅400px前後に縮小したキャンバスで計算
  const scale = Math.min(1, 400 / origW);
  const w = Math.round(origW * scale);
  const h = Math.round(origH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;

  ctx.drawImage(source, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // 1. ソーベル垂直エッジ（行の輪郭）の二値化マップを抽出
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i += 4) {
    gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }

  // 縦方向のエッジ（テキスト行の上下の境界線）を検出
  const edges = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 0; x < w; x++) {
      const diff = Math.abs(gray[(y + 1) * w + x] - gray[(y - 1) * w + x]);
      edges[y * w + x] = diff > 25 ? 1 : 0;
    }
  }

  // 2. 角度ごとの水平投影プロファイルの分散を探索
  let bestAngle = 0;
  let maxVariance = -1;

  // 中心座標
  const cx = w / 2;
  const cy = h / 2;

  // 計算ステップ
  for (let angle = minAngle; angle <= maxAngle; angle += step) {
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // 回転後のYヒストグラム
    const hist = new Float32Array(h);
    let totalSamples = 0;

    // サンプリング（ステップ2で高速化）
    for (let y = 10; y < h - 10; y += 2) {
      for (let x = 10; x < w - 10; x += 2) {
        if (edges[y * w + x] === 1) {
          // 回転後のY座標
          const rotY = Math.round(-(x - cx) * sin + (y - cy) * cos + cy);
          if (rotY >= 0 && rotY < h) {
            hist[rotY]++;
            totalSamples++;
          }
        }
      }
    }

    if (totalSamples === 0) continue;

    // 分散の計算
    const mean = totalSamples / h;
    let variance = 0;
    for (let i = 0; i < h; i++) {
      const diff = hist[i] - mean;
      variance += diff * diff;
    }

    if (variance > maxVariance) {
      maxVariance = variance;
      bestAngle = angle;
    }
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

  const outW = Math.round(outputWidth || Math.max(topW, bottomW, 300));
  const outH = Math.round(outputHeight || Math.max(leftH, rightH, 400));

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

      if (sx >= 0 && sx < origW - 1 && sy >= 0 && sy < origH - 1) {
        // 双線形補間 (Bilinear Interpolation)
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
          outPixels[outIdx + c] = Math.round(top * (1 - fy) + bottom * fy);
        }
      } else {
        outPixels[outIdx + 3] = 0; // 範囲外は透明
      }
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return outCanvas;
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
  const origW = source.width;
  const origH = source.height;

  // デフォルト（画面全体の4%マージン）
  const defaultCorners: QuadCorners = {
    topLeft: { x: Math.round(origW * 0.04), y: Math.round(origH * 0.04) },
    topRight: { x: Math.round(origW * 0.96), y: Math.round(origH * 0.04) },
    bottomRight: { x: Math.round(origW * 0.96), y: Math.round(origH * 0.96) },
    bottomLeft: { x: Math.round(origW * 0.04), y: Math.round(origH * 0.96) }
  };

  // 高速化のため、幅320px前後に縮小してエッジ解析
  const scale = Math.min(1, 320 / origW);
  const w = Math.round(origW * scale);
  const h = Math.round(origH * scale);
  if (w < 50 || h < 50) return defaultCorners;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return defaultCorners;

  ctx.drawImage(source, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // 1. グレースケール変換
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i += 4) {
    gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }

  // 2. Sobel勾配強度マップ
  const edgeStrength = new Float32Array(w * h);
  let totalEdge = 0;
  let edgeCount = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      // 水平勾配
      const gx =
        -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)] +
        -2 * gray[y * w + (x - 1)] + 2 * gray[y * w + (x + 1)] +
        -gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)];

      // 垂直勾配
      const gy =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)] +
        gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];

      const mag = Math.hypot(gx, gy);
      edgeStrength[y * w + x] = mag;
      totalEdge += mag;
      edgeCount++;
    }
  }

  const avgEdge = edgeCount > 0 ? totalEdge / edgeCount : 0;
  // 強い輪郭エッジの閾値
  const threshold = avgEdge * 1.8;

  // 3. 有意なエッジ点群の収集
  interface CandPoint {
    x: number;
    y: number;
    weight: number;
  }
  const edgePoints: CandPoint[] = [];

  // 外枠近傍（ノイズ防止のため外側2%は除外）
  const padEdgeX = Math.floor(w * 0.02);
  const padEdgeY = Math.floor(h * 0.02);

  for (let y = padEdgeY; y < h - padEdgeY; y++) {
    for (let x = padEdgeX; x < w - padEdgeX; x++) {
      const val = edgeStrength[y * w + x];
      if (val > threshold) {
        edgePoints.push({ x, y, weight: val });
      }
    }
  }

  // エッジが少なすぎる場合はデフォルト
  if (edgePoints.length < 40) {
    return defaultCorners;
  }

  // 4. 四方向の極値探索 (Extreme Points / Convex Quad Fitting)
  // 左上: x + y が最小
  // 右上: x - y が最大
  // 右下: x + y が最大
  // 左下: y - x が最大
  let minSum = Infinity;
  let maxDiff = -Infinity;
  let maxSum = -Infinity;
  let maxYMinusX = -Infinity;

  let bestTL = { x: 0, y: 0 };
  let bestTR = { x: w, y: 0 };
  let bestBR = { x: w, y: h };
  let bestBL = { x: 0, y: h };

  for (const pt of edgePoints) {
    const sum = pt.x + pt.y;
    const diff = pt.x - pt.y;
    const yMinusX = pt.y - pt.x;

    if (sum < minSum) {
      minSum = sum;
      bestTL = { x: pt.x, y: pt.y };
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      bestTR = { x: pt.x, y: pt.y };
    }
    if (sum > maxSum) {
      maxSum = sum;
      bestBR = { x: pt.x, y: pt.y };
    }
    if (yMinusX > maxYMinusX) {
      maxYMinusX = yMinusX;
      bestBL = { x: pt.x, y: pt.y };
    }
  }

  // 5. 検出された四角形の面積と妥当性チェック
  // 三角形分割による四角形面積
  const quadArea = 0.5 * Math.abs(
    (bestTL.x * bestTR.y - bestTR.x * bestTL.y) +
    (bestTR.x * bestBR.y - bestBR.x * bestTR.y) +
    (bestBR.x * bestBL.y - bestBL.x * bestBR.y) +
    (bestBL.x * bestTL.y - bestTL.x * bestBL.y)
  );

  const totalArea = w * h;
  // 面積が全体の30%未満、または98%以上の場合は誤検出の可能性があるためデフォルトへ
  if (quadArea < totalArea * 0.3 || quadArea > totalArea * 0.98) {
    return defaultCorners;
  }

  // 元画像解像度にスケーリング
  const invScale = 1 / scale;
  return {
    topLeft: { x: Math.round(bestTL.x * invScale), y: Math.round(bestTL.y * invScale) },
    topRight: { x: Math.round(bestTR.x * invScale), y: Math.round(bestTR.y * invScale) },
    bottomRight: { x: Math.round(bestBR.x * invScale), y: Math.round(bestBR.y * invScale) },
    bottomLeft: { x: Math.round(bestBL.x * invScale), y: Math.round(bestBL.y * invScale) }
  };
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
  const corners = detectDocumentCornersAuto(source);
  const origW = source.width;
  const origH = source.height;

  // 四隅が画像端（デフォルトに近いか判定）
  const isDefault =
    Math.abs(corners.topLeft.x - origW * 0.04) < 10 &&
    Math.abs(corners.topLeft.y - origH * 0.04) < 10 &&
    Math.abs(corners.bottomRight.x - origW * 0.96) < 10 &&
    Math.abs(corners.bottomRight.y - origH * 0.96) < 10;

  let currentCanvas: HTMLCanvasElement;
  let appliedTransform = false;

  if (!isDefault) {
    // 台形透視変換を実行
    currentCanvas = applyPerspectiveTransform(source, corners);
    appliedTransform = true;
  } else {
    // 透視変換は不要なためコピー
    currentCanvas = document.createElement("canvas");
    currentCanvas.width = origW;
    currentCanvas.height = origH;
    const ctx = currentCanvas.getContext("2d");
    if (ctx) ctx.drawImage(source, 0, 0);
  }

  // テキスト行の水平傾きを検出
  const angle = detectImageDeskewAngle(currentCanvas);

  return {
    canvas: currentCanvas,
    appliedTransform,
    deskewAngle: angle
  };
}

