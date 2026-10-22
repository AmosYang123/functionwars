import { randomInt } from 'node:crypto';
import {
  createGame, lockIn, MAX_PLAYERS, MIN_PLAYERS, PREP_MS, removePlayer, replayDurationMs, resolveRound, type GameState, type PowerUse,
} from '../src/engine/game.ts';
import { defaultLook, uniqueColor, type Look } from '../src/net/look.ts';
import { publicGame, type RoomPlayer, type ServerMsg } from '../src/net/protocol.ts';

/**
 * One match as plain, serializable data. Every change goes through the
 * functions below, which never touch timers or sockets: they set `due` for
 * the next timed step and queue outgoing messages. That lets the same rules
 * run in one Node process (lobby.ts) or across many Vercel instances sharing
 * Redis (redis-lobby.ts).
 */

const SEAT_NAMES = ['Coral', 'Cyan', 'Lime', 'Amber', 'Violet', 'Rose'];
const BETWEEN_ROUNDS_MS = 1500;
/** Public rooms start this long after the second player joins (or sooner, when full). */
export const PUBLIC_COUNTDOWN_MS = 20_000;
/** A dropped connection keeps its seat this long, so a reconnect picks up where it left off. */
export const GRACE_MS = 20_000;

export interface Member extends RoomPlayer {
  /** sha256 of the resume key only this player's client knows. */
  keyHash: string;
  /** The connection currently playing as this member; an older connection closing late is ignored. */
  sid: string;
  /** When the connection dropped; the seat is held until GRACE_MS later. */
  goneAt?: number;
  /** Left for good during a match: kept for the scoreboard, never resumable. */
  left?: true;
}

export interface Joiner {
  id: string;
  name: string;
  look?: Look;
  keyHash: string;
  sid: string;
}

export type DueKind = 'launch' | 'endPrep' | 'beginRound' | 'room';

export interface RoomState {
  code: string;
  hostId: string;
  lives: number;
  isPublic: boolean;
  /** A public room accepts strangers until its game starts, then never again. */
  open: boolean;
  members: Member[];
  game: GameState | null;
  roundStart: number;
  prepOpen: boolean;
  /** The next timed step: start a public game, end the aiming phase, start the next round, show the room again. */
  due: { at: number; kind: DueKind } | null;
}

export interface Out {
  to: string[];
  msg: ServerMsg;
}

/** The time now, and the messages an operation produces. */
export interface Ctx {
  now: number;
  out: Out[];
}

const active = (m: Member) => !m.left;
const connected = (s: RoomState) => s.members.filter((m) => m.connected);
const inGrace = (m: Member) => !m.connected && m.goneAt !== undefined;

export const isMember = (s: RoomState, id: string) => s.members.some((m) => m.id === id && active(m));

function broadcast(s: RoomState, ctx: Ctx, msg: ServerMsg) {
  ctx.out.push({ to: connected(s).map((m) => m.id), msg });
}

export function tell(ctx: Ctx, id: string, msg: ServerMsg) {
  ctx.out.push({ to: [id], msg });
}

export function roomMsg(s: RoomState, now: number): Extract<ServerMsg, { t: 'room' }> {
  return {
    t: 'room',
    code: s.code,
    hostId: s.hostId,
    players: s.members.filter(active).map(({ id, name, seat, connected, look }) => ({ id, name, seat, connected, look })),
    lives: s.lives,
    inGame: s.game !== null,
    isPublic: s.isPublic,
    startsInMs: s.due?.kind === 'launch' ? Math.max(0, s.due.at - now) : null,
  };
}

function roundMsg(s: RoomState, now: number): ServerMsg {
  const g = s.game!;
  return {
    t: 'round',
    game: publicGame(g),
    prepMs: Math.max(0, s.roundStart + PREP_MS - now),
    locks: Object.entries(g.locks).map(([id, l]) => ({ id, at: l.at })),
  };
}

