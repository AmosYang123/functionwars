import { describe, expect, it } from 'vitest';
import { boxPoly, segPoly } from './geometry.ts';
import { makeObstacle } from './map.ts';
import { planShot } from './shot.ts';
import type { Arena } from './types.ts';

const bounds = { minX: -20, maxX: 20, minY: -12, maxY: 12 };
const arena = (extra: Partial<Arena> = {}): Arena => ({
  bounds,
  obstacles: [],
  actors: [
    { id: 'me', x: -10, y: 0, r: 0.55 },
    { id: 't', x: 10, y: 0, r: 0.6 },
  ],
  ...extra,
});

function ok(r: ReturnType<typeof planShot>) {
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('shots', () => {
  it('start at the shooter even when the function does not pass through it', () => {
    const r = ok(planShot(arena(), 'me', 'x + 7', 1));
    expect(r.trace.pts[0]).toBe(-10);
    expect(r.trace.pts[1]).toBe(0);
    // y = f(x) - f(0): the +7 cancels, the path is the line through the shooter
    expect(r.trace.pts[3]).toBeCloseTo(r.trace.pts[2] + 10, 6);
  });

  it('hits a target straight ahead at its edge', () => {
    const r = ok(planShot(arena(), 'me', '0', 1));
    expect(r.trace.hit).toMatchObject({ type: 'actor', id: 't' });
    expect(r.trace.hit!.x).toBeCloseTo(9.4, 3);
  });

  it('never hits the shooter itself', () => {
    const r = ok(planShot(arena(), 'me', '0', -1));
    expect(r.trace.hit).toBeNull();
    expect(r.trace.end).toBe('bounds');
  });

  it('stops at the first collision when several objects are in line', () => {
    const wall = makeObstacle('w', 'wall', boxPoly(0, -2, 0.6, 2));
    const wall2 = makeObstacle('w2', 'wall', boxPoly(5, -2, 5.6, 2));
    const r = ok(planShot(arena({ obstacles: [wall2, wall] }), 'me', '0', 1));
    expect(r.trace.hit).toMatchObject({ type: 'obstacle', id: 'w' });
    expect(r.trace.hit!.x).toBeCloseTo(0, 6);
  });

  it('reaches a target behind a wall only with a curve over it', () => {
    const wall = makeObstacle('w', 'wall', boxPoly(-0.3, -12, 0.3, 3), true);
    const a = arena({ obstacles: [wall] });
    expect(ok(planShot(a, 'me', '0', 1)).trace.hit?.id).toBe('w');
    // Parabola through (0,0) and (20,0) peaking at local x = 10, height 5
    expect(ok(planShot(a, 'me', '-0.05x^2 + x', 1)).trace.hit?.id).toBe('t');
  });

  it('ends tangent shots at the arena edge before the asymptote', () => {
    const r = ok(planShot(arena(), 'me', 'tan(0.2x)', 1));
    const n = r.trace.pts.length;
    expect(r.trace.end).toBe('bounds');
    expect(r.trace.pts[n - 1]).toBeCloseTo(12, 6);
    expect(r.trace.pts[n - 2]).toBeLessThan(-10 + Math.PI / 0.4);
  });

  it('rejects functions undefined at the shooter, and stops where the domain ends', () => {
    expect(planShot(arena(), 'me', 'ln(x - 1)', 1).ok).toBe(false);
    const r = ok(planShot(arena(), 'me', '2sqrt(4 - x)', 1));
    expect(r.trace.end).toBe('undefined');
    expect(r.trace.pts[r.trace.pts.length - 2]).toBeCloseTo(-6, 3);
  });

  it('cannot tunnel through a thin wall with a fast-wiggling curve', () => {
    const thin = makeObstacle('thin', 'wall', boxPoly(2, -12, 2.01, 12));
    const r = ok(planShot(arena({ obstacles: [thin] }), 'me', '5sin(3x)', 1));
    expect(r.trace.hit?.id).toBe('thin');
  });

  it('flies through a crater but still hits the rest of the wall', () => {
    const wall = makeObstacle('w', 'wall', boxPoly(0, -8, 0.6, 8));
    const a = arena({ obstacles: [wall], craters: [{ x: 0, y: 0, r: 1 }] });
    // Straight through the hole
    expect(ok(planShot(a, 'me', '0', 1)).trace.hit?.id).toBe('t');
    // Above the hole the wall is untouched
    const high = ok(planShot({ ...a, actors: [{ id: 'me', x: -10, y: 3, r: 0.55 }, { id: 't', x: 10, y: 3, r: 0.6 }] }, 'me', '0', 1));
    expect(high.trace.hit).toMatchObject({ id: 'w', x: 0 });
    // A path that enters the hole and exits through its far edge hits inside the wall
    const diag = ok(planShot(a, 'me', '0.09x', 1));
    expect(diag.trace.hit?.id).toBe('w');
    expect(Math.hypot(diag.trace.hit!.x, diag.trace.hit!.y)).toBeCloseTo(1, 3);
  });

  it('ignores craters on unbreakable obstacles', () => {
    const wall = makeObstacle('w', 'wall', boxPoly(0, -8, 0.6, 8), true);
    const a = arena({ obstacles: [wall], craters: [{ x: 0, y: 0, r: 1 }] });
    expect(ok(planShot(a, 'me', '0', 1)).trace.hit?.id).toBe('w');
  });

  it('starting inside a crater is not a hit', () => {
    const wall = makeObstacle('w', 'wall', boxPoly(-11, -1, -9, 1));
    const a = arena({ obstacles: [wall], craters: [{ x: -10, y: 0, r: 1.5 }] });
    expect(ok(planShot(a, 'me', '0', 1)).trace.hit?.id).toBe('t');
  });

  it('collides with concave star shapes exactly', () => {
    // Line through a star's notch between two points should miss; through the body should hit.
    const star = makeObstacle('s', 'star', { kind: 'poly', pts: [{ x: 0, y: 2 }, { x: 0.5, y: 0.5 }, { x: 2, y: 0 }, { x: 0.5, y: -0.5 }, { x: 0, y: -2 }, { x: -0.5, y: -0.5 }, { x: -2, y: 0 }, { x: -0.5, y: 0.5 }] });
    const a = arena({ obstacles: [star] });
    expect(ok(planShot(a, 'me', '0', 1)).trace.hit?.id).toBe('s');
    // A segment inside the notch (inside the convex hull, outside the star) touches nothing
    if (star.shape.kind !== 'poly') throw new Error('poly expected');
    expect(segPoly(1.1, 1.1, 1.2, 1.0, star.shape.pts)).toBe(-1);
    expect(segPoly(1.1, 1.1, 0.3, 0.3, star.shape.pts)).toBeGreaterThan(0);
  });
});
