import { decimate } from './trajectory.ts';
import { generateMap, PLAYER_RADIUS } from './map.ts';
import { planShot } from './shot.ts';
import { craterRadius } from './collision.ts';
import { shapeHasSolid } from './geometry.ts';
import { MEGA_REACH, spin, spinsAt, teleportError, type PowerId } from './powers.ts';
import type { Arena, Bounds, Crater, EndReason, Facing, Family, Hit, Obstacle, ShotOptions, Vec } from './types.ts';

export const PREP_MS = 60_000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
/**
 * How long a shot takes on screen: about 1.3s to cross the arena, and never more
 * than 3.5s however long and wiggly the path. Shared so the server can time replays.
 */
export function flightSeconds(length: number, bounds: Bounds): number {
  return Math.min(length / ((bounds.maxX - bounds.minX) * 0.75), 3.5);
}
const SHOT_PAUSE_MS = 900;
const PASS_PAUSE_MS = 500;
const TELEPORT_PAUSE_MS = 900;

export interface PlayerSetup {
  id: string;
  name: string;
}

export interface Player {
  id: string;
  name: string;
  /** Seat index, also the color index. */
  seat: number;
  x: number;
  y: number;
  lives: number;
  maxLives: number;
  alive: boolean;
  /** Power-up held right now; spent when used, replaced on the next spin. */
  power: PowerId | null;
}

export interface Lock {
  expr: string;
  facing: Facing;
  /** ms since this player's preparation started. */
  at: number;
  /** Spend the held power-up this round. */
  power?: boolean;
  /** Teleport destination. */
  to?: Vec;
}

/** What a player asks for with their power-up when locking in. */
export interface PowerUse {
  power?: boolean;
  to?: Vec;
}

export interface GameState {
  seed: number;
  round: number;
  phase: 'prep' | 'over';
  bounds: Bounds;
  obstacles: Obstacle[];
  /** Holes blasted so far; they persist for the rest of the match. */
  craters: Crater[];
  players: Player[];
  locks: Record<string, Lock>;
  winnerId: string | null;
}

export type ShotEvent =
  | { kind: 'teleport'; playerId: string; from: Vec; to: Vec }
  | { kind: 'pass'; playerId: string; reason: 'timeout' }
  | { kind: 'cancelled'; playerId: string; reason: 'eliminated' }
  | {
      kind: 'shot';
      playerId: string;
      expr: string;
      facing: Facing;
      family: Family;
      at: number;
      pts: number[];
      end: EndReason;
      length: number;
      hit: Hit | null;
      /** Set when the missile blasted a hole in a breakable obstacle. */
      crater?: Crater;
      livesLeft?: number;
      eliminated?: boolean;
      /** Power-up spent on this shot (on the first shot only, for Mirror Shot). */
      power?: PowerId;
      /** The backward half of a Mirror Shot. */
      mirror?: boolean;
      drilled?: string[];
      /** The victim's Extra Life kept them in the game. */
      saved?: boolean;
    };

export interface GameOptions {
  lives?: number;
}

export function createGame(setups: PlayerSetup[], seed: number, opts: GameOptions = {}): GameState {
  if (setups.length < MIN_PLAYERS || setups.length > MAX_PLAYERS) throw new Error('2 to 6 players');
  const lives = Math.max(1, Math.min(3, Math.floor(opts.lives ?? 1)));
  const map = generateMap(seed, setups.length);
  const powers = spin(seed, 1, setups.map((s) => s.id));
  return {
    seed,
    round: 1,
    phase: 'prep',
    bounds: map.bounds,
    obstacles: map.obstacles,
    craters: [],
    players: setups.map((s, i) => ({
      id: s.id,
      name: s.name,
      seat: i,
      x: map.spawns[i].x,
      y: map.spawns[i].y,
      lives,
      maxLives: lives,
      alive: true,
      power: powers[s.id],
    })),
    locks: {},
    winnerId: null,
  };
}

export function toArena(state: Pick<GameState, 'bounds' | 'obstacles' | 'players' | 'craters'>): Arena {
  return {
    bounds: state.bounds,
    obstacles: state.obstacles,
    craters: state.craters,
    actors: state.players.filter((p) => p.alive).map((p) => ({ id: p.id, x: p.x, y: p.y, r: PLAYER_RADIUS })),
  };
}

