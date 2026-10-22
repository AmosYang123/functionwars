import { compile } from './expr.ts';
import { arenaFrom, shotOptions, teleportCheck, type GameState } from './game.ts';
import { teleportRange, type PowerId } from './powers.ts';
import { planShot } from './shot.ts';
import { suggestShots } from './solver.ts';
import type { Arena, Facing, ShotOptions, Vec } from './types.ts';

/** One function to type, and which of the chosen targets it knocks out. */
export interface CheatShot {
  expr: string;
  facing: Facing;
  hits: string[];
  /** No direct hit exists: this shot blasts open the obstacle in the way to this target. */
  opens?: string;
}

export interface CheatOptions {
  /** Mirror Shot is switched on: the same function also fires backward. */
  mirror?: boolean;
  shot?: ShotOptions;
}

/** Fire `expr` the way the round would (both ways with Mirror) and list the targets it hits. */
function hitsOf(arena: Arena, shooterId: string, expr: string, facing: Facing, targets: string[], o: CheatOptions): string[] {
  const out: string[] = [];
  for (const f of o.mirror ? [facing, (facing === 1 ? -1 : 1) as Facing] : [facing]) {
    const s = planShot(arena, shooterId, expr, f, o.shot);
    const hit = s.ok ? s.trace.hit : null;
    if (hit?.type === 'actor' && targets.includes(hit.id) && !out.includes(hit.id)) out.push(hit.id);
  }
  return out;
}

const num = (v: number) => String(Number(v.toPrecision(4)));

/**
 * k·x³ + a·x² + b·x, plus q·(x/X)⁴ when given, dropping terms too small to
 * matter. The quartic is written over a scale so its coefficient stays readable
 * (a bare 1e-7 would be read as 1·e − 7).
 */
function poly(k: number, a: number, b: number, quartic?: { q: number; X: number }): string {
  const terms: [number, string][] = [[k, 'x^3'], [a, 'x^2'], [b, 'x']];
  if (quartic) terms.unshift([quartic.q, `(x/${num(quartic.X)})^4`]);
  const s = terms.filter(([c]) => Math.abs(c) >= 1e-6).map(([c, t]) => `${num(c)}${t}`).join(' + ').replace(/\+ -/g, '- ');
  return s || '0x';
}

const MIRROR_STEPS = [0, 0.05, -0.05, 0.1, -0.1, 0.2, -0.2, 0.4, -0.4, 0.8, -0.8, 1.5, -1.5];

/**
 * Mirror Shot hits one player in front and one behind with the same function:
 * in each shot's own frame both targets are (distance, height) points, so a
 * curve through (X1, Y1) and (X2, Y2) does it. The cubic and quartic terms are
 * free, which gives a family of curves to try against the obstacles.
 */
function mirrorPair(arena: Arena, shooterId: string, a: string, b: string, targets: string[], o: CheatOptions): CheatShot | null {
  const s = arena.actors.find((q) => q.id === shooterId)!;
  const A = arena.actors.find((q) => q.id === a)!;
  const B = arena.actors.find((q) => q.id === b)!;
  const facing: Facing = A.x >= s.x ? 1 : -1;
  if ((B.x >= s.x ? 1 : -1) === facing) return null;
  const X1 = Math.abs(A.x - s.x), Y1 = A.y - s.y;
  const X2 = Math.abs(B.x - s.x), Y2 = B.y - s.y;
  if (X1 < 0.05 || X2 < 0.05 || Math.abs(X1 - X2) < 0.05) return null;
  const Xm = Math.max(X1, X2);
  for (const sq of MIRROR_STEPS) {
    for (const sk of MIRROR_STEPS) {
      const k = sk / (Xm * Xm);
      const q = sq * Xm;
      // a·X + b = (Y − k·X³ − q·(X/Xm)⁴) / X at both points.
      const r1 = (Y1 - k * X1 ** 3 - q * (X1 / Xm) ** 4) / X1;
      const r2 = (Y2 - k * X2 ** 3 - q * (X2 / Xm) ** 4) / X2;
      const qa = (r1 - r2) / (X1 - X2);
      const expr = poly(k, qa, r1 - qa * X1, sq ? { q, X: Xm } : undefined);
      if (hitsOf(arena, shooterId, expr, facing, targets, o).length === 2) return { expr, facing, hits: [a, b] };
    }
  }
  return null;
}

const STEPS = [0, 0.1, -0.1, 0.25, -0.25, 0.5, -0.5, 1, -1, 2, -2, 4, -4];

