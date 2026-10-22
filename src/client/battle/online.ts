import { defaultFacing, type Player } from '../../engine/game.ts';
import { spinsAt } from '../../engine/powers.ts';
import type { PublicGame, RoomPlayer, ServerMsg } from '../../net/protocol.ts';
import { sfx } from '../audio.ts';
import { h, store } from '../dom.ts';
import { icon } from '../icons.ts';
import { Net } from '../net.ts';
import { loadLook } from '../profile.ts';
import { howItWorks } from './local.ts';
import { BattleView, type OrderCell } from './view.ts';

/** Online play: create or join a room by code, then the server drives the shared battle view. */
export function mountOnline(root: HTMLElement, go: (path: string) => void): () => void {
  const net = new Net();
  let you = '';
  let room: Extract<ServerMsg, { t: 'room' }> | null = null;
  let view: BattleView | null = null;
  let chain = Promise.resolve();
  let tick = 0;
  let disposed = false;
  let lives = 1;
  const locks = new Map<string, number>();

  const nameInput = h('input', { type: 'text', maxlength: 16, placeholder: 'Your name', value: store.get('ff-name') ?? '', 'aria-label': 'Your name' });
  const codeInput = h('input', { type: 'text', maxlength: 5, placeholder: 'ABCDE', class: 'code-input', 'aria-label': 'Room code', autocapitalize: 'characters', spellcheck: 'false' });
  const errorEl = h('p', { class: 'form-error', role: 'alert' });
  const body = h('div', { class: 'stack' });
  const lobbyEl = h('div', { class: 'page-narrow' }, body, errorEl);
  root.append(lobbyEl);

  const name = () => {
    store.set('ff-name', nameInput.value.trim());
    return nameInput.value.trim();
  };

  const livesSeg = () => {
    const seg = h('div', { class: 'seg seg-text', role: 'radiogroup', 'aria-label': 'Lives per player' });
    const draw = () =>
      seg.replaceChildren(...[1, 2, 3].map((n) => h('button', { type: 'button', role: 'radio', class: 'seg-btn', 'aria-checked': String(lives === n), onclick: () => {
        lives = n;
        draw();
      } }, n === 1 ? '1 life' : `${n} lives`)));
    draw();
    return seg;
  };

  const renderJoin = () => {
    body.replaceChildren(
      h('h1', null, 'Play online'),
      h('p', { class: 'lede' }, 'Everyone aims at the same time with the same 60 seconds. Jump into a public game, or play with friends using a room code.'),
      howItWorks(),
      h('div', { class: 'form' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Your name'), nameInput),
        h('button', { type: 'button', class: 'big-btn is-primary quick-btn', onclick: () => net.send({ t: 'quick', name: name(), look: loadLook() }) },
          h('span', { class: 'big-icon' }, icon('online', 26)),
          h('span', null, h('strong', null, 'Find a public game'), h('small', null, 'Play with whoever is online. Starts when the countdown ends or 6 players join.')),
        ),
        h('p', { class: 'divider' }, h('span', null, 'or play with friends')),
        h('div', { class: 'split' },
          h('div', { class: 'stack-sm' },
            h('span', { class: 'field-label' }, 'Start a room'),
            livesSeg(),
            h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => net.send({ t: 'create', name: name(), lives, look: loadLook() }) }, 'Create room'),
          ),
          h('form', { class: 'stack-sm', onsubmit: (e: Event) => {
            e.preventDefault();
            net.send({ t: 'join', code: codeInput.value.trim().toUpperCase(), name: name(), look: loadLook() });
          } },
            h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Join with a code'), codeInput),
            h('button', { type: 'submit', class: 'btn btn-secondary btn-lg' }, 'Join room'),
          ),
        ),
      ),
    );
  };

  let countdown = 0;
  const renderPublic = (r: NonNullable<typeof room>) => {
    window.clearInterval(countdown);
    const status = h('p', { class: 'public-status', 'aria-live': 'polite' });
    const deadline = r.startsInMs !== null ? performance.now() + r.startsInMs : null;
    const paint = () => {
      if (deadline === null) {
        status.replaceChildren(h('strong', null, 'Waiting for players'), h('span', null, 'The countdown starts when someone else joins.'));
        return;
      }
      const s = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      status.replaceChildren(h('strong', null, `Starting in ${s}s`), h('span', null, `Starts right away if ${6 - r.players.length} more join.`));
    };
    paint();
    if (deadline !== null) countdown = window.setInterval(paint, 250);
    body.replaceChildren(
      h('h1', null, 'Public game'),
      h('p', { class: 'lede' }, 'You are in the waiting lobby. One hit and you are out.'),
      status,
      h('p', { class: 'field-label' }, `${r.players.length} of 6 players`),
      h('ul', { class: 'seats' }, ...r.players.map((p: RoomPlayer) =>
        h('li', { class: 'seat' }, h('span', { class: 'dot', style: `--c: ${p.look.color}` }), h('span', { class: 'seat-name' }, p.name), p.id === you ? h('span', { class: 'tag' }, 'You') : null),
      )),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => {
        window.clearInterval(countdown);
        net.send({ t: 'leave' });
        net.inRoom = false;
        room = null;
        renderJoin();
      } }, 'Leave lobby'),
    );
  };

  const renderRoom = (r: NonNullable<typeof room>) => {
    if (r.isPublic) return renderPublic(r);
    window.clearInterval(countdown);
    const isHost = r.hostId === you;
    const copy = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => {
      void navigator.clipboard?.writeText(r.code).then(() => (copy.lastElementChild!.textContent = 'Copied'), () => {});
    } }, icon('copy', 16), h('span', null, 'Copy code'));
    body.replaceChildren(
      h('h1', null, 'Waiting room'),
      h('p', { class: 'lede' }, `Share this code with your friends. ${r.lives === 1 ? 'One hit and you are out.' : `${r.lives} lives each.`}`),
      h('div', { class: 'room-code-row' }, h('p', { class: 'room-code' }, r.code), copy),
      h('ul', { class: 'seats' }, ...r.players.map((p: RoomPlayer) =>
        h('li', { class: 'seat' }, h('span', { class: 'dot', style: `--c: ${p.look.color}` }), h('span', { class: 'seat-name' }, p.name), p.id === r.hostId ? h('span', { class: 'tag' }, 'Host') : null, p.id === you ? h('span', { class: 'tag' }, 'You') : null),
      )),
      isHost
        ? h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', disabled: r.players.length < 2, onclick: () => net.send({ t: 'start' }) }, r.players.length < 2 ? 'Waiting for at least one more player' : `Start game with ${r.players.length} players`)
        : h('p', { class: 'muted' }, 'The host will start the game.'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => {
        net.send({ t: 'leave' });
        net.inRoom = false;
        room = null;
        renderJoin();
      } }, 'Leave room'),
    );
  };
  renderJoin();

  const ensureView = () => {
    if (view) return view;
    window.clearInterval(countdown);
    lobbyEl.hidden = true;
    view = new BattleView(root, {
      onLeave: () => go('#/'),
      lookOf: (p) => room?.players.find((q) => q.id === p.id)?.look,
      onLock: (expr, facing, use) => {
        net.send({ t: 'lock', expr, facing, ...use });
        return null;
      },
    });
    return view;
  };

  const closeView = () => {
    window.clearInterval(tick);
    view?.destroy();
    view = null;
    lobbyEl.hidden = false;
  };

  const me = (g: PublicGame): Player | undefined => g.players.find((p) => p.id === you);

  async function handle(m: ServerMsg) {
    if (disposed) return;
    switch (m.t) {
      case 'welcome':
        you = m.you;
        return;
      case 'error':
        sfx.error();
        if (m.code === 'resume') {
          // Reconnected too late: the seat was given up.
          window.clearInterval(tick);
          closeView();
          room = null;
          renderJoin();
          errorEl.textContent = 'You were disconnected, and that game is no longer available. Join a new one below.';
          return;
        }
        if (view) view.bar.showError(m.msg);
        else errorEl.textContent = m.msg;
        return;
      case 'room':
        errorEl.textContent = '';
        room = m;
        net.inRoom = true;
        // During a match the board owns the screen; the game-over dialog leads back here.
        if (!view) renderRoom(m);
        return;
      case 'round': {
        const v = ensureView();
        v.hideOverlay();
        v.setGame(m.game);
        locks.clear();
        // After a reconnect the round may already have locks, possibly yours.
        for (const l of m.locks) locks.set(l.id, l.at);
        v.setOrder(m.locks.map<OrderCell>((l) => ({ id: l.id, locked: true, at: l.at })));
        if (spinsAt(m.game.round)) void v.spin(you);
        const p = me(m.game);
        if (p?.alive) {
          v.setActive(p.id, defaultFacing(p));
          void v.coach();
        } else {
          v.setActive(null);
          v.setWaiting('You are out. Watching the rest of the game.');
        }
        if (locks.has(you)) {
          v.setActive(null);
          v.setWaiting(`Locked in at ${(locks.get(you)! / 1000).toFixed(1)}s. Waiting for the others.`);
        }
        const deadline = performance.now() + m.prepMs;
        let lastSec = 0;
        window.clearInterval(tick);
        tick = window.setInterval(() => {
          const left = deadline - performance.now();
          v.setTimer(left);
          const sec = Math.ceil(left / 1000);
          if (sec !== lastSec && sec <= 10 && sec > 0) sfx.tick();
          lastSec = sec;
          if (left <= 0) window.clearInterval(tick);
        }, 100);
        return;
      }
      case 'locked': {
        if (!view) return;
        locks.set(m.id, m.at);
        view.setOrder([...locks].map(([id, at]) => ({ id, at, locked: true })));
        if (m.id === you) {
          view.setActive(null);
          view.setWaiting(`Locked in at ${(m.at / 1000).toFixed(1)}s. Waiting for the others.`);
        }
        return;
      }
      case 'resolve': {
        const v = ensureView();
        window.clearInterval(tick);
        v.setTimer(null);
        v.setActive(null);
        if (m.events.length) await v.play(m.events, m.game);
        else v.setGame(m.game);
        if (m.game.phase === 'over') {
          const winner = m.game.players.find((p) => p.id === m.game.winnerId) ?? null;
          const again = room?.isPublic
            ? { label: 'Find another game', primary: true, onClick: () => {
                closeView();
                net.send({ t: 'leave' });
                net.inRoom = false;
                room = null;
                net.send({ t: 'quick', name: name(), look: loadLook() });
              } }
            : { label: 'Back to waiting room', primary: true, onClick: () => {
                closeView();
                if (room) renderRoom({ ...room, inGame: false });
              } };
          v.victory(winner, [again, { label: 'Home', onClick: () => go('#/') }]);
        } else {
          v.setWaiting('Next round is starting');
        }
        return;
      }
    }
  }

  net.onMessage = (m) => {
    chain = chain.then(() => handle(m)).catch(() => {});
  };
  net.onStatus = (status) => {
    if (disposed) return;
    if (status === 'reconnecting') {
      if (view) view.banner('Reconnecting…', 'Your seat is saved for 20 seconds', undefined, 6000);
      else errorEl.textContent = 'Reconnecting to the game server…';
      return;
    }
    if (status === 'online') {
      if (errorEl.textContent?.startsWith('Reconnecting')) errorEl.textContent = '';
      return;
    }
    const msg = "Can't reach the game server, so online play isn't available right now. Play on this device instead, or try again later.";
    if (view) {
      view.showOverlay(h('div', { class: 'dialog' }, h('h2', null, 'Disconnected'), h('p', null, msg), h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => go('#/') }, 'Home')));
    } else {
      errorEl.textContent = msg;
    }
  };

  return () => {
    disposed = true;
    window.clearInterval(tick);
    window.clearInterval(countdown);
    net.close();
    view?.destroy();
    lobbyEl.remove();
  };
}
