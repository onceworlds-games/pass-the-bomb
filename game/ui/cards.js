// Small canvases of the glass and the Shades for cards, drafts and the almanac, in the game's own style.

import { drawPiece } from '../render/glass.js';
import { makeShadeRenderer } from '../render/shades.js';
import { makeShade, SHADES } from '../sim/shades.js';
import { CELL, BOARD_DEFS } from '../sim/boards.js';

const cache = new Map();
let shadeRenderer = null;

/** A canvas showing one piece type, `size` css px square. */
export function pieceIcon(type, size = 56, opts = {}) {
  const key = `p:${type}:${size}:${opts.brass || ''}`;
  if (cache.has(key)) return cache.get(key).cloneNode ? clone(cache.get(key)) : cache.get(key);
  const pr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const c = document.createElement('canvas');
  c.width = size * pr;
  c.height = size * pr;
  const ctx = c.getContext('2d');
  const k = (size / CELL) * 1.15 * pr;
  ctx.setTransform(k, 0, 0, k, (size * pr) / 2 - (CELL / 2) * k, (size * pr) / 2 - (CELL / 2) * k);
  drawPiece(ctx, { id: 0, type, c: 0, r: 0, angle: type === 'lens' || type === 'concave' ? 90 : type === 'prism' ? 0 : 45, heat: 0, cracked: 0, t0: 0, store: 0, pulseUntil: 0 }, 0, { brass: opts.brass, quality: 'high' });
  cache.set(key, c);
  return clone(c);
}

/** A canvas showing one Shade type. */
export function shadeIcon(type, size = 64, hue = 'r') {
  const key = `s:${type}:${size}:${hue}`;
  if (cache.has(key)) return clone(cache.get(key));
  if (!shadeRenderer) shadeRenderer = makeShadeRenderer();
  const pr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const c = document.createElement('canvas');
  c.width = size * pr;
  c.height = size * pr;
  const ctx = c.getContext('2d');
  const def = SHADES[type] || SHADES.wisp;
  const k = Math.min(1.6, (size * 0.36) / def.radius) * pr;
  ctx.setTransform(k, 0, 0, k, (size * pr) / 2, (size * pr) / 2);
  const s = makeShade(1, type, hue, 0, 0, 0, 1);
  s.hx = 1;
  s.hy = 0;
  s.eye = 1;
  shadeRenderer.draw(ctx, [s], 0.3, { scale: k / pr }, { pixelRatio: pr, quality: 'high' });
  cache.set(key, c);
  return clone(c);
}

/** A small engraved plan of a board: the felt, its walls and ropes, the Hearts and the Lamp. */
export function boardIcon(id, w = 76, h = 48) {
  const key = `b:${id}:${w}x${h}`;
  if (cache.has(key)) return clone(cache.get(key));
  const def = BOARD_DEFS[id] || BOARD_DEFS.octagon;
  const pr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const c = document.createElement('canvas');
  c.width = w * pr;
  c.height = h * pr;
  const ctx = c.getContext('2d');
  const rows = def.map.length;
  const cols = def.map[0].length;
  const k = Math.min((w * pr - 4) / cols, (h * pr - 4) / rows);
  ctx.translate((w * pr - cols * k) / 2, (h * pr - rows * k) / 2);
  // The felt as one dark silhouette, walls in brass, ropes in red, then the Lamp and the Hearts on top.
  ctx.fillStyle = '#2f3b2f';
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) if (def.map[r][q] !== '.') ctx.fillRect(q * k - 0.3, r * k - 0.3, k + 0.6, k + 0.6);
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const ch = def.map[r][q];
      if (ch === '#' || ch === '=') {
        ctx.fillStyle = ch === '#' ? '#c9a04a' : '#8a3a30';
        ctx.fillRect(q * k, r * k + (ch === '=' ? k * 0.3 : 0), k, ch === '=' ? k * 0.4 : k);
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const ch = def.map[r][q];
      if (ch !== 'H' && ch !== 'L') continue;
      ctx.fillStyle = ch === 'H' ? '#fff4d6' : '#f0d78a';
      ctx.beginPath();
      ctx.arc((q + 0.5) * k, (r + 0.5) * k, k * (ch === 'H' ? 1.1 : 0.8), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  cache.set(key, c);
  return clone(c);
}

/** The mark of a dawn choice that is not glass: a wax-and-brass seal for a relic, a cut cog for an upgrade. */
export function sealIcon(kind, size = 48) {
  const key = `s:${kind}:${size}`;
  if (cache.has(key)) return clone(cache.get(key));
  const pr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const c = document.createElement('canvas');
  c.width = c.height = size * pr;
  const ctx = c.getContext('2d');
  ctx.scale(pr, pr);
  ctx.translate(size / 2, size / 2);
  const R = size * 0.4;
  const g = ctx.createLinearGradient(-R, -R, R, R);
  g.addColorStop(0, '#f0d78a');
  g.addColorStop(0.5, '#c9a04a');
  g.addColorStop(1, '#7a5a22');
  if (kind === 'upgrade') {
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const rr = i % 2 ? R : R * 0.82;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = 'rgba(190,230,240,0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.42, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#6b2a24';
    ctx.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const rr = R * (1 + 0.06 * Math.sin(i * 2.7));
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.66, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#f0d78a';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const rr = i % 2 ? R * 0.22 : R * 0.5;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  cache.set(key, c);
  return clone(c);
}

function clone(c) {
  const n = document.createElement('canvas');
  n.width = c.width;
  n.height = c.height;
  n.getContext('2d').drawImage(c, 0, 0);
  return n;
}
