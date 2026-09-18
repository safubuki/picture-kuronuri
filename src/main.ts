import { appState, type AppState } from "./state/appState";
import { analyzeImageForRedaction, type RedactBox } from "./engine/redactionEngine";
import { renderRedactedCanvas, findBoxAtPosition, renderLineGuides } from "./engine/canvasRenderer";
import { calculateLineSnap, type SnapResult } from "./engine/lineSnap";
import { generateChatSampleImage, generateDashboardSampleImage, generateSkewedChatSampleImage } from "./utils/sampleImages";
import { copyCanvasToClipboard, downloadCanvasImage, copyAiPromptToClipboard } from "./utils/exportUtils";
import { rotateImage90, rotateAndDeskewImage, enhanceImageForOcr } from "./utils/imageEnhance";
import {
  detectImageDeskewAngle,
  applyPerspectiveTransform,
  detectDocumentCornersAuto,
  type QuadCorners,
  type Point2D
} from "./engine/autoDeskew";
import { defaultQuadCorners } from "./engine/screenQuad";
import { autoCorrectCapturedPhoto, type CaptureCorrectionResult } from "./engine/capturePipeline";
import { generateRedactedText, buildAiPromptWithRedactedText } from "./utils/redactedTextExport";
import { registerSW } from "virtual:pwa-register";
import { ModelCacheManager } from "./engine/modelCache";
import { isLlmOptInEnabled, setLlmOptInEnabled, getLocalLlmPipeline, cleanAndRedactTextWithLlm } from "./engine/localLlm";

// DOM Elements
const emptyDropZone = document.getElementById("emptyDropZone") as HTMLDivElement;
const canvasViewport = document.getElementById("canvasViewport") as HTMLDivElement;
const renderCanvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const progressOverlay = document.getElementById("progressOverlay") as HTMLDivElement;
const progressStatus = document.getElementById("progressStatus") as HTMLHeadingElement;
const progressSubStatus = document.getElementById("progressSubStatus") as HTMLDivElement;
const progressBar = document.getElementById("progressBar") as HTMLDivElement;
const perspectiveBar = document.getElementById("perspectiveBar") as HTMLDivElement;
const btnResetCornersFull = document.getElementById("btnResetCornersFull") as HTMLButtonElement;
const btnAutoDetectCorners = document.getElementById("btnAutoDetectCorners") as HTMLButtonElement;
const btnApplyPerspective = document.getElementById("btnApplyPerspective") as HTMLButtonElement;
const btnCancelPerspective = document.getElementById("btnCancelPerspective") as HTMLButtonElement;

// Zoom & Snap Controls Elements
const zoomControls = document.getElementById("zoomControls") as HTMLDivElement;
const btnToggleLineSnap = document.getElementById("btnToggleLineSnap") as HTMLButtonElement;
const btnZoomOut = document.getElementById("btnZoomOut") as HTMLButtonElement;
const btnZoomReset = document.getElementById("btnZoomReset") as HTMLButtonElement;
const btnZoomIn = document.getElementById("btnZoomIn") as HTMLButtonElement;
const btnZoomFit = document.getElementById("btnZoomFit") as HTMLButtonElement;
const zoomLevelDisplay = document.getElementById("zoomLevelDisplay") as HTMLSpanElement;

// Inputs
const cameraInput = document.getElementById("cameraInput") as HTMLInputElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;

// Live Camera Modal Elements
const cameraModal = document.getElementById("cameraModal") as HTMLDivElement;
const cameraBackdrop = document.getElementById("cameraBackdrop") as HTMLDivElement;
const cameraVideo = document.getElementById("cameraVideo") as HTMLVideoElement;
const btnCloseCameraModal = document.getElementById("btnCloseCameraModal") as HTMLButtonElement;
const btnSwitchCamera = document.getElementById("btnSwitchCamera") as HTMLButtonElement;
const btnShutter = document.getElementById("btnShutter") as HTMLButtonElement;
const btnCameraFallbackFile = document.getElementById("btnCameraFallbackFile") as HTMLButtonElement;

let activeCameraStream: MediaStream | null = null;
let currentFacingMode: "environment" | "user" = "environment";

// Camera Enhancement Buttons
const btnAutoFlatten = document.getElementById("btnAutoFlatten") as HTMLButtonElement;
const btnAutoDeskew = document.getElementById("btnAutoDeskew") as HTMLButtonElement;
const btnPerspectiveMode = document.getElementById("btnPerspectiveMode") as HTMLButtonElement;
const btnRotateLeft = document.getElementById("btnRotateLeft") as HTMLButtonElement;
const btnRotateRight = document.getElementById("btnRotateRight") as HTMLButtonElement;
const btnAutoEnhance = document.getElementById("btnAutoEnhance") as HTMLButtonElement;
const sliderDeskew = document.getElementById("sliderDeskew") as HTMLInputElement;
const deskewValDisplay = document.getElementById("deskewValDisplay") as HTMLSpanElement;

// Toolbar Elements
const toolSelectMode = document.getElementById("toolSelectMode") as HTMLButtonElement;
const toolDrawMode = document.getElementById("toolDrawMode") as HTMLButtonElement;
const selectRedactStyle = document.getElementById("selectRedactStyle") as HTMLSelectElement;
const sampleDropdownMenu = document.getElementById("sampleDropdownMenu") as HTMLDivElement | null;
const menuSampleChat = document.getElementById("menuSampleChat") as HTMLButtonElement | null;
const menuSampleDashboard = document.getElementById("menuSampleDashboard") as HTMLButtonElement | null;
const menuSampleSkewed = document.getElementById("menuSampleSkewed") as HTMLButtonElement | null;
const btnLoadDashboardSample = document.getElementById("btnLoadDashboardSample") as HTMLButtonElement | null;
const btnCompare = document.getElementById("btnCompare") as HTMLButtonElement;
const btnClearAllBoxes = document.getElementById("btnClearAllBoxes") as HTMLButtonElement;
const btnSideClearAll = document.getElementById("btnSideClearAll") as HTMLButtonElement | null;
const btnUndo = document.getElementById("btnUndo") as HTMLButtonElement;
const btnRedo = document.getElementById("btnRedo") as HTMLButtonElement;
const btnReset = document.getElementById("btnReset") as HTMLButtonElement;
const btnToolbarPerspective = document.getElementById("btnToolbarPerspective") as HTMLButtonElement;
const btnToolbarAutoDetect = document.getElementById("btnToolbarAutoDetect") as HTMLButtonElement;

// Box Editor Popover Elements
const boxEditorPopover = document.getElementById("boxEditorPopover") as HTMLDivElement;
const btnPopoverClose = document.getElementById("btnPopoverClose") as HTMLButtonElement;
const popoverCustomLabel = document.getElementById("popoverCustomLabel") as HTMLInputElement;
const btnApplyPopoverCustom = document.getElementById("btnApplyPopoverCustom") as HTMLButtonElement;
const btnPopoverToggle = document.getElementById("btnPopoverToggle") as HTMLButtonElement;
const popoverToggleText = document.getElementById("popoverToggleText") as HTMLSpanElement;
const btnPopoverDelete = document.getElementById("btnPopoverDelete") as HTMLButtonElement;

// Action Buttons
const btnTakePhoto = document.getElementById("btnTakePhoto") as HTMLButtonElement;
const btnSelectFile = document.getElementById("btnSelectFile") as HTMLButtonElement;
const btnLoadSample = document.getElementById("btnLoadSample") as HTMLButtonElement | null;
const btnLoadSkewedSample = document.getElementById("btnLoadSkewedSample") as HTMLButtonElement | null;
const btnSampleHeader = document.getElementById("btnSampleHeader") as HTMLButtonElement;


const btnNewPhotoHeader = document.getElementById("btnNewPhotoHeader") as HTMLButtonElement;

// Sidebar & Settings
const btnCopyImage = document.getElementById("btnCopyImage") as HTMLButtonElement;
const btnDownloadImage = document.getElementById("btnDownloadImage") as HTMLButtonElement;
const btnCopyRedactedText = document.getElementById("btnCopyRedactedText") as HTMLButtonElement;
const btnAiCleanRedactText = document.getElementById("btnAiCleanRedactText") as HTMLButtonElement | null;
const redactedModeBadge = document.getElementById("redactedModeBadge") as HTMLSpanElement | null;
const txtRedactedPreview = document.getElementById("txtRedactedPreview") as HTMLTextAreaElement;
const btnCopyPrompt = document.getElementById("btnCopyPrompt") as HTMLButtonElement | null;
const aiPromptSelect = document.getElementById("aiPromptSelect") as HTMLSelectElement | null;

const toggleFaces = document.getElementById("toggleFaces") as HTMLInputElement;
const togglePersons = document.getElementById("togglePersons") as HTMLInputElement;
const toggleCompanies = document.getElementById("toggleCompanies") as HTMLInputElement;
const togglePii = document.getElementById("togglePii") as HTMLInputElement;
const toggleFollowSlope = document.getElementById("toggleFollowSlope") as HTMLInputElement;
const sliderPadding = document.getElementById("sliderPadding") as HTMLInputElement;
const paddingValDisplay = document.getElementById("paddingValDisplay") as HTMLSpanElement;
const sliderAiConfidence = document.getElementById("sliderAiConfidence") as HTMLInputElement;
const aiConfidenceValDisplay = document.getElementById("aiConfidenceValDisplay") as HTMLSpanElement;
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

// Mobile Quick Bar & Sheet Drawer Elements
const btnMobileCopy = document.getElementById("btnMobileCopy") as HTMLButtonElement | null;
const btnMobileDownload = document.getElementById("btnMobileDownload") as HTMLButtonElement | null;
const btnMobileBadge = document.getElementById("btnMobileBadge") as HTMLButtonElement | null;
const mobileBadgeCount = document.getElementById("mobileBadgeCount") as HTMLSpanElement | null;
const btnMobileOpenSheet = document.getElementById("btnMobileOpenSheet") as HTMLButtonElement | null;
const btnHeaderMenu = document.getElementById("btnHeaderMenu") as HTMLButtonElement | null;
const sidebarPanel = document.getElementById("sidebarPanel") as HTMLElement | null;
const sheetBackdrop = document.getElementById("sheetBackdrop") as HTMLDivElement | null;
const btnCloseMobileSheet = document.getElementById("btnCloseMobileSheet") as HTMLButtonElement | null;
const sheetDragHandle = document.getElementById("sheetDragHandle") as HTMLDivElement | null;
const sheetHeader = document.getElementById("sheetHeader") as HTMLDivElement | null;
const btnOpenStorageModalFromSheet = document.getElementById("btnOpenStorageModalFromSheet") as HTMLButtonElement | null;

