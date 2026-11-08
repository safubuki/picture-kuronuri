import { type RedactBox, type RedactionFilterOptions, DEFAULT_FILTER_OPTIONS } from "../engine/redactionEngine";
import { type CanvasRendererOptions, DEFAULT_RENDERER_OPTIONS } from "../engine/canvasRenderer";
import type { Annotation } from "../engine/annotations";

export type InteractionMode = "select" | "draw" | "shape" | "compare";

/** 戻す/やり直しの1段。黒塗りと図形をいっしょに記録する。 */
export interface HistorySnapshot {
  boxes: RedactBox[];
  annotations: Annotation[];
}

export interface AppState {
  sourceImage: HTMLImageElement | null;
  boxes: RedactBox[];
  /** 矢印・丸・四角などの注釈図形。黒塗りの上に描く。 */
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  history: HistorySnapshot[];
  historyIndex: number;
  filterOptions: RedactionFilterOptions;
  rendererOptions: CanvasRendererOptions;
  mode: InteractionMode;
  isAnalyzing: boolean;
  progressText: string;
  progressPercent: number;
  isComparing: boolean;
  zoom: number;
  panX: number;
  panY: number;
  lineSnapEnabled: boolean;
  /** 編集パネルの基準になる黒塗り。複数選択中も、そのうちの一つを指す。 */
  selectedBoxId: string | null;
  /** 選択中の黒塗りすべて（selectedBoxId を含む）。2件以上なら一括設定。 */
  selectedBoxIds: string[];
}

export const initialState: AppState = {
  sourceImage: null,
  boxes: [],
  annotations: [],
  selectedAnnotationId: null,
  history: [],
  historyIndex: -1,
  filterOptions: { ...DEFAULT_FILTER_OPTIONS },
  rendererOptions: { ...DEFAULT_RENDERER_OPTIONS },
  mode: "select",
  isAnalyzing: false,
  progressText: "",
  progressPercent: 0,
  isComparing: false,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  lineSnapEnabled: true,
  selectedBoxId: null,
  selectedBoxIds: []
};

export class StateManager {
  private state: AppState;
  private listeners: ((state: AppState) => void)[] = [];

  constructor() {
    this.state = { ...initialState };
  }

  public getState(): AppState {
    return this.state;
  }

  public subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  public setSourceImage(img: HTMLImageElement | null): void {
    this.state.sourceImage = img;
    this.state.boxes = [];
    this.state.annotations = [];
    this.state.selectedAnnotationId = null;
    // 何もない状態を最初の1段にしておき、最初に描いた線や図形も「戻す」で消せるようにする
    this.state.history = img ? [{ boxes: [], annotations: [] }] : [];
    this.state.historyIndex = img ? 0 : -1;
    this.state.zoom = 1.0;
    this.state.panX = 0;
    this.state.panY = 0;
    this.state.selectedBoxId = null;
    this.state.selectedBoxIds = [];
    this.notify();
  }

  public setSelectedBoxId(boxId: string | null): void {
    const ids = boxId ? [boxId] : [];
    if (this.state.selectedBoxId === boxId && this.state.selectedBoxIds.length === ids.length) return;
    this.state.selectedBoxId = boxId;
    this.state.selectedBoxIds = ids;
    this.notify();
  }

  /** 複数の黒塗りを選ぶ。anchorId は編集パネルの基準（省略時は最後の1件）。 */
  public setSelection(ids: string[], anchorId?: string | null): void {
    const existing = new Set(this.state.boxes.map((b) => b.id));
    const unique = [...new Set(ids)].filter((id) => existing.has(id));
    const anchor = anchorId && unique.includes(anchorId) ? anchorId : (unique[unique.length - 1] ?? null);
    const same =
      anchor === this.state.selectedBoxId &&
      unique.length === this.state.selectedBoxIds.length &&
      unique.every((id, i) => id === this.state.selectedBoxIds[i]);
    if (same) return;
    this.state.selectedBoxId = anchor;
    this.state.selectedBoxIds = unique;
    this.notify();
  }

  /** 消えた黒塗りを選択から外す。 */
  private pruneSelection(): void {
    const existing = new Set(this.state.boxes.map((b) => b.id));
    const ids = this.state.selectedBoxIds.filter((id) => existing.has(id));
    this.state.selectedBoxIds = ids;
    if (!this.state.selectedBoxId || !existing.has(this.state.selectedBoxId)) {
      this.state.selectedBoxId = ids[ids.length - 1] ?? null;
    }
  }

