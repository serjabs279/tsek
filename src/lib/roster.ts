import type { Learner, LearnerStatus } from '../types';

export interface ParsedRoster {
  learners: Array<{ lrn: string; name: string; sex?: 'Male' | 'Female'; status: LearnerStatus }>;
  errors: string[];
  ignored: number;
}

function splitCSVLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if ((ch === ',' || ch === '\t' || ch === ';') && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function looksLikeLRN(value: string): boolean {
  return /^\d{8,14}$/.test(value.replace(/[\s-]/g, ''));
}

/**
 * Flexible roster parser. Accepts CSV/TSV from Excel, Google Sheets, or a
 * pasted list. Detects the LRN column instead of assuming a fixed order.
 */
export function parseRosterText(text: string): ParsedRoster {
  const errors: string[] = [];
  const learners: ParsedRoster['learners'] = [];
  const seen = new Set<string>();
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { learners, errors: ['Nothing to import.'], ignored: 0 };
  }

  let start = 0;
  let lrnIndex = -1;
  let nameIndex = -1;
  let sexIndex = -1;
  let statusIndex = -1;

  const header = splitCSVLine(lines[0]).map((cell) => cell.toLowerCase());
  const hasHeader = header.some((cell) => cell.includes('lrn') || cell.includes('learner') || cell.includes('name'));
  if (hasHeader) {
    lrnIndex = header.findIndex((cell) => cell.includes('lrn') || cell.includes('learner reference'));
    nameIndex = header.findIndex((cell) => cell.includes('name') || cell.includes('learner'));
    sexIndex = header.findIndex((cell) => cell === 'sex' || cell === 'gender');
    statusIndex = header.findIndex((cell) => cell === 'status' || cell.includes('enrolment') || cell.includes('enrollment'));
    if (nameIndex === lrnIndex) {
      nameIndex = header.findIndex((cell, index) => index !== lrnIndex && (cell.includes('name') || cell.includes('learner')));
    }
    start = 1;
  }

  for (let i = start; i < lines.length; i += 1) {
    const cells = splitCSVLine(lines[i]);
    let lrn = '';
    let name = '';
    let sex: 'Male' | 'Female' | undefined;
    let status: LearnerStatus = 'Active';

    if (lrnIndex >= 0) {
      lrn = (cells[lrnIndex] || '').replace(/[\s-]/g, '');
    }
    if (nameIndex >= 0) {
      name = cells[nameIndex] || '';
    }

    if (!lrn) {
      const found = cells.findIndex((cell) => looksLikeLRN(cell));
      if (found >= 0) lrn = cells[found].replace(/[\s-]/g, '');
    }

    if (!name) {
      const nameParts = cells.filter((cell, index) => index !== lrnIndex && !looksLikeLRN(cell));
      name = nameParts
        .filter((cell) => !/^(male|female|m|f|active|dropped|transferred)$/i.test(cell))
        .join(', ')
        .trim();
    }

    if (sexIndex >= 0 && cells[sexIndex]) {
      const raw = cells[sexIndex].toLowerCase();
      if (raw.startsWith('m')) sex = 'Male';
      if (raw.startsWith('f')) sex = 'Female';
    }
    if (statusIndex >= 0 && cells[statusIndex]) {
      const raw = cells[statusIndex].toLowerCase();
      if (raw.includes('drop')) status = 'Dropped';
      else if (raw.includes('transfer')) status = 'Transferred';
    }

    if (!lrn && !name) {
      continue;
    }
    if (!name) {
      errors.push(`Line ${i + 1}: no learner name found.`);
      continue;
    }
    if (!/^\d{12}$/.test(lrn)) {
      errors.push(`Line ${i + 1} (${name}): LRN must be exactly 12 digits.`);
      continue;
    }
    if (seen.has(lrn)) {
      errors.push(`Line ${i + 1} (${name}): duplicate LRN ${lrn}.`);
      continue;
    }

    seen.add(lrn);
    learners.push({ lrn, name, sex, status });
  }

  return {
    learners,
    errors: errors.slice(0, 12),
    ignored: Math.max(0, lines.length - start - learners.length - errors.length),
  };
}

export function rosterToCSV(learners: Learner[]): string {
  const rows = [
    ['LRN', 'Name', 'Sex', 'Status'],
    ...learners.map((learner) => [learner.lrn, learner.name, learner.sex ?? '', learner.status]),
  ];
  return rows
    .map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
    .join('\r\n');
}
