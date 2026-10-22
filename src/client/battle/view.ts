import { arenaFrom, shotOptions, teleportCheck, type Player, type PowerUse, type ShotEvent } from '../../engine/game.ts';
import { shapeCenter } from '../../engine/geometry.ts';
import { ARENA_BOUNDS, PLAYER_RADIUS } from '../../engine/map.ts';
import { POWERS, teleportRange } from '../../engine/powers.ts';
import { planShot } from '../../engine/shot.ts';
import type { Bounds, Crater, Facing, Obstacle, Trace, Vec } from '../../engine/types.ts';
import { defaultLook, type Look } from '../../net/look.ts';
import { ArenaView, type ActorView, type CurveView } from '../arena/view.ts';
import { sfx } from '../audio.ts';
import { Coach } from '../coach.ts';
import { clear, h } from '../dom.ts';
import { ExprBar } from '../exprbar.ts';
import { icon } from '../icons.ts';
import { notesToggle } from '../notes/drawer.ts';
import { ACCENT, SEATS } from '../palette.ts';
import { spinCard } from './spinner.ts';

export interface BattleSnapshot {
  round: number;
  bounds: Bounds;
  obstacles: Obstacle[];
  craters: Crater[];
  players: Player[];
}

export interface OrderCell {
  id: string;
  locked: boolean;
  at?: number;
}

export interface BattleOptions {
  onLock: (expr: string, facing: Facing, use: PowerUse) => string | null;
  onLeave: () => void;
  /** Each player's cosmetics; seat defaults when missing. */
  lookOf?: (p: Pick<Player, 'id' | 'seat'>) => Look | undefined;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const playerLabel = (p: Pick<Player, 'name' | 'seat'>) => p.name || SEATS[p.seat % SEATS.length].name;

/** Where the previewed shot ends, in a few words. */
export function describeEnd(trace: Trace, snap: Pick<BattleSnapshot, 'players' | 'obstacles'>): string {
  const hit = trace.hit;
  if (hit?.type === 'actor') {
    const p = snap.players.find((q) => q.id === hit.id);
    return p ? `Hits ${playerLabel(p)}` : 'Hits the target';
  }
  if (hit?.type === 'obstacle') {
    const o = snap.obstacles.find((q) => q.id === hit.id);
    return !o ? 'Hits an obstacle' : o.solid ? 'Hits a metal block (can\'t break)' : `Blasts a hole in a ${o.kind}`;
  }
  if (trace.end === 'undefined') return 'Stops where the function is undefined';
  if (trace.end === 'asymptote') return 'Breaks at an asymptote';
  return 'Misses everything';
}

const dot = (color: string) => h('span', { class: 'dot', style: `--c: ${color}` });

export class BattleView {
  readonly el: HTMLElement;
  readonly arena: ArenaView;
  readonly bar: ExprBar;
  private snap: BattleSnapshot | null = null;
  private activeId: string | null = null;
  private firingId: string | null = null;
  private order: OrderCell[] = [];
  private turnEl: HTMLElement;
  private clockEl: HTMLElement;
  private playersEl: HTMLElement;
  private logEl: HTMLElement;
  private roundTitle: HTMLElement;
  private overlay: HTMLElement;
  private toast: HTMLElement;
  private toastTimer = 0;
  private coached = false;
  private powerBtn: HTMLButtonElement;
  /** The active player has switched their power-up on for this lock-in. */
  private powerOn = false;
  private teleportTo: Vec | null = null;
  private notes: ReturnType<typeof notesToggle>;

