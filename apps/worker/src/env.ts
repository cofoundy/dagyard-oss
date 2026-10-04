import type { Role } from '@dagyard/model';
import type { ProjectRoom } from './room.js';

export interface Env {
  DB: D1Database;
  PROJECT_ROOM: DurableObjectNamespace<ProjectRoom>;
  ASSETS: Fetcher;
  /** sha corto del deploy; `dev` en local */
  VERSION?: string;
  OWNER_TOKEN: string;
  AGENT_KEY: string;
  VAULT_KEY: string;
}

export type AppEnv = { Bindings: Env; Variables: { role: Role } };
