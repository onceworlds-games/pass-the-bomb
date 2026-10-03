// Poster mode: ?poster=thumb1|thumb2|thumb3|thumb4|icon|badge-<id>. Deterministic scenes from the game's own
// renderer, no SDK, no network. Sets window.__posterReady when the frame is on screen.

import { buildBoard, CELL } from './sim/boards.js';
import { createNight } from './sim/night.js';
import { makeScene } from './render/scene.js';
import { makeFx } from './render/fx.js';
import { drawPiece, drawHeart, glyph } from './render/glass.js';
import { makeShadeRenderer } from './render/shades.js';
import { makeBeamRenderer } from './render/beams.js';
import { makeShade } from './sim/shades.js';
import { traceBeams } from './sim/trace.js';
import { baseMods } from './sim/pieces.js';
import { PALETTE } from './render/felt.js';

const deck = { mirror: 8, splitter: 2, prism: 2, lens: 3, 'filter-r': 1, 'filter-g': 1, 'filter-b': 1, concave: 1, rotor: 2, crystal: 1, combiner: 1, heatsink: 1, black: 1, shutter: 1 };

function night(boardId, seed, nightNo, mods = {}) {
  return createNight({ seed, night: nightNo, board: buildBoard(boardId), deck, players: [{ id: 'p' }], heart: { hp: 100, max: 100 }, mods });
}
const place = (N, type, c, r, angle) => N.command('p', { op: 'place', type, c, r, angle });
const spawn = (N, type, hue, x, y, hp = 1) => {
  const s = makeShade(N.S.nextShadeId++, type, hue, x, y, N.S.t, hp);
  s.hx = -1;
  s.hy = 0;
  N.S.shades.push(s);
  return s;
};

const SCENES = {
  thumb1(N) {
    // A finished machine: the Lamp splits; one half fans into colour across the ink coming from the east, the
    // other runs the north through a lens and turns down the east side in a wide wash.
    place(N, 'splitter', 4, 6, 45);
    place(N, 'mirror', 4, 9, 45);
    place(N, 'prism', 9, 9, 100);
    place(N, 'mirror', 7, 6, 135);
    place(N, 'mirror', 7, 3, 135);
    place(N, 'lens', 11, 3, 90);
    place(N, 'mirror', 16, 3, 45);
    N.command('p', { op: 'lamp', i: 0, angle: 0 });
    // Along the fan: red Creepers in the red, a blue Veil in the blue, a swarm of gnats in the green.
    for (let i = 0; i < 3; i++) spawn(N, 'creeper', 'r', 1010 + i * 105, 545 - i * 25);
    spawn(N, 'veil', 'b', 980, 455);
    spawn(N, 'veil', 'b', 1180, 410);
    for (let i = 0; i < 12; i++) spawn(N, 'gnat', 'g', 860 + i * 30, 520 + Math.sin(i * 1.7) * 18, 1);
    // Wading through the wash on the east side.
    spawn(N, 'twain', 'g', 1060, 330);
    spawn(N, 'wisp', 'w', 1110, 760);
    spawn(N, 'wisp', 'w', 1220, 690);
    spawn(N, 'creeper', 'g', 1290, 230);
  },
  thumb2(N) {
    // The focus burn: the prism's red leaves through a filter and a lens, to a burning point on a Veil.
    place(N, 'prism', 3, 6, 95);
    place(N, 'filter-r', 6, 6, 0);
    place(N, 'lens', 9, 5, 90);
    place(N, 'mirror', 13, 2, 135);
    place(N, 'mirror', 13, 7, 45);
    place(N, 'concave', 16, 7, 90);
    N.command('p', { op: 'lamp', i: 0, angle: 0 });
    const tr = traceBeams({ board: N.board, pieces: N.S.pieces, lamps: N.S.lamps.map((L) => ({ ...L, power: 100 })), t: 0, mods: N.mods });
    const focus = tr.segments.find((s) => s.end === 'focus');
    const fx = focus ? focus.x1 : 800;
    const fy = focus ? focus.y1 : 360;
    const v = spawn(N, 'veil', 'r', fx + 6, fy + 2);
    v.hp = 14;
    v.burn = 1;
    spawn(N, 'veil', 'r', fx + 150, fy + 40);
    spawn(N, 'veil', 'r', 1040, 560);
    spawn(N, 'creeper', 'g', 980, 170);
    spawn(N, 'twain', 'b', 1120, 700);
  },
  thumb3(N) {
    // A boss night: Umbra with its shadows, three beams slicing across a darkened table.
    place(N, 'splitter', 3, 6, 45);
    place(N, 'mirror', 3, 10, 45);
    place(N, 'mirror', 3, 2, 135);
    place(N, 'prism', 10, 2, 90);
    place(N, 'rotor', 10, 10, 20);
    place(N, 'lens', 7, 6, 90);
    place(N, 'black', 14, 8, 0);
    N.command('p', { op: 'lamp', i: 0, angle: 0 });
    const u = spawn(N, 'umbra', 'r', 980, 440, 1);
    u.hp = 300;
    u.phase = 1;
    u.castAt = 1e9;
    N.S.shadows.push({ x: 560, y: 180, r: 80, until: 1e9 }, { x: 1100, y: 640, r: 80, until: 1e9 }, { x: 760, y: 700, r: 70, until: 1e9 });
    for (let i = 0; i < 6; i++) spawn(N, 'wisp', 'w', 1150 + i * 30, 300 + i * 50);
    spawn(N, 'gloom', 'g', 700, 700);
    spawn(N, 'eater', 'w', 420, 700);
  },
  thumb4(N) {
    // Twin Hearts: a rotor sweep and a crystal pulse, Glooms pressing in from the south.
    place(N, 'mirror', 10, 2, 45);
    place(N, 'splitter', 10, 5, 135);
    place(N, 'mirror', 5, 5, 45);
    place(N, 'mirror', 15, 5, 135);
    place(N, 'rotor', 5, 9, 60);
    place(N, 'crystal', 15, 9, 180);
    place(N, 'combiner', 10, 9, 90);
    place(N, 'filter-r', 7, 8, 0);
    N.command('p', { op: 'lamp', i: 0, angle: 90 });
    const cr = N.S.pieces.find((p) => p.type === 'crystal');
    cr.pr = cr.pg = cr.pb = 150;
    cr.pulseUntil = 1e9;
    spawn(N, 'gloom', 'r', 400, 760);
    spawn(N, 'gloom', 'b', 1000, 780);
    for (let i = 0; i < 5; i++) spawn(N, 'creeper', 'r', 300 + i * 160, 820);
    spawn(N, 'mimic', 'w', 1230, 400);
  },
};

