// Bot brains. A bot chooses a movement vector and a dash press each step; the host then moves it with the same stepChar()
// as a player's own character. Holding a bomb: chase the nearest player who can be tagged. Not holding: run from a close
// holder (toward open space), otherwise wander. Bots react a moment late and aren't perfect (a quarter of their dashes miss).

import { W, H, R, clamp } from './rules.js';
import { insideAny } from './sim.js';

const FLEE_RANGE = 8;
const LEAD = 0.3; // seconds ahead a chaser aims
const DASH_RANGE = 2.5;
const FEEL = 1.7;
const TURNS = [0.6, 1.2, 1.9, 2.6]; // radians tried either side when something is in the way

export function makeBrain(rand) {
  return {
    mode: 'wander',
    pend: '',
    pendAt: 0,
    tid: '',
    tAt: 0,
    wx: W / 2,
    wy: H / 2,
    wAt: 0,
    fx: 1,
    fy: 0,
    fAt: 0,
    side: rand() < 0.5 ? 1 : -1,
    dashAt: 0,
    nudge: 0,
    nx: 0,
    ny: 0,
    stuckAt: 0,
    stuckX: 0,
    stuckY: 0,
    moving: false,
    sx: 0,
    sy: 0,
    mx: 0,
    my: 0,
    dash: false,
  };
}

function blockedRay(x, y, dx, dy, len, map) {
  const pad = R + 0.12;
  return insideAny(map, x + dx * len * 0.4, y + dy * len * 0.4, pad) || insideAny(map, x + dx * len * 0.7, y + dy * len * 0.7, pad) || insideAny(map, x + dx * len, y + dy * len, pad);
}

/** Sets (b.sx, b.sy): the wanted direction (dx, dy), turned aside if something is in the way. */
function steer(b, self, dx, dy, map) {
  if (!blockedRay(self.x, self.y, dx, dy, FEEL, map)) {
    b.sx = dx;
    b.sy = dy;
    return;
  }
  for (let i = 0; i < TURNS.length; i++) {
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? b.side : -b.side;
      const a = TURNS[i] * side;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const rx = dx * c - dy * sn;
      const ry = dx * sn + dy * c;
      if (!blockedRay(self.x, self.y, rx, ry, FEEL, map)) {
        b.side = side;
        b.sx = rx;
        b.sy = ry;
        return;
      }
    }
  }
  b.sx = -dx;
  b.sy = -dy;
}

/** Picks the direction that gets the farthest from the holder while staying in open space and out of corners. */
function fleeDir(b, self, holder, map, rand) {
  const hx = holder.x + holder.vx * 0.25;
  const hy = holder.y + holder.vy * 0.25;
  let best = -1e9;
  let bx = b.fx;
  let by = b.fy;
  for (let i = 0; i < 16; i++) {
    const ang = (i * Math.PI) / 8;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const px = self.x + dx * 3.2;
    const py = self.y + dy * 3.2;
    let pen = 0;
    if (insideAny(map, px, py, R + 0.2)) pen += 6;
    if (insideAny(map, self.x + dx * 1.6, self.y + dy * 1.6, R + 0.2)) pen += 6;
    const d = Math.hypot(px - hx, py - hy);
    const wall = Math.min(px, W - px, py, H - py);
    const corner = Math.min(px, W - px) < 2.4 && Math.min(py, H - py) < 2.4 ? 3 : 0;
    const score = d + Math.min(wall, 3) * 0.8 - corner - pen + (dx * b.fx + dy * b.fy) * 0.7 + rand() * 0.4;
    if (score > best) {
      best = score;
      bx = dx;
      by = dy;
    }
  }
  b.fx = bx;
  b.fy = by;
}

function findAgent(agents, n, id) {
  for (let i = 0; i < n; i++) if (agents[i].id === id) return agents[i];
  return null;
}

/** A dash that sometimes goes a little the wrong way. */
function sloppy(b, rand) {
  if (rand() < 0.25) {
    const a = (rand() < 0.5 ? -1 : 1) * (0.3 + rand() * 0.35);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = b.sx * c - b.sy * s;
    b.sy = b.sx * s + b.sy * c;
    b.sx = x;
  }
}

/**
 * One decision. `self` is the bot's character, `agents[0..n)` everyone still in the round (with id, x, y, vx, vy, dash,
 * hold, imm, stun, tag), `me` the bot's own entry, `now` match ms. Fills b.mx, b.my (length <= 1) and b.dash.
 */