/** Default facing points toward the middle of the arena. */
export function defaultFacing(p: { x: number }): Facing {
  return p.x <= 0 ? 1 : -1;
}

export type LockResult = { ok: true; state: GameState } | { ok: false; error: string };

export function shotOptions(power: PowerId | null | undefined): ShotOptions {
  if (power === 'drill') return { pierce: 1 };
  if (power === 'mega') return { reach: MEGA_REACH };
  return {};
}

/** The arena as one player sees it while aiming, standing at `at` (a teleport destination). */
export function arenaFrom(state: Pick<GameState, 'bounds' | 'obstacles' | 'players' | 'craters'>, playerId: string, at?: Vec): Arena {
  const arena = toArena(state);
  if (at) arena.actors = arena.actors.map((a) => (a.id === playerId ? { ...a, x: at.x, y: at.y } : a));
  return arena;
}

/** Null when `to` is a legal teleport for this player right now. */
export function teleportCheck(state: Pick<GameState, 'bounds' | 'obstacles' | 'players'>, playerId: string, to: Vec): string | null {
  const p = state.players.find((q) => q.id === playerId);
  if (!p) return 'You are not in this round';
  const others = state.players.filter((q) => q.alive && q.id !== playerId);
  return teleportError(p, to, PLAYER_RADIUS, state.bounds, state.obstacles, others);
}

export function lockIn(state: GameState, playerId: string, expr: string, facing: Facing, at: number, use: PowerUse = {}): LockResult {
  if (state.phase !== 'prep') return { ok: false, error: 'Not accepting shots right now' };
  const p = state.players.find((q) => q.id === playerId);
  if (!p || !p.alive) return { ok: false, error: 'You are not in this round' };
  if (state.locks[playerId]) return { ok: false, error: 'Already locked in' };
  if (!Number.isFinite(at) || at < 0) return { ok: false, error: 'Invalid lock time' };
  if (use.power && !p.power) return { ok: false, error: 'You have no power-up to use' };
  const power = use.power ? p.power : null;
  let to: Vec | undefined;
  if (power === 'teleport') {
    if (!use.to) return { ok: false, error: 'Click the board to pick where to teleport' };
    to = { x: use.to.x, y: use.to.y };
    const err = teleportCheck(state, playerId, to);
    if (err) return { ok: false, error: err };
  }
  const shot = planShot(arenaFrom(state, playerId, to), playerId, expr, facing, shotOptions(power));
  if (!shot.ok) return { ok: false, error: shot.error };
  const lock: Lock = { expr, facing, at, ...(power ? { power: true } : {}), ...(to ? { to } : {}) };
  return { ok: true, state: { ...state, locks: { ...state.locks, [playerId]: lock } } };
}

/** Lock order: First Strike users, then earliest lock first, ties by seat. Unlocked players pass afterwards. */
export function firingOrder(state: GameState): string[] {
  const alive = state.players.filter((p) => p.alive);
  const first = (p: Player) => (state.locks[p.id]?.power && p.power === 'first' ? 0 : 1);
  const locked = alive
    .filter((p) => state.locks[p.id])
    .sort((a, b) => first(a) - first(b) || state.locks[a.id].at - state.locks[b.id].at || a.seat - b.seat);
  return [...locked, ...alive.filter((p) => !state.locks[p.id])].map((p) => p.id);
}

function spinFor(state: GameState) {
  const got = spin(state.seed, state.round, state.players.filter((p) => p.alive).map((p) => p.id));
  for (const p of state.players) p.power = p.alive ? got[p.id] : null;
}

/**
 * Resolve every shot of the round in lock order against the evolving arena:
 * obstacles damaged by an earlier shot are weaker for the next, and players
 * eliminated before their turn lose their shot.
 */