/** Cubics through (X, Y) in the shooter's frame, simplest first. */
function* curvesThrough(X: number, Y: number, steps = STEPS) {
  for (const sk of steps) {
    for (const sa of steps) {
      const k = sk / (X * X), a = sa / X;
      yield poly(k, a, (Y - k * X ** 3 - a * X * X) / X);
    }
  }
}

/**
 * Mirror Shot, the stronger way: both shots fly along the same f(x), so take
 * a curve that already hits the nearer target N and add a ramp that is zero
 * until N's distance, then bends the far end onto F. The shot toward N is
 * unchanged; only the other one has to get past its own obstacles.
 */
function mirrorBend(arena: Arena, shooterId: string, n: string, f: string, targets: string[], o: CheatOptions): CheatShot | null {
  const s = arena.actors.find((q) => q.id === shooterId)!;
  const N = arena.actors.find((q) => q.id === n)!;
  const F = arena.actors.find((q) => q.id === f)!;
  const facing: Facing = N.x >= s.x ? 1 : -1;
  if ((F.x >= s.x ? 1 : -1) === facing) return null;
  const XN = Math.abs(N.x - s.x), XF = Math.abs(F.x - s.x);
  if (XN < 0.05 || XF - XN < 0.5) return null;
  const bases = [
    ...suggestShots(arena, shooterId, n, { max: 8 }).shots.map((c) => c.expr),
    ...curvesThrough(XN, N.y - s.y),
  ];
  let tried = 0;
  for (const base of bases) {
    const c = compile(base);
    if (!c.ok || !hitsOf(arena, shooterId, base, facing, [n], { ...o, mirror: false }).length) continue;
    if (++tried > 40) break;
    const miss = F.y - s.y - (c.fn(XF) - c.fn(0));
    for (const p of [2, 1, 3]) {
      const ramp = `${num(miss)}((|x - ${num(XN)}| + x - ${num(XN)})/${num(2 * (XF - XN))})^${p}`;
      const expr = `${base} + ${ramp}`.replace(/\+ -/g, '- ');
      if (hitsOf(arena, shooterId, expr, facing, targets, o).length === 2) return { expr, facing, hits: [n, f] };
    }
  }
  return null;
}

/**
 * Wider search than Help: cubics through the target with every bend and twist
 * in `steps`. Mega Blast also aims beside the target, since near is enough.
 */
function polyThrough(arena: Arena, shooterId: string, t: string, targets: string[], o: CheatOptions, steps = STEPS): CheatShot | null {
  const s = arena.actors.find((q) => q.id === shooterId)!;
  const T = arena.actors.find((q) => q.id === t)!;
  const facing: Facing = T.x >= s.x ? 1 : -1;
  const X = Math.abs(T.x - s.x);
  if (X < 0.05) return null;
  const reach = o.shot?.reach ?? 1;
  const aims = reach > 1 ? [0, 0.8, -0.8].map((f) => f * T.r * reach) : [0];
  for (const dy of aims) {
    const Y = T.y - s.y + dy;
    for (const expr of curvesThrough(X, Y, steps)) {
      const hits = hitsOf(arena, shooterId, expr, facing, targets, o);
      if (hits.includes(t)) return { expr, facing, hits };
    }
  }
  return null;
}

/**
 * The "opensesame" cheat: functions that hit the chosen players, each one
 * fired through the real engine first. A shot stops at the first player it
 * touches, so one function knocks out one target, or two with Mirror Shot
 * (one on each side). Shots that hit two come first, then one per target.
 */
export function cheatShots(arena: Arena, shooterId: string, targets: string[], o: CheatOptions = {}): CheatShot[] {
  const out: CheatShot[] = [];
  if (!arena.actors.some((q) => q.id === shooterId)) return out;
  const live = targets.filter((t) => t !== shooterId && arena.actors.some((q) => q.id === t));
  if (o.mirror) {
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const [a, b] = [live[i], live[j]];
        const pair = mirrorPair(arena, shooterId, a, b, live, o) ?? mirrorBend(arena, shooterId, a, b, live, o) ?? mirrorBend(arena, shooterId, b, a, live, o);
        if (pair) out.push(pair);
      }
    }
  }
  for (const t of live) {
    if (out.some((c) => c.hits.includes(t))) continue;
    // Drill: a straight line through the obstacle is the whole point.
    const line = o.shot?.pierce ? polyThrough(arena, shooterId, t, live, o, [0]) : null;
    if (line) {
      out.push(line);
      continue;
    }
    const { shots, setups } = suggestShots(arena, shooterId, t, { max: 5 });
    // Power-ups change the flight (Mega Blast is wider), so re-check each one as it will really fire.
    const best = shots.find((s) => hitsOf(arena, shooterId, s.expr, s.facing, [t], o).length);
    const found = best ? { expr: best.expr, facing: best.facing, hits: hitsOf(arena, shooterId, best.expr, best.facing, live, o) } : polyThrough(arena, shooterId, t, live, o);
    if (found) out.push(found);
    else if (setups[0]) out.push({ expr: setups[0].expr, facing: setups[0].facing, hits: [], opens: t });
  }
  return out.sort((x, y) => y.hits.length - x.hits.length);
}

