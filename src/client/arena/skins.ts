import type { FaceId, HatId, ShotId } from '../../net/look.ts';
import { INK, mix, mixHex, withAlpha } from '../palette.ts';
import type { Cam } from './draw.ts';

/**
 * Cosmetic drawing: faces, hats and shot styles. Purely visual: a styled
 * trail always follows the exact path, so the preview never lies.
 */

// ---------- faces (actor-local coords, origin at the body center) ----------

/** Eyes for every face but the classic one. Returns false when the classic eyes should be drawn. */
export function drawEyes(ctx: CanvasRenderingContext2D, R: number, face: FaceId, look: number, blink: boolean, body: string): boolean {
  const eyeY = -R * 0.1;
  const dx = R * 0.32;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (face) {
    case 'shades': {
      ctx.fillStyle = INK;
      for (const ex of [-dx, dx]) {
        ctx.beginPath();
        ctx.roundRect(ex - R * 0.24, eyeY - R * 0.15, R * 0.48, R * 0.3, R * 0.1);
        ctx.fill();
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.2, R * 0.08);
      ctx.beginPath();
      ctx.moveTo(-dx + R * 0.2, eyeY - R * 0.08);
      ctx.lineTo(dx - R * 0.2, eyeY - R * 0.08);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = Math.max(1, R * 0.05);
      for (const ex of [-dx, dx]) {
        ctx.beginPath();
        ctx.moveTo(ex - R * 0.14, eyeY - R * 0.06);
        ctx.lineTo(ex - R * 0.04, eyeY - R * 0.1);
        ctx.stroke();
      }
      return true;
    }
    case 'cyclops': {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, R * 0.07);
      ctx.beginPath();
      ctx.ellipse(0, eyeY, R * 0.32, blink ? R * 0.05 : R * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (!blink) {
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(look * 1.5, eyeY + R * 0.02, R * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(look * 1.5 - R * 0.05, eyeY - R * 0.05, R * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      return true;
    }
    case 'robot': {
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, R * 0.06);
      for (const ex of [-dx, dx]) {
        ctx.fillStyle = '#a5f3fc';
        ctx.beginPath();
        ctx.roundRect(ex - R * 0.18, eyeY - (blink ? R * 0.03 : R * 0.16), R * 0.36, blink ? R * 0.06 : R * 0.32, R * 0.05);
        ctx.fill();
        ctx.stroke();
        if (!blink) {
          ctx.fillStyle = INK;
          ctx.fillRect(ex + look - R * 0.06, eyeY - R * 0.06, R * 0.12, R * 0.12);
        }
      }
      return true;
    }
    case 'sleepy': {
      for (const ex of [-dx, dx]) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1, R * 0.06);
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, R * 0.19, R * 0.2, 0, 0, Math.PI);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(ex + look, eyeY + R * 0.09, R * 0.08, 0, Math.PI * 2);
        ctx.fill();
        // Heavy lid
        ctx.fillStyle = mix(body, INK, 0.15);
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, R * 0.21, R * 0.09, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      return true;
    }
    case 'starry': {
      for (const ex of [-dx, dx]) {
        star(ctx, ex, eyeY, R * (blink ? 0.12 : 0.24), 5);
        ctx.fillStyle = '#ffcf33';
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1, R * 0.06);
        ctx.stroke();
      }
      return true;
    }
    default:
      return false;
  }
}

