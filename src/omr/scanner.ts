import type { Choice, Exam, ItemFlag, OmrReadResult, ScanProgress } from '../types';
import { buildExamLayout, type SheetLayout } from './layout';
import { decodeQrDetailed, parseSheetQr } from './qr';
import {
  canvasToJpegDataUrl,
  cropImageData,
  downscaleImageData,
  findDarkBlobs,
  grayscale,
  otsuThreshold,
  rotateImageData,
} from './imageOps';
import { isPdfFile, loadImageFile, renderPdfFile } from './pdfRender';

type Point = { x: number; y: number };
type ProgressFn = (progress: ScanProgress) => void;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

interface QrDetection {
  payload: string | null;
  rotation: 0 | 90 | 180 | 270;
  /** Width of the decoded QR symbol in source pixels. */
  symbolWidth: number | null;
}

function normalizeRotation(degrees: number): 0 | 90 | 180 | 270 {
  const snapped = Math.round(degrees / 90) * 90;
  const normalized = ((snapped % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

function detectQrWithRotation(source: ImageData): QrDetection {
  const { image, scale } = downscaleImageData(source, 1700);
  const attempts: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
  let current = image;

  for (let index = 0; index < attempts.length; index += 1) {
    const applied = attempts[index];
    if (index > 0) {
      current = rotateImageData(current, 90);
    }
    const decoded = decodeQrDetailed(current.data, current.width, current.height);
    if (decoded) {
      const symbolWidth =
        Math.hypot(
          decoded.topRight.x - decoded.topLeft.x,
          decoded.topRight.y - decoded.topLeft.y
        ) / scale;
      // jsQR normalises the symbol's own frame, so its top edge tells us how
      // the page is turned, not which attempt happened to decode it. Combine
      // that angle with the rotation we applied to get the real page rotation.
      // Relying on the successful attempt alone is wrong: on a slightly skewed
      // scan an upright code may fail at 0° but decode after a 180° flip, and
      // treating that as an upside-down page mirrors every bubble and reads
      // a completely answered sheet as blank.
      const dx = decoded.topRight.x - decoded.topLeft.x;
      const dy = decoded.topRight.y - decoded.topLeft.y;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const nearest = Math.round(angle / 90) * 90;
      const rotation = Math.abs(angle - nearest) < 28 ? normalizeRotation(applied - nearest) : 0;
      return { payload: decoded.data, rotation, symbolWidth };
    }
  }

  return { payload: null, rotation: 0, symbolWidth: null };
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, index) => [...row, rhs[index]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];

    const divisor = a[col][col];
    for (let k = col; k <= n; k += 1) a[col][k] /= divisor;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (!factor) continue;
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }

  return a.map((row) => row[n]);
}

function computeHomography(src: Point[], dst: Point[]): number[] | null {
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  const solution = solveLinearSystem(matrix, rhs);
  return solution ? [...solution, 1] : null;
}

function applyHomography(h: number[], point: Point): Point {
  const denominator = h[6] * point.x + h[7] * point.y + h[8];
  if (Math.abs(denominator) < 1e-9) return { x: -1, y: -1 };
  return {
    x: (h[0] * point.x + h[1] * point.y + h[2]) / denominator,
    y: (h[3] * point.x + h[4] * point.y + h[5]) / denominator,
  };
}

function orderQuad(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const tl = sorted[0];
  const br = sorted[3];
  const middle = sorted.slice(1, 3).sort((a, b) => a.x - b.x);
  const tr = middle[1];
  const bl = middle[0];
  return [tl, tr, br, bl];
}

function quadArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

function isConvex(points: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) continue;
    const current = Math.sign(cross);
    if (sign === 0) sign = current;
    else if (sign !== current) return false;
  }
  return sign !== 0;
}

interface MarkerDetection {
  points: Point[];
  scale: number;
  candidates: number;
}

