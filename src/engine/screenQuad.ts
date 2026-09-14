/**
 * 撮影画像内の画面・書類四隅検出（AI不使用）
 * 暗いベゼル／余白に囲まれた発光画面、およびわずかな台形歪みの本文領域を古典的画像処理で探す。
 */

import type { Point2D, QuadCorners } from "./autoDeskew";

export type QuadMethod = "blob" | "content" | "edges" | "lines" | "fallback";

export interface QuadDetectionResult {
  corners: QuadCorners;
  confidence: number;
  method: QuadMethod;
}

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function defaultQuadCorners(w: number, h: number): QuadCorners {
  // 本文やヘッダーが切り落とされないよう、初期ピンは画像外枠（マージン1.5%）いっぱいに配置
  const padX = Math.max(1, Math.round(w * 0.015));
  const padY = Math.max(1, Math.round(h * 0.015));
  return {
    topLeft: { x: padX, y: padY },
    topRight: { x: w - padX, y: padY },
    bottomRight: { x: w - padX, y: h - padY },
    bottomLeft: { x: padX, y: h - padY }
  };
}

export function scaleQuad(q: QuadCorners, s: number): QuadCorners {
  return {
    topLeft: { x: q.topLeft.x * s, y: q.topLeft.y * s },
    topRight: { x: q.topRight.x * s, y: q.topRight.y * s },
    bottomRight: { x: q.bottomRight.x * s, y: q.bottomRight.y * s },
    bottomLeft: { x: q.bottomLeft.x * s, y: q.bottomLeft.y * s }
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function extremesToQuad(
  pts: { x: number; y: number }[]
): QuadCorners | null {
  if (pts.length < 8) return null;
  let minSum = Infinity;
  let maxDiff = -Infinity;
  let maxSum = -Infinity;
  let maxYMinusX = -Infinity;
  let tl = { x: 0, y: 0 };
  let tr = { x: 0, y: 0 };
  let br = { x: 0, y: 0 };
  let bl = { x: 0, y: 0 };
  for (const pt of pts) {
    const sum = pt.x + pt.y;
    const diff = pt.x - pt.y;
    const ymx = pt.y - pt.x;
    if (sum < minSum) {
      minSum = sum;
      tl = pt;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      tr = pt;
    }
    if (sum > maxSum) {
      maxSum = sum;
      br = pt;
    }
    if (ymx > maxYMinusX) {
      maxYMinusX = ymx;
      bl = pt;
    }
  }
  return {
    topLeft: { x: tl.x, y: tl.y },
    topRight: { x: tr.x, y: tr.y },
    bottomRight: { x: br.x, y: br.y },
    bottomLeft: { x: bl.x, y: bl.y }
  };
}

function quadArea(q: QuadCorners): number {
  return (
    0.5 *
    Math.abs(
      q.topLeft.x * q.topRight.y - q.topRight.x * q.topLeft.y +
        q.topRight.x * q.bottomRight.y - q.bottomRight.x * q.topRight.y +
        q.bottomRight.x * q.bottomLeft.y - q.bottomLeft.x * q.bottomRight.y +
        q.bottomLeft.x * q.topLeft.y - q.topLeft.x * q.bottomLeft.y
    )
  );
}

function interiorAngle(prev: Point2D, corner: Point2D, next: Point2D): number {
  const ax = prev.x - corner.x;
  const ay = prev.y - corner.y;
  const bx = next.x - corner.x;
  const by = next.y - corner.y;
  const den = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (den < 1e-6) return 0;
  const cos = clamp((ax * bx + ay * by) / den, -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

export function isValidDocumentQuad(q: QuadCorners, w: number, h: number): boolean {
  const area = quadArea(q);
  const total = w * h;
  if (area < total * 0.12 || area > total * 0.995) return false;

  const top = dist(q.topLeft, q.topRight);
  const bot = dist(q.bottomLeft, q.bottomRight);
  const left = dist(q.topLeft, q.bottomLeft);
  const right = dist(q.topRight, q.bottomRight);
  if (top < 24 || bot < 24 || left < 24 || right < 24) return false;

  const ar = Math.max(top, bot) / Math.max(1, Math.max(left, right));
  if (ar < 0.22 || ar > 4.5) return false;

  const angles = [
    interiorAngle(q.bottomLeft, q.topLeft, q.topRight),
    interiorAngle(q.topLeft, q.topRight, q.bottomRight),
    interiorAngle(q.topRight, q.bottomRight, q.bottomLeft),
    interiorAngle(q.bottomRight, q.bottomLeft, q.topLeft)
  ];
  if (angles.some((a) => a < 52 || a > 128)) return false;

  // 交差（砂時計型）を除外
  const cx =
    (q.topLeft.x + q.topRight.x + q.bottomRight.x + q.bottomLeft.x) / 4;
  const cy =
    (q.topLeft.y + q.topRight.y + q.bottomRight.y + q.bottomLeft.y) / 4;
  if (cx < 0 || cy < 0 || cx > w || cy > h) return false;

  return true;
}

export function quadNeedsWarp(
  q: QuadCorners,
  w: number,
  h: number,
  method?: QuadMethod
): boolean {
  if (!isValidDocumentQuad(q, w, h)) return false;

  const top = dist(q.topLeft, q.topRight);
  const bot = dist(q.bottomLeft, q.bottomRight);
  const left = dist(q.topLeft, q.bottomLeft);
  const right = dist(q.topRight, q.bottomRight);
  const trap = Math.max(
    Math.abs(top - bot) / Math.max(top, bot, 1),
    Math.abs(left - right) / Math.max(left, right, 1)
  );

  const minX = Math.min(q.topLeft.x, q.bottomLeft.x);
  const maxX = Math.max(q.topRight.x, q.bottomRight.x);
  const minY = Math.min(q.topLeft.y, q.topRight.y);
  const maxY = Math.max(q.bottomLeft.y, q.bottomRight.y);
  const inset =
    minX > w * 0.035 ||
    minY > h * 0.035 ||
    w - maxX > w * 0.035 ||
    h - maxY > h * 0.035;

  const skewY = Math.abs(q.topLeft.y - q.topRight.y) / h;
  const skewX = Math.abs(q.topLeft.x - q.bottomLeft.x) / w;
  const skewY2 = Math.abs(q.bottomLeft.y - q.bottomRight.y) / h;
  const geometric = trap > 0.02 || skewY > 0.01 || skewX > 0.01 || skewY2 > 0.01;

  // 本文領域の矩形余白はトリムしない（アバターやヘッダーを切るため）
  if (method === "content") return geometric;
  return geometric || inset;
}

function morphCloseBinary(src: Uint8Array, w: number, h: number): Uint8Array {
  const dil = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++) {
        const row = (y + dy) * w + x;
        if (src[row - 1] | src[row] | src[row + 1]) on = 1;
      }
      dil[y * w + x] = on;
    }
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let on = 1;
      for (let dy = -1; dy <= 1 && on; dy++) {
        const row = (y + dy) * w + x;
        if (!(dil[row - 1] & dil[row] & dil[row + 1])) on = 0;
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

interface BlobExtremes {
  area: number;
  tl: Point2D;
  tr: Point2D;
  br: Point2D;
  bl: Point2D;
}

function largestBrightBlob(binary: Uint8Array, w: number, h: number): BlobExtremes | null {
  const visited = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let best: BlobExtremes | null = null;

  for (let seed = 0; seed < binary.length; seed++) {
    if (!binary[seed] || visited[seed]) continue;
    let sp = 0;
    stack[sp++] = seed;
    visited[seed] = 1;
    let area = 0;
    let minSum = Infinity;
    let maxDiff = -Infinity;
    let maxSum = -Infinity;
    let maxYmx = -Infinity;
    let tl = { x: 0, y: 0 };
    let tr = { x: 0, y: 0 };
    let br = { x: 0, y: 0 };
    let bl = { x: 0, y: 0 };

    while (sp > 0) {
      const i = stack[--sp];
      area++;
      const x = i % w;
      const y = (i - x) / w;
      const sum = x + y;
      const diff = x - y;
      const ymx = y - x;
      if (sum < minSum) {
        minSum = sum;
        tl = { x, y };
      }
      if (diff > maxDiff) {
        maxDiff = diff;
        tr = { x, y };
      }
      if (sum > maxSum) {
        maxSum = sum;
        br = { x, y };
      }
      if (ymx > maxYmx) {
        maxYmx = ymx;
        bl = { x, y };
      }
      if (x > 0 && binary[i - 1] && !visited[i - 1]) {
        visited[i - 1] = 1;
        stack[sp++] = i - 1;
      }
      if (x + 1 < w && binary[i + 1] && !visited[i + 1]) {
        visited[i + 1] = 1;
        stack[sp++] = i + 1;
      }
      if (y > 0 && binary[i - w] && !visited[i - w]) {
        visited[i - w] = 1;
        stack[sp++] = i - w;
      }
      if (y + 1 < h && binary[i + w] && !visited[i + w]) {
        visited[i + w] = 1;
        stack[sp++] = i + w;
      }
    }

    if (!best || area > best.area) {
      best = { area, tl, tr, br, bl };
    }
  }

  return best;
}

function otsuThreshold(gray: Uint8Array): number {
  const hist = new Int32Array(256);
  for (let i = 0; i < gray.length; i++) {
    hist[gray[i]]++;
  }
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const betweenVar = wB * wF * (mB - mF) * (mB - mF);
    if (betweenVar > maxVar) {
      maxVar = betweenVar;
      threshold = t;
    }
  }
  return threshold;
}

function detectBlobQuad(gray: Uint8Array, w: number, h: number): QuadDetectionResult | null {
  // 大津の自動二値化（Otsu）により、照明環境に左右されず発光画面・書類のBlobを確実に分離
  const otsuT = otsuThreshold(gray);
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    binary[i] = gray[i] > otsuT ? 1 : 0;
  }
  const closed = morphCloseBinary(morphCloseBinary(binary, w, h), w, h);

  const blob = largestBrightBlob(closed, w, h);
  if (!blob) return null;
  const frac = blob.area / (w * h);
  if (frac < 0.15 || frac > 0.98) return null;

  const corners: QuadCorners = {
    topLeft: blob.tl,
    topRight: blob.tr,
    bottomRight: blob.br,
    bottomLeft: blob.bl
  };
  if (!isValidDocumentQuad(corners, w, h)) return null;

  const conf = clamp(0.60 + frac * 0.35, 0, 0.98);
  return { corners, confidence: conf, method: "blob" };
}

function detectContentQuad(gray: Uint8Array, w: number, h: number): QuadDetectionResult | null {
  const rowE = new Float32Array(h);
  for (let y = 1; y < h - 1; y++) {
    let e = 0;
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      e += Math.abs(gray[i] - gray[i - 1]) + Math.abs(gray[i] - gray[i - w]);
    }
    rowE[y] = e / Math.max(1, w - 2);
  }

  let mean = 0;
  for (let y = 0; y < h; y++) mean += rowE[y];
  mean /= h;
  const thresh = Math.max(6, mean * 1.15);

  let y0 = 0;
  let y1 = h - 1;
  for (let y = 0; y < h; y++) {
    if (rowE[y] >= thresh) {
      y0 = y;
      break;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    if (rowE[y] >= thresh) {
      y1 = y;
      break;
    }
  }
  const contentH = y1 - y0;
  if (contentH < h * 0.32) return null;

  const band = Math.max(4, Math.round(contentH * 0.08));

  const bandXs = (ya: number, yb: number): { left: number; right: number } | null => {
    const xs: number[] = [];
    const localT = thresh * 0.85;
    for (let y = ya; y <= yb; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const e = Math.abs(gray[i] - gray[i - 1]) + Math.abs(gray[i] - gray[i - w]);
        if (e > localT) xs.push(x);
      }
    }
    if (xs.length < 12) return null;
    xs.sort((a, b) => a - b);
    const lo = xs[Math.floor(xs.length * 0.06)];
    const hi = xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.94))];
    if (hi - lo < w * 0.28) return null;
    return { left: lo, right: hi };
  };

  const top = bandXs(y0, Math.min(h - 1, y0 + band));
  const bot = bandXs(Math.max(0, y1 - band), y1);
  if (!top || !bot) return null;

  const corners: QuadCorners = {
    topLeft: { x: top.left, y: y0 },
    topRight: { x: top.right, y: y0 },
    bottomRight: { x: bot.right, y: y1 },
    bottomLeft: { x: bot.left, y: y1 }
  };
  if (!isValidDocumentQuad(corners, w, h)) return null;

  const trap =
    Math.abs(top.right - top.left - (bot.right - bot.left)) / Math.max(top.right - top.left, 1);
  const conf = clamp(0.4 + (trap > 0.02 ? 0.2 : 0) + contentH / h * 0.25, 0, 0.9);
  return { corners, confidence: conf, method: "content" };
}

