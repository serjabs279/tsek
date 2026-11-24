import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Eraser, FileDown, PenLine, ScanLine } from 'lucide-react';
import type { Exam, ScanResult } from '@shared/types';
import { useApp } from '@shared/store/AppStore';
import {
  examSections,
  isPartScored,
  manualItems,
  partScoreKey,
  type MaterialItem,
} from '@shared/lib/sections';
import { scoreResult } from '@shared/lib/scoring';
import { summarize } from '@shared/lib/results';
import { buildScoresPdf, reportFilename } from '@shared/lib/reportPdf';
import { Badge, Spinner } from '@shared/components/ui';
import { EmptyBlock, FieldBlock, MobileSheet, ScreenHead, StatTile, TypeToConfirm } from '../components/Common';
import { savePdf } from '../lib/savePdf';
import type { ExamTab } from '../MobileApp';

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

interface ScoreColumn {
  key: string;
  max: number;
  label: string;
  part: boolean;
  span: number;
  number: number;
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

/** Turn the typed strings into the numbers the store expects. Blanks stay out. */
function parseDraft(draft: Record<string, string>, columns: ScoreColumn[]): Record<string, number> {
  const scores: Record<string, number> = {};
  columns.forEach((column) => {
    const raw = (draft[column.key] ?? '').trim();
    if (raw === '') return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    scores[column.key] = round2(Math.max(0, Math.min(column.max, parsed)));
  });
  return scores;
}

function filled(scores: Record<string, number> | undefined, columns: ScoreColumn[]): number {
  if (!scores) return 0;
  return columns.filter((column) => scores[column.key] !== undefined).length;
}

/**
 * Written marks are typed here, not on a desktop. The tablet already holds the
 * scanned answers; this screen adds the hand-scored half and recalculates each
 * combined total immediately.
 */
export function ScoresScreen({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: ExamTab) => void }) {
  const { state, updateResult, toast } = useApp();
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = useMemo(
    () => state.results.filter((result) => result.examId === exam.id),
    [state.results, exam.id]
  );

  const written = useMemo(() => manualItems(exam), [exam]);
  const pooledSections = useMemo(
    () => new Set(examSections(exam).filter(isPartScored).map((section) => section.id)),
    [exam]
  );
  const groups = useMemo(() => groupByPart(written, pooledSections), [written, pooledSections]);
  const columns = useMemo<ScoreColumn[]>(
    () =>
      groups.flatMap((group): ScoreColumn[] =>
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
              label: `Item ${item.number}`,
              part: false,
              span: 1,
              number: item.number,
            }))
      ),
    [groups]
  );
  const columnByKey = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);
  const byLrn = useMemo(() => new Map(results.map((result) => [result.lrn, result])), [results]);
  const summary = useMemo(() => summarize(exam, learners, results), [exam, learners, results]);

  const [editing, setEditing] = useState<ScanResult | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirmZero, setConfirmZero] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  const scoredSheets = results.filter((result) => filled(result.manualScores, columns) === columns.length).length;
  const writtenPoints = round2(columns.reduce((sum, column) => sum + column.max, 0));

  const draftScores = parseDraft(draft, columns);
  const draftBreakdown = editing ? scoreResult(exam, { ...editing, manualScores: draftScores }) : null;
  const draftFilled = filled(draftScores, columns);

  const openSheet = (result: ScanResult) => {
    const next: Record<string, string> = {};
    columns.forEach((column) => {
      const value = result.manualScores?.[column.key];
      next[column.key] = value === undefined ? '' : String(value);
    });
    setDraft(next);
    setEditing(result);
  };

  const saveSheet = () => {
    if (!editing) return;
    updateResult(editing.id, { manualScores: parseDraft(draft, columns) });
    toast(`${editing.name} scored.`, 'success');
    setEditing(null);
  };

  const fillBlankWithZero = () => {
    results.forEach((result) => {
      const scores = { ...(result.manualScores ?? {}) };
      let changed = false;
      columns.forEach((column) => {
        if (scores[column.key] === undefined) {
          scores[column.key] = 0;
          changed = true;
        }
      });
      if (changed) updateResult(result.id, { manualScores: scores });
    });
    toast('Missing written scores were set to 0. A blank is not the same as a zero.', 'success');
  };

  const clearWritten = () => {
    results.forEach((result) => updateResult(result.id, { manualScores: {} }));
    toast('Written scores cleared. Scanned answers are untouched.', 'danger');
  };

  const savePdfReport = async () => {
    if (results.length === 0) {
      toast('Scan at least one sheet before saving the score matrix.', 'danger');
      return;
    }
    setBusy(true);
    try {
      const bytes = await buildScoresPdf(exam, learners, results, state.settings);
      if (await savePdf(bytes, reportFilename('Scores', exam))) {
        toast('Score matrix saved as PDF.', 'success');
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The PDF could not be generated.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (written.length === 0) {
    return (
      <>
        <ScreenHead
          eyebrow={`${exam.code} · Scores`}
          title="Written scores"
          subtitle="Hand-scored marks are typed on this tablet and added to the scanned total."
        />
        <section className="m-card">
          <div className="m-card__body">
            <EmptyBlock
              icon={<PenLine size={26} />}
              title="No written parts on this test"
              message="Add an essay, enumeration, identification, or modified true-or-false part in Setup. Its scores can then be typed here; every scanned item is scored from the bubbles alone."
              action={
                <button className="btn btn--primary" onClick={() => onNavigate('setup')}>
                  Open Setup <ArrowRight size={14} />
                </button>
              }
            />
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <ScreenHead
        eyebrow={`${exam.code} · Scores`}
        title="Written scores"
        subtitle={`${scoredSheets} of ${results.length} checked sheet${results.length === 1 ? '' : 's'} fully scored · ${points(writtenPoints)} written pts`}
        actions={
          <button className="btn btn--soft btn--sm" onClick={() => void savePdfReport()} disabled={busy || results.length === 0}>
            {busy ? <Spinner size={14} /> : <FileDown size={15} />} PDF
          </button>
        }
      />

      <div className="m-stack">
        {results.length === 0 ? (
          <section className="m-card">
            <div className="m-card__body">
              <EmptyBlock
                icon={<PenLine size={26} />}
                title="No checked sheets yet"
                message="A written score belongs to a checked sheet, so scan the returned papers first. The tablet then holds both halves of the score: bubbles from the scanner and marks typed here."
                action={
                  <button className="btn btn--primary" onClick={() => onNavigate('scan')}>
                    <ScanLine size={16} /> Scan a batch
                  </button>
                }
              />
            </div>
          </section>
        ) : (
          <>
            <div className="m-statrow">
              <StatTile label="Scored" value={`${scoredSheets}/${results.length}`} detail="all boxes filled" />
              <StatTile label="Complete" value={summary.scannedCount - summary.incompleteCount} detail="in the class record" />
              <StatTile label="Class average" value={`${summary.averagePercentage.toFixed(1)}%`} detail="complete papers only" />
              <StatTile label="Passing" value={`${summary.passingCount}/${summary.rosterCount}`} detail={`at ${exam.passingPercent}%`} />
            </div>

            {summary.incompleteCount > 0 && (
              <div className="m-note m-note--warn">
                <strong>{summary.incompleteCount} sheet{summary.incompleteCount === 1 ? '' : 's'} still missing a written score.</strong>{' '}
                Empty boxes are not zeros, so those learners stay out of the class average until
                every written box is filled.
              </div>
            )}

            <section className="m-card">
              <div className="m-card__head">
                <div>
                  <h2>Type the marks</h2>
                  <p>Tap a learner. Leave a box empty while unscored; 0 means the learner scored zero.</p>
                </div>
                <Badge tone="neutral"><PenLine size={12} /> {written.length} items</Badge>
              </div>
              <div className="m-card__body" style={{ paddingTop: 4 }}>
                {learners.map((learner) => {
                  const result = byLrn.get(learner.lrn);
                  if (!result) {
                    return (
                      <div className="m-person" key={learner.id} aria-disabled="true">
                        <span className="m-person__main">
                          <span className="m-person__name">{learner.name}</span>
                          <span className="m-person__meta">{learner.lrn}</span>
                        </span>
                        <span className="pill pill--neutral">not checked</span>
                      </div>
                    );
                  }
                  const breakdown = scoreResult(exam, result);
                  const done = filled(result.manualScores, columns);
                  const complete = done === columns.length;
                  return (
                    <button
                      className="m-resultrow"
                      key={learner.id}
                      onClick={() => openSheet(result)}
                      style={{ width: '100%' }}
                    >
                      <span className="m-resultrow__main">
                        <span className="m-resultrow__name">{learner.name}</span>
                        <span className="m-resultrow__meta">
                          <span className="m-person__meta">{learner.lrn}</span>
                          {complete ? (
                            <span className="pill pill--green"><CheckCircle2 size={10} /> scored</span>
                          ) : (
                            <span className="pill pill--amber">
                              <AlertTriangle size={10} /> {columns.length - done} blank
                            </span>
                          )}
                          {result.needsReview && <span className="pill pill--amber">review</span>}
                        </span>
                      </span>
                      <span className="m-score">
                        <strong>{breakdown.percentage.toFixed(1)}%</strong>
                        <span>
                          {points(breakdown.manualEarned)}/{points(breakdown.manualPossible)} written
                        </span>
                      </span>
                      <ArrowRight size={16} className="muted" />
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="m-row">
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => setConfirmZero(true)}
                disabled={results.length === 0 || scoredSheets === results.length}
              >
                <CheckCircle2 size={14} /> Fill blanks with 0
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirmClear(true)} disabled={results.length === 0}>
                <Eraser size={14} /> Clear written scores
              </button>
            </div>

            <div className="m-note">
              The written total adds to the scanned total automatically. Saving a sheet re-scores
              it, updates the class average, and feeds the non-MCQ item analysis.
            </div>
          </>
        )}
      </div>

      <MobileSheet
        open={Boolean(editing)}
        title={editing?.name ?? 'Written scores'}
        subtitle={
          editing
            ? `${editing.lrn} · ${draftFilled} of ${columns.length} boxes filled`
            : undefined
        }
        onClose={() => setEditing(null)}
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn--primary" onClick={saveSheet}>
              Save scores
            </button>
          </>
        }
      >
        {editing && draftBreakdown && (
          <>
            <div className="m-statrow">
              <StatTile
                label="Written"
                value={`${points(draftBreakdown.manualEarned)}/${points(draftBreakdown.manualPossible)}`}
                detail={`${draftFilled}/${columns.length} boxes`}
              />
              <StatTile
                label="Scanned"
                value={`${points(draftBreakdown.objectiveEarned)}/${points(draftBreakdown.objectivePossible)}`}
                detail="from the sheet"
              />
              <StatTile
                label="Combined"
                value={`${draftBreakdown.percentage.toFixed(1)}%`}
                detail={`grade ${draftBreakdown.grade}`}
              />
            </div>

            {groups.map((group) => (
              <div key={group.id} style={{ marginTop: 14 }}>
                <div className="m-row m-row--between" style={{ marginBottom: 6 }}>
                  <strong style={{ fontSize: '0.85rem' }}>
                    Part {roman(group.sectionIndex)} · {group.title}
                  </strong>
                  <span className="m-tiny">
                    {group.part
                      ? `one total · ${points(group.points)} pts`
                      : `items ${group.start}–${group.end}`}
                  </span>
                </div>
                <div className="m-form">
                  {group.part ? (
                    <ScoreField
                      column={columnByKey.get(partScoreKey(group.id))}
                      draft={draft}
                      setDraft={setDraft}
                    />
                  ) : (
                    group.items.map((item) => (
                      <ScoreField
                        key={item.manualKey}
                        column={columnByKey.get(item.manualKey ?? '')}
                        draft={draft}
                        setDraft={setDraft}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}

            {draftFilled < columns.length && (
              <div className="m-note m-note--warn" style={{ marginTop: 12 }}>
                {columns.length - draftFilled} written box{columns.length - draftFilled === 1 ? '' : 'es'}{' '}
                left empty. An empty box marks the paper incomplete and keeps it out of the class
                average until every box is filled.
              </div>
            )}
          </>
        )}
      </MobileSheet>

      <TypeToConfirm
        open={confirmZero}
        title="Set every missing written score to 0?"
        message={`Only empty boxes across ${results.length} checked sheet${results.length === 1 ? '' : 's'} are filled. Scores already typed are kept. Use this when the remaining learners were absent or truly scored zero.`}
        phrase="ZERO"
        confirmLabel="Fill blanks with 0"
        onClose={() => setConfirmZero(false)}
        onConfirm={fillBlankWithZero}
      />

      <TypeToConfirm
        open={confirmClear}
        title="Clear every written score?"
        message={`All typed written scores for ${results.length} sheet${results.length === 1 ? '' : 's'} are removed. Scanned answers, the key, and every bubble score stay.`}
        phrase="CLEAR"
        confirmLabel="Clear written scores"
        onClose={() => setConfirmClear(false)}
        onConfirm={clearWritten}
      />
    </>
  );
}

function ScoreField({
  column,
  draft,
  setDraft,
}: {
  column: ScoreColumn | undefined;
  draft: Record<string, string>;
  setDraft: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  if (!column) return null;
  return (
    <FieldBlock key={column.key} label={column.part ? column.label : `Item ${column.number}`} hint={`out of ${points(column.max)}`}>
      <input
        className="input"
        inputMode="decimal"
        value={draft[column.key] ?? ''}
        placeholder="not scored"
        aria-label={`${column.label}, out of ${points(column.max)}`}
        onChange={(event) => {
          const value = event.target.value;
          setDraft((prev) => ({ ...prev, [column.key]: value }));
        }}
      />
    </FieldBlock>
  );
}
