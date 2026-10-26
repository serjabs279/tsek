import type { Exam, Learner } from '../types';
import { buildExamLayout, markerRect, pageSize, sheetSize } from './layout';
import { makeQrDataUrl, makeSheetQrPayload } from './qr';
import { processSheetImageData, readPageImageData } from './scanner';
import { rotateImageData } from './imageOps';
import { scannableItems } from '../lib/sections';

export interface SelfTestCase {
  name: string;
  pass: boolean;
  details: string;
  lrn: string | null;
  markerCount: number;
  matched: number;
  total: number;
  debugImage: string;
}

export interface SelfTestReport {
  pass: boolean;
  cases: SelfTestCase[];
}

const PX_PER_MM = 8;

function fontPx(mm: number): string {
  return `${Math.max(6, mm * PX_PER_MM * 0.74)}px "Helvetica Neue", Arial, sans-serif`;
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('QR image could not be loaded.'));
    image.src = dataUrl;
  });
}

function makeExpectedAnswers(exam: Exam): (string | null)[] {
  return scannableItems(exam).map((item, index) => {
    const key = exam.answerKey[item.answerIndex ?? index] ?? '';
    if (!key) return null;
    if (index % 11 === 0) return null;
    if (index % 13 === 0) {
      const alternatives = item.choices.filter((choice) => choice !== key);
      return alternatives[index % alternatives.length] ?? key;
    }
    return key;
  });
}

export async function renderSyntheticSheet(
  exam: Exam,
  learner: Learner,
  expected: (string | null)[],
  options: { schoolName: string; simulateMarks?: boolean }
): Promise<HTMLCanvasElement> {
  const layout = buildExamLayout(exam);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.width * PX_PER_MM);
  canvas.height = Math.round(layout.height * PX_PER_MM);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  const X = (mm: number) => mm * PX_PER_MM;
  const Y = (mm: number) => mm * PX_PER_MM;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#b0a896';
  ctx.lineWidth = Math.max(2, 0.5 * layout.scale * PX_PER_MM);
  ctx.strokeRect(X(7.5 * layout.scale), Y(7.5 * layout.scale), X(layout.width - 15 * layout.scale), Y(layout.height - 15 * layout.scale));

  ctx.fillStyle = '#141210';
  layout.markers.forEach((marker) => {
    const r = markerRect(marker, layout.markerSize);
    ctx.fillRect(X(r.x), Y(r.y), X(r.width), Y(r.height));
  });

  const left = layout.contentLeft;
  const textScale = layout.scale;

  ctx.fillStyle = '#27241e';
  ctx.font = `bold ${fontPx(4.1 * textScale)}`;
  ctx.fillText(options.schoolName.toUpperCase(), X(left), Y(layout.header.schoolY));
  ctx.fillStyle = '#7a4a32';
  ctx.font = `bold ${fontPx(2.25 * textScale)}`;
  ctx.fillText('ANSWER SHEET', X(left), Y(layout.header.answerSheetY));
  ctx.fillStyle = '#6f685c';
  ctx.font = fontPx(3.1 * textScale);
  ctx.fillText(exam.title, X(left), Y(layout.header.titleY));

  ctx.fillStyle = '#6f685c';
  ctx.font = `bold ${fontPx(1.9 * textScale)}`;
  ctx.fillText('NAME', X(left), Y(layout.header.nameLabelY));
  ctx.fillStyle = '#141210';
  ctx.font = `bold ${fontPx(4.5 * textScale)}`;
  ctx.fillText(learner.name, X(left), Y(layout.header.nameY));

  ctx.fillStyle = '#6f685c';
  ctx.font = `bold ${fontPx(1.9 * textScale)}`;
  ctx.fillText('LRN', X(left), Y(layout.header.lrnLabelY));
  ctx.fillStyle = '#141210';
  ctx.font = `bold ${fontPx(3.7 * textScale)}`;
  ctx.fillText(learner.lrn, X(left), Y(layout.header.lrnY));
  ctx.fillStyle = '#7a4a32';
  ctx.font = `bold ${fontPx(2.4 * textScale)}`;
  ctx.fillText(`EXAM CODE  ${exam.code}`, X(left + 37 * textScale), Y(layout.header.lrnY));

  ctx.strokeStyle = '#b0a896';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(left), Y(layout.header.dividerY));
  ctx.lineTo(X(layout.width - left), Y(layout.header.dividerY));
  ctx.stroke();

  ctx.fillStyle = '#6f685c';
  ctx.font = fontPx(2.15 * textScale);
  ctx.fillText(
    'Shade the circle completely with a dark pencil. Erase changes cleanly. Do not fold or staple through the black corner marks.',
    X(left),
    Y(layout.header.instructionY)
  );

  const qrPayload = makeSheetQrPayload(exam.code, learner.lrn);
  const qrDataUrl = await makeQrDataUrl(qrPayload);
  const qrImage = await loadImage(qrDataUrl);
  ctx.drawImage(qrImage, X(layout.qr.x), Y(layout.qr.y), X(layout.qr.size), Y(layout.qr.size));

  ctx.fillStyle = '#6f685c';
  ctx.font = `bold ${fontPx(2.5)}`;
  for (let col = 0; col < layout.grid.cols; col += 1) {
    const firstItem = layout.items[col * layout.grid.rows];
    if (!firstItem) continue;
    const signature = firstItem.bubbles.map((bubble) => bubble.choice).join('');
    const columnItems = layout.items.filter((_, index) => Math.floor(index / layout.grid.rows) === col);
    if (!columnItems.every((item) => item.bubbles.map((bubble) => bubble.choice).join('') === signature)) continue;
    firstItem.bubbles.forEach((bubble) => {
      const width = ctx.measureText(bubble.choice).width;
      ctx.fillText(bubble.choice, X(bubble.x) - width / 2, Y(layout.grid.legendY));
    });
  }

  layout.items.forEach((item, index) => {
    ctx.fillStyle = '#6f685c';
    ctx.font = fontPx(2.6);
    ctx.fillText(String(item.item), X(item.numberX), Y(item.numberY + 1.0));

    item.bubbles.forEach((bubble) => {
      ctx.beginPath();
      ctx.arc(X(bubble.x), Y(bubble.y), X(bubble.r), 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#4b463d';
      ctx.lineWidth = layout.grid.bubbleStroke * PX_PER_MM;
      ctx.stroke();

      const letterFont = fontPx(layout.grid.bubbleLetterSize);
      ctx.fillStyle = '#4b463d';
      ctx.font = `bold ${letterFont}`;
      ctx.textAlign = 'center';
      ctx.fillText(bubble.choice, X(bubble.x), Y(bubble.y) + parseFloat(letterFont) * 0.36);
      ctx.textAlign = 'left';

      if (options.simulateMarks !== false && expected[index] === bubble.choice) {
        ctx.beginPath();
        ctx.arc(X(bubble.x), Y(bubble.y), X(bubble.r * 0.76), 0, Math.PI * 2);
        ctx.fillStyle = '#2a2722';
        ctx.fill();
      }
    });
  });

  ctx.fillStyle = '#6f685c';
  ctx.font = fontPx(2.1 * textScale);
  ctx.fillText(`${exam.subject} · ${exam.quarterKey} · ${exam.assessmentName}`, X(left), Y(layout.footerY));
  ctx.textAlign = 'right';
  ctx.fillText(`${exam.code} · page 1 of 1`, X(layout.width - left), Y(layout.footerY));
  ctx.textAlign = 'left';

  return canvas;
}

