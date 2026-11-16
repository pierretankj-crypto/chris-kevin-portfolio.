import '@fontsource/archivo-black/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/luckiest-guy/400.css';
import './styles/base.css';
import './styles/portfolio.css';

import { gsap } from 'gsap';
import { initMenu } from './ui/menu.js';
import { initTransitions } from './ui/transition.js';
import { tilt } from './ui/tilt.js';
import { initSound } from './ui/music.js';

const REEL_EMBED = 'https://www.instagram.com/reel/DfdhwiKpitK/embed/';

initMenu();
initTransitions();
const music = initSound();
if (import.meta.env.DEV) window.__music = music;

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- cover: 3D tilt + sticker burst shape
const coverScene = document.querySelector('.cover-scene');
const cover = document.querySelector('.cover');
tilt(coverScene, cover, { maxX: 8, maxY: 11 });

const burst = document.querySelector('.cover__sticker-burst');
if (burst) {
  let d = '';
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : 0.68 + ((i * 37) % 10) / 60;
    d += `${i ? 'L' : 'M'}${(Math.cos(a) * 100 * r).toFixed(1)},${(Math.sin(a) * 68 * r - 12).toFixed(1)}`;
  }
  burst.setAttribute('d', d + 'Z');
}

// ---- the reel: muted, endless loop, with a pause control
const screen = document.querySelector('.screen');
const video = screen?.querySelector('video');
if (video) {
  const toggle = screen.querySelector('.screen__toggle');
  const toggleLabel = screen.querySelector('.screen__toggle-label');
  const bar = screen.querySelector('.screen__progress i');
  const now = screen.querySelector('.screen__now');
  let userPaused = reduced; // respect "reduce motion": start paused
  video.muted = true;

  const sync = () => {
    const paused = video.paused;
    screen.classList.toggle('is-paused', paused);
    toggleLabel.textContent = paused ? 'Play' : 'Pause';
    toggle.setAttribute('aria-pressed', String(paused));
  };
  const tryPlay = () => video.play().catch(() => sync());

  if (reduced) video.removeAttribute('autoplay');
  else tryPlay();

  toggle.addEventListener('click', () => {
    if (video.paused) {
      userPaused = false;
      tryPlay();
    } else {
      userPaused = true;
      video.pause();
    }
  });
  video.addEventListener('play', sync);
  video.addEventListener('pause', sync);
  // belt and braces: some browsers stall on `loop`; restart if it ever ends
  video.addEventListener('ended', () => {
    video.currentTime = 0;
    tryPlay();
  });

  // pause while scrolled out of view, pick up again when it's back
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && !userPaused) tryPlay();
    else if (!entry.isIntersecting && !video.paused) video.pause();
  }, { threshold: 0.15 }).observe(video);

  // The music is this reel's own soundtrack (same 24s loop), so when it's
  // playing, keep the picture locked to it: nudge the playback rate for small
  // drift, jump for big drift.
  const followMusic = () => {
    if (!music.audible || video.paused || video.seeking || !music.duration) {
      if (video.playbackRate !== 1) video.playbackRate = 1;
      return;
    }
    const d = video.duration;
    const target = music.position() % d;
    let drift = video.currentTime - target;
    if (drift > d / 2) drift -= d;
    else if (drift < -d / 2) drift += d;
    if (Math.abs(drift) > 0.3) video.currentTime = target;
    else video.playbackRate = Math.min(1.08, Math.max(0.92, 1 - drift * 0.6));
  };

  // run the sync from the video's own clock and a timer too, not only on
  // animation frames (those pause in background tabs)
  video.addEventListener('timeupdate', followMusic);
  video.addEventListener('playing', followMusic);
  setInterval(followMusic, 250);

  const soundNote = screen.querySelector('.screen__sound');
  music.onChange((m) => {
    if (soundNote) soundNote.textContent = m.audible ? 'with sound' : 'sound off';
    followMusic();
  });

  let shown = -1;
  const tick = () => {
    if (video.duration) {
      followMusic();
      bar.style.transform = `scaleX(${video.currentTime / video.duration})`;
      const s = Math.floor(video.currentTime);
      if (s !== shown) {
        shown = s;
        now.textContent = `0:${String(s).padStart(2, '0')}`;
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
  sync();
}

// ---- entrance
if (!reduced) {
  const tl = gsap.timeline({ delay: 0.55, defaults: { ease: 'expo.out' } });
  tl.from('.work__title', { yPercent: 40, opacity: 0, duration: 1.2 })
    .from('.work__count, .work__head .page-label', { opacity: 0, duration: 0.8 }, 0.2)
    .from('.screen', { y: 70, opacity: 0, duration: 1.3 }, 0.1)
    .from('.cover-scene', { y: 80, rotation: -6, opacity: 0, duration: 1.3 }, 0.2)
    .from('.cover__title', { scale: 0.4, opacity: 0, duration: 0.9, ease: 'back.out(2.2)' }, 0.65)
    .from('.cover__sticker', { scale: 0, duration: 0.7, ease: 'back.out(3)' }, 0.85)
    .from('.project__info > *', { y: 30, opacity: 0, duration: 1, stagger: 0.07 }, 0.35);
}

// ---- player (official Instagram embed, loaded only when asked for)
const dialog = document.querySelector('.player');
const iframe = dialog.querySelector('iframe');

function openPlayer() {
  music.hold(); // Instagram's player has its own sound
  iframe.src = REEL_EMBED;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else window.open('https://www.instagram.com/reel/DfdhwiKpitK/', '_blank', 'noopener');
  if (!reduced) gsap.fromTo('.player__frame', { scale: 0.86, y: 30, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.7, ease: 'expo.out' });
}
function closePlayer() {
  dialog.close();
}
dialog.addEventListener('close', () => {
  iframe.removeAttribute('src'); // stop playback
  music.release();
});
dialog.querySelector('.player__close').addEventListener('click', closePlayer);
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) closePlayer(); // backdrop click
});
document.querySelectorAll('.js-play').forEach((b) => b.addEventListener('click', openPlayer));
