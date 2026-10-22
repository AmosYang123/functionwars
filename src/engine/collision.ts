import { aabbOverlap, segCircle, segShape, segShapeCratered, shapeAabb, type Aabb } from './geometry.ts';
import type { Arena, Bounds, EndReason, Hit, ShotOptions, Trace } from './types.ts';

/** Blast radius of a missile: 2.5% of the arena width (5 units on the battle map). */
export const craterRadius = (b: Bounds) => (b.maxX - b.minX) * 0.025;

/**
 * Walks the sampled path segment by segment and stops at the first exact
 * segment/shape intersection. The shooter never collides with itself.
 */
export function traceShot(arena: Arena, shooterId: string, pts: number[], end: Exclude<EndReason, 'hit'>, opts: ShotOptions = {}): Trace {
  const craters = arena.craters ?? [];
  const obstacles = arena.obstacles.map((o) => ({ o, box: shapeAabb(o.shape) }));
  const reach = opts.reach ?? 1;
  const actors = arena.actors
    .filter((a) => a.id !== shooterId)
    .map((a) => ({ a, r: a.r * reach, box: { minX: a.x - a.r * reach, minY: a.y - a.r * reach, maxX: a.x + a.r * reach, maxY: a.y + a.r * reach } as Aabb }));
  let pierce = opts.pierce ?? 0;
  const drilled: string[] = [];

  let length = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2];
    const ay = pts[i - 1];
    const bx = pts[i];
    const by = pts[i + 1];
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const minY = Math.min(ay, by);
    const maxY = Math.max(ay, by);
    let bestT = Infinity;
    let best: Omit<Hit, 'x' | 'y'> | null = null;
    for (const { o, box } of obstacles) {
      if (drilled.includes(o.id) || !aabbOverlap(box, minX, minY, maxX, maxY)) continue;
      const t = o.solid ? segShape(ax, ay, bx, by, o.shape) : segShapeCratered(ax, ay, bx, by, o.shape, craters);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = { type: 'obstacle', id: o.id };
      }
    }
    for (const { a, r, box } of actors) {
      if (!aabbOverlap(box, minX, minY, maxX, maxY)) continue;
      const t = segCircle(ax, ay, bx, by, a.x, a.y, r);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = { type: 'actor', id: a.id };
      }
    }
    if (best?.type === 'obstacle' && pierce > 0) {
      // Drill: this obstacle no longer exists for this shot. Re-check the same segment past it.
      pierce--;
      drilled.push(best.id);
      i -= 2;
      continue;
    }
    const segLen = Math.hypot(bx - ax, by - ay);
    if (best) {
      const hx = ax + (bx - ax) * bestT;
      const hy = ay + (by - ay) * bestT;
      return {
        pts: [...pts.slice(0, i), hx, hy],
        hit: { ...best, x: hx, y: hy },
        end: 'hit',
        length: length + segLen * bestT,
        ...(drilled.length ? { drilled } : {}),
      };
    }
    length += segLen;
  }
  return { pts, hit: null, end, length, ...(drilled.length ? { drilled } : {}) };
}
