export type Choice = 'A' | 'B' | 'C' | 'D' | 'E' | 'T' | 'F';
export type ExamCategory = 'WOW' | 'PPT' | 'QSTE';
export type PaperSize = 'FOLIO' | 'LEGAL' | 'A4' | 'LETTER';
export type PaperOrientation = 'portrait' | 'landscape';
export type SheetsPerPage = 1 | 2;
export type DepedPolicy = '2015' | '2027';
export type Workspace = 'JHS' | 'SHS';
export type LearnerStatus = 'Active' | 'Dropped' | 'Transferred';

export const BLOOM_LEVELS = [
  'Remembering',
  'Understanding',
  'Applying',
  'Analyzing',
  'Evaluation',
  'Creating',
] as const;

export type BloomLevel = (typeof BLOOM_LEVELS)[number];

export interface TosRow {
  id: string;
  topic: string;
  competencies: string;
  /** Time spent or frequency, in minutes. Drives the row's weight. */
  time: number;
  /** Number of items placed under each Bloom level. */
  items: Record<BloomLevel, number>;
  type: string;
}

export interface TosPlan {
  subject: string;
  grade: string;
  gradingPeriod: string;
  schoolYear: string;
  teacher: string;
  bloomWeights: Record<BloomLevel, number>;
  rows: TosRow[];
}

export interface AnalysisThresholds {
  easyAbove: number;
  hardBelow: number;
  discriminatingAbove: number;
  notDiscriminatingBelow: number;
}

export type SectionType =
  | 'MCQ'
  | 'TRUE_FALSE'
  | 'MODIFIED_TRUE_FALSE'
  | 'IDENTIFICATION'
  | 'ENUMERATION'
  | 'ESSAY';

/** Written parts are scored either one box per item or one total for the part. */
export type SectionScoreMode = 'items' | 'part';

export interface ExamSection {
  id: string;
  type: SectionType;
  itemCount: number;
  /** Points awarded for one item in this section. */
  pointsPerItem: number;
  /** Letter choices for a multiple-choice section. */
  choices?: 4 | 5;
  /** Optional custom part name printed in the workspace. */
  title?: string;
  /**
   * Written parts only. "part" pools the part into one score box, which suits
   * enumeration, identification, and essays. Missing means "items".
   */
  scoreMode?: SectionScoreMode;
}

export const SECTION_LABELS: Record<SectionType, { short: string; label: string; scannable: boolean; hint: string }> = {
  MCQ: {
    short: 'MCQ',
    label: 'Multiple choice',
    scannable: true,
    hint: 'Shaded letter choices, checked by the scanner.',
  },
  TRUE_FALSE: {
    short: 'T/F',
    label: 'True or False',
    scannable: true,
    hint: 'Two bubbles per item, checked by the scanner.',
  },
  MODIFIED_TRUE_FALSE: {
    short: 'MTF',
    label: 'Modified True or False',
    scannable: false,
    hint: 'The learner writes the correction for a false statement. Scored directly.',
  },
  IDENTIFICATION: {
    short: 'ID',
    label: 'Identification',
    scannable: false,
    hint: 'A written word or phrase per item. Scored directly.',
  },
  ENUMERATION: {
    short: 'ENUM',
    label: 'Enumeration',
    scannable: false,
    hint: 'A written list per item, with partial credit. Scored directly.',
  },
  ESSAY: {
    short: 'ESSAY',
    label: 'Essay',
    scannable: false,
    hint: 'A constructed response, scored with your rubric.',
  },
};

export interface Exam {
  id: string;
  code: string;
  title: string;
  subject: string;
  subjectUID: string;
  schoolYear: string;
  gradeLevel: string;
  section: string;
  teacherName: string;
  workspace: Workspace;
  quarterKey: string;
  category: ExamCategory;
  assessmentName: string;
  itemCount: number;
  choiceCount: 4 | 5;
  answerKey: string[];
  passingPercent: number;
  depedPolicy: DepedPolicy;
  paper: PaperSize;
  orientation: PaperOrientation;
  sheetsPerPage: SheetsPerPage;
  /** Ordered test parts. Missing on workspaces saved before section scoring. */
  sections?: ExamSection[];
  tos?: TosPlan;
  analysis?: AnalysisThresholds;
  createdAt: string;
  updatedAt: string;
}

export interface Learner {
  id: string;
  examId: string;
  lrn: string;
  name: string;
  sex?: 'Male' | 'Female';
  status: LearnerStatus;
}

export interface ItemFlag {
  item: number;
  chosen: string | null;
  filled: string[];
  ambiguous: boolean;
  multiple: boolean;
  confidence: number;
}

export interface ScanResult {
  id: string;
  examId: string;
  lrn: string;
  name: string;
  answers: (string | null)[];
  flags: ItemFlag[];
  correctCount: number;
  total: number;
  percentage: number;
  grade: number;
  scannedAt: string;
  sourceFile: string;
  pageNumber: number;
  qrOk: boolean;
  needsReview: boolean;
  manualOverride: boolean;
  /** Direct scores for written items, keyed by section id and item position. */
  manualScores?: Record<string, number>;
}

export interface AppSettings {
  schoolName: string;
  schoolId: string;
  division: string;
  region: string;
  paper: PaperSize;
  orientation: PaperOrientation;
  sheetsPerPage: SheetsPerPage;
  defaultItemCount: number;
  defaultChoiceCount: 4 | 5;
  depedPolicy: DepedPolicy;
  passingPercent: number;
}

export interface AppState {
  version: 1;
  settings: AppSettings;
  exams: Exam[];
  learners: Learner[];
  results: ScanResult[];
  activeExamId: string | null;
}

export interface ScanProgress {
  phase: 'reading' | 'rendering' | 'qr' | 'markers' | 'sampling' | 'scoring' | 'done' | 'error';
  message: string;
  page?: number;
  totalPages?: number;
  percent?: number;
}

export interface OmrReadResult {
  qrPayload: string | null;
  examCode: string | null;
  lrn: string | null;
  rotation: 0 | 90 | 180 | 270;
  answers: (string | null)[];
  flags: ItemFlag[];
  markerCount: number;
  qrOk: boolean;
  confidence: number;
  debugImage: string;
  warnings: string[];
}

export const CATEGORY_LABELS: Record<ExamCategory, { short: string; label: string; long: string }> = {
  WOW: {
    short: 'WW',
    label: 'Written Works',
    long: 'Quizzes, seatwork, and written checks.',
  },
  PPT: {
    short: 'PT',
    label: 'Performance Tasks',
    long: 'Performance or product tasks scored with a rubric.',
  },
  QSTE: {
    short: 'QE',
    label: 'Quarterly Exam',
    long: 'Quarterly or periodical examination.',
  },
};

export const QUARTER_OPTIONS = [
  '1st Quarter',
  '2nd Quarter',
  '3rd Quarter',
  '4th Quarter',
  'Semester 1',
  'Semester 2',
];

export const GRADE_LEVEL_OPTIONS = [
  'Grade 7',
  'Grade 8',
  'Grade 9',
  'Grade 10',
  'Grade 11',
  'Grade 12',
];
