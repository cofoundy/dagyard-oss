// La banda dibujada de verdad: el árbol tiene que validar en terminal y en desktop.
import { describe, expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'dagyard'
const Box = 'Box' as any
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20 } } as const

const SNAP = {
  project: { id: 'marketplace-reservas', name: 'Marketplace de reservas', stages: [{ id: 'diseno', name: 'Diseño' }, { id: 'lanzamiento', name: 'Lanzamiento' }] },
  nodes: [
    { id: 'comision', title: 'Modelo de comisiones', stage: 'diseno', status: 'blocked', team: 'Diseño', goal: null },
    { id: 'landing', title: 'Página de lanzamiento', stage: 'lanzamiento', status: 'pending', team: null, goal: 'Arma la página de lanzamiento' },
  ],
  edges: [],
  blockers: [
    { id: 'b1', nodeId: 'comision', kind: 'decision', question: '¿A quién le cobramos?', options: ['Al proveedor', 'Al cliente'], accessLabel: null, status: 'open' },
    { id: 'b2', nodeId: 'comision', kind: 'review', question: 'Revisa el diseño', options: ['Aprobar', 'Pedir cambios'], accessLabel: null, status: 'open' },
    { id: 'b3', nodeId: 'comision', kind: 'access', question: 'Necesito la pasarela', options: [], accessLabel: 'Clave de la pasarela', status: 'open' },
  ],
}

type Res = { status: number; ok: boolean; headers: Record<string, string>; text: string }
type World = {
  ok?: boolean
  files?: Record<string, string>
  env?: Record<string, string>
  snap?: () => unknown
  /** responde un pedido antes que el mundo; `undefined` lo deja pasar, `'cut'` corta la red */
  respond?: (method: string, url: string) => Res | 'cut' | undefined
}

const LINKED = { '/w/.dagyard.json': JSON.stringify({ project: 'marketplace-reservas' }) }

function world(on: any, ok: boolean | World = true) {
  const o: World = typeof ok === 'boolean' ? { ok } : ok
  const files: Record<string, string> = o.files ?? LINKED
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/h', ...o.env })
  const calls: string[] = []
  const sent: string[] = []
  const toasts: string[] = []
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('fs.read', ($: any, e: any) => {
    const path = String(e.path)
    if (/\/h\/\.config\/dagyard\/(agent-key|owner-token)$/.test(path)) return { value: 'k' }
    return path in files ? { value: files[path] } : { deny: 'missing' }
  })
  const bodies: string[] = []
  const keys: (string | undefined)[] = []
  on('http.fetch', ($: any, e: any) => {
    const method = e.init?.method ?? 'GET'
    calls.push(`${method} ${e.url}`)
    if (e.init?.body) bodies.push(e.init.body)
    if (method !== 'GET') keys.push(e.init?.headers?.['idempotency-key'])
    const r = o.respond?.(method, e.url)
    if (r === 'cut') return { deny: 'sin red' }
    if (r) return { value: r }
    if (o.ok === false) return { value: { status: 403, ok: false, headers: {}, text: '' } }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(o.snap ? o.snap() : SNAP) } }
  })
  on('ui.render', () => <Box key="engine" />)
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.run', ($: any, e: any) => {
    sent.push(`/${e.command} ${e.args}`)
    return { text: '' }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  return { calls, sent, bodies, keys, toasts, clock }
}

const MENU = { component: 'Pane', requestId: 'dagyard-menu', props: {} } as const

const start = ($: any, cwd = '/w') => $.session.start({ cwd, surface: 'terminal', isInteractive: true })

