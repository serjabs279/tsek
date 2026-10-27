import type { AnalysisThresholds, AppSettings, Exam, ScanResult, SectionType } from '../types';
import { SECTION_LABELS } from '../types';
import { scoreResult } from './scoring';
import { manualSlots, materializeItems, scannableItems } from './sections';

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
  groupSize: number;
  reliability: Reliability;
  averageDifficulty: number | null;
  averageDiscrimination: number | null;
  items: ItemStat[];
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
 * explanation is deterministic — no AI involved.
 */
export function explainRecommendation(item: ItemStat): string {
  const d = item.difficultyBand;
  const s = item.discriminationBand;
  if (item.recommendation === '—' || d === '—' || s === '—') return '';
  const pct = item.difficulty === null || !Number.isFinite(item.difficulty)
    ? null
    : Math.round(item.difficulty * 100);
  const head = pct === null ? '' : `${pct}% ${item.scannable ? 'answered it correctly' : 'of the points were earned'}. `;
  const written = item.scannable ? '' : ' As a written item it stays in the test — revise it instead of discarding it.';

  if (d === 'Easy' && s === 'Not Discriminating') {
    return `${head}Almost everyone gets this right and high and low scorers performed the same, so it cannot tell who understands better.${written}`;
  }
  if (d === 'Easy') {
    return `${head}The item is too easy, so it does little to separate strong from weak students. Consider making it more challenging.`;
  }
  if (d === 'Hard' && s === 'Not Discriminating') {
    return `${head}Most students miss it and the high group does no better than the low group, which usually means the item is confusing, miskeyed, or beyond the lesson.${written}`;
  }
  if (d === 'Hard') {
    return `${head}Only a few students answered correctly, yet the high group clearly outperformed the low group — a challenging item that still separates ability well.`;
  }
  if (s === 'Not Discriminating') {
    return `${head}Difficulty is in the ideal range, but high and low scorers performed almost the same, so the item does not measure who understands better.${written}`;
  }
  if (s === 'Average') {
    return `${head}Difficulty is ideal and discrimination is fair, but the item only partly separates strong from weak students.${written}`;
  }
  return `${head}Difficulty and discrimination are both in the ideal range, and the high group clearly outperformed the low group — the item works as intended.`;
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

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const center = mean(values);
  return values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

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

function emptyReport(exam: Exam): ItemAnalysisReport {
  const items = materializeItems(exam);
  const units = analysisUnits(exam);
  const scanned = units.filter((unit) => unit.scannable);
  return {
    takers: 0,
    checkedCount: 0,
    itemCount: items.length,
    unitCount: units.length,
    pooledPartCount: units.filter((unit) => unit.part).length,
    scannedItemCount: scanned.length,
    writtenItemCount: items.length - scanned.length,
    points: round(units.reduce((sum, unit) => sum + unit.points, 0)),
    scannedPoints: round(scanned.reduce((sum, unit) => sum + unit.points, 0)),
    writtenPoints: round(units.filter((unit) => !unit.scannable).reduce((sum, unit) => sum + unit.points, 0)),
    groupSize: 0,
    reliability: {
      kr20: null,
      kr21: null,
      alpha: null,
      mean: 0,
      variance: 0,
      standardDeviation: 0,
    },
    averageDifficulty: null,
    averageDiscrimination: null,
    items: [],
    difficultyCounts: { Easy: 0, Average: 0, Hard: 0 },
    discriminationCounts: { Discriminating: 0, Average: 0, 'Not Discriminating': 0 },
    recommendationCounts: { Accept: 0, 'May Need Revision': 0, 'Needs Revision': 0, Discard: 0 },
    distractorCounts: { ok: 0, defect: 0, reject: 0, both: 0 },
    highGroup: [],
    lowGroup: [],
    warnings: [],
  };
}

export function buildItemAnalysis(
  exam: Exam,
  results: ScanResult[],
  thresholds: AnalysisThresholds = DEFAULT_ANALYSIS_THRESHOLDS
): ItemAnalysisReport {
  const report = emptyReport(exam);
  const units = analysisUnits(exam);

  if (results.length === 0) {
    report.warnings.push('No checked sheets yet. Scan answer sheets to run an item analysis.');
    return report;
  }

  report.checkedCount = results.length;

  const scored: Taker[] = results.map((result) => {
    const score = scoreResult(exam, result);
    const values = units.map((unit) => {
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

  const toStudent = (entry: Taker): StudentScore => ({
    lrn: entry.lrn,
    name: entry.name,
    score: entry.earned,
    possible: entry.possible,
    percentage: entry.percentage,
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
  // KR-20/KR-21 cover the scannable items only, because they assume
  // right/wrong scoring. Cronbach's alpha covers every item, with written
  // items scaled to the share of their points earned.
  const scanned = units.map((unit, index) => ({ unit, index })).filter((entry) => entry.unit.scannable);
  const kScanned = scanned.length;
  const correctTotals = takers.map((entry) => entry.correctCount);
  const correctMean = mean(correctTotals);
  const correctVariance = variance(correctTotals);
  const pValues = scanned.map((entry) =>
    takers.length ? takers.filter((taker) => taker.values[entry.index] === 1).length / takers.length : 0
  );
  const pqSum = pValues.reduce((sum, p) => sum + p * (1 - p), 0);
  const canKr = kScanned > 1 && correctVariance > 0 && takers.length >= 2;
  const kr20 = canKr ? (kScanned / (kScanned - 1)) * (1 - pqSum / correctVariance) : null;
  const kr21 = canKr
    ? (kScanned / (kScanned - 1)) * (1 - (correctMean * (kScanned - correctMean)) / (kScanned * correctVariance))
    : null;

  const itemVariances = units.map((_, index) => variance(takers.map((entry) => entry.values[index])));
  const valueTotals = takers.map((entry) => entry.values.reduce((sum, value) => sum + value, 0));
  const totalValueVariance = variance(valueTotals);
  const canAlpha = units.length > 1 && totalValueVariance > 0 && takers.length >= 2;
  const alpha = canAlpha
    ? (units.length / (units.length - 1)) * (1 - itemVariances.reduce((sum, value) => sum + value, 0) / totalValueVariance)
    : null;

  const pointsEarned = takers.map((entry) => entry.earned);
  const earnedMean = mean(pointsEarned);
  const earnedVariance = variance(pointsEarned);
  report.reliability = {
    kr20,
    kr21,
    alpha,
    mean: round(earnedMean, 2),
    variance: round(earnedVariance, 3),
    standardDeviation: round(Math.sqrt(earnedVariance), 3),
  };

  if (kScanned === 0) {
    report.warnings.push('This test has no scannable items, so KR-20 and KR-21 cannot be computed. Cronbach’s alpha is shown for the written parts.');
  } else if (!canKr && takers.length >= 2) {
    report.warnings.push(
      correctVariance === 0
        ? 'Every taker got the same score on the scannable items, so KR-20 and KR-21 cannot be computed.'
        : 'The scanned part needs at least two items to compute KR-20 and KR-21.'
    );
  }
  if (!canAlpha && takers.length >= 2 && units.length > 1) {
    report.warnings.push(
      totalValueVariance === 0
        ? 'Every taker got the same total score, so Cronbach’s alpha cannot be computed.'
        : 'Cronbach’s alpha needs at least two items.'
    );
  }

  // ---- Item-by-item -------------------------------------------------------
  const difficulties: number[] = [];
  const discriminations: number[] = [];

  const blankKeys = scanned.filter((entry) => !entry.unit.key).length;
  if (blankKeys > 0) {
    report.warnings.push(
      `${blankKeys} scannable item${blankKeys === 1 ? ' has' : 's have'} no answer key. They are treated as unanswered and left out of difficulty and discrimination.`
    );
  }

  report.items = units.map((unit, index) => {
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

      const difficulty = !key
        ? null
        : groupSize > 0
          ? (highCorrect + lowCorrect) / (2 * groupSize)
          : correctAll / takers.length;
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
        difficulty,
        difficultyBand: difficultyClass,
        discrimination,
        discriminationBand: discriminationClass,
        recommendation,
        choices: choiceStats,
      };
    }

    // Written unit: difficulty is the share of its points the class earned,
    // and discrimination compares the two groups on the same scale. A pooled
    // part is one row scored out of the whole part's points.
    const difficulty = groupSize > 0 ? (highMean + lowMean) / (2 * unit.points) : mean(values);
    const discrimination = groupSize > 0 ? (highMean - lowMean) / unit.points : null;
    // Every taker here is complete, so each written item has a recorded score.
    const scoredCount = takers.length;

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

export function buildAnalysisCsv(exam: Exam, report: ItemAnalysisReport): string {
  const lines: string[] = [];
  lines.push(['Test', exam.title].map(csvCell).join(','));
  lines.push(['Subject', exam.subject, 'Grade', exam.gradeLevel, 'Section', exam.section].map(csvCell).join(','));
  lines.push(['Teacher', exam.teacherName, 'Quarter', exam.quarterKey].map(csvCell).join(','));
  lines.push(
    [
      'Checked sheets', report.checkedCount,
      'Analyzed takers', report.takers,
      'Items', report.itemCount,
      'Scanned items', report.scannedItemCount,
      'Written items', report.writtenItemCount,
      'Scored rows', report.unitCount,
      'Pooled parts', report.pooledPartCount,
      'Total points', report.points,
      'Group size', report.groupSize,
    ].map(csvCell).join(',')
  );
  lines.push(
    [
      'KR-20 (scanned)', report.reliability.kr20?.toFixed(3) ?? '',
      'KR-21 (scanned)', report.reliability.kr21?.toFixed(3) ?? '',
      'Cronbach alpha (all scored rows)', report.reliability.alpha?.toFixed(3) ?? '',
    ].map(csvCell).join(',')
  );
  lines.push(
    [
      'Average difficulty', report.averageDifficulty?.toFixed(3) ?? '',
      'Average discrimination', report.averageDiscrimination?.toFixed(3) ?? '',
      'Mean points', report.reliability.mean,
      'Standard deviation', report.reliability.standardDeviation,
    ].map(csvCell).join(',')
  );
  lines.push('');

  const choices = presentChoices(report);
  const header = [
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
    'Difficulty',
    'Difficulty band',
    'Discrimination',
    'Discrimination band',
    'Recommendation',
    ...choices.flatMap((choice) => [`${choice} high`, `${choice} low`, `${choice} total`, `${choice} status`]),
  ];
  lines.push(header.map(csvCell).join(','));
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
        item.difficulty === null ? '' : item.difficulty.toFixed(3),
        item.difficultyBand,
        item.discrimination === null ? '' : item.discrimination.toFixed(3),
        item.discriminationBand,
        item.recommendation,
        ...choiceCells,
      ]
        .map(csvCell)
        .join(',')
    );
  });
  return lines.join('\n');
}

export function buildAnalysisPrintHtml(
  exam: Exam,
  report: ItemAnalysisReport,
  settings: AppSettings,
  thresholds: AnalysisThresholds
): string {
  const rows = report.items
    .map((item) => {
      const detail = item.scannable
        ? item.choices
            .map(
              (choice) =>
                `<span class="d ${choice.isKey ? 'key' : choice.status === 'D' ? 'bad' : choice.status === 'R' ? 'reject' : ''}">${choice.choice} ${choice.high}/${choice.low}${
                  choice.isKey ? '' : ` ${choice.status}`
                }</span>`
            )
            .join(' ')
        : `<span class="written">${item.part ? 'Whole part · ' : 'Written · '}mean ${item.meanEarned} / ${item.points} pts · ${item.scoredCount} scored</span>`;
      const itemLabel = item.endItem > item.item ? `${item.item}–${item.endItem}` : String(item.item);
      return `<tr>
        <td class="num">${itemLabel}</td>
        <td class="part">${escapeHtml(item.sectionTitle)}${item.part ? ' <span class="written">(pooled)</span>' : ''}</td>
        <td class="num">${escapeHtml(item.key || '—')}</td>
        <td class="num">${item.scannable ? item.highCorrect : item.highMean}</td>
        <td class="num">${item.scannable ? item.lowCorrect : item.lowMean}</td>
        <td class="num">${item.difficulty === null ? '—' : item.difficulty.toFixed(2)}</td>
        <td>${item.difficultyBand}</td>
        <td class="num">${item.discrimination === null ? '—' : item.discrimination.toFixed(2)}</td>
        <td>${item.discriminationBand}</td>
        <td class="rec rec-${item.recommendation.replace(/\s+/g, '-').toLowerCase()}">${item.recommendation}${
          explainRecommendation(item) ? `<div class="rec-why">${escapeHtml(explainRecommendation(item))}</div>` : ''
        }</td>
        <td class="dist">${detail}</td>
      </tr>`;
    })
    .join('');

  const reliabilityRow = (label: string, value: number | null) => {
    const band = reliabilityBand(value);
    const text = value === null ? '—' : value.toFixed(3);
    const verdict = band === 'good' ? 'Reliable' : band === 'marginal' ? 'Marginal' : band === 'poor' ? 'Not reliable' : '—';
    return `<tr><td>${label}</td><td class="num strong">${text}</td><td>${verdict}</td></tr>`;
  };

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
  @page { size: letter landscape; margin: 0.4in; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Times New Roman', Georgia, serif; color: #111; font-size: 8.6pt; }
  .republic { text-align: center; line-height: 1.25; }
  .republic .dept { font-weight: 700; }
  .school { font-weight: 700; font-size: 11pt; margin-top: 2px; }
  h1 { text-align: center; font-size: 12.5pt; letter-spacing: 0.1em; margin: 8px 0 6px; }
  h2 { font-size: 10pt; margin: 12px 0 4px; letter-spacing: 0.06em; text-transform: uppercase; border-bottom: 1.6px solid #333; padding-bottom: 2px; }
  h3 { font-size: 8.8pt; margin: 0 0 3px; }
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
      <td class="label">Coverage:</td><td class="value">${report.takers} analyzed of ${report.checkedCount} checked · ${report.itemCount} items (${report.scannedItemCount} scanned, ${report.writtenItemCount} written) · ${report.unitCount} scored rows${report.pooledPartCount > 0 ? ` (${report.pooledPartCount} pooled)` : ''} · ${report.points} points · group N = ${report.groupSize}</td>
    </tr>
  </table>

  <h2>Test reliability and difficulty</h2>
  <div class="summary">
    <div class="col">
      <table>
        <thead><tr><th>Reliability</th><th>Value</th><th>Verdict</th></tr></thead>
        <tbody>
          ${reliabilityRow('KR-20 · scanned', report.reliability.kr20)}
          ${reliabilityRow('KR-21 · scanned', report.reliability.kr21)}
          ${reliabilityRow('Cronbach alpha · all', report.reliability.alpha)}
        </tbody>
      </table>
    </div>
    <div class="col">
      <table>
        <tbody>
          <tr><th>Average difficulty</th><td class="num strong">${report.averageDifficulty === null ? '—' : report.averageDifficulty.toFixed(2)}</td><td>${report.averageDifficulty === null ? '—' : report.averageDifficulty > thresholds.easyAbove ? 'Easy' : report.averageDifficulty < thresholds.hardBelow ? 'Hard' : 'Average'}</td></tr>
          <tr><th>Average discrimination</th><td class="num strong">${report.averageDiscrimination === null ? '—' : report.averageDiscrimination.toFixed(2)}</td><td>${report.averageDiscrimination === null ? '—' : report.averageDiscrimination < thresholds.notDiscriminatingBelow ? 'Not discriminating' : report.averageDiscrimination > thresholds.discriminatingAbove ? 'Discriminating' : 'Average'}</td></tr>
          <tr><th>Mean points</th><td class="num strong">${report.reliability.mean} / ${report.points}</td><td>SD ${report.reliability.standardDeviation}</td></tr>
          <tr><th>Rows to accept</th><td class="num strong">${report.recommendationCounts.Accept}</td><td>of ${report.unitCount}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <h2>Item difficulty, discrimination, and recommendations</h2>
  <table class="items">
    <colgroup>
      <col style="width:4%" /><col style="width:9%" /><col style="width:4%" /><col style="width:5%" /><col style="width:5%" />
      <col style="width:5.5%" /><col style="width:8%" /><col style="width:5.5%" /><col style="width:10%" />
      <col style="width:11%" /><col style="width:33%" />
    </colgroup>
    <thead>
      <tr>
        <th>Item</th><th>Part</th><th>Key</th><th>High</th><th>Low</th><th>Diff.</th><th>Difficulty</th>
        <th>Disc.</th><th>Discrimination</th><th>Recommendation</th><th>Distractors / written detail</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="legend">
    Difficulty: above ${thresholds.easyAbove.toFixed(2)} = Easy · below ${thresholds.hardBelow.toFixed(2)} = Hard · otherwise Average.
    Discrimination: above ${thresholds.discriminatingAbove.toFixed(2)} = Discriminating · below ${thresholds.notDiscriminatingBelow.toFixed(3)} = Not Discriminating.
    Distractors: OK = chosen more by the low group; D = defect (chosen more by the high group); R = rejected (not chosen by anyone).
    High/Low numbers are counts for scannable items and mean points for written items.
    KR-20 and KR-21 use the scannable items only. Cronbach’s alpha covers every scored row, with written scores scaled to the share of their points earned. A pooled written part is one row covering all of its item numbers.
  </div>

  <h2>High and low groups</h2>
  <div class="group-wrap">
    ${groupTable('High group', report.highGroup)}
    ${groupTable('Low group', report.lowGroup)}
  </div>
  <div class="sign">Prepared by: <strong>${escapeHtml(exam.teacherName || '________________')}</strong></div>
</body>
</html>`;
}
