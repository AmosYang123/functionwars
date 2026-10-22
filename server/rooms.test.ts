import { describe, expect, it } from 'vitest';
import { PREP_MS } from '../src/engine/game.ts';
import { parseClientMsg, type ServerMsg } from '../src/net/protocol.ts';
import { defaultLook } from '../src/net/look.ts';
import { Lobby, PUBLIC_COUNTDOWN_MS, type Clock, type Conn } from './rooms.ts';

const look = defaultLook();

function fakeClock() {
  let t = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let seq = 0;
  const clock: Clock = {
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimeout: (h) => (timers = timers.filter((x) => x.id !== h)),
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      t = next.at;
      next.fn();
    }
    t = end;
  };
  return { clock, advance };
}

function client(id: string) {
  const inbox: ServerMsg[] = [];
  const conn: Conn = { id, send: (m) => inbox.push(structuredClone(m)) };
  return { conn, inbox, last: <T extends ServerMsg['t']>(t: T) => [...inbox].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined };
}

function setup() {
  const { clock, advance } = fakeClock();
  const lobby = new Lobby(clock);
  const a = client('a');
  const b = client('b');
  lobby.handle(a.conn, { t: 'create', name: 'Ann', lives: 1, look });
  const code = a.last('room')!.code;
  lobby.handle(b.conn, { t: 'join', code, name: 'Bo', look });
  return { lobby, a, b, advance, code };
}

