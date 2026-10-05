// The renderer: backgrounds, obstacles, characters, bombs and icons, in flat bright colors with thick dark outlines and
// offset solid shadows. Everything draws in CSS pixels; `v` (a view) maps arena units to pixels:
//   x_px = v.ox + x * v.s,  y_px = v.oy + y * v.s,  height z lifts a thing by z * v.s.

import { PLAYER_COLORS, W, H, clamp, hash32, rng } from './rules.js';
import { starPath } from './fx.js';

export const INK = '#1b1530';
export const FONT = '"Luckiest Guy", "Arial Black", Impact, system-ui, sans-serif';
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- small helpers

const rgbCache = new Map();
function rgb(hex) {
  let c = rgbCache.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, c);
  }
  return c;
}
const mixCache = new Map();
/** A color between two '#rrggbb' colors. */
export function mix(a, b, t) {
  t = clamp(t, 0, 1);
  const key = a + b + Math.round(t * 32);
  let v = mixCache.get(key);
  if (!v) {
    const x = rgb(a);
    const y = rgb(b);
    const k = Math.round(t * 32) / 32;
    const h = (i) => Math.round(x[i] + (y[i] - x[i]) * k).toString(16).padStart(2, '0');
    v = '#' + h(0) + h(1) + h(2);
    mixCache.set(key, v);
  }
  return v;
}
export const shade = (hex, amt) => (amt >= 0 ? mix(hex, '#ffffff', amt) : mix(hex, '#000000', -amt));
export const easeOutBack = (k) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};
export const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3);

export function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Chunky text: white with a thick dark outline. */
export function text(ctx, str, x, y, size, o = {}) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = o.base || 'middle';
  ctx.lineJoin = 'round';
  const w = o.width ?? size * 0.2;
  if (w > 0) {
    ctx.lineWidth = w;
    ctx.strokeStyle = o.stroke || INK;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = o.fill || '#ffffff';
  ctx.fillText(str, x, y);
}

/** The largest size (at most `size`) at which `str` fits in `maxW` pixels. */
export function fitSize(ctx, str, size, maxW) {
  ctx.font = `${size}px ${FONT}`;
  const w = ctx.measureText(str).width;
  return w > maxW ? Math.max(8, (size * maxW) / w) : size;
}

/** A view of the arena in a w x h window (CSS pixels). `top` pixels are kept for the HUD. */
export function makeView(w, h, pr, o = {}) {
  const top = o.top ?? clamp(Math.round(h * 0.1), 36, 56);
  const bottom = o.bottom ?? 6;
  const s = Math.max(4, Math.min((w - 10) / (W + 1.4), (h - top - bottom) / (H + 1.4)));
  const availH = h - top - bottom;
  return { W: w, H: h, pr, s, ox: (w - W * s) / 2, oy: top + Math.max(2, (availH - H * s) / 2), top, lw: clamp(s * 0.14, 2.5, 5.5) };
}

// ---------------------------------------------------------------- icons

export function iconCheck(ctx, x, y, r) {
  ctx.fillStyle = '#2fd05a';
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2.5, r * 0.22);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(3, r * 0.28);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.45, y + r * 0.02);
  ctx.lineTo(x - r * 0.1, y + r * 0.38);
  ctx.lineTo(x + r * 0.5, y - r * 0.32);
  ctx.stroke();
}

export function iconCrown(ctx, x, y, r, fill = '#ffd21f') {
  ctx.fillStyle = fill;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r, y + r * 0.6);
  ctx.lineTo(x - r * 1.05, y - r * 0.55);
  ctx.lineTo(x - r * 0.5, y);
  ctx.lineTo(x, y - r * 0.8);
  ctx.lineTo(x + r * 0.5, y);
  ctx.lineTo(x + r * 1.05, y - r * 0.55);
  ctx.lineTo(x + r, y + r * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ff4b4b';
  ctx.beginPath();
  ctx.arc(x, y + r * 0.2, r * 0.17, 0, TAU);
  ctx.fill();
}

export function iconStar(ctx, x, y, r, fill = '#ffd21f') {
  ctx.fillStyle = fill;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, r * 0.2);
  ctx.lineJoin = 'round';
  starPath(ctx, x, y, r, 0);
  ctx.fill();
  ctx.stroke();
}

export function iconPerson(ctx, x, y, r, fill = '#ffffff') {
  ctx.fillStyle = fill;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, r * 0.2);
  ctx.beginPath();
  ctx.arc(x, y - r * 0.45, r * 0.38, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - r * 0.75, y + r * 0.8);
  ctx.quadraticCurveTo(x - r * 0.75, y + r * 0.0, x, y + r * 0.0);
  ctx.quadraticCurveTo(x + r * 0.75, y + r * 0.0, x + r * 0.75, y + r * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

export function iconSkull(ctx, x, y, r) {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, r * 0.2);
  ctx.beginPath();
  ctx.arc(x, y - r * 0.1, r * 0.8, 0, TAU);
  ctx.fill();
  ctx.stroke();
  rr(ctx, x - r * 0.4, y + r * 0.45, r * 0.8, r * 0.5, r * 0.15);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.15, r * 0.2, 0, TAU);
  ctx.arc(x + r * 0.3, y - r * 0.15, r * 0.2, 0, TAU);
  ctx.fill();
}

