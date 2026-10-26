import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BarChart3,
  ClipboardList,
  Download,
  FileText,
  ListChecks,
  PenLine,
  Printer,
  ScanLine,
  Settings2,
  Table2,
  Users,
} from 'lucide-react';
import type { Exam } from '../types';
import { CATEGORY_LABELS } from '../types';
import { useApp } from '../store/AppStore';
import { totalItemCount, totalPoints } from '../lib/sections';
import { Badge } from './ui';
import { SetupTab } from './SetupTab';
import { RosterTab } from './RosterTab';
import { AnswerKeyTab } from './AnswerKeyTab';
import { TosTab } from './TosTab';
import { SheetsTab } from './SheetsTab';
import { ScanTab } from './ScanTab';
import { ScoresTab } from './ScoresTab';
import { ResultsTab } from './ResultsTab';
import { AnalysisTab } from './AnalysisTab';
import { ExportTab } from './ExportTab';

export type WorkspaceTab =
  | 'setup'
  | 'roster'
  | 'key'
  | 'tos'
  | 'sheets'
  | 'scan'
  | 'scores'
  | 'results'
  | 'analysis'
  | 'export';

export function ExamWorkspace({
  exam,
  initialTab = 'setup',
}: {
  exam: Exam;
  initialTab?: WorkspaceTab;
}) {
  const { state } = useApp();
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);
  const keyFilled = exam.answerKey.filter(Boolean).length;
  const reviewCount = results.filter((result) => result.needsReview).length;
  const itemCount = totalItemCount(exam);
  const writtenCount = itemCount - exam.itemCount;
  const pointTotal = totalPoints(exam);

  useEffect(() => {
    setTab(initialTab);
  }, [exam.id, initialTab]);

  const tabs: Array<{ id: WorkspaceTab; label: string; icon: ReactNode; count?: string }> = [
    { id: 'setup', label: 'Setup', icon: <Settings2 size={15} /> },
    { id: 'roster', label: 'Roster', icon: <Users size={15} />, count: String(learners.length) },
    { id: 'key', label: 'Answer key', icon: <ListChecks size={15} />, count: `${keyFilled}/${exam.itemCount}` },
    { id: 'tos', label: 'TOS', icon: <ClipboardList size={15} /> },
    { id: 'sheets', label: 'Sheets', icon: <Printer size={15} /> },
    { id: 'scan', label: 'Scan', icon: <ScanLine size={15} />, count: reviewCount ? String(reviewCount) : undefined },
    { id: 'scores', label: 'Scores', icon: <PenLine size={15} />, count: writtenCount ? String(writtenCount) : undefined },
    { id: 'results', label: 'Results', icon: <Table2 size={15} />, count: results.length ? String(results.length) : undefined },
    { id: 'analysis', label: 'Item analysis', icon: <BarChart3 size={15} />, count: results.length ? String(results.length) : undefined },
    { id: 'export', label: 'Export', icon: <Download size={15} /> },
  ];

  return (
    <>
      <div className="workspace-head">
        <div className="workspace-head__title">
          <div className="eyebrow">{exam.code} · Assessment</div>
          <h1>{exam.title || 'Untitled exam'}</h1>
          <div className="workspace-meta">
            <Badge tone={exam.category === 'QSTE' ? 'accent' : exam.category === 'PPT' ? 'blue' : 'green'}>
              {CATEGORY_LABELS[exam.category].short} · {CATEGORY_LABELS[exam.category].label}
            </Badge>
            <span className="pill pill--neutral">{exam.subject || 'No subject'}</span>
            <span className="pill pill--neutral">{exam.gradeLevel}{exam.section ? ` · ${exam.section}` : ''}</span>
            <span className="pill pill--neutral">{exam.quarterKey}</span>
            <span className="pill pill--neutral">{itemCount} items · {Number.isInteger(pointTotal) ? pointTotal : Math.round(pointTotal * 100) / 100} points</span>
            {writtenCount > 0 && (
              <span className="pill pill--neutral">{exam.itemCount} scanned · {writtenCount} written</span>
            )}
            {keyFilled < exam.itemCount && <span className="pill pill--amber">{exam.itemCount - keyFilled} key items blank</span>}
          </div>
        </div>
        <div className="workspace-actions">
          <button className="btn btn--ghost btn--sm" onClick={() => setTab('key')}>
            <ListChecks size={15} /> Answer key
          </button>
          <button className="btn btn--soft btn--sm" onClick={() => setTab('sheets')}>
            <Printer size={15} /> Print sheets
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => setTab('scan')}>
            <ScanLine size={15} /> Scan batch
          </button>
        </div>
      </div>

      <div className="tabbar" role="tablist" aria-label="Exam workspace">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={`tab ${tab === item.id ? 'is-active' : ''}`}
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
            {item.label}
            {item.count && <span className="tab__count">{item.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'setup' && <SetupTab exam={exam} onNavigate={setTab} />}
      {tab === 'roster' && <RosterTab exam={exam} />}
      {tab === 'key' && <AnswerKeyTab exam={exam} onNavigate={setTab} />}
      {tab === 'tos' && <TosTab exam={exam} />}
      {tab === 'sheets' && <SheetsTab exam={exam} onNavigate={setTab} />}
      {tab === 'scan' && <ScanTab exam={exam} onNavigate={setTab} />}
      {tab === 'scores' && <ScoresTab exam={exam} onNavigate={setTab} />}
      {tab === 'results' && <ResultsTab exam={exam} onNavigate={setTab} />}
      {tab === 'analysis' && <AnalysisTab exam={exam} onNavigate={setTab} />}
      {tab === 'export' && <ExportTab exam={exam} onNavigate={setTab} />}

      <div className="row" style={{ marginTop: 26, justifyContent: 'center' }}>
        <span className="tiny faint">
          <FileText size={12} /> Exam {exam.code} · saved locally · updated {new Date(exam.updatedAt).toLocaleString()}
        </span>
      </div>
    </>
  );
}
