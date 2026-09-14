import type { OcrResult, OcrLine, OcrChar } from "../engine/ocr";

export interface SampleChatResult {
  dataUrl: string;
  ocrData: OcrResult;
  avatars: { x: number; y: number; width: number; height: number }[];
}

/**
 * テスト用チャット画面サンプル画像および正確な座標テキストデータの動的生成
 */
export function generateChatSampleImage(): SampleChatResult {
  const canvas = document.createElement("canvas");
  const w = 750;
  const h = 1334; // iPhone画面比率
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { dataUrl: "", ocrData: { fullText: "", lines: [], symbols: [] }, avatars: [] };
  }

  const lines: OcrLine[] = [];
  const allSymbols: OcrChar[] = [];

  // サンプル画像内の本物のアバター座標（山田×2、鈴木×1）
  const avatars = [
    { x: 40, y: 150, width: 60, height: 60 },
    { x: 40, y: 620, width: 60, height: 60 },
    { x: 40, y: 940, width: 60, height: 60 }
  ];

  // ヘルパー：Canvasのフォント幅に基づいた精密な行情報の登録
  const recordLine = (text: string, x: number, y: number, font: string = "20px sans-serif", lineHeight: number = 24) => {
    ctx.font = font;
    const lineSymbols: OcrChar[] = [];
    let currentX = x;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const charWidth = ctx.measureText(char).width;
      const cx0 = Math.round(currentX);
      const cx1 = Math.round(currentX + charWidth);
      const cy0 = y;
      const cy1 = y + lineHeight;

      const symbolObj: OcrChar = {
        text: char,
        bbox: { x0: cx0, y0: cy0, x1: cx1, y1: cy1 },
        confidence: 99
      };
      lineSymbols.push(symbolObj);
      allSymbols.push(symbolObj);

      currentX += charWidth;
    }

    lines.push({
      text,
      bbox: {
        x0: x,
        y0: y,
        x1: Math.round(currentX),
        y1: y + lineHeight
      },
      words: [{
        text,
        bbox: { x0: x, y0: y, x1: Math.round(currentX), y1: y + lineHeight },
        confidence: 99
      }],
      symbols: lineSymbols
    });
  };

  // 1. チャット背景
  ctx.fillStyle = "#8c9cb3";
  ctx.fillRect(0, 0, w, h);

  // 2. ヘッダーバー
  ctx.fillStyle = "#273244";
  ctx.fillRect(0, 0, w, 110);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText("プロジェクト連絡（山田・鈴木）", 100, 70);
  recordLine("プロジェクト連絡（山田・鈴木）", 100, 44, "bold 28px sans-serif", 32);

  // 戻る矢印
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(50, 50);
  ctx.lineTo(35, 65);
  ctx.lineTo(50, 80);
  ctx.stroke();

  // 3. メッセージ1（左側: 山田 太郎）
  const y1 = 150;
  drawAvatar(ctx, 40, y1, 60, "#3b82f6", "山");
  ctx.fillStyle = "#1e293b";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("山田 太郎", 115, y1 + 18);
  recordLine("山田 太郎", 115, y1, "bold 20px sans-serif", 24);

  const m1Lines = [
    "お疲れ様です。株式会社テックラボの山田です。",
    "先ほど佐藤さんからご連絡いただいた件ですが、",
    "次回の契約書を鈴木部長に確認いたしました。",
    "ご確認よろしくお願いいたします。"
  ];
  drawBubble(ctx, 115, y1 + 28, 480, 190, "#ffffff", m1Lines, "10:14");
  m1Lines.forEach((line, idx) => {
    recordLine(line, 133, y1 + 44 + idx * 32, "20px sans-serif", 24);
  });

  // 4. メッセージ2（右側: 自分からの返信）
  const y2 = 420;
  const m2Lines = [
    "山田様、早速のご連絡ありがとうございます！",
    "内容確認の上、本日中に返信いたします。"
  ];
  drawBubbleRight(ctx, 220, y2, 490, 130, "#86efac", m2Lines, "10:18 既読");
  m2Lines.forEach((line, idx) => {
    recordLine(line, 238, y2 + 18 + idx * 32, "20px sans-serif", 24);
  });

  // 5. メッセージ3（左側: 鈴木 一郎）
  const y3 = 620;
  drawAvatar(ctx, 40, y3, 60, "#f59e0b", "鈴");
  ctx.fillStyle = "#1e293b";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("鈴木 一郎", 115, y3 + 18);
  recordLine("鈴木 一郎", 115, y3, "bold 20px sans-serif", 24);

  const m3Lines = [
    "鈴木です。至急案件のご相談です。",
    "合同会社フロンティアの田中社長より、",
    "以下の連絡先に折り返し希望とのことです。",
    "TEL: 090-1234-5678",
    "Email: tanaka@frontier-sample.jp",
    "住所: 東京都千代田区丸の内1-2-3"
  ];
  drawBubble(ctx, 115, y3 + 28, 510, 240, "#ffffff", m3Lines, "11:05");
  m3Lines.forEach((line, idx) => {
    recordLine(line, 133, y3 + 44 + idx * 32, "20px sans-serif", 24);
  });

  // 6. メッセージ4（左側: 山田 太郎）
  const y4 = 940;
  drawAvatar(ctx, 40, y4, 60, "#3b82f6", "山");
  ctx.fillStyle = "#1e293b";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("山田 太郎", 115, y4 + 18);
  recordLine("山田 太郎", 115, y4, "bold 20px sans-serif", 24);

  const m4Lines = [
    "承知いたしました。高橋君にも共有の上、",
    "午後一番で対応いたします！"
  ];
  drawBubble(ctx, 115, y4 + 28, 460, 130, "#ffffff", m4Lines, "11:12");
  m4Lines.forEach((line, idx) => {
    recordLine(line, 133, y4 + 44 + idx * 32, "20px sans-serif", 24);
  });

  const fullText = lines.map(l => l.text).join("\n");

  return {
    dataUrl: canvas.toDataURL("image/png"),
    ocrData: {
      fullText,
      lines,
      symbols: allSymbols
    },
    avatars
  };
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  bgColor: string,
  initial: string
): void {
  const radius = size / 2;
  const cx = x + radius;
  const cy = y + radius;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = bgColor;
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(size * 0.5)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initial, cx, cy);
  ctx.restore();
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  bgColor: string,
  lines: string[],
  timeText: string
): void {
  ctx.save();
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();

  ctx.fillStyle = "#1f2937";
  ctx.font = "20px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  lines.forEach((line, idx) => {
    ctx.fillText(line, x + 18, y + 16 + idx * 32);
  });

  ctx.fillStyle = "#64748b";
  ctx.font = "14px sans-serif";
  ctx.fillText(timeText, x + w + 8, y + h - 18);

  ctx.restore();
}

