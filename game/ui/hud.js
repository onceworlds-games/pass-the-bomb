// The HUD: night and wave, the Heart and Dawn meters, Focus, the tray (the deck), abilities, the Wave button and
// the zoom buttons. DOM, so every target is a real button of at least 44 px. Labels, not sentences.

import { pieceIcon } from './cards.js';
import { PIECES } from '../sim/pieces.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function makeHud(root, handlers) {
  root.replaceChildren();
  const top = el('div', 'plate topbar');
  const night = el('div', 'night', 'Night 1');
  const wave = el('div', 'wave', 'Dusk');
  const heartStat = stat('Heart', 'heart');
  const dawnStat = stat('Dawn', 'dawn');
  const focusStat = stat('Focus', 'focus');
  top.append(night, wave, heartStat.box, dawnStat.box, focusStat.box);
  const tray = el('div', 'tray');
  const abilities = el('div', 'abilities');
  const flare = ability('Flare', 'F');
  const dawn = ability('Dawn', 'R');
  const surge = ability('Surge', 'G');
  abilities.append(flare.btn, dawn.btn, surge.btn);
  const waveBtn = el('button', 'brass-btn wavebtn', 'Begin night');
  waveBtn.type = 'button';
  const zoom = el('div', 'zoom');
  const zoomIn = el('button', 'brass-btn quiet', '+');
  const zoomOut = el('button', 'brass-btn quiet', '−');
  zoomIn.type = zoomOut.type = 'button';
  zoomIn.setAttribute('aria-label', 'Zoom in');
  zoomOut.setAttribute('aria-label', 'Zoom out');
  zoom.append(zoomOut, zoomIn);
  const fore = el('div', 'plate fore');
  const foreNote = el('div', 'note', '');
  fore.append(foreNote);
  root.append(top, tray, abilities, waveBtn, zoom, fore);

  flare.btn.addEventListener('click', () => handlers.onAbility('flare'));
  dawn.btn.addEventListener('click', () => handlers.onAbility('dawn'));
  surge.btn.addEventListener('click', () => handlers.onAbility('surge'));
  waveBtn.addEventListener('click', () => handlers.onWave());
  zoomIn.addEventListener('click', () => handlers.onZoom(1));
  zoomOut.addEventListener('click', () => handlers.onZoom(-1));

  const cards = new Map();
  let lastTrayKey = '';

  function stat(label, cls) {
    const box = el('div', 'stat');
    const b = el('b', 'caps', label);
    const meter = el('div', `meter ${cls}`);
    const fill = el('i');
    meter.append(fill);
    box.append(b, meter);
    return { box, b, meter, fill };
  }

  function ability(label, key) {
    const btn = el('button', 'plate ability');
    btn.type = 'button';
    const name = el('span', '', label);
    const k = el('span', 'key', key);
    const cool = el('div', 'cool');
    btn.append(name, k, cool);
    btn.setAttribute('aria-label', label);
    return { btn, name, cool };
  }

  function buildTray(list, brass) {
    tray.replaceChildren();
    cards.clear();
    list.forEach((item, i) => {
      const card = el('button', 'card');
      card.type = 'button';
      card.dataset.type = item.type;
      card.setAttribute('aria-label', `${PIECES[item.type]?.name || item.type}, ${item.count} left`);
      card.title = PIECES[item.type]?.tip || '';
      card.append(pieceIcon(item.type, 56, { brass }));
      const count = el('span', 'count', String(item.count));
      const key = el('span', 'key', i < 9 ? String(i + 1) : '');
      card.append(count, key);
      card.addEventListener('click', () => handlers.onTray(item.type));
      tray.append(card);
      cards.set(item.type, { card, count });
    });
  }

  function update(v) {
    night.textContent = v.nightLabel;
    wave.textContent = v.waveLabel;
    heartStat.fill.style.width = `${Math.round(100 * Math.max(0, Math.min(1, v.heart)))}%`;
    heartStat.b.textContent = `Heart ${Math.round(v.heartHp)}`;
    dawnStat.fill.style.width = `${Math.round(100 * Math.max(0, Math.min(1, v.dawn)))}%`;
    dawnStat.meter.classList.toggle('ready', v.dawn >= 1);
    dawnStat.b.textContent = v.dawnActive ? 'Dawn ·' : 'Dawn';
    focusStat.fill.style.width = `${Math.round(100 * Math.max(0, Math.min(1, v.focus / Math.max(1, v.focusMax))))}%`;
    focusStat.b.textContent = v.free ? 'Focus ∞' : `Focus ${Math.round(v.focus)}`;
    const key = v.tray.map((t) => `${t.type}:${t.count}`).join(',') + v.brass;
    if (key !== lastTrayKey) {
      if (v.tray.length !== cards.size || v.tray.some((t) => !cards.has(t.type))) buildTray(v.tray, v.brass);
      else for (const t of v.tray) {
        const c = cards.get(t.type);
        c.count.textContent = String(t.count);
        c.card.classList.toggle('empty', t.count <= 0);
      }
      lastTrayKey = key;
    }
    for (const [type, c] of cards) c.card.classList.toggle('selected', type === v.selectedType);
    setAbility(flare, v.flare);
    setAbility(dawn, v.dawnAbility);
    setAbility(surge, v.surge);
    waveBtn.textContent = v.waveButton || '';
    waveBtn.hidden = !v.waveButton;
    waveBtn.disabled = !!v.waveDisabled;
    foreNote.textContent = v.forecast || '';
    fore.hidden = !v.forecast;
    zoom.hidden = !v.zoomable;
  }

  function setAbility(a, state) {
    if (!state) {
      a.btn.hidden = true;
      return;
    }
    a.btn.hidden = false;
    a.btn.disabled = !state.ready;
    a.btn.classList.toggle('ready', !!state.ready);
    a.cool.style.height = `${Math.round(100 * Math.max(0, Math.min(1, state.left ?? 0)))}%`;
  }

  return {
    update,
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    /** Reserved space around the board, for the scene's camera. */
    insets(portrait) {
      return portrait ? { left: 0, top: 64, right: 0, bottom: 160 } : { left: 104, top: 64, right: 90, bottom: 24 };
    },
  };
}

/** One short line at the moment it matters; remembered by the profile so it shows only a few times. */
export function makeHints(node) {
  let timer = 0;
  return {
    show(text, ms = 2600) {
      node.textContent = text;
      node.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(() => (node.hidden = true), ms);
    },
    hide() {
      node.hidden = true;
      clearTimeout(timer);
    },
  };
}
