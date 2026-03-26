/**
 * Ring buffer queue for BFS operations.
 * Much faster than Array.shift() for large flood-fills.
 */
export class RingBuffer {
  private buffer: Int32Array;
  private head = 0;
  private tail = 0;
  private count = 0;
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Int32Array(capacity * 2); // pairs of (y, x)
  }

  push(y: number, x: number): void {
    if (this.count >= this.capacity) {
      this.grow();
    }
    const idx = this.tail * 2;
    this.buffer[idx] = y;
    this.buffer[idx + 1] = x;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;
  }

  pop(): [number, number] {
    const idx = this.head * 2;
    const y = this.buffer[idx];
    const x = this.buffer[idx + 1];
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    return [y, x];
  }

  get size(): number {
    return this.count;
  }

  get empty(): boolean {
    return this.count === 0;
  }

  private grow(): void {
    const newCap = this.capacity * 2;
    const newBuf = new Int32Array(newCap * 2);
    for (let i = 0; i < this.count; i++) {
      const srcIdx = ((this.head + i) % this.capacity) * 2;
      const dstIdx = i * 2;
      newBuf[dstIdx] = this.buffer[srcIdx];
      newBuf[dstIdx + 1] = this.buffer[srcIdx + 1];
    }
    this.buffer = newBuf;
    this.head = 0;
    this.tail = this.count;
    this.capacity = newCap;
  }
}

/** Get pixel index in RGBA flat array */
export function pixelIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

/** Max channel difference between pixel at (x,y) and an RGB color */
export function maxChannelDiff(
  pixels: Uint8ClampedArray,
  idx: number,
  color: number[]
): number {
  return Math.max(
    Math.abs(pixels[idx] - color[0]),
    Math.abs(pixels[idx + 1] - color[1]),
    Math.abs(pixels[idx + 2] - color[2])
  );
}

/** Compute mean of an array of numbers */
export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

/** Compute standard deviation of an array of numbers */
export function std(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  let sumSq = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - m;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / arr.length);
}

/** Compute median of an array of numbers */
export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
