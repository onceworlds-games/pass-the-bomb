// Web Audio, all synthesized: a short sound for every action and a cheerful looping tune from a tiny step sequencer.
// Nothing plays until unlock() runs from a tap. The platform's volume and mute apply to everything connected to the
// destination, so this has no volume controls of its own. Every call is safe to make with no audio available.

let ac = null;
let sfx = null;
let music = null;
let noiseBuf = null;
let timer = null;
let nextTime = 0;
let step = 0;
let level = 0.2;

const BPM = 122;
const STEP_S = 60 / BPM / 2; // eighth notes
// C major: C Am F G, two bars each of eight eighth-notes
const CHORDS = [
  { root: 48, tri: [60, 64, 67] },
  { root: 45, tri: [57, 60, 64] },
  { root: 53, tri: [60, 65, 69] },
  { root: 55, tri: [59, 62, 67] },
];
const MELODY = [
  [0, 4, 7, 4, 9, 7, 4, 2],
  [0, 2, 4, 7, 9, 7, 4, 0],
  [5, 4, 2, 4, 5, 9, 7, 5],
  [7, 5, 4, 2, 4, 7, 11, 7],
];
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function unlock() {
  try {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      sfx = ac.createGain();
      sfx.gain.value = 0.9;
      sfx.connect(ac.destination);
      music = ac.createGain();
      music.gain.value = level;
      music.connect(ac.destination);
      const len = Math.floor(ac.sampleRate * 1.2);
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      nextTime = ac.currentTime + 0.1;
      timer = setInterval(schedule, 40);
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
  } catch {
    ac = null;
  }
}

/** The music's loudness: quiet on menus, louder in play. */
export function setMusic(l) {
  level = l;
  if (!ac || !music) return;
  try {
    music.gain.setTargetAtTime(l, ac.currentTime, 0.35);
  } catch {
    // ignore
  }
}

