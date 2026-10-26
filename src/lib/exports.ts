import type { AppState, Exam, ExamCategory, ExamSection, Learner, ScanResult } from '../types';
import { CATEGORY_LABELS } from '../types';
import { summarize } from './results';
import { scoreResult } from './scoring';
import { examSections, totalItemCount, totalPoints, scannablePoints } from './sections';
import { safeFilename, downloadJson, downloadText } from './download';
import { rosterToCSV } from './roster';

export const APP_TAG = 'Tsek — Exam Checker';

function timestamp(): string {
  return new Date().toISOString();
}

function categoryShort(category: ExamCategory): 'WW' | 'PT' | 'QE' {
  return CATEGORY_LABELS[category].short as 'WW' | 'PT' | 'QE';
}

function examLearners(state: AppState, exam: Exam): Learner[] {
  return state.learners.filter((learner) => learner.examId === exam.id);
}

function examResults(state: AppState, exam: Exam): ScanResult[] {
  return state.results.filter((result) => result.examId === exam.id);
}

export function examFileStem(exam: Exam): string {
  return safeFilename(
    [
      exam.subject || 'Subject',
      exam.gradeLevel,
      exam.section,
      exam.category === 'QSTE' ? exam.quarterKey : exam.assessmentName,
    ]
      .filter(Boolean)
      .join('_')
  );
}

export interface TsekResultsJSON {
  version: '1.0';
  exportType: 'SRPHS_TSEK_RESULTS';
  exportTimestamp: string;
  app: string;
  school: AppState['settings'];
  exam: Exam;
  learners: Learner[];
  results: ScanResult[];
  summary: ReturnType<typeof summarize>;
}

export function buildResultsArchive(state: AppState, exam: Exam): TsekResultsJSON {
  const learners = examLearners(state, exam);
  const results = examResults(state, exam);
  return {
    version: '1.0',
    exportType: 'SRPHS_TSEK_RESULTS',
    exportTimestamp: timestamp(),
    app: APP_TAG,
    school: state.settings,
    exam,
    learners,
    results,
    summary: summarize(exam, learners, results),
  };
}

export interface ExamScoresJSON {
  version: '1.0';
  exportType: 'SRPHS_EXAM_SCORES';
  exportTimestamp: string;
  source: string;
  subjectUID: string;
  subjectName: string;
  schoolYear: string;
  gradeLevel: string;
  section: string;
  teacherName: string;
  workspace: 'JHS' | 'SHS';
  quarterKey: string;
  category: 'WW' | 'PT' | 'QE';
  categoryLabel: string;
  assessmentName: string;
  examCode: string;
  /** Scanned items, kept under the original name for older importers. */
  itemCount: number;
  scannedItemCount: number;
  writtenItemCount: number;
  totalItemCount: number;
  totalPoints: number;
  scannedPoints: number;
  writtenPoints: number;
  choiceCount: number;
  passingPercent: number;
  depedPolicy: '2015' | '2027';
  sections: ExamSection[];
  answerKey: string[];
  learners: Array<{ lrn: string; studentName: string; status: Learner['status'] }>;
  results: Array<{
    lrn: string;
    studentName: string;
    status: Learner['status'];
    /** Scanned correct count, kept for older importers. */
    rawScore: number;
    /** Scanned item count, kept for older importers. */
    totalItems: number;
    scannedCorrect: number;
    scannedPointsEarned: number;
    scannedPointsPossible: number;
    writtenPointsEarned: number;
    writtenPointsPossible: number;
    pointsEarned: number;
    pointsPossible: number;
    manualScored: number;
    manualCount: number;
    manualComplete: boolean;
    manualScores?: Record<string, number>;
    percentage: number;
    grade: number;
    needsReview: boolean;
    manualOverride: boolean;
    scannedAt: string;
  }>;
  summary: ReturnType<typeof summarize>;
}

