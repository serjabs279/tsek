import { useEffect, useState } from 'react';
import { ArrowLeft, Database, FlaskConical, HardDrive, RotateCcw, ShieldCheck } from 'lucide-react';
import { useApp } from '@shared/store/AppStore';
import { workspaceFilePath } from '@shared/lib/workspaceStorage';
import { FieldBlock, ScreenHead, TypeToConfirm } from '../components/Common';

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { state, updateSettings, resetWorkspace, loadDemoWorkspace, toast } = useApp();
  const [path, setPath] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    let live = true;
    void workspaceFilePath().then((value) => {
      if (live) setPath(value);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <div className="m-row" style={{ marginBottom: 10 }}>
        <button className="m-iconbtn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <span className="m-tiny">Back to exams</span>
      </div>

      <ScreenHead
        eyebrow="Settings"
        title="This tablet"
        subtitle="Everything is stored locally; the workspace file is plain JSON."
      />

      <div className="m-stack">
        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>School details</h2>
              <p>Used on printed sheets and exported reports from the desktop app.</p>
            </div>
          </div>
          <div className="m-card__body">
            <div className="m-form">
              <FieldBlock label="School name" wide>
                <input
                  className="input"
                  value={state.settings.schoolName}
                  onChange={(event) => updateSettings({ schoolName: event.target.value })}
                />
              </FieldBlock>
              <FieldBlock label="School ID">
                <input
                  className="input"
                  value={state.settings.schoolId}
                  onChange={(event) => updateSettings({ schoolId: event.target.value })}
                />
              </FieldBlock>
              <FieldBlock label="Division">
                <input
                  className="input"
                  value={state.settings.division}
                  onChange={(event) => updateSettings({ division: event.target.value })}
                />
              </FieldBlock>
              <FieldBlock label="Region">
                <input
                  className="input"
                  value={state.settings.region}
                  onChange={(event) => updateSettings({ region: event.target.value })}
                />
              </FieldBlock>
            </div>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>New exam defaults</h2>
              <p>These apply when you create an exam on this tablet.</p>
            </div>
          </div>
          <div className="m-card__body">
            <div className="m-form">
              <FieldBlock label="Items">
                <input
                  className="input"
                  type="number"
                  min={20}
                  max={100}
                  value={state.settings.defaultItemCount}
                  onChange={(event) =>
                    updateSettings({
                      defaultItemCount: Math.max(20, Math.min(100, Math.round(Number(event.target.value) || 50))),
                    })
                  }
                />
              </FieldBlock>
              <FieldBlock label="Choices">
                <select
                  className="select"
                  value={String(state.settings.defaultChoiceCount)}
                  onChange={(event) => updateSettings({ defaultChoiceCount: event.target.value === '5' ? 5 : 4 })}
                >
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
                  value={state.settings.passingPercent}
                  onChange={(event) =>
                    updateSettings({ passingPercent: Math.max(1, Math.min(100, Math.round(Number(event.target.value) || 75))) })
                  }
                />
              </FieldBlock>
            </div>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Storage</h2>
              <p>The workspace survives app updates and cache clears.</p>
            </div>
            <HardDrive size={19} className="muted" />
          </div>
          <div className="m-card__body">
            <div className="m-note" style={{ wordBreak: 'break-all', fontFamily: 'var(--mono)', fontSize: '0.7rem' }}>
              {path ?? (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
                ? 'Reading the workspace path…'
                : 'Browser preview: saved in local storage. The installed Android app uses a JSON file.')}
            </div>
            <div className="m-row" style={{ marginTop: 10 }}>
              <span className="m-chip"><Database size={13} /> {state.exams.length} exams</span>
              <span className="m-chip"><Database size={13} /> {state.learners.length} learners</span>
              <span className="m-chip"><Database size={13} /> {state.results.length} results</span>
            </div>
            <div className="m-row" style={{ marginTop: 12 }}>
              <ShieldCheck size={15} className="muted" />
              <span className="m-tiny">No uploads, no account, no network calls.</span>
            </div>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Testing</h2>
              <p>Add a sample exam with learners and a filled answer key.</p>
            </div>
            <FlaskConical size={19} className="muted" />
          </div>
          <div className="m-card__body">
            <button
              className="btn btn--soft btn--block"
              onClick={() => {
                loadDemoWorkspace();
                toast('Sample exam added. Open it from the exam list.', 'success');
              }}
            >
              <FlaskConical size={16} /> Add a sample exam
            </button>
          </div>
        </section>

        <section className="m-card">
          <div className="m-card__head">
            <div>
              <h2>Reset this tablet</h2>
              <p>Removes every exam, learner, and result from this device only.</p>
            </div>
          </div>
          <div className="m-card__body">
            <button className="btn btn--danger btn--block" onClick={() => setConfirmReset(true)}>
              <RotateCcw size={16} /> Reset workspace
            </button>
            <p className="m-tiny" style={{ marginBottom: 0 }}>
              A snapshot is kept before the reset, but the Android build cannot restore it yet.
              Copy the workspace file from the desktop app first if the record matters.
            </p>
          </div>
        </section>

        <div className="m-note">
          <strong>Tsek for Android</strong> shares its scoring, item analysis, and OMR engine with
          the desktop app. Printing sheets, PDF reports, CSV exports, and manual written-part score
          entry remain desktop-only for now.
        </div>

        <div className="m-row" style={{ justifyContent: 'center', paddingBottom: 10 }}>
          <span className="m-tiny">Developed by ZX TechLabs · Richmond C. Jabla</span>
        </div>
      </div>

      <TypeToConfirm
        open={confirmReset}
        title="Reset the whole workspace?"
        message="Every exam, roster, and checked sheet on this tablet is removed. This cannot be undone from the Android app."
        phrase="RESET"
        confirmLabel="Reset workspace"
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          resetWorkspace();
          toast('Workspace reset.', 'danger');
        }}
      />
    </>
  );
}
