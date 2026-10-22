import { createServer } from 'node:http';
import { RedisLobby } from './redis-lobby.ts';
import { redisStore } from './redis-store.ts';
import { serveSockets } from './socket.ts';

/**
 * The online game server as a Vercel Function. Bundled into api/ws.js by
 * `npm run build:api`; vercel.json rewrites /ws here. Each function instance
 * holds some of the sockets, and rooms are shared through Redis.
 */
const url = process.env.REDIS_URL ?? process.env.KV_URL;

const server = createServer((_req, res) => {
  res.writeHead(url ? 200 : 503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  res.end(url ? 'ok' : 'Online play needs a Redis database: connect one in Vercel (Storage) so REDIS_URL is set.');
});

if (url) serveSockets(server, new RedisLobby(redisStore(url)), ['/ws', '/api/ws']);
else console.error('REDIS_URL is not set: online play is off');

export default server;
