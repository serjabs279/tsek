import type { AnalysisThresholds, AppSettings, Exam, PaperSize, ScanResult, SectionType } from '../types';
import { SECTION_LABELS } from '../types';
import { scoreResult } from './scoring';
import { manualSlots, scannableItems } from './sections';

export const DEFAULT_ANALYSIS_THRESHOLDS: AnalysisThresholds = {
  easyAbove: 0.75,
  hardBelow: 0.25,
  discriminatingAbove: 0.4,
  notDiscriminatingBelow: 0.0001,
};

export type DifficultyBand = 'Easy' | 'Average' | 'Hard' | '—';
export type DiscriminationBand = 'Discriminating' | 'Average' | 'Not Discriminating' | '—';
export type Recommendation = 'Accept' | 'May Need Revision' | 'Needs Revision' | 'Discard' | '—';
export type DistractorStatus = 'OK' | 'D' | 'R' | 'DR' | '—';

export interface ChoiceStat {
  choice: string;
  isKey: boolean;
  high: number;
  low: number;
  total: number;
  /** Distractor index: (high - low) / group size. Negative is a good distractor. */
  index: number | null;
  status: DistractorStatus;
}

export interface ItemStat {
  item: number;
  /** Last item number in a pooled part; equal to `item` for single items. */
  endItem: number;
  /** True when this row is a whole pooled written part rather than one item. */
  part: boolean;
  sectionId: string;
  sectionTitle: string;
  sectionType: SectionType;
  scannable: boolean;
  points: number;
  key: string;
  /** Count of high-group learners who answered a scannable item correctly. */
  highCorrect: number;
  lowCorrect: number;
  /** Mean points earned by each group. For scannable items this mirrors the counts. */
  highMean: number;
  lowMean: number;
  /** Mean points earned by every analyzed taker. */
  meanEarned: number;
  /** Number of analyzed takers with a recorded score for this item. */
  scoredCount: number;
  /** Lowest, median, and highest points earned. Written rows only; null for scanned items. */
  scoreMin: number | null;
  scoreMedian: number | null;
  scoreMax: number | null;
  difficulty: number | null;
  difficultyBand: DifficultyBand;
  discrimination: number | null;
  discriminationBand: DiscriminationBand;
  recommendation: Recommendation;
  choices: ChoiceStat[];
}

export interface StudentScore {
  lrn: string;
  name: string;
  score: number;
  possible: number;
  percentage: number;
}

/** One column of the class score distribution, in percent of the scope total. */
export interface ScoreBand {
  label: string;
  /** Inclusive lower bound in percent. */
  from: number;
  /** Exclusive upper bound in percent; 100 for the top band. */
  to: number;
  count: number;
}

export interface Reliability {
  /** KR-20 across the scannable (right/wrong) items only. */
  kr20: number | null;
  /** KR-21 across the scannable items only. */
  kr21: number | null;
  /** Cronbach's alpha across every item, written parts included. */
  alpha: number | null;
  /** Mean combined points earned. */
  mean: number;
  variance: number;
  standardDeviation: number;
}

export interface ItemAnalysisReport {
  scope: 'overall' | 'mcq' | 'non-mcq';
  /** Checked sheets used in the analysis (every written score recorded). */
  takers: number;
  /** Checked sheets in total, including those excluded for missing written scores. */
  checkedCount: number;
  itemCount: number;
  /** Rows in the item table. Pooled parts count as one row. */
  unitCount: number;
  pooledPartCount: number;
  scannedItemCount: number;
  writtenItemCount: number;
  points: number;
  scannedPoints: number;
  writtenPoints: number;
  /** Share of the scope's points earned by the class, 0 to 1. Distinct from average item difficulty. */
  pointsEarnedRatio: number | null;
  groupSize: number;
  reliability: Reliability;
  averageDifficulty: number | null;
  averageDiscrimination: number | null;
  items: ItemStat[];
  /** Class score distribution in the same percentage bands as the DepEd grading scale. */
  scoreBands: ScoreBand[];
  difficultyCounts: Record<'Easy' | 'Average' | 'Hard', number>;
  discriminationCounts: Record<'Discriminating' | 'Average' | 'Not Discriminating', number>;
  recommendationCounts: Record<'Accept' | 'May Need Revision' | 'Needs Revision' | 'Discard', number>;
  distractorCounts: { ok: number; defect: number; reject: number; both: number };
  highGroup: StudentScore[];
  lowGroup: StudentScore[];
  warnings: string[];
}

const CHOICE_ORDER = ['A', 'B', 'C', 'D', 'E', 'T', 'F'];

function recommend(
  difficulty: DifficultyBand,
  discrimination: DiscriminationBand,
  allowDiscard = true
): Recommendation {
  if (difficulty === '—' || discrimination === '—') return '—';
  if (difficulty === 'Easy') {
    if (discrimination === 'Not Discriminating') return allowDiscard ? 'Discard' : 'Needs Revision';
    return 'Needs Revision';
  }
  if (difficulty === 'Hard') {
    if (discrimination === 'Not Discriminating') return allowDiscard ? 'Discard' : 'Needs Revision';
    return 'Accept';
  }
  // Average difficulty.
  if (discrimination === 'Not Discriminating') return 'Needs Revision';
  if (discrimination === 'Average') return 'May Need Revision';
  return 'Accept';
}

export function difficultyBand(value: number | null, thresholds: AnalysisThresholds): DifficultyBand {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value > thresholds.easyAbove) return 'Easy';
  if (value < thresholds.hardBelow) return 'Hard';
  return 'Average';
}

export function discriminationBand(value: number | null, thresholds: AnalysisThresholds): DiscriminationBand {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value < thresholds.notDiscriminatingBelow) return 'Not Discriminating';
  if (value > thresholds.discriminatingAbove) return 'Discriminating';
  return 'Average';
}

/**
 * Plain-language reason for an item's recommendation. This inverts the same
 * fixed rule matrix that produced the verdict in `recommend()`, so every
 * explanation is deterministic — no AI involved. In the non-MCQ view the
 * discrimination figure is an item–total correlation, so the wording talks
 * about tracking the written total instead of comparing two groups.
 */
