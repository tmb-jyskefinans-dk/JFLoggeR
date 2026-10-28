// electron/island.ts — pure geometry helpers for the dynamic island window (no Electron imports).

export type WindowMode = 'compact' | 'expanded' | 'detached';
export type PointerDragKind = 'move' | 'resize-e' | 'resize-s' | 'resize-se';
export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

// Heights include 2px below the pill for the light-theme hairline outline.
export const COMPACT_SIZE: Size = { width: 548, height: 62 };
export const IDLE_SIZE: Size = { width: 204, height: 32 };
export const EXPANDED_WIDTH = 800;
export const EXPANDED_DEFAULT_HEIGHT = 560;
export const EXPANDED_MIN_HEIGHT = 220;
export const DOCK_TOP_MARGIN = 0;
export const DEFAULT_DETACHED_SIZE: Size = { width: 1280, height: 820 };
export const MIN_DETACHED_SIZE: Size = { width: 760, height: 480 };
export const DETACH_DRAG_THRESHOLD = 64;
export const SNAP_TOP_THRESHOLD = 16;
const CENTER_MAGNET = 0.02;

export function isDockedMode(mode: WindowMode): boolean {
  return mode !== 'detached';
}

export function compactSize(pendingCount: number): Size {
  return pendingCount > 0 ? COMPACT_SIZE : IDLE_SIZE;
}

/** `centerRatio` is the island's horizontal center as a fraction of the dock area width. */
export function computeDockedBounds(area: Rect, size: Size, centerRatio = 0.5): Rect {
  const width = Math.max(1, Math.min(Math.round(size.width), area.width));
  const height = Math.max(1, Math.min(Math.round(size.height), area.height - DOCK_TOP_MARGIN));
  const ratio = Number.isFinite(centerRatio) ? Math.min(1, Math.max(0, centerRatio)) : 0.5;
  const x = Math.round(area.x + area.width * ratio - width / 2);
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - width),
    y: area.y + DOCK_TOP_MARGIN,
    width,
    height
  };
}

/** Inverse of computeDockedBounds; snaps to the exact center when dropped close to it. */
export function dockRatioFromBounds(area: Rect, bounds: Pick<Rect, 'x' | 'width'>): number {
  if (!(area.width > 0)) return 0.5;
  const ratio = Math.min(1, Math.max(0, (bounds.x + bounds.width / 2 - area.x) / area.width));
  return Math.abs(ratio - 0.5) <= CENTER_MAGNET ? 0.5 : ratio;
}

export function clampDockedX(area: Rect, x: number, width: number): number {
  return Math.min(Math.max(Math.round(x), area.x), area.x + Math.max(0, area.width - width));
}

export function clampToWorkArea(bounds: Rect, workArea: Rect): Rect {
  const width = Math.min(Math.round(bounds.width), workArea.width);
  const height = Math.min(Math.round(bounds.height), workArea.height);
  const x = Math.min(Math.max(Math.round(bounds.x), workArea.x), workArea.x + workArea.width - width);
  const y = Math.min(Math.max(Math.round(bounds.y), workArea.y), workArea.y + workArea.height - height);
  return { x, y, width, height };
}

/** True when a detached window has been dragged up against the top-center of its display. */
export function shouldSnapToDock(bounds: Rect, workArea: Rect, threshold = SNAP_TOP_THRESHOLD): boolean {
  const nearTop = bounds.y - workArea.y <= threshold;
  const centerX = bounds.x + bounds.width / 2;
  const workCenterX = workArea.x + workArea.width / 2;
  const nearCenter = Math.abs(centerX - workCenterX) <= workArea.width * 0.15;
  return nearTop && nearCenter;
}

export function shouldDetachFromDrag(dy: number, threshold = DETACH_DRAG_THRESHOLD): boolean {
  return dy >= threshold;
}

/** Places a detached window so its top-center sits under the cursor where the island was dropped. */
export function detachedBoundsAtCursor(cursor: { x: number; y: number }, size: Size, workArea: Rect): Rect {
  return clampToWorkArea(
    { x: cursor.x - size.width / 2, y: cursor.y - 24, width: size.width, height: size.height },
    workArea
  );
}

export function isUsableRect(value: unknown): value is Rect {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k] as number))
    && (r['width'] as number) > 0 && (r['height'] as number) > 0;
}

export function resizeFromDrag(start: Rect, kind: PointerDragKind, dx: number, dy: number, min: Size = MIN_DETACHED_SIZE): Rect {
  const width = kind === 'resize-e' || kind === 'resize-se' ? Math.max(min.width, start.width + dx) : start.width;
  const height = kind === 'resize-s' || kind === 'resize-se' ? Math.max(min.height, start.height + dy) : start.height;
  return { x: start.x, y: start.y, width: Math.round(width), height: Math.round(height) };
}
