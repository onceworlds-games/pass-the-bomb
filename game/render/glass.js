// The glass: every piece drawn as a bevelled, translucent shape on a brass mount, with its caustic highlight,
// its heat glow and its cracks. Drawn in reference coordinates at the cell centre.

import { CELL } from '../sim/boards.js';
import { PIECES, APERTURE, DISC, HEAT_CAP } from '../sim/pieces.js';
import { pieceAngle, shutterOpen } from '../sim/trace.js';
import { DEG, clamp } from '../sim/geom.js';
import { PALETTE, BRASSES } from './felt.js';

// Safari before 16 has no roundRect: without it every piece would throw inside the frame loop.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h, r = 0) {
    const rr = Math.max(0, Math.min(Number(r) || 0, Math.abs(w) / 2, Math.abs(h) / 2));
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
  };
}

const GLASS = 'rgba(190,230,240,0.42)';
const GLASS_EDGE = 'rgba(230,250,255,0.9)';
const GLASS_DARK = 'rgba(40,70,90,0.55)';
const HUE = { r: PALETTE.red, g: PALETTE.green, b: PALETTE.blue };

function mount(ctx, brass, size = 46) {
  const h = size / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  ctx.roundRect(-h + 1, -h + 3, size, size, 8);
  ctx.fill();
  const g = ctx.createLinearGradient(-h, -h, h, h);
  g.addColorStop(0, brass.mid);
  g.addColorStop(0.5, brass.lo);
  g.addColorStop(1, brass.mid);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(-h, -h, size, size, 8);
  ctx.fill();
  ctx.strokeStyle = brass.hi;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.strokeRect(-h + 3, -h + 3, size - 6, size - 6);
  ctx.globalAlpha = 1;
  ctx.fillStyle = brass.hi;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.beginPath();
    ctx.arc(sx * (h - 6), sy * (h - 6), 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function plate(ctx, len, thick, fill = GLASS, edge = GLASS_EDGE) {
  // A bevelled bar along the x axis: glass body, bright edge, a caustic line.
  const g = ctx.createLinearGradient(0, -thick, 0, thick);
  g.addColorStop(0, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.45, fill);
  g.addColorStop(1, GLASS_DARK);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(-len, -thick / 2, len * 2, thick, 2);
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-len + 4, -thick / 2 + 1.5);
  ctx.lineTo(len - 8, -thick / 2 + 1.5);
  ctx.stroke();
}

function glyph(ctx, hue, size, colour) {
  ctx.fillStyle = colour || HUE[hue] || PALETTE.bone;
  ctx.beginPath();
  if (hue === 'r') {
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.95, size * 0.7);
    ctx.lineTo(-size * 0.95, size * 0.7);
    ctx.closePath();
  } else if (hue === 'g') ctx.rect(-size * 0.8, -size * 0.8, size * 1.6, size * 1.6);
  else if (hue === 'b') ctx.arc(0, 0, size * 0.9, 0, Math.PI * 2);
  else {
    ctx.moveTo(0, -size);
    ctx.lineTo(size, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size, 0);
    ctx.closePath();
  }
  ctx.fill();
}

export { glyph };

/**
 * Draws one piece. `p` is a sim piece (or a ghost with the same fields), `t` night seconds, `opts`:
 * { brass, mods, ghost, selected, lockColour, quality }.
 */
