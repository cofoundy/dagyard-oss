#!/bin/bash
# Re-records the Claude Code captures (docs/media/claude-code-{band,menu}.png) against the English demo.
# Needs: tmux, a logged-in `claude`, node with playwright-core (npm i in this folder).
# It runs Claude Code with only the Dagyard mod (--setting-sources project,local skips your user plugins), in a
# throwaway folder ~/booking-marketplace so the banner shows that path and nothing of yours.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../../.." && pwd); OUT="$HERE/out"; mkdir -p "$OUT"
URL=${DAGYARD_URL:-https://dagyard.cofoundy-dev.workers.dev}
DEMO=~/booking-marketplace; mkdir -p "$DEMO"
printf '{"project": "booking-marketplace", "url": "%s"}\n' "$URL" > "$DEMO/.dagyard.json"
[ -d "$DEMO/.git" ] || git -C "$DEMO" init -q
node "$ROOT/apps/worker/scripts/seed.mjs" "$URL"
pause() { perl -e "select(undef,undef,undef,$1)"; }
send() { tmux send-keys -t dyreadme "$1"; pause 0.8; tmux send-keys -t dyreadme Enter; }
shot() { python3 "$HERE/ansi2html.py" "$OUT/$1.ans" "$OUT/$1.html" "claude · ~/booking-marketplace" 120
         node "$HERE/shot.mjs" "$OUT/$1.html" "$ROOT/docs/media/$2"; }

tmux kill-session -t dyreadme 2>/dev/null || true
tmux new-session -d -s dyreadme -x 120 -y 30 -c "$DEMO" \
  "env LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 claude --setting-sources project,local --plugin-dir $ROOT/packages/mod"
pause 25   # first run asks to trust the folder: answer it in `tmux attach -t dyreadme`, then re-run
tmux capture-pane -t dyreadme -p -e > "$OUT/band.ans"
shot band claude-code-band.png
tmux resize-window -t dyreadme -x 120 -y 50; pause 1
send /dagyard; pause 4
tmux capture-pane -t dyreadme -p -e > "$OUT/menu.ans"
shot menu claude-code-menu.png
tmux kill-session -t dyreadme
echo "Open both PNGs and check them: no usage banner, no paths of yours, only the demo."