  constructor(root: HTMLElement, private opts: BattleOptions) {
    this.turnEl = h('div', { class: 'turn' });
    this.clockEl = h('div', { class: 'clock', role: 'timer' });
    this.overlay = h('div', { class: 'board-overlay', hidden: true });
    this.toast = h('div', { class: 'toast', 'aria-live': 'assertive' });
    const board = h('div', { class: 'board' });
    this.bar = new ExprBar({
      direction: true,
      submit: { label: 'Lock in', icon: 'lock' },
      onInput: () => this.updatePreview(),
      onSubmit: () => this.lock(),
      onDirection: () => this.updatePreview(),
    });
    this.playersEl = h('ol', { class: 'hud-players', 'aria-label': 'Players' });
    this.logEl = h('ol', { class: 'log' });
    this.roundTitle = h('span', { class: 'hud-round' }, 'Round 1');
    let armed = false;
    const leave = h('button', { type: 'button', class: 'hud-btn', 'aria-label': 'Leave game', title: 'Leave game', onclick: () => {
      if (armed) return this.opts.onLeave();
      armed = true;
      leave.replaceChildren(icon('back', 18), h('span', null, 'Click again to leave'));
      setTimeout(() => {
        armed = false;
        leave.replaceChildren(icon('back', 18), h('span', null, 'Leave'));
      }, 2500);
    } }, icon('back', 18), h('span', null, 'Leave'));
    const drawer = h('aside', { class: 'drawer', hidden: true, 'aria-label': 'Shot log' },
      h('div', { class: 'drawer-head' }, h('h2', null, 'Shots'), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close shot log', onclick: () => (drawer.hidden = true) }, icon('close', 18))),
      this.logEl,
    );
    const logBtn = h('button', { type: 'button', class: 'hud-btn', onclick: () => (drawer.hidden = !drawer.hidden) }, icon('book', 18), h('span', null, 'Shots'));
    this.notes = notesToggle();
    this.powerBtn = h('button', { type: 'button', class: 'power-btn', hidden: true, 'aria-pressed': 'false', onclick: () => this.togglePower() });
    this.bar.addExtra(this.powerBtn);

    // The board is the whole screen; everything else floats on top of it.
    const hudCenter = h('div', { class: 'hud-center' }, this.turnEl, this.clockEl);
    const hudTop = h('header', { class: 'hud-top' },
      h('div', { class: 'hud-left' }, leave, this.notes.button),
      hudCenter,
      h('div', { class: 'hud-right' }, this.roundTitle, this.playersEl, logBtn),
    );
    const hudBottom = h('div', { class: 'hud-bottom' }, this.bar.el);
    this.el = h('div', { class: 'game-full' }, board, hudTop, drawer, hudBottom, this.notes.panel);
    root.append(this.el);
    document.body.classList.add('is-game');
    this.arena = new ArenaView(board, ARENA_BOUNDS);
    this.arena.insets = () => ({
      // Only the centre pill blocks the middle; corner chips may overlap empty grid.
      top: hudCenter.getBoundingClientRect().bottom + 8,
      bottom: window.innerHeight - hudBottom.getBoundingClientRect().top + 8,
      left: this.notes.width() + 12,
      right: 64,
    });
    this.arena.onBoardClick = (pt) => this.pickTeleport(pt);
    board.append(this.toast, this.overlay);
    this.bar.setDisabled(true);
    this.renderLogEmpty();
  }

  destroy() {
    document.body.classList.remove('is-game');
    this.notes.destroy();
    this.arena.destroy();
    this.el.remove();
  }

  setGame(snap: BattleSnapshot) {
    this.snap = structuredClone(snap);
    this.arena.bounds = snap.bounds;
    this.arena.obstacles = this.snap.obstacles;
    this.arena.craters = this.snap.craters;
    this.roundTitle.textContent = `Round ${snap.round}`;
    this.syncActors();
    this.renderPlayers();
  }

  look(p: Pick<Player, 'id' | 'seat'>): Look {
    return this.opts.lookOf?.(p) ?? defaultLook(p.seat);
  }

  color(p: Pick<Player, 'id' | 'seat'>): string {
    return this.look(p).color;
  }

  private syncActors() {
    if (!this.snap) return;
    const actors = this.snap.players.map<ActorView>((p) => ({
      id: p.id,
      kind: 'player',
      x: p.x,
      y: p.y,
      r: PLAYER_RADIUS,
      color: this.color(p),
      name: playerLabel(p),
      alive: p.alive,
      lives: p.lives,
      maxLives: p.maxLives,
      facing: this.arena.actors.find((a) => a.id === p.id)?.facing ?? (p.x <= 0 ? 1 : -1),
      active: p.id === this.activeId,
      look: this.look(p),
    }));
    const me = actors.find((a) => a.id === this.activeId);
    if (me && this.teleportTo) actors.push({ ...me, id: 'ghost', x: this.teleportTo.x, y: this.teleportTo.y, ghost: true, active: false, name: 'Teleport here' });
    this.arena.actors = actors;
  }

  /** Who is aiming now. null = nobody (waiting, replaying). */
  setActive(id: string | null, facing?: Facing) {
    this.activeId = id;
    this.powerOn = false;
    this.teleportTo = null;
    const p = this.snap?.players.find((q) => q.id === id);
    this.renderPower();
    if (p) {
      const color = this.color(p);
      this.bar.setColor(color);
      this.bar.setDisabled(false);
      if (facing) this.bar.setFacing(facing);
      this.bar.value = '';
      this.turnEl.replaceChildren(dot(color), h('strong', null, `${playerLabel(p)}'s turn`), h('span', null, 'Type a function, then lock in'));
      this.bar.focus();
    } else {
      // Hot-seat: the next player must never see the last player's equation.
      this.bar.value = '';
      this.bar.setDisabled(true);
      this.arena.frame = null;
      this.arena.curves = [];
    }
    this.syncActors();
    this.renderPlayers();
    this.updatePreview();
  }

  setWaiting(text: string) {
    this.turnEl.replaceChildren(h('strong', null, text));
  }

  setOrder(order: OrderCell[]) {
    this.order = order;
    this.renderPlayers();
  }

  private renderPlayers() {
    if (!this.snap) return;
    clear(this.playersEl);
    const rank = new Map([...this.order].filter((o) => o.locked).sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).map((o, i) => [o.id, { n: i + 1, at: o.at ?? 0 }]));
    for (const p of this.snap.players) {
      const r = rank.get(p.id);
      const status = !p.alive ? 'out' : this.firingId === p.id ? 'firing' : r ? `#${r.n}` : this.activeId === p.id ? 'aiming' : '';
      this.playersEl.append(
        h('li', {
          class: `chip${p.alive ? '' : ' is-out'}${this.firingId === p.id ? ' is-firing' : ''}${this.activeId === p.id ? ' is-active' : ''}${r ? ' is-locked' : ''}`,
          title: r ? `Locked in at ${(r.at / 1000).toFixed(1)}s` : undefined,
        },
          dot(this.color(p)),
          h('span', { class: 'chip-name' }, playerLabel(p)),
          p.power && p.alive ? h('span', { class: 'chip-power', style: `--pw: ${POWERS[p.power].color}`, title: `${POWERS[p.power].name}: ${POWERS[p.power].text}`, 'aria-label': `Power-up: ${POWERS[p.power].name}` }, icon(p.power, 14)) : null,
          p.maxLives > 1 ? h('span', { class: 'lives', 'aria-label': `${p.lives} lives` }, ...Array.from({ length: p.maxLives }, (_, i) => h('i', { class: i < p.lives ? 'on' : '' }))) : null,
          status ? h('span', { class: 'chip-status' }, status) : null,
        ),
      );
    }
  }

