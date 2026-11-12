import { useMemo, useState } from 'react';
import { ArrowRight, ListChecks, Plus, Search, Settings, Sparkles, Table2, Users } from 'lucide-react';
import { useApp } from '@shared/store/AppStore';
import { CATEGORY_LABELS } from '@shared/types';
import { totalItemCount } from '@shared/lib/sections';
import { Badge } from '@shared/components/ui';
import { EmptyBlock } from '../components/Common';

export function HomeScreen({
  onOpenExam,
  onNewExam,
  onSettings,
}: {
  onOpenExam: (examId: string) => void;
  onNewExam: () => void;
  onSettings: () => void;
}) {
  const { state } = useApp();
  const [query, setQuery] = useState('');

  const totals = useMemo(() => {
    const results = state.results.length;
    const review = state.results.filter((result) => result.needsReview).length;
    return { exams: state.exams.length, learners: state.learners.length, results, review };
  }, [state.exams, state.learners, state.results]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return state.exams;
    return state.exams.filter((exam) =>
      [exam.title, exam.subject, exam.code, exam.section, exam.quarterKey]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [state.exams, query]);

  const sample = state.exams.length === 0;

  return (
    <>
      <section className="m-hero">
        <div className="eyebrow">Local-first · works offline</div>
        <h1>Check printed answer sheets with the tablet camera.</h1>
        <p>
          Exams, rosters, and scores stay on this device. Print the sheets from the desktop
          app, scan them here, then review anything the scanner flags.
        </p>
        <div className="m-hero__row">
          <div className="m-row">
            <button className="btn btn--primary" onClick={onNewExam}>
              <Plus size={17} /> New exam
            </button>
            <button className="btn btn--soft" onClick={onSettings}>
              <Settings size={16} /> Settings
            </button>
          </div>
          <div className="m-hero__stats">
            <span className="m-chip"><ListChecks size={14} /> {totals.exams} exams</span>
            <span className="m-chip"><Users size={14} /> {totals.learners} learners</span>
            <span className="m-chip"><Table2 size={14} /> {totals.results} checked</span>
            {totals.review > 0 && <span className="pill pill--amber">{totals.review} to review</span>}
          </div>
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
          <div className="m-row m-row--between" style={{ marginBottom: 10 }}>
            <div>
              <div className="eyebrow">Workspace</div>
              <h2 style={{ margin: '2px 0 0', fontFamily: 'var(--serif)', fontWeight: 500 }}>Your exams</h2>
            </div>
            {state.exams.length > 4 && (
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
            <div className="m-note">No exam matches “{query}”. Clear the search to see all {state.exams.length}.</div>
          ) : (
            <div className="m-grid">
              {visible.map((exam) => {
                const learners = state.learners.filter((learner) => learner.examId === exam.id).length;
                const results = state.results.filter((result) => result.examId === exam.id);
                const review = results.filter((result) => result.needsReview).length;
                const category = CATEGORY_LABELS[exam.category];
                return (
                  <button className="m-examcard" key={exam.id} onClick={() => onOpenExam(exam.id)}>
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
                    <div className="m-examcard__foot">
                      <span className="m-chip"><Users size={13} /> {learners} learners</span>
                      <span className="m-chip"><Table2 size={13} /> {results.length} checked</span>
                      {review > 0 && <span className="pill pill--amber">{review} review</span>}
                      <span className="m-spacer" />
                      <span className="m-tiny" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Open <ArrowRight size={13} />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="m-note" style={{ marginTop: 16 }}>
            <strong>Printing lives on the desktop app.</strong> This tablet build reads sheets and keeps
            the class record. Generate and print the answer sheets from the Windows version, then scan
            the returned papers here.
          </div>
        </>
      )}

      <div className="m-row" style={{ marginTop: 22, justifyContent: 'center' }}>
        <span className="m-tiny">Developed by ZX TechLabs · Richmond C. Jabla · saved on this device</span>
      </div>
    </>
  );
}