// Drawing & Line Snap State Variables
let isDrawing = false;
let drawStartX = 0;
let drawStartY = 0;
let currentDrawRect: { x: number; y: number; width: number; height: number } | null = null;
let currentSnapResult: SnapResult | null = null;
let activeSnappedLine: import("./engine/ocr").OcrLine | null = null;
let toastTimeout: number | null = null;

// Zoom & Pan Interaction State Variables
let isPanning = false;
let isSpaceDown = false;
let panStartX = 0;
let panStartY = 0;
let panStartOffsetX = 0;
let panStartOffsetY = 0;

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && (e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
    isSpaceDown = true;
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    isSpaceDown = false;
  }
});

// Pinch Zoom State Variables (Mobile Multi-touch)
let isPinching = false;
let pinchStartDistance = 0;
let pinchStartZoom = 1.0;
let pinchCenterScreen = { x: 0, y: 0 };
let pinchStartPan = { x: 0, y: 0 };

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
  ctx.lineWidth = Math.max(3, Math.round(Math.min(ctx.canvas.width, ctx.canvas.height) * 0.005));
  ctx.setLineDash([8, 4]);
  ctx.stroke();

  // 内部半透明
  ctx.fillStyle = "rgba(56, 189, 248, 0.15)";
  ctx.fill();

  const baseDim = Math.min(ctx.canvas.width, ctx.canvas.height);
  const pinRadius = Math.max(16, Math.round(baseDim * 0.026));
  const pinFontSize = Math.max(11, Math.round(pinRadius * 0.65));

  // 4隅のピン
  const drawPin = (pt: Point2D, label: string, isCurrentActive: boolean) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pinRadius, 0, Math.PI * 2);
    ctx.fillStyle = isCurrentActive ? "#0284c7" : "#0ea5e9";
    ctx.fill();
    ctx.lineWidth = Math.max(2, Math.round(pinRadius * 0.2));
    ctx.strokeStyle = isCurrentActive ? "#38bdf8" : "#ffffff";
    ctx.setLineDash([]);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${pinFontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, pt.x, pt.y);
  };

  drawPin(corners.topLeft, "左上", activeCornerKey === "topLeft");
  drawPin(corners.topRight, "右上", activeCornerKey === "topRight");
  drawPin(corners.bottomRight, "右下", activeCornerKey === "bottomRight");
  drawPin(corners.bottomLeft, "左下", activeCornerKey === "bottomLeft");

  // ★ 虫眼鏡（Loupe / 拡大プレビュー）: ドラッグ中に指やカーソルで隠れずピクセル単位で微調整 ★
  if (activeCornerKey && appState.getState().sourceImage) {
    const sourceImg = appState.getState().sourceImage!;
    const pt = corners[activeCornerKey];

    const loupeRadius = Math.max(70, Math.round(baseDim * 0.14)); // 画面サイズに応じた虫眼鏡半径
    const zoom = 2.6; // 拡大率

    // 指やカーソルに隠れないよう、ピンの上部（画面上端付近なら下部）に配置
    let loupeX = pt.x;
    let loupeY = pt.y - loupeRadius - Math.round(pinRadius * 1.5 + 25);
    if (loupeY - loupeRadius < 15) {
      loupeY = pt.y + loupeRadius + Math.round(pinRadius * 1.5 + 25);
    }
    if (loupeX - loupeRadius < 15) {
      loupeX = loupeRadius + 15;
    } else if (loupeX + loupeRadius > ctx.canvas.width - 15) {
      loupeX = ctx.canvas.width - loupeRadius - 15;
    }

    ctx.save();

    // 虫眼鏡の影
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;

    // 虫眼鏡の外枠円（シャドウ用）
    ctx.beginPath();
    ctx.arc(loupeX, loupeY, loupeRadius, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.shadowColor = "transparent";

    // 内部に拡大画像をクリップ描画
    ctx.save();
    ctx.beginPath();
    ctx.arc(loupeX, loupeY, loupeRadius - 4, 0, Math.PI * 2);
    ctx.clip();

    // 背景色（画像外の場合のフォールバック）
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(loupeX - loupeRadius, loupeY - loupeRadius, loupeRadius * 2, loupeRadius * 2);

    // 元画像の (pt.x, pt.y) を中心に zoom 倍で描画
    const sw = (loupeRadius * 2) / zoom;
    const sh = (loupeRadius * 2) / zoom;
    const sx = pt.x - sw / 2;
    const sy = pt.y - sh / 2;
    ctx.drawImage(
      sourceImg,
      sx,
      sy,
      sw,
      sh,
      loupeX - loupeRadius,
      loupeY - loupeRadius,
      loupeRadius * 2,
      loupeRadius * 2
    );

    // 中心十字クロスヘア（精密位置合わせ用）
    ctx.strokeStyle = "#ef4444"; // 鮮やかな赤
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    // 横線
    ctx.beginPath();
    ctx.moveTo(loupeX - 22, loupeY);
    ctx.lineTo(loupeX + 22, loupeY);
    ctx.stroke();
    // 縦線
    ctx.beginPath();
    ctx.moveTo(loupeX, loupeY - 22);
    ctx.lineTo(loupeX, loupeY + 22);
    ctx.stroke();

    // 中心ターゲットサークル
    ctx.beginPath();
    ctx.arc(loupeX, loupeY, 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    // 虫眼鏡のメタリック外枠リング
    ctx.beginPath();
    ctx.arc(loupeX, loupeY, loupeRadius, 0, Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#38bdf8";
    ctx.stroke();

    ctx.restore();
  }

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
      // 撮影・読み込み直後に自動4隅検出 → 虫眼鏡付き手動調整画面を起動
      await ingestCapturedImage(img, { skipPerspective: false });
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
let lastOcrResult: import("./engine/ocr").OcrResult | null = null;
let aiCleanedText: string | null = null;

function updateRedactedBadge(mode: "rule" | "ai"): void {
  if (!redactedModeBadge) return;
  if (!isLlmOptInEnabled()) {
    redactedModeBadge.textContent = "外部送信安全";
    redactedModeBadge.style.background = "rgba(16, 185, 129, 0.15)";
    redactedModeBadge.style.color = "#34d399";
    redactedModeBadge.style.borderColor = "rgba(16, 185, 129, 0.3)";
    return;
  }
  if (mode === "ai") {
    redactedModeBadge.textContent = "🤖 AI文脈清書済み";
    redactedModeBadge.style.background = "linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(139, 92, 246, 0.25))";
    redactedModeBadge.style.color = "#c084fc";
    redactedModeBadge.style.borderColor = "rgba(168, 85, 247, 0.4)";
  } else {
    redactedModeBadge.textContent = "⚡ 高速ルール伏字";
    redactedModeBadge.style.background = "rgba(59, 130, 246, 0.15)";
    redactedModeBadge.style.color = "#60a5fa";
    redactedModeBadge.style.borderColor = "rgba(59, 130, 246, 0.3)";
  }
}

/**
 * LLMオプトイン設定（ON/OFF）に応じて伏字テキストエリアのボタン・説明文・バッジを動的制御
 */
function updateRedactedUiByLlmOptIn(): void {
  const isOptedIn = isLlmOptInEnabled();
  const redactedDescText = document.getElementById("redactedDescText") as HTMLParagraphElement | null;

  if (isOptedIn) {
    // LLM有効時：AI清書ボタンを表示し、横並び配置
    if (btnAiCleanRedactText) {
      btnAiCleanRedactText.style.display = "inline-flex";
    }
    if (btnCopyRedactedText) {
      btnCopyRedactedText.classList.remove("btn-block");
      btnCopyRedactedText.style.flex = "1";
      btnCopyRedactedText.textContent = "📋 テキストをコピー";
    }
    if (redactedDescText) {
      redactedDescText.innerHTML =
        '個人情報を <code style="color: #38bdf8;">[人名]</code> <code style="color: #38bdf8;">[住所]</code> 等に伏字化。AIボタンで誤字や文字化けを文脈修復して綺麗に清書できます。';
    }
    updateRedactedBadge(aiCleanedText ? "ai" : "rule");
  } else {
    // LLM無効時（通常）：AI清書ボタンを非表示にし、コピーボタンを全幅でシンプル表示
    if (btnAiCleanRedactText) {
      btnAiCleanRedactText.style.display = "none";
    }
    if (btnCopyRedactedText) {
      btnCopyRedactedText.classList.add("btn-block");
      btnCopyRedactedText.style.flex = "none";
      btnCopyRedactedText.textContent = "📋 伏字テキストをコピー";
    }
    if (redactedDescText) {
      redactedDescText.innerHTML =
        '個人情報を <code style="color: #38bdf8;">[人名]</code> <code style="color: #38bdf8;">[住所]</code> などに置換。画像より高速・安全にAIへ質問できます。';
    }
    if (redactedModeBadge) {
      redactedModeBadge.textContent = "外部送信安全";
      redactedModeBadge.style.background = "rgba(16, 185, 129, 0.15)";
      redactedModeBadge.style.color = "#34d399";
      redactedModeBadge.style.borderColor = "rgba(16, 185, 129, 0.3)";
    }
  }
}


/**
 * 伏字テキストプレビューの表示更新
 * @param resetAi 手動編集や再解析等でAI清書テキストを破棄してルール伏字に戻す場合は true
 */
function refreshRedactedTextPreview(resetAi = false): void {
  const state = appState.getState();

  if (resetAi) {
    aiCleanedText = null;
  }

  if (!state.sourceImage || !lastOcrResult || lastOcrResult.lines.length === 0) {
    aiCleanedText = null;
    updateRedactedBadge("rule");
    if (txtRedactedPreview) {
      txtRedactedPreview.value = state.sourceImage
        ? "テキスト抽出中、または文字が検出されませんでした。"
        : "解析が完了すると、伏字化されたテキストがここに表示されます。";
    }
    if (btnCopyRedactedText) btnCopyRedactedText.disabled = true;
    if (btnAiCleanRedactText) btnAiCleanRedactText.disabled = true;
    return;
  }

  if (btnAiCleanRedactText) btnAiCleanRedactText.disabled = false;

  // AI清書テキストが既に存在する場合はそれを優先表示
  if (aiCleanedText) {
    updateRedactedBadge("ai");
    if (txtRedactedPreview) txtRedactedPreview.value = aiCleanedText;
    if (btnCopyRedactedText) btnCopyRedactedText.disabled = false;
    return;
  }

  // ルールベース伏字の更新
  updateRedactedBadge("rule");
  const res = generateRedactedText(lastOcrResult, state.boxes);
  if (txtRedactedPreview) {
    txtRedactedPreview.value = res.redactedText || "(検出された文字はありませんでした)";
  }
  if (btnCopyRedactedText) {
    btnCopyRedactedText.disabled = !res.redactedText;
  }
}


async function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to convert canvas to blob"));
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
}

/**
 * 台形補正モード起動（AI不使用で四隅を自動検出して初期配置、虫眼鏡付き手動調整対応）
 */
function openPerspectiveMode(initialCorners?: QuadCorners): void {
  const state = appState.getState();
  if (!state.sourceImage) {
    showToast("画像を読み込んでから実行してください");
    return;
  }

  isPerspectiveMode = true;
  perspectiveBar.style.display = "flex";
  // 指定された四隅、または自動検出した四隅をセット
  perspectiveCorners = initialCorners || detectDocumentCornersAuto(state.sourceImage);
  activeCornerKey = null;
  updateCanvasRender();
}

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
      skipPerspective: !!preloadedOcr,
      preloadedOcr,
      preloadedAvatars
    });
  };
  img.src = dataUrl;
}

