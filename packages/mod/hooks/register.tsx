// Dagyard en Claude Code — una banda sobre el prompt con lo que le toca a esta sesión:
//   · lo que TE ESPERA (bloqueantes abiertos): una decisión o una revisión se resuelven desde aquí;
//     un acceso se da en el cielo (la clave no pasa por la terminal).
//   · lo que está PARA TOMAR (pendiente, sin equipo y con todo lo que necesita ya listo):
//     «Trabajar en esto» la arranca en el servidor y fija su /goal en esta sesión.
//   · el MENÚ (/dagyard o «Ver todo»): todo lo anterior a la vez, en un panel, para responderlo de corrido.
// Todo cambio se ve en el cielo (la UI) en tiempo real, porque escribe en la misma API.
import type { Register } from 'claude-code'

import { viewOf } from './view'
import type { Item, Node, Snapshot, View } from './view'

const URL_DEFAULT = 'https://dagyard.cofoundy-dev.workers.dev'
const PROJECT_DEFAULT = 'marketplace-reservas'
const TEAM = 'Claude Code'
const MENU = 'dagyard-menu'

const AMBER = '#ffb547'
const BLUE = '#9fd3ff'
const MUTED = '#6b7a93'

let base = URL_DEFAULT
let project = PROJECT_DEFAULT
let view: View | null = null
let cursor = 0
let working: Node | null = null
let hidden = false
let busy = false
let lastError = ''
let loading = false
let commenting: string | null = null // la revisión a la que se le está escribiendo «qué cambiarías»

async function home($: any): Promise<string> {
  const fromEnv = await $.env.get('HOME')
  if (fromEnv) return fromEnv
  const out = await $.process.run(['printenv', 'HOME']).catch(() => null)
  return out?.stdout?.trim() ?? ''
}

async function key($: any, file: string): Promise<string | null> {
  const dir = await home($)
  try {
    return (await $.fs.read(`${dir}/.config/dagyard/${file}`)).trim() || null
  } catch {
    return null
  }
}

async function api($: any, path: string, method: string, body: unknown, owner: boolean): Promise<any> {
  const token = await key($, owner ? 'owner-token' : 'agent-key')
  if (!token) throw new Error('falta la clave en ~/.config/dagyard')
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'user-agent': 'dagyard-mod/0.1' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await $.http.fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(String(res.status))
  return res.text ? JSON.parse(res.text) : null
}

async function refresh($: any): Promise<void> {
  loading = true
  try {
    const snap = (await api($, `/api/projects/${project}`, 'GET', undefined, false)) as Snapshot
    view = viewOf(snap)
    const w = working
    if (w) working = snap.nodes.find(n => n.id === w.id && n.status === 'working') ?? null
    lastError = ''
  } catch (err) {
    view = null
    lastError = (err as Error)?.message ?? String(err)
  }
  loading = false
  $.ui.invalidate('ui.render')
}

async function settle($: any, err: unknown): Promise<void> {
  if (err) $.ui.toast(`Dagyard no respondió (${(err as Error).message})`)
  busy = false
  await refresh($)
}

async function resolve($: any, it: Extract<Item, { kind: 'waiting' }>, choice: number, note: string): Promise<void> {
  if (busy) return
  busy = true
  $.ui.invalidate('ui.render')
  let err: unknown = null
  try {
    await api($, `/api/projects/${project}/blockers/${it.blocker.id}/resolve`, 'POST', { choice, note: note || 'Desde Claude Code' }, true)
    commenting = null
    $.ui.toast(`«${it.node.title}»: ${it.blocker.options[choice]}. El equipo sigue.`)
  } catch (e) {
    err = e
  }
  await settle($, err)
}

async function take($: any, node: Node): Promise<void> {
  if (busy) return
  busy = true
  $.ui.invalidate('ui.render')
  let err: unknown = null
  try {
    await api($, `/api/projects/${project}/nodes/${node.id}`, 'PATCH', { status: 'working', team: TEAM, progress: 0.05 }, false)
    working = node
    $.ui.toast(`Tomaste «${node.title}». Ya brilla en azul en el cielo.`)
  } catch (e) {
    err = e
  }
  await settle($, err)
  if (!err) await $.command.run({ command: 'goal', args: node.goal ?? `Termina «${node.title}»` })
}

async function patchWorking($: any, node: Node, body: unknown, toast: string): Promise<void> {
  if (busy) return
  busy = true
  $.ui.invalidate('ui.render')
  let err: unknown = null
  try {
    await api($, `/api/projects/${project}/nodes/${node.id}`, 'PATCH', body, false)
    working = null
    if (toast) $.ui.toast(toast)
  } catch (e) {
    err = e
  }
  await settle($, err)
}

async function openSky($: any): Promise<void> {
  await $.process.run(['open', base]).catch(() => undefined)
}

