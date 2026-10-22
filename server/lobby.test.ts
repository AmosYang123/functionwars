import { describe, expect, it } from 'vitest';
import { PREP_MS } from '../src/engine/game.ts';
import { defaultLook } from '../src/net/look.ts';
import { parseClientMsg, type ClientMsg, type ServerMsg } from '../src/net/protocol.ts';
import { GRACE_MS, Lobby, PUBLIC_COUNTDOWN_MS, type Clock } from './lobby.ts';
import { RedisLobby, type Store } from './redis-lobby.ts';
import { hashKey, type Conn, type Hub } from './socket.ts';

const look = defaultLook();

function fakeClock() {
  let t = 0;
  let timers: { at: number; fn: () => void | Promise<void>; id: number }[] = [];
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
  const advance = async (ms: number) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      t = next.at;
      await next.fn();
    }
    t = end;
  };
  return { clock, advance };
}

/** One in-memory "Redis" shared by several server instances. Pub/sub delivers synchronously. */
function fakeRedis() {
  const data = new Map<string, string>();
  const listeners = new Map<string, Set<(m: string) => void>>();
  const instance = (): Store => {
    const mine = new Map<string, (m: string) => void>();
    return {
      get: async (k) => data.get(k) ?? null,
      set: async (k, v, _ttl, onlyIfNew) => {
        if (onlyIfNew && data.has(k)) return false;
        data.set(k, v);
        return true;
      },
      del: async (k) => void data.delete(k),
      delIf: async (k, v) => void (data.get(k) === v && data.delete(k)),
      publish: async (ch, m) => listeners.get(ch)?.forEach((fn) => fn(m)),
      subscribe: async (ch, fn) => {
        mine.set(ch, fn);
        listeners.set(ch, (listeners.get(ch) ?? new Set()).add(fn));
      },
      unsubscribe: async (ch) => {
        const fn = mine.get(ch);
        if (fn) listeners.get(ch)?.delete(fn);
        mine.delete(ch);
      },
    };
  };
  return { data, instance };
}

type Client = ReturnType<typeof client>;
const keyOf = (id: string) => id.charCodeAt(0).toString(16).padEnd(32, '0');

function client(id: string, hub: Hub, sid = `${id}-1`) {
  const inbox: ServerMsg[] = [];
  const conn: Conn = { id, sid, keyHash: hashKey(keyOf(id)), send: (m) => inbox.push(structuredClone(m)) };
  return {
    conn,
    inbox,
    send: async (m: ClientMsg) => hub.handle(conn, m),
    drop: async () => hub.disconnect(conn),
    last: <T extends ServerMsg['t']>(t: T) => [...inbox].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined,
  };
}

/** Both hosts, same rules: one process, and two Vercel-style instances sharing Redis (players split across them). */
const hosts = [
  {
    name: 'one process',
    make: () => {
      const { clock, advance } = fakeClock();
      const lobby = new Lobby(clock);
      return { hub: (_i: number): Hub => lobby, advance };
    },
  },
  {
    name: 'Redis, two instances',
    make: () => {
      const { clock, advance } = fakeClock();
      const redis = fakeRedis();
      const lobbies = [new RedisLobby(redis.instance(), clock), new RedisLobby(redis.instance(), clock)];
      return { hub: (i: number): Hub => lobbies[i % 2], advance };
    },
  },
];

