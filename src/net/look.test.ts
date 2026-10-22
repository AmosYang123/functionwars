import { describe, expect, it } from 'vitest';
import { Lobby } from '../../server/rooms.ts';
import { defaultLook, parseLook, uniqueColor } from './look.ts';
import { parseClientMsg, type ServerMsg } from './protocol.ts';

describe('cosmetics from the network', () => {
  it('keeps only known ids and falls back per field', () => {
    expect(parseLook({ color: '#ff8a1f', face: 'cat', hat: 'crown', shot: 'rainbow' })).toEqual({ color: '#ff8a1f', face: 'cat', hat: 'crown', shot: 'rainbow' });
    expect(parseLook({ color: 'red; background:url(x)', face: '<img>', hat: 7, shot: null }, 0)).toEqual(defaultLook(0));
    expect(parseLook('nope')).toEqual(defaultLook());
  });

  it('gives a clashing color the first free one', () => {
    expect(uniqueColor('#2f7cf6', [])).toBe('#2f7cf6');
    expect(uniqueColor('#2f7cf6', ['#2f7cf6', '#f0483e'])).toBe('#22b35e');
  });

  it('keeps colors distinct inside a room', () => {
    const lobby = new Lobby();
    const inbox: ServerMsg[] = [];
    const look = { color: '#ff8a1f', face: 'cat' as const, hat: 'crown' as const, shot: 'rainbow' as const };
    lobby.handle({ id: 'a', send: (m) => inbox.push(m) }, { t: 'create', name: 'A', lives: 1, look });
    const code = (inbox.find((m) => m.t === 'room') as Extract<ServerMsg, { t: 'room' }>).code;
    lobby.handle({ id: 'b', send: (m) => inbox.push(m) }, { t: 'join', code, name: 'B', look });
    const room = [...inbox].reverse().find((m) => m.t === 'room') as Extract<ServerMsg, { t: 'room' }>;
    expect(room.players.map((p) => p.look.color)).toEqual(['#ff8a1f', '#f0483e']);
    expect(room.players[1].look.hat).toBe('crown');
    lobby.disconnect('a');
    lobby.disconnect('b');
  });

  it('validates power-up use on lock messages', () => {
    expect(parseClientMsg({ t: 'lock', expr: 'x', facing: 1, power: true, to: { x: 3, y: 4 } })).toEqual({ t: 'lock', expr: 'x', facing: 1, power: true, to: { x: 3, y: 4 } });
    expect(parseClientMsg({ t: 'lock', expr: 'x', facing: 1, power: 'yes' })).toEqual({ t: 'lock', expr: 'x', facing: 1 });
    expect(parseClientMsg({ t: 'lock', expr: 'x', facing: 1, to: { x: 'a', y: 1 } })).toBeNull();
    expect(parseClientMsg({ t: 'lock', expr: 'x', facing: 1, to: { x: Infinity, y: 1 } })).toBeNull();
  });
});
