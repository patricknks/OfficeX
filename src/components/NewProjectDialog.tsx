import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useT, type TKey } from '../i18n';
import { treeLines } from '../projects/plan';
import { slugify } from '../util';

const DEFAULT_STEPS = ['Ideas', 'In Progress', 'Done'];

/** The six interview questions of the new-project skill, one at a time, with a live folder preview. */
export function NewProjectDialog() {
  const t = useT();
  const open = useStore((s) => s.newProjectOpen);
  const teams = useStore((s) => s.teams);
  const projects = useStore((s) => s.projects);
  const selectedTeamId = useStore((s) => s.selectedTeamId);
  const company = useStore((s) => s.company);
  const st = useStore.getState();
  const dlg = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const [step, setStep] = useState(0);
  const [teamId, setTeamId] = useState(selectedTeamId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [shipped, setShipped] = useState('');
  const [people, setPeople] = useState('');
  const [process, setProcess] = useState<string[]>(DEFAULT_STEPS);
  const [rules, setRules] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setStep(0);
      const sel = useStore.getState().selectedTeamId;
      const tms = useStore.getState().teams;
      setTeamId(tms.some((x) => x.id === sel) ? sel : tms[0]?.id ?? '');
      setName('');
      setDescription('');
      setShipped('');
      setPeople(t('np.justMe'));
      setProcess(DEFAULT_STEPS);
      setRules('');
      setNote('');
      if (!dlg.current?.open) dlg.current?.showModal();
    } else if (dlg.current?.open) dlg.current.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    setTimeout(() => field.current?.focus(), 30);
  }, [step, open]);

  const taken = useMemo(() => projects.some((p) => p.name.toLowerCase() === name.trim().toLowerCase()), [projects, name]);
  const canNext = step !== 0 || (!!name.trim() && !taken);
  const tree = treeLines(name.trim(), process);

  async function create() {
    const answers = {
      name: name.trim(),
      team: teamId,
      description: description.trim(),
      shipped: shipped.trim(),
      people: people.trim(),
      process: process.map((p) => p.trim()).filter(Boolean),
      rules: rules.split('\n').map((r) => r.trim()).filter(Boolean),
    };
    setBusy(true);
    let msg = t('np.mockOnly');
    try {
      const res = await fetch('api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(answers) });
      const body = await res.json();
      if (res.ok) msg = t('np.created', { dir: body.dir });
      else if (res.status !== 409 && body.error) msg = body.error;
    } catch {
      /* static preview without the server: app-only project */
    }
    setBusy(false);
    st.addProject({
      id: slugify(answers.name),
      name: answers.name,
      teamId,
      description: answers.description,
      shipped: answers.shipped,
      people: answers.people,
      process: answers.process.length ? answers.process : DEFAULT_STEPS,
      rules: answers.rules,
      phase: 'bootstrap',
      created: new Date().toISOString().slice(0, 10),
      decisions: 0,
      findings: 0,
      collaborators: [],
    });
    setNote(msg);
    window.setTimeout(() => st.setNewProjectOpen(false), 1800);
  }

  const q = (n: number) => (
    <>
      <h3 className="np__q">{t(`np.q${n}` as TKey)}</h3>
      <p className="muted small">{t(`np.q${n}.hint` as TKey)}</p>
    </>
  );

  return (
    <dialog ref={dlg} className="dialog" onClose={() => st.setNewProjectOpen(false)} aria-labelledby="np-h">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 5) canNext && setStep(step + 1);
          else if (!busy && !note) void create();
        }}
      >
        <header className="dialog__head">
          <div>
            <h2 id="np-h">{t('np.title')}</h2>
            <p className="muted small">{t('np.step', { n: step + 1 })}</p>
          </div>
          <button type="button" className="icon-btn" onClick={() => st.setNewProjectOpen(false)} aria-label={t('common.close')}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="np__progress" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className={i <= step ? 'is-on' : ''} />
          ))}
        </div>

        <div className="dialog__grid">
          <div className="dialog__fields np__fields">
            {step === 0 && (
              <>
                {q(1)}
                <input ref={field} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ETH Funding Signal" />
                {taken && <p className="np__error">{t('np.nameTaken')}</p>}
                <label>
                  <span>{t('np.team')}</span>
                  <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                    {teams.map((tm) => (
                      <option key={tm.id} value={tm.id}>
                        {tm.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {step === 1 && (
              <>
                {q(2)}
                <textarea ref={field} className="input" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
              </>
            )}
            {step === 2 && (
              <>
                {q(3)}
                <textarea ref={field} className="input" rows={4} value={shipped} onChange={(e) => setShipped(e.target.value)} />
              </>
            )}
            {step === 3 && (
              <>
                {q(4)}
                <textarea ref={field} className="input" rows={3} value={people} onChange={(e) => setPeople(e.target.value)} />
              </>
            )}
            {step === 4 && (
              <>
                {q(5)}
                <ol className="np__steps">
                  {process.map((p, i) => (
                    <li key={i}>
                      <span className="np__num">{String(i).padStart(2, '0')}</span>
                      <input
                        ref={i === 0 ? field : undefined}
                        className="input"
                        value={p}
                        onChange={(e) => setProcess(process.map((x, j) => (j === i ? e.target.value : x)))}
                        aria-label={`${i + 1}`}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        disabled={process.length <= 1}
                        onClick={() => setProcess(process.filter((_, j) => j !== i))}
                        aria-label={t('np.removeStep', { n: i + 1 })}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ol>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setProcess([...process, ''])}>
                  {t('np.addStep')}
                </button>
              </>
            )}
            {step === 5 && (
              <>
                {q(6)}
                <textarea ref={field} className="input" rows={5} value={rules} onChange={(e) => setRules(e.target.value)} />
              </>
            )}
            {note && (
              <p className="np__note" role="status">
                {note}
              </p>
            )}
          </div>

          <aside className="dialog__preview">
            <h3>{t('np.preview')}</h3>
            <p className="mono small muted path">{company.rootPath}\</p>
            <pre className="tree mono">{tree.join('\n')}</pre>
            <p className="small muted">{t('np.previewNote')}</p>
          </aside>
        </div>

        <footer className="dialog__foot">
          {step > 0 && (
            <button type="button" className="btn btn--ghost" onClick={() => setStep(step - 1)} disabled={busy}>
              {t('np.back')}
            </button>
          )}
          <button type="submit" className="btn btn--primary" disabled={!canNext || busy || !!note}>
            {step < 5 ? t('np.next') : busy ? t('np.creating') : t('np.create')}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
