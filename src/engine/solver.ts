import { buildExpr, fmt } from './families.ts';
import { distToShape, shapeCenter } from './geometry.ts';
import { planShot } from './shot.ts';
import type { Arena, Facing, FamilyId, Obstacle, Trace } from './types.ts';

export type Route = 'clear' | 'skims' | 'threads' | 'setup';

export interface Suggestion {
  expr: string;
  family: FamilyId;
  params: Record<string, number>;
  facing: Facing;
  trace: Trace;
  explanation: string;
  obstacleNote: string;
  route: Route;
  score: number;
}

interface Candidate {
  family: FamilyId;
  params: Record<string, number>;
  /** The parameter solved to pass through the target; rounding is retried on it. */
  solved: string;
}

const BASE: Record<FamilyId, number> = { linear: 0, quadratic: 1, absolute: 1.5, sine: 2, cubic: 2.1, sqrt: 2.2, log: 2.4, exponential: 2.6, tangent: 2.8 };

/** Round a fixed parameter the way buildExpr will print it, so the solved one is solved against it. */
const q = (v: number) => Number(fmt(v));
const OBSTACLE_NAME: Record<Obstacle['kind'], string> = { boulder: 'boulder', wall: 'wall', triangle: 'triangle', star: 'star' };

function candidates(X: number, Y: number): Candidate[] {
  const out: Candidate[] = [];
  out.push({ family: 'linear', params: { m: Y / X, b: 0 }, solved: 'm' });

  for (const a of [-1, -0.6, -0.4, -0.3, -0.2, -0.15, -0.1, -0.08, -0.06, -0.04, -0.03, -0.02, -0.01, -0.006, -0.003, 0.003, 0.006, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12, 0.2, 0.3, 0.5]) {
    const b = (Y - a * X * X) / X;
    if (Math.abs(b) <= 8) out.push({ family: 'quadratic', params: { a, b, c: 0 }, solved: 'b' });
  }

  const sineB = [0.03, 0.05, 0.08, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 1, 1.25, 1.5, 2];
  for (const b of sineB) {
    for (const c of [0, 1.57, -1.57]) {
      const s = Math.sin(b * X + c) - Math.sin(c);
      if (Math.abs(s) < 0.12) continue;
      const a = Y / s;
      if (Math.abs(a) <= 9) out.push({ family: 'sine', params: { a, b, c, d: 0 }, solved: 'a' });
    }
  }
  // Crest (or trough) right on the target: any distance and height, including the big battle map.
  for (let n = 0; n <= 3; n++) {
    const b = q(((2 * n + 1) * Math.PI) / (2 * X));
    out.push({ family: 'sine', params: { a: n % 2 ? -Y : Y, b, c: 0, d: 0 }, solved: 'a' });
  }
  // Targets near a zero crossing: choose the frequency instead of the amplitude.
  if (Math.abs(Y) < 1.5) {
    for (let n = 1; n <= 5; n++) {
      const b = (n * Math.PI) / X;
      for (const a of [2, -2, 3, -3, 4, -4, 5, -5]) out.push({ family: 'sine', params: { a, b, c: 0, d: 0 }, solved: 'b' });
    }
  }

  for (const b of [0.004, 0.007, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5]) {
    for (const c of [0, 0.6]) {
      if (b * X + c > Math.PI / 2 - 0.03) continue;
      const t = Math.tan(b * X + c) - Math.tan(c);
      if (Math.abs(t) < 0.05) continue;
      const a = Y / t;
      if (Math.abs(a) <= 9) out.push({ family: 'tangent', params: { a, b, c, d: 0 }, solved: 'a' });
    }
  }
  // The signature tangent move: asymptote just beyond the target, so it stays low then surges.
  for (const eps of [0.03, 0.06, 0.1, 0.15, 0.25]) {
    const b = Number(((Math.PI / 2 - eps) / X).toFixed(4));
    const t = Math.tan(b * X);
    if (b > 0 && b * X < Math.PI / 2 && Math.abs(t) > 0.05) out.push({ family: 'tangent', params: { a: Y / t, b, c: 0, d: 0 }, solved: 'a' });
  }

  for (const h of [-0.05, -0.1, -0.2, -0.3, -0.5, -1, -2, -4, -8]) {
    const l = Math.log(X - h) - Math.log(-h);
    if (Math.abs(l) < 0.05) continue;
    const a = Y / l;
    if (Math.abs(a) <= 9) out.push({ family: 'log', params: { a, h, k: 0 }, solved: 'a' });
  }

  // Absolute value: past the corner the anchored V is a(x − 2h), so pick the steepness and solve for the corner.
  for (const a of [-2, -1.2, -0.8, -0.5, -0.3, 0.3, 0.5, 0.8, 1.2, 2]) {
    const h = (X - Y / a) / 2;
    if (h > 0.05 * X && h < 0.95 * X) out.push({ family: 'absolute', params: { a, h, k: 0 }, solved: 'h' });
  }

  // Cubic S-curves: the flat spot behind you, along the way, or past the target.
  for (const f of [-0.5, -0.25, 0.3, 0.5, 0.7, 1.3, 2]) {
    const h = q(f * X);
    const t = (X - h) ** 3 + h ** 3;
    if (Math.abs(t) > 1e-9) out.push({ family: 'cubic', params: { a: Y / t, h, k: 0 }, solved: 'a' });
  }

  for (const f of [0, -0.02, -0.1, -0.25, -0.5]) {
    const h = q(f * X);
    const s = Math.sqrt(X - h) - Math.sqrt(-h);
    const a = Y / s;
    if (Math.abs(a) <= 9) out.push({ family: 'sqrt', params: { a, h, k: 0 }, solved: 'a' });
  }

  // Exponential: e^(bx) grows by e every 1/b units; negative b launches fast and levels off.
  for (const beta of [-8, -5, -3, -2, -1, 1, 2, 3, 4, 6, 8]) {
    const b = q(beta / X);
    const t = Math.exp(b * X) - 1;
    const a = Y / t;
    if (Math.abs(t) > 0.05 && Math.abs(a) <= 12) out.push({ family: 'exponential', params: { a, b, c: 0 }, solved: 'a' });
  }
  return out;
}