  setTimer(ms: number | null) {
    if (ms === null) {
      this.clockEl.textContent = '';
      this.clockEl.classList.remove('is-low');
      return;
    }
    const s = Math.max(0, Math.ceil(ms / 1000));
    this.clockEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.clockEl.classList.toggle('is-low', s <= 10);
  }

  private renderPower() {
    const p = this.snap?.players.find((q) => q.id === this.activeId);
    const power = p?.alive ? p.power : null;
    this.powerBtn.hidden = !power;
    if (!power) return;
    const def = POWERS[power];
    this.powerBtn.style.setProperty('--pw', def.color);
    this.powerBtn.setAttribute('aria-pressed', String(this.powerOn));
    this.powerBtn.title = def.text;
    this.powerBtn.setAttribute('aria-label', `${def.name}: ${def.text}`);
    this.powerBtn.replaceChildren(icon(power, 18), h('span', null, this.powerOn ? `${def.name} on` : `Use ${def.name}`));
  }

  private togglePower() {
    this.powerOn = !this.powerOn;
    this.teleportTo = null;
    sfx.click();
    this.renderPower();
    this.syncActors();
    this.updatePreview();
  }

  private pickTeleport(pt: Vec) {
    const p = this.snap?.players.find((q) => q.id === this.activeId);
    if (!this.snap || !p || !this.powerOn || p.power !== 'teleport') return;
    const err = teleportCheck(this.snap, p.id, pt);
    if (err) {
      sfx.error();
      this.bar.showError(err);
      return;
    }
    this.teleportTo = pt;
    sfx.click();
    this.syncActors();
    this.bar.value = this.bar.value;
  }

