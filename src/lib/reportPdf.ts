import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { BLOOM_LEVELS } from '../types';
import type { AnalysisThresholds, AppSettings, BloomLevel, Exam, Learner, PaperSize, ScanResult, TosPlan } from '../types';
import { MM_TO_PT, pageSize } from '../omr/layout';
import type { ItemAnalysisReport } from './analysis';
import { explainRecommendation, reliabilityBand } from './analysis';
import { examFileStem } from './exports';
import { scoreResult } from './scoring';
import { examSections, isPartScored, manualItems, partScoreKey, totalItemCount, type MaterialItem } from './sections';
import { placeItems, rowWeightPercent, tosTotals } from './tos';

/**
 * Shared PDF report engine. Every school report (item analysis, TOS, scores,
 * results) prints through this one writer so they all share the same rules:
 * always landscape, laid out against the paper chosen in Settings, every cell
 * word-wrapped so no column ever overlaps, headers repeated on every page, and
 * a page-number footer.
 */

const MM = 2.834645669;

const INK = rgb(0.13, 0.12, 0.1);
const MUTED = rgb(0.35, 0.33, 0.29);
const LINE = rgb(0.45, 0.42, 0.38);
const HEAD_BG = rgb(0.9, 0.885, 0.86);
const ZEBRA = rgb(0.965, 0.958, 0.945);
const TONE_KEY = rgb(0.43, 0.22, 0.13);
const TONE_DEFECT = rgb(0.55, 0.13, 0.13);
const TONE_REJECT = rgb(0.45, 0.36, 0.05);

interface Col {
  header: string;
  /** Relative width; actual width = share of the usable page width. */
  w: number;
  align?: 'left' | 'center' | 'right';
  size?: number;
}

interface Cell {
  text?: string;
  bold?: boolean;
  color?: ReturnType<typeof rgb>;
  /** Secondary explanation line, rendered smaller and muted under the text. */
  sub?: string;
  /** Rendered as small bordered pill boxes, e.g. one per distractor. */
  pills?: Pill[];
}

interface Pill {
  text: string;
  bold?: boolean;
  /** Pill border and text color. */
  tone?: ReturnType<typeof rgb>;
}

const cell = (text: string, extra: Partial<Cell> = {}): Cell => ({ text, ...extra });

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  // A column narrower than one character cannot wrap; give up gracefully
  // rather than looping forever.
  if (maxWidth < font.widthOfTextAtSize('M', size)) return [clean];
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';
  const push = () => {
    if (current) lines.push(current);
    current = '';
  };
  for (const word of words) {
    let piece = word;
    // A single word longer than the column is broken anywhere rather than
    // overflowing into the next column.
    while (font.widthOfTextAtSize(piece, size) > maxWidth) {
      let cut = Math.min(piece.length - 1, Math.max(1, Math.floor((maxWidth / font.widthOfTextAtSize(piece, size)) * piece.length)));
      while (cut > 1 && font.widthOfTextAtSize(`${piece.slice(0, cut)}-`, size) > maxWidth) cut -= 1;
      if (cut < 1) cut = 1;
      push();
      lines.push(`${piece.slice(0, cut)}-`);
      piece = piece.slice(cut);
      if (!piece) break;
    }
    const candidate = current ? `${current} ${piece}` : piece;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth) {
      push();
      current = piece;
    } else {
      current = candidate;
    }
  }
  push();
  return lines.length ? lines : [''];
}

class ReportWriter {
  readonly pdf: PDFDocument;
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly paper: PaperSize;
  readonly width: number;
  readonly height: number;
  private readonly margin = 10 * MM;
  private page: PDFPage;
  y = 0;
  private pages: PDFPage[] = [];

  private constructor(
    pdf: PDFDocument,
    regular: PDFFont,
    bold: PDFFont,
    paper: PaperSize,
    width: number,
    height: number
  ) {
    this.pdf = pdf;
    this.regular = regular;
    this.bold = bold;
    this.paper = paper;
    this.width = width;
    this.height = height;
    this.page = this.freshPage();
  }

