import type { ClientMsg, ServerMsg } from '../net/protocol.ts';

/**
 * Game server address: same host by default. `npm start` and the Vite dev proxy
 * serve /ws directly; on Vercel, vercel.json rewrites /ws to the api/ws function.
 * VITE_WS_URL points somewhere else (wss://other-host/ws) when the server runs elsewhere.
 */
function serverUrl(): string {
  const configured: unknown = import.meta.env.VITE_WS_URL;
  if (typeof configured === 'string' && configured) return configured;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export type NetStatus = 'online' | 'reconnecting' | 'offline';

const MAX_RETRIES = 6;

/**
 * One connection to the game server that survives drops: it reconnects with
 * backoff and, while you hold a seat in a room, proves it is still you with the
 * resume key from the first `welcome`, so the match carries on. (Serverless
 * hosts close long connections on purpose; this is what keeps a game alive.)
 */
export class Net {
  private ws: WebSocket | null = null;
  private queue: ClientMsg[] = [];
  private ready = false;
  private closed = false;
  private connectedOnce = false;
  private failures = 0;
  private retryTimer = 0;
  /** Who we play as. */
  private me: { id: string; key: string } | null = null;
  /** The identity the server offered on the latest connection, used if there's nothing to resume. */
  private fresh: { id: string; key: string } | null = null;
  /** Set while we hold a seat in a room, so a reconnect takes it back. */
  inRoom = false;
  onMessage: (m: ServerMsg) => void = () => {};
  onStatus: (s: NetStatus) => void = () => {};

  constructor() {
    this.connect();
  }

  private connect() {
    const ws = new WebSocket(serverUrl());
    this.ws = ws;
    this.ready = false;
    ws.addEventListener('message', (e) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return; // ignore malformed frames
      }
      this.receive(m);
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws || this.closed) return;
      this.ws = null;
      this.ready = false;
      this.retry();
    });
  }

  private receive(m: ServerMsg) {
    if (m.t === 'welcome') {
      this.fresh = { id: m.you, key: m.key };
      this.connectedOnce = true;
      this.failures = 0;
      if (this.me && this.inRoom) this.ws?.send(JSON.stringify({ t: 'resume', id: this.me.id, key: this.me.key } satisfies ClientMsg));
      else this.adopt();
      return;
    }
    if (m.t === 'resumed') {
      this.markReady();
      this.onStatus('online');
      return;
    }
    if (m.t === 'error' && m.code === 'resume') {
      // The seat is gone; carry on as the new connection's player.
      this.inRoom = false;
      this.adopt();
    }
    this.onMessage(m);
  }

  private adopt() {
    const me = this.fresh!;
    this.me = me;
    this.markReady();
    this.onMessage({ t: 'welcome', you: me.id, key: me.key });
    this.onStatus('online');
  }

  private markReady() {
    this.ready = true;
    for (const m of this.queue) this.ws?.send(JSON.stringify(m));
    this.queue = [];
  }

  private retry() {
    this.failures++;
    // A server that never answered is probably not there: give up sooner.
    if (this.failures > (this.connectedOnce ? MAX_RETRIES : 2)) {
      this.onStatus('offline');
      return;
    }
    this.onStatus('reconnecting');
    this.retryTimer = window.setTimeout(() => this.connect(), Math.min(8000, 500 * 2 ** (this.failures - 1)));
  }

  send(m: ClientMsg) {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else if (this.queue.length < 20) this.queue.push(m);
  }

  close() {
    this.closed = true;
    window.clearTimeout(this.retryTimer);
    // Leaving on purpose: give the seat up now instead of after the reconnect grace period.
    if (this.inRoom && this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'leave' } satisfies ClientMsg));
    this.ws?.close();
  }
}
