import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  FlaskConical,
  HardDrive,
  History,
  Play,
  RotateCcw,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import type { AppState, DepedPolicy, PaperOrientation, PaperSize, SheetsPerPage } from '../types';
import { useApp } from '../store/AppStore';
import { validateImportedState } from '../lib/storage';
import { SNAPSHOT_LABELS, workspaceFilePath, workspaceStorage, type SnapshotMeta } from '../lib/workspaceStorage';
import { readFileAsText } from '../lib/download';
import { downloadWorkspace } from '../lib/exports';
import { seedState } from '../lib/grading';
import { runSelfTest, type SelfTestReport } from '../omr/selftest';
import { Badge, ConfirmDialog, Field, PageHead, Segmented, Spinner } from './ui';

function snapshotTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

export function SettingsView() {
  const { state, activeExam, activeLearners, updateSettings, importWorkspace, resetWorkspace, loadDemoWorkspace, toast } = useApp();
  const [pendingImport, setPendingImport] = useState<AppState | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [selfTest, setSelfTest] = useState<SelfTestReport | null>(null);
  const [testing, setTesting] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [pendingSnapshot, setPendingSnapshot] = useState<SnapshotMeta | null>(null);
  const [workspaceFile, setWorkspaceFile] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void workspaceFilePath().then((path) => {
      if (alive) setWorkspaceFile(path);
    });
    return () => {
      alive = false;
    };
  }, []);

  const refreshSnapshots = useCallback(async () => {
    setSnapshots(await workspaceStorage.listSnapshots());
  }, []);

  useEffect(() => {
    void refreshSnapshots();
  }, [refreshSnapshots]);

  const restoreSnapshot = async (snapshot: SnapshotMeta) => {
    const restored = await workspaceStorage.readSnapshot(snapshot.id);
    if (!restored) {
      toast('That snapshot could not be read.', 'danger');
      return;
    }
    importWorkspace(restored);
    toast('Snapshot restored.', 'success');
    void refreshSnapshots();
  };

  const payloadSize = useMemo(() => {
    const bytes = new Blob([JSON.stringify(state)]).size;
    return bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : `${Math.round(bytes / 1024)} KB`;
  }, [state]);

  const restore = async (file: File | null) => {
    if (!file) return;
    try {
      const raw = await readFileAsText(file);
      const parsed = JSON.parse(raw) as unknown;
      const candidate =
        parsed && typeof parsed === 'object' && 'state' in (parsed as Record<string, unknown>)
          ? (parsed as { state: unknown }).state
          : parsed;
      if (!validateImportedState(candidate)) {
        toast('That file is not a Tsek workspace backup.', 'danger');
        return;
      }
      setPendingImport(candidate);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The backup could not be read.', 'danger');
    }
  };

  const runDiagnostic = async () => {
    const demo = seedState();
    const exam = activeExam ?? demo.exam;
    const learner = activeLearners[0] ?? demo.learners[0];
    setTesting(true);
    setSelfTest(null);
    try {
      const report = await runSelfTest(exam, learner, state.settings.schoolName);
      setSelfTest(report);
      toast(report.pass ? 'Scanner self-test passed.' : 'Self-test found a problem.', report.pass ? 'success' : 'danger');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The self-test could not run.', 'danger');
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <PageHead
        eyebrow="Settings"
        title="Workspace settings."
        subtitle="School details, sheet defaults, backups, and a quick health check of the scanner."
        actions={
          <button className="btn btn--ghost" onClick={() => downloadWorkspace(state)}>
            <Download size={16} /> Back up workspace
          </button>
        }
      />

      <div className="settings-grid">
        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>School</h3>
              <p>Printed at the top of every answer sheet.</p>
            </div>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="School name" wide>
                <input
                  className="input"
                  value={state.settings.schoolName}
                  onChange={(event) => updateSettings({ schoolName: event.target.value })}
                />
              </Field>
              <Field label="School ID">
                <input
                  className="input"
                  value={state.settings.schoolId}
                  onChange={(event) => updateSettings({ schoolId: event.target.value })}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Division">
                <input
                  className="input"
                  value={state.settings.division}
                  onChange={(event) => updateSettings({ division: event.target.value })}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Region">
                <input
                  className="input"
                  value={state.settings.region}
                  onChange={(event) => updateSettings({ region: event.target.value })}
                  placeholder="Optional"
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>New exam defaults</h3>
              <p>Each exam can still override these values.</p>
            </div>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="Default items" hint="Between 20 and 100.">
                <input
                  className="input"
                  type="number"
                  min={20}
                  max={100}
                  value={state.settings.defaultItemCount}
                  onChange={(event) =>
                    updateSettings({ defaultItemCount: Math.max(20, Math.min(100, Number(event.target.value) || 50)) })
                  }
                />
              </Field>
              <Field label="Default choices">
                <Segmented
                  value={String(state.settings.defaultChoiceCount)}
                  options={[
                    { value: '4', label: 'A–D' },
                    { value: '5', label: 'A–E' },
                  ]}
                  onChange={(value) => updateSettings({ defaultChoiceCount: value === '5' ? 5 : 4 })}
                />
              </Field>
              <Field label="Paper size">
                <Segmented
                  value={state.settings.paper}
                  options={[
                    { value: 'FOLIO', label: 'Folio' },
                    { value: 'LEGAL', label: 'Legal' },
                    { value: 'A4', label: 'A4' },
                    { value: 'LETTER', label: 'Letter' },
                  ]}
                  onChange={(value) => updateSettings({ paper: value as PaperSize })}
                />
              </Field>
              <Field label="Orientation">
                <Segmented
                  value={state.settings.orientation}
                  options={[
                    { value: 'portrait', label: 'Portrait' },
                    { value: 'landscape', label: 'Landscape' },
                  ]}
                  onChange={(value) => updateSettings({ orientation: value as PaperOrientation })}
                />
              </Field>
              <Field label="Sheets per page" hint="Two sheets share each page and are cut along the dashed line.">
                <Segmented
                  value={String(state.settings.sheetsPerPage)}
                  options={[
                    { value: '1', label: 'One' },
                    { value: '2', label: 'Two' },
                  ]}
                  onChange={(value) => updateSettings({ sheetsPerPage: (value === '2' ? 2 : 1) as SheetsPerPage })}
                />
              </Field>
              <Field label="Transmutation table">
                <Segmented
                  value={state.settings.depedPolicy}
                  options={[
                    { value: '2015', label: 'DO 8, 2015' },
                    { value: '2027', label: 'MATATAG 2027' },
                  ]}
                  onChange={(value) => updateSettings({ depedPolicy: value as DepedPolicy })}
                />
              </Field>
              <Field label="Passing percentage" wide>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={100}
                  value={state.settings.passingPercent}
                  onChange={(event) =>
                    updateSettings({ passingPercent: Math.max(1, Math.min(100, Number(event.target.value) || 75)) })
                  }
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Workspace data</h3>
              <p>Stored on this device. Snapshots keep the last seven states; download a backup for anything you can’t lose.</p>
            </div>
            <Badge tone="green">Local only</Badge>
          </div>
          <div className="card-body">
            <div className="readiness-list">
              <div className="readiness-row"><span><Database size={15} /> Exams</span><strong>{state.exams.length}</strong></div>
              <div className="readiness-row"><span><HardDrive size={15} /> Learners</span><strong>{state.learners.length}</strong></div>
              <div className="readiness-row"><span><CheckCircle2 size={15} /> Checked sheets</span><strong>{state.results.length}</strong></div>
              <div className="readiness-row"><span><FileJson size={15} /> Stored size</span><strong>{payloadSize}</strong></div>
            </div>
            {workspaceFile && (
              <p className="tiny faint" style={{ marginTop: 10, wordBreak: 'break-all' }}>
                Saved as <strong>workspace.json</strong> — {workspaceFile}
              </p>
            )}
            <div className="mini-list" style={{ marginTop: 14 }}>
              <button className="btn btn--soft btn--block" onClick={() => downloadWorkspace(state)}>
                <Download size={15} /> Download workspace backup
              </button>
              <button className="btn btn--ghost btn--block" onClick={() => fileRef.current?.click()}>
                <UploadCloud size={15} /> Restore from backup
              </button>
              <button className="btn btn--ghost btn--block" onClick={loadDemoWorkspace}>
                <Sparkles size={15} /> Add the demo exam
              </button>
              <button className="btn btn--danger btn--block" onClick={() => setConfirmReset(true)}>
                <RotateCcw size={15} /> Reset the whole workspace
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => {
                  void restore(event.target.files?.[0] ?? null);
                  event.target.value = '';
                }}
              />
            </div>

            <div className="snapshot-block">
              <div className="snapshot-block__head">
                <span><History size={14} /> Snapshots</span>
                <span className="tiny faint">{snapshots.length} saved · up to 7</span>
              </div>
              {snapshots.length === 0 ? (
                <p className="snapshot-empty">
                  A snapshot is kept when the workspace opens and before a structure change, deletion, or restore removes
                  something.
                </p>
              ) : (
                <div className="snapshot-list">
                  {snapshots.map((snapshot) => (
                    <div className="snapshot-row" key={snapshot.id}>
                      <div className="snapshot-row__meta">
                        <strong>{SNAPSHOT_LABELS[snapshot.reason]}</strong>
                        <span>
                          {snapshotTime(snapshot.savedAt)} · {countLabel(snapshot.exams, 'exam')} ·{' '}
                          {countLabel(snapshot.learners, 'learner')} · {countLabel(snapshot.results, 'sheet')}
                        </span>
                      </div>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => setPendingSnapshot(snapshot)}
                        aria-label={`Restore snapshot: ${SNAPSHOT_LABELS[snapshot.reason]}`}
                      >
                        <RotateCcw size={13} /> Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Scanner check</h3>
              <p>
                Verifies the current sheet shape on clean, rotated, and perspective-warped sheets
                {activeExam?.sheetsPerPage === 2 ? ', plus a full two-up page' : ''}.
              </p>
            </div>
            <FlaskConical size={18} className="muted" />
          </div>
          <div className="card-body">
            <p className="small muted">
              Uses {activeExam ? activeExam.code : 'a demo exam'} and {activeLearners[0]?.name ?? 'a demo learner'}.
              Run this after changing paper, orientation, sheets per page, or item count, or if real scans start failing.
            </p>
            <button className="btn btn--soft btn--block" style={{ marginTop: 12 }} onClick={() => void runDiagnostic()} disabled={testing}>
              {testing ? <Spinner size={14} /> : <Play size={14} />}
              {testing ? 'Running three cases…' : 'Run scanner self-test'}
            </button>
            {selfTest && (
              <div style={{ marginTop: 14 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                  <strong className="small">Result</strong>
                  <Badge tone={selfTest.pass ? 'green' : 'rose'}>{selfTest.pass ? 'PASS' : 'FAIL'}</Badge>
                </div>
                {selfTest.cases.map((testCase) => (
                  <div className="self-test-case" key={testCase.name}>
                    <div className="self-test-case__head">
                      <strong>{testCase.name}</strong>
                      <Badge tone={testCase.pass ? 'green' : 'rose'}>{testCase.pass ? 'pass' : 'fail'}</Badge>
                    </div>
                    <p>{testCase.details}</p>
                    {testCase.debugImage && <img src={testCase.debugImage} alt={`${testCase.name} overlay`} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-head">
            <div className="card-head__title">
              <h3>How the paper and the JSON fit together</h3>
              <p>A short map of the workflow, for future-you.</p>
            </div>
          </div>
          <div className="card-body">
            <div className="info-list">
              <div><strong>Identity.</strong> Each sheet QR contains the exam code and the learner's LRN. The scanner reads it and assigns the page without typing.</div>
              <div><strong>Paper.</strong> The default is folio, landscape, two sheets per page. Each sheet is 165 × 216 mm and the pair is cut along the dashed center line. Folio, legal, A4, and letter are all supported, with the sheet content scaling to fit.</div>
              <div><strong>Geometry.</strong> Four black corner squares let the scanner undo skew and camera angle. Bubble positions come from the same layout function used by the PDF generator, so the scan and print always agree.</div>
              <div><strong>Flags, not guesses.</strong> A doubled shade, a close call, a faint mark, or an unreadable QR is flagged for review instead of silently scored.</div>
              <div><strong>Grades.</strong> The import file always carries the raw score and percentage. The DepEd transmutation is optional reporting metadata for the GradeApp's grade field — a receiving system that only needs raw scores can ignore it.</div>
              <div><strong>Backups.</strong> App storage can be cleared by a reset, a cleaning tool, or an uninstall. Download a workspace backup after checking a big batch, and keep the exam JSON with the class record.</div>
            </div>
            <div className="card-note card-note--warn" style={{ marginTop: 14 }}>
              <div className="row" style={{ gap: 8 }}>
                <AlertTriangle size={15} />
                <span>Changing an exam's item count or choice count deletes its checked sheets, because the old bubble positions no longer apply.</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(pendingImport)}
        title="Replace this workspace?"
        message={
          pendingImport ? (
            <>
              The backup contains <strong>{pendingImport.exams.length} exam{pendingImport.exams.length === 1 ? '' : 's'}</strong>, <strong>{pendingImport.learners.length} learners</strong>, and <strong>{pendingImport.results.length} checked sheets</strong>. Everything currently in this workspace will be replaced. Download a backup first if unsure.
            </>
          ) : ''
        }
        confirmLabel="Restore backup"
        danger
        onConfirm={() => {
          if (pendingImport) {
            importWorkspace(pendingImport);
            toast('Workspace restored from backup.', 'success');
          }
        }}
        onClose={() => setPendingImport(null)}
      />

      <ConfirmDialog
        open={confirmReset}
        title="Reset the whole workspace?"
        message={`All ${state.exams.length} exams, ${state.learners.length} learners, and ${state.results.length} checked sheets will be deleted from this device. Snapshots and downloaded backups are the way back.`}
        confirmLabel="Reset everything"
        danger
        onConfirm={() => {
          resetWorkspace();
          toast('Workspace reset.', 'danger');
          void refreshSnapshots();
        }}
        onClose={() => setConfirmReset(false)}
      />

      <ConfirmDialog
        open={Boolean(pendingSnapshot)}
        title="Restore this snapshot?"
        message={
          pendingSnapshot ? (
            <>
              The workspace will be replaced by the snapshot from{' '}
              <strong>{snapshotTime(pendingSnapshot.savedAt)}</strong> —{' '}
              {SNAPSHOT_LABELS[pendingSnapshot.reason].toLowerCase()}. It holds{' '}
              {countLabel(pendingSnapshot.exams, 'exam')}, {countLabel(pendingSnapshot.learners, 'learner')}, and{' '}
              {countLabel(pendingSnapshot.results, 'checked sheet')}. Anything newer is replaced; the current state is kept
              as a snapshot first when it differs.
            </>
          ) : ''
        }
        confirmLabel="Restore snapshot"
        danger
        onConfirm={() => {
          if (pendingSnapshot) void restoreSnapshot(pendingSnapshot);
        }}
        onClose={() => setPendingSnapshot(null)}
      />
    </>
  );
}
