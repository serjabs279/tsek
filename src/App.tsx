import { useEffect, useState } from 'react';
import { HardDrive, LayoutGrid, Plus, Settings, ShieldCheck } from 'lucide-react';
import { useApp } from './store/AppStore';
import { ExamList } from './components/ExamList';
import { ExamWorkspace, type WorkspaceTab } from './components/ExamWorkspace';
import { SettingsView } from './components/SettingsView';
import { NewExamModal } from './components/NewExamModal';
import { CATEGORY_LABELS } from './types';
import { totalItemCount } from './lib/sections';

type View = 'exams' | 'exam' | 'settings';

export default function App() {
  const { state, activeExam, setActiveExam } = useApp();
  const [view, setView] = useState<View>('exams');
  const [tab, setTab] = useState<WorkspaceTab>('setup');
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [newExamOpen, setNewExamOpen] = useState(false);

  useEffect(() => {
    if (view === 'exam' && !activeExam) setView('exams');
  }, [view, activeExam]);

  const openExam = (examId: string, initialTab: WorkspaceTab = 'setup') => {
    setActiveExam(examId);
    setTab(initialTab);
    setWorkspaceKey((key) => key + 1);
    setView('exam');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goExams = () => {
    setView('exams');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" onClick={goExams} role="button" tabIndex={0} onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') goExams();
        }}>
          <div className="brand__mark">T</div>
          <div>
            <div className="brand__name">Tsek</div>
            <div className="brand__sub">Exam Checker</div>
          </div>
        </div>

        <nav className="nav">
          <button className={`nav-item ${view === 'exams' || view === 'exam' ? 'is-active' : ''}`} onClick={goExams}>
            <LayoutGrid size={17} /> All exams
            <span className="nav-item__meta">{state.exams.length}</span>
          </button>
          <button className={`nav-item ${view === 'settings' ? 'is-active' : ''}`} onClick={() => setView('settings')}>
            <Settings size={17} /> Settings
          </button>
          <button className="nav-item" onClick={() => setNewExamOpen(true)}>
            <Plus size={17} /> New exam
          </button>
        </nav>

        <div className="sidebar-label">Recent exams</div>
        <div className="sidebar-exams">
          {state.exams.length === 0 && <span className="small faint" style={{ padding: '0 10px' }}>No exams yet.</span>}
          {state.exams.map((exam) => (
            <button
              key={exam.id}
              className={`sidebar-exam ${view === 'exam' && activeExam?.id === exam.id ? 'is-active' : ''}`}
              onClick={() => openExam(exam.id)}
              title={exam.title}
            >
              <span className="sidebar-exam__title">{exam.title}</span>
              <span className="sidebar-exam__meta">
                {CATEGORY_LABELS[exam.category].short} · {totalItemCount(exam)} items · {exam.code}
              </span>
            </button>
          ))}
        </div>

        <div className="sidebar-foot">
          <div className="local-note">
            <HardDrive size={15} />
            <span>Saved on this device. Back up from Settings before clearing app data.</span>
          </div>
          <div className="row" style={{ gap: 6, padding: '0 2px' }}>
            <ShieldCheck size={13} className="muted" />
            <span className="tiny faint">No uploads · works offline</span>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__crumbs">
            <span>Workspace</span>
            <span className="faint">/</span>
            {view === 'exam' && activeExam ? (
              <>
                <button className="btn btn--ghost btn--sm" style={{ padding: '2px 6px', minHeight: 0 }} onClick={goExams}>
                  Exams
                </button>
                <span className="faint">/</span>
                <strong>{activeExam.title}</strong>
              </>
            ) : (
              <strong>{view === 'settings' ? 'Settings' : 'Exams'}</strong>
            )}
          </div>
          <div className="topbar__right">
            <button
              className="icon-btn"
              title="Settings"
              aria-label="Settings"
              onClick={() => setView('settings')}
            >
              <Settings size={18} />
            </button>
            {view === 'exam' && activeExam ? (
              <>
                <span className="pill pill--neutral mono">{activeExam.code}</span>
                <button className="btn btn--soft btn--sm" onClick={() => setNewExamOpen(true)}>
                  <Plus size={14} /> New exam
                </button>
              </>
            ) : (
              <button className="btn btn--primary btn--sm" onClick={() => setNewExamOpen(true)}>
                <Plus size={14} /> New exam
              </button>
            )}
          </div>
        </header>

        <main className="content">
          {view === 'settings' && <SettingsView />}
          {view === 'exams' && (
            <ExamList
              onOpenExam={(id) => openExam(id)}
              onNewExam={() => setNewExamOpen(true)}
            />
          )}
          {view === 'exam' && activeExam && (
            <ExamWorkspace key={workspaceKey} exam={activeExam} initialTab={tab} />
          )}
        </main>

        <footer className="app-footer">
          <div className="app-footer__left">
            <span>
              Developed by <strong>ZX TechLabs</strong>
            </span>
            <span className="app-footer__dot">·</span>
            <span>Developer: Richmond C. Jabla</span>
          </div>
          <div className="app-footer__right">
            <span>Tsek · Open Exam Checker · Local-first paper-to-JSON workflow</span>
          </div>
        </footer>
      </div>

      <NewExamModal
        open={newExamOpen}
        onClose={() => setNewExamOpen(false)}
        onCreated={(examId) => openExam(examId, 'key')}
      />
    </div>
  );
}