export function iconFlame(ctx, x, y, r) {
  ctx.fillStyle = '#ff8a1f';
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.bezierCurveTo(x + r * 0.2, y - r * 0.55, x + r * 0.95, y - r * 0.25, x + r * 0.75, y + r * 0.35);
  ctx.bezierCurveTo(x + r * 0.6, y + r * 0.95, x - r * 0.6, y + r * 0.95, x - r * 0.75, y + r * 0.35);
  ctx.bezierCurveTo(x - r * 0.9, y - r * 0.1, x - r * 0.35, y - r * 0.3, x - r * 0.3, y - r * 0.65);
  ctx.bezierCurveTo(x - r * 0.15, y - r * 0.5, x - r * 0.05, y - r * 0.8, x, y - r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffd21f';
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.15);
  ctx.bezierCurveTo(x + r * 0.5, y + r * 0.2, x + r * 0.4, y + r * 0.7, x, y + r * 0.7);
  ctx.bezierCurveTo(x - r * 0.4, y + r * 0.7, x - r * 0.45, y + r * 0.2, x, y - r * 0.15);
  ctx.fill();
}

export function iconStopwatch(ctx, x, y, r) {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.lineCap = 'round';
  rr(ctx, x - r * 0.18, y - r * 1.05, r * 0.36, r * 0.25, r * 0.06);
  ctx.fillStyle = '#ff4b4b';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y + r * 0.1, r * 0.82, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ff4b4b';
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.1);
  ctx.arc(x, y + r * 0.1, r * 0.62, -Math.PI / 2, -Math.PI / 2 + 5.2);
  ctx.closePath();
  ctx.globalAlpha = 0.3;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.1);
  ctx.lineTo(x + r * 0.35, y - r * 0.35);
  ctx.stroke();
}

export function iconBombSmall(ctx, x, y, r) {
  ctx.fillStyle = '#2a2a35';
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, r * 0.2);
  ctx.beginPath();
  ctx.arc(x, y + r * 0.1, r * 0.8, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.arc(x, y + r * 0.1, r * 0.55, Math.PI * 1.1, Math.PI * 1.45);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, r * 0.2);
  ctx.beginPath();
  ctx.moveTo(x + r * 0.2, y - r * 0.65);
  ctx.quadraticCurveTo(x + r * 0.5, y - r * 1.0, x + r * 0.8, y - r * 0.85);
  ctx.stroke();
  iconStar(ctx, x + r * 0.85, y - r * 0.9, r * 0.28, '#ffd21f');
}

// ---------------------------------------------------------------- the ground

/** Paints the whole window: the theme outside the arena, the arena floor, its edge and the decor. Static: draw it once. */
export function paintBackground(g, v, map) {
  const pal = map.pal;
  const s = v.s;
  const ox = v.ox;
  const oy = v.oy;
  const r = rng(hash32(map.id));
  g.fillStyle = pal.bg;
  g.fillRect(0, 0, v.W, v.H);
  if (map.id === 'beach') {
    g.strokeStyle = pal.bg2;
    g.lineWidth = Math.max(2, s * 0.12);
    g.lineCap = 'round';
    for (let i = 0; i < 50; i++) {
      const x = r() * v.W;
      const y = r() * v.H;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + s * 0.4, y - s * 0.3, x + s * 0.8, y);
      g.stroke();
    }
  } else {
    g.fillStyle = pal.bg2;
    for (let i = 0; i < 70; i++) {
      g.beginPath();
      g.arc(r() * v.W, r() * v.H, s * (0.12 + r() * 0.2), 0, TAU);
      g.fill();
    }
  }
  const x0 = ox;
  const y0 = oy;
  const aw = W * s;
  const ah = H * s;
  // the edge: a fence along the top (we see its front), a low rim on the other sides
  const fx0 = x0 - 0.5 * s;
  const fx1 = x0 + aw + 0.5 * s;
  const fy0 = y0 - 0.95 * s;
  const fy1 = y0 + ah + 0.5 * s;
  g.fillStyle = 'rgba(0,0,0,0.25)';
  rr(g, fx0 + 0.3 * s, fy0 + 0.35 * s, fx1 - fx0, fy1 - fy0, 0.4 * s);
  g.fill();
  g.fillStyle = pal.edge;
  g.strokeStyle = INK;
  g.lineWidth = v.lw;
  g.lineJoin = 'round';
  rr(g, fx0, fy0, fx1 - fx0, fy1 - fy0, 0.4 * s);
  g.fill();
  g.stroke();
  g.strokeStyle = pal.edgeDark;
  g.lineWidth = Math.max(1.5, v.lw * 0.5);
  if (map.id === 'backyard') {
    for (let x = fx0 + 0.45 * s; x < fx1 - 0.3 * s; x += 0.7 * s) {
      g.beginPath();
      g.moveTo(x, fy0 + 0.1 * s);
      g.lineTo(x, y0 - 0.05 * s);
      g.stroke();
    }
  } else if (map.id === 'beach') {
    g.setLineDash([s * 0.35, s * 0.3]);
    g.beginPath();
    g.moveTo(fx0 + 0.3 * s, fy0 + 0.45 * s);
    g.lineTo(fx1 - 0.3 * s, fy0 + 0.45 * s);
    g.stroke();
    g.setLineDash([]);
  } else {
    g.fillStyle = pal.edgeDark;
    for (let x = fx0 + 0.6 * s; x < fx1 - 0.3 * s; x += 2.4 * s) {
      g.beginPath();
      g.arc(x, fy0 + 0.45 * s, Math.max(2, s * 0.1), 0, TAU);
      g.fill();
    }
  }
  // the floor
  g.fillStyle = pal.ground;
  g.strokeStyle = INK;
  g.lineWidth = v.lw;
  g.fillRect(x0, y0, aw, ah);
  g.save();
  g.beginPath();
  g.rect(x0, y0, aw, ah);
  g.clip();
  g.fillStyle = pal.stripe;
  if (map.id === 'backyard') {
    for (let i = 1; i < 12; i += 2) g.fillRect(x0 + i * 2 * s, y0, 2 * s, ah);
    g.strokeStyle = pal.edgeDark;
    g.globalAlpha = 0.25;
    g.lineWidth = Math.max(1.5, s * 0.07);
    g.lineCap = 'round';
    for (let i = 0; i < 60; i++) {
      const x = x0 + r() * aw;
      const y = y0 + r() * ah;
      g.beginPath();
      g.moveTo(x - s * 0.1, y);
      g.lineTo(x, y - s * 0.22);
      g.lineTo(x + s * 0.1, y);
      g.stroke();
    }
    g.globalAlpha = 1;
  } else if (map.id === 'beach') {
    for (let i = 0; i < 180; i++) {
      g.beginPath();
      g.arc(x0 + r() * aw, y0 + r() * ah, s * (0.04 + r() * 0.05), 0, TAU);
      g.fill();
    }
    g.strokeStyle = pal.stripe;
    g.lineWidth = Math.max(2, s * 0.1);
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const x = x0 + r() * aw * 0.9;
      const y = y0 + r() * ah;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + s, y - s * 0.4, x + s * 2, y);
      g.stroke();
    }
  } else {
    for (let j = 0; j < 7; j++) for (let i = 0; i < 12; i++) if ((i + j) % 2 === 1) g.fillRect(x0 + i * 2 * s, y0 + j * 2 * s, 2 * s, 2 * s);
  }
  for (const d of map.decor) paintDecor(g, v, d, r, map);
  g.restore();
  g.strokeStyle = INK;
  g.lineWidth = v.lw;
  g.strokeRect(x0, y0, aw, ah);
}

