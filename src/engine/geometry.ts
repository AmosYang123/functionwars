import type { Crater, Shape, Vec } from './types.ts';

export interface Aabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function shapeAabb(s: Shape): Aabb {
  if (s.kind === 'circle') return { minX: s.x - s.r, minY: s.y - s.r, maxX: s.x + s.r, maxY: s.y + s.r };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of s.pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function shapeCenter(s: Shape): Vec {
  if (s.kind === 'circle') return { x: s.x, y: s.y };
  const b = shapeAabb(s);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Earliest t in [0,1] where segment a→b touches the circle, or -1. */
export function segCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number {
  const fx = ax - cx;
  const fy = ay - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const dx = bx - ax;
  const dy = by - ay;
  const a = dx * dx + dy * dy;
  if (a === 0) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

/** t along a→b where it crosses segment c→d, or -1. */
export function segSeg(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (den === 0) return -1;
  const qx = cx - ax;
  const qy = cy - ay;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

export function pointInPoly(x: number, y: number, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function segPoly(ax: number, ay: number, bx: number, by: number, pts: Vec[]): number {
  if (pointInPoly(ax, ay, pts)) return 0;
  let best = -1;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const t = segSeg(ax, ay, bx, by, pts[j].x, pts[j].y, pts[i].x, pts[i].y);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

/** Both t in [0,1] where segment a→b crosses the circle's edge. */
function segCircleAll(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number[] {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;
  if (a === 0) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const q = Math.sqrt(disc);
  return [(-b - q) / (2 * a), (-b + q) / (2 * a)].filter((t) => t >= 0 && t <= 1);
}

function segShapeAll(ax: number, ay: number, bx: number, by: number, s: Shape): number[] {
  if (s.kind === 'circle') return segCircleAll(ax, ay, bx, by, s.x, s.y, s.r);
  const out: number[] = [];
  for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
    const t = segSeg(ax, ay, bx, by, s.pts[j].x, s.pts[j].y, s.pts[i].x, s.pts[i].y);
    if (t >= 0) out.push(t);
  }
  return out;
}

export function pointInShape(x: number, y: number, s: Shape): boolean {
  return s.kind === 'circle' ? (x - s.x) ** 2 + (y - s.y) ** 2 <= s.r * s.r : pointInPoly(x, y, s.pts);
}

const inCrater = (x: number, y: number, craters: Crater[]) => craters.some((c) => (x - c.x) ** 2 + (y - c.y) ** 2 < c.r * c.r);

/**
 * Earliest t where segment a→b enters the solid part of a shape that has
 * craters blasted out of it, or -1. Exact: every crossing of the shape edge
 * and of each crater edge is a candidate, checked just past the crossing.
 */
export function segShapeCratered(ax: number, ay: number, bx: number, by: number, s: Shape, craters: Crater[]): number {
  if (craters.length === 0) return segShape(ax, ay, bx, by, s);
  const solidAt = (t: number) => {
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    return pointInShape(x, y, s) && !inCrater(x, y, craters);
  };
  if (solidAt(0)) return 0;
  const ts = [...segShapeAll(ax, ay, bx, by, s), ...craters.flatMap((c) => segCircleAll(ax, ay, bx, by, c.x, c.y, c.r))].sort((p, q) => p - q);
  for (const t of ts) if (solidAt(Math.min(1, t + 1e-7))) return t;
  return -1;
}

/** Is any part of the shape left outside the craters? (Sampled; only used to drop fully blasted obstacles.) */
export function shapeHasSolid(s: Shape, craters: Crater[]): boolean {
  if (craters.length === 0) return true;
  const b = shapeAabb(s);
  const n = 14;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = b.minX + ((b.maxX - b.minX) * i) / n;
      const y = b.minY + ((b.maxY - b.minY) * j) / n;
      if (pointInShape(x, y, s) && !inCrater(x, y, craters)) return true;
    }
  }
  return false;
}

export function segShape(ax: number, ay: number, bx: number, by: number, s: Shape): number {
  return s.kind === 'circle' ? segCircle(ax, ay, bx, by, s.x, s.y, s.r) : segPoly(ax, ay, bx, by, s.pts);
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a point to the shape's boundary; negative when inside. */
export function distToShape(px: number, py: number, s: Shape): number {
  if (s.kind === 'circle') return Math.hypot(px - s.x, py - s.y) - s.r;
  let d = Infinity;
  for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
    d = Math.min(d, distToSeg(px, py, s.pts[j].x, s.pts[j].y, s.pts[i].x, s.pts[i].y));
  }
  return pointInPoly(px, py, s.pts) ? -d : d;
}

export function aabbOverlap(a: Aabb, minX: number, minY: number, maxX: number, maxY: number): boolean {
  return a.minX <= maxX && a.maxX >= minX && a.minY <= maxY && a.maxY >= minY;
}

// ---- shape builders (used by map generation, practice and lessons) ----

export function rectPoly(cx: number, cy: number, w: number, h: number, angle = 0): Shape {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  return { kind: 'poly', pts: corners.map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c })) };
}

/** Axis-aligned rectangle from its edges. */
export function boxPoly(x0: number, y0: number, x1: number, y1: number): Shape {
  return rectPoly((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0));
}

export function trianglePoly(cx: number, cy: number, size: number, angle = 0): Shape {
  const pts: Vec[] = [];
  for (let i = 0; i < 3; i++) {
    const a = angle + Math.PI / 2 + (i * 2 * Math.PI) / 3;
    pts.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) });
  }
  return { kind: 'poly', pts };
}

export function starPoly(cx: number, cy: number, outer: number, inner: number, points = 5, angle = 0): Shape {
  const pts: Vec[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = angle + Math.PI / 2 + (i * Math.PI) / points;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return { kind: 'poly', pts };
}
