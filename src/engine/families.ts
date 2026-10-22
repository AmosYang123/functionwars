import type { FamilyId } from './types.ts';

export interface ParamDef {
  key: string;
  symbol: string;
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** What this parameter does to the shot, in battle terms. */
  role: string;
}

export interface FamilyDef {
  id: FamilyId;
  name: string;
  template: string;
  params: ParamDef[];
  build: (p: Record<string, number>) => string;
}

export function fmt(n: number, digits = 3): string {
  // Tiny coefficients (a cubic or exponential shot across the big map) keep two
  // significant digits instead of rounding to 0. Below 1e-6 String() would print
  // "1e-7", which the parser reads as 1·e − 7, so those still round to 0.
  const small = digits >= 3 && Math.abs(n) < 0.01 && Math.abs(n) >= 1e-6;
  const r = small ? Number(n.toPrecision(2)) : Number(n.toFixed(digits));
  return Object.is(r, -0) || r === 0 ? '0' : String(r);
}

function coef(a: number, body: string): string {
  if (a === 1) return body;
  if (a === -1) return `-${body}`;
  return `${fmt(a)}${body}`;
}

/** Join signed terms: ["2x^2", "-3x", "1"] -> "2x^2 - 3x + 1". Zero terms are dropped. */
function join(terms: string[]): string {
  const live = terms.filter((t) => t !== '' && t !== '0');
  if (live.length === 0) return '0';
  return live
    .map((t, i) => {
      if (i === 0) return t;
      return t.startsWith('-') ? `- ${t.slice(1)}` : `+ ${t}`;
    })
    .join(' ');
}

function linearInner(b: number, c: number): string {
  // "bx + c" for use inside a function call
  return join([b === 0 ? '' : coef(b, 'x'), c === 0 ? '' : fmt(c)]);
}

function scaled(a: number, body: string): string {
  if (a === 0) return '0';
  return coef(a, body);
}

const r = (p: Record<string, number>, k: string) => Number(fmt(p[k] ?? 0));

/** "x − h" written the friendly way: "x", "x - 3", "x + 0.5". */
function shift(h: number): string {
  return h === 0 ? 'x' : h > 0 ? `x - ${fmt(h)}` : `x + ${fmt(-h)}`;
}

