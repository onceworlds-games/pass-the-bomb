// The beam is the hero: a hot white-gold core, a coloured halo, a wide soft spill on the felt, dust in the light,
// and a bloom made from a quarter-size blurred copy. Everything is drawn in reference coordinates; the scene sets
// the camera transform before calling in.

import { PALETTE } from './felt.js';
import { finite } from '../sim/geom.js';

const RGB = { r: [255, 93, 77], g: [107, 255, 143], b: [93, 180, 255], core: [255, 244, 214] };

/** The display colour of a beam from its channel powers: [r, g, b] 0-255 plus whether it reads as white. */
export function beamColour(seg) {
  const r = Math.max(0, finite(seg.r));
  const g = Math.max(0, finite(seg.g));
  const b = Math.max(0, finite(seg.b));
  const P = r + g + b;
  if (!(P > 0)) return { rgb: RGB.core, white: true };
  const mn = Math.min(r, g, b) / P;
  if (mn > 0.25) return { rgb: RGB.core, white: true };
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = (RGB.r[i] * r + RGB.g[i] * g + RGB.b[i] * b) / P;
  // A pure colour stays vivid; a mix drifts toward the gold core.
  const mx = Math.max(r, g, b) / P;
  const t = Math.min(1, Math.max(0, (mx - 0.5) / 0.5));
  for (let i = 0; i < 3; i++) out[i] = Math.round(out[i] * (0.7 + 0.3 * t) + RGB.core[i] * 0.3 * (1 - t));
  return { rgb: out, white: false };
}

const css = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

/** A tapered quad along a segment, inflated by `pad` on each side. */
function quad(ctx, seg, w0, w1) {
  const nx = -seg.dy;
  const ny = seg.dx;
  ctx.beginPath();
  ctx.moveTo(seg.x0 + nx * w0 * 0.5, seg.y0 + ny * w0 * 0.5);
  ctx.lineTo(seg.x1 + nx * w1 * 0.5, seg.y1 + ny * w1 * 0.5);
  ctx.lineTo(seg.x1 - nx * w1 * 0.5, seg.y1 - ny * w1 * 0.5);
  ctx.lineTo(seg.x0 - nx * w0 * 0.5, seg.y0 - ny * w0 * 0.5);
  ctx.closePath();
}

