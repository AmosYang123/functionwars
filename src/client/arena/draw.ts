import { shapeAabb, shapeCenter } from '../../engine/geometry.ts';
import { rng } from '../../engine/rng.ts';
import type { Bounds, Facing, Obstacle, Shape } from '../../engine/types.ts';
import type { FaceId, HatId } from '../../net/look.ts';
import { DUMMY_COLOR, FONT_DISPLAY, FONT_LOGO, INK, mix, mixHex, withAlpha } from '../palette.ts';
import { drawEyes, drawFaceExtras, drawHat } from './skins.ts';

/** World→screen: sx = ox + wx·s, sy = oy − wy·s. */
export interface Cam {
  s: number;
  ox: number;
  oy: number;
}

export type Mood = 'idle' | 'aim' | 'scared' | 'hit' | 'happy' | 'sad';

export interface ActorView {
  id: string;
  kind: 'player' | 'dummy';
  x: number;
  y: number;
  r: number;
  color: string;
  name: string;
  alive: boolean;
  lives?: number;
  maxLives?: number;
  facing?: Facing;
  /** The player currently aiming. */
  active?: boolean;
  /** Cosmetics; players without one wear the classic face and no hat. */
  look?: { face: FaceId; hat: HatId };
  /** Drawn see-through: where a teleport will land. */
  ghost?: boolean;
}

export type CurveStyle = 'preview' | 'ghost' | 'struck' | 'raw';

export interface CurveView {
  pts: number[];
  color: string;
  style: CurveStyle;
  /** Draw an impact marker at the end. */
  endRing?: boolean;
}

const sx = (c: Cam, x: number) => c.ox + x * c.s;
const sy = (c: Cam, y: number) => c.oy - y * c.s;
export const outline = (c: Cam) => Math.max(1.5, Math.min(2.2, c.s * 0.08));

/** Nice grid spacing (1, 2 or 5 × 10ⁿ) so major lines sit roughly `px` pixels apart at any zoom. */
function gridStep(scale: number, px: number): { major: number; minor: number } {
  const raw = px / scale;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p <= 1 ? 1 : raw / p <= 2 ? 2 : raw / p <= 5 ? 5 : 10;
  const major = m * p;
  return { major, minor: major / (m === 2 ? 4 : 5) };
}

function tickLabel(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(0).replace('e+', 'e');
  return String(Number(v.toPrecision(10)));
}

/**
 * An endless plane like a digital grapher. The play area (where shots fly)
 * is the white rectangle; outside it the grid continues on a tinted ground.
 */
