import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Eraser, FileDown, PenLine, ScanLine } from 'lucide-react';
import type { Exam, ScanResult } from '../types';
import { useApp } from '../store/AppStore';
import { downloadBlob } from '../lib/download';
import { buildScoresPdf, reportFilename } from '../lib/reportPdf';
import { examSections, isPartScored, manualItems, partScoreKey, type MaterialItem } from '../lib/sections';
import { scoreResult } from '../lib/scoring';
import { summarize } from '../lib/results';
import { Badge, ConfirmDialog, ProgressBar } from './ui';
import type { WorkspaceTab } from './ExamWorkspace';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function roman(index: number): string {
  return ROMAN[index] ?? String(index + 1);
}

function points(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface WrittenGroup {
  id: string;
  title: string;
  sectionIndex: number;
  start: number;
  end: number;
  points: number;
  part: boolean;
  items: MaterialItem[];
}

function groupByPart(items: MaterialItem[], pooled: Set<string>): WrittenGroup[] {
  const groups: WrittenGroup[] = [];
  items.forEach((item) => {
    const last = groups[groups.length - 1];
    if (last && last.id === item.sectionId) {
      last.items.push(item);
      last.end = item.number;
      last.points = round2(last.points + item.points);
      return;
    }
    groups.push({
      id: item.sectionId,
      title: item.sectionTitle,
      sectionIndex: item.sectionIndex,
      start: item.number,
      end: item.number,
      points: item.points,
      part: pooled.has(item.sectionId),
      items: [item],
    });
  });
  return groups;
}

function ScoreCell({
  value,
  max,
  row,
  col,
  label,
  part,
  onChange,
}: {
  value: number | undefined;
  max: number;
  row: number;
  col: number;
  label: string | number;
  part?: boolean;
  onChange: (value: number | undefined) => void;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(value === undefined ? '' : String(value));
  }, [value, focused]);

  const commit = (raw: string) => {
    if (raw.trim() === '') {
      onChange(undefined);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onChange(round2(Math.max(0, Math.min(max, parsed))));
  };

  return (
    <input
      className={`score-input ${part ? 'score-input--part' : ''} ${value === undefined ? 'is-blank' : ''}`}
      value={text}
      inputMode="decimal"
      aria-label={`Score for ${label}`}
      data-score={`${row}:${col}`}
      onFocus={(event) => {
        setFocused(true);
        event.target.select();
      }}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        commit(next);
      }}
      onBlur={() => {
        setFocused(false);
        const parsed = Number(text);
        if (text.trim() === '' || !Number.isFinite(parsed)) {
          onChange(undefined);
          setText('');
          return;
        }
        const clamped = round2(Math.max(0, Math.min(max, parsed)));
        onChange(clamped);
        setText(String(clamped));
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === 'ArrowDown') {
          event.preventDefault();
          const next = document.querySelector<HTMLInputElement>(`input[data-score="${row + 1}:${col}"]`);
          next?.focus();
          next?.select();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          const previous = document.querySelector<HTMLInputElement>(`input[data-score="${row - 1}:${col}"]`);
          previous?.focus();
          previous?.select();
        }
      }}
    />
  );
}