describe('server rooms', () => {
  it('lets only the host start, and needs two players', () => {
    const { lobby, a, b } = setup();
    lobby.handle(b.conn, { t: 'start' });
    expect(b.last('error')?.msg).toMatch(/host/);
    lobby.handle(a.conn, { t: 'start' });
    expect(a.last('round')?.prepMs).toBe(PREP_MS);
    expect(b.last('round')?.game.players).toHaveLength(2);
  });

  it('timestamps locks on the server clock and rejects invalid shots', () => {
    const { lobby, a, b, advance } = setup();
    lobby.handle(a.conn, { t: 'start' });
    advance(4200);
    lobby.handle(b.conn, { t: 'lock', expr: 'ln(x - 3)', facing: 1 });
    expect(b.last('error')?.msg).toMatch(/isn't defined/);
    lobby.handle(b.conn, { t: 'lock', expr: '0', facing: 1 });
    expect(a.last('locked')).toEqual({ t: 'locked', id: 'b', at: 4200 });
    // round-start broadcast never leaks equations
    expect(JSON.stringify(a.last('round'))).not.toContain('locks":{');
  });

  it('resolves when the timer runs out, and starts the next round after the replay', () => {
    const { lobby, a, b, advance } = setup();
    lobby.handle(a.conn, { t: 'start' });
    // Seat 0 spawns on the left, so firing left can never hit B.
    lobby.handle(a.conn, { t: 'lock', expr: '0', facing: -1 });
    advance(PREP_MS + 1);
    const res = b.last('resolve')!;
    expect(res.events.map((e) => e.kind)).toEqual(['shot', 'pass']);
    const rounds = () => b.inbox.filter((m) => m.t === 'round').length;
    expect(rounds()).toBe(1);
    advance(res.nextInMs ?? 0);
    if (res.game.phase === 'prep') expect(rounds()).toBe(2);
  });

  it('resolves early once everyone has locked in', () => {
    const { lobby, a, b, advance } = setup();
    lobby.handle(a.conn, { t: 'start' });
    advance(1000);
    lobby.handle(a.conn, { t: 'lock', expr: '0.1x', facing: 1 });
    lobby.handle(b.conn, { t: 'lock', expr: '0.1x', facing: -1 });
    expect(a.last('resolve')).toBeDefined();
    lobby.handle(a.conn, { t: 'lock', expr: '0', facing: 1 });
    expect(a.last('error')?.msg).toMatch(/Not accepting/);
  });

  it('ends the match when the other player leaves', () => {
    const { lobby, a, b } = setup();
    lobby.handle(a.conn, { t: 'start' });
    lobby.disconnect('b');
    const res = a.last('resolve')!;
    expect(res.game.phase).toBe('over');
    expect(res.game.winnerId).toBe('a');
    expect(b.inbox.length).toBeGreaterThan(0);
  });

  it('rejects joining a running match and bad codes', () => {
    const { lobby, a, code } = setup();
    lobby.handle(a.conn, { t: 'start' });
    const c = client('c');
    lobby.handle(c.conn, { t: 'join', code, name: 'Cy', look });
    expect(c.last('error')?.msg).toMatch(/already started/);
    lobby.handle(c.conn, { t: 'join', code: 'ZZZZZ', name: 'Cy', look });
    expect(c.last('error')?.msg).toMatch(/No room/);
  });
});

describe('public matchmaking', () => {
  const rounds = (c: ReturnType<typeof client>) => c.inbox.filter((m) => m.t === 'round').length;

  it('puts quick-match players in the same room and starts when the countdown ends', () => {
    const { clock, advance } = fakeClock();
    const lobby = new Lobby(clock);
    const a = client('a');
    const b = client('b');
    lobby.handle(a.conn, { t: 'quick', name: 'Ann', look });
    expect(a.last('room')).toMatchObject({ isPublic: true, startsInMs: null });
    lobby.handle(b.conn, { t: 'quick', name: 'Bo', look });
    expect(b.last('room')!.code).toBe(a.last('room')!.code);
    expect(b.last('room')!.startsInMs).toBe(PUBLIC_COUNTDOWN_MS);
    lobby.handle(a.conn, { t: 'start' });
    expect(a.last('error')?.msg).toMatch(/on their own/);
    advance(PUBLIC_COUNTDOWN_MS - 1);
    expect(rounds(a)).toBe(0);
    advance(1);
    expect(rounds(a)).toBe(1);
    expect(rounds(b)).toBe(1);
  });

  it('starts immediately at the player cap, and the next player gets a new room', () => {
    const { clock } = fakeClock();
    const lobby = new Lobby(clock);
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(client);
    for (const c of six) lobby.handle(c.conn, { t: 'quick', name: '', look });
    expect(six.every((c) => rounds(c) === 1)).toBe(true);
    const late = client('g');
    lobby.handle(late.conn, { t: 'quick', name: '', look });
    expect(late.last('room')!.code).not.toBe(six[0].last('room')!.code);
    expect(rounds(late)).toBe(0);
  });

  it('cancels the countdown when players leave', () => {
    const { clock, advance } = fakeClock();
    const lobby = new Lobby(clock);
    const a = client('a');
    const b = client('b');
    lobby.handle(a.conn, { t: 'quick', name: '', look });
    lobby.handle(b.conn, { t: 'quick', name: '', look });
    lobby.disconnect('b');
    expect(a.last('room')!.startsInMs).toBeNull();
    advance(PUBLIC_COUNTDOWN_MS * 2);
    expect(rounds(a)).toBe(0);
  });
});

describe('message validation', () => {
  it('drops malformed or oversized input and cleans names', () => {
    expect(parseClientMsg(null)).toBeNull();
    expect(parseClientMsg({ t: 'nope' })).toBeNull();
    expect(parseClientMsg({ t: 'lock', expr: 'x', facing: 2 })).toBeNull();
    expect(parseClientMsg({ t: 'lock', expr: 'x'.repeat(500), facing: 1 })).toBeNull();
    expect(parseClientMsg({ t: 'join', code: 'abc', name: 'x', look })).toBeNull();
    expect(parseClientMsg({ t: 'join', code: 'abcde', name: 'x', look })).toEqual({ t: 'join', code: 'ABCDE', name: 'x', look });
    expect(parseClientMsg({ t: 'create', name: ' <b>\u0007hi</b> ' + 'z'.repeat(40), lives: 9, look })).toEqual({ t: 'create', name: '<b>hi</b> zzzzzz', lives: 1, look });
  });
});