  public updateBox(boxId: string, updates: Partial<RedactBox>, recordHistory = true): void {
    const nextBoxes = this.state.boxes.map((b) => {
      if (b.id === boxId) {
        return { ...b, ...updates };
      }
      return b;
    });
    this.state.boxes = nextBoxes;
    if (recordHistory) this.pushHistory();
    this.notify();
  }

  /** 複数の黒塗りをまとめて変更する。戻すは1回で全部元に戻る。 */
  public updateBoxes(
    boxIds: string[],
    updates: Partial<RedactBox> | ((box: RedactBox) => Partial<RedactBox> | null),
    recordHistory = true
  ): void {
    const ids = new Set(boxIds);
    let changed = false;
    const nextBoxes = this.state.boxes.map((b) => {
      if (!ids.has(b.id)) return b;
      const patch = typeof updates === "function" ? updates(b) : updates;
      if (!patch) return b;
      changed = true;
      return { ...b, ...patch };
    });
    if (!changed) return;
    this.state.boxes = nextBoxes;
    if (recordHistory) this.pushHistory();
    this.notify();
  }

  public setAnalyzing(isAnalyzing: boolean, text: string = "", percent: number = 0): void {
    this.state.isAnalyzing = isAnalyzing;
    this.state.progressText = text;
    this.state.progressPercent = percent;
    this.notify();
  }

  public setBoxes(boxes: RedactBox[]): void {
    this.state.boxes = boxes;
    this.state.selectedBoxId = null;
    this.state.selectedBoxIds = [];
    this.pushHistory();
    this.notify();
  }

  public toggleBox(boxId: string): void {
    const nextBoxes = this.state.boxes.map(b => {
      if (b.id === boxId) {
        return { ...b, enabled: !b.enabled };
      }
      return b;
    });
    this.state.boxes = nextBoxes;
    this.pushHistory();
    this.notify();
  }

  public addManualBox(
    rect: { x: number; y: number; width: number; height: number },
    rotation?: number,
    select = true
  ): RedactBox | null {
    // 最小サイズチェック
    if (rect.width < 5 || rect.height < 5) return null;

    // 先に線を引いて、項目はあとからタップして決める。新しい線はいつも「手動」から始める。
    const label = "手動";
    const newBox: RedactBox = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "manual",
      label,
      reason: `ユーザー指定 (${label})`,
      rect,
      rotation,
      enabled: true,
      isManual: true
    };

