// The glass: every piece type the tracer knows, with its optics, heat and tray data.
// `shape`: 'segment' pieces have an oriented aperture through the cell centre (a plate the beam must cross);
// 'disc' pieces act on any beam entering their circle; 'none' pieces never touch light.

export const APERTURE = 27; // half-length of a plate (54 px across a 64 px cell)
export const DISC = 24; // radius of a disc piece
export const BEAM_WIDTH = 10; // a fresh beam's width in px
export const W0 = 12; // the width damage is normalised to
export const MIN_POWER = 4; // beams below this stop
export const MAX_DEPTH = 14; // interactions per beam lineage
export const MAX_RAYS = 96; // rays traced per frame, all lineages together
export const FOCUS_DIST = 180; // px from a convex lens to its focus
export const FOCUS_MIN = 3; // narrowest width at a focus
export const SPREAD = 0.12; // concave lens: px of width per px travelled
export const HEAT_CAP = 100;
export const WIDE_HOLD = 0.6; // share of speed ink loses wading through light a concave lens has spread (a fence)

export const PIECES = {
  mirror: { id: 'mirror', name: 'Mirror', shape: 'segment', keep: 0.93, absorb: 0.07, tip: 'Bounces light. Both faces.' },
  splitter: { id: 'splitter', name: 'Splitter', shape: 'segment', keep: 0.95, absorb: 0.05, tip: 'Half bounces, half passes.' },
  prism: { id: 'prism', name: 'Prism', shape: 'segment', absorb: 0.08, gain: 1.1, dullGain: 0.85, fan: { r: 8, g: 14, b: 20 }, tip: 'White in, three colours out.' },
  'filter-r': { id: 'filter-r', name: 'Red Filter', shape: 'disc', channel: 'r', keep: 0.9, absorbRejected: 0.25, absorb: 0.05, tip: 'Only red passes.' },
  'filter-g': { id: 'filter-g', name: 'Green Filter', shape: 'disc', channel: 'g', keep: 0.9, absorbRejected: 0.25, absorb: 0.05, tip: 'Only green passes.' },
  'filter-b': { id: 'filter-b', name: 'Blue Filter', shape: 'disc', channel: 'b', keep: 0.9, absorbRejected: 0.25, absorb: 0.05, tip: 'Only blue passes.' },
  lens: { id: 'lens', name: 'Convex Lens', shape: 'segment', absorb: 0.04, tip: 'Narrows to a burning point.' },
  concave: { id: 'concave', name: 'Concave Lens', shape: 'segment', absorb: 0.04, tip: 'Spreads light wide. A fence.' },
  combiner: { id: 'combiner', name: 'Combiner', shape: 'disc', keep: 0.95, absorb: 0.05, tip: 'Merges beams. Fires forward.' },
  crystal: { id: 'crystal', name: 'Crystal', shape: 'disc', capacity: 240, pulse: 0.6, tip: 'Drinks light. Bursts forward.' },
  rotor: { id: 'rotor', name: 'Rotor', shape: 'segment', keep: 0.93, absorb: 0.07, sweep: 22.5, period: 5, dwell: 0.4, tip: 'A mirror that swings: one beam, two lanes.' },
  shutter: { id: 'shutter', name: 'Shutter', shape: 'disc', absorb: 0.02, tip: 'Open a second, shut a second.' },
  heatsink: { id: 'heatsink', name: 'Heat-sink', shape: 'none', cool: 2.5, tip: 'Cools its neighbours.' },
  black: { id: 'black', name: 'Black Glass', shape: 'disc', absorb: 0.1, tip: 'Eats light. A shield.' },
};

export const PIECE_IDS = Object.keys(PIECES);
export const isPieceType = (t) => typeof t === 'string' && Object.hasOwn(PIECES, t);
export const oriented = (t) => PIECES[t]?.shape === 'segment';

/** The default modifiers: kits, relics, roles and upgrades change these (see run.js). */
export function baseMods() {
  return {
    mirrorKeep: 0.93,
    splitterKeep: 0.95,
    prismWhite: 0, // Dichroic Glass: a fourth, white beam at this share of the input
    prismGain: 1.1, // each colour leaves a prism with this share of its channel (white in)
    filterKeep: 0.9,
    focusMin: FOCUS_MIN,
    focusDist: FOCUS_DIST,
    lensBoost: 1, // damage multiplier at the focus
    crystalBoost: 1,
    rotorSpeed: 1,
    shutterOpen: 1, // seconds open of a 2 s cycle
    cooling: 1,
    heatRate: 1,
    lampPower: 1,
    breathLow: 0.6,
    breathHigh: 1.4,
    matchBonus: 0, // added to the matching-colour multiplier
    colourDamage: 1, // Alchemist: filters and combiners
    damage: 1,
    heartHp: 100,
    heartArmor: 0, // share of Heart damage absorbed
    focusMax: 100,
    focusRegen: 8,
    focusCost: 1, // multiplier on Focus costs
    sellRefund: 0,
    freeFirstPlacement: false,
    dawnRate: 1,
    flareCd: 20,
    flareRadius: 3, // cells
    surgeCd: 60,
    eaterSlow: 1, // chew time multiplier
    lightSlow: 0.5, // Shades lose this share of speed in full light
    rimBurn: 0, // damage to a Shade as it enters the felt
    repairAtDawn: false,
    scoreMult: 1,
    forecastAll: false,
    hardenedSplit: 1,
    extraLamp: 0, // power share of a second Lamp granted by a relic
    chewPriority: false,
  };
}