export function resolveRound(state: GameState): { state: GameState; events: ShotEvent[] } {
  const next: GameState = structuredClone(state);
  const events: ShotEvent[] = [];
  const order = firingOrder(state);
  const player = (id: string) => next.players.find((p) => p.id === id)!;
  // Powers spent this round, whatever happens to their owners.
  const used = new Map<string, PowerId>();
  for (const id of order) {
    const p = player(id);
    if (next.locks[id]?.power && p.power) used.set(id, p.power);
  }
  // Teleports land before any shot flies, so everyone else aimed at the old spot.
  for (const id of order) {
    const to = next.locks[id]?.to;
    if (used.get(id) !== 'teleport' || !to || teleportCheck(next, id, to)) continue;
    const p = player(id);
    events.push({ kind: 'teleport', playerId: id, from: { x: p.x, y: p.y }, to });
    p.x = to.x;
    p.y = to.y;
  }
  const shielded = new Set([...used].filter(([, p]) => p === 'life').map(([id]) => id));

  for (const id of order) {
    const shooter = player(id);
    const lock = next.locks[id];
    if (!shooter.alive) {
      events.push({ kind: 'cancelled', playerId: id, reason: 'eliminated' });
      continue;
    }
    if (!lock) {
      events.push({ kind: 'pass', playerId: id, reason: 'timeout' });
      continue;
    }
    const power = used.get(id);
    const facings: Facing[] = power === 'mirror' ? [lock.facing, lock.facing === 1 ? -1 : 1] : [lock.facing];
    facings.forEach((facing, n) => {
      const shot = planShot(toArena(next), id, lock.expr, facing, shotOptions(power));
      if (!shot.ok) {
        // Validated at lock time; an arena change cannot make it invalid, but stay safe.
        if (n === 0) events.push({ kind: 'pass', playerId: id, reason: 'timeout' });
        return;
      }
      const { trace } = shot;
      const ev: Extract<ShotEvent, { kind: 'shot' }> = {
        kind: 'shot',
        playerId: id,
        expr: lock.expr,
        facing,
        family: shot.family,
        at: lock.at,
        pts: decimate(trace.pts),
        end: trace.end,
        length: trace.length,
        hit: trace.hit,
        ...(power && n === 0 ? { power } : {}),
        ...(n > 0 ? { mirror: true } : {}),
        ...(trace.drilled ? { drilled: trace.drilled } : {}),
      };
      if (trace.hit?.type === 'obstacle') {
        const o = next.obstacles.find((q) => q.id === trace.hit!.id)!;
        if (!o.solid) {
          ev.crater = { x: trace.hit.x, y: trace.hit.y, r: craterRadius(next.bounds) * (power === 'mega' ? 2 : 1) };
          next.craters.push(ev.crater);
        }
      } else if (trace.hit?.type === 'actor') {
        const victim = player(trace.hit.id);
        if (victim.lives <= 1 && shielded.has(victim.id)) {
          shielded.delete(victim.id);
          ev.saved = true;
        } else {
          victim.lives -= 1;
        }
        ev.livesLeft = victim.lives;
        if (victim.lives <= 0) {
          victim.alive = false;
          ev.eliminated = true;
        }
      }
      events.push(ev);
    });
  }
  for (const id of used.keys()) player(id).power = null;
  next.obstacles = next.obstacles.filter((o) => o.solid || shapeHasSolid(o.shape, next.craters));
  next.locks = {};
  const alive = next.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    next.phase = 'over';
    next.winnerId = alive[0]?.id ?? null;
  } else {
    next.round += 1;
    if (spinsAt(next.round)) spinFor(next);
  }
  return { state: next, events };
}

/** How long clients need to replay a round's events, so the server can wait for them. */
export function replayDurationMs(events: ShotEvent[], bounds: Bounds): number {
  return events.reduce(
    (ms, e) => ms + (e.kind === 'shot' ? flightSeconds(e.length, bounds) * 1000 + SHOT_PAUSE_MS : e.kind === 'teleport' ? TELEPORT_PAUSE_MS : PASS_PAUSE_MS),
    1200,
  );
}

/** Remove a player who left mid-game (online). */
export function removePlayer(state: GameState, playerId: string): GameState {
  const next = structuredClone(state);
  const p = next.players.find((q) => q.id === playerId);
  if (p) p.alive = false;
  delete next.locks[playerId];
  const alive = next.players.filter((q) => q.alive);
  if (alive.length <= 1 && next.phase !== 'over') {
    next.phase = 'over';
    next.winnerId = alive[0]?.id ?? null;
  }
  return next;
}
