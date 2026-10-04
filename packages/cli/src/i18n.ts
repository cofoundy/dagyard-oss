/**
 * Idioma de los mensajes para humanos (#73): inglés por defecto, español si el entorno lo pide.
 * `run` fija el idioma una vez (desde `io.env`) y todo lo que corre debajo lo lee con `t(en, es)`, aun
 * a través de `await`, sin pasarlo de función en función. Comandos, flags, JSON y exit codes no cambian;
 * lo que escribe una persona (títulos, mensajes) tampoco se traduce.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type Lang = 'en' | 'es';

/**
 * POSIX: `LC_ALL` > `LC_MESSAGES` > `LANG`, y manda el primero no vacío. `es`, `es_PE.UTF-8`, `es-419` → 'es';
 * todo lo demás (incluidos `C`, `POSIX` y nada) → 'en'.
 */
export function langFromEnv(env: Record<string, string | undefined>): Lang {
  const raw = [env.LC_ALL, env.LC_MESSAGES, env.LANG].map((v) => v?.trim() ?? '').find((v) => v !== '') ?? '';
  return /^es(?:$|[_.@-])/i.test(raw) ? 'es' : 'en';
}

const current = new AsyncLocalStorage<Lang>();

/** Corre `fn` con `lang` como idioma de todo lo que imprime (también lo asíncrono que lance). */
export function withLang<T>(lang: Lang, fn: () => T): T {
  return current.run(lang, fn);
}

/** El idioma vigente; fuera de `withLang`, inglés. */
export function lang(): Lang {
  return current.getStore() ?? 'en';
}

/** El texto en el idioma vigente. */
export function t(en: string, es: string): string {
  return lang() === 'es' ? es : en;
}

/** «1 task» / «3 tasks» en el idioma vigente. */
export function plural(n: number, en: [string, string], es: [string, string]): string {
  const [one, many] = lang() === 'es' ? es : en;
  return `${n} ${n === 1 ? one : many}`;
}
