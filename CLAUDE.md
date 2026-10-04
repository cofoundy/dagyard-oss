# Dagyard — reglas del repo

- Lee primero `docs/spec/v0.md` y la intención en `~/cofoundy/plugins/cofoundy-orchestrator/docs/intent/2026-10-03-panel-dag-de-la-fabrica.md` (§1 verbatim manda).
- Público: PMs. La UI no muestra jerga técnica; español peruano con tildes (tuteo, nunca voseo).
- La referencia visual es `design/preview-constelacion.html`: igual de pulido o mejor. Anti-referencias: `design/2026-10-03-anti-ref-*.png`.
- Stack: Cloudflare Worker + D1 + Durable Objects, Vite + React + three.js, pnpm. Receta de deploy: `~/cofoundy/products/basalt`.
- Gates por exit code: `pnpm typecheck`, `pnpm test`, `pnpm build`. Nunca commitees tokens; el token de dueño vive en `~/.config/dagyard/owner-token`.
- `main` se toca vía PR (products/* = Tier B).