/**
 * Category-aware assessment file. This is the format the GradeApp needs in
 * order to place the score under WW, PT, or QE instead of overwriting a
 * quarter grade. It deliberately carries the raw score plus the transmuted
 * equivalent so the receiving app can weight it correctly.
 */
export function buildExamScoresJson(state: AppState, exam: Exam): ExamScoresJSON {
  const learners = examLearners(state, exam);
  const results = examResults(state, exam);
  const byLrn = new Map(learners.map((learner) => [learner.lrn, learner]));
  const scannedPoints = scannablePoints(exam);
  const pointTotal = totalPoints(exam);
  return {
    version: '1.0',
    exportType: 'SRPHS_EXAM_SCORES',
    exportTimestamp: timestamp(),
    source: APP_TAG,
    subjectUID: exam.subjectUID || 'N/A',
    subjectName: exam.subject,
    schoolYear: exam.schoolYear,
    gradeLevel: exam.gradeLevel,
    section: exam.section,
    teacherName: exam.teacherName,
    workspace: exam.workspace,
    quarterKey: exam.quarterKey,
    category: categoryShort(exam.category),
    categoryLabel: CATEGORY_LABELS[exam.category].label,
    assessmentName: exam.assessmentName,
    examCode: exam.code,
    itemCount: exam.itemCount,
    scannedItemCount: exam.itemCount,
    writtenItemCount: totalItemCount(exam) - exam.itemCount,
    totalItemCount: totalItemCount(exam),
    totalPoints: pointTotal,
    scannedPoints,
    writtenPoints: Math.round((pointTotal - scannedPoints) * 100) / 100,
    choiceCount: exam.choiceCount,
    passingPercent: exam.passingPercent,
    depedPolicy: exam.depedPolicy,
    sections: examSections(exam),
    answerKey: exam.answerKey,
    learners: learners.map((learner) => ({
      lrn: learner.lrn,
      studentName: learner.name,
      status: learner.status,
    })),
    results: results.map((result) => {
      const score = scoreResult(exam, result);
      return {
        lrn: result.lrn,
        studentName: byLrn.get(result.lrn)?.name ?? result.name,
        status: byLrn.get(result.lrn)?.status ?? 'Active',
        rawScore: result.correctCount,
        totalItems: exam.itemCount,
        scannedCorrect: score.correctCount,
        scannedPointsEarned: score.objectiveEarned,
        scannedPointsPossible: score.objectivePossible,
        writtenPointsEarned: score.manualEarned,
        writtenPointsPossible: score.manualPossible,
        pointsEarned: score.earned,
        pointsPossible: score.possible,
        manualScored: score.manualScored,
        manualCount: score.manualCount,
        manualComplete: score.complete,
        manualScores: result.manualScores,
        percentage: score.percentage,
        grade: score.grade,
        needsReview: result.needsReview,
        manualOverride: result.manualOverride,
        scannedAt: result.scannedAt,
      };
    }),
    summary: summarize(exam, learners, results),
  };
}

export interface SubjectGradesJSON {
  version: '1.0';
  exportType: 'SRPHS_SUBJECT_GRADES';
  exportTimestamp: string;
  subjectUID: string;
  subjectName: string;
  schoolYear: string;
  gradeLevel: string;
  section: string;
  teacherName: string;
  workspace: 'JHS' | 'SHS';
  quarters: Array<{
    quarterKey: string;
    grades: Array<{
      lrn: string;
      studentName: string;
      grade: number;
      status?: Learner['status'];
    }>;
  }>;
}

/**
 * Exact legacy format already accepted by the GradeApp adviser importer.
 * A single assessment is not a full quarter grade, so this file should only
 * be used when the imported result really is the final grade for the quarter.
 */
