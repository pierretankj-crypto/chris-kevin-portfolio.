import * as THREE from 'three';
import { gsap } from 'gsap';
import { fx } from './fx.js';
import { RINGS, BEAT } from './config.js';
import { Sun } from './Sun.js';
import { Friend } from './Friend.js';
import { OrbitText } from './OrbitText.js';
import { Floor } from './Floor.js';
import { Particles } from './Particles.js';
import { Sky } from './Sky.js';
import { Post } from './Post.js';

export function detectQuality() {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || q === 'high') return q;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 700;
  const cores = navigator.hardwareConcurrency || 4;
  if (coarse || small || cores <= 4) return 'low';
  return 'high';
}

const CAM_BASE = new THREE.Vector3(0, 7.4, 17.2);
const CAM_TARGET = new THREE.Vector3(0, 2.75, 0);

export class HeroScene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ quality: 'high'|'low', reducedMotion: boolean, onBeat?: (k:number)=>void }} opts
   */
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.quality = opts.quality;
    this.reducedMotion = opts.reducedMotion;
    this.onBeat = opts.onBeat || (() => {});
    this.music = opts.music || null;
    // Start light and climb only if the GPU keeps up (see watchPerformance).
    this.maxDpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 1.75 : 1.25);
    this.dpr = Math.min(this.maxDpr, 1.25);
    this.pixelRatio = { value: this.dpr };
    this.needsResize = false;
    this.contextLost = false;
    this.perf = { times: [], upgradeLocked: false };

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x030203, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight), false);

    // If the graphics driver resets, pause, then rebuild sizes once it's back
    // (three.js re-uploads its own resources on restore).
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.dpr = 1;
      this.perf.upgradeLocked = true;
      this.needsResize = true;
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.copy(CAM_BASE);
    this.camera.lookAt(CAM_TARGET);

    this.pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    this.time = 0;
    this.beatRunning = false;
    this.lastHit = [-99, -99, -99];
    this.novaStart = -99;
    this.novaActive = false;
    this.introDone = false;
    this.spinBoost = 0;
    this._tmp = new THREE.Vector3();
    this._radial = new THREE.Vector3();
  }

  async load(onProgress = () => {}) {
    const tex = await new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}images/friend-hero.png`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    onProgress(0.35);

    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sky = new Sky(this.quality, this.pixelRatio);
    this.sun = new Sun(this.quality);
    this.friend = new Friend(tex);
    this.text = new OrbitText(this.quality);
    this.floor = new Floor(this.quality, size);
    this.particles = new Particles(this.quality, this.pixelRatio);
    this.scene.add(
      this.sky.group,
      this.sun.group,
      this.friend.group,
      this.text.group,
      this.floor.group,
      this.particles.group,
    );
    onProgress(0.6);

    this.post = new Post(this.renderer, this.scene, this.camera, this.quality, size);
    this.resize();

    // Compile every shader up front so the intro doesn't hitch.
    // Temporarily reveal everything so nothing is skipped as invisible.
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      this.renderer.compile(this.scene, this.camera);
    }
    onProgress(0.9);
    this.post.render(0, 0);
    onProgress(1);

    // Resizing clears the canvas, so do it at the start of a frame, right before drawing.
    window.addEventListener('resize', () => (this.needsResize = true));
    window.addEventListener('pointermove', (e) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.supernova();
    });
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // A hidden or collapsed window reports 0 — keep the last good size instead
    // of creating zero-sized render targets (that breaks every effect).
    if (!w || !h) return;
    const aspect = w / h;
    this.camera.aspect = aspect;
    // portrait screens: widen the lens and pull back so the orbit still fits
    this.camera.fov = aspect < 1 ? 38 + (1 - aspect) * 34 : 38;
    this.camDistance = aspect < 1 ? 1 + (1 - aspect) * 0.75 : aspect < 1.3 ? 1.12 : 1;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.pixelRatio.value = this.dpr;
    if (this.post) this.post.setSize(w, h, this.dpr);
    if (this.floor) this.floor.setSize(w * this.dpr, h * this.dpr);
  }

  start() {
    this.clock = new THREE.Clock();
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const rawDt = this.clock.getDelta();
      if (this.contextLost || document.hidden || !window.innerWidth || !window.innerHeight) return;
      if (this.needsResize) {
        this.needsResize = false;
        this.resize();
      }
      const dt = Math.min(rawDt, 1 / 20);
      this.update(dt);
      this.post.render(dt, this.time);
      this.watchPerformance(rawDt);
    };
    tick();
  }

  // ------------------------------------------------------------------ beat
  startBeat() {
    if (this.reducedMotion) return;
    this.beatRunning = true;
    this.beatT0 = this.time + 0.4;
  }

  updateBeat() {
    if (!this.beatRunning) return;
    const local = this.time - this.beatT0;
    if (local < 0) return;
    const cycle = Math.floor(local / BEAT.period);
    for (let k = 0; k < 3; k++) {
      const hit = this.beatT0 + cycle * BEAT.period + BEAT.hits[k];
      if (this.time >= hit && this.lastHit[k] < hit - 1e-4) {
        this.lastHit[k] = hit;
        this.hit(k);
      }
    }
  }

  hit(k) {
    if (k < 2) {
      fx.u.uSunPulse.value = Math.max(fx.u.uSunPulse.value, 0.35);
      fx.ca = Math.max(fx.ca, 0.18);
      this.emitFromWords(k, 5, { speed: 2.2, up: 3.2 });
    } else {
      fx.u.uSunPulse.value = 1;
      fx.ca = 1;
      fx.shake = 1;
      fx.flash = Math.max(fx.flash, 0.06);
      this.sun.burst();
      this.friend.glint();
      this.emitFromWords(2, 10, { speed: 3.2, up: 4.5, hot: true });
      // sun spits a fan of sparks across the floor
      this._tmp.set(0, 0.4, 0.8);
      this.particles.sparks.emit(this._tmp, 40, { spread: 2.5, speed: 6, up: 2.5, hot: true });
    }
    this.onBeat(k);
  }

  emitFromWords(type, n, opts) {
    for (const ring of this.text.rings) {
      if (!ring) continue;
      for (const a of ring.anchors) {
        if (a.type !== type) continue;
        const along = (Math.random() - 0.5) * a.half * 2;
        this.text.anchorPosition(ring, a, this._tmp, along);
        this._radial.set(this._tmp.x, 0, this._tmp.z).normalize();
        this.particles.sparks.emit(this._tmp, n, { ...opts, radial: this._radial });
      }
    }
  }

  /** Intro ignition: shockwave across the floor, shake, a fan of sparks. */
  ignite() {
    this.novaStart = this.time;
    fx.shake = 1.4;
    fx.ca = 1.2;
    fx.u.uSunPulse.value = 0.7;
    this._tmp.set(0, 0.6, 0.2);
    this.particles.sparks.emit(this._tmp, 160, { spread: 2.5, speed: 8, up: 5, hot: true });
  }

  // ------------------------------------------------------------------ supernova
  supernova() {
    if (this.novaActive || !this.introDone || this.reducedMotion) return;
    this.novaActive = true;
    this.novaStart = this.time;
    fx.flash = Math.max(fx.flash, 0.3);
    fx.ca = 1.6;
    fx.shake = 1.8;
    fx.u.uSunPulse.value = 1.6;
    this.spinBoost = 1;
    this.sun.burst();
    this.sun.burst();
    this.friend.glint();
    this._tmp.set(0, 1.5, 0.5);
    this.particles.sparks.emit(this._tmp, 220, { spread: 3, speed: 9, up: 6, hot: true });
    this.emitFromWords(0, 6, { speed: 4, up: 5 });
    this.emitFromWords(1, 6, { speed: 4, up: 5 });
    this.emitFromWords(2, 10, { speed: 5, up: 6, hot: true });
    this.onBeat(3);
    gsap
      .timeline({ onComplete: () => (this.novaActive = false) })
      .to(fx.u.uNova, { value: 1, duration: 0.55, ease: 'expo.out' })
      .to(fx.u.uNova, { value: 0, duration: 1.9, ease: 'elastic.out(1, 0.5)' }, '+=0.75');
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    const ts = this.reducedMotion ? 0.25 : fx.timeScale;
    this.time += dt * ts;
    const t = this.time;
    fx.u.uTime.value = t;

    // ring spin (inner faster), with a kick after a supernova
    this.spinBoost *= Math.exp(-dt * 0.9);
    const spins = fx.u.uSpins.value;
    for (let i = 0; i < RINGS.length; i++) {
      spins[i] += RINGS[i].speed * dt * ts * (1 + this.spinBoost * 4);
    }

    this.updateBeat();
    fx.u.uBeatT.value.set(t - this.lastHit[0], t - this.lastHit[1], t - this.lastHit[2]);
    fx.u.uShockT.value.set(t - this.lastHit[2], t - this.novaStart);
    fx.u.uNovaT.value = Math.max(0, t - this.novaStart);

    // decays
    fx.u.uSunPulse.value *= Math.exp(-dt * 2.6);

    // the scene pulses on the music's bass hits
    if (this.music) {
      const kick = this.reducedMotion ? 0 : this.music.levels().kick;
      fx.u.uMusic.value = kick;
      fx.u.uSunPulse.value = Math.max(fx.u.uSunPulse.value, kick * 0.5);
    }
    fx.ca *= Math.exp(-dt * 5);
    fx.shake *= Math.exp(-dt * 3.5);
    if (this.introDone) fx.flash *= Math.exp(-dt * 6);

    // camera: parallax + idle drift + shake
    const p = this.pointer;
    const k = 1 - Math.exp(-dt * 2.5);
    p.sx += (p.x - p.sx) * k;
    p.sy += (p.y - p.sy) * k;
    const d = this.camDistance || 1;
    const cam = this.camera;
    cam.position.set(
      CAM_BASE.x * d + p.sx * 1.4 + Math.sin(t * 0.13) * 0.35,
      CAM_BASE.y * d + p.sy * 0.8 + Math.sin(t * 0.17) * 0.15,
      CAM_BASE.z * d,
    );
    const target = this._tmp.copy(CAM_TARGET);
    target.y += (d - 1) * 1.6;
    if (fx.shake > 0.001) {
      const s = fx.shake * 0.14;
      cam.position.x += (Math.sin(t * 61.0) + Math.sin(t * 97.3)) * s;
      cam.position.y += (Math.sin(t * 73.1) + Math.sin(t * 41.7)) * s;
    }
    cam.lookAt(target);

    this.sky.update(cam);
    this.sun.update(dt * ts, cam);
    this.friend.update(dt * ts, cam);
    this.text.update();
    this.particles.update(dt * ts, cam);
  }

  /**
   * Adaptive quality, measured over ~1.5s windows once the intro is done:
   * slow → lower resolution, then drop the floor reflection; fast → raise
   * resolution (never again after a downgrade, so it can't flip-flop).
   */
  watchPerformance(rawDt) {
    if (!this.introDone) return;
    const p = this.perf;
    if (rawDt > 0.25) {
      p.times.length = 0; // tab switch or hitch: start a fresh window
      return;
    }
    p.times.push(rawDt);
    if (p.times.length < 90) return;
    const avg = p.times.reduce((a, b) => a + b, 0) / p.times.length;
    p.times.length = 0;
    if (avg > 1 / 42) {
      p.upgradeLocked = true;
      if (this.dpr > 1) {
        this.dpr = Math.max(1, this.dpr - 0.25);
        this.needsResize = true;
      } else if (this.floor.reflect) {
        this.floor.disableReflection();
      }
    } else if (avg < 1 / 57 && !p.upgradeLocked && this.dpr < this.maxDpr) {
      this.dpr = Math.min(this.maxDpr, this.dpr + 0.25);
      this.needsResize = true;
    }
  }
}