function paintDecor(g, v, d, r, map) {
  const s = v.s;
  const X = v.ox + d.x * s;
  const Y = v.oy + d.y * s;
  g.lineJoin = 'round';
  if (d.k === 'flowers') {
    g.fillStyle = '#8a5a2b';
    g.strokeStyle = INK;
    g.lineWidth = Math.max(2, v.lw * 0.7);
    rr(g, X - (d.w * s) / 2, Y - (d.h * s) / 2, d.w * s, d.h * s, 0.2 * s);
    g.fill();
    g.stroke();
    const cols = ['#ff5cc8', '#ffd21f', '#ffffff', '#ff4b4b'];
    const n = Math.round(d.w * d.h * 5);
    for (let i = 0; i < n; i++) {
      const fx = X + (r() - 0.5) * (d.w * s - 0.4 * s);
      const fy = Y + (r() - 0.5) * (d.h * s - 0.3 * s);
      g.fillStyle = cols[i % 4];
      g.beginPath();
      g.arc(fx, fy, s * 0.13, 0, TAU);
      g.fill();
      g.fillStyle = '#ffd21f';
      g.beginPath();
      g.arc(fx, fy, s * 0.05, 0, TAU);
      g.fill();
    }
  } else if (d.k === 'towel') {
    const w = d.w * s;
    const h = d.h * s;
    g.strokeStyle = INK;
    g.lineWidth = Math.max(2, v.lw * 0.7);
    g.fillStyle = '#ffffff';
    g.fillRect(X - w / 2, Y - h / 2, w, h);
    g.fillStyle = d.hue;
    for (let i = 0; i < 5; i += 2) g.fillRect(X - w / 2 + (i * w) / 5, Y - h / 2, w / 5, h);
    g.strokeRect(X - w / 2, Y - h / 2, w, h);
  } else if (d.k === 'shell') {
    g.fillStyle = '#ffb3c7';
    g.strokeStyle = INK;
    g.lineWidth = Math.max(1.5, v.lw * 0.5);
    g.beginPath();
    g.arc(X, Y, s * 0.2, 0, TAU);
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(X, Y, s * 0.08, 0, 4.5);
    g.stroke();
  } else if (d.k === 'ring') {
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.lineWidth = s * 0.22;
    g.beginPath();
    g.arc(X, Y, d.r * s, 0, TAU);
    g.stroke();
  } else if (d.k === 'line') {
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillRect(X - (d.w * s) / 2, Y - (d.h * s) / 2, d.w * s, d.h * s);
  }
}

// ---------------------------------------------------------------- obstacles

