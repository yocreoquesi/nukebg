// Analyze α=0 clusters in a PNG: size histogram + border-connected vs enclosed.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const path = process.argv[2] ?? '.halo-check/coche.png';
const buf = readFileSync(path);
const png = PNG.sync.read(buf);
const { width: w, height: h, data } = png;

console.log(`Image: ${path}  ${w}x${h} = ${w * h} px`);

const n = w * h;
const alpha = new Uint8Array(n);
for (let i = 0; i < n; i++) alpha[i] = data[i * 4 + 3];

// BFS from border marking α=0 connected to edge.
const bgVisited = new Uint8Array(n);
const queue = new Int32Array(n);
let head = 0,
  tail = 0;
const seed = (i) => {
  if (alpha[i] === 0 && !bgVisited[i]) {
    bgVisited[i] = 1;
    queue[tail++] = i;
  }
};
for (let x = 0; x < w; x++) {
  seed(x);
  seed((h - 1) * w + x);
}
for (let y = 1; y < h - 1; y++) {
  seed(y * w);
  seed(y * w + w - 1);
}
while (head < tail) {
  const i = queue[head++];
  const x = i % w,
    y = (i - x) / w;
  const push = (ni) => {
    if (alpha[ni] === 0 && !bgVisited[ni]) {
      bgVisited[ni] = 1;
      queue[tail++] = ni;
    }
  };
  if (x > 0) push(i - 1);
  if (x < w - 1) push(i + 1);
  if (y > 0) push(i - w);
  if (y < h - 1) push(i + w);
}

// Now find enclosed α=0 clusters (holes).
const visited = new Uint8Array(n);
const holes = [];
for (let start = 0; start < n; start++) {
  if (alpha[start] !== 0 || bgVisited[start] || visited[start]) continue;
  head = 0;
  tail = 0;
  queue[tail++] = start;
  visited[start] = 1;
  let size = 0;
  let minX = w,
    minY = h,
    maxX = 0,
    maxY = 0;
  while (head < tail) {
    const i = queue[head++];
    size++;
    const x = i % w,
      y = (i - x) / w;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    const push = (ni) => {
      if (alpha[ni] === 0 && !bgVisited[ni] && !visited[ni]) {
        visited[ni] = 1;
        queue[tail++] = ni;
      }
    };
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  holes.push({ size, minX, minY, maxX, maxY });
}

holes.sort((a, b) => b.size - a.size);
console.log(`\nFound ${holes.length} ENCLOSED α=0 holes (topologically inside the subject):`);
const bucket = {
  1: 0,
  '2-10': 0,
  '11-50': 0,
  '51-200': 0,
  '201-500': 0,
  '501-2000': 0,
  '2001+': 0,
};
for (const h of holes) {
  if (h.size === 1) bucket['1']++;
  else if (h.size <= 10) bucket['2-10']++;
  else if (h.size <= 50) bucket['11-50']++;
  else if (h.size <= 200) bucket['51-200']++;
  else if (h.size <= 500) bucket['201-500']++;
  else if (h.size <= 2000) bucket['501-2000']++;
  else bucket['2001+']++;
}
console.log('Size histogram:', bucket);
console.log('\nTop 20 largest enclosed holes:');
for (const h of holes.slice(0, 20)) {
  console.log(
    `  size=${h.size}  bbox=(${h.minX},${h.minY})-(${h.maxX},${h.maxY})  wh=${h.maxX - h.minX + 1}x${h.maxY - h.minY + 1}`,
  );
}
