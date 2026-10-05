// A whole match run in node with only bots: the pure physics, bot brains and referee, stepped at 60 Hz.
import { rng, buildRoster, STEP, W, H, R } from '../game/rules.js';
import { mapOf } from '../game/maps.js';
import { insideAny } from '../game/sim.js';
import { newMatch, tick, pass, TICK_END, aliveIds } from '../game/engine.js';
import { createBotWorld, placeBots, stepBots } from '../game/botworld.js';

export function runMatch({ seed, players = 8, rounds = 3, map = 'backyard', maxSeconds = 4000, check = true }) {
  const rand = rng(seed);
  const roster = buildRoster([], seed, () => '', players);
  const bw = createBotWorld(rand);
  const m = mapOf(map);
  const ctx = {
    rand,
    status: () => 'ok',
    pos: (id) => {
      const e = bw.bots.get(id);
      return e ? e.ch : null;
    },
  };
  const g = newMatch({ mid: 'm' + seed, by: 'host', roster, rounds, map }, 0, rand, ctx);
  placeBots(bw, g, m);
  let rid = g.rid;
  let phase = g.phase;
  const rounds_ = [];
  const passes = { n: 0 };
  let steps = 0;
  let ended = false;
  for (; steps < maxSeconds * 60; steps++) {
    const now = Math.round((steps * 1000) / 60);
    if (g.rid !== rid) {
      rid = g.rid;
      placeBots(bw, g, m);
    }
    if (g.phase === 'play' || g.phase === 'over') {
      const t = stepBots(bw, g, m, STEP, now, []);
      if (t && pass(g, t.k, t.to, now, ctx)) passes.n++;
    }
    const before = g.phase;
    const r = tick(g, now, ctx);
    if (before === 'play' && g.phase === 'over') rounds_.push({ ms: now - g.t0, alive: aliveIds(g).length, win: g.win, pl: g.pl.map((x) => x.slice()), rs: { ...g.rs } });
    if (check) {
      for (const [id, e] of bw.bots) {
        const c = e.ch;
        if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.vx) || !Number.isFinite(c.vy)) throw new Error(`NaN for ${id} at step ${steps}`);
        if (c.x < R - 1e-6 || c.x > W - R + 1e-6 || c.y < R - 1e-6 || c.y > H - R + 1e-6) throw new Error(`${id} left the arena at step ${steps}: ${c.x},${c.y}`);
        if (insideAny(m, c.x, c.y, R - 0.03)) throw new Error(`${id} is inside an obstacle at step ${steps}: ${c.x},${c.y}`);
      }
    }
    phase = g.phase;
    if (r === TICK_END) {
      ended = true;
      break;
    }
  }
  return { g, rounds: rounds_, ended, steps, passes: passes.n, roster };
}
