import { appState, type AppState } from "./state/appState";
import { analyzeImageForRedaction } from "./engine/redactionEngine";
import { renderRedactedCanvas, findBoxAtPosition } from "./engine/canvasRenderer";
import { generateChatSampleImage, generateSkewedChatSampleImage } from "./utils/sampleImages";
import { copyCanvasToClipboard, downloadCanvasImage, copyAiPromptToClipboard } from "./utils/exportUtils";
import { rotateImage90, rotateAndDeskewImage, enhanceImageForOcr } from "./utils/imageEnhance";
import {
  detectImageDeskewAngle,
  applyPerspectiveTransform,
  detectDocumentCornersAuto,
  type QuadCorners,
  type Point2D
} from "./engine/autoDeskew";
import { autoCorrectCapturedPhoto, type CaptureCorrectionResult } from "./engine/capturePipeline";

// DOM Elements
const emptyDropZone = document.getElementById("emptyDropZone") as HTMLDivElement;
const canvasViewport = document.getElementById("canvasViewport") as HTMLDivElement;
const renderCanvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const progressOverlay = document.getElementById("progressOverlay") as HTMLDivElement;
const progressStatus = document.getElementById("progressStatus") as HTMLHeadingElement;
const progressBar = document.getElementById("progressBar") as HTMLDivElement;
const perspectiveBar = document.getElementById("perspectiveBar") as HTMLDivElement;
const btnAutoDetectCorners = document.getElementById("btnAutoDetectCorners") as HTMLButtonElement;
const btnApplyPerspective = document.getElementById("btnApplyPerspective") as HTMLButtonElement;
const btnCancelPerspective = document.getElementById("btnCancelPerspective") as HTMLButtonElement;

// Inputs
const cameraInput = document.getElementById("cameraInput") as HTMLInputElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;

// Camera Enhancement Buttons
const btnAutoFlatten = document.getElementById("btnAutoFlatten") as HTMLButtonElement;
const btnAutoDeskew = document.getElementById("btnAutoDeskew") as HTMLButtonElement;
const btnPerspectiveMode = document.getElementById("btnPerspectiveMode") as HTMLButtonElement;
const btnRotateLeft = document.getElementById("btnRotateLeft") as HTMLButtonElement;
const btnRotateRight = document.getElementById("btnRotateRight") as HTMLButtonElement;
const btnAutoEnhance = document.getElementById("btnAutoEnhance") as HTMLButtonElement;
const sliderDeskew = document.getElementById("sliderDeskew") as HTMLInputElement;
const deskewValDisplay = document.getElementById("deskewValDisplay") as HTMLSpanElement;

// Toolbar Buttons
const toolSelectMode = document.getElementById("toolSelectMode") as HTMLButtonElement;
const toolDrawMode = document.getElementById("toolDrawMode") as HTMLButtonElement;
const styleBlackout = document.getElementById("styleBlackout") as HTMLButtonElement;
const styleWhiteout = document.getElementById("styleWhiteout") as HTMLButtonElement;
const styleMosaic = document.getElementById("styleMosaic") as HTMLButtonElement;
const styleBlur = document.getElementById("styleBlur") as HTMLButtonElement;
const btnCompare = document.getElementById("btnCompare") as HTMLButtonElement;
const btnUndo = document.getElementById("btnUndo") as HTMLButtonElement;
const btnRedo = document.getElementById("btnRedo") as HTMLButtonElement;
const btnReset = document.getElementById("btnReset") as HTMLButtonElement;

// Action Buttons
const btnTakePhoto = document.getElementById("btnTakePhoto") as HTMLButtonElement;
const btnSelectFile = document.getElementById("btnSelectFile") as HTMLButtonElement;
const btnLoadSample = document.getElementById("btnLoadSample") as HTMLButtonElement;
const btnLoadSkewedSample = document.getElementById("btnLoadSkewedSample") as HTMLButtonElement;
const btnSampleHeader = document.getElementById("btnSampleHeader") as HTMLButtonElement;
const btnNewPhotoHeader = document.getElementById("btnNewPhotoHeader") as HTMLButtonElement;

// Sidebar & Settings
const btnCopyImage = document.getElementById("btnCopyImage") as HTMLButtonElement;
const btnDownloadImage = document.getElementById("btnDownloadImage") as HTMLButtonElement;
const btnCopyPrompt = document.getElementById("btnCopyPrompt") as HTMLButtonElement;
const aiPromptSelect = document.getElementById("aiPromptSelect") as HTMLSelectElement;

const toggleFaces = document.getElementById("toggleFaces") as HTMLInputElement;
const togglePersons = document.getElementById("togglePersons") as HTMLInputElement;
const toggleCompanies = document.getElementById("toggleCompanies") as HTMLInputElement;
const togglePii = document.getElementById("togglePii") as HTMLInputElement;
const toggleFollowSlope = document.getElementById("toggleFollowSlope") as HTMLInputElement;
const sliderPadding = document.getElementById("sliderPadding") as HTMLInputElement;
const paddingValDisplay = document.getElementById("paddingValDisplay") as HTMLSpanElement;
const btnReanalyze = document.getElementById("btnReanalyze") as HTMLButtonElement;

