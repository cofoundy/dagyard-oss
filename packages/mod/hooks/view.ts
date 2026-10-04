// La vista de la banda, calculada desde el snapshot del proyecto. Pura, para poder probarla.

export type Status = 'pending' | 'working' | 'blocked' | 'done'
export type Node = { id: string; title: string; stage: string; status: Status; team: string | null; goal: string | null }
export type Blocker = {
  id: string
  nodeId: string
  kind: 'decision' | 'review' | 'access'
  question: string
  options: string[]
  accessLabel: string | null
  status: 'open' | 'resolved'
}
export type Snapshot = {
  project: { id: string; name: string; stages: { id: string; name: string }[] }
  nodes: Node[]
  edges: { from: string; to: string }[]
  blockers: Blocker[]
}

/** Lo que la banda muestra, uno a la vez: primero lo que te espera, después lo que está para tomar. */
export type Item = { kind: 'waiting'; blocker: Blocker; node: Node } | { kind: 'startable'; node: Node }

export type View = {
  project: string
  now: string
  done: number
  total: number
  waiting: Item[]
  startable: Item[]
}

export function viewOf(s: Snapshot): View {
  const byId = new Map(s.nodes.map(n => [n.id, n]))
  const deps = new Map<string, string[]>()
  for (const e of s.edges) deps.set(e.to, [...(deps.get(e.to) ?? []), e.from])

  const waiting: Item[] = []
  for (const b of s.blockers) {
    const node = byId.get(b.nodeId)
    if (b.status === 'open' && node) waiting.push({ kind: 'waiting', blocker: b, node })
  }

  // Para tomar: pendiente, nadie la tomó y todo lo que necesita ya está listo.
  const startable: Item[] = s.nodes
    .filter(n => n.status === 'pending' && !n.team)
    .filter(n => (deps.get(n.id) ?? []).every(d => byId.get(d)?.status === 'done'))
    .map(n => ({ kind: 'startable', node: n }))

  const live = s.project.stages.filter(st =>
    s.nodes.some(n => n.stage === st.id && (n.status === 'working' || n.status === 'blocked')),
  )

  return {
    project: s.project.name,
    now: live.map(st => st.name).join(' · '),
    done: s.nodes.filter(n => n.status === 'done').length,
    total: s.nodes.length,
    waiting,
    startable,
  }
}