function detectEdgeQuad(gray: Uint8Array, w: number, h: number): QuadDetectionResult | null {
  const mag = new Float32Array(w * h);
  let total = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] +
        gray[(y - 1) * w + (x + 1)] +
        -2 * gray[y * w + (x - 1)] +
        2 * gray[y * w + (x + 1)] +
        -gray[(y + 1) * w + (x - 1)] +
        gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] -
        2 * gray[(y - 1) * w + x] -
        gray[(y - 1) * w + (x + 1)] +
        gray[(y + 1) * w + (x - 1)] +
        2 * gray[(y + 1) * w + x] +
        gray[(y + 1) * w + (x + 1)];
      const m = Math.hypot(gx, gy);
      mag[y * w + x] = m;
      total += m;
      n++;
    }
  }
  const avg = n > 0 ? total / n : 0;
  const threshold = avg * 2.0;
  const pts: Point2D[] = [];
  const padX = Math.floor(w * 0.015);
  const padY = Math.floor(h * 0.015);
  for (let y = padY; y < h - padY; y++) {
    for (let x = padX; x < w - padX; x++) {
      if (mag[y * w + x] > threshold) pts.push({ x, y });
    }
  }
  if (pts.length < 40) return null;
  const corners = extremesToQuad(pts);
  if (!corners || !isValidDocumentQuad(corners, w, h)) return null;
  const areaFrac = quadArea(corners) / (w * h);
  if (areaFrac > 0.985 && !quadNeedsWarp(corners, w, h, "edges")) return null;
  return { corners, confidence: 0.5, method: "edges" };
}

