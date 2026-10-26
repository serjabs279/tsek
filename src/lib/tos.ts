import { BLOOM_LEVELS } from '../types';
import type { AppSettings, BloomLevel, Exam, TosPlan, TosRow } from '../types';
import { uid } from './id';
import { totalItemCount } from './sections';

export const DEFAULT_BLOOM_WEIGHTS: Record<BloomLevel, number> = {
  Remembering: 30,
  Understanding: 20,
  Applying: 20,
  Analyzing: 10,
  Evaluation: 10,
  Creating: 10,
};

export function emptyTosRow(type = 'Multiple Choice'): TosRow {
  return {
    id: uid('TOS'),
    topic: '',
    competencies: '',
    time: 60,
    items: { Remembering: 0, Understanding: 0, Applying: 0, Analyzing: 0, Evaluation: 0, Creating: 0 },
    type,
  };
}

export function createTosPlan(exam: Exam): TosPlan {
  return {
    subject: exam.subject,
    grade: exam.gradeLevel,
    gradingPeriod: exam.quarterKey,
    schoolYear: exam.schoolYear,
    teacher: exam.teacherName,
    bloomWeights: { ...DEFAULT_BLOOM_WEIGHTS },
    rows: [emptyTosRow()],
  };
}

export function rowWeightPercent(plan: TosPlan, row: TosRow): number {
  const totalTime = plan.rows.reduce((sum, item) => sum + Math.max(0, item.time), 0);
  if (totalTime > 0) return (Math.max(0, row.time) / totalTime) * 100;
  return plan.rows.length ? 100 / plan.rows.length : 0;
}

/**
 * Spread the exam's items over every topic / Bloom cell, following both the
 * time-based topic weight and the Bloom level weights. Largest-remainder
 * rounding keeps the allocated total exactly equal to the item count.
 */
export function distributeItems(plan: TosPlan, itemCount: number): TosPlan {
  if (plan.rows.length === 0 || itemCount <= 0) {
    return { ...plan, rows: plan.rows.map((row) => ({ ...row, items: zeroItems() })) };
  }

  const rowTimes = plan.rows.map((row) => Math.max(0, row.time));
  const totalTime = rowTimes.reduce((sum, value) => sum + value, 0);
  const rowFractions = rowTimes.every((value) => value === 0)
    ? plan.rows.map(() => 1 / plan.rows.length)
    : rowTimes.map((value) => value / totalTime);

  const weights = BLOOM_LEVELS.map((level) => Math.max(0, plan.bloomWeights[level] || 0));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const levelFractions = totalWeight > 0
    ? weights.map((value) => value / totalWeight)
    : BLOOM_LEVELS.map(() => 1 / BLOOM_LEVELS.length);

  const cells: Array<{ row: number; level: BloomLevel; count: number; remainder: number; order: number }> = [];
  let allocated = 0;
  plan.rows.forEach((_, rowIndex) => {
    BLOOM_LEVELS.forEach((level, levelIndex) => {
      const exact = itemCount * rowFractions[rowIndex] * levelFractions[levelIndex];
      const count = Math.floor(exact + 1e-9);
      allocated += count;
      cells.push({
        row: rowIndex,
        level,
        count,
        remainder: exact - count,
        order: rowIndex * BLOOM_LEVELS.length + levelIndex,
      });
    });
  });

  let remaining = itemCount - allocated;
  const byRemainder = [...cells].sort((a, b) => b.remainder - a.remainder || a.order - b.order);
  let cursor = 0;
  while (remaining > 0 && byRemainder.length > 0) {
    const cell = byRemainder[cursor % byRemainder.length];
    cell.count += 1;
    remaining -= 1;
    cursor += 1;
  }

  const rows = plan.rows.map((row, rowIndex) => {
    const items = zeroItems();
    cells
      .filter((cell) => cell.row === rowIndex)
      .forEach((cell) => {
        items[cell.level] = cell.count;
      });
    return { ...row, items };
  });

  return { ...plan, rows };
}

function zeroItems(): Record<BloomLevel, number> {
  return { Remembering: 0, Understanding: 0, Applying: 0, Analyzing: 0, Evaluation: 0, Creating: 0 };
}

/**
 * Item numbers follow the table order: topic 1 Remembering items first, then
 * Understanding, and so on. Consecutive numbers collapse into ranges.
 */
