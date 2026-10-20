/**
 * 実写の顔・写真アバターを検出する。
 * 円形や高コントラストというだけでは人物と判定しない。
 * イニシャル、単色アイコン、本文は自動黒塗りの対象にしない。
 */
export interface AvatarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedFaceOrAvatar {
  id: string;
  type: "face" | "avatar";
  rect: AvatarRect;
  confidence: number;
  label: string;
}

export interface FaceDetectionOptions {
  /** 元画像座標の OCR 本文領域。独自の写真推定が文字へ食い込むのを防ぐ。 */
  textRegions?: AvatarRect[];
}

/**
 * knownAvatars は探索位置のヒント。内容未確認の座標を人物とは扱わない。
 * ネイティブ顔検出の結果には肌色・色彩による制限を設けない。
 */
export async function detectFacesAndAvatars(
  imageElement: HTMLImageElement | HTMLCanvasElement,
  knownAvatars?: AvatarRect[],
  options: FaceDetectionOptions = {}
): Promise<DetectedFaceOrAvatar[]> {
  const width = imageElement.width;
  const height = imageElement.height;
  if (!(width > 0 && height > 0)) return [];
  const results: DetectedFaceOrAvatar[] = [];

  if (typeof window !== "undefined" && "FaceDetector" in window) {
    try {
      const FaceDetectorClass = (window as unknown as {
        FaceDetector: new (options: { fastMode: boolean; maxDetectedFaces: number }) => {
          detect(source: HTMLImageElement | HTMLCanvasElement): Promise<{
            boundingBox: AvatarRect;
          }[]>;
        };
      }).FaceDetector;
      const detector = new FaceDetectorClass({ fastMode: true, maxDetectedFaces: 20 });
      for (const face of await detector.detect(imageElement)) {
        const rect = clampRect(face.boundingBox, width, height);
        if (!rect || results.some(item => isOverlap(item.rect, rect, 0.5))) continue;
        results.push({
          id: `face-native-${rect.x}-${rect.y}`,
          type: "face",
          rect,
          confidence: 0.95,
          label: "顔写真"
        });
      }
    } catch (error) {
      console.warn("Native FaceDetector failed or not supported:", error);
    }
  }

  // 原寸 Canvas や二重読取りを作らず、最初から縮小画像へ描画する。
  const scale = Math.min(1, 512 / width, 1600 / height);
  const sw = Math.max(1, Math.round(width * scale));
  const sh = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return results;
  try {
    ctx.drawImage(imageElement, 0, 0, sw, sh);
    const pixels = ctx.getImageData(0, 0, sw, sh).data;
    const scaleRect = (rect: AvatarRect): AvatarRect => ({
      x: rect.x * sw / width,
      y: rect.y * sh / height,
      width: rect.width * sw / width,
      height: rect.height * sh / height
    });
    const textRegions = (options.textRegions || []).map(scaleRect);
    const hints = (knownAvatars || []).map(scaleRect);
    for (const candidate of detectPhotoAvatarCandidates(pixels, sw, sh, textRegions, hints)) {
      const rect = clampRect({
        x: candidate.rect.x * width / sw,
        y: candidate.rect.y * height / sh,
        width: candidate.rect.width * width / sw,
        height: candidate.rect.height * height / sh
      }, width, height);
      if (!rect || results.some(item => isOverlap(item.rect, rect, 0.3))) continue;
      results.push({ ...candidate, id: `face-photo-${rect.x}-${rect.y}`, rect });
    }
  } catch (error) {
    // 読取り不能な画像でも、すでに確認したネイティブ顔は失わない。
    console.warn("Photo avatar analysis failed:", error);
  }
  return results;
}

