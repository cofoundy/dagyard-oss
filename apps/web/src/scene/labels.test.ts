import { describe, expect, it } from 'vitest';
import { injectStyles, LabelLayer } from './labels';

// #58: el encuadre puede pedir títulos a una línea (celulares bajos); la capa de etiquetas tiene que pintarlos así.
describe('recorte de títulos en la capa de etiquetas', () => {
  const setup = () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const layer = new LabelLayer(host);
    layer.setNode('a', 'Un título bastante largo que en la vista general se recorta', 'pending');
    return { layer, el: layer.node('a') };
  };
  const lines = (el: HTMLElement) => el.style.getPropertyValue('--sky-lines');

  it('a una línea: recortado y con la variable en 1', () => {
    const { layer, el } = setup();
    layer.setClamp('a', 1);
    expect(el.classList.contains('clamp')).toBe(true);
    expect(lines(el)).toBe('1');
  });

  it('a dos líneas (número o `true`): recortado con el valor por defecto de la hoja', () => {
    const { layer, el } = setup();
    layer.setClamp('a', 1);
    layer.setClamp('a', 2);
    expect(el.classList.contains('clamp')).toBe(true);
    expect(lines(el)).toBe('');
    layer.setClamp('a', 1);
    layer.setClamp('a', true);
    expect(lines(el)).toBe('');
  });

  it('pedido entero (hover, foco, etapa): sin recorte ni variable', () => {
    const { layer, el } = setup();
    layer.setClamp('a', 1);
    layer.setClamp('a', undefined);
    expect(el.classList.contains('clamp')).toBe(false);
    expect(lines(el)).toBe('');
  });

  it('medir a otra cantidad de líneas no cambia cómo se está pintando', () => {
    const { layer, el } = setup();
    layer.setClamp('a', 1);
    layer.sizer().node('a', 90, 2);
    layer.sizer().node('a', 90);
    expect(el.classList.contains('clamp')).toBe(true);
    expect(lines(el)).toBe('1');
    layer.setClamp('a', false);
    layer.sizer().node('a', 80, 1);
    expect(el.classList.contains('clamp')).toBe(false);
    expect(lines(el)).toBe('');
  });

  it('la hoja recorta con la variable (dos por defecto) y elipsis', () => {
    injectStyles(document);
    const css = document.getElementById('dagyard-sky-style')!.textContent!;
    expect(css).toContain('-webkit-line-clamp: var(--sky-lines, 2)');
    expect(css).toContain('text-overflow: ellipsis');
  });
});
