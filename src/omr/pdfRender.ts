import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface RenderedPage {
  pageNumber: number;
  totalPages: number;
  imageData: ImageData;
  width: number;
  height: number;
}

interface InkAnnotationData {
  subtype?: string;
  color?: number[] | null;
  opacity?: number;
  borderStyle?: { width?: number } | null;
  inkLists?: number[][][] | null;
}

function annotationInk(color: number[] | null | undefined, opacity: number | undefined): string {
  const alpha = typeof opacity === 'number' && opacity > 0 && opacity <= 1 ? opacity : 1;
  const raw = color ? Array.from(color as ArrayLike<number>).filter((value) => Number.isFinite(value)) : [];
  if (raw.length === 0) return `rgba(20, 18, 14, ${alpha})`;
  // pdf.js reports annotation colours as 0–255 channel values, while older
  // releases used 0–1 floats. Treat the array as floats only when every
  // channel fits that range so real ink keeps its colour instead of being
  // multiplied past white and clipped.
  const unitScale = raw.every((value) => value >= 0 && value <= 1);
  let rgb: number[];
  if (raw.length >= 4) {
    const [c, m, y, k] = raw.map((value) => (unitScale ? value : value / 255));
    rgb = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  } else {
    const channels = raw.length === 1 ? [raw[0], raw[0], raw[0]] : raw.slice(0, 3);
    rgb = channels.map((value) => (unitScale ? value : value / 255));
  }
  const bytes = rgb.map((value) => Math.max(0, Math.min(255, Math.round(value * 255))));
  return `rgba(${bytes.join(', ')}, ${alpha})`;
}

/**
 * Scanner apps such as CamScanner often keep part of the pencil work as PDF
 * ink annotations instead of baking it into the page image. pdf.js renders the
 * page only, so those strokes would be invisible to the checker. Draw them on
 * top of the rendered page before it is sampled.
 */
async function drawInkAnnotations(
  context: CanvasRenderingContext2D,
  page: PDFPageProxy,
  viewport: PageViewport
): Promise<void> {
  let annotations: unknown[] = [];
  try {
    annotations = await page.getAnnotations();
  } catch {
    return;
  }

  for (const entry of annotations) {
    const annotation = entry as InkAnnotationData;
    if (annotation.subtype !== 'Ink' || !annotation.inkLists?.length) continue;

    context.save();
    context.strokeStyle = annotationInk(annotation.color, annotation.opacity);
    context.fillStyle = context.strokeStyle;
    context.lineWidth = Math.max(1.5, (annotation.borderStyle?.width || 1) * viewport.scale);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    for (const path of annotation.inkLists) {
      if (!Array.isArray(path) || path.length === 0) continue;
      const [firstX, firstY] = viewport.convertToViewportPoint(path[0][0], path[0][1]);
      if (path.length === 1) {
        // A single tap is a dot in the annotation viewer, not an empty stroke.
        context.beginPath();
        context.arc(firstX, firstY, context.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
        continue;
      }
      context.beginPath();
      context.moveTo(firstX, firstY);
      for (let index = 1; index < path.length; index += 1) {
        const [x, y] = viewport.convertToViewportPoint(path[index][0], path[index][1]);
        context.lineTo(x, y);
      }
      context.stroke();
    }

    context.restore();
  }
}

export async function renderPdfFile(
  file: File,
  onProgress?: (page: number, totalPages: number) => void,
  targetWidth = 2400
): Promise<RenderedPage[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages: RenderedPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.(pageNumber, pdf.numPages);
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(4.5, Math.max(1, targetWidth / baseViewport.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D is unavailable in this browser.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: context,
      viewport,
      canvas,
    } as Parameters<typeof page.render>[0]).promise;

    await drawInkAnnotations(context, page, viewport);

    pages.push({
      pageNumber,
      totalPages: pdf.numPages,
      imageData: context.getImageData(0, 0, canvas.width, canvas.height),
      width: canvas.width,
      height: canvas.height,
    });
    page.cleanup();
  }

  await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
  return pages;
}

export async function loadImageFile(file: File): Promise<{ imageData: ImageData; width: number; height: number }> {
  let width = 0;
  let height = 0;
  let source: CanvasImageSource | null = null;

  try {
    const bitmap = await createImageBitmap(file);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('This image could not be opened. Use JPG, PNG, WEBP, or PDF.'));
        element.src = url;
      });
      source = image;
      width = image.naturalWidth;
      height = image.naturalHeight;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  if (!source || !width || !height) {
    throw new Error('The image has no readable dimensions.');
  }

  const maxDimension = 3000;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is unavailable in this browser.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ('close' in source && typeof source.close === 'function') source.close();

  return {
    imageData: context.getImageData(0, 0, canvas.width, canvas.height),
    width: canvas.width,
    height: canvas.height,
  };
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif|tiff?)$/i.test(file.name);
}
