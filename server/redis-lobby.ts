import { randomUUID } from 'node:crypto';
import type { Look } from '../src/net/look.ts';
import type { ClientMsg } from '../src/net/protocol.ts';
import { joiner, newCode, realClock, reply, type Clock } from './lobby.ts';
import {
  addMember, createRoom, drop, isEmpty, lock, remove, resume, start, tick, wakeAt, type Ctx, type Out, type RoomState,
} from './room.ts';
import { hashKey, type Conn, type Hub } from './socket.ts';

/** The few Redis operations the game needs. redis-store.ts is the real one; tests use an in-memory one. */
export interface Store {
  get(key: string): Promise<string | null>;
  /** Returns false when `onlyIfNew` is set and the key already exists. */
  set(key: string, value: string, ttlMs: number, onlyIfNew?: boolean): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Delete only while the key still holds `value` (lock release, public room pointer). */
  delIf(key: string, value: string): Promise<void>;
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, fn: (message: string) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
}

const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const LOCK_TTL_MS = 5000;
const K = {
  room: (code: string) => `fw:room:${code}`,
  lock: (code: string) => `fw:lock:${code}`,
  player: (id: string) => `fw:player:${id}`,
  events: (code: string) => `fw:events:${code}`,
  public: 'fw:public',
  publicLock: 'fw:lock:public',
};

/** What one room change produced: messages for players anywhere, and when the room next needs a tick. */
interface Envelope {
  out: Out[];
  wake: number | null;
}

/**
 * Rooms for many server instances at once (Vercel Functions). Room state lives
 * in Redis and is changed under a per-room lock; every change is published, and
 * each instance delivers it to the sockets it holds. Any instance holding a
 * player of a room keeps a timer for the room's next due step; whichever fires
 * first does the work, and the others find nothing due.
 */
export class RedisLobby implements Hub {
  /** Player id → socket on this instance. */
  private conns = new Map<string, Conn>();
  /** Player id → room, for sockets on this instance. */
  private roomOf = new Map<string, string>();
  private timers = new Map<string, unknown>();
  private subscribed = new Set<string>();

  constructor(private store: Store, private clock: Clock = realClock) {}

  async handle(conn: Conn, msg: ClientMsg) {
    this.conns.set(conn.id, conn);
    const err = (m: string) => conn.send({ t: 'error', msg: m });
    const code = this.roomOf.get(conn.id);
    switch (msg.t) {
      case 'create':
        if (code) return err('Leave your current room first');
        await this.open(conn, msg.name, msg.look, msg.lives, false);
        return;
      case 'quick':
        if (code) return err('Leave your current room first');
        // One quick match at a time, so two arrivals can't both open a new public room.
        await this.withLock(K.publicLock, async () => {
          const p = await this.store.get(K.public);
          if (p && (await this.enter(conn, p, msg.name, msg.look, true))) return;
          const c = await this.open(conn, msg.name, msg.look, 1, true);
          await this.store.set(K.public, c, ROOM_TTL_MS);
        });
        return;
      case 'join':
        if (code) return err('Leave your current room first');
        await this.enter(conn, msg.code, msg.name, msg.look);
        return;
      case 'start':
        if (!code) return err('Join a room first');
        if (!(await this.op(code, (s, ctx) => reply(ctx, conn.id, start(s, conn.id, ctx))))) this.forget(conn.id);
        return;
      case 'lock':
        if (!code) return err('Join a room first');
        if (!(await this.op(code, (s, ctx) => reply(ctx, conn.id, lock(s, conn.id, msg.expr, msg.facing, { power: msg.power, to: msg.to }, ctx))))) this.forget(conn.id);
        return;
      case 'leave':
        if (!code) return;
        await this.op(code, (s, ctx) => remove(s, conn.id, ctx));
        this.forget(conn.id);
        return;
      case 'resume':
        if (!(await this.resume(conn, msg.id, msg.key))) conn.send({ t: 'error', msg: 'That game is no longer available', code: 'resume' });
        return;
    }
  }

  async disconnect(conn: Conn) {
    if (this.conns.get(conn.id) !== conn) return;
    this.conns.delete(conn.id);
    const code = this.roomOf.get(conn.id);
    if (!code) return;
    this.forget(conn.id);
    await this.op(code, (s, ctx) => drop(s, conn.id, conn.sid, ctx));
  }

  private async resume(conn: Conn, id: string, key: string): Promise<boolean> {
    const code = await this.store.get(K.player(id));
    if (!code) return false;
    // Check the key before routing anything for `id` to this socket.
    const raw = await this.store.get(K.room(code));
    const keyHash = hashKey(key);
    if (!raw || !(JSON.parse(raw) as RoomState).members.some((m) => m.id === id && m.keyHash === keyHash && !m.left)) return false;
    const prev = this.conns.get(id);
    this.conns.set(id, conn);
    this.roomOf.set(id, code);
    await this.subscribe(code);
    let ok = false;
    await this.op(code, (s, ctx) => (ok = !resume(s, id, keyHash, conn.sid, ctx)));
    if (!ok) {
      if (prev) this.conns.set(id, prev);
      else this.conns.delete(id);
      this.forget(id);
      return false;
    }
    if (this.conns.get(conn.id) === conn && conn.id !== id) this.conns.delete(conn.id);
    conn.id = id;
    conn.keyHash = keyHash;
    return true;
  }