export function explainRecommendation(item: ItemStat, scope: ItemAnalysisReport['scope'] = 'overall'): string {
  const d = item.difficultyBand;
  const s = item.discriminationBand;
  if (item.recommendation === '—' || d === '—' || s === '—') return '';
  const pct = item.difficulty === null || !Number.isFinite(item.difficulty)
    ? null
    : Math.round(item.difficulty * 100);
  const head = pct === null ? '' : `${pct}% ${item.scannable ? 'answered it correctly' : 'of the points were earned'}. `;
  const correlation = scope === 'non-mcq' && !item.scannable;
  const written = item.scannable ? '' : ' As a written item it stays in the test — revise it instead of discarding it.';
  const separates = correlation ? 'the item does not track the overall written score' : 'high and low scorers performed the same';

  if (d === 'Easy' && s === 'Not Discriminating') {
    return correlation
      ? `${head}Most students earn these points and ${separates}, so it cannot tell who understands better.${written}`
      : `${head}Almost everyone gets this right and ${separates}, so it cannot tell who understands better.${written}`;
  }
  if (d === 'Easy') {
    return correlation
      ? `${head}The item is easy — most students earn most of its points — so it does little to separate stronger from weaker answers.`
      : `${head}The item is too easy, so it does little to separate strong from weak students. Consider making it more challenging.`;
  }
  if (d === 'Hard' && s === 'Not Discriminating') {
    return correlation
      ? `${head}Most students earn very few of its points and ${separates}, which usually means the task is confusing, mis-scored, or beyond the lesson.${written}`
      : `${head}Most students miss it and ${separates}, which usually means the item is confusing, miskeyed, or beyond the lesson.${written}`;
  }
  if (d === 'Hard') {
    return correlation
      ? `${head}Most students earn only a few of its points, yet the item still tracks the overall written score well — challenging but valid.`
      : `${head}Only a few students answered correctly, yet the high group clearly outperformed the low group — a challenging item that still separates ability well.`;
  }
  if (s === 'Not Discriminating') {
    return `${head}Difficulty is in the ideal range, but ${
      correlation ? 'it does not track the overall written score' : 'high and low scorers performed almost the same'
    }, so the item does not measure who understands better.${written}`;
  }
  if (s === 'Average') {
    return `${head}Difficulty is ideal and discrimination is fair, but the item only partly ${
      correlation ? 'tracks the overall written score' : 'separates strong from weak students'
    }.${written}`;
  }
  return correlation
    ? `${head}Difficulty and discrimination are both in the ideal range, and students who did well overall also did well here — the item works as intended.`
    : `${head}Difficulty and discrimination are both in the ideal range, and the high group clearly outperformed the low group — the item works as intended.`;
}

export function reliabilityBand(value: number | null): 'good' | 'marginal' | 'poor' | 'none' {
  if (value === null || !Number.isFinite(value)) return 'none';
  if (value >= 0.6) return 'good';
  if (value >= 0.5) return 'marginal';
  return 'poor';
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/**
 * Variances below this are floating-point noise, not real spread. Without the
 * floor, identical totals can leave a residue like 5e-32, which defeats the
 * "no variance" guard and lets reliability numbers be computed from noise.
 */
const VARIANCE_EPSILON = 1e-12;

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const center = mean(values);
  return values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length;
}

/** Pearson correlation coefficient between two equal-length arrays. */
function correlation(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n === 0 || n !== y.length) return null;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX <= VARIANCE_EPSILON || denY <= VARIANCE_EPSILON) return null;
  return num / Math.sqrt(denX * denY);
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const SCORE_BANDS: Array<Omit<ScoreBand, 'count'>> = [
  { label: 'Below 60%', from: 0, to: 60 },
  { label: '60–69%', from: 60, to: 70 },
  { label: '70–79%', from: 70, to: 80 },
  { label: '80–89%', from: 80, to: 90 },
  { label: '90–100%', from: 90, to: 100.0001 },
];

/** Sort percentages into fixed DepEd-style bands. */
function scoreBands(percentages: number[]): ScoreBand[] {
  return SCORE_BANDS.map((band) => ({
    ...band,
    count: percentages.filter((value) => value >= band.from && value < band.to).length,
  }));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}


const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

interface Taker {
  lrn: string;
  name: string;
  answers: (string | null)[];
  /** Share of the item's points earned, 0 to 1. Written items use partial credit. */
  values: number[];
  earned: number;
  possible: number;
  percentage: number;
  correctCount: number;
  complete: boolean;
  needsReview: boolean;
}

/**
 * One row of the item table. Scanned items and item-scored written items stay
 * separate; a pooled written part becomes one row spanning all its items.
 */
interface AnalysisUnit {
  start: number;
  end: number;
  points: number;
  scannable: boolean;
  part: boolean;
  sectionId: string;
  sectionIndex: number;
  sectionTitle: string;
  sectionType: SectionType;
  answerIndex: number | null;
  choices: string[];
  key: string;
  /** manualScores key for a written unit. */
  scoreKey: string | null;
}

function analysisUnits(exam: Exam): AnalysisUnit[] {
  const units: AnalysisUnit[] = scannableItems(exam).map((item) => ({
    start: item.number,
    end: item.number,
    points: item.points,
    scannable: true,
    part: false,
    sectionId: item.sectionId,
    sectionIndex: item.sectionIndex,
    sectionTitle: item.sectionTitle,
    sectionType: item.sectionType,
    answerIndex: item.answerIndex,
    choices: item.choices,
    key: exam.answerKey[item.answerIndex ?? -1] ?? '',
    scoreKey: null,
  }));
  manualSlots(exam).forEach((slot) => {
    units.push({
      start: slot.start,
      end: slot.end,
      points: slot.points,
      scannable: false,
      part: slot.part,
      sectionId: slot.sectionId,
      sectionIndex: slot.sectionIndex,
      sectionTitle: slot.sectionTitle,
      sectionType: slot.sectionType,
      answerIndex: null,
      choices: [],
      key: '',
      scoreKey: slot.key,
    });
  });
  return units.sort((a, b) => a.start - b.start);
}