let lastCorrection: CaptureCorrectionResult | null = null;

/**
 * 画像取り込み時の処理パイプライン
 * 一般的なスキャンアプリの標準UX:
 * 撮影/画像選択 → 自動4隅判定 → 手動4隅調整(虫眼鏡付き)画面を表示 → 補正実行 → 黒塗り解析
 */
async function ingestCapturedImage(
  img: HTMLImageElement,
  opts: {
    skipPerspective?: boolean;
    preloadedOcr?: import("./engine/ocr").OcrResult;
    preloadedAvatars?: { x: number; y: number; width: number; height: number }[];
  } = {}
): Promise<void> {
  currentPreloadedOcr = opts.preloadedOcr;
  currentPreloadedAvatars = opts.preloadedAvatars;
  lastCorrection = null;

  // まず元画像を画面にセットしてキャンバスを表示
  appState.setSourceImage(img);

  // 正面チャットサンプル等で四隅補正をスキップする場合
  if (opts.skipPerspective) {
    await startAnalysis();
    return;
  }

  // ★ 1. AI不使用で画像のエッジから自動で4隅を検出 ★
  const autoCorners = detectDocumentCornersAuto(img);

  // ★ 2. 撮影直後に自動で手動4隅調整モード（拡大鏡付き）を起動！ ★
  openPerspectiveMode(autoCorners);
  showToast("📐 画面の4隅にピンを合わせ、「✨ 補正して黒塗り実行」を押してください", 4500);
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
    const alreadyFrontal = !!(lastCorrection && (lastCorrection.appliedPerspective || Math.abs(lastCorrection.deskewAngle) >= 0.5));
    console.log("[startAnalysis] Frontal check:", JSON.stringify({
      alreadyFrontal,
      lastCorrection: lastCorrection ? {
        appliedPerspective: lastCorrection.appliedPerspective,
        deskewAngle: lastCorrection.deskewAngle,
        enhanced: lastCorrection.enhanced,
        skipped: lastCorrection.skipped
      } : null,
      toggleFollowSlope: toggleFollowSlope.checked
    }));
    if (toggleFollowSlope.checked && !alreadyFrontal) {
      const detected = detectImageDeskewAngle(state.sourceImage);
      console.log("[startAnalysis] Detected deskew angle for bounding boxes:", detected);
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

    lastOcrResult = result.ocrResult;
    appState.setBoxes(result.boxes);
    refreshRedactedTextPreview(true);

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
 * キャンバスのズーム・パントランスフォームおよび操作バー表示の適用
 */
function applyCanvasTransform(): void {
  const state = appState.getState();
  if (state.sourceImage) {
    renderCanvas.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    zoomLevelDisplay.textContent = `${Math.round(state.zoom * 100)}%`;
    btnToggleLineSnap.classList.toggle("active", state.lineSnapEnabled);
    zoomControls.style.display = "flex";
  } else {
    renderCanvas.style.transform = "";
    zoomControls.style.display = "none";
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
    applyCanvasTransform();
    return;
  }

  emptyDropZone.style.display = "none";
  renderCanvas.style.display = "block";
  applyCanvasTransform();

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
    { ...state.rendererOptions, selectedBoxId: state.selectedBoxId },
    false
  );

  // 描画モード中の行ガイド描画（拡大率に応じて見やすさを自動調整）
  if (state.mode === "draw" && lastOcrResult && lastOcrResult.lines.length > 0) {
    renderLineGuides(
      ctx,
      lastOcrResult.lines,
      activeSnappedLine,
      state.zoom,
      currentDetectedDeskewAngle
    );
  }

  // 手動ドラッグ中の矩形プレビュー描画
  if (isDrawing && currentDrawRect) {
    ctx.save();
    if (currentSnapResult && currentSnapResult.rotation && Math.abs(currentSnapResult.rotation) > 0.1) {
      const cx = currentDrawRect.x + currentDrawRect.width / 2;
      const cy = currentDrawRect.y + currentDrawRect.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((currentSnapResult.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }
    const isSnapped = currentSnapResult?.isSnapped;
    ctx.strokeStyle = isSnapped ? "#10b981" : "#38bdf8";
    ctx.lineWidth = Math.max(1.5, 2.5 / Math.max(0.5, state.zoom));
    ctx.setLineDash(isSnapped ? [4, 2] : [6, 4]);
    ctx.strokeRect(
      currentDrawRect.x,
      currentDrawRect.y,
      currentDrawRect.width,
      currentDrawRect.height
    );
    ctx.fillStyle = isSnapped ? "rgba(16, 185, 129, 0.35)" : "rgba(56, 189, 248, 0.25)";
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
 * 黒塗り編集ポップオーバーの表示と位置合わせ
 */
function showBoxEditorPopover(box: RedactBox): void {
  if (!boxEditorPopover || !renderCanvas || !canvasViewport) return;
  const cRect = renderCanvas.getBoundingClientRect();
  const vRect = canvasViewport.getBoundingClientRect();

  const scaleX = cRect.width / (renderCanvas.width || 1);
  const scaleY = cRect.height / (renderCanvas.height || 1);

  // Viewport内の相対座標を計算
  const boxLeft = cRect.left - vRect.left + box.rect.x * scaleX;
  const boxTop = cRect.top - vRect.top + box.rect.y * scaleY;
  const boxW = box.rect.width * scaleX;
  const boxH = box.rect.height * scaleY;

  const popoverW = 290;
  const popoverH = 210;

  // デフォルトはボックス上部に配置、上部に余白がなければ下部に配置
  let left = boxLeft + boxW / 2 - popoverW / 2;
  let top = boxTop - popoverH - 12;

  if (top < 12) {
    top = boxTop + boxH + 12;
  }

  // 画面枠内に収まるよう制限
  left = Math.max(12, Math.min(vRect.width - popoverW - 12, left));
  top = Math.max(12, Math.min(vRect.height - popoverH - 12, top));

  boxEditorPopover.style.left = `${Math.round(left)}px`;
  boxEditorPopover.style.top = `${Math.round(top)}px`;
  boxEditorPopover.style.display = "block";

  // 入力欄とトグル表示の同期
  popoverCustomLabel.value = box.label || "";
  if (popoverToggleText) {
    popoverToggleText.textContent = box.enabled ? "保護を一時解除" : "保護を再適用";
  }

  // チップのアクティブ状態の同期
  const chips = boxEditorPopover.querySelectorAll<HTMLButtonElement>(".popover-chip");
  chips.forEach((chip) => {
    const chipLabel = chip.getAttribute("data-label");
    chip.classList.toggle("active", chipLabel === box.label);
  });
}

function hideBoxEditorPopover(): void {
  if (boxEditorPopover) {
    boxEditorPopover.style.display = "none";
  }
}

/**
 * UI表示（統計・リスト・ボタン状態）の同期
 */
function syncUiWithState(state: AppState): void {
  // プログレス表示
  if (state.isAnalyzing) {
    progressOverlay.style.display = "flex";
    if (state.progressText.includes("\n")) {
      const [mainMsg, subMsg] = state.progressText.split("\n");
      progressStatus.textContent = mainMsg;
      if (progressSubStatus) progressSubStatus.textContent = subMsg;
    } else {
      progressStatus.textContent = state.progressText;
      if (progressSubStatus) progressSubStatus.textContent = "";
    }
    progressBar.style.width = `${Math.round(state.progressPercent * 100)}%`;
  } else {
    progressOverlay.style.display = "none";
  }

  // ツールバーボタンのアクティブ状態
  toolSelectMode.classList.toggle("active", state.mode === "select");
  toolDrawMode.classList.toggle("active", state.mode === "draw");

  if (selectRedactStyle) {
    selectRedactStyle.value = state.rendererOptions.style;
  }

  if (!state.selectedBoxId) {
    hideBoxEditorPopover();
  }

  btnUndo.disabled = state.historyIndex <= 0;
  btnRedo.disabled = state.historyIndex >= state.history.length - 1;

  const hasImage = !!state.sourceImage;
  btnCopyImage.disabled = !hasImage;
  btnDownloadImage.disabled = !hasImage;
  if (btnMobileCopy) btnMobileCopy.disabled = !hasImage;
  if (btnMobileDownload) btnMobileDownload.disabled = !hasImage;
  btnCopyRedactedText.disabled = !hasImage || !lastOcrResult || lastOcrResult.lines.length === 0;
  if (btnAiCleanRedactText) btnAiCleanRedactText.disabled = !hasImage || !lastOcrResult || lastOcrResult.lines.length === 0;
  btnCompare.disabled = !hasImage;
  if (btnClearAllBoxes) btnClearAllBoxes.disabled = !hasImage || state.boxes.length === 0;
  if (btnSideClearAll) btnSideClearAll.disabled = !hasImage || state.boxes.length === 0;
  btnReset.disabled = !hasImage;
  btnReanalyze.disabled = !hasImage;
  if (btnToolbarAutoDetect) btnToolbarAutoDetect.disabled = !hasImage;

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
  if (mobileBadgeCount) mobileBadgeCount.textContent = `${enabledCount}件`;
  statFace.textContent = String(faceCount);
  statPerson.textContent = String(personCount);
  statCompany.textContent = String(companyCount);
  statPii.textContent = String(piiCount);

  // 一覧リストの更新
  if (!state.sourceImage) {
    detectedItemsList.innerHTML = `<div style="font-size: 0.78rem; color: var(--text-dim); text-align: center; padding: 1rem;">画像が読み込まれていません</div>`;
  } else if (state.boxes.length === 0) {
    detectedItemsList.innerHTML = `<div style="font-size: 0.78rem; color: var(--text-dim); text-align: center; padding: 1rem 0.5rem;">
      <p style="margin-bottom: 0.5rem;">黒塗りがありません</p>
      <button id="btnEmptyStateAutoDetect" class="btn btn-secondary btn-sm" style="font-size: 0.76rem;">✨ 自動検出を実行</button>
    </div>`;
    const btnEmpty = document.getElementById("btnEmptyStateAutoDetect");
    if (btnEmpty) {
      btnEmpty.addEventListener("click", () => startAnalysis());
    }
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

  // 伏字テキストプレビューの同期
  refreshRedactedTextPreview(true);

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
 * モバイル端末（スマートフォン・タブレット）判定
 */
function isMobileDevice(): boolean {
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (typeof window !== "undefined" && "ontouchstart" in window && window.innerWidth <= 820)
  );
}

/**
 * カメラ撮影を開始（モバイルならOS標準カメラ、PCならWebカメラモーダル）
 */
function triggerCameraCapture(): void {
  if (isMobileDevice()) {
    // スマホでは解像度低下やアスペクト比の不一致を避け、OS標準の最高解像度カメラを直接起動
    cameraInput.click();
  } else {
    void openLiveCameraModal();
  }
}

/**
 * ライブカメラモーダルを開く（PC向けWebカメラ）
 */
async function openLiveCameraModal(): Promise<void> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    cameraInput.click();
    return;
  }

  try {
    cameraModal.style.display = "flex";
    await startCameraStream(currentFacingMode);
  } catch (err) {
    console.warn("Camera access failed or denied, falling back to input:", err);
    closeLiveCameraModal();
    showToast("カメラを起動できませんでした。ファイル選択を使用します");
    cameraInput.click();
  }
}

async function startCameraStream(facingMode: "environment" | "user"): Promise<void> {
  stopCameraStream();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    activeCameraStream = stream;
    cameraVideo.srcObject = stream;
    await cameraVideo.play();
  } catch {
    const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    activeCameraStream = fallbackStream;
    cameraVideo.srcObject = fallbackStream;
    await cameraVideo.play();
  }
}

function stopCameraStream(): void {
  if (activeCameraStream) {
    activeCameraStream.getTracks().forEach((t) => t.stop());
    activeCameraStream = null;
  }
  if (cameraVideo) {
    cameraVideo.srcObject = null;
  }
}

function closeLiveCameraModal(): void {
  stopCameraStream();
  cameraModal.style.display = "none";
}

/**
 * ライブカメラから写真をキャプチャして解析へ流す
 */
async function capturePhotoFromStream(): Promise<void> {
  if (!cameraVideo || !activeCameraStream) return;
  const vw = cameraVideo.videoWidth || 1280;
  const vh = cameraVideo.videoHeight || 720;

  const capCanvas = document.createElement("canvas");
  capCanvas.width = vw;
  capCanvas.height = vh;
  const ctx = capCanvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(cameraVideo, 0, 0, vw, vh);

  closeLiveCameraModal();
  showToast("撮影完了！四隅を確認・微調整してください", 3500);

  const dataUrl = capCanvas.toDataURL("image/png");
  const img = new Image();
  img.onload = async () => {
    await ingestCapturedImage(img, { skipPerspective: false });
  };
  img.src = dataUrl;
}

/**
 * イベントリスナーの初期化
 */
function initEvents(): void {
  // 状態変更の監視
  appState.subscribe(syncUiWithState);

  // ファイル選択・カメラ
  btnTakePhoto.addEventListener("click", triggerCameraCapture);
  btnNewPhotoHeader.addEventListener("click", triggerCameraCapture);
  btnSelectFile.addEventListener("click", () => fileInput.click());

  // ライブカメラモーダル操作
  btnCloseCameraModal.addEventListener("click", () => closeLiveCameraModal());
  cameraBackdrop.addEventListener("click", () => closeLiveCameraModal());
  btnShutter.addEventListener("click", () => void capturePhotoFromStream());
  btnCameraFallbackFile.addEventListener("click", () => {
    closeLiveCameraModal();
    fileInput.click();
  });
  btnSwitchCamera.addEventListener("click", async () => {
    currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
    try {
      await startCameraStream(currentFacingMode);
    } catch (err) {
      console.warn("Switch camera failed:", err);
    }
  });

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

  // サンプル画像読み込み（チャット）
  const loadChatSampleAction = () => {
    if (sampleDropdownMenu) sampleDropdownMenu.style.display = "none";
    showToast("チャット画面のサンプルを読み込んでいます...");
    const sample = generateChatSampleImage();
    handleImageDataUrl(sample.dataUrl, sample.ocrData, sample.avatars);
  };
  if (btnLoadSample) btnLoadSample.addEventListener("click", loadChatSampleAction);
  if (menuSampleChat) menuSampleChat.addEventListener("click", loadChatSampleAction);


  // サンプル画像読み込み（プライベートダッシュボード）
  const loadDashboardSampleAction = () => {
    if (sampleDropdownMenu) sampleDropdownMenu.style.display = "none";
    showToast("マイアカウント・ダッシュボード（顔写真・個人情報）を読み込んでいます...");
    const sample = generateDashboardSampleImage();
    handleImageDataUrl(sample.dataUrl, sample.ocrData, sample.avatars);
  };
  if (btnLoadDashboardSample) btnLoadDashboardSample.addEventListener("click", loadDashboardSampleAction);
  if (menuSampleDashboard) menuSampleDashboard.addEventListener("click", loadDashboardSampleAction);

  // 斜め撮影サンプル読み込み
  const loadSkewedSampleAction = () => {
    if (sampleDropdownMenu) sampleDropdownMenu.style.display = "none";
    showToast("斜め撮影（スマホカメラ風）サンプルを生成中...");
    const sample = generateSkewedChatSampleImage();
    // メタデータなしで通常読み込み（OCRと輪郭自動検出がフル稼働）
    handleImageDataUrl(sample.dataUrl);
  };
  if (btnLoadSkewedSample) btnLoadSkewedSample.addEventListener("click", loadSkewedSampleAction);
  if (menuSampleSkewed) menuSampleSkewed.addEventListener("click", loadSkewedSampleAction);

  // ヘッダーのサンプルドロップダウン開閉トグル
  if (btnSampleHeader && sampleDropdownMenu) {
    btnSampleHeader.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = sampleDropdownMenu.style.display === "flex";
      sampleDropdownMenu.style.display = isOpen ? "none" : "flex";
      btnSampleHeader.setAttribute("aria-expanded", String(!isOpen));
    });

    // 外側クリックでメニューを閉じる
    document.addEventListener("click", (e) => {
      if (!sampleDropdownMenu.contains(e.target as Node) && e.target !== btnSampleHeader) {
        sampleDropdownMenu.style.display = "none";
        btnSampleHeader.setAttribute("aria-expanded", "false");
      }
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
  toolSelectMode.addEventListener("click", () => {
    appState.setMode("select");
  });
  toolDrawMode.addEventListener("click", () => {
    appState.setMode("draw");
    hideBoxEditorPopover();
    appState.setSelectedBoxId(null);
    updateCanvasRender();
  });

  // 墨消しスタイル切り替え (ドロップダウン)
  if (selectRedactStyle) {
    selectRedactStyle.addEventListener("change", () => {
      appState.setRendererOptions({ style: selectRedactStyle.value as any });
      updateCanvasRender();
    });
  }



  // ポップオーバーのチップ選択
  if (boxEditorPopover) {
    const chips = boxEditorPopover.querySelectorAll<HTMLButtonElement>(".popover-chip");
    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const label = chip.getAttribute("data-label");
        const state = appState.getState();
        if (!state.selectedBoxId || !label) return;

        appState.updateBox(state.selectedBoxId, { label, reason: `ユーザー指定 (${label})` });
        appState.setActiveDrawLabel(label);
        updateCanvasRender();
        refreshRedactedTextPreview(true);
        showToast(`🏷️ ラベルを「${label}」に設定しました`);

        chips.forEach((c) => c.classList.toggle("active", c === chip));
        if (popoverCustomLabel) popoverCustomLabel.value = label;
      });
    });

    // 自由記述カスタムラベル適用
    if (btnApplyPopoverCustom) {
      btnApplyPopoverCustom.addEventListener("click", () => {
        const val = popoverCustomLabel.value.trim();
        const state = appState.getState();
        if (!state.selectedBoxId || !val) return;

        appState.updateBox(state.selectedBoxId, { label: val, reason: `ユーザー指定 (${val})` });
        appState.setActiveDrawLabel(val);
        updateCanvasRender();
        refreshRedactedTextPreview(true);
        showToast(`🏷️ ラベルを「${val}」に設定しました`);

        chips.forEach((c) => c.classList.toggle("active", c.getAttribute("data-label") === val));
      });
    }

    if (popoverCustomLabel) {
      popoverCustomLabel.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          btnApplyPopoverCustom.click();
        }
      });
    }

    // 保護の一時解除/再適用
    if (btnPopoverToggle) {
      btnPopoverToggle.addEventListener("click", () => {
        const state = appState.getState();
        if (!state.selectedBoxId) return;
        appState.toggleBox(state.selectedBoxId);
        const updatedBox = state.boxes.find((b) => b.id === state.selectedBoxId);
        if (updatedBox && popoverToggleText) {
          popoverToggleText.textContent = updatedBox.enabled ? "保護を一時解除" : "保護を再適用";
        }
        updateCanvasRender();
        refreshRedactedTextPreview(true);
      });
    }

    // 黒塗りの完全削除
    if (btnPopoverDelete) {
      btnPopoverDelete.addEventListener("click", () => {
        const state = appState.getState();
        if (!state.selectedBoxId) return;
        appState.removeBox(state.selectedBoxId);
        hideBoxEditorPopover();
        updateCanvasRender();
        refreshRedactedTextPreview(true);
        showToast("🗑️ 黒塗りを削除しました");
      });
    }

    // 閉じるボタン
    if (btnPopoverClose) {
      btnPopoverClose.addEventListener("click", () => {
        hideBoxEditorPopover();
        appState.setSelectedBoxId(null);
        updateCanvasRender();
      });
    }
  }

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

  // Undo / Redo / Reset / ClearAll
  const clearAllAction = () => {
    const state = appState.getState();
    if (!state.sourceImage || state.boxes.length === 0) return;
    appState.clearAllBoxes();
    refreshRedactedTextPreview(true);
    showToast("🗑️ すべての黒塗りを解除しました（「✨ 自動検出」で再検出できます）");
  };
  if (btnClearAllBoxes) btnClearAllBoxes.addEventListener("click", clearAllAction);
  if (btnSideClearAll) btnSideClearAll.addEventListener("click", clearAllAction);

  if (btnToolbarAutoDetect) {
    btnToolbarAutoDetect.addEventListener("click", () => {
      const state = appState.getState();
      if (!state.sourceImage) {
        showToast("先に写真を撮影または選択してください");
        return;
      }
      startAnalysis();
    });
  }

  btnUndo.addEventListener("click", () => {
    appState.undo();
    refreshRedactedTextPreview(true);
  });
  btnRedo.addEventListener("click", () => {
    appState.redo();
    refreshRedactedTextPreview(true);
  });
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

  btnPerspectiveMode.addEventListener("click", () => openPerspectiveMode());
  if (btnToolbarPerspective) {
    btnToolbarPerspective.addEventListener("click", () => openPerspectiveMode());
  }

  // 四隅ピンを画像全体枠（マージン1.5%）に広げて本文削れを防止
  btnResetCornersFull.addEventListener("click", () => {
    const state = appState.getState();
    if (!state.sourceImage) return;

    perspectiveCorners = defaultQuadCorners(state.sourceImage.width, state.sourceImage.height);
    updateCanvasRender();
    showToast("四隅ピンを画像全体に広げました（本文削れを防止）");
  });

  // 四隅の自動再検出
  btnAutoDetectCorners.addEventListener("click", () => {
    const state = appState.getState();
    if (!state.sourceImage) return;

    perspectiveCorners = detectDocumentCornersAuto(state.sourceImage);
    updateCanvasRender();
    showToast("四隅を自動検出しました！必要に応じて微調整してください");
  });

  // 台形補正スキップ (補正を行わずにそのまま黒塗り解析を実行)
  btnCancelPerspective.addEventListener("click", async () => {
    isPerspectiveMode = false;
    perspectiveBar.style.display = "none";
    perspectiveCorners = null;
    activeCornerKey = null;
    updateCanvasRender();

    showToast("補正をスキップし、そのまま黒塗り解析を実行します...");
    await startAnalysis();
  });

  // 台形補正実行（4隅手動調整結果に基づいて台形正対化・各種補正を実施し、黒塗り解析を実行）
  btnApplyPerspective.addEventListener("click", async () => {
    const state = appState.getState();
    if (!state.sourceImage || !perspectiveCorners) return;

    appState.setAnalyzing(true, "台形補正・正対化を実行中...", 0.05);

    try {
      // 1. 調整された4隅ピンによる台形透視変換
      const warpedCanvas = applyPerspectiveTransform(state.sourceImage, perspectiveCorners);
      let correctedImg = await canvasToImage(warpedCanvas);

      // 2. 念のため微細な行傾きを自動検出して水平補正
      const angle = detectImageDeskewAngle(correctedImg);
      if (Math.abs(angle) >= 0.5) {
        correctedImg = await rotateAndDeskewImage(correctedImg, -angle);
      }

      // 3. 台形補正モード終了（原画の美しいクリアな画質を100%維持）
      isPerspectiveMode = false;
      perspectiveBar.style.display = "none";
      perspectiveCorners = null;
      activeCornerKey = null;

      // 5. 正対化された画像をセットし、黒塗り解析（OCR＋個人情報検出）を実行！
      currentPreloadedOcr = undefined;
      currentPreloadedAvatars = undefined;
      appState.setSourceImage(correctedImg);
      await startAnalysis();
      showToast("✨ 台形正対化と黒塗りが完了しました！");
    } catch (err) {
      console.error("Perspective correction failed:", err);
      showToast("補正処理に失敗しました。元画像で黒塗り解析を実行します");
      isPerspectiveMode = false;
      perspectiveBar.style.display = "none";
      await startAnalysis();
    }
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
  sliderPadding.addEventListener("change", () => {
    if (appState.getState().sourceImage) {
      startAnalysis();
    }
  });

  // 端末内AI 判定感度スライダー
  if (sliderAiConfidence && aiConfidenceValDisplay) {
    sliderAiConfidence.addEventListener("input", () => {
      const sensitivity = parseInt(sliderAiConfidence.value, 10);
      let label = `${sensitivity}%`;
      if (sensitivity >= 65) {
        label = `高感度 (${sensitivity}%) - 漏れ防止`;
      } else if (sensitivity <= 35) {
        label = `低感度 (${sensitivity}%) - 確実重視`;
      } else {
        label = `標準 (${sensitivity}%)`;
      }
      aiConfidenceValDisplay.textContent = label;

      // 感度（高いほど漏れを防ぎしきい値を下げる、低いほど誤検知を防ぎしきい値を上げて厳格化）
      // 20% -> threshold 0.80 (低感度・確実重視)
      // 50% -> threshold 0.55 (標準)
      // 80% -> threshold 0.35 (高感度・漏れ防止)
      const threshold = 1.0 - (sensitivity / 100 * 0.75);
      const clamped = Math.max(0.25, Math.min(0.85, threshold));
      appState.setFilterOptions({ aiConfidenceThreshold: clamped });
    });

    sliderAiConfidence.addEventListener("change", () => {
      if (appState.getState().sourceImage) {
        startAnalysis();
      }
    });
  }

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

  // 伏字テキスト＋指示文のコピー
  btnCopyRedactedText.addEventListener("click", async () => {
    const state = appState.getState();
    if (!state.sourceImage || !lastOcrResult) {
      showToast("テキスト解析データがありません");
      return;
    }

    // AI清書テキストがあればそれを優先、なければルールベース生成
    let targetText = aiCleanedText;
    if (!targetText) {
      const res = generateRedactedText(lastOcrResult, state.boxes);
      targetText = res.redactedText;
    }

    if (!targetText || targetText.trim().length === 0) {
      showToast("コピー可能なテキストが見つかりませんでした");
      return;
    }

    const promptType = aiPromptSelect?.value || "summary";
    let fullText = targetText;
    if (promptType !== "none") {
      fullText = buildAiPromptWithRedactedText(targetText, promptType);
    }

    const isAiMode = !!aiCleanedText;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(fullText);
      } else {
        throw new Error("clipboard API unsupported");
      }
      if (promptType !== "none") {
        showToast(isAiMode ? "🤖 AI清書伏字テキスト＋AI指示文をコピーしました" : "伏字テキスト＋AI指示文をコピーしました", 3500);
      } else {
        showToast(isAiMode ? "🤖 AI清書伏字テキストをコピーしました" : "伏字テキストをコピーしました", 3500);
      }
    } catch {
      // フォールバック
      if (txtRedactedPreview) {
        txtRedactedPreview.value = fullText;
        txtRedactedPreview.focus();
        txtRedactedPreview.select();
        document.execCommand("copy");
        showToast(isAiMode ? "🤖 AI清書伏字テキストをコピーしました" : "伏字テキストをコピーしました", 3500);
      } else {
        showToast("クリップボードへのコピーに失敗しました");
      }
    }
  });

  // 🤖 AIで文章清書・高精度伏字化ボタン
  if (btnAiCleanRedactText) {
    btnAiCleanRedactText.addEventListener("click", async () => {
      const state = appState.getState();
      if (!state.sourceImage || !lastOcrResult || lastOcrResult.lines.length === 0) {
        showToast("清書対象のテキストデータがありません");
        return;
      }

      // 現在のルールベース伏字テキスト、またはOCR生テキストを取得
      const res = generateRedactedText(lastOcrResult, state.boxes);
      const textToClean = res.redactedText || lastOcrResult.lines.map((l) => l.text).join("\n");
      if (!textToClean || textToClean.trim().length === 0) {
        showToast("清書対象のテキストが空です");
        return;
      }

      // LLMオプトイン確認
      if (!isLlmOptInEnabled()) {
        const agreed = confirm(
          "【🤖 AI文章清書機能】\n\n" +
          "文字化けや誤字を文脈から補正し、自然で綺麗な日本語で個人情報を伏字化します。\n\n" +
          "※ ブラウザ内の極小AIモデル（Qwen2.5-0.5B、約350MB）を端末にダウンロードして実行します。\n" +
          "※ 画像やテキストが外部サーバーへ送信されることは一切ありません（完全ローカル実行）。\n\n" +
          "ダウンロードして実行しますか？"
        );
        if (!agreed) return;
        setLlmOptInEnabled(true);
        const toggleLlmOptInEl = document.getElementById("toggleLlmOptIn") as HTMLInputElement | null;
        if (toggleLlmOptInEl) {
          toggleLlmOptInEl.checked = true;
        }
      }



      const originalBtnText = btnAiCleanRedactText.innerHTML;
      btnAiCleanRedactText.disabled = true;
      btnAiCleanRedactText.innerHTML = `清書中...`;

      showToast("🤖 文脈AIが文章を清書・高精度伏字化しています...", 5000);

      try {
        const cleaned = await cleanAndRedactTextWithLlm(textToClean, (status) => {
          showToast(`🤖 ${status}`, 3000);
        });

        if (cleaned && cleaned.trim().length > 0) {
          aiCleanedText = cleaned;
          if (txtRedactedPreview) {
            txtRedactedPreview.value = cleaned;
          }
          updateRedactedBadge("ai");
          if (btnCopyRedactedText) btnCopyRedactedText.disabled = false;
          // プレビューを開いて見せる
          const details = document.getElementById("detailsRedactedText") as HTMLDetailsElement | null;
          if (details) details.open = true;
          showToast("✨ AIによる文章清書・高精度伏字化が完了しました！", 4000);
        } else {
          showToast("AI清書結果が空でした。通常の伏字テキストを表示します");
        }
      } catch (err) {
        console.error("[AiClean] Error during cleanAndRedactTextWithLlm:", err);
        showToast("⚠️ AI文章清書中にエラーが発生しました。通常伏字テキストをご利用ください", 4000);
      } finally {
        btnAiCleanRedactText.disabled = false;
        btnAiCleanRedactText.innerHTML = originalBtnText;
      }
    });
  }


  if (aiPromptSelect) {
    const savedPrompt = localStorage.getItem("kuronuri_prompt_template");
    if (savedPrompt) {
      aiPromptSelect.value = savedPrompt;
    }
    aiPromptSelect.addEventListener("change", () => {
      localStorage.setItem("kuronuri_prompt_template", aiPromptSelect.value);
    });
  }

  btnCopyPrompt?.addEventListener("click", async () => {
    const promptType = (aiPromptSelect?.value || "summary") as "summary" | "reply" | "advice";
    const res = await copyAiPromptToClipboard(promptType);
    showToast(res.message, 3500);
  });

  // ==========================================
  // Zoom & Snap Controls Events
  // ==========================================

  btnToggleLineSnap.addEventListener("click", () => {
    appState.toggleLineSnap();
    applyCanvasTransform();
    const isEnabled = appState.getState().lineSnapEnabled;
    showToast(isEnabled ? "🧲 行スナップを有効にしました（行に合わせて自動吸着）" : "行スナップを無効にしました（自由矩形）");
  });

  btnZoomIn.addEventListener("click", () => {
    const state = appState.getState();
    if (!state.sourceImage) return;
    appState.setZoom(state.zoom * 1.25);
    applyCanvasTransform();
  });

  btnZoomOut.addEventListener("click", () => {
    const state = appState.getState();
    if (!state.sourceImage) return;
    appState.setZoom(state.zoom / 1.25);
    applyCanvasTransform();
  });

  btnZoomReset.addEventListener("click", () => {
    const state = appState.getState();
    if (!state.sourceImage) return;
    // 100% と 200%（または全体）をトグル
    if (Math.abs(state.zoom - 1.0) < 0.1) {
      appState.setZoom(2.0);
    } else {
      appState.setZoom(1.0);
    }
    applyCanvasTransform();
  });

  btnZoomFit.addEventListener("click", () => {
    const state = appState.getState();
    if (!state.sourceImage) return;
    appState.resetZoomPan();
    applyCanvasTransform();
    showToast("全体表示・位置をリセットしました");
  });

  // ==========================================
  // Canvas Mouse & Touch Interactions
  // ==========================================

  function findNearestCorner(corners: QuadCorners, clientX: number, clientY: number): keyof QuadCorners | null {
    const rect = renderCanvas.getBoundingClientRect();
    const scaleX = renderCanvas.width / (rect.width || 1);
    const scaleY = renderCanvas.height / (rect.height || 1);

    const hitRadius = 48; // 画面（CSSピクセル）で半径48pxの広い判定エリア

    const distToCorner = (pt: Point2D): number => {
      const screenX = rect.left + pt.x / scaleX;
      const screenY = rect.top + pt.y / scaleY;
      return Math.hypot(screenX - clientX, screenY - clientY);
    };

    const dTL = distToCorner(corners.topLeft);
    const dTR = distToCorner(corners.topRight);
    const dBR = distToCorner(corners.bottomRight);
    const dBL = distToCorner(corners.bottomLeft);

    const minDist = Math.min(dTL, dTR, dBR, dBL);
    if (minDist > hitRadius) return null;

    if (minDist === dTL) return "topLeft";
    if (minDist === dTR) return "topRight";
    if (minDist === dBR) return "bottomRight";
    return "bottomLeft";
  }

  // マウスホイールによるズーム（カーソル位置中心）
  canvasViewport.addEventListener("wheel", (e) => {
    const state = appState.getState();
    if (!state.sourceImage) return;
    e.preventDefault();

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const newZoom = Math.max(0.4, Math.min(5.0, state.zoom * zoomFactor));
    if (Math.abs(newZoom - state.zoom) < 0.001) return;

    const viewportRect = canvasViewport.getBoundingClientRect();
    const mouseX = e.clientX - (viewportRect.left + viewportRect.width / 2);
    const mouseY = e.clientY - (viewportRect.top + viewportRect.height / 2);
    const ratio = newZoom / state.zoom;
    const newPanX = mouseX - (mouseX - state.panX) * ratio;
    const newPanY = mouseY - (mouseY - state.panY) * ratio;

    appState.setZoomAndPan(newZoom, newPanX, newPanY);
    applyCanvasTransform();
  }, { passive: false });

  // マウス移動（ホバー検出・ピンドラッグ・パンドラッグ）
  renderCanvas.addEventListener("mousemove", (e) => {
    const state = appState.getState();
    if (!state.sourceImage) return;

    // 台形補正モード中のピン操作
    if (isPerspectiveMode && perspectiveCorners) {
      if (activeCornerKey) {
        const { x, y } = getCanvasCoordinates(e);
        perspectiveCorners[activeCornerKey] = { x, y };
        updateCanvasRender();
      } else {
        const hoveredCorner = findNearestCorner(perspectiveCorners, e.clientX, e.clientY);
        renderCanvas.style.cursor = hoveredCorner ? "grab" : "default";
      }
      return;
    }

    if (isDrawing || isPanning) return;

    const { x, y } = getCanvasCoordinates(e);
    const box = findBoxAtPosition(state.boxes, x, y);
    if (box) {
      renderCanvas.style.cursor = state.mode === "select" ? "pointer" : "crosshair";
      if (state.rendererOptions.activeHoverBoxId !== box.id) {
        appState.setRendererOptions({ activeHoverBoxId: box.id });
        updateCanvasRender();
      }
    } else {
      renderCanvas.style.cursor = state.mode === "select" ? "grab" : "crosshair";
      if (state.rendererOptions.activeHoverBoxId !== null) {
        appState.setRendererOptions({ activeHoverBoxId: null });
        updateCanvasRender();
      }
    }
  });

  // マウスダウン（クリック・描画開始・パン開始）
  renderCanvas.addEventListener("mousedown", (e) => {
    const state = appState.getState();
    if (!state.sourceImage) return;

    // 台形補正モード
    if (isPerspectiveMode && perspectiveCorners) {
      if (e.button === 0) {
        const corner = findNearestCorner(perspectiveCorners, e.clientX, e.clientY);
        if (corner) {
          activeCornerKey = corner;
          renderCanvas.style.cursor = "grabbing";
          updateCanvasRender(); // 虫眼鏡を表示
        }
      }
      return;
    }

    // 中クリック、またはスペースキー押下中の左クリックは常にパン移動
    if (e.button === 1 || (e.button === 0 && isSpaceDown)) {
      e.preventDefault();
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartOffsetX = state.panX;
      panStartOffsetY = state.panY;
      renderCanvas.classList.add("is-interacting");
      renderCanvas.style.cursor = "grabbing";
      return;
    }

    if (e.button !== 0) return;

    const { x, y } = getCanvasCoordinates(e);

    if (state.mode === "select") {
      const box = findBoxAtPosition(state.boxes, x, y);
      if (box) {
        appState.setSelectedBoxId(box.id);
        showBoxEditorPopover(box);
        updateCanvasRender();
      } else {
        appState.setSelectedBoxId(null);
        hideBoxEditorPopover();
        updateCanvasRender();
        // ボックス外をクリック＆ドラッグした場合はパン移動を開始
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panStartOffsetX = state.panX;
        panStartOffsetY = state.panY;
        renderCanvas.classList.add("is-interacting");
        renderCanvas.style.cursor = "grabbing";
      }
    } else if (state.mode === "draw") {
      isDrawing = true;
      drawStartX = x;
      drawStartY = y;
      currentSnapResult = null;
      activeSnappedLine = null;

      if (state.lineSnapEnabled && lastOcrResult && lastOcrResult.lines.length > 0) {
        const snap = calculateLineSnap(
          lastOcrResult.lines,
          { x, y },
          { x, y },
          { globalAngle: currentDetectedDeskewAngle }
        );
        currentSnapResult = snap;
        activeSnappedLine = snap.isSnapped ? snap.matchedLine : null;
        currentDrawRect = snap.rect;
      } else {
        currentDrawRect = { x, y, width: 0, height: 0 };
      }
      updateCanvasRender();
    }
  });

  // マウスドラッグ中（画面外に出てもの追従）
  window.addEventListener("mousemove", (e) => {
    if (isPerspectiveMode && perspectiveCorners && activeCornerKey) {
      const { x, y } = getCanvasCoordinates(e);
      perspectiveCorners[activeCornerKey] = { x, y };
      updateCanvasRender();
      return;
    }

    if (isPanning) {
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      appState.setPan(panStartOffsetX + dx, panStartOffsetY + dy);
      applyCanvasTransform();
      return;
    }

    if (!isDrawing) return;
    const { x, y } = getCanvasCoordinates(e);
    const state = appState.getState();

    if (state.lineSnapEnabled && lastOcrResult && lastOcrResult.lines.length > 0) {
      const snap = calculateLineSnap(
        lastOcrResult.lines,
        { x: drawStartX, y: drawStartY },
        { x, y },
        { globalAngle: currentDetectedDeskewAngle }
      );
      currentSnapResult = snap;
      activeSnappedLine = snap.isSnapped ? snap.matchedLine : null;
      currentDrawRect = snap.rect;
    } else {
      const minX = Math.min(drawStartX, x);
      const minY = Math.min(drawStartY, y);
      const width = Math.abs(x - drawStartX);
      const height = Math.abs(y - drawStartY);
      currentDrawRect = { x: minX, y: minY, width, height };
      currentSnapResult = null;
      activeSnappedLine = null;
    }

    updateCanvasRender();
  });

  // マウスアップ（ドラッグ完了）
  window.addEventListener("mouseup", () => {
    if (isPerspectiveMode) {
      if (activeCornerKey) {
        activeCornerKey = null;
        renderCanvas.style.cursor = "default";
        updateCanvasRender();
      }
      return;
    }

    if (isPanning) {
      isPanning = false;
      renderCanvas.classList.remove("is-interacting");
      renderCanvas.style.cursor = appState.getState().mode === "select" ? "default" : "crosshair";
    }

    if (!isDrawing) return;
    isDrawing = false;

    if (currentDrawRect && currentDrawRect.width >= 5 && currentDrawRect.height >= 5) {
      const rot = currentSnapResult?.rotation ?? (toggleFollowSlope.checked && currentDetectedDeskewAngle !== 0 ? currentDetectedDeskewAngle : undefined);
      appState.addManualBox(currentDrawRect, rot);
      const newlyAddedBox = appState.getState().boxes[appState.getState().boxes.length - 1];
      if (newlyAddedBox) {
        showBoxEditorPopover(newlyAddedBox);
      }
      showToast(currentSnapResult?.isSnapped ? "✨ 行に合わせて黒塗りを追加しました" : "黒塗りを追加しました");
    }

    currentDrawRect = null;
    currentSnapResult = null;
    activeSnappedLine = null;
    updateCanvasRender();
    refreshRedactedTextPreview(true);
  });

  // タッチ操作（スマホ対応：ピンチズーム・パン・行スナップ描画）
  renderCanvas.addEventListener("touchstart", (e) => {
    const state = appState.getState();
    if (!state.sourceImage) return;

    // 2本指ピンチ操作開始（モードに関わらず常にズーム＆パン）
    if (e.touches.length === 2) {
      e.preventDefault();
      isPinching = true;
      isDrawing = false;
      isPanning = false;
      currentDrawRect = null;
      activeSnappedLine = null;
      currentSnapResult = null;

      pinchStartDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartZoom = state.zoom;
      pinchStartPan = { x: state.panX, y: state.panY };
      pinchCenterScreen = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
      };
      renderCanvas.classList.add("is-interacting");
      updateCanvasRender();
      return;
    }

    // 1本指操作
    if (e.touches.length === 1) {
      const touch = e.touches[0];

      // 台形補正モード中のピン操作
      if (isPerspectiveMode && perspectiveCorners) {
        const corner = findNearestCorner(perspectiveCorners, touch.clientX, touch.clientY);
        if (corner) {
          e.preventDefault();
          activeCornerKey = corner;
          updateCanvasRender(); // 虫眼鏡を表示
        }
        return;
      }

      const { x, y } = getCanvasCoordinates(touch);

      if (state.mode === "select") {
        const box = findBoxAtPosition(state.boxes, x, y);
        if (box) {
          e.preventDefault();
          appState.setSelectedBoxId(box.id);
          showBoxEditorPopover(box);
          updateCanvasRender();
        } else {
          appState.setSelectedBoxId(null);
          hideBoxEditorPopover();
          updateCanvasRender();
          // 何もない場所をドラッグした場合はパン移動
          isPanning = true;
          panStartX = touch.clientX;
          panStartY = touch.clientY;
          panStartOffsetX = state.panX;
          panStartOffsetY = state.panY;
          renderCanvas.classList.add("is-interacting");
        }
      } else if (state.mode === "draw") {
        e.preventDefault();
        isDrawing = true;
        drawStartX = x;
        drawStartY = y;
        currentSnapResult = null;
        activeSnappedLine = null;

        if (state.lineSnapEnabled && lastOcrResult && lastOcrResult.lines.length > 0) {
          const snap = calculateLineSnap(
            lastOcrResult.lines,
            { x, y },
            { x, y },
            { globalAngle: currentDetectedDeskewAngle }
          );
          currentSnapResult = snap;
          activeSnappedLine = snap.isSnapped ? snap.matchedLine : null;
          currentDrawRect = snap.rect;
        } else {
          currentDrawRect = { x, y, width: 0, height: 0 };
        }
        updateCanvasRender();
      }
    }
  }, { passive: false });

  renderCanvas.addEventListener("touchmove", (e) => {
    // 2本指ピンチ操作中
    if (isPinching && e.touches.length === 2) {
      e.preventDefault();
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scale = currentDist / (pinchStartDistance || 1);
      const newZoom = Math.max(0.4, Math.min(5.0, pinchStartZoom * scale));

      const currentCenter = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
      };
      const panX = pinchStartPan.x + (currentCenter.x - pinchCenterScreen.x);
      const panY = pinchStartPan.y + (currentCenter.y - pinchCenterScreen.y);

      appState.setZoomAndPan(newZoom, panX, panY);
      applyCanvasTransform();
      return;
    }

    if (e.touches.length !== 1) return;
    const touch = e.touches[0];

    // 台形ピン移動
    if (isPerspectiveMode && perspectiveCorners && activeCornerKey) {
      e.preventDefault();
      const { x, y } = getCanvasCoordinates(touch);
      perspectiveCorners[activeCornerKey] = { x, y };
      updateCanvasRender();
      return;
    }

    // 1本指パン移動
    if (isPanning) {
      e.preventDefault();
      const dx = touch.clientX - panStartX;
      const dy = touch.clientY - panStartY;
      appState.setPan(panStartOffsetX + dx, panStartOffsetY + dy);
      applyCanvasTransform();
      return;
    }

    // 1本指描画（行スナップ）
    if (!isDrawing) return;
    e.preventDefault();

    const { x, y } = getCanvasCoordinates(touch);
    const state = appState.getState();

    if (state.lineSnapEnabled && lastOcrResult && lastOcrResult.lines.length > 0) {
      const snap = calculateLineSnap(
        lastOcrResult.lines,
        { x: drawStartX, y: drawStartY },
        { x, y },
        { globalAngle: currentDetectedDeskewAngle }
      );
      currentSnapResult = snap;
      activeSnappedLine = snap.isSnapped ? snap.matchedLine : null;
      currentDrawRect = snap.rect;
    } else {
      const minX = Math.min(drawStartX, x);
      const minY = Math.min(drawStartY, y);
      const width = Math.abs(x - drawStartX);
      const height = Math.abs(y - drawStartY);
      currentDrawRect = { x: minX, y: minY, width, height };
      currentSnapResult = null;
      activeSnappedLine = null;
    }

    updateCanvasRender();
  }, { passive: false });

  renderCanvas.addEventListener("touchend", () => {
    if (isPinching) {
      isPinching = false;
      renderCanvas.classList.remove("is-interacting");
    }

    if (isPerspectiveMode) {
      if (activeCornerKey) {
        activeCornerKey = null;
        updateCanvasRender();
      }
      return;
    }

    if (isPanning) {
      isPanning = false;
      renderCanvas.classList.remove("is-interacting");
    }

    if (!isDrawing) return;
    isDrawing = false;

    if (currentDrawRect && currentDrawRect.width >= 5 && currentDrawRect.height >= 5) {
      const rot = currentSnapResult?.rotation ?? (toggleFollowSlope.checked && currentDetectedDeskewAngle !== 0 ? currentDetectedDeskewAngle : undefined);
      appState.addManualBox(currentDrawRect, rot);
      const newlyAddedBox = appState.getState().boxes[appState.getState().boxes.length - 1];
      if (newlyAddedBox) {
        showBoxEditorPopover(newlyAddedBox);
      }
      showToast(currentSnapResult?.isSnapped ? "✨ 行に合わせて黒塗りを追加しました" : "黒塗りを追加しました");
    }

    currentDrawRect = null;
    currentSnapResult = null;
    activeSnappedLine = null;
    updateCanvasRender();
    refreshRedactedTextPreview(true);
  });

  // モバイル専用スライドアップメニューとクイック操作の初期化
  initMobileSheetAndActions();
}

