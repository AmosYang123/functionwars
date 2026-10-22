import { boxPoly } from '../../engine/geometry.ts';
import { makeObstacle } from '../../engine/map.ts';
import type { FamilyId, Obstacle, Vec } from '../../engine/types.ts';

/** Lessons use the shooter's own frame: you stand at (0, 0) facing +x, exactly as in battle. */
export const LESSON_BOUNDS = { minX: -4, maxX: 26, minY: -10, maxY: 10 };

export interface Scene {
  target: Vec;
  obstacles: () => Obstacle[];
}

export interface LessonStep {
  title: string;
  /** Paragraphs. Text between backticks renders as math. */
  body: string[];
  /** Parameter values loaded when the step opens. */
  params?: Record<string, number>;
  scene?: Scene;
  /** A live condition on the sliders, with the reasoning that leads to it. */
  task?: { text: string; check: (p: Record<string, number>) => boolean };
  /** Step completes only when a fired shot hits the target. */
  fire?: boolean;
  /** Parameters shown as sliders on this step; the rest stay fixed. */
  sliders?: string[];
  /** The player types the whole function in the bottom bar (challenges). */
  type?: boolean;
}

export interface Lesson {
  id: FamilyId;
  title: string;
  tagline: string;
  /** Example shown as the typing placeholder. */
  example: string;
  steps: LessonStep[];
}

const solid = (id: string, x0: number, y0: number, x1: number, y1: number) => makeObstacle(id, 'wall', boxPoly(x0, y0, x1, y1), true);
const rock = (id: string, x: number, y: number, r: number) => makeObstacle(id, 'boulder', { kind: 'circle', x, y, r }, true);
const near = (v: number, to: number, tol: number) => Math.abs(v - to) <= tol;

