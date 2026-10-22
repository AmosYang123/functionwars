import { planShot } from './shot.ts';
import { suggestShots } from './solver.ts';
import type { Arena, Facing, ShotOptions } from './types.ts';

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

/** k·x³ + a·x² + b·x, dropping terms too small to matter. */
function poly(k: number, a: number, b: number): string {
  const terms = [[k, 'x^3'], [a, 'x^2'], [b, 'x']] as const;
  const s = terms.filter(([c]) => Math.abs(c) >= 1e-6).map(([c, t]) => `${num(c)}${t}`).join(' + ').replace(/\+ -/g, '- ');
  return s || '0x';
}

/**
 * Mirror Shot hits one player in front and one behind with the same function:
 * in each shot's own frame both targets are (distance, height) points, so a
 * curve through (X1, Y1) and (X2, Y2) does it. The cubic term is free, which
 * gives a family of curves to try against the obstacles.
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
  for (const step of [0, 0.05, -0.05, 0.1, -0.1, 0.2, -0.2, 0.4, -0.4, 0.8, -0.8, 1.5, -1.5]) {
    const k = step / (Xm * Xm);
    // a·X + b = (Y − k·X³) / X at both points.
    const r1 = (Y1 - k * X1 ** 3) / X1;
    const r2 = (Y2 - k * X2 ** 3) / X2;
    const qa = (r1 - r2) / (X1 - X2);
    const expr = poly(k, qa, r1 - qa * X1);
    if (hitsOf(arena, shooterId, expr, facing, targets, o).length === 2) return { expr, facing, hits: [a, b] };
  }
  return null;
}

const STEPS = [0, 0.1, -0.1, 0.25, -0.25, 0.5, -0.5, 1, -1, 2, -2, 4, -4];

/** Wider search than Help: cubics through the target with every bend and twist in STEPS. */
function polyThrough(arena: Arena, shooterId: string, t: string, targets: string[], o: CheatOptions): CheatShot | null {
  const s = arena.actors.find((q) => q.id === shooterId)!;
  const T = arena.actors.find((q) => q.id === t)!;
  const facing: Facing = T.x >= s.x ? 1 : -1;
  const X = Math.abs(T.x - s.x), Y = T.y - s.y;
  if (X < 0.05) return null;
  for (const sk of STEPS) {
    for (const sa of STEPS) {
      const k = sk / (X * X), a = sa / X;
      const expr = poly(k, a, (Y - k * X ** 3 - a * X * X) / X);
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
        const pair = mirrorPair(arena, shooterId, live[i], live[j], live, o) ?? mirrorPair(arena, shooterId, live[j], live[i], live, o);
        if (pair) out.push(pair);
      }
    }
  }
  for (const t of live) {
    if (out.some((c) => c.hits.includes(t))) continue;
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
