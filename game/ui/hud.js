// The HUD: night and wave, the Heart and Dawn meters, Focus, the tray (the deck), abilities, Undo and the Wave
// button. DOM, so every target is a real button of at least 44 px. Labels, not sentences. Its layout follows the
// shape of the screen (styles.css); insets() measures it so the table fits the space that is left.

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
  const label = el('div', 'label');
  const night = el('div', 'night', 'Night 1');
  const wave = el('div', 'wave', 'Dusk');
  label.append(night, wave);
  const heartStat = stat('Heart', 'heart');
  const dawnStat = stat('Dawn', 'dawn');
  const focusStat = stat('Focus', 'focus');
  top.append(label, heartStat.box, dawnStat.box, focusStat.box);
  const tray = el('div', 'tray');
  const abilities = el('div', 'abilities');
  const flare = ability('Flare', 'F');
  const dawn = ability('Dawn', 'R');
  const surge = ability('Surge', 'G');
  abilities.append(flare.btn, dawn.btn, surge.btn);
  const actions = el('div', 'actions');
  const undoBtn = el('button', 'brass-btn quiet undo', 'Undo');
  undoBtn.type = 'button';
  undoBtn.setAttribute('aria-label', 'Undo (Z)');
  const waveBtn = el('button', 'brass-btn wavebtn', 'Begin night');
  waveBtn.type = 'button';
  actions.append(undoBtn, waveBtn);
  const fore = el('div', 'plate fore');
  const foreNote = el('div', 'note', '');
  fore.append(foreNote);
  root.append(top, tray, abilities, actions, fore);

  flare.btn.addEventListener('click', () => handlers.onAbility('flare'));
  dawn.btn.addEventListener('click', () => handlers.onAbility('dawn'));
  surge.btn.addEventListener('click', () => handlers.onAbility('surge'));
  waveBtn.addEventListener('click', () => handlers.onWave());
  undoBtn.addEventListener('click', () => handlers.onUndo?.());

  const cards = new Map();
  let lastTrayKey = '';

  function stat(label, cls) {
    const box = el('div', `stat ${cls}`);
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
    heartStat.meter.classList.toggle('low', v.heart < 0.3);
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
    if (waveBtn.textContent !== (v.waveButton || '')) waveBtn.textContent = v.waveButton || '';
    waveBtn.hidden = !v.waveButton;
    waveBtn.disabled = !!v.waveDisabled;
    undoBtn.hidden = !v.undo;
    if (foreNote.textContent !== (v.forecast || '')) foreNote.textContent = v.forecast || '';
    fore.hidden = !v.forecast;
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
    /** Which of the three layouts the screen's shape picks (the same queries as styles.css). */
    layout() {
      try {
        if (matchMedia('(max-aspect-ratio: 4/5)').matches) return 'tall';
        if (matchMedia('(max-height: 500px)').matches) return 'short';
      } catch {}
      return 'wide';
    },
    /** Reserved space around the board (css px), measured from the HUD as it is laid out, for the scene's camera. */
    insets() {
      const W = innerWidth;
      const H = innerHeight;
      const r = (node) => node.getBoundingClientRect();
      const mode = this.layout();
      if (root.hidden) return { left: 0, top: 0, right: 0, bottom: 0 };
      const tb = r(top);
      const tr = r(tray);
      const ab = r(abilities);
      const ac = r(actions);
      if (mode === 'tall') return { left: 0, right: 0, top: Math.round(tb.bottom + 4), bottom: Math.round(H - Math.min(tr.top, ab.top) + 2) };
      if (mode === 'short') return { left: Math.round(tr.right), right: Math.round(W - Math.min(tb.left, ab.left, ac.left) + 4), top: 0, bottom: 0 };
      return { left: Math.round(tr.right + 2), right: Math.round(W - ab.left + 6), top: Math.round(tb.bottom + 4), bottom: 20 };
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
