// The lobby's practice round (and the title screen's show): a few local bots and one bomb that never blows.
// It runs on one page only, with the same movement, bot brains and passing rules as a real match (engine.pass),
// so the first thing a player learns in the lobby is the real game: run, dash, tag to pass.

import { rng, hash32, BOT_NAMES, TAG_DIST, colorOfId } from './rules.js';
import { mapOf } from './maps.js';
import { newPractice, pass, bombOf } from './engine.js';
import { createBotWorld, placeBots, stepBots } from './botworld.js';

/** `withMe`: the player is in it (id 'me'), driven by the page. Otherwise only bots, running about for the title. */
export function createPractice(seed, mapId, nBots, withMe) {
  const rand = rng(hash32('practice' + seed) ^ 0x51ed270b);
  const map = mapOf(mapId);
  const roster = [];
  if (withMe) roster.push({ id: 'me', n: 'You', b: 0, c: colorOfId('me') });
  for (let i = 1; i <= nBots; i++) roster.push({ id: 'p' + i, n: BOT_NAMES[(i - 1 + (seed % 5)) % BOT_NAMES.length], b: 1, c: 0 });
  // distinct colors for the bots
  const used = new Set(roster.map((r) => r.c));
  let c = 3;
  for (const r of roster) {
    if (!r.b) continue;
    while (used.has(c % 12)) c++;
    r.c = c % 12;
    used.add(r.c);
  }
  const holder = 'p' + (1 + Math.floor(rand() * nBots));
  const g = newPractice(roster, holder);
  g.rid = 'practice' + seed;
  const bw = createBotWorld(rand);
  placeBots(bw, g, map);
  return { rand, map, g, bw, now: 0, withMe, passN: 0, lastFrom: '', lastTo: '', others: [{ id: 'me', x: 0, y: 0, vx: 0, vy: 0, dash: false, away: false }] };
}

/**
 * One fixed step. `me` is the player's character (or null). Returns nothing; read p.passN to see whether a pass happened
 * (p.lastFrom and p.lastTo say who gave and who got the bomb).
 */
export function stepPractice(p, dt, me) {
  p.now += dt * 1000;
  const o = p.others[0];
  const others = me && p.withMe ? p.others : EMPTY;
  if (others === p.others) {
    o.x = me.x;
    o.y = me.y;
    o.vx = me.vx;
    o.vy = me.vy;
    o.dash = me.dashT > 0;
  }
  const tag = stepBots(p.bw, p.g, p.map, dt, p.now, others);
  if (tag) {
    const b = p.g.bombs.find((x) => x.k === tag.k);
    const from = b ? b.h : '';
    if (pass(p.g, tag.k, tag.to, p.now, null)) note(p, from, tag.to);
  }
  // the player tagging a bot
  if (me && p.withMe) {
    const b = bombOf(p.g, 'me');
    if (b && b.a <= p.now) {
      let best = null;
      let bd = TAG_DIST * TAG_DIST;
      const agents = p.bw.agents;
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (!a.bot || !a.tag) continue;
        const d = (a.x - me.x) * (a.x - me.x) + (a.y - me.y) * (a.y - me.y);
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      if (best && pass(p.g, b.k, best.id, p.now, null)) note(p, 'me', best.id);
    }
  }
}

const EMPTY = [];

function note(p, from, to) {
  p.passN++;
  p.lastFrom = from;
  p.lastTo = to;
}
