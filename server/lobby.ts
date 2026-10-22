import { randomInt } from 'node:crypto';
import type { Look } from '../src/net/look.ts';
import { CODE_ALPHABET, CODE_LENGTH, type ClientMsg } from '../src/net/protocol.ts';
import {
  addMember, createRoom, drop, isEmpty, isMember, lock, remove, resume, start, tell, tick, wakeAt, type Ctx, type Joiner, type RoomState,
} from './room.ts';
import { hashKey, type Conn, type Hub } from './socket.ts';

export { GRACE_MS, PUBLIC_COUNTDOWN_MS } from './room.ts';

const MAX_ROOMS = 500;

export interface Clock {
  now: () => number;
  /** `fn` may return a promise (Redis); a test clock can await it. */
  setTimeout: (fn: () => void | Promise<void>, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function newCode(): string {
  let c = '';
  for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return c;
}

export const joiner = (conn: Conn, name: string, look?: Look): Joiner => ({ id: conn.id, name, look, keyHash: conn.keyHash, sid: conn.sid });

/** Report a rule's refusal to the player who asked. */
export function reply(ctx: Ctx, id: string, error: string | null) {
  if (error) tell(ctx, id, { t: 'error', msg: error });
}

/** Every room inside this one process: `npm start`, `npm run dev` and tests. */
export class Lobby implements Hub {
  rooms = new Map<string, RoomState>();
  /** Player id → room code. */
  private roomOf = new Map<string, string>();
  /** Player id → its socket. */
  private conns = new Map<string, Conn>();
  private timers = new Map<string, unknown>();
  /** The public room currently filling up, if any. */
  private publicCode: string | null = null;

  constructor(private clock: Clock = realClock) {}

  handle(conn: Conn, msg: ClientMsg) {
    this.conns.set(conn.id, conn);
    const err = (m: string) => conn.send({ t: 'error', msg: m });
    const code = this.roomOf.get(conn.id);
    const room = code ? this.rooms.get(code) : undefined;
    const here = room && isMember(room, conn.id) ? room : undefined;
    switch (msg.t) {
      case 'create':
        if (here) return err('Leave your current room first');
        if (this.rooms.size >= MAX_ROOMS) return err('Server is busy, try again soon');
        this.open(conn, (c, ctx) => createRoom(c, joiner(conn, msg.name, msg.look), msg.lives, false, ctx));
        return;
      case 'quick': {
        if (here) return err('Leave your current room first');
        const p = this.publicCode ? this.rooms.get(this.publicCode) : undefined;
        if (p && p.open && this.enter(conn, p.code, msg.name, msg.look, true)) return;
        if (this.rooms.size >= MAX_ROOMS) return err('Server is busy, try again soon');
        this.publicCode = this.open(conn, (c, ctx) => createRoom(c, joiner(conn, msg.name, msg.look), 1, true, ctx));
        return;
      }
      case 'join':
        if (here) return err('Leave your current room first');
        if (!this.rooms.has(msg.code)) return err('No room with that code');
        this.enter(conn, msg.code, msg.name, msg.look);
        return;
      case 'start':
        if (!here) return err('Join a room first');
        this.run(here.code, (s, ctx) => reply(ctx, conn.id, start(s, conn.id, ctx)));
        return;
      case 'lock':
        if (!here) return err('Join a room first');
        this.run(here.code, (s, ctx) => reply(ctx, conn.id, lock(s, conn.id, msg.expr, msg.facing, { power: msg.power, to: msg.to }, ctx)));
        return;
      case 'leave':
        if (here) this.run(here.code, (s, ctx) => remove(s, conn.id, ctx));
        this.roomOf.delete(conn.id);
        return;
      case 'resume': {
        const c = this.roomOf.get(msg.id);
        let ok = false;
        if (c) {
          this.run(c, (s, ctx) => {
            if (resume(s, msg.id, hashKey(msg.key), conn.sid, ctx)) return;
            ok = true;
            // Messages are delivered after this, so the resumed socket receives them.
            if (this.conns.get(conn.id) === conn) this.conns.delete(conn.id);
            conn.id = msg.id;
            conn.keyHash = hashKey(msg.key);
            this.conns.set(conn.id, conn);
          });
        }
        if (!ok) conn.send({ t: 'error', msg: 'That game is no longer available', code: 'resume' });
        return;
      }
    }
  }

  disconnect(conn: Conn) {
    if (this.conns.get(conn.id) !== conn) return;
    this.conns.delete(conn.id);
    const code = this.roomOf.get(conn.id);
    if (code) this.run(code, (s, ctx) => drop(s, conn.id, conn.sid, ctx));
  }

  private open(conn: Conn, make: (code: string, ctx: Ctx) => RoomState): string {
    let code = newCode();
    while (this.rooms.has(code)) code = newCode();
    const ctx: Ctx = { now: this.clock.now(), out: [] };
    const s = make(code, ctx);
    this.rooms.set(code, s);
    this.roomOf.set(conn.id, code);
    this.after(s, ctx);
    return code;
  }

  /** Join a room. `quiet` skips the error message (quick match falls back to a new room). */
  private enter(conn: Conn, code: string, name: string, look: Look, quiet = false): boolean {
    let joined = false;
    this.run(code, (s, ctx) => {
      const e = addMember(s, joiner(conn, name, look), ctx);
      joined = !e;
      if (joined) this.roomOf.set(conn.id, code);
      else if (!quiet) reply(ctx, conn.id, e);
    });
    return joined;
  }

  /** Catch up on anything due, apply one change, deliver what it produced, and reschedule. */
  private run(code: string, fn: (s: RoomState, ctx: Ctx) => void) {
    const s = this.rooms.get(code);
    if (!s) return;
    const ctx: Ctx = { now: this.clock.now(), out: [] };
    tick(s, ctx);
    fn(s, ctx);
    this.after(s, ctx);
  }

  private after(s: RoomState, ctx: Ctx) {
    for (const o of ctx.out) for (const id of o.to) this.conns.get(id)?.send(o.msg);
    const t = this.timers.get(s.code);
    if (t !== undefined) this.clock.clearTimeout(t);
    this.timers.delete(s.code);
    if (isEmpty(s)) {
      this.rooms.delete(s.code);
      if (this.publicCode === s.code) this.publicCode = null;
      return;
    }
    const wake = wakeAt(s);
    if (wake !== null) {
      this.timers.set(s.code, this.clock.setTimeout(() => {
        this.timers.delete(s.code);
        this.run(s.code, () => {});
      }, Math.max(0, wake - ctx.now)));
    }
  }
}
