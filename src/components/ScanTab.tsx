import { useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  FlaskConical,
  Image as ImageIcon,
  Play,
  ScanLine,
  Sparkles,
  Trash2,
  UploadCloud,
  Users,
} from 'lucide-react';
import type { Exam, OmrReadResult, ScanProgress } from '../types';
import { useApp } from '../store/AppStore';
import { scanFile } from '../omr/scanner';
import { runSelfTest, type SelfTestReport } from '../omr/selftest';
import { makeScanResult } from '../lib/results';
import { objectiveScore } from '../lib/scoring';
import { scannableItems } from '../lib/sections';
import { Badge, EmptyState, ProgressBar, Spinner } from './ui';
import type { WorkspaceTab } from './ExamWorkspace';

interface StagedScan {
  key: string;
  filename: string;
  pageNumber: number;
  totalPages: number;
  /** Which half of a two-up page this sheet came from. */
  region?: 'left' | 'right' | 'top' | 'bottom';
  read: OmrReadResult;
  saved: boolean;
  savedNote: string;
  assignedLrn: string | null;
  error?: string;
}

const REGION_LABEL: Record<NonNullable<StagedScan['region']>, string> = {
  left: 'left sheet',
  right: 'right sheet',
  top: 'top sheet',
  bottom: 'bottom sheet',
};

