import type { RedactBox, RedactType } from "./redactionEngine";

export type RedactStyle = "blackout" | "whiteout" | "mosaic" | "blur";

export interface CanvasRendererOptions {
  style: RedactStyle;
  mosaicPixelSize: number;
  showOverlayLabels: boolean;
  showDisabledBoxes: boolean;
  activeHoverBoxId: string | null;
  selectedBoxId: string | null;
}

export const DEFAULT_RENDERER_OPTIONS: CanvasRendererOptions = {
  style: "blackout",
  mosaicPixelSize: 12,
  showOverlayLabels: true,
  showDisabledBoxes: true,
  activeHoverBoxId: null,
  selectedBoxId: null
};

/**
 * 画像および墨消しボックスをCanvasに描画する
 */
export function renderRedactedCanvas(
  ctx: CanvasRenderingContext2D,
  sourceImage: HTMLImageElement | HTMLCanvasElement,
  boxes: RedactBox[],
  options: CanvasRendererOptions = DEFAULT_RENDERER_OPTIONS,
  isExport: boolean = false
): void {
  const width = sourceImage.width;
  const height = sourceImage.height;

  // キャンバスサイズの確認
  if (ctx.canvas.width !== width || ctx.canvas.height !== height) {
    ctx.canvas.width = width;
    ctx.canvas.height = height;
  }

  // 1. 元画像の描画
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(sourceImage, 0, 0);

  // 2. 有効な墨消しボックスのレンダリング
  for (const box of boxes) {
    if (!box.enabled) continue;
    const { x, y, width: bw, height: bh } = box.rect;
    if (bw <= 0 || bh <= 0) continue;

    ctx.save();
    // 斜めのテキスト行に追従した回転矩形の適用
    if (box.rotation && Math.abs(box.rotation) > 0.1) {
      const cx = x + bw / 2;
      const cy = y + bh / 2;
      ctx.translate(cx, cy);
      ctx.rotate((box.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    switch (options.style) {
      case "blackout":
        ctx.fillStyle = "#0a0a0c";
        ctx.fillRect(x, y, bw, bh);
        break;

      case "whiteout":
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y, bw, bh);
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, bw, bh);
        break;

      case "mosaic":
        renderMosaicRegion(ctx, sourceImage, x, y, bw, bh, options.mosaicPixelSize);
        break;

      case "blur":
        renderBlurRegion(ctx, sourceImage, x, y, bw, bh, 14);
        break;
    }

    // 同一行・黒塗り内部へのインラインラベル描画（上下の行を絶対に潰さない）
    if (options.showOverlayLabels && (bw >= 24 && bh >= 14)) {
      renderInlineBoxLabel(ctx, box, options.style);
    }
    ctx.restore();
  }

  // エクスポート（保存・コピー用）なら、操作用枠線や無効化ボックスなどのデバッグUIは描画しない
  if (isExport) return;

  // 3. 編集UIオーバーレイ（枠線、無効化表示、ホバー強調）
  for (const box of boxes) {
    const { x, y, width: bw, height: bh } = box.rect;
    const isHovered = box.id === options.activeHoverBoxId;
    const isSelected = box.id === options.selectedBoxId;

    if (!box.enabled && !options.showDisabledBoxes) continue;

    ctx.save();
    if (box.rotation && Math.abs(box.rotation) > 0.1) {
      const cx = x + bw / 2;
      const cy = y + bh / 2;
      ctx.translate(cx, cy);
      ctx.rotate((box.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    if (!box.enabled) {
      // 解除されたボックスは点線と薄い半透明で表示
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(239, 68, 68, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, bw, bh);
      ctx.fillStyle = "rgba(239, 68, 68, 0.12)";
      ctx.fillRect(x, y, bw, bh);
    } else if (isHovered || isSelected) {
      // ホバーまたは選択時の輪郭ハイライト
      ctx.strokeStyle = isSelected ? "#38bdf8" : "rgba(56, 189, 248, 0.7)";
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      if (isSelected) {
        ctx.shadowColor = "#38bdf8";
        ctx.shadowBlur = 8;
      }
      ctx.setLineDash([]);
      ctx.strokeRect(x, y, bw, bh);
    }
    ctx.restore();
  }
}

/**
 * モザイク領域の描画
 */
function renderMosaicRegion(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  pixelSize: number
): void {
  const blockSize = Math.max(4, pixelSize);
  const tempCanvas = document.createElement("canvas");
  const smallW = Math.max(1, Math.floor(w / blockSize));
  const smallH = Math.max(1, Math.floor(h / blockSize));

  tempCanvas.width = smallW;
  tempCanvas.height = smallH;
  const tempCtx = tempCanvas.getContext("2d");
  if (!tempCtx) return;

  tempCtx.drawImage(source, x, y, w, h, 0, 0, smallW, smallH);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tempCanvas, 0, 0, smallW, smallH, x, y, w, h);
  ctx.restore();
}

/**
 * ガウスぼかし領域の描画
 */
function renderBlurRegion(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  blurRadius: number
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.filter = `blur(${blurRadius}px)`;
  const pad = blurRadius * 2;
  ctx.drawImage(
    source,
    Math.max(0, x - pad),
    Math.max(0, y - pad),
    w + pad * 2,
    h + pad * 2,
    Math.max(0, x - pad),
    Math.max(0, y - pad),
    w + pad * 2,
    h + pad * 2
  );
  ctx.restore();
}

/**
 * 黒塗り・マスキング矩形の「内部」（同一行）にテキストラベルを描画する
 * 上下の行に一切飛び出さず、元の文章のレイアウトを完全に守る
 */
function renderInlineBoxLabel(
  ctx: CanvasRenderingContext2D,
  box: RedactBox,
  style: RedactStyle
): void {
  const { x, y, width: bw, height: bh } = box.rect;

  ctx.save();
  // 矩形内部に厳密にクリッピング（上下左右への飛び出しを1pxも許さない）
  ctx.beginPath();
  ctx.rect(x, y, bw, bh);
  ctx.clip();

  // 枠の高さに合わせた適切なフォントサイズを計算（最小9px、最大13px）
  const fontSize = Math.max(9, Math.min(13, Math.floor(bh * 0.62)));
  ctx.font = `600 ${fontSize}px sans-serif`;

  const label = getCompactLabel(box.type, box.label);

  // 文字色の決定（黒塗り/モザイク/ぼかしなら淡いグレー/白、白塗りなら濃いスレートグレー）
  let textColor = "rgba(255, 255, 255, 0.88)";
  if (style === "whiteout") {
    textColor = "#334155";
  } else if (style === "mosaic" || style === "blur") {
    // モザイクやぼかしの上に文字を載せる場合は半透明背景を敷く
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(x, y, bw, bh);
    textColor = "#f8fafc";
  }

  // カテゴリ・ラベルごとの微細なアクセントカラー
  if (style === "blackout") {
    const l = (box.label || "").toLowerCase();
    if (box.type === "person" || l.includes("人名")) textColor = "#fde68a"; // 淡いゴールド（人名）
    else if (box.type === "company" || l.includes("会社")) textColor = "#7dd3fc"; // 淡いシアン（会社名）
    else if (box.type === "face" || box.type === "avatar") textColor = "#e9d5ff"; // 淡いパープル（アイコン）
    else if (l.includes("メール")) textColor = "#93c5fd"; // ブルー（メール）
    else if (l.includes("パスワード")) textColor = "#fca5a5"; // コーラルレッド（パスワード）
    else if (l.includes("電話") || l.includes("tel")) textColor = "#a7f3d0"; // ミント（電話）
    else if (l.includes("住所")) textColor = "#fed7aa"; // オレンジ（住所）
    else if (box.type === "pii") textColor = "#fecdd3"; // 淡いローズ（連絡先）
  }

  // 同一行の矩形中央に揃えて描画
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = textColor;
  ctx.fillText(label, x + bw / 2, y + bh / 2 + 1);

  ctx.restore();
}

/**
 * 矩形幅に無理なく収まる簡潔な日本語ラベル
 */
function getCompactLabel(type: RedactType, defaultLabel: string): string {
  const clean = (defaultLabel || "").trim();
  if (clean && clean !== "手動指定") {
    if (clean === "メール" || clean.includes("メール")) return "メール";
    if (clean === "パスワード" || clean.includes("パスワード")) return "PW";
    if (clean === "電話番号" || clean.includes("電話")) return "TEL";
    if (clean === "住所" || clean.includes("住所")) return "住所";
    if (clean === "会社名" || clean.includes("会社")) return "会社名";
    if (clean === "人名" || clean.includes("人名")) return "人名";
    if (clean === "金額" || clean.includes("金額")) return "金額";
    if (clean !== "手動") {
      // ユーザーの自由カスタム入力（長すぎる場合は省略）
      return clean.length > 5 ? clean.slice(0, 4) + "…" : clean;
    }
  }

  switch (type) {
    case "person":
      return "人名";
    case "company":
      return "会社名";
    case "face":
      return "顔写真";
    case "avatar":
      return "アイコン";
    case "pii":
      if (defaultLabel.includes("電話")) return "TEL";
      if (defaultLabel.includes("メール")) return "Email";
      if (defaultLabel.includes("住所")) return "住所";
      if (defaultLabel.includes("郵便")) return "〒";
      if (defaultLabel.includes("金額")) return "金額";
      return "個人情報";
    case "manual":
      return "手動";
    case "custom":
      return "指定語";
    default:
      return defaultLabel;
  }
}

/**
 * 座標 (x, y) にあるRedactBoxを検索する（逆順で最前面のものを優先）
 * 斜め（rotation）を持つボックスも逆回転変換により正確に内外判定
 */
export function findBoxAtPosition(
  boxes: RedactBox[],
  x: number,
  y: number
): RedactBox | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i];
    const { x: bx, y: by, width: bw, height: bh } = box.rect;

    let testX = x;
    let testY = y;

    // ボックスが傾いている場合は、点を逆回転してAABBローカル座標系に変換
    if (box.rotation && Math.abs(box.rotation) > 0.1) {
      const cx = bx + bw / 2;
      const cy = by + bh / 2;
      const rad = (-box.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = x - cx;
      const dy = y - cy;
      testX = cx + dx * cos - dy * sin;
      testY = cy + dx * sin + dy * cos;
    }

    if (testX >= bx && testX <= bx + bw && testY >= by && testY <= by + bh) {
      return box;
    }
  }
  return null;
}

/**
 * 描画モード時・スナップ時に行ガイドを描画する
 */
export function renderLineGuides(
  ctx: CanvasRenderingContext2D,
  lines: import("./ocr").OcrLine[],
  activeLine: import("./ocr").OcrLine | null = null,
  zoom: number = 1.0,
  globalAngle: number = 0
): void {
  if (!lines || lines.length === 0) return;

  ctx.save();

  // 拡大率に応じて線の太さを調整（拡大時も太くなりすぎない）
  const lineWidth = Math.max(0.8, 1.2 / Math.max(0.5, zoom));

  // 1. 全認識行の淡いシアンガイド枠
  for (const line of lines) {
    if (line === activeLine) continue;
    const { x0, y0, x1, y1 } = line.bbox;
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) continue;

    ctx.save();
    if (globalAngle && Math.abs(globalAngle) > 0.1) {
      const cx = x0 + w / 2;
      const cy = y0 + h / 2;
      ctx.translate(cx, cy);
      ctx.rotate((globalAngle * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    ctx.fillStyle = "rgba(56, 189, 248, 0.05)";
    ctx.fillRect(x0, y0, w, h);

    ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x0, y0, w, h);

    // 拡大率1.6倍以上のときは単語の区切りガイドも表示
    if (zoom >= 1.6 && line.words && line.words.length > 1) {
      ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
      ctx.setLineDash([2, 3]);
      for (const wItem of line.words) {
        ctx.beginPath();
        ctx.moveTo(wItem.bbox.x0, y0);
        ctx.lineTo(wItem.bbox.x0, y1);
        ctx.moveTo(wItem.bbox.x1, y0);
        ctx.lineTo(wItem.bbox.x1, y1);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 2. 現在吸着中のアクティブ行のネオンハイライト
  if (activeLine) {
    const { x0, y0, x1, y1 } = activeLine.bbox;
    const w = x1 - x0;
    const h = y1 - y0;

    ctx.save();
    if (globalAngle && Math.abs(globalAngle) > 0.1) {
      const cx = x0 + w / 2;
      const cy = y0 + h / 2;
      ctx.translate(cx, cy);
      ctx.rotate((globalAngle * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    ctx.fillStyle = "rgba(16, 185, 129, 0.18)";
    ctx.fillRect(x0, y0, w, h);

    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = Math.max(1.4, 2.2 / Math.max(0.5, zoom));
    ctx.setLineDash([]);
    ctx.shadowColor = "rgba(16, 185, 129, 0.5)";
    ctx.shadowBlur = 6;
    ctx.strokeRect(x0, y0, w, h);

    ctx.restore();
  }

  ctx.restore();
}
