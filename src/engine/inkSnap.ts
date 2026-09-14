/**
 * OCR 矩形を実際の文字インクへスナップする（AI不使用）
 * 撮影・前処理で座標が数px〜数十pxズレても、近傍の文字画素に箱を合わせる。
 */

export interface InkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function overlapRatio(a: InkRect, b: InkRect): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) return 0;
  const inter = (x1 - x0) * (y1 - y0);
  const minArea = Math.min(a.width * a.height, b.width * b.height) || 1;
  return inter / minArea;
}

function fitWindowToInk(
  gray: Uint8Array,
  w: number,
  h: number,
  rect: InkRect
): InkRect | null {
  if (rect.width < 2 || rect.height < 2) return null;

  const padX = Math.max(14, Math.round(rect.width * 0.85), Math.round(w * 0.03));
  const padY = Math.max(10, Math.round(rect.height * 1.1));
  const x0 = clamp(Math.floor(rect.x - padX), 0, w - 1);
  const y0 = clamp(Math.floor(rect.y - padY), 0, h - 1);
  const x1 = clamp(Math.ceil(rect.x + rect.width + padX), 0, w - 1);
  const y1 = clamp(Math.ceil(rect.y + rect.height + padY), 0, h - 1);

  let sum = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * w;
    for (let x = x0; x <= x1; x++) {
      sum += gray[row + x];
      n++;
    }
  }
  if (n < 16) return null;
  const mean = sum / n;

  let darkN = 0;
  let brightN = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * w;
    for (let x = x0; x <= x1; x++) {
      const v = gray[row + x];
      if (v < mean - 14) darkN++;
      else if (v > mean + 14) brightN++;
    }
  }
  const inkDark = darkN >= brightN;
  const t = inkDark ? mean - 16 : mean + 16;

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let inkN = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * w;
    for (let x = x0; x <= x1; x++) {
      const v = gray[row + x];
      const isInk = inkDark ? v < t : v > t;
      if (!isInk) continue;
      inkN++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (inkN < 10 || inkN > n * 0.5) return null;

  const fitted: InkRect = {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX + 1),
    height: Math.max(1, maxY - minY + 1)
  };

  if (fitted.width < 4 || fitted.height < 4) return null;
  if (fitted.height > rect.height * 2.8 && fitted.height > 48) {
    fitted.y = Math.max(fitted.y, Math.round(rect.y - rect.height * 0.35));
    fitted.height = Math.min(fitted.height, Math.round(rect.height * 1.8));
  }
  if (fitted.width > rect.width * 3.5 && fitted.width > 80) {
    const cx = rect.x + rect.width / 2;
    const maxW = Math.round(rect.width * 2.4);
    fitted.x = Math.round(cx - maxW / 2);
    fitted.width = maxW;
  }

  if (overlapRatio(fitted, rect) < 0.08) return null;
  return fitted;
}

/**
 * OCR由来の黒塗り矩形を、画像上の文字インクに合わせて更新する
 */
export function snapBoxesToInk(
  source: HTMLImageElement | HTMLCanvasElement,
  boxes: { type: string; isManual?: boolean; rect: InkRect }[]
): void {
  const w = source.width;
  const h = source.height;
  if (w < 8 || h < 8 || boxes.length === 0) return;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(source, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] + 0.5;
  }

  for (const box of boxes) {
    if (box.isManual || box.type === "face") continue;
    const fitted = fitWindowToInk(gray, w, h, box.rect);
    if (!fitted) continue;
    const pad = 2;
    box.rect.x = Math.max(0, fitted.x - pad);
    box.rect.y = Math.max(0, fitted.y - pad);
    box.rect.width = Math.min(w - box.rect.x, fitted.width + pad * 2);
    box.rect.height = Math.min(h - box.rect.y, fitted.height + pad * 2);
  }
}
