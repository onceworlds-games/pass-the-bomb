// The referee: every rule of a match that isn't movement, as plain functions over one JSON record `g`.
// The host's page keeps `g` in room state (so a reload or a new host carries on); every page reads it to know what to draw.
// All times are match time in ms (room.matchNow()). Nothing here touches the window, so the tests run whole matches with it.
//
// g = {
//   mid, by, rid, n, rounds, map,
//   phase: 'play' | 'over' | 'between' | 'final',  until: deadline of over/between/final,  t0: when this round began,
//   roster: [{ id, n, b, c }],   scores: { id: total },   rs: { id: points this round },
//   out: [{ id, t, l }]          this round, in order (l: 1 = left the room, no explosion)
//   gone: [id]                   left the room for good (kept in the roster for their points)
//   bombs: [{ k, h, b, s, p, a, f }]   k number, h holder, b blows at, s fuse started, p holder since, a can't pass before, f from
//   drops: [ms]                  bombs waiting to drop
//   imm: { id: until }, stun: { id: until },   st: { id: { p: passes, h: ms holding } },   nk, first, pf, pl, win
// }

import { ARC_MS, STUN_MS, IMMUNE_MS, FALL_MS, FUSE_MIN, FUSE_MAX, FIRST_DROP_MS, REDROP_MS, ROUND_CAP_MS, OVER_MS, BETWEEN_MS, FINAL_MS, NEVER, bombsWanted, placePoints } from './rules.js';

export const TICK_NONE = 0;
export const TICK_DIRTY = 1; // g changed: write it
export const TICK_END = 2; // the final screen is over: end the match

// ---------------------------------------------------------------- questions about g

export function rosterIndex(g, id) {
  for (let i = 0; i < g.roster.length; i++) if (g.roster[i].id === id) return i;
  return -1;
}

export function isOut(g, id) {
  for (let i = 0; i < g.out.length; i++) if (g.out[i].id === id) return true;
  return g.gone.includes(id);
}

export function isAlive(g, id) {
  return rosterIndex(g, id) >= 0 && !isOut(g, id);
}

export function aliveIds(g) {
  const a = [];
  for (const r of g.roster) if (!isOut(g, r.id)) a.push(r.id);
  return a;
}

export function bombOf(g, id) {
  for (let i = 0; i < g.bombs.length; i++) if (g.bombs[i].h === id) return g.bombs[i];
  return null;
}

export const isImmune = (g, id, now) => (g.imm[id] ?? 0) > now;
export const isStunned = (g, id, now) => (g.stun[id] ?? 0) > now;

function stat(g, id) {
  return g.st[id] ?? (g.st[id] = { p: 0, h: 0 });
}

// ---------------------------------------------------------------- starting

/** A new match at its first round. `ctx.status(id)` is 'ok', 'away' or 'gone' for each player; `rand` gives numbers in [0, 1). */
export function newMatch({ mid, by, roster, rounds, map }, now, rand, ctx) {
  const g = { mid, by, rid: '', n: 0, rounds, map, phase: 'over', until: 0, t0: now, roster, scores: {}, rs: {}, out: [], gone: [], bombs: [], drops: [], imm: {}, stun: {}, st: {}, nk: 0, first: [], pf: [], pl: [], win: null };
  for (const r of roster) {
    g.scores[r.id] = 0;
    g.rs[r.id] = 0;
    g.st[r.id] = { p: 0, h: 0 };
  }
  startRound(g, now, rand, ctx);
  return g;
}

export function startRound(g, now, rand, ctx) {
  if (ctx) for (const r of g.roster) if (!g.gone.includes(r.id) && ctx.status(r.id) === 'gone') g.gone.push(r.id);
  g.n += 1;
  g.rid = `${g.mid}.${g.n}`;
  g.phase = 'play';
  g.until = 0;
  g.t0 = now;
  g.out = [];
  g.bombs = [];
  g.imm = {};
  g.stun = {};
  g.rs = {};
  for (const r of g.roster) g.rs[r.id] = 0;
  g.pl = [];
  g.win = null;
  g.pf = g.first;
  g.first = [];
  g.drops = [];
  const wanted = bombsWanted(aliveIds(g).length);
  for (let i = 0; i < wanted; i++) g.drops.push(now + FIRST_DROP_MS);
  return g;
}

