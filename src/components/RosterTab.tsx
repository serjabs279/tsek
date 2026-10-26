import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ClipboardPaste, Download, PencilLine, Plus, Trash2, UploadCloud, Users } from 'lucide-react';
import type { Exam, Learner, LearnerStatus } from '../types';
import { useApp } from '../store/AppStore';
import { parseRosterText } from '../lib/roster';
import { readFileAsText } from '../lib/download';
import { downloadRoster } from '../lib/exports';
import { Badge, ConfirmDialog, EmptyState, Field, Modal } from './ui';

export function RosterTab({ exam }: { exam: Exam }) {
  const { state, addLearners, updateLearner, deleteLearner, toast } = useApp();
  const learners = state.learners.filter((learner) => learner.examId === exam.id);
  const results = state.results.filter((result) => result.examId === exam.id);
  const scannedLrns = new Set(results.map((result) => result.lrn));

  const [text, setText] = useState('');
  const [editing, setEditing] = useState<Learner | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Learner | null>(null);
  const [manual, setManual] = useState({ lrn: '', name: '', sex: '' as '' | 'Male' | 'Female' });
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (text.trim() ? parseRosterText(text) : null), [text]);
  const existing = new Set(learners.map((learner) => learner.lrn));
  const newRows = parsed?.learners.filter((row) => !existing.has(row.lrn)) ?? [];
  const duplicateRows = parsed?.learners.filter((row) => existing.has(row.lrn)) ?? [];

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
      toast(`${file.name} loaded. Review the preview, then import.`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The file could not be read.', 'danger');
    }
  };

  const addManual = () => {
    const lrn = manual.lrn.replace(/[\s-]/g, '');
    if (!/^\d{12}$/.test(lrn)) {
      toast('LRN must be exactly 12 digits.', 'danger');
      return;
    }
    if (!manual.name.trim()) {
      toast('Enter the learner name.', 'danger');
      return;
    }
    const { added, duplicates } = addLearners(exam.id, [
      { lrn, name: manual.name, sex: manual.sex || undefined, status: 'Active' },
    ]);
    if (!added) {
      toast(duplicates.length ? 'That LRN is already in the roster.' : 'Learner was not added.', 'danger');
      return;
    }
    setManual({ lrn: '', name: '', sex: '' });
    toast('Learner added.', 'success');
  };

  const saveEdit = (patch: { name: string; lrn: string; sex?: 'Male' | 'Female'; status: LearnerStatus }) => {
    if (!editing) return;
    const lrn = patch.lrn.replace(/[\s-]/g, '');
    if (!/^\d{12}$/.test(lrn)) {
      toast('LRN must be exactly 12 digits.', 'danger');
      return;
    }
    updateLearner(editing.id, { ...patch, lrn });
    setEditing(null);
    toast('Learner updated.', 'success');
  };

  return (
    <div className="split-grid">
      <section className="card">
        <div className="card-head">
          <div className="card-head__title">
            <h3>Class roster</h3>
            <p>The LRN is the identity on the sheet QR. Names are printed for the teacher and learner.</p>
          </div>
          <Badge tone={learners.length ? 'green' : 'amber'}>{learners.length} learners</Badge>
        </div>
        <div className="card-body card-body--tight">
          {learners.length === 0 ? (
            <EmptyState
              icon={<Users size={24} />}
              title="No learners yet"
              message="Paste a list from Excel or Google Sheets on the right, or add one learner at a time."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>LRN</th>
                    <th>Learner</th>
                    <th>Sex</th>
                    <th>Status</th>
                    <th>Checked</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {learners.map((learner) => (
                    <tr key={learner.id}>
                      <td className="mono small">{learner.lrn}</td>
                      <td className="name-cell">{learner.name}</td>
                      <td className="small muted">{learner.sex ?? '—'}</td>
                      <td>
                        <select
                          className="select"
                          style={{ minHeight: 30, padding: '2px 8px', fontSize: '0.76rem' }}
                          value={learner.status}
                          onChange={(event) => updateLearner(learner.id, { status: event.target.value as LearnerStatus })}
                        >
                          <option>Active</option>
                          <option>Dropped</option>
                          <option>Transferred</option>
                        </select>
                      </td>
                      <td>
                        {scannedLrns.has(learner.lrn) ? (
                          <span className="pill pill--green"><CheckCircle2 size={11} /> scanned</span>
                        ) : (
                          <span className="pill pill--neutral">pending</span>
                        )}
                      </td>
                      <td className="actions-cell">
                        <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                          <button className="icon-btn icon-btn--sm" title="Edit learner" onClick={() => setEditing(learner)}>
                            <PencilLine size={14} />
                          </button>
                          <button className="icon-btn icon-btn--sm icon-btn--danger" title="Remove learner" onClick={() => setPendingDelete(learner)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {learners.length > 0 && (
            <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost btn--sm" onClick={() => downloadRoster(exam, learners)}>
                <Download size={14} /> Roster CSV
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="stack">
        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Paste a class list</h3>
              <p>Accepts CSV, TSV, or lines copied straight from Excel. The LRN column is detected automatically.</p>
            </div>
            <ClipboardPaste size={18} className="muted" />
          </div>
          <div className="card-body">
            <Field label="Roster text" hint="Columns may be LRN, Name, Sex, Status — any order, with or without a header.">
              <textarea
                className="textarea"
                rows={7}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={'LRN,Name,Sex\n136001230001,Aguilar, Maria Sofia,Female\n136001230002,Bautista, John Paulo,Male'}
              />
            </Field>
            <div className="row row--wrap" style={{ marginTop: 10, justifyContent: 'space-between' }}>
              <button className="btn btn--ghost btn--sm" onClick={() => fileRef.current?.click()}>
                <UploadCloud size={14} /> Choose CSV
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
                <Plus size={14} /> Import {newRows.length ? `${newRows.length} learner${newRows.length === 1 ? '' : 's'}` : 'list'}
              </button>
            </div>

            {parsed && (
              <div className="import-preview">
                <div className="import-preview__head">
                  <span>
                    <strong>{parsed.learners.length}</strong> readable · <strong>{newRows.length}</strong> new
                    {duplicateRows.length > 0 && ` · ${duplicateRows.length} already here`}
                    {parsed.ignored > 0 && ` · ${parsed.ignored} skipped`}
                  </span>
                  <span className="faint">Preview</span>
                </div>
                <div className="import-preview__body">
                  {parsed.learners.slice(0, 8).map((row) => (
                    <div className="import-row" key={row.lrn}>
                      <span className="import-row__lrn">{row.lrn}</span>
                      <span className="grow">{row.name}</span>
                      {existing.has(row.lrn) ? <Badge tone="amber">in roster</Badge> : <Badge tone="green">new</Badge>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {parsed && parsed.errors.length > 0 && (
              <div className="import-errors">
                {parsed.errors.map((error) => <div key={error}>{error}</div>)}
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div className="card-head__title">
              <h3>Add one learner</h3>
              <p>Useful for late enrollees and corrections.</p>
            </div>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="LRN" wide>
                <input
                  className="input input--mono"
                  inputMode="numeric"
                  value={manual.lrn}
                  onChange={(event) => setManual((prev) => ({ ...prev, lrn: event.target.value }))}
                  placeholder="12 digits"
                />
              </Field>
              <Field label="Name" wide>
                <input
                  className="input"
                  value={manual.name}
                  onChange={(event) => setManual((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Surname, First Name"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addManual();
                  }}
                />
              </Field>
              <Field label="Sex">
                <select
                  className="select"
                  value={manual.sex}
                  onChange={(event) => setManual((prev) => ({ ...prev, sex: event.target.value as '' | 'Male' | 'Female' }))}
                >
                  <option value="">Not specified</option>
                  <option>Male</option>
                  <option>Female</option>
                </select>
              </Field>
              <div className="field">
                <span className="field__label">&nbsp;</span>
                <button className="btn btn--soft" onClick={addManual}>
                  <Plus size={15} /> Add learner
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <LearnerModal open={Boolean(editing)} learner={editing} onClose={() => setEditing(null)} onSave={saveEdit} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remove this learner?"
        message={
          <>
            <strong>{pendingDelete?.name}</strong> will be removed from this exam, along with their checked sheet if one exists.
          </>
        }
        confirmLabel="Remove learner"
        danger
        onConfirm={() => {
          if (pendingDelete) {
            deleteLearner(pendingDelete.id);
            toast('Learner removed.', 'danger');
          }
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

function LearnerModal({
  open,
  learner,
  onClose,
  onSave,
}: {
  open: boolean;
  learner: Learner | null;
  onClose: () => void;
  onSave: (patch: { name: string; lrn: string; sex?: 'Male' | 'Female'; status: LearnerStatus }) => void;
}) {
  const [name, setName] = useState('');
  const [lrn, setLrn] = useState('');
  const [sex, setSex] = useState<'' | 'Male' | 'Female'>('');
  const [status, setStatus] = useState<LearnerStatus>('Active');

  useEffect(() => {
    setName(learner?.name ?? '');
    setLrn(learner?.lrn ?? '');
    setSex(learner?.sex ?? '');
    setStatus(learner?.status ?? 'Active');
  }, [learner]);

  return (
    <Modal
      open={open}
      title="Edit learner"
      eyebrow="Roster"
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => onSave({ name: name.trim(), lrn, sex: sex || undefined, status })}>
            Save learner
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Learner name" wide>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="LRN" wide hint="Changing the LRN moves any existing checked sheet to the new number.">
          <input className="input input--mono" inputMode="numeric" value={lrn} onChange={(event) => setLrn(event.target.value)} />
        </Field>
        <Field label="Sex">
          <select className="select" value={sex} onChange={(event) => setSex(event.target.value as '' | 'Male' | 'Female')}>
            <option value="">Not specified</option>
            <option>Male</option>
            <option>Female</option>
          </select>
        </Field>
        <Field label="Status">
          <select className="select" value={status} onChange={(event) => setStatus(event.target.value as LearnerStatus)}>
            <option>Active</option>
            <option>Dropped</option>
            <option>Transferred</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}
