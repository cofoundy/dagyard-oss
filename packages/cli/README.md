# `dagyard` — el CLI de los agentes

Un solo archivo (`dist/dagyard.mjs`, Node ≥20, sin dependencias en runtime) sobre la API REST.

```bash
pnpm install && pnpm build
node dist/dagyard.mjs --help
```

Config: `DAGYARD_URL`, `DAGYARD_KEY`, `DAGYARD_PROJECT`; si faltan, `~/.config/dagyard/{url,agent-key,project}`.
La key nunca se imprime (los errores la tapan con `***`).

| Comando | Qué hace |
|---|---|
| `node add\|update\|start\|progress\|done`, `edge add` | mutan el DAG (`start`, `progress`, `done` también como atajo) |
| `block <nodo> --kind decision\|review\|access --q "…" [--opt …]` | abre un bloqueante e imprime su id |
| `wait <nodo> [--blocker <id>]` | long-poll hasta que el humano resuelve; imprime la elección o el valor |
| `msg <nodo> "…" [--report <url>]` | mensaje ≤280 caracteres |
| `next` | `/goal …` en una sola línea (exit 3 si no hay nada arrancable) |
| `import --from <.cofoundy/tasks> [--dry-run]` | `PUT` del grafo entero desde las tareas del orchestrator |

Exit codes: 0 ok · 1 API o red · 2 `wait` venció · 3 `next` vacío · 64 uso.

## Contrato REST

Las rutas viven solo en `src/api.ts` (`ROUTES`). Mientras `docs/api.md` no esté en `main`, son una
propuesta; si nucleo publica otras, se cambian ahí. La que más importa acordar es `wait`:
`GET /api/projects/:p/nodes/:n/wait?timeout=<s>[&blocker=<id>]` → 200 `BlockerWaitResult` o 204 si vence.

## Import tolerante

`src/tasks/parse.ts` lee front matter, un bloque ```yaml y la cabecera del cuerpo (antes del primer
`## `). `deps ∪ blockedBy`, solo ids que existen en el directorio; `—`, `none` o `[]` al inicio = sin
dependencias, y lo que va entre paréntesis se ignora. `blocked` que espera a otra tarea queda
Pendiente; solo es «Te espera» si no espera a nadie o si el status nombra a un humano. Etapas por
`phase` si todas la traen; si no, por profundidad. Los títulos visibles no llevan `T-xxx` (D10).