function tone(f, dur, o = {}) {
  if (!ac) return;
  try {
    const t0 = ac.currentTime + (o.delay || 0);
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
    const vol = (o.vol ?? 0.3) * (o.gain ?? 1);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + (o.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(o.dest || sfx);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch {
    // ignore
  }
}

function noise(dur, o = {}) {
  if (!ac || !noiseBuf) return;
  try {
    const t0 = ac.currentTime + (o.delay || 0);
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ac.createBiquadFilter();
    filter.type = o.filter || 'lowpass';
    filter.frequency.setValueAtTime(o.f || 2000, t0);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t0 + dur);
    filter.Q.value = o.q || 0.8;
    const g = ac.createGain();
    const vol = (o.vol ?? 0.3) * (o.gain ?? 1);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(o.dest || sfx);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------- the tune

function schedule() {
  if (!ac || ac.state !== 'running') return;
  if (nextTime < ac.currentTime - 0.4) nextTime = ac.currentTime + 0.05;
  while (nextTime < ac.currentTime + 0.16) {
    play(step, nextTime);
    nextTime += STEP_S;
    step = (step + 1) % 64;
  }
}

function note(f, t, dur, type, vol) {
  try {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(music);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  } catch {
    // ignore
  }
}

function drum(t, kind) {
  try {
    if (kind === 'kick') {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(g);
      g.connect(music);
      osc.start(t);
      osc.stop(t + 0.2);
      return;
    }
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const g = ac.createGain();
    g.gain.setValueAtTime(kind === 'hat' ? 0.12 : 0.28, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'hat' ? 0.04 : 0.11));
    src.connect(f);
    f.connect(g);
    g.connect(music);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.15);
  } catch {
    // ignore
  }
}

function play(s, t) {
  const bar = (s >> 3) & 3; // 0..3 : which chord
  const i = s & 7; // eighth within the bar
  const c = CHORDS[bar];
  // bass: root, root, octave, root ...
  const bassNote = c.root + (i === 2 || i === 5 ? 12 : 0);
  if (i % 2 === 0 || i === 5) note(midi(bassNote - 12), t, STEP_S * 1.6, 'triangle', 0.32);
  // chord stabs on the off-beats
  if (i % 2 === 1) for (const m of c.tri) note(midi(m), t, STEP_S * 0.7, 'square', 0.035);
  // drums
  if (i === 0 || i === 4) drum(t, 'kick');
  if (i === 2 || i === 6) drum(t, 'snare');
  drum(t, 'hat');
  // a little tune in the second half of every four bars
  if (s >= 32 || (s >> 3) % 2 === 1) {
    const m = 72 + MELODY[bar][i];
    note(midi(m), t, STEP_S * 0.9, 'sine', 0.09);
  }
}

// ---------------------------------------------------------------- sounds

export const sound = {
  /** Countdown beep; `go` is the higher one. */
  beep(go) {
    tone(go ? 880 : 520, go ? 0.45 : 0.18, { type: 'square', vol: 0.18 });
    if (go) tone(1320, 0.4, { type: 'sine', vol: 0.16, delay: 0.02 });
  },
  tap() {
    tone(660, 0.08, { type: 'triangle', vol: 0.2 });
  },
  ready() {
    tone(523, 0.09, { type: 'triangle', vol: 0.22 });
    tone(784, 0.14, { type: 'triangle', vol: 0.22, delay: 0.07 });
  },
  dash(gain = 1) {
    noise(0.22, { filter: 'bandpass', f: 500, to: 3200, q: 1.1, vol: 0.28, gain, attack: 0.02 });
    tone(220, 0.15, { to: 520, type: 'sine', vol: 0.1, gain });
  },
  whistle() {
    tone(1900, 0.55, { to: 700, type: 'sine', vol: 0.16, attack: 0.04 });
    tone(1930, 0.55, { to: 720, type: 'sine', vol: 0.08, attack: 0.04, delay: 0.01 });
  },
  thud() {
    tone(130, 0.2, { to: 50, type: 'sine', vol: 0.5 });
    noise(0.08, { f: 700, vol: 0.2 });
  },
  boop() {
    tone(420, 0.1, { to: 760, type: 'sine', vol: 0.36 });
    tone(840, 0.08, { type: 'triangle', vol: 0.12, delay: 0.05 });
  },
  tick(urgency = 0) {
    tone(1000 + urgency * 700, 0.04, { type: 'square', vol: 0.06 + urgency * 0.12 });
  },
  boom() {
    noise(0.9, { f: 2600, to: 90, vol: 0.7, attack: 0.004 });
    tone(110, 0.8, { to: 28, type: 'sine', vol: 0.7 });
    tone(220, 0.25, { to: 60, type: 'sawtooth', vol: 0.15 });
  },
  bump() {
    tone(160, 0.1, { to: 90, type: 'sine', vol: 0.25 });
  },
  pop() {
    tone(500, 0.08, { to: 900, type: 'sine', vol: 0.18 });
  },
  out() {
    tone(392, 0.2, { type: 'triangle', vol: 0.25 });
    tone(330, 0.2, { type: 'triangle', vol: 0.25, delay: 0.2 });
    tone(262, 0.5, { to: 200, type: 'triangle', vol: 0.28, delay: 0.4 });
  },
  score() {
    tone(988, 0.07, { type: 'square', vol: 0.08 });
    tone(1319, 0.14, { type: 'square', vol: 0.08, delay: 0.06 });
  },
  tada() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, { type: 'triangle', vol: 0.22, delay: i * 0.08 }));
  },
  fanfare() {
    [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, i === 7 ? 0.9 : 0.17, { type: 'square', vol: 0.12, delay: i * 0.13 }));
    [262, 330, 392, 523].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.2, delay: 0.9 + i * 0.02 }));
  },
  round() {
    noise(0.3, { filter: 'bandpass', f: 400, to: 2400, q: 0.9, vol: 0.18 });
  },
};
