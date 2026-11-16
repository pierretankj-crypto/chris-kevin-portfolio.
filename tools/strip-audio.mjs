// Splits an MP4's tracks without re-encoding (lossless remux).
// Usage: node tools/strip-audio.mjs <in.mp4> <out.mp4> [--info] [--keep=audio]
//
// Default keeps only the video track (drops audio). --keep=audio keeps only
// the sound (for an .m4a music file). If `moov` sits before `mdat`, the kept
// track's chunk offsets are shifted to match the smaller header.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const infoOnly = args.includes('--info');
const keepHandler = args.includes('--keep=audio') ? 'soun' : 'vide';
const [inPath, outPath] = args.filter((a) => !a.startsWith('--'));
if (!inPath) {
  console.error('usage: node tools/strip-audio.mjs <in.mp4> <out.mp4> [--info]');
  process.exit(1);
}
const buf = fs.readFileSync(inPath);

function boxes(start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(p + 8));
      header = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < header || p + size > end) throw new Error(`bad box ${type} at ${p}`);
    out.push({ type, start: p, size, header, end: p + size, body: p + header });
    p += size;
  }
  return out;
}
const child = (box, type) => boxes(box.body, box.end).find((b) => b.type === type);
const fixed16 = (v) => v / 65536;

const top = boxes(0, buf.length);
const moov = top.find((b) => b.type === 'moov');
const mdatIndex = top.findIndex((b) => b.type === 'mdat');
const moovIndex = top.indexOf(moov);
if (!moov || mdatIndex < 0) throw new Error('not a regular MP4 (no moov/mdat)');

const traks = boxes(moov.body, moov.end).filter((b) => b.type === 'trak');
const info = traks.map((t) => {
  const mdia = child(t, 'mdia');
  const hdlr = child(mdia, 'hdlr');
  const handler = buf.toString('latin1', hdlr.body + 8, hdlr.body + 12);
  const mdhd = child(mdia, 'mdhd');
  const v = buf[mdhd.body];
  const timescale = buf.readUInt32BE(mdhd.body + (v === 1 ? 20 : 12));
  const duration = v === 1 ? Number(buf.readBigUInt64BE(mdhd.body + 24)) : buf.readUInt32BE(mdhd.body + 16);
  const tkhd = child(t, 'tkhd');
  const tv = buf[tkhd.body];
  const base = tkhd.body + (tv === 1 ? 4 + 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4 + 4) + 8 + 2 + 2 + 2 + 2;
  const a = buf.readInt32BE(base) / 65536;
  const b = buf.readInt32BE(base + 4) / 65536;
  const width = fixed16(buf.readUInt32BE(base + 36));
  const height = fixed16(buf.readUInt32BE(base + 40));
  const rotation = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  return { trak: t, handler, seconds: duration / timescale, width, height, rotation };
});

console.log(`${path.basename(inPath)}  (${(buf.length / 1024 / 1024).toFixed(2)} MB, moov ${moovIndex < mdatIndex ? 'before' : 'after'} mdat)`);
for (const i of info) {
  console.log(`  track: ${i.handler}  ${i.seconds.toFixed(2)}s` + (i.handler === 'vide' ? `  ${i.width}x${i.height}  rotation ${i.rotation}°` : ''));
}
if (infoOnly || !outPath) process.exit(0);

const keep = info.filter((i) => i.handler === keepHandler);
if (!keep.length) throw new Error(`no ${keepHandler} track found`);
const drop = info.filter((i) => i.handler !== keepHandler);

// Rebuild moov from its children, minus the dropped tracks.
const parts = [];
for (const c of boxes(moov.body, moov.end)) {
  if (drop.some((d) => d.trak.start === c.start)) continue;
  parts.push(Buffer.from(buf.subarray(c.start, c.end)));
}
const body = Buffer.concat(parts);
const header = Buffer.alloc(8);
header.writeUInt32BE(8 + body.length, 0);
header.write('moov', 4, 'latin1');
const newMoov = Buffer.concat([header, body]);

// Find the kept track's sample tables inside the new moov.
const tables = {};
(function walk(start, end) {
  for (const b of boxesIn(newMoov, start, end)) {
    if (['trak', 'mdia', 'minf', 'stbl'].includes(b.type)) walk(b.body, b.end);
    else if (['stco', 'co64', 'stsc', 'stsz'].includes(b.type)) tables[b.type] = b;
  }
})(8, newMoov.length);
const co = tables.stco || tables.co64;
const is64 = !tables.stco;
if (!co || !tables.stsc || !tables.stsz) throw new Error('missing sample tables');

// Sample sizes (stsz) and samples-per-chunk (stsc) -> byte size of every chunk.
const stsz = tables.stsz;
const fixedSize = newMoov.readUInt32BE(stsz.body + 4);
const sampleCount = newMoov.readUInt32BE(stsz.body + 8);
const sizeOf = (s) => (fixedSize ? fixedSize : newMoov.readUInt32BE(stsz.body + 12 + s * 4));
const stsc = tables.stsc;
const runs = [];
for (let k = 0, n = newMoov.readUInt32BE(stsc.body + 4); k < n; k++) {
  const o = stsc.body + 8 + k * 12;
  runs.push({ first: newMoov.readUInt32BE(o), per: newMoov.readUInt32BE(o + 4) });
}
const chunkCount = newMoov.readUInt32BE(co.body + 4);
const chunks = [];
let sample = 0;
for (let c = 1; c <= chunkCount; c++) {
  let per = runs[0].per;
  for (const r of runs) if (r.first <= c) per = r.per;
  let bytes = 0;
  for (let k = 0; k < per && sample < sampleCount; k++) bytes += sizeOf(sample++);
  const slot = co.body + 8 + (c - 1) * (is64 ? 8 : 4);
  const offset = is64 ? Number(newMoov.readBigUInt64BE(slot)) : newMoov.readUInt32BE(slot);
  chunks.push({ offset, bytes, slot });
}

// Repack: ftyp + moov + an mdat holding only the kept track's chunks.
const ftyp = top.find((b) => b.type === 'ftyp');
const ftypBuf = ftyp ? buf.subarray(ftyp.start, ftyp.end) : Buffer.alloc(0);
const payload = Buffer.concat(chunks.map((c) => buf.subarray(c.offset, c.offset + c.bytes)));
let cursor = ftypBuf.length + newMoov.length + 8;
for (const c of chunks) {
  if (is64) newMoov.writeBigUInt64BE(BigInt(cursor), c.slot);
  else newMoov.writeUInt32BE(cursor, c.slot);
  cursor += c.bytes;
}
const mdatHeader = Buffer.alloc(8);
mdatHeader.writeUInt32BE(8 + payload.length, 0);
mdatHeader.write('mdat', 4, 'latin1');

function boxesIn(b, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    const size = b.readUInt32BE(p);
    const type = b.toString('latin1', p + 4, p + 8);
    out.push({ type, start: p, end: p + size, body: p + 8 });
    p += size;
  }
  return out;
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const out = Buffer.concat([ftypBuf, newMoov, mdatHeader, payload]);
fs.writeFileSync(outPath, out);
console.log(
  `  kept ${keepHandler} (${chunks.length} chunks, ${sampleCount} samples), dropped ${drop.length} track(s); ` +
    `wrote ${outPath} (${(out.length / 1024).toFixed(0)} KB)`,
);
