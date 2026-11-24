import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Info,
  PenLine,
  Printer,
  QrCode,
  Scissors,
  Users,
} from 'lucide-react';
import type { Exam } from '../types';
import { useApp } from '../store/AppStore';
import { PAPER_SIZES } from '../omr/layout';
import {
  buildCombinedSheetPdf,
  buildCombinedSheetsPdf,
  buildSingleSheetPdf,
  downloadSheetsPdf,
} from '../omr/sheetPdf';
import { buildWrittenSheetPdf, buildWrittenSheetsPdf } from '../omr/writtenPdf';
import { downloadBlob, safeFilename } from '../lib/download';
import { manualItems } from '../lib/sections';
import { planWrittenSheets, writtenPanelGeometry } from '../lib/written';
import { SheetPreview } from './SheetPreview';
import { Badge, EmptyState, Segmented, Spinner, Toggle } from './ui';
import type { WorkspaceTab } from './ExamWorkspace';

type WrittenMode = 'combined' | 'separate' | 'off';

export function SheetsTab({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: WorkspaceTab) => void }) {
  const { state, toast } = useApp();
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);
  const [selected, setSelected] = useState<string[]>(() => learners.map((learner) => learner.lrn));
  const [includeQr, setIncludeQr] = useState(true);
  const [includeName, setIncludeName] = useState(true);
  const [busy, setBusy] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [writtenMode, setWrittenMode] = useState<WrittenMode>('combined');

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
  const keyFilled = exam.answerKey.filter(Boolean).length;
  const complete = keyFilled === exam.itemCount;
  const twoUp = exam.sheetsPerPage === 2;
  const pageCount = Math.ceil(chosen.length / exam.sheetsPerPage);
  const paperName = PAPER_SIZES[exam.paper].short;

  const written = useMemo(() => manualItems(exam), [exam]);
  const hasWritten = written.length > 0;
  const hasScanned = exam.itemCount > 0;
  // Sharing one folio page only works with two sheets per page: the written
  // panel takes the half the second learner would have used. With one sheet
  // per page the bubble sheet already fills the paper.
  const canCombine = hasScanned && hasWritten && twoUp;
  const mode: WrittenMode = !hasScanned
    ? writtenMode === 'off'
      ? 'off'
      : 'separate'
    : hasWritten && !canCombine && writtenMode === 'combined'
      ? 'separate'
      : writtenMode;
  const combined = hasScanned && hasWritten && canCombine && writtenMode === 'combined';

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

  const writtenOn = hasWritten && mode !== 'off';
  const writtenPages = writtenPlan?.pages.length ?? 0;
  /** Full portrait pages that follow the folio page for one learner. */
  const continuationPages = combined ? Math.max(0, writtenPages - 1) : 0;
  const stem = safeFilename(`${exam.subject || 'Exam'}_${exam.section || 'Class'}_${exam.code}`);
  const writtenOptions = { schoolName: state.settings.schoolName, includeName };
  const combinedPages = combined ? chosen.length * Math.max(1, writtenPages) : 0;
  const runPages = combined ? combinedPages : pageCount;

  const toggle = (lrn: string) => {
    setSelected((prev) => (prev.includes(lrn) ? prev.filter((item) => item !== lrn) : [...prev, lrn]));
  };

  const downloadWritten = async () => {
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      const bytes = await buildWrittenSheetsPdf(exam, chosen, writtenOptions);
      downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${stem}_written_pages.pdf`);
      const sheets = chosen.length * Math.max(1, writtenPages);
      toast(
        `${chosen.length} learner${chosen.length === 1 ? '' : 's'} × ${Math.max(1, writtenPages)} page${writtenPages === 1 ? '' : 's'} downloaded (${sheets} sheet${sheets === 1 ? '' : 's'} in total).`,
        'success'
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The written answer pages could not be generated.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (chosen.length === 0) {
      toast('Select at least one learner.', 'danger');
      return;
    }
    setBusy(true);
    try {
      const options = { includeQr, includeName, schoolName: state.settings.schoolName };

      if (combined) {
        const bytes = await buildCombinedSheetsPdf(exam, chosen, options);
        downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${stem}_sheets_with_written.pdf`);
        toast(
          `${chosen.length} folio page${chosen.length === 1 ? '' : 's'} downloaded — written answers on one half, bubble sheet on the other.${
            continuationPages > 0
              ? ` ${continuationPages} continuation page${continuationPages === 1 ? '' : 's'} per learner follow${continuationPages === 1 ? 's' : ''} on full portrait sheets.`
              : ''
          }`,
          'success'
        );
        return;
      }

      if (hasScanned) {
        await downloadSheetsPdf(exam, chosen, options, `${stem}_sheets.pdf`);
        toast(
          (twoUp
            ? `${chosen.length} answer sheets downloaded on ${pageCount} ${paperName} page${pageCount === 1 ? '' : 's'}. Cut along the dashed line.`
            : `${chosen.length} answer sheet${chosen.length === 1 ? '' : 's'} downloaded.`) +
            (mode === 'separate' && writtenOn ? ' Written answers download separately below.' : ''),
          'success'
        );
        return;
      }

      if (hasWritten && writtenOn) {
        const pages = await buildWrittenSheetsPdf(exam, chosen, writtenOptions);
        downloadBlob(new Blob([pages as BlobPart], { type: 'application/pdf' }), `${stem}_written_pages.pdf`);
        toast(`${chosen.length} written answer page${chosen.length === 1 ? '' : 's'} downloaded.`, 'success');
        return;
      }

      toast('This test has nothing printable. Add a scanned or written part in Setup.', 'danger');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The sheet PDF could not be generated.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const downloadOne = async () => {
    if (!previewLearner) return;
    setBusy(true);
    try {
      const options = { includeQr, includeName, schoolName: state.settings.schoolName };

      if (combined) {
        const bytes = await buildCombinedSheetPdf(exam, previewLearner, options);
        downloadBlob(
          new Blob([bytes as BlobPart], { type: 'application/pdf' }),
          safeFilename(`${exam.code}_${previewLearner.lrn}_sheet_with_written.pdf`)
        );
        toast('Folio page with written answers downloaded.', 'success');
        return;
      }

      if (!hasScanned) {
        const bytes = await buildWrittenSheetPdf(exam, previewLearner, writtenOptions);
        downloadBlob(
          new Blob([bytes as BlobPart], { type: 'application/pdf' }),
          safeFilename(`${exam.code}_${previewLearner.lrn}_written.pdf`)
        );
        toast('Written answer page downloaded.', 'success');
        return;
      }

      const bubble = await buildSingleSheetPdf(exam, previewLearner, options);
      downloadBlob(
        new Blob([bubble as BlobPart], { type: 'application/pdf' }),
        safeFilename(`${exam.code}_${previewLearner.lrn}_sheet.pdf`)
      );
      toast('One sheet downloaded.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The sheet could not be generated.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const longSummary = (() => {
    if (!writtenPlan || mode === 'off') return '';
    if (writtenPlan.longCount === 0) return 'Every answer gets one ruled line.';
    const lines =
      writtenPlan.minLongLines === writtenPlan.maxLongLines
        ? `${writtenPlan.minLongLines} ruled lines`
        : `${writtenPlan.minLongLines}–${writtenPlan.maxLongLines} ruled lines`;
    return `${writtenPlan.shortCount} short answer${writtenPlan.shortCount === 1 ? '' : 's'} get one line each; ${writtenPlan.longCount} long answer${writtenPlan.longCount === 1 ? '' : 's'} get ${lines}.`;
  })();

  const primaryLabel = hasScanned
    ? combined
      ? `Download ${chosen.length || ''} folio page${chosen.length === 1 ? '' : 's'} (PDF)`
      : `Download ${chosen.length || ''} sheet${chosen.length === 1 ? '' : 's'} (PDF)`
    : hasWritten && writtenOn
      ? `Download ${chosen.length || ''} written page${chosen.length === 1 ? '' : 's'} (PDF)`
      : 'Add a written part to print';

  return (
    <div className="sheet-layout">
      <div className="stack">
        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>{hasScanned ? 'Print run' : 'Written answer run'}</h3>
              <p>
                {!hasScanned
                  ? 'This test has no scanned part. Choose the learners who need a written answer page.'
                  : combined
                    ? 'One folio page per learner: written answers on one half, the bubble sheet on the other.'
                    : twoUp
                      ? `Two sheets per ${exam.orientation} ${paperName} page, with name, LRN, and a unique QR already printed.`
                      : `One sheet per ${exam.orientation} ${paperName} page, with name, LRN, and a unique QR already printed.`}
              </p>
            </div>
            <Badge tone={chosen.length ? 'accent' : 'neutral'}>
              {chosen.length} {hasScanned ? 'sheet' : 'page'}
              {chosen.length === 1 ? '' : 's'}
              {hasScanned && chosen.length > 0 && (combined || twoUp) ? ` · ${runPages} pages` : ''}
            </Badge>
          </div>
          <div className="card-body sheet-options">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 9 }}>
              <span className="field__label">Learners</span>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn btn--ghost btn--sm" onClick={() => setSelected(learners.map((learner) => learner.lrn))}>
                  All
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => setSelected([])}>
                  None
                </button>
              </div>
            </div>
            {learners.length === 0 ? (
              <EmptyState
                icon={<Users size={24} />}
                title="No roster yet"
                message={hasScanned ? 'Add learners before generating sheets.' : 'Add learners before generating written answer pages.'}
                action={<button className="btn btn--soft btn--sm" onClick={() => onNavigate('roster')}>Open roster</button>}
              />
            ) : (
              <div className="learner-picker">
                {learners.map((learner) => (
                  <label className="learner-pick" key={learner.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(learner.lrn)}
                      onChange={() => toggle(learner.lrn)}
                    />
                    <span className="learner-pick__name">{learner.name}</span>
                    <span className="learner-pick__lrn">{learner.lrn}</span>
                  </label>
                ))}
              </div>
            )}

            {hasScanned && (
              <div style={{ marginTop: 14 }}>
                <Toggle
                  checked={includeQr}
                  onChange={setIncludeQr}
                  label="Print identity QR"
                  description="Required for automatic learner recognition while scanning."
                />
                <Toggle
                  checked={includeName}
                  onChange={setIncludeName}
                  label="Print learner name"
                  description="Turn off to write names by hand, or to reuse one sheet design."
                />
              </div>
            )}

            <div className="sheet-note-list">
              {combined && (
                <div className="sheet-note">
                  <PenLine size={14} />
                  <span>
                    <strong>The written half replaces the second learner.</strong> Keep both halves together after printing —
                    there is no cut line, because both belong to the same learner.
                  </span>
                </div>
              )}
              {twoUp && hasScanned && !combined && (
                <div className="sheet-note">
                  <Scissors size={14} />
                  <span>
                    <strong>Two sheets share each page.</strong> Cut along the dashed center line for handing out, or scan the
                    whole page — Tsek splits both sheets automatically.
                  </span>
                </div>
              )}
              {hasScanned && (
                <div className="sheet-note">
                  <Printer size={14} />
                  <span>Print at <strong>100% / actual size</strong>. “Fit to page” shrinks the corner marks and makes scanning unreliable.</span>
                </div>
              )}
              {hasScanned && (
                <div className="sheet-note">
                  <QrCode size={14} />
                  <span>Use plain white paper. Avoid folding, stapling, or writing over the four black corner squares.</span>
                </div>
              )}
              {hasScanned && !complete && (
                <div className="sheet-note" style={{ color: 'var(--amber)' }}>
                  <Info size={14} style={{ color: 'var(--amber)' }} />
                  <span>The answer key has {exam.itemCount - keyFilled} blank item{exam.itemCount - keyFilled === 1 ? '' : 's'}. Sheets can still be printed.</span>
                </div>
              )}
            </div>

            <div className="field" style={{ marginTop: 15 }}>
              <button
                className="btn btn--primary btn--block"
                onClick={() => void generate()}
                disabled={busy || chosen.length === 0 || (!hasScanned && !writtenOn)}
              >
                {busy ? <Spinner size={15} /> : <Download size={16} />}
                {busy ? 'Building PDF…' : primaryLabel}
              </button>
            </div>
            {results.length > 0 && (
              <p className="tiny faint" style={{ marginTop: 8, textAlign: 'center' }}>
                {results.length} sheet{results.length === 1 ? '' : 's'} already checked. Reprints use the same identity QR.
              </p>
            )}
          </div>
        </section>

        {hasWritten && writtenPlan && (
          <section className="card">
            <div className="card-head">
              <div className="card-head__title">
                <h3>Written answers</h3>
                <p>
                  {combined
                    ? `${written.length} item${written.length === 1 ? '' : 's'} in ${writtenPlan.partCount} written part${writtenPlan.partCount === 1 ? '' : 's'} share the folio page, beside the bubble sheet.`
                    : mode === 'off'
                      ? `${written.length} written item${written.length === 1 ? '' : 's'} in ${writtenPlan.partCount} part${writtenPlan.partCount === 1 ? '' : 's'} are left out of the print run.`
                      : `${written.length} item${written.length === 1 ? '' : 's'} in ${writtenPlan.partCount} written part${writtenPlan.partCount === 1 ? '' : 's'} print on a full portrait page, one per learner.`}
                </p>
              </div>
              <Badge tone="neutral"><PenLine size={12} /> {written.length} written</Badge>
            </div>
            <div className="card-body">
              <Segmented
                value={mode}
                options={[
                  ...(canCombine ? [{ value: 'combined' as const, label: 'Same page' }] : []),
                  { value: 'separate' as const, label: 'Own PDF' },
                  { value: 'off' as const, label: 'Don’t print' },
                ]}
                onChange={(value) => setWrittenMode(value)}
              />
              <p className="tiny faint" style={{ marginTop: 8 }}>
                {mode === 'combined'
                  ? 'Every learner gets one folio page: written answers on one half, the bubble sheet on the other. No cutting needed.'
                  : mode === 'separate'
                    ? 'The written pages download as their own PDF, so the bubble stack stays clean for scanning.'
                    : 'No written answer space is included in the print run.'}
              </p>

              {mode !== 'off' && (
                <div className="sheet-note-list">
                  <div className="sheet-note">
                    <PenLine size={14} />
                    <span>{longSummary}</span>
                  </div>
                  {combined && continuationPages > 0 && (
                    <div className="sheet-note">
                      <FileText size={14} />
                      <span>
                        {continuationPages} continuation page{continuationPages === 1 ? '' : 's'} per learner, right after the
                        folio page, for answers that overflow the half panel.
                      </span>
                    </div>
                  )}
                  {!combined && writtenPages > 1 && (
                    <div className="sheet-note">
                      <FileText size={14} />
                      <span>
                        {writtenPages} pages per learner. Every page repeats the learner name, LRN, and page number.
                      </span>
                    </div>
                  )}
                  {combined && (
                    <div className="sheet-note">
                      <Printer size={14} />
                      <span>
                        The half panel is smaller than a full page, so long answers get fewer ruled lines. The bubble half keeps
                        its two-up size and still scans as one folio page.
                      </span>
                    </div>
                  )}
                  {hasScanned && hasWritten && !canCombine && (
                    <div className="sheet-note" style={{ color: 'var(--amber)' }}>
                      <Info size={14} style={{ color: 'var(--amber)' }} />
                      <span>
                        <strong>Same-page printing needs two sheets per page.</strong> On one sheet per page the bubble sheet
                        fills the paper, so written answers download on their own pages. Change sheets per page in Setup to share
                        the folio.
                      </span>
                    </div>
                  )}
                  {writtenPlan.longCount > 0 && writtenPlan.minLongLines < 4 && (
                    <div className="sheet-note" style={{ color: 'var(--amber)' }}>
                      <Info size={14} style={{ color: 'var(--amber)' }} />
                      <span>
                        <strong>Long answers are tight on {paperName}.</strong> Each gets {writtenPlan.minLongLines} ruled lines.
                        Use Legal paper, or trim the long part, for more room to write — the page still prints as is.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {hasScanned && writtenOn && !combined && (
                <div className="field" style={{ marginTop: 14 }}>
                  <button className="btn btn--soft btn--block" onClick={() => void downloadWritten()} disabled={busy || chosen.length === 0}>
                    {busy ? <Spinner size={15} /> : <Download size={15} />}
                    Download written pages (PDF)
                  </button>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {hasScanned ? (
        <div className="sheet-stage">
          <div className="sheet-stage__bar">
            <div className="row" style={{ gap: 8 }}>
              <FileText size={16} className="muted" />
              <strong>{previewLearner ? previewLearner.name : 'Sheet preview'}</strong>
              <span className="pill pill--neutral">
                {paperName} · {exam.orientation} · {combined ? '1 per folio' : twoUp ? '2-up' : '1-up'}
              </span>
              <span className="pill pill--neutral">{exam.itemCount} scanned items</span>
              {combined && (
                <span className="pill pill--neutral">written on one half</span>
              )}
              {!combined && hasWritten && writtenOn && (
                <span className="pill pill--neutral">
                  {writtenPages * chosen.length} written page{writtenPages * chosen.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div className="row" style={{ gap: 4 }}>
              <button
                className="icon-btn icon-btn--sm"
                aria-label="Previous sheet"
                disabled={previewIndex <= 0}
                onClick={() => setPreviewIndex((index) => Math.max(0, index - 1))}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="tiny faint">
                {chosen.length ? `${Math.min(previewIndex, chosen.length - 1) + 1} / ${chosen.length}` : '0 / 0'}
              </span>
              <button
                className="icon-btn icon-btn--sm"
                aria-label="Next sheet"
                disabled={previewIndex >= chosen.length - 1}
                onClick={() => setPreviewIndex((index) => Math.min(chosen.length - 1, index + 1))}
              >
                <ChevronRight size={16} />
              </button>
              <button className="btn btn--soft btn--sm" onClick={() => void downloadOne()} disabled={!previewLearner || busy}>
                This sheet
              </button>
            </div>
          </div>
          <SheetPreview
            exam={exam}
            learner={previewLearner}
            schoolName={state.settings.schoolName}
            includeQr={includeQr}
            includeName={includeName}
            writtenPage={combined && writtenPlan ? writtenPlan.pages[0] : null}
            writtenTotalPages={Math.max(1, writtenPages)}
          />
          <div className="sheet-caption">
            {previewLearner
              ? `${previewLearner.name} · LRN ${previewLearner.lrn} · ${exam.code}`
              : 'Select a learner to preview their printed sheet.'}
            {combined
              ? continuationPages > 0
                ? ` · written half, then ${continuationPages} continuation page${continuationPages === 1 ? '' : 's'}`
                : ' · written half and bubble half on one folio page'
              : twoUp && chosen.length > 0
                ? ' · one of two sheets on this page'
                : ''}
          </div>
        </div>
      ) : (
        <div className="sheet-stage">
          <section className="card">
            <EmptyState
              icon={<PenLine size={24} />}
              title="No bubble sheet for this test"
              message={
                writtenOn && writtenPlan
                  ? `All ${writtenPlan.itemCount} items are written. The written answer page${writtenPages === 1 ? '' : 's'} print in portrait, one learner per page, with numbered ruled lines.`
                  : 'All items are written, and written answer printing is turned off. Choose a written answer PDF above to generate it.'
              }
              action={
                hasWritten && writtenOn ? (
                  <button className="btn btn--primary btn--sm" onClick={() => void downloadWritten()} disabled={busy || chosen.length === 0}>
                    <Download size={14} /> Download written pages
                  </button>
                ) : undefined
              }
            />
          </section>
        </div>
      )}
    </div>
  );
}