function analyzeScope(
  exam: Exam,
  results: ScanResult[],
  thresholds: AnalysisThresholds,
  scope: 'overall' | 'mcq' | 'non-mcq',
  include: (unit: AnalysisUnit) => boolean
): ItemAnalysisReport {
  const allUnits = analysisUnits(exam);
  const units = allUnits.filter(include);
  const unitIndex = (unit: AnalysisUnit) => allUnits.indexOf(unit);

  const report: ItemAnalysisReport = {
    scope,
    takers: 0,
    checkedCount: 0,
    itemCount: units.reduce((sum, unit) => sum + (unit.end - unit.start + 1), 0),
    unitCount: units.length,
    pooledPartCount: units.filter((unit) => unit.part).length,
    scannedItemCount: units.filter((unit) => unit.scannable).length,
    writtenItemCount: units.filter((unit) => !unit.scannable).reduce((sum, unit) => sum + (unit.end - unit.start + 1), 0),
    points: round(units.reduce((sum, unit) => sum + unit.points, 0)),
    scannedPoints: round(units.filter((unit) => unit.scannable).reduce((sum, unit) => sum + unit.points, 0)),
    writtenPoints: round(units.filter((unit) => !unit.scannable).reduce((sum, unit) => sum + unit.points, 0)),
    pointsEarnedRatio: null,
    groupSize: 0,
    reliability: { kr20: null, kr21: null, alpha: null, mean: 0, variance: 0, standardDeviation: 0 },
    averageDifficulty: null,
    averageDiscrimination: null,
    items: [],
    scoreBands: scoreBands([]),
    difficultyCounts: { Easy: 0, Average: 0, Hard: 0 },
    discriminationCounts: { Discriminating: 0, Average: 0, 'Not Discriminating': 0 },
    recommendationCounts: { Accept: 0, 'May Need Revision': 0, 'Needs Revision': 0, Discard: 0 },
    distractorCounts: { ok: 0, defect: 0, reject: 0, both: 0 },
    highGroup: [],
    lowGroup: [],
    warnings: [],
  };

  if (results.length === 0) {
    report.warnings.push('No checked sheets yet. Scan answer sheets to run an item analysis.');
    return report;
  }

  report.checkedCount = results.length;

  // Build full takers so the high/low split is always based on overall performance.
  const scored: Taker[] = results.map((result) => {
    const score = scoreResult(exam, result);
    const values = allUnits.map((unit) => {
      if (unit.scannable) {
        const answer = result.answers[unit.answerIndex ?? -1] ?? null;
        return answer && unit.key && answer === unit.key ? 1 : 0;
      }
      const raw = unit.scoreKey ? result.manualScores?.[unit.scoreKey] : undefined;
      if (raw === undefined || !Number.isFinite(raw)) return 0;
      return unit.points > 0 ? clamp(raw, 0, unit.points) / unit.points : 0;
    });
    return {
      lrn: result.lrn,
      name: result.name,
      answers: Array.from({ length: exam.itemCount }, (_, index) => result.answers[index] ?? null),
      values,
      earned: score.earned,
      possible: score.possible,
      percentage: score.percentage,
      correctCount: score.correctCount,
      complete: score.complete,
      needsReview: result.needsReview,
    };
  });

  const takers = scored.filter((entry) => entry.complete);
  report.takers = takers.length;

  const excluded = scored.length - takers.length;
  if (excluded > 0) {
    report.warnings.push(
      `${excluded} checked sheet${excluded === 1 ? ' has' : 's have'} missing written scores and ${
        excluded === 1 ? 'is' : 'are'
      } left out of the analysis. Finish them on the Scores tab.`
    );
  }

  if (takers.length === 0) {
    report.warnings.push('No sheet has every written score yet, so the analysis cannot start. Enter the written scores on the Scores tab.');
    return report;
  }

  const sorted = [...takers].sort((a, b) => b.earned - a.earned || a.name.localeCompare(b.name));
  const rawGroupSize = takers.length > 30 ? Math.round(takers.length * 0.27) : Math.floor(takers.length * 0.5);
  const groupSize = takers.length >= 2 ? Math.max(1, Math.min(rawGroupSize, Math.floor(takers.length / 2))) : 0;
  report.groupSize = groupSize;

  const high = sorted.slice(0, groupSize);
  const low = groupSize > 0 ? sorted.slice(-groupSize) : [];

  // Scope-specific points earned and possible.
  const scopeEarned = (entry: Taker) =>
    units.reduce((sum, unit) => sum + entry.values[unitIndex(unit)] * unit.points, 0);
  const scopePossible = report.points;

  const toStudent = (entry: Taker): StudentScore => ({
    lrn: entry.lrn,
    name: entry.name,
    score: round(scopeEarned(entry), 2),
    possible: scopePossible,
    percentage: scopePossible > 0 ? round((scopeEarned(entry) / scopePossible) * 100, 2) : 0,
  });
  report.highGroup = high.map(toStudent);
  report.lowGroup = low.map(toStudent);

  if (takers.length < 2) {
    report.warnings.push('At least two complete checked sheets are needed to split a high and low group. Reliability and discrimination stay blank until then.');
  } else if (groupSize < 2) {
    report.warnings.push('With this few takers, each group has only one student. Treat the discrimination values as a rough signal, not a verdict.');
  }

  const reviewCount = scored.filter((entry) => entry.needsReview).length;
  if (reviewCount > 0) {
    report.warnings.push(
      `${reviewCount} checked sheet${reviewCount === 1 ? '' : 's'} still need${reviewCount === 1 ? 's' : ''} review. Correcting them will change the analysis.`
    );
  }

  // ---- Reliability --------------------------------------------------------
  const scanned = units.filter((unit) => unit.scannable);
  const kScanned = scanned.length;
  const scannedIndexes = scanned.map(unitIndex);
  const correctTotals = takers.map((entry) =>
    scannedIndexes.reduce((sum, index) => sum + (entry.values[index] === 1 ? 1 : 0), 0)
  );
  const correctMean = mean(correctTotals);
  const correctVariance = variance(correctTotals);
  const pValues = scannedIndexes.map((index) =>
    takers.length ? takers.filter((taker) => taker.values[index] === 1).length / takers.length : 0
  );
  const pqSum = pValues.reduce((sum, p) => sum + p * (1 - p), 0);
  const canKr = kScanned > 1 && correctVariance > VARIANCE_EPSILON && takers.length >= 2;
  const kr20 = canKr ? (kScanned / (kScanned - 1)) * (1 - pqSum / correctVariance) : null;
  const kr21 = canKr
    ? (kScanned / (kScanned - 1)) * (1 - (correctMean * (kScanned - correctMean)) / (kScanned * correctVariance))
    : null;

  const scopeIndexes = units.map(unitIndex);
  const itemVariances = scopeIndexes.map((index) => variance(takers.map((entry) => entry.values[index])));
  const valueTotals = takers.map((entry) => scopeIndexes.reduce((sum, index) => sum + entry.values[index], 0));
  const totalValueVariance = variance(valueTotals);
  const canAlpha = units.length > 1 && totalValueVariance > VARIANCE_EPSILON && takers.length >= 2;
  const alpha = canAlpha
    ? (units.length / (units.length - 1)) * (1 - itemVariances.reduce((sum, value) => sum + value, 0) / totalValueVariance)
    : null;

  const pointsEarned = takers.map(scopeEarned);
  const earnedMean = mean(pointsEarned);
  const earnedVariance = variance(pointsEarned);
  report.pointsEarnedRatio = scopePossible > 0 ? earnedMean / scopePossible : null;
  report.scoreBands = scoreBands(
    scopePossible > 0 ? pointsEarned.map((value) => (value / scopePossible) * 100) : []
  );
  report.reliability = {
    kr20,
    kr21,
    alpha,
    mean: round(earnedMean, 2),
    variance: round(earnedVariance, 3),
    standardDeviation: round(Math.sqrt(earnedVariance), 3),
  };

  if (scope === 'mcq') {
    if (kScanned === 0) {
      report.warnings.push('This view has no MCQ items, so KR-20 and KR-21 cannot be computed.');
    } else if (!canKr && takers.length >= 2) {
      report.warnings.push(
        correctVariance <= VARIANCE_EPSILON
          ? 'Every taker got the same score on the MCQ items, so KR-20 and KR-21 cannot be computed.'
          : 'The MCQ section needs at least two items to compute KR-20 and KR-21.'
      );
    }
  } else if (scope === 'overall') {
    if (kScanned === 0) {
      report.warnings.push('This test has no scannable items, so KR-20 and KR-21 cannot be computed. Cronbach’s alpha is shown for the written parts.');
    } else if (!canKr && takers.length >= 2) {
      report.warnings.push(
        correctVariance <= VARIANCE_EPSILON
          ? 'Every taker got the same score on the scannable items, so KR-20 and KR-21 cannot be computed.'
          : 'The scanned part needs at least two items to compute KR-20 and KR-21.'
      );
    }
  }
  if (!canAlpha && takers.length >= 2) {
    report.warnings.push(
      units.length < 2
        ? 'Cronbach’s alpha needs at least two scored rows in this view, so it stays blank.'
        : totalValueVariance <= VARIANCE_EPSILON
          ? 'Every taker got the same total score in this view, so Cronbach’s alpha cannot be computed.'
          : 'Cronbach’s alpha needs at least two items in this view.'
    );
  }

  // ---- Item-by-item -------------------------------------------------------
  const difficulties: number[] = [];
  const discriminations: number[] = [];

  const blankKeys = scanned.filter((unit) => !unit.key).length;
  if (blankKeys > 0) {
    report.warnings.push(
      `${blankKeys} scannable item${blankKeys === 1 ? ' has' : 's have'} no answer key. They are treated as unanswered and left out of difficulty and discrimination.`
    );
  }

  report.items = units.map((unit) => {
    const index = unitIndex(unit);
    const values = takers.map((entry) => entry.values[index]);
    const meanEarned = mean(values) * unit.points;
    const highMean = groupSize > 0 ? mean(high.map((entry) => entry.values[index])) * unit.points : meanEarned;
    const lowMean = groupSize > 0 ? mean(low.map((entry) => entry.values[index])) * unit.points : meanEarned;

    if (unit.scannable) {
      const answerIndex = unit.answerIndex ?? -1;
      const key = unit.key;
      const highCorrect = high.filter((entry) => key && entry.answers[answerIndex] === key).length;
      const lowCorrect = low.filter((entry) => key && entry.answers[answerIndex] === key).length;
      const correctAll = takers.filter((entry) => key && entry.answers[answerIndex] === key).length;

      // MCQ view uses the standard all-takers difficulty index; overall keeps
      // the extreme-group method for backward-compatible recommendations.
      const difficulty = !key
        ? null
        : scope === 'mcq' || groupSize === 0
          ? correctAll / takers.length
          : (highCorrect + lowCorrect) / (2 * groupSize);
      const discrimination = !key ? null : groupSize > 0 ? (highCorrect - lowCorrect) / groupSize : null;

      const difficultyClass = difficultyBand(difficulty, thresholds);
      const discriminationClass = discriminationBand(discrimination, thresholds);
      if (difficulty !== null) difficulties.push(difficulty);
      if (discrimination !== null) discriminations.push(discrimination);
      if (difficultyClass !== '—') report.difficultyCounts[difficultyClass] += 1;
      if (discriminationClass !== '—') report.discriminationCounts[discriminationClass] += 1;

      const choiceStats: ChoiceStat[] = unit.choices.map((choice) => {
        const highChosen = high.filter((entry) => entry.answers[answerIndex] === choice).length;
        const lowChosen = low.filter((entry) => entry.answers[answerIndex] === choice).length;
        const totalChosen = takers.filter((entry) => entry.answers[answerIndex] === choice).length;
        const isKey = Boolean(key) && choice === key;
        const distractorIndex = !isKey && groupSize > 0 ? (highChosen - lowChosen) / groupSize : null;
        let status: DistractorStatus = '—';
        if (!isKey) {
          if (distractorIndex !== null && distractorIndex > 0) {
            status = 'D';
            report.distractorCounts.defect += 1;
          } else if (totalChosen === 0) {
            status = 'R';
            report.distractorCounts.reject += 1;
          } else {
            status = 'OK';
            report.distractorCounts.ok += 1;
          }
        }
        return {
          choice,
          isKey,
          high: highChosen,
          low: lowChosen,
          total: totalChosen,
          index: distractorIndex,
          status,
        };
      });

      const recommendation = recommend(difficultyClass, discriminationClass);
      if (recommendation !== '—') report.recommendationCounts[recommendation] += 1;

      return {
        item: unit.start,
        endItem: unit.end,
        part: false,
        sectionId: unit.sectionId,
        sectionTitle: unit.sectionTitle,
        sectionType: unit.sectionType,
        scannable: true,
        points: unit.points,
        key,
        highCorrect,
        lowCorrect,
        highMean: round(highMean, 2),
        lowMean: round(lowMean, 2),
        meanEarned: round(meanEarned, 2),
        scoredCount: takers.length,
        scoreMin: null,
        scoreMedian: null,
        scoreMax: null,
        difficulty,
        difficultyBand: difficultyClass,
        discrimination,
        discriminationBand: discriminationClass,
        recommendation,
        choices: choiceStats,
      };
    }

    // Non-MCQ view uses the exact points-earned ratio and the corrected
    // item-total correlation (the item is removed from the total so a single
    // written item cannot correlate perfectly with itself). Overall keeps the
    // high/low contrast for backward compatibility.
    const difficulty =
      scope === 'non-mcq' ? mean(values) : groupSize > 0 ? (highMean + lowMean) / (2 * unit.points) : mean(values);
    const discrimination =
      scope === 'non-mcq'
        ? units.length > 1
          ? correlation(
              values,
              valueTotals.map((total, takerIndex) => total - values[takerIndex])
            )
          : null
        : groupSize > 0
          ? (highMean - lowMean) / unit.points
          : null;
    const scoredCount = values.filter((v) => Number.isFinite(v)).length;
    const earnedList = values.map((value) => round(value * unit.points, 2)).sort((a, b) => a - b);
    const earnedMedian = median(earnedList);

    const difficultyClass = difficultyBand(difficulty, thresholds);
    const discriminationClass = discriminationBand(discrimination, thresholds);
    if (difficulty !== null) difficulties.push(difficulty);
    if (discrimination !== null) discriminations.push(discrimination);
    if (difficultyClass !== '—') report.difficultyCounts[difficultyClass] += 1;
    if (discriminationClass !== '—') report.discriminationCounts[discriminationClass] += 1;

    const recommendation = recommend(difficultyClass, discriminationClass, false);
    if (recommendation !== '—') report.recommendationCounts[recommendation] += 1;

    return {
      item: unit.start,
      endItem: unit.end,
      part: unit.part,
      sectionId: unit.sectionId,
      sectionTitle: unit.sectionTitle,
      sectionType: unit.sectionType,
      scannable: false,
      points: unit.points,
      key: '',
      highCorrect: 0,
      lowCorrect: 0,
      highMean: round(highMean, 2),
      lowMean: round(lowMean, 2),
      meanEarned: round(meanEarned, 2),
      scoredCount,
      scoreMin: earnedList.length ? earnedList[0] : null,
      scoreMedian: earnedMedian === null ? null : round(earnedMedian, 2),
      scoreMax: earnedList.length ? earnedList[earnedList.length - 1] : null,
      difficulty,
      difficultyBand: difficultyClass,
      discrimination,
      discriminationBand: discriminationClass,
      recommendation,
      choices: [],
    };
  });

  report.averageDifficulty = difficulties.length ? mean(difficulties) : null;
  report.averageDiscrimination = discriminations.length ? mean(discriminations) : null;

  return report;
}

