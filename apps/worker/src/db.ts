/**
 * Shim compatible con el subconjunto de D1 que usa el Worker (`prepare/bind/first/all/run/batch`),
 * sobre un Durable Object `Store` singleton con SQLite. Cada llamada es una RPC; `batch` corre en una
 * transacción (`transactionSync`), así que es atómico como en D1.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.js';
import { MIGRATIONS } from './schema.js';

export type SqlValue = string | number | null;
export type Row = Record<string, unknown>;
export interface Query {
  sql: string;
  params: SqlValue[];
}

export interface Stmt {
  readonly query: Query;
  bind(...params: unknown[]): Stmt;
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<{ results: T[] }>;
  run(): Promise<{ results: Row[] }>;
}

export interface Db {
  prepare(sql: string): Stmt;
  batch<T = Row>(stmts: Stmt[]): Promise<Array<{ results: T[] }>>;
}

const toParam = (v: unknown): SqlValue => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new TypeError(`parámetro SQL no soportado: ${typeof v}`);
};

class StoreStmt implements Stmt {
  constructor(
    private readonly db: StoreDb,
    readonly query: Query,
  ) {}
  bind(...params: unknown[]): Stmt {
    return new StoreStmt(this.db, { sql: this.query.sql, params: params.map(toParam) });
  }
  async all<T = Row>(): Promise<{ results: T[] }> {
    const [r] = await this.db.batch<T>([this]);
    return r!;
  }
  async first<T = Row>(): Promise<T | null> {
    return (await this.all<T>()).results[0] ?? null;
  }
  run(): Promise<{ results: Row[] }> {
    return this.all<Row>();
  }
}

class StoreDb implements Db {
  constructor(private readonly ns: DurableObjectNamespace<Store>) {}
  prepare(sql: string): Stmt {
    return new StoreStmt(this, { sql, params: [] });
  }
  async batch<T = Row>(stmts: Stmt[]): Promise<Array<{ results: T[] }>> {
    if (!stmts.length) return [];
    const rows = (await this.ns.get(this.ns.idFromName('main')).batch(stmts.map((s) => s.query))) as T[][];
    return rows.map((results) => ({ results }));
  }
}

const cache = new WeakMap<object, Db>();

/** El Db del entorno (uno por objeto `env`). */
export function db(env: Pick<Env, 'STORE'>): Db {
  let d = cache.get(env);
  if (!d) cache.set(env, (d = new StoreDb(env.STORE)));
  return d;
}

/** Dueño único del SQL de Dagyard. Single-thread: cada batch es una transacción. */
export class Store extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    ctx.storage.transactionSync(() => {
      sql.exec('CREATE TABLE IF NOT EXISTS _schema (version INTEGER NOT NULL)');
      const current = Number(sql.exec<{ v: number | null }>('SELECT MAX(version) AS v FROM _schema').one().v ?? 0);
      MIGRATIONS.forEach((stmts, i) => {
        if (i + 1 <= current) return;
        for (const s of stmts) sql.exec(s);
        sql.exec('INSERT INTO _schema (version) VALUES (?)', i + 1);
      });
    });
  }

  batch(queries: Query[]): Row[][] {
    const sql = this.ctx.storage.sql;
    return this.ctx.storage.transactionSync(() => queries.map((q) => sql.exec(q.sql, ...q.params).toArray() as Row[]));
  }
}
