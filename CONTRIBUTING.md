# Contributing / Cómo contribuir

Thanks for helping. Issues and pull requests are welcome in English or Spanish.
Gracias por ayudar. Issues y pull requests son bienvenidos en español o en inglés.

## Before you open a PR

1. `pnpm install`, then the three gates CI runs, each must exit 0:
   `pnpm typecheck`, `pnpm test`, `pnpm build`.
2. Add or update a test with the change. Bug fixes come with a test that fails without the fix.
3. Keep the PR to one change, with a title in [Conventional Commits](https://www.conventionalcommits.org)
   form (`fix(cli): …`, `feat(web): …`). `main` only changes through PRs with CI green.
4. If you change the API, update `docs/api.md` and the types in `packages/model/src/types.ts`, which win
   over the prose.

## House rules

- **The UI speaks to PMs, in Peruvian Spanish.** Use accents and opening marks (¿ ¡), *tuteo*, never
  *voseo* («puedes», not «podés»). No technical jargon on screen: no ids, file names or branch names.
- **Visual bar:** `design/preview-constelacion.html` is the reference; changes to the sky should look as
  polished or better. `design/2026-10-03-anti-ref-*.png` show what Dagyard is not (KPI dashboards,
  sidebars, kanban).
- **Never commit secrets.** Tokens live in `apps/worker/.dev.vars` (ignored) or `~/.config/dagyard/`.
  Tests use obviously fake values.

## Security

Please don't open a public issue for a vulnerability. Write to info@cofoundy.dev with the details and
we'll answer there.

## License

By contributing you agree that your contribution is licensed under the repository's [LICENSE](LICENSE).
