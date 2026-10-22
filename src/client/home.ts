import { ARENA_BOUNDS, generateMap, PLAYER_RADIUS } from '../engine/map.ts';
import { craterRadius } from '../engine/collision.ts';
import { suggestShots } from '../engine/solver.ts';
import type { Arena, Obstacle } from '../engine/types.ts';
import { ArenaView, type ActorView } from './arena/view.ts';
import type { Look } from '../net/look.ts';
import { h, store } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import { randomLook } from '../net/look.ts';
import { SEATS } from './palette.ts';

/** Live board on the home page: four players trading real, solver-verified shots. */
function attract(view: ArenaView, caption: HTMLElement): () => void {
  let actors: ActorView[] = [];
  let looks: Look[] = [];
  let obstacles: Obstacle[] = [];
  let shots = 0;
  let stopped = false;

  const reset = () => {
    const m = generateMap(Math.floor(Math.random() * 2 ** 31), 4);
    obstacles = m.obstacles;
    // The demo shows off cosmetics: every bot rolls a random look.
    looks = m.spawns.map((_, i) => randomLook(SEATS[i].color));
    actors = m.spawns.map((s, i) => ({ id: `a${i}`, kind: 'player', x: s.x, y: s.y, r: PLAYER_RADIUS, color: SEATS[i].color, name: SEATS[i].name, alive: true, facing: s.x <= 0 ? 1 : -1, look: looks[i] }));
    view.obstacles = obstacles;
    view.craters = [];
    view.actors = actors;
    view.clearTrails();
    shots = 0;
  };

  const loop = async () => {
    while (!stopped) {
      await new Promise((r) => setTimeout(r, 1500));
      if (stopped) return;
      if (document.hidden) continue;
      const shooter = actors[Math.floor(Math.random() * actors.length)];
      const others = actors.filter((a) => a !== shooter);
      const target = others[Math.floor(Math.random() * others.length)];
      const arena: Arena = { bounds: ARENA_BOUNDS, obstacles, craters: view.craters, actors: actors.map((a) => ({ id: a.id, x: a.x, y: a.y, r: a.r })) };
      const { shots: options, setups } = suggestShots(arena, shooter.id, target.id);
      const pool = [...options, ...setups];
      const pick = pool[Math.floor(Math.random() * Math.min(5, pool.length))];
      if (!pick) continue;
      shooter.facing = pick.facing;
      caption.replaceChildren(h('span', { class: 'dot', style: `--c: ${shooter.color}` }), h('strong', null, shooter.name), h('span', { class: 'math' }, `y = ${pick.expr}`));
      view.setMood(shooter.id, 'aim', 2500);
      await view.fire(pick.trace.pts, shooter.color, shooter.id, looks[actors.indexOf(shooter)].shot);
      if (stopped) return;
      const hit = pick.trace.hit;
      if (hit?.type === 'actor') {
        view.burst(hit.x, hit.y, actors.find((a) => a.id === hit.id)!.color, 20);
        view.pow(hit.x, hit.y + 1, 'POW!', '#ffcf33');
        view.setMood(hit.id, 'hit', 1500);
        view.setMood(shooter.id, 'happy', 1500);
        view.wobbleActor(hit.id);
      } else if (hit?.type === 'obstacle') {
        const o = obstacles.find((q) => q.id === hit.id)!;
        if (o.solid) view.flashObstacle(o.id);
        else {
          view.blast({ x: hit.x, y: hit.y, r: craterRadius(ARENA_BOUNDS) });
          view.pow(hit.x, hit.y, 'BOOM!', '#ff8a1f');
        }
      }
      if (++shots > 24) reset();
    }
  };
  reset();
  void loop();
  return () => {
    stopped = true;
  };
}

export function mountHome(root: HTMLElement): () => void {
  const board = h('div', { class: 'board home-board', 'aria-hidden': 'true' });
  const caption = h('p', { class: 'board-caption' }, 'Watching a demo game');
  const big = (href: string, name: IconName, title: string, sub: string, primary = false, extra = '') =>
    h('a', { class: `big-btn${primary ? ' is-primary' : ''} ${extra}`, href }, h('span', { class: 'big-icon' }, icon(name, 26)), h('span', null, h('strong', null, title), h('small', null, sub)));
  const learned = store.get('ff-learn') !== null;

  const el = h('div', { class: 'home' },
    h('div', { class: 'home-figure' }, board, caption),
    h('div', { class: 'home-actions' },
      h('h1', { class: 'logo-title' }, h('span', null, 'Function'), h('span', null, 'War!')),
      h('p', { class: 'lede' }, 'Type a function, aim your shot, and knock your rivals off the graph. Every kind of function is a different way to attack.'),
      big('#/play', 'play', 'Play on this device', '2 to 6 players take turns on one screen', true),
      big('#/online', 'online', 'Play online', 'Create a room or join one with a code', false, 'is-blue'),
      h('div', { class: 'home-more' },
        h('a', { class: 'text-link', href: learned ? '#/learn' : '#/learn/linear' }, learned ? 'Continue learning' : 'New here? Start with a 3-minute lesson', icon('next', 16)),
        h('a', { class: 'text-link', href: '#/practice' }, 'Practice on targets', icon('next', 16)),
      ),
    ),
  );
  root.append(el);
  const view = new ArenaView(board, ARENA_BOUNDS, { controls: false, readout: false });
  const stop = attract(view, caption);
  return () => {
    stop();
    view.destroy();
    el.remove();
  };
}