  /** Open a new room with this socket's player as host. */
  private async open(conn: Conn, name: string, look: Look, lives: number, isPublic: boolean): Promise<string> {
    for (;;) {
      const code = newCode();
      this.roomOf.set(conn.id, code);
      await this.subscribe(code);
      const ctx: Ctx = { now: this.clock.now(), out: [] };
      const s = createRoom(code, joiner(conn, name, look), lives, isPublic, ctx);
      if (!(await this.store.set(K.room(code), JSON.stringify(s), ROOM_TTL_MS, true))) {
        this.forget(conn.id);
        continue;
      }
      await this.store.set(K.player(conn.id), code, ROOM_TTL_MS);
      await this.publish(code, { out: ctx.out, wake: wakeAt(s) });
      return code;
    }
  }

  /** Join a room. `quiet` skips the error message (quick match falls back to a new room). */
  private async enter(conn: Conn, code: string, name: string, look: Look, quiet = false): Promise<boolean> {
    this.roomOf.set(conn.id, code);
    await this.subscribe(code);
    let joined = false;
    const exists = await this.op(code, (s, ctx) => {
      const e = addMember(s, joiner(conn, name, look), ctx);
      joined = !e;
      if (!joined && !quiet) reply(ctx, conn.id, e);
    });
    if (!exists && !quiet) conn.send({ t: 'error', msg: 'No room with that code' });
    if (!joined) {
      this.forget(conn.id);
      return false;
    }
    await this.store.set(K.player(conn.id), code, ROOM_TTL_MS);
    return true;
  }

  /** Load, catch up, change, save and publish one room under its lock. False when the room doesn't exist. */
  private op(code: string, fn: (s: RoomState, ctx: Ctx) => void): Promise<boolean> {
    return this.withLock(K.lock(code), async () => {
      const raw = await this.store.get(K.room(code));
      if (!raw) return false;
      // Written by this module only, so it has this shape.
      const s = JSON.parse(raw) as RoomState;
      const ctx: Ctx = { now: this.clock.now(), out: [] };
      tick(s, ctx);
      fn(s, ctx);
      const empty = isEmpty(s);
      if (empty) {
        await this.store.del(K.room(code));
        await this.store.delIf(K.public, code);
      } else {
        await this.store.set(K.room(code), JSON.stringify(s), ROOM_TTL_MS);
      }
      await this.publish(code, { out: ctx.out, wake: empty ? null : wakeAt(s) });
      return true;
    });
  }

  private async publish(code: string, env: Envelope) {
    await this.store.publish(K.events(code), JSON.stringify(env));
    // Our own subscription delivers the messages; the timer is set here too in case it arrives late.
    this.schedule(code, env.wake);
  }

  private async subscribe(code: string) {
    if (this.subscribed.has(code)) return;
    this.subscribed.add(code);
    await this.store.subscribe(K.events(code), (raw) => {
      const env = JSON.parse(raw) as Envelope;
      for (const o of env.out) for (const id of o.to) this.conns.get(id)?.send(o.msg);
      this.schedule(code, env.wake);
    });
  }

  private hasLocal(code: string) {
    return [...this.roomOf.values()].includes(code);
  }

  /** This socket's player is no longer in a room here: drop the subscription and timer when nobody else needs them. */
  private forget(id: string) {
    const code = this.roomOf.get(id);
    this.roomOf.delete(id);
    if (!code || this.hasLocal(code)) return;
    this.schedule(code, null);
    this.subscribed.delete(code);
    void this.store.unsubscribe(K.events(code)).catch(() => {});
  }

  private schedule(code: string, wake: number | null) {
    const t = this.timers.get(code);
    if (t !== undefined) this.clock.clearTimeout(t);
    this.timers.delete(code);
    if (wake === null || !this.hasLocal(code)) return;
    this.timers.set(code, this.clock.setTimeout(() => {
      this.timers.delete(code);
      return this.op(code, () => {}).then(
        () => {},
        (e: unknown) => console.error('room tick failed', e instanceof Error ? e.message : 'unknown'),
      );
    }, Math.max(0, wake - this.clock.now())));
  }

  private async withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    for (let tries = 0; !(await this.store.set(name, token, LOCK_TTL_MS, true)); tries++) {
      if (tries > 200) throw new Error('Room is busy');
      await new Promise((r) => setTimeout(r, 15));
    }
    try {
      return await fn();
    } finally {
      await this.store.delIf(name, token);
    }
  }
}
