// The session: one table, one run, one night at a time. The host's page runs the simulation and publishes it;
// every other page mirrors it and asks for changes. A night is a platform match; the Observatory is the lobby.
// Authority follows room.isHost && room.connected, checked every frame; a new host adopts what the room holds.

import { buildBoard } from '../sim/boards.js';
import { createNight } from '../sim/night.js';
import { createRun, nightConfig, endNight, applyDraft, applyFate, nextNight, goEndless, parseRun, ROLE_IDS } from '../sim/run.js';
import { traceBeams } from '../sim/trace.js';
import { packSnapshot, applySnapshot, validCommand, packEvents, validEvent } from './codec.js';
import { platform, cleanName } from '../platform.js';
import { finite, clamp } from '../sim/geom.js';

const SNAP_HZ = 10;
const META_HZ = 2;
const STATE_SHADES_HZ = 1;
const LOCK_MS = 2000;
const CURSOR_COLOURS = ['#f0d78a', '#5db4ff', '#6bff8f', '#ff5d4d'];
const RUN_KEY = 'run';

export function createSession({ room, me, hooks }) {
  const boards = new Map();
  const boardOf = (id) => {
    if (!boards.has(id)) boards.set(id, buildBoard(id));
    return boards.get(id);
  };
  const S = {
    R: null, // the run (host's copy; mirrors read room.state.run)
    N: null, // the host's night
    M: null, // a mirror night (every page keeps one while a match plays, the host too for its own drawing)
    base: 0,
    seq: 0,
    lastSnapAt: 0,
    lastMetaAt: 0,
    lastShadesAt: 0,
    lastPiecesJson: '',
    lastRunJson: '',
    savedRun: null, // the host's saved run from ow.save (offer Continue)
    pending: new Map(), // seq -> cmd awaiting a verdict (for toasts)
    pings: [],
    shadeLerp: new Map(),
    events: [],
    role: '',
    nightEndTimer: 0,
    snapSeq: 0,
    lastSnapSeq: -1,
    lastHostId: room.host,
    evBuf: [],
    lastEvAt: 0,
    lastAdmitAt: 0,
  };

  const isHost = () => !!(room.isHost && room.connected);
  const playing = () => room.match && room.match.phase === 'playing';
  const participant = () => playing() && !room.spectating;
  const colourOf = (id) => {
    const ids = [...room.players.keys()].sort();
    return CURSOR_COLOURS[Math.max(0, ids.indexOf(id)) % CURSOR_COLOURS.length];
  };

  // ---- the run --------------------------------------------------------------------------------------------
  function runFromState() {
    const raw = room.state.run;
    const R = raw ? parseRun(raw) : null;
    return R;
  }
  function currentRun() {
    return isHost() && S.R ? S.R : runFromState();
  }
  function publishRun() {
    if (!isHost() || !S.R) return;
    const json = JSON.stringify(S.R);
    if (json !== S.lastRunJson) {
      S.lastRunJson = json;
      room.setState('run', JSON.parse(json));
      hooks.onRun?.(S.R);
    }
    if (S.R.phase === 'won' || S.R.phase === 'lost') platform.save.set(RUN_KEY, null);
    else platform.save.set(RUN_KEY, S.R);
  }
  function newRun(opts) {
    if (!isHost() || playing()) return false;
    S.R = createRun({ ...opts, now: platform.now() });
    publishRun();
    return true;
  }
  function continueRun() {
    if (!isHost() || playing() || !S.savedRun) return false;
    S.R = S.savedRun;
    if (S.R.phase === 'night') S.R.phase = 'dusk';
    publishRun();
    return true;
  }
  function abandonRun() {
    if (!isHost() || playing()) return false;
    S.R = null;
    S.savedRun = null;
    room.setState('run', null);
    S.lastRunJson = '';
    platform.save.set(RUN_KEY, null);
    hooks.onRun?.(null);
    return true;
  }
  function draft(i) {
    if (!isHost() || !S.R || S.R.phase !== 'dawn') return false;
    const ok = applyDraft(S.R, i);
    if (ok) {
      maybeAdvanceDawn();
      publishRun();
    }
    return ok;
  }
  function fate(take) {
    if (!isHost() || !S.R || S.R.phase !== 'dawn' || !S.R.fate) return false;
    const ok = applyFate(S.R, take);
    if (ok) {
      maybeAdvanceDawn();
      publishRun();
    }
    return ok;
  }
  function maybeAdvanceDawn() {
    if (S.R.draft && S.R.draft.taken < 0) return;
    if (S.R.fate && S.R.fate.taken < 0) return;
    nextNight(S.R);
  }
  function endless() {
    if (!isHost() || !S.R || S.R.phase !== 'won') return false;
    goEndless(S.R);
    publishRun();
    return true;
  }

  // ---- the night: host -------------------------------------------------------------------------------------
  function rosterRoles() {
    const roles = {};
    for (const id of room.participants.map((p) => (typeof p === 'string' ? p : p.id))) {
      const pl = room.players.get(id);
      const role = pl?.presence?.role;
      roles[id] = ROLE_IDS.includes(role) ? role : '';
    }
    return roles;
  }
  function hostStartNight() {
    const R = S.R || runFromState();
    if (!R) {
      S.R = createRun({ now: platform.now() });
    } else S.R = R;
    if (S.R.phase === 'dawn') {
      // The host started before choosing: take the first option (a piece is always there) and walk on.
      if (S.R.draft && S.R.draft.taken < 0) applyDraft(S.R, 0);
      if (S.R.fate && S.R.fate.taken < 0) applyFate(S.R, false);
      nextNight(S.R);
    }
    if (S.R.phase === 'won') goEndless(S.R);
    S.R.phase = 'night';
    const roles = rosterRoles();
    room.setState('roles', roles);
    const players = Object.entries(roles).map(([id, role]) => ({ id, role }));
    S.N = createNight(nightConfig(S.R, boardOf(S.R.boardId), players));
    S.base = room.matchNow();
    S.M = S.N;
    room.setState('night', { base: S.base, night: S.R.night, boardId: S.R.boardId, seed: S.R.seed, mid: room.match.id, meta: S.N.exportMeta() });
    room.setState('pieces', S.N.exportPieces());
    room.setState('shades', S.N.exportShades());
    room.setState('heat', S.N.exportHeat());
    S.lastPiecesJson = JSON.stringify(S.N.exportPieces());
    publishRun();
    hooks.onNightStart?.(S.N, true);
  }

  /** Becomes the host of a night in progress, from what the room holds plus the newest snapshot. */
  function adopt() {
    const R = runFromState();
    if (!R) return false;
    S.R = R;
    S.lastRunJson = JSON.stringify(R);
    const night = room.state.night;
    const roles = room.state.roles && typeof room.state.roles === 'object' ? room.state.roles : {};
    const players = room.participants.map((p) => (typeof p === 'string' ? p : p.id)).map((id) => ({ id, role: ROLE_IDS.includes(roles[id]) ? roles[id] : '' }));
    if (S.R.phase !== 'night') S.R.phase = 'night';
    const N = createNight(nightConfig(S.R, boardOf(S.R.boardId), players));
    if (night && night.mid === room.match.id) {
      N.importPieces(room.state.pieces);
      N.importMeta(night.meta);
      if (S.M && S.M !== S.N && S.M.S.shades.length) N.importShades(S.M.exportShades());
      else N.importShades(room.state.shades);
      N.importHeat(room.state.heat);
      S.base = finite(night.base, room.matchNow() - N.S.t * 1000);
    } else S.base = room.matchNow();
    S.N = N;
    S.M = N;
    room.setState('night', { base: S.base, night: S.R.night, boardId: S.R.boardId, seed: S.R.seed, mid: room.match.id, meta: N.exportMeta() });
    hooks.onNightStart?.(N, false);
    return true;
  }

  function hostTick(wall) {
    const N = S.N;
    if (!N) return;
    if (!room.running) return; // paused: the clock stands still
    const target = (room.matchNow() - S.base) / 1000;
    if (target - N.S.t > 2.5) {
      // The page was frozen: carry on calmly from where the night was, not a minute later.
      S.base = room.matchNow() - (N.S.t + 0.1) * 1000;
      room.setState('night', { base: S.base, night: S.R.night, boardId: S.R.boardId, seed: S.R.seed, mid: room.match.id, meta: N.exportMeta() });
    }
    N.advanceTo((room.matchNow() - S.base) / 1000, 6);
    const events = N.drainEvents();
    for (const e of events) {
      if (e.k === 'refuse' && e.pid !== me.id) continue;
      hooks.onEvent?.(e, true);
    }
    // Events travel in batches at the snapshot rate (one message per frame would spend the room's budget).
    if (room.kind !== 'solo') {
      for (const e of packEvents(events)) if (S.evBuf.length < 60) S.evBuf.push(e);
      if (S.evBuf.length && wall - S.lastEvAt >= 1000 / SNAP_HZ) {
        S.lastEvAt = wall;
        room.send({ t: 'ev', list: S.evBuf });
        S.evBuf = [];
      }
    }
    // Publish: pieces on change, a snapshot at 10 Hz, bookkeeping state at low rates.
    const pj = JSON.stringify(N.exportPieces());
    if (pj !== S.lastPiecesJson) {
      S.lastPiecesJson = pj;
      room.setState('pieces', JSON.parse(pj));
    }
    if (room.kind !== 'solo' && wall - S.lastSnapAt >= 1000 / SNAP_HZ) {
      S.lastSnapAt = wall;
      room.send(packSnapshot(N, S.snapSeq++));
    }
    if (wall - S.lastMetaAt >= 1000 / META_HZ) {
      S.lastMetaAt = wall;
      room.setState('night', { base: S.base, night: S.R.night, boardId: S.R.boardId, seed: S.R.seed, mid: room.match.id, meta: N.exportMeta() });
    }
    if (wall - S.lastShadesAt >= 1000 / STATE_SHADES_HZ) {
      S.lastShadesAt = wall;
      room.setState('shades', N.exportShades());
      room.setState('heat', N.exportHeat());
    }
    if ((N.S.phase === 'done' || N.S.phase === 'lost') && !S.nightEndTimer) {
      S.nightEndTimer = setTimeout(hostEndNight, 2600);
    }
    // Friends who arrived after the night began take a seat at dusk or in a break between waves.
    if ((N.S.phase === 'dusk' || N.S.phase === 'break') && wall - S.lastAdmitAt >= 1000) {
      S.lastAdmitAt = wall;
      admitWatchers(N);
    }
  }

  /** Lets connected watchers into the night at a checkpoint, each with the role they brought. */
  function admitWatchers(N) {
    if (room.kind === 'solo' || typeof room.admit !== 'function') return;
    const ids = [];
    for (const p of room.players.values()) {
      if (!p || p.connected === false || p.idle || room.isParticipant(p.id)) continue;
      ids.push(p.id);
    }
    if (!ids.length) return;
    try {
      room.admit(ids.slice(0, 4));
    } catch {
      return;
    }
    const roles = { ...(room.state.roles && typeof room.state.roles === 'object' ? room.state.roles : {}) };
    for (const id of ids.slice(0, 4)) {
      const role = room.players.get(id)?.presence?.role;
      roles[id] = ROLE_IDS.includes(role) ? role : '';
      N.addPlayer(id, roles[id]);
    }
    room.setState('roles', roles);
  }

  function hostEndNight() {
    S.nightEndTimer = 0;
    if (!isHost() || !S.N || !S.R) return;
    endNight(S.R, S.N, platform.now());
    hooks.onNightEnd?.(S.R, S.N);
    if (S.evBuf.length && room.kind !== 'solo') room.send({ t: 'ev', list: S.evBuf });
    S.evBuf = [];
    publishRun();
    room.endMatch();
  }

  // ---- mirrors ---------------------------------------------------------------------------------------------
  function buildMirror() {
    const R = runFromState();
    const night = room.state.night;
    if (!R || !night || night.mid !== room.match.id) return null;
    const roles = room.state.roles && typeof room.state.roles === 'object' ? room.state.roles : {};
    const players = Object.keys(roles).map((id) => ({ id, role: ROLE_IDS.includes(roles[id]) ? roles[id] : '' }));
    const M = createNight(nightConfig(R, boardOf(R.boardId), players));
    M.importPieces(room.state.pieces);
    M.importMeta(night.meta);
    M.importShades(room.state.shades);
    M.importHeat(room.state.heat);
    S.base = finite(night.base, 0);
    return M;
  }

  function mirrorTick(wall, dt) {
    if (!S.M && playing()) {
      S.M = buildMirror();
      if (S.M) hooks.onNightStart?.(S.M, false);
    }
    const M = S.M;
    if (!M) return;
    // Smooth the ink between snapshots; the beams are re-traced locally from the mirrored glass.
    const k = clamp(dt * 12, 0, 1);
    const cool = Math.max(0, 1 - dt * 4);
    for (const s of M.S.shades) {
      s.burn *= cool;
      const tg = S.shadeLerp.get(s.id);
      if (!tg) continue;
      s.x += (tg.x - s.x) * k;
      s.y += (tg.y - s.y) * k;
    }
    if (room.running) M.S.t += dt;
    for (const L of M.S.lamps) {
      const d = ((L.target - L.angle + 540) % 360) - 180;
      const step = 90 * dt;
      L.angle = Math.abs(d) <= step ? L.target : (L.angle + Math.sign(d) * step + 360) % 360;
    }
    void wall;
  }

  function onMessage(data, from, at) {
    if (!data || typeof data !== 'object' || typeof data.t !== 'string') return;
    const fromId = from && typeof from.id === 'string' ? from.id : '';
    if (data.t === 'cmd') {
      if (!isHost() || !S.N) return;
      if (!fromId || !room.isParticipant(fromId)) return;
      if (!validCommand(data.cmd)) return;
      const cmd = data.cmd;
      const lockedBy = lockOwner(cmd.id, fromId);
      if (lockedBy && ['move', 'rotate', 'sell'].includes(cmd.op)) {
        room.send({ t: 'refused', seq: finite(data.seq, 0), reason: 'locked', op: cmd.op }, { to: fromId });
        return;
      }
      const res = S.N.command(fromId, cmd);
      if (!res.ok) room.send({ t: 'refused', seq: finite(data.seq, 0), reason: String(res.reason || '').slice(0, 16), op: cmd.op }, { to: fromId });
      return;
    }
    if (fromId !== room.host) {
      if (data.t === 'ping') addPing(data, fromId);
      return;
    }
    // From the host.
    if (data.t === 'snap') {
      if (isHost()) return;
      if (!S.M && playing()) S.M = buildMirror();
      if (!S.M) return;
      const seq = finite(data.seq, 0);
      if (seq < S.lastSnapSeq && S.lastSnapSeq - seq < 1000) return; // stale, out of order
      S.lastSnapSeq = seq;
      const before = new Map(S.M.S.shades.map((s) => [s.id, { x: s.x, y: s.y }]));
      applySnapshot(S.M, data);
      S.shadeLerp.clear();
      for (const s of S.M.S.shades) {
        S.shadeLerp.set(s.id, { x: s.x, y: s.y });
        const b = before.get(s.id);
        if (b) {
          s.x = b.x;
          s.y = b.y;
        }
      }
      void at;
    } else if (data.t === 'ev') {
      if (isHost() || !Array.isArray(data.list)) return;
      for (const e of data.list.slice(0, 60)) if (validEvent(e)) hooks.onEvent?.(e, false);
    } else if (data.t === 'refused') {
      if (typeof data.reason === 'string') hooks.onRefuse?.(data.reason.slice(0, 16), typeof data.op === 'string' ? data.op.slice(0, 12) : '');
    } else if (data.t === 'ping') addPing(data, fromId);
  }

  function addPing(data, fromId) {
    const x = finite(data.x);
    const y = finite(data.y);
    if (Math.abs(x) > 5000 || Math.abs(y) > 5000) return;
    S.pings.push({ x, y, age: 0, colour: colourOf(fromId), from: fromId });
    if (S.pings.length > 12) S.pings.shift();
    hooks.onEvent?.({ k: 'ping', x, y }, false);
  }

  /** Who holds a piece right now (another connected player's grab in presence, fresher than LOCK_MS). */
  function lockOwner(pieceId, exceptId) {
    if (!pieceId) return null;
    const now = platform.now();
    for (const p of room.players.values()) {
      if (p.id === exceptId || p.connected === false) continue;
      const pr = p.presence;
      if (pr && pr.grab === pieceId && now - finite(pr.grabAt) < LOCK_MS) return p.id;
    }
    return null;
  }

  function locks() {
    const m = new Map();
    const now = platform.now();
    for (const p of room.players.values()) {
      if (p.id === me.id || p.connected === false) continue;
      const pr = p.presence;
      if (pr && pr.grab && now - finite(pr.grabAt) < LOCK_MS) m.set(pr.grab, colourOf(p.id));
    }
    return m;
  }

  function cursors() {
    const out = [];
    for (const p of room.players.values()) {
      if (p.id === me.id || p.connected === false) continue;
      const pr = room.presenceAt ? room.presenceAt(p.id) : p.presence;
      if (!pr || !Number.isFinite(pr.cx) || !Number.isFinite(pr.cy) || !pr.onBoard) continue;
      out.push({ x: clamp(pr.cx, -500, 3000), y: clamp(pr.cy, -500, 3000), colour: colourOf(p.id), name: cleanName(p.name) });
    }
    return out;
  }

  // ---- presence ------------------------------------------------------------------------------------------
  const presence = { role: '', grab: 0, grabAt: 0, cx: 0, cy: 0, onBoard: false, scr: 'lobby' };
  let presenceDirty = true;
  function setPresence(patch) {
    Object.assign(presence, patch);
    presenceDirty = true;
  }
  function flushPresence() {
    if (!presenceDirty) return;
    presenceDirty = false;
    try {
      room.setPresence({ ...presence });
    } catch {}
  }

  // ---- commands from this page -----------------------------------------------------------------------------
  function command(cmd) {
    if (!validCommand(cmd)) return;
    if (!participant() && room.kind !== 'solo') return;
    if (isHost()) {
      if (!S.N) return;
      const res = S.N.command(me.id, cmd);
      if (!res.ok && res.reason && res.reason !== 'phase') hooks.onRefuse?.(res.reason, cmd.op);
      return;
    }
    S.seq++;
    room.send({ t: 'cmd', seq: S.seq, cmd }, { to: room.host });
  }

  let lastLampSend = 0;
  function lamp(i, angle) {
    const now = performance.now();
    if (S.M) {
      const L = S.M.S.lamps[i];
      if (L) L.target = angle;
    }
    if (now - lastLampSend < 100 && !isHost()) return;
    lastLampSend = now;
    command({ op: 'lamp', i, angle });
  }

  // ---- room events ----------------------------------------------------------------------------------------
  room.on('matchstart', () => {
    S.nightEndTimer = 0;
    S.evBuf = [];
    S.shadeLerp.clear();
    S.lastSnapSeq = -1;
    if (isHost()) hostStartNight();
    else {
      S.M = buildMirror();
      if (S.M) hooks.onNightStart?.(S.M, false);
    }
    setPresence({ scr: room.spectating ? 'watch' : 'play' });
  });
  room.on('matchend', () => {
    if (S.nightEndTimer) clearTimeout(S.nightEndTimer);
    S.nightEndTimer = 0;
    S.N = null;
    S.M = null;
    S.shadeLerp.clear();
    setPresence({ scr: 'lobby', grab: 0 });
    if (isHost()) {
      // A match the room ended for us (everyone away): close the night as lost-nothing: the run goes on.
      if (S.R && S.R.phase === 'night') {
        S.R.phase = 'dusk';
        publishRun();
      }
    }
    hooks.onLobby?.();
  });
  room.on('host', () => {
    const wasHost = S.lastHostId === me.id;
    S.lastHostId = room.host;
    if (isHost() && playing() && !S.N) adopt();
    else if (!isHost() && wasHost) {
      S.N = null;
      S.M = playing() ? buildMirror() : null;
    }
    if (isHost() && !playing() && !S.R) S.R = runFromState();
    hooks.onHost?.();
  });
  room.on('reconnect', () => {
    if (isHost() && playing() && !S.N) adopt();
  });
  room.on('message', onMessage);
  room.on('state', (key) => {
    if (key === 'run') hooks.onRun?.(runFromState());
    if (key === 'pieces' && S.M && !isHost()) S.M.importPieces(room.state.pieces);
    if (key === 'night' && S.M && !isHost() && room.state.night && room.state.night.mid === room.match.id) {
      S.base = finite(room.state.night.base, S.base);
    }
  });
  room.on('close', (reason) => hooks.onClose?.(reason));
  room.on('join', (p) => hooks.onRoster?.(p));
  room.on('leave', (p) => hooks.onRoster?.(p));
  room.on('rename', (p) => hooks.onRoster?.(p));
  room.on('ready', () => hooks.onRoster?.());
  room.on('away', () => hooks.onRoster?.());
  room.on('back', () => hooks.onRoster?.());
  room.on('starting', () => {
    // Friends may drop in during a night (they watch, then take a seat between waves): the host keeps the door open.
    if (!isHost()) return;
    try {
      room.setOpen?.(true);
    } catch {}
  });

  /** One call per frame. */
  function update(wall, dt) {
    if (playing()) {
      if (isHost()) {
        if (!S.N) adopt() || hostStartNight();
        hostTick(wall);
      } else {
        if (S.N) S.N = null;
        mirrorTick(wall, dt);
      }
    } else if (S.N || S.M) {
      S.N = null;
      S.M = null;
    }
    for (let i = S.pings.length - 1; i >= 0; i--) {
      S.pings[i].age += dt;
      if (S.pings[i].age > 2) S.pings.splice(i, 1);
    }
    flushPresence();
  }

  /** The night to draw (the host's own, or the mirror). */
  const night = () => S.N || S.M;

  /** A trace for drawing: the host's last trace, or one computed from the mirror. */
  function segments() {
    const N = night();
    if (!N) return [];
    if (S.N && S.N.S.trace) return S.N.S.trace.segments;
    const zones = { glooms: [], mimics: [], shadows: N.S.shadows, bands: N.S.bands };
    for (const s of N.S.shades) {
      if (s.state === 'dead' || s.state === 'hit') continue;
      if (s.type === 'gloom') zones.glooms.push({ id: s.id, x: s.x, y: s.y, r: 96, factor: 0.4 });
      else if (s.type === 'mimic') zones.mimics.push({ id: s.id, x: s.x, y: s.y, r: s.r, hx: s.hx, hy: s.hy });
    }
    const tr = traceBeams({ board: N.board, pieces: N.S.pieces, lamps: N.S.lamps, t: N.S.t, mods: N.mods, zones });
    N.S.trace = tr;
    return tr.segments;
  }

  async function loadSavedRun() {
    try {
      const raw = await platform.save.get(RUN_KEY);
      const R = raw ? parseRun(raw) : null;
      S.savedRun = R && R.phase !== 'lost' && R.phase !== 'won' ? R : null;
    } catch {
      S.savedRun = null;
    }
    return S.savedRun;
  }

  return {
    S,
    room,
    me,
    isHost,
    playing,
    participant,
    night,
    segments,
    update,
    command,
    lamp,
    currentRun,
    newRun,
    continueRun,
    abandonRun,
    loadSavedRun,
    draft,
    fate,
    endless,
    locks,
    cursors,
    colourOf,
    setPresence,
    presence,
    get pings() {
      return S.pings;
    },
    ping(x, y) {
      if (room.kind === 'solo') return;
      room.send({ t: 'ping', x: Math.round(x), y: Math.round(y) });
      S.pings.push({ x, y, age: 0, colour: colourOf(me.id), from: me.id });
    },
    grab(id) {
      setPresence({ grab: id, grabAt: platform.now() });
    },
    release() {
      if (presence.grab) setPresence({ grab: 0 });
    },
    cursor(x, y, onBoard = true) {
      setPresence({ cx: Math.round(x), cy: Math.round(y), onBoard });
    },
    setRole(role) {
      setPresence({ role: ROLE_IDS.includes(role) ? role : '' });
    },
    boardOf,
    /** Everyone at the table, for the lobby. */
    roster() {
      const out = [];
      for (const p of room.players.values()) {
        out.push({ id: p.id, name: cleanName(p.name), role: ROLE_IDS.includes(p.presence?.role) ? p.presence.role : '', host: p.id === room.host, me: p.id === me.id, connected: p.connected !== false, ready: !!p.ready, colour: colourOf(p.id) });
      }
      out.sort((a, b) => (b.host - a.host) || a.name.localeCompare(b.name));
      return out;
    },
  };
}
