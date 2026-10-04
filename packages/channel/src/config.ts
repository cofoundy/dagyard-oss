import { slugify } from '@dagyard/model';
// La misma resolución que el CLI (env primero, luego ~/.config/dagyard/*): una sola fuente.
import { loadConfig } from '../../cli/src/config.js';

export interface ChannelConfig {
  url: string;
  key: string;
  project: string;
  /** `DAGYARD_NODES`: solo estos nodos (ids ya normalizados). `null` = todos los del proyecto. */
  nodes: ReadonlySet<string> | null;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadChannelConfig(env: NodeJS.ProcessEnv = process.env): ChannelConfig {
  const base = loadConfig(env);
  const missing = [
    !base.url && 'DAGYARD_URL (o ~/.config/dagyard/url)',
    !base.key && 'DAGYARD_KEY (o ~/.config/dagyard/agent-key)',
    !base.project && 'DAGYARD_PROJECT (o ~/.config/dagyard/project)',
  ].filter(Boolean);
  if (missing.length) throw new ConfigError(`falta configurar: ${missing.join(', ')}`);
  return { url: base.url!.replace(/\/+$/, ''), key: base.key!, project: base.project!, nodes: parseNodes(env.DAGYARD_NODES) };
}

/** `"T-314-A, pagos"` → {`t-314-a`, `pagos`}, igual que el CLI normaliza un id de nodo. */
export function parseNodes(raw: string | undefined): ReadonlySet<string> | null {
  const ids = (raw ?? '').split(',').map((s) => s.trim()).filter((s) => /[a-z0-9]/i.test(s.normalize('NFD'))).map(slugify);
  return ids.length ? new Set(ids) : null;
}
