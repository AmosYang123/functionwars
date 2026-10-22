import { distToShape, rectPoly, shapeAabb, starPoly, trianglePoly } from './geometry.ts';
import { between, rng } from './rng.ts';
import type { Bounds, Obstacle, ObstacleKind, Shape, Vec } from './types.ts';

/** Battle arena. Practice challenges use the smaller PRACTICE_BOUNDS they were designed on. */
export const ARENA_BOUNDS: Bounds = { minX: -100, maxX: 100, minY: -60, maxY: 60 };
export const PRACTICE_BOUNDS: Bounds = { minX: -20, maxX: 20, minY: -12, maxY: 12 };
export const PLAYER_RADIUS = 1.6;

export function makeObstacle(id: string, kind: ObstacleKind, shape: Shape, solid = false): Obstacle {
  return { id, kind, shape, solid: solid || undefined };
}

/**
 * k = arena width / 40. Positions scale with k; sizes scale faster (sk) so a big
 * battle map has a few large obstacles with wide lanes, not many small ones.
 */
function randomObstacle(r: () => number, id: string, b: Bounds, k: number): Obstacle {
  const x = between(r, b.minX + 3 * k, b.maxX - 3 * k);
  const y = between(r, b.minY + 2 * k, b.maxY - 2 * k);
  k = 1 + (k - 1) * 2;
  const pick = r();
  if (pick < 0.3) {
    const rad = between(r, 0.8, 2.2) * k;
    return makeObstacle(id, 'boulder', { kind: 'circle', x, y, r: rad });
  }
  if (pick < 0.6) {
    const h = between(r, 2.5, 7) * k;
    const w = between(r, 0.5, 1) * k;
    const angle = r() < 0.6 ? 0 : r() < 0.5 ? Math.PI / 2 : between(r, -0.5, 0.5);
    return makeObstacle(id, 'wall', rectPoly(x, y, w, h, angle));
  }
  if (pick < 0.8) {
    const size = between(r, 1, 2) * k;
    return makeObstacle(id, 'triangle', trianglePoly(x, y, size, between(r, 0, Math.PI)));
  }
  const outer = between(r, 1, 1.8) * k;
  return makeObstacle(id, 'star', starPoly(x, y, outer, outer * 0.45, 5, between(r, 0, Math.PI)));
}

function obstaclesClear(a: Obstacle, list: Obstacle[], gap: number): boolean {
  const ba = shapeAabb(a.shape);
  return list.every((o) => {
    const bb = shapeAabb(o.shape);
    return ba.maxX + gap < bb.minX || bb.maxX + gap < ba.minX || ba.maxY + gap < bb.minY || bb.maxY + gap < ba.minY;
  });
}

function spawnOk(p: Vec, obstacles: Obstacle[], spawns: Vec[], k: number): boolean {
  return (
    obstacles.every((o) => distToShape(p.x, p.y, o.shape) > 1.6 + 0.4 * k) &&
    spawns.every((s) => Math.hypot(s.x - p.x, s.y - p.y) > 8 * k)
  );
}

export interface GeneratedMap {
  bounds: Bounds;
  obstacles: Obstacle[];
  spawns: Vec[];
}

/**
 * Random obstacles, then spawns spread across both halves so every player
 * has someone in front of them. Retries with a derived seed if spawns don't fit.
 */
export function generateMap(seed: number, players: number, bounds = ARENA_BOUNDS): GeneratedMap {
  for (let attempt = 0; attempt < 50; attempt++) {
    const r = rng(seed + attempt * 7919);
    const k = (bounds.maxX - bounds.minX) / 40;
    const count = Math.round(k > 1 ? between(r, 8, 12) : between(r, 9, 14));
    const obstacles: Obstacle[] = [];
    for (let tries = 0; obstacles.length < count && tries < 600; tries++) {
      const o = randomObstacle(r, `o${obstacles.length}`, bounds, k);
      const box = shapeAabb(o.shape);
      const inside = box.minX > bounds.minX + k && box.maxX < bounds.maxX - k && box.minY > bounds.minY + 0.5 * k && box.maxY < bounds.maxY - 0.5 * k;
      if (inside && obstaclesClear(o, obstacles, k > 1 ? 2.4 * k : 1.2)) obstacles.push(o);
    }
    const spawns: Vec[] = [];
    for (let i = 0; i < players; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      let placed = false;
      for (let tries = 0; tries < 300 && !placed; tries++) {
        const p = { x: side * between(r, 6 * k, bounds.maxX - 2 * k), y: between(r, bounds.minY + 2 * k, bounds.maxY - 2 * k) };
        if (spawnOk(p, obstacles, spawns, k)) {
          spawns.push(p);
          placed = true;
        }
      }
      if (!placed) break;
    }
    if (spawns.length === players) return { bounds, obstacles, spawns };
  }
  throw new Error('Could not generate a map');
}
