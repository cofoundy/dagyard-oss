import { expect, test } from 'claude-code/testing'

import { viewOf } from './view'
import type { Snapshot } from './view'

const node = (id: string, status: 'pending' | 'working' | 'blocked' | 'done', team: string | null = null) => ({
  id,
  title: `Tarea ${id}`,
  stage: id.startsWith('d') ? 'diseno' : 'construccion',
  status,
  team,
  goal: `Haz ${id}`,
})

const snap: Snapshot = {
  project: { id: 'p', name: 'Marketplace', stages: [{ id: 'diseno', name: 'Diseño' }, { id: 'construccion', name: 'Construcción' }] },
  nodes: [
    node('d1', 'done', 'Diseño'),
    node('d2', 'blocked', 'Diseño'),
    node('c1', 'pending'), // depende de d1 (listo) → para tomar
    node('c2', 'pending'), // depende de d2 (bloqueado) → no
    node('c3', 'pending', 'Construcción'), // ya tiene equipo → no
    node('c4', 'working', 'Construcción'),
  ],
  edges: [
    { from: 'd1', to: 'c1' },
    { from: 'd2', to: 'c2' },
  ],
  blockers: [
    { id: 'b1', nodeId: 'd2', kind: 'decision', question: '¿A o B?', options: ['A', 'B'], accessLabel: null, status: 'open' },
    { id: 'b2', nodeId: 'd1', kind: 'review', question: 'Revisa', options: ['Aprobar'], accessLabel: null, status: 'resolved' },
  ],
}

test('te esperan: solo los bloqueantes abiertos', () => {
  const v = viewOf(snap)
  expect(v.waiting.map(i => (i.kind === 'waiting' ? i.blocker.id : ''))).toEqual(['b1'])
})

test('para tomar: pendiente, sin equipo y con sus dependencias listas', () => {
  const v = viewOf(snap)
  expect(v.startable.map(i => i.node.id)).toEqual(['c1'])
})

test('cabecera: listas y etapas vivas', () => {
  const v = viewOf(snap)
  expect(v.done).toBe(1)
  expect(v.total).toBe(6)
  expect(v.now).toBe('Diseño · Construcción')
})
