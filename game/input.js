// Keyboard (WASD and arrows move, Space dashes) plus the platform's touch stick and "Dash" button, as one movement vector
// and a dash press that is remembered for a moment (so a press just before the cooldown ends still counts).

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

export function createInput(ow) {
  const keys = new Set();
  let dashBuf = 0;
  let touchDash = false;

  const keyName = (e) => String(e.key || '').toLowerCase();

  addEventListener('keydown', (e) => {
    const k = keyName(e);
    if (MOVE_KEYS.has(k)) {
      keys.add(k);
      e.preventDefault();
    } else if (k === ' ' || e.code === 'Space') {
      if (!e.repeat) dashBuf = 0.16;
      e.preventDefault();
    }
  });
  addEventListener('keyup', (e) => {
    keys.delete(keyName(e));
  });
  const clear = () => {
    keys.clear();
    touchDash = false;
  };
  addEventListener('blur', clear);
  document.addEventListener('visibilitychange', () => document.hidden && clear());

  const api = {
    /** Fills out.x, out.y with the wanted direction, length at most 1. */
    move(out) {
      let x = 0;
      let y = 0;
      if (keys.has('a') || keys.has('arrowleft')) x -= 1;
      if (keys.has('d') || keys.has('arrowright')) x += 1;
      if (keys.has('w') || keys.has('arrowup')) y -= 1;
      if (keys.has('s') || keys.has('arrowdown')) y += 1;
      try {
        const st = ow.controls && ow.controls.stick;
        if (st && Number.isFinite(st.x) && Number.isFinite(st.y)) {
          x += st.x;
          y += st.y;
        }
      } catch {
        // ignore
      }
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      out.x = x;
      out.y = y;
      return out;
    },
    /** Call once per frame: remembers the touch button's press. */
    poll() {
      let down = false;
      try {
        down = !!(ow.controls && ow.controls.pressed('dash'));
      } catch {
        down = false;
      }
      if (down && !touchDash) dashBuf = 0.16;
      touchDash = down;
    },
    tick(dt) {
      if (dashBuf > 0) dashBuf -= dt;
    },
    dashWanted() {
      return dashBuf > 0;
    },
    clearDash() {
      dashBuf = 0;
    },
    press() {
      dashBuf = 0.16;
    },
  };
  return api;
}