interface Clearance {
  min: number;
  near: { o: Obstacle; d: number; above: boolean }[];
}

function clearance(trace: Trace, obstacles: Obstacle[]): Clearance {
  const near: Clearance['near'] = [];
  let min = Infinity;
  for (const o of obstacles) {
    if (trace.hit?.id === o.id) continue;
    let d = Infinity;
    let atY = 0;
    let atX = 0;
    for (let i = 0; i < trace.pts.length; i += 6) {
      const dd = distToShape(trace.pts[i], trace.pts[i + 1], o.shape);
      if (dd < d) {
        d = dd;
        atX = trace.pts[i];
        atY = trace.pts[i + 1];
      }
    }
    min = Math.min(min, d);
    const c = shapeCenter(o.shape);
    if (d < 2.5) near.push({ o, d, above: c.y > atY || (c.y === atY && c.x > atX) });
  }
  near.sort((a, b) => a.d - b.d);
  return { min, near };
}

function describeRoute(c: Clearance): { route: Route; note: string } {
  const above = c.near.find((n) => n.above);
  const below = c.near.find((n) => !n.above);
  if (above && below && above.d < 2.5 && below.d < 2.5) {
    return {
      route: 'threads',
      note: `Threads the gap between the ${OBSTACLE_NAME[above.o.kind]} above and the ${OBSTACLE_NAME[below.o.kind]} below, about ${fmt(above.d + below.d, 1)} units of room.`,
    };
  }
  const closest = c.near[0];
  if (closest && closest.d < 2) {
    return {
      route: 'skims',
      note: `Avoids the ${OBSTACLE_NAME[closest.o.kind]}, passing ${closest.above ? 'under' : 'over'} it with ${fmt(Math.max(closest.d, 0), 1)} units to spare.`,
    };
  }
  return { route: 'clear', note: 'Avoids every obstacle: nothing within 2 units of the path.' };
}

