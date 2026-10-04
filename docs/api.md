# API de Dagyard v0

> Contrato entre el Worker (`apps/worker`, sitio `nucleo`), la UI (`apps/web`, sitio `cielo`) y el CLI
> (`packages/cli`, sitio `cli`). Los tipos exactos viven en `packages/model/src/types.ts` y mandan
> sobre esta prosa. Importa todo desde `@dagyard/model` (`workspace:*`): tipos, validación, `applyEvent`,
> `nextStartable`, `goalLine` y la demo (`demoProject()`).

## Convenciones

- Base: el mismo origen que sirve la UI (`https://<worker>.workers.dev`). Todas las rutas cuelgan de `/api`.
- JSON en ambas direcciones (`Content-Type: application/json`). Fechas en ISO 8601 UTC.
- Ids: slugs `[a-z0-9][a-z0-9-]*` de hasta 64 caracteres (`marketplace-reservas`, `pagos`). Si creas un
  nodo o proyecto sin `id`, el servidor lo deriva del título con `slugify()` y responde `409` si ya existe.
  Bloqueantes y mensajes llevan ids generados (`b_…`, `m_…`).
- Errores: siempre `{"error": {"code": "…", "message": "…"}}`, con el mensaje en español.

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `invalid` | el body no pasa la validación de `@dagyard/model` |
| 400 | `cycle` | la arista o el grafo cerraría un ciclo |
| 401 | `unauthorized` | sin credencial o credencial inválida |
| 403 | `forbidden` | credencial válida, rol equivocado (p. ej. un agente que intenta resolver) |
| 404 | `not_found` | proyecto, nodo o bloqueante inexistente |
| 409 | `conflict` | id repetido; resolver un bloqueante ya resuelto; cambiar el `status` de un nodo con un bloqueante abierto, o declararlo `done` en un `PUT`; un agente que haría desaparecer un bloqueante, abierto o resuelto (`PUT` que quita su tarea o `DELETE` del nodo); o un `PUT` con `If-None-Match: *` sobre un proyecto que ya existe |
| 500 | `internal` | lo demás |

## Auth

Dos credenciales, ambas secrets del Worker. Ninguna se commitea ni se pega en Basalt o un issue.

| Rol | Secret del Worker | Dónde vive en la Mac | Quién la usa |
|---|---|---|---|
| `owner` | `OWNER_TOKEN` | `~/.config/dagyard/owner-token` (chmod 600) | la UI (el humano) |
| `agent` | `AGENT_KEY` | `~/.config/dagyard/agent-key` (chmod 600) | el CLI y la fábrica |

Formas de presentarla (el servidor prueba en este orden):

1. Header `Authorization: Bearer <token>` — el CLI usa esta.
2. Cookie `__Host-dagyard_session` (httpOnly, Secure, SameSite=Lax, `Path=/`, sin `Domain`), que crea
   `POST /api/session`. La UI usa esta: el humano pega el token una vez y el navegador lo recuerda; el
   WebSocket la manda solo. Solo vale como `owner`. El prefijo `__Host-` impide que otro subdominio
   plante una cookie con ese nombre.
3. Solo en el upgrade del WebSocket, para clientes sin cookie: subprotocolo
   `new WebSocket(url, ['dagyard', 'token.' + token])` (el servidor responde `Sec-WebSocket-Protocol: dagyard`
   y el token no queda en ninguna URL), o, como último recurso, la query `?token=<token>`.

Qué puede cada rol: los dos leen y escriben el grafo y los mensajes. **Resolver un bloqueante es solo
del `owner`** (es el humano quien desbloquea). **Recibir el valor de un acceso es solo del `agent`**
(en `wait`); el valor nunca viaja en snapshots, listados ni eventos, y se guarda cifrado (AES-GCM, amarrado a su proyecto y bloqueante) en el Durable Object `Store` (SQLite).
Sin el secret `VAULT_KEY`, resolver un acceso o recibir su valor responde `500`: nunca se guarda ni se entrega en claro.

