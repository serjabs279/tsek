import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  PencilLine,
  ScanLine,
  Table2,
  Trash2,
} from 'lucide-react';
import type { Exam, ItemFlag, ScanResult } from '@shared/types';
import { useApp } from '@shared/store/AppStore';
import { materializeItems } from '@shared/lib/sections';
import { recalculateResult, resolveFlag, summarize } from '@shared/lib/results';
import { scoreResult } from '@shared/lib/scoring';
import { Badge } from '@shared/components/ui';
import { EmptyBlock, MobileSheet, ScreenHead, StatTile, TypeToConfirm } from '../components/Common';
import type { ExamTab } from '../MobileApp';

function flagLabel(flag: ItemFlag): string {
  if (flag.multiple) return 'multiple marks';
  if (flag.ambiguous) return 'uncertain mark';
  return 'faint mark';
}

function strengthText(flag: ItemFlag): string {
  if (!flag.strength) return '';
  return Object.entries(flag.strength)
    .sort((a, b) => b[1] - a[1])
    .map(([choice, value]) => `${choice} ${value.toFixed(2)}`)
    .join(' · ');
}

export function ResultsScreen({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: ExamTab) => void }) {
  const { state, updateResult, deleteResult, toast } = useApp();
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);
  const summary = summarize(exam, learners, results);
  const items = useMemo(() => materializeItems(exam), [exam]);
  const scannedItems = items.filter((item) => item.scannable);
  const writtenItems = items.filter((item) => !item.scannable);

  const [detail, setDetail] = useState<ScanResult | null>(null);
  const [dirty, setDirty] = useState(false);
  const [onlyReview, setOnlyReview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const visible = useMemo(
    () => (onlyReview ? results.filter((result) => result.needsReview) : results),
    [results, onlyReview]
  );

  const open = (result: ScanResult) => {
    setDetail(result);
    setDirty(false);
  };

  const close = () => {
    setDetail(null);
    setDirty(false);
  };

  const setAnswer = (answerIndex: number | null, choice: string | null) => {
    if (!detail || answerIndex === null) return;
    const answers = [...detail.answers];
    answers[answerIndex] = answers[answerIndex] === choice ? null : choice;
    setDetail({ ...detail, answers });
    setDirty(true);
  };

  const persist = (next: ScanResult, message: string) => {
    updateResult(next.id, next);
    setDetail(next);
    setDirty(false);
    toast(message, 'success');
  };

  const verifySheet = () => {
    if (!detail) return;
    persist(
      {
        ...detail,
        flags: detail.flags.map((flag) => ({ ...flag, resolved: true })),
        needsReview: false,
        verifiedManually: true,
      },
      `${detail.name} marked as verified — answers unchanged.`
    );
  };

  const confirmFlag = (flag: ItemFlag) => {
    if (!detail) return;
    if (dirty) {
      toast('Save your corrections before confirming scanner flags.', 'danger');
      return;
    }
    const next = resolveFlag(detail, flag.item);
    updateResult(next.id, next);
    setDetail(next);
    toast(
      next.needsReview
        ? `Item ${flag.item} confirmed. ${next.flags.filter((entry) => !entry.resolved).length} flag(s) still open.`
        : `${detail.name} is now verified.`,
      'success'
    );
  };

  const saveCorrections = () => {
    if (!detail) return;
    const withFlags: ScanResult = {
      ...detail,
      flags: detail.flags.map((flag) => ({ ...flag, resolved: true })),
    };
    const next = recalculateResult(exam, withFlags, { keepReview: false });
    persist(next, `${detail.name} corrected and re-scored.`);
  };

  const detailScore = detail ? scoreResult(exam, detail) : null;

  return (
    <>
      <ScreenHead
        eyebrow={`${exam.code} · Results`}
        title="Checked sheets"
        subtitle={`${results.length} of ${learners.length} learners checked · ${summary.reviewCount} need review`}
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
              icon={<Table2 size={26} />}
              title="No checked sheets yet"
              message={
                learners.length === 0
                  ? 'Add the class roster and the answer key first. Then scan the returned papers; every saved sheet appears here with its score.'
                  : 'Scan the returned papers with the camera or import photos. Saved sheets appear here, and anything the scanner flags stays marked for review.'
              }
              action={
                <button className="btn btn--primary" onClick={() => onNavigate(learners.length ? 'scan' : 'roster')}>
                  {learners.length ? 'Scan the first batch' : 'Add the roster'}
                </button>
              }
            />
          </div>
        </section>
      ) : (
        <div className="m-stack">
          <div className="m-statrow">
            <StatTile label="Checked" value={`${summary.scannedCount}`} detail={`${summary.missingCount} missing`} />
            <StatTile label="Class average" value={`${summary.averagePercentage}%`} detail={`grade ${summary.averageGrade}`} />
            <StatTile label="Passing" value={`${summary.passingRate}%`} detail={`${summary.passingCount} passing`} />
            <StatTile label="To review" value={`${summary.reviewCount}`} detail={`${summary.incompleteCount} incomplete`} />
          </div>

          {summary.incompleteCount > 0 && (
            <div className="m-note m-note--warn">
              <strong>{summary.incompleteCount} sheet{summary.incompleteCount === 1 ? '' : 's'} missing written scores.</strong>{' '}
              The class average counts only complete papers. Written parts are scored on the desktop app;
              scanned scores still calculate here.
            </div>
          )}

          <section className="m-card">
            <div className="m-card__head">
              <div>
                <h2>Class list</h2>
                <p>Highest {summary.highest}% · lowest {summary.lowest}% on complete papers.</p>
              </div>
              {summary.reviewCount > 0 && (
                <button
                  className={`btn btn--sm ${onlyReview ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setOnlyReview((value) => !value)}
                >
                  {onlyReview ? 'Show all' : `Review only (${summary.reviewCount})`}
                </button>
              )}
            </div>
            <div className="m-card__body">
              {visible.length === 0 ? (
                <div className="m-list-note">Nothing left in the review queue.</div>
              ) : (
                visible.map((result) => {
                  const score = scoreResult(exam, result);
                  const status = result.needsReview
                    ? 'review'
                    : !score.complete
                      ? 'incomplete'
                      : result.manualOverride
                        ? 'edited'
                        : result.verifiedManually
                          ? 'verified'
                          : 'ok';
                  return (
                    <button className="m-resultrow" key={result.id} onClick={() => open(result)}>
                      <div className="m-resultrow__main">
                        <div className="m-resultrow__name">{result.name}</div>
                        <div className="m-resultrow__meta">
                          <span className="m-person__meta">{result.lrn}</span>
                          {status === 'review' && <span className="pill pill--amber">review</span>}
                          {status === 'incomplete' && <span className="pill pill--neutral">written scores missing</span>}
                          {status === 'verified' && <span className="pill pill--green"><CheckCircle2 size={10} /> verified</span>}
                          {status === 'edited' && <span className="pill pill--neutral">edited</span>}
                          {score.complete && score.percentage >= exam.passingPercent && status !== 'review' && (
                            <span className="pill pill--green">passed</span>
                          )}
                          {score.complete && score.percentage < exam.passingPercent && status !== 'review' && (
                            <span className="pill pill--rose">failed</span>
                          )}
                        </div>
                      </div>
                      <div className="m-score">
                        <strong>{score.percentage}%</strong>
                        <span>{score.earned}/{score.possible} pts</span>
                      </div>
                      <ChevronRight size={17} className="muted" />
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <div className="m-note">
            Green marks the answer key; brown marks the learner's scanned answer. Tapping a choice on a
            sheet opens a correction; the class average and item analysis update when you save.
          </div>
        </div>
      )}

      <MobileSheet
        open={Boolean(detail)}
        title={detail?.name ?? 'Checked sheet'}
        subtitle={
          detail
            ? `${detail.lrn} · ${detail.sourceFile || 'manual entry'} · page ${detail.pageNumber}`
            : undefined
        }
        onClose={close}
        footer={
          detail ? (
            <>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => setConfirmDelete(true)}
                style={{ color: 'var(--rose)' }}
              >
                <Trash2 size={14} /> Delete
              </button>
              <span className="m-spacer" />
              {dirty ? (
                <button className="btn btn--primary" onClick={saveCorrections}>
                  <PencilLine size={15} /> Save corrections
                </button>
              ) : detail.needsReview ? (
                <button className="btn btn--primary" onClick={verifySheet}>
                  <Check size={16} /> Mark as verified
                </button>
              ) : (
                <button className="btn btn--soft" onClick={close}>Done</button>
              )}
            </>
          ) : undefined
        }
      >
        {detail && detailScore && (
          <>
            <div className="m-statrow">
              <StatTile label="Score" value={`${detailScore.earned}/${detailScore.possible}`} detail={`${detailScore.percentage}%`} />
              <StatTile label="Grade" value={detailScore.grade} detail={`passing ${exam.passingPercent}%`} />
              <StatTile label="Scanned correct" value={`${detailScore.correctCount}/${detailScore.scannableCount}`} detail="items" />
              <StatTile
                label="Written"
                value={detailScore.manualCount ? `${detailScore.manualScored}/${detailScore.manualCount}` : '—'}
                detail={detailScore.manualCount ? 'scores entered' : 'no written part'}
              />
            </div>

            <div className="m-row" style={{ marginTop: 10 }}>
              {detail.needsReview ? (
                <Badge tone="amber"><AlertTriangle size={11} /> needs review</Badge>
              ) : detail.verifiedManually ? (
                <Badge tone="green"><CheckCircle2 size={11} /> manually verified</Badge>
              ) : (
                <Badge tone="green">reviewed</Badge>
              )}
              {detail.manualOverride && <Badge tone="neutral">answers corrected</Badge>}
              {detail.flags.length > 0 && (
                <span className="m-tiny">
                  {detail.flags.filter((flag) => flag.resolved).length} of {detail.flags.length} flags confirmed
                </span>
              )}
            </div>

            {detail.needsReview && !dirty && (
              <div className="m-note m-note--warn" style={{ marginTop: 10 }}>
                The scanner flagged {detail.flags.filter((flag) => !flag.resolved).length || detail.flags.length} answer
                {(detail.flags.filter((flag) => !flag.resolved).length || detail.flags.length) === 1 ? '' : 's'} on this sheet.
                Check each one, or mark the whole sheet verified when the marks are genuinely as read.
              </div>
            )}

            <section className="m-card" style={{ marginTop: 12 }}>
              <div className="m-card__head">
                <div>
                  <h2>Answers</h2>
                  <p>Tap a choice to correct the scanned answer. The green choice is the key.</p>
                </div>
              </div>
              <div className="m-card__body">
                <div className="m-answerlist">
                  {scannedItems.map((item) => {
                    const answerIndex = item.answerIndex ?? -1;
                    const key = exam.answerKey[answerIndex] ?? '';
                    const answer = detail.answers[answerIndex] ?? '';
                    const flag = detail.flags.find((entry) => entry.item === item.number);
                    return (
                      <div className="m-answerrow" key={item.number}>
                        <div className="m-answerrow__num">{String(item.number).padStart(2, '0')}</div>
                        <div className="m-answerrow__body">
                          <div className="m-answerrow__choices">
                            {item.choices.map((choice) => (
                              <button
                                key={choice}
                                className={`m-choice ${choice === key ? 'is-key' : ''} ${choice === answer ? 'is-answer' : ''}`}
                                onClick={() => setAnswer(item.answerIndex, choice)}
                                aria-pressed={choice === answer}
                                aria-label={`Item ${item.number}, choice ${choice}`}
                              >
                                {choice}
                              </button>
                            ))}
                            <button
                              className={`m-choice ${answer ? '' : 'is-blank'}`}
                              onClick={() => setAnswer(item.answerIndex, null)}
                              aria-label={`Item ${item.number}, clear answer`}
                            >
                              –
                            </button>
                          </div>
                          <div className="m-answerrow__foot">
                            <span className="m-tiny">
                              key {key || 'blank'} · learner {answer || 'blank'}
                              {answer && key && answer === key ? ' · correct' : answer ? ' · wrong' : ''}
                            </span>
                            {flag && (
                              <>
                                {flag.resolved ? (
                                  <span className="m-flag m-flag--ok"><CheckCircle2 size={11} /> confirmed</span>
                                ) : (
                                  <span className="m-flag"><AlertTriangle size={11} /> {flagLabel(flag)}</span>
                                )}
                                {flag.strength && <span className="m-tiny">{strengthText(flag)}</span>}
                                {!flag.resolved && (
                                  <button
                                    className="btn btn--ghost btn--sm"
                                    style={{ minHeight: 26, padding: '1px 8px' }}
                                    onClick={() => confirmFlag(flag)}
                                    disabled={dirty}
                                  >
                                    Confirm
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {writtenItems.length > 0 && (
              <div className="m-note" style={{ marginTop: 12 }}>
                <strong>{writtenItems.length} written item{writtenItems.length === 1 ? '' : 's'} on this test.</strong>{' '}
                {detailScore.manualScored > 0
                  ? `${detailScore.manualScored} score${detailScore.manualScored === 1 ? '' : 's'} already entered on desktop; `
                  : 'No written scores are recorded yet; '}
                the percentage above is out of the full test. Save corrections here only affects the scanned answers.
              </div>
            )}

            {dirty && (
              <div className="m-note m-note--warn" style={{ marginTop: 10 }}>
                Unsaved corrections. Saving re-scores the sheet and marks this review complete.
              </div>
            )}
          </>
        )}
      </MobileSheet>

      <TypeToConfirm
        open={confirmDelete}
        title="Delete this checked sheet?"
        message={
          <>
            <strong>{detail?.name}</strong> and their scanned answers are removed from this exam. The
            learner stays on the roster and can be scanned again.
          </>
        }
        phrase="DELETE"
        confirmLabel="Delete sheet"
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (!detail) return;
          deleteResult(detail.id);
          toast('Checked sheet deleted.', 'danger');
          close();
        }}
      />
    </>
  );
}
