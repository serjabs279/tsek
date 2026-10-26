import type { DepedPolicy, Exam, Learner } from '../types';
import { examCode, todayISO, uid } from './id';
import { buildExamWithSections, examSections } from './sections';

export const DEFAULT_ANSWER_KEY_LENGTH = 50;

/** DepEd DO 8, s. 2015 transmutation table used by GradeApp. */
export function transmute2015(percentage: number): number {
  const p = Math.round(percentage * 100) / 100;
  if (p >= 100) return 100;
  if (p >= 98.4) return 99;
  if (p >= 96.8) return 98;
  if (p >= 95.2) return 97;
  if (p >= 93.6) return 96;
  if (p >= 92.0) return 95;
  if (p >= 90.4) return 94;
  if (p >= 88.8) return 93;
  if (p >= 87.2) return 92;
  if (p >= 85.6) return 91;
  if (p >= 84.0) return 90;
  if (p >= 82.4) return 89;
  if (p >= 80.8) return 88;
  if (p >= 79.2) return 87;
  if (p >= 77.6) return 86;
  if (p >= 76.0) return 85;
  if (p >= 74.4) return 84;
  if (p >= 72.8) return 83;
  if (p >= 71.2) return 82;
  if (p >= 69.6) return 81;
  if (p >= 68.0) return 80;
  if (p >= 66.4) return 79;
  if (p >= 64.8) return 78;
  if (p >= 63.2) return 77;
  if (p >= 61.6) return 76;
  if (p >= 60.0) return 75;
  if (p >= 56.0) return 74;
  if (p >= 52.0) return 73;
  if (p >= 48.0) return 72;
  if (p >= 44.0) return 71;
  if (p >= 40.0) return 70;
  if (p >= 36.0) return 69;
  if (p >= 32.0) return 68;
  if (p >= 28.0) return 67;
  if (p >= 24.0) return 66;
  if (p >= 20.0) return 65;
  if (p >= 16.0) return 64;
  if (p >= 12.0) return 63;
  if (p >= 8.0) return 62;
  if (p >= 4.68) return 61;
  return 60;
}

/** DepEd MATATAG adjusted transmutation table, effective SY 2027–2028. */
export function transmute2027(percentage: number): number {
  const p = Math.round(percentage * 100) / 100;
  if (p >= 99.5) return 100;
  if (p >= 98.32) return 99;
  if (p >= 97.14) return 98;
  if (p >= 95.96) return 97;
  if (p >= 94.78) return 96;
  if (p >= 93.6) return 95;
  if (p >= 92.42) return 94;
  if (p >= 91.24) return 93;
  if (p >= 90.06) return 92;
  if (p >= 88.88) return 91;
  if (p >= 87.7) return 90;
  if (p >= 86.52) return 89;
  if (p >= 85.34) return 88;
  if (p >= 84.16) return 87;
  if (p >= 82.98) return 86;
  if (p >= 81.8) return 85;
  if (p >= 80.62) return 84;
  if (p >= 79.44) return 83;
  if (p >= 78.26) return 82;
  if (p >= 77.08) return 81;
  if (p >= 75.9) return 80;
  if (p >= 74.72) return 79;
  if (p >= 73.54) return 78;
  if (p >= 72.36) return 77;
  if (p >= 71.18) return 76;
  if (p >= 70.0) return 75;
  if (p >= 65.34) return 74;
  if (p >= 60.67) return 73;
  if (p >= 56.01) return 72;
  if (p >= 51.34) return 71;
  if (p >= 46.67) return 70;
  if (p >= 42.01) return 69;
  if (p >= 37.34) return 68;
  if (p >= 32.68) return 67;
  if (p >= 28.01) return 66;
  if (p >= 23.35) return 65;
  if (p >= 18.68) return 64;
  if (p >= 14.01) return 63;
  if (p >= 9.35) return 62;
  if (p >= 4.68) return 61;
  return 60;
}

export function scoreToGrade(percentage: number, policy: DepedPolicy): number {
  return policy === '2027' ? transmute2027(percentage) : transmute2015(percentage);
}

export function defaultDepedPolicy(schoolYear: string): DepedPolicy {
  const match = schoolYear.match(/(\d{4})\s*-\s*(\d{4})/);
  const start = match ? Number(match[1]) : NaN;
  return Number.isFinite(start) && start >= 2027 ? '2027' : '2015';
}

export function blankKey(length: number): string[] {
  return Array.from({ length }, () => '');
}