export function ScanTab({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: WorkspaceTab) => void }) {
  const { state, saveResult, loadDemoResults, toast } = useApp();
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);

  const [staged, setStaged] = useState<StagedScan[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [selfTest, setSelfTest] = useState<SelfTestReport | null>(null);
  const [testing, setTesting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const savedCount = staged.filter((item) => item.saved).length;
  const reviewCount = staged.filter((item) => !item.saved).length;
  const scannedCount = scannableItems(exam).length;

  const scoreOf = (answers: (string | null)[]) => objectiveScore(exam, answers);

  const persist = (read: OmrReadResult, learnerLrn: string, filename: string, pageNumber: number) => {
    const learner = learners.find((item) => item.lrn === learnerLrn);
    if (!learner) return { saved: false, note: 'Learner not found' };
    const result = makeScanResult(exam, learner, read.answers, {
      flags: read.flags,
      qrOk: read.qrOk,
      sourceFile: filename,
      pageNumber,
      confidence: read.confidence,
      markerCount: read.markerCount,
      rotation: read.rotation,
    });
    const { replaced } = saveResult(result);
    return { saved: true, note: replaced ? 'Replaced an earlier scan' : 'Saved' };
  };

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (learners.length === 0) {
      toast('Add the class roster before scanning.', 'danger');
      return;
    }
    setBusy(true);
    setProgress({ phase: 'reading', message: 'Preparing the batch…', percent: 2 });
    let savedNow = 0;
    let reviewNow = 0;

    for (const file of files) {
      try {
        const pages = await scanFile(file, exam, setProgress);
        const nextItems: StagedScan[] = [];
        pages.forEach((page) => {
          const read = page.result;
          const learner = read.lrn ? learners.find((item) => item.lrn === read.lrn) ?? null : null;
          // Never auto-save a sheet with nothing detected: that is how a bad
          // scan turns into a silent zero. Such sheets stay in review, where
          // the warning and overlay are visible.
          const hasAnswers = read.answers.some(Boolean);
          const canAutoSave = Boolean(read.qrOk && learner && !page.error && hasAnswers);
          let saved = false;
          let note = '';
          if (canAutoSave && learner) {
            const outcome = persist(read, learner.lrn, file.name, page.pageNumber);
            saved = outcome.saved;
            note = outcome.note;
            if (saved) savedNow += 1;
            else reviewNow += 1;
          } else {
            reviewNow += 1;
          }
          nextItems.push({
            key: `${file.name}-${page.pageNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            filename: file.name,
            pageNumber: page.pageNumber,
            totalPages: page.totalPages,
            region: page.region,
            read,
            saved,
            savedNote: note,
            assignedLrn: learner?.lrn ?? (read.lrn && !learner ? null : null),
            error: page.error,
          });
        });
        setStaged((prev) => [...prev, ...nextItems]);
      } catch (error) {
        reviewNow += 1;
        setStaged((prev) => [
          ...prev,
          {
            key: `${file.name}-error-${Date.now()}`,
            filename: file.name,
            pageNumber: 1,
            totalPages: 1,
            read: {
              qrPayload: null,
              examCode: null,
              lrn: null,
              rotation: 0,
              answers: Array.from({ length: exam.itemCount }, () => null),
              flags: [],
              markerCount: 0,
              qrOk: false,
              confidence: 0,
              debugImage: '',
              warnings: [],
            },
            saved: false,
            savedNote: '',
            assignedLrn: null,
            error: error instanceof Error ? error.message : 'The file could not be read.',
          },
        ]);
      }
    }

    setProgress({ phase: 'done', message: 'Batch finished.', percent: 100 });
    setBusy(false);
    toast(
      `${savedNow} sheet${savedNow === 1 ? '' : 's'} saved automatically${reviewNow ? ` · ${reviewNow} need assignment or review` : ''}.`,
      reviewNow ? 'default' : 'success'
    );
  };

  const assign = (item: StagedScan, lrn: string) => {
    setStaged((prev) => prev.map((entry) => (entry.key === item.key ? { ...entry, assignedLrn: lrn } : entry)));
  };

  const saveAssigned = (item: StagedScan) => {
    if (!item.assignedLrn) {
      toast('Choose the learner this sheet belongs to.', 'danger');
      return;
    }
    const outcome = persist(item.read, item.assignedLrn, item.filename, item.pageNumber);
    if (!outcome.saved) {
      toast(outcome.note, 'danger');
      return;
    }
    setStaged((prev) =>
      prev.map((entry) =>
        entry.key === item.key ? { ...entry, saved: true, savedNote: outcome.note } : entry
      )
    );
    toast(outcome.note === 'Saved' ? 'Sheet saved to results.' : 'Sheet saved and replaced the earlier scan.', 'success');
  };

  const remove = (item: StagedScan) => {
    setStaged((prev) => prev.filter((entry) => entry.key !== item.key));
  };

  const runDiagnostic = async () => {
    if (!learners[0]) {
      toast('Add at least one learner to run the scanner self-test.', 'danger');
      return;
    }
    setTesting(true);
    setSelfTest(null);
    try {
      const report = await runSelfTest(exam, learners[0], state.settings.schoolName);
      setSelfTest(report);
      toast(report.pass ? `Scanner self-test passed all ${report.cases.length} checks.` : 'Scanner self-test found a problem.', report.pass ? 'success' : 'danger');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The self-test could not run.', 'danger');
    } finally {
      setTesting(false);
    }
  };

  if (learners.length === 0) {
    return (
      <EmptyState
        icon={<Users size={26} />}
        title="Add the roster first"
        message="The scanner identifies each sheet by the LRN in its QR code, so the class list must exist before scanning."
        action={<button className="btn btn--primary" onClick={() => onNavigate('roster')}>Open roster</button>}
      />
    );
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div className="card-head__title">
            <h3>Scan a batch</h3>
            <p>
              Drop the PDF from your document scanner, or individual page photos. Every page is read automatically
              {exam.sheetsPerPage === 2 ? ' — a two-up page is split into its two sheets.' : '.'}
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Badge tone="neutral">{results.length}/{learners.length} checked</Badge>
            <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('results')}>
              Results <ArrowRight size={13} />
            </button>
          </div>
        </div>
        <div className="card-body">
          <div
            className={`dropzone ${drag ? 'is-drag' : ''} ${busy ? 'is-busy' : ''}`}
            onClick={() => {
              if (!busy) inputRef.current?.click();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (!busy) setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDrag(false);
              if (!busy) void handleFiles(Array.from(event.dataTransfer.files));
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
            }}
          >
            <div className="dropzone__icon">
              {busy ? <Spinner size={24} /> : <UploadCloud size={24} />}
            </div>
            <h3>{busy ? 'Reading the sheets…' : 'Drop scanned sheets here'}</h3>
            <p>
              {exam.sheetsPerPage === 2
                ? `PDF or JPG/PNG pages. A full ${exam.orientation} page can hold two learners — both are read in one pass.`
                : 'PDF (one page per learner) or JPG/PNG pages. Multiple files are allowed.'}
            </p>
            <span className="dropzone__hint">
              {exam.sheetsPerPage === 2
                ? 'Scan the whole page or the cut halves · the QR assigns each sheet automatically'
                : 'The sheet QR assigns each result automatically · corner marks correct the perspective'}
            </span>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(event) => {
                void handleFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
          </div>

          {progress && (busy || progress.phase === 'done') && (
            <div className="scan-progress">
              <div className="scan-progress__head">
                <span className="scan-progress__msg">
                  {busy ? <Spinner size={14} /> : <CheckCircle2 size={15} color="var(--green)" />}
                  {progress.message}
                  {progress.page && progress.totalPages ? ` · page ${progress.page} of ${progress.totalPages}` : ''}
                </span>
                <strong>{progress.percent ?? 0}%</strong>
              </div>
              <ProgressBar value={progress.percent ?? 0} tone={busy ? 'accent' : 'green'} />
            </div>
          )}

          {staged.length > 0 && (
            <div className="row row--wrap" style={{ marginTop: 14, justifyContent: 'space-between' }}>
              <span className="small muted">
                <strong>{savedCount}</strong> saved · <strong>{reviewCount}</strong> waiting for assignment
              </span>
              <button className="btn btn--ghost btn--sm" onClick={() => setStaged([])}>
                Clear this batch list
              </button>
            </div>
          )}

          {results.length === 0 && !busy && (
            <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
              <button className="btn btn--ghost btn--sm" onClick={() => { loadDemoResults(exam.id); toast('Demo results loaded. These are not real scans.', 'default'); }}>
                <Sparkles size={14} /> Load demo results to explore
              </button>
            </div>
          )}
        </div>
      </section>

      {staged.length > 0 && (
        <div className="scan-batch-list">
          {staged.map((item) => {
            const scanned = scoreOf(item.read.answers);
            const percent = scanned.possible ? Math.round((scanned.earned / scanned.possible) * 100) : 0;
            return (
              <article className={`scan-result ${item.saved ? '' : 'is-review'}`} key={item.key}>
                <div className="scan-result__thumb">
                  {item.read.debugImage ? (
                    <img src={item.read.debugImage} alt={`Scan overlay for ${item.filename}`} />
                  ) : (
                    <div className="scan-result__thumb-empty">
                      <FileText size={20} />
                      <span>No preview</span>
                    </div>
                  )}
                </div>
                <div className="scan-result__body">
                  <div className="scan-result__top">
                    <div>
                      <div className="scan-result__name">
                        {item.read.lrn && learners.find((learner) => learner.lrn === item.read.lrn)?.name
                          ? learners.find((learner) => learner.lrn === item.read.lrn)?.name
                          : item.assignedLrn
                            ? learners.find((learner) => learner.lrn === item.assignedLrn)?.name
                            : 'Unassigned sheet'}
                      </div>
                      <div className="scan-result__lrn">
                        {item.read.lrn ? `QR LRN ${item.read.lrn}` : 'QR not readable'} · {item.filename} · page {item.pageNumber}
                        {item.totalPages > 1 ? ` of ${item.totalPages}` : ''}
                        {item.region ? ` · ${REGION_LABEL[item.region]}` : ''}
                      </div>
                    </div>
                    {item.saved ? (
                      <Badge tone="green"><CheckCircle2 size={12} /> {item.savedNote || 'Saved'}</Badge>
                    ) : (
                      <Badge tone="amber"><AlertTriangle size={12} /> Needs review</Badge>
                    )}
                  </div>

                  <div className="scan-result__stats">
                    <span><strong>{scanned.correct}</strong> / {scannedCount} correct</span>
                    <span><strong>{percent}%</strong> <span className="tiny faint">of scanned points</span></span>
                    <span>{item.read.markerCount}/4 corner marks</span>
                    <span>QR {item.read.qrOk ? 'matched' : 'not matched'}</span>
                    <span>confidence {Math.round(item.read.confidence * 100)}%</span>
                    {item.read.rotation !== 0 && <span>rotated {item.read.rotation}°</span>}
                  </div>

                  {item.read.flags.length > 0 && (
                    <div className="scan-flags">
                      {item.read.flags.slice(0, 14).map((flag) => (
                        <span className="flag-chip" key={flag.item}>
                          #{flag.item} {flag.multiple ? 'double' : flag.ambiguous ? 'close' : 'faint'}
                        </span>
                      ))}
                      {item.read.flags.length > 14 && <span className="flag-chip">+{item.read.flags.length - 14} more</span>}
                    </div>
                  )}

                  {(item.error || item.read.warnings.length > 0) && (
                    <div className="scan-result__warnings">
                      {item.error && <div>{item.error}</div>}
                      {item.read.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                    </div>
                  )}

                  {!item.saved && (
                    <div className="scan-result__actions">
                      <div className="scan-result__assign">
                        <select
                          className="select"
                          value={item.assignedLrn ?? ''}
                          onChange={(event) => assign(item, event.target.value)}
                        >
                          <option value="">Assign this sheet to…</option>
                          {learners.map((learner) => (
                            <option key={learner.id} value={learner.lrn}>
                              {learner.name} · {learner.lrn}
                            </option>
                          ))}
                        </select>
                        <button className="btn btn--primary btn--sm" onClick={() => saveAssigned(item)} disabled={!item.assignedLrn}>
                          Save result
                        </button>
                      </div>
                      <button className="btn btn--ghost btn--sm" onClick={() => remove(item)}>
                        <Trash2 size={13} /> Discard
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="self-test-panel">
        <div className="self-test-panel__copy">
          <div className="self-test-panel__icon"><FlaskConical size={18} /></div>
          <div>
            <h4>Scanner check</h4>
            <p>
              Renders this sheet shape clean, rotated, and photographed at an angle with noise
              {exam.sheetsPerPage === 2 ? ', plus a full two-up page' : ''} — then verifies the LRN,
              corner marks, and all {exam.itemCount} scanned answers.
            </p>
          </div>
        </div>
        <button className="btn btn--soft btn--sm" onClick={() => void runDiagnostic()} disabled={testing}>
          {testing ? <Spinner size={14} /> : <Play size={14} />}
          {testing ? 'Running…' : 'Run self-test'}
        </button>
      </section>

      {selfTest && (
        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>{selfTest.pass ? 'Self-test passed' : 'Self-test found a problem'}</h3>
              <p>These checks run entirely in the browser on synthetic sheets.</p>
            </div>
            <Badge tone={selfTest.pass ? 'green' : 'rose'}>{selfTest.pass ? 'PASS' : 'FAIL'}</Badge>
          </div>
          <div className="card-body">
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
        </section>
      )}

      <div className="row" style={{ justifyContent: 'center' }}>
        <span className="tiny faint">
          <ImageIcon size={12} /> Scans are processed on this device. Nothing is uploaded.
          <button className="btn btn--ghost btn--sm" style={{ marginLeft: 8 }} onClick={() => fileRef.current?.click()}>
            <ScanLine size={13} /> Add more sheets
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(event) => {
              void handleFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
        </span>
      </div>
    </div>
  );
}
