import { appState, type AppState } from "./state/appState";
import { analyzeImageForRedaction, type RedactBox } from "./engine/redactionEngine";
import { renderRedactedCanvas, findBoxAtPosition, renderLineGuides } from "./engine/canvasRenderer";
import { calculateLineSnap, type SnapResult } from "./engine/lineSnap";
import { extendRectOnSameLine, rectsShareRedactionLine } from "./engine/manualStroke";
import {
  type Annotation,
  type ShapeKind,
  type ShapeWidthLevel,
  drawAnnotation,
  drawAnnotationSelection,
  findAnnotationAt,
  isAnnotationLargeEnough,
  strokeWidthFor
} from "./engine/annotations";
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
import { runOcr } from "./engine/ocr";

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
const toolShapeMode = document.getElementById("toolShapeMode") as HTMLButtonElement | null;
const shapeBar = document.getElementById("shapeBar") as HTMLDivElement | null;
const btnShapeDelete = document.getElementById("btnShapeDelete") as HTMLButtonElement | null;
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
const btnPopoverToggle = document.getElementById("btnPopoverToggle") as HTMLButtonElement;
const popoverToggleText = document.getElementById("popoverToggleText") as HTMLSpanElement;
const btnPopoverDelete = document.getElementById("btnPopoverDelete") as HTMLButtonElement;
const btnPopoverConfirm = document.getElementById("btnPopoverConfirm") as HTMLButtonElement;
const btnPopoverThinner = document.getElementById("btnPopoverThinner") as HTMLButtonElement;
const btnPopoverThicker = document.getElementById("btnPopoverThicker") as HTMLButtonElement;
const btnPopoverMoveUp = document.getElementById("btnPopoverMoveUp") as HTMLButtonElement;
const btnPopoverMoveDown = document.getElementById("btnPopoverMoveDown") as HTMLButtonElement;
const btnPopoverFontSmaller = document.getElementById("btnPopoverFontSmaller") as HTMLButtonElement;
const btnPopoverFontLarger = document.getElementById("btnPopoverFontLarger") as HTMLButtonElement;
const popoverTitle = document.getElementById("popoverTitle") as HTMLSpanElement | null;
const popoverDeleteText = document.getElementById("popoverDeleteText") as HTMLSpanElement | null;
const btnPopoverSelectSame = document.getElementById("btnPopoverSelectSame") as HTMLButtonElement | null;
const popoverMultiHint = document.getElementById("popoverMultiHint") as HTMLParagraphElement | null;
const POPOVER_LABEL_PLACEHOLDER = popoverCustomLabel?.placeholder ?? "";
const multiSelectHint = document.getElementById("multiSelectHint") as HTMLDivElement | null;
const btnMultiSelectHintClose = document.getElementById("btnMultiSelectHintClose") as HTMLButtonElement | null;

/** Mac では Ctrl の代わりに ⌘ を案内する（どちらでも動く）。 */
const MULTI_SELECT_KEY = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
const MULTI_SELECT_HINT_KEY = "kuronuri_multi_select_hint_done";

/** 一度でも複数選択できたか、ヒントを閉じたか。そうなったらもう出さない。 */
function isMultiSelectHintDone(): boolean {
  try {
    return localStorage.getItem(MULTI_SELECT_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function markMultiSelectHintDone(): void {
  try {
    localStorage.setItem(MULTI_SELECT_HINT_KEY, "1");
  } catch {
    // 保存できない環境では、この表示中だけ隠す
  }
  if (multiSelectHint) multiSelectHint.hidden = true;
}

/**
 * 画像エリア左上に、複数選択のやり方を小さく出す。
 * PC の選択/移動モードで黒塗りが2件以上あり、何も選んでいないときだけ。
 */
function syncMultiSelectHint(state: AppState): void {
  if (!multiSelectHint) return;
  multiSelectHint.hidden =
    isMultiSelectHintDone() ||
    !state.sourceImage ||
    state.mode !== "select" ||
    state.boxes.length < 2 ||
    state.selectedBoxIds.length > 0 ||
    isPerspectiveMode ||
    !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

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
const btnMobileSelect = document.getElementById("btnMobileSelect") as HTMLButtonElement | null;
const btnMobileDraw = document.getElementById("btnMobileDraw") as HTMLButtonElement | null;
const btnMobileShape = document.getElementById("btnMobileShape") as HTMLButtonElement | null;
const btnMobileCopy = document.getElementById("btnMobileCopy") as HTMLButtonElement | null;
const btnMobileDownload = document.getElementById("btnMobileDownload") as HTMLButtonElement | null;
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
/**
 * 黒塗追加で、押してから動かし始めるまでの操作。
 * 動いた向きで、線を引く・スクロール・端の調整のどれにするかを決める。動かさずに離せばタップ。
 */
interface DrawGesture {
  clientX: number;
  clientY: number;
  x: number;
  y: number;
  timer: number | null;
}
let drawGesture: DrawGesture | null = null;
/** 長押しのあと、線ではなく四角で囲んでいるあいだ true。 */
let isRectDrawing = false;
/** 押してから操作を決めるまでの移動量（画面px）。 */
const GESTURE_SLOP_PX = 10;
/** 四角で囲むモードに切り替える長押しの時間。 */
const LONG_PRESS_MS = 450;
/** 重なるか、これだけの隙間（行の高さに対する割合）までの線は既存の黒塗りを広げる。 */
const STROKE_JOIN_GAP = 0.3;
let drawHintShown = false;
let shapeHintShown = false;

/** 次に描く図形の種類・色・太さ。図形を選ぶと、その図形の設定に合わせる。 */
let currentShapeKind: ShapeKind = "arrow";
let currentShapeColor = "#ef4444";
let currentShapeWidth: ShapeWidthLevel = "medium";

/** 図形モードでの操作中の状態。draw は新しく描いている途中、move は既存の図形を動かしている途中。 */
let shapeGesture:
  | { kind: "draw"; preview: Annotation }
  | { kind: "move"; id: string; startX: number; startY: number; origin: Annotation; moved: boolean }
  | null = null;
let edgeAdjust: "start" | "end" | null = null;
let edgeAdjustBoxId: string | null = null;
let edgeFixedX = 0;
let edgeAdjustChanged = false;
/** 現在の画像から検出された行の傾き角度（度）。図形の角度補正がオフのときは 0。 */
let currentDetectedDeskewAngle = 0;
let activeSnappedLine: import("./engine/ocr").OcrLine | null = null;
let toastTimeout: number | null = null;

// Zoom & Pan Interaction State Variables
let isPanning = false;
let isSpaceDown = false;
let panStartX = 0;
let panStartY = 0;
let panStartOffsetX = 0;
let panStartOffsetY = 0;
/** 指を離したあと、画面が滑って止まるまでの速さ（px/ms）。 */
let panVelocityX = 0;
let panVelocityY = 0;
let lastPanSampleTime = 0;
let lastPanSampleX = 0;
let lastPanSampleY = 0;
let panInertiaFrame: number | null = null;

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

/**
 * 選択/移動モードで Ctrl / Shift を押している間は、編集パネルを半透明にしてクリックを素通りさせる。
 * パネルの下に隠れた黒塗りも、続けて Ctrl + クリックで選べるようにするため。
 */
function syncPopoverPassThrough(e: KeyboardEvent | MouseEvent | null): void {
  if (!boxEditorPopover) return;
  const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
  const held = !!e && (e.ctrlKey || e.metaKey || e.shiftKey);
  boxEditorPopover.classList.toggle("is-pass-through", held && !typing && appState.getState().mode === "select");
  multiSelectHint?.classList.toggle("is-active", held && !typing);
}
window.addEventListener("keydown", (e) => syncPopoverPassThrough(e));
window.addEventListener("keyup", (e) => syncPopoverPassThrough(e));
window.addEventListener("blur", () => syncPopoverPassThrough(null));

window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
  // Ctrl + A：すべての黒塗りを選んで一括設定
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && appState.getState().mode === "select" && appState.getState().boxes.length > 0) {
    e.preventDefault();
    selectAllBoxes();
    return;
  }
  // Delete / Backspace：図形モードで選んでいる図形を消す
  if ((e.key === "Delete" || e.key === "Backspace") && appState.getState().mode === "shape" && appState.getState().selectedAnnotationId) {
    e.preventDefault();
    deleteSelectedAnnotation();
    return;
  }
  // Esc：選択を解除して編集パネルを閉じる
  if (e.key === "Escape" && appState.getState().selectedBoxIds.length > 0) {
    closeBoxEditor();
  }
  if (e.key === "Escape" && appState.getState().selectedAnnotationId) {
    selectAnnotation(null);
    updateCanvasRender();
  }
});

/**
 * 選択/移動モードで Ctrl / Shift を押しながらの操作。
 * 動かさずに離せばその黒塗りを選択に足す/外す、ドラッグすれば囲んだ黒塗りを選択に足す。
 */
let selectGesture: {
  clientX: number;
  clientY: number;
  x: number;
  y: number;
  boxId: string | null;
  base: string[];
  marquee: { x: number; y: number; width: number; height: number } | null;
} | null = null;

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
      await ingestCapturedImage(img);
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
let cachedDeskewAngle: number | null = null;
let analysisRevision = 0;
let analysisRunning = false;
let pendingAnalysisReuse: boolean | null = null;
let guideAfterAnalysis: HTMLImageElement | null = null;

function setSourceImageAndInvalidateAnalysis(img: HTMLImageElement | null): void {
  lastOcrResult = null;
  cachedDeskewAngle = null;
  currentDetectedDeskewAngle = 0;
  cancelDrawGesture();
  stopPanInertia();
  isDrawing = false;
  isRectDrawing = false;
  edgeAdjust = null;
  edgeAdjustBoxId = null;
  isPerspectiveMode = false;
  perspectiveCorners = null;
  activeCornerKey = null;
  if (perspectiveBar) perspectiveBar.style.display = "none";
  analysisRevision++;
  pendingAnalysisReuse = null;
  guideAfterAnalysis = null;
  appState.setSourceImage(img);
}

/**
 * 伏字テキストプレビューの表示更新
 */
function refreshRedactedTextPreview(): void {
  const state = appState.getState();

  if (!state.sourceImage || !lastOcrResult || lastOcrResult.lines.length === 0) {
    if (txtRedactedPreview) {
      txtRedactedPreview.value = state.sourceImage && lastOcrResult
        ? "文字が検出されませんでした。"
        : "黒塗りした部分が、ここに伏字として出ます。";
    }
    if (btnCopyRedactedText) btnCopyRedactedText.disabled = true;
    return;
  }

  // 行検出だけでは原文を伏字プレビューに出さない。黒塗りが付いてから置換する。
  if (!state.boxes.some((box) => box.enabled)) {
    if (txtRedactedPreview) {
      txtRedactedPreview.value = "文字行を検出しました。黒塗りした部分が、ここに伏字として出ます。";
    }
    if (btnCopyRedactedText) btnCopyRedactedText.disabled = true;
    return;
  }

  const res = generateRedactedText(lastOcrResult, state.boxes);
  if (txtRedactedPreview) {
    txtRedactedPreview.value = res.redactedText || "(検出された文字はありませんでした)";
  }
  if (btnCopyRedactedText) {
    btnCopyRedactedText.disabled = !res.redactedText;
  }
}

/**
 * エクスポート時だけ安全条件を確認する。通常の黒塗りでは追加操作を発生させない。
 * モザイク・ぼかしは見た目上読める場合があるため、出力は不透明黒へ固定する。
 */
function getSafeExportRendererOptions(
  state: AppState
): AppState["rendererOptions"] | null {
  const warnings: string[] = [];
  const unsafeStyle = state.rendererOptions.style === "mosaic" || state.rendererOptions.style === "blur";
  if (unsafeStyle) {
    warnings.push("モザイク・ぼかしは復元や判読の余地があるため、保存画像では不透明な黒塗りに変更します。");
  }
  if (lastOcrResult && lastOcrResult.status && lastOcrResult.status !== "ok") {
    warnings.push(lastOcrResult.warnings?.[0] || "OCR結果に未確認箇所があります。黒塗り位置を確認してください。");
  }
  if (warnings.length > 0 && !confirm(`${warnings.join("\n\n")}\n\n確認のうえエクスポートしますか？`)) {
    return null;
  }
  return unsafeStyle
    ? { ...state.rendererOptions, style: "blackout" }
    : state.rendererOptions;
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
      preloadedOcr,
      preloadedAvatars
    });
  };
  img.src = dataUrl;
}

