# Deploying

## Vercel (everything, including online play)

The site is static files from `dist/`. Online play is a Vercel Function, `api/ws.js`, that holds the WebSocket connections; `vercel.json` rewrites `/ws` to it. Rooms are shared between function instances through Redis, so online play needs a Redis database connected to the project.

1. Import the repo in Vercel. `vercel.json` sets the framework (Vite), build command, output directory, the `/ws` rewrite and security headers.
2. **Connect Redis:** in the project, open **Storage → Create Database → Upstash for Redis** (free tier is enough) and connect it to the project. This adds `REDIS_URL` (and `KV_URL`) to the project's environment variables. Any Redis 6+ with a `REDIS_URL` works.
3. **Redeploy** so the function picks up the variable.

Check it: `https://<your-site>/api/ws` answers `ok`. Without Redis it answers 503 with a hint, and "Play online" says the game server can't be reached; everything else still works.

How it holds up on serverless:

- A Vercel Function closes its WebSockets when it reaches its maximum duration (300 s by default). The client reconnects on its own and takes back its seat with the resume key it got on connect, so a match carries on.
- A dropped player's seat is held for 20 seconds (`GRACE_MS` in `server/room.ts`). Leaving on purpose gives it up at once.
- Each change to a room runs under a short Redis lock and is published to every instance holding a player of that room. Round timers live in the room's data (`due`), so any instance can run them.

### Rebuilding the function

`npm run build` regenerates `api/ws.js` from `server/vercel-ws.ts`. It is committed because Vercel compiles functions with the TypeScript compiler API, which TypeScript 7 doesn't provide. Run `npm run build` and commit `api/ws.js` after changing anything under `server/` or `src/engine/`.

## One Node host instead

`npm run build && npm start` serves the site and `/ws` from a single process with rooms in memory (no Redis). Set `ALLOWED_ORIGINS` if the page is served from another origin, and build the client with `VITE_WS_URL=wss://<host>/ws` in that case.
