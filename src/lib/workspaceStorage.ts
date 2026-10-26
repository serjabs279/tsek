import type { AppState } from '../types';
import { seedState } from './grading';
import { createEmptyState, loadState, saveState, validateImportedState } from './storage';

/**
 * Persistence seam. One implementation today keeps the app running in the dev
 * host; the Tauri backend will write a JSON file in the app data folder and
 * expose snapshots as files instead of records in webview storage.
 */
export interface WorkspaceStorage {
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
  /** Synchronous where the backend allows it, so closing can still write. */
  flush(state: AppState): void | Promise<void>;
  snapshot(state: AppState, reason: SnapshotReason): Promise<SnapshotMeta | null>;
  listSnapshots(): Promise<SnapshotMeta[]>;
  readSnapshot(id: string): Promise<AppState | null>;
}

export type SnapshotReason =
  | 'launch'
  | 'structure'
  | 'exam'
  | 'learner'
  | 'result'
  | 'results'
  | 'import'
  | 'reset'
  | 'demo';

export const SNAPSHOT_LABELS: Record<SnapshotReason, string> = {
  launch: 'Workspace opened',
  structure: 'Before a structure change',
  exam: 'Before an exam was deleted',
  learner: 'Before a learner was removed',
  result: 'Before a sheet was removed',
  results: 'Before results were replaced',
  import: 'Before a backup replaced the workspace',
  reset: 'Before the workspace was reset',
  demo: 'Before demo data was added',
};

export interface SnapshotMeta {
  id: string;
  savedAt: string;
  reason: SnapshotReason;
  exams: number;
  learners: number;
  results: number;
  bytes: number;
}

const SNAPSHOTS_KEY = 'srphs-tsek:snapshots:v1';
const MAX_SNAPSHOTS = 7;

interface SnapshotRecord extends SnapshotMeta {
  raw: string;
}

function isReason(value: unknown): value is SnapshotReason {
  return typeof value === 'string' && value in SNAPSHOT_LABELS;
}

function toMeta(record: SnapshotRecord): SnapshotMeta {
  return {
    id: record.id,
    savedAt: record.savedAt,
    reason: record.reason,
    exams: record.exams,
    learners: record.learners,
    results: record.results,
    bytes: record.bytes,
  };
}

/** Compare content, not bookkeeping: an updated timestamp is not a change. */
function fingerprint(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), (key, value) => (key === 'updatedAt' ? undefined : value));
  } catch {
    return raw;
  }
}

function readRecords(): SnapshotRecord[] {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter((entry): entry is SnapshotRecord => {
      if (!entry || typeof entry !== 'object') return false;
      const candidate = entry as Partial<SnapshotRecord>;
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.savedAt === 'string' &&
        typeof candidate.raw === 'string' &&
        isReason(candidate.reason)
      );
    });
  } catch (error) {
    console.error('[Tsek] Could not read workspace snapshots', error);
    return [];
  }
}

const devStorage: WorkspaceStorage = {
  async load() {
    return loadState();
  },

  async save(state) {
    saveState(state);
  },

  flush(state) {
    saveState(state);
  },

  async snapshot(state, reason) {
    try {
      const raw = JSON.stringify(state);
      const entries = readRecords();
      // Repeated opens with no changes should not push real history out.
      if (entries[0] && fingerprint(entries[0].raw) === fingerprint(raw)) return null;
      const record: SnapshotRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        savedAt: new Date().toISOString(),
        reason,
        exams: state.exams.length,
        learners: state.learners.length,
        results: state.results.length,
        bytes: raw.length,
        raw,
      };
      const next = [record, ...entries].slice(0, MAX_SNAPSHOTS);
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify({ version: 1, entries: next }));
      return toMeta(record);
    } catch (error) {
      console.error('[Tsek] Could not write a workspace snapshot', error);
      return null;
    }
  },

  async listSnapshots() {
    return readRecords().map(toMeta);
  },

  async readSnapshot(id) {
    const record = readRecords().find((entry) => entry.id === id);
    if (!record) return null;
    try {
      const parsed = JSON.parse(record.raw) as unknown;
      return validateImportedState(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
};

export const workspaceStorage = devStorage;

/** The first workspace of a fresh install mirrors the old demo start. */
export function firstRunState(): AppState {
  const demo = seedState();
  return {
    ...createEmptyState(),
    exams: [demo.exam],
    learners: demo.learners,
    activeExamId: demo.exam.id,
  };
}
