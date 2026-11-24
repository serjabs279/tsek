import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FileText,
  PenLine,
  Printer,
  ScanLine,
  Users,
} from 'lucide-react';
import type { Exam } from '@shared/types';
import { useApp } from '@shared/store/AppStore';
import { manualItems } from '@shared/lib/sections';
import { PAPER_SIZES } from '@shared/omr/layout';
import { planWrittenSheets, writtenPanelGeometry } from '@shared/lib/written';
import {
  buildCombinedSheetPdf,
  buildCombinedSheetsPdf,
  buildSheetsPdf,
  buildSingleSheetPdf,
} from '@shared/omr/sheetPdf';
import { buildWrittenSheetPdf, buildWrittenSheetsPdf } from '@shared/omr/writtenPdf';
import { safeFilename } from '@shared/lib/download';
import { isDesktop } from '@shared/lib/desktop';
import { SheetPreview } from '@shared/components/SheetPreview';
import { Badge, Spinner } from '@shared/components/ui';
import { EmptyBlock, ScreenHead } from '../components/Common';
import { savePdf } from '../lib/savePdf';
import type { ExamTab } from '../MobileApp';

type WrittenMode = 'combined' | 'separate' | 'off';

/**
 * The tablet has no printer dialog, so this screen replaces "Print" with
 * "Save as PDF": Android's own picker decides where the file lands, and the
 * teacher opens it from Files, Drive, or a print service afterwards.
 */
