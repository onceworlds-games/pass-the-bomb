// The bots of one match, moved by the host's page (and by the tests): positions, brains, and the tags a bot holder makes.
// It never writes `g`: stepBots() returns the tag to apply (or null) and the caller applies it with engine.pass().

import { TAG_DIST } from './rules.js';
import { makeChar, resetChar, stepChar, softPush, collide } from './sim.js';
import { makeBrain, think } from './bots.js';
import { spawnAt } from './maps.js';
import { bombOf, isImmune, isOut, isStunned, rosterIndex } from './engine.js';

export function createBotWorld(rand) {
  return { rand, bots: new Map(), agents: [], pool: new Map(), tag: { k: 0, to: '' } };
}

function entry(bw, id) {
  let e = bw.bots.get(id);
  if (!e) {
    e = { ch: makeChar(0, 0), brain: makeBrain(bw.rand) };
    bw.bots.set(id, e);
  }
  return e;
}

/** A new round: every bot back to its starting spot with a fresh mind. */
export function placeBots(bw, g, map) {
  for (const r of g.roster) {
    if (!r.b) continue;
    const e = entry(bw, r.id);
    const p = spawnAt(map, g.rid, rosterIndex(g, r.id));
    resetChar(e.ch, p[0], p[1]);
    e.brain = makeBrain(bw.rand);
  }
}

/** A host that takes over: carry on from the last snapshot of the same round, else from the starting spots. */
export function adoptBots(bw, g, map, snap) {
  placeBots(bw, g, map);
  if (!snap || snap.rid !== g.rid || !Array.isArray(snap.p)) return;
  let i = 0;
  for (const r of g.roster) {
    if (!r.b) continue;
    const s = snap.p[i++];
    if (!Array.isArray(s) || !(s.length >= 4) || isOut(g, r.id)) continue;
    const e = entry(bw, r.id);
    if (![s[0], s[1], s[2], s[3]].every(Number.isFinite)) continue;
    e.ch.x = s[0];
    e.ch.y = s[1];
    e.ch.vx = s[2];
    e.ch.vy = s[3];
  }
}

function agentOf(bw, id) {
  let a = bw.pool.get(id);
  if (!a) {
    a = { id, x: 0, y: 0, vx: 0, vy: 0, dash: false, hold: false, imm: false, stun: false, tag: false, alive: true, bot: false, away: false };
    bw.pool.set(id, a);
  }
  return a;
}

function otherFor(others, id) {
  for (let i = 0; i < others.length; i++) if (others[i].id === id) return others[i];
  return null;
}

/**
 * Moves every bot still in the round one step (dt seconds, `now` match ms). `others` are the humans (id, x, y, vx, vy, dash, away):
 * bots dodge and chase them, and are pushed by them. Returns { k, to } if a bot holding a bomb touched someone it can tag.
 */
export function stepBots(bw, g, map, dt, now, others) {
  const agents = bw.agents;
  let n = 0;
  for (const r of g.roster) {
    if (isOut(g, r.id)) continue;
    const a = agentOf(bw, r.id);
    if (r.b) {
      const e = bw.bots.get(r.id);
      if (!e) continue;
      a.x = e.ch.x;
      a.y = e.ch.y;
      a.vx = e.ch.vx;
      a.vy = e.ch.vy;
      a.dash = e.ch.dashT > 0;
      a.away = false;
    } else {
      const o = otherFor(others, r.id);
      if (!o) continue;
      a.x = o.x;
      a.y = o.y;
      a.vx = o.vx || 0;
      a.vy = o.vy || 0;
      a.dash = !!o.dash;
      a.away = !!o.away;
    }
    a.bot = !!r.b;
    a.alive = true;
    a.hold = bombOf(g, r.id) !== null;
    a.imm = isImmune(g, r.id, now);
    a.stun = isStunned(g, r.id, now);
    a.tag = !a.hold && !a.imm && !a.away;
    agents[n++] = a;
  }
  for (let i = 0; i < n; i++) {
    const a = agents[i];
    if (!a.bot) continue;
    const e = bw.bots.get(a.id);
    think(e.brain, e.ch, agents, n, map, now, bw.rand, a);
    stepChar(e.ch, e.brain.mx, e.brain.my, e.brain.dash, dt, map, a.hold, a.stun);
    for (let j = 0; j < n; j++) {
      if (j !== i) softPush(e.ch, agents[j].x, agents[j].y);
    }
    collide(e.ch, map); // a crowd's pushes must not shove anyone into a wall or an obstacle
    a.x = e.ch.x;
    a.y = e.ch.y;
    a.vx = e.ch.vx;
    a.vy = e.ch.vy;
    a.dash = e.ch.dashT > 0;
  }
  // A bot holding a bomb tags the nearest player it touches.
  for (let bi = 0; bi < g.bombs.length; bi++) {
    const b = g.bombs[bi];
    if (b.a > now || b.b <= now) continue;
    let h = null;
    for (let i = 0; i < n; i++) if (agents[i].id === b.h) h = agents[i];
    if (!h || !h.bot) continue;
    let best = null;
    let bd = TAG_DIST * TAG_DIST;
    for (let i = 0; i < n; i++) {
      const a = agents[i];
      if (!a.tag || a.id === h.id) continue;
      const d = (a.x - h.x) * (a.x - h.x) + (a.y - h.y) * (a.y - h.y);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    if (best) {
      bw.tag.k = b.k;
      bw.tag.to = best.id;
      return bw.tag;
    }
  }
  return null;
}

/** The bots' positions as the host publishes them: [x, y, vx, vy, dashing] per bot in roster order, 0 for a bot that's out. */
export function snapshotBots(bw, g) {
  const p = [];
  const r1 = (v) => Math.round(v * 10) / 10;
  for (const r of g.roster) {
    if (!r.b) continue;
    const e = bw.bots.get(r.id);
    if (!e || isOut(g, r.id)) p.push(0);
    else p.push([r1(e.ch.x), r1(e.ch.y), r1(e.ch.vx), r1(e.ch.vy), e.ch.dashT > 0 ? 1 : 0]);
  }
  return p;
}

