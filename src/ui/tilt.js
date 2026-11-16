/**
 * Pointer-driven 3D tilt with easing. Writes CSS variables on `target`:
 *   --rx / --ry  rotation in degrees
 *   --mx / --my  pointer position in % (for glare and holo sheen)
 *   --pd         0..1 distance from centre (for glare strength)
 */
export function tilt(surface, target = surface, { maxX = 9, maxY = 13, idle = true } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tx = 0.5;
  let ty = 0.5;
  let cx = 0.5;
  let cy = 0.5;
  let active = false;

  surface.addEventListener('pointermove', (e) => {
    const r = surface.getBoundingClientRect();
    tx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    ty = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    active = true;
  });
  surface.addEventListener('pointerleave', () => {
    tx = 0.5;
    ty = 0.5;
    active = false;
  });

  const loop = (t) => {
    const k = reduced ? 1 : 0.075;
    let gx = tx;
    let gy = ty;
    if (!active && idle && !reduced) {
      gx += Math.sin(t * 0.00055) * 0.18;
      gy += Math.cos(t * 0.00043) * 0.12;
    }
    cx += (gx - cx) * k;
    cy += (gy - cy) * k;
    const s = target.style;
    s.setProperty('--ry', `${((cx - 0.5) * 2 * maxY).toFixed(2)}deg`);
    s.setProperty('--rx', `${((0.5 - cy) * 2 * maxX).toFixed(2)}deg`);
    s.setProperty('--mx', `${(cx * 100).toFixed(1)}%`);
    s.setProperty('--my', `${(cy * 100).toFixed(1)}%`);
    s.setProperty('--pd', Math.min(1, Math.hypot(cx - 0.5, cy - 0.5) * 2).toFixed(3));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
