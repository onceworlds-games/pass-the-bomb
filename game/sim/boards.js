// Boards: the table's cells, walls, Hearts, Lamp slots and entry arcs, plus the flow field Shades follow.
// Units are reference pixels: a cell is 64 px. Maps: '.' dark beyond the rim (Shades walk it, nothing is
// placed on it), 'o' open felt, '#' brass block (stops beams and Shades), '=' velvet rope (stops Shades only),
// 'H' a Heart, 'L' a Lamp (aimed by `lampAngles`).

export const CELL = 64;
export const VOID = 0;
export const OPEN = 1;
export const WALL = 2;
export const ROPE = 3;
export const HEART = 4;
export const LAMP = 5;

const OCTAGON = [
  '....ooooooooooooo....',
  '...ooooooooooooooo...',
  '..ooooooooooooooooo..',
  '.ooooooooooooooooooo.',
  'ooooooooooooooooooooo',
  'ooooooooooooooooooooo',
  'LoooooooooHoooooooooo',
  'ooooooooooooooooooooo',
  'ooooooooooooooooooooo',
  '.ooooooooooooooooooo.',
  '..ooooooooooooooooo..',
  '...ooooooooooooooo...',
  '....ooooooooooooo....',
];

const CROSS = [
  '......ooooooooo......',
  '......ooooooooo......',
  '......ooooooooo......',
  'ooooooooooooooooooooo',
  'ooooooooooooooooooooo',
  'ooooooooooooooooooooo',
  'LoooooooooHoooooooooo',
  'ooooooooooooooooooooo',
  'ooooooooooooooooooooo',
  'ooooooooooooooooooooo',
  '......ooooooooo......',
  '......ooooooooo......',
  '......ooooooooo......',
];

const TWIN = [
  '.oooooooooLooooooooo.',
  'ooooooooooooooooooooo',
  'ooooooooooooooooooooo',
  'ooooooooooooooooooooo',
  'ooooooooooooooooooooo',
  'ooooooooooooooooooooo',
  'oooooHoooooooooHooooo',
  'ooooooooooooooooooooo',
  'ooooooooooooooooooooo',
  'ooooooooooooooooooooo',
  'ooooooooooooooooooooo',
  'ooooooooooooooooooooo',
  '.ooooooooooooooooooo.',
];

// Two rope rings: the outer gate is east, the inner gate west, so every Shade walks a long spiral in.
const SPIRAL = [
  'ooooooooooooooooooooo',
  'o===================o',
  'o=ooooooooooooooooo=o',
  'o=o#=============#o=o',
  'o=o=ooooooooooooo=o=o',
  'o=o=ooooooooooooo=o=o',
  'L=ooooooooooHoooo=ooo',
  'o=o=ooooooooooooo=o=o',
  'o=o=ooooooooooooo=o=o',
  'o=o#=============#o=o',
  'o=ooooooooooooooooo=o',
  'o===================o',
  'ooooooooooooooooooooo',
];

export const BOARD_DEFS = {
  octagon: { id: 'octagon', name: 'Octagon', map: OCTAGON, lampAngles: [0], arcs: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], unlock: null },
  cross: { id: 'cross', name: 'Cross', map: CROSS, lampAngles: [0], arcs: ['N', 'E', 'S', 'W'], unlock: 'night6' },
  twin: { id: 'twin', name: 'Twin Hearts', map: TWIN, lampAngles: [90], arcs: ['E', 'SE', 'S', 'SW', 'W'], unlock: 'win' },
  spiral: { id: 'spiral', name: 'Spiral', map: SPIRAL, lampAngles: [180], arcs: ['N', 'E', 'S', 'W'], unlock: 'cross-win' },
};

export const BOARD_IDS = Object.keys(BOARD_DEFS);

const ARC_DIRS = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };
const ARC_NAMES = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west' };

/** Builds the playable board: cell kinds, Hearts, Lamps, arcs and the flow field. Pure; cache the result. */
export function buildBoard(id) {
  const def = BOARD_DEFS[id] || BOARD_DEFS.octagon;
  const rows = def.map.length;
  const cols = def.map[0].length;
  const cells = new Uint8Array(cols * rows);
  const hearts = [];
  const lamps = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = def.map[r][c] || '.';
      const i = r * cols + c;
      if (ch === 'o') cells[i] = OPEN;
      else if (ch === '#') cells[i] = WALL;
      else if (ch === '=') cells[i] = ROPE;
      else if (ch === 'H') {
        cells[i] = HEART;
        hearts.push({ c, r, x: (c + 0.5) * CELL, y: (r + 0.5) * CELL, radius: 30 });
      } else if (ch === 'L') {
        cells[i] = LAMP;
        lamps.push({ c, r, x: (c + 0.5) * CELL, y: (r + 0.5) * CELL, angle: def.lampAngles[lamps.length] ?? 0, radius: 22 });
      } else cells[i] = VOID;
    }
  }
  const w = cols * CELL;
  const h = rows * CELL;
  const cx = w / 2;
  const cy = h / 2;
  // Entry arcs: a short line in the dark just past the rim, where a wave's Shades first show their eyes.
  const arcs = def.arcs.map((key) => {
    const [dx, dy] = ARC_DIRS[key];
    const n = Math.hypot(dx, dy);
    const ux = dx / n;
    const uy = dy / n;
    // Walk outward from the centre until the cell is void (or we leave the map), then step one cell further.
    let x = cx;
    let y = cy;
    for (let s = 0; s < 40; s++) {
      const nx = x + ux * CELL * 0.5;
      const ny = y + uy * CELL * 0.5;
      const k = kindAt(cells, cols, rows, nx, ny);
      if (k === VOID) break;
      x = nx;
      y = ny;
    }
    x += ux * CELL * 0.9;
    y += uy * CELL * 0.9;
    const px = -uy;
    const py = ux;
    const half = CELL * 1.6;
    return { id: key, name: ARC_NAMES[key], x, y, ux, uy, x0: x - px * half, y0: y - py * half, x1: x + px * half, y1: y + py * half };
  });
  const board = { id: def.id, name: def.name, cols, rows, w, h, cx, cy, cells, hearts, lamps, arcs, unlock: def.unlock };
  board.flow = buildFlow(board);
  return board;
}

