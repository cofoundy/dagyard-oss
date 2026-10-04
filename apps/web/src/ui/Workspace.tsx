// El espacio de trabajo: elige el proyecto, mantiene el estado vivo (snapshot + eventos) y conecta la
// escena con el HUD, la ficha y los avisos. Eventos del servidor → reducer → setGraph + pulse + aviso.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { Pulse, SceneHandlers, Sky } from '../scene/contract';
import { ApiError, type AppApi } from '../data/session';
import { ProjectStore, type StoreChange, type StoreState } from '../data/store';
import { UnauthorizedError, type Blocker, type ProjectSummary, type Resolution } from '../data/types';
import { nodeById, openBlockers, stageIndex, toSceneGraph } from '../data/view';
import { Card } from './Card';
import { COPY } from './copy';
import { feedbackFor, resolvedToast, type ToastSpec } from './feedback';
import { Actions, Brand, Rail, Toasts, type ToastItem } from './Hud';
import { useSafeArea } from './useSafeArea';

const PROJECT_KEY = 'dagyard:project';
const TOAST_MS = 4200;
const MAX_TOASTS = 3;

const NO_STATE: StoreState = { snapshot: null, status: 'loading' };
const noSubscribe = () => () => {};
const noState = () => NO_STATE;

export interface WorkspaceProps {
  api: AppApi;
  sky: RefObject<Sky | null>;
  handlers: RefObject<SceneHandlers>;
  demo?: boolean;
  onUnauthorized: () => void;
  onLogout: () => void;
}

