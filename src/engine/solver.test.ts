import { describe, expect, it } from 'vitest';
import { boxPoly } from './geometry.ts';
import { makeObstacle } from './map.ts';
import { planShot } from './shot.ts';
import { suggestShots } from './solver.ts';
import type { Arena } from './types.ts';

const bounds = { minX: -20, maxX: 20, minY: -12, maxY: 12 };
const base = (obstacles: Arena['obstacles']): Arena => ({
  bounds,
  obstacles,
  actors: [
    { id: 'me', x: -14, y: -4, r: 0.55 },
    { id: 't', x: 10, y: 3, r: 0.6 },
  ],
});

describe('help solver', () => {
  it('returns at most five verified, distinct hits led by a straight line', () => {
    const a = base([]);
    const { shots } = suggestShots(a, 'me', 't');
    expect(shots.length).toBeGreaterThan(2);
    expect(shots.length).toBeLessThanOrEqual(5);
    expect(shots[0].family).toBe('linear');
    expect(new Set(shots.map((s) => s.expr)).size).toBe(shots.length);
    for (const s of shots) {
      const r = planShot(a, 'me', s.expr, s.facing);
      expect(r.ok && r.trace.hit?.id).toBe('t');
    }
  });

  it('routes around a wall when the line is blocked', () => {
    const a = base([makeObstacle('w', 'wall', boxPoly(-2, -12, -1.4, 4), true)]);
    const { shots } = suggestShots(a, 'me', 't');
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.some((s) => s.family === 'linear')).toBe(false);
  });

  it('offers setup shots when the target is boxed in by a breakable wall', () => {
    const t = { x: 10, y: 3 };
    const walls = [
      makeObstacle('l', 'wall', boxPoly(t.x - 2.6, t.y - 2.6, t.x - 2, t.y + 2.6)),
      makeObstacle('r', 'wall', boxPoly(t.x + 2, t.y - 2.6, t.x + 2.6, t.y + 2.6), true),
      makeObstacle('top', 'wall', boxPoly(t.x - 2.6, t.y + 2, t.x + 2.6, t.y + 2.6), true),
      makeObstacle('bot', 'wall', boxPoly(t.x - 2.6, t.y - 2.6, t.x + 2.6, t.y - 2), true),
    ];
    const { shots, setups } = suggestShots(base(walls), 'me', 't');
    expect(shots).toHaveLength(0);
    expect(setups.length).toBeGreaterThan(0);
    expect(setups[0].trace.hit?.id).toBe('l');
  });

  it('can restrict suggestions to one family', () => {
    const { shots } = suggestShots(base([]), 'me', 't', { family: 'log' });
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((s) => s.family === 'log')).toBe(true);
  });

  it('finds verified shots for every family on an open board, small and battle-sized', () => {
    const big = { minX: -100, maxX: 100, minY: -60, maxY: 60 };
    const boards: Arena[] = [base([]), { bounds: big, obstacles: [], actors: [{ id: 'me', x: -70, y: -20, r: 1.6 }, { id: 't', x: 60, y: 25, r: 1.6 }] }];
    for (const a of boards) {
      for (const family of ['linear', 'quadratic', 'absolute', 'cubic', 'sqrt', 'exponential', 'log', 'sine', 'tangent'] as const) {
        const { shots } = suggestShots(a, 'me', 't', { family });
        expect(shots.length, `${family} on ${a.bounds.maxX * 2}-wide board`).toBeGreaterThan(0);
        for (const s of shots) {
          const r = planShot(a, 'me', s.expr, s.facing);
          expect(r.ok && r.family, s.expr).toBe(family);
          expect(r.ok && r.trace.hit?.id, s.expr).toBe('t');
        }
      }
    }
  });

  it('handles targets behind the shooter by facing the other way', () => {
    const a: Arena = { bounds, obstacles: [], actors: [{ id: 'me', x: 5, y: 0, r: 0.55 }, { id: 't', x: -12, y: 4, r: 0.6 }] };
    const { shots } = suggestShots(a, 'me', 't');
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((s) => s.facing === -1)).toBe(true);
  });
});
