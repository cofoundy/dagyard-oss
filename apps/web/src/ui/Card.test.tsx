import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DagNode, Snapshot } from '../data/types';
import { Card } from './Card';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ISSUE = 'https://github.com/cofoundy/dagyard/issues/45';
const REPORT = 'https://basalt.example/r/1';

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
