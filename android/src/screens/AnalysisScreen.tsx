import { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, ScanLine } from 'lucide-react';
import type { AnalysisThresholds, Exam } from '@shared/types';
import { useApp } from '@shared/store/AppStore';
import {
  DEFAULT_ANALYSIS_THRESHOLDS,
  buildItemAnalysis,
  buildMcqAnalysis,
  buildNonMcqAnalysis,
  explainRecommendation,
  formatIndex,
  formatPercent,
  reliabilityBand,
  type ItemStat,
  type Recommendation,
} from '@shared/lib/analysis';
import { Badge } from '@shared/components/ui';
import { EmptyBlock, ScreenHead, StatTile } from '../components/Common';
import type { ExamTab } from '../MobileApp';

type Scope = 'overall' | 'mcq' | 'non-mcq';

const SCOPES: Array<{ id: Scope; label: string }> = [
  { id: 'overall', label: 'Overall' },
  { id: 'mcq', label: 'MCQ' },
  { id: 'non-mcq', label: 'Non-MCQ' },
];

function recommendationTone(value: Recommendation): 'green' | 'amber' | 'rose' | 'neutral' {
  if (value === 'Accept') return 'green';
  if (value === 'May Need Revision') return 'amber';
  if (value === 'Needs Revision' || value === 'Discard') return 'rose';
  return 'neutral';
}

function itemTitle(item: ItemStat): string {
  if (item.part) return `Part ${item.item}–${item.endItem} · ${item.sectionTitle}`;
  return `Item ${item.item} · ${item.sectionTitle}`;
}

