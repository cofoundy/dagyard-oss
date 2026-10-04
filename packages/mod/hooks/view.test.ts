import { expect, test } from 'claude-code/testing'

import { skyLink, viewOf } from './view'
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

test('link del cielo: el proyecto, o la tarea con su ficha', () => {
  const base = 'https://dagyard.cofoundy-dev.workers.dev/'
  expect(skyLink(base, 'dagyard')).toBe('https://dagyard.cofoundy-dev.workers.dev/?p=dagyard')
  expect(skyLink(base, 'dagyard', 'gh-47')).toBe('https://dagyard.cofoundy-dev.workers.dev/?p=dagyard&n=gh-47')
  expect(skyLink('http://x', 'mi proyecto', 'a&b')).toBe('http://x/?p=mi%20proyecto&n=a%26b')
  expect(skyLink('http://x', null, 'gh-1')).toBe('http://x/')
})

test('«Darlo en el cielo» abre la tarea del acceso que te espera', () => {
  const acceso = {
    ...snap,
    blockers: [{ id: 'b9', nodeId: 'c4', kind: 'access' as const, question: 'Falta la clave', options: [], accessLabel: 'Pasarela', status: 'open' as const }],
  }
  const it = viewOf(acceso).waiting[0]!
  expect(skyLink('http://x', 'p', it.node.id)).toBe('http://x/?p=p&n=c4')
})
