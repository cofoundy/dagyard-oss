import type { Role } from '@dagyard/model';
import type { AuthVia } from './auth.js';
import type { Store } from './db.js';
import type { ProjectRoom } from './room.js';
import type { Idem } from './writes.js';

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

/** `via`: por dónde llegó la credencial. `session`: hash del id de la sesión del navegador, si la auth vino por cookie. `idem`: la `Idempotency-Key` del pedido y su huella. */
export type AppEnv = { Bindings: Env; Variables: { role: Role; via: AuthVia; session?: string; idem?: Idem } };