/**
 * スマホ専用スライドアップメニュー（ボトムシート）およびクイック操作バーの初期化
 */
function initMobileSheetAndActions(): void {
  const openSheet = (targetCardId?: string) => {
    if (sidebarPanel) {
      sidebarPanel.classList.add("sheet-open");
      document.body.classList.add("sheet-is-open");
    }
    if (sheetBackdrop) {
      sheetBackdrop.classList.add("active");
    }
    if (targetCardId) {
      setTimeout(() => {
        const targetEl = document.getElementById(targetCardId);
        if (targetEl && sidebarPanel) {
          targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 150);
    }
  };

  const closeSheet = () => {
    if (sidebarPanel) {
      sidebarPanel.classList.remove("sheet-open");
      document.body.classList.remove("sheet-is-open");
    }
    if (sheetBackdrop) {
      sheetBackdrop.classList.remove("active");
    }
  };

  // モバイルクイックバー操作
  btnMobileCopy?.addEventListener("click", () => {
    btnCopyImage.click();
  });

  btnMobileDownload?.addEventListener("click", () => {
    btnDownloadImage.click();
  });

  btnMobileOpenSheet?.addEventListener("click", () => {
    openSheet();
  });

  btnHeaderMenu?.addEventListener("click", () => {
    openSheet();
  });

  btnMobileBadge?.addEventListener("click", () => {
    openSheet("cardDetectedList");
  });

  // シート閉じる操作
  btnCloseMobileSheet?.addEventListener("click", closeSheet);
  sheetBackdrop?.addEventListener("click", closeSheet);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidebarPanel?.classList.contains("sheet-open")) {
      closeSheet();
    }
  });

  // シート内クイックナビゲーション（ピル）
  const pills = document.querySelectorAll<HTMLButtonElement>(".sheet-pill");
  pills.forEach((pill) => {
    pill.addEventListener("click", (e) => {
      const targetId = (e.currentTarget as HTMLElement).getAttribute("data-target");
      if (targetId) {
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
          if (targetEl instanceof HTMLDetailsElement) {
            targetEl.open = true;
          }
          targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    });
  });

  // シート内からAI容量管理モーダルを開く
  btnOpenStorageModalFromSheet?.addEventListener("click", () => {
    closeSheet();
    const btnOpenStorage = document.getElementById("btnOpenStorageModal") as HTMLButtonElement | null;
    btnOpenStorage?.click();
  });

  // スワイプダウン（下方向ドラッグ）で閉じるジェスチャー
  let touchStartY = 0;
  let touchCurrentY = 0;
  let isTouchingHandle = false;

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartY = e.touches[0].clientY;
      touchCurrentY = touchStartY;
      isTouchingHandle = true;
    }
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!isTouchingHandle || e.touches.length !== 1) return;
    touchCurrentY = e.touches[0].clientY;
    const deltaY = touchCurrentY - touchStartY;
    if (deltaY > 0 && sidebarPanel) {
      sidebarPanel.style.transform = `translateY(${Math.min(deltaY, 220)}px)`;
      sidebarPanel.style.transition = "none";
    }
  };

  const onTouchEnd = () => {
    if (!isTouchingHandle) return;
    isTouchingHandle = false;
    const deltaY = touchCurrentY - touchStartY;
    if (sidebarPanel) {
      sidebarPanel.style.transition = "";
      sidebarPanel.style.transform = "";
    }
    if (deltaY > 70) {
      closeSheet();
    }
  };

  if (sheetDragHandle) {
    sheetDragHandle.addEventListener("touchstart", onTouchStart, { passive: true });
    sheetDragHandle.addEventListener("touchmove", onTouchMove, { passive: true });
    sheetDragHandle.addEventListener("touchend", onTouchEnd, { passive: true });
  }

  if (sheetHeader) {
    sheetHeader.addEventListener("touchstart", onTouchStart, { passive: true });
    sheetHeader.addEventListener("touchmove", onTouchMove, { passive: true });
    sheetHeader.addEventListener("touchend", onTouchEnd, { passive: true });
  }
}

