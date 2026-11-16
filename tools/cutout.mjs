// Cuts the friend photos out of their flat yellow background, locally.
// Usage: npm run cutout
// Reads assets-src/*.jpg, writes transparent PNGs to public/images/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const jobs = [
  { src: 'assets-src/friend-hero.jpg', out: 'public/images/friend-hero.png' },
  { src: 'assets-src/friend-about.jpg', out: 'public/images/friend-about.png', cropBars: true },
];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function toYCbCr(r, g, b) {
  return [
    0.299 * r + 0.587 * g + 0.114 * b,
    128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  ];
}

function cropBlackBars(img) {
  const { width: w, height: h, data } = img;
  const rowLum = (y) => {
    let s = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      s += data[i] + data[i + 1] + data[i + 2];
    }
    return s / (w * 3);
  };
  let top = 0;
  while (top < h && rowLum(top) < 24) top++;
  let bottom = h - 1;
  // Skip the black bar and the phone's home-indicator line at the bottom.
  while (bottom > top) {
    const l = rowLum(bottom);
    // a row belongs to the photo when most of it is bright-ish (yellow/shirt)
    let bright = 0;
    for (let x = 0; x < w; x++) {
      const i = (bottom * w + x) * 4;
      if (data[i] + data[i + 1] + data[i + 2] > 150) bright++;
    }
    if (l > 40 && bright > w * 0.6) break;
    bottom--;
  }
  // trim a couple of rows to dodge the soft transition into the bar
  top += 2;
  bottom -= 2;
  const nh = bottom - top + 1;
  const out = Buffer.alloc(w * nh * 4);
  data.copy(out, 0, top * w * 4, (bottom + 1) * w * 4);
  console.log(`  cropped bars: rows ${top}..${bottom} (${w}x${nh})`);
  return { width: w, height: nh, data: out };
}

