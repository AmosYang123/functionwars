import { FAMILIES, FAMILY_ORDER } from '../../engine/families.ts';
import type { FamilyId } from '../../engine/types.ts';
import { h, store } from '../dom.ts';
import { icon } from '../icons.ts';
import { FAMILY_COLOR } from '../palette.ts';
import { familyTemplate, loadNotes, MAX_BODY, MAX_NOTES, newId, saveNotes, TEMPLATES, type Note } from './store.ts';

/**
 * Notes: a list grouped into function notes and your own, plus an editor that
 * saves as you type. `compact` (the in-game drawer) shows one of the two at a time.
 */
export function mountNotes(host: HTMLElement, compact: boolean, focus?: FamilyId): () => void {
  let notes = loadNotes();
  // A lesson opens straight to its own cheat sheet.
  let currentId: string | null = (focus && notes.find((n) => n.tag === focus)?.id) || store.get('ff-notes-current');
  if (!notes.some((n) => n.id === currentId)) currentId = compact ? null : notes[0]?.id ?? null;
  let query = '';
  let saveTimer = 0;

  const listEl = h('div', { class: 'notes-list' });
  const editorEl = h('div', { class: 'notes-editor' });
  const menu = h('div', { class: 'notes-menu', hidden: true, role: 'menu' });
  const search = h('input', { type: 'search', class: 'notes-search', placeholder: 'Search notes', 'aria-label': 'Search notes', oninput: () => {
    query = search.value.trim().toLowerCase();
    renderList();
  } });
  const newBtn = h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'aria-haspopup': 'menu', onclick: () => (menu.hidden = !menu.hidden) }, icon('plus', 16), h('span', null, 'New'));
  menu.append(...TEMPLATES.map((t) => h('button', { type: 'button', role: 'menuitem', class: 'notes-menu-item', onclick: () => create(t.title, t.body) }, t.name)));
  const el = h('div', { class: `notes${compact ? ' is-compact' : ''}` },
    h('div', { class: 'notes-side' }, h('div', { class: 'notes-tools' }, search, h('div', { class: 'notes-new' }, newBtn, menu)), listEl),
    editorEl,
  );
  host.append(el);

  const persist = () => saveNotes(notes);
  const current = () => notes.find((n) => n.id === currentId) ?? null;

  function create(title: string, body: string) {
    menu.hidden = true;
    if (notes.length >= MAX_NOTES) return;
    const n: Note = { id: newId(), title, body, tag: 'mine', updated: Date.now() };
    notes = [n, ...notes];
    persist();
    open(n.id);
    editorEl.querySelector<HTMLInputElement>('.notes-title')?.select();
  }

  function open(id: string | null) {
    currentId = id;
    if (id) store.set('ff-notes-current', id);
    render();
  }

  const matches = (n: Note) => !query || n.title.toLowerCase().includes(query) || n.body.toLowerCase().includes(query);
  const preview = (n: Note) => n.body.split('\n').find((l) => l.trim()) ?? 'Empty note';

  function item(n: Note) {
    const color = n.tag === 'mine' ? '#1e2235' : FAMILY_COLOR[n.tag];
    return h('li', null,
      h('button', { type: 'button', class: `notes-item${n.id === currentId ? ' is-current' : ''}`, style: `--fam: ${color}`, 'aria-current': n.id === currentId ? 'true' : undefined, onclick: () => open(n.id) },
        h('strong', null, n.title || 'Untitled'),
        h('span', null, preview(n)),
      ),
    );
  }

  function renderList() {
    const fam = FAMILY_ORDER.map((f) => notes.find((n) => n.tag === f)).filter((n): n is Note => !!n && matches(n));
    const mine = notes.filter((n) => n.tag === 'mine' && matches(n)).sort((a, b) => b.updated - a.updated);
    const missing = FAMILY_ORDER.filter((f) => !notes.some((n) => n.tag === f));
    listEl.replaceChildren(
      h('h3', { class: 'notes-group' }, 'My notes'),
      mine.length ? h('ul', null, ...mine.map(item)) : h('p', { class: 'muted notes-empty' }, query ? 'No matches.' : 'Press New for a blank note or a template.'),
      h('h3', { class: 'notes-group' }, 'Function cheat sheets'),
      fam.length ? h('ul', null, ...fam.map(item)) : h('p', { class: 'muted notes-empty' }, 'No matches.'),
      missing.length && !query
        ? h('button', { type: 'button', class: 'text-link notes-restore', onclick: () => {
            notes = [...notes, ...missing.map((f, i) => ({ id: `fam-${f}-${Date.now()}`, title: FAMILIES[f].name, body: familyTemplate(f), tag: f, updated: i }))];
            persist();
            renderList();
          } }, `Bring back ${missing.length} deleted cheat sheet${missing.length === 1 ? '' : 's'}`)
        : '',
    );
  }

  /** Two clicks to confirm anything that throws text away. */
  function confirmBtn(label: string, confirmLabel: string, iconName: 'trash' | 'retry', act: () => void) {
    let armed = false;
    const show = (text: string) => {
      b.lastElementChild!.textContent = text;
      b.setAttribute('aria-label', text);
      b.title = text;
      b.classList.toggle('is-armed', armed);
    };
    const b: HTMLButtonElement = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': label, title: label, onclick: () => {
      if (armed) return act();
      armed = true;
      show(confirmLabel);
      window.setTimeout(() => {
        armed = false;
        if (b.isConnected) show(label);
      }, 2500);
    } }, icon(iconName, 16), h('span', null, label));
    return b;
  }

  function renderEditor() {
    const n = current();
    if (!n) {
      editorEl.replaceChildren(h('p', { class: 'muted notes-empty' }, 'Pick a note, or press New.'));
      return;
    }
    const status = h('span', { class: 'notes-status', 'aria-live': 'polite' }, 'Saved');
    const touch = () => {
      n.updated = Date.now();
      status.textContent = 'Saving…';
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        persist();
        status.textContent = 'Saved';
        renderList();
      }, 300);
    };
    const title = h('input', { type: 'text', class: 'notes-title', maxlength: 80, value: n.title, 'aria-label': 'Note title', oninput: () => {
      n.title = title.value;
      touch();
    } });
    const body = h('textarea', { class: 'notes-body', maxlength: MAX_BODY, spellcheck: 'true', 'aria-label': `${n.title || 'Note'} text`, oninput: () => {
      n.body = body.value;
      touch();
    } });
    body.value = n.body;
    const fam = n.tag !== 'mine' ? (n.tag as FamilyId) : null;
    editorEl.replaceChildren(
      h('div', { class: 'notes-bar' },
        compact ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'All notes', title: 'All notes', onclick: () => open(null) }, icon('back', 18)) : null,
        fam ? h('span', { class: 'notes-tag', style: `--fam: ${FAMILY_COLOR[fam]}` }, FAMILIES[fam].name) : h('span', { class: 'notes-tag' }, 'My note'),
        status,
        fam ? confirmBtn('Reset', 'Click to reset', 'retry', () => {
          n.body = familyTemplate(fam);
          n.updated = Date.now();
          persist();
          renderEditor();
        }) : null,
        confirmBtn('Delete', 'Click to delete', 'trash', () => {
          notes = notes.filter((q) => q !== n);
          persist();
          open(compact ? null : notes[0]?.id ?? null);
        }),
      ),
      title,
      body,
    );
  }

  function render() {
    el.classList.toggle('is-editing', !!current());
    renderList();
    renderEditor();
  }

  const onDocClick = (e: MouseEvent) => {
    if (!menu.hidden && !(e.target instanceof Node && newBtn.parentElement!.contains(e.target))) menu.hidden = true;
  };
  document.addEventListener('click', onDocClick);
  render();
  return () => {
    window.clearTimeout(saveTimer);
    persist();
    document.removeEventListener('click', onDocClick);
    el.remove();
  };
}
