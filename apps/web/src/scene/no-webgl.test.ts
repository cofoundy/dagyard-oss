// #83: sin WebGL (jsdom no tiene), el cielo deja un aviso en el idioma del PM.
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { createSky } from './index';

function fallbackText(): string {
  const labels = document.createElement('div');
  const sky = createSky({
    canvas: document.createElement('canvas'),
    labels,
    handlers: { onPick: () => {} },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const text = labels.querySelector('.sky-fallback')?.textContent ?? '';
  sky.dispose();
  return text;
}

afterEach(() => setLang('en'));

describe('aviso sin WebGL', () => {
  it('en inglés para en-US', () => {
    setLang('en');
    expect(fallbackText()).toBe("This browser doesn't support WebGL. Open it in Chrome, Safari or Firefox on a computer.");
  });

  it('en español para es-PE', () => {
    setLang('es');
    expect(fallbackText()).toBe('Este navegador no tiene WebGL. Ábrelo en Chrome, Safari o Firefox de escritorio.');
  });
});
