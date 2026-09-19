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
    return { dataUrl: "", ocrData: { fullText: "", lines: [], symbols: [], scale: 1 }, avatars: [] };
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
      rawText: text,
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
      symbols: lineSymbols,
      alignedSymbols: lineSymbols,
      confidence: 99
    });
  };

  // 1. チャット背景
  ctx.fillStyle = "#8c9cb3";
  ctx.fillRect(0, 0, w, h);

  // 2. ヘッダーバー
  ctx.fillStyle = "#273244";
  ctx.fillRect(0, 0, w, 110);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 25px sans-serif";
  ctx.fillText("【サンプル】プロジェクト連絡（山田・鈴木）", 80, 68);
  recordLine("【サンプル】プロジェクト連絡（山田・鈴木）", 80, 42, "bold 25px sans-serif", 30);

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
      symbols: allSymbols,
      scale: 1
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
      bCtx.font = "bold 24px sans-serif";
      bCtx.fillText("【サンプル】プロジェクト連絡（山田・鈴木）", 85, 68);

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

/**
 * プライベート利用（個人のライフスタイルサービス・マイページ）のダッシュボードサンプル画像を生成
 * 顔写真、個人メールアドレス、自宅住所、電話番号、パスワード、サブスク金額などを自然に配置
 */
export function generateDashboardSampleImage(): SampleChatResult {
  const canvas = document.createElement("canvas");
  const w = 820;
  const h = 1220;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { dataUrl: "", ocrData: { fullText: "", lines: [], symbols: [], scale: 1 }, avatars: [] };
  }

  const lines: OcrLine[] = [];
  const allSymbols: OcrChar[] = [];

  // ヘルパー：Canvasのフォント幅に基づいた精密な行情報の登録
  const recordLine = (text: string, x: number, y: number, font: string = "16px sans-serif", lineHeight: number = 22) => {
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
      rawText: text,
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
      symbols: lineSymbols,
      alignedSymbols: lineSymbols,
      confidence: 99
    });
  };

  // 1. 背景（モダンなオフホワイト・スレート背景）
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, w, h);

  // 2. 上部ヘッダーバー（日常使いのWebサービス）
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, w, 70);

  // サービスロゴ（WebサイトのUI装飾）
  ctx.fillStyle = "#38bdf8";
  ctx.beginPath();
  ctx.arc(38, 35, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("🌿 LifeSync Hub", 62, 42);

  // ヘッダー右側（ログインユーザーミニ情報）
  ctx.fillStyle = "#94a3b8";
  ctx.font = "14px sans-serif";
  ctx.fillText("ログイン中:", w - 210, 41);
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText("佐々木 葵", w - 130, 41);
  recordLine("佐々木 葵", w - 130, 26, "bold 14px sans-serif", 20);

  // 3. パンくずリスト & ページタイトル
  ctx.fillStyle = "#64748b";
  ctx.font = "13px sans-serif";
  ctx.fillText("ホーム  >  マイアカウント  >  プロフィール・セキュリティ設定", 35, 104);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 24px sans-serif";
  ctx.fillText("👤 マイアカウント管理ダッシュボード", 35, 142);

  // 4. カード1: ユーザープロフィール（個人情報 & 顔写真）
  // 左列（写真＋キャプション）と右列（項目）が重ならないよう列幅を固定する
  const card1Y = 175;
  const card1H = 410;
  const cardX = 35;
  const cardW = w - 70;
  drawCard(ctx, cardX, card1Y, cardW, card1H, "プロフィール・連絡先情報");

  // 顔写真（アバター）座標: カードヘッダー線（card1Y + 46）の下に十分なマージンを空けて配置
  const faceX = 55;
  const faceY = card1Y + 70;
  const faceSize = 120;
  const avatars = [
    { x: faceX, y: faceY, width: faceSize, height: faceSize }
  ];

  // 本人の顔写真ポートレート描画（プライベート感のある普段着・自撮り風）
  drawRealisticPortrait(ctx, faceX, faceY, faceSize);

  // 写真下の変更リンク。写真幅に収まる1行にし、右列へはみ出さない
  ctx.save();
  ctx.fillStyle = "#0284c7";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("写真を変更", faceX + faceSize / 2, faceY + faceSize + 12);
  ctx.restore();

  // 個人情報フィールド群（右側エリア）。左列右端＋余白から開始
  const infoX = faceX + faceSize + 36;
  const infoMaxW = cardX + cardW - 20 - infoX;
  let curY = card1Y + 70;

  // 氏名（お名前）
  ctx.fillStyle = "#64748b";
  ctx.font = "13px sans-serif";
  ctx.fillText("お名前（本名）", infoX, curY);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("佐々木 葵（Aoi Sasaki）", infoX, curY + 24);
  recordLine("佐々木 葵（Aoi Sasaki）", infoX, curY + 4, "bold 18px sans-serif", 24);
  curY += 62;

  // アカウントID / ニックネーム
  ctx.fillStyle = "#64748b";
  ctx.font = "13px sans-serif";
  ctx.fillText("ユーザーID / 表示ネーム", infoX, curY);
  ctx.fillStyle = "#334155";
  ctx.font = "15px sans-serif";
  ctx.fillText("@aoi_lifestyle", infoX, curY + 20);
  recordLine("@aoi_lifestyle", infoX, curY + 4, "15px sans-serif", 20);
  curY += 56;

  // メールアドレス
  ctx.fillStyle = "#64748b";
  ctx.font = "13px sans-serif";
  ctx.fillText("登録メールアドレス（個人）", infoX, curY);
  ctx.fillStyle = "#0284c7";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("Email: aoi.sasaki92@sample-mail.jp", infoX, curY + 22);
  recordLine("Email: aoi.sasaki92@sample-mail.jp", infoX, curY + 4, "bold 16px sans-serif", 22);
  curY += 56;

  // 携帯電話番号
  ctx.fillStyle = "#64748b";
  ctx.font = "13px sans-serif";
  ctx.fillText("連絡先電話番号", infoX, curY);
  ctx.fillStyle = "#1e293b";
  ctx.font = "16px sans-serif";
  ctx.fillText("TEL: 090-6543-2109", infoX, curY + 20);
  recordLine("TEL: 090-6543-2109", infoX, curY + 4, "16px sans-serif", 20);
  curY += 56;

  // 自宅住所（お届け先）
  ctx.fillStyle = "#64748b";
  ctx.font = "13px sans-serif";
  ctx.fillText("自宅お届け先住所", infoX, curY);
  ctx.fillStyle = "#1e293b";
  ctx.font = "15px sans-serif";
  const addressText = "住所: 東京都世田谷区桜新町2-15-8 メゾンサクラ302";
  const addressLines = wrapCanvasText(ctx, addressText, infoMaxW);
  addressLines.forEach((line, idx) => {
    ctx.fillText(line, infoX, curY + 20 + idx * 20);
    recordLine(line, infoX, curY + 4 + idx * 20, "15px sans-serif", 20);
  });

  // 5. カード2: プライベート サブスク & 決済情報
  const card2Y = card1Y + card1H + 20;
  const card2H = 265;
  drawCard(ctx, 35, card2Y, w - 70, card2H, "💳 サブスクリプション & お支払い設定");

  let pY = card2Y + 64;
  // ご利用プラン
  ctx.fillStyle = "#64748b";
  ctx.font = "13px sans-serif";
  ctx.fillText("現在のご利用プラン", 55, pY);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("プレミアム会員（個人・月額プラン）", 55, pY + 22);

  // 月額料金
  ctx.fillStyle = "#64748b";
  ctx.font = "13px sans-serif";
  ctx.fillText("月額利用料金", 480, pY);
  ctx.fillStyle = "#e11d48";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("月額: 1,480円 (税込)", 480, pY + 22);
  recordLine("月額: 1,480円 (税込)", 480, pY + 2, "bold 20px sans-serif", 24);
  pY += 60;

  // 登録クレジットカード
  ctx.fillStyle = "#64748b";
  ctx.font = "13px sans-serif";
  ctx.fillText("お支払いカード（プライベート）", 55, pY);
  ctx.fillStyle = "#1e293b";
  ctx.font = "15px sans-serif";
  ctx.fillText("お支払いカード: JCB (下4桁: 5123) 有効期限: 11/29", 55, pY + 20);
  recordLine("お支払いカード: JCB (下4桁: 5123) 有効期限: 11/29", 55, pY + 4, "15px sans-serif", 20);
  pY += 55;

  // 次回更新日 & 請求先
  ctx.fillStyle = "#64748b";
  ctx.font = "13px sans-serif";
  ctx.fillText("次回自動更新日", 55, pY);
  ctx.fillStyle = "#334155";
  ctx.font = "15px sans-serif";
  ctx.fillText("2026年10月1日（毎月1日自動決済）", 55, pY + 20);

  // 6. カード3: セキュリティ & ログイン情報
  const card3Y = card2Y + card2H + 20;
  const card3H = 260;
  drawCard(ctx, 35, card3Y, w - 70, card3H, "🔒 セキュリティ & ログイン管理");

  let sY = card3Y + 64;
  // パスワード
  ctx.fillStyle = "#64748b";
  ctx.font = "13px sans-serif";
  ctx.fillText("現在のログインパスワード", 55, sY);
  ctx.fillStyle = "#1e293b";
  ctx.font = "16px sans-serif";
  ctx.fillText("パスワード: ●●●●●●●● (Password: aoi#Star982!)", 55, sY + 22);
  recordLine("パスワード: ●●●●●●●● (Password: aoi#Star982!)", 55, sY + 4, "16px sans-serif", 22);
  sY += 58;

  // 2要素認証
  ctx.fillStyle = "#64748b";
  ctx.font = "13px sans-serif";
  ctx.fillText("二要素認証ステータス", 55, sY);
  ctx.fillStyle = "#16a34a";
  ctx.font = "bold 15px sans-serif";
  ctx.fillText("✓ 有効（認証アプリ設定済み: iPhone 15）", 55, sY + 20);
  sY += 52;

  // 最終ログイン履歴
  ctx.fillStyle = "#64748b";
  ctx.font = "13px sans-serif";
  ctx.fillText("最終ログイン日時・接続元", 55, sY);
  ctx.fillStyle = "#475569";
  ctx.font = "14px sans-serif";
  ctx.fillText("最終ログイン: 2026/09/18 07:30 (東京都世田谷区)", 55, sY + 20);
  recordLine("最終ログイン: 2026/09/18 07:30 (東京都世田谷区)", 55, sY + 4, "14px sans-serif", 20);

  const fullText = lines.map(l => l.text).join("\n");

  return {
    dataUrl: canvas.toDataURL("image/png"),
    ocrData: {
      fullText,
      lines,
      symbols: allSymbols,
      scale: 1
    },
    avatars
  };
}