export function makeBeamRenderer() {
  let glow = null;
  let glowCtx = null;
  const motes = [];
  const MAX_MOTES = { high: 70, medium: 36, low: 0 };
  let seed = 1;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  function ensureGlow(w, h) {
    if (!glow) {
      glow = document.createElement('canvas');
      glowCtx = glow.getContext('2d');
    }
    const gw = Math.max(1, Math.round(w / 4));
    const gh = Math.max(1, Math.round(h / 4));
    if (glow.width !== gw || glow.height !== gh) {
      glow.width = gw;
      glow.height = gh;
    }
  }

  /**
   * Draws the beams. `view` is { scale, ox, oy, w, h } (the camera: reference -> css px), `opts` has
   * quality ('low'|'medium'|'high'), dawn (boolean), dt (seconds), reduced (motion), intensity (0..1 fade-in).
   */
  function draw(ctx, segments, view, opts) {
    const q = opts.quality || 'high';
    const dawn = opts.dawn ? 1.55 : 1;
    const boost = (opts.intensity ?? 1) * dawn;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 0. The spill on the felt: very wide, very faint, in the beam's colour.
    for (const seg of segments) {
      const P = seg.r + seg.g + seg.b;
      if (!(P > 0)) continue;
      const col = beamColour(seg);
      const k = Math.min(1, P / 100);
      ctx.fillStyle = css(col.white ? [120, 150, 90] : col.rgb, 0.06 * boost * k);
      quad(ctx, seg, seg.w0 * 6 + 46, seg.w1 * 6 + 46);
      ctx.fill();
    }
    // 1. The halo in the beam's colour and 2. the core.
    for (const seg of segments) {
      const P = seg.r + seg.g + seg.b;
      if (!(P > 0)) continue;
      const col = beamColour(seg);
      const k = Math.min(1, 0.35 + P / 100);
      ctx.fillStyle = css(col.rgb, 0.16 * boost * k);
      quad(ctx, seg, seg.w0 * 2.6 + 6, seg.w1 * 2.6 + 6);
      ctx.fill();
      ctx.fillStyle = css(col.rgb, 0.5 * boost * k);
      quad(ctx, seg, seg.w0 * 1.3 + 1.5, seg.w1 * 1.3 + 1.5);
      ctx.fill();
      ctx.fillStyle = css(col.white ? RGB.core : mixCore(col.rgb), (0.55 + 0.4 * k) * Math.min(1, boost));
      quad(ctx, seg, Math.max(1.2, seg.w0 * 0.55), Math.max(1.2, seg.w1 * 0.55));
      ctx.fill();
      if (seg.end === 'focus') {
        // The burning point.
        const g = ctx.createRadialGradient(seg.x1, seg.y1, 0, seg.x1, seg.y1, 18);
        g.addColorStop(0, css(RGB.core, 0.9 * boost));
        g.addColorStop(0.3, css(col.rgb, 0.5 * boost));
        g.addColorStop(1, css(col.rgb, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(seg.x1, seg.y1, 18, 0, Math.PI * 2);
        ctx.fill();
      }
      if (seg.end === 'piece' || seg.end === 'mimic' || seg.end === 'heart' || seg.end === 'lamp') {
        const g = ctx.createRadialGradient(seg.x1, seg.y1, 0, seg.x1, seg.y1, 9 + seg.w1);
        g.addColorStop(0, css(RGB.core, 0.6 * boost * k));
        g.addColorStop(1, css(col.rgb, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(seg.x1, seg.y1, 9 + seg.w1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    // 3. Dust motes drifting through the light.
    stepMotes(ctx, segments, opts, q);
    // 4. Bloom: a quarter-size copy of the halo layer, blurred on high quality, laid back over the frame.
    if (q !== 'low' && segments.length && view) bloom(ctx, segments, view, boost, q);
  }

  function mixCore(rgb) {
    return [Math.round((rgb[0] + 255 * 2) / 3), Math.round((rgb[1] + 244 * 2) / 3), Math.round((rgb[2] + 214 * 2) / 3)];
  }

  function stepMotes(ctx, segments, opts, q) {
    const max = MAX_MOTES[q] ?? 0;
    const dt = Math.min(0.1, opts.dt || 0.016);
    if (max && segments.length) {
      for (let k = 0; k < 2 && motes.length < max; k++) {
        const seg = segments[Math.floor(rnd() * segments.length)];
        const P = seg.r + seg.g + seg.b;
        if (!(P > 8)) continue;
        const u = rnd();
        const off = (rnd() - 0.5) * (seg.w0 + 12) * 1.5;
        motes.push({ x: seg.x0 + seg.dx * seg.len * u - seg.dy * off, y: seg.y0 + seg.dy * seg.len * u + seg.dx * off, vx: (rnd() - 0.5) * 6 + seg.dx * 4, vy: (rnd() - 0.5) * 6 + seg.dy * 4 - 3, life: 0, max: 1.2 + rnd() * 1.4, col: beamColour(seg).rgb });
      }
    }
    if (!motes.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i];
      m.life += opts.reduced ? dt * 0.6 : dt;
      if (m.life >= m.max || motes.length > max) {
        motes[i] = motes[motes.length - 1];
        motes.pop();
        continue;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const a = Math.sin((m.life / m.max) * Math.PI) * 0.8;
      ctx.fillStyle = css(m.col, a);
      ctx.fillRect(m.x - 0.8, m.y - 0.8, 1.6, 1.6);
    }
    ctx.restore();
  }

  function bloom(ctx, segments, view, boost, q) {
    ensureGlow(view.w, view.h);
    const g = glowCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, glow.width, glow.height);
    const s = view.scale / 4;
    g.setTransform(s, 0, 0, s, view.ox / 4, view.oy / 4);
    g.globalCompositeOperation = 'lighter';
    for (const seg of segments) {
      const P = seg.r + seg.g + seg.b;
      if (!(P > 0)) continue;
      const col = beamColour(seg);
      const k = Math.min(1, 0.3 + P / 100);
      g.fillStyle = css(col.rgb, 0.55 * k);
      quad(g, seg, seg.w0 * 2 + 10, seg.w1 * 2 + 10);
      g.fill();
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, 0.55 * boost);
    if (q === 'high') {
      try {
        ctx.filter = 'blur(6px)';
      } catch {}
    }
    ctx.drawImage(glow, 0, 0, glow.width, glow.height, 0, 0, view.w, view.h);
    try {
      ctx.filter = 'none';
    } catch {}
    ctx.restore();
  }

  /** The dotted prediction for a piece the player is about to place: thin, dashed, with energy numbers. */
  function drawGhost(ctx, segments, opts = {}) {
    ctx.save();
    ctx.setLineDash([5, 7]);
    ctx.lineCap = 'round';
    for (const seg of segments) {
      const P = seg.r + seg.g + seg.b;
      if (!(P > 0)) continue;
      const col = beamColour(seg);
      ctx.strokeStyle = css(col.rgb, 0.85);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(seg.x0, seg.y0);
      ctx.lineTo(seg.x1, seg.y1);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (opts.labels !== false) {
      ctx.font = `600 ${opts.fontSize || 13}px "Plex", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const seg of segments) {
        const P = seg.r + seg.g + seg.b;
        if (!(P > 0) || seg.len < 40) continue;
        const mx = (seg.x0 + seg.x1) / 2;
        const my = (seg.y0 + seg.y1) / 2;
        const label = String(Math.round(P));
        ctx.fillStyle = 'rgba(5,6,10,0.75)';
        ctx.beginPath();
        ctx.roundRect(mx - 14, my - 9, 28, 18, 5);
        ctx.fill();
        ctx.fillStyle = PALETTE.bone;
        ctx.fillText(label, mx, my + 0.5);
      }
    }
    ctx.restore();
  }

  return { draw, drawGhost, motes };
}
