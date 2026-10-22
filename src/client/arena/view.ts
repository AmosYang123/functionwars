import { flightSeconds } from '../../engine/game.ts';
import { distToShape } from '../../engine/geometry.ts';
import type { Bounds, Crater, Facing, Obstacle, Vec } from '../../engine/types.ts';
import type { ShotId } from '../../net/look.ts';
import { h, reducedMotion } from '../dom.ts';
import { icon } from '../icons.ts';
import { fmt } from '../../engine/families.ts';
import { CANDY, FONT_DISPLAY, INK, withAlpha } from '../palette.ts';
import {
  drawActor, drawCurve, drawGrid, drawLocalFrame, drawObstacle, drawPow, outline, shapePath,
  type ActorView, type Cam, type CurveView, type Mood,
} from './draw.ts';
import { drawHead, drawTrail } from './skins.ts';

export type { ActorView, CurveView, Mood };

interface Projectile {
  pts: number[];
  cum: number[];
  color: string;
  dist: number;
  speed: number;
  done: () => void;
  shooterId?: string;
  shot: ShotId;
}

interface Trail {
  pts: number[];
  color: string;
  life: number;
  shot: ShotId;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  shard?: boolean;
  /** Confetti flutters: slow fall, spin, drawn as a rotating rectangle. */
  spin?: number;
  rot?: number;
}

interface Pow {
  x: number;
  y: number;
  word: string;
  color: string;
  life: number;
  rot: number;
}

export interface Frame {
  x: number;
  y: number;
  facing: Facing;
  color: string;
}

/**
 * The coordinate plane. Owns the camera (fit, zoom, pan), draws the arena
 * state it is given, and plays projectiles and effects on top.
 */
export class ArenaView {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private raf = 0;
  private last = 0;
  private time = 0;
  private hover: { x: number; y: number } | null = null;
  private moods = new Map<string, { mood: Mood; until: number }>();
  private wobble = new Map<string, number>();
  private flashes = new Map<string, number>();
  private projectiles: Projectile[] = [];
  private trails: Trail[] = [];
  private particles: Particle[] = [];
  private pows: Pow[] = [];
  private rings: { x: number; y: number; r: number; life: number }[] = [];
  // Breakable obstacles are drawn here first so blasted craters can be cut out of them.
  private layer = document.createElement('canvas');
  private lctx = this.layer.getContext('2d')!;
  private shakeMag = 0;
  private ro: ResizeObserver;

  obstacles: Obstacle[] = [];
  craters: Crater[] = [];
  actors: ActorView[] = [];
  curves: CurveView[] = [];
  frame: Frame | null = null;
  selectedId: string | null = null;
  /** More actors drawn as selected (the cheat's targets). */
  marked = new Set<string>();
  /** A dashed circle on the board (the teleport range). */
  zone: { x: number; y: number; r: number; color: string } | null = null;
  onActorClick?: (id: string) => void;
  /** A click on the board that didn't pick an actor, in world coordinates. */
  onBoardClick?: (p: Vec) => void;
  /** Screen space covered by floating UI, in px from each edge of the board. */
  insets?: () => { top: number; right: number; bottom: number; left: number };
  /** Ids that react to clicks (cursor + selection); all actors when unset. */
  clickable?: (a: ActorView) => boolean;

  constructor(host: HTMLElement, public bounds: Bounds, private opts: { controls?: boolean; readout?: boolean; label?: string } = {}) {
    this.canvas = h('canvas', { class: 'arena-canvas', role: 'img', 'aria-label': opts.label ?? 'Coordinate plane arena' });
    this.ctx = this.canvas.getContext('2d')!;
    this.el = h('div', { class: 'arena' }, this.canvas);
    if (opts.controls !== false) this.el.append(this.controls());
    host.append(this.el);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.bindInput();
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.el.remove();
    this.projectiles.forEach((p) => p.done());
  }

  private controls() {
    const btn = (name: 'zoomIn' | 'zoomOut' | 'fit', label: string, fn: () => void) =>
      h('button', { class: 'icon-key', type: 'button', 'aria-label': label, title: label, onclick: fn }, icon(name, 16));
    return h(
      'div',
      { class: 'arena-controls' },
      btn('zoomIn', 'Zoom in', () => this.zoomBy(1.3)),
      btn('zoomOut', 'Zoom out', () => this.zoomBy(1 / 1.3)),
      btn('fit', 'Fit arena', () => this.fit()),
    );
  }

