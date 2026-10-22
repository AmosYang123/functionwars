import { describe, expect, it } from 'vitest';
import { advisePower, cheatShots } from './cheat.ts';
import { compile } from './expr.ts';
import { arenaFrom, createGame, type Player } from './game.ts';
import { boxPoly } from './geometry.ts';
import { makeObstacle } from './map.ts';
import { planShot } from './shot.ts';
import type { Obstacle } from './types.ts';

const bounds = { minX: -40, maxX: 40, minY: -25, maxY: 25 };
const player = (id: string, seat: number, x: number, y: number): Player => ({ id, name: id, seat, x, y, lives: 1, maxLives: 1, alive: true, power: null });
const board = (obstacles: Obstacle[], players = [player('me', 0, 0, 0), player('a', 1, 20, 5), player('b', 2, -15, 8)]) => ({ bounds, obstacles, players, craters: [] });

describe('opensesame power-up advice', () => {
  it('says to turn on Mirror Shot when one function can hit a target on each side', () => {
    const adv = advisePower(board([]), 'me', ['a', 'b'], 'mirror');
    expect(adv).toMatchObject({ use: true, why: 'pair' });
    expect(adv!.shots[0].hits.sort()).toEqual(['a', 'b']);
  });

  it('says Mirror Shot does not help with a single target', () => {
    expect(advisePower(board([]), 'me', ['a'], 'mirror')).toMatchObject({ use: false, why: 'no-help' });
  });

  it('says to turn on Drill when metal walls box the target in', () => {
    const t = { x: 20, y: 5 };
    const walls = [
      makeObstacle('l', 'wall', boxPoly(t.x - 4, t.y - 4, t.x - 3, t.y + 4), true),
      makeObstacle('r', 'wall', boxPoly(t.x + 3, t.y - 4, t.x + 4, t.y + 4), true),
      makeObstacle('top', 'wall', boxPoly(t.x - 4, t.y + 3, t.x + 4, t.y + 4), true),
      makeObstacle('bot', 'wall', boxPoly(t.x - 4, t.y - 4, t.x + 4, t.y - 3), true),
    ];
    const adv = advisePower(board(walls), 'me', ['a'], 'drill');
    expect(adv).toMatchObject({ use: true, why: 'drill-hit' });
    const s = adv!.shots[0];
    const shot = planShot({ bounds, obstacles: walls, actors: board(walls).players.map((p) => ({ id: p.id, x: p.x, y: p.y, r: 1.6 })) }, 'me', s.expr, s.facing, { pierce: 1 });
    expect(shot.ok && shot.trace.hit?.id).toBe('a');
  });

  it('offers Drill for a straight line when the only plain shots curve around a wall', () => {
    const wall = makeObstacle('w', 'wall', boxPoly(9, -3, 10, 8), true);
    const adv = advisePower(board([wall]), 'me', ['a'], 'drill');
    expect(adv).toMatchObject({ use: true, why: 'drill-line' });
    expect(adv!.shots[0].expr).toMatch(/^-?[\d.]*x$/);
  });

  it('finds a Teleport spot past a full-height wall', () => {
    const wall = makeObstacle('w', 'wall', boxPoly(2, -25, 2.6, 25), true);
    const adv = advisePower(board([wall]), 'me', ['a'], 'teleport');
    expect(adv).toMatchObject({ use: true, why: 'teleport' });
    expect(adv!.to!.x).toBeGreaterThan(2.6);
  });

  it('has nothing to say about power-ups that do not change aim', () => {
    expect(advisePower(board([]), 'me', ['a'], 'first')).toBeNull();
    expect(advisePower(board([]), 'me', ['a'], 'life')).toBeNull();
  });
});

describe('cheat expressions', () => {
  it('writes the quartic term in a form the parser reads', () => {
    expect(compile('0.3(x/96.4)^4 - 0.002x^3 + 0.1x').ok).toBe(true);
  });
});

describe('Mirror Shot cheat on generated maps', () => {
  it('only returns pair shots that really hit both players', () => {
    let pairs = 0;
    for (let seed = 1; seed <= 20 && pairs < 3; seed++) {
      const g = createGame(['a', 'b', 'c', 'd'].map((id) => ({ id, name: id })), seed);
      for (const me of g.players) {
        const arena = arenaFrom(g, me.id);
        const others = g.players.filter((p) => p.id !== me.id).map((p) => p.id);
        for (const s of cheatShots(arena, me.id, others, { mirror: true }).filter((c) => c.hits.length === 2)) {
          pairs++;
          const hit = (f: 1 | -1) => {
            const r = planShot(arena, me.id, s.expr, f);
            return r.ok && r.trace.hit?.type === 'actor' ? r.trace.hit.id : null;
          };
          expect([hit(1), hit(-1)].sort()).toEqual([...s.hits].sort());
        }
      }
    }
    expect(pairs).toBeGreaterThan(0);
  }, 60_000);
});
