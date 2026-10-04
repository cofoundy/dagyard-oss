/**
 * Evento → notificación `notifications/claude/channel`. Lección de la sonda (T-canal): las
 * `instructions` del server solas no bastan; el `content` de cada evento dice qué hacer.
 */
import type { Blocker, DagEvent } from '@dagyard/model';

export interface ChannelNotification {
  /** lo que lee el modelo, en español */
  content: string;
  /** atributos del tag `<channel …>`: claves solo `[A-Za-z0-9_]` */
  meta: { project: string; node: string; blocker: string; kind: string };
}

export interface NotifyContext {
  projectId: string;
  /** `null` = todos los nodos */
  nodes: ReadonlySet<string> | null;
  /** título humano del nodo, si se conoce */
  titleOf?: (nodeId: string) => string | undefined;
}

/** Solo `blocker.resolved` hecho por el dueño, de un nodo filtrado; lo demás → `null`. */
export function toNotification(ev: DagEvent, ctx: NotifyContext): ChannelNotification | null {
  if (ev.type !== 'blocker.resolved' || ev.actor !== 'owner') return null;
  if (ev.projectId !== ctx.projectId) return null;
  const b = ev.payload.blocker;
  if (b.status !== 'resolved' || b.resolvedBy !== 'owner') return null;
  if (ctx.nodes && !ctx.nodes.has(b.nodeId)) return null;
  return {
    content: contentFor(b, ctx.projectId, ctx.titleOf?.(b.nodeId)),
    meta: { project: ctx.projectId, node: b.nodeId, blocker: b.id, kind: b.kind },
  };
}

function contentFor(b: Blocker, projectId: string, title: string | undefined): string {
  const tarea = title ? `«${title}» (nodo ${b.nodeId})` : `el nodo ${b.nodeId}`;
  const note = b.resolution?.note?.trim();
  const lines: string[] = [];
  if (b.kind === 'access') {
    lines.push(`El dueño ya dejó el acceso que pediste para ${tarea}: ${b.accessLabel ?? 'acceso'}.`);
    lines.push(`Pregunta: ${b.question}`);
    if (note) lines.push(`Nota del dueño: ${note}`);
    lines.push(
      `El valor no viaja por este canal. Para recibirlo corre: dagyard wait ${b.nodeId} --blocker ${b.id} --project ${projectId}`,
      `Después sigue con el nodo ${b.nodeId} usando ese acceso; no lo imprimas ni lo guardes en el repo.`,
    );
  } else {
    const verbo = b.kind === 'review' ? 'revisó' : 'decidió';
    lines.push(`El dueño ${verbo} el bloqueante de ${tarea}.`);
    lines.push(`Pregunta: ${b.question}`);
    lines.push(`Elección: ${b.resolution?.choice ?? '(sin elección)'}`);
    if (note) lines.push(`Nota del dueño: ${note}`);
    lines.push(`Sigue ahora con el nodo ${b.nodeId} según esa elección${note ? ' y la nota' : ''}.`);
  }
  lines.push(`Cuando tengas avance o una duda, avísale al dueño con la tool reply (node: ${b.nodeId}).`);
  return lines.join('\n');
}