let lastCorrection: CaptureCorrectionResult | null = null;

/**
 * 画像をそのまま読み込む。
 * 黒塗りは作らず、文字行の検出とガイドだけ自動で行う。
 */
async function ingestCapturedImage(
  img: HTMLImageElement,
  opts: {
    preloadedOcr?: import("./engine/ocr").OcrResult;
    preloadedAvatars?: { x: number; y: number; width: number; height: number }[];
  } = {}
): Promise<void> {
  currentPreloadedOcr = opts.preloadedOcr;
  currentPreloadedAvatars = opts.preloadedAvatars;
  lastCorrection = null;

  setSourceImageAndInvalidateAnalysis(img);
  appState.setMode("select");
  void detectLinesForManualGuides(img);
}

function ocrIsUsable(result: import("./engine/ocr").OcrResult | null | undefined): result is import("./engine/ocr").OcrResult {
  return !!result && !["failed", "timeout", "no_text"].includes(result.status ?? "ok") && result.lines.length > 0;
}

/**
 * 手動黒塗り用に文字行だけを検出する。黒塗り枠は作らない。
 * 検出した行はガイド表示と行スナップに使う。
 */
async function detectLinesForManualGuides(sourceImage: HTMLImageElement): Promise<void> {
  if (appState.getState().sourceImage !== sourceImage) return;

  if (analysisRunning) {
    guideAfterAnalysis = sourceImage;
    return;
  }

  const preloaded = currentPreloadedOcr;
  if (ocrIsUsable(preloaded)) {
    lastOcrResult = preloaded;
    updateCanvasRender();
    refreshRedactedTextPreview();
    showToast(`文字行を ${preloaded.lines.length} 本検出しました。黒塗追加でガイドに沿ってなぞれます`, 4000);
    return;
  }

  const revision = analysisRevision;
  analysisRunning = true;
  appState.setAnalyzing(true, "文字行を検出しています...", 0.06);
  try {
    const ocr = await runOcr(sourceImage, (progress) => {
      if (revision !== analysisRevision || appState.getState().sourceImage !== sourceImage) return;
      appState.setAnalyzing(true, `文字行を検出しています\n${progress.status}`, Math.max(0.06, progress.progress));
    });
    if (appState.getState().sourceImage !== sourceImage) return;
    lastOcrResult = ocr;
    updateCanvasRender();
    refreshRedactedTextPreview();
    if (revision !== analysisRevision) return;
    if (ocr.lines.length > 0) {
      showToast(`文字行を ${ocr.lines.length} 本検出しました。黒塗追加でガイドに沿ってなぞれます`, 4500);
    } else if (ocr.status === "timeout") {
      showToast("文字行の検出が時間内に終わりませんでした。自由な矩形で黒塗りできます", 5000);
    } else {
      showToast("文字行は見つかりませんでした。自由な矩形で黒塗りできます", 5000);
    }
  } catch (err) {
    console.error(err);
    if (revision === analysisRevision && appState.getState().sourceImage === sourceImage) {
      showToast("文字行の検出に失敗しました。自由な矩形で黒塗りできます");
    }
  } finally {
    analysisRunning = false;
    const reuse = pendingAnalysisReuse;
    pendingAnalysisReuse = null;
    const nextGuide = guideAfterAnalysis;
    guideAfterAnalysis = null;
    if (reuse !== null && appState.getState().sourceImage) {
      void startAnalysis(reuse);
      return;
    }
    if (nextGuide && nextGuide === appState.getState().sourceImage) {
      void detectLinesForManualGuides(nextGuide);
      return;
    }
    appState.setAnalyzing(false);
  }
}

/**
 * 自動墨消し画像解析の実行
 */