/** A practice round for the lobby: one bomb that never blows, held by `holder`. */
export function newPractice(roster, holder) {
  const g = { mid: 'practice', by: '', rid: 'practice', n: 1, rounds: 1, map: 'backyard', phase: 'play', until: 0, t0: 0, roster, scores: {}, rs: {}, out: [], gone: [], bombs: [{ k: 0, h: holder, b: NEVER, s: 0, p: 0, a: 0, f: null }], drops: [], imm: {}, stun: {}, st: {}, nk: 1, first: [], pf: [], pl: [], win: null };
  for (const r of roster) {
    g.scores[r.id] = 0;
    g.rs[r.id] = 0;
    g.st[r.id] = { p: 0, h: 0 };
  }
  return g;
}

// ---------------------------------------------------------------- passing

function moveBomb(g, b, to, now, kind) {
  const from = b.h;
  stat(g, from).h += Math.max(0, now - b.p);
  b.f = from;
  b.h = to;
  b.p = now;
  b.a = now + ARC_MS;
  g.stun[to] = now + ARC_MS + STUN_MS;
  if (kind === 'pass') {
    g.imm[from] = now + IMMUNE_MS;
    stat(g, from).p += 1;
  }
}

/**
 * The holder of bomb `k` touched `to`. Applies it (and says true) only if the bomb is in the holder's hands (not in the air, not
 * yet blown), the target is in the round, isn't holding a bomb, isn't immune, and (if `ctx` is given) is here and not away.
 */
export function pass(g, k, to, now, ctx) {
  if (g.phase !== 'play' || typeof to !== 'string') return false;
  let b = null;
  for (let i = 0; i < g.bombs.length; i++) {
    if (g.bombs[i].k === k) {
      b = g.bombs[i];
      break;
    }
  }
  if (!b || b.a > now || b.b <= now) return false;
  if (to === b.h || !isAlive(g, to) || bombOf(g, to) || isImmune(g, to, now)) return false;
  if (ctx && ctx.status(to) !== 'ok') return false;
  moveBomb(g, b, to, now, 'pass');
  return true;
}

