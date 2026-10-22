/**
 * Cosmetics: how a player looks and what their shots look like. Everything is
 * free. Shared by client and server; looks from other players are untrusted, so
 * parseLook only ever returns ids from these lists.
 */

export const COLORS = [
  { id: '#f0483e', name: 'Red' },
  { id: '#2f7cf6', name: 'Blue' },
  { id: '#22b35e', name: 'Green' },
  { id: '#8b5cf6', name: 'Purple' },
  { id: '#ff8a1f', name: 'Orange' },
  { id: '#ff4f9a', name: 'Pink' },
  { id: '#14b8a6', name: 'Teal' },
  { id: '#eab308', name: 'Gold' },
  { id: '#0ea5e9', name: 'Sky' },
  { id: '#84cc16', name: 'Lime' },
  { id: '#a0522d', name: 'Cocoa' },
  { id: '#64748b', name: 'Slate' },
] as const;

export const FACES = [
  { id: 'classic', name: 'Classic' },
  { id: 'shades', name: 'Cool shades' },
  { id: 'nerd', name: 'Big glasses' },
  { id: 'cyclops', name: 'Cyclops' },
  { id: 'robot', name: 'Robot' },
  { id: 'sleepy', name: 'Sleepy' },
  { id: 'starry', name: 'Star eyes' },
  { id: 'cat', name: 'Kitty' },
] as const;

export const HATS = [
  { id: 'none', name: 'No hat' },
  { id: 'crown', name: 'Crown' },
  { id: 'party', name: 'Party hat' },
  { id: 'tophat', name: 'Top hat' },
  { id: 'wizard', name: 'Wizard' },
  { id: 'propeller', name: 'Propeller cap' },
  { id: 'ears', name: 'Cat ears' },
  { id: 'halo', name: 'Halo' },
  { id: 'chef', name: 'Chef' },
  { id: 'viking', name: 'Viking' },
  { id: 'sprout', name: 'Sprout' },
  { id: 'bow', name: 'Bow' },
] as const;

export const SHOTS = [
  { id: 'classic', name: 'Classic' },
  { id: 'rocket', name: 'Rocket' },
  { id: 'spaghetti', name: 'Spaghetti rocket' },
  { id: 'rainbow', name: 'Rainbow' },
  { id: 'comet', name: 'Fire comet' },
  { id: 'bubbles', name: 'Bubbles' },
  { id: 'stars', name: 'Star trail' },
  { id: 'lightning', name: 'Lightning' },
  { id: 'plane', name: 'Paper plane' },
] as const;

export type FaceId = (typeof FACES)[number]['id'];
export type HatId = (typeof HATS)[number]['id'];
export type ShotId = (typeof SHOTS)[number]['id'];

export interface Look {
  color: string;
  face: FaceId;
  hat: HatId;
  shot: ShotId;
}

/** Seat colors double as defaults, so players who never visit the locker still differ. */
export const SEAT_COLORS = ['#f0483e', '#2f7cf6', '#22b35e', '#8b5cf6', '#ff8a1f', '#ff4f9a'];

export const defaultLook = (seat = 1): Look => ({ color: SEAT_COLORS[seat % SEAT_COLORS.length], face: 'classic', hat: 'none', shot: 'classic' });

const pick = <T extends string>(list: readonly { id: T }[], v: unknown, fallback: T): T => list.find((o) => o.id === v)?.id ?? fallback;

export function parseLook(v: unknown, seat = 1): Look {
  const d = defaultLook(seat);
  if (typeof v !== 'object' || v === null) return d;
  const o = v as Record<string, unknown>;
  return {
    color: pick<string>(COLORS, o.color, d.color),
    face: pick(FACES, o.face, d.face),
    hat: pick(HATS, o.hat, d.hat),
    shot: pick(SHOTS, o.shot, d.shot),
  };
}

export function randomLook(color: string, r: () => number = Math.random): Look {
  const any = <T extends { id: string }>(list: readonly T[]) => list[Math.floor(r() * list.length)].id;
  return { color, face: any(FACES) as FaceId, hat: any(HATS) as HatId, shot: any(SHOTS) as ShotId };
}

/** Keep colors distinct in one match: a taken color falls back to the first free one. */
export function uniqueColor(want: string, taken: string[]): string {
  if (!taken.includes(want)) return want;
  return [...SEAT_COLORS, ...COLORS.map((c) => c.id)].find((c) => !taken.includes(c)) ?? want;
}