### Sesión (UI)

| Método y ruta | Body | Respuesta |
|---|---|---|
| `POST /api/session` | `{"token": "<owner-token>"}` | `204` + `Set-Cookie`. Token malo (o la clave del agente) → `401` |
| `DELETE /api/session` | — | `204`: cierra **esa** sesión en el servidor y borra la cookie. Sin cookie, también `204` |
| `DELETE /api/session?all=1` | — | `204`: cierra **todas** las sesiones. Exige credencial de dueño (cookie viva o Bearer): sin ella `401`, con la del agente `403`, con cookie y un `Origin` ajeno `403` |
| `GET /api/me` | — | `{"role": "owner" \| "agent"}` o `401` |

Cada login abre una sesión nueva: la cookie lleva un id aleatorio de 256 bits (base64url) y el Durable
Object `Store` guarda solo su SHA-256, con su vencimiento a los **30 días** (el mismo `Max-Age` de la
cookie) y una huella del `OWNER_TOKEN`. Una sesión cerrada, vencida o abierta con un `OWNER_TOKEN` que
ya se rotó responde `401` aunque alguien haya copiado la cookie; la UI vuelve a pedir la clave. Las
vencidas se borran solas al abrir otra sesión o al intentar usarlas. Un WebSocket abierto con esa
cookie también se cierra (ver §Tiempo real).

**Escrituras con la cookie:** como `workers.dev` está en la Public Suffix List, el «sitio» de la preview es
`cofoundy-dev.workers.dev`: cualquier otro Worker de la cuenta es el mismo sitio y `SameSite=Lax` no lo frena. Por eso, si la auth vino por la cookie y el
método no es `GET`/`HEAD`, un `Origin` presente que no esté permitido (mismo origen, `ALLOWED_ORIGINS`
o localhost en dev; un origen opaco `null` nunca) responde `403 forbidden`. Sin `Origin` pasa: un
navegador siempre lo manda en una petición entre orígenes. Bearer no mira el `Origin`.

## Rutas

Sin auth: solo `GET /api/health` → `200 {"ok": true, "version": "<sha corto>"}`. Todo lo demás exige rol.

### Proyectos

| Método y ruta | Body | Respuesta |
|---|---|---|
| `GET /api/projects` | — | `{"projects": ProjectSummary[]}` (con conteos por estado y bloqueantes abiertos) |
| `POST /api/projects` | `ProjectInput` (`name`, `id?`, `stages?`) | `201 Project`. Sin `stages` usa las 5 por defecto |
| `GET /api/projects/:pid` | — | `ProjectSnapshot` (ver abajo) |
| `PUT /api/projects/:pid` | `ProjectGraphInput` | `200 ProjectSnapshot`. Crea el proyecto o **reemplaza** el grafo entero (idempotente). Lo usan la semilla (con el token del dueño) y `dagyard import`. Con `If-None-Match: *` solo crea: `409` si el proyecto ya existe, sin tocarlo. Si quien llama es `agent` conserva los bloqueantes, los mensajes y la antigüedad de las tareas (ver abajo) y responde `409` si el grafo nuevo quita una tarea que tiene alguno. Emite `project.replaced` |
| `PATCH /api/projects/:pid` | `{"name"?, "stages"?}` | `200 Project`. Emite `project.updated` |
| `DELETE /api/projects/:pid` | — | `204`. Solo `owner` |
| `GET /api/projects/:pid/next` | — | `NextResult`: `{"node": DagNode \| null, "goalLine": "/goal …" \| null}` |
| `GET /api/projects/:pid/events?since=<seq>` | — | `{"events": DagEvent[]}` con `seq > since`, máx. 500 (recuperación sin WebSocket) |

`ProjectSnapshot` = `{ project, nodes, edges, blockers, messages, seq }`: nodos, aristas y bloqueantes
completos (abiertos y resueltos, sin valores de acceso), los últimos 200 mensajes en orden cronológico y
el `seq` del último evento. Con ese `seq` la UI abre el WebSocket.

