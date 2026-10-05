// The page: one canvas, one loop. Each frame it decides which screen this is (title, lobby, play), reads where everyone is
// (its own character is simulated here; other players come from presence, bots from the host's snapshots or, on the host,
// from the bot simulation), reacts to changes in the match record `g`, and draws.

import { W, H, STEP, TAG_DIST, BANNER_MS, OVER_MS, BETWEEN_MS, FINAL_MS, FALL_MS, ARC_MS, DASH_CD, DASH_CD_HOLD, PLAYER_COLORS, colorOfId, clamp, lerp } from './rules.js';
import { mapOf, spawnAt } from './maps.js';
import { makeChar, resetChar, stepChar, stepGhost, softPush, collide } from './sim.js';
import { rosterIndex, isOut, isImmune, isStunned, bombOf, aliveIds, finalRanking, awards } from './engine.js';
import { createPractice, stepPractice } from './practice.js';
import { createFx } from './fx.js';
import { createInput } from './input.js';
import { unlock, setMusic, sound } from './audio.js';
import { createNet } from './net.js';
import { makeView, paintBackground, drawWorld, newFig, easeOutCubic } from './draw.js';
import * as ui from './ui.js';

const PRES = { snap: 4 };
const BOMB_Z = 2.35; // the bomb floats this high over its holder
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const clipName = (s) => {
  s = typeof s === 'string' ? s : '';
  return s.length > 14 ? s.slice(0, 13) + '…' : s || 'Player';
};

