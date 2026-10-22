import { describe, expect, it } from 'vitest';
import { suggestShots } from '../../engine/solver.ts';
import { LESSON_BOUNDS, LESSONS } from './lessons.ts';

describe('lesson scenes', () => {
  for (const lesson of LESSONS) {
    lesson.steps.forEach((step, i) => {
      if (!step.scene || !step.fire) return;
      it(`${lesson.title} step ${i + 1} "${step.title}" can be hit with a ${lesson.id} shot`, () => {
        const arena = {
          bounds: LESSON_BOUNDS,
          obstacles: step.scene!.obstacles(),
          actors: [
            { id: 'you', x: 0, y: 0, r: 0.55 },
            { id: 't', x: step.scene!.target.x, y: step.scene!.target.y, r: 0.75 },
          ],
        };
        expect(suggestShots(arena, 'you', 't', { family: lesson.id }).shots.length).toBeGreaterThan(0);
      });
    });
  }
});
