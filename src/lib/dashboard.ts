import type { Exam, Learner, ScanResult } from '../types';
import { scannableItems, totalItemCount } from './sections';
import { summarize, type ClassSummary } from './results';

/** What the teacher should do next, shared by the desktop and tablet homes. */
export type NextKind = 'roster' | 'key' | 'review' | 'scores' | 'scan' | 'print' | 'results';

export type AttentionTone = 'rose' | 'amber' | 'blue' | 'green' | 'accent';

export interface ExamPulse {
  exam: Exam;
  learners: Learner[];
  results: ScanResult[];
  learnerCount: number;
  resultCount: number;
  reviewCount: number;
  /** Answer-key items filled, out of the scanned (multiple-choice) items. */
  keyFilled: number;
  keyTotal: number;
  itemCount: number;
  writtenCount: number;
  missingCount: number;
  incompleteCount: number;
  averagePercentage: number;
  passingRate: number;
  lastScanAt: string | null;
  summary: ClassSummary;
}

export interface AttentionItem {
  id: string;
  kind: NextKind;
  examId: string;
  examTitle: string;
  examCode: string;
  tone: AttentionTone;
  title: string;
  detail: string;
  action: string;
  count: number;
  priority: number;
}

export interface WorkspacePulse {
  exams: number;
  examsWithResults: number;
  learners: number;
  results: number;
  review: number;
  average: number;
  lastScanAt: string | null;
}

