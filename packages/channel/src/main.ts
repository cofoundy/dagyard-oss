/**
 * `dagyard-channel`: server MCP stdio que Claude Code carga como channel
 * (`claude --dangerously-load-development-channels server:dagyard`). Escucha el tiempo real del
 * proyecto y empuja a la sesión cada bloqueante que el dueño resuelve en sus nodos.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DagyardClient } from '../../cli/src/api.js';
import { ConfigError, loadChannelConfig } from './config.js';
import { LiveClient } from './live.js';
import { makeLog } from './log.js';
import { toNotification } from './notify.js';
import { createChannelServer, sendChannel } from './server.js';

async function main(): Promise<void> {
  let cfg;
  try {
    cfg = loadChannelConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      makeLog(null)(err.message);
      process.exit(64);
    }
    throw err;
  }
  const log = makeLog(cfg.key);
  const client = new DagyardClient({ baseUrl: cfg.url, key: cfg.key });
  const mcp = createChannelServer({ client, projectId: cfg.project, log });
  await mcp.connect(new StdioServerTransport());

  const titles = new Map<string, string>();
  const live = new LiveClient({
    baseUrl: cfg.url,
    key: cfg.key,
    projectId: cfg.project,
    log,
    loadSnapshot: () => client.snapshot(cfg.project),
    onSnapshot: (snap) => {
      titles.clear();
      for (const n of snap.nodes) titles.set(n.id, n.title);
    },
    onEvent: (ev) => {
      if (ev.type === 'node.added' || ev.type === 'node.updated') titles.set(ev.payload.node.id, ev.payload.node.title);
      const n = toNotification(ev, { projectId: cfg.project, nodes: cfg.nodes, titleOf: (id) => titles.get(id) });
      if (!n) return;
      log(`resolución de ${n.meta.node} (${n.meta.kind}, ${n.meta.blocker}) → sesión`);
      sendChannel(mcp, n).catch((err) => log(`no pude avisar a la sesión: ${err instanceof Error ? err.message : String(err)}`));
    },
  });
  live.start();
  const filtro = cfg.nodes ? `nodos ${[...cfg.nodes].join(', ')}` : 'todos los nodos';
  log(`escuchando ${cfg.project} en ${cfg.url} (${filtro})`);

  let closing = false;
  const shutdown = (why: string) => {
    if (closing) return;
    closing = true;
    log(`cierro: ${why}`);
    live.stop();
    void mcp.close().finally(() => process.exit(0));
  };
  mcp.onclose = () => shutdown('se cerró la conexión MCP');
  // el transporte stdio no avisa el EOF: si Claude Code muere, salimos igual y no queda un WS huérfano
  process.stdin.once('end', () => shutdown('stdin cerrado'));
  process.stdin.once('close', () => shutdown('stdin cerrado'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  process.stderr.write(`dagyard-channel: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