Resolver es solo del dueño, así que un agente no puede hacer desaparecer ni una pregunta abierta ni una
respuesta ya dada. Con la API key, el `PUT` sobre un proyecto existente **conserva** cada bloqueante
(abierto o resuelto) con su id, su respuesta y el valor de su acceso, así un `wait` en curso lo sigue
encontrando. Las tareas que tienen un bloqueante abierto quedan `blocked` las declare así o no. Un
bloqueante del body igual a uno conservado **abierto** (misma tarea, `kind`, `question`, `options` y
`accessLabel`) no se duplica: re-importar el mismo archivo es idempotente. Uno igual a uno ya **resuelto**
entra como bloqueante nuevo y abierto (re-preguntar nunca se descarta en silencio), y la respuesta anterior
se conserva al lado. Si el grafo nuevo quita una tarea que tiene algún bloqueante, `409` y no se toca nada.
Ese mismo `PUT` conserva tal cual (id, firma y fecha) los mensajes de las tareas que siguen, incluido el
«Gracias. Sigo desde donde me quedé.» de cada respuesta, y el `createdAt` de cada tarea que ya existía, así
`next` no cambia de orden al re-importar. Un mensaje del body igual a uno conservado (misma tarea, `from`,
`text` y `reportUrl`; sin `from`, basta tarea, `text` y `reportUrl`, porque la firma sale del equipo
actual y puede haber cambiado) no se duplica; los mensajes de una tarea quitada se van con ella. El dueño reemplaza
el grafo entero siempre (sus bloqueantes y mensajes se recrean desde el body con otros ids y fecha nueva).

Con cualquier llamante, una tarea declarada `done` que quedaría `blocked` (por un bloqueante abierto
conservado o del mismo body) responde `409` sin tocar nada, igual que el `PATCH`: no se cierra una tarea
con una pregunta abierta. Si lo único que la bloquearía es una pregunta que el dueño ya respondió y el
archivo vuelve a hacer, el `409` lo dice: quítala de `blockers` o no cierres la tarea.

`dagyard import` crea proyectos nuevos con un solo `PUT` exclusivo (`If-None-Match: *`): si el proyecto
ya existe falla, y el «¿ya existe?» se decide en la misma transacción que escribe, así dos imports a la vez
no se pisan. `--replace` manda el `PUT` sin ese header. Cada tarea que el import deja `blocked` (su status nombra a un humano
o no espera a ninguna otra tarea) lleva un bloqueante `decision` con la pregunta ««<título>» necesita tu
decisión para seguir. ¿Sigue o la dejas en pausa?» y las opciones `Sigue` / `Déjala en pausa`; como sale
solo del título, re-importar no lo duplica.

`next` elige, entre los nodos `pending` con todas sus dependencias `done`, el de la etapa más temprana y,
a igualdad, el más antiguo (`nextStartable()` del modelo). `goalLine` es `/goal <goal o título>`.

### Nodos y aristas

| Método y ruta | Body | Respuesta |
|---|---|---|
| `POST /api/projects/:pid/nodes` | `NodeInput` (`stage`, `title`, `id?`, `status?`, `progress?`, `team?`, `goal?`, `reportUrl?`, `deps?`) | `201 DagNode`. Emite `node.added` + un `edge.added` por cada dep |
| `PATCH /api/projects/:pid/nodes/:nid` | `NodePatch` | `200 DagNode`. Emite `node.updated` |
| `DELETE /api/projects/:pid/nodes/:nid` | — | `204`. Borra sus aristas, bloqueantes y mensajes. `409` si quien llama es `agent` y el nodo tiene ≥1 bloqueante (abierto o resuelto). Emite `node.removed` |
| `POST /api/projects/:pid/edges` | `{"from", "to"}` | `201 Edge`; `400 cycle` si cierra un ciclo; `409` si ya existe. Emite `edge.added` |
| `DELETE /api/projects/:pid/edges?from=<id>&to=<id>` | — | `204`. Emite `edge.removed` |

