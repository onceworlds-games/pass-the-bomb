// The table itself, drawn once per size: green felt with a weave, the walnut rail with brass studs, the brass
// ring with its engraved star-chart ticks, the Hearts' sockets and the Lamps' brass mounts. Cached as a bitmap.

import { CELL, OPEN, WALL, ROPE, HEART, LAMP, cellKind } from '../sim/boards.js';
import { makeRng } from '../sim/rng.js';

export const PALETTE = {
  felt: '#0e1713',
  feltLit: '#26402f',
  walnut: '#3a2416',
  walnutDark: '#20120a',
  brass: '#c9a04a',
  brassHi: '#f0d78a',
  brassLo: '#7a5a22',
  bone: '#efe6c8',
  ink: '#05060a',
  core: '#fff4d6',
  red: '#ff5d4d',
  green: '#6bff8f',
  blue: '#5db4ff',
};

export const FELTS = {
  green: { base: '#0e1713', lit: '#26402f', name: 'Observatory green' },
  oxblood: { base: '#1a0d0f', lit: '#44232a', name: 'Oxblood' },
  navy: { base: '#0b1020', lit: '#1f2c4e', name: 'Midnight navy' },
  slate: { base: '#121416', lit: '#30363b', name: 'Slate' },
};

export const BRASSES = {
  brass: { lo: '#7a5a22', mid: '#c9a04a', hi: '#f0d78a', name: 'Brass' },
  silver: { lo: '#5a6068', mid: '#aab2bb', hi: '#eef2f5', name: 'Silver' },
  gunmetal: { lo: '#23272c', mid: '#4b545d', hi: '#8e98a3', name: 'Gunmetal' },
};

/** The margin of table around the board (reference px), where the HUD lives. */
export const MARGIN = { x: 96, y: 80 };

/**
 * Draws the table into an offscreen canvas at `scale` px per reference px.
 * @returns {{ canvas: HTMLCanvasElement, scale: number, w: number, h: number }} (reference w/h include the margin)
 */
