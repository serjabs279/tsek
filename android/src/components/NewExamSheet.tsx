import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useApp } from '@shared/store/AppStore';
import {
  CATEGORY_LABELS,
  GRADE_LEVEL_OPTIONS,
  QUARTER_OPTIONS,
  type ExamCategory,
} from '@shared/types';
import { MobileSheet, FieldBlock } from './Common';

export function NewExamSheet({
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
  const [gradeLevel, setGradeLevel] = useState('Grade 10');
  const [section, setSection] = useState('');
  const [quarterKey, setQuarterKey] = useState('1st Quarter');
  const [category, setCategory] = useState<ExamCategory>('QSTE');
  const [itemCount, setItemCount] = useState(state.settings.defaultItemCount || 50);
  const [choiceCount, setChoiceCount] = useState<4 | 5>(
    state.settings.defaultChoiceCount === 5 ? 5 : 4
  );
  const [passingPercent, setPassingPercent] = useState(state.settings.passingPercent || 75);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setSubject('');
    setGradeLevel('Grade 10');
    setSection('');
    setQuarterKey('1st Quarter');
    setCategory('QSTE');
    setItemCount(state.settings.defaultItemCount || 50);
    setChoiceCount(state.settings.defaultChoiceCount === 5 ? 5 : 4);
    setPassingPercent(state.settings.passingPercent || 75);
  }, [open, state.settings.defaultItemCount, state.settings.defaultChoiceCount, state.settings.passingPercent]);

  const create = () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      toast('Give the exam a title first.', 'danger');
      return;
    }
    if (!subject.trim()) {
      toast('Add the subject so the sheets and reports are labelled.', 'danger');
      return;
    }
    const id = createExam({
      title: cleanTitle,
      subject: subject.trim(),
      gradeLevel,
      section: section.trim(),
      quarterKey,
      category,
      itemCount: Math.max(20, Math.min(100, Math.round(itemCount) || 50)),
      choiceCount,
      passingPercent: Math.max(1, Math.min(100, Math.round(passingPercent) || 75)),
      workspace: gradeLevel === 'Grade 11' || gradeLevel === 'Grade 12' ? 'SHS' : 'JHS',
      teacherName: '',
      assessmentName:
        category === 'WOW' ? 'Written Work' : category === 'PPT' ? 'Performance Task' : 'Quarterly Examination',
    });
    toast('Exam created. Add the roster and the answer key next.', 'success');
    onCreated(id);
  };

  return (
    <MobileSheet
      open={open}
      title="New exam"
      subtitle="The structure can be changed later in Setup"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={create}>
            <Plus size={16} /> Create exam
          </button>
        </>
      }
    >
      <div className="m-form">
        <FieldBlock label="Exam title" wide>
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="1st Quarter Examination in Mathematics 10"
            autoFocus
          />
        </FieldBlock>
        <FieldBlock label="Subject">
          <input className="input" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Mathematics" />
        </FieldBlock>
        <FieldBlock label="Grade level">
          <select className="select" value={gradeLevel} onChange={(event) => setGradeLevel(event.target.value)}>
            {GRADE_LEVEL_OPTIONS.map((option) => <option key={option}>{option}</option>)}
          </select>
        </FieldBlock>
        <FieldBlock label="Section">
          <input className="input" value={section} onChange={(event) => setSection(event.target.value)} placeholder="Rizal" />
        </FieldBlock>
        <FieldBlock label="Quarter">
          <select className="select" value={quarterKey} onChange={(event) => setQuarterKey(event.target.value)}>
            {QUARTER_OPTIONS.map((option) => <option key={option}>{option}</option>)}
          </select>
        </FieldBlock>
        <FieldBlock label="Category">
          <select className="select" value={category} onChange={(event) => setCategory(event.target.value as ExamCategory)}>
            {(Object.keys(CATEGORY_LABELS) as ExamCategory[]).map((key) => (
              <option key={key} value={key}>{CATEGORY_LABELS[key].short} — {CATEGORY_LABELS[key].label}</option>
            ))}
          </select>
        </FieldBlock>
        <FieldBlock label="Scanned items" hint="The default MCQ part; more parts can be added in Setup.">
          <input
            className="input"
            type="number"
            min={20}
            max={100}
            value={itemCount}
            onChange={(event) => setItemCount(Number(event.target.value) || 50)}
          />
        </FieldBlock>
        <FieldBlock label="Choices">
          <select className="select" value={String(choiceCount)} onChange={(event) => setChoiceCount(event.target.value === '5' ? 5 : 4)}>
            <option value="4">A–D</option>
            <option value="5">A–E</option>
          </select>
        </FieldBlock>
        <FieldBlock label="Passing percentage">
          <input
            className="input"
            type="number"
            min={1}
            max={100}
            value={passingPercent}
            onChange={(event) => setPassingPercent(Number(event.target.value) || 75)}
          />
        </FieldBlock>
      </div>
      <div className="m-note" style={{ marginTop: 14 }}>
        The sheet prints with a QR of the exam code and each learner's LRN. Scanning reads that QR,
        so sheets must be printed from the desktop app after the roster and key are ready.
      </div>
    </MobileSheet>
  );
}