export function drawPiece(ctx, p, t, opts = {}) {
  const def = PIECES[p.type];
  if (!def) return;
  const brass = BRASSES[opts.brass] || BRASSES.brass;
  const x = (p.c + 0.5) * CELL;
  const y = (p.r + 0.5) * CELL;
  ctx.save();
  ctx.translate(x, y);
  if (opts.ghost) ctx.globalAlpha = 0.55;
  const heat = clamp((p.heat || 0) / HEAT_CAP, 0, 1.2);
  if (p.cracked) ctx.globalAlpha *= 0.8;
  mount(ctx, brass, def.shape === 'none' ? 50 : 44);
  // Heat: an ember glow from the mount outward.
  if (heat > 0.2 && !opts.ghost) {
    const g = ctx.createRadialGradient(0, 0, 6, 0, 0, 30 + heat * 14);
    g.addColorStop(0, `rgba(255,${Math.round(150 - heat * 90)},40,${0.15 + heat * 0.45})`);
    g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 30 + heat * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  const a = pieceAngle(p, t, opts.mods) * DEG;
  switch (p.type) {
    case 'mirror':
    case 'rotor':
      if (p.type === 'rotor') gear(ctx, brass, t);
      ctx.rotate(a);
      plate(ctx, APERTURE, 7, 'rgba(225,240,250,0.7)');
      break;
    case 'splitter':
      ctx.rotate(a);
      plate(ctx, APERTURE, 7, 'rgba(170,210,235,0.32)');
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(-APERTURE + 3, 0);
      ctx.lineTo(APERTURE - 3, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    case 'prism': {
      ctx.rotate(a);
      // Base along the aperture, apex toward the normal side.
      const g = ctx.createLinearGradient(-APERTURE, 0, APERTURE, 0);
      g.addColorStop(0, 'rgba(255,120,110,0.55)');
      g.addColorStop(0.5, 'rgba(150,255,170,0.5)');
      g.addColorStop(1, 'rgba(120,180,255,0.55)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-APERTURE, 0);
      ctx.lineTo(APERTURE, 0);
      ctx.lineTo(0, -APERTURE * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = GLASS_EDGE;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-APERTURE + 6, -2);
      ctx.lineTo(-3, -APERTURE * 0.75);
      ctx.stroke();
      break;
    }
    case 'lens': {
      ctx.rotate(a);
      lensShape(ctx, APERTURE, 16, true);
      break;
    }
    case 'concave': {
      ctx.rotate(a);
      lensShape(ctx, APERTURE, 16, false);
      break;
    }
    case 'filter-r':
    case 'filter-g':
    case 'filter-b': {
      const col = HUE[def.channel];
      disc(ctx, DISC, hexToRgba(col, 0.42), hexToRgba(col, 0.9), brass);
      glyph(ctx, def.channel, 9, hexToRgba(col, 0.95));
      break;
    }
    case 'combiner': {
      disc(ctx, DISC, 'rgba(200,230,240,0.35)', GLASS_EDGE, brass);
      ctx.save();
      ctx.rotate(a);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.2;
      for (const d of [-0.35, 0.35]) {
        ctx.beginPath();
        ctx.moveTo(-DISC + 6, d * DISC * 1.6);
        ctx.lineTo(DISC - 10, 0);
        ctx.stroke();
      }
      arrow(ctx, DISC - 2, brass.hi);
      ctx.restore();
      break;
    }
    case 'crystal': {
      const charge = clamp((p.store || 0) / PIECES.crystal.capacity, 0, 1);
      const pulsing = p.pulseUntil > t;
      gem(ctx, DISC, charge, pulsing, a, brass);
      break;
    }
    case 'shutter': {
      const open = shutterOpen(p, t, opts.mods);
      shutter(ctx, DISC, open, brass);
      break;
    }
    case 'heatsink':
      radiator(ctx, brass);
      break;
    case 'black':
      disc(ctx, DISC, 'rgba(10,8,16,0.95)', 'rgba(120,80,160,0.7)', brass);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(-6, -7, 9, Math.PI * 1.1, Math.PI * 1.7);
      ctx.stroke();
      break;
    default:
      break;
  }
  ctx.rotate(-a);
  if (p.cracked && !opts.ghost) cracks(ctx, p);
  ctx.restore();
  if (opts.selected || opts.lockColour) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = opts.lockColour || brass.hi;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(-CELL / 2 + 3, -CELL / 2 + 3, CELL - 6, CELL - 6);
    ctx.restore();
  }
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function disc(ctx, r, fill, edge, brass) {
  ctx.strokeStyle = brass.lo;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, r + 1, 0, Math.PI * 2);
  ctx.stroke();
  const g = ctx.createRadialGradient(-r * 0.4, -r * 0.4, 2, 0, 0, r);
  g.addColorStop(0, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.35, fill);
  g.addColorStop(1, GLASS_DARK);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.3;
  ctx.stroke();
}

function lensShape(ctx, len, thick, convex) {
  const g = ctx.createLinearGradient(0, -thick, 0, thick);
  g.addColorStop(0, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.5, 'rgba(200,235,245,0.4)');
  g.addColorStop(1, GLASS_DARK);
  ctx.fillStyle = g;
  ctx.beginPath();
  if (convex) {
    ctx.moveTo(-len, 0);
    ctx.quadraticCurveTo(0, -thick * 1.6, len, 0);
    ctx.quadraticCurveTo(0, thick * 1.6, -len, 0);
  } else {
    ctx.moveTo(-len, -thick * 0.8);
    ctx.quadraticCurveTo(0, thick * 0.1, len, -thick * 0.8);
    ctx.lineTo(len, thick * 0.8);
    ctx.quadraticCurveTo(0, -thick * 0.1, -len, thick * 0.8);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = GLASS_EDGE;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-len * 0.6, -thick * 0.45);
  ctx.quadraticCurveTo(-len * 0.2, -thick * 0.9, len * 0.3, -thick * 0.55);
  ctx.stroke();
}

function arrow(ctx, r, colour) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(r + 2, 0);
  ctx.lineTo(r - 6, -5);
  ctx.lineTo(r - 6, 5);
  ctx.closePath();
  ctx.fill();
}

function gear(ctx, brass, t) {
  ctx.save();
  ctx.rotate((t * 0.5) % (Math.PI * 2));
  ctx.fillStyle = brass.mid;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.fillRect(DISC - 2, -3, 7, 6);
    ctx.restore();
  }
  ctx.strokeStyle = brass.hi;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, DISC, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function gem(ctx, r, charge, pulsing, a, brass) {
  ctx.save();
  ctx.rotate(a);
  if (charge > 0.05 || pulsing) {
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, r + 16 + (pulsing ? 18 : 0));
    g.addColorStop(0, `rgba(255,244,214,${pulsing ? 0.95 : 0.25 + charge * 0.5})`);
    g.addColorStop(1, 'rgba(255,230,160,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r + 16 + (pulsing ? 18 : 0), 0, Math.PI * 2);
    ctx.fill();
  }
  const g2 = ctx.createLinearGradient(-r, -r, r, r);
  g2.addColorStop(0, 'rgba(255,255,255,0.85)');
  g2.addColorStop(0.5, `rgba(255,225,160,${0.35 + charge * 0.5})`);
  g2.addColorStop(1, 'rgba(120,90,40,0.7)');
  ctx.fillStyle = g2;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const an = (i / 6) * Math.PI * 2;
    const rr = i % 2 ? r * 0.8 : r * 1.05;
    ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = GLASS_EDGE;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i += 2) {
    const an = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r);
    ctx.stroke();
  }
  arrow(ctx, r + 6, brass.hi);
  ctx.restore();
}

