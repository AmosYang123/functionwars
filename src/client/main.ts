import '@fontsource-variable/fredoka';
import '@fontsource-variable/nunito';
import './style.css';
import { mountLocalSetup } from './battle/local.ts';
import { mountOnline } from './battle/online.ts';
import { mountHome } from './home.ts';
import { mountLearn } from './learn/learn.ts';
import { mountLocker } from './locker.ts';
import { mountNotesPage } from './notes/page.ts';
import { mountPractice } from './practice/practice.ts';
import { Coach } from './coach.ts';
import { mountShell, type Section } from './shell.ts';

const shell = mountShell(document.getElementById('app')!);
let cleanup: (() => void) | null = null;

const go = (path: string) => {
  if (location.hash === path) route();
  else location.hash = path;
};

function route() {
  cleanup?.();
  Coach.stopAll();
  shell.page.replaceChildren();
  const [, section, arg] = (location.hash || '#/').slice(1).split('/');
  const mounts: Record<string, [Section, () => () => void]> = {
    play: ['play', () => mountLocalSetup(shell.page, go)],
    online: ['play', () => mountOnline(shell.page, go)],
    practice: ['practice', () => mountPractice(shell.page, go)],
    learn: ['learn', () => mountLearn(shell.page, go, arg)],
    locker: ['locker', () => mountLocker(shell.page)],
    notes: ['notes', () => mountNotesPage(shell.page)],
  };
  const [active, mount] = mounts[section] ?? ['play', () => mountHome(shell.page)];
  shell.setActive(active);
  // Lessons take the whole frame, like a focused exercise.
  document.body.classList.toggle('is-focus', section === 'learn' && !!arg);
  cleanup = mount();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
