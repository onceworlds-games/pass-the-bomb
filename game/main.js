// Boot. Joins the room first (before anything is built), then hands the canvas to the game.
// With ?poster=<name> it draws one piece of store art instead and never touches the SDK (see poster.js).

import { connect } from './net.js';
import { startGame } from './game.js';

async function main() {
  const canvas = document.getElementById('c');
  const poster = new URLSearchParams(location.search).get('poster');
  if (poster) {
    const { runPoster } = await import('./poster.js');
    await runPoster(poster, canvas);
    return;
  }
  try {
    document.fonts.load('40px "Luckiest Guy"');
  } catch {
    // the fallback font draws until it arrives
  }
  const conn = await connect();
  startGame({ ow: conn.ow, room: conn.room, standalone: conn.standalone, canvas });
}

main().catch((err) => {
  setTimeout(() => {
    throw err; // reported to the creator's dashboard
  });
});
