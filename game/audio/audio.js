// Sound, all synthesised: glass chimes (FM bell clusters) for placing and turning, a beam hum that follows the
// light, sizzles for burning, a soft heavy thud for the Heart, clockwork ticks that quicken through a wave, a low
// drone as ink gathers, and the music box. A limiter on the master, so nothing clips. Never the same blip twice.

import { makeMusic } from './music.js';

export function makeAudio() {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let hum = null;
  let drone = null;
  let music = null;
  let unlocked = false;
  let hidden = false;
  let lastPlayed = new Map();
  let seed = 3;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const vary = (base, cents = 60) => base * Math.pow(2, ((rnd() * 2 - 1) * cents) / 1200);

  function unlock() {
    if (unlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createDynamicsCompressor();
      master.threshold.value = -12;
      master.knee.value = 18;
      master.ratio.value = 12;
      master.attack.value = 0.003;
      master.release.value = 0.2;
      const out = ctx.createGain();
      out.gain.value = 0.8;
      master.connect(out);
      out.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.9;
      sfxBus.connect(master);
      hum = makeHum();
      drone = makeDrone();
      music = makeMusic(ctx, master);
      unlocked = true;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch (e) {
      console.warn('[glint] audio', e && e.message);
    }
  }

  // ---- building blocks -------------------------------------------------------------------------------------
  function env(gainNode, t, a, d, s, r, peak = 1, hold = 0) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak * s), t + a + d);
    g.setValueAtTime(Math.max(0.0001, peak * s), t + a + d + hold);
    g.exponentialRampToValueAtTime(0.0001, t + a + d + hold + r);
  }

  /** An FM bell: carrier + modulator, bright attack, long glassy tail. */
  function bell(freq, t, dur = 1.2, vol = 0.25, ratio = 3.01, index = 2.2) {
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    const g = ctx.createGain();
    car.type = 'sine';
    mod.type = 'sine';
    car.frequency.value = freq;
    mod.frequency.value = freq * ratio;
    mg.gain.setValueAtTime(freq * index, t);
    mg.gain.exponentialRampToValueAtTime(freq * 0.05, t + dur * 0.6);
    mod.connect(mg);
    mg.connect(car.frequency);
    car.connect(g);
    g.connect(sfxBus);
    env(g, t, 0.004, dur * 0.3, 0.25, dur * 0.7, vol);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.1);
    mod.stop(t + dur + 0.1);
  }

  function noise(t, dur, vol, filterType = 'bandpass', freq = 2000, q = 1) {
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    src.connect(f);
    f.connect(g);
    g.connect(sfxBus);
    env(g, t, 0.005, dur * 0.4, 0.3, dur * 0.6, vol);
    src.start(t);
    src.stop(t + dur + 0.05);
    return f;
  }

  function tone(freq, t, dur, vol, type = 'sine', slideTo = null) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    o.connect(g);
    g.connect(sfxBus);
    env(g, t, 0.005, dur * 0.3, 0.4, dur * 0.7, vol);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** The hum: a small harmonic stack whose level and richness follow the beams. */
  function makeHum() {
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    g.connect(lp);
    lp.connect(master);
    const oscs = [];
    for (const [ratio, vol, type] of [[1, 0.5, 'sine'], [2, 0.25, 'triangle'], [3, 0.12, 'sine'], [5.01, 0.06, 'sine']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 55 * ratio;
      const og = ctx.createGain();
      og.gain.value = vol;
      o.connect(og);
      og.connect(g);
      o.start();
      oscs.push({ o, og, ratio });
    }
    return { g, lp, oscs };
  }

  /** The drone: detuned saws under a low-pass, up as ink gathers. */
  function makeDrone() {
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    g.connect(lp);
    lp.connect(master);
    const oscs = [];
    for (const det of [-7, 0, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 36.7;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = 0.3;
      o.connect(og);
      og.connect(g);
      o.start();
      oscs.push(o);
    }
    return { g, lp, oscs };
  }

  // ---- one-shots -----------------------------------------------------------------------------------------
  const SOUNDS = {
    place(o) {
      const base = 520 + (((o.angle ?? 0) % 180) / 180) * 420;
      bell(vary(base, 25), now(), 1.1, 0.22);
      bell(vary(base * 1.5, 25), now() + 0.03, 0.8, 0.1);
    },
    tick(o) {
      const base = 700 + (((o.angle ?? 0) % 360) / 360) * 900;
      bell(vary(base, 15), now(), 0.25, 0.09, 4.0, 1.2);
    },
    move() {
      bell(vary(440, 30), now(), 0.6, 0.14);
    },
    sell() {
      bell(vary(330, 30), now(), 0.9, 0.16, 2.0, 1.5);
      bell(vary(220, 30), now() + 0.08, 0.9, 0.12, 2.0, 1.5);
    },
    select() {
      bell(vary(880, 40), now(), 0.3, 0.07, 3.0, 1.0);
    },
    refuse() {
      tone(vary(180, 20), now(), 0.18, 0.12, 'square', 120);
    },
    burn(o) {
      const t = now();
      const f = noise(t, o.big ? 0.9 : 0.32, o.big ? 0.4 : 0.22, 'bandpass', vary(o.hue === 'b' ? 3200 : o.hue === 'g' ? 2400 : 1800, 120), 1.4);
      f.frequency.exponentialRampToValueAtTime(600, t + (o.big ? 0.9 : 0.3));
      bell(vary(o.big ? 220 : 1760, 60), t, o.big ? 1.6 : 0.4, o.big ? 0.3 : 0.08, 2.0, 1.0);
    },
    bossdown() {
      const t = now();
      for (let i = 0; i < 5; i++) bell(vary(330 * Math.pow(1.5, i % 3), 20), t + i * 0.12, 2.0, 0.2);
      noise(t, 1.4, 0.35, 'lowpass', 500, 0.7);
    },
    thud(o) {
      const t = now();
      tone(vary(110, 30), t, 0.35, o.big ? 0.6 : 0.42, 'sine', 40);
      noise(t, 0.25, 0.18, 'lowpass', 300, 0.5);
    },
    crack() {
      const t = now();
      noise(t, 0.2, 0.3, 'highpass', 3000, 0.8);
      bell(vary(2200, 80), t, 0.5, 0.12, 7.1, 3);
    },
    shatter() {
      const t = now();
      noise(t, 0.6, 0.4, 'highpass', 2500, 0.6);
      for (let i = 0; i < 4; i++) bell(vary(1800 + i * 400, 80), t + i * 0.05, 0.9, 0.1, 6.3, 3);
    },
    pulse() {
      const t = now();
      tone(vary(160, 20), t, 0.7, 0.35, 'triangle', 640);
      noise(t + 0.1, 0.5, 0.2, 'bandpass', 1500, 2);
    },
    flare() {
      const t = now();
      noise(t, 1.0, 0.3, 'lowpass', 1200, 0.5);
      bell(vary(660, 30), t, 1.4, 0.2, 2.0, 1.4);
      bell(vary(990, 30), t + 0.1, 1.2, 0.14, 2.0, 1.4);
    },
    dawn() {
      const t = now();
      for (let i = 0; i < 6; i++) bell(vary(261.6 * Math.pow(2, [0, 4, 7, 11, 14, 19][i] / 12), 10), t + i * 0.09, 2.4, 0.18);
    },
    surge() {
      const t = now();
      tone(vary(330, 20), t, 0.5, 0.2, 'triangle', 990);
    },
    wave() {
      const t = now();
      for (let i = 0; i < 3; i++) tone(vary(1200, 20), t + i * 0.09, 0.05, 0.12, 'square');
    },
    cleared() {
      const t = now();
      for (let i = 0; i < 5; i++) bell(vary(523 * Math.pow(2, [0, 2, 4, 7, 9][i] / 12), 8), t + i * 0.07, 1.4, 0.16);
    },
    nightdone() {
      const t = now();
      for (let i = 0; i < 8; i++) bell(vary(392 * Math.pow(2, [0, 4, 7, 12, 16, 19, 24, 28][i] / 12), 8), t + i * 0.08, 2.2, 0.15);
    },
    lost() {
      const t = now();
      tone(vary(110, 10), t, 2.2, 0.35, 'sine', 45);
      noise(t, 1.8, 0.2, 'lowpass', 200, 0.5);
    },
    eaten() {
      const t = now();
      for (let i = 0; i < 3; i++) noise(t + i * 0.1, 0.1, 0.25, 'bandpass', vary(900, 80), 3);
    },
    moth() {
      noise(now(), 0.8, 0.2, 'bandpass', 500, 4);
    },
    boss() {
      const t = now();
      tone(vary(55, 10), t, 2.5, 0.4, 'sawtooth');
      tone(vary(82.4, 10), t + 0.3, 2.2, 0.25, 'sawtooth');
    },
    sparkle() {
      const t = now();
      for (let i = 0; i < 4; i++) bell(vary(2093 * Math.pow(2, [0, 4, 7, 12][i] / 12), 15), t + i * 0.04, 0.5, 0.05, 5.0, 1.5);
    },
    ping() {
      bell(vary(1320, 20), now(), 0.6, 0.12, 2.0, 1.2);
    },
    draft() {
      bell(vary(660, 15), now(), 1.2, 0.2);
    },
    shadow() {
      tone(vary(70, 10), now(), 1.2, 0.25, 'triangle', 50);
    },
    flicker() {
      noise(now(), 0.3, 0.15, 'bandpass', 800, 3);
    },
  };

  const now = () => ctx.currentTime + 0.005;

  function play(name, opts = {}) {
    if (!unlocked || !ctx || hidden) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    // Never pile the same sound within 40 ms (a swarm dying at once is one sizzle, not a hundred).
    const t = performance.now();
    if (t - (lastPlayed.get(name) || 0) < 40) return;
    lastPlayed.set(name, t);
    try {
      fn(opts);
    } catch {}
  }

  // ---- continuous layers -----------------------------------------------------------------------------------
  let tickAcc = 0;
  let lastTickAt = 0;
  function tick(dt, night) {
    if (!unlocked || !ctx) return;
    const t = ctx.currentTime;
    const target = night && !hidden ? night.power * 0.22 : 0;
    hum.g.gain.setTargetAtTime(target, t, 0.12);
    if (night) {
      const rich = Math.min(1, night.beams / 10);
      hum.lp.frequency.setTargetAtTime(300 + rich * 900 + (night.dawn ? 600 : 0), t, 0.2);
      hum.oscs.forEach((o) => o.o.frequency.setTargetAtTime(55 * o.ratio * (1 + night.power * 0.08), t, 0.3));
      drone.g.gain.setTargetAtTime(night.danger * 0.18, t, 0.4);
      drone.lp.frequency.setTargetAtTime(120 + night.danger * 300, t, 0.5);
      // Clockwork: ticks that quicken through a wave.
      if (night.phase === 'wave') {
        const interval = 1.2 - night.waveProgress * 0.75;
        tickAcc += dt;
        if (tickAcc >= interval && performance.now() - lastTickAt > 150) {
          tickAcc = 0;
          lastTickAt = performance.now();
          try {
            tone(vary(1800, 30), now(), 0.03, 0.05, 'square');
          } catch {}
        }
      }
      music.update(dt, night);
    } else {
      drone.g.gain.setTargetAtTime(0, t, 0.4);
      music.update(dt, null);
    }
  }

  return {
    unlock,
    play,
    tick,
    nightStart() {
      if (music) music.nightStart();
    },
    hide() {
      hidden = true;
      if (hum && ctx) hum.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    },
    show() {
      hidden = false;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    pauseMusic(flag) {
      if (music) music.pause(flag);
    },
    stopAll() {
      if (!ctx) return;
      try {
        hum.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        drone.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        music.pause(true);
      } catch {}
    },
    get unlocked() {
      return unlocked;
    },
  };
}
