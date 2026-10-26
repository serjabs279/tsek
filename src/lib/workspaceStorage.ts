import { invoke } from '@tauri-apps/api/core';
import type { AppState } from '../types';
import { isDesktop } from './desktop';
import { createEmptyState, loadState, normalizeState, saveState, validateImportedState } from './storage';

/**
 * Persistence seam. In the desktop build the Rust side writes `workspace.json`
 * and one file per snapshot in the app data folder; in a plain browser (the
 * dev server) it falls back to local storage so the UI can be worked on
 * without rebuilding the shell.
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

/** A snapshot on disk: its metadata plus the whole workspace it captured. */
interface SnapshotFile {
  version: 1;
  savedAt: string;
  reason: SnapshotReason;
  exams: number;
  learners: number;
  results: number;
  bytes: number;
  state: AppState;
}

async function readSnapshotFile(id: string): Promise<SnapshotFile | null> {
  try {
    const raw = await invoke<string | null>('snapshot_read', { id });
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SnapshotFile;
    if (!parsed || parsed.version !== 1 || !isReason(parsed.reason) || !validateImportedState(parsed.state)) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error('[Tsek] Could not read a workspace snapshot', error);
    return null;
  }
}

const tauriStorage: WorkspaceStorage = {
  async load() {
    try {
      const raw = await invoke<string | null>('storage_load');
      if (!raw) return null;
      return normalizeState(JSON.parse(raw) as AppState);
    } catch (error) {
      console.error('[Tsek] Could not read the workspace file', error);
      return null;
    }
  },

  async save(state) {
    try {
      await invoke('storage_save', { raw: JSON.stringify(state) });
    } catch (error) {
      console.error('[Tsek] Could not write the workspace file', error);
    }
  },

  flush(state) {
    // Closing the window may tear the webview down before the promise settles;
    // the debounced save has already written the same state a moment earlier.
    void invoke('storage_save', { raw: JSON.stringify(state) }).catch(() => undefined);
  },

  async snapshot(state, reason) {
    try {
      const raw = JSON.stringify(state);
      const ids = await invoke<string[]>('snapshot_list');
      const latest = ids[0] ? await readSnapshotFile(ids[0]) : null;
      // Repeated opens with no changes should not push real history out.
      if (latest && fingerprint(JSON.stringify(latest.state)) === fingerprint(raw)) return null;

      const file: SnapshotFile = {
        version: 1,
        savedAt: new Date().toISOString(),
        reason,
        exams: state.exams.length,
        learners: state.learners.length,
        results: state.results.length,
        bytes: raw.length,
        state,
      };
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await invoke('snapshot_write', { id, payload: JSON.stringify(file) });
      await invoke('snapshot_prune', { keep: MAX_SNAPSHOTS });
      return {
        id,
        savedAt: file.savedAt,
        reason: file.reason,
        exams: file.exams,
        learners: file.learners,
        results: file.results,
        bytes: file.bytes,
      };
    } catch (error) {
      console.error('[Tsek] Could not write a workspace snapshot', error);
      return null;
    }
  },

  async listSnapshots() {
    try {
      const ids = await invoke<string[]>('snapshot_list');
      const files = await Promise.all(ids.map((id) => readSnapshotFile(id)));
      return files.flatMap((file, index) =>
        file
          ? [
              {
                id: ids[index],
                savedAt: file.savedAt,
                reason: file.reason,
                exams: file.exams,
                learners: file.learners,
                results: file.results,
                bytes: file.bytes,
              },
            ]
          : []
      );
    } catch (error) {
      console.error('[Tsek] Could not list workspace snapshots', error);
      return [];
    }
  },

  async readSnapshot(id) {
    const file = await readSnapshotFile(id);
    return file ? normalizeState(file.state) : null;
  },
};

export const workspaceStorage: WorkspaceStorage = isDesktop ? tauriStorage : devStorage;

/** Full path of the workspace file, for the Settings screen. */
export async function workspaceFilePath(): Promise<string | null> {
  if (!isDesktop) return null;
  try {
    return await invoke<string>('storage_path');
  } catch {
    return null;
  }
}

/**
 * A fresh install starts empty. Demo learners belong behind the "Load demo"
 * button: an installed copy is used for real class records, so it must never
 * open with fabricated names a teacher would have to delete.
 */
export function firstRunState(): AppState {
  return createEmptyState();
}