export function SheetsScreen({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: ExamTab) => void }) {
  const { state, toast } = useApp();
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);

  const [selected, setSelected] = useState<string[]>(() => learners.map((learner) => learner.lrn));
  const [writtenMode, setWrittenMode] = useState<WrittenMode>('combined');
  const [previewIndex, setPreviewIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelected(learners.map((learner) => learner.lrn));
    setPreviewIndex(0);
    setWrittenMode('combined');
    // Only reset when a different exam is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.id]);

  const chosen = useMemo(
    () => learners.filter((learner) => selected.includes(learner.lrn)),
    [learners, selected]
  );
  const previewLearner = chosen[Math.min(previewIndex, Math.max(0, chosen.length - 1))] ?? null;

  const hasScanned = exam.itemCount > 0;
  const written = useMemo(() => manualItems(exam), [exam]);
  const hasWritten = written.length > 0;
  const twoUp = exam.sheetsPerPage === 2;
  // A written half only fits by taking the second learner's place on a
  // two-up folio page; a one-up page has no spare half.
  const canCombine = hasScanned && hasWritten && twoUp;
  const mode: WrittenMode = !hasScanned
    ? writtenMode === 'off'
      ? 'off'
      : 'separate'
    : hasWritten && !canCombine && writtenMode === 'combined'
      ? 'separate'
      : writtenMode;
  const combined = hasScanned && hasWritten && canCombine && writtenMode === 'combined';
  const writtenOn = hasWritten && mode !== 'off';

  const writtenPlan = useMemo(
    () =>
      hasWritten
        ? planWrittenSheets(
            exam,
            exam.paper,
            combined ? writtenPanelGeometry(exam.paper, exam.orientation) : undefined
          )
        : null,
    [exam, hasWritten, combined]
  );
  const writtenPages = writtenPlan?.pages.length ?? 0;
  const writtenPage = combined ? writtenPlan?.pages[0] ?? null : null;
  const paperName = PAPER_SIZES[exam.paper].short;
  const stem = safeFilename(`${exam.subject || 'Exam'}_${exam.section || 'Class'}_${exam.code}`);

  const pageCount = combined
    ? chosen.length * Math.max(1, writtenPages)
    : Math.ceil(chosen.length / Math.max(1, exam.sheetsPerPage)) +
      (mode === 'separate' && offered('separate') ? chosen.length * Math.max(1, writtenPages) : 0);

  function offered(value: WrittenMode): boolean {
    return hasWritten && mode === value && !combined;
  }

  const bubbleOptions = { includeQr: true, includeName: true, schoolName: state.settings.schoolName };
  const writtenOptions = { schoolName: state.settings.schoolName, includeName: true };

  const toggle = (lrn: string) => {
    setSelected((prev) => (prev.includes(lrn) ? prev.filter((item) => item !== lrn) : [...prev, lrn]));
  };

  const finish = (saved: boolean, message: string) => {
    if (saved) toast(message, 'success');
  };

  const saveRun = async () => {
    if (chosen.length === 0) {
      toast('Select at least one learner.', 'danger');
      return;
    }
    if (!hasScanned && !writtenOn) {
      toast('This test has nothing to save. Add a scanned or written part in Setup.', 'danger');
      return;
    }
    setBusy(true);
    try {
      if (combined) {
        const bytes = await buildCombinedSheetsPdf(exam, chosen, bubbleOptions);
        finish(
          await savePdf(bytes, `${stem}_sheets_with_written.pdf`),
          'Folio pages saved. Written answers and bubbles share one page per learner.'
        );
        return;
      }
      if (hasScanned) {
        const bytes = await buildSheetsPdf(exam, chosen, bubbleOptions);
        finish(
          await savePdf(bytes, `${stem}_sheets.pdf`),
          `${chosen.length} answer sheet${chosen.length === 1 ? '' : 's'} saved as PDF.`
        );
        return;
      }
      const bytes = await buildWrittenSheetsPdf(exam, chosen, writtenOptions);
      finish(
        await savePdf(bytes, `${stem}_written_pages.pdf`),
        `${chosen.length} written answer page${chosen.length === 1 ? '' : 's'} saved as PDF.`
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The PDF could not be generated.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const saveWrittenOnly = async () => {
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      const bytes = await buildWrittenSheetsPdf(exam, chosen, writtenOptions);
      finish(
        await savePdf(bytes, `${stem}_written_pages.pdf`),
        `${chosen.length} written answer page${chosen.length === 1 ? '' : 's'} saved as PDF.`
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The written pages could not be generated.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const saveOne = async () => {
    if (!previewLearner) return;
    setBusy(true);
    try {
      const suffix = safeFilename(`${exam.code}_${previewLearner.lrn}`);
      if (combined) {
        const bytes = await buildCombinedSheetPdf(exam, previewLearner, bubbleOptions);
        finish(await savePdf(bytes, `${suffix}_sheet_with_written.pdf`), 'One folio page saved as PDF.');
        return;
      }
      if (!hasScanned) {
        const bytes = await buildWrittenSheetPdf(exam, previewLearner, writtenOptions);
        finish(await savePdf(bytes, `${suffix}_written.pdf`), 'One written answer page saved as PDF.');
        return;
      }
      const bytes = await buildSingleSheetPdf(exam, previewLearner, bubbleOptions);
      finish(await savePdf(bytes, `${suffix}_sheet.pdf`), 'One answer sheet saved as PDF.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The sheet could not be generated.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const primaryLabel = combined
    ? `Save ${chosen.length || ''} folio page${chosen.length === 1 ? '' : 's'} (PDF)`
    : hasScanned
      ? `Save ${chosen.length || ''} sheet${chosen.length === 1 ? '' : 's'} (PDF)`
      : writtenOn
        ? `Save ${chosen.length || ''} written page${chosen.length === 1 ? '' : 's'} (PDF)`
        : 'Written pages are left out';

  return (
    <>
      <ScreenHead
        eyebrow={`${exam.code} · Sheets`}
        title="Answer sheets"
        subtitle={
          chosen.length
            ? `${chosen.length} of ${learners.length} learners · about ${pageCount} PDF page${pageCount === 1 ? '' : 's'} · ${exam.orientation} ${paperName}`
            : 'Choose who needs a sheet, then save the PDF.'
        }
        actions={
          <Badge tone={chosen.length ? 'accent' : 'neutral'}>
            {chosen.length} {hasScanned ? 'sheet' : 'page'}
            {chosen.length === 1 ? '' : 's'}
          </Badge>
        }
      />

      <div className="m-stack">
        {learners.length === 0 ? (
          <section className="m-card">
            <div className="m-card__body">
              <EmptyBlock
                icon={<Users size={24} />}
                title="No roster yet"
                message="Add the learners first; every sheet prints that learner's name, LRN, and identity QR."
                action={
                  <button className="btn btn--primary" onClick={() => onNavigate('roster')}>
                    <Users size={16} /> Add the roster
                  </button>
                }
              />
            </div>
          </section>
        ) : (
          <>
            <section className="m-card">
              <div className="m-card__head">
                <div>
                  <h2>Who gets a sheet</h2>
                  <p>Sheets are keyed to each learner's LRN, so reprints match the returned papers.</p>
                </div>
                <div className="m-row">
                  <button className="btn btn--ghost btn--sm" onClick={() => setSelected(learners.map((learner) => learner.lrn))}>
                    All
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setSelected([])}>
                    None
                  </button>
                </div>
              </div>
              <div className="m-card__body" style={{ paddingTop: 4 }}>
                {learners.map((learner) => {
                  const on = selected.includes(learner.lrn);
                  return (
                    <button
                      className="m-person"
                      key={learner.id}
                      onClick={() => toggle(learner.lrn)}
                      aria-pressed={on}
                      style={{ width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', textAlign: 'left', font: 'inherit' }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 22,
                          height: 22,
                          flex: 'none',
                          display: 'grid',
                          placeItems: 'center',
                          borderRadius: 7,
                          border: `1px solid ${on ? 'var(--accent)' : 'var(--line-strong)'}`,
                          background: on ? 'var(--accent)' : 'var(--surface)',
                          color: '#fff',
                        }}
                      >
                        {on ? <Check size={14} /> : null}
                      </span>
                      <span className="m-person__main">
                        <span className="m-person__name">{learner.name}</span>
                        <span className="m-person__meta">{learner.lrn}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {hasWritten && (
              <section className="m-card">
                <div className="m-card__head">
                  <div>
                    <h2>Written answers</h2>
                    <p>
                      {written.length} written item{written.length === 1 ? '' : 's'} in{' '}
                      {writtenPlan?.partCount ?? 0} part{(writtenPlan?.partCount ?? 0) === 1 ? '' : 's'}.
                    </p>
                  </div>
                  <PenLine size={19} className="muted" />
                </div>
                <div className="m-card__body">
                  <div className="m-row">
                    {canCombine && (
                      <button
                        className={`btn btn--sm ${mode === 'combined' ? 'btn--primary' : 'btn--ghost'}`}
                        onClick={() => setWrittenMode('combined')}
                      >
                        Same page
                      </button>
                    )}
                    <button
                      className={`btn btn--sm ${mode === 'separate' ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => setWrittenMode('separate')}
                    >
                      Own PDF
                    </button>
                    <button
                      className={`btn btn--sm ${mode === 'off' ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => setWrittenMode('off')}
                    >
                      Leave out
                    </button>
                  </div>
                  <div className="m-note" style={{ marginTop: 10 }}>
                    {mode === 'combined'
                      ? 'One folio page per learner: written answers on one half, the bubble sheet on the other. No cutting needed.'
                      : mode === 'separate'
                        ? `${writtenPages} written page${writtenPages === 1 ? '' : 's'} per learner in a separate PDF, so the bubble stack stays clean for scanning.`
                        : 'No written answer space is saved in this run.'}
                  </div>
                  {mode === 'separate' && (
                    <button className="btn btn--soft btn--block" style={{ marginTop: 10 }} onClick={() => void saveWrittenOnly()} disabled={busy || chosen.length === 0}>
                      <FileDown size={15} /> Save written pages only (PDF)
                    </button>
                  )}
                </div>
              </section>
            )}

            {hasScanned && previewLearner && (
              <section className="m-card">
                <div className="m-card__head">
                  <div>
                    <h2>Preview</h2>
                    <p>{previewLearner.name} · {previewLearner.lrn}</p>
                  </div>
                  <div className="m-row">
                    <button
                      className="m-iconbtn"
                      onClick={() => setPreviewIndex((value) => Math.max(0, value - 1))}
                      disabled={previewIndex === 0}
                      aria-label="Previous learner"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      className="m-iconbtn"
                      onClick={() => setPreviewIndex((value) => Math.min(chosen.length - 1, value + 1))}
                      disabled={previewIndex >= chosen.length - 1}
                      aria-label="Next learner"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
                <div className="m-card__body">
                  <SheetPreview
                    exam={exam}
                    learner={previewLearner}
                    schoolName={state.settings.schoolName}
                    includeQr
                    includeName
                    writtenPage={writtenPage}
                    writtenTotalPages={Math.max(1, writtenPages)}
                  />
                </div>
              </section>
            )}

            <section className="m-card">
              <div className="m-card__head">
                <div>
                  <h2>Save as PDF</h2>
                  <p>{isDesktop ? 'Android asks where to put the file — Downloads, Drive, or a folder you choose.' : 'Browser preview: the PDF downloads to this device.'}</p>
                </div>
                <Printer size={19} className="muted" />
              </div>
              <div className="m-card__body">
                <button
                  className="btn btn--primary btn--block"
                  onClick={() => void saveRun()}
                  disabled={busy || chosen.length === 0 || (!hasScanned && !writtenOn)}
                >
                  {busy ? <Spinner size={15} /> : <FileDown size={16} />}
                  {busy ? 'Building the PDF…' : primaryLabel}
                </button>
                {previewLearner && (
                  <button
                    className="btn btn--soft btn--block"
                    style={{ marginTop: 8 }}
                    onClick={() => void saveOne()}
                    disabled={busy}
                  >
                    <FileText size={15} /> Save one for {previewLearner.name.split(',')[0]}
                  </button>
                )}
                <div className="m-note" style={{ marginTop: 10 }}>
                  Print the saved PDF at <strong>100% / actual size</strong>. “Fit to page” shrinks the
                  corner marks and makes scanning unreliable. Plain white paper, no folds over the
                  corner squares.
                </div>
                {hasScanned && !twoUp && hasWritten && (
                  <div className="m-note m-note--warn" style={{ marginTop: 8 }}>
                    Written answers cannot share a page while the sheet is set to one per page. The
                    plan above saves them as their own PDF.
                  </div>
                )}
                {results.length > 0 && (
                  <div className="m-row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                    <span className="m-tiny">
                      {results.length} sheet{results.length === 1 ? '' : 's'} already checked. Reprints keep the same QR.
                    </span>
                    <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('scan')}>
                      <ScanLine size={14} /> Scan
                    </button>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}
