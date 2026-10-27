import { Fragment, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  FileDown,
  Info,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  Wand2,
} from 'lucide-react';
import { BLOOM_LEVELS } from '../types';
import type { BloomLevel, Exam, TosPlan, TosRow } from '../types';
import { useApp } from '../store/AppStore';
import { downloadBlob, downloadText, safeFilename } from '../lib/download';
import { printHtml } from '../lib/print';
import { buildTosPdf, reportFilename } from '../lib/reportPdf';
import {
  DEFAULT_BLOOM_WEIGHTS,
  buildTosCsv,
  buildTosPrintHtml,
  createTosPlan,
  distributeItems,
  emptyTosRow,
  placeItems,
  rowWeightPercent,
  tosTotals,
} from '../lib/tos';
import { Badge, EmptyState, Field } from './ui';
import { totalItemCount } from '../lib/sections';

export function TosTab({ exam }: { exam: Exam }) {
  const { state, updateExam, toast } = useApp();
  const plan = exam.tos ?? null;

  const itemTarget = totalItemCount(exam);
  const placement = useMemo(() => (plan ? placeItems(plan) : {}), [plan]);
  const totals = useMemo(() => (plan ? tosTotals(plan) : null), [plan]);

  if (!plan || !totals) {
    return (
      <section className="card">
        <div className="card-body">
          <EmptyState
            icon={<ClipboardList size={26} />}
            title="Build the Table of Specifications"
            message="Map the quarter's competencies to Bloom levels, weight each topic by the time you spend on it, and let Tsek place every item. The finished TOS prints in the DepEd format."
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
  const allocatedTone = missing === 0 ? 'green' : missing > 0 ? 'amber' : 'rose';

  const distribute = () => {
    if (plan.rows.length === 0) {
      toast('Add a topic before distributing items.', 'danger');
      return;
    }
    updateExam(exam.id, { tos: distributeItems(plan, itemTarget) });
    toast(`${itemTarget} items distributed across ${plan.rows.length} topic${plan.rows.length === 1 ? '' : 's'}.`, 'success');
  };

  const clearItems = () => {
    patchPlan({
      rows: plan.rows.map((row) => ({
        ...row,
        items: { Remembering: 0, Understanding: 0, Applying: 0, Analyzing: 0, Evaluation: 0, Creating: 0 },
      })),
    });
    toast('Item counts cleared.', 'default');
  };

  const printTos = () => {
    printHtml(buildTosPrintHtml(plan, exam, state.settings));
  };

  const exportCsv = () => {
    const stem = safeFilename(`TOS_${plan.subject || exam.subject || 'Subject'}_${plan.gradingPeriod || exam.quarterKey}`);
    downloadText(buildTosCsv(plan), `${stem}.csv`, 'text/csv');
    toast('TOS CSV downloaded. It opens directly in Excel or Google Sheets.', 'success');
  };

  const exportPdf = async () => {
    if (plan.rows.length === 0) {
      toast('Add at least one topic before exporting.', 'danger');
      return;
    }
    try {
      const bytes = await buildTosPdf(plan, exam, state.settings);
      downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), reportFilename('TOS', exam));
      toast('TOS PDF downloaded.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The PDF could not be generated.', 'danger');
    }
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div className="card-head__title">
            <h3>Table of Specifications</h3>
            <p>Topic weights come from the time spent. Item counts follow your Bloom level weights.</p>
          </div>
          <Badge tone={allocatedTone}>
            {missing === 0
              ? <><CheckCircle2 size={12} /> {totals.allocated}/{itemTarget} items placed</>
              : missing > 0
                ? `${missing} item${missing === 1 ? '' : 's'} unplaced`
                : `${Math.abs(missing)} too many`}
          </Badge>
        </div>
        <div className="card-body">
          <div className="tos-meta-grid">
            <Field label="Subject">
              <input className="input" value={plan.subject} onChange={(event) => patchPlan({ subject: event.target.value })} placeholder="English" />
            </Field>
            <Field label="Grade level">
              <input className="input" value={plan.grade} onChange={(event) => patchPlan({ grade: event.target.value })} placeholder="Grade 7" />
            </Field>
            <Field label="Grading period">
              <input className="input" value={plan.gradingPeriod} onChange={(event) => patchPlan({ gradingPeriod: event.target.value })} placeholder="1st Quarter" />
            </Field>
            <Field label="School year">
              <input className="input" value={plan.schoolYear} onChange={(event) => patchPlan({ schoolYear: event.target.value })} placeholder="2026-2027" />
            </Field>
            <Field label="Teacher">
              <input className="input" value={plan.teacher} onChange={(event) => patchPlan({ teacher: event.target.value })} placeholder="Teacher name" />
            </Field>
          </div>

          <div className="tos-toolbar">
            <div className="tos-weights">
              <span className="field__label">Bloom level weights</span>
              <div className="tos-weight-grid">
                {BLOOM_LEVELS.map((level) => (
                  <label className="tos-weight" key={level}>
                    <span>{level}</span>
                    <span className="tos-weight__input">
                      <input
                        type="number"
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
                      <small>%</small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="tos-weight-foot">
                <span className={`tiny ${Math.abs(weightSum - 100) > 0.01 ? 'tos-warn' : 'faint'}`}>
                  {weightSum.toFixed(0)}% total{Math.abs(weightSum - 100) > 0.01 ? ' · weights are normalised when distributing' : ''}
                </span>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => patchPlan({ bloomWeights: { ...DEFAULT_BLOOM_WEIGHTS } })}
                >
                  Reset 30/20/20/10/10/10
                </button>
              </div>
            </div>

            <div className="tos-actions">
              <button className="btn btn--ghost btn--sm" onClick={clearItems}>
                <RotateCcw size={14} /> Clear items
              </button>
              <button className="btn btn--soft btn--sm" onClick={exportCsv}>
                <Download size={14} /> CSV
              </button>
              <button className="btn btn--soft btn--sm" onClick={() => void exportPdf()}>
                <FileDown size={14} /> PDF
              </button>
              <button className="btn btn--soft btn--sm" onClick={printTos}>
                <Printer size={14} /> Print TOS
              </button>
              <button className="btn btn--primary btn--sm" onClick={distribute}>
                <Wand2 size={14} /> Distribute {itemTarget} items
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-head__title">
            <h3>Topics and competencies</h3>
            <p>Edit any NOI cell to fine-tune. Item placements update automatically.</p>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={() => patchPlan({ rows: [...plan.rows, emptyTosRow()] })}>
            <Plus size={14} /> Add topic
          </button>
        </div>
        <div className="card-body card-body--tight">
          <div className="tos-scroll">
            <table className="tos-table">
              <thead>
                <tr>
                  <th rowSpan={2} className="tos-col-index">#</th>
                  <th rowSpan={2}>Topic</th>
                  <th rowSpan={2}>Competencies</th>
                  <th rowSpan={2} className="tos-col-time">Time<br />(min)</th>
                  <th rowSpan={2} className="tos-col-weight">Weight<br />%</th>
                  {BLOOM_LEVELS.map((level) => (
                    <th colSpan={2} key={level}>{level}</th>
                  ))}
                  <th rowSpan={2} className="tos-col-total">Total</th>
                  <th rowSpan={2}>Type of test</th>
                  <th rowSpan={2} aria-label="Row actions" />
                </tr>
                <tr>
                  {BLOOM_LEVELS.map((level) => (
                    <Fragment key={level}>
                      <th className="tos-sub">NOI</th>
                      <th className="tos-sub">POI</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row, index) => (
                  <tr key={row.id}>
                    <td className="tos-row-num">{index + 1}</td>
                    <td>
                      <textarea
                        className="tos-input tos-input--topic"
                        rows={2}
                        value={row.topic}
                        aria-label={`Topic ${index + 1}`}
                        onChange={(event) => updateRow(row.id, { topic: event.target.value })}
                        placeholder="Unit / topic"
                      />
                    </td>
                    <td>
                      <textarea
                        className="tos-input tos-input--comp"
                        rows={2}
                        value={row.competencies}
                        aria-label={`Competencies for topic ${index + 1}`}
                        onChange={(event) => updateRow(row.id, { competencies: event.target.value })}
                        placeholder="Competency or learning objective"
                      />
                    </td>
                    <td>
                      <input
                        className="tos-input tos-input--num"
                        type="number"
                        min={0}
                        value={row.time}
                        aria-label={`Time spent for topic ${index + 1}`}
                        onChange={(event) => updateRow(row.id, { time: Math.max(0, Number(event.target.value) || 0) })}
                      />
                    </td>
                    <td className="tos-weight-cell">{rowWeightPercent(plan, row).toFixed(1)}%</td>
                    {BLOOM_LEVELS.map((level) => (
                      <Fragment key={level}>
                        <td>
                          <input
                            className="tos-input tos-input--item"
                            type="number"
                            min={0}
                            value={row.items[level]}
                            aria-label={`${level} items for topic ${index + 1}`}
                            onChange={(event) => updateItemCount(row.id, level, event.target.value)}
                          />
                        </td>
                        <td className="tos-poi">{placement[row.id]?.[level] || '—'}</td>
                      </Fragment>
                    ))}
                    <td className="tos-total">{totals.rowItems[index]}</td>
                    <td>
                      <input
                        className="tos-input tos-input--type"
                        value={row.type}
                        aria-label={`Type of test for topic ${index + 1}`}
                        onChange={(event) => updateRow(row.id, { type: event.target.value })}
                        placeholder="Multiple choice"
                      />
                    </td>
                    <td>
                      <button
                        className="icon-btn icon-btn--sm"
                        aria-label={`Remove topic ${index + 1}`}
                        onClick={() => patchPlan({ rows: plan.rows.filter((item) => item.id !== row.id) })}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                {plan.rows.length === 0 && (
                  <tr>
                    <td colSpan={20}>
                      <div className="table-empty">No topics yet. Add one to start the TOS.</div>
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="tos-total-label">TOTAL</td>
                  <td className="tos-weight-cell">{totals.totalTime}</td>
                  <td className="tos-weight-cell">100.0%</td>
                  {BLOOM_LEVELS.map((level) => (
                    <Fragment key={level}>
                      <td className="tos-total">{totals.perLevel[level]}</td>
                      <td />
                    </Fragment>
                  ))}
                  <td className="tos-total">{totals.allocated}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className={`card-note ${missing === 0 ? 'card-note--green' : missing > 0 ? 'card-note--warn' : 'card-note--rose'}`} style={{ marginTop: 12 }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              {missing === 0 ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              <span>
                {missing === 0
                  ? `All ${itemTarget} items are placed. The POI columns show exactly which item numbers belong to each topic and Bloom level.`
                  : missing > 0
                    ? `${missing} of ${itemTarget} items are still unplaced. Use “Distribute ${itemTarget} items” or type the counts yourself.`
                    : `${Math.abs(missing)} more items are placed than the TOS plans. Reduce a NOI cell before printing.`}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-head__title">
            <h3>How the distribution works</h3>
            <p>Same rules as the DepEd TOS template, applied instantly.</p>
          </div>
          <Info size={18} className="muted" />
        </div>
        <div className="card-body">
          <div className="info-list">
            <div>
              <strong>Topic weight.</strong> Time spent per topic divided by the total time. A topic with 120 of
              600 minutes gets 20% of the items.
            </div>
            <div>
              <strong>Bloom weight.</strong> The six percentages below the header control how many of those items
              fall under each level. Defaults follow the 30 / 20 / 20 / 10 / 10 / 10 shallow-to-deep split.
            </div>
            <div>
              <strong>Placement of items.</strong> Items are numbered from 1 in table order — all of topic 1’s
              Remembering items, then its Understanding items, and so on. Editing a NOI cell renumbers the POI
              columns immediately.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