function addNoise(image: ImageData, amount = 7): ImageData {
  const copy = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  for (let i = 0; i < copy.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * amount * 2;
    copy.data[i] = Math.max(0, Math.min(255, copy.data[i] + noise));
    copy.data[i + 1] = Math.max(0, Math.min(255, copy.data[i + 1] + noise));
    copy.data[i + 2] = Math.max(0, Math.min(255, copy.data[i + 2] + noise));
  }
  return copy;
}

function warpPerspective(source: ImageData, inset: number): ImageData {
  const width = source.width;
  const height = source.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) throw new Error('Canvas 2D is unavailable.');
  srcCtx.putImageData(source, 0, 0);

  const dest = [
    { x: width * inset, y: height * (inset + 0.01) },
    { x: width * (1 - inset * 0.7), y: height * (inset * 0.7) },
    { x: width * (1 - inset), y: height * (1 - inset) },
    { x: width * (inset * 0.8), y: height * (1 - inset * 0.9) },
  ];
  const src = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];

  const h = solve(dest, src);
  if (!h) return source;

  const out = ctx.createImageData(width, height);
  out.data.fill(255);
  const srcData = source.data;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const denominator = h[6] * x + h[7] * y + h[8];
      if (Math.abs(denominator) < 1e-9) continue;
      const sx = (h[0] * x + h[1] * y + h[2]) / denominator;
      const sy = (h[3] * x + h[4] * y + h[5]) / denominator;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const srcIndex = (Math.floor(sy) * width + Math.floor(sx)) * 4;
      const destIndex = (y * width + x) * 4;
      out.data[destIndex] = srcData[srcIndex];
      out.data[destIndex + 1] = srcData[srcIndex + 1];
      out.data[destIndex + 2] = srcData[srcIndex + 2];
      out.data[destIndex + 3] = 255;
    }
  }

  return out;
}

