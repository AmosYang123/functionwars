import { describe, expect, it } from 'vitest';
import { cheatShots, isCheatCode } from './cheat.ts';
import { boxPoly } from './geometry.ts';
import { makeObstacle } from './map.ts';
import { planShot } from './shot.ts';
import type { Arena } from './types.ts';

const arena: Arena = {
  bounds: { minX: -100, maxX: 100, minY: -60, maxY: 60 },
  obstacles: [],
  actors: [
    { id: 'me', x: 0, y: -10, r: 1.8 },
    { id: 'right', x: 60, y: 15, r: 1.8 },
    { id: 'left', x: -40, y: 20, r: 1.8 },
    { id: 'far', x: 85, y: -30, r: 1.8 },
  ],
};

describe('opensesame cheat', () => {
  it('recognises the code however it is typed', () => {
    expect(isCheatCode('opensesame')).toBe(true);
    expect(isCheatCode(' Open Sesame ')).toBe(true);
    expect(isCheatCode('open')).toBe(false);
  });

  it('gives a function that really hits one chosen target', () => {
    const [s] = cheatShots(arena, 'me', ['far']);
    expect(s.hits).toEqual(['far']);
    const r = planShot(arena, 'me', s.expr, s.facing);
    expect(r.ok && r.trace.hit?.id).toBe('far');
  });

  it('gives one function per target without Mirror Shot', () => {
    const shots = cheatShots(arena, 'me', ['right', 'left']);
    expect(shots.map((s) => s.hits)).toEqual([['right'], ['left']]);
  });

  it('hits a target on each side with one function under Mirror Shot', () => {
    const [s] = cheatShots(arena, 'me', ['right', 'left'], { mirror: true });
    expect(s.hits.sort()).toEqual(['left', 'right']);
    const back = s.facing === 1 ? -1 : 1;
    const hit = (f: 1 | -1) => {
      const r = planShot(arena, 'me', s.expr, f);
      return r.ok ? r.trace.hit?.id : null;
    };
    expect([hit(s.facing), hit(back)].sort()).toEqual(['left', 'right']);
  });

  it('blasts a way in when the target is boxed in', () => {
    const t = { x: 60, y: 15 };
    const box: Arena = {
      ...arena,
      obstacles: [
        makeObstacle('l', 'wall', boxPoly(t.x - 6, t.y - 6, t.x - 4, t.y + 6)),
        makeObstacle('r', 'wall', boxPoly(t.x + 4, t.y - 6, t.x + 6, t.y + 6), true),
        makeObstacle('top', 'wall', boxPoly(t.x - 6, t.y + 4, t.x + 6, t.y + 6), true),
        makeObstacle('bot', 'wall', boxPoly(t.x - 6, t.y - 6, t.x + 6, t.y - 4), true),
      ],
    };
    const [s] = cheatShots(box, 'me', ['right']);
    expect(s).toMatchObject({ hits: [], opens: 'right' });
    const r = planShot(box, 'me', s.expr, s.facing);
    expect(r.ok && r.trace.hit?.id).toBe('l');
  });

  it('ignores the shooter and unknown ids', () => {
    expect(cheatShots(arena, 'me', ['me', 'ghost'])).toEqual([]);
  });
});
