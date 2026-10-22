import { distToShape } from './geometry.ts';
import { rng } from './rng.ts';
import type { Bounds, Obstacle, Vec } from './types.ts';

export type PowerId = 'teleport' | 'drill' | 'life' | 'mega' | 'first' | 'mirror';

export interface PowerDef {
  name: string;
  /** One line, in battle terms. */
  text: string;
  /** Relative odds on the spinner. */
  weight: number;
  color: string;
}

export const POWERS: Record<PowerId, PowerDef> = {
  teleport: { name: 'Teleport', text: 'Before the shots fly, jump to a new spot nearby. Others aim at where you were.', weight: 3, color: '#8b5cf6' },
  mirror: { name: 'Mirror Shot', text: 'Your function fires both ways: in front of you and behind you.', weight: 3, color: '#2f7cf6' },
  first: { name: 'First Strike', text: 'Your shot fires before everyone else this round, whenever you lock in.', weight: 3, color: '#ff8a1f' },
  mega: { name: 'Mega Blast', text: 'A huge warhead: it hits anyone it passes close to and blasts a double-size hole.', weight: 2, color: '#f0483e' },
  drill: { name: 'Drill', text: 'Your shot drills straight through the first obstacle it touches, even metal.', weight: 1, color: '#6b7489' },
  life: { name: 'Extra Life', text: 'If you would be knocked out this round, you survive. Used up even if nobody hits you.', weight: 1, color: '#ff4f9a' },
};

export const POWER_IDS = Object.keys(POWERS) as PowerId[];

/** Everyone gets a new power-up on round 1, then every 2 rounds. */
export const spinsAt = (round: number) => round % 2 === 1;

/** Teleport range: a medium hop, 9% of the arena width (18 units on the battle map). */
export const teleportRange = (b: Bounds) => (b.maxX - b.minX) * 0.09;

/** Mega Blast hits anything within this many player radii of its path. */
export const MEGA_REACH = 2.5;

/** One weighted spin per living player. Seeded, so server and clients agree. */
export function spin(seed: number, round: number, ids: string[]): Record<string, PowerId> {
  const r = rng((seed ^ Math.imul(round, 0x9e3779b1)) >>> 0);
  const total = POWER_IDS.reduce((s, p) => s + POWERS[p].weight, 0);
  const out: Record<string, PowerId> = {};
  for (const id of ids) {
    let roll = r() * total;
    out[id] = POWER_IDS.find((p) => (roll -= POWERS[p].weight) < 0) ?? 'teleport';
  }
  return out;
}

/** Why a teleport destination is not allowed, or null when it is. */
export function teleportError(
  from: Vec,
  to: Vec,
  radius: number,
  bounds: Bounds,
  obstacles: Obstacle[],
  others: Vec[],
): string | null {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return 'Pick a spot on the board';
  if (Math.hypot(to.x - from.x, to.y - from.y) > teleportRange(bounds) + 1e-9) return 'Too far: teleport inside the circle';
  if (to.x - radius < bounds.minX || to.x + radius > bounds.maxX || to.y - radius < bounds.minY || to.y + radius > bounds.maxY) return 'Stay inside the arena';
  if (obstacles.some((o) => distToShape(to.x, to.y, o.shape) < radius)) return "You can't teleport into an obstacle";
  if (others.some((p) => Math.hypot(p.x - to.x, p.y - to.y) < radius * 2)) return 'Someone is already standing there';
  return null;
}
