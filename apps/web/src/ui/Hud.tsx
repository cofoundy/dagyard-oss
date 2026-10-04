// HUD en las esquinas: marca + proyecto (abre el selector) + «ahora en …» arriba a la izquierda,
// «te esperan» y «Vista general» arriba a la derecha, carril de etapas abajo y avisos arriba al centro.

import { forwardRef, useEffect, useRef, useState } from 'react';
import type { ProjectSummary, Snapshot } from '../data/types';
import { doneCount, liveStages, stageStats } from '../data/view';
import { COPY, listas, roman, stageLabel, waitingText } from './copy';
import type { ToastKind } from './feedback';

/* ------------------------------------------------------------------ marca */

interface BrandProps {
  snapshot: Snapshot | null;
  projectName: string;
  projects: ProjectSummary[];
  currentId: string | null;
  reconnecting: boolean;
  onPick: (projectId: string) => void;
  onLogout: () => void;
}

export const Brand = forwardRef<HTMLDivElement, BrandProps>(function Brand(
  { snapshot, projectName, projects, currentId, reconnecting, onPick, onLogout },
  ref,
) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (ev: PointerEvent | KeyboardEvent) => {
      if (ev instanceof KeyboardEvent ? ev.key === 'Escape' : !wrap.current?.contains(ev.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  const live = snapshot ? liveStages(snapshot) : [];
  return (
    <div className="hud brand" ref={ref}>
      <div className="word">
        <i className={reconnecting ? 'off' : ''} aria-hidden="true" />
        dagyard
      </div>
      <div className="proj-wrap" ref={wrap}>
        <button
          type="button"
          className="proj"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title={COPY.projectsTitle}
        >
          <span>{projectName}</span>
          <svg className="chev" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open && (
          <div className="picker" role="listbox" aria-label={COPY.projectsTitle}>
            <div className="sec">{COPY.projectsTitle}</div>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={p.id === currentId}
                className={p.id === currentId ? 'cur' : ''}
                onClick={() => {
                  setOpen(false);
                  if (p.id !== currentId) onPick(p.id);
                }}
              >
                <span>{p.name}</span>
                {p.id === currentId && <span className="tick">●</span>}
              </button>
            ))}
            <button type="button" className="out" onClick={onLogout}>
              {COPY.logout}
            </button>
          </div>
        )}
      </div>
      <div className="now" aria-live="polite">
        {reconnecting ? (
          <span className="amber">{COPY.reconnecting}</span>
        ) : snapshot ? (
          <>
            {listas(doneCount(snapshot), snapshot.nodes.length)}
            {live.length > 0 && (
              <span className="live">
                {' · ahora en '}
                <b>{live.map((s) => `${roman(s.index)} ${s.stage.name}`).join(' · ')}</b>
              </span>
            )}
          </>
        ) : (
          ' '
        )}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ acciones */

interface ActionsProps {
  waiting: number;
  onWaiting: () => void;
  onOverview: () => void;
}

export const Actions = forwardRef<HTMLDivElement, ActionsProps>(function Actions({ waiting, onWaiting, onOverview }, ref) {
  return (
    <div className="hud actions" ref={ref}>
      <button type="button" className={`btn waiting${waiting ? '' : ' calm'}`} onClick={onWaiting} disabled={!waiting} aria-disabled={!waiting}>
        <span className="dot" aria-hidden="true" />
        <span>{waitingText(waiting)}</span>
      </button>
      <button type="button" className="btn" onClick={onOverview}>
        {COPY.overview}
      </button>
    </div>
  );
});

/* ------------------------------------------------------------------ carril de etapas */

interface RailProps {
  snapshot: Snapshot;
  selected: number | null;
  onStage: (index: number) => void;
}

export const Rail = forwardRef<HTMLElement, RailProps>(function Rail({ snapshot, selected, onStage }, ref) {
  const stats = stageStats(snapshot);
  const local = useRef<HTMLElement | null>(null);
  // En pantallas angostas el carril se desplaza: la etapa elegida siempre queda a la vista.
  useEffect(() => {
    local.current?.querySelector<HTMLElement>('.stage.sel')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  const setRef = (el: HTMLElement | null) => {
    local.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };
  return (
    <nav className="hud rail" aria-label="Etapas del proyecto" ref={setRef}>
      {stats.map((s) => (
        <button
          key={s.stage.id}
          type="button"
          className={`stage ${s.state === 'idle' ? '' : s.state}${selected === s.index ? ' sel' : ''}`}
          aria-current={selected === s.index ? 'step' : undefined}
          onClick={() => onStage(s.index)}
        >
          <div className="bar">
            <span style={{ width: `${s.total ? (s.done / s.total) * 100 : 0}%` }} />
            <em />
          </div>
          <span className="nm">{stageLabel(s.index, s.stage.name)}</span>
          <span className="ct">{listas(s.done, s.total)}</span>
        </button>
      ))}
    </nav>
  );
});

/* ------------------------------------------------------------------ avisos */

export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  text: string;
  nodeId?: string;
  leaving?: boolean;
}

export function Toasts({ items, onOpen }: { items: ToastItem[]; onOpen: (nodeId: string) => void }) {
  return (
    <div className="hud toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast ${t.kind}${t.leaving ? ' out' : ''}${t.nodeId ? ' link' : ''}`}
          onClick={() => t.nodeId && onOpen(t.nodeId)}
          tabIndex={t.nodeId ? 0 : -1}
        >
          <b>{t.title}</b>
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}