export function makeExam(partial: Partial<Exam> = {}): Exam {
  const itemCount = clampInt(partial.itemCount ?? DEFAULT_ANSWER_KEY_LENGTH, 20, 100);
  const choiceCount = partial.choiceCount === 5 ? 5 : 4;
  const base: Exam = {
    id: partial.id ?? uid('EXAM'),
    code: partial.code ?? examCode(),
    title: 'Untitled examination',
    subject: '',
    subjectUID: '',
    schoolYear: '2026-2027',
    gradeLevel: 'Grade 10',
    section: '',
    teacherName: '',
    workspace: 'JHS',
    quarterKey: '1st Quarter',
    category: 'QSTE',
    assessmentName: 'Quarterly Examination',
    itemCount,
    choiceCount,
    answerKey: blankKey(itemCount),
    passingPercent: 75,
    depedPolicy: '2015',
    paper: 'FOLIO',
    orientation: 'landscape',
    sheetsPerPage: 2,
    sections:
      partial.sections && partial.sections.length > 0
        ? partial.sections
        : [
            {
              id: uid('SEC'),
              type: 'MCQ',
              itemCount,
              pointsPerItem: 1,
              choices: choiceCount,
            },
          ],
    createdAt: todayISO(),
    updatedAt: todayISO(),
  };
  const merged: Exam = {
    ...base,
    ...partial,
    id: base.id,
    code: base.code,
    answerKey: normalizeKey(partial.answerKey, itemCount),
  };
  return buildExamWithSections(merged, merged.sections ?? examSections(merged));
}

export function normalizeKey(key: string[] | undefined, length: number): string[] {
  return Array.from({ length }, (_, i) => key?.[i] ?? '');
}

/** Fill print fields and test parts added after a workspace was saved. */
export function normalizeExam(exam: Exam): Exam {
  const base: Exam = {
    ...exam,
    paper: exam.paper ?? 'FOLIO',
    // Workspaces saved before two-up printing default to the new folio layout.
    orientation: exam.orientation === 'portrait' ? 'portrait' : 'landscape',
    sheetsPerPage: exam.sheetsPerPage === 1 ? 1 : 2,
  };
  const normalized = buildExamWithSections(base, examSections(base));
  // Opening a workspace is not an edit. Keeping the stored timestamp stops a
  // launch from looking like a change and from churning snapshots.
  return { ...normalized, updatedAt: exam.updatedAt ?? normalized.updatedAt };
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

const SAMPLE_NAMES: Array<[string, string, 'Male' | 'Female']> = [
  ['136001230001', 'Aguilar, Maria Sofia', 'Female'],
  ['136001230002', 'Bautista, John Paulo', 'Male'],
  ['136001230003', 'Castro, Angela Mae', 'Female'],
  ['136001230004', 'Dela Cruz, Mark Joseph', 'Male'],
  ['136001230005', 'Dizon, Patricia Anne', 'Female'],
  ['136001230006', 'Estrada, Rafael Luis', 'Male'],
  ['136001230007', 'Flores, Nicole Andrea', 'Female'],
  ['136001230008', 'Garcia, Miguel Antonio', 'Male'],
  ['136001230009', 'Hernandez, Bianca Rose', 'Female'],
  ['136001230010', 'Ibarra, Carlos Enrique', 'Male'],
  ['136001230011', 'Jimenez, Camille Joy', 'Female'],
  ['136001230012', 'Kalaw, Daniel Emmanuel', 'Male'],
];

const SAMPLE_PATTERN = 'ABCDDABCADCBABDCCABDABCDACBDBACDBACBDABCDABCABDCAB';

export function seedState() {
  const key = SAMPLE_PATTERN.split('').slice(0, 50);
  const exam = makeExam({
    title: '1st Quarterly Exam — Mathematics 10',
    subject: 'Mathematics',
    subjectUID: 'MATH10-Q1-2026',
    gradeLevel: 'Grade 10',
    section: 'St. Paul',
    teacherName: 'Ma. Elena Reyes',
    quarterKey: '1st Quarter',
    category: 'QSTE',
    assessmentName: '1st Quarterly Exam',
    itemCount: 50,
    choiceCount: 4,
    answerKey: key,
    passingPercent: 75,
    depedPolicy: '2015',
    paper: 'FOLIO',
    orientation: 'landscape',
    sheetsPerPage: 2,
  });

  const learners: Learner[] = SAMPLE_NAMES.map(([lrn, name, sex]) => ({
    id: `${exam.id}:${lrn}`,
    examId: exam.id,
    lrn,
    name,
    sex,
    status: 'Active',
  }));

  return { exam, learners };
}
