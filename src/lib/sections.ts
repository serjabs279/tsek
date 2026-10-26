import type { Exam, ExamSection, SectionType } from '../types';
import { SECTION_LABELS } from '../types';
import { uid } from './id';

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeKey(key: string[] | undefined, length: number): string[] {
  return Array.from({ length }, (_, index) => key?.[index] ?? '');
}

export const SECTION_TYPES: SectionType[] = [
  'MCQ',
  'TRUE_FALSE',
  'MODIFIED_TRUE_FALSE',
  'IDENTIFICATION',
  'ENUMERATION',
  'ESSAY',
];

export const MCQ_CHOICES = ['A', 'B', 'C', 'D', 'E'] as const;
export const TF_CHOICES = ['T', 'F'] as const;

export function isScannable(type: SectionType): boolean {
  return SECTION_LABELS[type].scannable;
}

/** A written part that takes one score for the whole part instead of per item. */
export function isPartScored(section: ExamSection): boolean {
  return !isScannable(section.type) && section.scoreMode === 'part';
}

/** Storage key for a pooled written part. Never collides with an item key. */
export function partScoreKey(sectionId: string): string {
  return `${sectionId}:part`;
}

export function sectionLabel(section: ExamSection): string {
  return section.title?.trim() || SECTION_LABELS[section.type].label;
}

export function sectionChoices(section: ExamSection): string[] {
  if (section.type === 'MCQ') return MCQ_CHOICES.slice(0, section.choices === 5 ? 5 : 4) as unknown as string[];
  if (section.type === 'TRUE_FALSE') return [...TF_CHOICES];
  return [];
}

const DEFAULTS: Record<SectionType, { count: number; points: number; choices?: 4 | 5 }> = {
  MCQ: { count: 10, points: 1, choices: 4 },
  TRUE_FALSE: { count: 10, points: 1 },
  MODIFIED_TRUE_FALSE: { count: 5, points: 2 },
  IDENTIFICATION: { count: 5, points: 1 },
  ENUMERATION: { count: 3, points: 3 },
  ESSAY: { count: 2, points: 10 },
};

export function createSection(type: SectionType): ExamSection {
  const preset = DEFAULTS[type];
  return {
    id: uid('SEC'),
    type,
    itemCount: preset.count,
    pointsPerItem: preset.points,
    choices: preset.choices,
  };
}

/** Workspaces saved before sections existed behave as one multiple-choice part. */
export function examSections(exam: Exam): ExamSection[] {
  if (exam.sections && exam.sections.length > 0) return exam.sections;
  return [
    {
      id: 'legacy-mcq',
      type: 'MCQ',
      itemCount: exam.itemCount,
      pointsPerItem: 1,
      choices: exam.choiceCount === 5 ? 5 : 4,
    },
  ];
}

export interface MaterialItem {
  /** Item number printed on the test paper and the answer sheet. */
  number: number;
  sectionId: string;
  sectionIndex: number;
  sectionType: SectionType;
  sectionTitle: string;
  indexInSection: number;
  scannable: boolean;
  choices: string[];
  points: number;
  /** Position in the scannable answer list, or null for a written item. */
  answerIndex: number | null;
  /** Stable key for direct scores on a written item. */
  manualKey: string | null;
}

export function manualKey(sectionId: string, indexInSection: number): string {
  return `${sectionId}:${indexInSection}`;
}

export function materializeItems(exam: Exam): MaterialItem[] {
  const items: MaterialItem[] = [];
  let number = 1;
  let answerIndex = 0;
  examSections(exam).forEach((section, sectionIndex) => {
    const scannable = isScannable(section.type);
    const choices = sectionChoices(section);
    for (let index = 0; index < Math.max(1, section.itemCount); index += 1) {
      items.push({
        number,
        sectionId: section.id,
        sectionIndex,
        sectionType: section.type,
        sectionTitle: sectionLabel(section),
        indexInSection: index,
        scannable,
        choices,
        points: section.pointsPerItem,
        answerIndex: scannable ? answerIndex : null,
        manualKey: scannable ? null : manualKey(section.id, index),
      });
      number += 1;
      if (scannable) answerIndex += 1;
    }
  });
  return items;
}

export function scannableItems(exam: Exam): MaterialItem[] {
  return materializeItems(exam).filter((item) => item.scannable);
}

export function manualItems(exam: Exam): MaterialItem[] {
  return materializeItems(exam).filter((item) => !item.scannable);
}

/** One box on the Scores tab: either a written item or a pooled written part. */
export interface ScoreSlot {
  key: string;
  sectionId: string;
  sectionIndex: number;
  sectionTitle: string;
  sectionType: SectionType;
  /** First and last printed item number covered by this slot. */
  start: number;
  end: number;
  points: number;
  part: boolean;
}

export function manualSlots(exam: Exam): ScoreSlot[] {
  const sections = new Map(examSections(exam).map((section) => [section.id, section]));
  const slots: ScoreSlot[] = [];
  let pooled: ScoreSlot | null = null;
  manualItems(exam).forEach((item) => {
    const section = sections.get(item.sectionId);
    if (section && isPartScored(section)) {
      if (pooled && pooled.sectionId === item.sectionId) {
        pooled.end = item.number;
        pooled.points = Math.round((pooled.points + item.points) * 100) / 100;
        return;
      }
      pooled = {
        key: partScoreKey(item.sectionId),
        sectionId: item.sectionId,
        sectionIndex: item.sectionIndex,
        sectionTitle: item.sectionTitle,
        sectionType: item.sectionType,
        start: item.number,
        end: item.number,
        points: item.points,
        part: true,
      };
      slots.push(pooled);
      return;
    }
    pooled = null;
    slots.push({
      key: item.manualKey ?? manualKey(item.sectionId, item.indexInSection),
      sectionId: item.sectionId,
      sectionIndex: item.sectionIndex,
      sectionTitle: item.sectionTitle,
      sectionType: item.sectionType,
      start: item.number,
      end: item.number,
      points: item.points,
      part: false,
    });
  });
  return slots;
}

