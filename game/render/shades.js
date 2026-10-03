// Shades: ink-black marbled blobs with wavering edges and two bone-white eyes, bleeding dark onto the felt.
// Bodies come from a small sprite atlas (a few wobble frames per size) so a hundred gnats cost little; eyes,
// glyphs and burn are drawn on top. Bosses are drawn by hand.

import { SHADES, effectiveHue } from '../sim/shades.js';
import { PALETTE } from './felt.js';
import { glyph } from './glass.js';
import { clamp } from '../sim/geom.js';

const FRAMES = 6;
const SIZES = [6, 10, 11, 12, 13, 14, 15, 16, 20];
const HUE = { r: PALETTE.red, g: PALETTE.green, b: PALETTE.blue, w: PALETTE.bone };

function blobPath(ctx, r, frame, seed) {
  const n = 9;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wob = 1 + 0.16 * Math.sin(a * 3 + frame * 1.1 + seed) + 0.1 * Math.sin(a * 5 - frame * 0.7 + seed * 2);
    const rr = r * wob;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function makeShadeRenderer() {
  const atlas = new Map(); // `${r}` -> canvas with FRAMES frames in a row
  let scaleUsed = 1;

  function sprite(r, scale, hue = 'w') {
    const key = `${r}@${scale}:${hue}`;
    let c = atlas.get(key);
    if (c) return c;
    const pad = Math.ceil(r * 1.6 + 6);
    const cell = pad * 2;
    c = document.createElement('canvas');
    c.width = Math.ceil(cell * FRAMES * scale);
    c.height = Math.ceil(cell * scale);
    const g = c.getContext('2d');
    g.scale(scale, scale);
    for (let f = 0; f < FRAMES; f++) {
      g.save();
      g.translate(pad + f * cell, pad);
      // Soft dark bleed under the body.
      const bleed = g.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.55);
      bleed.addColorStop(0, 'rgba(5,6,10,0.55)');
      bleed.addColorStop(1, 'rgba(5,6,10,0)');
      g.fillStyle = bleed;
      g.beginPath();
      g.arc(0, 0, r * 1.55, 0, Math.PI * 2);
      g.fill();
      // The body: marbled ink.
      blobPath(g, r, f, r);
      g.fillStyle = PALETTE.ink;
      g.fill();
      g.save();
      g.clip();
      g.globalAlpha = 0.35;
      g.strokeStyle = '#2a2d3a';
      g.lineWidth = 1.2;
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.moveTo(-r, -r + k * r * 0.5 + f);
        g.bezierCurveTo(-r * 0.3, -r * 0.2 + k * r * 0.4, r * 0.3, r * 0.4 + k * r * 0.2 - f, r, -r * 0.3 + k * r * 0.5);
        g.stroke();
      }
      g.restore();
      // A cold rim so the ink reads on dark felt; tinted ink rims in the colour it wants.
      const rim = hue === 'w' ? '150,140,190' : hue === 'r' ? '255,93,77' : hue === 'g' ? '107,255,143' : '93,180,255';
      g.strokeStyle = `rgba(${rim},0.22)`;
      g.lineWidth = 3.2;
      g.stroke();
      g.strokeStyle = `rgba(${rim},${hue === 'w' ? 0.55 : 0.75})`;
      g.lineWidth = 1.2;
      g.stroke();
      g.restore();
    }
    atlas.set(key, { canvas: c, cell, pad });
    return atlas.get(key);
  }

  function nearestSize(r) {
    let best = SIZES[0];
    for (const s of SIZES) if (Math.abs(s - r) < Math.abs(best - r)) best = s;
    return best;
  }

  /**
   * Draws every Shade. `t` is night seconds; `view.scale` picks the atlas resolution. `opts.rot` says the table is
   * turned a quarter on screen: each Shade's marks (glyph, health, chewing) are drawn upright. Small ink is drawn a
   * little larger than its body on small screens so it never shrinks to a speck.
   */
  function draw(ctx, shades, t, view, opts = {}) {
    const vs = Math.max(0.05, view.scale || 1);
    const scale = clamp(Math.round(vs * (opts.pixelRatio || 1) * 2 * 1.4) / 2, 0.5, 3.5);
    if (scale !== scaleUsed) {
      atlas.clear();
      scaleUsed = scale;
    }
    const rot = !!opts.rot;
    for (const s of shades) {
      const def = SHADES[s.type] || SHADES.wisp;
      if (def.boss) {
        drawBoss(ctx, s, def, t, opts);
        continue;
      }
      const dead = s.state === 'dead' || s.state === 'hit';
      const age = dead ? clamp((t - (s.diedAt ?? t)) / 1.0, 0, 1) : 0;
      ctx.save();
      ctx.translate(s.x, s.y);
      if (rot) ctx.rotate(Math.PI / 2);
      // Never smaller than a few screen px: 7 for most ink, 5 for a gnat.
      const grow = clamp((def.swarm ? 5 : 7) / (s.r * vs), 1.12, 1.8);
      ctx.scale(grow, grow);
      if (dead) {
        // Burned away: the ink thins and scatters.
        ctx.globalAlpha = 1 - age;
        ctx.scale(1 + age * 0.8, 1 - age * 0.6);
      }
      const r = nearestSize(s.r);
      const hue = effectiveHue(s);
      const sp = sprite(r, scale, def.cls === 'plain' ? 'w' : hue);
      const frame = Math.floor((t * 6 + s.seed) % FRAMES);
      const size = sp.cell;
      ctx.drawImage(sp.canvas, frame * size * scale, 0, size * scale, size * scale, -sp.pad, -sp.pad, size, size);
      if (!dead) {
        // Eyes: two bone-white points that look where the Shade walks (its heading, turned with the table).
        const hx = rot ? s.hy : s.hx;
        const hy = rot ? -s.hx : s.hy;
        const ex = hx * r * 0.35;
        const ey = hy * r * 0.35;
        const sep = Math.max(2.5, r * 0.32);
        const px = -hy * sep;
        const py = hx * sep;
        const blink = ((t * 1.3 + s.seed) % 4) > 3.85;
        ctx.fillStyle = PALETTE.bone;
        const er = Math.max(1.2, r * 0.17) * (blink ? 0.3 : 1);
        ctx.beginPath();
        ctx.arc(ex + px, ey + py, er, 0, Math.PI * 2);
        ctx.arc(ex - px, ey - py, er, 0, Math.PI * 2);
        ctx.fill();
        if (s.type === 'mimic') {
          // Glass skin: a bright rim catches the light.
          ctx.strokeStyle = 'rgba(220,245,255,0.8)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, r + 1, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (s.type === 'gloom') {
          const aura = SHADES.gloom.aura / grow;
          const g = ctx.createRadialGradient(0, 0, r, 0, 0, aura);
          g.addColorStop(0, 'rgba(5,6,10,0.5)');
          g.addColorStop(1, 'rgba(5,6,10,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, aura, 0, Math.PI * 2);
          ctx.fill();
        }
        if (s.type === 'moth') wings(ctx, r, t, s.seed);
        if (s.state === 'chew') {
          ctx.fillStyle = PALETTE.bone;
          ctx.font = '600 10px "Plex", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('·'.repeat(1 + Math.floor((t * 3) % 3)), 0, -r - 4);
        }
        // Hue glyph: the colour it wants, as a shape (playable without colour).
        if (hue !== 'w' || def.cls !== 'plain') {
          ctx.save();
          ctx.translate(0, r + 7);
          glyph(ctx, hue, 3.8, HUE[hue]);
          ctx.restore();
        }
        // Burn: the ink glows where light bites.
        if (s.burn > 0.02) {
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(0, 0, 1, 0, 0, r + 8);
          g.addColorStop(0, `rgba(255,200,120,${0.75 * s.burn})`);
          g.addColorStop(1, 'rgba(255,120,60,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, r + 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
        // Health, once it has really been hurt: a thin bone arc of what is left, faint, so a crowd does not
        // become a field of rings.
        const left = clamp(s.hp / s.maxHp, 0, 1);
        if (left < 0.94) {
          ctx.strokeStyle = 'rgba(239,230,200,0.55)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, r + 3.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  function wings(ctx, r, t, seed) {
    const flap = Math.sin(t * 22 + seed) * 0.6;
    ctx.fillStyle = 'rgba(60,55,70,0.85)';
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.rotate(flap * 0.5);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(r * 1.6, -r * 1.2, r * 1.9, r * 0.2);
      ctx.quadraticCurveTo(r * 1.1, r * 0.9, 0, r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBoss(ctx, s, def, t, opts) {
    const dead = s.state === 'dead' || s.state === 'hit';
    const age = dead ? clamp((t - (s.diedAt ?? t)) / 1.2, 0, 1) : 0;
    const r = s.r;
    const hue = effectiveHue(s);
    const rot = !!opts.rot;
    const hx = rot ? s.hy : s.hx;
    const hy = rot ? -s.hx : s.hy;
    ctx.save();
    ctx.translate(s.x, s.y);
    if (rot) ctx.rotate(Math.PI / 2);
    if (dead) ctx.globalAlpha = 1 - age;
    const bleed = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 2.4);
    bleed.addColorStop(0, 'rgba(5,6,10,0.7)');
    bleed.addColorStop(1, 'rgba(5,6,10,0)');
    ctx.fillStyle = bleed;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    blobPath(ctx, r, (t * 3) % FRAMES, 3);
    ctx.fillStyle = PALETTE.ink;
    ctx.fill();
    ctx.strokeStyle = HUE[hue] || PALETTE.bone;
    ctx.globalAlpha *= 0.9;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = dead ? 1 - age : 1;
    if (s.type === 'umbra') {
      // A crown of eyes.
      ctx.fillStyle = PALETTE.bone;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + t * 0.3;
        const rr = r * 0.55;
        const open = Math.sin(t * 2 + i) > -0.7;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * rr, Math.sin(a) * rr, 3.5, open ? 3.5 : 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (s.type === 'lenseater') {
      // One great eye, open or shut, toward where it walks.
      const ex = hx * (r - 10);
      const ey = hy * (r - 10);
      ctx.fillStyle = s.eye ? PALETTE.bone : 'rgba(239,230,200,0.25)';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 10, s.eye ? 10 : 2, Math.atan2(hy, hx), 0, Math.PI * 2);
      ctx.fill();
      if (s.eye) {
        ctx.fillStyle = PALETTE.ink;
        ctx.beginPath();
        ctx.arc(ex, ey, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      // Teeth along the front.
      ctx.fillStyle = PALETTE.bone;
      for (let i = -2; i <= 2; i++) {
        const a = Math.atan2(hy, hx) + i * 0.25;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - 0.08) * r, Math.sin(a - 0.08) * r);
        ctx.lineTo(Math.cos(a) * (r - 9), Math.sin(a) * (r - 9));
        ctx.lineTo(Math.cos(a + 0.08) * r, Math.sin(a + 0.08) * r);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      // The Long Dusk: a slow vortex of ink with a single dim eye.
      ctx.strokeStyle = 'rgba(80,70,100,0.6)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, r * (0.3 + i * 0.18), t * (0.4 + i * 0.1), t * (0.4 + i * 0.1) + Math.PI * 1.3);
        ctx.stroke();
      }
      ctx.fillStyle = PALETTE.bone;
      ctx.beginPath();
      ctx.ellipse(0, 0, 7, 7 * (0.6 + 0.4 * Math.sin(t)), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Its colour, as a glyph above, and its health as a bone arc.
    ctx.save();
    ctx.translate(0, -r - 12);
    glyph(ctx, hue, 6, HUE[hue]);
    ctx.restore();
    ctx.strokeStyle = 'rgba(239,230,200,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(s.hp / s.maxHp, 0, 1));
    ctx.stroke();
    if (s.burn > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 1, 0, 0, r + 12);
      g.addColorStop(0, `rgba(255,200,120,${0.6 * s.burn})`);
      g.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r + 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    void opts;
  }

  /** Eyes in the dark at an arc, a few seconds before a wave's Shades step in. */
  function drawTelegraph(ctx, arc, upcoming, t, rot = 0) {
    if (!upcoming.length) return;
    const strength = clamp(1 - Math.min(...upcoming.map((u) => u.in)) / 4, 0.1, 1);
    ctx.save();
    if (rot) {
      // Eyes stay level on a turned table: draw about the arc in screen-aligned axes.
      ctx.translate(arc.x, arc.y);
      ctx.rotate(Math.PI / 2);
      ctx.translate(-arc.x, -arc.y);
    }
    const g = ctx.createRadialGradient(arc.x, arc.y, 10, arc.x, arc.y, 120);
    g.addColorStop(0, `rgba(5,6,10,${0.55 * strength})`);
    g.addColorStop(1, 'rgba(5,6,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(239,230,200,${0.4 + 0.6 * strength})`;
    for (let i = 0; i < Math.min(5, upcoming.length); i++) {
      const u = upcoming[i];
      const k = i * 1.7 + u.in;
      const x = arc.x + Math.cos(k * 1.3) * 34 - (rot ? arc.uy : arc.ux) * 10 * i;
      const y = arc.y + Math.sin(k * 0.9) * 22 - (rot ? -arc.ux : arc.uy) * 10 * i;
      const blink = Math.sin(t * 3 + i) > -0.6;
      ctx.beginPath();
      ctx.ellipse(x - 3, y, 1.8, blink ? 1.8 : 0.4, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 3, y, 1.8, blink ? 1.8 : 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return { draw, drawTelegraph };
}
