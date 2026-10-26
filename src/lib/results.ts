import type { Exam, Learner, ScanResult } from '../types';
import { scoreResult } from './scoring';
import { scannableItems } from './sections';

export interface ClassSummary {
  rosterCount: number;
  scannedCount: number;
  missingCount: number;
  reviewCount: number;
  incompleteCount: number;
  averagePercentage: number;
  averageGrade: number;
  highest: number;
  lowest: number;
  passingCount: number;
  passingRate: number;
}

export function summarize(exam: Exam, learners: Learner[], results: ScanResult[]): ClassSummary {
  const scored = results.map((result) => ({ result, score: scoreResult(exam, result) }));
  const complete = scored.filter((entry) => entry.score.complete);
  const percentages = complete.map((entry) => entry.score.percentage);
  const averagePercentage = percentages.length
    ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length
    : 0;
  const passingCount = complete.filter((entry) => entry.score.percentage >= exam.passingPercent).length;
  return {
    rosterCount: learners.length,
    scannedCount: results.length,
    missingCount: Math.max(0, learners.length - results.length),
    reviewCount: results.filter((result) => result.needsReview).length,
    incompleteCount: results.length - complete.length,
    averagePercentage: Math.round(averagePercentage * 10) / 10,
    averageGrade: complete.length
      ? Math.round(
          (complete.reduce((sum, entry) => sum + entry.score.grade, 0) / complete.length) * 10
        ) / 10
      : 0,
    highest: percentages.length ? Math.max(...percentages) : 0,
    lowest: percentages.length ? Math.min(...percentages) : 0,
    passingCount,
    passingRate: complete.length ? Math.round((passingCount / complete.length) * 1000) / 10 : 0,
  };
}

export function makeScanResult(
  exam: Exam,
  learner: Learner,
  answers: (string | null)[],
  options: {
    flags?: ScanResult['flags'];
    qrOk?: boolean;
    sourceFile?: string;
    pageNumber?: number;
    confidence?: number;
    rotation?: number;
    markerCount?: number;
    manualScores?: Record<string, number>;
  } = {}
): ScanResult {
  const normalized = Array.from({ length: exam.itemCount }, (_, index) => answers[index] ?? null);
  const flags = options.flags ?? [];
  const markerIssue = options.markerCount !== undefined && options.markerCount < 4;
  const lowConfidence = options.confidence !== undefined && options.confidence < 0.5;
  const base: ScanResult = {
    id: `RES-${exam.id}-${learner.lrn}`,
    examId: exam.id,
    lrn: learner.lrn,
    name: learner.name,
    answers: normalized,
    flags,
    correctCount: 0,
    total: exam.itemCount,
    percentage: 0,
    grade: 60,
    scannedAt: new Date().toISOString(),
    sourceFile: options.sourceFile ?? '',
    pageNumber: options.pageNumber ?? 1,
    qrOk: options.qrOk ?? true,
    needsReview: !options.qrOk || flags.length > 0 || markerIssue || lowConfidence,
    manualOverride: false,
    manualScores: options.manualScores,
  };
  return recalculateResult(exam, base, { keepReview: true });
}

export function recalculateResult(
  exam: Exam,
  result: ScanResult,
  options: { keepReview?: boolean } = {}
): ScanResult {
  const answers = Array.from({ length: exam.itemCount }, (_, index) => result.answers[index] ?? null);
  const score = scoreResult(exam, { ...result, answers });
  return {
    ...result,
    answers,
    correctCount: score.correctCount,
    total: score.possible,
    percentage: score.percentage,
    grade: score.grade,
    needsReview: options.keepReview ? result.needsReview : false,
    manualOverride: options.keepReview ? result.manualOverride : true,
  };
}

export interface ItemAnalysis {
  item: number;
  key: string;
  correct: number;
  blank: number;
  rate: number;
  distribution: Array<{ choice: string; count: number }>;
}

/** Quick class distribution for the scannable items shown on the Results tab. */
export function analyzeItems(exam: Exam, results: ScanResult[]): ItemAnalysis[] {
  return scannableItems(exam).map((item) => {
    const answerIndex = item.answerIndex ?? -1;
    const key = exam.answerKey[answerIndex] ?? '';
    const distribution = item.choices.map((choice) => ({ choice, count: 0 }));
    let correct = 0;
    let blank = 0;
    results.forEach((result) => {
      const answer = result.answers[answerIndex];
      if (!answer) {
        blank += 1;
        return;
      }
      const entry = distribution.find((choice) => choice.choice === answer);
      if (entry) entry.count += 1;
      if (answer === key) correct += 1;
    });
    return {
      item: item.number,
      key,
      correct,
      blank,
      rate: results.length ? Math.round((correct / results.length) * 1000) / 10 : 0,
      distribution,
    };
  });
}

export function rateTone(rate: number): 'good' | 'mid' | 'low' {
  if (rate >= 70) return 'good';
  if (rate >= 40) return 'mid';
  return 'low';
}