export function think(b, self, agents, n, map, now, rand, me) {
  b.dash = false;
  b.mx = 0;
  b.my = 0;
  if (me.stun) {
    b.moving = false;
    return;
  }
  if (now < b.nudge) {
    b.mx = b.nx;
    b.my = b.ny;
    return;
  }
  if (now >= b.stuckAt) {
    if (b.stuckAt > 0 && b.moving && Math.hypot(self.x - b.stuckX, self.y - b.stuckY) < 0.25) {
      const a = rand() * Math.PI * 2;
      b.nudge = now + 350;
      b.nx = Math.cos(a);
      b.ny = Math.sin(a);
      b.side = -b.side;
      b.wAt = 0;
      b.stuckAt = now + 1000;
      b.stuckX = self.x;
      b.stuckY = self.y;
      return;
    }
    b.stuckAt = now + 1000;
    b.stuckX = self.x;
    b.stuckY = self.y;
  }

  let holder = null;
  let hd = 1e9;
  for (let i = 0; i < n; i++) {
    const a = agents[i];
    if (a.id === me.id || !a.hold) continue;
    const d = Math.hypot(a.x - self.x, a.y - self.y);
    if (d < hd) {
      hd = d;
      holder = a;
    }
  }
  const want = me.hold ? 'hold' : holder && hd < FLEE_RANGE ? 'flee' : 'wander';
  if (want !== b.mode) {
    if (b.pend !== want) {
      b.pend = want;
      b.pendAt = now + 200 + rand() * 300; // a moment to notice
    }
    if (now >= b.pendAt) {
      b.mode = want;
      b.pend = '';
      b.fAt = 0;
      b.tAt = 0;
      b.dashAt = 0;
    }
  } else {
    b.pend = '';
  }

  let speed = 1;
  let moved = false;
  if (b.mode === 'hold') {
    if (now >= b.tAt) {
      b.tAt = now + 150;
      let best = null;
      let bd = 1e9;
      for (let i = 0; i < n; i++) {
        const a = agents[i];
        if (!a.tag || a.id === me.id) continue;
        const d = (a.x - self.x) * (a.x - self.x) + (a.y - self.y) * (a.y - self.y);
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      b.tid = best ? best.id : '';
    }
    const t = b.tid ? findAgent(agents, n, b.tid) : null;
    if (t && t.tag) {
      const tx = clamp(t.x + t.vx * LEAD, R, W - R);
      const ty = clamp(t.y + t.vy * LEAD, R, H - R);
      let dx = tx - self.x;
      let dy = ty - self.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      steer(b, self, dx, dy, map);
      moved = true;
      const dist = Math.hypot(t.x - self.x, t.y - self.y);
      if (dist < DASH_RANGE && self.dashCd <= 0) {
        if (b.dashAt === 0) b.dashAt = now + 60 + rand() * 160;
        if (now >= b.dashAt) {
          b.dash = true;
          b.dashAt = 0;
          sloppy(b, rand);
        }
      } else {
        b.dashAt = 0;
      }
    }
  } else if (b.mode === 'flee' && holder) {
    if (now >= b.fAt) {
      b.fAt = now + 180 + rand() * 200;
      fleeDir(b, self, holder, map, rand);
    }
    steer(b, self, b.fx, b.fy, map);
    moved = true;
    if (self.dashCd <= 0 && ((hd < 2.0 && holder.dash) || hd < 1.1)) {
      if (b.dashAt === 0) b.dashAt = now + 100 + rand() * 200;
      if (now >= b.dashAt) {
        b.dash = true;
        b.dashAt = 0;
        sloppy(b, rand);
      }
    } else {
      b.dashAt = 0;
    }
  }
  if (!moved) {
    // wander loosely toward a spot in the open
    speed = 0.6;
    if (now >= b.wAt || Math.hypot(b.wx - self.x, b.wy - self.y) < 0.7) {
      for (let tries = 0; tries < 8; tries++) {
        const x = R + 1 + rand() * (W - 2 * R - 2);
        const y = R + 1 + rand() * (H - 2 * R - 2);
        if (!insideAny(map, x, y, R + 0.5)) {
          b.wx = x;
          b.wy = y;
          break;
        }
      }
      b.wAt = now + 1500 + rand() * 2000;
    }
    let dx = b.wx - self.x;
    let dy = b.wy - self.y;
    const len = Math.hypot(dx, dy) || 1;
    steer(b, self, dx / len, dy / len, map);
  }
  b.mx = b.sx * speed;
  b.my = b.sy * speed;
  b.moving = Math.hypot(b.mx, b.my) > 0.3;
}
