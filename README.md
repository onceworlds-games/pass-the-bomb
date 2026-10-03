# Glint

The sun is gone and the Shades are coming. All you have is the Lamp, a captured shard of daylight, and a table of
mirrors, prisms and lenses. Route the beam, bounce it, split it into colours, focus it to a burning point, and burn
back the dark before it reaches the Heart. A tower defence where light is the weapon and you build the weapon out of
glass, live, as the night closes in.

Play it at [onceworlds.com/play/glint](https://onceworlds.com/play/glint).

## How to play

- **Dusk.** Pick glass from the tray and place it on the felt. Everything is free. The forecast says where the
  first wave comes from and what colour it wants; dotted trails show the lanes the Shades will walk.
- **Night.** Three to six waves. Light that lies *along* a lane burns; light that crosses it only scorches.
  Changing glass now costs Focus (place 10, move 5, turn 1 per 15°), which refills at 8 a second.
- **Colour.** White light burns most things. Tinted Shades burn twice as fast under their own colour; Veils
  barely feel anything else. Prisms fan white into red, green and blue; filters keep one colour.
- **Heat.** Every piece absorbs a little of what it handles. Stack six beams on one mirror and it cracks in
  seconds; leave it hot and it shatters. Heat-sinks cool their neighbours.
- **Dawn.** The ledger, then one draft of three (glass, an upgrade or a relic), and sometimes a Fate: a bargain
  with a price. Twelve nights to win; then the table stays open in Endless.

### Controls

Keyboard and mouse: `1`-`9` pick glass, click to place or select, drag to move, `Q`/`E` or the wheel to turn
(`Shift` for 5° steps), `X` or right-click to sell, drag the Lamp's handle to aim it, `Space` begins the night or
the next wave, `F` Flare, `R` Dawn, `G` Focus Surge, `Alt` shows every beam's power, `+`/`-` zoom.

Touch: tap a tray card, tap a cell. Tap placed glass for a rotation dial with detents and a sell button; drag glass
to move it; drag the Lamp's handle to aim; the zoom buttons pan and zoom the table on small screens.

## What is in it

- **13 kinds of glass:** mirror, splitter, prism, red/green/blue filters, convex and concave lens, combiner,
  crystal, rotor, shutter, heat-sink, black glass.
- **10 Shades and 3 bosses:** Wisp, Creeper, Veil, Gnat swarms, Eater, Burrower, Gloom, Twain, Mimic, Moth;
  Umbra (night 4), the Lens-Eater (night 8), the Long Dusk (night 12). Every hue has a glyph (triangle, square,
  circle, diamond), so the game plays without colour.
- **A roguelite run:** 24 relics, 6 upgrades, 8 Fates, 4 kits (Observer, Smith, Alchemist, Watchman), 4 boards
  (Octagon, Cross, Twin Hearts, Spiral), 8 levels of Longer Dusk, a Daily Dusk with a shared seed and two
  modifiers, and an Endless mode after night 12.
- **The Observatory:** the hub between runs, with the almanac (every Shade you meet writes a page), earned
  cosmetics (felt, brass, beam, Heart) and your records.
- **Abilities:** Flare (burn and scare everything near a point), Dawn (all beams doubled for 6 s, charged by light
  that reaches the Heart) and Focus Surge.

## Multiplayer

A friends game: up to four Opticians share one table, one deck and one Heart, each with their own Focus and a role
(Smith, Seer, Warden, Alchemist). The host's page runs the simulation and everyone else sends requests; glass and
Lamp angles live in room state, the ink travels as snapshots, and a reload, a dropped connection or a change of host
picks the night up where it was.

## How it is built

No build step: plain ES modules and Canvas 2D.

- `game/sim/` is the pure, deterministic simulation (seeded random, fixed 30 Hz ticks, no DOM): boards and flow
  fields, the beam tracer, light and damage, Shades, wave plans, the night state machine, the run (drafts, relics,
  Fates, kits, ascension, the daily) and the harness bots.
- `game/render/` draws it: the cached table, the beam with its bloom and dust, the glass, the ink, particles.
- `game/ui/` is the HUD, pointer and keyboard input, and the screens; `game/net/session.js` is the host/mirror
  session over the platform's rooms; `game/audio/` synthesises every sound; `game/poster.js` renders the store art.
- `test/` runs with `node --test`; `scripts/balance.mjs` plays the simulation with bots.

### Running it

```
npm run dev        # serves game/ on http://127.0.0.1:8790 (a solo table, no platform)
npm test           # unit, property and fuzz tests
npm run balance    # the balance harness (see --runs, --archetypes, --relics, --heat, --all)
npm run smoke      # headless Chrome: loads the game, drives a night, reports errors
npm run store      # captures the store art from the game's poster scenes into store/
```

To test on a local Onceworlds platform, deploy the folder with the Onceworlds CLI and open
`/play/glint`; `window.__glint` exposes the scene and session for scripts, and `scripts/mp.mjs` runs three
guests through a night, a reload, a dropped connection and a change of host.

## Badges and leaderboards

Badges: First Burn, Rainbow, Focus Point, Mirror Maze, Heat Wave, Umbra Down, Lens-Eater Down, Long Dusk Done,
Twin Hearts, Ascendant, Daily Dusk. Leaderboards: `best-score`, `endless-nights`, `daily-score`.

## Licence

MIT, see `LICENSE`. The bundled fonts (Cormorant Garamond, IBM Plex Sans) are under the SIL Open Font License, see
`game/fonts/`.
