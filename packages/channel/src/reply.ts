/** Tool `reply` (D6): campos cortos → un mensaje ≤280 caracteres al PM. */
import { LIMITS, slugify, type MessageInput } from '@dagyard/model';

export const REPLY_TOOL = {
  name: 'reply',
  description:
    'Avísale al dueño (el PM) en Dagyard qué hiciste en un nodo. Campos cortos, en español y sin jerga técnica: ' +
    `el texto final (hice + duda) no puede pasar de ${LIMITS.message} caracteres.`,
  inputSchema: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'id del nodo (el atributo node del evento del canal)' },
      hice: { type: 'string', description: 'qué hiciste, en una frase' },
      duda: { type: 'string', description: 'opcional: la duda que le queda al dueño, en una frase' },
      reporte: { type: 'string', description: 'opcional: URL del reporte (Basalt), http(s)://…' },
    },
    required: ['node', 'hice'],
    additionalProperties: false,
  },
} as const;

export class ReplyError extends Error {
  override name = 'ReplyError';
}

export interface ReplyArgs {
  node: string;
  hice: string;
  duda?: string;
  reporte?: string;
}

export interface ComposedReply {
  nodeId: string;
  input: MessageInput;
}

export function composeReply(raw: unknown): ComposedReply {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const node = text(a.node, 'node', true);
  // misma regla que el CLI: slugify('***') daría 'x', un nodo que no existe
  if (!/[a-z0-9]/i.test(node.normalize('NFD'))) throw new ReplyError(`«${node}» no sirve como id de nodo`);
  const nodeId = slugify(node);
  const hice = text(a.hice, 'hice', true);
  const duda = text(a.duda, 'duda', false);
  const reporte = text(a.reporte, 'reporte', false);
  const body = duda ? `${sentence(hice)} Duda: ${duda}` : hice;
  if (body.length > LIMITS.message) {
    throw new ReplyError(
      `el mensaje queda en ${body.length} caracteres y el máximo es ${LIMITS.message}: acorta «hice»${duda ? ' o «duda»' : ''} y vuelve a llamar a reply`,
    );
  }
  const input: MessageInput = { text: body };
  if (reporte) {
    if (!/^https?:\/\/\S+$/i.test(reporte)) throw new ReplyError('«reporte» debe ser una URL que empiece con http:// o https://');
    if (reporte.length > LIMITS.url) throw new ReplyError(`«reporte» pasa de ${LIMITS.url} caracteres`);
    input.reportUrl = reporte;
  }
  return { nodeId, input };
}

function text(v: unknown, field: string, required: boolean): string {
  if (v === undefined || v === null) {
    if (required) throw new ReplyError(`falta «${field}»`);
    return '';
  }
  if (typeof v !== 'string') throw new ReplyError(`«${field}» debe ser texto`);
  const s = v.replace(/\s+/g, ' ').trim();
  if (required && !s) throw new ReplyError(`«${field}» está vacío`);
  return s;
}

/** Cierra la frase antes de pegarle la duda. */
function sentence(s: string): string {
  return /[.!?…)»"]$/.test(s) ? s : `${s}.`;
}
