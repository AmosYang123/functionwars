import { describe, expect, it } from 'vitest';
import { createGame, firingOrder, lockIn, resolveRound, type GameState } from './game.ts';
import { distToShape } from './geometry.ts';
import { generateMap } from './map.ts';

function trio(): GameState {
  const g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], 42);
  g.obstacles = [];
  g.players[0] = { ...g.players[0], x: -10, y: 0 };
  g.players[1] = { ...g.players[1], x: 10, y: 0 };
  g.players[2] = { ...g.players[2], x: 0, y: 8 };
  return g;
}

function lock(g: GameState, id: string, expr: string, facing: 1 | -1, at: number) {
  const r = lockIn(g, id, expr, facing, at);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe('rounds', () => {
  it('fires in lock-in order and cancels the shot of a player eliminated first', () => {
    let g = trio();
    g = lock(g, 'b', '0', -1, 5000);
    g = lock(g, 'a', '0', 1, 9000);
    const { state, events } = resolveRound(g);
    expect(events.map((e) => [e.kind, e.playerId])).toEqual([
      ['shot', 'b'],
      ['cancelled', 'a'],
      ['pass', 'c'],
    ]);
    expect(state.players.find((p) => p.id === 'a')!.alive).toBe(false);
    expect(state.round).toBe(2);
    expect(state.locks).toEqual({});
  });

  it('declares the last player alive the winner', () => {
    let g = trio();
    g = lock(g, 'a', '0', 1, 100);
    g = lock(g, 'c', '0.8x', 1, 200);
    let r = resolveRound(g);
    expect(r.state.phase).toBe('prep');
    g = lock(r.state, 'a', '0.8x', 1, 100);
    r = resolveRound(g);
    expect(r.state.phase).toBe('over');
    expect(r.state.winnerId).toBe('a');
  });

  it('rejects invalid shots, double locks and unknown players', () => {
    let g = trio();
    expect(lockIn(g, 'a', 'sin(', 1, 0).ok).toBe(false);
    expect(lockIn(g, 'a', 'ln(x-2)', 1, 0).ok).toBe(false);
    g = lock(g, 'a', 'x', 1, 0);
    expect(lockIn(g, 'a', 'x', 1, 1).ok).toBe(false);
    expect(lockIn(g, 'zzz', 'x', 1, 1).ok).toBe(false);
  });

  it('orders unlocked players last and breaks ties by seat', () => {
    let g = trio();
    g = lock(g, 'c', 'x', 1, 300);
    g = lock(g, 'b', 'x', 1, 300);
    expect(firingOrder(g)).toEqual(['b', 'c', 'a']);
  });

  it('blasts a crater where a missile lands, so a later shot in the same round flies through', () => {
    let g = trio();
    // A tall wall: the blast only removes the part around the hit
    g.obstacles = [{ id: 'w', kind: 'wall', shape: { kind: 'poly', pts: [{ x: -1, y: -20 }, { x: 1, y: -20 }, { x: 1, y: 20 }, { x: -1, y: 20 }] } }];
    g = lock(g, 'a', '0', 1, 1);
    g = lock(g, 'b', '0', -1, 2);
    const { state, events } = resolveRound(g);
    expect(events[0]).toMatchObject({ kind: 'shot', hit: { type: 'obstacle', id: 'w' }, crater: { x: -1, y: 0, r: 5 } });
    expect(events[1]).toMatchObject({ kind: 'shot', hit: { type: 'actor', id: 'a' }, eliminated: true });
    expect(state.craters).toHaveLength(1);
    expect(state.obstacles).toHaveLength(1);
  });

  it('leaves unbreakable obstacles intact', () => {
    let g = trio();
    g.obstacles = [{ id: 'm', kind: 'wall', solid: true, shape: { kind: 'poly', pts: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] } }];
    g = lock(g, 'a', '0', 1, 1);
    const { state, events } = resolveRound(g);
    expect(events[0]).toMatchObject({ hit: { id: 'm' } });
    expect(events[0]).not.toHaveProperty('crater');
    expect(state.craters).toHaveLength(0);
  });

  it('supports multiple lives', () => {
    let g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 7, { lives: 2 });
    g.obstacles = [];
    g.players[0] = { ...g.players[0], x: -10, y: 0 };
    g.players[1] = { ...g.players[1], x: 10, y: 0 };
    g = lock(g, 'a', '0', 1, 1);
    const r = resolveRound(g);
    expect(r.events[0]).toMatchObject({ livesLeft: 1 });
    expect(r.state.players[1].alive).toBe(true);
  });
});

describe('map generation', () => {
  it('is deterministic and places players clear of obstacles', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      for (const n of [2, 4, 6]) {
        const m = generateMap(seed, n);
        expect(generateMap(seed, n)).toEqual(m);
        expect(m.spawns).toHaveLength(n);
        for (const s of m.spawns) {
          for (const o of m.obstacles) expect(distToShape(s.x, s.y, o.shape)).toBeGreaterThan(1.5);
        }
      }
    }
  });
});