interface LineAbc {
  a: number;
  b: number;
  c: number;
}

function lineFromPoints(p1: Point2D, p2: Point2D): LineAbc {
  return {
    a: p1.y - p2.y,
    b: p2.x - p1.x,
    c: p1.x * p2.y - p2.x * p1.y
  };
}

function pointLineDist(p: Point2D, line: LineAbc): number {
  return Math.abs(line.a * p.x + line.b * p.y + line.c) / Math.max(1e-6, Math.hypot(line.a, line.b));
}

function intersectLines(l1: LineAbc, l2: LineAbc): Point2D | null {
  const det = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(det) < 1e-8) return null;
  return {
    x: (l1.b * l2.c - l2.b * l1.c) / det,
    y: (l2.a * l1.c - l1.a * l2.c) / det
  };
}

function leastSquaresLine(pts: Point2D[], verticalBias: boolean): LineAbc | null {
  const n = pts.length;
  if (n < 4) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    syy += p.y * p.y;
    sxy += p.x * p.y;
  }
  const varx = sxx - (sx * sx) / n;
  const vary = syy - (sy * sy) / n;
  if (verticalBias || vary > varx) {
    const den = n * syy - sy * sy;
    if (Math.abs(den) < 1e-6) return null;
    const m = (n * sxy - sx * sy) / den;
    const k = (sx - m * sy) / n;
    return { a: 1, b: -m, c: -k };
  }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-6) return null;
  const m = (n * sxy - sx * sy) / den;
  const k = (sy - m * sx) / n;
  return { a: m, b: -1, c: k };
}

