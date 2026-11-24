import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Copy,
  FileText,
  KeyRound,
  LayoutGrid,
  PenLine,
  Plus,
  Printer,
  ScanLine,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import type { Exam } from '../types';
import { CATEGORY_LABELS } from '../types';
import { useApp } from '../store/AppStore';
import { Badge, ConfirmDialog, EmptyState, ProgressBar, StatCard } from './ui';
import { scannableItems, totalItemCount } from '../lib/sections';
import {
  buildAttention,
  buildExamPulses,
  greeting,
  initials,
  longDate,
  nextStepFor,
  recentCheckIns,
  relativeTime,
  workspacePulse,
  type AttentionItem,
  type NextKind,
} from '../lib/dashboard';
import type { WorkspaceTab } from './ExamWorkspace';

const TAB_FOR: Record<NextKind, WorkspaceTab> = {
  roster: 'roster',
  key: 'key',
  review: 'results',
  scores: 'scores',
  scan: 'scan',
  print: 'sheets',
  results: 'results',
};

const ATTENTION_ICON = {
  roster: Users,
  key: KeyRound,
  review: AlertTriangle,
  scores: PenLine,
  scan: ScanLine,
  print: Printer,
  results: CheckCircle2,
} as const;

function AttentionRow({ item, onOpen }: { item: AttentionItem; onOpen: () => void }) {
  const Icon = ATTENTION_ICON[item.kind];
  return (
    <button className={`attention-row attention-row--${item.tone}`} onClick={onOpen}>
      <span className="attention-row__icon">
        <Icon size={17} />
      </span>
      <span className="attention-row__copy">
        <span className="attention-row__title">{item.title}</span>
        <span className="attention-row__detail">{item.detail}</span>
      </span>
      <span className="attention-row__action">
        {item.action} <ArrowRight size={14} />
      </span>
    </button>
  );
}

