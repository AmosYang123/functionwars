import type { FamilyId } from '../../engine/types.ts';
import { h, store } from '../dom.ts';
import { icon } from '../icons.ts';
import { mountNotes } from './panel.ts';

/**
 * The Notes button for game screens and the side drawer it shows or hides.
 * Open/closed is remembered, so notes stay up between rounds and games.
 */
export function notesToggle(focus?: FamilyId) {
  let unmount: (() => void) | null = null;
  const body = h('div', { class: 'notes-drawer-body' });
  const panel = h('aside', { class: 'notes-drawer', 'aria-label': 'Notes', hidden: true, onkeydown: (e: Event) => {
    if ((e as KeyboardEvent).key === 'Escape') set(false);
  } },
    h('div', { class: 'drawer-head' }, h('h2', null, 'Notes'), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Hide notes', title: 'Hide notes', onclick: () => set(false) }, icon('close', 18))),
    body,
  );
  const button = h('button', { type: 'button', class: 'hud-btn', 'aria-expanded': 'false', onclick: () => set(panel.hidden !== false) }, icon('notes', 18), h('span', null, 'Notes'));

  function set(open: boolean) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('notes-open', open);
    store.set('ff-notes-open', open ? '1' : '0');
    if (open && !unmount) unmount = mountNotes(body, true, focus);
  }
  set(store.get('ff-notes-open') === '1');

  return {
    button,
    panel,
    /** Screen width the open drawer covers, so the board can fit beside it. */
    width: () => (panel.hidden ? 0 : panel.getBoundingClientRect().right),
    destroy() {
      unmount?.();
      document.body.classList.remove('notes-open');
      panel.remove();
    },
  };
}
