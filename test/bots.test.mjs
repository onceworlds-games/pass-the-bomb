import test from 'node:test';
import assert from 'node:assert/strict';
import { rng, STEP, W, H, R, TAG_DIST } from '../game/rules.js';
import { MAPS } from '../game/maps.js';
import { makeChar, stepChar, insideAny } from '../game/sim.js';
import { makeBrain, think } from '../game/bots.js';

const agent = (id, x, y, extra = {}) => ({ id, x, y, vx: 0, vy: 0, dash: false, hold: false, imm: false, stun: false, tag: true, alive: true, ...extra });

/** Runs one bot for `secs` against fixed (standing) agents and returns its path. */
function run(map, bot, others, secs, seed = 1, hold = false) {
  const rand = rng(seed);
  const brain = makeBrain(rand);
  const ch = makeChar(bot[0], bot[1]);
  const me = agent('me', ch.x, ch.y, { hold, tag: false });
  const agents = [me, ...others];
  const trail = [];
  for (let i = 0; i < secs * 60; i++) {
    const now = i * (1000 / 60);
    me.x = ch.x;
    me.y = ch.y;
    me.vx = ch.vx;
    me.vy = ch.vy;
    think(brain, ch, agents, agents.length, map, now, rand, me);
    assert.ok(Math.hypot(brain.mx, brain.my) <= 1 + 1e-9, 'a bot never asks for more than full speed');
    assert.ok(Number.isFinite(brain.mx) && Number.isFinite(brain.my));
    stepChar(ch, brain.mx, brain.my, brain.dash, STEP, map, hold, false);
    assert.equal(insideAny(map, ch.x, ch.y, R - 0.03), false);
    trail.push([ch.x, ch.y]);
  }
  return { ch, trail };
}

test('a bot holding the bomb runs the target down in the open', () => {
  const map = MAPS.backyard;
  const target = agent('t', 21, 7);
  const { trail } = run(map, [3, 7], [target], 6, 3, true);
  const reached = trail.some(([x, y]) => Math.hypot(x - 21, y - 7) < TAG_DIST);
  assert.ok(reached, 'never got to the standing target');
});

test('a bot holding the bomb gets around obstacles to a target behind them', () => {
  for (const [id, map] of Object.entries(MAPS)) {
    const o = map.obstacles.find((x) => x.x > 10 && x.x < 14 && x.y > 6 && x.y < 8); // the one in the middle
    assert.ok(o, id);
    const target = agent('t', 15.8, 7);
    const { trail } = run(map, [8.2, 7], [target], 8, 5, true);
    assert.ok(trail.some(([x, y]) => Math.hypot(x - 15.8, y - 7) < TAG_DIST + 0.2), `${id}: stuck behind the middle obstacle`);
  }
});

test('a bot with a holder close by runs away from it and stays out of corners', () => {
  const map = MAPS.backyard;
  const holder = agent('h', 9, 7, { hold: true, tag: false });
  const { trail, ch } = run(map, [11, 8], [holder], 4, 9, false);
  const d0 = Math.hypot(11 - 9, 8 - 7);
  const d1 = Math.hypot(ch.x - 9, ch.y - 7);
  assert.ok(d1 > d0 + 3, `only got ${d1.toFixed(1)} away`);
  assert.ok(trail.every(([x, y]) => x > R && y > R));
});

test('a bot with no holder near wanders around', () => {
  const map = MAPS.beach;
  const { trail } = run(map, [12, 12], [agent('far', 1, 1)], 20, 4, false);
  let far = 0;
  for (const [x, y] of trail) far = Math.max(far, Math.hypot(x - 12, y - 12));
  assert.ok(far > 3, 'it never went anywhere');
});

test('a stunned bot stands still', () => {
  const rand = rng(1);
  const brain = makeBrain(rand);
  const ch = makeChar(5, 5);
  const me = agent('me', 5, 5, { stun: true, hold: true, tag: false });
  const agents = [me, agent('t', 8, 5)];
  for (let i = 0; i < 60; i++) think(brain, ch, agents, 2, MAPS.backyard, i * 17, rand, me);
  assert.equal(brain.mx, 0);
  assert.equal(brain.my, 0);
  assert.equal(brain.dash, false);
});

test('bots dash sometimes when chasing, not every moment (cooldown) and not when nothing is near', () => {
  const rand = rng(8);
  const map = MAPS.playground;
  const brain = makeBrain(rand);
  const ch = makeChar(5, 12);
  const me = agent('me', 5, 12, { hold: true, tag: false });
  const t = agent('t', 20, 12);
  const agents = [me, t];
  let dashes = 0;
  for (let i = 0; i < 600; i++) {
    me.x = ch.x; me.y = ch.y;
    think(brain, ch, agents, 2, map, i * (1000 / 60), rand, me);
    if (brain.dash && ch.dashCd <= 0) dashes++;
    stepChar(ch, brain.mx, brain.my, brain.dash, STEP, map, true, false);
  }
  assert.ok(dashes >= 1 && dashes <= 6, `dashed ${dashes} times in 10 s`);
});