export function ExamList({
  onOpenExam,
  onNewExam,
}: {
  onOpenExam: (examId: string, tab?: WorkspaceTab) => void;
  onNewExam: () => void;
}) {
  const { state, duplicateExam, deleteExam, loadDemoWorkspace, toast } = useApp();
  const [pendingDelete, setPendingDelete] = useState<Exam | null>(null);
  const [showAllAttention, setShowAllAttention] = useState(false);

  const pulses = useMemo(
    () => buildExamPulses(state),
    [state.exams, state.learners, state.results]
  );
  const pulse = useMemo(() => workspacePulse(pulses), [pulses]);
  const attention = useMemo(() => buildAttention(pulses), [pulses]);
  const checkIns = useMemo(() => recentCheckIns(pulses, 5), [pulses]);
  const pulseByExam = useMemo(() => new Map(pulses.map((entry) => [entry.exam.id, entry])), [pulses]);

  const attentionExams = new Set(attention.map((item) => item.examId)).size;
  const visibleAttention = showAllAttention ? attention : attention.slice(0, 6);
  const hiddenAttention = Math.max(0, attention.length - visibleAttention.length);

  const openTab = (examId: string, tab: WorkspaceTab) => onOpenExam(examId, tab);

  const openNext = (exam: Exam) => {
    const entry = pulseByExam.get(exam.id);
    if (!entry) {
      onOpenExam(exam.id, 'setup');
      return;
    }
    onOpenExam(exam.id, TAB_FOR[nextStepFor(entry).kind]);
  };

  const duplicate = (exam: Exam) => {
    const id = duplicateExam(exam.id);
    if (id) {
      toast('Exam duplicated with the same roster and answer key.', 'success');
      onOpenExam(id, 'setup');
    }
  };

  const summaryLine = (() => {
    if (pulses.length === 0) {
      return 'Set up your first exam, add the class roster, and fill in the answer key. One exam is all it takes to start checking papers.';
    }
    if (attention.length > 0) {
      return `${attention.length} ${attention.length === 1 ? 'task needs' : 'tasks need'} a look across ${attentionExams} ${attentionExams === 1 ? 'exam' : 'exams'} before your records are final.`;
    }
    if (pulse.results > 0) {
      return `Everything is caught up. ${pulse.results} checked ${pulse.results === 1 ? 'sheet' : 'sheets'} across ${pulse.exams} ${pulse.exams === 1 ? 'exam' : 'exams'}, averaging ${pulse.average}%.`;
    }
    return `${pulse.exams} ${pulse.exams === 1 ? 'exam is' : 'exams are'} ready. Print the first stack of sheets and scan it to start the record.`;
  })();

  return (
    <>
      <header className="dash-head">
        <div className="dash-head__copy">
          <div className="dash-head__date">
            <CalendarDays size={14} />
            <span>{longDate()}</span>
          </div>
          <h1 className="dash-title">{greeting()}.</h1>
          <p className="dash-sub">{summaryLine}</p>
        </div>
      </header>

      {pulse.exams > 0 && (
        <div className="stat-grid">
          <StatCard
            label="Active exams"
            value={pulse.exams}
            detail={`${pulse.examsWithResults} with checked sheets`}
            icon={<LayoutGrid size={17} />}
          />
          <StatCard
            label="Learners"
            value={pulse.learners}
            detail="Across all exam rosters"
            icon={<Users size={17} />}
          />
          <StatCard
            label="Sheets checked"
            value={pulse.results}
            detail={pulse.review ? `${pulse.review} flagged for review` : 'No flags waiting'}
            icon={<ScanLine size={17} />}
          />
          <StatCard
            label="Average score"
            value={`${pulse.average}%`}
            detail={pulse.results ? 'Across all checked sheets' : 'No scans yet'}
            icon={<FileText size={17} />}
          />
        </div>
      )}

      {pulse.exams > 0 && (
        <div className="dash-grid">
          <section className="dash-panel" aria-labelledby="attention-title">
            <div className="dash-panel__head">
              <div>
                <div className="eyebrow">Priority queue</div>
                <h2 id="attention-title">Needs attention</h2>
              </div>
              <Badge tone={attention.length === 0 ? 'green' : 'amber'}>
                {attention.length === 0 ? 'All clear' : `${attention.length} open`}
              </Badge>
            </div>

            {attention.length === 0 ? (
              <div className="attention-empty">
                <span className="attention-empty__icon">
                  <CheckCircle2 size={22} />
                </span>
                <div>
                  <strong>Nothing is waiting on you.</strong>
                  <p>
                    Every roster, answer key, scan, and written score is complete. Export the results
                    whenever you are ready to hand them in.
                  </p>
                </div>
              </div>
            ) : (
              <div className="attention-list">
                {visibleAttention.map((item) => (
                  <AttentionRow
                    key={item.id}
                    item={item}
                    onOpen={() => openTab(item.examId, TAB_FOR[item.kind])}
                  />
                ))}
                {(hiddenAttention > 0 || showAllAttention) && attention.length > 6 && (
                  <button
                    className="attention-more"
                    onClick={() => setShowAllAttention((value) => !value)}
                  >
                    {showAllAttention ? 'Show fewer' : `Show ${hiddenAttention} more`}
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="dash-panel dash-panel--rail" aria-labelledby="activity-title">
            <div className="dash-panel__head">
              <div>
                <div className="eyebrow">Activity</div>
                <h2 id="activity-title">Recent check-ins</h2>
              </div>
              {pulse.lastScanAt && <span className="tiny faint">{relativeTime(pulse.lastScanAt)}</span>}
            </div>

            {checkIns.length === 0 ? (
              <div className="rail-empty">
                <span className="rail-empty__icon">
                  <ScanLine size={20} />
                </span>
                <p>
                  No sheets scanned yet. Each checked paper appears here with its learner, exam,
                  and score.
                </p>
                {pulses.length > 0 && (
                  <button
                    className="btn btn--soft btn--sm"
                    onClick={() => openTab(pulses[0].exam.id, 'scan')}
                  >
                    <ScanLine size={14} /> Start scanning
                  </button>
                )}
              </div>
            ) : (
              <div className="checkin-list">
                {checkIns.map(({ result, exam }) => (
                  <button
                    key={result.id}
                    className="checkin"
                    onClick={() => openTab(exam.id, 'results')}
                  >
                    <span className="checkin__avatar">{initials(result.name)}</span>
                    <span className="checkin__body">
                      <span className="checkin__name">{result.name}</span>
                      <span className="checkin__meta">
                        {exam.code} · {relativeTime(result.scannedAt)}
                      </span>
                    </span>
                    <span className="checkin__score">
                      <strong>{Math.round(result.percentage * 10) / 10}%</strong>
                      <small className={result.needsReview ? 'checkin__flag' : 'checkin__ok'}>
                        {result.needsReview ? 'review' : 'checked'}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {pulse.results > 0 && (
              <div className="rail-foot">
                <span>
                  <strong>{pulse.results}</strong> {pulse.results === 1 ? 'sheet' : 'sheets'} on record
                </span>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => openTab(checkIns[0]?.exam.id ?? pulses[0].exam.id, 'results')}
                >
                  Open results <ArrowRight size={13} />
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {pulses.length === 0 ? (
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
        <>
          <div className="section-head">
            <div>
              <div className="eyebrow">Library</div>
              <h2>Your exams</h2>
            </div>
            <span className="section-head__meta">
              {pulse.exams} {pulse.exams === 1 ? 'exam' : 'exams'} · {pulse.learners} learners ·{' '}
              {pulse.results} sheets checked
            </span>
          </div>

          <div className="exam-grid">
            {pulses.map((entry) => {
              const { exam } = entry;
              const next = nextStepFor(entry);
              const scannedPercent = entry.learnerCount
                ? (entry.resultCount / entry.learnerCount) * 100
                : 0;
              const keyPercent = entry.keyTotal ? (entry.keyFilled / entry.keyTotal) * 100 : 100;
              const writtenCount = totalItemCount(exam) - scannableItems(exam).length;
              return (
                <article className="exam-card" key={exam.id}>
                  <div className="exam-card__head">
                    <span className="exam-card__code">{exam.code}</span>
                    <Badge
                      tone={
                        exam.category === 'QSTE'
                          ? 'accent'
                          : exam.category === 'PPT'
                            ? 'blue'
                            : 'green'
                      }
                    >
                      {CATEGORY_LABELS[exam.category].short} · {CATEGORY_LABELS[exam.category].label}
                    </Badge>
                  </div>
                  <div className="exam-card__body">
                    <h3 className="exam-card__title">{exam.title}</h3>
                    <div className="exam-card__meta">
                      {[exam.subject, exam.gradeLevel, exam.section].filter(Boolean).join(' · ') ||
                        'No class details yet'}
                    </div>
                    <div className="exam-card__meta">
                      {exam.quarterKey} · {exam.assessmentName} · {totalItemCount(exam)} items
                      {writtenCount > 0 ? ` (${entry.keyTotal} scanned · ${writtenCount} written)` : ''}
                    </div>
                    <div className="exam-card__stamp">Updated {relativeTime(exam.updatedAt)}</div>
                  </div>
                  <div className="exam-card__progress">
                    <div className="progress-row">
                      <div className="progress-row__top">
                        <span>
                          Answer key <span className="tiny faint">scanned part</span>
                        </span>
                        <strong className={entry.keyFilled === entry.keyTotal ? '' : 'muted'}>
                          {entry.keyFilled}/{entry.keyTotal}
                        </strong>
                      </div>
                      <ProgressBar
                        value={keyPercent}
                        tone={entry.keyFilled === entry.keyTotal ? 'green' : 'amber'}
                      />
                    </div>
                    <div className="progress-row">
                      <div className="progress-row__top">
                        <span>Sheets checked</span>
                        <strong className={entry.reviewCount ? 'muted' : ''}>
                          {entry.resultCount}/{entry.learnerCount || '—'}
                          {entry.reviewCount > 0 ? ` · ${entry.reviewCount} to review` : ''}
                        </strong>
                      </div>
                      <ProgressBar
                        value={scannedPercent}
                        tone={entry.reviewCount ? 'amber' : 'accent'}
                      />
                    </div>
                  </div>
                  <div className="exam-card__foot">
                    <div className="exam-card__stats">
                      <span>
                        <Users size={13} /> <strong>{entry.learnerCount}</strong>
                      </span>
                      {entry.resultCount > 0 && (
                        <span>
                          <strong>{entry.averagePercentage}%</strong> avg
                        </span>
                      )}
                    </div>
                    <div className="row" style={{ gap: 4 }}>
                      <button
                        className="icon-btn icon-btn--sm"
                        title="Duplicate exam"
                        onClick={() => duplicate(exam)}
                      >
                        <Copy size={15} />
                      </button>
                      <button
                        className="icon-btn icon-btn--sm icon-btn--danger"
                        title="Delete exam"
                        onClick={() => setPendingDelete(exam)}
                      >
                        <Trash2 size={15} />
                      </button>
                      <button
                        className={`btn btn--sm ${next.kind === 'results' ? 'btn--soft' : 'btn--primary'}`}
                        onClick={() => openNext(exam)}
                      >
                        {next.label} <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this exam?"
        message={
          <>
            <strong>{pendingDelete?.title}</strong> and its roster, answer key, and{' '}
            {pendingDelete
              ? state.results.filter((result) => result.examId === pendingDelete.id).length
              : 0}{' '}
            checked sheets will be removed from this workspace. Export the results first if you need a
            copy.
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
