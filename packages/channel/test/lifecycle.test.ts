// El proceso real: si Claude Code muere (stdin EOF), el channel sale y no deja un WebSocket huérfano.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';

let bundle = '';
beforeAll(async () => {
  bundle = join(mkdtempSync(join(tmpdir(), 'dagyard-channel-')), 'main.mjs');
  await build({
    entryPoints: [join(import.meta.dirname, '../src/main.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: { js: "import { createRequire as __cr } from 'node:module';\nconst require = __cr(import.meta.url);" },
    logLevel: 'silent',
  });
});

describe('ciclo de vida del proceso', () => {
  it('sale con 0 cuando se cierra stdin, aunque esté reintentando la conexión', async () => {
    const child = spawn(process.execPath, [bundle], {
      env: {
        ...process.env,
        // puerto cerrado: el channel queda reintentando con timers vivos
        DAGYARD_URL: 'http://127.0.0.1:1',
        DAGYARD_KEY: 'k',
        DAGYARD_PROJECT: 'demo',
        DAGYARD_CONFIG_DIR: '/no/existe',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } };
    child.stdin.write(`${JSON.stringify(init)}\n`);
    await new Promise<void>((r) => child.stdout.once('data', () => r()));
    child.stdin.end();
    const code = await new Promise<number | null>((resolve) => {
      const t = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(null);
      }, 3000);
      child.once('exit', (c) => {
        clearTimeout(t);
        resolve(c);
      });
    });
    expect(code).toBe(0);
  }, 15_000);
});
