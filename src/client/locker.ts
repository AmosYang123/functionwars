import { PLAYER_RADIUS } from '../engine/map.ts';
import { planShot } from '../engine/shot.ts';
import { COLORS, FACES, HATS, randomLook, SHOTS, type Look } from '../net/look.ts';
import { drawActor, type Cam } from './arena/draw.ts';
import { drawHead, drawTrail } from './arena/skins.ts';
import { ArenaView } from './arena/view.ts';
import { sfx } from './audio.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { DUMMY_COLOR } from './palette.ts';
import { loadLook, loadName, saveLook, saveName } from './profile.ts';

const BOUNDS = { minX: -4, maxX: 30, minY: -8, maxY: 12 };
const TARGET = { x: 24, y: 2 };
const DEMO = '-0.03x^2 + 0.8x';

function canvas(w: number, hgt: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = h('canvas', { width: w * 2, height: hgt * 2, style: `width: ${w}px; height: ${hgt}px`, 'aria-hidden': 'true' });
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);
  return [c, ctx];
}

/** A small portrait of a look, for the face and hat tiles. */
function portrait(look: Look): HTMLCanvasElement {
  const [c, ctx] = canvas(72, 72);
  const s = 18 / PLAYER_RADIUS;
  const cam: Cam = { s, ox: 36, oy: 46 };
  drawActor(ctx, cam, { id: 'p', kind: 'player', x: 0, y: 0, r: PLAYER_RADIUS, color: look.color, name: '', alive: true, facing: 1, look }, 'idle', 0.5, false, 0);
  return c;
}

/** A short arc drawn in a shot style, for the shot tiles. */
function shotSample(look: Look): HTMLCanvasElement {
  const [c, ctx] = canvas(96, 56);
  const cam: Cam = { s: 1, ox: 6, oy: 46 };
  const pts: number[] = [];
  for (let x = 0; x <= 70; x += 2) pts.push(x, -0.0085 * x * (x - 95));
  drawTrail(ctx, cam, pts, pts.length, look.color, look.shot, 1);
  const n = pts.length;
  const angle = Math.atan2(-(pts[n - 1] - pts[n - 3]), pts[n - 2] - pts[n - 4]);
  drawHead(ctx, cam.ox + pts[n - 2], cam.oy - pts[n - 1], angle, look.color, look.shot, 0.3);
  return c;
}

/** Locker: free cosmetics. Your look is used in Practice, Learn, as player 1 here, and online. */
export function mountLocker(root: HTMLElement): () => void {
  let look = loadLook();
  let stopped = false;

  const nameInput = h('input', { type: 'text', maxlength: 16, value: loadName(), placeholder: 'Your name', 'aria-label': 'Your name', oninput: () => saveName(nameInput.value) });
  const colors = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Color' });
  const faces = h('div', { class: 'tiles', role: 'radiogroup', 'aria-label': 'Face' });
  const hats = h('div', { class: 'tiles', role: 'radiogroup', 'aria-label': 'Hat' });
  const shots = h('div', { class: 'tiles tiles-wide', role: 'radiogroup', 'aria-label': 'Shot style' });
  const board = h('div', { class: 'board locker-board' });
  const caption = h('p', { class: 'board-caption' });

  const set = (patch: Partial<Look>) => {
    look = { ...look, ...patch };
    saveLook(look);
    sfx.click();
    render();
  };

  const tile = (pressed: boolean, label: string, art: HTMLElement, onclick: () => void) =>
    h('button', { type: 'button', role: 'radio', class: 'tile-btn', 'aria-checked': String(pressed), title: label, onclick }, art, h('span', null, label));

  function render() {
    colors.replaceChildren(...COLORS.map((c) =>
      h('button', { type: 'button', role: 'radio', class: 'swatch', style: `--c: ${c.id}`, 'aria-checked': String(look.color === c.id), 'aria-label': c.name, title: c.name, onclick: () => set({ color: c.id }) })));
    faces.replaceChildren(...FACES.map((f) => tile(look.face === f.id, f.name, portrait({ ...look, face: f.id, hat: 'none' }), () => set({ face: f.id }))));
    hats.replaceChildren(...HATS.map((t) => tile(look.hat === t.id, t.name, portrait({ ...look, hat: t.id }), () => set({ hat: t.id }))));
    shots.replaceChildren(...SHOTS.map((s) => tile(look.shot === s.id, s.name, shotSample({ ...look, shot: s.id }), () => set({ shot: s.id }))));
    view.actors = [
      { id: 'you', kind: 'player', x: 0, y: 0, r: PLAYER_RADIUS, color: look.color, name: 'You', alive: true, facing: 1, active: true, look },
      { id: 't', kind: 'dummy', x: TARGET.x, y: TARGET.y, r: 0.9, color: DUMMY_COLOR, name: 'Target', alive: true },
    ];
    caption.replaceChildren(h('span', { class: 'dot', style: `--c: ${look.color}` }), h('strong', null, SHOTS.find((s) => s.id === look.shot)!.name), h('span', { class: 'math' }, `y = ${DEMO}`));
  }

  const section = (title: string, body: HTMLElement) => h('section', { class: 'locker-section' }, h('h2', null, title), body);
  const el = h('div', { class: 'locker' },
    h('div', { class: 'locker-head' },
      h('h1', null, 'Locker'),
      h('p', { class: 'lede' }, 'Everything here is free. Pick a look that is you: it shows up online, in Practice and Learn, and as player 1 on this device.'),
    ),
    h('div', { class: 'locker-figure' }, board, caption,
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => set(randomLook(COLORS[Math.floor(Math.random() * COLORS.length)].id)) }, icon('dice', 16), h('span', null, 'Surprise me')),
    ),
    h('div', { class: 'locker-options' },
      section('Name', h('label', { class: 'field' }, nameInput)),
      section('Color', colors),
      section('Face', faces),
      section('Hat', hats),
      section('Shot style', shots),
    ),
  );
  root.append(el);
  const view = new ArenaView(board, BOUNDS, { controls: false, readout: false, label: 'Preview of your look firing a shot' });
  render();

  // Fire the demo shot on a loop so the shot style is visible in motion.
  void (async () => {
    while (!stopped) {
      const shot = planShot({ bounds: BOUNDS, obstacles: [], actors: [{ id: 'you', x: 0, y: 0, r: PLAYER_RADIUS }, { id: 't', ...TARGET, r: 0.9 }] }, 'you', DEMO, 1);
      if (!shot.ok) return;
      view.setMood('you', 'aim', 2000);
      await view.fire(shot.trace.pts, look.color, 'you', look.shot);
      if (stopped) return;
      view.burst(TARGET.x, TARGET.y, DUMMY_COLOR, 18);
      view.pow(TARGET.x, TARGET.y + 1.5, 'POW!', '#ffcf33');
      view.wobbleActor('t');
      view.setMood('you', 'happy', 1200);
      await new Promise((r) => setTimeout(r, 1400));
    }
  })();

  return () => {
    stopped = true;
    view.destroy();
    el.remove();
  };
}
