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
  buildMcqAnalysis,
  buildNonMcqAnalysis,
  explainRecommendation,
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
  const [view, setView] = useState<'overall' | 'mcq' | 'non-mcq'>('overall');
  const thresholds = exam.analysis ?? DEFAULT_ANALYSIS_THRESHOLDS;
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);
  const report = useMemo(() => buildItemAnalysis(exam, results, thresholds), [exam, results, thresholds]);
  const mcqReport = useMemo(() => buildMcqAnalysis(exam, results, thresholds), [exam, results, thresholds]);
  const nonMcqReport = useMemo(() => buildNonMcqAnalysis(exam, results, thresholds), [exam, results, thresholds]);
  const active = view === 'overall' ? report : view === 'mcq' ? mcqReport : nonMcqReport;

  const patchThresholds = (patch: Partial<AnalysisThresholds>) =>
    updateExam(exam.id, { analysis: { ...thresholds, ...patch } });

  const visibleItems = active.items.filter((item) => filter === 'All' || item.recommendation === filter);
  const flagged = active.items.filter((item) =>
    item.recommendation === 'Needs Revision' || item.recommendation === 'Discard'
  ).length;
  const difficultyTotal = active.items.filter((item) => item.difficulty !== null).length;
  const discriminationTotal = active.items.filter((item) => item.discrimination !== null).length;
  const recommendedTotal = active.items.filter((item) => item.recommendation !== '—').length;
  const hasMcq = mcqReport.itemCount > 0;
  const hasNonMcq = nonMcqReport.itemCount > 0;
  const reports = [report, mcqReport, nonMcqReport];
  const pointsEarnedRatio = active.pointsEarnedRatio;

  const printReport = () => {
    if (report.takers === 0) {
      toast('Check at least one answer sheet before printing an item analysis.', 'danger');
      return;
    }
    printHtml(buildAnalysisPrintHtml(exam, reports, state.settings, thresholds));
  };

  const exportPdf = async () => {
    if (report.takers === 0) {
      toast('Check at least one answer sheet before exporting.', 'danger');
      return;
    }
    try {
      const bytes = await buildItemAnalysisPdf(exam, reports, state.settings, thresholds);
      downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), reportFilename('ItemAnalysis', exam));
      toast(
        `Item analysis PDF downloaded.${
          hasMcq && hasNonMcq ? ' It covers the overall, MCQ, and non-MCQ views.' : ' It covers the views this test has.'
        }`,
        'success'
      );
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
    downloadText(buildAnalysisCsv(exam, reports), `${stem}.csv`, 'text/csv');
    toast('Item analysis CSV downloaded with a block for each view.', 'success');
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

  const showKr = view !== 'non-mcq' && active.scannedItemCount > 0;
  const headlineValue = showKr ? active.reliability.kr20 : active.reliability.alpha;

  const scopeLine =
    view === 'overall'
      ? 'Every item counts: right/wrong items as one point each and each written score as its share of the item’s points.'
      : view === 'mcq'
        ? 'Right/wrong items only. Difficulty is the share of all takers who answered correctly; discrimination is the high-group rate minus the low-group rate.'
        : 'Written items only. Difficulty is the share of each item’s points the class earned; discrimination is the corrected item–total correlation (r).';

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div className="card-head__title">
            <h3>Item analysis · {view === 'overall' ? 'All items' : view === 'mcq' ? 'MCQ only' : 'Non-MCQ only'}</h3>
            <p>
              {active.itemCount === 0
                ? `${active.takers} analyzed of ${active.checkedCount} checked. This view has no items to report.`
                : `High group: top ${active.groupSize} · low group: bottom ${active.groupSize} of ${active.takers} analyzed${
                    active.checkedCount > active.takers ? ` (${active.checkedCount} checked)` : ''
                  }. ${scopeLine}`}
            </p>
          </div>
          <div className="analysis-view-tabs" role="tablist" aria-label="Analysis view">
            {([
              ['overall', 'Overall', report.itemCount],
              ['mcq', 'MCQ', mcqReport.itemCount],
              ['non-mcq', 'Non-MCQ', nonMcqReport.itemCount],
            ] as const).map(([key, label, count]) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                className={`analysis-filter ${view === key ? 'is-active' : ''}`}
                onClick={() => {
                  setView(key);
                  setFilter('All');
                }}
                title={
                  key === 'mcq' && !hasMcq
                    ? 'This test has no scanned items.'
                    : key === 'non-mcq' && !hasNonMcq
                      ? 'This test has no written items.'
                      : `Show ${label.toLowerCase()} analysis`
                }
              >
                {label}
                <span>{count}</span>
              </button>
            ))}
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
          {active.itemCount === 0 ? (
            <EmptyState
              icon={<Info size={26} />}
              title={view === 'mcq' ? 'No scanned items in this test' : 'No written items in this test'}
              message={
                view === 'mcq'
                  ? 'The MCQ view reads the multiple-choice and true/false bubbles the scanner checks. This test is built from written parts only, so the Overall and Non-MCQ views cover every item.'
                  : 'The Non-MCQ view analyses Identification, Enumeration, Essay, and other hand-scored parts. Add one in Setup and save the structure — its scores are then entered on the Scores tab. Until then, the Overall and MCQ views cover this test.'
              }
              action={
                <div className="row row--wrap" style={{ justifyContent: 'center', gap: 8 }}>
                  <button className="btn btn--primary btn--sm" onClick={() => onNavigate('setup')}>
                    Open Setup
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setView('overall')}>
                    Show overall analysis
                  </button>
                </div>
              }
            />
          ) : (
            <>
          <div className="stat-grid">
            <StatCard
              label="Analyzed takers"
              value={active.takers}
              detail={`${active.itemCount} items · ${active.points} pts · group N = ${active.groupSize}`}
              icon={<BarChart3 size={17} />}
            />
            <StatCard
              label="Average difficulty"
              value={formatPercent(active.averageDifficulty)}
              detail={
                active.averageDifficulty === null
                  ? view === 'non-mcq'
                    ? 'Needs at least one scored paper'
                    : 'Needs at least two takers'
                  : active.averageDifficulty > thresholds.easyAbove
                    ? 'Easy items on average'
                    : active.averageDifficulty < thresholds.hardBelow
                      ? 'Hard items on average'
                      : 'Average difficulty'
              }
              icon={<BarChart3 size={17} />}
            />
            <StatCard
              label="Average discrimination"
              value={formatIndex(active.averageDiscrimination)}
              detail={
                active.averageDiscrimination === null
                  ? view === 'non-mcq'
                    ? 'Needs at least two written rows'
                    : 'Needs at least two takers'
                  : active.averageDiscrimination > thresholds.discriminatingAbove
                    ? view === 'non-mcq'
                      ? 'Items track the written total well'
                      : 'Items separate the groups well'
                    : active.averageDiscrimination < thresholds.notDiscriminatingBelow
                      ? view === 'non-mcq'
                        ? 'Items do not track the written total'
                        : 'Items do not separate the groups'
                      : 'Average discrimination'
              }
              icon={<BarChart3 size={17} />}
            />
            <StatCard
              label={showKr ? 'KR-20 · right/wrong' : 'Cronbach’s alpha'}
              value={headlineValue === null ? '—' : headlineValue.toFixed(3)}
              detail={
                showKr
                  ? reliabilityLabel(active.reliability.kr20)
                  : active.reliability.alpha === null
                    ? 'Needs at least two written rows'
                    : `${reliabilityLabel(active.reliability.alpha)} · partial credit`
              }
              icon={<CheckCircle2 size={17} />}
            />
          </div>

          <div className="analysis-scoreband">
            <div className="analysis-scoreband__item">
              <span className="analysis-scoreband__label">Mean score</span>
              <span className="analysis-scoreband__value">
                {active.reliability.mean} / {active.points} pts
              </span>
              <span className="analysis-scoreband__hint">SD {active.reliability.standardDeviation}</span>
            </div>
            <div className="analysis-scoreband__item">
              <span className="analysis-scoreband__label">Points earned</span>
              <span className="analysis-scoreband__value">{formatPercent(pointsEarnedRatio)}</span>
              <span className="analysis-scoreband__hint">class total ÷ points possible</span>
            </div>
            {view === 'overall' && hasMcq && (
              <div className="analysis-scoreband__item">
                <span className="analysis-scoreband__label">MCQ points</span>
                <span className="analysis-scoreband__value">
                  {mcqReport.reliability.mean} / {mcqReport.points}
                </span>
                <span className="analysis-scoreband__hint">{formatPercent(mcqReport.pointsEarnedRatio)} earned</span>
              </div>
            )}
            {view === 'overall' && hasNonMcq && (
              <div className="analysis-scoreband__item">
                <span className="analysis-scoreband__label">Written points</span>
                <span className="analysis-scoreband__value">
                  {nonMcqReport.reliability.mean} / {nonMcqReport.points}
                </span>
                <span className="analysis-scoreband__hint">{formatPercent(nonMcqReport.pointsEarnedRatio)} earned</span>
              </div>
            )}
          </div>
          <p className="tiny faint" style={{ marginTop: 8 }}>
            Average item difficulty above is the mean of the per-item difficulty values. Points earned is the class
            total divided by the points possible — a different figure whenever items carry different maximum points.
          </p>

          {active.warnings.length > 0 && (
            <div className="card-note card-note--warn" style={{ marginTop: 14 }}>
              <div className="stack" style={{ gap: 6 }}>
                {active.warnings.map((warning) => (
                  <div className="row" style={{ gap: 8, alignItems: 'flex-start' }} key={warning}>
                    <AlertTriangle size={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
            </>
          )}
        </div>
      </section>

      {active.itemCount > 0 && (
        <>
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
              {showKr && (
                <>
                  <div className="mini-list__row">
                    <span>KR-20 <span className="tiny faint">right/wrong items</span></span>
                    <span className="row" style={{ gap: 7 }}>
                      <strong>{active.reliability.kr20 === null ? '—' : active.reliability.kr20.toFixed(3)}</strong>
                      <Badge tone={reliabilityTone(active.reliability.kr20)}>{reliabilityLabel(active.reliability.kr20)}</Badge>
                    </span>
                  </div>
                  <div className="mini-list__row">
                    <span>KR-21 <span className="tiny faint">right/wrong, even difficulty</span></span>
                    <span className="row" style={{ gap: 7 }}>
                      <strong>{active.reliability.kr21 === null ? '—' : active.reliability.kr21.toFixed(3)}</strong>
                      <Badge tone={reliabilityTone(active.reliability.kr21)}>{reliabilityLabel(active.reliability.kr21)}</Badge>
                    </span>
                  </div>
                </>
              )}
              <div className="mini-list__row">
                <span>
                  Cronbach’s alpha{' '}
                  <span className="tiny faint">
                    {view === 'mcq' ? 'right/wrong items' : view === 'non-mcq' ? 'written items' : 'all scored rows'}
                  </span>
                </span>
                <span className="row" style={{ gap: 7 }}>
                  <strong>{active.reliability.alpha === null ? '—' : active.reliability.alpha.toFixed(3)}</strong>
                  <Badge tone={reliabilityTone(active.reliability.alpha)}>{reliabilityLabel(active.reliability.alpha)}</Badge>
                </span>
              </div>
            </div>
            <p className="tiny faint" style={{ marginTop: 10 }}>
              {view === 'non-mcq'
                ? `Written scores are partial credit, not right or wrong, so KR-20 and KR-21 are not computed here. ${
                    active.reliability.alpha === null
                      ? `Cronbach’s alpha needs at least two scored rows; this view has ${active.unitCount}.`
                      : `Cronbach’s alpha covers the ${active.unitCount} scored row${active.unitCount === 1 ? '' : 's'}, with each score expressed as the share of its item’s points.`
                  }`
                : `KR-20 and KR-21 use only the ${active.scannedItemCount} right/wrong item${
                    active.scannedItemCount === 1 ? '' : 's'
                  } in this view. Cronbach’s alpha covers all ${active.unitCount} scored row${active.unitCount === 1 ? '' : 's'}${
                    view === 'overall' ? ', including written scores scaled to the share of their points' : ''
                  }.${active.pooledPartCount > 0 ? ` Pooled parts count once each (${active.pooledPartCount} here).` : ''}`}
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
                const count = active.difficultyCounts[band];
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
                const count = active.discriminationCounts[band];
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
            <div className="dist-block">
              <div className="dist-block__title">Student scores <span className="tiny faint">% of {active.points} pts</span></div>
              {active.scoreBands.map((band) => (
                <div className="dist-row" key={band.label}>
                  <span className="dist-row__label">{band.label.replace('%', '')}</span>
                  <span className="dist-row__bar">
                    <span
                      className={`dist-row__fill dist-row__fill--${
                        band.from < 60 ? 'hard' : band.from < 80 ? 'average' : 'easy'
                      }`}
                      style={{ width: `${active.takers ? (band.count / active.takers) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="dist-row__count">{band.count}</span>
                </div>
              ))}
            </div>
            <div className={`card-note ${flagged > 0 ? 'card-note--warn' : ''}`} style={{ marginTop: 12 }}>
              <div className="row" style={{ gap: 7 }}>
                <AlertTriangle size={14} />
                <span>
                  {flagged > 0
                    ? `${flagged} item${flagged === 1 ? '' : 's'} need revision or should be discarded.`
                    : recommendedTotal > 0
                      ? 'No item needs revision or discarding.'
                      : 'Recommendations appear once an item has both a computable difficulty and discrimination.'}
                </span>
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
                  <strong>{active.recommendationCounts[rec]}</strong>
                </button>
              ))}
            </div>
            {view !== 'non-mcq' && (
              <div className="mini-list" style={{ marginTop: 10 }}>
                <div className="mini-list__row"><span>Distractors OK</span><strong>{active.distractorCounts.ok}</strong></div>
                <div className="mini-list__row"><span>Defective (D)</span><strong>{active.distractorCounts.defect}</strong></div>
                <div className="mini-list__row"><span>Rejected (R)</span><strong>{active.distractorCounts.reject}</strong></div>
              </div>
            )}
            {recommendedTotal === 0 && (
              <p className="muted" style={{ marginTop: 10, fontSize: 12, lineHeight: 1.5 }}>
                No item in this view has both a computable difficulty and discrimination yet,
                so no verdict can be given.
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head card-head--wrap">
          <div className="card-head__title">
            <h3>Per-item results</h3>
            <p>
              {view === 'non-mcq'
                ? 'Each written row shows its maximum points, the class mean, the median, the lowest–highest scores, and how many takers were scored. A pooled part appears as one row for the whole part.'
                : 'For right/wrong items, high and low are counts of students who chose the option. Written rows show mean points earned by each group. A pooled part appears as one row for the whole part.'}
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
                    ? active.items.length
                    : active.recommendationCounts[item]}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="card-body card-body--tight">
          <div className="analysis-scroll">
            <table className="analysis-table">
              <thead>
                {view === 'non-mcq' ? (
                  <tr>
                    <th>#</th>
                    <th>Part</th>
                    <th>Max pts</th>
                    <th>Mean</th>
                    <th>Median</th>
                    <th>Range</th>
                    <th>Scored</th>
                    <th>Difficulty <span className="tiny faint">% earned</span></th>
                    <th>Discrimination <span className="tiny faint">item–total r</span></th>
                    <th>Recommendation</th>
                  </tr>
                ) : (
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
                )}
              </thead>
              <tbody>
                {visibleItems.map((item) =>
                  view === 'non-mcq' ? (
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
                      <td className="analysis-num">{formatPoints(item.points)}</td>
                      <td className="analysis-num">{formatPoints(item.meanEarned)}</td>
                      <td className="analysis-num">
                        {item.scoreMedian === null ? '—' : formatPoints(item.scoreMedian)}
                      </td>
                      <td className="analysis-num">
                        {item.scoreMin === null || item.scoreMax === null
                          ? '—'
                          : `${formatPoints(item.scoreMin)}–${formatPoints(item.scoreMax)}`}
                      </td>
                      <td className="analysis-num">{item.scoredCount}</td>
                      <td>
                        <span className={`band-chip band-chip--${slug(item.difficultyBand)}`}>
                          {item.difficulty === null ? '—' : `${formatPercent(item.difficulty)} · ${item.difficultyBand}`}
                        </span>
                      </td>
                      <td>
                        <span className={`band-chip band-chip--${slug(item.discriminationBand)}`}>
                          {item.discrimination === null ? '—' : `${formatIndex(item.discrimination)} · ${item.discriminationBand}`}
                        </span>
                      </td>
                      <td>
                        <span className={`rec-chip rec-chip--${slug(item.recommendation)}`}>{item.recommendation}</span>
                        {explainRecommendation(item, view) && (
                          <div className="rec-reason">{explainRecommendation(item, view)}</div>
                        )}
                      </td>
                    </tr>
                  ) : (
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
                          {item.difficulty === null ? '—' : `${formatIndex(item.difficulty)} · ${item.difficultyBand}`}
                        </span>
                      </td>
                      <td>
                        <span className={`band-chip band-chip--${slug(item.discriminationBand)}`}>
                          {item.discrimination === null ? '—' : `${formatIndex(item.discrimination)} · ${item.discriminationBand}`}
                        </span>
                      </td>
                      <td>
                        <span className={`rec-chip rec-chip--${slug(item.recommendation)}`}>{item.recommendation}</span>
                        {explainRecommendation(item, view) && (
                          <div className="rec-reason">{explainRecommendation(item, view)}</div>
                        )}
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
                            {item.scoreMin !== null && item.scoreMax !== null && (
                              <span className="written-cell__value">
                                range {formatPoints(item.scoreMin)}–{formatPoints(item.scoreMax)}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                )}
                {visibleItems.length === 0 && (
                  <tr>
                    <td colSpan={view === 'non-mcq' ? 10 : 9}>
                      <div className="table-empty">No item matches this recommendation filter.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="analysis-legend">
            {view === 'non-mcq' ? (
              <>
                <span><b>% earned</b> points earned ÷ points possible for that item</span>
                <span><b>r</b> corrected item–total correlation</span>
                <span><b>KR-20</b> not used for partial credit</span>
              </>
            ) : (
              <>
                <span><b>D</b> defect — chosen more by the high group</span>
                <span><b>R</b> rejected — nobody chose it</span>
                <span><b>OK</b> acceptable distractor</span>
                <span><b>High/Low</b> counts per group, or mean points for written items</span>
              </>
            )}
          </div>
        </div>
      </section>
        </>
      )}

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
              Students are ranked by the combined score across the whole test — scanned plus written — so the high and
              low groups are the same students in every view. With more than 30 takers the groups are the top and
              bottom 27%; with 30 or fewer, the top and bottom half.
            </p>
            <p className="tiny faint" style={{ marginTop: 6 }}>
              <b>MCQ view:</b> difficulty is the share of all takers who answered correctly; discrimination is the
              high-group rate minus the low-group rate. <b>Non-MCQ view:</b> difficulty is the points earned on the
              item divided by its points possible; discrimination is the corrected item–total correlation, so an item
              is never correlated with a total that already includes it. <b>Overall view</b> keeps the extreme-group
              difficulty for right/wrong items and the high/low contrast for written rows so it stays comparable with
              the school template. A distractor is defective when the high group chooses it more often than the low
              group, and rejected when nobody chooses it.
            </p>
            <p className="tiny faint" style={{ marginTop: 6 }}>
              Recommendation follows the template matrix: Easy + not discriminating → Discard; Easy + average or
              discriminating → Needs Revision; Average + not discriminating → Needs Revision; Average + average →
              May Need Revision; Average or Hard + discriminating → Accept; Hard + not discriminating → Discard;
              Hard + average → May Need Revision. Written items are never marked Discard. All suggestions are advisory.
            </p>
            <p className="tiny faint" style={{ marginTop: 6 }}>
              <Info size={12} /> {active.takers} analyzed of {active.checkedCount} checked ·{' '}
              {active.scannedItemCount} scanned item{active.scannedItemCount === 1 ? '' : 's'} and{' '}
              {active.writtenItemCount} written item{active.writtenItemCount === 1 ? '' : 's'} ·{' '}
              {active.points} points.
              {' '}{active.highGroup.length > 0 ? `High group spans ${active.highGroup[0].score}–${active.highGroup[active.highGroup.length - 1].score} of ${active.points} points.` : ''}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
