import { FAMILIES, FAMILY_ORDER } from '../../engine/families.ts';
import type { FamilyId } from '../../engine/types.ts';
import { store } from '../dom.ts';

/** A family note (tag = its family id) or one of your own (tag = 'mine'). */
export interface Note {
  id: string;
  title: string;
  body: string;
  tag: FamilyId | 'mine';
  updated: number;
}

const KEY = 'ff-notes';
export const MAX_NOTES = 200;
export const MAX_BODY = 20_000;

/** Facts worth having on hand mid-battle, per family. */
const FACTS: Record<FamilyId, string[]> = {
  linear: ['Slope = rise ÷ run. To hit a target 16 ahead and 6 up: m = 6 ÷ 16 = 0.375.', 'Negative m dives. m = 0 flies flat.'],
  quadratic: ['Negative a arcs down like a thrown ball.', 'The peak is at x = −b ÷ 2a. A lob lands back at your height at x = −b ÷ a.'],
  absolute: ['The corner of the V is at x = h. Type it as |x − h| or abs(x − h).', 'Past the corner the shot is at a(x − 2h): it comes back to your height at x = 2h.'],
  cubic: ['The flat spot of the S is at x = h.', 'Cubes grow fast: a only needs to be tiny (0.001 to 0.01).'],
  sqrt: ['√x only exists for x ≥ 0, so h must be 0 or negative.', 'h = 0 launches straight up; the climb slows down the further it goes.'],
  exponential: ['Positive b: slow start, then blast-off. Negative b: fast start that levels off.', 'Grows by a factor of e (≈ 2.718) every 1 ÷ b units. Type e^( with the eˣ key.'],
  log: ['ln only exists for positive inputs, so in ln(x − h) keep h negative.', 'h close to 0 = sharp launch. ln(1) = 0 and ln(e) = 1.'],
  sine: ['One full wave every 2π ÷ b units. Radians: π ≈ 3.14.', 'With c = 0 the first crest is at x = π ÷ 2b and it crosses zero at x = π ÷ b.'],
  tangent: ['Asymptote (the surge) at x = (π/2 − c) ÷ b.', 'Put the asymptote just past the target to stay low, then surge up.'],
};

const EXAMPLE: Record<FamilyId, string> = {
  linear: '0.4x',
  quadratic: '-0.05x^2 + x',
  absolute: '-0.6|x - 8|',
  cubic: '0.004(x - 8)^3',
  sqrt: '1.5√(x)',
  exponential: '0.3e^(0.15x)',
  log: '1.5ln(x + 0.3)',
  sine: '3sin(0.3x)',
  tangent: '0.5tan(0.07x)',
};

export function familyTemplate(f: FamilyId): string {
  const def = FAMILIES[f];
  return [
    `${def.template}`,
    '',
    'WHAT EACH LETTER DOES',
    ...def.params.map((p) => `• ${p.symbol} (${p.name}): ${p.role}`),
    '',
    'KEY FACTS',
    ...FACTS[f].map((t) => `• ${t}`),
    '',
    'TRY THIS SHOT',
    `  y = ${EXAMPLE[f]}`,
    '',
    'SHOTS THAT WORKED FOR ME',
    '• ',
    '',
    'WHAT I STILL NEED TO PRACTICE',
    '• ',
  ].join('\n');
}

/** Starting points for new notes of your own. */
export const TEMPLATES: { id: string; name: string; title: string; body: string }[] = [
  { id: 'blank', name: 'Blank note', title: 'New note', body: '' },
  {
    id: 'plan',
    name: 'Battle plan',
    title: 'Battle plan',
    body: ['MY GO-TO SHOTS', '• Straight shot: ', '• Over a wall: ', '• Through a gap: ', '', 'WHEN TO USE MY POWER-UP', '• ', '', 'LOCK IN EARLY WHEN', '• ', '', 'THINGS THAT GOT ME KNOCKED OUT', '• '].join('\n'),
  },
  {
    id: 'shot',
    name: 'Shot to remember',
    title: 'Shot to remember',
    body: ['THE SHOT', '  y = ', '', 'WHAT IT DID', '• ', '', 'WHY IT WORKED', '• ', '', 'CHANGE THIS NEXT TIME', '• '].join('\n'),
  },
  {
    id: 'goals',
    name: 'Practice goals',
    title: 'Practice goals',
    body: ['THIS WEEK I WANT TO', '[ ] ', '[ ] ', '[ ] ', '', 'FUNCTIONS I FIND HARD', '• ', '', 'DONE', '[x] '].join('\n'),
  },
];

const seed = (): Note[] =>
  FAMILY_ORDER.map((f, i) => ({ id: `fam-${f}`, title: FAMILIES[f].name, body: familyTemplate(f), tag: f, updated: i }));

function valid(v: unknown): v is Note {
  if (typeof v !== 'object' || v === null) return false;
  const n = v as Record<string, unknown>;
  return typeof n.id === 'string' && typeof n.title === 'string' && typeof n.body === 'string' && typeof n.tag === 'string' && typeof n.updated === 'number';
}

export function loadNotes(): Note[] {
  try {
    const raw = store.get(KEY);
    if (raw === null) return seed();
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter(valid) : seed();
  } catch {
    return seed();
  }
}

export function saveNotes(notes: Note[]): void {
  store.set(KEY, JSON.stringify(notes.slice(0, MAX_NOTES)));
}

export const newId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
