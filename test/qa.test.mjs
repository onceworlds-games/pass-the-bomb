// Undo, the Rotor's swing, the hold of spread light, Second Sight's lanes and the event batching of the session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard } from '../game/sim/boards.js';
import { createNight, TICK, UNDO_WINDOW } from '../game/sim/night.js';
import { pieceAngle, rotorOffset, traceBeams } from '../game/sim/trace.js';
import { PIECES, baseMods, WIDE_HOLD } from '../game/sim/pieces.js';
import { makeLightMap } from '../game/sim/light.js';
import { makeShade, stepShades } from '../game/sim/shades.js';

const board = buildBoard('octagon');
const deck = { mirror: 4, splitter: 1, rotor: 1, concave: 1, lens: 1 };
const mk = () => createNight({ seed: 5, night: 2, board, deck, players: [{ id: 'a' }, { id: 'b', role: 'smith' }], heart: { hp: 100, max: 100 } });

test('Undo takes back a placement at dusk and returns the glass to the tray', () => {
  const N = mk();
  const r = N.command('a', { op: 'place', type: 'mirror', c: 5, r: 5, angle: 45 });
  assert.ok(r.ok);
  assert.equal(N.available('mirror'), 3);
  assert.ok(N.canUndo('a'));
  assert.ok(!N.canUndo('b'), 'only your own change');
  assert.ok(N.command('a', { op: 'undo' }).ok);
  assert.equal(N.S.pieces.length, 0);
  assert.equal(N.available('mirror'), 4);
  assert.equal(N.command('a', { op: 'undo' }).ok, false, 'nothing left to take back');
});

test('Undo at night refunds the Focus a change cost, and only for a few seconds', () => {
  const N = mk();
  const p = N.command('a', { op: 'place', type: 'mirror', c: 5, r: 5, angle: 0 });
  N.command('a', { op: 'wave' });
  const pl = N.player('a');
  pl.focus = 50;
  assert.ok(N.command('a', { op: 'move', id: p.id, c: 6, r: 5 }).ok);
  assert.equal(pl.focus, 45);
  assert.ok(N.command('a', { op: 'undo' }).ok);
  assert.deepEqual([N.pieceById(p.id).c, N.pieceById(p.id).r], [5, 5]);
  assert.equal(pl.focus, 50);
  // A run of turns on one piece is one change.
  N.command('a', { op: 'rotate', id: p.id, angle: 15 });
  N.command('a', { op: 'rotate', id: p.id, angle: 30 });
  N.command('a', { op: 'rotate', id: p.id, angle: 45 });
  assert.ok(Math.abs(pl.focus - 47) < 1e-6);
  assert.ok(N.command('a', { op: 'undo' }).ok);
  assert.equal(N.pieceById(p.id).angle, 0);
  assert.ok(Math.abs(pl.focus - 50) < 1e-6);
  // Too late: the window closes.
  N.command('a', { op: 'rotate', id: p.id, angle: 90 });
  for (let i = 0; i < Math.ceil((UNDO_WINDOW + 0.5) / TICK); i++) N.tick();
  assert.ok(!N.canUndo('a'));
  assert.equal(N.command('a', { op: 'undo' }).ok, false);
});

test('Undo of a sale puts the glass back where it stood; a Smith gives the refund back', () => {
  const N = mk();
  const p = N.command('b', { op: 'place', type: 'lens', c: 8, r: 4, angle: 90 });
  N.command('b', { op: 'wave' });
  const sm = N.player('b');
  sm.focus = 20;
  assert.ok(N.command('b', { op: 'sell', id: p.id }).ok);
  const refunded = sm.focus;
  assert.ok(refunded > 20, 'a Smith is paid back for selling');
  assert.ok(N.command('b', { op: 'undo' }).ok);
  const back = N.S.pieces.find((q) => q.type === 'lens');
  assert.ok(back && back.c === 8 && back.r === 4 && back.angle === 90);
  assert.equal(sm.focus, 20);
});

test('a Rotor rests at either end of its swing and passes between them', () => {
  const R = PIECES.rotor;
  assert.equal(rotorOffset(R.dwell / 2), -R.sweep);
  assert.equal(rotorOffset(0.5 + R.dwell / 2), R.sweep);
  const mid = rotorOffset(R.dwell + (0.5 - R.dwell) / 2);
  assert.ok(mid > -R.sweep && mid < R.sweep);
  const p = { type: 'rotor', angle: 90, t0: 0 };
  const angles = [];
  for (let t = 0; t < R.period; t += 0.05) angles.push(pieceAngle(p, t, baseMods()));
  assert.ok(Math.abs(Math.min(...angles) - (90 - R.sweep)) < 1e-6);
  assert.ok(Math.abs(Math.max(...angles) - (90 + R.sweep)) < 1e-6);
  // Clockwork Key: twice as fast.
  const fast = { ...baseMods(), rotorSpeed: 2 };
  assert.equal(pieceAngle(p, R.period * 0.3, fast), pieceAngle(p, R.period * 0.6, baseMods()));
});

test('light a concave lens has spread holds ink: a Shade wades through it slower than through a plain beam', () => {
  const speedIn = (pieces) => {
    const lamps = [{ x: board.lamps[0].x, y: board.lamps[0].y, angle: 0, power: 100, radius: 22 }];
    const tr = traceBeams({ board, pieces, lamps, t: 0, mods: baseMods() });
    const light = makeLightMap(board);
    light.build(tr.segments);
    // A Creeper on the beam's row, walking toward the Heart along it.
    const s = makeShade(1, 'creeper', 'r', 8.5 * 64, 6.5 * 64, 0, 1);
    const x0 = s.x;
    for (let i = 0; i < 30; i++) stepShades([s], board, TICK, { light, mods: baseMods(), segments: tr.segments, buckets: null });
    return { d: s.x - x0, hold: light.holdAt(8.5 * 64, 6.5 * 64) };
  };
  const plain = speedIn([]);
  const fence = speedIn([{ id: 1, type: 'concave', c: 3, r: 6, angle: 90, t0: 0 }]);
  assert.equal(plain.hold, 0);
  assert.ok(fence.hold > 0.9, `the spread beam holds (${fence.hold})`);
  assert.ok(plain.d > 0 && fence.d > 0);
  assert.ok(fence.d < plain.d * 0.6, `slower in the fence: ${fence.d.toFixed(1)} px vs ${plain.d.toFixed(1)} px in a second`);
  assert.ok(WIDE_HOLD > 0 && WIDE_HOLD < 1);
});
