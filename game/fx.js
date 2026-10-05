// Juice: a fixed pool of particles, floating numbers, decaying camera shake, a freeze and a flash.
// World coordinates are arena units; z is height above the ground in units. Nothing here allocates per frame.

import { clamp } from './rules.js';

const N = 360;
const FL = 28;
export const DOT = 0;
export const PUFF = 1;
export const STAR = 2;
export const CONF = 3;
export const DEBRIS = 4;
export const RING = 5;
export const SPARK = 6;
export const DROP = 7;

const INK = '#1b1530';

export function createFx(rand = Math.random) {
  const x = new Float32Array(N);
  const y = new Float32Array(N);
  const z = new Float32Array(N);
  const vx = new Float32Array(N);
  const vy = new Float32Array(N);
  const vz = new Float32Array(N);
  const life = new Float32Array(N);
  const max = new Float32Array(N);
  const size = new Float32Array(N);
  const rot = new Float32Array(N);
  const vr = new Float32Array(N);
  const grav = new Float32Array(N);
  const drag = new Float32Array(N);
  const kind = new Uint8Array(N);
  const col = new Array(N).fill('#fff');
  let next = 0;

  const fx_ = new Float32Array(FL);
  const fy_ = new Float32Array(FL);
  const fvy = new Float32Array(FL);
  const fl = new Float32Array(FL);
  const fmax = new Float32Array(FL);
  const fsize = new Float32Array(FL);
  const ftext = new Array(FL).fill('');
  const fcol = new Array(FL).fill('#fff');
  let fnext = 0;

  const api = {
    reduced: false,
    q: 1, // 0.35 low, 0.7 medium, 1 high
    trauma: 0,
    freeze: 0, // seconds the simulation holds
    flash: 0,
    sx: 0,
    sy: 0,
    rand,
    setQuality(quality, reduced) {
      api.q = quality === 'low' ? 0.35 : quality === 'medium' ? 0.7 : 1;
      api.reduced = !!reduced;
    },
    /** How many of `n` particles to make at the current quality. */
    n(count) {
      return Math.max(1, Math.round(count * api.q * (api.reduced ? 0.6 : 1)));
    },
    emit(k, px, py, pz, pvx, pvy, pvz, lifeS, sz, color, g = 0, d = 0, rt = 0, vrt = 0) {
      const i = next;
      next = (next + 1) % N;
      kind[i] = k;
      x[i] = px;
      y[i] = py;
      z[i] = pz;
      vx[i] = pvx;
      vy[i] = pvy;
      vz[i] = pvz;
      life[i] = lifeS;
      max[i] = lifeS;
      size[i] = sz;
      col[i] = color;
      grav[i] = g;
      drag[i] = d;
      rot[i] = rt;
      vr[i] = vrt;
    },
    clear() {
      life.fill(0);
      fl.fill(0);
      api.trauma = 0;
      api.freeze = 0;
      api.flash = 0;
    },

    // ---- ready-made bursts
    dust(px, py, dx, dy, color = '#f3ecd0') {
      const n = api.n(2);
      for (let i = 0; i < n; i++) {
        api.emit(DOT, px + (rand() - 0.5) * 0.3, py + 0.2, 0.1, dx * 0.4 + (rand() - 0.5) * 0.8, dy * 0.4 + (rand() - 0.5) * 0.8, 0.8 + rand() * 0.8, 0.35 + rand() * 0.15, 0.12 + rand() * 0.08, color, 3, 2);
      }
    },
    puff(px, py, n = 8, color = '#ffffff', power = 1) {
      n = api.n(n);
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const s = (1.2 + rand() * 2.2) * power;
        api.emit(PUFF, px, py, 0.4 + rand() * 0.5, Math.cos(a) * s, Math.sin(a) * s * 0.7, 0.4 + rand() * 1.2, 0.4 + rand() * 0.25, 0.28 + rand() * 0.2, color, 0, 3);
      }
    },
    sparks(px, py, pz, n = 8, color = '#ffd21f', power = 1) {
      n = api.n(n);
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const s = (1.5 + rand() * 3) * power;
        api.emit(SPARK, px, py, pz, Math.cos(a) * s, Math.sin(a) * s * 0.6, 1 + rand() * 2.5, 0.3 + rand() * 0.25, 0.1 + rand() * 0.07, color, 8, 1.5);
      }
    },
    stars(px, py, pz, n = 6, power = 1) {
      n = api.n(n);
      const cols = ['#ffd21f', '#ffffff', '#ff8a1f'];
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const s = (2 + rand() * 3.5) * power;
        api.emit(STAR, px, py, pz, Math.cos(a) * s, Math.sin(a) * s * 0.6, 2 + rand() * 3, 0.7 + rand() * 0.4, 0.2 + rand() * 0.16, cols[i % 3], 7, 0.8, rand() * 6, (rand() - 0.5) * 12);
      }
    },
    ring(px, py, pz, radius, color = '#ffffff', lifeS = 0.45) {
      api.emit(RING, px, py, pz, 0, 0, 0, lifeS, radius, color);
    },
    explosion(px, py) {
      // a blast ring, a cloud, stars and debris
      api.emit(RING, px, py, 0.9, 0, 0, 0, 0.5, 2.6, '#ffd21f');
      api.emit(RING, px, py, 0.9, 0, 0, 0, 0.38, 1.7, '#ffffff');
      api.puff(px, py, 14, '#ffffff', 1.4);
      api.puff(px, py, 8, '#ff8a1f', 1.1);
      api.puff(px, py, 6, '#4a4458', 0.9);
      api.stars(px, py, 1.0, 7, 1.2);
      const n = api.n(10);
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const s = 2 + rand() * 4;
        api.emit(DEBRIS, px, py, 0.8, Math.cos(a) * s, Math.sin(a) * s * 0.6, 3 + rand() * 4, 0.9 + rand() * 0.5, 0.12 + rand() * 0.1, rand() < 0.5 ? '#2a2a35' : '#6b5a4a', 11, 0.3, rand() * 6, (rand() - 0.5) * 16);
      }
    },
    confetti(px, py, n = 30, spread = 3, up = 6) {
      n = api.n(n);
      const cols = ['#ff4b4b', '#ffd21f', '#38a8ff', '#a6e22e', '#ff5cc8', '#9b5cff', '#ff8a1f'];
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const s = rand() * spread;
        api.emit(CONF, px + (rand() - 0.5) * 0.6, py + (rand() - 0.5) * 0.3, 1 + rand(), Math.cos(a) * s, Math.sin(a) * s * 0.5, up * (0.5 + rand() * 0.8), 1.8 + rand() * 1.2, 0.16 + rand() * 0.1, cols[i % cols.length], 7, 0.6, rand() * 6, (rand() - 0.5) * 14);
      }
    },
    sweat(px, py) {
      api.emit(DROP, px + (rand() - 0.5) * 0.7, py, 1.7 + rand() * 0.3, (rand() - 0.5) * 1.2, 0, 1.5 + rand(), 0.5, 0.1, '#8ad8ff', 7, 0.5);
    },

    // ---- floating numbers
    floater(px, py, text, color = '#ffd21f', sz = 1) {
      const i = fnext;
      fnext = (fnext + 1) % FL;
      fx_[i] = px;
      fy_[i] = py;
      fvy[i] = -1.6;
      fl[i] = 1.1;
      fmax[i] = 1.1;
      fsize[i] = sz;
      ftext[i] = String(text);
      fcol[i] = color;
    },

    // ---- camera
    addTrauma(a) {
      if (api.reduced) return;
      api.trauma = Math.min(1, api.trauma + a);
    },
    hit(ms) {
      if (!api.reduced) api.freeze = Math.max(api.freeze, ms / 1000);
    },
    flashScreen(a) {
      if (!api.reduced) api.flash = Math.max(api.flash, a);
    },

    update(dt) {
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) continue;
        const d = Math.exp(-drag[i] * dt);
        vx[i] *= d;
        vy[i] *= d;
        vz[i] -= grav[i] * dt;
        x[i] += vx[i] * dt;
        y[i] += vy[i] * dt;
        z[i] += vz[i] * dt;
        rot[i] += vr[i] * dt;
        const k = kind[i];
        if (z[i] < 0 && (k === CONF || k === DEBRIS || k === STAR)) {
          z[i] = 0;
          vz[i] *= -0.35;
          vx[i] *= 0.7;
          vy[i] *= 0.7;
          vr[i] *= 0.6;
        }
      }
      for (let i = 0; i < FL; i++) {
        if (fl[i] <= 0) continue;
        fl[i] -= dt;
        fy_[i] += fvy[i] * dt;
        fvy[i] *= Math.exp(-2.2 * dt);
      }
      api.trauma = Math.max(0, api.trauma - dt * 1.7);
      api.flash = Math.max(0, api.flash - dt * 3.2);
    },

    /** Camera offset in pixels (smooth sine noise, never random jitter). */
    shake(t, scale) {
      const m = api.trauma * api.trauma * 16 * scale;
      api.sx = m * Math.sin(t * 41.3);
      api.sy = m * Math.sin(t * 53.7 + 1.3);
    },

    draw(ctx, v) {
      const s = v.s;
      const lw = Math.max(1.5, v.lw * 0.7);
      ctx.lineJoin = 'round';
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        const f = life[i] / max[i]; // 1 -> 0
        const px = v.ox + x[i] * s;
        const py = v.oy + (y[i] - z[i]) * s;
        const k = kind[i];
        if (k === RING) {
          const e = 1 - f;
          const r = size[i] * s * (1 - (1 - e) * (1 - e));
          ctx.globalAlpha = f;
          ctx.strokeStyle = col[i];
          ctx.lineWidth = Math.max(2, lw * 2.2 * f);
          ctx.beginPath();
          ctx.arc(px, py, Math.max(0.5, r), 0, 6.2832);
          ctx.stroke();
          continue;
        }
        const r = size[i] * s * (k === PUFF ? 0.7 + (1 - f) * 0.9 : k === SPARK ? 0.4 + f * 0.6 : 1);
        ctx.globalAlpha = k === PUFF ? Math.min(1, f * 1.6) : Math.min(1, f * 2.2);
        ctx.fillStyle = col[i];
        if (k === DOT || k === SPARK || k === DROP) {
          ctx.beginPath();
          ctx.arc(px, py, r, 0, 6.2832);
          ctx.fill();
        } else if (k === PUFF) {
          ctx.strokeStyle = INK;
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, 6.2832);
          ctx.fill();
          ctx.stroke();
        } else if (k === STAR) {
          ctx.strokeStyle = INK;
          ctx.lineWidth = lw;
          starPath(ctx, px, py, r, rot[i]);
          ctx.fill();
          ctx.stroke();
        } else {
          // confetti and debris: a small turning rectangle
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(rot[i]);
          ctx.fillRect(-r, -r * 0.55, r * 2, r * 1.1);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    },

    drawFloaters(ctx, v, fontFamily) {
      const s = v.s;
      for (let i = 0; i < FL; i++) {
        if (fl[i] <= 0) continue;
        const f = fl[i] / fmax[i];
        const age = 1 - f;
        const pop = age < 0.18 ? 1 + 0.45 * Math.sin((age / 0.18) * Math.PI) : 1;
        const px = v.ox + fx_[i] * s;
        const py = v.oy + fy_[i] * s;
        const size = clamp(s * 0.85, 16, 44) * fsize[i] * pop;
        ctx.globalAlpha = Math.min(1, f * 2.5);
        ctx.font = `${size}px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.2;
        ctx.strokeStyle = INK;
        ctx.strokeText(ftext[i], px, py);
        ctx.fillStyle = fcol[i];
        ctx.fillText(ftext[i], px, py);
      }
      ctx.globalAlpha = 1;
    },
  };
  return api;
}

function starPath(ctx, cx, cy, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export { starPath };