const inputCustomKeyword = document.getElementById("inputCustomKeyword") as HTMLInputElement;
const btnAddKeyword = document.getElementById("btnAddKeyword") as HTMLButtonElement;
const customTagsList = document.getElementById("customTagsList") as HTMLDivElement;

// Statistics & List
const totalBadgeCount = document.getElementById("totalBadgeCount") as HTMLSpanElement;
const statFace = document.getElementById("statFace") as HTMLSpanElement;
const statPerson = document.getElementById("statPerson") as HTMLSpanElement;
const statCompany = document.getElementById("statCompany") as HTMLSpanElement;
const statPii = document.getElementById("statPii") as HTMLSpanElement;
const detectedItemsList = document.getElementById("detectedItemsList") as HTMLDivElement;
const toast = document.getElementById("toast") as HTMLDivElement;
const toastMessage = document.getElementById("toastMessage") as HTMLSpanElement;

// Drawing State Variables
let isDrawing = false;
let drawStartX = 0;
let drawStartY = 0;
let currentDrawRect: { x: number; y: number; width: number; height: number } | null = null;
let toastTimeout: number | null = null;

// Perspective Transform State Variables
let isPerspectiveMode = false;
let perspectiveCorners: QuadCorners | null = null;
let activeCornerKey: keyof QuadCorners | null = null;

/**
 * 台形補正ピンオーバーレイの描画
 */
function drawPerspectiveOverlay(ctx: CanvasRenderingContext2D, corners: QuadCorners): void {
  ctx.save();
  // 接続枠線
  ctx.beginPath();
  ctx.moveTo(corners.topLeft.x, corners.topLeft.y);
  ctx.lineTo(corners.topRight.x, corners.topRight.y);
  ctx.lineTo(corners.bottomRight.x, corners.bottomRight.y);
  ctx.lineTo(corners.bottomLeft.x, corners.bottomLeft.y);
  ctx.closePath();
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 4]);
  ctx.stroke();

  // 内部半透明
  ctx.fillStyle = "rgba(56, 189, 248, 0.15)";
  ctx.fill();

  // 4隅のピン
  const drawPin = (pt: Point2D, label: string) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 16, 0, Math.PI * 2);
    ctx.fillStyle = "#0284c7";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.setLineDash([]);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, pt.x, pt.y);
  };

  drawPin(corners.topLeft, "左上");
  drawPin(corners.topRight, "右上");
  drawPin(corners.bottomRight, "右下");
  drawPin(corners.bottomLeft, "左下");
  ctx.restore();
}

/**
 * トースト通知を表示
 */
function showToast(message: string, durationMs: number = 3000): void {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastMessage.textContent = message;
  toast.classList.add("show");
  toastTimeout = window.setTimeout(() => {
    toast.classList.remove("show");
  }, durationMs);
}

/**
 * 画像ファイルを読み込んで解析を開始
 */
function handleImageFile(file: File): void {
  if (!file.type.startsWith("image/")) {
    showToast("画像ファイルを選択してください");
    return;
  }

  void (async () => {
    try {
      const img = await loadImageFromFile(file);
      // 元の高画質・シャープネスを保ったまま読み込み（歪み補正は「⚡ 自動フラット化」ボタンで実行可能）
      await ingestCapturedImage(img, { autoCorrect: false });
    } catch (err) {
      console.error(err);
      showToast("画像の読み込みに失敗しました");
    }
  })();
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("blob"));
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
    });
  } catch {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }
}

// 現在の画像の補助メタデータ（サンプル画像等）
let currentPreloadedOcr: import("./engine/ocr").OcrResult | undefined;
let currentPreloadedAvatars: { x: number; y: number; width: number; height: number }[] | undefined;

/**
 * DataURLから画像を読み込んで解析を開始
 */
function handleImageDataUrl(
  dataUrl: string,
  preloadedOcr?: import("./engine/ocr").OcrResult,
  preloadedAvatars?: { x: number; y: number; width: number; height: number }[]
): void {
  const img = new Image();
  img.onload = () => {
    void ingestCapturedImage(img, {
      autoCorrect: !preloadedOcr,
      preloadedOcr,
      preloadedAvatars
    });
  };
  img.src = dataUrl;
}

let lastCorrection: CaptureCorrectionResult | null = null;

