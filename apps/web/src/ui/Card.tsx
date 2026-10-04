// La ficha de una tarea: estado, lo que te pide (decisión, revisión o acceso), lo que te escribieron,
// el informe, el detalle técnico y sus vecinos en el plan. A la derecha en escritorio, hoja inferior en móvil.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Blocker, DagNode, Resolution, Snapshot } from '../data/types';
import { dependentsOf, depsOf, messagesOf, openBlockerOf, resolvedBlockersOf, stageIndex } from '../data/view';
import { ago, BLOCK_TEXT, COPY, reportLabel, stageLabel, STATUS_CLASS, STATUS_TEXT, teamName } from './copy';

export interface CardProps {
  snapshot: Snapshot;
  node: DagNode | undefined;
  onClose: () => void;
  onFocus: (nodeId: string) => void;
  onResolve: (blocker: Blocker, resolution: Resolution) => Promise<void>;
}

export function Card({ snapshot, node, onClose, onFocus, onResolve }: CardProps) {
  // La ficha conserva la última tarea mientras se desvanece al cerrarse.
  const [shown, setShown] = useState<DagNode | undefined>(node);
  useEffect(() => {
    if (node) setShown(node);
  }, [node]);
  const n = node ?? shown;
  const open = !!node;

  return (
    <aside className={`card${open ? ' open' : ''}`} aria-live="polite" aria-hidden={!open} inert={!open}>
      {n && <CardBody snapshot={snapshot} node={n} onClose={onClose} onFocus={onFocus} onResolve={onResolve} />}
    </aside>
  );
}

