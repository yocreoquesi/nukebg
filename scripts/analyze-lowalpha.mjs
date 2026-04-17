// Look for low-α pixels locally surrounded by high-α neighbors — those show
// as "faded dots" in the composite over a white preview.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const path = process.argv[2] ?? '.halo-check/coche.png';
const png = PNG.sync.read(readFileSync(path));
const { width: w, height: h, data } = png;
const n = w * h;
const alpha = new Uint8Array(n);
for (let i = 0; i < n; i++) alpha[i] = data[i * 4 + 3];

console.log(`Image: ${path}  ${w}x${h}`);

// Full α histogram.
const hist = new Array(256).fill(0);
for (let i = 0; i < n; i++) hist[alpha[i]]++;
const buckets = {
  'α=0': hist[0],
  'α=1..31': 0, 'α=32..63': 0, 'α=64..127': 0,
  'α=128..191': 0, 'α=192..223': 0, 'α=224..254': 0,
  'α=255': hist[255],
};
for (let a = 1; a <= 31; a++) buckets['α=1..31'] += hist[a];
for (let a = 32; a <= 63; a++) buckets['α=32..63'] += hist[a];
for (let a = 64; a <= 127; a++) buckets['α=64..127'] += hist[a];
for (let a = 128; a <= 191; a++) buckets['α=128..191'] += hist[a];
for (let a = 192; a <= 223; a++) buckets['α=192..223'] += hist[a];
for (let a = 224; a <= 254; a++) buckets['α=224..254'] += hist[a];
console.log('Alpha histogram:');
for (const [k, v] of Object.entries(buckets)) {
  const pct = (v / n * 100).toFixed(2);
  console.log(`  ${k.padEnd(14)} ${String(v).padStart(8)}  ${pct}%`);
}

// Find low-α pixels (α < 128) with most neighbors at α=255 in a 5x5 window.
const r = 2;
const suspicious = [];
for (let y = r; y < h - r; y++) {
  for (let x = r; x < w - r; x++) {
    const i = y * w + x;
    const a = alpha[i];
    if (a === 0 || a >= 200) continue;
    let opaqueHigh = 0;
    let total = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dy === 0) continue;
        total++;
        if (alpha[(y + dy) * w + (x + dx)] >= 240) opaqueHigh++;
      }
    }
    if (opaqueHigh / total >= 0.8) suspicious.push({ x, y, a, opaqueHigh, total });
  }
}
console.log(`\nLow-α (1..199) pixels with ≥80% α≥240 neighbors in 5x5: ${suspicious.length}`);
for (const s of suspicious.slice(0, 20)) {
  console.log(`  (${s.x},${s.y}) α=${s.a} hi_neighbors=${s.opaqueHigh}/${s.total}`);
}
