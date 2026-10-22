import type { Fn } from './expr.ts';
import { fmt } from './families.ts';
import type { Actor, Arena, Facing, Family, Trace } from './types.ts';

export interface Feedback {
  success: boolean;
  title: string;
  detail: string;
}

const HINT_UP: Partial<Record<Family, string>> = {
  linear: 'Increase the slope m.',
  quadratic: 'Make b bigger for a steeper launch, or bring a closer to 0 so it bends less.',
  sine: 'Change the amplitude a, or the frequency b so a crest lands there.',
  tangent: 'Increase a, or b so the surge comes sooner.',
  log: 'Increase a for a taller climb.',
  absolute: 'Make a more negative for a higher bounce, or move the corner h.',
  cubic: 'Increase a, or move the flat spot h.',
  sqrt: 'Increase a for a taller climb.',
  exponential: 'Increase a, or b so it grows faster.',
};
const HINT_DOWN: Partial<Record<Family, string>> = {
  linear: 'Decrease the slope m.',
  quadratic: 'Lower b, or make a more negative so it bends down sooner.',
  sine: 'Change the amplitude a, or the frequency b so a trough lands there.',
  tangent: 'Decrease a, or b so the surge comes later.',
  log: 'Decrease a for a smaller climb.',
  absolute: 'Make a less negative, or move the corner h.',
  cubic: 'Decrease a, or move the flat spot h.',
  sqrt: 'Decrease a for a smaller climb.',
  exponential: 'Decrease a, or b so it grows slower.',
};

/** Height of the anchored shot at local distance x in front of the shooter. */
export function shotHeight(fn: Fn, x: number): number {
  return fn(x) - fn(0);
}

/**
 * Explain why a shot worked or missed, comparing the curve's height at the
 * target's distance with where the target actually is.
 */
export function explainShot(args: {
  trace: Trace;
  fn: Fn;
  family: Family;
  shooter: Actor;
  facing: Facing;
  target?: Actor;
  arena: Arena;
}): Feedback {
  const { trace, fn, family, shooter, facing, target, arena } = args;
  const hit = trace.hit;
  if (target && hit?.type === 'actor' && hit.id === target.id) {
    return {
      success: true,
      title: 'Direct hit',
      detail: `Your shot flew ${fmt(trace.length, 1)} units and landed right on the target.`,
    };
  }
  let what = '';
  if (hit?.type === 'obstacle') {
    const o = arena.obstacles.find((q) => q.id === hit.id);
    what = `Blocked by the ${o?.kind ?? 'obstacle'} at (${fmt(hit.x, 1)}, ${fmt(hit.y, 1)}).`;
  } else if (hit?.type === 'actor') {
    what = `It hit a different target at (${fmt(hit.x, 1)}, ${fmt(hit.y, 1)}).`;
  } else if (trace.end === 'bounds') {
    const n = trace.pts.length;
    what = `The shot left the arena at (${fmt(trace.pts[n - 2], 1)}, ${fmt(trace.pts[n - 1], 1)}).`;
  } else if (trace.end === 'undefined') {
    const n = trace.pts.length;
    const x = (trace.pts[n - 2] - shooter.x) * facing;
    what = `Your curve stops existing at x = ${fmt(x, 2)}: past there the function is undefined (a log or square root of a negative number).`;
  } else if (trace.end === 'asymptote') {
    what = 'The curve hit a vertical asymptote and shot off to infinity.';
  } else {
    what = 'The shot ran out of range.';
  }
  if (!target) return { success: false, title: 'Missed', detail: what };

  const X = (target.x - shooter.x) * facing;
  if (X <= 0) {
    return { success: false, title: 'Missed', detail: `${what} The target is behind you. Flip your direction to face it.` };
  }
  const Y = target.y - shooter.y;
  const h = shotHeight(fn, X);
  if (!Number.isFinite(h)) {
    return { success: false, title: 'Missed', detail: `${what} Your curve isn't defined at the target's distance x = ${fmt(X, 1)}.` };
  }
  const diff = Y - h;
  const where = `At the target's distance (x = ${fmt(X, 1)}) your curve is at height ${fmt(h, 1)}, but the target is at ${fmt(Y, 1)}.`;
  if (Math.abs(diff) <= target.r) {
    return { success: false, title: 'Right height, wrong route', detail: `${what} The curve does pass through the target, so change the route before it, not the ending.` };
  }
  const hint = diff > 0 ? HINT_UP[family] : HINT_DOWN[family];
  return {
    success: false,
    title: diff > 0 ? `Too low by ${fmt(diff, 1)}` : `Too high by ${fmt(-diff, 1)}`,
    detail: `${what} ${where}${hint ? ' ' + hint : ''}`,
  };
}
