import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  FileDown,
  Info,
  Printer,
  RotateCcw,
  ScanLine,
  Sparkles,
} from 'lucide-react';
import type { AnalysisThresholds, Exam } from '../types';
import { SECTION_LABELS } from '../types';
import { useApp } from '../store/AppStore';
import { downloadBlob, downloadText, safeFilename } from '../lib/download';
import { printHtml } from '../lib/print';
import { buildItemAnalysisPdf, reportFilename } from '../lib/reportPdf';
import {
  DEFAULT_ANALYSIS_THRESHOLDS,
  buildAnalysisCsv,
  buildAnalysisPrintHtml,
  buildItemAnalysis,
  formatIndex,
  formatPercent,
  reliabilityBand,
} from '../lib/analysis';
import { Badge, EmptyState, Field, StatCard } from './ui';
import type { WorkspaceTab } from './ExamWorkspace';

type Filter = 'All' | 'Accept' | 'May Need Revision' | 'Needs Revision' | 'Discard';

const FILTERS: Filter[] = ['All', 'Accept', 'May Need Revision', 'Needs Revision', 'Discard'];

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'none';
}

function formatPoints(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '—';
}

function reliabilityTone(value: number | null): 'green' | 'amber' | 'rose' | 'neutral' {
  const band = reliabilityBand(value);
  if (band === 'good') return 'green';
  if (band === 'marginal') return 'amber';
  if (band === 'poor') return 'rose';
  return 'neutral';
}

function reliabilityLabel(value: number | null): string {
  const band = reliabilityBand(value);
  if (band === 'good') return 'Reliable';
  if (band === 'marginal') return 'Marginal';
  if (band === 'poor') return 'Not reliable';
  return '—';
}