export function AnalysisScreen({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: ExamTab) => void }) {
  const { state } = useApp();
  const results = state.results.filter((result) => result.examId === exam.id);
  const [scope, setScope] = useState<Scope>('overall');

  const thresholds: AnalysisThresholds = exam.analysis ?? DEFAULT_ANALYSIS_THRESHOLDS;
  const reports = useMemo(
    () => ({
      overall: buildItemAnalysis(exam, results, thresholds),
      mcq: buildMcqAnalysis(exam, results, thresholds),
      'non-mcq': buildNonMcqAnalysis(exam, results, thresholds),
    }),
    [exam, results, thresholds]
  );

  const report = reports[scope];
  const hasMcq = reports.mcq.unitCount > 0;
  const hasWritten = reports['non-mcq'].unitCount > 0;

  return (
    <>
      <ScreenHead
        eyebrow={`${exam.code} · Item analysis`}
        title="How the items behaved"
        subtitle={`${results.length} checked sheet${results.length === 1 ? '' : 's'} · ${report.takers} complete paper${report.takers === 1 ? '' : 's'} analysed`}
        actions={
          <button className="btn btn--primary btn--sm" onClick={() => onNavigate('scan')}>
            <ScanLine size={15} /> Scan
          </button>
        }
      />

      {results.length === 0 ? (
        <section className="m-card">
          <div className="m-card__body">
            <EmptyBlock
              icon={<BarChart3 size={26} />}
              title="Nothing to analyse yet"
              message="Item difficulty, discrimination, distractor checks, and reliability come from checked sheets. Scan a batch first; every saved paper adds to the analysis."
              action={<button className="btn btn--primary" onClick={() => onNavigate('scan')}>Scan a batch</button>}
            />
          </div>
        </section>
      ) : (
        <div className="m-stack">
          <div className="m-row">
            {SCOPES.map((entry) => {
              const unavailable = (entry.id === 'mcq' && !hasMcq) || (entry.id === 'non-mcq' && !hasWritten);
              return (
                <button
                  key={entry.id}
                  className={`btn ${scope === entry.id ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setScope(entry.id)}
                  disabled={unavailable}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>

          {report.warnings.length > 0 && (
            <div className="m-note m-note--warn">
              {report.warnings.map((warning) => (
                <div key={warning} style={{ display: 'flex', gap: 7 }}>
                  <AlertTriangle size={14} style={{ flex: 'none', marginTop: 1 }} />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}

          {report.takers === 0 ? (
            <section className="m-card">
              <div className="m-card__body">
                <EmptyBlock
                  icon={<BarChart3 size={24} />}
                  title="No complete papers in this scope"
                  message={
                    scope === 'non-mcq'
                      ? 'Written parts need a recorded score for every paper. Enter those scores on the desktop app, then reopen this tablet build to see the written-item analysis.'
                      : 'The analysis needs at least one complete checked sheet. Written parts must be scored before a mixed test can be compared as a whole.'
                  }
                />
              </div>
            </section>
          ) : (
            <>
              <div className="m-statrow">
                <StatTile label="Papers" value={report.takers} detail={`${report.checkedCount} checked`} />
                <StatTile label="Points earned" value={formatPercent(report.pointsEarnedRatio)} detail={`${report.points} possible`} />
                <StatTile label="Avg. difficulty" value={formatPercent(report.averageDifficulty)} detail={`${report.groupSize} per group`} />
                <StatTile label="Avg. discrimination" value={formatIndex(report.averageDiscrimination)} detail="high minus low" />
              </div>
              <div className="m-statrow">
                <StatTile
                  label="KR-20"
                  value={report.reliability.kr20 === null ? '—' : report.reliability.kr20.toFixed(2)}
                  detail={`${reliabilityBand(report.reliability.kr20)} · scanned`}
                />
                <StatTile
                  label="Cronbach α"
                  value={report.reliability.alpha === null ? '—' : report.reliability.alpha.toFixed(2)}
                  detail={`${reliabilityBand(report.reliability.alpha)} · all items`}
                />
                <StatTile label="Mean score" value={report.reliability.mean.toFixed(1)} detail={`SD ${report.reliability.standardDeviation.toFixed(1)}`} />
                <StatTile label="Rows" value={report.unitCount} detail={`${report.pooledPartCount} pooled part(s)`} />
              </div>

              <section className="m-card">
                <div className="m-card__head">
                  <div>
                    <h2>Recommendations</h2>
                    <p>Based on difficulty, discrimination, and the distractor checks below.</p>
                  </div>
                </div>
                <div className="m-card__body">
                  <div className="m-row">
                    <Badge tone="green">{report.recommendationCounts.Accept} accept</Badge>
                    <Badge tone="amber">{report.recommendationCounts['May Need Revision']} may need revision</Badge>
                    <Badge tone="rose">{report.recommendationCounts['Needs Revision']} needs revision</Badge>
                    <Badge tone="rose">{report.recommendationCounts.Discard} discard</Badge>
                  </div>
                  <div className="m-row" style={{ marginTop: 9 }}>
                    <span className="m-chip">{report.difficultyCounts.Easy} easy</span>
                    <span className="m-chip">{report.difficultyCounts.Average} average</span>
                    <span className="m-chip">{report.difficultyCounts.Hard} hard</span>
                    <span className="m-chip">{report.discriminationCounts.Discriminating} discriminating</span>
                    <span className="m-chip">{report.discriminationCounts['Not Discriminating']} not discriminating</span>
                  </div>
                  <div className="m-row" style={{ marginTop: 9 }}>
                    <span className="m-tiny">
                      Distractors: {report.distractorCounts.ok} healthy · {report.distractorCounts.defect} favour the low group ·{' '}
                      {report.distractorCounts.reject} never chosen · {report.distractorCounts.both} both
                    </span>
                  </div>
                </div>
              </section>

              <section className="m-card">
                <div className="m-card__head">
                  <div>
                    <h2>Item by item</h2>
                    <p>Tap an item for the per-choice counts and the reason behind its recommendation.</p>
                  </div>
                </div>
                <div className="m-card__body">
                  {report.items.map((item) => (
                    <details className="m-analysis-item" key={`${item.sectionId}-${item.item}`}>
                      <summary>
                        <span className="m-analysis-item__num">
                          {item.part ? `${item.item}–${item.endItem}` : item.item}
                        </span>
                        <span className="m-analysis-item__title">{itemTitle(item)}</span>
                        <span className="m-tiny">key {item.key || '—'}</span>
                        <Badge tone={recommendationTone(item.recommendation)}>{item.recommendation}</Badge>
                      </summary>
                      <div className="m-analysis-item__body">
                        <div className="m-statrow" style={{ marginBottom: 8 }}>
                          <StatTile label="Difficulty" value={formatPercent(item.difficulty)} detail={item.difficultyBand} />
                          <StatTile label="Discrimination" value={formatIndex(item.discrimination)} detail={item.discriminationBand} />
                          <StatTile
                            label="High group"
                            value={item.scannable ? `${item.highCorrect}` : item.highMean.toFixed(1)}
                            detail={item.scannable ? 'correct' : 'mean points'}
                          />
                          <StatTile
                            label="Low group"
                            value={item.scannable ? `${item.lowCorrect}` : item.lowMean.toFixed(1)}
                            detail={item.scannable ? 'correct' : 'mean points'}
                          />
                        </div>
                        <p style={{ margin: '0 0 8px', color: 'var(--ink-2)' }}>
                          {explainRecommendation(item, report.scope)}
                        </p>
                        {item.choices.length > 0 && (
                          <div>
                            {item.choices.map((choice) => (
                              <div className="m-distractor" key={choice.choice}>
                                <span className={`m-distractor__choice ${choice.isKey ? 'is-key' : ''}`}>{choice.choice}</span>
                                <span style={{ flex: 1 }}>
                                  high {choice.high} · low {choice.low} · total {choice.total}
                                  {!choice.isKey && choice.index !== null ? ` · D ${choice.index.toFixed(2)}` : ''}
                                </span>
                                <span className="m-tiny">
                                  {choice.isKey
                                    ? 'key'
                                    : choice.status === 'D'
                                      ? 'favours low group'
                                      : choice.status === 'R'
                                        ? 'never chosen'
                                        : choice.status === 'DR'
                                          ? 'both defects'
                                          : 'OK'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {!item.scannable && item.scoredCount < report.takers && (
                          <div className="m-tiny">Only {item.scoredCount} of {report.takers} papers have a score for this row.</div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </section>

              <div className="m-note">
                <strong>Reading the numbers.</strong> Difficulty is the share of papers that earned the
                item; discrimination compares the top and bottom groups by total score. With fewer than
                about ten papers, treat both as a rough signal rather than a verdict. Every row still
                counts in the class record.
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
