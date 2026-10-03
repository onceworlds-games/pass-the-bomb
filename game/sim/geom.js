// Vector maths and intersections for the beam tracer. Everything here is pure and NaN-safe:
// a bad input gives a "no hit" or a clamped value, never an exception.

export const EPS = 1e-6;
export const DEG = Math.PI / 180;

export const finite = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clampf = (v, lo, hi, fallback = lo) => clamp(finite(v, fallback), lo, hi);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Normalises degrees into [0, 360). */
export function normDeg(a) {
  a = finite(a) % 360;
  return a < 0 ? a + 360 : a;
}

/** Snaps degrees to a step (15 by default); the result is in [0, 360). */
export function snapDeg(a, step = 15) {
  step = step > 0 ? step : 15;
  return normDeg(Math.round(finite(a) / step) * step);
}

/** The shortest signed difference b - a in degrees, in (-180, 180]. */
export function deltaDeg(a, b) {
  let d = normDeg(b) - normDeg(a);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export const dirOf = (deg) => ({ x: Math.cos(deg * DEG), y: Math.sin(deg * DEG) });
export const angleOf = (x, y) => normDeg(Math.atan2(y, x) / DEG);
export const dot = (ax, ay, bx, by) => ax * bx + ay * by;
export const cross = (ax, ay, bx, by) => ax * by - ay * bx;
export const len = (x, y) => Math.hypot(x, y);

export function normalize(x, y) {
  const l = Math.hypot(x, y);
  return l > EPS ? { x: x / l, y: y / l } : { x: 1, y: 0 };
}

/** Rotates a direction by `deg` degrees. */
export function rotate(x, y, deg) {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return { x: x * c - y * s, y: x * s + y * c };
}

/** Reflects a direction across a surface whose normal is (nx, ny) (any length). */
export function reflect(dx, dy, nx, ny) {
  const n = normalize(nx, ny);
  const d = 2 * (dx * n.x + dy * n.y);
  return { x: dx - d * n.x, y: dy - d * n.y };
}

/**
 * Ray (ox, oy) + t (dx, dy) against the segment A-B. Returns { t, u, x, y } with t > minT and u in [0, 1]
 * (an endpoint counts as a hit, so a beam grazing a vertex still interacts), or null. Parallel rays miss.
 */
export function raySegment(ox, oy, dx, dy, ax, ay, bx, by, minT = EPS) {
  const ex = bx - ax;
  const ey = by - ay;
  const denom = dx * ey - dy * ex;
  if (!(Math.abs(denom) > 1e-9)) return null;
  const wx = ax - ox;
  const wy = ay - oy;
  const t = (wx * ey - wy * ex) / denom;
  const u = (wx * dy - wy * dx) / denom;
  if (!(t > minT) || !(u >= -1e-7) || !(u <= 1 + 1e-7)) return null;
  return { t, u: clamp(u, 0, 1), x: ox + dx * t, y: oy + dy * t };
}

/**
 * Ray against a circle. Returns { t, x, y, inside } for the first crossing after minT: the entry point from
 * outside, or the exit point when the ray starts inside (inside: true). Null when it misses.
 */
export function rayCircle(ox, oy, dx, dy, cx, cy, r, minT = EPS) {
  const lx = cx - ox;
  const ly = cy - oy;
  const tca = lx * dx + ly * dy;
  const d2 = lx * lx + ly * ly - tca * tca;
  const r2 = r * r;
  if (!(d2 <= r2)) return null;
  const thc = Math.sqrt(Math.max(0, r2 - d2));
  const t0 = tca - thc;
  const t1 = tca + thc;
  if (t0 > minT) return { t: t0, x: ox + dx * t0, y: oy + dy * t0, inside: false };
  if (t1 > minT) return { t: t1, x: ox + dx * t1, y: oy + dy * t1, inside: true };
  return null;
}

/** Ray against an axis-aligned box [x0,x1]x[y0,y1]. Returns { t, x, y, nx, ny } for the entry face or null. */
export function rayBox(ox, oy, dx, dy, x0, y0, x1, y1, minT = EPS) {
  let tmin = -Infinity;
  let tmax = Infinity;
  let nx = 0;
  let ny = 0;
  for (let axis = 0; axis < 2; axis++) {
    const o = axis ? oy : ox;
    const d = axis ? dy : dx;
    const lo = axis ? y0 : x0;
    const hi = axis ? y1 : x1;
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = axis ? 0 : sign;
      ny = axis ? sign : 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (!(tmax > minT)) return null;
  if (tmin <= minT) return { t: tmax, x: ox + dx * tmax, y: oy + dy * tmax, nx: 0, ny: 0, inside: true };
  return { t: tmin, x: ox + dx * tmin, y: oy + dy * tmin, nx, ny, inside: false };
}

/** Distance from P to the segment A-B and the parameter u of the closest point. */
export function pointSegment(px, py, ax, ay, bx, by) {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  let u = l2 > EPS ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
  u = clamp(u, 0, 1);
  const qx = ax + ex * u;
  const qy = ay + ey * u;
  return { d: Math.hypot(px - qx, py - qy), u, x: qx, y: qy };
}

/** Segment-segment crossing point (strict interiors), or null. */
export function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const r = raySegment(ax, ay, bx - ax, by - ay, cx, cy, dx, dy, 1e-9);
  if (!r || r.t > 1 - 1e-9 || r.u < 1e-6 || r.u > 1 - 1e-6) return null;
  return { x: r.x, y: r.y };
}
