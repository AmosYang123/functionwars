# Deploying

Function War has two parts:

1. **The site** (everything in `dist/` after `npm run build`): static files. Vercel hosts this.
2. **The game server** (`server/`): a long-running Node process holding WebSocket connections for online rooms. Vercel Functions can't keep WebSockets open, so this part runs on a host that can (Render, Railway, Fly.io, any VPS).

Hot-seat play, Practice, Learn, Notes and the Locker work on Vercel alone. Only "Play online" needs the game server.

## 1. Game server (Render example)

`render.yaml` describes the service. In Render: **New → Blueprint**, pick this repo, then set:

- `ALLOWED_ORIGINS` = your Vercel URL, e.g. `https://function-war.vercel.app` (comma-separate several; include custom domains). The server rejects WebSocket connections from any other origin.

Or by hand on any Node 20.19+ host:

```sh
npm ci
NODE_ENV=production ALLOWED_ORIGINS=https://function-war.vercel.app PORT=3000 npm start
```

Health check: `GET /health` returns `ok`. Note the WebSocket URL: `wss://<your-server-host>/ws`.

Free tiers that sleep when idle will make the first online connection slow.

## 2. Site on Vercel

1. Import the repo in Vercel. `vercel.json` sets the framework (Vite), build command and output directory, plus security headers.
2. In **Settings → Environment Variables**, add `VITE_WS_URL` = `wss://<your-server-host>/ws` for Production (and Preview if you want online play there; add those preview origins to `ALLOWED_ORIGINS` too).
3. Deploy. `VITE_WS_URL` is read at build time: redeploy after changing it.

The build bakes `VITE_WS_URL`'s origin into the page's Content-Security-Policy (`connect-src`), so the page can only open WebSockets to its own origin and that server.

Without `VITE_WS_URL`, the site still works; "Play online" shows that the game server can't be reached.

## Single host instead

`npm run build && npm start` on one Node host serves the site and `/ws` together; no `VITE_WS_URL` needed.