  static async create(title: string, paper: PaperSize): Promise<ReportWriter> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(title);
    pdf.setAuthor('Tsek · open exam checker');
    pdf.setProducer('Tsek');
    // pageSize() speaks millimetres (it is shared with the sheet generator);
    // PDF pages are measured in points.
    const size = pageSize(paper, 'landscape');
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    return new ReportWriter(pdf, regular, bold, paper, size.width * MM_TO_PT, size.height * MM_TO_PT);
  }

  private freshPage(): PDFPage {
    const page = this.pdf.addPage([this.width, this.height]);
    this.pages.push(page);
    this.y = this.height - this.margin;
    return page;
  }

  get usableWidth(): number {
    return this.width - this.margin * 2;
  }

  newPage(): void {
    this.page = this.freshPage();
  }

  ensure(space: number): void {
    if (this.y - space < this.margin + 16) this.newPage();
  }

  text(
    value: string,
    x: number,
    baseline: number,
    options: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}
  ): number {
    const font = options.font ?? this.regular;
    const size = options.size ?? 8;
    this.page.drawText(value, {
      x,
      y: baseline,
      size,
      font,
      color: options.color ?? INK,
    });
    return font.widthOfTextAtSize(value, size);
  }

  /** A lettered section heading with a rule under it. */
  heading(title: string): void {
    this.ensure(26);
    this.y -= 12;
    this.text(title.toUpperCase(), this.margin, this.y, { font: this.bold, size: 9.5 });
    this.y -= 4;
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.width - this.margin, y: this.y },
      thickness: 1.3,
      color: LINE,
    });
    this.y -= 5;
  }

  /** Wrapped paragraph, e.g. legends and notes. */
  paragraph(text: string, size = 7.6, color = MUTED): void {
    const lines = wrapText(this.regular, text, size, this.usableWidth);
    for (const line of lines) {
      this.ensure(size + 3);
      this.y -= size + 2.4;
      this.text(line, this.margin, this.y, { size, color });
    }
  }

  /**
   * The heart of the engine: a full-width table. Every cell is word-wrapped to
   * its column, the row grows to fit the tallest cell, and the header repeats
   * whenever the table continues on a new page. A cell may instead carry
   * pills, which are laid out like words and wrapped onto pill rows.
   */
  table(cols: Col[], rows: Cell[][], options: { bodySize?: number; pad?: number; zebra?: boolean } = {}): void {
    const bodySize = options.bodySize ?? 8.4;
    const pad = options.pad ?? 3.2;
    const pillHeight = bodySize + 6.4;
    const totalWeight = cols.reduce((sum, col) => sum + col.w, 0);
    const widths = cols.map((col) => (this.usableWidth * col.w) / totalWeight);
    const headSize = Math.min(...cols.map((col) => col.size ?? bodySize)) - 0.8;

    // Pills flow like words: fill the row, wrap when the next one spills over.
    const layoutPills = (pills: Pill[], maxWidth: number) => {
      const gap = 3.5;
      const laid: { pill: Pill; x: number; w: number }[][] = [];
      let row: { pill: Pill; x: number; w: number }[] = [];
      let x = 0;
      pills.forEach((pill) => {
        const w = (pill.bold ? this.bold : this.regular).widthOfTextAtSize(pill.text, bodySize - 0.6) + 9;
        if (row.length && x + w > maxWidth) {
          laid.push(row);
          row = [];
          x = 0;
        }
        row.push({ pill, x, w });
        x += w + gap;
      });
      if (row.length) laid.push(row);
      return laid;
    };

    const drawHeader = () => {
      // Header cells wrap too, so long names like "Discrimination" never
      // bleed into the neighbor column.
      const headLines = cols.map((col, index) =>
        wrapText(this.bold, col.header, headSize, widths[index] - pad * 2)
      );
      const rowHeight = Math.max(...headLines.map((lines) => lines.length)) * (headSize + 1.6) + pad * 2.4;
      this.ensure(rowHeight);
      this.page.drawRectangle({
        x: this.margin,
        y: this.y - rowHeight,
        width: this.usableWidth,
        height: rowHeight,
        color: HEAD_BG,
        borderColor: LINE,
        borderWidth: 1.2,
      });
      let x = this.margin;
      headLines.forEach((lines, index) => {
        const col = cols[index];
        const baseY = this.y - pad * 1.2 - headSize;
        lines.forEach((line, lineIndex) => {
          const w = this.bold.widthOfTextAtSize(line, headSize);
          const offset = col.align === 'left' ? 0 : Math.max(0, (widths[index] - w) / 2 - 0.5);
          this.text(line, x + pad + offset, baseY - lineIndex * (headSize + 1.6), {
            font: this.bold,
            size: headSize,
          });
        });
        x += widths[index];
      });
      this.y -= rowHeight;
    };

    drawHeader();

    rows.forEach((row, rowIndex) => {
      type Content = { lines?: string[]; pillRows?: { pill: Pill; x: number; w: number }[][]; height: number };
      const content: Content[] = row.map((value, index) => {
        const inner = widths[index] - pad * 2;
        if (value.pills && value.pills.length > 0) {
          const pillRows = layoutPills(value.pills, inner);
          return { pillRows, height: pillRows.length * (pillHeight + 3) - 3 };
        }
        const font = value.bold ? this.bold : this.regular;
        const lines = wrapText(font, value.text ?? '', bodySize, inner);
        const subLines = value.sub ? wrapText(this.regular, value.sub, bodySize - 1.2, inner) : [];
        return { lines, subLines, height: (lines.length + subLines.length) * (bodySize + 2) - 2 };
      });
      const rowHeight = Math.max(...content.map((piece) => piece.height)) + pad * 2.2;
      if (this.y - rowHeight < this.margin + 18) {
        this.newPage();
        drawHeader();
      }
      if (options.zebra && rowIndex % 2 === 1) {
        this.page.drawRectangle({
          x: this.margin,
          y: this.y - rowHeight,
          width: this.usableWidth,
          height: rowHeight,
          color: ZEBRA,
        });
      }
      // Grid lines: heavy enough to survive the school printer.
      this.page.drawRectangle({
        x: this.margin,
        y: this.y - rowHeight,
        width: this.usableWidth,
        height: rowHeight,
        borderColor: LINE,
        borderWidth: 1.1,
      });
      let x = this.margin;
      content.forEach((piece, index) => {
        const value = row[index];
        const col = cols[index];
        if (piece.pillRows) {
          piece.pillRows.forEach((pillRow, rowIndex2) => {
            const top = this.y - pad * 1.1 - rowIndex2 * (pillHeight + 3);
            pillRow.forEach(({ pill, x: px, w }) => {
              const size = bodySize - 0.6;
              this.page.drawRectangle({
                x: x + pad + px,
                y: top - pillHeight,
                width: w,
                height: pillHeight,
                color: pill.bold ? rgb(0.965, 0.925, 0.885) : ZEBRA,
                borderColor: pill.tone ?? LINE,
                borderWidth: pill.tone ? 1.2 : 0.9,
              });
              const font = pill.bold ? this.bold : this.regular;
              const tw = font.widthOfTextAtSize(pill.text, size);
              this.text(pill.text, x + pad + px + (w - tw) / 2, top - pillHeight / 2 - size / 2 + 1, {
                font,
                size,
                color: pill.tone ?? INK,
              });
            });
          });
        } else {
          const lines = piece.lines ?? [];
          const baseY = this.y - pad * 1.1 - bodySize;
          lines.forEach((line, lineIndex) => {
            const w = (value.bold ? this.bold : this.regular).widthOfTextAtSize(line, bodySize);
            let offset = 0;
            if (col.align === 'center') offset = Math.max(0, (widths[index] - w) / 2 - 0.5);
            else if (col.align === 'right') offset = Math.max(0, widths[index] - w - pad * 2);
            this.text(line, x + pad + offset, baseY - lineIndex * (bodySize + 2), {
              font: value.bold ? this.bold : this.regular,
              size: bodySize,
              color: value.color,
            });
          });
          const subSize = bodySize - 1.2;
          (piece.subLines ?? []).forEach((line, subIndex) => {
            const baseY = this.y - pad * 1.1 - bodySize - (lines.length + subIndex) * (bodySize + 2);
            this.text(line, x + pad, baseY, { size: subSize, color: MUTED });
          });
        }
        x += widths[index];
      });
      this.y -= rowHeight;
    });
  }

  /** A small centered key-value strip under the title. */
  metaLine(pairs: [string, string][], size = 7.6): void {
    const line = pairs.map(([label, value]) => `${label}: ${value}`).join('   ·   ');
    for (const text of wrapText(this.regular, line, size, this.usableWidth)) {
      this.y -= size + 3;
      const w = this.regular.widthOfTextAtSize(text, size);
      this.text(text, (this.width - w) / 2, this.y, { size, color: MUTED });
    }
  }

  /** Republic / DepEd / school banner, shared by every report. */
  banner(settings: AppSettings): void {
    const center = (value: string, size: number, font: PDFFont = this.regular, color = INK) => {
      const w = font.widthOfTextAtSize(value, size);
      this.text(value, (this.width - w) / 2, this.y, { size, font, color });
    };
    this.y -= 9;
    center('Republic of the Philippines', 8.5);
    this.y -= 10.2;
    center('Department of Education', 8.5, this.bold);
    this.y -= 10.2;
    center(`Region ${settings.region || '—'}  ·  Division of ${settings.division || '—'}`, 8, this.regular, MUTED);
    this.y -= 11.2;
    center(settings.schoolName || '—', 10.5, this.bold);
    this.y -= 14;
  }

  title(value: string): void {
    const size = 13.5;
    const w = this.bold.widthOfTextAtSize(value, size);
    this.y -= size + 2.5;
    this.text(value, (this.width - w) / 2, this.y, { size, font: this.bold });
    this.y -= 2;
  }

  signatureBlock(left: string, leftRole: string, rightRole: string): void {
    this.ensure(52);
    this.y -= 34;
    const colWidth = this.usableWidth / 2 - 30;
    const drawSign = (name: string, role: string, x: number) => {
      this.page.drawLine({
        start: { x, y: this.y },
        end: { x: x + colWidth, y: this.y },
        thickness: 1,
        color: INK,
      });
      const nameWidth = this.bold.widthOfTextAtSize(name, 8);
      this.text(name, x + (colWidth - nameWidth) / 2, this.y - 10, { font: this.bold, size: 8 });
      const roleWidth = this.regular.widthOfTextAtSize(role, 7);
      this.text(role, x + (colWidth - roleWidth) / 2, this.y - 18.5, { size: 7, color: MUTED });
    };
    drawSign(left || 'Teacher', leftRole, this.margin + 20);
    drawSign('', rightRole, this.width - this.margin - 20 - colWidth);
  }

  /** Footers on every page, after all content is laid out. */
  finish(context: string): void {
    const stamp = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
    this.pages.forEach((page, index) => {
      const label = `Tsek · ${context} · ${stamp}`;
      const number = `Page ${index + 1} of ${this.pages.length}`;
      page.drawText(label, { x: this.margin, y: this.margin - 14, size: 6.8, font: this.regular, color: MUTED });
      const w = this.regular.widthOfTextAtSize(number, 6.8);
      page.drawText(number, {
        x: this.width - this.margin - w,
        y: this.margin - 14,
        size: 6.8,
        font: this.regular,
        color: MUTED,
      });
    });
  }
}

