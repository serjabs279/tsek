import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ClipboardPaste, PencilLine, Plus, Trash2, UploadCloud, Users } from 'lucide-react';
import type { Exam, Learner, LearnerStatus } from '@shared/types';
import { useApp } from '@shared/store/AppStore';
import { parseRosterText } from '@shared/lib/roster';
import { readFileAsText } from '@shared/lib/download';
import { Badge } from '@shared/components/ui';
import { EmptyBlock, FieldBlock, MobileSheet, ScreenHead, TypeToConfirm } from '../components/Common';

export function RosterScreen({ exam }: { exam: Exam }) {
  const { state, addLearners, updateLearner, deleteLearner, toast } = useApp();
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);
  const scannedLrns = new Set(results.map((result) => result.lrn));

  const [text, setText] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ lrn: '', name: '', sex: '' as '' | 'Male' | 'Female' });
  const [editing, setEditing] = useState<Learner | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Learner | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (text.trim() ? parseRosterText(text) : null), [text]);
  const existing = new Set(learners.map((learner) => learner.lrn));
  const newRows = parsed?.learners.filter((row) => !existing.has(row.lrn)) ?? [];

  const importText = () => {
    if (!text.trim()) {
      toast('Paste a class list first, or choose a CSV file.', 'danger');
      return;
    }
    const result = parseRosterText(text);
    if (result.learners.length === 0) {
      toast(result.errors[0] ?? 'No usable learners were found in that list.', 'danger');
      return;
    }
    const { added, duplicates } = addLearners(exam.id, result.learners);
    setText('');
    toast(
      `${added} learner${added === 1 ? '' : 's'} added${duplicates.length ? ` · ${duplicates.length} already in the roster` : ''}.`,
      'success'
    );
  };

  const importFile = async (file: File | null) => {
    if (!file) return;
    try {
      const content = await readFileAsText(file);
      setText(content);
      toast(`${file.name} loaded. Check the preview, then import.`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The file could not be read.', 'danger');
    }
  };

  const addManual = () => {
    const lrn = manual.lrn.replace(/[\s-]/g, '');
    if (!/^\d{12}$/.test(lrn)) {
      toast('The LRN must be exactly 12 digits.', 'danger');
      return;
    }
    if (!manual.name.trim()) {
      toast('Enter the learner name.', 'danger');
      return;
    }
    const { added, duplicates } = addLearners(exam.id, [
      { lrn, name: manual.name.trim(), sex: manual.sex || undefined, status: 'Active' },
    ]);
    if (!added) {
      toast(duplicates.length ? 'That LRN is already in the roster.' : 'Learner was not added.', 'danger');
      return;
    }
    setManual({ lrn: '', name: '', sex: '' });
    setManualOpen(false);
    toast('Learner added.', 'success');
  };

  return (
    <>
      <ScreenHead
        eyebrow={`${exam.code} · Roster`}
        title="Class roster"
        subtitle="The LRN is the identity printed in the sheet QR. Names are printed for the teacher."
        actions={
          <button className="btn btn--primary btn--sm" onClick={() => setManualOpen(true)}>
            <Plus size={15} /> Add learner
          </button>
        }
      />

      <div className="m-stack">
        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Learners</h2>
              <p>{learners.length} on this exam · {results.length} sheet{results.length === 1 ? '' : 's'} checked</p>
            </div>
            <Badge tone={learners.length ? 'green' : 'amber'}>{learners.length}</Badge>
          </div>
          <div className="m-card__body" style={{ paddingTop: 4 }}>
            {learners.length === 0 ? (
              <EmptyBlock
                icon={<Users size={24} />}
                title="No learners yet"
                message="Paste the class list from Excel or Google Sheets below, choose a CSV file, or add one learner at a time."
                action={
                  <button className="btn btn--soft" onClick={() => setManualOpen(true)}>
                    <Plus size={15} /> Add one learner
                  </button>
                }
              />
            ) : (
              <div>
                {learners.map((learner) => (
                  <div className="m-person" key={learner.id}>
                    <div className="m-person__main">
                      <div className="m-person__name">{learner.name}</div>
                      <div className="m-person__meta">
                        {learner.lrn}
                        {learner.sex ? ` · ${learner.sex}` : ''}
                        {learner.status !== 'Active' ? ` · ${learner.status}` : ''}
                      </div>
                    </div>
                    {scannedLrns.has(learner.lrn) ? (
                      <span className="pill pill--green"><CheckCircle2 size={11} /> scanned</span>
                    ) : (
                      <span className="pill pill--neutral">pending</span>
                    )}
                    <button className="m-iconbtn" onClick={() => setEditing(learner)} aria-label={`Edit ${learner.name}`}>
                      <PencilLine size={15} />
                    </button>
                    <button
                      className="m-iconbtn m-iconbtn--danger"
                      onClick={() => setPendingDelete(learner)}
                      aria-label={`Remove ${learner.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Paste a class list</h2>
              <p>CSV, TSV, or lines copied from Excel. The LRN column is detected automatically.</p>
            </div>
            <ClipboardPaste size={19} className="muted" />
          </div>
          <div className="m-card__body">
            <FieldBlock label="Roster text" hint="Columns may be LRN, Name, Sex, Status — any order, with or without a header.">
              <textarea
                className="textarea"
                rows={7}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={'LRN,Name,Sex\n136001230001,Aguilar, Maria Sofia,Female\n136001230002,Bautista, John Paulo,Male'}
              />
            </FieldBlock>
            <div className="m-row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
              <button className="btn btn--ghost btn--sm" onClick={() => fileRef.current?.click()}>
                <UploadCloud size={15} /> Choose CSV
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                hidden
                onChange={(event) => {
                  void importFile(event.target.files?.[0] ?? null);
                  event.target.value = '';
                }}
              />
              <button className="btn btn--primary btn--sm" onClick={importText} disabled={!parsed?.learners.length}>
                <Plus size={15} /> Import {newRows.length || ''}
              </button>
            </div>

            {parsed && (
              <div className="m-note" style={{ marginTop: 10 }}>
                <div className="m-row m-row--between">
                  <span>
                    <strong>{parsed.learners.length}</strong> readable · <strong>{newRows.length}</strong> new
                    {parsed.ignored > 0 ? ` · ${parsed.ignored} skipped` : ''}
                  </span>
                  <span className="m-tiny">Preview</span>
                </div>
                {parsed.learners.slice(0, 6).map((row) => (
                  <div className="m-row m-row--between" key={row.lrn} style={{ paddingTop: 5 }}>
                    <span className="m-person__meta">{row.lrn}</span>
                    <span className="m-tiny" style={{ flex: 1, color: 'var(--ink-2)', marginLeft: 8 }}>{row.name}</span>
                    {existing.has(row.lrn) ? <Badge tone="amber">in roster</Badge> : <Badge tone="green">new</Badge>}
                  </div>
                ))}
              </div>
            )}
            {parsed && parsed.errors.length > 0 && (
              <div className="m-note m-note--danger" style={{ marginTop: 8 }}>
                {parsed.errors.map((error) => <div key={error}>{error}</div>)}
              </div>
            )}
          </div>
        </section>

        <div className="m-note">
          A scanned sheet is matched by the LRN in its QR. If a learner is missing from the roster,
          their paper stays in the scan tray for manual assignment instead of being dropped.
        </div>
      </div>

      <MobileSheet
        open={manualOpen}
        title="Add one learner"
        subtitle="For late enrollees and corrections"
        onClose={() => setManualOpen(false)}
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setManualOpen(false)}>Cancel</button>
            <button className="btn btn--primary" onClick={addManual}>
              <Plus size={16} /> Add learner
            </button>
          </>
        }
      >
        <div className="m-form">
          <FieldBlock label="LRN" wide hint="Exactly 12 digits; spaces and dashes are removed.">
            <input
              className="input input--mono"
              inputMode="numeric"
              value={manual.lrn}
              onChange={(event) => setManual((prev) => ({ ...prev, lrn: event.target.value }))}
              placeholder="12 digits"
            />
          </FieldBlock>
          <FieldBlock label="Name" wide>
            <input
              className="input"
              value={manual.name}
              onChange={(event) => setManual((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Surname, First Name"
            />
          </FieldBlock>
          <FieldBlock label="Sex">
            <select
              className="select"
              value={manual.sex}
              onChange={(event) => setManual((prev) => ({ ...prev, sex: event.target.value as '' | 'Male' | 'Female' }))}
            >
              <option value="">Not specified</option>
              <option>Male</option>
              <option>Female</option>
            </select>
          </FieldBlock>
        </div>
      </MobileSheet>

      <EditLearnerSheet
        learner={editing}
        onClose={() => setEditing(null)}
        onSave={(patch) => {
          if (!editing) return;
          const lrn = patch.lrn.replace(/[\s-]/g, '');
          if (!/^\d{12}$/.test(lrn)) {
            toast('The LRN must be exactly 12 digits.', 'danger');
            return;
          }
          updateLearner(editing.id, { ...patch, lrn });
          setEditing(null);
          toast('Learner updated.', 'success');
        }}
      />

      <TypeToConfirm
        open={Boolean(pendingDelete)}
        title="Remove this learner?"
        message={
          <>
            <strong>{pendingDelete?.name}</strong> will be removed from this exam, along with their
            checked sheet if one exists.
          </>
        }
        phrase="REMOVE"
        confirmLabel="Remove learner"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteLearner(pendingDelete.id);
          toast('Learner removed.', 'danger');
        }}
      />
    </>
  );
}

function EditLearnerSheet({
  learner,
  onClose,
  onSave,
}: {
  learner: Learner | null;
  onClose: () => void;
  onSave: (patch: { name: string; lrn: string; sex?: 'Male' | 'Female'; status: LearnerStatus }) => void;
}) {
  const [name, setName] = useState('');
  const [lrn, setLrn] = useState('');
  const [sex, setSex] = useState<'' | 'Male' | 'Female'>('');
  const [status, setStatus] = useState<LearnerStatus>('Active');

  useEffect(() => {
    if (!learner) return;
    setName(learner.name);
    setLrn(learner.lrn);
    setSex(learner.sex ?? '');
    setStatus(learner.status);
  }, [learner]);

  return (
    <MobileSheet
      open={Boolean(learner)}
      title="Edit learner"
      subtitle="Changing the LRN moves any checked sheet to the new number"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={() => onSave({ name: name.trim(), lrn, sex: sex || undefined, status })}
          >
            Save learner
          </button>
        </>
      }
    >
      <div className="m-form">
        <FieldBlock label="Learner name" wide>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </FieldBlock>
        <FieldBlock label="LRN" wide hint="12 digits. Existing scores follow the learner.">
          <input className="input input--mono" inputMode="numeric" value={lrn} onChange={(event) => setLrn(event.target.value)} />
        </FieldBlock>
        <FieldBlock label="Sex">
          <select className="select" value={sex} onChange={(event) => setSex(event.target.value as '' | 'Male' | 'Female')}>
            <option value="">Not specified</option>
            <option>Male</option>
            <option>Female</option>
          </select>
        </FieldBlock>
        <FieldBlock label="Status">
          <select className="select" value={status} onChange={(event) => setStatus(event.target.value as LearnerStatus)}>
            <option>Active</option>
            <option>Dropped</option>
            <option>Transferred</option>
          </select>
        </FieldBlock>
      </div>
    </MobileSheet>
  );
}