export function drawGrid(ctx: CanvasRenderingContext2D, cam: Cam, b: Bounds, w: number, h: number) {
  const x0 = sx(cam, b.minX);
  const x1 = sx(cam, b.maxX);
  const y0 = sy(cam, b.maxY);
  const y1 = sy(cam, b.minY);
  ctx.fillStyle = '#eef3f9';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

  const vx0 = -cam.ox / cam.s;
  const vx1 = (w - cam.ox) / cam.s;
  const vy0 = (cam.oy - h) / cam.s;
  const vy1 = cam.oy / cam.s;
  const { major, minor } = gridStep(cam.s, 110);
  const lines = (step: number, color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = Math.ceil(vx0 / step); i * step <= vx1; i++) {
      const px = Math.round(sx(cam, i * step)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (let i = Math.ceil(vy0 / step); i * step <= vy1; i++) {
      const py = Math.round(sy(cam, i * step)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();
  };
  lines(minor, 'rgba(120, 150, 190, 0.12)', 1);
  lines(major, 'rgba(110, 140, 185, 0.28)', 1.25);

  const ax = sx(cam, 0);
  const ay = sy(cam, 0);
  ctx.strokeStyle = withAlpha(INK, 0.6);
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  if (ax >= 0 && ax <= w) {
    ctx.moveTo(ax, 0);
    ctx.lineTo(ax, h);
  }
  if (ay >= 0 && ay <= h) {
    ctx.moveTo(0, ay);
    ctx.lineTo(w, ay);
  }
  ctx.stroke();

  // Edge of the play area: shots stop here.
  ctx.strokeStyle = 'rgba(30, 34, 53, 0.35)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.setLineDash([]);

  // Axis numbers, pinned to the edge when an axis scrolls out of view (like Desmos).
  ctx.font = `700 12px ${FONT_DISPLAY}`;
  ctx.lineJoin = 'round';
  const text = (t: string, x: number, y: number) => {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 4;
    ctx.strokeText(t, x, y);
    ctx.fillStyle = '#6b7189';
    ctx.fillText(t, x, y);
  };
  const labelY = Math.min(Math.max(ay + 6, 6), h - 20);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = Math.ceil(vx0 / major); i * major <= vx1; i++) {
    if (i !== 0) text(tickLabel(i * major), sx(cam, i * major), labelY);
  }
  // Pinned to the left edge, numbers grow rightward so they never clip.
  const pinnedLeft = ax - 7 < 40;
  const labelX = pinnedLeft ? 6 : Math.min(ax - 7, w - 6);
  ctx.textAlign = pinnedLeft ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  for (let i = Math.ceil(vy0 / major); i * major <= vy1; i++) {
    if (i !== 0) text(tickLabel(i * major), labelX, sy(cam, i * major));
  }
}

export function shapePath(ctx: CanvasRenderingContext2D, cam: Cam, s: Shape) {
  ctx.beginPath();
  if (s.kind === 'circle') {
    ctx.arc(sx(cam, s.x), sy(cam, s.y), s.r * cam.s, 0, Math.PI * 2);
  } else {
    s.pts.forEach((p, i) => (i ? ctx.lineTo(sx(cam, p.x), sy(cam, p.y)) : ctx.moveTo(sx(cam, p.x), sy(cam, p.y))));
    ctx.closePath();
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Toy-block materials: brick walls, stone boulders, gem triangles, gold stars, riveted metal for unbreakables. */
const MATERIAL: Record<Obstacle['kind'] | 'metal', string> = {
  wall: '#e8703a',
  boulder: '#a7b3c6',
  triangle: '#2bbfa4',
  star: '#ffc93c',
  metal: '#6b7489',
};

export function drawObstacle(ctx: CanvasRenderingContext2D, cam: Cam, o: Obstacle, flash: number) {
  const box = shapeAabb(o.shape);
  const c = shapeCenter(o.shape);
  const size = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  let base = MATERIAL[o.solid ? 'metal' : o.kind];
  if (flash > 0) base = mixHex(base, '#ffffff', flash * 0.7);

  // Cartoon shading: light top, darker bottom.
  const top = sy(cam, box.maxY);
  const bottom = sy(cam, box.minY);
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, mix(base, '#ffffff', 0.35));
  g.addColorStop(0.45, base);
  g.addColorStop(1, mix(base, '#1e2235', 0.18));
  shapePath(ctx, cam, o.shape);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  shapePath(ctx, cam, o.shape);
  ctx.clip();
  const r = rng(hash(o.id));
  if (o.solid) {
    // Rivets
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    const pts = o.shape.kind === 'poly' ? o.shape.pts : Array.from({ length: 6 }, (_, i) => ({ x: c.x + Math.cos(i) * size * 0.32, y: c.y + Math.sin(i) * size * 0.32 }));
    for (const p of pts) {
      const ix = c.x + (p.x - c.x) * 0.8;
      const iy = c.y + (p.y - c.y) * 0.8;
      ctx.beginPath();
      ctx.arc(sx(cam, ix), sy(cam, iy), Math.max(1.5, cam.s * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (o.kind === 'wall') {
    // Brick courses with staggered joints
    ctx.strokeStyle = 'rgba(255, 226, 205, 0.75)';
    ctx.lineWidth = Math.max(1, cam.s * 0.05);
    ctx.beginPath();
    // Courses stay at least ~9px tall on screen, whatever the zoom.
    const course = Math.max(0.5, 9 / cam.s);
    let row = 0;
    for (let y = Math.floor(box.minY / course) * course; y < box.maxY; y += course, row++) {
      ctx.moveTo(sx(cam, box.minX - 1), sy(cam, y));
      ctx.lineTo(sx(cam, box.maxX + 1), sy(cam, y));
      for (let x = Math.floor(box.minX / (2 * course)) * 2 * course + (row % 2) * course; x < box.maxX + 1; x += 2 * course) {
        ctx.moveTo(sx(cam, x), sy(cam, y));
        ctx.lineTo(sx(cam, x), sy(cam, y + course));
      }
    }
    ctx.stroke();
  } else if (o.kind === 'boulder') {
    ctx.fillStyle = 'rgba(30, 34, 53, 0.12)';
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * size * 0.35;
      ctx.beginPath();
      ctx.arc(sx(cam, c.x + Math.cos(a) * d), sy(cam, c.y + Math.sin(a) * d), Math.max(2, cam.s * size * 0.06 * (0.6 + r())), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Gem/star sparkle
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    const px = sx(cam, c.x - size * 0.12);
    const py = sy(cam, c.y + size * 0.14);
    const k = Math.max(2.5, cam.s * size * 0.07);
    ctx.beginPath();
    ctx.moveTo(px, py - k);
    ctx.lineTo(px + k * 0.3, py - k * 0.3);
    ctx.lineTo(px + k, py);
    ctx.lineTo(px + k * 0.3, py + k * 0.3);
    ctx.lineTo(px, py + k);
    ctx.lineTo(px - k * 0.3, py + k * 0.3);
    ctx.lineTo(px - k, py);
    ctx.lineTo(px - k * 0.3, py - k * 0.3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  shapePath(ctx, cam, o.shape);
  ctx.strokeStyle = INK;
  ctx.lineWidth = outline(cam);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function drawCurve(ctx: CanvasRenderingContext2D, cam: Cam, c: CurveView, alpha = 1, upTo?: number) {
  const pts = c.pts;
  const n = upTo ?? pts.length;
  if (n < 4) return;
  if (c.style === 'preview' || c.style === 'ghost') {
    // Slingshot-style aiming dots, evenly spaced on screen
    const gap = c.style === 'preview' ? 13 : 11;
    const r = c.style === 'preview' ? 3.4 : 2.6;
    let carry = 0;
    ctx.fillStyle = withAlpha(c.color, (c.style === 'ghost' ? 0.45 : 1) * alpha);
    if (c.style === 'preview') {
      ctx.strokeStyle = withAlpha('#ffffff', alpha);
      ctx.lineWidth = 1.5;
    }
    for (let i = 2; i < n; i += 2) {
      const ax = sx(cam, pts[i - 2]);
      const ay = sy(cam, pts[i - 1]);
      const bx = sx(cam, pts[i]);
      const by = sy(cam, pts[i + 1]);
      const seg = Math.hypot(bx - ax, by - ay);
      let d = gap - carry;
      while (d <= seg) {
        const t = d / seg;
        ctx.beginPath();
        ctx.arc(ax + (bx - ax) * t, ay + (by - ay) * t, r, 0, Math.PI * 2);
        ctx.fill();
        if (c.style === 'preview') ctx.stroke();
        d += gap;
      }
      carry = seg - (d - gap);
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(sx(cam, pts[0]), sy(cam, pts[1]));
    for (let i = 2; i < n; i += 2) ctx.lineTo(sx(cam, pts[i]), sy(cam, pts[i + 1]));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (c.style === 'raw') {
      ctx.setLineDash([5, 7]);
      ctx.strokeStyle = withAlpha('#8a91a8', 0.8 * alpha);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = withAlpha(INK, alpha);
      ctx.lineWidth = 5.5;
      ctx.stroke();
      ctx.strokeStyle = withAlpha(c.color, alpha);
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }
  }

  if (c.endRing) {
    const ex = sx(cam, pts[n - 2]);
    const ey = sy(cam, pts[n - 1]);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ex, ey, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = withAlpha(c.color, alpha);
    ctx.beginPath();
    ctx.arc(ex, ey, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The shooter's forward arrow, so "x" in the input has a place on the board. */
export function drawLocalFrame(ctx: CanvasRenderingContext2D, cam: Cam, x: number, y: number, facing: Facing, color: string) {
  const ox = sx(cam, x);
  const oy = sy(cam, y);
  const start = 0.95 * cam.s + 4;
  const len = Math.max(2.3 * cam.s, 40);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(ox + facing * start, oy);
  ctx.lineTo(ox + facing * len, oy);
  ctx.moveTo(ox + facing * (len - 7), oy - 6);
  ctx.lineTo(ox + facing * len, oy);
  ctx.lineTo(ox + facing * (len - 7), oy + 6);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.font = `italic 600 14px ${FONT_DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  ctx.fillText('x', ox + facing * (len + 11), oy);
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = INK) {
  ctx.font = `600 13px ${FONT_DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export function drawActor(ctx: CanvasRenderingContext2D, cam: Cam, a: ActorView, mood: Mood, t: number, selected: boolean, wobble: number) {
  const cx = sx(cam, a.x);
  const cy0 = sy(cam, a.y);
  const R = Math.max(a.r * cam.s, 8);
  const seed = hash(a.id);
  const hop = a.alive && a.kind === 'player' && a.active ? Math.max(0, Math.sin(t * 3 + (seed % 7))) * 1.5 : 0;
  const cy = cy0 - hop;
  const squash = wobble > 0 ? Math.sin(wobble * 30) * wobble * 0.22 : 0;
  const color = a.alive ? (a.kind === 'dummy' ? DUMMY_COLOR : a.color) : '#b8bfcc';
  const ow = Math.max(1.5, R * 0.11);
  ctx.save();
  if (a.ghost) ctx.globalAlpha = 0.45;

  // Ground shadow stays put while the body hops.
  ctx.fillStyle = 'rgba(30, 34, 53, 0.14)';
  ctx.beginPath();
  ctx.ellipse(cx, cy0 + R * 0.95, R * 0.75 - hop * 0.3, R * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  if (selected) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -t * 18;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1 + squash, 1 - squash);
  if (a.kind === 'dummy' && a.alive) {
    ['#ffffff', color, '#ffffff', color].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, R * (1 - i * 0.24), 0, Math.PI * 2);
      ctx.fill();
    });
  } else {
    const g = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R);
    g.addColorStop(0, mix(color, '#ffffff', 0.35));
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    // Shine
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.ellipse(-R * 0.42, -R * 0.5, R * 0.2, R * 0.12, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.stroke();
  if (a.kind === 'player' || !a.alive) drawFace(ctx, R, a, a.alive ? mood : 'hit', t, seed, color);
  if (a.kind === 'player' && a.look) drawHat(ctx, R, a.look.hat, color, t);
  ctx.restore();

  // "Your turn" marker bouncing over the active player
  if (a.active && a.alive && a.kind === 'player') {
    const hatRoom = a.look && a.look.hat !== 'none' ? R * 1.1 : 0;
    const by = cy - R - 12 - hatRoom - Math.abs(Math.sin(t * 4)) * 5;
    ctx.beginPath();
    ctx.moveTo(cx - 8, by - 10);
    ctx.lineTo(cx + 8, by - 10);
    ctx.lineTo(cx, by);
    ctx.closePath();
    ctx.fillStyle = '#ffcf33';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  if (cam.s > 1.5) {
    label(ctx, a.name, cx, cy0 + R + 8, a.alive ? INK : '#9aa1b5');
    if (a.maxLives && a.maxLives > 1) {
      const d = 7;
      let px = cx - (a.maxLives * (d + 4) - 4) / 2 + d / 2;
      for (let i = 0; i < a.maxLives; i++) {
        ctx.fillStyle = i < (a.lives ?? 0) ? '#ff4f9a' : '#e1e6ef';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, cy0 + R + 30, d / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        px += d + 4;
      }
    }
  }
  ctx.restore();
}

function drawFace(ctx: CanvasRenderingContext2D, R: number, a: ActorView, mood: Mood, t: number, seed: number, body: string) {
  const face = a.look?.face ?? 'classic';
  const look = (a.facing ?? 1) * R * 0.08;
  const eyeY = -R * 0.1;
  const eyeDX = R * 0.32;
  const blink = (t + (seed % 997) / 100) % 4.2 < 0.12 && mood !== 'hit';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Cheeks
  if (mood !== 'hit') {
    ctx.fillStyle = 'rgba(255, 120, 150, 0.28)';
    for (const ex of [-R * 0.55, R * 0.55]) {
      ctx.beginPath();
      ctx.ellipse(ex, R * 0.22, R * 0.14, R * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (mood === 'hit') {
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.8, R * 0.11);
    for (const ex of [-eyeDX, eyeDX]) {
      const s = R * 0.13;
      ctx.beginPath();
      ctx.moveTo(ex - s, eyeY - s);
      ctx.lineTo(ex + s, eyeY + s);
      ctx.moveTo(ex + s, eyeY - s);
      ctx.lineTo(ex - s, eyeY + s);
      ctx.stroke();
    }
  } else if (!drawEyes(ctx, R, face, look, blink, body)) {
    for (const ex of [-eyeDX, eyeDX]) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, R * 0.06);
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, R * 0.19, blink ? R * 0.04 : mood === 'scared' ? R * 0.25 : R * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (!blink) {
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(ex + look, eyeY + (mood === 'sad' ? R * 0.06 : R * 0.02), R * (mood === 'scared' ? 0.07 : 0.11), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ex + look - R * 0.04, eyeY - R * 0.04, R * 0.035, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    drawFaceExtras(ctx, R, face);
  }
  if (mood === 'aim' && face !== 'shades') {
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, R * 0.09);
    ctx.beginPath();
    ctx.moveTo(-eyeDX - R * 0.2, eyeY - R * 0.36);
    ctx.lineTo(-eyeDX + R * 0.16, eyeY - R * 0.27);
    ctx.moveTo(eyeDX + R * 0.2, eyeY - R * 0.36);
    ctx.lineTo(eyeDX - R * 0.16, eyeY - R * 0.27);
    ctx.stroke();
  }
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = Math.max(1.6, R * 0.1);
  const my = R * 0.38;
  ctx.beginPath();
  switch (mood) {
    case 'happy':
      ctx.arc(0, my - R * 0.1, R * 0.26, 0.05 * Math.PI, 0.95 * Math.PI);
      ctx.closePath();
      ctx.fill();
      return;
    case 'scared':
      ctx.ellipse(0, my, R * 0.09, R * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'hit':
      for (let i = 0; i <= 6; i++) {
        const x = -R * 0.24 + (i * R * 0.48) / 6;
        const y = my + (i % 2 ? R * 0.06 : -R * 0.03);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      break;
    case 'sad':
      ctx.arc(0, my + R * 0.16, R * 0.17, 1.2 * Math.PI, 1.8 * Math.PI);
      break;
    case 'aim':
      ctx.moveTo(-R * 0.15, my);
      ctx.lineTo(R * 0.15, my - R * 0.04);
      break;
    default:
      ctx.arc(0, my - R * 0.13, R * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
  }
  ctx.stroke();
}

/** Comic-book impact sticker: spiky burst with a word. `k` runs 0→1 over its life. */
export function drawPow(ctx: CanvasRenderingContext2D, x: number, y: number, word: string, color: string, k: number, rot: number) {
  const pop = k < 0.2 ? 1 - Math.pow(1 - k / 0.2, 3) * 1.0 + Math.sin((k / 0.2) * Math.PI) * 0.25 : 1;
  const alpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y - k * 18);
  ctx.rotate(rot);
  ctx.scale(pop, pop);
  ctx.font = `700 18px ${FONT_LOGO}`;
  const w = ctx.measureText(word).width;
  const R = w / 2 + 18;
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = i % 2 ? R * 0.72 : R;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r * 0.62;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeText(word, 0, 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(word, 0, 1);
  ctx.restore();
}
