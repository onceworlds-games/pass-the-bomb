// Small canvases of the glass and the Shades for cards, drafts and the almanac, in the game's own style.

import { drawPiece } from '../render/glass.js';
import { makeShadeRenderer } from '../render/shades.js';
import { makeShade, SHADES } from '../sim/shades.js';
import { CELL } from '../sim/boards.js';

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

function clone(c) {
  const n = document.createElement('canvas');
  n.width = c.width;
  n.height = c.height;
  n.getContext('2d').drawImage(c, 0, 0);
  return n;
}
