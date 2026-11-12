import { useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  FlaskConical,
  ImagePlus,
  ScanLine,
  Trash2,
} from 'lucide-react';
import type { Exam, OmrReadResult, ScanProgress } from '@shared/types';
import { useApp } from '@shared/store/AppStore';
import { scanFile } from '@shared/omr/scanner';
import { runSelfTest, type SelfTestReport } from '@shared/omr/selftest';
import { makeScanResult } from '@shared/lib/results';
import { objectiveScore } from '@shared/lib/scoring';
import { scannableItems } from '@shared/lib/sections';
import { Badge, ProgressBar, Spinner } from '@shared/components/ui';
import { ScreenHead } from '../components/Common';
import type { ExamTab } from '../MobileApp';

interface StagedScan {
  key: string;
  filename: string;
  pageNumber: number;
  totalPages: number;
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

const EMPTY_READ: OmrReadResult = {
  qrPayload: null,
  examCode: null,
  lrn: null,
  rotation: 0,
  answers: [],
  flags: [],
  markerCount: 0,
  qrOk: false,
  confidence: 0,
  debugImage: '',
  warnings: [],
};

export function ScanScreen({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: ExamTab) => void }) {
  const { state, saveResult, toast } = useApp();
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);

  const [staged, setStaged] = useState<StagedScan[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [selfTest, setSelfTest] = useState<SelfTestReport | null>(null);
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const scannedCount = scannableItems(exam).length;
  const keyFilled = exam.answerKey.filter(Boolean).length;
  const savedNow = staged.filter((item) => item.saved).length;
  const unsaved = staged.filter((item) => !item.saved).length;

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
    if (scannedCount === 0) {
      toast('This exam has no scanned parts. Add one in Setup first.', 'danger');
      return;
    }
    setBusy(true);
    setProgress({ phase: 'reading', message: 'Preparing the batch…', percent: 2 });
    let savedCount = 0;
    let reviewCount = 0;

    for (const file of files) {
      try {
        const pages = await scanFile(file, exam, setProgress);
        const nextItems: StagedScan[] = [];
        pages.forEach((page) => {
          const read = page.result;
          const learner = read.lrn ? learners.find((item) => item.lrn === read.lrn) ?? null : null;
          const hasAnswers = read.answers.some(Boolean);
          const canAutoSave = Boolean(read.qrOk && learner && !page.error && hasAnswers);
          let saved = false;
          let note = '';
          if (canAutoSave && learner) {
            const outcome = persist(read, learner.lrn, file.name, page.pageNumber);
            saved = outcome.saved;
            note = outcome.note;
            if (saved) savedCount += 1;
            else reviewCount += 1;
          } else {
            reviewCount += 1;
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
            assignedLrn: learner?.lrn ?? null,
            error: page.error,
          });
        });
        setStaged((prev) => [...prev, ...nextItems]);
      } catch (error) {
        reviewCount += 1;
        setStaged((prev) => [
          ...prev,
          {
            key: `${file.name}-error-${Date.now()}`,
            filename: file.name,
            pageNumber: 1,
            totalPages: 1,
            read: { ...EMPTY_READ, answers: Array.from({ length: exam.itemCount }, () => null) },
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
      `${savedCount} sheet${savedCount === 1 ? '' : 's'} saved automatically${reviewCount ? ` · ${reviewCount} need assignment or review` : ''}.`,
      reviewCount ? 'default' : 'success'
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
      prev.map((entry) => (entry.key === item.key ? { ...entry, saved: true, savedNote: outcome.note } : entry))
    );
    toast(`${item.filename} saved.`, 'success');
  };

  const removeStaged = (item: StagedScan) => {
    setStaged((prev) => prev.filter((entry) => entry.key !== item.key));
  };

  const testScanner = async () => {
    const learner = learners[0];
    if (!learner) {
      toast('Add at least one learner before running the scanner test.', 'danger');
      return;
    }
    setTesting(true);
    setSelfTest(null);
    try {
      const report = await runSelfTest(exam, learner, state.settings.schoolName);
      setSelfTest(report);
      toast(
        report.pass ? 'Scanner self-test passed on this device.' : 'Scanner self-test found a mismatch; see the cases below.',
        report.pass ? 'success' : 'danger'
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The self-test could not run.', 'danger');
    } finally {
      setTesting(false);
    }
  };

  const scoreOf = (answers: (string | null)[]) => objectiveScore(exam, answers);

  return (
    <>
      <ScreenHead
        eyebrow={`${exam.code} · Scan`}
        title="Scan answer sheets"
        subtitle={`${scannedCount} scanned items · ${keyFilled} key answers · ${results.length} sheets checked`}
      />

      <div className="m-stack">
        {learners.length === 0 && (
          <div className="m-note m-note--warn">
            <strong>Add the roster first.</strong> A sheet is matched by the LRN in its QR; without
            a roster the paper can be read but not credited to a learner.
            <div style={{ marginTop: 8 }}>
              <button className="btn btn--soft btn--sm" onClick={() => onNavigate('roster')}>
                Open roster <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}
        {keyFilled === 0 && scannedCount > 0 && (
          <div className="m-note m-note--warn">
            The answer key is empty, so every sheet will score zero. Fill the key first.
            <div style={{ marginTop: 8 }}>
              <button className="btn btn--soft btn--sm" onClick={() => onNavigate('key')}>
                Open answer key <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Add sheets</h2>
              <p>Photograph one sheet per image, or import photos and PDFs from the tablet.</p>
            </div>
            <ScanLine size={19} className="muted" />
          </div>
          <div className="m-card__body">
            <div className="m-stack">
              <button className="m-bigbtn m-bigbtn--accent" onClick={() => cameraRef.current?.click()} disabled={busy}>
                <span className="m-bigbtn__icon"><Camera size={20} /></span>
                <span style={{ flex: 1 }}>
                  <strong>Take a photo</strong>
                  <span>Opens the camera; one paper per shot fills the frame best.</span>
                </span>
                <ArrowRight size={16} />
              </button>
              <button className="m-bigbtn" onClick={() => fileRef.current?.click()} disabled={busy}>
                <span className="m-bigbtn__icon"><ImagePlus size={20} /></span>
                <span style={{ flex: 1 }}>
                  <strong>Import photos or PDFs</strong>
                  <span>Choose several files at once; a PDF can hold many pages.</span>
                </span>
                <ArrowRight size={16} />
              </button>
            </div>

            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(event) => {
                void handleFiles([...(event.target.files ?? [])]);
                event.target.value = '';
              }}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf,.pdf"
              multiple
              hidden
              onChange={(event) => {
                void handleFiles([...(event.target.files ?? [])]);
                event.target.value = '';
              }}
            />

            {busy && progress && (
              <div className="m-progresswrap" style={{ marginTop: 14 }}>
                <div className="m-row m-row--between">
                  <span className="m-tiny" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Spinner size={14} /> {progress.message}
                  </span>
                  <span className="m-tiny">{progress.percent ?? 0}%</span>
                </div>
                <ProgressBar value={progress.percent ?? 0} />
              </div>
            )}

            <div className="m-note" style={{ marginTop: 12 }}>
              Lay the paper flat, fill the frame, and avoid shadows. The scanner reads the QR for
              the learner, finds the four corner marks, then samples each bubble. A sheet with no
              detected answers is never saved automatically; it stays below for review.
            </div>
          </div>
        </section>

        {staged.length > 0 && (
          <section className="m-card">
            <div className="m-card__head">
              <div>
                <h2>This batch</h2>
                <p>{savedNow} saved · {unsaved} waiting</p>
              </div>
              <Badge tone={unsaved ? 'amber' : 'green'}>{savedNow}/{staged.length}</Badge>
            </div>
            <div className="m-card__body">
              {staged.map((item) => {
                const learner = learners.find((entry) => entry.lrn === item.assignedLrn) ?? null;
                const answered = item.read.answers.filter(Boolean).length;
                const score = scoreOf(item.read.answers);
                const flags = item.read.flags.length;
                return (
                  <article className="m-stage" key={item.key}>
                    <div className="m-stage__head">
                      <div style={{ minWidth: 0 }}>
                        <div className="m-stage__file">{item.filename}</div>
                        <div className="m-stage__meta">
                          <span>Page {item.pageNumber}/{item.totalPages}</span>
                          {item.region && <span>{REGION_LABEL[item.region]}</span>}
                          <span>{item.read.qrOk ? 'QR read' : 'QR missing'}</span>
                          <span>{item.read.markerCount}/4 marks</span>
                        </div>
                      </div>
                      {item.saved ? (
                        <span className="pill pill--green"><CheckCircle2 size={11} /> saved</span>
                      ) : (
                        <span className="pill pill--amber"><AlertTriangle size={11} /> review</span>
                      )}
                    </div>

                    {item.error ? (
                      <div className="m-note m-note--danger" style={{ marginTop: 9 }}>{item.error}</div>
                    ) : (
                      <>
                        <div className="m-stage__meta" style={{ marginTop: 8 }}>
                          <span><strong>{item.read.lrn ?? 'No LRN'}</strong></span>
                          <span>{learner ? learner.name : 'Not matched to a learner'}</span>
                          <span>{answered} answers detected</span>
                          <span>{score.correct}/{score.possible} correct</span>
                          {flags > 0 && <span>{flags} flagged item{flags === 1 ? '' : 's'}</span>}
                        </div>

                        {item.read.warnings.length > 0 && (
                          <div className="m-note m-note--warn" style={{ marginTop: 8 }}>
                            {item.read.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                          </div>
                        )}

                        {item.read.debugImage && (
                          <button
                            className="btn btn--ghost btn--sm"
                            style={{ marginTop: 8 }}
                            onClick={() => setPreview(item.read.debugImage)}
                          >
                            View scanner overlay
                          </button>
                        )}

                        {!item.saved && (
                          <div className="m-stage__assign">
                            <label className="m-field">
                              <span className="m-field__label">Assign to learner</span>
                              <select
                                className="select"
                                value={item.assignedLrn ?? ''}
                                onChange={(event) => assign(item, event.target.value)}
                              >
                                <option value="">Choose a learner…</option>
                                {learners.map((entry) => (
                                  <option key={entry.lrn} value={entry.lrn}>
                                    {entry.name} · {entry.lrn}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="m-row">
                              <button className="btn btn--primary" onClick={() => saveAssigned(item)}>
                                Save sheet
                              </button>
                              <button className="m-iconbtn m-iconbtn--danger" onClick={() => removeStaged(item)} aria-label="Discard sheet">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        )}
                        {item.saved && item.savedNote && (
                          <div className="m-tiny" style={{ marginTop: 7 }}>{item.savedNote} · answers are kept as read.</div>
                        )}
                      </>
                    )}
                  </article>
                );
              })}

              {savedNow > 0 && (
                <button className="btn btn--soft btn--block" style={{ marginTop: 12 }} onClick={() => onNavigate('results')}>
                  View checked sheets <ArrowRight size={15} />
                </button>
              )}
            </div>
          </section>
        )}

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Scanner self-test</h2>
              <p>Draws a synthetic sheet and reads it on this device: clean, rotated, and distorted.</p>
            </div>
            <FlaskConical size={19} className="muted" />
          </div>
          <div className="m-card__body">
            <button className="btn btn--ghost btn--block" onClick={() => void testScanner()} disabled={testing || learners.length === 0}>
              {testing ? <Spinner size={15} /> : <FlaskConical size={16} />} Run scanner self-test
            </button>
            {learners.length === 0 && (
              <p className="m-tiny" style={{ marginBottom: 0 }}>Needs at least one learner to place on the sample sheet.</p>
            )}
            {selfTest && (
              <div style={{ marginTop: 10 }}>
                <div className={`m-note ${selfTest.pass ? 'm-note--green' : 'm-note--danger'}`}>
                  {selfTest.pass ? 'All three cases matched the expected answers.' : 'One or more cases did not match. Check the details before relying on scans.'}
                </div>
                {selfTest.cases.map((testCase) => (
                  <div className="m-row m-row--between" key={testCase.name} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                    <div>
                      <strong style={{ fontSize: '0.8rem' }}>{testCase.name}</strong>
                      <div className="m-tiny">{testCase.details}</div>
                    </div>
                    {testCase.pass
                      ? <span className="pill pill--green"><CheckCircle2 size={11} /> pass</span>
                      : <span className="pill pill--rose"><AlertTriangle size={11} /> check</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="m-note">
          <strong>Camera note:</strong> Android may show its own file picker instead of the camera
          app. In that picker, choose Camera to take the photo. Both routes feed the same scanner.
        </div>
      </div>

      {preview && (
        <div className="m-overlay" role="dialog" aria-modal="true" aria-label="Scanner overlay" onClick={() => setPreview(null)}>
          <div className="m-overlay__head">
            <div className="m-overlay__title"><strong>Scanner overlay</strong><span>Tap anywhere to close</span></div>
          </div>
          <div className="m-overlay__body">
            <img src={preview} alt="Scanner overlay" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--line-strong)' }} />
          </div>
        </div>
      )}
    </>
  );
}