const fmt = (value: number, digits = 2): string =>
  Number.isFinite(value) ? String(Math.round(value * 10 ** digits) / 10 ** digits) : '—';

/* ------------------------------------------------------------------ */
/* Item analysis                                                       */
/* ------------------------------------------------------------------ */

export async function buildItemAnalysisPdf(
  exam: Exam,
  report: ItemAnalysisReport,
  settings: AppSettings,
  thresholds: AnalysisThresholds
): Promise<Uint8Array> {
  const writer = await ReportWriter.create(`Item analysis — ${exam.title}`, settings.paper);
  writer.banner(settings);
  writer.title('ITEM ANALYSIS REPORT');
  writer.metaLine([
    ['Test', exam.title],
    ['Subject', exam.subject || '—'],
    ['Teacher', exam.teacherName || '—'],
    ['Grade / Section', `${exam.gradeLevel}${exam.section ? ` · ${exam.section}` : ''}`],
    ['Quarter', exam.quarterKey],
  ]);
  writer.metaLine([
    ['Analyzed', `${report.takers} of ${report.checkedCount} checked`],
    ['Items', `${report.itemCount} (${report.scannedItemCount} scanned · ${report.writtenItemCount} written)`],
    ['Points', String(report.points)],
    ['Group N', String(report.groupSize)],
  ]);
  writer.y -= 4;

  const verdict = (value: number | null) => {
    const band = reliabilityBand(value);
    return band === 'good' ? 'Reliable' : band === 'marginal' ? 'Marginal' : band === 'poor' ? 'Not reliable' : '—';
  };

  writer.heading('Test reliability');
  writer.table(
    [
      { header: 'Measure', w: 26, align: 'left' },
      { header: 'Value', w: 12, align: 'center' },
      { header: 'Verdict', w: 14, align: 'center' },
      { header: 'Class summary', w: 48, align: 'left' },
    ],
    [
      [
        cell('KR-20 (scanned items)'),
        cell(report.reliability.kr20 === null ? '—' : report.reliability.kr20.toFixed(3)),
        cell(verdict(report.reliability.kr20)),
        cell(`Average difficulty ${report.averageDifficulty === null ? '—' : fmt(report.averageDifficulty)} · average discrimination ${report.averageDiscrimination === null ? '—' : fmt(report.averageDiscrimination)}`),
      ],
      [
        cell('KR-21 (scanned items)'),
        cell(report.reliability.kr21 === null ? '—' : report.reliability.kr21.toFixed(3)),
        cell(verdict(report.reliability.kr21)),
        cell(`Mean score ${fmt(report.reliability.mean)} of ${report.points} pts · SD ${fmt(report.reliability.standardDeviation)}`),
      ],
      [
        cell("Cronbach's alpha (all items)"),
        cell(report.reliability.alpha === null ? '—' : report.reliability.alpha.toFixed(3)),
        cell(verdict(report.reliability.alpha)),
        cell(
          `Accept: ${report.recommendationCounts.Accept} · May need revision: ${report.recommendationCounts['May Need Revision']} · Needs revision: ${report.recommendationCounts['Needs Revision']} · Discard: ${report.recommendationCounts.Discard}`
        ),
      ],
    ],
    { bodySize: 8.4 }
  );

  writer.heading('Per-item results');
  const itemCols: Col[] = [
    { header: 'Item no.', w: 5, align: 'center' },
    { header: 'Part', w: 9, align: 'left' },
    { header: 'Key', w: 4.5, align: 'center' },
    { header: 'High group', w: 5.5, align: 'center' },
    { header: 'Low group', w: 5.5, align: 'center' },
    { header: 'Difficulty index', w: 6.5, align: 'center' },
    { header: 'Difficulty band', w: 8.5, align: 'center' },
    { header: 'Discrimination index', w: 7, align: 'center' },
    { header: 'Discrimination band', w: 9, align: 'center' },
    { header: 'Recommendation', w: 14, align: 'center' },
    { header: 'Distractors / written detail', w: 25.5, align: 'left' },
  ];
  const itemRows = report.items.map((item) => {
    const itemLabel = item.endItem > item.item ? `${item.item}–${item.endItem}` : String(item.item);
    const detail: Cell = item.scannable
      ? {
          pills: item.choices.map((choice) => ({
            text: `${choice.choice} ${choice.high}/${choice.low}${choice.isKey ? ' · key' : choice.status === 'D' ? ' · defect' : choice.status === 'R' ? ' · rejected' : ''}`,
            bold: choice.isKey,
            tone: choice.isKey ? TONE_KEY : choice.status === 'D' ? TONE_DEFECT : choice.status === 'R' ? TONE_REJECT : undefined,
          })),
        }
      : cell(
          `${item.part ? 'Whole written part' : 'Written item'} — mean ${fmt(item.meanEarned)} of ${fmt(item.points)} pts · ${item.scoredCount} scored`
        );
    return [
      cell(itemLabel),
      cell(`${item.sectionTitle}${item.part ? ' (pooled part)' : ''}`),
      cell(item.key || '—'),
      cell(item.scannable ? String(item.highCorrect) : fmt(item.highMean)),
      cell(item.scannable ? String(item.lowCorrect) : fmt(item.lowMean)),
      cell(item.difficulty === null ? '—' : item.difficulty.toFixed(2)),
      cell(item.difficultyBand),
      cell(item.discrimination === null ? '—' : item.discrimination.toFixed(2)),
      cell(item.discriminationBand),
      cell(item.recommendation, {
        bold: item.recommendation === 'Accept',
        sub: explainRecommendation(item) || undefined,
      }),
      detail,
    ];
  });
  writer.table(itemCols, itemRows, { zebra: true });
  writer.paragraph(
    `Difficulty: above ${thresholds.easyAbove.toFixed(2)} = Easy · below ${thresholds.hardBelow.toFixed(2)} = Hard · otherwise Average. ` +
      `Discrimination: above ${thresholds.discriminatingAbove.toFixed(2)} = Discriminating · below ${thresholds.notDiscriminatingBelow.toFixed(3)} = Not Discriminating. ` +
      `In the distractor pills, the shaded box marks the key; a red border means the distractor is defective (chosen more by the high group) and an olive border means it was rejected (chosen by nobody). ` +
      `High and Low are counts for scanned items and mean points for written items. ` +
      `The small text under each recommendation explains the verdict using the same fixed rules that produced it. ` +
      `KR-20 and KR-21 use scanned items only; Cronbach's alpha covers every scored row.`
  );

  const groupTable = (title: string, group: { name: string; score: number; possible: number; percentage: number }[]) => {
    writer.heading(`${title} (N = ${group.length})`);
    writer.table(
      [
        { header: '#', w: 5, align: 'center' },
        { header: 'Learner', w: 45, align: 'left' },
        { header: 'Points', w: 20, align: 'center' },
        { header: '%', w: 15, align: 'center' },
      ],
      group.map((student, index) => [
        cell(String(index + 1)),
        cell(student.name),
        cell(`${fmt(student.score)} / ${fmt(student.possible, 0)}`),
        cell(`${student.percentage.toFixed(1)}%`),
      ]),
      { bodySize: 8.4 }
    );
  };
  groupTable('High group', report.highGroup);
  groupTable('Low group', report.lowGroup);

  writer.signatureBlock(exam.teacherName || '', 'Prepared by', 'Checked by / School Head');
  writer.finish(`Item analysis · ${exam.title}`);
  return writer.pdf.save();
}

