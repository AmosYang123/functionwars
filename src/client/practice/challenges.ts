import { boxPoly, starPoly, trianglePoly } from '../../engine/geometry.ts';
import { makeObstacle } from '../../engine/map.ts';
import type { FamilyId, Obstacle, Vec } from '../../engine/types.ts';

export type Requirement = FamilyId | 'new' | null;

export interface Layout {
  shooter: Vec;
  dummies: Vec[];
  obstacles: Obstacle[];
}

export interface Challenge {
  id: string;
  title: string;
  goal: string;
  brief: string;
  require: Requirement;
  /** Fresh objects every call so a retry resets damage. */
  build: () => Layout;
}

const solid = (id: string, x0: number, y0: number, x1: number, y1: number) => makeObstacle(id, 'wall', boxPoly(x0, y0, x1, y1), true);

export const CHALLENGES: Challenge[] = [
  {
    id: 'line',
    title: 'Line of sight',
    goal: 'Hit the target with a straight line.',
    brief: 'A line y = mx climbs m units for every unit forward. Hover the target to read how far forward and how high it is from you, then divide.',
    require: 'linear',
    build: () => ({ shooter: { x: -14, y: -4 }, dummies: [{ x: 10, y: 3 }], obstacles: [] }),
  },
  {
    id: 'boulder',
    title: 'Around the boulder',
    goal: 'Curve a shot around the boulder.',
    brief: 'A straight line runs into the rock. Bend the path: a quadratic arcs over it, a sine wave can swing over or under.',
    require: null,
    build: () => ({
      shooter: { x: -14, y: -2 },
      dummies: [{ x: 8, y: -2 }],
      obstacles: [makeObstacle('rock', 'boulder', { kind: 'circle', x: -3, y: -2, r: 2.5 }, true)],
    }),
  },
  {
    id: 'wall',
    title: 'Over the wall',
    goal: 'Clear the wall with a quadratic.',
    brief: 'Negative a bends the shot down like a thrown ball. The peak sits at x = −b / 2a, so put it over the wall and let gravity bring it down.',
    require: 'quadratic',
    build: () => ({ shooter: { x: -14, y: -8 }, dummies: [{ x: 12, y: -8 }], obstacles: [solid('wall', -0.4, -12, 0.4, 2)] }),
  },
  {
    id: 'needle',
    title: "Needle's eye",
    goal: 'Thread both openings with a sine wave.',
    brief: 'The first gap is high, the second is low, the target is level with you. A wave that rises, falls, then comes back to zero does exactly that.',
    require: 'sine',
    build: () => ({
      shooter: { x: -15, y: 0 },
      dummies: [{ x: 14, y: 0 }],
      obstacles: [
        solid('a1', -4.3, -12, -3.7, 1.5),
        solid('a2', -4.3, 4.5, -3.7, 12),
        solid('b1', 4.7, -12, 5.3, -4.5),
        solid('b2', 4.7, -1.5, 5.3, 12),
      ],
    }),
  },
  {
    id: 'break',
    title: 'Breakthrough',
    goal: 'Break into the bunker and hit the target.',
    brief: 'Only the brick door can be blasted. A missile knocks a hole right where it lands, so hit the door, then fire the same shot again through the hole.',
    require: null,
    build: () => ({
      shooter: { x: -14, y: 0 },
      dummies: [{ x: 12, y: 0 }],
      obstacles: [
        makeObstacle('door', 'wall', boxPoly(9, -2.6, 9.6, 2.6)),
        solid('top', 9, 2, 15, 2.6),
        solid('bottom', 9, -2.6, 15, -2),
        solid('back', 14.4, -2.6, 15, 2.6),
      ],
    }),
  },
  {
    id: 'new',
    title: 'Second nature',
    goal: 'Hit the target with a family you have not used yet.',
    brief: 'Every family is a different attack shape. Pick one you have never landed a hit with and work out how it reaches the target.',
    require: 'new',
    build: () => ({
      shooter: { x: -12, y: 6 },
      dummies: [{ x: 10, y: -6 }],
      obstacles: [
        makeObstacle('star', 'star', starPoly(0, 0, 1.8, 0.8)),
        makeObstacle('rock', 'boulder', { kind: 'circle', x: -3, y: 4, r: 1.2 }),
      ],
    }),
  },
  {
    id: 'log',
    title: 'Log ramp',
    goal: 'Launch over the step and under the ceiling with a logarithm.',
    brief: 'ln(x − h) climbs steeply right after its asymptote and then flattens. Put h just behind you to jump the step, then let it level out under the ceiling.',
    require: 'log',
    build: () => ({
      shooter: { x: -16, y: -8 },
      dummies: [{ x: 12, y: -3 }],
      obstacles: [solid('step', -15, -12, -13.6, -6.5), solid('ceiling', -8, -1.5, 8, 12)],
    }),
  },
  {
    id: 'tan',
    title: 'Late surge',
    goal: 'Stay under the shelf, then surge up with a tangent.',
    brief: 'tan(bx) is gentle at first and explodes near its asymptote at x = π / 2b. Put that asymptote just past the target.',
    require: 'tangent',
    build: () => ({
      shooter: { x: -16, y: -8 },
      dummies: [{ x: 12, y: 4 }],
      obstacles: [solid('shelf', -13, -6.8, 1, -6.2)],
    }),
  },
  {
    id: 'bounce',
    title: 'Bounce',
    goal: 'Bounce over the wall with an absolute value.',
    brief: 'a|x − h| is a V: the shot flies straight to the corner at x = h, then turns. Negative a climbs first, then bounces down. Put the corner halfway to the target.',
    require: 'absolute',
    build: () => ({ shooter: { x: -15, y: -6 }, dummies: [{ x: 14, y: -6 }], obstacles: [solid('wall', -1, -12, 1, 3)] }),
  },
  {
    id: 'blastoff',
    title: 'Blast-off',
    goal: 'Stay under the tunnel roof, then blast up with an exponential.',
    brief: 'a·e^(bx) creeps along, then shoots up: it grows by a factor of e every 1/b units. Try b around 0.25 and a small a.',
    require: 'exponential',
    build: () => ({ shooter: { x: -16, y: -9 }, dummies: [{ x: 15, y: 8 }], obstacles: [solid('roof', -14, -6.8, 6, 12)] }),
  },
  {
    id: 'gauntlet',
    title: 'Gauntlet',
    goal: 'Take down all three targets.',
    brief: 'Any family, any route. Use Help if you get stuck on one.',
    require: null,
    build: () => ({
      shooter: { x: -16, y: 0 },
      dummies: [{ x: 16, y: 8 }, { x: 10, y: -9 }, { x: 17, y: 0 }],
      obstacles: [
        makeObstacle('wall', 'wall', boxPoly(0, -3, 0.7, 3)),
        makeObstacle('star', 'star', starPoly(6, 5, 1.4, 0.6)),
        makeObstacle('tri', 'triangle', trianglePoly(5, -5, 1.8, 0.3)),
        makeObstacle('rock', 'boulder', { kind: 'circle', x: -6, y: 6, r: 1.5 }),
      ],
    }),
  },
];
