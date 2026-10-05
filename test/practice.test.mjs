import test from 'node:test';
import assert from 'node:assert/strict';
import { createPractice, stepPractice } from '../game/practice.js';
import { makeChar, stepChar } from '../game/sim.js';
import { STEP, W, H, R } from '../game/rules.js';
import { mapOf } from '../game/maps.js';

test('the title show: six bots pass the bomb around for a minute without a hitch', () => {
  const p = createPractice(3, 'backyard', 6, false);
  for (let i = 0; i < 60 * 90; i++) {
    stepPractice(p, STEP, null);
    for (const e of p.bw.bots.values()) {
      assert.ok(Number.isFinite(e.ch.x) && Number.isFinite(e.ch.y));
      assert.ok(e.ch.x >= R - 1e-6 && e.ch.x <= W - R + 1e-6 && e.ch.y >= R - 1e-6 && e.ch.y <= H - R + 1e-6);
    }
  }
  assert.ok(p.passN >= 5, `only ${p.passN} passes in 90 s`);
  assert.equal(p.g.bombs.length, 1);
  assert.equal(p.g.out.length, 0, 'the practice bomb never blows');
});

test('the lobby practice: a bot chases the player, and the player can pass the bomb back', () => {
  const map = mapOf('backyard');
  let passedToMe = false;
  let passedBack = false;
  for (let seed = 1; seed <= 6 && !passedBack; seed++) {
    const p = createPractice(seed, 'backyard', 3, true);
    const me = makeChar(12, 12.4);
    for (let i = 0; i < 60 * 40; i++) {
      // a player who stands still when chased, then chases the nearest bot with the bomb in hand
      const hold = p.g.bombs[0].h === 'me';
      let mx = 0;
      let my = 0;
      if (hold) {
        let best = null;
        let bd = 1e9;
        for (const a of p.bw.agents) {
          if (!a.bot || !a.tag) continue;
          const d = Math.hypot(a.x - me.x, a.y - me.y);
          if (d < bd) { bd = d; best = a; }
        }
        if (best) { mx = best.x - me.x; my = best.y - me.y; }
      }
      stepChar(me, mx, my, false, STEP, map, hold, false);
      stepPractice(p, STEP, me);
      if (p.lastTo === 'me') passedToMe = true;
      if (passedToMe && p.lastFrom === 'me') passedBack = true;
    }
  }
  assert.ok(passedToMe, 'the bots never caught a player who stood still');
  assert.ok(passedBack, 'a chasing player never managed to pass the bomb on');
});