export function AnalysisTab({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: WorkspaceTab) => void }) {
  const { state, updateExam, loadDemoResults, toast } = useApp();
  const [filter, setFilter] = useState<Filter>('All');
  const thresholds = exam.analysis ?? DEFAULT_ANALYSIS_THRESHOLDS;
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);
  const report = useMemo(() => buildItemAnalysis(exam, results, thresholds), [exam, results, thresholds]);

  const patchThresholds = (patch: Partial<AnalysisThresholds>) =>
    updateExam(exam.id, { analysis: { ...thresholds, ...patch } });

  const visibleItems = report.items.filter((item) => filter === 'All' || item.recommendation === filter);
  const flagged = report.items.filter((item) =>
    item.recommendation === 'Needs Revision' || item.recommendation === 'Discard'
  ).length;
  const difficultyTotal = report.items.filter((item) => item.difficulty !== null).length;
  const discriminationTotal = report.items.filter((item) => item.discrimination !== null).length;

  const printReport = () => {
    if (report.takers === 0) {
      toast('Check at least one answer sheet before printing an item analysis.', 'danger');
      return;
    }
    printHtml(buildAnalysisPrintHtml(exam, report, state.settings, thresholds));
  };

  const exportPdf = async () => {
    if (report.takers === 0) {
      toast('Check at least one answer sheet before exporting.', 'danger');
      return;
    }
    try {
      const bytes = await buildItemAnalysisPdf(exam, report, state.settings, thresholds);
      downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), reportFilename('ItemAnalysis', exam));
      toast('Item analysis PDF downloaded. Landscape, sized to your paper setting.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The PDF could not be generated.', 'danger');
    }
  };

  const exportCsv = () => {
    if (report.takers === 0) {
      toast('Check at least one answer sheet before exporting.', 'danger');
      return;
    }
    const stem = safeFilename(`ItemAnalysis_${exam.subject || 'Subject'}_${exam.code}_${exam.quarterKey}`);
    downloadText(buildAnalysisCsv(exam, report), `${stem}.csv`, 'text/csv');
    toast('Item analysis CSV downloaded.', 'success');
  };

  if (results.length === 0) {
    return (
      <section className="card">
        <div className="card-body">
          <EmptyState
            icon={<BarChart3 size={26} />}
            title="No checked sheets to analyze"
            message="Scan and save answer sheets first. Tsek then compares the high and low groups and reports every item's difficulty, discrimination, distractors, and recommendation."
            action={
              <div className="row row--wrap" style={{ justifyContent: 'center', gap: 8 }}>
                <button className="btn btn--primary btn--sm" onClick={() => onNavigate('scan')}>
                  <ScanLine size={14} /> Open scanner
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  disabled={learners.length === 0}
                  onClick={() => {
                    loadDemoResults(exam.id);
                    toast('Demo results loaded. These are not real scans.', 'default');
                  }}
                >
                  <Sparkles size={14} /> Load demo results
                </button>
              </div>
            }
          />
        </div>
      </section>
    );
  }

  if (report.takers === 0) {
    return (
      <section className="card">
        <div className="card-body">
          <EmptyState
            icon={<Info size={26} />}
            title="Written scores are still missing"
            message={`${report.checkedCount} sheet${report.checkedCount === 1 ? ' is' : 's are'} checked, but a written item has no score yet. Tsek waits for every written score so the high and low groups are compared on the same total.`}
            action={
              <div className="row row--wrap" style={{ justifyContent: 'center', gap: 8 }}>
                <button className="btn btn--primary btn--sm" onClick={() => onNavigate('scores')}>
                  Enter written scores
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('scan')}>
                  <ScanLine size={14} /> Open scanner
                </button>
              </div>
            }
          />
          {report.warnings.length > 0 && (
            <div className="card-note card-note--warn" style={{ marginTop: 14 }}>
              <div className="stack" style={{ gap: 6 }}>
                {report.warnings.map((warning) => (
                  <div className="row" style={{ gap: 8, alignItems: 'flex-start' }} key={warning}>
                    <AlertTriangle size={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div className="card-head__title">
            <h3>Item analysis</h3>
            <p>
              High group: top {report.groupSize} · low group: bottom {report.groupSize} of {report.takers} analyzed
              {report.checkedCount > report.takers ? ` (${report.checkedCount} checked)` : ''}. Written items are
              scored out of their points, so every part joins the same ranking.
            </p>
          </div>
          <div className="row row--wrap" style={{ gap: 6 }}>
            <button className="btn btn--soft btn--sm" onClick={exportCsv}>
              <Download size={14} /> CSV
            </button>
            <button className="btn btn--soft btn--sm" onClick={() => void exportPdf()}>
              <FileDown size={14} /> PDF
            </button>
            <button className="btn btn--primary btn--sm" onClick={printReport}>
              <Printer size={14} /> Print report
            </button>
          </div>
        </div>
        <div className="card-body">
          <div className="stat-grid">
            <StatCard
              label="Analyzed takers"
              value={report.takers}
              detail={`${report.itemCount} items · ${report.points} pts · group N = ${report.groupSize}`}
              icon={<BarChart3 size={17} />}
            />
            <StatCard
              label="Average difficulty"
              value={formatPercent(report.averageDifficulty)}
              detail={
                report.averageDifficulty === null
                  ? 'Needs at least two takers'
                  : report.averageDifficulty > thresholds.easyAbove
                    ? 'Easy items on average'
                    : report.averageDifficulty < thresholds.hardBelow
                      ? 'Hard items on average'
                      : 'Average difficulty'
              }
              icon={<BarChart3 size={17} />}
            />
            <StatCard
              label="Average discrimination"
              value={formatIndex(report.averageDiscrimination)}
              detail={
                report.averageDiscrimination === null
                  ? 'Needs at least two takers'
                  : report.averageDiscrimination > thresholds.discriminatingAbove
                    ? 'Items separate the groups well'
                    : report.averageDiscrimination < thresholds.notDiscriminatingBelow
                      ? 'Items do not separate the groups'
                      : 'Average discrimination'
              }
              icon={<BarChart3 size={17} />}
            />
            <StatCard
              label="KR-20 · scanned"
              value={report.reliability.kr20 === null ? '—' : report.reliability.kr20.toFixed(3)}
              detail={reliabilityLabel(report.reliability.kr20)}
              icon={<CheckCircle2 size={17} />}
            />
          </div>

          {report.warnings.length > 0 && (
            <div className="card-note card-note--warn" style={{ marginTop: 14 }}>
              <div className="stack" style={{ gap: 6 }}>
                {report.warnings.map((warning) => (
                  <div className="row" style={{ gap: 8, alignItems: 'flex-start' }} key={warning}>
                    <AlertTriangle size={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="analysis-top-grid">
        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Reliability</h3>
              <p>A teacher-made test should reach 0.60. Below 0.50 is usually considered unreliable.</p>
            </div>
          </div>
          <div className="card-body">
            <div className="mini-list">
              <div className="mini-list__row">
                <span>KR-20 <span className="tiny faint">scanned, right/wrong</span></span>
                <span className="row" style={{ gap: 7 }}>
                  <strong>{report.reliability.kr20 === null ? '—' : report.reliability.kr20.toFixed(3)}</strong>
                  <Badge tone={reliabilityTone(report.reliability.kr20)}>{reliabilityLabel(report.reliability.kr20)}</Badge>
                </span>
              </div>
              <div className="mini-list__row">
                <span>KR-21 <span className="tiny faint">scanned, even difficulty</span></span>
                <span className="row" style={{ gap: 7 }}>
                  <strong>{report.reliability.kr21 === null ? '—' : report.reliability.kr21.toFixed(3)}</strong>
                  <Badge tone={reliabilityTone(report.reliability.kr21)}>{reliabilityLabel(report.reliability.kr21)}</Badge>
                </span>
              </div>
              <div className="mini-list__row">
                <span>Cronbach’s alpha <span className="tiny faint">all items</span></span>
                <span className="row" style={{ gap: 7 }}>
                  <strong>{report.reliability.alpha === null ? '—' : report.reliability.alpha.toFixed(3)}</strong>
                  <Badge tone={reliabilityTone(report.reliability.alpha)}>{reliabilityLabel(report.reliability.alpha)}</Badge>
                </span>
              </div>
              <div className="mini-list__row">
                <span>Mean score</span>
                <strong>{report.reliability.mean} / {report.points} pts</strong>
              </div>
              <div className="mini-list__row">
                <span>Standard deviation</span>
                <strong>{report.reliability.standardDeviation}</strong>
              </div>
            </div>
            <p className="tiny faint" style={{ marginTop: 10 }}>
              KR-20 and KR-21 use only the {report.scannedItemCount} scanned item
              {report.scannedItemCount === 1 ? '' : 's'}. Cronbach’s alpha covers all {report.unitCount} scored row
              {report.unitCount === 1 ? '' : 's'}, with each written score scaled to the share of its points earned.
              {report.pooledPartCount > 0
                ? ` Pooled parts count once each (${report.pooledPartCount} here).`
                : ''}
            </p>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Distribution</h3>
              <p>Where the items fall against the thresholds.</p>
            </div>
          </div>
          <div className="card-body">
            <div className="dist-block">
              <div className="dist-block__title">Difficulty</div>
              {(['Easy', 'Average', 'Hard'] as const).map((band) => {
                const count = report.difficultyCounts[band];
                return (
                  <div className="dist-row" key={band}>
                    <span className="dist-row__label">{band}</span>
                    <span className="dist-row__bar">
                      <span
                        className={`dist-row__fill dist-row__fill--${band.toLowerCase()}`}
                        style={{ width: `${difficultyTotal ? (count / difficultyTotal) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="dist-row__count">{count}</span>
                  </div>
                );
              })}
            </div>
            <div className="dist-block">
              <div className="dist-block__title">Discrimination</div>
              {(['Discriminating', 'Average', 'Not Discriminating'] as const).map((band) => {
                const count = report.discriminationCounts[band];
                return (
                  <div className="dist-row" key={band}>
                    <span className="dist-row__label">{band === 'Not Discriminating' ? 'Not disc.' : band}</span>
                    <span className="dist-row__bar">
                      <span
                        className={`dist-row__fill dist-row__fill--${band === 'Discriminating' ? 'easy' : band === 'Average' ? 'average' : 'hard'}`}
                        style={{ width: `${discriminationTotal ? (count / discriminationTotal) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="dist-row__count">{count}</span>
                  </div>
                );
              })}
            </div>
            <div className="card-note card-note--warn" style={{ marginTop: 12 }}>
              <div className="row" style={{ gap: 7 }}>
                <AlertTriangle size={14} />
                <span>{flagged} item{flagged === 1 ? '' : 's'} need revision or should be discarded.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Recommendations</h3>
              <p>Difficulty crossed with discrimination.</p>
            </div>
          </div>
          <div className="card-body">
            <div className="rec-list">
              {(['Accept', 'May Need Revision', 'Needs Revision', 'Discard'] as const).map((rec) => (
                <button
                  className={`rec-list__row ${filter === rec ? 'is-active' : ''}`}
                  key={rec}
                  onClick={() => setFilter(filter === rec ? 'All' : rec)}
                >
                  <span className={`rec-dot rec-dot--${slug(rec)}`} />
                  <span>{rec}</span>
                  <strong>{report.recommendationCounts[rec]}</strong>
                </button>
              ))}
            </div>
            <div className="mini-list" style={{ marginTop: 10 }}>
              <div className="mini-list__row"><span>Distractors OK</span><strong>{report.distractorCounts.ok}</strong></div>
              <div className="mini-list__row"><span>Defective (D)</span><strong>{report.distractorCounts.defect}</strong></div>
              <div className="mini-list__row"><span>Rejected (R)</span><strong>{report.distractorCounts.reject}</strong></div>
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head card-head--wrap">
          <div className="card-head__title">
            <h3>Per-item results</h3>
            <p>
              For scanned items, high and low are counts of students who chose the option. Written items show mean
              points earned by each group. A pooled part appears as one row for the whole part.
            </p>
          </div>
          <div className="analysis-filters">
            {FILTERS.map((item) => (
              <button
                className={`analysis-filter ${filter === item ? 'is-active' : ''}`}
                key={item}
                onClick={() => setFilter(item)}
              >
                {item}
                <span>
                  {item === 'All'
                    ? report.items.length
                    : report.recommendationCounts[item]}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="card-body card-body--tight">
          <div className="analysis-scroll">
            <table className="analysis-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Part</th>
                  <th>Key</th>
                  <th>High</th>
                  <th>Low</th>
                  <th>Difficulty</th>
                  <th>Discrimination</th>
                  <th>Recommendation</th>
                  <th>Distractor analysis <span className="tiny faint">high / low</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={`${item.sectionId}:${item.item}`}>
                    <td className="analysis-num">
                      {item.endItem > item.item
                        ? `${String(item.item).padStart(2, '0')}–${item.endItem}`
                        : String(item.item).padStart(2, '0')}
                    </td>
                    <td>
                      <span className="analysis-part" title={SECTION_LABELS[item.sectionType].label}>
                        {item.sectionTitle}
                        <span className="analysis-part__type">
                          {SECTION_LABELS[item.sectionType].short}
                          {item.part ? ' · pooled' : ''}
                        </span>
                      </span>
                    </td>
                    <td><span className="analysis-key">{item.key || '—'}</span></td>
                    <td className="analysis-num">
                      {item.scannable ? item.highCorrect : (
                        <span title="Mean points earned by the high group">{formatPoints(item.highMean)}</span>
                      )}
                    </td>
                    <td className="analysis-num">
                      {item.scannable ? item.lowCorrect : (
                        <span title="Mean points earned by the low group">{formatPoints(item.lowMean)}</span>
                      )}
                    </td>
                    <td>
                      <span className={`band-chip band-chip--${slug(item.difficultyBand)}`}>
                        {formatIndex(item.difficulty)} · {item.difficultyBand}
                      </span>
                    </td>
                    <td>
                      <span className={`band-chip band-chip--${slug(item.discriminationBand)}`}>
                        {formatIndex(item.discrimination)} · {item.discriminationBand}
                      </span>
                    </td>
                    <td>
                      <span className={`rec-chip rec-chip--${slug(item.recommendation)}`}>{item.recommendation}</span>
                    </td>
                    <td>
                      {item.scannable ? (
                        <div className="dist-grid">
                          {item.choices.map((choice) => (
                            <div
                              className={`dist-cell ${choice.isKey ? 'is-key' : `is-${slug(choice.status)}`}`}
                              key={choice.choice}
                              title={
                                choice.isKey
                                  ? `Correct answer · chosen by ${choice.high} high and ${choice.low} low`
                                  : `Distractor index ${choice.index === null ? '—' : choice.index.toFixed(2)} · ${choice.status === 'D' ? 'defective' : choice.status === 'R' ? 'rejected (nobody chose it)' : 'acceptable'}`
                              }
                            >
                              <span className="dist-cell__letter">{choice.choice}</span>
                              <span className="dist-cell__count">{choice.high}/{choice.low}</span>
                              {!choice.isKey && <span className="dist-cell__status">{choice.status}</span>}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="written-cell">
                          <span className="written-cell__label">
                            {item.part ? 'Whole part' : 'Written'} · {item.scoredCount} scored
                          </span>
                          <span className="written-cell__value">
                            mean {formatPoints(item.meanEarned)} / {formatPoints(item.points)} pts
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleItems.length === 0 && (
                  <tr>
                    <td colSpan={9}>
                      <div className="table-empty">No item matches this recommendation filter.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="analysis-legend">
            <span><b>D</b> defect — chosen more by the high group</span>
            <span><b>R</b> rejected — nobody chose it</span>
            <span><b>OK</b> acceptable distractor</span>
            <span><b>High/Low</b> counts per group, or mean points for written items</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-head__title">
            <h3>Thresholds</h3>
            <p>Defaults match the school’s Excel template. Change them to match your department standard.</p>
          </div>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => {
              updateExam(exam.id, { analysis: { ...DEFAULT_ANALYSIS_THRESHOLDS } });
              toast('Analysis thresholds reset to the template defaults.', 'success');
            }}
          >
            <RotateCcw size={14} /> Reset
          </button>
        </div>
        <div className="card-body">
          <div className="analysis-threshold-grid">
            <Field label="Easy if difficulty is above" hint="Default 0.75">
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={thresholds.easyAbove}
                onChange={(event) => patchThresholds({ easyAbove: Number(event.target.value) || 0 })}
              />
            </Field>
            <Field label="Hard if difficulty is below" hint="Default 0.25">
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={thresholds.hardBelow}
                onChange={(event) => patchThresholds({ hardBelow: Number(event.target.value) || 0 })}
              />
            </Field>
            <Field label="Discriminating above" hint="Default 0.40">
              <input
                className="input"
                type="number"
                step="0.01"
                min="-1"
                max="1"
                value={thresholds.discriminatingAbove}
                onChange={(event) => patchThresholds({ discriminatingAbove: Number(event.target.value) || 0 })}
              />
            </Field>
            <Field label="Not discriminating below" hint="Default 0.0001">
              <input
                className="input"
                type="number"
                step="0.0001"
                min="-1"
                max="1"
                value={thresholds.notDiscriminatingBelow}
                onChange={(event) => patchThresholds({ notDiscriminatingBelow: Number(event.target.value) || 0 })}
              />
            </Field>
          </div>

          <div className="analysis-method">
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <Info size={15} className="muted" />
              <strong>How the numbers are computed</strong>
            </div>
            <p>
              Students are ranked by combined points, scanned plus written. With more than 30 takers the groups are
              the top and bottom 27%; with 30 or fewer, the top and bottom half. For scanned items, difficulty is the
              average proportion correct between the two groups and discrimination is the high-group proportion minus
              the low-group proportion. For written items, difficulty is the share of the item’s points the class
              earned and discrimination compares the two groups on the same scale. A distractor is defective when the
              high group chooses it more often than the low group, and rejected when nobody chooses it.
            </p>
            <p className="tiny faint" style={{ marginTop: 6 }}>
              Recommendation follows the template matrix: Easy + not discriminating → Discard; Easy + average or
              discriminating → Needs Revision; Average + not discriminating → Needs Revision; Average + average →
              May Need Revision; Average or Hard + discriminating → Accept; Hard + not discriminating → Discard;
              Hard + average → May Need Revision. Written items are never marked Discard. All suggestions are advisory.
            </p>
            <p className="tiny faint" style={{ marginTop: 6 }}>
              <Info size={12} /> {report.takers} analyzed of {report.checkedCount} checked ·{' '}
              {report.scannedItemCount} scanned item{report.scannedItemCount === 1 ? '' : 's'} and{' '}
              {report.writtenItemCount} written item{report.writtenItemCount === 1 ? '' : 's'} ·{' '}
              {report.points} points.
              {' '}{report.highGroup.length > 0 ? `High group spans ${report.highGroup[0].score}–${report.highGroup[report.highGroup.length - 1].score} of ${report.points} points.` : ''}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