async function ingestCapturedImage(
  img: HTMLImageElement,
  opts: {
    autoCorrect: boolean;
    preloadedOcr?: import("./engine/ocr").OcrResult;
    preloadedAvatars?: { x: number; y: number; width: number; height: number }[];
  }
): Promise<void> {
  currentPreloadedOcr = opts.preloadedOcr;
  currentPreloadedAvatars = opts.preloadedAvatars;
  lastCorrection = null;

  if (!opts.autoCorrect) {
    appState.setSourceImage(img);
    await startAnalysis();
    return;
  }

  appState.setAnalyzing(true, "撮影画像を正対化しています...", 0.03);
  try {
    const corrected = await autoCorrectCapturedPhoto(img, (status, progress) => {
      appState.setAnalyzing(true, status, progress);
    });
    lastCorrection = corrected;
    currentPreloadedOcr = undefined;
    currentPreloadedAvatars = undefined;
    appState.setSourceImage(corrected.image);
    if (!corrected.skipped) {
      const bits = [
        corrected.appliedPerspective ? "台形正対化" : "",
        corrected.deskewAngle !== 0 ? `傾き${corrected.deskewAngle > 0 ? "+" : ""}${corrected.deskewAngle.toFixed(1)}°` : "",
        corrected.enhanced ? "画質整え" : ""
      ].filter(Boolean);
      if (bits.length > 0) {
        showToast(`自動補正: ${bits.join(" ＋ ")}`);
      }
    }
  } catch (err) {
    console.warn("Auto-correct failed, analyzing original:", err);
    appState.setSourceImage(img);
  }

  await startAnalysis();
}

// 現在の画像から検出された行の傾き角度（度）
let currentDetectedDeskewAngle = 0;

/**
 * 自動墨消し画像解析の実行
 */
async function startAnalysis(): Promise<void> {
  const state = appState.getState();
  if (!state.sourceImage) return;

  appState.setAnalyzing(true, "解析を準備中...", 0);

  try {
    // 画素を正対化済みなら、箱だけ傾けると位置がずれるので追従しない
    currentDetectedDeskewAngle = 0;
    const alreadyFrontal = !!(lastCorrection && !lastCorrection.skipped);
    if (toggleFollowSlope.checked && !alreadyFrontal) {
      const detected = detectImageDeskewAngle(state.sourceImage);
      if (Math.abs(detected) >= 0.8) {
        currentDetectedDeskewAngle = detected;
      }
    }

    const result = await analyzeImageForRedaction(
      state.sourceImage,
      state.filterOptions,
      (p) => {
        appState.setAnalyzing(true, p.status, p.progress);
      },
      currentPreloadedOcr,
      currentPreloadedAvatars,
      currentDetectedDeskewAngle
    );

    appState.setBoxes(result.boxes);
    const slopeNotice = currentDetectedDeskewAngle !== 0 ? ` (傾き ${currentDetectedDeskewAngle > 0 ? "+" : ""}${currentDetectedDeskewAngle.toFixed(1)}° 追従)` : "";
    const corrNotice = lastCorrection && !lastCorrection.skipped ? " / 正対化済み" : "";
    const photoNotice = result.ocrResult.analysis?.isLikelyScreenPhoto ? " / 画面撮影向け前処理" : "";
    showToast(`解析完了: ${result.boxes.length}箇所のプライバシー情報を保護しました${slopeNotice}${corrNotice}${photoNotice}`);
  } catch (err) {
    console.error("Analysis failed:", err);
    showToast("画像解析中にエラーが発生しました");
  } finally {
    appState.setAnalyzing(false);
  }
}

/**
 * Canvas描画の更新
 */
function updateCanvasRender(): void {
  const state = appState.getState();
  if (!state.sourceImage) {
    emptyDropZone.style.display = "flex";
    renderCanvas.style.display = "none";
    return;
  }

  emptyDropZone.style.display = "none";
  renderCanvas.style.display = "block";

  const ctx = renderCanvas.getContext("2d");
  if (!ctx) return;

  // 比較モード中（元画像のみ表示）
  if (state.isComparing) {
    ctx.clearRect(0, 0, renderCanvas.width, renderCanvas.height);
    ctx.drawImage(state.sourceImage, 0, 0);
    return;
  }

  // 台形補正モード中
  if (isPerspectiveMode && perspectiveCorners) {
    ctx.clearRect(0, 0, renderCanvas.width, renderCanvas.height);
    ctx.drawImage(state.sourceImage, 0, 0);
    drawPerspectiveOverlay(ctx, perspectiveCorners);
    return;
  }

  // 通常描画
  renderRedactedCanvas(
    ctx,
    state.sourceImage,
    state.boxes,
    state.rendererOptions,
    false
  );

  // 手動ドラッグ中の矩形プレビュー描画
  if (isDrawing && currentDrawRect) {
    ctx.save();
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(
      currentDrawRect.x,
      currentDrawRect.y,
      currentDrawRect.width,
      currentDrawRect.height
    );
    ctx.fillStyle = "rgba(16, 185, 129, 0.25)";
    ctx.fillRect(
      currentDrawRect.x,
      currentDrawRect.y,
      currentDrawRect.width,
      currentDrawRect.height
    );
    ctx.restore();
  }
}

/**
 * UI表示（統計・リスト・ボタン状態）の同期
 */
