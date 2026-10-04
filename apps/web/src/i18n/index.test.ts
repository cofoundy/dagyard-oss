import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectLang, fmtDate, fmtRelative, initLang, lang, onLangChange, setLang, STORAGE_KEY, t, useLang } from './index';
import { en, es } from './messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// el localStorage de Node tapa al de jsdom: uno en memoria, como un navegador limpio
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  setLang('en');
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('detectLang', () => {
  it('el primer es/en de la lista gana; lo demás se salta', () => {
    expect(detectLang(['es-PE'])).toBe('es');
    expect(detectLang(['en-US', 'es'])).toBe('en');
    expect(detectLang(['fr-FR', 'es-ES'])).toBe('es');
    expect(detectLang(['ES_mx'])).toBe('es');
    expect(detectLang(['de', 'pt-BR'])).toBe('en');
    expect(detectLang([])).toBe('en');
  });
});

describe('setLang / initLang', () => {
  it('persiste, notifica una vez por cambio y pone <html lang>', () => {
    const seen: string[] = [];
    const off = onLangChange(() => seen.push(lang()));
    setLang('es');
    setLang('es');
    expect(lang()).toBe('es');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(seen).toEqual(['es']);
    off();
    setLang('en');
    expect(seen).toEqual(['es']);
  });

  it('sin almacenamiento sigue funcionando', () => {
    const blocked = () => {
      throw new Error('bloqueado');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked });
    expect(() => setLang('es')).not.toThrow();
    expect(lang()).toBe('es');
    expect(() => initLang()).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(() => setLang('en')).not.toThrow();
    expect(lang()).toBe('en');
  });

  it('orden: elección guardada > navegador > en', () => {
    const langs = vi.spyOn(navigator, 'languages', 'get');
    langs.mockReturnValue(['es-PE']);
    expect(initLang()).toBe('es');
    localStorage.setItem(STORAGE_KEY, 'en');
    expect(initLang()).toBe('en');
    localStorage.removeItem(STORAGE_KEY);
    langs.mockReturnValue(['fr-FR']);
    expect(initLang()).toBe('en');
    localStorage.setItem(STORAGE_KEY, 'klingon');
    langs.mockReturnValue(['es']);
    expect(initLang()).toBe('es');
  });

  it('useLang re-pinta al cambiar sin recargar', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const Probe = () => createElement('span', null, `${useLang()}:${t('lang.name')}`);
    act(() => root.render(createElement(Probe)));
    expect(host.textContent).toBe('en:English');
    act(() => setLang('es'));
    expect(host.textContent).toBe('es:Español');
    act(() => root.unmount());
  });
});

describe('t', () => {
  it('ambos idiomas tienen las mismas claves', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it('usa el idioma actual o el pedido', () => {
    expect(t('time.justNow')).toBe('just now');
    expect(t('time.justNow', undefined, 'es')).toBe('hace un momento');
  });
});

describe('Intl', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  const ago = (s: number) => new Date(now - s * 1000).toISOString();

  it('fmtRelative en español', () => {
    expect(fmtRelative(ago(10), now, 'es')).toBe('hace un momento');
    expect(fmtRelative(ago(5 * 60), now, 'es')).toBe('hace 5 min');
    expect(fmtRelative(ago(2 * 3600), now, 'es')).toBe('hace 2 h');
    expect(fmtRelative(ago(30 * 3600), now, 'es')).toBe('ayer');
    expect(fmtRelative('2026-09-03T12:00:00Z', now, 'es')).toBe('3 set');
    expect(fmtRelative(undefined, now, 'es')).toBe('');
    expect(fmtRelative('no es fecha', now, 'es')).toBe('');
  });

  it('fmtRelative en inglés', () => {
    expect(fmtRelative(ago(10), now, 'en')).toBe('just now');
    expect(fmtRelative(ago(5 * 60), now, 'en')).toBe('5 min. ago');
    expect(fmtRelative(ago(30 * 3600), now, 'en')).toBe('yesterday');
    expect(fmtRelative('2026-10-01T12:00:00Z', now, 'en')).toBe('Oct 1');
  });

  it('fmtDate sigue al idioma actual', () => {
    setLang('es');
    expect(fmtDate('2026-10-03T12:00:00Z')).toBe('3 oct');
    setLang('en');
    expect(fmtDate('2026-10-03T12:00:00Z')).toBe('Oct 3');
  });
});