function detectMarkers(source: ImageData, layout: SheetLayout): MarkerDetection | null {
  const { image, scale } = downscaleImageData(source, 1100);
  const gray = grayscale(image);
  const threshold = clamp(otsuThreshold(gray), 55, 195);
  const binary = new Uint8Array(gray.length);
  let darkPixels = 0;
  for (let i = 0; i < gray.length; i += 1) {
    if (gray[i] < threshold) {
      binary[i] = 1;
      darkPixels += 1;
    }
  }

  // A mostly dark or mostly blank page cannot contain usable fiducials.
  const inkRatio = darkPixels / Math.max(1, gray.length);
  if (inkRatio < 0.002 || inkRatio > 0.55) return null;

  const imageArea = image.width * image.height;
  const minArea = Math.max(70, imageArea * 0.00008);
  const maxArea = imageArea * 0.025;
  const blobs = findDarkBlobs(binary, image.width, image.height, Math.floor(minArea));

  const candidates = blobs.filter((blob) => {
    const aspect = blob.width / Math.max(1, blob.height);
    const side = Math.sqrt(blob.area);
    return (
      blob.area <= maxArea &&
      blob.fill > 0.52 &&
      aspect > 0.48 &&
      aspect < 2.1 &&
      side > 7 &&
      side < Math.min(image.width, image.height) * 0.22
    );
  });

  if (candidates.length < 4) return null;

  const top = candidates.sort((a, b) => b.area - a.area).slice(0, 22);
  const pageAspect = layout.width / layout.height;
  const imageCenter = { x: image.width / 2, y: image.height / 2 };
  let best: { points: Point[]; score: number } | null = null;

  for (let a = 0; a < top.length - 3; a += 1) {
    for (let b = a + 1; b < top.length - 2; b += 1) {
      for (let c = b + 1; c < top.length - 1; c += 1) {
        for (let d = c + 1; d < top.length; d += 1) {
          const group = [top[a], top[b], top[c], top[d]];
          const raw = group.map((blob) => ({ x: blob.centerX, y: blob.centerY }));
          if (!isConvex(orderQuad(raw))) continue;

          const points = orderQuad(raw);
          const area = quadArea(points);
          if (area < imageArea * 0.06) continue;

          const xs = points.map((point) => point.x);
          const ys = points.map((point) => point.y);
          const bboxW = Math.max(...xs) - Math.min(...xs);
          const bboxH = Math.max(...ys) - Math.min(...ys);
          if (bboxW < image.width * 0.3 || bboxH < image.height * 0.3) continue;

          const bboxAspect = bboxW / Math.max(1, bboxH);
          const aspectRatio = bboxAspect / pageAspect;
          if (aspectRatio < 0.55 || aspectRatio > 1.9) continue;

          const sides = group.map((blob) => Math.sqrt(blob.area));
          const sizeRatio = Math.min(...sides) / Math.max(...sides);
          if (sizeRatio < 0.42) continue;

          const fill = group.reduce((sum, blob) => sum + blob.fill, 0) / 4;
          if (fill < 0.6) continue;

          const cornerDistance =
            points.reduce((sum, point) => {
              const dx = Math.abs(point.x - imageCenter.x) / imageCenter.x;
              const dy = Math.abs(point.y - imageCenter.y) / imageCenter.y;
              return sum + (dx + dy) / 2;
            }, 0) / 4;
          const cornerPrior = 1 - clamp((cornerDistance - 0.45) * 1.4, 0, 0.55);
          const aspectPenalty = 1 - clamp(Math.abs(Math.log(aspectRatio)), 0, 0.35);
          const score = area * sizeRatio * fill * cornerPrior * aspectPenalty;

          if (!best || score > best.score) {
            best = { points, score };
          }
        }
      }
    }
  }

  if (!best) return null;

  return {
    points: best.points.map((point) => ({ x: point.x / scale, y: point.y / scale })),
    scale,
    candidates: candidates.length,
  };
}

interface BubbleReading {
  score: number;
  fill: number;
  darkRatio: number;
  background: number;
  inside: boolean;
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 235;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[index];
}

