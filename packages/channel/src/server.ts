/** El server MCP: capability `claude/channel`, la tool `reply` y el envío de notificaciones. */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApiRequestError, type DagyardClient } from '../../cli/src/api.js';
import type { ChannelNotification } from './notify.js';
import { composeReply, REPLY_TOOL, ReplyError } from './reply.js';
import type { Log } from './log.js';

export const SERVER_NAME = 'dagyard';
export const VERSION = '0.1.0';

export const INSTRUCTIONS = `Dagyard es el panel donde el dueño (un PM) ve el plan y resuelve lo que lo bloquea.
Cuando el dueño resuelve un bloqueante de un nodo, llega un evento <channel source="${SERVER_NAME}" node="…" blocker="…" kind="…">:
léelo y sigue con ese nodo según lo que dice. Si kind="access", el valor nunca viene en el evento: corre el comando dagyard wait que trae.
Para avisarle al dueño qué hiciste o qué duda te queda, usa la tool reply con campos cortos, en español y sin jerga técnica.`;

export interface ChannelServerDeps {
  client: Pick<DagyardClient, 'postMessage'>;
  projectId: string;
  log: Log;
}

export function createChannelServer(deps: ChannelServerDeps): Server {
  const mcp = new Server(
    { name: SERVER_NAME, version: VERSION },
    { capabilities: { experimental: { 'claude/channel': {} }, tools: {} }, instructions: INSTRUCTIONS },
  );
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [REPLY_TOOL] }));
  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== REPLY_TOOL.name) return toolError(`no conozco la tool «${req.params.name}»`);
    return handleReply(deps, req.params.arguments);
  });
  return mcp;
}

export async function handleReply(deps: ChannelServerDeps, args: unknown): Promise<CallToolResult> {
  let composed;
  try {
    composed = composeReply(args);
  } catch (err) {
    if (err instanceof ReplyError) return toolError(err.message);
    throw err;
  }
  try {
    const msg = await deps.client.postMessage(deps.projectId, composed.nodeId, composed.input);
    deps.log(`reply publicado en ${composed.nodeId} (${msg?.id ?? 'sin id'})`);
    return { content: [{ type: 'text', text: `Listo: el dueño ya ve tu mensaje en el nodo ${composed.nodeId}.` }] };
  } catch (err) {
    const why = err instanceof ApiRequestError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
    deps.log(`reply falló en ${composed.nodeId}: ${why}`);
    return toolError(`Dagyard no aceptó el mensaje (${why})`);
  }
}

export function sendChannel(mcp: Server, n: ChannelNotification): Promise<void> {
  return mcp.notification({ method: 'notifications/claude/channel', params: { content: n.content, meta: n.meta } });
}

function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}
