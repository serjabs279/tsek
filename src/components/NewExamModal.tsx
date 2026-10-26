import { useEffect, useState } from 'react';
import type { Exam, ExamCategory, PaperOrientation, PaperSize, SheetsPerPage } from '../types';
import { CATEGORY_LABELS, GRADE_LEVEL_OPTIONS, QUARTER_OPTIONS } from '../types';
import { useApp } from '../store/AppStore';
import { defaultDepedPolicy } from '../lib/grading';
import { PAPER_SIZES } from '../omr/layout';
import { Field, Modal, Segmented } from './ui';

const CATEGORY_DEFAULT_ASSESSMENT: Record<ExamCategory, string> = {
  WOW: 'Written Work 1',
  PPT: 'Performance Task 1',
  QSTE: 'Quarterly Examination',
};

export function NewExamModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (examId: string) => void;
}) {
  const { state, createExam, toast } = useApp();
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [subjectUID, setSubjectUID] = useState('');
  const [gradeLevel, setGradeLevel] = useState('Grade 10');
  const [section, setSection] = useState('');
  const [teacherName, setTeacherName] = useState('');
  const [schoolYear, setSchoolYear] = useState('2026-2027');
  const [quarterKey, setQuarterKey] = useState('1st Quarter');
  const [workspace, setWorkspace] = useState<'JHS' | 'SHS'>('JHS');
  const [category, setCategory] = useState<ExamCategory>('QSTE');
  const [assessmentName, setAssessmentName] = useState(CATEGORY_DEFAULT_ASSESSMENT.QSTE);
  const [itemCount, setItemCount] = useState(state.settings.defaultItemCount);
  const [choiceCount, setChoiceCount] = useState<4 | 5>(state.settings.defaultChoiceCount);
  const [paper, setPaper] = useState<PaperSize>(state.settings.paper);
  const [orientation, setOrientation] = useState<PaperOrientation>(state.settings.orientation);
  const [sheetsPerPage, setSheetsPerPage] = useState<SheetsPerPage>(state.settings.sheetsPerPage);
  const [passingPercent, setPassingPercent] = useState(state.settings.passingPercent);
  const [depedPolicy, setDepedPolicy] = useState(state.settings.depedPolicy);
  const [assessmentTouched, setAssessmentTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setSubject('');
    setSubjectUID('');
    setSection('');
    setTeacherName('');
    setCategory('QSTE');
    setAssessmentName(CATEGORY_DEFAULT_ASSESSMENT.QSTE);
    setAssessmentTouched(false);
    setItemCount(state.settings.defaultItemCount);
    setChoiceCount(state.settings.defaultChoiceCount);
    setPaper(state.settings.paper);
    setOrientation(state.settings.orientation);
    setSheetsPerPage(state.settings.sheetsPerPage);
    setPassingPercent(state.settings.passingPercent);
    setSchoolYear('2026-2027');
    setDepedPolicy(defaultDepedPolicy('2026-2027'));
  }, [open, state.settings]);

  const pickCategory = (next: ExamCategory) => {
    setCategory(next);
    if (!assessmentTouched) setAssessmentName(CATEGORY_DEFAULT_ASSESSMENT[next]);
  };

  const clampedItems = Math.max(20, Math.min(100, Math.round(itemCount) || 20));

  const submit = () => {
    if (!title.trim()) {
      toast('Give the exam a title first.', 'danger');
      return;
    }
    const partial: Partial<Exam> = {
      title: title.trim(),
      subject: subject.trim(),
      subjectUID: subjectUID.trim(),
      gradeLevel,
      section: section.trim(),
      teacherName: teacherName.trim(),
      schoolYear: schoolYear.trim() || '2026-2027',
      quarterKey,
      workspace,
      category,
      assessmentName: assessmentName.trim() || CATEGORY_DEFAULT_ASSESSMENT[category],
      itemCount: clampedItems,
      choiceCount,
      paper,
      orientation,
      sheetsPerPage,
      passingPercent: Math.max(1, Math.min(100, Math.round(passingPercent) || 75)),
      depedPolicy,
    };
    const id = createExam(partial);
    toast('Exam created. The answer key is next.', 'success');
    onCreated(id);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="New exam"
      eyebrow="Assessment"
      onClose={onClose}
      width={780}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit}>Create exam</button>
        </>
      }
    >
      <div className="form-section">
        <div className="form-section__head">
          <h3>What is being checked?</h3>
          <p>The category decides where this score belongs in the GradeApp.</p>
        </div>
        <div className="form-grid">
          <Field label="Exam title" wide hint="Printed on every answer sheet.">
            <input
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="1st Quarterly Exam — Mathematics 10"
              autoFocus
            />
          </Field>
          <Field label="Subject">
            <input
              className="input"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Mathematics"
            />
          </Field>
          <Field label="Subject UID" hint="Optional. Use the same UID as the GradeApp subject.">
            <input
              className="input input--mono"
              value={subjectUID}
              onChange={(event) => setSubjectUID(event.target.value)}
              placeholder="MATH10-Q1-2026"
            />
          </Field>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section__head">
          <h3>Category</h3>
          <p>Written Works, Performance Tasks, and Quarterly Exams are exported separately.</p>
        </div>
        <div className="category-picker">
          {(Object.keys(CATEGORY_LABELS) as ExamCategory[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`category-option ${category === key ? 'is-active' : ''}`}
              onClick={() => pickCategory(key)}
            >
              <span className="category-option__badge">{CATEGORY_LABELS[key].short}</span>
              <span className="category-option__copy">
                <strong>{CATEGORY_LABELS[key].label}</strong>
                <span>{CATEGORY_LABELS[key].long}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label="Assessment name" hint="e.g. Quiz 3, PT 2, 1st Quarterly Exam">
            <input
              className="input"
              value={assessmentName}
              onChange={(event) => {
                setAssessmentName(event.target.value);
                setAssessmentTouched(true);
              }}
            />
          </Field>
          <Field label="Quarter">
            <select className="select" value={quarterKey} onChange={(event) => setQuarterKey(event.target.value)}>
              {QUARTER_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section__head">
          <h3>Class</h3>
          <p>These details appear on the sheets and in the exported JSON.</p>
        </div>
        <div className="form-grid">
          <Field label="Grade level">
            <select className="select" value={gradeLevel} onChange={(event) => setGradeLevel(event.target.value)}>
              {GRADE_LEVEL_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </Field>
          <Field label="Section">
            <input
              className="input"
              value={section}
              onChange={(event) => setSection(event.target.value)}
              placeholder="St. Paul"
            />
          </Field>
          <Field label="Teacher">
            <input
              className="input"
              value={teacherName}
              onChange={(event) => setTeacherName(event.target.value)}
              placeholder="Ma. Elena Reyes"
            />
          </Field>
          <Field label="School year">
            <input
              className="input"
              value={schoolYear}
              onChange={(event) => setSchoolYear(event.target.value)}
              placeholder="2026-2027"
            />
          </Field>
          <Field label="Track">
            <Segmented
              value={workspace}
              options={[
                { value: 'JHS', label: 'JHS' },
                { value: 'SHS', label: 'SHS' },
              ]}
              onChange={setWorkspace}
            />
          </Field>
          <Field label="Passing percentage">
            <input
              className="input"
              type="number"
              min={1}
              max={100}
              value={passingPercent}
              onChange={(event) => setPassingPercent(Number(event.target.value))}
            />
          </Field>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section__head">
          <h3>Sheet shape</h3>
          <p>Choose 20 to 100 items. The sheet layout adjusts automatically and the scanner follows it.</p>
        </div>
        <div className="form-grid">
          <Field label="Number of items" hint="Minimum 20, maximum 100.">
            <input
              className="input"
              type="number"
              min={20}
              max={100}
              value={itemCount}
              onChange={(event) => setItemCount(Number(event.target.value))}
            />
          </Field>
          <Field label="Choices per item">
            <Segmented
              value={String(choiceCount)}
              options={[
                { value: '4', label: 'A–D', hint: '4 choices' },
                { value: '5', label: 'A–E', hint: '5 choices' },
              ]}
              onChange={(value) => setChoiceCount(value === '5' ? 5 : 4)}
            />
          </Field>
          <Field label="Paper size">
            <Segmented
              value={paper}
              options={[
                { value: 'FOLIO', label: 'Folio', hint: '8.5 × 13 in' },
                { value: 'LEGAL', label: 'Legal', hint: '8.5 × 14 in' },
                { value: 'A4', label: 'A4', hint: '210 × 297' },
                { value: 'LETTER', label: 'Letter', hint: '8.5 × 11 in' },
              ]}
              onChange={setPaper}
            />
          </Field>
          <Field label="Orientation">
            <Segmented
              value={orientation}
              options={[
                { value: 'portrait', label: 'Portrait' },
                { value: 'landscape', label: 'Landscape' },
              ]}
              onChange={setOrientation}
            />
          </Field>
          <Field label="Sheets per page">
            <Segmented
              value={String(sheetsPerPage)}
              options={[
                { value: '1', label: 'One' },
                { value: '2', label: 'Two', hint: 'two per page' },
              ]}
              onChange={(value) => setSheetsPerPage(value === '2' ? 2 : 1)}
            />
          </Field>
          <Field label="Transmutation table">
            <Segmented
              value={depedPolicy}
              options={[
                { value: '2015', label: 'DO 8, s. 2015' },
                { value: '2027', label: 'MATATAG 2027' },
              ]}
              onChange={setDepedPolicy}
            />
          </Field>
        </div>
        <div className="card-note" style={{ marginTop: 12 }}>
          {sheetsPerPage === 2
            ? orientation === 'landscape'
              ? `Two sheets share each landscape ${PAPER_SIZES[paper].short} page, side by side. Cut along the dashed center line.`
              : `Two sheets share each portrait ${PAPER_SIZES[paper].short} page, stacked top and bottom. Cut along the dashed line.`
            : `One sheet fills each ${orientation} ${PAPER_SIZES[paper].short} page.`}
        </div>
      </div>
    </Modal>
  );
}