const SIZE = { thumb: [1280, 720], icon: [512, 512], badge: [256, 256] };

export async function runPoster(kind) {
  document.body.style.background = '#070b09';
  const canvas = document.getElementById('table');
  for (const n of ['hud', 'screen', 'hint', 'toast']) document.getElementById(n).hidden = true;
  try {
    await document.fonts?.ready;
  } catch {}
  if (kind === 'icon') return icon(canvas);
  if (kind.startsWith('badge-')) return badge(canvas, kind.slice(6));
  const fn = SCENES[kind] || SCENES.thumb1;
  const boardId = kind === 'thumb4' ? 'twin' : 'octagon';
  const N = night(boardId, 7, kind === 'thumb3' ? 4 : 6, kind === 'thumb3' ? { lampPower: 1.3 } : {});
  N.mods.breathLow = N.mods.breathHigh = 1.1;
  fn(N);
  // Let the light settle and the ink walk a little, deterministically.
  for (let i = 0; i < 30; i++) N.tick();
  N.S.phase = 'wave';
  const scene = makeScene(canvas);
  const fx = makeFx();
  const [w, h] = SIZE.thumb;
  scene.setQuality('high', 1);
  scene.setBoard(N.board, { felt: 'green', brass: 'brass' });
  scene.resize(w, h, 1);
  scene.setInsets({ left: 0, top: 0, right: 0, bottom: 0 });
  scene.layout();
  // Fill the frame: no margins beyond the rail.
  scene.setZoom(1.12);
  scene.layout();
  const draw = () => {
    N.S.trace = traceBeams({ board: N.board, pieces: N.S.pieces, lamps: N.S.lamps, t: N.S.t, mods: N.mods, zones: { shadows: N.S.shadows, glooms: N.S.shades.filter((s) => s.type === 'gloom').map((s) => ({ id: s.id, x: s.x, y: s.y, r: 96, factor: 0.4 })), mimics: [], bands: [] } });
    for (const s of N.S.shades) if (s.burn < 0.3 && (s.type === 'gnat' || s.type === 'wisp')) s.burn = 0.5;
    scene.frame({ t: N.S.t, pieces: N.S.pieces, lamps: N.S.lamps, shades: N.S.shades, segments: N.S.trace.segments, heart: N.S.heart, dawn: { charge: 22, max: 40, active: false }, phase: 'wave', upcoming: [], shadows: N.S.shadows, bands: [], mods: N.mods }, fx, { dt: 0.016, reduced: true });
  };
  for (let i = 0; i < 20; i++) {
    fx.burst(600 + i * 10, 400, 2, 'rgba(255,220,150,0.9)', 60);
    draw();
    fx.step(0.05, {});
  }
  draw();
  await new Promise((r) => requestAnimationFrame(r));
  window.__posterReady = true;
}

