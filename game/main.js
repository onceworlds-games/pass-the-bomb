// Glint: boot, the frame loop, and the wiring between the session, the scene, the HUD, the screens and sound.

import { platform } from './platform.js';
import { makeScene } from './render/scene.js';
import { makeFx } from './render/fx.js';
import { PALETTE } from './render/felt.js';
import { makeHud, makeHints } from './ui/hud.js';
import { makeInput } from './ui/input.js';
import { makeScreens } from './ui/screens.js';
import { createSession } from './net/session.js';
import { loadProfile, makeProfileStore } from './profile.js';
import { makeAudio } from './audio/audio.js';
import { forecast, planNight } from './sim/waves.js';
import { traceBeams, countColourCrossings } from './sim/trace.js';
import { dailySetup, dailyDay, endlessNights, RUN_VERSION } from './sim/run.js';
import { SHADES } from './sim/shades.js';
import { BOARD_DEFS } from './sim/boards.js';
import { CELL } from './sim/boards.js';
import { clamp } from './sim/geom.js';

const params = new URLSearchParams(location.search);
if (params.has('poster')) {
  import('./poster.js').then((m) => m.runPoster(params.get('poster'))).catch((e) => console.error(e));
} else boot().catch((e) => console.error('[glint] boot', e));

async function boot() {
  const canvas = document.getElementById('table');
  const scene = makeScene(canvas);
  const fx = makeFx();
  const hud = makeHud(document.getElementById('hud'), {
    onTray: (type) => {
      audio.unlock();
      input.selectTray(type);
      if (input.trayType) hint('tray', 'Tap the felt to place it', 3);
    },
    onWave: () => wave(),
    onAbility: (name) => ability(name),
    onZoom: (dir) => scene.setZoom(scene.view.zoom * (dir > 0 ? 1.4 : 1 / 1.4)),
  });
  const hints = makeHints(document.getElementById('hint'));
  const toastNode = document.getElementById('toast');
  const screens = makeScreens(document.getElementById('screen'), {});
  const audio = makeAudio();
  const test = params.has('test');

  // Join first, before anything heavy, so a reload keeps its seat.
  const me = await platform.player();
  const JOIN = { private: true, maxPlayers: 4, minPlayers: 1, lobby: 'bar' };
  let room = await platform.join(JOIN);
  const profile = makeProfileStore(await loadProfile());
  const app = {
    screen: '',
    // Standalone only (no SDK): ?quality=low|medium|high and ?reduced exercise those paths in the smoke test.
    reduced: platform.settings.reducedMotion || (!platform.present && params.has('reduced')),
    quality: (!platform.present && ['low', 'medium', 'high'].includes(params.get('quality')) && params.get('quality')) || platform.settings.quality,
    setup: { kit: profile.p.lastKit, boardId: profile.p.lastBoard, ascension: profile.p.lastAscension, daily: null },
    avatars: new Map(),
    seenLedger: 0,
    seenRunId: '',
    closed: false,
    nightKills: { r: 0, g: 0, b: 0 },
    cracked: false,
    lastCross: 0,
    crossAt: 0,
    freeze: 0,
    lastHintAt: 0,
  };
  platform.controls.clear();

  const hooks = {
      onEvent: (e, own) => onEvent(e, own),
      onNightStart: (N) => {
        app.nightKills = { r: 0, g: 0, b: 0 };
        app.cracked = false;
        scene.setBoard(N.board, profile.p.cosmetics);
        input.deselect();
        audio.nightStart();
        showPlay();
        if (N.plan.tutorial) hints.show('Night 1. One lamp. Make it reach.', 3200);
      },
      onNightEnd: () => {},
      onLobby: () => showLobby(),
      onRun: () => {
        syncProfileFromRun();
        if (app.screen !== 'play') showLobby();
      },
      onHost: () => {
        if (!session.playing()) showLobby();
      },
      onRoster: () => {
        if (app.screen === 'lobby') showLobby();
        refreshAvatars();
      },
      onClose: (reason) => {
        app.screen = 'closed';
        app.closed = true;
        hud.hide();
        screens.closed(reason, () => rejoin());
        audio.stopAll();
      },
      onRefuse: (reason, op) => onRefuse(reason, op),
  };
  let session = createSession({ room, me, hooks });
  await session.loadSavedRun();

  const input = makeInput(canvas, scene, {
    pieces: () => session.night()?.S.pieces || [],
    lamps: () => session.night()?.S.lamps || [],
    available: (type) => session.night()?.available(type) || 0,
    trayTypes: () => trayList().map((t) => t.type),
    command: (cmd) => {
      if (!canAct()) return;
      session.command(cmd);
      if (cmd.op === 'place') audio.play('place', { angle: cmd.angle });
      if (cmd.op === 'move') audio.play('move');
      if (cmd.op === 'sell') audio.play('sell');
    },
    lamp: (i, a) => canAct() && session.lamp(i, a),
    grab: (id) => session.grab(id),
    release: () => session.release(),
    cursor: (x, y) => session.cursor(x, y, true),
    ping: (x, y) => {
      session.ping(x, y);
      audio.play('ping');
    },
    sound: (name, a) => audio.play(name, { angle: a }),
    playing: () => app.screen === 'play' && canAct(),
    wave: () => wave(),
    ability: (name, hover) => ability(name, hover),
    cycleLamp: () => {},
    touched: () => audio.unlock(),
  });
  const canAct = () => session.participant() || room.kind === 'solo';

  function wave() {
    const N = session.night();
    if (!N || !canAct()) return;
    if (N.S.phase === 'dusk' || N.S.phase === 'break') {
      session.command({ op: 'wave' });
      audio.play('wave');
    }
  }

  function ability(name, hover) {
    const N = session.night();
    if (!N || !canAct()) return;
    if (name === 'flare') {
      // Flare where the pointer is, else where the ink is thickest, else the Heart.
      let x;
      let y;
      if (hover && hover.x != null) (x = hover.x), (y = hover.y);
      else {
        let n = 0;
        x = 0;
        y = 0;
        for (const s of N.S.shades) if (s.state === 'walk' || s.state === 'chew') (x += s.x), (y += s.y), n++;
        if (n) (x /= n), (y /= n);
        else (x = N.board.hearts[0].x), (y = N.board.hearts[0].y);
      }
      session.command({ op: 'flare', x, y });
    } else if (name === 'dawn') session.command({ op: 'dawn' });
    else if (name === 'surge') session.command({ op: 'surge' });
  }

  function onRefuse(reason, op) {
    const text = { focus: 'No Focus', occupied: 'Taken', cell: 'Not there', none: 'None left', locked: 'In another hand', cooldown: 'Not yet', charge: 'Dawn is not full', dusk: 'Not at dusk', full: 'The table is full' }[reason];
    if (text) toast(text);
    audio.play('refuse');
    void op;
  }

  let toastTimer = 0;
  function toast(text, ms = 1400) {
    toastNode.textContent = text;
    toastNode.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastNode.hidden = true), ms);
  }
  function hint(id, text, times = 3) {
    if (performance.now() - app.lastHintAt < 1500) return;
    if (profile.hint(id, times)) {
      app.lastHintAt = performance.now();
      hints.show(text);
    }
  }

  // ---- events from the simulation (own or forwarded) -------------------------------------------------------
  function onEvent(e) {
    const N = session.night();
    switch (e.k) {
      case 'kill': {
        const def = SHADES[e.type];
        const hue = { r: PALETTE.red, g: PALETTE.green, b: PALETTE.blue }[e.hue] || PALETTE.core;
        fx.burst(e.x, e.y, def?.boss ? 40 : 8, `rgba(255,220,150,0.9)`, def?.boss ? 220 : 90, { quality: app.quality });
        fx.ink(e.x, e.y, def?.boss ? 30 : 6, { quality: app.quality });
        audio.play('burn', { big: !!def?.boss, hue: e.hue });
        if (def?.boss) {
          fx.shake(6, 0.5);
          app.freeze = 0.12;
          audio.play('bossdown');
        }
        profile.set((p) => {
          p.kills++;
          const a = p.almanac[e.type] || (p.almanac[e.type] = { met: true, killed: 0 });
          a.met = true;
          a.killed++;
          if (def?.boss) p.bosses[e.type] = (p.bosses[e.type] || 0) + 1;
        });
        if (e.hue === 'r' || e.hue === 'g' || e.hue === 'b') app.nightKills[e.hue]++;
        badge('first-burn');
        if (e.focused && e.fast) badge('focus-point');
        if (e.depth >= 10) badge('mirror-maze');
        if (e.type === 'umbra') badge('umbra-down');
        if (e.type === 'lenseater') badge('lens-eater-down');
        if (app.nightKills.r && app.nightKills.g && app.nightKills.b) badge('rainbow');
        void hue;
        break;
      }
      case 'spawn':
        profile.set((p) => {
          const a = p.almanac[e.type] || (p.almanac[e.type] = { met: false, killed: 0 });
          a.met = true;
        });
        if (SHADES[e.type]?.boss) {
          toast(`${SHADES[e.type].name}`, 2600);
          audio.play('boss');
          fx.shake(3, 0.4);
        }
        break;
      case 'hearthit':
        fx.shake(e.dmg > 0 ? 4 : 1, 0.3);
        audio.play('thud', { big: e.dmg >= 20 });
        if (N) fx.burst(N.board.hearts[e.heart || 0].x, N.board.hearts[e.heart || 0].y, 10, 'rgba(5,6,10,0.9)', 120, { quality: app.quality });
        hint('heart', 'Light the lane they use', 2);
        break;
      case 'crack': {
        const x = (e.c + 0.5) * CELL;
        const y = (e.r + 0.5) * CELL;
        fx.chips(x, y, 10, { quality: app.quality });
        fx.shake(2, 0.25);
        audio.play('crack');
        app.cracked = true;
        toast('Cracked');
        hint('crack', 'Too much light on one glass', 3);
        break;
      }
      case 'shatter': {
        const x = (e.c + 0.5) * CELL;
        const y = (e.r + 0.5) * CELL;
        fx.chips(x, y, 24, { quality: app.quality });
        fx.shake(4, 0.35);
        audio.play('shatter');
        toast('Shattered');
        break;
      }
      case 'repair':
        audio.play('select');
        break;
      case 'pulse': {
        const x = (e.c + 0.5) * CELL;
        const y = (e.r + 0.5) * CELL;
        fx.ring(x, y, 90, 0.9, 'rgba(255,244,214,A)');
        audio.play('pulse');
        break;
      }
      case 'flare':
        fx.ring(e.x, e.y, e.r || 192, 1.2, 'rgba(255,230,170,A)');
        audio.play('flare');
        break;
      case 'dawn':
        if (N) fx.ring(N.board.cx, N.board.cy, 700, 2.0, 'rgba(255,244,214,A)');
        audio.play('dawn');
        toast('Dawn', 1800);
        break;
      case 'surge':
        audio.play('surge');
        break;
      case 'wave': {
        audio.play('wave');
        const w = N?.plan.waves[e.wave];
        if (w) toast(`Wave ${e.wave + 1} of ${e.of}`, 1600);
        break;
      }
      case 'cleared':
        audio.play('cleared');
        if (!e.last) toast('Wave cleared', 1400);
        if (N && N.S.phase === 'break') hint('break', 'Breathing room. Re-aim.', 2);
        break;
      case 'eaten':
        audio.play('eaten');
        toast(e.boss ? 'Eaten' : 'Chewed through');
        break;
      case 'moth':
        audio.play('moth');
        toast('A moth in the lamp');
        break;
      case 'done':
        audio.play('nightdone');
        if (app.cracked) badge('heat-wave');
        toast('Dawn comes', 2400);
        break;
      case 'lost':
        audio.play('lost');
        fx.shake(8, 0.8);
        break;
      case 'refuse':
        if (e.pid === me.id) onRefuse(e.reason, '');
        break;
      case 'ping':
        audio.play('ping');
        break;
      case 'shadow':
        audio.play('shadow');
        break;
      case 'flicker':
        audio.play('flicker');
        break;
      default:
        break;
    }
  }

  const badgeDone = new Set();
  function badge(id) {
    if (badgeDone.has(id) || profile.p.badges[id]) return;
    badgeDone.add(id);
    platform.badges.award(id).then((ok) => {
      if (ok) profile.set((p) => (p.badges[id] = true));
    });
  }

  /** A finished night or run in the shared run record: this page's own profile, badges and boards follow it. */
  function syncProfileFromRun() {
    const R = session.currentRun();
    if (!R) {
      app.seenLedger = 0;
      app.seenRunId = '';
      return;
    }
    if (R.id !== app.seenRunId) {
      app.seenRunId = R.id;
      app.seenLedger = 0;
    }
    if (R.ledger.length > app.seenLedger) {
      const fresh = R.ledger.slice(app.seenLedger);
      app.seenLedger = R.ledger.length;
      profile.set((p) => {
        for (const e of fresh) {
          p.nightsPlayed++;
          if (e.won) p.bestNight = Math.max(p.bestNight, e.night);
          if (R.daily != null && R.daily === dailyDay(platform.now())) {
            if (p.daily.day !== R.daily) p.daily = { day: R.daily, score: 0 };
            p.daily.score = Math.max(p.daily.score, R.score);
          }
        }
        if (R.phase === 'lost' || R.phase === 'won') {
          p.runs++;
          p.bestScore = Math.max(p.bestScore, R.score);
          if (R.endless) p.bestEndless = Math.max(p.bestEndless, endlessNights(R));
        }
        if (R.phase === 'won') {
          p.wins++;
          p.boardsWon[R.boardId] = (p.boardsWon[R.boardId] || 0) + 1;
          p.ascensionWon = Math.max(p.ascensionWon, R.ascension);
        }
        if (R.ledger.length >= 1 && R.tutorial) p.tutorialDone = true;
      });
      if (R.phase === 'won' || R.phase === 'lost') {
        platform.leaderboards.submit('best-score', R.score);
        if (R.endless) platform.leaderboards.submit('endless-nights', endlessNights(R));
        if (R.daily != null) {
          platform.leaderboards.submit('daily-score', R.score);
          badge('daily-dusk');
        }
      }
      if (R.phase === 'won') {
        badge('long-dusk-done');
        if (R.boardId === 'twin') badge('twin-hearts');
        if (R.ascension >= 4) badge('ascendant');
      }
    }
  }

  // ---- screens ---------------------------------------------------------------------------------------------
  function arcName(boardId, i) {
    const b = session.boardOf(boardId);
    return b.arcs[i]?.name || '';
  }
  function forecastFor(R) {
    try {
      const board = session.boardOf(R.boardId);
      const plan = planNight({ seed: R.seed, night: R.night, board, ascension: R.ascension, tutorial: R.tutorial && R.night === 1 });
      return forecast(plan, false);
    } catch {
      return null;
    }
  }
  async function refreshAvatars() {
    for (const p of session.roster()) {
      if (app.avatars.has(p.id)) continue;
      app.avatars.set(p.id, null);
      const url = await platform.avatar(p.id, 'head');
      if (url) {
        app.avatars.set(p.id, url);
        if (app.screen === 'lobby') showLobby();
      }
    }
  }

  function showLobby() {
    if (session.playing()) return;
    hud.hide();
    hints.hide();
    platform.controls.clear();
    const R = session.currentRun();
    app.screen = 'lobby';
    try {
      room.hideLobby?.(false);
    } catch {}
    if (R && R.phase === 'dawn') {
      screens.dawn({ run: R, isHost: session.isHost(), brass: profile.p.cosmetics.brass, onDraft: (i) => session.draft(i) && audio.play('draft'), onFate: (t) => session.fate(t) && audio.play('draft') });
      return;
    }
    if (R && (R.phase === 'lost' || R.phase === 'won')) {
      screens.ended({ run: R, isHost: session.isHost(), onEndless: () => session.endless(), onNewRun: () => session.abandonRun() && showLobby() });
      return;
    }
    if (app.setup.daily != null) app.setup.daily = dailyDay(platform.now());
    screens.observatory({
      run: R,
      profile: profile.p,
      roster: session.roster(),
      avatars: app.avatars,
      myRole: session.presence.role,
      isHost: session.isHost(),
      standalone: room.kind === 'solo',
      savedRun: session.S.savedRun,
      setup: app.setup,
      hostSetup: room.state.setup || null,
      dailyMods: app.setup.daily != null ? dailySetup(app.setup.daily).mods : [],
      now: platform.now(),
      canInvite: room.kind !== 'solo',
      badges: null,
      forecastFor,
      arcName,
      onInvite: () => platform.ui.showInvite(),
      onRole: (r) => {
        session.setRole(r);
        audio.play('select');
        showLobby();
      },
      onSetup: (patch) => {
        Object.assign(app.setup, patch);
        profile.set((p) => {
          p.lastKit = app.setup.kit;
          p.lastBoard = app.setup.boardId;
          p.lastAscension = app.setup.ascension;
        });
        if (session.isHost()) room.setState('setup', { ...app.setup });
        audio.play('select');
        showLobby();
      },
      onContinue: () => {
        session.continueRun();
        audio.play('select');
        showLobby();
      },
      onAbandon: () => {
        session.abandonRun();
        showLobby();
      },
      onStart: () => startFromObservatory(),
      onCosmetic: (kind, id) => {
        profile.set((p) => (p.cosmetics[kind] = id));
        scene.setCosmetics(profile.p.cosmetics);
        audio.play('select');
        showLobby();
      },
    });
  }

  /** The host's own Start (standalone only; on the platform the strip's Start does this). */
  function startFromObservatory() {
    if (!session.isHost()) return;
    const R = session.currentRun();
    if (!R || R.phase === 'lost' || R.phase === 'won') session.newRun({ ...app.setup, tutorial: !profile.p.tutorialDone });
    try {
      room.startMatch();
    } catch (e) {
      console.warn('[glint] start', e);
    }
  }
  // On the platform the host presses Start in the strip: make sure a run exists the moment the match starts.
  function wireRoom() {
    room.on('starting', () => {
      if (!session.isHost()) return;
      const R = session.currentRun();
      if (!R || R.phase === 'lost' || R.phase === 'won') session.newRun({ ...app.setup, tutorial: !profile.p.tutorialDone });
    });
    room.on('state', (key) => {
      if (key === 'setup' && !session.isHost() && app.screen === 'lobby') showLobby();
    });
  }
  wireRoom();

  /** The room closed (kicked, replaced, lost): one button, and the same join again. */
  async function rejoin() {
    app.screen = '';
    app.closed = false;
    room = await platform.join(JOIN);
    session = createSession({ room, me, hooks });
    wireRoom();
    await session.loadSavedRun();
    if (session.playing()) showPlay();
    else showLobby();
  }

  function showPlay() {
    screens.hide();
    app.screen = 'play';
    if (room.spectating) {
      hud.hide();
      screens.watching({ night: session.currentRun()?.night || 1 });
    } else {
      hud.show();
      const portrait = innerHeight > innerWidth * 1.2;
      scene.setInsets(hud.insets(portrait));
      scene.layout();
      // A small screen opens zoomed so a cell is at least 30 px to tap; the buttons zoom back out.
      if (scene.view.fit * CELL < 30 && scene.view.zoom === 1) scene.setZoom(Math.min(3, 30 / (scene.view.fit * CELL)));
    }
    try {
      room.hideLobby?.(true);
    } catch {}
  }

  // ---- the loop -------------------------------------------------------------------------------------------
  function trayList() {
    const N = session.night();
    if (!N) return [];
    return Object.keys(N.S.deck)
      .filter((t) => N.owned(t) > 0)
      .map((t) => ({ type: t, count: N.available(t) }));
  }

  function forecastText(N) {
    const S = N.S;
    const next = S.phase === 'dusk' ? 0 : S.phase === 'break' ? S.wave + 1 : -1;
    const w = N.plan.waves[next];
    if (!w) return '';
    const hueWord = { r: 'red', g: 'green', b: 'blue' };
    const types = [...new Set(w.entries.map((e) => e.type))];
    const names = types.map((t) => SHADES[t]?.name).filter(Boolean).slice(0, 3).join(', ');
    const arcs = [...new Set(w.arcs)].map((a) => N.board.arcs[a]?.name).filter(Boolean).join(', ');
    const locked = w.entries.some((e) => SHADES[e.type]?.cls === 'locked');
    const hues = w.hues.map((h) => hueWord[h]).join(' and ');
    return `${next === 0 ? `Night ${S.night}.` : `Next:`} ${names} from the ${arcs}.${locked ? ` The Veils want ${hues}.` : w.hues.length && w.entries.some((e) => SHADES[e.type]?.cls === 'tinted') ? ` They want ${hues}.` : ''}`;
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = clamp((now - last) / 1000, 0, 0.1);
    last = now;
    if (document.hidden) return;
    try {
      session.update(platform.now(), dt);
      const N = session.night();
      const shake = fx.step(dt, { reduced: app.reduced });
      if (app.freeze > 0) {
        app.freeze -= dt;
        return;
      }
      if (N && !app.closed) {
        if (app.screen !== 'play') showPlay();
        drawNight(N, dt, shake);
        audio.tick(dt, nightAudio(N));
      } else {
        if (scene.board) {
          scene.frame({ t: now / 1000, pieces: [], lamps: scene.board.lamps.map((L) => ({ ...L, power: 60 })), shades: [], segments: [], intensity: 0.6 }, fx, { dt, reduced: app.reduced, shake });
        } else {
          const board = session.boardOf(app.setup.boardId);
          scene.setBoard(board, profile.p.cosmetics);
        }
        audio.tick(dt, null);
      }
    } catch (e) {
      // Nothing in the frame may stop the game; a bad frame is logged once per second at most.
      if (!app.lastErr || now - app.lastErr > 1000) {
        app.lastErr = now;
        console.error('[glint] frame', e);
      }
    }
  }

  function drawNight(N, dt, shake) {
    const S = N.S;
    const segments = session.segments();
    const sel = input.selected;
    const ghost = input.ghost();
    let ghostSegs = null;
    if (ghost && ghost.valid !== false && ghost.piece) {
      const pieces = S.pieces.filter((p) => p.id !== ghost.moving).concat([{ ...ghost.piece, id: -1 }]);
      ghostSegs = traceBeams({ board: N.board, pieces, lamps: S.lamps, t: S.t, mods: N.mods }).segments;
    }
    const next = S.phase === 'dusk' ? 0 : S.phase === 'break' ? S.wave + 1 : -1;
    const w = N.plan.waves[next];
    const fc = w ? { arcs: w.arcs, hues: w.hues } : null;
    scene.frame(
      {
        t: S.t,
        pieces: S.pieces,
        lamps: S.lamps,
        shades: S.shades,
        segments,
        heart: S.heart,
        dawn: { charge: S.dawn.charge, max: S.dawn.max, active: S.dawn.until > S.t },
        phase: S.phase,
        upcoming: N.upcoming(4),
        shadows: S.shadows,
        bands: S.bands,
        forecast: fc,
        lanes: !!fc,
        ghost: ghost ? { ...ghost, segments: ghostSegs } : null,
        selected: sel,
        locks: session.locks(),
        cursors: session.cursors(),
        pings: session.pings,
        mods: N.mods,
        intensity: 1,
      },
      fx,
      { dt, reduced: app.reduced, shake },
    );
    // The dial and energies, over everything.
    const ctx = scene.ctx;
    const sc = scene.view.scale * platform.settings.pixelRatio(2);
    ctx.setTransform(sc, 0, 0, sc, (scene.view.ox + shake.x) * platform.settings.pixelRatio(2), (scene.view.oy + shake.y) * platform.settings.pixelRatio(2));
    if (canAct()) input.drawOverlay(ctx, S.t);
    if (input.showEnergy) scene.beams.drawGhost(ctx, segments, { fontSize: 12 });
    // HUD.
    const pl = N.player(me.id);
    const t = S.t;
    const waveLabel = S.phase === 'dusk' ? 'Dusk' : S.phase === 'wave' ? `Wave ${S.wave + 1} / ${N.plan.waves.length}` : S.phase === 'break' ? `Break ${Math.max(0, Math.ceil(S.breakUntil - t))}` : S.phase === 'done' ? 'Dawn' : 'Dark';
    hud.update({
      nightLabel: `Night ${S.night}`,
      waveLabel,
      heart: S.heart.hp / S.heart.max,
      heartHp: S.heart.hp,
      dawn: S.dawn.charge / S.dawn.max,
      dawnActive: S.dawn.until > t,
      focus: pl ? pl.focus : 0,
      focusMax: N.mods.focusMax,
      free: S.phase === 'dusk',
      tray: trayList(),
      selectedType: input.trayType,
      brass: profile.p.cosmetics.brass,
      flare: pl && S.phase !== 'dusk' ? { ready: t >= pl.flareAt && S.phase !== 'done' && S.phase !== 'lost', left: clamp((pl.flareAt - t) / N.mods.flareCd, 0, 1) } : null,
      dawnAbility: S.phase !== 'dusk' ? { ready: S.dawn.charge >= S.dawn.max && S.dawn.until <= t, left: 1 - S.dawn.charge / S.dawn.max } : null,
      surge: pl && S.phase !== 'dusk' ? { ready: t >= pl.surgeAt, left: clamp((pl.surgeAt - t) / N.mods.surgeCd, 0, 1) } : null,
      waveButton: !canAct() ? '' : S.phase === 'dusk' ? 'Begin night' : S.phase === 'break' ? 'Next wave' : '',
      waveDisabled: false,
      forecast: S.phase === 'dusk' || S.phase === 'break' ? forecastText(N) : '',
      zoomable: true,
    });
    // Guided first night: one short line at the moment it matters.
    if (N.plan.tutorial && canAct()) tutorialHints(N);
    if (test) drive(N);
    void dt;
  }

  function tutorialHints(N) {
    const S = N.S;
    if (S.phase === 'dusk') {
      if (!S.pieces.length && !input.trayType) hint('t-pick', 'Pick a mirror from the tray', 4);
      else if (S.pieces.length === 1 && S.pieces[0].angle === 45) hint('t-turn', 'Tap it. Turn the dial.', 3);
      else if (S.pieces.length >= 1) hint('t-wave', 'Begin the night when the lane is lit', 3);
    } else if (S.phase === 'wave' && S.wave === 1) hint('t-focus', 'Moving glass costs Focus now', 2);
  }

  function nightAudio(N) {
    const S = N.S;
    const segs = session.segments();
    let power = 0;
    for (const s of segs) power += s.r + s.g + s.b;
    let alive = 0;
    let boss = false;
    for (const s of S.shades) {
      if (s.state === 'walk' || s.state === 'chew') alive++;
      if (SHADES[s.type]?.boss && s.state !== 'dead') boss = true;
    }
    if (S.t - app.crossAt > 0.5) {
      app.crossAt = S.t;
      const n = countColourCrossings(segs);
      if (n > app.lastCross) audio.play('sparkle');
      app.lastCross = n;
    }
    const waveProgress = S.phase === 'wave' ? clamp(S.waveT / (N.plan.waves[S.wave]?.dur || 60), 0, 1) : 0;
    return { power: Math.min(1, power / 300), beams: segs.length, alive, danger: clamp(alive / 14 + (1 - S.heart.hp / S.heart.max) * 0.6 + (boss ? 0.3 : 0), 0, 1), phase: S.phase, waveProgress, dawn: S.dawn.until > S.t, boss };
  }

  // ---- a scripted drive for the headless smoke test (?test): plays the public paths on its own ---------------
  let driveT = 0;
  function drive(N) {
    const S = N.S;
    driveT += 1 / 60;
    if (!session.isHost()) return;
    if (S.phase === 'dusk' && S.t > 1.5) {
      if (!S.pieces.length) {
        const types = trayList();
        for (let i = 0; i < Math.min(4, types.length); i++) session.command({ op: 'place', type: types[i].type, c: 4 + i * 2, r: 5 + (i % 2) * 2, angle: 45 + i * 30 });
      }
      if (S.t > 3) session.command({ op: 'wave' });
    } else if (S.phase === 'break') session.command({ op: 'wave' });
    else if (S.phase === 'wave' && Math.floor(S.t) % 7 === 0 && S.t - Math.floor(S.t) < 0.03) {
      const p = S.pieces[0];
      if (p) session.command({ op: 'rotate', id: p.id, angle: (p.angle + 15) % 360 });
      if (S.t > 20 && S.shades.length) session.command({ op: 'flare', x: N.board.cx, y: N.board.cy });
    }
  }

  // ---- window and platform events ------------------------------------------------------------------------
  function resize() {
    const pr = platform.settings.pixelRatio(2);
    scene.resize(innerWidth, innerHeight, pr);
    const portrait = innerHeight > innerWidth * 1.2;
    scene.setInsets(app.screen === 'play' ? hud.insets(portrait) : { left: 0, top: 0, right: 0, bottom: 0 });
  }
  addEventListener('resize', resize);
  platform.settings.onChange(() => {
    app.quality = platform.settings.quality;
    app.reduced = platform.settings.reducedMotion;
    scene.setQuality(app.quality, platform.settings.pixelRatio(2));
    resize();
  });
  scene.setQuality(app.quality, platform.settings.pixelRatio(2));
  scene.setBoard(session.boardOf(app.setup.boardId), profile.p.cosmetics);
  resize();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      profile.flush();
      input.clearAll();
      audio.hide();
    } else {
      last = performance.now();
      audio.show();
    }
  });
  platform.on('pause', () => {
    if (room.online.size <= 1 && session.isHost() && session.playing()) {
      try {
        room.pauseMatch(true);
      } catch {}
    }
    audio.pauseMusic(true);
  });
  platform.on('resume', () => {
    if (session.isHost() && session.playing()) {
      try {
        room.pauseMatch(false);
      } catch {}
    }
    audio.pauseMusic(false);
  });
  platform.on('player', () => app.screen === 'lobby' && showLobby());

  // ---- go -------------------------------------------------------------------------------------------------
  window.__glint = { scene, session, room, profile, input, fx }; // the smoke and store scripts read this
  requestAnimationFrame(frame);
  if (session.playing() || test) {
    audio.unlock();
    if (!session.playing()) {
      session.newRun({ ...app.setup, tutorial: false });
      room.startMatch();
    }
  } else {
    screens.title(() => {
      audio.unlock();
      audio.play('select');
      showLobby();
      refreshAvatars();
    });
    app.screen = 'title';
    try {
      room.hideLobby?.(true);
    } catch {}
  }
  void RUN_VERSION;
  void BOARD_DEFS;
}
