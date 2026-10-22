import { createGame, defaultFacing, lockIn, PREP_MS, resolveRound, type GameState, type Player } from '../../engine/game.ts';
import { POWER_IDS, POWERS, spinsAt } from '../../engine/powers.ts';
import { COLORS, defaultLook, parseLook, randomLook, uniqueColor, type Look } from '../../net/look.ts';
import { sfx } from '../audio.ts';
import { h, store } from '../dom.ts';
import { icon } from '../icons.ts';
import { SEATS } from '../palette.ts';
import { loadLook } from '../profile.ts';
import { BattleView } from './view.ts';

interface Setup {
  names: string[];
  lives: number;
  /** Seat 0 always wears your Locker look; the others keep what they rolled. */
  looks: Look[];
}

/** Distinct colors, seat by seat, with seat 0 wearing your saved look. */
function settleLooks(looks: Look[], count: number): Look[] {
  const out: Look[] = [];
  for (let i = 0; i < count; i++) {
    const want = i === 0 ? loadLook() : (looks[i] ?? defaultLook(i));
    out.push({ ...want, color: uniqueColor(want.color, out.map((l) => l.color)) });
  }
  return out;
}

/** Unnamed players go by the color they wear. */
const colorName = (look: Look, seat: number) => COLORS.find((c) => c.id === look.color)?.name ?? SEATS[seat].name;

function loadSetup(): Setup {
  try {
    const raw = JSON.parse(store.get('ff-local') ?? 'null') as unknown;
    if (raw && typeof raw === 'object' && 'names' in raw && Array.isArray(raw.names) && 'lives' in raw && typeof raw.lives === 'number') {
      const names = raw.names.filter((n): n is string => typeof n === 'string').slice(0, 6);
      const looks = 'looks' in raw && Array.isArray(raw.looks) ? raw.looks.map((l: unknown, i: number) => parseLook(l, i)) : [];
      if (names.length >= 2) return { names, lives: raw.lives, looks: settleLooks(looks, names.length) };
    }
  } catch {
    /* fall through */
  }
  return { names: ['', ''], lives: 1, looks: settleLooks([], 2) };
}

export function howItWorks() {
  return h('ol', { class: 'how' },
    h('li', null, h('strong', null, 'Aim'), h('span', null, 'Each player gets 60 seconds to type a function. The board previews the exact path.')),
    h('li', null, h('strong', null, 'Lock in'), h('span', null, 'Shots fire in the order players lock in, so committing early pays.')),
    h('li', null, h('strong', null, 'Power up'), h('span', null, `A spinner deals everyone a power-up on round 1 and every 2 rounds: ${POWER_IDS.map((p) => POWERS[p].name).join(', ')}.`)),
    h('li', null, h('strong', null, 'Survive'), h('span', null, 'Get hit and you are out. The last player standing wins.')),
  );
}

