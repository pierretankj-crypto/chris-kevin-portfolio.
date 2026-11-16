import { gsap } from 'gsap';

/** DOM side of the hero: split type, reveal, beat reactions, menu, loader. */
export class HeroUI {
  constructor() {
    this.hero = document.querySelector('.hero');
    this.pct = document.querySelector('.loader__pct');
    this.skipBtn = document.querySelector('.skip');
    this.chrome = [document.querySelector('.topbar'), document.querySelector('.hero__meta'), document.querySelector('.hero__hint')];
    this.splitWords();
    this.chars = [...document.querySelectorAll('.hero .char')];
    gsap.set(this.chars, { yPercent: 115, rotate: 7 });
    this.timers = {};
    if (matchMedia('(pointer: coarse)').matches) {
      const hint = document.querySelector('.hero__hint');
      if (hint) hint.lastChild.textContent = 'Tap anywhere to go supernova';
    }
  }

  splitWords() {
    document.querySelectorAll('[data-split]').forEach((el) => {
      const text = el.textContent.trim();
      el.setAttribute('aria-label', text);
      el.textContent = '';
      for (const ch of text) {
        const mask = document.createElement('span');
        mask.className = 'mask';
        mask.setAttribute('aria-hidden', 'true');
        const c = document.createElement('span');
        c.className = 'char';
        c.textContent = ch;
        mask.appendChild(c);
        el.appendChild(mask);
      }
    });
  }

  setProgress(p) {
    if (this.pct) this.pct.textContent = String(Math.round(p * 100)).padStart(3, '0');
  }

  revealText(instant = false) {
    const name = [...document.querySelectorAll('.hero__name .char')];
    const role = [...document.querySelectorAll('.hero__role .char')];
    this.hero.classList.add('type-in');
    if (instant) {
      gsap.set([...name, ...role], { clearProps: 'transform' });
      return;
    }
    const opts = { yPercent: 0, rotate: 0, duration: 1.15, ease: 'expo.out', clearProps: 'transform' };
    gsap.to(name, { ...opts, stagger: 0.045 });
    gsap.to(role, { ...opts, stagger: 0.04, delay: 0.25 });
  }

  revealChrome(instant = false) {
    gsap.to(this.chrome, { opacity: 1, duration: instant ? 0 : 1, stagger: instant ? 0 : 0.12, ease: 'power2.out' });
  }

  onSkip(fn) {
    this.skipBtn?.addEventListener('click', fn, { once: true });
  }

  /** k: 0/1 = BU, 2 = BUGGIN, 3 = supernova */
  beat(k) {
    const cls = k < 2 ? 'beat-bu' : 'beat-buggin';
    const el = this.hero;
    el.classList.remove(cls);
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(cls);
    clearTimeout(this.timers[cls]);
    this.timers[cls] = setTimeout(() => el.classList.remove(cls), 520);
  }

  fail() {
    document.body.classList.remove('is-loading');
    document.body.classList.add('no-webgl', 'intro-done');
    this.revealText(true);
    this.revealChrome(true);
  }
}