export function ScoresTab({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: WorkspaceTab) => void }) {
  const { state, updateResult, toast } = useApp();  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const written = useMemo(() => manualItems(exam), [exam]);
  const pooledSections = useMemo(
    () => new Set(examSections(exam).filter(isPartScored).map((section) => section.id)),
    [exam]
  );
  const groups = useMemo(() => groupByPart(written, pooledSections), [written, pooledSections]);
  // Each entry is one box on the sheet: a written item, or one total for a
  // pooled written part.
  const scoreColumns = useMemo(
    () =>
      groups.flatMap((group) =>
        group.part
          ? [
              {
                key: partScoreKey(group.id),
                max: group.points,
                label: `Part ${roman(group.sectionIndex)} total`,
                part: true,
                span: group.items.length,
                number: group.start,
              },
            ]
          : group.items.map((item) => ({
              key: item.manualKey as string,
              max: item.points,
              label: String(item.number),
              part: false,
              span: 1,
              number: item.number,
            }))
      ),
    [groups]
  );
  const byLrn = useMemo(
    () => new Map(state.results.filter((result) => result.examId === exam.id).map((result) => [result.lrn, result])),
    [state.results, exam.id]
  );
  const results = useMemo(() => [...byLrn.values()], [byLrn]);
  const summary = useMemo(() => summarize(exam, learners, results), [exam, learners, results]);

  const [confirmZero, setConfirmZero] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const exportPdf = async () => {
    if (results.length === 0) {
      toast('Scan at least one sheet before downloading the score matrix.', 'danger');
      return;
    }
    try {
      const bytes = await buildScoresPdf(exam, learners, results, state.settings);
      downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), reportFilename('Scores', exam));
      toast('Score matrix PDF downloaded.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The PDF could not be generated.', 'danger');
    }
  };

  const writtenPoints = round2(scoreColumns.reduce((sum, column) => sum + column.max, 0));
  const scoredLearners = results.filter((result) => {
    const scores = result.manualScores ?? {};
    return scoreColumns.every((column) => scores[column.key] !== undefined);
  }).length;
  const completeCount = results.filter((result) => scoreResult(exam, result).complete).length;

  const setScore = (result: ScanResult, key: string, value: number | undefined) => {
    const next = { ...(result.manualScores ?? {}) };
    if (value === undefined) delete next[key];
    else next[key] = value;
    updateResult(result.id, { manualScores: next });
  };

  const fillBlankWithZero = () => {
    results.forEach((result) => {
      const scores = { ...(result.manualScores ?? {}) };
      let changed = false;
      scoreColumns.forEach((column) => {
        if (scores[column.key] === undefined) {
          scores[column.key] = 0;
          changed = true;
        }
      });
      if (changed) updateResult(result.id, { manualScores: scores });
    });
    setConfirmZero(false);
    toast('Missing written scores were set to 0. A blank is not the same as a zero.', 'success');
  };

  const clearWritten = () => {
    results.forEach((result) => updateResult(result.id, { manualScores: {} }));
    setConfirmClear(false);
    toast('Written scores cleared. Scanned answers are untouched.', 'danger');
  };

  if (written.length === 0) {
    return (
      <section className="card">
        <div className="card-body">
          <div className="scores-empty">
            <div className="scores-empty__icon"><PenLine size={24} /></div>
            <h3>No written parts yet</h3>
            <p>
              Add a written part — essay, enumeration, identification, or modified true or false — in Setup, then its
              scores can be typed here and added to the scanned total.
            </p>
            <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <button className="btn btn--primary btn--sm" onClick={() => onNavigate('setup')}>
                Open setup <ArrowRight size={14} />
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('scan')}>
                <ScanLine size={14} /> Scan sheets
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div className="card-head__title">
            <h3>Written scores</h3>
            <p>
              Type each learner’s score for the items that cannot be scanned. It adds to the scanned score automatically.
              A pooled part takes one total for the whole part. Leave a box empty while unscored;{' '}
              <strong>0</strong> means the learner scored zero.
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Badge tone="neutral"><PenLine size={12} /> {written.length} items</Badge>
            <Badge tone="accent">{points(writtenPoints)} pts possible</Badge>
            <button className="btn btn--soft btn--sm" onClick={() => void exportPdf()} disabled={results.length === 0}>
              <FileDown size={14} /> PDF
            </button>
          </div>
        </div>
        <div className="card-body">
          <div className="score-summary">
            <div>
              <span>Learners scored</span>
              <strong>{scoredLearners}<small>/{results.length}</small></strong>
            </div>
            <div>
              <span>Complete sheets</span>
              <strong>{completeCount}<small>/{results.length}</small></strong>
            </div>
            <div>
              <span>Class average</span>
              <strong>{summary.averagePercentage.toFixed(1)}%</strong>
            </div>
            <div>
              <span>Passing</span>
              <strong>{summary.passingCount}<small>/{summary.rosterCount}</small></strong>
            </div>
          </div>

          <div className="row row--wrap" style={{ justifyContent: 'space-between', marginTop: 14, gap: 8 }}>
            <span className="small muted">
              {summary.incompleteCount > 0
                ? `${summary.incompleteCount} checked sheet${summary.incompleteCount === 1 ? '' : 's'} still missing a written score.`
                : 'Every checked sheet has all written scores.'}
            </span>
            <div className="row row--wrap" style={{ gap: 6 }}>
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirmZero(true)} disabled={results.length === 0}>
                <CheckCircle2 size={14} /> Fill blanks with 0
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirmClear(true)} disabled={results.length === 0}>
                <Eraser size={14} /> Clear written scores
              </button>
            </div>
          </div>

          <div className="score-legend">
            <span><i className="score-legend__swatch score-legend__swatch--blank" /> empty = not yet scored</span>
            <span><i className="score-legend__swatch score-legend__swatch--zero" /> 0 = scored zero</span>
            {groups.some((group) => group.part) && (
              <span><i className="score-legend__swatch score-legend__swatch--pool" /> pooled part = one total for all its items</span>
            )}
            <span>Enter or ↓ moves down the column</span>
          </div>

          {results.length === 0 ? (
            <div className="card-note card-note--warn" style={{ marginTop: 12 }}>
              No checked sheets yet. Scan the answer sheets first, then their written scores can be entered here. You can
              still fill the written parts for a learner whose sheet has been scanned.
              <button className="btn btn--soft btn--sm" style={{ marginLeft: 10 }} onClick={() => onNavigate('scan')}>
                <ScanLine size={14} /> Scan a batch
              </button>
            </div>
          ) : (
            <div className="score-matrix">
              <table className="score-table">
                <thead>
                  <tr className="score-table__groups">
                    <th className="score-table__learner" rowSpan={2}>Learner</th>
                    {groups.map((group) => (
                      <th className="score-table__group" colSpan={group.items.length} key={group.id}>
                        Part {roman(group.sectionIndex)} · {group.title}
                        <small>
                          items {group.start}–{group.end}
                          {group.part ? ` · one total of ${points(group.points)} pts` : ''}
                        </small>
                      </th>
                    ))}
                    <th className="score-table__total" rowSpan={2}>Written</th>
                    <th className="score-table__total" rowSpan={2}>Scanned</th>
                    <th className="score-table__total" rowSpan={2}>Combined</th>
                  </tr>
                  <tr>
                    {scoreColumns.map((column) => (
                      <th
                        className={`score-table__item ${column.part ? 'score-table__item--part' : ''}`}
                        colSpan={column.span}
                        key={column.key}
                      >
                        {column.part ? 'whole part' : column.number}
                        <small>/{points(column.max)}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {learners.map((learner, rowIndex) => {
                    const result = byLrn.get(learner.lrn) ?? null;
                    const breakdown = result ? scoreResult(exam, result) : null;
                    const incomplete = breakdown ? !breakdown.complete : false;
                    return (
                      <tr key={learner.id} className={result ? '' : 'is-unscanned'}>
                        <th className="score-table__learner">
                          <span className="score-table__name">{learner.name}</span>
                          <small>{learner.lrn}</small>
                        </th>
                        {scoreColumns.map((column, colIndex) =>
                          result ? (
                            <td
                              key={column.key}
                              colSpan={column.span}
                              className={column.part ? 'score-table__part-cell' : undefined}
                            >
                              <ScoreCell
                                value={result.manualScores?.[column.key]}
                                max={column.max}
                                row={rowIndex}
                                col={colIndex}
                                label={column.label}
                                part={column.part}
                                onChange={(value) => setScore(result, column.key, value)}
                              />
                            </td>
                          ) : (
                            <td key={column.key} colSpan={column.span} className="score-table__muted">—</td>
                          )
                        )}
                        <td className="score-table__total">
                          {breakdown ? (
                            <>
                              <strong>{points(breakdown.manualEarned)}</strong>
                              <small>/{points(breakdown.manualPossible)}</small>
                            </>
                          ) : '—'}
                        </td>
                        <td className="score-table__total">
                          {breakdown ? (
                            <>
                              <strong>{points(breakdown.objectiveEarned)}</strong>
                              <small>/{points(breakdown.objectivePossible)}</small>
                            </>
                          ) : '—'}
                        </td>
                        <td className="score-table__total score-table__combined">
                          {breakdown ? (
                            <>
                              <strong className={`percentage ${incomplete ? 'is-incomplete' : ''}`}>
                                {breakdown.percentage.toFixed(1)}%
                              </strong>
                              <small>grade {breakdown.grade}</small>
                              {incomplete && (
                                <span className="score-table__flag">
                                  <AlertTriangle size={11} /> {breakdown.manualCount - breakdown.manualScored} blank
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="score-table__waiting">Scan first</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {results.length > 0 && summary.incompleteCount > 0 && (
            <p className="tiny faint" style={{ marginTop: 10 }}>
              Empty boxes are not counted as zero, so a learner with blanks is left out of the class average until all
              written scores are entered.
            </p>
          )}
        </div>
      </section>

      <section className="score-progress">
        <div>
          <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
            <span className="small muted">
              Written scoring progress · {scoredLearners} of {results.length} checked sheets complete
            </span>
            <strong>{results.length ? Math.round((scoredLearners / results.length) * 100) : 0}%</strong>
          </div>
          <ProgressBar
            value={results.length ? (scoredLearners / results.length) * 100 : 0}
            tone={scoredLearners === results.length && results.length > 0 ? 'green' : 'amber'}
          />
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => onNavigate('results')}>
          Open results <ArrowRight size={14} />
        </button>
      </section>

      <ConfirmDialog
        open={confirmZero}
        title="Set every missing written score to 0?"
        message="Only empty boxes are filled. Scores already typed are kept. Use this when the remaining learners were absent or truly scored zero."
        confirmLabel="Fill blanks with 0"
        onConfirm={fillBlankWithZero}
        onClose={() => setConfirmZero(false)}
      />

      <ConfirmDialog
        open={confirmClear}
        title="Clear every written score?"
        message="All typed written scores for this exam will be removed. The scanned answers, key, and results stay."
        confirmLabel="Clear written scores"
        danger
        onConfirm={clearWritten}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  );
}