function estimateBackground(img) {
  const { width: w, height: h, data } = img;
  const samples = [];
  const push = (x, y) => {
    const i = (y * w + x) * 4;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < w; x += 2) push(x, 1);
  for (let y = 0; y < h * 0.45; y += 2) {
    push(1, y);
    push(w - 2, y);
  }
  const med = (k) => {
    const v = samples.map((s) => s[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  return [med(0), med(1), med(2)];
}

function cutout(img) {
  const { width: w, height: h, data } = img;
  const bg = estimateBackground(img);
  const [bY, bCb, bCr] = toYCbCr(...bg);
  console.log(`  background ≈ rgb(${bg.join(', ')})`);

  const N = w * h;
  const dist = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    const [Y, Cb, Cr] = toYCbCr(data[i], data[i + 1], data[i + 2]);
    const dY = (Y - bY) * 0.45;
    const dCb = Cb - bCb;
    const dCr = (Cr - bCr) * 1.1;
    dist[p] = Math.sqrt(dY * dY + dCb * dCb + dCr * dCr);
  }

  // Flood-fill from clearly-background seeds through background-like pixels
  // so nothing inside the person (skin highlights, white collar) gets punched out.
  const LOOSE = 50; // max distance still considered "could be background"
  const STRICT = 14; // a pixel this close to the bg colour is definitely background
  const region = new Uint8Array(N);
  const stack = [];
  const grow = (p) => {
    if (!region[p] && dist[p] < LOOSE) {
      region[p] = 1;
      stack.push(p);
    }
  };
  const seed = (p) => {
    if (!region[p] && dist[p] < STRICT) {
      region[p] = 1;
      stack.push(p);
    }
  };
  // Border seeds plus any pure-background islands (e.g. seen through a glasses lens).
  for (let p = 0; p < N; p++) seed(p);
  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) grow(p - 1);
    if (x < w - 1) grow(p + 1);
    if (y > 0) grow(p - w);
    if (y < h - 1) grow(p + w);
  }

  // Soft alpha from colour distance inside the connected background region.
  const alpha = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    alpha[p] = region[p] ? smoothstep(26, 70, dist[p]) : 1;
  }

  // Grow the region by one pixel so the JPEG fringe gets the soft treatment too.
  const a2 = new Float32Array(alpha);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += alpha[p + dy * w + dx];
      a2[p] = Math.min(alpha[p], (s / 9) * 0.6 + alpha[p] * 0.4);
    }
  }

  // Edge band: anything within 2px of a not-fully-opaque pixel gets despilled.
  const band = new Float32Array(N);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const p = y * w + x;
      let m = 1;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) m = Math.min(m, a2[p + dy * w + dx]);
      band[p] = 1 - m;
    }
  }

  const out = Buffer.alloc(N * 4);
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    let a = a2[p];
    a = smoothstep(0.18, 0.98, a); // slight choke so the yellow fringe falls outside
    let r = data[i], g = data[i + 1], b = data[i + 2];
    if (a < 0.999 && a > 0.001) {
      // Un-mix the background: c = a*fg + (1-a)*bg  ->  fg = (c - (1-a)*bg) / a
      const ur = (r - (1 - a) * bg[0]) / a;
      const ug = (g - (1 - a) * bg[1]) / a;
      const ub = (b - (1 - a) * bg[2]) / a;
      const k = 0.75;
      r = clamp(r * (1 - k) + ur * k, 0, 255);
      g = clamp(g * (1 - k) + ug * k, 0, 255);
      b = clamp(b * (1 - k) + ub * k, 0, 255);
    }
    if (a > 0.001 && band[p] > 0) {
      // Yellow spill suppression near the edge: yellow = lots of R+G, little B.
      const bw = Math.min(1, band[p] * 1.6);
      const spill = Math.max(0, Math.min(r, g) - b);
      r -= spill * 0.35 * bw;
      g -= spill * 0.55 * bw;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const d = 0.45 * bw; // pull edge pixels toward neutral
      r = r + (l - r) * d;
      g = g + (l - g) * d;
      b = b + (l - b) * d;
      r = clamp(r, 0, 255); g = clamp(g, 0, 255); b = clamp(b, 0, 255);
    }
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = Math.round(a * 255);
    if (a > 0.5) {
      const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  console.log(`  subject bbox: x ${minX}..${maxX}, y ${minY}..${maxY}`);

  // Bleed edge colours outward into transparent pixels so texture filtering
  // never mixes in the old yellow.
  const valid = new Uint8Array(N);
  for (let p = 0; p < N; p++) valid[p] = out[p * 4 + 3] > 128 ? 1 : 0;
  for (let iter = 0; iter < 8; iter++) {
    const next = new Uint8Array(valid);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (valid[p]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const q = p + dy * w + dx;
          if (valid[q]) { r += out[q * 4]; g += out[q * 4 + 1]; b += out[q * 4 + 2]; c++; }
        }
        if (c) {
          out[p * 4] = r / c; out[p * 4 + 1] = g / c; out[p * 4 + 2] = b / c;
          next[p] = 1;
        }
      }
    }
    valid.set(next);
  }
  for (let p = 0; p < N; p++) {
    if (!valid[p]) { out[p * 4] = 30; out[p * 4 + 1] = 22; out[p * 4 + 2] = 24; }
  }
  return { width: w, height: h, data: out };
}

for (const job of jobs) {
  console.log(job.src);
  const raw = jpeg.decode(fs.readFileSync(path.join(root, job.src)), { useTArray: false, formatAsRGBA: true });
  let img = { width: raw.width, height: raw.height, data: Buffer.from(raw.data) };
  console.log(`  ${img.width}x${img.height}`);
  if (job.cropBars) img = cropBlackBars(img);
  const res = cutout(img);
  const png = new PNG({ width: res.width, height: res.height });
  res.data.copy(png.data);
  fs.mkdirSync(path.dirname(path.join(root, job.out)), { recursive: true });
  fs.writeFileSync(path.join(root, job.out), PNG.sync.write(png));
  console.log(`  -> ${job.out}`);
}