function clampRect(rect: AvatarRect, width: number, height: number): AvatarRect | null {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const right = Math.min(width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(height, Math.ceil(rect.y + rect.height));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function isOverlap(a: AvatarRect, b: AvatarRect, threshold: number): boolean {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 && w * h >= Math.min(a.width * a.height, b.width * b.height) * threshold;
}

/**
 * 固定数の画素だけを調べる純粋関数。巨大画像でも候補ごとの計算量は変わらない。
 * 肌色だけでは顔を認定できないので、色階調と背景からの分離も必須にする。
 */
export function evaluatePhotoAvatar(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  rect: AvatarRect
): number {
  if (rect.width < 10 || rect.height < 10 || rect.x < 0 || rect.y < 0 ||
      rect.x + rect.width > width || rect.y + rect.height > height) return 0;
  const histogram = new Uint16Array(512);
  let count = 0;
  let skin = 0;
  let centerSkin = 0;
  let centerCount = 0;
  let dark = 0;
  let sum = 0;
  let sumSquared = 0;
  let dominant = 0;
  let colorBins = 0;
  let skinBins = 0;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;

  // 円形内部の 13 × 13 格子。端のアンチエイリアスで階調数を水増ししない。
  for (let gy = -6; gy <= 6; gy++) {
    for (let gx = -6; gx <= 6; gx++) {
      if (gx * gx + gy * gy > 36) continue;
      const x = Math.min(width - 1, Math.floor(cx + gx * rect.width * 0.064));
      const y = Math.min(height - 1, Math.floor(cy + gy * rect.height * 0.064));
      const i = (y * width + x) * 4;
      if (rgba[i + 3] < 128) continue;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const bin = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
      const frequency = ++histogram[bin];
      dominant = Math.max(dominant, frequency);
      if (frequency === 2) colorBins++;
      const isSkin = r > 60 && g > 30 && b > 15 && r - g > 12 && r > b &&
        Math.max(r, g, b) - Math.min(r, g, b) > 15;
      if (isSkin) {
        skin++;
        if (frequency === 2) skinBins++;
      }
      if (gx * gx + gy * gy <= 9) {
        centerCount++;
        if (isSkin) centerSkin++;
      }
      const lum = (r * 77 + g * 150 + b * 29) / 256;
      if (lum < 95) dark++;
      sum += lum;
      sumSquared += lum * lum;
      count++;
    }
  }
  if (count < 70 || centerCount < 15) return 0;
  const skinRatio = skin / count;
  const stdDev = Math.sqrt(Math.max(0, sumSquared / count - (sum / count) ** 2));
  // 単色背景＋文字は分散が大きくても、主色の占有率・階調数で落とす。
  if (skinRatio < 0.16 || skinRatio > 0.85 || centerSkin / centerCount < 0.2 ||
      dominant / count > 0.48 || colorBins < 8 || skinBins < 3 ||
      stdDev < 18 || dark / count < 0.05) return 0;

  // 外周が同じ背景へ戻ることを確認する。吹き出し・文章の一部には成立しにくい。
  const outside: [number, number, number][] = [];
  for (let a = 0; a < 16; a++) {
    const angle = a * Math.PI / 8;
    const x = Math.round(cx + Math.cos(angle) * rect.width * 0.64);
    const y = Math.round(cy + Math.sin(angle) * rect.height * 0.64);
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const i = (y * width + x) * 4;
    outside.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  if (outside.length < 12) return 0;
  let uniformBackground = 0;
  for (const reference of outside) {
    let matching = 0;
    for (const point of outside) {
      if (Math.abs(reference[0] - point[0]) + Math.abs(reference[1] - point[1]) +
          Math.abs(reference[2] - point[2]) < 45) matching++;
    }
    uniformBackground = Math.max(uniformBackground, matching);
  }
  if (uniformBackground < outside.length * 0.75) return 0;
  return Math.min(0.9, 0.76 + Math.min(0.08, colorBins / 180) + Math.min(0.06, stdDev / 1000));
}

/** 合格した少数の候補だけ、背景との差で輪郭を取り直す。探索格子の余白を黒塗りしない。 */
function refinePhotoRect(
  rgba: Uint8ClampedArray, width: number, height: number, rect: AvatarRect
): AvatarRect {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const outside: number[] = [];
  for (let a = 0; a < 16; a++) {
    const angle = a * Math.PI / 8;
    const x = Math.round(cx + Math.cos(angle) * rect.width * 0.64);
    const y = Math.round(cy + Math.sin(angle) * rect.height * 0.64);
    if (x >= 0 && x < width && y >= 0 && y < height) outside.push((y * width + x) * 4);
  }
  let reference = outside[0];
  let bestMatches = 0;
  for (const point of outside) {
    const matches = outside.filter(other =>
      Math.abs(rgba[point] - rgba[other]) + Math.abs(rgba[point + 1] - rgba[other + 1]) +
      Math.abs(rgba[point + 2] - rgba[other + 2]) < 45).length;
    if (matches > bestMatches) { bestMatches = matches; reference = point; }
  }
  if (reference === undefined) return rect;
  const search = clampRect({
    x: rect.x - rect.width * 0.3, y: rect.y - rect.height * 0.3,
    width: rect.width * 1.6, height: rect.height * 1.6
  }, width, height);
  if (!search) return rect;
  const isForeground = (localIndex: number): boolean => {
    const x = search.x + localIndex % search.width;
    const y = search.y + Math.floor(localIndex / search.width);
    const i = (y * width + x) * 4;
    return rgba[i + 3] >= 128 && Math.abs(rgba[i] - rgba[reference]) +
      Math.abs(rgba[i + 1] - rgba[reference + 1]) + Math.abs(rgba[i + 2] - rgba[reference + 2]) >= 45;
  };
  const seed = (Math.floor(cy) - search.y) * search.width + Math.floor(cx) - search.x;
  if (!isForeground(seed)) return rect;
  const visited = new Uint8Array(search.width * search.height);
  const queue = new Int32Array(visited.length);
  queue[0] = seed;
  visited[seed] = 1;
  let head = 0;
  let tail = 1;
  let left = search.width;
  let top = search.height;
  let right = 0;
  let bottom = 0;
  while (head < tail) {
    const index = queue[head++];
    const x = index % search.width;
    const y = Math.floor(index / search.width);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    const neighbors = [x > 0 ? index - 1 : -1, x + 1 < search.width ? index + 1 : -1,
      y > 0 ? index - search.width : -1, y + 1 < search.height ? index + search.width : -1];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || visited[neighbor]) continue;
      visited[neighbor] = 1;
      if (isForeground(neighbor)) queue[tail++] = neighbor;
    }
  }
  // 探索範囲の端へ繋がる場合は、周辺の別要素を巻き込む危険がある。
  if (left === 0 || top === 0 || right + 1 === search.width || bottom + 1 === search.height) return rect;
  const refined = { x: search.x + left, y: search.y + top, width: right - left + 1, height: bottom - top + 1 };
  if (refined.width < rect.width * 0.5 || refined.height < rect.height * 0.5 ||
      refined.width > rect.width * 1.3 || refined.height > rect.height * 1.3) return rect;
  return refined;
}

/** ピクセルと OCR 座標だけを使うため、画像回帰テストでブラウザなしに検証できる。 */
export function detectPhotoAvatarCandidates(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  textRegions: AvatarRect[] = [],
  knownRegions: AvatarRect[] = []
): DetectedFaceOrAvatar[] {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return [];
  const candidates: DetectedFaceOrAvatar[] = [];
  const testCandidate = (rect: AvatarRect) => {
    // 本文が少しでも候補へ入り込むと、そのまま自動黒塗りしない。
    if (textRegions.some(text => isOverlap(rect, text, 0.15))) return;
    const confidence = evaluatePhotoAvatar(rgba, width, height, rect);
    if (confidence === 0) return;
    candidates.push({
      id: `face-photo-${rect.x}-${rect.y}`,
      type: "face",
      rect,
      confidence,
      label: "顔写真候補"
    });
  };

  for (const known of knownRegions) {
    const rect = clampRect(known, width, height);
    if (rect) testCandidate(rect);
  }

  // Teams / Slack のサイドバー付き画面では人物写真が画像の中央列にある。
  // OCR の本文・名前の左端を列へまとめ、左隣だけを上限付きで探索する。
  const columnWidth = Math.max(4, width * 0.015);
  const textColumns = new Map<number, AvatarRect[]>();
  for (const region of textRegions) {
    if (![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
        region.x < width * 0.18 || region.x > width * 0.9 || region.height < 3 ||
        region.height > height * 0.1 || region.width < 10) continue;
    const key = Math.round(region.x / columnWidth);
    const column = textColumns.get(key) || [];
    column.push(region);
    textColumns.set(key, column);
  }
  const centralColumns = [...textColumns.values()].sort((a, b) => b.length - a.length).slice(0, 4);
  for (const column of centralColumns) {
    const sorted = column.slice().sort((a, b) => a.y - b.y);
    const count = Math.min(24, sorted.length);
    for (let row = 0; row < count; row++) {
      const region = sorted[Math.floor(row * sorted.length / count)];
      // 幅の大きいデスクトップ画像でも、行の高さから小さい写真を探索できる。
      const localSizes = [...new Set([1.6, 2.1, 2.7].map(r => Math.max(10, Math.round(region.height * r))))];
      for (const size of localSizes) {
        if (size > width * 0.2) continue;
        for (const gap of [0.35, 0.65]) {
          const x = Math.round(region.x - size - region.height * gap);
          for (const offset of [0, 0.35, 0.7]) {
            const y = Math.round(region.y - size * offset);
            if (x >= 0 && y >= 0 && x + size <= width && y + size <= height) {
              testCandidate({ x, y, width: size, height: size });
            }
          }
        }
      }
    }
  }
  const sizes = [...new Set([0.05, 0.07, 0.095, 0.12, 0.16].map(r => Math.round(width * r)))].filter(s => s >= 10);
  for (const size of sizes) {
    const step = Math.max(5, Math.round(size * 0.3));
    const columns = [...new Set([0.03, 0.05, 0.07, 0.09, 0.11].flatMap(r => [
      Math.round(width * r), Math.round(width * (1 - r)) - size
    ]))];
    for (const x of columns) {
      if (x < 0 || x + size > width) continue;
      for (let y = Math.round(height * 0.06); y + size < height * 0.94; y += step) {
        testCandidate({ x, y, width: size, height: size });
      }
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const selected: DetectedFaceOrAvatar[] = [];
  for (const candidate of candidates) {
    if (selected.some(item => isOverlap(item.rect, candidate.rect, 0.3))) continue;
    const rect = refinePhotoRect(rgba, width, height, candidate.rect);
    if (selected.some(item => isOverlap(item.rect, rect, 0.3)) ||
        textRegions.some(text => isOverlap(rect, text, 0.15))) continue;
    selected.push({ ...candidate, id: `face-photo-${rect.x}-${rect.y}`, rect });
    if (selected.length >= 20) break;
  }
  return selected;
}
