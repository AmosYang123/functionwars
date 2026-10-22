import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseClientMsg, type ServerMsg } from '../src/net/protocol.ts';
import { Lobby } from './rooms.ts';

const PORT = Number(process.env.PORT ?? 3000);
const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const MSG_RATE = 10; // per second
const MSG_BURST = 20;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  ...(process.env.NODE_ENV === 'production' ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, SECURITY_HEADERS).end();
    return;
  }
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400, SECURITY_HEADERS).end();
    return;
  }
  // For hosts that health-check the server, which may run without a built client.
  if (path === '/health') {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('ok');
    return;
  }
  // Resolve inside dist only; anything else falls back to the app shell.
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' }).end('Build the client first: npm run build');
    return;
  }
  const ext = extname(file);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
});

function originAllowed(req: IncomingMessage): boolean {
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

const lobby = new Lobby();
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });

server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws' || !originAllowed(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws: WebSocket) => {
  const id = randomUUID();
  const conn = {
    id,
    send: (msg: ServerMsg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  let tokens = MSG_BURST;
  let last = Date.now();
  let strikes = 0;
  conn.send({ t: 'welcome', you: id });

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
    try {
      lobby.handle(conn, msg);
    } catch (e) {
      console.error('handler error', e instanceof Error ? e.message : 'unknown');
      conn.send({ t: 'error', msg: 'Something went wrong' });
    }
  });
  ws.on('close', () => lobby.disconnect(id));
});

server.listen(PORT, () => console.log(`Function War server on http://localhost:${PORT}`));
