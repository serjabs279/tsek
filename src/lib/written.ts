import type { Exam, PaperOrientation, PaperSize } from '../types';
import { PAPER_SIZES } from '../omr/layout';
import { answerSpaceFor, examSections, isScannable, materializeItems, sectionLabel } from './sections';

/**
 * Geometry shared by the planner and the PDF renderer. Everything is in
 * millimetres, measured from the top of the sheet.
 */
export interface WrittenPageGeometry {
  width: number;
  height: number;
  /** Equal margin left and right. */
  margin: number;
  /** First ruled line of the answer area. */
  headerBottom: number;
  bottomMargin: number;
  partHeading: number;
  /** Width reserved for the printed item number before the rule starts. */
  numberColumn: number;
  /**
   * Optional line-pitch overrides. A half-folio panel needs a tighter rhythm
   * than a full portrait page; without an override both use `WRITTEN_LAYOUT`.
   */
  shortPitch?: number;
  longPitch?: number;
}

/**
 * One short-answer line, including the gap before the next item. A long answer
 * is never squeezed below `minLongLines`, and never swallows more than
 * `maxLongLines`, so one essay cannot take the whole page.
 */
export const WRITTEN_LAYOUT = {
  shortPitch: 9,
  longPitch: 8.5,
  minLongLines: 3,
  maxLongLines: 16,
} as const;

/** A full portrait page, used when written answers are printed on their own. */
export function writtenPageGeometry(paper: PaperSize = 'FOLIO'): WrittenPageGeometry {
  const base = PAPER_SIZES[paper] ?? PAPER_SIZES.A4;
  return {
    width: base.width,
    height: base.height,
    margin: 16,
    headerBottom: 56,
    bottomMargin: 16,
    partHeading: 11,
    numberColumn: 9,
  };
}

/**
 * The written half of a two-up page: the space the other learner would
 * normally use. On a landscape page it is the left half, beside the bubble
 * sheet; on a portrait page it is the top half, above it.
 *
 * The header is one line because the bubble half on the same paper already
 * prints the learner's name and LRN; a second identity band only ate room the
 * answers need.
 */
export function writtenPanelGeometry(
  paper: PaperSize = 'FOLIO',
  orientation: PaperOrientation = 'landscape'
): WrittenPageGeometry {
  const base = PAPER_SIZES[paper] ?? PAPER_SIZES.A4;
  const page =
    orientation === 'landscape'
      ? { width: base.height, height: base.width }
      : { width: base.width, height: base.height };
  const half =
    page.width >= page.height
      ? { width: page.width / 2, height: page.height }
      : { width: page.width, height: page.height / 2 };
  return {
    ...half,
    margin: 10,
    headerBottom: 18,
    bottomMargin: 10,
    partHeading: 9,
    numberColumn: 8,
    // Narrow-ruled spacing: still comfortable for handwriting, but the old
    // 9 mm rhythm left too much air above each number on the half panel.
    shortPitch: 7.5,
    longPitch: 7.5,
  };
}

export interface WrittenEntryPlan {
  kind: 'line' | 'block';
  number: number;
  /** 1 for a short answer; otherwise the ruled lines in the block. */
  lines: number;
  /** Vertical space used, including the gap before the next entry. */
  height: number;
}

export interface WrittenPartPlan {
  sectionId: string;
  title: string;
  sectionIndex: number;
  pointsPerItem: number;
  itemCount: number;
  /** True when the part continues from a previous page. */
  continued: boolean;
  entries: WrittenEntryPlan[];
}

export interface WrittenPagePlan {
  /** Which geometry this page was planned for. */
  geometry: WrittenPageGeometry;
  parts: WrittenPartPlan[];
}

export interface WrittenSheetPlan {
  pages: WrittenPagePlan[];
  itemCount: number;
  partCount: number;
  shortCount: number;
  longCount: number;
  /** Fewest lines any long answer received; 0 when there are no long answers. */
  minLongLines: number;
  maxLongLines: number;
}

/**
 * Lay out the written-answer pages for one learner. Short answers get one
 * line each. Long answers share the room left on the page, so one essay gets
 * a full page while six essays get a few lines each and spill to more pages.
 *
 * When `firstPage` is given, the first page uses that geometry — the left
 * half-panel beside a bubble sheet — and any continuation pages use the full
 * portrait page for the chosen paper.
 *
 * Nothing here touches pdf-lib, so the plan is easy to test.
 */