function ransacLine(points: Point2D[], distThresh: number, verticalBias: boolean): LineAbc | null {
  if (points.length < 10) return null;
  const n = points.length;
  const iters = Math.min(70, 12 + Math.floor(n / 8));
  let best: Point2D[] = [];
  for (let i = 0; i < iters; i++) {
    const i1 = (i * 17 + 3) % n;
    const i2 = (i * 29 + 11) % n;
    if (i1 === i2) continue;
    const cand = lineFromPoints(points[i1], points[i2]);
    const inliers: Point2D[] = [];
    for (const p of points) {
      if (pointLineDist(p, cand) <= distThresh) inliers.push(p);
    }
    if (inliers.length > best.length) best = inliers;
  }
  if (best.length < 8) return null;
  return leastSquaresLine(best, verticalBias);
}

function computeSobel(
  gray: Uint8Array,
  w: number,
  h: number
): { mag: Float32Array; gx: Float32Array; gy: Float32Array; avg: number } {
  const mag = new Float32Array(w * h);
  const gxA = new Float32Array(w * h);
  const gyA = new Float32Array(w * h);
  let total = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] +
        gray[(y - 1) * w + (x + 1)] +
        -2 * gray[y * w + (x - 1)] +
        2 * gray[y * w + (x + 1)] +
        -gray[(y + 1) * w + (x - 1)] +
        gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] -
        2 * gray[(y - 1) * w + x] -
        gray[(y - 1) * w + (x + 1)] +
        gray[(y + 1) * w + (x - 1)] +
        2 * gray[(y + 1) * w + x] +
        gray[(y + 1) * w + (x + 1)];
      const m = Math.hypot(gx, gy);
      const i = y * w + x;
      gxA[i] = gx;
      gyA[i] = gy;
      mag[i] = m;
      total += m;
      n++;
    }
  }
  return { mag, gx: gxA, gy: gyA, avg: n > 0 ? total / n : 0 };
}

