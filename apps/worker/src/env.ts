import type { Role } from '@dagyard/model';
import type { Store } from './db.js';
import type { ProjectRoom } from './room.js';

export interface Env {
  /** el SQL de Dagyard (DO singleton con SQLite; sin D1) */
  STORE: DurableObjectNamespace<Store>;
  PROJECT_ROOM: DurableObjectNamespace<ProjectRoom>;
  ASSETS: Fetcher;
  /** sha corto del deploy; `dev` en local */
  VERSION?: string;
  /** orígenes extra (por comas) que pueden abrir el WebSocket con la cookie; el mismo origen ya vale */
  ALLOWED_ORIGINS?: string;
  OWNER_TOKEN: string;
  AGENT_KEY: string;
  VAULT_KEY: string;
}

/** `session`: hash del id de la sesión del navegador, si la auth vino por cookie. */
export type AppEnv = { Bindings: Env; Variables: { role: Role; session?: string } };
