// The scene: camera (fit, zoom, pan), the cached felt, and the draw order of one frame. Everything drawn in
// reference pixels (cell = 64) under one transform, so the same code serves phones, desktops and posters.

import { CELL, OPEN, cellKind, flowAt } from '../sim/boards.js';
import { renderFelt, MARGIN, PALETTE } from './felt.js';
import { makeBeamRenderer } from './beams.js';
import { makeShadeRenderer } from './shades.js';
import { drawPiece, drawLamp, drawHeart, glyph } from './glass.js';
import { clamp, lerp } from '../sim/geom.js';

const HUE = { r: PALETTE.red, g: PALETTE.green, b: PALETTE.blue, w: PALETTE.bone };

export function makeScene(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const beams = makeBeamRenderer();
  const shades = makeShadeRenderer();
  let board = null;
  let felt = null;
  let feltKey = '';
  let cosmetics = { felt: 'green', brass: 'brass', beam: 'classic', heart: 'glass' };
  let quality = 'high';
  let pr = 1;
  const view = { scale: 1, ox: 0, oy: 0, w: 1, h: 1, zoom: 1, panX: 0, panY: 0, fit: 1 };
  let cssW = 1;
  let cssH = 1;
  /** Extra room reserved for the HUD (css px): left tray, top bar, bottom bar. */
  const inset = { left: 0, top: 0, right: 0, bottom: 0 };

  function setBoard(b, cos) {
    board = b;
    if (cos) cosmetics = { ...cosmetics, ...cos };
    felt = null;
    layout();
  }

  function setQuality(q, pixelRatio) {
    quality = q;
    pr = pixelRatio;
    felt = null;
    layout();
  }

  function setInsets(i) {
    Object.assign(inset, i);
    layout();
  }

  function resize(w, h, pixelRatio) {
    cssW = Math.max(1, w);
    cssH = Math.max(1, h);
    pr = pixelRatio;
    const bw = Math.max(1, Math.round(cssW * pr));
    const bh = Math.max(1, Math.round(cssH * pr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    felt = null;
    layout();
  }

  /** Fits the table (board plus margins) into the free area; zoom and pan on top. */
  function layout() {
    if (!board) return;
    const W = board.w + MARGIN.x * 2;
    const H = board.h + MARGIN.y * 2;
    const freeW = Math.max(60, cssW - inset.left - inset.right);
    const freeH = Math.max(60, cssH - inset.top - inset.bottom);
    view.fit = Math.min(freeW / W, freeH / H);
    view.scale = view.fit * view.zoom;
    const cx = inset.left + freeW / 2;
    const cy = inset.top + freeH / 2;
    // Pan is limited so the board can never leave the free area entirely.
    const maxPanX = Math.max(0, (W * view.scale - freeW) / 2 + 40);
    const maxPanY = Math.max(0, (H * view.scale - freeH) / 2 + 40);
    view.panX = clamp(view.panX, -maxPanX, maxPanX);
    view.panY = clamp(view.panY, -maxPanY, maxPanY);
    view.ox = cx - (board.w / 2) * view.scale + view.panX;
    view.oy = cy - (board.h / 2) * view.scale + view.panY;
    view.w = cssW;
    view.h = cssH;
  }

  function setZoom(z, aboutX, aboutY) {
    const before = toWorld(aboutX ?? cssW / 2, aboutY ?? cssH / 2);
    view.zoom = clamp(z, 1, 3);
    layout();
    if (aboutX != null) {
      const after = toWorld(aboutX, aboutY);
      view.panX += (after.x - before.x) * view.scale;
      view.panY += (after.y - before.y) * view.scale;
      layout();
    }
  }

  function pan(dx, dy) {
    view.panX += dx;
    view.panY += dy;
    layout();
  }

  const toWorld = (x, y) => ({ x: (x - view.ox) / view.scale, y: (y - view.oy) / view.scale });
  const toScreen = (x, y) => ({ x: x * view.scale + view.ox, y: y * view.scale + view.oy });

  function ensureFelt() {
    const key = `${board.id}:${cosmetics.felt}:${cosmetics.brass}:${quality}:${(view.scale * pr).toFixed(2)}`;
    if (felt && feltKey === key) return;
    felt = renderFelt(board, clamp(view.scale * pr, 0.2, 3), { felt: cosmetics.felt, brass: cosmetics.brass, quality });
    feltKey = key;
  }

  /**
   * Draws one frame. `S` is the state to show:
   * { t, pieces, lamps, shades, segments, heart: {hp, max}, dawn: {charge, max, active}, phase, upcoming, shadows,
   *   bands, forecast: {arcs, hues}, ghost: {piece, segments}, selected, locks: Map, cursors: [], flares, lanes }
   * `fx` is the particle system; `opts` { dt, reduced, shake:{x,y} }.
   */
  function frame(S, fx, opts = {}) {
    if (!board) return;
    ensureFelt();
    const shake = opts.shake || { x: 0, y: 0 };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#070b09';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sc = view.scale * pr;
    ctx.setTransform(sc, 0, 0, sc, (view.ox + shake.x) * pr, (view.oy + shake.y) * pr);
    // The table.
    ctx.drawImage(felt.canvas, -MARGIN.x, -MARGIN.y, felt.w, felt.h);
    const t = S.t || 0;
    // Where the ink will come from: lane trails at dusk and in breaks.
    if (S.lanes && S.forecast) drawLanes(S.forecast, t);
    // Darkness on the felt: Umbra shadows, the Long Dusk's bands.
    for (const z of S.shadows || []) {
      const g = ctx.createRadialGradient(z.x, z.y, z.r * 0.3, z.x, z.y, z.r);
      g.addColorStop(0, 'rgba(5,6,10,0.92)');
      g.addColorStop(1, 'rgba(5,6,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const b of S.bands || []) {
      const g = ctx.createLinearGradient(b.x0, 0, b.x1, 0);
      g.addColorStop(0, 'rgba(5,6,10,0)');
      g.addColorStop(0.5, 'rgba(5,6,10,0.8)');
      g.addColorStop(1, 'rgba(5,6,10,0)');
      ctx.fillStyle = g;
      ctx.fillRect(b.x0, -MARGIN.y, b.x1 - b.x0, board.h + MARGIN.y * 2);
    }
    // Light.
    beams.draw(ctx, S.segments || [], { ...view, ox: (view.ox + shake.x) * pr, oy: (view.oy + shake.y) * pr, scale: sc, w: canvas.width, h: canvas.height }, { quality, dawn: S.dawn?.active, dt: opts.dt, reduced: opts.reduced, intensity: S.intensity ?? 1 });
    // Hearts and Lamps.
    for (let i = 0; i < board.hearts.length; i++) drawHeart(ctx, board.hearts[i], S.heart ? S.heart.hp / S.heart.max : 1, S.dawn ? S.dawn.charge / S.dawn.max : 0, t, { brass: cosmetics.brass, heartSkin: cosmetics.heart, reduced: opts.reduced });
    for (const L of S.lamps || []) drawLamp(ctx, L, clamp((L.power || 0) / 140, 0, 1), { brass: cosmetics.brass, reduced: opts.reduced });
    // Glass.
    for (const p of S.pieces || []) drawPiece(ctx, p, t, { brass: cosmetics.brass, mods: S.mods, selected: p.id === S.selected, lockColour: S.locks?.get(p.id), quality });
    if (S.ghost?.piece) {
      const ok = S.ghost.valid !== false;
      if (!ok) {
        ctx.save();
        ctx.strokeStyle = PALETTE.red;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(S.ghost.piece.c * CELL + 4, S.ghost.piece.r * CELL + 4, CELL - 8, CELL - 8);
        ctx.restore();
      } else {
        drawPiece(ctx, S.ghost.piece, t, { brass: cosmetics.brass, mods: S.mods, ghost: true, quality });
        if (S.ghost.segments) beams.drawGhost(ctx, S.ghost.segments, { fontSize: Math.max(11, 13 / Math.max(0.5, view.scale)) });
      }
    }
    // Ink.
    shades.draw(ctx, S.shades || [], t, view, { pixelRatio: pr, quality });
    for (const u of groupUpcoming(S.upcoming || [])) shades.drawTelegraph(ctx, board.arcs[u.arc], u.list, t);
    // Effects.
    if (fx) fx.draw(ctx, { quality });
    // Other Opticians' cursors.
    for (const c of S.cursors || []) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.strokeStyle = c.colour;
      ctx.fillStyle = c.colour;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(14, 10);
      ctx.lineTo(6, 11);
      ctx.lineTo(2, 18);
      ctx.closePath();
      ctx.fill();
      ctx.font = '500 11px "Plex", sans-serif';
      ctx.fillStyle = PALETTE.bone;
      ctx.fillText(String(c.name || ''), 10, 28);
      ctx.restore();
    }
    for (const p of S.pings || []) {
      const k = clamp(p.age / 2, 0, 1);
      ctx.save();
      ctx.strokeStyle = p.colour || PALETTE.bone;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10 + k * 40, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function groupUpcoming(list) {
    const m = new Map();
    for (const u of list) {
      if (u.inside) continue;
      if (!m.has(u.arc)) m.set(u.arc, { arc: u.arc, list: [] });
      m.get(u.arc).list.push(u);
    }
    return [...m.values()];
  }

  /** Dotted trails from the forecast arcs to the Heart, in the wave's colours. */
  function drawLanes(fc, t) {
    ctx.save();
    ctx.setLineDash([2, 10]);
    ctx.lineDashOffset = -t * 20;
    ctx.lineWidth = 2;
    const dir = { x: 0, y: 0 };
    for (const ai of fc.arcs || []) {
      const arc = board.arcs[ai];
      if (!arc) continue;
      const hue = fc.hues && fc.hues.length ? fc.hues[ai % fc.hues.length] : 'w';
      ctx.strokeStyle = HUE[hue] || PALETTE.bone;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      let x = arc.x;
      let y = arc.y;
      ctx.moveTo(x, y);
      for (let s = 0; s < 80; s++) {
        flowAt(board, x, y, dir);
        x += dir.x * 16;
        y += dir.y * 16;
        ctx.lineTo(x, y);
        let near = false;
        for (const h of board.hearts) if (Math.hypot(h.x - x, h.y - y) < h.radius + 14) near = true;
        if (near) break;
      }
      ctx.stroke();
      // The glyphs of what comes, at the arc.
      ctx.globalAlpha = 0.9;
      ctx.save();
      ctx.translate(arc.x, arc.y);
      for (let i = 0; i < (fc.hues || []).length; i++) {
        ctx.save();
        ctx.translate((i - (fc.hues.length - 1) / 2) * 18, 0);
        glyph(ctx, fc.hues[i], 6, HUE[fc.hues[i]]);
        ctx.restore();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /** The cell under a css point, or null when it is off the board. */
  function cellAt(cssX, cssY) {
    const w = toWorld(cssX, cssY);
    const c = Math.floor(w.x / CELL);
    const r = Math.floor(w.y / CELL);
    if (!board || c < 0 || r < 0 || c >= board.cols || r >= board.rows) return null;
    return { c, r, open: cellKind(board, c, r) === OPEN, x: w.x, y: w.y };
  }

  return { ctx, view, setBoard, setQuality, setInsets, resize, layout, setZoom, pan, toWorld, toScreen, cellAt, frame, beams, get board() { return board; }, get cosmetics() { return cosmetics; }, setCosmetics(c) { cosmetics = { ...cosmetics, ...c }; felt = null; } };
}

export { lerp };
