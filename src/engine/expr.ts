import type { Family } from './types.ts';

export const MAX_EXPR_LENGTH = 120;
const MAX_DEPTH = 40;

type FnName = 'sin' | 'cos' | 'tan' | 'ln' | 'log' | 'sqrt' | 'abs' | 'exp' | 'asin' | 'acos' | 'atan';
type Op = '+' | '-' | '*' | '/' | '^';

export type Node =
  | { k: 'num'; v: number }
  | { k: 'x' }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: Op; a: Node; b: Node }
  | { k: 'call'; f: FnName; a: Node };

const FUNCS: Record<FnName, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log,
  log: Math.log10,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
// Longest first so "exp" wins over "e" + "x" + "p", "asin" over "a"...
const NAMES = [...Object.keys(FUNCS), ...Object.keys(CONSTS), 'x'].sort((a, b) => b.length - a.length);

export class ExprError extends Error {
  constructor(message: string, readonly pos: number) {
    super(message);
  }
}

type Tok =
  | { t: 'num'; v: number; pos: number }
  | { t: 'name'; v: string; pos: number }
  | { t: 'op'; v: Op; pos: number }
  | { t: '(' | ')' | '|'; pos: number };

export function normalize(input: string): string {
  return input
    .replace(/[−–]/g, '-')
    .replace(/[×·∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/√/g, 'sqrt')
    .replace(/²/g, '^2')
    .replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=\s*/i, '')
    .trim();
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      if (!m) throw new ExprError(`A lone "." isn't a number`, i);
      toks.push({ t: 'num', v: Number(m[1]), pos: i });
      i += m[1].length;
      if (src[i] === '.') throw new ExprError('A number can only have one decimal point', i);
      continue;
    }
    if (/[a-z]/i.test(ch)) {
      const run = /^[a-z]+/i.exec(src.slice(i))![0].toLowerCase();
      let j = 0;
      while (j < run.length) {
        const name = NAMES.find((n) => run.startsWith(n, j));
        if (!name) {
          const word = run.slice(j);
          throw new ExprError(
            `Unknown name "${word}". Use x, pi, e, or sin cos tan ln log sqrt abs exp, or |x|`,
            i + j,
          );
        }
        toks.push({ t: 'name', v: name, pos: i + j });
        j += name.length;
      }
      i += run.length;
      continue;
    }
    if ('+-*/^'.includes(ch)) {
      toks.push({ t: 'op', v: ch as Op, pos: i });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === '|') {
      toks.push({ t: ch, pos: i });
      i++;
      continue;
    }
    if (ch === '[' || ch === '{') throw new ExprError('Use round brackets ( ) for grouping', i);
    throw new ExprError(`"${ch}" isn't allowed in an equation`, i);
  }
  return toks;
}

class Parser {
  private i = 0;
  private depth = 0;
  /** Inside |…|, a "|" closes the bars instead of starting an implicit product. */
  private bars = 0;
  constructor(private toks: Tok[], private len: number) {}

  parse(): Node {
    if (this.toks.length === 0) throw new ExprError('Type an equation, for example 0.5x', 0);
    const n = this.expr();
    const t = this.peek();
    if (t) {
      if (t.t === ')') throw new ExprError('There is a ")" without a matching "("', t.pos);
      throw new ExprError('Unexpected symbol here', t.pos);
    }
    return n;
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private enter(pos: number) {
    if (++this.depth > MAX_DEPTH) throw new ExprError('Equation is nested too deeply', pos);
  }

  private expr(): Node {
    let n = this.term();
    for (let t = this.peek(); t && t.t === 'op' && (t.v === '+' || t.v === '-'); t = this.peek()) {
      this.i++;
      n = { k: 'bin', op: t.v, a: n, b: this.term() };
    }
    return n;
  }

  private term(): Node {
    let n = this.unary();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'op' && (t.v === '*' || t.v === '/')) {
        this.i++;
        n = { k: 'bin', op: t.v, a: n, b: this.unary() };
      } else if (t && (t.t === 'num' || t.t === 'name' || t.t === '(' || (t.t === '|' && this.bars === 0))) {
        // Implicit multiplication: 2x, 3sin(x), (x+1)(x-1)
        if (t.t === 'num' && n.k !== 'num' && this.prevIsName()) {
          throw new ExprError('Put the number before the letter, like 2x not x2', t.pos);
        }
        n = { k: 'bin', op: '*', a: n, b: this.unary() };
      } else {
        return n;
      }
    }
  }

  private prevIsName(): boolean {
    const prev = this.toks[this.i - 1];
    return prev?.t === 'name';
  }

  private unary(): Node {
    const t = this.peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
      this.i++;
      this.enter(t.pos);
      const a = this.unary();
      this.depth--;
      return t.v === '-' ? { k: 'neg', a } : a;
    }
    return this.power();
  }

  private power(): Node {
    const base = this.primary();
    const t = this.peek();
    if (t && t.t === 'op' && t.v === '^') {
      this.i++;
      this.enter(t.pos);
      const exp = this.unary();
      this.depth--;
      return { k: 'bin', op: '^', a: base, b: exp };
    }
    return base;
  }

  private primary(): Node {
    const t = this.peek();
    if (!t) throw new ExprError('The equation ends too early', this.len);
    if (t.t === 'num') {
      this.i++;
      return { k: 'num', v: t.v };
    }
    if (t.t === '(') {
      this.i++;
      this.enter(t.pos);
      const n = this.expr();
      this.depth--;
      if (this.peek()?.t !== ')') throw new ExprError('Missing ")"', t.pos);
      this.i++;
      return n;
    }
    if (t.t === 'name') {
      this.i++;
      if (t.v === 'x') return { k: 'x' };
      if (t.v in CONSTS) return { k: 'num', v: CONSTS[t.v] };
      const f = t.v as FnName;
      if (this.peek()?.t !== '(') throw new ExprError(`Use brackets after ${f}, like ${f}(x)`, t.pos);
      this.i++;
      this.enter(t.pos);
      const a = this.expr();
      this.depth--;
      if (this.peek()?.t !== ')') throw new ExprError(`Missing ")" after ${f}(`, t.pos);
      this.i++;
      return { k: 'call', f, a };
    }
    if (t.t === '|') {
      this.i++;
      this.enter(t.pos);
      this.bars++;
      const a = this.expr();
      this.bars--;
      this.depth--;
      if (this.peek()?.t !== '|') throw new ExprError('Missing the closing "|"', t.pos);
      this.i++;
      return { k: 'call', f: 'abs', a };
    }
    if (t.t === ')') throw new ExprError('Something is missing before ")"', t.pos);
    throw new ExprError(`"${t.t === 'op' ? t.v : t.t}" needs something on its left`, t.pos);
  }
}