export function planWrittenSheets(
  exam: Exam,
  paper: PaperSize = exam.paper,
  firstPage?: WrittenPageGeometry
): WrittenSheetPlan {
  const fullPage = writtenPageGeometry(paper);
  let geom = firstPage ?? fullPage;
  const bodyBottom = () => geom.height - geom.bottomMargin;
  const bodyTop = () => geom.headerBottom;
  const shortPitch = () => geom.shortPitch ?? WRITTEN_LAYOUT.shortPitch;
  const longPitch = () => geom.longPitch ?? WRITTEN_LAYOUT.longPitch;

  const writtenItems = materializeItems(exam).filter((item) => !item.scannable);
  const groups = examSections(exam)
    .map((section, sectionIndex) => ({ section, sectionIndex }))
    .filter(({ section }) => !isScannable(section.type))
    .map(({ section, sectionIndex }) => ({
      section,
      sectionIndex,
      entries: writtenItems.filter((item) => item.sectionId === section.id),
    }))
    .filter((group) => group.entries.length > 0);

  const longTotal = groups.reduce(
    (sum, group) =>
      sum + (answerSpaceFor(group.section) === 'block' ? group.entries.length : 0),
    0
  );

  const pages: WrittenPagePlan[] = [];
  const started = new Set<string>();
  let page: WrittenPagePlan = { geometry: geom, parts: [] };
  let part: WrittenPartPlan | null = null;
  let y = bodyTop();
  let longDone = 0;
  let shortCount = 0;
  let minLongLines = Number.POSITIVE_INFINITY;
  let maxLongLines = 0;

  const flushPage = () => {
    if (page.parts.length > 0) {
      // A part that spills over several pages reports only the items printed
      // on that page, so the heading meta never overstates the page.
      page.parts.forEach((entry) => {
        entry.itemCount = entry.entries.length;
      });
      pages.push(page);
    }
    geom = pages.length === 0 && firstPage ? firstPage : fullPage;
    page = { geometry: geom, parts: [] };
    part = null;
    y = bodyTop();
  };

  const startPart = (group: (typeof groups)[number]) => {
    if (part) return part;
    // Only print a heading when at least the first answer can follow it;
    // otherwise a part heading could land alone at the bottom of a page.
    const block = answerSpaceFor(group.section) === 'block';
    const firstRoom = block ? WRITTEN_LAYOUT.minLongLines * longPitch() : shortPitch();
    if (y + geom.partHeading + firstRoom > bodyBottom()) {
      flushPage();
    }
    part = {
      sectionId: group.section.id,
      title: sectionLabel(group.section),
      sectionIndex: group.sectionIndex,
      pointsPerItem: group.section.pointsPerItem,
      itemCount: group.entries.length,
      continued: started.has(group.section.id),
      entries: [],
    };
    started.add(group.section.id);
    page.parts.push(part);
    y += geom.partHeading;
    return part;
  };

  groups.forEach((group) => {
    part = null;
    const long = answerSpaceFor(group.section) === 'block';

    group.entries.forEach((item) => {
      startPart(group);

      if (!long) {
        if (y + shortPitch() > bodyBottom()) {
          flushPage();
          startPart(group);
        }
        part!.entries.push({
          kind: 'line',
          number: item.number,
          lines: 1,
          height: shortPitch(),
        });
        y += shortPitch();
        shortCount += 1;
        return;
      }

      longDone += 1;
      const remainingLong = Math.max(1, longTotal - longDone + 1);
      const roomLeft = Math.floor((bodyBottom() - y) / longPitch());
      if (roomLeft < WRITTEN_LAYOUT.minLongLines) {
        flushPage();
        startPart(group);
      }
      // Share the remaining page evenly, but never go below the minimum: when
      // many long answers are left, pack several short blocks per page instead
      // of wasting the page on a single three-line answer.
      const room = Math.floor((bodyBottom() - y) / longPitch());
      const share = Math.floor(room / remainingLong);
      let lines = Math.min(room, Math.max(share, WRITTEN_LAYOUT.minLongLines));
      lines = Math.max(
        WRITTEN_LAYOUT.minLongLines,
        Math.min(WRITTEN_LAYOUT.maxLongLines, lines)
      );
      const height = lines * longPitch();

      part!.entries.push({
        kind: 'block',
        number: item.number,
        lines,
        height,
      });
      y += height;
      minLongLines = Math.min(minLongLines, lines);
      maxLongLines = Math.max(maxLongLines, lines);
    });
  });

  flushPage();

  return {
    pages,
    itemCount: shortCount + longDone,
    partCount: groups.length,
    shortCount,
    longCount: longDone,
    minLongLines: Number.isFinite(minLongLines) ? minLongLines : 0,
    maxLongLines,
  };
}