  private updatePreview() {
    const p = this.snap?.players.find((q) => q.id === this.activeId);
    this.arena.zone = null;
    if (!this.snap || !p) return;
    const color = this.color(p);
    const power = this.powerOn ? p.power : null;
    const from = power === 'teleport' ? this.teleportTo : null;
    if (power === 'teleport') this.arena.zone = { x: p.x, y: p.y, r: teleportRange(this.snap.bounds), color };
    const facing = this.bar.direction;
    this.arena.frame = { x: (from ?? p).x, y: (from ?? p).y, facing, color };
    for (const a of this.arena.actors) if (a.id === p.id || a.id === 'ghost') a.facing = facing;
    if (power === 'teleport' && !from) {
      this.arena.curves = [];
      this.bar.setSubmit('Lock in', false);
      this.bar.setNote('Click inside the circle to pick where you teleport');
      return;
    }
    const expr = this.bar.value;
    if (!expr.trim()) {
      this.arena.curves = [];
      this.bar.setSubmit('Lock in', false);
      this.bar.setNote('Try 0.5x to start');
      return;
    }
    const arena = arenaFrom(this.snap, p.id, from ?? undefined);
    const shot = planShot(arena, p.id, expr, facing, shotOptions(power));
    if (!shot.ok) {
      this.arena.curves = [];
      this.bar.setSubmit('Lock in', false);
      if (!/^Type an equation/.test(shot.error)) this.bar.showError(shot.error);
      return;
    }
    this.bar.setSubmit('Lock in', true);
    const curves: CurveView[] = [{ pts: shot.trace.pts, color, style: 'preview', endRing: true }];
    let note = describeEnd(shot.trace, this.snap);
    if (power === 'mirror') {
      const back = planShot(arena, p.id, expr, facing === 1 ? -1 : 1, shotOptions(power));
      if (back.ok) {
        curves.push({ pts: back.trace.pts, color, style: 'preview', endRing: true });
        note += `. Backward: ${describeEnd(back.trace, this.snap).toLowerCase()}`;
      }
    }
    if (power === 'drill' && shot.trace.drilled) note = `Drills through an obstacle, then ${note[0].toLowerCase()}${note.slice(1)}`;
    this.bar.setNote(note, shot.trace.hit?.type === 'actor' ? 'good' : 'muted');
    this.arena.curves = curves;
  }

  private lock() {
    if (!this.activeId) return;
    const use: PowerUse = this.powerOn ? { power: true, ...(this.teleportTo ? { to: this.teleportTo } : {}) } : {};
    const err = this.opts.onLock(this.bar.value, this.bar.direction, use);
    if (err) {
      sfx.error();
      this.bar.showError(err);
      return;
    }
    sfx.lock();
  }

  /** First time someone aims, walk them through the four things that matter. */
  coach(): Promise<void> {
    if (this.coached) return Promise.resolve();
    this.coached = true;
    const rect = (el: Element | null) => () => el?.getBoundingClientRect() ?? null;
    return Coach.runOnce(
      [
        { target: rect(this.bar.el.querySelector('.expr-field')), title: 'Type your shot', text: 'Any function of x works. The line on the board shows exactly where your shot will fly, starting from you.' },
        { target: rect(this.bar.el.querySelector('.seg')), title: 'Pick a direction', text: 'Your shot travels away from you to the left or the right.' },
        { target: rect(this.bar.el.querySelector('.expr-submit')), title: 'Lock in early', text: 'Shots fire in the order players lock in. Lock in sooner to fire first.' },
        { target: rect(this.playersEl), title: 'Last one standing wins', text: 'If you are hit before your turn comes, your shot is lost. Everyone gets the same 60 seconds.' },
      ],
      'battle',
    );
  }

  banner(title: string, sub = '', color = ACCENT, ms = 1800) {
    window.clearTimeout(this.toastTimer);
    this.toast.replaceChildren(dot(color), h('strong', null, title), sub ? h('span', null, sub) : '');
    this.toast.classList.remove('is-on');
    void this.toast.offsetWidth;
    this.toast.classList.add('is-on');
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('is-on'), ms);
  }

  showOverlay(content: HTMLElement) {
    this.overlay.replaceChildren(content);
    this.overlay.hidden = false;
    content.querySelector<HTMLElement>('button')?.focus();
  }

  hideOverlay() {
    this.overlay.hidden = true;
    clear(this.overlay);
  }

