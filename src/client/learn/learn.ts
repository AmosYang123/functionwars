import { compile } from '../../engine/expr.ts';
import { explainShot } from '../../engine/feedback.ts';
import { buildExpr, defaultParams, FAMILIES, FAMILY_LABEL, fmt } from '../../engine/families.ts';
import { PLAYER_RADIUS } from '../../engine/map.ts';
import { planShot } from '../../engine/shot.ts';
import type { Actor, Arena, Obstacle } from '../../engine/types.ts';
import { ArenaView, type CurveView } from '../arena/view.ts';
import { sfx } from '../audio.ts';
import { clear, h, store } from '../dom.ts';
import { ExprBar } from '../exprbar.ts';
import { icon } from '../icons.ts';
import { DUMMY_COLOR, FAMILY_COLOR } from '../palette.ts';
import { notesToggle } from '../notes/drawer.ts';
import { loadLook } from '../profile.ts';
import { recordFamily } from '../practice/practice.ts';
import { LESSON_BOUNDS, LESSONS, type Lesson, type LessonStep } from './lessons.ts';


/** Paragraph with `math` spans, built from text nodes only. */
function para(text: string): HTMLParagraphElement {
  const p = h('p');
  text.split('`').forEach((part, i) => p.append(i % 2 ? h('span', { class: 'math' }, part) : part));
  return p;
}

/** The unanchored graph y = f(x), split wherever it breaks or leaves the view. */
function rawCurves(expr: string): CurveView[] {
  const c = compile(expr);
  if (!c.ok) return [];
  const out: CurveView[] = [];
  let cur: number[] = [];
  const b = LESSON_BOUNDS;
  for (let x = b.minX; x <= b.maxX; x += 0.04) {
    const y = c.fn(x);
    const prev = cur.length ? cur[cur.length - 1] : null;
    if (!Number.isFinite(y) || y < b.minY - 2 || y > b.maxY + 2 || (prev !== null && Math.abs(y - prev) > 3)) {
      if (cur.length >= 4) out.push({ pts: cur, color: '#8a919e', style: 'raw' });
      cur = [];
      continue;
    }
    cur.push(x, y);
  }
  if (cur.length >= 4) out.push({ pts: cur, color: '#8a919e', style: 'raw' });
  return out;
}

