import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  FileDown,
  FileSpreadsheet,
  Plus,
  RotateCcw,
  Trash2,
  Wand2,
} from 'lucide-react';
import { BLOOM_LEVELS } from '@shared/types';
import type { BloomLevel, Exam, TosPlan, TosRow } from '@shared/types';
import { useApp } from '@shared/store/AppStore';
import { safeFilename } from '@shared/lib/download';
import { buildTosPdf, reportFilename } from '@shared/lib/reportPdf';
import {
  DEFAULT_BLOOM_WEIGHTS,
  buildTosCsv,
  createTosPlan,
  distributeItems,
  emptyTosRow,
  placeItems,
  rowWeightPercent,
  tosTotals,
} from '@shared/lib/tos';
import { totalItemCount } from '@shared/lib/sections';
import { Badge, Spinner } from '@shared/components/ui';
import { EmptyBlock, FieldBlock, ScreenHead, TypeToConfirm } from '../components/Common';
import { savePdf } from '../lib/savePdf';
import { saveTextFile } from '../lib/saveFile';

function zeroItems(): Record<BloomLevel, number> {
  return { Remembering: 0, Understanding: 0, Applying: 0, Analyzing: 0, Evaluation: 0, Creating: 0 };
}

export function TosScreen({ exam }: { exam: Exam }) {
  const { state, updateExam, toast } = useApp();
  const plan = exam.tos ?? null;

  const itemTarget = totalItemCount(exam);
  const placement = useMemo(() => (plan ? placeItems(plan) : {}), [plan]);
  const totals = useMemo(() => (plan ? tosTotals(plan) : null), [plan]);

  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDistribute, setConfirmDistribute] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TosRow | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null);

  if (!plan || !totals) {
    return (
      <>
        <ScreenHead
          eyebrow={`${exam.code} · TOS`}
          title="Table of Specifications"
          subtitle={`${itemTarget} items from Setup drive the whole table.`}
        />
        <section className="m-card">
          <div className="m-card__body">
            <EmptyBlock
              icon={<ClipboardList size={26} />}
              title="Build the Table of Specifications"
              message="Map this quarter's competencies to Bloom levels, weight each topic by the time you spend on it, and let Tsek place every item. The finished TOS saves as a PDF in the DepEd format."
              action={
                <button
                  className="btn btn--primary"
                  onClick={() => {
                    updateExam(exam.id, { tos: createTosPlan(exam) });
                    toast('TOS started from this exam’s details.', 'success');
                  }}
                >
                  <Plus size={15} /> Create TOS
                </button>
              }
            />
          </div>
        </section>
      </>
    );
  }

  const patchPlan = (patch: Partial<TosPlan>) => updateExam(exam.id, { tos: { ...plan, ...patch } });

  const updateRow = (rowId: string, patch: Partial<TosRow>) => {
    patchPlan({ rows: plan.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)) });
  };

  const updateItemCount = (rowId: string, level: BloomLevel, value: string) => {
    const count = Math.max(0, Math.min(999, Math.round(Number(value) || 0)));
    const row = plan.rows.find((item) => item.id === rowId);
    if (!row) return;
    updateRow(rowId, { items: { ...row.items, [level]: count } });
  };

  const weightSum = BLOOM_LEVELS.reduce((sum, level) => sum + (Number(plan.bloomWeights[level]) || 0), 0);
  const missing = itemTarget - totals.allocated;
  const allocatedTone: 'green' | 'amber' | 'rose' = missing === 0 ? 'green' : missing > 0 ? 'amber' : 'rose';

  const runDistribute = () => {
    updateExam(exam.id, { tos: distributeItems(plan, itemTarget) });
    toast(
      `${itemTarget} items distributed across ${plan.rows.length} topic${plan.rows.length === 1 ? '' : 's'}.`,
      'success'
    );
  };

  const distribute = () => {
    if (plan.rows.length === 0) {
      toast('Add a topic before distributing items.', 'danger');
      return;
    }
    if (totals.allocated > 0) {
      setConfirmDistribute(true);
      return;
    }
    runDistribute();
  };

  const clearItems = () => {
    patchPlan({
      rows: plan.rows.map((row) => ({ ...row, items: zeroItems() })),
    });
    toast('Item counts cleared.', 'default');
  };

  const addTopic = () => patchPlan({ rows: [...plan.rows, emptyTosRow()] });

  const saveTosPdf = async () => {
    if (plan.rows.length === 0) {
      toast('Add at least one topic before saving the TOS.', 'danger');
      return;
    }
    setBusy('pdf');
    try {
      const bytes = await buildTosPdf(plan, exam, state.settings);
      if (await savePdf(bytes, reportFilename('TOS', exam))) {
        toast('TOS saved as PDF.', 'success');
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The PDF could not be generated.', 'danger');
    } finally {
      setBusy(null);
    }
  };

  const saveCsv = async () => {
    setBusy('csv');
    try {
      const stem = safeFilename(
        `TOS_${plan.subject || exam.subject || 'Subject'}_${plan.gradingPeriod || exam.quarterKey}`
      );
      const saved = await saveTextFile(buildTosCsv(plan), `${stem}.csv`, {
        mime: 'text/csv',
        label: 'CSV file',
        extension: 'csv',
      });
      if (saved) toast('TOS CSV saved. It opens in Excel or Google Sheets.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The CSV could not be saved.', 'danger');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <ScreenHead
        eyebrow={`${exam.code} · TOS`}
        title="Table of Specifications"
        subtitle={`${plan.rows.length} topic${plan.rows.length === 1 ? '' : 's'} · ${totals.allocated} of ${itemTarget} items placed`}
      />

      <div className="m-stack">
        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Plan details</h2>
              <p>Printed on the TOS header. They start from this exam's own details.</p>
            </div>
          </div>
          <div className="m-card__body">
            <div className="m-form">
              <FieldBlock label="Subject">
                <input
                  className="input"
                  value={plan.subject}
                  onChange={(event) => patchPlan({ subject: event.target.value })}
                  placeholder="English"
                />
              </FieldBlock>
              <FieldBlock label="Grade level">
                <input
                  className="input"
                  value={plan.grade}
                  onChange={(event) => patchPlan({ grade: event.target.value })}
                  placeholder="Grade 7"
                />
              </FieldBlock>
              <FieldBlock label="Grading period">
                <input
                  className="input"
                  value={plan.gradingPeriod}
                  onChange={(event) => patchPlan({ gradingPeriod: event.target.value })}
                  placeholder="1st Quarter"
                />
              </FieldBlock>
              <FieldBlock label="School year">
                <input
                  className="input"
                  value={plan.schoolYear}
                  onChange={(event) => patchPlan({ schoolYear: event.target.value })}
                  placeholder="2026-2027"
                />
              </FieldBlock>
              <FieldBlock label="Teacher">
                <input
                  className="input"
                  value={plan.teacher}
                  onChange={(event) => patchPlan({ teacher: event.target.value })}
                  placeholder="Teacher name"
                />
              </FieldBlock>
            </div>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Bloom level weights</h2>
              <p>How the placed items split across the six levels.</p>
            </div>
            <Badge tone={Math.abs(weightSum - 100) < 0.01 ? 'green' : 'amber'}>
              {weightSum.toFixed(0)}% total
            </Badge>
          </div>
          <div className="m-card__body">
            <div className="tos-weightgrid">
              {BLOOM_LEVELS.map((level) => (
                <FieldBlock label={`${level} %`} key={level}>
                  <input
                    className="input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    aria-label={`${level} weight percent`}
                    value={plan.bloomWeights[level]}
                    onChange={(event) =>
                      patchPlan({
                        bloomWeights: { ...plan.bloomWeights, [level]: Number(event.target.value) || 0 },
                      })
                    }
                  />
                </FieldBlock>
              ))}
            </div>
            <div className="m-row m-row--between" style={{ marginTop: 12 }}>
              <span className="m-tiny">
                {Math.abs(weightSum - 100) < 0.01
                  ? 'Weights add up to 100%.'
                  : 'Weights are normalised when distributing.'}
              </span>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => patchPlan({ bloomWeights: { ...DEFAULT_BLOOM_WEIGHTS } })}
              >
                <RotateCcw size={14} /> Reset 30/20/20/10/10/10
              </button>
            </div>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Allocation</h2>
              <p>Topic weight comes from the time spent on each topic.</p>
            </div>
            <Badge tone={allocatedTone}>
              {missing === 0 ? (
                <>
                  <CheckCircle2 size={12} /> {totals.allocated}/{itemTarget} placed
                </>
              ) : missing > 0 ? (
                `${missing} unplaced`
              ) : (
                `${Math.abs(missing)} too many`
              )}
            </Badge>
          </div>
          <div className="m-card__body">
            <div className="m-statrow">
              <div className="m-stat">
                <div className="m-stat__label">Items placed</div>
                <div className="m-stat__value">{totals.allocated}</div>
                <div className="m-stat__detail">target {itemTarget}</div>
              </div>
              <div className="m-stat">
                <div className="m-stat__label">Topics</div>
                <div className="m-stat__value">{plan.rows.length}</div>
                <div className="m-stat__detail">competency rows</div>
              </div>
              <div className="m-stat">
                <div className="m-stat__label">Time</div>
                <div className="m-stat__value">{totals.totalTime}</div>
                <div className="m-stat__detail">minutes</div>
              </div>
              <div className="m-stat">
                <div className="m-stat__label">Unplaced</div>
                <div className="m-stat__value">{missing > 0 ? missing : 0}</div>
                <div className="m-stat__detail">items</div>
              </div>
            </div>

            <div className="m-row" style={{ marginTop: 12 }}>
              <button className="btn btn--primary btn--sm" onClick={distribute}>
                <Wand2 size={14} /> Distribute {itemTarget} items
              </button>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => setConfirmClear(true)}
                disabled={totals.allocated === 0}
              >
                <RotateCcw size={14} /> Clear items
              </button>
              <button className="btn btn--soft btn--sm" onClick={() => void saveCsv()} disabled={busy !== null}>
                {busy === 'csv' ? <Spinner size={14} /> : <FileSpreadsheet size={14} />} CSV
              </button>
              <button
                className="btn btn--soft btn--sm"
                onClick={() => void saveTosPdf()}
                disabled={busy !== null || plan.rows.length === 0}
              >
                {busy === 'pdf' ? <Spinner size={14} /> : <FileDown size={14} />} PDF
              </button>
            </div>

            <div
              className={`m-note ${
                missing === 0 ? 'm-note--green' : missing > 0 ? 'm-note--warn' : 'm-note--danger'
              }`}
              style={{ marginTop: 12 }}
            >
              {missing === 0
                ? `All ${itemTarget} items are placed. Each topic card shows exactly which item numbers belong to every Bloom level.`
                : missing > 0
                  ? `${missing} of ${itemTarget} items are still unplaced. Use “Distribute ${itemTarget} items” or type the counts yourself.`
                  : `${Math.abs(missing)} more items are placed than the test has. Reduce a count before saving the TOS.`}
            </div>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Topics and competencies</h2>
              <p>Edit any count to fine-tune; the POI line under each level renumbers itself.</p>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={addTopic}>
              <Plus size={14} /> Add topic
            </button>
          </div>
          <div className="m-card__body">
            {plan.rows.length === 0 ? (
              <div className="m-list-note">No topics yet. Add one to start the TOS.</div>
            ) : (
              plan.rows.map((row, index) => {
                const rowPlacement = placement[row.id];
                return (
                  <div className="tos-topic" key={row.id}>
                    <div className="tos-topic__head">
                      <span className="tos-topic__index">Topic {index + 1}</span>
                      <span className="tos-topic__meta">
                        {totals.rowItems[index]} item{totals.rowItems[index] === 1 ? '' : 's'} ·{' '}
                        {rowWeightPercent(plan, row).toFixed(1)}%
                      </span>
                      <button
                        className="icon-btn icon-btn--sm"
                        aria-label={`Remove topic ${index + 1}`}
                        onClick={() => setPendingDelete(row)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div className="m-form">
                      <FieldBlock label="Topic" wide>
                        <textarea
                          className="textarea"
                          rows={2}
                          value={row.topic}
                          aria-label={`Topic ${index + 1}`}
                          onChange={(event) => updateRow(row.id, { topic: event.target.value })}
                          placeholder="Unit / topic"
                        />
                      </FieldBlock>
                      <FieldBlock label="Competencies" wide>
                        <textarea
                          className="textarea"
                          rows={2}
                          value={row.competencies}
                          aria-label={`Competencies for topic ${index + 1}`}
                          onChange={(event) => updateRow(row.id, { competencies: event.target.value })}
                          placeholder="Competency or learning objective"
                        />
                      </FieldBlock>
                      <FieldBlock label="Time (minutes)">
                        <input
                          className="input"
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={row.time}
                          aria-label={`Time spent for topic ${index + 1}`}
                          onChange={(event) =>
                            updateRow(row.id, { time: Math.max(0, Number(event.target.value) || 0) })
                          }
                        />
                      </FieldBlock>
                      <FieldBlock label="Type of test">
                        <input
                          className="input"
                          value={row.type}
                          aria-label={`Type of test for topic ${index + 1}`}
                          onChange={(event) => updateRow(row.id, { type: event.target.value })}
                          placeholder="Multiple choice"
                        />
                      </FieldBlock>
                    </div>

                    <div className="tos-bloomgrid">
                      {BLOOM_LEVELS.map((level) => {
                        const poi = rowPlacement?.[level] ?? '';
                        return (
                          <label className="tos-bloom" key={level}>
                            <span className="tos-bloom__label">{level}</span>
                            <input
                              className="input"
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={999}
                              value={row.items[level]}
                              aria-label={`${level} items for topic ${index + 1}`}
                              onChange={(event) => updateItemCount(row.id, level, event.target.value)}
                            />
                            <span className={`tos-bloom__poi ${poi ? '' : 'is-empty'}`}>
                              {poi ? `POI ${poi}` : 'POI —'}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__body">
            <details className="m-analysis-item">
              <summary>
                <span className="m-analysis-item__title">How the distribution works</span>
              </summary>
              <div className="m-analysis-item__body">
                <p>
                  <strong>Topic weight.</strong> Time spent per topic divided by the total time. A topic
                  with 120 of 600 minutes gets 20% of the items.
                </p>
                <p>
                  <strong>Bloom weight.</strong> The six percentages decide how many of those items fall
                  under each level. The default is the 30 / 20 / 20 / 10 / 10 / 10 shallow-to-deep split.
                </p>
                <p style={{ marginBottom: 0 }}>
                  <strong>Placement of items.</strong> Items are numbered from 1 in table order — all of
                  topic 1's Remembering items, then its Understanding items, and so on. Editing a count
                  renumbers the POI lines immediately.
                </p>
              </div>
            </details>
            <div className="m-row" style={{ marginTop: 12, gap: 6 }}>
              <span className="m-chip">NOI = number of items</span>
              <span className="m-chip">POI = placement of items</span>
              <span className="m-chip">{itemTarget} items from Setup</span>
            </div>
          </div>
        </section>
      </div>

      <TypeToConfirm
        open={confirmClear}
        title="Clear every item count?"
        message={`All ${totals.allocated} placed item${totals.allocated === 1 ? '' : 's'} go back to zero across ${plan.rows.length} topic${plan.rows.length === 1 ? '' : 's'}. Topic names, times, types and Bloom weights stay.`}
        phrase="CLEAR"
        confirmLabel="Clear items"
        onClose={() => setConfirmClear(false)}
        onConfirm={clearItems}
      />

      <TypeToConfirm
        open={confirmDistribute}
        title="Replace the current placement?"
        message={`The ${totals.allocated} item${totals.allocated === 1 ? '' : 's'} already placed are replaced by a fresh split of all ${itemTarget} items across ${plan.rows.length} topic${plan.rows.length === 1 ? '' : 's'}. Any counts you typed by hand are overwritten.`}
        phrase="DISTRIBUTE"
        confirmLabel="Distribute items"
        onClose={() => setConfirmDistribute(false)}
        onConfirm={runDistribute}
      />

      <TypeToConfirm
        open={pendingDelete !== null}
        title="Remove this topic?"
        message={
          <>
            <strong>{pendingDelete?.topic.trim() || 'Untitled topic'}</strong> and its item counts are
            removed from the TOS. The items it held become unplaced until you distribute again.
          </>
        }
        phrase="DELETE"
        confirmLabel="Remove topic"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          patchPlan({ rows: plan.rows.filter((row) => row.id !== pendingDelete.id) });
          toast('Topic removed from the TOS.', 'danger');
        }}
      />
    </>
  );
}