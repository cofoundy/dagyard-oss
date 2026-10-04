import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadChannelConfig, parseNodes } from '../src/config.js';
import { makeLog } from '../src/log.js';

describe('config', () => {
  it('env manda; DAGYARD_NODES se normaliza como el CLI', () => {
    const c = loadChannelConfig({
      DAGYARD_CONFIG_DIR: '/no/existe',
      DAGYARD_URL: 'https://x.dev/',
      DAGYARD_KEY: 'k',
      DAGYARD_PROJECT: 'p',
      DAGYARD_NODES: ' T-314-A, pagos ,, ***',
    });
    expect(c).toEqual({ url: 'https://x.dev', key: 'k', project: 'p', nodes: new Set(['t-314-a', 'pagos']) });
  });

  it('cae a ~/.config/dagyard/* y sin filtro = todos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dagyard-ch-'));
    writeFileSync(join(dir, 'url'), 'https://y.dev\n');
    writeFileSync(join(dir, 'agent-key'), 'clave\n');
    writeFileSync(join(dir, 'project'), 'demo\n');
    const c = loadChannelConfig({ DAGYARD_CONFIG_DIR: dir });
    expect(c).toMatchObject({ url: 'https://y.dev', key: 'clave', project: 'demo', nodes: null });
  });

  it('dice qué falta', () => {
    expect(() => loadChannelConfig({ DAGYARD_CONFIG_DIR: '/no/existe', DAGYARD_URL: 'https://x' })).toThrow(ConfigError);
    expect(() => loadChannelConfig({ DAGYARD_CONFIG_DIR: '/no/existe' })).toThrow(/DAGYARD_KEY/);
  });

  it('parseNodes vacío → null', () => {
    expect(parseNodes(undefined)).toBeNull();
    expect(parseNodes(' , ')).toBeNull();
  });

  it('el log tapa la key', () => {
    const out: string[] = [];
    makeLog('sekreto', (s) => out.push(s))('falló con token.sekreto');
    expect(out.join('')).toBe('dagyard-channel: falló con token.***\n');
  });
});