export function renderFelt(board, scale, opts = {}) {
  const felt = FELTS[opts.felt] || FELTS.green;
  const brass = BRASSES[opts.brass] || BRASSES.brass;
  const W = board.w + MARGIN.x * 2;
  const H = board.h + MARGIN.y * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(W * scale));
  canvas.height = Math.max(1, Math.round(H * scale));
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const rng = makeRng(7);

  // The felt, lit from above by the one lamp: a warm pool at the centre, dark toward the rail.
  ctx.fillStyle = felt.base;
  ctx.fillRect(0, 0, W, H);
  const pool = ctx.createRadialGradient(W / 2, H / 2 - H * 0.08, 10, W / 2, H / 2, Math.max(W, H) * 0.62);
  pool.addColorStop(0, felt.lit);
  pool.addColorStop(0.45, felt.base);
  pool.addColorStop(1, '#000000');
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  // Weave: fine diagonal threads and a sprinkle of fibre, cheap enough at any size.
  ctx.save();
  ctx.globalAlpha = opts.quality === 'low' ? 0.05 : 0.09;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.6;
  for (let x = -H; x < W + H; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + H, H);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.045;
  for (let x = -H; x < W + H; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x + H, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.restore();
  if (opts.quality !== 'low') {
    ctx.save();
    for (let i = 0; i < 1400; i++) {
      const x = rng.next() * W;
      const y = rng.next() * H;
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.18)';
      ctx.fillRect(x, y, 1.2, 1.2);
    }
    ctx.restore();
  }

  // The dark beyond the rim: cells of the void are a deeper felt, as if the lamp never reached them.
  ctx.save();
  ctx.translate(MARGIN.x, MARGIN.y);
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      const k = cellKind(board, c, r);
      if (k === WALL) {
        drawBrassBlock(ctx, c * CELL, r * CELL, brass);
      } else if (k === ROPE) {
        drawRope(ctx, board, c, r);
      }
    }
  }
  // The faint cell grid on the felt: stitched lines, barely there.
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  for (let r = 0; r <= board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      const above = cellKind(board, c, r - 1);
      const below = cellKind(board, c, r);
      if (above !== OPEN && below !== OPEN) continue;
      ctx.beginPath();
      ctx.moveTo(c * CELL, r * CELL);
      ctx.lineTo((c + 1) * CELL, r * CELL);
      ctx.stroke();
    }
  }
  for (let c = 0; c <= board.cols; c++) {
    for (let r = 0; r < board.rows; r++) {
      const left = cellKind(board, c - 1, r);
      const right = cellKind(board, c, r);
      if (left !== OPEN && right !== OPEN) continue;
      ctx.beginPath();
      ctx.moveTo(c * CELL, r * CELL);
      ctx.lineTo(c * CELL, (r + 1) * CELL);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // The brass rim: traced around the playable mask, engraved with degree ticks like a star chart.
  const loops = maskOutline(board);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 9;
  strokeEdges(ctx, loops);
  const grad = ctx.createLinearGradient(0, 0, board.w, board.h);
  grad.addColorStop(0, brass.hi);
  grad.addColorStop(0.5, brass.mid);
  grad.addColorStop(1, brass.lo);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 5;
  strokeEdges(ctx, loops);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  strokeEdges(ctx, loops);
  ticks(ctx, board, brass);

  // Hearts: a brass socket with a soft well of light.
  for (const h of board.hearts) {
    const g = ctx.createRadialGradient(h.x, h.y, 4, h.x, h.y, h.radius + 26);
    g.addColorStop(0, 'rgba(255,240,200,0.18)');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.radius + 26, 0, Math.PI * 2);
    ctx.fill();
    ring(ctx, h.x, h.y, h.radius + 8, brass, 3);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.fillStyle = i % 3 ? brass.lo : brass.hi;
      ctx.beginPath();
      ctx.arc(h.x + Math.cos(a) * (h.radius + 8), h.y + Math.sin(a) * (h.radius + 8), 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Lamps: a heavy brass mount.
  for (const L of board.lamps) {
    ring(ctx, L.x, L.y, L.radius + 9, brass, 4);
    ctx.fillStyle = brass.lo;
    ctx.beginPath();
    ctx.arc(L.x, L.y, L.radius + 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // The walnut rail around the whole table, with studs, and the star chart engraved in the lower margin.
  rail(ctx, W, H, brass);
  starChart(ctx, W, H, rng, brass);
  return { canvas, scale, w: W, h: H };
}

function drawBrassBlock(ctx, x, y, brass) {
  const g = ctx.createLinearGradient(x, y, x + CELL, y + CELL);
  g.addColorStop(0, brass.mid);
  g.addColorStop(1, brass.lo);
  ctx.fillStyle = g;
  ctx.fillRect(x + 4, y + 4, CELL - 8, CELL - 8);
  ctx.strokeStyle = brass.hi;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 7, y + 7, CELL - 14, CELL - 14);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x + 12, y + 12, CELL - 24, CELL - 24);
}

function drawRope(ctx, board, c, r) {
  // Velvet rope: a soft maroon cord between brass posts, along the run of rope cells.
  const x = c * CELL;
  const y = r * CELL;
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  const horiz = cellKind(board, c - 1, r) === ROPE || cellKind(board, c + 1, r) === ROPE;
  const vert = cellKind(board, c, r - 1) === ROPE || cellKind(board, c, r + 1) === ROPE;
  ctx.strokeStyle = '#4a1620';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (horiz) {
    ctx.moveTo(x, cy + 3);
    ctx.quadraticCurveTo(cx, cy + 9, x + CELL, cy + 3);
  }
  if (vert) {
    ctx.moveTo(cx + 3, y);
    ctx.quadraticCurveTo(cx + 9, cy, cx + 3, y + CELL);
  }
  if (!horiz && !vert) ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#7a2a38';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = PALETTE.brass;
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The outline of the playable cells as closed loops of corner points (cell coordinates), with one-cell
 * staircases straightened into diagonals so an octagon is an octagon and a cut corner is one clean bevel.
 */
export function maskOutline(board) {
  const inside = (c, r) => {
    const k = cellKind(board, c, r);
    return k === OPEN || k === HEART || k === LAMP || k === WALL || k === ROPE;
  };
  // Directed boundary edges, keeping the inside on the left, keyed by their start vertex.
  const next = new Map();
  const key = (x, y) => `${x},${y}`;
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      if (!inside(c, r)) continue;
      if (!inside(c, r - 1)) next.set(key(c, r), [c + 1, r]);
      if (!inside(c + 1, r)) next.set(key(c + 1, r), [c + 1, r + 1]);
      if (!inside(c, r + 1)) next.set(key(c + 1, r + 1), [c, r + 1]);
      if (!inside(c - 1, r)) next.set(key(c, r + 1), [c, r]);
    }
  }
  const loops = [];
  const used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let k = start;
    let guard = 0;
    while (k && !used.has(k) && guard++ < 5000) {
      used.add(k);
      const [x, y] = k.split(',').map(Number);
      loop.push([x, y]);
      const n = next.get(k);
      k = n ? key(n[0], n[1]) : null;
    }
    if (loop.length >= 4) loops.push(simplify(loop));
  }
  return loops;
}