function collectBandEdges(
  mag: Float32Array,
  gx: Float32Array,
  gy: Float32Array,
  w: number,
  h: number,
  band: "top" | "bottom" | "left" | "right",
  thresh: number
): Point2D[] {
  const pts: Point2D[] = [];
  const yA = band === "top" ? Math.floor(h * 0.02) : band === "bottom" ? Math.floor(h * 0.68) : Math.floor(h * 0.06);
  const yB = band === "top" ? Math.floor(h * 0.32) : band === "bottom" ? Math.floor(h * 0.98) : Math.floor(h * 0.94);
  const xA = band === "left" ? Math.floor(w * 0.02) : band === "right" ? Math.floor(w * 0.68) : Math.floor(w * 0.06);
  const xB = band === "left" ? Math.floor(w * 0.32) : band === "right" ? Math.floor(w * 0.98) : Math.floor(w * 0.94);
  const wantHoriz = band === "top" || band === "bottom";
  for (let y = yA; y < yB; y += 1) {
    for (let x = xA; x < xB; x += 1) {
      const i = y * w + x;
      if (mag[i] < thresh) continue;
      const horiz = Math.abs(gy[i]) >= Math.abs(gx[i]);
      if (wantHoriz !== horiz) continue;
      pts.push({ x, y });
    }
  }
  return pts;
}