/**
 * When a fully scored part is pooled, carry the item scores over to a part
 * total so switching modes does not throw away hand-entered marks. Switching
 * back leaves the original item boxes untouched.
 */
export function carryManualScores(
  previous: Exam,
  next: Exam,
  scores: Record<string, number> | undefined
): Record<string, number> | undefined {
  if (!scores) return scores;
  const before = new Map(examSections(previous).map((section) => [section.id, section]));
  let changed = false;
  const carried = { ...scores };
  examSections(next).forEach((section) => {
    const old = before.get(section.id);
    if (!old || isScannable(section.type) || !isPartScored(section) || isPartScored(old)) return;
    const keys = Array.from({ length: Math.max(1, section.itemCount) }, (_, index) => manualKey(section.id, index));
    if (!keys.every((key) => typeof carried[key] === 'number')) return;
    const total = keys.reduce(
      (sum, key) => sum + Math.max(0, Math.min(section.pointsPerItem, carried[key])),
      0
    );
    carried[partScoreKey(section.id)] = Math.round(total * 100) / 100;
    changed = true;
  });
  return changed ? carried : scores;
}

export function totalItemCount(exam: Exam): number {
  return materializeItems(exam).length;
}

export function totalPoints(exam: Exam): number {
  return materializeItems(exam).reduce((sum, item) => sum + item.points, 0);
}

export function scannablePoints(exam: Exam): number {
  return scannableItems(exam).reduce((sum, item) => sum + item.points, 0);
}

export function maxChoiceCount(exam: Exam): number {
  return scannableItems(exam).reduce((max, item) => Math.max(max, item.choices.length), 0);
}

export function sheetItemSpecs(exam: Exam): Array<{ number: number; choices: string[] }> {
  return scannableItems(exam).map((item) => ({ number: item.number, choices: item.choices }));
}

export interface SectionRange {
  section: ExamSection;
  start: number;
  end: number;
  count: number;
}

export function sectionRanges(exam: Exam): SectionRange[] {
  const ranges: SectionRange[] = [];
  materializeItems(exam).forEach((item) => {
    const last = ranges[ranges.length - 1];
    if (last && last.section.id === item.sectionId) {
      last.end = item.number;
      last.count += 1;
    } else {
      const section = examSections(exam).find((entry) => entry.id === item.sectionId);
      if (section) ranges.push({ section, start: item.number, end: item.number, count: 1 });
    }
  });
  return ranges;
}

export function cleanSections(sections: ExamSection[]): ExamSection[] {
  const cleaned = sections
    .filter((section) => SECTION_TYPES.includes(section.type))
    .map((section) => ({
      ...section,
      itemCount: clampInt(section.itemCount, 1, 100),
      pointsPerItem: Math.round(Math.max(0.01, Number(section.pointsPerItem) || 1) * 100) / 100,
      choices: section.type === 'MCQ' ? ((section.choices === 5 ? 5 : 4) as 4 | 5) : undefined,
      scoreMode: isScannable(section.type)
        ? undefined
        : section.scoreMode === 'part'
          ? ('part' as const)
          : ('items' as const),
    }));
  if (cleaned.length === 0) return [createSection('MCQ')];
  return cleaned;
}

/** Which parts affect the scanned answer list. Used to decide when scans go stale. */
export function answerShape(sections: ExamSection[]): string {
  return sections
    .filter((section) => isScannable(section.type))
    .map((section) => `${section.id}:${section.type}:${section.itemCount}:${section.choices ?? ''}`)
    .join('|');
}

export function buildExamWithSections(exam: Exam, sections: ExamSection[]): Exam {
  const nextSections = cleanSections(sections);
  const scannable = materializeItems({ ...exam, sections: nextSections }).filter((item) => item.scannable);
  // A key that is not one of the printed bubbles (for example an A after a
  // part turns into True/False) can never match, so it is cleared here.
  const answerKey = normalizeKey(exam.answerKey, scannable.length).map((key, index) =>
    scannable[index]?.choices.includes(key) ? key : ''
  );
  return {
    ...exam,
    sections: nextSections,
    itemCount: scannable.length,
    choiceCount: scannable.some((item) => item.choices.length === 5) ? 5 : 4,
    answerKey,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Carry the key across a structural edit by part and item position, so adding
 * a written part or reordering sections never shifts an answer onto the wrong
 * item. Keys that no longer fit the new bubbles are left blank.
 */
export function remapAnswerKeys(previous: Exam, next: Exam): Exam {
  const before = new Map(
    scannableItems(previous).map((item) => [
      `${item.sectionId}:${item.indexInSection}`,
      previous.answerKey[item.answerIndex ?? -1] ?? '',
    ])
  );
  const answerKey = scannableItems(next).map((item) => {
    const key = before.get(`${item.sectionId}:${item.indexInSection}`) ?? '';
    return item.choices.includes(key) ? key : '';
  });
  return { ...next, answerKey };
}
