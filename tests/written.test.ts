/**
 * Tests for the written-answer page planner.
 *
 * The expected geometry below is computed by hand from WRITTEN_LAYOUT and the
 * paper dimensions, not copied from the planner's output, so a regression in
 * the sharing or pagination maths fails here.
 * Run with `npm run test:written`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { answerSpaceFor, writtenSections } from '../src/lib/sections';
import {
  planWrittenSheets,
  WRITTEN_LAYOUT,
  writtenPanelGeometry,
  writtenPageGeometry,
} from '../src/lib/written';
import type { Exam, ExamSection, SectionType } from '../src/types';

const WHEN = '2026-11-23T00:00:00.000Z';

function section(
  id: string,
  type: SectionType,
  itemCount: number,
  extra: Partial<ExamSection> = {}
): ExamSection {
  return { id, type, itemCount, pointsPerItem: 2, ...extra };
}

function makeExam(sections: ExamSection[], paper: Exam['paper'] = 'FOLIO'): Exam {
  return {
    id: 'exam-written',
    code: 'WRIT',
    title: 'Written test exam',
    subject: 'Science',
    subjectUID: 'sci',
    schoolYear: '2026-2027',
    gradeLevel: '10',
    section: 'A',
    teacherName: 'Test Teacher',
    workspace: 'school',
    quarterKey: 'Q1',
    category: 'quarterly',
    assessmentName: 'Quarterly Exam',
    itemCount: 0,
    choiceCount: 4,
    answerKey: [],
    passingPercent: 75,
    depedPolicy: '2015',
    paper,
    orientation: 'landscape',
    sheetsPerPage: 2,
    sections,
    createdAt: WHEN,
    updatedAt: WHEN,
  };
}

test('type defaults: identification and enumeration get lines, essays get blocks', () => {
  assert.equal(answerSpaceFor(section('a', 'IDENTIFICATION', 5)), 'line');
  assert.equal(answerSpaceFor(section('b', 'ENUMERATION', 5)), 'line');
  assert.equal(answerSpaceFor(section('c', 'MODIFIED_TRUE_FALSE', 5)), 'line');
  assert.equal(answerSpaceFor(section('d', 'ESSAY', 1)), 'block');
  assert.equal(answerSpaceFor(section('e', 'ESSAY', 1, { answerSpace: 'line' })), 'line');
  assert.equal(answerSpaceFor(section('f', 'IDENTIFICATION', 5, { answerSpace: 'block' })), 'block');
});

test('writtenSections drops the scannable parts', () => {
  const exam = makeExam([
    section('mcq', 'MCQ', 10, { choices: 4 }),
    section('tf', 'TRUE_FALSE', 5),
    section('id', 'IDENTIFICATION', 3),
  ]);
  assert.deepEqual(
    writtenSections(exam).map((entry) => entry.id),
    ['id']
  );
});

test('mixed exam: numbering continues past MCQ and essays share the page', () => {
  // Folio is 216 x 330 mm. Body runs from 56 mm to 314 mm.
  const exam = makeExam([
    section('mcq', 'MCQ', 10, { choices: 4 }),
    section('id', 'IDENTIFICATION', 5),
    section('enum', 'ENUMERATION', 3),
    section('essay', 'ESSAY', 2),
  ]);
  const plan = planWrittenSheets(exam);

  assert.equal(plan.pages.length, 1);
  assert.equal(plan.partCount, 3);
  assert.equal(plan.shortCount, 8);
  assert.equal(plan.longCount, 2);
  assert.equal(plan.itemCount, 10);

  // Identification: 56 + 11 heading = 67; five 9 mm lines end at 112.
  // Enumeration: 112 + 11 = 123; three 9 mm lines end at 150.
  // Essay: 150 + 11 = 161. Two essays share 314 - 161 = 153 mm.
  // floor(153 / 8.5) = 18 lines of room; 18 / 2 = 9 lines each.
  const [id, enumeration, essay] = plan.pages[0].parts;
  assert.deepEqual(id.entries.map((entry) => entry.number), [11, 12, 13, 14, 15]);
  assert.ok(id.entries.every((entry) => entry.kind === 'line' && entry.lines === 1));
  assert.deepEqual(enumeration.entries.map((entry) => entry.number), [16, 17, 18]);
  assert.deepEqual(essay.entries.map((entry) => entry.number), [19, 20]);
  assert.ok(essay.entries.every((entry) => entry.kind === 'block'));
  assert.equal(essay.entries[0].lines, 9);
  assert.equal(essay.entries[1].lines, 9);
  assert.equal(plan.minLongLines, 9);
  assert.equal(plan.maxLongLines, 9);
});

test('a single essay never takes more than the block ceiling', () => {
  const exam = makeExam([section('essay', 'ESSAY', 1)]);
  const plan = planWrittenSheets(exam);
  // 56 + 11 = 67 heading; 247 mm of room is 29 lines, capped at 16.
  assert.equal(plan.longCount, 1);
  assert.equal(plan.pages.length, 1);
  assert.equal(plan.pages[0].parts[0].entries[0].lines, WRITTEN_LAYOUT.maxLongLines);
});

test('per-part override can turn an essay into one-line answers', () => {
  const exam = makeExam([section('essay', 'ESSAY', 4, { answerSpace: 'line' })]);
  const plan = planWrittenSheets(exam);
  assert.equal(plan.shortCount, 4);
  assert.equal(plan.longCount, 0);
  assert.equal(plan.minLongLines, 0);
  assert.ok(plan.pages[0].parts[0].entries.every((entry) => entry.kind === 'line'));
});

test('many essays spill to more pages without starving a block', () => {
  // Letter is 215.9 x 279.4 mm, so the body ends at 263.4 mm.
  const exam = makeExam([section('essay', 'ESSAY', 12)], 'LETTER');
  const plan = planWrittenSheets(exam);

  assert.ok(plan.pages.length > 1, 'twelve essays cannot fit on one page');
  assert.equal(plan.longCount, 12);
  assert.equal(plan.minLongLines, WRITTEN_LAYOUT.minLongLines);
  const seen = plan.pages.flatMap((page) =>
    page.parts.flatMap((part) => {
      // Every page reports only the items printed on it.
      assert.equal(part.itemCount, part.entries.length);
      return part.entries.map((entry) => entry.number);
    })
  );
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('a continued part is labelled so the student knows it keeps going', () => {
  const exam = makeExam([section('essay', 'ESSAY', 12)], 'letter');
  const plan = planWrittenSheets(exam);
  assert.equal(plan.pages[0].parts[0].continued, false);
  assert.equal(plan.pages[1].parts[0].continued, true);
});

test('short answers also paginate when the page fills', () => {
  // 40 lines at 9 mm each need 360 mm; Letter has 207.4 mm of body room.
  const exam = makeExam([section('id', 'IDENTIFICATION', 40, { answerSpace: 'line' })], 'LETTER');
  const plan = planWrittenSheets(exam);
  assert.equal(plan.pages.length, 2);
  assert.equal(plan.shortCount, 40);
  const numbers = plan.pages.flatMap((page) =>
    page.parts.flatMap((part) => part.entries.map((entry) => entry.number))
  );
  assert.deepEqual(numbers, Array.from({ length: 40 }, (_, index) => index + 1));
});

test('an exam with no written parts plans no pages', () => {
  const exam = makeExam([section('mcq', 'MCQ', 20, { choices: 4 })]);
  const plan = planWrittenSheets(exam);
  assert.equal(plan.pages.length, 0);
  assert.equal(plan.itemCount, 0);
});

test('panel geometry takes the spare half of the printed page', () => {
  assert.deepEqual(
    (({ width, height }) => ({ width, height }))(writtenPanelGeometry('FOLIO', 'landscape')),
    { width: 165, height: 216 }
  );
  assert.deepEqual(
    (({ width, height }) => ({ width, height }))(writtenPanelGeometry('FOLIO', 'portrait')),
    { width: 216, height: 165 }
  );
  assert.deepEqual(
    (({ width, height }) => ({ width, height }))(writtenPanelGeometry('LEGAL', 'landscape')),
    { width: 177.8, height: 215.9 }
  );
  assert.deepEqual(
    (({ width, height }) => ({ width, height }))(writtenPageGeometry('FOLIO')),
    { width: 216, height: 330 }
  );
});

test('a mixed sheet starts in the left panel and continues on a full page', () => {
  const exam = makeExam([
    section('id', 'IDENTIFICATION', 12, { pointsPerItem: 1 }),
    section('enum', 'ENUMERATION', 5),
    section('mtf', 'MODIFIED_TRUE_FALSE', 5),
    section('essay', 'ESSAY', 2, { pointsPerItem: 10 }),
  ]);
  const panel = writtenPanelGeometry('FOLIO', 'landscape');
  const plan = planWrittenSheets(exam, 'FOLIO', panel);

  assert.equal(plan.pages.length, 2, 'the extra written room spills to a second page');
  assert.equal(plan.pages[0].geometry.width, 165);
  assert.equal(plan.pages[0].geometry.height, 216);
  assert.equal(plan.pages[1].geometry.width, 216);
  assert.equal(plan.pages[1].geometry.height, 330);

  // The half panel is narrow-ruled: 7.5 mm a line instead of the full page's
  // 9 mm, so more items fit before a part spills.
  assert.equal(panel.shortPitch, 7.5);

  // Everything planned for the panel must finish above its bottom margin
  // (206 mm): heading + entries for each part printed on page one.
  const used = plan.pages[0].parts.reduce(
    (sum, part) => sum + panel.partHeading + part.entries.reduce((lineSum, entry) => lineSum + entry.height, 0),
    0
  );
  assert.ok(panel.headerBottom + used <= panel.height - panel.bottomMargin);

  // The part that overflowed says it continues on page two.
  const continued = plan.pages[1].parts[0];
  assert.equal(continued.continued, true);
  assert.ok(continued.entries.length > 0);

  // No written item is lost or printed twice.
  const numbers = plan.pages.flatMap((page) =>
    page.parts.flatMap((part) => part.entries.map((entry) => entry.number))
  );
  assert.deepEqual(numbers, Array.from({ length: 24 }, (_, index) => index + 1));
});

