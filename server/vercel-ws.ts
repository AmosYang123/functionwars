import { createServer } from 'node:http';
import { Lobby } from './lobby.ts';
import { RedisLobby } from './redis-lobby.ts';
import { findRedisUrl, redisStore } from './redis-store.ts';
import { serveSockets } from './socket.ts';

/**
 * The online game server as a Vercel Function. Bundled into api/ws.js by
 * `npm run build:api`; vercel.json rewrites /ws here. Each function instance
 * holds some of the sockets, and rooms are shared through Redis.
 *
 * Without Redis, rooms live in this instance's memory. That works while every
 * player of a room lands on the same instance, which is usual with little
 * traffic, but a player routed to another instance can't find the room.
 * ponytail: memory fallback so online play works before Redis is connected; Redis makes it reliable.
 */
const url = findRedisUrl(process.env);

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  res.end(url ? 'ok' : 'ok (no Redis: rooms are kept in memory)');
});

if (!url) console.warn('No Redis URL found: keeping rooms in memory');
serveSockets(server, url ? new RedisLobby(redisStore(url)) : new Lobby(), ['/ws', '/api/ws']);

export default server;
