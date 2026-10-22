import { traceShot } from './collision.ts';
import { compile, type Fn } from './expr.ts';
import { computePath } from './trajectory.ts';
import type { Arena, Facing, Family, ShotOptions, Trace } from './types.ts';

export type ShotResult =
  | { ok: true; trace: Trace; family: Family; fn: Fn }
  | { ok: false; error: string };

/** Parse, build the anchored path from the shooter, and resolve collisions. */
export function planShot(arena: Arena, shooterId: string, expr: string, facing: Facing, opts: ShotOptions = {}): ShotResult {
  const shooter = arena.actors.find((a) => a.id === shooterId);
  if (!shooter) return { ok: false, error: 'Shooter is not in the arena' };
  if (facing !== 1 && facing !== -1) return { ok: false, error: 'Invalid direction' };
  const c = compile(expr);
  if (!c.ok) return { ok: false, error: c.error };
  const path = computePath(c.fn, shooter, facing, arena.bounds);
  if (!path.ok) return { ok: false, error: path.error };
  return { ok: true, trace: traceShot(arena, shooterId, path.pts, path.end, opts), family: c.family, fn: c.fn };
}