export const LESSONS: Lesson[] = [
  {
    id: 'linear',
    title: 'Linear',
    tagline: 'Straight shots and how aiming works',
    example: '0.4x',
    steps: [
      {
        sliders: ['m'],
        title: 'Your own graph',
        body: [
          'Every shot is a function of x, drawn from where you stand. You are the origin: x is the distance in front of you, y is the height above or below you.',
          'The simplest shot is a straight line, `y = mx + b`. Drag the sliders and watch the bright path change.',
        ],
        params: { m: 0.5, b: 0 },
      },
      {
        sliders: ['m'],
        title: 'Slope m',
        body: [
          'm is the slope: how many units the shot rises for every 1 unit it travels forward. `m = 1` climbs at 45°, `m = 0` flies flat, and a negative m dives.',
        ],
        params: { m: 0.5, b: 0 },
        task: { text: 'Make the shot dive: set m below 0.', check: (p) => p.m < 0 },
      },
      {
        sliders: ['b'],
        title: 'Intercept b, and why it does nothing here',
        body: [
          'The dashed line is the true graph of your equation. The bright path is your shot.',
          'Shots are anchored to you: the game slides your curve up or down so it starts where you stand. Mathematically the shot follows `y = f(x) − f(0)`. So b moves the dashed graph, but your shot stays put.',
        ],
        params: { m: 0.5, b: 0 },
        task: { text: 'Set b to 4 or more and notice the shot path does not move.', check: (p) => p.b >= 4 },
      },
      {
        sliders: ['m'],
        title: 'Aiming: rise over run',
        body: [
          'Here is a target. Hover over it: the readout shows its position from you. It sits 16 forward and 6 up.',
          'A line through the origin and that point has slope rise ÷ run = `6 ÷ 16 = 0.375`.',
        ],
        params: { m: 0.1, b: 0 },
        scene: { target: { x: 16, y: 6 }, obstacles: () => [] },
        task: { text: 'Set m so the line passes through the target (within its radius).', check: (p) => near(p.m * 16, 6, 0.5) },
      },
      {
        sliders: ['m'],
        title: 'Fire',
        body: ['Your slope passes through the target. The preview is exactly the path the shot will take, so if the ring lands on the target, it hits. Fire.'],
        scene: { target: { x: 16, y: 6 }, obstacles: () => [] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: downhill',
        body: ['Hit this target on your own. Read its position, work out the slope, fire.'],
        params: { m: 0.5, b: 0 },
        scene: { target: { x: 20, y: -5 }, obstacles: () => [] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: over the low wall',
        body: ['A straight line can still clear a low wall if it is steep enough by the time it gets there. Check the height at the wall: `y = m × 8`.'],
        params: { m: 0.1, b: 0 },
        scene: { target: { x: 22, y: 9.5 }, obstacles: () => [solid('w', 8, -10, 9, 2)] },
        fire: true,
      },
    ],
  },
  {
    id: 'quadratic',
    title: 'Quadratic',
    tagline: 'Arcs over walls',
    example: '-0.05x^2 + x',
    steps: [
      {
        sliders: ['a'],
        title: 'The parabola',
        body: [
          '`y = ax² + bx + c` is a parabola: a U shape, or an upside-down U when a is negative. In battle that upside-down U is a lob, like a thrown ball.',
        ],
        params: { a: -0.08, b: 1.2, c: 0 },
      },
      {
        sliders: ['a'],
        title: 'a bends the shot',
        body: ['a decides the bend. Negative a arcs downward, positive a curves upward. The further a is from 0, the tighter the curve.'],
        params: { a: -0.08, b: 1.2, c: 0 },
        task: { text: 'Make the parabola open upward: set a above 0.', check: (p) => p.a > 0 },
      },
      {
        sliders: ['b'],
        title: 'b is your launch slope',
        body: [
          'Because shots start at you, b is the slope your shot leaves at, just like m for a line.',
          'The peak of the arch is at `x = −b ÷ 2a`. With `a = −0.1` and `b = 2`, the peak is at `x = 10`.',
        ],
        params: { a: -0.1, b: 1.2, c: 0 },
        task: { text: 'Put the peak 10 units in front of you (a must be negative).', check: (p) => p.a < 0 && near(-p.b / (2 * p.a), 10, 1) },
      },
      {
        sliders: ['c'],
        title: 'c shifts, anchoring cancels',
        body: ['c moves the whole parabola up and down, like b did for lines. Your shot is anchored, so c changes the dashed graph but never the shot.'],
        params: { a: -0.1, b: 2, c: 0 },
      },
      {
        sliders: ['a', 'b'],
        title: 'Guided: over the wall',
        body: [
          'A wall blocks the straight shot. The target is level with you, 20 units away.',
          'An arch comes back to its starting height at twice its peak distance. So put the peak at 10: `−b ÷ 2a = 10`, which means `b = −20a`.',
          'The peak height is `−b² ÷ 4a`. With `b = −20a` that is `−100a`. The wall top is at 4, so a must be below −0.04.',
        ],
        params: { a: -0.02, b: 0.4, c: 0 },
        scene: { target: { x: 20, y: 0 }, obstacles: () => [solid('w', 9.5, -10, 10.5, 4)] },
        task: { text: 'Choose a below −0.04, then set b = −20a.', check: (p) => p.a < -0.04 && near(p.b, -20 * p.a, 0.08) },
      },
      {
        sliders: ['a', 'b'],
        title: 'Fire the lob',
        body: ['Peak over the wall, landing on the target. Fire.'],
        scene: { target: { x: 20, y: 0 }, obstacles: () => [solid('w', 9.5, -10, 10.5, 4)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: around the boulder',
        body: ['The target is below you, past a boulder. Arc over it or curve under it.'],
        params: { a: -0.08, b: 1.2, c: 0 },
        scene: { target: { x: 18, y: -6 }, obstacles: () => [rock('r', 8, -2, 2.5)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: tall wall',
        body: ['The wall is taller and the target sits higher. You need more than 7 units of height at the wall and 5 at the target.'],
        params: { a: -0.08, b: 1.2, c: 0 },
        scene: { target: { x: 24, y: 5 }, obstacles: () => [solid('w', 12, -10, 13, 7)] },
        fire: true,
      },
    ],
  },
  {
    id: 'absolute',
    title: 'Absolute value',
    tagline: 'Bounce shots that turn a corner',
    example: '-0.6|x - 8|',
    steps: [
      {
        sliders: ['a'],
        title: 'The V',
        body: [
          '`|x|` is the absolute value: the distance from 0, so it is never negative. `|3| = 3` and `|−3| = 3`.',
          'Its graph is a V. In battle that is a bounce shot: it flies straight, hits a corner, and turns. The form is `y = a|x − h| + k`.',
        ],
        params: { a: -0.6, h: 8, k: 0 },
      },
      {
        sliders: ['h'],
        title: 'h is the corner',
        body: [
          'The corner of the V sits at `x = h`. Before it the shot flies one way, after it the shot turns.',
          'Type it with the bars key as `|x − 8|`, or as `abs(x − 8)`.',
        ],
        params: { a: -0.6, h: 8, k: 0 },
        task: { text: 'Move the corner 12 units in front of you.', check: (p) => near(p.h, 12, 0.5) },
      },
      {
        sliders: ['a'],
        title: 'a sets the steepness',
        body: ['a is the slope of the arms. Negative a climbs first and bounces down, like a ball off a ceiling. Positive a dives first and bounces up, like a ball off the floor.'],
        params: { a: -0.6, h: 8, k: 0 },
        task: { text: 'Make it dive first: set a above 0.', check: (p) => p.a > 0 },
      },
      {
        sliders: ['k'],
        title: 'k shifts, anchoring cancels',
        body: ['k moves the V up and down. Your shot is anchored to you, so only the dashed graph moves.'],
        params: { a: -0.6, h: 8, k: 0 },
      },
      {
        sliders: ['a', 'h'],
        title: 'Guided: bounce over the wall',
        body: [
          'The wall top is at 4 and the target is level with you, 20 units away.',
          'Past the corner the shot is at `a(x − 2h)`, so a climbing V comes back to your height at twice the corner distance. Put the corner at 10.',
          'At the corner the shot is `−10a` high. To clear 4 you need a below −0.4.',
        ],
        params: { a: -0.2, h: 6, k: 0 },
        scene: { target: { x: 20, y: 0 }, obstacles: () => [solid('w', 9.5, -10, 10.5, 4)] },
        task: { text: 'Set the corner h to 10 and a below −0.45.', check: (p) => near(p.h, 10, 0.25) && p.a < -0.45 },
      },
      {
        sliders: ['a', 'h'],
        title: 'Fire the bounce',
        body: ['Up to the corner over the wall, then down onto the target. Fire.'],
        scene: { target: { x: 20, y: 0 }, obstacles: () => [solid('w', 9.5, -10, 10.5, 4)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: under the shelf',
        body: ['A shelf blocks the straight shot to a high target. Dive under it first, then bounce up.'],
        params: { a: -0.6, h: 8, k: 0 },
        scene: { target: { x: 20, y: 6 }, obstacles: () => [solid('shelf', 3, 1, 10, 1.6)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: bank shot',
        body: ['The target is low, behind a wall. Climb over the wall, then bounce down onto it.'],
        params: { a: -0.6, h: 8, k: 0 },
        scene: { target: { x: 22, y: -4 }, obstacles: () => [solid('w', 7.5, -10, 8.5, 3)] },
        fire: true,
      },
    ],
  },
  {
    id: 'cubic',
    title: 'Cubic',
    tagline: 'S-curves that level off, then take off',
    example: '0.004(x - 8)^3',
    steps: [
      {
        sliders: ['a'],
        title: 'The cube',
        body: [
          '`x³` means x × x × x. Cubes grow fast and keep their sign: `2³ = 8` and `(−2)³ = −8`. The graph of `y = x³` is an S with a flat spot in the middle.',
          'The form is `y = a(x − h)³ + k`. In battle: rise, level off, then take off again.',
        ],
        params: { a: 0.005, h: 10, k: 0 },
      },
      {
        sliders: ['h'],
        title: 'h is the flat spot',
        body: ['The flat spot of the S sits at `x = h`. In front of you it makes an S. Behind you, the shot just keeps getting steeper. Past the target, it starts steep and eases off.'],
        params: { a: 0.005, h: 10, k: 0 },
        task: { text: 'Move the flat spot 14 units in front of you.', check: (p) => near(p.h, 14, 0.5) },
      },
      {
        sliders: ['a'],
        title: 'a stretches and flips',
        body: ['Cubes get big fast, so a only needs to be tiny: `0.005 × 10³ = 5`. Negative a flips the S into a dive.'],
        params: { a: 0.005, h: 10, k: 0 },
        task: { text: 'Flip it into a dive: set a below 0.', check: (p) => p.a < 0 },
      },
      {
        sliders: ['k'],
        title: 'k shifts, anchoring cancels',
        body: ['k moves the curve up and down. Anchoring cancels it, so only the dashed graph moves.'],
        params: { a: 0.005, h: 10, k: 0 },
      },
      {
        sliders: ['h'],
        title: 'Guided: duck under the overhang',
        body: [
          'An overhang hangs over the middle and the target is high, at (20, 9). A straight line to it runs into the overhang.',
          'An S can stay low while it levels off, then climb late. Put the flat spot under the overhang, at x = 8.',
        ],
        params: { a: 0.004, h: 14, k: 0 },
        scene: { target: { x: 20, y: 9 }, obstacles: () => [solid('over', 7, 3.2, 13, 10)] },
        task: { text: 'Set the flat spot h to 8.', check: (p) => near(p.h, 8, 0.25) },
      },
      {
        sliders: ['a'],
        title: 'Guided: aim the S',
        body: ['At the target the shot is at `a·((20 − 8)³ + 8³) = 2240a`. For a height of 9 that is `a ≈ 0.004`. Tune a until the ring lands on the target, then fire.'],
        scene: { target: { x: 20, y: 9 }, obstacles: () => [solid('over', 7, 3.2, 13, 10)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: soft landing',
        body: ['A low step in front, a ceiling over the far side. Launch steep and ease into the target: put the flat spot near the target.'],
        params: { a: 0.005, h: 10, k: 0 },
        scene: { target: { x: 18, y: 6 }, obstacles: () => [solid('step', 1, -10, 2, 0.6), solid('ceil', 10, 7.5, 26, 10)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: late dive',
        body: ['Stay high over the pillar, then dive. With the flat spot behind you (h below 0), the dive keeps getting steeper.'],
        params: { a: 0.005, h: 10, k: 0 },
        scene: { target: { x: 22, y: -8 }, obstacles: () => [solid('pillar', 7, -10, 13, -2.6)] },
        fire: true,
      },
    ],
  },
  {
    id: 'sqrt',
    title: 'Square root',
    tagline: 'A rocket launch that eases off',
    example: '1.5√(x)',
    steps: [
      {
        sliders: ['a'],
        title: 'The square root',
        body: [
          '`√x` asks: what number times itself makes x? `√9 = 3` and `√16 = 4`. It only exists for x ≥ 0.',
          'It climbs very steeply at first, then slower and slower: from 0 to 1 it gains 1, but from 99 to 100 it gains only 0.05. The form is `y = a√(x − h) + k`.',
        ],
        params: { a: 2, h: 0, k: 0 },
      },
      {
        sliders: ['h'],
        title: 'h is where it starts',
        body: [
          'The curve begins at `x = h`. You stand at x = 0, so h must be 0 or negative, or your shot would start where the function does not exist.',
          'At `h = 0` the shot leaves you straight up. Move h behind you for a gentler launch.',
        ],
        params: { a: 2, h: 0, k: 0 },
        task: { text: 'Move the start behind you: set h below −3.', check: (p) => p.h < -3 },
      },
      {
        sliders: ['a'],
        title: 'a stretches and flips',
        body: ['a sets how tall the climb is. Negative a launches downward instead.'],
        params: { a: 2, h: 0, k: 0 },
        task: { text: 'Launch downward: set a below 0.', check: (p) => p.a < 0 },
      },
      {
        sliders: ['k'],
        title: 'k shifts, anchoring cancels',
        body: ['k moves the curve up and down. Anchoring cancels it, so only the dashed graph moves.'],
        params: { a: 2, h: 0, k: 0 },
      },
      {
        sliders: ['h'],
        title: 'Guided: hop the curb',
        body: [
          'A curb right in front of you blocks low shots, and a ceiling blocks high arcs. The target is at (20, 7).',
          'Start the curve exactly where you stand, h = 0: it leaves you straight up and clears the curb.',
        ],
        params: { a: 1.55, h: -3, k: 0 },
        scene: { target: { x: 20, y: 7 }, obstacles: () => [solid('curb', 0.8, -10, 2, 1.2), solid('ceil', 6, 8, 26, 10)] },
        task: { text: 'Set h to 0.', check: (p) => near(p.h, 0, 0.05) },
      },
      {
        sliders: ['a'],
        title: 'Guided: set the height',
        body: ['At the target the shot is at `a·√20 ≈ 4.47a`. You want 7, so `a ≈ 7 ÷ 4.47 ≈ 1.57`. Adjust a until the ring sits on the target, then fire.'],
        scene: { target: { x: 20, y: 7 }, obstacles: () => [solid('curb', 0.8, -10, 2, 1.2), solid('ceil', 6, 8, 26, 10)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: drop shot',
        body: ['Upside down: a lip above you, a floor below. Launch downward under the lip and ease onto the target.'],
        params: { a: 2, h: 0, k: 0 },
        scene: { target: { x: 20, y: -6 }, obstacles: () => [solid('lip', 0.8, -0.9, 2, 10), solid('floor', 8, -10, 26, -7)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: over the post',
        body: ['The post is close and the target is high. A square root climbs fastest right at the start: use that.'],
        params: { a: 2, h: 0, k: 0 },
        scene: { target: { x: 24, y: 8 }, obstacles: () => [solid('post', 5, -10, 6, 3)] },
        fire: true,
      },
    ],
  },
  {
    id: 'exponential',
    title: 'Exponential',
    tagline: 'Slow start, then blast-off',
    example: '0.3e^(0.15x)',
    steps: [
      {
        sliders: ['b'],
        title: 'Growth that snowballs',
        body: [
          'An exponential multiplies instead of adding. `e ≈ 2.718` is the natural growth number, and `e^x` gets about 2.7 times bigger with every step.',
          'In `y = a·e^(bx) + c` the shot creeps along, then blasts off. Type `e^(` with the eˣ key.',
        ],
        params: { a: 0.3, b: 0.15, c: 0 },
      },
      {
        sliders: ['b'],
        title: 'b is the growth rate',
        body: [
          'The curve grows by a factor of e every `1 ÷ b` units. Bigger b means an earlier, sharper blast-off.',
          'Negative b flips the idea: the shot leaves you fast and levels off, because `e^(bx)` shrinks toward 0.',
        ],
        params: { a: 0.3, b: 0.15, c: 0 },
        task: { text: 'Make it level off: set b below 0.', check: (p) => p.b < 0 },
      },
      {
        sliders: ['a'],
        title: 'a scales and flips',
        body: ['a scales the whole curve. A negative a turns the blast-off into a plunge.'],
        params: { a: 0.3, b: 0.15, c: 0 },
        task: { text: 'Turn it into a plunge: set a below 0.', check: (p) => p.a < 0 },
      },
      {
        sliders: ['c'],
        title: 'c shifts, anchoring cancels',
        body: ['c moves the curve up and down. Anchoring cancels it, so only the dashed graph moves.'],
        params: { a: 0.3, b: 0.15, c: 0 },
      },
      {
        sliders: ['b'],
        title: 'Guided: under the shelf',
        body: [
          'A shelf sits just above your line of fire until x = 12, and the target is high, at (21, 8).',
          'Exponential shots hug the ground, then shoot up. Set b to 0.2: by x = 12 the curve has barely moved, and by x = 21 it has grown more than six times as much.',
        ],
        params: { a: 0.12, b: 0.08, c: 0 },
        scene: { target: { x: 21, y: 8 }, obstacles: () => [solid('shelf', 3, 1.5, 12, 2.2)] },
        task: { text: 'Set b to 0.2.', check: (p) => near(p.b, 0.2, 0.005) },
      },
      {
        sliders: ['a'],
        title: 'Guided: set the height',
        body: ['At the target the shot is at `a·(e^(21b) − 1) ≈ 65.7a`. For a height of 8 that is `a ≈ 0.12`. Tune a until the ring lands on the target, then fire.'],
        scene: { target: { x: 21, y: 8 }, obstacles: () => [solid('shelf', 3, 1.5, 12, 2.2)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: quick launch',
        body: ['A curb in front, a ceiling over the far side. Use a negative b: launch fast, then level off onto the target.'],
        params: { a: 0.3, b: 0.15, c: 0 },
        scene: { target: { x: 22, y: 5 }, obstacles: () => [solid('curb', 1, -10, 2.2, 1.4), solid('ceil', 8, 6.5, 26, 10)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: trapdoor',
        body: ['The floor holds until x = 15, then drops into a pit. Skim the floor, then plunge late.'],
        params: { a: 0.3, b: 0.15, c: 0 },
        scene: { target: { x: 21, y: -8 }, obstacles: () => [solid('floor', 2, -10, 15, -1.2)] },
        fire: true,
      },
    ],
  },
  {
    id: 'log',
    title: 'Logarithmic',
    tagline: 'A sharp launch that flattens out',
    example: '1.5ln(x + 0.3)',
    steps: [
      {
        sliders: ['a'],
        title: 'The logarithm',
        body: [
          '`ln(x)` is the natural logarithm. It only exists for `x > 0`, it plunges toward −∞ as x approaches 0 (a vertical asymptote), and it keeps growing forever, slower and slower.',
          'Useful landmarks: `ln(1) = 0` and `ln(e) = 1`, where `e ≈ 2.718`.',
        ],
        params: { a: 2, h: -0.5, k: 0 },
      },
      {
        sliders: ['h'],
        title: 'h is the asymptote, and the domain',
        body: [
          'In `y = a·ln(x − h) + k` the curve exists only where `x > h`, and the asymptote sits at `x = h`.',
          'You stand at x = 0, so h must be negative or your shot would start where the function does not exist. The closer h is to 0, the sharper your launch.',
        ],
        params: { a: 2, h: -2, k: 0 },
        task: { text: 'Move h close to 0 (above −0.3) for a sharp launch.', check: (p) => p.h > -0.3 },
      },
      {
        sliders: ['a'],
        title: 'a stretches and flips',
        body: ['a sets how tall the climb is. Negative a plunges first, then levels off.'],
        params: { a: 2, h: -0.5, k: 0 },
        task: { text: 'Make it plunge: set a below 0.', check: (p) => p.a < 0 },
      },
      {
        sliders: ['k'],
        title: 'k shifts, anchoring cancels',
        body: ['k moves the curve up or down. Your shot is anchored, so k only moves the dashed graph.'],
        params: { a: 2, h: -0.5, k: 0 },
      },
      {
        sliders: ['h'],
        title: 'Guided: jump the step, duck the ceiling',
        body: [
          'A step right in front of you blocks low shots. A ceiling further out blocks high arcs. The target is at (24, 5).',
          'A parabola steep enough to clear the step keeps rising into the ceiling. A logarithm climbs fast and then flattens: exactly this shape.',
          'Step 1: put the asymptote just behind you so the launch is sharp.',
        ],
        params: { a: 1, h: -2, k: 0 },
        scene: { target: { x: 24, y: 5 }, obstacles: () => [solid('step', 1, -10, 2.4, 1.5), solid('ceil', 8, 6.5, 24, 10)] },
        task: { text: 'Set h to about −0.3.', check: (p) => near(p.h, -0.3, 0.12) },
      },
      {
        sliders: ['a'],
        title: 'Guided: set the height',
        body: [
          'At the target the shot is at `a·(ln(24 − h) − ln(−h))`. With `h = −0.3` that bracket is about `ln(24.3) − ln(0.3) ≈ 4.39`, so `a ≈ 5 ÷ 4.39 ≈ 1.14`.',
          'Adjust a until the ring sits on the target and the path clears the step. Then fire.',
        ],
        scene: { target: { x: 24, y: 5 }, obstacles: () => [solid('step', 1, -10, 2.4, 1.5), solid('ceil', 8, 6.5, 24, 10)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: the plunge',
        body: ['Upside down: a lip above you, a floor below. Dive under the lip and level out over the floor.'],
        params: { a: 2, h: -0.5, k: 0 },
        scene: { target: { x: 22, y: -5 }, obstacles: () => [solid('lip', 1, -1.5, 2.4, 10), solid('floor', 8, -10, 24, -6.5)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: over the tower',
        body: ['A tall wall stands close. Launch hard so you are high early, then let the curve flatten onto the target.'],
        params: { a: 2, h: -1, k: 0 },
        scene: { target: { x: 14, y: 7 }, obstacles: () => [solid('w', 6, -10, 7, 5)] },
        fire: true,
      },
    ],
  },
  {
    id: 'sine',
    title: 'Sine',
    tagline: 'Waves that weave through gaps',
    example: '3sin(0.3x)',
    steps: [
      {
        sliders: ['a'],
        title: 'The wave',
        body: [
          '`y = a·sin(bx + c) + d` is a wave that repeats forever. Waves can go up, come back down, and go up again: no line or parabola can do that.',
          'Function War measures angles in radians. sin repeats every `2π ≈ 6.28` units of input, and `π/2 ≈ 1.57` is a quarter of a turn.',
        ],
        params: { a: 3, b: 0.5, c: 0, d: 0 },
      },
      {
        sliders: ['a'],
        title: 'Amplitude a',
        body: ['a is how far the wave swings above and below its middle line. A negative a flips the wave: it starts by going down.'],
        params: { a: 3, b: 0.5, c: 0, d: 0 },
        task: { text: 'Make the wave swing at least 5 units: set a to 5 or more.', check: (p) => p.a >= 5 },
      },
      {
        sliders: ['b'],
        title: 'Frequency b',
        body: ['b is how fast it wiggles. One full wave takes `2π ÷ b` units. Bigger b means shorter, tighter waves.'],
        params: { a: 3, b: 0.5, c: 0, d: 0 },
        task: { text: 'Make exactly one full wave every 20 units (b ≈ 2π ÷ 20 ≈ 0.31).', check: (p) => near((2 * Math.PI) / p.b, 20, 1.5) },
      },
      {
        sliders: ['c'],
        title: 'Phase c',
        body: [
          'c shifts where in its cycle the wave starts. With `c = π/2 ≈ 1.57` the wave starts at a crest, so your shot leaves you heading down.',
        ],
        params: { a: 3, b: 0.4, c: 0, d: 0 },
        task: { text: 'Set c to about 1.57 and watch the shot dip first.', check: (p) => near(p.c, 1.57, 0.15) },
      },
      {
        sliders: ['d'],
        title: 'Vertical shift d',
        body: ['d lifts the whole wave. Like every vertical shift, anchoring cancels it: move d and only the dashed graph moves.'],
        params: { a: 3, b: 0.4, c: 0, d: 0 },
      },
      {
        sliders: ['a'],
        title: 'Guided: over the wall, step 1',
        body: [
          'The wall blocks a flat shot. Its top is at y = 2. The target is level with you, 16 units away.',
          'A sine wave rises to a crest of height a. If that crest is over the wall, the shot clears it. So first: a must be bigger than 2. Give yourself margin.',
        ],
        params: { a: 1, b: 0.5, c: 0, d: 0 },
        scene: { target: { x: 16, y: 0 }, obstacles: () => [solid('w', 7.7, -10, 8.3, 2)] },
        task: { text: 'Set the amplitude a to at least 2.5.', check: (p) => p.a >= 2.5 },
      },
      {
        sliders: ['b'],
        title: 'Guided: step 2, place the crest',
        body: [
          'sin is highest when its input is `π/2`. With `c = 0` that happens at `bx = π/2`, so the crest is at `x = π ÷ 2b`.',
          'We want the crest over the wall at x = 8: `b = π ÷ 16 ≈ 0.196`. Bonus: the wave then comes back to zero at `x = π ÷ b = 16`, exactly where the target is.',
        ],
        scene: { target: { x: 16, y: 0 }, obstacles: () => [solid('w', 7.7, -10, 8.3, 2)] },
        task: { text: 'Keep a ≥ 2.5 and set b so the crest is near x = 8.', check: (p) => p.a >= 2.5 && near(p.c, 0, 0.2) && near(Math.PI / (2 * p.b), 8, 1.2) },
      },
      {
        sliders: ['a', 'b'],
        title: 'Guided: step 3, fire',
        body: ['Crest over the wall, zero at the target. Fire.'],
        scene: { target: { x: 16, y: 0 }, obstacles: () => [solid('w', 7.7, -10, 8.3, 2)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: two gaps',
        body: ['First gap high, second gap low, target level with you. Up, down, back to zero: a wave with two half-waves before the target.'],
        params: { a: 3, b: 0.5, c: 0, d: 0 },
        scene: {
          target: { x: 22, y: 0 },
          obstacles: () => [solid('a1', 5.7, -10, 6.3, 1), solid('a2', 5.7, 4, 6.3, 10), solid('b1', 13.7, -10, 14.3, -4), solid('b2', 13.7, -1, 14.3, 10)],
        },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: under the overhang',
        body: ['This time the obstacle hangs from above. You need a trough, not a crest, under it.'],
        params: { a: 3, b: 0.5, c: 0, d: 0 },
        scene: { target: { x: 16, y: 0 }, obstacles: () => [solid('o', 6, -1, 10, 10)] },
        fire: true,
      },
    ],
  },
  {
    id: 'tangent',
    title: 'Tangent',
    tagline: 'Stay low, then surge',
    example: '0.5tan(0.07x)',
    steps: [
      {
        sliders: ['b'],
        title: 'The surge',
        body: [
          '`tan(x) = sin(x) ÷ cos(x)`. Where cos is 0 the tangent is undefined: a vertical asymptote. Near it the curve shoots off to infinity.',
          'For a shot that means: gentle at first, then a sudden surge. Shots leave the arena as they race toward the asymptote.',
        ],
        params: { a: 1, b: 0.08, c: 0, d: 0 },
      },
      {
        sliders: ['b'],
        title: 'b places the asymptote',
        body: ['The first asymptote in front of you is at `x = (π/2 − c) ÷ b`. Smaller b pushes the surge further away.'],
        params: { a: 1, b: 0.12, c: 0, d: 0 },
        task: { text: 'Put the asymptote about 20 units away (b ≈ 1.57 ÷ 20 ≈ 0.079).', check: (p) => near((Math.PI / 2 - p.c) / p.b, 20, 1.5) },
      },
      {
        sliders: ['a'],
        title: 'a stretches and flips',
        body: ['a scales the curve. Negative a turns the surge into a dive.'],
        params: { a: 1, b: 0.08, c: 0, d: 0 },
        task: { text: 'Make the surge dive: set a below 0.', check: (p) => p.a < 0 },
      },
      {
        sliders: ['c'],
        title: 'Phase c',
        body: ['A positive c starts you further along the curve, so the surge arrives sooner and the shot leaves you steeper. d, as always, is cancelled by anchoring.'],
        params: { a: 1, b: 0.08, c: 0, d: 0 },
      },
      {
        sliders: ['b'],
        title: 'Guided: under the shelf',
        body: [
          'A shelf hangs just above your line of fire until x = 15, then the target is high up at (20, 8). A line or arch would hit the shelf.',
          'Tangent stays flat, then surges. Put the asymptote just past the target, around x = 21: `b = π/2 ÷ 21 ≈ 0.075`.',
        ],
        params: { a: 1, b: 0.12, c: 0, d: 0 },
        scene: { target: { x: 20, y: 8 }, obstacles: () => [solid('s', 3, 1.5, 15, 2.2)] },
        task: { text: 'Keep c at 0 and set b so the asymptote is between 20.5 and 23.', check: (p) => near(p.c, 0, 0.05) && (Math.PI / 2) / p.b > 20.5 && (Math.PI / 2) / p.b < 23 },
      },
      {
        sliders: ['a'],
        title: 'Guided: tune the height',
        body: [
          'Now scale it. At the target the curve is at `a·tan(20b)`. Raise or lower a until the preview ring lands on the target, while the path stays under the shelf. Then fire.',
        ],
        scene: { target: { x: 20, y: 8 }, obstacles: () => [solid('s', 3, 1.5, 15, 2.2)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: dive under the floor',
        body: ['Mirror image: stay above the ledge, then plunge to the target below.'],
        params: { a: 1, b: 0.08, c: 0, d: 0 },
        scene: { target: { x: 18, y: -7 }, obstacles: () => [solid('f', 2, -2.5, 14, -1.8)] },
        fire: true,
      },
      {
        type: true,
        title: 'Challenge: close and high',
        body: ['The target is close but tucked behind a high wall. Bring the asymptote in near x = 11.'],
        params: { a: 1, b: 0.08, c: 0, d: 0 },
        scene: { target: { x: 10, y: 9 }, obstacles: () => [solid('w', 4, 2, 5, 10)] },
        fire: true,
      },
    ],
  },
];