// Primero abre y después carga: el motor coloca el panel a cualquier ancho solo si el clic de la
// persona está detrás; una espera de red antes del open lo vuelve «no pedido» (y bajo 144 columnas espera).
async function openMenu($: any): Promise<void> {
  const opened = await $.ui.open({ id: MENU, title: 'Dagyard', focus: true, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(`Dagyard: el menú no cabe aquí (${opened.reason})`)
  void refresh($)
}

async function comment($: any, blockerId: string | null): Promise<void> {
  commenting = blockerId
  $.ui.invalidate('ui.render')
}

async function toggleBand($: any): Promise<void> {
  hidden = !hidden
  $.ui.invalidate('ui.render')
}

async function skip($: any): Promise<void> {
  cursor += 1
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    base = ((await $.env.get('DAGYARD_URL')) || (await key($, 'url')) || URL_DEFAULT).replace(/\/$/, '')
    project = (await $.env.get('DAGYARD_PROJECT')) || (await key($, 'project')) || PROJECT_DEFAULT
    await $.command.register({ name: 'dagyard', description: 'Abre el menú de Dagyard: todo lo que te espera y lo que está para tomar' })
    $.clock.every(15_000, () => void refresh($))
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'dagyard' }, async $ => {
    await openMenu($)
    const v = view
    return {
      text: v
        ? `${v.project}: ${v.waiting.length} te esperan, ${v.startable.length} para tomar.`
        : `Dagyard no respondió (${lastError || 'sin detalle'}) · ${base}/api/projects/${project}`,
    }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($)
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const v = view
    if (e.props.hasSurvey || e.props.isWorking || hidden) return below
    if (!v) {
      if (!loading && !lastError) void refresh($)
      const { Box: B, Text: T } = $.ui.resolve(e)
      return (
        <B flexDirection="column">
          <T color={MUTED}>◆ dagyard · sin conexión con {base} ({lastError || 'cargando…'}) · /dagyard reintenta</T>
          {below}
        </B>
      )
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const list: Item[] = [...v.waiting, ...v.startable]

    const head = (
      <Text wrap="truncate-end">
        <Text color={BLUE}>◆ dagyard </Text>
        <Text bold>{v.project}</Text>
        <Text color={MUTED}> · {v.done} de {v.total} listas{v.now ? ` · ahora en ${v.now}` : ''} · </Text>
        <Text color={v.waiting.length ? AMBER : MUTED}>{v.waiting.length} te esperan</Text>
        <Text color={MUTED}> · </Text>
        <Text color={v.startable.length ? BLUE : MUTED}>{v.startable.length} para tomar</Text>
      </Text>
    )

    let body = null
    const w = working
    if (busy) {
      body = <Text color={MUTED}>…</Text>
    } else if (w) {
      body = (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={BLUE}>Trabajando en </Text>
            <Text bold>{w.title}</Text>
          </Text>
          <Box>
            <Button key="dy-done" label="Hecha" hotkey="h" variant="primary" onPress={() => void patchWorking($, w, { status: 'done' }, `«${w.title}» está lista.`)} />
            <Button key="dy-release" label="Soltarla" hotkey="l" onPress={() => void patchWorking($, w, { status: 'pending', team: null, progress: 0 }, '')} />
            <Button key="dy-open" label="Ver el cielo" hotkey="o" dimColor onPress={() => void openSky($)} />
          </Box>
        </Box>
      )
    } else if (list.length > 0) {
      const i = cursor % list.length
      const it = list[i]
      const more =
        list.length > 1 ? (
          <Button key="dy-next" label={`Otra (${i + 1}/${list.length})`} hotkey="s" dimColor onPress={() => void skip($)} />
        ) : null
      if (it.kind === 'waiting') {
        const b = it.blocker
        const label = b.kind === 'decision' ? 'Te espera tu decisión' : b.kind === 'review' ? 'Te espera tu revisión' : 'Te espera un acceso'
        const buttons =
          b.kind === 'access'
            ? [<Button key="dy-sky" label="Darlo en el cielo" hotkey="o" variant="primary" onPress={() => void openSky($)} />]
            : b.options.slice(0, 3).map((opt, k) => (
                <Button key={`dy-opt-${k}`} label={opt} hotkey={String(k + 1)} variant={k === 0 ? 'primary' : undefined} onPress={() => void resolve($, it, k, '')} />
              ))
        body = (
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={AMBER}>{label} · </Text>
              <Text bold>{it.node.title}</Text>
              <Text color={MUTED}> — {b.kind === 'access' ? b.accessLabel ?? b.question : b.question}</Text>
            </Text>
            <Box>
              {buttons}
              {more}
              <Button key="dy-menu" label="Ver todo" hotkey="m" dimColor onPress={() => void openMenu($)} />
            </Box>
          </Box>
        )
      } else {
        const n = it.node
        body = (
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={BLUE}>Para tomar · </Text>
              <Text bold>{n.title}</Text>
              {n.goal ? <Text color={MUTED}> — /goal {n.goal}</Text> : null}
            </Text>
            <Box>
              <Button key="dy-take" label="Trabajar en esto" hotkey="t" variant="primary" onPress={() => void take($, n)} />
              {more}
              <Button key="dy-menu" label="Ver todo" hotkey="m" dimColor onPress={() => void openMenu($)} />
            </Box>
          </Box>
        )
      }
    }

    return (
      <Box flexDirection="column">
        {head}
        {body}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: MENU }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const v = view
    if (!v) {
      return (
        <Box flexDirection="column">
          <Text color={MUTED}>Sin conexión con {base} ({lastError || 'cargando…'}).</Text>
          <Button key="mn-retry" label="Reintentar" onPress={() => void refresh($)} />
        </Box>
      )
    }
    const w = working
    const rows: any[] = []

    rows.push(
      <Text key="mn-head" wrap="truncate-end">
        <Text bold>{v.project}</Text>
        <Text color={MUTED}> · {v.done} de {v.total} listas{v.now ? ` · ahora en ${v.now}` : ''}</Text>
      </Text>,
    )

    if (w) {
      rows.push(<Text key="mn-w-sec" color={BLUE}>{'\n'}TRABAJANDO</Text>)
      rows.push(
        <Box key="mn-w" flexDirection="column">
          <Text bold>{w.title}</Text>
          <Box>
            <Button key="mn-w-done" label="Hecha" variant="primary" onPress={() => void patchWorking($, w, { status: 'done' }, `«${w.title}» está lista.`)} />
            <Button key="mn-w-release" label="Soltarla" onPress={() => void patchWorking($, w, { status: 'pending', team: null, progress: 0 }, '')} />
          </Box>
        </Box>,
      )
    }

    rows.push(<Text key="mn-wait-sec" color={v.waiting.length ? AMBER : MUTED}>{'\n'}TE ESPERAN ({v.waiting.length})</Text>)
    if (v.waiting.length === 0) rows.push(<Text key="mn-wait-none" color={MUTED}>Nada te espera.</Text>)
    v.waiting.forEach(it => {
      if (it.kind !== 'waiting') return
      const b = it.blocker
      const kind = b.kind === 'decision' ? 'Decisión' : b.kind === 'review' ? 'Revisión' : 'Acceso'
      const id = b.id
      let actions: any
      if (b.kind === 'access') {
        actions = <Button key={`mn-${id}-sky`} label="Darlo en el cielo" variant="primary" onPress={() => void openSky($)} />
      } else if (commenting === id) {
        const k = b.options.findIndex(o => /cambio/i.test(o))
        actions = (
          <Box flexDirection="column">
            <Input key={`mn-${id}-note`} label="Qué cambiarías: " placeholder="en una línea" submitLabel="enviar" autoFocus onSubmit={value => void resolve($, it, k < 0 ? b.options.length - 1 : k, value)} />
            <Button key={`mn-${id}-cancel`} label="Cancelar" dimColor onPress={() => void comment($, null)} />
          </Box>
        )
      } else {
        actions = (
          <Box>
            {b.options.map((opt, k) =>
              b.kind === 'review' && /cambio/i.test(opt) ? (
                <Button key={`mn-${id}-${k}`} label={opt} onPress={() => void comment($, id)} />
              ) : (
                <Button key={`mn-${id}-${k}`} label={opt} variant={k === 0 ? 'primary' : undefined} onPress={() => void resolve($, it, k, '')} />
              ),
            )}
          </Box>
        )
      }
      rows.push(
        <Box key={`mn-${id}`} flexDirection="column">
          <Text wrap="wrap">
            <Text color={AMBER}>{kind} · </Text>
            <Text bold>{it.node.title}</Text>
          </Text>
          <Text wrap="wrap" color={MUTED}>{b.kind === 'access' ? `${b.question} (${b.accessLabel ?? 'acceso'})` : b.question}</Text>
          {actions}
        </Box>,
      )
    })

    rows.push(<Text key="mn-take-sec" color={v.startable.length ? BLUE : MUTED}>{'\n'}PARA TOMAR ({v.startable.length})</Text>)
    if (v.startable.length === 0) rows.push(<Text key="mn-take-none" color={MUTED}>Nada desbloqueado sin tomar.</Text>)
    v.startable.forEach(it => {
      const n = it.node
      rows.push(
        <Box key={`mn-t-${n.id}`} flexDirection="column">
          <Text bold>{n.title}</Text>
          {n.goal ? <Text wrap="wrap" color={MUTED}>/goal {n.goal}</Text> : null}
          <Button key={`mn-t-${n.id}-take`} label="Trabajar en esto" variant="primary" onPress={() => void take($, n)} />
        </Box>,
      )
    })

    rows.push(
      <Box key="mn-foot">
        <Text>{'\n'}</Text>
        <Button key="mn-sky" label="Ver el cielo" dimColor onPress={() => void openSky($)} />
        <Button key="mn-band" label={hidden ? 'Mostrar la banda' : 'Ocultar la banda'} dimColor onPress={() => void toggleBand($)} />
      </Box>,
    )

    return <Box flexDirection="column">{rows}</Box>
  })
}
