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

  // アバターの典型的なサイズ（scaledCanvas上）: 幅の 6%〜14%
  const avatarSize = Math.round(sw * 0.08);
  if (avatarSize < 20) return [];

  // アバターのX座標は左端（X: 3%〜8%）に固定して並ぶ
  const fixedX = Math.round(sw * 0.05);

  // 上端10%（ヘッダー部分）と下端5%（入力欄）を除外して縦走査
  const startY = Math.round(sh * 0.12);
  const endY = Math.round(sh * 0.92);
  const stepY = Math.max(15, Math.round(avatarSize * 0.5));

  interface Candidate {
    origX: number;
    origY: number;
    origSize: number;
    score: number;
  }
  const candidates: Candidate[] = [];

  for (let y = startY; y < endY - avatarSize; y += stepY) {
    const score = evaluateStrictAvatar(gray, sw, sh, fixedX, y, avatarSize);
    if (score > 50) {
      candidates.push({
        origX: Math.round(fixedX / scale),
        origY: Math.round(y / scale),
        origSize: Math.round(avatarSize / scale),
        score
      });
    }
  }

  // スコア順にソートして重複排除
  candidates.sort((a, b) => b.score - a.score);

  for (const c of candidates) {
    const rect = { x: c.origX, y: c.origY, width: c.origSize, height: c.origSize };
    const isDup = avatars.some(a => isOverlap(a.rect, rect, 0.2));
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
  const half = Math.floor(size / 2);
  const cx = x + half;
  const cy = y + half;
  const radiusSq = (half * 0.85) * (half * 0.85);

  for (let dy = -half; dy <= half; dy += 2) {
    for (let dx = -half; dx <= half; dx += 2) {
      if (dx * dx + dy * dy <= radiusSq) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && px < sw && py >= 0 && py < sh) {
          const val = gray[py * sw + px];
          sum += val;
          sumSq += val * val;
          count++;
        }
      }
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  const variance = (sumSq / count) - (mean * mean);

  // 単色の余白背景（分散 < 100）や、文字だらけのテキスト領域（分散 > 2500）は完全排除
  if (variance < 120 || variance > 2500) return 0;

  // アイコン周囲の背景（4方向）とのコントラストチェック
  const testDist = half + 4;
  const testPoints = [
    { x: cx - testDist, y: cy },
    { x: cx + testDist, y: cy },
    { x: cx, y: cy - testDist },
    { x: cx, y: cy + testDist }
  ];

  let borderDiffSum = 0;
  let validPoints = 0;
  for (const pt of testPoints) {
    if (pt.x >= 0 && pt.x < sw && pt.y >= 0 && pt.y < sh) {
      borderDiffSum += Math.abs(mean - gray[pt.y * sw + pt.x]);
      validPoints++;
    }
  }

  if (validPoints === 0) return 0;
  const avgBorderDiff = borderDiffSum / validPoints;

  // 背景から明確に浮き出ている（色の差が25以上ある）こと
  if (avgBorderDiff < 25) return 0;

  return Math.min(100, Math.round((variance / 15) + (avgBorderDiff * 1.8)));
}
