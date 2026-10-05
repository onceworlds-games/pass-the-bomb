import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, spawnAt } from '../game/maps.js';
import { insideAny } from '../game/sim.js';
import { W, H, R, MAP_IDS } from '../game/rules.js';

for (const id of MAP_IDS) {
  const map = MAPS[id];
  test(`${id}: 5 to 8 solid obstacles inside the arena, 12 free spawn spots`, () => {
    assert.ok(map.obstacles.length >= 5 && map.obstacles.length <= 8, `obstacles: ${map.obstacles.length}`);
    for (const o of map.obstacles) {
      if (o.t === 'circle') assert.ok(o.x - o.r > 0 && o.x + o.r < W && o.y - o.r > 0 && o.y + o.r < H, `${o.kind} leaves the arena`);
      else assert.ok(o.x0 > 0 && o.x1 < W && o.y0 > 0 && o.y1 < H, `${o.kind} leaves the arena`);
    }
    assert.equal(map.spawns.length, 12);
    for (const [x, y] of map.spawns) assert.equal(insideAny(map, x, y, R + 0.15), false, `spawn ${x},${y} is blocked`);
    for (let i = 0; i < map.spawns.length; i++) {
      for (let j = i + 1; j < map.spawns.length; j++) {
        const d = Math.hypot(map.spawns[i][0] - map.spawns[j][0], map.spawns[i][1] - map.spawns[j][1]);
        assert.ok(d > 2.5, `spawns ${i} and ${j} are ${d.toFixed(2)} apart`);
      }
    }
  });

  test(`${id}: every open spot is reachable even for a character twice as wide (no dead pockets or pinch points)`, () => {
    const pad = R + 0.35;
    const step = 0.2;
    const cols = Math.round(W / step) + 1;
    const rows = Math.round(H / step) + 1;
    const free = new Uint8Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) free[j * cols + i] = insideAny(map, i * step, j * step, pad) ? 0 : 1;
    const seen = new Uint8Array(cols * rows);
    const start = map.spawns[0];
    const queue = [Math.round(start[1] / step) * cols + Math.round(start[0] / step)];
    assert.equal(free[queue[0]], 1);
    seen[queue[0]] = 1;
    let count = 0;
    while (queue.length) {
      const c = queue.pop();
      count++;
      const i = c % cols;
      const j = (c / cols) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const n = nj * cols + ni;
        if (free[n] && !seen[n]) {
          seen[n] = 1;
          queue.push(n);
        }
      }
    }
    const total = free.reduce((a, b) => a + b, 0);
    assert.equal(count, total, `${total - count} open cells can't be reached`);
    for (const [x, y] of map.spawns) assert.ok(seen[Math.round(y / step) * cols + Math.round(x / step)], `spawn ${x},${y} is cut off`);
  });

  test(`${id}: spawn spots for a round are the same on every page and all different`, () => {
    const a = Array.from({ length: 12 }, (_, i) => spawnAt(map, 'm1.2', i));
    const b = Array.from({ length: 12 }, (_, i) => spawnAt(map, 'm1.2', i));
    assert.deepEqual(a, b);
    assert.equal(new Set(a.map((p) => p.join(','))).size, 12);
    assert.notDeepEqual(a, Array.from({ length: 12 }, (_, i) => spawnAt(map, 'm1.3', i)));
  });
}
