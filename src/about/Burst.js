import { gsap } from 'gsap';

const NS = 'http://www.w3.org/2000/svg';
const INK = '#170909';

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};

/** Seeded random so the splat keeps its shape between loops. */
const rng = (seed) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

function splatPath(rx, ry, spikes, rand) {
  let d = '';
  const n = spikes * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.12;
    const r = i % 2 === 0 ? 1 + rand() * 0.42 : 0.56 + rand() * 0.14;
    d += `${i ? 'L' : 'M'}${(Math.cos(a) * rx * r).toFixed(1)},${(Math.sin(a) * ry * r).toFixed(1)}`;
  }
  return d + 'Z';
}

function starPath(r) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    d += `${i ? 'L' : 'M'}${(Math.cos(a) * rr).toFixed(1)},${(Math.sin(a) * rr).toFixed(1)}`;
  }
  return d + 'Z';
}

/** Chunky comic word: outlined 3D extrusion + gradient face + gloss edge. */
function comicWord(parent, text, size, { fill, extrude }) {
  const g = el('g', {}, parent);
  const depth = Math.round(size * 0.09);
  const common = { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': size };
  for (let i = depth; i >= 1; i--) {
    el('text', { ...common, x: i * 0.55, y: i * 0.8, fill: extrude, stroke: INK, 'stroke-width': size * 0.16, 'stroke-linejoin': 'round' }, g).textContent = text;
  }
  el('text', { ...common, x: 0, y: 0, fill, stroke: INK, 'stroke-width': size * 0.13, 'stroke-linejoin': 'round', 'paint-order': 'stroke' }, g).textContent = text;
  el('text', { ...common, x: -size * 0.012, y: -size * 0.016, fill: 'none', stroke: 'rgba(255,255,255,0.7)', 'stroke-width': size * 0.016 }, g).textContent = text;
  return g;
}

export class Burst {
  /**
   * @param {SVGSVGElement} svg
   * @param {HTMLElement} card   positioned ancestor the SVG is laid out against
   * @param {HTMLElement} photo  the photo frame
   * @param {{u:number, v:number}} mouth  mouth position in photo UV (y down)
   * @param {{ jaw?: {jaw:number}, shakeTarget?: HTMLElement }} opts
   */
  constructor(svg, card, photo, mouth, opts = {}) {
    this.svg = svg;
    this.card = card;
    this.photo = photo;
    this.mouth = mouth;
    this.jaw = opts.jaw || { jaw: 0 };
    this.shakeTarget = opts.shakeTarget;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.drops = [];
    this.build();
    this.layout();
    new ResizeObserver(() => this.layout()).observe(card);
    this.tickDrops = this.tickDrops.bind(this);
  }

  /** Mouth position in card units (1000 = card width), via offsets so 3D tilt doesn't skew it. */
  mouthInCard() {
    let x = 0;
    let y = 0;
    let n = this.photo;
    while (n && n !== this.card) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent;
    }
    const k = 1000 / this.card.offsetWidth;
    return {
      x: (x + this.mouth.u * this.photo.offsetWidth) * k,
      y: (y + this.mouth.v * this.photo.offsetHeight) * k,
    };
  }

  layout() {
    // The SVG overhangs the card so the words can break out of it.
    const W = this.card.offsetWidth;
    const s = this.svg.style;
    s.left = `${-0.25 * W}px`;
    s.top = `${-0.55 * W}px`;
    s.width = `${1.5 * W}px`;
    s.height = `${1.5 * W}px`;
    this.svg.setAttribute('viewBox', '-250 -550 1500 1500');
    const m = this.mouthInCard();
    const changed = !this.M || Math.abs(m.x - this.M.x) > 0.5 || Math.abs(m.y - this.M.y) > 0.5;
    this.M = m;
    if (changed && this.tl) this.rebuildTimeline();
  }

  build() {
    const svg = this.svg;
    svg.innerHTML = '';
    const defs = el('defs', {}, svg);
    const gw = el('linearGradient', { id: 'bbWhite', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#ffffff' }, gw);
    el('stop', { offset: '0.6', 'stop-color': '#f1f0ee' }, gw);
    el('stop', { offset: '1', 'stop-color': '#c9c7c3' }, gw);
    const gr = el('linearGradient', { id: 'bbRed', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#ff5a43' }, gr);
    el('stop', { offset: '0.5', 'stop-color': '#e6151d' }, gr);
    el('stop', { offset: '1', 'stop-color': '#a30b12' }, gr);

    const rand = rng(7);
    this.root = el('g', {}, svg);

    // speed lines
    this.linesG = el('g', { stroke: '#ff5a26', 'stroke-linecap': 'round', fill: 'none' }, this.root);
    this.lines = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rand() * 0.2;
      const r0 = 1.0;
      const len = 0.18 + rand() * 0.35;
      const line = el('line', { 'stroke-width': 5 + rand() * 6 }, this.linesG);
      this.lines.push({ line, a, r0, len });
    }

    // splat behind BUGGIN
    this.splat = el('g', {}, this.root);
    el('path', { d: splatPath(330, 150, 13, rand), fill: '#b70d15', stroke: INK, 'stroke-width': 8, 'stroke-linejoin': 'round' }, this.splat);
    el('path', { d: splatPath(280, 118, 11, rand), fill: '#e8161d' }, this.splat);
    el('path', { d: splatPath(170, 70, 9, rand), fill: '#ff3a2c', opacity: 0.85 }, this.splat);

    // droplets
    this.dropsG = el('g', {}, this.root);
    for (let i = 0; i < 26; i++) {
      const r = 4 + rand() * 10;
      const c = el('circle', { r, fill: '#e3141b', stroke: INK, 'stroke-width': 3, opacity: 0 }, this.dropsG);
      this.drops.push({ c, x: 0, y: 0, vx: 0, vy: 0, life: 0, alive: false });
    }

    // exclamation + star
    this.bang = el('g', {}, this.root);
    comicWord(this.bang, '!', 150, { fill: 'url(#bbRed)', extrude: '#6e070b' });
    this.star = el('g', {}, this.root);
    el('path', { d: starPath(34), fill: '#e8161d', stroke: INK, 'stroke-width': 6, 'stroke-linejoin': 'round' }, this.star);

    // the words
    this.w1 = el('g', {}, this.root);
    comicWord(this.w1, 'BU', 96, { fill: 'url(#bbWhite)', extrude: '#8c8a86' });
    this.w2 = el('g', {}, this.root);
    comicWord(this.w2, 'BU', 108, { fill: 'url(#bbWhite)', extrude: '#8c8a86' });
    this.w3 = el('g', {}, this.root);
    comicWord(this.w3, 'BUGGIN', 150, { fill: 'url(#bbRed)', extrude: '#6e070b' });
  }

  targets() {
    const M = this.M;
    return {
      w1: { x: M.x + 125, y: M.y - 100, r: -12 },
      w2: { x: M.x + 225, y: M.y - 225, r: -7 },
      w3: { x: M.x + 260, y: M.y - 370, r: -5 },
      bang: { x: M.x - 120, y: M.y - 345, r: -14 },
      star: { x: M.x + 600, y: M.y - 260, r: 12 },
    };
  }

  placeLines(cx, cy) {
    for (const l of this.lines) {
      const ex = Math.cos(l.a);
      const ey = Math.sin(l.a);
      const rx = 360;
      const ry = 175;
      const x1 = cx + ex * rx * l.r0;
      const y1 = cy + ey * ry * l.r0;
      const x2 = cx + ex * rx * (l.r0 + l.len);
      const y2 = cy + ey * ry * (l.r0 + l.len);
      l.line.setAttribute('x1', x1);
      l.line.setAttribute('y1', y1);
      l.line.setAttribute('x2', x2);
      l.line.setAttribute('y2', y2);
      const len = Math.hypot(x2 - x1, y2 - y1);
      l.line.style.strokeDasharray = `${len}`;
      l.len2 = len;
    }
  }

  emitDrops(n, dirX, dirY, speed) {
    let k = 0;
    for (const d of this.drops) {
      if (d.alive) continue;
      const a = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 1.6;
      const s = speed * (0.5 + Math.random() * 0.8);
      d.x = this.M.x + (Math.random() - 0.5) * 30;
      d.y = this.M.y + (Math.random() - 0.5) * 16;
      d.vx = Math.cos(a) * s;
      d.vy = Math.sin(a) * s;
      d.life = 0;
      d.alive = true;
      d.c.setAttribute('opacity', 1);
      if (++k >= n) break;
    }
    if (!this.dropsRunning) {
      this.dropsRunning = true;
      this.lastT = performance.now();
      requestAnimationFrame(this.tickDrops);
    }
  }

  tickDrops(now) {
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    let any = false;
    for (const d of this.drops) {
      if (!d.alive) continue;
      any = true;
      d.life += dt;
      d.vy += 1900 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.c.setAttribute('cx', d.x.toFixed(1));
      d.c.setAttribute('cy', d.y.toFixed(1));
      if (d.life > 1.1) {
        d.alive = false;
        d.c.setAttribute('opacity', 0);
      }
    }
    if (any) requestAnimationFrame(this.tickDrops);
    else this.dropsRunning = false;
  }

  shake() {
    if (!this.shakeTarget || this.reduced) return;
    gsap.fromTo(this.shakeTarget, { x: 0, y: 0 }, {
      keyframes: [
        { x: -9, y: 4, duration: 0.05 },
        { x: 8, y: -3, duration: 0.05 },
        { x: -5, y: 2, duration: 0.05 },
        { x: 3, y: -1, duration: 0.05 },
        { x: 0, y: 0, duration: 0.08 },
      ],
    });
  }

  rebuildTimeline() {
    const t = this.tl ? this.tl.time() : 0;
    this.tl?.kill();
    this.makeTimeline();
    this.tl.time(Math.min(t, this.tl.duration()));
  }

  makeTimeline() {
    const M = this.M;
    const T = this.targets();
    const { w1, w2, w3, splat, bang, star, linesG, jaw } = this;
    this.placeLines(T.w3.x, T.w3.y);
    const lines = this.lines.map((l) => l.line);
    const origin = { transformOrigin: '50% 50%' };

    gsap.set([w1, w2, w3, bang, star, splat], origin);

    if (this.reduced) {
      // a still, finished frame
      gsap.set(w1, { x: T.w1.x, y: T.w1.y, rotation: T.w1.r, scale: 1, opacity: 1 });
      gsap.set(w2, { x: T.w2.x, y: T.w2.y, rotation: T.w2.r, scale: 1, opacity: 1 });
      gsap.set(w3, { x: T.w3.x, y: T.w3.y, rotation: T.w3.r, scale: 1, opacity: 1 });
      gsap.set(splat, { x: T.w3.x, y: T.w3.y, scale: 1, opacity: 1 });
      gsap.set(bang, { x: T.bang.x, y: T.bang.y, rotation: T.bang.r, scale: 1, opacity: 1 });
      gsap.set(star, { x: T.star.x, y: T.star.y, scale: 1, opacity: 1 });
      gsap.set(lines, { strokeDashoffset: 0, opacity: 1 });
      this.tl = gsap.timeline({ paused: true });
      return;
    }

    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.4 });
    this.tl = tl;
    const from = { x: M.x, y: M.y, scale: 0.05, rotation: 0, opacity: 1 };
    tl.set([w1, w2, w3], from, 0)
      .set([bang, star], { scale: 0, opacity: 1 }, 0)
      .set(splat, { x: T.w3.x, y: T.w3.y, scale: 0, rotation: -25, opacity: 1 }, 0)
      .set(linesG, { opacity: 0 }, 0)
      .set(linesG, { opacity: 1 }, 0.9)
      .set(lines, { strokeDashoffset: (i) => this.lines[i].len2 }, 0)
      .set(jaw, { jaw: 0 }, 0);

    // BU
    tl.to(jaw, { jaw: 0.75, duration: 0.07, ease: 'power2.out' }, 0.0)
      .to(jaw, { jaw: 0.12, duration: 0.2, ease: 'power2.in' }, 0.12)
      .to(w1, { x: T.w1.x, y: T.w1.y, scale: 1, rotation: T.w1.r, duration: 0.55, ease: 'back.out(2.4)' }, 0.03)
      .call(() => this.emitDrops(4, 0.6, -1, 520), null, 0.05);

    // BU
    tl.to(jaw, { jaw: 0.8, duration: 0.07, ease: 'power2.out' }, 0.4)
      .to(jaw, { jaw: 0.1, duration: 0.2, ease: 'power2.in' }, 0.52)
      .to(w2, { x: T.w2.x, y: T.w2.y, scale: 1, rotation: T.w2.r, duration: 0.55, ease: 'back.out(2.4)' }, 0.43)
      .to(w1, { x: T.w1.x - 18, y: T.w1.y + 12, rotation: T.w1.r - 4, duration: 0.35, ease: 'power2.out' }, 0.45)
      .call(() => this.emitDrops(5, 0.6, -1, 600), null, 0.45);

    // BUGGIN
    tl.to(jaw, { jaw: 1, duration: 0.08, ease: 'power3.out' }, 0.8)
      .to(jaw, { jaw: 0, duration: 0.55, ease: 'power2.inOut' }, 1.5)
      .to(w3, { x: T.w3.x, y: T.w3.y, scale: 1.2, rotation: T.w3.r, duration: 0.3, ease: 'power3.out' }, 0.82)
      .to(w3, { scale: 1, duration: 0.7, ease: 'elastic.out(1.1, 0.42)' }, 1.12)
      .to(splat, { scale: 1, rotation: 0, duration: 0.5, ease: 'back.out(2.6)' }, 0.88)
      .to(lines, { strokeDashoffset: 0, duration: 0.35, ease: 'power3.out', stagger: 0.012 }, 0.92)
      .to([w1, w2], { x: '-=24', y: '+=16', duration: 0.3, ease: 'power2.out' }, 0.86)
      .call(() => {
        this.emitDrops(16, 0.55, -1, 950);
        this.shake();
      }, null, 0.9)
      .to(bang, { x: T.bang.x, y: T.bang.y, scale: 1, rotation: T.bang.r, duration: 0.5, ease: 'back.out(3)' }, 1.0)
      .fromTo(star, { x: T.star.x, y: T.star.y, rotation: -90 }, { scale: 1, rotation: T.star.r, duration: 0.55, ease: 'back.out(3)' }, 1.06);

    // jelly + bob
    tl.to(w3, { scaleX: 1.07, scaleY: 0.93, duration: 0.11, yoyo: true, repeat: 5, ease: 'sine.inOut' }, 1.7)
      .to([w1, w2], { y: '-=8', duration: 0.22, yoyo: true, repeat: 3, ease: 'sine.inOut', stagger: 0.08 }, 1.7)
      .to(star, { rotation: '+=40', scale: 1.15, duration: 0.5, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 1.8);

    // blow away
    tl.to([w1, w2, w3, bang, star], {
      x: '+=560',
      y: '-=180',
      rotation: '+=20',
      scale: 0.55,
      opacity: 0,
      duration: 0.7,
      ease: 'power3.in',
      stagger: 0.05,
    }, 3.0)
      .to(splat, { scale: 0, rotation: 30, duration: 0.45, ease: 'back.in(2)' }, 3.05)
      .to(linesG, { opacity: 0, duration: 0.3 }, 3.0);
  }

  play() {
    if (!this.tl) this.makeTimeline();
    this.tl.play();
  }

  /** Hovering the photo fires it again straight away (unless mid-shout). */
  replay() {
    if (!this.tl || this.reduced) return;
    const t = this.tl.time();
    if (t < 0.5 || t > 2.9) this.tl.restart();
  }
}