export function buildSubjectGradesJson(state: AppState, exam: Exam): SubjectGradesJSON {
  const learners = examLearners(state, exam);
  const results = examResults(state, exam);
  const byLrn = new Map(results.map((result) => [result.lrn, result]));
  return {
    version: '1.0',
    exportType: 'SRPHS_SUBJECT_GRADES',
    exportTimestamp: timestamp(),
    subjectUID: exam.subjectUID || 'N/A',
    subjectName: exam.subject,
    schoolYear: exam.schoolYear,
    gradeLevel: exam.gradeLevel,
    section: exam.section,
    teacherName: exam.teacherName,
    workspace: exam.workspace,
    quarters: [
      {
        quarterKey: exam.quarterKey,
        grades: learners
          .filter((learner) => learner.status === 'Active' && byLrn.has(learner.lrn))
          .map((learner) => ({
            lrn: learner.lrn,
            studentName: learner.name,
            grade: byLrn.get(learner.lrn)!.grade,
            status: learner.status,
          })),
      },
    ],
  };
}

export function buildResultsCsv(exam: Exam, state: AppState): string {
  const learners = examLearners(state, exam);
  const results = examResults(state, exam);
  const byLrn = new Map(results.map((result) => [result.lrn, result]));
  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const num = (value: number) => (Number.isInteger(value) ? value : Math.round(value * 100) / 100);
  const rows = [
    [
      'LRN',
      'Learner',
      'Status',
      'Scanned Correct',
      'Scanned Items',
      'Scanned Points',
      'Scanned Possible',
      'Written Points',
      'Written Possible',
      'Points Earned',
      'Points Possible',
      'Percentage',
      'Grade',
      'Written Scored',
      'Written Scores',
      'Complete',
      'Needs Review',
      'QR',
      'Manually Edited',
      'Scanned At',
      'Source File',
    ],
    ...learners.map((learner) => {
      const result = byLrn.get(learner.lrn);
      if (!result) {
        return [learner.lrn, learner.name, learner.status, '', exam.itemCount, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Not scanned'];
      }
      const score = scoreResult(exam, result);
      return [
        learner.lrn,
        learner.name,
        learner.status,
        score.correctCount,
        exam.itemCount,
        num(score.objectiveEarned),
        num(score.objectivePossible),
        num(score.manualEarned),
        num(score.manualPossible),
        num(score.earned),
        num(score.possible),
        score.percentage.toFixed(2),
        score.grade,
        score.manualScored,
        score.manualCount,
        score.complete ? 'Yes' : 'No',
        result.needsReview ? 'Yes' : 'No',
        result.qrOk ? 'Yes' : 'No',
        result.manualOverride ? 'Yes' : 'No',
        result.scannedAt,
        result.sourceFile,
      ];
    }),
  ];
  return rows.map((row) => row.map(escape).join(',')).join('\r\n');
}

export function downloadResultsArchive(state: AppState, exam: Exam): void {
  downloadJson(buildResultsArchive(state, exam), `${examFileStem(exam)}_Tsek-results.json`);
}

export function downloadExamScoresJson(state: AppState, exam: Exam): void {
  downloadJson(buildExamScoresJson(state, exam), `${examFileStem(exam)}_GradeApp-scores.json`);
}

export function downloadSubjectGradesJson(state: AppState, exam: Exam): void {
  downloadJson(buildSubjectGradesJson(state, exam), `${examFileStem(exam)}_SubjectGrades.json`);
}

export function downloadResultsCsv(state: AppState, exam: Exam): void {
  downloadText(buildResultsCsv(exam, state), `${examFileStem(exam)}_results.csv`, 'text/csv');
}

export function downloadWorkspace(state: AppState): void {
  downloadJson(
    {
      version: '1.0',
      exportType: 'SRPHS_TSEK_WORKSPACE',
      exportTimestamp: timestamp(),
      app: APP_TAG,
      state,
    },
    `Tsek_workspace_${new Date().toISOString().slice(0, 10)}.json`
  );
}

export function downloadRoster(exam: Exam, learners: Learner[]): void {
  downloadText(rosterToCSV(learners), `${examFileStem(exam)}_roster.csv`, 'text/csv');
}
