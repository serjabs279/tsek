import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Copy,
  ListChecks,
  Plus,
  ScanLine,
  Trash2,
  Users,
} from 'lucide-react';
import type { Exam, ExamCategory, ExamSection, PaperOrientation, PaperSize, SectionType, SheetsPerPage } from '@shared/types';
import {
  CATEGORY_LABELS,
  GRADE_LEVEL_OPTIONS,
  QUARTER_OPTIONS,
  SECTION_LABELS,
} from '@shared/types';
import { useApp } from '@shared/store/AppStore';
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
} from '@shared/lib/sections';
import { COMFORTABLE_BUBBLE_MM, PAPER_SIZES, buildExamLayout, sheetCapacity } from '@shared/omr/layout';
import { Badge } from '@shared/components/ui';
import { FieldBlock, ScreenHead, TypeToConfirm } from '../components/Common';
import type { ExamTab } from '../MobileApp';

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

export function SetupScreen({
  exam,
  onNavigate,
  onDeleted,
}: {
  exam: Exam;
  onNavigate: (tab: ExamTab) => void;
  onDeleted: () => void;
}) {
  const { state, updateExam, applySections, deleteExam, duplicateExam, toast } = useApp();
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);
  const keyFilled = exam.answerKey.filter(Boolean).length;

  const [sections, setSections] = useState<ExamSection[]>(() => examSections(exam).map((section) => ({ ...section })));
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setSections(examSections(exam).map((section) => ({ ...section })));
  }, [exam.id]);

  const draftExam = useMemo(() => buildExamWithSections(exam, sections), [exam, sections]);
  const items = useMemo(() => materializeItems(draftExam), [draftExam]);
  const scanned = items.filter((item) => item.scannable).length;
  const written = items.length - scanned;
  const itemTotal = totalItemCount(draftExam);
  const pointTotal = totalPoints(draftExam);
  const shapeChanged = answerShape(examSections(exam)) !== answerShape(sections);
  const dirty = sectionShape(sections) !== sectionShape(examSections(exam));

  const choiceCap = items
    .filter((item) => item.scannable)
    .reduce((widest, item) => Math.max(widest, item.choices.length), 0) || 4;
  const capacity = useMemo(
    () => sheetCapacity(exam.paper, exam.orientation, exam.sheetsPerPage, choiceCap),
    [exam.paper, exam.orientation, exam.sheetsPerPage, choiceCap]
  );
  const bubble = useMemo(() => buildExamLayout(draftExam).grid.bubbleDiameter, [draftExam]);

  const patch = (value: Partial<Exam>) => updateExam(exam.id, value);

  const patchSection = (id: string, value: Partial<ExamSection>) => {
    setSections((prev) => prev.map((section) => (section.id === id ? { ...section, ...value } : section)));
  };

  const changeType = (section: ExamSection, type: SectionType) => {
    patchSection(section.id, { type, choices: type === 'MCQ' ? section.choices ?? 4 : undefined });
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

  const saveStructure = () => {
    if (shapeChanged && results.length > 0) {
      setConfirmRebuild(true);
      return;
    }
    const next = cleanSections(sections);
    const outcome = applySections(exam.id, next);
    setSections(next.map((section) => ({ ...section })));
    if (outcome.removed && results.length > 0) {
      toast(`Structure saved. ${results.length} old scan${results.length === 1 ? '' : 's'} cleared because the scanned part changed.`, 'danger');
    } else if (shapeChanged) {
      toast('Structure saved. Reprint the answer sheets before scanning.', 'success');
    } else {
      toast('Structure saved. Existing scores were recalculated.', 'success');
    }
  };

  return (
    <>
      <ScreenHead
        eyebrow={`${exam.code} · Setup`}
        title={exam.title || 'Untitled exam'}
        subtitle={`${itemTotal} items · ${points(pointTotal)} points · ${scanned} scanned · ${written} written`}
        actions={
          <button className="btn btn--primary btn--sm" onClick={() => onNavigate('scan')}>
            <ScanLine size={15} /> Scan
          </button>
        }
      />

      <div className="m-stack">
        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Assessment details</h2>
              <p>These words print on the answer sheets and appear in every report.</p>
            </div>
          </div>
          <div className="m-card__body">
            <div className="m-form">
              <FieldBlock label="Exam title" wide>
                <input className="input" value={exam.title} onChange={(event) => patch({ title: event.target.value })} />
              </FieldBlock>
              <FieldBlock label="Subject">
                <input className="input" value={exam.subject} onChange={(event) => patch({ subject: event.target.value })} />
              </FieldBlock>
              <FieldBlock label="Subject UID">
                <input className="input input--mono" value={exam.subjectUID} onChange={(event) => patch({ subjectUID: event.target.value })} />
              </FieldBlock>
              <FieldBlock label="Grade level">
                <select
                  className="select"
                  value={exam.gradeLevel}
                  onChange={(event) =>
                    patch({
                      gradeLevel: event.target.value,
                      workspace: event.target.value === 'Grade 11' || event.target.value === 'Grade 12' ? 'SHS' : 'JHS',
                    })
                  }
                >
                  {GRADE_LEVEL_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                </select>
              </FieldBlock>
              <FieldBlock label="Section">
                <input className="input" value={exam.section} onChange={(event) => patch({ section: event.target.value })} />
              </FieldBlock>
              <FieldBlock label="Quarter">
                <select className="select" value={exam.quarterKey} onChange={(event) => patch({ quarterKey: event.target.value })}>
                  {QUARTER_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                </select>
              </FieldBlock>
              <FieldBlock label="Category">
                <select
                  className="select"
                  value={exam.category}
                  onChange={(event) => patch({ category: event.target.value as ExamCategory })}
                >
                  {(Object.keys(CATEGORY_LABELS) as ExamCategory[]).map((key) => (
                    <option key={key} value={key}>{CATEGORY_LABELS[key].short} — {CATEGORY_LABELS[key].label}</option>
                  ))}
                </select>
              </FieldBlock>
              <FieldBlock label="Teacher">
                <input className="input" value={exam.teacherName} onChange={(event) => patch({ teacherName: event.target.value })} />
              </FieldBlock>
              <FieldBlock label="School year">
                <input className="input" value={exam.schoolYear} onChange={(event) => patch({ schoolYear: event.target.value })} />
              </FieldBlock>
              <FieldBlock label="Passing percentage">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={100}
                  value={exam.passingPercent}
                  onChange={(event) => patch({ passingPercent: Math.max(1, Math.min(100, Number(event.target.value) || 75)) })}
                />
              </FieldBlock>
            </div>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Test structure</h2>
              <p>Scanned parts print bubbles; written parts are scored on the desktop app.</p>
            </div>
            <Badge tone="accent">{points(pointTotal)} pts</Badge>
          </div>
          <div className="m-card__body">
            <div className="m-stack">
              {sections.map((section, index) => {
                const canScan = isScannable(section.type);
                const count = Math.max(1, Math.round(section.itemCount));
                return (
                  <article
                    className="m-card"
                    key={section.id}
                    style={{ boxShadow: 'none', background: 'var(--surface-2)' }}
                  >
                    <div className="m-card__body">
                      <div className="m-row m-row--between">
                        <div className="m-row" style={{ flex: 1, minWidth: 0 }}>
                          <span className="eyebrow" style={{ flex: 'none' }}>Part {roman(index)}</span>
                          <input
                            className="input"
                            style={{ flex: 1, minWidth: 120, minHeight: 38 }}
                            value={section.title ?? ''}
                            placeholder={SECTION_LABELS[section.type].label}
                            onChange={(event) => patchSection(section.id, { title: event.target.value })}
                          />
                        </div>
                        <div className="m-row" style={{ gap: 3 }}>
                          <button className="m-iconbtn" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up">
                            <ChevronUp size={15} />
                          </button>
                          <button className="m-iconbtn" onClick={() => move(index, 1)} disabled={index === sections.length - 1} aria-label="Move down">
                            <ChevronDown size={15} />
                          </button>
                          <button
                            className="m-iconbtn m-iconbtn--danger"
                            onClick={() => setSections((prev) => (prev.length <= 1 ? prev : prev.filter((entry) => entry.id !== section.id)))}
                            disabled={sections.length <= 1}
                            aria-label="Remove part"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>

                      <div className="m-form" style={{ marginTop: 10 }}>
                        <FieldBlock label="Type">
                          <select className="select" value={section.type} onChange={(event) => changeType(section, event.target.value as SectionType)}>
                            {SECTION_TYPES.map((type) => <option key={type} value={type}>{SECTION_LABELS[type].label}</option>)}
                          </select>
                        </FieldBlock>
                        <FieldBlock label="Items">
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
                        </FieldBlock>
                        <FieldBlock label="Points each">
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
                        </FieldBlock>
                        {section.type === 'MCQ' && (
                          <FieldBlock label="Choices">
                            <select
                              className="select"
                              value={String(section.choices ?? 4)}
                              onChange={(event) => patchSection(section.id, { choices: event.target.value === '5' ? 5 : 4 })}
                            >
                              <option value="4">A–D</option>
                              <option value="5">A–E</option>
                            </select>
                          </FieldBlock>
                        )}
                        {!canScan && (
                          <FieldBlock label="Scoring">
                            <select
                              className="select"
                              value={section.scoreMode === 'part' ? 'part' : 'items'}
                              onChange={(event) => patchSection(section.id, { scoreMode: event.target.value === 'part' ? 'part' : 'items' })}
                            >
                              <option value="items">Each item</option>
                              <option value="part">Whole part</option>
                            </select>
                          </FieldBlock>
                        )}
                      </div>

                      <div className="m-row m-row--between" style={{ marginTop: 8 }}>
                        <span className="m-tiny">
                          {canScan ? 'Scanned with bubbles' : isPartScored(section) ? 'One score for the whole part' : 'Scored item by item'}
                          {' · '}{count} × {points(section.pointsPerItem)} = {points(count * section.pointsPerItem)} pts
                        </span>
                        <Badge tone={canScan ? 'green' : 'neutral'}>{canScan ? 'scanned' : 'written'}</Badge>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="m-row" style={{ marginTop: 12 }}>
              <span className="m-tiny" style={{ marginRight: 4 }}>Add a part:</span>
              {SECTION_TYPES.map((type) => (
                <button
                  className="btn btn--ghost btn--sm"
                  key={type}
                  onClick={() => setSections((prev) => [...prev, createSection(type)])}
                >
                  <Plus size={13} /> {SECTION_LABELS[type].short}
                </button>
              ))}
            </div>

            {scanned > 100 && (
              <div className="m-note m-note--danger" style={{ marginTop: 12 }}>
                The scanner supports up to 100 bubbles on one sheet. Move {scanned - 100} items to a
                written part or split the scanned test into two parts.
              </div>
            )}
            {scanned > 0 && scanned <= 100 && (
              <div className={`m-note ${scanned > capacity ? 'm-note--warn' : 'm-note--green'}`} style={{ marginTop: 12 }}>
                {scanned} scanned items · bubbles about {bubble.toFixed(1)} mm on a{' '}
                {PAPER_SIZES[exam.paper].short} {exam.sheetsPerPage === 2 ? 'two-up' : 'one-up'} page.
                About {capacity} items print comfortably ({COMFORTABLE_BUBBLE_MM} mm).
              </div>
            )}

            {dirty && (
              <div className="m-note m-note--warn" style={{ marginTop: 12 }}>
                <div className="m-row m-row--between">
                  <span>
                    Unsaved structure.{' '}
                    {shapeChanged && results.length > 0
                      ? `${results.length} checked sheet${results.length === 1 ? '' : 's'} will be cleared.`
                      : 'Scores recalculate when saved.'}
                  </span>
                  <div className="m-row">
                    <button className="btn btn--ghost btn--sm" onClick={() => setSections(examSections(exam).map((section) => ({ ...section })))}>
                      Discard
                    </button>
                    <button className="btn btn--primary btn--sm" onClick={saveStructure}>
                      Save structure
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Sheet layout</h2>
              <p>Keep this identical to the sheets printed from the desktop app.</p>
            </div>
          </div>
          <div className="m-card__body">
            <div className="m-form">
              <FieldBlock label="Paper size">
                <select
                  className="select"
                  value={exam.paper}
                  onChange={(event) => patch({ paper: event.target.value as PaperSize })}
                >
                  {(Object.keys(PAPER_SIZES) as PaperSize[]).map((size) => (
                    <option key={size} value={size}>{PAPER_SIZES[size].short}</option>
                  ))}
                </select>
              </FieldBlock>
              <FieldBlock label="Orientation">
                <select
                  className="select"
                  value={exam.orientation}
                  onChange={(event) => patch({ orientation: event.target.value as PaperOrientation })}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </FieldBlock>
              <FieldBlock label="Sheets per page">
                <select
                  className="select"
                  value={String(exam.sheetsPerPage)}
                  onChange={(event) => patch({ sheetsPerPage: (event.target.value === '2' ? 2 : 1) as SheetsPerPage })}
                >
                  <option value="1">One</option>
                  <option value="2">Two</option>
                </select>
              </FieldBlock>
              <FieldBlock label="Transmutation">
                <select
                  className="select"
                  value={exam.depedPolicy}
                  onChange={(event) => patch({ depedPolicy: event.target.value === '2027' ? '2027' : '2015' })}
                >
                  <option value="2015">DO 8, s. 2015</option>
                  <option value="2027">MATATAG 2027</option>
                </select>
              </FieldBlock>
            </div>
            <div className="m-note" style={{ marginTop: 12 }}>
              Changing paper, orientation, or sheets per page changes where the scanner looks for
              bubbles. Reprint the sheets on the desktop app after any change here.
            </div>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Next steps</h2>
              <p>The tablet does the roster, key, scanning, results, and analysis.</p>
            </div>
          </div>
          <div className="m-card__body">
            <div className="m-stack">
              <button className="m-bigbtn" onClick={() => onNavigate('roster')}>
                <span className="m-bigbtn__icon"><Users size={19} /></span>
                <span style={{ flex: 1 }}>
                  <strong>{learners.length ? 'Manage roster' : 'Add the class roster'}</strong>
                  <span>{learners.length} learner{learners.length === 1 ? '' : 's'} on this exam</span>
                </span>
                <ArrowRight size={16} />
              </button>
              <button className="m-bigbtn" onClick={() => onNavigate('key')}>
                <span className="m-bigbtn__icon"><ListChecks size={19} /></span>
                <span style={{ flex: 1 }}>
                  <strong>{keyFilled === exam.itemCount ? 'Review the answer key' : 'Fill in the answer key'}</strong>
                  <span>{keyFilled} of {exam.itemCount} scanned items filled</span>
                </span>
                <ArrowRight size={16} />
              </button>
              <button className="m-bigbtn m-bigbtn--accent" onClick={() => onNavigate('scan')}>
                <span className="m-bigbtn__icon"><ScanLine size={19} /></span>
                <span style={{ flex: 1 }}>
                  <strong>Scan a batch</strong>
                  <span>Camera or imported photos and PDFs</span>
                </span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Exam actions</h2>
              <p>Duplicate reuses the roster, parts, and key for the next quiz.</p>
            </div>
          </div>
          <div className="m-card__body">
            <div className="m-row">
              <button
                className="btn btn--ghost"
                onClick={() => {
                  const id = duplicateExam(exam.id);
                  if (id) toast('Exam duplicated. Find the copy on the exam list.', 'success');
                }}
              >
                <Copy size={15} /> Duplicate
              </button>
              <button className="btn btn--danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} /> Delete exam
              </button>
            </div>
          </div>
        </section>

        <div className="m-note">
          <strong>Printing and exports are desktop-only.</strong> Generate the PDF answer sheets,
          class reports, and CSV files from the Windows app. This tablet build keeps a snapshot
          before destructive changes, but restore is also on desktop.
        </div>
      </div>

      <TypeToConfirm
        open={confirmRebuild}
        title="Rebuild the scanned part?"
        message={
          <>
            The scanned part becomes <strong>{scanned} items</strong>. The answer key is trimmed or
            extended, and {results.length} checked sheet{results.length === 1 ? '' : 's'} will be
            deleted. Written parts are not affected.
          </>
        }
        phrase="REBUILD"
        confirmLabel="Rebuild and clear scans"
        onClose={() => setConfirmRebuild(false)}
        onConfirm={() => {
          const next = cleanSections(sections);
          applySections(exam.id, next);
          setSections(next.map((section) => ({ ...section })));
          toast(`Structure rebuilt. ${results.length} old scan${results.length === 1 ? '' : 's'} cleared.`, 'danger');
        }}
      />

      <TypeToConfirm
        open={confirmDelete}
        title="Delete this exam?"
        message={
          <>
            <strong>{exam.title}</strong>, its roster, answer key, and {results.length} checked
            sheet{results.length === 1 ? '' : 's'} will be removed from this tablet.
          </>
        }
        phrase="DELETE"
        confirmLabel="Delete exam"
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteExam(exam.id);
          toast('Exam deleted.', 'danger');
          onDeleted();
        }}
      />
    </>
  );
}
