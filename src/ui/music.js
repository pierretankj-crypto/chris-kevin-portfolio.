/**
 * Site-wide "bu bu buggin" music.
 *
 * - Web Audio buffer source: loops with no gap, fades in/out, and feeds an
 *   analyser so the visuals can react to the beat.
 * - Browsers block sound until the visitor interacts, so if it can't start
 *   straight away it starts on the first click / tap / key press.
 * - The on/off choice is remembered (localStorage) and the song carries on
 *   from the same spot when you move between pages (sessionStorage).
 */
const SRC = `${import.meta.env.BASE_URL}audio/buggin.m4a`;
const PREF_KEY = 'ck-sound';
const POS_KEY = 'ck-music-pos';
const VOLUME = 0.8;

const store = {
  get(area, key) {
    try {
      return window[area].getItem(key);
    } catch {
      return null;
    }
  },
  set(area, key, value) {
    try {
      window[area].setItem(key, value);
    } catch {
      /* storage blocked: preferences just won't persist */
    }
  },
};

class Music {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.source = null;
    this.playing = false;
    this.holds = 0;
    this.wantOn = store.get('localStorage', PREF_KEY) !== 'off';
    this.offset = 0;
    this.startedAt = 0;
    this.listeners = new Set();
    // bass: raw low-end level; kick: how far the bass jumps above its own
    // running average (a beat / hit), which is what the visuals pulse on.
    this.smoothed = { bass: 0, mid: 0, all: 0, avg: 0, kick: 0 };
    this.lastLevelsAt = 0;

    // Pick up where the previous page left off (as if it kept playing).
    const saved = JSON.parse(store.get('sessionStorage', POS_KEY) || 'null');
    if (saved && typeof saved.pos === 'number') {
      this.offset = saved.pos + (saved.playing ? (Date.now() - saved.at) / 1000 : 0);
    }
  }

  async init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.7;
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.gain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      const data = await (await fetch(SRC)).arrayBuffer();
      this.buffer = await this.ctx.decodeAudioData(data);

      this.ctx.onstatechange = () => this.emit();
      if (this.wantOn) this.start();

      const unlock = (e) => {
        // the Sound button makes its own decision (see toggle)
        if (e.target && e.target.closest && e.target.closest('.sound-btn')) return;
        if (this.wantOn && !this.holds) this.start();
        if (this.ctx.state === 'running') {
          for (const ev of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(ev, unlock, true);
        }
      };
      for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, true);
      window.addEventListener('pagehide', () => this.save());
      this.emit();
    })().catch((err) => console.warn('Music unavailable', err));
    return this.ready;
  }

  /** Seconds into the loop. */
  position() {
    if (!this.buffer) return 0;
    const d = this.buffer.duration;
    const t = this.playing ? this.ctx.currentTime - this.startedAt : this.offset;
    return ((t % d) + d) % d;
  }

  get duration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  /** Actually making sound right now. */
  get audible() {
    return this.playing && this.ctx && this.ctx.state === 'running';
  }

  /** Wants sound but the browser is still waiting for a click. */
  get waiting() {
    return this.wantOn && !this.audible && !this.holds;
  }

  start() {
    if (!this.ctx || !this.buffer) return;
    this.ctx.resume().then(() => this.emit()).catch(() => {});
    if (this.playing) return;
    const off = this.position();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.connect(this.gain);
    src.start(0, off);
    this.startedAt = this.ctx.currentTime - off;
    this.source = src;
    this.playing = true;
    const g = this.gain.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(g.value, this.ctx.currentTime);
    g.linearRampToValueAtTime(VOLUME, this.ctx.currentTime + 1.2);
    this.emit();
  }

  stop() {
    if (!this.playing) return;
    this.offset = this.position();
    const now = this.ctx.currentTime;
    const g = this.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + 0.35);
    this.source.stop(now + 0.4);
    this.source = null;
    this.playing = false;
    this.emit();
  }

  toggle() {
    // playing -> off; off or "tap for sound" -> on
    this.wantOn = !this.audible;
    store.set('localStorage', PREF_KEY, this.wantOn ? 'on' : 'off');
    if (this.wantOn) this.start();
    else this.stop();
  }

  /** Temporarily silence (e.g. while another player has the sound). */
  hold() {
    this.holds++;
    this.stop();
  }

  release() {
    this.holds = Math.max(0, this.holds - 1);
    if (!this.holds && this.wantOn) this.start();
  }

  /** Smoothed 0..1 energies; call once per animation frame. */
  levels() {
    const s = this.smoothed;
    const now = performance.now();
    if (now - this.lastLevelsAt < 8) return s; // already sampled this frame
    this.lastLevelsAt = now;
    if (!this.audible) {
      s.bass *= 0.9;
      s.mid *= 0.9;
      s.all *= 0.9;
      s.kick *= 0.85;
      return s;
    }
    this.analyser.getByteFrequencyData(this.freq);
    const band = (a, b) => {
      let sum = 0;
      for (let i = a; i < b; i++) sum += this.freq[i];
      return sum / ((b - a) * 255);
    };
    const bass = band(1, 7); // ~40–300 Hz
    s.bass += (bass - s.bass) * (bass > s.bass ? 0.6 : 0.15); // fast attack, slow release
    s.mid += (band(10, 60) - s.mid) * 0.3;
    s.all += (band(1, 120) - s.all) * 0.3;
    if (!s.primed) {
      s.avg = bass; // seed the running average so it doesn't start "all hits"
      s.primed = true;
    }
    s.avg += (bass - s.avg) * 0.04;
    const hit = Math.min(1, Math.max(0, (bass - s.avg - 0.02) * 6));
    s.kick = Math.max(hit, s.kick * 0.86);
    return s;
  }

  save() {
    store.set('sessionStorage', POS_KEY, JSON.stringify({ pos: this.position(), at: Date.now(), playing: this.audible }));
  }

  onChange(fn) {
    this.listeners.add(fn);
    fn(this);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }
}

export const music = new Music();

/** Wire the top-bar "Sound" button and start loading the track. */
export function initSound() {
  const btn = document.querySelector('.sound-btn');
  const label = btn?.querySelector('.sound-btn__label');
  if (btn) {
    btn.addEventListener('click', () => music.toggle());
    music.onChange((m) => {
      const on = m.audible;
      btn.classList.toggle('is-on', on);
      btn.classList.toggle('is-waiting', m.waiting);
      btn.setAttribute('aria-pressed', String(on || m.waiting));
      if (label) label.textContent = on ? 'Sound on' : m.waiting ? 'Tap for sound' : 'Sound off';
    });
  }
  music.init();
  return music;
}