function detectLineQuad(
  mag: Float32Array,
  gx: Float32Array,
  gy: Float32Array,
  w: number,
  h: number,
  avg: number
): QuadDetectionResult | null {
  const thresh = Math.max(12, avg * 1.7);
  const distT = Math.max(1.6, Math.min(w, h) * 0.008);
  const top = ransacLine(collectBandEdges(mag, gx, gy, w, h, "top", thresh), distT, false);
  const bot = ransacLine(collectBandEdges(mag, gx, gy, w, h, "bottom", thresh), distT, false);
  const left = ransacLine(collectBandEdges(mag, gx, gy, w, h, "left", thresh), distT, true);
  const right = ransacLine(collectBandEdges(mag, gx, gy, w, h, "right", thresh), distT, true);
  if (!top || !bot || !left || !right) return null;

  const tl = intersectLines(top, left);
  const tr = intersectLines(top, right);
  const br = intersectLines(bot, right);
  const bl = intersectLines(bot, left);
  if (!tl || !tr || !br || !bl) return null;

  const corners: QuadCorners = {
    topLeft: tl,
    topRight: tr,
    bottomRight: br,
    bottomLeft: bl
  };
  if (!isValidDocumentQuad(corners, w, h)) return null;
  const border = scoreQuadBorders(corners, mag, w, h);
  return {
    corners,
    confidence: clamp(0.55 + border * 0.4, 0, 0.98),
    method: "lines"
  };
}

function scoreQuadBorders(q: QuadCorners, mag: Float32Array, w: number, h: number): number {
  const sides: [Point2D, Point2D][] = [
    [q.topLeft, q.topRight],
    [q.topRight, q.bottomRight],
    [q.bottomRight, q.bottomLeft],
    [q.bottomLeft, q.topLeft]
  ];
  let acc = 0;
  let n = 0;
  for (const [a, b] of sides) {
    const steps = 28;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      acc += mag[y * w + x];
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = acc / n;
  return clamp(mean / 80, 0, 1);
}

function refineCorner(
  mag: Float32Array,
  gx: Float32Array,
  gy: Float32Array,
  cx: number,
  cy: number,
  w: number,
  h: number,
  avg: number
): Point2D {
  const r = 9;
  const thresh = Math.max(10, avg * 1.4);
  const horiz: Point2D[] = [];
  const vert: Point2D[] = [];
  const x0 = Math.max(1, Math.round(cx) - r);
  const x1 = Math.min(w - 2, Math.round(cx) + r);
  const y0 = Math.max(1, Math.round(cy) - r);
  const y1 = Math.min(h - 2, Math.round(cy) + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (mag[i] < thresh) continue;
      if (Math.abs(gy[i]) >= Math.abs(gx[i])) horiz.push({ x, y });
      else vert.push({ x, y });
    }
  }
  if (horiz.length < 5 || vert.length < 5) return { x: cx, y: cy };
  const hLine = leastSquaresLine(horiz, false);
  const vLine = leastSquaresLine(vert, true);
  if (!hLine || !vLine) return { x: cx, y: cy };
  const hit = intersectLines(hLine, vLine);
  if (!hit) return { x: cx, y: cy };
  if (Math.hypot(hit.x - cx, hit.y - cy) > r * 1.2) return { x: cx, y: cy };
  return hit;
}

function refineQuad(
  q: QuadCorners,
  mag: Float32Array,
  gx: Float32Array,
  gy: Float32Array,
  w: number,
  h: number,
  avg: number
): QuadCorners {
  return {
    topLeft: refineCorner(mag, gx, gy, q.topLeft.x, q.topLeft.y, w, h, avg),
    topRight: refineCorner(mag, gx, gy, q.topRight.x, q.topRight.y, w, h, avg),
    bottomRight: refineCorner(mag, gx, gy, q.bottomRight.x, q.bottomRight.y, w, h, avg),
    bottomLeft: refineCorner(mag, gx, gy, q.bottomLeft.x, q.bottomLeft.y, w, h, avg)
  };
}

/**
 * 縮小画像上で画面四隅を複数戦略で検出する
 */