function drawBubbleRight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  bgColor: string,
  lines: string[],
  timeText: string
): void {
  ctx.save();
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();

  ctx.fillStyle = "#111827";
  ctx.font = "20px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  lines.forEach((line, idx) => {
    ctx.fillText(line, x + 18, y + 18 + idx * 32);
  });

  ctx.fillStyle = "#475569";
  ctx.font = "14px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(timeText, x - 10, y + h - 18);

  ctx.restore();
}

/**
 * 斜め撮影（机の上に置かれたスマホを斜め上から撮った状態）のサンプル画像を生成
 */
export function generateSkewedChatSampleImage(): { dataUrl: string } {
  const baseSample = generateChatSampleImage();
  const baseImg = new Image();
  baseImg.src = baseSample.dataUrl;

  const outW = 900;
  const outH = 1400;
  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW;
  outCanvas.height = outH;
  const ctx = outCanvas.getContext("2d");
  if (!ctx) return { dataUrl: baseSample.dataUrl };

  // 机風のダークスレート背景
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, outW, outH);

  // 机の木目風の微細ライン
  ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
  ctx.lineWidth = 1;
  for (let i = 0; i < outH; i += 40) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(outW, i);
    ctx.stroke();
  }

  // スマホを約5.5度傾けて描画
  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((5.5 * Math.PI) / 180);

  // スマホの影
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 32;
  ctx.shadowOffsetX = 12;
  ctx.shadowOffsetY = 16;

  // スマホ本体ベゼル
  const phoneW = 700;
  const phoneH = 1240;
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.roundRect(-phoneW / 2 - 12, -phoneH / 2 - 12, phoneW + 24, phoneH + 24, 36);
  ctx.fill();

  // 画面部分にチャット画像を描画
  ctx.shadowColor = "transparent";
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = 750;
  tempCanvas.height = 1334;
  const tCtx = tempCanvas.getContext("2d");
  if (tCtx) {
    // 同期的にBase64 DataURLから描画するために再生成ロジックを利用
    const directCanvas = document.createElement("canvas");
    directCanvas.width = 750;
    directCanvas.height = 1334;
    // baseSample.dataUrl の代わりに直接描画
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(-phoneW / 2, -phoneH / 2, phoneW, phoneH, 24);
    ctx.clip();
    // 描画
    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = 750;
    baseCanvas.height = 1334;
    const bCtx = baseCanvas.getContext("2d");
    if (bCtx) {
      // 簡易チャット画面を同期レンダリング
      bCtx.fillStyle = "#8ea2b8";
      bCtx.fillRect(0, 0, 750, 1334);
      bCtx.fillStyle = "#1e293b";
      bCtx.fillRect(0, 0, 750, 110);
      bCtx.fillStyle = "#ffffff";
      bCtx.font = "bold 26px sans-serif";
      bCtx.fillText("プロジェクト連絡（山田・鈴木）", 120, 68);

      // メッセージ1
      drawBubble(bCtx, 120, 180, 520, 140, "#ffffff", [
        "山田様、お疲れ様です。",
        "株式会社テックラボの山田です。",
        "電話: 03-1234-5678 までご連絡ください。"
      ], "10:14");

      // メッセージ2
      drawBubbleRight(bCtx, 120, 480, 520, 120, "#d9fdd3", [
        "山田さん、鈴木です。",
        "港区六本木6-10-1 の件、承知しました。"
      ], "10:18");

      // メッセージ3
      drawBubble(bCtx, 120, 780, 520, 130, "#ffffff", [
        "鈴木様、ありがとうございます。",
        "費用は 150,000円 となります。",
        "yamada@tech-lab.co.jp へ送付願います。"
      ], "10:22");

      // アバター
      bCtx.fillStyle = "#3b82f6";
      bCtx.beginPath();
      bCtx.arc(70, 220, 30, 0, Math.PI * 2);
      bCtx.fill();
      bCtx.fillStyle = "#10b981";
      bCtx.beginPath();
      bCtx.arc(70, 820, 30, 0, Math.PI * 2);
      bCtx.fill();
    }
    ctx.drawImage(baseCanvas, -phoneW / 2, -phoneH / 2, phoneW, phoneH);
    ctx.restore();
  }

  ctx.restore();
  return { dataUrl: outCanvas.toDataURL("image/png") };
}