export function createRoom(code: string, host: Joiner, lives: number, isPublic: boolean, ctx: Ctx): RoomState {
  const s: RoomState = { code, hostId: host.id, lives, isPublic, open: isPublic, members: [], game: null, roundStart: 0, prepOpen: false, due: null };
  addMember(s, host, ctx);
  return s;
}

export function addMember(s: RoomState, j: Joiner, ctx: Ctx): string | null {
  if (s.game) return 'That match has already started';
  if (s.members.length >= MAX_PLAYERS) return 'That room is full';
  const used = new Set(s.members.map((m) => m.seat));
  let seat = 0;
  while (used.has(seat)) seat++;
  const want = j.look ?? defaultLook(seat);
  const color = uniqueColor(want.color, s.members.map((m) => m.look.color));
  s.members.push({ id: j.id, name: j.name || SEAT_NAMES[seat], seat, connected: true, look: { ...want, color }, keyHash: j.keyHash, sid: j.sid });
  if (s.isPublic) updateCountdown(s, ctx);
  broadcastRoom(s, ctx);
  return null;
}

/** Public rooms: start when full, count down once two are here, stop if they drop below two. */
function updateCountdown(s: RoomState, ctx: Ctx) {
  if (!s.open) return;
  const here = connected(s).length;
  if (here >= MAX_PLAYERS) launch(s, ctx);
  else if (here >= MIN_PLAYERS && s.due?.kind !== 'launch') s.due = { at: ctx.now + PUBLIC_COUNTDOWN_MS, kind: 'launch' };
  else if (here < MIN_PLAYERS && s.due?.kind === 'launch') s.due = null;
}

/** Leave for good: the "Leave" button, or a dropped connection that didn't come back in time. */
export function remove(s: RoomState, id: string, ctx: Ctx) {
  const m = s.members.find((q) => q.id === id && active(q));
  if (!m) return;
  if (s.game) {
    m.connected = false;
    m.goneAt = undefined;
    m.left = true;
    s.game = removePlayer(s.game, id);
    if (s.game.phase === 'over') finishEarly(s, ctx);
    else maybeEndPrep(s, ctx);
  } else {
    s.members = s.members.filter((q) => q !== m);
    if (s.isPublic) updateCountdown(s, ctx);
  }
  if (s.hostId === id) s.hostId = connected(s)[0]?.id ?? '';
  broadcastRoom(s, ctx);
}

/** The connection dropped. The seat is held for GRACE_MS. */
export function drop(s: RoomState, id: string, sid: string, ctx: Ctx) {
  const m = s.members.find((q) => q.id === id && active(q));
  if (!m || !m.connected || m.sid !== sid) return;
  m.connected = false;
  m.goneAt = ctx.now;
  if (s.isPublic && !s.game) updateCountdown(s, ctx);
  broadcastRoom(s, ctx);
}

/** A reconnecting client proves it is the same player with its resume key. */
export function resume(s: RoomState, id: string, keyHash: string, sid: string, ctx: Ctx): string | null {
  const m = s.members.find((q) => q.id === id && active(q));
  if (!m || m.keyHash !== keyHash) return 'That game is no longer available';
  m.connected = true;
  m.goneAt = undefined;
  m.sid = sid;
  tell(ctx, id, { t: 'resumed' });
  if (s.isPublic && !s.game) updateCountdown(s, ctx);
  broadcastRoom(s, ctx);
  if (s.game && s.prepOpen) tell(ctx, id, roundMsg(s, ctx.now));
  return null;
}

export function start(s: RoomState, by: string, ctx: Ctx): string | null {
  if (s.isPublic) return 'Public games start on their own';
  if (by !== s.hostId) return 'Only the host can start';
  if (s.game) return 'Already playing';
  if (connected(s).length < MIN_PLAYERS) return 'Need at least 2 players';
  launch(s, ctx);
  return null;
}

function launch(s: RoomState, ctx: Ctx) {
  if (s.game) return;
  if (s.due?.kind === 'launch') s.due = null;
  s.open = false;
  const players = connected(s);
  if (players.length < MIN_PLAYERS) return;
  s.members = players;
  s.game = createGame(players.map((m) => ({ id: m.id, name: m.name })), randomInt(2 ** 31), { lives: s.lives });
  // Keep colors stable with lobby seats
  s.game.players.forEach((p) => (p.seat = players.find((m) => m.id === p.id)!.seat));
  broadcastRoom(s, ctx);
  beginRound(s, ctx);
}