function syncUiWithState(state: AppState): void {
  // プログレス表示
  if (state.isAnalyzing) {
    progressOverlay.style.display = "flex";
    progressStatus.textContent = state.progressText;
    progressBar.style.width = `${Math.round(state.progressPercent * 100)}%`;
  } else {
    progressOverlay.style.display = "none";
  }

  // ツールバーボタンのアクティブ状態
  toolSelectMode.classList.toggle("active", state.mode === "select");
  toolDrawMode.classList.toggle("active", state.mode === "draw");

  styleBlackout.classList.toggle("active", state.rendererOptions.style === "blackout");
  styleWhiteout.classList.toggle("active", state.rendererOptions.style === "whiteout");
  styleMosaic.classList.toggle("active", state.rendererOptions.style === "mosaic");
  styleBlur.classList.toggle("active", state.rendererOptions.style === "blur");

  btnUndo.disabled = state.historyIndex <= 0;
  btnRedo.disabled = state.historyIndex >= state.history.length - 1;

  const hasImage = !!state.sourceImage;
  btnCopyImage.disabled = !hasImage;
  btnDownloadImage.disabled = !hasImage;
  btnCompare.disabled = !hasImage;
  btnReset.disabled = !hasImage;
  btnReanalyze.disabled = !hasImage;

  // 統計カウント
  let faceCount = 0;
  let personCount = 0;
  let companyCount = 0;
  let piiCount = 0;
  let enabledCount = 0;

  for (const box of state.boxes) {
    if (!box.enabled) continue;
    enabledCount++;
    if (box.type === "face" || box.type === "avatar") faceCount++;
    else if (box.type === "person") personCount++;
    else if (box.type === "company") companyCount++;
    else if (box.type === "pii") piiCount++;
  }

  totalBadgeCount.textContent = `${enabledCount} 件保護中`;
  statFace.textContent = String(faceCount);
  statPerson.textContent = String(personCount);
  statCompany.textContent = String(companyCount);
  statPii.textContent = String(piiCount);

  // 一覧リストの更新
  if (!state.sourceImage) {
    detectedItemsList.innerHTML = `<div style="font-size: 0.78rem; color: var(--text-dim); text-align: center; padding: 1rem;">画像が読み込まれていません</div>`;
  } else if (state.boxes.length === 0) {
    detectedItemsList.innerHTML = `<div style="font-size: 0.78rem; color: var(--text-dim); text-align: center; padding: 1rem;">保護対象は検出されませんでした</div>`;
  } else {
    detectedItemsList.innerHTML = "";
    state.boxes.forEach((box) => {
      const itemEl = document.createElement("div");
      itemEl.className = `detected-item ${box.enabled ? "" : "disabled"}`;
      itemEl.title = "クリックして保護をON/OFF";

      const left = document.createElement("div");
      left.className = "item-left";

      const badge = document.createElement("span");
      badge.className = `item-badge ${box.type}`;
      badge.textContent = box.label;

      const textSpan = document.createElement("span");
      textSpan.textContent = box.text ? `"${box.text}"` : box.reason;

      left.appendChild(badge);
      left.appendChild(textSpan);

      const statusSpan = document.createElement("span");
      statusSpan.style.fontSize = "0.75rem";
      statusSpan.textContent = box.enabled ? "保護" : "解除";
      statusSpan.style.color = box.enabled ? "var(--primary-light)" : "var(--accent-rose)";

      itemEl.appendChild(left);
      itemEl.appendChild(statusSpan);

      itemEl.addEventListener("click", () => {
        appState.toggleBox(box.id);
      });

      itemEl.addEventListener("mouseenter", () => {
        appState.setRendererOptions({ activeHoverBoxId: box.id });
        updateCanvasRender();
      });

      itemEl.addEventListener("mouseleave", () => {
        appState.setRendererOptions({ activeHoverBoxId: null });
        updateCanvasRender();
      });

      detectedItemsList.appendChild(itemEl);
    });
  }

  // カスタムタグリストの更新
  customTagsList.innerHTML = "";
  state.filterOptions.customKeywords.forEach((kw) => {
    const tag = document.createElement("span");
    tag.className = "custom-tag";
    tag.innerHTML = `<span>${kw}</span><span class="tag-remove">&times;</span>`;
    tag.querySelector(".tag-remove")?.addEventListener("click", () => {
      const nextKws = state.filterOptions.customKeywords.filter(k => k !== kw);
      appState.setFilterOptions({ customKeywords: nextKws });
    });
    customTagsList.appendChild(tag);
  });

  // Canvas再描画
  updateCanvasRender();
}

/**
 * Canvasのクリック/ドラッグ座標を画像実寸座標に変換
 */
function getCanvasCoordinates(e: MouseEvent | Touch): { x: number; y: number } {
  const rect = renderCanvas.getBoundingClientRect();
  const scaleX = renderCanvas.width / rect.width;
  const scaleY = renderCanvas.height / rect.height;

  const clientX = e.clientX;
  const clientY = e.clientY;

  return {
    x: Math.round((clientX - rect.left) * scaleX),
    y: Math.round((clientY - rect.top) * scaleY)
  };
}

