/**
 * 顔写真およびチャット画面アバター（アイコン）の精密検出器
 * 1. window.FaceDetector (ネイティブ Shape Detection API)
 * 2. チャット画面メッセージ左端に整列する円形・正方形アバターのみをピンポイント検出
 */

export interface DetectedFaceOrAvatar {
  id: string;
  type: "face" | "avatar";
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  label: string;
}

/**
 * 画像から顔およびチャットアバターを検出する
 * @param imageElement 対象画像
 * @param knownAvatars 事前に定義されたアバター座標（サンプル画像等）
 */
export async function detectFacesAndAvatars(
  imageElement: HTMLImageElement | HTMLCanvasElement,
  knownAvatars?: { x: number; y: number; width: number; height: number }[]
): Promise<DetectedFaceOrAvatar[]> {
  const results: DetectedFaceOrAvatar[] = [];

  // 事前定義アバターがある場合（サンプル画像等）
  if (knownAvatars && knownAvatars.length > 0) {
    for (let i = 0; i < knownAvatars.length; i++) {
      results.push({
        id: `avatar-known-${i}`,
        type: "avatar",
        rect: knownAvatars[i],
        confidence: 0.99,
        label: "チャットアイコン"
      });
    }
    return results;
  }

  // 1. ネイティブ FaceDetector API の試行（Chrome等で対応している場合）
  if (typeof window !== "undefined" && "FaceDetector" in window) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const FaceDetectorClass = (window as any).FaceDetector;
      const detector = new FaceDetectorClass({ fastMode: true, maxDetectedFaces: 10 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const faces: any[] = await detector.detect(imageElement);
      for (const face of faces) {
        const box = face.boundingBox;
        results.push({
          id: `face-native-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: "face",
          rect: {
            x: Math.round(box.x),
            y: Math.round(box.y),
            width: Math.round(box.width),
            height: Math.round(box.height)
          },
          confidence: 0.95,
          label: "顔写真"
        });
      }
    } catch (e) {
      console.warn("Native FaceDetector failed or not supported:", e);
    }
  }

  // 2. チャット画面特有のアバター（アイコン）幾何検出
  // 左端の固定縦カラム（X: 3%〜12%）にある円形・正方形アイコンのみを精密スキャン
  const avatarResults = detectChatAvatarsStrict(imageElement);
  for (const avatar of avatarResults) {
    const isOverlapped = results.some(r => isOverlap(r.rect, avatar.rect, 0.3));
    if (!isOverlapped) {
      results.push(avatar);
    }
  }

  return results;
}

function isOverlap(
  r1: { x: number; y: number; width: number; height: number },
  r2: { x: number; y: number; width: number; height: number },
  threshold: number = 0.3
): boolean {
  const xLeft = Math.max(r1.x, r2.x);
  const yTop = Math.max(r1.y, r2.y);
  const xRight = Math.min(r1.x + r1.width, r2.x + r2.width);
  const yBottom = Math.min(r1.y + r1.height, r2.y + r2.height);

  if (xRight <= xLeft || yBottom <= yTop) return false;
  const intersectionArea = (xRight - xLeft) * (yBottom - yTop);
  const minArea = Math.min(r1.width * r1.height, r2.width * r2.height);
  return (intersectionArea / minArea) >= threshold;
}

/**
 * チャットアバターの厳格検出
 * 余白や背景を絶対に誤検出しないよう、左端の垂直カラムに限定し高閾値で判定
 */
function detectChatAvatarsStrict(
  source: HTMLImageElement | HTMLCanvasElement
): DetectedFaceOrAvatar[] {
  const avatars: DetectedFaceOrAvatar[] = [];
  const width = source.width;
  const height = source.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(source, 0, 0);

  const scale = Math.min(1, 800 / Math.max(width, height));
  const sw = Math.round(width * scale);
  const sh = Math.round(height * scale);
  const scaledCanvas = document.createElement("canvas");
  scaledCanvas.width = sw;
  scaledCanvas.height = sh;
  const sctx = scaledCanvas.getContext("2d", { willReadFrequently: true });
  if (!sctx) return [];
  sctx.drawImage(canvas, 0, 0, sw, sh);

  const imgData = sctx.getImageData(0, 0, sw, sh);
  const data = imgData.data;

  // グレースケール化
  const gray = new Uint8Array(sw * sh);
  for (let i = 0; i < data.length; i += 4) {
    gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }

  const sizes = [
    Math.round(sw * 0.07),
    Math.round(sw * 0.09),
    Math.round(sw * 0.11)
  ].filter((s) => s >= 18);

  const startY = Math.round(sh * 0.11);
  const endY = Math.round(sh * 0.90);
  // 写真中央寄りのチャットや余白のある写真に対応できるよう探索範囲を拡張
  const xs = [0.05, 0.08, 0.11, 0.14, 0.17, 0.20, 0.23, 0.27].map((r) => Math.round(sw * r));

  interface Candidate {
    origX: number;
    origY: number;
    origSize: number;
    score: number;
  }
  const candidates: Candidate[] = [];

  for (const avatarSize of sizes) {
    const stepY = Math.max(8, Math.round(avatarSize * 0.25));
    for (const fixedX of xs) {
      if (fixedX + avatarSize >= sw) continue;
      for (let y = startY; y < endY - avatarSize; y += stepY) {
        const score = evaluateStrictAvatar(gray, data, sw, sh, fixedX, y, avatarSize);
        if (score >= 65) {
          candidates.push({
            origX: Math.round(fixedX / scale),
            origY: Math.round(y / scale),
            origSize: Math.round(avatarSize / scale),
            score
          });
        }
      }
    }
  }

  // スコア順にソートして重複排除
  candidates.sort((a, b) => b.score - a.score);

  for (const c of candidates) {
    const rect = { x: c.origX, y: c.origY, width: c.origSize, height: c.origSize };
    const isDup = avatars.some((a) => {
      if (isOverlap(a.rect, rect, 0.2)) return true;
      const sameCol = Math.abs(a.rect.x - rect.x) < rect.width * 0.6;
      const closeY = Math.abs(a.rect.y - rect.y) < rect.height * 0.55;
      return sameCol && closeY;
    });
    if (!isDup) {
      avatars.push({
        id: `avatar-strict-${c.origX}-${c.origY}`,
        type: "avatar",
        rect,
        confidence: Math.min(0.98, c.score / 100),
        label: "チャットアイコン"
      });
    }
    // 1画面のアバター数は最大でも6個程度
    if (avatars.length >= 6) break;
  }

  return avatars;
}

/**
 * 候補領域が本物のチャットアイコン（明確な円形・色変化）であるかを厳格判定
 */
function evaluateStrictAvatar(
  gray: Uint8Array,
  rgba: Uint8ClampedArray,
  sw: number,
  sh: number,
  x: number,
  y: number,
  size: number
): number {
  if (x + size >= sw || y + size >= sh) return 0;

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  let satSum = 0;
  const half = Math.floor(size / 2);
  const cx = x + half;
  const cy = y + half;
  const innerR = half * 0.72;
  const innerR2 = innerR * innerR;

  for (let dy = -half; dy <= half; dy += 1) {
    for (let dx = -half; dx <= half; dx += 1) {
      if (dx * dx + dy * dy > innerR2) continue;
      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || px >= sw || py < 0 || py >= sh) continue;
      const val = gray[py * sw + px];
      sum += val;
      sumSq += val * val;
      count++;
      const i = (py * sw + px) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const maxc = Math.max(r, g, b);
      const minc = Math.min(r, g, b);
      satSum += maxc === 0 ? 0 : (maxc - minc) / maxc;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  const sat = satSum / count;

  // 真っ暗（机の影・黒ベゼル）や真っ白（余白）はアバターではない
  if (mean < 45 || mean > 235) return 0;
  if (variance < 180 || variance > 2600) return 0;
  if (sat < 0.10) return 0;

  let ringEdge = 0;
  let ringN = 0;
  const r0 = half * 0.78;
  const r1 = half * 1.05;
  for (let a = 0; a < 24; a++) {
    const rad = (a / 24) * Math.PI * 2;
    const xOut = Math.round(cx + Math.cos(rad) * r1);
    const yOut = Math.round(cy + Math.sin(rad) * r1);
    const xIn = Math.round(cx + Math.cos(rad) * r0);
    const yIn = Math.round(cy + Math.sin(rad) * r0);
    if (xOut < 0 || yOut < 0 || xOut >= sw || yOut >= sh) continue;
    if (xIn < 0 || yIn < 0 || xIn >= sw || yIn >= sh) continue;
    ringEdge += Math.abs(gray[yOut * sw + xOut] - gray[yIn * sw + xIn]);
    ringN++;
  }
  if (ringN === 0) return 0;
  const ring = ringEdge / ringN;
  if (ring < 22) return 0;

  // チャットアイコンの右側（吹き出し領域）の存在確認
  // 右側が完全に真っ黒（机の背景）の場合は誤検出
  const rightX0 = Math.min(sw - 1, x + size + 4);
  const rightX1 = Math.min(sw - 1, x + Math.round(size * 2.2));
  if (rightX1 > rightX0) {
    let rightSum = 0;
    let rightCount = 0;
    for (let rx = rightX0; rx <= rightX1; rx += 3) {
      rightSum += gray[cy * sw + rx];
      rightCount++;
    }
    if (rightCount > 0) {
      const rightMean = rightSum / rightCount;
      // 右側が極端に暗い（< 40: 机や余白）ならチャット画面ではない
      if (rightMean < 40) return 0;
    }
  }

  let horizEdge = 0;
  let heN = 0;
  for (let dy = -Math.floor(innerR); dy <= innerR; dy += 2) {
    for (let dx = -Math.floor(innerR); dx < innerR; dx += 2) {
      if (dx * dx + dy * dy > innerR2) continue;
      const px = cx + dx;
      const py = cy + dy;
      if (px < 1 || px >= sw - 1 || py < 0 || py >= sh) continue;
      horizEdge += Math.abs(gray[py * sw + px + 1] - gray[py * sw + px - 1]);
      heN++;
    }
  }
  const textish = heN > 0 ? horizEdge / heN : 0;
  if (textish > 28) return 0;

  return Math.min(100, Math.round(ring * 1.5 + sat * 35 + Math.min(25, variance / 50)));
}
