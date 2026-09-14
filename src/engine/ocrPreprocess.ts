/**
 * OCR専用の古典的画像前処理（AI・外部通信なし）
 * 画面のカメラ撮影で起きるモアレ／ジャギー／小文字／照明ムラを抑え、
 * Tesseract が読みやすい作業画像だけを作る。表示用の元画像は変更しない。
 */
import { adaptiveThresholdBradley } from "./adaptiveThreshold";
export interface OcrSourceAnalysis {
  estimatedLineHeight: number;
  isLikelyScreenPhoto: boolean;
  isDarkBackground: boolean;
  contrast: number;
  colorFringe: number;
}

export interface OcrPreprocessResult {
  canvas: HTMLCanvasElement;
  /** 作業画像座標 = 元画像座標 * scale */
  scale: number;
  analysis: OcrSourceAnalysis;
}

const ANALYSIS_WIDTH = 480;
const TARGET_LINE_HEIGHT = 36;
const MIN_SCALE = 0.55;
const MAX_SCALE = 3.2;
const MAX_WORK_SIDE = 2200;
const MAX_WORK_SIDE_SMALL_TEXT = 3200;
const MIN_LINE_HEIGHT_PX = 16;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 縮小画像から行高・画面撮影らしさ・暗背景を推定
 */
export function analyzeOcrSource(
  source: HTMLImageElement | HTMLCanvasElement
): OcrSourceAnalysis {
  const origW = source.width;
  const origH = source.height;
  const fallback: OcrSourceAnalysis = {
    estimatedLineHeight: 0,
    isLikelyScreenPhoto: false,
    isDarkBackground: false,
    contrast: 0,
    colorFringe: 0
  };
  if (origW < 16 || origH < 16) return fallback;

  const scale = Math.min(1, ANALYSIS_WIDTH / origW);
  const w = Math.max(16, Math.round(origW * scale));
  const h = Math.max(16, Math.round(origH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return fallback;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const gray = new Uint8Array(w * h);

  let lumSum = 0;
  let darkCount = 0;
  let brightCount = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const y = luminance(data[i], data[i + 1], data[i + 2]);
    gray[p] = y < 0 ? 0 : y > 255 ? 255 : y;
    lumSum += gray[p];
    if (gray[p] < 80) darkCount++;
    else if (gray[p] > 180) brightCount++;
  }
  const meanLum = lumSum / (w * h);
  const isDarkBackground = meanLum < 108 && darkCount > brightCount * 1.15;

  // 行高: 縦方向エッジの水平投影で「文字行」の連長の中央値
  const proj = new Float32Array(h);
  let edgeEnergy = 0;
  let hfEnergy = 0;
  let hfCount = 0;
  let fringeAcc = 0;
  let fringeN = 0;
  let contrastAcc = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const vEdge = Math.abs(gray[idx + w] - gray[idx - w]);
      const hEdge = Math.abs(gray[idx + 1] - gray[idx - 1]);
      if (vEdge > 18) proj[y] += 1;
      edgeEnergy += vEdge;
      hfEnergy += hEdge;
      hfCount++;

      const pix = idx * 4;
      const rg = Math.abs(data[pix] - data[pix + 1]);
      const bg = Math.abs(data[pix + 2] - data[pix + 1]);
      if (hEdge + vEdge > 30) {
        fringeAcc += rg + bg;
        fringeN++;
      }
    }
  }

  const meanHf = hfCount > 0 ? hfEnergy / hfCount : 0;
  const colorFringe = fringeN > 0 ? fringeAcc / fringeN : 0;

  // コントラスト（簡易: 高エッジ密度）
  contrastAcc = hfCount > 0 ? edgeEnergy / hfCount : 0;

  const projThresh = (() => {
    let s = 0;
    for (let y = 0; y < h; y++) s += proj[y];
    const avg = s / h;
    return Math.max(4, avg * 1.35);
  })();

  const runLengths: number[] = [];
  let run = 0;
  for (let y = 0; y < h; y++) {
    if (proj[y] >= projThresh) {
      run++;
    } else if (run > 0) {
      if (run >= 2 && run <= h * 0.18) runLengths.push(run);
      run = 0;
    }
  }
  if (run >= 2 && run <= h * 0.18) runLengths.push(run);

  runLengths.sort((a, b) => a - b);
  const medianRun =
    runLengths.length > 0 ? runLengths[Math.floor(runLengths.length / 2)] : 0;
  const estimatedLineHeight = medianRun > 0 ? medianRun / scale : 0;

  // LCD サブピクセルの色縞 + 細かい高周波 → 画面をカメラで撮った可能性
  const isLikelyScreenPhoto =
    colorFringe > 9.5 ||
    (meanHf > 14 && colorFringe > 6) ||
    (estimatedLineHeight > 0 && estimatedLineHeight < 16 && meanHf > 10);

  return {
    estimatedLineHeight,
    isLikelyScreenPhoto,
    isDarkBackground,
    contrast: contrastAcc,
    colorFringe
  };
}