function solve(src: Array<{ x: number; y: number }>, dst: Array<{ x: number; y: number }>): number[] | null {
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
  const n = 8;
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
  return a.map((row) => row[n]).concat(1);
}

function imageFromCanvas(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Paste the synthetic sheet twice onto a full printed page, mirroring the PDF. */
function composeTwoUpPage(base: HTMLCanvasElement, exam: Exam): ImageData {
  const page = pageSize(exam.paper, exam.orientation);
  const sheet = sheetSize(exam.paper, exam.orientation, exam.sheetsPerPage);
  const pxPerMm = base.width / Math.max(1, sheet.width);
  const width = Math.round(page.width * pxPerMm);
  const height = Math.round(page.height * pxPerMm);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  if (width >= height) {
    ctx.drawImage(base, 0, 0);
    ctx.drawImage(base, base.width, 0);
  } else {
    ctx.drawImage(base, 0, 0);
    ctx.drawImage(base, 0, base.height);
  }
  return ctx.getImageData(0, 0, width, height);
}

export async function runSelfTest(exam: Exam, learner: Learner, schoolName: string): Promise<SelfTestReport> {
  const expected = makeExpectedAnswers(exam);
  const canvas = await renderSyntheticSheet(exam, learner, expected, { schoolName });
  const base = imageFromCanvas(canvas);

  const cases: Array<{ name: string; image: ImageData }> = [
    { name: 'Clean synthetic scan', image: base },
    { name: 'Rotated 90°', image: rotateImageData(base, 90) },
    { name: 'Perspective + scan noise', image: addNoise(warpPerspective(base, 0.035), 5) },
  ];

  const results: SelfTestCase[] = [];
  for (const testCase of cases) {
    try {
      const decoded = processSheetImageData(testCase.image, exam);
      const matched = expected.reduce(
        (sum, answer, index) => sum + (decoded.answers[index] === answer ? 1 : 0),
        0
      );
      const pass =
        decoded.lrn === learner.lrn &&
        decoded.markerCount === 4 &&
        matched === expected.length;
      results.push({
        name: testCase.name,
        pass,
        details: pass
          ? `All ${expected.length} items matched.`
          : `LRN ${decoded.lrn ?? 'not found'} · ${decoded.markerCount}/4 marks · ${matched}/${expected.length} items matched.`,
        lrn: decoded.lrn,
        markerCount: decoded.markerCount,
        matched,
        total: expected.length,
        debugImage: decoded.debugImage,
      });
    } catch (error) {
      results.push({
        name: testCase.name,
        pass: false,
        details: error instanceof Error ? error.message : 'Unknown error.',
        lrn: null,
        markerCount: 0,
        matched: 0,
        total: expected.length,
        debugImage: '',
      });
    }
  }

  if (exam.sheetsPerPage === 2) {
    const tryTwoUp = () => {
      const page = composeTwoUpPage(canvas, exam);
      const reads = readPageImageData(page, exam);
      const scores = reads.map((read) => ({
        read,
        matched: expected.reduce(
          (sum, answer, index) => sum + (read.result.answers[index] === answer ? 1 : 0),
          0
        ),
      }));
      const pass =
        scores.length === 2 &&
        scores.every(
          ({ read, matched }) =>
            read.result.lrn === learner.lrn &&
            read.result.markerCount === 4 &&
            matched === expected.length
        );
      results.push({
        name: 'Two-up page split',
        pass,
        details: pass
          ? `Both halves were found and read as separate sheets · ${scores.length} × ${expected.length}/${expected.length} items.`
          : `${scores.length} sheet${scores.length === 1 ? '' : 's'} found${
              scores.length
                ? ` · ${scores
                    .map(
                      ({ read, matched }) =>
                        `LRN ${read.result.lrn ?? 'not found'} · ${read.result.markerCount}/4 marks · ${matched}/${expected.length} items`
                    )
                    .join(' · ')}`
                : ''
            }.`,
        lrn: reads[0]?.result.lrn ?? null,
        markerCount: reads[0]?.result.markerCount ?? 0,
        matched: scores.reduce((sum, item) => sum + item.matched, 0),
        total: expected.length * 2,
        debugImage: reads[0]?.result.debugImage ?? '',
      });
    };

    try {
      tryTwoUp();
    } catch (error) {
      results.push({
        name: 'Two-up page split',
        pass: false,
        details: error instanceof Error ? error.message : 'Unknown error.',
        lrn: null,
        markerCount: 0,
        matched: 0,
        total: expected.length * 2,
        debugImage: '',
      });
    }
  }

  return { pass: results.every((item) => item.pass), cases: results };
}