function explain(family: FamilyId, p: Record<string, number>, X: number, Y: number): string {
  const rise = Y >= 0 ? `climbs ${fmt(Y, 1)}` : `drops ${fmt(-Y, 1)}`;
  switch (family) {
    case 'linear':
      return `Slope ${fmt(p.m, 2)}: the shot ${p.m >= 0 ? 'rises' : 'falls'} ${fmt(Math.abs(p.m), 2)} for every unit forward, so over the ${fmt(X, 1)} units to the target it ${rise}.`;
    case 'quadratic': {
      const xv = -p.b / (2 * p.a);
      const yv = p.a * xv * xv + p.b * xv;
      if (p.a < 0 && xv > 0 && xv < X) {
        return `Leaves you at slope ${fmt(p.b, 2)} and gravity-style bend a = ${fmt(p.a, 2)} pulls it over: it peaks at height ${fmt(yv, 1)} about ${fmt(xv, 1)} units out, then drops onto the target.`;
      }
      if (p.a > 0) return `Bend a = ${fmt(p.a, 2)} is positive, so the path curves upward, starting ${p.b < 0 ? 'with a dive' : 'low'} and sweeping up into the target.`;
      return `A long shallow arc: bend a = ${fmt(p.a, 2)} curves it down gradually, so it ${rise} by the time it reaches the target.`;
    }
    case 'sine': {
      const period = (2 * Math.PI) / p.b;
      const start = p.c > 0.1 ? ' Phase π/2 makes it start at a crest, so it leaves you falling.' : p.c < -0.1 ? ' Phase −π/2 starts it in a trough, so it leaves you rising.' : '';
      return `Swings up to ${fmt(Math.abs(p.a), 1)} units above and below, one full wave every ${fmt(period, 1)} units.${start} The wave meets the target's height ${fmt(X, 1)} units out.`;
    }
    case 'tangent': {
      const asym = (Math.PI / 2 - p.c) / p.b;
      return `Stays fairly flat, then surges near the asymptote at x = ${fmt(asym, 1)}. The target sits at x = ${fmt(X, 1)}, just before the curve runs off to infinity.`;
    }
    case 'log':
      return `The asymptote at x = ${fmt(p.h, 2)}, just behind you, makes the shot launch steeply and then flatten out. By ${fmt(X, 1)} units forward it ${rise}.`;
    case 'absolute':
      return `A bounce shot: it flies ${p.a < 0 ? 'up' : 'down'} at slope ${fmt(Math.abs(p.a), 2)} until the corner at x = ${fmt(p.h, 1)}, then turns and flies ${p.a < 0 ? 'down' : 'up'} at the same steepness onto the target.`;
    case 'cubic':
      return p.h > 0 && p.h < X
        ? `An S-curve: it ${Y >= 0 ? 'rises' : 'drops'}, levels off at its flat spot x = ${fmt(p.h, 1)}, then ${Y >= 0 ? 'climbs' : 'dives'} again into the target.`
        : `A cube with its flat spot at x = ${fmt(p.h, 1)}, ${p.h <= 0 ? 'behind you, so the shot starts gentle and keeps getting steeper' : 'past the target, so the shot starts steep and eases off'}. By ${fmt(X, 1)} units forward it ${rise}.`;
    case 'sqrt':
      return `${p.h === 0 ? 'Starts right where you stand, so it leaves you almost straight up' : `Starts at x = ${fmt(p.h, 1)}, behind you, so the launch is less steep`}; square roots grow fast at first, then slow down. By ${fmt(X, 1)} units forward it ${rise}.`;
    case 'exponential':
      return p.b > 0
        ? `Creeps along, then blasts off: it grows by a factor of e every ${fmt(1 / p.b, 1)} units, so most of the ${Y >= 0 ? 'climb' : 'drop'} happens right before the target.`
        : `Leaves you fast, then levels off as e^(${fmt(p.b, 3)}x) shrinks toward 0. By ${fmt(X, 1)} units forward it ${rise}.`;
  }
}

/** Sampled heights used to drop near-duplicate paths. */
function signature(trace: Trace): number[] {
  const out: number[] = [];
  const n = trace.pts.length / 2;
  for (let k = 1; k <= 5; k++) {
    const i = Math.min(n - 1, Math.floor((n * k) / 6));
    out.push(trace.pts[i * 2 + 1]);
  }
  return out;
}