/**
 * Canvas 上の文字列を maxWidth に収まるよう1文字ずつ折り返す
 */
function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  if (!text) return [];
  if (maxWidth <= 0) return [text];
  const lines: string[] = [];
  let current = "";
  for (const ch of text) {
    const trial = current + ch;
    if (current.length > 0 && ctx.measureText(trial).width > maxWidth) {
      lines.push(current);
      current = ch;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * ダッシュボード用カード枠を描画
 */
function drawCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string
): void {
  ctx.save();
  // カード背景
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(15, 23, 42, 0.08)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();

  // カード枠線
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.stroke();

  // カードヘッダー仕切り線
  ctx.beginPath();
  ctx.moveTo(x + 16, y + 46);
  ctx.lineTo(x + w - 16, y + 46);
  ctx.strokeStyle = "#f1f5f9";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // タイトル
  ctx.fillStyle = "#1e293b";
  ctx.font = "bold 17px sans-serif";
  ctx.fillText(title, x + 20, y + 31);
  ctx.restore();
}

/**
 * プライベート感のあるナチュラルな人物顔写真ポートレート（自撮り・普段着風）を描画
 */
function drawRealisticPortrait(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number
): void {
  ctx.save();

  // クリップ（角丸）
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 16);
  ctx.clip();

  // 1. 写真の背景（カフェ・屋外の自然光・温かみのあるボケ風グラデーション）
  const bgGrad = ctx.createLinearGradient(x, y, x + size, y + size);
  bgGrad.addColorStop(0, "#fed7aa"); // 温かみのあるアンバー
  bgGrad.addColorStop(0.5, "#fdba74");
  bgGrad.addColorStop(1, "#c084fc"); // 優しいパープル
  ctx.fillStyle = bgGrad;
  ctx.fillRect(x, y, size, size);

  // 背景の柔らかい光のボケ丸
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.beginPath();
  ctx.arc(x + size * 0.2, y + size * 0.25, size * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + size * 0.85, y + size * 0.4, size * 0.18, 0, Math.PI * 2);
  ctx.fill();

  const cx = x + size / 2;

  // 2. 普段着・カジュアルTシャツ（爽やかなミントグリーン）
  ctx.fillStyle = "#0d9488";
  ctx.beginPath();
  ctx.ellipse(cx, y + size * 1.08, size * 0.52, size * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tシャツの首元クルーネック
  ctx.fillStyle = "#0f766e";
  ctx.beginPath();
  ctx.arc(cx, y + size * 0.88, size * 0.16, 0, Math.PI);
  ctx.fill();

  // 3. 首
  ctx.fillStyle = "#fbcfe8";
  const neckGrad = ctx.createLinearGradient(cx, y + size * 0.65, cx, y + size * 0.85);
  neckGrad.addColorStop(0, "#fed7aa");
  neckGrad.addColorStop(1, "#fcd34d");
  ctx.fillStyle = neckGrad;
  ctx.fillRect(cx - size * 0.11, y + size * 0.65, size * 0.22, size * 0.22);

  // 4. 顔の輪郭（優しいオーバル）
  ctx.fillStyle = "#ffedd5";
  ctx.beginPath();
  ctx.ellipse(cx, y + size * 0.52, size * 0.24, size * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  // ほほのチーク（ほんのりピンク）
  ctx.fillStyle = "rgba(244, 114, 182, 0.35)";
  ctx.beginPath();
  ctx.arc(cx - size * 0.14, y + size * 0.56, size * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + size * 0.14, y + size * 0.56, size * 0.07, 0, Math.PI * 2);
  ctx.fill();

  // 5. 目（自然な笑顔）
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";

  // 左目（にっこりアーチ）
  ctx.beginPath();
  ctx.arc(cx - size * 0.1, y + size * 0.5, size * 0.05, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();

  // 右目（にっこりアーチ）
  ctx.beginPath();
  ctx.arc(cx + size * 0.1, y + size * 0.5, size * 0.05, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();

  // 眉毛
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(cx - size * 0.1, y + size * 0.44, size * 0.06, Math.PI * 1.2, Math.PI * 1.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + size * 0.1, y + size * 0.44, size * 0.06, Math.PI * 1.2, Math.PI * 1.8);
  ctx.stroke();

  // 6. 鼻（小さなシャドウ）
  ctx.fillStyle = "#fba988";
  ctx.beginPath();
  ctx.ellipse(cx, y + size * 0.56, size * 0.025, size * 0.018, 0, 0, Math.PI * 2);
  ctx.fill();

  // 7. 口（優しい笑顔）
  ctx.fillStyle = "#f43f5e";
  ctx.beginPath();
  ctx.arc(cx, y + size * 0.62, size * 0.06, 0, Math.PI);
  ctx.fill();

  // 8. 髪型（ナチュラルなミディアムヘア・ブラウン）
  ctx.fillStyle = "#451a03"; // ダークブラウン
  // 頭頂部ボリューム
  ctx.beginPath();
  ctx.arc(cx, y + size * 0.38, size * 0.28, Math.PI * 0.85, Math.PI * 2.15);
  ctx.fill();

  // 前髪（自然な分け目）
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.24, y + size * 0.42);
  ctx.quadraticCurveTo(cx - size * 0.05, y + size * 0.36, cx + size * 0.08, y + size * 0.45);
  ctx.quadraticCurveTo(cx + size * 0.24, y + size * 0.39, cx + size * 0.25, y + size * 0.52);
  ctx.lineTo(cx + size * 0.26, y + size * 0.32);
  ctx.lineTo(cx - size * 0.26, y + size * 0.32);
  ctx.closePath();
  ctx.fill();

  // サイドの髪の流れ
  ctx.beginPath();
  ctx.ellipse(cx - size * 0.23, y + size * 0.52, size * 0.06, size * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + size * 0.23, y + size * 0.52, size * 0.06, size * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  // 写真の外枠（ホワイト枠線）
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 16);
  ctx.stroke();
  ctx.restore();
}


