import type { Role } from '@dagyard/model';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { digest, newSessionId, ownerFingerprint, safeEqual } from './crypto.js';
import type { AppEnv, Env } from './env.js';
import { fail } from './http.js';

export const SESSION_COOKIE = 'dagyard_session';
/** Vida de una sesión: la misma en el servidor y en el `Max-Age` de la cookie. */
export const SESSION_TTL_S = 60 * 60 * 24 * 30;
/** Formato del id de sesión (32 bytes en base64url). Una cookie vieja (HMAC) o rara no llega al Store. */
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;

/** El rol de un token, o null. Prueba los dos secrets siempre (sin atajos que filtren cuál es). */
export async function roleOfToken(env: Env, token: string): Promise<Role | null> {
  const [owner, agent] = await Promise.all([safeEqual(token, env.OWNER_TOKEN), safeEqual(token, env.AGENT_KEY)]);
  return owner ? 'owner' : agent ? 'agent' : null;
}

/* ------------------------------------------------------------------ sesiones del navegador */

const store = (env: Env) => env.STORE.get(env.STORE.idFromName('db'));

/** Abre una sesión de dueño en el Store y devuelve el id que va en la cookie. */
export async function openSession(env: Env): Promise<string> {
  const id = newSessionId();
  await store(env).openSession(await digest(id), await ownerFingerprint(env.OWNER_TOKEN), SESSION_TTL_S * 1000);
  return id;
}

async function sessionIsLive(env: Env, id: string): Promise<boolean> {
  if (!SESSION_ID.test(id)) return false;
  return store(env).checkSession(await digest(id), await ownerFingerprint(env.OWNER_TOKEN));
}

export async function closeSession(env: Env, id: string): Promise<void> {
  if (SESSION_ID.test(id)) await store(env).closeSession(await digest(id));
}

export const closeAllSessions = (env: Env): Promise<number> => store(env).closeAllSessions();

/* ------------------------------------------------------------------ autenticación */

export const WS_PROTOCOL = 'dagyard';

/** Subprotocolos ofrecidos en el upgrade: `['dagyard', 'token.<token>']`. */
export function offeredProtocols(header: string | undefined): string[] {
  return (header ?? '').split(',').map((p) => p.trim()).filter(Boolean);
}

/** Por dónde llegó la credencial: el upgrade del WebSocket exige Origin solo si fue por cookie. */
export type AuthVia = 'bearer' | 'cookie' | 'protocol' | 'query';

/**
 * Orden del contrato: `Authorization: Bearer`, cookie `dagyard_session` y, solo en el upgrade del
 * WebSocket, el subprotocolo `token.<token>` o, como último recurso, `?token=`.
 */
export async function authenticate(c: Context<AppEnv>, opts: { websocket?: boolean } = {}): Promise<{ role: Role; via: AuthVia } | null> {
  const env = c.env;
  if (!env.OWNER_TOKEN || !env.AGENT_KEY) return null;
  const by = async (via: AuthVia, role: Role | null | Promise<Role | null>) => {
    const r = await role;
    return r ? { role: r, via } : null;
  };
  const header = c.req.header('authorization');
  if (header) {
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    return m ? by('bearer', roleOfToken(env, m[1]!.trim())) : null;
  }
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) return by('cookie', (await sessionIsLive(env, cookie)) ? 'owner' : null);
  if (!opts.websocket) return null;
  const sub = offeredProtocols(c.req.header('sec-websocket-protocol')).find((p) => p.startsWith('token.'));
  if (sub) return by('protocol', roleOfToken(env, sub.slice('token.'.length)));
  const q = c.req.query('token');
  if (q) return by('query', roleOfToken(env, q));
  return null;
}

/* ------------------------------------------------------------------ Origin del WebSocket (#14) */

const isLocalHost = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

/**
 * ¿Puede este `Origin` abrir el WebSocket con la cookie? Sí si es el mismo origen que la URL pedida,
 * si está en `ALLOWED_ORIGINS` (lista por comas) o, en dev, si ambos son localhost. Sin Origin, no.
 */
export function originAllowed(env: Env, requestUrl: string, origin: string | undefined): boolean {
  if (!origin) return false;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  const target = new URL(requestUrl);
  if (o.origin === target.origin) return true;
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.some((a) => URL.canParse(a) && new URL(a).origin === o.origin)) return true;
  return isLocalHost(target.hostname) && isLocalHost(o.hostname);
}

export function requireOwner(c: Context<AppEnv>, what: string): void {
  if (c.get('role') !== 'owner') fail('forbidden', `${what} es solo del dueño`);
}
