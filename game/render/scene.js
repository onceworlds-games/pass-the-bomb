// The scene: camera (fit, zoom, pan, and a quarter turn for screens held upright), the cached felt, and the draw
// order of one frame. Everything drawn in reference pixels (cell = 64) under one transform, so the same code serves
// phones, desktops and posters.

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
  // rot: 1 turns the table a quarter turn so its long side runs up a screen held upright (the Lamp's west rim at
  // the bottom). trim: share of the felt margin the fit keeps (small screens let the rail run off the edges).
  const view = { scale: 1, ox: 0, oy: 0, w: 1, h: 1, zoom: 1, panX: 0, panY: 0, fit: 1, rot: 0, trim: 1 };
  let cssW = 1;
  let cssH = 1;
  /** Extra room reserved for the HUD (css px): left tray, top bar, bottom bar. */
  const inset = { left: 0, top: 0, right: 0, bottom: 0 };
  let autoRotate = false;

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

  /** Turn the table on screens held upright (on by default for play; posters keep it level). */
  function setAutoRotate(on) {
    autoRotate = !!on;
    layout();
  }

  /**
   * Fits the table (board plus margins) into the free area; zoom and pan on top. On a screen held upright the table
   * turns a quarter so its long side runs up the screen, and on small screens the fit trims the margin of felt
   * beyond the rim (the dark the ink walks in from stays in view; the walnut rail may leave the screen).
   */
  function layout() {
    if (!board) return;
    const freeW = Math.max(60, cssW - inset.left - inset.right);
    const freeH = Math.max(60, cssH - inset.top - inset.bottom);
    const longBoard = board.w >= board.h;
    view.rot = autoRotate && longBoard && freeH > freeW * 1.15 ? 1 : 0;
    const small = Math.min(cssW, cssH) < 560;
    view.trim = small ? 0.5 : 1;
    const mx = MARGIN.x * view.trim;
    const my = MARGIN.y * view.trim;
    // Extent of the table on screen per unit of scale, after the turn.
    const W = view.rot ? board.h + my * 2 : board.w + mx * 2;
    const H = view.rot ? board.w + mx * 2 : board.h + my * 2;
    view.fit = Math.min(freeW / W, freeH / H);
    view.scale = view.fit * view.zoom;
    const cx = inset.left + freeW / 2;
    const cy = inset.top + freeH / 2;
    // Pan is limited so the board can never leave the free area entirely.
    const maxPanX = Math.max(0, (W * view.scale - freeW) / 2 + 40);
    const maxPanY = Math.max(0, (H * view.scale - freeH) / 2 + 40);
    view.panX = clamp(view.panX, -maxPanX, maxPanX);
    view.panY = clamp(view.panY, -maxPanY, maxPanY);
    if (view.rot) {
      // World (x, y) -> screen (scale * y + ox, -scale * x + oy): west is down, north is left.
      view.ox = cx - (board.h / 2) * view.scale + view.panX;
      view.oy = cy + (board.w / 2) * view.scale + view.panY;
    } else {
      view.ox = cx - (board.w / 2) * view.scale + view.panX;
      view.oy = cy - (board.h / 2) * view.scale + view.panY;
    }
    view.w = cssW;
    view.h = cssH;
  }

  function setZoom(z, aboutX, aboutY) {
    const ax = aboutX ?? cssW / 2;
    const ay = aboutY ?? cssH / 2;
    const before = toWorld(ax, ay);
    view.zoom = clamp(z, 1, 3);
    layout();
    // Keep the point under the pointer where it was.
    const s = toScreen(before.x, before.y);
    view.panX += ax - s.x;
    view.panY += ay - s.y;
    layout();
  }

  function pan(dx, dy) {
    view.panX += dx;
    view.panY += dy;
    layout();
  }

  const toWorld = (x, y) => (view.rot ? { x: (view.oy - y) / view.scale, y: (x - view.ox) / view.scale } : { x: (x - view.ox) / view.scale, y: (y - view.oy) / view.scale });
  const toScreen = (x, y) => (view.rot ? { x: y * view.scale + view.ox, y: -x * view.scale + view.oy } : { x: x * view.scale + view.ox, y: y * view.scale + view.oy });

  /** Sets the camera on a context: reference px in, device px out (shake in css px, `k` the device pixel ratio). */
  function applyView(c, shake, k = pr, v = view) {
    const sx = shake ? shake.x : 0;
    const sy = shake ? shake.y : 0;
    const s = v.scale * k;
    if (v.rot) c.setTransform(0, -s, s, 0, (v.ox + sx) * k, (v.oy + sy) * k);
    else c.setTransform(s, 0, 0, s, (v.ox + sx) * k, (v.oy + sy) * k);
  }

  /** Inside a frame: undoes the quarter turn around (x, y), so text and badges stand upright on a turned table. */
  function upright(c, x, y) {
    c.translate(x, y);
    if (view.rot) c.rotate(Math.PI / 2);
  }

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
    applyView(ctx, shake);
    // The table.
    ctx.drawImage(felt.canvas, -MARGIN.x, -MARGIN.y, felt.w, felt.h);
    const t = S.t || 0;
    // Where the ink will come from: lane trails at dusk and in breaks.
    if (S.forecast && S.forecast.lanes) drawLanes(S.forecast, t);
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
    beams.draw(ctx, S.segments || [], { ...view, ox: (view.ox + shake.x) * pr, oy: (view.oy + shake.y) * pr, scale: sc, w: canvas.width, h: canvas.height }, { quality, dawn: S.dawn?.active, dt: opts.dt, reduced: opts.reduced, intensity: S.intensity ?? 1, style: cosmetics.beam });
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
        if (S.ghost.segments) beams.drawGhost(ctx, S.ghost.segments, { fontSize: Math.max(11, 13 / Math.max(0.3, view.scale)), upright });
      }
    }
    // Ink.
    shades.draw(ctx, S.shades || [], t, view, { pixelRatio: pr, quality, rot: view.rot });
    for (const u of groupUpcoming(S.upcoming || [])) shades.drawTelegraph(ctx, board.arcs[u.arc], u.list, t, view.rot);
    // Effects.
    if (fx) fx.draw(ctx, { quality });
    // Other Opticians' cursors.
    for (const c of S.cursors || []) {
      ctx.save();
      upright(ctx, c.x, c.y);
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

  /**
   * Dotted trails from the forecast arcs to the Heart. `fc.lanes`: [{ arc, hues: ['r'|'g'|'b'|'w'], faint }]: the next
   * wave's lanes, with the glyph of every colour that walks each one; faint ones are later waves (Second Sight).
   * Widths and glyphs keep their size on screen however small the table is drawn.
   */
  function drawLanes(fc, t) {
    const k = 1 / Math.max(0.2, view.scale);
    ctx.save();
    ctx.lineCap = 'round';
    const dir = { x: 0, y: 0 };
    for (const lane of fc.lanes || []) {
      const arc = board.arcs[lane.arc];
      if (!arc) continue;
      const hues = lane.hues && lane.hues.length ? lane.hues : ['w'];
      const single = hues.length === 1 ? hues[0] : 'w';
      ctx.setLineDash([2.5 * k, 9 * k]);
      ctx.lineDashOffset = -t * 22 * k;
      ctx.lineWidth = (lane.faint ? 1.6 : 2.6) * k;
      ctx.strokeStyle = HUE[single] || PALETTE.bone;
      ctx.globalAlpha = lane.faint ? 0.28 : 0.62;
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
      if (lane.faint) continue;
      // The glyph of every colour that comes this way, at the arc.
      ctx.globalAlpha = 0.95;
      ctx.save();
      upright(ctx, arc.x, arc.y);
      const g = 6.5 * k;
      for (let i = 0; i < hues.length; i++) {
        ctx.save();
        ctx.translate((i - (hues.length - 1) / 2) * g * 2.6, 0);
        ctx.fillStyle = 'rgba(5,6,10,0.7)';
        ctx.beginPath();
        ctx.arc(0, 0, g * 1.5, 0, Math.PI * 2);
        ctx.fill();
        glyph(ctx, hues[i], g, HUE[hues[i]]);
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

  return { ctx, view, setBoard, setQuality, setInsets, setAutoRotate, resize, layout, setZoom, pan, toWorld, toScreen, cellAt, frame, applyView, upright, beams, shades, get pr() { return pr; }, get board() { return board; }, get cosmetics() { return cosmetics; }, setCosmetics(c) { cosmetics = { ...cosmetics, ...c }; felt = null; } };
}

export { lerp };