/* ------------------------------------------------------------------ */
/* Table of specifications                                             */
/* ------------------------------------------------------------------ */

export async function buildTosPdf(plan: TosPlan, exam: Exam, settings: AppSettings): Promise<Uint8Array> {
  const writer = await ReportWriter.create(`TOS — ${plan.subject || exam.subject}`, settings.paper);
  writer.banner(settings);
  writer.title('TABLE OF SPECIFICATIONS');
  writer.metaLine([
    ['Subject', plan.subject || exam.subject],
    ['Grade', plan.grade || exam.gradeLevel],
    ['Grading period', plan.gradingPeriod],
  ]);
  writer.metaLine([
    ['Teacher', plan.teacher || exam.teacherName || '—'],
    ['School year', plan.schoolYear || '—'],
    ['Total items', String(totalItemCount(exam))],
  ]);
  writer.y -= 4;

  const placement = placeItems(plan);
  const totals = tosTotals(plan);

  const cols: Col[] = [
    { header: '#', w: 3, align: 'center' },
    { header: 'Topic', w: 12, align: 'left' },
    { header: 'Competencies', w: 17, align: 'left' },
    { header: 'Time', w: 4, align: 'center' },
    { header: 'Weight %', w: 5, align: 'center' },
  ];
  BLOOM_LEVELS.forEach((level: BloomLevel) => {
    cols.push({ header: `${level} · NOI`, w: 6.2, align: 'center', size: 6.6 });
    cols.push({ header: 'POI', w: 4.6, align: 'center', size: 6.6 });
  });
  cols.push({ header: 'Total items', w: 4.5, align: 'center' });
  cols.push({ header: 'Type of test', w: 8, align: 'center' });

  const rows = plan.rows.map((row, index) => {
    const line: Cell[] = [
      cell(String(index + 1)),
      cell(row.topic, { bold: true }),
      cell(row.competencies),
      cell(row.time ? String(row.time) : ''),
      cell(`${rowWeightPercent(plan, row).toFixed(1)}%`),
    ];
    BLOOM_LEVELS.forEach((level) => {
      line.push(cell(String(Math.max(0, Math.round(row.items[level] || 0)))));
      line.push(cell(placement[row.id]?.[level] ?? ''));
    });
    line.push(cell(String(totals.rowItems[index]), { bold: true }));
    line.push(cell(row.type));
    return line;
  });
  const totalRow: Cell[] = [cell(''), cell('TOTAL', { bold: true }), cell(''), cell(String(totals.totalTime)), cell('100.0%', { bold: true })];
  BLOOM_LEVELS.forEach((level) => {
    totalRow.push(cell(String(totals.perLevel[level]), { bold: true }));
    totalRow.push(cell(''));
  });
  totalRow.push(cell(String(totals.allocated), { bold: true }));
  totalRow.push(cell(''));
  writer.table(cols, [...rows, totalRow], { bodySize: 7.4, pad: 2.6, zebra: true });

  writer.paragraph(
    'NOI = number of items · POI = placement of items. Weight comes from the time spent per topic. Placements follow the table order.',
    6.8
  );
  writer.signatureBlock(plan.teacher || exam.teacherName || '', 'Prepared by', 'Checked by / School Head');
  writer.finish(`Table of specifications · ${plan.subject || exam.subject}`);
  return writer.pdf.save();
}