export function placeItems(plan: TosPlan): Record<string, Record<BloomLevel, string>> {
  const placement: Record<string, Record<BloomLevel, string>> = {};
  let next = 1;
  plan.rows.forEach((row) => {
    const rowPlacement = {} as Record<BloomLevel, string>;
    BLOOM_LEVELS.forEach((level) => {
      const count = Math.max(0, Math.round(row.items[level] || 0));
      const numbers = Array.from({ length: count }, () => next++);
      rowPlacement[level] = formatRuns(numbers);
    });
    placement[row.id] = rowPlacement;
  });
  return placement;
}

function formatRuns(numbers: number[]): string {
  if (numbers.length === 0) return '';
  const runs: Array<[number, number]> = [];
  numbers.forEach((value) => {
    const last = runs[runs.length - 1];
    if (last && value === last[1] + 1) last[1] = value;
    else runs.push([value, value]);
  });
  return runs
    .map(([start, end]) => (start === end ? String(start) : `${start}\u2013${end}`))
    .join(', ');
}

export interface TosTotals {
  totalTime: number;
  allocated: number;
  perLevel: Record<BloomLevel, number>;
  rowItems: number[];
}

export function tosTotals(plan: TosPlan): TosTotals {
  const perLevel = zeroItems();
  const rowItems = plan.rows.map((row) => {
    let total = 0;
    BLOOM_LEVELS.forEach((level) => {
      const count = Math.max(0, Math.round(row.items[level] || 0));
      total += count;
      perLevel[level] += count;
    });
    return total;
  });
  return {
    totalTime: plan.rows.reduce((sum, row) => sum + Math.max(0, row.time), 0),
    allocated: rowItems.reduce((sum, value) => sum + value, 0),
    perLevel,
    rowItems,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildTosCsv(plan: TosPlan): string {
  const placement = placeItems(plan);
  const totals = tosTotals(plan);
  const header = [
    'No.',
    'Topic',
    'Competencies',
    'Time (minutes)',
    'Weight %',
    ...BLOOM_LEVELS.flatMap((level) => [`${level} NOI`, `${level} POI`]),
    'Total Items',
    'Type of Test',
  ];
  const lines = [header.map(csvCell).join(',')];
  plan.rows.forEach((row, index) => {
    lines.push(
      [
        index + 1,
        row.topic,
        row.competencies,
        row.time,
        rowWeightPercent(plan, row).toFixed(1),
        ...BLOOM_LEVELS.flatMap((level) => [row.items[level], placement[row.id]?.[level] ?? '']),
        totals.rowItems[index],
        row.type,
      ]
        .map(csvCell)
        .join(',')
    );
  });
  lines.push(
    [
      '',
      'TOTAL',
      '',
      totals.totalTime,
      '100.0',
      ...BLOOM_LEVELS.flatMap((level) => [totals.perLevel[level], '']),
      totals.allocated,
      '',
    ]
      .map(csvCell)
      .join(',')
  );
  return lines.join('\n');
}

export function buildTosPrintHtml(plan: TosPlan, exam: Exam, settings: AppSettings): string {
  const placement = placeItems(plan);
  const totals = tosTotals(plan);
  const levelHeads = BLOOM_LEVELS.map(
    (level) => `<th colspan="2" class="level">${escapeHtml(level)}</th>`
  ).join('');
  const subHeads = BLOOM_LEVELS.map(() => '<th class="sub">NOI</th><th class="sub">POI</th>').join('');

  const body = plan.rows
    .map((row, index) => {
      const cells = BLOOM_LEVELS.map(
        (level) =>
          `<td class="num">${Math.max(0, Math.round(row.items[level] || 0))}</td><td class="poi">${escapeHtml(
            placement[row.id]?.[level] ?? ''
          )}</td>`
      ).join('');
      return `<tr>
        <td class="num">${index + 1}</td>
        <td class="topic">${escapeHtml(row.topic)}</td>
        <td class="comp">${escapeHtml(row.competencies)}</td>
        <td class="num">${row.time || ''}</td>
        <td class="num">${rowWeightPercent(plan, row).toFixed(1)}%</td>
        ${cells}
        <td class="num strong">${totals.rowItems[index]}</td>
        <td class="type">${escapeHtml(row.type)}</td>
      </tr>`;
    })
    .join('');

  const totalCells = BLOOM_LEVELS.map(
    (level) => `<td class="num strong">${totals.perLevel[level]}</td><td></td>`
  ).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(`TOS ${plan.subject || exam.subject} ${plan.gradingPeriod}`)}</title>
<style>
  @page { size: letter landscape; margin: 0.38in; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Times New Roman', Georgia, serif; color: #111; font-size: 8.6pt; }
  .sheet { width: 100%; }
  .republic { text-align: center; line-height: 1.25; font-size: 9.5pt; }
  .republic .dept { font-weight: 700; }
  .school { font-weight: 700; font-size: 11pt; margin-top: 2px; }
  h1 { text-align: center; font-size: 12.5pt; letter-spacing: 0.12em; margin: 8px 0 6px; }
  .meta { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  .meta td { padding: 2px 4px; vertical-align: bottom; }
  .meta .label { width: 72px; font-weight: 700; }
  .meta .value { border-bottom: 1px solid #333; padding-left: 6px; }
  table.tos { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.tos th, table.tos td { border: 1px solid #444; padding: 3px 3px; vertical-align: middle; }
  table.tos thead th { background: #eee; font-size: 7.6pt; text-align: center; line-height: 1.15; }
  table.tos th.level { font-weight: 700; }
  table.tos th.sub { font-weight: 400; font-size: 7pt; }
  table.tos td { font-size: 7.8pt; }
  .num { text-align: center; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 700; }
  .topic { font-weight: 600; }
  .poi { text-align: center; font-size: 7.2pt; color: #222; }
  .comp { font-size: 7.2pt; line-height: 1.25; }
  .type { font-size: 7pt; text-align: center; }
  tfoot td { background: #f3f3f3; font-weight: 700; }
  .sign { display: flex; justify-content: space-between; margin-top: 26px; gap: 60px; }
  .sign div { flex: 1; text-align: center; }
  .sign .line { border-top: 1px solid #333; margin-top: 24px; padding-top: 3px; font-weight: 700; }
  .sign small { display: block; font-weight: 400; font-size: 7.5pt; }
  .note { margin-top: 6px; font-size: 7pt; color: #333; }
</style>
</head>
<body>
<div class="sheet">
  <div class="republic">
    <div>Republic of the Philippines</div>
    <div class="dept">Department of Education</div>
    <div>Region ${escapeHtml(settings.region || '')}</div>
    <div>Division of ${escapeHtml(settings.division || '')}</div>
    <div class="school">${escapeHtml(settings.schoolName || '')}</div>
  </div>
  <h1>TABLE OF SPECIFICATIONS</h1>
  <table class="meta">
    <tr>
      <td class="label">Subject:</td><td class="value">${escapeHtml(plan.subject)}</td>
      <td class="label">Grade:</td><td class="value">${escapeHtml(plan.grade)}</td>
      <td class="label">Grading Period:</td><td class="value">${escapeHtml(plan.gradingPeriod)}</td>
    </tr>
    <tr>
      <td class="label">Teacher:</td><td class="value">${escapeHtml(plan.teacher)}</td>
      <td class="label">School Year:</td><td class="value">${escapeHtml(plan.schoolYear)}</td>
      <td class="label">Total Items:</td><td class="value">${totalItemCount(exam)}</td>
    </tr>
  </table>
  <table class="tos">
    <colgroup>
      <col style="width:22px" />
      <col style="width:12%" />
      <col style="width:23%" />
      <col style="width:40px" />
      <col style="width:42px" />
      ${BLOOM_LEVELS.map(() => '<col style="width:6.6%" /><col style="width:5.2%" />').join('')}
      <col style="width:40px" />
      <col style="width:70px" />
    </colgroup>
    <thead>
      <tr>
        <th rowspan="2">#</th>
        <th rowspan="2">Topic</th>
        <th rowspan="2">Competencies</th>
        <th rowspan="2">Time<br/>Spent</th>
        <th rowspan="2">Weight<br/>%</th>
        ${levelHeads}
        <th rowspan="2">Total<br/>Items</th>
        <th rowspan="2">Type of<br/>Test</th>
      </tr>
      <tr>${subHeads}</tr>
    </thead>
    <tbody>${body}</tbody>
    <tfoot>
      <tr>
        <td colspan="3">TOTAL</td>
        <td class="num">${totals.totalTime}</td>
        <td class="num">100.0%</td>
        ${totalCells}
        <td class="num">${totals.allocated}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
  <div class="note">NOI = Number of Items · POI = Placement of Items. Weight is computed from the time spent per topic. Placements follow the table order.</div>
  <div class="sign">
    <div>
      <div class="line">${escapeHtml(plan.teacher || 'Teacher')}</div>
      <small>Prepared by</small>
    </div>
    <div>
      <div class="line">&nbsp;</div>
      <small>Checked by / School Head</small>
    </div>
  </div>
</div>
</body>
</html>`;
}
