// Serves game/ on a local port for a quick look without the platform (the SDK is absent: a solo table).
//   npm run dev        then open the printed URL (add ?poster=thumb1 for a poster scene)
import { serve } from './cdp.mjs';

const port = Number(process.env.PORT || 8790);
const { port: p } = await serve('game', port);
console.log(`Glint at http://127.0.0.1:${p}/  (Ctrl-C to stop)`);
