import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseClientMsg, type ClientMsg, type ServerMsg } from '../src/net/protocol.ts';

/** One open socket. `id` is the player it plays as; it changes when the socket resumes an earlier seat. */
export interface Conn {
  id: string;
  /** Unique per socket, so a stale socket closing late can't knock out its replacement. */
  sid: string;
  /** sha256 of the resume key sent to this socket in `welcome`. */
  keyHash: string;
  send: (msg: ServerMsg) => void;
}

/** Where validated messages go: one process (Lobby) or Redis shared by many (RedisLobby). */
export interface Hub {
  handle(conn: Conn, msg: ClientMsg): void | Promise<void>;
  disconnect(conn: Conn): void | Promise<void>;
}

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

const MSG_RATE = 10; // per second
const MSG_BURST = 20;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (ALLOWED_ORIGINS.length) return ALLOWED_ORIGINS.includes(origin);
  try {
    const o = new URL(origin);
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    // Same host, or the Vite dev server proxying from localhost.
    return o.host === host || ((o.hostname === 'localhost' || o.hostname === '127.0.0.1') && process.env.NODE_ENV !== 'production');
  } catch {
    return false;
  }
}

/** Accept WebSocket upgrades on `paths`, rate-limit and validate every message, and hand them to the hub in order. */
export function serveSockets(server: Server, hub: Hub, paths: string[]) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });

  server.on('upgrade', (req, socket, head) => {
    let path = '';
    try {
      path = new URL(req.url ?? '/', 'http://x').pathname;
    } catch {
      /* rejected below */
    }
    if (!paths.includes(path) || !originAllowed(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => connection(ws));
  });

  function connection(ws: WebSocket) {
    const key = randomBytes(16).toString('hex');
    const conn: Conn = {
      id: randomUUID(),
      sid: randomUUID(),
      keyHash: hashKey(key),
      send: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    // Hub calls may be async (Redis); keep each socket's messages in order.
    let chain = Promise.resolve();
    const run = (fn: () => void | Promise<void>) => {
      chain = chain.then(fn).catch((e: unknown) => {
        console.error('handler error', e instanceof Error ? e.message : 'unknown');
        conn.send({ t: 'error', msg: 'Something went wrong' });
      });
    };
    let tokens = MSG_BURST;
    let last = Date.now();
    let strikes = 0;
    conn.send({ t: 'welcome', you: conn.id, key });

    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      tokens = Math.min(MSG_BURST, tokens + ((now - last) / 1000) * MSG_RATE);
      last = now;
      if (tokens < 1) {
        if (++strikes > 50) ws.close(1008, 'Too many messages');
        return;
      }
      tokens -= 1;
      if (isBinary) return;
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        return;
      }
      const msg = parseClientMsg(raw);
      if (!msg) {
        conn.send({ t: 'error', msg: 'Malformed message' });
        return;
      }
      run(() => hub.handle(conn, msg));
    });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => run(() => hub.disconnect(conn)));
  }
}
