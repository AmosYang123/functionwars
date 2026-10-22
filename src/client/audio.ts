import { store } from './dom.ts';

// Synthesised sound effects: no audio files to load.
let ctx: AudioContext | null = null;
let muted = store.get('ff-muted') === '1';

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  store.set('ff-muted', m ? '1' : '0');
}

function tone(freq: number, to: number, dur: number, type: OscillatorType, vol = 0.12, delay = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, cutoff: number) {
  const a = ac();
  if (!a) return;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  click: () => tone(900, 700, 0.05, 'square', 0.04),
  lock: () => {
    tone(440, 880, 0.08, 'square', 0.06);
    tone(880, 1320, 0.1, 'square', 0.05, 0.07);
  },
  tick: () => tone(1200, 1200, 0.03, 'sine', 0.05),
  launch: () => tone(220, 1400, 0.35, 'sawtooth', 0.06),
  thud: () => noise(0.25, 0.5, 900),
  crumble: () => {
    noise(0.6, 0.6, 1600);
    tone(160, 40, 0.5, 'triangle', 0.15);
  },
  boom: () => {
    noise(0.9, 0.9, 2400);
    tone(300, 30, 0.8, 'sawtooth', 0.12);
  },
  pop: () => tone(600, 1500, 0.12, 'triangle', 0.1),
  miss: () => tone(500, 200, 0.3, 'sine', 0.05),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, 'square', 0.06, i * 0.12)),
  error: () => tone(220, 160, 0.15, 'square', 0.05),
};
