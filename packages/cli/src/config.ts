import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { UsageError } from './args.js';

export interface Config {
  url: string | null;
  key: string | null;
  project: string | null;
}

export interface LoadOptions {
  /** avisos (una url de `.dagyard.json` ignorada); default: stderr del proceso */
  warn?: (message: string) => void;
  /** quien llama ya tiene la url (`--url`) o no la necesita: la del archivo ni se evalúa */
  skipRepoUrl?: boolean;
}

/** El archivo por repo: `{"project": "…", "url": "…"}`. Se commitea, así que nunca trae la key. */
export const REPO_CONFIG = '.dagyard.json';

/**
 * Orígenes a los que la `url` de un `.dagyard.json` puede mandar la key sin más. Un repo clonado puede
 * traer cualquier `.dagyard.json`: su url solo vale si es https y su origen es uno de estos, el de
 * `DAGYARD_URL` / `~/.config/dagyard/url` o una línea de `~/.config/dagyard/trusted-urls` (#50).
 */
export const TRUSTED_ORIGINS: readonly string[] = ['https://dagyard.cofoundy-dev.workers.dev', 'https://dagyard.run'];

/**
 * Precedencia (las flags las aplica quien llama): env (`DAGYARD_URL`, `DAGYARD_PROJECT`) >
 * `.dagyard.json` (el primero subiendo desde `cwd`, sin pasar de la raíz del repo ni de `$HOME`; su url
 * solo si es de confianza) > `~/.config/dagyard/{url,project}`.
 * La key sale solo de `DAGYARD_KEY` o `~/.config/dagyard/agent-key`. `DAGYARD_CONFIG_DIR` cambia esa carpeta.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd(), opts: LoadOptions = {}): Config {
  const repo = readRepoConfig(cwd, env.HOME || homedir());
  const envUrl = env.DAGYARD_URL?.trim();
  let repoUrl: string | null = null;
  if (repo?.url && !envUrl && !opts.skipRepoUrl) {
    if (isTrustedUrl(repo.url, env)) repoUrl = repo.url;
    else {
      const warn = opts.warn ?? ((m: string) => process.stderr.write(m));
      warn(
        `dagyard: ignoro la url de ${repo.path} («${repo.url}»): no es https o su origen no es de confianza. ` +
          `Si es tuya, agrégala a ${join(configDir(env), 'trusted-urls')}.\n`,
      );
    }
  }
  return {
    url: envUrl || repoUrl || fromConfigDir(env, 'url'),
    key: loadKey(env),
    project: env.DAGYARD_PROJECT?.trim() || repo?.project || fromConfigDir(env, 'project'),
  };
}

/** Solo la key: no lee `.dagyard.json`, así un archivo roto no tapa la ayuda ni el redactado de errores. */
export function loadKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.DAGYARD_KEY?.trim() || fromConfigDir(env, 'agent-key');
}

/** https, sin credenciales en la URL y con un origen de confianza (ver `TRUSTED_ORIGINS`). */
export function isTrustedUrl(raw: string, env: NodeJS.ProcessEnv = process.env): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const trusted = new Set(TRUSTED_ORIGINS);
  const extra = [
    env.DAGYARD_URL,
    fromConfigDir(env, 'url'),
    ...(fromConfigDir(env, 'trusted-urls') ?? '').split(/\r?\n/).filter((l) => !l.trim().startsWith('#')),
  ];
  for (const s of extra) {
    const o = originOf(s?.trim());
    if (o) trusted.add(o);
  }
  return trusted.has(u.origin);
}

function originOf(s: string | undefined): string | null {
  if (!s) return null;
  try {
    const o = new URL(s).origin;
    return o === 'null' ? null : o;
  } catch {
    return null;
  }
}

/**
 * El `.dagyard.json` más cercano subiendo desde `cwd`; `null` si no hay. Nunca pasa de la raíz del repo
 * (el primer directorio con `.git`, carpeta o archivo) ni de `home`: uno plantado más arriba no cuenta.
 */
export function findRepoConfig(cwd: string, home: string = homedir()): string | null {
  let dir = resolve(cwd);
  const stop = resolve(home);
  for (;;) {
    const candidate = join(dir, REPO_CONFIG);
    if (isFile(candidate)) return candidate;
    if (exists(join(dir, '.git')) || dir === stop) return null;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function readRepoConfig(cwd: string, home: string): { path: string; project: string | null; url: string | null } | null {
  const path = findRepoConfig(cwd, home);
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
  return { path, project: field('project'), url: field('url') };
}

function configDir(env: NodeJS.ProcessEnv): string {
  return env.DAGYARD_CONFIG_DIR || join(homedir(), '.config', 'dagyard');
}

function fromConfigDir(env: NodeJS.ProcessEnv, name: string): string | null {
  try {
    return readFileSync(join(configDir(env), name), 'utf8').trim() || null;
  } catch {
    return null;
  }
}
