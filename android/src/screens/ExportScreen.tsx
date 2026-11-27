import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  Eye,
  FileJson,
  FileSpreadsheet,
  Layers,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import type { Exam } from '@shared/types';
import { CATEGORY_LABELS } from '@shared/types';
import { useApp } from '@shared/store/AppStore';
import {
  buildExamScoresJson,
  buildResultsArchive,
  buildResultsCsv,
  buildSubjectGradesJson,
  examFileStem,
} from '@shared/lib/exports';
import { copyText } from '@shared/lib/download';
import { summarize } from '@shared/lib/results';
import { Badge, Spinner } from '@shared/components/ui';
import { MobileSheet, ScreenHead, TypeToConfirm } from '../components/Common';
import { saveTextFile } from '../lib/saveFile';
import type { ExamTab } from '../MobileApp';

interface Preview {
  title: string;
  filename: string;
  json: string;
}

type ExportKind = 'scores' | 'archive' | 'grades';

export function ExportScreen({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: ExamTab) => void }) {
  const { state, toast } = useApp();
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);
  const summary = summarize(exam, learners, results);
  const keyFilled = exam.answerKey.filter(Boolean).length;
  const complete = keyFilled === exam.itemCount;
  const reviewCount = results.filter((result) => result.needsReview).length;
  const activeResults = results.filter((result) => {
    const learner = learners.find((item) => item.lrn === result.lrn);
    return !learner || learner.status === 'Active';
  });

  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmLegacy, setConfirmLegacy] = useState(false);
  const [busy, setBusy] = useState<ExportKind | 'csv' | null>(null);

  const fileName = examFileStem(exam);

  const runSave = async (
    kind: ExportKind | 'csv',
    content: string,
    filename: string,
    label: string,
    format: 'json' | 'csv'
  ) => {
    setBusy(kind);
    try {
      const saved = await saveTextFile(
        content,
        filename,
        format === 'csv'
          ? { mime: 'text/csv', label: 'CSV file', extension: 'csv' }
          : { mime: 'application/json', label: 'JSON file', extension: 'json' }
      );
      if (saved) toast(`${label} saved.`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The file could not be saved.', 'danger');
    } finally {
      setBusy(null);
    }
  };

  const showPreview = (kind: ExportKind) => {
    if (kind === 'scores' && !complete) {
      toast('Complete the answer key first so the exported scores are meaningful.', 'danger');
      return;
    }
    if (kind === 'scores') {
      setPreview({
        title: 'GradeApp assessment JSON',
        filename: `${fileName}_GradeApp-scores.json`,
        json: JSON.stringify(buildExamScoresJson(state, exam), null, 2),
      });
    } else if (kind === 'archive') {
      setPreview({
        title: 'Tsek results archive',
        filename: `${fileName}_Tsek-results.json`,
        json: JSON.stringify(buildResultsArchive(state, exam), null, 2),
      });
    } else {
      setPreview({
        title: 'GradeApp subject grades JSON',
        filename: `${fileName}_SubjectGrades.json`,
        json: JSON.stringify(buildSubjectGradesJson(state, exam), null, 2),
      });
    }
  };

  const saveScores = async () => {
    if (!complete) {
      toast('Complete the answer key before exporting.', 'danger');
      return;
    }
    if (results.length === 0) {
      toast('There are no checked sheets to export yet.', 'danger');
      return;
    }
    await runSave(
      'scores',
      JSON.stringify(buildExamScoresJson(state, exam), null, 2),
      `${fileName}_GradeApp-scores.json`,
      'GradeApp assessment JSON',
      'json'
    );
  };

  const saveArchive = async () => {
    if (results.length === 0) {
      toast('There are no checked sheets to export yet.', 'danger');
      return;
    }
    await runSave(
      'archive',
      JSON.stringify(buildResultsArchive(state, exam), null, 2),
      `${fileName}_Tsek-results.json`,
      'Tsek results archive',
      'json'
    );
  };

  const saveCsv = async () => {
    if (results.length === 0) {
      toast('There are no checked sheets to export yet.', 'danger');
      return;
    }
    await runSave(
      'csv',
      buildResultsCsv(exam, state),
      `${fileName}_results.csv`,
      'Results CSV',
      'csv'
    );
  };

  const saveLegacy = async () => {
    if (results.length === 0) {
      toast('There are no checked sheets to export yet.', 'danger');
      return;
    }
    await runSave(
      'grades',
      JSON.stringify(buildSubjectGradesJson(state, exam), null, 2),
      `${fileName}_SubjectGrades.json`,
      'Subject grades JSON',
      'json'
    );
  };

  const copyPreview = async () => {
    if (!preview) return;
    const ok = await copyText(preview.json);
    toast(
      ok ? 'JSON copied to the clipboard.' : 'Copy is not available in this app.',
      ok ? 'success' : 'danger'
    );
  };

  return (
    <>
      <ScreenHead
        eyebrow={`${exam.code} · Export`}
        title="Hand off the results"
        subtitle="Every file is built on this tablet; nothing leaves it until you save one."
        actions={
          <Badge tone={complete && results.length > 0 ? 'green' : 'amber'}>
            {complete && results.length > 0 ? 'Ready' : 'Incomplete'}
          </Badge>
        }
      />

      <div className="m-stack">
        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Export readiness</h2>
              <p>The checks below are what the receiving GradeApp expects.</p>
            </div>
          </div>
          <div className="m-card__body">
            <div className="readiness-list">
              <div className="readiness-row">
                <span>
                  {complete ? (
                    <CheckCircle2 size={16} color="var(--green)" />
                  ) : (
                    <Circle size={16} />
                  )}{' '}
                  Answer key
                </span>
                <strong>
                  {keyFilled}/{exam.itemCount}
                </strong>
              </div>
              <div className="readiness-row">
                <span>
                  {learners.length ? <CheckCircle2 size={16} color="var(--green)" /> : <Circle size={16} />}{' '}
                  Roster
                </span>
                <strong>{learners.length} learners</strong>
              </div>
              <div className="readiness-row">
                <span>
                  {results.length ? <CheckCircle2 size={16} color="var(--green)" /> : <Circle size={16} />}{' '}
                  Checked sheets
                </span>
                <strong>
                  {results.length} checked · {activeResults.length} active
                </strong>
              </div>
              <div className="readiness-row">
                <span>
                  {reviewCount === 0 ? (
                    <CheckCircle2 size={16} color="var(--green)" />
                  ) : (
                    <AlertTriangle size={16} color="var(--amber)" />
                  )}{' '}
                  Flagged sheets
                </span>
                <strong>{reviewCount === 0 ? 'All reviewed' : `${reviewCount} still need checking`}</strong>
              </div>
              <div className="readiness-row">
                <span>
                  {exam.subjectUID ? <CheckCircle2 size={16} color="var(--green)" /> : <Circle size={16} />}{' '}
                  Subject UID
                </span>
                <strong>{exam.subjectUID || 'Not set'}</strong>
              </div>
            </div>

            {reviewCount > 0 && (
              <div className="m-note m-note--warn" style={{ marginTop: 12 }}>
                <div className="m-row m-row--between">
                  <span>
                    {reviewCount} sheet{reviewCount === 1 ? '' : 's'} still flagged. Saving now includes
                    them as they stand.
                  </span>
                  <button className="btn btn--soft btn--sm" onClick={() => onNavigate('results')}>
                    Review now
                  </button>
                </div>
              </div>
            )}

            <div className="mini-list" style={{ marginTop: 14 }}>
              <div className="mini-list__row">
                <span>Class average</span>
                <strong>{summary.averagePercentage}%</strong>
              </div>
              <div className="mini-list__row">
                <span>Passing rate</span>
                <strong>{summary.passingRate}%</strong>
              </div>
              <div className="mini-list__row">
                <span>Category</span>
                <strong>
                  {CATEGORY_LABELS[exam.category].label} ({CATEGORY_LABELS[exam.category].short})
                </strong>
              </div>
              <div className="mini-list__row">
                <span>Quarter</span>
                <strong>{exam.quarterKey}</strong>
              </div>
            </div>
          </div>
        </section>

        <div className="m-grid">
          <section className="m-card">
            <div className="m-card__head">
              <div>
                <h2>GradeApp assessment scores</h2>
                <p>
                  The category-aware file: raw score, item count, percentage and grade, tagged as{' '}
                  {CATEGORY_LABELS[exam.category].short}. The GradeApp applies the WW / PT / QE weight
                  itself.
                </p>
              </div>
              <Badge tone="accent">Recommended</Badge>
            </div>
            <div className="m-card__body">
              <div className="m-row" style={{ gap: 6 }}>
                <span className="pill pill--neutral">EXAM_SCORES</span>
                <span className="pill pill--neutral">{results.length} results</span>
                <span className="pill pill--neutral">JSON</span>
              </div>
              <div className="m-row" style={{ marginTop: 12 }}>
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => void saveScores()}
                  disabled={!complete || results.length === 0 || busy !== null}
                >
                  {busy === 'scores' ? <Spinner size={14} /> : <Download size={14} />} Save JSON
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => showPreview('scores')}>
                  <Eye size={14} /> Preview
                </button>
              </div>
              {!complete && (
                <p className="m-tiny" style={{ marginBottom: 0, marginTop: 8 }}>
                  Finish the answer key in Key before this file can be saved.
                </p>
              )}
            </div>
          </section>

          <section className="m-card">
            <div className="m-card__head">
              <div>
                <h2>Tsek results archive</h2>
                <p>
                  A full snapshot of this exam: metadata, roster, answer key, every item answer,
                  scanner flags and the summary. Best for your own records or restoring a class.
                </p>
              </div>
              <Badge tone="green">Complete record</Badge>
            </div>
            <div className="m-card__body">
              <div className="m-row" style={{ gap: 6 }}>
                <span className="pill pill--neutral">TSEK_RESULTS</span>
                <span className="pill pill--neutral">Exam + roster + flags</span>
                <span className="pill pill--neutral">JSON</span>
              </div>
              <div className="m-row" style={{ marginTop: 12 }}>
                <button
                  className="btn btn--soft btn--sm"
                  onClick={() => void saveArchive()}
                  disabled={results.length === 0 || busy !== null}
                >
                  {busy === 'archive' ? <Spinner size={14} /> : <Download size={14} />} Save JSON
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => showPreview('archive')}>
                  <Eye size={14} /> Preview
                </button>
              </div>
            </div>
          </section>

          <section className="m-card">
            <div className="m-card__head">
              <div>
                <h2>Class results CSV</h2>
                <p>
                  One row per learner with LRN, raw score, percentage, grade, review state and the
                  source file of the scan. Opens directly in Excel or Google Sheets.
                </p>
              </div>
              <Badge tone="neutral"><Table2 size={11} /> Spreadsheet</Badge>
            </div>
            <div className="m-card__body">
              <div className="m-row" style={{ gap: 6 }}>
                <span className="pill pill--neutral">{learners.length} rows</span>
                <span className="pill pill--neutral">CSV</span>
              </div>
              <div className="m-row" style={{ marginTop: 12 }}>
                <button
                  className="btn btn--soft btn--sm"
                  onClick={() => void saveCsv()}
                  disabled={results.length === 0 || busy !== null}
                >
                  {busy === 'csv' ? <Spinner size={14} /> : <FileSpreadsheet size={14} />} Save CSV
                </button>
              </div>
            </div>
          </section>

          <section className="m-card">
            <div className="m-card__head">
              <div>
                <h2>Subject grades JSON (legacy)</h2>
                <p>
                  The exact file the GradeApp already imports. It treats this one assessment's grade
                  as the quarter grade, bypassing WW / PT / QE weighting.
                </p>
              </div>
              <Badge tone="amber">Fallback</Badge>
            </div>
            <div className="m-card__body">
              <div className="m-row" style={{ gap: 6 }}>
                <span className="pill pill--neutral">SUBJECT_GRADES</span>
                <span className="pill pill--amber">Overwrites quarter grade</span>
              </div>
              <div className="m-row" style={{ marginTop: 12 }}>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setConfirmLegacy(true)}
                  disabled={results.length === 0 || busy !== null}
                >
                  {busy === 'grades' ? <Spinner size={14} /> : <FileJson size={14} />} Save JSON
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => showPreview('grades')}>
                  <Eye size={14} /> Preview
                </button>
              </div>
            </div>
          </section>
        </div>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>How the GradeApp handoff works</h2>
              <p>Two clean paths, depending on what the receiving GradeApp accepts.</p>
            </div>
            <Layers size={19} className="muted" />
          </div>
          <div className="m-card__body">
            <div className="info-list">
              <div>
                <strong>1 · Assessment score import (preferred).</strong> Upload the assessment scores
                file. It carries the category, raw score, item count and grade, so the GradeApp can
                place it under Written Works, Performance Tasks or Quarterly Exam and apply that
                component's weight.
              </div>
              <div>
                <strong>2 · Final subject grade import.</strong> Upload the subject grades file. This is
                only correct when the assessment grade really is the quarter grade, because the file
                has no category field.
              </div>
              <div>
                <strong>Keeping the record.</strong> The Tsek archive is the full source of truth: every
                item answer and scanner flag. Keep it with the class record so a score can always be
                traced back to a sheet.
              </div>
            </div>
            <div className="m-note m-note--green" style={{ marginTop: 12 }}>
              <ShieldCheck size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
              All files are generated locally from the saved workspace. Saving again after a correction
              produces the updated score.
            </div>
          </div>
        </section>
      </div>

      <MobileSheet
        open={preview !== null}
        title={preview?.title ?? 'JSON preview'}
        subtitle={preview?.filename}
        onClose={() => setPreview(null)}
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => void copyPreview()}>
              <Copy size={14} /> Copy JSON
            </button>
            <span className="m-spacer" />
            <button className="btn btn--primary" onClick={() => setPreview(null)}>
              Close
            </button>
          </>
        }
      >
        <pre className="code-preview">{preview?.json}</pre>
      </MobileSheet>

      <TypeToConfirm
        open={confirmLegacy}
        title="Use the legacy subject-grade file?"
        message={
          <>
            {complete ? null : (
              <>
                The answer key is incomplete, so these grades are provisional.{' '}
              </>
            )}
            This writes <strong>{results.length} grades</strong> into <strong>{exam.quarterKey}</strong> as
            if this single assessment were the final subject grade. If the GradeApp applies WW / PT / QE
            weights, save the assessment scores file instead.
          </>
        }
        phrase="OVERWRITE"
        confirmLabel="Save legacy file"
        onClose={() => setConfirmLegacy(false)}
        onConfirm={() => {
          void saveLegacy();
        }}
      />
    </>
  );
}