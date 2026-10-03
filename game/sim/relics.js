// Relics (24), piece upgrades and Fates. Each relic is a modifier on the night's `mods`, so the tracer, heat and
// Shades read one table and never ask what relics a run holds.

export const RELICS = {
  'polished-brass': { name: 'Polished Brass', text: 'Mirrors keep 98% of the light.', apply: (m) => (m.mirrorKeep = Math.max(m.mirrorKeep, 0.98)) },
  'cold-hands': { name: 'Cold Hands', text: 'Glass cools 40% faster.', apply: (m) => (m.cooling *= 1.4) },
  'lamp-oil': { name: 'Lamp Oil', text: 'Lamp power +10%.', apply: (m) => (m.lampPower *= 1.1) },
  'second-sight': { name: 'Second Sight', text: 'The forecast shows every wave of the night.', apply: (m) => (m.forecastAll = true) },
  'star-chart': { name: 'Star Chart', text: 'Your first placement each wave is free.', apply: (m) => (m.freeFirstPlacement = true) },
  'dichroic-glass': { name: 'Dichroic Glass', text: 'Prisms add a fourth, white beam.', apply: (m) => (m.prismWhite = 0.25) },
  anvil: { name: 'Anvil', text: 'Cracked and shattered glass is mended at dawn.', apply: (m) => (m.repairAtDawn = true) },
  'moth-eaten-velvet': { name: 'Moth-eaten Velvet', text: 'Eaters chew 30% slower.', apply: (m) => (m.eaterSlow *= 1.3) },
  quicksilver: { name: 'Quicksilver', text: 'Focus returns 3 a second faster.', apply: (m) => (m.focusRegen += 3) },
  'deep-well': { name: 'Deep Well', text: 'Focus holds 150.', apply: (m) => (m.focusMax = Math.max(m.focusMax, 150)) },
  'long-breath': { name: 'Long Breath', text: 'The Lamp breathes gently: 0.8 to 1.2.', apply: (m) => ((m.breathLow = 0.8), (m.breathHigh = 1.2)) },
  'lantern-ring': { name: 'Lantern Ring', text: 'Heart +15, now and at most.', apply: (m) => (m.heartHp += 15), heal: 15 },
  'ash-ward': { name: 'Ash Ward', text: 'Flare returns 8 s sooner and reaches a cell further.', apply: (m) => ((m.flareCd = Math.max(6, m.flareCd - 8)), (m.flareRadius += 1)) },
  'tinted-monocle': { name: 'Tinted Monocle', text: 'A matching colour burns harder.', apply: (m) => (m.matchBonus += 0.25) },
  'half-silver': { name: 'Half-Silver', text: 'Splitters lose nothing.', apply: (m) => (m.splitterKeep = 1) },
  'ember-heart': { name: 'Ember Heart', text: 'The Dawn meter fills twice as fast.', apply: (m) => (m.dawnRate *= 2) },
  'night-eyes': { name: 'Night Eyes', text: 'Light slows Shades more.', apply: (m) => (m.lightSlow = Math.min(0.85, m.lightSlow + 0.2)) },
  'salt-line': { name: 'Salt Line', text: 'Shades burn 10 as they step onto the felt.', apply: (m) => (m.rimBurn += 10) },
  'jewellers-loupe': { name: "Jeweller's Loupe", text: 'A focus burns 30% harder.', apply: (m) => (m.lensBoost *= 1.3) },
  firebrand: { name: 'Firebrand', text: 'Crystal pulses 50% stronger.', apply: (m) => (m.crystalBoost *= 1.5) },
  'clockwork-key': { name: 'Clockwork Key', text: 'Rotors turn twice as fast; shutters stay open longer.', apply: (m) => ((m.rotorSpeed *= 2), (m.shutterOpen = 1.5)) },
  'thick-felt': { name: 'Thick Felt', text: 'The Heart takes 15% less.', apply: (m) => (m.heartArmor = Math.min(0.9, m.heartArmor + 0.15)) },
  'black-ledger': { name: 'Black Ledger', text: 'Score +50%.', apply: (m) => (m.scoreMult *= 1.5) },
  'widows-lamp': { name: "Widow's Lamp", text: 'A second Lamp across the table, at 45%.', apply: (m) => (m.extraLamp = Math.max(m.extraLamp, 0.45)) },
};
export const RELIC_IDS = Object.keys(RELICS);

