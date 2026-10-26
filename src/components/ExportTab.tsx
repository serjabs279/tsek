import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  FileJson,
  FileSpreadsheet,
  Info,
  Layers,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import type { Exam } from '../types';
import { CATEGORY_LABELS } from '../types';
import { useApp } from '../store/AppStore';
import {
  buildExamScoresJson,
  buildResultsArchive,
  buildSubjectGradesJson,
  downloadExamScoresJson,
  downloadResultsArchive,
  downloadResultsCsv,
  downloadSubjectGradesJson,
  examFileStem,
} from '../lib/exports';
import { copyText } from '../lib/download';
import { summarize } from '../lib/results';
import { Badge, ConfirmDialog, Modal } from './ui';
import type { WorkspaceTab } from './ExamWorkspace';

interface Preview {
  title: string;
  filename: string;
  json: string;
}

export function ExportTab({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: WorkspaceTab) => void }) {
  const { state, toast } = useApp();
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);
  const summary = useMemo(() => summarize(exam, learners, results), [exam, learners, results]);
  const keyFilled = exam.answerKey.filter(Boolean).length;
  const complete = keyFilled === exam.itemCount;
  const reviewCount = results.filter((result) => result.needsReview).length;
  const activeResults = results.filter((result) => {
    const learner = learners.find((item) => item.lrn === result.lrn);
    return !learner || learner.status === 'Active';
  });

  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmLegacy, setConfirmLegacy] = useState(false);

  const fileName = examFileStem(exam);

  const showPreview = (kind: 'scores' | 'archive' | 'grades') => {
    if (!complete) {
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

  const exportScores = () => {
    if (!complete) {
      toast('Complete the answer key before exporting.', 'danger');
      return;
    }
    if (results.length === 0) {
      toast('There are no checked sheets to export yet.', 'danger');
      return;
    }
    downloadExamScoresJson(state, exam);
    toast('GradeApp assessment JSON downloaded.', 'success');
  };

  const exportArchive = () => {
    downloadResultsArchive(state, exam);
    toast('Tsek results archive downloaded.', 'success');
  };

  const exportCsv = () => {
    downloadResultsCsv(state, exam);
    toast('Results CSV downloaded.', 'success');
  };

  const exportLegacy = () => {
    setConfirmLegacy(false);
    downloadSubjectGradesJson(state, exam);
    toast('Subject grades JSON downloaded.', 'success');
  };

  const copyPreview = async () => {
    if (!preview) return;
    const ok = await copyText(preview.json);
    toast(ok ? 'JSON copied to the clipboard.' : 'Copy is not available in this browser.', ok ? 'success' : 'danger');
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div className="card-head__title">
            <h3>Export readiness</h3>
            <p>Every export is a plain JSON file. Nothing leaves this device until you choose to share it.</p>
          </div>
          <Badge tone={complete && results.length > 0 ? 'green' : 'amber'}>
            {complete && results.length > 0 ? 'Ready' : 'Incomplete'}
          </Badge>
        </div>
        <div className="card-body">
          <div className="readiness-list">
            <div className="readiness-row">
              <span>{complete ? <CheckCircle2 size={16} color="var(--green)" /> : <Circle size={16} />} Answer key</span>
              <strong>{keyFilled}/{exam.itemCount}</strong>
            </div>
            <div className="readiness-row">
              <span>{learners.length ? <CheckCircle2 size={16} color="var(--green)" /> : <Circle size={16} />} Roster</span>
              <strong>{learners.length} learners</strong>
            </div>
            <div className="readiness-row">
              <span>{results.length ? <CheckCircle2 size={16} color="var(--green)" /> : <Circle size={16} />} Checked sheets</span>
              <strong>{results.length} scanned · {activeResults.length} active</strong>
            </div>
            <div className="readiness-row">
              <span>{reviewCount === 0 ? <CheckCircle2 size={16} color="var(--green)" /> : <AlertTriangle size={16} color="var(--amber)" />} Flagged sheets</span>
              <strong>{reviewCount === 0 ? 'All reviewed' : `${reviewCount} still need checking`}</strong>
            </div>
            <div className="readiness-row">
              <span>{exam.subjectUID ? <CheckCircle2 size={16} color="var(--green)" /> : <Circle size={16} />} Subject UID</span>
              <strong>{exam.subjectUID || 'Not set'}</strong>
            </div>
          </div>

          {reviewCount > 0 && (
            <div className="card-note card-note--warn" style={{ marginTop: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>{reviewCount} sheet{reviewCount === 1 ? '' : 's'} still flagged. Exporting now includes them as-is.</span>
                <button className="btn btn--soft btn--sm" onClick={() => onNavigate('results')}>Review now</button>
              </div>
            </div>
          )}

          <div className="mini-list" style={{ marginTop: 14 }}>
            <div className="mini-list__row"><span>Class average</span><strong>{summary.averagePercentage}%</strong></div>
            <div className="mini-list__row"><span>Passing rate</span><strong>{summary.passingRate}%</strong></div>
            <div className="mini-list__row"><span>Category</span><strong>{CATEGORY_LABELS[exam.category].label} ({CATEGORY_LABELS[exam.category].short})</strong></div>
            <div className="mini-list__row"><span>Quarter</span><strong>{exam.quarterKey}</strong></div>
          </div>
        </div>
      </section>

      <div className="export-grid">
        <section className="export-card">
          <div className="export-card__top">
            <div className="export-card__icon"><Layers size={20} /></div>
            <Badge tone="accent">Recommended</Badge>
          </div>
          <h3>GradeApp assessment scores</h3>
          <p>
            The category-aware file: raw score, total items, percentage, and transmuted grade, tagged
            as {CATEGORY_LABELS[exam.category].short} · {CATEGORY_LABELS[exam.category].label.toLowerCase()}.
            This is the file that lets the GradeApp apply the right WW / PT / QE weight.
          </p>
          <div className="export-card__meta">
            <span className="pill pill--neutral">EXAM_SCORES</span>
            <span className="pill pill--neutral">{results.length} results</span>
            <span className="pill pill--neutral">JSON</span>
          </div>
          <div className="export-card__actions">
            <button className="btn btn--primary btn--sm" onClick={exportScores} disabled={!complete || results.length === 0}>
              <Download size={14} /> Download
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => showPreview('scores')}>Preview</button>
          </div>
        </section>

        <section className="export-card">
          <div className="export-card__top">
            <div className="export-card__icon"><ShieldCheck size={20} /></div>
            <Badge tone="green">Complete record</Badge>
          </div>
          <h3>Tsek results archive</h3>
          <p>
            A full snapshot of this exam: metadata, roster, answer key, every item answer, scanner
            flags, and the summary. Best for your own records, audits, or restoring a class in Tsek.
          </p>
          <div className="export-card__meta">
            <span className="pill pill--neutral">TSEK_RESULTS</span>
            <span className="pill pill--neutral">Exam + roster + flags</span>
            <span className="pill pill--neutral">JSON</span>
          </div>
          <div className="export-card__actions">
            <button className="btn btn--soft btn--sm" onClick={exportArchive} disabled={results.length === 0}>
              <Download size={14} /> Download
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => showPreview('archive')}>Preview</button>
          </div>
        </section>

        <section className="export-card">
          <div className="export-card__top">
            <div className="export-card__icon"><Table2 size={20} /></div>
            <Badge tone="neutral">Spreadsheet</Badge>
          </div>
          <h3>Class results CSV</h3>
          <p>
            One row per learner with LRN, raw score, percentage, grade, review state, and the source
            file of the scan. Opens directly in Excel or Google Sheets.
          </p>
          <div className="export-card__meta">
            <span className="pill pill--neutral">{learners.length} rows</span>
            <span className="pill pill--neutral">CSV</span>
          </div>
          <div className="export-card__actions">
            <button className="btn btn--soft btn--sm" onClick={exportCsv} disabled={results.length === 0}>
              <FileSpreadsheet size={14} /> Download
            </button>
          </div>
        </section>

        <section className="export-card">
          <div className="export-card__top">
            <div className="export-card__icon"><FileJson size={20} /></div>
            <Badge tone="amber">Single-assessment fallback</Badge>
          </div>
          <h3>Subject grades JSON (legacy)</h3>
          <p>
            The exact subject grades file your GradeApp already imports. Careful: it treats this one
            assessment's transmuted grade as the quarter grade, bypassing WW/PT/QE weighting. Only use
            it when that is truly what you want.
          </p>
          <div className="export-card__meta">
            <span className="pill pill--neutral">SUBJECT_GRADES</span>
            <span className="pill pill--amber">Overwrites quarter grade</span>
          </div>
          <div className="export-card__actions">
            <button className="btn btn--ghost btn--sm" onClick={() => setConfirmLegacy(true)} disabled={results.length === 0}>
              <Download size={14} /> Download
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => showPreview('grades')}>Preview</button>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div className="card-head__title">
            <h3>How the GradeApp handoff works</h3>
            <p>Two clean paths, depending on what the receiving GradeApp accepts.</p>
          </div>
        </div>
        <div className="card-body">
          <div className="info-list">
            <div>
              <strong>1 · Assessment score import (preferred).</strong> Upload the assessment scores file.
              It carries the category, raw score, item count, and grade. The GradeApp can place it under
              Written Works, Performance Tasks, or Quarterly Exam and apply that component's weight itself.
            </div>
            <div>
              <strong>2 · Final subject grade import.</strong> Upload the subject grades file. This is only
              correct when the assessment grade really is the quarter grade, because the file has no
              category field.
            </div>
            <div>
              <strong>Keeping the record.</strong> The Tsek archive is the full source of truth: every
              item answer and scanner flag. Keep it with the class record so a score can always be traced
              back to a sheet.
            </div>
          </div>
          <div className="card-note card-note--green" style={{ marginTop: 14 }}>
            <div className="row" style={{ gap: 8 }}>
              <Info size={15} />
              <span>
                All files are generated locally from the saved workspace. Re-exporting after a correction
                produces the updated score.
              </span>
            </div>
          </div>
        </div>
      </section>

      <Modal
        open={Boolean(preview)}
        title={preview?.title ?? 'JSON preview'}
        eyebrow={preview?.filename}
        onClose={() => setPreview(null)}
        width={860}
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => void copyPreview()}>
              <Copy size={14} /> Copy JSON
            </button>
            <div className="grow" />
            <button className="btn btn--primary" onClick={() => setPreview(null)}>Close</button>
          </>
        }
      >
        <pre className="code-preview">{preview?.json}</pre>
      </Modal>

      <ConfirmDialog
        open={confirmLegacy}
        title="Use the legacy subject-grade file?"
        message={
          <>
            This writes <strong>{results.filter((result) => result.correctCount >= 0).length} grades</strong> into
            {" "}<strong>{exam.quarterKey}</strong> as if this single assessment were the final subject grade.
            If your GradeApp applies WW/PT/QE weights, use the assessment-scores export instead.
          </>
        }
        confirmLabel="I understand, download"
        danger
        onConfirm={exportLegacy}
        onClose={() => setConfirmLegacy(false)}
      />
    </div>
  );
}
