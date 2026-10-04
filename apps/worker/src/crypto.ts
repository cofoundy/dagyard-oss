/** Comparación en tiempo constante, cifrado AES-GCM de accesos y sesión firmada. */
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

/** Valor de la cookie `dagyard_session`: HMAC del token de dueño, nunca el token mismo. */
export async function sessionValue(ownerToken: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(ownerToken), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode('dagyard-session-v1')));
}

async function vaultKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', await sha256(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** `v1.<iv>.<cifrado>` en base64url. */
export async function seal(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vaultKey(secret), enc.encode(plain));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function unseal(secret: string, sealed: string): Promise<string> {
  const [v, iv, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('formato de acceso cifrado desconocido');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await vaultKey(secret), unb64(ct));
  return new TextDecoder().decode(pt);
}

export function randomId(prefix: string): string {
  return prefix + b64(crypto.getRandomValues(new Uint8Array(12))).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
}
