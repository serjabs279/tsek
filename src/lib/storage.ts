import type { AppSettings, AppState } from '../types';
import { defaultDepedPolicy, normalizeExam } from './grading';

export const STORAGE_KEY = 'srphs-tsek:v1';

export const DEFAULT_SETTINGS: AppSettings = {
  schoolName: 'San Roque Parish High School, Inc.',
  schoolId: '',
  division: '',
  region: '',
  paper: 'FOLIO',
  orientation: 'landscape',
  sheetsPerPage: 2,
  defaultItemCount: 50,
  defaultChoiceCount: 4,
  depedPolicy: '2015',
  passingPercent: 75,
};

export function createEmptyState(): AppState {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, depedPolicy: defaultDepedPolicy('2026-2027') },
    exams: [],
    learners: [],
    results: [],
    activeExamId: null,
  };
}

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.exams)) return null;
    return {
      ...createEmptyState(),
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      exams: parsed.exams.map(normalizeExam),
      learners: Array.isArray(parsed.learners) ? parsed.learners : [],
      results: Array.isArray(parsed.results) ? parsed.results : [],
    };
  } catch (error) {
    console.error('[Tsek] Could not read saved workspace', error);
    return null;
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('[Tsek] Could not save workspace', error);
  }
}

export function validateImportedState(value: unknown): value is AppState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AppState>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.exams) &&
    Array.isArray(candidate.learners) &&
    Array.isArray(candidate.results)
  );
}