describe('banda de dagyard', () => {
  test('dibuja lo que te espera con sus opciones', async ($, on) => {
    world(on)
    await start($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND } as any)
      expect(await ui.find({ type: 'Text', text: /Modelo de comisiones/ })).toBeDefined()
      expect(await ui.find({ key: 'dy-opt-0' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('Otra pasa a lo que está para tomar y Trabajar en esto fija el /goal', async ($, on) => {
    const { sent } = world(on)
    await start($)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND } as any)
    for (let i = 0; i < 3; i++) await ui.press({ key: 'dy-next' })
    expect(await ui.find({ key: 'dy-take' })).toBeDefined()
    await ui.press({ key: 'dy-take' })
    expect(sent).toContain('/goal Arma la página de lanzamiento')
    await ui.unmount()
  })

  test('sin conexión lo dice en vez de desaparecer', async ($, on) => {
    world(on, false)
    await start($)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /sin conexión/ })).toBeDefined()
    await ui.unmount()
  })

  test('el menú muestra todo y resuelve una decisión', async ($, on) => {
    const { calls, bodies } = world(on)
    await start($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...MENU } as any)
      expect(await ui.find({ type: 'Text', text: /TE ESPERAN \(3\)/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /PARA TOMAR \(1\)/ })).toBeDefined()
      expect(await ui.find({ key: 'mn-b3-sky' })).toBeDefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...MENU } as any)
    await ui.press({ key: 'mn-b1-1' })
    expect(calls).toContain('POST https://dagyard.cofoundy-dev.workers.dev/api/projects/marketplace-reservas/blockers/b1/resolve')
    expect(JSON.parse(bodies[bodies.length - 1]!).choice).toBe(1)
    await ui.unmount()
  })

  test('Pedir cambios pide el comentario y lo manda', async ($, on) => {
    const { bodies } = world(on)
    await start($)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...MENU } as any)
    await ui.press({ key: 'mn-b2-1' })
    await (ui as any).input({ key: 'mn-b2-note', text: 'El botón de pagar más grande' })
    const sent = JSON.parse(bodies[bodies.length - 1]!)
    expect(sent.choice).toBe(1)
    expect(sent.note).toBe('El botón de pagar más grande')
    await ui.unmount()
  })
})

describe('en el celular (sin campo de texto)', () => {
  test('Pedir cambios se manda sin nota en vez de romper el menú', async ($, on) => {
    const { bodies } = world(on)
    await start($)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'mobile', ...MENU } as any)
    await ui.press({ key: 'mn-b2-1' })
    const sent = JSON.parse(bodies[bodies.length - 1]!)
    expect(sent.choice).toBe(1)
    expect(sent.note).toBe('Desde Claude Code')
    await ui.unmount()
  })
})

describe('el proyecto según el repo', () => {
  test('lee el .dagyard.json más cercano subiendo desde el cwd, con su url', async ($, on) => {
    const { calls } = world(on, { files: { '/repo/.dagyard.json': JSON.stringify({ project: 'dagyard', url: 'https://otro.example/' }) } })
    await start($, '/repo/packages/mod')
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND } as any)
    expect(calls).toContain('GET https://otro.example/api/projects/dagyard')
    await ui.unmount()
  })

  test('DAGYARD_PROJECT manda sobre el .dagyard.json', async ($, on) => {
    const { calls } = world(on, { env: { DAGYARD_PROJECT: 'otro' } })
    await start($)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND } as any)
    expect(calls).toContain('GET https://dagyard.cofoundy-dev.workers.dev/api/projects/otro')
    await ui.unmount()
  })

  test('sin proyecto calla: ni banda ni llamadas, y /dagyard dice cómo enlazarlo', async ($, on) => {
    const { calls } = world(on, { files: {} })
    await start($, '/sin/enlace')
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /dagyard/ })).toBeUndefined()
    await ui.unmount()
    const out: any = await $.command.run({ command: 'dagyard', args: '' } as any)
    expect(out.text).toMatch(/\.dagyard\.json/)
    expect(calls).toEqual([])
  })
})

