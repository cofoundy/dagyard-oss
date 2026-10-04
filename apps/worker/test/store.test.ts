import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { Store, db } from '../src/db.js';
import { uniquePid } from './helpers.js';

describe('Store (DO con SQLite, en vez de D1)', () => {
  it('batch es atómico: si una sentencia falla, no queda nada', async () => {
    const pid = uniquePid();
    const now = new Date().toISOString();
    const insert = db(env).prepare('INSERT INTO projects (id, name, stages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(pid, 'X', '[]', now, now);
    await expect(db(env).batch([insert, db(env).prepare('INSERT INTO tabla_que_no_existe VALUES (1)')])).rejects.toThrow();
    expect(await db(env).prepare('SELECT id FROM projects WHERE id = ?').bind(pid).first()).toBeNull();

    await db(env).batch([insert]);
    expect(await db(env).prepare('SELECT id FROM projects WHERE id = ?').bind(pid).first()).toEqual({ id: pid });
  });

  it('la migración se aplica una sola vez aunque el DO se vuelva a construir', async () => {
    await db(env).prepare('SELECT 1').first();
    // otra instancia sobre el mismo storage (lo que pasa tras un desalojo): vuelve a correr la migración
    await runInDurableObject(env.STORE.get(env.STORE.idFromName('db')), (_i, state) => {
      new Store(state, env);
    });
    const rows = await db(env).prepare('SELECT version FROM _schema ORDER BY version').all<{ version: number }>();
    expect(rows.results).toEqual([{ version: 1 }]);
  });
});
