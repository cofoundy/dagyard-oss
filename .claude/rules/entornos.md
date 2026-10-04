# Entornos — Dagyard

| Entorno | URL | Cómo se despliega |
|---|---|---|
| preview | `<<PENDIENTE: URL workers.dev del primer deploy>>` | `pnpm deploy` (wrangler) desde `main` |
| prod | no existe todavía (dominio `dagyard.run` pendiente de compra) | — |

Verificá: `curl -s -o /dev/null -w '%{http_code}' <url>/api/health` → 200.
