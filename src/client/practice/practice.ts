import { craterRadius } from '../../engine/collision.ts';
import { compile } from '../../engine/expr.ts';
import { explainShot } from '../../engine/feedback.ts';
import { FAMILIES, FAMILY_LABEL, FAMILY_ORDER } from '../../engine/families.ts';
import { ARENA_BOUNDS, generateMap, PLAYER_RADIUS, PRACTICE_BOUNDS } from '../../engine/map.ts';
import { planShot } from '../../engine/shot.ts';
import { suggestShots, type Suggestion } from '../../engine/solver.ts';
import type { Actor, Arena, Bounds, Family, FamilyId, Obstacle } from '../../engine/types.ts';
import { ArenaView, type ActorView } from '../arena/view.ts';
import { sfx } from '../audio.ts';
import { describeEnd } from '../battle/view.ts';
import { Coach, pointRect } from '../coach.ts';
import { clear, h, store } from '../dom.ts';
import { ExprBar } from '../exprbar.ts';
import { icon } from '../icons.ts';
import { DUMMY_COLOR } from '../palette.ts';
import { notesToggle } from '../notes/drawer.ts';
import { loadLook } from '../profile.ts';
import { CHALLENGES, type Challenge, type Layout, type Requirement } from './challenges.ts';

const DUMMY_R = 0.75;

