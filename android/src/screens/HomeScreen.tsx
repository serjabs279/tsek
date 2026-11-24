import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  KeyRound,
  LayoutGrid,
  PenLine,
  Plus,
  Printer,
  Search,
  Settings,
  Sparkles,
  ScanLine,
  Table2,
  Users,
} from 'lucide-react';
import { useApp } from '@shared/store/AppStore';
import { CATEGORY_LABELS } from '@shared/types';
import { totalItemCount } from '@shared/lib/sections';
import { Badge } from '@shared/components/ui';
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
} from '@shared/lib/dashboard';
import { EmptyBlock } from '../components/Common';
import type { ExamTab } from '../MobileApp';

const TAB_FOR: Partial<Record<NextKind, ExamTab>> = {
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
    <button className={`m-attention m-attention--${item.tone}`} onClick={onOpen}>
      <span className="m-attention__icon">
        <Icon size={18} />
      </span>
      <span className="m-attention__body">
        <strong>{item.title}</strong>
        <span>{item.detail}</span>
      </span>
      <span className="m-attention__go">
        {item.action} <ArrowRight size={13} />
      </span>
    </button>
  );
}

export function HomeScreen({
  onOpenExam,
  onNewExam,
  onSettings,
}: {
  onOpenExam: (examId: string, tab?: ExamTab) => void;
  onNewExam: () => void;
  onSettings: () => void;
}) {
  const { state } = useApp();
  const [query, setQuery] = useState('');

  const pulses = useMemo(
    () => buildExamPulses(state),
    [state.exams, state.learners, state.results]
  );
  const pulse = useMemo(() => workspacePulse(pulses), [pulses]);
  const attention = useMemo(() => buildAttention(pulses), [pulses]);
  const checkIns = useMemo(() => recentCheckIns(pulses, 4), [pulses]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return pulses;
    return pulses.filter(({ exam }) =>
      [exam.title, exam.subject, exam.code, exam.section, exam.quarterKey]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [pulses, query]);

  const sample = pulses.length === 0;
  const attentionExams = new Set(attention.map((item) => item.examId)).size;

  const summaryLine = (() => {
    if (sample) {
      return 'Set up your first exam, add the class roster, and fill in the answer key. Then scan the printed sheets with the camera.';
    }
    if (attention.length > 0) {
      return `${attention.length} ${attention.length === 1 ? 'task needs' : 'tasks need'} a look across ${attentionExams} ${attentionExams === 1 ? 'exam' : 'exams'}.`;
    }
    if (pulse.results > 0) {
      return `Everything is caught up. ${pulse.results} checked ${pulse.results === 1 ? 'sheet' : 'sheets'} across ${pulse.exams} ${pulse.exams === 1 ? 'exam' : 'exams'}, averaging ${pulse.average}%.`;
    }
    return `${pulse.exams} ${pulse.exams === 1 ? 'exam is' : 'exams are'} ready. Scan the first stack of sheets to start the record.`;
  })();

  return (
    <>
      <section className="m-dashhead">
        <div className="m-dashhead__date">
          <CalendarDays size={14} />
          <span>{longDate()}</span>
        </div>
        <h1>{greeting()}.</h1>
        <p>{summaryLine}</p>
        <div className="m-row" style={{ marginTop: 14 }}>
          <button className="btn btn--primary" onClick={onNewExam}>
            <Plus size={17} /> New exam
          </button>
          <button className="btn btn--soft" onClick={onSettings}>
            <Settings size={16} /> Settings
          </button>
        </div>
      </section>

      {sample ? (
        <section className="m-card">
          <div className="m-card__body">
            <EmptyBlock
              icon={<Sparkles size={26} />}
              title="No exams on this tablet yet"
              message="Create an exam, add the class roster, and enter the answer key. Then scan the printed sheets with the camera or import photos and PDFs."
              action={
                <button className="btn btn--primary" onClick={onNewExam}>
                  <Plus size={16} /> Create the first exam
                </button>
              }
            />
          </div>
        </section>
      ) : (
        <>
          <div className="m-pulses">
            <div className="m-pulse">
              <span className="m-pulse__label"><LayoutGrid size={13} /> Exams</span>
              <strong>{pulse.exams}</strong>
              <small>{pulse.examsWithResults} with checked sheets</small>
            </div>
            <div className="m-pulse">
              <span className="m-pulse__label"><Users size={13} /> Learners</span>
              <strong>{pulse.learners}</strong>
              <small>Across all rosters</small>
            </div>
            <div className="m-pulse">
              <span className="m-pulse__label"><Table2 size={13} /> Checked</span>
              <strong>{pulse.results}</strong>
              <small>{pulse.lastScanAt ? `Last scan ${relativeTime(pulse.lastScanAt)}` : 'No scans yet'}</small>
            </div>
            <div className={`m-pulse ${pulse.review > 0 ? 'm-pulse--amber' : 'm-pulse--green'}`}>
              <span className="m-pulse__label"><AlertTriangle size={13} /> Review</span>
              <strong>{pulse.review}</strong>
              <small>{pulse.review > 0 ? 'Flagged papers' : 'All clear'}</small>
            </div>
          </div>

          <section className="m-card" style={{ marginBottom: 16 }}>
            <div className="m-card__head">
              <div>
                <div className="eyebrow">Priority queue</div>
                <h2>Needs attention</h2>
              </div>
              <Badge tone={attention.length === 0 ? 'green' : 'amber'}>
                {attention.length === 0 ? 'All clear' : `${attention.length} open`}
              </Badge>
            </div>
            <div className="m-card__body m-card__body--flush">
              {attention.length === 0 ? (
                <div className="m-attention-empty">
                  <span className="m-attention-empty__icon"><CheckCircle2 size={20} /></span>
                  <div>
                    <strong>Nothing is waiting on you.</strong>
                    <p>Every roster, key, and scan is complete. Open an exam to review scores or start the next stack.</p>
                  </div>
                </div>
              ) : (
                attention.map((item) => (
                  <AttentionRow
                    key={item.id}
                    item={item}
                    onOpen={() => onOpenExam(item.examId, TAB_FOR[item.kind] ?? 'setup')}
                  />
                ))
              )}
            </div>
          </section>

          {checkIns.length > 0 && (
            <section className="m-card" style={{ marginBottom: 16 }}>
              <div className="m-card__head">
                <div>
                  <div className="eyebrow">Activity</div>
                  <h2>Recent check-ins</h2>
                </div>
                <span className="m-tiny">{relativeTime(pulse.lastScanAt)}</span>
              </div>
              <div className="m-card__body m-card__body--flush">
                {checkIns.map(({ result, exam }) => (
                  <button
                    key={result.id}
                    className="m-checkin"
                    onClick={() => onOpenExam(exam.id, 'results')}
                  >
                    <span className="m-checkin__avatar">{initials(result.name)}</span>
                    <span className="m-checkin__body">
                      <strong>{result.name}</strong>
                      <span>{exam.code} · {relativeTime(result.scannedAt)}</span>
                    </span>
                    <span className={`m-checkin__score ${result.needsReview ? 'is-review' : ''}`}>
                      <strong>{Math.round(result.percentage * 10) / 10}%</strong>
                      <small>{result.needsReview ? 'review' : 'checked'}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="m-sectionhead">
            <div>
              <div className="eyebrow">Library</div>
              <h2>Your exams</h2>
            </div>
            {pulses.length > 4 && (
              <label className="m-field" style={{ width: 230, maxWidth: '48vw' }}>
                <span className="m-field__label" style={{ display: 'none' }}>Search exams</span>
                <div style={{ position: 'relative' }}>
                  <Search
                    size={15}
                    style={{ position: 'absolute', left: 10, top: 14, color: 'var(--muted)' }}
                  />
                  <input
                    className="input"
                    style={{ paddingLeft: 32 }}
                    placeholder="Search exams"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
              </label>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="m-note">No exam matches “{query}”. Clear the search to see all {pulses.length}.</div>
          ) : (
            <div className="m-grid">
              {visible.map((entry) => {
                const { exam } = entry;
                const next = nextStepFor(entry);
                const category = CATEGORY_LABELS[exam.category];
                return (
                  <button
                    className="m-examcard"
                    key={exam.id}
                    onClick={() => onOpenExam(exam.id, TAB_FOR[next.kind] ?? 'setup')}
                  >
                    <div className="m-examcard__top">
                      <div style={{ minWidth: 0 }}>
                        <div className="eyebrow">{exam.code} · {exam.quarterKey}</div>
                        <h3>{exam.title || 'Untitled exam'}</h3>
                      </div>
                      <Badge tone={exam.category === 'QSTE' ? 'accent' : exam.category === 'PPT' ? 'blue' : 'green'}>
                        {category.short}
                      </Badge>
                    </div>
                    <div className="m-examcard__meta">
                      <span>{exam.subject || 'No subject'}</span>
                      <span>·</span>
                      <span>{exam.gradeLevel}{exam.section ? ` · ${exam.section}` : ''}</span>
                      <span>·</span>
                      <span>{totalItemCount(exam)} items</span>
                    </div>
                    <div className="m-examcard__meta">
                      <span>
                        Key {entry.keyFilled}/{entry.keyTotal}
                      </span>
                      <span>·</span>
                      <span>
                        {entry.resultCount}/{entry.learnerCount || '—'} checked
                      </span>
                      {entry.reviewCount > 0 && (
                        <>
                          <span>·</span>
                          <span>{entry.reviewCount} to review</span>
                        </>
                      )}
                      {entry.resultCount > 0 && (
                        <>
                          <span>·</span>
                          <span>{entry.averagePercentage}% avg</span>
                        </>
                      )}
                    </div>
                    <div className="m-examcard__foot">
                      <span className="m-chip"><Users size={13} /> {entry.learnerCount} learners</span>
                      <span className="m-chip"><Table2 size={13} /> {entry.resultCount} checked</span>
                      {entry.reviewCount > 0 && <span className="pill pill--amber">{entry.reviewCount} review</span>}
                      <span className="m-spacer" />
                      <span className="m-nextchip">
                        {next.kind === 'print' ? 'Save sheets' : next.label} <ArrowRight size={13} />
                      </span>
                    </div>
                    <span className="m-examcard__stamp">Updated {relativeTime(exam.updatedAt)}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="m-note" style={{ marginTop: 16 }}>
            <strong>This tablet can finish the whole job.</strong> Save the answer sheets as PDF,
            scan the returned papers with the camera, and type written marks in Scores. The save
            dialog asks where the PDF goes, so the tablet needs no computer.
          </div>
        </>
      )}

      <div className="m-row" style={{ marginTop: 22, justifyContent: 'center' }}>
        <span className="m-tiny">Developed by ZX TechLabs · Richmond C. Jabla · saved on this device</span>
      </div>
    </>
  );
}
