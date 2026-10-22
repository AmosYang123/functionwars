# Design

World: **toy box on graph paper.** Structure stays simple (chess.com shell, Khan-style one-step-at-a-time learning, Desmos-style input bar). The style is playful for about a 5th-grade audience: outlined pieces you want to press, bright colors, cartoon characters, comic hit effects, without kindergarten extras (no floating stickers, little bounce).

## Signature moves

- **Ink outline + lip.** Interactive pieces and cards carry a 2px `--ink` outline and a solid bottom edge (`0 3px 0` buttons, `0 4px 0` cards). Pressing a button pushes it down onto its lip.
- **Games are full screen.** In battle and practice the board is the whole window and the sidebar is hidden; the top bar (leave, turn and clock, player chips, Shots log button), the input bar, and practice's collapsible challenge card float over it. The default view fits the arena into the space those leave open.
- **Pressable keys.** Buttons lift 1px on hover and sink 4px on press with a spring curve.
- **Comic impact.** Hits pop a starburst sticker ("POW!", "K.O.!", "BONK!", "SMASH!"). Confetti only for big moments: a finished challenge, the last lesson step, a won match.
- **Aiming dots.** The preview path is slingshot-style dots; fired shots are thick lines with an ink outline.

## Color

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#dff0ff` | sky background |
| `--surface` / `--sunk` | `#ffffff` / `#eef4fb` | cards, board / hover, field wells |
| `--ink` | `#1e2235` | outlines, lips, headings, text |
| `--ink-2` / `--ink-3` | `#464c63` / `#636a84` | body / secondary text |
| `--go` | `#12924a` | primary action (white text) |
| `--blue` | `#2563eb` | second big action, focus |
| `--yellow` / `--yellow-soft` | `#ffcf33` / `#fff3c4` | current item, clock, guide card, selections |
| `--pink` | `#ff4f9a` | link underline, lives |
| `--good` / `--bad` (+ `-soft`) | `#12924a` / `#d92d20` | results |

Players: Red `#f0483e`, Blue `#2f7cf6`, Green `#22b35e`, Purple `#8b5cf6`, Orange `#ff8a1f`, Pink `#ff4f9a`. Function families in Learn: linear blue, quadratic orange, sine purple, tangent pink, log green (drives `--fam`: slider fill, task tint, lesson badge).

## Type

Nunito Variable everywhere (500 body, 700–800 headings, buttons, numbers, the equation input). Fredoka Variable only for the logo title and comic hit stickers. Home title: "Function" in ink over "War!" in yellow with an ink stroke.

## Board

An endless plane like a digital grapher: pan anywhere, zoom in and out without limit (wheel, buttons, pinch). Grid spacing steps through 1, 2, 5 × 10ⁿ so major lines stay about 110px apart, and axis numbers pin to the screen edge when an axis scrolls away. The play area (200 × 120 in battle) is white with a dashed edge; outside it the grid continues on `#eef3f9`. Scale: players are small (radius 1.6, about 1/60 of the map width), obstacles are few (8–12) and large (15–40 units across) with wide lanes, and players start at least 40 units apart. A shot crosses the map in about 1.3s and never takes more than 3.5s. Obstacles are toy materials with top-lit shading and ink outlines: brick walls, stone boulders, teal gem triangles, gold stars, riveted gray metal for unbreakables. A missile cuts a round crater out of a breakable obstacle where it lands (drawn on a layer: scorched ink rim, then the hole cut out), with a debris burst, an orange shockwave ring and a "BOOM!" sticker. Players: glossy discs with ink outline, big outlined eyes, light blush, moods, a yellow bouncing marker over whoever is aiming. Targets: red and white bullseyes. Hover an obstacle to see whether missiles can blast it.

## Components

Rail with colored icon tiles (Play green, Practice orange, Learn purple), current item in a yellow chip. Big home buttons with icon tiles. Segmented controls with a yellow selected key. Practice progress as pill dots, lessons with chunky Duolingo-style segment bars, a yellow guide card with a dashed ring around the real control.

## Motion

Springs (`cubic-bezier(0.34, 1.56, 0.64, 1)`) for presses, pop-ins and toasts; only the aiming player hops; the low clock wiggles. `prefers-reduced-motion` removes loops, shake and most particles.