export const UPGRADES = {
  quartz: { name: 'Quartz Lenses', text: 'The focus is a finer point.', apply: (m) => (m.focusMin = 2) },
  'cold-glass': { name: 'Cold Glass', text: 'All glass takes 30% less heat.', apply: (m) => (m.heatRate *= 0.7) },
  'clear-filters': { name: 'Clear Filters', text: 'Filters pass their colour whole.', apply: (m) => (m.filterKeep = 1) },
  'long-lens': { name: 'Long Lenses', text: 'Lenses focus a cell further.', apply: (m) => (m.focusDist += 64) },
  'short-lens': { name: 'Short Lenses', text: 'Lenses focus a cell nearer.', apply: (m) => (m.focusDist = Math.max(90, m.focusDist - 64)) },
  'bright-prism': { name: 'Bright Prisms', text: 'Prisms give 25% more than they take.', apply: (m) => (m.prismGain = 1.25) },
};
export const UPGRADE_IDS = Object.keys(UPGRADES);

// A Fate is a bargain: something now, a price later. Every Fate has a way to walk on.
export const FATES = {
  glassblower: { name: 'The Glassblower', text: 'A stranger at the rail offers two mirrors, cut from your Lamp.', take: 'Two mirrors; the Lamp loses 10%', effect: (R) => ((R.deck.mirror = (R.deck.mirror || 0) + 2), (R.flags.lampMult = (R.flags.lampMult || 1) * 0.9)) },
  'moth-jar': { name: 'The Moth Jar', text: 'A jar of warmth for the Heart. Something inside is fluttering.', take: 'Heart +25; Moths every night', effect: (R) => ((R.heart.max += 25), (R.heart.hp += 25), (R.flags.moths = true)) },
  'falling-star': { name: 'Falling Star', text: 'A light crossed the dome and fell on the felt. The dark noticed.', take: 'A relic; Glooms in every wave tomorrow', effect: (R, rng) => (grantRelic(R, rng), (R.flags.gloomNext = R.night + 1)) },
  pawnbroker: { name: 'The Pawnbroker', text: 'He wants a piece of glass. He pays in older things.', take: 'Lose a random piece; gain a relic', effect: (R, rng) => (loseRandomPiece(R, rng), grantRelic(R, rng)) },
  'cold-snap': { name: 'The Cold Snap', text: 'Frost on the brass. Your hands are slow but the glass is cool.', take: 'Cooling +30%; Focus holds 20 less', effect: (R) => ((R.flags.coolMult = (R.flags.coolMult || 1) * 1.3), (R.flags.focusLess = (R.flags.focusLess || 0) + 20)) },
  almanac: { name: 'The Old Almanac', text: 'Pages of tomorrow. The ink is still wet.', take: 'Second Sight; Shades tomorrow +15% hp', effect: (R) => (addRelic(R, 'second-sight'), (R.flags.hpNext = R.night + 1)) },
  tinker: { name: 'The Tinker', text: 'She mends everything on the table and keeps one of tomorrow\'s choices.', take: 'Heart to full; next draft has two options', effect: (R) => ((R.heart.hp = R.heart.max), (R.flags.draftFewer = true)) },
  'dark-bargain': { name: 'The Dark Bargain', text: 'A ledger bound in black. Sign, and the score is yours. The Heart pays.', take: 'Score +50%; Heart max -20', effect: (R) => (addRelic(R, 'black-ledger'), (R.heart.max = Math.max(40, R.heart.max - 20)), (R.heart.hp = Math.min(R.heart.hp, R.heart.max))) },
};
export const FATE_IDS = Object.keys(FATES);

export function addRelic(R, id) {
  if (!RELICS[id] || R.relics.includes(id)) return false;
  R.relics.push(id);
  if (RELICS[id].heal) {
    R.heart.max += RELICS[id].heal;
    R.heart.hp = Math.min(R.heart.max, R.heart.hp + RELICS[id].heal);
  }
  return true;
}

export function grantRelic(R, rng) {
  const left = RELIC_IDS.filter((id) => !R.relics.includes(id));
  if (!left.length) return null;
  const id = rng.pick(left);
  addRelic(R, id);
  return id;
}

export function loseRandomPiece(R, rng) {
  const types = Object.keys(R.deck).filter((t) => R.deck[t] > 0);
  if (types.length <= 1) return null;
  const t = rng.pick(types);
  R.deck[t]--;
  return t;
}
