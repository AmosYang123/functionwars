import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Content-Security-Policy as a meta tag, so static hosts (Vercel) get it too.
 * connect-src allows the separate game server when VITE_WS_URL points at one.
 * frame-ancestors can't live in a meta tag; vercel.json and server/index.ts send it as a header.
 */
function csp(wsUrl: string): Plugin {
  const connect = ["'self'"];
  if (wsUrl) connect.push(new URL(wsUrl).origin);
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [csp(loadEnv(mode, process.cwd(), 'VITE_').VITE_WS_URL ?? '')],
  server: {
    proxy: { '/ws': { target: 'ws://localhost:3000', ws: true } },
  },
  test: { environment: 'node' },
}));
