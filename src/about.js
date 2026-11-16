import '@fontsource/archivo-black/400.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/luckiest-guy/400.css';
import './styles/base.css';
import './styles/about.css';

import { initMenu } from './ui/menu.js';
import { initTransitions } from './ui/transition.js';
import { tilt } from './ui/tilt.js';
import { initSound } from './ui/music.js';
import { createJawWarp } from './about/JawWarp.js';
import { Burst } from './about/Burst.js';

// Mouth position in the cut-out photo (fractions of width / height, y down).
const MOUTH = { u: 0.482, v: 0.451 };

initMenu();
initTransitions();
initSound();

const scene = document.querySelector('.card-scene');
const card = document.querySelector('.card');
const face = document.querySelector('.card__face');
const photo = document.querySelector('.card__photo');
const img = document.querySelector('.card__img');
const canvas = document.querySelector('.card__canvas');
const svg = document.querySelector('.burst');

tilt(scene, card, { maxX: 7, maxY: 10 });

async function boot() {
  let jaw = { jaw: 0 };
  try {
    const warp = await createJawWarp(canvas, img, MOUTH);
    if (warp) {
      jaw = warp;
      card.classList.add('has-gl');
      // if the GPU context is ever lost, fall back to the plain photo
      canvas.addEventListener('webglcontextlost', () => card.classList.remove('has-gl'));
    }
  } catch (err) {
    console.warn('Jaw warp unavailable, using the plain photo.', err);
  }

  await document.fonts?.load('1em "Luckiest Guy"').catch(() => {});

  const burst = new Burst(svg, card, photo, MOUTH, { jaw, shakeTarget: face });
  // let the page curtain clear before the first shout
  setTimeout(() => burst.play(), 900);
  if (import.meta.env.DEV) window.__burst = burst;
  photo.addEventListener('pointerenter', () => burst.replay());
  photo.addEventListener('click', () => burst.replay());
}

boot();
