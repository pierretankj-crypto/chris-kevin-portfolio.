import { gsap } from 'gsap';
import { fx } from './fx.js';

/**
 * The opening shot: a spark ignites, the sun bursts to life, rings draw on,
 * letters fall into orbit, the friend burns in, then the type lands.
 */
export function playIntro(hero, ui, { fast = false, reduced = false } = {}) {
  const u = fx.u;
  const finish = () => {
    hero.introDone = true;
    document.body.classList.add('intro-done');
    hero.startBeat();
  };

  if (reduced) {
    u.uSunIgnite.value = 1;
    u.uRingsDraw.value = 1;
    u.uDustIn.value = 1;
    u.uLettersIn.value = 1;
    u.uFriendIn.value = 1;
    fx.flash = 0;
    ui.revealText(true);
    ui.revealChrome(true);
    finish();
    return null;
  }

  fx.flash = 0;
  const tl = gsap.timeline({ onComplete: finish });
  tl.to(u.uSunIgnite, { value: 0.05, duration: 0.8, ease: 'power2.in' }, 0.1)
    .add(() => hero.ignite(), 0.95)
    .to(u.uSunIgnite, { value: 1, duration: 1.3, ease: 'elastic.out(1, 0.55)' }, 0.95)
    .fromTo(fx, { flash: 0.35 }, { flash: 0, duration: 0.9, ease: 'power3.out' }, 0.95)
    .to(u.uRingsDraw, { value: 1, duration: 1.7, ease: 'power2.inOut' }, 1.05)
    .to(u.uDustIn, { value: 1, duration: 2.0, ease: 'power1.out' }, 1.3)
    .to(u.uLettersIn, { value: 1, duration: 2.1, ease: 'power2.out' }, 1.35)
    .to(u.uFriendIn, { value: 1, duration: 1.7, ease: 'power1.inOut' }, 1.85)
    .add(() => ui.revealText(), 2.35)
    .add(() => ui.revealChrome(), 3.1)
    .to({}, { duration: 0.6 }, 3.1);

  if (fast) tl.timeScale(2.2);

  ui.onSkip(() => {
    if (tl.progress() < 1) tl.progress(1);
  });
  return tl;
}
