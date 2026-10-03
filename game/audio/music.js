// The music box: slow celesta arpeggios over a drifting progression, with voices added as danger rises and a
// hush at dusk. Scheduled a beat ahead; every note's pitch and timing wobbles a little, like a wound mechanism.

const CHORDS = [
  [0, 7, 11, 14], // Imaj7
  [9, 16, 19, 23], // vi7
  [5, 12, 16, 19], // IV
  [7, 14, 17, 21], // V
  [2, 9, 12, 17], // ii
  [4, 11, 14, 19], // iii
];
const ROOT = 261.63; // C4

export function makeMusic(ctx, out) {
  const bus = ctx.createGain();
  bus.gain.value = 0.0;
  const verb = makeVerb();
  bus.connect(verb.input);
  verb.output.connect(out);
  bus.connect(out);
  let level = 0;
  let paused = false;
  let nextNote = 0;
  let step = 0;
  let chord = 0;
  let seed = 11;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  function makeVerb() {
    // A short feedback delay pair as a glassy room.
    const input = ctx.createGain();
    const output = ctx.createGain();
    output.gain.value = 0.35;
    for (const [time, fb] of [[0.173, 0.42], [0.287, 0.36]]) {
      const d = ctx.createDelay(1);
      d.delayTime.value = time;
      const g = ctx.createGain();
      g.gain.value = fb;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      input.connect(d);
      d.connect(lp);
      lp.connect(g);
      g.connect(d);
      lp.connect(output);
    }
    return { input, output };
  }

  function celesta(freq, t, vol, dur = 1.6) {
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o2.type = 'triangle';
    o.frequency.value = freq;
    o2.frequency.value = freq * 4.0;
    const g2 = ctx.createGain();
    g2.gain.value = 0.12;
    o2.connect(g2);
    g2.connect(g);
    o.connect(g);
    g.connect(bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  function pad(freq, t, vol, dur) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    o.detune.value = (rnd() - 0.5) * 8;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    o.connect(lp);
    lp.connect(g);
    g.connect(bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  let state = null;
  function update(dt, night) {
    state = night;
    const t = ctx.currentTime;
    const want = !night || paused ? 0 : night.phase === 'rest' ? 0.22 : night.phase === 'dusk' ? 0.35 : night.phase === 'done' || night.phase === 'lost' ? 0.2 : 0.55;
    level += (want - level) * Math.min(1, dt * 0.8);
    bus.gain.setTargetAtTime(level, t, 0.3);
    if (!night || paused) return;
    // Schedule notes a little ahead of time.
    const danger = night.danger || 0;
    const calm = night.phase === 'dusk' || night.phase === 'rest';
    const beat = night.phase === 'rest' ? 0.72 : calm ? 0.62 : 0.5 - danger * 0.12;
    while (nextNote < t + 0.25) {
      // Never schedule into the past (a context that has not started yet stands at 0).
      if (nextNote < t + 0.03) nextNote = t + 0.05;
      const ch = CHORDS[chord];
      const noteIndex = step % 8;
      const semis = ch[[0, 1, 2, 3, 2, 1, 3, 0][noteIndex]] + (noteIndex >= 4 ? 12 : 0);
      const freq = ROOT * Math.pow(2, semis / 12) * (calm ? 0.5 : 1);
      const swing = (rnd() - 0.5) * 0.03;
      if (noteIndex % 2 === 0 || danger > 0.3 || rnd() < 0.5) celesta(freq * Math.pow(2, (rnd() - 0.5) * 0.004), nextNote + swing, 0.09 + danger * 0.04);
      // A second voice above as danger rises; a pad below at the bar.
      if (danger > 0.45 && noteIndex % 4 === 2) celesta(freq * 1.5, nextNote + swing + 0.02, 0.05);
      if (noteIndex === 0) pad(ROOT * Math.pow(2, (ch[0] - 24) / 12), nextNote, 0.05 + danger * 0.05, beat * 8);
      if (night.boss && noteIndex % 2 === 1) pad(ROOT * Math.pow(2, (ch[0] - 12) / 12) * 1.0595, nextNote, 0.04, beat * 1.5);
      step++;
      if (step % 8 === 0) chord = (chord + (rnd() < 0.7 ? 1 : 2)) % CHORDS.length;
      nextNote += beat;
    }
  }

  return {
    update,
    nightStart() {
      step = 0;
      chord = 0;
      nextNote = 0;
    },
    pause(flag) {
      paused = !!flag;
    },
    get state() {
      return state;
    },
  };
}
