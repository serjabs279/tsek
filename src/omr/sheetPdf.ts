import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Exam, Learner } from '../types';
import { MM_TO_PT, buildExamLayout, markerRect, pageSize, type SheetLayout } from './layout';
import { makeQrDataUrl, makeSheetQrPayload } from './qr';

export interface SheetPdfOptions {
  includeQr: boolean;
  includeName: boolean;
  schoolName: string;
}

const INK = rgb(0.13, 0.12, 0.1);
const MUTED = rgb(0.34, 0.32, 0.28);
const LINE = rgb(0.58, 0.54, 0.46);
const BUBBLE = rgb(0.3, 0.28, 0.24);
const ACCENT = rgb(0.43, 0.22, 0.13);

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function fitText(font: PDFFont, text: string, maxWidth: number, preferred: number, minimum: number): number {
  let size = preferred;
  while (size > minimum && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.5;
  }
  return size;
}

export async function buildSheetsPdf(
  exam: Exam,
  learners: Learner[],
  options: SheetPdfOptions
): Promise<Uint8Array> {
  return buildPdf(exam, learners, options, false);
}

/** A single sheet, cropped to the half-page size used in the print run. */
export async function buildSingleSheetPdf(
  exam: Exam,
  learner: Learner,
  options: SheetPdfOptions
): Promise<Uint8Array> {
  return buildPdf(exam, [learner], options, true);
}