export function kindAt(cells, cols, rows, x, y) {
  const c = Math.floor(x / CELL);
  const r = Math.floor(y / CELL);
  if (c < 0 || r < 0 || c >= cols || r >= rows) return VOID;
  return cells[r * cols + c];
}

export const cellKind = (board, c, r) => (c < 0 || r < 0 || c >= board.cols || r >= board.rows ? VOID : board.cells[r * board.cols + c]);
export const cellIndex = (board, c, r) => r * board.cols + c;
export const cellCentre = (c, r) => ({ x: (c + 0.5) * CELL, y: (r + 0.5) * CELL });
export const cellOf = (x, y) => ({ c: Math.floor(x / CELL), r: Math.floor(y / CELL) });

/** Can a piece stand on this cell? Open felt only, never a Heart, a Lamp, a wall or the dark. */
export const placeable = (board, c, r) => cellKind(board, c, r) === OPEN;

const walkable = (k) => k !== WALL && k !== ROPE;

/**
 * Breadth-first distances from the Hearts over walkable cells (8 directions, no cutting a wall's corner), and a
 * unit direction per cell toward the nearest Heart. Cells no Shade can leave (walled in) point nowhere.
 */
function buildFlow(board) {
  const { cols, rows, cells } = board;
  const n = cols * rows;
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (const h of board.hearts) {
    const i = h.r * cols + h.c;
    dist[i] = 0;
    queue[tail++] = i;
  }
  const steps = [
    [1, 0, 10],
    [-1, 0, 10],
    [0, 1, 10],
    [0, -1, 10],
    [1, 1, 14],
    [1, -1, 14],
    [-1, 1, 14],
    [-1, -1, 14],
  ];
  // Dijkstra on a grid with two costs is a BFS by layers of 10 and 14; a simple relaxation loop is fine here.
  while (head < tail) {
    const i = queue[head++];
    const c = i % cols;
    const r = (i - c) / cols;
    for (const [dc, dr, cost] of steps) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (!walkable(cells[j])) continue;
      if (dc && dr && (!walkable(cells[r * cols + nc]) || !walkable(cells[nr * cols + c]))) continue;
      const nd = dist[i] + cost;
      if (dist[j] === -1 || nd < dist[j]) {
        dist[j] = nd;
        queue[tail++] = j;
        if (tail >= n) {
          // Re-relaxation can push more entries than cells; compact the queue when it fills.
          queue.copyWithin(0, head, tail);
          tail -= head;
          head = 0;
        }
      }
    }
  }
  const dir = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    if (dist[i] <= 0) continue;
    const c = i % cols;
    const r = (i - c) / cols;
    let best = dist[i];
    let bx = 0;
    let by = 0;
    for (const [dc, dr] of steps) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (dist[j] === -1) continue;
      if (dc && dr && (!walkable(cells[r * cols + nc]) || !walkable(cells[nr * cols + c]))) continue;
      if (dist[j] < best) {
        best = dist[j];
        bx = dc;
        by = dr;
      }
    }
    const l = Math.hypot(bx, by) || 1;
    dir[i * 2] = bx / l;
    dir[i * 2 + 1] = by / l;
  }
  return { dist, dir };
}

/** The flow direction at a point, blended across the 4 cells around it so Shades turn smoothly. */
export function flowAt(board, x, y, out) {
  const fx = x / CELL - 0.5;
  const fy = y / CELL - 0.5;
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fy);
  const tx = fx - c0;
  const ty = fy - r0;
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < 4; k++) {
    const c = c0 + (k & 1);
    const r = r0 + (k >> 1);
    const wgt = (k & 1 ? tx : 1 - tx) * (k >> 1 ? ty : 1 - ty);
    if (c < 0 || r < 0 || c >= board.cols || r >= board.rows) continue;
    const i = (r * board.cols + c) * 2;
    sx += board.flow.dir[i] * wgt;
    sy += board.flow.dir[i + 1] * wgt;
  }
  if (sx === 0 && sy === 0) {
    // Off the field (deep in the dark): head straight for the nearest Heart.
    let best = Infinity;
    for (const h of board.hearts) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < best) {
        best = d;
        sx = (h.x - x) / (d || 1);
        sy = (h.y - y) / (d || 1);
      }
    }
  }
  const l = Math.hypot(sx, sy) || 1;
  out.x = sx / l;
  out.y = sy / l;
  return out;
}

/** The walking distance (in cells, approximate) from a point to the nearest Heart; large when unknown. */
export function distToHeart(board, x, y) {
  const { c, r } = cellOf(x, y);
  const d = cellKind(board, c, r) === VOID && (c < 0 || r < 0 || c >= board.cols || r >= board.rows) ? -1 : board.flow.dist[r * board.cols + c];
  if (d >= 0) return d / 10;
  let best = Infinity;
  for (const h of board.hearts) best = Math.min(best, Math.hypot(h.x - x, h.y - y) / CELL);
  return best;
}