Reglas del servidor al escribir un nodo:

- `status: "done"` fija `progress = 1`. `status: "working"` desde `pending` arranca en `progress = 0`
  salvo que mandes otro.
- `status: "blocked"` no se pone a mano: lo pone abrir un bloqueante. Un `PATCH` con `blocked` → `400`.
  Mientras haya un bloqueante abierto, un `PATCH` de `status` → `409`.
- El CLI mapea `start` → `PATCH {"status": "working"}`, `progress <n>` → `PATCH {"progress": n}` y
  `done` → `PATCH {"status": "done"}`.

### Bloqueantes

| Método y ruta | Body | Respuesta |
|---|---|---|
| `POST /api/projects/:pid/nodes/:nid/blockers` | `BlockerInput` | `201 Blocker`. El nodo pasa a `blocked`. Emite `blocker.opened` + `node.updated` |
| `GET /api/projects/:pid/blockers/:bid` | — | `200 Blocker` (sin valor) |
| `POST /api/projects/:pid/blockers/:bid/resolve` | `ResolveInput` | `200 Blocker`. **Solo `owner`**. Ya resuelto → `409`. Emite `blocker.resolved` + `node.updated` |
| `GET /api/projects/:pid/blockers/:bid/wait?timeout=<s>` | — | long-poll hasta `timeout` (default 25, máx. 25): `200 BlockerWaitResult` |

Tipos de bloqueante (`BlockerInput`):

| `kind` | UI | Body al abrir | Body al resolver |
|---|---|---|---|
| `decision` | Necesita tu decisión | `question`, `options` (1 a 6) | `{"choice": <índice o texto exacto>, "note"?}` |
| `review` | Necesita tu revisión | `question`, `options?` (default `["Aprobar", "Pedir cambios"]`) | igual que `decision` |
| `access` | Necesita un acceso | `question`, `accessLabel` (p. ej. «Clave de la pasarela de pagos»), sin `options` | `{"value": "<el secreto>", "note"?}` |

Al resolver: el bloqueante queda `status: "resolved"` con `resolution = {choice, note, hasValue}`,
`resolvedBy: "owner"` y `resolvedAt`; el nodo vuelve a `working` y el servidor agrega un mensaje del
sistema («Gracias. Sigo desde donde me quedé.») solo si el nodo no tiene otro bloqueante abierto.

`wait` responde apenas el bloqueante se resuelve, o al vencer el `timeout` con el bloqueante todavía
`open` (el CLI vuelve a llamar). `BlockerWaitResult = {blocker, value}`; `value` es el secreto
descifrado **solo** si `kind = access`, está resuelto y el rol es `agent`. Para el `owner` siempre `null`.

### Mensajes

| Método y ruta | Body | Respuesta |
|---|---|---|
| `POST /api/projects/:pid/nodes/:nid/messages` | `MessageInput` (`text` ≤280, `from?`, `reportUrl?`) | `201 Message`. Emite `message.posted` |

Sin `from`, el servidor firma `Equipo de <team del nodo>` (o `Agente` si el nodo no tiene equipo). Si el
mensaje trae `reportUrl` y el nodo no tiene uno, el nodo lo adopta (emite también `node.updated`).

## Tiempo real

Un Durable Object por proyecto guarda los WebSockets (API de hibernación) y reparte cada evento que
emite una escritura. Todas las escrituras de la API, vengan de la UI o del CLI, pasan por ahí.

**Conexión:** `GET /api/projects/:pid/live?since=<seq>` con `Upgrade: websocket`. Auth por cookie, subprotocolo
`token.<token>` o `?token=`. Sin auth → `401` antes del upgrade.

