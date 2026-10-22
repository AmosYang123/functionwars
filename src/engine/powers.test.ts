import { describe, expect, it } from 'vitest';
import { createGame, lockIn, resolveRound, type GameState, type PowerUse } from './game.ts';
import { POWER_IDS, spin, spinsAt, type PowerId } from './powers.ts';

function trio(powers: Partial<Record<'a' | 'b' | 'c', PowerId>> = {}): GameState {
  const g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], 42);
  g.obstacles = [];
  const at = { a: [-10, 0], b: [10, 0], c: [0, 8] } as const;
  g.players = g.players.map((p) => ({ ...p, x: at[p.id as 'a'][0], y: at[p.id as 'a'][1], power: powers[p.id as 'a'] ?? null }));
  return g;
}

function lock(g: GameState, id: string, expr: string, facing: 1 | -1, at: number, use: PowerUse = {}) {
  const r = lockIn(g, id, expr, facing, at, use);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

const metal = (x0: number, y0: number, x1: number, y1: number) => ({
  id: 'm',
  kind: 'wall' as const,
  solid: true,
  shape: { kind: 'poly' as const, pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] },
});

describe('power-up spinner', () => {
  it('is seeded, deals one power to everyone on round 1, then again every 2 rounds', () => {
    expect(spin(5, 1, ['a', 'b'])).toEqual(spin(5, 1, ['a', 'b']));
    const g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 9);
    expect(g.players.every((p) => p.power && POWER_IDS.includes(p.power))).toBe(true);
    expect([1, 2, 3, 4, 5].map(spinsAt)).toEqual([true, false, true, false, true]);
  });

  it('respins on round 3, replacing whatever was held', () => {
    let g = trio({ a: 'drill' });
    g = resolveRound(g).state;
    expect(g.round).toBe(2);
    expect(g.players[0].power).toBe('drill');
    g = resolveRound(g).state;
    expect(g.round).toBe(3);
    expect(g.players.every((p) => p.power !== null)).toBe(true);
  });

  it('gives every power a fair chance over many spins', () => {
    const seen = new Set<PowerId>();
    for (let r = 1; r < 200; r += 2) Object.values(spin(77, r, ['a', 'b', 'c'])).forEach((p) => seen.add(p));
    expect(seen.size).toBe(POWER_IDS.length);
  });
});

describe('power-ups in a round', () => {
  it('rejects using a power you do not have, and bad teleports', () => {
    const g = trio({ a: 'teleport' });
    expect(lockIn(g, 'b', '0', -1, 0, { power: true }).ok).toBe(false);
    expect(lockIn(g, 'a', '0', 1, 0, { power: true })).toMatchObject({ ok: false, error: /teleport/ });
    expect(lockIn(g, 'a', '0', 1, 0, { power: true, to: { x: 40, y: 0 } })).toMatchObject({ ok: false, error: /Too far/ });
    expect(lockIn(g, 'a', '0', 1, 0, { power: true, to: { x: -10, y: 1 } }).ok).toBe(true);
    expect(lockIn(g, 'a', '0', 1, 0, { power: true, to: { x: -1, y: 8 } })).toMatchObject({ ok: false, error: /standing there/ });
  });

  it('Teleport moves you before any shot, so shots at your old spot miss', () => {
    let g = trio({ a: 'teleport' });
    g = lock(g, 'b', '0', -1, 100);
    g = lock(g, 'a', '0', -1, 5000, { power: true, to: { x: -10, y: 10 } });
    const { state, events } = resolveRound(g);
    expect(events[0]).toEqual({ kind: 'teleport', playerId: 'a', from: { x: -10, y: 0 }, to: { x: -10, y: 10 } });
    const b = events.find((e) => e.kind === 'shot' && e.playerId === 'b');
    expect(b && b.kind === 'shot' && b.hit).toBeNull();
    expect(state.players[0]).toMatchObject({ x: -10, y: 10, alive: true, power: null });
  });

  it('Drill passes through exactly one obstacle, even metal', () => {
    let g = trio({ a: 'drill' });
    g.obstacles = [metal(-1, -5, 1, 5)];
    expect(resolveRound(lock(g, 'a', '0', 1, 1)).events[0]).toMatchObject({ hit: { type: 'obstacle', id: 'm' } });
    const drilled = resolveRound(lock(g, 'a', '0', 1, 1, { power: true }));
    expect(drilled.events[0]).toMatchObject({ power: 'drill', drilled: ['m'], hit: { type: 'actor', id: 'b' } });
    g.obstacles = [metal(-1, -5, 1, 5), { ...metal(4, -5, 5, 5), id: 'm2' }];
    expect(resolveRound(lock(g, 'a', '0', 1, 1, { power: true })).events[0]).toMatchObject({ hit: { id: 'm2' } });
  });

  it('Extra Life survives one knockout, and is spent even when nobody hits you', () => {
    let g = trio({ a: 'life', c: 'life' });
    g = lock(g, 'a', '0', -1, 1, { power: true });
    g = lock(g, 'c', '0', 1, 2, { power: true });
    g = lock(g, 'b', '0', -1, 3);
    const { state, events } = resolveRound(g);
    expect(events.find((e) => e.playerId === 'b')).toMatchObject({ hit: { id: 'a' }, saved: true, livesLeft: 1 });
    expect(state.players.map((p) => [p.alive, p.power])).toEqual([[true, null], [true, null], [true, null]]);
  });

  it('First Strike fires before earlier locks', () => {
    let g = trio({ a: 'first' });
    g = lock(g, 'b', '0', -1, 100);
    g = lock(g, 'a', '0', 1, 9000, { power: true });
    const { events } = resolveRound(g);
    expect(events.map((e) => [e.kind, e.playerId])).toEqual([['shot', 'a'], ['cancelled', 'b'], ['pass', 'c']]);
  });

  it('Mirror Shot fires the same function both ways', () => {
    let g = trio({ a: 'mirror' });
    g = lock(g, 'a', '0', -1, 1, { power: true });
    const shots = resolveRound(g).events.filter((e) => e.kind === 'shot');
    expect(shots).toMatchObject([{ facing: -1, power: 'mirror', hit: null }, { facing: 1, mirror: true, hit: { id: 'b' } }]);
  });

  it('Mega Blast hits a near miss', () => {
    // Passes 3 units above B: a miss normally, a hit with Mega Blast's bigger reach.
    const near = (use: PowerUse) => resolveRound(lock(trio({ a: 'mega' }), 'a', '0.15x', 1, 1, use)).events[0];
    expect(near({})).toMatchObject({ hit: null });
    expect(near({ power: true })).toMatchObject({ power: 'mega', hit: { type: 'actor', id: 'b' } });
  });
});
