import { isMuted, setMuted } from './audio.ts';
import { h, store } from './dom.ts';
import { icon, type IconName } from './icons.ts';

export type Section = 'play' | 'practice' | 'learn' | 'notes' | 'locker';

function mark(): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML =
    '<svg class="mark" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"><rect x="1.5" y="1.5" width="33" height="33" rx="10" fill="#ffcf33" stroke="#1e2235" stroke-width="3"/><path d="M8 26c5 0 7-16 12-16s5 9 9 9" fill="none" stroke="#1e2235" stroke-width="3.2" stroke-linecap="round"/><circle cx="8" cy="26" r="3.4" fill="#f0483e" stroke="#1e2235" stroke-width="2"/><circle cx="29" cy="19" r="3.4" fill="#2f7cf6" stroke="#1e2235" stroke-width="2"/></svg>';
  return tpl.content.firstElementChild as SVGSVGElement;
}

/** App frame: navigation rail (bottom tabs on phones) and the page area screens mount into. */
export function mountShell(root: HTMLElement) {
  const links = new Map<Section, HTMLAnchorElement>();
  const link = (section: Section, href: string, name: IconName, label: string, color: string) => {
    const a = h('a', { class: 'rail-link', href }, h('span', { class: 'tile', style: `--t: ${color}` }, icon(name, 18)), h('span', { class: 'rail-label' }, label));
    links.set(section, a);
    return a;
  };
  const sound = h('button', { type: 'button', class: 'rail-link rail-small', onclick: () => {
    setMuted(!isMuted());
    paintSound();
  } });
  const paintSound = () => sound.replaceChildren(icon(isMuted() ? 'mute' : 'sound', 18), h('span', null, isMuted() ? 'Sound off' : 'Sound on'));
  paintSound();
  const guides = h('button', { type: 'button', class: 'rail-link rail-small', onclick: () => {
    ['practice', 'battle'].forEach((k) => store.set(`ff-coach-${k}`, '0'));
    guides.lastElementChild!.textContent = 'Guides will show again';
  } }, icon('bulb', 18), h('span', null, 'Show guides again'));

  const page = h('main', { class: 'page', id: 'page' });
  const rail = h('nav', { class: 'rail', 'aria-label': 'Main' },
    h('a', { class: 'brand', href: '#/' }, mark(), h('span', null, 'Function War')),
    h('div', { class: 'rail-links' }, link('play', '#/', 'play', 'Play', '#22b35e'), link('practice', '#/practice', 'target', 'Practice', '#ff8a1f'), link('learn', '#/learn', 'book', 'Learn', '#8b5cf6'), link('notes', '#/notes', 'notes', 'Notes', '#0d9488'), link('locker', '#/locker', 'shirt', 'Locker', '#ff4f9a')),
    h('div', { class: 'rail-foot' }, sound, guides),
  );
  root.replaceChildren(h('a', { class: 'skip', href: '#page' }, 'Skip to content'), rail, page);

  return {
    page,
    setActive(section: Section) {
      for (const [s, a] of links) {
        if (s === section) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
    },
  };
}
