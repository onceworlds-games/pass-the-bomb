// One night on the table: the authoritative simulation. Pure data in, pure data out, no DOM, no clock of its own.
// The host's page (or the harness) owns one of these, feeds it commands and advances it in fixed ticks.

import { CELL, OPEN, cellKind, cellCentre } from './boards.js';
import { PIECES, isPieceType, oriented, baseMods, HEAT_CAP } from './pieces.js';
import { traceBeams } from './trace.js';
import { makeLightMap, burnShades } from './light.js';
import { SHADES, HUES, MAX_SHADES, K_DAMAGE, W0, makeShade, stepShades, makeBuckets, burrowSpot, clampToWorld, effectiveHue } from './shades.js';
import { planNight, expandWave } from './waves.js';
import { makeRng, hashString } from './rng.js';
import { clamp, finite, normDeg, snapDeg, deltaDeg, lerp } from './geom.js';

export const TICK = 1 / 30;
export const DUSK_CAP = 180; // seconds a dusk may last before the night begins on its own
export const BREAK_LEN = 10;
export const HEAT_RATE = 0.5;
export const COOL_RATE = 0.06;
export const COSTS = { place: 10, move: 5, rotateStep: 1, sell: 0 };
export const DAWN_MAX = 40;
export const PHASES = ['dusk', 'wave', 'break', 'done', 'lost'];

const num = (v, lo, hi, fb = lo) => clamp(finite(v, fb), lo, hi);

/**
 * @param {object} cfg { seed, night, board, mods, deck, players: [{id, role}], heart: {hp, max}, tutorial, ascension, lampPower, moon }
 */
