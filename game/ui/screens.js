// Screens between nights, made of the table's own materials: the title (the table itself, running), the
// Observatory (the lobby: an open logbook with brass index tabs: the table's setup, the almanac, the glass
// cabinet, the records), the dawn (the night written into the ledger, then a draft of three slips or a Fate's
// letter), the end of a run, and the closed-room card. DOM built by hand; every string from another player goes
// through textContent.

import { KITS, KIT_IDS, ROLES, ROLE_IDS, ASCENSIONS, MAX_ASCENSION, unlocks, moonFor, dailyDay, DAILY_MODS, endlessNights } from '../sim/run.js';
import { BOARD_DEFS, BOARD_IDS as BOARD_IDS_ORDER } from '../sim/boards.js';
import { SHADES, SHADE_IDS } from '../sim/shades.js';
import { RELICS } from '../sim/relics.js';
import { FELTS, BRASSES } from '../render/felt.js';
import { pieceIcon, shadeIcon, boardIcon, sealIcon } from './cards.js';
import { cosmeticUnlocks, BEAM_STYLES, HEART_SKINS } from '../profile.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (cls, text, onClick) => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
};
const HUE_WORD = { r: 'red', g: 'green', b: 'blue' };
const TABS = [
  ['table', 'Table'],
  ['almanac', 'Almanac'],
  ['cabinet', 'Cabinet'],
  ['records', 'Records'],
];