/**
 * イベントリスナーの初期化
 */
function initEvents(): void {
  // 状態変更の監視
  appState.subscribe(syncUiWithState);

  // ファイル選択・カメラ
  btnTakePhoto.addEventListener("click", () => cameraInput.click());
  btnSelectFile.addEventListener("click", () => fileInput.click());
  btnNewPhotoHeader.addEventListener("click", () => fileInput.click());

  cameraInput.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) handleImageFile(file);
    cameraInput.value = "";
  });

  fileInput.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) handleImageFile(file);
    fileInput.value = "";
  });

  // サンプル画像読み込み
  const loadSampleAction = () => {
    showToast("チャット画面のサンプルを読み込んでいます...");
    const sample = generateChatSampleImage();
    handleImageDataUrl(sample.dataUrl, sample.ocrData, sample.avatars);
  };
  btnLoadSample.addEventListener("click", loadSampleAction);
  btnSampleHeader.addEventListener("click", loadSampleAction);

  // 斜め撮影サンプル読み込み
  if (btnLoadSkewedSample) {
    btnLoadSkewedSample.addEventListener("click", () => {
      showToast("斜め撮影（スマホカメラ風）サンプルを生成中...");
      const sample = generateSkewedChatSampleImage();
      // メタデータなしで通常読み込み（OCRと輪郭自動検出がフル稼働）
      handleImageDataUrl(sample.dataUrl);
    });
  }

  // ドラッグ＆ドロップ
  canvasViewport.addEventListener("dragover", (e) => {
    e.preventDefault();
    emptyDropZone.classList.add("drag-over");
  });

  canvasViewport.addEventListener("dragleave", () => {
    emptyDropZone.classList.remove("drag-over");
  });

  canvasViewport.addEventListener("drop", (e) => {
    e.preventDefault();
    emptyDropZone.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (file) handleImageFile(file);
  });

  // クリップボードからの貼り付け (Ctrl+V)
  window.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          showToast("クリップボードの画像を読み込みました");
          handleImageFile(file);
        }
        break;
      }
    }
  });

  // 操作モード切り替え
  toolSelectMode.addEventListener("click", () => appState.setMode("select"));
  toolDrawMode.addEventListener("click", () => appState.setMode("draw"));

  // 墨消しスタイル切り替え
  styleBlackout.addEventListener("click", () => appState.setRendererOptions({ style: "blackout" }));
  styleWhiteout.addEventListener("click", () => appState.setRendererOptions({ style: "whiteout" }));
  styleMosaic.addEventListener("click", () => appState.setRendererOptions({ style: "mosaic" }));
  styleBlur.addEventListener("click", () => appState.setRendererOptions({ style: "blur" }));

  // 元画像比較（長押しまたはトグル）
  btnCompare.addEventListener("mousedown", () => appState.setComparing(true));
  window.addEventListener("mouseup", () => {
    if (appState.getState().isComparing) appState.setComparing(false);
  });
  btnCompare.addEventListener("touchstart", (e) => {
    e.preventDefault();
    appState.setComparing(true);
  });
  btnCompare.addEventListener("touchend", () => appState.setComparing(false));

  // Undo / Redo / Reset
  btnUndo.addEventListener("click", () => appState.undo());
  btnRedo.addEventListener("click", () => appState.redo());
  btnReset.addEventListener("click", () => {
    if (confirm("現在の画像を閉じて新しく始めますか？")) {
      appState.setSourceImage(null);
    }
  });

  // ワンタップ自動フラット化パイプライン（撮影直後と同じ一気通貫補正）
  btnAutoFlatten.addEventListener("click", async () => {
    const state = appState.getState();
    if (!state.sourceImage) return;

    appState.setAnalyzing(true, "正対化・台形補正・画質整えを実行中...", 0.04);
    try {
      const corrected = await autoCorrectCapturedPhoto(state.sourceImage, (status, progress) => {
        appState.setAnalyzing(true, status, progress);
      });
      if (corrected.skipped) {
        appState.setAnalyzing(false);
        showToast("画像の歪み・傾きはすでに最適です（補正不要）");
        return;
      }
      lastCorrection = corrected;
      currentPreloadedOcr = undefined;
      currentPreloadedAvatars = undefined;
      appState.setSourceImage(corrected.image);
      const desc = [
        corrected.appliedPerspective ? "台形正対化" : "",
        corrected.deskewAngle !== 0 ? `水平傾き(${corrected.deskewAngle > 0 ? "+" : ""}${corrected.deskewAngle.toFixed(1)}°)` : "",
        corrected.enhanced ? "画質整え" : ""
      ].filter(Boolean).join(" ＋ ");
      showToast(`自動フラット化完了（${desc}）！真正面の状態で黒塗りを再適用します`);
      await startAnalysis();
    } catch (err) {
      console.error(err);
      appState.setAnalyzing(false);
      showToast("自動補正中にエラーが発生しました");
    }
  });

  // 自動傾き補正（AI不使用・数学的行投影プロファイル法）
  btnAutoDeskew.addEventListener("click", async () => {
    const state = appState.getState();
    if (!state.sourceImage) return;

    showToast("行の傾きを数学的解析中（AI不使用）...");
    await new Promise(r => setTimeout(r, 60));

    const angle = detectImageDeskewAngle(state.sourceImage);
    if (Math.abs(angle) < 0.3) {
      showToast("画像の傾きはすでに水平です（補正不要）");
      return;
    }

    showToast(`傾き ${angle > 0 ? "+" : ""}${angle.toFixed(1)}° を検出！水平補正中...`);
    const deskewed = await rotateAndDeskewImage(state.sourceImage, -angle);
    currentPreloadedOcr = undefined;
    currentPreloadedAvatars = undefined;
    appState.setSourceImage(deskewed);
    startAnalysis();
    showToast(`水平補正（${angle > 0 ? "+" : ""}${angle.toFixed(1)}°）を実行し再解析しました`);
  });

  // 台形補正モード起動（AI不使用で四隅を自動検出して初期配置）
  btnPerspectiveMode.addEventListener("click", () => {
    const state = appState.getState();
    if (!state.sourceImage) return;

    isPerspectiveMode = true;
    perspectiveBar.style.display = "flex";
    // 四隅を自動検出してセット
    perspectiveCorners = detectDocumentCornersAuto(state.sourceImage);
    updateCanvasRender();
    showToast("台形補正モード: 四隅を自動検出しました。青いピンをドラッグして微調整も可能です");
  });

  // 四隅の自動再検出
  btnAutoDetectCorners.addEventListener("click", () => {
    const state = appState.getState();
    if (!state.sourceImage) return;

    perspectiveCorners = detectDocumentCornersAuto(state.sourceImage);
    updateCanvasRender();
    showToast("四隅を自動検出しました！必要に応じて微調整してください");
  });

  // 台形補正キャンセル
  btnCancelPerspective.addEventListener("click", () => {
    isPerspectiveMode = false;
    perspectiveBar.style.display = "none";
    perspectiveCorners = null;
    activeCornerKey = null;
    updateCanvasRender();
  });

  // 台形補正実行
  btnApplyPerspective.addEventListener("click", async () => {
    const state = appState.getState();
    if (!state.sourceImage || !perspectiveCorners) return;

    showToast("台形透視変換を実行中...");
    const warpedCanvas = applyPerspectiveTransform(state.sourceImage, perspectiveCorners);
    const warpedImg = await new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = warpedCanvas.toDataURL("image/png");
    });

    isPerspectiveMode = false;
    perspectiveBar.style.display = "none";
    perspectiveCorners = null;
    activeCornerKey = null;

    currentPreloadedOcr = undefined;
    currentPreloadedAvatars = undefined;
    appState.setSourceImage(warpedImg);
    startAnalysis();
    showToast("台形補正が完了しました！フラットな画面で自動黒塗りを適用しました");
  });

  // 撮影写真の補正イベント
  btnRotateLeft.addEventListener("click", async () => {
    const state = appState.getState();
    if (!state.sourceImage) return;
    showToast("反時計回りに90°回転中...");
    const rotated = await rotateImage90(state.sourceImage, false);
    currentPreloadedOcr = undefined;
    currentPreloadedAvatars = undefined;
    appState.setSourceImage(rotated);
    startAnalysis();
  });

  btnRotateRight.addEventListener("click", async () => {
    const state = appState.getState();
    if (!state.sourceImage) return;
    showToast("時計回りに90°回転中...");
    const rotated = await rotateImage90(state.sourceImage, true);
    currentPreloadedOcr = undefined;
    currentPreloadedAvatars = undefined;
    appState.setSourceImage(rotated);
    startAnalysis();
  });

  btnAutoEnhance.addEventListener("click", async () => {
    const state = appState.getState();
    if (!state.sourceImage) return;
    showToast("モアレ低減・コントラスト強調を実行中...");
    const enhanced = await enhanceImageForOcr(state.sourceImage);
    appState.setSourceImage(enhanced);
    startAnalysis();
  });

  sliderDeskew.addEventListener("change", async () => {
    const state = appState.getState();
    if (!state.sourceImage) return;
    const angle = parseFloat(sliderDeskew.value);
    deskewValDisplay.textContent = `${angle > 0 ? "+" : ""}${angle}°`;
    if (Math.abs(angle) < 0.1) return;
    showToast(`傾き ${angle}° を補正中...`);
    const deskewed = await rotateAndDeskewImage(state.sourceImage, angle);
    currentPreloadedOcr = undefined;
    currentPreloadedAvatars = undefined;
    appState.setSourceImage(deskewed);
    startAnalysis();
  });

  sliderDeskew.addEventListener("input", () => {
    const angle = parseFloat(sliderDeskew.value);
    deskewValDisplay.textContent = `${angle > 0 ? "+" : ""}${angle}°`;
  });

  // 再解析
  btnReanalyze.addEventListener("click", () => {
    startAnalysis();
  });

  // フィルタースイッチ
  toggleFaces.addEventListener("change", () => {
    appState.setFilterOptions({
      detectFaces: toggleFaces.checked,
      detectAvatars: toggleFaces.checked
    });
  });
  togglePersons.addEventListener("change", () => {
    appState.setFilterOptions({ detectPersons: togglePersons.checked });
  });
  toggleCompanies.addEventListener("change", () => {
    appState.setFilterOptions({ detectCompanies: toggleCompanies.checked });
  });
  togglePii.addEventListener("change", () => {
    appState.setFilterOptions({ detectPii: togglePii.checked });
  });
  toggleFollowSlope.addEventListener("change", () => {
    startAnalysis();
  });

  // 安全マージン（パディング）スライダー
  sliderPadding.addEventListener("input", () => {
    const val = parseInt(sliderPadding.value, 10);
    paddingValDisplay.textContent = `+${val} px`;
    appState.setFilterOptions({ padding: val });
  });

  // カスタムキーワード追加
  const addKeywordAction = () => {
    const kw = inputCustomKeyword.value.trim();
    if (!kw) return;
    const current = appState.getState().filterOptions.customKeywords;
    if (!current.includes(kw)) {
      appState.setFilterOptions({ customKeywords: [...current, kw] });
      inputCustomKeyword.value = "";
      showToast(`キーワード「${kw}」を追加しました。再解析で反映されます`);
    }
  };
  btnAddKeyword.addEventListener("click", addKeywordAction);
  inputCustomKeyword.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addKeywordAction();
  });

  // エクスポート & AI連携ボタン
  btnCopyImage.addEventListener("click", async () => {
    const state = appState.getState();
    if (!state.sourceImage) return;

    // クリップボード用オフスクリーンCanvasの生成（装飾枠線なし）
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = state.sourceImage.width;
    exportCanvas.height = state.sourceImage.height;
    const eCtx = exportCanvas.getContext("2d");
    if (!eCtx) return;

    renderRedactedCanvas(
      eCtx,
      state.sourceImage,
      state.boxes,
      state.rendererOptions,
      true
    );

    const res = await copyCanvasToClipboard(exportCanvas);
    showToast(res.message, 4000);
  });

  btnDownloadImage.addEventListener("click", () => {
    const state = appState.getState();
    if (!state.sourceImage) return;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = state.sourceImage.width;
    exportCanvas.height = state.sourceImage.height;
    const eCtx = exportCanvas.getContext("2d");
    if (!eCtx) return;

    renderRedactedCanvas(
      eCtx,
      state.sourceImage,
      state.boxes,
      state.rendererOptions,
      true
    );

    downloadCanvasImage(exportCanvas, `kuronuri_${Date.now()}.png`);
    showToast("画像をダウンロードしました");
  });

  btnCopyPrompt.addEventListener("click", async () => {
    const promptType = aiPromptSelect.value as "summary" | "reply" | "advice";
    const res = await copyAiPromptToClipboard(promptType);
    showToast(res.message, 3500);
  });

  // ==========================================
  // Canvas Mouse & Touch Interactions
  // ==========================================

  function findNearestCorner(corners: QuadCorners, x: number, y: number, radius: number = 40): keyof QuadCorners | null {
    const dist = (p: Point2D) => Math.hypot(p.x - x, p.y - y);
    if (dist(corners.topLeft) <= radius) return "topLeft";
    if (dist(corners.topRight) <= radius) return "topRight";
    if (dist(corners.bottomRight) <= radius) return "bottomRight";
    if (dist(corners.bottomLeft) <= radius) return "bottomLeft";
    return null;
  }

  // マウス移動（ホバー検出・ピンドラッグ）
  renderCanvas.addEventListener("mousemove", (e) => {
    const state = appState.getState();
    if (!state.sourceImage) return;

    const { x, y } = getCanvasCoordinates(e);

    // 台形補正モード中のピン操作
    if (isPerspectiveMode && perspectiveCorners) {
      if (activeCornerKey) {
        perspectiveCorners[activeCornerKey] = { x, y };
        updateCanvasRender();
      } else {
        const hoveredCorner = findNearestCorner(perspectiveCorners, x, y);
        renderCanvas.style.cursor = hoveredCorner ? "grab" : "default";
      }
      return;
    }

    if (isDrawing) return;

    const box = findBoxAtPosition(state.boxes, x, y);
    if (box) {
      renderCanvas.style.cursor = state.mode === "select" ? "pointer" : "crosshair";
      if (state.rendererOptions.activeHoverBoxId !== box.id) {
        appState.setRendererOptions({ activeHoverBoxId: box.id });
        updateCanvasRender();
      }
    } else {
      renderCanvas.style.cursor = state.mode === "select" ? "default" : "crosshair";
      if (state.rendererOptions.activeHoverBoxId !== null) {
        appState.setRendererOptions({ activeHoverBoxId: null });
        updateCanvasRender();
      }
    }
  });

  // マウスダウン（クリックまたはドラッグ開始）
  renderCanvas.addEventListener("mousedown", (e) => {
    const state = appState.getState();
    if (!state.sourceImage || e.button !== 0) return;

    const { x, y } = getCanvasCoordinates(e);

    // 台形補正モード
    if (isPerspectiveMode && perspectiveCorners) {
      const corner = findNearestCorner(perspectiveCorners, x, y);
      if (corner) {
        activeCornerKey = corner;
        renderCanvas.style.cursor = "grabbing";
      }
      return;
    }

    if (state.mode === "select") {
      const box = findBoxAtPosition(state.boxes, x, y);
      if (box) {
        appState.toggleBox(box.id);
        showToast(box.enabled ? "保護を解除しました" : "保護を再適用しました");
      }
    } else if (state.mode === "draw") {
      isDrawing = true;
      drawStartX = x;
      drawStartY = y;
      currentDrawRect = { x, y, width: 0, height: 0 };
    }
  });

  // マウスドラッグ中
  window.addEventListener("mousemove", (e) => {
    if (isPerspectiveMode && perspectiveCorners && activeCornerKey) {
      const { x, y } = getCanvasCoordinates(e);
      perspectiveCorners[activeCornerKey] = { x, y };
      updateCanvasRender();
      return;
    }

    if (!isDrawing) return;
    const { x, y } = getCanvasCoordinates(e);

    const minX = Math.min(drawStartX, x);
    const minY = Math.min(drawStartY, y);
    const width = Math.abs(x - drawStartX);
    const height = Math.abs(y - drawStartY);

    currentDrawRect = { x: minX, y: minY, width, height };
    updateCanvasRender();
  });

  // マウスアップ（ドラッグ完了）
  window.addEventListener("mouseup", () => {
    if (isPerspectiveMode) {
      activeCornerKey = null;
      renderCanvas.style.cursor = "default";
      return;
    }

    if (!isDrawing) return;
    isDrawing = false;

    if (currentDrawRect && currentDrawRect.width >= 5 && currentDrawRect.height >= 5) {
      const rot = toggleFollowSlope.checked && currentDetectedDeskewAngle !== 0 ? currentDetectedDeskewAngle : undefined;
      appState.addManualBox(currentDrawRect, rot);
      showToast("手動黒塗りを追加しました");
    }

    currentDrawRect = null;
    updateCanvasRender();
  });

  // タッチ操作（スマホ対応）
  renderCanvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const state = appState.getState();
      const { x, y } = getCanvasCoordinates(touch);

      if (isPerspectiveMode && perspectiveCorners) {
        const corner = findNearestCorner(perspectiveCorners, x, y);
        if (corner) {
          e.preventDefault();
          activeCornerKey = corner;
        }
        return;
      }

      if (state.mode === "select") {
        const box = findBoxAtPosition(state.boxes, x, y);
        if (box) {
          e.preventDefault();
          appState.toggleBox(box.id);
          showToast(box.enabled ? "保護を解除しました" : "保護を再適用しました");
        }
      } else if (state.mode === "draw") {
        e.preventDefault();
        isDrawing = true;
        drawStartX = x;
        drawStartY = y;
        currentDrawRect = { x, y, width: 0, height: 0 };
      }
    }
  }, { passive: false });

  renderCanvas.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const { x, y } = getCanvasCoordinates(touch);

    if (isPerspectiveMode && perspectiveCorners && activeCornerKey) {
      e.preventDefault();
      perspectiveCorners[activeCornerKey] = { x, y };
      updateCanvasRender();
      return;
    }

    if (!isDrawing) return;
    e.preventDefault();

    const minX = Math.min(drawStartX, x);
    const minY = Math.min(drawStartY, y);
    const width = Math.abs(x - drawStartX);
    const height = Math.abs(y - drawStartY);

    currentDrawRect = { x: minX, y: minY, width, height };
    updateCanvasRender();
  }, { passive: false });

  renderCanvas.addEventListener("touchend", () => {
    if (isPerspectiveMode) {
      activeCornerKey = null;
      return;
    }

    if (!isDrawing) return;
    isDrawing = false;

    if (currentDrawRect && currentDrawRect.width >= 5 && currentDrawRect.height >= 5) {
      const rot = toggleFollowSlope.checked && currentDetectedDeskewAngle !== 0 ? currentDetectedDeskewAngle : undefined;
      appState.addManualBox(currentDrawRect, rot);
      showToast("手動黒塗りを追加しました");
    }

    currentDrawRect = null;
    updateCanvasRender();
  });
}

// 初期化実行
initEvents();