function readBubble(
  gray: Uint8Array,
  width: number,
  height: number,
  center: Point,
  localRadius: number
): BubbleReading {
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    return { score: 0, fill: 0, darkRatio: 0, background: 0, inside: false };
  }

  const backgroundSamples: number[] = [];
  const ringRadius = Math.max(2.2, localRadius * 1.55);
  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * Math.PI * 2;
    const x = Math.round(center.x + Math.cos(angle) * ringRadius);
    const y = Math.round(center.y + Math.sin(angle) * ringRadius);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    backgroundSamples.push(gray[y * width + x]);
  }
  const background = percentile(backgroundSamples, 0.75);

  // Every bubble carries its choice letter in the middle. Sample the ring
  // between that letter and the printed outline. The window is deliberately
  // tight: on real school scans the outline and letter gain a millimetre of
  // toner spread, and a wider ring starts treating that spread as a mark,
  // which turns one shaded bubble into a row of false "multiple" flags.
  const innerRadius = Math.max(1, localRadius * 0.5);
  const outerRadius = Math.max(innerRadius + 0.8, localRadius * 0.74);
  const innerSq = innerRadius * innerRadius;
  const outerSq = outerRadius * outerRadius;
  const step = Math.max(1, Math.floor(localRadius / 14));
  let count = 0;
  let sum = 0;
  let dark = 0;
  const darkThreshold = Math.max(35, background * 0.58);

  const left = Math.max(0, Math.floor(center.x - outerRadius));
  const right = Math.min(width - 1, Math.ceil(center.x + outerRadius));
  const top = Math.max(0, Math.floor(center.y - outerRadius));
  const bottom = Math.min(height - 1, Math.ceil(center.y + outerRadius));

  for (let y = top; y <= bottom; y += step) {
    for (let x = left; x <= right; x += step) {
      const dx = x - center.x;
      const dy = y - center.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < innerSq || distanceSq > outerSq) continue;
      const value = gray[y * width + x];
      sum += value;
      count += 1;
      if (value < darkThreshold) dark += 1;
    }
  }

  if (count === 0) {
    return { score: 0, fill: 0, darkRatio: 0, background, inside: false };
  }

  const mean = sum / count;
  const fill = clamp((background - mean) / Math.max(background, 1), 0, 1);
  const darkRatio = dark / count;
  // Dark coverage is the reliable signal inside the tight ring: a shaded
  // bubble is mostly black there, while an empty one only picks up a little
  // edge blur.
  const score = fill * 0.4 + darkRatio * 0.6;

  return {
    score,
    fill,
    darkRatio,
    background,
    inside: backgroundSamples.length >= 6 && background > 25,
  };
}

function buildDebugOverlay(
  source: ImageData,
  exam: Exam,
  layout: SheetLayout,
  homography: number[] | null,
  markers: Point[] | null,
  answers: (string | null)[],
  flags: ItemFlag[]
): string {
  const maxWidth = 1300;
  const scale = Math.min(1, maxWidth / source.width);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const base = document.createElement('canvas');
  base.width = source.width;
  base.height = source.height;
  const baseCtx = base.getContext('2d');
  if (!baseCtx) return '';
  baseCtx.putImageData(source, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(base, 0, 0, width, height);

  const flagByItem = new Map(flags.map((flag) => [flag.item, flag]));

  if (markers) {
    markers.forEach((point) => {
      ctx.strokeStyle = '#1f7a4d';
      ctx.lineWidth = 2;
      const size = 12 * scale;
      ctx.strokeRect(point.x * scale - size, point.y * scale - size, size * 2, size * 2);
    });
  }

  if (homography) {
    layout.items.forEach((item, index) => {
      const answer = answers[index];
      const flag = flagByItem.get(item.item);
      item.bubbles.forEach((bubble) => {
        const point = applyHomography(homography, { x: bubble.x, y: bubble.y });
        const px = point.x * scale;
        const py = point.y * scale;
        if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0 || px >= width || py >= height) return;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(3, bubble.r * scale * 1.4), 0, Math.PI * 2);
        if (flag?.multiple || flag?.ambiguous) {
          ctx.strokeStyle = '#c07b17';
          ctx.lineWidth = 2;
        } else if (answer === bubble.choice) {
          ctx.strokeStyle = '#1f7a4d';
          ctx.lineWidth = 2;
        } else {
          ctx.strokeStyle = 'rgba(70, 64, 54, 0.25)';
          ctx.lineWidth = 1;
        }
        ctx.stroke();
      });
    });
  }

  ctx.fillStyle = 'rgba(252, 248, 240, 0.92)';
  ctx.fillRect(8, 8, 310 * scale, 34 * scale);
  ctx.fillStyle = '#27241e';
  ctx.font = `${Math.max(9, 12 * scale)}px system-ui, sans-serif`;
  ctx.fillText(
    `${markers ? markers.length : 0}/4 corner marks · ${homography ? 'aligned' : 'not aligned'} · ${exam.code}`,
    14,
    28 * scale
  );

  return canvasToJpegDataUrl(canvas, 0.82);
}