export type Fn = (x: number) => number;

function compileNode(n: Node): Fn {
  switch (n.k) {
    case 'num': {
      const v = n.v;
      return () => v;
    }
    case 'x':
      return (x) => x;
    case 'neg': {
      const a = compileNode(n.a);
      return (x) => -a(x);
    }
    case 'call': {
      const f = FUNCS[n.f];
      const a = compileNode(n.a);
      return (x) => f(a(x));
    }
    case 'bin': {
      const a = compileNode(n.a);
      const b = compileNode(n.b);
      switch (n.op) {
        case '+':
          return (x) => a(x) + b(x);
        case '-':
          return (x) => a(x) - b(x);
        case '*':
          return (x) => a(x) * b(x);
        case '/':
          return (x) => a(x) / b(x);
        case '^':
          return (x) => Math.pow(a(x), b(x));
      }
    }
  }
}

export interface Compiled {
  ast: Node;
  fn: Fn;
  family: Family;
}

export type ParseResult = ({ ok: true } & Compiled) | { ok: false; error: string; pos: number };

export function compile(input: string): ParseResult {
  if (input.length > MAX_EXPR_LENGTH) {
    return { ok: false, error: `Keep equations under ${MAX_EXPR_LENGTH} characters`, pos: MAX_EXPR_LENGTH };
  }
  try {
    const src = normalize(input);
    const ast = new Parser(tokenize(src), src.length).parse();
    return { ok: true, ast, fn: compileNode(ast), family: classify(ast) };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, error: e.message, pos: e.pos };
    throw e;
  }
}

function calls(n: Node, out: Set<FnName>): Set<FnName> {
  if (n.k === 'call') {
    // sin(2)·x is still a line: only calls on x decide the family.
    if (hasX(n.a)) out.add(n.f);
    calls(n.a, out);
  } else if (n.k === 'neg') calls(n.a, out);
  else if (n.k === 'bin') {
    calls(n.a, out);
    calls(n.b, out);
  }
  return out;
}

function hasX(n: Node): boolean {
  if (n.k === 'x') return true;
  if (n.k === 'num') return false;
  if (n.k === 'bin') return hasX(n.a) || hasX(n.b);
  return hasX(n.a);
}

/** Some power has x in its exponent: 2^x, e^(0.1x). */
function growsExponentially(n: Node): boolean {
  if (n.k === 'bin') return (n.op === '^' && hasX(n.b)) || growsExponentially(n.a) || growsExponentially(n.b);
  if (n.k === 'neg' || n.k === 'call') return growsExponentially(n.a);
  return false;
}

/** Polynomial degree in x, or null when the expression isn't a polynomial. */
function degree(n: Node): number | null {
  switch (n.k) {
    case 'num':
      return 0;
    case 'x':
      return 1;
    case 'neg':
      return degree(n.a);
    case 'call':
      return degree(n.a) === 0 ? 0 : null;
    case 'bin': {
      const a = degree(n.a);
      const b = degree(n.b);
      if (a === null || b === null) return null;
      if (n.op === '+' || n.op === '-') return Math.max(a, b);
      if (n.op === '*') return a + b;
      if (n.op === '/') return b === 0 ? a : null;
      if (b !== 0) return null;
      if (a === 0) return 0;
      const e = compileNode(n.b)(0);
      return Number.isInteger(e) && e >= 0 ? a * e : null;
    }
  }
}

export function classify(ast: Node): Family {
  const used = calls(ast, new Set());
  if (used.has('tan')) return 'tangent';
  if (used.has('ln') || used.has('log')) return 'log';
  if (used.has('sin') || used.has('cos')) return 'sine';
  if (used.has('exp') || growsExponentially(ast)) return 'exponential';
  if (used.has('sqrt')) return 'sqrt';
  if (used.has('abs')) return 'absolute';
  const d = degree(ast);
  if (d === 0) return 'constant';
  if (d === 1) return 'linear';
  if (d === 2) return 'quadratic';
  if (d === 3) return 'cubic';
  return 'other';
}
