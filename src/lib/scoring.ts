import type { Exam, ScanResult } from '../types';
import { manualSlots, materializeItems } from './sections';
import { scoreToGrade } from './grading';

export interface ScoreBreakdown {
  /** Points earned on scannable items. */
  objectiveEarned: number;
  objectivePossible: number;
  /** Points earned on written items. */
  manualEarned: number;
  manualPossible: number;
  earned: number;
  possible: number;
  percentage: number;
  grade: number;
  correctCount: number;
  scannableCount: number;
  manualScored: number;
  manualCount: number;
  /** True when every written item has a recorded score. */
  complete: boolean;
}

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function scoreResult(exam: Exam, result: ScanResult): ScoreBreakdown {
  const items = materializeItems(exam);
  let objectiveEarned = 0;
  let objectivePossible = 0;
  let correctCount = 0;
  let scannableCount = 0;
  let manualEarned = 0;
  let manualPossible = 0;
  let manualScored = 0;
  let manualCount = 0;

  items.forEach((item) => {
    if (!item.scannable) return;
    scannableCount += 1;
    objectivePossible += item.points;
    const answer = result.answers[item.answerIndex ?? -1] ?? null;
    const key = exam.answerKey[item.answerIndex ?? -1] ?? '';
    if (answer && key && answer === key) {
      objectiveEarned += item.points;
      correctCount += 1;
    }
  });

  // A pooled written part is one score box, so it counts once here even
  // though it still carries all of its item points.
  manualSlots(exam).forEach((slot) => {
    manualCount += 1;
    manualPossible += slot.points;
    const raw = result.manualScores?.[slot.key];
    if (raw !== undefined && Number.isFinite(raw)) {
      manualScored += 1;
      manualEarned += Math.max(0, Math.min(slot.points, raw));
    }
  });

  const earned = round(objectiveEarned + manualEarned);
  const possible = round(objectivePossible + manualPossible);
  const percentage = possible > 0 ? round((earned / possible) * 100) : 0;
  return {
    objectiveEarned: round(objectiveEarned),
    objectivePossible: round(objectivePossible),
    manualEarned: round(manualEarned),
    manualPossible: round(manualPossible),
    earned,
    possible,
    percentage,
    grade: scoreToGrade(percentage, exam.depedPolicy),
    correctCount,
    scannableCount,
    manualScored,
    manualCount,
    complete: manualScored === manualCount,
  };
}

export function objectiveScore(exam: Exam, answers: (string | null)[]): { earned: number; possible: number; correct: number } {
  let earned = 0;
  let possible = 0;
  let correct = 0;
  materializeItems(exam)
    .filter((item) => item.scannable)
    .forEach((item) => {
      possible += item.points;
      const answer = answers[item.answerIndex ?? -1] ?? null;
      const key = exam.answerKey[item.answerIndex ?? -1] ?? '';
      if (answer && key && answer === key) {
        earned += item.points;
        correct += 1;
      }
    });
  return { earned: round(earned), possible: round(possible), correct };
}