function computeScale(
  origW: number,
  origH: number,
  analysis: OcrSourceAnalysis
): number {
  let scale: number;
  if (analysis.estimatedLineHeight >= 4) {
    scale = TARGET_LINE_HEIGHT / analysis.estimatedLineHeight;
  } else {
    const minSide = Math.min(origW, origH);
    scale = minSide < 900 ? 2.2 : minSide < 1400 ? 1.5 : 1.0;
  }

  if (analysis.isLikelyScreenPhoto && scale < 1.35 && analysis.estimatedLineHeight < 28) {
    scale = Math.max(scale, 1.6);
  }

  const smallText =
    analysis.estimatedLineHeight > 0 && analysis.estimatedLineHeight < 22;
  if (smallText) {
    scale = Math.max(scale, Math.min(MAX_SCALE, 24 / analysis.estimatedLineHeight));
  }

  scale = clamp(scale, MIN_SCALE, MAX_SCALE);

  const maxSide = smallText ? MAX_WORK_SIDE_SMALL_TEXT : MAX_WORK_SIDE;
  const longSide = Math.max(origW, origH) * scale;
  if (longSide > maxSide) {
    const capped = maxSide / Math.max(origW, origH);
    const resultingLine = analysis.estimatedLineHeight * capped;
    if (!smallText || resultingLine >= MIN_LINE_HEIGHT_PX) {
      scale = capped;
    } else {
      scale = Math.min(
        MAX_SCALE,
        Math.max(capped, MIN_LINE_HEIGHT_PX / Math.max(analysis.estimatedLineHeight, 1))
      );
    }
  }

  const workPixels = origW * scale * origH * scale;
  const maxPixels = smallText ? 7_500_000 : 5_000_000;
  if (workPixels > maxPixels) {
    scale *= Math.sqrt(maxPixels / workPixels);
  }

  return scale;
}

function median3x3(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src);
  const v = new Uint8Array(9);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const row = (y + dy) * w + x;
        v[k++] = src[row - 1];
        v[k++] = src[row];
        v[k++] = src[row + 1];
      }
      for (let i = 1; i < 9; i++) {
        const t = v[i];
        let j = i - 1;
        while (j >= 0 && v[j] > t) {
          v[j + 1] = v[j];
          j--;
        }
        v[j + 1] = t;
      }
      out[y * w + x] = v[4];
    }
  }
  return out;
}

function gaussianBlurSeparable(
  src: Uint8Array,
  w: number,
  h: number,
  sigma: number
): Uint8Array {
  const radius = Math.max(1, Math.ceil(sigma * 2.2));
  const kernel = new Float32Array(radius * 2 + 1);
  const s2 = 2 * sigma * sigma;
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const val = Math.exp(-(i * i) / s2);
    kernel[i + radius] = val;
    ksum += val;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;

  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -radius; i <= radius; i++) {
        const xx = clamp(x + i, 0, w - 1);
        acc += src[row + xx] * kernel[i + radius];
      }
      tmp[row + x] = acc + 0.5;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -radius; i <= radius; i++) {
        const yy = clamp(y + i, 0, h - 1);
        acc += tmp[yy * w + x] * kernel[i + radius];
      }
      out[y * w + x] = acc + 0.5;
    }
  }
  return out;
}

function boxSum(
  ii: Float64Array,
  iiW: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  return (
    ii[(y1 + 1) * iiW + (x1 + 1)] -
    ii[(y1 + 1) * iiW + x0] -
    ii[y0 * iiW + (x1 + 1)] +
    ii[y0 * iiW + x0]
  );
}

