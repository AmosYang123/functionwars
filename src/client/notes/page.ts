import { h } from '../dom.ts';
import { mountNotes } from './panel.ts';

/** The Notes page. The same notes open from the Notes button in any game. */
export function mountNotesPage(root: HTMLElement): () => void {
  const host = h('div', { class: 'notes-host' });
  const el = h('div', { class: 'notes-page' },
    h('h1', null, 'Notes'),
    h('p', { class: 'lede' }, 'A cheat sheet for every kind of function, plus your own notes. Open them beside the board with the Notes button while you play. Saved on this device.'),
    host,
  );
  root.append(el);
  const unmount = mountNotes(host, false);
  return () => {
    unmount();
    el.remove();
  };
}
