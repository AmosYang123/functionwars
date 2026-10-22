import { h, store } from './dom.ts';
import { icon } from './icons.ts';

export interface CoachStep {
  /** Viewport rectangle to point at; null centers the card. */
  target: () => DOMRect | null;
  title: string;
  text: string;
  /** Step waits for coach.signal(name) instead of a Next button. */
  waitFor?: string;
  /** Instruction shown when the step waits for an action. */
  doThis?: string;
}

export function pointRect(host: HTMLElement, p: { x: number; y: number }, r = 22): DOMRect {
  const b = host.getBoundingClientRect();
  return new DOMRect(b.left + p.x - r, b.top + p.y - r, r * 2, r * 2);
}

/**
 * A short guided walkthrough. Points at real UI, never blocks it, can be
 * skipped, and is shown once per key (replayable from the page).
 */
export class Coach {
  private i = -1;
  private ring = h('div', { class: 'coach-ring', 'aria-hidden': 'true' });
  private card = h('div', { class: 'coach-card', role: 'dialog', 'aria-live': 'polite', 'aria-label': 'Guide' });
  private raf = 0;
  private static current: Coach | null = null;

  /** Called on navigation so a guide never outlives its screen. */
  static stopAll() {
    Coach.current?.stop();
  }

  constructor(private steps: CoachStep[], private key: string, private onEnd?: () => void) {}

  /** Run once per key; resolves when finished or skipped. */
  static runOnce(steps: CoachStep[], key: string): Promise<void> {
    if (Coach.seen(key)) return Promise.resolve();
    return new Promise((resolve) => new Coach(steps, key, resolve).start());
  }

  static seen(key: string) {
    return store.get(`ff-coach-${key}`) === '1';
  }

  get active() {
    return this.i >= 0;
  }

  get stepIndex() {
    return this.i;
  }

  start() {
    Coach.current?.stop();
    Coach.current = this;
    document.body.append(this.ring, this.card);
    this.go(0);
    const loop = () => {
      this.place();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Advance if the current step is waiting for this action. */
  signal(name: string) {
    if (this.i >= 0 && this.steps[this.i].waitFor === name) this.go(this.i + 1);
  }

  /** Ends the guide (finished or skipped) and calls onEnd either way. */
  stop() {
    if (this.i < 0) return;
    cancelAnimationFrame(this.raf);
    this.ring.remove();
    this.card.remove();
    this.i = -1;
    if (Coach.current === this) Coach.current = null;
    store.set(`ff-coach-${this.key}`, '1');
    this.onEnd?.();
  }

  private go(i: number) {
    if (i >= this.steps.length) return this.stop();
    this.i = i;
    const s = this.steps[i];
    const last = i === this.steps.length - 1;
    this.card.replaceChildren(
      h('div', { class: 'coach-top' },
        h('span', { class: 'coach-count' }, `${i + 1} of ${this.steps.length}`),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Skip guide', title: 'Skip guide', onclick: () => this.stop() }, icon('close', 16)),
      ),
      h('h3', null, s.title),
      h('p', null, s.text),
      s.waitFor
        ? h('p', { class: 'coach-do' }, icon('next', 14), s.doThis ?? 'Try it')
        : h('div', { class: 'coach-actions' },
            i > 0 ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => this.go(i - 1) }, 'Back') : h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => this.stop() }, 'Skip'),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: () => this.go(i + 1) }, last ? 'Got it' : 'Next'),
          ),
    );
    this.card.classList.remove('is-in');
    void this.card.offsetWidth;
    this.card.classList.add('is-in');
    this.place();
    this.card.querySelector<HTMLButtonElement>('.btn-primary')?.focus({ preventScroll: true });
  }

  private place() {
    if (this.i < 0) return;
    const r = this.steps[this.i].target();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = this.card.offsetWidth || 300;
    const ch = this.card.offsetHeight || 160;
    if (!r) {
      this.ring.hidden = true;
      this.card.style.left = `${(vw - cw) / 2}px`;
      this.card.style.top = `${Math.max(16, (vh - ch) / 2)}px`;
      return;
    }
    this.ring.hidden = false;
    const pad = 6;
    Object.assign(this.ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    // Prefer below, then above, then beside; clamp to the viewport.
    let top = r.bottom + 14;
    if (top + ch > vh - 12) top = r.top - ch - 14;
    let left = r.left + r.width / 2 - cw / 2;
    if (top < 12) {
      top = Math.min(Math.max(12, r.top), vh - ch - 12);
      left = r.right + 14 + cw < vw ? r.right + 14 : r.left - cw - 14;
    }
    this.card.style.left = `${Math.min(Math.max(12, left), vw - cw - 12)}px`;
    this.card.style.top = `${Math.min(Math.max(12, top), vh - ch - 12)}px`;
  }
}
