# Entornos — Dagyard

| Entorno | URL | Cómo se despliega |
|---|---|---|
| preview | `https://dagyard.cofoundy-dev.workers.dev` | desde `main`: `CLOUDFLARE_ACCOUNT_ID=7865fc5defa821d49cc320b17715a398 pnpm --filter @dagyard/worker run deploy` (ojo: `pnpm deploy` a secas es otro comando de pnpm). La demo se siembra con `node apps/worker/scripts/seed.mjs <url>` (idempotente). |
| prod | no existe todavía (dominio `dagyard.run` pendiente de compra) | — |

Secrets del Worker (`wrangler secret bulk`): `OWNER_TOKEN`, `AGENT_KEY`, `VAULT_KEY`; sus valores viven en
`~/.config/dagyard/{owner-token,agent-key,vault-key}` (chmod 600). Nunca en un commit, issue ni en Basalt.
El token de Cloudflare del entorno no tiene permiso de D1: el estado vive en Durable Objects con SQLite (#9).

Verifica: `curl -s -o /dev/null -w '%{http_code}' <url>/api/health` → 200; `curl -s -o /dev/null -w '%{http_code}' <url>/api/projects` → 401.