export function Workspace({ api, sky, handlers, demo, onUnauthorized, onLogout }: WorkspaceProps) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [listError, setListError] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [store, setStore] = useState<ProjectStore | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [stageSel, setStageSel] = useState<number | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const brandRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);

  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  /* ---------------------------------------------------------------- avisos */

  const toastSeq = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  };
  const pushToast = useCallback((spec: ToastSpec) => {
    const id = ++toastSeq.current;
    setToasts((list) => [{ id, ...spec }, ...list].slice(0, MAX_TOASTS));
    later(() => setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), TOAST_MS);
    later(() => setToasts((list) => list.filter((t) => t.id !== id)), TOAST_MS + 450);
  }, []);
  useEffect(() => {
    const set = timers.current;
    return () => {
      for (const t of set) clearTimeout(t);
      set.clear();
    };
  }, []);

  /* ---------------------------------------------------------------- proyectos */

  const loadProjects = useCallback(async () => {
    setListError(false);
    try {
      const list = await api.listProjects();
      setProjects(list);
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(PROJECT_KEY);
      } catch {
        /* almacenamiento bloqueado */
      }
      setProjectId((cur) => cur ?? (list.find((p) => p.id === stored) ?? list[0])?.id ?? null);
    } catch (e) {
      if (e instanceof UnauthorizedError) onUnauthorizedRef.current();
      else setListError(true);
    }
  }, [api]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const pickProject = (id: string) => {
    try {
      localStorage.setItem(PROJECT_KEY, id);
    } catch {
      /* almacenamiento bloqueado */
    }
    setFocusId(null);
    setStageSel(null);
    setProjectId(id);
  };

  /* ---------------------------------------------------------------- estado vivo */

  // Pulsos pendientes: se disparan después del setGraph que trae al nodo (un nodo recién nacido aún no existe).
  const pendingPulses = useRef<Array<{ nodeId: string; kind: Pulse }>>([]);
  const mine = useRef(new Set<string>());

  const onChange = useRef<(c: StoreChange) => void>(() => {});
  onChange.current = ({ prev, next, event }) => {
    const fb = feedbackFor(prev, next, event);
    if (fb.pulse) pendingPulses.current.push(fb.pulse);
    // Lo que resolviste desde aquí ya tiene su aviso; el eco del servidor no lo repite.
    if (event.type === 'blocker.resolved' && mine.current.has(event.blocker.id)) return;
    if (fb.toast) pushToast(fb.toast);
  };

  useEffect(() => {
    if (!projectId) return;
    const s = new ProjectStore(api, projectId, {
      onChange: (c) => onChange.current(c),
      onUnauthorized: () => onUnauthorizedRef.current(),
    });
    setStore(s);
    s.start().catch(() => {});
    return () => {
      s.dispose();
      setStore((cur) => (cur === s ? null : cur));
    };
  }, [api, projectId]);

  const state = useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getState ?? noState);
  const snapshot = state.snapshot;

  /* ---------------------------------------------------------------- escena */

  const graph = useMemo(() => (snapshot ? toSceneGraph(snapshot) : null), [snapshot]);
  const shownProject = useRef<string | null>(null);
  useEffect(() => {
    const s = sky.current;
    if (!graph || !snapshot || !s) return;
    s.setGraph(graph);
    const switched = shownProject.current !== null && shownProject.current !== snapshot.project.id;
    shownProject.current = snapshot.project.id;
    if (switched) s.overview();
    const pulses = pendingPulses.current.splice(0);
    for (const p of pulses) if (graph.nodes.some((n) => n.id === p.nodeId)) s.pulse(p.nodeId, p.kind);
  }, [graph, snapshot, sky]);

  const focus = useCallback(
    (id: string) => {
      if (!snapshot) return;
      const n = nodeById(snapshot, id);
      if (!n) return;
      setFocusId(id);
      setStageSel(stageIndex(snapshot).get(n.stageId) ?? null);
      sky.current?.focus(id);
    },
    [snapshot, sky],
  );

  const overview = useCallback(() => {
    setFocusId(null);
    setStageSel(null);
    sky.current?.overview();
  }, [sky]);

  const flyStage = useCallback(
    (i: number) => {
      setFocusId(null);
      setStageSel(i);
      sky.current?.flyStage(i);
    },
    [sky],
  );

  const engaged = focusId !== null || stageSel !== null;
  useLayoutEffect(() => {
    handlers.current = {
      onPick: (id) => {
        if (id) focus(id);
        else if (engaged) overview();
      },
      onModeChange: (m) => {
        if (m === 'overview') {
          setFocusId(null);
          setStageSel(null);
        }
      },
    };
  }, [handlers, focus, overview, engaged]);

  useEffect(() => {
    if (!engaged) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !ev.defaultPrevented) overview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engaged, overview]);

  // Si la tarea abierta sale del plan, se vuelve a la vista general.
  const focusedNode = snapshot ? nodeById(snapshot, focusId) : undefined;
  useEffect(() => {
    if (focusId && snapshot && !focusedNode) overview();
  }, [focusId, snapshot, focusedNode, overview]);

  /* ---------------------------------------------------------------- HUD medido */

  useSafeArea(
    [brandRef, actionsRef],
    [railRef, noteRef],
    (area) => sky.current?.setSafeArea(area),
    [!!snapshot, demo, snapshot?.stages.length],
  );

  /* ---------------------------------------------------------------- acciones */

  const waitingIds = useMemo(() => (snapshot ? [...new Set(openBlockers(snapshot).map((b) => b.nodeId))] : []), [snapshot]);

  const nextWaiting = () => {
    if (!waitingIds.length) return;
    const i = focusId ? (waitingIds.indexOf(focusId) + 1) % waitingIds.length : 0;
    focus(waitingIds[i]!);
  };

  const resolve = async (b: Blocker, r: Resolution) => {
    if (!store) return;
    const title = (snapshot && nodeById(snapshot, b.nodeId)?.title) ?? '';
    mine.current.add(b.id);
    try {
      const res = await store.resolve(b.id, r);
      pushToast(resolvedToast(title, res.resolution, b.nodeId));
      sky.current?.pulse(b.nodeId, 'working');
    } catch (e) {
      mine.current.delete(b.id);
      if (e instanceof UnauthorizedError) {
        onUnauthorizedRef.current();
        throw new Error(COPY.entryExpired);
      }
      if (e instanceof ApiError && e.code === 'conflict') {
        void store.start().catch(() => {});
        throw new Error(COPY.alreadyResolved);
      }
      throw new Error(COPY.sendError);
    }
  };

  /* ---------------------------------------------------------------- vista */

  const current = projects?.find((p) => p.id === projectId);
  const projectName = snapshot?.project.name ?? current?.name ?? '';

  let center: React.ReactNode = null;
  if (listError) {
    center = (
      <div className="center-note">
        <p>{COPY.loadError}</p>
        <button type="button" className="btn" onClick={() => void loadProjects()}>
          {COPY.retry}
        </button>
      </div>
    );
  } else if (projects && !projects.length) {
    center = (
      <div className="center-note">
        <p>{COPY.noProjects}</p>
        <button type="button" className="btn" onClick={onLogout}>
          {COPY.logout}
        </button>
      </div>
    );
  } else if (!snapshot && state.status === 'error') {
    center = (
      <div className="center-note">
        <p>{COPY.loadError}</p>
        <button type="button" className="btn" onClick={() => void store?.start().catch(() => {})}>
          {COPY.retry}
        </button>
      </div>
    );
  } else if (!snapshot) {
    center = (
      <div className="center-note loading">
        <i aria-hidden="true" />
        <p>{COPY.loading}</p>
      </div>
    );
  }

  return (
    <>
      <Brand
        ref={brandRef}
        snapshot={snapshot}
        projectName={projectName}
        projects={projects ?? []}
        currentId={projectId}
        reconnecting={!!snapshot && state.status === 'reconnecting'}
        onPick={pickProject}
        onLogout={onLogout}
      />
      <Actions ref={actionsRef} waiting={waitingIds.length} onWaiting={nextWaiting} onOverview={overview} />
      <Toasts items={toasts} onOpen={focus} />
      {snapshot && <Card snapshot={snapshot} node={focusedNode} onClose={overview} onFocus={focus} onResolve={resolve} />}
      {demo && (
        <div className="hud note" ref={noteRef}>
          {COPY.demoNote}
        </div>
      )}
      {snapshot && <Rail ref={railRef} snapshot={snapshot} selected={stageSel} onStage={flyStage} />}
      {center}
    </>
  );
}
