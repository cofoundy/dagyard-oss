# README media

Every image in `README.md` / `README.es.md` lives in `docs/media/` under a stable name, so the media can be
re-recorded (for example after a redesign of the sky) without touching the READMEs.

| File | What it shows | Made by |
|---|---|---|
| `hero.webp` | the sky alive → open «Commission model» → answer it → back to the overview | `record.mjs hero` |
| `sky.jpg` | the overview of the English demo | `record.mjs sky` |
| `decision.jpg` | the card of «Commission model» with its decision | `record.mjs decision` |
| `realtime.webp` | a real `dagyard block` from an agent's terminal and the star turning amber | `record.mjs realtime` |
| `tab-notice.png` | the tab title and favicon when 3 things wait | `record.mjs tab` (after `sky`) |
| `claude-code-band.png`, `claude-code-menu.png` | the mod in Claude Code: the band and `/dagyard` | `terminal.sh` |
| `how-it-works.svg`, `how-it-works.es.svg` | the diagram | `python3 diagram.py en\|es <out.svg>` |

Everything is recorded on the **English demo** (`booking-marketplace`) of the deployed preview, never on a
real project. The takes that answer or open a blocker re-seed the demo before and after
(`apps/worker/scripts/seed.mjs`).

## Re-record

Needs Google Chrome installed, `ffmpeg` (with libwebp), the owner token in `~/.config/dagyard/owner-token` and
the agent key in `~/.config/dagyard/agent-key`. From the repo root:

```bash
(cd docs/media/capture && npm install)        # playwright-core only; this folder is not in the pnpm workspace
pnpm --filter @dagyard/cli build              # the realtime take runs the real CLI
node docs/media/capture/record.mjs all        # or: sky | decision | tab | hero | realtime
docs/media/capture/terminal.sh                # needs tmux and a logged-in claude
```

`DAGYARD_URL` points the scripts at another deployment. The owner session is opened inside the process from
the token file and closed at the end; nothing is printed. Intermediate frames go to `capture/out/` (ignored).

## Honest notes

- The browser tab strip in `tab-notice.png` and the terminal window in `realtime.webp` are drawn: headless
  Chrome has no tab strip and the recording machine has no screen-capture permission. The tab title and
  favicon are read from the live page, and the command and its output in the terminal are the real ones.
- `terminal.sh` runs Claude Code with `--setting-sources project,local`, so none of your plugins, status line
  or hooks show up. Check both PNGs before committing: no usage banner, no paths of yours, only the demo.
- Animated WebP instead of GIF: the hero is 4.4 MB as WebP at quality 88 (lower shows blocks while the camera flies); as a GIF it needs ~6 MB and still bands.
