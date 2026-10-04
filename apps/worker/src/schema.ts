/**
 * Esquema del DO `Store` (SQLite). Cada versión es una lista de sentencias; se aplican en orden y una
 * sola vez (tabla `_schema`). Para cambiar el esquema, agrega una versión nueva: nunca edites una aplicada.
 */
export const MIGRATIONS: string[][] = [
  // v1
  [
    `CREATE TABLE projects (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       stages TEXT NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
    `CREATE TABLE nodes (
       project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       id TEXT NOT NULL,
       stage TEXT NOT NULL,
       title TEXT NOT NULL,
       status TEXT NOT NULL CHECK (status IN ('pending', 'working', 'blocked', 'done')),
       progress REAL NOT NULL DEFAULT 0,
       team TEXT,
       goal TEXT,
       report_url TEXT,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (project_id, id)
     )`,
    `CREATE TABLE edges (
       project_id TEXT NOT NULL,
       from_id TEXT NOT NULL,
       to_id TEXT NOT NULL,
       PRIMARY KEY (project_id, from_id, to_id),
       FOREIGN KEY (project_id, from_id) REFERENCES nodes(project_id, id) ON DELETE CASCADE,
       FOREIGN KEY (project_id, to_id) REFERENCES nodes(project_id, id) ON DELETE CASCADE
     )`,
    `CREATE TABLE blockers (
       id TEXT PRIMARY KEY,
       project_id TEXT NOT NULL,
       node_id TEXT NOT NULL,
       kind TEXT NOT NULL CHECK (kind IN ('decision', 'review', 'access')),
       question TEXT NOT NULL,
       options TEXT NOT NULL,
       access_label TEXT,
       status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
       resolution TEXT,
       resolved_by TEXT,
       resolved_at TEXT,
       access_value TEXT, -- AES-GCM con VAULT_KEY: nunca sale en snapshots ni eventos
       created_at TEXT NOT NULL,
       FOREIGN KEY (project_id, node_id) REFERENCES nodes(project_id, id) ON DELETE CASCADE
     )`,
    `CREATE INDEX blockers_project ON blockers(project_id, node_id)`,
    `CREATE TABLE messages (
       id TEXT PRIMARY KEY,
       project_id TEXT NOT NULL,
       node_id TEXT NOT NULL,
       from_name TEXT NOT NULL,
       text TEXT NOT NULL,
       report_url TEXT,
       created_at TEXT NOT NULL,
       FOREIGN KEY (project_id, node_id) REFERENCES nodes(project_id, id) ON DELETE CASCADE
     )`,
    `CREATE INDEX messages_project ON messages(project_id, created_at)`,
    `CREATE TABLE events (
       project_id TEXT NOT NULL,
       seq INTEGER NOT NULL,
       type TEXT NOT NULL,
       actor TEXT NOT NULL,
       at TEXT NOT NULL,
       payload TEXT NOT NULL,
       PRIMARY KEY (project_id, seq)
     )`,
  ],
  // v2: sesiones del navegador (#12). La cookie lleva un id aleatorio; aquí solo su SHA-256.
  [
    `CREATE TABLE sessions (
       id_hash TEXT PRIMARY KEY,
       owner_fp TEXT NOT NULL, -- huella del OWNER_TOKEN con que se abrió: rotarlo invalida la sesión
       created_at TEXT NOT NULL,
       expires_at TEXT NOT NULL
     )`,
    `CREATE INDEX sessions_expires ON sessions(expires_at)`,
  ],
];