  fit() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }

  setBounds(b: Bounds) {
    this.bounds = b;
    this.fit();
  }

  private zoomBy(f: number, at?: { sx: number; sy: number }) {
    const before = at ? this.toWorld(at.sx, at.sy) : null;
    // Like a graphing calculator: effectively unlimited zoom in and out.
    this.zoom = Math.max(1e-4, Math.min(1e5, this.zoom * f));
    if (before && at) {
      const after = this.toWorld(at.sx, at.sy);
      this.panX += before.x - after.x;
      this.panY += before.y - after.y;
    }
  }

  private resize() {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layer.width = this.canvas.width;
    this.layer.height = this.canvas.height;
    this.lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  cam(): Cam {
    const b = this.bounds;
    // Fit the arena into the space the HUD leaves open, not the whole canvas.
    const ins = this.insets?.() ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const w = Math.max(80, this.w - ins.left - ins.right);
    const hh = Math.max(80, this.h - ins.top - ins.bottom);
    const pad = (b.maxX - b.minX) * 0.03;
    const s0 = Math.min(w / (b.maxX - b.minX + pad * 2), hh / (b.maxY - b.minY + pad * 2));
    const s = s0 * this.zoom;
    const cx = (b.minX + b.maxX) / 2 + this.panX;
    const cy = (b.minY + b.maxY) / 2 + this.panY;
    return { s, ox: ins.left + w / 2 - cx * s, oy: ins.top + hh / 2 + cy * s };
  }

  /** Screen position (CSS px, relative to the board) of a world point. */
  toScreen(x: number, y: number) {
    const c = this.cam();
    return { x: c.ox + x * c.s, y: c.oy - y * c.s };
  }

  toWorld(px: number, py: number) {
    const c = this.cam();
    return { x: (px - c.ox) / c.s, y: (c.oy - py) / c.s };
  }

  private actorAt(px: number, py: number): ActorView | undefined {
    const w = this.toWorld(px, py);
    const pad = 12 / this.cam().s;
    return this.actors.find((a) => a.alive && (this.clickable?.(a) ?? true) && Math.hypot(a.x - w.x, a.y - w.y) < a.r + pad);
  }

  private bindInput() {
    // Pointers currently down: one drags to pan, two pinch to zoom.
    const down = new Map<number, { sx: number; sy: number }>();
    let drag: { x: number; y: number; px: number; py: number; moved: boolean } | null = null;
    let pinch: { d: number; mx: number; my: number } | null = null;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return { sx: e.clientX - r.left, sy: e.clientY - r.top };
    };
    const pinchState = () => {
      const [a, b] = [...down.values()];
      return { d: Math.hypot(a.sx - b.sx, a.sy - b.sy), mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      const p = local(e);
      down.set(e.pointerId, p);
      this.canvas.setPointerCapture(e.pointerId);
      if (down.size === 2) {
        pinch = pinchState();
        drag = null;
      } else if (down.size === 1) {
        drag = { x: p.sx, y: p.sy, px: this.panX, py: this.panY, moved: false };
      }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (e.pointerType === 'mouse') this.hover = this.toWorld(p.sx, p.sy);
      if (down.has(e.pointerId)) down.set(e.pointerId, p);
      if (pinch && down.size === 2) {
        const now = pinchState();
        const s = this.cam().s;
        this.panX -= (now.mx - pinch.mx) / s;
        this.panY += (now.my - pinch.my) / s;
        if (pinch.d > 0) this.zoomBy(now.d / pinch.d, { sx: now.mx, sy: now.my });
        pinch = now;
        return;
      }
      if (drag) {
        const dx = p.sx - drag.x;
        const dy = p.sy - drag.y;
        if (Math.hypot(dx, dy) > 4) drag.moved = true;
        if (drag.moved) {
          const s = this.cam().s;
          this.panX = drag.px - dx / s;
          this.panY = drag.py + dy / s;
        }
      }
      this.canvas.style.cursor = drag?.moved ? 'grabbing' : (this.onActorClick && this.actorAt(p.sx, p.sy)) || this.zone ? 'pointer' : 'grab';
    });
    const up = (e: PointerEvent) => {
      const p = local(e);
      if (drag && !drag.moved && !pinch) {
        const a = this.onActorClick ? this.actorAt(p.sx, p.sy) : undefined;
        if (a) this.onActorClick?.(a.id);
        else this.onBoardClick?.(this.toWorld(p.sx, p.sy));
      }
      down.delete(e.pointerId);
      if (down.size < 2) pinch = null;
      drag = null;
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('pointerleave', () => (this.hover = null));
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), local(e));
      },
      { passive: false },
    );
    this.canvas.addEventListener('dblclick', () => this.fit());
  }

  // ---- effects ----

  setMood(id: string, mood: Mood, ms = 1400) {
    this.moods.set(id, { mood, until: this.time + ms / 1000 });
  }

  wobbleActor(id: string) {
    this.wobble.set(id, 1);
  }

  flashObstacle(id: string) {
    this.flashes.set(id, 1);
  }

  shake(mag: number) {
    if (!reducedMotion()) this.shakeMag = Math.max(this.shakeMag, mag);
  }

  burst(x: number, y: number, color: string, n = 24, shards = false) {
    const count = reducedMotion() ? Math.ceil(n / 3) : n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * (shards ? 7 : 9);
      const life = 0.5 + Math.random() * 0.7;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + (shards ? 3 : 0), life, max: life, color, size: shards ? 0.12 + Math.random() * 0.2 : 0.06 + Math.random() * 0.08, shard: shards });
    }
  }

  /** A missile blast: the crater joins the arena and debris flies from the rim. */
  blast(c: Crater, color = '#c9cfda') {
    this.craters.push(c);
    this.rings.push({ x: c.x, y: c.y, r: c.r, life: 1 });
    const n = reducedMotion() ? 8 : 26;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.6 + Math.random()) * c.r * 2.2;
      const life = 0.6 + Math.random() * 0.6;
      this.particles.push({ x: c.x + Math.cos(a) * c.r * 0.5, y: c.y + Math.sin(a) * c.r * 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v + c.r, life, max: life, color: i % 3 ? color : '#ffb340', size: c.r * (0.12 + Math.random() * 0.16), shard: true });
    }
    this.shake(0.5);
  }

  /** Teleport: a puff where you were, a sparkle where you land. */
  teleportFx(from: Vec, to: Vec, color: string) {
    this.burst(from.x, from.y, '#c9cfda', 16);
    this.burst(to.x, to.y, color, 22);
    this.rings.push({ x: to.x, y: to.y, r: 2, life: 1 });
  }

  /** Comic impact sticker ("POW!") at a world point. */
  pow(x: number, y: number, word: string, color = '#ffcf33') {
    this.pows.push({ x, y, word, color, life: 0, rot: (Math.random() - 0.5) * 0.4 });
  }

  /** Celebration for big moments only: a finished challenge, lesson or match. */
  confetti() {
    const b = this.bounds;
    const n = reducedMotion() ? 30 : 140;
    for (let i = 0; i < n; i++) {
      const life = 2.2 + Math.random() * 1.6;
      this.particles.push({
        x: b.minX + Math.random() * (b.maxX - b.minX),
        y: b.maxY + Math.random() * 4,
        vx: (Math.random() - 0.5) * 3,
        vy: -(1 + Math.random() * 3),
        life,
        max: life,
        color: CANDY[i % CANDY.length],
        size: 0.35 + Math.random() * 0.25,
        spin: (Math.random() - 0.5) * 12,
        rot: Math.random() * Math.PI,
      });
    }
  }

  /** Animate a projectile along a path; resolves when it reaches the end. */
  fire(pts: number[], color: string, shooterId?: string, shot: ShotId = 'classic'): Promise<void> {
    const cum = [0];
    for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
    const total = cum[cum.length - 1];
    const speed = total / Math.max(0.15, flightSeconds(total, this.bounds));
    return new Promise((done) => this.projectiles.push({ pts, cum, color, dist: 0, speed, done, shooterId, shot }));
  }

  clearTrails() {
    this.trails = [];
  }

  // ---- loop ----

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0);
    this.last = now;
    this.time += dt;
    if (!this.w || !this.h) return;
    this.step(dt);
    this.render();
  };

  private step(dt: number) {
    for (const p of [...this.projectiles]) {
      p.dist += p.speed * dt;
      const total = p.cum[p.cum.length - 1];
      const head = this.headOf(p);
      for (const a of this.actors) {
        if (a.alive && a.id !== p.shooterId && Math.hypot(a.x - head.x, a.y - head.y) < a.r * 4) this.setMood(a.id, 'scared', 300);
      }
      if (!reducedMotion() && Math.random() < 0.25) {
        this.particles.push({ x: head.x, y: head.y, vx: (Math.random() - 0.5) * 1.2, vy: (Math.random() - 0.5) * 1.2, life: 0.35, max: 0.35, color: p.color, size: 0.05 });
      }
      if (p.dist >= total) {
        this.projectiles.splice(this.projectiles.indexOf(p), 1);
        this.trails.push({ pts: p.pts, color: p.color, life: 1, shot: p.shot });
        p.done();
      }
    }
    for (const t of this.trails) t.life -= dt / 2.2;
    this.trails = this.trails.filter((t) => t.life > 0);
    for (const q of this.particles) {
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.spin !== undefined) {
        q.rot = (q.rot ?? 0) + q.spin * dt;
        q.vy = Math.max(q.vy - 2 * dt, -4);
        q.vx += Math.sin(this.time * 3 + q.size * 40) * dt * 2;
      } else {
        q.vy -= (q.shard ? 14 : 3) * dt;
        q.vx *= 1 - dt * 1.5;
      }
    }
    this.particles = this.particles.filter((q) => q.life > 0);
    for (const p of this.pows) p.life += dt / 1.1;
    for (const g of this.rings) g.life -= dt / 0.45;
    this.rings = this.rings.filter((g) => g.life > 0);
    this.pows = this.pows.filter((p) => p.life < 1);
    for (const [k, v] of this.wobble) v - dt * 1.6 <= 0 ? this.wobble.delete(k) : this.wobble.set(k, v - dt * 1.6);
    for (const [k, v] of this.flashes) v - dt * 4 <= 0 ? this.flashes.delete(k) : this.flashes.set(k, v - dt * 4);
    this.shakeMag *= Math.pow(0.02, dt);
    if (this.shakeMag < 0.01) this.shakeMag = 0;
  }

  private headOf(p: Projectile) {
    const d = Math.min(p.dist, p.cum[p.cum.length - 1]);
    let lo = 0;
    let hi = p.cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (p.cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const seg = p.cum[hi] - p.cum[lo] || 1;
    const t = Math.min(1, (d - p.cum[lo]) / seg);
    return { x: p.pts[lo * 2] + (p.pts[hi * 2] - p.pts[lo * 2]) * t, y: p.pts[lo * 2 + 1] + (p.pts[hi * 2 + 1] - p.pts[lo * 2 + 1]) * t, idx: hi };
  }

  private moodOf(a: ActorView): Mood {
    const m = this.moods.get(a.id);
    if (m && m.until > this.time) return m.mood;
    return a.active ? 'aim' : 'idle';
  }

  private render() {
    const ctx = this.ctx;
    let cam = this.cam();
    if (this.shakeMag > 0) {
      cam = { ...cam, ox: cam.ox + (Math.random() - 0.5) * this.shakeMag * 14, oy: cam.oy + (Math.random() - 0.5) * this.shakeMag * 14 };
    }
    drawGrid(ctx, cam, this.bounds, this.w, this.h);
    this.drawObstacles(cam);
    for (const t of this.trails) drawTrail(ctx, cam, t.pts, t.pts.length, t.color, t.shot, Math.min(1, t.life * 1.5));
    if (this.zone) {
      const z = this.zone;
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -this.time * 12;
      ctx.strokeStyle = withAlpha(z.color, 0.9);
      ctx.fillStyle = withAlpha(z.color, 0.08);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cam.ox + z.x * cam.s, cam.oy - z.y * cam.s, z.r * cam.s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const c of this.curves) drawCurve(ctx, cam, c);
    if (this.frame) drawLocalFrame(ctx, cam, this.frame.x, this.frame.y, this.frame.facing, this.frame.color);
    for (const a of this.actors) drawActor(ctx, cam, a, a.alive ? this.moodOf(a) : 'hit', this.time, a.id === this.selectedId || this.marked.has(a.id), this.wobble.get(a.id) ?? 0);

    for (const p of this.projectiles) {
      const head = this.headOf(p);
      // Trail up to the head, ending exactly at it.
      const upTo = [...p.pts.slice(0, head.idx * 2), head.x, head.y];
      drawTrail(ctx, cam, upTo, upTo.length, p.color, p.shot, 1);
      const px = p.pts[Math.max(0, head.idx - 1) * 2];
      const py = p.pts[Math.max(0, head.idx - 1) * 2 + 1];
      const angle = Math.atan2(-(head.y - py), head.x - px);
      drawHead(ctx, cam.ox + head.x * cam.s, cam.oy - head.y * cam.s, angle, p.color, p.shot, this.time);
    }
    for (const q of this.particles) {
      const a = Math.min(1, (q.life / q.max) * 2);
      const px = cam.ox + q.x * cam.s;
      const py = cam.oy - q.y * cam.s;
      if (q.spin !== undefined) {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(q.rot ?? 0);
        ctx.scale(1, Math.cos((q.rot ?? 0) * 1.7));
        ctx.globalAlpha = a;
        ctx.fillStyle = q.color;
        ctx.fillRect(-4, -6, 8, 12);
        ctx.restore();
        continue;
      }
      ctx.fillStyle = withAlpha(q.color, a);
      const r = Math.max(2, (q.size * cam.s) / 2);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const g of this.rings) {
      ctx.strokeStyle = withAlpha('#ffb340', g.life);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cam.ox + g.x * cam.s, cam.oy - g.y * cam.s, g.r * cam.s * (1.6 - g.life * 0.6), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of this.pows) drawPow(ctx, cam.ox + p.x * cam.s, cam.oy - p.y * cam.s, p.word, p.color, p.life, p.rot);
    if (this.opts.readout !== false) {
      this.drawReadout(cam);
      this.drawObstacleLabel(cam);
    }
  }

  /**
   * Breakable obstacles go on a layer, get a scorched rim where each crater
   * meets them, then the craters are cut out. Metal stays on the main canvas.
   */
  private drawObstacles(cam: Cam) {
    const ctx = this.ctx;
    const lc = this.lctx;
    lc.clearRect(0, 0, this.w, this.h);
    const breakable = this.obstacles.filter((o) => !o.solid);
    for (const o of breakable) drawObstacle(lc, cam, o, this.flashes.get(o.id) ?? 0);
    if (this.craters.length) {
      const lw = outline(cam);
      for (const o of breakable) {
        lc.save();
        shapePath(lc, cam, o.shape);
        lc.clip();
        for (const c of this.craters) {
          const px = cam.ox + c.x * cam.s;
          const py = cam.oy - c.y * cam.s;
          const r = c.r * cam.s;
          lc.strokeStyle = 'rgba(30, 34, 53, 0.22)';
          lc.lineWidth = lw * 2 + 8;
          lc.beginPath();
          lc.arc(px, py, r, 0, Math.PI * 2);
          lc.stroke();
          lc.strokeStyle = '#1e2235';
          lc.lineWidth = lw * 2;
          lc.stroke();
        }
        lc.restore();
      }
      lc.globalCompositeOperation = 'destination-out';
      lc.fillStyle = '#000';
      for (const c of this.craters) {
        lc.beginPath();
        lc.arc(cam.ox + c.x * cam.s, cam.oy - c.y * cam.s, c.r * cam.s, 0, Math.PI * 2);
        lc.fill();
      }
      lc.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(this.layer, 0, 0, this.w, this.h);
    for (const o of this.obstacles) if (o.solid) drawObstacle(ctx, cam, o, this.flashes.get(o.id) ?? 0);
  }

  /** Hovering an obstacle names it and says whether missiles can blast it. */
  private drawObstacleLabel(cam: Cam) {
    const hv = this.hover;
    if (!hv) return;
    const inHole = this.craters.some((c) => Math.hypot(hv.x - c.x, hv.y - c.y) < c.r);
    const o = this.obstacles.find((q) => distToShape(hv.x, hv.y, q.shape) <= 0.05 && (q.solid || !inHole));
    if (!o) return;
    const name = o.solid ? 'Metal block' : o.kind[0].toUpperCase() + o.kind.slice(1);
    const text = o.solid ? `${name} · can't be broken` : `${name} · missiles blast holes in it`;
    const ctx = this.ctx;
    ctx.font = `600 13px ${FONT_DISPLAY}`;
    const tw = ctx.measureText(text).width;
    const px = Math.min(cam.ox + hv.x * cam.s + 14, this.w - tw - 30);
    const py = Math.max(cam.oy - hv.y * cam.s - 36, 8);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(px, py, tw + 20, 26, 9);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px + 10, py + 13.5);
  }

  private drawReadout(cam: Cam) {
    const hv = this.hover;
    if (!hv) return;
    const ctx = this.ctx;
    const px = cam.ox + hv.x * cam.s;
    const py = cam.oy - hv.y * cam.s;
    ctx.strokeStyle = 'rgba(30, 34, 53, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, this.h);
    ctx.moveTo(0, py);
    ctx.lineTo(this.w, py);
    ctx.stroke();
    let text = `(${fmt(hv.x, 1)}, ${fmt(hv.y, 1)})`;
    if (this.frame) {
      const fx = (hv.x - this.frame.x) * this.frame.facing;
      const fy = hv.y - this.frame.y;
      text = `${fmt(fx, 1)} ahead, ${fmt(Math.abs(fy), 1)} ${fy >= 0 ? 'up' : 'down'} from you`;
    }
    ctx.font = `500 13px ${FONT_DISPLAY}`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(12, 12, tw + 20, 28, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 22, 26.5);
  }
}
