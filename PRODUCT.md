# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + TypeScript (vanilla DOM + Canvas 2D), Vitest for tests. Node `ws` server for online play, sharing the same TypeScript math engine as the client. Chosen by the user from three offered options.

## Users

Players who may never have used a graphing calculator: students, friends at one computer, or groups online. Their job is to win a battle; learning functions is a side effect of wanting new ways to attack.

## Product Purpose

Function War is a multiplayer battle game played on a real coordinate plane. Players type functions of x; the curve becomes a projectile path that starts at the shooter. Hit opponents, break obstacles, be the last one alive. Success: a player who learns sine because a sine wave is the only way through a gap.

## Positioning

The equation is the weapon. Every family (linear, quadratic, absolute value, cubic, square root, exponential, logarithmic, sine, tangent) gives a genuinely different attack shape, and the arena is an actual graph with exact collision geometry, not a decorative backdrop.

## Operating Context

- Play: 2 to 6 players. Local hot-seat at one screen, or online rooms with a server-authoritative timer, lock-in order and hit resolution.
- Practice: target dummies, graded challenges, and a Help button that computes verified shots for a selected target.
- Learn: nine interactive lessons using the same coordinate system and controls as battle.
- Notes: per-family cheat sheets and the player's own notes, openable beside the board during play.
- Locker: free cosmetics (color, face, hat, shot style). Purely visual: a styled trail always follows the exact path.
- Power-ups: a seeded spinner deals one per player on round 1 and every 2 rounds (Teleport, Mirror Shot, First Strike, Mega Blast, Drill, Extra Life). Resolved by the shared engine, so the server stays authoritative.
- Desktop browser first, adapting to smaller screens.

## Capabilities and Constraints

- Shots are expressed in the shooter's local frame: x is distance in front of the shooter, y is height relative to them. The curve is anchored so it starts at the shooter (y = f(x) − f(0)).
- Trig uses radians everywhere.
- 60 second preparation; firing order is lock-in time; players who do not lock in pass.
- Missiles blast a crater where they hit a breakable obstacle; only that part disappears.
- Online: private rooms by code, or public matchmaking (20 s countdown from the second player, starts at once with 6).
- The Help system never shows an approximate shot unlabeled; every suggestion is simulated against the live arena before display.
- Undecided: progression, extra maps, reconnect support.

## Brand Commitments

Name: Function War. User-pinned look: light and simple in structure, playful and kid-friendly in style ("Roblox type playful vibe"): chunky outlined toy-like UI, bright candy colors, cartoon characters, comic hit effects. The first dark/neon build was rejected; the plain minimal pass was "too simple". References the user named: chess.com for game structure (board-centric pages, left navigation rail), Khan Academy for learning (one step at a time, guided, encouraging), Desmos for input (a plain function field in a bottom bar; the computer detects the function type and reports invalid input inline). In Play, never ask the player to pick a function family. Never overwhelm: show only what the current step needs.

## Evidence on Hand

None. No testimonials, user counts, or classroom claims exist; do not invent them.

## Product Principles

1. The graph is the battlefield: everything on it is real math with real geometry.
2. Teach by giving power: each new function family is a new attack, explained in battle terms.
3. Fair by construction: same prep time, ordering by lock-in, the server decides hits.
4. Never lie about a shot: previews match the fired path exactly, suggestions are verified.

## Accessibility & Inclusion

Keyboard-operable input bar and menus, visible focus, color never the only player identifier (names and face markings too), reduced-motion respected for shake and particles.
