import '@fontsource/archivo-black/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles/base.css';
import './styles/hero.css';

import { HeroScene, detectQuality } from './hero/HeroScene.js';
import { fx } from './hero/fx.js';
import { playIntro } from './hero/Intro.js';
import { HeroUI } from './ui/heroUI.js';
import { initMenu } from './ui/menu.js';
import { initTransitions } from './ui/transition.js';
import { initSound } from './ui/music.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ui = new HeroUI();
initMenu();
initTransitions();
const music = initSound();

async function boot() {
  const canvas = document.getElementById('scene');
  let hero;
  try {
    hero = new HeroScene(canvas, {
      quality: detectQuality(),
      reducedMotion: reduced,
      music,
      onBeat: (k) => ui.beat(k),
    });
  } catch (err) {
    console.error('WebGL unavailable', err);
    ui.fail();
    return;
  }

  const fonts = document.fonts
    ? Promise.all([
        document.fonts.load('400 1em "Archivo Black"'),
        document.fonts.load('italic 400 1em "Instrument Serif"'),
        document.fonts.load('400 1em "JetBrains Mono"'),
      ]).catch(() => {})
    : Promise.resolve();

  try {
    await hero.load((p) => ui.setProgress(p * 0.92));
    await fonts;
    ui.setProgress(1);
  } catch (err) {
    console.error(err);
    ui.fail();
    return;
  }

  hero.start();

  let seen = false;
  try {
    seen = sessionStorage.getItem('ck-intro-seen') === '1';
    sessionStorage.setItem('ck-intro-seen', '1');
  } catch {
    /* storage blocked: always play the full intro */
  }

  let intro = null;
  setTimeout(() => {
    document.body.classList.remove('is-loading');
    intro = playIntro(hero, ui, { fast: seen, reduced });
    if (import.meta.env.DEV) window.__intro = intro;
  }, 300);

  // handy for tuning from the console
  if (import.meta.env.DEV) {
    window.__hero = hero;
    window.__fx = fx;
    window.__music = music;
    window.__intro = intro;
  }
}

boot();
