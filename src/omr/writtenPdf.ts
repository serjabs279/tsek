import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Exam, Learner } from '../types';
import { MM_TO_PT, PAPER_SIZES } from './layout';
import {
  planWrittenSheets,
  writtenPageGeometry,
  WRITTEN_LAYOUT,
  type WrittenPageGeometry,
  type WrittenPagePlan,
} from '../lib/written';
import { downloadBlob } from '../lib/download';

export interface WrittenPdfOptions {
  schoolName: string;
  /** Print the learner name; when false a blank ruled name line is printed. */
  includeName?: boolean;
}

const INK = rgb(0.13, 0.12, 0.1);
const MUTED = rgb(0.34, 0.32, 0.28);
const LINE = rgb(0.58, 0.54, 0.46);
const ACCENT = rgb(0.43, 0.22, 0.13);

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function roman(index: number): string {
  return ROMAN[index] ?? String(index + 1);
}

function points(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function fitText(font: PDFFont, text: string, maxWidth: number, preferred: number, minimum: number): number {
  let size = preferred;
  while (size > minimum && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.5;
  }
  return size;
}

export interface WrittenFonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** A full portrait page, whatever the bubble sheet is doing. */
function writtenPageSize(exam: Exam): { width: number; height: number } {
  const paper = PAPER_SIZES[exam.paper] ?? PAPER_SIZES.A4;
  return { width: paper.width, height: paper.height };
}

export async function buildWrittenSheetsPdf(
  exam: Exam,
  learners: Learner[],
  options: WrittenPdfOptions
): Promise<Uint8Array> {
  const plan = planWrittenSheets(exam);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${exam.title} — written answers`);
  pdf.setAuthor('Tsek · Exam Checker');
  pdf.setSubject(`${exam.subject} · ${exam.section} · written answers`);

  const fonts: WrittenFonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  if (plan.pages.length === 0) {
    const { width, height } = writtenPageSize(exam);
    const page = pdf.addPage([width * MM_TO_PT, height * MM_TO_PT]);
    const Y = (top: number) => height * MM_TO_PT - top * MM_TO_PT;
    page.drawText('This exam has no written parts.', {
      x: writtenPageGeometry(exam.paper).margin * MM_TO_PT,
      y: Y(40),
      size: 13,
      font: fonts.bold,
      color: INK,
    });
    return pdf.save();
  }

  learners.forEach((learner) => {
    plan.pages.forEach((pagePlan, pageIndex) => {
      const geometry = pagePlan.geometry;
      const page = pdf.addPage([geometry.width * MM_TO_PT, geometry.height * MM_TO_PT]);
      drawWrittenContent({
        page,
        exam,
        learner,
        pagePlan,
        totalPages: plan.pages.length,
        pageNumber: pageIndex + 1,
        fonts,
        options,
      });
    });
  });

  return pdf.save();
}

export async function buildWrittenSheetPdf(
  exam: Exam,
  learner: Learner,
  options: WrittenPdfOptions
): Promise<Uint8Array> {
  return buildWrittenSheetsPdf(exam, [learner], options);
}

interface DrawWrittenArgs {
  page: PDFPage;
  exam: Exam;
  learner: Learner;
  pagePlan: WrittenPagePlan;
  totalPages: number;
  pageNumber: number;
  fonts: WrittenFonts;
  options: WrittenPdfOptions;
}

/**
 * Draw one planned written page onto its own page. The page already has the
 * geometry stored in `pagePlan`, so a half-folio panel and a full portrait
 * page share the same drawing code.
 */
export function drawWrittenContent({
  page,
  exam,
  learner,
  pagePlan,
  totalPages,
  pageNumber,
  fonts,
  options,
}: DrawWrittenArgs): void {
  const geom: WrittenPageGeometry = pagePlan.geometry;
  const compact = geom.headerBottom < 40;
  const X = (mm: number) => mm * MM_TO_PT;
  const Y = (top: number) => geom.height * MM_TO_PT - top * MM_TO_PT;
  const right = geom.width - geom.margin;
  const contentWidth = geom.width - geom.margin * 2;

  // A visible sheet edge; hairline borders disappear on school printers.
  // A combined half uses the same inset as the bubble sheet beside it, so the
  // two halves line up on the paper edge.
  const borderInset = compact ? 7.5 : 8;
  page.drawRectangle({
    x: X(borderInset),
    y: Y(geom.height - borderInset),
    width: X(geom.width - borderInset * 2),
    height: Y(borderInset) - Y(geom.height - borderInset),
    borderColor: LINE,
    borderWidth: X(compact ? 0.4 : 0.5),
  });

  const pageLabel = compact
    ? `PAGE ${pageNumber} OF ${totalPages}`
    : `Page ${pageNumber} of ${totalPages}`;
  const learnerName = options.includeName === false ? '______________________' : learner.name;

  if (compact) {
    // The bubble half of this folio already carries the learner's name, LRN
    // and QR, so the written half keeps only a one-line marker. Repeating the
    // name here just ate answer space.
    page.drawText('WRITTEN ANSWERS', {
      x: X(geom.margin),
      y: Y(11),
      size: 5.8,
      font: fonts.bold,
      color: ACCENT,
    });
    const marker = `LRN ${learner.lrn}  ·  ${pageLabel}`;
    page.drawText(marker, {
      x: X(right) - fonts.regular.widthOfTextAtSize(marker, 5.2),
      y: Y(11),
      size: 5.2,
      font: fonts.regular,
      color: MUTED,
    });

    page.drawLine({
      start: { x: X(geom.margin), y: Y(14.6) },
      end: { x: X(right), y: Y(14.6) },
      thickness: X(0.4),
      color: LINE,
    });
  } else {
    page.drawText(options.schoolName.toUpperCase(), {
      x: X(geom.margin),
      y: Y(19),
      size: fitText(fonts.bold, options.schoolName.toUpperCase(), X(contentWidth), 13, 8),
      font: fonts.bold,
      color: INK,
    });

    page.drawText('WRITTEN ANSWERS', {
      x: X(geom.margin),
      y: Y(25),
      size: 8.5,
      font: fonts.bold,
      color: ACCENT,
    });

    page.drawText(exam.title, {
      x: X(geom.margin),
      y: Y(30.5),
      size: fitText(fonts.regular, exam.title, X(contentWidth), 11, 7.5),
      font: fonts.regular,
      color: MUTED,
    });

    page.drawText('NAME', {
      x: X(geom.margin),
      y: Y(36.5),
      size: 6.5,
      font: fonts.bold,
      color: MUTED,
    });

    page.drawText(learnerName, {
      x: X(geom.margin),
      y: Y(41.5),
      size: fitText(fonts.bold, learnerName, X(contentWidth * 0.62), 11, 7),
      font: fonts.bold,
      color: INK,
    });

    const lrnLabel = 'LRN';
    page.drawText(lrnLabel, {
      x: X(right) - fonts.bold.widthOfTextAtSize(lrnLabel, 6.5),
      y: Y(36.5),
      size: 6.5,
      font: fonts.bold,
      color: MUTED,
    });
    page.drawText(learner.lrn, {
      x: X(right) - fonts.bold.widthOfTextAtSize(learner.lrn, 9.5),
      y: Y(41.5),
      size: 9.5,
      font: fonts.bold,
      color: INK,
    });

    page.drawText(pageLabel, {
      x: X(right) - fonts.regular.widthOfTextAtSize(pageLabel, 8.5),
      y: Y(19),
      size: 8.5,
      font: fonts.regular,
      color: MUTED,
    });

    page.drawLine({
      start: { x: X(geom.margin), y: Y(46) },
      end: { x: X(right), y: Y(46) },
      thickness: X(0.45),
      color: LINE,
    });

    const instruction = 'Write clearly on the ruled lines. Keep every answer inside its number.';
    page.drawText(instruction, {
      x: X(geom.margin),
      y: Y(51),
      size: fitText(fonts.regular, instruction, X(contentWidth), 7.5, 6),
      font: fonts.regular,
      color: MUTED,
    });
  }

  let top = geom.headerBottom;
  const rulePitch = geom.longPitch ?? WRITTEN_LAYOUT.longPitch;

  pagePlan.parts.forEach((part) => {
    const heading = `PART ${roman(part.sectionIndex)}  ·  ${part.title.toUpperCase()}${part.continued ? '  (CONTINUED)' : ''}`;
    const meta = `${part.itemCount} item${part.itemCount === 1 ? '' : 's'} · ${points(part.pointsPerItem)} pt each`;
    const metaSize = compact ? 5.2 : 7.5;
    const headingY = top + (compact ? 4.2 : 5.3);
    // Measure the meta first so a long part title shrinks instead of running
    // into it; crowded headings were the ugliest part of the half panel.
    const metaWidth = fonts.regular.widthOfTextAtSize(meta, metaSize);
    page.drawText(heading, {
      x: X(geom.margin),
      y: Y(headingY),
      size: fitText(
        fonts.bold,
        heading,
        X(contentWidth) - metaWidth - X(compact ? 4 : 6),
        compact ? 6.2 : 9,
        compact ? 4.8 : 6.5
      ),
      font: fonts.bold,
      color: INK,
    });
    page.drawText(meta, {
      x: X(right) - metaWidth,
      y: Y(headingY),
      size: metaSize,
      font: fonts.regular,
      color: MUTED,
    });

    page.drawLine({
      start: { x: X(geom.margin), y: Y(top + (compact ? 5.8 : 7.8)) },
      end: { x: X(right), y: Y(top + (compact ? 5.8 : 7.8)) },
      thickness: X(0.4),
      color: LINE,
    });

    top += geom.partHeading;

    part.entries.forEach((entry) => {
      const number = `${entry.number}.`;
      page.drawText(number, {
        x: X(geom.margin),
        y: Y(top + (compact ? 4.5 : 6)),
        size: compact ? 6.5 : 9.5,
        font: fonts.regular,
        color: compact ? MUTED : INK,
      });

      const ruleLeft = X(geom.margin + geom.numberColumn);
      const ruleRight = X(right);
      for (let line = 0; line < entry.lines; line += 1) {
        const ruleTop = top + (compact ? 5.5 : 7) + line * rulePitch;
        page.drawLine({
          start: { x: ruleLeft, y: Y(ruleTop) },
          end: { x: ruleRight, y: Y(ruleTop) },
          thickness: X(compact ? 0.45 : 0.55),
          color: LINE,
        });
      }

      top += entry.height;
    });
  });

  const footer = `Tsek · ${exam.code} · ${exam.subject || 'Written answers'}`;
  page.drawText(footer, {
    x: X(geom.margin),
    y: Y(geom.height - (compact ? 9 : 11)),
    size: compact ? 5 : 7,
    font: fonts.regular,
    color: MUTED,
  });
}

export async function downloadWrittenSheetsPdf(
  exam: Exam,
  learners: Learner[],
  options: WrittenPdfOptions,
  filename: string
): Promise<void> {
  const bytes = await buildWrittenSheetsPdf(exam, learners, options);
  downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename);
}
