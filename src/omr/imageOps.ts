export function rotateImageData(source: ImageData, degrees: 90 | 180 | 270): ImageData {
  const canvas = document.createElement('canvas');
  if (degrees === 90 || degrees === 270) {
    canvas.width = source.height;
    canvas.height = source.width;
  } else {
    canvas.width = source.width;
    canvas.height = source.height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  const temp = document.createElement('canvas');
  temp.width = source.width;
  temp.height = source.height;
  const tempCtx = temp.getContext('2d');
  if (!tempCtx) throw new Error('Canvas 2D is unavailable.');
  tempCtx.putImageData(source, 0, 0);
  ctx.drawImage(temp, -source.width / 2, -source.height / 2);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function downscaleImageData(source: ImageData, maxDimension: number): { image: ImageData; scale: number } {
  const largest = Math.max(source.width, source.height);
  if (largest <= maxDimension) return { image: source, scale: 1 };
  const scale = maxDimension / largest;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = source.width;
  srcCanvas.height = source.height;
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) throw new Error('Canvas 2D is unavailable.');
  srcCtx.putImageData(source, 0, 0);
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = width;
  dstCanvas.height = height;
  const dstCtx = dstCanvas.getContext('2d');
  if (!dstCtx) throw new Error('Canvas 2D is unavailable.');
  dstCtx.drawImage(srcCanvas, 0, 0, width, height);
  return { image: dstCtx.getImageData(0, 0, width, height), scale };
}

export function cropImageData(source: ImageData, x: number, y: number, width: number, height: number): ImageData {
  const left = Math.max(0, Math.min(source.width - 1, Math.round(x)));
  const top = Math.max(0, Math.min(source.height - 1, Math.round(y)));
  const w = Math.max(1, Math.min(source.width - left, Math.round(width)));
  const h = Math.max(1, Math.min(source.height - top, Math.round(height)));
  const out = new ImageData(w, h);
  for (let row = 0; row < h; row += 1) {
    const start = ((top + row) * source.width + left) * 4;
    out.data.set(source.data.subarray(start, start + w * 4), row * w * 4);
  }
  return out;
}

export function grayscale(image: ImageData): Uint8Array {  const out = new Uint8Array(image.width * image.height);
  const data = image.data;
  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    out[pixel] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return out;
}

export function otsuThreshold(gray: Uint8Array): number {
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i += 1) histogram[gray[i]] += 1;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

export interface Blob {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  fill: number;
}

/** Connected-component labelling for dark pixels (8-connected). */
export function findDarkBlobs(binary: Uint8Array, width: number, height: number, minArea = 60): Blob[] {
  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  const blobs: Blob[] = [];

  for (let start = 0; start < binary.length; start += 1) {
    if (!binary[start] || visited[start]) continue;
    let top = 0;
    stack[top] = start;
    top += 1;
    visited[start] = 1;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let sumX = 0;
    let sumY = 0;

    while (top > 0) {
      top -= 1;
      const index = stack[top];
      const x = index % width;
      const y = (index - x) / width;
      area += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(height - 1, y + 1);
      for (let ny = y0; ny <= y1; ny += 1) {
        for (let nx = x0; nx <= x1; nx += 1) {
          const nIndex = ny * width + nx;
          if (binary[nIndex] && !visited[nIndex]) {
            visited[nIndex] = 1;
            stack[top] = nIndex;
            top += 1;
          }
        }
      }
    }

    if (area >= minArea) {
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      blobs.push({
        area,
        minX,
        minY,
        maxX,
        maxY,
        sumX,
        sumY,
        centerX: sumX / area,
        centerY: sumY / area,
        width: bw,
        height: bh,
        fill: area / (bw * bh),
      });
    }
  }

  return blobs;
}

export function imageDataFromCanvas(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality = 0.82): string {
  return canvas.toDataURL('image/jpeg', quality);
}
