// The three arenas: fixed, hand-made layouts of the same size (W x H units) with different obstacles and colors.
// Obstacles are solid footprints (rectangles by center and size, circles by center and radius) that characters run around.
// `kind` only chooses how an obstacle is drawn. `decor` is paint on the ground: nothing blocks.

import { W, H, hash32, rng, shuffle } from './rules.js';

const rect = (kind, x, y, w, h, extra) => ({ t: 'rect', kind, x, y, w, h, ...extra });
const circle = (kind, x, y, r, extra) => ({ t: 'circle', kind, x, y, r, ...extra });

function finish(map) {
  for (const o of map.obstacles) {
    if (o.t === 'rect') {
      o.x0 = o.x - o.w / 2;
      o.x1 = o.x + o.w / 2;
      o.y0 = o.y - o.h / 2;
      o.y1 = o.y + o.h / 2;
      o.sortY = o.y1;
    } else {
      o.sortY = o.y + o.r;
    }
  }
  map.obstacles.sort((a, b) => a.sortY - b.sortY);
  return map;
}

export const MAPS = {
  backyard: finish({
    id: 'backyard',
    name: 'Backyard',
    pal: { bg: '#2f7a35', bg2: '#276b2d', ground: '#74c94f', stripe: '#67bb44', edge: '#c98a4b', edgeDark: '#7a4a1e', ink: '#1d3a1a' },
    obstacles: [
      circle('tree', 4.0, 3.2, 0.65),
      circle('pool', 12, 7, 1.9),
      rect('crate', 7.5, 10.6, 1.5, 1.5),
      rect('crate', 16.5, 3.4, 1.5, 1.5),
      rect('crate', 20.2, 10.4, 1.5, 1.5),
      rect('crate', 3.4, 10.0, 1.5, 1.5),
      rect('house', 20.6, 3.6, 2.2, 1.6),
    ],
    decor: [
      { k: 'flowers', x: 11.6, y: 0.75, w: 4.4, h: 0.9 },
      { k: 'flowers', x: 11.6, y: 13.25, w: 4.4, h: 0.9 },
      { k: 'flowers', x: 1.0, y: 7.4, w: 0.9, h: 3.2 },
    ],
    spawns: [
      [2.5, 1.6], [9, 1.6], [15, 1.6], [21.5, 1.6],
      [2.5, 12.4], [9.5, 12.4], [15, 12.4], [21.5, 12.4],
      [1.6, 6.6], [22.4, 7.4], [7.5, 6.5], [16.5, 7.5],
    ],
  }),
  beach: finish({
    id: 'beach',
    name: 'Beach',
    pal: { bg: '#2fb4e6', bg2: '#5ccbf0', ground: '#f6d98b', stripe: '#f0cd78', edge: '#ffffff', edgeDark: '#1a86b4', ink: '#7a5a1c' },
    obstacles: [
      circle('castle', 12, 7, 1.3),
      circle('umbrella', 5.6, 4.4, 0.4, { hue: '#ff4b4b' }),
      circle('umbrella', 18.4, 10.0, 0.4, { hue: '#38a8ff' }),
      circle('umbrella', 19.6, 3.6, 0.4, { hue: '#ffd21f' }),
      circle('rock', 8.6, 10.7, 0.9),
      circle('rock', 15.4, 3.7, 0.85),
      circle('rock', 3.0, 9.6, 0.8),
    ],
    decor: [
      { k: 'towel', x: 15.2, y: 10.7, w: 2.2, h: 1.3, hue: '#ff5cc8' },
      { k: 'towel', x: 7.6, y: 7.6, w: 2.2, h: 1.3, hue: '#4458ff' },
      { k: 'shell', x: 20.8, y: 7.2 },
      { k: 'shell', x: 3.4, y: 5.6 },
      { k: 'shell', x: 13.6, y: 12.2 },
    ],
    spawns: [
      [2.5, 1.6], [9, 1.6], [15, 1.6], [21.5, 1.6],
      [2.5, 12.4], [9.5, 12.4], [15, 12.4], [21.5, 12.4],
      [1.6, 6.2], [22.4, 7.4], [7.6, 6.8], [16.6, 6.2],
    ],
  }),
  playground: finish({
    id: 'playground',
    name: 'Playground',
    pal: { bg: '#59b948', bg2: '#4ca83c', ground: '#4fb9a6', stripe: '#43a794', edge: '#ffd23f', edgeDark: '#a8761a', ink: '#1c4d45' },
    obstacles: [
      rect('slide', 5.8, 3.3, 3.6, 1.3),
      circle('swing', 17.4, 3.2, 0.4, { bar: 21.0 }),
      circle('swing', 21.0, 3.2, 0.4),
      rect('sandbox', 12, 7, 3.8, 2.4),
      rect('bench', 6.0, 10.8, 2.2, 0.8),
      rect('bench', 18.6, 10.8, 2.2, 0.8),
      circle('tires', 2.4, 7.0, 0.7),
    ],
    decor: [
      { k: 'ring', x: 12, y: 7, r: 3.6 },
      { k: 'line', x: 4.5, y: 6.2, w: 3.0, h: 0.18 },
      { k: 'line', x: 19.5, y: 6.8, w: 3.0, h: 0.18 },
    ],
    spawns: [
      [2.2, 1.6], [9.5, 1.6], [14.5, 1.6], [22.0, 1.6],
      [2.5, 12.4], [9.5, 12.4], [15, 12.4], [21.5, 12.4],
      [1.5, 4.2], [22.4, 7.6], [7.8, 6.6], [16.6, 7.6],
    ],
  }),
};

export function mapOf(id) {
  return MAPS[id] ?? MAPS.backyard;
}

/** Where the `index`-th player of a round starts: the same on every page (it depends only on the map and the round id). */
export function spawnAt(map, rid, index) {
  const order = shuffle(map.spawns.map((_, i) => i), rng(hash32(map.id + '|' + rid)));
  return map.spawns[order[((index % order.length) + order.length) % order.length]];
}

export { W, H };
