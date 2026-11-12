/**
 * Regression tests for the Non-MCQ analysis view.
 *
 * Every expected number below was worked out by hand from the fixture, not read
 * back from the code, so a wrong formula cannot hide behind a matching test.
 * Run with `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAnalysisCsv,
  buildItemAnalysis,
  buildMcqAnalysis,
  buildNonMcqAnalysis,
  explainRecommendation,
} from '../src/lib/analysis';
import type { Exam, ScanResult } from '../src/types';

const WHEN = '2026-10-26T00:00:00.000Z';

function makeExam(sections: Exam['sections']): Exam {
  const itemCount = sections?.reduce((sum, section) => sum + section.itemCount, 0) ?? 0;
  return {
    id: 'exam-1',
    code: 'TEST',
    title: 'Non-MCQ test exam',
    subject: 'Mathematics',
    subjectUID: 'math',
    schoolYear: '2026-2027',
    gradeLevel: '10',
    section: 'A',
    teacherName: 'Test Teacher',
    workspace: 'school',
    quarterKey: 'Q1',
    category: 'quarterly',
    assessmentName: 'Quarterly Exam',
    itemCount,
    choiceCount: 4,
    answerKey: [],
    passingPercent: 75,
    depedPolicy: '2015',
    paper: 'folio',
    orientation: 'landscape',
    sheetsPerPage: '2',
    sections,
    createdAt: WHEN,
    updatedAt: WHEN,
  };
}

function makePaper(id: string, answers: (string | null)[], manualScores: Record<string, number> = {}): ScanResult {
  return {
    id,
    examId: 'exam-1',
    lrn: id,
    name: `Learner ${id.toUpperCase()}`,
    answers,
    flags: [],
    correctCount: 0,
    total: 0,
    percentage: 0,
    grade: 0,
    scannedAt: WHEN,
    sourceFile: 'non-mcq.test.ts',
    pageNumber: 1,
    qrOk: true,
    needsReview: false,
    manualOverride: false,
    manualScores,
  };
}

function close(actual: number | null | undefined, expected: number, label: string, tolerance = 1e-9): void {
  assert.notEqual(actual, null, `${label}: expected ${expected}, got null`);
  assert.notEqual(actual, undefined, `${label}: expected ${expected}, got undefined`);
  const value = actual as number;
  assert.ok(Number.isFinite(value), `${label}: expected ${expected}, got ${value}`);
  assert.ok(
    Math.abs(value - expected) <= tolerance,
    `${label}: expected ${expected}, got ${value}`
  );
}

// ---------------------------------------------------------------------------
// Difficulty is the share of an item's own points, so a 10-point essay and a
// 5-point identification item carry the right weight.
// ---------------------------------------------------------------------------
test('difficulty is points earned over points possible when maximums differ', () => {
  const exam = makeExam([
    { id: 'essay', type: 'ESSAY', itemCount: 2, pointsPerItem: 10, scoreMode: 'items' },
    { id: 'ident', type: 'IDENTIFICATION', itemCount: 1, pointsPerItem: 5, scoreMode: 'items' },
  ]);
  const report = buildNonMcqAnalysis(exam, [
    makePaper('s1', [], { 'essay:0': 10, 'essay:1': 8, 'ident:0': 5 }),
    makePaper('s2', [], { 'essay:0': 8, 'essay:1': 6, 'ident:0': 4 }),
    makePaper('s3', [], { 'essay:0': 6, 'essay:1': 4, 'ident:0': 2 }),
    makePaper('s4', [], { 'essay:0': 4, 'essay:1': 2, 'ident:0': 0 }),
  ]);

  assert.equal(report.items.length, 3);
  assert.equal(report.itemCount, 3);
  assert.equal(report.points, 25);
  assert.equal(report.takers, 4);

  // Essay 1: 28 points earned of 40 possible.
  close(report.items[0].difficulty, 0.7, 'essay 1 difficulty (7 of 10 points)');
  // Essay 2: 20 of 40.
  close(report.items[1].difficulty, 0.5, 'essay 2 difficulty (5 of 10 points)');
  // Identification: 11 of 20.
  close(report.items[2].difficulty, 0.55, 'identification difficulty (2.75 of 5 points)');

  // The unweighted item average and the class points-earned ratio are different
  // numbers on purpose: (0.7 + 0.5 + 0.55) / 3 versus 59 / 100.
  close(report.averageDifficulty, 0.5833333333333334, 'unweighted average item difficulty');
  close(report.pointsEarnedRatio, 0.59, 'class points-earned ratio (59 of 100)');
  assert.notEqual(
    report.averageDifficulty,
    report.pointsEarnedRatio,
    'average item difficulty and points earned must stay distinct'
  );

  assert.equal(report.reliability.mean, 14.75);
  assert.equal(report.reliability.standardDeviation, 6.379);

  // Lowest / median / highest points actually earned.
  assert.deepEqual(
    report.items.map((item) => [item.scoreMin, item.scoreMedian, item.scoreMax]),
    [
      [4, 7, 10],
      [2, 5, 8],
      [0, 3, 5],
    ]
  );
  assert.deepEqual(
    report.items.map((item) => item.meanEarned),
    [7, 5, 2.75]
  );
  assert.deepEqual(
    report.items.map((item) => item.scoredCount),
    [4, 4, 4]
  );

  // Alpha from the normalized shares:
  // item variances 0.05, 0.05, 0.1475; total variance 0.6875
  // alpha = (3/2) * (1 - 0.2475 / 0.6875) = 0.96
  close(report.reliability.alpha, 0.96, "Cronbach's alpha");
  assert.equal(report.reliability.kr20, null, 'KR-20 must never be applied to partial credit');
  assert.equal(report.reliability.kr21, null, 'KR-21 must never be applied to partial credit');

  assert.deepEqual(
    report.items.map((item) => item.recommendation),
    ['Accept', 'Accept', 'Accept']
  );
  assert.equal(report.recommendationCounts.Accept, 3);
  assert.equal(report.recommendationCounts.Discard, 0);

  // Student percentages are 92, 72, 48, and 24, so the bands fill as follows:
  // below 60 gets two, 70-79 gets one, 90-100 gets one.
  assert.deepEqual(
    report.scoreBands.map((band) => band.count),
    [2, 0, 1, 0, 1]
  );
});

// ---------------------------------------------------------------------------
// Discrimination compares each item with a total that does NOT include it.
// Two items with a built-in reversal prove the correction is really applied:
// the corrected r is about -0.524, while the uncorrected r would be about +0.068.
// ---------------------------------------------------------------------------
test('discrimination is an item-total correlation with the item removed', () => {
  const exam = makeExam([{ id: 'w', type: 'ESSAY', itemCount: 2, pointsPerItem: 10, scoreMode: 'items' }]);
  const report = buildNonMcqAnalysis(exam, [
    makePaper('p1', [], { 'w:0': 10, 'w:1': 0 }),
    makePaper('p2', [], { 'w:0': 8, 'w:1': 10 }),
    makePaper('p3', [], { 'w:0': 6, 'w:1': 4 }),
    makePaper('p4', [], { 'w:0': 4, 'w:1': 8 }),
  ]);

  // cov = -4.5, var(item) = 5, var(rest) = 14.75  ->  -4.5 / sqrt(73.75)
  close(report.items[0].discrimination, -0.5240003, 'item 1 corrected item-total r', 1e-6);
  close(report.items[1].discrimination, -0.5240003, 'item 2 corrected item-total r', 1e-6);

  assert.ok(
    report.items[0].discrimination !== null && report.items[0].discrimination < 0,
    'item 1 must be negatively correlated with the rest of the written total'
  );
  assert.equal(report.items[0].discriminationBand, 'Not Discriminating');
  assert.equal(report.items[0].recommendation, 'Needs Revision');
  assert.equal(report.recommendationCounts.Discard, 0, 'written items are revised, never discarded');

  close(report.items[0].difficulty, 0.7, 'item 1 difficulty');
  close(report.items[1].difficulty, 0.55, 'item 2 difficulty');
  close(report.averageDiscrimination, -0.5240003, 'average discrimination', 1e-6);
});

// ---------------------------------------------------------------------------
// A very easy written item with bad discrimination is still a revision, not a
// discard — the "Discard" verdict is reserved for scannable items.
// ---------------------------------------------------------------------------
test('an easy written item that tracks poorly is revised, not discarded', () => {
  const exam = makeExam([{ id: 'w', type: 'ESSAY', itemCount: 2, pointsPerItem: 10, scoreMode: 'items' }]);
  const report = buildNonMcqAnalysis(exam, [
    makePaper('p1', [], { 'w:0': 10, 'w:1': 2 }),
    makePaper('p2', [], { 'w:0': 9, 'w:1': 9 }),
    makePaper('p3', [], { 'w:0': 9, 'w:1': 2 }),
    makePaper('p4', [], { 'w:0': 8, 'w:1': 6 }),
  ]);

  const item = report.items[0];
  close(item.difficulty, 0.9, 'easy item difficulty');
  assert.equal(item.difficultyBand, 'Easy');
  assert.equal(item.discriminationBand, 'Not Discriminating');
  assert.equal(item.recommendation, 'Needs Revision');
  assert.equal(report.recommendationCounts.Discard, 0);

  const reason = explainRecommendation(item, 'non-mcq');
  assert.ok(reason.includes('of the points were earned'), `unexpected wording: ${reason}`);
  assert.ok(reason.includes('does not track the overall written score'), `unexpected wording: ${reason}`);
  assert.ok(!reason.includes('answered it correctly'), 'written items must not be described as right/wrong');
  assert.ok(!reason.includes('high and low'), 'written explanations must not use group wording');
});

// ---------------------------------------------------------------------------
// A part scored as a whole is one row worth the sum of its items.
// ---------------------------------------------------------------------------
test('a pooled written part becomes one row worth all of its items', () => {
  const exam = makeExam([
    { id: 'enum', type: 'ENUMERATION', itemCount: 4, pointsPerItem: 3, scoreMode: 'part' },
  ]);
  const report = buildNonMcqAnalysis(exam, [
    makePaper('p1', [], { 'enum:part': 12 }),
    makePaper('p2', [], { 'enum:part': 9 }),
    makePaper('p3', [], { 'enum:part': 6 }),
  ]);

  assert.equal(report.unitCount, 1);
  assert.equal(report.items.length, 1);
  assert.equal(report.itemCount, 4);
  assert.equal(report.writtenItemCount, 4);
  assert.equal(report.pooledPartCount, 1);

  const item = report.items[0];
  assert.equal(item.part, true);
  assert.equal(item.item, 1);
  assert.equal(item.endItem, 4);
  assert.equal(item.points, 12);
  assert.equal(item.meanEarned, 9);
  assert.equal(item.difficulty, 0.75);
  assert.equal(item.difficultyBand, 'Average');
  assert.deepEqual([item.scoreMin, item.scoreMedian, item.scoreMax], [6, 9, 12]);
  assert.equal(item.discrimination, null);
  assert.equal(item.recommendation, '—');

  // One scored row cannot be correlated with itself or produce alpha.
  assert.equal(report.reliability.alpha, null);
  assert.ok(
    report.warnings.some((warning) => warning.includes('at least two scored rows')),
    `expected a two-row warning, got ${JSON.stringify(report.warnings)}`
  );
});

// ---------------------------------------------------------------------------
// Papers that still miss a written score are left out entirely, and scanned
// items never leak into this view.
// ---------------------------------------------------------------------------
test('unfinished written papers are excluded and MCQ rows stay out', () => {
  const exam = makeExam([
    { id: 'mcq', type: 'MCQ', itemCount: 2, pointsPerItem: 1, choices: 4 },
    { id: 'w', type: 'ESSAY', itemCount: 2, pointsPerItem: 5, scoreMode: 'items' },
  ]);
  exam.answerKey = ['A', 'B'];

  const papers = [
    makePaper('s1', ['A', 'B'], { 'w:0': 5, 'w:1': 5 }),
    makePaper('s2', ['A', 'A'], { 'w:0': 4, 'w:1': 4 }),
    makePaper('s3', ['B', 'B'], { 'w:0': 3, 'w:1': 2 }),
    makePaper('s4', ['A', 'B'], { 'w:0': 2, 'w:1': 1 }),
    makePaper('s5', ['A', 'A'], { 'w:0': 5 }), // second essay never scored
  ];

  const report = buildNonMcqAnalysis(exam, papers);
  assert.equal(report.checkedCount, 5);
  assert.equal(report.takers, 4);
  assert.equal(report.itemCount, 2);
  assert.equal(report.scannedItemCount, 0);
  assert.ok(report.items.every((item) => item.scannable === false));
  close(report.items[0].difficulty, 0.7, 'essay 1 difficulty over 4 complete papers');
  close(report.items[1].difficulty, 0.6, 'essay 2 difficulty over 4 complete papers');
  assert.ok(
    report.items[1].difficulty !== 0.48,
    'a missing score must not be counted as zero (that would give 0.48)'
  );
  assert.ok(
    report.warnings.some((warning) => warning.includes('missing written scores')),
    `expected a missing-score warning, got ${JSON.stringify(report.warnings)}`
  );

  const mcq = buildMcqAnalysis(exam, papers);
  assert.equal(mcq.itemCount, 2);
  assert.equal(mcq.writtenItemCount, 0);
  assert.ok(mcq.items.every((item) => item.scannable));
});

// ---------------------------------------------------------------------------
// Impossible statistics stay blank with a reason instead of printing a zero.
// ---------------------------------------------------------------------------
test('statistics that cannot be computed stay blank and say why', () => {
  const exam = makeExam([
    { id: 'w', type: 'IDENTIFICATION', itemCount: 2, pointsPerItem: 5, scoreMode: 'items' },
  ]);
  const papers = ['p1', 'p2', 'p3'].map((id) =>
    makePaper(id, [], { 'w:0': 4, 'w:1': 3 })
  );
  const report = buildNonMcqAnalysis(exam, papers);

  close(report.items[0].difficulty, 0.8, 'difficulty is still reported');
  assert.equal(report.items[0].discrimination, null);
  assert.equal(report.items[0].recommendation, '—');
  assert.equal(report.averageDiscrimination, null);
  assert.equal(report.reliability.alpha, null);
  assert.ok(
    report.warnings.some((warning) => warning.includes('same total score')),
    `expected a zero-variance warning, got ${JSON.stringify(report.warnings)}`
  );
});

// ---------------------------------------------------------------------------
// An exam with no written part must not pretend to have a written analysis.
// The screen shows an explanation instead of a wall of dashes, and the CSV
// leaves the empty block out so it does not read as a broken export.
// ---------------------------------------------------------------------------
test('a test with no written items reports an empty non-MCQ view', () => {
  const exam = makeExam([{ id: 'mcq', type: 'MCQ', itemCount: 3, pointsPerItem: 1, choices: 4 }]);
  exam.answerKey = ['A', 'B', 'C'];
  const papers = [
    makePaper('p1', ['A', 'B', 'C']),
    makePaper('p2', ['A', 'A', 'C']),
    makePaper('p3', ['B', 'B', 'B']),
  ];

  const nonMcq = buildNonMcqAnalysis(exam, papers);
  assert.equal(nonMcq.itemCount, 0);
  assert.equal(nonMcq.unitCount, 0);
  assert.equal(nonMcq.points, 0);
  assert.equal(nonMcq.takers, 3, 'the scanned papers are still complete');
  assert.equal(nonMcq.items.length, 0);
  assert.equal(nonMcq.averageDifficulty, null);
  assert.equal(nonMcq.averageDiscrimination, null);
  assert.equal(nonMcq.reliability.alpha, null);

  const csv = buildAnalysisCsv(exam, [
    buildItemAnalysis(exam, papers),
    buildMcqAnalysis(exam, papers),
    nonMcq,
  ]);
  assert.ok(csv.includes('Overall analysis'), 'the overall block stays');
  assert.ok(csv.includes('Multiple choice (MCQ) analysis'), 'the MCQ block stays');
  assert.ok(!csv.includes('Non-MCQ (written) analysis'), 'the empty written block is left out');
});
