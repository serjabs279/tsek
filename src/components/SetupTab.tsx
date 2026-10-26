import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  ListChecks,
  PenLine,
  Plus,
  Printer,
  ScanLine,
  Trash2,
  Users,
} from 'lucide-react';
import type { Exam, ExamCategory, ExamSection, PaperOrientation, PaperSize, SectionType, SheetsPerPage } from '../types';
import { CATEGORY_LABELS, GRADE_LEVEL_OPTIONS, QUARTER_OPTIONS, SECTION_LABELS } from '../types';
import { COMFORTABLE_BUBBLE_MM, PAPER_SIZES, buildExamLayout, sheetCapacity } from '../omr/layout';
import {
  SECTION_TYPES,
  answerShape,
  buildExamWithSections,
  cleanSections,
  createSection,
  examSections,
  isPartScored,
  isScannable,
  materializeItems,
  totalItemCount,
  totalPoints,
} from '../lib/sections';
import { useApp } from '../store/AppStore';
import { Badge, ConfirmDialog, Field, ProgressBar, Segmented } from './ui';
import type { WorkspaceTab } from './ExamWorkspace';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function roman(index: number): string {
  return ROMAN[index] ?? String(index + 1);
}

function points(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function sectionShape(sections: ExamSection[]): string {
  return JSON.stringify(
    cleanSections(sections).map((section) => [
      section.id,
      section.type,
      section.itemCount,
      section.pointsPerItem,
      section.choices ?? null,
      section.title ?? '',
      section.scoreMode ?? '',
    ])
  );
}

const TYPE_ORDER: SectionType[] = SECTION_TYPES;

export function SetupTab({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: WorkspaceTab) => void }) {
  const { state, updateExam, applySections, deleteExam, duplicateExam, toast } = useApp();
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);
  const keyFilled = exam.answerKey.filter(Boolean).length;

  const [sections, setSections] = useState<ExamSection[]>(() => examSections(exam).map((section) => ({ ...section })));
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setSections(examSections(exam).map((section) => ({ ...section })));
    setConfirmRebuild(false);
  }, [exam.id]);

  const draftExam = useMemo(() => buildExamWithSections(exam, sections), [exam, sections]);
  const items = useMemo(() => materializeItems(draftExam), [draftExam]);
  const scannableItems = items.filter((item) => item.scannable);
  const writtenItems = items.filter((item) => !item.scannable);
  const itemCount = totalItemCount(draftExam);
  const pointTotal = totalPoints(draftExam);
  const scannablePointTotal = scannableItems.reduce((sum, item) => sum + item.points, 0);
  const writtenPointTotal = Math.round((pointTotal - scannablePointTotal) * 100) / 100;
  const pooledParts = sections.filter(isPartScored).length;
  const shapeChanged = answerShape(examSections(exam)) !== answerShape(sections);
  const dirty = sectionShape(sections) !== sectionShape(examSections(exam));

  const choiceCap = scannableItems.reduce((widest, item) => Math.max(widest, item.choices.length), 0) || 4;
  const bubbleMix = (() => {
    const counts = new Map<string, number>();
    for (const item of scannableItems) {
      const label = item.choices.length <= 2 ? 'T/F' : item.choices.length >= 5 ? 'A–E' : 'A–D';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    if (counts.size === 0) return 'no';
    if (counts.size === 1) return [...counts.keys()][0];
    return [...counts.entries()].map(([label, count]) => `${label} ×${count}`).join(' + ');
  })();
  const capacity = useMemo(
    () => sheetCapacity(exam.paper, exam.orientation, exam.sheetsPerPage, choiceCap),
    [exam.paper, exam.orientation, exam.sheetsPerPage, choiceCap]
  );
  const bubble = useMemo(
    () => buildExamLayout(draftExam).grid.bubbleDiameter,
    [draftExam]
  );

  const patch = (value: Partial<Exam>) => updateExam(exam.id, value);

  const patchSection = (id: string, patchValue: Partial<ExamSection>) => {
    setSections((prev) => prev.map((section) => (section.id === id ? { ...section, ...patchValue } : section)));
  };

  const changeType = (section: ExamSection, type: SectionType) => {
    patchSection(section.id, {
      type,
      choices: type === 'MCQ' ? section.choices ?? 4 : undefined,
    });
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    setSections((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const addSection = (type: SectionType) => {
    setSections((prev) => [...prev, createSection(type)]);
  };

  const removeSection = (id: string) => {
    setSections((prev) => (prev.length <= 1 ? prev : prev.filter((section) => section.id !== id)));
  };

  const save = (force = false) => {
    if (shapeChanged && results.length > 0 && !force) {
      setConfirmRebuild(true);
      return;
    }
    const next = cleanSections(sections);
    const outcome = applySections(exam.id, next);
    setSections(next.map((section) => ({ ...section })));
    setConfirmRebuild(false);
    if (outcome.removed && results.length > 0) {
      toast(`Structure saved. ${results.length} old scan${results.length === 1 ? '' : 's'} cleared because the scanned part changed.`, 'danger');
    } else if (shapeChanged) {
      toast('Structure saved. Reprint the answer sheets before scanning.', 'success');
    } else {
      toast('Structure saved. Existing scores were recalculated.', 'success');
    }
  };

  const scannedCount = scannableItems.length;
  const overCapacity = scannedCount > capacity;
  const overHardLimit = scannedCount > 100;

  return (
    <div className="split-grid">
      <div className="stack">
        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Assessment details</h3>
              <p>These words are printed on the answer sheets and carried into every export.</p>
            </div>
            <span className="exam-card__code">{exam.code}</span>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="Exam title" wide>
                <input className="input" value={exam.title} onChange={(event) => patch({ title: event.target.value })} />
              </Field>
              <Field label="Subject">
                <input className="input" value={exam.subject} onChange={(event) => patch({ subject: event.target.value })} />
              </Field>
              <Field label="Subject UID">
                <input className="input input--mono" value={exam.subjectUID} onChange={(event) => patch({ subjectUID: event.target.value })} />
              </Field>
              <Field label="Category">
                <select
                  className="select"
                  value={exam.category}
                  onChange={(event) => patch({ category: event.target.value as ExamCategory })}
                >
                  {(Object.keys(CATEGORY_LABELS) as ExamCategory[]).map((key) => (
                    <option key={key} value={key}>{CATEGORY_LABELS[key].short} — {CATEGORY_LABELS[key].label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Assessment name">
                <input className="input" value={exam.assessmentName} onChange={(event) => patch({ assessmentName: event.target.value })} />
              </Field>
              <Field label="Quarter">
                <select className="select" value={exam.quarterKey} onChange={(event) => patch({ quarterKey: event.target.value })}>
                  {QUARTER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </Field>
              <Field label="Grade level">
                <select className="select" value={exam.gradeLevel} onChange={(event) => patch({ gradeLevel: event.target.value })}>
                  {GRADE_LEVEL_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </Field>
              <Field label="Section">
                <input className="input" value={exam.section} onChange={(event) => patch({ section: event.target.value })} />
              </Field>
              <Field label="Teacher">
                <input className="input" value={exam.teacherName} onChange={(event) => patch({ teacherName: event.target.value })} />
              </Field>
              <Field label="School year">
                <input className="input" value={exam.schoolYear} onChange={(event) => patch({ schoolYear: event.target.value })} />
              </Field>
              <Field label="Track">
                <Segmented
                  value={exam.workspace}
                  options={[{ value: 'JHS', label: 'JHS' }, { value: 'SHS', label: 'SHS' }]}
                  onChange={(value) => patch({ workspace: value })}
                />
              </Field>
              <Field label="Passing percentage">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={100}
                  value={exam.passingPercent}
                  onChange={(event) => patch({ passingPercent: Math.max(1, Math.min(100, Number(event.target.value) || 75)) })}
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Test structure</h3>
              <p>Describe every part. Scanned parts print bubbles; written parts are scored by hand.</p>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Badge tone="neutral">{scannedCount} scanned</Badge>
              <Badge tone="neutral">{writtenItems.length} written</Badge>
              {pooledParts > 0 && <Badge tone="neutral">{pooledParts} pooled</Badge>}
              <Badge tone="accent">{points(pointTotal)} pts</Badge>
            </div>
          </div>
          <div className="card-body">
            <div className="section-list">
              {sections.map((section, index) => {
                const scannable = isScannable(section.type);
                const count = Math.max(1, Math.round(section.itemCount));
                const sectionItems = items.filter((item) => item.sectionId === section.id);
                const firstNumber = sectionItems[0]?.number ?? 0;
                const lastNumber = sectionItems[sectionItems.length - 1]?.number ?? 0;
                return (
                  <article className={`section-row ${scannable ? 'is-scanned' : 'is-written'}`} key={section.id}>
                    <div className="section-row__head">
                      <div className="section-row__title">
                        <span className="section-row__part">Part {roman(index)}</span>
                        <input
                          className="input section-row__name"
                          value={section.title ?? ''}
                          placeholder={SECTION_LABELS[section.type].label}
                          onChange={(event) => patchSection(section.id, { title: event.target.value })}
                        />
                      </div>
                      <div className="row" style={{ gap: 5 }}>
                        <Badge tone={scannable ? 'green' : 'neutral'}>
                          {scannable ? <ScanLine size={12} /> : <PenLine size={12} />}
                          {scannable ? 'scanned' : 'written'}
                        </Badge>
                        <div className="section-row__moves">
                          <button
                            className="icon-btn"
                            onClick={() => move(index, -1)}
                            disabled={index === 0}
                            aria-label={`Move part ${index + 1} up`}
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            className="icon-btn"
                            onClick={() => move(index, 1)}
                            disabled={index === sections.length - 1}
                            aria-label={`Move part ${index + 1} down`}
                          >
                            <ChevronDown size={14} />
                          </button>
                          <button
                            className="icon-btn icon-btn--danger"
                            onClick={() => removeSection(section.id)}
                            disabled={sections.length <= 1}
                            aria-label={`Remove part ${index + 1}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="section-row__controls">
                      <label className="mini-field">
                        <span>Type</span>
                        <select className="select" value={section.type} onChange={(event) => changeType(section, event.target.value as SectionType)}>
                          {TYPE_ORDER.map((type) => (
                            <option key={type} value={type}>{SECTION_LABELS[type].label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="mini-field mini-field--num">
                        <span>Items</span>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={100}
                          value={count}
                          onChange={(event) =>
                            patchSection(section.id, {
                              itemCount: Math.max(1, Math.min(100, Math.round(Number(event.target.value) || 1))),
                            })
                          }
                        />
                      </label>
                      <label className="mini-field mini-field--num">
                        <span>Points each</span>
                        <input
                          className="input"
                          type="number"
                          min={0.01}
                          step={0.25}
                          value={points(section.pointsPerItem)}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            patchSection(section.id, {
                              pointsPerItem: Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 1,
                            });
                          }}
                        />
                      </label>
                      {!scannable && (
                        <label className="mini-field mini-field--mode">
                          <span>Scoring</span>
                          <Segmented
                            size="sm"
                            value={section.scoreMode === 'part' ? 'part' : 'items'}
                            options={[
                              { value: 'items', label: 'Each item' },
                              { value: 'part', label: 'Whole part' },
                            ]}
                            onChange={(value) => patchSection(section.id, { scoreMode: value })}
                          />
                        </label>
                      )}
                      {section.type === 'MCQ' && (
                        <label className="mini-field">
                          <span>Choices</span>
                          <Segmented
                            value={String(section.choices ?? 4)}
                            options={[
                              { value: '4', label: 'A–D' },
                              { value: '5', label: 'A–E' },
                            ]}
                            onChange={(value) => patchSection(section.id, { choices: value === '5' ? 5 : 4 })}
                          />
                        </label>
                      )}
                      <div className="section-row__total">
                        <span>{count} × {points(section.pointsPerItem)}</span>
                        <strong>{points(count * section.pointsPerItem)} pts</strong>
                      </div>
                    </div>

                    <p className="section-row__hint">
                      {SECTION_LABELS[section.type].hint}
                      {!scannable &&
                        (isPartScored(section)
                          ? ` One score box for the whole part (items ${firstNumber}–${lastNumber}), out of ${points(
                              count * section.pointsPerItem
                            )} points. All ${count} items still count in the TOS and item analysis.`
                          : ' Each item gets its own score box in the Scores tab.')}
                    </p>
                  </article>
                );
              })}
            </div>

            <div className="section-add">
              <span className="small muted">Add a part</span>
              <div className="row row--wrap" style={{ gap: 6 }}>
                {TYPE_ORDER.map((type) => (
                  <button className="btn btn--ghost btn--sm" key={type} onClick={() => addSection(type)}>
                    <Plus size={13} /> {SECTION_LABELS[type].short}
                  </button>
                ))}
              </div>
            </div>

            <div className="structure-summary">
              <div>
                <span className="tiny faint">Whole test</span>
                <strong>{itemCount} items · {points(pointTotal)} points</strong>
              </div>
              <div>
                <span className="tiny faint">Printed sheet</span>
                <strong>{scannedCount} items · {bubbleMix} bubbles</strong>
              </div>
              <div>
                <span className="tiny faint">Scored by hand</span>
                <strong>{writtenItems.length} items · {points(writtenPointTotal)} points</strong>
              </div>
            </div>

            {overHardLimit && (
              <div className="card-note card-note--rose" style={{ marginTop: 12 }}>
                The scanner supports up to <strong>100 scanned items</strong> on one sheet. This structure has {scannedCount}.
                Move some items to a written part, or split the test into two scanned parts with separate sheets.
              </div>
            )}
            {!overHardLimit && overCapacity && (
              <div className="card-note card-note--warn" style={{ marginTop: 12 }}>
                <strong>This sheet is getting tight.</strong> {scannedCount} scanned items leave bubbles about{' '}
                <strong>{bubble.toFixed(1)} mm</strong> wide on a {PAPER_SIZES[exam.paper].short}{' '}
                {exam.sheetsPerPage === 2 ? 'two-up' : 'one-up'} page; about {capacity} items still print comfortably
                ({COMFORTABLE_BUBBLE_MM} mm). Try one sheet per page, or move some items to a written part.
              </div>
            )}
            {!overHardLimit && !overCapacity && scannedCount > 0 && (
              <div className="card-note card-note--green" style={{ marginTop: 12 }}>
                {scannedCount} of about {capacity} comfortable scanned items · bubbles print at{' '}
                <strong>{bubble.toFixed(1)} mm</strong> on a {PAPER_SIZES[exam.paper].short} page.
              </div>
            )}
            {scannedCount === 0 && (
              <div className="card-note card-note--warn" style={{ marginTop: 12 }}>
                There is no scanned part, so there is nothing to print or scan. You can still enter every score by hand
                in the Scores tab.
              </div>
            )}

            {dirty && (
              <div className="card-note card-note--warn" style={{ marginTop: 12 }}>
                <div className="row row--wrap" style={{ justifyContent: 'space-between', gap: 10 }}>
                  <span>
                    Unsaved structure. {shapeChanged && results.length > 0
                      ? `${results.length} checked sheet${results.length === 1 ? '' : 's'} will be cleared because the scanned part changes.`
                      : 'Scores will be recalculated when you save.'}
                  </span>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn--ghost btn--sm" onClick={() => setSections(examSections(exam).map((section) => ({ ...section })))}>
                      Discard
                    </button>
                    <button className="btn btn--primary btn--sm" onClick={() => save()} disabled={overHardLimit}>
                      {shapeChanged && results.length > 0 ? 'Apply and clear scans' : 'Save structure'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Paper &amp; printing</h3>
              <p>The print layout and the scanner share the same geometry.</p>
            </div>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="Paper size">
                <Segmented
                  value={exam.paper}
                  options={[
                    { value: 'FOLIO', label: 'Folio' },
                    { value: 'LEGAL', label: 'Legal' },
                    { value: 'A4', label: 'A4' },
                    { value: 'LETTER', label: 'Letter' },
                  ]}
                  onChange={(value) => patch({ paper: value as PaperSize })}
                />
              </Field>
              <Field label="Orientation">
                <Segmented
                  value={exam.orientation}
                  options={[
                    { value: 'portrait', label: 'Portrait' },
                    { value: 'landscape', label: 'Landscape' },
                  ]}
                  onChange={(value) => patch({ orientation: value as PaperOrientation })}
                />
              </Field>
              <Field label="Sheets per page" hint="Two sheets share each page and are cut along the dashed line.">
                <Segmented
                  value={String(exam.sheetsPerPage)}
                  options={[
                    { value: '1', label: 'One' },
                    { value: '2', label: 'Two' },
                  ]}
                  onChange={(value) => patch({ sheetsPerPage: (value === '2' ? 2 : 1) as SheetsPerPage })}
                />
              </Field>
              <Field label="Transmutation table">
                <Segmented
                  value={exam.depedPolicy}
                  options={[
                    { value: '2015', label: 'DO 8, s. 2015' },
                    { value: '2027', label: 'MATATAG 2027' },
                  ]}
                  onChange={(value) => patch({ depedPolicy: value })}
                />
              </Field>
            </div>
            <div className="card-note" style={{ marginTop: 14 }}>
              {exam.sheetsPerPage === 2
                ? exam.orientation === 'landscape'
                  ? `Two sheets per landscape ${PAPER_SIZES[exam.paper].short} page, side by side. After changing paper, orientation, or sheets per page, reprint the sheets — the scanner follows the new layout.`
                  : `Two sheets per portrait ${PAPER_SIZES[exam.paper].short} page, stacked top and bottom. After changing paper, orientation, or sheets per page, reprint the sheets — the scanner follows the new layout.`
                : `One sheet per ${exam.orientation} ${PAPER_SIZES[exam.paper].short} page. After changing paper or orientation, reprint the sheets — the scanner follows the new layout.`}
            </div>
          </div>
        </section>
      </div>

      <div className="stack">
        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Ready to print?</h3>
              <p>These checks follow the structure you save.</p>
            </div>
          </div>
          <div className="card-body">
            <div className="readiness-list">
              <div className="readiness-row">
                <span>{keyFilled === exam.itemCount && exam.itemCount > 0 ? <CheckCircle2 size={16} color="var(--green)" /> : <Circle size={16} />} Answer key</span>
                <strong>{keyFilled}/{exam.itemCount}</strong>
              </div>
              <div className="readiness-row">
                <span>{learners.length > 0 ? <CheckCircle2 size={16} color="var(--green)" /> : <Circle size={16} />} Roster</span>
                <strong>{learners.length} learners</strong>
              </div>
              <div className="readiness-row">
                <span>{results.length > 0 ? <CheckCircle2 size={16} color="var(--green)" /> : <Circle size={16} />} Checked sheets</span>
                <strong>{results.length}</strong>
              </div>
              {writtenItems.length > 0 && (
                <div className="readiness-row">
                  <span><PenLine size={16} /> Written scores</span>
                  <strong>{results.filter((result) => result.manualScores && Object.keys(result.manualScores).length > 0).length}/{results.length || 0} started</strong>
                </div>
              )}
            </div>
            <div style={{ marginTop: 14 }}>
              <ProgressBar
                value={exam.itemCount > 0 ? (keyFilled / exam.itemCount) * 100 : 100}
                tone={keyFilled === exam.itemCount ? 'green' : 'amber'}
              />
            </div>
            <div className="mini-list" style={{ marginTop: 16 }}>
              <button className="btn btn--soft btn--block" onClick={() => onNavigate('key')}>
                <ListChecks size={16} /> {keyFilled === exam.itemCount ? 'Review answer key' : 'Fill in answer key'} <ArrowRight size={14} />
              </button>
              <button className="btn btn--soft btn--block" onClick={() => onNavigate('roster')}>
                <Users size={16} /> {learners.length ? 'Manage roster' : 'Add learners'} <ArrowRight size={14} />
              </button>
              <button className="btn btn--soft btn--block" onClick={() => onNavigate('sheets')} disabled={exam.itemCount === 0}>
                <Printer size={16} /> Print answer sheets <ArrowRight size={14} />
              </button>
              <button className="btn btn--soft btn--block" onClick={() => onNavigate('scan')}>
                <ScanLine size={16} /> Scan a batch <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Exam actions</h3>
              <p>Duplicate to reuse the roster, parts, and key for the next quiz.</p>
            </div>
          </div>
          <div className="card-body">
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  const id = duplicateExam(exam.id);
                  if (id) toast('Exam duplicated.', 'success');
                }}
              >
                Duplicate exam
              </button>
              <button className="btn btn--danger btn--sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmRebuild}
        title="Rebuild the scanned part?"
        message={
          <>
            The scanned items will be <strong>{scannedCount} items · {bubbleMix}</strong>. The answer key is trimmed or
            extended, and {results.length ? `${results.length} checked sheet${results.length === 1 ? '' : 's'} will be deleted` : 'no checked sheets exist yet'}.
            Written parts are not affected.
          </>
        }
        confirmLabel="Rebuild and clear scans"
        danger
        onConfirm={() => save(true)}
        onClose={() => setConfirmRebuild(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this exam?"
        message={`${exam.title}, its roster, answer key, and ${results.length} checked sheets will be removed.`}
        confirmLabel="Delete exam"
        danger
        onConfirm={() => {
          deleteExam(exam.id);
          toast('Exam deleted.', 'danger');
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