export function makeScreens(root) {
  let tab = 'table';
  let current = '';

  /** A page of the logbook: a brass nameplate, optional index tabs, the page itself. */
  function page(name, title, build, tabs = null) {
    const same = current === name;
    const scroller = root.querySelector('.leaf');
    const keep = same && scroller ? scroller.scrollTop : 0;
    current = name;
    root.className = `screen ${name}${same ? ' again' : ''}`;
    root.replaceChildren();
    const book = el('section', 'book');
    const head = el('header', 'book-head');
    head.append(el('h2', 'nameplate', title));
    if (tabs) head.append(tabs);
    book.append(head);
    const leaf = el('div', 'leaf');
    build(leaf);
    book.append(leaf);
    root.append(book);
    root.hidden = false;
    // Redrawn in place (a friend readied, a choice changed): keep the reader where they were.
    if (keep) leaf.scrollTop = keep;
    return book;
  }
  function hide() {
    current = '';
    root.hidden = true;
    root.replaceChildren();
  }
  /** A labelled part of a page. */
  function section(parent, label, cls = '') {
    const s = el('div', `sec ${cls}`.trim());
    if (label) s.append(el('h3', 'sec-label', label));
    parent.append(s);
    return s;
  }
  /** Ledger lines: label, dotted leader, value. */
  function entries(parent, rows) {
    const list = el('dl', 'entries');
    for (const [k, v] of rows) {
      const row = el('div', 'entry');
      row.append(el('dt', '', k), el('dd', '', v));
      list.append(row);
    }
    parent.append(list);
    return list;
  }
  const marg = (text) => el('p', 'marg', text);
  const cue = (text) => {
    const row = el('div', 'go');
    row.append(el('p', 'cue', text));
    return row;
  };

  // ---- title: the table itself, running, behind one button ----------------------------------------------
  function title(onPlay) {
    current = 'title';
    root.className = 'screen title';
    root.replaceChildren();
    root.append(el('h1', 'wordmark', 'Glint'));
    const play = btn('brass-btn big play', 'Play', onPlay);
    root.append(play);
    root.hidden = false;
    try {
      play.focus({ preventScroll: true });
    } catch {}
  }

  // ---- the Observatory ------------------------------------------------------------------------------------
  function observatory(v) {
    const tabs = el('nav', 'index');
    for (const [id, label] of TABS) {
      const b = btn(`index-tab${tab === id ? ' on' : ''}`, label, () => {
        if (tab === id) return;
        tab = id;
        current = '';
        observatory(v);
      });
      b.setAttribute('aria-pressed', tab === id ? 'true' : 'false');
      tabs.append(b);
    }
    page('observatory', 'The Observatory', (p) => {
      if (tab === 'table') tableTab(p, v);
      else if (tab === 'almanac') almanacTab(p, v);
      else if (tab === 'cabinet') cabinetTab(p, v);
      else recordsTab(p, v);
    }, tabs);
  }

  function roster(p, v) {
    const s = section(p, 'At the table', 'roster');
    const list = el('div', 'opticians');
    for (const pl of v.roster) {
      const row = el('div', `optician${pl.connected ? '' : ' away'}${pl.me ? ' me' : ''}`);
      const face = el('div', 'face');
      face.style.setProperty('--cursor', pl.colour);
      const url = v.avatars.get(pl.id);
      if (url) {
        const img = el('img');
        img.alt = '';
        img.crossOrigin = 'anonymous';
        img.src = url;
        face.append(img);
      }
      row.append(face);
      const col = el('div', 'who');
      const name = el('div', 'name', pl.name);
      if (pl.me) name.append(el('span', 'you', 'you'));
      col.append(name);
      const bits = [];
      if (pl.host) bits.push('Host');
      bits.push(pl.role ? ROLES[pl.role].name : 'Optician');
      if (!pl.connected) bits.push('away');
      else if (pl.ready) bits.push('ready');
      col.append(el('div', 'role', bits.join(' · ')));
      row.append(col);
      list.append(row);
    }
    if (v.roster.length < 4 && v.canInvite) {
      const seat = btn('optician seat', '', v.onInvite);
      seat.append(el('div', 'face empty'), el('div', 'name', 'Invite'));
      list.append(seat);
    }
    s.append(list);
    // Your role: every Optician brings one.
    const roles = el('div', 'tokens');
    for (const id of ROLE_IDS) {
      const on = v.myRole === id;
      const b = btn(`token${on ? ' on' : ''}`, '', () => v.onRole(id));
      b.append(el('span', 'token-name', ROLES[id].name), el('span', 'token-text', ROLES[id].text));
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      roles.append(b);
    }
    section(p, 'Your role').append(roles);
  }

  function tableTab(p, v) {
    const R = v.run;
    const un = unlocks(v.profile);
    roster(p, v);
    if (R && R.phase !== 'lost' && R.phase !== 'won') {
      // A run in progress: its page of the ledger.
      const s = section(p, `${KITS[R.kit]?.name || 'Observer'} · ${BOARD_DEFS[R.boardId]?.name || ''}${R.ascension ? ` · Longer Dusk ${R.ascension}` : ''}${R.daily != null ? ' · Daily' : ''}`);
      entries(s, [
        ['Night', `${R.night} of 12`],
        ['Heart', `${R.heart.hp} / ${R.heart.max}`],
        ['Score', String(R.score)],
        ['Glass', String(Object.values(R.deck).reduce((a, b) => a + b, 0))],
      ]);
      s.append(marg(nightNote(R, v)));
      if (R.relics.length) s.append(el('p', 'relics', R.relics.map((id) => RELICS[id]?.name).filter(Boolean).join(' · ')));
      if (v.isHost) {
        const row = el('div', 'go');
        if (v.standalone) row.append(btn('brass-btn big', `Night ${R.night}`, v.onStart));
        else row.append(el('p', 'cue', 'Start below'));
        row.append(twoTaps('Abandon', 'Abandon the run?', v.onAbandon));
        p.append(row);
      } else p.append(cue('Ready below'));
      return;
    }
    if (!v.isHost) {
      const s = section(p, 'The host sets the table');
      const r = v.hostSetup;
      if (r) entries(s, [['Kit', KITS[r.kit]?.name || 'Observer'], ['Board', BOARD_DEFS[r.boardId]?.name || 'Octagon'], ...(r.ascension ? [['Longer Dusk', String(r.ascension)]] : []), ...(r.daily != null ? [['Daily Dusk', 'On']] : [])]);
      p.append(cue('Ready below'));
      return;
    }
    if (v.savedRun) {
      const row = el('div', 'go');
      row.append(btn('brass-btn', `Continue night ${v.savedRun.night}`, v.onContinue));
      section(p, 'Unfinished').append(row);
    }
    // Kit: the glass you start with, shown as the glass itself.
    const kits = el('div', 'slips');
    for (const id of KIT_IDS) {
      const ok = un.kits.includes(id);
      const on = v.setup.kit === id;
      const b = btn(`slip${on ? ' on' : ''}${ok ? '' : ' locked'}`, '', () => ok && v.onSetup({ kit: id }));
      b.disabled = !ok;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.append(el('span', 'slip-name', KITS[id].name));
      const glass = el('span', 'slip-glass');
      if (ok) {
        for (const [type, n] of Object.entries(KITS[id].deck)) {
          const g = el('span', 'glass');
          g.append(pieceIcon(type, 30, { brass: v.profile.cosmetics.brass }));
          if (n > 1) g.append(el('b', '', `×${n}`));
          glass.append(g);
        }
      }
      b.append(glass);
      b.append(el('span', 'slip-text', ok ? kitLine(id) : lockText(KITS[id].unlock)));
      kits.append(b);
    }
    section(p, 'Kit').append(kits);
    // Board: an engraved plan of each table.
    const boards = el('div', 'plans');
    for (const id of BOARD_IDS_ORDER) {
      const ok = un.boards.includes(id);
      const on = v.setup.boardId === id;
      const b = btn(`plan${on ? ' on' : ''}${ok ? '' : ' locked'}`, '', () => ok && v.onSetup({ boardId: id }));
      b.disabled = !ok;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.append(boardIcon(id), el('span', 'plan-name', BOARD_DEFS[id].name));
      if (!ok) b.append(el('span', 'plan-lock', lockText(BOARD_DEFS[id].unlock)));
      boards.append(b);
    }
    section(p, 'Board').append(boards);
    if (un.ascension > 0) {
      const s = section(p, 'Longer Dusk');
      const steps = el('div', 'steps');
      for (let a = 0; a <= MAX_ASCENSION; a++) {
        const on = v.setup.ascension === a;
        const b = btn(`step${on ? ' on' : ''}`, a === 0 ? 'Off' : String(a), () => a <= un.ascension && v.onSetup({ ascension: a }));
        b.disabled = a > un.ascension;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        steps.append(b);
      }
      s.append(steps);
      if (v.setup.ascension > 0) s.append(marg(ASCENSIONS.slice(0, v.setup.ascension).join(' ')));
    }
    const dailyOn = v.setup.daily != null;
    const d = btn(`daily${dailyOn ? ' on' : ''}`, '', () => v.onSetup({ daily: dailyOn ? null : dailyDay(v.now) }));
    d.setAttribute('aria-pressed', dailyOn ? 'true' : 'false');
    d.append(el('span', 'daily-mark', dailyOn ? 'On' : 'Off'));
    const mods = (dailyOn ? v.dailyMods : []).map((id) => DAILY_MODS[id]?.name).filter(Boolean);
    d.append(el('span', 'daily-text', dailyOn ? `${mods.join(' · ')}${v.profile.daily.day === dailyDay(v.now) && v.profile.daily.score ? ` · best ${v.profile.daily.score}` : ''}` : "Today's seed, the same for everyone"));
    section(p, 'Daily Dusk').append(d);
    if (v.standalone) {
      const go = el('div', 'go');
      go.append(btn('brass-btn big', 'Night 1', v.onStart));
      p.append(go);
    } else p.append(cue('Start below'));
  }

  function kitLine(id) {
    return { observer: 'Balanced.', smith: 'Focus costs less; selling pays back.', alchemist: 'Colour burns harder.', watchman: 'Two Lamps, less glass.' }[id] || '';
  }

  function nightNote(R, v) {
    const moon = moonFor(R);
    const fc = v.forecastFor ? v.forecastFor(R) : null;
    let line = `Night ${R.night}. ${moon.name}.`;
    if (fc && fc.types.length) {
      const names = fc.types.slice(0, 3).map((t) => SHADES[t]?.name).filter(Boolean);
      line += ` ${names.join(', ')} from the ${fc.arcs.map((a) => v.arcName(R.boardId, a)).join(' and ')}.`;
      if (fc.hues.length) line += ` They want ${fc.hues.map((h) => HUE_WORD[h]).join(' and ')}.`;
      if (fc.boss) line += ` ${SHADES[fc.boss].name} is coming.`;
    }
    return line;
  }

  function lockText(u) {
    return { night4: 'Reach night 4', night8: 'Reach night 8', umbra: 'Put Umbra down', night6: 'Reach night 6', win: 'Finish a run', 'cross-win': 'Win on the Cross' }[u] || '';
  }

  function almanacTab(p, v) {
    const ids = SHADE_IDS.filter((id) => id !== 'half');
    const met = ids.filter((id) => v.profile.almanac[id]?.met).length;
    const s = section(p, `Shades met · ${met} of ${ids.length}`);
    const grid = el('div', 'almanac');
    for (const id of ids) {
      const def = SHADES[id];
      const a = v.profile.almanac[id];
      const entry = el('article', `alm${a?.met ? '' : ' unknown'}`);
      entry.append(shadeIcon(id, 56, def.cls === 'plain' ? 'w' : 'r'));
      const col = el('div', 'alm-text');
      col.append(el('h4', '', a?.met ? def.name : 'Unmet'));
      if (a?.met) col.append(el('p', 'marg', def.note), el('span', 'tally', `Burned ${a.killed}`));
      entry.append(col);
      grid.append(entry);
    }
    s.append(grid);
  }

  function cabinetTab(p, v) {
    const un = cosmeticUnlocks(v.profile);
    const cos = v.profile.cosmetics;
    const LOCK = {
      felt: { oxblood: 'Night 4', navy: 'A finished run', slate: 'Night 8' },
      brass: { silver: '500 burned', gunmetal: 'Two runs' },
      beam: { thread: 'Night 6', ember: 'The Lens-Eater' },
      heart: { ember: 'Umbra', moon: 'Three in Endless' },
    };
    const shelf = (label, ids, kind, colourOf, names) => {
      const row = el('div', 'swatches');
      for (const id of ids) {
        const ok = un[kind][id];
        const on = cos[kind] === id;
        const b = btn(`swatch${on ? ' on' : ''}${ok ? '' : ' locked'}`, '', () => ok && v.onCosmetic(kind, id));
        b.disabled = !ok;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        const chip = el('span', 'chip');
        chip.style.background = colourOf(id);
        b.append(chip, el('span', 'swatch-name', names(id)));
        if (!ok) b.append(el('span', 'swatch-lock', LOCK[kind][id] || ''));
        row.append(b);
      }
      section(p, label).append(row);
    };
    shelf('Felt', Object.keys(FELTS), 'felt', (id) => `linear-gradient(135deg, ${FELTS[id].lit}, ${FELTS[id].base})`, (id) => FELTS[id].name);
    shelf('Brass', Object.keys(BRASSES), 'brass', (id) => `linear-gradient(135deg, ${BRASSES[id].hi}, ${BRASSES[id].mid} 55%, ${BRASSES[id].lo})`, (id) => BRASSES[id].name);
    shelf('Beam', BEAM_STYLES, 'beam', (id) => ({ classic: 'linear-gradient(90deg,#3a2416,#fff4d6 50%,#3a2416)', thread: 'linear-gradient(90deg,#0b1020,#eef6ff 50%,#0b1020)', ember: 'linear-gradient(90deg,#20120a,#ffc89a 50%,#20120a)' })[id], (id) => ({ classic: 'Lamplight', thread: 'Silver thread', ember: 'Ember' })[id]);
    shelf('Heart', HEART_SKINS, 'heart', (id) => ({ glass: 'radial-gradient(circle at 35% 35%, #fff, #c9a04a)', ember: 'radial-gradient(circle at 35% 35%, #fff, #ff5d4d)', moon: 'radial-gradient(circle at 35% 35%, #fff, #5db4ff)' })[id], (id) => ({ glass: 'Glass', ember: 'Ember', moon: 'Moon' })[id]);
  }

  function recordsTab(p, v) {
    const pr = v.profile;
    entries(section(p, 'Records'), [
      ['Runs', String(pr.runs)],
      ['Finished', String(pr.wins)],
      ['Best score', String(pr.bestScore)],
      ['Best night', String(pr.bestNight)],
      ['Endless nights', String(pr.bestEndless)],
      ['Shades burned', String(pr.kills)],
      ['Nights played', String(pr.nightsPlayed)],
    ]);
  }

  // ---- dawn: the night written into the ledger, then a draft or a Fate --------------------------------------
  function dawn(v) {
    const R = v.run;
    page('dawn', `Dawn after night ${R.night}`, (p) => {
      const last = R.ledger[R.ledger.length - 1];
      if (last) {
        const s = section(p, '');
        entries(s, [
          ['Burned', String(last.kills)],
          ['Score', `+${last.score}`],
          ['Heart', `${R.heart.hp} / ${R.heart.max}`],
          ['Glass cracked', String(last.cracks)],
        ]);
        if (v.onReplay) s.append(watchAgain(v.onReplay));
      }
      if (R.draft && R.draft.taken < 0) {
        const d = section(p, v.isHost ? 'Take one' : 'The host takes one', 'draft');
        const row = el('div', 'slips draft-slips');
        R.draft.options.forEach((o, i) => {
          const b = btn('slip draft-slip', '', () => v.isHost && v.onDraft(i));
          b.disabled = !v.isHost;
          const icon = el('span', 'slip-icon');
          icon.append(o.kind === 'piece' ? pieceIcon(o.id, 52, { brass: v.brass }) : sealIcon(o.kind, 52));
          b.append(icon);
          b.append(el('span', 'slip-kind', o.kind === 'piece' ? 'Glass' : o.kind === 'relic' ? 'Relic' : 'Upgrade'));
          b.append(el('span', 'slip-name', o.kind === 'piece' ? `${o.name}${o.n > 1 ? ` ×${o.n}` : ''}` : o.name));
          b.append(el('span', 'slip-text', o.text));
          row.append(b);
        });
        d.append(row);
      } else if (R.fate && R.fate.taken < 0) {
        const f = section(p, 'A Fate', 'fate');
        const letter = el('div', 'letter');
        letter.append(el('h4', '', R.fate.name), el('p', 'marg', R.fate.text));
        f.append(letter);
        const row = el('div', 'fate-choices');
        const take = btn('brass-btn', 'Take it', () => v.isHost && v.onFate(true));
        const walk = btn('brass-btn quiet', 'Walk on', () => v.isHost && v.onFate(false));
        take.disabled = walk.disabled = !v.isHost;
        const tWrap = el('div', 'fate-choice');
        tWrap.append(take, el('span', 'price', R.fate.take));
        const wWrap = el('div', 'fate-choice');
        wWrap.append(walk, el('span', 'price', 'Nothing gained, nothing owed'));
        row.append(tWrap, wWrap);
        f.append(row);
        if (!v.isHost) f.append(el('p', 'cue', 'The host decides'));
      }
    });
  }

  // ---- the end of a run ---------------------------------------------------------------------------------
  function ended(v) {
    const R = v.run;
    const won = R.phase === 'won';
    page('ended', won ? 'The Long Dusk is done' : `Night ${R.night} took the Heart`, (p) => {
      const s = section(p, `${KITS[R.kit]?.name || ''} · ${BOARD_DEFS[R.boardId]?.name || ''}`);
      entries(s, [
        ['Score', String(R.score)],
        ['Nights', String(R.ledger.filter((e) => e.won).length)],
        ['Burned', String(R.ledger.reduce((a, e) => a + e.kills, 0))],
        ['Relics', String(R.relics.length)],
        ...(R.endless ? [['Endless', String(endlessNights(R))]] : []),
      ]);
      // The run, night by night.
      const table = el('table', 'nights');
      const head = el('tr');
      for (const h of ['Night', 'Burned', 'Score', 'Heart']) head.append(el('th', '', h));
      table.append(head);
      for (const e of R.ledger.slice(-14)) {
        const tr = el('tr', e.won ? '' : 'lost');
        tr.append(el('td', '', String(e.night)), el('td', '', String(e.kills)), el('td', '', String(e.score)), el('td', '', e.won ? String(e.heart) : 'lost'));
        table.append(tr);
      }
      s.append(table);
      const last = R.ledger[R.ledger.length - 1];
      if (!won && last && last.lostBy) s.append(marg(lossNote(last.lostBy, R)));
      if (v.onReplay) s.append(watchAgain(v.onReplay));
      if (won) s.append(marg('Twelve nights. The table is yours; the dark keeps coming if you let it.'));
      if (v.isHost) {
        const row = el('div', 'go');
        if (won && !R.endless) row.append(btn('brass-btn big', 'Endless', v.onEndless));
        row.append(btn(won && !R.endless ? 'brass-btn quiet' : 'brass-btn big', 'New run', v.onNewRun));
        p.append(row);
      } else p.append(cue('The host decides'));
    });
  }

  function lossNote(type, R) {
    const def = SHADES[type];
    const name = def ? def.name : 'The dark';
    const tips = {
      veil: 'Veils barely feel white light. A prism or a filter gives them the colour they want.',
      creeper: 'Creepers are slow and thick: a focus, or their own colour, cuts them.',
      eater: 'Eaters stop at glass. Burn them on the way in, or they take the mirror.',
      mimic: 'Mimics throw light back. A lens behind them finds the glass skin.',
      gloom: 'Glooms carry dark with them. Light them from several sides.',
      gnat: 'Gnats shred under wide light: a concave lens, not a point.',
      burrower: 'Burrowers come up inside the lines. Keep a beam near the Heart.',
      moth: 'Moths climb the brightest beam to the Lamp.',
      twain: 'Twains die in two. Finish both.',
      wisp: 'Wisps are frail; it is their number. Light every lane they use.',
      umbra: 'Umbra blocks beams with shadow and changes colour as it weakens.',
      lenseater: 'Only the open eye burns. Wait for it.',
      longdusk: 'It sits at the rim and darkens the table. Give it its colour, up close.',
    };
    return `${name} ended it on night ${R.night}. ${tips[type] || ''}`;
  }

  // ---- closed room ------------------------------------------------------------------------------------------
  function closed(reason, onAgain) {
    const text = reason === 'kicked' ? 'You were removed' : reason === 'replaced' ? 'Playing in another tab' : 'Connection lost';
    const label = reason === 'kicked' ? 'Play' : reason === 'replaced' ? 'Play here' : 'Rejoin';
    page('closed', text, (p) => {
      const row = el('div', 'go');
      row.append(btn('brass-btn big', label, onAgain));
      p.append(row);
    });
  }

  /** A button that asks once more before it does something that cannot be taken back. */
  function twoTaps(label, ask, onSure) {
    const b = btn('brass-btn quiet', label);
    let armed = 0;
    b.addEventListener('click', () => {
      if (armed) {
        clearTimeout(armed);
        armed = 0;
        onSure();
        return;
      }
      b.textContent = ask;
      b.classList.add('ask');
      armed = setTimeout(() => {
        armed = 0;
        b.textContent = label;
        b.classList.remove('ask');
      }, 3000);
    });
    return b;
  }

  /** The button that plays the night's last seconds again. */
  function watchAgain(onReplay) {
    const row = el('div', 'go');
    row.append(btn('brass-btn quiet', 'Watch again', onReplay));
    return row;
  }

  /** Over a replay: one small plate with what it is and the way back. */
  function replay(onBack) {
    current = 'replay';
    root.className = 'screen replay';
    root.replaceChildren();
    const plate = el('div', 'plate replay-plate');
    plate.append(el('span', 'replay-label', 'Half speed'), btn('brass-btn quiet', 'Back', onBack));
    root.append(plate);
    root.hidden = false;
  }

  /** Someone who arrived mid-night: a small plate at the top, nothing else over the table. */
  function watching(v) {
    current = 'watching';
    root.className = 'screen watching';
    root.replaceChildren();
    root.append(el('div', 'plate watch-note', `Night ${v.night} · a seat opens between waves`));
    root.hidden = false;
  }

  return {
    title,
    observatory,
    dawn,
    ended,
    closed,
    watching,
    replay,
    hide,
    get current() {
      return current;
    },
  };
}