async function buildPdf(
  exam: Exam,
  learners: Learner[],
  options: SheetPdfOptions,
  cropToSheet: boolean
): Promise<Uint8Array> {
  const layout = buildExamLayout(exam);
  const page = pageSize(exam.paper, exam.orientation);
  const pageWidth = cropToSheet ? layout.width : page.width;
  const pageHeight = cropToSheet ? layout.height : page.height;
  const perPage = cropToSheet ? 1 : exam.sheetsPerPage;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${exam.title} — answer sheets`);
  pdf.setAuthor('Tsek · Exam Checker');
  pdf.setSubject(`${exam.subject} · ${exam.section}`);

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const qrImages = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>();
  if (options.includeQr) {
    const unique = Array.from(new Set(learners.map((learner) => learner.lrn)));
    await Promise.all(
      unique.map(async (lrn) => {
        const payload = makeSheetQrPayload(exam.code, lrn);
        const dataUrl = await makeQrDataUrl(payload);
        const image = await pdf.embedPng(dataUrlToBytes(dataUrl));
        qrImages.set(lrn, image);
      })
    );
  }

  const sideBySide = pageWidth > pageHeight;
  const slots = Math.max(1, perPage);
  const pageCount = Math.ceil(learners.length / slots);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pdfPage = pdf.addPage([pageWidth * MM_TO_PT, pageHeight * MM_TO_PT]);

    if (slots === 2) {
      if (sideBySide) {
        pdfPage.drawLine({
          start: { x: layout.width * MM_TO_PT, y: 4 * MM_TO_PT },
          end: { x: layout.width * MM_TO_PT, y: pdfPage.getHeight() - 4 * MM_TO_PT },
          thickness: 0.35,
          color: LINE,
          dashArray: [4, 4],
        });
      } else {
        const cutY = pdfPage.getHeight() - layout.height * MM_TO_PT;
        pdfPage.drawLine({
          start: { x: 4 * MM_TO_PT, y: cutY },
          end: { x: pdfPage.getWidth() - 4 * MM_TO_PT, y: cutY },
          thickness: 0.35,
          color: LINE,
          dashArray: [4, 4],
        });
      }
    }

    for (let slot = 0; slot < slots; slot += 1) {
      const index = pageIndex * slots + slot;
      const learner = learners[index];
      if (!learner) break;
      const offsetX = slot === 1 && sideBySide ? layout.width : 0;
      const offsetY = slot === 1 && !sideBySide ? layout.height : 0;
      drawSheet({
        page: pdfPage,
        exam,
        learner,
        index,
        total: learners.length,
        layout,
        regular,
        bold,
        options,
        qrImage: qrImages.get(learner.lrn),
        offsetX,
        offsetY,
      });
    }
  }

  return pdf.save();
}

interface DrawArgs {
  page: PDFPage;
  exam: Exam;
  learner: Learner;
  index: number;
  total: number;
  layout: SheetLayout;
  regular: PDFFont;
  bold: PDFFont;
  options: SheetPdfOptions;
  qrImage?: Awaited<ReturnType<PDFDocument['embedPng']>>;
  offsetX: number;
  offsetY: number;
}

function drawSheet({
  page,
  exam,
  learner,
  index,
  total,
  layout,
  regular,
  bold,
  options,
  qrImage,
  offsetX,
  offsetY,
}: DrawArgs) {
  const pageHeight = page.getHeight();
  const X = (mm: number) => (mm + offsetX) * MM_TO_PT;
  const Y = (mm: number) => pageHeight - (mm + offsetY) * MM_TO_PT;
  const S = (mm: number) => mm * MM_TO_PT;
  const F = (mm: number) => S(mm) * layout.scale;
  const rect = (x: number, yTop: number, width: number, height: number) => ({
    x: X(x),
    y: Y(yTop + height),
    width: S(width),
    height: S(height),
  });

  page.drawRectangle({
    ...rect(7.5 * layout.scale, 7.5 * layout.scale, layout.width - 15 * layout.scale, layout.height - 15 * layout.scale),
    borderColor: LINE,
    // A visible sheet edge: hairline borders fade out on school printers.
    borderWidth: S(Math.max(0.45, 0.55 * layout.scale)),
  });

  layout.markers.forEach((marker) => {
    const r = markerRect(marker, layout.markerSize);
    page.drawRectangle({ ...rect(r.x, r.y, r.width, r.height), color: INK });
  });

  const textWidth = (options.includeQr ? layout.qr.x - 6 : layout.width - layout.contentLeft) - layout.contentLeft;

  page.drawText(options.schoolName.toUpperCase(), {
    x: X(layout.contentLeft),
    y: Y(layout.header.schoolY),
    size: fitText(bold, options.schoolName.toUpperCase(), S(textWidth), F(4.1), F(2.4)),
    font: bold,
    color: INK,
  });

  page.drawText('ANSWER SHEET', {
    x: X(layout.contentLeft),
    y: Y(layout.header.answerSheetY),
    size: F(2.25),
    font: bold,
    color: ACCENT,
  });

  page.drawText(exam.title, {
    x: X(layout.contentLeft),
    y: Y(layout.header.titleY),
    size: fitText(regular, exam.title, S(textWidth), F(3.1), F(2.1)),
    font: regular,
    color: MUTED,
  });

  page.drawText('NAME', {
    x: X(layout.contentLeft),
    y: Y(layout.header.nameLabelY),
    size: F(1.9),
    font: bold,
    color: MUTED,
  });

  const showName = options.includeName ? learner.name : '______________________________________________';
  page.drawText(showName, {
    x: X(layout.contentLeft),
    y: Y(layout.header.nameY),
    size: fitText(bold, showName, S(textWidth), F(4.5), F(2.3)),
    font: bold,
    color: INK,
  });

  page.drawText('LRN', {
    x: X(layout.contentLeft),
    y: Y(layout.header.lrnLabelY),
    size: F(1.9),
    font: bold,
    color: MUTED,
  });

  page.drawText(learner.lrn, {
    x: X(layout.contentLeft),
    y: Y(layout.header.lrnY),
    size: F(3.7),
    font: bold,
    color: INK,
  });

  page.drawText(`EXAM CODE  ${exam.code}`, {
    x: X(layout.contentLeft + Math.min(textWidth * 0.52, 72 * layout.scale)),
    y: Y(layout.header.lrnY),
    size: F(2.4),
    font: bold,
    color: ACCENT,
  });

  page.drawRectangle({
    ...rect(layout.contentLeft, layout.header.dividerY, layout.width - layout.contentLeft * 2, 0.5 * layout.scale),
    color: LINE,
  });

  const instructions =
    'Shade the circle completely with a dark pencil. Erase changes cleanly. Do not fold or staple through the black corner marks.';
  page.drawText(instructions, {
    x: X(layout.contentLeft),
    y: Y(layout.header.instructionY),
    size: fitText(regular, instructions, S(layout.width - layout.contentLeft * 2), F(2.15), F(1.55)),
    font: regular,
    color: MUTED,
  });

  if (qrImage && options.includeQr) {
    page.drawImage(qrImage, {
      x: X(layout.qr.x),
      y: Y(layout.qr.y + layout.qr.size),
      width: S(layout.qr.size),
      height: S(layout.qr.size),
    });
  }

  // Choice legend above each column, aligned with the actual bubble columns.
  // A column that mixes bubble sets (for example T/F beside A–E) skips the
  // legend; every bubble still prints its own letter.
  for (let col = 0; col < layout.grid.cols; col += 1) {
    const firstItem = layout.items[col * layout.grid.rows];
    if (!firstItem) continue;
    const signature = firstItem.bubbles.map((bubble) => bubble.choice).join('');
    const columnItems = layout.items.filter((_, index) => Math.floor(index / layout.grid.rows) === col);
    if (!columnItems.every((item) => item.bubbles.map((bubble) => bubble.choice).join('') === signature)) continue;
    firstItem.bubbles.forEach((bubble) => {
      page.drawText(bubble.choice, {
        x: X(bubble.x) - S(0.75 * layout.scale),
        y: Y(layout.grid.legendY),
        size: F(2.5),
        font: bold,
        color: MUTED,
      });
    });
  }

  layout.items.forEach((item) => {
    page.drawText(String(item.item), {
      x: X(item.numberX),
      y: Y(item.numberY + 1.0 * layout.scale),
      size: F(2.6),
      font: regular,
      color: MUTED,
    });
    item.bubbles.forEach((bubble) => {
      page.drawCircle({
        x: X(bubble.x),
        y: Y(bubble.y),
        size: S(bubble.r),
        borderColor: BUBBLE,
        borderWidth: S(layout.grid.bubbleStroke),
        color: rgb(1, 1, 1),
      });
      // The choice letter sits in the middle so learners never have to match
      // a bubble back to the column legend. It is small enough that the
      // scanner's ring sample never touches it.
      const letterSize = S(layout.grid.bubbleLetterSize);
      const letterWidth = bold.widthOfTextAtSize(bubble.choice, letterSize);
      page.drawText(bubble.choice, {
        x: X(bubble.x) - letterWidth / 2,
        y: Y(bubble.y + layout.grid.bubbleLetterSize * 0.36),
        size: letterSize,
        font: bold,
        color: BUBBLE,
      });
    });
  });

  page.drawText(`${exam.subject}  ·  ${exam.quarterKey}  ·  ${exam.assessmentName}`, {
    x: X(layout.contentLeft),
    y: Y(layout.footerY),
    size: F(2.1),
    font: regular,
    color: MUTED,
  });

  page.drawText(`${exam.code}  ·  page ${index + 1} of ${total}`, {
    x: X(layout.width - layout.contentLeft - 38 * layout.scale),
    y: Y(layout.footerY),
    size: F(2.1),
    font: regular,
    color: MUTED,
  });

  page.drawText('TSEK', {
    x: X(layout.width / 2 - 4 * layout.scale),
    y: Y(layout.footerY),
    size: F(2.1),
    font: bold,
    color: ACCENT,
  });
}

export async function downloadSheetsPdf(
  exam: Exam,
  learners: Learner[],
  options: SheetPdfOptions,
  filename: string
): Promise<void> {
  const bytes = await buildSheetsPdf(exam, learners, options);
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