function boxFilterFloat(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const iiW = w + 1;
  const integral = new Float64Array(iiW * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    const srcRow = (y - 1) * w;
    for (let x = 1; x <= w; x++) {
      row += src[srcRow + (x - 1)];
      integral[y * iiW + x] = integral[(y - 1) * iiW + x] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = y - r < 0 ? 0 : y - r;
    const y1 = y + r >= h ? h - 1 : y + r;
    for (let x = 0; x < w; x++) {
      const x0 = x - r < 0 ? 0 : x - r;
      const x1 = x + r >= w ? w - 1 : x + r;
      const n = (x1 - x0 + 1) * (y1 - y0 + 1);
      out[y * w + x] = boxSum(integral, iiW, x0, y0, x1, y1) / n;
    }
  }
  return out;
}

/**
 * Guided filter (He et al.) — エッジを残したままモアレ／粒状ノイズを落とす
 */
function guidedFilter(
  guide: Uint8Array,
  src: Uint8Array,
  w: number,
  h: number,
  radius: number,
  eps: number
): Uint8Array {
  const I = new Float32Array(w * h);
  const P = new Float32Array(w * h);
  const II = new Float32Array(w * h);
  const IP = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const g = guide[i];
    const p = src[i];
    I[i] = g;
    P[i] = p;
    II[i] = g * g;
    IP[i] = g * p;
  }
  const meanI = boxFilterFloat(I, w, h, radius);
  const meanP = boxFilterFloat(P, w, h, radius);
  const meanII = boxFilterFloat(II, w, h, radius);
  const meanIP = boxFilterFloat(IP, w, h, radius);
  const a = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const varI = Math.max(0, meanII[i] - meanI[i] * meanI[i]);
    const cov = meanIP[i] - meanI[i] * meanP[i];
    a[i] = cov / (varI + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  const meanA = boxFilterFloat(a, w, h, radius);
  const meanB = boxFilterFloat(b, w, h, radius);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = meanA[i] * I[i] + meanB[i];
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v + 0.5;
  }
  return out;
}

function claheGray(
  src: Uint8Array,
  w: number,
  h: number,
  tilesX: number = 8,
  tilesY: number = 8,
  clipLimit: number = 2.4
): Uint8Array {
  const tw = Math.max(8, Math.ceil(w / tilesX));
  const th = Math.max(8, Math.ceil(h / tilesY));
  const nx = Math.ceil(w / tw);
  const ny = Math.ceil(h / th);
  const luts: Uint8Array[] = [];

  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const x0 = tx * tw;
      const y0 = ty * th;
      const x1 = Math.min(w, x0 + tw);
      const y1 = Math.min(h, y0 + th);
      const hist = new Float32Array(256);
      let count = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * w;
        for (let x = x0; x < x1; x++) {
          hist[src[row + x]]++;
          count++;
        }
      }
      const clip = Math.max(1, (clipLimit * count) / 256);
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > clip) {
          excess += hist[i] - clip;
          hist[i] = clip;
        }
      }
      const redist = excess / 256;
      for (let i = 0; i < 256; i++) hist[i] += redist;
      const lut = new Uint8Array(256);
      let cdf = 0;
      const scale = 255 / Math.max(1, count);
      for (let i = 0; i < 256; i++) {
        cdf += hist[i];
        lut[i] = clamp(cdf * scale, 0, 255);
      }
      luts.push(lut);
    }
  }

  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ty = Math.min(ny - 1, y / th);
    const ty0 = Math.floor(ty);
    const ty1 = Math.min(ny - 1, ty0 + 1);
    const fty = ty - ty0;
    for (let x = 0; x < w; x++) {
      const tx = Math.min(nx - 1, x / tw);
      const tx0 = Math.floor(tx);
      const tx1 = Math.min(nx - 1, tx0 + 1);
      const ftx = tx - tx0;
      const v = src[y * w + x];
      const v00 = luts[ty0 * nx + tx0][v];
      const v10 = luts[ty0 * nx + tx1][v];
      const v01 = luts[ty1 * nx + tx0][v];
      const v11 = luts[ty1 * nx + tx1][v];
      const top = v00 * (1 - ftx) + v10 * ftx;
      const bot = v01 * (1 - ftx) + v11 * ftx;
      out[y * w + x] = top * (1 - fty) + bot * fty + 0.5;
    }
  }
  return out;
}

function reduceColorFringe(data: Uint8ClampedArray, w: number, h: number): void {
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const yL = luminance(data[i], data[i + 1], data[i + 2]);
      const chroma = Math.abs(data[i] - yL) + Math.abs(data[i + 2] - yL);
      if (chroma < 14) continue;
      const up = luminance(data[i - w * 4], data[i - w * 4 + 1], data[i - w * 4 + 2]);
      const dn = luminance(data[i + w * 4], data[i + w * 4 + 1], data[i + w * 4 + 2]);
      const hf = Math.abs(yL - (up + dn) * 0.5);
      if (hf < 6) continue;
      const t = clamp((chroma - 10) / 40, 0, 0.55);
      data[i] = data[i] * (1 - t) + yL * t;
      data[i + 1] = data[i + 1] * (1 - t) + yL * t;
      data[i + 2] = data[i + 2] * (1 - t) + yL * t;
    }
  }
}

function unsharp(
  src: Uint8Array,
  blurred: Uint8Array,
  amount: number
): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = src[i] + amount * (src[i] - blurred[i]);
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v + 0.5;
  }
  return out;
}

function invertGray(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = 255 - src[i];
  return out;
}

