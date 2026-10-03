// Screens between nights: the title, the Observatory (the lobby: run setup, roles, almanac, cosmetics, records),
// the dawn (ledger, draft, Fate), the end of a run, and the closed-room card. DOM built by hand; every string
// from another player goes through textContent.

import { KITS, KIT_IDS, ROLES, ROLE_IDS, ASCENSIONS, MAX_ASCENSION, unlocks, moonFor, dailyDay, DAILY_MODS, endlessNights } from '../sim/run.js';
import { BOARD_DEFS, BOARD_IDS as BOARD_IDS_ORDER } from '../sim/boards.js';
import { SHADES, SHADE_IDS } from '../sim/shades.js';
import { RELICS, UPGRADES } from '../sim/relics.js';
import { PIECES } from '../sim/pieces.js';
import { FELTS, BRASSES } from '../render/felt.js';
import { pieceIcon, shadeIcon } from './cards.js';
import { cosmeticUnlocks, BEAM_STYLES, HEART_SKINS } from '../profile.js';
import { forecast } from '../sim/waves.js';

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

export function makeScreens(root, ctx) {
  let tab = 'table';
  let current = '';

  function show(name, build) {
    current = name;
    root.replaceChildren();
    const panel = el('div', 'plate panel');
    build(panel);
    root.append(panel);
    root.hidden = false;
  }
  function hide() {
    current = '';
    root.hidden = true;
    root.replaceChildren();
  }

  // ---- title -------------------------------------------------------------------------------------------
  function title(onPlay) {
    show('title', (p) => {
      p.classList.add('center');
      p.append(el('h1', '', 'GLINT'));
      const sub = el('div', 'note', 'The sun is gone. You have a lamp, and glass.');
      sub.style.textAlign = 'center';
      p.append(sub);
      const row = el('div', 'row center');
      row.append(btn('brass-btn big', 'Play', onPlay));
      p.append(row);
    });
  }

  // ---- the Observatory ------------------------------------------------------------------------------------
  function observatory(v) {
    show('observatory', (p) => {
      const head = el('div', 'spread');
      head.append(el('h2', '', 'The Observatory'));
      const tabs = el('div', 'tabs');
      for (const [id, label] of [['table', 'Table'], ['almanac', 'Almanac'], ['cosmetics', 'Cosmetics'], ['records', 'Records']]) {
        const b = btn(tab === id ? 'on' : '', label, () => {
          tab = id;
          observatory(v);
        });
        tabs.append(b);
      }
      head.append(tabs);
      p.append(head);
      if (tab === 'table') tableTab(p, v);
      else if (tab === 'almanac') almanacTab(p, v);
      else if (tab === 'cosmetics') cosmeticsTab(p, v);
      else recordsTab(p, v);
    });
  }

  function tableTab(p, v) {
    const R = v.run;
    const un = unlocks(v.profile);
    // Who is here, with roles.
    const players = el('div', 'players');
    for (const pl of v.roster) {
      const box = el('div', `player${pl.connected ? '' : ' away'}`);
      const face = el('div', 'face');
      face.style.background = pl.colour;
      if (v.avatars.get(pl.id)) {
        const img = el('img');
        img.alt = '';
        img.src = v.avatars.get(pl.id);
        img.crossOrigin = 'anonymous';
        box.append(img);
      } else box.append(face);
      const col = el('div');
      col.append(el('div', 'name', pl.me ? `${pl.name} (you)` : pl.name));
      const roleLine = el('div', 'role', (pl.host ? 'Host · ' : '') + (pl.role ? ROLES[pl.role].name : 'Optician') + (pl.ready ? ' · ready' : ''));
      col.append(roleLine);
      box.append(col);
      players.append(box);
    }
    if (v.roster.length < 4 && v.canInvite) players.append(btn('brass-btn quiet', 'Invite', v.onInvite));
    p.append(players);
    // Your role.
    const roleRow = el('div', 'row');
    roleRow.append(el('span', 'caps', 'Your role'));
    const seg = el('div', 'seg');
    seg.append(btn(v.myRole ? '' : 'on', 'None', () => v.onRole('')));
    for (const id of ROLE_IDS) {
      const b = btn(v.myRole === id ? 'on' : '', ROLES[id].name, () => v.onRole(id));
      b.title = ROLES[id].text;
      seg.append(b);
    }
    roleRow.append(seg);
    p.append(roleRow);
    if (v.myRole) p.append(el('div', 'note', ROLES[v.myRole].text));

    if (R && R.phase !== 'lost' && R.phase !== 'won') {
      // A run in progress.
      const box = el('div', 'ledger');
      box.append(cell('Night', String(R.night)), cell('Heart', `${R.heart.hp}/${R.heart.max}`), cell('Score', String(R.score)), cell('Glass', String(Object.values(R.deck).reduce((a, b) => a + b, 0))));
      p.append(box);
      p.append(el('div', 'note', nightNote(R, v)));
      if (R.relics.length) p.append(el('div', 'caps', 'Relics · ' + R.relics.map((id) => RELICS[id]?.name).filter(Boolean).join(' · ')));
      const row = el('div', 'row');
      if (v.isHost) {
        row.append(el('span', 'caps', v.standalone ? '' : 'Start below when all are ready'));
        if (v.standalone) row.append(btn('brass-btn', `Night ${R.night}`, v.onStart));
        row.append(btn('brass-btn quiet', 'Abandon', v.onAbandon));
      } else row.append(el('span', 'caps', 'Ready up below'));
      p.append(row);
      return;
    }
    // Setting up a run (host) or watching the host set one up.
    if (v.isHost) {
      if (v.savedRun) {
        const row = el('div', 'row');
        row.append(btn('brass-btn', `Continue night ${v.savedRun.night}`, v.onContinue));
        p.append(row);
      }
      p.append(el('div', 'caps', 'Kit'));
      const kits = el('div', 'row');
      for (const id of KIT_IDS) {
        const ok = un.kits.includes(id);
        const c = btn(`choice${v.setup.kit === id ? ' on' : ''}${ok ? '' : ' off'}`, '', () => ok && v.onSetup({ kit: id }));
        c.append(el('div', 'name', KITS[id].name));
        c.append(el('div', 'text', ok ? KITS[id].text : lockText(KITS[id].unlock)));
        kits.append(c);
      }
      p.append(kits);
      const boardRow = el('div', 'row');
      boardRow.append(el('span', 'caps', 'Board'));
      const bseg = el('div', 'seg');
      for (const id of BOARD_IDS_ORDER) {
        const ok = un.boards.includes(id);
        const b = btn(v.setup.boardId === id ? 'on' : '', BOARD_DEFS[id].name, () => ok && v.onSetup({ boardId: id }));
        b.disabled = !ok;
        b.title = ok ? '' : lockText(BOARD_DEFS[id].unlock);
        bseg.append(b);
      }
      boardRow.append(bseg);
      p.append(boardRow);
      if (un.ascension > 0) {
        const aRow = el('div', 'row');
        aRow.append(el('span', 'caps', 'Longer Dusk'));
        const aseg = el('div', 'seg');
        for (let a = 0; a <= MAX_ASCENSION; a++) {
          const b = btn(v.setup.ascension === a ? 'on' : '', a === 0 ? 'Off' : String(a), () => a <= un.ascension && v.onSetup({ ascension: a }));
          b.disabled = a > un.ascension;
          aseg.append(b);
        }
        aRow.append(aseg);
        p.append(aRow);
        if (v.setup.ascension > 0) p.append(el('div', 'note', ASCENSIONS.slice(0, v.setup.ascension).join(' ')));
      }
      const row = el('div', 'row');
      const dailyOn = v.setup.daily != null;
      row.append(btn(`brass-btn${dailyOn ? '' : ' quiet'}`, dailyOn ? 'Daily Dusk · on' : 'Daily Dusk', () => v.onSetup({ daily: dailyOn ? null : dailyDay(v.now) })));
      if (dailyOn) {
        const mods = v.dailyMods.map((id) => DAILY_MODS[id]?.name).filter(Boolean).join(' · ');
        row.append(el('span', 'caps', `${mods}${v.profile.daily.day === dailyDay(v.now) && v.profile.daily.score ? ` · best ${v.profile.daily.score}` : ''}`));
      }
      p.append(row);
      const go = el('div', 'row');
      go.append(el('span', 'caps', v.standalone ? '' : 'Start below when all are ready'));
      if (v.standalone) go.append(btn('brass-btn', 'Night 1', v.onStart));
      p.append(go);
    } else {
      p.append(el('div', 'note', 'The host is setting the table.'));
      const r = v.hostSetup;
      if (r) p.append(el('div', 'caps', `${KITS[r.kit]?.name || ''} · ${BOARD_DEFS[r.boardId]?.name || ''}${r.ascension ? ` · Longer Dusk ${r.ascension}` : ''}${r.daily != null ? ' · Daily' : ''}`));
      p.append(el('div', 'caps', 'Ready up below'));
    }
  }

  function nightNote(R, v) {
    const moon = moonFor(R);
    const fc = v.forecastFor ? v.forecastFor(R) : null;
    const hueWord = { r: 'red', g: 'green', b: 'blue' };
    let line = `Night ${R.night}. ${moon.name}.`;
    if (fc && fc.types.length) {
      const names = fc.types.slice(0, 3).map((t) => SHADES[t]?.name).filter(Boolean);
      line += ` ${names.join(', ')} from the ${fc.arcs.map((a) => v.arcName(R.boardId, a)).join(' and ')}.`;
      if (fc.hues.length) line += ` They want ${fc.hues.map((h) => hueWord[h]).join(' and ')}.`;
      if (fc.boss) line += ` ${SHADES[fc.boss].name} is coming.`;
    }
    return line;
  }

  function lockText(u) {
    return { night4: 'Reach night 4.', night8: 'Reach night 8.', umbra: 'Put Umbra down.', night6: 'Reach night 6.', win: 'Finish a run.', 'cross-win': 'Win on the Cross.' }[u] || '';
  }

  function cell(label, value) {
    const c = el('div', 'cell');
    c.append(el('span', 'caps', label), el('strong', '', value));
    return c;
  }

  function almanacTab(p, v) {
    p.append(el('div', 'note', 'Every Shade you have met writes a page.'));
    const grid = el('div', 'almanac');
    for (const id of SHADE_IDS) {
      if (id === 'half') continue;
      const def = SHADES[id];
      const a = v.profile.almanac[id];
      const page = el('div', `page${a?.met ? '' : ' unknown'}`);
      page.append(shadeIcon(id, 64, def.cls === 'plain' ? 'w' : 'r'));
      page.append(el('div', 'name', a?.met ? def.name : '?'));
      page.append(el('div', 'text', a?.met ? def.note : 'Not yet met.'));
      if (a?.met) page.append(el('div', 'caps', `Burned ${a.killed}`));
      grid.append(page);
    }
    p.append(grid);
  }

  function cosmeticsTab(p, v) {
    const un = cosmeticUnlocks(v.profile);
    const cos = v.profile.cosmetics;
    const section = (label, ids, kind, colourOf, names) => {
      p.append(el('div', 'caps', label));
      const sw = el('div', 'swatches');
      for (const id of ids) {
        const ok = un[kind][id];
        const s = btn(`swatch${cos[kind] === id ? ' on' : ''}${ok ? '' : ' locked'}`, '', () => ok && v.onCosmetic(kind, id));
        s.style.background = colourOf(id);
        s.title = names(id);
        s.setAttribute('aria-label', names(id));
        sw.append(s);
      }
      p.append(sw);
    };
    section('Felt', Object.keys(FELTS), 'felt', (id) => `linear-gradient(135deg, ${FELTS[id].lit}, ${FELTS[id].base})`, (id) => FELTS[id].name);
    section('Brass', Object.keys(BRASSES), 'brass', (id) => `linear-gradient(135deg, ${BRASSES[id].hi}, ${BRASSES[id].lo})`, (id) => BRASSES[id].name);
    section('Beam', BEAM_STYLES, 'beam', (id) => ({ classic: 'linear-gradient(90deg,#fff4d6,#c9a04a)', thread: 'linear-gradient(90deg,#fff,#5db4ff)', ember: 'linear-gradient(90deg,#fff4d6,#ff5d4d)' })[id], (id) => ({ classic: 'Lamplight', thread: 'Silver thread', ember: 'Ember' })[id]);
    section('Heart', HEART_SKINS, 'heart', (id) => ({ glass: 'radial-gradient(circle at 35% 35%, #fff, #c9a04a)', ember: 'radial-gradient(circle at 35% 35%, #fff, #ff5d4d)', moon: 'radial-gradient(circle at 35% 35%, #fff, #5db4ff)' })[id], (id) => ({ glass: 'Glass', ember: 'Ember', moon: 'Moon' })[id]);
    p.append(el('div', 'note', 'Earned at the table: nights reached, bosses put down, runs finished.'));
  }

  function recordsTab(p, v) {
    const pr = v.profile;
    const box = el('div', 'ledger');
    box.append(cell('Runs', String(pr.runs)), cell('Wins', String(pr.wins)), cell('Best score', String(pr.bestScore)), cell('Best night', String(pr.bestNight)), cell('Endless', String(pr.bestEndless)), cell('Burned', String(pr.kills)));
    p.append(box);
    if (v.badges && v.badges.length) {
      p.append(el('div', 'caps', 'Badges'));
      const row = el('div', 'row');
      for (const b of v.badges) row.append(el('span', `caps${b.earned ? '' : ' off'}`, b.name));
      p.append(row);
    }
  }

  // ---- dawn -----------------------------------------------------------------------------------------------
  function dawn(v) {
    const R = v.run;
    show('dawn', (p) => {
      const last = R.ledger[R.ledger.length - 1];
      p.append(el('h2', '', `Dawn ${R.night}`));
      const box = el('div', 'ledger');
      if (last) box.append(cell('Burned', String(last.kills)), cell('Score', `+${last.score}`), cell('Heart', `${R.heart.hp}/${R.heart.max}`), cell('Cracks', String(last.cracks)));
      p.append(box);
      if (R.draft && R.draft.taken < 0) {
        p.append(el('div', 'caps', v.isHost ? 'Take one' : 'The host is choosing'));
        const row = el('div', 'row');
        R.draft.options.forEach((o, i) => {
          const c = btn('choice', '', () => v.isHost && v.onDraft(i));
          if (o.kind === 'piece') c.append(pieceIcon(o.id, 48, { brass: v.brass }));
          c.append(el('div', 'name', o.kind === 'piece' ? `${o.name}${o.n > 1 ? ` ×${o.n}` : ''}` : o.name));
          c.append(el('div', 'text', (o.kind === 'relic' ? 'Relic · ' : o.kind === 'upgrade' ? 'Upgrade · ' : '') + o.text));
          row.append(c);
        });
        p.append(row);
      } else if (R.fate && R.fate.taken < 0) {
        p.append(el('h2', '', R.fate.name));
        p.append(el('div', 'note', R.fate.text));
        const row = el('div', 'row');
        const take = btn('choice', '', () => v.isHost && v.onFate(true));
        take.append(el('div', 'name', 'Take it'), el('div', 'text', R.fate.take));
        const walk = btn('choice', '', () => v.isHost && v.onFate(false));
        walk.append(el('div', 'name', 'Walk on'), el('div', 'text', 'Nothing gained, nothing owed.'));
        row.append(take, walk);
        p.append(row);
        if (!v.isHost) p.append(el('div', 'caps', 'The host is choosing'));
      }
    });
  }

  // ---- the end of a run ---------------------------------------------------------------------------------
  function ended(v) {
    const R = v.run;
    show('ended', (p) => {
      const won = R.phase === 'won';
      p.append(el('h2', '', won ? 'The Long Dusk is done' : `Night ${R.night} took the Heart`));
      const last = R.ledger[R.ledger.length - 1];
      const box = el('div', 'ledger');
      box.append(cell('Score', String(R.score)), cell('Nights', String(R.ledger.filter((e) => e.won).length)), cell('Burned', String(R.ledger.reduce((a, e) => a + e.kills, 0))), cell('Relics', String(R.relics.length)));
      if (R.endless) box.append(cell('Endless', String(endlessNights(R))));
      p.append(box);
      if (!won && last && last.lostBy) p.append(el('div', 'note', lossNote(last.lostBy, R)));
      if (won) p.append(el('div', 'note', 'Twelve nights. The table is yours; the dark keeps coming if you let it.'));
      const row = el('div', 'row');
      if (v.isHost) {
        if (won && !R.endless) row.append(btn('brass-btn', 'Endless', v.onEndless));
        row.append(btn('brass-btn', 'New run', v.onNewRun));
      } else row.append(el('span', 'caps', 'The host decides what is next'));
      p.append(row);
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
    show('closed', (p) => {
      p.append(el('h2', '', text));
      const row = el('div', 'row');
      row.append(btn('brass-btn', label, onAgain));
      p.append(row);
    });
  }

  function watching(v) {
    show('watching', (p) => {
      p.append(el('h2', '', 'Watching'));
      p.append(el('div', 'note', `Night ${v.night}. You join at the next dusk.`));
    });
    root.style.pointerEvents = 'none';
  }

  return {
    title,
    observatory,
    dawn,
    ended,
    closed,
    watching,
    hide() {
      root.style.pointerEvents = '';
      hide();
    },
    get current() {
      return current;
    },
  };
}

export { forecast, PIECES, UPGRADES };