/** True when the box holds the cheat code, however it is spaced or capitalized. */
export const isCheatCode = (s: string) => s.replace(/\s+/g, '').toLowerCase() === 'opensesame';

/** How good a set of cheat shots is: most targets in one shot, then how many targets get a direct hit at all. */
function quality(shots: CheatShot[]): [number, number] {
  return [Math.max(0, ...shots.map((c) => c.hits.length)), new Set(shots.flatMap((c) => c.hits)).size];
}

const better = (a: [number, number], b: [number, number]) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

/** The power-ups that change where a shot can go. First Strike and Extra Life don't. */
export const AIM_POWERS: PowerId[] = ['mirror', 'drill', 'mega', 'teleport'];

export interface PowerAdvice {
  power: PowerId;
  /** Switch it on (or keep it on) for these targets. */
  use: boolean;
  /** Teleport: where to jump. */
  to?: Vec;
  /** The shots with the power-up on (from `to` for Teleport). */
  shots: CheatShot[];
  /** Which reason to show; the view words it with player names. */
  why: 'pair' | 'drill-hit' | 'drill-line' | 'mega' | 'teleport' | 'no-help';
}

type Board = Pick<GameState, 'bounds' | 'obstacles' | 'players' | 'craters'>;

/** Spots to try for Teleport: two rings inside the range, nearest first. */
function teleportSpots(state: Board, playerId: string): Vec[] {
  const p = state.players.find((q) => q.id === playerId)!;
  const R = teleportRange(state.bounds);
  const out: Vec[] = [];
  for (const f of [0.5, 0.95]) {
    for (let i = 0; i < 10; i++) {
      const to = { x: p.x + Math.cos((i * Math.PI) / 5) * R * f, y: p.y + Math.sin((i * Math.PI) / 5) * R * f };
      if (!teleportCheck(state, playerId, to)) out.push(to);
    }
  }
  return out;
}

const LINE = /^-?[\d.]*x$/;

/**
 * Should the player switch their power-up on for these targets? Compares the
 * cheat's shots with and without it. Null for power-ups that don't change aim.
 */
export function advisePower(state: Board, playerId: string, targets: string[], power: PowerId | null | undefined, plain = cheatShots(arenaFrom(state, playerId), playerId, targets)): PowerAdvice | null {
  if (!power || !AIM_POWERS.includes(power) || !targets.length) return null;
  const base = quality(plain);
  if (power === 'teleport') {
    // Only worth a search when something is left unhit from here.
    if (base[1] === targets.length && base[0] >= 1) return { power, use: false, shots: plain, why: 'no-help' };
    for (const to of teleportSpots(state, playerId)) {
      const shots = cheatShots(arenaFrom(state, playerId, to), playerId, targets);
      if (better(quality(shots), base)) return { power, use: true, to, shots, why: 'teleport' };
    }
    return { power, use: false, shots: plain, why: 'no-help' };
  }
  const shots = cheatShots(arenaFrom(state, playerId), playerId, targets, { mirror: power === 'mirror', shot: shotOptions(power) });
  const on = quality(shots);
  if (better(on, base)) return { power, use: true, shots, why: power === 'mirror' ? 'pair' : power === 'drill' ? 'drill-hit' : 'mega' };
  // Same targets either way, but Drill turns a curve into a plain straight line.
  const curvy = plain.some((c) => c.hits.length && !LINE.test(c.expr));
  if (power === 'drill' && !better(base, on) && curvy && shots.some((c) => c.hits.length && LINE.test(c.expr))) {
    return { power, use: true, shots, why: 'drill-line' };
  }
  return { power, use: false, shots: plain, why: 'no-help' };
}