export const FAMILIES: Record<FamilyId, FamilyDef> = {
  linear: {
    id: 'linear',
    name: 'Linear',
    template: 'y = mx + b',
    params: [
      { key: 'm', symbol: 'm', name: 'Slope', min: -5, max: 5, step: 0.05, value: 0.5, role: 'How steeply the shot climbs: up m for every 1 step forward. Negative dives.' },
      { key: 'b', symbol: 'b', name: 'Intercept', min: -10, max: 10, step: 0.5, value: 0, role: 'Slides the line up or down. Shots are anchored to you, so b never changes where the shot goes.' },
    ],
    build: (p) => join([r(p, 'm') === 0 ? '' : coef(r(p, 'm'), 'x'), fmt(r(p, 'b'))]),
  },
  quadratic: {
    id: 'quadratic',
    name: 'Quadratic',
    template: 'y = ax² + bx + c',
    params: [
      { key: 'a', symbol: 'a', name: 'Bend', min: -1, max: 1, step: 0.01, value: -0.08, role: 'Curves the shot. Negative arcs it down like a thrown ball; bigger means a tighter arc.' },
      { key: 'b', symbol: 'b', name: 'Launch slope', min: -5, max: 5, step: 0.05, value: 1.2, role: 'The slope the shot leaves you at. The peak sits at x = −b / 2a.' },
      { key: 'c', symbol: 'c', name: 'Shift', min: -10, max: 10, step: 0.5, value: 0, role: 'Moves the curve up or down. Anchoring cancels it in battle.' },
    ],
    build: (p) =>
      join([r(p, 'a') === 0 ? '' : coef(r(p, 'a'), 'x^2'), r(p, 'b') === 0 ? '' : coef(r(p, 'b'), 'x'), fmt(r(p, 'c'))]),
  },
  absolute: {
    id: 'absolute',
    name: 'Absolute value',
    template: 'y = a|x − h| + k',
    params: [
      { key: 'a', symbol: 'a', name: 'Steepness', min: -3, max: 3, step: 0.05, value: -0.6, role: 'How steep both arms of the V are. Negative climbs first, then bounces down; positive dives first, then bounces up.' },
      { key: 'h', symbol: 'h', name: 'Bounce point', min: 0, max: 24, step: 0.5, value: 8, role: 'Where the corner of the V is: x = h. The shot flies straight until here, then turns.' },
      { key: 'k', symbol: 'k', name: 'Vertical shift', min: -10, max: 10, step: 0.5, value: 0, role: 'Moves the V up or down. Anchoring cancels it in battle.' },
    ],
    build: (p) => join([scaled(r(p, 'a'), `|${shift(r(p, 'h'))}|`), fmt(r(p, 'k'))]),
  },
  cubic: {
    id: 'cubic',
    name: 'Cubic',
    template: 'y = a(x − h)³ + k',
    params: [
      { key: 'a', symbol: 'a', name: 'Stretch', min: -0.03, max: 0.03, step: 0.0005, value: 0.005, role: 'How tall the S is. Cubes grow fast, so tiny values go a long way. Negative flips it into a dive.' },
      { key: 'h', symbol: 'h', name: 'Flat spot', min: -6, max: 24, step: 0.5, value: 10, role: 'The flat middle of the S, at x = h. The shot levels off here, then takes off again.' },
      { key: 'k', symbol: 'k', name: 'Vertical shift', min: -10, max: 10, step: 0.5, value: 0, role: 'Moves the curve up or down. Anchoring cancels it in battle.' },
    ],
    build: (p) => {
      const h = r(p, 'h');
      return join([scaled(r(p, 'a'), h === 0 ? 'x^3' : `(${shift(h)})^3`), fmt(r(p, 'k'))]);
    },
  },
  sqrt: {
    id: 'sqrt',
    name: 'Square root',
    template: 'y = a√(x − h) + k',
    params: [
      { key: 'a', symbol: 'a', name: 'Stretch', min: -5, max: 5, step: 0.05, value: 2, role: 'How tall the climb is. Negative launches downward instead.' },
      { key: 'h', symbol: 'h', name: 'Start', min: -8, max: 0, step: 0.1, value: 0, role: 'Where the curve begins, at x = h. It must be at or behind you (h ≤ 0). At h = 0 the shot leaves you straight up.' },
      { key: 'k', symbol: 'k', name: 'Vertical shift', min: -10, max: 10, step: 0.5, value: 0, role: 'Moves the curve up or down. Anchoring cancels it in battle.' },
    ],
    build: (p) => join([scaled(r(p, 'a'), `√(${shift(r(p, 'h'))})`), fmt(r(p, 'k'))]),
  },
  exponential: {
    id: 'exponential',
    name: 'Exponential',
    template: 'y = a·e^(bx) + c',
    params: [
      { key: 'a', symbol: 'a', name: 'Size', min: -5, max: 5, step: 0.01, value: 0.3, role: 'Scales the whole curve. Negative turns the blast-off into a plunge.' },
      { key: 'b', symbol: 'b', name: 'Growth', min: -0.6, max: 0.6, step: 0.01, value: 0.15, role: 'Positive b: slow start, then blast-off. Negative b: fast start that levels out. Every 1 ÷ b units the curve grows by a factor of e.' },
      { key: 'c', symbol: 'c', name: 'Vertical shift', min: -10, max: 10, step: 0.5, value: 0, role: 'Moves the curve up or down. Anchoring cancels it in battle.' },
    ],
    build: (p) => join([scaled(r(p, 'a'), `e^(${linearInner(r(p, 'b'), 0)})`), fmt(r(p, 'c'))]),
  },
  sine: {
    id: 'sine',
    name: 'Sine',
    template: 'y = a·sin(bx + c) + d',
    params: [
      { key: 'a', symbol: 'a', name: 'Amplitude', min: -10, max: 10, step: 0.1, value: 3, role: 'How far the wave swings above and below its middle line.' },
      { key: 'b', symbol: 'b', name: 'Frequency', min: 0.05, max: 4, step: 0.01, value: 0.5, role: 'How fast it wiggles. One full wave every 2π / b units forward.' },
      { key: 'c', symbol: 'c', name: 'Phase', min: -3.14, max: 3.14, step: 0.01, value: 0, role: 'Where in its wave the shot starts. Changes whether it leaves you rising or falling.' },
      { key: 'd', symbol: 'd', name: 'Vertical shift', min: -10, max: 10, step: 0.5, value: 0, role: 'Moves the whole wave up or down. Anchoring cancels it in battle.' },
    ],
    build: (p) => join([scaled(r(p, 'a'), `sin(${linearInner(r(p, 'b'), r(p, 'c'))})`), fmt(r(p, 'd'))]),
  },
  tangent: {
    id: 'tangent',
    name: 'Tangent',
    template: 'y = a·tan(bx + c) + d',
    params: [
      { key: 'a', symbol: 'a', name: 'Stretch', min: -10, max: 10, step: 0.1, value: 1, role: 'Scales the whole curve. Negative flips the late surge downward.' },
      { key: 'b', symbol: 'b', name: 'Frequency', min: 0.02, max: 2, step: 0.01, value: 0.08, role: 'Sets where the asymptote is: x = (π/2 − c) / b. Smaller pushes the surge farther away.' },
      { key: 'c', symbol: 'c', name: 'Phase', min: -1.5, max: 1.5, step: 0.01, value: 0, role: 'Starts the shot further along the curve, closer to the surge.' },
      { key: 'd', symbol: 'd', name: 'Vertical shift', min: -10, max: 10, step: 0.5, value: 0, role: 'Moves the curve up or down. Anchoring cancels it in battle.' },
    ],
    build: (p) => join([scaled(r(p, 'a'), `tan(${linearInner(r(p, 'b'), r(p, 'c'))})`), fmt(r(p, 'd'))]),
  },
  log: {
    id: 'log',
    name: 'Logarithmic',
    template: 'y = a·ln(x − h) + k',
    params: [
      { key: 'a', symbol: 'a', name: 'Stretch', min: -10, max: 10, step: 0.1, value: 2, role: 'How tall the climb is. Negative makes it plunge then level out.' },
      { key: 'h', symbol: 'h', name: 'Asymptote', min: -8, max: -0.05, step: 0.05, value: -0.5, role: 'The wall the curve hugs at x = h. Must be left of you (negative). Closer to 0 means a sharper launch.' },
      { key: 'k', symbol: 'k', name: 'Vertical shift', min: -10, max: 10, step: 0.5, value: 0, role: 'Moves the curve up or down. Anchoring cancels it in battle.' },
    ],
    build: (p) => join([scaled(r(p, 'a'), `ln(${shift(r(p, 'h'))})`), fmt(r(p, 'k'))]),
  },
};

/** Lesson order: simplest shapes first, trig last. */
export const FAMILY_ORDER: FamilyId[] = ['linear', 'quadratic', 'absolute', 'cubic', 'sqrt', 'exponential', 'log', 'sine', 'tangent'];

export function defaultParams(id: FamilyId): Record<string, number> {
  return Object.fromEntries(FAMILIES[id].params.map((p) => [p.key, p.value]));
}

export function buildExpr(id: FamilyId, p: Record<string, number>): string {
  return FAMILIES[id].build(p);
}

export const FAMILY_LABEL: Record<string, string> = {
  linear: 'Linear',
  quadratic: 'Quadratic',
  absolute: 'Absolute value',
  cubic: 'Cubic',
  sqrt: 'Square root',
  exponential: 'Exponential',
  sine: 'Sine',
  tangent: 'Tangent',
  log: 'Logarithmic',
  constant: 'Flat',
  other: 'Custom',
};