async function startAnalysis(reuseOcr: boolean = false): Promise<void> {
  const state = appState.getState();
  if (!state.sourceImage) return;
  const revision = ++analysisRevision;
  if (analysisRunning) {
    pendingAnalysisReuse = pendingAnalysisReuse === false ? false : reuseOcr;
    return;
  }
  analysisRunning = true;
  const sourceImage = state.sourceImage;
  const filterOptions = { ...state.filterOptions, customKeywords: [...state.filterOptions.customKeywords] };

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
      const detected = cachedDeskewAngle ?? detectImageDeskewAngle(sourceImage);
      cachedDeskewAngle = detected;
      console.log("[startAnalysis] Detected deskew angle for bounding boxes:", detected);
      if (Math.abs(detected) >= 0.8) {
        currentDetectedDeskewAngle = detected;
      }
    }

    const reusableOcr = currentPreloadedOcr ?? (ocrIsUsable(lastOcrResult) ? lastOcrResult : undefined);
    const result = await analyzeImageForRedaction(
      sourceImage,
      filterOptions,
      (p) => {
        if (revision === analysisRevision) {
          appState.setAnalyzing(true, p.status, p.progress);
        }
      },
      reusableOcr,
      currentPreloadedAvatars,
      currentDetectedDeskewAngle
    );
    if (sourceImage !== appState.getState().sourceImage) return;
    // 同じ画像で後続リクエストが待機している場合も、OCRは次の解析に再利用する。
    lastOcrResult = result.ocrResult;
    if (revision !== analysisRevision) return;
    // 再解析でも、ユーザーが追加した手動枠を失わない。
    const manualBoxes = appState.getState().boxes.filter((box) => box.isManual || box.type === "manual");
    appState.setBoxes([...result.boxes, ...manualBoxes]);
    refreshRedactedTextPreview();

    const slopeNotice = currentDetectedDeskewAngle !== 0 ? ` (傾き ${currentDetectedDeskewAngle > 0 ? "+" : ""}${currentDetectedDeskewAngle.toFixed(1)}° 追従)` : "";
    const corrNotice = lastCorrection && !lastCorrection.skipped ? " / 正対化済み" : "";
    const photoNotice = result.ocrResult.analysis?.isLikelyScreenPhoto ? " / 画面撮影向け前処理" : "";
    const ocrWarning = result.ocrResult.warnings?.[0];
    if (ocrWarning) {
      showToast(`⚠️ ${ocrWarning}`, 6000);
    } else {
      showToast(`解析完了: ${result.boxes.length}箇所のプライバシー情報を保護しました${slopeNotice}${corrNotice}${photoNotice}`);
    }
  } catch (err) {
    console.error("Analysis failed:", err);
    if (revision === analysisRevision) showToast("画像解析中にエラーが発生しました");
  } finally {
    analysisRunning = false;
    appState.setAnalyzing(false);
    if (pendingAnalysisReuse !== null) {
      const reuse = pendingAnalysisReuse;
      pendingAnalysisReuse = null;
      void startAnalysis(reuse);
    }
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
  // 4隅調整の出入りは状態の通知を通らないので、描き直しのたびにヒントの表示も合わせる
  syncMultiSelectHint(state);
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
    { ...state.rendererOptions, selectedBoxId: state.selectedBoxId, selectedBoxIds: state.selectedBoxIds },
    false,
    state.annotations
  );

  // 検出済みの文字行ガイド。手動黒塗りの位置合わせに使う。
  if (lastOcrResult && lastOcrResult.lines.length > 0) {
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
    ctx.strokeStyle = isRectDrawing ? "#f59e0b" : isSnapped ? "#10b981" : "#38bdf8";
    ctx.lineWidth = Math.max(1.5, 2.5 / Math.max(0.5, state.zoom));
    ctx.setLineDash(isSnapped ? [4, 2] : [6, 4]);
    ctx.strokeRect(
      currentDrawRect.x,
      currentDrawRect.y,
      currentDrawRect.width,
      currentDrawRect.height
    );
    ctx.fillStyle = isRectDrawing
      ? "rgba(245, 158, 11, 0.25)"
      : isSnapped ? "rgba(16, 185, 129, 0.35)" : "rgba(56, 189, 248, 0.25)";
    ctx.fillRect(
      currentDrawRect.x,
      currentDrawRect.y,
      currentDrawRect.width,
      currentDrawRect.height
    );
    if (isRectDrawing) {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(drawStartX, drawStartY, Math.max(5, 9 / Math.max(0.5, state.zoom)), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 図形モード：描きかけの図形と、選択中の図形の目印
  if (shapeGesture?.kind === "draw") drawAnnotation(ctx, shapeGesture.preview);
  if (state.mode === "shape" && state.selectedAnnotationId) {
    const selected = state.annotations.find((a) => a.id === state.selectedAnnotationId);
    if (selected) drawAnnotationSelection(ctx, selected, state.zoom);
  }

  // Ctrl / Shift + ドラッグの範囲選択枠
  if (selectGesture?.marquee) {
    const m = selectGesture.marquee;
    ctx.save();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = Math.max(1, 1.5 / Math.max(0.5, state.zoom));
    ctx.setLineDash([6, 4]);
    ctx.fillStyle = "rgba(56, 189, 248, 0.12)";
    ctx.fillRect(m.x, m.y, m.width, m.height);
    ctx.strokeRect(m.x, m.y, m.width, m.height);
    ctx.restore();
  }

  drawManualEdgeHandles(ctx);
}

/** 選択中の黒塗り（並びは選んだ順）。 */
function selectedBoxes(): RedactBox[] {
  const state = appState.getState();
  const byId = new Map(state.boxes.map((box) => [box.id, box]));
  return state.selectedBoxIds.map((id) => byId.get(id)).filter((box): box is RedactBox => !!box);
}

/** 選択中の黒塗りをすべて囲む矩形（画像座標）。 */
function selectionBounds(boxes: RedactBox[]): RedactBox["rect"] | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { rect } of boxes) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 一括設定で、項目名を選び直したか。触っていなければ各黒塗りの項目名はそのまま残す。 */
let popoverLabelTouched = false;

/**
 * 黒塗り編集ポップオーバーの表示と位置合わせ。複数選択中は全件を囲む位置に出す。
 * keepPosition: すでに開いていれば位置を動かさない（選択した黒塗りが隠れるときだけ置き直す）。
 */
function showBoxEditorPopover(opts: { preserveFields?: boolean; keepPosition?: boolean } = {}): void {
  if (!boxEditorPopover || !renderCanvas || !canvasViewport) return;
  const boxes = selectedBoxes();
  const bounds = selectionBounds(boxes);
  if (!bounds) return;
  const isMulti = boxes.length > 1;
  const wasOpen = boxEditorPopover.style.display !== "none";

  boxEditorPopover.style.display = "block";
  canvasViewport.classList.add("editor-open");
  const draftHint = document.getElementById("popoverDraftHint");
  if (draftHint) draftHint.hidden = isMulti || !(boxes[0].isManual && appState.getState().mode === "draw");
  syncPopoverSelectionUi(boxes);

  const keep =
    opts.keepPosition && wasOpen && !boxEditorPopover.classList.contains("is-docked") && !boxes.some(isBoxHiddenByPopover);

  // 狭い画面では編集パネルを下端に固定し、上の画像を見えるようにする
  if (window.matchMedia("(max-width: 768px)").matches) {
    boxEditorPopover.classList.add("is-docked");
    boxEditorPopover.style.left = "";
    boxEditorPopover.style.top = "";
    boxEditorPopover.style.right = "";
    boxEditorPopover.style.bottom = "";
  } else if (!keep) {
    boxEditorPopover.classList.remove("is-docked");
    const cRect = renderCanvas.getBoundingClientRect();
    const vRect = canvasViewport.getBoundingClientRect();
    const scaleX = cRect.width / (renderCanvas.width || 1);
    const scaleY = cRect.height / (renderCanvas.height || 1);

    // Viewport内の相対座標を計算
    const boxLeft = cRect.left - vRect.left + bounds.x * scaleX;
    const boxTop = cRect.top - vRect.top + bounds.y * scaleY;
    const boxW = bounds.width * scaleX;
    const boxH = bounds.height * scaleY;

    const popoverW = boxEditorPopover.offsetWidth || 290;
    const popoverH = boxEditorPopover.offsetHeight || 260;

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
    boxEditorPopover.style.right = "";
    boxEditorPopover.style.bottom = "";
  }

  if (opts.preserveFields) return;
  syncPopoverFields(boxes);
}

/** 件数に応じて見出し・削除ボタン・「同じ項目を選択」・操作ヒントを切り替える。 */
function syncPopoverSelectionUi(boxes: RedactBox[]): void {
  const isMulti = boxes.length > 1;
  if (popoverTitle) popoverTitle.textContent = isMulti ? `${boxes.length}件の黒塗りをまとめて設定` : "黒塗りの項目を設定";
  if (popoverDeleteText) popoverDeleteText.textContent = isMulti ? `${boxes.length}件削除` : "削除";
  btnPopoverDelete?.setAttribute("title", isMulti ? "選択中の黒塗りをすべて削除" : "この黒塗りを完全に削除");

  // 選択中と同じ項目名の黒塗りがほかにもあれば、まとめて選べるようにする
  if (btnPopoverSelectSame) {
    const labels = new Set(boxes.map((box) => box.label ?? ""));
    const selected = new Set(boxes.map((box) => box.id));
    const label = labels.size === 1 ? [...labels][0] : null;
    const extra = label === null
      ? 0
      : appState.getState().boxes.filter((box) => !selected.has(box.id) && (box.label ?? "") === label).length;
    btnPopoverSelectSame.hidden = extra === 0;
    if (extra > 0) {
      btnPopoverSelectSame.textContent = `「${label || "文字なし"}」の黒塗りをすべて選択（+${extra}件）`;
    }
  }

  // マウス操作の端末で、1件だけ選んでいるときに複数選択のやり方を案内する
  if (popoverMultiHint) {
    popoverMultiHint.hidden = isMulti || !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }
}

/** 入力欄・チップ・保護トグルを選択中の黒塗りに合わせる。keepTypedLabel なら選び直した項目名は残す。 */
function syncPopoverFields(boxes: RedactBox[], keepTypedLabel = false): void {
  const labels = new Set(boxes.map((box) => box.label ?? ""));
  const mixed = labels.size > 1;
  if (!(keepTypedLabel && popoverLabelTouched)) {
    popoverLabelTouched = false;
    popoverCustomLabel.value = mixed ? "" : ([...labels][0] ?? "");
    popoverCustomLabel.placeholder = mixed ? "項目がバラバラです（選ぶと全件そろえます）" : POPOVER_LABEL_PLACEHOLDER;
    syncPopoverChips(mixed ? null : popoverCustomLabel.value);
  }
  if (popoverToggleText) {
    popoverToggleText.textContent = boxes.some((box) => box.enabled) ? "保護を一時解除" : "保護を再適用";
  }
}

/** 入力中のラベルに一致するチップだけを選択状態にする。null ならどれも選ばない。 */
function syncPopoverChips(label: string | null): void {
  if (!boxEditorPopover) return;
  const chips = boxEditorPopover.querySelectorAll<HTMLButtonElement>(".popover-chip");
  chips.forEach((chip) => {
    chip.classList.toggle("active", label !== null && chip.getAttribute("data-label") === label);
  });
}

function hideBoxEditorPopover(): void {
  popoverLabelTouched = false;
  if (boxEditorPopover) {
    boxEditorPopover.style.display = "none";
    boxEditorPopover.classList.remove("is-docked");
  }
  canvasViewport?.classList.remove("editor-open");
}

function currentLineSnapOptions(): { globalAngle?: number } {
  if (!toggleFollowSlope.checked || Math.abs(currentDetectedDeskewAngle) < 0.1) return {};
  return { globalAngle: currentDetectedDeskewAngle };
}

function rotationForManualStroke(snap: SnapResult | null): number | undefined {
  if (!toggleFollowSlope.checked) return undefined;
  const angle = snap?.rotation ?? currentDetectedDeskewAngle;
  if (angle === undefined || Math.abs(angle) < 0.1) return undefined;
  return angle;
}

/** 画面上の px を画像座標の長さに直す（拡大率によらず同じ手応えにする）。 */
function screenToImageLength(px: number): number {
  const view = renderCanvas.getBoundingClientRect();
  return px * (renderCanvas.width / (view.width || 1));
}

function annotationAtPoint(x: number, y: number): Annotation | null {
  const tolerance = screenToImageLength(window.matchMedia("(pointer: coarse)").matches ? 16 : 9);
  return findAnnotationAt(appState.getState().annotations, x, y, tolerance);
}

function selectAnnotation(annotation: Annotation | null): void {
  appState.setSelectedAnnotationId(annotation?.id ?? null);
  if (annotation) {
    // 選んだ図形の設定をバーに映す。続けて描く図形も同じ見た目になる。
    currentShapeKind = annotation.kind;
    currentShapeColor = annotation.color;
    const img = appState.getState().sourceImage;
    if (img) {
      const levels: ShapeWidthLevel[] = ["thin", "medium", "thick"];
      currentShapeWidth = levels.reduce((best, level) =>
        Math.abs(strokeWidthFor(level, img.width, img.height) - annotation.width) <
        Math.abs(strokeWidthFor(best, img.width, img.height) - annotation.width) ? level : best
      );
    }
  }
  syncShapeBar();
}

function beginShapeGesture(x: number, y: number): void {
  const state = appState.getState();
  const img = state.sourceImage;
  if (!img) return;
  stopPanInertia();
  const hit = annotationAtPoint(x, y);
  if (hit) {
    selectAnnotation(hit);
    shapeGesture = { kind: "move", id: hit.id, startX: x, startY: y, origin: { ...hit }, moved: false };
    renderCanvas.style.cursor = "move";
  } else {
    selectAnnotation(null);
    shapeGesture = {
      kind: "draw",
      preview: {
        id: `shape-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: currentShapeKind,
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        color: currentShapeColor,
        width: strokeWidthFor(currentShapeWidth, img.width, img.height)
      }
    };
  }
  renderCanvas.classList.add("is-interacting");
  updateCanvasRender();
}

function moveShapeGesture(x: number, y: number): void {
  const gesture = shapeGesture;
  if (!gesture) return;
  if (gesture.kind === "draw") {
    gesture.preview.x2 = x;
    gesture.preview.y2 = y;
  } else {
    const dx = x - gesture.startX;
    const dy = y - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) < screenToImageLength(3)) return;
    gesture.moved = true;
    const o = gesture.origin;
    appState.updateAnnotation(gesture.id, { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy }, false);
  }
  updateCanvasRender();
}

function endShapeGesture(): void {
  const gesture = shapeGesture;
  shapeGesture = null;
  renderCanvas.classList.remove("is-interacting");
  if (!gesture) return;
  if (gesture.kind === "draw") {
    // 描いた直後の図形は選ばない。続けて種類や色を変えても、いま描いた図形は変わらない。
    // 変えたいときは、その図形の線を押して選んでから。
    if (isAnnotationLargeEnough(gesture.preview, screenToImageLength(8))) {
      appState.addAnnotation(gesture.preview, false);
      syncShapeBar();
    }
  } else if (gesture.moved) {
    appState.commitHistory();
  }
  syncDrawCursor();
  updateCanvasRender();
}

/** 図形バーのボタン（種類・色・太さ・削除）の見た目を今の設定に合わせる。 */
function syncShapeBar(): void {
  if (!shapeBar) return;
  shapeBar.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.kind === currentShapeKind)
  );
  shapeBar.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.color === currentShapeColor)
  );
  shapeBar.querySelectorAll<HTMLButtonElement>("[data-width]").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.width === currentShapeWidth)
  );
  if (btnShapeDelete) btnShapeDelete.disabled = !appState.getState().selectedAnnotationId;
}

/** 図形バーで設定を変える。図形を選んでいれば、その図形にもすぐ反映する。 */
function applyShapeSetting(patch: { kind?: ShapeKind; color?: string; width?: ShapeWidthLevel }): void {
  if (patch.kind) currentShapeKind = patch.kind;
  if (patch.color) currentShapeColor = patch.color;
  if (patch.width) currentShapeWidth = patch.width;
  const state = appState.getState();
  const selected = state.annotations.find((a) => a.id === state.selectedAnnotationId);
  if (selected && state.sourceImage) {
    const updates: Partial<Annotation> = {};
    if (patch.kind && patch.kind !== selected.kind) updates.kind = patch.kind;
    if (patch.color && patch.color !== selected.color) updates.color = patch.color;
    if (patch.width) {
      const width = strokeWidthFor(patch.width, state.sourceImage.width, state.sourceImage.height);
      if (width !== selected.width) updates.width = width;
    }
    if (Object.keys(updates).length > 0) appState.updateAnnotation(selected.id, updates);
  }
  syncShapeBar();
  updateCanvasRender();
}

function deleteSelectedAnnotation(): void {
  const id = appState.getState().selectedAnnotationId;
  if (!id) return;
  appState.removeAnnotation(id);
  syncShapeBar();
  updateCanvasRender();
  showToast("🗑️ 図形を削除しました");
}

/** 範囲選択の枠と重なる黒塗り。 */
function boxesInMarquee(m: { x: number; y: number; width: number; height: number }): string[] {
  return appState.getState().boxes
    .filter(({ rect }) => rect.x < m.x + m.width && rect.x + rect.width > m.x && rect.y < m.y + m.height && rect.y + rect.height > m.y)
    .map((box) => box.id);
}

function beginSelectGesture(e: MouseEvent, x: number, y: number): void {
  const state = appState.getState();
  selectGesture = {
    clientX: e.clientX,
    clientY: e.clientY,
    x,
    y,
    boxId: findBoxAtPosition(state.boxes, x, y)?.id ?? null,
    base: [...state.selectedBoxIds],
    marquee: null
  };
}

function moveSelectGesture(clientX: number, clientY: number, x: number, y: number): void {
  const gesture = selectGesture;
  if (!gesture) return;
  if (!gesture.marquee && Math.hypot(clientX - gesture.clientX, clientY - gesture.clientY) < GESTURE_SLOP_PX) return;
  if (!gesture.marquee) hideBoxEditorPopover();
  gesture.marquee = {
    x: Math.min(gesture.x, x),
    y: Math.min(gesture.y, y),
    width: Math.abs(x - gesture.x),
    height: Math.abs(y - gesture.y)
  };
  // 枠に入った黒塗りをその場で強調する（離すまで編集パネルは出さない）
  appState.setSelection([...gesture.base, ...boxesInMarquee(gesture.marquee)], appState.getState().selectedBoxId);
  updateCanvasRender();
}

function endSelectGesture(): void {
  const gesture = selectGesture;
  selectGesture = null;
  if (!gesture) return;
  if (gesture.marquee) {
    const ids = [...gesture.base, ...boxesInMarquee(gesture.marquee)];
    openSelectionEditor(ids, appState.getState().selectedBoxId);
    if (ids.length > 1) showToast(`${new Set(ids).size}件を選択しました`);
    return;
  }
  if (!gesture.boxId) {
    updateCanvasRender();
    return;
  }
  const id = gesture.boxId;
  const removed = gesture.base.includes(id);
  const ids = removed ? gesture.base.filter((item) => item !== id) : [...gesture.base, id];
  // 外した黒塗りが基準だった場合は、setSelection が残りの最後の1件を基準にする
  openSelectionEditor(ids, removed ? appState.getState().selectedBoxId : id);
}

/** 選択/移動モードで、すべての黒塗りを選んで一括設定を開く。 */
function selectAllBoxes(): void {
  const state = appState.getState();
  if (state.mode !== "select" || state.boxes.length === 0) return;
  openSelectionEditor(state.boxes.map((box) => box.id), state.selectedBoxId);
  showToast(`${state.boxes.length}件すべてを選択しました`);
}

/** 黒塗りの項目設定を開く。線を引いたあと、その黒塗りをタップしたときだけ開く。 */
function openBoxEditor(box: RedactBox): void {
  appState.setSelectedBoxId(box.id);
  showBoxEditorPopover();
}

/** 複数選択を反映して編集パネルを開き直す。選択が空なら閉じる。 */
function openSelectionEditor(ids: string[], anchorId?: string | null): void {
  appState.setSelection(ids, anchorId);
  // 2件以上をまとめて選べたら、やり方は覚えたとみなしてヒントを出さない
  if (appState.getState().selectedBoxIds.length > 1) markMultiSelectHintDone();
  if (appState.getState().selectedBoxIds.length === 0) {
    dismissBoxEditor();
  } else {
    showBoxEditorPopover({ keepPosition: true, preserveFields: true });
    syncPopoverFields(selectedBoxes(), true);
  }
  updateCanvasRender();
}

/** 項目設定を閉じるだけで、モードはそのまま。黒塗追加中なら続けて線を引ける。 */
function dismissBoxEditor(): void {
  hideBoxEditorPopover();
  if (appState.getState().selectedBoxId !== null) appState.setSelectedBoxId(null);
}

function closeBoxEditor(): void {
  dismissBoxEditor();
  updateCanvasRender();
  syncDrawCursor();
}

function syncDrawCursor(): void {
  if (!renderCanvas) return;
  if (edgeAdjust) {
    renderCanvas.style.cursor = "ew-resize";
    return;
  }
  if (isPanning) {
    renderCanvas.style.cursor = "grabbing";
    return;
  }
  const mode = appState.getState().mode;
  renderCanvas.style.cursor = mode === "draw" || mode === "shape" ? "crosshair" : "default";
}

function beginPan(clientX: number, clientY: number): void {
  stopPanInertia();
  const state = appState.getState();
  isPanning = true;
  panStartX = clientX;
  panStartY = clientY;
  panStartOffsetX = state.panX;
  panStartOffsetY = state.panY;
  panVelocityX = 0;
  panVelocityY = 0;
  lastPanSampleTime = performance.now();
  lastPanSampleX = clientX;
  lastPanSampleY = clientY;
  renderCanvas.classList.add("is-interacting");
  renderCanvas.style.cursor = "grabbing";
}

function movePan(clientX: number, clientY: number): void {
  const now = performance.now();
  const dt = now - lastPanSampleTime;
  if (dt > 0) {
    // 直近の動きを重く見て、離す直前の速さを慣性に使う
    const blend = Math.min(1, dt / 50);
    panVelocityX += ((clientX - lastPanSampleX) / dt - panVelocityX) * blend;
    panVelocityY += ((clientY - lastPanSampleY) / dt - panVelocityY) * blend;
  }
  lastPanSampleTime = now;
  lastPanSampleX = clientX;
  lastPanSampleY = clientY;
  appState.setPan(panStartOffsetX + clientX - panStartX, panStartOffsetY + clientY - panStartY);
  applyCanvasTransform();
}

/** 指を離す。さっと払っていれば、その勢いで少し滑らせてから止める。 */
function endPan(): void {
  isPanning = false;
  renderCanvas.classList.remove("is-interacting");
  syncDrawCursor();
  const idle = performance.now() - lastPanSampleTime;
  if (idle > 80 || Math.hypot(panVelocityX, panVelocityY) < 0.3) return;
  let last = performance.now();
  const step = (now: number): void => {
    const dt = Math.min(48, now - last);
    last = now;
    const state = appState.getState();
    appState.setPan(state.panX + panVelocityX * dt, state.panY + panVelocityY * dt);
    applyCanvasTransform();
    const decay = Math.pow(0.95, dt / 16);
    panVelocityX *= decay;
    panVelocityY *= decay;
    panInertiaFrame = Math.hypot(panVelocityX, panVelocityY) < 0.02 ? null : requestAnimationFrame(step);
  };
  panInertiaFrame = requestAnimationFrame(step);
}

function stopPanInertia(): void {
  if (panInertiaFrame !== null) cancelAnimationFrame(panInertiaFrame);
  panInertiaFrame = null;
}

/** 黒塗追加中に、手で引いた黒塗りの左右の端（丸いつまみ）に触れているか。 */
function manualEdgeAt(x: number, y: number): { box: RedactBox; edge: "start" | "end" } | null {
  const view = renderCanvas.getBoundingClientRect();
  const scale = renderCanvas.width / (view.width || 1);
  const handle = Math.max(10, 18 * scale);
  let best: { box: RedactBox; edge: "start" | "end" } | null = null;
  let bestDist = Infinity;
  for (const box of appState.getState().boxes) {
    if (!box.isManual) continue;
    const rect = box.rect;
    // 上下はその黒塗りの行の中だけ。すぐ下の行から引き始めた線が、端のつまみを掴まないようにする。
    const padY = Math.min(4 * scale, rect.height * 0.25);
    if (y < rect.y - padY || y > rect.y + rect.height + padY) continue;
    const reach = Math.min(handle, Math.max(rect.width * 0.3, 6));
    const leftDist = Math.abs(x - rect.x);
    const rightDist = Math.abs(x - (rect.x + rect.width));
    if (leftDist <= handle && x <= rect.x + reach && leftDist < bestDist) {
      best = { box, edge: "start" };
      bestDist = leftDist;
    }
    if (rightDist <= handle && x >= rect.x + rect.width - reach && rightDist < bestDist) {
      best = { box, edge: "end" };
      bestDist = rightDist;
    }
  }
  return best;
}

function beginEdgeAdjust(edge: "start" | "end", box: RedactBox): void {
  edgeAdjust = edge;
  edgeAdjustBoxId = box.id;
  edgeFixedX = edge === "start" ? box.rect.x + box.rect.width : box.rect.x;
  edgeAdjustChanged = false;
  isDrawing = false;
  isPanning = false;
  renderCanvas.classList.add("is-interacting");
  renderCanvas.style.cursor = "ew-resize";
}

function edgeAdjustBox(): RedactBox | undefined {
  if (!edgeAdjustBoxId) return undefined;
  return appState.getState().boxes.find((box) => box.id === edgeAdjustBoxId);
}

function applyEdgeAdjust(canvasX: number): void {
  const box = edgeAdjustBox();
  if (!edgeAdjust || !box) return;
  // 反対側の端を越えたら、そのまま向きを入れ替えて伸ばす。
  const x = Math.min(canvasX, edgeFixedX);
  const width = Math.max(8, Math.abs(canvasX - edgeFixedX));
  if (Math.abs(x - box.rect.x) < 0.5 && Math.abs(width - box.rect.width) < 0.5) return;
  edgeAdjustChanged = true;
  appState.updateBox(box.id, {
    rect: { x, y: box.rect.y, width, height: box.rect.height }
  }, false);
  const updated = edgeAdjustBox();
  if (updated && appState.getState().selectedBoxIds.includes(updated.id)) showBoxEditorPopover({ preserveFields: true });
}

/** 選んでいる黒塗り（複数なら全件）の上下だけを置き換える。横の位置と長さはそのまま。 */
function updateSelectedBoxVertical(next: (rect: RedactBox["rect"]) => { y: number; height: number }): void {
  const boxes = selectedBoxes();
  if (boxes.length === 0) return;
  appState.updateBoxes(boxes.map((box) => box.id), (box) => {
    const { y, height } = next(box.rect);
    const nextHeight = Math.max(4, Math.min(renderCanvas.height, height));
    const nextY = Math.max(0, Math.min(renderCanvas.height - nextHeight, y));
    if (Math.abs(nextY - box.rect.y) < 0.5 && Math.abs(nextHeight - box.rect.height) < 0.5) return null;
    return { rect: { ...box.rect, y: nextY, height: nextHeight } };
  });
  updateCanvasRender();
  refreshRedactedTextPreview();
  // 編集パネルは基本動かさない。連打中にボタンの位置がずれて押せなくなるのを防ぐ。
  // ただし黒塗りがパネルの下に隠れるときだけ、見える位置へ置き直す。
  if (selectedBoxes().some(isBoxHiddenByPopover)) showBoxEditorPopover({ preserveFields: true });
}

/** 黒塗りが編集パネルと重なって隠れているか（画面上の位置で判定）。 */
function isBoxHiddenByPopover(box: RedactBox): boolean {
  if (!boxEditorPopover || boxEditorPopover.style.display === "none" || !renderCanvas) return false;
  const cRect = renderCanvas.getBoundingClientRect();
  const pRect = boxEditorPopover.getBoundingClientRect();
  const scaleX = cRect.width / (renderCanvas.width || 1);
  const scaleY = cRect.height / (renderCanvas.height || 1);
  const left = cRect.left + box.rect.x * scaleX;
  const top = cRect.top + box.rect.y * scaleY;
  const right = left + box.rect.width * scaleX;
  const bottom = top + box.rect.height * scaleY;
  return left < pRect.right && right > pRect.left && top < pRect.bottom && bottom > pRect.top;
}

/** 太さを一段階変える。上下の中心は保つので、隠したい側へは位置の調整でずらす。 */
function adjustBoxThickness(direction: 1 | -1): void {
  updateSelectedBoxVertical(({ y, height }) => {
    const nextHeight = Math.max(4, height + Math.max(1, Math.round(height * 0.12)) * direction);
    return { y: y + (height - nextHeight) / 2, height: nextHeight };
  });
}

/** 線を上下にずらす。行が広く検出されたとき、隠したい文字の側へ寄せる。 */
function moveBoxVertically(direction: 1 | -1): void {
  updateSelectedBoxVertical(({ y, height }) => ({
    y: y + Math.max(1, Math.round(height * 0.12)) * direction,
    height
  }));
}

const LABEL_SCALE_MIN = 0.4;
const LABEL_SCALE_MAX = 1.6;
const LABEL_SCALE_STEP = 0.1;

/** ラベル文字の大きさを一段階変える。基準サイズ（枠の高さから自動算出）への倍率として保持する。 */
function adjustBoxLabelScale(direction: 1 | -1): void {
  const ids = appState.getState().selectedBoxIds;
  if (ids.length === 0) return;
  appState.updateBoxes(ids, (box) => {
    const current = box.labelScale ?? 1;
    const next = Math.round(Math.max(LABEL_SCALE_MIN, Math.min(LABEL_SCALE_MAX, current + LABEL_SCALE_STEP * direction)) * 10) / 10;
    return next === current ? null : { labelScale: next };
  });
  updateCanvasRender();
}

function endEdgeAdjust(): void {
  const box = edgeAdjustBox();
  const changed = edgeAdjustChanged;
  edgeAdjust = null;
  edgeAdjustBoxId = null;
  edgeAdjustChanged = false;
  renderCanvas.classList.remove("is-interacting");
  if (box && changed) {
    appState.updateBox(box.id, { rect: box.rect }, true);
  }
  syncDrawCursor();
  updateCanvasRender();
}

/** 黒塗追加中は、手で引いた黒塗りの両端に長さ調整のつまみを出す。 */
function drawManualEdgeHandles(ctx: CanvasRenderingContext2D): void {
  const state = appState.getState();
  if (state.mode !== "draw") return;
  const zoom = Math.max(0.5, state.zoom);
  const radius = Math.max(4.5, 7 / zoom);
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#0284c7";
  ctx.lineWidth = Math.max(1.5, 2.2 / zoom);
  for (const box of state.boxes) {
    if (!box.isManual) continue;
    const { x, y, width, height } = box.rect;
    for (const cx of [x, x + width]) {
      ctx.beginPath();
      ctx.arc(cx, y + height / 2, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 行が見つからない場所に引く線の太さ。検出した文字行の高さの中央値に合わせる。 */
function typicalLineHeight(): number {
  const heights = (lastOcrResult?.lines ?? [])
    .map((line) => line.bbox.y1 - line.bbox.y0)
    .filter((h) => h > 4)
    .sort((a, b) => a - b);
  if (heights.length > 0) return heights[Math.floor(heights.length / 2)] + 4;
  return Math.max(16, Math.round(renderCanvas.height * 0.022));
}

/** 線は指の上下のぶれを無視し、引き始めた行に沿わせる。四角で囲むときだけ縦横に広げる。 */
function updateManualStroke(x: number, y: number): void {
  currentSnapResult = null;
  activeSnappedLine = null;

  if (isRectDrawing) {
    currentDrawRect = {
      x: Math.min(drawStartX, x),
      y: Math.min(drawStartY, y),
      width: Math.abs(x - drawStartX),
      height: Math.abs(y - drawStartY)
    };
    updateCanvasRender();
    return;
  }

  const state = appState.getState();
  if (state.lineSnapEnabled && lastOcrResult && lastOcrResult.lines.length > 0) {
    const snap = calculateLineSnap(
      lastOcrResult.lines,
      { x: drawStartX, y: drawStartY },
      { x, y: drawStartY },
      currentLineSnapOptions()
    );
    if (snap.isSnapped) {
      currentSnapResult = snap;
      activeSnappedLine = snap.matchedLine;
      currentDrawRect = snap.rect;
      updateCanvasRender();
      return;
    }
  }

  const height = typicalLineHeight();
  currentDrawRect = {
    x: Math.min(drawStartX, x),
    y: Math.max(0, drawStartY - height / 2),
    width: Math.abs(x - drawStartX),
    height
  };
  updateCanvasRender();
}

function beginDrawGesture(clientX: number, clientY: number, x: number, y: number): void {
  cancelDrawGesture();
  stopPanInertia();
  isDrawing = false;
  isRectDrawing = false;
  drawGesture = { clientX, clientY, x, y, timer: window.setTimeout(armRectDraw, LONG_PRESS_MS) };
}

function cancelDrawGesture(): void {
  if (drawGesture?.timer) clearTimeout(drawGesture.timer);
  drawGesture = null;
}

/** 長押しで、アイコンや写真を四角で囲むモードに切り替える。 */
function armRectDraw(): void {
  const gesture = drawGesture;
  if (!gesture) return;
  drawGesture = null;
  dismissBoxEditor();
  isDrawing = true;
  isRectDrawing = true;
  drawStartX = gesture.x;
  drawStartY = gesture.y;
  currentDrawRect = { x: gesture.x, y: gesture.y, width: 0, height: 0 };
  currentSnapResult = null;
  activeSnappedLine = null;
  navigator.vibrate?.(15);
  showToast("四角で囲みます。そのまま指を動かしてください", 2000);
  updateCanvasRender();
}

/** 動いた向きで操作を決める。縦にさっと動かせばスクロール、横なら線を引くか端を調整する。 */
function resolveDrawGesture(clientX: number, clientY: number): void {
  const gesture = drawGesture;
  if (!gesture) return;
  const dx = clientX - gesture.clientX;
  const dy = clientY - gesture.clientY;
  if (Math.hypot(dx, dy) < GESTURE_SLOP_PX) return;
  cancelDrawGesture();

  if (Math.abs(dy) > Math.abs(dx)) {
    dismissBoxEditor();
    beginPan(gesture.clientX, gesture.clientY);
    return;
  }

  const edge = manualEdgeAt(gesture.x, gesture.y);
  if (edge) {
    if (appState.getState().selectedBoxId !== edge.box.id) dismissBoxEditor();
    beginEdgeAdjust(edge.edge, edge.box);
    return;
  }

  dismissBoxEditor();
  isDrawing = true;
  isRectDrawing = false;
  drawStartX = gesture.x;
  drawStartY = gesture.y;
}

/** 動かさずに離したときはタップ。黒塗りの上なら項目設定を開く。 */
function endDrawGesture(): void {
  const gesture = drawGesture;
  if (!gesture) return;
  cancelDrawGesture();
  const box = findBoxAtPosition(appState.getState().boxes, gesture.x, gesture.y);
  if (box) openBoxEditor(box);
  else dismissBoxEditor();
}

/** 線を足す。同じ行で重なる手動の黒塗りがあれば、それを広げて1本にまとめる。 */
function commitManualStroke(
  rect: { x: number; y: number; width: number; height: number },
  snap: SnapResult | null
): void {
  const joined = appState.getState().boxes.filter(
    (box) => box.isManual && rectsShareRedactionLine(box.rect, rect, STROKE_JOIN_GAP)
  );
  if (joined.length === 0) {
    appState.addManualBox(rect, rotationForManualStroke(snap), false);
    return;
  }
  const merged = joined.reduce((acc, box) => extendRectOnSameLine(acc, box.rect), rect);
  appState.mergeBoxes(joined[0].id, merged, joined.slice(1).map((box) => box.id));
}

function finishManualStroke(): void {
  const rect = currentDrawRect;
  const asRect = isRectDrawing;
  isDrawing = false;
  isRectDrawing = false;
  if (rect && rect.width >= 5 && rect.height >= 5) {
    if (asRect) appState.addManualBox(rect, undefined, false);
    else commitManualStroke(rect, currentSnapResult);
  }
  currentDrawRect = null;
  currentSnapResult = null;
  activeSnappedLine = null;
  updateCanvasRender();
  refreshRedactedTextPreview();
  syncDrawCursor();
}

/** 指が離れずに操作が打ち切られたとき（着信など）。引きかけの線は捨てる。 */
function abortCanvasGesture(): void {
  cancelDrawGesture();
  shapeGesture = null;
  if (edgeAdjust) endEdgeAdjust();
  isDrawing = false;
  isRectDrawing = false;
  isPanning = false;
  currentDrawRect = null;
  currentSnapResult = null;
  activeSnappedLine = null;
  renderCanvas.classList.remove("is-interacting");
  syncDrawCursor();
  updateCanvasRender();
}

/**
 * UI表示（統計・リスト・ボタン状態）の同期
 */
function syncUiWithState(state: AppState): void {
  syncMultiSelectHint(state);
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
  const selectOn = state.mode === "select";
  const drawOn = state.mode === "draw";
  const shapeOn = state.mode === "shape";
  toolShapeMode?.classList.toggle("active", shapeOn);
  toolShapeMode?.setAttribute("aria-pressed", shapeOn ? "true" : "false");
  btnMobileShape?.classList.toggle("active", shapeOn);
  btnMobileShape?.setAttribute("aria-pressed", shapeOn ? "true" : "false");
  if (shapeBar) shapeBar.hidden = !(shapeOn && state.sourceImage);
  if (btnShapeDelete) btnShapeDelete.disabled = !state.selectedAnnotationId;
  toolSelectMode.classList.toggle("active", selectOn);
  toolDrawMode.classList.toggle("active", drawOn);
  toolSelectMode.setAttribute("aria-pressed", selectOn ? "true" : "false");
  toolDrawMode.setAttribute("aria-pressed", drawOn ? "true" : "false");
  btnMobileSelect?.classList.toggle("active", selectOn);
  btnMobileDraw?.classList.toggle("active", drawOn);
  btnMobileSelect?.setAttribute("aria-pressed", selectOn ? "true" : "false");
  btnMobileDraw?.setAttribute("aria-pressed", drawOn ? "true" : "false");
  const hintAdd = !!state.sourceImage && !drawOn;
  toolDrawMode.classList.toggle("add-hint", hintAdd);
  btnMobileDraw?.classList.toggle("add-hint", hintAdd);

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
      badge.textContent = box.label || "文字なし";

      const textSpan = document.createElement("span");
      textSpan.textContent = box.text ? `"${box.text}"` : box.reason;

      left.appendChild(badge);
      left.appendChild(textSpan);

      const statusSpan = document.createElement("span");
      statusSpan.style.fontSize = "0.75rem";
      const needsReview = box.enabled && typeof box.confidence === "number" && box.confidence < 0.45;
      statusSpan.textContent = box.enabled ? (needsReview ? "要確認" : "保護") : "解除";
      statusSpan.style.color = box.enabled
        ? (needsReview ? "#f59e0b" : "var(--primary-light)")
        : "var(--accent-rose)";

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
      if (appState.getState().sourceImage && lastOcrResult) {
        void startAnalysis(true);
      }
    });
    customTagsList.appendChild(tag);
  });

  // 伏字テキストプレビューの同期
  refreshRedactedTextPreview();

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
  showToast("撮影しました。黒塗追加から線を引けます", 3500);

  const dataUrl = capCanvas.toDataURL("image/png");
  const img = new Image();
  img.onload = async () => {
    await ingestCapturedImage(img);
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
    cancelDrawGesture();
    appState.setSelectedAnnotationId(null);
    appState.setMode("select");
    syncDrawCursor();
  });
  // 黒塗追加は選択/移動に切り替えるまで続く。項目の設定は、引いた黒塗りをタップしてから。
  toolDrawMode.addEventListener("click", () => {
    const wasDrawing = appState.getState().mode === "draw";
    dismissBoxEditor();
    appState.setSelectedAnnotationId(null);
    appState.setMode("draw");
    syncDrawCursor();
    if (!wasDrawing && !drawHintShown && appState.getState().sourceImage) {
      drawHintShown = true;
      showToast("文字を横になぞって黒塗り。縦にさっと動かすとスクロール、長押しで四角く囲めます", 4000);
    }
  });
  btnMobileSelect?.addEventListener("click", () => toolSelectMode.click());
  btnMobileDraw?.addEventListener("click", () => toolDrawMode.click());

  multiSelectHint?.querySelectorAll(".msh-key").forEach((key) => { key.textContent = MULTI_SELECT_KEY; });
  if (popoverMultiHint) {
    popoverMultiHint.textContent = `${MULTI_SELECT_KEY} + クリックで複数選択、${MULTI_SELECT_KEY} + ドラッグで範囲選択できます。`;
  }
  btnMultiSelectHintClose?.addEventListener("click", markMultiSelectHintDone);

  // 図形モード：矢印・丸・四角を描く。黒塗りとは別に、上に重ねて書き出される。
  toolShapeMode?.addEventListener("click", () => {
    cancelDrawGesture();
    dismissBoxEditor();
    appState.setMode("shape");
    syncShapeBar();
    syncDrawCursor();
    if (!shapeHintShown && appState.getState().sourceImage) {
      shapeHintShown = true;
      showToast("ドラッグで図形を描けます。描いた図形の線を押すと、移動・色の変更・削除ができます", 4000);
    }
  });
  btnMobileShape?.addEventListener("click", () => toolShapeMode?.click());
  shapeBar?.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((btn) =>
    btn.addEventListener("click", () => applyShapeSetting({ kind: btn.dataset.kind as ShapeKind }))
  );
  shapeBar?.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((btn) =>
    btn.addEventListener("click", () => applyShapeSetting({ color: btn.dataset.color }))
  );
  shapeBar?.querySelectorAll<HTMLButtonElement>("[data-width]").forEach((btn) =>
    btn.addEventListener("click", () => applyShapeSetting({ width: btn.dataset.width as ShapeWidthLevel }))
  );
  btnShapeDelete?.addEventListener("click", deleteSelectedAnnotation);

  // 墨消しスタイル切り替え (ドロップダウン)
  if (selectRedactStyle) {
    selectRedactStyle.addEventListener("change", () => {
      appState.setRendererOptions({ style: selectRedactStyle.value as any });
      updateCanvasRender();
    });
  }



  // ポップオーバーのチップ選択。選ぶだけで、反映は「確定」を押したとき。
  if (boxEditorPopover) {
    const chips = boxEditorPopover.querySelectorAll<HTMLButtonElement>(".popover-chip");
    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const label = chip.getAttribute("data-label");
        if (!appState.getState().selectedBoxId || label === null || !popoverCustomLabel) return;
        // 空のラベルは「文字なし（黒塗りのみ）」
        popoverCustomLabel.value = label;
        popoverLabelTouched = true;
        syncPopoverChips(label);
      });
    });

    if (popoverCustomLabel) {
      popoverCustomLabel.addEventListener("input", () => {
        popoverLabelTouched = true;
        syncPopoverChips(popoverCustomLabel.value.trim());
      });
      popoverCustomLabel.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          btnPopoverConfirm.click();
        }
      });
    }

    btnPopoverThinner?.addEventListener("click", () => adjustBoxThickness(-1));
    btnPopoverThicker?.addEventListener("click", () => adjustBoxThickness(1));
    btnPopoverMoveUp?.addEventListener("click", () => moveBoxVertically(-1));
    btnPopoverMoveDown?.addEventListener("click", () => moveBoxVertically(1));
    btnPopoverFontSmaller?.addEventListener("click", () => adjustBoxLabelScale(-1));
    btnPopoverFontLarger?.addEventListener("click", () => adjustBoxLabelScale(1));

    // 保護の一時解除/再適用
    if (btnPopoverToggle) {
      btnPopoverToggle.addEventListener("click", () => {
        const boxes = selectedBoxes();
        if (boxes.length === 0) return;
        // 1件でも保護中なら全件を解除、全件解除済みなら全件を再適用
        const enabled = !boxes.some((box) => box.enabled);
        appState.updateBoxes(boxes.map((box) => box.id), { enabled });
        if (popoverToggleText) {
          popoverToggleText.textContent = enabled ? "保護を一時解除" : "保護を再適用";
        }
        updateCanvasRender();
        refreshRedactedTextPreview();
      });
    }

    if (btnPopoverConfirm) {
      btnPopoverConfirm.addEventListener("click", () => {
        const boxes = selectedBoxes();
        if (boxes.length === 0) return;
        // 入力欄を空にした場合も、そのまま「文字なし（黒塗りのみ）」として確定する
        const typed = popoverCustomLabel?.value.trim() ?? "";
        // 項目がバラバラな一括設定で入力欄に触れていなければ、各黒塗りの項目名はそのまま
        const mixed = new Set(boxes.map((box) => box.label ?? "")).size > 1;
        if (popoverLabelTouched || !mixed) {
          appState.updateBoxes(boxes.map((box) => box.id), (box) =>
            (box.label ?? "") === typed ? null : { label: typed, reason: `ユーザー指定 (${typed || "文字なし"})` }
          );
        }
        showToast(boxes.length > 1 ? `${boxes.length}件の項目を設定しました` : "項目を設定しました");
        closeBoxEditor();
      });
    }

    // 黒塗りの完全削除
    if (btnPopoverDelete) {
      btnPopoverDelete.addEventListener("click", () => {
        const ids = [...appState.getState().selectedBoxIds];
        if (ids.length === 0) return;
        appState.removeBoxes(ids);
        refreshRedactedTextPreview();
        showToast(ids.length > 1 ? `🗑️ ${ids.length}件の黒塗りを削除しました` : "🗑️ 黒塗りを削除しました");
        closeBoxEditor();
      });
    }

    if (btnPopoverClose) {
      btnPopoverClose.addEventListener("click", () => {
        closeBoxEditor();
      });
    }

    // 同じ項目名の黒塗りをまとめて選択（スマホでも複数選択できる入口）
    btnPopoverSelectSame?.addEventListener("click", () => {
      const state = appState.getState();
      const labels = new Set(selectedBoxes().map((box) => box.label ?? ""));
      if (labels.size !== 1) return;
      const label = [...labels][0];
      const ids = state.boxes.filter((box) => (box.label ?? "") === label).map((box) => box.id);
      openSelectionEditor(ids, state.selectedBoxId);
    });
  }

  window.addEventListener("resize", () => {
    if (!boxEditorPopover || boxEditorPopover.style.display === "none") return;
    const state = appState.getState();
    if (state.selectedBoxIds.length > 0) showBoxEditorPopover({ preserveFields: true });
  });

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
    refreshRedactedTextPreview();
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
    refreshRedactedTextPreview();
  });
  btnRedo.addEventListener("click", () => {
    appState.redo();
    refreshRedactedTextPreview();
  });
  btnReset.addEventListener("click", () => {
    if (confirm("現在の画像を閉じて新しく始めますか？")) {
      setSourceImageAndInvalidateAnalysis(null);
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
      setSourceImageAndInvalidateAnalysis(corrected.image);
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
    setSourceImageAndInvalidateAnalysis(deskewed);
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
      setSourceImageAndInvalidateAnalysis(correctedImg);
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
    setSourceImageAndInvalidateAnalysis(rotated);
    startAnalysis();
  });

  btnRotateRight.addEventListener("click", async () => {
    const state = appState.getState();
    if (!state.sourceImage) return;
    showToast("時計回りに90°回転中...");
    const rotated = await rotateImage90(state.sourceImage, true);
    currentPreloadedOcr = undefined;
    currentPreloadedAvatars = undefined;
    setSourceImageAndInvalidateAnalysis(rotated);
    startAnalysis();
  });

  btnAutoEnhance.addEventListener("click", async () => {
    const state = appState.getState();
    if (!state.sourceImage) return;
    showToast("モアレ低減・コントラスト強調を実行中...");
    const enhanced = await enhanceImageForOcr(state.sourceImage);
    currentPreloadedOcr = undefined;
    currentPreloadedAvatars = undefined;
    setSourceImageAndInvalidateAnalysis(enhanced);
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
    setSourceImageAndInvalidateAnalysis(deskewed);
    startAnalysis();
  });

  sliderDeskew.addEventListener("input", () => {
    const angle = parseFloat(sliderDeskew.value);
    deskewValDisplay.textContent = `${angle > 0 ? "+" : ""}${angle}°`;
  });

  // 再解析
  btnReanalyze.addEventListener("click", () => {
    startAnalysis(true);
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
    if (!toggleFollowSlope.checked) {
      currentDetectedDeskewAngle = 0;
      const boxes = appState.getState().boxes;
      if (boxes.some((box) => box.rotation && Math.abs(box.rotation) > 0.1)) {
        appState.setBoxes(boxes.map((box) => ({ ...box, rotation: undefined })));
      }
    }
    if (lastOcrResult && appState.getState().sourceImage) {
      startAnalysis(true);
    }
  });

  // 安全マージン（パディング）スライダー
  sliderPadding.addEventListener("input", () => {
    const val = parseInt(sliderPadding.value, 10);
    paddingValDisplay.textContent = `+${val} px`;
    appState.setFilterOptions({ padding: val });
  });
  sliderPadding.addEventListener("change", () => {
    if (appState.getState().sourceImage) {
      startAnalysis(true);
    }
  });

  // カスタムキーワード追加
  const addKeywordAction = () => {
    const kw = inputCustomKeyword.value.trim();
    if (!kw) return;
    const current = appState.getState().filterOptions.customKeywords;
    if (!current.includes(kw)) {
      appState.setFilterOptions({ customKeywords: [...current, kw] });
      inputCustomKeyword.value = "";
      if (appState.getState().sourceImage && lastOcrResult) {
        showToast(`キーワード「${kw}」を追加し、検出結果へ反映しています`);
        void startAnalysis(true);
      } else {
        showToast(`キーワード「${kw}」を追加しました`);
      }
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
    const exportOptions = getSafeExportRendererOptions(state);
    if (!exportOptions) return;

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
      exportOptions,
      true,
      state.annotations
    );

    const res = await copyCanvasToClipboard(exportCanvas);
    showToast(res.message, 4000);
  });

  btnDownloadImage.addEventListener("click", () => {
    const state = appState.getState();
    if (!state.sourceImage) return;
    const exportOptions = getSafeExportRendererOptions(state);
    if (!exportOptions) return;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = state.sourceImage.width;
    exportCanvas.height = state.sourceImage.height;
    const eCtx = exportCanvas.getContext("2d");
    if (!eCtx) return;

    renderRedactedCanvas(
      eCtx,
      state.sourceImage,
      state.boxes,
      exportOptions,
      true,
      state.annotations
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

    const targetText = generateRedactedText(lastOcrResult, state.boxes).redactedText;

    if (!targetText || targetText.trim().length === 0) {
      showToast("コピー可能なテキストが見つかりませんでした");
      return;
    }

    const promptType = aiPromptSelect?.value || "summary";
    let fullText = targetText;
    if (promptType !== "none") {
      fullText = buildAiPromptWithRedactedText(targetText, promptType);
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(fullText);
      } else {
        throw new Error("clipboard API unsupported");
      }
      if (promptType !== "none") {
        showToast("伏字テキスト＋AI指示文をコピーしました", 3500);
      } else {
        showToast("伏字テキストをコピーしました", 3500);
      }
    } catch {
      // フォールバック
      if (txtRedactedPreview) {
        txtRedactedPreview.value = fullText;
        txtRedactedPreview.focus();
        txtRedactedPreview.select();
        document.execCommand("copy");
        showToast("伏字テキストをコピーしました", 3500);
      } else {
        showToast("クリップボードへのコピーに失敗しました");
      }
    }
  });

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
    stopPanInertia();
    const state = appState.getState();
    if (!state.sourceImage) return;
    appState.setZoom(state.zoom * 1.25);
    applyCanvasTransform();
  });

  btnZoomOut.addEventListener("click", () => {
    stopPanInertia();
    const state = appState.getState();
    if (!state.sourceImage) return;
    appState.setZoom(state.zoom / 1.25);
    applyCanvasTransform();
  });

  btnZoomReset.addEventListener("click", () => {
    stopPanInertia();
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
    stopPanInertia();
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
    stopPanInertia();
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

    if (drawGesture || isDrawing || isPanning || edgeAdjust || shapeGesture) return;

    const { x, y } = getCanvasCoordinates(e);
    if (state.mode === "shape") {
      renderCanvas.style.cursor = annotationAtPoint(x, y) ? "move" : "crosshair";
      return;
    }
    const box = findBoxAtPosition(state.boxes, x, y);
    if (state.mode === "select") {
      const multi = e.ctrlKey || e.metaKey || e.shiftKey;
      renderCanvas.style.cursor = box ? (multi ? "copy" : "pointer") : (multi ? "crosshair" : "grab");
    } else {
      renderCanvas.style.cursor = manualEdgeAt(x, y) ? "ew-resize" : "crosshair";
    }
    if (box) {
      if (state.rendererOptions.activeHoverBoxId !== box.id) {
        appState.setRendererOptions({ activeHoverBoxId: box.id });
        updateCanvasRender();
      }
    } else if (state.rendererOptions.activeHoverBoxId !== null) {
      appState.setRendererOptions({ activeHoverBoxId: null });
      updateCanvasRender();
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
      beginPan(e.clientX, e.clientY);
      return;
    }

    if (e.button !== 0) return;

    const { x, y } = getCanvasCoordinates(e);

    if (state.mode === "select") {
      // Ctrl / Shift を押しながら：クリックで選択に足す/外す、ドラッグで範囲選択
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        e.preventDefault();
        beginSelectGesture(e, x, y);
        return;
      }
      const box = findBoxAtPosition(state.boxes, x, y);
      if (box) {
        openBoxEditor(box);
      } else {
        dismissBoxEditor();
        // ボックス外をクリック＆ドラッグした場合はパン移動を開始
        beginPan(e.clientX, e.clientY);
      }
    } else if (state.mode === "draw") {
      beginDrawGesture(e.clientX, e.clientY, x, y);
    } else if (state.mode === "shape") {
      e.preventDefault();
      beginShapeGesture(x, y);
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

    if (selectGesture) {
      const { x, y } = getCanvasCoordinates(e);
      moveSelectGesture(e.clientX, e.clientY, x, y);
      return;
    }

    if (shapeGesture) {
      const { x, y } = getCanvasCoordinates(e);
      moveShapeGesture(x, y);
      return;
    }

    if (drawGesture) resolveDrawGesture(e.clientX, e.clientY);

    if (edgeAdjust) {
      applyEdgeAdjust(getCanvasCoordinates(e).x);
      return;
    }

    if (isPanning) {
      movePan(e.clientX, e.clientY);
      return;
    }

    if (!isDrawing) return;
    const { x, y } = getCanvasCoordinates(e);
    updateManualStroke(x, y);
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

    if (selectGesture) {
      endSelectGesture();
      return;
    }

    if (shapeGesture) {
      endShapeGesture();
      return;
    }

    if (drawGesture) {
      endDrawGesture();
      return;
    }

    if (edgeAdjust) {
      endEdgeAdjust();
      return;
    }

    if (isPanning) endPan();

    if (!isDrawing) return;
    finishManualStroke();
  });

  // タッチ操作（スマホ対応：ピンチズーム・パン・行スナップ描画）
  renderCanvas.addEventListener("touchstart", (e) => {
    stopPanInertia();
    const state = appState.getState();
    if (!state.sourceImage) return;

    // 2本指ピンチ操作開始（モードに関わらず常にズーム＆パン）
    if (e.touches.length === 2) {
      e.preventDefault();
      cancelDrawGesture();
      if (edgeAdjust) endEdgeAdjust();
      // 1本目の指で描き始めた図形は捨て、動かしていた図形は元の位置に戻す
      if (shapeGesture?.kind === "move" && shapeGesture.moved) {
        const o = shapeGesture.origin;
        appState.updateAnnotation(shapeGesture.id, { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 }, false);
      }
      shapeGesture = null;
      isPinching = true;
      isDrawing = false;
      isRectDrawing = false;
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
          openBoxEditor(box);
        } else {
          dismissBoxEditor();
          // 何もない場所をドラッグした場合はパン移動
          beginPan(touch.clientX, touch.clientY);
        }
      } else if (state.mode === "draw") {
        e.preventDefault();
        beginDrawGesture(touch.clientX, touch.clientY, x, y);
      } else if (state.mode === "shape") {
        e.preventDefault();
        beginShapeGesture(x, y);
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

    if (shapeGesture) {
      e.preventDefault();
      const { x, y } = getCanvasCoordinates(touch);
      moveShapeGesture(x, y);
      return;
    }

    if (drawGesture) {
      e.preventDefault();
      resolveDrawGesture(touch.clientX, touch.clientY);
    }

    if (edgeAdjust) {
      e.preventDefault();
      applyEdgeAdjust(getCanvasCoordinates(touch).x);
      return;
    }

    // 1本指パン移動
    if (isPanning) {
      e.preventDefault();
      movePan(touch.clientX, touch.clientY);
      return;
    }

    // 1本指描画（行スナップ）
    if (!isDrawing) return;
    e.preventDefault();

    const { x, y } = getCanvasCoordinates(touch);
    updateManualStroke(x, y);
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

    if (shapeGesture) {
      endShapeGesture();
      return;
    }

    if (drawGesture) {
      endDrawGesture();
      return;
    }

    if (edgeAdjust) {
      endEdgeAdjust();
      return;
    }

    if (isPanning) endPan();

    if (!isDrawing) return;
    finishManualStroke();
  });

  renderCanvas.addEventListener("touchcancel", () => {
    isPinching = false;
    activeCornerKey = null;
    abortCanvasGesture();
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

  btnHeaderMenu?.addEventListener("click", () => {
    openSheet();
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
  const storageTotalBytes = document.getElementById("storageTotalBytes") as HTMLSpanElement | null;
  const statusOcrCache = document.getElementById("statusOcrCache") as HTMLSpanElement | null;

  const setOcrBadge = (text: string, tone: "ok" | "muted", title: string) => {
    if (!statusOcrCache) return;
    const rgb = tone === "ok" ? "16, 185, 129" : "148, 163, 184";
    statusOcrCache.textContent = text;
    statusOcrCache.title = title;
    statusOcrCache.style.color = tone === "ok" ? "#10b981" : "var(--text-dim)";
    statusOcrCache.style.background = `rgba(${rgb}, 0.15)`;
    statusOcrCache.style.borderColor = `rgba(${rgb}, 0.3)`;
  };

  const updateStorageStats = async () => {
    if (!storageTotalBytes) return;
    storageTotalBytes.textContent = "計算中...";
    const stats = await ModelCacheManager.getCacheStorageStats();
    const mb = (stats.totalBytes / (1024 * 1024)).toFixed(1);
    storageTotalBytes.textContent = `${mb} MB`;

    const ocr = stats.models.ocr;
    if (ocr.isCached) {
      setOcrBadge(`保存済み (${(ocr.sizeBytes / (1024 * 1024)).toFixed(1)} MB)`, "ok",
        `保存済みの言語: ${ocr.languages.join(", ")}。次回以降はダウンロードせずに使います。`);
    } else if (ocr.languages.length > 0) {
      setOcrBadge("一部のみ保存", "muted", `保存済みの言語: ${ocr.languages.join(", ")}。不足分は次回の解析時に取得します。`);
    } else {
      setOcrBadge("未取得", "muted", "画像を解析すると自動で取得し、ブラウザに保存します。");
    }
  };

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
    if (confirm("端末に保存されているOCR言語データを削除しますか？\n（次にアプリを開いて解析するとき、自動で再ダウンロードされます）")) {
      const cleared = await ModelCacheManager.clearAll();
      showToast(cleared ? "🗑️ OCR言語データを削除しました" : "OCR言語データを削除できませんでした");
      await updateStorageStats();
    }
  });
}

// 初期化実行
initEvents();
initPwaAndStorageManager();