function CardBody({ snapshot, node, onClose, onFocus, onResolve }: CardProps & { node: DagNode }) {
  const si = stageIndex(snapshot).get(node.stageId) ?? 0;
  const stage = snapshot.stages[si];
  const blocker = openBlockerOf(snapshot, node.id);
  const answers = resolvedBlockersOf(snapshot, node.id);
  const messages = messagesOf(snapshot, node.id).slice(0, 4);
  const deps = depsOf(snapshot, node.id);
  const next = dependentsOf(snapshot, node.id);
  const team = teamName(node.team);
  const cls = STATUS_CLASS[node.status];

  return (
    <>
      <div className="top">
        <span className="cat">{stage ? stageLabel(si, stage.name) : ''}</span>
        <button className="x" type="button" aria-label={COPY.close} onClick={onClose}>
          ×
        </button>
      </div>
      <span className={`chip ${cls}`}>{STATUS_TEXT[node.status]}</span>
      <h2>{node.title}</h2>
      {node.status === 'working' && (
        <div className="prog" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(node.progress * 100)}>
          <span style={{ width: `${Math.round(node.progress * 100)}%` }} />
        </div>
      )}

      {blocker && <BlockerPanel key={blocker.id} blocker={blocker} onResolve={onResolve} />}

      {blocker && team && (
        <div className="msg">
          <span className="who">
            {team} · {COPY.waitsYou}
          </span>
        </div>
      )}

      {messages.length > 0 ? (
        <div className="msgs">
          {messages.map((m) => (
            <div className="msg" key={m.id}>
              <span className="who">
                {m.from}
                {m.at ? ` · ${ago(m.at)}` : ''}
              </span>
              <p>{m.text}</p>
              {m.reportUrl && (
                <a className="inline-report" href={m.reportUrl} target="_blank" rel="noopener noreferrer">
                  {reportLabel(m.reportUrl)} ↗
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        !blocker &&
        (team && node.status !== 'pending' ? (
          <div className="msg">
            <span className="who">{team}</span>
          </div>
        ) : (
          node.status === 'pending' && <p className="fine">{COPY.notStarted}</p>
        ))
      )}

      {answers.length > 0 && (
        <>
          <div className="sec">{COPY.yourAnswers}</div>
          {answers.map((b) => (
            <Answer key={b.id} blocker={b} />
          ))}
        </>
      )}

      {deps.length > 0 && (
        <>
          <div className="sec">{COPY.needs}</div>
          <div className="deps">
            {deps.map((d) => (
              <button type="button" key={d.id} className={d.status === 'done' ? 'ok' : ''} onClick={() => onFocus(d.id)}>
                {d.title}
                {d.status === 'done' ? ' ✓' : ''}
              </button>
            ))}
          </div>
        </>
      )}
      {next.length > 0 && (
        <>
          <div className="sec">{COPY.unlocks}</div>
          <div className="deps">
            {next.map((d) => (
              <button type="button" key={d.id} onClick={() => onFocus(d.id)}>
                {d.title}
              </button>
            ))}
          </div>
        </>
      )}

      {node.reportUrl && (
        <a className="report" href={node.reportUrl} target="_blank" rel="noopener noreferrer">
          <span>{reportLabel(node.reportUrl)}</span>
          <span>{COPY.open} ↗</span>
        </a>
      )}
      {node.link && (
        <a className="report" href={node.link} target="_blank" rel="noopener noreferrer">
          <span>{COPY.technical}</span>
          <span>{COPY.open} ↗</span>
        </a>
      )}
    </>
  );
}

const ANSWER_VERB: Record<Blocker['kind'], string> = {
  decision: 'Decidiste',
  review: 'Revisaste',
  access: 'Entregaste un acceso',
};

function Answer({ blocker }: { blocker: Blocker }) {
  const who = blocker.resolvedBy && blocker.resolvedBy !== 'Tú' ? blocker.resolvedBy : null;
  return (
    <div className="answer">
      <span className="lab">
        {who ? `${who} respondió` : ANSWER_VERB[blocker.kind]}
        {blocker.resolvedAt ? ` · ${ago(blocker.resolvedAt)}` : ''}
      </span>
      <p className="q">{blocker.kind === 'access' && blocker.label ? blocker.label : blocker.question}</p>
      {/* En un acceso, el verbo ya lo dice todo: el valor nunca se muestra. */}
      {blocker.resolution && blocker.kind !== 'access' && <p className="a">{blocker.resolution}</p>}
    </div>
  );
}

type Phase = { k: 'idle' } | { k: 'sending'; what: string } | { k: 'error'; text: string };

function BlockerPanel({ blocker, onResolve }: { blocker: Blocker; onResolve: CardProps['onResolve'] }) {
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [changes, setChanges] = useState(false);
  const [comment, setComment] = useState('');
  const [value, setValue] = useState('');
  const [missing, setMissing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const sending = phase.k === 'sending';

  useEffect(() => {
    if (changes) areaRef.current?.focus();
  }, [changes]);

  async function send(r: Resolution, what: string) {
    setPhase({ k: 'sending', what });
    try {
      await onResolve(blocker, r);
      // Si la ficha sigue montada (otro pedido abierto), vuelve a quedar lista.
      setPhase({ k: 'idle' });
    } catch (e) {
      setPhase({ k: 'error', text: e instanceof Error && e.message ? e.message : COPY.sendError });
    }
  }

  function submitAccess(ev: FormEvent) {
    ev.preventDefault();
    if (!value.trim()) {
      setMissing(true);
      inputRef.current?.focus();
      return;
    }
    void send({ kind: 'access', value: value.trim() }, 'access');
  }

  function submitChanges(ev: FormEvent) {
    ev.preventDefault();
    void send({ kind: 'review', verdict: 'changes', comment: comment.trim() || undefined }, 'changes');
  }

  const fieldId = `acc-${blocker.id}`;
  const areaId = `chg-${blocker.id}`;

  return (
    <div className="block">
      <label className="kind">{BLOCK_TEXT[blocker.kind]}</label>
      <p>{blocker.question}</p>

      {blocker.kind === 'decision' && (
        <div className="opts">
          {blocker.options.map((o, i) => (
            <button
              key={o}
              type="button"
              className={`go${i ? ' ghost' : ''}`}
              disabled={sending}
              onClick={() => void send({ kind: 'decision', option: o }, o)}
            >
              {sending && phase.what === o ? COPY.sending : o}
            </button>
          ))}
        </div>
      )}

      {blocker.kind === 'review' &&
        (!changes ? (
          <div className="opts">
            <button type="button" className="go" disabled={sending} onClick={() => void send({ kind: 'review', verdict: 'approve' }, 'approve')}>
              {sending && phase.what === 'approve' ? COPY.sending : (blocker.options[0] ?? COPY.approve)}
            </button>
            <button type="button" className="go ghost" disabled={sending} onClick={() => setChanges(true)}>
              {blocker.options[1] ?? COPY.requestChanges}
            </button>
          </div>
        ) : (
          <form className="opts" onSubmit={submitChanges}>
            <label htmlFor={areaId}>{COPY.changesLabel}</label>
            <textarea
              id={areaId}
              ref={areaRef}
              rows={3}
              maxLength={1000}
              value={comment}
              placeholder={COPY.changesPlaceholder}
              onChange={(e) => setComment(e.target.value)}
            />
            <button type="submit" className="go" disabled={sending}>
              {sending ? COPY.sending : COPY.sendChanges}
            </button>
            <button type="button" className="go ghost" disabled={sending} onClick={() => setChanges(false)}>
              {COPY.cancel}
            </button>
          </form>
        ))}

      {blocker.kind === 'access' && (
        <form className="opts" onSubmit={submitAccess}>
          <label htmlFor={fieldId}>{blocker.label ?? 'Acceso'}</label>
          <input
            id={fieldId}
            ref={inputRef}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder={missing ? COPY.accessMissing : COPY.accessPlaceholder}
            aria-invalid={missing || undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setMissing(false);
            }}
          />
          <button type="submit" className="go" disabled={sending}>
            {sending ? COPY.sending : COPY.unlock}
          </button>
          <p className="fine">{COPY.accessFine}</p>
        </form>
      )}

      {phase.k === 'error' && (
        <p className="err" role="alert">
          {phase.text}
        </p>
      )}
    </div>
  );
}