function lineStyle(ctx, v, k = 1) {
  ctx.lineWidth = v.lw * k;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

function box(ctx, v, o, ht, top, front) {
  const s = v.s;
  const x0 = v.ox + o.x0 * s;
  const x1 = v.ox + o.x1 * s;
  const y0 = v.oy + o.y0 * s;
  const y1 = v.oy + o.y1 * s;
  const hp = ht * s;
  ctx.fillStyle = 'rgba(20,20,40,0.22)';
  ctx.fillRect(x0 + 0.22 * s, y0 + 0.18 * s, x1 - x0, y1 - y0);
  lineStyle(ctx, v);
  ctx.fillStyle = front;
  ctx.fillRect(x0, y1 - hp, x1 - x0, hp);
  ctx.strokeRect(x0, y1 - hp, x1 - x0, hp);
  ctx.fillStyle = top;
  ctx.fillRect(x0, y0 - hp, x1 - x0, y1 - y0);
  ctx.strokeRect(x0, y0 - hp, x1 - x0, y1 - y0);
  return { x0, x1, y0: y0 - hp, y1: y1 - hp, fy0: y1 - hp, fy1: y1 };
}

function cyl(ctx, v, cx, cy, r, ht, top, side, shadow = true) {
  const s = v.s;
  const px = v.ox + cx * s;
  const py = v.oy + cy * s;
  const rx = r * s;
  const hp = ht * s;
  if (shadow) {
    ctx.fillStyle = 'rgba(20,20,40,0.22)';
    ctx.beginPath();
    ctx.arc(px + 0.2 * s, py + 0.16 * s, rx, 0, TAU);
    ctx.fill();
  }
  lineStyle(ctx, v);
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.moveTo(px - rx, py - hp);
  ctx.lineTo(px - rx, py);
  ctx.arc(px, py, rx, Math.PI, 0, true);
  ctx.lineTo(px + rx, py - hp);
  ctx.arc(px, py - hp, rx, 0, Math.PI, false);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.arc(px, py - hp, rx, 0, TAU);
  ctx.fill();
  ctx.stroke();
  return { px, py: py - hp, rx };
}

/** The part of an obstacle you walk around (drawn in depth order with the characters). */
export function drawObstacle(ctx, v, o, t) {
  const s = v.s;
  switch (o.kind) {
    case 'crate': {
      const b = box(ctx, v, o, 0.7, '#e6b878', '#c98c48');
      ctx.strokeStyle = 'rgba(27,21,48,0.55)';
      ctx.lineWidth = Math.max(1.5, v.lw * 0.5);
      ctx.beginPath();
      ctx.moveTo(b.x0, b.fy0);
      ctx.lineTo(b.x1, b.fy1);
      ctx.moveTo(b.x1, b.fy0);
      ctx.lineTo(b.x0, b.fy1);
      ctx.moveTo(b.x0, b.y0);
      ctx.lineTo(b.x1, b.y1);
      ctx.moveTo(b.x1, b.y0);
      ctx.lineTo(b.x0, b.y1);
      ctx.stroke();
      break;
    }
    case 'house': {
      const b = box(ctx, v, o, 1.0, '#c0503f', '#ecd9ae');
      ctx.fillStyle = INK;
      rr(ctx, (b.x0 + b.x1) / 2 - 0.32 * s, b.fy1 - 0.62 * s, 0.64 * s, 0.62 * s, 0.3 * s);
      ctx.fill();
      break;
    }
    case 'pool': {
      const px = v.ox + o.x * s;
      const py = v.oy + o.y * s;
      cyl(ctx, v, o.x, o.y, o.r, 0.25, '#ffffff', '#d9e6ee');
      const cy = py - 0.25 * s;
      ctx.fillStyle = '#62cbf7';
      lineStyle(ctx, v, 0.7);
      ctx.beginPath();
      ctx.arc(px, cy, o.r * s * 0.8, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = Math.max(2, v.lw * 0.8);
      for (let i = 0; i < 3; i++) {
        const a = Math.sin(t * 1.6 + i * 2.1) * 0.35;
        ctx.beginPath();
        ctx.arc(px + (i - 1) * o.r * s * 0.35, cy + (i - 1) * o.r * s * 0.2, o.r * s * 0.22, Math.PI * 1.15 + a, Math.PI * 1.85 + a);
        ctx.stroke();
      }
      break;
    }
    case 'tree': {
      cyl(ctx, v, o.x, o.y, 0.6, 1.0, '#a8703d', '#7d4d22');
      break;
    }
    case 'castle': {
      const base = cyl(ctx, v, o.x, o.y, o.r, 0.8, '#f2d089', '#d6a559');
      cyl(ctx, v, o.x, o.y - 0.8, 0.62, 0.9, '#f8e0a4', '#dfb468', false);
      const topY = base.py - 0.9 * s;
      lineStyle(ctx, v, 0.8);
      ctx.beginPath();
      ctx.moveTo(base.px, topY);
      ctx.lineTo(base.px, topY - 0.7 * s);
      ctx.stroke();
      ctx.fillStyle = '#ff4b4b';
      ctx.beginPath();
      ctx.moveTo(base.px, topY - 0.7 * s);
      ctx.lineTo(base.px + 0.45 * s, topY - 0.55 * s);
      ctx.lineTo(base.px, topY - 0.4 * s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'umbrella': {
      cyl(ctx, v, o.x, o.y, o.r, 0.22, '#ffffff', '#cfd8dc');
      const px = v.ox + o.x * s;
      const py = v.oy + o.y * s - 0.22 * s;
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(4, v.lw * 2.1);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - 1.8 * s);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, v.lw * 1.0);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - 1.8 * s);
      ctx.stroke();
      break;
    }
    case 'rock': {
      cyl(ctx, v, o.x, o.y, o.r, 0.6, '#b4bdc6', '#808a95');
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(v.ox + (o.x - o.r * 0.3) * s, v.oy + o.y * s - 0.6 * s - o.r * s * 0.3, o.r * s * 0.3, o.r * s * 0.16, -0.5, 0, TAU);
      ctx.fill();
      break;
    }
    case 'slide': {
      const b = box(ctx, v, o, 1.1, '#ffd23f', '#3b82e0');
      ctx.fillStyle = '#e8a21a';
      lineStyle(ctx, v, 0.7);
      ctx.fillRect(b.x0, b.y0, 0.8 * s, b.y1 - b.y0);
      ctx.strokeRect(b.x0, b.y0, 0.8 * s, b.y1 - b.y0);
      ctx.beginPath();
      for (let i = 1; i < 4; i++) {
        const yy = b.y0 + ((b.y1 - b.y0) * i) / 4;
        ctx.moveTo(b.x0, yy);
        ctx.lineTo(b.x0 + 0.8 * s, yy);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = Math.max(2, v.lw * 0.9);
      ctx.beginPath();
      ctx.moveTo(b.x0 + 1.2 * s, (b.y0 + b.y1) / 2);
      ctx.lineTo(b.x1 - 0.3 * s, (b.y0 + b.y1) / 2);
      ctx.stroke();
      break;
    }
    case 'swing': {
      cyl(ctx, v, o.x, o.y, 0.36, 2.0, '#ff7b6b', '#d9473f');
      break;
    }
    case 'sandbox': {
      const b = box(ctx, v, o, 0.3, '#c58a45', '#9a6428');
      ctx.fillStyle = '#f6d98b';
      lineStyle(ctx, v, 0.6);
      ctx.fillRect(b.x0 + 0.25 * s, b.y0 + 0.25 * s, b.x1 - b.x0 - 0.5 * s, b.y1 - b.y0 - 0.5 * s);
      ctx.strokeRect(b.x0 + 0.25 * s, b.y0 + 0.25 * s, b.x1 - b.x0 - 0.5 * s, b.y1 - b.y0 - 0.5 * s);
      break;
    }
    case 'bench': {
      const b = box(ctx, v, o, 0.5, '#d6914a', '#9a6428');
      ctx.fillStyle = INK;
      ctx.fillRect(b.x0 + 0.2 * s, b.fy1 - 0.2 * s, 0.22 * s, 0.2 * s);
      ctx.fillRect(b.x1 - 0.42 * s, b.fy1 - 0.2 * s, 0.22 * s, 0.2 * s);
      break;
    }
    case 'tires': {
      const c = cyl(ctx, v, o.x, o.y, o.r, 0.5, '#454556', '#2a2a35');
      ctx.fillStyle = '#17171f';
      ctx.beginPath();
      ctx.arc(c.px, c.py, c.rx * 0.42, 0, TAU);
      ctx.fill();
      break;
    }
    default: {
      if (o.t === 'circle') cyl(ctx, v, o.x, o.y, o.r, 0.5, '#ccc', '#999');
      else box(ctx, v, o, 0.5, '#ccc', '#999');
    }
  }
}

/** The part of an obstacle that is above the players (tree tops, umbrellas, the swing bar): drawn see-through. */
export function drawOverhead(ctx, v, o, alpha) {
  const s = v.s;
  if (o.kind === 'tree') {
    const px = v.ox + o.x * s;
    const py = v.oy + o.y * s - 1.6 * s;
    ctx.globalAlpha = alpha;
    lineStyle(ctx, v);
    ctx.fillStyle = '#3aa63a';
    ctx.beginPath();
    ctx.arc(px, py, 1.75 * s, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#58c256';
    ctx.beginPath();
    ctx.arc(px - 0.55 * s, py - 0.5 * s, 0.85 * s, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2d8f31';
    ctx.beginPath();
    ctx.arc(px + 0.7 * s, py + 0.5 * s, 0.7 * s, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (o.kind === 'umbrella') {
    const px = v.ox + o.x * s;
    const py = v.oy + o.y * s - 2.0 * s;
    ctx.globalAlpha = alpha;
    const rad = 1.7 * s;
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : o.hue;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, rad, (i * TAU) / 8, ((i + 1) * TAU) / 8);
      ctx.closePath();
      ctx.fill();
    }
    lineStyle(ctx, v);
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(px, py, s * 0.1, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (o.kind === 'swing') {
    const px = v.ox + o.x * s;
    const py = v.oy + o.y * s - 2.0 * s;
    ctx.globalAlpha = Math.max(alpha, 0.9);
    ctx.fillStyle = '#ff7b6b';
    lineStyle(ctx, v);
    ctx.beginPath();
    ctx.arc(px, py, 0.32 * s, 0, TAU);
    ctx.fill();
    ctx.stroke();
    if (o.bar !== undefined) {
      const bx = v.ox + o.bar * s;
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(5, v.lw * 2.4);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(bx, py);
      ctx.stroke();
      ctx.strokeStyle = '#ff7b6b';
      ctx.lineWidth = Math.max(3, v.lw * 1.3);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(bx, py);
      ctx.stroke();
      for (const k of [0.3, 0.7]) {
        const cx = px + (bx - px) * k;
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1.5, v.lw * 0.5);
        ctx.beginPath();
        ctx.moveTo(cx - 0.17 * s, py);
        ctx.lineTo(cx - 0.17 * s, py + 1.15 * s);
        ctx.moveTo(cx + 0.17 * s, py);
        ctx.lineTo(cx + 0.17 * s, py + 1.15 * s);
        ctx.stroke();
        ctx.fillStyle = '#38a8ff';
        lineStyle(ctx, v, 0.7);
        rr(ctx, cx - 0.3 * s, py + 1.1 * s, 0.6 * s, 0.17 * s, 0.06 * s);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}

export const hasOverhead = (o) => o.kind === 'tree' || o.kind === 'umbrella' || o.kind === 'swing';

// ---------------------------------------------------------------- characters

/** A figure to draw: everything the renderer needs, filled in each frame by the game (or staged by a poster). */
export function newFig(id) {
  return {
    id, seen: 0,
    x: 0, y: 0, vx: 0, vy: 0, dash: false, prevDash: false,
    name: '', c: 0, bot: false, img: null,
    z: 0, rot: 0, alpha: 1, sx: 1, sy: 1, sq: 0, sqv: 0, run: 0, popT: 1, stepAcc: 0,
    hold: false, heat: 0, imm: false, stun: false, ghost: false, soot: 0, fly: -1, ghostT: 1,
    me: false, away: false, ready: false, readyT: 0, you: false, cd: -1, win: false, cheer: 0,
    dx: 0, dy: 0, seed: hash32(id) % 1000,
  };
}

/** A head: the player's avatar when it has loaded, else a face in their color (bots wear an antenna). */
export function drawHead(ctx, x, y, r, f, lw, t) {
  const col = PLAYER_COLORS[f.c % PLAYER_COLORS.length];
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  if (f.soot > 0) {
    ctx.lineWidth = lw * 1.3;
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      ctx.moveTo(x + i * r * 0.25, y - r * 0.85);
      ctx.lineTo(x + i * r * 0.42, y - r * (1.55 + (i % 2 ? 0.1 : 0.3)));
    }
    ctx.stroke();
    ctx.lineWidth = lw;
    ctx.fillStyle = '#34323c';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.34, y - r * 0.12, r * 0.22, r * 0.3, 0, 0, TAU);
    ctx.ellipse(x + r * 0.34, y - r * 0.12, r * 0.22, r * 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x - r * 0.34, y - r * 0.08, r * 0.09, 0, TAU);
    ctx.arc(x + r * 0.34, y - r * 0.08, r * 0.09, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.42, r * 0.2, r * 0.26, 0, 0, TAU);
    ctx.fill();
    return;
  }
  if (f.bot) {
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.95);
    ctx.lineTo(x, y - r * 1.45);
    ctx.stroke();
    ctx.fillStyle = '#ff4b4b';
    ctx.beginPath();
    ctx.arc(x, y - r * 1.5, r * 0.2, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  if (f.img) {
    const ar = f.img.naturalWidth > 0 && f.img.naturalHeight > 0 ? f.img.naturalHeight / f.img.naturalWidth : 88 / 120;
    const iw = r * 2.5;
    const ih = iw * ar;
    ctx.fillStyle = shade(col, 0.45);
    ctx.beginPath();
    ctx.arc(x, y + r * 0.05, r * 0.92, 0, TAU);
    ctx.fill();
    ctx.stroke();
    try {
      ctx.drawImage(f.img, x - iw / 2, y - ih / 2, iw, ih);
    } catch {
      // an image that failed to decode: the disc stays
    }
    return;
  }
  ctx.fillStyle = shade(col, 0.3);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.stroke();
  const lx = clamp(f.vx * 0.02, -0.12, 0.12) * r * 2;
  const ly = clamp(f.vy * 0.02, -0.1, 0.1) * r * 2;
  if (f.stun) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw * 0.8;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + sx * r * 0.34 - r * 0.15, y - r * 0.25);
      ctx.lineTo(x + sx * r * 0.34 + r * 0.15, y + r * 0.05);
      ctx.moveTo(x + sx * r * 0.34 + r * 0.15, y - r * 0.25);
      ctx.lineTo(x + sx * r * 0.34 - r * 0.15, y + r * 0.05);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = lw * 0.6;
    ctx.beginPath();
    ctx.ellipse(x - r * 0.34, y - r * 0.12, r * 0.24, r * 0.3, 0, 0, TAU);
    ctx.ellipse(x + r * 0.34, y - r * 0.12, r * 0.24, r * 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x - r * 0.34 + lx, y - r * 0.1 + ly, r * 0.12, 0, TAU);
    ctx.arc(x + r * 0.34 + lx, y - r * 0.1 + ly, r * 0.12, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 0.8;
  if (f.heat > 0.5 || f.stun) {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.45, r * 0.16, r * 0.2, 0, 0, TAU);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(x, y + r * 0.2, r * 0.32, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,90,120,0.4)';
  ctx.beginPath();
  ctx.arc(x - r * 0.62, y + r * 0.22, r * 0.14, 0, TAU);
  ctx.arc(x + r * 0.62, y + r * 0.22, r * 0.14, 0, TAU);
  ctx.fill();
}

function drawGhost(ctx, v, f, t, gx, gy) {
  const u = v.s;
  const bob = Math.sin(t * 2.2 + f.seed) * 0.12 * u;
  ctx.globalAlpha = 0.62 * f.alpha * clamp(f.ghostT, 0, 1);
  const cx = gx;
  const cy = gy - 1.15 * u + bob;
  const r = 0.5 * u;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = INK;
  ctx.lineWidth = v.lw;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.lineTo(cx + r, cy + r * 1.1);
  const w = (r * 2) / 3;
  for (let i = 0; i < 3; i++) {
    const x1 = cx + r - i * w;
    ctx.quadraticCurveTo(x1 - w * 0.25, cy + r * 1.55, x1 - w * 0.5, cy + r * 1.1);
    ctx.quadraticCurveTo(x1 - w * 0.75, cy + r * 0.7, x1 - w, cy + r * 1.1);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.33, cy - r * 0.1, r * 0.11, r * 0.17, 0, 0, TAU);
  ctx.ellipse(cx + r * 0.33, cy - r * 0.1, r * 0.11, r * 0.17, 0, 0, TAU);
  ctx.ellipse(cx, cy + r * 0.38, r * 0.13, r * 0.17, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** The ground marks under a figure: your own ring, the holder's red pulse, the immune shield, the dash recharge. */
export function drawRings(ctx, v, f, t) {
  if (f.ghost || f.alpha <= 0.05 || f.fly >= 0) return;
  const u = v.s;
  const gx = v.ox + f.x * u;
  const gy = v.oy + f.y * u;
  ctx.lineCap = 'round';
  if (f.hold) {
    const rad = (0.88 + Math.sin(t * 8) * 0.07) * u;
    ctx.strokeStyle = INK;
    ctx.lineWidth = v.lw * 2.6;
    ctx.beginPath();
    ctx.arc(gx, gy, rad, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = v.lw * 1.4;
    ctx.beginPath();
    ctx.arc(gx, gy, rad, 0, TAU);
    ctx.stroke();
  } else if (f.imm) {
    ctx.strokeStyle = '#8ad8ff';
    ctx.lineWidth = v.lw * 1.2;
    ctx.setLineDash([u * 0.28, u * 0.22]);
    ctx.lineDashOffset = -t * u * 1.5;
    ctx.beginPath();
    ctx.arc(gx, gy, 0.8 * u, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (f.me) {
    ctx.strokeStyle = 'rgba(27,21,48,0.8)';
    ctx.lineWidth = v.lw * 1.9;
    ctx.beginPath();
    ctx.arc(gx, gy, 0.64 * u, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = v.lw * 0.95;
    ctx.beginPath();
    ctx.arc(gx, gy, 0.64 * u, 0, TAU);
    ctx.stroke();
    if (f.cd > 0) {
      // the dash recharging: a yellow arc fills round the feet
      ctx.strokeStyle = '#ffd21f';
      ctx.lineWidth = v.lw * 1.1;
      ctx.beginPath();
      ctx.arc(gx, gy, 0.64 * u, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - clamp(f.cd, 0, 1)));
      ctx.stroke();
    }
  }
}

export function drawFigure(ctx, v, f, t) {
  if (f.alpha <= 0.01) return;
  const u = v.s;
  const lw = v.lw;
  const gx = v.ox + f.x * u;
  const gy = v.oy + f.y * u;
  if (f.ghost) {
    drawGhost(ctx, v, f, t, gx, gy);
    return;
  }
  const col = PLAYER_COLORS[f.c % PLAYER_COLORS.length];
  const lift = f.z * u;
  ctx.globalAlpha = f.alpha;
  const sh = 1 - Math.min(0.6, f.z * 0.08);
  ctx.fillStyle = 'rgba(20,20,40,0.24)';
  ctx.beginPath();
  ctx.ellipse(gx + 0.1 * u, gy + 0.08 * u, 0.52 * u * sh, 0.24 * u * sh, 0, 0, TAU);
  ctx.fill();
  // a dash leaves faded copies behind
  if (f.dash) {
    const sp = Math.hypot(f.vx, f.vy) || 1;
    const dx = f.vx / sp;
    const dy = f.vy / sp;
    ctx.fillStyle = col;
    for (let k = 1; k <= 3; k++) {
      ctx.globalAlpha = (f.alpha * 0.3) / k;
      ctx.beginPath();
      ctx.ellipse(gx - dx * k * 0.6 * u, gy - dy * k * 0.6 * u - 0.7 * u, 0.5 * u, 0.62 * u, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = f.alpha;
  }
  let pop = 1;
  if (f.popT < 0.4) pop = Math.max(0.05, easeOutBack(f.popT / 0.4));
  ctx.save();
  ctx.translate(gx, gy - lift);
  ctx.scale(f.sx * pop, f.sy * pop);
  if (f.rot) {
    ctx.translate(0, -0.9 * u); // spin about the middle of the body
    ctx.rotate(f.rot);
    ctx.translate(0, 0.9 * u);
  }
  const body = f.heat > 0 ? mix(col, '#ff3b3b', f.heat * 0.5) : col;
  const dark = shade(body, -0.38);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  // feet
  const sw = Math.sin(f.run);
  const l1 = Math.max(0, sw) * 0.18 * u;
  const l2 = Math.max(0, -sw) * 0.18 * u;
  ctx.fillStyle = f.soot > 0 ? '#34323c' : dark;
  ctx.beginPath();
  ctx.ellipse(-0.23 * u, -0.07 * u - l1, 0.21 * u, 0.12 * u, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0.23 * u, -0.07 * u - l2, 0.21 * u, 0.12 * u, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  // arms (up when holding the bomb or cheering)
  const up = f.hold || f.cheer > 0;
  const armY = up ? -1.0 * u - Math.sin(t * 9 + f.seed) * 0.05 * u * (f.cheer > 0 ? 3 : 1) : -0.55 * u + sw * 0.1 * u;
  const armY2 = up ? armY : -0.55 * u - sw * 0.1 * u;
  ctx.fillStyle = f.soot > 0 ? '#34323c' : body;
  ctx.beginPath();
  ctx.arc(-0.58 * u, armY, 0.17 * u, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0.58 * u, armY2, 0.17 * u, 0, TAU);
  ctx.fill();
  ctx.stroke();
  // body
  ctx.fillStyle = f.soot > 0 ? '#34323c' : body;
  rr(ctx, -0.5 * u, -0.97 * u, 1.0 * u, 0.84 * u, 0.3 * u);
  ctx.fill();
  ctx.stroke();
  if (f.soot <= 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    rr(ctx, -0.36 * u, -0.9 * u, 0.3 * u, 0.15 * u, 0.07 * u);
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.globalAlpha = f.alpha * 0.5;
    rr(ctx, -0.5 * u, -0.34 * u, 1.0 * u, 0.2 * u, 0.1 * u);
    ctx.fill();
    ctx.globalAlpha = f.alpha;
  }
  // head
  drawHead(ctx, 0, -1.42 * u + Math.abs(sw) * 0.04 * u, 0.52 * u, f, lw, t);
  ctx.restore();
  ctx.globalAlpha = 1;
  // sweat drops on a nervous holder
  if (f.heat > 0.3) {
    ctx.fillStyle = '#8ad8ff';
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, lw * 0.5);
    for (let i = 0; i < 3; i++) {
      const ph = (t * 1.7 + i * 0.37 + f.seed) % 1;
      const sx = gx + (i - 1) * 0.5 * u + Math.sin(f.seed + i) * 0.08 * u;
      const sy = gy - lift - 1.75 * u + ph * 0.55 * u;
      ctx.globalAlpha = (1 - ph) * f.alpha;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 0.12 * u);
      ctx.quadraticCurveTo(sx + 0.1 * u, sy + 0.02 * u, sx, sy + 0.08 * u);
      ctx.quadraticCurveTo(sx - 0.1 * u, sy + 0.02 * u, sx, sy - 0.12 * u);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // stars circling a stunned head
  if (f.stun) {
    for (let i = 0; i < 3; i++) {
      const a = t * 7 + (i * TAU) / 3;
      iconStar(ctx, gx + Math.cos(a) * 0.55 * u, gy - lift - 2.0 * u + Math.sin(a) * 0.14 * u, 0.15 * u, '#ffd21f');
    }
  }
}

/** The name under a figure's feet. */
export function drawTag(ctx, v, f) {
  if (!f.name || f.alpha <= 0.05) return;
  const size = clamp(v.s * 0.52, 11, 19);
  const gx = v.ox + f.x * v.s;
  const gy = v.oy + (f.y - (f.fly >= 0 ? f.z : 0)) * v.s + 0.72 * v.s + size * 0.5;
  ctx.globalAlpha = (f.ghost ? 0.6 : 1) * Math.min(1, f.alpha);
  text(ctx, f.name, gx, gy, size, { fill: f.me ? '#ffe066' : '#ffffff', width: size * 0.26 });
  if (f.away) text(ctx, 'Zz', gx + v.s * 0.8, gy - v.s * 1.6, size * 0.9, { fill: '#cfe8ff' });
  ctx.globalAlpha = 1;
}

/** The bouncing "YOU" arrow, shown for the first moments of a round. */
export function drawYou(ctx, v, f, t) {
  const u = v.s;
  const x = v.ox + f.x * u;
  const base = v.oy + f.y * u - (f.hold ? 3.5 : 2.55) * u - Math.abs(Math.sin(t * 6)) * 0.35 * u;
  ctx.fillStyle = '#ffd21f';
  ctx.strokeStyle = INK;
  ctx.lineWidth = v.lw * 1.1;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, base + 0.15 * u);
  ctx.lineTo(x - 0.4 * u, base - 0.3 * u);
  ctx.lineTo(x - 0.15 * u, base - 0.3 * u);
  ctx.lineTo(x - 0.15 * u, base - 0.65 * u);
  ctx.lineTo(x + 0.15 * u, base - 0.65 * u);
  ctx.lineTo(x + 0.15 * u, base - 0.3 * u);
  ctx.lineTo(x + 0.4 * u, base - 0.3 * u);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  text(ctx, 'YOU', x, base - 1.0 * u, clamp(u * 0.62, 13, 24), { fill: '#ffd21f' });
}

/** The big READY check over a ready player. */
export function drawReady(ctx, v, f) {
  const u = v.s;
  const k = easeOutBack(clamp(f.readyT / 0.35, 0, 1));
  const x = v.ox + f.x * u;
  const y = v.oy + f.y * u - 2.35 * u;
  iconCheck(ctx, x, y, Math.max(10, 0.55 * u) * Math.max(0.01, k));
}

// ---------------------------------------------------------------- the bomb

/**
 * b: { x, y, z (height of its center in units), scale, flash (0..1 red), fuse (0..1 left), fall (0..1 while dropping, else -1) }
 */
export function drawBomb(ctx, v, b, t) {
  const u = v.s;
  const lw = v.lw;
  const px = v.ox + b.x * u;
  const py = v.oy + (b.y - b.z) * u;
  if (b.fall >= 0 && b.fall < 1) {
    ctx.fillStyle = 'rgba(20,20,40,0.32)';
    ctx.beginPath();
    ctx.ellipse(v.ox + b.x * u, v.oy + b.y * u + 0.05 * u, (0.2 + 0.4 * b.fall) * u, (0.1 + 0.2 * b.fall) * u, 0, 0, TAU);
    ctx.fill();
  }
  const r = 0.56 * u * b.scale;
  ctx.save();
  ctx.translate(px, py);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = lw * 1.15;
  ctx.strokeStyle = INK;
  ctx.fillStyle = b.flash > 0 ? mix('#2a2a35', '#ff3b3b', b.flash) : '#2a2a35';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(2, lw * 0.9);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.68, Math.PI * 1.12, Math.PI * 1.45);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(-r * 0.5, -r * 0.5, r * 0.09, 0, TAU);
  ctx.fill();
  // the cap
  ctx.fillStyle = '#707080';
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  rr(ctx, -r * 0.24, -r * 1.2, r * 0.48, r * 0.32, r * 0.08);
  ctx.fill();
  ctx.stroke();
  // the fuse burns down
  const len = 0.3 + 0.7 * clamp(b.fuse, 0, 1);
  const ex = r * 0.75 * len;
  const ey = -r * 1.2 - r * 0.62 * len;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.2);
  ctx.quadraticCurveTo(r * 0.45 * len, -r * 1.25, ex, ey);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 2.1;
  ctx.stroke();
  ctx.strokeStyle = '#f2d28b';
  ctx.lineWidth = lw * 0.95;
  ctx.stroke();
  // the spark
  const flick = 0.85 + Math.sin(t * 38 + b.x * 3) * 0.2;
  ctx.fillStyle = 'rgba(255,190,50,0.38)';
  ctx.beginPath();
  ctx.arc(ex, ey, r * 0.52 * flick, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ffd21f';
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, lw * 0.6);
  starPath(ctx, ex, ey, r * 0.34 * flick, t * 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(ex, ey, r * 0.1, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- the world

/**
 * Draws the arena's contents: ground rings, obstacles and figures in depth order, overhead parts, particles, bombs,
 * and the labels. `scene`: { figs: [figure] (any order), bombs: [bomb], fx }.
 */
export function drawWorld(ctx, v, map, scene, t) {
  const figs = scene.figs;
  for (let i = 0; i < figs.length; i++) drawRings(ctx, v, figs[i], t);
  figs.sort(byY);
  const obs = map.obstacles;
  let fi = 0;
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    while (fi < figs.length && figs[fi].y + 0.2 < o.sortY) drawFigure(ctx, v, figs[fi++], t);
    drawObstacle(ctx, v, o, t);
  }
  while (fi < figs.length) drawFigure(ctx, v, figs[fi++], t);
  for (let i = 0; i < obs.length; i++) if (hasOverhead(obs[i])) drawOverhead(ctx, v, obs[i], 0.66);
  if (scene.fx) scene.fx.draw(ctx, v);
  for (let i = 0; i < scene.bombs.length; i++) drawBomb(ctx, v, scene.bombs[i], t);
  for (let i = 0; i < figs.length; i++) {
    const f = figs[i];
    if (f.ready) drawReady(ctx, v, f);
    if (f.you && !f.ghost) drawYou(ctx, v, f, t);
    drawTag(ctx, v, f);
  }
  if (scene.fx) scene.fx.drawFloaters(ctx, v, FONT);
}

function byY(a, b) {
  return a.y - b.y;
}
