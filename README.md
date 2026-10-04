# Dagyard

**Your agent factory's plan as a living 3D DAG.** See which stage the project is in, get only what is yours
to answer (decisions, reviews and access requests) and unblock your agents from there.

[Leer en español](README.es.md)

![The example project, «Marketplace de reservas», in overview](design/preview-vista-general.png)

Dagyard is built for the person who runs a team of coding agents, usually a PM, not a developer. Every task
is a star; dependencies are the lines between them; stages are the constellations. When an agent needs a
human (pick an option, approve a design, hand over a credential) it opens a *blocker* on its task, the star
turns amber, and the answer flows back to the agent in real time.

The interface is in Peruvian Spanish on purpose: it was designed for the people who use it every day.
The code, the API and the CLI are plain TypeScript.

## What's inside

| Path | What it is |
|---|---|
| `apps/worker` | Cloudflare Worker: REST API + WebSocket, state in Durable Objects with SQLite, serves the UI |
| `apps/web` | Vite + React + three.js: the 3D sky, the task card, the stage rail |
| `packages/model` | Shared types, validation, graph helpers and the demo project |
| `packages/cli` | `dagyard`: the CLI agents use to move their tasks, open blockers and wait for answers |
| `packages/channel` | MCP server that Claude Code loads as a *channel*: pushes your answers into the agent's session |
| `packages/mod` | Claude Code plugin: a band over the prompt with what is waiting for you, and a `/dagyard` menu |
| `docs/` | API contract (`docs/api.md`), v0 spec, QA evidence |
| `design/` | Visual reference (`preview-constelacion.html`) and anti-references |

## Try it in 30 seconds (no server)

Requires Node ≥ 22 and pnpm 10.

```bash
pnpm install
pnpm --filter @dagyard/web dev:fixture
```

Open the URL Vite prints. The example project lives in memory; from the browser console you can play the
agent's part, e.g. `dagyard.message('marketplace-reservas', 'pagos-con-tarjeta', 'Ya conecté la pasarela.')`.

## Run the full stack locally

```bash
pnpm install && pnpm build

# 1. Three secrets for the Worker (any long random strings), never committed
cat > apps/worker/.dev.vars <<EOF
OWNER_TOKEN=$(openssl rand -hex 32)
AGENT_KEY=$(openssl rand -hex 32)
VAULT_KEY=$(openssl rand -hex 32)
EOF

# 2. The Worker (API + built UI) on http://127.0.0.1:8787
pnpm --filter @dagyard/worker dev

# 3. Optional, in another terminal: the UI with hot reload, proxied to the Worker
pnpm --filter @dagyard/web dev
```

Sign in with `OWNER_TOKEN`. To load the example project, put the same token in
`~/.config/dagyard/owner-token` (chmod 600) and run `node apps/worker/scripts/seed.mjs http://127.0.0.1:8787`.

Agents talk to the same server with `AGENT_KEY`:

```bash
pnpm --filter @dagyard/cli build
export DAGYARD_URL=http://127.0.0.1:8787 DAGYARD_KEY=<AGENT_KEY> DAGYARD_PROJECT=marketplace-reservas
node packages/cli/dist/dagyard.mjs next          # the next startable task, as a /goal line
node packages/cli/dist/dagyard.mjs --help
```

A repo can commit a `.dagyard.json` (`{"project": "…", "url": "…"}`) so its agents need no flags; the CLI
sends the key to that URL only if it is `https` and trusted. The key itself only comes from `DAGYARD_KEY`
or `~/.config/dagyard/agent-key`. Details in `packages/cli/README.md`.

## Deploy your own

Dagyard is a single Worker. With a Cloudflare account and `wrangler` logged in:

```bash
pnpm build
cd apps/worker
npx wrangler secret put OWNER_TOKEN    # and AGENT_KEY, VAULT_KEY
npx wrangler deploy --var VERSION:$(git rev-parse --short HEAD)
```

`GET /api/health` answers with the deployed `version`. Access values (the credentials a human hands to an
agent) are stored encrypted with `VAULT_KEY` and never appear in snapshots or events.

## Development

```bash
pnpm typecheck && pnpm test && pnpm build   # the same three gates CI runs
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Status

v0, built in the open by Cofoundy's own agent factory, which uses Dagyard to plan Dagyard
(`docs/dogfooding.md`). Single owner per deployment; multi-tenant is out of scope for v0.

## License

See [LICENSE](LICENSE).
