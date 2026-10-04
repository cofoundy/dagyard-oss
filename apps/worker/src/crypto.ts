/** Comparación en tiempo constante, cifrado AES-GCM de accesos e ids de sesión. */
const enc = new TextEncoder();

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', enc.encode(s));
}

/** Compara dos secretos sin filtrar por tiempo ni el largo (compara sus SHA-256). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(x, y);
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const c of bytes) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Id de una sesión del navegador: 256 bits aleatorios en base64url. Solo viaja en la cookie. */
export function newSessionId(): string {
  return b64(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 en base64url: lo único que el Store guarda de un id de sesión (nunca el id). */
export async function digest(s: string): Promise<string> {
  return b64(await sha256(s));
}

/** Huella del token de dueño que se guarda con cada sesión: si se rota el token, las sesiones mueren. */
export const ownerFingerprint = (ownerToken: string) => digest(`dagyard-owner-v1:${ownerToken}`);

async function vaultKey(secret: string | undefined): Promise<CryptoKey> {
  // falla cerrado: sin clave no se cifra ni se descifra nada (nunca con una clave derivada de "")
  if (!secret) throw new Error('VAULT_KEY no está configurada');
  return crypto.subtle.importKey('raw', await sha256(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * `v1.<iv>.<cifrado>` en base64url. `aad` (p. ej. `<pid>/<bid>`) amarra el valor a su bloqueante:
 * copiado a otra fila, no descifra.
 */
export async function seal(secret: string | undefined, plain: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, await vaultKey(secret), enc.encode(plain));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function unseal(secret: string | undefined, sealed: string, aad: string): Promise<string> {
  const [v, iv, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('formato de acceso cifrado desconocido');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(aad) }, await vaultKey(secret), unb64(ct));
  return new TextDecoder().decode(pt);
}

export function randomId(prefix: string): string {
  return prefix + b64(crypto.getRandomValues(new Uint8Array(12))).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
}
