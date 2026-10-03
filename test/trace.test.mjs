import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard } from '../game/sim/boards.js';
import { traceBeams, hueOf, countColourCrossings, widthAt } from '../game/sim/trace.js';
import { baseMods, MAX_RAYS, MAX_DEPTH } from '../game/sim/pieces.js';

const board = buildBoard('octagon');
const lamp = (angle = 0, power = 100) => [{ x: board.lamps[0].x, y: board.lamps[0].y, angle, power, radius: 22 }];
const P = (s) => s.r + s.g + s.b;
const piece = (id, type, c, r, angle = 0, extra = {}) => ({ id, type, c, r, angle, cracked: 0, t0: 0, pulseUntil: 0, ...extra });

test('an empty table: the Lamp lights the Heart with its full power', () => {
  const out = traceBeams({ board, pieces: [], lamps: lamp() });
  assert.equal(out.segments.length, 1);
  assert.equal(out.segments[0].end, 'heart');
  assert.equal(Math.round(out.heart[0]), 100);
});

test('a mirror at 45 degrees turns an eastward beam south and keeps 93%', () => {
  const out = traceBeams({ board, pieces: [piece(1, 'mirror', 5, 6, 45)], lamps: lamp() });
  assert.equal(out.segments.length, 2);
  const s = out.segments[1];
  assert.ok(Math.abs(s.dx) < 1e-9 && s.dy > 0.999);
  assert.equal(Math.round(P(s)), 93);
  assert.equal(Math.round(out.load.get(1).heat), 7);
});

test('a splitter makes two beams whose energy sums to 95%', () => {
  const out = traceBeams({ board, pieces: [piece(1, 'splitter', 5, 6, 45)], lamps: lamp() });
  assert.equal(out.segments.length, 3);
  const total = P(out.segments[1]) + P(out.segments[2]);
  assert.ok(Math.abs(total - 95) < 1e-6);
});

test('a prism fans white into three pure colours at 8, 14 and 20 degrees', () => {
  const out = traceBeams({ board, pieces: [piece(1, 'prism', 5, 6, 90)], lamps: lamp() });
  const fan = out.segments.filter((s) => s.depth === 1);
  assert.equal(fan.length, 3);
  const hues = fan.map(hueOf).sort();
  assert.deepEqual(hues, ['b', 'g', 'r']);
  for (const s of fan) {
    const ang = Math.abs((Math.atan2(s.dy, s.dx) * 180) / Math.PI);
    assert.ok([8, 14, 20].some((a) => Math.abs(ang - a) < 1e-6), `angle ${ang}`);
    assert.ok(Math.abs(P(s) - (100 / 3) * 1.1) < 1e-6);
  }
});

test('a red filter passes only red at 90% and heats on what it rejects', () => {
  const out = traceBeams({ board, pieces: [piece(1, 'filter-r', 5, 6, 0)], lamps: lamp() });
  const after = out.segments.find((s) => s.depth === 1);
  assert.ok(after);
  assert.equal(after.g, 0);
  assert.equal(after.b, 0);
  assert.ok(Math.abs(after.r - 30) < 1e-6);
  assert.ok(out.load.get(1).heat > 15);
});

test('a convex lens narrows the beam to its focus 180 px on, then it widens again', () => {
  const out = traceBeams({ board, pieces: [piece(1, 'lens', 4, 6, 90)], lamps: lamp() });
  const parts = out.segments.filter((s) => s.depth === 1);
  assert.ok(parts.length >= 2);
  assert.equal(parts[0].end, 'focus');
  assert.ok(parts[0].w1 <= 3.01);
  assert.ok(parts[0].w0 > parts[0].w1);
  assert.equal(Math.round(parts[0].len), 180);
  assert.ok(parts[1].w1 > parts[1].w0);
  const ray = { wBase: 10, wMin: 3, f: 180, spread: 0 };
  assert.equal(widthAt(ray, 180), 3);
  assert.equal(widthAt(ray, 0), 10);
  assert.ok(widthAt(ray, 1000) <= 30);
});

test('two facing mirrors make a closed loop that the depth cap and decay end', () => {
  const out = traceBeams({ board, pieces: [piece(1, 'mirror', 3, 6, 90), piece(2, 'mirror', 7, 6, 90)], lamps: lamp() });
  assert.ok(out.segments.length <= MAX_DEPTH + 2);
  assert.ok(out.rays <= MAX_RAYS);
  const last = out.segments[out.segments.length - 1];
  assert.ok(last.depth <= MAX_DEPTH);
});

test('many splitters in a row cannot exceed the ray cap', () => {
  const pieces = [];
  for (let i = 0; i < 12; i++) pieces.push(piece(i + 1, 'splitter', 2 + i, 6, 45 + (i % 2) * 90));
  const out = traceBeams({ board, pieces, lamps: lamp() });
  assert.ok(out.rays <= MAX_RAYS);
  assert.ok(out.segments.length <= MAX_RAYS * 3);
});