function shutter(ctx, r, open, brass) {
  ctx.strokeStyle = brass.lo;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, r + 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = open ? 'rgba(200,235,245,0.3)' : 'rgba(30,26,22,0.95)';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Six blades, closed into the centre or open to the rim.
  const reach = open ? r * 0.25 : r * 0.95;
  ctx.fillStyle = brass.mid;
  for (let i = 0; i < 6; i++) {
    const an = (i / 6) * Math.PI * 2;
    ctx.save();
    ctx.rotate(an);
    ctx.beginPath();
    ctx.moveTo(r, -4);
    ctx.lineTo(r - reach, 0);
    ctx.lineTo(r, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = GLASS_EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
}

function radiator(ctx, brass) {
  ctx.fillStyle = '#2b2f35';
  ctx.fillRect(-20, -20, 40, 40);
  ctx.fillStyle = '#6a7380';
  for (let i = -16; i <= 16; i += 8) ctx.fillRect(i - 2, -20, 4, 40);
  ctx.strokeStyle = brass.hi;
  ctx.lineWidth = 1;
  ctx.strokeRect(-20.5, -20.5, 41, 41);
  const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 38);
  g.addColorStop(0, 'rgba(120,200,255,0.18)');
  g.addColorStop(1, 'rgba(120,200,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 38, 0, Math.PI * 2);
  ctx.fill();
}

function cracks(ctx, p) {
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  const s = (p.id * 37) % 7;
  ctx.beginPath();
  ctx.moveTo(-18 + s, -6);
  ctx.lineTo(-4, 2 + s);
  ctx.lineTo(8 - s, -10);
  ctx.lineTo(19, 4);
  ctx.moveTo(-4, 2 + s);
  ctx.lineTo(2, 18 - s);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.moveTo(-17 + s, -5);
  ctx.lineTo(-3, 3 + s);
  ctx.lineTo(9 - s, -9);
  ctx.stroke();
}

/** The Lamp: a brass housing with a lit lens, aimed along its angle; `power` 0-1 scales the glow. */
export function drawLamp(ctx, L, power, opts = {}) {
  const brass = BRASSES[opts.brass] || BRASSES.brass;
  ctx.save();
  ctx.translate(L.x, L.y);
  const g = ctx.createRadialGradient(0, 0, 4, 0, 0, L.radius + 40);
  g.addColorStop(0, `rgba(255,244,214,${0.35 + power * 0.45})`);
  g.addColorStop(1, 'rgba(255,230,160,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, L.radius + 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(L.angle * DEG);
  const body = ctx.createLinearGradient(0, -L.radius, 0, L.radius);
  body.addColorStop(0, brass.hi);
  body.addColorStop(0.5, brass.mid);
  body.addColorStop(1, brass.lo);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, L.radius, 0, Math.PI * 2);
  ctx.fill();
  // The hood and the lit front.
  ctx.fillStyle = brass.lo;
  ctx.beginPath();
  ctx.arc(0, 0, L.radius, Math.PI * 0.75, Math.PI * 1.25);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  const lit = ctx.createRadialGradient(L.radius * 0.5, 0, 1, L.radius * 0.5, 0, L.radius * 0.7);
  lit.addColorStop(0, 'rgba(255,250,230,1)');
  lit.addColorStop(1, `rgba(255,220,150,${0.3 + power * 0.5})`);
  ctx.fillStyle = lit;
  ctx.beginPath();
  ctx.arc(L.radius * 0.45, 0, L.radius * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = brass.hi;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, L.radius - 1, 0, Math.PI * 2);
  ctx.stroke();
  // Aiming handle.
  ctx.fillStyle = brass.hi;
  ctx.fillRect(-L.radius - 14, -3, 14, 6);
  ctx.restore();
  // The breath: a pulsing ring whose radius follows the Lamp's power.
  if (!opts.reduced) {
    ctx.save();
    ctx.strokeStyle = `rgba(255,244,214,${0.15 + power * 0.25})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(L.x, L.y, L.radius + 10 + power * 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** The Heart: a faceted glass sphere that glows with its Dawn charge and dims as it is hurt. */
export function drawHeart(ctx, h, hp, charge, t, opts = {}) {
  const brass = BRASSES[opts.brass] || BRASSES.brass;
  const life = clamp(hp, 0, 1);
  ctx.save();
  ctx.translate(h.x, h.y);
  const pulse = opts.reduced ? 0 : Math.sin(t * 2.2) * 0.5 + 0.5;
  const glowR = h.radius + 18 + charge * 26 + pulse * 4;
  const g = ctx.createRadialGradient(0, 0, 4, 0, 0, glowR);
  g.addColorStop(0, `rgba(255,236,190,${0.25 + charge * 0.5 + life * 0.15})`);
  g.addColorStop(1, 'rgba(255,220,160,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, glowR, 0, Math.PI * 2);
  ctx.fill();
  const skin = opts.heartSkin || 'glass';
  const body = ctx.createRadialGradient(-h.radius * 0.35, -h.radius * 0.4, 2, 0, 0, h.radius);
  if (skin === 'ember') {
    body.addColorStop(0, 'rgba(255,230,200,0.95)');
    body.addColorStop(0.5, `rgba(255,120,60,${0.5 + life * 0.4})`);
    body.addColorStop(1, 'rgba(90,20,10,0.9)');
  } else if (skin === 'moon') {
    body.addColorStop(0, 'rgba(255,255,255,0.95)');
    body.addColorStop(0.5, `rgba(200,215,255,${0.45 + life * 0.4})`);
    body.addColorStop(1, 'rgba(40,50,90,0.9)');
  } else {
    body.addColorStop(0, 'rgba(255,255,255,0.95)');
    body.addColorStop(0.5, `rgba(255,236,190,${0.45 + life * 0.4})`);
    body.addColorStop(1, 'rgba(110,80,30,0.9)');
  }
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, h.radius, 0, Math.PI * 2);
  ctx.fill();
  // Facets.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const an = (i / 8) * Math.PI * 2 + t * 0.05;
    ctx.beginPath();
    ctx.moveTo(Math.cos(an) * h.radius * 0.3, Math.sin(an) * h.radius * 0.3);
    ctx.lineTo(Math.cos(an + 0.4) * h.radius, Math.sin(an + 0.4) * h.radius);
    ctx.stroke();
  }
  ctx.strokeStyle = brass.hi;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, h.radius, 0, Math.PI * 2);
  ctx.stroke();
  // Hurt: the sphere darkens from below as hp falls.
  if (life < 1) {
    ctx.fillStyle = `rgba(5,6,10,${(1 - life) * 0.7})`;
    ctx.beginPath();
    ctx.arc(0, 0, h.radius - 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