  /** The power-up spinner. Lands on `featuredId`'s power (yours online); resolves once it stops. */
  spin(featuredId: string | null): Promise<void> {
    if (!this.snap) return Promise.resolve();
    const holders = this.snap.players.filter((p) => p.alive && p.power);
    if (!holders.length) return Promise.resolve();
    const { el, done } = spinCard(holders.map((p) => ({ id: p.id, name: playerLabel(p), color: this.color(p), power: p.power! })), featuredId);
    this.el.append(el);
    return done;
  }

  /** Hot-seat: the next player takes the controls. */
  handoff(p: Player, sub: string): Promise<void> {
    return new Promise((resolve) => {
      const color = this.color(p);
      this.turnEl.replaceChildren(dot(color), h('strong', null, `${playerLabel(p)} is up next`));
      this.showOverlay(
        h('div', { class: 'dialog' },
          h('span', { class: 'avatar', style: `--c: ${color}` }),
          h('h2', null, `Pass to ${playerLabel(p)}`),
          h('p', null, sub),
          p.power ? h('p', { class: 'dialog-power', style: `--pw: ${POWERS[p.power].color}` }, icon(p.power, 18), h('span', null, h('strong', null, POWERS[p.power].name), ` ready: ${POWERS[p.power].text}`)) : null,
          h('button', { type: 'button', class: 'btn btn-primary btn-lg', style: `--btn: ${color}`, onclick: () => {
            this.hideOverlay();
            resolve();
          } }, `I'm ${playerLabel(p)}, start my turn`),
        ),
      );
    });
  }

  private renderLogEmpty() {
    this.logEl.replaceChildren(h('li', { class: 'log-empty' }, 'Shots appear here after each round.'));
  }

  private logRound(round: number) {
    if (this.logEl.querySelector('.log-empty')) clear(this.logEl);
    this.logEl.append(h('li', { class: 'log-round' }, `Round ${round}`));
  }

  private logShot(color: string, name: string, text: string, result: string) {
    const li = h('li', { class: 'log-shot' }, dot(color), h('span', { class: 'log-name' }, name), h('span', { class: 'log-expr' }, text), h('span', { class: 'log-result' }, result));
    this.logEl.append(li);
    li.scrollIntoView({ block: 'nearest' });
  }

  /** Replay the round in lock order, highlighting whoever is firing. */
  async play(events: ShotEvent[], final: BattleSnapshot) {
    if (!this.snap) return;
    this.setActive(null);
    this.arena.clearTrails();
    this.order = events.map((e) => ({ id: e.playerId, locked: e.kind === 'shot', at: e.kind === 'shot' ? e.at : undefined }));
    this.setWaiting('Shots firing');
    this.logRound(this.snap.round);
    this.banner(`Round ${this.snap.round}`, 'Shots fire in lock-in order', ACCENT, 1200);
    await wait(1000);
    for (const e of events) {
      const shooter = this.snap.players.find((p) => p.id === e.playerId)!;
      const color = this.color(shooter);
      const name = playerLabel(shooter);
      this.firingId = e.playerId;
      this.renderPlayers();
      if (e.kind === 'teleport') {
        sfx.pop();
        this.banner(`${name} teleports!`, 'Shots aimed at the old spot will miss', color, 1200);
        this.arena.teleportFx(e.from, e.to, color);
        shooter.x = e.to.x;
        shooter.y = e.to.y;
        this.syncActors();
        this.logShot(color, name, 'Teleport', 'jumped to a new spot');
        await wait(900);
        continue;
      }
      if (e.kind === 'pass') {
        this.logShot(color, name, '—', 'did not lock in');
        await wait(500);
        continue;
      }
      if (e.kind === 'cancelled') {
        this.logShot(color, name, '—', 'was hit first');
        await wait(500);
        continue;
      }
      const title = e.power ? `${name} uses ${POWERS[e.power].name}!` : e.mirror ? `${name}'s mirror shot` : `${name} fires`;
      this.banner(title, `y = ${e.expr}`, e.power ? POWERS[e.power].color : color, 1600);
      this.arena.setMood(shooter.id, 'aim', 4000);
      const actor = this.arena.actors.find((a) => a.id === shooter.id);
      if (actor) actor.facing = e.facing;
      sfx.launch();
      await this.arena.fire(e.pts, color, shooter.id, this.look(shooter).shot);
      for (const id of e.drilled ?? []) {
        const o = this.snap.obstacles.find((q) => q.id === id);
        if (!o) continue;
        const c = shapeCenter(o.shape);
        this.arena.flashObstacle(id);
        this.arena.pow(c.x, c.y, 'VRRR!', '#c9cfda');
      }
      this.logShot(color, name, `y = ${e.expr}`, this.applyHit(e, name));
      await wait(e.eliminated ? 1200 : 600);
    }
    this.firingId = null;
    await wait(300);
    this.setGame(final);
  }

