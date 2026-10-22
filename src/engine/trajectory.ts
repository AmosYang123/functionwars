import type { Fn } from './expr.ts';
import type { Bounds, EndReason, Facing, Vec } from './types.ts';

const MAX_DEPTH = 22;
const MAX_POINTS = 200_000;

export type PathResult =
  | { ok: true; pts: number[]; end: Exclude<EndReason, 'hit'> }
  | { ok: false; error: string };

/**
 * Shots live in the shooter's local frame: x is distance in front of the shooter,
 * y is height relative to them. The curve is anchored to the shooter, so the
 * world path is (origin.x + facing·x, origin.y + f(x) − f(0)) for x ≥ 0.
 */
export function computePath(fn: Fn, origin: Vec, facing: Facing, bounds: Bounds): PathResult {
  const y0 = fn(0);
  if (!Number.isFinite(y0)) {
    return { ok: false, error: "Your curve isn't defined at x = 0, where you stand. Shift it so it exists at your position." };
  }
  const g = (x: number) => fn(x) - y0;
  // Sampling scales with the arena: a 40-wide board samples every 0.02, a 200-wide one every 0.1.
  const width = bounds.maxX - bounds.minX;
  const STEP = width / 2000;
  const MAX_SEG = width / 800;
  /** A jump this large between neighbours that can't be refined is a discontinuity. */
  const JUMP = width / 80;
  const pts: number[] = [origin.x, origin.y];
  let lastWx = origin.x;
  let lastWy = origin.y;

  // Returns true when the shot left the arena (clipped point already pushed).
  const emit = (x: number, y: number): boolean => {
    const wx = origin.x + facing * x;
    const wy = origin.y + y;
    if (wx < bounds.minX || wx > bounds.maxX || wy < bounds.minY || wy > bounds.maxY) {
      const t = clipT(lastWx, lastWy, wx, wy, bounds);
      pts.push(lastWx + (wx - lastWx) * t, lastWy + (wy - lastWy) * t);
      return true;
    }
    pts.push(wx, wy);
    lastWx = wx;
    lastWy = wy;
    return false;
  };

  const seg = (x0: number, y0s: number, x1: number, y1: number, depth: number): Exclude<EndReason, 'hit'> | null => {
    const bad = !Number.isFinite(y1);
    if (bad || Math.hypot(x1 - x0, y1 - y0s) > MAX_SEG) {
      if (depth >= MAX_DEPTH) {
        if (bad) return 'undefined';
        if (Math.abs(y1 - y0s) > JUMP) return 'asymptote';
        return emit(x1, y1) ? 'bounds' : null;
      }
      const xm = (x0 + x1) / 2;
      const ym = g(xm);
      return seg(x0, y0s, xm, ym, depth + 1) ?? seg(xm, ym, x1, y1, depth + 1);
    }
    return emit(x1, y1) ? 'bounds' : null;
  };

  const maxRange = bounds.maxX - bounds.minX + 1;
  let x = 0;
  let y = 0;
  for (let i = 1; x < maxRange; i++) {
    const nx = Math.min(i * STEP, maxRange);
    const ny = g(nx);
    const end = seg(x, y, nx, ny, 0);
    if (end) return { ok: true, pts, end };
    if (pts.length > MAX_POINTS) return { ok: true, pts, end: 'range' };
    x = nx;
    y = ny;
  }
  return { ok: true, pts, end: 'range' };
}

function clipT(ax: number, ay: number, bx: number, by: number, b: Bounds): number {
  let t = 1;
  const dx = bx - ax;
  const dy = by - ay;
  if (bx < b.minX) t = Math.min(t, (b.minX - ax) / dx);
  if (bx > b.maxX) t = Math.min(t, (b.maxX - ax) / dx);
  if (by < b.minY) t = Math.min(t, (b.minY - ay) / dy);
  if (by > b.maxY) t = Math.min(t, (b.maxY - ay) / dy);
  return Math.max(0, t);
}

export function pathLength(pts: number[]): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return len;
}

/** Thin a dense path for drawing or the network, keeping both endpoints. */
export function decimate(pts: number[], minGap = 0.08): number[] {
  if (pts.length <= 4) return pts.slice();
  const out = [pts[0], pts[1]];
  let lx = pts[0];
  let ly = pts[1];
  for (let i = 2; i < pts.length - 2; i += 2) {
    if (Math.hypot(pts[i] - lx, pts[i + 1] - ly) >= minGap) {
      out.push(pts[i], pts[i + 1]);
      lx = pts[i];
      ly = pts[i + 1];
    }
  }
  out.push(pts[pts.length - 2], pts[pts.length - 1]);
  return out;
}
