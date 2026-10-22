import { describe, expect, it } from 'vitest';
import { compile } from './expr.ts';

const val = (s: string, x: number) => {
  const c = compile(s);
  if (!c.ok) throw new Error(c.error);
  return c.fn(x);
};

describe('expression parser', () => {
  it('handles precedence, implicit multiplication and powers', () => {
    expect(val('2x^2 + 3x - 1', 2)).toBe(13);
    expect(val('-x^2', 3)).toBe(-9);
    expect(val('2^-1', 0)).toBe(0.5);
    expect(val('3sin(x)', Math.PI / 2)).toBeCloseTo(3);
    expect(val('(x+1)(x-1)', 3)).toBe(8);
    expect(val('y = 0.5x', 4)).toBe(2);
    expect(val('2π', 0)).toBeCloseTo(2 * Math.PI);
    expect(val('exp(x)', 1)).toBeCloseTo(Math.E);
    expect(val('ln(e)', 0)).toBeCloseTo(1);
    expect(val('x^2^3', 2)).toBe(256);
    expect(val('2 − 3×x', 1)).toBe(-1);
  });

  it('uses radians', () => {
    expect(val('sin(pi/6)', 0)).toBeCloseTo(0.5);
  });

  it('returns NaN outside a function domain instead of throwing', () => {
    expect(val('ln(x)', -1)).toBeNaN();
    expect(val('sqrt(x)', -4)).toBeNaN();
  });

  it('reports friendly errors', () => {
    const cases: [string, RegExp][] = [
      ['', /Type an equation/],
      ['sin x', /brackets after sin/],
      ['2*(x+1', /Missing "\)"/],
      ['x+1)', /without a matching/],
      ['sinn(x)', /Unknown name/],
      ['x2', /before the letter/],
      ['3 +', /ends too early/],
      ['x # 2', /allowed/],
      ['y', /Unknown name/],
      ['x'.repeat(200), /under 120/],
      ['('.repeat(50) + 'x' + ')'.repeat(50), /too deeply/],
    ];
    for (const [src, re] of cases) {
      const c = compile(src);
      expect(c.ok, src).toBe(false);
      if (!c.ok) expect(c.error).toMatch(re);
    }
  });

  it('classifies function families', () => {
    const fam = (s: string) => {
      const c = compile(s);
      return c.ok ? c.family : 'error';
    };
    expect(fam('0.5x + 2')).toBe('linear');
    expect(fam('-0.1x^2 + x')).toBe('quadratic');
    expect(fam('(x+1)(x-1)')).toBe('quadratic');
    expect(fam('3sin(0.5x + 1) + 2')).toBe('sine');
    expect(fam('tan(x)')).toBe('tangent');
    expect(fam('2ln(x + 1)')).toBe('log');
    expect(fam('4')).toBe('constant');
    expect(fam('x^3')).toBe('cubic');
    expect(fam('0.005(x - 10)^3')).toBe('cubic');
    expect(fam('x^4')).toBe('other');
    expect(fam('-0.6|x - 8|')).toBe('absolute');
    expect(fam('abs(x)')).toBe('absolute');
    expect(fam('2√(x + 1)')).toBe('sqrt');
    expect(fam('0.3e^(0.15x)')).toBe('exponential');
    expect(fam('2^x')).toBe('exponential');
    expect(fam('exp(x)')).toBe('exponential');
    expect(fam('sin(2)x')).toBe('linear');
  });

  it('reads |…| as absolute value, including nesting and implicit products', () => {
    expect(val('|x - 3|', 1)).toBe(2);
    expect(val('2|x|', -4)).toBe(8);
    expect(val('|x||x|', -3)).toBe(9);
    expect(val('||x| - 5|', -2)).toBe(3);
    expect(val('-0.6|x - 8| + 1', 0)).toBeCloseTo(-3.8);
    const c = compile('|x - 3');
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toMatch(/closing "\|"/);
  });
});