function loadProgress(): Record<string, number> {
  try {
    const v = JSON.parse(store.get('ff-learn') ?? '{}') as unknown;
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'));
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** Learn: a lesson list, or one lesson played step by step. */
export function mountLearn(root: HTMLElement, go: (p: string) => void, lessonId?: string): () => void {
  const lesson = LESSONS.find((l) => l.id === lessonId);
  return lesson ? mountLesson(root, go, lesson) : mountIndex(root);
}

function mountIndex(root: HTMLElement): () => void {
  const progress = loadProgress();
  const el = h('div', { class: 'page-narrow' },
    h('h1', null, 'Learn'),
    h('p', { class: 'lede' }, `${LESSONS.length} short lessons. Each kind of function is a new way to attack, and each lesson ends with targets to hit on your own.`),
    h('ol', { class: 'lesson-list' }, ...LESSONS.map((l, i) => {
      const doneSteps = Math.min(progress[l.id] ?? 0, l.steps.length);
      const state = doneSteps >= l.steps.length ? 'Review' : doneSteps > 0 ? 'Continue' : 'Start';
      return h('li', null,
        h('a', { class: 'lesson-row', href: `#/learn/${l.id}` },
          h('span', { class: `lesson-num${doneSteps >= l.steps.length ? ' is-done' : ''}`, style: `--fam: ${FAMILY_COLOR[l.id]}` }, doneSteps >= l.steps.length ? icon('check', 18) : String(i + 1)),
          h('span', { class: 'lesson-info' },
            h('strong', null, l.title),
            h('span', null, l.tagline),
            h('span', { class: 'meter', 'aria-label': `${doneSteps} of ${l.steps.length} steps done` }, h('span', { style: `width: ${(doneSteps / l.steps.length) * 100}%` })),
          ),
          h('span', { class: `btn ${state === 'Start' && i === LESSONS.findIndex((q) => (progress[q.id] ?? 0) < q.steps.length) ? 'btn-primary' : 'btn-secondary'}` }, state),
        ),
      );
    })),
  );
  root.append(el);
  return () => el.remove();
}

function mountLesson(root: HTMLElement, go: (p: string) => void, lesson: Lesson): () => void {
  const look = loadLook();
  const YOU = look.color;
  const notes = notesToggle(lesson.id);
  const progress = loadProgress();
  let si = Math.min(progress[lesson.id] ?? 0, lesson.steps.length - 1);
  let params = defaultParams(lesson.id);
  let stepDone = false;
  let busy = false;
  let typed = '';
  let obstacles: Obstacle[] = [];

  const bar = h('div', { class: 'lesson-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': lesson.steps.length });
  const count = h('span', { class: 'lesson-count' });
  const text = h('div', { class: 'lesson-text' });
  const boardWrap = h('div', { class: 'board lesson-board' });
  const legend = h('p', { class: 'legend' }, h('span', { class: 'legend-solid' }), 'your shot', h('span', { class: 'legend-dash' }), 'graph of y = f(x)');
  const feedback = h('div', { class: 'lesson-feedback', 'aria-live': 'polite' });
  const actions = h('div', { class: 'lesson-actions' });
  const exprBar = new ExprBar({
    placeholder: `type a ${FAMILIES[lesson.id].name.toLowerCase()} function, like ${lesson.example}`,
    submit: { label: 'Fire' },
    onInput: (v) => {
      typed = v;
      update();
    },
    onSubmit: () => void fire(),
  });
  exprBar.setColor(YOU);
  const footInner = h('div', { class: 'lesson-foot-inner' });

  const el = h('div', { class: 'lesson', style: `--fam: ${FAMILY_COLOR[lesson.id]}; --you: ${YOU}` },
    h('header', { class: 'lesson-top' },
      h('a', { class: 'icon-btn', href: '#/learn', 'aria-label': 'Close lesson', title: 'Back to lessons' }, icon('close')),
      h('span', { class: 'lesson-name' }, lesson.title),
      bar,
      count,
      notes.button,
    ),
    h('main', { class: 'lesson-main' }, text, h('div', { class: 'lesson-figure' }, boardWrap, legend)),
    h('footer', { class: 'lesson-foot' }, footInner),
    notes.panel,
  );
  root.append(el);
  const view = new ArenaView(boardWrap, LESSON_BOUNDS, { controls: false, label: 'Lesson graph. You stand at the origin facing right.' });

  const step = (): LessonStep => lesson.steps[si];
  const you: Actor = { id: 'you', x: 0, y: 0, r: PLAYER_RADIUS };
  const target = (): Actor | null => (step().scene ? { id: 't', x: step().scene!.target.x, y: step().scene!.target.y, r: 0.75 } : null);
  const arena = (): Arena => ({ bounds: LESSON_BOUNDS, obstacles, actors: [you, ...(target() ? [target()!] : [])] });
  const expr = () => (step().type ? typed : buildExpr(lesson.id, params));

  function openStep(i: number) {
    si = i;
    const s = step();
    if (s.params) params = { ...params, ...s.params };
    stepDone = !s.task && !s.fire && !s.type;
    obstacles = s.scene?.obstacles() ?? [];
    view.obstacles = obstacles;
    view.clearTrails();
    typed = '';
    clear(feedback);
    renderText();
    renderProgress();
    renderFoot();
    if (s.type) {
      exprBar.value = '';
      exprBar.focus();
    }
    update();
  }

  function renderProgress() {
    clear(bar);
    bar.setAttribute('aria-valuenow', String(si + 1));
    lesson.steps.forEach((_, i) => bar.append(h('span', { class: i < si ? 'is-done' : i === si ? 'is-current' : '' })));
    count.textContent = `${si + 1} / ${lesson.steps.length}`;
  }

  function renderText() {
    const s = step();
    const nodes: Node[] = [h('h1', null, s.title), ...s.body.map(para)];
    if (s.task) nodes.push(h('div', { class: 'task' }, h('span', { class: 'task-mark' }), h('p', null, s.task.text)));
    if (s.sliders?.length) {
      nodes.push(h('p', { class: 'equation', 'aria-live': 'polite' }));
      for (const key of s.sliders) nodes.push(slider(key));
    }
    text.replaceChildren(...nodes);
  }

  function slider(key: string): HTMLElement {
    const def = FAMILIES[lesson.id].params.find((p) => p.key === key)!;
    const value = h('output', { class: 'slider-value' }, fmt(params[key]));
    const pct = (v: number) => `${((v - def.min) / (def.max - def.min)) * 100}%`;
    const range = h('input', { type: 'range', min: def.min, max: def.max, step: def.step, value: params[key], style: `--pct: ${pct(params[key])}`, 'aria-label': `${def.name} ${def.symbol}`, oninput: (e: Event) => {
      const input = e.target as HTMLInputElement;
      params = { ...params, [key]: Number(input.value) };
      input.style.setProperty('--pct', pct(params[key]));
      value.textContent = fmt(params[key]);
      update();
    } });
    return h('div', { class: 'slider' },
      h('div', { class: 'slider-head' }, h('span', { class: 'math slider-sym' }, def.symbol), h('span', { class: 'slider-name' }, def.name), value),
      range,
      h('p', { class: 'slider-role' }, def.role),
    );
  }

  function renderFoot() {
    const s = step();
    if (s.type) footInner.replaceChildren(exprBar.el, actions);
    else footInner.replaceChildren(feedback, actions);
    renderActions();
  }

  function renderActions() {
    const s = step();
    const last = si === lesson.steps.length - 1;
    const back = si > 0 ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => openStep(si - 1) }, 'Back') : null;
    let primary: HTMLButtonElement;
    if (stepDone) {
      primary = last
        ? h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => go(nextLessonPath()) }, nextLessonLabel())
        : h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => openStep(si + 1) }, 'Continue');
    } else if (s.fire && !s.type) {
      primary = h('button', { type: 'button', class: 'btn btn-primary btn-lg', disabled: busy, onclick: () => void fire() }, 'Fire');
    } else {
      primary = h('button', { type: 'button', class: 'btn btn-primary btn-lg', disabled: true }, 'Continue');
    }
    actions.replaceChildren(...[back, s.type && !stepDone ? null : primary].filter((x): x is HTMLButtonElement => x !== null));
    if (stepDone) primary.focus({ preventScroll: true });
  }

  const nextIndex = () => LESSONS.indexOf(lesson) + 1;
  const nextLessonPath = () => (LESSONS[nextIndex()] ? `#/learn/${LESSONS[nextIndex()].id}` : '#/practice');
  const nextLessonLabel = () => (LESSONS[nextIndex()] ? `Next: ${LESSONS[nextIndex()].title}` : 'Go to Practice');

  function markDone() {
    if (stepDone) return;
    stepDone = true;
    if (si === lesson.steps.length - 1) {
      view.confetti();
      sfx.win();
    }
    progress[lesson.id] = Math.max(progress[lesson.id] ?? 0, si + 1);
    store.set('ff-learn', JSON.stringify(progress));
    renderActions();
  }

  function update() {
    const s = step();
    const t = target();
    view.frame = { x: 0, y: 0, facing: 1, color: YOU };
    view.actors = [
      { id: 'you', kind: 'player', x: 0, y: 0, r: PLAYER_RADIUS, color: YOU, name: 'You', alive: true, facing: 1, active: true, look },
      ...(t ? [{ id: 't', kind: 'dummy' as const, x: t.x, y: t.y, r: t.r, color: DUMMY_COLOR, name: 'Target', alive: true }] : []),
    ];
    const e = expr();
    const eq = text.querySelector('.equation');
    if (eq) eq.textContent = `y = ${e}`;
    const curves = e.trim() ? rawCurves(e) : [];
    const shot = e.trim() && compile(e).ok ? planShot(arena(), 'you', e, 1) : null;
    if (shot && !shot.ok && s.type) exprBar.showError(shot.error);
    if (shot?.ok) {
      if (!busy) curves.push({ pts: shot.trace.pts, color: YOU, style: 'preview', endRing: true });
      if (s.type) exprBar.setNote(shot.trace.hit?.type === 'actor' ? 'Hits the target' : 'Misses the target', shot.trace.hit?.type === 'actor' ? 'good' : 'muted');
    }
    if (s.type) exprBar.setSubmit('Fire', !!shot?.ok && !busy);
    view.curves = curves;

    const mark = text.querySelector('.task');
    if (s.task) {
      const ok = s.task.check(params);
      mark?.classList.toggle('is-done', ok);
      if (ok && !stepDone) {
        sfx.click();
        feedback.replaceChildren(h('p', { class: 'fb fb-good' }, icon('check', 18), 'That’s it.'));
        markDone();
      }
    }
  }

  async function fire() {
    if (busy) return;
    const s = step();
    const e = expr();
    const shot = planShot(arena(), 'you', e, 1);
    if (!shot.ok) return;
    busy = true;
    renderActions();
    update();
    sfx.launch();
    await view.fire(shot.trace.pts, YOU, 'you', look.shot);
    const t = target();
    const hit = shot.trace.hit;
    if (hit?.type === 'actor') {
      sfx.pop();
      view.burst(hit.x, hit.y, DUMMY_COLOR, 24);
      view.pow(hit.x, hit.y + 1, 'POW!', '#ffcf33');
      view.wobbleActor('t');
    } else if (hit?.type === 'obstacle') {
      sfx.thud();
      view.flashObstacle(hit.id);
    } else sfx.miss();
    busy = false;
    let msg: HTMLElement;
    if (t) {
      const fb = explainShot({ trace: shot.trace, fn: shot.fn, family: shot.family, shooter: you, facing: 1, target: t, arena: arena() });
      const rightKind = !s.type || shot.family === lesson.id || (lesson.id === 'linear' && shot.family === 'constant');
      if (fb.success && rightKind) {
        recordFamily(shot.family);
        msg = h('div', { class: 'fb fb-good' }, icon('check', 18), h('div', null, h('strong', null, 'Nice shot!'), h('p', null, fb.detail)));
        feedback.replaceChildren(msg);
        markDone();
      } else if (fb.success) {
        msg = h('div', { class: 'fb fb-miss' }, icon('alert', 18), h('div', null, h('strong', null, 'Hit, but try a different kind'), h('p', null, `That was ${FAMILY_LABEL[shot.family].toLowerCase()}. This lesson is about ${FAMILIES[lesson.id].name.toLowerCase()} functions.`)));
        feedback.replaceChildren(msg);
      } else {
        msg = h('div', { class: 'fb fb-miss' }, icon('alert', 18), h('div', null, h('strong', null, fb.title), h('p', null, fb.detail)));
        feedback.replaceChildren(msg);
      }
      if (s.type) exprBar.setNote('');
    }
    // Typing steps keep the bar in the footer, so feedback shows above it.
    if (s.type && feedback.childElementCount) footInner.replaceChildren(feedback, exprBar.el, actions);
    renderActions();
    update();
  }

  openStep(si);
  return () => {
    notes.destroy();
    view.destroy();
    el.remove();
  };
}
