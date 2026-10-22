import { describe, expect, it } from 'vitest';
import { FAMILY_ORDER } from '../../engine/families.ts';
import { compile } from '../../engine/expr.ts';
import { familyTemplate } from './store.ts';

describe('note templates', () => {
  it('has a cheat sheet for every family whose sample shot is that family', () => {
    for (const f of FAMILY_ORDER) {
      const body = familyTemplate(f);
      const shot = /y = (.+)\n\nSHOTS/.exec(body)?.[1];
      const c = compile(shot ?? '');
      expect(c.ok && c.family, `${f}: ${shot}`).toBe(f);
    }
  });
});
