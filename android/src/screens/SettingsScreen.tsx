import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Database,
  Download,
  FlaskConical,
  HardDrive,
  History,
  RotateCcw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { useApp } from '@shared/store/AppStore';
import {
  SNAPSHOT_LABELS,
  workspaceFilePath,
  workspaceStorage,
  type SnapshotMeta,
} from '@shared/lib/workspaceStorage';
import { buildWorkspaceBackup, downloadWorkspace, workspaceBackupFilename } from '@shared/lib/exports';
import { parseWorkspaceBackup } from '@shared/lib/storage';
import { isDesktop } from '@shared/lib/desktop';
import type { AppState } from '@shared/types';
import { FieldBlock, ScreenHead, TypeToConfirm } from '../components/Common';

function when(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { state, updateSettings, importWorkspace, resetWorkspace, loadDemoWorkspace, toast } = useApp();
  const [path, setPath] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<AppState | null>(null);
  const [pendingSnapshot, setPendingSnapshot] = useState<{ meta: SnapshotMeta; state: AppState } | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [snapshotsBusy, setSnapshotsBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refreshSnapshots = async () => {
    setSnapshotsBusy(true);
    try {
      setSnapshots(await workspaceStorage.listSnapshots());
    } finally {
      setSnapshotsBusy(false);
    }
  };

  useEffect(() => {
    let live = true;
    void workspaceFilePath().then((value) => {
      if (live) setPath(value);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    void refreshSnapshots();
  }, []);

  const chooseSnapshot = async (meta: SnapshotMeta) => {
    const restored = await workspaceStorage.readSnapshot(meta.id);
    if (!restored) {
      toast('That snapshot could not be read. It may have been pruned.', 'danger');
      return;
    }
    setPendingSnapshot({ meta, state: restored });
  };

  const exportBackup = async () => {
    setBackupBusy(true);
    try {
      if (!isDesktop) {
        downloadWorkspace(state);
        toast('Backup downloaded.', 'success');
        return;
      }
      const target = await save({
        defaultPath: workspaceBackupFilename(),
        filters: [{ name: 'Tsek workspace', extensions: ['json'] }],
      });
      if (!target) return;
      await writeTextFile(target, buildWorkspaceBackup(state));
      toast('Backup saved.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The backup could not be saved.', 'danger');
    } finally {
      setBackupBusy(false);
    }
  };

  const acceptBackup = (raw: string) => {
    const restored = parseWorkspaceBackup(raw);
    if (!restored) {
      toast('That file is not a Tsek workspace backup.', 'danger');
      return;
    }
    setPendingRestore(restored);
  };

  const pickBackup = async () => {
    if (!isDesktop) {
      fileInput.current?.click();
      return;
    }
    setBackupBusy(true);
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'Tsek workspace', extensions: ['json'] }],
      });
      if (!picked || Array.isArray(picked)) return;
      acceptBackup(await readTextFile(picked));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The backup could not be opened.', 'danger');
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreFromBrowser = async (file: File | null) => {
    if (!file) return;
    try {
      acceptBackup(await file.text());
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The backup could not be read.', 'danger');
    }
  };

  return (
    <>
      <div className="m-row" style={{ marginBottom: 10 }}>
        <button className="m-iconbtn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <span className="m-tiny">Back to exams</span>
      </div>

      <ScreenHead
        eyebrow="Settings"
        title="This tablet"
        subtitle="Everything is stored locally; the workspace file is plain JSON."
      />

      <div className="m-stack">
        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>School details</h2>
              <p>Used on every sheet and report saved from this tablet.</p>
            </div>
          </div>
          <div className="m-card__body">
            <div className="m-form">
              <FieldBlock label="School name" wide>
                <input
                  className="input"
                  value={state.settings.schoolName}
                  onChange={(event) => updateSettings({ schoolName: event.target.value })}
                />
              </FieldBlock>
              <FieldBlock label="School ID">
                <input
                  className="input"
                  value={state.settings.schoolId}
                  onChange={(event) => updateSettings({ schoolId: event.target.value })}
                />
              </FieldBlock>
              <FieldBlock label="Division">
                <input
                  className="input"
                  value={state.settings.division}
                  onChange={(event) => updateSettings({ division: event.target.value })}
                />
              </FieldBlock>
              <FieldBlock label="Region">
                <input
                  className="input"
                  value={state.settings.region}
                  onChange={(event) => updateSettings({ region: event.target.value })}
                />
              </FieldBlock>
            </div>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>New exam defaults</h2>
              <p>These apply when you create an exam on this tablet.</p>
            </div>
          </div>
          <div className="m-card__body">
            <div className="m-form">
              <FieldBlock label="Items">
                <input
                  className="input"
                  type="number"
                  min={20}
                  max={100}
                  value={state.settings.defaultItemCount}
                  onChange={(event) =>
                    updateSettings({
                      defaultItemCount: Math.max(20, Math.min(100, Math.round(Number(event.target.value) || 50))),
                    })
                  }
                />
              </FieldBlock>
              <FieldBlock label="Choices">
                <select
                  className="select"
                  value={String(state.settings.defaultChoiceCount)}
                  onChange={(event) => updateSettings({ defaultChoiceCount: event.target.value === '5' ? 5 : 4 })}
                >
                  <option value="4">A–D</option>
                  <option value="5">A–E</option>
                </select>
              </FieldBlock>
              <FieldBlock label="Passing percentage">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={100}
                  value={state.settings.passingPercent}
                  onChange={(event) =>
                    updateSettings({ passingPercent: Math.max(1, Math.min(100, Math.round(Number(event.target.value) || 75))) })
                  }
                />
              </FieldBlock>
            </div>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Storage</h2>
              <p>The workspace survives app updates and cache clears.</p>
            </div>
            <HardDrive size={19} className="muted" />
          </div>
          <div className="m-card__body">
            <div className="m-note" style={{ wordBreak: 'break-all', fontFamily: 'var(--mono)', fontSize: '0.7rem' }}>
              {path ?? (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
                ? 'Reading the workspace path…'
                : 'Browser preview: saved in local storage. The installed Android app uses a JSON file.')}
            </div>
            <div className="m-row" style={{ marginTop: 10 }}>
              <span className="m-chip"><Database size={13} /> {state.exams.length} exams</span>
              <span className="m-chip"><Database size={13} /> {state.learners.length} learners</span>
              <span className="m-chip"><Database size={13} /> {state.results.length} results</span>
            </div>
            <div className="m-row" style={{ marginTop: 12 }}>
              <ShieldCheck size={15} className="muted" />
              <span className="m-tiny">No uploads, no account, no network calls.</span>
            </div>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Backup</h2>
              <p>Save the whole workspace as one file, or load one from a computer or another tablet.</p>
            </div>
            <ShieldCheck size={19} className="muted" />
          </div>
          <div className="m-card__body">
            <div className="m-row" style={{ gap: 8 }}>
              <button
                className="btn btn--soft"
                style={{ flex: 1 }}
                onClick={() => void exportBackup()}
                disabled={backupBusy}
              >
                <Download size={16} /> Export backup
              </button>
              <button
                className="btn btn--soft"
                style={{ flex: 1 }}
                onClick={() => void pickBackup()}
                disabled={backupBusy}
              >
                <Upload size={16} /> Import backup
              </button>
            </div>
            <p className="m-tiny" style={{ marginBottom: 0 }}>
              The file holds every exam, learner, and result as plain JSON. Importing replaces what
              is on this tablet, so export first if you are unsure. Backups from the desktop app
              open here, and files exported here open on the desktop.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                event.target.value = '';
                void restoreFromBrowser(file);
              }}
            />
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Snapshots</h2>
              <p>Copies kept before a reset, an import, a structure change, or a deletion. Restore one here if something goes wrong.</p>
            </div>
            <History size={19} className="muted" />
          </div>
          <div className="m-card__body" style={{ paddingTop: 4 }}>
            {snapshots.length === 0 ? (
              <div className="m-note">
                {snapshotsBusy
                  ? 'Reading snapshots…'
                  : 'No snapshots yet. One is written the first time the workspace is reset, replaced, or a part is restructured.'}
              </div>
            ) : (
              snapshots.map((meta) => (
                <div className="m-person" key={meta.id}>
                  <div className="m-person__main">
                    <div className="m-person__name">{SNAPSHOT_LABELS[meta.reason]}</div>
                    <div className="m-person__meta">
                      {when(meta.savedAt)} · {meta.exams} exam{meta.exams === 1 ? '' : 's'} ·{' '}
                      {meta.learners} learner{meta.learners === 1 ? '' : 's'} · {meta.results} result
                      {meta.results === 1 ? '' : 's'}
                    </div>
                  </div>
                  <button className="btn btn--soft btn--sm" onClick={() => void chooseSnapshot(meta)}>
                    Restore
                  </button>
                </div>
              ))
            )}
            <div className="m-row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
              <span className="m-tiny">Only the seven newest copies are kept.</span>
              <button className="btn btn--ghost btn--sm" onClick={() => void refreshSnapshots()} disabled={snapshotsBusy}>
                Refresh
              </button>
            </div>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Testing</h2>
              <p>Add a sample exam with learners and a filled answer key.</p>
            </div>
            <FlaskConical size={19} className="muted" />
          </div>
          <div className="m-card__body">
            <button
              className="btn btn--soft btn--block"
              onClick={() => {
                loadDemoWorkspace();
                toast('Sample exam added. Open it from the exam list.', 'success');
              }}
            >
              <FlaskConical size={16} /> Add a sample exam
            </button>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Reset this tablet</h2>
              <p>Removes every exam, learner, and result from this device only.</p>
            </div>
          </div>
          <div className="m-card__body">
            <button className="btn btn--danger btn--block" onClick={() => setConfirmReset(true)}>
              <RotateCcw size={16} /> Reset workspace
            </button>
            <p className="m-tiny" style={{ marginBottom: 0 }}>
              Export a backup first if the record matters. A snapshot is also kept before the reset
              and appears under Snapshots above, so this can be undone on the tablet itself.
            </p>
          </div>
        </section>

        <div className="m-note">
          <strong>Tsek for Android</strong> shares its scoring, item analysis, and OMR engine with
          the desktop app, and works as a complete exam checker on its own. Answer sheets, written
          pages, and reports save as PDF through Android's own file picker; backup files move
          between both apps.
        </div>

        <div className="m-row" style={{ justifyContent: 'center', paddingBottom: 10 }}>
          <span className="m-tiny">Developed by ZX TechLabs · Richmond C. Jabla</span>
        </div>
      </div>

      <TypeToConfirm
        open={confirmReset}
        title="Reset the whole workspace?"
        message="Every exam, roster, and checked sheet on this tablet is removed. A snapshot of the current workspace is kept first, so it can still be restored from the Snapshots card."
        phrase="RESET"
        confirmLabel="Reset workspace"
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          resetWorkspace();
          toast('Workspace reset. The previous copy is in Snapshots.', 'danger');
          void refreshSnapshots();
        }}
      />

      <TypeToConfirm
        open={pendingRestore !== null}
        title="Replace this tablet's workspace?"
        message={
          pendingRestore
            ? `The backup holds ${pendingRestore.exams.length} exam${pendingRestore.exams.length === 1 ? '' : 's'}, ${pendingRestore.learners.length} learner${pendingRestore.learners.length === 1 ? '' : 's'} and ${pendingRestore.results.length} result${pendingRestore.results.length === 1 ? '' : 's'}. Everything on this tablet is replaced; a snapshot of the current workspace is kept first.`
            : ''
        }
        phrase="RESTORE"
        confirmLabel="Restore backup"
        onClose={() => setPendingRestore(null)}
        onConfirm={() => {
          if (pendingRestore) {
            importWorkspace(pendingRestore);
            toast('Backup restored.', 'success');
            void refreshSnapshots();
          }
          setPendingRestore(null);
        }}
      />

      <TypeToConfirm
        open={pendingSnapshot !== null}
        title="Restore this snapshot?"
        message={
          pendingSnapshot
            ? `The copy from ${when(pendingSnapshot.meta.savedAt)} holds ${pendingSnapshot.state.exams.length} exam${pendingSnapshot.state.exams.length === 1 ? '' : 's'}, ${pendingSnapshot.state.learners.length} learner${pendingSnapshot.state.learners.length === 1 ? '' : 's'} and ${pendingSnapshot.state.results.length} result${pendingSnapshot.state.results.length === 1 ? '' : 's'}. Everything currently on this tablet is replaced; a snapshot of the current workspace is kept first.`
            : ''
        }
        phrase="RESTORE"
        confirmLabel="Restore snapshot"
        onClose={() => setPendingSnapshot(null)}
        onConfirm={() => {
          if (pendingSnapshot) {
            importWorkspace(pendingSnapshot.state);
            toast('Workspace restored from the snapshot.', 'success');
            void refreshSnapshots();
          }
          setPendingSnapshot(null);
        }}
      />
    </>
  );
}
