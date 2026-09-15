import type { OcrLine } from "./ocr";

export interface SnapResult {
  rect: { x: number; y: number; width: number; height: number };
  matchedLine: OcrLine | null;
  rotation?: number;
  isSnapped: boolean;
}

export interface LineSnapOptions {
  globalAngle?: number;
  paddingY?: number;
  snapThresholdY?: number;
  snapToWords?: boolean;
}

/**
 * 2つの区間の重なり度合いまたは距離
 */
function verticalDistance(y0: number, y1: number, lineY0: number, lineY1: number): number {
  if (y1 >= lineY0 && y0 <= lineY1) {
    return 0; // 完全に縦方向に重なっている
  }
  if (y1 < lineY0) {
    return lineY0 - y1;
  }
  return y0 - lineY1;
}

/**
 * ドラッグ操作を行情報にスマートスナップする
 */
export function calculateLineSnap(
  lines: OcrLine[],
  startPt: { x: number; y: number },
  currentPt: { x: number; y: number },
  options: LineSnapOptions = {}
): SnapResult {
  const minX = Math.min(startPt.x, currentPt.x);
  const maxX = Math.max(startPt.x, currentPt.x);
  const minY = Math.min(startPt.y, currentPt.y);
  const maxY = Math.max(startPt.y, currentPt.y);
  const rawWidth = Math.max(1, maxX - minX);
  const rawHeight = Math.max(1, maxY - minY);

  const rawRect = { x: minX, y: minY, width: rawWidth, height: rawHeight };

  if (!lines || lines.length === 0) {
    return {
      rect: rawRect,
      matchedLine: null,
      rotation: options.globalAngle,
      isSnapped: false
    };
  }

  const padY = options.paddingY ?? 2;
  const padX = 1;

  // 1. ドラッグ開始点、またはドラッグ中心点に最も適合する行を探索
  let bestLine: OcrLine | null = null;
  let minScore = Infinity;

  for (const line of lines) {
    const lY0 = line.bbox.y0;
    const lY1 = line.bbox.y1;
    const lH = Math.max(8, lY1 - lY0);

    // 行の上下判定許容値（行の高さの1.2倍、または最低24px）
    const threshold = options.snapThresholdY ?? Math.max(24, lH * 1.25);

    // ドラッグ開始点からのY距離
    const distFromStart = verticalDistance(startPt.y, startPt.y, lY0, lY1);
    // ドラッグ現在点からのY距離
    const distFromCurrent = verticalDistance(currentPt.y, currentPt.y, lY0, lY1);
    // 矩形全体としてのY距離
    const distFromBox = verticalDistance(minY, maxY, lY0, lY1);

    // 横方向の重なりチェック（横方向にもある程度近くないと対象外）
    const lX0 = line.bbox.x0;
    const lX1 = line.bbox.x1;
    const xOverlap = Math.max(0, Math.min(maxX, lX1) - Math.max(minX, lX0));
    const isNearbyX = xOverlap > 0 || (minX <= lX1 + 40 && maxX >= lX0 - 40);

    if (!isNearbyX) continue;

    // スコア計算：開始点の吸着を重視しつつ、ドラッグ領域の重なりを評価
    const effectiveDist = Math.min(distFromStart * 1.5, distFromCurrent, distFromBox);
    if (effectiveDist <= threshold) {
      // 縦距離が近く、横の重なりが大きいほど良い
      const score = effectiveDist * 2 - (xOverlap > 0 ? 20 : 0);
      if (score < minScore) {
        minScore = score;
        bestLine = line;
      }
    }
  }

  // 適合する行がない、またはドラッグの縦幅が明らかに行の高さの2.5倍を超える（複数行を一気に囲もうとしている）場合は自由矩形
  if (!bestLine) {
    return {
      rect: rawRect,
      matchedLine: null,
      rotation: options.globalAngle,
      isSnapped: false
    };
  }

  const lineH = Math.max(8, bestLine.bbox.y1 - bestLine.bbox.y0);
  if (rawHeight > lineH * 2.4) {
    // 縦に大きく引いた場合は自由矩形（意図的な複数行塗り）
    return {
      rect: rawRect,
      matchedLine: null,
      rotation: options.globalAngle,
      isSnapped: false
    };
  }

  // 2. Y軸の吸着：行の上端・下端にビシッと固定
  const snappedY = Math.max(0, bestLine.bbox.y0 - padY);
  const snappedHeight = (bestLine.bbox.y1 - bestLine.bbox.y0) + padY * 2;

  // 3. X軸の吸着：単語や文字のキリの良い境界にピタッと合わせる
  let snappedLeft = minX;
  let snappedRight = maxX;

  const snapToWords = options.snapToWords !== false;
  if (snapToWords) {
    const xBoundaries: number[] = [bestLine.bbox.x0, bestLine.bbox.x1];

    if (bestLine.words && bestLine.words.length > 0) {
      for (const w of bestLine.words) {
        xBoundaries.push(w.bbox.x0, w.bbox.x1);
      }
    }
    if (bestLine.alignedSymbols && bestLine.alignedSymbols.length > 0) {
      for (const s of bestLine.alignedSymbols) {
        xBoundaries.push(s.bbox.x0, s.bbox.x1);
      }
    } else if (bestLine.symbols && bestLine.symbols.length > 0) {
      for (const s of bestLine.symbols) {
        xBoundaries.push(s.bbox.x0, s.bbox.x1);
      }
    }

    const snapDistanceX = Math.max(12, lineH * 0.4); // 単語吸着しきい値

    // 左端のスナップ
    let closestLeftDist = Infinity;
    let bestSnapLeft = minX;
    for (const bx of xBoundaries) {
      const d = Math.abs(minX - bx);
      if (d <= snapDistanceX && d < closestLeftDist) {
        closestLeftDist = d;
        bestSnapLeft = bx;
      }
    }
    snappedLeft = bestSnapLeft;

    // 右端のスナップ
    let closestRightDist = Infinity;
    let bestSnapRight = maxX;
    for (const bx of xBoundaries) {
      const d = Math.abs(maxX - bx);
      if (d <= snapDistanceX && d < closestRightDist) {
        closestRightDist = d;
        bestSnapRight = bx;
      }
    }
    snappedRight = bestSnapRight;

    // もしユーザーが行の端から端までざっくり引いた場合（行幅の75%以上）、行全体にスナップ
    const lineWidth = bestLine.bbox.x1 - bestLine.bbox.x0;
    if (rawWidth > lineWidth * 0.75 && minX <= bestLine.bbox.x0 + snapDistanceX * 2 && maxX >= bestLine.bbox.x1 - snapDistanceX * 2) {
      snappedLeft = bestLine.bbox.x0;
      snappedRight = bestLine.bbox.x1;
    }
  }

  // 左右のパディング
  const finalX = Math.max(0, snappedLeft - padX);
  const finalW = Math.max(6, (snappedRight - snappedLeft) + padX * 2);

  return {
    rect: {
      x: finalX,
      y: snappedY,
      width: finalW,
      height: snappedHeight
    },
    matchedLine: bestLine,
    rotation: options.globalAngle,
    isSnapped: true
  };
}
