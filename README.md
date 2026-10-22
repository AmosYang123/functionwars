# Function War

A multiplayer battle game played on a real coordinate plane. Type a function of x; the curve becomes your projectile path, starting from your character.

## Run

```sh
npm install
npm run dev      # Vite on http://localhost:5173 + game server on :3000 (online play)
npm test         # engine, solver, powers, challenge/lesson solvability, server rooms
npm run build && npm start   # production: server serves dist/ and /ws on :3000 (also rebuilds api/ws.js)
```

Environment: `PORT` (default 3000), `ALLOWED_ORIGINS` (comma-separated WebSocket origins; defaults to same host), `NODE_ENV=production` (enables HSTS, disables localhost origin allowance). Client build: `VITE_WS_URL` (game server address when the site and the server are on different hosts). Vercel function: `REDIS_URL` (or `KV_URL`, or any variable holding a `redis://` URL; without one, rooms stay in instance memory).

Deploying to Vercel, including online play (needs a Redis database connected to the project): see [docs/deploy.md](docs/deploy.md).

## Modes

- **Play**: hot-seat (2–6 players, one screen, each gets their own 60 s), online rooms by code, or a public game: join the open public lobby and the game starts 20 s after the second player arrives, or at once when 6 have joined (simultaneous 60 s, server-authoritative).
- **Practice**: eleven graded challenges plus a random free-practice arena. **Help** fires candidate shots through the engine against the live arena and shows up to five verified hits.
- **Learn**: nine lessons (linear, quadratic, absolute value, cubic, square root, exponential, logarithmic, sine, tangent) with sliders, guided steps and challenges.
- **Notes**: a cheat sheet per function family plus your own notes (blank, battle plan, shot to remember, practice goals). Open them beside the board with the Notes button in battle, practice and lessons. Saved in the browser.
- **Locker**: free cosmetics: color, face, hat and shot style (rocket, spaghetti rocket, rainbow, comet, bubbles, stars, lightning, paper plane). Your look is sent to online rooms; the server keeps colors distinct.

## Power-ups

A seeded spinner deals every living player one power-up on round 1 and every 2 rounds after (odd rounds). A new spin replaces whatever you held. Switch it on next to Lock in; it is spent when you lock in with it.

| Power-up | Odds | Effect |
| --- | --- | --- |
| Teleport | common | Pick a spot within 18 units (9% of the arena width). You move before any shot flies, so shots aimed at your old spot miss. |
| Mirror Shot | common | Your function also fires backward. |
| First Strike | common | Your shot fires before everyone else's this round. |
| Mega Blast | uncommon | Hits anyone within 2.5× a player's radius of the path; double-size crater. |
| Drill | rare | Passes straight through the first obstacle it touches, metal included. |
| Extra Life | rare | Survive one knockout this round. Spent even if nobody hits you. |

## Rules that matter

- Shots use the shooter's local frame: x = distance in front of you, y = height relative to you. Paths are anchored: `y = f(x) − f(0)`, so vertical shifts cancel. Flip "Fire left/right" to change facing.
- Missiles blast a round crater (radius 2.5% of the arena width) exactly where they hit a breakable obstacle; the rest of it stays. Later shots fly through the hole. Gray riveted metal can't be broken.
- Functions undefined at x = 0 are rejected. A shot ends at the first collision, at the arena edge, where the function becomes undefined, or at an asymptote.
- Firing order is lock-in time (First Strike goes first). Players who don't lock in pass. A player eliminated before their turn loses their shot.
- Cheat code: type `opensesame` in the function box during a battle, then click the players you want to hit. It types in a function that hits them (checked against the real board), or the shot that blasts open the obstacle in the way. A shot stops at the first player it hits, so one function knocks out one target, or two with Mirror Shot (one on each side). It stays on for the player who typed it.
- Absolute value can be typed as `|x - 3|` or `abs(x - 3)`. Trig uses radians.

## Layout

- `src/engine/` pure TypeScript, shared by client and server: parser (`expr.ts`), anchored trajectories (`trajectory.ts`), exact segment/shape collision (`collision.ts`, `geometry.ts`), round rules (`game.ts`), power-ups (`powers.ts`), map generation, Help solver, feedback text.
- `src/net/` message types and validation for untrusted client input (`protocol.ts`), cosmetics catalog and validation (`look.ts`).
- `server/` online play. `room.ts` holds the rules for a room as plain data (lock timestamps, hit resolution, timers as `due` times, 20 s reconnect grace). Hosts: `lobby.ts` keeps rooms in memory for `npm start`; `redis-lobby.ts` shares them through Redis for Vercel (`vercel-ws.ts`, bundled to `api/ws.js`). `socket.ts` handles connections, validation and rate limits for both.
- `src/client/` canvas arena (`arena/`, cosmetics drawing in `arena/skins.ts`), editor, screens, `notes/`, `locker.ts`.

Not built yet: progression, extra hand-made maps.