export function buildItemAnalysis(
  exam: Exam,
  results: ScanResult[],
  thresholds: AnalysisThresholds = DEFAULT_ANALYSIS_THRESHOLDS
): ItemAnalysisReport {
  return analyzeScope(exam, results, thresholds, 'overall', () => true);
}

export function buildMcqAnalysis(
  exam: Exam,
  results: ScanResult[],
  thresholds: AnalysisThresholds = DEFAULT_ANALYSIS_THRESHOLDS
): ItemAnalysisReport {
  return analyzeScope(exam, results, thresholds, 'mcq', (unit) => unit.scannable);
}

export function buildNonMcqAnalysis(
  exam: Exam,
  results: ScanResult[],
  thresholds: AnalysisThresholds = DEFAULT_ANALYSIS_THRESHOLDS
): ItemAnalysisReport {
  return analyzeScope(exam, results, thresholds, 'non-mcq', (unit) => !unit.scannable);
}

export function formatIndex(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(2);
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function presentChoices(report: ItemAnalysisReport): string[] {
  const seen = new Set(report.items.flatMap((item) => item.choices.map((choice) => choice.choice)));
  return CHOICE_ORDER.filter((choice) => seen.has(choice));
}

export function scopeLabel(scope: ItemAnalysisReport['scope']): string {
  if (scope === 'mcq') return 'Multiple choice (MCQ)';
  if (scope === 'non-mcq') return 'Non-MCQ (written)';
  return 'Overall';
}

function csvNumber(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value) ? '' : value.toFixed(digits);
}

