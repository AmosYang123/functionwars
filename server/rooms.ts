import { randomInt } from 'node:crypto';
import {
  createGame, lockIn, MAX_PLAYERS, MIN_PLAYERS, PREP_MS, removePlayer, replayDurationMs, resolveRound, type GameState, type PowerUse,
} from '../src/engine/game.ts';
import { defaultLook, uniqueColor, type Look } from '../src/net/look.ts';
import { CODE_ALPHABET, CODE_LENGTH, publicGame, type ClientMsg, type RoomPlayer, type ServerMsg } from '../src/net/protocol.ts';

const SEAT_NAMES = ['Coral', 'Cyan', 'Lime', 'Amber', 'Violet', 'Rose'];
const MAX_ROOMS = 500;
const BETWEEN_ROUNDS_MS = 1500;
/** Public rooms start this long after the second player joins (or sooner, when full). */
export const PUBLIC_COUNTDOWN_MS = 20_000;

export interface Conn {
  id: string;
  send: (msg: ServerMsg) => void;
}

interface Member extends RoomPlayer {
  conn: Conn;
}

export interface Clock {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * One match. The server owns the clock, lock-in timestamps, firing order and
 * hit resolution; clients only send equations and replay what they're told.
 */
export class Room {
  members: Member[] = [];
  hostId: string;
  game: GameState | null = null;
  private roundStart = 0;
  private timer: unknown = null;
  private prepOpen = false;
  private countdown: unknown = null;
  private startsAt = 0;
  /** A public room accepts strangers until its game starts, then never again. */
  open: boolean;

  constructor(
    readonly code: string,
    host: Conn,
    hostName: string,
    readonly lives: number,
    private clock: Clock = realClock,
    readonly isPublic = false,
    hostLook?: Look,
  ) {
    this.hostId = host.id;
    this.open = isPublic;
    this.add(host, hostName, hostLook);
  }

  get empty() {
    return this.members.every((m) => !m.connected);
  }

  add(conn: Conn, name: string, look?: Look): string | null {
    if (this.game) return 'That match has already started';
    if (this.members.length >= MAX_PLAYERS) return 'That room is full';
    const used = new Set(this.members.map((m) => m.seat));
    let seat = 0;
    while (used.has(seat)) seat++;
    const want = look ?? defaultLook(seat);
    const color = uniqueColor(want.color, this.members.map((m) => m.look.color));
    this.members.push({ id: conn.id, name: name || SEAT_NAMES[seat], seat, connected: true, conn, look: { ...want, color } });
    if (this.isPublic) this.updateCountdown();
    if (!this.game) this.broadcastRoom();
    return null;
  }

  /** Public rooms: start when full, count down once two are waiting, stop if they drop below two. */
  private updateCountdown() {
    if (!this.open) return;
    const waiting = this.members.filter((m) => m.connected).length;
    if (waiting >= MAX_PLAYERS) {
      this.launch();
    } else if (waiting >= MIN_PLAYERS && this.countdown === null) {
      this.startsAt = this.clock.now() + PUBLIC_COUNTDOWN_MS;
      this.countdown = this.clock.setTimeout(() => {
        this.countdown = null;
        this.launch();
      }, PUBLIC_COUNTDOWN_MS);
    } else if (waiting < MIN_PLAYERS && this.countdown !== null) {
      this.clock.clearTimeout(this.countdown);
      this.countdown = null;
    }
  }

  leave(id: string) {
    const m = this.members.find((q) => q.id === id);
    if (!m) return;
    if (this.game) {
      m.connected = false;
      this.game = removePlayer(this.game, id);
      if (this.game.phase === 'over') this.finishEarly();
      else this.maybeEndPrep();
    } else {
      this.members = this.members.filter((q) => q.id !== id);
      if (this.isPublic) this.updateCountdown();
    }
    if (this.hostId === id) this.hostId = this.members.find((q) => q.connected)?.id ?? '';
    this.broadcastRoom();
  }

  start(by: string): string | null {
    if (this.isPublic) return 'Public games start on their own';
    if (by !== this.hostId) return 'Only the host can start';
    if (this.game) return 'Already playing';
    if (this.members.filter((m) => m.connected).length < MIN_PLAYERS) return 'Need at least 2 players';
    this.launch();
    return null;
  }

  private launch() {
    if (this.game) return;
    if (this.countdown !== null) this.clock.clearTimeout(this.countdown);
    this.countdown = null;
    this.open = false;
    const players = this.members.filter((m) => m.connected);
    if (players.length < MIN_PLAYERS) return;
    this.members = players;
    this.game = createGame(players.map((m) => ({ id: m.id, name: m.name })), randomInt(2 ** 31), { lives: this.lives });
    // Keep colors stable with lobby seats
    this.game.players.forEach((p) => (p.seat = players.find((m) => m.id === p.id)!.seat));
    this.broadcastRoom();
    this.beginRound();
  }

  lock(id: string, expr: string, facing: 1 | -1, use: PowerUse = {}): string | null {
    if (!this.game || this.game.phase !== 'prep' || !this.prepOpen) return 'Not accepting shots right now';
    const at = this.clock.now() - this.roundStart;
    if (at > PREP_MS) return 'Time is up';
    const r = lockIn(this.game, id, expr, facing, at, use);
    if (!r.ok) return r.error;
    this.game = r.state;
    this.broadcast({ t: 'locked', id, at });
    this.maybeEndPrep();
    return null;
  }