describe('el aviso', () => {
  test('un bloqueante nuevo avisa en la siguiente vuelta (≤20 s); los que ya estaban, no', async ($, on) => {
    const snap: any = JSON.parse(JSON.stringify(SNAP))
    const { toasts, clock } = world(on, { snap: () => snap })
    await start($)
    await clock.settle()
    expect(toasts).toEqual([])
    snap.blockers.push({ id: 'b4', nodeId: 'comision', kind: 'decision', question: '¿Lanzamos el lunes?', options: ['Sí', 'No'], accessLabel: null, status: 'open' })
    await clock.advance(10_000)
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toMatch(/Modelo de comisiones/)
    expect(toasts[0]).toMatch(/¿Lanzamos el lunes\?/)
    await clock.advance(10_000)
    expect(toasts.length).toBe(1)
  })
})

describe('durante un deploy', () => {
  const NODE = 'https://dagyard.cofoundy-dev.workers.dev/api/projects/marketplace-reservas/nodes/landing'
  const fail = (status: number, code: string): Res => ({ status, ok: false, headers: {}, text: JSON.stringify({ error: { code, message: code } }) })
  const OK: Res = { status: 200, ok: true, headers: {}, text: JSON.stringify({ id: 'landing' }) }

  /** responde cada PATCH al nodo con lo que toca en la lista, en orden; después, 200 */
  function patches(...answers: (Res | 'cut')[]) {
    return (method: string, url: string) => (method === 'PATCH' && url === NODE ? answers.shift() ?? OK : undefined)
  }

  async function takeLanding($: any) {
    await start($)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND } as any)
    for (let i = 0; i < 3; i++) await ui.press({ key: 'dy-next' })
    await ui.press({ key: 'dy-take' })
    return ui
  }

  test('un PATCH que recibe 503 y luego 200 termina bien, con la misma clave en ambos intentos', async ($, on) => {
    const { calls, keys, sent, toasts, clock } = world(on, { respond: patches(fail(503, 'unavailable')) })
    const ui = await takeLanding($)
    await clock.advance(2_000)
    expect(calls.filter(c => c === `PATCH ${NODE}`).length).toBe(2)
    expect(keys.length).toBe(2)
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(keys[1]).toBe(keys[0])
    expect(sent).toContain('/goal Arma la página de lanzamiento')
    expect(toasts.some(t => /no respondió/.test(t))).toBe(false)
    await ui.unmount()
  })

  test('un corte de red también se reintenta con la misma clave', async ($, on) => {
    const { keys, sent, clock } = world(on, { respond: patches('cut') })
    const ui = await takeLanding($)
    await clock.advance(2_000)
    expect(keys.length).toBe(2)
    expect(keys[1]).toBe(keys[0])
    expect(sent).toContain('/goal Arma la página de lanzamiento')
    await ui.unmount()
  })

  test('cada invocación lleva su propia clave', async ($, on) => {
    const { keys, clock } = world(on)
    const ui = await takeLanding($)
    await clock.settle()
    await ui.press({ key: 'dy-take' }) // el snapshot la sigue dando pendiente: se toma otra vez
    await clock.settle()
    expect(keys.length).toBe(2)
    expect(keys[1]).not.toBe(keys[0])
    await ui.unmount()
  })

  test('overloaded no se repite: reintentar empeora', async ($, on) => {
    const { calls, sent, toasts, clock } = world(on, { respond: patches(fail(503, 'overloaded')) })
    const ui = await takeLanding($)
    await clock.advance(2_000)
    expect(calls.filter(c => c === `PATCH ${NODE}`).length).toBe(1)
    expect(sent).toEqual([])
    expect(toasts.some(t => /no respondió \(503\)/.test(t))).toBe(true)
    await ui.unmount()
  })

  test('se rinde tras tres intentos', async ($, on) => {
    const u = fail(503, 'unavailable')
    const { calls, sent, clock } = world(on, { respond: patches(u, u, u, u) })
    const ui = await takeLanding($)
    await clock.advance(5_000)
    expect(calls.filter(c => c === `PATCH ${NODE}`).length).toBe(3)
    expect(sent).toEqual([])
    await ui.unmount()
  })
})
