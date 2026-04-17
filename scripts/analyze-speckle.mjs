// Find α=0 pixels that are LOCALLY inside the subject (mostly surrounded by
// α>0 neighbors) even if topologically they connect to the border through
// thin channels. These are the "random dots" users perceive as erased spots.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const path = process.argv[2] ?? '.halo-check/coche.png';
const png = PNG.sync.read(readFileSync(path));
const { width: w, height: h, data } = png;
const n = w * h;
const alpha = new Uint8Array(n);
for (let i = 0; i < n; i++) alpha[i] = data[i * 4 + 3];

// For each α=0 pixel, count α>0 neighbors in a (2r+1) window.
const check = (r, ratioThresh) => {
  const area = (2 * r + 1) * (2 * r + 1) - 1;
  let count = 0;
  const xs = [];
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      const i = y * w + x;
      if (alpha[i] !== 0) continue;
      let opaque = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (alpha[(y + dy) * w + (x + dx)] > 0) opaque++;
        }
      }
      if (opaque / area >= ratioThresh) {
        count++;
        if (xs.length < 30) xs.push({ x, y, opaque, area });
      }
    }
  }
  console.log(`r=${r} thresh=${ratioThresh}: ${count} suspicious α=0 pixels (mostly surrounded by α>0)`);
  if (xs.length > 0) {
    console.log(`  sample locations (first 30):`);
    for (const s of xs) console.log(`    (${s.x},${s.y}) opaque_neighbors=${s.opaque}/${s.area}`);
  }
};

console.log(`Image: ${path}  ${w}x${h}`);
check(1, 0.75);  // 3x3 window, at least 6/8 opaque
check(2, 0.75);  // 5x5 window, at least 18/24 opaque
check(3, 0.80);  // 7x7 window, at least 38/48 opaque
