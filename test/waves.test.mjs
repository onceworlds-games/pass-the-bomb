import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, BOARD_IDS } from '../game/sim/boards.js';
import { planNight, expandWave, forecast, nightBudget, waveCount, bossFor } from '../game/sim/waves.js';
import { SHADES } from '../game/sim/shades.js';

test('a thousand seeds plan valid nights: known types, real arcs, counts, times inside the wave', () => {
  const boards = BOARD_IDS.map(buildBoard);
  for (let seed = 1; seed <= 1000; seed++) {
    const board = boards[seed % boards.length];
    const night = 1 + (seed % 14);
    const plan = planNight({ seed, night, board, ascension: seed % 9 });
    assert.equal(plan.waves.length, waveCount(night));
    let total = 0;
    for (const w of plan.waves) {
      assert.ok(w.entries.length >= 1);
      assert.ok(w.hues.length >= 1 && w.hues.length <= 2);
      for (const e of w.entries) {
        assert.ok(SHADES[e.type], `unknown type ${e.type}`);
        assert.ok(e.arc >= 0 && e.arc < board.arcs.length);
        assert.ok(e.n >= 1 && e.n <= 20, `count ${e.n}`);
        assert.ok(e.t >= 0 && e.t <= w.dur, `time ${e.t} of ${w.dur}`);
        assert.ok(['r', 'g', 'b'].includes(e.hue));
        total += e.n;
      }
      assert.ok(total <= 400);
      const spawns = expandWave(w);
      for (let i = 1; i < spawns.length; i++) assert.ok(spawns[i].t >= spawns[i - 1].t);
    }
    const boss = bossFor(night);
    const hasBoss = plan.waves.some((w) => w.entries.some((e) => SHADES[e.type].boss));
    assert.equal(hasBoss, !!boss, `night ${night} boss`);
  }
});

test('the same seed plans the same night; the budget grows every night', () => {
  const board = buildBoard('octagon');
  const a = planNight({ seed: 77, night: 5, board });
  const b = planNight({ seed: 77, night: 5, board });
  assert.deepEqual(a, b);
  for (let n = 1; n < 20; n++) assert.ok(nightBudget(n + 1) > nightBudget(n));
  assert.ok(nightBudget(6, 3) > nightBudget(6, 0));
});

test('only unlocked Shades appear: no Eaters before night 3, no Moths before night 7', () => {
  const board = buildBoard('cross');
  for (let seed = 1; seed <= 200; seed++) {
    for (const night of [1, 2, 4, 6]) {
      const plan = planNight({ seed, night, board });
      for (const w of plan.waves) for (const e of w.entries) {
        if (SHADES[e.type].boss) continue;
        assert.ok(SHADES[e.type].night <= night, `${e.type} on night ${night}`);
      }
    }
  }
});

test('the bosses come on nights 4, 8 and 12 and cycle through Endless', () => {
  assert.equal(bossFor(4).type, 'umbra');
  assert.equal(bossFor(8).type, 'lenseater');
  assert.equal(bossFor(12).type, 'longdusk');
  assert.equal(bossFor(5), null);
  assert.equal(bossFor(16).type, 'umbra');
  assert.ok(bossFor(16).hpMult > 1);
});

test('the tutorial night is fixed and the forecast reads the first wave', () => {
  const board = buildBoard('octagon');
  const plan = planNight({ seed: 1, night: 1, board, tutorial: true });
  assert.equal(plan.tutorial, true);
  assert.equal(plan.waves.length, 3);
  const fc = forecast(plan);
  assert.deepEqual(fc.hues, ['r']);
  assert.equal(fc.arcs.length, 1);
  assert.ok(forecast(plan, true).arcs.length >= 2);
});
