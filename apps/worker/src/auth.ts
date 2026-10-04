import type { Role } from '@dagyard/model';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { safeEqual, sessionValue } from './crypto.js';
import type { AppEnv, Env } from './env.js';
import { fail } from './http.js';

export const SESSION_COOKIE = 'dagyard_session';

/** El rol de un token, o null. Prueba los dos secrets siempre (sin atajos que filtren cuál es). */
export async function roleOfToken(env: Env, token: string): Promise<Role | null> {
  const [owner, agent] = await Promise.all([safeEqual(token, env.OWNER_TOKEN), safeEqual(token, env.AGENT_KEY)]);
  return owner ? 'owner' : agent ? 'agent' : null;
}

export const WS_PROTOCOL = 'dagyard';

/** Subprotocolos ofrecidos en el upgrade: `['dagyard', 'token.<token>']`. */
export function offeredProtocols(header: string | undefined): string[] {
  return (header ?? '').split(',').map((p) => p.trim()).filter(Boolean);
}

/**
 * Orden del contrato: `Authorization: Bearer`, cookie `dagyard_session` y, solo en el upgrade del
 * WebSocket, el subprotocolo `token.<token>` o, como último recurso, `?token=`.
 */
export async function authenticate(c: Context<AppEnv>, opts: { websocket?: boolean } = {}): Promise<Role | null> {
  const env = c.env;
  if (!env.OWNER_TOKEN || !env.AGENT_KEY) return null;
  const header = c.req.header('authorization');
  if (header) {
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    return m ? roleOfToken(env, m[1]!.trim()) : null;
  }
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) return (await safeEqual(cookie, await sessionValue(env.OWNER_TOKEN))) ? 'owner' : null;
  if (!opts.websocket) return null;
  const sub = offeredProtocols(c.req.header('sec-websocket-protocol')).find((p) => p.startsWith('token.'));
  if (sub) return roleOfToken(env, sub.slice('token.'.length));
  const q = c.req.query('token');
  if (q) return roleOfToken(env, q);
  return null;
}

export function requireOwner(c: Context<AppEnv>, what: string): void {
  if (c.get('role') !== 'owner') fail('forbidden', `${what} es solo del dueño`);
}