interface SheetRead {
  result: OmrReadResult;
  /** Width ÷ height of the detected corner-mark box, measured upright. */
  markerAspect: number | null;
  /** Width of the corner-mark box in source pixels. */
  markerWidth: number | null;
  /** Width of the decoded QR symbol in source pixels. */
  qrWidth: number | null;
}

function markerBounds(points: Point[]): { width: number; height: number } | null {
  if (points.length < 4) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

function readSheetImageData(source: ImageData, exam: Exam, onProgress?: ProgressFn): SheetRead {
  const layout = buildExamLayout(exam);
  const warnings: string[] = [];

  onProgress?.({ phase: 'qr', message: 'Reading the QR code…', percent: 10 });
  const qr = detectQrWithRotation(source);
  let upright = source;
  if (qr.rotation !== 0) {
    upright = rotateImageData(source, qr.rotation);
  }

  let parsed: { examCode: string; lrn: string } | null = null;
  if (qr.payload) {
    parsed = parseSheetQr(qr.payload);
    if (!parsed) warnings.push('A QR code was found, but it is not a Tsek sheet code.');
    else if (parsed.examCode !== exam.code.toUpperCase()) {
      warnings.push(`This sheet belongs to exam ${parsed.examCode}, not ${exam.code}.`);
    }
  } else {
    warnings.push('QR code not readable. Assign the learner manually, or rescan at a higher resolution.');
  }

  onProgress?.({ phase: 'markers', message: 'Finding the corner marks…', percent: 32 });
  const markerResult = detectMarkers(upright, layout);
  let homography: number[] | null = null;
  let markers: Point[] | null = null;

  if (markerResult) {
    markers = markerResult.points;
    const canonical = layout.markers.map((marker) => ({ x: marker.x, y: marker.y }));
    homography = computeHomography(canonical, markers);
    if (!homography) warnings.push('The corner marks were found but could not be aligned. Try a flatter scan.');
  } else {
    warnings.push('Corner marks not found. Place the whole sheet inside the scan area, with no cropping.');
  }

  const answers: (string | null)[] = Array.from({ length: exam.itemCount }, () => null);
  const flags: ItemFlag[] = [];
  let confidenceSum = 0;
  let confidenceCount = 0;

  if (homography) {
    const gray = grayscale(upright);
    const width = upright.width;
    const height = upright.height;

    layout.items.forEach((item, index) => {
      if (index % 10 === 0) {
        onProgress?.({
          phase: 'sampling',
          message: `Reading bubbles… item ${Math.min(exam.itemCount, index + 1)} of ${exam.itemCount}`,
          percent: 35 + Math.round((index / exam.itemCount) * 50),
        });
      }

      const center = applyHomography(homography!, { x: item.bubbles[0].x, y: item.bubbles[0].y });
      const edge = applyHomography(homography!, {
        x: item.bubbles[0].x + item.bubbles[0].r,
        y: item.bubbles[0].y,
      });
      const localRadius = Math.hypot(edge.x - center.x, edge.y - center.y);

      const readings = item.bubbles.map((bubble) => {
        const point = applyHomography(homography!, { x: bubble.x, y: bubble.y });
        return {
          choice: bubble.choice,
          ...readBubble(gray, width, height, point, localRadius),
        };
      });

      const marked = readings.filter((reading) => reading.inside && reading.darkRatio > 0.4);
      marked.sort((a, b) => b.score - a.score);

      if (marked.length === 0) {
        answers[index] = null;
        const bestFaint = readings.reduce((best, reading) => Math.max(best, reading.score), 0);
        if (bestFaint > 0.11) {
          flags.push({
            item: item.item,
            chosen: null,
            filled: [],
            ambiguous: false,
            multiple: false,
            confidence: 0.2,
          });
        }
        confidenceSum += 0.9;
        confidenceCount += 1;
        return;
      }

      const best = marked[0];
      const second = marked[1];
      const ambiguous = Boolean(second && best.score - second.score < 0.1);
      const multiple = marked.length > 1;
      answers[index] = best.choice as Choice;
      const confidence = second
        ? clamp((best.score - second.score) / 0.32, 0.15, 1)
        : clamp((best.score - 0.12) / 0.5, 0.35, 1);

      confidenceSum += confidence;
      confidenceCount += 1;

      if (multiple || ambiguous || confidence < 0.28 || !best.inside) {
        flags.push({
          item: item.item,
          chosen: best.choice,
          filled: marked.map((reading) => reading.choice),
          ambiguous,
          multiple,
          confidence: Math.round(confidence * 100) / 100,
        });
      }
    });
  } else {
    answers.fill(null);
  }

  // A sheet that aligns but yields nothing is usually a mismatch between the
  // printed sheet and the exam settings, not a learner who left everything
  // blank. Say so instead of reporting a silent zero.
  if (homography && !answers.some(Boolean)) {
    warnings.push(
      'No shaded answers were found on this sheet. If the learner did answer, check that the paper size, orientation, and sheets per page match the printed sheet.'
    );
  }

  onProgress?.({ phase: 'scoring', message: 'Scoring this sheet…', percent: 90 });

  const debugImage = buildDebugOverlay(upright, exam, layout, homography, markers, answers, flags);

  const result: OmrReadResult = {
    qrPayload: qr.payload,
    examCode: parsed?.examCode ?? null,
    lrn: parsed?.lrn ?? null,
    rotation: qr.rotation,
    answers,
    flags,
    markerCount: markers?.length ?? 0,
    qrOk: Boolean(parsed && parsed.examCode === exam.code.toUpperCase()),
    confidence: confidenceCount ? Math.round((confidenceSum / confidenceCount) * 100) / 100 : 0,
    debugImage,
    warnings,
  };

  const bounds = markers ? markerBounds(markers) : null;

  return {
    result,
    markerAspect: bounds ? bounds.width / bounds.height : null,
    markerWidth: bounds?.width ?? null,
    qrWidth: qr.symbolWidth,
  };
}

export function processSheetImageData(
  source: ImageData,
  exam: Exam,
  onProgress?: ProgressFn
): OmrReadResult {
  return readSheetImageData(source, exam, onProgress).result;
}

export interface ScannedPage {
  pageNumber: number;
  totalPages: number;
  result: OmrReadResult;
  /** Which half of a two-up page this sheet came from. */
  region?: 'left' | 'right' | 'top' | 'bottom';
  error?: string;
}

export interface PageSheetRead {
  result: OmrReadResult;
  region?: ScannedPage['region'];
}

type SplitDirection = 'vertical' | 'horizontal';

function splitHalves(
  image: ImageData,
  direction: SplitDirection
): Array<{ region: NonNullable<ScannedPage['region']>; image: ImageData }> {
  if (direction === 'vertical') {
    const half = Math.floor(image.width / 2);
    return [
      { region: 'left', image: cropImageData(image, 0, 0, half, image.height) },
      { region: 'right', image: cropImageData(image, half, 0, image.width - half, image.height) },
    ];
  }
  const half = Math.floor(image.height / 2);
  return [
    { region: 'top', image: cropImageData(image, 0, 0, image.width, half) },
    { region: 'bottom', image: cropImageData(image, 0, half, image.width, image.height - half) },
  ];
}

/**
 * Read one scanned page, splitting it into two sheets when it is a two-up
 * print. Exposed so the self-test can exercise the same path as a real scan.
 */
export function readPageImageData(
  image: ImageData,
  exam: Exam,
  onProgress?: ProgressFn
): PageSheetRead[] {
  if (exam.sheetsPerPage === 2) {
    const layout = buildExamLayout(exam);
    const expectedAspect = layout.width / layout.height;
    const aspectTolerance = Math.log(1.12);
    // On the printed sheet the QR is a fixed fraction of the distance between
    // the corner marks. Checking that ratio as well makes it very unlikely that
    // four shaded bubbles can pass for a real sheet.
    const markerSpan = layout.markers[1].x - layout.markers[0].x;
    const expectedQrRatio = layout.qr.size / markerSpan;

    const hasSheetProportions = (read: SheetRead) => {
      if (!read.markerAspect) return false;
      return Math.abs(Math.log(read.markerAspect / expectedAspect)) <= aspectTolerance;
    };
    const hasSheetQrScale = (read: SheetRead) => {
      if (!read.qrWidth || !read.markerWidth) return false;
      const ratio = read.qrWidth / read.markerWidth / expectedQrRatio;
      return ratio > 0.7 && ratio < 1.3;
    };
    const healthy = (read: SheetRead) =>
      read.result.markerCount === 4 &&
      read.result.qrOk &&
      hasSheetProportions(read) &&
      hasSheetQrScale(read) &&
      read.result.flags.length <= Math.max(4, Math.ceil(exam.itemCount * 0.15));

    // Do not trust the image aspect ratio: a flatbed scan or a phone photo
    // often adds margins or background, and the page can even sit sideways on
    // the bed. Try the natural split direction first, then the other one.
    const first: SplitDirection = image.width >= image.height ? 'vertical' : 'horizontal';
    const directions: SplitDirection[] = [first, first === 'vertical' ? 'horizontal' : 'vertical'];

    for (const direction of directions) {
      const reads = splitHalves(image, direction).map((half) => ({
        region: half.region,
        ...readSheetImageData(half.image, exam, onProgress),
      }));
      // A direction is right only when at least one half is a complete, aligned
      // sheet from this exam. A cut single sheet cannot satisfy that, so we move
      // on and finally read the image whole.
      if (reads.some(healthy)) {
        const useful = reads.filter((read) => read.result.markerCount >= 3);
        if (useful.length > 0) {
          return useful.map((read) => ({ region: read.region, result: read.result }));
        }
      }
    }
  }

  return [{ result: processSheetImageData(image, exam, onProgress) }];
}

export async function scanFile(
  file: File,
  exam: Exam,
  onProgress?: ProgressFn
): Promise<ScannedPage[]> {
  onProgress?.({ phase: 'reading', message: `Reading ${file.name}…`, percent: 3 });
  const output: ScannedPage[] = [];

  if (isPdfFile(file)) {
    const targetWidth = exam.sheetsPerPage === 2 ? 3200 : 2400;
    const pages = await renderPdfFile(
      file,
      (page, totalPages) => {
        onProgress?.({
          phase: 'rendering',
          message: `Rendering PDF page ${page} of ${totalPages}…`,
          page,
          totalPages,
          percent: 5 + Math.round((page / totalPages) * 15),
        });
      },
      targetWidth
    );
    for (const page of pages) {
      try {
        const reads = readPageImageData(page.imageData, exam, (progress) =>
          onProgress?.({
            ...progress,
            page: page.pageNumber,
            totalPages: page.totalPages,
            percent: progress.percent
              ? Math.round(15 + progress.percent * 0.8)
              : undefined,
          })
        );
        reads.forEach((read) => {
          output.push({
            pageNumber: page.pageNumber,
            totalPages: page.totalPages,
            result: read.result,
            region: read.region,
          });
        });
      } catch (error) {
        output.push({
          pageNumber: page.pageNumber,
          totalPages: page.totalPages,
          result: emptyFailure(exam, file.name),
          error: error instanceof Error ? error.message : 'Page could not be processed.',
        });
      }
    }
  } else {
    const loaded = await loadImageFile(file);
    readPageImageData(loaded.imageData, exam, onProgress).forEach((read) => {
      output.push({ pageNumber: 1, totalPages: 1, result: read.result, region: read.region });
    });
  }

  onProgress?.({ phase: 'done', message: 'Finished.', percent: 100 });
  return output;
}

function emptyFailure(exam: Exam, file: string): OmrReadResult {
  return {
    qrPayload: null,
    examCode: null,
    lrn: null,
    rotation: 0,
    answers: Array.from({ length: exam.itemCount }, () => null),
    flags: [],
    markerCount: 0,
    qrOk: false,
    confidence: 0,
    debugImage: '',
    warnings: [`Could not process ${file}.`],
  };
}