test('a cracked piece passes light through dimmed instead of acting', () => {
  const out = traceBeams({ board, pieces: [piece(1, 'mirror', 5, 6, 45, { cracked: 1 })], lamps: lamp() });
  const after = out.segments.find((s) => s.depth === 1);
  assert.ok(after && after.dx > 0.99);
  assert.ok(Math.abs(P(after) - 90) < 1e-6);
});

test('a Gloom dims a beam that crosses it; an Umbra shadow swallows it; a Mimic throws it back', () => {
  const gl = traceBeams({ board, pieces: [], lamps: lamp(), zones: { glooms: [{ id: 9, x: 300, y: 416, r: 96, factor: 0.4 }] } });
  assert.ok(gl.segments.some((s) => s.end === 'gloom'));
  assert.ok(Math.abs(Math.round(gl.heart[0]) - 40) <= 1);
  const sh = traceBeams({ board, pieces: [], lamps: lamp(), zones: { shadows: [{ x: 300, y: 416, r: 80 }] } });
  assert.equal(sh.segments[0].end, 'shadow');
  assert.equal(sh.heart[0], 0);
  const mi = traceBeams({ board, pieces: [], lamps: lamp(), zones: { mimics: [{ id: 3, x: 300, y: 416, r: 15, hx: -1, hy: 0 }] } });
  assert.equal(mi.segments[0].end, 'mimic');
  assert.ok(mi.segments.length >= 2 && mi.segments[1].dx < 0);
  // A focused beam from behind kills it instead.
  const be = traceBeams({ board, pieces: [piece(1, 'lens', 2, 6, 90)], lamps: lamp(), zones: { mimics: [{ id: 3, x: 160 + 180, y: 416, r: 15, hx: 1, hy: 0 }] } });
  assert.equal(be.mimicHits.length, 1);
});

test('a combiner merges what reaches it and fires along its facing', () => {
  const pieces = [piece(1, 'splitter', 3, 6, 45), piece(2, 'mirror', 3, 9, 45), piece(3, 'combiner', 6, 6, 0), piece(4, 'mirror', 6, 9, 315)];
  // Lamp -> splitter: half passes east into the combiner, half reflects south to a mirror, east to a mirror, north into the combiner.
  const out = traceBeams({ board, pieces, lamps: lamp() });
  const fired = out.segments.filter((s) => s.x0 > 6 * 64 + 20 && s.x0 < 6 * 64 + 60 && s.depth === 0);
  assert.equal(fired.length, 1);
  assert.ok(P(fired[0]) > 60, `combined power ${P(fired[0])}`);
});

test('garbage never throws: NaN lamps, absurd angles, unknown piece types, missing fields', () => {
  const out = traceBeams({ board, pieces: [{ id: 1, type: 'nonsense', c: 5, r: 6 }, { id: 2, type: 'mirror', c: 5, r: 7, angle: NaN }], lamps: [{ x: NaN, y: 10, angle: Infinity, power: 1e9 }, { x: 32, y: 416, angle: 'x', power: 100 }] });
  assert.ok(Array.isArray(out.segments));
  for (const s of out.segments) for (const k of ['x0', 'y0', 'x1', 'y1', 'r', 'g', 'b', 'w0', 'w1']) assert.ok(Number.isFinite(s[k]), k);
});

test('colour crossings count beams of different hue that cross', () => {
  const a = { x0: 0, y0: 0, x1: 100, y1: 100, r: 30, g: 0, b: 0 };
  const b = { x0: 0, y0: 100, x1: 100, y1: 0, r: 0, g: 0, b: 30 };
  const c = { x0: 0, y0: 50, x1: 100, y1: 50, r: 30, g: 0, b: 0 };
  assert.equal(countColourCrossings([a, b]), 1);
  assert.equal(countColourCrossings([a, c]), 0);
  assert.equal(hueOf({ r: 10, g: 10, b: 10 }), 'white');
  assert.equal(hueOf({ r: 0, g: 0, b: 0 }), 'white');
});

test('mods change the optics: polished mirrors keep 98%, dichroic prisms add a white beam', () => {
  const mods = { ...baseMods(), mirrorKeep: 0.98, prismWhite: 0.25 };
  const m = traceBeams({ board, pieces: [piece(1, 'mirror', 5, 6, 45)], lamps: lamp(), mods });
  assert.ok(Math.abs(P(m.segments[1]) - 98) < 1e-6);
  const p = traceBeams({ board, pieces: [piece(1, 'prism', 5, 6, 90)], lamps: lamp(), mods });
  assert.equal(p.segments.filter((s) => s.depth === 1).length, 4);
});