for (const host of hosts) {
  describe(`server rooms (${host.name})`, () => {
    async function setup() {
      const { hub, advance } = host.make();
      const a = client('a', hub(0));
      const b = client('b', hub(1));
      await a.send({ t: 'create', name: 'Ann', lives: 1, look });
      const code = a.last('room')!.code;
      await b.send({ t: 'join', code, name: 'Bo', look });
      return { hub, a, b, advance, code };
    }

    it('lets only the host start, and needs two players', async () => {
      const { a, b } = await setup();
      expect(a.last('room')!.players.map((p) => p.name)).toEqual(['Ann', 'Bo']);
      await b.send({ t: 'start' });
      expect(b.last('error')?.msg).toMatch(/host/);
      await a.send({ t: 'start' });
      expect(a.last('round')?.prepMs).toBe(PREP_MS);
      expect(b.last('round')?.game.players).toHaveLength(2);
    });

    it('timestamps locks on the server clock and rejects invalid shots', async () => {
      const { a, b, advance } = await setup();
      await a.send({ t: 'start' });
      await advance(4200);
      await b.send({ t: 'lock', expr: 'ln(x - 3)', facing: 1 });
      expect(b.last('error')?.msg).toMatch(/isn't defined/);
      await b.send({ t: 'lock', expr: '0', facing: 1 });
      expect(a.last('locked')).toEqual({ t: 'locked', id: 'b', at: 4200 });
      // round-start broadcast never leaks equations
      expect(JSON.stringify(a.last('round'))).not.toContain('expr');
    });

    it('resolves when the timer runs out, and starts the next round after the replay', async () => {
      const { a, b, advance } = await setup();
      await a.send({ t: 'start' });
      // Seat 0 spawns on the left, so firing left can never hit B.
      await a.send({ t: 'lock', expr: '0', facing: -1 });
      await advance(PREP_MS + 1);
      const res = b.last('resolve')!;
      expect(res.events.map((e) => e.kind)).toEqual(['shot', 'pass']);
      const rounds = () => b.inbox.filter((m) => m.t === 'round').length;
      expect(rounds()).toBe(1);
      await advance(res.nextInMs ?? 0);
      if (res.game.phase === 'prep') expect(rounds()).toBe(2);
    });

    it('resolves early once everyone has locked in', async () => {
      const { a, b, advance } = await setup();
      await a.send({ t: 'start' });
      await advance(1000);
      await a.send({ t: 'lock', expr: '0.1x', facing: 1 });
      await b.send({ t: 'lock', expr: '0.1x', facing: -1 });
      expect(a.last('resolve')).toBeDefined();
      await a.send({ t: 'lock', expr: '0', facing: 1 });
      expect(a.last('error')?.msg).toMatch(/Not accepting/);
    });

    it('ends the match at once when the other player leaves', async () => {
      const { a, b } = await setup();
      await a.send({ t: 'start' });
      await b.send({ t: 'leave' });
      const res = a.last('resolve')!;
      expect(res.game.phase).toBe('over');
      expect(res.game.winnerId).toBe('a');
    });

    it('holds a dropped player\'s seat, and lets them reconnect into the same round', async () => {
      const { hub, a, b, advance } = await setup();
      await a.send({ t: 'start' });
      await b.drop();
      await advance(GRACE_MS - 1000);
      expect(a.last('resolve')).toBeUndefined();
      // A new socket (on the other instance) proves it is B with B's key.
      const b2 = client('fresh', hub(0), 'b-2');
      await b2.send({ t: 'resume', id: 'b', key: keyOf('b') });
      expect(b2.last('resumed')).toBeDefined();
      expect(b2.conn.id).toBe('b');
      expect(b2.last('round')?.prepMs).toBe(PREP_MS - (GRACE_MS - 1000));
      await advance(2000);
      expect(a.last('resolve')).toBeUndefined();
      await b2.send({ t: 'lock', expr: '0', facing: 1 });
      expect(a.last('locked')).toMatchObject({ id: 'b' });
      // The old socket closing late must not knock out the new one.
      await b.drop();
      expect(a.last('room')!.players.find((p) => p.id === 'b')!.connected).toBe(true);
    });

    it('ends the match when a dropped player does not come back in time', async () => {
      const { a, b, advance } = await setup();
      await a.send({ t: 'start' });
      await b.drop();
      await advance(GRACE_MS);
      const res = a.last('resolve')!;
      expect(res.game.phase).toBe('over');
      expect(res.game.winnerId).toBe('a');
    });

    it('refuses to resume with the wrong key or an unknown player', async () => {
      const { hub, a, b } = await setup();
      await a.send({ t: 'start' });
      await b.drop();
      const thief = client('c', hub(1), 'c-1');
      await thief.send({ t: 'resume', id: 'b', key: keyOf('c') });
      expect(thief.last('error')).toMatchObject({ code: 'resume' });
      expect(thief.conn.id).toBe('c');
      expect(thief.last('round')).toBeUndefined();
      await thief.send({ t: 'resume', id: 'nobody', key: keyOf('c') });
      expect(thief.inbox.filter((m) => m.t === 'error')).toHaveLength(2);
    });

    it('rejects joining a running match and bad codes', async () => {
      const { hub, a, code } = await setup();
      await a.send({ t: 'start' });
      const c = client('c', hub(0));
      await c.send({ t: 'join', code, name: 'Cy', look });
      expect(c.last('error')?.msg).toMatch(/already started/);
      await c.send({ t: 'join', code: 'ZZZZZ', name: 'Cy', look });
      expect(c.last('error')?.msg).toMatch(/No room/);
    });
  });

  describe(`public matchmaking (${host.name})`, () => {
    const rounds = (c: Client) => c.inbox.filter((m) => m.t === 'round').length;

    it('puts quick-match players in the same room and starts when the countdown ends', async () => {
      const { hub, advance } = host.make();
      const a = client('a', hub(0));
      const b = client('b', hub(1));
      await a.send({ t: 'quick', name: 'Ann', look });
      expect(a.last('room')).toMatchObject({ isPublic: true, startsInMs: null });
      await b.send({ t: 'quick', name: 'Bo', look });
      expect(b.last('room')!.code).toBe(a.last('room')!.code);
      expect(b.last('room')!.startsInMs).toBe(PUBLIC_COUNTDOWN_MS);
      await a.send({ t: 'start' });
      expect(a.last('error')?.msg).toMatch(/on their own/);
      await advance(PUBLIC_COUNTDOWN_MS - 1);
      expect(rounds(a)).toBe(0);
      await advance(1);
      expect(rounds(a)).toBe(1);
      expect(rounds(b)).toBe(1);
    });

    it('starts immediately at the player cap, and the next player gets a new room', async () => {
      const { hub } = host.make();
      const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => client(id, hub(i)));
      for (const c of six) await c.send({ t: 'quick', name: '', look });
      expect(six.every((c) => rounds(c) === 1)).toBe(true);
      const late = client('g', hub(0));
      await late.send({ t: 'quick', name: '', look });
      expect(late.last('room')!.code).not.toBe(six[0].last('room')!.code);
      expect(rounds(late)).toBe(0);
    });

    it('cancels the countdown when players drop', async () => {
      const { hub, advance } = host.make();
      const a = client('a', hub(0));
      const b = client('b', hub(1));
      await a.send({ t: 'quick', name: '', look });
      await b.send({ t: 'quick', name: '', look });
      await b.drop();
      expect(a.last('room')!.startsInMs).toBeNull();
      await advance(PUBLIC_COUNTDOWN_MS * 2);
      expect(rounds(a)).toBe(0);
    });
  });
}

describe('message validation', () => {
  it('drops malformed or oversized input and cleans names', () => {
    expect(parseClientMsg(null)).toBeNull();
    expect(parseClientMsg({ t: 'nope' })).toBeNull();
    expect(parseClientMsg({ t: 'lock', expr: 'x', facing: 2 })).toBeNull();
    expect(parseClientMsg({ t: 'lock', expr: 'x'.repeat(500), facing: 1 })).toBeNull();
    expect(parseClientMsg({ t: 'join', code: 'abc', name: 'x', look })).toBeNull();
    expect(parseClientMsg({ t: 'join', code: 'abcde', name: 'x', look })).toEqual({ t: 'join', code: 'ABCDE', name: 'x', look });
    expect(parseClientMsg({ t: 'create', name: ' <b>\u0007hi</b> ' + 'z'.repeat(40), lives: 9, look })).toEqual({ t: 'create', name: '<b>hi</b> zzzzzz', lives: 1, look });
    expect(parseClientMsg({ t: 'resume', id: 'b', key: 'x' })).toBeNull();
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(parseClientMsg({ t: 'resume', id, key: 'ab'.repeat(16) })).toEqual({ t: 'resume', id, key: 'ab'.repeat(16) });
  });
});