function tryCandidate(arena: Arena, shooterId: string, targetId: string, facing: Facing, c: Candidate): { expr: string; params: Record<string, number>; trace: Trace } | null {
  for (const digits of [2, 3]) {
    const v = c.params[c.solved];
    const params = { ...c.params, [c.solved]: Math.abs(v) >= 1 ? Number(v.toFixed(digits)) : Number(v.toPrecision(digits)) };
    const expr = buildExpr(c.family, params);
    const shot = planShot(arena, shooterId, expr, facing);
    // A coefficient that rounds to 0 leaves a different family than advertised: skip it.
    const sameKind = shot.ok && (shot.family === c.family || (c.family === 'linear' && shot.family === 'constant'));
    if (shot.ok && sameKind && shot.trace.hit?.type === 'actor' && shot.trace.hit.id === targetId) return { expr, params, trace: shot.trace };
  }
  return null;
}

export interface Suggestions {
  shots: Suggestion[];
  /** Shown only when no direct shot exists: shots that break a blocking obstacle. */
  setups: Suggestion[];
}

/**
 * Every suggestion is fired through the real engine against the live arena
 * before it is returned, so each one is a guaranteed hit (no approximations).
 */
export function suggestShots(arena: Arena, shooterId: string, targetId: string, opts: { max?: number; family?: FamilyId } = {}): Suggestions {
  const max = opts.max ?? 5;
  const s = arena.actors.find((a) => a.id === shooterId);
  const t = arena.actors.find((a) => a.id === targetId);
  if (!s || !t) return { shots: [], setups: [] };
  const facing: Facing = t.x >= s.x ? 1 : -1;
  const X = Math.max((t.x - s.x) * facing, 0.05);
  const Y = t.y - s.y;
  const live = arena.obstacles;

  const pool = candidates(X, Y).filter((c) => !opts.family || c.family === opts.family);
  const found: Suggestion[] = [];
  const blockers = new Map<string, Suggestion>();
  for (const c of pool) {
    const ok = tryCandidate(arena, shooterId, targetId, facing, c);
    if (!ok) {
      if (c.family === 'linear' || c.family === 'quadratic') {
        const expr = buildExpr(c.family, c.params);
        const shot = planShot(arena, shooterId, expr, facing);
        const hit = shot.ok ? shot.trace.hit : null;
        const o = hit?.type === 'obstacle' ? live.find((q) => q.id === hit.id) : undefined;
        if (shot.ok && o && !o.solid && !blockers.has(o.id)) {
          blockers.set(o.id, {
            expr, family: c.family, params: c.params, facing, trace: shot.trace,
            explanation: `This path to the target is blocked by a ${OBSTACLE_NAME[o.kind]}. Fire it to blast a hole right where it lands.`,
            obstacleNote: `Blasts a hole in the ${OBSTACLE_NAME[o.kind]}. Fire the same shot again and it flies through the gap.`,
            route: 'setup', score: 1,
          });
        }
      }
      continue;
    }
    const cl = clearance(ok.trace, live);
    const { route, note } = describeRoute(cl);
    const nonzero = Object.values(ok.params).filter((v) => v !== 0).length;
    const score = BASE[c.family] + nonzero * 0.25 + (cl.min < 0.3 ? 1.5 : -Math.min(cl.min, 3) * 0.3) + ok.trace.length * 0.01;
    found.push({ expr: ok.expr, family: c.family, params: ok.params, facing, trace: ok.trace, explanation: explain(c.family, ok.params, X, Y), obstacleNote: note, route, score });
  }

  found.sort((a, b) => a.score - b.score);
  const chosen: Suggestion[] = [];
  const similar = (a: Suggestion) =>
    chosen.some((c) => c.expr === a.expr || (c.family === a.family && signature(c.trace).every((y, i) => Math.abs(y - signature(a.trace)[i]) < 0.8)));
  // First the best of each family, then fill with distinct alternatives.
  for (const f of new Set(found.map((x) => x.family))) {
    const best = found.find((x) => x.family === f)!;
    if (chosen.length < max) chosen.push(best);
  }
  for (const x of found) {
    if (chosen.length >= max) break;
    if (!similar(x)) chosen.push(x);
  }
  chosen.sort((a, b) => a.score - b.score);
  const setups = chosen.length ? [] : [...blockers.values()].sort((a, b) => a.score - b.score).slice(0, 2);
  return { shots: chosen, setups };
}
