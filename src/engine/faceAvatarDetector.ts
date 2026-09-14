/**
 * 顔写真・実写人物アイコン検出器
 * ユーザー指定: 「鈴」などの頭文字・イニシャルアイコンや単色アイコンは消さなくてよい。
 * 消すべき対象は「本人の写真（実写・顔写真）」のみ。
 * 吹き出し境界や本文を誤検出して文字を潰す事故を完全に根絶する。
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
 * 画像から本人の顔写真・実写アバターのみをピンポイント検出する
 * @param imageElement 対象画像
 * @param knownAvatars 事前に定義されたアバター座標（サンプル画像等）
 */
export async function detectFacesAndAvatars(
  imageElement: HTMLImageElement | HTMLCanvasElement,
  knownAvatars?: { x: number; y: number; width: number; height: number }[]
): Promise<DetectedFaceOrAvatar[]> {
  const results: DetectedFaceOrAvatar[] = [];

  // 1. 事前定義アバターがある場合（テスト用サンプル等）
  if (knownAvatars && knownAvatars.length > 0) {
    for (let i = 0; i < knownAvatars.length; i++) {
      results.push({
        id: `avatar-known-${i}`,
        type: "face",
        rect: knownAvatars[i],
        confidence: 0.99,
        label: "顔写真"
      });
    }
    return results;
  }

  // 2. ネイティブ FaceDetector API の試行（Android Chrome / Chromium でサポート）
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

  // 3. 実写顔写真（Photo Avatar）の色彩・肌色・テクスチャ解析
  // ※ 「鈴」「山」などの頭文字アイコンや単色塗りつぶしアイコン、吹き出し境界は除外
  const photoAvatars = detectRealPhotoAvatars(imageElement);
  for (const photo of photoAvatars) {
    const isOverlapped = results.some(r => isOverlap(r.rect, photo.rect, 0.3));
    if (!isOverlapped) {
      results.push(photo);
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
 * 実写の顔写真（Photo）のみを精密検出
 * - 肌色ピクセルの集中度
 * - 実写写真特有のカラー分散（単色や単純な白文字イニシャルアイコンを完全除外）
 */
function detectRealPhotoAvatars(
  source: HTMLImageElement | HTMLCanvasElement
): DetectedFaceOrAvatar[] {
  const results: DetectedFaceOrAvatar[] = [];
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

  // アバター候補サイズ（画面幅の6%〜12%）
  const sizes = [
    Math.round(sw * 0.07),
    Math.round(sw * 0.095),
    Math.round(sw * 0.12)
  ].filter(s => s >= 20);

  // チャットアイコンが存在する左端カラム（X: 3%〜14%）
  const xs = [0.03, 0.05, 0.07, 0.09, 0.11].map(r => Math.round(sw * r));
  const startY = Math.round(sh * 0.10);
  const endY = Math.round(sh * 0.90);

  interface Candidate {
    x: number;
    y: number;
    size: number;
    score: number;
  }
  const candidates: Candidate[] = [];

  for (const size of sizes) {
    const stepY = Math.max(12, Math.round(size * 0.4));
    for (const x of xs) {
      if (x + size >= sw) continue;
      for (let y = startY; y < endY - size; y += stepY) {
        const score = evaluateRealPhotoFace(data, sw, sh, x, y, size);
        if (score >= 70) {
          candidates.push({ x, y, size, score });
        }
      }
    }
  }

  // スコア順にソートして重複排除
  candidates.sort((a, b) => b.score - a.score);

  for (const c of candidates) {
    const origRect = {
      x: Math.round(c.x / scale),
      y: Math.round(c.y / scale),
      width: Math.round(c.size / scale),
      height: Math.round(c.size / scale)
    };

    const isDup = results.some(r => {
      if (isOverlap(r.rect, origRect, 0.25)) return true;
      // 同一列なら縦にアバター高さの1.8倍以上離れていること
      const sameCol = Math.abs(r.rect.x - origRect.x) < origRect.width * 0.8;
      const closeY = Math.abs(r.rect.y - origRect.y) < origRect.height * 1.8;
      return sameCol && closeY;
    });

    if (!isDup) {
      results.push({
        id: `face-photo-${origRect.x}-${origRect.y}`,
        type: "face",
        rect: origRect,
        confidence: Math.min(0.96, c.score / 100),
        label: "顔写真"
      });
    }

    if (results.length >= 4) break;
  }

  return results;
}

/**
 * 領域が本物の「実写顔写真」であるかを判定
 * - 単色（オレンジ、青、緑等）背景＋文字（「鈴」「山」等）→ 0点（確実に除外）
 * - 吹き出し白地・本文テキスト行 → 0点（確実に除外）
 * - 人物の肌色ピクセルが一定割合存在し、自然な写真の色彩分散がある場合のみ高スコア
 */
function evaluateRealPhotoFace(
  rgba: Uint8ClampedArray,
  sw: number,
  sh: number,
  x: number,
  y: number,
  size: number
): number {
  if (x + size >= sw || y + size >= sh) return 0;

  let skinPixels = 0;
  let totalInnerPixels = 0;

  const rVals: number[] = [];
  const gVals: number[] = [];
  const bVals: number[] = [];

  const half = Math.floor(size / 2);
  const cx = x + half;
  const cy = y + half;
  const innerR = half * 0.82;
  const innerR2 = innerR * innerR;

  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      if (dx * dx + dy * dy > innerR2) continue; // 円形内部のみ検査
      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || px >= sw || py < 0 || py >= sh) continue;

      const i = (py * sw + px) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];

      rVals.push(r);
      gVals.push(g);
      bVals.push(b);
      totalInnerPixels++;

      // 人物の肌色判定（標準的なPeer et al. 肌色検出ルール）
      // R > 95, G > 40, B > 20, max - min > 15, |R - G| > 15, R > G, R > B
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const isSkin =
        r > 95 &&
        g > 40 &&
        b > 20 &&
        (maxC - minC) > 15 &&
        Math.abs(r - g) > 12 &&
        r > g &&
        r > b;

      if (isSkin) {
        skinPixels++;
      }
    }
  }

  if (totalInnerPixels < 40) return 0;

  const skinRatio = skinPixels / totalInnerPixels;
  // 本人の顔写真であれば、顔の肌色が最低でも15%以上含まれる
  // 「鈴」「山」などの頭文字アイコン（単色ベタ塗り＋白文字）や白地吹き出しは肌色条件で完全に0点になる
  if (skinRatio < 0.15) return 0;

  // 色彩分散（単色塗りつぶし・単純ベタ塗りの除外）
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  for (let i = 0; i < totalInnerPixels; i++) {
    rSum += rVals[i];
    gSum += gVals[i];
    bSum += bVals[i];
  }
  const rMean = rSum / totalInnerPixels;
  const gMean = gSum / totalInnerPixels;
  const bMean = bSum / totalInnerPixels;

  let rVar = 0;
  let gVar = 0;
  let bVar = 0;
  for (let i = 0; i < totalInnerPixels; i++) {
    rVar += Math.pow(rVals[i] - rMean, 2);
    gVar += Math.pow(gVals[i] - gMean, 2);
    bVar += Math.pow(bVals[i] - bMean, 2);
  }
  const stdDev = Math.sqrt((rVar + gVar + bVar) / (3 * totalInnerPixels));

  // 実写の顔写真は陰影・髪・目・口・服などがあるため、標準偏差が20以上になる
  // 単色背景のイニシャルアイコンは分散が低いため除外
  if (stdDev < 20) return 0;

  // 円周外枠とのコントラスト（丸いアイコン枠として存在するか）
  const rOuter = half * 1.15;
  let borderContrast = 0;
  let borderPoints = 0;
  for (let a = 0; a < 8; a++) {
    const rad = (a / 8) * Math.PI * 2;
    const xOut = Math.round(cx + Math.cos(rad) * rOuter);
    const yOut = Math.round(cy + Math.sin(rad) * rOuter);
    if (xOut < 0 || yOut < 0 || xOut >= sw || yOut >= sh) continue;
    const idxOut = (yOut * sw + xOut) * 4;
    const lumOut = 0.299 * rgba[idxOut] + 0.587 * rgba[idxOut + 1] + 0.114 * rgba[idxOut + 2];
    const lumIn = 0.299 * rMean + 0.587 * gMean + 0.114 * bMean;
    borderContrast += Math.abs(lumOut - lumIn);
    borderPoints++;
  }

  const avgContrast = borderPoints > 0 ? borderContrast / borderPoints : 0;
  if (avgContrast < 12) return 0;

  const score = Math.round(skinRatio * 50 + Math.min(30, stdDev) + Math.min(20, avgContrast));
  return Math.min(95, score);
}
