import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  ListChecks,
  ScanLine,
  Settings,
  Settings2,
  Table2,
  Users,
} from 'lucide-react';
import { useApp } from '@shared/store/AppStore';
import { HomeScreen } from './screens/HomeScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SetupScreen } from './screens/SetupScreen';
import { RosterScreen } from './screens/RosterScreen';
import { KeyScreen } from './screens/KeyScreen';
import { ScanScreen } from './screens/ScanScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { AnalysisScreen } from './screens/AnalysisScreen';
import { NewExamSheet } from './components/NewExamSheet';
import { totalItemCount } from '@shared/lib/sections';

export type ExamTab = 'setup' | 'roster' | 'key' | 'scan' | 'results' | 'analysis';
type View = 'home' | 'exam' | 'settings';

const TABS: Array<{ id: ExamTab; label: string; icon: typeof ScanLine }> = [
  { id: 'setup', label: 'Setup', icon: Settings2 },
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'key', label: 'Key', icon: ListChecks },
  { id: 'scan', label: 'Scan', icon: ScanLine },
  { id: 'results', label: 'Results', icon: Table2 },
  { id: 'analysis', label: 'Analysis', icon: BarChart3 },
];

export function MobileApp() {
  const { state, activeExam, setActiveExam } = useApp();
  const [view, setView] = useState<View>('home');
  const [tab, setTab] = useState<ExamTab>('setup');
  const [newExamOpen, setNewExamOpen] = useState(false);

  useEffect(() => {
    if (view === 'exam' && !activeExam) setView('home');
  }, [view, activeExam]);

  const openExam = (examId: string, initialTab: ExamTab = 'setup') => {
    setActiveExam(examId);
    setTab(initialTab);
    setView('exam');
    window.scrollTo({ top: 0 });
  };

  const goHome = () => {
    setView('home');
    window.scrollTo({ top: 0 });
  };

  const openTab = (next: ExamTab) => {
    setTab(next);
    window.scrollTo({ top: 0 });
  };

  const learners = activeExam ? state.learners.filter((learner) => learner.examId === activeExam.id) : [];
  const results = activeExam ? state.results.filter((result) => result.examId === activeExam.id) : [];
  const reviewCount = results.filter((result) => result.needsReview).length;
  const keyFilled = activeExam ? activeExam.answerKey.filter(Boolean).length : 0;

  const badges: Partial<Record<ExamTab, string>> = {
    roster: learners.length ? String(learners.length) : '',
    key: activeExam && activeExam.itemCount ? `${keyFilled}/${activeExam.itemCount}` : '',
    results: results.length ? String(results.length) : '',
    analysis: results.length ? String(results.length) : '',
  };

  return (
    <div className="m-shell">
      <header className="m-appbar">
        {view === 'exam' && activeExam ? (
          <>
            <button className="m-iconbtn" onClick={goHome} aria-label="Back to exams">
              <ArrowLeft size={18} />
            </button>
            <div className="m-appbar__title">
              <div className="m-appbar__eyebrow">{activeExam.code} · {totalItemCount(activeExam)} items</div>
              <div className="m-appbar__name">{activeExam.title || 'Untitled exam'}</div>
            </div>
          </>
        ) : (
          <div className="m-appbar__brand">
            <div className="m-appbar__mark">T</div>
            <div className="m-appbar__title">
              <div className="m-appbar__eyebrow">Tsek · Android</div>
              <div className="m-appbar__name">{view === 'settings' ? 'Settings' : 'Exam Checker'}</div>
            </div>
          </div>
        )}
        <div className="m-appbar__spacer" />
        <button
          className="m-iconbtn"
          aria-label="Settings"
          onClick={() => setView(view === 'settings' ? 'home' : 'settings')}
        >
          <Settings size={18} />
        </button>
      </header>

      <main className={`m-main ${view === 'exam' ? '' : 'm-main--plain'}`}>
        {view === 'home' && (
          <HomeScreen
            onOpenExam={(id) => openExam(id)}
            onNewExam={() => setNewExamOpen(true)}
            onSettings={() => setView('settings')}
          />
        )}
        {view === 'settings' && <SettingsScreen onBack={goHome} />}
        {view === 'exam' && activeExam && (
          <>
            {tab === 'setup' && <SetupScreen exam={activeExam} onNavigate={openTab} onDeleted={goHome} />}
            {tab === 'roster' && <RosterScreen exam={activeExam} />}
            {tab === 'key' && <KeyScreen exam={activeExam} onNavigate={openTab} />}
            {tab === 'scan' && <ScanScreen exam={activeExam} onNavigate={openTab} />}
            {tab === 'results' && <ResultsScreen exam={activeExam} onNavigate={openTab} />}
            {tab === 'analysis' && <AnalysisScreen exam={activeExam} onNavigate={openTab} />}
          </>
        )}
      </main>

      {view === 'exam' && activeExam && (
        <nav className="m-tabbar" aria-label="Exam sections">
          {TABS.map((item) => {
            const Icon = item.icon;
            const badge = badges[item.id];
            return (
              <button
                key={item.id}
                className={`m-tab ${tab === item.id ? 'is-active' : ''}`}
                onClick={() => openTab(item.id)}
                aria-current={tab === item.id ? 'page' : undefined}
              >
                <span className="m-tab__icon">
                  <Icon size={19} />
                  {item.id === 'scan' && reviewCount > 0 && <span className="m-tab__dot" />}
                </span>
                <span>
                  {item.label}
                  {badge && <span className="m-tab__count">{badge}</span>}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      <NewExamSheet
        open={newExamOpen}
        onClose={() => setNewExamOpen(false)}
        onCreated={(examId) => {
          setNewExamOpen(false);
          openExam(examId, 'setup');
        }}
      />
    </div>
  );
}
