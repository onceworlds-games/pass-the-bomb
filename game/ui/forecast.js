// What the table says is coming: the lanes to draw (with the colours each brings) and the forecast line, read from
// the night's plan. Pure functions of a night; Second Sight (or a Seer) reads further ahead.

import { SHADES } from '../sim/shades.js';

/** Which lanes to draw: the next wave's (at dusk and in breaks), and with Second Sight every wave still to come. */
export function laneForecast(N) {
  const S = N.S;
  const next = S.phase === 'dusk' ? 0 : S.phase === 'break' || S.phase === 'wave' ? S.wave + 1 : -1;
  const sight = !!N.mods.forecastAll;
  const lanes = [];
  const seen = new Set();
  N.plan.waves.forEach((w, i) => {
    if (i < next || next < 0) return;
    const soon = i === next && S.phase !== 'wave';
    if (!soon && !sight) return;
    const byArc = new Map();
    for (const e of w.entries) {
      const hue = SHADES[e.type]?.cls === 'plain' ? 'w' : e.hue;
      if (!byArc.has(e.arc)) byArc.set(e.arc, new Set());
      byArc.get(e.arc).add(hue);
    }
    for (const [arc, hues] of byArc) {
      if (seen.has(arc)) continue;
      seen.add(arc);
      lanes.push({ arc, hues: [...hues].sort(), faint: !soon });
    }
  });
  return lanes.length ? { lanes } : null;
}

/** 'a', 'a and b', 'a, b and c'. */
export const listing = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function forecastText(N) {
  const S = N.S;
  const next = S.phase === 'dusk' ? 0 : S.phase === 'break' ? S.wave + 1 : -1;
  const w = N.plan.waves[next];
  if (!w) return '';
  const hueWord = { r: 'red', g: 'green', b: 'blue' };
  const types = [...new Set(w.entries.map((e) => e.type))];
  const names = listing(types.map((t) => SHADES[t]?.name).filter(Boolean).slice(0, 3));
  // The arcs ink will actually come from (a wave's plan can name an arc nothing walks).
  const arcs = listing([...new Set(w.entries.map((e) => e.arc))].map((a) => N.board.arcs[a]?.name).filter(Boolean));
  const locked = w.entries.some((e) => SHADES[e.type]?.cls === 'locked');
  const hues = w.hues.map((h) => hueWord[h]).join(' and ');
  let line = `${next === 0 ? `Night ${S.night}.` : `Next:`} ${names} from the ${arcs}.${locked ? ` The Veils want ${hues}.` : w.hues.length && w.entries.some((e) => SHADES[e.type]?.cls === 'tinted') ? ` They want ${hues}.` : ''}`;
  // Second Sight (or a Seer at the table) reads one wave further.
  const then = N.mods.forecastAll ? N.plan.waves[next + 1] : null;
  if (then) {
    const tn = listing([...new Set(then.entries.map((e) => e.type))].map((t) => SHADES[t]?.name).filter(Boolean).slice(0, 2));
    const ta = listing([...new Set(then.entries.map((e) => e.arc))].map((a) => N.board.arcs[a]?.name).filter(Boolean));
    line += ` Then ${tn} from the ${ta}.`;
  }
  return line;
}
