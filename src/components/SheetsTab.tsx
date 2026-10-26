import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, Info, Printer, QrCode, Scissors, Users } from 'lucide-react';
import type { Exam } from '../types';
import { useApp } from '../store/AppStore';
import { PAPER_SIZES } from '../omr/layout';
import { buildSingleSheetPdf, downloadSheetsPdf } from '../omr/sheetPdf';
import { downloadBlob, safeFilename } from '../lib/download';
import { SheetPreview } from './SheetPreview';
import { Badge, EmptyState, Spinner, Toggle } from './ui';
import type { WorkspaceTab } from './ExamWorkspace';

export function SheetsTab({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: WorkspaceTab) => void }) {
  const { state, toast } = useApp();
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);
  const [selected, setSelected] = useState<string[]>(() => learners.map((learner) => learner.lrn));
  const [includeQr, setIncludeQr] = useState(true);
  const [includeName, setIncludeName] = useState(true);
  const [busy, setBusy] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  useEffect(() => {
    setSelected(learners.map((learner) => learner.lrn));
    setPreviewIndex(0);
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

  const toggle = (lrn: string) => {
    setSelected((prev) => (prev.includes(lrn) ? prev.filter((item) => item !== lrn) : [...prev, lrn]));
  };

  const generate = async () => {
    if (chosen.length === 0) {
      toast('Select at least one learner.', 'danger');
      return;
    }
    setBusy(true);
    try {
      const filename = safeFilename(`${exam.subject || 'Exam'}_${exam.section || 'Class'}_${exam.code}_sheets.pdf`);
      await downloadSheetsPdf(exam, chosen, { includeQr, includeName, schoolName: state.settings.schoolName }, filename);
      toast(
        twoUp
          ? `${chosen.length} answer sheets downloaded on ${pageCount} ${paperName} page${pageCount === 1 ? '' : 's'}. Cut along the dashed line.`
          : `${chosen.length} answer sheet${chosen.length === 1 ? '' : 's'} downloaded.`,
        'success'
      );
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
      const bytes = await buildSingleSheetPdf(exam, previewLearner, {
        includeQr,
        includeName,
        schoolName: state.settings.schoolName,
      });
      downloadBlob(
        new Blob([bytes as BlobPart], { type: 'application/pdf' }),
        safeFilename(`${exam.code}_${previewLearner.lrn}_sheet.pdf`)
      );
      toast('One sheet downloaded.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The sheet could not be generated.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-layout">
      <div className="stack">
        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Print run</h3>
              <p>
                {twoUp
                  ? `Two sheets per ${exam.orientation} ${paperName} page, with name, LRN, and a unique QR already printed.`
                  : `One sheet per ${exam.orientation} ${paperName} page, with name, LRN, and a unique QR already printed.`}
              </p>
            </div>
            <Badge tone={chosen.length ? 'accent' : 'neutral'}>
              {chosen.length} sheet{chosen.length === 1 ? '' : 's'}
              {twoUp && chosen.length > 0 ? ` · ${pageCount} pages` : ''}
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
                message="Add learners before generating sheets."
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

            <div className="sheet-note-list">
              {twoUp && (
                <div className="sheet-note">
                  <Scissors size={14} />
                  <span>
                    <strong>Two sheets share each page.</strong> Cut along the dashed center line for handing out, or scan the
                    whole page — Tsek splits both sheets automatically.
                  </span>
                </div>
              )}
              <div className="sheet-note">
                <Printer size={14} />
                <span>Print at <strong>100% / actual size</strong>. “Fit to page” shrinks the corner marks and makes scanning unreliable.</span>
              </div>
              <div className="sheet-note">
                <QrCode size={14} />
                <span>Use plain white paper. Avoid folding, stapling, or writing over the four black corner squares.</span>
              </div>
              {!complete && (
                <div className="sheet-note" style={{ color: 'var(--amber)' }}>
                  <Info size={14} style={{ color: 'var(--amber)' }} />
                  <span>The answer key has {exam.itemCount - keyFilled} blank item{exam.itemCount - keyFilled === 1 ? '' : 's'}. Sheets can still be printed.</span>
                </div>
              )}
            </div>

            <div className="field" style={{ marginTop: 15 }}>
              <button className="btn btn--primary btn--block" onClick={() => void generate()} disabled={busy || chosen.length === 0}>
                {busy ? <Spinner size={15} /> : <Download size={16} />}
                {busy ? 'Building PDF…' : `Download ${chosen.length || ''} sheet${chosen.length === 1 ? '' : 's'} (PDF)`}
              </button>
            </div>
            {results.length > 0 && (
              <p className="tiny faint" style={{ marginTop: 8, textAlign: 'center' }}>
                {results.length} sheet{results.length === 1 ? '' : 's'} already checked. Reprints use the same identity QR.
              </p>
            )}
          </div>
        </section>
      </div>

      <div className="sheet-stage">
        <div className="sheet-stage__bar">
          <div className="row" style={{ gap: 8 }}>
            <FileText size={16} className="muted" />
            <strong>{previewLearner ? previewLearner.name : 'Sheet preview'}</strong>
            <span className="pill pill--neutral">
              {paperName} · {exam.orientation} · {twoUp ? '2-up' : '1-up'}
            </span>
            <span className="pill pill--neutral">{exam.itemCount} scanned items</span>
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
            <span className="tiny faint">{chosen.length ? `${previewIndex + 1} / ${chosen.length}` : '0 / 0'}</span>
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
        />
        <div className="sheet-caption">
          {previewLearner
            ? `${previewLearner.name} · LRN ${previewLearner.lrn} · ${exam.code}`
            : 'Select a learner to preview their printed sheet.'}
          {twoUp && chosen.length > 0 ? ' · one of two sheets on this page' : ''}
        </div>
      </div>
    </div>
  );
}
