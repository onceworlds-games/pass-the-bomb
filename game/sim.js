// One character's movement: the same code runs a player's own character on their page and the bots on the host.
// A character is a plain object made by makeChar(); stepChar() moves it one fixed step (1/60 s).

import { W, H, R, SPEED, SPEED_HOLD, ACCEL, BRAKE, DASH_SPEED, DASH_TIME, DASH_CD, DASH_CD_HOLD, GHOST_SPEED, clamp } from './rules.js';

export function makeChar(x = W / 2, y = H / 2) {
  return { x, y, vx: 0, vy: 0, fx: 1, fy: 0, dashT: 0, dashCd: 0, ddx: 1, ddy: 0, dashed: 0 };
}

export function resetChar(c, x, y) {
  c.x = x;
  c.y = y;
  c.vx = 0;
  c.vy = 0;
  c.dashT = 0;
  c.dashCd = 0;
}

/** True when a point (a character's center) is within `pad` of a wall or an obstacle. */
export function insideAny(map, x, y, pad) {
  if (x < pad || x > W - pad || y < pad || y > H - pad) return true;
  const obs = map.obstacles;
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    if (o.t === 'circle') {
      const dx = x - o.x;
      const dy = y - o.y;
      const m = o.r + pad;
      if (dx * dx + dy * dy < m * m) return true;
    } else {
      const dx = x - clamp(x, o.x0, o.x1);
      const dy = y - clamp(y, o.y0, o.y1);
      if (dx * dx + dy * dy < pad * pad) return true;
    }
  }
  return false;
}

function bounce(c, nx, ny) {
  const vn = c.vx * nx + c.vy * ny;
  if (vn < 0) {
    c.vx -= vn * nx;
    c.vy -= vn * ny;
  }
}

/** Push a character out of every obstacle (it slides along them), then keep it inside the walls. */
export function collide(c, map) {
  const obs = map.obstacles;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.t === 'circle') {
        let dx = c.x - o.x;
        let dy = c.y - o.y;
        const min = R + o.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) {
          dx = 0;
          dy = 1;
          d = 1;
        }
        const nx = dx / d;
        const ny = dy / d;
        c.x = o.x + nx * min;
        c.y = o.y + ny * min;
        bounce(c, nx, ny);
      } else {
        const qx = clamp(c.x, o.x0, o.x1);
        const qy = clamp(c.y, o.y0, o.y1);
        const dx = c.x - qx;
        const dy = c.y - qy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        let nx;
        let ny;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          nx = dx / d;
          ny = dy / d;
          c.x = qx + nx * R;
          c.y = qy + ny * R;
        } else {
          // The center is inside the rectangle: leave by the nearest face.
          const l = c.x - o.x0;
          const r = o.x1 - c.x;
          const t = c.y - o.y0;
          const b = o.y1 - c.y;
          const m = Math.min(l, r, t, b);
          if (m === l) {
            nx = -1;
            ny = 0;
            c.x = o.x0 - R;
          } else if (m === r) {
            nx = 1;
            ny = 0;
            c.x = o.x1 + R;
          } else if (m === t) {
            nx = 0;
            ny = -1;
            c.y = o.y0 - R;
          } else {
            nx = 0;
            ny = 1;
            c.y = o.y1 + R;
          }
        }
        bounce(c, nx, ny);
      }
    }
    keepInside(c);
  }
}

function keepInside(c) {
  if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.vx) || !Number.isFinite(c.vy)) {
    c.x = W / 2;
    c.y = H / 2;
    c.vx = 0;
    c.vy = 0;
  }
  if (c.x < R) {
    c.x = R;
    if (c.vx < 0) c.vx = 0;
  } else if (c.x > W - R) {
    c.x = W - R;
    if (c.vx > 0) c.vx = 0;
  }
  if (c.y < R) {
    c.y = R;
    if (c.vy < 0) c.vy = 0;
  } else if (c.y > H - R) {
    c.y = H - R;
    if (c.vy > 0) c.vy = 0;
  }
}

/**
 * Moves a character one step. (mx, my) is the wanted direction (any length; it is cut to 1), `wantDash` the dash button.
 * The holder of a bomb is a little faster and dashes again sooner; a stunned character can't move or dash.
 * Each dash adds one to `c.dashed`, so whoever draws it can tell a new dash from the old one.
 */
export function stepChar(c, mx, my, wantDash, dt, map, holder, stunned) {
  c.dashCd = c.dashCd > dt ? c.dashCd - dt : 0;
  let ml = Math.hypot(mx, my);
  if (!(ml > 1e-4) || stunned) {
    mx = 0;
    my = 0;
    ml = 0;
  } else if (ml > 1) {
    mx /= ml;
    my /= ml;
    ml = 1;
  }
  const top = holder ? SPEED_HOLD : SPEED;
  if (stunned) c.dashT = 0;
  if (c.dashT > 0) {
    c.dashT -= dt;
    c.vx = c.ddx * DASH_SPEED;
    c.vy = c.ddy * DASH_SPEED;
    if (c.dashT < 0) c.dashT = 0;
  } else if (wantDash && !stunned && c.dashCd <= 0) {
    let dx = mx;
    let dy = my;
    if (ml < 0.1) {
      dx = c.fx;
      dy = c.fy;
    }
    const dl = Math.hypot(dx, dy) || 1;
    c.ddx = dx / dl;
    c.ddy = dy / dl;
    c.dashT = DASH_TIME;
    c.dashCd = holder ? DASH_CD_HOLD : DASH_CD;
    c.vx = c.ddx * DASH_SPEED;
    c.vy = c.ddy * DASH_SPEED;
    c.dashed++;
  } else {
    const tx = mx * top;
    const ty = my * top;
    const dvx = tx - c.vx;
    const dvy = ty - c.vy;
    const dl = Math.hypot(dvx, dvy);
    const over = Math.hypot(c.vx, c.vy) > top + 0.1;
    const a = (ml > 0 && !over ? ACCEL : BRAKE) * dt;
    if (dl <= a) {
      c.vx = tx;
      c.vy = ty;
    } else {
      c.vx += (dvx / dl) * a;
      c.vy += (dvy / dl) * a;
    }
  }
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  const sp = Math.hypot(c.vx, c.vy);
  if (sp > 0.8) {
    c.fx = c.vx / sp;
    c.fy = c.vy / sp;
  }
  collide(c, map);
}

/** Two characters that overlap gently push themselves apart (each moves half; the other page does its half). */
export function softPush(c, ox, oy) {
  const dx = c.x - ox;
  const dy = c.y - oy;
  const min = 2 * R;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  if (d2 < 1e-8) {
    c.x += 0.02;
    return;
  }
  const d = Math.sqrt(d2);
  const push = (min - d) * 0.22;
  c.x += (dx / d) * push;
  c.y += (dy / d) * push;
}

/** A ghost floats: slow, soft, through everything, but never off the arena. */
export function stepGhost(c, mx, my, dt) {
  let ml = Math.hypot(mx, my);
  if (!(ml > 1e-4)) {
    mx = 0;
    my = 0;
    ml = 0;
  } else if (ml > 1) {
    mx /= ml;
    my /= ml;
  }
  const k = Math.min(1, 6 * dt);
  c.vx += (mx * GHOST_SPEED - c.vx) * k;
  c.vy += (my * GHOST_SPEED - c.vy) * k;
  c.x = clamp(c.x + c.vx * dt, 0.5, W - 0.5);
  c.y = clamp(c.y + c.vy * dt, 0.5, H - 0.5);
  if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) {
    c.x = W / 2;
    c.y = H / 2;
    c.vx = c.vy = 0;
  }
}
