import { compile } from '../engine/expr.ts';
import type { Facing, Family } from '../engine/types.ts';
import { h } from './dom.ts';
import { icon, type IconName } from './icons.ts';

export interface ExprBarOptions {
  placeholder?: string;
  submit: { label: string; icon?: IconName };
  /** Show the left/right fire-direction toggle. */
  direction?: boolean;
  onInput: (expr: string, parsed: { ok: true; family: Family } | { ok: false; error: string }) => void;
  onSubmit: () => void;
  onDirection?: (f: Facing) => void;
}

const KEYS: [string, string][] = [
  ['x', 'x'], ['x²', '^2'], ['^', '^'], ['(', '('], [')', ')'], ['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan('], ['ln', 'ln('], ['√', 'sqrt('], ['| |', '|'], ['eˣ', 'e^('], ['π', 'π'],
];

/**
 * The one control in play: a Desmos-style "y =" field docked at the bottom.
 * The function family is detected, never asked for; errors show inline once typing pauses.
 */
export class ExprBar {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  private note: HTMLElement;
  private button: HTMLButtonElement;
  private dirButtons: HTMLButtonElement[] = [];
  private keypad: HTMLElement;
  private errTimer = 0;
  private facing: Facing = 1;
  private error: string | null = null;

  constructor(private opts: ExprBarOptions) {
    this.input = h('input', {
      class: 'expr-input',
      type: 'text',
      inputmode: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
      maxlength: 120,
      placeholder: opts.placeholder ?? 'type a function of x',
      'aria-label': 'Function, y equals',
      oninput: () => this.changed(),
      onkeydown: (e: Event) => {
        if ((e as KeyboardEvent).key === 'Enter' && !this.button.disabled) this.opts.onSubmit();
      },
    });
    this.note = h('p', { class: 'expr-note', 'aria-live': 'polite' });
    this.button = h('button', { type: 'button', class: 'btn btn-primary btn-lg expr-submit', onclick: () => this.opts.onSubmit() }, opts.submit.icon ? icon(opts.submit.icon) : null, h('span', null, opts.submit.label));
    this.keypad = h('div', { class: 'keypad', hidden: true });
    for (const [label, ins] of KEYS) this.keypad.append(h('button', { type: 'button', class: 'pad-key', onclick: () => this.insert(ins) }, label));

    let dir: HTMLElement | null = null;
    if (opts.direction) {
      const mk = (f: Facing, name: IconName, label: string) => {
        const b = h('button', { type: 'button', class: 'seg-btn', 'aria-label': label, title: label, 'aria-pressed': String(f === this.facing), onclick: () => {
          this.setFacing(f);
          this.opts.onDirection?.(f);
        } }, icon(name, 16));
        this.dirButtons.push(b);
        return b;
      };
      dir = h('div', { class: 'seg', role: 'group', 'aria-label': 'Fire direction' }, mk(-1, 'left', 'Fire left'), mk(1, 'right', 'Fire right'));
    }

    this.el = h(
      'div',
      { class: 'expr-bar' },
      this.keypad,
      h(
        'div',
        { class: 'expr-row' },
        dir,
        h('label', { class: 'expr-field' }, h('span', { class: 'expr-y' }, 'y ='), this.input,
          h('button', { type: 'button', class: 'icon-btn keypad-toggle', 'aria-label': 'Math keys', title: 'Math keys', onclick: () => {
            this.keypad.hidden = !this.keypad.hidden;
          } }, icon('keypad'))),
        this.button,
      ),
      this.note,
    );
  }

  get value() {
    return this.input.value;
  }

  set value(v: string) {
    this.input.value = v;
    this.changed(true);
  }

  get direction(): Facing {
    return this.facing;
  }

  setFacing(f: Facing) {
    this.facing = f;
    this.dirButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0 ? -1 : 1) === f)));
  }

  /** Extra control before the submit button (the power-up toggle). */
  addExtra(el: HTMLElement) {
    this.button.before(el);
  }

  setColor(color: string) {
    this.el.style.setProperty('--player', color);
  }

  setSubmit(label: string, enabled: boolean) {
    this.button.querySelector('span')!.textContent = label;
    this.button.disabled = !enabled;
  }

  setDisabled(d: boolean) {
    this.el.classList.toggle('is-disabled', d);
    this.input.disabled = d;
    this.button.disabled = d;
    this.dirButtons.forEach((b) => (b.disabled = d));
  }

  /** Small line under the field: where the preview lands, or a problem the caller found. */
  setNote(text: string, tone: 'muted' | 'error' | 'good' = 'muted') {
    if (this.error && tone !== 'error') return;
    this.note.replaceChildren(tone === 'error' ? icon('alert', 14) : '', text);
    this.note.dataset.tone = tone;
  }

  focus() {
    this.input.focus();
  }

  private insert(text: string) {
    const el = this.input;
    const a = el.selectionStart ?? el.value.length;
    const b = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, a) + text + el.value.slice(b);
    el.setSelectionRange(a + text.length, a + text.length);
    el.focus();
    this.changed();
  }

  private changed(immediate = false) {
    const expr = this.input.value;
    window.clearTimeout(this.errTimer);
    this.error = null;
    if (!expr.trim()) {
      this.setNote('');
      this.opts.onInput(expr, { ok: false, error: '' });
      return;
    }
    const c = compile(expr);
    if (c.ok) {
      this.opts.onInput(expr, { ok: true, family: c.family });
      return;
    }
    // Don't shout while someone is mid-word; show the problem once they pause.
    this.setNote('');
    this.opts.onInput(expr, { ok: false, error: c.error });
    const show = () => {
      this.error = c.error;
      this.note.replaceChildren(icon('alert', 14), c.error);
      this.note.dataset.tone = 'error';
    };
    if (immediate) show();
    else this.errTimer = window.setTimeout(show, 700);
  }

  /** Report an error found by the caller (e.g. undefined at your position). */
  showError(msg: string) {
    this.error = msg;
    this.note.replaceChildren(icon('alert', 14), msg);
    this.note.dataset.tone = 'error';
  }
}