  private beginRound() {
    if (!this.game) return;
    this.roundStart = this.clock.now();
    this.prepOpen = true;
    this.broadcast({ t: 'round', game: publicGame(this.game), prepMs: PREP_MS, locks: [] });
    this.timer = this.clock.setTimeout(() => this.endPrep(), PREP_MS);
  }

  /** Everyone still playing has locked in: nobody loses time by resolving now. */
  private maybeEndPrep() {
    const g = this.game;
    if (!g || !this.prepOpen) return;
    const waiting = g.players.filter((p) => p.alive && !g.locks[p.id] && this.members.find((m) => m.id === p.id)?.connected);
    if (waiting.length === 0) this.endPrep();
  }

  private endPrep() {
    if (!this.game || !this.prepOpen) return;
    this.prepOpen = false;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    const { state, events } = resolveRound(this.game);
    this.game = state;
    const over = state.phase === 'over';
    const wait = replayDurationMs(events, state.bounds) + BETWEEN_ROUNDS_MS;
    this.broadcast({ t: 'resolve', events, game: publicGame(state), nextInMs: over ? null : wait });
    if (over) {
      this.game = null;
      this.members = this.members.filter((m) => m.connected);
      this.clock.setTimeout(() => this.broadcastRoom(), wait);
    } else {
      this.timer = this.clock.setTimeout(() => {
        this.timer = null;
        this.beginRound();
      }, wait);
    }
  }

  private finishEarly() {
    this.prepOpen = false;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    const g = this.game!;
    this.broadcast({ t: 'resolve', events: [], game: publicGame(g), nextInMs: null });
    this.game = null;
    this.members = this.members.filter((m) => m.connected);
  }

  private broadcast(msg: ServerMsg) {
    for (const m of this.members) if (m.connected) m.conn.send(msg);
  }

  broadcastRoom() {
    this.broadcast({
      t: 'room',
      code: this.code,
      hostId: this.hostId,
      players: this.members.map(({ id, name, seat, connected, look }) => ({ id, name, seat, connected, look })),
      lives: this.lives,
      inGame: this.game !== null,
      isPublic: this.isPublic,
      startsInMs: this.countdown !== null ? Math.max(0, this.startsAt - this.clock.now()) : null,
    });
  }

  dispose() {
    if (this.countdown !== null) this.clock.clearTimeout(this.countdown);
    this.countdown = null;
    this.prepOpen = false;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Routes validated client messages to rooms; one room per connection. */
export class Lobby {
  rooms = new Map<string, Room>();
  private roomOf = new Map<string, Room>();
  /** The public room currently filling up, if any. */
  private publicRoom: Room | null = null;

  constructor(private clock: Clock = realClock) {}

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  handle(conn: Conn, msg: ClientMsg) {
    const err = (m: string) => conn.send({ t: 'error', msg: m });
    const room = this.roomOf.get(conn.id);
    switch (msg.t) {
      case 'create': {
        if (room) return err('Leave your current room first');
        if (this.rooms.size >= MAX_ROOMS) return err('Server is busy, try again soon');
        const r = new Room(this.newCode(), conn, msg.name, msg.lives, this.clock, false, msg.look);
        this.rooms.set(r.code, r);
        this.roomOf.set(conn.id, r);
        return;
      }
      case 'quick': {
        if (room) return err('Leave your current room first');
        let r = this.publicRoom;
        if (!r || !r.open || r.game || r.members.length >= MAX_PLAYERS) {
          if (this.rooms.size >= MAX_ROOMS) return err('Server is busy, try again soon');
          r = new Room(this.newCode(), conn, msg.name, 1, this.clock, true, msg.look);
          this.rooms.set(r.code, r);
          this.publicRoom = r;
        } else {
          const e = r.add(conn, msg.name, msg.look);
          if (e) return err(e);
        }
        this.roomOf.set(conn.id, r);
        return;
      }
      case 'join': {
        if (room) return err('Leave your current room first');
        const r = this.rooms.get(msg.code);
        if (!r) return err('No room with that code');
        const e = r.add(conn, msg.name, msg.look);
        if (e) return err(e);
        this.roomOf.set(conn.id, r);
        return;
      }
      case 'start': {
        if (!room) return err('Join a room first');
        const e = room.start(conn.id);
        if (e) err(e);
        return;
      }
      case 'lock': {
        if (!room) return err('Join a room first');
        const e = room.lock(conn.id, msg.expr, msg.facing, { power: msg.power, to: msg.to });
        if (e) err(e);
        return;
      }
      case 'leave':
        this.disconnect(conn.id);
        return;
    }
  }

  disconnect(id: string) {
    const room = this.roomOf.get(id);
    if (!room) return;
    this.roomOf.delete(id);
    room.leave(id);
    if (room.empty) {
      room.dispose();
      this.rooms.delete(room.code);
      if (this.publicRoom === room) this.publicRoom = null;
    }
  }
}
