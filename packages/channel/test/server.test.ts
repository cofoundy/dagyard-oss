// El server MCP de punta a punta por un transporte en memoria: capability, tool reply y notificación.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { toNotification } from '../src/notify.js';
import { createChannelServer, sendChannel } from '../src/server.js';
import { PID, resolved } from './fixtures.js';

const ChannelNotification = z.object({
  method: z.literal('notifications/claude/channel'),
  params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()) }),
});

async function connect() {
  const postMessage = vi.fn(async (_p: string, nodeId: string) => ({ id: 'm_1', nodeId }) as never);
  const server = createChannelServer({ client: { postMessage }, projectId: PID, log: () => {} });
  const client = new Client({ name: 'test', version: '0' });
  const received: Array<z.infer<typeof ChannelNotification>['params']> = [];
  client.setNotificationHandler(ChannelNotification, (n) => {
    received.push(n.params);
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { server, client, received, postMessage };
}

describe('server MCP', () => {
  it('declara claude/channel e instrucciones', async () => {
    const { client } = await connect();
    expect(client.getServerCapabilities()?.experimental).toHaveProperty('claude/channel');
    expect(client.getInstructions()).toContain('reply');
  });

  it('lista y ejecuta reply', async () => {
    const { client, postMessage } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['reply']);
    expect(tools[0]!.inputSchema.required).toEqual(['node', 'hice']);
    const ok = await client.callTool({ name: 'reply', arguments: { node: 'pagos', hice: 'Conecté Yape' } });
    expect(ok.isError).toBeFalsy();
    expect(postMessage).toHaveBeenCalledWith(PID, 'pagos', { text: 'Conecté Yape' });
    const bad = await client.callTool({ name: 'reply', arguments: { node: 'pagos', hice: 'x'.repeat(300) } });
    expect(bad.isError).toBe(true);
  });

  it('la resolución llega a la sesión como notifications/claude/channel', async () => {
    const { server, received } = await connect();
    await sendChannel(server, toNotification(resolved(3), { projectId: PID, nodes: null })!);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]!.meta).toEqual({ project: PID, node: 'pagos', blocker: 'b_123', kind: 'decision' });
    expect(received[0]!.content).toContain('Elección: Yape');
  });
});
