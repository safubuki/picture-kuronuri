/**
 * 撮影直後の一気通貫補正（AI不使用）
 * 台形正対化 → 水平傾き補正 → モアレ／コントラスト整え、の順で表示画像そのものを整える。
 */

import {
  applyPerspectiveTransform,
  copySourceToCanvas,
  detectDocumentCornersDetailed,
  detectImageDeskewAngle,
  quadNeedsWarp,
  rotateCanvasByAngle
} from "./autoDeskew";
import { analyzeOcrSource, enhanceColorImage } from "./ocrPreprocess";

export interface CaptureCorrectionResult {
  image: HTMLImageElement;
  appliedPerspective: boolean;
  deskewAngle: number;
  enhanced: boolean;
  skipped: boolean;
  method: string;
}

function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("toBlob failed"));
          return;
        }
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        img.onerror = reject;
        img.src = url;
      }, "image/png");
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = canvas.toDataURL("image/png");
  });
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function applyDeskewPass(
  canvas: HTMLCanvasElement
): { canvas: HTMLCanvasElement; angle: number } {
  const angle = detectImageDeskewAngle(canvas);
  if (Math.abs(angle) < 0.2) {
    return { canvas, angle: 0 };
  }
  let work = rotateCanvasByAngle(canvas, -angle);
  const remain = detectImageDeskewAngle(work);
  if (Math.abs(remain) >= 0.2 && Math.abs(remain) < Math.abs(angle)) {
    work = rotateCanvasByAngle(work, -remain);
    return { canvas: work, angle: angle + remain };
  }
  return { canvas: work, angle };
}

/**
 * 斜め・台形・モアレのある撮影画像を、黒塗り解析前に真正面の読みやすい画像へ変換する。
 * すでに正対しているスクリーンショットはほぼ何もしない。
 */
export async function autoCorrectCapturedPhoto(
  source: HTMLImageElement | HTMLCanvasElement,
  onProgress?: (status: string, progress: number) => void
): Promise<CaptureCorrectionResult> {
  onProgress?.("画面の四隅と台形歪みを検出中...", 0.05);
  await yieldFrame();

  const detected = detectDocumentCornersDetailed(source);
  let work = copySourceToCanvas(source);
  let appliedPerspective = false;

  const canWarp =
    detected.method !== "fallback" &&
    detected.confidence >= 0.42 &&
    quadNeedsWarp(detected.corners, source.width, source.height, detected.method);

  if (canWarp) {
    onProgress?.("台形補正で画面を正対化しています...", 0.1);
    await yieldFrame();
    const beforeSkew = detectImageDeskewAngle(source);
    const warped = applyPerspectiveTransform(source, detected.corners);
    const afterSkew = detectImageDeskewAngle(warped);
    const warpedWorse =
      Math.abs(afterSkew) > 6 && Math.abs(afterSkew) > Math.abs(beforeSkew) + 2.5;
    if (!warpedWorse) {
      work = warped;
      appliedPerspective = true;
    }
  }

  onProgress?.("文字行の傾きを 0.1° 精度で補正中...", 0.16);
  await yieldFrame();
  const deskewed = applyDeskewPass(work);
  work = deskewed.canvas;
  const deskewAngle = deskewed.angle;

  const analysis = analyzeOcrSource(work);
  let enhanced = false;
  if (analysis.isLikelyScreenPhoto || appliedPerspective || Math.abs(deskewAngle) >= 0.5) {
    onProgress?.("ガイドフィルタでモアレ除去・画質を整えています...", 0.22);
    await yieldFrame();
    work = enhanceColorImage(work);
    enhanced = true;
  }

  const skipped =
    !appliedPerspective && Math.abs(deskewAngle) < 0.2 && !enhanced;
  const image = skipped && source instanceof HTMLImageElement
    ? source
    : await canvasToImage(work);

  return {
    image,
    appliedPerspective,
    deskewAngle,
    enhanced,
    skipped,
    method: detected.method
  };
}
