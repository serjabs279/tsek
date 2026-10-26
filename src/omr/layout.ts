import type { Exam, PaperOrientation, PaperSize, SheetsPerPage } from '../types';
import { sheetItemSpecs } from '../lib/sections';

export const MM_TO_PT = 2.834645669;

export const PAPER_SIZES: Record<PaperSize, { width: number; height: number; label: string; short: string }> = {
  FOLIO: { width: 216, height: 330, label: 'Folio · 8.5 × 13 in', short: 'Folio' },
  LEGAL: { width: 215.9, height: 355.6, label: 'Legal · 8.5 × 14 in', short: 'Legal' },
  A4: { width: 210, height: 297, label: 'A4 · 210 × 297 mm', short: 'A4' },
  LETTER: { width: 215.9, height: 279.4, label: 'Letter · 8.5 × 11 in', short: 'Letter' },
};

/** Full printed page, after applying orientation. */
export function pageSize(paper: PaperSize, orientation: PaperOrientation) {
  const base = PAPER_SIZES[paper] ?? PAPER_SIZES.A4;
  return orientation === 'landscape'
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

/**
 * One answer sheet. With two sheets per page the page is split along its long
 * side: a landscape page holds two portrait sheets side by side, while a
 * portrait page stacks two landscape sheets one above the other.
 */
export function sheetSize(paper: PaperSize, orientation: PaperOrientation, sheetsPerPage: SheetsPerPage) {
  const page = pageSize(paper, orientation);
  if (sheetsPerPage !== 2) return { ...page };
  return page.width >= page.height
    ? { width: page.width / 2, height: page.height }
    : { width: page.width, height: page.height / 2 };
}

export interface BubblePosition {
  choice: string;
  x: number;
  y: number;
  r: number;
}

export interface ItemPosition {
  item: number;
  numberX: number;
  numberY: number;
  bubbles: BubblePosition[];
}

export interface SheetLayout {
  paper: PaperSize;
  orientation: PaperOrientation;
  sheetsPerPage: SheetsPerPage;
  /** Full printed page in millimetres. */
  pageWidth: number;
  pageHeight: number;
  /** One answer sheet in millimetres. */
  width: number;
  height: number;
  /** Header/type scale relative to the original A4 design. */
  scale: number;
  contentLeft: number;
  markerSize: number;
  markers: Array<{ x: number; y: number }>;
  qr: { x: number; y: number; size: number };
  header: {
    schoolY: number;
    answerSheetY: number;
    titleY: number;
    nameLabelY: number;
    nameY: number;
    lrnLabelY: number;
    lrnY: number;
    dividerY: number;
    instructionY: number;
  };
  grid: {
    x: number;
    y: number;
    width: number;
    height: number;
    cols: number;
    rows: number;
    cellWidth: number;
    cellHeight: number;
    legendY: number;
    bubbleDiameter: number;
    choiceSpacing: number;
    /** Printed outline weight in millimetres; always heavy enough for laser print. */
    bubbleStroke: number;
    /** Font size of the letter printed inside each bubble, in millimetres. */
    bubbleLetterSize: number;
  };
  items: ItemPosition[];
  footerY: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Deterministic sheet geometry. The generator and the scanner both call this
 * function, so bubble coordinates always agree.
 */
export function buildLayout(
  itemCount: number,
  choiceCount: number,
  paper: PaperSize,
  orientation: PaperOrientation = 'portrait',
  sheetsPerPage: SheetsPerPage = 1,
  /** Optional per-item bubble letters. True/False items print two bubbles. */
  itemChoices?: string[][]
): SheetLayout {
  const page = pageSize(paper, orientation);
  const sheet = sheetSize(paper, orientation, sheetsPerPage);
  const width = sheet.width;
  const height = sheet.height;

  // Everything in the header shrinks with the sheet so two-up folio pages stay
  // readable without losing the grid to a giant title block.
  const scale = clamp(Math.min(width / 210, height / 297), 0.62, 1.08);

  const markerSize = clamp(7 * scale, 4.4, 8);
  const markerInset = clamp(16 * scale, 11, 18);
  const markers = [
    { x: markerInset, y: markerInset },
    { x: width - markerInset, y: markerInset },
    { x: width - markerInset, y: height - markerInset },
    { x: markerInset, y: height - markerInset },
  ];

  // Keep the QR clear of the top-right fiducial so the corner mark stays
  // unobstructed and is never confused with a QR finder square.
  const qrSize = clamp(28 * scale, 18, 30);
  const qr = {
    x: width - markerInset - markerSize / 2 - 4 - qrSize,
    y: markerInset,
    size: qrSize,
  };

  const header = {
    schoolY: 23 * scale,
    answerSheetY: 29.5 * scale,
    titleY: 36 * scale,
    nameLabelY: 45 * scale,
    nameY: 51.5 * scale,
    lrnLabelY: 58 * scale,
    lrnY: 64 * scale,
    dividerY: 70 * scale,
    instructionY: 76 * scale,
  };

  const margin = 18 * scale;
  // Header text starts a clear 4.5 mm to the right of the top-left fiducial so
  // the school name never crowds the black corner mark.
  const contentLeft = Math.max(margin, markerInset + markerSize / 2 + 4.5);

  const gridTop = 83 * scale;
  const gridBottom = height - 19 * scale;
  const gridLeft = margin;
  const gridRight = width - margin;
  const gridWidth = gridRight - gridLeft;
  const gridHeightTotal = gridBottom - gridTop;

  const cols = itemCount <= 26 ? 4 : 5;
  const rows = Math.ceil(itemCount / cols);
  const cellWidth = gridWidth / cols;
  const cellHeight = Math.min(20 * scale, gridHeightTotal / rows);
  const contentHeight = cellHeight * rows;
  const gridY = gridTop + (gridHeightTotal - contentHeight) / 2 + 3 * scale;

  const choiceSets = Array.from({ length: itemCount }, (_, index) => {
    const provided = itemChoices?.[index];
    if (provided && provided.length > 0) return provided;
    return 'ABCDE'.slice(0, choiceCount).split('');
  });
  const widestChoiceSet = choiceSets.reduce((widest, set) => Math.max(widest, set.length), 1);

  const numberWidth = clamp(7.5 * scale, 5.2, 8);
  const legendY = gridY - 4.2 * scale;

  let bubbleDiameter = Math.min(
    5.2 * scale,
    cellHeight * 0.3,
    (cellWidth - numberWidth - 2) / widestChoiceSet - 1.2
  );
  bubbleDiameter = clamp(bubbleDiameter, 2.6, 5.4);
  let choiceSpacing = Math.min(bubbleDiameter + 2.1 * scale, (cellWidth - numberWidth - 1) / widestChoiceSet);
  bubbleDiameter = Math.min(bubbleDiameter, choiceSpacing * 0.7);

  // Printed marks are deliberately heavier than a hairline: at 0.2 mm the
  // circles nearly disappear on a school laser printer. The letter sits well
  // inside the ring, and the scanner samples the ring around it.
  const bubbleStroke = clamp(0.5 * scale, 0.4, 0.55);
  const bubbleLetterSize = clamp(bubbleDiameter * 0.5, 1.1, 2.4);

  const items: ItemPosition[] = [];
  for (let index = 0; index < itemCount; index += 1) {
    const col = Math.floor(index / rows);
    const row = index % rows;
    const cellX = gridLeft + col * cellWidth;
    const cellTop = gridY + row * cellHeight;
    const centerY = cellTop + cellHeight / 2;
    const itemChoiceSet = choiceSets[index];
    const bubblesWidth = choiceSpacing * itemChoiceSet.length;
    const bubblesStart = cellX + numberWidth + Math.max(0, (cellWidth - numberWidth - bubblesWidth) / 2);
    const bubbles: BubblePosition[] = [];
    for (let choice = 0; choice < itemChoiceSet.length; choice += 1) {
      bubbles.push({
        choice: itemChoiceSet[choice],
        x: bubblesStart + choiceSpacing * (choice + 0.5),
        y: centerY,
        r: bubbleDiameter / 2,
      });
    }
    items.push({
      item: index + 1,
      numberX: cellX + 3.2 * scale,
      numberY: centerY,
      bubbles,
    });
  }

  return {
    paper,
    orientation,
    sheetsPerPage,
    pageWidth: page.width,
    pageHeight: page.height,
    width,
    height,
    scale,
    contentLeft,
    markerSize,
    markers,
    qr,
    header,
    grid: {
      x: gridLeft,
      y: gridY,
      width: gridWidth,
      height: contentHeight,
      cols,
      rows,
      cellWidth,
      cellHeight,
      legendY,
      bubbleDiameter,
      choiceSpacing,
      bubbleStroke,
      bubbleLetterSize,
    },
    items,
    footerY: height - 9 * scale,
  };
}

export function markerRect(marker: { x: number; y: number }, size: number) {
  return {
    x: marker.x - size / 2,
    y: marker.y - size / 2,
    width: size,
    height: size,
  };
}

/**
 * The sheet layout for one exam. Scannable items keep their own bubble set, so
 * a True/False part prints two bubbles and a five-choice part prints five.
 */
export function buildExamLayout(exam: Exam): SheetLayout {
  const specs = sheetItemSpecs(exam);
  return buildLayout(
    Math.max(1, specs.length),
    exam.choiceCount,
    exam.paper,
    exam.orientation,
    exam.sheetsPerPage,
    specs.map((spec) => spec.choices)
  );
}

/** Below this, a printed bubble starts to close up on a school laser printer. */
export const COMFORTABLE_BUBBLE_MM = 3.2;

/**
 * How many uniformly shaped items still print comfortably on one sheet.
 * This is a guidance number, not a hard cap: the layout keeps shrinking the
 * bubbles past it, and the scanner will still try.
 */
export function sheetCapacity(
  paper: PaperSize,
  orientation: PaperOrientation,
  sheetsPerPage: SheetsPerPage,
  choiceCount = 4
): number {
  let capacity = 0;
  for (let count = 1; count <= 120; count += 1) {
    const layout = buildLayout(count, choiceCount, paper, orientation, sheetsPerPage);
    if (layout.grid.bubbleDiameter >= COMFORTABLE_BUBBLE_MM) capacity = count;
  }
  return capacity;
}
