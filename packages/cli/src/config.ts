import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { UsageError } from './args.js';

export interface Config {
  url: string | null;
  key: string | null;
  project: string | null;
}

/** El archivo por repo: `{"project": "…", "url": "…"}`. Se commitea, así que nunca trae la key. */
export const REPO_CONFIG = '.dagyard.json';

/**
 * Precedencia (las flags las aplica quien llama): env (`DAGYARD_URL`, `DAGYARD_PROJECT`) >
 * `.dagyard.json` (el primero subiendo desde `cwd`) > `~/.config/dagyard/{url,project}`.
 * La key sale solo de `DAGYARD_KEY` o `~/.config/dagyard/agent-key`. `DAGYARD_CONFIG_DIR` cambia esa carpeta.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): Config {
  const repo = readRepoConfig(cwd);
  return {
    url: env.DAGYARD_URL?.trim() || repo?.url || fromConfigDir(env, 'url'),
    key: loadKey(env),
    project: env.DAGYARD_PROJECT?.trim() || repo?.project || fromConfigDir(env, 'project'),
  };
}

/** Solo la key: no lee `.dagyard.json`, así un archivo roto no tapa la ayuda ni el redactado de errores. */
export function loadKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.DAGYARD_KEY?.trim() || fromConfigDir(env, 'agent-key');
}

/** El `.dagyard.json` más cercano subiendo desde `cwd` hasta la raíz; `null` si no hay ninguno. */
export function findRepoConfig(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, REPO_CONFIG);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // no está aquí: sigue subiendo
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function readRepoConfig(cwd: string): { project: string | null; url: string | null } | null {
  const path = findRepoConfig(cwd);
  if (!path) return null;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new UsageError(`${path} no es JSON válido (${err instanceof Error ? err.message : String(err)}); debe ser {"project": "…", "url": "…"}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new UsageError(`${path} debe ser un objeto {"project": "…", "url": "…"}`);
  }
  const o = data as Record<string, unknown>;
  const field = (k: 'project' | 'url'): string | null => {
    const v = o[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') throw new UsageError(`${path}: "${k}" debe ser texto`);
    return v.trim() || null;
  };
  return { project: field('project'), url: field('url') };
}

function fromConfigDir(env: NodeJS.ProcessEnv, name: string): string | null {
  const dir = env.DAGYARD_CONFIG_DIR || join(homedir(), '.config', 'dagyard');
  try {
    return readFileSync(join(dir, name), 'utf8').trim() || null;
  } catch {
    return null;
  }
}
