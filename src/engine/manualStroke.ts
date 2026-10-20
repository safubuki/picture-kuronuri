export interface ManualStrokeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 未確定の黒塗りへ、同じ行の追加ストロークを足せるか。
 * 隣の1文字ぶんは結合し、別の行や大きく離れた区間は別の黒塗りにする。
 */
export function rectsShareRedactionLine(base: ManualStrokeRect, extra: ManualStrokeRect): boolean {
  if (base.width < 1 || base.height < 1 || extra.width < 1 || extra.height < 1) return false;
  if (extra.height > base.height * 2.2 && extra.height > base.height + 14) return false;

  const baseMid = base.y + base.height / 2;
  const extraMid = extra.y + extra.height / 2;
  const tolerance = Math.max(8, Math.min(base.height, extra.height) * 0.7);
  if (Math.abs(baseMid - extraMid) > tolerance) return false;

  const gap = Math.max(base.x, extra.x) - Math.min(base.x + base.width, extra.x + extra.width);
  const maxGap = Math.max(12, Math.max(base.height, extra.height) * 1.6);
  return gap <= maxGap;
}

/** 同じ行の二つの矩形を、一つの黒塗り矩形にまとめる。 */
export function extendRectOnSameLine(base: ManualStrokeRect, extra: ManualStrokeRect): ManualStrokeRect {
  const x = Math.min(base.x, extra.x);
  const y = Math.min(base.y, extra.y);
  const right = Math.max(base.x + base.width, extra.x + extra.width);
  const bottom = Math.max(base.y + base.height, extra.y + extra.height);
  return { x, y, width: right - x, height: bottom - y };
}