function initPwaAndStorageManager(): void {
  // Service Worker 登録
  try {
    registerSW({
      immediate: true,
      onNeedRefresh() {
        showToast("新しいバージョンが利用可能です。再読み込みで更新されます。");
      },
      onOfflineReady() {
        console.log("[PWA] Ready to work offline!");
      }
    });
  } catch (e) {
    console.warn("[PWA] Service worker registration:", e);
  }

  // PWA インストールプロンプト
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let deferredPrompt: any = null;
  const btnPwaInstall = document.getElementById("btnPwaInstall") as HTMLButtonElement | null;
  const btnPwaInstallInModal = document.getElementById("btnPwaInstallInModal") as HTMLButtonElement | null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btnPwaInstall) btnPwaInstall.style.display = "inline-flex";
  });

  const triggerInstall = async () => {
    if (!deferredPrompt) {
      showToast("ブラウザのメニューから「ホーム画面に追加」してください");
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      showToast("アプリがホーム画面に追加されました！");
      if (btnPwaInstall) btnPwaInstall.style.display = "none";
    }
    deferredPrompt = null;
  };

  btnPwaInstall?.addEventListener("click", triggerInstall);
  btnPwaInstallInModal?.addEventListener("click", triggerInstall);

  // ストレージ管理モーダル
  const modal = document.getElementById("modalModelStorage") as HTMLDivElement | null;
  const btnOpen = document.getElementById("btnOpenStorageModal") as HTMLButtonElement | null;
  const btnClose = document.getElementById("btnCloseStorageModal") as HTMLButtonElement | null;
  const backdrop = document.getElementById("storageBackdrop") as HTMLDivElement | null;
  const btnRefresh = document.getElementById("btnRefreshStorageStats") as HTMLButtonElement | null;
  const btnClear = document.getElementById("btnClearModelCaches") as HTMLButtonElement | null;
  const toggleLlm = document.getElementById("toggleLlmOptIn") as HTMLInputElement | null;
  const toggleLlmTrack = document.getElementById("toggleLlmTrack") as HTMLSpanElement | null;
  const toggleLlmThumb = document.getElementById("toggleLlmThumb") as HTMLSpanElement | null;
  const llmProgressContainer = document.getElementById("llmProgressContainer") as HTMLDivElement | null;
  const llmProgressBar = document.getElementById("llmProgressBar") as HTMLDivElement | null;
  const llmProgressStatus = document.getElementById("llmProgressStatus") as HTMLSpanElement | null;
  const llmProgressPercent = document.getElementById("llmProgressPercent") as HTMLSpanElement | null;

  const storageTotalBytes = document.getElementById("storageTotalBytes") as HTMLSpanElement | null;
  const statusOcrCache = document.getElementById("statusOcrCache") as HTMLSpanElement | null;
  const statusNerCache = document.getElementById("statusNerCache") as HTMLSpanElement | null;
  const statusLlmCache = document.getElementById("statusLlmCache") as HTMLSpanElement | null;
  const llmCachedActions = document.getElementById("llmCachedActions") as HTMLDivElement | null;
  const btnDeleteLlmData = document.getElementById("btnDeleteLlmData") as HTMLButtonElement | null;

  const updateToggleUi = (checked: boolean) => {
    if (!toggleLlmTrack || !toggleLlmThumb) return;
    if (checked) {
      toggleLlmTrack.style.backgroundColor = "#0284c7";
      toggleLlmThumb.style.transform = "translateX(20px)";
    } else {
      toggleLlmTrack.style.backgroundColor = "#334155";
      toggleLlmThumb.style.transform = "translateX(0px)";
    }
  };

  const updateStorageStats = async () => {
    if (!storageTotalBytes) return;
    try {
      storageTotalBytes.textContent = "計算中...";
      const stats = await ModelCacheManager.getCacheStorageStats();
      const mb = (stats.totalBytes / (1024 * 1024)).toFixed(1);
      storageTotalBytes.textContent = `${mb} MB (計 ${stats.itemsCount} ファイル)`;

      if (statusOcrCache) {
        statusOcrCache.textContent = stats.models.ocr.isCached ? "保存済み" : "自動取得";
        statusOcrCache.style.color = stats.models.ocr.isCached ? "#10b981" : "var(--text-dim)";
      }
      if (statusNerCache) {
        statusNerCache.textContent = stats.models.ner.isCached ? "保存済み" : "初回解析時に保存";
        statusNerCache.style.color = stats.models.ner.isCached ? "#10b981" : "var(--text-dim)";
      }
      if (statusLlmCache) {
        if (stats.models.llm.isCached) {
          const llmMb = (stats.models.llm.sizeBytes / (1024 * 1024)).toFixed(0);
          statusLlmCache.textContent = `保存済み (${llmMb} MB)`;
          statusLlmCache.style.color = "#10b981";
          if (llmCachedActions) llmCachedActions.style.display = "flex";
        } else {
          statusLlmCache.textContent = "未保存";
          statusLlmCache.style.color = "var(--text-dim)";
          if (llmCachedActions) llmCachedActions.style.display = "none";
        }
      }
    } catch {
      storageTotalBytes.textContent = "取得エラー";
    }
  };

  btnDeleteLlmData?.addEventListener("click", async () => {
    if (confirm("端末に保存されている文脈AI（極小LLM）のモデルデータ（約350MB）を削除しますか？\n（いつでも再ダウンロード・再有効化できます）")) {
      await ModelCacheManager.clearCategory("llm");
      setLlmOptInEnabled(false);
      if (toggleLlm) toggleLlm.checked = false;
      updateToggleUi(false);
      updateRedactedUiByLlmOptIn();
      showToast("🗑️ 文脈AIデータを削除し、端末容量を解放しました");
      await updateStorageStats();
    }
  });

  if (toggleLlm) {
    toggleLlm.checked = isLlmOptInEnabled();
    updateToggleUi(toggleLlm.checked);

    toggleLlm.addEventListener("change", async () => {
      const enabled = toggleLlm.checked;
      setLlmOptInEnabled(enabled);
      updateToggleUi(enabled);
      updateRedactedUiByLlmOptIn();

      if (enabled) {
        if (llmProgressContainer) llmProgressContainer.style.display = "block";
        showToast("🤖 文脈理解AI（LLM）の初期化を開始します");
        try {
          const pipe = await getLocalLlmPipeline((status, progress) => {
            if (llmProgressStatus) llmProgressStatus.textContent = status;
            if (llmProgressPercent) llmProgressPercent.textContent = `${Math.round(progress * 100)}%`;
            if (llmProgressBar) llmProgressBar.style.width = `${Math.round(progress * 100)}%`;
          });
          if (!pipe) {
            throw new Error("Pipeline returned null");
          }
          showToast("✨ 文脈理解AIの準備が完了しました！");
          await updateStorageStats();
        } catch (err) {
          console.warn("[StorageModal] LLM activation failed:", err);
          setLlmOptInEnabled(false);
          if (toggleLlm) toggleLlm.checked = false;
          updateToggleUi(false);
          updateRedactedUiByLlmOptIn();
          showToast("⚠️ お使いの端末環境では文脈AIの初期化が完了できませんでした。通常モード（高精度NER＋ルールベース）で保護します");
          await updateStorageStats();
        } finally {
          if (llmProgressContainer) llmProgressContainer.style.display = "none";
        }
      } else {
        const stats = await ModelCacheManager.getCacheStorageStats();
        if (stats.models.llm.isCached) {
          if (confirm("文脈理解AIをOFFにしました。\n端末に保存されているモデルデータ（約350MB）も削除して空き容量を増やしますか？")) {
            await ModelCacheManager.clearCategory("llm");
            showToast("🗑️ モデルデータを削除し、空き容量を解放しました");
          } else {
            showToast("文脈理解AIを無効化しました（モデルは保持されます）");
          }
        } else {
          showToast("文脈理解AIを無効化しました");
        }
        await updateStorageStats();
      }
    });
  }


  const openModal = () => {
    if (modal) modal.style.display = "flex";
    updateStorageStats();
  };

  const closeModal = () => {
    if (modal) modal.style.display = "none";
  };

  btnOpen?.addEventListener("click", openModal);
  btnClose?.addEventListener("click", closeModal);
  backdrop?.addEventListener("click", closeModal);
  btnRefresh?.addEventListener("click", updateStorageStats);

  btnClear?.addEventListener("click", async () => {
    if (confirm("端末に保存されているAIモデルキャッシュをすべて削除しますか？\n（次回の自動検出時に必要に応じて再ダウンロードされます）")) {
      await ModelCacheManager.clearAll();
      showToast("🗑️ キャッシュを消去しました");
      await updateStorageStats();
    }
  });
}

// 初期化実行
initEvents();
initPwaAndStorageManager();
updateRedactedUiByLlmOptIn();

