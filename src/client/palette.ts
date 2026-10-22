/** Candy-bright player colors. Lines read on white; names and faces keep color from being the only cue. */
export const SEATS = [
  { name: 'Red', color: '#f0483e' },
  { name: 'Blue', color: '#2f7cf6' },
  { name: 'Green', color: '#22b35e' },
  { name: 'Purple', color: '#8b5cf6' },
  { name: 'Orange', color: '#ff8a1f' },
  { name: 'Pink', color: '#ff4f9a' },
] as const;

export const seatColor = (seat: number) => SEATS[seat % SEATS.length].color;

export const INK = '#1e2235';
export const INK_2 = '#464c63';
export const DUMMY_COLOR = '#f0483e';
export const ACCENT = '#2f7cf6';
export const CANDY = ['#ffcf33', '#2f7cf6', '#22b35e', '#ff4f9a', '#8b5cf6', '#ff8a1f'];

/** Each function family gets its own color in Learn. */
export const FAMILY_COLOR: Record<string, string> = {
  linear: '#2f7cf6',
  quadratic: '#ff8a1f',
  absolute: '#0d9488',
  cubic: '#ca8a04',
  sqrt: '#0284c7',
  exponential: '#e11d48',
  sine: '#8b5cf6',
  tangent: '#ff4f9a',
  log: '#22b35e',
};

export const FONT_DISPLAY = '"Nunito Variable", system-ui, sans-serif';
/** Rounded display face, kept for the logo and comic hit stickers only. */
export const FONT_LOGO = '"Fredoka Variable", "Nunito Variable", system-ui, sans-serif';

export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Like mix(), but returns hex so the result can be mixed again. */
export function mixHex(hex: string, toward: string, t: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(toward.slice(1), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

export function mix(hex: string, toward: string, t: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(toward.slice(1), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}