/* ------------------------------------------------------------------ */
/* Score matrix (written entries + totals)                             */
/* ------------------------------------------------------------------ */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

interface ScoreColumn {
  key: string;
  max: number;
  header: string;
  sub: string;
}

export async function buildScoresPdf(
  exam: Exam,
  learners: Learner[],
  results: ScanResult[],
  settings: AppSettings
): Promise<Uint8Array> {
  const writer = await ReportWriter.create(`Scores — ${exam.title}`, settings.paper);

  // Mirror the on-screen matrix: written items, or one total per pooled part.
  const pooled = new Set(examSections(exam).filter(isPartScored).map((section) => section.id));
  const groups: { id: string; title: string; sectionIndex: number; start: number; end: number; points: number; part: boolean; items: MaterialItem[] }[] = [];
  manualItems(exam).forEach((item) => {
    const last = groups[groups.length - 1];
    if (last && last.id === item.sectionId) {
      last.items.push(item);
      last.end = item.number;
      last.points = Math.round((last.points + item.points) * 100) / 100;
      return;
    }
    groups.push({
      id: item.sectionId,
      title: item.sectionTitle,
      sectionIndex: item.sectionIndex,
      start: item.number,
      end: item.number,
      points: item.points,
      part: pooled.has(item.sectionId),
      items: [item],
    });
  });
  const columns: ScoreColumn[] = groups.flatMap((group) =>
    group.part
      ? [
          {
            key: partScoreKey(group.id),
            max: group.points,
            header: `Part ${ROMAN[group.sectionIndex] ?? group.sectionIndex + 1}`,
            sub: `whole · ${group.points} pts`,
          },
        ]
      : group.items.map((item) => ({
          key: item.manualKey as string,
          max: item.points,
          header: String(item.number),
          sub: `${item.points} pt${item.points === 1 ? '' : 's'}`,
        }))
  );

  const byLrn = new Map(results.map((result) => [result.lrn, result]));
  const cols: Col[] = [
    { header: 'Learner', w: 17, align: 'left' },
    { header: 'LRN', w: 9, align: 'left' },
    ...columns.map((column): Col => ({ header: column.header, w: 3.2, align: 'center', size: 6.6 })),
    { header: 'Written', w: 5.5, align: 'center' },
    { header: 'Scanned', w: 5.5, align: 'center' },
    { header: 'Combined', w: 6, align: 'center' },
    { header: '%', w: 4.5, align: 'center' },
    { header: 'Grade', w: 4.5, align: 'center' },
    { header: 'Remarks', w: 7, align: 'center' },
  ];

  const rows = learners.map((learner) => {
    const result = byLrn.get(learner.lrn) ?? null;
    const breakdown = result ? scoreResult(exam, result) : null;
    const line: Cell[] = [cell(learner.name, { bold: true }), cell(learner.lrn || '—')];
    columns.forEach((column) => {
      const value = result?.manualScores?.[column.key];
      line.push(cell(value === undefined ? '' : fmt(value)));
    });
    line.push(cell(breakdown && breakdown.manualPossible > 0 ? `${fmt(breakdown.manualEarned)}/${fmt(breakdown.manualPossible, 0)}` : '—'));
    line.push(cell(breakdown ? `${fmt(breakdown.objectiveEarned)}/${fmt(breakdown.objectivePossible, 0)}` : '—'));
    line.push(cell(breakdown ? `${fmt(breakdown.earned)}/${fmt(breakdown.possible, 0)}` : '—'));
    line.push(cell(breakdown ? `${breakdown.percentage.toFixed(1)}%` : '—'));
    line.push(cell(breakdown ? String(breakdown.grade) : '—', { bold: breakdown !== null }));
    const remarks = !breakdown
      ? 'Not scanned'
      : !breakdown.complete
        ? 'Incomplete'
        : breakdown.percentage >= exam.passingPercent
          ? 'Passed'
          : 'Failed';
    line.push(cell(remarks));
    return line;
  });

  const writtenPoints = Math.round(columns.reduce((sum, column) => sum + column.max, 0) * 100) / 100;
  writer.banner(settings);
  writer.title('CLASS SCORE MATRIX');
  writer.metaLine([
    ['Test', exam.title],
    ['Subject', exam.subject || '—'],
    ['Teacher', exam.teacherName || '—'],
    ['Quarter', exam.quarterKey],
  ]);
  writer.metaLine([
    ['Learners', String(learners.length)],
    ['Checked sheets', String(results.length)],
    ['Written points', String(writtenPoints)],
    ['Passing', `${exam.passingPercent}%`],
  ]);
  writer.y -= 2;
  writer.paragraph(
    'Each written column shows one item (or the whole pooled part) with its points. Written + scanned = combined; the grade uses the transmutation table in Settings.',
    6.8
  );
  writer.y -= 2;
  writer.table(cols, rows, { bodySize: 7.6, pad: 2.6, zebra: true });
  writer.finish(`Score matrix · ${exam.title}`);
  return writer.pdf.save();
}