export function lock(s: RoomState, id: string, expr: string, facing: 1 | -1, use: PowerUse, ctx: Ctx): string | null {
  if (!s.game || s.game.phase !== 'prep' || !s.prepOpen) return 'Not accepting shots right now';
  const at = ctx.now - s.roundStart;
  if (at > PREP_MS) return 'Time is up';
  const r = lockIn(s.game, id, expr, facing, at, use);
  if (!r.ok) return r.error;
  s.game = r.state;
  broadcast(s, ctx, { t: 'locked', id, at });
  maybeEndPrep(s, ctx);
  return null;
}

function beginRound(s: RoomState, ctx: Ctx) {
  if (!s.game) return;
  s.roundStart = ctx.now;
  s.prepOpen = true;
  broadcast(s, ctx, { t: 'round', game: publicGame(s.game), prepMs: PREP_MS, locks: [] });
  s.due = { at: ctx.now + PREP_MS, kind: 'endPrep' };
}

/** Everyone still playing (or reconnecting) has locked in: nobody loses time by resolving now. */
function maybeEndPrep(s: RoomState, ctx: Ctx) {
  const g = s.game;
  if (!g || !s.prepOpen) return;
  const waiting = g.players.filter((p) => {
    const m = s.members.find((q) => q.id === p.id);
    return p.alive && !g.locks[p.id] && m && (m.connected || inGrace(m));
  });
  if (waiting.length === 0) endPrep(s, ctx);
}

function endPrep(s: RoomState, ctx: Ctx) {
  if (!s.game || !s.prepOpen) return;
  s.prepOpen = false;
  const { state, events } = resolveRound(s.game);
  s.game = state;
  const over = state.phase === 'over';
  const wait = replayDurationMs(events, state.bounds) + BETWEEN_ROUNDS_MS;
  broadcast(s, ctx, { t: 'resolve', events, game: publicGame(state), nextInMs: over ? null : wait });
  if (over) {
    s.game = null;
    s.members = s.members.filter((m) => m.connected || inGrace(m));
    s.due = { at: ctx.now + wait, kind: 'room' };
  } else {
    s.due = { at: ctx.now + wait, kind: 'beginRound' };
  }
}

function finishEarly(s: RoomState, ctx: Ctx) {
  s.prepOpen = false;
  s.due = null;
  broadcast(s, ctx, { t: 'resolve', events: [], game: publicGame(s.game!), nextInMs: null });
  s.game = null;
  s.members = s.members.filter((m) => m.connected || inGrace(m));
}

function broadcastRoom(s: RoomState, ctx: Ctx) {
  broadcast(s, ctx, roomMsg(s, ctx.now));
}

/** Run whatever is due: expired reconnect grace, then the scheduled step. Hosts call this before every change. */
export function tick(s: RoomState, ctx: Ctx) {
  for (const m of [...s.members]) {
    if (inGrace(m) && ctx.now - m.goneAt! >= GRACE_MS) remove(s, m.id, ctx);
  }
  const d = s.due;
  if (!d || ctx.now < d.at) return;
  s.due = null;
  if (d.kind === 'launch') launch(s, ctx);
  else if (d.kind === 'endPrep') endPrep(s, ctx);
  else if (d.kind === 'beginRound') beginRound(s, ctx);
  else broadcastRoom(s, ctx);
}

/** When the host should call tick next, or null when nothing is scheduled. */
export function wakeAt(s: RoomState): number | null {
  const times = s.members.filter(inGrace).map((m) => m.goneAt! + GRACE_MS);
  if (s.due) times.push(s.due.at);
  return times.length ? Math.min(...times) : null;
}

/** Nobody here and nobody coming back: the room can be thrown away. */
export const isEmpty = (s: RoomState) => s.members.every((m) => !m.connected && !inGrace(m));
