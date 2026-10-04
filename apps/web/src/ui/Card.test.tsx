import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DagNode, Snapshot } from '../data/types';
import { Card } from './Card';
import { setLang } from '../i18n';

// estos tests leen la interfaz en español; jsdom diría en-US (#73)
beforeEach(() => setLang('es'));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ISSUE = 'https://github.com/cofoundy/dagyard/issues/45';
const REPORT = 'https://basalt.cofoundy.ai/r/1';
const PR = 'https://github.com/cofoundy/dagyard/pull/50';

const node = (extra: Partial<DagNode> = {}): DagNode => ({
  id: 'sincronizar-issues',
  stageId: 'construccion',
  title: 'Sincronizar issues',
  status: 'done',
  progress: 1,
  team: 'Construcción',
  ...extra,
});

const snapshot = (n: DagNode): Snapshot => ({
  project: { id: 'p', name: 'Dagyard' },
  stages: [{ id: 'construccion', name: 'Construcción' }],
  nodes: [n],
  edges: [],
  blockers: [],
  messages: [],
  seq: 1,
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(n: DagNode) {
  const noop = () => {};
  act(() => root.render(<Card snapshot={snapshot(n)} node={n} onClose={noop} onFocus={noop} onResolve={async () => {}} />));
}
const links = () => [...host.querySelectorAll<HTMLAnchorElement>('a.report')];

describe('ficha: detalle técnico', () => {
  it('con link, ofrece «Detalle técnico» debajo del informe, sin mostrar la URL', () => {
    render(node({ reportUrl: REPORT, link: ISSUE }));
    const [report, technical] = links();
    expect(report?.textContent).toBe('Informe en BasaltAbrir ↗');
    expect(technical?.textContent).toBe('Detalle técnicoAbrir ↗');
    expect(technical?.href).toBe(ISSUE);
    expect(technical?.target).toBe('_blank');
    expect(technical?.rel).toBe('noopener noreferrer');
    expect(host.textContent).not.toMatch(/github|https?:/);
  });

  it('sin informe, el detalle técnico aparece solo', () => {
    render(node({ link: ISSUE }));
    expect(links().map((a) => a.textContent)).toEqual(['Detalle técnicoAbrir ↗']);
  });

  it('sin link, no hay detalle técnico', () => {
    render(node({ reportUrl: REPORT }));
    expect(links().map((a) => a.textContent)).toEqual(['Informe en BasaltAbrir ↗']);
  });
});

describe('ficha: rótulo del informe según dónde vive', () => {
  const inline = () => [...host.querySelectorAll<HTMLAnchorElement>('a.inline-report')];
  const withMessage = (reportUrl: string) => {
    const n = node({ reportUrl });
    const s = snapshot(n);
    s.messages = [{ id: 'm_1', nodeId: n.id, from: 'Equipo de Construcción', text: 'Listo.', reportUrl, at: '2026-10-04T12:00:00Z' }];
    const noop = () => {};
    act(() => root.render(<Card snapshot={s} node={n} onClose={noop} onFocus={noop} onResolve={async () => {}} />));
  };

  it('un informe que es un PR de GitHub no dice «Basalt», ni en la ficha ni en el mensaje', () => {
    withMessage(PR);
    expect(links().map((a) => a.textContent)).toEqual(['InformeAbrir ↗']);
    expect(inline().map((a) => a.textContent)).toEqual(['Informe ↗']);
    expect(host.textContent).not.toMatch(/Basalt/);
  });

  it('un informe en Basalt conserva «Informe en Basalt», también en un subdominio', () => {
    withMessage('https://dagyard.basalt.cofoundy.ai/r/1');
    expect(links().map((a) => a.textContent)).toEqual(['Informe en BasaltAbrir ↗']);
    expect(inline().map((a) => a.textContent)).toEqual(['Informe en Basalt ↗']);
  });

  it('un host que solo se parece a Basalt, o una URL inválida, dice «Informe»', () => {
    for (const url of ['https://basalt.cofoundy.ai.evil.com/r/1', 'https://notbasalt.cofoundy.ai/r/1', 'https://basalt.example/r/1', 'no es una url']) {
      render(node({ reportUrl: url }));
      expect(links().map((a) => a.textContent)).toEqual(['InformeAbrir ↗']);
    }
  });
});