/**
 * One CSV per test with a separate block for every analysis scope. A single
 * shared column set keeps the blocks easy to stack in a spreadsheet; columns
 * that do not apply to a row are simply left empty.
 */
export function buildAnalysisCsv(exam: Exam, reports: ItemAnalysisReport[]): string {
  const lines: string[] = [];
  lines.push(['Test', exam.title].map(csvCell).join(','));
  lines.push(['Subject', exam.subject, 'Grade', exam.gradeLevel, 'Section', exam.section].map(csvCell).join(','));
  lines.push(['Teacher', exam.teacherName, 'Quarter', exam.quarterKey].map(csvCell).join(','));

  reports
    .filter((report) => report.scope === 'overall' || report.itemCount > 0)
    .forEach((report) => {
    const choices = presentChoices(report);
    lines.push('');
    lines.push(csvCell(`${scopeLabel(report.scope)} analysis`));
    lines.push(
      [
        'Scope', scopeLabel(report.scope),
        'Checked sheets', report.checkedCount,
        'Analyzed takers', report.takers,
        'Items', report.itemCount,
        'Scored rows', report.unitCount,
        'Pooled parts', report.pooledPartCount,
        'Points', report.points,
        'Group size', report.groupSize,
      ].map(csvCell).join(',')
    );
    lines.push(
      [
        'KR-20', csvNumber(report.reliability.kr20),
        'KR-21', csvNumber(report.reliability.kr21),
        'Cronbach alpha', csvNumber(report.reliability.alpha),
        'Mean points', report.reliability.mean,
        'Points earned %', report.pointsEarnedRatio === null ? '' : (report.pointsEarnedRatio * 100).toFixed(1),
        'Standard deviation', report.reliability.standardDeviation,
      ].map(csvCell).join(',')
    );
    lines.push(
      [
        'Average item difficulty', csvNumber(report.averageDifficulty),
        'Average discrimination', csvNumber(report.averageDiscrimination),
        'Items accepted', report.recommendationCounts.Accept,
        'Items for revision', report.recommendationCounts['Needs Revision'],
        'Items to discard', report.recommendationCounts.Discard,
      ].map(csvCell).join(',')
    );
    lines.push(
      ['Score distribution', ...report.scoreBands.map((band) => `${band.label}: ${band.count}`)].map(csvCell).join(',')
    );

    lines.push(
      [
        'Item',
        'Part',
        'Type',
        'Points',
        'Key',
        'High correct',
        'Low correct',
        'High mean',
        'Low mean',
        'Mean earned',
        'Min earned',
        'Median earned',
        'Max earned',
        'Scored takers',
        'Difficulty',
        'Difficulty band',
        'Discrimination',
        'Discrimination band',
        'Recommendation',
        ...choices.flatMap((choice) => [`${choice} high`, `${choice} low`, `${choice} total`, `${choice} status`]),
      ].map(csvCell).join(',')
    );

    report.items.forEach((item) => {
      const choiceCells: Array<string | number> = [];
      choices.forEach((choice) => {
        const stat = item.choices.find((entry) => entry.choice === choice);
        if (stat) choiceCells.push(stat.high, stat.low, stat.total, stat.status);
        else choiceCells.push('', '', '', '');
      });
      lines.push(
        [
          item.endItem > item.item ? `${item.item}-${item.endItem}` : item.item,
          `${item.sectionTitle}${item.part ? ' (whole part)' : ''}`,
          SECTION_LABELS[item.sectionType].short,
          item.points,
          item.key,
          item.scannable ? item.highCorrect : '',
          item.scannable ? item.lowCorrect : '',
          item.highMean,
          item.lowMean,
          item.meanEarned,
          item.scoreMin ?? '',
          item.scoreMedian ?? '',
          item.scoreMax ?? '',
          item.scoredCount,
          csvNumber(item.difficulty),
          item.difficultyBand,
          csvNumber(item.discrimination),
          item.discriminationBand,
          item.recommendation,
          ...choiceCells,
        ]
          .map(csvCell)
          .join(',')
      );
    });
  });

  return lines.join('\n');
}

