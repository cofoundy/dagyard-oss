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

function world(on: any, ok = true) {
  mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/h' })
  const calls: string[] = []
  const sent: string[] = []
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('fs.read', ($: any, e: any) => (/\/h\/\.config\/dagyard\/(agent-key|owner-token)$/.test(String(e.path)) ? { value: 'k' } : { deny: 'missing' }))
  const bodies: string[] = []
  on('http.fetch', ($: any, e: any) => {
    calls.push(`${e.init?.method ?? 'GET'} ${e.url}`)
    if (e.init?.body) bodies.push(e.init.body)
    if (!ok) return { value: { status: 403, ok: false, headers: {}, text: '' } }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(SNAP) } }
  })
  on('ui.render', () => <Box key="engine" />)
  on('ui.toast', () => ({ value: undefined }))
  on('command.run', ($: any, e: any) => {
    sent.push(`/${e.command} ${e.args}`)
    return { text: '' }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  return { calls, sent, bodies }
}

const MENU = { component: 'Pane', requestId: 'dagyard-menu', props: {} } as const

const start = ($: any) => $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

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
    expect(JSON.parse(bodies[bodies.length - 1]).choice).toBe(1)
    await ui.unmount()
  })

  test('Pedir cambios pide el comentario y lo manda', async ($, on) => {
    const { bodies } = world(on)
    await start($)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...MENU } as any)
    await ui.press({ key: 'mn-b2-1' })
    await ui.input({ key: 'mn-b2-note', text: 'El botón de pagar más grande' })
    const sent = JSON.parse(bodies[bodies.length - 1])
    expect(sent.choice).toBe(1)
    expect(sent.note).toBe('El botón de pagar más grande')
    await ui.unmount()
  })
})