/** Setup for hot-seat play: names and lives, then the game. */
export function mountLocalSetup(root: HTMLElement, go: (path: string) => void): () => void {
  const setup = loadSetup();
  const list = h('ul', { class: 'seats' });
  const lives = h('div', { class: 'seg seg-text', role: 'radiogroup', 'aria-label': 'Lives per player' });
  const add = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => {
    setup.names.push('');
    setup.looks = settleLooks(setup.looks, setup.names.length);
    render();
    list.querySelector<HTMLInputElement>('li:last-child input')?.focus();
  } }, icon('plus', 16), h('span', null, 'Add player'));

  const render = () => {
    list.replaceChildren(
      ...setup.names.map((n, i) =>
        h('li', { class: 'seat' },
          h('span', { class: 'dot', style: `--c: ${setup.looks[i].color}` }),
          h('input', { type: 'text', maxlength: 16, value: n, placeholder: colorName(setup.looks[i], i), 'aria-label': `Player ${i + 1} name`, oninput: (e: Event) => (setup.names[i] = (e.target as HTMLInputElement).value) }),
          i === 0
            ? h('a', { class: 'icon-btn', href: '#/locker', 'aria-label': 'Change your look in the Locker', title: 'Your look (Locker)' }, icon('shirt', 16))
            : h('button', { type: 'button', class: 'icon-btn', 'aria-label': `New random look for player ${i + 1}`, title: 'Random look', onclick: () => {
                const taken = setup.looks.filter((_, j) => j !== i).map((l) => l.color);
                const free = SEATS.map((s) => s.color as string).filter((c) => !taken.includes(c));
                setup.looks[i] = randomLook(free[Math.floor(Math.random() * free.length)] ?? setup.looks[i].color);
                sfx.click();
                render();
              } }, icon('dice', 16)),
          setup.names.length > 2
            ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove player ${i + 1}`, onclick: () => {
                setup.names.splice(i, 1);
                setup.looks.splice(i, 1);
                setup.looks = settleLooks(setup.looks, setup.names.length);
                render();
              } }, icon('close', 16))
            : null,
        ),
      ),
    );
    lives.replaceChildren(
      ...[1, 2, 3].map((n) => h('button', { type: 'button', role: 'radio', class: 'seg-btn', 'aria-checked': String(setup.lives === n), onclick: () => {
        setup.lives = n;
        render();
      } }, n === 1 ? '1 life' : `${n} lives`)),
    );
    add.hidden = setup.names.length >= 6;
  };

  const el = h('div', { class: 'page-narrow' },
    h('h1', null, 'Play on this device'),
    h('p', { class: 'lede' }, 'Two to six players share this screen and take turns.'),
    howItWorks(),
    h('form', { class: 'form', onsubmit: (e: Event) => {
      e.preventDefault();
      store.set('ff-local', JSON.stringify(setup));
      sfx.lock();
      start();
    } },
      h('fieldset', null, h('legend', null, 'Players'), list, add),
      h('fieldset', null, h('legend', null, 'Lives each'), lives),
      h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'Start game'),
    ),
  );
  root.append(el);
  render();

  let stopGame: (() => void) | null = null;
  const start = () => {
    el.remove();
    stopGame = runLocal(root, setup, go);
  };
  return () => {
    el.remove();
    stopGame?.();
  };
}

function runLocal(root: HTMLElement, setup: Setup, go: (path: string) => void): () => void {
  let game: GameState = createGame(
    setup.names.map((n, i) => ({ id: `p${i}`, name: n.trim().slice(0, 16) || colorName(setup.looks[i], i) })),
    Math.floor(Math.random() * 2 ** 31),
    { lives: setup.lives },
  );
  let current: Player | null = null;
  let started = 0;
  let timer = 0;
  let alive = true;
  const locks: { id: string; at: number }[] = [];
  let resolveTurn: (() => void) | null = null;

  const view = new BattleView(root, {
    onLeave: () => go('#/'),
    lookOf: (p) => setup.looks[p.seat],
    onLock: (expr, facing, use) => {
      if (!current) return 'Not your turn';
      const at = performance.now() - started;
      const r = lockIn(game, current.id, expr, facing, at, use);
      if (!r.ok) return r.error;
      game = r.state;
      locks.push({ id: current.id, at });
      endTurn();
      return null;
    },
  });

  const endTurn = () => {
    window.clearInterval(timer);
    view.setActive(null);
    current = null;
    resolveTurn?.();
  };

  const order = () => locks.map((l) => ({ ...l, locked: true }));

  async function round() {
    locks.length = 0;
    view.setGame(game);
    view.setOrder([]);
    view.setTimer(null);
    if (spinsAt(game.round)) await view.spin(null);
    if (!alive) return;
    const living = game.players.filter((p) => p.alive);
    const offset = (game.round - 1) % living.length;
    const turns = [...living.slice(offset), ...living.slice(0, offset)];
    for (const p of turns) {
      if (!alive) return;
      await view.handoff(p, 'Everyone else, look away. Your 60 seconds start when you press the button.');
      if (!alive) return;
      current = p;
      view.setActive(p.id, defaultFacing(p));
      view.setOrder(order());
      // The clock waits for the first-time guide.
      await view.coach();
      started = performance.now();
      let lastSec = 60;
      view.setTimer(PREP_MS);
      await new Promise<void>((res) => {
        resolveTurn = res;
        timer = window.setInterval(() => {
          const left = PREP_MS - (performance.now() - started);
          view.setTimer(left);
          const sec = Math.ceil(left / 1000);
          if (sec !== lastSec && sec <= 10 && sec > 0) sfx.tick();
          lastSec = sec;
          if (left <= 0) endTurn();
        }, 100);
      });
      view.setOrder(order());
      view.setTimer(null);
    }
    const { state, events } = resolveRound(game);
    game = state;
    await view.play(events, game);
    if (!alive) return;
    if (game.phase === 'over') {
      const winner = game.players.find((p) => p.id === game.winnerId) ?? null;
      view.victory(winner, [
        { label: 'Play again', primary: true, onClick: () => {
          stop();
          stopFn = runLocal(root, setup, go);
        } },
        { label: 'Home', onClick: () => go('#/') },
      ]);
      return;
    }
    void round();
  }

  let stopFn: (() => void) | null = null;
  const stop = () => {
    alive = false;
    window.clearInterval(timer);
    view.destroy();
  };
  void round();
  return () => {
    stop();
    stopFn?.();
  };
}

