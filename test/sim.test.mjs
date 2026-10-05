import test from 'node:test';
import assert from 'node:assert/strict';
import { makeChar, stepChar, softPush, stepGhost, insideAny } from '../game/sim.js';
import { MAPS } from '../game/maps.js';
import { W, H, R, STEP, SPEED, SPEED_HOLD, DASH_SPEED, rng } from '../game/rules.js';

const map = MAPS.backyard;
const run = (c, mx, my, secs, opts = {}) => {
  for (let i = 0; i < Math.round(secs / STEP); i++) stepChar(c, mx, my, opts.dash && i === 0, STEP, map, !!opts.holder, !!opts.stun);
};

test('top speed is 6, the holder gets 6.6, and the stop is quick', () => {
  const c = makeChar(2, 12.5);
  run(c, 1, 0, 0.5);
  assert.ok(Math.abs(Math.hypot(c.vx, c.vy) - SPEED) < 1e-6);
  const h = makeChar(2, 12.5);
  run(h, 1, 0, 0.5, { holder: true });
  assert.ok(Math.abs(Math.hypot(h.vx, h.vy) - SPEED_HOLD) < 1e-6);
  run(c, 0, 0, 0.1);
  assert.equal(Math.hypot(c.vx, c.vy), 0);
});

test('diagonal and oversized input never go faster than top speed', () => {
  const c = makeChar(12, 12.8);
  run(c, 5, -5, 0.3);
  assert.ok(Math.hypot(c.vx, c.vy) <= SPEED + 1e-6);
});

test('a dash is a short 18 u/s burst with a 2.5 s cooldown (1.8 s for the holder)', () => {
  const c = makeChar(2, 12.5);
  stepChar(c, 1, 0, true, STEP, map, false, false);
  assert.equal(c.dashed, 1);
  assert.ok(Math.abs(c.vx - DASH_SPEED) < 1e-9);
  assert.ok(Math.abs(c.dashCd - 2.5) < 1e-9);
  for (let i = 0; i < 12; i++) stepChar(c, 1, 0, false, STEP, map, false, false);
  assert.equal(c.dashT, 0, 'the burst is over after 0.18 s');
  stepChar(c, 1, 0, true, STEP, map, false, false);
  assert.equal(c.dashed, 1, 'no second dash during the cooldown');
  const h = makeChar(2, 12.5);
  stepChar(h, 1, 0, true, STEP, map, true, false);
  assert.ok(Math.abs(h.dashCd - 1.8) < 1e-9);
  const d = makeChar(2, 12.5);
  run(d, 0, 0, 0.1);
  stepChar(d, 0, 0, true, STEP, map, false, false);
  assert.equal(d.dashed, 1);
  assert.ok(d.vx > 17, 'with no stick it dashes the way it faces');
});

test('a stunned character can neither move nor dash', () => {
  const c = makeChar(12, 12.5);
  run(c, 1, 0, 0.3, { stun: true });
  assert.equal(c.vx, 0);
  stepChar(c, 1, 0, true, STEP, map, false, true);
  assert.equal(c.dashed, 0);
});

test('walls stop you and obstacles are slid along, never entered', () => {
  const c = makeChar(12, 12.5);
  run(c, 1, 0, 6);
  assert.ok(Math.abs(c.x - (W - R)) < 1e-6);
  const p = makeChar(12, 3);
  run(p, 0, 1, 2); // straight at the pool (12, 7, r 1.9)
  assert.ok(Math.hypot(p.x - 12, p.y - 7) >= 1.9 + R - 1e-6);
  const r = rng(3);
  const m = makeChar(5, 5);
  for (let i = 0; i < 20000; i++) {
    stepChar(m, r() * 2 - 1, r() * 2 - 1, r() < 0.02, STEP, map, false, false);
    assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y));
    assert.equal(insideAny(map, m.x, m.y, R - 0.02), false);
  }
});

test('bad input does not break a character', () => {
  const c = makeChar(5, 5);
  stepChar(c, NaN, Infinity, true, STEP, map, false, false);
  stepChar(c, undefined, null, false, STEP, map, false, false);
  assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.vx));
});

test('overlapping characters push themselves apart softly', () => {
  const c = makeChar(5, 5);
  softPush(c, 5.3, 5);
  assert.ok(c.x < 5);
  const far = makeChar(5, 5);
  softPush(far, 8, 5);
  assert.equal(far.x, 5);
  const same = makeChar(5, 5);
  softPush(same, 5, 5);
  assert.ok(same.x !== 5);
});

test('a ghost floats anywhere inside the arena and nowhere else', () => {
  const g = makeChar(12, 7);
  for (let i = 0; i < 600; i++) stepGhost(g, -1, -1, STEP);
  assert.ok(g.x >= 0.5 && g.y >= 0.5 && Math.hypot(g.vx, g.vy) <= 5.01);
  for (let i = 0; i < 1200; i++) stepGhost(g, 1, 1, STEP);
  assert.ok(g.x <= W - 0.5 && g.y <= H - 0.5);
});
