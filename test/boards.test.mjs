import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, BOARD_IDS, OPEN, VOID, WALL, ROPE, placeable, flowAt, cellKind, CELL, distToHeart } from '../game/sim/boards.js';

test('every board is 21 x 13 with at least one Heart, one Lamp and four arcs', () => {
  for (const id of BOARD_IDS) {
    const b = buildBoard(id);
    assert.equal(b.cols, 21, id);
    assert.equal(b.rows, 13, id);
    assert.ok(b.hearts.length >= 1, id);
    assert.ok(b.lamps.length >= 1, id);
    assert.ok(b.arcs.length >= 4, id);
  }
});

test('every open cell can reach a Heart on every board (no Shade is ever stuck)', () => {
  for (const id of BOARD_IDS) {
    const b = buildBoard(id);
    for (let i = 0; i < b.cells.length; i++) {
      if (b.cells[i] === OPEN || b.cells[i] === VOID) assert.ok(b.flow.dist[i] >= 0, `${id} cell ${i} unreachable`);
    }
  }
});

test('arcs lie in the dark past the rim, and the flow from each arc walks to a Heart', () => {
  for (const id of BOARD_IDS) {
    const b = buildBoard(id);
    for (const arc of b.arcs) {
      assert.equal(cellKind(b, Math.floor(arc.x / CELL), Math.floor(arc.y / CELL)), VOID, `${id} ${arc.id}`);
      let x = arc.x;
      let y = arc.y;
      const dir = { x: 0, y: 0 };
      let arrived = false;
      for (let s = 0; s < 400 && !arrived; s++) {
        flowAt(b, x, y, dir);
        x += dir.x * 16;
        y += dir.y * 16;
        for (const h of b.hearts) if (Math.hypot(h.x - x, h.y - y) < 40) arrived = true;
        const k = cellKind(b, Math.floor(x / CELL), Math.floor(y / CELL));
        assert.ok(k !== WALL && k !== ROPE, `${id} ${arc.id} walked into a wall at step ${s}`);
      }
      assert.ok(arrived, `${id} ${arc.id} never reached a Heart`);
    }
  }
});

test('pieces go only on open felt: never on a Heart, a Lamp, a wall, a rope or the dark', () => {
  const b = buildBoard('spiral');
  assert.equal(placeable(b, 10, 6), false); // Heart
  assert.equal(placeable(b, 0, 6), false); // Lamp
  assert.equal(placeable(b, 1, 1), false); // rope
  assert.equal(placeable(b, 3, 3), false); // brass block
  assert.equal(placeable(b, 5, 5), true);
  assert.equal(placeable(b, -1, 3), false);
  assert.equal(placeable(b, 99, 99), false);
  const o = buildBoard('octagon');
  assert.equal(placeable(o, 0, 0), false); // cut corner
  assert.equal(placeable(o, 10, 1), true);
});

test('distance to the Heart falls along the flow', () => {
  const b = buildBoard('octagon');
  assert.ok(distToHeart(b, 100, 416) > distToHeart(b, 500, 416));
  assert.ok(Number.isFinite(distToHeart(b, -5000, -5000)));
});