  private applyHit(e: Extract<ShotEvent, { kind: 'shot' }>, name: string): string {
    const hit = e.hit;
    if (!this.snap) return '';
    if (!hit) {
      sfx.miss();
      this.arena.setMood(e.playerId, 'sad', 1400);
      return 'missed';
    }
    if (hit.type === 'obstacle') {
      const o = this.snap.obstacles.find((q) => q.id === hit.id);
      if (!o) return 'hit an obstacle';
      if (e.crater) {
        sfx.crumble();
        this.arena.blast(e.crater);
        this.arena.pow(hit.x, hit.y, 'BOOM!', '#ff8a1f');
        return `blasted a ${o.kind}`;
      }
      sfx.thud();
      this.arena.flashObstacle(o.id);
      this.arena.pow(hit.x, hit.y, 'BONK!', '#ffffff');
      this.arena.burst(hit.x, hit.y, '#c9cfda', 10, true);
      return `hit a ${o.kind}`;
    }
    const victim = this.snap.players.find((q) => q.id === hit.id);
    if (!victim) return 'hit';
    victim.lives = e.livesLeft ?? victim.lives - 1;
    const vColor = this.color(victim);
    if (e.saved) {
      sfx.pop();
      this.arena.burst(hit.x, hit.y, '#ff4f9a', 26);
      this.arena.pow(hit.x, hit.y + 1, 'SAVED!', '#ff4f9a');
      this.arena.setMood(victim.id, 'scared', 2000);
      this.arena.wobbleActor(victim.id);
      this.banner(`${playerLabel(victim)} survives!`, 'Their Extra Life is used up', vColor, 1600);
      return `hit ${playerLabel(victim)}, but an Extra Life saved them`;
    }
    this.arena.burst(hit.x, hit.y, vColor, 26);
    this.arena.pow(hit.x, hit.y + 1, e.eliminated ? 'K.O.!' : 'POW!', '#ffcf33');
    this.arena.shake(0.8);
    this.arena.setMood(victim.id, 'hit', 2000);
    this.arena.setMood(e.playerId, 'happy', 2000);
    this.arena.wobbleActor(victim.id);
    if (e.eliminated) {
      victim.alive = false;
      sfx.boom();
      this.banner(`${playerLabel(victim)} is out`, `Hit by ${name}`, vColor, 1800);
    } else {
      sfx.pop();
      this.banner(`${playerLabel(victim)} was hit`, `${victim.lives} ${victim.lives === 1 ? 'life' : 'lives'} left`, vColor, 1400);
    }
    this.syncActors();
    this.renderPlayers();
    return `hit ${playerLabel(victim)}${e.eliminated ? ', out' : ''}`;
  }

  victory(winner: Player | null, actions: { label: string; primary?: boolean; onClick: () => void }[]) {
    if (winner) {
      this.arena.setMood(winner.id, 'happy', 60_000);
      this.arena.confetti();
      sfx.win();
    }
    const color = winner ? this.color(winner) : ACCENT;
    this.turnEl.replaceChildren(h('strong', null, 'Game over'));
    this.showOverlay(
      h('div', { class: 'dialog' },
        winner ? h('span', { class: 'avatar', style: `--c: ${color}` }) : null,
        h('h2', null, winner ? `${playerLabel(winner)} wins` : 'Draw'),
        h('p', null, winner ? `Last one standing after ${this.snap?.round ?? 1} round${(this.snap?.round ?? 1) === 1 ? '' : 's'}.` : 'Nobody survived.'),
        h('div', { class: 'dialog-actions' }, ...actions.map((a) => h('button', { type: 'button', class: `btn btn-lg ${a.primary ? 'btn-primary' : 'btn-secondary'}`, onclick: a.onClick }, a.label))),
      ),
    );
  }
}