/** Drops the middle vertices of unit staircases (alternating one-cell steps) so they become diagonals. */
function simplify(loop) {
  const n = loop.length;
  const dir = (i) => {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    return [b[0] - a[0], b[1] - a[1]];
  };
  const keep = new Array(n).fill(true);
  for (let i = 0; i < n; i++) {
    const d0 = dir((i - 1 + n) % n);
    const d1 = dir(i);
    const unit = (d) => Math.abs(d[0]) + Math.abs(d[1]) === 1;
    // A vertex between two unit steps in different axes that continue the same diagonal is a stair.
    if (unit(d0) && unit(d1) && d0[0] !== d1[0] && d0[1] !== d1[1]) {
      const d2 = dir((i + 1) % n);
      const dm = dir((i - 2 + n) % n);
      const same = (a, b) => a[0] === b[0] && a[1] === b[1];
      if ((unit(d2) && same(d2, d0)) || (unit(dm) && same(dm, d1))) keep[i] = false;
    }
  }
  const out = loop.filter((_, i) => keep[i]);
  // Merge collinear runs.
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[(i - 1 + out.length) % out.length];
    const b = out[i];
    const c = out[(i + 1) % out.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) res.push(b);
  }
  return res;
}

function strokeEdges(ctx, loops) {
  ctx.beginPath();
  for (const loop of loops) {
    loop.forEach(([x, y], i) => (i ? ctx.lineTo(x * CELL, y * CELL) : ctx.moveTo(x * CELL, y * CELL)));
    ctx.closePath();
  }
  ctx.stroke();
}

function ring(ctx, x, y, r, brass, w) {
  const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  g.addColorStop(0, brass.hi);
  g.addColorStop(0.5, brass.mid);
  g.addColorStop(1, brass.lo);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = w + 3;
  ctx.beginPath();
  ctx.arc(x, y + 1.5, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = g;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** Degree ticks around the board, engraved every 5 degrees from the centre, as on an astronomer's ring. */
function ticks(ctx, board, brass) {
  const R = Math.hypot(board.w, board.h) / 2 + 28;
  ctx.save();
  ctx.translate(board.cx, board.cy);
  for (let d = 0; d < 360; d += 5) {
    const a = (d * Math.PI) / 180;
    const major = d % 30 === 0;
    const len = major ? 10 : 4;
    const rr = clipRadius(a, board.w / 2 + 22, board.h / 2 + 22);
    ctx.strokeStyle = major ? brass.hi : brass.mid;
    ctx.globalAlpha = major ? 0.85 : 0.5;
    ctx.lineWidth = major ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    ctx.lineTo(Math.cos(a) * (rr + len), Math.sin(a) * (rr + len));
    ctx.stroke();
  }
  ctx.restore();
  void R;
}

/** Radius from the centre to the rectangle boundary (half-size hw, hh) at angle a. */
function clipRadius(a, hw, hh) {
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return Math.min(c > 1e-6 ? hw / c : Infinity, s > 1e-6 ? hh / s : Infinity);
}

function rail(ctx, W, H, brass) {
  const t = 18;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#4a2e1c');
  g.addColorStop(1, '#20120a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, t);
  ctx.fillRect(0, H - t, W, t);
  ctx.fillRect(0, 0, t, H);
  ctx.fillRect(W - t, 0, t, H);
  ctx.strokeStyle = 'rgba(255,220,160,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(t - 0.5, t - 0.5, W - 2 * t + 1, H - 2 * t + 1);
  ctx.fillStyle = brass.mid;
  for (let x = t + 24; x < W - t; x += 64) {
    stud(ctx, x, t / 2, brass);
    stud(ctx, x, H - t / 2, brass);
  }
  for (let y = t + 24; y < H - t; y += 64) {
    stud(ctx, t / 2, y, brass);
    stud(ctx, W - t / 2, y, brass);
  }
}

function stud(ctx, x, y, brass) {
  ctx.fillStyle = brass.lo;
  ctx.beginPath();
  ctx.arc(x, y + 0.8, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = brass.hi;
  ctx.beginPath();
  ctx.arc(x - 0.6, y - 0.6, 2.2, 0, Math.PI * 2);
  ctx.fill();
}

/** Constellation engraving in the margins: faint stars joined by hairlines, never busy. */
function starChart(ctx, W, H, rng, brass) {
  ctx.save();
  ctx.globalAlpha = 0.35;
  const stars = [];
  for (let i = 0; i < 90; i++) {
    const side = rng.int(0, 3);
    let x;
    let y;
    if (side === 0) (x = rng.range(30, W - 30)), (y = rng.range(26, MARGIN.y - 14));
    else if (side === 1) (x = rng.range(30, W - 30)), (y = rng.range(H - MARGIN.y + 14, H - 26));
    else if (side === 2) (x = rng.range(26, MARGIN.x - 14)), (y = rng.range(30, H - 30));
    else (x = rng.range(W - MARGIN.x + 14, W - 26)), (y = rng.range(30, H - 30));
    stars.push({ x, y, m: rng.range(0.6, 1.8) });
  }
  ctx.strokeStyle = brass.mid;
  ctx.lineWidth = 0.6;
  for (let i = 0; i + 1 < stars.length; i += 3) {
    const a = stars[i];
    const b = stars[i + 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) > 140) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const s of stars) {
    ctx.fillStyle = brass.hi;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.m, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
