import { type RedactBox, type RedactionFilterOptions, DEFAULT_FILTER_OPTIONS } from "../engine/redactionEngine";
import { type CanvasRendererOptions, DEFAULT_RENDERER_OPTIONS } from "../engine/canvasRenderer";

export type InteractionMode = "select" | "draw" | "compare";

export interface AppState {
  sourceImage: HTMLImageElement | null;
  boxes: RedactBox[];
  history: RedactBox[][];
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
  activeDrawLabel: string;
  selectedBoxId: string | null;
}

export const initialState: AppState = {
  sourceImage: null,
  boxes: [],
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
  activeDrawLabel: "メール",
  selectedBoxId: null
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
    this.state.history = [];
    this.state.historyIndex = -1;
    this.state.zoom = 1.0;
    this.state.panX = 0;
    this.state.panY = 0;
    this.state.selectedBoxId = null;
    this.notify();
  }

  public setSelectedBoxId(boxId: string | null): void {
    if (this.state.selectedBoxId === boxId) return;
    this.state.selectedBoxId = boxId;
    this.notify();
  }

  public setActiveDrawLabel(label: string): void {
    this.state.activeDrawLabel = label;
    this.notify();
  }

  public updateBox(boxId: string, updates: Partial<RedactBox>): void {
    const nextBoxes = this.state.boxes.map((b) => {
      if (b.id === boxId) {
        return { ...b, ...updates };
      }
      return b;
    });
    this.state.boxes = nextBoxes;
    this.pushHistory(nextBoxes);
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
    this.pushHistory(boxes);
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
    this.pushHistory(nextBoxes);
    this.notify();
  }

  public addManualBox(
    rect: { x: number; y: number; width: number; height: number },
    rotation?: number
  ): void {
    // 最小サイズチェック
    if (rect.width < 5 || rect.height < 5) return;

    const label = this.state.activeDrawLabel || "メール";
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
    this.state.selectedBoxId = newBox.id;
    this.pushHistory(nextBoxes);
    this.notify();
  }

  public removeBox(boxId: string): void {
    if (this.state.selectedBoxId === boxId) {
      this.state.selectedBoxId = null;
    }
    const nextBoxes = this.state.boxes.filter(b => b.id !== boxId);
    this.state.boxes = nextBoxes;
    this.pushHistory(nextBoxes);
    this.notify();
  }

  public clearAllBoxes(): void {
    if (this.state.boxes.length === 0) return;
    this.state.boxes = [];
    this.state.selectedBoxId = null;
    this.pushHistory([]);
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
      this.state.boxes = JSON.parse(JSON.stringify(this.state.history[this.state.historyIndex]));
      this.notify();
    }
  }

  public redo(): void {
    if (this.state.historyIndex < this.state.history.length - 1) {
      this.state.historyIndex++;
      this.state.boxes = JSON.parse(JSON.stringify(this.state.history[this.state.historyIndex]));
      this.notify();
    }
  }

  private pushHistory(boxes: RedactBox[]): void {
    // 現在の履歴以降を切り捨て
    const nextHistory = this.state.history.slice(0, this.state.historyIndex + 1);
    nextHistory.push(JSON.parse(JSON.stringify(boxes)));
    // 最大30件
    if (nextHistory.length > 30) {
      nextHistory.shift();
    }
    this.state.history = nextHistory;
    this.state.historyIndex = nextHistory.length - 1;
  }
}

export const appState = new StateManager();
