# `dagyard` — el CLI de los agentes

Un solo archivo (`dist/dagyard.mjs`, Node ≥22, sin dependencias en runtime) sobre la API REST.

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
| `import --from <.cofoundy/tasks> [--replace] [--dry-run]` | crea el proyecto desde las tareas del orchestrator; si ya existe, falla salvo `--replace` (`PUT` del grafo entero, 409 si tiene bloqueantes abiertos) |

Exit codes: 0 ok · 1 API o red · 2 `wait` venció · 3 `next` vacío · 64 uso.

## Contrato REST

`docs/api.md` (tipos y validación de `@dagyard/model`, que esbuild mete en el bundle). Las rutas viven
solo en `src/api.ts` (`ROUTES`). `wait` sin `--blocker` lee el snapshot del proyecto y espera el último
bloqueante abierto del nodo en `GET /api/projects/:p/blockers/:b/wait`. `import` valida el grafo con
`parseProjectGraphInput` antes de enviarlo (también en `--dry-run`).

## Import tolerante

`src/tasks/parse.ts` lee front matter, un bloque ```yaml y la cabecera del cuerpo (antes del primer
`## `). `deps ∪ blockedBy`, solo ids que existen en el directorio; `—`, `none` o `[]` al inicio = sin
dependencias, y lo que va entre paréntesis se ignora. `blocked` que espera a otra tarea queda
Pendiente; solo es «Te espera» si no espera a nadie o si el status nombra a un humano. Etapas por
`phase` si todas la traen; si no, por profundidad (máximo 12, lo que acepta el modelo). Los títulos
visibles no llevan `T-xxx` (D10).
