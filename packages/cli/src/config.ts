import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  url: string | null;
  key: string | null;
  project: string | null;
}

/**
 * Env primero (`DAGYARD_URL`, `DAGYARD_KEY`, `DAGYARD_PROJECT`); si falta, los archivos de
 * `~/.config/dagyard/` (`url`, `agent-key`, `project`). `DAGYARD_CONFIG_DIR` cambia esa carpeta.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dir = env.DAGYARD_CONFIG_DIR || join(homedir(), '.config', 'dagyard');
  const fromFile = (name: string): string | null => {
    try {
      return readFileSync(join(dir, name), 'utf8').trim() || null;
    } catch {
      return null;
    }
  };
  return {
    url: env.DAGYARD_URL?.trim() || fromFile('url'),
    key: env.DAGYARD_KEY?.trim() || fromFile('agent-key'),
    project: env.DAGYARD_PROJECT?.trim() || fromFile('project'),
  };
}