function setup(canvas, w, h) {
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  return canvas.getContext('2d');
}

function icon(canvas) {
  const ctx = setup(canvas, 512, 512);
  ctx.fillStyle = PALETTE.felt;
  ctx.fillRect(0, 0, 512, 512);
  const g = ctx.createRadialGradient(256, 230, 20, 256, 256, 330);
  g.addColorStop(0, '#2a4a36');
  g.addColorStop(1, '#06090a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  // One beam into a prism, three colours out: the whole game in one picture. The fan is opened wider than the
  // table's optics would, so it reads at 64 px.
  const beams = makeBeamRenderer();
  const seg = (x0, y0, x1, y1, c, w) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    return { x0, y0, x1, y1, dx: dx / len, dy: dy / len, len, ...c, w0: w, w1: w, wBase: w, wMin: 3, f: 0, spread: 0, since: 0, depth: 0, lamp: 0, end: 'rim' };
  };
  const px = 236;
  const py = 256;
  const segs = [
    seg(-20, py, px - 26, py, { r: 50, g: 50, b: 50 }, 16),
    seg(px + 22, py - 10, 560, py - 150, { r: 0, g: 0, b: 150 }, 14),
    seg(px + 22, py, 560, py, { r: 0, g: 150, b: 0 }, 14),
    seg(px + 22, py + 10, 560, py + 150, { r: 150, g: 0, b: 0 }, 14),
  ];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  beams.draw(ctx, segs, null, { quality: 'low', dt: 0 });
  const k = 2.6;
  ctx.setTransform(k, 0, 0, k, px - 0.5 * CELL * k, py - 0.5 * CELL * k);
  drawPiece(ctx, { id: 1, type: 'prism', c: 0, r: 0, angle: 90, cracked: 0, t0: 0, pulseUntil: 0 }, 0, { quality: 'high' });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  window.__posterReady = true;
}