export function createNight(cfg) {
  const board = cfg.board;
  const mods = { ...baseMods(), ...(cfg.mods || {}) };
  const night = num(cfg.night, 1, 999, 1);
  const seed = finite(cfg.seed, hashString(String(cfg.seed ?? 'glint')));
  const rng = makeRng((hashString(`night:${seed}:${night}`) ^ 0x51ed) >>> 0);
  const plan = planNight({ seed, night, board, ascension: cfg.ascension || 0, tutorial: !!cfg.tutorial });
  const flags = cfg.flags || {};
  if (flags.hpNext) plan.hpMult *= 1.15;
  if (flags.moths || flags.gloomNext) {
    const extra = makeRng(hashString(`extra:${seed}:${night}`));
    for (const w of plan.waves) {
      if (flags.moths) w.entries.push({ t: extra.range(4, w.dur * 0.6), type: 'moth', hue: 'r', arc: extra.pick(w.arcs), n: extra.int(1, 2), gap: 2 });
      if (flags.gloomNext) w.entries.push({ t: extra.range(6, w.dur * 0.6), type: 'gloom', hue: extra.pick(w.hues), arc: extra.pick(w.arcs), n: 1, gap: 1 });
      w.entries.sort((a, b) => a.t - b.t);
    }
  }
  const duskCap = clamp(finite(mods.duskCap, DUSK_CAP), 20, 600);
  const light = makeLightMap(board);
  const deck = {};
  for (const [type, n] of Object.entries(cfg.deck || {})) if (isPieceType(type)) deck[type] = num(n, 0, 99, 0);
  const lampBase = num(cfg.lampPower, 10, 1000, 100);
  const lamps = board.lamps.map((L, i) => ({ i, x: L.x, y: L.y, angle: L.angle, target: L.angle, radius: L.radius, base: lampBase * (i > 0 && cfg.secondLampShare ? cfg.secondLampShare : 1), smother: 0, power: 0 }));
  if (mods.extraLamp > 0 && lamps.length === 1 && board.lamps.length === 1) {
    // Widow's Lamp: a second Lamp across the table from the first.
    const L = board.lamps[0];
    lamps.push({ i: 1, x: board.w - L.x, y: board.h - L.y, angle: normDeg(L.angle + 180), target: normDeg(L.angle + 180), radius: L.radius, base: lampBase * mods.extraLamp, smother: 0, power: 0 });
  }
  const players = {};
  for (const p of cfg.players || []) players[String(p.id)] = { id: String(p.id), role: p.role || '', focus: mods.focusMax, flareAt: 0, surgeAt: 0, freeUsed: false };

  const S = {
    seed,
    night,
    boardId: board.id,
    plan,
    t: 0,
    phase: 'dusk',
    wave: -1,
    waveT: 0,
    breakUntil: 0,
    pieces: [],
    nextPieceId: 1,
    lamps,
    shades: [],
    nextShadeId: 1,
    pending: [], // spawns still to come this wave
    spawned: 0,
    heart: { hp: num(cfg.heart?.hp, 1, 9999, mods.heartHp), max: num(cfg.heart?.max, 1, 9999, mods.heartHp), shield: 0 },
    dawn: { charge: 0, max: DAWN_MAX, until: 0 },
    players,
    deck,
    lost: [], // piece types shattered this night (gone unless repaired at dawn)
    digested: [], // piece types eaten by the Lens-Eater (back at dawn)
    stats: { kills: 0, byType: {}, score: 0, heartHits: 0, cracks: 0, shatters: 0, spectral: 0, focusKills: 0, bounces: 0, rainbow: { r: 0, g: 0, b: 0 }, wavesCleared: 0, flares: 0, dawns: 0, eaten: 0 },
    events: [],
    trace: null,
    bands: [],
    shadows: [],
    flares: [],
    moon: num(cfg.moon, 0.3, 1.5, 1),
    lampFlicker: 0,
    mods,
  };

  const ev = (k, data) => {
    if (S.events.length < 400) S.events.push(Object.assign({ k, t: S.t }, data));
  };
  const pieceById = (id) => S.pieces.find((p) => p.id === id);
  const pieceAt = (c, r) => S.pieces.find((p) => p.c === c && p.r === r);
  const owned = (type) => deck[type] || 0;
  const placedOf = (type) => S.pieces.reduce((n, p) => n + (p.type === type ? 1 : 0), 0);
  const lostOf = (type) => S.lost.reduce((n, t) => n + (t === type ? 1 : 0), 0) + S.digested.reduce((n, t) => n + (t === type ? 1 : 0), 0);
  const available = (type) => Math.max(0, owned(type) - placedOf(type) - lostOf(type));
  const player = (pid) => players[String(pid)];
  const free = () => S.phase === 'dusk';

  function spend(pl, cost, what) {
    if (free() || cost <= 0) return true;
    if (mods.freeFirstPlacement && what === 'place' && !pl.freeUsed) {
      pl.freeUsed = true;
      return true;
    }
    cost *= mods.focusCost;
    if (pl.focus + 1e-6 < cost) {
      ev('refuse', { pid: pl.id, reason: 'focus', need: cost });
      return false;
    }
    pl.focus -= cost;
    return true;
  }

  function refuse(pid, reason, extra) {
    ev('refuse', Object.assign({ pid: String(pid), reason }, extra));
    return { ok: false, reason };
  }

  // ---- commands -------------------------------------------------------------------------------------------
  const commands = {
    place(pid, cmd) {
      const pl = player(pid);
      if (!pl) return refuse(pid, 'player');
      const type = cmd.type;
      if (!isPieceType(type)) return refuse(pid, 'type');
      const c = num(cmd.c, -1, 99, -1);
      const r = num(cmd.r, -1, 99, -1);
      if (!Number.isInteger(c) || !Number.isInteger(r) || cellKind(board, c, r) !== OPEN) return refuse(pid, 'cell', { c, r });
      if (pieceAt(c, r)) return refuse(pid, 'occupied', { c, r });
      if (available(type) <= 0) return refuse(pid, 'none', { type });
      if (S.pieces.length >= 120) return refuse(pid, 'full');
      if (!spend(pl, COSTS.place, 'place')) return { ok: false, reason: 'focus' };
      const piece = { id: S.nextPieceId++, type, c, r, angle: oriented(type) ? snapDeg(cmd.angle, 5) : normDeg(cmd.angle), heat: 0, cracked: 0, hot: 0, owner: String(pid), t0: S.t, store: 0, sr: 0, sg: 0, sb: 0, pulseUntil: 0, pr: 0, pg: 0, pb: 0 };
      S.pieces.push(piece);
      ev('placed', { pid: String(pid), id: piece.id, type, c, r });
      return { ok: true, id: piece.id };
    },
    move(pid, cmd) {
      const pl = player(pid);
      if (!pl) return refuse(pid, 'player');
      const p = pieceById(finite(cmd.id, -1));
      if (!p) return refuse(pid, 'piece');
      const c = num(cmd.c, -1, 99, -1);
      const r = num(cmd.r, -1, 99, -1);
      if (!Number.isInteger(c) || !Number.isInteger(r) || cellKind(board, c, r) !== OPEN) return refuse(pid, 'cell', { c, r });
      if (p.c === c && p.r === r) return { ok: true, id: p.id };
      if (pieceAt(c, r)) return refuse(pid, 'occupied', { c, r });
      if (!spend(pl, COSTS.move, 'move')) return { ok: false, reason: 'focus' };
      p.c = c;
      p.r = r;
      p.t0 = S.t;
      ev('moved', { pid: String(pid), id: p.id, c, r });
      return { ok: true, id: p.id };
    },
    rotate(pid, cmd) {
      const pl = player(pid);
      if (!pl) return refuse(pid, 'player');
      const p = pieceById(finite(cmd.id, -1));
      if (!p) return refuse(pid, 'piece');
      if (!oriented(p.type) && p.type !== 'combiner' && p.type !== 'crystal' && p.type !== 'shutter') return refuse(pid, 'fixed');
      const target = snapDeg(cmd.angle, 5);
      const d = Math.abs(deltaDeg(p.angle, target));
      if (d < 0.01) return { ok: true, id: p.id };
      if (!spend(pl, (d / 15) * COSTS.rotateStep, 'rotate')) return { ok: false, reason: 'focus' };
      p.angle = target;
      ev('rotated', { pid: String(pid), id: p.id, angle: target });
      return { ok: true, id: p.id };
    },
    sell(pid, cmd) {
      const pl = player(pid);
      if (!pl) return refuse(pid, 'player');
      const i = S.pieces.findIndex((p) => p.id === finite(cmd.id, -1));
      if (i < 0) return refuse(pid, 'piece');
      const p = S.pieces[i];
      S.pieces.splice(i, 1);
      if (!free() && mods.sellRefund > 0) pl.focus = Math.min(mods.focusMax, pl.focus + COSTS.place * mods.sellRefund);
      for (const s of S.shades) if (s.state === 'chew' && s.target === p.id) s.state = 'walk';
      ev('sold', { pid: String(pid), id: p.id, type: p.type, c: p.c, r: p.r });
      return { ok: true };
    },
    lamp(pid, cmd) {
      const pl = player(pid);
      if (!pl) return refuse(pid, 'player');
      const L = S.lamps[num(cmd.i, 0, 7, 0)];
      if (!L) return refuse(pid, 'lamp');
      L.target = normDeg(cmd.angle);
      return { ok: true };
    },
    flare(pid, cmd) {
      const pl = player(pid);
      if (!pl) return refuse(pid, 'player');
      if (S.phase === 'dusk') return refuse(pid, 'dusk');
      if (S.t < pl.flareAt) return refuse(pid, 'cooldown', { left: pl.flareAt - S.t });
      const x = num(cmd.x, -CELL * 2, board.w + CELL * 2, board.cx);
      const y = num(cmd.y, -CELL * 2, board.h + CELL * 2, board.cy);
      pl.flareAt = S.t + mods.flareCd;
      const R = mods.flareRadius * CELL;
      for (const s of S.shades) {
        if (s.state === 'dead' || s.state === 'hit') continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d > R + s.r) continue;
        damageShade(s, 40 * mods.damage, { hue: 'w', focused: false, lamp: -1 }, 'flare');
        if (s.state !== 'dead') {
          s.scared = 2;
          const push = 260 * (1 - d / (R + s.r));
          s.vx += ((s.x - x) / (d || 1)) * push;
          s.vy += ((s.y - y) / (d || 1)) * push;
          if (s.state === 'chew') s.state = 'walk';
        }
      }
      if (pl.role === 'warden') S.heart.shield = Math.max(S.heart.shield, 8);
      S.flares.push({ x, y, r: R, t: S.t });
      S.stats.flares++;
      ev('flare', { pid: String(pid), x, y, r: R, warden: pl.role === 'warden' });
      return { ok: true };
    },
    dawn(pid) {
      const pl = player(pid);
      if (!pl) return refuse(pid, 'player');
      if (S.dawn.charge < S.dawn.max - 1e-6) return refuse(pid, 'charge');
      if (S.dawn.until > S.t) return refuse(pid, 'active');
      S.dawn.charge = 0;
      S.dawn.until = S.t + 6;
      S.stats.dawns++;
      ev('dawn', { pid: String(pid) });
      return { ok: true };
    },
    surge(pid) {
      const pl = player(pid);
      if (!pl) return refuse(pid, 'player');
      if (S.t < pl.surgeAt) return refuse(pid, 'cooldown', { left: pl.surgeAt - S.t });
      pl.surgeAt = S.t + mods.surgeCd;
      pl.focus = mods.focusMax;
      ev('surge', { pid: String(pid) });
      return { ok: true };
    },
    wave(pid) {
      if (S.phase === 'dusk' || S.phase === 'break') {
        startWave(S.wave + 1, String(pid));
        return { ok: true };
      }
      return refuse(pid, 'phase');
    },
  };

  function command(pid, cmd) {
    if (!cmd || typeof cmd !== 'object' || typeof cmd.op !== 'string' || !Object.hasOwn(commands, cmd.op)) return { ok: false, reason: 'op' };
    if (S.phase === 'done' || S.phase === 'lost') return { ok: false, reason: 'over' };
    try {
      return commands[cmd.op](pid, cmd);
    } catch (e) {
      return { ok: false, reason: 'error' };
    }
  }

  // ---- waves ----------------------------------------------------------------------------------------------
  function startWave(i, by) {
    if (i >= plan.waves.length) return finishNight();
    S.wave = i;
    S.waveT = 0;
    S.phase = 'wave';
    S.pending = expandWave(plan.waves[i]);
    S.spawned = 0;
    for (const pl of Object.values(players)) pl.freeUsed = false;
    ev('wave', { wave: i, of: plan.waves.length, by, hues: plan.waves[i].hues, arcs: plan.waves[i].arcs });
  }

  function finishNight() {
    S.phase = 'done';
    S.stats.score += Math.round(S.heart.hp * 2);
    ev('done', { night, score: S.stats.score });
  }

  function spawnOne(e) {
    if (S.shades.length - deadCount() >= MAX_SHADES) return false;
    const def = SHADES[e.type] || SHADES.wisp;
    let x;
    let y;
    const arc = board.arcs[num(e.arc, 0, board.arcs.length - 1, 0)];
    if (def.inside) {
      const spot = burrowSpot(board, rng);
      x = spot.x;
      y = spot.y;
    } else if (def.sits) {
      x = arc.x - arc.ux * CELL * 2.4;
      y = arc.y - arc.uy * CELL * 2.4;
    } else {
      const u = rng.next();
      x = lerp(arc.x0, arc.x1, u) + rng.range(-8, 8);
      y = lerp(arc.y0, arc.y1, u) + rng.range(-8, 8);
    }
    const s = makeShade(S.nextShadeId++, e.type, e.hue, x, y, S.t, plan.hpMult * (e.hpMult || 1));
    s.hx = -arc.ux;
    s.hy = -arc.uy;
    s.arc = e.arc;
    if (mods.shadeSpeed) s.speedMult = clamp(finite(mods.shadeSpeed, 1), 0.5, 2);
    if (mods.rimBurn > 0 && !def.inside) s.rimBurn = mods.rimBurn;
    if (def.sits) s.phaseAt = S.t;
    S.shades.push(s);
    S.spawned++;
    ev('spawn', { id: s.id, type: s.type, hue: s.hue, x, y });
    return true;
  }

  const deadCount = () => S.shades.reduce((n, s) => n + (s.state === 'dead' || s.state === 'hit' ? 1 : 0), 0);
  const aliveCount = () => S.shades.length - deadCount();

  // ---- damage and deaths ----------------------------------------------------------------------------------
  function damageShade(s, amount, by, how) {
    if (s.state === 'dead' || s.state === 'hit') return;
    if (s.firstHit < 0) s.firstHit = S.t;
    s.hp -= amount;
    s.burn = Math.min(1, s.burn + amount / Math.max(8, s.maxHp * 0.25));
    if (s.hp <= 0) {
      s.hp = 0;
      s.state = 'dead';
      onKill({ shade: s, by, fast: S.t - s.firstHit <= 1, match: by && by.hue === effectiveHue(s), how });
    }
  }

  function onKill(kill) {
    const s = kill.shade;
    const def = SHADES[s.type] || SHADES.wisp;
    let mult = 1;
    if (kill.match && effectiveClassOf(s) !== 'plain') {
      mult *= 1.5;
      S.stats.spectral++;
    }
    if (kill.by && kill.by.focused) {
      mult *= 1.5;
      if (kill.fast) S.stats.focusKills++;
    }
    if (kill.by && (kill.by.hue === 'r' || kill.by.hue === 'g' || kill.by.hue === 'b')) S.stats.rainbow[kill.by.hue]++;
    if (kill.by && kill.by.depth >= 10) S.stats.bounces++;
    const score = Math.round(def.score * mult * (1 + 0.1 * (night - 1)) * mods.scoreMult);
    S.stats.kills++;
    S.stats.byType[s.type] = (S.stats.byType[s.type] || 0) + 1;
    S.stats.score += score;
    ev('kill', { id: s.id, type: s.type, hue: s.hue, x: s.x, y: s.y, score, focused: !!(kill.by && kill.by.focused), match: !!kill.match, depth: kill.by ? kill.by.depth : 0, fast: !!kill.fast });
    if (def.splits && aliveCount() < MAX_SHADES - 2) {
      for (let k = 0; k < 2; k++) {
        const h = makeShade(S.nextShadeId++, def.splits, s.hue, s.x + (k ? 14 : -14), s.y + (k ? -10 : 10), S.t, plan.hpMult);
        h.hx = s.hx;
        h.hy = s.hy;
        S.shades.push(h);
        ev('spawn', { id: h.id, type: h.type, hue: h.hue, x: h.x, y: h.y, split: true });
      }
    }
  }

  const effectiveClassOf = (s) => (s.type === 'umbra' || s.type === 'longdusk' ? 'locked' : (SHADES[s.type] || SHADES.wisp).cls);

  // ---- the tick ---------------------------------------------------------------------------------------------
  function lampPowers() {
    const breath = lerp(mods.breathLow, mods.breathHigh, 0.5 + 0.5 * Math.sin((2 * Math.PI * S.t) / 24));
    const dawn = 1;
    for (const L of S.lamps) {
      L.smother = Math.max(0, L.smother - TICK);
      L.power = L.base * mods.lampPower * breath * S.moon * dawn * (L.smother > 0 ? 0.8 : 1) * (S.lampFlicker > 0 ? 0.3 : 1);
      // The Lamp swings toward where it was dragged at 90 degrees a second.
      const d = deltaDeg(L.angle, L.target);
      const step = 90 * TICK;
      L.angle = Math.abs(d) <= step ? L.target : normDeg(L.angle + Math.sign(d) * step);
    }
  }

  function zones() {
    const glooms = [];
    const mimics = [];
    for (const s of S.shades) {
      if (s.state === 'dead' || s.state === 'hit') continue;
      if (s.type === 'gloom') glooms.push({ id: s.id, x: s.x, y: s.y, r: SHADES.gloom.aura, factor: 0.4 });
      else if (s.type === 'mimic') mimics.push({ id: s.id, x: s.x, y: s.y, r: s.r, hx: s.hx, hy: s.hy });
    }
    return { glooms: glooms.slice(0, 30), mimics, shadows: S.shadows, bands: S.bands };
  }

  function heatTick(load) {
    const sink = new Map();
    for (const p of S.pieces) {
      if (p.type !== 'heatsink' || p.cracked) continue;
      for (const q of S.pieces) if (q !== p && Math.abs(q.c - p.c) <= 1 && Math.abs(q.r - p.r) <= 1) sink.set(q.id, PIECES.heatsink.cool);
    }
    for (let i = S.pieces.length - 1; i >= 0; i--) {
      const p = S.pieces[i];
      const l = load.get(p.id);
      const absorbed = (l ? l.heat : 0) * HEAT_RATE * mods.heatRate;
      const cool = (p.heat * COOL_RATE + 1) * mods.cooling * (sink.get(p.id) || 1);
      p.heat = clamp(p.heat + (absorbed - cool) * TICK, 0, HEAT_CAP * 1.2);
      if (!p.cracked && p.heat >= HEAT_CAP) {
        p.cracked = S.t || 1e-6;
        p.hot = 0;
        S.stats.cracks++;
        ev('crack', { id: p.id, type: p.type, c: p.c, r: p.r });
        for (const s of S.shades) if (s.state === 'chew' && s.target === p.id) s.state = 'walk';
      } else if (p.cracked) {
        if (p.heat >= HEAT_CAP * 0.8) p.hot += TICK;
        if (p.hot >= 10) {
          S.pieces.splice(i, 1);
          S.lost.push(p.type);
          S.stats.shatters++;
          ev('shatter', { id: p.id, type: p.type, c: p.c, r: p.r });
          continue;
        }
        if (S.t - p.cracked >= 6 && p.heat < HEAT_CAP * 0.6) {
          p.cracked = 0;
          p.hot = 0;
          ev('repair', { id: p.id, type: p.type });
        }
      }
      if (p.type === 'crystal') crystalTick(p);
    }
  }

  function crystalTick(p) {
    const inp = S.trace && S.trace.crystalIn.get(p.id);
    if (inp && !p.cracked) {
      p.sr += inp.r * TICK;
      p.sg += inp.g * TICK;
      p.sb += inp.b * TICK;
      p.store = p.sr + p.sg + p.sb;
    }
    if (p.pulseUntil > S.t) return;
    if (p.store >= PIECES.crystal.capacity && !p.cracked) {
      const k = (1.2 * mods.crystalBoost) / PIECES.crystal.pulse;
      p.pr = p.sr * k;
      p.pg = p.sg * k;
      p.pb = p.sb * k;
      p.sr = p.sg = p.sb = p.store = 0;
      p.pulseUntil = S.t + PIECES.crystal.pulse;
      ev('pulse', { id: p.id, c: p.c, r: p.r, power: p.pr + p.pg + p.pb });
    }
  }

  function bossTick() {
    for (const s of S.shades) {
      if (s.state === 'dead' || s.state === 'hit') continue;
      if (s.type === 'umbra') {
        s.phase = clamp(Math.floor(3 * (1 - s.hp / s.maxHp)), 0, 2);
        if (S.t >= (s.castAt || 0)) {
          s.castAt = S.t + 12;
          const cast = [];
          for (let k = 0; k < 3; k++) {
            const spot = burrowSpot(board, rng, 2);
            cast.push({ x: spot.x, y: spot.y, r: 80, until: S.t + 8, by: s.id });
          }
          S.shadows.push(...cast);
          ev('shadow', { id: s.id, zones: cast.map((z) => ({ x: z.x, y: z.y, r: z.r })) });
        }
      } else if (s.type === 'lenseater') {
        const cyc = ((S.t - s.born) % 5 + 5) % 5;
        s.eye = cyc < 3 ? 1 : 0;
        if (s.state === 'chew' && s.chew >= SHADES.lenseater.chew * mods.eaterSlow) {
          const i = S.pieces.findIndex((p) => p.id === s.target);
          if (i >= 0) {
            const p = S.pieces[i];
            S.pieces.splice(i, 1);
            S.digested.push(p.type);
            S.stats.eaten++;
            ev('eaten', { id: p.id, type: p.type, c: p.c, r: p.r, by: s.type, boss: true });
          }
          s.state = 'walk';
          s.target = 0;
          s.chew = 0;
        }
      } else if (s.type === 'longdusk') {
        s.phase = Math.floor(((S.t - s.born) / 10) % 3);
        if (S.t >= (s.bandAt || 0)) {
          s.bandAt = S.t + 15;
          S.bands.push({ x0: -200, x1: -40, speed: 220, factor: 0.3, until: S.t + (board.w + 400) / 220 });
          ev('band', { id: s.id });
        }
        if (S.t >= (s.flickerAt || 0)) {
          s.flickerAt = S.t + 6;
          S.lampFlicker = 1;
          ev('flicker', { id: s.id });
        }
        if (S.t >= (s.escortAt || 0) && aliveCount() < 40) {
          s.escortAt = S.t + 8;
          const picks = plan.waves[S.wave]?.entries.filter((e) => !SHADES[e.type].boss) || [];
          const e = picks.length ? rng.pick(picks) : { type: 'wisp', hue: 'r', arc: s.arc };
          for (let k = 0; k < 3; k++) spawnOne({ type: e.type, hue: HUES[s.phase], arc: rng.int(0, board.arcs.length - 1) });
        }
      }
    }
    for (let i = S.shadows.length - 1; i >= 0; i--) if (S.shadows[i].until <= S.t) S.shadows.splice(i, 1);
    for (let i = S.bands.length - 1; i >= 0; i--) {
      const b = S.bands[i];
      b.x0 += b.speed * TICK;
      b.x1 += b.speed * TICK;
      if (b.until <= S.t || b.x0 > board.w + 50) S.bands.splice(i, 1);
    }
    if (S.lampFlicker > 0) S.lampFlicker -= TICK;
    for (let i = S.flares.length - 1; i >= 0; i--) if (S.t - S.flares[i].t > 1.2) S.flares.splice(i, 1);
  }

  function eaterTick() {
    for (const s of S.shades) {
      if (s.state !== 'chew' || s.type === 'lenseater') continue;
      const def = SHADES[s.type];
      const p = pieceById(s.target);
      if (!p) {
        s.state = 'walk';
        s.target = 0;
        continue;
      }
      if (s.chew >= (def.chew || 5) * mods.eaterSlow) {
        const i = S.pieces.indexOf(p);
        if (i >= 0) S.pieces.splice(i, 1);
        S.stats.eaten++;
        ev('eaten', { id: p.id, type: p.type, c: p.c, r: p.r, by: s.type, boss: false });
        s.state = 'walk';
        s.target = 0;
        s.chew = 0;
      }
    }
  }

  function mothTick() {
    for (const s of S.shades) {
      if (s.type !== 'moth' || s.state === 'dead' || s.state === 'hit') continue;
      for (const L of S.lamps) {
        if (Math.hypot(L.x - s.x, L.y - s.y) <= L.radius + s.r) {
          L.smother = 10;
          s.state = 'dead';
          s.hp = 0;
          ev('moth', { id: s.id, lamp: L.i, x: L.x, y: L.y });
        }
      }
    }
  }

  const pieceNear = (x, y, within) => {
    let best = null;
    let bd = within;
    for (const p of S.pieces) {
      const { x: px, y: py } = cellCentre(p.c, p.r);
      const d = Math.hypot(px - x, py - y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };

  function lensEaterHitMul(s, seg, q, w) {
    if (s.type !== 'lenseater') return 1;
    if (!s.eye) return 0.1;
    const ex = s.x + s.hx * (s.r - 10);
    const ey = s.y + s.hy * (s.r - 10);
    return Math.hypot(q.x - ex, q.y - ey) <= 16 + w * 0.5 ? 1 : 0.1;
  }

  function tick() {
    S.t += TICK;
    lampPowers();
    bossTick();
    S.trace = traceBeams({ board, pieces: S.pieces, lamps: S.lamps, t: S.t, mods, zones: zones() });
    light.build(S.trace.segments);
    heatTick(S.trace.load);
    for (const h of S.trace.mimicHits) {
      const s = S.shades.find((m) => m.id === h.id);
      if (s) damageShade(s, K_DAMAGE * h.power * (W0 / Math.max(1, h.width)) * mods.damage * (S.dawn.until > S.t ? 2 : 1) * TICK, { hue: 'w', focused: true, lamp: -1, depth: 0 }, 'focus');
    }
    for (let i = 0; i < board.hearts.length; i++) S.dawn.charge = Math.min(S.dawn.max, S.dawn.charge + ((S.trace.heart[i] || 0) / 100) * mods.dawnRate * TICK);
    const kills = burnShades(S.trace.segments, S.shades, TICK, { mods, t: S.t, dawn: S.dawn.until > S.t, hitMul: lensEaterHitMul });
    for (const k of kills) onKill(k);
    for (const s of S.shades) {
      if (s.rimBurn && s.state === 'walk' && cellKind(board, Math.floor(s.x / CELL), Math.floor(s.y / CELL)) === OPEN) {
        damageShade(s, s.rimBurn, { hue: 'w', focused: false, lamp: -1, depth: 0 }, 'rim');
        s.rimBurn = 0;
      }
    }
    const hits = stepShades(S.shades, board, TICK, { light, mods, segments: S.trace.segments, pieceNear, buckets: makeBuckets(board, S.shades) });
    for (const h of hits) {
      const def = SHADES[h.shade.type] || SHADES.wisp;
      const dmg = S.heart.shield > 0 ? 0 : Math.round(def.dmg * (1 - clamp(mods.heartArmor, 0, 0.9)));
      S.heart.hp = Math.max(0, S.heart.hp - dmg);
      S.stats.heartHits++;
      ev('hearthit', { id: h.shade.id, type: h.shade.type, dmg, hp: S.heart.hp, heart: h.heart });
      if (S.heart.hp <= 0 && S.phase !== 'lost') {
        S.phase = 'lost';
        S.lostBy = h.shade.type;
        ev('lost', { by: h.shade.type, night, wave: S.wave, score: S.stats.score });
      }
    }
    if (S.heart.shield > 0) S.heart.shield -= TICK;
    eaterTick();
    mothTick();
    for (const pl of Object.values(players)) pl.focus = Math.min(mods.focusMax, pl.focus + mods.focusRegen * TICK);
    // Phase bookkeeping.
    if (S.phase === 'dusk') {
      if (S.t >= duskCap) startWave(0, '');
    } else if (S.phase === 'wave') {
      S.waveT += TICK;
      while (S.pending.length && S.pending[0].t <= S.waveT) {
        if (!spawnOne(S.pending[0])) break;
        S.pending.shift();
      }
      if (!S.pending.length && aliveCount() === 0) {
        S.stats.wavesCleared++;
        S.stats.score += 50 * night;
        const last = S.wave >= plan.waves.length - 1;
        ev('cleared', { wave: S.wave, last });
        if (last) finishNight();
        else {
          S.phase = 'break';
          S.breakUntil = S.t + BREAK_LEN;
        }
      }
    } else if (S.phase === 'break') {
      if (S.t >= S.breakUntil) startWave(S.wave + 1, '');
    }
    // A dead Shade lingers a second for its death animation, then goes.
    for (let i = S.shades.length - 1; i >= 0; i--) {
      const s = S.shades[i];
      if (s.state !== 'dead' && s.state !== 'hit') continue;
      if (s.diedAt == null) s.diedAt = S.t;
      else if (S.t - s.diedAt > 1.2) S.shades.splice(i, 1);
    }
    if (S.shades.length > MAX_SHADES + 40) S.shades.splice(0, S.shades.length - MAX_SHADES - 40);
  }

  /** Advances to night time `target` in fixed ticks, at most `maxSteps` of them (a frozen tab doesn't replay a minute). */
  function advanceTo(target, maxSteps = 8) {
    let n = 0;
    while (S.t + TICK * 0.5 < target && n < maxSteps && S.phase !== 'lost') {
      tick();
      n++;
    }
    return n;
  }

  function upcoming(within = 4) {
    if (S.phase !== 'wave') return [];
    const out = [];
    for (const e of S.pending) {
      if (e.t - S.waveT > within) break;
      out.push({ arc: e.arc, type: e.type, hue: e.hue, inside: !!SHADES[e.type]?.inside, in: e.t - S.waveT });
    }
    return out;
  }

  // ---- sync helpers -----------------------------------------------------------------------------------------
  function exportPieces() {
    return S.pieces.map((p) => ({ id: p.id, type: p.type, c: p.c, r: p.r, angle: Math.round(p.angle * 10) / 10, owner: p.owner, t0: Math.round(p.t0 * 100) / 100, cracked: p.cracked ? 1 : 0 }));
  }
  function importPieces(list) {
    if (!Array.isArray(list)) return;
    const next = [];
    for (const q of list.slice(0, 120)) {
      if (!q || !isPieceType(q.type)) continue;
      const old = pieceById(finite(q.id, -1));
      const p = old || { id: num(q.id, 1, 1e6, 1), type: q.type, heat: 0, cracked: 0, hot: 0, store: 0, sr: 0, sg: 0, sb: 0, pulseUntil: 0, pr: 0, pg: 0, pb: 0 };
      p.type = q.type;
      p.c = num(q.c, 0, board.cols - 1, 0);
      p.r = num(q.r, 0, board.rows - 1, 0);
      p.angle = normDeg(q.angle);
      p.owner = typeof q.owner === 'string' ? q.owner.slice(0, 64) : '';
      p.t0 = finite(q.t0);
      if (!old) p.cracked = q.cracked ? S.t || 1e-6 : 0;
      next.push(p);
    }
    next.sort((a, b) => a.id - b.id);
    S.pieces = next;
    S.nextPieceId = Math.max(S.nextPieceId, ...next.map((p) => p.id + 1), 1);
  }
  function exportMeta() {
    return {
      t: Math.round(S.t * 100) / 100,
      phase: S.phase,
      wave: S.wave,
      waveT: Math.round(S.waveT * 100) / 100,
      breakUntil: Math.round(S.breakUntil * 100) / 100,
      heart: Math.round(S.heart.hp),
      heartMax: S.heart.max,
      dawn: Math.round(S.dawn.charge * 10) / 10,
      dawnUntil: Math.round(S.dawn.until * 10) / 10,
      spawned: S.spawned,
      nextShadeId: S.nextShadeId,
      score: S.stats.score,
      kills: S.stats.kills,
      lamps: S.lamps.map((L) => ({ a: Math.round(L.angle), tg: Math.round(L.target), sm: Math.round(L.smother * 10) / 10 })),
      players: Object.fromEntries(Object.values(players).map((pl) => [pl.id, { f: Math.round(pl.focus), fa: Math.round(pl.flareAt * 10) / 10, sa: Math.round(pl.surgeAt * 10) / 10, role: pl.role }])),
      lost: S.lost.slice(0, 60),
      digested: S.digested.slice(0, 60),
      stats: S.stats,
    };
  }
  function importMeta(m) {
    if (!m || typeof m !== 'object') return;
    S.t = num(m.t, 0, 1e6, S.t);
    if (PHASES.includes(m.phase)) S.phase = m.phase;
    S.wave = num(m.wave, -1, plan.waves.length, -1);
    S.waveT = num(m.waveT, 0, 1e6, 0);
    S.breakUntil = num(m.breakUntil, 0, 1e6, 0);
    S.heart.hp = num(m.heart, 0, 9999, S.heart.hp);
    S.heart.max = num(m.heartMax, 1, 9999, S.heart.max);
    S.dawn.charge = num(m.dawn, 0, S.dawn.max, 0);
    S.dawn.until = num(m.dawnUntil, 0, 1e6, 0);
    S.nextShadeId = Math.max(S.nextShadeId, num(m.nextShadeId, 1, 1e7, 1));
    S.stats.score = num(m.score, 0, 1e9, S.stats.score);
    S.stats.kills = num(m.kills, 0, 1e7, S.stats.kills);
    if (m.stats && typeof m.stats === 'object') for (const k of Object.keys(S.stats)) if (typeof S.stats[k] === 'number') S.stats[k] = num(m.stats[k], 0, 1e9, S.stats[k]);
    if (Array.isArray(m.lamps)) m.lamps.forEach((l, i) => {
      if (!S.lamps[i] || !l) return;
      S.lamps[i].angle = normDeg(l.a);
      S.lamps[i].target = normDeg(l.tg);
      S.lamps[i].smother = num(l.sm, 0, 30, 0);
    });
    if (m.players && typeof m.players === 'object') {
      for (const [id, v] of Object.entries(m.players)) {
        if (!v || typeof v !== 'object') continue;
        const pl = players[id] || (players[id] = { id, role: '', focus: mods.focusMax, flareAt: 0, surgeAt: 0, freeUsed: false });
        pl.focus = num(v.f, 0, mods.focusMax, pl.focus);
        pl.flareAt = num(v.fa, 0, 1e6, 0);
        pl.surgeAt = num(v.sa, 0, 1e6, 0);
        if (typeof v.role === 'string') pl.role = v.role.slice(0, 16);
      }
    }
    if (Array.isArray(m.lost)) S.lost = m.lost.filter(isPieceType).slice(0, 60);
    if (Array.isArray(m.digested)) S.digested = m.digested.filter(isPieceType).slice(0, 60);
    // Rebuild the spawn queue for the wave in progress: what was spawned already stays spawned.
    if (S.phase === 'wave' && S.wave >= 0 && S.wave < plan.waves.length) {
      const all = expandWave(plan.waves[S.wave]);
      S.spawned = num(m.spawned, 0, all.length, 0);
      S.pending = all.slice(S.spawned);
    } else S.pending = [];
  }
  function exportShades() {
    const out = [];
    for (const s of S.shades) {
      if (s.state === 'dead' || s.state === 'hit') continue;
      out.push([s.id, s.type, s.hue, Math.round(s.x), Math.round(s.y), Math.round(s.hp), Math.round(s.maxHp), s.state === 'chew' ? 1 : 0, s.target | 0, Math.round(s.hx * 100), Math.round(s.hy * 100), Math.round(s.born * 10) / 10, s.phase | 0, s.arc | 0]);
    }
    return out;
  }
  function importShades(list) {
    if (!Array.isArray(list)) return;
    const next = [];
    for (const a of list.slice(0, MAX_SHADES)) {
      if (!Array.isArray(a) || !SHADES[a[1]]) continue;
      const old = S.shades.find((s) => s.id === a[0]);
      const s = old || makeShade(num(a[0], 1, 1e7, 1), a[1], a[2], a[3], a[4], finite(a[11]), 1);
      s.x = num(a[3], -500, board.w + 500, board.cx);
      s.y = num(a[4], -500, board.h + 500, board.cy);
      s.maxHp = num(a[6], 1, 1e5, s.maxHp);
      s.hp = num(a[5], 0, s.maxHp, s.maxHp);
      s.state = a[7] ? 'chew' : 'walk';
      s.target = num(a[8], 0, 1e6, 0);
      s.hx = num(a[9], -100, 100, 100) / 100;
      s.hy = num(a[10], -100, 100, 0) / 100;
      s.born = num(a[11], 0, 1e6, s.born);
      s.phase = num(a[12], 0, 2, 0);
      s.arc = num(a[13], 0, 7, 0);
      clampToWorld(s, board);
      next.push(s);
    }
    S.shades = next;
    S.nextShadeId = Math.max(S.nextShadeId, ...next.map((s) => s.id + 1), 1);
  }
  function exportHeat() {
    return S.pieces.map((p) => [p.id, Math.round(p.heat), p.cracked ? 1 : 0, Math.round(p.store)]);
  }
  function importHeat(list) {
    if (!Array.isArray(list)) return;
    for (const a of list) {
      if (!Array.isArray(a)) continue;
      const p = pieceById(finite(a[0], -1));
      if (!p) continue;
      p.heat = num(a[1], 0, HEAT_CAP * 1.2, 0);
      if (a[2] && !p.cracked) p.cracked = S.t || 1e-6;
      else if (!a[2]) p.cracked = 0;
      p.store = num(a[3], 0, 1e4, 0);
    }
  }

  return {
    S,
    board,
    mods,
    plan,
    light,
    command,
    tick,
    advanceTo,
    upcoming,
    available,
    owned,
    placedOf,
    pieceById,
    pieceAt,
    player,
    aliveCount,
    deadCount,
    exportPieces,
    importPieces,
    exportMeta,
    importMeta,
    exportShades,
    importShades,
    exportHeat,
    importHeat,
    drainEvents() {
      const e = S.events;
      S.events = [];
      return e;
    },
    /** Adds a player who arrived after the night began (admitted at the next dusk, or a bot). */
    addPlayer(id, role = '') {
      const key = String(id);
      if (!players[key]) players[key] = { id: key, role, focus: mods.focusMax, flareAt: 0, surgeAt: 0, freeUsed: false };
      else if (role) players[key].role = role;
      return players[key];
    },
  };
}