const PRINT_PAGE: Record<PaperSize, string> = {
  A4: 'A4 landscape',
  LEGAL: 'legal landscape',
  LETTER: 'letter landscape',
  FOLIO: '13in 8.5in',
};

function writtenDetail(item: ItemStat): string {
  const range = item.scoreMin === null || item.scoreMax === null ? '—' : `${item.scoreMin}–${item.scoreMax}`;
  return `<span class="written">${item.part ? 'Whole part' : 'Written'} · mean ${item.meanEarned} / ${item.points} pts · median ${
    item.scoreMedian ?? '—'
  } · range ${range} · ${item.scoredCount} scored</span>`;
}

function distractorDetail(item: ItemStat): string {
  return item.choices
    .map(
      (choice) =>
        `<span class="d ${choice.isKey ? 'key' : choice.status === 'D' ? 'bad' : choice.status === 'R' ? 'reject' : ''}">${choice.choice} ${choice.high}/${choice.low}${
          choice.isKey ? '' : ` ${choice.status}`
        }</span>`
    )
    .join(' ');
}

function printItemTable(report: ItemAnalysisReport): string {
  const rows = report.items
    .map((item) => {
      const itemLabel = item.endItem > item.item ? `${item.item}–${item.endItem}` : String(item.item);
      const part = `${escapeHtml(item.sectionTitle)}${item.part ? ' <span class="written">(pooled)</span>' : ''}`;
      const rec = `<td class="rec rec-${item.recommendation.replace(/\s+/g, '-').toLowerCase()}">${item.recommendation}${
        explainRecommendation(item, report.scope) ? `<div class="rec-why">${escapeHtml(explainRecommendation(item, report.scope))}</div>` : ''
      }</td>`;
      const difficulty = `<td class="num">${item.difficulty === null ? '—' : item.difficulty.toFixed(2)}</td><td>${item.difficultyBand}</td>`;
      const discrimination = `<td class="num">${item.discrimination === null ? '—' : item.discrimination.toFixed(2)}</td><td>${item.discriminationBand}</td>`;

      if (!item.scannable && report.scope === 'non-mcq') {
        return `<tr>
          <td class="num">${itemLabel}</td>
          <td class="part">${part}</td>
          <td class="num">${item.points}</td>
          <td class="num">${item.meanEarned}</td>
          <td class="num">${item.scoreMedian ?? '—'}</td>
          <td class="num">${item.scoreMin === null ? '—' : `${item.scoreMin}–${item.scoreMax}`}</td>
          ${difficulty}
          ${discrimination}
          ${rec}
        </tr>`;
      }

      return `<tr>
        <td class="num">${itemLabel}</td>
        <td class="part">${part}</td>
        <td class="num">${escapeHtml(item.key || '—')}</td>
        <td class="num">${item.scannable ? item.highCorrect : item.highMean}</td>
        <td class="num">${item.scannable ? item.lowCorrect : item.lowMean}</td>
        ${difficulty}
        ${discrimination}
        ${rec}
        <td class="dist">${item.scannable ? distractorDetail(item) : writtenDetail(item)}</td>
      </tr>`;
    })
    .join('');

  if (report.scope === 'non-mcq') {
    return `<table class="items">
      <colgroup>
        <col style="width:6%" /><col style="width:20%" /><col style="width:6%" /><col style="width:8%" /><col style="width:8%" />
        <col style="width:9%" /><col style="width:7%" /><col style="width:8%" /><col style="width:8%" /><col style="width:9%" /><col style="width:11%" />
      </colgroup>
      <thead><tr>
        <th>Item</th><th>Part</th><th>Max pts</th><th>Mean</th><th>Median</th><th>Range</th>
        <th>Difficulty</th><th>Difficulty band</th><th>Disc. r</th><th>Discrimination</th><th>Recommendation</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  return `<table class="items">
    <colgroup>
      <col style="width:4%" /><col style="width:9%" /><col style="width:4%" /><col style="width:5%" /><col style="width:5%" />
      <col style="width:5.5%" /><col style="width:8%" /><col style="width:5.5%" /><col style="width:10%" />
      <col style="width:11%" /><col style="width:33%" />
    </colgroup>
    <thead><tr>
      <th>Item</th><th>Part</th><th>Key</th><th>High</th><th>Low</th><th>Diff.</th><th>Difficulty</th>
      <th>Disc.</th><th>Discrimination</th><th>Recommendation</th><th>Distractors / written detail</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function printScopeSection(report: ItemAnalysisReport, thresholds: AnalysisThresholds): string {
  const reliabilityRow = (label: string, value: number | null) => {
    const band = reliabilityBand(value);
    const text = value === null ? '—' : value.toFixed(3);
    const verdict = band === 'good' ? 'Reliable' : band === 'marginal' ? 'Marginal' : band === 'poor' ? 'Not reliable' : '—';
    return `<tr><td>${label}</td><td class="num strong">${text}</td><td>${verdict}</td></tr>`;
  };
  const hasScanned = report.items.some((item) => item.scannable);
  const hasWritten = report.items.some((item) => !item.scannable);
  const earned = report.pointsEarnedRatio === null ? '—' : `${(report.pointsEarnedRatio * 100).toFixed(1)}%`;

  return `<section class="scope">
    <h2>${escapeHtml(scopeLabel(report.scope))}</h2>
    <p class="scope-meta">${report.itemCount} items · ${report.unitCount} scored row${report.unitCount === 1 ? '' : 's'}${
      report.pooledPartCount > 0 ? ` (${report.pooledPartCount} pooled)` : ''
    } · ${report.points} points · ${report.takers} analyzed of ${report.checkedCount} checked · group N = ${report.groupSize}</p>

    <div class="summary">
      <div class="col">
        <table>
          <thead><tr><th>Reliability</th><th>Value</th><th>Verdict</th></tr></thead>
          <tbody>
            ${hasScanned ? reliabilityRow('KR-20 · right/wrong items', report.reliability.kr20) : ''}
            ${hasScanned ? reliabilityRow('KR-21 · right/wrong items', report.reliability.kr21) : ''}
            ${reliabilityRow('Cronbach’s alpha · all rows in this view', report.reliability.alpha)}
            ${hasWritten && !hasScanned ? '<tr><td colspan="3" class="note">KR-20 and KR-21 need right/wrong items only, so they do not apply to written scores. Cronbach’s alpha is the reliability measure here.</td></tr>' : ''}
          </tbody>
        </table>
      </div>
      <div class="col">
        <table>
          <tbody>
            <tr><th>Average item difficulty</th><td class="num strong">${report.averageDifficulty === null ? '—' : report.averageDifficulty.toFixed(2)}</td><td>${report.averageDifficulty === null ? '—' : report.averageDifficulty > thresholds.easyAbove ? 'Easy' : report.averageDifficulty < thresholds.hardBelow ? 'Hard' : 'Average'}</td></tr>
            <tr><th>Average discrimination</th><td class="num strong">${report.averageDiscrimination === null ? '—' : report.averageDiscrimination.toFixed(2)}</td><td>${report.averageDiscrimination === null ? '—' : report.averageDiscrimination < thresholds.notDiscriminatingBelow ? 'Not discriminating' : report.averageDiscrimination > thresholds.discriminatingAbove ? 'Discriminating' : 'Average'}</td></tr>
            <tr><th>Mean score</th><td class="num strong">${report.reliability.mean} / ${report.points}</td><td>SD ${report.reliability.standardDeviation}</td></tr>
            <tr><th>Points earned by the class</th><td class="num strong">${earned}</td><td>of ${report.points} possible</td></tr>
            <tr><th>Rows to accept</th><td class="num strong">${report.recommendationCounts.Accept}</td><td>of ${report.unitCount}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <h3 class="table-title">Item difficulty, discrimination, and recommendations</h3>
    ${printItemTable(report)}
    <div class="legend">
      Difficulty: above ${thresholds.easyAbove.toFixed(2)} = Easy · below ${thresholds.hardBelow.toFixed(2)} = Hard · otherwise Average.
      Discrimination: above ${thresholds.discriminatingAbove.toFixed(2)} = Discriminating · below ${thresholds.notDiscriminatingBelow.toFixed(3)} = Not Discriminating.
      ${
        report.scope === 'non-mcq'
          ? 'Difficulty is the points earned on the item divided by the points possible. Discrimination is the corrected item–total correlation: each item’s share of its points is correlated with the written total after removing that item.'
          : 'Difficulty is the proportion of takers who answered correctly. Discrimination is the high-group proportion minus the low-group proportion.'
      }
      ${
        hasScanned
          ? ` Distractors: OK = chosen more by the low group; D = defect (chosen more by the high group); R = rejected (chosen by nobody). High and Low are group counts${
              hasWritten ? ' for right/wrong items and mean points for written rows' : ''
            }.`
          : ''
      }
    </div>
  </section>`;
}

export function buildAnalysisPrintHtml(
  exam: Exam,
  reports: ItemAnalysisReport[],
  settings: AppSettings,
  thresholds: AnalysisThresholds
): string {
  const overall = reports.find((report) => report.scope === 'overall') ?? reports[0];
  const visible = reports.filter((report) => report.scope === 'overall' || report.itemCount > 0);

  const summaryRows = visible
    .map((report) => {
      const reliability =
        report.scope === 'non-mcq'
          ? `α ${report.reliability.alpha === null ? '—' : report.reliability.alpha.toFixed(3)}`
          : `KR-20 ${report.reliability.kr20 === null ? '—' : report.reliability.kr20.toFixed(3)}`;
      return `<tr>
        <td>${escapeHtml(scopeLabel(report.scope))}</td>
        <td class="num">${report.itemCount}</td>
        <td class="num">${report.points}</td>
        <td class="num">${report.reliability.mean}</td>
        <td class="num">${report.pointsEarnedRatio === null ? '—' : `${(report.pointsEarnedRatio * 100).toFixed(1)}%`}</td>
        <td class="num">${report.averageDifficulty === null ? '—' : report.averageDifficulty.toFixed(2)}</td>
        <td class="num">${report.averageDiscrimination === null ? '—' : report.averageDiscrimination.toFixed(2)}</td>
        <td class="num">${reliability}</td>
      </tr>`;
    })
    .join('');

  const groupTable = (title: string, group: StudentScore[]) => `
    <div class="group">
      <h3>${title} (N = ${group.length})</h3>
      <table class="groups">
        <thead><tr><th>#</th><th>Learner</th><th>Points</th><th>%</th></tr></thead>
        <tbody>${group
          .map(
            (student, index) =>
              `<tr><td class="num">${index + 1}</td><td>${escapeHtml(student.name)}</td><td class="num">${student.score} / ${student.possible}</td><td class="num">${student.percentage}</td></tr>`
          )
          .join('')}</tbody>
      </table>
    </div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(`Item analysis ${exam.title}`)}</title>
<style>
  @page { size: ${PRINT_PAGE[settings.paper] ?? 'letter landscape'}; margin: 0.4in; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Times New Roman', Georgia, serif; color: #111; font-size: 8.6pt; }
  .republic { text-align: center; line-height: 1.25; }
  .republic .dept { font-weight: 700; }
  .school { font-weight: 700; font-size: 11pt; margin-top: 2px; }
  h1 { text-align: center; font-size: 12.5pt; letter-spacing: 0.1em; margin: 8px 0 6px; }
  h2 { font-size: 10pt; margin: 12px 0 4px; letter-spacing: 0.06em; text-transform: uppercase; border-bottom: 1.6px solid #333; padding-bottom: 2px; }
  h3 { font-size: 8.8pt; margin: 0 0 3px; }
  section.scope + section.scope { page-break-before: always; }
  .scope-meta { margin: 0 0 5px; color: #333; }
  .table-title { margin: 8px 0 3px; }
  .note { font-size: 7pt; color: #444; line-height: 1.35; font-style: italic; }
  .meta { width: 100%; border-collapse: collapse; margin-bottom: 5px; }
  .meta td { padding: 1px 4px; }
  .meta .label { width: 78px; font-weight: 700; }
  .meta .value { border-bottom: 1px solid #555; }
  .summary { display: flex; gap: 12px; align-items: flex-start; }
  .summary table { border-collapse: collapse; width: 100%; }
  .summary td, .summary th { border: 1.2px solid #555; padding: 2.5px 4px; }
  .summary th { background: #eee; text-align: left; }
  .col { flex: 1; }
  table.items { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 2px; }
  table.items th, table.items td { border: 1.2px solid #555; padding: 2.4px 3px; font-size: 7.4pt; overflow-wrap: anywhere; word-break: break-word; }
  table.items th { background: #eee; font-size: 6.8pt; text-transform: uppercase; letter-spacing: 0.02em; border-width: 1.5px; }
  table.items tr { page-break-inside: avoid; }
  .num { text-align: center; font-variant-numeric: tabular-nums; }
  .part { font-size: 6.8pt; overflow-wrap: anywhere; }
  .strong { font-weight: 700; }
  .dist { font-size: 6.8pt; line-height: 1.35; }
  .written { font-style: italic; }
  .d { display: inline-block; margin: 0 1px; }
  .d.key { font-weight: 700; text-decoration: underline; }
  .d.bad { color: #8a1f1f; font-weight: 700; }
  .d.reject { color: #6b5a0e; }
  .rec { font-size: 6.9pt; }
  .rec-why { margin-top: 2px; font-size: 6.2pt; font-weight: 400; color: #444; line-height: 1.3; }
  .rec-discard { color: #8a1f1f; font-weight: 700; }
  .rec-needs-revision { color: #8a1f1f; }
  .rec-may-need-revision { color: #735b12; }
  .rec-accept { color: #1d5738; font-weight: 700; }
  .legend { font-size: 7pt; color: #333; margin-top: 4px; line-height: 1.45; }
  .groups { border-collapse: collapse; width: 100%; }
  .groups th, .groups td { border: 1.2px solid #666; padding: 2px 4px; font-size: 7.2pt; }
  .groups th { background: #eee; text-align: left; }
  .group { width: 49%; }
  .group-wrap { display: flex; gap: 8px; justify-content: space-between; }
  .sign { margin-top: 18px; font-size: 8pt; }
</style>
</head>
<body>
  <div class="republic">
    <div>Republic of the Philippines</div>
    <div class="dept">Department of Education</div>
    <div>Region ${escapeHtml(settings.region || '')} · Division of ${escapeHtml(settings.division || '')}</div>
    <div class="school">${escapeHtml(settings.schoolName || '')}</div>
  </div>
  <h1>ITEM ANALYSIS REPORT</h1>
  <table class="meta">
    <tr>
      <td class="label">Test:</td><td class="value">${escapeHtml(exam.title)}</td>
      <td class="label">Subject:</td><td class="value">${escapeHtml(exam.subject)}</td>
    </tr>
    <tr>
      <td class="label">Teacher:</td><td class="value">${escapeHtml(exam.teacherName)}</td>
      <td class="label">Grade / Section:</td><td class="value">${escapeHtml(`${exam.gradeLevel}${exam.section ? ` · ${exam.section}` : ''}`)}</td>
    </tr>
    <tr>
      <td class="label">Quarter:</td><td class="value">${escapeHtml(exam.quarterKey)}</td>
      <td class="label">Coverage:</td><td class="value">${overall.takers} analyzed of ${overall.checkedCount} checked · ${overall.itemCount} items (${overall.scannedItemCount} right/wrong, ${overall.writtenItemCount} written) · ${overall.unitCount} scored rows${overall.pooledPartCount > 0 ? ` (${overall.pooledPartCount} pooled)` : ''} · ${overall.points} points · group N = ${overall.groupSize}</td>
    </tr>
  </table>

  <h2>Summary by view</h2>
  <table class="groups">
    <thead><tr>
      <th>View</th><th>Items</th><th>Points</th><th>Mean score</th><th>Points earned</th>
      <th>Avg. item difficulty</th><th>Avg. discrimination</th><th>Reliability</th>
    </tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>
  <div class="legend">
    Average item difficulty is the mean of the per-item difficulty values. Points earned is the class total divided by the
    points possible, so the two differ when items carry different maximum points. MCQ reliability uses KR-20; the written
    view uses Cronbach’s alpha because written scores are partial credit, not right/wrong.
  </div>

  ${visible.map((report) => printScopeSection(report, thresholds)).join('')}

  <section class="scope">
    <h2>High and low groups · overall</h2>
    <div class="group-wrap">
      ${groupTable('High group', overall.highGroup)}
      ${groupTable('Low group', overall.lowGroup)}
    </div>
  </section>
  <div class="sign">Prepared by: <strong>${escapeHtml(exam.teacherName || '________________')}</strong></div>
</body>
</html>`;
}
