"use strict";
// electron/island.ts — pure geometry helpers for the dynamic island window (no Electron imports).
Object.defineProperty(exports, "__esModule", { value: true });
exports.SNAP_TOP_THRESHOLD = exports.DETACH_DRAG_THRESHOLD = exports.MIN_DETACHED_SIZE = exports.DEFAULT_DETACHED_SIZE = exports.DOCK_TOP_MARGIN = exports.EXPANDED_MIN_HEIGHT = exports.EXPANDED_DEFAULT_HEIGHT = exports.EXPANDED_WIDTH = exports.IDLE_SIZE = exports.COMPACT_SIZE = void 0;
exports.isDockedMode = isDockedMode;
exports.compactSize = compactSize;
exports.computeDockedBounds = computeDockedBounds;
exports.dockRatioFromBounds = dockRatioFromBounds;
exports.clampDockedX = clampDockedX;
exports.clampToWorkArea = clampToWorkArea;
exports.shouldSnapToDock = shouldSnapToDock;
exports.shouldDetachFromDrag = shouldDetachFromDrag;
exports.detachedBoundsAtCursor = detachedBoundsAtCursor;
exports.isUsableRect = isUsableRect;
exports.resizeFromDrag = resizeFromDrag;
// Heights include 2px below the pill for the light-theme hairline outline.
exports.COMPACT_SIZE = { width: 548, height: 62 };
exports.IDLE_SIZE = { width: 204, height: 32 };
exports.EXPANDED_WIDTH = 800;
exports.EXPANDED_DEFAULT_HEIGHT = 560;
exports.EXPANDED_MIN_HEIGHT = 220;
exports.DOCK_TOP_MARGIN = 0;
exports.DEFAULT_DETACHED_SIZE = { width: 1280, height: 820 };
exports.MIN_DETACHED_SIZE = { width: 760, height: 480 };
exports.DETACH_DRAG_THRESHOLD = 64;
exports.SNAP_TOP_THRESHOLD = 16;
const CENTER_MAGNET = 0.02;
function isDockedMode(mode) {
    return mode !== 'detached';
}
function compactSize(pendingCount) {
    return pendingCount > 0 ? exports.COMPACT_SIZE : exports.IDLE_SIZE;
}
/** `centerRatio` is the island's horizontal center as a fraction of the dock area width. */
function computeDockedBounds(area, size, centerRatio = 0.5) {
    const width = Math.max(1, Math.min(Math.round(size.width), area.width));
    const height = Math.max(1, Math.min(Math.round(size.height), area.height - exports.DOCK_TOP_MARGIN));
    const ratio = Number.isFinite(centerRatio) ? Math.min(1, Math.max(0, centerRatio)) : 0.5;
    const x = Math.round(area.x + area.width * ratio - width / 2);
    return {
        x: Math.min(Math.max(x, area.x), area.x + area.width - width),
        y: area.y + exports.DOCK_TOP_MARGIN,
        width,
        height
    };
}
/** Inverse of computeDockedBounds; snaps to the exact center when dropped close to it. */
function dockRatioFromBounds(area, bounds) {
    if (!(area.width > 0))
        return 0.5;
    const ratio = Math.min(1, Math.max(0, (bounds.x + bounds.width / 2 - area.x) / area.width));
    return Math.abs(ratio - 0.5) <= CENTER_MAGNET ? 0.5 : ratio;
}
function clampDockedX(area, x, width) {
    return Math.min(Math.max(Math.round(x), area.x), area.x + Math.max(0, area.width - width));
}
function clampToWorkArea(bounds, workArea) {
    const width = Math.min(Math.round(bounds.width), workArea.width);
    const height = Math.min(Math.round(bounds.height), workArea.height);
    const x = Math.min(Math.max(Math.round(bounds.x), workArea.x), workArea.x + workArea.width - width);
    const y = Math.min(Math.max(Math.round(bounds.y), workArea.y), workArea.y + workArea.height - height);
    return { x, y, width, height };
}
/** True when a detached window has been dragged up against the top-center of its display. */
function shouldSnapToDock(bounds, workArea, threshold = exports.SNAP_TOP_THRESHOLD) {
    const nearTop = bounds.y - workArea.y <= threshold;
    const centerX = bounds.x + bounds.width / 2;
    const workCenterX = workArea.x + workArea.width / 2;
    const nearCenter = Math.abs(centerX - workCenterX) <= workArea.width * 0.15;
    return nearTop && nearCenter;
}
function shouldDetachFromDrag(dy, threshold = exports.DETACH_DRAG_THRESHOLD) {
    return dy >= threshold;
}
/** Places a detached window so its top-center sits under the cursor where the island was dropped. */
function detachedBoundsAtCursor(cursor, size, workArea) {
    return clampToWorkArea({ x: cursor.x - size.width / 2, y: cursor.y - 24, width: size.width, height: size.height }, workArea);
}
function isUsableRect(value) {
    if (!value || typeof value !== 'object')
        return false;
    const r = value;
    return ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]))
        && r['width'] > 0 && r['height'] > 0;
}
function resizeFromDrag(start, kind, dx, dy, min = exports.MIN_DETACHED_SIZE) {
    const width = kind === 'resize-e' || kind === 'resize-se' ? Math.max(min.width, start.width + dx) : start.width;
    const height = kind === 'resize-s' || kind === 'resize-se' ? Math.max(min.height, start.height + dy) : start.height;
    return { x: start.x, y: start.y, width: Math.round(width), height: Math.round(height) };
}
//# sourceMappingURL=island.js.map