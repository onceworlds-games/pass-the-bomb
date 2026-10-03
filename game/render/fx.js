// Particles (pooled), camera shake, hit-stop and the slow, photosensitivity-safe flashes (Flare, Dawn, pulses).

import { PALETTE } from './felt.js';
import { clamp } from '../sim/geom.js';

const MAX = { high: 420, medium: 220, low: 80 };

export function makeFx() {
  const pool = [];
  let live = 0;
  let shakeX = 0;
  let shakeY = 0;
  let shakeT = 0;
  let shakeAmp = 0;
  let hitStop = 0;
  const rings = []; // slow fades: { x, y, r, t, life, colour }
  const snaps = []; // quick thin rings where a Shade burns away: { x, y, r, t, colour }
  const pops = []; // rising figures: { x, y, t, text, colour }
  let seed = 9;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  function spawn(x, y, vx, vy, life, size, colour, opts = {}) {
    const max = MAX[opts.quality] ?? MAX.high;
    if (live >= max) return;
    let p = pool[live];
    if (!p) {
      p = {};
      pool[live] = p;
    }
    live++;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = 0;
    p.max = life;
    p.size = size;
    p.colour = colour;
    p.drag = opts.drag ?? 0.9;
    p.add = !!opts.add;
    p.grav = opts.grav ?? 0;
  }

  /** Sparks when light bites ink. */
  function burst(x, y, n, colour, speed = 90, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const v = speed * (0.3 + rnd());
      spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, 0.35 + rnd() * 0.5, 1 + rnd() * 2, colour, { add: true, drag: 0.85, ...opts });
    }
  }

  /** Glass chips when a piece cracks or shatters. */
  function chips(x, y, n, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const v = 60 + rnd() * 140;
      spawn(x, y, Math.cos(a) * v, Math.sin(a) * v - 40, 0.6 + rnd() * 0.6, 1.5 + rnd() * 2.5, 'rgba(220,240,250,0.9)', { drag: 0.92, grav: 260, ...opts });
    }
  }

  /** Ink spatter when a Shade dies. */
  function ink(x, y, n, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const v = 30 + rnd() * 90;
      spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, 0.5 + rnd() * 0.5, 1.5 + rnd() * 3, 'rgba(5,6,10,0.85)', { drag: 0.88, ...opts });
    }
  }

  function shake(amp, time = 0.35) {
    shakeAmp = Math.max(shakeAmp, amp);
    shakeT = Math.max(shakeT, time);
  }

  function stop(seconds) {
    hitStop = Math.max(hitStop, seconds);
  }

  /** A slow ring of light (Flare, Dawn): never faster than a gentle fade. */
  function ring(x, y, r, life, colour) {
    rings.push({ x, y, r, t: 0, life, colour });
  }

  /** A thin ring that opens where a Shade burns away, in the colour that burned it. */
  function snap(x, y, r, colour) {
    if (snaps.length >= 24) snaps.shift();
    snaps.push({ x, y, r, t: 0, colour });
  }

  /** A figure that rises and fades (what a kill scored). */
  function pop(x, y, text, colour) {
    if (pops.length >= 10) pops.shift();
    pops.push({ x, y, t: 0, text: String(text).slice(0, 8), colour });
  }

  /** Advances everything; returns the camera offset to apply (css px) and whether the sim should hold. */
  function step(dt, opts = {}) {
    const reduced = !!opts.reduced;
    if (hitStop > 0) hitStop -= dt;
    for (let i = 0; i < live; i++) {
      const p = pool[i];
      p.life += dt;
      if (p.life >= p.max) {
        pool[i] = pool[live - 1];
        pool[live - 1] = p;
        live--;
        i--;
        continue;
      }
      p.vy += p.grav * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].t += dt;
      if (rings[i].t >= rings[i].life) rings.splice(i, 1);
    }
    for (let i = snaps.length - 1; i >= 0; i--) {
      snaps[i].t += dt;
      if (snaps[i].t >= 0.45) snaps.splice(i, 1);
    }
    for (let i = pops.length - 1; i >= 0; i--) {
      pops[i].t += dt;
      if (pops[i].t >= 0.95) pops.splice(i, 1);
    }
    if (shakeT > 0 && !reduced) {
      shakeT -= dt;
      const k = clamp(shakeT / 0.35, 0, 1) * shakeAmp;
      shakeX = (rnd() - 0.5) * 2 * k;
      shakeY = (rnd() - 0.5) * 2 * k;
      if (shakeT <= 0) shakeAmp = 0;
    } else {
      shakeX = shakeY = 0;
      if (shakeT <= 0) shakeAmp = 0;
    }
    return { x: shakeX, y: shakeY, hold: hitStop > 0 };
  }

  /** Draws in the table's coordinates; `opts.k` keeps sparks and figures at a screen size, `opts.upright` turns text. */
  function draw(ctx, opts = {}) {
    const k = opts.k || 1;
    ctx.save();
    for (const sn of snaps) {
      const u = sn.t / 0.45;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - u) * 0.9;
      ctx.strokeStyle = sn.colour;
      ctx.lineWidth = (2.4 - 1.6 * u) * k;
      ctx.beginPath();
      ctx.arc(sn.x, sn.y, sn.r * (0.6 + 0.9 * (1 - (1 - u) * (1 - u))), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const rg of rings) {
      const u = rg.t / rg.life;
      const a = Math.sin(u * Math.PI) * 0.6;
      const g = ctx.createRadialGradient(rg.x, rg.y, rg.r * u * 0.2, rg.x, rg.y, rg.r * (0.3 + 0.7 * u));
      g.addColorStop(0, rg.colour.replace('A', (a * 0.8).toFixed(3)));
      g.addColorStop(1, rg.colour.replace('A', '0'));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, rg.r * (0.3 + 0.7 * u), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < live; i++) {
      const p = pool[i];
      ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.colour;
      const sz = p.size * k;
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    if (pops.length) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = `600 ${Math.round(15 * k)}px "Cormorant", Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const pp of pops) {
        const u = pp.t / 0.95;
        ctx.save();
        if (opts.upright) opts.upright(ctx, pp.x, pp.y);
        else ctx.translate(pp.x, pp.y);
        ctx.globalAlpha = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
        const rise = -(10 + 26 * (1 - (1 - u) * (1 - u))) * k;
        ctx.fillStyle = 'rgba(5,6,10,0.8)';
        ctx.fillText(pp.text, 0, rise + 1.2 * k);
        ctx.fillStyle = pp.colour;
        ctx.fillText(pp.text, 0, rise);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  return { burst, chips, ink, shake, stop, ring, snap, pop, step, draw, get count() { return live; }, PALETTE };
}
