import { MAX_EXPR_LENGTH } from '../engine/expr.ts';
import type { GameState, ShotEvent } from '../engine/game.ts';
import type { Facing, Vec } from '../engine/types.ts';
import { parseLook, type Look } from './look.ts';

export type PublicGame = Omit<GameState, 'locks'>;

export type ClientMsg =
  | { t: 'create'; name: string; lives: number; look: Look }
  | { t: 'join'; code: string; name: string; look: Look }
  /** Public matchmaking: join the open public room (or open a new one). */
  | { t: 'quick'; name: string; look: Look }
  | { t: 'start' }
  | { t: 'lock'; expr: string; facing: Facing; power?: boolean; to?: Vec }
  | { t: 'leave' }
  /** After a reconnect: take back the seat of the player you were. */
  | { t: 'resume'; id: string; key: string };

export interface RoomPlayer {
  id: string;
  name: string;
  seat: number;
  connected: boolean;
  look: Look;
}

export type ServerMsg =
  /** Sent on connect. `key` proves who you are if you reconnect; keep it private. */
  | { t: 'welcome'; you: string; key: string }
  | { t: 'resumed' }
  | {
      t: 'room';
      code: string;
      hostId: string;
      players: RoomPlayer[];
      lives: number;
      inGame: boolean;
      /** Public rooms start on their own: when the countdown ends or the room is full. */
      isPublic: boolean;
      startsInMs: number | null;
    }
  | { t: 'round'; game: PublicGame; prepMs: number; locks: { id: string; at: number }[] }
  | { t: 'locked'; id: string; at: number }
  | { t: 'resolve'; events: ShotEvent[]; game: PublicGame; nextInMs: number | null }
  /** code 'resume': the seat you tried to take back is gone. */
  | { t: 'error'; msg: string; code?: 'resume' };

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

/** Strip control characters and trim; empty names get a seat name later. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  const bad = (c: number) => c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e);
  return [...v].filter((ch) => !bad(ch.codePointAt(0) ?? 0)).join('').trim().slice(0, 16);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate an untrusted client message. Returns null for anything malformed. */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'create': {
      const lives = typeof raw.lives === 'number' && [1, 2, 3].includes(raw.lives) ? raw.lives : 1;
      return { t: 'create', name: cleanName(raw.name), lives, look: parseLook(raw.look) };
    }
    case 'join': {
      if (typeof raw.code !== 'string') return null;
      const code = raw.code.toUpperCase().trim();
      if (code.length !== CODE_LENGTH || [...code].some((c) => !CODE_ALPHABET.includes(c))) return null;
      return { t: 'join', code, name: cleanName(raw.name), look: parseLook(raw.look) };
    }
    case 'quick':
      return { t: 'quick', name: cleanName(raw.name), look: parseLook(raw.look) };
    case 'start':
    case 'leave':
      return { t: raw.t };
    case 'resume':
      if (typeof raw.id !== 'string' || !/^[0-9a-f-]{36}$/.test(raw.id)) return null;
      if (typeof raw.key !== 'string' || !/^[0-9a-f]{32}$/.test(raw.key)) return null;
      return { t: 'resume', id: raw.id, key: raw.key };
    case 'lock': {
      if (typeof raw.expr !== 'string' || raw.expr.length > MAX_EXPR_LENGTH) return null;
      if (raw.facing !== 1 && raw.facing !== -1) return null;
      const msg: ClientMsg = { t: 'lock', expr: raw.expr, facing: raw.facing };
      if (raw.power === true) msg.power = true;
      if (raw.to !== undefined) {
        if (!isObj(raw.to) || typeof raw.to.x !== 'number' || typeof raw.to.y !== 'number' || !Number.isFinite(raw.to.x) || !Number.isFinite(raw.to.y)) return null;
        msg.to = { x: raw.to.x, y: raw.to.y };
      }
      return msg;
    }
    default:
      return null;
  }
}

export function publicGame(g: GameState): PublicGame {
  const { locks: _locks, ...rest } = g;
  return rest;
}
