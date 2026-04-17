// Find transparent/semi-transparent regions inside the subject body, grouped
// by connected α=0 clusters (topological) AND by low-α clusters adjacent to
// opaque body. Shows bbox + size to help locate what the user is seeing.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const path = process.argv[2] ?? '.halo-check/coche.png';
const png = PNG.sync.read(readFileSync(path));
const { width: w, height: h, data } = png;
const n = w * h;
const alpha = new Uint8Array(n);
for (let i = 0; i < n; i++) alpha[i] = data[i * 4 + 3];

console.log(`Image: ${path}  ${w}x${h}`);

// Mark α=0 connected to border.
const queue = new Int32Array(n);
const bgVisited = new Uint8Array(n);
let head = 0, tail = 0;
const seed = (i) => { if (alpha[i] === 0 && !bgVisited[i]) { bgVisited[i] = 1; queue[tail++] = i; } };
for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
for (let y = 1; y < h - 1; y++) { seed(y * w); seed(y * w + w - 1); }
while (head < tail) {
  const i = queue[head++];
  const x = i % w, y = (i - x) / w;
  const push = (ni) => { if (alpha[ni] === 0 && !bgVisited[ni]) { bgVisited[ni] = 1; queue[tail++] = ni; } };
  if (x > 0) push(i - 1);
  if (x < w - 1) push(i + 1);
  if (y > 0) push(i - w);
  if (y < h - 1) push(i + w);
}

// Cluster border-connected α=0 pixels that have at least one opaque 8-neighbor
// (i.e. they poke INTO the subject). These are "thin channels" / "cracks".
const isCrackSeed = (i) => {
  if (!bgVisited[i]) return false;
  const x = i % w, y = (i - x) / w;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (alpha[ny * w + nx] >= 200) return true;
    }
  }
  return false;
};

// For each border-connected α=0 pixel at the subject frontier, measure the
// local "enclosure": how many pixels within radius 3 are opaque.
const r = 3;
const area = (2 * r + 1) * (2 * r + 1) - 1;
const candidates = [];
for (let y = r; y < h - r; y++) {
  for (let x = r; x < w - r; x++) {
    const i = y * w + x;
    if (!isCrackSeed(i)) continue;
    let opaque = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (alpha[(y + dy) * w + (x + dx)] >= 220) opaque++;
      }
    }
    if (opaque / area >= 0.5) {
      candidates.push({ x, y, opaqueRatio: opaque / area });
    }
  }
}

// Cluster candidates by 4-connectivity to get regions.
const cset = new Set(candidates.map(c => c.y * w + c.x));
const cvisited = new Set();
const regions = [];
for (const c of candidates) {
  const start = c.y * w + c.x;
  if (cvisited.has(start)) continue;
  const stack = [start];
  const pts = [];
  let minX = w, minY = h, maxX = 0, maxY = 0;
  while (stack.length) {
    const i = stack.pop();
    if (cvisited.has(i)) continue;
    cvisited.add(i);
    pts.push(i);
    const x = i % w, y = (i - x) / w;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const ni = (y + dy) * w + (x + dx);
      if (cset.has(ni) && !cvisited.has(ni)) stack.push(ni);
    }
  }
  regions.push({ size: pts.length, minX, minY, maxX, maxY });
}
regions.sort((a, b) => b.size - a.size);

console.log(`\n"Crack" candidates (α=0 border-connected but with ≥50% opaque neighbors in 7×7):`);
console.log(`Total ${candidates.length} pixels in ${regions.length} regions`);
console.log(`\nTop 15 regions by size:`);
for (const r of regions.slice(0, 15)) {
  console.log(`  size=${r.size}  bbox=(${r.minX},${r.minY})-(${r.maxX},${r.maxY})  wh=${r.maxX - r.minX + 1}x${r.maxY - r.minY + 1}`);
}