    const nextBoxes = [...this.state.boxes, newBox];
    this.state.boxes = nextBoxes;
    if (select) {
      this.state.selectedBoxId = newBox.id;
      this.state.selectedBoxIds = [newBox.id];
    }
    this.pushHistory();
    this.notify();
    return newBox;
  }

  /** 一つの黒塗りを広げ、重なった黒塗りを取り除く。戻すは1回で元に戻る。 */
  public mergeBoxes(
    keepId: string,
    rect: { x: number; y: number; width: number; height: number },
    removeIds: string[]
  ): void {
    const remove = new Set(removeIds);
    const nextBoxes = this.state.boxes
      .filter(b => !remove.has(b.id))
      .map(b => (b.id === keepId ? { ...b, rect } : b));
    this.state.boxes = nextBoxes;
    this.pruneSelection();
    this.pushHistory();
    this.notify();
  }

  public removeBox(boxId: string): void {
    this.removeBoxes([boxId]);
  }

  public removeBoxes(boxIds: string[]): void {
    const remove = new Set(boxIds);
    const nextBoxes = this.state.boxes.filter(b => !remove.has(b.id));
    if (nextBoxes.length === this.state.boxes.length) return;
    this.state.boxes = nextBoxes;
    this.pruneSelection();
    this.pushHistory();
    this.notify();
  }

  public clearAllBoxes(): void {
    if (this.state.boxes.length === 0) return;
    this.state.boxes = [];
    this.state.selectedBoxId = null;
    this.state.selectedBoxIds = [];
    this.pushHistory();
    this.notify();
  }

  public setFilterOptions(options: Partial<RedactionFilterOptions>): void {
    this.state.filterOptions = { ...this.state.filterOptions, ...options };
    this.notify();
  }

  public setRendererOptions(options: Partial<CanvasRendererOptions>): void {
    this.state.rendererOptions = { ...this.state.rendererOptions, ...options };
    this.notify();
  }

  public setMode(mode: InteractionMode): void {
    this.state.mode = mode;
    this.notify();
  }

  public setComparing(isComparing: boolean): void {
    this.state.isComparing = isComparing;
    this.notify();
  }

  public setZoom(zoom: number): void {
    this.state.zoom = Math.max(0.4, Math.min(5.0, zoom));
    this.notify();
  }

  public setPan(panX: number, panY: number): void {
    this.state.panX = panX;
    this.state.panY = panY;
    this.notify();
  }

  public setZoomAndPan(zoom: number, panX: number, panY: number): void {
    this.state.zoom = Math.max(0.4, Math.min(5.0, zoom));
    this.state.panX = panX;
    this.state.panY = panY;
    this.notify();
  }

  public resetZoomPan(): void {
    this.state.zoom = 1.0;
    this.state.panX = 0;
    this.state.panY = 0;
    this.notify();
  }

  public setLineSnapEnabled(enabled: boolean): void {
    this.state.lineSnapEnabled = enabled;
    this.notify();
  }

  public toggleLineSnap(): void {
    this.state.lineSnapEnabled = !this.state.lineSnapEnabled;
    this.notify();
  }

  public undo(): void {
    if (this.state.historyIndex > 0) {
      this.state.historyIndex--;
      this.restoreSnapshot(this.state.history[this.state.historyIndex]);
      this.notify();
    }
  }

  public redo(): void {
    if (this.state.historyIndex < this.state.history.length - 1) {
      this.state.historyIndex++;
      this.restoreSnapshot(this.state.history[this.state.historyIndex]);
      this.notify();
    }
  }

  private restoreSnapshot(snapshot: HistorySnapshot): void {
    const copy: HistorySnapshot = JSON.parse(JSON.stringify(snapshot));
    this.state.boxes = copy.boxes;
    this.state.annotations = copy.annotations;
    this.pruneSelection();
    if (this.state.selectedAnnotationId && !copy.annotations.some((a) => a.id === this.state.selectedAnnotationId)) {
      this.state.selectedAnnotationId = null;
    }
  }

  // ---- 注釈図形（矢印・丸・四角） ----

  public addAnnotation(annotation: Annotation, select = true): void {
    this.state.annotations = [...this.state.annotations, annotation];
    if (select) this.state.selectedAnnotationId = annotation.id;
    this.pushHistory();
    this.notify();
  }

  /** recordHistory=false はドラッグ中の途中経過。離したら commitHistory() で1段として残す。 */
  public updateAnnotation(id: string, updates: Partial<Annotation>, recordHistory = true): void {
    let changed = false;
    this.state.annotations = this.state.annotations.map((a) => {
      if (a.id !== id) return a;
      changed = true;
      return { ...a, ...updates };
    });
    if (!changed) return;
    if (recordHistory) this.pushHistory();
    this.notify();
  }

  public removeAnnotation(id: string): void {
    const next = this.state.annotations.filter((a) => a.id !== id);
    if (next.length === this.state.annotations.length) return;
    this.state.annotations = next;
    if (this.state.selectedAnnotationId === id) this.state.selectedAnnotationId = null;
    this.pushHistory();
    this.notify();
  }

  public setSelectedAnnotationId(id: string | null): void {
    if (this.state.selectedAnnotationId === id) return;
    this.state.selectedAnnotationId = id;
    this.notify();
  }

  /** 記録せずに進めた変更（図形のドラッグなど）を、戻す1段として確定する。 */
  public commitHistory(): void {
    this.pushHistory();
    this.notify();
  }

  private pushHistory(): void {
    // 現在の履歴以降を切り捨て
    const nextHistory = this.state.history.slice(0, this.state.historyIndex + 1);
    nextHistory.push(JSON.parse(JSON.stringify({ boxes: this.state.boxes, annotations: this.state.annotations })));
    // 最大30件
    if (nextHistory.length > 30) {
      nextHistory.shift();
    }
    this.state.history = nextHistory;
    this.state.historyIndex = nextHistory.length - 1;
  }
}

export const appState = new StateManager();
