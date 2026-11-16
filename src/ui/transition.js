import { gsap } from 'gsap';

/**
 * Page-to-page curtain: slides up off the page on load, slides back up over
 * the page before following an internal link.
 */
export function initTransitions() {
  const curtain = document.querySelector('.curtain');
  if (!curtain) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const d = reduced ? 0 : 1;

  gsap.to(curtain, { yPercent: -100, duration: 0.95 * d, ease: 'expo.inOut', delay: 0.05 });

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented) return;
    if (a.target === '_blank' || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname) return;
    e.preventDefault();
    gsap.fromTo(
      curtain,
      { yPercent: 100 },
      {
        yPercent: 0,
        duration: 0.75 * d,
        ease: 'expo.inOut',
        onComplete: () => {
          location.href = url.href;
        },
      },
    );
  });

  // Coming back via the browser's back button restores a frozen page.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) gsap.set(curtain, { yPercent: -100 });
  });
}
