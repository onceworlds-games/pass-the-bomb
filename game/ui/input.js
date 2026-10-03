// Pointer, touch and keyboard on the table: place from the tray, select, drag to move, the rotation dial with
// detents, drag the Lamp's handle, sell, pan and zoom. One pointer at a time; a second finger is ignored.

import { CELL, cellKind, OPEN } from '../sim/boards.js';
import { snapDeg, normDeg, angleOf, deltaDeg } from '../sim/geom.js';
import { oriented, PIECES } from '../sim/pieces.js';
import { PALETTE } from '../render/felt.js';

const DIAL_R = 58; // reference px: the dial ring around a selected piece
const HANDLE_R = 17;
const SELL_R = 16;

export function makeInput(canvas, scene, api) {
  const st = {
    sel: 0, // selected placed piece id
    trayType: null,
    hover: null,
    ghostAngle: 0,
    pointerId: null,
    down: null, // { x, y, cell, pieceId, mode: 'piece'|'dial'|'lamp'|'pan'|'empty', moved, t }
    dragCell: null,
    dialAngle: null,
    lampIndex: -1,
    showEnergy: false,
    fine: false,
    lastCursorSend: 0,
    longPress: 0,
  };

  const now = () => performance.now();
  const pieceAt = (cell) => (cell ? api.pieces().find((p) => p.c === cell.c && p.r === cell.r) : null);
  const pieceById = (id) => api.pieces().find((p) => p.id === id);
  const centre = (p) => ({ x: (p.c + 0.5) * CELL, y: (p.r + 0.5) * CELL });

  /** The dial keeps a screen size (a 64 px ring, 44 px targets) however far the table is zoomed out. */
  function dialSizes() {
    const k = 1 / Math.max(0.2, scene.view.scale);
    return { R: Math.max(DIAL_R, 66 * k), H: Math.max(HANDLE_R, 22 * k), S: Math.max(SELL_R, 22 * k) };
  }

  function dialGeometry(p) {
    const c = centre(p);
    const a = normDeg(p.angle);
    const rad = (a * Math.PI) / 180;
    const { R } = dialSizes();
    return { cx: c.x, cy: c.y, hx: c.x + Math.cos(rad) * R, hy: c.y + Math.sin(rad) * R, sx: c.x + R * 0.95, sy: c.y - R * 0.95, R };
  }

  function hitDial(w, p) {
    if (!p) return null;
    const g = dialGeometry(p);
    const { H, S } = dialSizes();
    if (Math.hypot(w.x - g.sx, w.y - g.sy) <= S + 4) return 'sell';
    if (!oriented(p.type) && p.type !== 'combiner' && p.type !== 'crystal' && p.type !== 'shutter') return null;
    if (Math.hypot(w.x - g.hx, w.y - g.hy) <= H + 6) return 'handle';
    const d = Math.hypot(w.x - g.cx, w.y - g.cy);
    if (d > g.R - H && d < g.R + H) return 'ring';
    return null;
  }

  function lampAt(w) {
    const lamps = api.lamps();
    for (let i = 0; i < lamps.length; i++) {
      const L = lamps[i];
      if (Math.hypot(w.x - L.x, w.y - L.y) <= L.radius + 22) return i;
    }
    return -1;
  }

  function onDown(e) {
    if (st.pointerId !== null) return; // a second finger: ignored
    if (e.button === 2) return;
    st.pointerId = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    const { x, y } = local(e);
    const w = scene.toWorld(x, y);
    const cell = scene.cellAt(x, y);
    const selected = st.sel ? pieceById(st.sel) : null;
    const down = { x, y, w, cell, moved: false, t: now(), mode: 'empty', pieceId: 0 };
    const dialHit = hitDial(w, selected);
    if (dialHit === 'sell') {
      down.mode = 'sell';
    } else if (dialHit) {
      down.mode = 'dial';
      down.pieceId = selected.id;
      st.dialAngle = selected.angle;
      api.grab(selected.id);
    } else {
      const li = lampAt(w);
      if (li >= 0) {
        down.mode = 'lamp';
        st.lampIndex = li;
      } else if (st.trayType && cell && cell.open && !pieceAt(cell)) {
        down.mode = 'place';
      } else {
        const p = pieceAt(cell);
        if (p) {
          down.mode = 'piece';
          down.pieceId = p.id;
        } else down.mode = 'empty';
      }
    }
    st.down = down;
    if (e.pointerType === 'touch' && down.mode === 'piece') st.longPress = setTimeout(() => ping(w), 650);
    api.touched();
  }

  function onMove(e) {
    const { x, y } = local(e);
    const w = scene.toWorld(x, y);
    const cell = scene.cellAt(x, y);
    st.hover = cell;
    if (now() - st.lastCursorSend > 100) {
      st.lastCursorSend = now();
      api.cursor(w.x, w.y);
    }
    if (e.pointerId !== st.pointerId || !st.down) return;
    const d = st.down;
    const dist = Math.hypot(x - d.x, y - d.y);
    if (dist > 6) {
      d.moved = true;
      clearTimeout(st.longPress);
    }
    if (d.mode === 'dial') {
      const p = pieceById(d.pieceId);
      if (!p) return;
      const c = centre(p);
      const raw = angleOf(w.x - c.x, w.y - c.y);
      const step = st.fine || e.shiftKey ? 5 : 15;
      const a = snapDeg(raw, step);
      if (st.dialAngle !== a) {
        st.dialAngle = a;
        api.command({ op: 'rotate', id: p.id, angle: a });
        api.sound('tick', a);
      }
    } else if (d.mode === 'lamp') {
      const L = api.lamps()[st.lampIndex];
      if (L) api.lamp(st.lampIndex, snapDeg(angleOf(w.x - L.x, w.y - L.y), st.fine || e.shiftKey ? 5 : 15));
    } else if (d.mode === 'piece' && d.moved) {
      if (!st.dragCell) api.grab(d.pieceId);
      st.dragCell = cell && cell.open ? cell : null;
    } else if (d.mode === 'empty' && d.moved && scene.view.zoom > 1) {
      scene.pan(e.movementX || 0, e.movementY || 0);
    }
  }

  function onUp(e) {
    if (e.pointerId !== st.pointerId) return;
    clearTimeout(st.longPress);
    st.pointerId = null;
    const d = st.down;
    st.down = null;
    if (!d) return;
    const { x, y } = local(e);
    const cell = scene.cellAt(x, y);
    const w = scene.toWorld(x, y);
    if (d.mode === 'place') {
      if (cell && cell.open && !pieceAt(cell) && st.trayType) {
        const type = st.trayType;
        api.command({ op: 'place', type, c: cell.c, r: cell.r, angle: st.ghostAngle });
        if (api.available(type) <= 1) st.trayType = null;
      }
    } else if (d.mode === 'piece') {
      if (d.moved) {
        const p = pieceById(d.pieceId);
        if (p && cell && cell.open && !pieceAt(cell) && (p.c !== cell.c || p.r !== cell.r)) api.command({ op: 'move', id: p.id, c: cell.c, r: cell.r });
        st.sel = d.pieceId;
      } else {
        st.sel = d.pieceId;
        st.trayType = null;
        api.sound('select');
      }
      api.release();
    } else if (d.mode === 'dial') {
      api.release();
    } else if (d.mode === 'sell') {
      sellSelected();
    } else if (d.mode === 'empty' && !d.moved) {
      if (e.altKey) ping(w);
      st.sel = 0;
    }
    st.dragCell = null;
    st.dialAngle = null;
    st.lampIndex = -1;
  }

  function onCancel(e) {
    if (e.pointerId !== st.pointerId) return;
    clearTimeout(st.longPress);
    st.pointerId = null;
    st.down = null;
    st.dragCell = null;
    st.dialAngle = null;
    st.lampIndex = -1;
    api.release();
  }

  function ping(w) {
    api.ping(w.x, w.y);
  }

  function sellSelected() {
    if (!st.sel) return;
    api.command({ op: 'sell', id: st.sel });
    st.sel = 0;
  }

  function rotateSelected(dir, fine) {
    const step = fine ? 5 : 15;
    if (st.sel) {
      const p = pieceById(st.sel);
      if (!p) return;
      api.command({ op: 'rotate', id: p.id, angle: snapDeg(p.angle + dir * step, step) });
      api.sound('tick', p.angle);
    } else if (st.trayType) {
      st.ghostAngle = snapDeg(st.ghostAngle + dir * step, step);
      api.sound('tick', st.ghostAngle);
    }
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey) {
      scene.setZoom(scene.view.zoom * (e.deltaY < 0 ? 1.15 : 0.87), e.clientX, e.clientY);
      return;
    }
    rotateSelected(e.deltaY > 0 ? 1 : -1, e.shiftKey);
  }

  function onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (!api.playing()) return;
    const k = e.key;
    if (k === 'Shift') st.fine = true;
    if (k === 'Alt') {
      st.showEnergy = true;
      e.preventDefault();
    }
    if (/^[1-9]$/.test(k)) {
      const types = api.trayTypes();
      const t = types[Number(k) - 1];
      if (t) selectTray(t);
      e.preventDefault();
    } else if (k === 'q' || k === 'Q') rotateSelected(-1, e.shiftKey);
    else if (k === 'e' || k === 'E') rotateSelected(1, e.shiftKey);
    else if (k === 'x' || k === 'X' || k === 'Delete' || k === 'Backspace') {
      sellSelected();
      e.preventDefault();
    } else if (k === ' ') {
      api.wave();
      e.preventDefault();
    } else if (k === 'f' || k === 'F') api.ability('flare', st.hover);
    else if (k === 'r' || k === 'R') api.ability('dawn');
    else if (k === 'g' || k === 'G') api.ability('surge');
    else if (k === 'Tab') {
      api.cycleLamp();
      e.preventDefault();
    } else if (k === 'Escape') {
      st.sel = 0;
      st.trayType = null;
    } else if (k === '+' || k === '=') scene.setZoom(scene.view.zoom * 1.25);
    else if (k === '-' || k === '_') scene.setZoom(scene.view.zoom / 1.25);
  }

  function onKeyUp(e) {
    if (e.key === 'Shift') st.fine = false;
    if (e.key === 'Alt') st.showEnergy = false;
  }

  function clearAll() {
    st.fine = false;
    st.showEnergy = false;
    st.pointerId = null;
    st.down = null;
    st.dragCell = null;
    st.dialAngle = null;
    st.lampIndex = -1;
    clearTimeout(st.longPress);
    api.release();
  }

  function selectTray(type) {
    if (api.available(type) <= 0) {
      api.sound('refuse');
      return;
    }
    st.trayType = st.trayType === type ? null : type;
    st.sel = 0;
    if (st.trayType) {
      const def = PIECES[type];
      st.ghostAngle = def?.shape === 'segment' ? (type === 'lens' || type === 'concave' ? 90 : 45) : 0;
      api.sound('select');
    }
  }

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', onCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!api.playing()) return;
    const { x, y } = local(e);
    const p = pieceAt(scene.cellAt(x, y));
    if (p) {
      st.sel = p.id;
      sellSelected();
    }
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearAll);
  document.addEventListener('visibilitychange', () => document.hidden && clearAll());

  /** What the scene should show for the player's own intent: the ghost, the selection, the drag. */
  function ghost() {
    if (st.down && st.down.mode === 'piece' && st.down.moved && st.dragCell) {
      const p = pieceById(st.down.pieceId);
      if (p) return { piece: { ...p, c: st.dragCell.c, r: st.dragCell.r, heat: 0, cracked: 0 }, moving: p.id, valid: !pieceAt(st.dragCell) };
    }
    if (st.trayType && st.hover) {
      const valid = st.hover.open && !pieceAt(st.hover);
      return { piece: { id: -1, type: st.trayType, c: st.hover.c, r: st.hover.r, angle: st.ghostAngle, heat: 0, cracked: 0, t0: 0, store: 0, pulseUntil: 0 }, valid };
    }
    return null;
  }

  /** Draws the dial around the selected piece (reference coordinates; the scene's transform is set). */
  function drawOverlay(ctx, t) {
    const p = st.sel ? pieceById(st.sel) : null;
    if (!p) return;
    const g = dialGeometry(p);
    const { R, H, S } = dialSizes();
    const k = R / DIAL_R; // line widths and type grow with the ring so they keep their screen size
    const turnable = oriented(p.type) || p.type === 'combiner' || p.type === 'crystal' || p.type === 'shutter';
    ctx.save();
    ctx.translate(g.cx, g.cy);
    if (turnable) {
      ctx.strokeStyle = 'rgba(240,215,138,0.55)';
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.stroke();
      for (let d = 0; d < 360; d += 15) {
        const rad = (d * Math.PI) / 180;
        const major = d % 45 === 0;
        ctx.strokeStyle = major ? PALETTE.brassHi : 'rgba(240,215,138,0.5)';
        ctx.lineWidth = (major ? 2 : 1) * k;
        const len = (major ? 7 : 4) * k;
        ctx.beginPath();
        ctx.moveTo(Math.cos(rad) * (R - len), Math.sin(rad) * (R - len));
        ctx.lineTo(Math.cos(rad) * (R + len), Math.sin(rad) * (R + len));
        ctx.stroke();
      }
      // The handle.
      ctx.fillStyle = PALETTE.brass;
      ctx.strokeStyle = PALETTE.brassHi;
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.arc(g.hx - g.cx, g.hy - g.cy, H, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2a1a08';
      ctx.font = `600 ${Math.round(15 * k)}px "Cormorant", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(normDeg(p.angle))}°`, g.hx - g.cx, g.hy - g.cy + k);
    }
    // Sell: a small brass button with an X, top right of the ring.
    ctx.fillStyle = '#4a2e1c';
    ctx.strokeStyle = PALETTE.brass;
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.arc(g.sx - g.cx, g.sy - g.cy, S, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = PALETTE.bone;
    ctx.lineWidth = 2.5 * k;
    const x6 = 6 * k;
    ctx.beginPath();
    ctx.moveTo(g.sx - g.cx - x6, g.sy - g.cy - x6);
    ctx.lineTo(g.sx - g.cx + x6, g.sy - g.cy + x6);
    ctx.moveTo(g.sx - g.cx + x6, g.sy - g.cy - x6);
    ctx.lineTo(g.sx - g.cx - x6, g.sy - g.cy + x6);
    ctx.stroke();
    ctx.restore();
    void t;
  }

  return {
    st,
    ghost,
    drawOverlay,
    selectTray,
    clearAll,
    get selected() {
      return st.sel;
    },
    set selected(v) {
      st.sel = v;
    },
    get trayType() {
      return st.trayType;
    },
    get showEnergy() {
      return st.showEnergy;
    },
    deselect() {
      st.sel = 0;
      st.trayType = null;
    },
  };
}

export { deltaDeg, cellKind, OPEN };