function loadSet(key: string): Set<string> {
  try {
    const v = JSON.parse(store.get(key) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
const saveSet = (key: string, s: Set<string>) => store.set(key, JSON.stringify([...s]));

/** Families the player has landed a hit with, shared by Practice and Learn. */
export function recordFamily(f: Family) {
  const used = loadSet('ff-families');
  if (FAMILY_ORDER.includes(f as FamilyId)) used.add(f);
  saveSet('ff-families', used);
}

function satisfies(req: Requirement, fam: Family, usedAtStart: Set<string>): boolean {
  if (!req) return true;
  if (req === 'new') return usedAtStart.size >= FAMILY_ORDER.length || (FAMILY_ORDER.includes(fam as FamilyId) && !usedAtStart.has(fam));
  return fam === req || (req === 'linear' && fam === 'constant');
}

function ruleText(req: Requirement, used: Set<string>): string | null {
  if (!req) return null;
  if (req === 'new') {
    const fresh = FAMILY_ORDER.filter((f) => !used.has(f));
    return fresh.length ? `Use a kind of function you haven't hit with yet: ${fresh.map((f) => FAMILIES[f].name.toLowerCase()).join(', ')}.` : 'You have used every kind of function. Any shot counts.';
  }
  return `Use a ${FAMILIES[req].name.toLowerCase()} function.`;
}

export function mountPractice(root: HTMLElement, go: (p: string) => void): () => void {
  const look = loadLook();
  const YOU = look.color;
  const notes = notesToggle();
  const done = loadSet('ff-practice');
  let idx = Math.max(0, CHALLENGES.findIndex((c) => !done.has(c.id)));
  let free = false;
  let challenge: Challenge | null = null;
  let layout: Layout | null = null;
  let obstacles: Obstacle[] = [];
  let dummies: (Actor & { alive: boolean })[] = [];
  let selected: string | null = null;
  let busy = false;
  let usedAtStart = new Set<string>();
  let suggestions: Suggestion[] = [];
  let hovered: number | null = null;
  let coach: Coach | null = null;
  let bounds: Bounds = PRACTICE_BOUNDS;

  const head = h('div', { class: 'turn' });
  const board = h('div', { class: 'board' });
  const toast = h('div', { class: 'toast' });
  const panel = h('aside', { class: 'float-card', 'aria-label': 'Challenge' });
  const bar = new ExprBar({
    direction: true,
    placeholder: 'type a function of x, like 0.3x',
    submit: { label: 'Fire' },
    onInput: () => update(),
    onSubmit: () => void fire(),
    onDirection: () => update(),
  });
  bar.setColor(YOU);

  const progress = h('div', { class: 'progress-dots', role: 'list', 'aria-label': 'Challenges' });
  const collapse = h('button', { type: 'button', class: 'icon-btn card-toggle', 'aria-label': 'Hide challenge card', 'aria-expanded': 'true', onclick: () => {
    const open = panel.classList.toggle('is-collapsed');
    collapse.setAttribute('aria-expanded', String(!open));
    collapse.replaceChildren(icon(open ? 'next' : 'back', 18));
  } }, icon('back', 18));
  const hudTop = h('header', { class: 'hud-top' },
    h('div', { class: 'hud-left' }, h('button', { type: 'button', class: 'hud-btn', onclick: () => go('#/') }, icon('back', 18), h('span', null, 'Exit')), notes.button),
    h('div', { class: 'hud-center' }, head),
    h('div', { class: 'hud-right' }, progress),
  );
  const hudBottom = h('div', { class: 'hud-bottom' }, bar.el);
  const el = h('div', { class: 'game-full' }, board, hudTop, panel, hudBottom, notes.panel);
  root.append(el);
  document.body.classList.add('is-game');
  const view = new ArenaView(board, PRACTICE_BOUNDS);
  const wide = () => window.innerWidth > 900;
  view.insets = () => ({
    top: hudTop.getBoundingClientRect().bottom + 8,
    bottom: window.innerHeight - (wide() ? hudBottom : panel).getBoundingClientRect().top + 8,
    left: Math.max(wide() ? panel.getBoundingClientRect().right : 0, notes.width()) + 12,
    right: 64,
  });
  board.append(toast);
  view.clickable = (a) => a.kind === 'dummy';
  view.onActorClick = (id) => {
    selected = view.selectedId = id;
    sfx.click();
    if (suggestions.length) showSolutions();
  };

  const shooter = (): Actor => ({ id: 'you', x: layout!.shooter.x, y: layout!.shooter.y, r: PLAYER_RADIUS });
  const arenaNow = (): Arena => ({
    bounds,
    obstacles,
    craters: view.craters,
    actors: [shooter(), ...dummies.filter((d) => d.alive)],
  });

  // ---------- panel ----------
  const title = h('h1', { class: 'panel-title' });
  const goal = h('p', { class: 'goal' });
  const rule = h('p', { class: 'rule' });
  const hintBody = h('p', { class: 'hint-body', hidden: true });
  const hintBtn = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => {
    hintBody.hidden = !hintBody.hidden;
    hintBtn.lastElementChild!.textContent = hintBody.hidden ? 'Show a hint' : 'Hide hint';
  } }, icon('bulb', 16), h('span', null, 'Show a hint'));
  const solBtn = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => (suggestions.length ? hideSolutions() : showSolutions()) }, icon('target', 16), h('span', null, 'Show me solutions'));
  const solutions = h('div', { class: 'solutions' });
  const result = h('div', { class: 'result', 'aria-live': 'polite' });
  const foot = h('footer', { class: 'panel-foot' });
  panel.append(
    h('div', { class: 'panel-section' }, h('div', { class: 'card-head' }, title, collapse), goal, rule, h('div', { class: 'helpers' }, hintBtn, solBtn), hintBody),
    result,
    solutions,
    foot,
  );

  function renderProgress() {
    clear(progress);
    CHALLENGES.forEach((c, i) => {
      progress.append(h('button', {
        type: 'button',
        role: 'listitem',
        class: `pdot${done.has(c.id) ? ' is-done' : ''}${!free && i === idx ? ' is-current' : ''}`,
        'aria-label': `Challenge ${i + 1}: ${c.title}${done.has(c.id) ? ', done' : ''}`,
        title: c.title,
        onclick: () => load(i),
      }));
    });
  }

  function renderFoot() {
    foot.replaceChildren(
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => (free ? loadFree() : load(idx)) }, icon(free ? 'shuffle' : 'retry', 16), h('span', null, free ? 'New board' : 'Restart')),
      free
        ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => load(idx) }, 'Back to challenges')
        : h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => loadFree() }, 'Free practice'),
    );
  }

  function syncView() {
    if (!layout) return;
    view.obstacles = obstacles;
    view.actors = [
      { id: 'you', kind: 'player' as const, x: layout.shooter.x, y: layout.shooter.y, r: PLAYER_RADIUS, color: YOU, name: 'You', alive: true, facing: bar.direction, active: true, look },
      ...dummies.filter((d) => d.alive).map<ActorView>((d) => ({ id: d.id, kind: 'dummy', x: d.x, y: d.y, r: d.r, color: DUMMY_COLOR, name: 'Target', alive: true })),
    ];
  }

  function start(l: Layout, b: Bounds) {
    layout = l;
    bounds = b;
    view.setBounds(b);
    obstacles = l.obstacles;
    const dr = DUMMY_R * Math.sqrt((b.maxX - b.minX) / 40);
    dummies = l.dummies.map((d, i) => ({ id: `d${i}`, x: d.x, y: d.y, r: dr, alive: true }));
    selected = view.selectedId = dummies.length === 1 ? 'd0' : null;
    usedAtStart = loadSet('ff-families');
    suggestions = [];
    clear(solutions);
    solBtn.lastElementChild!.textContent = 'Show me solutions';
    clear(result);
    view.clearTrails();
    view.craters = [];
    view.fit();
    bar.setFacing(dummies[0] && dummies[0].x < l.shooter.x ? -1 : 1);
    syncView();

    const req = challenge ? ruleText(challenge.require, usedAtStart) : null;
    title.textContent = challenge ? challenge.title : 'Free practice';
    goal.textContent = challenge ? challenge.goal : 'Hit all three targets. Click a target before asking for solutions.';
    rule.textContent = req ?? '';
    rule.hidden = !req;
    hintBody.textContent = challenge?.brief ?? "Any function works here. Hover over a target to read where it is from you.";
    hintBody.hidden = true;
    hintBtn.lastElementChild!.textContent = 'Show a hint';
    head.replaceChildren(h('strong', null, challenge ? `Challenge ${idx + 1} of ${CHALLENGES.length}` : 'Free practice'));
    renderProgress();
    renderFoot();
    bar.value = '';
    bar.focus();
  }

  function load(i: number) {
    free = false;
    idx = i;
    challenge = CHALLENGES[i];
    start(challenge.build(), PRACTICE_BOUNDS);
  }

  function loadFree() {
    free = true;
    challenge = null;
    const m = generateMap(Math.floor(Math.random() * 2 ** 31), 4, ARENA_BOUNDS);
    start({ shooter: m.spawns[0], dummies: m.spawns.slice(1), obstacles: m.obstacles }, ARENA_BOUNDS);
  }

  function update() {
    if (!layout) return;
    const facing = bar.direction;
    view.frame = { x: layout.shooter.x, y: layout.shooter.y, facing, color: YOU };
    const you = view.actors.find((a) => a.id === 'you');
    if (you) you.facing = facing;
    const ghosts = suggestions.map((s, i) => ({ pts: s.trace.pts, color: YOU, style: i === hovered ? ('struck' as const) : ('ghost' as const) }));
    const expr = bar.value;
    if (!expr.trim() || busy) {
      view.curves = ghosts;
      bar.setSubmit('Fire', false);
      return;
    }
    const shot = planShot(arenaNow(), 'you', expr, facing);
    if (!shot.ok) {
      view.curves = ghosts;
      bar.setSubmit('Fire', false);
      if (compile(expr).ok) bar.showError(shot.error);
      return;
    }
    bar.setSubmit('Fire', true);
    let note = describeEnd(shot.trace, { players: [], obstacles });
    if (challenge?.require && !satisfies(challenge.require, shot.family, usedAtStart)) note += `. This is ${FAMILY_LABEL[shot.family].toLowerCase()}; the rule asks for something else.`;
    bar.setNote(note, shot.trace.hit?.type === 'actor' ? 'good' : 'muted');
    view.curves = [...ghosts, { pts: shot.trace.pts, color: YOU, style: 'preview', endRing: true }];
    coach?.signal('typed');
  }

  async function fire() {
    if (busy || !layout) return;
    const facing = bar.direction;
    const arena = arenaNow();
    const shot = planShot(arena, 'you', bar.value, facing);
    if (!shot.ok) return;
    coach?.signal('fired');
    busy = true;
    bar.setDisabled(true);
    view.curves = [];
    clear(result);
    sfx.launch();
    await view.fire(shot.trace.pts, YOU, 'you', look.shot);
    const hit = shot.trace.hit;
    const targetId = hit?.type === 'actor' ? hit.id : selected ?? dummies.find((d) => d.alive)?.id;
    const target = dummies.find((d) => d.id === targetId && d.alive);
    const fb = explainShot({ trace: shot.trace, fn: shot.fn, family: shot.family, shooter: shooter(), facing, target, arena });
    let good = fb.success;
    let heading = good ? 'Nice shot!' : 'Not quite';
    let detail = fb.detail;

    if (hit?.type === 'obstacle') {
      const o = obstacles.find((q) => q.id === hit.id)!;
      if (o.solid) {
        sfx.thud();
        view.flashObstacle(o.id);
        detail += " That one can't be broken, so go around it.";
      } else {
        sfx.crumble();
        view.blast({ x: hit.x, y: hit.y, r: craterRadius(bounds) });
        view.pow(hit.x, hit.y, 'BOOM!', '#ff8a1f');
        heading = 'Boom!';
        detail = `You blasted a hole in the ${o.kind} right where your shot landed. Fire through the gap, or blast it wider.`;
      }
    } else if (hit?.type === 'actor') {
      const d = dummies.find((q) => q.id === hit.id)!;
      view.burst(hit.x, hit.y, DUMMY_COLOR, 24);
      view.pow(hit.x, hit.y + 1, 'POW!', '#ffcf33');
      view.wobbleActor(d.id);
      view.shake(0.4);
      if (!challenge || satisfies(challenge.require, shot.family, usedAtStart)) {
        sfx.pop();
        recordFamily(shot.family);
        good = true;
        heading = 'Nice shot!';
        d.alive = false;
        if (selected === d.id) selected = view.selectedId = null;
      } else {
        sfx.miss();
        good = false;
        heading = "That hit doesn't count";
        detail = `${ruleText(challenge.require, usedAtStart)} Yours was ${FAMILY_LABEL[shot.family].toLowerCase()}.`;
      }
    } else {
      sfx.miss();
    }

    await new Promise((r) => setTimeout(r, 600));
    busy = false;
    bar.setDisabled(false);
    syncView();
    const cleared = dummies.every((d) => !d.alive);
    if (cleared) complete();
    renderResult(good, heading, detail, cleared);
    update();
  }

  function renderResult(good: boolean, heading: string, detail: string, cleared: boolean) {
    const next = !free && idx < CHALLENGES.length - 1;
    result.replaceChildren(
      h('div', { class: `result-card ${good ? 'is-good' : 'is-miss'}` },
        h('div', { class: 'result-head' }, icon(good ? 'check' : 'alert', 18), h('strong', null, cleared ? (free ? 'Board cleared' : 'Challenge complete') : heading)),
        h('p', null, detail),
        cleared
          ? next
            ? h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => load(idx + 1) }, h('span', null, 'Next challenge'), icon('next', 16))
            : h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => loadFree() }, free ? 'New board' : 'Try free practice')
          : h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => {
              clear(result);
              bar.input.select();
            } }, 'Try again'),
      ),
    );
    result.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }

  function complete() {
    sfx.win();
    view.confetti();
    if (challenge) {
      done.add(challenge.id);
      saveSet('ff-practice', done);
    }
    toast.replaceChildren(icon('check', 16), h('strong', null, free ? 'Board cleared' : 'Challenge complete'));
    toast.classList.remove('is-on');
    void toast.offsetWidth;
    toast.classList.add('is-on');
    setTimeout(() => toast.classList.remove('is-on'), 2000);
    renderProgress();
  }

  function hideSolutions() {
    suggestions = [];
    hovered = null;
    clear(solutions);
    solBtn.lastElementChild!.textContent = 'Show me solutions';
    update();
  }

  function showSolutions() {
    solBtn.lastElementChild!.textContent = 'Hide solutions';
    const alive = dummies.filter((d) => d.alive);
    const target = selected ?? (alive.length === 1 ? alive[0].id : null);
    if (!target) {
      suggestions = [];
      solutions.replaceChildren(h('p', { class: 'muted' }, 'Click a target on the board first.'));
      update();
      return;
    }
    selected = view.selectedId = target;
    const arena = arenaNow();
    const reqFam = challenge?.require && challenge.require !== 'new' ? challenge.require : undefined;
    const all = suggestShots(arena, 'you', target);
    const fam = reqFam ? suggestShots(arena, 'you', target, { family: reqFam, max: 3 }) : null;
    const merged = [...(fam?.shots ?? []), ...all.shots.filter((s) => !fam?.shots.some((f) => f.expr === s.expr))].slice(0, 5);
    suggestions = merged.length ? merged : all.setups;
    hovered = null;
    const intro = merged.length
      ? `${merged.length} shot${merged.length === 1 ? '' : 's'} that hit, each checked on this exact board. Hover one to see its path.`
      : all.setups.length
        ? 'Nothing can reach the target yet. These shots break what is in the way.'
        : 'No shot can reach this target from here.';
    const list = h('ol', { class: 'sol-list' });
    suggestions.forEach((s, i) => {
      const fits = !challenge || satisfies(challenge.require, s.family, usedAtStart);
      list.append(
        h('li', { class: 'sol', tabindex: 0, onmouseenter: () => hoverSol(i), onfocus: () => hoverSol(i), onmouseleave: () => hoverSol(null) },
          h('div', { class: 'sol-top' },
            h('span', { class: 'sol-expr' }, `y = ${s.expr}`),
            h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => {
              bar.setFacing(s.facing);
              bar.value = s.expr;
              bar.focus();
              sfx.click();
            } }, 'Use this'),
          ),
          h('p', { class: 'sol-meta' }, `${FAMILIES[s.family].name} · ${s.route === 'setup' ? 'breaks an obstacle' : s.route === 'threads' ? 'goes through a gap' : 'avoids obstacles'}${fits ? '' : " · doesn't follow this challenge's rule"}`),
          h('p', null, s.explanation),
        ),
      );
    });
    solutions.replaceChildren(h('p', { class: 'muted' }, intro), list);
    update();
  }

  function hoverSol(i: number | null) {
    hovered = i;
    update();
  }

  load(idx);

  // First visit: walk through the first shot, waiting for the player to do each thing.
  if (!Coach.seen('practice') && idx === 0) {
    const youRect = () => (layout ? pointRect(board, view.toScreen(layout.shooter.x, layout.shooter.y)) : null);
    const targetRect = () => (dummies[0] ? pointRect(board, view.toScreen(dummies[0].x, dummies[0].y)) : null);
    coach = new Coach(
      [
        { target: youRect, title: 'This is you', text: 'Every shot starts here and flies away from you. A function decides its path.' },
        { target: targetRect, title: 'This is your target', text: 'Hover over it to see how far ahead and how high it is from you.' },
        { target: () => bar.el.querySelector('.expr-field')!.getBoundingClientRect(), title: 'Type a function', text: 'A line like 0.3x climbs 0.3 for every step forward.', waitFor: 'typed', doThis: 'Type 0.3x in the box' },
        { target: () => board.getBoundingClientRect(), title: 'Check the preview', text: 'The line on the board is exactly where your shot will go. If it touches the target, it hits.' },
        { target: () => bar.el.querySelector('.expr-submit')!.getBoundingClientRect(), title: 'Fire', text: "Watch it fly. If you miss, you'll see why and can try again.", waitFor: 'fired', doThis: 'Press Fire or Enter' },
      ],
      'practice',
      () => (coach = null),
    );
    setTimeout(() => coach?.start(), 300);
  }

  return () => {
    coach?.stop();
    notes.destroy();
    document.body.classList.remove('is-game');
    view.destroy();
    el.remove();
  };
}
