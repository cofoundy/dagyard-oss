// Prepara ./public (los assets del Worker): copia la UI de ../web/dist si existe; si no, una portada mínima.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public');
const web = join(root, '..', 'web', 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
if (existsSync(join(web, 'index.html'))) {
  cpSync(web, out, { recursive: true });
  console.log(`public/ ← ${web}`);
} else {
  writeFileSync(
    join(out, 'index.html'),
    `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dagyard</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#05060a;color:#e8e6f0;font:500 18px/1.4 system-ui,sans-serif}</style>
</head>
<body><p>Dagyard — la interfaz llega pronto</p></body>
</html>
`,
  );
  console.log('public/ ← portada mínima (no hay apps/web/dist)');
}
