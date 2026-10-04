import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANG,
  DEFAULT_STAGES,
  LEGACY_LANG,
  defaultStages,
  demoProject,
  parseProjectGraphInput,
  parseProjectInput,
  projectLang,
} from '../src/index.js';

describe('idioma del proyecto (#77)', () => {
  it('un proyecto nuevo es en inglés; uno guardado sin el campo se lee en español', () => {
    expect(DEFAULT_LANG).toBe('en');
    expect(LEGACY_LANG).toBe('es');
    expect(projectLang({})).toBe('es');
    expect(projectLang({ lang: undefined })).toBe('es');
    expect(projectLang({ lang: 'en' })).toBe('en');
    expect(projectLang({ lang: 'es' })).toBe('es');
  });

  it('las etapas por defecto existen en los dos idiomas con los mismos ids (solo cambia el nombre)', () => {
    expect(defaultStages('en').map((s) => s.name)).toEqual(['Discovery', 'Design', 'Build', 'Testing', 'Launch']);
    expect(defaultStages('en').map((s) => s.id)).toEqual(DEFAULT_STAGES.map((s) => s.id));
    expect(demoProject('en').stages).toEqual(defaultStages('en'));
    expect(defaultStages('es')).toEqual(DEFAULT_STAGES);
    expect(DEFAULT_STAGES.map((s) => s.name)).toEqual(['Descubrimiento', 'Diseño', 'Construcción', 'Pruebas', 'Lanzamiento']);
  });

  it('POST y PUT aceptan lang en | es y rechazan cualquier otro', () => {
    const graph = { name: 'X', nodes: [] };
    expect(parseProjectGraphInput({ ...graph, lang: 'es' })).toMatchObject({ ok: true, value: { lang: 'es' } });
    expect(parseProjectInput({ name: 'X', lang: 'en' })).toMatchObject({ ok: true, value: { lang: 'en' } });
    // sin el campo no se inventa: lo decide el servidor (nuevo → en; existente → el suyo)
    const bare = parseProjectGraphInput(graph);
    expect(bare.ok && 'lang' in bare.value).toBe(false);
    for (const bad of ['fr', 'EN', 'es_PE', '', 1, null]) {
      const r = parseProjectGraphInput({ ...graph, lang: bad });
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(r.message).toContain('lang');
      expect(parseProjectInput({ name: 'X', lang: bad }).ok, String(bad)).toBe(false);
    }
  });

  it('cada demo declara su idioma', () => {
    expect(demoProject('en').lang).toBe('en');
    expect(demoProject('es').lang).toBe('es');
  });
});
