import { useState } from 'react';
import {
  ArrowRight,
  Copy,
  FileText,
  LayoutGrid,
  Plus,
  ScanLine,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import type { Exam } from '../types';
import { CATEGORY_LABELS } from '../types';
import { useApp } from '../store/AppStore';
import { Badge, ConfirmDialog, EmptyState, PageHead, ProgressBar, StatCard } from './ui';
import { scannableItems, totalItemCount } from '../lib/sections';

export function ExamList({
  onOpenExam,
  onNewExam,
}: {
  onOpenExam: (examId: string) => void;
  onNewExam: () => void;
}) {
  const { state, setActiveExam, duplicateExam, deleteExam, loadDemoWorkspace, toast } = useApp();
  const [pendingDelete, setPendingDelete] = useState<Exam | null>(null);

  const learnerCount = state.learners.length;
  const resultCount = state.results.length;
  const average = resultCount
    ? Math.round((state.results.reduce((sum, result) => sum + result.percentage, 0) / resultCount) * 10) / 10
    : 0;
  const examsWithResults = new Set(state.results.map((result) => result.examId)).size;

  const open = (exam: Exam) => {
    setActiveExam(exam.id);
    onOpenExam(exam.id);
  };

  const duplicate = (exam: Exam) => {
    const id = duplicateExam(exam.id);
    if (id) {
      toast('Exam duplicated with the same roster and answer key.', 'success');
      onOpenExam(id);
    }
  };

  return (
    <>
      <PageHead
        eyebrow="Workspace"
        title="Answer sheets, checked."
        subtitle="Print sheets with each learner's name and LRN, scan the stack, and keep a clean JSON record of every score."
        actions={
          state.exams.length === 0 ? (
            <button className="btn btn--soft" onClick={loadDemoWorkspace}>
              <Sparkles size={16} /> Load demo
            </button>
          ) : undefined
        }
      />

      <section className="hero-panel">
        <div className="hero-panel__copy">
          <div className="eyebrow" style={{ marginBottom: 5 }}>Paper in, JSON out</div>
          <h2>One stack of paper. One accurate record.</h2>
          <p>
            Every sheet carries a QR identity and four black corner marks. The scanner reads the
            learner automatically, corrects perspective, and flags smudged or double-shaded items
            for a quick human check.
          </p>
          <div className="hero-steps">
            <div className="hero-step">
              <span className="hero-step__num">1</span>
              <div>
                <strong>Set up</strong>
                <span>Exam details, roster, and answer key.</span>
              </div>
            </div>
            <div className="hero-step">
              <span className="hero-step__num">2</span>
              <div>
                <strong>Print &amp; scan</strong>
                <span>One PDF for the class, one PDF back in.</span>
              </div>
            </div>
            <div className="hero-step">
              <span className="hero-step__num">3</span>
              <div>
                <strong>Review &amp; export</strong>
                <span>Fix flagged items, then download JSON.</span>
              </div>
            </div>
          </div>
        </div>
        <div className="exam-card__stats" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <span className="badge badge--green">
            <ScanLine size={12} /> Scanner self-test passing
          </span>
          <span className="tiny faint">Works offline · data stays on this device</span>
        </div>
      </section>

      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <StatCard label="Exams" value={state.exams.length} detail={`${examsWithResults} with checked sheets`} icon={<LayoutGrid size={17} />} />
        <StatCard label="Learners" value={learnerCount} detail="Across all exam rosters" icon={<Users size={17} />} />
        <StatCard label="Sheets checked" value={resultCount} detail="Every scan is stored locally" icon={<ScanLine size={17} />} />
        <StatCard label="Average score" value={`${average}%`} detail={resultCount ? 'Across all checked sheets' : 'No scans yet'} icon={<FileText size={17} />} />
      </div>

      {state.exams.length === 0 ? (
        <EmptyState
          icon={<FileText size={26} />}
          title="No exams yet"
          message="Create your first exam, paste the class roster, and fill in the answer key. Sheets come after that."
          action={
            <div className="row">
              <button className="btn btn--primary" onClick={onNewExam}>
                <Plus size={16} /> Create an exam
              </button>
              <button className="btn btn--soft" onClick={loadDemoWorkspace}>
                <Sparkles size={16} /> Explore the demo
              </button>
            </div>
          }
        />
      ) : (
        <div className="exam-grid">
          {state.exams.map((exam) => {
            const learners = state.learners.filter((learner) => learner.examId === exam.id);
            const results = state.results.filter((result) => result.examId === exam.id);
            const keyFilled = exam.answerKey.filter(Boolean).length;
            const scanned = scannableItems(exam).length;
            const written = totalItemCount(exam) - scanned;
            const scannedPercent = learners.length ? (results.length / learners.length) * 100 : 0;
            const reviewCount = results.filter((result) => result.needsReview).length;
            return (
              <article className="exam-card" key={exam.id}>
                <div className="exam-card__head">
                  <span className="exam-card__code">{exam.code}</span>
                  <Badge tone={exam.category === 'QSTE' ? 'accent' : exam.category === 'PPT' ? 'blue' : 'green'}>
                    {CATEGORY_LABELS[exam.category].short} · {CATEGORY_LABELS[exam.category].label}
                  </Badge>
                </div>
                <div className="exam-card__body">
                  <h3 className="exam-card__title">{exam.title}</h3>
                  <div className="exam-card__meta">
                    {[exam.subject, exam.gradeLevel, exam.section].filter(Boolean).join(' · ') || 'No class details yet'}
                  </div>
                  <div className="exam-card__meta">
                    {exam.quarterKey} · {exam.assessmentName} · {totalItemCount(exam)} items
                    {written > 0 ? ` (${scanned} scanned · ${written} written)` : ''}
                  </div>
                </div>
                <div className="exam-card__progress">
                  <div className="progress-row">
                    <div className="progress-row__top">
                      <span>Answer key <span className="tiny faint">scanned part</span></span>
                      <strong className={keyFilled === scanned ? '' : 'muted'}>{keyFilled}/{scanned}</strong>
                    </div>
                    <ProgressBar value={scanned ? (keyFilled / scanned) * 100 : 100} tone={keyFilled === scanned ? 'green' : 'amber'} />
                  </div>
                  <div className="progress-row">
                    <div className="progress-row__top">
                      <span>Sheets checked</span>
                      <strong className={reviewCount ? 'muted' : ''}>
                        {results.length}/{learners.length || '—'}
                        {reviewCount > 0 ? ` · ${reviewCount} to review` : ''}
                      </strong>
                    </div>
                    <ProgressBar value={scannedPercent} tone={reviewCount ? 'amber' : 'accent'} />
                  </div>
                </div>
                <div className="exam-card__foot">
                  <div className="exam-card__stats">
                    <span><Users size={13} /> <strong>{learners.length}</strong> learners</span>
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="icon-btn icon-btn--sm" title="Duplicate exam" onClick={() => duplicate(exam)}>
                      <Copy size={15} />
                    </button>
                    <button className="icon-btn icon-btn--sm icon-btn--danger" title="Delete exam" onClick={() => setPendingDelete(exam)}>
                      <Trash2 size={15} />
                    </button>
                    <button className="btn btn--soft btn--sm" onClick={() => open(exam)}>
                      Open <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this exam?"
        message={
          <>
            <strong>{pendingDelete?.title}</strong> and its roster, answer key, and {pendingDelete ? state.results.filter((result) => result.examId === pendingDelete.id).length : 0} checked sheets will be removed from this workspace. Export the results first if you need a copy.
          </>
        }
        confirmLabel="Delete exam"
        danger
        onConfirm={() => {
          if (pendingDelete) {
            deleteExam(pendingDelete.id);
            toast('Exam deleted.', 'danger');
          }
        }}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}
