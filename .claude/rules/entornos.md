# Entornos — Dagyard

| Entorno | URL | Cómo se despliega |
|---|---|---|
| preview | `https://dagyard.cofoundy-dev.workers.dev` | desde `main`: `pnpm build && cd apps/worker && CLOUDFLARE_ACCOUNT_ID=7865fc5defa821d49cc320b17715a398 npx wrangler deploy --var VERSION:$(git rev-parse --short HEAD)` (sin el `--var`, `/api/health` responde `"version":"dev"` y la sonda de efecto no distingue builds; `pnpm --filter … run deploy -- --var …` no lo pasa). Ojo: `pnpm deploy` a secas es otro comando de pnpm. La demo se siembra con `node apps/worker/scripts/seed.mjs <url>` (idempotente). |
| prod | no existe todavía (dominio `dagyard.run` pendiente de compra) | — |

Secrets del Worker (`wrangler secret bulk`): `OWNER_TOKEN`, `AGENT_KEY`, `VAULT_KEY`; sus valores viven en
`~/.config/dagyard/{owner-token,agent-key,vault-key}` (chmod 600). Nunca en un commit, issue ni en Basalt.
El token de Cloudflare del entorno no tiene permiso de D1: el estado vive en Durable Objects con SQLite (#9).

Verifica: `curl -s <url>/api/health` → 200 con `version` = el sha de `main`; `curl -s -o /dev/null -w '%{http_code}' <url>/api/projects` → 401.