/** The nearest player who could take a bomb off `from` (not holding one, not out, here), or null. */
function nearestTarget(g, from, ctx, exclude) {
  const p = ctx && ctx.pos ? ctx.pos(from) : null;
  let best = null;
  let bd = Infinity;
  for (const r of g.roster) {
    const id = r.id;
    if (id === exclude || isOut(g, id) || bombOf(g, id)) continue;
    if (ctx && ctx.status(id) !== 'ok') continue;
    const q = ctx && ctx.pos ? ctx.pos(id) : null;
    const d = p && q ? (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y) : 0;
    if (best === null || d < bd) {
      best = id;
      bd = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------- the round

function pickHolder(g, rand, ctx, avoid) {
  const pool = [];
  for (const r of g.roster) {
    const id = r.id;
    if (isOut(g, id) || bombOf(g, id)) continue;
    if (ctx && ctx.status(id) !== 'ok') continue;
    pool.push(id);
  }
  let choice = pool.filter((id) => !avoid.includes(id));
  if (!choice.length) choice = pool;
  return choice.length ? choice[Math.floor(rand() * choice.length) % choice.length] : null;
}

/** Schedules a drop for every bomb the table is short of. */
function topUp(g, at) {
  const need = bombsWanted(aliveIds(g).length) - g.bombs.length - g.drops.length;
  for (let i = 0; i < need; i++) g.drops.push(at + REDROP_MS);
  return need > 0;
}

function blowBatch(g, batch, at) {
  for (const b of batch) {
    stat(g, b.h).h += Math.max(0, at - b.p);
    g.out.push({ id: b.h, t: at, l: 0 });
    const i = g.bombs.indexOf(b);
    if (i >= 0) g.bombs.splice(i, 1);
  }
  for (const id of aliveIds(g)) g.rs[id] = (g.rs[id] ?? 0) + 1; // everyone still in gets a survival point
  topUp(g, at);
}

function removePlayer(g, id, now, ctx) {
  const b = bombOf(g, id);
  if (b) {
    const to = nearestTarget(g, id, ctx, id);
    if (to !== null) moveBomb(g, b, to, now, 'jump');
    else g.bombs.splice(g.bombs.indexOf(b), 1);
  }
  g.gone.push(id);
  g.out.push({ id, t: now, l: 1 });
}

/** Round over: place points by elimination order (ties share the better place), then the scoreboard. */
function endRound(g, now) {
  const groups = [];
  const alive = aliveIds(g);
  if (alive.length) groups.push(alive);
  for (let i = g.out.length - 1; i >= 0; ) {
    const t = g.out[i].t;
    const grp = [];
    while (i >= 0 && g.out[i].t === t) grp.push(g.out[i--].id);
    groups.push(grp);
  }
  let place = 0;
  for (const grp of groups) {
    const pts = placePoints(place);
    for (const id of grp) g.rs[id] = (g.rs[id] ?? 0) + pts;
    place += grp.length;
  }
  for (const r of g.roster) g.scores[r.id] = (g.scores[r.id] ?? 0) + (g.rs[r.id] ?? 0);
  g.bombs = [];
  g.drops = [];
  g.pl = groups;
  g.win = groups.length && groups[0].length === 1 ? groups[0][0] : null;
  g.phase = 'over';
  g.until = now + OVER_MS;
}

function playTick(g, now, ctx) {
  let dirty = false;
  for (const r of g.roster) {
    if (isOut(g, r.id)) continue;
    if (ctx.status(r.id) === 'gone') {
      removePlayer(g, r.id, now, ctx);
      dirty = true;
    }
  }
  for (const b of g.bombs) {
    if (b.a <= now && ctx.status(b.h) === 'away') {
      const to = nearestTarget(g, b.h, ctx, b.h);
      if (to !== null) {
        moveBomb(g, b, to, now, 'jump');
        dirty = true;
      }
    }
  }
  if (g.bombs.length) {
    const due = g.bombs.filter((b) => b.b <= now).sort((a, b) => a.b - b.b);
    let i = 0;
    while (i < due.length) {
      const at = due[i].b;
      const batch = [];
      while (i < due.length && due[i].b === at) batch.push(due[i++]);
      blowBatch(g, batch, at);
      dirty = true;
      if (aliveIds(g).length <= 1) {
        endRound(g, now);
        return true;
      }
    }
  }
  if (aliveIds(g).length <= 1) {
    endRound(g, now);
    return true;
  }
  if (now - g.t0 >= ROUND_CAP_MS) {
    // Out of time: every bomb blows at once and whoever is left shares the win.
    if (g.bombs.length) blowBatch(g, g.bombs.slice(), g.t0 + ROUND_CAP_MS);
    endRound(g, now);
    return true;
  }
  if (g.drops.length) {
    g.drops.sort((a, b) => a - b);
    while (g.drops.length && g.drops[0] <= now) {
      const at = g.drops.shift();
      const first = at === g.t0 + FIRST_DROP_MS;
      const to = pickHolder(g, ctx.rand, ctx, first ? g.pf : []);
      if (to !== null) {
        const fuse = Math.round(FUSE_MIN + ctx.rand() * (FUSE_MAX - FUSE_MIN));
        g.bombs.push({ k: g.nk++, h: to, b: now + fuse, s: now, p: now, a: now + FALL_MS, f: null });
        if (first) g.first.push(to);
      } else {
        g.drops.push(now + 500); // nobody can take it right now (all away or holding): try again shortly
      }
      dirty = true;
    }
  }
  if (topUp(g, now)) dirty = true;
  return dirty;
}

/** Advances the match to `now`. Returns TICK_DIRTY when `g` changed (write it) and TICK_END when the match should end. */
export function tick(g, now, ctx) {
  if (g.phase === 'play') return playTick(g, now, ctx) ? TICK_DIRTY : TICK_NONE;
  if (now < g.until) return TICK_NONE;
  if (g.phase === 'over') {
    if (g.n >= g.rounds) {
      g.phase = 'final';
      g.until = now + FINAL_MS;
    } else {
      g.phase = 'between';
      g.until = now + BETWEEN_MS;
    }
    return TICK_DIRTY;
  }
  if (g.phase === 'between') {
    startRound(g, now, ctx.rand, ctx);
    return TICK_DIRTY;
  }
  return TICK_END;
}

// ---------------------------------------------------------------- results

/** Everyone in the roster, best first: points, then this round's points, then less time holding a bomb, then seat. */
export function finalRanking(g) {
  const rows = g.roster.map((r, i) => ({ id: r.id, i, s: g.scores[r.id] ?? 0, last: g.rs[r.id] ?? 0, h: g.st[r.id] ? g.st[r.id].h : 0 }));
  rows.sort((a, b) => b.s - a.s || b.last - a.last || a.h - b.h || a.i - b.i);
  return rows.map((r) => r.id);
}

/** The fun awards: most passes ("Hot Potato") and least time holding a bomb ("Slippery"). Players who left don't win them. */
export function awards(g) {
  let potato = null;
  let slippery = null;
  for (const r of g.roster) {
    if (g.gone.includes(r.id)) continue;
    const s = g.st[r.id] ?? { p: 0, h: 0 };
    if (s.p > 0 && (!potato || s.p > potato.n)) potato = { id: r.id, n: s.p };
    if (!slippery || s.h < slippery.ms) slippery = { id: r.id, ms: s.h };
  }
  return { potato, slippery };
}