const BADGES = {
  'first-burn': (ctx) => {
    beamAcross(ctx, 'w');
    shade(ctx, 'wisp', 'w', 128, 128, 1.9, 0.9);
  },
  rainbow: (ctx) => {
    const board = buildBoard('octagon');
    const pieces = [{ id: 1, type: 'prism', c: 7, r: 6, angle: 90, cracked: 0, t0: 0, pulseUntil: 0 }];
    const lamps = [{ x: 7.5 * CELL - 160, y: 6.5 * CELL, angle: 0, power: 130, radius: 22 }];
    const tr = traceBeams({ board, pieces, lamps, t: 0, mods: baseMods() });
    const beams = makeBeamRenderer();
    const k = 1.3;
    ctx.setTransform(k, 0, 0, k, 128 - 7.5 * CELL * k + 10, 128 - 6.5 * CELL * k);
    beams.draw(ctx, tr.segments, null, { quality: 'low', dt: 0 });
    drawPiece(ctx, pieces[0], 0, { quality: 'high' });
  },
  'focus-point': (ctx) => {
    const board = buildBoard('octagon');
    const pieces = [{ id: 1, type: 'lens', c: 7, r: 6, angle: 90, cracked: 0, t0: 0, pulseUntil: 0 }];
    const lamps = [{ x: 7.5 * CELL - 140, y: 6.5 * CELL, angle: 0, power: 130, radius: 22 }];
    const tr = traceBeams({ board, pieces, lamps, t: 0, mods: baseMods() });
    const beams = makeBeamRenderer();
    const k = 1.1;
    ctx.setTransform(k, 0, 0, k, 128 - 7.5 * CELL * k - 60, 128 - 6.5 * CELL * k);
    beams.draw(ctx, tr.segments, null, { quality: 'low', dt: 0 });
    drawPiece(ctx, pieces[0], 0, { quality: 'high' });
  },
  'mirror-maze': (ctx) => {
    const board = buildBoard('octagon');
    const pieces = [
      { id: 1, type: 'mirror', c: 6, r: 6, angle: 45, cracked: 0, t0: 0, pulseUntil: 0 },
      { id: 2, type: 'mirror', c: 6, r: 8, angle: 135, cracked: 0, t0: 0, pulseUntil: 0 },
      { id: 3, type: 'mirror', c: 8, r: 8, angle: 45, cracked: 0, t0: 0, pulseUntil: 0 },
      { id: 4, type: 'mirror', c: 8, r: 6, angle: 135, cracked: 0, t0: 0, pulseUntil: 0 },
    ];
    const lamps = [{ x: 6.5 * CELL - 120, y: 6.5 * CELL, angle: 0, power: 120, radius: 22 }];
    const tr = traceBeams({ board, pieces, lamps, t: 0, mods: baseMods() });
    const beams = makeBeamRenderer();
    const k = 0.95;
    ctx.setTransform(k, 0, 0, k, 128 - 7.5 * CELL * k, 128 - 7.5 * CELL * k);
    beams.draw(ctx, tr.segments, null, { quality: 'low', dt: 0 });
    for (const p of pieces) drawPiece(ctx, p, 0, { quality: 'high' });
  },
  'heat-wave': (ctx) => {
    ctx.setTransform(2.4, 0, 0, 2.4, 128 - 0.5 * CELL * 2.4, 128 - 0.5 * CELL * 2.4);
    drawPiece(ctx, { id: 1, type: 'mirror', c: 0, r: 0, angle: 45, heat: 96, cracked: 1, t0: 0, pulseUntil: 0 }, 0, { quality: 'high' });
  },
  'umbra-down': (ctx) => {
    beamAcross(ctx, 'r');
    shade(ctx, 'umbra', 'r', 128, 128, 1.6, 0.8, 1);
  },
  'lens-eater-down': (ctx) => {
    beamAcross(ctx, 'w');
    shade(ctx, 'lenseater', 'w', 128, 128, 1.5, 0.8, 0, 1);
  },
  'long-dusk-done': (ctx) => {
    const g = ctx.createRadialGradient(128, 150, 10, 128, 150, 120);
    g.addColorStop(0, 'rgba(255,244,214,0.9)');
    g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawHeart(ctx, { x: 128, y: 150, radius: 46 }, 1, 1, 0, { reduced: true });
  },
  'twin-hearts': (ctx) => {
    drawHeart(ctx, { x: 86, y: 128, radius: 36 }, 1, 0.6, 0, { reduced: true });
    drawHeart(ctx, { x: 170, y: 128, radius: 36 }, 1, 0.6, 0, { reduced: true });
  },
  ascendant: (ctx) => {
    ctx.strokeStyle = PALETTE.brass;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(128, 128, 90, 0, Math.PI * 2);
    ctx.stroke();
    for (let d = 0; d < 360; d += 15) {
      const a = (d * Math.PI) / 180;
      ctx.lineWidth = d % 45 === 0 ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(128 + Math.cos(a) * 80, 128 + Math.sin(a) * 80);
      ctx.lineTo(128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100);
      ctx.stroke();
    }
    ctx.fillStyle = PALETTE.bone;
    ctx.beginPath();
    ctx.arc(128, 128, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.felt;
    ctx.beginPath();
    ctx.arc(148, 118, 40, 0, Math.PI * 2);
    ctx.fill();
  },
  'daily-dusk': (ctx) => {
    ctx.strokeStyle = PALETTE.brass;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(128, 128, 90, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = PALETTE.brassHi;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70, i === 2 ? 9 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(128, 128);
    glyph(ctx, 'w', 26, PALETTE.bone);
    ctx.restore();
  },
};

function beamAcross(ctx, hue) {
  const beams = makeBeamRenderer();
  const col = hue === 'r' ? { r: 100, g: 0, b: 0 } : hue === 'b' ? { r: 0, g: 0, b: 100 } : { r: 40, g: 40, b: 40 };
  const seg = { x0: 0, y0: 128, x1: 256, y1: 128, dx: 1, dy: 0, len: 256, ...col, w0: 10, w1: 10, wBase: 10, wMin: 3, f: 0, spread: 0, since: 0, depth: 0, lamp: 0, end: 'rim' };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  beams.draw(ctx, [seg], null, { quality: 'low', dt: 0 });
}

function shade(ctx, type, hue, x, y, scale, burn, phase = 0, eye = 0) {
  const r = makeShadeRenderer();
  const s = makeShade(1, type, hue, 0, 0, 0, 1);
  s.burn = burn;
  s.phase = phase;
  s.eye = eye;
  s.hx = 1;
  s.hy = 0;
  ctx.setTransform(scale, 0, 0, scale, x, y);
  r.draw(ctx, [s], 0.4, { scale }, { pixelRatio: 1, quality: 'high' });
}

async function badge(canvas, id) {
  const ctx = setup(canvas, 256, 256);
  ctx.clearRect(0, 0, 256, 256);
  const fn = BADGES[id];
  if (fn) fn(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  await new Promise((r) => requestAnimationFrame(r));
  window.__posterReady = true;
}

export const BADGE_IDS = Object.keys(BADGES);
