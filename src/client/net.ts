import type { ClientMsg, ServerMsg } from '../net/protocol.ts';

/**
 * Game server address: same host by default (npm start, or the Vite dev proxy).
 * When the site is hosted somewhere that can't run the WebSocket server (Vercel),
 * build with VITE_WS_URL=wss://your-server.example.com/ws.
 */
function serverUrl(): string {
  const configured: unknown = import.meta.env.VITE_WS_URL;
  if (typeof configured === 'string' && configured) return configured;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export class Net {
  private ws: WebSocket;
  private queue: ClientMsg[] = [];
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: () => void = () => {};

  constructor() {
    this.ws = new WebSocket(serverUrl());
    this.ws.addEventListener('open', () => {
      for (const m of this.queue) this.ws.send(JSON.stringify(m));
      this.queue = [];
    });
    this.ws.addEventListener('message', (e) => {
      try {
        this.onMessage(JSON.parse(String(e.data)) as ServerMsg);
      } catch {
        /* ignore malformed frames */
      }
    });
    this.ws.addEventListener('close', () => this.onClose());
  }

  send(m: ClientMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else if (this.ws.readyState === WebSocket.CONNECTING) this.queue.push(m);
  }

  close() {
    this.onClose = () => {};
    this.ws.close();
  }
}