export interface CheckIn {
  result: ScanResult;
  exam: Exam;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function latestStamp(stamps: Array<string | undefined | null>): string | null {
  let latest: number | null = null;
  let iso: string | null = null;
  stamps.forEach((stamp) => {
    if (!stamp) return;
    const time = new Date(stamp).getTime();
    if (!Number.isFinite(time)) return;
    if (latest === null || time > latest) {
      latest = time;
      iso = stamp;
    }
  });
  return iso;
}

export function buildExamPulses(state: {
  exams: Exam[];
  learners: Learner[];
  results: ScanResult[];
}): ExamPulse[] {
  return state.exams.map((exam) => {
    const learners = state.learners.filter((learner) => learner.examId === exam.id);
    const results = state.results.filter((result) => result.examId === exam.id);
    const keyTotal = scannableItems(exam).length;
    const itemCount = totalItemCount(exam);
    const summary = summarize(exam, learners, results);
    return {
      exam,
      learners,
      results,
      learnerCount: learners.length,
      resultCount: results.length,
      reviewCount: results.filter((result) => result.needsReview).length,
      keyFilled: exam.answerKey.filter(Boolean).length,
      keyTotal,
      itemCount,
      writtenCount: itemCount - keyTotal,
      missingCount: summary.missingCount,
      incompleteCount: summary.incompleteCount,
      averagePercentage: summary.averagePercentage,
      passingRate: summary.passingRate,
      lastScanAt: latestStamp(results.map((result) => result.scannedAt)),
      summary,
    };
  });
}

export function workspacePulse(pulses: ExamPulse[]): WorkspacePulse {
  const results = pulses.flatMap((pulse) => pulse.results);
  const average = results.length
    ? Math.round((results.reduce((sum, result) => sum + result.percentage, 0) / results.length) * 10) / 10
    : 0;
  return {
    exams: pulses.length,
    examsWithResults: pulses.filter((pulse) => pulse.resultCount > 0).length,
    learners: pulses.reduce((sum, pulse) => sum + pulse.learnerCount, 0),
    results: results.length,
    review: pulses.reduce((sum, pulse) => sum + pulse.reviewCount, 0),
    average,
    lastScanAt: latestStamp(results.map((result) => result.scannedAt)),
  };
}

export function buildAttention(
  pulses: ExamPulse[],
  options: { allowPrint?: boolean; allowScores?: boolean } = {}
): AttentionItem[] {
  const { allowPrint = true, allowScores = true } = options;
  const items: AttentionItem[] = [];

  pulses.forEach((pulse) => {
    const { exam } = pulse;
    const base = {
      examId: exam.id,
      examTitle: exam.title || 'Untitled exam',
      examCode: exam.code,
    };

    if (pulse.learnerCount === 0) {
      items.push({
        ...base,
        id: `${exam.id}:roster`,
        kind: 'roster',
        tone: 'rose',
        title: 'Roster is empty',
        detail: `${exam.code} · Add the class list before printing sheets.`,
        action: 'Add roster',
        count: 0,
        priority: 10,
      });
    }

    const keyBlank = pulse.keyTotal - pulse.keyFilled;
    if (pulse.keyTotal > 0 && keyBlank > 0) {
      items.push({
        ...base,
        id: `${exam.id}:key`,
        kind: 'key',
        tone: 'amber',
        title: `${plural(keyBlank, 'answer-key item')} still blank`,
        detail: `${exam.code} · Complete the key so papers score correctly.`,
        action: 'Finish key',
        count: keyBlank,
        priority: 20,
      });
    }

    if (pulse.reviewCount > 0) {
      items.push({
        ...base,
        id: `${exam.id}:review`,
        tone: 'amber',
        kind: 'review',
        title: `${plural(pulse.reviewCount, 'paper')} waiting for review`,
        detail: `${exam.code} · Scanner flags need a quick human confirm.`,
        action: 'Review papers',
        count: pulse.reviewCount,
        priority: 30,
      });
    }

    if (allowScores && pulse.incompleteCount > 0) {
      items.push({
        ...base,
        id: `${exam.id}:scores`,
        kind: 'scores',
        tone: 'blue',
        title: `${plural(pulse.incompleteCount, 'sheet')} missing written scores`,
        detail: `${exam.code} · Hand-scored items are not filled in yet.`,
        action: 'Enter scores',
        count: pulse.incompleteCount,
        priority: 40,
      });
    }

    if (pulse.resultCount > 0 && pulse.missingCount > 0) {
      items.push({
        ...base,
        id: `${exam.id}:scan`,
        kind: 'scan',
        tone: 'blue',
        title: `${plural(pulse.missingCount, 'learner')} not scanned`,
        detail: `${exam.code} · ${pulse.resultCount} of ${pulse.learnerCount} sheets checked.`,
        action: 'Scan papers',
        count: pulse.missingCount,
        priority: 50,
      });
    }

    const firstScanReady =
      pulse.learnerCount > 0 &&
      pulse.resultCount === 0 &&
      pulse.keyTotal > 0 &&
      pulse.keyFilled >= pulse.keyTotal;

    if (firstScanReady) {
      if (allowPrint) {
        items.push({
          ...base,
          id: `${exam.id}:print`,
          kind: 'print',
          tone: 'accent',
          title: 'Ready for its first scan',
          detail: `${exam.code} · Roster and key are complete. Print, then scan.`,
          action: 'Print sheets',
          count: pulse.learnerCount,
          priority: 60,
        });
      } else {
        items.push({
          ...base,
          id: `${exam.id}:scan-first`,
          kind: 'scan',
          tone: 'green',
          title: 'Ready for its first scan',
          detail: `${exam.code} · Roster and key are complete. Scan the stack.`,
          action: 'Scan papers',
          count: pulse.learnerCount,
          priority: 60,
        });
      }
    }
  });

  return items.sort((a, b) => a.priority - b.priority);
}

export function nextStepFor(
  pulse: ExamPulse,
  options: { allowPrint?: boolean; allowScores?: boolean } = {}
): { kind: NextKind; label: string } {
  const { allowPrint = true, allowScores = true } = options;
  if (pulse.learnerCount === 0) return { kind: 'roster', label: 'Add roster' };
  if (pulse.keyTotal > 0 && pulse.keyFilled < pulse.keyTotal) return { kind: 'key', label: 'Finish key' };
  if (pulse.resultCount === 0) {
    return allowPrint ? { kind: 'print', label: 'Print sheets' } : { kind: 'scan', label: 'Scan papers' };
  }
  if (pulse.reviewCount > 0) return { kind: 'review', label: 'Review papers' };
  if (allowScores && pulse.incompleteCount > 0) return { kind: 'scores', label: 'Enter scores' };
  if (pulse.missingCount > 0) return { kind: 'scan', label: 'Scan papers' };
  return { kind: 'results', label: 'View results' };
}

export function recentCheckIns(pulses: ExamPulse[], limit = 5): CheckIn[] {
  return pulses
    .flatMap((pulse) => pulse.results.map((result) => ({ result, exam: pulse.exam })))
    .sort((a, b) => new Date(b.result.scannedAt).getTime() - new Date(a.result.scannedAt).getTime())
    .slice(0, limit);
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function longDate(date = new Date()): string {
  return date.toLocaleDateString('en-PH', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return 'no activity yet';
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  const diff = Date.now() - time;
  if (diff < 45_000) return 'just now';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

/** "RM" from "Reyes, Maria" or "Maria Reyes". Used by the activity list. */
export function initials(name: string): string {
  const parts = name
    .replace(/,/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
