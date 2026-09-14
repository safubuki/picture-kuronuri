/**
 * スマホ撮影写真の歪み・傾き・照明ムラを機械的に補正する画像前処理ユーティリティ
 * 外部通信を行わず、Canvas API のみで高速に画像変換・補正を実行
 */

/**
 * 画像を任意の角度（度数法）で回転・傾き補正する
 */
export async function rotateAndDeskewImage(
  source: HTMLImageElement | HTMLCanvasElement,
  angleDegrees: number
): Promise<HTMLImageElement> {
  const radians = (angleDegrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));

  const origW = (source as HTMLImageElement).naturalWidth || source.width;
  const origH = (source as HTMLImageElement).naturalHeight || source.height;

  // 回転後の新しいバウンディングボックスサイズ
  const newW = Math.round(origW * cos + origH * sin);
  const newH = Math.round(origW * sin + origH * cos);

  const canvas = document.createElement("canvas");
  canvas.width = newW;
  canvas.height = newH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context creation failed");

  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(radians);
  ctx.drawImage(source, -origW / 2, -origH / 2);

  return loadImageFromDataUrl(canvas.toDataURL("image/png"));
}

/**
 * 90度単位で回転（90°, 180°, 270°）
 */
export async function rotateImage90(
  source: HTMLImageElement | HTMLCanvasElement,
  clockwise: boolean = true
): Promise<HTMLImageElement> {
  return rotateAndDeskewImage(source, clockwise ? 90 : -90);
}

/**
 * コントラスト・明度強調および影の低減（OCR認識精度を向上）
 */
export async function enhanceImageForOcr(
  source: HTMLImageElement | HTMLCanvasElement,
  contrastFactor: number = 1.3,
  brightnessOffset: number = 10
): Promise<HTMLImageElement> {
  const w = (source as HTMLImageElement).naturalWidth || source.width;
  const h = (source as HTMLImageElement).naturalHeight || source.height;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context creation failed");

  ctx.drawImage(source, 0, 0);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // コントラスト変換テーブルの作成
  for (let i = 0; i < data.length; i += 4) {
    // RGBの各チャンネルにコントラスト・明度適用
    for (let c = 0; c < 3; c++) {
      let val = data[i + c];
      // 128を中心にコントラスト拡大
      val = Math.round((val - 128) * contrastFactor + 128 + brightnessOffset);
      data[i + c] = Math.max(0, Math.min(255, val));
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return loadImageFromDataUrl(canvas.toDataURL("image/png"));
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = dataUrl;
  });
}
