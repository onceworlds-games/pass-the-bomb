# Glint

The sun is gone and the Shades are coming. All you have is the Lamp, a captured shard of daylight, and a table of
mirrors, prisms and lenses. Route the beam, bounce it, split it into colours, focus it to a burning point, and burn
back the dark before it reaches the Heart. A tower defence where light is the weapon and you build the weapon out of
glass, live, as the night closes in.

Play it at [onceworlds.com/play/glint](https://onceworlds.com/play/glint).

## How to play

- **Dusk.** Pick glass from the tray and place it on the felt. Everything is free. The forecast says where the
  first wave comes from and what colour it wants; dotted trails show the lanes the Shades will walk, with the
  glyph of every colour that walks each one.
- **Night.** Three to six waves. Light that lies *along* a lane burns; light that crosses it only scorches.
  Changing glass now costs Focus (place 10, move 5, turn 1 per 15°), which refills at 8 a second. Undo takes
  back your last change within a few seconds and returns its Focus.
- **Colour.** White light burns most things. Tinted Shades burn twice as fast under their own colour; Veils
  barely feel anything else. Prisms fan white into red, green and blue; filters keep one colour.
- **Heat.** Every piece absorbs a little of what it handles. Stack six beams on one mirror and it cracks in
  seconds; leave it hot and it shatters. Heat-sinks cool their neighbours.
- **Dawn.** The ledger, then one draft of three (glass, an upgrade or a relic), and sometimes a Fate: a bargain
  with a price. Watch again plays the night's last seconds at half speed. Twelve nights to win; then the table
  stays open in Endless.

### Controls

Keyboard and mouse: `1`-`9` pick glass, click to place or select, drag to move, `Q`/`E` or the wheel to turn
(`Shift` for 5° steps), `X` or right-click to sell, `Z` undo, drag the Lamp's handle to aim it, `Space` begins the
night or the next wave, `F` Flare, `R` Dawn, `G` Focus Surge, `Alt` shows every beam's power, `+`/`-` zoom.

Touch: tap a tray card, then a cell (press and slide to see where it lands before you lift). Tap placed glass for
a rotation dial with detents and a sell button; drag glass to move it; drag the Lamp to aim. On a phone held
upright the table turns a quarter so its long side runs up the screen, Lamp at the bottom; held sideways it fills
the height. The whole table is always on screen.

## What is in it

- **13 kinds of glass:** mirror, splitter, prism, red/green/blue filters, convex lens (a burning point), concave
  lens (spreads light into a fence ink wades through), combiner, crystal, rotor (a mirror that swings between two
  rests: one beam, two lanes), shutter, heat-sink, black glass.
- **10 Shades and 3 bosses:** Wisp, Creeper, Veil, Gnat swarms, Eater, Burrower, Gloom, Twain, Mimic, Moth;
  Umbra (night 4), the Lens-Eater (night 8), the Long Dusk (night 12). Every hue has a glyph (triangle, square,
  circle, diamond), so the game plays without colour.
- **A roguelite run:** 24 relics, 6 upgrades, 8 Fates, 4 kits (Observer, Smith, Alchemist, Watchman), 4 boards
  (Octagon, Cross, Twin Hearts, Spiral), 8 levels of Longer Dusk, a Daily Dusk with a shared seed and two
  modifiers, and an Endless mode after night 12.
- **The Observatory:** the hub between runs, an open logbook: the table's setup (kit, board, Longer Dusk, the
  daily), your role, the almanac (every Shade you meet writes a page), the cabinet of earned cosmetics (felt, brass,
  beam, Heart) and your records. The title and the Observatory sit over the table itself, running a slow night.
- **Roles:** every Optician brings one. Smith (Focus costs 30% less, sales refund 70%), Seer (the forecast reads
  every wave of the night), Warden (a Flare also shields the Heart), Alchemist (filters and combiners burn
  harder).
- **Abilities:** Flare (burn and scare everything near a point), Dawn (all beams doubled for 6 s, charged by light
  that reaches the Heart) and Focus Surge.

## Multiplayer

A friends game: up to four Opticians share one table, one deck and one Heart, each with their own Focus and a role.
The host's page runs the simulation and everyone else sends requests; glass and Lamp angles live in room state,
the ink travels as snapshots and events in batches ten times a second, and a reload, a dropped connection or a
change of host picks the night up where it was. A friend who arrives mid-night watches and takes a seat at the
next break between waves.

## How it is built

No build step: plain ES modules and Canvas 2D.

- `game/sim/` is the pure, deterministic simulation (seeded random, fixed 30 Hz ticks, no DOM): boards and flow
  fields, the beam tracer, light and damage, Shades, wave plans, the night state machine, the run (drafts, relics,
  Fates, kits, ascension, the daily) and the harness bots.
- `game/render/` draws it: the camera (fit, zoom and the quarter turn for screens held upright), the cached
  table, the beam with its bloom and dust, the glass, the ink, particles, and the demo night behind the title.
- `game/ui/` is the HUD, pointer and keyboard input, and the screens (`book.css` styles the logbook);
  `game/net/session.js` is the host/mirror session over the platform's rooms; `game/audio/` synthesises every
  sound; `game/poster.js` renders the store art.
- `test/` runs with `node --test`; `scripts/balance.mjs` plays the simulation with bots.

### Running it

```
npm run dev        # serves game/ on http://127.0.0.1:8790 (a solo table, no platform)
npm test           # unit, property and fuzz tests
npm run balance    # the balance harness (see --runs, --archetypes, --relics, --heat, --all)
npm run smoke      # headless Chrome: loads the game, drives a night, reports errors
npm run touch      # headless Chrome as a phone, held upright and sideways: taps, the dial, Undo, 44 px targets
npm run store      # captures the store art from the game's poster scenes into store/
```

To test on a local Onceworlds platform, deploy the folder with the Onceworlds CLI and open `/play/glint`.
`scripts/mp.mjs` runs three guests through the lobby, a night, guest commands and lies, Undo, a reload of a
guest and of the host, a dropped connection and a change of host, then a fourth friend who arrives mid-night.
Opened on its own (no platform), the page exposes `window.__glint` for the smoke, touch and drive scripts.

## Badges and leaderboards

Badges: First Burn, Rainbow, Focus Point, Mirror Maze, Heat Wave, Umbra Down, Lens-Eater Down, Long Dusk Done,
Twin Hearts, Ascendant, Daily Dusk. Leaderboards: `best-score`, `endless-nights`, `daily-score`.

## Licence

MIT, see `LICENSE`. The bundled fonts (Cormorant Garamond, IBM Plex Sans) are under the SIL Open Font License, see
`game/fonts/`.
