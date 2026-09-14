/**
 * Bradley-Roth 局所適応二値化アルゴリズム（Integral Imageベース）
 * 完全ローカル・O(1)ピクセル処理。
 *
 * 液晶画面撮影写真の「白飛び」「バックライトムラ」「モアレ」「緑・白吹き出しの輝度差」を
 * 局所ウィンドウ（近傍領域）の平均輝度から動的に二値化し、
 * 白吹き出し内の薄い文字も、緑吹き出しの文字も、すべて均一な高コントラスト二値画像に変換する。
 */

export interface AdaptiveThresholdOptions {
  /** ウィンドウサイズ（奇数）。省略時は画像短辺の約 3〜4%（25〜45px） */
  windowSize?: number;
  /** 平均輝度からの閾値パーセンテージ（例: 0.12 = 平均より12%暗い画素を文字とする） */
  sensitivity?: number;
  /** true の場合、白背景に黒文字（OCRに最適）を出力。false の場合は白文字・黒背景 */
  darkTextOnLightBg?: boolean;
}

/**
 * 8bit グレースケール配列から高速積分画像（Integral Image）を構築
 */
function buildIntegralImage(gray: Uint8Array, w: number, h: number): Float64Array {
  const iiW = w + 1;
  const integral = new Float64Array(iiW * (h + 1));

  for (let y = 1; y <= h; y++) {
    let rowSum = 0;
    const srcRow = (y - 1) * w;
    const iiRow = y * iiW;
    const prevIiRow = (y - 1) * iiW;

    for (let x = 1; x <= w; x++) {
      rowSum += gray[srcRow + (x - 1)];
      integral[iiRow + x] = integral[prevIiRow + x] + rowSum;
    }
  }

  return integral;
}

/**
 * 局所適応二値化を実行
 * @param gray 入力グレースケール配列（長さ: w * h）
 * @param w 幅
 * @param h 高さ
 * @param options 設定
 * @returns 二値化された配列（0 または 255）
 */
export function adaptiveThresholdBradley(
  gray: Uint8Array,
  w: number,
  h: number,
  options: AdaptiveThresholdOptions = {}
): Uint8Array {
  const minSide = Math.min(w, h);
  let S = options.windowSize ?? Math.max(15, Math.min(65, Math.round(minSide * 0.035) | 1));
  if ((S & 1) === 0) S += 1; // 奇数にする
  const s2 = Math.floor(S / 2);

  const t = options.sensitivity ?? 0.12;
  const darkText = options.darkTextOnLightBg ?? true;

  const integral = buildIntegralImage(gray, w, h);
  const iiW = w + 1;
  const out = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - s2);
    const y1 = Math.min(h - 1, y + s2);
    const iiY0 = y0 * iiW;
    const iiY1 = (y1 + 1) * iiW;
    const rowOffset = y * w;

    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - s2);
      const x1 = Math.min(w - 1, x + s2);

      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      // 積分画像から矩形内の合計値を O(1) で取得
      const sum =
        integral[iiY1 + (x1 + 1)] -
        integral[iiY1 + x0] -
        integral[iiY0 + (x1 + 1)] +
        integral[iiY0 + x0];

      const mean = sum / count;
      const pixelVal = gray[rowOffset + x];

      // ピクセル値が局所平均より (1 - t) 未満なら「文字（暗部）」と判定
      const isText = pixelVal < mean * (1 - t);

      if (darkText) {
        // 文字を黒 (0)、背景を白 (255)
        out[rowOffset + x] = isText ? 0 : 255;
      } else {
        out[rowOffset + x] = isText ? 255 : 0;
      }
    }
  }

  return out;
}
