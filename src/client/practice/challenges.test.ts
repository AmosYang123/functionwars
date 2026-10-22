import { describe, expect, it } from 'vitest';
import { planShot } from '../../engine/shot.ts';
import { craterRadius } from '../../engine/collision.ts';
import { suggestShots } from '../../engine/solver.ts';
import type { Arena, FamilyId } from '../../engine/types.ts';
import { CHALLENGES, type Layout } from './challenges.ts';

const bounds = { minX: -20, maxX: 20, minY: -12, maxY: 12 };
const arenaOf = (l: Layout): Arena => ({
  bounds,
  obstacles: l.obstacles,
  actors: [{ id: 'you', x: l.shooter.x, y: l.shooter.y, r: 0.55 }, ...l.dummies.map((d, i) => ({ id: `d${i}`, x: d.x, y: d.y, r: 0.75 }))],
});

describe('practice challenges', () => {
  for (const c of CHALLENGES) {
    it(`"${c.title}" is solvable as specified`, () => {
      const l = c.build();
      const arena = arenaOf(l);
      const family = c.require && c.require !== 'new' ? (c.require as FamilyId) : undefined;
      if (c.id === 'break') {
        // Blocked until a missile blasts a hole in the door (where a flat shot lands)
        expect(suggestShots(arena, 'you', 'd0').shots).toHaveLength(0);
        arena.craters = [{ x: 9, y: 0, r: craterRadius(bounds) }];
      }
      l.dummies.forEach((_, i) => {
        const { shots } = suggestShots(arena, 'you', `d${i}`, { family });
        expect(shots.length, `target d${i}`).toBeGreaterThan(0);
      });
    });
  }

  it('makes the specialised challenges actually need their family', () => {
    const blocked = (id: string, expr: string) => {
      const l = CHALLENGES.find((c) => c.id === id)!.build();
      const r = planShot(arenaOf(l), 'you', expr, 1);
      return r.ok && r.trace.hit?.id !== 'd0';
    };
    // The direct line is blocked in every obstacle challenge
    for (const id of ['boulder', 'wall', 'needle', 'log', 'tan', 'bounce', 'blastoff']) {
      const l = CHALLENGES.find((c) => c.id === id)!.build();
      const s = l.shooter;
      const d = l.dummies[0];
      expect(blocked(id, `${(d.y - s.y) / (d.x - s.x)}x`), id).toBe(true);
    }
  });
});