export function startGame({ ow, room, standalone, canvas }) {
  const cx = canvas.getContext('2d');
  const myId = room.me.id;
  const fx = createFx();
  const input = createInput(ow);
  const loadedMid = room.match.phase === 'playing' ? room.match.id : ''; // the page opened in the middle of this match

  // ---------------------------------------------------------------- state
  let pr = 1;
  let viewFull = makeView(innerWidth, innerHeight, 1);
  let viewLobby = viewFull; // the lobby keeps the bottom clear for the platform's Ready strip
  let view = viewFull;
  let bgCanvas = null;
  let bgKey = '';
  let frameNo = 0;
  let acc = 0;
  let lastTs = 0;
  let failed = false;
  const mv = { x: 0, y: 0 };
  const figs = new Map();
  const list = [];
  const bombs = [];
  const bombPool = [];
  const others = [];
  const otherPool = new Map();
  const avatars = new Map();
  const headFigs = new Map();
  const tmpPos = { x: 0, y: 0, vx: 0, vy: 0, dash: false };
  let lobbyHits = [];

  let titleOn = true;
  let titleWorld = null;
  let practice = null;
  let practiceKey = '';
  let practiceSeed = 0;
  let practiceSeen = 0;
  let me = makeChar(W / 2, H * 0.75);
  let lastDashed = 0;
  let seenG = null;
  let pending = null; // my tag, waiting for the host to apply it
  const bombVis = new Map();
  let nextTick = 0;
  let countN = 0;
  let goAt = -1e9;
  let outSoundAt = 0;
  let nextConfetti = 0;
  let lastFinalG = null;
  let lastResult = null;
  let finalHandled = '';
  const badgeGiven = new Set();
  let stats = { matches: 0, wins: 0, passes: 0 };
  let controlsMode = '';
  let hideApplied = null;
  let lobbyAt = 0;
  let scene = 'title';
  let curG = null;
  let curNow = 0;
  let closedReason = '';
  let closedBtn = null;

  const net = createNet(room, ow, {
    posOf(id) {
      const f = figs.get(id);
      return f && f.seen ? f : null;
    },
  });

  try {
    ow.save.get('stats').then((v) => {
      if (v && typeof v === 'object') {
        const n = (x) => (Number.isFinite(x) && x >= 0 ? Math.min(x, 1e9) : 0);
        stats = { matches: n(v.matches), wins: n(v.wins), passes: n(v.passes) };
      }
    }).catch(() => {});
  } catch {
    // no saves outside the platform
  }
  try {
    ow.ui.setOrientation('landscape');
  } catch {
    // ignore
  }

  // ---------------------------------------------------------------- window and settings
  function applyQuality() {
    try {
      fx.setQuality(ow.settings.quality, ow.settings.reducedMotion);
    } catch {
      fx.setQuality('high', false);
    }
  }
  function layout() {
    const w = Math.max(1, Math.round(window.innerWidth));
    const h = Math.max(1, Math.round(window.innerHeight));
    let ratio = 1;
    try {
      ratio = ow.settings.pixelRatio(2);
    } catch {
      ratio = Math.min(window.devicePixelRatio || 1, 2);
    }
    pr = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    canvas.width = Math.max(1, Math.round(w * pr));
    canvas.height = Math.max(1, Math.round(h * pr));
    viewFull = makeView(w, h, pr);
    viewLobby = makeView(w, h, pr, { bottom: 88 });
    view = scene === 'lobby' ? viewLobby : viewFull;
    bgKey = '';
  }
  applyQuality();
  layout();
  addEventListener('resize', layout);
  try {
    ow.settings.on('change', () => {
      applyQuality();
      layout();
    });
  } catch {
    // ignore
  }

  function ensureBackground(map) {
    const key = `${view.W}x${view.H}x${pr}:${map.id}:${Math.round(view.oy)}:${Math.round(view.s * 10)}`;
    if (key === bgKey && bgCanvas) return bgCanvas;
    bgKey = key;
    bgCanvas = document.createElement('canvas');
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    const g = bgCanvas.getContext('2d');
    g.setTransform(pr, 0, 0, pr, 0, 0);
    paintBackground(g, view, map);
    return bgCanvas;
  }

  // ---------------------------------------------------------------- people on screen
  function figOf(id) {
    let f = figs.get(id);
    if (!f) {
      f = newFig(id);
      figs.set(id, f);
    }
    return f;
  }

  function avatarOf(id) {
    let a = avatars.get(id);
    if (!a) {
      a = { img: null, ok: false };
      avatars.set(id, a);
      if (!standalone) {
        Promise.resolve()
          .then(() => ow.player.avatarUrl(id, 'head'))
          .then((url) => {
            if (!url || typeof url !== 'string') return;
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              a.img = img;
              a.ok = true;
            };
            img.src = url;
          })
          .catch(() => {});
      }
    }
    return a.ok ? a.img : null;
  }

  function nameOf(id, g) {
    const p = room.players.get(id);
    if (p && typeof p.name === 'string' && p.name) return clipName(p.name);
    if (g) {
      const i = rosterIndex(g, id);
      if (i >= 0) return clipName(g.roster[i].n);
    }
    return 'Player';
  }

  /** A small stand-in figure for a head on the scoreboard and podium. */
  function headFig(id, g) {
    let h = headFigs.get(id);
    if (!h) {
      h = newFig(id);
      headFigs.set(id, h);
    }
    const i = rosterIndex(g, id);
    const r = i >= 0 ? g.roster[i] : null;
    h.c = r ? r.c : colorOfId(id);
    h.bot = !!(r && r.b);
    h.img = h.bot ? null : avatarOf(id);
    h.name = nameOf(id, g);
    h.soot = 0;
    h.stun = false;
    h.heat = 0;
    h.vx = 0;
    h.vy = 0;
    return h;
  }

  function readPos(f, p) {
    if (!p || typeof p !== 'object' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    f.x = clamp(p.x, 0, W);
    f.y = clamp(p.y, 0, H);
    f.vx = Number.isFinite(p.vx) ? clamp(p.vx, -30, 30) : 0;
    f.vy = Number.isFinite(p.vy) ? clamp(p.vy, -30, 30) : 0;
    f.dash = p.d === 1;
    return true;
  }

  function myStatus(g) {
    if (room.spectating || rosterIndex(g, myId) < 0 || g.gone.includes(myId)) return 'none';
    return isOut(g, myId) ? 'ghost' : 'in';
  }

  // ---------------------------------------------------------------- match events
  room.on('starting', () => {
    countN = 0;
  });
  room.on('matchstart', () => {
    goAt = performance.now();
    sound.beep(true);
    practice = null;
    practiceKey = '';
    lastResult = null;
    hideApplied = null;
    countN = 0;
  });
  room.on('matchend', () => {
    countN = 0;
    practice = null;
    practiceKey = '';
    hideApplied = null;
    pending = null;
    if (lastFinalG) lastResult = { g: lastFinalG, until: performance.now() + 7000 };
    lastFinalG = null;
  });
  room.on('match', () => {
    hideApplied = null;
  });
  room.on('close', (reason) => {
    closedReason = typeof reason === 'string' ? reason : 'disconnected';
  });
  room.on('ready', (p) => {
    if (p && p.ready) {
      sound.ready();
      const f = figs.get(p.id);
      if (f) f.readyT = 0;
    }
  });

  // ---------------------------------------------------------------- reacting to the record
  function beginRound(g, first) {
    pending = null;
    bombVis.clear();
    const map = mapOf(g.map);
    for (const f of figs.values()) {
      f.fly = -1;
      f.soot = 0;
      f.ghost = false;
      f.z = 0;
      f.rot = 0;
      f.alpha = 1;
      f.popT = 0;
      f.hold = f.imm = f.stun = false;
      f.heat = 0;
      f.cheer = 0;
    }
    for (const r of g.roster) {
      const f = figOf(r.id);
      const p = spawnAt(map, g.rid, rosterIndex(g, r.id));
      f.x = p[0];
      f.y = p[1];
      f.vx = f.vy = 0;
    }
    const st = myStatus(g);
    if (st !== 'none') {
      const reload = first && loadedMid === g.mid;
      const pr0 = room.me.presence;
      if (reload && pr0 && Number.isFinite(pr0.x) && Number.isFinite(pr0.y)) {
        resetChar(me, clamp(pr0.x, 0.5, W - 0.5), clamp(pr0.y, 0.5, H - 0.5)); // a reloaded page carries on from where it was
      } else if (st === 'in') {
        const p = spawnAt(map, g.rid, rosterIndex(g, myId));
        resetChar(me, p[0], p[1]);
      }
    }
    lastDashed = me.dashed;
    if (!first) sound.round();
  }

  function realPass(prev, g, b) {
    if (!b.f) return false;
    const before = prev.st[b.f] ? prev.st[b.f].p : 0;
    return (g.st[b.f] ? g.st[b.f].p : 0) > before;
  }

  function award(id) {
    if (badgeGiven.has(id + room.match.id)) return;
    badgeGiven.add(id + room.match.id);
    try {
      ow.badges.award(id).catch(() => {});
    } catch {
      // ignore
    }
  }

  function onG(prev, g) {
    if (!g) return;
    const sameMatch = !!prev && prev.mid === g.mid;
    if (!sameMatch || prev.rid !== g.rid) {
      beginRound(g, !sameMatch);
      return;
    }
    // bombs: dropped, passed
    for (const b of g.bombs) {
      const old = prev.bombs.find((x) => x.k === b.k);
      if (!old) {
        sound.whistle();
      } else if (old.h !== b.h) {
        const real = realPass(prev, g, b);
        const to = figs.get(b.h);
        const from = b.f ? figs.get(b.f) : null;
        sound.boop();
        if (to) {
          fx.puff(to.x, to.y, 7, '#ffffff', 0.8);
          fx.stars(to.x, to.y, 1.7, 3, 0.6);
          to.sqv += 10;
        }
        if (real && from) {
          fx.floater(from.x, from.y - 2.1, '+1', '#ffe066', 0.8);
          from.sqv -= 6;
        }
        if (pending && pending.k === b.k) pending = null;
        if (b.h === myId) {
          sound.bump();
          fx.addTrauma(0.25);
        }
        if (real && b.f === myId && b.b - b.p < 1000) award('close-call');
        if (g.st[myId] && g.st[myId].p >= 10) award('hot-hands');
      }
    }
    for (let i = prev.out.length; i < g.out.length; i++) outEffect(g.out[i], g);
    if (prev.phase !== g.phase) phaseEffect(g);
  }

  function outEffect(e, g) {
    const f = figs.get(e.id);
    if (e.l) {
      if (f) fx.puff(f.x, f.y, 6, '#ffffff', 0.7);
      return;
    }
    if (f) {
      f.fly = 0;
      f.soot = 1;
      f.dx = f.x;
      f.dy = f.y;
      f.hold = false;
      fx.explosion(f.x, f.y);
    }
    sound.boom();
    fx.hit(85);
    fx.flashScreen(0.55);
    fx.addTrauma(e.id === myId ? 1 : 0.65);
    if (e.id === myId) {
      outSoundAt = performance.now() + 500;
    } else if (myStatus(g) === 'in') {
      fx.floater(me.x, me.y - 2.2, '+1', '#ffe066', 0.9);
    }
  }

  function phaseEffect(g) {
    if (g.phase === 'over') {
      const w = g.win ? figs.get(g.win) : null;
      if (w) {
        w.cheer = 1;
        fx.confetti(w.x, w.y, 30, 3.5, 7);
      }
      sound.tada();
    } else if (g.phase === 'final') {
      sound.fanfare();
      lastFinalG = g;
      nextConfetti = 0;
      onFinal(g);
    }
  }

  async function onFinal(g) {
    if (finalHandled === g.mid) return;
    finalHandled = g.mid;
    if (room.spectating || rosterIndex(g, myId) < 0) return;
    const ranking = finalRanking(g);
    const won = ranking[0] === myId && (g.scores[myId] ?? 0) > 0;
    stats = { matches: stats.matches + 1, wins: stats.wins + (won ? 1 : 0), passes: stats.passes + (g.st[myId] ? g.st[myId].p : 0) };
    try {
      await ow.save.set('stats', stats);
    } catch {
      // a failed save never stops the game
    }
    if (won) {
      award('first-win');
      try {
        ow.leaderboards.submit('wins', stats.wins).catch(() => {});
      } catch {
        // ignore
      }
    }
    if (stats.matches >= 10) award('bomb-squad');
    if (g.st[myId] && g.st[myId].p >= 10) award('hot-hands');
  }

  // ---------------------------------------------------------------- fixed-step simulation
  function onMyDash() {
    sound.dash(1);
    const f = figOf(myId);
    f.sqv -= 9;
    fx.dust(me.x, me.y, -me.fx * 3, -me.fy * 3);
    fx.dust(me.x, me.y, -me.fx * 2, -me.fy * 2);
  }

  function detectTag(g, mNow) {
    const b = bombOf(g, myId);
    if (!b || b.a > mNow || b.b <= mNow) return;
    if (pending && pending.k === b.k && mNow - pending.at < 700) return;
    let best = null;
    let bd = TAG_DIST * TAG_DIST;
    for (const r of g.roster) {
      const id = r.id;
      if (id === myId || isOut(g, id) || bombOf(g, id) || isImmune(g, id, mNow)) continue;
      const f = figs.get(id);
      if (!f || f.seen !== frameNo || f.away) continue;
      const d = (f.x - me.x) * (f.x - me.x) + (f.y - me.y) * (f.y - me.y);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    if (!best) return;
    pending = { k: b.k, to: best, at: mNow, rid: g.rid };
    sound.boop();
    const t = figs.get(best);
    if (t) {
      fx.puff(t.x, t.y, 6, '#ffffff', 0.7);
      t.sqv += 8;
    }
    net.requestPass(g, b.k, best);
  }

  function hostOthers(g) {
    let n = 0;
    for (const r of g.roster) {
      if (r.b) continue;
      let o = otherPool.get(r.id);
      if (!o) {
        o = { id: r.id, x: 0, y: 0, vx: 0, vy: 0, dash: false, away: false };
        otherPool.set(r.id, o);
      }
      if (r.id === myId) {
        o.x = me.x;
        o.y = me.y;
        o.vx = me.vx;
        o.vy = me.vy;
        o.dash = me.dashT > 0;
        o.away = false;
      } else {
        const f = figs.get(r.id);
        if (!f) continue;
        o.x = f.x;
        o.y = f.y;
        o.vx = f.vx;
        o.vy = f.vy;
        o.dash = f.dash;
        const p = room.players.get(r.id);
        o.away = !p || p.connected === false;
      }
      others[n++] = o;
    }
    others.length = n;
    return others;
  }

  function pushFromOthers(map) {
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (f.id === myId || f.ghost || f.fly >= 0) continue;
      softPush(me, f.x, f.y);
    }
    collide(me, map);
  }

  function fixed(sc, g, mNow) {
    if (sc === 'title') {
      if (titleWorld) stepPractice(titleWorld, STEP, null);
      return;
    }
    if (sc === 'lobby') {
      const map = mapOf(String(room.settings.map));
      input.move(mv);
      const hold = !!practice && bombOf(practice.g, myId) !== null;
      const stunned = !!practice && isStunned(practice.g, myId, practice.now);
      stepChar(me, mv.x, mv.y, input.dashWanted(), STEP, map, hold, stunned);
      if (me.dashed !== lastDashed) {
        lastDashed = me.dashed;
        input.clearDash();
        onMyDash();
      }
      pushFromOthers(map);
      if (practice) stepPractice(practice, STEP, me);
      return;
    }
    if (sc !== 'play' || !g) return;
    const st = myStatus(g);
    const map = mapOf(g.map);
    const canMove = room.running && (g.phase === 'play' || g.phase === 'over');
    if (st !== 'none' && canMove) {
      input.move(mv);
      if (st === 'in') {
        const hold = bombOf(g, myId) !== null;
        stepChar(me, mv.x, mv.y, input.dashWanted(), STEP, map, hold, isStunned(g, myId, mNow));
        if (me.dashed !== lastDashed) {
          lastDashed = me.dashed;
          input.clearDash();
          onMyDash();
        }
        pushFromOthers(map);
        if (hold && g.phase === 'play') detectTag(g, mNow);
      } else {
        stepGhost(me, mv.x, mv.y, STEP);
      }
    }
    if (canMove && net.amHost(g)) net.hostStep(STEP, mNow, hostOthers(g));
  }

  // ---------------------------------------------------------------- where everyone is
  function gatherRemote(sc, g, mNow) {
    if (sc === 'lobby' || sc === 'wait') {
      for (const [id, p] of room.players) {
        if (id === myId) continue;
        if (sc === 'wait' && !room.isParticipant(id)) continue;
        const f = figOf(id);
        if (!readPos(f, room.presenceAt(id, PRES))) continue;
        f.seen = frameNo;
        f.bot = false;
        f.name = clipName(p.name);
        f.c = colorOfId(id);
        f.img = avatarOf(id);
        f.away = p.connected === false;
        f.ready = p.ready === true;
      }
      return;
    }
    if (sc !== 'play' || !g) return;
    const host = net.amHost(g);
    const renderT = mNow - 130;
    let bi = 0;
    for (const r of g.roster) {
      const id = r.id;
      if (g.gone.includes(id)) {
        bi += r.b ? 1 : 0;
        continue;
      }
      if (r.b) {
        const idx = bi++;
        const f = figOf(id);
        if (!host && net.botAt(idx, g.rid, renderT, tmpPos)) {
          f.x = clamp(tmpPos.x, 0, W);
          f.y = clamp(tmpPos.y, 0, H);
          f.vx = tmpPos.vx;
          f.vy = tmpPos.vy;
          f.dash = tmpPos.dash;
        }
        f.seen = frameNo;
        f.name = clipName(r.n);
        f.c = r.c;
        f.bot = true;
        f.img = null;
        f.away = false;
        f.ready = false;
        continue;
      }
      if (id === myId) continue;
      const f = figOf(id);
      readPos(f, room.presenceAt(id, PRES));
      const p = room.players.get(id);
      f.seen = frameNo;
      f.name = nameOf(id, g);
      f.c = r.c;
      f.bot = false;
      f.img = avatarOf(id);
      f.away = !p || p.connected === false;
      f.ready = false;
    }
  }

  function setMeFig(g) {
    const f = figOf(myId);
    f.seen = frameNo;
    f.me = true;
    f.x = me.x;
    f.y = me.y;
    f.vx = me.vx;
    f.vy = me.vy;
    f.dash = me.dashT > 0;
    f.name = clipName(room.me.name);
    f.bot = false;
    f.img = avatarOf(myId);
    const i = g ? rosterIndex(g, myId) : -1;
    f.c = i >= 0 ? g.roster[i].c : colorOfId(myId);
    f.ready = !g && room.me.ready === true;
    f.away = false;
    f.cd = me.dashCd > 0 ? me.dashCd / (f.hold ? DASH_CD_HOLD : DASH_CD) : -1;
  }

  function fillFromPractice(p) {
    if (!p) return;
    for (const r of p.g.roster) {
      if (r.id === p.meId) continue;
      const e = p.bw.bots.get(r.id);
      if (!e) continue;
      const f = figOf(r.id);
      f.seen = frameNo;
      f.x = e.ch.x;
      f.y = e.ch.y;
      f.vx = e.ch.vx;
      f.vy = e.ch.vy;
      f.dash = e.ch.dashT > 0;
      f.name = r.n;
      f.c = r.c;
      f.bot = true;
      f.img = null;
      f.away = false;
      f.ready = false;
    }
  }

  function gatherLocal(sc, g) {
    if (sc === 'title') {
      fillFromPractice(titleWorld);
      return;
    }
    if (sc === 'lobby') {
      setMeFig(null);
      fillFromPractice(practice);
      return;
    }
    if (sc !== 'play' || !g) return;
    if (myStatus(g) !== 'none') setMeFig(g);
    if (net.amHost(g)) {
      for (const r of g.roster) {
        if (!r.b) continue;
        const ch = net.botChar(r.id, g.rid);
        if (!ch) continue;
        const f = figOf(r.id);
        f.x = ch.x;
        f.y = ch.y;
        f.vx = ch.vx;
        f.vy = ch.vy;
        f.dash = ch.dashT > 0;
      }
    }
  }

  // ---------------------------------------------------------------- animation of what is drawn
  function applyLook(f, gg, now, dt) {
    const b = bombOf(gg, f.id);
    f.hold = !!b;
    const target = b ? clamp(0.55 + (1 - clamp((b.b - now) / 12000, 0, 1)) * 0.45, 0, 1) : 0;
    f.heat += (target - f.heat) * Math.min(1, dt * 6);
    f.imm = !b && isImmune(gg, f.id, now);
    f.stun = isStunned(gg, f.id, now);
  }

  function animate(dt, t, sc, g, mNow) {
    list.length = 0;
    const pw = sc === 'title' ? titleWorld : sc === 'lobby' ? practice : null;
    for (const f of figs.values()) {
      if (f.seen !== frameNo) continue;
      list.push(f);
      f.me = f.id === myId;
      f.hold = f.imm = f.stun = false;
      if (sc === 'play' && g) applyLook(f, g, mNow, dt);
      else if (pw) applyLook(f, pw.g, pw.now, dt);
      else f.heat += (0 - f.heat) * Math.min(1, dt * 6);
      if (sc !== 'play') {
        f.fly = -1;
        f.ghost = false;
        f.soot = 0;
        f.z = 0;
        f.rot = 0;
        f.alpha = 1;
      } else if (g) {
        const out = isOut(g, f.id);
        if (out && f.fly >= 0) {
          f.fly += dt;
          f.x = f.dx;
          f.y = f.dy;
          f.z = 3.5 * f.fly + 14 * f.fly * f.fly;
          f.rot = 12 * f.fly;
          f.hold = false;
          if (f.fly > 1.3) {
            f.fly = -1;
            f.soot = 0;
            f.ghost = true;
            f.ghostT = 0;
            f.z = 0;
            f.rot = 0;
          }
        } else if (out) {
          if (!f.ghost) {
            f.ghost = true;
            f.ghostT = 1;
            f.dx = f.x;
            f.dy = f.y;
            f.soot = 0;
          }
          f.ghostT = Math.min(1, f.ghostT + dt * 2.5);
          f.hold = false;
          if (f.bot) {
            f.x = clamp(f.dx + Math.sin(t * 0.7 + f.seed) * 1.6, 0.6, W - 0.6);
            f.y = clamp(f.dy + Math.cos(t * 0.55 + f.seed * 1.7) * 1.1, 0.6, H - 0.6);
            f.vx = f.vy = 0;
          }
        } else if (f.ghost || f.fly >= 0) {
          f.ghost = false;
          f.fly = -1;
          f.soot = 0;
          f.z = 0;
          f.rot = 0;
        }
      }
      f.you = f.me && sc === 'play' && !!g && g.phase === 'play' && mNow - g.t0 < 3000 && !f.ghost;
      // running, squash and stretch, dust, dashes
      const sp = Math.hypot(f.vx, f.vy);
      f.run += sp * dt * 1.5;
      f.sqv += (-170 * f.sq - 14 * f.sqv) * dt;
      f.sq = clamp(f.sq + f.sqv * dt, -1, 1);
      f.sx = 1 + f.sq * 0.25;
      f.sy = 1 - f.sq * 0.25;
      if (f.popT < 1) f.popT += dt;
      if (f.cheer > 0) f.cheer = Math.max(0, f.cheer - dt / 2.2);
      f.readyT = f.ready ? f.readyT + dt : 0;
      if (f.dash && !f.prevDash && !f.me) {
        if (Math.hypot(f.x - me.x, f.y - me.y) < 7) sound.dash(0.3);
        fx.dust(f.x, f.y, -f.vx * 0.2, -f.vy * 0.2);
        f.sqv -= 8;
      }
      f.prevDash = f.dash;
      if (sp > 3 && !f.ghost && f.fly < 0) {
        f.stepAcc += sp * dt;
        if (f.stepAcc > 1.3) {
          f.stepAcc = 0;
          fx.dust(f.x, f.y, -f.vx * 0.15, -f.vy * 0.15);
        }
      }
      if (f.heat > 0.7 && fx.rand() < dt * 2.5) fx.sweat(f.x, f.y);
      if (f.imm && fx.rand() < dt * 6) fx.sparks(f.x + (fx.rand() - 0.5) * 1.4, f.y, 0.5 + fx.rand() * 1.2, 1, '#bfeaff', 0.25);
    }
    if (sc === 'lobby' && practice && practice.passN !== practiceSeen) {
      practiceSeen = practice.passN;
      sound.boop();
      const to = figs.get(practice.lastTo);
      if (to) {
        fx.puff(to.x, to.y, 7, '#ffffff', 0.8);
        to.sqv += 10;
      }
      if (practice.lastTo === myId) {
        sound.bump();
        fx.addTrauma(0.2);
      }
    }
    if (outSoundAt && performance.now() >= outSoundAt) {
      outSoundAt = 0;
      sound.out();
    }
    if (sc === 'play' && g && g.phase === 'final' && performance.now() >= nextConfetti) {
      nextConfetti = performance.now() + 420;
      fx.confetti(2 + fx.rand() * (W - 4), H * 0.55, 10, 4, 9);
    }
    computeBombs(sc, g, pw, mNow, t);
  }

  function bombObj(i) {
    let o = bombPool[i];
    if (!o) {
      o = { x: 0, y: 0, z: 0, scale: 1, flash: 0, fuse: 1, fall: -1 };
      bombPool[i] = o;
    }
    bombs[i] = o;
    return o;
  }

  function computeBombs(sc, g, pw, mNow, t) {
    let gg = null;
    let now = 0;
    let mine = false;
    if (sc === 'play' && g) {
      gg = g;
      now = mNow;
      mine = true;
    } else if (pw) {
      gg = pw.g;
      now = pw.now;
    }
    let used = 0;
    let minRem = null;
    if (gg) {
      for (const b of gg.bombs) {
        let holder = b.h;
        let from = b.f;
        let p = b.p;
        if (mine && pending && pending.k === b.k && b.h === myId && pending.rid === gg.rid && now - pending.at < 700) {
          holder = pending.to; // draw my tag at once; the host's word arrives a moment later
          from = myId;
          p = pending.at;
        }
        const hf = figs.get(holder);
        if (!hf || hf.seen !== frameNo) continue;
        const o = bombObj(used++);
        const age = now - p;
        o.x = hf.x;
        o.y = hf.y;
        o.z = BOMB_Z + (hf.fly >= 0 ? hf.z : 0) + Math.sin(t * 7 + b.k) * 0.06;
        o.fall = -1;
        let vis = bombVis.get(b.k);
        if (!vis) {
          vis = { thud: age >= FALL_MS || from !== null };
          bombVis.set(b.k, vis);
        }
        if (from === null || from === undefined) {
          const fall = clamp(age / FALL_MS, 0, 1);
          if (fall < 1) {
            o.z = BOMB_Z + 9 * (1 - fall * fall);
            o.fall = fall;
          } else if (!vis.thud) {
            vis.thud = true;
            sound.thud();
            fx.puff(hf.x, hf.y, 6, '#ffffff', 0.6);
            fx.addTrauma(0.18);
            hf.sqv += 9;
          }
        } else if (age < ARC_MS) {
          const u = clamp(age / ARC_MS, 0, 1);
          const ff = figs.get(from);
          const e = easeOutCubic(u);
          if (ff && ff.seen === frameNo) {
            o.x = lerp(ff.x, hf.x, e);
            o.y = lerp(ff.y, hf.y, e);
          }
          o.z = BOMB_Z + Math.sin(Math.PI * u) * 1.9;
        }
        const rem = b.b - now;
        const urg = clamp(1 - rem / 4000, 0, 1);
        o.flash = rem < 2000 ? (Math.sin(t * (14 + (1 - clamp(rem / 2000, 0, 1)) * 30)) * 0.5 + 0.5) * clamp(1.4 - rem / 2000, 0, 1) : 0;
        o.scale = 1 + (rem < 2000 ? (1 - clamp(rem / 2000, 0, 1)) * 0.18 : 0) + urg * Math.sin(t * 20) * 0.03;
        o.fuse = clamp(rem / Math.max(1, b.b - b.s), 0, 1);
        if (fx.rand() < 0.35) fx.sparks(o.x + 0.38 * o.scale, o.y, o.z + 0.75, 1, '#ffd21f', 0.5);
        if (mine && (minRem === null || rem < minRem)) minRem = rem;
      }
    }
    bombs.length = used;
    // the tick: slow at first, faster over the last four seconds
    if (mine && minRem !== null && minRem > 0 && g.phase === 'play' && room.running) {
      const nowP = performance.now();
      if (nowP >= nextTick) {
        const urg = clamp(1 - minRem / 4000, 0, 1);
        sound.tick(urg);
        nextTick = nowP + (minRem > 4000 ? 1000 : 480 - 370 * urg);
      }
    }
  }

  // ---------------------------------------------------------------- the world around the screens
  function ensureWorlds(sc) {
    if (sc === 'title' && !titleWorld) titleWorld = createPractice(7, 'backyard', 6, false, myId);
    if (sc === 'lobby') {
      const mapId = String(room.settings.map);
      const n = clamp(4 - room.online.length, 0, 3);
      const key = `${mapId}|${n}`;
      if (key !== practiceKey) {
        practiceKey = key;
        practice = n > 0 ? createPractice(++practiceSeed, mapId, n, true, myId) : null;
        practiceSeen = 0;
      }
    } else if (sc !== 'title' && practice) {
      practice = null;
      practiceKey = '';
    }
  }

  function applyHide(sc) {
    const want = sc === 'title';
    if (hideApplied === want) return;
    hideApplied = want;
    try {
      room.hideLobby(want);
    } catch {
      // ignore
    }
  }

  function applyControls(sc, g) {
    let mode = 'none';
    if (sc === 'lobby') mode = 'full';
    else if (sc === 'play' && g && g.phase !== 'final') {
      const st = myStatus(g);
      mode = st === 'in' ? 'full' : st === 'ghost' ? 'stick' : 'none';
    }
    if (mode === controlsMode) return;
    controlsMode = mode;
    try {
      ow.controls.set(mode === 'none' ? null : { stick: 'analog', buttons: mode === 'full' ? [{ id: 'dash', label: 'Dash', key: ' ' }] : [] });
    } catch {
      // ignore
    }
  }

  let musicLevel = -1;
  function applyMusic(sc, g) {
    let l = 0.2;
    if (sc === 'lobby' || sc === 'wait') l = 0.3;
    else if (sc === 'play' && g) l = g.phase === 'play' ? 0.55 : g.phase === 'final' ? 0.45 : 0.35;
    if (l !== musicLevel) {
      musicLevel = l;
      setMusic(l);
    }
  }

  function publish(sc, g) {
    let on = sc === 'lobby';
    if (sc === 'play' && g && myStatus(g) !== 'none') on = true;
    if (!on) return;
    try {
      room.setPresence({ x: r2(me.x), y: r2(me.y), vx: r1(me.vx), vy: r1(me.vy), d: me.dashT > 0 ? 1 : 0 });
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------- the frame
  function update(dt, t) {
    frameNo++;
    const g = net.validG();
    curG = g;
    scene = titleOn ? 'title' : room.match.phase === 'playing' ? (g ? 'play' : 'wait') : 'lobby';
    const mNow = room.matchNow();
    curNow = mNow;
    if (g !== seenG) {
      const prev = seenG;
      seenG = g;
      onG(prev, g);
    }
    ensureWorlds(scene);
    applyHide(scene);
    applyControls(scene, g);
    applyMusic(scene, g);
    input.poll();
    let simDt = dt;
    if (fx.freeze > 0) {
      fx.freeze -= dt;
      simDt = 0;
    }
    gatherRemote(scene, g, mNow);
    acc += simDt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      acc -= STEP;
      n++;
      input.tick(STEP);
      fixed(scene, g, mNow);
    }
    if (n === 5) acc = 0;
    gatherLocal(scene, g);
    animate(dt, t, scene, g, mNow);
    fx.update(simDt);
    publish(scene, g);
    // opened on its own (no platform strip): start a match by itself after a moment in the lobby
    if (standalone && scene === 'lobby' && room.match.phase === 'lobby') {
      const nowP = performance.now();
      if (!lobbyAt) lobbyAt = nowP;
      else if (nowP - lobbyAt > 2500) {
        lobbyAt = 0;
        room.startMatch();
      }
    } else lobbyAt = 0;
  }

  function scoreRows(g) {
    const rows = g.roster.map((r) => ({ f: headFig(r.id, g), name: nameOf(r.id, g), total: g.scores[r.id] ?? 0, add: g.rs[r.id] ?? 0, me: r.id === myId }));
    return rows.sort((a, b) => b.total - a.total);
  }

  function podiumOf(g) {
    const ranking = finalRanking(g);
    const top = [];
    for (let i = 0; i < Math.min(3, ranking.length); i++) top.push({ f: headFig(ranking[i], g), name: nameOf(ranking[i], g), score: g.scores[ranking[i]] ?? 0 });
    const a = awards(g);
    return {
      top,
      place: rosterIndex(g, myId) >= 0 && !room.spectating ? ranking.indexOf(myId) : -1,
      awards: { potato: a.potato ? { name: nameOf(a.potato.id, g), n: a.potato.n } : null, slippery: a.slippery ? { name: nameOf(a.slippery.id, g), n: 0 } : null },
    };
  }

  const sceneObj = { figs: list, bombs, fx };

  function render(t) {
    view = scene === 'lobby' ? viewLobby : viewFull;
    cx.setTransform(pr, 0, 0, pr, 0, 0);
    const g = curG;
    const mapId = scene === 'title' ? 'backyard' : scene === 'play' && g ? g.map : String(room.settings.map);
    const map = mapOf(mapId);
    cx.drawImage(ensureBackground(map), 0, 0, view.W, view.H);
    fx.shake(t, clamp(view.s / 22, 0.6, 2.2));
    cx.save();
    cx.translate(fx.sx, fx.sy);
    drawWorld(cx, view, map, sceneObj, t);
    cx.restore();
    if (fx.flash > 0) {
      cx.fillStyle = `rgba(255,255,255,${fx.flash * 0.6})`;
      cx.fillRect(0, 0, view.W, view.H);
    }
    const mNow = curNow;
    const nowP = performance.now();
    if (scene === 'title') {
      ui.drawTitle(cx, view, t, ow.controls.touch);
    } else if (scene === 'lobby') {
      const m = room.match;
      lobbyHits = ui.drawLobbyTop(cx, view, { rounds: Number(room.settings.rounds), map: String(room.settings.map), canEdit: room.isHost && m.phase === 'lobby' });
      if (m.phase === 'lobby') ui.drawHint(cx, view, 'Tag to pass the bomb!', t);
      if (m.phase === 'starting' && m.startsAt) {
        const left = (m.startsAt - ow.now()) / 1000;
        if (left > 0) {
          const n = Math.max(1, Math.ceil(left));
          if (n !== countN) {
            countN = n;
            sound.beep(false);
          }
          ui.drawCountdown(cx, view, n, clamp(n - left, 0, 0.999));
        }
      }
      if (lastResult && m.phase === 'lobby') {
        const left = lastResult.until - nowP;
        if (left > 0) ui.drawResultsCard(cx, view, podiumOf(lastResult.g), left / 700);
        else lastResult = null;
      }
    } else if (g && scene === 'play') {
      const st = myStatus(g);
      const phase = g.phase;
      if (phase === 'play') {
        ui.drawBanner(cx, view, "Don't get caught!", g.n > 1 || g.rounds > 1 ? `ROUND ${g.n}` : '', mNow - g.t0, BANNER_MS);
        if (st === 'in' && bombOf(g, myId)) ui.drawPrompt(cx, view, 'Tag someone!', 1, t);
      }
      if (phase !== 'final' && phase !== 'between') ui.drawHud(cx, view, { round: g.n, rounds: g.rounds, alive: aliveIds(g).length, score: g.scores[myId] ?? 0, out: st === 'ghost' });
      if (phase === 'over') {
        const w = g.win;
        const label = !w ? 'Tie!' : w === myId ? 'You win!' : `${nameOf(w, g)} wins!`;
        ui.drawWinner(cx, view, label, null, mNow - (g.until - OVER_MS));
      } else if (phase === 'between') {
        ui.drawScoreboard(cx, view, scoreRows(g), clamp((mNow - (g.until - BETWEEN_MS)) / 1000, 0, 99), g.n, g.rounds);
      } else if (phase === 'final') {
        ui.drawPodium(cx, view, podiumOf(g), clamp((mNow - (g.until - FINAL_MS)) / 1000, 0, 99));
      }
      if (room.spectating) ui.drawWatching(cx, view, t);
    }
    if (scene === 'play' || scene === 'wait') {
      const age = (nowP - goAt) / 1000;
      if (age >= 0 && age < 0.9) ui.drawCountdown(cx, view, 'GO', age / 0.9);
    }
    if (closedReason) closedBtn = ui.drawClosed(cx, view, closedReason, t);
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    try {
      const dt = lastTs ? clamp((ts - lastTs) / 1000, 0, 0.1) : 0.016;
      lastTs = ts;
      update(dt, ts / 1000);
      render(ts / 1000);
    } catch (err) {
      if (!failed) {
        failed = true;
        setTimeout(() => {
          throw err; // reported once, and the loop keeps going
        });
      }
    }
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------- taps and keys
  function leaveTitle() {
    if (!titleOn) return;
    titleOn = false;
    unlock();
    sound.tap();
    titleWorld = null;
    hideApplied = null;
  }

  for (const type of ['pointerup', 'touchend', 'click', 'keydown']) addEventListener(type, () => unlock(), { passive: true });
  canvas.addEventListener('pointerdown', (e) => {
    unlock();
    if (closedReason) {
      const b = closedBtn;
      if (b && e.clientX >= b.x && e.clientX <= b.x + b.w && e.clientY >= b.y && e.clientY <= b.y + b.h) {
        try {
          location.reload();
        } catch {
          // the platform's menu has Reload too
        }
      }
      return;
    }
    if (titleOn) {
      leaveTitle();
      return;
    }
    if (scene !== 'lobby' || !room.isHost || room.match.phase !== 'lobby') return;
    for (const h of lobbyHits) {
      if (e.clientX >= h.x && e.clientX <= h.x + h.w && e.clientY >= h.y && e.clientY <= h.y + h.h) {
        room.setSetting(h.id, h.value);
        sound.tap();
        break;
      }
    }
  });
  addEventListener('keydown', (e) => {
    if (titleOn && (e.key === ' ' || e.key === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      leaveTitle();
    }
  });
}