/** Extras drawn over the classic eyes: big glasses, kitty nose and whiskers. */
export function drawFaceExtras(ctx: CanvasRenderingContext2D, R: number, face: FaceId) {
  const eyeY = -R * 0.1;
  const dx = R * 0.32;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  if (face === 'nerd') {
    ctx.lineWidth = Math.max(1.2, R * 0.08);
    ctx.beginPath();
    for (const ex of [-dx, dx]) {
      ctx.moveTo(ex + R * 0.26, eyeY);
      ctx.arc(ex, eyeY, R * 0.26, 0, Math.PI * 2);
    }
    ctx.moveTo(-dx + R * 0.26, eyeY);
    ctx.lineTo(dx - R * 0.26, eyeY);
    ctx.stroke();
  } else if (face === 'cat') {
    ctx.fillStyle = '#ff8fb1';
    ctx.lineWidth = Math.max(1, R * 0.05);
    ctx.beginPath();
    ctx.moveTo(-R * 0.08, R * 0.12);
    ctx.lineTo(R * 0.08, R * 0.12);
    ctx.lineTo(0, R * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = Math.max(0.8, R * 0.04);
    ctx.beginPath();
    for (const s of [-1, 1]) {
      for (const k of [-1, 0, 1]) {
        ctx.moveTo(s * R * 0.3, R * 0.2 + k * R * 0.06);
        ctx.lineTo(s * R * 0.78, R * 0.14 + k * R * 0.14);
      }
    }
    ctx.stroke();
  }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, n: number, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n;
    const rr = i % 2 ? r * 0.45 : r;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

// ---------- hats ----------

export function drawHat(ctx: CanvasRenderingContext2D, R: number, hat: HatId, color: string, t: number) {
  if (hat === 'none') return;
  const ow = Math.max(1.3, R * 0.09);
  const top = -R;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow;
  const shape = (fill: string, path: () => void) => {
    ctx.beginPath();
    path();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  };
  switch (hat) {
    case 'crown':
      shape('#ffcf33', () => {
        ctx.moveTo(-R * 0.55, top + R * 0.12);
        ctx.lineTo(-R * 0.62, top - R * 0.5);
        ctx.lineTo(-R * 0.3, top - R * 0.2);
        ctx.lineTo(0, top - R * 0.62);
        ctx.lineTo(R * 0.3, top - R * 0.2);
        ctx.lineTo(R * 0.62, top - R * 0.5);
        ctx.lineTo(R * 0.55, top + R * 0.12);
        ctx.closePath();
      });
      ctx.fillStyle = '#ff4f9a';
      ctx.beginPath();
      ctx.arc(0, top - R * 0.08, R * 0.09, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'party':
      ctx.save();
      ctx.rotate(0.25);
      shape('#ffcf33', () => {
        ctx.moveTo(-R * 0.4, top + R * 0.12);
        ctx.lineTo(0, top - R * 0.95);
        ctx.lineTo(R * 0.4, top + R * 0.12);
        ctx.closePath();
      });
      ctx.strokeStyle = '#ff4f9a';
      ctx.lineWidth = ow * 1.2;
      ctx.beginPath();
      ctx.moveTo(-R * 0.26, top - R * 0.2);
      ctx.lineTo(R * 0.14, top - R * 0.5);
      ctx.moveTo(-R * 0.08, top - R * 0.62);
      ctx.lineTo(R * 0.3, top - R * 0.1);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = ow;
      shape('#2f7cf6', () => ctx.arc(0, top - R * 0.98, R * 0.14, 0, Math.PI * 2));
      ctx.restore();
      return;
    case 'tophat':
      shape(INK, () => ctx.roundRect(-R * 0.36, top - R * 0.85, R * 0.72, R * 0.9, R * 0.06));
      ctx.fillStyle = color;
      ctx.fillRect(-R * 0.36 + ow / 2, top - R * 0.18, R * 0.72 - ow, R * 0.16);
      shape(INK, () => ctx.ellipse(0, top + R * 0.06, R * 0.62, R * 0.12, 0, 0, Math.PI * 2));
      return;
    case 'wizard':
      shape('#5b3fd1', () => {
        ctx.moveTo(-R * 0.55, top + R * 0.15);
        ctx.quadraticCurveTo(-R * 0.1, top - R * 0.6, R * 0.35, top - R * 1.1);
        ctx.quadraticCurveTo(R * 0.15, top - R * 0.4, R * 0.55, top + R * 0.15);
        ctx.closePath();
      });
      star(ctx, -R * 0.05, top - R * 0.2, R * 0.13, 5);
      ctx.fillStyle = '#ffcf33';
      ctx.fill();
      return;
    case 'propeller': {
      shape(color === '#2f7cf6' ? '#ff4f9a' : '#2f7cf6', () => ctx.arc(0, top + R * 0.12, R * 0.48, Math.PI, 0));
      ctx.beginPath();
      ctx.moveTo(0, top - R * 0.36);
      ctx.lineTo(0, top - R * 0.62);
      ctx.stroke();
      const spin = Math.cos(t * 18);
      shape('#ffcf33', () => ctx.ellipse(0, top - R * 0.64, R * 0.55 * Math.abs(spin) + R * 0.05, R * 0.09, 0, 0, Math.PI * 2));
      return;
    }
    case 'ears':
      for (const s of [-1, 1]) {
        shape(color, () => {
          ctx.moveTo(s * R * 0.75, top + R * 0.45);
          ctx.lineTo(s * R * 0.62, top - R * 0.32);
          ctx.lineTo(s * R * 0.18, top + R * 0.12);
          ctx.closePath();
        });
        ctx.fillStyle = '#ff8fb1';
        ctx.beginPath();
        ctx.moveTo(s * R * 0.62, top + R * 0.3);
        ctx.lineTo(s * R * 0.58, top - R * 0.1);
        ctx.lineTo(s * R * 0.34, top + R * 0.14);
        ctx.closePath();
        ctx.fill();
      }
      return;
    case 'halo': {
      const bob = Math.sin(t * 3) * R * 0.05;
      ctx.strokeStyle = INK;
      ctx.lineWidth = ow * 2.6;
      ctx.beginPath();
      ctx.ellipse(0, top - R * 0.35 + bob, R * 0.5, R * 0.14, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#ffdf5e';
      ctx.lineWidth = ow * 1.3;
      ctx.stroke();
      return;
    }
    case 'chef':
      shape('#ffffff', () => {
        ctx.arc(-R * 0.3, top - R * 0.38, R * 0.26, Math.PI * 0.6, Math.PI * 1.7);
        ctx.arc(0, top - R * 0.55, R * 0.3, Math.PI * 1.1, Math.PI * 1.9);
        ctx.arc(R * 0.3, top - R * 0.38, R * 0.26, Math.PI * 1.3, Math.PI * 0.4);
        ctx.lineTo(R * 0.38, top + R * 0.1);
        ctx.lineTo(-R * 0.38, top + R * 0.1);
        ctx.closePath();
      });
      return;
    case 'viking':
      for (const s of [-1, 1]) {
        shape('#fff3c4', () => {
          ctx.moveTo(s * R * 0.42, top + R * 0.05);
          ctx.quadraticCurveTo(s * R * 0.95, top - R * 0.05, s * R * 0.9, top - R * 0.6);
          ctx.quadraticCurveTo(s * R * 0.72, top - R * 0.2, s * R * 0.36, top - R * 0.2);
          ctx.closePath();
        });
      }
      shape('#a7b3c6', () => ctx.arc(0, top + R * 0.2, R * 0.55, Math.PI, 0));
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.beginPath();
      ctx.arc(-R * 0.2, top - R * 0.1, R * 0.08, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'sprout':
      ctx.strokeStyle = '#15803d';
      ctx.lineWidth = ow * 1.1;
      ctx.beginPath();
      ctx.moveTo(0, top + R * 0.05);
      ctx.quadraticCurveTo(R * 0.05, top - R * 0.3, 0, top - R * 0.45);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = ow;
      for (const s of [-1, 1]) {
        shape('#22b35e', () => ctx.ellipse(s * R * 0.22, top - R * 0.5, R * 0.24, R * 0.11, s * -0.5, 0, Math.PI * 2));
      }
      return;
    case 'bow':
      for (const s of [-1, 1]) {
        shape('#ff4f9a', () => {
          ctx.moveTo(R * 0.45, top + R * 0.1);
          ctx.lineTo(R * 0.45 + s * R * 0.38, top - R * 0.2);
          ctx.lineTo(R * 0.45 + s * R * 0.38, top + R * 0.36);
          ctx.closePath();
        });
      }
      shape('#ff8fb1', () => ctx.arc(R * 0.45, top + R * 0.08, R * 0.12, 0, Math.PI * 2));
      return;
  }
}

// ---------- shots ----------

interface Sample {
  x: number;
  y: number;
  /** Unit normal on screen, for wiggles and side-by-side stripes. */
  nx: number;
  ny: number;
  /** Screen distance along the path. */
  d: number;
}

/** Screen-space samples every `gap` px along the first n coords of a world path. */
function samples(cam: Cam, pts: number[], n: number, gap: number): Sample[] {
  const out: Sample[] = [];
  let d = 0;
  let next = 0;
  for (let i = 2; i < n; i += 2) {
    const ax = cam.ox + pts[i - 2] * cam.s;
    const ay = cam.oy - pts[i - 1] * cam.s;
    const bx = cam.ox + pts[i] * cam.s;
    const by = cam.oy - pts[i + 1] * cam.s;
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg === 0) continue;
    const nx = -(by - ay) / seg;
    const ny = (bx - ax) / seg;
    while (next <= d + seg) {
      const t = (next - d) / seg;
      out.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, nx, ny, d: next });
      next += gap;
    }
    d += seg;
  }
  return out;
}

function line(ctx: CanvasRenderingContext2D, cam: Cam, pts: number[], n: number) {
  ctx.beginPath();
  ctx.moveTo(cam.ox + pts[0] * cam.s, cam.oy - pts[1] * cam.s);
  for (let i = 2; i < n; i += 2) ctx.lineTo(cam.ox + pts[i] * cam.s, cam.oy - pts[i + 1] * cam.s);
}

const RAINBOW = ['#f0483e', '#ff8a1f', '#ffcf33', '#22b35e', '#2f7cf6', '#8b5cf6'];

/** A fired shot's trail, up to coordinate index n. `alpha` fades old trails. */
export function drawTrail(ctx: CanvasRenderingContext2D, cam: Cam, pts: number[], n: number, color: string, style: ShotId, alpha: number) {
  if (n < 4) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const thin = () => {
    line(ctx, cam, pts, n);
    ctx.strokeStyle = withAlpha(color, 0.55);
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  switch (style) {
    case 'rocket': {
      thin();
      for (const s of samples(cam, pts, n, 14)) {
        const k = (s.d / 14) % 3;
        ctx.fillStyle = 'rgba(160, 170, 190, 0.55)';
        ctx.beginPath();
        ctx.arc(s.x + s.nx * (k - 1) * 2, s.y + s.ny * (k - 1) * 2, 3.5 + k, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'spaghetti': {
      const ss = samples(cam, pts, n, 3);
      ctx.beginPath();
      ss.forEach((s, i) => {
        const w = Math.sin(s.d * 0.22) * 4.5;
        i ? ctx.lineTo(s.x + s.nx * w, s.y + s.ny * w) : ctx.moveTo(s.x, s.y);
      });
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5.5;
      ctx.stroke();
      ctx.strokeStyle = '#f7d774';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      // Meatballs every so often
      for (const s of samples(cam, pts, n, 70).slice(1)) {
        ctx.fillStyle = '#8b4a2b';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'rainbow':
      line(ctx, cam, pts, n);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 13;
      ctx.stroke();
      RAINBOW.forEach((c, i) => {
        ctx.strokeStyle = c;
        ctx.lineWidth = 11 - i * 1.8;
        ctx.stroke();
      });
      break;
    case 'comet': {
      const ss = samples(cam, pts, n, 4);
      const last = ss.length ? ss[ss.length - 1].d : 0;
      for (const s of ss) {
        const k = Math.max(0, 1 - (last - s.d) / 260);
        if (k <= 0) continue;
        ctx.fillStyle = withAlpha(k > 0.6 ? '#ffcf33' : '#ff8a1f', 0.25 + k * 0.5);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2 + k * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      line(ctx, cam, pts, n);
      ctx.strokeStyle = withAlpha('#f0483e', 0.5);
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    }
    case 'bubbles':
      for (const s of samples(cam, pts, n, 12)) {
        const r = 3 + ((s.d * 7) % 5);
        ctx.fillStyle = withAlpha(mixHex(color, '#ffffff', 0.6), 0.5);
        ctx.strokeStyle = withAlpha(color, 0.9);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x + s.nx * Math.sin(s.d) * 3, s.y + s.ny * Math.sin(s.d) * 3, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(s.x - r * 0.35, s.y - r * 0.35, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'stars':
      thin();
      samples(cam, pts, n, 16).forEach((s, i) => {
        star(ctx, s.x, s.y, i % 2 ? 4 : 6, 5, s.d * 0.05);
        ctx.fillStyle = i % 2 ? color : '#ffcf33';
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });
      break;
    case 'lightning': {
      const ss = samples(cam, pts, n, 9);
      ctx.beginPath();
      ss.forEach((s, i) => {
        // Seeded by position along the path so the zigzag doesn't shimmer.
        const j = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 9;
        i ? ctx.lineTo(s.x + s.nx * j, s.y + s.ny * j) : ctx.moveTo(s.x, s.y);
      });
      ctx.strokeStyle = withAlpha(color, 0.45);
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.strokeStyle = '#ffe14d';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      break;
    }
    case 'plane':
      line(ctx, cam, pts, n);
      ctx.setLineDash([3, 7]);
      ctx.strokeStyle = withAlpha(INK, 0.6);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    default:
      line(ctx, cam, pts, n);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5.5;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.5;
      ctx.stroke();
  }
  ctx.restore();
}

/** The flying projectile itself, at screen (x, y), pointing along `angle` (radians, screen space). */
export function drawHead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string, style: ShotId, t: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  const flame = () => {
    const f = 7 + Math.sin(t * 40) * 3;
    ctx.beginPath();
    ctx.moveTo(-9, -4);
    ctx.lineTo(-9 - f, 0);
    ctx.lineTo(-9, 4);
    ctx.closePath();
    ctx.fillStyle = '#ff8a1f';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-9, -2);
    ctx.lineTo(-9 - f * 0.55, 0);
    ctx.lineTo(-9, 2);
    ctx.closePath();
    ctx.fillStyle = '#ffcf33';
    ctx.fill();
  };
  const rocket = (body: string) => {
    ctx.rotate(angle);
    flame();
    ctx.fillStyle = '#f0483e';
    ctx.beginPath();
    ctx.moveTo(-9, -8);
    ctx.lineTo(-3, -4);
    ctx.lineTo(-3, 4);
    ctx.lineTo(-9, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-10, -4.5);
    ctx.lineTo(4, -4.5);
    ctx.quadraticCurveTo(12, -4, 13, 0);
    ctx.quadraticCurveTo(12, 4, 4, 4.5);
    ctx.lineTo(-10, 4.5);
    ctx.closePath();
    ctx.fillStyle = body;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#a5f3fc';
    ctx.beginPath();
    ctx.arc(3, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  switch (style) {
    case 'rocket':
      rocket(color);
      break;
    case 'spaghetti':
      rocket('#f7d774');
      ctx.fillStyle = '#8b4a2b';
      ctx.beginPath();
      ctx.arc(-4, -7, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'rainbow':
      star(ctx, 0, 0, 10, 5, t * 6);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();
      break;
    case 'comet': {
      const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 11);
      g.addColorStop(0, '#fffbe0');
      g.addColorStop(0.45, '#ffcf33');
      g.addColorStop(1, '#ff6a1f');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 9 + Math.sin(t * 30), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'bubbles':
      ctx.fillStyle = withAlpha(mixHex(color, '#ffffff', 0.55), 0.7);
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-3, -3, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'stars':
      star(ctx, 0, 0, 11, 5, t * 8);
      ctx.fillStyle = '#ffcf33';
      ctx.fill();
      ctx.stroke();
      break;
    case 'lightning':
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(-8, -6);
      ctx.lineTo(2, -2);
      ctx.lineTo(-1, 1);
      ctx.lineTo(10, 7);
      ctx.lineTo(-1, 3);
      ctx.lineTo(2, 0);
      ctx.closePath();
      ctx.fillStyle = '#ffe14d';
      ctx.fill();
      ctx.stroke();
      break;
    case 'plane':
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-9, -8);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-9, 8);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-4, 0);
      ctx.strokeStyle = color;
      ctx.stroke();
      break;
    default:
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath();
      ctx.arc(-2.5, -2.5, 2.5, 0, Math.PI * 2);
      ctx.fill();
  }
  ctx.restore();
}
