/** Full-screen menu: "Menu +" toggles a circular reveal. */
export function initMenu() {
  const btn = document.querySelector('.menu-btn');
  const menu = document.getElementById('menu');
  if (!btn || !menu) return null;
  const label = btn.querySelector('.menu-btn__label');

  const set = (open) => {
    document.body.classList.toggle('menu-open', open);
    btn.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-hidden', String(!open));
    if (label) label.textContent = open ? 'Close' : 'Menu';
  };

  btn.addEventListener('click', () => set(!document.body.classList.contains('menu-open')));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') set(false);
  });
  menu.querySelectorAll('[aria-current="page"]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      set(false);
    }),
  );
  return { set };
}