/**
 * 暗い文字ストローク向けのクロージング（先に min で隙間を埋め、max で太さを戻す）
 */
export function morphCloseDarkText(src: Uint8Array, w: number, h: number): Uint8Array {
  const erode = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let m = 255;
      for (let dy = -1; dy <= 1; dy++) {
        const row = (y + dy) * w + x;
        const a = src[row - 1];
        const b = src[row];
        const c = src[row + 1];
        if (a < m) m = a;
        if (b < m) m = b;
        if (c < m) m = c;
      }
      erode[y * w + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    erode[x] = src[x];
    erode[(h - 1) * w + x] = src[(h - 1) * w + x];
  }
  for (let y = 0; y < h; y++) {
    erode[y * w] = src[y * w];
    erode[y * w + w - 1] = src[y * w + w - 1];
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const row = (y + dy) * w + x;
        const a = erode[row - 1];
        const b = erode[row];
        const c = erode[row + 1];
        if (a > m) m = a;
        if (b > m) m = b;
        if (c > m) m = c;
      }
      out[y * w + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    out[x] = erode[x];
    out[(h - 1) * w + x] = erode[(h - 1) * w + x];
  }
  for (let y = 0; y < h; y++) {
    out[y * w] = erode[y * w];
    out[y * w + w - 1] = erode[y * w + w - 1];
  }
  return out;
}

function grayToCanvas(gray: Uint8Array, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const v = gray[i];
    d[p] = v;
    d[p + 1] = v;
    d[p + 2] = v;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * OCR入力専用の前処理キャンバスを生成する。
 */
export function preprocessForOcr(
  source: HTMLImageElement | HTMLCanvasElement
): OcrPreprocessResult {
  const origW = source.width;
  const origH = source.height;
  const analysis = analyzeOcrSource(source);
  const scale = computeScale(origW, origH, analysis);
  const w = Math.max(8, Math.round(origW * scale));
  const h = Math.max(8, Math.round(origH * scale));

  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return { canvas: work, scale, analysis };
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  let gray: Uint8Array = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = luminance(data[i], data[i + 1], data[i + 2]) + 0.5;
  }

  // 画面撮影（モアレ・液晶格子・白飛び・コントラストムラ）または低コントラストの場合
  if (analysis.isLikelyScreenPhoto || analysis.contrast < 22) {
    // 1. 液晶サブピクセルのモアレ・高周波格子ノイズをメディアンで平滑化
    gray = median3x3(gray, w, h);
    // 2. 局所適応二値化（Bradley-Roth）: 局所平均から白吹き出し内の文字も100%浮かび上がらせる
    const windowSize = Math.max(17, Math.min(51, Math.round(Math.min(w, h) * 0.032) | 1));
    gray = adaptiveThresholdBradley(gray, w, h, {
      windowSize,
      sensitivity: 0.11,
      darkTextOnLightBg: !analysis.isDarkBackground
    });
  } else {
    // スキャン画像やデジタルスクショ: マイルドなCLAHE＋シャープ
    gray = claheGray(gray, w, h, 6, 6, 1.8);
    if (analysis.isDarkBackground) {
      gray = invertGray(gray);
    }
    const blurForSharp = gaussianBlurSeparable(gray, w, h, 0.6);
    gray = unsharp(gray, blurForSharp, 0.35);
  }

  return {
    canvas: grayToCanvas(gray, w, h),
    scale,
    analysis
  };
}

/**
 * 表示用（カラー維持）の可読化。手動「影除去・強調」から利用。
 */
export function enhanceColorImage(
  source: HTMLImageElement | HTMLCanvasElement
): HTMLCanvasElement {
  const analysis = analyzeOcrSource(source);
  const w = source.width;
  const h = source.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.drawImage(source, 0, 0);

  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  reduceColorFringe(data, w, h);

  let gray: Uint8Array = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = luminance(data[i], data[i + 1], data[i + 2]) + 0.5;
  }

  if (analysis.isLikelyScreenPhoto) {
    gray = median3x3(gray, w, h);
    gray = guidedFilter(gray, gray, w, h, 4, 90);
  }

  const equalized = claheGray(gray, w, h, 8, 8, 2.3);
  const blur = gaussianBlurSeparable(equalized, w, h, 0.75);
  const sharp = unsharp(equalized, blur, 0.55);

  for (let i = 0, p = 0; i < sharp.length; i++, p += 4) {
    const srcY = Math.max(1, gray[i]);
    const ratio = sharp[i] / srcY;
    data[p] = clamp(data[p] * ratio, 0, 255);
    data[p + 1] = clamp(data[p + 1] * ratio, 0, 255);
    data[p + 2] = clamp(data[p + 2] * ratio, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
