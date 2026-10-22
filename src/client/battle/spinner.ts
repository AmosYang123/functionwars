import { POWER_IDS, POWERS, type PowerId } from '../../engine/powers.ts';
import { sfx } from '../audio.ts';
import { h, reducedMotion } from '../dom.ts';
import { icon, iconPaths } from '../icons.ts';

export interface SpinEntry {
  id: string;
  name: string;
  color: string;
  power: PowerId;
}

const SPIN_MS = 2600;
const SEG = 360 / POWER_IDS.length;

/** The wheel: one slice per power-up, with its icon. Static markup built from constants only. */
function wheel(): SVGSVGElement {
  const r = 92;
  const slices = POWER_IDS.map((id, i) => {
    const a0 = ((i * SEG - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * SEG - 90) * Math.PI) / 180;
    const mid = (((i + 0.5) * SEG - 90) * Math.PI) / 180;
    const p = (a: number, rr: number) => `${(100 + Math.cos(a) * rr).toFixed(2)} ${(100 + Math.sin(a) * rr).toFixed(2)}`;
    const ix = 100 + Math.cos(mid) * 58 - 12;
    const iy = 100 + Math.sin(mid) * 58 - 12;
    return `<path d="M100 100 L${p(a0, r)} A${r} ${r} 0 0 1 ${p(a1, r)} Z" fill="${POWERS[id].color}" stroke="#1e2235" stroke-width="3"/>
      <g transform="translate(${ix.toFixed(2)} ${iy.toFixed(2)})" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${iconPaths(id)}</g>`;
  }).join('');
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="spin-wheel" viewBox="0 0 200 200" width="170" height="170" aria-hidden="true">${slices}<circle cx="100" cy="100" r="14" fill="#fff" stroke="#1e2235" stroke-width="3"/></svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}

/**
 * A floating card that spins the wheel, lands on the featured player's
 * power-up (yours online), then lists what everyone got. Online it never blocks
 * the board and `done` resolves when the wheel stops. On a shared screen
 * (no featured player) it waits for "Let's go" so it can't cover the hand-off.
 */
export function spinCard(entries: SpinEntry[], featuredId: string | null): { el: HTMLElement; done: Promise<void> } {
  const featured = entries.find((e) => e.id === featuredId) ?? null;
  const land = featured?.power ?? entries[Math.floor(Math.random() * entries.length)].power;
  const svg = wheel();
  const result = h('div', { class: 'spin-result', 'aria-live': 'polite' });
  let onClosed = () => {};
  const closed = new Promise<void>((r) => (onClosed = r));
  const close = () => {
    window.clearTimeout(auto);
    el.remove();
    onClosed();
  };
  const el = h('section', { class: 'spin-card', 'aria-label': 'Power-up spin' },
    h('div', { class: 'spin-head' },
      h('h2', null, 'Power-up spin!'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, icon('close', 16)),
    ),
    h('div', { class: 'spin-stage' }, h('span', { class: 'spin-pointer', 'aria-hidden': 'true' }), svg),
    result,
  );
  let auto = 0;
  const quick = reducedMotion();
  const target = 360 * 5 - (POWER_IDS.indexOf(land) * SEG + SEG / 2);
  svg.style.transition = quick ? 'none' : `transform ${SPIN_MS}ms cubic-bezier(0.15, 0.7, 0.2, 1)`;
  requestAnimationFrame(() => requestAnimationFrame(() => (svg.style.transform = `rotate(${target}deg)`)));
  if (!quick) [0, 120, 260, 420, 620, 880, 1200, 1600, 2100].forEach((ms) => window.setTimeout(sfx.tick, ms));

  const stopped = new Promise<void>((resolve) => {
    window.setTimeout(() => {
      sfx.lock();
      const list = h('ul', { class: 'spin-list' }, ...entries.map((e) =>
        h('li', { class: e.id === featuredId ? 'is-you' : '' },
          h('span', { class: 'dot', style: `--c: ${e.color}` }),
          h('span', { class: 'spin-name' }, e.id === featuredId ? 'You' : e.name),
          h('span', { class: 'spin-power', style: `--pw: ${POWERS[e.power].color}` }, icon(e.power, 14), POWERS[e.power].name),
        )));
      result.replaceChildren(
        featured ? h('p', { class: 'spin-mine' }, h('strong', null, POWERS[featured.power].name), ` ${POWERS[featured.power].text} Switch it on next to Lock in.`) : h('p', { class: 'spin-mine' }, 'Each player can use theirs once, on their turn. New spin every 2 rounds.'),
        list,
        featured ? '' : h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => close() }, "Let's go"),
      );
      if (featured) auto = window.setTimeout(close, 7000);
      else result.querySelector<HTMLButtonElement>('.btn')?.focus();
      resolve();
    }, quick ? 200 : SPIN_MS + 150);
  });
  return { el, done: featured ? stopped : closed };
}
