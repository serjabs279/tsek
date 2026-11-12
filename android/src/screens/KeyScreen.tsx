import { useMemo, useState } from 'react';
import { CheckCircle2, ListChecks, PenLine, Shuffle, Wand2, X } from 'lucide-react';
import type { Exam } from '@shared/types';
import { SECTION_LABELS } from '@shared/types';
import { useApp } from '@shared/store/AppStore';
import { materializeItems, type MaterialItem } from '@shared/lib/sections';
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

export function KeyScreen({ exam, onNavigate }: { exam: Exam; onNavigate: (tab: ExamTab) => void }) {
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
  const complete = scannable.length > 0 && filled === scannable.length;
  const hasTrueFalse = scannable.some((item) => item.choices.length === 2);

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
    }
    updateExam(exam.id, { answerKey: key });
    setQuick('');
    toast('Answer key applied.', 'success');
  };

  const randomize = () => {
    const key = scannable.map((item) => item.choices[Math.floor(Math.random() * item.choices.length)]);
    updateExam(exam.id, { answerKey: key });
    toast('Answer key randomized.', 'success');
  };

  return (
    <>
      <ScreenHead
        eyebrow={`${exam.code} · Answer key`}
        title="Answer key"
        subtitle="Only scanned parts need a key. Written parts are scored on the desktop app."
        actions={
          <Badge tone={complete ? 'green' : scannable.length === 0 ? 'neutral' : 'amber'}>
            {complete ? <CheckCircle2 size={12} /> : null} {filled}/{scannable.length}
          </Badge>
        }
      />

      <div className="m-stack">
        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Quick entry</h2>
              <p>Type or paste the key as one run of choices, in item order.</p>
            </div>
            <Wand2 size={19} className="muted" />
          </div>
          <div className="m-card__body">
            <FieldBlock
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
            </FieldBlock>
            <div className="m-row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
              <span className="m-tiny">
                {(quick.toUpperCase().match(/[A-ETF]/g) ?? []).length} choices typed
              </span>
              <button className="btn btn--primary btn--sm" onClick={applyQuick} disabled={scannable.length === 0}>
                Apply to key
              </button>
            </div>
            <div className="m-row" style={{ marginTop: 10 }}>
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirmRandom(true)} disabled={scannable.length === 0}>
                <Shuffle size={14} /> Randomize
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirmClear(true)} disabled={scannable.length === 0}>
                <X size={14} /> Clear
              </button>
            </div>
          </div>
        </section>

        {scannable.length === 0 ? (
          <div className="m-note m-note--warn">
            This test has no scanned parts, so there is no bubble key to fill. Every item is a
            written part; enter those scores on the desktop app.
          </div>
        ) : (
          <section className="m-card">
            <div className="m-card__head">
              <div>
                <h2>Key by part</h2>
                <p>Tap a choice to set the key. Tap the same choice again to clear it.</p>
              </div>
              <ListChecks size={19} className="muted" />
            </div>
            <div className="m-card__body">
              <div className="m-stack">
                {groups.map((group) => (
                  <div key={group.id}>
                    <div className="m-row m-row--between" style={{ marginBottom: 7 }}>
                      <div>
                        <strong style={{ fontSize: '0.86rem' }}>
                          Part {roman(group.sectionIndex)} · {group.title}
                        </strong>
                        <div className="m-tiny">
                          Items {group.start}–{group.end} · {group.items.length} × {points(group.pointsPerItem)} pt
                        </div>
                      </div>
                      <Badge tone={group.choices.length === 2 ? 'blue' : 'neutral'}>
                        {group.choices.length === 2 ? 'T / F' : `A–${group.choices[group.choices.length - 1]}`}
                      </Badge>
                    </div>
                    <div className="m-keygrid">
                      {group.items.map((item) => {
                        const answer = exam.answerKey[item.answerIndex ?? -1] ?? '';
                        return (
                          <div className={`m-keyitem ${answer ? '' : 'is-empty'}`} key={item.manualKey ?? item.answerIndex}>
                            <div className="m-keyitem__head">
                              <span>{String(item.number).padStart(2, '0')}</span>
                              {answer && (
                                <button
                                  className="btn btn--ghost btn--sm"
                                  style={{ minHeight: 0, padding: '0 4px', fontSize: '0.62rem' }}
                                  onClick={() => setItem(item.answerIndex, '')}
                                >
                                  clear
                                </button>
                              )}
                            </div>
                            <div className="m-keyitem__choices">
                              {group.choices.map((choice) => (
                                <button
                                  key={choice}
                                  className={`m-keychoice ${answer === choice ? 'is-key' : ''}`}
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
                  </div>
                ))}
              </div>
              <div className="m-note" style={{ marginTop: 14 }}>
                <strong>{filled} of {scannable.length} scanned items filled.</strong>{' '}
                {complete
                  ? 'The key is complete. Print the sheets from the desktop app, then scan them here.'
                  : 'Sheets can be printed before the key is complete, but every blank key item will score as wrong.'}
              </div>
              <button className="btn btn--soft btn--block" style={{ marginTop: 10 }} onClick={() => onNavigate('scan')}>
                Go to scanning
              </button>
            </div>
          </section>
        )}

        {writtenGroups.length > 0 && (
          <section className="m-card">
            <div className="m-card__head">
              <div>
                <h2>Written parts</h2>
                <p>These add to each learner's total and to the item analysis.</p>
              </div>
              <Badge tone="amber"><PenLine size={12} /> desktop</Badge>
            </div>
            <div className="m-card__body">
              {writtenGroups.map((group) => (
                <div className="m-row m-row--between" key={group.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                  <div>
                    <strong style={{ fontSize: '0.84rem' }}>Part {roman(group.sectionIndex)} · {group.title}</strong>
                    <div className="m-tiny">
                      Items {group.start}–{group.end} · {group.items.length} × {points(group.pointsPerItem)} ={' '}
                      {points(group.items.length * group.pointsPerItem)} pts
                    </div>
                  </div>
                  <span className="m-tiny">{SECTION_LABELS[group.items[0]?.sectionType ?? 'ESSAY'].short}</span>
                </div>
              ))}
              <div className="m-note" style={{ marginTop: 10 }}>
                Written scores are entered on the desktop app. Scanned scores still calculate and
                print on this tablet; a scanned-only total is shown until the written part is filled in.
              </div>
            </div>
          </section>
        )}
      </div>

      <TypeToConfirm
        open={confirmClear}
        title="Clear the scanned answer key?"
        message={`All ${scannable.length} scanned items will be blank. Written parts are untouched. Existing checked sheets keep their answers but are re-scored against the empty key.`}
        phrase="CLEAR"
        confirmLabel="Clear key"
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          updateExam(exam.id, { answerKey: Array.from({ length: scannable.length }, () => '') });
          toast('Answer key cleared.', 'danger');
        }}
      />

      <TypeToConfirm
        open={confirmRandom}
        title="Randomize the answer key?"
        message={`This replaces all ${scannable.length} scanned answers with random choices. Only use it for practice sheets, never a real exam.`}
        phrase="RANDOMIZE"
        confirmLabel="Randomize key"
        onClose={() => setConfirmRandom(false)}
        onConfirm={randomize}
      />
    </>
  );
}
