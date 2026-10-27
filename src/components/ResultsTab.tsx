import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  FileDown,
  FileJson,
  FileText,
  PenLine,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import type { Exam, ScanResult } from '../types';
import { useApp } from '../store/AppStore';
import { analyzeItems, rateTone, recalculateResult, summarize } from '../lib/results';
import { manualSlots, materializeItems } from '../lib/sections';
import { scoreResult } from '../lib/scoring';
import { downloadResultsArchive, downloadResultsCsv } from '../lib/exports';
import { downloadBlob } from '../lib/download';
import { buildResultsPdf, reportFilename } from '../lib/reportPdf';
import { Badge, ConfirmDialog, EmptyState, Modal, Segmented, StatCard } from './ui';
import type { WorkspaceTab } from './ExamWorkspace';

type Filter = 'all' | 'review' | 'incomplete' | 'missing';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function roman(index: number): string {
  return ROMAN[index] ?? String(index + 1);
}

function points(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

export function ResultsTab({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: WorkspaceTab) => void }) {
  const { state, updateResult, deleteResult, clearExamResults, toast } = useApp();
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);
  const written = useMemo(() => materializeItems(exam).filter((item) => !item.scannable), [exam]);
  const writtenSlots = useMemo(() => manualSlots(exam), [exam]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<ScanResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ScanResult | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const summary = useMemo(() => summarize(exam, learners, results), [exam, learners, results]);
  const analysis = useMemo(() => analyzeItems(exam, results), [exam, results]);
  const resultByLrn = useMemo(() => new Map(results.map((result) => [result.lrn, result])), [results]);
  const scores = useMemo(
    () => new Map(results.map((result) => [result.id, scoreResult(exam, result)])),
    [exam, results]
  );

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return learners
      .map((learner) => ({ learner, result: resultByLrn.get(learner.lrn) }))
      .filter(({ learner, result }) => {
        if (filter === 'review' && !result?.needsReview) return false;
        if (filter === 'incomplete') {
          const score = result ? scores.get(result.id) : null;
          if (!result || !score || score.complete) return false;
        }
        if (filter === 'missing' && result) return false;
        if (!needle) return true;
        return learner.name.toLowerCase().includes(needle) || learner.lrn.includes(needle);
      });
  }, [learners, resultByLrn, filter, search, scores]);

  const filterOptions = [
    { value: 'all', label: 'All', hint: `${results.length}` },
    { value: 'review', label: 'Review', hint: `${summary.reviewCount}` },
    ...(written.length > 0
      ? [{ value: 'incomplete', label: 'Incomplete', hint: `${summary.incompleteCount}` }]
      : []),
    { value: 'missing', label: 'Missing', hint: `${summary.missingCount}` },
  ];

  return (
    <div className="stack">
      <div className="stat-grid">
        <StatCard label="Checked" value={`${summary.scannedCount}/${summary.rosterCount}`} detail={summary.missingCount ? `${summary.missingCount} still unscanned` : 'Whole class checked'} icon={<Users size={16} />} />
        <StatCard
          label="Class average"
          value={`${summary.averagePercentage}%`}
          detail={
            summary.incompleteCount
              ? `${summary.incompleteCount} incomplete excluded`
              : `Grade ${summary.averageGrade || '—'}`
          }
          icon={<BarChart3 size={16} />}
        />
        <StatCard label="Passing" value={`${summary.passingRate}%`} detail={`${summary.passingCount} at or above ${exam.passingPercent}%`} icon={<CheckCircle2 size={16} />} />
        <StatCard label="To review" value={summary.reviewCount} detail={summary.reviewCount ? 'Smudged, doubled, or unread QR' : 'Nothing flagged'} icon={<AlertTriangle size={16} />} />
      </div>

      <section className="card">
        <div className="card-head">
          <div className="card-head__title">
            <h3>Checked sheets</h3>
            <p>Open a sheet to correct an answer. Corrections immediately update the combined score and grade.</p>
          </div>
          <div className="row row--wrap" style={{ gap: 6 }}>
            {written.length > 0 && (
              <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('scores')}>
                <PenLine size={14} /> Written scores
              </button>
            )}
            <button className="btn btn--ghost btn--sm" onClick={() => { downloadResultsCsv(state, exam); toast('Results CSV downloaded.', 'success'); }}>
              <Download size={14} /> CSV
            </button>
            <button
              className="btn btn--soft btn--sm"
              disabled={results.length === 0}
              onClick={async () => {
                try {
                  const bytes = await buildResultsPdf(exam, learners, results, state.settings);
                  downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), reportFilename('Results', exam));
                  toast('Results PDF downloaded.', 'success');
                } catch (error) {
                  toast(error instanceof Error ? error.message : 'The PDF could not be generated.', 'danger');
                }
              }}
            >
              <FileDown size={14} /> PDF
            </button>
            <button className="btn btn--soft btn--sm" onClick={() => { downloadResultsArchive(state, exam); toast('Results JSON downloaded.', 'success'); }}>
              <FileJson size={14} /> JSON
            </button>
          </div>
        </div>
        <div className="card-body">
          {results.length === 0 ? (
            <EmptyState
              icon={<FileText size={26} />}
              title="No sheets checked yet"
              message="Scan the stack as a PDF, or drop a page photo. Results appear here automatically."
              action={<button className="btn btn--primary" onClick={() => onNavigate('scan')}>Open scanner</button>}
            />
          ) : (
            <>
              <div className="key-toolbar">
                <Segmented
                  size="sm"
                  value={filter}
                  options={filterOptions}
                  onChange={(value) => setFilter(value as Filter)}
                />
                <div className="row" style={{ position: 'relative' }}>
                  <Search size={15} className="muted" style={{ position: 'absolute', left: 10 }} />
                  <input
                    className="input"
                    style={{ paddingLeft: 32, minWidth: 230 }}
                    placeholder="Search name or LRN"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              </div>

              {summary.incompleteCount > 0 && (
                <div className="card-note card-note--warn" style={{ marginBottom: 12 }}>
                  {summary.incompleteCount} checked sheet{summary.incompleteCount === 1 ? ' has' : 's have'} a blank
                  written score. They stay out of the class average until every written score is entered.
                  <button className="btn btn--soft btn--sm" style={{ marginLeft: 10 }} onClick={() => onNavigate('scores')}>
                    <PenLine size={13} /> Open written scores
                  </button>
                </div>
              )}

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Learner</th>
                      <th>LRN</th>
                      <th>Points</th>
                      <th>%</th>
                      <th>Grade</th>
                      <th>Status</th>
                      <th>Checked</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ learner, result }) => {
                      const score = result ? scores.get(result.id) : null;
                      const incomplete = Boolean(score && !score.complete);
                      return (
                        <tr key={learner.id}>
                          <td className="name-cell">{learner.name}</td>
                          <td className="mono small">{learner.lrn}</td>
                          <td className="num">
                            {score ? (
                              <div className="score-cell">
                                <span><strong>{points(score.earned)}</strong> / {points(score.possible)}</span>
                                {score.manualCount > 0 && (
                                  <small>
                                    {points(score.objectiveEarned)} scanned + {points(score.manualEarned)} written
                                  </small>
                                )}
                              </div>
                            ) : '—'}
                          </td>
                          <td className="num">{score ? `${score.percentage}%` : '—'}</td>
                          <td>
                            {score ? (
                              <span className={`score ${score.grade >= 90 ? 'score--good' : score.percentage >= exam.passingPercent ? 'score--mid' : 'score--low'}`}>
                                {score.grade}
                              </span>
                            ) : '—'}
                          </td>
                          <td>
                            {result && score ? (
                              result.needsReview ? (
                                <span className="pill pill--amber"><AlertTriangle size={11} /> review</span>
                              ) : incomplete ? (
                                <span className="pill pill--amber"><PenLine size={11} /> incomplete</span>
                              ) : result.manualOverride ? (
                                <span className="pill pill--neutral">edited</span>
                              ) : (
                                <span className="pill pill--green">ok</span>
                              )
                            ) : (
                              <span className="pill pill--neutral">not scanned</span>
                            )}
                          </td>
                          <td className="small muted">
                            {result ? new Date(result.scannedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                          </td>
                          <td className="actions-cell">
                            <div className="row" style={{ gap: 3, justifyContent: 'flex-end' }}>
                              {result ? (
                                <>
                                  <button className={`btn btn--sm ${result.needsReview ? 'btn--primary' : 'btn--soft'}`} onClick={() => setDetail(result)}>
                                    {result.needsReview ? 'Review' : 'Open'}
                                  </button>
                                  <button className="icon-btn icon-btn--sm icon-btn--danger" title="Delete result" onClick={() => setConfirmDelete(result)}>
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              ) : (
                                <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('scan')}>Scan</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {rows.length === 0 && (
                  <div className="table-empty">
                    {filter === 'missing'
                      ? 'Everyone in this roster has a checked sheet.'
                      : filter === 'incomplete'
                        ? 'Every checked sheet has all written scores.'
                        : 'No learners match that search.'}
                  </div>
                )}
              </div>

              {filter === 'all' && summary.missingCount > 0 && (
                <p className="tiny faint" style={{ marginTop: 10 }}>
                  {summary.missingCount} learner{summary.missingCount === 1 ? '' : 's'} without a checked sheet. Use the Missing filter to see them.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {results.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Scanned item distribution</h3>
              <p>
                Percent of the class that answered each scanned item correctly. Hover an item for the distribution.
                {writtenSlots.length > 0
                  ? ` ${writtenSlots.length} written score row${writtenSlots.length === 1 ? '' : 's'} are in the Item analysis tab.`
                  : ''}
              </p>
            </div>
            <div className="analysis-legend">
              <span><i className="legend-dot legend-dot--good" /> 70%+</span>
              <span><i className="legend-dot legend-dot--mid" /> 40–69%</span>
              <span><i className="legend-dot legend-dot--low" /> below 40%</span>
            </div>
          </div>
          <div className="card-body">
            {analysis.length === 0 ? (
              <p className="tiny faint">This test has no scanned items.</p>
            ) : (
              <div className="analysis-grid">
                {analysis.map((item) => {
                  const tone = rateTone(item.rate);
                  return (
                    <div className="analysis-cell" key={item.item}>
                      <span className="analysis-cell__num">{item.item}</span>
                      <div className="analysis-cell__bar">
                        <div className={`analysis-cell__fill analysis-cell__fill--${tone}`} style={{ width: `${item.rate}%` }} />
                      </div>
                      <div className="analysis-cell__tip">
                        <strong>Item {item.item} · key {item.key || 'missing'}</strong>
                        {item.rate}% correct · {item.blank} blank
                        {item.distribution.map((entry) => (
                          <div key={entry.choice}>{entry.choice}: {entry.count}</div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {results.length > 0 && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn--ghost btn--sm" onClick={() => setConfirmClear(true)}>
            <Trash2 size={14} /> Clear all checked sheets
          </button>
        </div>
      )}

      <ResultDetail
        exam={exam}
        result={detail}
        onClose={() => setDetail(null)}
        onOpenScores={() => {
          setDetail(null);
          onNavigate('scores');
        }}
        onSave={(answers) => {
          if (!detail) return;
          const updated = recalculateResult(exam, { ...detail, answers });
          updateResult(detail.id, updated);
          setDetail(updated);
          toast('Correction saved and score recalculated.', 'success');
        }}
        onDelete={() => {
          if (detail) setConfirmDelete(detail);
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this checked sheet?"
        message={
          <>
            The result for <strong>{confirmDelete?.name}</strong> will be removed, including any written scores typed for
            that learner. You can scan the sheet again at any time.
          </>
        }
        confirmLabel="Delete result"
        danger
        onConfirm={() => {
          if (confirmDelete) {
            deleteResult(confirmDelete.id);
            if (detail?.id === confirmDelete.id) setDetail(null);
            toast('Checked sheet deleted.', 'danger');
          }
        }}
        onClose={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={confirmClear}
        title="Clear every checked sheet?"
        message={`All ${results.length} results for this exam will be deleted, including written scores. The roster and answer key stay. Export the JSON first if you need a record.`}
        confirmLabel="Clear results"
        danger
        onConfirm={() => {
          clearExamResults(exam.id);
          toast('All checked sheets cleared.', 'danger');
        }}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  );
}

function ResultDetail({
  exam,
  result,
  onClose,
  onOpenScores,
  onSave,
  onDelete,
}: {
  exam: Exam;
  result: ScanResult | null;
  onClose: () => void;
  onOpenScores: () => void;
  onSave: (answers: (string | null)[]) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<(string | null)[]>([]);
  const items = useMemo(() => materializeItems(exam).filter((item) => item.scannable), [exam]);

  useEffect(() => {
    setDraft(result?.answers ?? []);
  }, [result]);

  if (!result) return null;

  const score = scoreResult(exam, { ...result, answers: draft });
  const flagByItem = new Map(result.flags.map((flag) => [flag.item, flag]));
  const dirty = draft.some((answer, index) => answer !== result.answers[index]);

  const setChoice = (index: number, choice: string | null) => {
    setDraft((prev) => prev.map((answer, position) => (position === index ? (answer === choice ? null : choice) : answer)));
  };

  return (
    <Modal
      open={Boolean(result)}
      title={result.name}
      eyebrow={`LRN ${result.lrn} · ${result.qrOk ? 'QR matched' : 'QR not matched'}`}
      onClose={onClose}
      width={860}
      footer={
        <>
          <button className="btn btn--danger btn--ghost" onClick={onDelete}>
            <Trash2 size={14} /> Delete result
          </button>
          <div className="grow" />
          {score.manualCount > 0 && (
            <button className="btn btn--ghost" onClick={onOpenScores}>
              <PenLine size={14} /> Written scores
            </button>
          )}
          <button className="btn btn--ghost" onClick={onClose}>Close</button>
          <button className="btn btn--primary" onClick={() => onSave(draft)} disabled={!dirty}>
            Save corrections
          </button>
        </>
      }
    >
      <div className="row row--wrap" style={{ justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <div className="scan-result__stats">
          <span><strong>{points(score.earned)}</strong> / {points(score.possible)} points</span>
          <span><strong>{score.percentage}%</strong></span>
          <span>Grade <strong>{score.grade}</strong></span>
          {score.manualCount > 0 && (
            <span>{points(score.objectiveEarned)} scanned + {points(score.manualEarned)} written</span>
          )}
          {result.flags.length > 0 && <span>{result.flags.length} flagged</span>}
          {result.manualOverride && <Badge tone="neutral">manually edited</Badge>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {result.qrOk ? <Badge tone="green">QR ok</Badge> : <Badge tone="rose">QR failed</Badge>}
          {score.manualCount > 0 && !score.complete && (
            <Badge tone="amber">{score.manualCount - score.manualScored} written blank</Badge>
          )}
          <Badge tone={result.needsReview ? 'amber' : 'green'}>{result.needsReview ? 'needs review' : 'reviewed'}</Badge>
        </div>
      </div>

      <div className="card-note" style={{ marginBottom: 14 }}>
        Source: {result.sourceFile || 'manual'} · page {result.pageNumber} · checked {new Date(result.scannedAt).toLocaleString()}
        {result.flags.length > 0 ? ' · amber items were flagged by the scanner.' : ''}
        {score.manualCount > 0 ? ` · written ${points(score.manualEarned)} of ${points(score.manualPossible)} points in ${score.manualScored}/${score.manualCount} scores.` : ''}
      </div>

      <div className="detail-answer-grid">
        {items.map((item, position) => {
          const answerIndex = item.answerIndex ?? 0;
          const answer = draft[answerIndex] ?? null;
          const key = exam.answerKey[answerIndex] ?? '';
          const wrong = Boolean(answer && key && answer !== key);
          const blank = !answer;
          const flag = flagByItem.get(item.number);
          const newSection = position === 0 || items[position - 1].sectionIndex !== item.sectionIndex;
          return (
            <Fragment key={`${item.sectionId}:${item.indexInSection}`}>
              {newSection && (
                <div className="detail-section-head">
                  <strong>Part {roman(item.sectionIndex)} · {item.sectionTitle}</strong>
                  <span>{points(item.points)} pt each</span>
                </div>
              )}
              <div className={`detail-answer-row ${wrong ? 'is-wrong' : ''} ${blank ? 'is-blank' : ''}`}>
                <span className="detail-answer-row__item">{String(item.number).padStart(2, '0')}</span>
                <span className="detail-answer-row__key">{key || '—'}</span>
                <div className="detail-answer-row__answer">
                  {item.choices.map((choice) => (
                    <button
                      key={choice}
                      className={`answer-toggle ${answer === choice ? 'is-active' : ''} ${key === choice ? 'is-key' : ''}`}
                      onClick={() => setChoice(answerIndex, choice)}
                      aria-pressed={answer === choice}
                    >
                      {choice}
                    </button>
                  ))}
                  {blank && <span className="pill pill--amber" style={{ marginLeft: 4 }}>blank</span>}
                  {flag && (
                    <span className="flag-chip" style={{ marginLeft: 4 }}>
                      {flag.multiple ? 'double shade' : flag.ambiguous ? 'close call' : 'faint'}
                    </span>
                  )}
                </div>
                <span className="tiny faint">{wrong ? 'wrong' : answer ? 'correct' : 'blank'}</span>
              </div>
            </Fragment>
          );
        })}
        {items.length === 0 && <p className="tiny faint">This test has no scanned items.</p>}
      </div>
    </Modal>
  );
}
