import {
  COMPACT_SIZE,
  IDLE_SIZE,
  compactSize,
  clampToWorkArea,
  clampDockedX,
  computeDockedBounds,
  dockRatioFromBounds,
  detachedBoundsAtCursor,
  isUsableRect,
  resizeFromDrag,
  shouldDetachFromDrag,
  shouldSnapToDock
} from '../island';

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const secondary = { x: 1920, y: 0, width: 2560, height: 1400 };

describe('island geometry', () => {
  test('uses a small notch without missing logs and docks flush to the display top', () => {
    expect(compactSize(0)).toEqual(IDLE_SIZE);
    expect(compactSize(1)).toEqual(COMPACT_SIZE);
    const bounds = computeDockedBounds({ x: -1920, y: -1080, width: 1920, height: 1080 }, compactSize(0));
    expect(bounds.y).toBe(-1080);
    expect(bounds.x + bounds.width / 2).toBe(-960);
    expect(bounds.height).toBe(IDLE_SIZE.height);
  });

  test('docks compact island at top-center of work area', () => {
    const b = computeDockedBounds(workArea, COMPACT_SIZE);
    expect(b.y).toBe(0);
    expect(b.width).toBe(COMPACT_SIZE.width);
    expect(b.x + b.width / 2).toBe(960);
  });

  test('docks on a secondary display offset', () => {
    const b = computeDockedBounds(secondary, { width: 800, height: 500 });
    expect(b.x).toBe(1920 + 880);
    expect(b.y).toBe(0);
  });

  test('caps docked height to the work area', () => {
    const b = computeDockedBounds(workArea, { width: 800, height: 5000 });
    expect(b.height).toBe(1040);
  });

  test('positions along the top edge by center ratio and clamps to the edges', () => {
    expect(computeDockedBounds(workArea, { width: 200, height: 30 }, 0.25).x).toBe(380);
    expect(computeDockedBounds(workArea, { width: 200, height: 30 }, 0).x).toBe(0);
    expect(computeDockedBounds(workArea, { width: 200, height: 30 }, 1).x).toBe(1720);
    expect(computeDockedBounds(workArea, { width: 200, height: 30 }, 0.25).y).toBe(0);
  });

  test('derives ratio from dropped bounds with a center magnet', () => {
    expect(dockRatioFromBounds(workArea, { x: 380, width: 200 })).toBeCloseTo(0.25);
    expect(dockRatioFromBounds(workArea, { x: 870, width: 200 })).toBe(0.5);
    expect(dockRatioFromBounds(secondary, { x: 1920, width: 200 })).toBeCloseTo(100 / 2560);
  });

  test('keeps a dragged island on screen horizontally', () => {
    expect(clampDockedX(workArea, -50, 200)).toBe(0);
    expect(clampDockedX(workArea, 1900, 200)).toBe(1720);
    expect(clampDockedX(workArea, 500, 200)).toBe(500);
  });

  test('snaps to dock only near top-center', () => {
    expect(shouldSnapToDock({ x: 320, y: 4, width: 1280, height: 800 }, workArea)).toBe(true);
    expect(shouldSnapToDock({ x: 320, y: 60, width: 1280, height: 800 }, workArea)).toBe(false);
    expect(shouldSnapToDock({ x: 0, y: 0, width: 600, height: 800 }, workArea)).toBe(false);
  });

  test('detach threshold', () => {
    expect(shouldDetachFromDrag(10)).toBe(false);
    expect(shouldDetachFromDrag(-200)).toBe(false);
    expect(shouldDetachFromDrag(120)).toBe(true);
  });

  test('clamps bounds back onto the work area', () => {
    const b = clampToWorkArea({ x: -400, y: 900, width: 1280, height: 800 }, workArea);
    expect(b).toEqual({ x: 0, y: 240, width: 1280, height: 800 });
  });

  test('places detached window under the cursor', () => {
    const b = detachedBoundsAtCursor({ x: 960, y: 200 }, { width: 1280, height: 800 }, workArea);
    expect(b.x).toBe(320);
    expect(b.y).toBe(176);
  });

  test('validates persisted rects', () => {
    expect(isUsableRect({ x: 1, y: 2, width: 3, height: 4 })).toBe(true);
    expect(isUsableRect({ x: 1, y: 2, width: 0, height: 4 })).toBe(false);
    expect(isUsableRect(null)).toBe(false);
    expect(isUsableRect({ x: '1', y: 2, width: 3, height: 4 })).toBe(false);
  });

  test('resizes from grips with minimum size', () => {
    const start = { x: 100, y: 100, width: 1000, height: 700 };
    expect(resizeFromDrag(start, 'resize-e', 50, 80)).toEqual({ x: 100, y: 100, width: 1050, height: 700 });
    expect(resizeFromDrag(start, 'resize-s', 50, 80)).toEqual({ x: 100, y: 100, width: 1000, height: 780 });
    const shrunk = resizeFromDrag(start, 'resize-se', -900, -900);
    expect(shrunk.width).toBe(760);
    expect(shrunk.height).toBe(480);
  });
});