/* ------------------------------------------------------------------ */
/* Results summary (final grades)                                      */
/* ------------------------------------------------------------------ */

export async function buildResultsPdf(
  exam: Exam,
  learners: Learner[],
  results: ScanResult[],
  settings: AppSettings
): Promise<Uint8Array> {
  const writer = await ReportWriter.create(`Results — ${exam.title}`, settings.paper);
  const byLrn = new Map(results.map((result) => [result.lrn, result]));
  const scored = learners
    .map((learner) => ({ learner, result: byLrn.get(learner.lrn) ?? null }))
    .filter((entry) => entry.result !== null)
    .map((entry) => ({ ...entry, breakdown: scoreResult(exam, entry.result as ScanResult) }));
  const complete = scored.filter((entry) => entry.breakdown.complete);
  const percentages = complete.map((entry) => entry.breakdown.percentage);
  const average = percentages.length ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length : 0;
  const passing = complete.filter((entry) => entry.breakdown.percentage >= exam.passingPercent).length;

  writer.banner(settings);
  writer.title('RESULTS SUMMARY');
  writer.metaLine([
    ['Test', exam.title],
    ['Subject', exam.subject || '—'],
    ['Teacher', exam.teacherName || '—'],
    ['Quarter', exam.quarterKey],
  ]);
  writer.metaLine([
    ['Roster', String(learners.length)],
    ['Checked', String(results.length)],
    ['Average', `${average.toFixed(1)}%`],
    ['Highest', percentages.length ? `${Math.max(...percentages).toFixed(1)}%` : '—'],
    ['Lowest', percentages.length ? `${Math.min(...percentages).toFixed(1)}%` : '—'],
    ['Passing', `${passing}/${complete.length} (${percentages.length ? ((passing / complete.length) * 100).toFixed(1) : '0.0'}%)`],
  ]);
  writer.y -= 2;

  writer.heading('Class record');
  writer.table(
    [
      { header: '#', w: 3.5, align: 'center' },
      { header: 'Learner', w: 22, align: 'left' },
      { header: 'LRN', w: 9, align: 'left' },
      { header: 'Scanned', w: 7, align: 'center' },
      { header: 'Written', w: 7, align: 'center' },
      { header: 'Total', w: 7, align: 'center' },
      { header: '%', w: 5, align: 'center' },
      { header: 'Grade', w: 5, align: 'center' },
      { header: 'Remarks', w: 8, align: 'center' },
      { header: 'Notes', w: 9, align: 'left' },
    ],
    learners.map((learner, index) => {
      const found = scored.find((entry) => entry.learner.id === learner.id);
      const breakdown = found?.breakdown ?? null;
      const notes: string[] = [];
      if (breakdown && !breakdown.complete) notes.push(`${breakdown.manualCount - breakdown.manualScored} blank written`);
      if (found?.result?.needsReview) notes.push('needs review');
      if (!found) notes.push('no scanned sheet');
      return [
        cell(String(index + 1)),
        cell(learner.name, { bold: true }),
        cell(learner.lrn || '—'),
        cell(breakdown && breakdown.objectivePossible > 0 ? `${fmt(breakdown.objectiveEarned)}/${fmt(breakdown.objectivePossible, 0)}` : '—'),
        cell(breakdown && breakdown.manualPossible > 0 ? `${fmt(breakdown.manualEarned)}/${fmt(breakdown.manualPossible, 0)}` : '—'),
        cell(breakdown ? `${fmt(breakdown.earned)}/${fmt(breakdown.possible, 0)}` : '—'),
        cell(breakdown ? `${breakdown.percentage.toFixed(1)}%` : '—'),
        cell(breakdown ? String(breakdown.grade) : '—', { bold: breakdown !== null }),
        cell(
          !breakdown ? '—' : !breakdown.complete ? 'Incomplete' : breakdown.percentage >= exam.passingPercent ? 'Passed' : 'Failed'
        ),
        cell(notes.join(' · ') || '', { color: notes.length ? MUTED : INK }),
      ];
    }),
    { bodySize: 8, zebra: true }
  );
  writer.signatureBlock(exam.teacherName || '', 'Prepared by', 'Checked by / School Head');
  writer.finish(`Results · ${exam.title}`);
  return writer.pdf.save();
}

/** Convenience wrapper used by the report tabs. */
export function reportFilename(kind: string, exam: Exam): string {
  return `${examFileStem(exam)}_${kind}.pdf`.replace(/\s+/g, '_');
}
