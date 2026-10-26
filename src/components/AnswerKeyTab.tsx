import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  ListChecks,
  PenLine,
  Printer,
  Shuffle,
  Wand2,
  X,
} from 'lucide-react';
import type { Exam } from '../types';
import { SECTION_LABELS } from '../types';
import { useApp } from '../store/AppStore';
import { copyText } from '../lib/download';
import { materializeItems, type MaterialItem } from '../lib/sections';
import { Badge, ConfirmDialog, Field } from './ui';
import type { WorkspaceTab } from './ExamWorkspace';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function roman(index: number): string {
  return ROMAN[index] ?? String(index + 1);
}

function points(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

interface KeyGroup {
  id: string;
  title: string;
  sectionIndex: number;
  start: number;
  end: number;
  choices: string[];
  pointsPerItem: number;
  items: MaterialItem[];
}

function groupByPart(items: MaterialItem[]): KeyGroup[] {
  const groups: KeyGroup[] = [];
  items.forEach((item) => {
    const last = groups[groups.length - 1];
    if (last && last.id === item.sectionId) {
      last.items.push(item);
      last.end = item.number;
      return;
    }
    groups.push({
      id: item.sectionId,
      title: item.sectionTitle,
      sectionIndex: item.sectionIndex,
      start: item.number,
      end: item.number,
      choices: item.choices,
      pointsPerItem: item.points,
      items: [item],
    });
  });
  return groups;
}

export function AnswerKeyTab({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: WorkspaceTab) => void }) {
  const { updateExam, toast } = useApp();
  const [quick, setQuick] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRandom, setConfirmRandom] = useState(false);

  const items = useMemo(() => materializeItems(exam), [exam]);
  const scannable = useMemo(() => items.filter((item) => item.scannable), [items]);
  const written = useMemo(() => items.filter((item) => !item.scannable), [items]);
  const groups = useMemo(() => groupByPart(scannable), [scannable]);
  const writtenGroups = useMemo(() => groupByPart(written), [written]);

  const filled = exam.answerKey.filter(Boolean).length;
  const complete = filled === scannable.length && scannable.length > 0;
  const hasTrueFalse = scannable.some((item) => item.choices.length === 2);
  const mixedChoices = new Set(scannable.map((item) => item.choices.join(''))).size > 1;

  const setItem = (answerIndex: number | null, choice: string) => {
    if (answerIndex === null) return;
    const key = [...exam.answerKey];
    key[answerIndex] = key[answerIndex] === choice ? '' : choice;
    updateExam(exam.id, { answerKey: key });
  };

  const applyQuick = () => {
    if (scannable.length === 0) return;
    const tokens = quick.toUpperCase().match(/[A-ETF]/g) ?? [];
    let cursor = 0;
    const key = scannable.map((item) => {
      while (cursor < tokens.length && !item.choices.includes(tokens[cursor])) cursor += 1;
      return cursor < tokens.length ? tokens[cursor++] : '';
    });
    const read = key.filter(Boolean).length;
    if (read === 0) {
      toast(
        hasTrueFalse
          ? 'No valid choices were found. Use A–E for multiple choice and T/F for True or False.'
          : 'No valid choices were found. Use A, B, C, D (and E for five-choice items).',
        'danger'
      );
      return;
    }
    if (read < scannable.length) {
      toast(`Only ${read} choices were read for ${scannable.length} scanned items. The rest were left blank.`, 'default');
    } else if (tokens.length > read) {
      toast(`${tokens.length - read} extra choice${tokens.length - read === 1 ? '' : 's'} beyond the last scanned item were ignored.`, 'default');
    }
    updateExam(exam.id, { answerKey: key });
    setQuick('');
  };

  const randomize = () => {
    const key = scannable.map((item) => item.choices[Math.floor(Math.random() * item.choices.length)]);
    updateExam(exam.id, { answerKey: key });
    setConfirmRandom(false);
    toast('Answer key randomized.', 'success');
  };

  const copyKey = async () => {
    const lines: string[] = [];
    groups.forEach((group) => {
      lines.push(`${group.title} (items ${group.start}–${group.end})`);
      group.items.forEach((item) => {
        lines.push(`${item.number}. ${exam.answerKey[item.answerIndex ?? -1] || '—'}`);
      });
      lines.push('');
    });
    if (written.length > 0) {
      lines.push(`Written parts (scored by hand): ${written.length} items`);
    }
    const ok = await copyText(lines.join('\n').trim());
    toast(ok ? 'Answer key copied.' : 'Copy is not available in this browser.', ok ? 'success' : 'danger');
  };

  const scannedLabel = `${scannable.length} scanned item${scannable.length === 1 ? '' : 's'}`;
  const writtenLabel = `${written.length} written item${written.length === 1 ? '' : 's'}`;

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div className="card-head__title">
            <h3>Answer key</h3>
            <p>Only the scanned parts need a key. Written parts are scored per learner.</p>
          </div>
          <Badge tone={complete ? 'green' : scannable.length === 0 ? 'neutral' : 'amber'}>
            {complete ? <CheckCircle2 size={12} /> : null} {filled}/{scannable.length} filled
          </Badge>
        </div>
        <div className="card-body">
          <div className="key-toolbar">
            <div className="key-legend">
              <ListChecks size={15} />
              <span>
                {scannedLabel}
                {written.length > 0 ? ` · ${writtenLabel}` : ''}
                {scannable.length > 0 ? ` · ${mixedChoices ? 'mixed bubble sets' : scannable[0].choices.join(' ')}` : ''}
              </span>
            </div>
            <div className="row row--wrap" style={{ gap: 6 }}>
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirmRandom(true)} disabled={scannable.length === 0}>
                <Shuffle size={14} /> Randomize
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirmClear(true)} disabled={scannable.length === 0}>
                <X size={14} /> Clear
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => void copyKey()} disabled={scannable.length === 0}>
                <Copy size={14} /> Copy
              </button>
              <button className="btn btn--primary btn--sm" onClick={() => onNavigate('sheets')} disabled={!complete}>
                <Printer size={14} /> Print sheets
              </button>
            </div>
          </div>

          {scannable.length === 0 && (
            <div className="card-note card-note--warn">
              This test has no scanned parts, so there is no key to fill. Every item is scored directly in the Scores tab.
            </div>
          )}

          <div className="key-groups">
            {groups.map((group) => (
              <section className="key-group" key={group.id}>
                <div className="key-group__head">
                  <div className="key-group__title">
                    <strong>Part {roman(group.sectionIndex)} · {group.title}</strong>
                    <span>
                      Items {group.start}–{group.end} · {group.items.length} × {points(group.pointsPerItem)} pt
                    </span>
                  </div>
                  <Badge tone={group.choices.length === 2 ? 'blue' : 'neutral'}>
                    {group.choices.length === 2 ? 'T / F' : `A–${group.choices[group.choices.length - 1]}`}
                  </Badge>
                </div>
                <div className="key-grid">
                  {group.items.map((item) => {
                    const answer = exam.answerKey[item.answerIndex ?? -1] ?? '';
                    return (
                      <div className={`key-item ${answer ? '' : 'is-empty'}`} key={item.manualKey ?? item.answerIndex}>
                        <div className="key-item__head">
                          <span className="key-item__num">{String(item.number).padStart(2, '0')}</span>
                          {answer && (
                            <button
                              className="key-item__clear"
                              onClick={() => setItem(item.answerIndex, '')}
                              aria-label={`Clear item ${item.number}`}
                            >
                              clear
                            </button>
                          )}
                        </div>
                        <div className={`choice-grid ${group.choices.length === 2 ? 'choice-grid--tf' : ''}`}>
                          {group.choices.map((choice) => (
                            <button
                              key={choice}
                              className={`choice-btn ${answer === choice ? 'is-active' : ''}`}
                              onClick={() => setItem(item.answerIndex, choice)}
                              aria-pressed={answer === choice}
                            >
                              {choice}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>

      {writtenGroups.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Written parts</h3>
              <p>These items have no bubbles. Enter each learner’s score in the Scores tab; the points add to the scanned score.</p>
            </div>
            <Badge tone="amber"><PenLine size={12} /> scored by hand</Badge>
          </div>
          <div className="card-body">
            <div className="written-parts">
              {writtenGroups.map((group) => (
                <button className="written-part" key={group.id} onClick={() => onNavigate('scores')}>
                  <div>
                    <strong>Part {roman(group.sectionIndex)} · {group.title}</strong>
                    <span>
                      Items {group.start}–{group.end} · {group.items.length} × {points(group.pointsPerItem)} pt ·{' '}
                      {points(group.items.length * group.pointsPerItem)} pts possible
                    </span>
                  </div>
                  <span className="written-part__action">
                    Enter scores <ArrowRight size={14} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="split-grid">
        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Quick entry</h3>
              <p>Type or paste the key as one run of choices, in item order.</p>
            </div>
            <Wand2 size={18} className="muted" />
          </div>
          <div className="card-body">
            <Field
              label="Key string"
              hint="Spaces, commas, and item numbers are ignored. Use T/F for True or False parts."
            >
              <textarea
                className="textarea input--mono"
                rows={3}
                value={quick}
                onChange={(event) => setQuick(event.target.value)}
                placeholder={hasTrueFalse ? 'ABCD T F T T ABCD…' : 'ABCDDABCADCBAB…'}
                disabled={scannable.length === 0}
              />
            </Field>
            <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
              <span className="tiny faint">
                {(quick.toUpperCase().match(/[A-ETF]/g) ?? []).length} choices typed · {SECTION_LABELS.MCQ.short} uses A–E, {SECTION_LABELS.TRUE_FALSE.short} uses T/F
              </span>
              <button className="btn btn--primary btn--sm" onClick={applyQuick} disabled={scannable.length === 0}>
                Apply to key
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Key summary</h3>
              <p>Handy for a quick visual check against your answer sheet.</p>
            </div>
          </div>
          <div className="card-body">
            {groups.length > 0 ? (
              <div className="key-summary-groups">
                {groups.map((group) => (
                  <div key={group.id}>
                    <span className="tiny faint">Part {roman(group.sectionIndex)}</span>
                    <div className="key-summary">
                      {group.items
                        .map((item) => `${item.number}.${exam.answerKey[item.answerIndex ?? -1] || '—'}`)
                        .join(' ')}
                    </div>
                  </div>
                ))}
                {written.length > 0 && (
                  <p className="tiny faint">
                    {writtenLabel} are not in the key; their scores are typed per learner.
                  </p>
                )}
              </div>
            ) : (
              <p className="tiny faint">No scanned items to summarize.</p>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear the scanned answer key?"
        message={`All ${scannable.length} scanned items will be blank. Written parts are untouched. Checked sheets stay in the results, but their scores are recalculated when you enter a new key.`}
        confirmLabel="Clear key"
        danger
        onConfirm={() => {
          updateExam(exam.id, { answerKey: Array.from({ length: scannable.length }, () => '') });
          toast('Answer key cleared.', 'danger');
        }}
        onClose={() => setConfirmClear(false)}
      />

      <ConfirmDialog
        open={confirmRandom}
        title="Randomize the answer key?"
        message={`This replaces the ${scannable.length} scanned answers with random choices from each part’s bubbles. Only use this for practice sheets, not a real exam.`}
        confirmLabel="Randomize key"
        onConfirm={randomize}
        onClose={() => setConfirmRandom(false)}
      />
    </div>
  );
}