export function detectScreenQuadOnGray(
  gray: Uint8Array,
  w: number,
  h: number
): QuadDetectionResult {
  const fallback: QuadDetectionResult = {
    corners: defaultQuadCorners(w, h),
    confidence: 0,
    method: "fallback"
  };

  const sobel = computeSobel(gray, w, h);
  const candidates: QuadDetectionResult[] = [];
  const lines = detectLineQuad(sobel.mag, sobel.gx, sobel.gy, w, h, sobel.avg);
  if (lines) candidates.push(lines);
  const blob = detectBlobQuad(gray, w, h);
  if (blob) candidates.push(blob);
  const content = detectContentQuad(gray, w, h);
  if (content) candidates.push(content);
  const edges = detectEdgeQuad(gray, w, h);
  if (edges) candidates.push(edges);

  if (candidates.length === 0) return fallback;

  const scored = candidates.map((c) => {
    const refined = refineQuad(c.corners, sobel.mag, sobel.gx, sobel.gy, w, h, sobel.avg);
    const valid = isValidDocumentQuad(refined, w, h) ? refined : c.corners;
    const border = scoreQuadBorders(valid, sobel.mag, w, h);
    const warp = quadNeedsWarp(valid, w, h, c.method) ? 0.18 : 0;
    return {
      ...c,
      corners: valid,
      confidence: clamp(c.confidence * 0.55 + border * 0.45 + warp, 0, 0.99)
    };
  });

  scored.sort((a, b) => b.confidence - a.confidence);
  return scored[0];
}

/**
 * 元画像から画面・書類の四隅を検出
 */
export function detectDocumentCornersDetailed(
  source: HTMLImageElement | HTMLCanvasElement
): QuadDetectionResult {
  const origW = source.width;
  const origH = source.height;
  const fallback: QuadDetectionResult = {
    corners: defaultQuadCorners(origW, origH),
    confidence: 0,
    method: "fallback"
  };

  const scale = Math.min(1, 400 / origW);
  const w = Math.round(origW * scale);
  const h = Math.round(origH * scale);
  if (w < 50 || h < 50) return fallback;

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
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] + 0.5;
  }

  const found = detectScreenQuadOnGray(gray, w, h);
  const inv = 1 / scale;

  const tl = { x: Math.round(found.corners.topLeft.x * inv), y: Math.round(found.corners.topLeft.y * inv) };
  const tr = { x: Math.round(found.corners.topRight.x * inv), y: Math.round(found.corners.topRight.y * inv) };
  const br = { x: Math.round(found.corners.bottomRight.x * inv), y: Math.round(found.corners.bottomRight.y * inv) };
  const bl = { x: Math.round(found.corners.bottomLeft.x * inv), y: Math.round(found.corners.bottomLeft.y * inv) };

  const candidateCorners: QuadCorners = { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
  const area = quadArea(candidateCorners);
  const totalArea = origW * origH;
  const areaRatio = area / totalArea;

  // 1. "content" (文字行バウンディングボックス) のみの場合は、ヘッダー削れ防止のため全体枠にフォールバック
  if (found.method === "content") {
    return fallback;
  }

  // 2. 面積が極端に小さい（画像全体の15%未満）か大きすぎる（99%超）場合は全体枠にフォールバック
  if (areaRatio < 0.15 || areaRatio > 0.99) {
    return fallback;
  }

  // 3. 検出された四隅ピンを中心から2.5%外側にセーフ展開し、本文やヘッダーが切り落とされるのを防止
  const cx = (tl.x + tr.x + br.x + bl.x) / 4;
  const cy = (tl.y + tr.y + br.y + bl.y) / 4;
  const expand = 1.025; // 中心から2.5%外側に押し広げて安全マージンを確保

  const expandPt = (p: Point2D): Point2D => ({
    x: clamp(Math.round(cx + (p.x - cx) * expand), 0, origW),
    y: clamp(Math.round(cy + (p.y - cy) * expand), 0, origH)
  });

  const safeCorners: QuadCorners = {
    topLeft: expandPt(tl),
    topRight: expandPt(tr),
    bottomRight: expandPt(br),
    bottomLeft: expandPt(bl)
  };

  return {
    corners: safeCorners,
    confidence: found.confidence,
    method: found.method
  };
}