**Origin:** si la auth vino por la cookie, el upgrade exige un header `Origin` que sea el mismo origen
que la URL pedida o uno de la var `ALLOWED_ORIGINS` del Worker (lista por comas, vacía por defecto en
`wrangler.toml`); si no, o sin `Origin`, `403 forbidden`. En dev, si se pide a `localhost`/`127.0.0.1`,
vale cualquier origen localhost. Bearer, subprotocolo y `?token=` no miran el `Origin` (un sitio ajeno no
tiene el token). Un origen opaco (`Origin: null`, `file:`, `data:`) nunca vale, ni desde `ALLOWED_ORIGINS`.
El proxy de Vite (`apps/web/vite.config.ts`) reescribe el `Origin` del upgrade y de las peticiones al de
su target, así la UI en dev funciona contra un Worker local o remoto.

**Sesión viva:** un socket abierto con la cookie se revalida contra el Store antes de cada evento. Si su
sesión se cerró (logout o `?all=1`), venció o es de un `OWNER_TOKEN` rotado, el servidor lo cierra con
código **`4001`** sin mandarle el evento; al reconectar, el upgrade responde `401` y la UI vuelve a pedir
la clave. Para no sumar latencia, una sesión vista viva se confía hasta 30 s: el cierre llega en el primer
evento después de esa ventana. (`4004` = el proyecto se borró.)

**Frames servidor → cliente** (JSON, tipo `ServerFrame`):

```json
{"type": "hello", "projectId": "marketplace-reservas", "seq": 42}
{"type": "event", "event": {"seq": 43, "projectId": "marketplace-reservas", "type": "message.posted",
  "actor": "agent", "at": "2026-10-04T06:01:02.000Z", "payload": {"message": {…}}}}
{"type": "resync", "seq": 900}
{"type": "pong"}
```

Si mandas `since` y hay eventos más nuevos, el servidor los reenvía en orden justo después del `hello`.
Si faltan más de 500, o si `since` es mayor que el `seq` actual (p. ej. el proyecto se borró y se volvió a
crear), manda `resync`: vuelve a pedir el snapshot. Cliente → servidor: `{"type": "ping"}`
(o el texto `ping`) cuando quieras; el servidor contesta `pong`.

**Eventos** (`DagEvent`, cada uno con `seq` monotónico por proyecto, `actor` y `at`):

| `type` | `payload` |
|---|---|
| `project.replaced` | `{project}` — el grafo entero cambió: vuelve a pedir el snapshot (`needsRefetch()`) |
| `project.updated` | `{project}` |
| `node.added` / `node.updated` | `{node}` (el nodo completo, no un diff) |
| `node.removed` | `{nodeId}` |
| `edge.added` / `edge.removed` | `{edge}` |
| `blocker.opened` / `blocker.resolved` | `{blocker}` (sin valor de acceso) |
| `message.posted` | `{message}` |

La UI aplica cada evento con `applyEvent(snapshot, event)` de `@dagyard/model`: es puro, idempotente
(ignora `seq <= snapshot.seq`) y devuelve un snapshot nuevo. Al reconectar, reabre con el último `seq`.

## Ejemplos

```bash
URL=https://<worker>.workers.dev; KEY=$(cat ~/.config/dagyard/agent-key)
curl -s $URL/api/health                                               # 200 sin auth
curl -s -o /dev/null -w '%{http_code}\n' $URL/api/projects            # 401
curl -s -H "Authorization: Bearer $KEY" $URL/api/projects             # 200
curl -s -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"text": "Ya conecté la pasarela. Falta probar un reembolso."}' \
  $URL/api/projects/marketplace-reservas/nodes/pagos/messages         # 201 y aparece en la UI
```

## La demo

`demoProject()` de `@dagyard/model` es el grafo «Marketplace de reservas» del preview: 20 nodos, 5 etapas
y 3 bloqueantes abiertos (una decisión en «Modelo de comisiones», una revisión en «Diseño del pago» y un
acceso en «Pagos con tarjeta»). El Worker la siembra con `PUT /api/projects/marketplace-reservas`; la UI
puede usarla como fixture local mientras no haya servidor.
